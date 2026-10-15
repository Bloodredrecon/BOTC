import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { Server } from "socket.io";
import {
  CUSTOM_AUDIO_DIR,
  ensureAudioDirs,
  ensureIntroPlaceholder,
  listAudioCues,
} from "./audio-library.js";
import { GameEngine } from "./game.js";
import { createHueDriver } from "./hue.js";
import { formatJoinInfo } from "./join-info.js";
import { loadConfig, loadScript, loadSession, ROOT, saveSession } from "./persistence.js";
import { PinGuard } from "./pin-guard.js";
import type { AmbianceState, Phase } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const script = loadScript();
const hue = createHueDriver(config.hue);

ensureAudioDirs();
ensureIntroPlaceholder();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/api/health", async () => ({
  ok: true,
  app: "botc-companion",
  pid: process.pid,
  hueLive: hue.isLive(),
  script: script.name,
}));

// Set by scripts/botc.ps1 so its Stop can shut down cleanly; route is disabled otherwise.
const controlToken = process.env.BOTC_CONTROL_TOKEN ?? "";
if (controlToken) {
  app.post("/api/control/shutdown", async (req, reply) => {
    const given = Buffer.from(String(req.headers["x-botc-control-token"] ?? ""));
    const expected = Buffer.from(controlToken);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    setImmediate(() => void shutdown("launcher stop request"));
    return { ok: true };
  });
}

app.get("/api/config/public", async () => ({
  scriptName: script.name,
  port: config.port,
}));

app.get("/api/audio/cues", async () => ({ cues: listAudioCues() }));

await app.register(fastifyStatic, {
  root: CUSTOM_AUDIO_DIR,
  prefix: "/custom-audio/",
  decorateReply: false,
});

const webDistCandidates = [
  join(ROOT, "web", "dist"),
  join(__dirname, "..", "..", "web", "dist"),
  join(__dirname, "..", "web", "dist"),
];
const webDist = webDistCandidates.find((p) => existsSync(join(p, "index.html")));

if (webDist) {
  await app.register(fastifyStatic, {
    root: webDist,
    // Must stay true so rebuilt hashed assets (/assets/index-*.js) are found
    // without restarting; wildcard:false freezes the file list at boot.
    wildcard: true,
  });
  app.setNotFoundHandler((req, reply) => {
    const url = req.raw.url ?? "";
    if (
      url.startsWith("/api") ||
      url.startsWith("/socket.io") ||
      url.startsWith("/custom-audio") ||
      url.startsWith("/assets/") ||
      url.startsWith("/audio/")
    ) {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
  console.log(`Serving UI from ${webDist}`);
} else {
  app.get("/", async (_req, reply) =>
    reply.type("text/html").send(`<!doctype html>
<html><body style="font-family:sans-serif;background:#0b1220;color:#f2e8d5;padding:2rem">
<h1>BOTC Companion API</h1>
<p>UI build not found. Double-click <code>BOTC.bat</code> and choose <b>Rebuild and start</b>
(or run <code>npm run build</code>), then restart.</p>
</body></html>`),
  );
  const bar = "!".repeat(64);
  console.warn(
    [
      "",
      bar,
      "  WEB UI NOT BUILT (web/dist/index.html missing) - running API only.",
      "  The TV and Storyteller pages will NOT load.",
      "  Fix: double-click BOTC.bat and choose 'Rebuild and start'",
      "       (or run: npm run build), then restart the server.",
      bar,
      "",
    ].join("\n"),
  );
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  const bar = "!".repeat(64);
  const fix = [
    "  Pick another port: double-click BOTC.bat > Settings > Port,",
    '  or set "port" in config/local.json (or the PORT env var).',
  ];
  const msg: Record<string, string[]> = {
    EADDRINUSE: [
      `  PORT ${config.port} IS ALREADY IN USE - is BOTC (or another app) already running?`,
      "  Stop the other copy (BOTC.bat > Stop) or:",
      ...fix,
    ],
    EACCES: [
      `  PORT ${config.port} IS NOT ALLOWED (reserved by Windows or needs admin rights).`,
      ...fix,
    ],
    EADDRNOTAVAIL: [
      `  HOST ${config.host} IS NOT AN ADDRESS OF THIS PC (network changed?).`,
      "  Use host 0.0.0.0: BOTC.bat > Settings > Host, or edit config/local.json.",
    ],
  };
  console.error(
    ["", bar, ...(msg[code ?? ""] ?? [`  Could not start server on ${config.host}:${config.port}: ${String(err)}`]), bar, ""].join("\n"),
  );
  process.exit(1);
}

const io = new Server(app.server, {
  cors: { origin: true },
});

const engine = new GameEngine(loadSession(), script, hue, ({ public: pub, storyteller }) => {
  io.to("tv").emit("state:public", pub);
  io.to("storyteller").emit("state:storyteller", storyteller);
});

const pinGuard = new PinGuard(config.storytellerPin);

function clientAddress(raw: string): string {
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

io.on("connection", (socket) => {
  socket.on("join", (payload: { role: "tv" | "storyteller"; pin?: string } | null) => {
    if (!payload || typeof payload !== "object") return;
    if (payload.role === "tv") {
      socket.join("tv");
      socket.data.role = "tv";
      engine.setConnected("tv", true);
      return;
    }

    if (payload.role === "storyteller") {
      const clientKey = clientAddress(socket.handshake.address);
      const check = pinGuard.attempt(clientKey, payload.pin);
      if (!check.ok) {
        app.log.warn({ client: clientKey, reason: check.reason, retryAfterMs: check.retryAfterMs }, "storyteller PIN refused");
        socket.emit("auth:error", { message: PinGuard.message(check), retryAfterMs: check.retryAfterMs });
        return;
      }
      socket.join("storyteller");
      socket.data.role = "storyteller";
      socket.data.authenticated = true;
      socket.emit("auth:info", { pinIsDefault: pinGuard.isDefaultPin });
      engine.setConnected("storyteller", true);
    }
  });

  function requireStoryteller(): boolean {
    return socket.data.role === "storyteller" && socket.data.authenticated === true;
  }

  type Handler = (data: Record<string, unknown>) => unknown;

  const actions: Record<string, Handler> = {
    "game:reset": () => engine.resetGame(),
    "game:setPlayerCount": (d) =>
      engine.setPlayerCount(Number(d.count), {
        allowOver15: typeof d.allowOver15 === "boolean" ? d.allowOver15 : undefined,
      }),
    "game:moveSeat": (d) => engine.moveSeat(String(d.playerId ?? ""), Number(d.seat)),
    "game:setTvSheet": (d) => engine.setTvSheet(Boolean(d.on)),
    "game:callExile": (d) =>
      engine.callExile(String(d.travellerId ?? ""), d.calledById != null ? String(d.calledById) : null),
    "game:toggleExileSupport": (d) => engine.toggleExileSupport(String(d.playerId ?? "")),
    "game:resolveExile": (d) =>
      engine.resolveExile(d.force === "exile" || d.force === "spare" ? d.force : undefined),
    "game:cancelExile": () => engine.cancelExile(),
    "game:giveVoteToken": (d) => engine.giveVoteToken(String(d.beggarId ?? ""), String(d.donorId ?? "")),
    "game:updatePlayer": (d) =>
      engine.updatePlayer(String(d.playerId), d.patch as Parameters<GameEngine["updatePlayer"]>[1]),
    "game:setFabled": (d) => engine.setFabled(d.ids as string[]),
    "game:startFirstNight": () => engine.startFirstNight(),
    "game:startNight": () => engine.startNight(),
    "game:nightNext": () => engine.nightNext(),
    "game:nightPrev": () => engine.nightPrev(),
    "game:nightSkipToDawn": () => engine.nightSkipToDawn(),
    "game:goDawn": () => engine.goDawn(),
    "game:setDawnDeaths": (d) => engine.setDawnDeaths(d.playerIds as string[]),
    "game:announceDawnDeaths": () => engine.announceDawnDeaths(),
    "game:announceDawnThenDay": () => engine.announceDawnThenDay(),
    "game:finishDawn": () => engine.finishDawn(),
    "game:goDay": () => engine.goDay(),
    "game:advancePhase": () => engine.advancePhase(),
    "game:goDusk": () => engine.goDusk(),
    "game:openNominations": () => engine.openNominations(),
    "game:endDay": () => engine.endDay(),
    "game:cancelNomination": () => engine.cancelNomination(),
    "game:startNomination": (d) =>
      engine.startNomination(String(d.nominatorId), String(d.nomineeId), {
        spyRegistersAsTownsfolk: Boolean(d.spyRegistersAsTownsfolk),
        override: Boolean(d.override),
      }),
    "game:slayerShot": (d) =>
      engine.slayerShot(String(d.shooterId ?? ""), String(d.targetId ?? ""), {
        recluseRegistersAsDemon: Boolean(d.recluseRegistersAsDemon),
      }),
    "game:startVote": (d) => engine.startVote(Number(d.seconds ?? 30)),
    "game:toggleVote": (d) => engine.toggleVote(String(d.playerId)),
    "game:resolveVote": (d) =>
      engine.resolveVote(d.outcome as "majority" | "no_majority" | "tie" | undefined),
    "game:confirmExecution": (d) =>
      engine.confirmExecution(Boolean(d.died), {
        substituteId: d.substituteId != null ? String(d.substituteId) : null,
      }),
    "game:otherDeath": (d) =>
      engine.otherDeath(String(d.playerId), String(d.reason ?? ""), {
        starPassTo: d.starPassTo != null ? String(d.starPassTo) : null,
      }),
    "game:startTimer": (d) => engine.startTimer(Number(d.seconds), String(d.label ?? "Timer")),
    "game:cancelTimer": () => engine.cancelTimer(),
    "game:timerEnded": () => engine.timerEnded(),
    "game:scene": (d) => engine.scene(d.scene as "day" | "night" | "hush"),
    "game:endGame": (d) =>
      engine.endGame((d.winner as "good" | "evil" | null | undefined) ?? null),
    "game:setPhase": (d) => engine.setPhase(d.phase as Phase),
    "game:playSound": (d) => engine.playSound(String(d.cueId ?? "")),
    "game:setAmbiance": (d) =>
      engine.setAmbiance({
        masterVolume: typeof d.masterVolume === "number" ? d.masterVolume : undefined,
        layers: Array.isArray(d.layers) ? (d.layers as AmbianceState["layers"]) : undefined,
      }),
    "game:addTraveller": (d) =>
      engine.addTraveller(String(d.name ?? ""), String(d.characterId ?? ""), {
        seat: d.seat != null && d.seat !== "" ? Number(d.seat) : null,
        alignment: d.alignment === "evil" ? "evil" : "good",
      }),
    "game:leaveTraveller": (d) => engine.leaveTraveller(String(d.playerId)),
    "game:markNightStepDone": () => engine.markNightStepDone(),
    "game:rebuildNight": () => engine.rebuildNight(),
    "game:applyInfoReminders": (d) =>
      engine.applyInfoReminders({
        roleId: d.roleId != null ? String(d.roleId) : undefined,
        playerIds: Array.isArray(d.playerIds) ? (d.playerIds as string[]) : undefined,
        characterId: d.characterId != null ? String(d.characterId) : null,
        zeroOutsiders: Boolean(d.zeroOutsiders),
        redHerringPlayerId:
          d.redHerringPlayerId != null ? String(d.redHerringPlayerId) : null,
      }),
    "game:applyNightReminder": (d) =>
      engine.applyNightReminder(String(d.playerId ?? ""), String(d.reminder ?? "")),
    "game:clearStNotices": () => engine.clearStNotices(),
    "game:dismissStNotice": (d) => engine.dismissStNotice(String(d.id ?? "")),
    "game:refresh": () => engine.emit(),
  };

  for (const [event, handler] of Object.entries(actions)) {
    socket.on(event, (data, ack?: (result: unknown) => void) => {
      if (!requireStoryteller()) {
        socket.emit("auth:error", { message: "Storyteller auth required" });
        return;
      }
      try {
        const result = handler((data ?? {}) as Record<string, unknown>);
        if (typeof ack === "function") ack(result ?? { ok: true });
      } catch (err) {
        app.log.error(err);
        socket.emit("action:error", { message: String(err) });
        if (typeof ack === "function") ack({ ok: false, error: String(err) });
      }
    });
  }

  socket.on("disconnect", () => {
    if (socket.data.role === "tv") {
      const tvs = io.sockets.adapter.rooms.get("tv");
      engine.setConnected("tv", !!(tvs && tvs.size > 0));
    }
    if (socket.data.role === "storyteller") {
      const sts = io.sockets.adapter.rooms.get("storyteller");
      engine.setConnected("storyteller", !!(sts && sts.size > 0));
    }
  });
});

const timerTick = setInterval(() => {
  const timer = engine.session.timer;
  if (timer && Date.now() >= timer.endsAt) {
    engine.timerEnded();
  }
}, 500);

let shuttingDown = false;
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${reason})...`);
  setTimeout(() => {
    console.error("Shutdown timed out; exiting.");
    process.exit(1);
  }, 5000).unref();
  clearInterval(timerTick);
  try {
    io.disconnectSockets(true);
    io.engine.close();
    await app.close();
  } catch (err) {
    console.error("Error while closing server:", err);
  }
  try {
    saveSession(engine.session);
  } catch (err) {
    console.error("Final session save failed:", err);
  }
  console.log("BOTC Companion stopped.");
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log(formatJoinInfo({ host: config.host, port: config.port, pin: config.storytellerPin }));
console.log(`Hue: ${hue.isLive() ? "live" : "stub mode"}`);

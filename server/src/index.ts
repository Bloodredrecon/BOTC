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
import { loadConfig, loadScript, loadSession, ROOT } from "./persistence.js";
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
  hueLive: hue.isLive(),
  script: script.name,
}));

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
<p>UI build not found. Run <code>npm run build</code> then restart.</p>
</body></html>`),
  );
  console.warn("web/dist not found — API only. Run: npm run build");
}

await app.listen({ port: config.port, host: config.host });

const io = new Server(app.server, {
  cors: { origin: true },
});

const engine = new GameEngine(loadSession(), script, hue, ({ public: pub, storyteller }) => {
  io.to("tv").emit("state:public", pub);
  io.to("storyteller").emit("state:storyteller", storyteller);
});

io.on("connection", (socket) => {
  socket.on("join", (payload: { role: "tv" | "storyteller"; pin?: string }) => {
    if (payload.role === "tv") {
      socket.join("tv");
      socket.data.role = "tv";
      engine.setConnected("tv", true);
      return;
    }

    if (payload.role === "storyteller") {
      if (payload.pin !== config.storytellerPin) {
        socket.emit("auth:error", { message: "Invalid PIN" });
        return;
      }
      socket.join("storyteller");
      socket.data.role = "storyteller";
      socket.data.authenticated = true;
      engine.setConnected("storyteller", true);
    }
  });

  function requireStoryteller(): boolean {
    return socket.data.role === "storyteller" && socket.data.authenticated === true;
  }

  type Handler = (data: Record<string, unknown>) => unknown;

  const actions: Record<string, Handler> = {
    "game:reset": () => engine.resetGame(),
    "game:setPlayerCount": (d) => engine.setPlayerCount(Number(d.count)),
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
    "game:startNomination": (d) =>
      engine.startNomination(String(d.nominatorId), String(d.nomineeId)),
    "game:startVote": (d) => engine.startVote(Number(d.seconds ?? 30)),
    "game:toggleVote": (d) => engine.toggleVote(String(d.playerId)),
    "game:resolveVote": (d) =>
      engine.resolveVote(d.outcome as "majority" | "no_majority" | "tie" | undefined),
    "game:confirmExecution": (d) => engine.confirmExecution(Boolean(d.died)),
    "game:otherDeath": (d) =>
      engine.otherDeath(String(d.playerId), String(d.reason ?? "")),
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
      engine.addTraveller(String(d.name ?? ""), String(d.characterId ?? "")),
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

setInterval(() => {
  const timer = engine.session.timer;
  if (timer && Date.now() >= timer.endsAt) {
    engine.timerEnded();
  }
}, 500);

console.log(`BOTC Companion listening on http://${config.host}:${config.port}`);
console.log(`Open /tv on the television and /storyteller on your phone`);
console.log(`Storyteller PIN: ${config.storytellerPin}`);
console.log(`Hue: ${hue.isLive() ? "live" : "stub mode"}`);

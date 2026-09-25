import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { Server } from "socket.io";
import { GameEngine } from "./game.js";
import { createHueDriver } from "./hue.js";
import { loadConfig, loadScript, loadSession, ROOT } from "./persistence.js";
import type { Phase } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const script = loadScript();
const hue = createHueDriver(config.hue);

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

const webDistCandidates = [
  join(ROOT, "web", "dist"),
  join(__dirname, "..", "..", "web", "dist"),
  join(__dirname, "..", "web", "dist"),
];
const webDist = webDistCandidates.find((p) => existsSync(join(p, "index.html")));

if (webDist) {
  await app.register(fastifyStatic, {
    root: webDist,
    wildcard: false,
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith("/api") || req.raw.url?.startsWith("/socket.io")) {
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
<p>UI build not found. Run <code>npm run build</code> then restart, or use Vite:</p>
<ul>
<li><a href="http://localhost:5173/tv" style="color:#c9a45c">TV display</a></li>
<li><a href="http://localhost:5173/storyteller" style="color:#c9a45c">Storyteller</a></li>
</ul>
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

  type Handler = (data: Record<string, unknown>) => void;

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
    "game:finishDawn": () => engine.finishDawn(),
    "game:goDay": () => engine.goDay(),
    "game:startNomination": (d) =>
      engine.startNomination(String(d.nominatorId), String(d.nomineeId)),
    "game:startVote": (d) => engine.startVote(Number(d.seconds ?? 30)),
    "game:toggleVote": (d) => engine.toggleVote(String(d.playerId)),
    "game:resolveVote": (d) =>
      engine.resolveVote(d.outcome as "majority" | "no_majority" | "tie" | undefined),
    "game:confirmExecution": (d) => engine.confirmExecution(Boolean(d.died)),
    "game:otherDeath": (d) => engine.otherDeath(String(d.playerId), String(d.reason ?? "")),
    "game:startTimer": (d) => engine.startTimer(Number(d.seconds), String(d.label ?? "Timer")),
    "game:cancelTimer": () => engine.cancelTimer(),
    "game:timerEnded": () => engine.timerEnded(),
    "game:scene": (d) => engine.scene(d.scene as "day" | "night" | "hush"),
    "game:endGame": () => engine.endGame(),
    "game:setPhase": (d) => engine.setPhase(d.phase as Phase),
  };

  for (const [event, handler] of Object.entries(actions)) {
    socket.on(event, (data) => {
      if (!requireStoryteller()) {
        socket.emit("auth:error", { message: "Storyteller auth required" });
        return;
      }
      try {
        handler((data ?? {}) as Record<string, unknown>);
      } catch (err) {
        app.log.error(err);
        socket.emit("action:error", { message: String(err) });
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

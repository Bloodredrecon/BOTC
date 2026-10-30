import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { Server } from "socket.io";
import {
  CUSTOM_AUDIO_DIR,
  ensureAudioDirs,
  ensureIntroPlaceholder,
  listAudioCues,
} from "./audio-library.js";
import { GameEngine } from "./game.js";
import { createHueDriver } from "./hue.js";
import { composeLighting, sceneForSession, type LightingScene } from "./lighting.js";
import { createWledDriver } from "./wled.js";
import { formatJoinInfo, joinBaseUrls, type Scheme } from "./join-info.js";
import { ensureCertificate, TLS_DIR, type TlsMaterial } from "./tls.js";
import {
  ActionLog,
  describeArgs,
  describeEvent,
  diffSession,
  outcomeOf,
  snapshotSession,
  type SessionSnapshot,
} from "./action-log.js";
import { GAME_LOG_DIR, loadConfig, loadScript, loadSession, patchLocalWled, ROOT, saveSession } from "./persistence.js";
import { PhoneHub } from "./phone-hub.js";
import { PinGuard } from "./pin-guard.js";
import { readPlayerPhoto } from "./player-photos.js";
import { pushStNotice } from "./rules.js";
import { proposeDeal, validateDeal } from "./setup-wizard.js";
import {
  comparable,
  isPhoneAction,
  mergeKeyFor,
  NOT_UNDOABLE,
  restoredSession,
  undoLabel,
  UndoStack,
} from "./undo.js";
import type { AmbianceState, Phase } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const script = loadScript();
const lighting = composeLighting([createWledDriver(config.wled), createHueDriver(config.hue)]);

ensureAudioDirs();
ensureIntroPlaceholder();

let tls: TlsMaterial | null = null;
if (config.https) {
  try {
    tls = await ensureCertificate(config.host);
    if (tls.created) console.log(`HTTPS: made a new self-signed certificate in ${TLS_DIR} (${tls.reason}).`);
  } catch (err) {
    console.error(`HTTPS is on but the certificate could not be made (${String(err)}). Turn HTTPS off in BOTC.bat > Settings.`);
    process.exit(1);
  }
}
const scheme: Scheme = tls ? "https" : "http";

const app = (
  tls ? Fastify({ logger: true, https: { key: tls.key, cert: tls.cert } }) : Fastify({ logger: true })
) as unknown as FastifyInstance;
await app.register(cors, { origin: true });

app.get("/api/health", async () => ({
  ok: true,
  app: "botc-companion",
  pid: process.pid,
  hueLive: config.hue.enabled && Boolean(config.hue.bridgeIp && config.hue.username),
  wledLive: lighting.isLive() && (lighting.status().backend === "wled" || lighting.status().backend === "both"),
  lighting: lighting.status().backend,
  script: script.name,
  scheme,
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
  // Where phones should go (the TV may itself be on localhost); null while player phones are off.
  joinBase: engine.session.phones.enabled ? (joinBaseUrls(config.host, config.port, scheme).main[0] ?? null) : null,
}));

app.get("/api/audio/cues", async () => ({ cues: listAudioCues() }));

/** Face photos are as public as names (TV / phones / Storyteller). Upload is phones-on only. */
app.get<{ Params: { playerId: string } }>("/api/player-photos/:playerId", async (req, reply) => {
  const buf = readPlayerPhoto(engine.session, String(req.params.playerId ?? ""));
  if (!buf) return reply.code(404).send({ error: "No photo" });
  return reply
    .header("Cache-Control", "public, max-age=86400, immutable")
    .type("image/jpeg")
    .send(buf);
});

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

const actionLog = new ActionLog(GAME_LOG_DIR);
actionLog.onEntry((e) => io.to("storyteller").emit("log:entry", e));

let engineReady = false;
let inAction = false;
let broadcasts = 0;

let phoneHub: PhoneHub | null = null;
const engine = new GameEngine(loadSession(config.playerPhones), script, lighting, ({ public: pub, storyteller }) => {
  broadcasts += 1;
  io.to("tv").emit("state:public", pub);
  io.to("storyteller").emit("state:storyteller", storyteller);
  phoneHub?.afterBroadcast(pub);
  if (engineReady && !inAction) logSystemChanges();
});
const phones = new PhoneHub(io, engine, script, actionLog);
phoneHub = phones;
engine.phoneLive = () => phones.live();
engine.phoneVoters = () => phones.connectedPlayerIds();
engine.privateBroadcast = (storyteller, playerIds) => {
  broadcasts += 1;
  io.to("storyteller").emit("state:storyteller", storyteller);
  phones.afterPrivate(playerIds);
};
let lastSnap: SessionSnapshot = snapshotSession(engine.session);
engineReady = true;

function here() {
  return { phase: engine.session.phase, day: engine.session.dayNumber };
}

/** Phase changes, deaths and notices that happen on a timer rather than from a Storyteller action. */
function logSystemChanges() {
  const s = engine.session;
  const { notices, events } = diffSession(lastSnap, s);
  const moved = s.phase !== lastSnap.phase || s.dayNumber !== lastSnap.day;
  if (moved || notices.length || events.length) {
    actionLog.record({
      t: Date.now(),
      kind: "system",
      outcome: "info",
      reason: "automatic",
      phase: lastSnap.phase,
      day: lastSnap.day,
      phaseAfter: s.phase,
      dayAfter: s.dayNumber,
      notices: notices.length ? notices : undefined,
      events: events.length ? events.map((e) => describeEvent(s, e)) : undefined,
    });
  }
  lastSnap = snapshotSession(s);
}

/** Slider-driven actions fire many times a second; log only the last of each burst. */
const COALESCED_ACTIONS = new Set(["game:setAmbiance", "lighting:set"]);
let pendingCoalesced: { action: string; entry: Parameters<ActionLog["record"]>[0]; timer: NodeJS.Timeout } | null =
  null;
function flushCoalesced() {
  if (!pendingCoalesced) return;
  clearTimeout(pendingCoalesced.timer);
  actionLog.record(pendingCoalesced.entry);
  pendingCoalesced = null;
}
function recordAction(entry: Parameters<ActionLog["record"]>[0]) {
  if (entry.action && COALESCED_ACTIONS.has(entry.action) && entry.outcome === "ok") {
    if (pendingCoalesced && pendingCoalesced.action !== entry.action) flushCoalesced();
    if (pendingCoalesced) clearTimeout(pendingCoalesced.timer);
    pendingCoalesced = { action: entry.action, entry, timer: setTimeout(flushCoalesced, 1500) };
    return;
  }
  flushCoalesced();
  actionLog.record(entry);
}

const pinGuard = new PinGuard(config.storytellerPin);

/** In memory only: a server restart starts a fresh undo history. */
const undo = new UndoStack();
function sendUndo() {
  io.to("storyteller").emit("undo:state", undo.summary());
}

function residentIds(): string[] {
  return engine.session.players
    .filter((p) => !p.isTraveller && !p.leftGame)
    .sort((a, b) => a.seat - b.seat)
    .map((p) => p.id);
}

function undoLast(): { ok: boolean; message: string } {
  const entry = undo.pop();
  if (!entry) return { ok: false, message: "Nothing to undo." };
  const cancelled = engine.undoTo(restoredSession(entry.before, engine.session));
  const message = `Undone: ${entry.label}.${
    cancelled.length ? ` Also cancelled ${cancelled.join(" and ")} — continue it by hand if it still applies.` : ""
  }`;
  engine.mutate((s) => pushStNotice(s, message));
  return { ok: true, message };
}

/** Actions that only read state: answered, never logged or undone. */
const READ_ONLY_ACTIONS = new Set(["game:refresh", "game:previewDeal", "lighting:set", "lighting:preview", "lighting:cue"]);

/** Connected-device counts for the Storyteller; tvChangedAt marks when the TV count last hit or left 0. */
let tvChangedAt = Date.now();
function roomSize(room: string): number {
  return io.sockets.adapter.rooms.get(room)?.size ?? 0;
}
function sendPresence() {
  io.to("storyteller").emit("presence", {
    tv: roomSize("tv"),
    tvChangedAt,
    storytellers: roomSize("storyteller"),
  });
}

function clientAddress(raw: string): string {
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

io.on("connection", (socket) => {
  const client = clientAddress(socket.handshake.address);

  socket.on("join", (payload: { role: string; pin?: string; token?: unknown } | null) => {
    if (!payload || typeof payload !== "object") return;
    if (payload.role === "player" || payload.role === "spectator") {
      // A phone never shares a room with the TV or the Storyteller.
      if (socket.data.role === "tv" || socket.data.role === "storyteller") return;
      phones.join(socket, payload, client);
      return;
    }
    if (socket.data.role === "player" || socket.data.role === "spectator") return;
    if (payload.role === "tv") {
      if (roomSize("tv") === 0) tvChangedAt = Date.now();
      socket.join("tv");
      socket.data.role = "tv";
      actionLog.record({ t: Date.now(), kind: "connection", action: "tv:join", outcome: "info", client, ...here() });
      engine.setConnected("tv", true);
      sendPresence();
      return;
    }

    if (payload.role === "storyteller") {
      const check = pinGuard.attempt(client, payload.pin);
      if (!check.ok) {
        app.log.warn({ client, reason: check.reason, retryAfterMs: check.retryAfterMs }, "storyteller PIN refused");
        actionLog.record({
          t: Date.now(),
          kind: "auth",
          action: "storyteller:join",
          outcome: "rejected",
          reason: check.reason === "locked" ? `locked out for ${Math.ceil(check.retryAfterMs / 1000)} s` : "wrong PIN",
          client,
          ...here(),
        });
        socket.emit("auth:error", { message: PinGuard.message(check), retryAfterMs: check.retryAfterMs });
        return;
      }
      socket.join("storyteller");
      socket.data.role = "storyteller";
      socket.data.authenticated = true;
      actionLog.record({ t: Date.now(), kind: "auth", action: "storyteller:join", outcome: "ok", client, ...here() });
      socket.emit("auth:info", { pinIsDefault: pinGuard.isDefaultPin });
      socket.emit("undo:state", undo.summary());
      engine.setConnected("storyteller", true);
      sendPresence();
    }
  });

  socket.on("log:recent", (data: unknown, ack?: (r: unknown) => void) => {
    if (typeof ack !== "function") return;
    if (!requireStoryteller()) return ack({ ok: false, error: "Storyteller auth required" });
    const n = Number((data as { limit?: unknown } | null)?.limit ?? 200);
    ack({ ok: true, entries: actionLog.recent(Number.isFinite(n) ? Math.min(1000, Math.max(1, n)) : 200) });
  });

  /** TV only: Enable sound succeeded — Storyteller sees “TV sound ready”. */
  socket.on("tv:soundReady", () => {
    if (socket.data.role !== "tv") return;
    engine.setTvSoundReady(true);
    actionLog.record({ t: Date.now(), kind: "connection", action: "tv:soundReady", outcome: "info", client, ...here() });
  });

  function requireStoryteller(): boolean {
    return socket.data.role === "storyteller" && socket.data.authenticated === true;
  }

  type Handler = (data: Record<string, unknown>) => unknown;

  const actions: Record<string, Handler> = {
    "game:reset": (d) => {
      phones.rememberCleared(engine.session.phones.claims);
      engine.resetGame({ sameTable: Boolean(d.sameTable) });
    },
    ...phones.storytellerActions(),
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
    "game:startFirstNight": (d) => engine.startFirstNight({ override: Boolean(d.override) }),
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
    "game:advancePhase": (d) => engine.advancePhase({ override: Boolean(d.override) }),
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
    "lighting:set": (d) => {
      void (async () => {
        if (typeof d.follow === "boolean") await lighting.setFollow?.(d.follow);
        if (typeof d.brightness === "number") await lighting.setBrightness?.(d.brightness);
        if (typeof d.maxBrightness === "number") await lighting.setMaxBrightness?.(d.maxBrightness);
        if (typeof d.eventCues === "boolean") await lighting.setEventCues?.(d.eventCues);
        if (d.follow === true) await lighting.applyScene(sceneForSession(engine.session));
        const persist: Parameters<typeof patchLocalWled>[0] = {};
        if (typeof d.follow === "boolean") persist.enabled = d.follow;
        if (typeof d.brightness === "number") persist.brightness = d.brightness;
        if (typeof d.maxBrightness === "number") persist.maxBrightness = d.maxBrightness;
        if (typeof d.eventCues === "boolean") persist.eventCues = d.eventCues;
        if (Object.keys(persist).length) patchLocalWled(persist);
        engine.emit();
      })();
    },
    "lighting:cue": (d) => {
      const scene = String(d.scene ?? "") as LightingScene;
      const allowed: LightingScene[] = [
        "night_wake",
        "night",
        "day",
        "hush",
        "nomination",
        "execution",
        "death_settle",
        "vote_urgency",
      ];
      if (!allowed.includes(scene)) return { ok: false, message: "Unknown cue" };
      void lighting.applyScene(scene);
      engine.emit();
      return { ok: true };
    },
    "lighting:preview": (d) => {
      const scene = String(d.scene ?? "") as LightingScene;
      const allowed: LightingScene[] = [
        "lobby",
        "day",
        "night",
        "night_wake",
        "dawn",
        "dusk",
        "nomination",
        "vote",
        "vote_urgency",
        "execution",
        "death_settle",
        "hush",
        "good_wins",
        "evil_wins",
      ];
      if (!allowed.includes(scene)) return { ok: false, message: "Unknown scene" };
      void lighting.preview?.(scene);
      engine.emit();
      return { ok: true };
    },
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
    "game:previewDeal": (d) =>
      proposeDeal(script, residentIds(), {
        include: Array.isArray(d.include) ? d.include.map(String) : [],
      }),
    "game:applyDeal": (d) => {
      const checked = validateDeal(script, residentIds(), d.deal);
      if (!checked.ok) return { ok: false, message: checked.errors.join(" ") };
      return engine.applyDeal(checked.deal);
    },
    "game:undo": () => undoLast(),
  };

  for (const [event, handler] of Object.entries(actions)) {
    socket.on(event, (data, ack?: (result: unknown) => void) => {
      if (!requireStoryteller()) {
        if (!socket.data.loggedUnauthorized) {
          socket.data.loggedUnauthorized = true;
          actionLog.record({
            t: Date.now(),
            kind: "auth",
            action: event,
            outcome: "rejected",
            reason: "not signed in as Storyteller (further attempts from this connection not logged)",
            client,
            ...here(),
          });
        }
        socket.emit("auth:error", { message: "Storyteller auth required" });
        if (typeof ack === "function") ack({ ok: false, error: "Storyteller auth required" });
        return;
      }
      if (READ_ONLY_ACTIONS.has(event)) {
        let result: unknown;
        try {
          result = handler((data ?? {}) as Record<string, unknown>);
        } catch (err) {
          app.log.error(err);
          result = { ok: false, error: String(err) };
        }
        if (typeof ack === "function") ack(result ?? { ok: true });
        return;
      }
      const undoable = !NOT_UNDOABLE.has(event) && !isPhoneAction(event);
      const full = undoable ? structuredClone(engine.session) : null;
      const fullCmp = full ? comparable(full) : null;
      const before = snapshotSession(engine.session);
      const args = describeArgs(engine.session, data);
      const b0 = broadcasts;
      let result: unknown;
      let error: unknown = null;
      inAction = true;
      try {
        result = handler((data ?? {}) as Record<string, unknown>);
      } catch (err) {
        error = err;
      } finally {
        inAction = false;
      }
      const s = engine.session;
      const { notices, events } = diffSession(before, s);
      const outcome = error ? { outcome: "error" as const, reason: String(error) } : outcomeOf(result, broadcasts > b0);
      recordAction({
        t: Date.now(),
        kind: "action",
        action: event,
        args,
        ...outcome,
        phase: before.phase,
        day: before.day,
        phaseAfter: s.phase,
        dayAfter: s.dayNumber,
        notices: notices.length ? notices : undefined,
        events: events.length ? events.map((e) => describeEvent(s, e)) : undefined,
      });
      lastSnap = snapshotSession(s);
      if (event === "game:reset" && !error) undo.clear();
      if (full && !error && outcome.outcome === "ok" && comparable(engine.session) !== fullCmp) {
        undo.push({
          action: event,
          label: undoLabel(event, args),
          at: Date.now(),
          phase: before.phase,
          day: before.day,
          before: full,
          mergeKey: mergeKeyFor(event, data),
        });
      }
      sendUndo();
      if (error) {
        app.log.error(error);
        socket.emit("action:error", { message: String(error) });
        if (typeof ack === "function") ack({ ok: false, error: String(error) });
      } else if (typeof ack === "function") {
        ack(result ?? { ok: true });
      }
    });
  }

  for (const [event, handler] of Object.entries(phones.playerHandlers(socket, client))) {
    socket.on(event, (data, ack?: (result: unknown) => void) => {
      if (typeof ack !== "function") return;
      if (socket.data.role !== "player") return ack({ ok: false, error: "Open /play to join as a player." });
      let result: unknown;
      try {
        result = handler(data && typeof data === "object" ? (data as Record<string, unknown>) : {});
      } catch (err) {
        app.log.error(err);
        result = { ok: false, error: "Something went wrong on the server." };
      }
      ack(result ?? { ok: true });
    });
  }

  socket.on("disconnect", () => {
    phones.onDisconnect(socket);
    if (socket.data.role === "tv" || socket.data.role === "storyteller") {
      actionLog.record({
        t: Date.now(),
        kind: "connection",
        action: `${socket.data.role}:disconnect`,
        outcome: "info",
        client,
        ...here(),
      });
    }
    if (socket.data.role === "tv") {
      const tvs = io.sockets.adapter.rooms.get("tv");
      engine.setConnected("tv", !!(tvs && tvs.size > 0));
    }
    if (socket.data.role === "storyteller") {
      const sts = io.sockets.adapter.rooms.get("storyteller");
      engine.setConnected("storyteller", !!(sts && sts.size > 0));
    }
    if (socket.data.role === "tv" && roomSize("tv") === 0) tvChangedAt = Date.now();
    if (socket.data.role === "tv" || socket.data.role === "storyteller") sendPresence();
  });
});

const timerTick = setInterval(() => {
  const timer = engine.session.timer;
  if (timer && Date.now() >= timer.endsAt) {
    engine.timerEnded();
  }
  if (engine.session.phase === "vote") lighting.tickVoteClock?.();
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
  flushCoalesced();
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

console.log(formatJoinInfo({ host: config.host, port: config.port, pin: config.storytellerPin, scheme }));
{
  const st = lighting.status();
  if (st.backend === "none") console.log("Lights: off (enable WLED in BOTC.bat > Settings, or Hue in config/hue.json)");
  else console.log(`Lights: ${st.backend}${st.live ? " live" : " configured, follow off"}${st.host ? ` ${st.host}` : ""}${st.backend === "wled" || st.backend === "both" ? ` ${st.ledCount} LEDs` : ""}`);
}
if (lighting.isLive()) void lighting.applyScene(sceneForSession(engine.session));

/**
 * Starts the real server (src/index.ts) on a free port with a temp session and checks
 * PIN throttling, malformed socket payloads and static file serving.
 * Run: cd server && npx tsx test/server-security.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { io, type Socket } from "socket.io-client";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(SERVER_DIR, "..");
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
/** Long enough not to appear by chance inside millisecond timestamps in the logs. */
const PIN = "73914826";
const WRONG_PIN = "51627384";

/** GET without URL normalisation (fetch would resolve %2e%2e and ../ before sending). */
function rawGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (d) => (body += String(d)));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

const serverDir = mkdtempSync(join(tmpdir(), "botc-srv-"));
const LOG_DIR = join(serverDir, "logs");

function readGameLog(): string {
  if (!existsSync(LOG_DIR)) return "";
  return readdirSync(LOG_DIR)
    .map((f) => readFileSync(join(LOG_DIR, f), "utf-8"))
    .join("");
}

async function startServer(port: number): Promise<{ child: ChildProcess; output: () => string }> {
  const dir = serverDir;
  let out = "";
  const child = spawn(process.execPath, [TSX_CLI, "src/index.ts"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      BOTC_PORT: String(port),
      BOTC_HOST: "127.0.0.1",
      BOTC_PIN: PIN,
      BOTC_SESSION_PATH: join(dir, "session.json"),
      BOTC_LOG_DIR: LOG_DIR,
      BOTC_CONTROL_TOKEN: "",
      // This test talks plain HTTP even when config/local.json turns HTTPS on.
      BOTC_HTTPS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => (out += String(d)));
  child.stderr!.on("data", (d) => (out += String(d)));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${out}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return { child, output: () => out };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`server did not start:\n${out}`);
}

function connect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(`http://127.0.0.1:${port}`, { reconnection: false, forceNew: true });
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });
}

type AuthResult = { ok: true; pinIsDefault: boolean } | { ok: false; message: string; retryAfterMs: number };

function joinStoryteller(s: Socket, pin: unknown): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const done = (r: AuthResult) => {
      s.off("auth:info", onInfo);
      s.off("auth:error", onErr);
      clearTimeout(timer);
      resolve(r);
    };
    const onInfo = (d: { pinIsDefault: boolean }) => done({ ok: true, pinIsDefault: d.pinIsDefault });
    const onErr = (d: { message: string; retryAfterMs: number }) => done({ ok: false, ...d });
    const timer = setTimeout(() => reject(new Error("no auth reply")), 3000);
    s.on("auth:info", onInfo);
    s.on("auth:error", onErr);
    s.emit("join", { role: "storyteller", pin });
  });
}

type AsyncCase = { name: string; run: () => Promise<string | null> };

const port = await freePort();
const { child, output } = await startServer(port);
const base = `http://127.0.0.1:${port}`;
const sockets: Socket[] = [];
async function sock(): Promise<Socket> {
  const s = await connect(port);
  sockets.push(s);
  return s;
}

const webDist = join(ROOT, "web", "dist");
const hasWeb = existsSync(join(webDist, "index.html"));

const cases: AsyncCase[] = [
  {
    name: "Malformed join payloads don't crash the server",
    run: async () => {
      const s = await sock();
      for (const p of [null, undefined, 42, "storyteller", [], { role: null }]) s.emit("join", p);
      s.emit("game:refresh", null);
      await new Promise((r) => setTimeout(r, 500));
      if (child.exitCode !== null) return `server exited:\n${output()}`;
      const r = await fetch(`${base}/api/health`);
      return r.ok ? null : `health ${r.status}`;
    },
  },
  {
    name: "Game actions are refused without the PIN",
    run: async () => {
      const s = await sock();
      const err = await new Promise<string>((resolve) => {
        s.once("auth:error", (d: { message: string }) => resolve(d.message));
        s.emit("game:reset", {});
      });
      return err.includes("auth required") ? null : err;
    },
  },
  {
    name: "Game log: accepted and rejected actions recorded, Storyteller-only, no PIN in the file",
    run: async () => {
      const tv = await sock();
      const tvGotLog: unknown[] = [];
      tv.on("log:entry", (e) => tvGotLog.push(e));
      tv.emit("join", { role: "tv" });
      const st = await sock();
      const auth = await joinStoryteller(st, PIN);
      if (!auth.ok) return `ST join failed: ${JSON.stringify(auth)}`;
      const stGot: { action?: string; outcome: string }[] = [];
      st.on("log:entry", (e) => stGot.push(e));
      const act = (event: string, data: unknown) =>
        new Promise<unknown>((resolve) => st.emit(event, data, (r: unknown) => resolve(r)));
      await act("game:setPlayerCount", { count: 6 });
      const refused = (await act("game:startNomination", { nominatorId: "p1", nomineeId: "p2" })) as { ok: boolean };
      if (refused.ok) return "nomination in the lobby was accepted";
      await act("game:refresh", {});
      await new Promise((r) => setTimeout(r, 300));
      const recent = (await new Promise((resolve) => st.emit("log:recent", { limit: 50 }, resolve))) as {
        ok: boolean;
        entries: { kind: string; action?: string; outcome: string; reason?: string; text: string }[];
      };
      if (!recent.ok) return "log:recent refused for the Storyteller";
      const set = recent.entries.find((e) => e.action === "game:setPlayerCount");
      const nom = recent.entries.find((e) => e.action === "game:startNomination");
      if (set?.outcome !== "ok") return `setPlayerCount: ${JSON.stringify(set)}`;
      if (nom?.outcome !== "rejected" || !nom.reason) return `startNomination: ${JSON.stringify(nom)}`;
      if (recent.entries.some((e) => e.kind === "action" && e.action === "game:refresh")) return "refresh was logged";
      if (!stGot.some((e) => e.action === "game:startNomination")) return "no live log:entry to the Storyteller";
      if (tvGotLog.length) return `TV received ${tvGotLog.length} log entries`;
      const tvAsk = (await new Promise((resolve) => tv.emit("log:recent", {}, resolve))) as { ok: boolean };
      if (tvAsk.ok) return "TV could read the log";
      const file = readGameLog();
      if (!file.includes('"action":"game:startNomination"') || !file.includes('"outcome":"rejected"')) {
        return "rejection not in the log file";
      }
      if (file.includes(PIN)) return "PIN written to the game log";
      return null;
    },
  },
  {
    name: "Presence: the Storyteller sees the TV join and leave; unauthenticated actions get an error ack",
    run: async () => {
      const st = await sock();
      const seen: { tv: number }[] = [];
      st.on("presence", (p: { tv: number }) => seen.push(p));
      if (!(await joinStoryteller(st, PIN)).ok) return "ST join failed";
      await new Promise((r) => setTimeout(r, 200));
      const base = seen.at(-1)?.tv ?? -1;
      const tv = await sock();
      tv.emit("join", { role: "tv" });
      await new Promise((r) => setTimeout(r, 300));
      if ((seen.at(-1)?.tv ?? -1) !== base + 1) return `after TV join: ${JSON.stringify(seen.at(-1))} (base ${base})`;
      const ack = (await new Promise((resolve) => tv.emit("game:reset", {}, resolve))) as { ok: boolean };
      if (ack.ok !== false) return `TV game:reset ack ${JSON.stringify(ack)}`;
      tv.disconnect();
      await new Promise((r) => setTimeout(r, 300));
      if ((seen.at(-1)?.tv ?? -1) !== base) return `after TV leave: ${JSON.stringify(seen.at(-1))}`;
      return null;
    },
  },
  {
    name: "Deal + undo over the socket: preview, apply, undo restores, reset clears the history, TV never sees it",
    run: async () => {
      const st = await sock();
      const undoStates: { count: number; last: { label: string } | null }[] = [];
      st.on("undo:state", (u) => undoStates.push(u));
      if (!(await joinStoryteller(st, PIN)).ok) return "ST join failed";
      const tv = await sock();
      const tvUndo: unknown[] = [];
      tv.on("undo:state", (u) => tvUndo.push(u));
      tv.emit("join", { role: "tv" });
      const act = (event: string, data: unknown) =>
        new Promise<Record<string, unknown>>((resolve) => st.emit(event, data, (r: Record<string, unknown>) => resolve(r)));
      const lastState = () =>
        new Promise<{ players: { id: string; characterId: string | null; reminders: string[] }[]; phase: string }>((resolve) => {
          st.once("state:storyteller", resolve);
          st.emit("game:refresh", {});
        });

      await act("game:reset", {});
      await act("game:setPlayerCount", { count: 7 });
      const preview = (await act("game:previewDeal", { include: ["baron", "drunk"] })) as {
        ok: boolean;
        deal: { seats: { playerId: string; characterId: string }[]; counts: { outsider: number } };
      };
      if (!preview.ok || preview.deal.seats.length !== 7) return `preview: ${JSON.stringify(preview)}`;
      if (preview.deal.counts.outsider !== 2) return `7 players + Baron should have 2 Outsiders: ${JSON.stringify(preview.deal.counts)}`;
      const unchanged = await lastState();
      if (unchanged.players.some((p) => p.characterId)) return "preview changed the grimoire";

      const bad = await act("game:applyDeal", { deal: { ...preview.deal, bluffs: [] } });
      if (bad.ok !== false || !String(bad.message).includes("three bluffs")) return `bad deal: ${JSON.stringify(bad)}`;
      const applied = await act("game:applyDeal", { deal: preview.deal });
      if (applied.ok !== true) return `apply: ${JSON.stringify(applied)}`;
      const dealt = await lastState();
      const want = new Map(preview.deal.seats.map((s) => [s.playerId, s.characterId]));
      if (dealt.players.some((p) => want.get(p.id) !== p.characterId)) return "applied characters differ from the preview";
      if (undoStates.at(-1)?.last?.label !== "Deal characters") return `undo label ${JSON.stringify(undoStates.at(-1))}`;

      const undone = await act("game:undo", {});
      if (undone.ok !== true) return `undo: ${JSON.stringify(undone)}`;
      const back = await lastState();
      if (back.players.some((p) => p.characterId)) return "undo did not clear the deal";
      if (back.players.length !== 7) return `undo went too far: ${back.players.length} players`;

      await act("game:reset", {});
      await new Promise((r) => setTimeout(r, 200));
      if (undoStates.at(-1)?.count !== 0) return `after reset undo count ${undoStates.at(-1)?.count}`;
      const none = await act("game:undo", {});
      if (none.ok !== false) return `undo after reset: ${JSON.stringify(none)}`;
      if (tvUndo.length) return "TV received undo state";
      tv.disconnect();
      return null;
    },
  },
  {
    name: "Wrong PINs are throttled; the right PIN is refused during the lock-out",
    run: async () => {
      const s = await sock();
      let last: AuthResult | null = null;
      for (let i = 0; i < 5; i++) last = await joinStoryteller(s, WRONG_PIN);
      if (!last || last.ok || last.retryAfterMs <= 0) return `5th wrong PIN not throttled: ${JSON.stringify(last)}`;
      const s2 = await sock();
      const blocked = await joinStoryteller(s2, PIN);
      if (blocked.ok) return "right PIN accepted from a locked-out client (new socket, same IP)";
      if (!/Try again in \d+ s/.test(blocked.message)) return `message: ${blocked.message}`;
      if (!/storyteller PIN refused/.test(output())) return "refusal not logged";
      const leak = output().split("\n").find((l) => l.includes(WRONG_PIN));
      if (leak) return `typed PIN leaked into the server log: ${leak}`;
      const game = readGameLog();
      if (game.includes(WRONG_PIN)) return "typed PIN leaked into the game log";
      if (!/"kind":"auth","action":"storyteller:join","outcome":"rejected","reason":"locked out/.test(game)) {
        return "lock-out not in the game log";
      }
      return null;
    },
  },
  {
    name: "Static files: SPA routes, hashed assets, plates with ?v=, custom audio, API 404",
    run: async () => {
      if (!hasWeb) return null;
      const asset = readdirSync(join(webDist, "assets")).find((f) => f.endsWith(".js"));
      const checks: [string, number, string?][] = [
        ["/", 200, "text/html"],
        ["/tv", 200, "text/html"],
        ["/storyteller", 200, "text/html"],
        [`/assets/${asset}`, 200, "javascript"],
        ["/tv/plates.json?v=123", 200, "json"],
        ["/api/nope", 404],
        ["/assets/missing.js", 404],
        ["/custom-audio/README.txt", 200],
      ];
      for (const [path, status, type] of checks) {
        const r = await fetch(`${base}${path}`);
        await r.text();
        if (r.status !== status) return `${path}: ${r.status} (wanted ${status})`;
        if (type && !(r.headers.get("content-type") ?? "").includes(type)) {
          return `${path}: content-type ${r.headers.get("content-type")}`;
        }
      }
      for (const path of [
        "/custom-audio/../../config/default.json",
        "/custom-audio/..%2f..%2fconfig%2fdefault.json",
        "/custom-audio/%2e%2e/%2e%2e/config/default.json",
        "/custom-audio/..%5c..%5cconfig%5cdefault.json",
        "/assets/..%2f..%2f..%2fconfig%2fdefault.json",
        "/..%2fconfig%2fdefault.json",
      ]) {
        const r = await rawGet(port, path);
        if (r.body.includes("storytellerPin")) return `${path}: served config/default.json (${r.status})`;
        if (r.status === 200 && !r.body.includes("<!doctype html") && !r.body.includes("<!DOCTYPE html")) {
          return `${path}: 200 with unexpected body`;
        }
      }
      return null;
    },
  },
];

let passed = 0;
for (const c of cases) {
  let err: string | null;
  try {
    err = await c.run();
  } catch (ex) {
    err = `threw ${(ex as Error).stack ?? ex}`;
  }
  if (err) console.log(`FAIL  ${c.name}\n      ${err}`);
  else {
    passed++;
    console.log(`PASS  ${c.name}`);
  }
}
for (const s of sockets) s.disconnect();
child.kill();
console.log(`\n${passed}/${cases.length} passed${hasWeb ? "" : " (static checks skipped: web/dist not built)"}`);
process.exit(passed === cases.length ? 0 : 1);

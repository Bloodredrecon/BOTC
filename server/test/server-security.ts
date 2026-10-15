/**
 * Starts the real server (src/index.ts) on a free port with a temp session and checks
 * PIN throttling, malformed socket payloads and static file serving.
 * Run: cd server && npx tsx test/server-security.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { io, type Socket } from "socket.io-client";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(SERVER_DIR, "..");
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const PIN = "8642";
const WRONG_PIN = "97531";

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

async function startServer(port: number): Promise<{ child: ChildProcess; output: () => string }> {
  const dir = mkdtempSync(join(tmpdir(), "botc-srv-"));
  let out = "";
  const child = spawn(process.execPath, [TSX_CLI, "src/index.ts"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      BOTC_PORT: String(port),
      BOTC_HOST: "127.0.0.1",
      BOTC_PIN: PIN,
      BOTC_SESSION_PATH: join(dir, "session.json"),
      BOTC_CONTROL_TOKEN: "",
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

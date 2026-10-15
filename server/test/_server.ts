/**
 * Starts the real server (src/index.ts) on a free port with a temp session and log folder,
 * and gives socket.io clients that record every event they receive.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { io, type Socket } from "socket.io-client";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const TSX_CLI = join(SERVER_DIR, "..", "node_modules", "tsx", "dist", "cli.mjs");

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

export type TestServer = {
  port: number;
  base: string;
  dir: string;
  child: ChildProcess;
  output: () => string;
  stop: () => void;
};

export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "botc-srv-"));
  let out = "";
  const child = spawn(process.execPath, [TSX_CLI, "src/index.ts"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      BOTC_PORT: String(port),
      BOTC_HOST: "127.0.0.1",
      BOTC_SESSION_PATH: join(dir, "session.json"),
      BOTC_LOG_DIR: join(dir, "logs"),
      BOTC_CONTROL_TOKEN: "",
      BOTC_PHONES: "",
      // "0", not "": config/local.json may turn HTTPS on for real games.
      BOTC_HTTPS: "0",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => (out += String(d)));
  child.stderr!.on("data", (d) => (out += String(d)));
  const secure = env.BOTC_HTTPS === "1";
  const base = `${secure ? "https" : "http"}://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${out}`);
    try {
      // Startup only: the HTTPS tests check the certificate itself separately.
      const ok = secure ? (await httpsGet(`${base}/api/health`, { rejectUnauthorized: false })).status === 200 : (await fetch(`${base}/api/health`)).ok;
      if (ok) return { port, base, dir, child, output: () => out, stop: () => child.kill() };
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  child.kill();
  throw new Error(`server did not start:\n${out}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET over HTTPS with explicit TLS options (`ca` to trust one certificate, or `rejectUnauthorized`). */
export function httpsGet(
  url: string,
  tls: { ca?: string; rejectUnauthorized?: boolean },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: "GET", ...tls, timeout: 4000 }, (res) => {
      let body = "";
      res.on("data", (d) => (body += String(d)));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

/** A client that keeps every event it receives (name + payload) for leak checks. */
export type Rec = { socket: Socket; events: { event: string; data: unknown }[]; label: string };

export function client(port: number, label: string, opts: { userAgent?: string; ca?: string } = {}): Promise<Rec> {
  return new Promise((resolve, reject) => {
    const socket = io(`${opts.ca ? "https" : "http"}://127.0.0.1:${port}`, {
      reconnection: false,
      forceNew: true,
      transports: ["websocket"],
      extraHeaders: opts.userAgent ? { "user-agent": opts.userAgent } : undefined,
      ...(opts.ca ? { ca: opts.ca } : {}),
    });
    const rec: Rec = { socket, events: [], label };
    socket.onAny((event, data) => rec.events.push({ event, data }));
    socket.once("connect", () => resolve(rec));
    socket.once("connect_error", reject);
  });
}

export function ask<T = Record<string, unknown>>(r: Rec, event: string, data: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${r.label}: no ack for ${event}`)), 4000);
    r.socket.emit(event, data, (res: T) => {
      clearTimeout(t);
      resolve(res);
    });
  });
}

export function last<T = Record<string, unknown>>(r: Rec, event: string): T | undefined {
  for (let i = r.events.length - 1; i >= 0; i--) if (r.events[i]!.event === event) return r.events[i]!.data as T;
  return undefined;
}

export function count(r: Rec, event: string): number {
  return r.events.filter((e) => e.event === event).length;
}

/** Wait until `pred` holds (polling), or fail with `what`. */
export async function until(pred: () => boolean, what: string, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export async function storyteller(port: number, pin: string, opts: { ca?: string } = {}): Promise<Rec> {
  const st = await client(port, "storyteller", opts);
  st.socket.emit("join", { role: "storyteller", pin });
  await until(() => count(st, "state:storyteller") > 0 || count(st, "auth:error") > 0, "storyteller join");
  if (count(st, "auth:error")) throw new Error(`ST join refused: ${JSON.stringify(last(st, "auth:error"))}`);
  return st;
}

export type AsyncCase = { name: string; run: () => Promise<string | null> };

export async function runAsyncCases(cases: AsyncCase[], cleanup: () => void) {
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
  cleanup();
  console.log(`\n${passed}/${cases.length} passed`);
  process.exit(passed === cases.length ? 0 : 1);
}

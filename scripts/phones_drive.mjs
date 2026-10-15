// Headless multi-client check for player phones: node scripts/phones_drive.mjs <phase>
// Starts the built server (server/dist) on a spare port with a temp session (data/session.json and
// port 3847 are never touched), drives Storyteller / TV / phones in system Edge via playwright-core,
// saves screenshots to docs/tv-design/_verify/phones/phase-<n>/ (gitignored) and stops the server.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright-core";
import { io } from "socket.io-client";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PHASE = Number(process.argv[2] ?? 1);
const OUT = join(ROOT, "docs", "tv-design", "_verify", "phones", `phase-${PHASE}`);
const PIN = "8642";
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("  ", ...a);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(port, dir) {
  const child = spawn(process.execPath, [join(ROOT, "server", "dist", "index.js")], {
    cwd: join(ROOT, "server"),
    env: {
      ...process.env,
      BOTC_PORT: String(port),
      BOTC_HOST: "127.0.0.1",
      BOTC_PIN: PIN,
      BOTC_SESSION_PATH: join(dir, "session.json"),
      BOTC_LOG_DIR: join(dir, "logs"),
      BOTC_CONTROL_TOKEN: "",
      BOTC_PHONES: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return child;
    } catch {}
    if (child.exitCode !== null) throw new Error(out);
    await sleep(250);
  }
  child.kill();
  throw new Error(`server did not start\n${out}`);
}

/** Storyteller over a socket: act(event, data) resolves with the ack; st() is the latest state. */
function storyteller(base) {
  return new Promise((resolve, reject) => {
    const socket = io(base, { transports: ["websocket"] });
    let state = null;
    socket.on("state:storyteller", (s) => (state = s));
    socket.on("connect", () => socket.emit("join", { role: "storyteller", pin: PIN }));
    socket.on("auth:error", (e) => reject(new Error(e.message)));
    const wait = setInterval(() => {
      if (state) {
        clearInterval(wait);
        resolve({
          socket,
          st: () => state,
          act: (event, data = {}) => new Promise((res) => socket.emit(event, data, res)),
        });
      }
    }, 50);
  });
}

async function until(pred, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return;
    await sleep(100);
  }
  throw new Error(`timed out: ${what}`);
}

const shots = [];
async function shot(page, name) {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push(file);
  log("screenshot", file);
}

const NAMES = ["Ada", "Bram", "Cora", "Dmitri", "Elspeth", "Fenwick", "Gwen"];
const ROLES = ["washerwoman", "empath", "fortuneteller", "drunk", "monk", "poisoner", "imp"];

async function phase1({ base, browser, st }) {
  const iphone = await browser.newContext({ ...devices["iPhone 13"] });
  const pixel = await browser.newContext({ ...devices["Pixel 7"] });
  const a = await iphone.newPage();
  const b = await pixel.newPage();
  await a.goto(`${base}/play`);
  await b.goto(`${base}/play`);
  await a.getByText("Player phones are off for this game").waitFor();
  await b.getByText("Player phones are off for this game").waitFor();
  await shot(a, "01-off-iphone");
  await shot(b, "01-off-pixel");

  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });
  const stPage = await tablet.newPage();
  await stPage.goto(`${base}/storyteller`);
  await stPage.getByPlaceholder("PIN").fill(PIN);
  await stPage.getByRole("button", { name: "Unlock grimoire" }).click();
  const panel = stPage.locator(".panel", { has: stPage.getByRole("heading", { name: "Player phones" }) });
  await panel.waitFor();
  await panel.scrollIntoViewIfNeeded();
  await shot(stPage, "02-storyteller-setting-off");
  await panel.getByRole("button", { name: "Turn player phones on" }).click();
  await until(() => st.st().phones.enabled, "phones on");
  await panel.getByText("Join code").waitFor();
  await shot(stPage, "03-storyteller-setting-on");
  await a.getByText("Player phones are on").waitFor();
  await shot(a, "04-on-iphone");
  stPage.once("dialog", (d) => d.accept());
  await panel.getByRole("button", { name: /Player phones: on/ }).click();
  await a.getByText("Player phones are off for this game").waitFor();
  log("phone flipped back to 'off' when the Storyteller switched phones off");
  await Promise.all([iphone.close(), pixel.close(), tablet.close()]);
}

const PHASES = { 1: phase1 };

const port = await freePort();
const dir = mkdtempSync(join(tmpdir(), "botc-phones-drive-"));
const base = `http://127.0.0.1:${port}`;
let server;
let browser;
let st;
let failed = false;
try {
  server = await startServer(port, dir);
  log(`server on ${base} (temp session in ${dir})`);
  st = await storyteller(base);
  await st.act("game:setPlayerCount", { count: NAMES.length });
  for (let i = 0; i < NAMES.length; i++) {
    await st.act("game:updatePlayer", { playerId: `p${i + 1}`, patch: { name: NAMES[i], characterId: ROLES[i] } });
  }
  await st.act("game:updatePlayer", { playerId: "p4", patch: { thinksCharacterId: "chef" } });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (let p = 1; p <= PHASE; p++) {
    if (p !== PHASE && !process.argv.includes("--all")) continue;
    log(`phase ${p}`);
    await PHASES[p]({ base, browser, st, port });
  }
  console.log(`\nOK: ${shots.length} screenshots in ${OUT}`);
} catch (err) {
  failed = true;
  console.error(`\nFAILED: ${err.stack ?? err}`);
} finally {
  await browser?.close();
  st?.socket.disconnect();
  server?.kill();
  await sleep(300);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}
process.exit(failed ? 1 : 0);

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
// A legal 7-player bag with the Baron (T3/O2/M1/D1): Dmitri is the Drunk who thinks he is the Chef.
const ROLES = ["washerwoman", "empath", "fortuneteller", "drunk", "saint", "baron", "imp"];

async function holdCard(page, name) {
  const card = page.locator(".play-reveal-card");
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await card.and(page.locator(".shown")).waitFor();
  const text = await card.innerText();
  await shot(page, name);
  await page.mouse.up();
  await card.and(page.locator(":not(.shown)")).waitFor();
  return text;
}

async function phonePage(browser, device) {
  const ctx = await browser.newContext({ ...devices[device] });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function phase2({ base, browser, st }) {
  await st.act("game:setPhones", { on: true });
  await until(() => st.st().phones.enabled, "phones on");
  const code = st.st().phones.joinCode;
  const ctxs = [];

  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  ctxs.push(tvCtx);
  const tv = await tvCtx.newPage();
  tv.on("dialog", (d) => d.accept());
  await tv.goto(`${base}/tv?motion=off`);
  await tv.getByRole("button", { name: "Enable sound" }).click();
  try {
    await tv.locator(".sound-gate").waitFor({ state: "detached", timeout: 3000 });
  } catch {
    await tv.addStyleTag({ content: ".sound-gate{display:none!important}" });
  }
  await tv.locator(".tv-join-qr svg").waitFor();
  await sleep(1200);
  await shot(tv, "01-tv-lobby-qr");

  // Ada (iPhone): arrives by the QR link, so the code is pre-filled and the seat list appears at once.
  const ada = await phonePage(browser, "iPhone 13");
  ctxs.push(ada.ctx);
  await ada.page.goto(`${base}/play?c=${code}`);
  await ada.page.getByText("Which seat is yours?").waitFor();
  await shot(ada.page, "02-iphone-seat-list");
  await ada.page.getByRole("button", { name: /Ada/ }).click();
  await ada.page.getByText("Is this you?").waitFor();
  await shot(ada.page, "03-iphone-confirm");
  await ada.page.getByRole("button", { name: "Yes, that's me" }).click();
  await ada.page.getByText("Waiting for the Storyteller").waitFor();
  await shot(ada.page, "04-iphone-pending");

  // Dmitri (Pixel, the Drunk) types the code by hand.
  const dmitri = await phonePage(browser, "Pixel 7");
  ctxs.push(dmitri.ctx);
  await dmitri.page.goto(`${base}/play`);
  await dmitri.page.getByLabel("Join code").fill(code.toLowerCase());
  await dmitri.page.getByRole("button", { name: "Find my seat" }).click();
  await dmitri.page.getByRole("button", { name: /Dmitri/ }).click();
  await dmitri.page.getByRole("button", { name: "Yes, that's me" }).click();
  await dmitri.page.getByText("Waiting for the Storyteller").waitFor();

  // Fenwick (iPhone, the Baron).
  const fen = await phonePage(browser, "iPhone 13");
  ctxs.push(fen.ctx);
  await fen.page.goto(`${base}/play?c=${code}`);
  await fen.page.getByRole("button", { name: /Fenwick/ }).click();
  await fen.page.getByRole("button", { name: "Yes, that's me" }).click();
  await fen.page.getByText("Waiting for the Storyteller").waitFor();

  // Storyteller (tablet): the pending banner sits above the tabs; approve Ada there.
  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });
  ctxs.push(tablet);
  const stPage = await tablet.newPage();
  await stPage.goto(`${base}/storyteller`);
  await stPage.getByPlaceholder("PIN").fill(PIN);
  await stPage.getByRole("button", { name: "Unlock grimoire" }).click();
  const banner = stPage.locator(".phone-pending");
  await banner.getByText("Ada").waitFor();
  await shot(stPage, "05-storyteller-pending-banner");
  await banner.locator("li", { hasText: "Ada" }).getByRole("button", { name: "Approve" }).click();
  await ada.page.getByRole("button", { name: "Character" }).waitFor();
  for (const pid of ["p4", "p6"]) {
    const c = st.st().phones.claims.find((x) => x.playerId === pid && x.status === "pending");
    await st.act("game:phoneApprove", { claimId: c.id });
  }
  await dmitri.page.getByRole("button", { name: "Character" }).waitFor();
  await fen.page.getByRole("button", { name: "Character" }).waitFor();
  await ada.page.getByText("hasn't sent characters").waitFor();
  await shot(ada.page, "06-iphone-before-distribute");

  // Distribute from the device panel.
  await stPage.getByRole("button", { name: "Setup" }).click();
  const panel = stPage.locator(".panel", { has: stPage.getByRole("heading", { name: "Player phones" }) });
  await panel.getByRole("button", { name: "Send characters to phones" }).click();
  await until(() => st.st().phones.private.p1?.revealedCharacterId === "washerwoman", "distributed");
  await panel.getByText("Phone shows: Washerwoman").waitFor();
  await panel.scrollIntoViewIfNeeded();
  await shot(stPage, "07-storyteller-device-panel");

  await ada.page.getByText("New").waitFor();
  await shot(ada.page, "08-iphone-card-hidden");
  const adaCard = await holdCard(ada.page, "09-iphone-card-held");
  if (!/Washerwoman/i.test(adaCard) || !/You are good/i.test(adaCard)) throw new Error(`Ada card: ${adaCard}`);
  const drunkCard = await holdCard(dmitri.page, "10-pixel-drunk-sees-chef");
  if (!/Chef/i.test(drunkCard) || /Drunk/i.test(drunkCard)) throw new Error(`Drunk card: ${drunkCard}`);
  const baronCard = await holdCard(fen.page, "11-iphone-baron-evil");
  if (!/Baron/i.test(baronCard) || !/You are evil/i.test(baronCard)) throw new Error(`Baron card: ${baronCard}`);
  log("cards: Ada = Washerwoman (good), Dmitri (Drunk) = Chef, Fenwick = Baron (evil)");

  // A grimoire fix does not reach the phone until Re-send.
  await st.act("game:updatePlayer", { playerId: "p1", patch: { characterId: "investigator" } });
  await panel.getByText("Grimoire now says Investigator").waitFor();
  await panel.locator(".phone-seat", { has: stPage.locator(".phone-seat-head", { hasText: /^1\W+Ada/ }) }).scrollIntoViewIfNeeded();
  await shot(stPage, "12-storyteller-stale-card");
  if (!/Washerwoman/i.test(await holdCard(ada.page, "13-iphone-still-old-card"))) throw new Error("grimoire edit leaked live");
  await panel.locator(".phone-seat", { has: stPage.locator(".phone-seat-head", { hasText: /^1\W+Ada/ }) }).getByRole("button", { name: "Re-send character" }).click();
  await ada.page.getByText("Your card changed").waitFor();
  await shot(ada.page, "14-iphone-card-changed");
  if (!/Investigator/i.test(await holdCard(ada.page, "15-iphone-new-card"))) throw new Error("re-send did not arrive");

  // Spectator.
  const watcher = await phonePage(browser, "Pixel 7");
  ctxs.push(watcher.ctx);
  await watcher.page.goto(`${base}/play`);
  await watcher.page.getByRole("button", { name: "Just watch" }).click();
  await watcher.page.getByText("Watching").waitFor();
  await watcher.page.getByText("The town").waitFor();
  await shot(watcher.page, "16-pixel-spectator");

  // Night: dark screen. Ada dies overnight; her phone says so only after the dawn announcement.
  await st.act("game:startFirstNight");
  await ada.page.locator(".play-night").waitFor();
  await shot(ada.page, "17-iphone-night");
  await st.act("game:goDawn");
  await st.act("game:setDawnDeaths", { playerIds: ["p1"] });
  await sleep(500);
  if (await ada.page.getByText("You are dead").count()) throw new Error("death shown before the dawn announcement");
  await st.act("game:announceDawnThenDay");
  await ada.page.getByText("You are dead").waitFor();
  await shot(ada.page, "18-iphone-dead");
  await fen.page.getByRole("button", { name: "Town" }).click();
  await fen.page.locator(".play-seats li.dead", { hasText: "Ada" }).waitFor();
  await shot(fen.page, "19-iphone-town");
  await until(() => st.st().phase === "day", "server reaches day", 30000);
  try {
    await tv.locator(".tv-join-badge").waitFor({ timeout: 8000 });
  } catch (e) {
    const probe = await tv.evaluate(() => ({
      cls: document.querySelector(".tv")?.className,
      badge: !!document.querySelector(".tv-join-badge"),
      hero: document.querySelector(".tv-hero")?.textContent,
    }));
    log("TV probe", JSON.stringify(probe), "server phase", st.st().phase, "phoneJoin code", st.st().phones.joinCode);
    throw e;
  }
  await sleep(1500);
  await shot(tv, "20-tv-day-badge");
  log("night screen, dead banner only after dawn announcement, town tab, TV day badge");

  await Promise.all(ctxs.map((c) => c.close()));
}

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
  await a.getByText("Join the game").waitFor();
  await shot(a, "04-on-iphone");
  stPage.once("dialog", (d) => d.accept());
  await panel.getByRole("button", { name: /Player phones: on/ }).click();
  await a.getByText("Player phones are off for this game").waitFor();
  log("phone flipped back to 'off' when the Storyteller switched phones off");
  await Promise.all([iphone.close(), pixel.close(), tablet.close()]);
}

const PHASES = { 1: phase1, 2: phase2 };

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

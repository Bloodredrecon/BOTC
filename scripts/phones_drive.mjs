// Headless multi-client check for player phones: node scripts/phones_drive.mjs <phase>
// Starts the built server (server/dist) on a spare port with a temp session (data/session.json and
// port 3847 are never touched), drives Storyteller / TV / phones in system Edge via playwright-core,
// saves screenshots to docs/tv-design/_verify/phones/phase-<n>/ (gitignored) and stops the server.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpsRequest } from "node:https";
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
// Phase 5 runs the server over HTTPS with a throwaway certificate in the temp folder.
const SECURE = PHASE === 5;
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

/** GET over HTTPS that accepts the server's own self-signed certificate (test only). */
function insecureGet(url) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { rejectUnauthorized: false }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
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
      BOTC_HTTPS: SECURE ? "1" : "0",
      BOTC_TLS_DIR: join(dir, "tls"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  for (let i = 0; i < 120; i++) {
    try {
      const ok = SECURE
        ? (await insecureGet(`https://127.0.0.1:${port}/api/health`)).status === 200
        : (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
      if (ok) return child;
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
    const socket = io(base, { transports: ["websocket"], rejectUnauthorized: false });
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
  const ctx = await browser.newContext({ ...devices[device], ignoreHTTPSErrors: SECURE });
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
  await ada.page.getByRole("button", { name: "Card", exact: true }).waitFor();
  for (const pid of ["p4", "p6"]) {
    const c = st.st().phones.claims.find((x) => x.playerId === pid && x.status === "pending");
    await st.act("game:phoneApprove", { claimId: c.id });
  }
  await dmitri.page.getByRole("button", { name: "Card", exact: true }).waitFor();
  await fen.page.getByRole("button", { name: "Card", exact: true }).waitFor();
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

/** A phone joins by the QR link and the Storyteller approves it over the socket. */
async function joinAndApprove(browser, device, base, st, name, playerId) {
  const p = await phonePage(browser, device);
  await p.page.goto(`${base}/play?c=${st.st().phones.joinCode}`);
  await p.page.getByRole("button", { name: new RegExp(name) }).click();
  await p.page.getByRole("button", { name: "Yes, that's me" }).click();
  await p.page.getByText("Waiting for the Storyteller").waitFor();
  await until(() => st.st().phones.claims.some((c) => c.playerId === playerId && c.status === "pending"), `${name} pending`);
  const c = st.st().phones.claims.find((x) => x.playerId === playerId && x.status === "pending");
  await st.act("game:phoneApprove", { claimId: c.id });
  await p.page.getByRole("button", { name: "Card", exact: true }).waitFor();
  return p;
}

async function phase3({ base, browser, st }) {
  await st.act("game:setPhones", { on: true });
  const ctxs = [];
  const ada = await joinAndApprove(browser, "iPhone 13", base, st, "Ada", "p1");
  const fen = await joinAndApprove(browser, "Pixel 7", base, st, "Fenwick", "p6");
  ctxs.push(ada.ctx, fen.ctx);
  const dist = await st.act("game:phoneDistribute");
  if (!dist.ok) throw new Error(`distribute ${JSON.stringify(dist)}`);
  await st.act("game:startFirstNight");
  await st.act("game:goDawn");
  await st.act("game:finishDawn");
  await until(() => st.st().phase === "day", "day 1");

  // Ada's notes: a claim, an alignment guess, a line of text and the free pad.
  const a = ada.page;
  await a.getByRole("button", { name: "Notes", exact: true }).click();
  await a.getByLabel("Bram claims").selectOption({ label: "Chef" });
  const bramAlign = a.getByRole("button", { name: /Alignment guess for Bram/ });
  await bramAlign.click();
  await bramAlign.click();
  await a.getByLabel("Notes on Bram").fill("Claimed Chef with a 1, a bit quick");
  await a.getByLabel("Cora claims").selectOption({ label: "Fortune Teller" });
  await a.getByRole("button", { name: /Alignment guess for Cora/ }).click();
  await a.locator(".play-pad textarea").fill("Fenwick and Gwen sat together all night. Ask Cora about her pings.");

  // A public nomination and vote: the notes pick up who nominated and who raised a hand.
  await st.act("game:goDusk");
  await st.act("game:openNominations");
  const nom = await st.act("game:startNomination", { nominatorId: "p1", nomineeId: "p2" });
  if (!nom.ok) throw new Error(`nomination ${JSON.stringify(nom)}`);
  await st.act("game:startVote", { seconds: 30 });
  for (const v of ["p1", "p3", "p6", "p7"]) await st.act("game:toggleVote", { playerId: v });
  await st.act("game:resolveVote");
  await a.getByText("D1: nominated by Ada").waitFor();
  await a.getByText("D1: voted for Bram").first().waitFor();
  await a.locator(".play-note", { hasText: "Bram" }).first().scrollIntoViewIfNeeded();
  await a.evaluate(() => window.scrollTo(0, 0));
  await shot(a, "01-iphone-notes-grid");
  await a.locator(".play-pad").scrollIntoViewIfNeeded();
  await shot(a, "02-iphone-notes-pad");

  // Reload: notes come back from this phone's storage.
  await a.reload();
  await a.getByRole("button", { name: "Notes", exact: true }).click();
  const kept = await a.getByLabel("Notes on Bram").inputValue();
  if (kept !== "Claimed Chef with a 1, a bit quick") throw new Error(`notes after reload: ${kept}`);
  if ((await a.getByLabel("Bram claims").inputValue()) !== "chef") throw new Error("claim lost on reload");
  log("notes survive a reload; facts: nominated / voted");

  // Export from Ada, import on another phone.
  const [download] = await Promise.all([a.waitForEvent("download"), a.getByRole("button", { name: "Save a copy" }).click()]);
  const file = join(OUT, "ada-notes-export.json");
  await download.saveAs(file);
  const exported = JSON.parse(readFileSync(file, "utf8"));
  if (exported.kind !== "botc-notes" || exported.seats.p2?.claim !== "chef") throw new Error("export content");
  const f = fen.page;
  await f.getByRole("button", { name: "Notes", exact: true }).click();
  await f.locator('input[type="file"]').setInputFiles(file);
  await f.getByText("Notes loaded.").waitFor();
  if ((await f.getByLabel("Notes on Bram").inputValue()) !== "Claimed Chef with a 1, a bit quick") throw new Error("import did not load");
  log("export from one phone, import on another");

  // Messages: Ada asks a question, Fenwick asks for a word.
  await a.getByRole("button", { name: /^Ask/ }).click();
  await a.getByPlaceholder(/Monk/).fill("If the Monk protects me, does the Slayer still kill me?");
  await a.getByRole("button", { name: "Send", exact: true }).click();
  await a.getByText("Sent to the Storyteller.").waitFor();
  await f.getByRole("button", { name: /^Ask/ }).click();
  await f.getByRole("button", { name: "Request a word with the Storyteller" }).click();
  await f.getByText("The Storyteller knows you'd like a word.").waitFor();
  await shot(f, "03-pixel-request-word");

  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });
  ctxs.push(tablet);
  const stPage = await tablet.newPage();
  await stPage.goto(`${base}/storyteller`);
  await stPage.getByPlaceholder("PIN").fill(PIN);
  await stPage.getByRole("button", { name: "Unlock grimoire" }).click();
  const inbox = stPage.locator(".inbox-banner");
  await inbox.getByText("would like a word").waitFor();
  await shot(stPage, "04-storyteller-inbox");
  await a.getByRole("button", { name: "Card", exact: true }).click();
  const adaThread = inbox.locator(".inbox-thread", { hasText: "Slayer" });
  await adaThread.getByLabel(/Reply to Ada/).fill("No: the Monk only protects from the Demon at night.");
  await adaThread.getByRole("button", { name: "Reply" }).click();
  await inbox.locator(".inbox-thread", { hasText: "Fenwick" }).getByRole("button", { name: "Mark read" }).click();
  await inbox.waitFor({ state: "detached" });
  await a.locator(".play-tab-badge").waitFor();
  await shot(a, "05-iphone-reply-badge");
  await a.getByRole("button", { name: /^Ask/ }).click();
  await a.getByText("No: the Monk only protects").waitFor();
  const bubble = await a.locator(".play-thread li.from-st").last().evaluate((li) => li.getBoundingClientRect().height);
  if (bubble > 160) throw new Error(`reply bubble is ${bubble}px tall`);
  await a.locator(".play-thread li.from-st").last().scrollIntoViewIfNeeded();
  await shot(a, "06-iphone-thread");
  if (await a.locator(".play-tab-badge").count()) throw new Error("badge stayed after reading");
  log("question + word request → Storyteller inbox → reply on the phone with a badge; inbox clears");

  await Promise.all(ctxs.map((c) => c.close()));
}

async function phase4({ base, browser, st }) {
  await st.act("game:setPhones", { on: true });
  const ctxs = [];
  const ada = await joinAndApprove(browser, "iPhone 13", base, st, "Ada", "p1");
  const cora = await joinAndApprove(browser, "Pixel 7", base, st, "Cora", "p3");
  const els = await joinAndApprove(browser, "iPhone 13", base, st, "Elspeth", "p5");
  ctxs.push(ada.ctx, cora.ctx, els.ctx);
  await st.act("game:phoneDistribute");
  await st.act("game:startFirstNight");
  await st.act("game:goDawn");
  await st.act("game:finishDawn");
  await until(() => st.st().phase === "day", "day 1");
  // Elspeth dies by day (public at once): her phone votes with her ghost vote.
  await st.act("game:updatePlayer", { playerId: "p5", patch: { alive: false } });

  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  ctxs.push(tvCtx);
  const tv = await tvCtx.newPage();
  await tv.goto(`${base}/tv?motion=off`);
  await tv.getByRole("button", { name: "Enable sound" }).click();
  try {
    await tv.locator(".sound-gate").waitFor({ state: "detached", timeout: 3000 });
  } catch {
    await tv.addStyleTag({ content: ".sound-gate{display:none!important}" });
  }
  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });
  ctxs.push(tablet);
  const stPage = await tablet.newPage();
  stPage.on("dialog", (d) => d.accept());
  await stPage.goto(`${base}/storyteller`);
  await stPage.getByPlaceholder("PIN").fill(PIN);
  await stPage.getByRole("button", { name: "Unlock grimoire" }).click();
  await stPage.locator(".tabs").getByRole("button", { name: "Votes", exact: true }).click();

  // Fenwick nominates Gwen: the hand goes Ada, Bram, Cora, Dmitri, Elspeth, Fenwick, then Gwen.
  await st.act("game:goDusk");
  await st.act("game:openNominations");
  const nom = await st.act("game:startNomination", { nominatorId: "p6", nomineeId: "p7" });
  if (!nom.ok) throw new Error(`nomination ${JSON.stringify(nom)}`);
  const a = ada.page;
  const c = cora.page;
  const e = els.page;
  await a.getByText("The vote opens soon").waitFor();
  await st.act("game:phoneSweepSpeed", { ms: 3000 });
  await st.act("game:startVote", { seconds: 60 });
  await a.getByRole("button", { name: /Raise my hand/ }).waitFor();
  await shot(a, "01-iphone-vote-open");
  await a.getByRole("button", { name: /Raise my hand/ }).click();
  await a.locator('.play-hand[aria-pressed="true"]').waitFor();
  await shot(a, "02-iphone-hand-up");
  await c.getByRole("button", { name: /Raise my hand/ }).click();
  await e.getByText("Raising your hand uses your ghost vote.").waitFor();
  await e.getByRole("button", { name: /Raise my hand/ }).click();
  await e.locator('.play-hand[aria-pressed="true"]').waitFor();
  await shot(e, "03-iphone-ghost-hand");
  await until(() => st.st().nomination?.phoneVote?.handsUp.length === 3, "3 phone hands");
  if (st.st().nomination.votesFor.length) throw new Error("phone hands counted before the clock hand");
  // Bram has no phone: the Storyteller taps his real hand.
  await stPage.locator(".chip-row button", { hasText: /^Bram/ }).click();
  await until(() => st.st().nomination.votesFor.includes("p2"), "Bram tapped");
  await tv.locator(".tv-stud.hand").nth(2).waitFor();
  if ((await tv.locator(".tv-stud.hand").count()) !== 3) throw new Error("TV hand glows");
  await sleep(1200);
  await shot(tv, "04-tv-hands-glow");
  await tv.locator(".tv-vote-ring").screenshot({ path: join(OUT, "04b-tv-ring-closeup.png") });
  shots.push(join(OUT, "04b-tv-ring-closeup.png"));
  await stPage.locator(".phone-count").scrollIntoViewIfNeeded();
  await shot(stPage, "05-storyteller-phone-count");
  log("3 phone hands glow on the TV, none counted; Bram (no phone) tapped by the Storyteller");

  await stPage.getByRole("button", { name: "Start the count" }).click();
  await until(() => st.st().nomination?.phoneVote?.sweep?.index === 1, "Ada locked", 6000);
  await a.getByText("Locked — your vote counts.").waitFor();
  await shot(a, "06-iphone-locked");
  await c.getByText("The clock hand reaches you in 1 seat.").waitFor();
  await shot(c, "07-pixel-countdown");
  await tv.locator(".tv-vote-hand").waitFor();
  await sleep(1400);
  await shot(tv, "08-tv-clock-hand");
  await tv.locator(".tv-vote-ring").screenshot({ path: join(OUT, "08b-tv-ring-closeup.png") });
  shots.push(join(OUT, "08b-tv-ring-closeup.png"));
  await stPage.getByRole("button", { name: "Pause", exact: true }).click();
  await stPage.getByRole("button", { name: "Back one seat" }).click();
  await until(() => {
    const sw = st.st().nomination?.phoneVote?.sweep;
    return sw?.paused && sw.index <= 1 && !st.st().nomination.votesFor.includes("p1");
  }, "back unlocked Ada");
  if (st.st().nomination.phoneVote.sweep.index !== 0) {
    await stPage.getByRole("button", { name: "Back one seat" }).click();
    await until(() => st.st().nomination.phoneVote.sweep.index === 0, "back to Ada");
  }
  await a.getByRole("button", { name: /Hand up/ }).click();
  await a.locator('.play-hand[aria-pressed="false"]').waitFor();
  log("Pause + Back: Ada unlocked and lowered her hand");
  await st.act("game:phoneSweepSpeed", { ms: 500 });
  await stPage.getByRole("button", { name: "Resume count" }).click();
  await until(() => st.st().nomination?.phoneVote?.sweep?.index === 7, "count finished", 10000);
  const counted = [...st.st().nomination.votesFor].sort().join(",");
  if (counted !== "p2,p3,p5") throw new Error(`counted ${counted}`);
  await a.getByText("Locked — no vote.").waitFor();
  await sleep(1200);
  await shot(tv, "09-tv-count-done");
  log("count finished: Bram (by hand), Cora and Elspeth's ghost vote; Ada's lowered hand stayed out");
  await st.act("game:resolveVote");

  // A second vote, and the Storyteller switches phone voting off mid-count.
  const nom2 = await st.act("game:startNomination", { nominatorId: "p1", nomineeId: "p4" });
  if (!nom2.ok) throw new Error(`nomination 2 ${JSON.stringify(nom2)}`);
  await st.act("game:phoneSweepSpeed", { ms: 3000 });
  await st.act("game:startVote", { seconds: 60 });
  await a.getByRole("button", { name: /Raise my hand/ }).click();
  await until(() => st.st().nomination?.phoneVote?.handsUp.includes("p1"), "Ada up (2nd vote)");
  // Order after Dmitri: Elspeth, Fenwick, Gwen, Ada, … — skip ahead by making the hand fast, then slow.
  await st.act("game:phoneSweepSpeed", { ms: 500 });
  await stPage.getByRole("button", { name: "Start the count" }).click();
  await until(() => (st.st().nomination?.phoneVote?.sweep?.index ?? 0) >= 4, "hand past Ada", 6000);
  await stPage.getByRole("button", { name: "Pause", exact: true }).click();
  if (!st.st().nomination.votesFor.includes("p1")) throw new Error("Ada not counted before switch-off");
  await stPage.locator(".phone-count").getByRole("button", { name: "Phones off for voting" }).click();
  await until(() => st.st().phones.voting === "manual" && !st.st().nomination.phoneVote, "phone voting off");
  if (!st.st().nomination.votesFor.includes("p1")) throw new Error("Ada's counted hand dropped on switch-off");
  await c.getByText("Raise your real hand — the Storyteller is counting this seat.").waitFor();
  await shot(c, "10-pixel-by-hand-after-off");
  await stPage.locator(".phone-count").scrollIntoViewIfNeeded();
  await shot(stPage, "11-storyteller-phones-off-voting");
  log("Phones off for voting mid-count: the count stopped, Ada's locked hand stayed counted, phones say 'raise your real hand'");
  await st.act("game:resolveVote");
  await st.act("game:phoneVoting", { mode: "phones" });

  await Promise.all(ctxs.map((x) => x.close()));
}

const wakeOf = (page) => page.locator("[data-wakelock]").first().getAttribute("data-wakelock");

async function phase5({ base, browser, st }) {
  if (!base.startsWith("https://")) throw new Error(`phase 5 needs HTTPS, got ${base}`);
  const health = JSON.parse((await insecureGet(`${base}/api/health`)).body);
  if (health.scheme !== "https") throw new Error(`health scheme ${health.scheme}`);
  await st.act("game:setPhones", { on: true });
  const ctxs = [];

  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  ctxs.push(tvCtx);
  const tv = await tvCtx.newPage();
  await tv.goto(`${base}/tv?motion=off`);
  await tv.getByRole("button", { name: "Enable sound" }).click();
  try {
    await tv.locator(".sound-gate").waitFor({ state: "detached", timeout: 3000 });
  } catch {
    await tv.addStyleTag({ content: ".sound-gate{display:none!important}" });
  }
  await tv.locator(".tv-join-qr svg").waitFor();
  const tvSecure = await tv.evaluate(() => ({ origin: location.origin, secure: window.isSecureContext }));
  if (!tvSecure.origin.startsWith("https://") || !tvSecure.secure) throw new Error(`TV not on HTTPS: ${JSON.stringify(tvSecure)}`);
  await shot(tv, "01-tv-lobby-https");
  log(`TV lobby over ${tvSecure.origin} (QR encodes ${tvSecure.origin}/play?c=…)`);

  const ada = await joinAndApprove(browser, "iPhone 13", base, st, "Ada", "p1");
  const cora = await joinAndApprove(browser, "Pixel 7", base, st, "Cora", "p3");
  ctxs.push(ada.ctx, cora.ctx);
  await st.act("game:phoneDistribute");
  const support = await ada.page.evaluate(() => ({ secure: window.isSecureContext, api: "wakeLock" in navigator }));
  log(`iPhone context: secure ${support.secure}, wakeLock API ${support.api}`);
  await until(async () => (await wakeOf(ada.page)) === "on", "Ada's screen lock held before the game");
  await ada.page.getByText("Your screen stays on while this page is open by day.").waitFor();
  await shot(ada.page, "02-iphone-wake-on-setup");
  await until(async () => (await wakeOf(cora.page)) === "on", "Cora's screen lock held");
  await shot(cora.page, "03-pixel-wake-on-setup");

  await st.act("game:startFirstNight");
  await until(async () => (await wakeOf(ada.page)) === "off", "lock released at night");
  await shot(ada.page, "04-iphone-night-wake-off");
  log("night: wake lock released (data-wakelock=off)");

  await st.act("game:goDawn");
  await st.act("game:finishDawn");
  await until(() => st.st().phase === "day", "day 1");
  await until(async () => (await wakeOf(ada.page)) === "on", "lock taken again by day");
  await until(async () => (await wakeOf(cora.page)) === "on", "Cora's lock taken again by day");
  await shot(ada.page, "05-iphone-day-wake-on");
  await shot(cora.page, "06-pixel-day-wake-on");
  log("day: wake lock held again on both phones");
  await shot(tv, "07-tv-day-https");

  await Promise.all(ctxs.map((x) => x.close()));
}

const PHASES = { 1: phase1, 2: phase2, 3: phase3, 4: phase4, 5: phase5 };

const port = await freePort();
const dir = mkdtempSync(join(tmpdir(), "botc-phones-drive-"));
const base = `${SECURE ? "https" : "http"}://127.0.0.1:${port}`;
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

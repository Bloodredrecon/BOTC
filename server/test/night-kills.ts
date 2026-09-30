/**
 * Imp night kills on protected / unprotected targets, driven through the real GameEngine.
 * Run: cd server && npx tsx test/night-kills.ts
 * Uses a temp session file so the live data/session.json is never touched.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BOTC_SESSION_PATH = join(mkdtempSync(join(tmpdir(), "botc-kill-")), "session.json");

const { GameEngine } = await import("../src/game.js");
const { createEmptySession, loadScript } = await import("../src/persistence.js");
const { toPublicState } = await import("../src/projection.js");
type Engine = InstanceType<typeof GameEngine>;

const script = loadScript();
const hue = { applyScene: async () => {}, isLive: () => false } as never;

const ROLES = ["soldier", "monk", "imp", "chef", "empath", "poisoner", "mayor"];

/**
 * Night 2 at the Imp's wake. Poisoned / Safe are cleared when a night starts, so `tonight`
 * places them the way the Poisoner / Monk confirms do (applyNightReminder).
 */
function setup(tonight?: (e: Engine) => void): Engine {
  const s = createEmptySession(ROLES.length);
  ROLES.forEach((r, i) => {
    s.players[i].characterId = r;
    s.players[i].name = `${r}#${i + 1}`;
  });
  s.phase = "day";
  s.dayNumber = 1;
  const e = new GameEngine(s, script, hue, () => {});
  e.startNight();
  tonight?.(e);
  const impStep = e.session.night!.steps.findIndex((x) => x.characterId === "imp");
  if (impStep < 0) throw new Error("no Imp wake step");
  e.session.night!.stepIndex = impStep;
  return e;
}

const id = (e: Engine, role: string) => e.session.players.find((p) => p.characterId === role)!.id;
const alive = (e: Engine, pid: string) => e.session.players.find((p) => p.id === pid)!.alive;
const publicAliveOf = (e: Engine, pid: string) =>
  toPublicState(e.session, script).players.find((p) => p.id === pid)!.alive;
const nightDeathLogged = (e: Engine) =>
  toPublicState(e.session, script).publicLog.some((l) => l.type === "night_death");
const mark = (role: string, reminder: string) => (e: Engine) => e.applyNightReminder(id(e, role), reminder);

type Case = { name: string; run: () => string | null };

function failedKill(
  name: string,
  targetRole: string,
  why: RegExp,
  tonight?: (e: Engine) => void,
  after?: (e: Engine) => string | null,
): Case {
  return {
    name,
    run: () => {
      const e = setup(tonight);
      const target = id(e, targetRole);
      const stepBefore = e.session.night!.stepIndex;
      const r = e.otherDeath(target, "Demon");
      if (!r.ok || !r.blocked) return `expected ok+blocked, got ${JSON.stringify(r)}`;
      if (!alive(e, target)) return "target died";
      if (e.session.diedTonightIds.length) return "diedTonightIds not empty";
      const notice = e.session.stNotices.at(-1)?.message ?? "";
      if (!/^Imp chose /.test(notice) || !why.test(notice)) return `ST notice wrong: "${notice}"`;
      const extra = after?.(e);
      if (extra) return extra;
      e.markNightStepDone();
      if (e.session.night!.stepIndex !== stepBefore + 1) return "night step did not advance after confirm";
      e.goDawn();
      e.announceDawnDeaths();
      if (e.session.dawnDeathIds.length) return `dawn announced deaths: ${e.session.dawnDeathIds}`;
      if (nightDeathLogged(e)) return "public night_death logged";
      if (!publicAliveOf(e, target)) return "TV shows target dead";
      return null;
    },
  };
}

function landedKill(name: string, targetRole: string, tonight?: (e: Engine) => void): Case {
  return {
    name,
    run: () => {
      const e = setup(tonight);
      const target = id(e, targetRole);
      const r = e.otherDeath(target, "Demon");
      if (!r.ok || r.blocked) return `expected ok, not blocked, got ${JSON.stringify(r)}`;
      if (alive(e, target)) return "target still alive";
      if (!publicAliveOf(e, target)) return "night death leaked to TV during the night";
      e.goDawn();
      if (!publicAliveOf(e, target)) return "night death leaked to TV before announce";
      e.announceDawnDeaths();
      if (!e.session.dawnDeathIds.includes(target)) return "dawn did not announce the death";
      if (publicAliveOf(e, target)) return "TV still shows target alive after announce";
      return null;
    },
  };
}

const cases: Case[] = [
  failedKill("Imp → Soldier: confirm accepted, nobody dies", "soldier", /Soldier: safe from the Demon/),
  failedKill("Imp → Monk-protected Chef: confirm accepted, nobody dies", "chef", /Protected by the Monk/, mark("chef", "Safe")),
  failedKill("Imp → Monk-protected Imp (self): no death, no star-pass", "imp", /Protected by the Monk/, mark("imp", "Safe")),
  landedKill("Imp → Poisoned Soldier: dies", "soldier", mark("soldier", "Poisoned")),
  landedKill("Imp → Drunk-marked Soldier: dies", "soldier", mark("soldier", "Drunk")),
  landedKill("Imp → Safe Chef but Monk Poisoned: dies", "chef", (e) => {
    mark("chef", "Safe")(e);
    mark("monk", "Poisoned")(e);
  }),
  // Poison only removes the poisoned player's own ability — the Monk's protection still works.
  failedKill("Imp → Safe Chef who is also Poisoned: survives (only the Monk's health matters)", "chef", /Protected by the Monk/, (e) => {
    mark("chef", "Safe")(e);
    mark("chef", "Poisoned")(e);
  }),
  landedKill("Imp → unprotected Chef: dies", "chef"),
  landedKill("Imp → Mayor: kill lands by default (bounce stays Storyteller's call)", "mayor"),
  failedKill(
    "Poisoned Imp → Chef: confirm accepted, nobody dies",
    "chef",
    /chef#4 — Imp \(imp#3\) is poisoned: the kill fails\. Nobody dies\./,
    mark("imp", "Poisoned"),
  ),
  failedKill(
    "Drunk-marked Imp → Chef: confirm accepted, nobody dies",
    "chef",
    /Imp \(imp#3\) is drunk: the kill fails/,
    mark("imp", "Drunk"),
  ),
  failedKill(
    "Poisoned Imp → Soldier: fails, reported as the Imp's poison",
    "soldier",
    /Imp \(imp#3\) is poisoned/,
    mark("imp", "Poisoned"),
  ),
  failedKill(
    "Poisoned Imp self-target: nothing happens (no death, no star-pass)",
    "imp",
    /imp#3 \(self\) — Imp is poisoned: the kill fails\. Nobody dies, no star-pass\./,
    mark("imp", "Poisoned"),
    (e) => {
      const poisoner = e.session.players.find((p) => p.name === "poisoner#6")!;
      if (poisoner.characterId !== "poisoner") return `star-pass happened: Poisoner is now ${poisoner.characterId}`;
      if (poisoner.reminders.includes("Is the Demon")) return "Poisoner marked Is the Demon";
      if (e.session.players.find((p) => p.name === "imp#3")!.characterId !== "imp") return "Imp lost the Imp character";
      return null;
    },
  ),
  landedKill("Healthy Imp → Chef while another player is Poisoned: dies", "chef", mark("empath", "Poisoned")),
  {
    name: "Imp self-kill still star-passes to the Poisoner",
    run: () => {
      const e = setup();
      const imp = id(e, "imp");
      const r = e.otherDeath(imp, "Demon");
      if (!r.ok || r.blocked || alive(e, imp)) return `self-kill failed: ${JSON.stringify(r)}`;
      const poisoner = e.session.players.find((p) => p.name === "poisoner#6")!;
      return poisoner.characterId === "imp" ? null : "Poisoner did not receive star-pass";
    },
  },
];

let failed = 0;
for (const c of cases) {
  let detail: string | null;
  try {
    detail = c.run();
  } catch (err) {
    detail = `THREW ${String(err)}`;
  }
  if (detail) failed += 1;
  console.log(`${detail ? "FAIL" : "PASS"}  ${c.name}${detail ? `\n      ${detail}` : ""}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);

/**
 * End-game scenarios driven through the real GameEngine.
 * Run: cd server && npx tsx test/win-conditions.ts
 * Uses a temp session file so the live data/session.json is never touched.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BOTC_SESSION_PATH = join(mkdtempSync(join(tmpdir(), "botc-win-")), "session.json");

const { GameEngine } = await import("../src/game.js");
const { createEmptySession, loadScript } = await import("../src/persistence.js");
type Session = import("../src/types.js").GameSession;
type Engine = InstanceType<typeof GameEngine>;

const script = loadScript();
const hue = { applyScene: async () => {}, isLive: () => false } as never;

function setup(roles: string[], mutate?: (s: Session) => void): Engine {
  const s = createEmptySession(roles.length);
  roles.forEach((r, i) => {
    s.players[i].characterId = r;
    s.players[i].name = `${r}#${i + 1}`;
  });
  s.phase = "day";
  s.dayNumber = 2;
  mutate?.(s);
  return new GameEngine(s, script, hue, () => {});
}

function pid(e: Engine, role: string, nth = 0): string {
  const p = e.session.players.filter((x) => x.characterId === role)[nth];
  if (!p) throw new Error(`no ${role}`);
  return p.id;
}

function player(e: Engine, id: string) {
  return e.session.players.find((p) => p.id === id)!;
}

/** Go to dusk → Open nominations → nominate. */
function nominate(e: Engine, ...args: Parameters<Engine["startNomination"]>) {
  e.goDusk();
  e.openNominations();
  return e.startNomination(...args);
}

/** Go to dusk → Open nominations → nominate → forced onto the block → Close nominations → Confirm death. */
function execute(e: Engine, nomineeId: string) {
  const nominator = e.session.players.find((p) => p.alive && p.id !== nomineeId)!.id;
  e.goDusk();
  e.openNominations();
  e.startNomination(nominator, nomineeId);
  if (e.session.phase !== "nomination") return;
  e.resolveVote("majority");
  e.endDay();
  e.confirmExecution(true);
}

function nightKill(e: Engine, targetId: string) {
  e.startNight();
  e.otherDeath(targetId, "Demon");
  e.goDawn();
  e.announceDawnDeaths();
}

type Case = {
  name: string;
  expect: "good" | "evil" | null;
  run: () => Engine;
  check?: (e: Engine) => string | null;
};

const cases: Case[] = [
  // ── Demon dies → Good ──
  {
    name: "Imp executed (no Scarlet Woman)",
    expect: "good",
    run: () => {
      const e = setup(["washerwoman", "librarian", "imp", "chef", "empath"]);
      execute(e, pid(e, "imp"));
      return e;
    },
  },
  {
    name: "Imp executed leaving 2 alive → Good (Demon death beats two-alive)",
    expect: "good",
    run: () => {
      const e = setup(["washerwoman", "imp", "chef"]);
      execute(e, pid(e, "imp"));
      return e;
    },
  },
  {
    name: "Imp executed with SW, 5 alive before → SW becomes Imp, game continues",
    expect: null,
    run: () => {
      const e = setup(["washerwoman", "imp", "chef", "scarletwoman", "monk"]);
      execute(e, pid(e, "imp"));
      return e;
    },
    check: (e) => (player(e, "p4").characterId === "imp" ? null : "Scarlet Woman was not promoted"),
  },
  {
    name: "Imp executed with SW, 4 alive before → Good",
    expect: "good",
    run: () => {
      const e = setup(["imp", "chef", "scarletwoman", "monk"]);
      execute(e, pid(e, "imp"));
      return e;
    },
  },
  {
    name: "Imp executed with Poisoned SW, 6 alive → Good",
    expect: "good",
    run: () => {
      const e = setup(["washerwoman", "imp", "chef", "scarletwoman", "monk", "empath"], (s) => {
        s.players[3].reminders = ["Poisoned"];
      });
      execute(e, pid(e, "imp"));
      return e;
    },
  },
  {
    name: "Imp self-kill at night, no Minion → Good at dawn",
    expect: "good",
    run: () => {
      const e = setup(["washerwoman", "librarian", "imp", "chef", "empath"]);
      nightKill(e, pid(e, "imp"));
      return e;
    },
  },
  {
    name: "Imp self-kill, Poisoner alive → star-pass, game continues",
    expect: null,
    run: () => {
      const e = setup(["washerwoman", "poisoner", "imp", "chef", "empath"]);
      nightKill(e, pid(e, "imp"));
      return e;
    },
    check: (e) => (player(e, "p2").characterId === "imp" ? null : "Poisoner did not receive star-pass"),
  },
  {
    name: "Imp self-kill, 5 alive, Baron seated before SW → SW must take star-pass",
    expect: null,
    run: () => {
      const e = setup(["baron", "washerwoman", "imp", "chef", "scarletwoman"]);
      nightKill(e, pid(e, "imp"));
      return e;
    },
    check: (e) =>
      player(e, "p5").characterId === "imp" && player(e, "p1").characterId === "baron"
        ? null
        : "star-pass did not prefer the Scarlet Woman",
  },
  // ── Slayer ──
  {
    name: "Slayer shoots Imp → Good",
    expect: "good",
    run: () => {
      const e = setup(["slayer", "librarian", "imp", "chef", "empath"]);
      e.slayerShot(pid(e, "slayer"), pid(e, "imp"));
      return e;
    },
  },
  {
    name: "Poisoned Slayer shoots Imp → nothing, ability spent",
    expect: null,
    run: () => {
      const e = setup(["slayer", "librarian", "imp", "chef", "empath"], (s) => {
        s.players[0].reminders = ["Poisoned"];
      });
      e.slayerShot(pid(e, "slayer"), pid(e, "imp"));
      return e;
    },
    check: (e) =>
      player(e, "p3").alive && player(e, "p1").abilityUsed ? null : "Imp died or Slayer not spent",
  },
  {
    name: "Non-Slayer (bluff) shoots Imp → nothing",
    expect: null,
    run: () => {
      const e = setup(["chef", "librarian", "imp", "slayer", "empath"]);
      e.slayerShot(pid(e, "chef"), pid(e, "imp"));
      return e;
    },
    check: (e) => (player(e, "p3").alive && !player(e, "p4").abilityUsed ? null : "bluff shot had an effect"),
  },
  {
    name: "Slayer shot already used → nothing",
    expect: null,
    run: () => {
      const e = setup(["slayer", "librarian", "imp", "chef", "empath"], (s) => {
        s.players[0].abilityUsed = true;
      });
      e.slayerShot(pid(e, "slayer"), pid(e, "imp"));
      return e;
    },
    check: (e) => (player(e, "p3").alive ? null : "Imp died to a spent Slayer"),
  },
  {
    name: "Slayer shoots Recluse registering as Demon → Recluse dies, game continues",
    expect: null,
    run: () => {
      const e = setup(["slayer", "recluse", "imp", "chef", "empath"]);
      e.slayerShot(pid(e, "slayer"), pid(e, "recluse"), { recluseRegistersAsDemon: true });
      return e;
    },
    check: (e) => (!player(e, "p2").alive ? null : "Recluse did not die"),
  },
  {
    name: "Slayer shoots Imp with SW, 5 alive → SW becomes Imp, game continues",
    expect: null,
    run: () => {
      const e = setup(["slayer", "scarletwoman", "imp", "chef", "empath"]);
      e.slayerShot(pid(e, "slayer"), pid(e, "imp"));
      return e;
    },
    check: (e) => (player(e, "p2").characterId === "imp" ? null : "SW not promoted"),
  },
  // ── Two alive → Evil ──
  {
    name: "Execution leaves 2 alive with Imp → Evil",
    expect: "evil",
    run: () => {
      const e = setup(["washerwoman", "imp", "chef"]);
      execute(e, pid(e, "chef"));
      return e;
    },
  },
  {
    name: "Night kill leaves 2 alive with Imp → Evil at dawn",
    expect: "evil",
    run: () => {
      const e = setup(["washerwoman", "imp", "chef"]);
      nightKill(e, pid(e, "chef"));
      return e;
    },
  },
  {
    name: "Soldier survives Demon kill at 3 alive → game continues",
    expect: null,
    run: () => {
      const e = setup(["soldier", "imp", "chef"]);
      nightKill(e, pid(e, "soldier"));
      return e;
    },
  },
  {
    name: "Monk-protected player at 3 alive → game continues",
    expect: null,
    run: () => {
      const e = setup(["monk", "imp", "chef"]);
      e.startNight();
      e.applyNightReminder(pid(e, "chef"), "Safe");
      e.otherDeath(pid(e, "chef"), "Demon");
      e.goDawn();
      e.announceDawnDeaths();
      return e;
    },
  },
  {
    name: "Travellers don't count: 2 residents + 1 traveller with Imp → Evil",
    expect: "evil",
    run: () => {
      const e = setup(["washerwoman", "imp", "chef"]);
      e.addTraveller("Guest", script.travellers[0].id);
      execute(e, pid(e, "chef"));
      return e;
    },
  },
  // ── Virgin ──
  {
    name: "Virgin kills Townsfolk nominator, leaving 2 alive → Evil",
    expect: "evil",
    run: () => {
      const e = setup(["virgin", "imp", "chef"]);
      nominate(e, pid(e, "chef"), pid(e, "virgin"));
      return e;
    },
  },
  {
    name: "Drunk nominates Virgin → no execution, Virgin spent",
    expect: null,
    run: () => {
      const e = setup(["virgin", "imp", "chef", "empath", "monk"], (s) => {
        s.players[2].reminders = ["Drunk"];
      });
      nominate(e, pid(e, "chef"), pid(e, "virgin"));
      return e;
    },
    check: (e) =>
      player(e, "p3").alive && player(e, "p1").abilityUsed && e.session.phase === "nomination"
        ? null
        : "Drunk was executed or Virgin not spent",
  },
  {
    name: "Spy nominates Virgin, ST says registers as Townsfolk → Spy executed",
    expect: null,
    run: () => {
      const e = setup(["virgin", "imp", "spy", "empath", "monk"]);
      nominate(e, pid(e, "spy"), pid(e, "virgin"), { spyRegistersAsTownsfolk: true });
      return e;
    },
    check: (e) => (!player(e, "p3").alive && e.session.executedTodayId === "p3" ? null : "Spy not executed"),
  },
  {
    name: "Minion nominates Virgin → no execution, Virgin spent",
    expect: null,
    run: () => {
      const e = setup(["virgin", "imp", "poisoner", "empath", "monk"]);
      nominate(e, pid(e, "poisoner"), pid(e, "virgin"));
      return e;
    },
    check: (e) => (player(e, "p3").alive && player(e, "p1").abilityUsed ? null : "wrong Virgin handling"),
  },
  {
    name: "Poisoned Virgin → no execution, Virgin spent",
    expect: null,
    run: () => {
      const e = setup(["virgin", "imp", "chef", "empath", "monk"], (s) => {
        s.players[0].reminders = ["Poisoned"];
      });
      nominate(e, pid(e, "chef"), pid(e, "virgin"));
      return e;
    },
    check: (e) => (player(e, "p3").alive && player(e, "p1").abilityUsed ? null : "wrong Virgin handling"),
  },
  // ── Saint ──
  {
    name: "Saint executed → Evil",
    expect: "evil",
    run: () => {
      const e = setup(["saint", "imp", "chef", "empath", "monk"]);
      execute(e, pid(e, "saint"));
      return e;
    },
  },
  {
    name: "Poisoned Saint executed → game continues",
    expect: null,
    run: () => {
      const e = setup(["saint", "imp", "chef", "empath", "monk"], (s) => {
        s.players[0].reminders = ["Poisoned"];
      });
      execute(e, pid(e, "saint"));
      return e;
    },
  },
  {
    name: "Saint killed at night → game continues",
    expect: null,
    run: () => {
      const e = setup(["saint", "imp", "chef", "empath", "monk"]);
      nightKill(e, pid(e, "saint"));
      return e;
    },
  },
  // ── Mayor ──
  {
    name: "Mayor: 3 alive, no execution, dusk → Good",
    expect: "good",
    run: () => {
      const e = setup(["mayor", "imp", "chef"]);
      e.startNight();
      return e;
    },
  },
  {
    name: "Mayor: 3 alive but an execution happened today → no Mayor win",
    expect: null,
    run: () => {
      const e = setup(["mayor", "imp", "chef", "empath"]);
      execute(e, pid(e, "empath"));
      e.startNight();
      return e;
    },
  },
  {
    name: "Mayor: 3 residents + 1 traveller (4 alive) → no Mayor win",
    expect: null,
    run: () => {
      const e = setup(["mayor", "imp", "chef"]);
      e.addTraveller("Guest", script.travellers[0].id);
      e.startNight();
      return e;
    },
  },
  {
    name: "Mayor Poisoned at 3 alive → no Mayor win",
    expect: null,
    run: () => {
      const e = setup(["mayor", "imp", "chef"], (s) => {
        s.players[0].reminders = ["Poisoned"];
      });
      e.startNight();
      return e;
    },
  },
  {
    name: "Mayor dead at 3 alive → no Mayor win",
    expect: null,
    run: () => {
      const e = setup(["mayor", "imp", "chef", "empath"], (s) => {
        s.players[0].alive = false;
      });
      e.startNight();
      return e;
    },
  },
  // ── Safety nets / non-games ──
  {
    name: "No characters assigned → never auto-ends",
    expect: null,
    run: () => {
      const e = setup(["", "", "", "", ""], (s) => s.players.forEach((p) => (p.characterId = null)));
      execute(e, "p1");
      e.startNight();
      return e;
    },
  },
  {
    name: "ST marks Imp dead on grimoire → notice now, Good at dusk",
    expect: "good",
    run: () => {
      const e = setup(["washerwoman", "librarian", "imp", "chef", "empath"]);
      e.updatePlayer(pid(e, "imp"), { alive: false });
      if (e.session.phase === "ended") throw new Error("grimoire edit ended the game immediately");
      if (!e.session.stNotices.some((n) => n.message.startsWith("Win condition met"))) {
        throw new Error("no ST warning after grimoire edit");
      }
      e.startNight();
      return e;
    },
  },
];

let failed = 0;
for (const c of cases) {
  let got: string;
  let detail: string | null = null;
  try {
    const e = c.run();
    const hadGameOverNotice = e.session.stNotices.some((n) => n.message.startsWith("GAME OVER"));
    e.flushPendingWin();
    const s = e.session;
    got = s.phase === "ended" ? `ended:${s.winner}` : `phase=${s.phase}`;
    if (s.phase === "ended" && !s.winReason) detail = "ended without a winReason";
    if (s.phase === "ended" && !hadGameOverNotice) detail = "no GAME OVER notice for the Storyteller";
    if (!detail && c.check) detail = c.check(e);
  } catch (err) {
    got = `THREW ${String(err)}`;
  }
  const want = c.expect ? `ended:${c.expect}` : "not ended";
  const ok = (c.expect ? got === want : !got.startsWith("ended") && !got.startsWith("THREW")) && !detail;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}\n      want ${want}, got ${got}${detail ? ` (${detail})` : ""}`);
}
// Timed: the win cue must wait for the execution line instead of cutting it.
{
  const cues: { at: number; cue: string; phase: string }[] = [];
  const s = createEmptySession(5);
  ["washerwoman", "librarian", "imp", "chef", "empath"].forEach((r, i) => (s.players[i].characterId = r));
  s.phase = "day";
  s.dayNumber = 1;
  const t0 = Date.now();
  const e = new GameEngine(s, script, hue, ({ public: pub }) => {
    if (pub.soundCue) cues.push({ at: Date.now() - t0, cue: pub.soundCue, phase: pub.phase });
  });
  e.goDusk();
  e.openNominations();
  e.startNomination("p1", "p3");
  e.resolveVote("majority");
  e.endDay();
  e.confirmExecution(true);
  const endedEarly = e.session.phase === "ended";
  await new Promise((r) => setTimeout(r, 10_000));
  const exec = cues.find((c) => /execution|death/.test(c.cue));
  const win = cues.find((c) => c.phase === "ended");
  const ok =
    !endedEarly &&
    !!exec &&
    !!win &&
    /good_wins|atm_after_good/.test(win.cue) &&
    win.at - exec.at >= 9000 &&
    e.session.winReason === "The Demon is dead.";
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  Timed: execution cue plays in full before the win cue\n      ${cues
      .map((c) => `${c.at}ms ${c.cue} (${c.phase})`)
      .join(" → ")}`,
  );
}

const total = cases.length + 1;
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);

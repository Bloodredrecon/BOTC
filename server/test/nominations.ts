/**
 * Dusk (nominations open), the hub, on-the-block and end of day, driven through the real GameEngine.
 * Run: cd server && npx tsx test/nominations.ts
 * Uses a temp session file so the live data/session.json is never touched.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BOTC_SESSION_PATH = join(mkdtempSync(join(tmpdir(), "botc-nom-")), "session.json");

const { GameEngine } = await import("../src/game.js");
const { createEmptySession, loadScript, loadSession, SESSION_PATH } = await import("../src/persistence.js");
const { nominationRules } = await import("../src/nominations.js");
type Session = import("../src/types.js").GameSession;
type Engine = InstanceType<typeof GameEngine>;
type Cue = { cue: string; phase: string };

const script = loadScript();
const hue = { applyScene: async () => {}, isLive: () => false } as never;

function setup(roles: string[], mutate?: (s: Session) => void): { e: Engine; cues: Cue[] } {
  const s = createEmptySession(roles.length);
  roles.forEach((r, i) => {
    s.players[i].characterId = r;
    s.players[i].name = `${r}#${i + 1}`;
  });
  // Default: dusk with nominations open; cases about earlier steps pass `day` / `duskClosed`.
  s.phase = "dusk";
  s.nominationsOpen = true;
  s.dayNumber = 2;
  mutate?.(s);
  const cues: Cue[] = [];
  const e = new GameEngine(s, script, hue, ({ public: pub }) => {
    if (pub.soundCue) cues.push({ cue: pub.soundCue, phase: pub.phase });
  });
  return { e, cues };
}

const TOWN = ["washerwoman", "librarian", "imp", "chef", "empath", "monk", "soldier"];

function vote(e: Engine, nominator: string, nominee: string, voters: string[]) {
  const r = e.startNomination(nominator, nominee);
  if (!r.ok) throw new Error(`nomination refused: ${r.message}`);
  e.startVote(30);
  for (const v of voters) e.toggleVote(v);
  e.resolveVote();
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const baseName = (cue: string) => cue.replace(/^custom:/, "").replace(/\.[^.]+$/, "");
const isDuskCue = (c: Cue) => /^dusk(_[a-z])?$/.test(baseName(c.cue));
const isNightCue = (c: Cue) => /^night(_[a-z])?$/.test(baseName(c.cue));
const day = (s: Session) => {
  s.phase = "day";
  s.nominationsOpen = false;
};
const duskClosed = (s: Session) => {
  s.phase = "dusk";
  s.nominationsOpen = false;
};
/** Day → Go to dusk → Open nominations. */
function openUp(e: Engine) {
  e.goDusk();
  const r = e.openNominations();
  if (!r.ok) throw new Error(`open nominations refused: ${r.message}`);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = (e: Engine, type: string) => e.session.publicLog.filter((l) => l.type === type).length;

type Case = { name: string; run: () => void | Promise<void> };

const cases: Case[] = [
  // ── Day → Dusk → Open nominations ──
  {
    name: "Plain day blocks nominations with a reason (ST sees it in the rules)",
    run: () => {
      const { e } = setup(TOWN, day);
      const rules = nominationRules(e.session);
      assert(rules.closedReason === null && /dusk/i.test(rules.notOpenReason ?? ""), `rules ${JSON.stringify(rules)}`);
      const r = e.startNomination("p1", "p2");
      assert(!r.ok && /dusk/i.test(r.message ?? ""), `day nomination allowed: ${JSON.stringify(r)}`);
      assert(e.session.phase === "day" && e.session.nominationsToday.length === 0, "state changed");
      assert(e.session.stNotices.some((n) => /Nomination not opened/.test(n.message)), "no ST notice");
      assert(!e.openNominations().ok && e.session.phase === "day", "opened nominations straight from day");
    },
  },
  {
    name: "Go to dusk is the announcement only: dusk cue, one 'dusk' line, nominations still blocked",
    run: () => {
      const { e, cues } = setup(TOWN, day);
      assert(e.goDusk().ok && e.session.phase === "dusk" && !e.session.nominationsOpen, `phase ${e.session.phase}`);
      assert(isDuskCue(cues.at(-1)!), `cue ${cues.at(-1)?.cue}`);
      e.goDusk();
      assert(count(e, "dusk") === 1 && cues.filter(isDuskCue).length === 1, "dusk repeated");
      assert(/Open nominations/.test(nominationRules(e.session).notOpenReason ?? ""), "no reason at dusk before opening");
      const r = e.startNomination("p1", "p2");
      assert(!r.ok && /Open nominations/.test(r.message ?? ""), `nomination before opening: ${JSON.stringify(r)}`);
    },
  },
  {
    name: "Open nominations: one 'nominations open' line, then the picker works",
    run: () => {
      const { e } = setup(TOWN, duskClosed);
      assert(e.openNominations().ok && e.session.nominationsOpen && e.session.phase === "dusk", "not opened");
      e.openNominations();
      assert(count(e, "nominations_open") === 1, `${count(e, "nominations_open")} open lines`);
      assert(nominationRules(e.session).notOpenReason === null, "still blocked after opening");
      const r = e.startNomination("p1", "p2");
      assert(r.ok && e.session.phase === "nomination", `refused after opening: ${JSON.stringify(r)}`);
    },
  },
  {
    name: "Storyteller override can nominate at dusk before Open nominations",
    run: () => {
      const { e } = setup(TOWN, duskClosed);
      assert(e.startNomination("p1", "p2", { override: true }).ok, "override refused");
      e.resolveVote();
      assert(e.session.phase === "dusk" && !e.session.nominationsOpen, `after vote ${e.session.phase}`);
    },
  },
  {
    name: "Not guilty (below majority) → straight back to nominations open",
    run: () => {
      const { e } = setup(TOWN, day);
      openUp(e);
      vote(e, "p1", "p3", ["p1", "p2"]);
      assert(e.session.phase === "dusk" && e.session.nominationsOpen && e.session.block === null, `phase ${e.session.phase}`);
      assert(e.startNomination("p2", "p4").ok, "next nomination refused");
    },
  },
  {
    name: "Guilty → on the block, nominations continue; a higher vote replaces the holder",
    run: () => {
      const { e } = setup(TOWN, day);
      openUp(e);
      vote(e, "p1", "p3", ["p1", "p2", "p4", "p5"]);
      assert(e.session.block?.nomineeId === "p3" && e.session.nominationsOpen && e.session.phase === "dusk", "not on block");
      assert(e.session.players[2].alive, "executed immediately");
      vote(e, "p2", "p4", ["p1", "p2", "p3", "p5", "p6"]);
      assert(e.session.block?.nomineeId === "p4" && e.session.block.votes === 5, `block ${JSON.stringify(e.session.block)}`);
    },
  },
  {
    name: "Storyteller override opens a nomination in plain day; the vote hands back to day",
    run: () => {
      const { e } = setup(TOWN, day);
      const r = e.startNomination("p1", "p2", { override: true });
      assert(r.ok && e.session.phase === "nomination", "override refused");
      assert(e.session.nominationsToday.at(-1)?.override === true, "override not recorded");
      e.resolveVote();
      assert(e.session.phase === "day", `after vote ${e.session.phase}`);
    },
  },
  // ── Nominate-once rules (at dusk) ──
  {
    name: "Each player may nominate once per day (second try refused with a reason)",
    run: () => {
      const { e } = setup(TOWN);
      vote(e, "p1", "p2", []);
      const r = e.startNomination("p1", "p4");
      assert(!r.ok && /already nominated/i.test(r.message ?? ""), `second nomination allowed: ${JSON.stringify(r)}`);
      assert(e.session.phase === "dusk", `phase ${e.session.phase}`);
      assert(e.session.stNotices.some((n) => /Nomination not opened/.test(n.message)), "no ST notice");
    },
  },
  {
    name: "Each player may be nominated once per day",
    run: () => {
      const { e } = setup(TOWN);
      vote(e, "p1", "p2", []);
      const r = e.startNomination("p3", "p2");
      assert(!r.ok && /already nominated/i.test(r.message ?? ""), `renomination allowed: ${JSON.stringify(r)}`);
    },
  },
  {
    name: "Dead players cannot nominate but can be nominated",
    run: () => {
      const { e } = setup(TOWN, (s) => {
        s.players[0].alive = false;
      });
      const r = e.startNomination("p1", "p2");
      assert(!r.ok && /dead/i.test(r.message ?? ""), `dead nominator allowed: ${JSON.stringify(r)}`);
      const r2 = e.startNomination("p2", "p1");
      assert(r2.ok && e.session.phase === "nomination", "dead nominee refused");
    },
  },
  {
    name: "Storyteller override bypasses limits and is recorded",
    run: () => {
      const { e } = setup(TOWN);
      vote(e, "p1", "p2", []);
      const r = e.startNomination("p1", "p2", { override: true });
      assert(r.ok && e.session.phase === "nomination", "override refused");
      assert(e.session.nominationsToday.at(-1)?.override === true, "override not recorded");
      assert(e.session.stNotices.some((n) => /Storyteller override/.test(n.message)), "no override notice");
    },
  },
  // ── The block ──
  {
    name: "Majority (≥ half the living) puts the nominee on the block; nobody dies yet",
    run: () => {
      const { e } = setup(TOWN); // 7 alive → need 4
      vote(e, "p1", "p3", ["p1", "p2", "p4", "p5"]);
      assert(e.session.block?.nomineeId === "p3" && e.session.block.votes === 4, `block ${JSON.stringify(e.session.block)}`);
      assert(e.session.phase === "dusk" && e.session.players[2].alive, "executed immediately");
      assert(e.session.nominationsToday[0].outcome === "majority", "record outcome");
    },
  },
  {
    name: "Tie with the block holder clears the block; a higher count then takes it",
    run: () => {
      const { e } = setup(TOWN);
      vote(e, "p1", "p3", ["p1", "p2", "p4", "p5"]);
      vote(e, "p2", "p4", ["p1", "p2", "p3", "p5"]);
      assert(e.session.block?.nomineeId === null && e.session.block.votes === 4, `after tie ${JSON.stringify(e.session.block)}`);
      assert(e.session.nominationsToday[1].outcome === "tie", "tie outcome");
      vote(e, "p4", "p5", ["p1", "p2", "p3", "p4"]);
      assert(e.session.block?.nomineeId === null, "matching the tied count must not take the block");
      vote(e, "p5", "p6", ["p1", "p2", "p3", "p4", "p5"]);
      assert(e.session.block?.nomineeId === "p6" && e.session.block.votes === 5, `after beat ${JSON.stringify(e.session.block)}`);
    },
  },
  {
    name: "Majority but fewer votes than the block holder → outvoted, block unchanged",
    run: () => {
      const { e } = setup(TOWN);
      vote(e, "p1", "p3", ["p1", "p2", "p4", "p5", "p6"]);
      vote(e, "p2", "p4", ["p1", "p2", "p3", "p5"]);
      assert(e.session.block?.nomineeId === "p3" && e.session.block.votes === 5, "block changed");
      assert(e.session.nominationsToday[1].outcome === "outvoted", "outcome");
      const log = e.session.publicLog.at(-1);
      assert(log?.type === "vote_result" && log.outcome === "outvoted", "vote_result outcome");
    },
  },
  {
    name: "Failed nomination returns to the dusk hub (phase dusk, recorded, block untouched)",
    run: () => {
      const { e } = setup(TOWN);
      vote(e, "p1", "p3", ["p1"]);
      assert(e.session.phase === "dusk" && e.session.nomination === null, `phase ${e.session.phase}`);
      assert(e.session.block === null, "block set by a failed vote");
      const rec = e.session.nominationsToday[0];
      assert(rec.outcome === "no_majority" && rec.votes === 1 && rec.majority === 4, `record ${JSON.stringify(rec)}`);
    },
  },
  // ── End of day ──
  {
    name: "End of day executes the block holder, then night after the execution line (no second dusk)",
    run: async () => {
      const { e, cues } = setup(TOWN, day);
      openUp(e);
      vote(e, "p1", "p4", ["p1", "p2", "p3", "p5"]);
      e.endDay();
      assert(e.session.phase === "execution" && e.session.executionPendingId === "p4", `phase ${e.session.phase}`);
      assert(/^about_to_die/.test(baseName(cues.at(-1)!.cue)), `cue ${cues.at(-1)?.cue}`);
      e.confirmExecution(true);
      assert(e.session.phase === "dusk" && e.session.nightPending && !e.session.players[3].alive, "not executed");
      assert(!e.session.nominationsOpen, "nominations still open after closing");
      assert(e.session.executedTodayId === "p4", "executedTodayId");
      assert(/^(execution|death)/.test(baseName(cues.at(-1)!.cue)), `exec cue ${cues.at(-1)?.cue}`);
      assert(!e.startNomination("p2", "p5").ok, "nominations still open after the execution");
      await wait(10_000);
      assert(e.session.phase === "night", `after hold: ${e.session.phase}`);
      assert(isNightCue(cues.at(-1)!), `night cue: ${cues.map((c) => c.cue).join(", ")}`);
      assert(cues.filter(isDuskCue).length === 1, `dusk cues: ${cues.map((c) => c.cue).join(", ")}`);
      assert(count(e, "no_execution") === 0 && count(e, "dusk") === 1, "chronicle lines");
    },
  },
  {
    name: "End of day with nobody on the block → night now, one 'No execution today' line",
    run: () => {
      const { e, cues } = setup(TOWN, day);
      openUp(e);
      vote(e, "p1", "p3", ["p1"]);
      e.endDay();
      assert(e.session.phase === "night" && e.session.players.every((p) => p.alive), `phase ${e.session.phase}`);
      assert(!e.session.nominationsOpen, "nominations still open at night");
      assert(
        count(e, "no_execution") === 1 && count(e, "dusk") === 1 && count(e, "nominations_open") === 1,
        "chronicle lines",
      );
      assert(isNightCue(cues.at(-1)!), `night cue from dusk was ${cues.at(-1)?.cue}`);
    },
  },
  {
    name: "End of day with a tied (empty) block executes nobody",
    run: () => {
      const { e } = setup(TOWN);
      vote(e, "p1", "p3", ["p1", "p2", "p4", "p5"]);
      vote(e, "p2", "p4", ["p1", "p2", "p3", "p5"]);
      e.endDay();
      assert(e.session.phase === "night" && e.session.players.every((p) => p.alive), "someone died on a tie");
    },
  },
  {
    name: "Start night now during the post-execution hold starts exactly one night",
    run: async () => {
      const { e, cues } = setup(TOWN);
      vote(e, "p1", "p4", ["p1", "p2", "p3", "p5"]);
      e.endDay();
      e.confirmExecution(false);
      assert(e.session.phase === "dusk" && e.session.nightPending, "not holding");
      e.endDay();
      assert(e.session.phase === "night", `phase ${e.session.phase}`);
      await wait(10_000);
      assert(cues.filter(isNightCue).length === 1, `night cues: ${cues.map((c) => c.cue).join(", ")}`);
    },
  },
  {
    name: "Skip to night from plain day (no dusk) still works and notes no execution",
    run: () => {
      const { e, cues } = setup(TOWN, day);
      e.startNight();
      assert(e.session.phase === "night", `phase ${e.session.phase}`);
      assert(count(e, "no_execution") === 1 && count(e, "dusk") === 0, "chronicle lines");
      assert(/^(night|dusk)(_[a-z])?$/.test(baseName(cues.at(-1)!.cue)), `cue ${cues.at(-1)?.cue}`);
    },
  },
  {
    name: "End of day / Go to dusk are refused (with a notice) while a nomination is open",
    run: () => {
      const { e } = setup(TOWN);
      e.startNomination("p1", "p2");
      const r = e.endDay();
      assert(!r.ok && e.session.phase === "nomination", "end of day allowed mid-nomination");
      assert(e.session.stNotices.some((n) => /open nomination/.test(n.message)), "no notice");
      const d = setup(TOWN, day).e;
      d.startNomination("p1", "p2", { override: true });
      assert(!d.goDusk().ok && d.session.phase === "nomination", "dusk allowed mid-nomination");
    },
  },
  // ── Hub housekeeping ──
  {
    name: "Cancel nomination frees both players, removes its chronicle line, back to dusk",
    run: () => {
      const { e } = setup(TOWN);
      e.startNomination("p1", "p2");
      e.cancelNomination();
      assert(e.session.phase === "dusk" && e.session.nominationsOpen, `phase ${e.session.phase}`);
      assert(e.session.nominationsToday.length === 0, "record kept");
      assert(!e.session.publicLog.some((l) => l.type === "nomination"), "log line kept");
      assert(e.startNomination("p1", "p2").ok, "players still used up");
    },
  },
  {
    name: "Repeated Open nomination taps don't duplicate the chronicle line",
    run: () => {
      const { e } = setup(TOWN);
      e.startNomination("p1", "p2");
      e.startNomination("p1", "p2");
      e.startNomination("p1", "p2");
      assert(count(e, "nomination") === 1, `${count(e, "nomination")} nomination lines`);
    },
  },
  {
    name: "Votes don't emit sound cues (vote audio is TV-side only)",
    run: () => {
      const { e, cues } = setup(TOWN);
      e.startNomination("p1", "p2");
      e.startVote(30);
      const before = cues.length;
      for (const v of ["p1", "p3", "p4", "p5", "p6"]) e.toggleVote(v);
      e.toggleVote("p6");
      assert(cues.length === before, `toggleVote emitted ${cues.slice(before).map((c) => c.cue).join(", ")}`);
    },
  },
  // ── Abilities and wins ──
  {
    name: "Virgin: Townsfolk nominator executed at dusk; end of day then goes straight to night",
    run: () => {
      const { e } = setup(["virgin", "chef", "imp", "empath", "monk", "soldier", "librarian"]);
      e.startNomination("p2", "p1");
      assert(!e.session.players[1].alive && e.session.nominationsToday[0]?.outcome === "virgin", "virgin not recorded");
      assert(e.session.phase === "dusk", `phase ${e.session.phase}`);
      const r = e.startNomination("p4", "p3");
      assert(!r.ok && /already executed/.test(r.message ?? ""), `nomination after Virgin execution: ${JSON.stringify(r)}`);
      e.endDay();
      assert(e.session.phase === "night" && count(e, "no_execution") === 0, `phase ${e.session.phase}`);
    },
  },
  {
    name: "Mayor: 3 alive, nobody on the block → Good wins at the end of the day",
    run: () => {
      const { e } = setup(["mayor", "imp", "chef"]);
      e.endDay();
      e.flushPendingWin();
      assert(e.session.phase === "ended" && e.session.winner === "good", `phase ${e.session.phase}`);
    },
  },
  {
    name: "Saint on the block executed at the end of the day → Evil",
    run: () => {
      const { e } = setup(["saint", "imp", "chef", "empath", "monk"]);
      vote(e, "p3", "p1", ["p2", "p3", "p4"]);
      e.endDay();
      e.confirmExecution(true);
      e.flushPendingWin();
      assert(e.session.phase === "ended" && e.session.winner === "evil", `phase ${e.session.phase}`);
    },
  },
  // ── Day rollover / persistence ──
  {
    name: "New day resets nominations and the block (and waits for dusk again)",
    run: () => {
      const { e } = setup(TOWN);
      vote(e, "p1", "p3", ["p1", "p2", "p4", "p5"]);
      e.endDay();
      e.confirmExecution(false);
      e.startNight();
      e.goDawn();
      e.finishDawn();
      assert(e.session.phase === "day" && e.session.dayNumber === 3, `phase ${e.session.phase}`);
      assert(e.session.nominationsToday.length === 0 && e.session.block === null, "not reset");
      assert(!e.session.nominationsOpen, "nominations still open on the new day");
      assert(!e.startNomination("p1", "p3").ok, "day 3 nomination allowed before dusk");
      e.goDusk();
      assert(!e.startNomination("p1", "p3").ok, "day 3 nomination allowed before Open nominations");
      e.openNominations();
      assert(e.startNomination("p1", "p3").ok, "yesterday's nominator still blocked");
    },
  },
  {
    name: "Mid-dusk restart keeps today's nominations, the block and 'open' (autosave)",
    run: () => {
      const { e } = setup(TOWN);
      vote(e, "p1", "p3", ["p1", "p2", "p4", "p5"]);
      const loaded = loadSession();
      assert(loaded.phase === "dusk" && loaded.nominationsOpen, `phase ${loaded.phase} open ${loaded.nominationsOpen}`);
      assert(loaded.nominationsToday.length === 1 && loaded.block?.nomineeId === "p3", "lost on reload");
    },
  },
  {
    name: "Old-format session (5 unnamed players, old dusk, duskPending key) loads and runs the new flow",
    run: () => {
      // Shape of data/session.json written by the pre-update build at 21:07 (old dusk, no new keys).
      const old: Record<string, unknown> = { ...createEmptySession(5), phase: "dusk", dayNumber: 1, duskPending: false };
      delete old.nightPending;
      delete old.nominationsOpen;
      old.publicLog = [{ type: "no_execution", dayNumber: 1, at: 1790626059373 }];
      writeFileSync(SESSION_PATH, JSON.stringify(old));
      const loaded = loadSession();
      assert(!("duskPending" in loaded) && loaded.nightPending === false && loaded.nominationsOpen === false, "keys not migrated");
      const e = new GameEngine(loaded, script, hue, () => {});
      assert(/Open nominations/.test(nominationRules(e.session).notOpenReason ?? ""), "no reason before opening");
      assert(e.openNominations().ok, "open refused");
      vote(e, "p1", "p2", ["p1", "p3", "p4"]);
      assert(e.session.block?.nomineeId === "p2" && e.session.phase === "dusk" && e.session.nominationsOpen, "vote failed");
      e.endDay();
      assert(e.session.phase === "execution" && e.session.executionPendingId === "p2", `phase ${e.session.phase}`);
      e.confirmExecution(true);
      e.endDay();
      assert(e.session.phase === "night", `phase ${e.session.phase}`);
    },
  },
];

let failed = 0;
for (const c of cases) {
  let err: string | null = null;
  try {
    await c.run();
  } catch (x) {
    err = String(x instanceof Error ? x.message : x);
  }
  if (err) failed += 1;
  console.log(`${err ? "FAIL" : "PASS"}  ${c.name}${err ? `\n      ${err}` : ""}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);

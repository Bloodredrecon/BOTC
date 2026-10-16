/**
 * Rule fixes from the audits: dead Saint, poison lifetime, Butler, "Lives" execution, Virgin cancel,
 * Baron setup, Mayor bounce, bluffs, Monk targets, seat cap.
 * Run: cd server && npx tsx test/rules-fixes.ts
 */
import {
  goToStep,
  night,
  nominations,
  notices,
  pid,
  player,
  projection,
  rules,
  runCases,
  script,
  setup,
  type Case,
  type Engine,
} from "./_harness.js";

function toBlockAndExecute(e: Engine, nomineeId: string, died = true) {
  const nominator = e.session.players.find((p) => p.alive && p.id !== nomineeId)!.id;
  e.goDusk();
  e.openNominations();
  const r = e.startNomination(nominator, nomineeId);
  if (!r.ok) throw new Error(`nomination refused: ${r.message}`);
  e.resolveVote("majority");
  e.endDay();
  e.confirmExecution(died);
}

const cases: Case[] = [
  {
    name: "Item 2: executing an already-dead Saint — no Evil win, no Died today, counts as the execution",
    run: () => {
      const e = setup(["saint", "imp", "chef", "empath", "monk", "poisoner"]);
      const saint = pid(e, "saint");
      player(e, saint).alive = false;
      toBlockAndExecute(e, saint);
      if (/GAME OVER/.test(notices(e))) return `game ended: ${notices(e)}`;
      if (player(e, saint).reminders.includes("Died today")) return "Died today placed";
      if (e.session.executedTodayId) return "executedTodayId set (Undertaker would learn)";
      if (!e.session.executionOccurredToday) return "execution not counted";
      const log = e.session.publicLog.find((x) => x.type === "execution");
      if (!log || log.type !== "execution" || !log.alreadyDead) return "no alreadyDead in the log";
      return null;
    },
  },
  {
    name: "Item 2: executing the already-dead Demon does not promote the Scarlet Woman",
    run: () => {
      // An earlier Imp (dead after a star-pass) is executed while the new Imp lives.
      const e = setup(["scarletwoman", "imp", "imp", "chef", "empath", "monk", "saint"]);
      const oldImp = pid(e, "imp", 0);
      player(e, oldImp).alive = false;
      toBlockAndExecute(e, oldImp);
      if (player(e, pid(e, "scarletwoman")).characterId !== "scarletwoman") return "SW promoted";
      return null;
    },
  },
  {
    name: "Item 3: Poisoner killed at night — poison ends at once",
    run: () => {
      const e = setup(["poisoner", "imp", "chef", "empath", "washerwoman", "monk", "butler"]);
      e.startNight();
      goToStep(e, "char-poisoner");
      e.applyNightReminder(pid(e, "chef"), "Poisoned");
      goToStep(e, "char-imp");
      e.otherDeath(pid(e, "poisoner"), "Demon");
      if (player(e, pid(e, "chef")).reminders.includes("Poisoned")) return "still Poisoned";
      return null;
    },
  },
  {
    name: "Item 3: Poisoner executed — poison ends at once",
    run: () => {
      const e = setup(["poisoner", "imp", "chef", "empath", "washerwoman", "monk", "butler"]);
      e.updatePlayer(pid(e, "chef"), { reminders: ["Poisoned"] });
      toBlockAndExecute(e, pid(e, "poisoner"));
      if (player(e, pid(e, "chef")).reminders.includes("Poisoned")) return "still Poisoned";
      return null;
    },
  },
  {
    name: "Item 4: Monk-protected player who is Poisoned is still protected (rules)",
    run: () => {
      const e = setup(["monk", "imp", "chef", "empath", "poisoner"]);
      const chef = player(e, pid(e, "chef"));
      chef.reminders = ["Safe", "Poisoned"];
      return rules.safeProtects(e.session, chef) ? null : "not protected";
    },
  },
  {
    name: "Item 6: dead Master raises a ghost vote after the Butler — both counted, no warning",
    run: () => {
      const e = setup(["butler", "imp", "chef", "empath", "monk", "poisoner", "saint"]);
      const butler = pid(e, "butler");
      const chef = pid(e, "chef");
      player(e, chef).alive = false;
      player(e, chef).reminders = ["Master"];
      e.goDusk();
      e.openNominations();
      e.startNomination(pid(e, "empath"), pid(e, "monk"));
      e.startVote();
      e.toggleVote(butler);
      e.toggleVote(chef);
      const nom = e.session.nomination!;
      if (!nom.votesFor.includes(butler) || !nom.votesFor.includes(chef)) return `hands ${nom.votesFor}`;
      if (rules.effectiveVoteCount(e.session) !== 2) return `count ${rules.effectiveVoteCount(e.session)}`;
      if (projection.toStorytellerState(e.session, script).butlerWarning) return "warning shown for a legal vote";
      return null;
    },
  },
  {
    name: "Item 6: Butler votes without the Master — tallied, Storyteller-only warning",
    run: () => {
      const e = setup(["butler", "imp", "chef", "empath", "monk", "poisoner", "saint"]);
      const butler = pid(e, "butler");
      player(e, pid(e, "chef")).reminders = ["Master"];
      e.goDusk();
      e.openNominations();
      e.startNomination(pid(e, "empath"), pid(e, "monk"));
      e.startVote();
      e.toggleVote(butler);
      if (rules.effectiveVoteCount(e.session) !== 1) return "Butler hand dropped";
      const st = projection.toStorytellerState(e.session, script);
      if (!st.butlerWarning) return "no ST warning";
      const pub = projection.toPublicState(e.session, script) as unknown as Record<string, unknown>;
      if (JSON.stringify(pub).includes("Butler")) return "warning leaked to the TV";
      return null;
    },
  },
  {
    name: "Item 6: the Butler cannot choose themselves as Master (night step and grimoire)",
    run: () => {
      const e = setup(["butler", "imp", "chef", "empath", "monk", "poisoner", "saint"], { phase: "lobby", day: 0 });
      e.startFirstNight({ override: true });
      goToStep(e, "char-butler");
      const butler = pid(e, "butler");
      const r = e.applyNightReminder(butler, "Master");
      if (r.ok || player(e, butler).reminders.includes("Master")) return "night step allowed self";
      e.updatePlayer(butler, { reminders: ["Master"] });
      if (player(e, butler).reminders.includes("Master")) return "grimoire allowed self";
      return null;
    },
  },
  {
    name: "Item 11: Lives still counts as the execution — no Mayor win, Undertaker learns nothing",
    run: () => {
      const e = setup(["mayor", "imp", "chef", "empath", "monk"]);
      player(e, pid(e, "monk")).alive = false;
      player(e, pid(e, "empath")).alive = false;
      toBlockAndExecute(e, pid(e, "chef"), false);
      if (!e.session.executionOccurredToday) return "flag not set";
      if (e.session.executedTodayId) return "executedTodayId set for Lives";
      if (rules.mayorWinAtDusk(e.session)) return "Mayor win despite the execution";
      if (!nominations.dayLimitReason(e.session)) return "day limit not enforced";
      return null;
    },
  },
  {
    name: "Item 12: cancelling a nomination restores the Virgin's ability",
    run: () => {
      const e = setup(["virgin", "imp", "chef", "empath", "poisoner"]);
      const virgin = pid(e, "virgin");
      e.goDusk();
      e.openNominations();
      e.startNomination(pid(e, "poisoner"), virgin);
      if (!player(e, virgin).abilityUsed) return "ability not spent by a Minion's nomination";
      e.cancelNomination();
      const v = player(e, virgin);
      if (v.abilityUsed || v.reminders.includes("No ability")) return "ability not restored";
      return null;
    },
  },
  {
    name: "Item 13: Baron's +2 Outsiders stays after the Baron dies",
    run: () => {
      const e = setup(["baron", "imp", "saint", "recluse", "chef", "empath", "monk"], { phase: "lobby", day: 0 });
      e.startFirstNight({ override: true });
      if (!e.session.baronInSetup) return "baronInSetup not recorded";
      const base = script.setupByPlayerCount["7"]!;
      // Star-pass onto the Baron: no Baron token remains in play.
      player(e, pid(e, "baron")).characterId = "imp";
      const st = projection.toStorytellerState(e.session, script);
      if (st.setup?.outsider !== base.outsider + 2) return `required Outsiders ${st.setup?.outsider}, want ${base.outsider + 2}`;
      if (!/Baron/.test(projection.setupWarning(e.session, script) ?? "Baron")) return "Baron note dropped";
      return null;
    },
  },
  {
    name: "Item 20: Mayor bounce offered for a healthy Mayor; replacement follows protection",
    run: () => {
      const e = setup(["mayor", "imp", "soldier", "chef", "empath", "poisoner", "monk"]);
      const mayor = player(e, pid(e, "mayor"));
      if (!rules.mayorBounceAvailable(e.session, mayor)) return "not offered";
      mayor.reminders = ["Poisoned"];
      if (rules.mayorBounceAvailable(e.session, mayor)) return "offered for a poisoned Mayor";
      mayor.reminders = [];
      e.startNight();
      goToStep(e, "char-imp");
      const r = e.otherDeath(pid(e, "soldier"), "Demon (Mayor bounce)");
      if (!r.blocked) return "bounce onto the Soldier killed them";
      const r2 = e.otherDeath(pid(e, "chef"), "Demon (Mayor bounce)");
      if (!r2.ok || r2.blocked || player(e, pid(e, "chef")).alive) return "bounce onto the Chef failed";
      if (!player(e, pid(e, "mayor")).alive) return "Mayor died";
      return null;
    },
  },
  {
    name: "Item 21: bluffs — only 3 distinct good characters that are not in play",
    run: () => {
      const e = setup(["imp", "chef", "empath", "poisoner", "monk"]);
      e.updatePlayer(pid(e, "imp"), { bluffs: ["chef", "spy", "saint", "saint", "virgin", "soldier", "mayor"] });
      const b = player(e, pid(e, "imp")).bluffs;
      if (JSON.stringify(b) !== JSON.stringify(["saint", "virgin", "soldier"])) return `got ${b}`;
      if (!/dropped/.test(notices(e))) return "no notice";
      return null;
    },
  },
  {
    name: "Item 22: the Monk may protect a dead player, never themselves",
    run: () => {
      const e = setup(["monk", "imp", "chef", "empath", "poisoner"]);
      player(e, pid(e, "chef")).alive = false;
      e.startNight();
      goToStep(e, "char-monk");
      const ok = e.applyNightReminder(pid(e, "chef"), "Safe");
      if (!ok.ok || !player(e, pid(e, "chef")).reminders.includes("Safe")) return "dead target refused";
      const self = e.applyNightReminder(pid(e, "monk"), "Safe");
      if (self.ok) return "Monk protected themselves";
      return null;
    },
  },
  {
    name: "Item 25: 15-player cap with a clear message; override allows 20; seats stay in order",
    run: () => {
      const e = setup(["chef", "empath", "imp", "monk", "poisoner"], { phase: "lobby", day: 0 });
      e.addTraveller("Tom", "thief", { seat: 2 });
      e.setPlayerCount(18);
      const residents = e.session.players.filter((p) => !p.isTraveller);
      if (residents.length !== 15) return `got ${residents.length}`;
      if (!/at most 15/.test(notices(e))) return "no cap message";
      const tom = e.session.players.find((p) => p.name === "Tom")!;
      if (tom.seat !== 2) return `Traveller moved to seat ${tom.seat}`;
      e.setPlayerCount(20, { allowOver15: true });
      if (e.session.players.filter((p) => !p.isTraveller).length !== 20) return "override failed";
      const seats = e.session.players.map((p) => p.seat);
      if (seats.some((s, i) => s !== i + 1)) return `seats ${seats}`;
      if (new Set(e.session.players.map((p) => p.id)).size !== e.session.players.length) return "duplicate ids";
      return null;
    },
  },
  {
    name: "Item 23: Washerwoman default picks are randomised (not always the lowest seat)",
    run: () => {
      const e = setup(["washerwoman", "chef", "empath", "monk", "soldier", "imp", "poisoner"], { phase: "lobby", day: 0 });
      const seen = new Set<string>();
      for (let i = 0; i < 60; i++) {
        const steps = night.buildNightSteps(e.session, script, true);
        const ww = steps.find((s) => s.id === "char-washerwoman")!;
        seen.add(ww.show.suggestedCharacterId ?? "");
        if ((ww.show.suggestedPlayerIds ?? []).includes(pid(e, "washerwoman"))) return "suggested the receiver";
        if (ww.show.suggestedCharacterId === "washerwoman") return "suggested own role";
      }
      return seen.size > 1 ? null : `always ${[...seen]}`;
    },
  },
];

runCases(cases);

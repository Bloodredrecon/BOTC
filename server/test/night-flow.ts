/**
 * Night step flow: kills mid-night, new Demons, Minion/Demon info gating, evil Travellers, lights.
 * Run: cd server && npx tsx test/night-flow.ts
 */
import { currentStep, goToStep, notices, pid, player, publicState, runCases, setup, stepIds, type Case } from "./_harness.js";

const OTHER_NIGHT = ["poisoner", "monk", "imp", "ravenkeeper", "empath", "fortuneteller", "butler", "chef"];

const cases: Case[] = [
  {
    name: "Item 1: Imp kills the Monk (earlier step) — the next wake after the Imp is not skipped",
    run: () => {
      const e = setup(OTHER_NIGHT);
      e.startNight();
      goToStep(e, "char-imp");
      const idx = e.session.night!.stepIndex;
      const expectedNext = e.session.night!.steps[idx + 1]!.id;
      e.otherDeath(pid(e, "monk"), "Demon");
      if (currentStep(e)?.id !== "char-imp") return `current step moved to ${currentStep(e)?.id}`;
      e.markNightStepDone();
      if (currentStep(e)?.id !== expectedNext) return `expected ${expectedNext}, got ${currentStep(e)?.id} (${stepIds(e).join(",")})`;
      if (!stepIds(e).slice(0, idx).includes("char-monk")) return "past Monk step vanished";
      return null;
    },
  },
  {
    name: "Item 1: Imp kills the Empath (later step) — Empath stays in the list as skipped",
    run: () => {
      const e = setup(OTHER_NIGHT);
      e.startNight();
      goToStep(e, "char-imp");
      e.otherDeath(pid(e, "empath"), "Demon");
      const step = e.session.night!.steps.find((s) => s.id === "char-empath");
      if (!step) return "Empath step removed";
      if (!step.skipped || !/Died tonight/.test(step.skipReason ?? "")) return `expected skipped (died tonight), got ${JSON.stringify(step)}`;
      return null;
    },
  },
  {
    name: "Item 1: Imp kills the Ravenkeeper — Ravenkeeper wakes right after",
    run: () => {
      const e = setup(OTHER_NIGHT);
      e.startNight();
      goToStep(e, "char-imp");
      e.otherDeath(pid(e, "ravenkeeper"), "Demon");
      e.markNightStepDone();
      const s = currentStep(e);
      if (s?.id !== "char-ravenkeeper" || s.skipped) return `expected active Ravenkeeper, got ${JSON.stringify(s)}`;
      return null;
    },
  },
  {
    name: "Item 5: Mark dead at night is announced at dawn and hidden on the TV until then",
    run: () => {
      const e = setup(OTHER_NIGHT);
      e.startNight();
      const chef = pid(e, "chef");
      e.updatePlayer(chef, { alive: false });
      if (!e.session.diedTonightIds.includes(chef)) return "not added to diedTonightIds";
      if (!publicState(e).players.find((p) => p.id === chef)!.alive) return "leaked to TV at night";
      e.goDawn();
      if (!e.session.dawnDeathIds.includes(chef)) return "not in dawn deaths";
      e.setDawnDeaths([chef]);
      if (!e.session.dawnDeathIds.includes(chef)) return "setDawnDeaths dropped the already-dead player";
      if (!publicState(e).players.find((p) => p.id === chef)!.alive) return "leaked to TV before announce";
      e.announceDawnDeaths();
      const log = e.session.publicLog.find((x) => x.type === "night_death");
      if (!log || log.type !== "night_death" || !log.playerIds.includes(chef)) return "no public night_death";
      return null;
    },
  },
  {
    name: "Item 7: Imp self-kill with 2 Minions asks the Storyteller who gets the star-pass",
    run: () => {
      const e = setup(["poisoner", "spy", "imp", "chef", "empath", "monk", "butler"]);
      e.startNight();
      goToStep(e, "char-imp");
      const imp = pid(e, "imp");
      const r = e.otherDeath(imp, "Demon");
      if (r.ok || !r.needsStarPassChoice || r.candidates?.length !== 2) return `expected a choice, got ${JSON.stringify(r)}`;
      if (!player(e, imp).alive) return "Imp died before the choice";
      const spy = pid(e, "spy");
      const r2 = e.otherDeath(imp, "Demon", { starPassTo: spy });
      if (!r2.ok) return `second call failed ${JSON.stringify(r2)}`;
      if (player(e, spy).characterId !== "imp") return "chosen Minion did not become the Imp";
      if (e.session.players.find((p) => p.id !== spy && p.characterId === "imp" && p.alive)) return "someone else is also the Imp";
      e.markNightStepDone();
      const s = currentStep(e);
      if (s?.id !== `new-demon-${spy}`) return `expected the new-Imp wake next, got ${s?.id}`;
      if (!/You are the Imp/.test(s.show?.message ?? "")) return "new-Imp step does not say You are the Imp";
      return null;
    },
  },
  {
    name: "Item 7: healthy Scarlet Woman is forced (no choice) and gets a You-are-the-Imp wake; no SW step otherwise",
    run: () => {
      const e = setup(["scarletwoman", "poisoner", "imp", "chef", "empath", "monk", "butler"]);
      e.startNight();
      if (stepIds(e).includes("char-scarletwoman")) return "Scarlet Woman step present while the Demon lives";
      goToStep(e, "char-imp");
      const r = e.otherDeath(pid(e, "imp"), "Demon");
      if (!r.ok || r.needsStarPassChoice) return `unexpected ${JSON.stringify(r)}`;
      const sw = e.session.players.find((p) => p.name.startsWith("scarletwoman"))!;
      if (sw.characterId !== "imp") return "SW not promoted";
      if (!stepIds(e).includes(`new-demon-${sw.id}`)) return "no new-Demon step";
      return null;
    },
  },
  {
    name: "Item 7: Scarlet Woman promoted by day is told at her place in the order and acts as the Imp",
    run: () => {
      const e = setup(["scarletwoman", "poisoner", "imp", "chef", "empath", "monk", "butler"]);
      e.otherDeath(pid(e, "imp"), "Slayer");
      const sw = e.session.players.find((p) => p.name.startsWith("scarletwoman"))!;
      if (sw.characterId !== "imp") return "SW not promoted";
      e.startNight();
      const ids = stepIds(e);
      const nd = ids.indexOf(`new-demon-${sw.id}`);
      const impStep = e.session.night!.steps.find((s) => s.id === "char-imp");
      if (nd < 0) return `no new-Demon step (${ids.join(",")})`;
      if (!impStep || nd > ids.indexOf("char-imp")) return "new-Demon wake should come before the Imp's kill";
      if (!impStep.playerIds.includes(sw.id) || impStep.skipped) return "day-promoted Imp should act tonight";
      return null;
    },
  },
  {
    name: "Item 9: 5-6 players — Minion info and Demon info are skipped",
    run: () => {
      const e = setup(["poisoner", "imp", "chef", "empath", "washerwoman"], { phase: "lobby", day: 0 });
      e.startFirstNight({ override: true });
      const steps = e.session.night!.steps;
      for (const id of ["minion-info", "demon-info"]) {
        const s = steps.find((x) => x.id === id);
        if (s && !s.skipped) return `${id} active at 5 players`;
      }
      return null;
    },
  },
  {
    name: "Item 9: 7+ players — Travellers, then Minion info (with fellow Minions), then Demon info",
    run: () => {
      const e = setup(["poisoner", "spy", "imp", "chef", "empath", "washerwoman", "monk"], { phase: "lobby", day: 0 });
      e.addTraveller("Tess", "thief");
      e.startFirstNight({ override: true });
      const ids = stepIds(e);
      const t = ids.indexOf("char-thief");
      const m = ids.indexOf("minion-info");
      const d = ids.indexOf("demon-info");
      if (!(t > 0 && t < m && m < d)) return `bad order ${ids.join(",")}`;
      const mi = e.session.night!.steps[m]!;
      if (mi.skipped) return "minion-info skipped at 7";
      const fellows = mi.show.fellowPlayerIds ?? [];
      if (!fellows.includes(pid(e, "poisoner")) || !fellows.includes(pid(e, "spy"))) return "Minions not shown each other";
      return null;
    },
  },
  {
    name: "Item 17: evil Traveller learns the Demon once",
    run: () => {
      const e = setup(["poisoner", "imp", "chef", "empath", "washerwoman"], { phase: "lobby", day: 0 });
      e.addTraveller("Eve", "gunslinger", { alignment: "evil" });
      e.startFirstNight({ override: true });
      goToStep(e, "evil-traveller-info");
      const s = currentStep(e)!;
      if (s.show.suggestedPlayerIds?.[0] !== pid(e, "imp")) return "does not show the Demon";
      e.markNightStepDone();
      const eve = e.session.players.find((p) => p.name === "Eve")!;
      if (!eve.learnedDemon) return "learnedDemon not set";
      e.goDawn();
      e.finishDawn();
      e.startNight();
      if (stepIds(e).includes("evil-traveller-info")) return "shown again the next night";
      return null;
    },
  },
  {
    name: "Item 26: night kills do not change the lights (and the TV gets no hue cue)",
    run: () => {
      const e = setup(OTHER_NIGHT);
      e.startNight();
      goToStep(e, "char-imp");
      e.rec.hues.length = 0;
      const before = e.rec.publics.length;
      e.otherDeath(pid(e, "chef"), "Demon");
      if (e.rec.hues.length) return `hue changed: ${e.rec.hues.join(",")}`;
      if (e.rec.publics.slice(before).some((p) => p.hueScene)) return "public hueScene sent";
      return null;
    },
  },
  {
    name: "Item 3: star-pass onto the Poisoner ends the poison",
    run: () => {
      const e = setup(["poisoner", "imp", "chef", "empath", "washerwoman", "monk", "butler"]);
      e.startNight();
      goToStep(e, "char-poisoner");
      e.applyNightReminder(pid(e, "chef"), "Poisoned");
      goToStep(e, "char-imp");
      const poisoner = pid(e, "poisoner");
      e.otherDeath(pid(e, "imp"), "Demon", { starPassTo: poisoner });
      if (player(e, poisoner).characterId !== "imp") return "no star-pass";
      if (player(e, pid(e, "chef")).reminders.includes("Poisoned")) return "poison outlived the Poisoner";
      if (!/poison ends/.test(notices(e))) return "no Storyteller notice";
      return null;
    },
  },
];

runCases(cases);

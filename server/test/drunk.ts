/**
 * Drunk model: characterId "drunk" + thinksCharacterId; legacy "Drunk" reminder migration.
 * Run: cd server && npx tsx test/drunk.ts
 */
import { writeFileSync } from "node:fs";
import { goToStep, night, notices, persistence, pid, player, projection, rules, runCases, script, setup, stepIds, type Case } from "./_harness.js";

const cases: Case[] = [
  {
    name: "Toggling Is the Drunk on a Chef makes them the Drunk who thinks they are the Chef",
    run: () => {
      const e = setup(["chef", "imp", "empath", "poisoner", "monk"], { phase: "lobby", day: 0 });
      const id = pid(e, "chef");
      e.updatePlayer(id, { reminders: ["Is the Drunk"] });
      const p = player(e, id);
      if (p.characterId !== "drunk" || p.thinksCharacterId !== "chef") return `got ${p.characterId}/${p.thinksCharacterId}`;
      e.startFirstNight();
      const chef = e.session.night!.steps.find((s) => s.id === "char-chef");
      if (!chef?.playerIds.includes(id)) return "Drunk does not wake as the Chef";
      if (!chef.show.infoImpaired) return "Drunk Chef info not flagged false";
      e.updatePlayer(id, { reminders: [] });
      if (player(e, id).characterId !== "chef") return "removing the token did not revert";
      return null;
    },
  },
  {
    name: "Old session with the legacy Drunk reminder loads as the Drunk",
    run: () => {
      const s = persistence.createEmptySession(5);
      s.players[0]!.characterId = "empath";
      s.players[0]!.reminders = ["Drunk"];
      const raw = JSON.parse(JSON.stringify(s));
      for (const p of raw.players) {
        delete p.thinksCharacterId;
        delete p.alignment;
        delete p.learnedDemon;
        delete p.voteTokens;
      }
      delete raw.executionOccurredToday;
      delete raw.newDemons;
      delete raw.exile;
      writeFileSync(process.env.BOTC_SESSION_PATH!, JSON.stringify(raw));
      const loaded = persistence.loadSession();
      const p = loaded.players[0]!;
      if (p.characterId !== "drunk" || p.thinksCharacterId !== "empath") return `got ${p.characterId}/${p.thinksCharacterId}`;
      if (!p.reminders.includes("Is the Drunk") || p.reminders.includes("Drunk")) return `reminders ${p.reminders}`;
      if (loaded.executionOccurredToday !== false || !Array.isArray(loaded.newDemons) || loaded.exile !== null) return "new fields not defaulted";
      if (loaded.players[1]!.voteTokens !== 0 || loaded.players[1]!.alignment !== null) return "player fields not defaulted";
      return null;
    },
  },
  {
    name: "Undertaker learns the executed Drunk is the Drunk",
    run: () => {
      const e = setup(["drunk", "imp", "undertaker", "poisoner", "monk"], { mutate: (s) => (s.players[0]!.thinksCharacterId = "chef") });
      const drunk = pid(e, "drunk");
      e.goDusk();
      e.openNominations();
      e.startNomination(pid(e, "monk"), drunk);
      e.resolveVote("majority");
      e.endDay();
      e.confirmExecution(true);
      const steps = night.buildNightSteps(e.session, script, false);
      const u = steps.find((s) => s.id === "char-undertaker");
      if (u?.show.suggestedCharacterId !== "drunk") return `got ${u?.show.suggestedCharacterId}`;
      return null;
    },
  },
  {
    name: "Librarian truth sees the Drunk as an Outsider; Washerwoman never uses them as a Townsfolk",
    run: () => {
      const e = setup(["librarian", "washerwoman", "drunk", "imp", "poisoner"], {
        phase: "lobby",
        day: 0,
        mutate: (s) => (s.players[2]!.thinksCharacterId = "chef"),
      });
      const drunk = pid(e, "drunk");
      for (let i = 0; i < 40; i++) {
        const steps = night.buildNightSteps(e.session, script, true);
        const lib = steps.find((s) => s.id === "char-librarian")!;
        if (lib.show.suggestedCharacterId !== "drunk" || !lib.show.suggestedPlayerIds?.includes(drunk)) return `Librarian ${JSON.stringify(lib.show)}`;
        const ww = steps.find((s) => s.id === "char-washerwoman")!;
        if (ww.show.suggestedCharacterId === "chef") return "Washerwoman shown the Drunk's fake Chef";
      }
      return null;
    },
  },
  {
    name: "Bag counts and the end reveal use the true character",
    run: () => {
      const e = setup(["drunk", "imp", "chef", "empath", "poisoner"], { mutate: (s) => (s.players[0]!.thinksCharacterId = "monk") });
      const counts = projection.assignedCounts(e.session, script);
      if (counts.outsider !== 1 || counts.townsfolk !== 2) return `counts ${JSON.stringify(counts)}`;
      e.endGame("good");
      const r = projection.toPublicState(e.session, script).reveal!.find((p) => p.id === pid(e, "drunk"))!;
      if (r.characterId !== "drunk" || r.thinksCharacterName !== "Monk") return `reveal ${JSON.stringify(r)}`;
      return null;
    },
  },
  {
    name: "Drunk thinking they are an in-play Townsfolk is flagged",
    run: () => {
      const e = setup(["drunk", "imp", "chef", "empath", "poisoner"], { phase: "lobby", day: 0 });
      e.updatePlayer(pid(e, "drunk"), { thinksCharacterId: "chef" });
      if (!/really is/.test(notices(e))) return `no warning: ${notices(e)}`;
      return null;
    },
  },
  {
    name: "A Drunk 'Monk' cannot protect (Safe from a Drunk fails)",
    run: () => {
      const e = setup(["drunk", "imp", "chef", "empath", "poisoner"], { mutate: (s) => (s.players[0]!.thinksCharacterId = "monk") });
      e.startNight();
      if (!stepIds(e).includes("char-monk")) return "Drunk Monk does not wake";
      goToStep(e, "char-monk");
      e.applyNightReminder(pid(e, "chef"), "Safe");
      if (rules.safeProtects(e.session, player(e, pid(e, "chef")))) return "Drunk's Safe protects";
      return null;
    },
  },
];

runCases(cases);

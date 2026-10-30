/**
 * Recluse / Spy registration: truth uses real alignment; Storyteller-only alternatives per step.
 * Run: cd server && npx tsx test/registration.ts
 */
import { night, pid, player, reminders, runCases, script, setup, type Case } from "./_harness.js";

function step(e: ReturnType<typeof setup>, id: string, first = true) {
  const s = night.buildNightSteps(e.session, script, first).find((x) => x.id === id);
  if (!s) throw new Error(`no ${id}`);
  return s;
}

const cases: Case[] = [
  {
    name: "Chef: Recluse next to the Imp — truth 0, alternatives 0–1",
    run: () => {
      const e = setup(["chef", "recluse", "imp", "empath", "washerwoman"], { phase: "lobby", day: 0 });
      const s = step(e, "char-chef");
      if (s.show.suggestedNumber !== 0) return `truth ${s.show.suggestedNumber}`;
      if (JSON.stringify(s.show.registration?.numbers) !== "[0,1]") return `alts ${JSON.stringify(s.show.registration)}`;
      return null;
    },
  },
  {
    name: "Empath: Spy neighbour — truth 1, may show 0",
    run: () => {
      const e = setup(["spy", "empath", "chef", "imp", "washerwoman"], { phase: "lobby", day: 0 });
      const s = step(e, "char-empath");
      if (s.show.suggestedNumber !== 1) return `truth ${s.show.suggestedNumber}`;
      if (!s.show.registration?.numbers?.includes(0)) return `alts ${JSON.stringify(s.show.registration)}`;
      return null;
    },
  },
  {
    name: "Empath with no Recluse/Spy nearby: no alternatives",
    run: () => {
      const e = setup(["chef", "empath", "monk", "imp", "recluse"], { phase: "lobby", day: 0 });
      const s = step(e, "char-empath");
      return s.show.registration ? `unexpected ${JSON.stringify(s.show.registration)}` : null;
    },
  },
  {
    name: "Investigator: alternative pair with the Recluse as a Minion; Minion stamped on the Recluse",
    run: () => {
      const e = setup(["investigator", "recluse", "imp", "chef", "empath"], { phase: "lobby", day: 0 });
      const s = step(e, "char-investigator");
      const alt = s.show.registration?.pairs?.[0];
      if (!alt || !alt.playerIds.includes(pid(e, "recluse")) || !alt.characterId) return `alts ${JSON.stringify(s.show.registration)}`;
      reminders.placeInfoPairReminders(e.session, {
        positiveLabel: "Minion",
        infoRoleLabel: "Investigator",
        playerIds: alt.playerIds,
        shownCharacterId: alt.characterId,
      });
      if (!player(e, pid(e, "recluse")).reminders.includes("Minion · Investigator")) {
        return `Minion not on the Recluse: ${player(e, pid(e, "recluse")).reminders.join(",")}`;
      }
      return null;
    },
  },
  {
    name: "Washerwoman / Librarian: alternative pair with the Spy",
    run: () => {
      const e = setup(["washerwoman", "librarian", "spy", "imp", "saint"], { phase: "lobby", day: 0 });
      for (const id of ["char-washerwoman", "char-librarian"]) {
        const alt = step(e, id).show.registration?.pairs?.[0];
        if (!alt?.playerIds.includes(pid(e, "spy"))) return `${id}: ${JSON.stringify(alt)}`;
      }
      return null;
    },
  },
  {
    name: "Undertaker: executed Recluse may show as a Minion / Demon",
    run: () => {
      const e = setup(["undertaker", "recluse", "imp", "chef", "empath"]);
      e.session.executedTodayId = pid(e, "recluse");
      player(e, pid(e, "recluse")).alive = false;
      const s = step(e, "char-undertaker", false);
      if (s.show.suggestedCharacterId !== "recluse") return "truth not Recluse";
      if (!s.show.registration?.characterIds?.includes("imp")) return `alts ${JSON.stringify(s.show.registration)}`;
      return null;
    },
  },
  {
    name: "Fortune Teller and Ravenkeeper: Recluse note shown",
    run: () => {
      const e = setup(["fortuneteller", "recluse", "imp", "chef", "ravenkeeper"]);
      if (!/Recluse/.test(step(e, "char-fortuneteller", false).show.registration?.note ?? "")) return "no FT note";
      e.startNight();
      e.otherDeath(pid(e, "ravenkeeper"), "Demon");
      if (!/Recluse/.test(step(e, "char-ravenkeeper", false).show.registration?.note ?? "")) return "no RK note";
      return null;
    },
  },
];

runCases(cases);

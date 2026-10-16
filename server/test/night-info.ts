/**
 * Washerwoman / Librarian / Investigator (and Undertaker lie) night-info suggestions:
 * the woken player is never a suggested player and their own (shown) role is never the
 * suggested character. Truthful suggestions still point at the real character.
 * Run: cd server && npx tsx test/night-info.ts
 * Uses a temp session file so the live data/session.json is never touched.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BOTC_SESSION_PATH = join(mkdtempSync(join(tmpdir(), "botc-info-")), "session.json");

const { GameEngine } = await import("../src/game.js");
const { buildNightSteps } = await import("../src/night.js");
const { createEmptySession, loadScript } = await import("../src/persistence.js");
type Session = import("../src/types.js").GameSession;
type Team = import("../src/types.js").Team;

const script = loadScript();
const hue = { applyScene: async () => {}, isLive: () => false } as never;
const ITERATIONS = 200;

/** mulberry32 — seeds Math.random so the night.ts random lie picks are reproducible. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = seeded(0xb07c);

const rand = (n: number) => Math.floor(Math.random() * n);
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const byTeam = (team: Team) => script.characters.filter((c) => c.team === team).map((c) => c.id);
const teamOf = (id: string | null | undefined) => script.characters.find((c) => c.id === id)?.team;

/** Random legal-ish TB grimoire containing `receiverRole`, seats shuffled. */
function randomSession(receiverRole: string, opts: { outsiders?: number } = {}): Session {
  const n = 5 + rand(11);
  const minions = 1 + rand(Math.min(3, n - 4));
  const outsiders = opts.outsiders ?? rand(3);
  const townsfolk = Math.max(1, n - 1 - minions - outsiders);
  const pick = (team: Team, k: number, must?: string) => {
    const pool = shuffle(byTeam(team).filter((id) => id !== must));
    return [...(must ? [must] : []), ...pool].slice(0, k);
  };
  const receiverTeam = teamOf(receiverRole)!;
  const roles = shuffle([
    ...pick("demon", 1),
    ...pick("minion", minions, receiverTeam === "minion" ? receiverRole : undefined),
    ...pick("outsider", outsiders, receiverTeam === "outsider" ? receiverRole : undefined),
    ...pick("townsfolk", townsfolk, receiverTeam === "townsfolk" ? receiverRole : undefined),
  ]);
  const s = createEmptySession(roles.length);
  roles.forEach((r, i) => {
    s.players[i]!.characterId = r;
    s.players[i]!.name = `${r}#${i + 1}`;
  });
  return s;
}

function stepFor(s: Session, role: string, firstNight = true) {
  const step = buildNightSteps(s, script, firstNight).find((x) => x.characterId === role);
  if (!step) throw new Error(`no ${role} wake step`);
  return step;
}

const INFO_TEAM: Record<string, Team> = {
  washerwoman: "townsfolk",
  librarian: "outsider",
  investigator: "minion",
};

/**
 * Shared checks for a WW/Lib/Inv show. `truthful` additionally requires the suggestion
 * to be correct (real player with that character in the pair).
 */
function checkPairShow(s: Session, role: string, receiverId: string, truthful: boolean): string | null {
  const show = stepFor(s, role).show;
  const team = INFO_TEAM[role]!;
  const players = show.suggestedPlayerIds ?? [];
  const truthPlayers = show.truthPlayerIds ?? [];
  const where = `[${s.players.map((p) => `${p.name}${p.reminders.length ? `(${p.reminders})` : ""}`).join(", ")}]`;

  if (players.includes(receiverId)) return `receiver in suggested players ${players} ${where}`;
  if (truthPlayers.includes(receiverId)) return `receiver in truth players ${truthPlayers} ${where}`;
  if (show.suggestedCharacterId === role) return `suggested own role ${role} ${where}`;
  if (show.truthCharacterId === role) return `truth shows own role ${role} ${where}`;
  if (new Set(players).size !== players.length) return `duplicate suggested players ${players}`;
  if (show.suggestedCharacterId && teamOf(show.suggestedCharacterId) !== team) {
    return `suggested ${show.suggestedCharacterId} is not a ${team}`;
  }

  const hasOtherOfTeam = s.players.some(
    (p) => p.id !== receiverId && p.alive && !p.leftGame && teamOf(p.characterId) === team && p.characterId !== role,
  );

  if (truthful) {
    if (show.infoImpaired) return "healthy receiver flagged impaired";
    if (!hasOtherOfTeam) {
      if (players.length || show.suggestedCharacterId) return `no ${team} besides receiver but suggested ${players}`;
      if (role === "librarian" && !show.suggestedZeroOutsiders) return "zero Outsiders not pre-selected";
      return null;
    }
    if (show.suggestedZeroOutsiders) return "zero Outsiders pre-selected with Outsiders in play";
    if (players.length !== 2) return `expected 2 suggested players, got ${players.length} ${where}`;
    const hit = players
      .map((id) => s.players.find((p) => p.id === id)!)
      .find((p) => p.characterId === show.suggestedCharacterId);
    if (!hit) return `truthful pair has nobody with ${show.suggestedCharacterId} ${where}`;
    if (teamOf(hit.characterId) !== team) return `hit ${hit.name} is not a ${team}`;
    return null;
  }

  if (!show.infoImpaired) return "impaired receiver not flagged infoImpaired";
  if (players.length !== 2) return `expected 2 lie players, got ${players.length} ${where}`;
  if (!show.suggestedCharacterId) return "no lie character suggested";
  if (show.truthCharacterId && show.suggestedCharacterId === show.truthCharacterId) {
    return `lie character equals truth ${show.truthCharacterId}`;
  }
  return null;
}

type Case = { name: string; run: () => string | null };

function repeat(name: string, once: (i: number) => string | null): Case {
  return {
    name: `${name} ×${ITERATIONS}`,
    run: () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const r = once(i);
        if (r) return `iteration ${i}: ${r}`;
      }
      return null;
    },
  };
}

function receiverOf(s: Session, role: string) {
  return s.players.find((p) => p.characterId === role)!;
}

const cases: Case[] = [];

for (const role of ["washerwoman", "librarian", "investigator"]) {
  cases.push(
    repeat(`Healthy ${role}: never self / own role, truthful pair correct`, () => {
      const s = randomSession(role);
      return checkPairShow(s, role, receiverOf(s, role).id, true);
    }),
    repeat(`Poisoned ${role}: lie never self / own role`, () => {
      const s = randomSession(role);
      const me = receiverOf(s, role);
      me.reminders.push("Poisoned");
      return checkPairShow(s, role, me.id, false);
    }),
    repeat(`Drunk who thinks they are the ${role}: lie never self / shown role`, () => {
      const s = randomSession(role);
      const me = receiverOf(s, role);
      me.reminders.push("Drunk");
      return checkPairShow(s, role, me.id, false);
    }),
  );
}

cases.push(
  repeat("Healthy Librarian, zero Outsiders: Zero Outsiders pre-selected, no pair", () => {
    const s = randomSession("librarian", { outsiders: 0 });
    const show = stepFor(s, "librarian").show;
    if (!show.suggestedZeroOutsiders) return "zero Outsiders not pre-selected";
    if (show.suggestedPlayerIds?.length) return `suggested players ${show.suggestedPlayerIds}`;
    return null;
  }),
  repeat("Poisoned Librarian, zero Outsiders: bluff pair never self", () => {
    const s = randomSession("librarian", { outsiders: 0 });
    const me = receiverOf(s, "librarian");
    me.reminders.push("Poisoned");
    return checkPairShow(s, "librarian", me.id, false);
  }),
  {
    name: "Washerwoman lowest seat (old bug seat): not suggested as the Townsfolk",
    run: () => {
      const s = createEmptySession(5);
      ["washerwoman", "chef", "imp", "poisoner", "empath"].forEach((r, i) => (s.players[i]!.characterId = r));
      const show = stepFor(s, "washerwoman").show;
      if (show.suggestedPlayerIds?.includes("p1")) return `WW suggested: ${show.suggestedPlayerIds}`;
      if (show.suggestedCharacterId !== "chef") return `expected chef, got ${show.suggestedCharacterId}`;
      if (!show.suggestedPlayerIds?.includes("p2")) return `chef p2 missing: ${show.suggestedPlayerIds}`;
      return null;
    },
  },
  {
    name: "Washerwoman is the only Townsfolk: no suggestion, no self, no throw",
    run: () => {
      const s = createEmptySession(5);
      ["washerwoman", "butler", "imp", "poisoner", "recluse"].forEach((r, i) => (s.players[i]!.characterId = r));
      const show = stepFor(s, "washerwoman").show;
      if (show.suggestedPlayerIds?.length) return `suggested ${show.suggestedPlayerIds}`;
      if (show.suggestedCharacterId) return `suggested ${show.suggestedCharacterId}`;
      return null;
    },
  },
  {
    name: "Poisoned Washerwoman is the only Townsfolk: lie pair excludes self, not Washerwoman",
    run: () => {
      const s = createEmptySession(5);
      ["washerwoman", "butler", "imp", "poisoner", "recluse"].forEach((r, i) => (s.players[i]!.characterId = r));
      s.players[0]!.reminders.push("Poisoned");
      return checkPairShow(s, "washerwoman", "p1", false);
    },
  },
  {
    name: "Real Washerwoman + Drunk-as-Washerwoman: healthy WW never shown Washerwoman",
    run: () => {
      const s = createEmptySession(6);
      ["washerwoman", "washerwoman", "imp", "poisoner", "chef", "empath"].forEach(
        (r, i) => (s.players[i]!.characterId = r),
      );
      s.players[1]!.reminders.push("Drunk");
      const show = stepFor(s, "washerwoman").show;
      const players = show.suggestedPlayerIds ?? [];
      if (players.includes("p1") || players.includes("p2")) return `woken WW in suggestion: ${players}`;
      if (show.suggestedCharacterId === "washerwoman") return "suggested Washerwoman";
      return null;
    },
  },
  repeat("Poisoned Undertaker: lie character is never Undertaker", () => {
    const s = randomSession("undertaker");
    const me = receiverOf(s, "undertaker");
    const executed = shuffle(s.players.filter((p) => p.id !== me.id))[0]!;
    executed.alive = false;
    s.executedTodayId = executed.id;
    me.reminders.push("Poisoned");
    const show = stepFor(s, "undertaker", false).show;
    if (!show.infoImpaired) return "not impaired";
    if (show.suggestedCharacterId === "undertaker") return "lie is Undertaker";
    if (show.suggestedCharacterId === executed.characterId) return "lie equals truth";
    return null;
  }),
  {
    name: "Engine: first night Drunk-as-Washerwoman step excludes self and Washerwoman",
    run: () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const s = randomSession("washerwoman");
        const me = receiverOf(s, "washerwoman");
        me.reminders.push("Drunk");
        const e = new GameEngine(s, script, hue, () => {});
        e.startFirstNight({ override: true });
        const show = e.session.night!.steps.find((x) => x.characterId === "washerwoman")!.show;
        if (show.suggestedPlayerIds?.includes(me.id)) return `iteration ${i}: self suggested`;
        if (show.suggestedCharacterId === "washerwoman") return `iteration ${i}: Washerwoman suggested`;
        if (!show.infoImpaired) return `iteration ${i}: not impaired`;
      }
      return null;
    },
  },
  {
    name: "Engine: Poisoner marks the Washerwoman, rebuilt step lies without self / Washerwoman",
    run: () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const s = randomSession("washerwoman");
        const me = receiverOf(s, "washerwoman");
        const e = new GameEngine(s, script, hue, () => {});
        e.startFirstNight({ override: true });
        e.applyNightReminder(me.id, "Poisoned");
        e.rebuildNight();
        const show = e.session.night!.steps.find((x) => x.characterId === "washerwoman")!.show;
        if (!show.infoImpaired) return `iteration ${i}: not impaired`;
        if (show.suggestedPlayerIds?.includes(me.id)) return `iteration ${i}: self suggested`;
        if (show.suggestedCharacterId === "washerwoman") return `iteration ${i}: Washerwoman suggested`;
      }
      return null;
    },
  },
);

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

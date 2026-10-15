/**
 * Setup wizard: legal bags for 5-15 players, Baron adjustment, the Drunk's Townsfolk, the
 * Fortune Teller's red herring, Demon bluffs, hand-picked bags and applying a deal.
 * Run: cd server && npx tsx test/setup-wizard.ts
 */
import { notices, player, projection, runCases, script, setup, type Case } from "./_harness.js";

const wizard = await import("../src/setup-wizard.js");
type Deal = import("../src/setup-wizard.js").Deal;

/** Deterministic RNG (mulberry32) so failures can be reproduced from the seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const teamOf = (id: string) => script.characters.find((c) => c.id === id)?.team;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** Every rule a dealt game must meet; returns the first problem. */
function problem(deal: Deal, n: number): string | null {
  const bag = deal.seats.map((s) => s.characterId);
  if (deal.seats.length !== n) return `${deal.seats.length} seats for ${n} players`;
  if (new Set(bag).size !== n) return `duplicate characters ${bag}`;
  if (new Set(deal.seats.map((s) => s.playerId)).size !== n) return "a player was dealt twice";
  const need = wizard.requiredCounts(script, n, bag.includes("baron"))!;
  for (const t of ["townsfolk", "outsider", "minion", "demon"] as const) {
    const got = bag.filter((id) => teamOf(id) === t).length;
    if (got !== need[t]) return `${t}: ${got}, need ${need[t]} (bag ${bag})`;
  }
  const drunk = deal.seats.find((s) => s.characterId === "drunk");
  if (drunk) {
    if (!drunk.thinksCharacterId || teamOf(drunk.thinksCharacterId) !== "townsfolk") return `Drunk thinks ${drunk.thinksCharacterId}`;
    if (bag.includes(drunk.thinksCharacterId)) return `Drunk thinks ${drunk.thinksCharacterId}, which is in play`;
  }
  if (deal.seats.some((s) => s.characterId !== "drunk" && s.thinksCharacterId)) return "non-Drunk has thinksCharacterId";
  const ft = deal.seats.filter((s) => s.characterId === "fortuneteller" || s.thinksCharacterId === "fortuneteller");
  if (ft.length && !deal.redHerringId) return "Fortune Teller in play but no red herring";
  if (!ft.length && deal.redHerringId) return "red herring without a Fortune Teller";
  if (deal.redHerringId) {
    const rh = deal.seats.find((s) => s.playerId === deal.redHerringId);
    if (!rh) return "red herring is not a player";
    const t = teamOf(rh.characterId);
    if (t !== "townsfolk" && t !== "outsider") return `red herring is ${rh.characterId}`;
  }
  if (deal.bluffs.length !== 3 || new Set(deal.bluffs).size !== 3) return `bluffs ${deal.bluffs}`;
  for (const b of deal.bluffs) {
    const t = teamOf(b);
    if (t !== "townsfolk" && t !== "outsider") return `bluff ${b} is not good`;
    if (bag.includes(b)) return `bluff ${b} is in play`;
    if (b === drunk?.thinksCharacterId) return `bluff ${b} is the Drunk's Townsfolk`;
  }
  if (deal.baron !== bag.includes("baron")) return "baron flag wrong";
  return null;
}

const cases: Case[] = [
  {
    name: "Random deals are legal for 5-15 players (300 seeds each)",
    run: () => {
      for (let n = 5; n <= 15; n++) {
        for (let seed = 1; seed <= 300; seed++) {
          const r = wizard.proposeDeal(script, ids(n), { rng: rng(seed * 100 + n) });
          if (!r.ok) return `n=${n} seed=${seed}: ${r.errors.join(" ")}`;
          const p = problem(r.deal, n);
          if (p) return `n=${n} seed=${seed}: ${p}`;
          const v = wizard.validateDeal(script, ids(n), r.deal);
          if (!v.ok) return `n=${n} seed=${seed} failed its own validation: ${v.errors.join(" ")}`;
        }
      }
      return null;
    },
  },
  {
    name: "Baron adds two Outsiders and removes two Townsfolk (5, 7, 10, 15 players)",
    run: () => {
      const expect: Record<number, [number, number]> = { 5: [1, 2], 7: [3, 2], 10: [5, 2], 15: [7, 4] };
      for (const [n, [t, o]] of Object.entries(expect)) {
        const r = wizard.proposeDeal(script, ids(Number(n)), { include: ["baron"], rng: rng(7) });
        if (!r.ok) return `n=${n}: ${r.errors.join(" ")}`;
        if (r.deal.counts.townsfolk !== t || r.deal.counts.outsider !== o || !r.deal.baron) {
          return `n=${n}: ${JSON.stringify(r.deal.counts)}`;
        }
        const p = problem(r.deal, Number(n));
        if (p) return `n=${n}: ${p}`;
      }
      return null;
    },
  },
  {
    name: "Drunk thinks they are a Townsfolk not in play; a believed Fortune Teller still gets a red herring",
    run: () => {
      let sawBelievedFt = false;
      for (let seed = 1; seed <= 400; seed++) {
        const r = wizard.proposeDeal(script, ids(8), { include: ["drunk"], rng: rng(seed) });
        if (!r.ok) return r.errors.join(" ");
        const p = problem(r.deal, 8);
        if (p) return `seed ${seed}: ${p}`;
        const drunk = r.deal.seats.find((s) => s.characterId === "drunk")!;
        if (drunk.thinksCharacterId === "fortuneteller") {
          sawBelievedFt = true;
          if (!r.deal.redHerringId) return "Drunk-Fortune Teller without a red herring";
          if (r.deal.redHerringId === drunk.playerId) return "the Drunk-Fortune Teller is their own red herring";
        }
      }
      return sawBelievedFt ? null : "no seed produced a Drunk who thinks they are the Fortune Teller";
    },
  },
  {
    name: "Fortune Teller's red herring is another good player",
    run: () => {
      for (let seed = 1; seed <= 200; seed++) {
        const r = wizard.proposeDeal(script, ids(9), { include: ["fortuneteller"], rng: rng(seed) });
        if (!r.ok) return r.errors.join(" ");
        const ft = r.deal.seats.find((s) => s.characterId === "fortuneteller")!;
        if (r.deal.redHerringId === ft.playerId) return `seed ${seed}: the Fortune Teller is their own red herring`;
        const p = problem(r.deal, 9);
        if (p) return `seed ${seed}: ${p}`;
      }
      return null;
    },
  },
  {
    name: "Hand-picked bags: exact bag kept, over-full teams and bad ids refused",
    run: () => {
      const bag = ["washerwoman", "chef", "empath", "monk", "slayer", "poisoner", "imp"];
      const r = wizard.proposeDeal(script, ids(7), { include: bag, rng: rng(3) });
      if (!r.ok) return r.errors.join(" ");
      if ([...r.deal.seats.map((s) => s.characterId)].sort().join() !== [...bag].sort().join()) return "bag changed";
      const two = wizard.proposeDeal(script, ids(7), { include: ["poisoner", "spy"] });
      if (two.ok || !two.errors.join(" ").includes("Too many Minions")) return `two minions at 7: ${JSON.stringify(two)}`;
      const dup = wizard.proposeDeal(script, ids(7), { include: ["chef", "chef"] });
      if (dup.ok || !dup.errors.join(" ").includes("twice")) return `duplicate: ${JSON.stringify(dup)}`;
      const unknown = wizard.proposeDeal(script, ids(7), { include: ["gunslinger"] });
      if (unknown.ok) return "a non-script character was accepted";
      const outsiders = wizard.proposeDeal(script, ids(7), { include: ["drunk"] });
      if (outsiders.ok && outsiders.deal.counts.outsider !== 0 && !outsiders.deal.baron) return "Drunk at 7 without Baron";
      return null;
    },
  },
  {
    name: "validateDeal refuses edited deals that break the rules",
    run: () => {
      const base = wizard.proposeDeal(script, ids(8), { include: ["drunk", "fortuneteller", "imp"], rng: rng(11) });
      if (!base.ok) return base.errors.join(" ");
      const d = base.deal;
      const inPlayTf = d.seats.find((s) => teamOf(s.characterId) === "townsfolk")!.characterId;
      const evil = d.seats.find((s) => s.characterId === "imp")!.playerId;
      const edits: [string, unknown, string][] = [
        ["Drunk thinks in-play", { ...d, seats: d.seats.map((s) => (s.characterId === "drunk" ? { ...s, thinksCharacterId: inPlayTf } : s)) }, "in play"],
        ["evil red herring", { ...d, redHerringId: evil }, "good player"],
        ["no red herring", { ...d, redHerringId: null }, "red herring"],
        ["bluff in play", { ...d, bluffs: [inPlayTf, ...d.bluffs.slice(1)] }, "in play"],
        ["two bluffs", { ...d, bluffs: d.bluffs.slice(0, 2) }, "three bluffs"],
        ["emptied bluff", { ...d, bluffs: ["", ...d.bluffs.slice(1)] }, "Pick exactly three bluffs."],
        ["wrong counts", { ...d, seats: d.seats.map((s) => (s.characterId === "imp" ? { ...s, characterId: "spy" } : s)) }, "need T"],
        ["players changed", d, "players changed"],
      ];
      for (const [label, deal, expect] of edits) {
        const players = label === "players changed" ? ids(9) : ids(8);
        const v = wizard.validateDeal(script, players, deal);
        if (v.ok) return `${label}: accepted`;
        if (!v.errors.join(" ").includes(expect)) return `${label}: ${v.errors.join(" ")}`;
      }
      return null;
    },
  },
  {
    name: "Applying a deal fills the grimoire (lobby only); the first night records starting characters",
    run: () => {
      const e = setup(Array(8).fill(null), { phase: "lobby", day: 0 });
      const r = wizard.proposeDeal(script, ids(8), { include: ["drunk", "fortuneteller"], rng: rng(5) });
      if (!r.ok) return r.errors.join(" ");
      const res = e.applyDeal(r.deal);
      if (!res.ok) return res.message ?? "refused";
      for (const s of r.deal.seats) {
        const p = player(e, s.playerId);
        if (p.characterId !== s.characterId || p.thinksCharacterId !== s.thinksCharacterId) return `${s.playerId} not dealt`;
      }
      const drunk = e.session.players.find((p) => p.characterId === "drunk")!;
      if (!drunk.reminders.includes("Is the Drunk")) return "no Is the Drunk token";
      if (!player(e, r.deal.redHerringId!).reminders.includes("Red herring")) return "no Red herring token";
      const imp = e.session.players.find((p) => p.characterId === "imp")!;
      if (imp.bluffs.join() !== r.deal.bluffs.join()) return `bluffs ${imp.bluffs}`;
      if (projection.setupWarning(e.session, script)) return `setup warning: ${projection.setupWarning(e.session, script)}`;
      if (!notices(e).includes("Dealt 8 characters")) return notices(e);
      e.startFirstNight();
      if (e.session.startingCharacters[drunk.id] !== "drunk") return "startingCharacters not recorded";
      const again = e.applyDeal(r.deal);
      if (again.ok) return "deal accepted after the game started";
      return null;
    },
  },
];

runCases(cases);

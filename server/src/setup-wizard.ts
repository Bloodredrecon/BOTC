import type { ScriptData } from "./persistence.js";
import type { SetupCounts, Team } from "./types.js";

export type Rng = () => number;

/** One resident's dealt character. `thinksCharacterId` is set for the Drunk only. */
export type DealSeat = { playerId: string; characterId: string; thinksCharacterId: string | null };

export type Deal = {
  seats: DealSeat[];
  /** Fortune Teller's red herring (a good player); null when no Fortune Teller wakes. */
  redHerringId: string | null;
  /** Three good characters not in play, shown to the Demon. */
  bluffs: string[];
  counts: SetupCounts;
  baron: boolean;
};

export type DealResult = { ok: true; deal: Deal } | { ok: false; errors: string[] };

const BAG_TEAMS: (keyof SetupCounts)[] = ["townsfolk", "outsider", "minion", "demon"];

/** Official counts for `n` players, with the Baron's +2 Outsiders / −2 Townsfolk when `baron`. */
export function requiredCounts(script: ScriptData, n: number, baron: boolean): SetupCounts | null {
  const base = script.setupByPlayerCount[String(n)];
  if (!base) return null;
  if (!baron) return { ...base };
  return { ...base, townsfolk: Math.max(0, base.townsfolk - 2), outsider: base.outsider + 2 };
}

function teamOf(script: ScriptData, id: string): Team | null {
  return script.characters.find((c) => c.id === id)?.team ?? null;
}

function idsOf(script: ScriptData, team: Team): string[] {
  return script.characters.filter((c) => c.team === team).map((c) => c.id);
}

function shuffle<T>(list: T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function pick<T>(list: T[], rng: Rng): T | null {
  return list.length ? list[Math.floor(rng() * list.length)]! : null;
}

function nameOf(script: ScriptData, id: string): string {
  return script.characters.find((c) => c.id === id)?.name ?? id;
}

/**
 * Build a legal bag of `n` characters. `include` are characters the Storyteller wants in play
 * (any team); the rest is filled at random. The Baron (included or drawn) adds 2 Outsiders.
 */
export function buildBag(
  script: ScriptData,
  n: number,
  opts: { include?: string[]; rng?: Rng } = {},
): { ok: true; bag: string[]; counts: SetupCounts; baron: boolean } | { ok: false; errors: string[] } {
  const rng = opts.rng ?? Math.random;
  const errors: string[] = [];
  if (!script.setupByPlayerCount[String(n)]) {
    return { ok: false, errors: [`No official bag for ${n} players (5–15; Travellers are extra).`] };
  }
  const include: string[] = [];
  for (const raw of opts.include ?? []) {
    const id = String(raw);
    const team = teamOf(script, id);
    if (!team || team === "traveller") errors.push(`${id} is not a Trouble Brewing character.`);
    else if (include.includes(id)) errors.push(`${nameOf(script, id)} is listed twice.`);
    else include.push(id);
  }
  if (errors.length) return { ok: false, errors };

  const chosen = (team: Team) => include.filter((id) => teamOf(script, id) === team);
  const fill = (team: Team, count: number, have: string[]) => {
    const rest = shuffle(
      idsOf(script, team).filter((id) => !have.includes(id)),
      rng,
    );
    return [...have, ...rest.slice(0, Math.max(0, count - have.length))];
  };

  const base = script.setupByPlayerCount[String(n)]!;
  const demons = fill("demon", base.demon, chosen("demon"));
  const minions = fill("minion", base.minion, chosen("minion"));
  const baron = minions.includes("baron");
  const counts = requiredCounts(script, n, baron)!;
  const outsiders = fill("outsider", counts.outsider, chosen("outsider"));
  const townsfolk = fill("townsfolk", counts.townsfolk, chosen("townsfolk"));

  const got: SetupCounts = {
    townsfolk: townsfolk.length,
    outsider: outsiders.length,
    minion: minions.length,
    demon: demons.length,
  };
  for (const t of BAG_TEAMS) {
    if (got[t] > counts[t]) {
      errors.push(`Too many ${t === "townsfolk" ? "Townsfolk" : t[0]!.toUpperCase() + t.slice(1) + "s"}: ${n} players${baron ? " with the Baron" : ""} need ${counts[t]}, you picked ${got[t]}.`);
    } else if (got[t] < counts[t]) {
      errors.push(`Not enough ${t} characters on the script to fill ${counts[t]}.`);
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, bag: [...townsfolk, ...outsiders, ...minions, ...demons], counts, baron };
}

/** Good characters (Townsfolk first, then Outsiders) that are not in the bag and not `exclude`. */
function bluffPool(script: ScriptData, bag: string[], exclude: (string | null)[]): string[][] {
  const free = (team: Team) => idsOf(script, team).filter((id) => !bag.includes(id) && !exclude.includes(id));
  return [free("townsfolk"), free("outsider")];
}

/**
 * Deal a bag to the residents (in seat order), then pick the Drunk's Townsfolk, the Fortune Teller's
 * red herring and the Demon's three bluffs.
 */
export function dealBag(
  script: ScriptData,
  playerIds: string[],
  bag: string[],
  opts: { rng?: Rng; counts?: SetupCounts; baron?: boolean } = {},
): Deal {
  const rng = opts.rng ?? Math.random;
  const tokens = shuffle(bag, rng);
  const freeTownsfolk = idsOf(script, "townsfolk").filter((id) => !bag.includes(id));
  const seats: DealSeat[] = playerIds.map((playerId, i) => {
    const characterId = tokens[i]!;
    return {
      playerId,
      characterId,
      thinksCharacterId: characterId === "drunk" ? pick(freeTownsfolk, rng) : null,
    };
  });
  const believed = seats.find((s) => s.characterId === "drunk")?.thinksCharacterId ?? null;

  const fortuneTellers = seats.filter(
    (s) => s.characterId === "fortuneteller" || s.thinksCharacterId === "fortuneteller",
  );
  const goodOthers = seats.filter((s) => {
    const team = teamOf(script, s.characterId);
    return (team === "townsfolk" || team === "outsider") && !fortuneTellers.some((f) => f.playerId === s.playerId);
  });
  const redHerringId = fortuneTellers.length ? (pick(goodOthers, rng)?.playerId ?? null) : null;

  const [tf, out] = bluffPool(script, bag, [believed]);
  const bluffs = [...shuffle(tf!, rng), ...shuffle(out!, rng)].slice(0, 3);

  return {
    seats,
    redHerringId,
    bluffs,
    counts: opts.counts ?? countBag(script, bag),
    baron: opts.baron ?? bag.includes("baron"),
  };
}

function countBag(script: ScriptData, bag: string[]): SetupCounts {
  const counts: SetupCounts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const id of bag) {
    const t = teamOf(script, id);
    if (t && t !== "traveller") counts[t] += 1;
  }
  return counts;
}

/** Build a bag (random, partly or fully hand-picked) and deal it. */
export function proposeDeal(
  script: ScriptData,
  playerIds: string[],
  opts: { include?: string[]; rng?: Rng } = {},
): DealResult {
  const bag = buildBag(script, playerIds.length, opts);
  if (!bag.ok) return bag;
  return { ok: true, deal: dealBag(script, playerIds, bag.bag, { rng: opts.rng, counts: bag.counts, baron: bag.baron }) };
}

/**
 * Check a deal (possibly edited by the Storyteller) before it is applied: every resident gets one
 * distinct character, official counts (Baron-adjusted), the Drunk's Townsfolk is not in play,
 * the red herring is good, and the bluffs are three good characters not in play.
 */
export function validateDeal(script: ScriptData, playerIds: string[], deal: unknown): DealResult {
  const errors: string[] = [];
  const d = deal as Partial<Deal> | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.seats)) return { ok: false, errors: ["No deal to apply."] };

  const seats: DealSeat[] = d.seats.map((s) => ({
    playerId: String(s?.playerId ?? ""),
    characterId: String(s?.characterId ?? ""),
    thinksCharacterId: s?.thinksCharacterId ? String(s.thinksCharacterId) : null,
  }));
  const seatIds = seats.map((s) => s.playerId);
  if (seatIds.length !== playerIds.length || playerIds.some((id) => !seatIds.includes(id))) {
    errors.push("The players changed since this deal was made — deal again.");
  }
  const bag = seats.map((s) => s.characterId);
  const baron = bag.includes("baron");
  const need = requiredCounts(script, playerIds.length, baron);
  const have = countBag(script, bag);
  for (const id of bag) {
    const team = teamOf(script, id);
    if (!team || team === "traveller") errors.push(`${id || "(empty)"} is not a Trouble Brewing character.`);
  }
  if (new Set(bag).size !== bag.length) errors.push("Each character can be dealt only once.");
  if (!need) {
    errors.push(`No official bag for ${playerIds.length} players (5–15; Travellers are extra).`);
  } else if (BAG_TEAMS.some((t) => need[t] !== have[t])) {
    errors.push(
      `${playerIds.length} players${baron ? " with the Baron" : ""} need T${need.townsfolk}/O${need.outsider}/M${need.minion}/D${need.demon}, the deal has T${have.townsfolk}/O${have.outsider}/M${have.minion}/D${have.demon}.`,
    );
  }

  const drunk = seats.find((s) => s.characterId === "drunk");
  if (drunk) {
    if (!drunk.thinksCharacterId || teamOf(script, drunk.thinksCharacterId) !== "townsfolk") {
      errors.push("Pick the Townsfolk the Drunk thinks they are.");
    } else if (bag.includes(drunk.thinksCharacterId)) {
      errors.push(`The Drunk can't think they are the ${nameOf(script, drunk.thinksCharacterId)} — that character is in play.`);
    }
  }
  for (const s of seats) {
    if (s.characterId !== "drunk" && s.thinksCharacterId) errors.push("Only the Drunk thinks they are someone else.");
  }

  const redHerringId = d.redHerringId ? String(d.redHerringId) : null;
  const ftInPlay = seats.some((s) => s.characterId === "fortuneteller" || s.thinksCharacterId === "fortuneteller");
  if (redHerringId) {
    const target = seats.find((s) => s.playerId === redHerringId);
    const team = target ? teamOf(script, target.characterId) : null;
    if (!target) errors.push("The red herring must be one of the players.");
    else if (team !== "townsfolk" && team !== "outsider") errors.push("The red herring must be a good player.");
  } else if (ftInPlay) {
    errors.push("Pick the Fortune Teller's red herring (a good player).");
  }

  const bluffs = Array.isArray(d.bluffs) ? d.bluffs.map((b) => String(b ?? "")).filter(Boolean) : [];
  const believed = drunk?.thinksCharacterId ?? null;
  if (new Set(bluffs).size !== bluffs.length) errors.push("The bluffs must be three different characters.");
  for (const id of bluffs) {
    const team = teamOf(script, id);
    if (team !== "townsfolk" && team !== "outsider") errors.push(`${nameOf(script, id)} is not a good character, so it can't be a bluff.`);
    else if (bag.includes(id)) errors.push(`${nameOf(script, id)} is in play, so it can't be a bluff.`);
    else if (id === believed) errors.push(`${nameOf(script, id)} is what the Drunk thinks they are — pick another bluff.`);
  }
  if (bluffs.length !== 3) errors.push("Pick exactly three bluffs.");

  if (errors.length) return { ok: false, errors };
  return { ok: true, deal: { seats, redHerringId, bluffs, counts: have, baron } };
}

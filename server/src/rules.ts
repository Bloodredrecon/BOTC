import type { ScriptData } from "./persistence.js";
import {
  clearReminderBaseEverywhere,
  placeExclusiveReminder,
  playerHasReminder,
} from "./reminders.js";
import type { Alignment, GameSession, Player, SetupCounts } from "./types.js";

export type StNotice = { id: string; message: string; at: number };

export function pushStNotice(session: GameSession, message: string) {
  const list = session.stNotices ?? [];
  list.push({
    id: `n${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    message,
    at: Date.now(),
  });
  session.stNotices = list.slice(-8);
}

export function findDef(script: ScriptData, id: string | null) {
  if (!id) return undefined;
  return (
    script.characters.find((c) => c.id === id) ||
    script.travellers.find((c) => c.id === id)
  );
}

const DRUNK_CHARACTER_REMINDERS = ["Is the Drunk", "Drunk"];

/**
 * The player's real character. The Drunk is stored as characterId "drunk"; a Townsfolk still
 * carrying the legacy "Drunk" / "Is the Drunk" reminder is also the Drunk.
 */
export function trueCharacterId(script: ScriptData, p: Player): string | null {
  if (p.characterId === "drunk") return "drunk";
  if (
    p.reminders.some((r) => DRUNK_CHARACTER_REMINDERS.includes(r)) &&
    findDef(script, p.characterId)?.team === "townsfolk"
  ) {
    return "drunk";
  }
  return p.characterId;
}

/** The character the player wakes as / is prompted for (the Drunk wakes as the Townsfolk they think they are). */
export function wakeCharacterId(p: Player): string | null {
  if (p.characterId === "drunk") return p.thinksCharacterId ?? null;
  return p.characterId;
}

/** Beggar: "You are sober & healthy." */
function soberAndHealthy(p: Player): boolean {
  return p.characterId === "beggar";
}

export function isPoisoned(p: Player): boolean {
  return playerHasReminder(p, "Poisoned") && !soberAndHealthy(p);
}

export function isDrunk(p: Player): boolean {
  if (soberAndHealthy(p)) return false;
  return p.characterId === "drunk" || p.reminders.some((r) => DRUNK_CHARACTER_REMINDERS.includes(r));
}

/** Poisoned reminder, Drunk reminder, or the Drunk character. */
export function isPoisonedOrDrunk(p: Player): boolean {
  return isPoisoned(p) || isDrunk(p);
}

/** Poisoned or Drunk — ability mechanically inert. */
export function abilityDisabled(p: Player): boolean {
  return isPoisonedOrDrunk(p);
}

export function aliveNonTravellers(session: GameSession): Player[] {
  return session.players.filter((p) => p.alive && !p.leftGame && !p.isTraveller);
}

export function livingPlayers(session: GameSession): Player[] {
  return session.players.filter((p) => p.alive && !p.leftGame);
}

/** Real alignment: Travellers use the Storyteller's choice; residents follow their true character. */
export function alignmentOf(script: ScriptData, p: Player): Alignment | null {
  if (p.isTraveller) return p.alignment ?? "good";
  const team = findDef(script, trueCharacterId(script, p))?.team;
  if (!team) return null;
  return team === "minion" || team === "demon" ? "evil" : "good";
}

export function isEvil(script: ScriptData, p: Player): boolean {
  return alignmentOf(script, p) === "evil";
}

/** Whoever placed Safe: the Monk, or a Drunk who thinks they are the Monk. */
function livingMonk(session: GameSession): Player | undefined {
  return livingPlayers(session).find((p) => wakeCharacterId(p) === "monk");
}

/**
 * Safe protects unless the Monk is Poisoned/Drunk. The protected player's own poison is
 * irrelevant — poison only removes the poisoned player's own ability.
 */
export function safeProtects(session: GameSession, target: Player): boolean {
  if (!playerHasReminder(target, "Safe")) return false;
  const monk = livingMonk(session);
  if (monk && abilityDisabled(monk)) return false;
  // No living Monk but Safe token remains (e.g. Monk marked dead after choosing) — still protects.
  return true;
}

/** Soldier cannot die from demon/night kill unless Poisoned/Drunk. */
export function soldierProtects(target: Player): boolean {
  if (target.characterId !== "soldier") return false;
  if (abilityDisabled(target)) return false;
  return true;
}

/** Short label for why a Demon kill on `target` fails tonight, or null if it lands. */
export function nightKillProtection(session: GameSession, target: Player): string | null {
  if (safeProtects(session, target)) return "Protected by the Monk (Safe)";
  if (soldierProtects(target)) return "Soldier: safe from the Demon";
  return null;
}

/**
 * Night / first-night / dawn demon kills blocked by Monk Safe or Soldier.
 * Returns a reason if blocked. The kill still counts as chosen — it just fails.
 */
export function nightKillBlockReason(
  session: GameSession,
  target: Player,
): string | null {
  const why = nightKillProtection(session, target);
  return why ? `${target.name} — ${why}. Nobody dies from this kill.` : null;
}

/**
 * A Poisoned/Drunk Imp has no ability: the kill does nothing (no death, no star-pass on a
 * self-kill). Returns the Storyteller-only reason, or null if the Imp is healthy.
 */
export function impKillFailReason(imp: Player | undefined, target: Player): string | null {
  if (!imp || !abilityDisabled(imp)) return null;
  const state = isPoisoned(imp) ? "poisoned" : "drunk";
  return imp.id === target.id
    ? `${imp.name} (self) — Imp is ${state}: the kill fails. Nobody dies, no star-pass.`
    : `${target.name} — Imp (${imp.name}) is ${state}: the kill fails. Nobody dies.`;
}

/** The Imp is attacking a healthy Mayor who would die: the Storyteller may bounce the kill. */
export function mayorBounceAvailable(session: GameSession, target: Player): boolean {
  return (
    target.characterId === "mayor" &&
    target.alive &&
    !abilityDisabled(target) &&
    !nightKillProtection(session, target)
  );
}

export function isOvernightPhase(phase: GameSession["phase"]): boolean {
  return phase === "night" || phase === "firstNight" || phase === "dawn";
}

export function livingPoisoner(session: GameSession): Player | undefined {
  return livingPlayers(session).find((p) => p.characterId === "poisoner");
}

/**
 * The Poisoner died or stopped being the Poisoner (star-pass): its poison ends at once.
 * Returns the names that were cured (empty if nothing changed).
 */
export function endPoisonWithPoisoner(session: GameSession, hadLivingPoisoner: boolean): string[] {
  if (!hadLivingPoisoner || livingPoisoner(session)) return [];
  const cured = session.players.filter((p) => playerHasReminder(p, "Poisoned")).map((p) => p.name);
  if (cured.length) clearReminderBaseEverywhere(session, "Poisoned");
  return cured;
}

/** Master token holder (Butler’s chosen master). */
export function masterPlayer(session: GameSession): Player | undefined {
  return session.players.find(
    (p) => !p.leftGame && playerHasReminder(p, "Master"),
  );
}

export function livingButler(session: GameSession): Player | undefined {
  return livingPlayers(session).find((p) => p.characterId === "butler");
}

/**
 * The Butler may vote only while their Master's hand is up (alive or a ghost vote, in either
 * order). An illegal Butler hand is still tallied — dropping it would out the Butler — so this
 * only returns a Storyteller-only warning.
 */
export function butlerVoteWarning(session: GameSession, votesFor: string[]): string | null {
  const butler = livingButler(session);
  if (!butler || !votesFor.includes(butler.id) || abilityDisabled(butler)) return null;
  const master = masterPlayer(session);
  if (!master) return `Butler (${butler.name}) voted with no Master marked — tallied anyway.`;
  if (!votesFor.includes(master.id)) {
    return `Butler (${butler.name}) voted but their Master (${master.name}) is not voting — tallied anyway (only you know).`;
  }
  return null;
}

/** A living, healthy Traveller of this character (their vote-weight token only works while they live). */
function activeTraveller(session: GameSession, characterId: string): boolean {
  return livingPlayers(session).some((p) => p.characterId === characterId && !abilityDisabled(p));
}

/** Weight of one raised hand: Thief −1 / Bureaucrat ×3 (only while that Traveller lives) / normal 1. */
export function voteWeight(session: GameSession, p: Player): number {
  if (playerHasReminder(p, "Negative vote") && activeTraveller(session, "thief")) return -1;
  if (playerHasReminder(p, "3 votes") && activeTraveller(session, "bureaucrat")) return 3;
  return 1;
}

/** Effective vote total for the nominee. Every raised hand counts (illegal Butler hands too). */
export function effectiveVoteCount(session: GameSession): number {
  if (!session.nomination) return 0;
  let total = 0;
  for (const id of session.nomination.votesFor) {
    const p = session.players.find((x) => x.id === id);
    if (!p) continue;
    total += voteWeight(session, p);
  }
  return total;
}

/** +2 Outsiders while a Baron is in play — or was in the bag at setup (it does not revert). */
export function adjustSetupForBaron(
  base: SetupCounts | null,
  session: GameSession,
): SetupCounts | null {
  if (!base) return null;
  const baronInPlay =
    Boolean(session.baronInSetup) ||
    session.players.some((p) => p.characterId === "baron" && !p.leftGame);
  if (!baronInPlay) return { ...base };
  return {
    townsfolk: Math.max(0, base.townsfolk - 2),
    outsider: base.outsider + 2,
    minion: base.minion,
    demon: base.demon,
  };
}

export type WinResult = {
  winner: "good" | "evil";
  /** Shown on the TV / public state once the game has ended. */
  reason: string;
  /** Storyteller-only detail (names, roles). */
  stReason: string;
};

function isDemon(script: ScriptData, p: Player): boolean {
  return !p.isTraveller && findDef(script, p.characterId)?.team === "demon";
}

export function livingDemons(session: GameSession, script: ScriptData): Player[] {
  return livingPlayers(session).filter((p) => isDemon(script, p));
}

/**
 * Win conditions that hold at any moment of play:
 * Demon dead → Good wins; ≤2 living non-travellers with a living Demon → Evil wins.
 * Returns null until a Demon has been assigned, so an unassigned grimoire never "wins".
 */
export function standingWin(session: GameSession, script: ScriptData): WinResult | null {
  if (session.phase === "lobby" || session.phase === "ended") return null;
  const demonAssigned = session.players.some((p) => !p.leftGame && isDemon(script, p));
  if (!demonAssigned) return null;

  const demons = livingDemons(session, script);
  if (demons.length === 0) {
    return {
      winner: "good",
      reason: "The Demon is dead.",
      stReason: "No living Demon remains.",
    };
  }
  const alive = aliveNonTravellers(session).length;
  if (alive <= 2) {
    return {
      winner: "evil",
      reason: "Only two remain — and the Demon still lives.",
      stReason: `${alive} non-traveller${alive === 1 ? "" : "s"} alive and the Demon (${demons.map((d) => d.name).join(", ")}) lives.`,
    };
  }
  return null;
}

/** Travellers count toward the Mayor's three (they must be exiled first). Exiles are not executions. */
export function mayorWinAtDusk(session: GameSession): WinResult | null {
  const mayor = livingPlayers(session).find((p) => p.characterId === "mayor" && !p.isTraveller);
  if (!mayor) return null;
  if (abilityDisabled(mayor)) return null;
  if (livingPlayers(session).length !== 3) return null;
  if (session.executionOccurredToday || session.executedTodayId) return null;
  return {
    winner: "good",
    reason: "Three remain and no one was executed — the Mayor's town survives.",
    stReason: `Mayor (${mayor.name}): exactly 3 alive and no execution today.`,
  };
}

export function saintExecutedWin(session: GameSession, executedId: string): WinResult | null {
  if (!saintEvilWin(session, executedId)) return null;
  const saint = session.players.find((p) => p.id === executedId)!;
  return {
    winner: "evil",
    reason: "The Saint was executed — sacred blood damns the town.",
    stReason: `Saint (${saint.name}) died by execution.`,
  };
}

/** Scarlet Woman who must take over if the Demon dies now (healthy, and ≥5 non-travellers alive before the death). */
function eligibleScarletWoman(session: GameSession, dead: Player): { sw?: Player; aliveBefore: number } {
  // Players alive just before the Demon died (the dead Demon included).
  const aliveBefore = aliveNonTravellers(session).length + (!dead.isTraveller && !dead.alive ? 1 : 0);
  const sw = livingPlayers(session)
    .filter((p) => p.characterId === "scarletwoman" && !abilityDisabled(p) && p.id !== dead.id)
    .sort((a, b) => a.seat - b.seat)[0];
  return { sw: sw && aliveBefore >= 5 ? sw : undefined, aliveBefore };
}

/**
 * Who could receive the Imp's star-pass if `imp` killed themselves now. A healthy Scarlet Woman
 * (≥5 alive) must take it; otherwise the Storyteller chooses any living Minion.
 */
export function starPassCandidates(
  session: GameSession,
  script: ScriptData,
  imp: Player,
): { forced: Player | null; candidates: Player[] } {
  const minions = livingPlayers(session)
    .filter((p) => p.id !== imp.id && findDef(script, p.characterId)?.team === "minion")
    .sort((a, b) => a.seat - b.seat);
  // The Imp is still alive while we ask, so count them as "alive before".
  const aliveBefore = aliveNonTravellers(session).length + (imp.alive ? 0 : 1);
  const sw = minions.find((p) => p.characterId === "scarletwoman" && !abilityDisabled(p));
  return { forced: sw && aliveBefore >= 5 ? sw : null, candidates: minions };
}

function becomeDemon(session: GameSession, p: Player, via: "scarletwoman" | "starpass") {
  p.characterId = "imp";
  placeExclusiveReminder(session, p.id, "Is the Demon");
  const duringNight = session.phase === "night" || session.phase === "firstNight";
  session.newDemons = [...(session.newDemons ?? []).filter((d) => d.playerId !== p.id), { playerId: p.id, via, duringNight }];
}

/**
 * After a demon-character player dies: Scarlet Woman and/or Imp star-pass.
 * `starPassTo` = the Minion the Storyteller chose (ignored when a Scarlet Woman must take over).
 * Mutates session players; returns notices.
 */
export function resolveDemonDeath(
  session: GameSession,
  script: ScriptData,
  deadDemonId: string,
  opts: { selfKill: boolean; starPassTo?: string | null },
): string[] {
  const notices: string[] = [];
  const dead = session.players.find((p) => p.id === deadDemonId);
  if (!dead) return notices;
  const def = findDef(script, dead.characterId);
  if (def?.team !== "demon") return notices;

  const { sw: scarletWoman, aliveBefore } = eligibleScarletWoman(session, dead);
  if (scarletWoman) {
    becomeDemon(session, scarletWoman, "scarletwoman");
    notices.push(
      `Scarlet Woman (${scarletWoman.name}) becomes the Imp (${aliveBefore} non-travellers alive before the Demon died). Marked Is the Demon — wake them to show YOU ARE + the Imp.`,
    );
    return notices;
  }

  if (opts.selfKill && dead.characterId === "imp") {
    const minions = livingPlayers(session)
      .filter((p) => findDef(script, p.characterId)?.team === "minion")
      .sort((a, b) => a.seat - b.seat);
    const chosen =
      minions.find((p) => p.id === opts.starPassTo) ?? (minions.length === 1 ? minions[0] : undefined);
    if (chosen) {
      becomeDemon(session, chosen, "starpass");
      notices.push(
        `Imp star-pass: ${chosen.name} is now the Imp. Marked Is the Demon — wake them to show YOU ARE + the Imp (no kill tonight).`,
      );
      return notices;
    }
    notices.push(
      minions.length > 1
        ? "Imp star-pass: no Minion chosen — pick who becomes the Imp."
        : "Imp died to their own kill and no living Minion remains for star-pass.",
    );
  }

  const anySw = livingPlayers(session).some((p) => p.characterId === "scarletwoman");
  if (anySw) {
    notices.push(
      `No Scarlet Woman promotion (${aliveBefore} non-travellers alive before the Demon died; need ≥5 and a healthy Scarlet Woman).`,
    );
  }

  return notices;
}

/**
 * Virgin's first nomination. `spend` = the Virgin loses her ability (any valid first
 * nomination, even if poisoned or the nominator is not a Townsfolk).
 * The Drunk is never a Townsfolk; the Spy may register as one (ST choice).
 */
export function virginShouldTrigger(
  session: GameSession,
  script: ScriptData,
  nominatorId: string,
  nomineeId: string,
  opts: { spyRegistersAsTownsfolk?: boolean } = {},
): { trigger: boolean; spend: boolean; reason?: string } {
  const virgin = session.players.find((p) => p.id === nomineeId);
  if (!virgin || !virgin.alive || virgin.leftGame) return { trigger: false, spend: false };
  if (wakeCharacterId(virgin) !== "virgin") return { trigger: false, spend: false };
  if (virgin.abilityUsed || virgin.reminders.includes("No ability")) {
    return { trigger: false, spend: false };
  }
  const nominator = session.players.find((p) => p.id === nominatorId);
  if (!nominator || !nominator.alive || nominator.leftGame) {
    return {
      trigger: false,
      spend: false,
      reason: `Virgin: ${nominator?.name ?? "Nominator"} is dead — dead players cannot nominate; Virgin keeps her ability.`,
    };
  }
  if (abilityDisabled(virgin)) {
    return {
      trigger: false,
      spend: true,
      reason: `Virgin (${virgin.name}) is Poisoned/Drunk — no execution. Ability spent.`,
    };
  }
  if (trueCharacterId(script, nominator) === "drunk") {
    return {
      trigger: false,
      spend: true,
      reason: `Virgin: ${nominator.name} is the Drunk (not a Townsfolk) — no execution. Ability spent.`,
    };
  }
  if (nominator.characterId === "spy") {
    return opts.spyRegistersAsTownsfolk
      ? { trigger: true, spend: true }
      : {
          trigger: false,
          spend: true,
          reason: `Virgin: ${nominator.name} is the Spy and did not register as Townsfolk — no execution. Ability spent.`,
        };
  }
  const ndef = findDef(script, nominator.characterId);
  if (!ndef || ndef.team !== "townsfolk") {
    return {
      trigger: false,
      spend: true,
      reason: `Virgin: nominator is ${ndef?.name ?? "unassigned"} (${ndef?.team ?? "no character"}) — not Townsfolk; no execution. Ability spent.`,
    };
  }
  return { trigger: true, spend: true };
}

/**
 * Slayer's public shot. Anyone may claim to shoot (bluffs → "nothing happens").
 * The real Slayer spends the ability even when Poisoned/Drunk or on a miss (a Drunk who
 * thinks they are the Slayer is marked spent too, so the Grimoire matches their belief).
 * The Recluse may register as the Demon (ST choice) — they die, but the game goes on.
 */
export function slayerShotOutcome(
  session: GameSession,
  script: ScriptData,
  shooterId: string,
  targetId: string,
  opts: { recluseRegistersAsDemon?: boolean } = {},
): { spend: boolean; hit: boolean; reason: string } {
  const shooter = session.players.find((p) => p.id === shooterId && !p.leftGame);
  const target = session.players.find((p) => p.id === targetId && !p.leftGame);
  if (!shooter || !target) return { spend: false, hit: false, reason: "Slayer shot: player not found." };

  const isSlayer = wakeCharacterId(shooter) === "slayer";
  if (!isSlayer) {
    return { spend: false, hit: false, reason: `Slayer shot: ${shooter.name} is not the Slayer — nothing happens.` };
  }
  if (!shooter.alive) {
    return { spend: false, hit: false, reason: `Slayer shot: ${shooter.name} is dead — no ability. Nothing happens.` };
  }
  if (shooter.abilityUsed || shooter.reminders.includes("No ability")) {
    return { spend: false, hit: false, reason: `Slayer shot: ${shooter.name} already used the ability — nothing happens.` };
  }
  if (abilityDisabled(shooter)) {
    return { spend: true, hit: false, reason: `Slayer (${shooter.name}) is Poisoned/Drunk — nothing happens. Ability spent.` };
  }
  if (!target.alive) {
    return { spend: true, hit: false, reason: `Slayer shot ${target.name}, who is already dead — nothing happens. Ability spent.` };
  }
  if (isDemon(script, target)) {
    return { spend: true, hit: true, reason: `Slayer (${shooter.name}) shot the Demon (${target.name}) — they die.` };
  }
  if (target.characterId === "recluse" && opts.recluseRegistersAsDemon) {
    return { spend: true, hit: true, reason: `Slayer (${shooter.name}) shot the Recluse (${target.name}), who registered as the Demon — they die. Game continues.` };
  }
  return { spend: true, hit: false, reason: `Slayer (${shooter.name}) shot ${target.name} — not the Demon; nothing happens. Ability spent.` };
}

/** Executing a living, healthy Saint → Evil wins. (Callers check the Saint was alive before the execution.) */
export function saintEvilWin(
  session: GameSession,
  executedId: string,
): boolean {
  const p = session.players.find((x) => x.id === executedId);
  if (!p || p.characterId !== "saint") return false;
  if (abilityDisabled(p)) return false;
  return true;
}

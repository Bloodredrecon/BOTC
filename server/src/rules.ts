import type { ScriptData } from "./persistence.js";
import { placeExclusiveReminder } from "./reminders.js";
import type { GameSession, Player, SetupCounts } from "./types.js";

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

export function isPoisoned(p: Player): boolean {
  return p.reminders.includes("Poisoned");
}

export function isDrunk(p: Player): boolean {
  return p.reminders.includes("Drunk") || p.characterId === "drunk";
}

/**
 * Poisoned reminder, Drunk reminder, or characterId drunk.
 * Drunk is usually: apparent Townsfolk on characterId + "Drunk" reminder (see script notes).
 */
export function isPoisonedOrDrunk(p: Player): boolean {
  return isPoisoned(p) || isDrunk(p);
}

/** Poisoned or Drunk — ability mechanically inert for MVP enforcement. */
export function abilityDisabled(p: Player): boolean {
  return isPoisonedOrDrunk(p);
}

export function aliveNonTravellers(session: GameSession): Player[] {
  return session.players.filter((p) => p.alive && !p.leftGame && !p.isTraveller);
}

export function livingPlayers(session: GameSession): Player[] {
  return session.players.filter((p) => p.alive && !p.leftGame);
}

function livingMonk(session: GameSession): Player | undefined {
  return livingPlayers(session).find((p) => p.characterId === "monk");
}

/** Safe protects unless the protected player or the Monk is Poisoned/Drunk (Monk). */
export function safeProtects(session: GameSession, target: Player): boolean {
  if (!target.reminders.includes("Safe")) return false;
  if (isPoisoned(target)) return false;
  const monk = livingMonk(session);
  if (monk && abilityDisabled(monk)) return false;
  // No living Monk but Safe token remains — still treat as protection unless target poisoned
  return true;
}

/** Soldier cannot die from demon/night kill unless Poisoned/Drunk. */
export function soldierProtects(target: Player): boolean {
  if (target.characterId !== "soldier") return false;
  if (abilityDisabled(target)) return false;
  return true;
}

/**
 * Night / first-night / dawn demon kills blocked by Monk Safe or Soldier.
 * Returns a reason if blocked.
 */
export function nightKillBlockReason(
  session: GameSession,
  target: Player,
): string | null {
  if (safeProtects(session, target)) {
    return `${target.name} has Safe — night kill blocked (Monk protection). If Monk or target is Poisoned, remove Poisoned / Safe as needed and retry.`;
  }
  if (soldierProtects(target)) {
    return `${target.name} is the Soldier — cannot die from the Demon at night (unless Poisoned/Drunk).`;
  }
  return null;
}

export function isOvernightPhase(phase: GameSession["phase"]): boolean {
  return phase === "night" || phase === "firstNight" || phase === "dawn";
}

/** Master token holder (Butler’s chosen master). */
export function masterPlayer(session: GameSession): Player | undefined {
  return session.players.find(
    (p) => !p.leftGame && p.reminders.includes("Master"),
  );
}

export function livingButler(session: GameSession): Player | undefined {
  return livingPlayers(session).find((p) => p.characterId === "butler");
}

/** Butler may only add a vote if Master is already voting (unless Butler is drunk/poisoned). */
export function butlerCanRaiseHand(
  session: GameSession,
  voterId: string,
  votesFor: string[],
): { ok: boolean; reason?: string } {
  const butler = livingButler(session);
  if (!butler || butler.id !== voterId) return { ok: true };
  if (abilityDisabled(butler)) return { ok: true };
  const master = masterPlayer(session);
  if (!master) {
    return {
      ok: false,
      reason: "Butler has no Master marked — set Master on the grimoire, or clear Butler restriction.",
    };
  }
  if (!master.alive || master.leftGame) {
    return {
      ok: false,
      reason: `Butler’s Master (${master.name}) is dead — Butler cannot vote.`,
    };
  }
  if (!votesFor.includes(master.id)) {
    return {
      ok: false,
      reason: `Butler may only vote if Master (${master.name}) is also voting.`,
    };
  }
  return { ok: true };
}

/** Weight of one raised hand: 3 votes / Negative vote / normal 1. */
export function voteWeight(p: Player): number {
  if (p.reminders.includes("Negative vote")) return -1;
  if (p.reminders.includes("3 votes")) return 3;
  return 1;
}

/** Effective vote total for the nominee (Butler hands without Master dropped). */
export function effectiveVoteCount(session: GameSession): number {
  if (!session.nomination) return 0;
  const votes = session.nomination.votesFor;
  const butler = livingButler(session);
  const master = masterPlayer(session);
  const butlerOk =
    !butler ||
    abilityDisabled(butler) ||
    (master && master.alive && !master.leftGame && votes.includes(master.id));

  let total = 0;
  for (const id of votes) {
    if (butler && id === butler.id && !butlerOk) continue;
    const p = session.players.find((x) => x.id === id);
    if (!p) continue;
    total += voteWeight(p);
  }
  return total;
}

export function adjustSetupForBaron(
  base: SetupCounts | null,
  session: GameSession,
): SetupCounts | null {
  if (!base) return null;
  const baronInPlay = session.players.some(
    (p) => p.characterId === "baron" && !p.leftGame,
  );
  if (!baronInPlay) return { ...base };
  return {
    townsfolk: Math.max(0, base.townsfolk - 2),
    outsider: base.outsider + 2,
    minion: base.minion,
    demon: base.demon,
  };
}

export function mayorWinAtDusk(
  session: GameSession,
): { win: boolean; reason: string } | null {
  const mayor = livingPlayers(session).find((p) => p.characterId === "mayor");
  if (!mayor) return null;
  if (abilityDisabled(mayor)) return null;
  const alive = aliveNonTravellers(session).length;
  if (alive !== 3) return null;
  if (session.executedTodayId) return null;
  return {
    win: true,
    reason: `Mayor (${mayor.name}): 3 living townsfolk seats & no execution today → Good wins at dusk.`,
  };
}

/**
 * After a demon-character player dies: Imp star-pass and/or Scarlet Woman.
 * Mutates session players; returns notices.
 */
export function resolveDemonDeath(
  session: GameSession,
  script: ScriptData,
  deadDemonId: string,
  opts: { selfKill: boolean },
): string[] {
  const notices: string[] = [];
  const dead = session.players.find((p) => p.id === deadDemonId);
  if (!dead) return notices;
  const def = findDef(script, dead.characterId);
  if (def?.team !== "demon") return notices;

  // Imp star-pass: self-kill chooses a living Minion
  if (opts.selfKill && dead.characterId === "imp") {
    const minions = livingPlayers(session)
      .filter((p) => findDef(script, p.characterId)?.team === "minion")
      .sort((a, b) => a.seat - b.seat);
    if (minions.length > 0) {
      const chosen = minions[0];
      chosen.characterId = "imp";
      placeExclusiveReminder(session, chosen.id, "Is the Demon");
      notices.push(
        minions.length === 1
          ? `Imp star-pass: ${chosen.name} is now the Imp. Marked Is the Demon.`
          : `Imp star-pass: ${chosen.name} is now the Imp (first living Minion by seat). Marked Is the Demon. Reassign on Grimoire if Imp chose differently.`,
      );
      return notices;
    }
    notices.push(
      "Imp died to their own kill and no living Minion remains for star-pass.",
    );
  }

  // Scarlet Woman: Demon dead & ≥5 non-travellers still alive
  const aliveNT = aliveNonTravellers(session).length;
  if (aliveNT >= 5) {
    const sw = livingPlayers(session)
      .filter((p) => p.characterId === "scarletwoman" && !abilityDisabled(p))
      .sort((a, b) => a.seat - b.seat)[0];
    if (sw) {
      sw.characterId = "imp";
      placeExclusiveReminder(session, sw.id, "Is the Demon");
      notices.push(
        `Scarlet Woman (${sw.name}) becomes the Imp (≥${aliveNT} non-travellers alive). Marked Is the Demon.`,
      );
      return notices;
    }
  } else if (opts.selfKill) {
    notices.push(
      `No Scarlet Woman promotion (${aliveNT} non-travellers alive; need ≥5). Evil may have no Demon — check win.`,
    );
  }

  return notices;
}

export function virginShouldTrigger(
  session: GameSession,
  script: ScriptData,
  nominatorId: string,
  nomineeId: string,
): { trigger: boolean; reason?: string } {
  const virgin = session.players.find((p) => p.id === nomineeId);
  if (!virgin || !virgin.alive || virgin.leftGame) return { trigger: false };
  if (virgin.characterId !== "virgin") return { trigger: false };
  if (virgin.abilityUsed || virgin.reminders.includes("No ability")) {
    return { trigger: false };
  }
  if (abilityDisabled(virgin)) {
    return {
      trigger: false,
      reason: `Virgin (${virgin.name}) is Poisoned/Drunk — ST handles nomination (no auto-execute).`,
    };
  }
  const nominator = session.players.find((p) => p.id === nominatorId);
  if (!nominator || !nominator.alive) return { trigger: false };
  const ndef = findDef(script, nominator.characterId);
  if (!ndef || ndef.team !== "townsfolk") {
    return {
      trigger: false,
      reason: nominator.characterId
        ? `Virgin: nominator is ${ndef?.name ?? nominator.characterId} (${ndef?.team ?? "?"}) — not Townsfolk; no auto-execute.`
        : undefined,
    };
  }
  return { trigger: true };
}

export function saintEvilWin(
  session: GameSession,
  executedId: string,
): boolean {
  const p = session.players.find((x) => x.id === executedId);
  if (!p || p.characterId !== "saint") return false;
  if (abilityDisabled(p)) return false;
  return true;
}

import type { BlockState, GameSession, NominationRules, VoteOutcome } from "./types.js";

/** Hard stop: no nomination may open (not overridable). */
export function nominationsClosedReason(s: GameSession): string | null {
  switch (s.phase) {
    case "day":
    case "dusk":
      return s.nightPending ? "The day is over — the night is starting." : null;
    case "nomination":
    case "vote":
      return "A nomination is already open — resolve or cancel it first.";
    case "execution":
      return "Confirm the pending execution first.";
    default:
      return "Nominations only happen at dusk.";
  }
}

/** Nominations need Open nominations (after dusk); before that only the Storyteller override may open one. */
export function notOpenReason(s: GameSession): string | null {
  if (s.phase === "day") return "Nominations haven't opened — Go to dusk, then Open nominations.";
  if (s.phase === "dusk" && !s.nominationsOpen && !s.nightPending) {
    return "Nominations aren't open yet — press Open nominations.";
  }
  return null;
}

/** One execution per day (a Virgin execution counts). Storyteller override may bypass. */
export function dayLimitReason(s: GameSession): string | null {
  if (!s.executionOccurredToday && !s.executedTodayId) return null;
  const lastExecution = [...s.publicLog]
    .reverse()
    .find((e) => e.type === "execution" && e.dayNumber === Math.max(1, s.dayNumber || 1));
  const id = s.executedTodayId ?? (lastExecution?.type === "execution" ? lastExecution.playerId : null);
  const name = s.players.find((p) => p.id === id)?.name ?? "Someone";
  return `${name} was already executed today — only one execution per day.`;
}

/** Travellers are exiled, never nominated or executed (hard stop — the override can't bypass it). */
export function travellerNomineeReason(s: GameSession, playerId: string): string | null {
  const p = s.players.find((x) => x.id === playerId);
  return p?.isTraveller ? "Traveller — use exile" : null;
}

/** Exile needs at least half of all players still in the game (alive or dead), rounded up. */
export function exileThreshold(s: GameSession): number {
  return Math.ceil(s.players.filter((p) => !p.leftGame).length / 2);
}

/** Travellers may nominate like residents; they are exiled instead of nominated. */
export function nominatorReason(s: GameSession, playerId: string): string | null {
  const p = s.players.find((x) => x.id === playerId);
  if (!p || p.leftGame) return "Not in the game";
  if (!p.alive) return "Dead — cannot nominate";
  if (s.nominationsToday.some((n) => n.nominatorId === playerId)) return "Already nominated today";
  return null;
}

export function nomineeReason(s: GameSession, playerId: string): string | null {
  const p = s.players.find((x) => x.id === playerId);
  if (!p || p.leftGame) return "Not in the game";
  const traveller = travellerNomineeReason(s, playerId);
  if (traveller) return traveller;
  if (s.nominationsToday.some((n) => n.nomineeId === playerId)) return "Already nominated today";
  return null;
}

export function nominationRules(s: GameSession): NominationRules {
  const nominator: Record<string, string | null> = {};
  const nominee: Record<string, string | null> = {};
  for (const p of s.players) {
    nominator[p.id] = nominatorReason(s, p.id);
    nominee[p.id] = nomineeReason(s, p.id);
  }
  return {
    closedReason: nominationsClosedReason(s),
    notOpenReason: notOpenReason(s),
    dayLimitReason: dayLimitReason(s),
    nominator,
    nominee,
  };
}

/**
 * Trouble Brewing block: ≥ half the living (rounded up) and more than the block holder
 * goes on the block; matching the holder's count leaves nobody on it (the count stays
 * as the bar to beat). `forced` is the Storyteller's manual verdict.
 */
export function applyVoteToBlock(
  block: BlockState | null,
  nomineeId: string,
  votes: number,
  majority: number,
  forced?: "majority" | "no_majority" | "tie",
): { outcome: VoteOutcome; block: BlockState | null } {
  if (forced === "majority") {
    return { outcome: "majority", block: { nomineeId, votes } };
  }
  if (forced === "tie") {
    return { outcome: "tie", block: { nomineeId: null, votes: Math.max(votes, block?.votes ?? 0) } };
  }
  if (forced === "no_majority" || votes < majority) return { outcome: "no_majority", block };
  if (!block || votes > block.votes) return { outcome: "majority", block: { nomineeId, votes } };
  if (votes === block.votes) return { outcome: "tie", block: { nomineeId: null, votes } };
  return { outcome: "outvoted", block };
}

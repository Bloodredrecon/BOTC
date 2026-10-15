import { pushStNotice } from "./rules.js";
import type { GameSession, PhoneMeVote, PhoneVote, Player } from "./types.js";

/** Clockwise from the seat after the nominee; the nominee votes last (matches the TV studs). */
export function voteOrderIds(s: GameSession, nomineeId: string): string[] {
  const seated = s.players.filter((p) => !p.leftGame).sort((a, b) => a.seat - b.seat);
  const i = seated.findIndex((p) => p.id === nomineeId);
  const ordered = i < 0 ? seated : [...seated.slice(i + 1), ...seated.slice(0, i + 1)];
  return ordered.map((p) => p.id);
}

/** Why this player's hand can't go up now (the same rules as the Storyteller's vote chips). */
export function raiseBlockReason(p: Player): string | null {
  if (p.leftGame) return "You have left the game.";
  if (!p.alive && p.usedGhostVote) return "Your ghost vote is spent.";
  if (p.alive && p.characterId === "beggar" && (p.voteTokens ?? 0) < 1) {
    return "You need a vote token from a dead player first.";
  }
  return null;
}

/**
 * At vote open: seats with a connected, approved phone vote by phone. Nothing happens when phones
 * or phone voting are off, or no phone is connected (the vote is counted by hand as before).
 */
export function openPhoneVote(s: GameSession, connected: Iterable<string>) {
  if (!s.nomination) return;
  if (!s.phones.enabled || s.phones.voting !== "phones") {
    s.nomination.phoneVote = null;
    return;
  }
  const live = new Set(connected);
  const phoneSeats = s.players.filter((p) => !p.leftGame && live.has(p.id)).map((p) => p.id);
  if (phoneSeats.length === 0) {
    s.nomination.phoneVote = null;
    return;
  }
  const prev = s.nomination.phoneVote;
  s.nomination.phoneVote = {
    phoneSeats,
    handsUp: (prev?.handsUp ?? []).filter((id) => phoneSeats.includes(id)),
    overridden: (prev?.overridden ?? []).filter((id) => phoneSeats.includes(id)),
    sweep: prev?.sweep ?? null,
  };
}

/** Phones or phone voting switched off: the count stops and every hand already in stays counted. */
export function stopPhoneVote(s: GameSession): boolean {
  if (!s.nomination?.phoneVote) return false;
  s.nomination.phoneVote = null;
  return true;
}

export function isLockedSeat(pv: PhoneVote, playerId: string): boolean {
  if (pv.overridden.includes(playerId)) return true;
  if (!pv.sweep) return false;
  const at = pv.sweep.order.indexOf(playerId);
  return at >= 0 && at < pv.sweep.index;
}

function removeVote(s: GameSession, p: Player) {
  const nom = s.nomination;
  if (!nom) return;
  const idx = nom.votesFor.indexOf(p.id);
  if (idx < 0) return;
  nom.votesFor.splice(idx, 1);
  if (!p.alive) p.usedGhostVote = false;
}

/** The clock hand reaches a seat: a phone seat's hand is copied into the vote; hand-counted seats stay as tapped. */
export function lockSeat(s: GameSession, playerId: string) {
  const nom = s.nomination;
  const pv = nom?.phoneVote;
  if (!nom || !pv) return;
  if (!pv.phoneSeats.includes(playerId) || pv.overridden.includes(playerId)) return;
  const p = s.players.find((x) => x.id === playerId && !x.leftGame);
  if (!p) return;
  const want = pv.handsUp.includes(playerId);
  const have = nom.votesFor.includes(playerId);
  if (want && !have) {
    const blocked = raiseBlockReason(p);
    if (blocked) {
      if (p.alive && p.characterId === "beggar") {
        pushStNotice(s, `Beggar (${p.name}) has no vote token — a dead player must give them one first.`);
      }
      return;
    }
    nom.votesFor.push(playerId);
  } else if (!want && have) {
    removeVote(s, p);
  }
}

/** A phone raises or lowers its hand. Only its own seat, only while the vote is open and before the hand locks it. */
export function setPhoneHand(s: GameSession, playerId: string, up: boolean): { ok: true } | { ok: false; error: string } {
  const pv = s.nomination?.phoneVote;
  if (s.phase !== "vote" || !s.nomination) return { ok: false, error: "No vote is open." };
  if (!pv || !pv.phoneSeats.includes(playerId)) {
    return { ok: false, error: "The Storyteller is counting your real hand this vote." };
  }
  if (pv.overridden.includes(playerId)) return { ok: false, error: "The Storyteller has set your vote." };
  if (isLockedSeat(pv, playerId)) return { ok: false, error: "Your vote is locked." };
  const p = s.players.find((x) => x.id === playerId);
  if (!p) return { ok: false, error: "No vote is open." };
  if (up) {
    const blocked = raiseBlockReason(p);
    if (blocked) return { ok: false, error: blocked };
    if (!pv.handsUp.includes(playerId)) pv.handsUp.push(playerId);
  } else {
    pv.handsUp = pv.handsUp.filter((id) => id !== playerId);
  }
  return { ok: true };
}

/** The Storyteller tapped a phone seat: that tap stands for the rest of this vote. */
export function markOverride(s: GameSession, playerId: string) {
  const pv = s.nomination?.phoneVote;
  if (pv && pv.phoneSeats.includes(playerId) && !pv.overridden.includes(playerId)) pv.overridden.push(playerId);
}

/** Start the count, resume it after a pause, or (once finished) count again from the first seat. */
export function startSweep(s: GameSession, now: number): { ok: boolean; message?: string } {
  const nom = s.nomination;
  const pv = nom?.phoneVote;
  if (!nom || s.phase !== "vote") return { ok: false, message: "Open the vote first." };
  if (!pv) return { ok: false, message: "No phones are voting — count the hands on the chips." };
  const ms = s.phones.sweepMsPerSeat;
  const sw = pv.sweep;
  if (sw && sw.index < sw.order.length) {
    sw.paused = false;
    sw.msPerSeat = ms;
    sw.nextAt = now + ms;
    return { ok: true };
  }
  if (sw) {
    for (const id of sw.order) {
      if (!pv.phoneSeats.includes(id) || pv.overridden.includes(id)) continue;
      const p = s.players.find((x) => x.id === id);
      if (p) removeVote(s, p);
    }
  }
  const order = voteOrderIds(s, nom.nomineeId);
  pv.sweep = { order, index: 0, paused: false, msPerSeat: ms, nextAt: order.length ? now + ms : null };
  return { ok: true };
}

export function pauseSweep(s: GameSession): boolean {
  const sw = s.nomination?.phoneVote?.sweep;
  if (!sw || sw.paused || sw.index >= sw.order.length) return false;
  sw.paused = true;
  sw.nextAt = null;
  return true;
}

/** Unlock the last seat the hand passed (its phone hand counts again when the hand returns). Pauses. */
export function sweepBack(s: GameSession): boolean {
  const pv = s.nomination?.phoneVote;
  const sw = pv?.sweep;
  if (!pv || !sw || sw.index === 0) return false;
  sw.index -= 1;
  sw.paused = true;
  sw.nextAt = null;
  const id = sw.order[sw.index];
  if (pv.phoneSeats.includes(id) && !pv.overridden.includes(id)) {
    const p = s.players.find((x) => x.id === id);
    if (p) removeVote(s, p);
  }
  return true;
}

/** One step of the clock hand. False when there's nothing to do (paused, finished or no count). */
export function advanceSweep(s: GameSession, now: number): boolean {
  const sw = s.nomination?.phoneVote?.sweep;
  if (!sw || sw.paused || sw.index >= sw.order.length || s.phase !== "vote") return false;
  lockSeat(s, sw.order[sw.index]);
  sw.index += 1;
  sw.nextAt = sw.index < sw.order.length ? now + sw.msPerSeat : null;
  return true;
}

/** After an undo or a restart: a count that was running waits for the Storyteller to resume it. */
export function haltSweep(s: GameSession): boolean {
  const sw = s.nomination?.phoneVote?.sweep;
  if (!sw || sw.paused || sw.index >= sw.order.length) return false;
  sw.paused = true;
  sw.nextAt = null;
  return true;
}

/** This seat's hand, for its own phone. */
export function meVote(s: GameSession, playerId: string): PhoneMeVote | null {
  const nom = s.nomination;
  if (!nom || (s.phase !== "nomination" && s.phase !== "vote")) return null;
  const p = s.players.find((x) => x.id === playerId && !x.leftGame);
  if (!p) return null;
  const pv = nom.phoneVote;
  const byPhone = Boolean(pv?.phoneSeats.includes(playerId));
  const storytellerSet = Boolean(pv?.overridden.includes(playerId));
  const counted = nom.votesFor.includes(playerId);
  const blocked = raiseBlockReason(p);
  const ghost = !p.alive && !p.usedGhostVote ? "Raising your hand uses your ghost vote." : null;
  return {
    byPhone,
    handUp: byPhone && !storytellerSet ? pv!.handsUp.includes(playerId) : counted,
    locked: pv ? isLockedSeat(pv, playerId) : false,
    storytellerSet,
    counted,
    canRaise: !blocked,
    note: blocked ?? ghost,
  };
}

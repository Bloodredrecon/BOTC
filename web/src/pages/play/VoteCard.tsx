import { useEffect, useRef, useState } from "react";
import type { PlayerState } from "../../types";

type Emit = (event: string, data?: unknown, ack?: (r: unknown) => void) => void;

/** The open nomination: a big hand button for phone-voting seats, a reminder for hand-counted ones. */
export function VoteCard({ state, emit }: { state: PlayerState; emit: Emit }) {
  const nom = state.nomination;
  const v = state.me.vote;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasLocked = useRef(v?.locked ?? false);

  useEffect(() => {
    if (v?.locked && !wasLocked.current) navigator.vibrate?.(60);
    wasLocked.current = v?.locked ?? false;
  }, [v?.locked]);
  useEffect(() => setError(null), [v?.handUp, v?.locked, state.phase]);

  if (!nom || !v) return null;
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? "?";
  const need = nom.toBeat != null ? Math.max(nom.majority, nom.toBeat + 1) : nom.majority;
  const sweep = nom.phoneVote?.sweep ?? null;
  const myAt = sweep ? sweep.order.indexOf(state.me.playerId) : -1;
  const away = sweep && myAt >= sweep.index ? myAt - sweep.index : null;

  const send = (up: boolean) => {
    setBusy(true);
    setError(null);
    emit("player:hand", { up }, (r) => {
      setBusy(false);
      const res = r as { ok?: boolean; error?: string };
      if (!res?.ok) setError(res?.error ?? "That didn't go through.");
    });
  };

  let status: string;
  if (state.phase === "nomination") status = "The vote opens soon — get ready.";
  else if (!v.byPhone) status = "Raise your real hand — the Storyteller is counting this seat.";
  else if (v.storytellerSet) status = `The Storyteller set your vote: ${v.counted ? "hand up" : "no vote"}.`;
  else if (v.locked) status = v.counted ? "Locked — your vote counts." : "Locked — no vote.";
  else if (sweep && away != null && !sweep.paused) {
    status = away === 0 ? "The clock hand is on you now." : `The clock hand reaches you in ${away} ${away === 1 ? "seat" : "seats"}.`;
  } else if (sweep?.paused) status = "The count is paused.";
  else status = "Raise your real hand too. Your vote locks when the clock hand reaches you.";

  const canPress = state.phase === "vote" && v.byPhone && !v.locked && !busy && (v.handUp || v.canRaise);

  return (
    <section className={`play-card play-vote ${v.handUp ? "up" : ""} ${v.locked ? "locked" : ""}`} aria-label="Vote">
      <p className="play-vote-pair">
        <b>{nameOf(nom.nominatorId)}</b> nominated <b>{nameOf(nom.nomineeId)}</b>
      </p>
      <p className="play-vote-tally" aria-label={`${nom.votesForCount} of ${need} votes`}>
        {nom.votesForCount} <span>/ {need}</span>
      </p>
      {v.byPhone && state.phase === "vote" && (
        <button
          type="button"
          className="play-hand"
          aria-pressed={v.handUp}
          disabled={!canPress}
          onClick={() => send(!v.handUp)}
        >
          {v.handUp ? "Hand up" : "Raise my hand"}
          <small>{v.locked ? "Locked" : v.handUp ? "Tap to lower" : v.canRaise ? "Tap to vote" : "Can't vote"}</small>
        </button>
      )}
      <p className="play-vote-status" role="status">
        {status}
      </p>
      {v.note && <p className="play-vote-note">{v.note}</p>}
      {error && <p className="play-error">{error}</p>}
    </section>
  );
}

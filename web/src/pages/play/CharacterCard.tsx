import { useEffect, useRef, useState } from "react";
import type { PhoneMe } from "../../types";
import { teamLabel } from "./TownView";

const AUTO_HIDE_MS = 5000;

/**
 * Hold to see your character; it hides on release or after 5 s, so a glance over the shoulder
 * catches nothing. "Changed" shows when the Storyteller re-sent a different card since you last looked.
 */
export function CharacterCard({ me, gameId, dim = false }: { me: PhoneMe; gameId: string; dim?: boolean }) {
  const seenKey = `botc.card.${gameId}.${me.playerId}`;
  const [seenAt, setSeenAt] = useState(() => Number(localStorage.getItem(seenKey) ?? 0));
  const [shown, setShown] = useState(false);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => setSeenAt(Number(localStorage.getItem(seenKey) ?? 0)), [seenKey]);
  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
  }, []);

  if (!me.character || !me.revealedAt) {
    return (
      <div className={`play-card play-reveal-card empty ${dim ? "dim" : ""}`}>
        <p className="play-kicker">Your character</p>
        <p className="play-muted">The Storyteller hasn&apos;t sent characters to phones yet. Use the token you were given at the table.</p>
      </div>
    );
  }

  const changed = seenAt > 0 && me.revealedAt > seenAt;
  const unseen = seenAt === 0;

  const show = () => {
    setShown(true);
    localStorage.setItem(seenKey, String(me.revealedAt));
    setSeenAt(me.revealedAt ?? 0);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShown(false), AUTO_HIDE_MS);
  };
  const hide = () => {
    setShown(false);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
  };

  return (
    <button
      type="button"
      className={`play-card play-reveal-card ${shown ? "shown" : ""} ${shown ? (me.alignment ?? "") : ""} ${dim ? "dim" : ""}`}
      aria-label={shown ? `${me.character.name}, ${me.alignment ?? ""}` : "Hold to see your character"}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        show();
      }}
      onPointerUp={hide}
      onPointerCancel={hide}
      onLostPointerCapture={hide}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) show();
      }}
      onKeyUp={hide}
      onBlur={hide}
      onContextMenu={(e) => e.preventDefault()}
    >
      {shown ? (
        <>
          <span className={`play-team ${me.character.team}`}>{teamLabel(me.character.team)}</span>
          <span className="play-reveal-name">{me.character.name}</span>
          <span className={`play-reveal-align ${me.alignment ?? ""}`}>
            {me.alignment === "evil" ? "You are evil" : me.alignment === "good" ? "You are good" : ""}
          </span>
          <span className="play-reveal-ability">{me.character.ability}</span>
        </>
      ) : (
        <>
          {(changed || unseen) && <span className="play-badge">{changed ? "Your card changed" : "New"}</span>}
          <span className="play-reveal-hold">Hold to see your character</span>
          <span className="play-muted">Hides when you let go</span>
        </>
      )}
    </button>
  );
}

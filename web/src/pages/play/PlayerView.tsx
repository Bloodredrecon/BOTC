import { useState } from "react";
import type { PlayerState } from "../../types";
import { CharacterCard } from "./CharacterCard";
import { SheetView, TownView, isNight, phaseLine } from "./TownView";

type Emit = (event: string, data?: unknown, ack?: (r: unknown) => void) => void;

export function PlayHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="play-head">
      <span className="play-brand small">Ravenswood Bluff</span>
      <span className="play-head-title">{title}</span>
      <span className="play-head-sub">{sub}</span>
    </header>
  );
}

/** An approved phone: character (hold to reveal), the town, and the script sheet. Night is a dark screen. */
export function PlayerView({ state, onLeave }: { state: PlayerState; emit: Emit; onLeave: () => void }) {
  const [tab, setTab] = useState<"character" | "town">("character");
  const me = state.me;
  const title = `${me.name || `Seat ${me.seat}`} · seat ${me.seat}`;

  if (isNight(state.phase)) {
    return (
      <div className="play play-night">
        <div className="play-night-sky">
          <p className="play-night-moon" aria-hidden>
            ☾
          </p>
          <h2 className="play-title">{phaseLine(state)}</h2>
          <p className="play-muted">Put your phone face down and close your eyes. The Storyteller will wake you.</p>
        </div>
        <CharacterCard me={me} gameId={state.gameId} dim />
      </div>
    );
  }

  return (
    <div className="play">
      <PlayHeader title={title} sub={phaseLine(state)} />
      {!me.alive && (
        <div className="play-card play-dead" role="status">
          <b>You are dead.</b> Keep talking — you have {me.usedGhostVote ? "used your one ghost vote" : "one ghost vote left"}.
        </div>
      )}
      <nav className="play-tabs" aria-label="Sections">
        <button type="button" className={tab === "character" ? "on" : ""} onClick={() => setTab("character")}>
          Character
        </button>
        <button type="button" className={tab === "town" ? "on" : ""} onClick={() => setTab("town")}>
          Town
        </button>
      </nav>
      {tab === "character" ? (
        <div className="play-stack">
          <CharacterCard me={me} gameId={state.gameId} />
          <details className="play-card play-details">
            <summary>Characters in this script</summary>
            <SheetView sheet={state.sheet} />
          </details>
          <button
            type="button"
            className="ghost play-leave"
            onClick={() => {
              if (confirm("Unlink this phone from your seat? You can join again with the code on the TV.")) onLeave();
            }}
          >
            Not my seat? Unlink this phone
          </button>
        </div>
      ) : (
        <TownView state={state} meId={me.playerId} />
      )}
    </div>
  );
}

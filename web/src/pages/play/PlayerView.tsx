import { useState } from "react";
import type { PlayerState } from "../../types";
import { CharacterCard } from "./CharacterCard";
import { MessagesView, unreadReplies } from "./MessagesView";
import { NotesView } from "./NotesView";
import { SheetView, TownView, isNight, phaseLine } from "./TownView";
import { VoteCard } from "./VoteCard";
import { useWakeLock } from "./wakeLock";

type Emit = (event: string, data?: unknown, ack?: (r: unknown) => void) => void;
type Tab = "character" | "town" | "notes" | "ask";

const TABS: [Tab, string][] = [
  ["character", "Card"],
  ["town", "Town"],
  ["notes", "Notes"],
  ["ask", "Ask"],
];

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
export function PlayerView({ state, emit, onLeave }: { state: PlayerState; emit: Emit; onLeave: () => void }) {
  const [tab, setTab] = useState<Tab>("character");
  const me = state.me;
  const unread = tab === "ask" ? 0 : unreadReplies(state);
  const title = `${me.name || `Seat ${me.seat}`} · seat ${me.seat}`;
  const night = isNight(state.phase);
  // By day the screen stays on (HTTPS only); at night the phone may sleep face down.
  const wake = useWakeLock(!night);

  if (night) {
    return (
      <div className="play play-night" data-wakelock={wake}>
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
    <div className="play" data-wakelock={wake}>
      <PlayHeader title={title} sub={phaseLine(state)} />
      {!me.alive && (
        <div className="play-card play-dead" role="status">
          <b>You are dead.</b> Keep talking — you have {me.usedGhostVote ? "used your one ghost vote" : "one ghost vote left"}.
        </div>
      )}
      <VoteCard state={state} emit={emit} />
      <nav className="play-tabs" aria-label="Sections">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {label}
            {id === "ask" && unread > 0 && <span className="play-tab-badge">{unread}</span>}
          </button>
        ))}
      </nav>
      {tab === "notes" ? (
        <NotesView state={state} />
      ) : tab === "ask" ? (
        <MessagesView state={state} emit={emit} />
      ) : tab === "character" ? (
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
          {wake === "on" && <p className="play-muted play-wake">Your screen stays on while this page is open by day.</p>}
        </div>
      ) : (
        <TownView state={state} meId={me.playerId} />
      )}
    </div>
  );
}

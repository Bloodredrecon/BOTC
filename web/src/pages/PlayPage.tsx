import { useCallback, useState } from "react";
import { PHONE_TOKEN_KEY, useSocket, usePhone } from "../socket";
import { JoinFlow } from "./play/JoinFlow";
import { PlayHeader, PlayerView } from "./play/PlayerView";
import { SheetView, TownView, phaseLine } from "./play/TownView";
import "./play/play.css";

const MODE_KEY = "botc.phone.mode";

function Screen({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="play">
      <div className="play-card play-center">
        <h1 className="play-brand">Ravenswood Bluff</h1>
        <i className="ornament" aria-hidden />
        <h2 className="play-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function PlayPage() {
  const { socketRef, connected, emit } = useSocket();
  const [mode, setModeState] = useState<"player" | "spectator">(() =>
    sessionStorage.getItem(MODE_KEY) === "spectator" ? "spectator" : "player",
  );
  const setMode = useCallback((m: "player" | "spectator") => {
    sessionStorage.setItem(MODE_KEY, m);
    setModeState(m);
  }, []);
  const { status, state, watch } = usePhone(socketRef, mode);

  const leave = () => {
    emit("player:leave", {}, () => localStorage.removeItem(PHONE_TOKEN_KEY));
  };

  if (!status) return <Screen title={connected ? "Joining…" : "Connecting…"} />;

  if (status.status === "off") {
    const hadSeat = !!localStorage.getItem(PHONE_TOKEN_KEY);
    return (
      <Screen title={hadSeat ? "Player phones are turned off" : "Player phones are off for this game"}>
        <p className="play-muted">
          {hadSeat
            ? "The Storyteller is running the game at the table for now. Your seat is remembered if phones come back on."
            : "The Storyteller is running this game the usual way, at the table. You can close this page."}
        </p>
      </Screen>
    );
  }

  if (status.status === "watching") {
    return (
      <div className="play">
        <PlayHeader title="Watching" sub={watch ? phaseLine(watch) : ""} />
        {watch ? (
          <>
            <TownView state={watch} />
            <details className="play-card play-details">
              <summary>Characters in this script</summary>
              <SheetView sheet={watch.sheet} />
            </details>
          </>
        ) : (
          <p className="play-muted">Loading the town…</p>
        )}
        <button type="button" className="ghost play-leave" onClick={() => setMode("player")}>
          Join as a player instead
        </button>
      </div>
    );
  }

  if (status.status === "unclaimed") {
    return <JoinFlow status={status} emit={emit} onWatch={() => setMode("spectator")} />;
  }

  if (status.status === "pending") {
    return (
      <Screen title="Waiting for the Storyteller">
        <p className="play-pick">
          <span className="play-seat-n">{status.seat}</span> {status.name || `Seat ${status.seat}`}
        </p>
        <p className="play-muted">The Storyteller approves each phone. Keep this page open.</p>
        <button type="button" className="ghost" onClick={leave}>
          Not you? Pick again
        </button>
      </Screen>
    );
  }

  if (!state) return <Screen title="Loading your seat…" />;
  return <PlayerView state={state} emit={emit} onLeave={leave} />;
}

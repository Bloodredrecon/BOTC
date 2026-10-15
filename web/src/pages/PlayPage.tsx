import { useSocket, usePhone } from "../socket";
import "./play/play.css";

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
  const { socketRef, connected } = useSocket();
  const { status } = usePhone(socketRef, "player");

  if (!status) return <Screen title={connected ? "Joining…" : "Connecting…"} />;
  if (status.status === "off") {
    return (
      <Screen title="Player phones are off for this game">
        <p className="play-muted">The Storyteller is running this game the usual way, at the table. You can close this page.</p>
      </Screen>
    );
  }
  return (
    <Screen title="Player phones are on">
      <p className="play-muted">Seat claiming is not available in this version yet.</p>
    </Screen>
  );
}

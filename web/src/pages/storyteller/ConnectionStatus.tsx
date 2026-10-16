import { useEffect, useState } from "react";
import type { Presence } from "../../socket";

function clock(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ConnectionPills({
  connected,
  presence,
  tvSoundReady,
}: {
  connected: boolean;
  presence: Presence | null;
  /** From session: TV tapped Enable sound (not inferred from connection). */
  tvSoundReady?: boolean;
}) {
  const tvOn = connected && (presence?.tv ?? 0) > 0;
  const soundOn = tvOn && Boolean(tvSoundReady);
  return (
    <div className="conn-pills" aria-label="Connections">
      <span className={`conn-pill ${connected ? "on" : "off"}`} title="This device to the server">
        Server
      </span>
      <span
        className={`conn-pill ${tvOn ? "on" : "off"}`}
        title={presence ? `TV ${tvOn ? "connected" : "not connected"} since ${clock(presence.tvChangedAt)}` : "TV status unknown"}
      >
        TV{presence && presence.tv > 1 ? ` ×${presence.tv}` : ""}
      </span>
      <span
        className={`conn-pill ${soundOn ? "on" : "off"}`}
        title={
          soundOn
            ? "TV sound ready — Enable sound succeeded"
            : tvOn
              ? "TV connected but sound not confirmed — tap Enable sound on the TV"
              : "TV sound ready after Enable sound on the TV"
        }
      >
        Sound
      </span>
    </div>
  );
}

export function ConnectionBanners({
  connected,
  presence,
  phase,
  droppedAt,
}: {
  connected: boolean;
  presence: Presence | null;
  phase: string;
  droppedAt: number | null;
}) {
  const [showDropped, setShowDropped] = useState(false);
  useEffect(() => {
    if (!droppedAt) return;
    setShowDropped(true);
    const t = setTimeout(() => setShowDropped(false), 6000);
    return () => clearTimeout(t);
  }, [droppedAt]);

  return (
    <>
      {!connected && (
        <div className="panel conn-banner" role="alert">
          Connection to the server lost. Reconnecting… Taps are <b>not sent</b> until it is back; the screen below may
          be out of date.
        </div>
      )}
      {connected && showDropped && (
        <div className="panel conn-banner" role="status">
          A tap made while offline was not sent. Check the screen and repeat it if needed.
        </div>
      )}
      {connected && presence && presence.tv === 0 && phase !== "lobby" && (
        <div className="panel conn-banner tv-off" role="status">
          The TV is not connected (since {clock(presence.tvChangedAt)}). Reopen <b>/tv</b> on the TV or check its
          Wi-Fi; it catches up automatically when it reconnects.
        </div>
      )}
    </>
  );
}

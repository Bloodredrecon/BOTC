import type { StorytellerState } from "../../types";

type EmitFn = (e: string, d?: unknown, ack?: (result: unknown) => void) => void;

/** Setup tab: the opt-in "Player phones" setting. Off = the usual way (tokens at the table, manual votes). */
export function PhonesPanel({ state, emit }: { state: StorytellerState; emit: EmitFn }) {
  const ph = state.phones;
  return (
    <div className="panel">
      <h2>Player phones</h2>
      <p className="muted">
        {ph.enabled
          ? "On: players can join on their phones for their character, notes, messages and voting."
          : "Off: the usual way. Characters go out as tokens at the table and you tap the votes."}
      </p>
      <button
        type="button"
        className={ph.enabled ? "primary" : ""}
        aria-pressed={ph.enabled}
        onClick={() => {
          if (
            ph.enabled &&
            ph.claims.length > 0 &&
            !confirm(
              "Turn player phones off? Phones show “phones turned off” and get nothing private. Their seats are kept, so turning phones back on re-links them.",
            )
          ) {
            return;
          }
          emit("game:setPhones", { on: !ph.enabled });
        }}
      >
        {ph.enabled ? "Player phones: on (tap to turn off)" : "Turn player phones on"}
      </button>
      {ph.enabled && (
        <p className="muted" style={{ marginBottom: 0 }}>
          Join code <b style={{ fontFamily: "Cinzel, serif", letterSpacing: "0.12em" }}>{ph.joinCode}</b> · {ph.claims.length} phone
          {ph.claims.length === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}

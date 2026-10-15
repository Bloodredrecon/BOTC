import { useState } from "react";
import type { PhoneClaimInfo, Player, StorytellerState } from "../../types";

type EmitFn = (e: string, d?: unknown, ack?: (result: unknown) => void) => void;
type Ack = { ok?: boolean; message?: string; error?: string; code?: string; expiresAt?: number };

function charName(state: StorytellerState, id: string | null | undefined): string {
  if (!id) return "—";
  return [...state.characters, ...state.travellers].find((c) => c.id === id)?.name ?? id;
}

/** What the phone should show now (mirrors the server: the Drunk sees their believed Townsfolk). */
function shouldShow(p: Player): string | null {
  return p.characterId === "drunk" ? (p.thinksCharacterId ?? null) : p.characterId;
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

function seatName(state: StorytellerState, playerId: string): string {
  const p = state.players.find((x) => x.id === playerId);
  return p ? `${p.seat} · ${p.name || `Seat ${p.seat}`}` : playerId;
}

/** Top of the Storyteller page: phones waiting for approval, on every tab. */
export function PendingClaimsBanner({ state, emit }: { state: StorytellerState; emit: EmitFn }) {
  const ph = state.phones;
  if (!ph?.enabled) return null;
  const pending = ph.claims.filter((c) => c.status === "pending");
  if (!pending.length) return null;
  return (
    <div className="panel phone-pending" role="status">
      <h2>Phone{pending.length === 1 ? "" : "s"} asking for a seat</h2>
      <ul className="phone-claim-list">
        {pending.map((c) => (
          <li key={c.id}>
            <span>
              <b>{c.deviceLabel}</b> asks for seat <b>{seatName(state, c.playerId)}</b>
            </span>
            <span className="row">
              <button type="button" className="primary" onClick={() => emit("game:phoneApprove", { claimId: c.id })}>
                Approve
              </button>
              <button type="button" onClick={() => emit("game:phoneDeny", { claimId: c.id })}>
                Deny
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClaimRow({
  c,
  state,
  emit,
  hasActive,
}: {
  c: PhoneClaimInfo;
  state: StorytellerState;
  emit: EmitFn;
  hasActive: boolean;
}) {
  const seated = state.players.filter((p) => !p.leftGame).sort((a, b) => a.seat - b.seat);
  return (
    <li className={`phone-claim ${c.status}`}>
      <span className="phone-claim-what">
        <i className={`phone-dot ${c.connected > 0 ? "on" : ""}`} aria-hidden />
        {c.deviceLabel}
        <span className="muted">
          {" "}
          · {c.status === "pending" ? "waiting for you" : c.connected > 0 ? "connected" : `seen ${ago(c.lastSeenAt)}`}
        </span>
      </span>
      <span className="row phone-claim-actions">
        {c.status === "pending" ? (
          <>
            <button type="button" className="primary" onClick={() => emit("game:phoneApprove", { claimId: c.id })}>
              Approve
            </button>
            {hasActive && (
              <button type="button" onClick={() => emit("game:phoneApprove", { claimId: c.id, keepOthers: true })}>
                Approve as 2nd phone
              </button>
            )}
            <button type="button" onClick={() => emit("game:phoneDeny", { claimId: c.id })}>
              Deny
            </button>
          </>
        ) : (
          <>
            <select
              aria-label="Move this phone to another seat"
              value=""
              onChange={(e) => {
                if (e.target.value) emit("game:phoneReassign", { claimId: c.id, playerId: e.target.value });
              }}
            >
              <option value="">Move to seat…</option>
              {seated
                .filter((p) => p.id !== c.playerId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.seat} · {p.name || `Seat ${p.seat}`}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (confirm(`Unlink ${c.deviceLabel} from seat ${seatName(state, c.playerId)}?`)) {
                  emit("game:phoneRevoke", { claimId: c.id });
                }
              }}
            >
              Unlink
            </button>
          </>
        )}
      </span>
    </li>
  );
}

/** Setup tab: the opt-in "Player phones" setting and, when on, the device panel. */
export function PhonesPanel({ state, emit }: { state: StorytellerState; emit: EmitFn }) {
  const ph = state.phones;
  const [note, setNote] = useState<string | null>(null);
  const [handover, setHandover] = useState<{ playerId: string; code: string; expiresAt: number } | null>(null);
  const seated = state.players.filter((p) => !p.leftGame).sort((a, b) => a.seat - b.seat);
  const anyRevealed = seated.some((p) => ph.private[p.id]?.revealedCharacterId);

  const report = (r: unknown) => {
    const a = r as Ack;
    setNote(a.ok === false ? (a.message ?? a.error ?? "That didn't work.") : (a.message ?? null));
  };

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
        <>
          <div className="phone-code-row">
            <span>
              Join code <b className="phone-code">{ph.joinCode}</b>
            </span>
            <span className="muted">
              {ph.claims.filter((c) => c.status === "active").length} linked · {ph.spectators} watching
            </span>
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => {
                if (confirm("Show a new join code? Linked phones stay linked; only new joins need the new code.")) {
                  emit("game:phoneRotateCode");
                }
              }}
            >
              New code
            </button>
            <button type="button" aria-pressed={ph.claimsOpen} onClick={() => emit("game:phoneClaimsOpen", { open: !ph.claimsOpen })}>
              {ph.claimsOpen ? "Close seat claims" : "Open seat claims"}
            </button>
            <button
              type="button"
              className="danger"
              disabled={ph.claims.length === 0}
              onClick={() => {
                if (confirm("Unlink every phone? Players will have to join again.")) emit("game:phoneClearClaims");
              }}
            >
              Unlink all phones
            </button>
          </div>
          {!ph.claimsOpen && <p className="muted">Seat claims are closed: the TV hides the code and new phones can&apos;t ask.</p>}

          <h3 className="phone-sub">Voting</h3>
          <p className="muted">
            {ph.voting === "phones"
              ? "Phone voting: connected phones raise hands, and the clock hand locks each seat in turn. Seats without a phone are counted on the chips."
              : "Phones off for voting: every hand is counted on the chips, as without phones."}
          </p>
          <button
            type="button"
            aria-pressed={ph.voting === "phones"}
            onClick={() => emit("game:phoneVoting", { mode: ph.voting === "phones" ? "manual" : "phones" })}
          >
            {ph.voting === "phones" ? "Phones off for voting" : "Use phone voting"}
          </button>

          <h3 className="phone-sub">Characters on phones</h3>
          <p className="muted">
            Sends each player what they should believe (the Drunk sees their Townsfolk; Travellers see their alignment). Later
            grimoire changes reach a phone only when you press Re-send, or at the new-Demon wake.
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (!anyRevealed || confirm("Phones already have characters. Send everyone their current character again?")) {
                emit("game:phoneDistribute", {}, report);
              }
            }}
          >
            {anyRevealed ? "Send characters again" : "Send characters to phones"}
          </button>
          {note && <p className="muted">{note}</p>}

          <ul className="phone-seats">
            {seated.map((p) => {
              const claims = ph.claims.filter((c) => c.playerId === p.id);
              const priv = ph.private[p.id];
              const shown = priv?.revealedCharacterId ?? null;
              const want = shouldShow(p);
              const stale = !!shown && (shown !== want || (p.isTraveller && priv?.revealedAlignment !== (p.alignment ?? "good")));
              return (
                <li key={p.id} className="phone-seat">
                  <div className="phone-seat-head">
                    <b>
                      {p.seat} · {p.name || `Seat ${p.seat}`}
                    </b>
                    <span className="muted">
                      Phone shows: {shown ? `${charName(state, shown)} (${priv?.revealedAlignment ?? "?"})` : "nothing yet"}
                    </span>
                  </div>
                  {stale && (
                    <p className="warn phone-stale">
                      Grimoire now says {charName(state, want)}. The phone still shows {charName(state, shown)} until you Re-send.
                    </p>
                  )}
                  {claims.length > 0 ? (
                    <ul className="phone-claim-list">
                      {claims.map((c) => (
                        <ClaimRow key={c.id} c={c} state={state} emit={emit} hasActive={claims.some((x) => x.status === "active")} />
                      ))}
                    </ul>
                  ) : (
                    <p className="muted phone-none">No phone</p>
                  )}
                  <div className="row">
                    <button type="button" disabled={!want} onClick={() => emit("game:phoneResend", { playerId: p.id }, report)}>
                      Re-send character
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        emit("game:phoneHandover", { playerId: p.id }, (r) => {
                          const a = r as Ack;
                          if (a.ok && a.code && a.expiresAt) setHandover({ playerId: p.id, code: a.code, expiresAt: a.expiresAt });
                          else report(r);
                        })
                      }
                    >
                      Hand-over code
                    </button>
                  </div>
                  {handover?.playerId === p.id && handover.expiresAt > Date.now() && (
                    <p className="phone-handover">
                      On the new phone: open /play, tap “I have a hand-over code”, type <b className="phone-code">{handover.code}</b>{" "}
                      <span className="muted">(works once, for 10 minutes)</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

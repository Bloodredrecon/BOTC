import { useEffect, useRef, useState } from "react";
import { PHONE_TOKEN_KEY } from "../../socket";
import type { PhoneStatus } from "../../types";

type Emit = (event: string, data?: unknown, ack?: (r: unknown) => void) => void;
type Seat = { id: string; seat: number; name: string; taken: boolean };
type Ack = { ok: boolean; error?: string; token?: string; seats?: Seat[] };

const REASONS: Record<string, string> = {
  denied: "The Storyteller said no to that seat. Check with them, then pick again.",
  revoked: "The Storyteller unlinked this phone from its seat.",
  replaced: "Your seat moved to another phone.",
  cleared: "A new game started. Join again with the code on the TV.",
  unknown: "This phone's seat link wasn't recognised. Join again with the code on the TV.",
};

function cleanCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Code from the TV → pick your seat → confirm → wait for the Storyteller. Or a hand-over code, or just watch. */
export function JoinFlow({
  status,
  emit,
  onWatch,
}: {
  status: Extract<PhoneStatus, { status: "unclaimed" }>;
  emit: Emit;
  onWatch: () => void;
}) {
  const [code, setCode] = useState(() => cleanCode(new URLSearchParams(window.location.search).get("c") ?? ""));
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [pick, setPick] = useState<Seat | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [handover, setHandover] = useState(false);
  const [hcode, setHcode] = useState("");
  const autoLooked = useRef(false);

  const lookup = (c = code) => {
    setBusy(true);
    setError(null);
    emit("player:lookup", { code: c }, (r) => {
      const a = r as Ack;
      setBusy(false);
      if (!a.ok) return setError(a.error ?? "That didn't work.");
      setSeats(a.seats ?? []);
    });
  };

  useEffect(() => {
    if (!autoLooked.current && code.length === 4) {
      autoLooked.current = true;
      lookup(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const store = (a: Ack) => {
    if (a.token) localStorage.setItem(PHONE_TOKEN_KEY, a.token);
  };

  const claim = (seat: Seat) => {
    setBusy(true);
    setError(null);
    const name = displayName.trim().slice(0, 32);
    emit("player:claim", { code, playerId: seat.id, ...(name ? { name } : {}) }, (r) => {
      const a = r as Ack;
      setBusy(false);
      if (!a.ok) return setError(a.error ?? "That didn't work.");
      store(a);
    });
  };

  const useHandover = () => {
    setBusy(true);
    setError(null);
    emit("player:handover", { code: hcode }, (r) => {
      const a = r as Ack;
      setBusy(false);
      if (!a.ok) return setError(a.error ?? "That didn't work.");
      store(a);
    });
  };

  const reason = status.reason ? REASONS[status.reason] : null;

  return (
    <div className="play">
      <div className="play-card play-center">
        <h1 className="play-brand">Ravenswood Bluff</h1>
        <i className="ornament" aria-hidden />
        {reason && (
          <p className="play-banner" role="status">
            {reason}
          </p>
        )}

        {handover ? (
          <>
            <h2 className="play-title">Hand-over code</h2>
            <p className="play-muted">The Storyteller can give you a 6-letter code to move your seat to this phone.</p>
            <input
              className="play-code-input"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={8}
              value={hcode}
              aria-label="Hand-over code"
              onChange={(e) => setHcode(cleanCode(e.target.value))}
            />
            <button type="button" className="primary play-wide" disabled={busy || hcode.length < 6} onClick={useHandover}>
              Use this code
            </button>
            <button type="button" className="ghost" onClick={() => setHandover(false)}>
              Back
            </button>
          </>
        ) : pick ? (
          <>
            <h2 className="play-title">Is this you?</h2>
            <p className="play-pick">
              <span className="play-seat-n">{pick.seat}</span> {pick.name || `Seat ${pick.seat}`}
            </p>
            {pick.taken && <p className="play-muted">This seat already has a phone. The Storyteller decides which one keeps it.</p>}
            <label className="play-profile-name">
              <span className="play-muted">Your name (shown on the TV)</span>
              <input
                value={displayName}
                maxLength={32}
                autoComplete="nickname"
                placeholder={pick.name || `Seat ${pick.seat}`}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
            <p className="play-muted">You can add a photo after you claim the seat.</p>
            <button type="button" className="primary play-wide" disabled={busy} onClick={() => claim(pick)}>
              Yes, that&apos;s me
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setPick(null);
                setDisplayName("");
              }}
            >
              Pick another seat
            </button>
          </>
        ) : seats ? (
          <>
            <h2 className="play-title">Which seat is yours?</h2>
            {seats.length === 0 ? (
              <p className="play-muted">No seats yet. Ask the Storyteller to set up the table.</p>
            ) : (
              <ol className="play-seat-pick">
                {seats.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPick(s);
                        setDisplayName(s.name && !/^Player \d+$/i.test(s.name) && !/^Seat\d+$/i.test(s.name) ? s.name : "");
                      }}
                    >
                      <span className="play-seat-n">{s.seat}</span>
                      <span className="play-seat-name">{s.name || `Seat ${s.seat}`}</span>
                      {s.taken && <small>has a phone</small>}
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <button type="button" className="ghost" onClick={() => lookup()}>
              Refresh the list
            </button>
          </>
        ) : (
          <>
            <h2 className="play-title">Join the game</h2>
            <p className="play-muted">Type the code shown on the TV.</p>
            <input
              className="play-code-input"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={6}
              value={code}
              aria-label="Join code"
              onChange={(e) => setCode(cleanCode(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.length >= 4) lookup();
              }}
            />
            <button type="button" className="primary play-wide" disabled={busy || code.length < 4} onClick={() => lookup()}>
              Find my seat
            </button>
          </>
        )}

        {error && (
          <p className="play-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {!handover && (
        <div className="play-alt">
          <button type="button" className="ghost" onClick={() => setHandover(true)}>
            I have a hand-over code
          </button>
          <button type="button" className="ghost" onClick={onWatch}>
            Just watch
          </button>
        </div>
      )}
    </div>
  );
}

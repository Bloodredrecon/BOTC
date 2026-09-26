import { useEffect, useMemo, useRef, useState } from "react";
import { isAudioUnlocked, playCue, syncAmbiance, unlockAudio } from "../audio";
import { useSocket, useTvState } from "../socket";
import type { Phase, PublicEvent, PublicPlayer, PublicState } from "../types";

/** Scene plate only — swap via CSS `--tv-bg` or Atmosphere `backgroundSrc`. */
declare const __TV_BG_MTIME__: string;
const TV_BG_DEFAULT = `/tv/bg-night.jpg?v=${__TV_BG_MTIME__}`;
const TV_EL = {
  dayMarker: "/tv/elements/day-marker.png",
  townFrame: "/tv/elements/town-frame.png",
  ledger: "/tv/elements/ledger-panel.png",
} as const;

/** Sharp typographic wordmark — PNG logo had muddy bright fringe on dark BGs. */
function TvBrandLogo() {
  return (
    <div className="tv-brand" aria-hidden="true">
      <div className="tv-brand-stack">
        <span className="tv-brand-blood">Blood</span>
        <span className="tv-brand-on">
          <i className="tv-brand-rule" />
          <em>on the</em>
          <i className="tv-brand-rule" />
        </span>
        <span className="tv-brand-clock">Clocktower</span>
      </div>
      <svg className="tv-brand-drips" viewBox="0 0 320 36" preserveAspectRatio="none" aria-hidden>
        <path
          fill="currentColor"
          d="M18 0c1 6 2 10 1 16-1 5-3 9-2 14 4-6 5-12 4-18 2 4 3 9 2 14M52 0c2 7 1 12 2 18 0 5-1 9 1 14 3-8 2-14 1-20 3 5 4 11 3 18M88 0c1 5 3 11 2 17 0 6-2 10 0 15 4-7 5-13 3-20 2 4 3 10 2 16M124 0c2 8 1 13 0 19 2 5 4 9 2 14 5-9 3-15 2-22 2 5 3 12 2 18M160 0c1 6 2 12 1 18-1 5 1 10 0 15 4-7 4-14 3-20 2 5 3 11 2 17M196 0c2 7 1 13 2 19 0 4-2 9 1 13 3-6 4-12 2-18 3 5 4 12 3 18M232 0c1 5 2 11 1 17 1 6-1 10 1 15 4-8 4-13 3-20 2 4 3 11 2 16M268 0c2 8 1 12 0 18 2 5 3 10 1 14 5-8 4-14 3-21 2 5 3 12 2 18M302 0c1 6 2 11 1 17 0 5-1 9 1 14 3-7 4-13 2-19 2 4 3 10 2 16"
        />
      </svg>
    </div>
  );
}

function phaseLabel(phase: PublicState["phase"], dayNumber: number) {
  switch (phase) {
    case "lobby":
      return "GATHERING";
    case "firstNight":
      return "FIRST NIGHT";
    case "night":
      return "NIGHT";
    case "dawn":
      return `DAWN · DAY ${dayNumber === 0 ? 1 : dayNumber + 1}`;
    case "day":
      return `DAY ${dayNumber}`;
    case "nomination":
      return "NOMINATION";
    case "vote":
      return "VOTE";
    case "execution":
      return "EXECUTION";
    case "ended":
      return "THE REVEAL";
    default:
      return phase;
  }
}

/** Clocktower day/night index (not wall-clock time). */
function clocktowerMark(phase: Phase, dayNumber: number): { kind: "day" | "night" | "none"; n: number } {
  switch (phase) {
    case "lobby":
      return { kind: "none", n: 0 };
    case "firstNight":
      return { kind: "night", n: 1 };
    case "night":
      return { kind: "night", n: Math.max(1, dayNumber + 1) };
    case "dawn":
      return { kind: "night", n: Math.max(1, dayNumber + 1) };
    case "day":
    case "nomination":
    case "vote":
    case "execution":
      return { kind: "day", n: Math.max(1, dayNumber) };
    case "ended":
      return { kind: "day", n: Math.max(1, dayNumber) };
    default:
      return { kind: "none", n: 0 };
  }
}

function useCountdown(endsAt: number | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** First night is 1 (dayNumber 0 at dawn); later nights are dayNumber + 1. */
function chronicleNight(dayNumber: number | undefined): number {
  return Math.max(1, (dayNumber ?? 0) + 1);
}

function chronicleDay(dayNumber: number | undefined): number {
  return Math.max(1, dayNumber ?? 1);
}

/** Old sessions may lack duringNight; never surface reason/killer text. */
function otherDeathWasOvernight(e: Extract<PublicEvent, { type: "other_death" }>): boolean {
  if (e.duringNight === true) return true;
  if (e.duringNight === false) return false;
  return /imp|demon|star.?pass|night/i.test(e.reason ?? "");
}

type LedgerLine = {
  text: string;
  marker?: { kind: "night" | "day"; n: number };
  emphasis?: boolean;
};

function ledgerLine(e: PublicEvent, nameOf: (id: string) => string): LedgerLine {
  switch (e.type) {
    case "night_death": {
      const n = chronicleNight(e.dayNumber);
      const names = e.playerIds.map(nameOf).filter(Boolean);
      if (names.length === 0) {
        return { text: `Someone died during night ${n}`, marker: { kind: "night", n }, emphasis: true };
      }
      return {
        text: `${names.join(" · ")} died during night ${n}`,
        marker: { kind: "night", n },
        emphasis: true,
      };
    }
    case "nomination":
      return {
        text: `${nameOf(e.nominatorId)} nominates ${nameOf(e.nomineeId)}`,
      };
    case "vote_result":
      return {
        text: `Vote on ${nameOf(e.nomineeId)}: ${e.votesFor}/${e.majority} — ${e.outcome.replace("_", " ")}`,
      };
    case "execution": {
      const day = chronicleDay(e.dayNumber);
      if (e.died) {
        return {
          text: `${nameOf(e.playerId)} was executed on day ${day}`,
          marker: { kind: "day", n: day },
          emphasis: true,
        };
      }
      return {
        text: `${nameOf(e.playerId)} lived on day ${day}`,
        marker: { kind: "day", n: day },
      };
    }
    case "other_death": {
      if (otherDeathWasOvernight(e)) {
        const n = chronicleNight(e.dayNumber);
        return {
          text: `${nameOf(e.playerId)} died during night ${n}`,
          marker: { kind: "night", n },
          emphasis: true,
        };
      }
      const day = chronicleDay(e.dayNumber);
      return {
        text: `${nameOf(e.playerId)} died by day on day ${day}`,
        marker: { kind: "day", n: day },
        emphasis: true,
      };
    }
    case "traveller_join":
      return {
        text: `Traveller arrives: ${e.playerName || nameOf(e.playerId)}`,
      };
    case "traveller_leave":
      return {
        text: `Traveller departs: ${e.playerName || nameOf(e.playerId)}`,
      };
  }
}

function AliveIcon() {
  return (
    <svg className="tv-seat-icon" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      <path
        d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SkullIcon() {
  return (
    <svg className="tv-seat-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2.5c-4.4 0-8 3.2-8 7.4 0 2.6 1.3 4.9 3.3 6.2V19c0 .8.7 1.5 1.5 1.5h1.2c.4 0 .8-.2 1-.5l.5-.8.5.8c.2.3.6.5 1 .5h1.2c.8 0 1.5-.7 1.5-1.5v-2.9c2-.1 3.3-3.6 3.3-6.2C20 5.7 16.4 2.5 12 2.5zm-2.4 8.2a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4.8 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zM10.2 15.2l1.8-1.4 1.8 1.4H10.2z"
      />
    </svg>
  );
}

function DawnDeathReveal({ deaths }: { deaths: { id: string; name: string }[] }) {
  return (
    <div className="tv-dawn-banner">
      <p className="tv-dawn-kicker">THE NIGHT CLAIMED…</p>
      {deaths.length === 0 ? (
        <p className="tv-dawn-empty">No one</p>
      ) : (
        <ul className="tv-dawn-names">
          {deaths.map((d, i) => (
            <li key={d.id} style={{ animationDelay: `${i * 0.85}s` }}>
              {d.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VoteRing({
  players,
  nomination,
  nameOf,
}: {
  players: PublicPlayer[];
  nomination: NonNullable<PublicState["nomination"]>;
  nameOf: (id: string) => string;
}) {
  const ringPlayers = players.filter((p) => !p.leftGame);
  const voteSet = useMemo(() => new Set(nomination.votesFor), [nomination.votesFor]);
  const majorityMet = nomination.votesForCount >= nomination.majority;
  const prevMajority = useRef(false);
  const [beat, setBeat] = useState(false);

  useEffect(() => {
    if (majorityMet && !prevMajority.current) {
      setBeat(true);
      const t = window.setTimeout(() => setBeat(false), 900);
      prevMajority.current = true;
      return () => clearTimeout(t);
    }
    if (!majorityMet) prevMajority.current = false;
  }, [majorityMet]);

  const n = ringPlayers.length || 1;

  return (
    <div className={`tv-vote-ring ${majorityMet ? "majority-met" : ""} ${beat ? "majority-beat" : ""}`}>
      <div className="tv-vote-plaque">
        <p className="tv-vote-kicker">On the square</p>
        <p className="tv-vote-headline">
          <span className="tv-vote-nominee">{nameOf(nomination.nomineeId)}</span>
        </p>
        <p className="tv-vote-sub">
          Nominated by <span className="tv-vote-nominator">{nameOf(nomination.nominatorId)}</span>
        </p>
      </div>

      <div className="tv-vote-tally-row">
        <span className={`tv-vote-tally ${majorityMet ? "over" : ""}`}>
          <span className="count">{nomination.votesForCount}</span>
          <span className="sep">/</span>
          <span className="need">{nomination.majority}</span>
        </span>
        <span className="tv-vote-threshold-label">{majorityMet ? "Majority" : "Majority needed"}</span>
      </div>

      {/* One centered stage: CSS brass ring + seats share the same origin */}
      <div className="tv-vote-stage">
        <div className="tv-vote-circle" role="list">
          <div className="tv-vote-ring-chrome" aria-hidden />
          <div className="tv-vote-ring-line" aria-hidden />
          {ringPlayers.map((p, i) => {
            const angle = (i / n) * 360 - 90;
            const voted = voteSet.has(p.id);
            const isNominee = p.id === nomination.nomineeId;
            const isNominator = p.id === nomination.nominatorId;
            return (
              <div
                key={p.id}
                role="listitem"
                className={[
                  "tv-vote-seat",
                  p.alive ? "alive" : "dead",
                  voted ? "voted" : "",
                  isNominee ? "nominee" : "",
                  isNominator ? "nominator" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ ["--a" as string]: `${angle}deg` }}
              >
                <span className="tv-vote-token" aria-hidden />
                <span className="tv-vote-seat-name">{p.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TownLedger({
  events,
  nameOf,
  phase,
  dayNumber,
}: {
  events: PublicEvent[];
  nameOf: (id: string) => string;
  phase: Phase;
  dayNumber: number;
}) {
  const mark = clocktowerMark(phase, dayNumber);
  const newestFirst = [...events].reverse().slice(0, 6);

  return (
    <div className="tv-bg-align">
      <section className="tv-ledger" aria-label="Ravenswood Gazette">
        <img className="tv-ledger-chrome" src={TV_EL.ledger} alt="" draggable={false} />
        <div className="tv-ledger-body">
          {mark.kind !== "none" && (
            <div className={`tv-ledger-phase-badge ${mark.kind}`}>
              <span className="tv-ledger-phase-icon" aria-hidden>
                {mark.kind === "night" ? "☾" : "☀"}
              </span>
              <span>
                {mark.kind === "night" ? "NIGHT" : "DAY"} {mark.n}
              </span>
            </div>
          )}
          <ul className="tv-ledger-lines">
            {newestFirst.map((e, i) => {
              const line = ledgerLine(e, nameOf);
              const age = i === 0 ? "fresh" : i < 3 ? "recent" : "aged";
              return (
                <li
                  key={`${e.at}-${i}`}
                  className={`tv-ledger-line ${age} ${line.emphasis ? "death" : ""}`}
                  style={{ ["--fade" as string]: String(Math.min(0.5, i * 0.07)) }}
                >
                  <p className={line.emphasis ? "emph" : undefined}>{line.text}</p>
                  {line.marker && (
                    <span className={`tv-ledger-marker ${line.marker.kind}`}>
                      {line.marker.kind === "night" ? "NIGHT" : "DAY"} {line.marker.n}
                    </span>
                  )}
                </li>
              );
            })}
            {events.length === 0 && (
              <li className="tv-ledger-line aged empty">
                <p>No public notices. The presses wait for blood.</p>
              </li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Atmosphere({ backgroundSrc = TV_BG_DEFAULT }: { backgroundSrc?: string }) {
  return (
    <div className="tv-atmosphere" aria-hidden>
      <div
        className="tv-atmosphere-plate"
        role="img"
        aria-label=""
        style={{
          backgroundImage: `url(${backgroundSrc})`,
          ["--tv-bg" as string]: `url(${backgroundSrc})`,
        }}
      />
      <div className="tv-atmosphere-tint" />
      <div className="tv-atmosphere-vignette" />
      <div className="tv-atmosphere-mist" />
    </div>
  );
}

export function TvPage() {
  const { socketRef, connected } = useSocket();
  const { state } = useTvState(socketRef);
  const [soundOn, setSoundOn] = useState(isAudioUnlocked());
  const seconds = useCountdown(state?.timer?.endsAt);

  useEffect(() => {
    if (!state?.soundCue || !soundOn) return;
    playCue(state.soundCue);
  }, [state?.seq, state?.soundCue, soundOn]);

  useEffect(() => {
    if (!state?.ambiance) return;
    syncAmbiance(state.ambiance);
  }, [state?.ambiance, soundOn]);

  const nameOf = useMemo(() => {
    const map = new Map(state?.players.map((p) => [p.id, p.name]) ?? []);
    return (id: string) => map.get(id) ?? id;
  }, [state?.players]);

  async function enableSound() {
    try {
      await unlockAudio();
      setSoundOn(true);
    } catch {
      alert("Could not unlock audio. Tap again after interacting with the page.");
    }
  }

  if (!state) {
    return (
      <div className="tv phase-lobby">
        <Atmosphere />
        <TvBrandLogo />
        <h1 className="visually-hidden">Blood on the Clocktower</h1>
        <div className="tv-hero-center">
          <div
            className="tv-day-marker-chrome"
            style={{ backgroundImage: `url(${TV_EL.dayMarker})` }}
            aria-hidden
          />
          <div className="tv-hero-copy">
            <p className="tv-phase-line">GATHERING</p>
            <p className="tv-meta">{connected ? "Waiting for game state…" : "Connecting…"}</p>
          </div>
        </div>
      </div>
    );
  }

  const seated = state.players.filter((p) => !p.leftGame);
  const alive = seated.filter((p) => p.alive).length;
  const dawnDeaths = state.dawnDeathIds.map((id) => ({ id, name: nameOf(id) }));
  const showTimer = seconds !== null && state.timer;
  const showVote =
    !!state.nomination && (state.phase === "nomination" || state.phase === "vote");
  const stageActive =
    state.phase === "ended" ||
    state.phase === "dawn" ||
    state.phase === "execution" ||
    showTimer ||
    showVote;

  return (
    <div className={`tv phase-${state.phase}`}>
      <Atmosphere />
      <h1 className="visually-hidden">Blood on the Clocktower</h1>

      <TvBrandLogo />

      {!soundOn && (
        <div className="sound-gate">
          <div className="panel">
            <h2>Enable town sound</h2>
            <p className="muted">
              Browsers block audio until you allow it. Pair Bluetooth speakers to this TV, then tap
              below.
            </p>
            <button className="primary" onClick={enableSound}>
              Enable sound
            </button>
          </div>
        </div>
      )}

      <header
        className={`tv-hero-center ${stageActive ? "compact" : ""} ${showVote ? "vote-stage" : ""}`}
      >
        <div
          className="tv-day-marker-chrome"
          style={{ backgroundImage: `url(${TV_EL.dayMarker})` }}
          aria-hidden
        />
        <div className="tv-hero-copy">
          {/* Plaque owns the stage during nomination/vote — demote phase wordmark (same idea as execution). */}
          {state.phase !== "execution" && !showVote && (
            <p className="tv-phase-line">{phaseLabel(state.phase, state.dayNumber)}</p>
          )}
          {state.phase === "execution" && (
            <p className="tv-phase-kicker">About to die</p>
          )}
          {showVote && (
            <p className="tv-phase-kicker">
              {state.phase === "vote" ? "Vote open" : "Nomination"}
            </p>
          )}
          <p className="tv-meta">
            {state.scriptName}
            <span className="tv-meta-sep" aria-hidden>
              ·
            </span>
            {alive} alive
            <span className="tv-meta-sep" aria-hidden>
              ·
            </span>
            {seated.length} seats
            {state.fabled.length > 0 && (
              <>
                <span className="tv-meta-sep" aria-hidden>
                  ·
                </span>
                Fabled: {state.fabled.map((f) => f.name).join(", ")}
              </>
            )}
          </p>

          {state.phase === "dawn" && state.dawnDeathsAnnounced && (
            <DawnDeathReveal deaths={dawnDeaths} />
          )}
        </div>
      </header>

      {state.phase === "ended" && state.reveal && (
        <div className="tv-stage tv-reveal">
          <h2 className="tv-stage-title">The town unmasked</h2>
          <p className="omen-line tv-winner">
            {state.winner === "good"
              ? "Good wins"
              : state.winner === "evil"
                ? "Evil wins"
                : "Game ended"}
          </p>
          <div className="roster tv-reveal-roster">
            {state.reveal.map((p) => (
              <div key={p.id} className={`seat ${p.alive ? "" : "dead"}`}>
                <div className="num">
                  Seat {p.seat}
                  {p.isTraveller ? " · Traveller" : ""}
                </div>
                <div className="name">{p.name}</div>
                <div className={`badge ${p.team ?? ""}`}>{p.characterName ?? "?"}</div>
                <div className="muted">{p.team ?? "unknown"}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {state.phase === "execution" && state.executionPendingId && (
        <div className="tv-stage tv-execution">
          <p className="tv-execution-phase">EXECUTION</p>
          <p className="tv-execution-name">{nameOf(state.executionPendingId)}</p>
        </div>
      )}

      {showTimer && (
        <div className="tv-stage tv-timer-stage">
          <h2 className="tv-stage-title">{state.timer!.label}</h2>
          <div className={`timer-big ${seconds! <= 10 ? "urgent" : ""}`}>{seconds}</div>
        </div>
      )}

      {showVote && state.nomination && (
        <div className="tv-stage tv-stage-vote">
          <VoteRing players={state.players} nomination={state.nomination} nameOf={nameOf} />
        </div>
      )}

      <section className="tv-town" aria-label="The Town">
        <img className="tv-town-chrome" src={TV_EL.townFrame} alt="" draggable={false} />
        {/* Title "THE TOWN" is baked into town-frame.png — do not double-print */}
        <div className="tv-town-body">
          <div className="tv-town-grid">
            {seated.map((p) => (
              <article key={p.id} className={`tv-seat-card ${p.alive ? "alive" : "dead"}`}>
                <div className="tv-seat-top">
                  {p.alive ? <AliveIcon /> : <SkullIcon />}
                  <span className="tv-seat-num">#{p.seat}</span>
                </div>
                <div className="tv-seat-name">{p.name}</div>
                <div className="tv-seat-status">
                  {p.alive
                    ? p.isTraveller
                      ? "Traveller · Alive"
                      : "Alive"
                    : p.usedGhostVote
                      ? "Dead · vote spent"
                      : "Dead · ghost vote"}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <TownLedger
        events={state.publicLog}
        nameOf={nameOf}
        phase={state.phase}
        dayNumber={state.dayNumber}
      />
    </div>
  );
}

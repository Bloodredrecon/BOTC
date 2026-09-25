import { useEffect, useMemo, useState } from "react";
import { isAudioUnlocked, playCue, unlockAudio } from "../audio";
import { useSocket, useTvState } from "../socket";
import type { PublicEvent, PublicState } from "../types";

function phaseLabel(phase: PublicState["phase"], dayNumber: number) {
  switch (phase) {
    case "lobby":
      return "Gathering";
    case "firstNight":
      return "First Night";
    case "night":
      return "Night";
    case "dawn":
      return "Dawn";
    case "day":
      return `Day ${dayNumber}`;
    case "nomination":
      return "Nomination";
    case "vote":
      return "Vote";
    case "execution":
      return "Execution";
    case "ended":
      return "Game Over";
    default:
      return phase;
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

function formatLog(
  e: PublicEvent,
  nameOf: (id: string) => string,
): string {
  switch (e.type) {
    case "night_death":
      return `Night deaths: ${e.playerIds.map(nameOf).join(", ") || "None"}`;
    case "nomination":
      return `${nameOf(e.nominatorId)} nominates ${nameOf(e.nomineeId)}`;
    case "vote_result":
      return `Vote on ${nameOf(e.nomineeId)}: ${e.votesFor}/${e.majority} — ${e.outcome.replace("_", " ")}`;
    case "execution":
      return e.died
        ? `${nameOf(e.playerId)} was executed`
        : `${nameOf(e.playerId)} survived execution`;
    case "other_death":
      return `${nameOf(e.playerId)} died (${e.reason})`;
  }
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
      <div className="tv">
        <div className="tv-hero">
          <h1 className="brand">Blood on the Clocktower</h1>
          <p className="meta">{connected ? "Waiting for game state…" : "Connecting…"}</p>
        </div>
      </div>
    );
  }

  const alive = state.players.filter((p) => p.alive).length;
  const dawnNames = state.dawnDeathIds.map(nameOf);
  const showTimer = seconds !== null && state.timer;

  return (
    <div className={`tv phase-${state.phase}`}>
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

      <header className="tv-hero">
        <h1 className="brand">Blood on the Clocktower</h1>
        <p className="phase">{phaseLabel(state.phase, state.dayNumber)}</p>
        <p className="meta">
          {state.scriptName} · {alive} alive · {state.players.length} seats
          {state.fabled.length > 0 && ` · Fabled: ${state.fabled.map((f) => f.name).join(", ")}`}
        </p>
      </header>

      {state.phase === "dawn" && (
        <div className="panel" style={{ textAlign: "center" }}>
          <h2>The night claimed…</h2>
          <p style={{ fontSize: "2rem", margin: "0.5rem 0" }}>
            {dawnNames.length ? dawnNames.join(" · ") : "No one — yet"}
          </p>
        </div>
      )}

      {state.phase === "execution" && state.executionPendingId && (
        <div className="panel" style={{ textAlign: "center" }}>
          <h2>About to die</h2>
          <p style={{ fontSize: "3rem", margin: 0 }}>{nameOf(state.executionPendingId)}</p>
        </div>
      )}

      {showTimer && (
        <div className="panel">
          <h2>{state.timer!.label}</h2>
          <div className={`timer-big ${seconds! <= 10 ? "urgent" : ""}`}>{seconds}</div>
        </div>
      )}

      {state.nomination && (state.phase === "nomination" || state.phase === "vote") && (
        <div className="panel vote-board">
          <div>
            {nameOf(state.nomination.nominatorId)} → {nameOf(state.nomination.nomineeId)}
          </div>
          <div style={{ marginTop: "0.75rem", fontFamily: "Cinzel, serif", fontSize: "2.5rem" }}>
            {state.nomination.votesForCount} / {state.nomination.majority}
          </div>
          <div className="muted">votes · majority needed</div>
        </div>
      )}

      <div className="tv-grid">
        <section className="panel">
          <h2>Town</h2>
          <div className="roster">
            {state.players.map((p) => (
              <div key={p.id} className={`seat ${p.alive ? "" : "dead"}`}>
                <div className="num">Seat {p.seat}</div>
                <div className="name">{p.name}</div>
                <div className="muted">
                  {p.alive ? "Alive" : p.usedGhostVote ? "Dead · vote spent" : "Dead · ghost vote"}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Town chronicle</h2>
          <ul className="log">
            {[...state.publicLog].reverse().map((e, i) => (
              <li key={`${e.at}-${i}`}>{formatLog(e, nameOf)}</li>
            ))}
            {state.publicLog.length === 0 && <li>No public events yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

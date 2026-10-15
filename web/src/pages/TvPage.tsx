import { useEffect, useMemo, useState } from "react";
import { isAudioUnlocked, playCue, syncAmbiance, unlockAudio } from "../audio";
import { useSocket, useTvState } from "../socket";
import { plateHasLogo, plateKeyForPhase } from "./tv/assets";
import { Atmosphere } from "./tv/Atmosphere";
import { OakPlaque, PhaseWord, TvBrandLogo, TvLabel, TvScript } from "./tv/chrome";
import "./tv/fonts";
import { panelVisibility, townColumns } from "./tv/model";
import { CharacterSheet, DawnReveal, DayTag, Gazette, HeroPlaque, TimerBadge, TownBoard } from "./tv/panels";
import { ExecutionStage, ExileStage, NominationStage, VoteStage } from "./tv/stages";
import "./tv/tv.css";

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

function SoundGate({ onEnable }: { onEnable: () => void }) {
  return (
    <div className="sound-gate">
      <div className="panel">
        <h2>Enable town sound</h2>
        <p className="muted">
          Browsers block audio until you allow it. Pair Bluetooth speakers to this TV, then tap below.
        </p>
        <button className="primary" onClick={onEnable}>
          Enable sound
        </button>
      </div>
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
    const lobbyPlate = plateKeyForPhase("lobby");
    const lobbyLogo = plateHasLogo(lobbyPlate);
    return (
      <div className={`tv phase-lobby tv-plate-${lobbyPlate} ${lobbyLogo ? "tv-plate-logo" : ""}`}>
        <Atmosphere phase="lobby" />
        <div className="tv-stage16">
          {!lobbyLogo && <TvBrandLogo />}
          <header className="tv-hero">
            <OakPlaque className="tv-hero-plaque">
              <TvLabel>Ravenswood Bluff</TvLabel>
              <PhaseWord>Gathering</PhaseWord>
              <TvScript className="tv-meta">{connected ? "Waiting for the storyteller…" : "Connecting…"}</TvScript>
            </OakPlaque>
          </header>
        </div>
      </div>
    );
  }

  const seated = state.players.filter((p) => !p.leftGame).sort((a, b) => a.seat - b.seat);
  const alive = seated.filter((p) => p.alive).length;
  const dawnDeaths = state.dawnDeathIds.map((id) => ({ id, name: nameOf(id) }));
  const panels = panelVisibility(state.phase);
  const nomination = state.nomination;
  const showNomination = !!nomination && state.phase === "nomination";
  const showVote = !!nomination && state.phase === "vote";
  const showExecution = state.phase === "execution" && !!state.executionPendingId;
  const showExile = !!state.exile && (state.phase === "day" || state.phase === "dusk");
  const drama =
    state.phase === "nomination" || state.phase === "vote" || state.phase === "execution" || showExile;
  const showDawn = state.phase === "dawn" && state.dawnDeathsAnnounced;
  const showSheet = !!state.sheet && !drama;
  const showTimer = seconds !== null && !!state.timer;
  const plateKey = plateKeyForPhase(state.phase, state.winner, state.dayNumber);
  const plateLogo = plateHasLogo(plateKey);

  return (
    <div
      className={[
        "tv",
        `phase-${state.phase}`,
        `tv-plate-${plateKey}`,
        plateLogo ? "tv-plate-logo" : "",
        Math.ceil(seated.length / townColumns(seated.length)) >= 4 ? "tv-town-tall" : "",
        drama ? "tv-drama-focus" : "",
        showDawn ? "tv-dawn-funeral" : "",
        showTimer ? "has-timer" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Atmosphere phase={state.phase} winner={state.winner} dayNumber={state.dayNumber} />
      <h1 className="visually-hidden">Blood on the Clocktower</h1>

      {!soundOn && <SoundGate onEnable={enableSound} />}

      <div className="tv-stage16">
        {!plateLogo && <TvBrandLogo />}
        <DayTag state={state} />

        {/* Day marker yields entirely during nomination / vote / execution. */}
        {!drama && <HeroPlaque state={state} alive={alive} seats={seated.length} />}

        {showTimer && (
          <div className={`tv-timer-slot ${drama ? "drama" : ""}`}>
            <TimerBadge timer={state.timer!} seconds={seconds!} />
          </div>
        )}

        {showNomination && <NominationStage nomination={nomination!} nameOf={nameOf} />}
        {showVote && (
          <VoteStage players={state.players} nomination={nomination!} nameOf={nameOf} soundOn={soundOn} />
        )}
        {showExecution && <ExecutionStage name={nameOf(state.executionPendingId!)} />}
        {showExile && <ExileStage players={state.players} exile={state.exile!} nameOf={nameOf} />}
        {showSheet && <CharacterSheet state={state} />}

        <div className="tv-left">
          {showDawn && <DawnReveal deaths={dawnDeaths} />}
          <TownBoard
            players={seated}
            reveal={state.phase === "ended" ? state.reveal : null}
            hidden={!panels.town || showExile || showSheet}
          />
        </div>
        <Gazette
          events={state.publicLog}
          nameOf={nameOf}
          state={state}
          hidden={!panels.gazette || showExile || showSheet}
        />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { Phase, PublicEvent, PublicState } from "../../types";
import { Fleur, OakPlaque, TvLabel, TvScript } from "./chrome";
import { FitText } from "./fit";

/** server/src/game.ts SHOT_CUE_HOLD_MS: the shot cue plays this long before the result cue. */
const SHOT_CUE_HOLD_MS = 8400;

type MomentEvent =
  | { kind: "slayer"; key: string; shooterId: string; targetId: string; hit: boolean }
  | { kind: "virgin"; key: string; nominatorId: string; nomineeId: string | null }
  | { kind: "demon-slain"; key: string };

/** `resolved` is false while the Slayer's shot cue is still playing (the result is not shown yet). */
export type Moment = MomentEvent & { resolved: boolean };

const DURATION_MS: Record<Moment["kind"], number> = {
  slayer: SHOT_CUE_HOLD_MS + 6500,
  virgin: 7500,
  "demon-slain": 6500,
};

function eventKey(e: PublicEvent): string {
  const who =
    "playerId" in e ? e.playerId : "shooterId" in e ? `${e.shooterId}>${e.targetId}` : "nomineeId" in e ? e.nomineeId : "";
  return `${e.type}:${e.at}:${who}`;
}

/**
 * Big public moments, from what changed in the public state: a Slayer shot, a Virgin execution,
 * and the Demon slain at game end. Events already there when the TV loads are never replayed.
 */
export function useMoment(state: PublicState | null): Moment | null {
  const seen = useRef<Set<string> | null>(null);
  const prevPhase = useRef<Phase | null>(null);
  const [moment, setMoment] = useState<MomentEvent | null>(null);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    const log = state.publicLog;
    if (seen.current === null) {
      seen.current = new Set(log.map(eventKey));
      prevPhase.current = state.phase;
      return;
    }
    let next: MomentEvent | null = null;
    log.forEach((e, i) => {
      const key = eventKey(e);
      if (seen.current!.has(key)) return;
      seen.current!.add(key);
      if (e.type === "slayer_shot") {
        next = { kind: "slayer", key, shooterId: e.shooterId, targetId: e.targetId, hit: e.hit };
      } else if (e.type === "execution" && e.virgin) {
        const nom = log
          .slice(0, i)
          .reverse()
          .find((x): x is Extract<PublicEvent, { type: "nomination" }> => x.type === "nomination" && x.nominatorId === e.playerId);
        next = { kind: "virgin", key, nominatorId: e.playerId, nomineeId: nom?.nomineeId ?? null };
      }
    });
    if (
      state.phase === "ended" &&
      prevPhase.current !== "ended" &&
      state.winner === "good" &&
      /demon is dead/i.test(state.winReason ?? "")
    ) {
      next = { kind: "demon-slain", key: `ended:${state.seq}` };
    }
    prevPhase.current = state.phase;
    if (next) setMoment(next);
  }, [state?.seq]);

  useEffect(() => {
    if (!moment) return;
    const timers = [setTimeout(() => setMoment(null), DURATION_MS[moment.kind])];
    if (moment.kind === "slayer") timers.push(setTimeout(() => setResolvedKey(moment.key), SHOT_CUE_HOLD_MS));
    return () => timers.forEach(clearTimeout);
  }, [moment]);

  return moment ? { ...moment, resolved: moment.kind !== "slayer" || resolvedKey === moment.key } : null;
}

/** Full-screen sequence in the TV's oak-and-brass style; sits over the board and fades out. */
export function MomentOverlay({ moment, nameOf }: { moment: Moment; nameOf: (id: string) => string }) {
  const resultShown = moment.resolved;
  let label: string;
  let word: string;
  let script: string;
  let tone = "";
  if (moment.kind === "slayer") {
    const shooter = nameOf(moment.shooterId);
    const target = nameOf(moment.targetId);
    if (!resultShown) {
      label = "The Slayer takes aim";
      word = target;
      script = `${shooter} raises a hand against ${target}`;
    } else if (moment.hit) {
      label = "The shot rings true";
      word = target;
      script = `${target} falls`;
      tone = "blood";
    } else {
      label = "The shot rings out";
      word = "Nothing happens";
      script = `${target} still stands`;
      tone = "still";
    }
  } else if (moment.kind === "virgin") {
    const nominator = nameOf(moment.nominatorId);
    label = "The Virgin's purity";
    word = nominator;
    script = moment.nomineeId
      ? `${nominator} nominated ${nameOf(moment.nomineeId)} — and is executed at once`
      : `${nominator} is executed at once`;
    tone = "blood";
  } else {
    label = "Ravenswood Bluff is saved";
    word = "The Demon is slain";
    script = "Good wins";
    tone = "dawn";
  }

  return (
    <section
      key={moment.key}
      className={`tv-moment tv-moment-${moment.kind} ${tone ? `tone-${tone}` : ""}`}
      style={{ ["--moment-ms" as string]: `${DURATION_MS[moment.kind]}ms` }}
      role="status"
      aria-live="assertive"
    >
      <div className="tv-moment-veil" aria-hidden />
      <div key={`flash:${resultShown}`} className="tv-moment-flash" aria-hidden />
      <OakPlaque key={`plaque:${resultShown}`} className="tv-moment-plaque">
        <TvLabel className="tv-moment-label">
          <Fleur />
          {label}
          <Fleur flip />
        </TvLabel>
        <p className="tv-phase-word tv-moment-word">
          <FitText className="tv-phase-word-ink tv-moment-fit" lines={1} min={0.4}>
            {word}
          </FitText>
        </p>
        <TvScript className="tv-moment-script">{script}</TvScript>
      </OakPlaque>
    </section>
  );
}

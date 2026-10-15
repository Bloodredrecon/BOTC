import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cancelVoteCue, playVoteCue } from "../../audio";
import type { PublicPlayer, PublicState } from "../../types";
import { TV_EL } from "./assets";
import { BloodDrop, Dot, Fleur, OakPlaque, PhaseWord, TvLabel, TvScript } from "./chrome";
import { FitBox, FitText } from "./fit";
import { voteOrder } from "./model";

type NameOf = (id: string) => string;
type Nomination = NonNullable<PublicState["nomination"]>;

/** Existing custom cues for vote rising / majority (data/audio). */
const CUE_VOTE_RISING = "custom:atm_count_rising.mp3";
const CUE_MAJORITY = "custom:majority.mp3";
/** Vote-open narration lines run up to ~9 s; a vote cue never waits longer than this for one. */
const VOTE_CUE_MAX_WAIT_MS = 10_000;

/** F “5. Nomination” — nominator ☠ nominee on the medallion bar. */
export function NominationStage({ nomination, nameOf }: { nomination: Nomination; nameOf: NameOf }) {
  const nominator = nameOf(nomination.nominatorId);
  const nominee = nameOf(nomination.nomineeId);
  return (
    <section className="tv-stage tv-nomination" aria-label="Nomination">
      <OakPlaque className="tv-stage-tag">
        <TvLabel className="tv-stage-label">
          <Fleur />
          Nomination open
          <Fleur flip />
        </TvLabel>
      </OakPlaque>
      <div className="tv-nom-bar">
        <img className="tv-nom-chrome" src={TV_EL.nominationPlaque} alt="" draggable={false} />
        <span className="tv-nom-side left">
          <span className="tv-nom-role">Accuser</span>
          <FitText className="tv-nom-name nominator">{nominator}</FitText>
        </span>
        <span className="tv-nom-side right">
          <span className="tv-nom-role">Accused</span>
          <FitText className="tv-nom-name nominee">{nominee}</FitText>
        </span>
      </div>
      <TvScript className="tv-stage-script">
        Nominated by {nominator}
        <Dot />
        the accused may speak
      </TvScript>
    </section>
  );
}

/** E–C–B centre: brass-studded ring, oak plaque, live tally, studs lit in vote order. */
export function VoteStage({
  players,
  nomination,
  nameOf,
  soundOn,
}: {
  players: PublicPlayer[];
  nomination: Nomination;
  nameOf: NameOf;
  soundOn: boolean;
}) {
  const order = useMemo(() => voteOrder(players, nomination.nomineeId), [players, nomination.nomineeId]);
  const voted = useMemo(() => new Set(nomination.votesFor), [nomination.votesFor]);
  const count = nomination.votesForCount;
  const toBeat = nomination.toBeat;
  /* On the block needs ≥ half the living AND more than the current holder / tied count. */
  const need = toBeat != null ? Math.max(nomination.majority, toBeat + 1) : nomination.majority;
  const majorityMet = count >= need;
  const tied = !majorityMet && toBeat != null && count === toBeat && count >= nomination.majority;
  const [beat, setBeat] = useState(false);

  /* One rising cue and one majority cue per nomination — a new cue cuts the sting, so replaying
     per hand would restart the build-up on every vote. Marked even while muted. Both wait for
     a narration line still playing (vote open); a rising cue still waiting when majority lands
     is replaced by majority, and one that waits too long is dropped. */
  const nomKey = `${nomination.nominatorId}>${nomination.nomineeId}`;
  const cues = useRef({ key: nomKey, count, rising: count > 0, majority: majorityMet });
  useEffect(() => {
    const c = cues.current;
    if (c.key !== nomKey) {
      cues.current = { key: nomKey, count, rising: count > 0, majority: majorityMet };
      return;
    }
    const climbed = count > c.count;
    c.count = count;
    if (majorityMet && !c.majority) {
      c.majority = true;
      c.rising = true;
      if (soundOn) playVoteCue(CUE_MAJORITY, VOTE_CUE_MAX_WAIT_MS, "play");
    } else if (climbed && !c.rising) {
      c.rising = true;
      if (soundOn) playVoteCue(CUE_VOTE_RISING, VOTE_CUE_MAX_WAIT_MS, "drop");
    }
  }, [nomKey, count, majorityMet, soundOn]);
  useEffect(() => () => cancelVoteCue(), [nomKey]);

  const prevMajority = useRef(majorityMet);
  useEffect(() => {
    if (majorityMet && !prevMajority.current) {
      prevMajority.current = true;
      setBeat(true);
      const t = window.setTimeout(() => setBeat(false), 1100);
      return () => clearTimeout(t);
    }
    if (!majorityMet) prevMajority.current = false;
  }, [majorityMet]);

  const nominee = players.find((p) => p.id === nomination.nomineeId);
  const nomineeAlive = nominee?.alive !== false;
  const remaining = Math.max(0, need - count);
  const kicker = majorityMet
    ? "Vote — on the block"
    : tied
      ? "Vote — tied with the block"
      : `Vote — ${remaining} more for the block`;

  const n = Math.max(1, order.length);
  /* Stud arc sits below the plaque: ≤13° apart (E–C–B spacing), never wider than 140°. */
  const step = n > 1 ? Math.min(13, 140 / (n - 1)) : 0;
  const start = 90 + (step * (n - 1)) / 2;
  const raised = order.filter((p) => voted.has(p.id)).map((p) => p.name);
  const pv = nomination.phoneVote;
  const handsUp = useMemo(() => new Set(pv?.handsUp ?? []), [pv?.handsUp]);
  const sweep = pv?.sweep ?? null;
  const passed = (id: string) => {
    if (!sweep) return false;
    const at = sweep.order.indexOf(id);
    return at >= 0 && at < sweep.index;
  };

  return (
    <section
      className={`tv-stage tv-vote ${majorityMet ? "majority" : ""} ${beat ? "beat" : ""}`}
      aria-label="Vote"
      style={{ "--stud": `${Math.min(1, (step || 13) / 13)}` } as CSSProperties}
    >
      <div className="tv-vote-ring">
        <img className="tv-vote-ring-chrome" src={TV_EL.voteRing} alt="" draggable={false} />
        <ol className="tv-vote-studs" aria-label="Votes in order">
          {order.map((p, i) => {
            const isVoted = voted.has(p.id);
            const canVote = p.alive || !p.usedGhostVote || isVoted;
            const isPassed = passed(p.id);
            return (
              <li
                key={p.id}
                className={[
                  "tv-stud",
                  isVoted ? "lit" : "",
                  canVote ? "" : "spent",
                  p.id === nomination.nomineeId ? "nominee" : "",
                  !isVoted && !isPassed && handsUp.has(p.id) ? "hand" : "",
                  isPassed ? "passed" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ "--a": `${start - i * step}deg` } as CSSProperties}
                title={p.name}
              >
                <span className="visually-hidden">
                  {p.name} {isVoted ? "raised a hand" : "no vote"}
                </span>
              </li>
            );
          })}
        </ol>
        {sweep && sweep.order.length > 0 && (
          <ClockHand
            angleOf={(id) => {
              const i = order.findIndex((p) => p.id === id);
              return i < 0 ? null : start - i * step;
            }}
            order={sweep.order}
            index={sweep.index}
            paused={sweep.paused}
            msPerSeat={sweep.msPerSeat}
            step={step || 13}
          />
        )}
        <OakPlaque className="tv-vote-plaque">
          <TvLabel className="tv-vote-kicker">{kicker}</TvLabel>
          <FitText as="p" className="tv-vote-nominee" min={0.42}>
            {nameOf(nomination.nomineeId)}
          </FitText>
          <p className="tv-vote-tally" aria-label={`${count} of ${need} votes needed`}>
            <span className="count">{count}</span>
            <span className="sep">/</span>
            <span className="need">{need}</span>
          </p>
        </OakPlaque>
      </div>
      <TvScript className="tv-stage-script">
        Nominated by {nameOf(nomination.nominatorId)}
        <Dot />
        {nomineeAlive ? (
          <>
            Still Alive <BloodDrop />
          </>
        ) : (
          "Already dead"
        )}
      </TvScript>
      <FitBox as="p" className="tv-vote-raised" watch={raised.join("|")} min={0.6}>
        {raised.length ? (
          <>
            <span className="tv-vote-raised-label">Hands raised</span> {raised.join(" · ")}
          </>
        ) : (
          <span className="tv-vote-raised-label">No hands raised yet</span>
        )}
      </FitBox>
    </section>
  );
}

/**
 * The phone-vote clock hand: travels from the last locked seat to the next one over one step, so it
 * arrives as that seat locks. Timed from when this TV got the step (no clock sync with the server).
 */
function ClockHand({
  angleOf,
  order,
  index,
  paused,
  msPerSeat,
  step,
}: {
  angleOf: (id: string) => number | null;
  order: string[];
  index: number;
  paused: boolean;
  msPerSeat: number;
  step: number;
}) {
  const done = index >= order.length;
  const toA = done ? null : angleOf(order[index]);
  const fromA = index > 0 ? angleOf(order[index - 1]) : toA != null ? toA + step : null;
  const moving = !paused && !done && toA != null;
  const [pose, setPose] = useState<{ angle: number | null; animate: boolean }>({ angle: fromA, animate: false });
  useEffect(() => {
    setPose({ angle: fromA, animate: false });
    if (!moving) return;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setPose({ angle: toA, animate: true }));
    });
    return () => cancelAnimationFrame(raf);
  }, [index, fromA, toA, moving]);
  if (pose.angle == null) return null;
  return (
    <div
      className={`tv-vote-hand ${moving ? "moving" : ""} ${done ? "done" : ""}`}
      style={
        {
          "--h": `${pose.angle}deg`,
          transition: pose.animate ? `transform ${msPerSeat}ms linear` : "none",
        } as CSSProperties
      }
      aria-hidden
    />
  );
}

/** Traveller exile — the vote ring, but every seat may raise a hand and nothing is weighted. Silent. */
export function ExileStage({
  players,
  exile,
  nameOf,
}: {
  players: PublicPlayer[];
  exile: NonNullable<PublicState["exile"]>;
  nameOf: NameOf;
}) {
  const order = useMemo(() => voteOrder(players, exile.travellerId), [players, exile.travellerId]);
  const raised = new Set(exile.supporters);
  const count = exile.supporters.length;
  const met = count >= exile.threshold;
  const traveller = players.find((p) => p.id === exile.travellerId);
  const n = Math.max(1, order.length);
  const step = n > 1 ? Math.min(13, 140 / (n - 1)) : 0;
  const start = 90 + (step * (n - 1)) / 2;
  const names = order.filter((p) => raised.has(p.id)).map((p) => p.name);
  return (
    <section
      className={`tv-stage tv-vote tv-exile ${met ? "majority" : ""}`}
      aria-label="Exile"
      style={{ "--stud": `${Math.min(1, (step || 13) / 13)}` } as CSSProperties}
    >
      <div className="tv-vote-ring">
        <img className="tv-vote-ring-chrome" src={TV_EL.voteRing} alt="" draggable={false} />
        <ol className="tv-vote-studs" aria-label="Hands for exile">
          {order.map((p, i) => (
            <li
              key={p.id}
              className={["tv-stud", raised.has(p.id) ? "lit" : "", p.id === exile.travellerId ? "nominee" : ""]
                .filter(Boolean)
                .join(" ")}
              style={{ "--a": `${start - i * step}deg` } as CSSProperties}
              title={p.name}
            >
              <span className="visually-hidden">
                {p.name} {raised.has(p.id) ? "raised a hand" : "no hand"}
              </span>
            </li>
          ))}
        </ol>
        <OakPlaque className="tv-vote-plaque">
          <TvLabel className="tv-vote-kicker">
            {met ? "Exile — enough hands" : `Exile — ${Math.max(0, exile.threshold - count)} more to exile`}
          </TvLabel>
          <FitText as="p" className="tv-vote-nominee" min={0.42}>
            {nameOf(exile.travellerId)}
          </FitText>
          <p className="tv-vote-tally" aria-label={`${count} of ${exile.threshold} hands needed`}>
            <span className="count">{count}</span>
            <span className="sep">/</span>
            <span className="need">{exile.threshold}</span>
          </p>
        </OakPlaque>
      </div>
      <TvScript className="tv-stage-script">
        {exile.calledById ? `Exile called by ${nameOf(exile.calledById)}` : "Exile called"}
        {traveller?.travellerCharacterName && (
          <>
            <Dot />
            the {traveller.travellerCharacterName}
          </>
        )}
      </TvScript>
      <FitBox as="p" className="tv-vote-raised" watch={names.join("|")} min={0.6}>
        {names.length ? (
          <>
            <span className="tv-vote-raised-label">Hands raised</span> {names.join(" · ")}
          </>
        ) : (
          <span className="tv-vote-raised-label">Anyone may raise a hand — living or dead</span>
        )}
      </FitBox>
    </section>
  );
}

/** F “7. Execution” — placard + name plaque between candles. */
export function ExecutionStage({ name }: { name: string }) {
  return (
    <section className="tv-stage tv-execution" aria-label="Execution">
      <div className="tv-exec-bar">
        <img className="tv-exec-chrome" src={TV_EL.executionPlacard} alt="" draggable={false} />
        <PhaseWord className="tv-exec-word">Execution</PhaseWord>
      </div>
      <div className="tv-exec-row">
        <Candles />
        <OakPlaque className="tv-exec-plaque">
          <TvLabel>About to die</TvLabel>
          <FitText as="p" className="tv-exec-name" min={0.42}>
            {name}
          </FitText>
        </OakPlaque>
        <Candles />
      </div>
    </section>
  );
}

function Candles() {
  return (
    <div className="tv-candles" aria-hidden>
      <span />
      <span />
      <span />
    </div>
  );
}

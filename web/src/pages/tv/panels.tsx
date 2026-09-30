import type { CSSProperties } from "react";
import type { PublicEvent, PublicPlayer, PublicState, RevealPlayer, Team } from "../../types";
import { TV_EL } from "./assets";
import { Dot, Fleur, OakPlaque, PhaseWord, TvLabel, TvScript } from "./chrome";
import { FitBox, FitText } from "./fit";
import { blockLine, clocktowerMark, executedToday, heroCopy, ledgerLine, townColumns } from "./model";

type NameOf = (id: string) => string;

export function MetaLine({ state, alive, seats }: { state: PublicState; alive: number; seats: number }) {
  return (
    <TvScript className="tv-meta">
      {state.scriptName}
      <Dot />
      {alive} alive
      <Dot />
      {seats} seats
      {state.fabled.length > 0 && (
        <>
          <Dot />
          Fabled: {state.fabled.map((f) => f.name).join(", ")}
        </>
      )}
    </TvScript>
  );
}

/** Top-centre phase plaque: live label / phase word / script meta, all inside the oak. */
export function HeroPlaque({ state, alive, seats }: { state: PublicState; alive: number; seats: number }) {
  const copy = heroCopy(state);
  if (!copy) return null;
  const onBlock =
    (state.phase === "dusk" || state.phase === "day") && !executedToday(state)
      ? blockLine(state.block, (id) => state.players.find((p) => p.id === id)?.name ?? id)
      : null;
  return (
    <header className="tv-hero" key={`${state.phase}-${state.dayNumber}`}>
      <OakPlaque className="tv-hero-plaque">
        <TvLabel>
          <Fleur />
          {copy.label}
          <Fleur flip />
        </TvLabel>
        <PhaseWord className={copy.word.length > 8 ? "long" : undefined}>{copy.word}</PhaseWord>
        <MetaLine state={state} alive={alive} seats={seats} />
        {onBlock && (
          <TvScript className={`tv-block-line ${state.block?.nomineeId ? "held" : "tied"}`}>{onBlock}</TvScript>
        )}
      </OakPlaque>
    </header>
  );
}

/** F-map corner tag (“DAY 1”) — stays up when the phase plaque yields. */
export function DayTag({ state }: { state: PublicState }) {
  const mark = clocktowerMark(state.phase, state.dayNumber);
  if (mark.kind === "none") return null;
  return (
    <OakPlaque className="tv-day-tag">
      <span className="tv-day-tag-icon" aria-hidden>
        {mark.kind === "night" ? "☾" : "☀"}
      </span>
      {mark.kind === "night" ? "Night" : "Day"} {mark.n}
    </OakPlaque>
  );
}

export function TimerBadge({ timer, seconds }: { timer: { label: string }; seconds: number }) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return (
    <OakPlaque className={`tv-timer ${seconds <= 10 ? "urgent" : ""}`}>
      <TvLabel>{timer.label}</TvLabel>
      <p className="tv-timer-digits">
        {m}:{s}
      </p>
    </OakPlaque>
  );
}

/** E–C–B “THE NIGHT CLAIMED” graveyard panel, laid out as the F dawn banner. */
export function DawnReveal({ deaths }: { deaths: { id: string; name: string }[] }) {
  return (
    <FitBox as="section" className="tv-dawn" aria-label="The night claimed" watch={deaths.map((d) => d.name).join("|")}>
      <div className="tv-dawn-sky" style={{ backgroundImage: `url(${TV_EL.graveyard})` }} aria-hidden />
      <TvLabel className="tv-dawn-label">The night claimed</TvLabel>
      {deaths.length === 0 ? (
        <p className="tv-dawn-none">No one</p>
      ) : (
        <ol className="tv-dawn-names">
          {deaths.map((d, i) => (
            <li
              key={d.id}
              className={i === 0 ? "first" : undefined}
              style={
                {
                  animationDelay: `${0.4 + i * 0.9}s`,
                  "--age": Math.min(i, 4),
                } as CSSProperties
              }
            >
              {d.name}
            </li>
          ))}
        </ol>
      )}
    </FitBox>
  );
}

const TEAM_LABEL: Record<Team, string> = {
  townsfolk: "Townsfolk",
  outsider: "Outsider",
  minion: "Minion",
  demon: "Demon",
  traveller: "Traveller",
};

function seatStatus(p: PublicPlayer, reveal: RevealPlayer | undefined): string {
  if (reveal?.characterName) {
    if (reveal.thinksCharacterName) return `${reveal.characterName} · thought ${reveal.thinksCharacterName}`;
    if (reveal.team === "traveller" && reveal.alignment) return `${reveal.characterName} · ${reveal.alignment}`;
    return reveal.characterName;
  }
  if (p.alive) return p.isTraveller ? (p.travellerCharacterName ?? "Traveller") : "Alive";
  return p.usedGhostVote ? "Vote spent" : "Ghost vote";
}

const SHEET_COLUMNS: { team: Team; label: string }[] = [
  { team: "townsfolk", label: "Townsfolk" },
  { team: "outsider", label: "Outsiders" },
  { team: "minion", label: "Minions" },
  { team: "demon", label: "Demons" },
];

/** Script character sheet (Storyteller toggle) — takes the town and gazette slots while it is up. */
export function CharacterSheet({ state }: { state: PublicState }) {
  const sheet = state.sheet!;
  const c = sheet.counts;
  return (
    <section className="tv-sheet" aria-label="Character sheet">
      <div className="tv-gazette-frame" aria-hidden />
      <FitBox className="tv-gazette-sheet tv-sheet-body" watch={`${sheet.characters.length}|${sheet.travellers.length}`}>
        <header className="tv-sheet-head">
          <h2 className="tv-gazette-title">{state.scriptName}</h2>
          <p className="tv-sheet-counts">
            {sheet.playerCount} players
            {c && (
              <>
                <Dot />
                {c.townsfolk} Townsfolk · {c.outsider} Outsider{c.outsider === 1 ? "" : "s"} · {c.minion} Minion
                {c.minion === 1 ? "" : "s"} · {c.demon} Demon
              </>
            )}
          </p>
        </header>
        <div className="tv-sheet-grid">
          {SHEET_COLUMNS.map(({ team, label }) => {
            const list = sheet.characters.filter((ch) => ch.team === team);
            if (!list.length) return null;
            return (
              <div key={team} className={`tv-sheet-col team-${team}`}>
                <h3>{label}</h3>
                <dl>
                  {list.map((ch) => (
                    <div key={ch.id}>
                      <dt>{ch.name}</dt>
                      <dd>{ch.ability}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
        {sheet.travellers.length > 0 && (
          <div className="tv-sheet-col team-traveller tv-sheet-travellers">
            <h3>Travellers in town</h3>
            <dl>
              {sheet.travellers.map((t) => (
                <div key={t.id}>
                  <dt>{t.name}</dt>
                  <dd>{t.ability}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </FitBox>
    </section>
  );
}

export function TownBoard({
  players,
  reveal,
  hidden,
}: {
  players: PublicPlayer[];
  reveal: RevealPlayer[] | null;
  hidden: boolean;
}) {
  const cols = townColumns(players.length);
  const revealById = new Map(reveal?.map((r) => [r.id, r]) ?? []);
  const compact = cols >= 6;
  return (
    <section
      className={`tv-town ${compact ? "compact" : cols === 5 ? "dense" : ""} ${hidden ? "tv-panel-hidden" : ""}`}
      aria-label="The Town"
      aria-hidden={hidden}
      style={{ "--cols": cols } as CSSProperties}
    >
      <div className="tv-town-frame" aria-hidden />
      <h2 className="tv-town-title">
        <Fleur />
        The Town
        <Fleur flip />
      </h2>
      <div className="tv-town-grid">
        {players.map((p) => {
          const r = revealById.get(p.id);
          const state = p.alive ? "alive" : p.usedGhostVote ? "spent" : "ghost";
          const team = r?.team ?? null;
          return (
            <article
              key={p.id}
              className={`tv-seat ${state} ${team ? `team-${team}` : ""}`}
              title={team ? TEAM_LABEL[team] : undefined}
            >
              <span className="tv-seat-emblem" aria-hidden>
                <img src={p.alive ? TV_EL.emblemSun : TV_EL.emblemSkull} alt="" draggable={false} />
                {state === "spent" && <i className="tv-seat-x" />}
              </span>
              <span className="tv-seat-text">
                <FitText className="tv-seat-name" min={0.42}>
                  {p.name}
                </FitText>
                <FitText className="tv-seat-status" lines={1} min={0.6}>
                  {seatStatus(p, r)}
                </FitText>
              </span>
              <span className="tv-seat-num" aria-hidden>
                {p.seat}
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function Gazette({
  events,
  nameOf,
  state,
  hidden,
}: {
  events: PublicEvent[];
  nameOf: NameOf;
  state: PublicState;
  hidden: boolean;
}) {
  const mark = clocktowerMark(state.phase, state.dayNumber);
  const newestFirst = [...events].reverse().slice(0, 9);
  return (
    <section
      className={`tv-gazette ${hidden ? "tv-panel-hidden" : ""}`}
      aria-label="The Ravenswood Gazette"
      aria-hidden={hidden}
    >
      <div className="tv-gazette-frame" aria-hidden />
      <div className="tv-gazette-sheet">
        <header className="tv-gazette-head">
          <p className="tv-gazette-kicker">The</p>
          <h2 className="tv-gazette-title">Ravenswood Gazette</h2>
          <p className="tv-gazette-dateline">
            <span>{mark.kind === "night" ? `☾ Night ${mark.n}` : mark.kind === "day" ? `☀ Day ${mark.n}` : "—"}</span>
            <Fleur />
            <span>{state.scriptName}</span>
          </p>
        </header>
        <ol className="tv-gazette-lines">
          {newestFirst.map((e, i) => {
            const line = ledgerLine(e, nameOf);
            return (
              <li
                key={`${e.at}-${i}`}
                className={`${i === 0 ? "fresh" : ""} ${line.emphasis ? "death" : ""}`}
                style={{ "--age": i } as CSSProperties}
              >
                <span className="tv-gazette-text">{line.text}</span>
                {line.marker && (
                  <span className={`tv-gazette-marker ${line.marker.kind}`}>
                    {line.marker.kind === "night" ? "N" : "D"}
                    {line.marker.n}
                  </span>
                )}
              </li>
            );
          })}
          {events.length === 0 && (
            <li className="empty">
              <span className="tv-gazette-text">No public notices. The presses wait for blood.</span>
            </li>
          )}
        </ol>
      </div>
    </section>
  );
}

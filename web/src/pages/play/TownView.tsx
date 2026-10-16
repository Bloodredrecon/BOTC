import { useEffect, useState } from "react";
import type { PhonePublic, PublicSheet, Team } from "../../types";
import { playerPhotoUrl } from "./photo";

const TEAM_LABEL: Record<Team, string> = {
  townsfolk: "Townsfolk",
  outsider: "Outsider",
  minion: "Minion",
  demon: "Demon",
  traveller: "Traveller",
};

export function teamLabel(team: Team): string {
  return TEAM_LABEL[team] ?? team;
}

export function phaseLine(s: Pick<PhonePublic, "phase" | "dayNumber" | "nominationsOpen">): string {
  const d = Math.max(1, s.dayNumber);
  switch (s.phase) {
    case "lobby":
      return "Gathering";
    case "firstNight":
      return "Night 1";
    case "night":
      return `Night ${s.dayNumber + 1}`;
    case "dawn":
      return "Dawn";
    case "day":
      return `Day ${d}`;
    case "dusk":
      return s.nominationsOpen ? `Day ${d} · nominations open` : `Day ${d} · dusk`;
    case "nomination":
      return `Day ${d} · nomination`;
    case "vote":
      return `Day ${d} · voting`;
    case "execution":
      return `Day ${d} · execution`;
    case "ended":
      return "Game over";
    default:
      return "";
  }
}

export function isNight(phase: PhonePublic["phase"]): boolean {
  return phase === "firstNight" || phase === "night";
}

function useSeconds(endsAt: number | null | undefined): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [endsAt]);
  return endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null;
}

/** The public town: seats, deaths, ghost votes, the current nomination and the block. Same for players and watchers. */
export function TownView({ state, meId }: { state: PhonePublic; meId?: string }) {
  const seated = state.players.filter((p) => !p.leftGame).sort((a, b) => a.seat - b.seat);
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name || "?";
  const nom = state.nomination;
  const seconds = useSeconds(state.timer?.endsAt);
  const alive = seated.filter((p) => p.alive).length;
  const revealById = new Map((state.reveal ?? []).map((r) => [r.id, r]));

  return (
    <div className="play-stack">
      {state.phase === "ended" && (
        <div className={`play-card play-end ${state.winner ?? ""}`}>
          <h2 className="play-title">{state.winner === "good" ? "Good wins" : state.winner === "evil" ? "Evil wins" : "Game over"}</h2>
          {state.winReason && <p className="play-muted">{state.winReason}</p>}
        </div>
      )}

      {state.timer && seconds !== null && (
        <div className="play-card play-timer">
          <span>{state.timer.label}</span>
          <b>
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </b>
        </div>
      )}

      {nom && (
        <div className="play-card play-nom">
          <p className="play-kicker">{state.phase === "vote" ? "Vote" : "Nomination"}</p>
          <p className="play-nom-line">
            <b>{nameOf(nom.nominatorId)}</b> nominates <b>{nameOf(nom.nomineeId)}</b>
          </p>
          <p className="play-muted">
            {nom.votesForCount} of {nom.majority} needed
            {nom.toBeat !== null ? ` · must beat ${nom.toBeat}` : ""}
          </p>
        </div>
      )}

      {state.block && (
        <p className="play-block">
          {state.block.nomineeId
            ? `On the block: ${nameOf(state.block.nomineeId)} · ${state.block.votes} vote${state.block.votes === 1 ? "" : "s"}`
            : `Tied at ${state.block.votes} · nobody on the block`}
        </p>
      )}

      <div className="play-card">
        <p className="play-kicker">
          The town · {alive} of {seated.length} alive
        </p>
        <ol className="play-seats">
          {seated.map((p) => {
            const r = revealById.get(p.id);
            return (
              <li key={p.id} className={`${p.alive ? "" : "dead"} ${p.id === meId ? "me" : ""}`}>
                <span className="play-seat-n">{p.seat}</span>
                {playerPhotoUrl(p.id, p.photoRev) ? (
                  <img src={playerPhotoUrl(p.id, p.photoRev)!} alt="" className="play-seat-face" />
                ) : null}
                <span className="play-seat-name">
                  {p.name || `Seat ${p.seat}`}
                  {p.id === meId && <em> (you)</em>}
                  {p.isTraveller && p.travellerCharacterName && <small> · {p.travellerCharacterName}</small>}
                  {r?.characterName && (
                    <small className={`play-reveal ${r.alignment ?? ""}`}>
                      {" "}
                      · {r.characterName}
                      {r.thinksCharacterName ? ` (thought ${r.thinksCharacterName})` : ""}
                    </small>
                  )}
                </span>
                <span className="play-seat-state">
                  {p.alive ? "" : p.usedGhostVote ? "dead · vote used" : "dead · 1 vote"}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {state.nominationsToday.length > 0 && (
        <div className="play-card">
          <p className="play-kicker">Nominations today</p>
          <ul className="play-list">
            {state.nominationsToday.map((n, i) => (
              <li key={i}>
                {nameOf(n.nominatorId)} → {nameOf(n.nomineeId)}
                {n.outcome === "virgin" ? " · Virgin" : typeof n.votes === "number" ? ` · ${n.votes} vote${n.votes === 1 ? "" : "s"}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The script's characters and abilities, grouped by team (public: the same sheet as the TV). */
export function SheetView({ sheet }: { sheet: PublicSheet }) {
  const teams: Team[] = ["townsfolk", "outsider", "minion", "demon"];
  return (
    <div className="play-sheet">
      {sheet.counts && (
        <p className="play-muted">
          {sheet.playerCount} players: {sheet.counts.townsfolk} Townsfolk · {sheet.counts.outsider} Outsider
          {sheet.counts.outsider === 1 ? "" : "s"} · {sheet.counts.minion} Minion{sheet.counts.minion === 1 ? "" : "s"} ·{" "}
          {sheet.counts.demon} Demon
        </p>
      )}
      {teams.map((t) => {
        const chars = sheet.characters.filter((c) => c.team === t);
        if (!chars.length) return null;
        return (
          <section key={t}>
            <h3 className={`play-team ${t}`}>{teamLabel(t)}</h3>
            <dl>
              {chars.map((c) => (
                <div key={c.id}>
                  <dt>{c.name}</dt>
                  <dd>{c.ability}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
      {sheet.travellers.length > 0 && (
        <section>
          <h3 className="play-team traveller">Travellers</h3>
          <dl>
            {sheet.travellers.map((c) => (
              <div key={c.id}>
                <dt>{c.name}</dt>
                <dd>{c.ability}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

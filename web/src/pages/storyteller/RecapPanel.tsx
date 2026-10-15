import { useMemo } from "react";
import type { Player, PublicEvent, StorytellerState } from "../../types";

type Section = { title: string; lines: string[] };

const VOTE_OUTCOME: Record<string, string> = {
  majority: "goes on the block",
  tie: "ties the block — nobody on it",
  outvoted: "not enough to beat the block",
  no_majority: "not enough votes",
};

/** Night deaths carry the previous day's number (0 = first night). */
function nightTitle(dayNumber: number) {
  return dayNumber <= 0 ? "First night" : `Night ${dayNumber + 1}`;
}

function buildSections(state: StorytellerState, name: (id: string) => string): Section[] {
  const sections = new Map<string, string[]>();
  const add = (title: string, line: string) => {
    if (!sections.has(title)) sections.set(title, []);
    sections.get(title)!.push(line);
  };
  let day = 1;
  for (const e of state.publicLog as PublicEvent[]) {
    switch (e.type) {
      case "night_death":
        day = e.dayNumber + 1;
        add(nightTitle(e.dayNumber), e.playerIds.length ? `${e.playerIds.map(name).join(", ")} died` : "Nobody died");
        break;
      case "other_death": {
        const reason = e.reason && e.reason !== "Died" ? ` (${e.reason})` : "";
        const d = e.dayNumber ?? day;
        if (e.duringNight) {
          day = d + 1;
          add(nightTitle(d), `${name(e.playerId)} died${reason}`);
        } else {
          day = d;
          add(`Day ${d}`, `${name(e.playerId)} died${reason}`);
        }
        break;
      }
      case "dusk":
      case "nominations_open":
        day = e.dayNumber;
        break;
      case "nomination":
        add(`Day ${day}`, `${name(e.nominatorId)} nominated ${name(e.nomineeId)}`);
        break;
      case "vote_result":
        add(`Day ${day}`, `  ${e.votesFor} vote${e.votesFor === 1 ? "" : "s"} (needed ${e.majority}): ${name(e.nomineeId)} ${VOTE_OUTCOME[e.outcome] ?? e.outcome}`);
        break;
      case "execution":
        day = e.dayNumber ?? day;
        add(
          `Day ${day}`,
          e.alreadyDead
            ? `${name(e.playerId)} executed (already dead)`
            : e.virgin
              ? `${name(e.playerId)} nominated the Virgin and was executed`
              : e.died
              ? `${name(e.playerId)} executed and died`
              : `${name(e.playerId)} executed but did not die`,
        );
        break;
      case "slayer_shot":
        day = e.dayNumber;
        add(`Day ${day}`, `${name(e.shooterId)} shot at ${name(e.targetId)} (Slayer) — ${e.hit ? "they died" : "nothing happened"}`);
        break;
      case "no_execution":
        day = e.dayNumber;
        add(`Day ${day}`, "No execution");
        break;
      case "exile":
        add(`Day ${e.dayNumber ?? day}`, `${e.playerName ?? name(e.playerId)} ${e.exiled ? "exiled" : "not exiled"} (${e.supporters}/${e.threshold})`);
        break;
      case "traveller_join":
        add(`Day ${day}`, `${e.playerName ?? name(e.playerId)} arrived as the ${e.characterName ?? e.characterId}`);
        break;
      case "traveller_leave":
        add(`Day ${day}`, `${e.playerName ?? name(e.playerId)} left`);
        break;
    }
  }
  return [...sections.entries()].map(([title, lines]) => ({ title, lines }));
}

/** How the player's game ended, from the last death in the chronicle. */
function fateOf(p: Player, log: PublicEvent[]): string {
  if (p.leftGame) return "Left the game";
  if (p.alive) return "Alive";
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]!;
    if (e.type === "execution" && e.playerId === p.id && e.died) return `Executed, day ${e.dayNumber ?? "?"}`;
    if (e.type === "night_death" && e.playerIds.includes(p.id)) return `Died, ${nightTitle(e.dayNumber).toLowerCase()}`;
    if (e.type === "other_death" && e.playerId === p.id) {
      const when = e.duringNight ? nightTitle(e.dayNumber ?? 0).toLowerCase() : `day ${e.dayNumber ?? "?"}`;
      return `Died, ${when}${e.reason && e.reason !== "Died" ? ` (${e.reason})` : ""}`;
    }
    if (e.type === "exile" && e.playerId === p.id && e.exiled) return `Exiled, day ${e.dayNumber ?? "?"}`;
  }
  return "Dead";
}

/** End-of-game recap (also useful mid-game): who was what, how they died, each day's nominations. */
export function RecapPanel({ state }: { state: StorytellerState }) {
  const charOf = (id: string | null | undefined) =>
    state.characters.find((c) => c.id === id) ?? state.travellers.find((c) => c.id === id);
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
  const sections = useMemo(() => buildSections(state, name), [state.publicLog, state.players]);
  const players = [...state.players].sort((a, b) => Number(a.leftGame) - Number(b.leftGame) || a.seat - b.seat);
  const started = state.phase !== "lobby";

  return (
    <div className="stack recap">
      <div className="panel">
        <h2>Recap</h2>
        {state.phase === "ended" ? (
          <p className={state.winner === "evil" ? "recap-winner evil" : "recap-winner good"}>
            {state.winner ? `${state.winner === "good" ? "Good" : "Evil"} wins` : "Game ended"}
            {state.winReason ? ` — ${state.winReason}` : ""}
          </p>
        ) : (
          <p className="muted">{started ? "Game in progress — the story so far." : "The game hasn't started yet."}</p>
        )}
        <table className="recap-table">
          <thead>
            <tr>
              <th>Seat</th>
              <th>Player</th>
              <th>Character</th>
              <th>Fate</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const c = charOf(p.characterId);
              const startId = state.startingCharacters?.[p.id];
              const start = startId && startId !== p.characterId ? charOf(startId) : null;
              const evil = c?.team === "minion" || c?.team === "demon" || (c?.team === "traveller" && p.alignment === "evil");
              return (
                <tr key={p.id} className={p.alive ? "" : "dead"}>
                  <td>{p.leftGame ? "—" : p.seat}</td>
                  <td>{p.name}</td>
                  <td>
                    <span className={`badge ${c?.team ?? ""}`}>{c?.name ?? "—"}</span>
                    {evil && <span className="recap-evil"> evil</span>}
                    {p.characterId === "drunk" && p.thinksCharacterId && (
                      <span className="muted"> (thought {charOf(p.thinksCharacterId)?.name})</span>
                    )}
                    {start && <span className="muted"> (started as {start.name})</span>}
                  </td>
                  <td>{fateOf(p, state.publicLog as PublicEvent[])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sections.length > 0 && (
        <div className="panel">
          <h2>Day by day</h2>
          {sections.map((s) => (
            <div key={s.title} className="recap-section">
              <h3>{s.title}</h3>
              <ul>
                {s.lines.map((l, i) => (
                  <li key={i} className={l.startsWith("  ") ? "recap-vote" : ""}>
                    {l.trim()}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { useSocket, useStoryteller } from "../socket";
import type { Player, StorytellerState, Team } from "../types";

const PIN_KEY = "botc_storyteller_pin";

type Tab = "control" | "grimoire" | "night" | "votes" | "dawn" | "setup";

export function StorytellerPage() {
  const { socketRef, connected, emit } = useSocket();
  const [pinInput, setPinInput] = useState(() => localStorage.getItem(PIN_KEY) ?? "");
  const [pin, setPin] = useState<string | null>(() => localStorage.getItem(PIN_KEY));
  const { state, authError, authed } = useStoryteller(socketRef, pin);
  const [tab, setTab] = useState<Tab>("control");

  function login(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem(PIN_KEY, pinInput);
    setPin(pinInput);
  }

  if (!pin || (!authed && authError)) {
    return (
      <div className="pin-screen">
        <form className="panel" onSubmit={login}>
          <h1 className="brand" style={{ fontSize: "1.4rem" }}>
            Storyteller
          </h1>
          <p className="muted">Enter the PIN from the LAN server (default 1234).</p>
          <input
            type="password"
            inputMode="numeric"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            placeholder="PIN"
            autoFocus
          />
          {authError && <p className="warn">{authError}</p>}
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button className="primary" type="submit">
              Unlock grimoire
            </button>
          </div>
          <p className="muted">{connected ? "Server connected" : "Connecting…"}</p>
        </form>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="pin-screen">
        <div className="panel">
          <p>Connecting as storyteller…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="st">
      <div className="st-top">
        <h1 className="brand">BOTC · ST</h1>
        <div className="muted">
          {state.phase} · Day {state.dayNumber} · {state.players.filter((p) => p.alive).length} alive
        </div>
      </div>

      <div className="tabs">
        {(
          [
            ["control", "Control"],
            ["setup", "Setup"],
            ["grimoire", "Grimoire"],
            ["night", "Night"],
            ["dawn", "Dawn"],
            ["votes", "Votes"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "control" && <ControlTab state={state} emit={emit} />}
      {tab === "setup" && <SetupTab state={state} emit={emit} />}
      {tab === "grimoire" && <GrimoireTab state={state} emit={emit} />}
      {tab === "night" && <NightTab state={state} emit={emit} />}
      {tab === "dawn" && <DawnTab state={state} emit={emit} />}
      {tab === "votes" && <VotesTab state={state} emit={emit} />}
    </div>
  );
}

function ControlTab({
  state,
  emit,
}: {
  state: StorytellerState;
  emit: (e: string, d?: unknown) => void;
}) {
  return (
    <div className="stack">
      <div className="panel">
        <h2>Phase</h2>
        <div className="row">
          <button className="primary" type="button" onClick={() => emit("game:startFirstNight")}>
            First night
          </button>
          <button type="button" onClick={() => emit("game:goDawn")}>
            Dawn
          </button>
          <button type="button" onClick={() => emit("game:goDay")}>
            Day
          </button>
          <button type="button" onClick={() => emit("game:startNight")}>
            Night
          </button>
          <button type="button" onClick={() => emit("game:endGame")}>
            End game
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Room scenes</h2>
        <div className="row">
          <button type="button" onClick={() => emit("game:scene", { scene: "day" })}>
            Day lights
          </button>
          <button type="button" onClick={() => emit("game:scene", { scene: "night" })}>
            Night lights
          </button>
          <button type="button" onClick={() => emit("game:scene", { scene: "hush" })}>
            Hush
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Timers</h2>
        <div className="row">
          <button type="button" onClick={() => emit("game:startTimer", { seconds: 60, label: "Nomination" })}>
            60s nomination
          </button>
          <button type="button" onClick={() => emit("game:startTimer", { seconds: 30, label: "Vote" })}>
            30s vote
          </button>
          <button type="button" onClick={() => emit("game:startTimer", { seconds: 120, label: "Discussion" })}>
            2m talk
          </button>
          <button type="button" onClick={() => emit("game:cancelTimer")}>
            Cancel
          </button>
        </div>
        {state.timer && (
          <p className="muted">
            Active: {state.timer.label} ends {new Date(state.timer.endsAt).toLocaleTimeString()}
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Demo / reset</h2>
        <p className="muted">
          Demo walks day → night → dawn → nomination → vote → execution cues for a dry run.
        </p>
        <div className="row">
          <button type="button" onClick={() => runDemo(emit)}>
            Run demo sequence
          </button>
          <button
            className="danger"
            type="button"
            onClick={() => {
              if (confirm("Reset the whole game session?")) emit("game:reset");
            }}
          >
            New game
          </button>
        </div>
      </div>
    </div>
  );
}

async function runDemo(emit: (e: string, d?: unknown) => void) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  emit("game:scene", { scene: "day" });
  await wait(1200);
  emit("game:goDay");
  await wait(1500);
  emit("game:startTimer", { seconds: 5, label: "Demo timer" });
  await wait(5500);
  emit("game:startNight");
  await wait(2000);
  emit("game:nightNext");
  await wait(1200);
  emit("game:goDawn");
  await wait(1500);
  emit("game:finishDawn");
  await wait(1200);
  emit("game:scene", { scene: "day" });
}

function SetupTab({
  state,
  emit,
}: {
  state: StorytellerState;
  emit: (e: string, d?: unknown) => void;
}) {
  return (
    <div className="stack">
      <div className="panel">
        <h2>Players ({state.players.length})</h2>
        <label className="muted">Seat count (5–20)</label>
        <input
          type="number"
          min={5}
          max={20}
          value={state.players.length}
          onChange={(e) => emit("game:setPlayerCount", { count: Number(e.target.value) })}
        />
        {state.setup ? (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Bag: T{state.setup.townsfolk} / O{state.setup.outsider} / M{state.setup.minion} / D
            {state.setup.demon}
            <br />
            Assigned: T{state.assignedCounts.townsfolk} / O{state.assignedCounts.outsider} / M
            {state.assignedCounts.minion} / D{state.assignedCounts.demon}
          </p>
        ) : (
          <p className="warn">Outside official 5–15 bag — use Travellers or adjust manually.</p>
        )}
        {state.setupWarning && <p className="warn">{state.setupWarning}</p>}
      </div>

      <div className="panel">
        <h2>Fabled (public)</h2>
        <div className="chip-row">
          {state.allFabled.map((f) => {
            const on = state.fabled.some((x) => x.id === f.id);
            return (
              <button
                key={f.id}
                type="button"
                className={`chip ${on ? "on" : ""}`}
                onClick={() => {
                  const ids = on
                    ? state.fabled.filter((x) => x.id !== f.id).map((x) => x.id)
                    : [...state.fabled.map((x) => x.id), f.id];
                  emit("game:setFabled", { ids });
                }}
              >
                {f.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <h2>Names</h2>
        <div className="stack">
          {state.players.map((p) => (
            <input
              key={p.id}
              value={p.name}
              onChange={(e) =>
                emit("game:updatePlayer", { playerId: p.id, patch: { name: e.target.value } })
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function GrimoireTab({
  state,
  emit,
}: {
  state: StorytellerState;
  emit: (e: string, d?: unknown) => void;
}) {
  const [selected, setSelected] = useState<string | null>(state.players[0]?.id ?? null);
  const player = state.players.find((p) => p.id === selected) ?? state.players[0];
  const char = state.characters.find((c) => c.id === player?.characterId);

  const byTeam = useMemo(() => {
    const teams: Team[] = ["townsfolk", "outsider", "minion", "demon"];
    return teams.map((t) => ({
      team: t,
      chars: state.characters.filter((c) => c.team === t),
    }));
  }, [state.characters]);

  if (!player) return null;

  return (
    <div className="stack">
      <div className="panel">
        <h2>Seats</h2>
        <div className="chip-row">
          {state.players.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${selected === p.id ? "on" : ""}`}
              onClick={() => setSelected(p.id)}
            >
              {p.seat}. {p.name}
              {!p.alive ? " †" : ""}
            </button>
          ))}
        </div>
      </div>

      <PlayerEditor
        player={player}
        charName={char?.name}
        charTeam={char?.team}
        characters={state.characters}
        byTeam={byTeam}
        reminderPool={char?.reminders ?? []}
        emit={emit}
      />
    </div>
  );
}

function PlayerEditor({
  player,
  charName,
  charTeam,
  characters,
  byTeam,
  reminderPool,
  emit,
}: {
  player: Player;
  charName?: string;
  charTeam?: Team;
  characters: StorytellerState["characters"];
  byTeam: { team: Team; chars: StorytellerState["characters"] }[];
  reminderPool: string[];
  emit: (e: string, d?: unknown) => void;
}) {
  return (
    <div className={`player-card ${player.alive ? "" : "dead"}`}>
      <header>
        <div>
          <strong>
            Seat {player.seat} · {player.name}
          </strong>
          {charName && <span className={`badge ${charTeam}`}>{charName}</span>}
        </div>
        <button
          type="button"
          onClick={() =>
            emit("game:updatePlayer", {
              playerId: player.id,
              patch: { alive: !player.alive },
            })
          }
        >
          {player.alive ? "Mark dead" : "Mark alive"}
        </button>
      </header>

      <label className="muted">Character</label>
      <select
        value={player.characterId ?? ""}
        onChange={(e) =>
          emit("game:updatePlayer", {
            playerId: player.id,
            patch: { characterId: e.target.value || null },
          })
        }
      >
        <option value="">— unassigned —</option>
        {byTeam.map(({ team, chars }) => (
          <optgroup key={team} label={team}>
            {chars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <label className="muted" style={{ marginTop: "0.5rem", display: "block" }}>
        Reminders
      </label>
      <div className="chip-row">
        {Array.from(new Set([...reminderPool, ...player.reminders, "Drunk", "Poisoned"])).map(
          (r) => {
            const on = player.reminders.includes(r);
            return (
              <button
                key={r}
                type="button"
                className={`chip ${on ? "on" : ""}`}
                onClick={() => {
                  const reminders = on
                    ? player.reminders.filter((x) => x !== r)
                    : [...player.reminders, r];
                  emit("game:updatePlayer", { playerId: player.id, patch: { reminders } });
                }}
              >
                {r}
              </button>
            );
          },
        )}
      </div>

      <label className="muted" style={{ marginTop: "0.5rem", display: "block" }}>
        Notes
      </label>
      <textarea
        value={player.notes}
        onChange={(e) =>
          emit("game:updatePlayer", { playerId: player.id, patch: { notes: e.target.value } })
        }
      />

      {charTeam === "demon" && (
        <>
          <label className="muted" style={{ marginTop: "0.5rem", display: "block" }}>
            Bluffs
          </label>
          <div className="chip-row">
            {characters
              .filter((c) => c.team === "townsfolk" || c.team === "outsider")
              .map((c) => {
                const on = player.bluffs.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`chip ${on ? "on" : ""}`}
                    onClick={() => {
                      let bluffs = on
                        ? player.bluffs.filter((x) => x !== c.id)
                        : [...player.bluffs, c.id];
                      if (bluffs.length > 3) bluffs = bluffs.slice(-3);
                      emit("game:updatePlayer", { playerId: player.id, patch: { bluffs } });
                    }}
                  >
                    {c.name}
                  </button>
                );
              })}
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: "0.75rem" }}>
        <button
          className="danger"
          type="button"
          onClick={() => {
            const reason = prompt("Death reason (e.g. Slayer)", "Died") || "Died";
            emit("game:otherDeath", { playerId: player.id, reason });
          }}
        >
          Public death
        </button>
      </div>
    </div>
  );
}

function NightTab({
  state,
  emit,
}: {
  state: StorytellerState;
  emit: (e: string, d?: unknown) => void;
}) {
  const night = state.night;
  if (!night) {
    return (
      <div className="panel">
        <p className="muted">No night in progress.</p>
        <div className="row">
          <button className="primary" type="button" onClick={() => emit("game:startFirstNight")}>
            Start first night
          </button>
          <button type="button" onClick={() => emit("game:startNight")}>
            Start night
          </button>
        </div>
      </div>
    );
  }

  const step = night.steps[night.stepIndex];
  const players = step.playerIds
    .map((id) => state.players.find((p) => p.id === id)?.name)
    .filter(Boolean)
    .join(", ");

  return (
    <div className="stack">
      <div className="panel night-step">
        <div className="muted">
          Step {night.stepIndex + 1} / {night.steps.length}
          {night.isFirstNight ? " · First night" : ""}
        </div>
        <h2>{step?.name}</h2>
        {players && <p className="muted">In play: {players}</p>}
        <p>{step?.wakeText}</p>
      </div>
      <div className="footer-actions">
        <button type="button" onClick={() => emit("game:nightPrev")}>
          Back
        </button>
        <button className="primary" type="button" onClick={() => emit("game:nightNext")}>
          Next
        </button>
        <button type="button" onClick={() => emit("game:nightSkipToDawn")}>
          Skip to dawn
        </button>
        <button type="button" onClick={() => emit("game:goDawn")}>
          End night → Dawn
        </button>
      </div>
    </div>
  );
}

function DawnTab({
  state,
  emit,
}: {
  state: StorytellerState;
  emit: (e: string, d?: unknown) => void;
}) {
  const selected = new Set(state.dawnDeathIds);
  return (
    <div className="stack">
      <div className="panel">
        <h2>Overnight deaths</h2>
        <p className="muted">Select who died at night, announce on the TV, then start day.</p>
        <div className="chip-row">
          {state.players
            .filter((p) => p.alive || selected.has(p.id))
            .map((p) => {
              const on = selected.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`chip ${on ? "on" : ""}`}
                  onClick={() => {
                    const next = on
                      ? state.dawnDeathIds.filter((id) => id !== p.id)
                      : [...state.dawnDeathIds, p.id];
                    emit("game:setDawnDeaths", { playerIds: next });
                  }}
                >
                  {p.name}
                </button>
              );
            })}
        </div>
      </div>
      <div className="row">
        <button type="button" onClick={() => emit("game:goDawn")}>
          Enter dawn
        </button>
        <button className="primary" type="button" onClick={() => emit("game:announceDawnDeaths")}>
          Announce deaths
        </button>
        <button type="button" onClick={() => emit("game:finishDawn")}>
          Finish dawn → Day
        </button>
      </div>
    </div>
  );
}

function VotesTab({
  state,
  emit,
}: {
  state: StorytellerState;
  emit: (e: string, d?: unknown) => void;
}) {
  const [nominatorId, setNominatorId] = useState(state.players[0]?.id ?? "");
  const [nomineeId, setNomineeId] = useState(state.players[1]?.id ?? state.players[0]?.id ?? "");

  const nom = state.nomination;
  const majority = state.nomination?.majority ?? Math.ceil(state.players.filter((p) => p.alive).length / 2);

  return (
    <div className="stack">
      <div className="panel">
        <h2>Nominate</h2>
        <label className="muted">Nominator</label>
        <select value={nominatorId} onChange={(e) => setNominatorId(e.target.value)}>
          {state.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="muted" style={{ display: "block", marginTop: "0.5rem" }}>
          Nominee
        </label>
        <select value={nomineeId} onChange={(e) => setNomineeId(e.target.value)}>
          {state.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <button
            className="primary"
            type="button"
            onClick={() => emit("game:startNomination", { nominatorId, nomineeId })}
          >
            Open nomination
          </button>
        </div>
      </div>

      {nom && (
        <div className="panel">
          <h2>Vote</h2>
          <p>
            {state.players.find((p) => p.id === nom.nominatorId)?.name} →{" "}
            {state.players.find((p) => p.id === nom.nomineeId)?.name}
          </p>
          <p style={{ fontFamily: "Cinzel, serif", fontSize: "1.8rem", margin: "0.25rem 0" }}>
            {nom.votesForCount} / {majority}
          </p>
          <div className="chip-row">
            {state.players.map((p) => {
              const can =
                p.alive || !p.usedGhostVote || nom.votesFor.includes(p.id);
              const on = nom.votesFor.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!can && !on}
                  className={`chip ${on ? "on" : ""}`}
                  onClick={() => emit("game:toggleVote", { playerId: p.id })}
                >
                  {p.name}
                  {!p.alive ? " †" : ""}
                </button>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button type="button" onClick={() => emit("game:startVote", { seconds: 30 })}>
              Start 30s vote clock
            </button>
            <button type="button" onClick={() => emit("game:resolveVote", {})}>
              Resolve (auto)
            </button>
            <button type="button" onClick={() => emit("game:resolveVote", { outcome: "tie" })}>
              Tie
            </button>
            <button type="button" onClick={() => emit("game:resolveVote", { outcome: "no_majority" })}>
              No majority
            </button>
          </div>
        </div>
      )}

      {state.phase === "execution" && state.executionPendingId && (
        <div className="panel">
          <h2>Execution</h2>
          <p className="muted">
            About to die: {state.players.find((p) => p.id === state.executionPendingId)?.name}
          </p>
          <div className="row">
            <button
              className="danger"
              type="button"
              onClick={() => emit("game:confirmExecution", { died: true })}
            >
              Confirm death
            </button>
            <button type="button" onClick={() => emit("game:confirmExecution", { died: false })}>
              Lives
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

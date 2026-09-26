import { useEffect, useMemo, useState } from "react";
import { useSocket, useStoryteller } from "../socket";
import type { AudioCueInfo, NightShowSpec, Player, StorytellerState, Team } from "../types";

const PIN_KEY = "botc_storyteller_pin";

type EmitFn = (e: string, d?: unknown, ack?: (result: unknown) => void) => void;

type Tab =
  | "control"
  | "grimoire"
  | "night"
  | "votes"
  | "dawn"
  | "setup"
  | "sound"
  | "ambiance"
  | "rules"
  | "travel";

function nextDayNumber(dayNumber: number) {
  return dayNumber === 0 ? 1 : dayNumber + 1;
}

/** Match server rules.isPoisonedOrDrunk — Drunk is usually reminder on apparent Townsfolk. */
function isPoisonedOrDrunkPlayer(p: Player | null | undefined): boolean {
  if (!p) return false;
  return (
    p.reminders.includes("Poisoned") ||
    p.reminders.includes("Drunk") ||
    p.characterId === "drunk"
  );
}

/** Pick a character id different from truth (for impaired Ravenkeeper / Undertaker lies). */
function pickWrongCharacterId(
  all: { id: string; team: Team }[],
  truthId: string | null | undefined,
  teams?: Team[],
): string {
  const pool = all.filter((c) => {
    if (truthId && c.id === truthId) return false;
    if (teams?.length && !teams.includes(c.team)) return false;
    return true;
  });
  if (pool.length === 0) return truthId || all[0]?.id || "";
  return pool[Math.floor(Math.random() * pool.length)]!.id;
}

function formatStatus(state: StorytellerState) {
  const alive = state.players.filter((p) => p.alive && !p.leftGame).length;
  let when: string;
  switch (state.phase) {
    case "lobby":
      when = "Lobby";
      break;
    case "firstNight":
      when = "First night";
      break;
    case "night":
      when = `Night (after day ${state.dayNumber})`;
      break;
    case "dawn":
      when = `Dawn → Day ${nextDayNumber(state.dayNumber)}`;
      break;
    case "day":
    case "nomination":
    case "vote":
    case "execution":
      when = `Day ${state.dayNumber}`;
      break;
    case "ended":
      when = "Ended";
      break;
    default:
      when = state.phase;
  }
  return `${when} · ${alive} alive`;
}

function advanceLabel(state: StorytellerState) {
  switch (state.phase) {
    case "lobby":
    case "ended":
      return "Start first night";
    case "firstNight":
    case "night":
      return "End night → Dawn";
    case "dawn":
      return `Finish dawn → Day ${nextDayNumber(state.dayNumber)}`;
    case "day":
    case "nomination":
    case "vote":
    case "execution":
      return "Start night";
    default:
      return "Advance";
  }
}

/** Follow the story — don't leave the user on the wrong tab after a phase change. */
function tabForPhase(phase: StorytellerState["phase"]): Tab {
  switch (phase) {
    case "lobby":
      return "setup";
    case "firstNight":
    case "night":
      return "night";
    case "dawn":
      return "dawn";
    case "day":
    case "nomination":
    case "vote":
    case "execution":
      return "votes";
    case "ended":
      return "control";
    default:
      return "control";
  }
}

export function StorytellerPage() {
  const { socketRef, connected, emit } = useSocket();
  const [pinInput, setPinInput] = useState(() => localStorage.getItem(PIN_KEY) ?? "");
  const [pin, setPin] = useState<string | null>(() => localStorage.getItem(PIN_KEY));
  const { state, authError, authed } = useStoryteller(socketRef, pin);
  const [tab, setTab] = useState<Tab>("control");

  // When the story phase changes, open the matching tab (Setup → Night → Dawn → Votes → …)
  useEffect(() => {
    if (!state) return;
    setTab(tabForPhase(state.phase));
  }, [state?.phase]);

  function login(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem(PIN_KEY, pinInput);
    setPin(pinInput);
  }

  if (!pin || (!authed && authError)) {
    return (
      <div className="pin-screen">
        <form className="panel" onSubmit={login}>
          <h1 className="brand" style={{ fontSize: "1.5rem", color: "var(--blood-bright)" }}>
            Storyteller
          </h1>
          <i className="ornament" aria-hidden />
          <p className="muted">Enter the PIN (default 1234). Guard this from the town.</p>
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
        <h1 className="brand">BOTC</h1>
        <div className="muted">{formatStatus(state)}</div>
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
            ["travel", "Travel"],
            ["rules", "Rules"],
            ["sound", "Sound"],
            ["ambiance", "Ambiance"],
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

      {(state.stNotices?.length ?? 0) > 0 && (
        <div className="panel mech-notice" style={{ borderColor: "var(--blood-bright, #c44)" }}>
          <h2>Mechanical notice</h2>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
            {state.stNotices.map((n) => (
              <li key={n.id} style={{ marginBottom: "0.35rem" }}>
                {n.message}{" "}
                <button type="button" className="chip" onClick={() => emit("game:dismissStNotice", { id: n.id })}>
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
          <div className="row" style={{ marginTop: "0.5rem" }}>
            <button type="button" onClick={() => emit("game:clearStNotices")}>
              Clear all
            </button>
          </div>
        </div>
      )}

      {tab === "control" && <ControlTab state={state} emit={emit} />}
      {tab === "setup" && <SetupTab state={state} emit={emit} />}
      {tab === "grimoire" && <GrimoireTab state={state} emit={emit} />}
      {tab === "night" && <NightTab state={state} emit={emit} />}
      {tab === "dawn" && <DawnTab state={state} emit={emit} />}
      {tab === "votes" && <VotesTab state={state} emit={emit} />}
      {tab === "travel" && <TravelTab state={state} emit={emit} />}
      {tab === "rules" && <RulesTab state={state} emit={emit} />}
      {tab === "sound" && <SoundTab state={state} emit={emit} />}
      {tab === "ambiance" && <AmbianceTab state={state} emit={emit} />}
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
  const activeMarks = state.players
    .filter((p) => !p.leftGame && p.reminders.length > 0)
    .map((p) => ({ name: p.name, reminders: p.reminders }));

  return (
    <div className="stack">
      <div className="panel">
        <h2>Story flow</h2>
        <p className="muted">
          Tabs follow the phase: <strong>Night → Dawn → Votes</strong>. Primary button advances when
          ready. Dawn announces overnight deaths; finishing dawn starts the numbered day.
        </p>
        <p className="muted">
          Loop: First night → Dawn → Day 1 → Night → Dawn → Day 2 → Night → …
        </p>
        <div className="row">
          <button className="primary" type="button" onClick={() => emit("game:advancePhase")}>
            {advanceLabel(state)}
          </button>
        </div>
        <div className="row">
          <button type="button" onClick={() => emit("game:startFirstNight")}>
            First night
          </button>
          <button type="button" onClick={() => emit("game:goDawn")}>
            Dawn
          </button>
          <button type="button" onClick={() => emit("game:finishDawn")}>
            Finish dawn → Day {nextDayNumber(state.dayNumber)}
          </button>
          <button type="button" onClick={() => emit("game:startNight")}>
            Night
          </button>
        </div>
        <div className="row">
          <button
            className="primary"
            type="button"
            onClick={() => emit("game:endGame", { winner: "good" })}
          >
            End · Good wins
          </button>
          <button
            className="danger"
            type="button"
            onClick={() => emit("game:endGame", { winner: "evil" })}
          >
            End · Evil wins
          </button>
          <button type="button" onClick={() => emit("game:endGame", { winner: null })}>
            End · Reveal only
          </button>
        </div>
      </div>

      {activeMarks.length > 0 && (
        <div className="panel">
          <h2>Active marks</h2>
          <p className="muted">
            Poisoned / Safe / Master / vote tokens stay on the grimoire through the following day, then
            clear when the next night starts (not at dawn). Poisoned: place at night → active through
            next day → cleared at start of the following night.
          </p>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
            {activeMarks.map((m) => (
              <li key={m.name}>
                <strong>{m.name}</strong> — {m.reminders.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

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
            {state.players.some((p) => p.characterId === "baron" && !p.leftGame)
              ? " · Baron in play (+2O/−2T applied)"
              : ""}
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
  const player = state.players.find((p) => p.id === selected && !p.leftGame) ?? state.players.find((p) => !p.leftGame);
  const char =
    state.characters.find((c) => c.id === player?.characterId) ||
    state.travellers.find((c) => c.id === player?.characterId);

  const byTeam = useMemo(() => {
    const teams: Team[] = ["townsfolk", "outsider", "minion", "demon", "traveller"];
    return teams.map((t) => ({
      team: t,
      chars:
        t === "traveller"
          ? state.travellers
          : state.characters.filter((c) => c.team === t),
    }));
  }, [state.characters, state.travellers]);

  if (!player) return null;

  return (
    <div className="stack">
      <div className="panel">
        <h2>Seats</h2>
        <div className="chip-row">
          {state.players
            .filter((p) => !p.leftGame)
            .map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip ${selected === p.id ? "on" : ""}`}
              onClick={() => setSelected(p.id)}
            >
              {p.seat}. {p.name}
              {p.isTraveller ? " T" : ""}
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
        <button
          type="button"
          onClick={() =>
            emit("game:updatePlayer", {
              playerId: player.id,
              patch: { abilityUsed: !player.abilityUsed },
            })
          }
        >
          {player.abilityUsed ? "Clear used" : "Ability used"}
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
        {Array.from(
          new Set([
            ...reminderPool,
            ...player.reminders,
            // Always offer common auto-placed tokens so they show/edit on any seat
            "Drunk",
            "Poisoned",
            "Safe",
            "Master",
            "Townsfolk",
            "Outsider",
            "Minion",
            "Wrong · Washerwoman",
            "Wrong · Librarian",
            "Wrong · Investigator",
            "Wrong",
            "Red herring",
            "Died today",
            "Is the Demon",
            "No ability",
            "Dead",
            "3 votes",
            "Negative vote",
          ]),
        ).map((r) => {
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
  emit: EmitFn;
}) {
  const night = state.night;
  const [showForId, setShowForId] = useState<string | null>(null);
  const [infoPlayers, setInfoPlayers] = useState<string[]>([]);
  const [infoCharacterId, setInfoCharacterId] = useState<string>("");
  const [infoNumber, setInfoNumber] = useState<number | null>(null);
  const [infoYesNo, setInfoYesNo] = useState<"yes" | "no" | null>(null);
  const [zeroOutsiders, setZeroOutsiders] = useState(false);
  const [showing, setShowing] = useState(false);
  /** After the player has picked, reveal yes/no or character on the phone */
  const [revealResult, setRevealResult] = useState(false);
  const [targetConfirmed, setTargetConfirmed] = useState(false);
  const [redHerringId, setRedHerringId] = useState<string>("");

  const step = night?.steps[night.stepIndex];
  const show: NightShowSpec = step?.show ?? {
    kind: "none",
    hint: "Restart night to load role-specific helpers, or build info manually.",
  };
  const rolesAssigned = state.players.some((p) => !p.leftGame && p.characterId);
  const wakeStepCount =
    night?.steps.filter((s) => s.id !== "dusk" && s.id !== "dawn").length ?? 0;

  const hasRedHerring = state.players.some((p) =>
    p.reminders.some((r) => /red herring/i.test(r)),
  );
  const goodLivingForHerring = state.players.filter((p) => {
    if (p.leftGame || !p.alive) return false;
    const c =
      state.characters.find((x) => x.id === p.characterId) ||
      state.travellers.find((x) => x.id === p.characterId);
    if (!c) return true;
    return c.team === "townsfolk" || c.team === "outsider";
  });

  const characterOptions = useMemo(() => {
    const all = [...state.characters, ...state.travellers];
    const teams = show.characterTeams;
    if (!teams?.length) return all;
    return all.filter((c) => teams.includes(c.team));
  }, [state.characters, state.travellers, show.characterTeams]);

  // Clear composer when the night step changes
  useEffect(() => {
    setShowForId(null);
    setInfoPlayers([]);
    setInfoCharacterId("");
    setInfoNumber(null);
    setInfoYesNo(null);
    setZeroOutsiders(false);
    setShowing(false);
    setRevealResult(false);
    setTargetConfirmed(false);
    setRedHerringId("");
  }, [night?.stepIndex, night?.isFirstNight, step?.id]);

  if (!night) {
    return (
      <div className="stack">
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
        {state.dayAbilities.length > 0 && (
          <div className="panel">
            <h2>Day / passive abilities in play</h2>
            {state.dayAbilities.map((a) => (
              <div key={a.playerId} style={{ marginBottom: "0.75rem" }}>
                <strong>
                  {a.playerName} · {a.characterName}
                  {a.abilityUsed ? " (used)" : a.oncePerGame ? " (once)" : ""}
                </strong>
                <p className="muted" style={{ margin: "0.2rem 0 0" }}>
                  {a.tip}
                </p>
                {a.oncePerGame && (
                  <button
                    type="button"
                    onClick={() =>
                      emit("game:updatePlayer", {
                        playerId: a.playerId,
                        patch: { abilityUsed: !a.abilityUsed },
                      })
                    }
                  >
                    {a.abilityUsed ? "Clear used" : "Mark ability used"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const wakeTargets = (step?.playerIds ?? [])
    .map((id) => state.players.find((p) => p.id === id))
    .filter(Boolean) as Player[];

  const showPlayer = showForId ? state.players.find((p) => p.id === showForId) : null;
  const infoChar =
    state.characters.find((c) => c.id === infoCharacterId) ||
    state.travellers.find((c) => c.id === infoCharacterId);

  const maxPlayers = show.maxPlayers ?? 3;

  const playerPickKinds =
    show.kind === "choose-target" ||
    show.kind === "yes-no" ||
    show.kind === "player-character";

  /** Woken info role is Poisoned/Drunk — ST composes a lie; player overlay stays neutral. */
  const infoImpaired =
    Boolean(show.infoImpaired) || isPoisonedOrDrunkPlayer(showPlayer);

  function applyShowDefaults(playerId: string) {
    setShowForId(playerId);
    setRevealResult(false);
    setTargetConfirmed(false);

    const suggestedPlayers = show.suggestedPlayerIds ?? [];
    const suggestedChar = show.suggestedCharacterId ?? "";
    const suggestedNum = show.suggestedNumber;
    const suggestedYn = show.suggestedYesNo;
    // Only set when healthy + no Outsiders (impaired path clears this flag).
    const useZeroOutsiders = Boolean(show.suggestedZeroOutsiders);

    setZeroOutsiders(useZeroOutsiders);
    setInfoPlayers(
      playerPickKinds || useZeroOutsiders
        ? []
        : suggestedPlayers.slice(0, maxPlayers),
    );
    setInfoCharacterId(
      playerPickKinds || useZeroOutsiders ? "" : suggestedChar || "",
    );
    setInfoNumber(
      suggestedNum !== undefined && suggestedNum !== null ? suggestedNum : null,
    );
    setInfoYesNo(playerPickKinds ? null : (suggestedYn ?? null));

    // Demon bluffs come from the woken Demon’s grimoire entry
    if (show.kind === "demon-info") {
      setInfoPlayers(
        state.players
          .filter((p) => state.characters.find((x) => x.id === p.characterId)?.team === "minion")
          .map((p) => p.id),
      );
    }

    // Hold the phone toward the player for ask flows — but when impaired, keep ST
    // on the composer first so they can confirm the lie before the player sees anything.
    const impaired =
      Boolean(show.infoImpaired) ||
      isPoisonedOrDrunkPlayer(state.players.find((p) => p.id === playerId));
    setShowing(playerPickKinds && !impaired);
  }

  function toggleInfoPlayer(playerId: string) {
    setRevealResult(false);
    setInfoPlayers((prev) => {
      const limit = show.maxPlayers ?? 3;
      let next: string[];
      if (prev.includes(playerId)) {
        next = prev.filter((id) => id !== playerId);
      } else if (limit === 1) {
        next = [playerId];
      } else {
        next = [...prev, playerId].slice(-limit);
      }

      if (show.kind === "player-character") {
        const p = state.players.find((x) => x.id === next[0]);
        if (next.length === 0) {
          setInfoCharacterId("");
        } else if (infoImpaired) {
          const truthId = p?.characterId ?? null;
          setInfoCharacterId(
            pickWrongCharacterId(
              [...state.characters, ...state.travellers],
              truthId,
              show.characterTeams,
            ),
          );
        } else if (p?.characterId) {
          setInfoCharacterId(p.characterId);
        } else {
          setInfoCharacterId("");
        }
      }

      if (show.kind === "yes-no") {
        if (next.length < 2) {
          setInfoYesNo(null);
        } else {
          const hit = next.some((id) => {
            const p = state.players.find((x) => x.id === id);
            if (!p) return false;
            const c = state.characters.find((x) => x.id === p.characterId);
            if (c?.team === "demon") return true;
            return p.reminders.some((r) => /red herring/i.test(r));
          });
          const truth: "yes" | "no" = hit ? "yes" : "no";
          // Impaired: default to the opposite so ST can just reveal; they can override on ST panel.
          setInfoYesNo(infoImpaired ? (truth === "yes" ? "no" : "yes") : truth);
        }
      }

      return next;
    });
  }

  function confirmTarget() {
    const targetId = infoPlayers[0];
    if (!targetId || !show.reminder) return;
    const target = state.players.find((p) => p.id === targetId);
    if (!target) return;

    if (show.reminder === "Dead") {
      emit("game:otherDeath", { playerId: targetId, reason: "Demon" }, (result) => {
        const r = result as { ok?: boolean; blocked?: boolean } | undefined;
        if (r?.blocked) {
          setTargetConfirmed(false);
          return;
        }
        setTargetConfirmed(true);
        window.setTimeout(() => emit("game:markNightStepDone"), 350);
      });
      return;
    }

    // Dead is handled above; exclusive night marks go through one server mutate
    emit("game:applyNightReminder", { playerId: targetId, reminder: show.reminder });
    setTargetConfirmed(true);
    // Choice recorded on the grimoire — advance to the next wake
    window.setTimeout(() => emit("game:markNightStepDone"), 350);
  }

  /** Auto-place WW/Lib/Inv/FT tokens from the current night composer. */
  function applyInfoRemindersFromComposer() {
    const roleId = step?.characterId;
    if (!roleId) return;

    // When impaired, ST-composed values are the deliberate lie — still stamp those.

    if (roleId === "washerwoman" || roleId === "investigator") {
      if (infoPlayers.length < 2 || !infoCharacterId) return;
      emit("game:applyInfoReminders", {
        roleId,
        playerIds: infoPlayers.slice(0, 2),
        characterId: infoCharacterId,
      });
      return;
    }
    if (roleId === "librarian") {
      if (zeroOutsiders) {
        emit("game:applyInfoReminders", {
          roleId,
          playerIds: infoPlayers.slice(0, 2),
          zeroOutsiders: true,
        });
        return;
      }
      if (infoPlayers.length < 2 || !infoCharacterId) return;
      emit("game:applyInfoReminders", {
        roleId,
        playerIds: infoPlayers.slice(0, 2),
        characterId: infoCharacterId,
      });
      return;
    }
    if (roleId === "fortuneteller" && !hasRedHerring && redHerringId) {
      emit("game:applyInfoReminders", {
        roleId: "fortuneteller",
        redHerringPlayerId: redHerringId,
      });
    }
  }

  function finishNightStep() {
    applyInfoRemindersFromComposer();
    emit("game:markNightStepDone");
  }

  function startShow() {
    applyInfoRemindersFromComposer();
    setRevealResult(true);
    setShowing(true);
  }

  function startAskShow() {
    setRevealResult(false);
    setShowing(true);
  }

  const demonBluffs =
    showPlayer?.bluffs
      ?.map((id) => state.characters.find((c) => c.id === id)?.name)
      .filter(Boolean) ?? [];

  const pickablePlayers = state.players.filter((p) => !p.leftGame).filter((p) => {
    if (show.kind === "choose-target" && step?.characterId === "monk") {
      return p.id !== showForId && p.alive;
    }
    return true;
  });

  const selectedPlayerNames = infoPlayers
    .map((id) => state.players.find((p) => p.id === id)?.name)
    .filter(Boolean) as string[];

  const needsWakePick =
    show.kind !== "none" ||
    step?.id === "demon-info" ||
    step?.id === "minion-info" ||
    (step?.playerIds?.length ?? 0) > 0;

  return (
    <div className="stack">
      <div className={`panel night-step ${step?.skipped ? "skipped" : ""}`}>
        <div className="muted">
          Storyteller only · Step {night.stepIndex + 1}/{night.steps.length}
          {night.isFirstNight ? " · First night" : ""}
        </div>
        <h2>{step?.name}</h2>
        {step?.skipped && <p className="warn">{step.skipReason || "Skipped"}</p>}
        <p className="st-instruction">{step?.wakeText}</p>
        {show.kind !== "none" && (
          <p className="muted" style={{ marginTop: "0.5rem" }}>
            Show mode: <strong>{show.kind}</strong> — {show.hint}
          </p>
        )}
        {show.kind === "none" && show.hint && (
          <p className="muted" style={{ marginTop: "0.5rem" }}>
            {show.hint}
          </p>
        )}
        {!rolesAssigned && (
          <p className="warn" style={{ marginTop: "0.75rem" }}>
            No roles on the grimoire — night wakes only appear for characters that are in play.
            Assign roles on the Grimoire tab, then the order will rebuild (or restart night).
          </p>
        )}
        {rolesAssigned && wakeStepCount === 0 && step?.id !== "dawn" && (
          <p className="warn" style={{ marginTop: "0.75rem" }}>
            No night actions for anyone in play tonight (first-night-only roles already done, or
            conditional wakes skipped). Advance to Dawn step, then confirm to open Dawn.
          </p>
        )}
      </div>

      {step?.id === "dawn" && (
        <div className="panel">
          <h2>Night complete — open Dawn?</h2>
          <p className="muted">
            Wakes are done. Confirm to leave night and open the Dawn phase (deaths on TV). You can
            still go Back to review a previous step.
          </p>
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button type="button" onClick={() => emit("game:nightPrev")}>
              Back
            </button>
            <button className="primary" type="button" onClick={() => emit("game:goDawn")}>
              Confirm → Dawn
            </button>
          </div>
        </div>
      )}

      {step?.id !== "dawn" && needsWakePick && show.kind !== "none" && (
        <div className="panel">
          <h2>{wakeTargets.length ? "Wake" : "Players"}</h2>
          <div className="chip-row">
            {(wakeTargets.length ? wakeTargets : state.players.filter((p) => !p.leftGame)).map(
              (p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`chip ${showForId === p.id ? "on" : ""}`}
                  onClick={() => applyShowDefaults(p.id)}
                >
                  {p.name}
                  {!p.alive ? " †" : ""}
                </button>
              ),
            )}
          </div>
          {wakeTargets.length > 0 && (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              This step: {wakeTargets.map((p) => p.name).join(", ")}
            </p>
          )}
        </div>
      )}

      {showPlayer && !showing && show.kind !== "none" && (
        <div className="panel">
          <h2>Info for {showPlayer.name}</h2>
          {(infoImpaired || show.stWarning) && (
            <p className="warn" style={{ marginTop: "0.35rem" }}>
              {show.stWarning || "Poisoned/Drunk — give false information"}
              {(step?.characterId === "washerwoman" ||
                step?.characterId === "librarian" ||
                step?.characterId === "investigator") &&
                " · Pairing below is a lie default — adjust, then Show. Tokens stamp from what you show."}
            </p>
          )}
          {infoImpaired && (
            <p className="muted" style={{ marginTop: "0.25rem", fontSize: "0.9em" }}>
              {show.kind === "number" && show.truthNumber != null && (
                <>truth: {show.truthNumber}</>
              )}
              {show.kind === "yes-no" &&
                (() => {
                  if (infoPlayers.length < 2) {
                    return <>truth flips after they pick two players; override Yes/No below before Show</>;
                  }
                  const hit = infoPlayers.some((id) => {
                    const p = state.players.find((x) => x.id === id);
                    if (!p) return false;
                    const c = state.characters.find((x) => x.id === p.characterId);
                    if (c?.team === "demon") return true;
                    return p.reminders.some((r) => /red herring/i.test(r));
                  });
                  return <>truth: {hit ? "yes" : "no"}</>;
                })()}
              {show.kind === "character" && show.truthCharacterId && (
                <>
                  truth:{" "}
                  {(
                    state.characters.find((c) => c.id === show.truthCharacterId) ||
                    state.travellers.find((c) => c.id === show.truthCharacterId)
                  )?.name ?? show.truthCharacterId}
                </>
              )}
              {show.kind === "players-and-character" &&
                (show.truthCharacterId || (show.truthPlayerIds?.length ?? 0) > 0) && (
                  <>
                    truth:{" "}
                    {(show.truthPlayerIds ?? [])
                      .map((id) => state.players.find((p) => p.id === id)?.name)
                      .filter(Boolean)
                      .join(" · ") || "—"}
                    {show.truthCharacterId
                      ? ` · ${
                          (
                            state.characters.find((c) => c.id === show.truthCharacterId) ||
                            state.travellers.find((c) => c.id === show.truthCharacterId)
                          )?.name ?? show.truthCharacterId
                        }`
                      : ""}
                  </>
                )}
              {show.kind === "player-character" &&
                (() => {
                  const picked = state.players.find((p) => p.id === infoPlayers[0]);
                  if (!picked?.characterId) {
                    return <>truth loads from their real character; lie default fills after they pick</>;
                  }
                  const truthName =
                    state.characters.find((c) => c.id === picked.characterId)?.name ||
                    state.travellers.find((c) => c.id === picked.characterId)?.name ||
                    picked.characterId;
                  return <>truth: {truthName}</>;
                })()}
            </p>
          )}
          <p className="muted">{show.hint}</p>
          {show.playerPrompt && (
            <p className="st-instruction" style={{ marginTop: "0.35rem" }}>
              Player will see: “{show.playerPrompt}”
            </p>
          )}

          {(show.kind === "demon-info" ||
            show.kind === "minion-info" ||
            show.kind === "players-and-character" ||
            show.kind === "yes-no" ||
            show.kind === "player-character" ||
            show.kind === "choose-target" ||
            show.kind === "character") && (
            <>
              <label className="muted">
                {show.kind === "choose-target"
                  ? "Target"
                  : show.kind === "player-character"
                    ? "They chose"
                    : show.kind === "yes-no"
                      ? "Their two players"
                      : show.minPlayers
                        ? `Players (${show.minPlayers}–${maxPlayers})`
                        : "Players"}
              </label>
              <div className="chip-row">
                {pickablePlayers.map((p) => {
                  const on = infoPlayers.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`chip ${on ? "on" : ""}`}
                      onClick={() => toggleInfoPlayer(p.id)}
                    >
                      {p.name}
                      {!p.alive ? " †" : ""}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {(show.kind === "players-and-character" ||
            show.kind === "character" ||
            show.kind === "player-character") && (
            <>
              <label className="muted" style={{ display: "block", marginTop: "0.5rem" }}>
                Character token
                {infoImpaired ? " (lie — adjust if needed)" : ""}
              </label>
              <select
                value={zeroOutsiders ? "" : infoCharacterId}
                disabled={zeroOutsiders}
                onChange={(e) => {
                  setZeroOutsiders(false);
                  setInfoCharacterId(e.target.value);
                }}
              >
                <option value="">— none —</option>
                {characterOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.team})
                  </option>
                ))}
              </select>
              {show.allowZeroOutsiders && (
                <div className="chip-row" style={{ marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className={`chip ${zeroOutsiders ? "on" : ""}`}
                    onClick={() => {
                      setZeroOutsiders((z) => !z);
                      setInfoCharacterId("");
                    }}
                  >
                    {show.zeroOutsidersLabel || "Zero Outsiders"}
                  </button>
                </div>
              )}
            </>
          )}

          {show.kind === "demon-info" && (
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              Bluffs on Demon token:{" "}
              {demonBluffs.length ? demonBluffs.join(", ") : "— set bluffs in Grimoire —"}
            </p>
          )}

          {show.kind === "number" && (
            <>
              <label className="muted" style={{ display: "block", marginTop: "0.5rem" }}>
                Number
                {infoImpaired
                  ? " (lie default — adjust if needed)"
                  : show.suggestedNumber != null
                    ? ` (suggested: ${show.suggestedNumber})`
                    : ""}
              </label>
              <div className="chip-row">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`chip ${infoNumber === n ? "on" : ""}`}
                    onClick={() => setInfoNumber(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>
          )}

          {show.kind === "yes-no" && (
            <>
              <label className="muted" style={{ display: "block", marginTop: "0.5rem" }}>
                {infoImpaired
                  ? "Answer (lie default after they pick — override here before Show)"
                  : "Answer (auto from Demon / Red Herring — override if needed)"}
              </label>
              <div className="chip-row">
                <button
                  type="button"
                  className={`chip ${infoYesNo === "yes" ? "on" : ""}`}
                  onClick={() => setInfoYesNo("yes")}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className={`chip ${infoYesNo === "no" ? "on" : ""}`}
                  onClick={() => setInfoYesNo("no")}
                >
                  No
                </button>
              </div>
              {step?.characterId === "fortuneteller" && !hasRedHerring && (
                <>
                  <label className="muted" style={{ display: "block", marginTop: "0.75rem" }}>
                    Red herring not placed — pick a good living player (setup / first FT wake)
                  </label>
                  <div className="chip-row">
                    {goodLivingForHerring.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`chip ${redHerringId === p.id ? "on" : ""}`}
                        onClick={() => setRedHerringId(p.id)}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                  {goodLivingForHerring.length === 0 && (
                    <p className="warn">No good living players available for Red herring.</p>
                  )}
                </>
              )}
            </>
          )}

          {show.kind === "grimoire" && (
            <p className="warn" style={{ marginTop: "0.75rem" }}>
              Spy sees the full grimoire on Show — turn the phone toward them only.
            </p>
          )}

          {show.kind === "message" && show.message && (
            <div className="show-block" style={{ marginTop: "0.75rem" }}>
              <div className="muted">They will see</div>
              <div className="show-big">{show.message}</div>
            </div>
          )}

          {show.kind === "choose-target" && (
            <div className="row" style={{ marginTop: "0.75rem" }}>
              <button className="primary" type="button" onClick={startAskShow}>
                Show ask to {showPlayer.name}
              </button>
              <button
                className="primary"
                type="button"
                disabled={!infoPlayers[0]}
                onClick={confirmTarget}
              >
                Confirm{show.reminder ? ` → ${show.reminder}` : ""}
              </button>
              {targetConfirmed && <span className="muted">Marked.</span>}
            </div>
          )}

          {show.kind !== "choose-target" && (
            <div className="row" style={{ marginTop: "0.75rem" }}>
              {playerPickKinds && (
                <button type="button" onClick={startAskShow}>
                  Show ask to {showPlayer.name}
                </button>
              )}
              <button
                className="primary"
                type="button"
                onClick={startShow}
                disabled={
                  show.kind === "number"
                    ? infoNumber === null
                    : show.kind === "yes-no"
                      ? infoPlayers.length < 2 || !infoYesNo
                      : false
                }
              >
                Show to {showPlayer.name}
              </button>
              <button type="button" onClick={() => setShowForId(null)}>
                Cancel
              </button>
            </div>
          )}

          {show.kind === "choose-target" && (
            <div className="row" style={{ marginTop: "0.5rem" }}>
              <button type="button" onClick={() => setShowForId(null)}>
                Done with {showPlayer.name}
              </button>
            </div>
          )}
        </div>
      )}

      {showing && showPlayer && (
        <div className="show-player-gate">
          <div className="show-player-card">
            <p className="show-eyes-only">For your eyes only</p>
            {show.playerTitle ? (
              <h2 className="show-player-title">{show.playerTitle}</h2>
            ) : (
              <h2>{showPlayer.name}</h2>
            )}
            {show.playerPrompt && <p className="show-prompt">{show.playerPrompt}</p>}
            <i className="ornament" aria-hidden />

            {/* —— Ask / pick phase (ST taps on behalf of player) —— */}
            {playerPickKinds && !revealResult && (
              <>
                <div className="show-block">
                  <div className="show-section-label">
                    {show.kind === "yes-no"
                      ? "Tap two players"
                      : show.kind === "choose-target"
                        ? "Tap a player"
                        : "Tap a player"}
                  </div>
                  <div className="chip-row show-pick-chips">
                    {pickablePlayers.map((p) => {
                      const on = infoPlayers.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`chip ${on ? "on" : ""}`}
                          onClick={() => toggleInfoPlayer(p.id)}
                        >
                          {p.name}
                          {!p.alive ? " †" : ""}
                        </button>
                      );
                    })}
                  </div>
                  {selectedPlayerNames.length > 0 && (
                    <div className="show-big" style={{ marginTop: "0.75rem" }}>
                      {selectedPlayerNames.join(" · ")}
                    </div>
                  )}
                </div>

                {show.kind === "choose-target" && (
                  <div className="row show-overlay-actions">
                    <button
                      className="primary"
                      type="button"
                      disabled={!infoPlayers[0]}
                      onClick={confirmTarget}
                    >
                      Confirm choice
                    </button>
                    {targetConfirmed && <span className="muted">Marked.</span>}
                  </div>
                )}

                {show.kind === "yes-no" && (
                  <>
                    <div className="row show-overlay-actions">
                      <button
                        className="primary"
                        type="button"
                        disabled={infoPlayers.length < 2 || !infoYesNo}
                        onClick={() => {
                          applyInfoRemindersFromComposer();
                          setRevealResult(true);
                        }}
                      >
                        Reveal answer
                      </button>
                    </div>
                  </>
                )}

                {show.kind === "player-character" && (
                  <div className="row show-overlay-actions">
                    <button
                      className="primary"
                      type="button"
                      disabled={!infoPlayers[0] || (!infoCharacterId && !zeroOutsiders)}
                      onClick={() => setRevealResult(true)}
                    >
                      Reveal character
                    </button>
                  </div>
                )}
              </>
            )}

            {/* —— Reveal / info phase —— */}
            {(revealResult || !playerPickKinds) && (
              <>
                {selectedPlayerNames.length > 0 &&
                  show.kind !== "grimoire" &&
                  !(show.kind === "yes-no" && !revealResult) && (
                    <div className="show-block">
                      <div className="show-section-label">
                        {show.playersLabel || "Players"}
                      </div>
                      <div className="show-big">{selectedPlayerNames.join(" · ")}</div>
                    </div>
                  )}

                {infoChar && !zeroOutsiders && (revealResult || !playerPickKinds) && (
                  <div className="show-block">
                    <div className="show-section-label">
                      {show.characterLabel || "Character"}
                    </div>
                    <div className={`show-big badge ${infoChar.team}`}>{infoChar.name}</div>
                  </div>
                )}

                {zeroOutsiders && (
                  <div className="show-block">
                    <div className="show-section-label">
                      {show.characterLabel || "Outsiders"}
                    </div>
                    <div className="show-big">
                      {show.zeroOutsidersLabel || "Zero Outsiders"}
                    </div>
                  </div>
                )}

                {show.kind === "demon-info" && (
                  <div className="show-block">
                    <div className="show-section-label">
                      {show.bluffsLabel || "Bluffs"}
                    </div>
                    <div className="show-big">
                      {demonBluffs.length
                        ? demonBluffs.join(" · ")
                        : "— no bluffs set —"}
                    </div>
                  </div>
                )}

                {show.kind === "grimoire" && (
                  <div className="show-block">
                    <div className="show-section-label">Grimoire</div>
                    <ul className="show-grim">
                      {state.players
                        .filter((p) => !p.leftGame)
                        .map((p) => {
                          const c =
                            state.characters.find((x) => x.id === p.characterId) ||
                            state.travellers.find((x) => x.id === p.characterId);
                          return (
                            <li key={p.id}>
                              <strong>{p.name}</strong> — {c?.name ?? "?"} ({c?.team ?? "?"})
                              {!p.alive ? " †" : ""}
                              {p.reminders.length ? ` · ${p.reminders.join(", ")}` : ""}
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                )}

                {show.kind === "message" && show.message && (
                  <div className="show-block">
                    <div className="show-section-label">
                      {show.resultLabel || "Message"}
                    </div>
                    <div className="show-big">{show.message}</div>
                  </div>
                )}

                {infoNumber !== null && show.kind === "number" && (
                  <div className="show-block">
                    <div className="show-section-label">
                      {show.resultLabel || "Number"}
                    </div>
                    <div className="show-number">{infoNumber}</div>
                  </div>
                )}

                {infoYesNo && show.kind === "yes-no" && revealResult && (
                  <div className="show-block">
                    <div className="show-section-label">
                      {show.resultLabel || "Answer"}
                    </div>
                    <div className="show-number">
                      {infoYesNo === "yes" ? "YES" : "NO"}
                    </div>
                  </div>
                )}
              </>
            )}

            <button
              className="primary"
              type="button"
              onClick={() => {
                setShowing(false);
                setRevealResult(false);
              }}
            >
              Hide (back to Storyteller)
            </button>
          </div>
        </div>
      )}

      <div className="footer-actions">
        <button type="button" onClick={() => emit("game:nightPrev")}>
          Back
        </button>
        {step?.id === "dawn" ? (
          <button className="primary" type="button" onClick={() => emit("game:goDawn")}>
            Confirm → Dawn
          </button>
        ) : (
          <>
            <button className="primary" type="button" onClick={finishNightStep}>
              Done → next
            </button>
            <button type="button" onClick={() => emit("game:nightNext")}>
              Skip step
            </button>
          </>
        )}
        <button type="button" onClick={() => emit("game:goDawn")}>
          End night → Dawn
        </button>
      </div>
    </div>
  );
}

function TravelTab({
  state,
  emit,
}: {
  state: StorytellerState;
  emit: (e: string, d?: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [characterId, setCharacterId] = useState(state.travellers[0]?.id ?? "");
  const active = state.players.filter((p) => p.isTraveller && !p.leftGame);

  return (
    <div className="stack">
      <div className="panel">
        <h2>Add Traveller</h2>
        <p className="muted">
          Joins mid-game. Exile via Leave. Travellers don&apos;t count for Scarlet Woman&apos;s 5.
        </p>
        <label className="muted">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Traveller name" />
        <label className="muted" style={{ display: "block", marginTop: "0.5rem" }}>
          Character
        </label>
        <select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
          {state.travellers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <button
            className="primary"
            type="button"
            disabled={!characterId}
            onClick={() => {
              emit("game:addTraveller", { name: name || undefined, characterId });
              setName("");
            }}
          >
            Join table
          </button>
        </div>
      </div>
      <div className="panel">
        <h2>At the table</h2>
        {active.length === 0 && <p className="muted">No Travellers in play.</p>}
        {active.map((p) => {
          const t = state.travellers.find((x) => x.id === p.characterId);
          return (
            <div key={p.id} className="player-card" style={{ marginBottom: "0.5rem" }}>
              <header>
                <div>
                  <strong>
                    {p.name} · {t?.name ?? "?"}
                  </strong>
                  <p className="muted" style={{ margin: 0 }}>
                    {t?.ability}
                  </p>
                </div>
                <button
                  className="danger"
                  type="button"
                  onClick={() => emit("game:leaveTraveller", { playerId: p.id })}
                >
                  Leave
                </button>
              </header>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SOUND_GROUPS: { id: AudioCueInfo["group"]; label: string }[] = [
  { id: "core", label: "Core / beds" },
  { id: "phase", label: "Day & night" },
  { id: "votes", label: "Votes & judgment" },
  { id: "deaths", label: "Deaths" },
  { id: "endgame", label: "Endgame" },
  { id: "guests", label: "Guests & shots" },
  { id: "rules", label: "Rules teach" },
  { id: "atmosphere", label: "Atmosphere" },
  { id: "other", label: "Other" },
];

function CueButtons({
  cues,
  emit,
}: {
  cues: AudioCueInfo[];
  emit: (e: string, d?: unknown) => void;
}) {
  if (cues.length === 0) return <p className="muted">No cues in this section yet.</p>;

  const bySub = new Map<string, AudioCueInfo[]>();
  for (const c of cues) {
    const key = c.subgroup || "";
    if (!bySub.has(key)) bySub.set(key, []);
    bySub.get(key)!.push(c);
  }

  return (
    <div className="stack" style={{ gap: "0.75rem" }}>
      {[...bySub.entries()].map(([sub, list]) => (
        <div key={sub || "_"}>
          {sub ? <h3 className="sound-subgroup">{sub}</h3> : null}
          <div className="chip-row">
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                className="chip"
                onClick={() => emit("game:playSound", { cueId: c.id })}
                title={c.file}
              >
                {c.label}
                {!c.builtin ? " ★" : ""}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RulesTab({
  state,
  emit,
}: {
  state: StorytellerState;
  emit: (e: string, d?: unknown) => void;
}) {
  const rules = state.audioCues.filter((c) => c.group === "rules");
  const full = rules.find((c) => c.file.replace(/\.[^.]+$/, "") === "rules_full");
  const chapters = rules.filter((c) => c.file.replace(/\.[^.]+$/, "") !== "rules_full");

  return (
    <div className="stack">
      <div className="panel">
        <h2>Auto vs Storyteller</h2>
        <p className="muted">
          Companion auto-enforces binary game-state. When Poisoned/Drunk, info roles get
          ST-only lie defaults — the player overlay only shows the finished (possibly false) reveal.
        </p>
        <p>
          <strong>Auto</strong>
        </p>
        <ul style={{ margin: "0.25rem 0 0.75rem", paddingLeft: "1.1rem" }}>
          <li>Monk Safe / Soldier block night Demon kills (fail if Poisoned/Drunk as noted)</li>
          <li>Butler vote only if Master is voting; Bureaucrat ×3 / Thief −1 on tally</li>
          <li>Imp star-pass on self-kill; Scarlet Woman → Imp (+ Is the Demon) when Demon dies &amp; ≥5 non-travellers</li>
          <li>Virgin auto-executes Townsfolk nominator (not if Virgin Poisoned/Drunk)</li>
          <li>Saint executed → Evil wins (not if Poisoned/Drunk)</li>
          <li>Mayor: Start night with 3 alive non-travellers &amp; no execution → Good wins</li>
          <li>Baron adjusts setup bag +2 Outsiders / −2 Townsfolk</li>
          <li>
            Night Show/Done places WW Townsfolk+Wrong · Washerwoman, Lib Outsider+Wrong · Librarian, Inv Minion+Wrong · Investigator; FT Red
            herring if missing; execution places Died today; Imp kill rebuilds Ravenkeeper wake
          </li>
        </ul>
        <p>
          <strong>ST decides</strong>
        </p>
        <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.1rem" }}>
          <li>Washer / Lib / Inv / Chef / Empath / FT / Ravenkeeper / Spy info when Drunk/poisoned</li>
          <li>Recluse / Spy registration edge cases</li>
          <li>Slayer shot (manual public death)</li>
          <li>Complex Traveller day powers (Matron, Judge, Voudon, …)</li>
        </ul>
      </div>
      <div className="panel">
        <h2>Rules teach</h2>
        <p className="muted">
          Play for the town before secrets are dealt. TV must have sound enabled. Use Stop beds if a
          bed is looping underneath.
        </p>
        <div className="row">
          {full && (
            <button
              className="primary"
              type="button"
              onClick={() => emit("game:playSound", { cueId: full.id })}
            >
              Play full rules
            </button>
          )}
          <button type="button" onClick={() => emit("game:playSound", { cueId: "hush" })}>
            Stop / hush
          </button>
          <button type="button" onClick={() => emit("game:refresh")}>
            Rescan audio
          </button>
        </div>
      </div>
      <div className="panel">
        <h2>Chapters</h2>
        <p className="muted">Play in order, or skip to the part you need.</p>
        <CueButtons cues={chapters} emit={emit} />
        {chapters.length === 0 && (
          <p className="muted">
            No <code>rules_*.mp3</code> files found in <code>data/audio/</code>.
          </p>
        )}
      </div>
    </div>
  );
}

function SoundTab({
  state,
  emit,
}: {
  state: StorytellerState;
  emit: (e: string, d?: unknown) => void;
}) {
  const [filter, setFilter] = useState<AudioCueInfo["group"] | "all">("all");

  const groups = SOUND_GROUPS.map((g) => ({
    ...g,
    cues: state.audioCues.filter((c) => c.group === g.id),
  })).filter((g) => g.cues.length > 0);

  const visible =
    filter === "all" ? groups : groups.filter((g) => g.id === filter);

  return (
    <div className="stack">
      <div className="panel">
        <h2>Soundboard</h2>
        <p className="muted">
          Plays on the TV (Enable sound first). ★ = custom file from <code>data/audio/</code>.
        </p>
        <div className="row">
          <button type="button" onClick={() => emit("game:playSound", { cueId: "hush" })}>
            Stop beds / Hush
          </button>
          <button type="button" onClick={() => emit("game:refresh")}>
            Rescan audio folder
          </button>
        </div>
        <div className="chip-row" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className={`chip${filter === "all" ? " on" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`chip${filter === g.id ? " on" : ""}`}
              onClick={() => setFilter(g.id)}
            >
              {g.label} ({g.cues.length})
            </button>
          ))}
        </div>
      </div>
      {visible.map((g) => (
        <div className="panel" key={g.id}>
          <h2>{g.label}</h2>
          <CueButtons cues={g.cues} emit={emit} />
        </div>
      ))}
    </div>
  );
}

function AmbianceTab({
  state,
  emit,
}: {
  state: StorytellerState;
  emit: (e: string, d?: unknown) => void;
}) {
  const mix = state.ambiance;
  const catalog = state.ambianceCatalog ?? [];
  const layerById = useMemo(() => new Map(mix.layers.map((l) => [l.id, l])), [mix.layers]);
  const activeCount = mix.layers.filter((l) => l.enabled).length;

  function pushLayers(
    next: { id: string; enabled: boolean; volume: number }[],
    masterVolume = mix.masterVolume,
  ) {
    emit("game:setAmbiance", { masterVolume, layers: next });
  }

  function setMaster(masterVolume: number) {
    emit("game:setAmbiance", {
      masterVolume,
      layers: mix.layers.map((l) => ({ id: l.id, enabled: l.enabled, volume: l.volume })),
    });
  }

  function patchLayer(id: string, patch: Partial<{ enabled: boolean; volume: number }>) {
    const layers = catalog.map((def) => {
      const cur = layerById.get(def.id);
                  const base = {
                    id: def.id,
                    enabled: cur?.enabled ?? false,
                    volume: cur?.volume ?? def.defaultVolume ?? 0.4,
                  };
      if (def.id !== id) return base;
      return { ...base, ...patch };
    });
    pushLayers(layers);
  }

  function allOff() {
    pushLayers(
      mix.layers.map((l) => ({ id: l.id, enabled: false, volume: l.volume })),
      mix.masterVolume,
    );
  }

  return (
    <div className="stack">
      <div className="panel">
        <h2>Ambiance</h2>
        <p className="muted">
          Layer beds from <code>data/audio/ambiance/</code> on the TV. Loops stay on; sporadic
          one-shots fire with long random gaps. When narration / a sting plays, ambiance ducks,
          then returns.
        </p>
        <label className="ambiance-master">
          <span>Master volume · {Math.round(mix.masterVolume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={mix.masterVolume}
            onChange={(e) => setMaster(Number(e.target.value))}
          />
        </label>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <button type="button" onClick={allOff} disabled={activeCount === 0}>
            All layers off
          </button>
          <button type="button" onClick={() => emit("game:refresh")}>
            Rescan audio
          </button>
        </div>
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          {activeCount === 0
            ? "No layers playing."
            : `${activeCount} layer${activeCount === 1 ? "" : "s"} active · synced to TV`}
        </p>
      </div>

      <div className="panel">
        <h2>Layers</h2>
        <div className="ambiance-list">
          {catalog.map((def) => {
            const layer = layerById.get(def.id);
            const enabled = layer?.enabled ?? false;
            const volume = layer?.volume ?? def.defaultVolume ?? 0.4;
            const kind = def.kind ?? "loop";
            return (
              <div key={def.id} className={`ambiance-row${enabled ? " on" : ""}`}>
                <button
                  type="button"
                  className={`chip${enabled ? " on" : ""}`}
                  onClick={() => patchLayer(def.id, { enabled: !enabled })}
                  title={def.hint}
                >
                  {enabled ? "On" : "Off"}
                </button>
                <div className="ambiance-meta">
                  <div className="ambiance-label">
                    {def.label}
                    <span className="muted ambiance-kind"> · {kind}</span>
                  </div>
                  <div className="muted ambiance-hint">
                    {def.hint}
                    {kind === "sporadic" && def.minGapSec != null
                      ? ` · ≥${def.minGapSec}s gap`
                      : ""}
                  </div>
                  <label className="ambiance-vol">
                    <span>{Math.round(volume * 100)}%</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      disabled={!enabled}
                      onChange={(e) => patchLayer(def.id, { volume: Number(e.target.value) })}
                    />
                  </label>
                </div>
              </div>
            );
          })}
          {catalog.length === 0 && (
            <p className="muted">
              No ambiance files found. Run <code>python scripts/generate_ambiance.py</code> or add
              mp3s under <code>data/audio/ambiance/</code>.
            </p>
          )}
        </div>
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
        <p className="muted">
          Dawn is the death announcement before Day {nextDayNumber(state.dayNumber)}. Select who died,
          announce on the TV, then finish dawn — that is what moves you to Day{" "}
          {nextDayNumber(state.dayNumber)}.
        </p>
        <div className="chip-row">
          {state.players
            .filter((p) => !p.leftGame && (p.alive || selected.has(p.id)))
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
        <button
          className="primary"
          type="button"
          onClick={() => {
            // Server waits for the death/no-deaths cue length before day_N (avoids stopSting cutoff)
            emit("game:announceDawnThenDay");
          }}
        >
          Announce → Day {nextDayNumber(state.dayNumber)}
        </button>
        <button type="button" onClick={() => emit("game:finishDawn")}>
          Skip announce · Day {nextDayNumber(state.dayNumber)}
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
  const master = state.players.find((p) => p.reminders.includes("Master") && !p.leftGame);
  const butler = state.players.find(
    (p) => p.characterId === "butler" && p.alive && !p.leftGame,
  );

  return (
    <div className="stack">
      <div className="panel">
        <h2>Nominate</h2>
        <p className="muted">
          Virgin auto-executes a Townsfolk nominator (unless Virgin is Poisoned/Drunk). Saint
          execution → Evil wins. Vote tally applies Butler / 3 votes / Negative vote.
        </p>
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
          <p className="muted">
            Hands: {nom.votesFor.length}
            {butler && master
              ? ` · Butler (${butler.name}) needs Master (${master.name}) voting`
              : butler
                ? ` · Butler (${butler.name}) — set Master on grimoire`
                : ""}
            {state.players.some((p) => p.reminders.includes("3 votes") && p.alive)
              ? " · 3-votes token in play"
              : ""}
            {state.players.some((p) => p.reminders.includes("Negative vote") && p.alive)
              ? " · Negative-vote token in play"
              : ""}
          </p>
          <div className="chip-row">
            {state.players.map((p) => {
              const on = nom.votesFor.includes(p.id);
              // Raising a ghost hand requires an unused ghost vote; lowering always allowed while on.
              const canRaise = p.alive || (!p.isTraveller && !p.usedGhostVote);
              const can = on || canRaise;
              const mods = [
                p.reminders.includes("3 votes") ? "×3" : "",
                p.reminders.includes("Negative vote") ? "−" : "",
                butler && p.id === butler.id ? "Butler" : "",
                master && p.id === master.id ? "Master" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!can}
                  className={`chip ${on ? "on" : ""}`}
                  onClick={() => emit("game:toggleVote", { playerId: p.id })}
                >
                  {p.name}
                  {!p.alive ? " †" : ""}
                  {mods ? ` ${mods}` : ""}
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

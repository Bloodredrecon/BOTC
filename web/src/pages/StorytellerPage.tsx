import { useEffect, useMemo, useState } from "react";
import { useSocket, useStoryteller } from "../socket";
import type { AudioCueInfo, NightShowSpec, Player, StorytellerState, Team } from "../types";
import { ConnectionBanners, ConnectionPills } from "./storyteller/ConnectionStatus";
import { LogPanel } from "./storyteller/LogPanel";

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
  | "travel"
  | "log";

function nextDayNumber(dayNumber: number) {
  return dayNumber === 0 ? 1 : dayNumber + 1;
}

/** Match server rules.isPoisonedOrDrunk (the Beggar is always sober & healthy). */
function isPoisonedOrDrunkPlayer(p: Player | null | undefined): boolean {
  if (!p || p.characterId === "beggar") return false;
  return (
    p.reminders.includes("Poisoned") ||
    p.reminders.includes("Drunk") ||
    p.reminders.includes("Is the Drunk") ||
    p.characterId === "drunk"
  );
}

/** Match server rules.wakeCharacterId — the Drunk wakes as the Townsfolk they think they are. */
function wakeCharacterId(p: Player | null | undefined): string | null {
  if (!p) return null;
  return p.characterId === "drunk" ? p.thinksCharacterId ?? null : p.characterId;
}

/** Match server rules.trueCharacterId — what abilities that learn characters see. */
function trueCharacterId(p: Player | null | undefined, characters: { id: string; team: Team }[]): string | null {
  if (!p) return null;
  if (p.characterId === "drunk") return "drunk";
  const legacy = p.reminders.includes("Drunk") || p.reminders.includes("Is the Drunk");
  if (legacy && characters.find((c) => c.id === p.characterId)?.team === "townsfolk") return "drunk";
  return p.characterId;
}

/** Match server rules.nightKillProtection — why a Demon kill on `target` fails tonight. */
function nightKillProtection(players: Player[], target: Player | null | undefined): string | null {
  if (!target || !target.alive) return null;
  if (target.reminders.includes("Safe")) {
    // Only the Monk's own health matters — the protected player's poison is irrelevant.
    const monk = players.find((p) => wakeCharacterId(p) === "monk" && p.alive && !p.leftGame);
    if (!monk || !isPoisonedOrDrunkPlayer(monk)) return "Protected by the Monk (Safe)";
  }
  if (target.characterId === "soldier" && !isPoisonedOrDrunkPlayer(target)) {
    return "Soldier: safe from the Demon";
  }
  return null;
}

/** Match server rules.mayorBounceAvailable — a healthy, unprotected Mayor the Imp attacks. */
function mayorBounceAvailable(players: Player[], target: Player | null | undefined): boolean {
  return Boolean(
    target &&
      target.alive &&
      target.characterId === "mayor" &&
      !isPoisonedOrDrunkPlayer(target) &&
      !nightKillProtection(players, target),
  );
}

/** Pick a character id different from truth (for impaired Ravenkeeper / Undertaker lies). */
function pickWrongCharacterId(
  all: { id: string; team: Team }[],
  truthId: string | null | undefined,
  teams?: Team[],
  ownRoleId?: string | null,
): string {
  const pool = all.filter((c) => {
    if (truthId && c.id === truthId) return false;
    if (ownRoleId && c.id === ownRoleId) return false;
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
      when = `Day ${state.dayNumber} · discussion`;
      break;
    case "nomination":
    case "vote":
    case "execution":
      when = `Day ${state.dayNumber} · nominations`;
      break;
    case "dusk":
      when = state.nightPending
        ? `Dusk · day ${state.dayNumber} · night next`
        : state.nominationsOpen
          ? `Dusk · day ${state.dayNumber} · nominations open`
          : `Dusk · day ${state.dayNumber} · nominations not open yet`;
      break;
    case "ended":
      when = state.winner === "good" ? "Ended · Good wins" : state.winner === "evil" ? "Ended · Evil wins" : "Ended";
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
      return "Go to dusk";
    case "dusk":
      return state.nominationsOpen || state.nightPending ? endDayLabel(state) : "Open nominations";
    case "nomination":
    case "vote":
    case "execution":
      return endDayLabel(state);
    default:
      return "Advance";
  }
}

/** Nominations hub's end-of-day button: execute the block holder (if any), then the night. */
function endDayLabel(state: StorytellerState) {
  if (state.nightPending) return "Start night now";
  const holderId = state.block?.nomineeId;
  const holder = holderId ? state.players.find((p) => p.id === holderId && !p.leftGame)?.name : undefined;
  return holder && !state.executedTodayId ? `Close nominations — execute ${holder}` : "Close nominations — no execution";
}

function endDayBlocked(state: StorytellerState): string | null {
  if (state.phase === "nomination") return "A nomination is open — start the vote, resolve it or cancel it first.";
  if (state.phase === "vote") return "A vote is open — resolve it (or cancel the nomination) first.";
  if (state.phase === "execution") return "Confirm the execution (death or lives) first.";
  return null;
}

const DAY_PHASES: StorytellerState["phase"][] = ["day", "dusk", "nomination", "vote", "execution"];

type FlowStep = "dawn" | "day" | "dusk" | "nominations" | "night";
const FLOW_STEPS: { id: FlowStep; label: string }[] = [
  { id: "dawn", label: "Dawn" },
  { id: "day", label: "Day" },
  { id: "dusk", label: "Dusk" },
  { id: "nominations", label: "Nominations" },
  { id: "night", label: "Night" },
];

function flowStep(state: StorytellerState): FlowStep | null {
  switch (state.phase) {
    case "firstNight":
    case "night":
      return "night";
    case "dawn":
      return "dawn";
    case "day":
      return "day";
    case "dusk":
      return state.nominationsOpen || state.nightPending ? "nominations" : "dusk";
    case "nomination":
    case "vote":
    case "execution":
      return "nominations";
    default:
      return null;
  }
}

/** One sentence: where the day is and what the Storyteller does next. */
function flowStatus(state: StorytellerState): string {
  switch (state.phase) {
    case "firstNight":
    case "night":
      return "Night — work through the night order, then go to dawn.";
    case "dawn":
      return "Dawn — announce overnight deaths, then start the day.";
    case "day":
      return "Open discussion. Nominations are closed until dusk.";
    case "dusk":
      if (state.nightPending) return "Execution done — the night starts when the execution line finishes.";
      return state.nominationsOpen
        ? "Nominations are open — pick a nominator and a nominee below."
        : "Dusk announcement. Nominations are not open yet — press Open nominations when the room is ready.";
    case "nomination":
      return "Nomination in progress — start the vote clock or resolve the vote below.";
    case "vote":
      return "Vote in progress — raise hands below, then resolve the vote.";
    case "execution":
      return "Execution — Confirm death or Lives below.";
    default:
      return "";
  }
}

/** Day > Dusk > Nominations > Night indicator with the single next action. */
function DayFlowBar({
  state,
  emit,
  showNext,
}: {
  state: StorytellerState;
  emit: (e: string, d?: unknown) => void;
  showNext: boolean;
}) {
  const current = flowStep(state);
  if (!current) return null;
  const idx = FLOW_STEPS.findIndex((s) => s.id === current);
  const blocked = showNext ? endDayBlocked(state) : null;
  return (
    <div className="panel" style={{ borderColor: "var(--gold, #c9a45c)" }}>
      <div
        className="row"
        style={{ gap: "0.35rem", flexWrap: "wrap", alignItems: "center", fontFamily: "Cinzel, serif" }}
        aria-label="Day steps"
      >
        {FLOW_STEPS.map((s, i) => (
          <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <span
              aria-current={i === idx ? "step" : undefined}
              style={{
                padding: "0.2rem 0.6rem",
                borderRadius: "999px",
                border: `1px solid ${i === idx ? "var(--blood-bright, #c44)" : "rgba(255,255,255,0.18)"}`,
                background: i === idx ? "var(--blood-bright, #c44)" : "transparent",
                color: i === idx ? "#fff" : i < idx ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.4)",
                fontWeight: i === idx ? 700 : 400,
              }}
            >
              {i < idx ? "✓ " : ""}
              {s.label}
            </span>
            {i < FLOW_STEPS.length - 1 && <span className="muted">›</span>}
          </span>
        ))}
      </div>
      <p style={{ margin: "0.6rem 0" }}>{flowStatus(state)}</p>
      {showNext && (
        <div className="row">
          <button
            className="primary"
            type="button"
            disabled={Boolean(blocked)}
            onClick={() => emit("game:advancePhase")}
            style={{ fontSize: "1.05rem" }}
          >
            Next: {advanceLabel(state)}
          </button>
        </div>
      )}
      {blocked && <p className="muted">{blocked}</p>}
    </div>
  );
}

const SKIP_TO_NIGHT_CONFIRM =
  "Skip to night without an execution? Nobody on the block is executed today and the chronicle notes “No execution today”.";

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
    case "dusk":
      return "votes";
    case "ended":
      return "control";
    default:
      return "control";
  }
}

export function StorytellerPage() {
  const { socketRef, connected, emit, droppedAt } = useSocket();
  const [pinInput, setPinInput] = useState(() => localStorage.getItem(PIN_KEY) ?? "");
  const [pin, setPin] = useState<string | null>(() => localStorage.getItem(PIN_KEY));
  const [attempt, setAttempt] = useState(0);
  const { state, authError, authed, retryAt, pinIsDefault, presence } = useStoryteller(socketRef, pin, attempt);
  const [tab, setTab] = useState<Tab>("control");
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!retryAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [retryAt]);
  const waitSecs = retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : 0;

  // When the story phase changes, open the matching tab (Setup → Night → Dawn → Votes → …)
  useEffect(() => {
    if (!state) return;
    setTab(tabForPhase(state.phase));
  }, [state?.phase]);

  function login(e: React.FormEvent) {
    e.preventDefault();
    if (waitSecs > 0) return;
    localStorage.setItem(PIN_KEY, pinInput);
    setPin(pinInput);
    setAttempt((n) => n + 1);
  }

  if (!pin || (!authed && authError)) {
    return (
      <div className="pin-screen">
        <form className="panel" onSubmit={login}>
          <h1 className="brand" style={{ fontSize: "1.5rem", color: "var(--blood-bright)" }}>
            Storyteller
          </h1>
          <i className="ornament" aria-hidden />
          <p className="muted">Enter the Storyteller PIN. Guard this from the town.</p>
          <input
            type="password"
            inputMode="numeric"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            placeholder="PIN"
            autoFocus
          />
          {authError && (
            <p className="warn">{waitSecs > 0 ? `Too many wrong PINs. Try again in ${waitSecs} s.` : authError}</p>
          )}
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button className="primary" type="submit" disabled={waitSecs > 0}>
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
        <ConnectionPills connected={connected} presence={presence} />
      </div>

      <ConnectionBanners connected={connected} presence={presence} phase={state.phase} droppedAt={droppedAt} />

      {pinIsDefault && (
        <div className="panel pin-default-warning" role="alert">
          The Storyteller PIN is still the default (1234), so anyone on this network could open the
          grimoire. Change it on the server PC: <b>BOTC.bat</b> &gt; Settings &gt; Storyteller PIN.
        </div>
      )}

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
            ["log", "Log"],
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

      {(tab === "control" || tab === "votes") && (
        <DayFlowBar state={state} emit={emit} showNext={tab === "control"} />
      )}

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
      {tab === "log" && <LogPanel socketRef={socketRef} />}
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
      {state.phase === "ended" && (
        <div
          className="panel"
          style={{ borderColor: state.winner === "evil" ? "var(--blood-bright, #c44)" : undefined }}
        >
          <h2>
            {state.winner === "good" ? "Good wins" : state.winner === "evil" ? "Evil wins" : "Game over"}
          </h2>
          <p>{state.winReason ?? "Ended by the Storyteller."}</p>
        </div>
      )}
      <div className="panel">
        <h2>Story flow</h2>
        <p className="muted">
          Tabs follow the phase: <strong>Night → Dawn → Votes</strong>. Primary button advances when
          ready. Dawn announces overnight deaths; finishing dawn starts the numbered day.
        </p>
        <p className="muted">
          Loop: First night → Dawn → Day 1 (discussion) → Dusk → Open nominations → Close nominations →
          Night → Dawn → Day 2 → …
        </p>
        {!flowStep(state) && (
          <div className="row">
            <button className="primary" type="button" onClick={() => emit("game:advancePhase")}>
              {advanceLabel(state)}
            </button>
          </div>
        )}
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
          <button type="button" onClick={() => emit("game:goDusk")}>
            Dusk
          </button>
          <button
            type="button"
            disabled={state.phase !== "dusk" || state.nominationsOpen || state.nightPending}
            onClick={() => emit("game:openNominations")}
          >
            Open nominations
          </button>
          <button
            type="button"
            onClick={() => {
              const skipsDay = DAY_PHASES.includes(state.phase) && !state.nightPending;
              if (!skipsDay || confirm(SKIP_TO_NIGHT_CONFIRM)) emit("game:startNight");
            }}
          >
            {state.phase === "day" ? "Skip to night" : "Night"}
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
  const residents = state.players.filter((p) => !p.isTraveller && !p.leftGame).length;
  const travellers = state.players.filter((p) => p.isTraveller && !p.leftGame).length;
  return (
    <div className="stack">
      <div className="panel">
        <h2>
          Players ({residents}
          {travellers ? ` + ${travellers} Traveller${travellers === 1 ? "" : "s"}` : ""})
        </h2>
        <label className="muted">Player count, not counting Travellers (5–{state.allowOver15 ? 20 : 15})</label>
        <input
          type="number"
          min={5}
          max={state.allowOver15 ? 20 : 15}
          value={residents}
          onChange={(e) => emit("game:setPlayerCount", { count: Number(e.target.value) })}
        />
        <label className="row" style={{ marginTop: "0.5rem", gap: "0.5rem" }}>
          <input
            type="checkbox"
            checked={state.allowOver15}
            onChange={(e) =>
              emit("game:setPlayerCount", {
                count: e.target.checked ? residents : Math.min(15, residents),
                allowOver15: e.target.checked,
              })
            }
          />
          <span className="muted">Allow more than 15 (house rule — the official game caps at 15 plus Travellers)</span>
        </label>
        {state.setup ? (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Bag: T{state.setup.townsfolk} / O{state.setup.outsider} / M{state.setup.minion} / D
            {state.setup.demon}
            {state.players.some((p) => p.characterId === "baron" && !p.leftGame) ||
            state.setupWarning?.includes("Baron")
              ? " · Baron in setup (+2O/−2T applied, stays even if the Baron dies)"
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
        <h2>TV character sheet</h2>
        <p className="muted">
          Shows the script&apos;s characters and the official setup counts on the TV (lobby, day and dusk only).
          The Baron&apos;s adjustment is never shown.
        </p>
        <button
          type="button"
          className={state.tvSheet ? "primary" : ""}
          onClick={() => emit("game:setTvSheet", { on: !state.tvSheet })}
        >
          {state.tvSheet ? "Hide character sheet on TV" : "Show character sheet on TV"}
        </button>
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
        players={state.players}
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
  players,
  charName,
  charTeam,
  characters,
  byTeam,
  reminderPool,
  emit,
}: {
  player: Player;
  players: Player[];
  charName?: string;
  charTeam?: Team;
  characters: StorytellerState["characters"];
  byTeam: { team: Team; chars: StorytellerState["characters"] }[];
  reminderPool: string[];
  emit: (e: string, d?: unknown) => void;
}) {
  const seated = players.filter((p) => !p.leftGame);
  const inPlay = new Set(
    players
      .filter((p) => !p.leftGame && p.id !== player.id)
      .map((p) => trueCharacterId(p, characters))
      .filter(Boolean) as string[],
  );
  const thinksName = characters.find((c) => c.id === player.thinksCharacterId)?.name;
  return (
    <div className={`player-card ${player.alive ? "" : "dead"}`}>
      <header>
        <div>
          <strong>
            Seat {player.seat} · {player.name}
          </strong>
          {charName && <span className={`badge ${charTeam}`}>{charName}</span>}
          {player.characterId === "drunk" && (
            <span className="badge townsfolk">thinks: {thinksName ?? "?"}</span>
          )}
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

      {player.characterId === "drunk" && (
        <>
          <label className="muted" style={{ marginTop: "0.5rem", display: "block" }}>
            Thinks they are (a Townsfolk not in play — they wake and get info as this)
          </label>
          <select
            value={player.thinksCharacterId ?? ""}
            onChange={(e) =>
              emit("game:updatePlayer", {
                playerId: player.id,
                patch: { thinksCharacterId: e.target.value || null },
              })
            }
          >
            <option value="">— pick a Townsfolk —</option>
            {characters
              .filter((c) => c.team === "townsfolk")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {inPlay.has(c.id) ? " (in play!)" : ""}
                </option>
              ))}
          </select>
          {player.thinksCharacterId && inPlay.has(player.thinksCharacterId) && (
            <p className="warn">That Townsfolk is in play — pick one that is not.</p>
          )}
        </>
      )}

      {player.isTraveller && (
        <>
          <label className="muted" style={{ marginTop: "0.5rem", display: "block" }}>
            Alignment (secret)
          </label>
          <div className="chip-row">
            {(["good", "evil"] as const).map((a) => (
              <button
                key={a}
                type="button"
                className={`chip ${(player.alignment ?? "good") === a ? "on" : ""}`}
                onClick={() => emit("game:updatePlayer", { playerId: player.id, patch: { alignment: a } })}
              >
                {a === "good" ? "Good" : "Evil"}
              </button>
            ))}
          </div>
        </>
      )}

      <label className="muted" style={{ marginTop: "0.5rem", display: "block" }}>
        Seat
      </label>
      <div className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
        <select
          data-testid="seat-select"
          value={player.seat}
          onChange={(e) => emit("game:moveSeat", { playerId: player.id, seat: Number(e.target.value) })}
        >
          {seated.map((_, i) => (
            <option key={i} value={i + 1}>
              Seat {i + 1}
            </option>
          ))}
        </select>
        <span className="muted">Move seat — Empath / Chef neighbours and vote order follow the seating.</span>
      </div>

      <label className="muted" style={{ marginTop: "0.5rem", display: "block" }}>
        Reminders
      </label>
      <div className="chip-row">
        {Array.from(
          new Set([
            ...reminderPool,
            ...player.reminders,
            // Always offer common auto-placed tokens so they show/edit on any seat
            "Is the Drunk",
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
            Bluffs ({player.bluffs.length}/3 good characters not in play)
          </label>
          <div className="chip-row">
            {characters
              .filter((c) => c.team === "townsfolk" || c.team === "outsider")
              .filter((c) => !inPlay.has(c.id) || player.bluffs.includes(c.id))
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
  /** Imp self-kill with several Minions: the server asks who receives the star-pass. */
  const [starPass, setStarPass] = useState<{ impId: string; candidates: { id: string; name: string }[] } | null>(null);
  /** Imp attacked a healthy Mayor: Storyteller decides whether the kill bounces. */
  const [mayorPrompt, setMayorPrompt] = useState<{ mayorId: string; replacementId: string } | null>(null);

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
    setStarPass(null);
    setMayorPrompt(null);
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
          const truthId = trueCharacterId(p, state.characters);
          setInfoCharacterId(
            pickWrongCharacterId(
              [...state.characters, ...state.travellers],
              truthId,
              show.characterTeams,
              step?.characterId,
            ),
          );
        } else if (p?.characterId) {
          setInfoCharacterId(trueCharacterId(p, state.characters) ?? "");
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

  /** Send the Imp's kill; the server may ask for the star-pass recipient first. */
  function sendKill(targetId: string, reason: string, starPassTo?: string) {
    emit("game:otherDeath", { playerId: targetId, reason, starPassTo }, (res) => {
      const r = res as { needsStarPassChoice?: boolean; candidates?: { id: string; name: string }[] } | undefined;
      if (r?.needsStarPassChoice && r.candidates?.length) {
        setShowing(false);
        setStarPass({ impId: targetId, candidates: r.candidates });
        return;
      }
      setStarPass(null);
      setMayorPrompt(null);
      setTargetConfirmed(true);
      window.setTimeout(() => emit("game:markNightStepDone"), 350);
    });
  }

  function confirmTarget() {
    const targetId = infoPlayers[0];
    if (!targetId || !show.reminder) return;
    const target = state.players.find((p) => p.id === targetId);
    if (!target) return;

    if (show.reminder === "Dead") {
      const impHealthy = !wakeTargets.some((p) => isPoisonedOrDrunkPlayer(p));
      if (impHealthy && mayorBounceAvailable(state.players, target) && !mayorPrompt) {
        setShowing(false);
        setMayorPrompt({ mayorId: target.id, replacementId: "" });
        return;
      }
      // A protected target (Soldier / Safe) still confirms — the server records a failed kill.
      sendKill(targetId, "Demon");
      return;
    }

    // Dead is handled above; exclusive night marks go through one server mutate
    emit("game:applyNightReminder", { playerId: targetId, reminder: show.reminder }, (res) => {
      const r = res as { ok?: boolean } | undefined;
      if (r && r.ok === false) return;
      setTargetConfirmed(true);
      // Choice recorded on the grimoire — advance to the next wake
      window.setTimeout(() => emit("game:markNightStepDone"), 350);
    });
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

  // "Choose a player (not yourself)" — dead players may be chosen (Monk included).
  const notSelfChoosers = ["monk", "butler", "bureaucrat", "thief"];
  const pickablePlayers = state.players.filter((p) => !p.leftGame).filter((p) => {
    if (show.kind === "choose-target" && notSelfChoosers.includes(step?.characterId ?? "")) {
      return p.id !== showForId && !wakeTargets.some((w) => w.id === p.id);
    }
    return true;
  });

  const pickedSelf = !!showForId && infoPlayers.includes(showForId);
  const pickedOwnRole =
    !zeroOutsiders && !!infoCharacterId && infoCharacterId === step?.characterId;

  const selectedPlayerNames = infoPlayers
    .map((id) => state.players.find((p) => p.id === id)?.name)
    .filter(Boolean) as string[];

  const killProtection =
    show.reminder === "Dead"
      ? nightKillProtection(
          state.players,
          state.players.find((p) => p.id === infoPlayers[0]),
        )
      : null;

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
              {show.stWarning ||
                (step?.characterId === "imp"
                  ? "Imp is Poisoned/Drunk — the kill fails: nobody dies (no star-pass on a self-kill). Let them pick and Confirm as normal."
                  : "Poisoned/Drunk — give false information")}
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
                  const truthId = trueCharacterId(picked, state.characters);
                  const truthName =
                    state.characters.find((c) => c.id === truthId)?.name ||
                    state.travellers.find((c) => c.id === truthId)?.name ||
                    truthId;
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

          {show.registration && (
            <div className="registration-panel" data-testid="registration-panel">
              <div className="muted">Storyteller only · Recluse / Spy registration</div>
              <p style={{ margin: "0.25rem 0" }}>{show.registration.note}</p>
              {show.registration.numbers && (
                <div className="chip-row">
                  {show.registration.numbers.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`chip ${infoNumber === n ? "on" : ""}`}
                      onClick={() => setInfoNumber(n)}
                    >
                      Show {n}
                    </button>
                  ))}
                </div>
              )}
              {show.registration.pairs && (
                <div className="chip-row">
                  {show.registration.pairs.map((pair) => (
                    <button
                      key={pair.label}
                      type="button"
                      className="chip"
                      onClick={() => {
                        setZeroOutsiders(false);
                        setInfoPlayers(pair.playerIds);
                        if (pair.characterId) setInfoCharacterId(pair.characterId);
                      }}
                    >
                      {pair.label}:{" "}
                      {pair.playerIds.map((id) => state.players.find((p) => p.id === id)?.name).join(" · ")}
                      {pair.characterId
                        ? ` as ${state.characters.find((c) => c.id === pair.characterId)?.name ?? pair.characterId}`
                        : ""}
                    </button>
                  ))}
                </div>
              )}
              {show.registration.characterIds && (
                <select
                  value=""
                  onChange={(e) => e.target.value && setInfoCharacterId(e.target.value)}
                >
                  <option value="">— register as… —</option>
                  {show.registration.characterIds.map((id) => (
                    <option key={id} value={id}>
                      {state.characters.find((c) => c.id === id)?.name ?? id}
                    </option>
                  ))}
                </select>
              )}
            </div>
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
              {show.kind === "players-and-character" && (pickedSelf || pickedOwnRole) && (
                <p className="warn" style={{ marginTop: "0.5rem" }}>
                  Heads up: this shows {showPlayer?.name ?? "the woken player"}{" "}
                  {[
                    pickedSelf ? "themselves as one of the two players" : "",
                    pickedOwnRole ? `their own role (${infoChar?.name ?? infoCharacterId})` : "",
                  ]
                    .filter(Boolean)
                    .join(" and ")}
                  . Allowed, but it usually gives the game away.
                </p>
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
          {show.kind === "choose-target" && show.reminder === "Dead" && killProtection && (
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              {killProtection} — confirm anyway; nobody dies from this kill.
            </p>
          )}

          {mayorPrompt && (
            <div className="registration-panel" data-testid="mayor-prompt">
              <div className="muted">Storyteller only · Mayor</div>
              <p style={{ margin: "0.25rem 0" }}>
                The Imp attacked the Mayor ({state.players.find((p) => p.id === mayorPrompt.mayorId)?.name}).
                You may let the Mayor die, or have another player die instead (a Soldier / Monk-protected /
                dead choice means nobody dies tonight).
              </p>
              <div className="row">
                <button type="button" className="danger" onClick={() => sendKill(mayorPrompt.mayorId, "Demon")}>
                  Mayor dies
                </button>
                <select
                  value={mayorPrompt.replacementId}
                  onChange={(e) => setMayorPrompt({ ...mayorPrompt, replacementId: e.target.value })}
                >
                  <option value="">— someone else dies —</option>
                  {state.players
                    .filter((p) => !p.leftGame && p.id !== mayorPrompt.mayorId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {!p.alive ? " † (nobody dies)" : ""}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="primary"
                  disabled={!mayorPrompt.replacementId}
                  onClick={() => {
                    const r = state.players.find((p) => p.id === mayorPrompt.replacementId);
                    if (r && !r.alive) {
                      setMayorPrompt(null);
                      setTargetConfirmed(true);
                      window.setTimeout(() => emit("game:markNightStepDone"), 350);
                      return;
                    }
                    sendKill(mayorPrompt.replacementId, "Demon (Mayor bounce)");
                  }}
                >
                  Bounce the kill
                </button>
                <button type="button" onClick={() => setMayorPrompt(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {starPass && (
            <div className="registration-panel" data-testid="star-pass">
              <div className="muted">Storyteller only · Star-pass</div>
              <p style={{ margin: "0.25rem 0" }}>
                The Imp killed themselves. Choose which Minion becomes the Imp — they are woken right after
                and shown YOU ARE the Imp (no kill tonight).
              </p>
              <div className="chip-row">
                {starPass.candidates.map((c) => (
                  <button key={c.id} type="button" className="chip" onClick={() => sendKill(starPass.impId, "Demon", c.id)}>
                    {c.name}
                  </button>
                ))}
                <button type="button" onClick={() => setStarPass(null)}>
                  Cancel
                </button>
              </div>
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

                {show.kind === "minion-info" && (show.fellowPlayerIds?.length ?? 0) > 1 && (
                  <div className="show-block">
                    <div className="show-section-label">{show.fellowLabel || "The Minions"}</div>
                    <div className="show-big">
                      {(show.fellowPlayerIds ?? [])
                        .map((id) => state.players.find((p) => p.id === id)?.name)
                        .filter(Boolean)
                        .join(" · ")}
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
  const [seat, setSeat] = useState<string>("");
  const [alignment, setAlignment] = useState<"good" | "evil">("good");
  const [caller, setCaller] = useState<string>("");
  const [donor, setDonor] = useState<string>("");
  const active = state.players.filter((p) => p.isTraveller && !p.leftGame);
  const seated = state.players.filter((p) => !p.leftGame).sort((a, b) => a.seat - b.seat);
  const exile = state.exile;
  const exileTarget = exile ? state.players.find((p) => p.id === exile.travellerId) : null;
  const canCallExile = state.phase === "day" || state.phase === "dusk";
  const today = Math.max(1, state.dayNumber || 1);
  const calledToday = (id: string) =>
    state.publicLog.some((x) => x.type === "exile" && x.playerId === id && x.dayNumber === today);
  const demon = state.players.find(
    (p) => !p.leftGame && p.alive && state.characters.find((c) => c.id === p.characterId)?.team === "demon",
  );

  return (
    <div className="stack">
      <div className="panel">
        <h2>Add Traveller</h2>
        <p className="muted">
          Travellers are exiled, never executed. Their character is public; their alignment is your secret
          choice. They don&apos;t count toward the Scarlet Woman&apos;s 5.
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
        <label className="muted" style={{ display: "block", marginTop: "0.5rem" }}>
          Sits at
        </label>
        <select value={seat} onChange={(e) => setSeat(e.target.value)}>
          <option value="">— last seat —</option>
          {seated.map((p, i) => (
            <option key={p.id} value={i + 1}>
              Seat {i + 1} (before {p.name})
            </option>
          ))}
        </select>
        <label className="muted" style={{ display: "block", marginTop: "0.5rem" }}>
          Alignment (secret)
        </label>
        <div className="chip-row">
          {(["good", "evil"] as const).map((a) => (
            <button key={a} type="button" className={`chip ${alignment === a ? "on" : ""}`} onClick={() => setAlignment(a)}>
              {a === "good" ? "Good" : "Evil"}
            </button>
          ))}
        </div>
        {alignment === "evil" && (
          <p className="muted">An evil Traveller learns who the Demon is at the next night — no bluffs, no other evil players.</p>
        )}
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <button
            className="primary"
            type="button"
            disabled={!characterId}
            onClick={() => {
              emit("game:addTraveller", { name: name || undefined, characterId, seat: seat || null, alignment });
              setName("");
              setSeat("");
              setAlignment("good");
            }}
          >
            Join table
          </button>
        </div>
      </div>

      {exile && exileTarget && (
        <div className="panel" data-testid="exile-panel">
          <h2>Exile: {exileTarget.name}?</h2>
          <p className="muted">
            Everyone may raise a hand — dead players too, no vote token spent, no Butler rule, no vote weights.
            Needs {exile.threshold} (half of all {seated.length} players, rounded up). An exile is not an execution.
          </p>
          <div className="chip-row">
            {seated.map((p) => {
              const on = exile.supporters.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`chip ${on ? "on" : ""}`}
                  onClick={() => emit("game:toggleExileSupport", { playerId: p.id })}
                >
                  {p.name}
                  {!p.alive ? " †" : ""}
                </button>
              );
            })}
          </div>
          <p style={{ marginTop: "0.5rem" }}>
            <strong>
              {exile.supporters.length} / {exile.threshold}
            </strong>{" "}
            {exile.supporters.length >= exile.threshold ? "— enough to exile" : "— not enough yet"}
          </p>
          <div className="row">
            <button className="primary" type="button" onClick={() => emit("game:resolveExile", {})}>
              Count hands
            </button>
            <button type="button" onClick={() => emit("game:resolveExile", { force: "exile" })}>
              Exile anyway
            </button>
            <button type="button" onClick={() => emit("game:resolveExile", { force: "spare" })}>
              Spare
            </button>
            <button type="button" onClick={() => emit("game:cancelExile")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>At the table</h2>
        {active.length === 0 && <p className="muted">No Travellers in play.</p>}
        {active.map((p) => {
          const t = state.travellers.find((x) => x.id === p.characterId);
          const align = p.alignment ?? "good";
          return (
            <div key={p.id} className={`player-card ${p.alive ? "" : "dead"}`} style={{ marginBottom: "0.5rem" }}>
              <header>
                <div>
                  <strong>
                    Seat {p.seat} · {p.name} · {t?.name ?? "?"}
                  </strong>
                  <span className={`badge ${align === "evil" ? "demon" : "townsfolk"}`}>{align}</span>
                  {!p.alive && <span className="badge">exiled / dead</span>}
                  <p className="muted" style={{ margin: 0 }}>
                    {t?.ability}
                  </p>
                  {align === "evil" && (
                    <p className="muted" style={{ margin: 0 }}>
                      {p.learnedDemon ? "Has seen the Demon" : `Will be shown the Demon${demon ? ` (${demon.name})` : ""} tonight`}
                    </p>
                  )}
                  {p.characterId === "beggar" && (
                    <p className="muted" style={{ margin: 0 }}>
                      Vote tokens: {p.voteTokens} {p.alive ? "(one spent per vote)" : "(dead — uses their ghost vote)"}
                    </p>
                  )}
                </div>
                <div className="stack" style={{ gap: "0.35rem" }}>
                  {p.alive && (
                    <button
                      type="button"
                      disabled={!canCallExile || Boolean(exile) || calledToday(p.id)}
                      title={
                        !canCallExile
                          ? "Exiles happen during the day"
                          : calledToday(p.id)
                            ? "Already called for exile today — each Traveller can only be called once per day"
                            : ""
                      }
                      onClick={() => emit("game:callExile", { travellerId: p.id, calledById: caller || null })}
                    >
                      Call exile
                    </button>
                  )}
                  <button type="button" onClick={() => emit("game:leaveTraveller", { playerId: p.id })}>
                    Leaves the game
                  </button>
                </div>
              </header>
              {p.characterId === "beggar" && p.alive && (
                <div className="row" style={{ marginTop: "0.5rem", gap: "0.5rem" }}>
                  <select value={donor} onChange={(e) => setDonor(e.target.value)}>
                    <option value="">— dead player gives a token —</option>
                    {state.players
                      .filter((d) => !d.leftGame && !d.alive && !d.usedGhostVote && d.id !== p.id)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={!donor}
                    onClick={() => {
                      emit("game:giveVoteToken", { beggarId: p.id, donorId: donor });
                      setDonor("");
                    }}
                  >
                    Give vote token
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {active.some((p) => p.alive) && (
          <div className="row" style={{ marginTop: "0.5rem", gap: "0.5rem" }}>
            <span className="muted">Exile called by:</span>
            <select value={caller} onChange={(e) => setCaller(e.target.value)}>
              <option value="">— anyone —</option>
              {seated.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {!p.alive ? " †" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
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
          <li>Monk Safe / Soldier block night Demon kills (Safe fails only if the Monk is Poisoned/Drunk; the Monk may pick a dead player, never themselves)</li>
          <li>Every raised hand counts; the Butler gets a private warning if their Master&apos;s hand isn&apos;t up. Bureaucrat ×3 / Thief −1 only while that Traveller lives</li>
          <li>Game over: Demon dead → Good wins; ≤2 alive non-travellers with the Demon → Evil wins (announced after the current line)</li>
          <li>Imp star-pass on self-kill: a healthy Scarlet Woman must take it, otherwise you choose the Minion; the new Imp is woken (&quot;You are the Imp&quot;) and doesn&apos;t kill that night</li>
          <li>Poison ends the moment the Poisoner dies or star-passes</li>
          <li>Virgin: Townsfolk nominator executed (Drunk never; Spy asks you); ability spent on first nomination either way, restored if the nomination is cancelled</li>
          <li>Slayer shot (Votes tab): kills the Demon; Recluse on your call; spent even on a miss / when Poisoned</li>
          <li>Saint executed → Evil wins (not if Poisoned/Drunk, not if already dead)</li>
          <li>Mayor: Start night with exactly 3 alive (travellers count) &amp; no execution today (&quot;Lives&quot; still counts as the execution) → Good wins</li>
          <li>Baron adjusts setup bag +2 Outsiders / −2 Townsfolk, fixed at setup</li>
          <li>Minion &amp; Demon info only with 7+ players; Travellers wake first, then Minion info, then Demon info</li>
          <li>Drunk: set Drunk + &quot;Thinks they are&quot; — they wake as that Townsfolk; Undertaker / Ravenkeeper / Librarian / reveal see the Drunk</li>
          <li>Travellers are exiled (Travel tab), never nominated; dead Travellers keep a ghost vote; Beggar votes need tokens from the dead</li>
          <li>
            Night Show/Done places WW Townsfolk+Wrong · Washerwoman, Lib Outsider+Wrong · Librarian, Inv Minion+Wrong · Investigator (Recluse/Spy
            registering get the token); FT Red herring if missing; execution places Died today; deaths mid-night keep your place in the order
          </li>
        </ul>
        <p>
          <strong>ST decides</strong>
        </p>
        <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.1rem" }}>
          <li>Washer / Lib / Inv / Chef / Empath / FT / Ravenkeeper / Spy info when Drunk/poisoned</li>
          <li>Recluse / Spy registration — each info step lists the alternatives you may show (also prompted for Slayer / Virgin)</li>
          <li>Mayor bounce: when the Imp attacks a healthy Mayor you&apos;re asked whether someone else dies instead</li>
          <li>Scapegoat executed instead (execution panel)</li>
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
            .filter((p) => !p.leftGame && (p.alive || selected.has(p.id) || state.diedTonightIds.includes(p.id)))
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
  const [nominatorId, setNominatorId] = useState("");
  const [nomineeId, setNomineeId] = useState("");
  const [override, setOverride] = useState(false);
  const [picking, setPicking] = useState(false);
  const [shooterId, setShooterId] = useState(
    () => state.players.find((p) => p.characterId === "slayer" && !p.leftGame)?.id ?? state.players[0]?.id ?? "",
  );
  const [shotTargetId, setShotTargetId] = useState(state.players[0]?.id ?? "");
  const [recluseAsDemon, setRecluseAsDemon] = useState(false);
  const shotTarget = state.players.find((p) => p.id === shotTargetId);
  const isDay = DAY_PHASES.includes(state.phase);

  function openNomination() {
    const nominator = state.players.find((p) => p.id === nominatorId);
    const nominee = state.players.find((p) => p.id === nomineeId);
    const virginArmed =
      nominee?.characterId === "virgin" &&
      nominee.alive &&
      !nominee.abilityUsed &&
      !nominee.reminders.includes("No ability") &&
      !isPoisonedOrDrunkPlayer(nominee);
    const spyRegistersAsTownsfolk =
      virginArmed && nominator?.characterId === "spy" && nominator.alive
        ? window.confirm(
            `${nominator.name} (Spy) is nominating the Virgin. Should the Spy register as a Townsfolk and be executed?`,
          )
        : false;
    emit("game:startNomination", { nominatorId, nomineeId, spyRegistersAsTownsfolk, override });
    setNominatorId("");
    setNomineeId("");
    setOverride(false);
    setPicking(false);
  }

  const nom = state.nomination;
  const livingCount = state.players.filter((p) => p.alive && !p.leftGame).length;
  const majority = state.nomination?.majority ?? Math.ceil(livingCount / 2);
  const block = state.block ?? null;
  const toBeat = nom ? (nom.toBeat ?? null) : (block?.votes ?? null);
  const need = toBeat != null ? Math.max(majority, toBeat + 1) : majority;
  const master = state.players.find((p) => p.reminders.includes("Master") && !p.leftGame);
  const butler = state.players.find(
    (p) => p.characterId === "butler" && p.alive && !p.leftGame,
  );
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
  const seats = state.players.filter((p) => !p.leftGame).sort((a, b) => a.seat - b.seat);
  const rules = state.nominationRules ?? {
    closedReason: null,
    notOpenReason: null,
    dayLimitReason: null,
    nominator: {},
    nominee: {},
  };
  const today = state.nominationsToday ?? [];
  const holder = block?.nomineeId ? nameOf(block.nomineeId) : null;
  const canNominate = seats.filter((p) => !rules.nominator[p.id]);
  const canBeNominated = seats.filter((p) => !rules.nominee[p.id]);
  const inDay = state.phase === "day";
  const duskAnnounce = state.phase === "dusk" && !state.nominationsOpen && !state.nightPending;
  const nominationsOpen = state.phase === "dusk" && state.nominationsOpen && !state.nightPending;
  const lastResult = [...today].reverse().find((n) => n.outcome !== null);
  const exhaustedReason = !nominationsOpen
    ? null
    : (rules.dayLimitReason ??
      (canNominate.length === 0
        ? "Nobody left can nominate today."
        : canBeNominated.length === 0
          ? "Nobody left can be nominated today."
          : null));
  const showPicker = nominationsOpen ? !exhaustedReason || picking : (inDay || duskAnnounce) && picking;

  const openBlocked =
    rules.closedReason ??
    (!nominatorId
      ? "Pick a nominator."
      : !nomineeId
        ? "Pick a nominee."
        : override
          ? null
          : (rules.notOpenReason ??
            rules.dayLimitReason ??
            (rules.nominator[nominatorId] ? `${nameOf(nominatorId)}: ${rules.nominator[nominatorId]}.` : null) ??
            (rules.nominee[nomineeId] ? `${nameOf(nomineeId)}: ${rules.nominee[nomineeId]}.` : null)));
  const endBlocked = endDayBlocked(state);

  function outcomeLabel(n: (typeof today)[number]): string {
    switch (n.outcome) {
      case null:
        return "Voting…";
      case "majority":
        return "On the block";
      case "tie":
        return "Tied — block cleared";
      case "outvoted":
        return "Majority, but too few to replace the block";
      case "no_majority":
        return "Failed — no majority";
      case "virgin":
        return "Virgin — nominator executed";
    }
  }

  const blockSummary = block
    ? block.nomineeId
      ? `On the block: ${holder} with ${block.votes} vote${block.votes === 1 ? "" : "s"}. ${block.votes + 1}+ replaces them; ${block.votes} ties and clears the block.`
      : `Tied at ${block.votes} — nobody on the block. ${Math.max(majority, block.votes + 1)}+ votes puts someone on it.`
    : `Nobody on the block. ${majority} votes (half of ${livingCount} living, rounded up) puts someone on it.`;

  if (!isDay) {
    return (
      <div className="stack">
        <div className="panel">
          <h2>Nominations</h2>
          <p className="muted">Nominations open at dusk, after the day's discussion. Finish the night and dawn first.</p>
        </div>
      </div>
    );
  }

  function seatChip(
    p: (typeof seats)[number],
    selected: boolean,
    reason: string | null | undefined,
    onPick: () => void,
  ) {
    const blocked = Boolean(reason) && !override;
    return (
      <button
        key={p.id}
        type="button"
        disabled={blocked}
        title={reason ?? undefined}
        className={`chip ${selected ? "on" : ""}`}
        onClick={onPick}
      >
        {p.seat}. {p.name}
        {!p.alive ? " †" : ""}
        {reason ? <span className="muted"> · {reason}</span> : null}
      </button>
    );
  }

  return (
    <div className="stack">
      {inDay || duskAnnounce ? (
        <div className="panel">
          <h2>{inDay ? `Day ${state.dayNumber} — open discussion` : `Dusk — day ${state.dayNumber} ends`}</h2>
          <p>
            {inDay
              ? "Nominations are closed during the day. When the town is ready, go to dusk: the dusk narration plays and the TV shows “Dusk falls”."
              : "The dusk announcement is on the TV. Nominations are still closed — open them when the room is ready."}
          </p>
          {block && (
            <p style={{ fontFamily: "Cinzel, serif", fontSize: "1.1rem", margin: "0.25rem 0" }}>{blockSummary}</p>
          )}
          <div className="row" style={{ marginTop: "0.75rem" }}>
            {inDay ? (
              <button className="primary" type="button" onClick={() => emit("game:goDusk")}>
                Go to dusk
              </button>
            ) : (
              <button className="primary" type="button" onClick={() => emit("game:openNominations")}>
                Open nominations
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (confirm(SKIP_TO_NIGHT_CONFIRM)) emit("game:startNight");
              }}
            >
              Skip to night
            </button>
            {!picking && (
              <button type="button" onClick={() => setPicking(true)}>
                Nominate now (Storyteller override)…
              </button>
            )}
          </div>
          {rules.notOpenReason && <p className="muted">{rules.notOpenReason}</p>}
        </div>
      ) : state.phase === "dusk" && state.nightPending ? (
        <div className="panel">
          <h2>Dusk — day {state.dayNumber} is over</h2>
          <p>
            {state.executedTodayId
              ? `${nameOf(state.executedTodayId)} was executed today.`
              : state.executionPendingId === null && holder
                ? `${holder} survived the gallows.`
                : "No execution today."}
          </p>
          <p className="muted">The night starts on its own once the execution line has finished.</p>
          <div className="row">
            <button className="primary" type="button" onClick={() => emit("game:endDay")}>
              Start night now
            </button>
          </div>
        </div>
      ) : (
        <div className="panel">
          <h2>
            {nominationsOpen ? "Nominations open" : "Nomination in progress"} · Day {state.dayNumber}
          </h2>
          <p style={{ fontFamily: "Cinzel, serif", fontSize: "1.1rem", margin: "0.25rem 0" }}>{blockSummary}</p>
          {state.executedTodayId && (
            <p className="muted">Executed today: {nameOf(state.executedTodayId)}.</p>
          )}
          {exhaustedReason && (
            <div
              className="panel"
              style={{ borderColor: "var(--blood-bright, #c44)", margin: "0.5rem 0", padding: "0.75rem" }}
            >
              <p style={{ fontFamily: "Cinzel, serif", fontSize: "1.2rem", margin: 0 }}>
                No more nominations possible — {exhaustedReason}
              </p>
              <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                Close nominations to end the day ({holder && !state.executedTodayId ? `${holder} is executed` : "no execution"}
                ). The Storyteller override can still open one more.
              </p>
            </div>
          )}
          {nominationsOpen &&
            !exhaustedReason &&
            lastResult &&
            lastResult.outcome !== "majority" &&
            lastResult.outcome !== "virgin" && (
            <p className="warn">
              Nomination of {nameOf(lastResult.nomineeId)} {lastResult.outcome === "tie" ? "tied" : "failed"} (
              {lastResult.votes}/{lastResult.majority}). Nominations are still open.
            </p>
          )}
          {today.length > 0 ? (
            <ol style={{ margin: "0.5rem 0", paddingLeft: "1.3rem" }}>
              {today.map((n, i) => (
                <li key={`${n.at}-${i}`} style={{ marginBottom: "0.25rem" }}>
                  <strong>{nameOf(n.nominatorId)}</strong> → <strong>{nameOf(n.nomineeId)}</strong>
                  {n.votes !== null ? ` · ${n.votes}/${n.majority} votes` : ""} · {outcomeLabel(n)}
                  {n.override ? " · (override)" : ""}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No nominations yet today.</p>
          )}
          <p className="muted">
            Can still nominate: {canNominate.length ? canNominate.map((p) => p.name).join(", ") : "nobody"}
            <br />
            Can still be nominated: {canBeNominated.length ? canBeNominated.map((p) => p.name).join(", ") : "nobody"}
          </p>
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button
              className="primary"
              type="button"
              disabled={Boolean(endBlocked)}
              onClick={() => emit("game:endDay")}
            >
              {endDayLabel(state)}
            </button>
            {exhaustedReason && !picking && (
              <button type="button" onClick={() => setPicking(true)}>
                Nominate anyway (Storyteller override)…
              </button>
            )}
          </div>
          {endBlocked && <p className="muted">{endBlocked}</p>}
        </div>
      )}

      {showPicker && (
        <div className="panel">
          <h2>New nomination</h2>
          <p className="muted">
            Alive players nominate once per day; each player can be nominated once per day (dead players
            can be nominated). Travellers follow the same rules — exile is separate. Virgin auto-executes a
            Townsfolk nominator (not the Drunk; you decide for the Spy).
          </p>
          {rules.notOpenReason && !override && (
            <p className="warn">{rules.notOpenReason} Tick Storyteller override to nominate anyway.</p>
          )}
          {rules.dayLimitReason && !override && <p className="warn">{rules.dayLimitReason}</p>}
          <label className="muted">1. Nominator</label>
          <div className="chip-row">
            {seats.map((p) =>
              seatChip(p, nominatorId === p.id, rules.nominator[p.id], () => setNominatorId(p.id)),
            )}
          </div>
          <label className="muted" style={{ display: "block", marginTop: "0.75rem" }}>
            2. Nominee
          </label>
          <div className="chip-row">
            {seats.map((p) => seatChip(p, nomineeId === p.id, rules.nominee[p.id], () => setNomineeId(p.id)))}
          </div>
          <label style={{ display: "block", marginTop: "0.75rem" }}>
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />{" "}
            <strong>Storyteller override</strong> — ignore the wait for nominations to open and the once-per-day and
            one-execution limits for this nomination (logged for you, not shown on the TV)
          </label>
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button className="primary" type="button" disabled={Boolean(openBlocked)} onClick={openNomination}>
              {nominatorId && nomineeId
                ? `Open nomination: ${nameOf(nominatorId)} → ${nameOf(nomineeId)}`
                : "Open nomination"}
            </button>
            {(inDay || duskAnnounce || exhaustedReason) && (
              <button type="button" onClick={() => setPicking(false)}>
                Back to hub
              </button>
            )}
          </div>
          {openBlocked && <p className="muted">Can't open yet: {openBlocked}</p>}
        </div>
      )}

      <VotePanels state={state} emit={emit} need={need} holder={holder} butler={butler} master={master} />

      {isDay && (
        <div className="panel">
          <h2>Slayer shot</h2>
          <p className="muted">
            Anyone may claim to shoot — only the real, healthy, unspent Slayer can kill the Demon.
            The real Slayer's ability is spent even on a miss.
          </p>
          <label className="muted">Shooter</label>
          <select value={shooterId} onChange={(e) => setShooterId(e.target.value)}>
            {state.players
              .filter((p) => !p.leftGame)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {!p.alive ? " †" : ""}
                </option>
              ))}
          </select>
          <label className="muted" style={{ display: "block", marginTop: "0.5rem" }}>
            Target
          </label>
          <select value={shotTargetId} onChange={(e) => setShotTargetId(e.target.value)}>
            {state.players
              .filter((p) => !p.leftGame)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {!p.alive ? " †" : ""}
                </option>
              ))}
          </select>
          {shotTarget?.characterId === "recluse" && (
            <label style={{ display: "block", marginTop: "0.5rem" }}>
              <input
                type="checkbox"
                checked={recluseAsDemon}
                onChange={(e) => setRecluseAsDemon(e.target.checked)}
              />{" "}
              Recluse registers as the Demon (they die; game continues)
            </label>
          )}
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button
              className="danger"
              type="button"
              onClick={() =>
                emit("game:slayerShot", {
                  shooterId,
                  targetId: shotTargetId,
                  recluseRegistersAsDemon: shotTarget?.characterId === "recluse" && recluseAsDemon,
                })
              }
            >
              Take the shot
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

function VotePanels({
  state,
  emit,
  need,
  holder,
  butler,
  master,
}: {
  state: StorytellerState;
  emit: (e: string, d?: unknown) => void;
  need: number;
  holder: string | null;
  butler: Player | undefined;
  master: Player | undefined;
}) {
  const nom = state.nomination;
  return (
    <>
      {nom && (
        <div className="panel">
          <h2>Vote</h2>
          <p>
            {state.players.find((p) => p.id === nom.nominatorId)?.name} →{" "}
            {state.players.find((p) => p.id === nom.nomineeId)?.name}
          </p>
          <p style={{ fontFamily: "Cinzel, serif", fontSize: "1.8rem", margin: "0.25rem 0" }}>
            {nom.votesForCount} / {need}
          </p>
          <p className="muted">
            {nom.toBeat != null
              ? holder
                ? `${need}+ puts them on the block instead of ${holder} (${nom.toBeat}); exactly ${nom.toBeat} ties and clears the block.`
                : `Block tied at ${nom.toBeat} — ${need}+ puts them on the block.`
              : `${need}+ (half the living, rounded up) puts them on the block.`}
          </p>
          <p className="muted">
            Hands: {nom.votesFor.length}
            {butler && master
              ? ` · Butler (${butler.name}) may vote only while Master (${master.name}) votes`
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
          {state.butlerWarning && <p className="warn">{state.butlerWarning}</p>}
          <div className="chip-row">
            {state.players.filter((p) => !p.leftGame).sort((a, b) => a.seat - b.seat).map((p) => {
              const on = nom.votesFor.includes(p.id);
              // Raising a ghost hand requires an unused ghost vote (Travellers too); a living
              // Beggar needs a vote token. Lowering is always allowed while on.
              const beggarBlocked = p.alive && p.characterId === "beggar" && p.voteTokens < 1;
              const canRaise = (p.alive && !beggarBlocked) || (!p.alive && !p.usedGhostVote);
              const can = on || canRaise;
              const mods = [
                p.reminders.includes("3 votes") ? "×3" : "",
                p.reminders.includes("Negative vote") ? "−" : "",
                butler && p.id === butler.id ? "Butler" : "",
                master && p.id === master.id ? "Master" : "",
                p.characterId === "beggar" && p.alive ? `tokens ${p.voteTokens}` : "",
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
            <button className="primary" type="button" onClick={() => emit("game:resolveVote", {})}>
              Resolve vote
            </button>
            <button type="button" onClick={() => emit("game:cancelNomination")}>
              Cancel nomination
            </button>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            <strong>Storyteller override</strong> — set the verdict by hand:
          </p>
          <div className="row">
            <button type="button" onClick={() => emit("game:resolveVote", { outcome: "majority" })}>
              Force onto block
            </button>
            <button type="button" onClick={() => emit("game:resolveVote", { outcome: "tie" })}>
              Force tie
            </button>
            <button type="button" onClick={() => emit("game:resolveVote", { outcome: "no_majority" })}>
              Force fail
            </button>
          </div>
        </div>
      )}

      {state.phase === "execution" && state.executionPendingId && (
        <div className="panel">
          <h2>{state.nightPending ? "End of day — execution" : "Execution"}</h2>
          <p className="muted">
            About to die: {state.players.find((p) => p.id === state.executionPendingId)?.name}
            {state.nightPending
              ? " — on the block at the end of the day. After Confirm death / Lives the night starts once the line has played."
              : ""}
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
          {!state.players.find((p) => p.id === state.executionPendingId)?.alive && (
            <p className="muted">Already dead — the execution counts, but nobody dies (no Saint / Demon effects).</p>
          )}
          {state.players
            .filter((p) => p.characterId === "scapegoat" && p.alive && !p.leftGame && p.id !== state.executionPendingId)
            .map((sg) => (
              <div key={sg.id} className="row" style={{ marginTop: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => emit("game:confirmExecution", { died: true, substituteId: sg.id })}
                >
                  Scapegoat ({sg.name}) is executed instead
                </button>
                <span className="muted">Only if they share the nominee&apos;s alignment — your call.</span>
              </div>
            ))}
        </div>
      )}
    </>
  );
}

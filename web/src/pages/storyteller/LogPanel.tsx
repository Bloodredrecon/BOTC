import { useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import type { GameLogEntry } from "../../types";

type Filter = "all" | "problems" | "actions" | "game";

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["problems", "Refused / errors"],
  ["actions", "My actions"],
  ["game", "Game events"],
];

const MAX_KEPT = 1000;

function matches(e: GameLogEntry, f: Filter): boolean {
  switch (f) {
    case "problems":
      return e.outcome === "rejected" || e.outcome === "error" || e.outcome === "no-change";
    case "actions":
      return e.kind === "action";
    case "game":
      return (e.events?.length ?? 0) > 0 || (e.phaseAfter !== undefined && e.phaseAfter !== e.phase);
    default:
      return true;
  }
}

/** Storyteller-only game log: what was done, what the engine refused and why. */
export function LogPanel({ socketRef }: { socketRef: React.MutableRefObject<Socket | null> }) {
  const [entries, setEntries] = useState<GameLogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onEntry = (e: GameLogEntry) => setEntries((prev) => [...prev, e].slice(-MAX_KEPT));
    const load = () =>
      socket.emit("log:recent", { limit: 500 }, (r: { ok: boolean; entries?: GameLogEntry[] }) => {
        if (r?.ok && r.entries) setEntries(r.entries);
        setLoaded(true);
      });
    socket.on("log:entry", onEntry);
    socket.on("connect", load);
    load();
    return () => {
      socket.off("log:entry", onEntry);
      socket.off("connect", load);
    };
  }, [socketRef]);

  const shown = useMemo(() => entries.filter((e) => matches(e, filter)).reverse(), [entries, filter]);
  const problems = useMemo(() => entries.filter((e) => matches(e, "problems")).length, [entries]);

  return (
    <div className="stack">
      <div className="panel">
        <h2>Game log</h2>
        <p className="muted">
          Every Storyteller action and what the game did with it, newest first. Only you see this; it is also saved
          on the server PC in <code>data/logs/game-*.jsonl</code> (<b>BOTC.bat log</b>).
        </p>
        <div className="chip-row">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip ${filter === id ? "on" : ""}`}
              onClick={() => setFilter(id)}
            >
              {label}
              {id === "problems" && problems > 0 ? ` (${problems})` : ""}
            </button>
          ))}
        </div>
      </div>
      <div className="panel game-log">
        {!loaded && <p className="muted">Loading…</p>}
        {loaded && shown.length === 0 && <p className="muted">Nothing here yet.</p>}
        <ol>
          {shown.map((e, i) => (
            <li key={`${e.t}-${i}`} className={`game-log-row outcome-${e.outcome} kind-${e.kind}`}>
              <span className="game-log-badge">{badge(e)}</span>
              <span className="game-log-text">{e.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function badge(e: GameLogEntry): string {
  if (e.outcome === "rejected") return "refused";
  if (e.outcome === "error") return "error";
  if (e.outcome === "no-change") return "no effect";
  if (e.kind === "system") return "auto";
  if (e.kind === "auth" || e.kind === "connection") return e.kind === "auth" ? "sign-in" : "device";
  return "done";
}

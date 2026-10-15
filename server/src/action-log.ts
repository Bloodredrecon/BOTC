import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { GameSession, PublicEvent } from "./types.js";

/**
 * Storyteller-only record of every game action and its outcome, one JSON object per line in
 * data/logs/game-YYYY-MM-DD[-N].jsonl. Never sent to the TV. Must never contain the PIN or control token.
 */

export type LogOutcome = "ok" | "rejected" | "error" | "no-change" | "info";
export type LogKind = "action" | "system" | "auth" | "connection";

export type LogEntry = {
  t: number;
  kind: LogKind;
  action?: string;
  args?: Record<string, unknown>;
  outcome: LogOutcome;
  reason?: string;
  phase: string;
  day: number;
  phaseAfter?: string;
  dayAfter?: number;
  /** New Storyteller notices raised by this action (private). */
  notices?: string[];
  /** New public chronicle events, described with names (death causes included: Storyteller-only). */
  events?: string[];
  client?: string;
  /** Human-readable one-liner (what the launcher and the Storyteller panel show). */
  text: string;
};

export type ActionLogOptions = {
  maxBytes?: number;
  maxFiles?: number;
  memory?: number;
};

const FILE_RE = /^game-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.jsonl$/;
const ARGS_MAX_CHARS = 600;

function localDate(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function listLogFiles(dir: string): { name: string; date: string; part: number }[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const m = FILE_RE.exec(name);
      return m ? { name, date: m[1]!, part: Number(m[2] ?? 1) } : null;
    })
    .filter((x): x is { name: string; date: string; part: number } => x !== null)
    .sort((a, b) => (a.date === b.date ? a.part - b.part : a.date < b.date ? -1 : 1));
}

export class ActionLog {
  private readonly ring: LogEntry[] = [];
  private readonly listeners = new Set<(e: LogEntry) => void>();
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly memory: number;
  private currentFile: string | null = null;
  private writeFailed = false;

  constructor(
    readonly dir: string,
    opts: ActionLogOptions = {},
  ) {
    this.maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
    this.maxFiles = opts.maxFiles ?? 30;
    this.memory = opts.memory ?? 1000;
    this.loadRecent();
  }

  private loadRecent() {
    const files = listLogFiles(this.dir);
    const lines: string[] = [];
    for (let i = files.length - 1; i >= 0 && lines.length < this.memory; i--) {
      try {
        const chunk = readFileSync(join(this.dir, files[i]!.name), "utf-8").split("\n").filter(Boolean);
        lines.unshift(...chunk);
      } catch {
        /* unreadable file: skip */
      }
    }
    for (const line of lines.slice(-this.memory)) {
      try {
        this.ring.push(JSON.parse(line) as LogEntry);
      } catch {
        /* torn line */
      }
    }
  }

  private fileFor(t: number, bytes: number): string {
    const date = localDate(t);
    if (this.currentFile) {
      const m = FILE_RE.exec(this.currentFile);
      if (m && m[1] === date) {
        const path = join(this.dir, this.currentFile);
        const size = existsSync(path) ? statSync(path).size : 0;
        if (size + bytes <= this.maxBytes) return this.currentFile;
        this.currentFile = `game-${date}-${Number(m[2] ?? 1) + 1}.jsonl`;
        this.prune();
        return this.currentFile;
      }
    }
    const today = listLogFiles(this.dir).filter((f) => f.date === date);
    const last = today[today.length - 1];
    let name = last ? last.name : `game-${date}.jsonl`;
    const path = join(this.dir, name);
    if (existsSync(path) && statSync(path).size + bytes > this.maxBytes) {
      name = `game-${date}-${(last?.part ?? 1) + 1}.jsonl`;
    }
    this.currentFile = name;
    this.prune();
    return name;
  }

  private prune() {
    const files = listLogFiles(this.dir).filter((f) => f.name !== this.currentFile);
    const excess = files.length + 1 - this.maxFiles;
    for (const f of files.slice(0, Math.max(0, excess))) {
      try {
        unlinkSync(join(this.dir, f.name));
      } catch {
        /* in use or gone */
      }
    }
  }

  record(entry: Omit<LogEntry, "text"> & { text?: string }): LogEntry {
    const full: LogEntry = { ...entry, text: entry.text ?? formatEntryText(entry) };
    this.ring.push(full);
    if (this.ring.length > this.memory) this.ring.splice(0, this.ring.length - this.memory);
    const line = `${JSON.stringify(full)}\n`;
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(join(this.dir, this.fileFor(full.t, Buffer.byteLength(line))), line, "utf-8");
      this.writeFailed = false;
    } catch (err) {
      if (!this.writeFailed) console.error(`Game log write failed (${String(err)}); continuing without it.`);
      this.writeFailed = true;
    }
    for (const l of this.listeners) l(full);
    return full;
  }

  recent(n = 200): LogEntry[] {
    return this.ring.slice(-Math.max(0, n));
  }

  onEntry(fn: (e: LogEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

// ---------------------------------------------------------------- describing

export type SessionSnapshot = {
  phase: string;
  day: number;
  noticeIds: Set<string>;
  eventKeys: Set<string>;
};

function eventKey(e: PublicEvent): string {
  return `${e.type}:${e.at}:${"playerId" in e ? e.playerId : "nomineeId" in e ? e.nomineeId : ""}`;
}

export function snapshotSession(s: GameSession): SessionSnapshot {
  return {
    phase: s.phase,
    day: s.dayNumber,
    noticeIds: new Set((s.stNotices ?? []).map((n) => n.id)),
    eventKeys: new Set((s.publicLog ?? []).map(eventKey)),
  };
}

export function diffSession(before: SessionSnapshot, s: GameSession): { notices: string[]; events: PublicEvent[] } {
  return {
    notices: (s.stNotices ?? []).filter((n) => !before.noticeIds.has(n.id)).map((n) => n.message),
    events: (s.publicLog ?? []).filter((e) => !before.eventKeys.has(eventKey(e))),
  };
}

export function playerLabel(s: GameSession, id: string): string {
  const p = s.players.find((x) => x.id === id);
  return p ? `${p.name} (seat ${p.seat})` : id;
}

const ID_KEYS = /^(playerId|nominatorId|nomineeId|shooterId|targetId|travellerId|calledById|beggarId|donorId|substituteId|starPassTo|redHerringPlayerId)$/;
const ID_LIST_KEYS = /^(playerIds)$/;

/** Setup-wizard deal as "Ada (seat 1)=drunk (thinks chef), ..." plus red herring and bluffs. */
function describeDeal(s: GameSession, raw: unknown): Record<string, unknown> {
  const d = (raw ?? {}) as { seats?: unknown; redHerringId?: unknown; bluffs?: unknown };
  const seats = Array.isArray(d.seats) ? (d.seats as Record<string, unknown>[]) : [];
  return {
    seats: seats
      .map((x) => `${playerLabel(s, String(x?.playerId ?? ""))}=${String(x?.characterId ?? "")}${x?.thinksCharacterId ? ` (thinks ${String(x.thinksCharacterId)})` : ""}`)
      .join(", "),
    ...(d.redHerringId ? { redHerring: playerLabel(s, String(d.redHerringId)) } : {}),
    bluffs: Array.isArray(d.bluffs) ? d.bluffs.map(String).join(", ") : "",
  };
}

/** Copies action args with player ids resolved to "Name (seat N)"; bounded in size. */
export function describeArgs(s: GameSession, data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (/pin|token|secret|password/i.test(k)) continue;
    if (ID_KEYS.test(k) && typeof v === "string") out[k] = playerLabel(s, v);
    else if (ID_LIST_KEYS.test(k) && Array.isArray(v)) out[k] = v.map((id) => playerLabel(s, String(id)));
    else if (k === "deal") Object.assign(out, describeDeal(s, v));
    else out[k] = v;
  }
  if (Object.keys(out).length === 0) return undefined;
  const json = JSON.stringify(out);
  return json.length > ARGS_MAX_CHARS ? { truncated: `${json.slice(0, ARGS_MAX_CHARS)}…` } : out;
}

export function describeEvent(s: GameSession, e: PublicEvent): string {
  const name = (id: string) => playerLabel(s, id);
  switch (e.type) {
    case "night_death":
      return e.playerIds.length ? `Night deaths: ${e.playerIds.map(name).join(", ")}` : "No one died in the night";
    case "nomination":
      return `Nomination: ${name(e.nominatorId)} nominates ${name(e.nomineeId)}`;
    case "vote_result":
      return `Vote on ${name(e.nomineeId)}: ${e.votesFor} (majority ${e.majority}) - ${e.outcome}`;
    case "dusk":
      return `Dusk, day ${e.dayNumber}`;
    case "nominations_open":
      return `Nominations open, day ${e.dayNumber}`;
    case "no_execution":
      return `No execution, day ${e.dayNumber}`;
    case "execution":
      return `Execution: ${name(e.playerId)} ${e.alreadyDead ? "(already dead)" : e.died ? "died" : "survived"}${e.virgin ? " (Virgin)" : ""}`;
    case "slayer_shot":
      return `Slayer shot: ${name(e.shooterId)} shoots ${name(e.targetId)} - ${e.hit ? "dies" : "nothing happens"}`;
    case "exile":
      return `Exile of ${e.playerName ?? name(e.playerId)}: ${e.supporters}/${e.threshold} - ${e.exiled ? "exiled" : "spared"}`;
    case "other_death":
      return `Death: ${name(e.playerId)}${e.reason ? ` (${e.reason})` : ""}`;
    case "traveller_join":
      return `Traveller joined: ${e.playerName ?? name(e.playerId)} as ${e.characterName ?? e.characterId}`;
    case "traveller_leave":
      return `Traveller left: ${e.playerName ?? name(e.playerId)}`;
    default:
      return (e as { type: string }).type;
  }
}

function fmtTime(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  return Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
}

export function formatEntryText(e: Omit<LogEntry, "text">): string {
  const where = `[day ${e.day} ${e.phase}]`;
  const what = e.action ? e.action.replace(/^game:/, "") : e.kind;
  const args = fmtArgs(e.args);
  const result =
    e.outcome === "ok" || e.outcome === "info"
      ? ""
      : ` -> ${e.outcome.toUpperCase()}${e.reason ? `: ${e.reason}` : ""}`;
  const moved =
    e.phaseAfter && (e.phaseAfter !== e.phase || e.dayAfter !== e.day) ? ` => day ${e.dayAfter} ${e.phaseAfter}` : "";
  const notices = (e.notices ?? []).filter((n) => !(e.reason && n.includes(e.reason)));
  const extra = [...(e.events ?? []), ...notices.map((n) => `notice: ${n}`)];
  return `${fmtTime(e.t)} ${where} ${what}${args ? ` ${args}` : ""}${e.reason && (e.outcome === "info" || e.outcome === "ok") ? ` (${e.reason})` : ""}${result}${moved}${extra.length ? ` | ${extra.join(" | ")}` : ""}`;
}

/**
 * Outcome of an engine call: `{ ok: false }` results are refusals; no broadcast means nothing changed
 * (most engine methods return early without a message when an action doesn't apply).
 */
export function outcomeOf(result: unknown, changed: boolean): { outcome: LogOutcome; reason?: string } {
  if (result && typeof result === "object" && "ok" in result) {
    const r = result as { ok: unknown; message?: unknown; error?: unknown };
    const msg = typeof r.message === "string" ? r.message : typeof r.error === "string" ? r.error : undefined;
    if (r.ok === false) return { outcome: "rejected", reason: msg ?? "refused by the engine" };
    return { outcome: changed ? "ok" : "no-change", reason: msg };
  }
  return changed ? { outcome: "ok" } : { outcome: "no-change", reason: "the action did not apply in this state" };
}

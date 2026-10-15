import type { GameSession } from "./types.js";

/** Actions that never go on the undo stack (no game state, automatic, or handled specially). */
export const NOT_UNDOABLE = new Set([
  "game:refresh",
  "game:playSound",
  "game:setAmbiance",
  "game:scene",
  "game:timerEnded",
  "game:undo",
  "game:previewDeal",
  "game:reset",
  "game:dismissStNotice",
  "game:clearStNotices",
]);

/** Player-phone actions: devices and what phones were shown are never rolled back. */
export function isPhoneAction(action: string): boolean {
  return /^game:phone[A-Z]/.test(action) || action === "game:setPhones";
}

/**
 * Session fields an undo keeps as they are now (connection flags, the sound mix, player phones:
 * claims, what a phone was shown and messages can't be taken back).
 */
const KEEP_ON_UNDO = ["ambiance", "tvConnected", "storytellerConnected", "gameId", "phones"] as const;

export type UndoEntry = {
  action: string;
  /** Readable description, e.g. "startNomination nominatorId=Ada (seat 1) ...". */
  label: string;
  at: number;
  phase: string;
  day: number;
  before: GameSession;
  /** Typing bursts (names, notes, player count) share a key and become one undo step. */
  mergeKey: string | null;
};

export type UndoSummary = { count: number; last: { label: string; at: number } | null };

/** "game:startNomination" + args -> "Start nomination: nominatorId=Ada (seat 1), nomineeId=Bo (seat 2)". */
export function undoLabel(action: string, args: Record<string, unknown> | undefined): string {
  const name = action.replace(/^game:/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  if (action === "game:applyDeal") return "Deal characters";
  if (!args) return title;
  // Player ids are already "Name (seat N)", so the key adds nothing.
  const parts = Object.entries(args).map(([k, v]) => {
    const text = typeof v === "string" ? v : JSON.stringify(v);
    return /Ids?$|^starPassTo$/.test(k) ? text : `${k}=${text}`;
  });
  const text = `${title}: ${parts.join(", ")}`;
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

/** Compare sessions for undo purposes, ignoring the fields an undo keeps. */
export function comparable(s: GameSession): string {
  const copy: Record<string, unknown> = { ...s };
  for (const k of KEEP_ON_UNDO) delete copy[k];
  return JSON.stringify(copy);
}

/** Merge key for actions that fire on every keystroke. */
export function mergeKeyFor(action: string, data: unknown): string | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (action === "game:setPlayerCount") return action;
  if (action === "game:updatePlayer") {
    const keys = Object.keys((d.patch as Record<string, unknown> | undefined) ?? {}).sort();
    if (keys.length && keys.every((k) => k === "name" || k === "notes")) return `${action}:${String(d.playerId)}:${keys.join(",")}`;
  }
  return null;
}

/** Restore `before`, keeping the current values of the fields an undo never rolls back. */
export function restoredSession(before: GameSession, current: GameSession): GameSession {
  const next = structuredClone(before) as GameSession;
  for (const k of KEEP_ON_UNDO) (next as Record<string, unknown>)[k] = structuredClone(current[k]);
  // A timer that ran out since must not end again (it would replay the timer-end sound).
  if (next.timer && next.timer.endsAt <= Date.now()) next.timer = null;
  return next;
}

export class UndoStack {
  private entries: UndoEntry[] = [];

  constructor(
    private limit = 30,
    private mergeWindowMs = 4000,
  ) {}

  /** Add a step. A step with the same merge key as the last one, within the window, extends it instead. */
  push(entry: UndoEntry) {
    const top = this.entries.at(-1);
    if (entry.mergeKey && top?.mergeKey === entry.mergeKey && entry.at - top.at <= this.mergeWindowMs) {
      top.at = entry.at;
      top.label = entry.label;
      return;
    }
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }

  pop(): UndoEntry | undefined {
    return this.entries.pop();
  }

  clear() {
    this.entries = [];
  }

  get size() {
    return this.entries.length;
  }

  summary(): UndoSummary {
    const top = this.entries.at(-1);
    return { count: this.entries.length, last: top ? { label: top.label, at: top.at } : null };
  }
}

import type { PhonePublic, PublicEvent } from "../../types";

/** Notes live only on this phone (localStorage, per game and seat); nothing here is ever sent to the server. */
export type Align = "" | "good" | "evil";
export type SeatNote = { claim: string; align: Align; text: string };
export type Fact = { key: string; playerId: string; text: string; at: number };
export type NotesDoc = {
  v: 1;
  gameId: string;
  seat: number;
  seats: Record<string, SeatNote>;
  pad: string;
  /** Public facts collected so far; kept here because the public log only carries the latest events. */
  facts: Fact[];
  updatedAt: number;
};

export const EMPTY_NOTE: SeatNote = { claim: "", align: "", text: "" };

export function notesKey(gameId: string, seat: number): string {
  return `botc.notes.${gameId}.${seat}`;
}

function blank(gameId: string, seat: number): NotesDoc {
  return { v: 1, gameId, seat, seats: {}, pad: "", facts: [], updatedAt: 0 };
}

function clean(raw: unknown, gameId: string, seat: number): NotesDoc {
  const d = (raw ?? {}) as Partial<NotesDoc>;
  const seats: Record<string, SeatNote> = {};
  for (const [id, n] of Object.entries(d.seats ?? {})) {
    if (!n || typeof n !== "object") continue;
    seats[id] = {
      claim: typeof n.claim === "string" ? n.claim.slice(0, 40) : "",
      align: n.align === "good" || n.align === "evil" ? n.align : "",
      text: typeof n.text === "string" ? n.text.slice(0, 2000) : "",
    };
  }
  const facts = Array.isArray(d.facts)
    ? d.facts.filter((f): f is Fact => !!f && typeof f.key === "string" && typeof f.playerId === "string" && typeof f.text === "string")
    : [];
  return {
    v: 1,
    gameId,
    seat,
    seats,
    pad: typeof d.pad === "string" ? d.pad.slice(0, 20000) : "",
    facts: facts.slice(-500),
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
  };
}

export function loadNotes(gameId: string, seat: number): NotesDoc {
  try {
    const raw = localStorage.getItem(notesKey(gameId, seat));
    return raw ? clean(JSON.parse(raw), gameId, seat) : blank(gameId, seat);
  } catch {
    return blank(gameId, seat);
  }
}

export function saveNotes(doc: NotesDoc) {
  try {
    localStorage.setItem(notesKey(doc.gameId, doc.seat), JSON.stringify({ ...doc, updatedAt: Date.now() }));
  } catch {
    // Storage full or blocked (private mode): notes still work until the page closes.
  }
}

export function exportNotes(doc: NotesDoc): string {
  return JSON.stringify({ kind: "botc-notes", ...doc }, null, 1);
}

/** Parse an exported file. `sameGame` is false when it came from another game (the caller asks first). */
export function parseNotesFile(text: string, gameId: string, seat: number): { doc: NotesDoc; sameGame: boolean } | null {
  try {
    const raw = JSON.parse(text) as Partial<NotesDoc> & { kind?: string };
    if (raw.kind !== "botc-notes") return null;
    return { doc: clean(raw, gameId, seat), sameGame: raw.gameId === gameId };
  } catch {
    return null;
  }
}

/** Day of the event, when the event says (days start at 1). */
function eventDay(e: PublicEvent): number | null {
  if ("dayNumber" in e && typeof e.dayNumber === "number") {
    return e.type === "night_death" ? null : Math.max(1, e.dayNumber);
  }
  return null;
}

/** Public facts per player from the public log: nominations, votes (who raised a hand), deaths. */
export function factsFromLog(state: Pick<PhonePublic, "publicLog" | "players" | "dayNumber">): Fact[] {
  const name = (id: string) => state.players.find((p) => p.id === id)?.name || "?";
  const out: Fact[] = [];
  // The log is a window of recent events; before its first dated event, assume the earliest day it shows.
  let day = state.publicLog.map(eventDay).find((d) => d !== null) ?? Math.max(1, state.dayNumber);
  state.publicLog.forEach((e) => {
    const d = eventDay(e);
    if (d !== null) day = d;
    const key = `${e.at}-${e.type}`;
    const add = (playerId: string, text: string, n = 0) => out.push({ key: `${key}-${n}-${playerId}`, playerId, text, at: e.at });
    switch (e.type) {
      case "nomination":
        add(e.nominatorId, `D${day}: nominated ${name(e.nomineeId)}`);
        add(e.nomineeId, `D${day}: nominated by ${name(e.nominatorId)}`, 1);
        break;
      case "vote_result": {
        const verdict = e.outcome === "majority" ? "on the block" : e.outcome === "tie" ? "tied" : "not enough";
        add(e.nomineeId, `D${day}: ${e.votesFor} vote${e.votesFor === 1 ? "" : "s"} (${verdict})`);
        (e.voterIds ?? []).forEach((v, n) => add(v, `D${day}: voted for ${name(e.nomineeId)}`, n + 1));
        break;
      }
      case "execution":
        add(e.playerId, e.virgin ? `D${day}: executed (Virgin)` : e.died ? `D${day}: executed` : `D${day}: executed, survived`);
        break;
      case "night_death":
        e.playerIds.forEach((id, n) => add(id, `N${e.dayNumber + 1}: died in the night`, n));
        break;
      case "other_death":
        add(e.playerId, e.duringNight ? `N${(e.dayNumber ?? 0) + 1}: died in the night` : `D${day}: died by day`);
        break;
      case "slayer_shot":
        add(e.shooterId, `D${day}: shot at ${name(e.targetId)}${e.hit ? " (died)" : ""}`);
        add(e.targetId, `D${day}: shot at by ${name(e.shooterId)}${e.hit ? " (died)" : ""}`, 1);
        break;
      case "exile":
        add(e.playerId, `D${day}: ${e.exiled ? "exiled" : "not exiled"} (${e.supporters}/${e.threshold})`);
        break;
      default:
        break;
    }
  });
  return out;
}

/** Add facts this phone hasn't kept yet. Returns the same doc when nothing is new. */
export function mergeFacts(doc: NotesDoc, facts: Fact[]): NotesDoc {
  const have = new Set(doc.facts.map((f) => f.key));
  const fresh = facts.filter((f) => !have.has(f.key));
  if (!fresh.length) return doc;
  return { ...doc, facts: [...doc.facts, ...fresh].sort((a, b) => a.at - b.at).slice(-500) };
}

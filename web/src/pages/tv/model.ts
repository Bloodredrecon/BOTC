import type { Phase, PublicEvent, PublicPlayer, PublicState } from "../../types";

/** F overlay map: town / gazette visibility by phase. */
export function panelVisibility(phase: Phase | undefined): { town: boolean; gazette: boolean } {
  switch (phase) {
    case "lobby":
      return { town: true, gazette: false };
    case "firstNight":
    case "night":
    case "nomination":
    case "vote":
    case "execution":
      return { town: false, gazette: false };
    default:
      return { town: true, gazette: true };
  }
}

/** Day number shown at dawn (the day that is breaking). */
export function dawnDay(dayNumber: number): number {
  return dayNumber === 0 ? 1 : dayNumber + 1;
}

/** Clocktower day/night index (not wall-clock time). */
export function clocktowerMark(phase: Phase, dayNumber: number): { kind: "day" | "night" | "none"; n: number } {
  switch (phase) {
    case "lobby":
      return { kind: "none", n: 0 };
    case "firstNight":
      return { kind: "night", n: 1 };
    case "night":
    case "dawn":
      return { kind: "night", n: Math.max(1, dayNumber + 1) };
    default:
      return { kind: "day", n: Math.max(1, dayNumber) };
  }
}

export type HeroCopy = { label: string; word: string };

/** Today's execution is done (gallows or Virgin) — dusk no longer takes nominations. */
export function executedToday(state: PublicState): boolean {
  const d = Math.max(1, state.dayNumber);
  return state.publicLog.some((e) => e.type === "execution" && e.dayNumber === d);
}

/** E–C–B type hierarchy for the phase plaque: small spaced label over the huge phase word. */
export function heroCopy(state: PublicState): HeroCopy | null {
  const d = state.dayNumber;
  switch (state.phase) {
    case "lobby":
      return { label: "Ravenswood Bluff", word: "Gathering" };
    case "firstNight":
      return { label: "The first night", word: "Night 1" };
    case "night":
      return { label: "Night falls", word: `Night ${Math.max(1, d + 1)}` };
    case "dawn":
      return { label: `Day ${dawnDay(d)} breaks`, word: "Dawn" };
    case "day":
      return { label: "Ravenswood Bluff", word: `Day ${Math.max(1, d)}` };
    case "dusk":
      if (executedToday(state)) return { label: "Night draws in", word: "Dusk" };
      return state.nominationsOpen
        ? { label: "Dusk · nominations are open", word: "Nominations" }
        : { label: `Day ${Math.max(1, d)} ends`, word: "Dusk falls" };
    case "ended":
      return {
        label: state.winReason ?? "The game has ended",
        word: state.winner === "good" ? "Good wins" : state.winner === "evil" ? "Evil wins" : "Game over",
      };
    default:
      return null;
  }
}

/** First night is 1 (dayNumber 0 at dawn); later nights are dayNumber + 1. */
function chronicleNight(dayNumber: number | undefined): number {
  return Math.max(1, (dayNumber ?? 0) + 1);
}

function chronicleDay(dayNumber: number | undefined): number {
  return Math.max(1, dayNumber ?? 1);
}

/** Old sessions may lack duringNight; never surface reason/killer text. */
function otherDeathWasOvernight(e: Extract<PublicEvent, { type: "other_death" }>): boolean {
  if (e.duringNight === true) return true;
  if (e.duringNight === false) return false;
  return /imp|demon|star.?pass|night/i.test(e.reason ?? "");
}

export type LedgerLine = {
  text: string;
  marker?: { kind: "night" | "day"; n: number };
  emphasis?: boolean;
};

export function ledgerLine(e: PublicEvent, nameOf: (id: string) => string): LedgerLine {
  switch (e.type) {
    case "night_death": {
      const n = chronicleNight(e.dayNumber);
      const names = e.playerIds.map(nameOf).filter(Boolean);
      return {
        text: names.length ? `${names.join(" · ")} died in the night` : "Someone died in the night",
        marker: { kind: "night", n },
        emphasis: true,
      };
    }
    case "nomination":
      return { text: `${nameOf(e.nominatorId)} nominates ${nameOf(e.nomineeId)}` };
    case "vote_result": {
      const verdict =
        e.outcome === "majority"
          ? "on the block"
          : e.outcome === "tie"
            ? "tied, block cleared"
            : e.outcome === "outvoted"
              ? "too few to take the block"
              : "no majority";
      return { text: `Vote on ${nameOf(e.nomineeId)}: ${e.votesFor}/${e.majority} — ${verdict}` };
    }
    case "dusk":
      return { text: "Dusk falls", marker: { kind: "day", n: chronicleDay(e.dayNumber) } };
    case "nominations_open":
      return { text: "Nominations open", marker: { kind: "day", n: chronicleDay(e.dayNumber) } };
    case "no_execution":
      return { text: "No execution today", marker: { kind: "day", n: chronicleDay(e.dayNumber) } };
    case "execution": {
      const day = chronicleDay(e.dayNumber);
      if (e.alreadyDead) {
        return { text: `${nameOf(e.playerId)} was executed — already dead`, marker: { kind: "day", n: day } };
      }
      if (e.virgin) {
        return { text: `${nameOf(e.playerId)} was struck down by the Virgin's purity`, marker: { kind: "day", n: day }, emphasis: true };
      }
      return e.died
        ? { text: `${nameOf(e.playerId)} was executed`, marker: { kind: "day", n: day }, emphasis: true }
        : { text: `${nameOf(e.playerId)} survived the gallows`, marker: { kind: "day", n: day } };
    }
    case "slayer_shot":
      // The death itself is its own "died by day" line; this line never says who was what.
      return {
        text: e.hit
          ? `${nameOf(e.shooterId)} takes a shot at ${nameOf(e.targetId)}`
          : `${nameOf(e.shooterId)} takes a shot at ${nameOf(e.targetId)} — nothing happens`,
        marker: { kind: "day", n: chronicleDay(e.dayNumber) },
      };
    case "exile": {
      const who = e.playerName || nameOf(e.playerId);
      const day = chronicleDay(e.dayNumber);
      return e.exiled
        ? { text: `${who} was exiled (${e.supporters}/${e.threshold})`, marker: { kind: "day", n: day }, emphasis: true }
        : { text: `${who} was not exiled (${e.supporters}/${e.threshold})`, marker: { kind: "day", n: day } };
    }
    case "other_death": {
      if (otherDeathWasOvernight(e)) {
        return {
          text: `${nameOf(e.playerId)} died in the night`,
          marker: { kind: "night", n: chronicleNight(e.dayNumber) },
          emphasis: true,
        };
      }
      return {
        text: `${nameOf(e.playerId)} died by day`,
        marker: { kind: "day", n: chronicleDay(e.dayNumber) },
        emphasis: true,
      };
    }
    case "traveller_join":
      return {
        text: `A traveller arrives: ${e.playerName || nameOf(e.playerId)}${e.characterName ? ` — the ${e.characterName}` : ""}`,
      };
    case "traveller_leave":
      return { text: `A traveller departs: ${e.playerName || nameOf(e.playerId)}` };
  }
}

/** Public on-the-block line for the day screen ("On the block: Sam · 5 votes"). */
export function blockLine(block: PublicState["block"], nameOf: (id: string) => string): string | null {
  if (!block) return null;
  const votes = `${block.votes} vote${block.votes === 1 ? "" : "s"}`;
  return block.nomineeId ? `On the block: ${nameOf(block.nomineeId)} · ${votes}` : `Tied at ${votes} · nobody on the block`;
}

/** BOTC vote order: clockwise from the seat after the nominee, nominee last. */
export function voteOrder(players: PublicPlayer[], nomineeId: string): PublicPlayer[] {
  const seated = players.filter((p) => !p.leftGame).sort((a, b) => a.seat - b.seat);
  const i = seated.findIndex((p) => p.id === nomineeId);
  if (i < 0) return seated;
  return [...seated.slice(i + 1), ...seated.slice(0, i + 1)];
}

/** Town grid columns: wide chips for small towns, ≤4 rows up to 20 seats (+ travellers). */
export function townColumns(n: number): number {
  if (n <= 5) return Math.max(1, n);
  if (n <= 12) return 4;
  if (n <= 20) return 5;
  return 6;
}

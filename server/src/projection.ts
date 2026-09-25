import type { ScriptData } from "./persistence.js";
import type {
  GameSession,
  Player,
  PublicState,
  SetupCounts,
  StorytellerState,
  Team,
} from "./types.js";

export function livingCount(session: GameSession): number {
  return session.players.filter((p) => p.alive).length;
}

export function majorityNeeded(session: GameSession): number {
  return Math.ceil(livingCount(session) / 2);
}

export function emptyCounts(): SetupCounts {
  return { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
}

export function assignedCounts(session: GameSession, script: ScriptData): SetupCounts {
  const counts = emptyCounts();
  for (const p of session.players) {
    if (!p.characterId) continue;
    const c = script.characters.find((x) => x.id === p.characterId);
    if (!c) continue;
    counts[c.team] += 1;
  }
  return counts;
}

export function setupForCount(script: ScriptData, n: number): SetupCounts | null {
  return script.setupByPlayerCount[String(n)] ?? null;
}

export function setupWarning(
  session: GameSession,
  script: ScriptData,
): string | null {
  const n = session.players.length;
  const required = setupForCount(script, n);
  if (!required) {
    return `No official Trouble Brewing bag for ${n} players (use 5–15, or Travellers for larger games).`;
  }
  const assigned = assignedCounts(session, script);
  const teams: Team[] = ["townsfolk", "outsider", "minion", "demon"];
  const mismatches = teams.filter((t) => assigned[t] !== required[t]);
  if (mismatches.length === 0) return null;
  return `Bag counts: need T${required.townsfolk}/O${required.outsider}/M${required.minion}/D${required.demon}, have T${assigned.townsfolk}/O${assigned.outsider}/M${assigned.minion}/D${assigned.demon}.`;
}

export function playerName(session: GameSession, id: string): string {
  return session.players.find((p) => p.id === id)?.name ?? id;
}

export function toPublicState(
  session: GameSession,
  script: ScriptData,
  extras?: {
    soundCue?: PublicState["soundCue"];
    hueScene?: PublicState["hueScene"];
    seq?: number;
  },
): PublicState {
  const majority = majorityNeeded(session);
  return {
    scriptId: session.scriptId,
    scriptName: script.name,
    phase: session.phase,
    dayNumber: session.dayNumber,
    seq: extras?.seq ?? 0,
    players: session.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      name: p.name,
      alive: p.alive,
      usedGhostVote: p.usedGhostVote,
    })),
    fabled: session.fabled
      .map((id) => script.fabled.find((f) => f.id === id))
      .filter(Boolean)
      .map((f) => ({ id: f!.id, name: f!.name })),
    publicLog: session.publicLog.slice(-30),
    timer: session.timer,
    nomination: session.nomination
      ? {
          nominatorId: session.nomination.nominatorId,
          nomineeId: session.nomination.nomineeId,
          votesFor: session.nomination.votesFor,
          majority,
          votesForCount: session.nomination.votesFor.length,
        }
      : null,
    dawnDeathIds: session.dawnDeathIds,
    executionPendingId: session.executionPendingId,
    storytellerConnected: session.storytellerConnected,
    soundCue: extras?.soundCue ?? null,
    hueScene: extras?.hueScene ?? null,
  };
}

export function toStorytellerState(
  session: GameSession,
  script: ScriptData,
  extras?: {
    soundCue?: PublicState["soundCue"];
    hueScene?: PublicState["hueScene"];
    seq?: number;
  },
): StorytellerState {
  const pub = toPublicState(session, script, extras);
  return {
    ...pub,
    players: session.players,
    night: session.night,
    setup: setupForCount(script, session.players.length),
    assignedCounts: assignedCounts(session, script),
    setupWarning: setupWarning(session, script),
    characters: script.characters,
    allFabled: script.fabled,
    pinRequired: true,
  };
}

export function canPlayerVote(p: Player): boolean {
  if (p.alive) return true;
  return !p.usedGhostVote;
}

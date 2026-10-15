import { listAmbianceCatalog, normalizeAmbiance, toAmbiancePublic } from "./ambiance.js";
import { listAudioCues } from "./audio-library.js";
import { dayAbilityTips } from "./night.js";
import { nominationRules } from "./nominations.js";
import type { ScriptData } from "./persistence.js";
import { toPhonePanel } from "./phones.js";
import { exileThreshold } from "./nominations.js";
import {
  adjustSetupForBaron,
  alignmentOf,
  butlerVoteWarning,
  effectiveVoteCount,
  trueCharacterId,
} from "./rules.js";
import type {
  GameSession,
  Player,
  PublicEvent,
  PublicSheet,
  PublicState,
  RevealPlayer,
  SetupCounts,
  StorytellerState,
  Team,
} from "./types.js";

/** True once overnight deaths may appear on the public TV roster / ledger. */
export function overnightDeathsArePublic(session: GameSession): boolean {
  if (session.phase === "night" || session.phase === "firstNight") return false;
  if (session.phase === "dawn") return Boolean(session.dawnDeathsAnnounced);
  return true;
}

/**
 * Public alive bit for TV / projection.
 * otherDeath flips session alive immediately (ST grimoire); overnight kills stay
 * hidden here until announceDawnDeaths (or day). Executions / day deaths pass through.
 */
export function publicAlive(session: GameSession, p: Player): boolean {
  if (p.alive) return true;
  if (
    !overnightDeathsArePublic(session) &&
    session.diedTonightIds.includes(p.id)
  ) {
    return true;
  }
  return false;
}

/** Strip killer/ability cause text from events sent to TV / public clients. */
export function sanitizePublicLog(events: PublicEvent[]): PublicEvent[] {
  const out: PublicEvent[] = [];
  for (const e of events) {
    if (e.type !== "other_death") {
      out.push(e);
      continue;
    }
    // Infer overnight before dropping reason (legacy Imp kills used reason "Demon").
    let duringNight = e.duringNight;
    if (
      duringNight === undefined &&
      /imp|demon|star.?pass|night/i.test(e.reason ?? "")
    ) {
      duringNight = true;
    }
    // Overnight other_death is ST bookkeeping — public announcement is night_death at dawn.
    if (duringNight) continue;
    out.push({
      type: "other_death",
      playerId: e.playerId,
      dayNumber: e.dayNumber,
      duringNight: false,
      at: e.at,
      // reason intentionally omitted — never leak Demon / Virgin / Slayer / etc.
    });
  }
  return out;
}

export function livingCount(session: GameSession): number {
  return session.players.filter((p) => p.alive && !p.leftGame).length;
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
    if (!p.characterId || p.isTraveller || p.leftGame) continue;
    const id = trueCharacterId(script, p);
    const c = script.characters.find((x) => x.id === id);
    if (!c || c.team === "traveller") continue;
    counts[c.team as keyof SetupCounts] += 1;
  }
  return counts;
}

export function setupForCount(script: ScriptData, n: number): SetupCounts | null {
  const townsfolkSeats = sessionTownsfolkSeats(n);
  return script.setupByPlayerCount[String(townsfolkSeats)] ?? script.setupByPlayerCount[String(n)] ?? null;
}

function sessionTownsfolkSeats(n: number): number {
  return n;
}

export function setupWarning(session: GameSession, script: ScriptData): string | null {
  const townsfolkPlayers = session.players.filter((p) => !p.isTraveller && !p.leftGame);
  const n = townsfolkPlayers.length;
  const base = script.setupByPlayerCount[String(n)] ?? null;
  if (!base) {
    return `No official Trouble Brewing bag for ${n} townsfolk seats (Travellers are extra). Use 5–15.`;
  }
  const required = adjustSetupForBaron(base, session) ?? base;
  const baronInPlay =
    Boolean(session.baronInSetup) || session.players.some((p) => p.characterId === "baron" && !p.leftGame);
  const assigned = assignedCounts(session, script);
  const teams: (keyof SetupCounts)[] = ["townsfolk", "outsider", "minion", "demon"];
  const mismatches = teams.filter((t) => assigned[t] !== required[t]);
  if (mismatches.length === 0) return null;
  const baronNote = baronInPlay ? " (Baron: +2 Outsiders / −2 Townsfolk)" : "";
  return `Bag counts (excl. Travellers)${baronNote}: need T${required.townsfolk}/O${required.outsider}/M${required.minion}/D${required.demon}, have T${assigned.townsfolk}/O${assigned.outsider}/M${assigned.minion}/D${assigned.demon}.`;
}

export function findCharacter(script: ScriptData, id: string | null) {
  if (!id) return undefined;
  return script.characters.find((c) => c.id === id) || script.travellers.find((c) => c.id === id);
}

export function buildReveal(session: GameSession, script: ScriptData): RevealPlayer[] {
  return session.players
    .filter((p) => !p.leftGame)
    .map((p) => {
      const id = trueCharacterId(script, p);
      const c = findCharacter(script, id);
      const thinks = id === "drunk" ? findCharacter(script, p.thinksCharacterId ?? (p.characterId !== "drunk" ? p.characterId : null)) : undefined;
      return {
        id: p.id,
        seat: p.seat,
        name: p.name,
        alive: p.alive,
        usedGhostVote: p.usedGhostVote,
        isTraveller: p.isTraveller,
        leftGame: p.leftGame,
        travellerCharacterName: p.isTraveller ? (c?.name ?? null) : null,
        characterId: id,
        characterName: c?.name ?? null,
        team: (c?.team as Team) ?? null,
        abilityUsed: p.abilityUsed,
        alignment: alignmentOf(script, p),
        thinksCharacterName: thinks?.name ?? null,
      };
    });
}

/** Public character sheet: script characters + official counts for the seat count (never Baron-adjusted). */
export function buildPublicSheet(session: GameSession, script: ScriptData): PublicSheet {
  const n = session.players.filter((p) => !p.isTraveller && !p.leftGame).length;
  const travellerIds = new Set(
    session.players.filter((p) => p.isTraveller && !p.leftGame && p.characterId).map((p) => p.characterId!),
  );
  return {
    playerCount: n,
    counts: script.setupByPlayerCount[String(n)] ?? null,
    characters: script.characters.map((c) => ({ id: c.id, name: c.name, team: c.team as Team, ability: c.ability })),
    travellers: script.travellers
      .filter((t) => travellerIds.has(t.id))
      .map((t) => ({ id: t.id, name: t.name, ability: t.ability })),
  };
}

const SHEET_PHASES = new Set(["lobby", "day", "dusk"]);

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
  const ended = session.phase === "ended";
  const votesForCount = session.nomination ? effectiveVoteCount(session) : 0;
  const deathsPublic = overnightDeathsArePublic(session);
  return {
    scriptId: session.scriptId,
    scriptName: script.name,
    phase: session.phase,
    dayNumber: session.dayNumber,
    seq: extras?.seq ?? 0,
    players: session.players
      .filter((p) => !p.leftGame)
      .map((p) => ({
        id: p.id,
        seat: p.seat,
        name: p.name,
        alive: publicAlive(session, p),
        usedGhostVote: p.usedGhostVote,
        isTraveller: p.isTraveller,
        leftGame: p.leftGame,
        // Travellers declare their character publicly; residents never appear here before the reveal.
        travellerCharacterName: p.isTraveller ? (findCharacter(script, p.characterId)?.name ?? null) : null,
      })),
    fabled: session.fabled
      .map((id) => script.fabled.find((f) => f.id === id))
      .filter(Boolean)
      .map((f) => ({ id: f!.id, name: f!.name })),
    publicLog: sanitizePublicLog(session.publicLog.slice(-40)),
    timer: session.timer,
    nomination: session.nomination
      ? {
          nominatorId: session.nomination.nominatorId,
          nomineeId: session.nomination.nomineeId,
          votesFor: session.nomination.votesFor,
          majority,
          votesForCount,
          toBeat: session.block?.votes ?? null,
        }
      : null,
    // Names only after announceDawnDeaths — avoid leaking kills at goDawn.
    dawnDeathIds: deathsPublic ? session.dawnDeathIds : [],
    dawnDeathsAnnounced: deathsPublic && session.phase === "dawn",
    executionPendingId: session.executionPendingId,
    nominationsToday: session.nominationsToday ?? [],
    block: session.block ?? null,
    nominationsOpen: Boolean(session.nominationsOpen),
    storytellerConnected: session.storytellerConnected,
    soundCue: extras?.soundCue ?? null,
    ambiance: toAmbiancePublic(normalizeAmbiance(session.ambiance)),
    hueScene: extras?.hueScene ?? null,
    winner: session.winner,
    winReason: session.phase === "ended" ? session.winReason : null,
    reveal: ended ? buildReveal(session, script) : null,
    exile: session.exile
      ? {
          travellerId: session.exile.travellerId,
          calledById: session.exile.calledById,
          supporters: session.exile.supporters,
          threshold: exileThreshold(session),
        }
      : null,
    sheet: session.tvSheet && SHEET_PHASES.has(session.phase) ? buildPublicSheet(session, script) : null,
    phoneJoin: session.phones?.enabled && session.phones.claimsOpen ? { code: session.phones.joinCode } : null,
  };
}

export function toStorytellerState(
  session: GameSession,
  script: ScriptData,
  extras?: {
    soundCue?: PublicState["soundCue"];
    hueScene?: PublicState["hueScene"];
    seq?: number;
    phoneLive?: { connected: Record<string, number>; spectators: number };
  },
): StorytellerState {
  const pub = toPublicState(session, script, extras);
  const townsfolkCount = session.players.filter((p) => !p.isTraveller && !p.leftGame).length;
  const baseSetup = script.setupByPlayerCount[String(townsfolkCount)] ?? null;
  return {
    ...pub,
    players: session.players,
    night: session.night,
    setup: adjustSetupForBaron(baseSetup, session),
    officialSetup: baseSetup,
    assignedCounts: assignedCounts(session, script),
    setupWarning: setupWarning(session, script),
    characters: script.characters,
    travellers: script.travellers,
    allFabled: script.fabled,
    pinRequired: true,
    dayAbilities: dayAbilityTips(session, script),
    executedTodayId: session.executedTodayId,
    executionOccurredToday: Boolean(session.executionOccurredToday),
    newDemons: session.newDemons ?? [],
    startingCharacters: session.startingCharacters ?? {},
    tvSheet: Boolean(session.tvSheet),
    allowOver15: Boolean(session.allowOver15),
    butlerWarning: session.nomination ? butlerVoteWarning(session, session.nomination.votesFor) : null,
    nightPending: Boolean(session.nightPending),
    nominationRules: nominationRules(session),
    diedTonightIds: session.diedTonightIds,
    // ST edits the real list before announce; public projection may withhold it.
    dawnDeathIds: session.dawnDeathIds,
    dawnDeathsAnnounced: Boolean(session.dawnDeathsAnnounced),
    stNotices: session.stNotices ?? [],
    audioCues: listAudioCues(),
    ambianceCatalog: listAmbianceCatalog(),
    phones: toPhonePanel(session, extras?.phoneLive ?? { connected: {}, spectators: 0 }),
  };
}

export function canPlayerVote(p: Player): boolean {
  if (p.leftGame) return false;
  if (p.alive) return true;
  // Dead players — Travellers included — keep one ghost vote.
  return !p.usedGhostVote;
}

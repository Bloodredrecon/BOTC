import type { HueDriver } from "./hue.js";
import { normalizeAmbiance, type AmbianceState } from "./ambiance.js";
import { expandSoundVariants, resolveSoundCueId } from "./audio-library.js";
import { buildNightSteps } from "./night.js";
import type { ScriptData } from "./persistence.js";
import { createEmptySession, normalizePlayer, saveSession } from "./persistence.js";
import {
  canPlayerVote,
  majorityNeeded,
  toPublicState,
  toStorytellerState,
} from "./projection.js";
import {
  addReminder,
  placeExclusiveReminder,
  placeInfoPairReminders,
} from "./reminders.js";
import {
  alignmentOf,
  butlerVoteWarning,
  effectiveVoteCount,
  endPoisonWithPoisoner,
  findDef,
  impKillFailReason,
  isOvernightPhase,
  livingPoisoner,
  mayorWinAtDusk,
  nightKillBlockReason,
  pushStNotice,
  resolveDemonDeath,
  saintExecutedWin,
  slayerShotOutcome,
  standingWin,
  starPassCandidates,
  trueCharacterId,
  virginShouldTrigger,
  type WinResult,
} from "./rules.js";
import {
  applyVoteToBlock,
  dayLimitReason,
  exileThreshold,
  nominationsClosedReason,
  nominatorReason,
  nomineeReason,
  notOpenReason,
  travellerNomineeReason,
} from "./nominations.js";
import type {
  Alignment,
  DayNomination,
  GameSession,
  HueScene,
  Phase,
  Player,
  PublicState,
  StorytellerState,
} from "./types.js";

/** Official games seat at most 15 non-Traveller players; the house-rule override allows 20. */
export const MAX_OFFICIAL_PLAYERS = 15;
export const MAX_HOUSE_PLAYERS = 20;

function bySeat(a: Player, b: Player) {
  return a.seat - b.seat;
}

/** Renumber seats 1..n in the given order and keep the players array in seat order. */
function applySeatOrder(s: GameSession, ordered: Player[]) {
  ordered.forEach((p, i) => {
    p.seat = i + 1;
  });
  s.players = ordered;
}

/**
 * Rebuild tonight's steps after the grimoire changed, without losing our place:
 * steps already passed stay as they were, the current step keeps its position (by id), and
 * the rest comes from the fresh build. Returns a Storyteller notice if a newly-needed wake
 * now falls before the current step (it would otherwise be silently skipped).
 */
function rebuildNightInPlace(s: GameSession, script: ScriptData): string | null {
  if (!s.night) return null;
  const old = s.night.steps;
  const idx = Math.max(0, Math.min(s.night.stepIndex, old.length - 1));
  const fresh = buildNightSteps(s, script, s.night.isFirstNight);
  const past = old.slice(0, idx);
  const pastIds = new Set(past.map((x) => x.id));
  const current = old[idx];

  let start = current ? fresh.findIndex((x) => x.id === current.id) : 0;
  if (start < 0 && current) {
    for (let j = idx + 1; j < old.length && start < 0; j++) {
      start = fresh.findIndex((x) => x.id === old[j]!.id);
    }
  }
  if (start < 0) start = fresh.length - 1;

  const missed = fresh.slice(0, start).filter((x) => !pastIds.has(x.id) && !x.skipped && x.id !== "dusk");
  const rest = fresh.slice(start).filter((x) => !pastIds.has(x.id));
  // The player acting right now (e.g. the Imp who just killed themselves) keeps their step.
  if (current && rest[0]?.id === current.id && rest[0].skipped && !current.skipped) rest[0] = current;
  s.night.steps = [...past, ...rest];
  s.night.stepIndex = past.length;
  return missed.length
    ? `Night order changed: ${missed.map((m) => m.name).join(", ")} would have woken earlier tonight — handle it now if needed.`
    : null;
}

export type BroadcastFn = (payload: {
  public: PublicState;
  storyteller: StorytellerState;
}) => void;

/**
 * Reminders that last through the night they are placed and the following day,
 * then clear when the *next* night starts (not at dawn).
 * Poisoned: Poisoner night → active that night + next day → cleared at following dusk/night.
 */
const NIGHT_SCOPED_REMINDERS = [
  "Poisoned",
  "Safe",
  "Master",
  "3 votes",
  "Negative vote",
];

/** Exclusive night marks — at most one player holds each. */
const EXCLUSIVE_NIGHT_REMINDERS = [
  "Poisoned",
  "Safe",
  "Master",
  "3 votes",
  "Negative vote",
];

/** Day-scoped: placed on execution, cleared when dawn begins (after Undertaker night). */
const DAWN_CLEAR_REMINDERS = ["Died today"];

/** Clear night-scoped tokens at night start. Returns names that lost Poisoned. */
function clearNightScopedReminders(s: GameSession): string[] {
  const poisonCleared: string[] = [];
  for (const p of s.players) {
    const hadPoison = p.reminders.includes("Poisoned");
    const next = p.reminders.filter((r) => !NIGHT_SCOPED_REMINDERS.includes(r));
    if (next.length !== p.reminders.length) {
      p.reminders = next;
      if (hadPoison) poisonCleared.push(p.name);
    }
  }
  return poisonCleared;
}

function clearDawnReminders(s: GameSession) {
  for (const p of s.players) {
    const next = p.reminders.filter((r) => !DAWN_CLEAR_REMINDERS.includes(r));
    if (next.length !== p.reminders.length) p.reminders = next;
  }
}

function resetDayNominations(s: GameSession) {
  s.nominationsToday = [];
  s.block = null;
  s.nominationsOpen = false;
  s.nightPending = false;
}

/** Where the open nomination's vote hands back to (dusk unless opened by override during the day). */
function nominationReturnPhase(s: GameSession): "day" | "dusk" {
  return s.nomination?.returnPhase ?? "dusk";
}

/** Someone was executed today (a survived execution and the Virgin count too). */
function executionHappenedToday(s: GameSession): boolean {
  const day = Math.max(1, s.dayNumber || 1);
  return (
    s.executionOccurredToday ||
    Boolean(s.executedTodayId) ||
    s.publicLog.some((e) => e.type === "execution" && e.dayNumber === day)
  );
}

function lastIndexWhere<T>(list: T[], pred: (x: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i -= 1) if (pred(list[i])) return i;
  return -1;
}

/** The open nomination's record in nominationsToday (outcome still null). */
function openNominationRecord(s: GameSession): DayNomination | undefined {
  const open = s.nomination;
  if (!open) return undefined;
  const idx = lastIndexWhere(
    s.nominationsToday,
    (n) => n.outcome === null && n.nominatorId === open.nominatorId && n.nomineeId === open.nomineeId,
  );
  return idx >= 0 ? s.nominationsToday[idx] : undefined;
}

/** Forget the still-open nomination as if it was never made (record + its chronicle line). */
function dropOpenNomination(s: GameSession) {
  const open = s.nomination;
  if (!open) return;
  const rec = openNominationRecord(s);
  if (rec) s.nominationsToday.splice(s.nominationsToday.indexOf(rec), 1);
  const logIdx = lastIndexWhere(
    s.publicLog,
    (e) => e.type === "nomination" && e.nominatorId === open.nominatorId && e.nomineeId === open.nomineeId,
  );
  if (logIdx >= 0) s.publicLog.splice(logIdx, 1);
}

/** Narration cue for the start of a numbered day (random among lettered takes). */
function daySoundCue(dayNumber: number): string {
  const base = dayNumber <= 1 ? "day_1" : dayNumber === 2 ? "day_2" : dayNumber === 3 ? "day_3" : "day_n";
  return pickSound(base);
}

/** Dawn death announcement cue from how many died. */
function dawnDeathSoundCue(count: number): string {
  if (count <= 0) return pickSound("no_deaths", "atm_dawn_empty");
  if (count === 1) return pickSound("someone_died", "death", "atm_dawn_loss");
  return pickSound("multiple_deaths", "death");
}

/**
 * How long to wait after a dawn death cue before starting Day narration.
 * Measured with ffprobe (2026-09-26): someone_died ≤7.54s, multiple_deaths ≤8.06s,
 * no_deaths ≤10.66s. Includes a short gap so Day does not cut the line via stopSting.
 */
function dawnDeathCueHoldMs(cueId: string | null): number {
  const base = (cueId ?? "")
    .replace(/^custom:/, "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .split("/")
    .pop() ?? "";
  const gap = 400;
  if (base.startsWith("no_deaths")) return 11_000 + gap;
  if (base.startsWith("multiple_deaths")) return 8500 + gap;
  if (base.startsWith("someone_died") || base === "death" || base.startsWith("death_")) {
    return 8000 + gap;
  }
  // Atmosphere fallbacks / unknown — use no_deaths ceiling
  return 11_000 + gap;
}

/**
 * Waits before the win cue so it does not cut the line already playing (playCue stops the sting).
 * Measured with ffprobe (2026-09-26): execution_* / death_* ≤9.0s, public_shot 7.97s,
 * public_shot_true / public_shot_false ≤7.35s.
 */
const EXECUTION_CUE_HOLD_MS = 9500;
const SHOT_CUE_HOLD_MS = 8400;
const SHOT_RESULT_HOLD_MS = 7800;

/**
 * Randomly pick one interchangeable cue (same moment, different take).
 * Also expands lettered siblings on disk (`nomination` + `nomination_b` + `nomination_c`).
 */
function pickSound(...cues: string[]): string {
  const expanded = expandSoundVariants(...cues);
  if (expanded.length === 0) return "hush";
  if (expanded.length === 1) return expanded[0];
  return expanded[Math.floor(Math.random() * expanded.length)];
}

export class GameEngine {
  session: GameSession;
  private lastSound: string | null = null;
  private lastHue: HueScene = null;
  private seq = 0;
  /** Schedules finishDawn after announce so Day narration does not cut the death line. */
  private dawnThenDayTimer: ReturnType<typeof setTimeout> | null = null;
  /** Game over detected; announced once the current cue finishes (or at the next phase action). */
  private pendingWin: {
    result: WinResult;
    sound?: string;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  /** Plays the Slayer shot result after the shot cue. */
  private shotTimer: ReturnType<typeof setTimeout> | null = null;
  /** Starts the night once the end-of-day execution cue has finished. */
  private nightTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    session: GameSession,
    private script: ScriptData,
    private hue: HueDriver,
    private broadcast: BroadcastFn,
  ) {
    this.session = session;
  }

  private clearDawnThenDayTimer() {
    if (this.dawnThenDayTimer) {
      clearTimeout(this.dawnThenDayTimer);
      this.dawnThenDayTimer = null;
    }
  }

  private clearShotTimer() {
    if (this.shotTimer) {
      clearTimeout(this.shotTimer);
      this.shotTimer = null;
    }
  }

  private clearNightTimer() {
    if (this.nightTimer) {
      clearTimeout(this.nightTimer);
      this.nightTimer = null;
    }
  }

  private cancelPendingWin() {
    if (this.pendingWin) {
      clearTimeout(this.pendingWin.timer);
      this.pendingWin = null;
    }
  }

  /** ST learns immediately; the TV announces after `holdMs` so the current line finishes. */
  private scheduleWin(result: WinResult, holdMs: number, sound?: string) {
    if (this.session.phase === "ended" || this.pendingWin) return;
    this.clearDawnThenDayTimer();
    const team = result.winner === "good" ? "Good" : "Evil";
    this.mutate((s) => pushStNotice(s, `GAME OVER — ${team} wins. ${result.stReason}`));
    const timer = setTimeout(() => this.flushPendingWin(), holdMs);
    this.pendingWin = { result, sound, timer };
  }

  /** Announce a scheduled game over now. Returns true if the game ended. */
  flushPendingWin(): boolean {
    const pending = this.pendingWin;
    if (!pending) return false;
    this.cancelPendingWin();
    this.endGame(pending.result.winner, { reason: pending.result.reason, sound: pending.sound });
    return true;
  }

  /** Demon dead / two left alive — schedule the win if either holds. */
  private checkStandingWin(holdMs: number): boolean {
    const win = standingWin(this.session, this.script);
    if (!win) return false;
    this.scheduleWin(win, holdMs);
    return true;
  }

  /** Safety net at phase changes (e.g. grimoire edits): end immediately if a win already holds. */
  private endIfStandingWin(): boolean {
    if (this.flushPendingWin()) return true;
    const win = standingWin(this.session, this.script);
    if (!win) return false;
    const team = win.winner === "good" ? "Good" : "Evil";
    this.mutate((s) => pushStNotice(s, `GAME OVER — ${team} wins. ${win.stReason}`));
    this.endGame(win.winner, { reason: win.reason });
    return true;
  }

  mutate(fn: (s: GameSession) => void, opts?: { sound?: string | null; hue?: HueScene }) {
    const hadLivingPoisoner = Boolean(livingPoisoner(this.session));
    fn(this.session);
    // Poison ends the moment the Poisoner dies or stops being the Poisoner (star-pass).
    const cured = endPoisonWithPoisoner(this.session, hadLivingPoisoner);
    if (cured.length) {
      pushStNotice(this.session, `The Poisoner is gone — poison ends now (${cured.join(", ")} healthy again).`);
      const moved = rebuildNightInPlace(this.session, this.script);
      if (moved) pushStNotice(this.session, moved);
    }
    if (opts?.sound !== undefined) {
      this.lastSound = opts.sound === null ? null : resolveSoundCueId(opts.sound);
    }
    if (opts?.hue !== undefined) {
      this.lastHue = opts.hue;
      if (opts.hue) void this.hue.applyScene(opts.hue);
    }
    saveSession(this.session);
    this.emit();
    this.lastSound = null;
    this.lastHue = null;
  }

  emit() {
    this.seq += 1;
    this.broadcast({
      public: toPublicState(this.session, this.script, {
        soundCue: this.lastSound,
        hueScene: this.lastHue,
        seq: this.seq,
      }),
      storyteller: toStorytellerState(this.session, this.script, {
        soundCue: this.lastSound,
        hueScene: this.lastHue,
        seq: this.seq,
      }),
    });
  }

  setConnected(role: "tv" | "storyteller", connected: boolean) {
    if (role === "tv") this.session.tvConnected = connected;
    else this.session.storytellerConnected = connected;
    this.emit();
  }

  playSound(cueId: string) {
    this.mutate(() => {}, { sound: cueId });
  }

  setAmbiance(patch: Partial<AmbianceState>) {
    this.mutate((s) => {
      s.ambiance = normalizeAmbiance({
        masterVolume: patch.masterVolume ?? s.ambiance?.masterVolume,
        layers: patch.layers ?? s.ambiance?.layers,
      });
    });
  }

  resetGame() {
    this.clearDawnThenDayTimer();
    this.clearShotTimer();
    this.clearNightTimer();
    this.cancelPendingWin();
    const townsfolk = this.session.players.filter((p) => !p.isTraveller).length || 8;
    const tvConnected = this.session.tvConnected;
    const storytellerConnected = this.session.storytellerConnected;
    this.session = createEmptySession(Math.max(5, Math.min(20, townsfolk)));
    this.session.tvConnected = tvConnected;
    this.session.storytellerConnected = storytellerConnected;
    this.lastSound = "hush";
    this.lastHue = "hush";
    void this.hue.applyScene("hush");
    saveSession(this.session);
    this.emit();
    this.lastSound = null;
    this.lastHue = null;
  }

  /**
   * Resident (non-Traveller) seat count. Official games cap at 15; `allowOver15` is a house rule
   * up to 20. Seats keep their order — residents are added / removed at the end of the circle.
   */
  setPlayerCount(count: number, opts: { allowOver15?: boolean } = {}) {
    const allow = opts.allowOver15 ?? this.session.allowOver15;
    const cap = allow ? MAX_HOUSE_PLAYERS : MAX_OFFICIAL_PLAYERS;
    const requested = Math.floor(Number(count) || 0);
    const n = Math.max(5, Math.min(cap, requested));
    this.mutate((s) => {
      s.allowOver15 = allow;
      if (requested > cap) {
        pushStNotice(
          s,
          allow
            ? `At most ${MAX_HOUSE_PLAYERS} players (plus Travellers) — set to ${n}.`
            : `Official games have at most ${MAX_OFFICIAL_PLAYERS} players (plus Travellers) — set to ${n}. Turn on "Allow more than 15" in Setup for up to ${MAX_HOUSE_PLAYERS}.`,
        );
      }
      const ordered = s.players.filter((p) => !(p.isTraveller && p.leftGame)).sort(bySeat);
      const residents = ordered.filter((p) => !p.isTraveller);
      const keep = new Set(residents.slice(0, n).map((p) => p.id));
      const kept = ordered
        .filter((p) => p.isTraveller || keep.has(p.id))
        .map((p) => normalizePlayer({ ...p }));
      const used = new Set(kept.map((p) => p.id));
      let next = 1;
      for (let i = residents.filter((p) => keep.has(p.id)).length; i < n; i++) {
        while (used.has(`p${next}`)) next++;
        const id = `p${next}`;
        used.add(id);
        kept.push(normalizePlayer({ id, seat: 0, name: `Player ${kept.length + 1}` }));
      }
      applySeatOrder(s, kept);
    });
  }

  /** Move a player to another seat (Traveller arrivals, Matron swaps, fixing the grimoire). */
  moveSeat(playerId: string, toSeat: number): { ok: boolean; message?: string } {
    const ordered = this.session.players.filter((p) => !p.leftGame).sort(bySeat);
    const from = ordered.findIndex((p) => p.id === playerId);
    if (from < 0) return { ok: false, message: "Player not found." };
    const to = Math.max(0, Math.min(ordered.length - 1, Math.floor(Number(toSeat) || 1) - 1));
    this.mutate((s) => {
      const list = s.players.filter((p) => !p.leftGame).sort(bySeat);
      const [p] = list.splice(from, 1);
      list.splice(to, 0, p!);
      const left = s.players.filter((x) => x.leftGame);
      applySeatOrder(s, [...list, ...left]);
      pushStNotice(s, `${p!.name} moved to seat ${to + 1}. Neighbours (Empath / Chef) and vote order follow the new seating.`);
      rebuildNightInPlace(s, this.script);
    });
    return { ok: true };
  }

  updatePlayer(
    playerId: string,
    patch: Partial<{
      name: string;
      characterId: string | null;
      reminders: string[];
      notes: string;
      bluffs: string[];
      alive: boolean;
      usedGhostVote: boolean;
      abilityUsed: boolean;
      thinksCharacterId: string | null;
      alignment: Alignment | null;
    }>,
  ) {
    let rebuildNight = false;
    this.mutate((s) => {
      const p = s.players.find((x) => x.id === playerId);
      if (!p) return;
      const isTownsfolk = (id: string | null | undefined) =>
        this.script.characters.some((c) => c.id === id && c.team === "townsfolk");
      const hadDrunkToken = p.reminders.some((r) => r === "Is the Drunk" || r === "Drunk");
      const before = { characterId: p.characterId, thinks: p.thinksCharacterId, alive: p.alive };

      if (patch.name !== undefined) p.name = patch.name.slice(0, 32);
      if (patch.characterId !== undefined) {
        p.characterId = patch.characterId;
        const trav = this.script.travellers.some((t) => t.id === patch.characterId);
        if (trav) {
          p.isTraveller = true;
          p.alignment = p.alignment ?? "good";
        }
        if (patch.characterId !== "drunk" && before.characterId === "drunk") {
          p.thinksCharacterId = null;
          p.reminders = p.reminders.filter((r) => r !== "Is the Drunk" && r !== "Drunk");
        }
        if (patch.characterId === "drunk" && !p.thinksCharacterId) {
          pushStNotice(s, `${p.name} is the Drunk — pick the Townsfolk they think they are (not one in play).`);
        }
      }
      if (patch.reminders !== undefined) {
        let next = [...patch.reminders];
        if (p.characterId === "butler" && next.includes("Master")) {
          next = next.filter((r) => r !== "Master");
          pushStNotice(s, `The Butler (${p.name}) cannot choose themselves as Master.`);
        }
        p.reminders = next;
        const hasDrunkToken = next.some((r) => r === "Is the Drunk" || r === "Drunk");
        if (hasDrunkToken && !hadDrunkToken && isTownsfolk(p.characterId)) {
          // Drunk token on the Townsfolk they think they are → they are really the Drunk.
          p.thinksCharacterId = p.characterId;
          p.characterId = "drunk";
          p.reminders = [...next.filter((r) => r !== "Drunk" && r !== "Is the Drunk"), "Is the Drunk"];
        } else if (!hasDrunkToken && hadDrunkToken && p.characterId === "drunk" && p.thinksCharacterId) {
          p.characterId = p.thinksCharacterId;
          p.thinksCharacterId = null;
        }
      }
      if (patch.thinksCharacterId !== undefined) {
        const id = patch.thinksCharacterId;
        if (id && !isTownsfolk(id)) {
          pushStNotice(s, "The Drunk must think they are a Townsfolk.");
        } else {
          p.thinksCharacterId = id;
        }
      }
      if (p.characterId === "drunk" && p.thinksCharacterId) {
        const clash = s.players.find(
          (x) => x.id !== p.id && !x.leftGame && trueCharacterId(this.script, x) === p.thinksCharacterId,
        );
        if (clash && (p.thinksCharacterId !== before.thinks || before.characterId !== "drunk")) {
          const name = findDef(this.script, p.thinksCharacterId)?.name ?? p.thinksCharacterId;
          pushStNotice(s, `${p.name} (Drunk) thinks they are the ${name}, but ${clash.name} really is — pick a Townsfolk not in play.`);
        }
      }
      if (p.characterId !== before.characterId || p.thinksCharacterId !== before.thinks) rebuildNight = true;
      if (patch.alignment !== undefined && p.isTraveller) {
        p.alignment = patch.alignment === "evil" ? "evil" : "good";
        if (p.alignment === "good") p.learnedDemon = false;
        rebuildNight = true;
      }
      if (patch.notes !== undefined) p.notes = patch.notes;
      if (patch.bluffs !== undefined) p.bluffs = this.validBluffs(s, p, patch.bluffs);
      if (patch.alive !== undefined) {
        p.alive = patch.alive;
        if (patch.alive) p.usedGhostVote = false;
        // Marked dead overnight → a death to announce at dawn (and their wake is skipped).
        if (isOvernightPhase(s.phase) && before.alive !== p.alive) {
          if (!p.alive && !s.diedTonightIds.includes(p.id)) s.diedTonightIds.push(p.id);
          if (p.alive) {
            s.diedTonightIds = s.diedTonightIds.filter((id) => id !== p.id);
            s.dawnDeathIds = s.dawnDeathIds.filter((id) => id !== p.id);
          }
          if (s.phase === "dawn" && !p.alive && !s.dawnDeathIds.includes(p.id)) s.dawnDeathIds.push(p.id);
          rebuildNight = true;
        }
      }
      if (patch.usedGhostVote !== undefined) p.usedGhostVote = patch.usedGhostVote;
      if (patch.abilityUsed !== undefined) {
        p.abilityUsed = patch.abilityUsed;
        if (patch.abilityUsed && !p.reminders.includes("No ability")) {
          p.reminders = [...p.reminders, "No ability"];
        }
        if (!patch.abilityUsed) {
          p.reminders = p.reminders.filter((r) => r !== "No ability");
        }
      }
      // Grimoire edits never end the game on their own — warn so the ST can confirm.
      if (patch.alive !== undefined || patch.characterId !== undefined) {
        const win = standingWin(s, this.script);
        if (win) {
          pushStNotice(
            s,
            `Win condition met: ${win.winner === "good" ? "Good" : "Evil"} wins — ${win.stReason} Declared automatically at the next dusk/dawn, or use End now.`,
          );
        }
      }
    });
    // Night order is built from roles in play — rebuild when a role is set mid-night
    if (rebuildNight && (this.session.phase === "night" || this.session.phase === "firstNight")) {
      this.rebuildNight();
    }
  }

  /** Demon bluffs: up to 3 distinct good characters that are not in play. */
  private validBluffs(s: GameSession, demon: Player, ids: string[]): string[] {
    const inPlay = new Set(
      s.players.filter((x) => !x.leftGame).map((x) => trueCharacterId(this.script, x)).filter(Boolean) as string[],
    );
    const dropped: string[] = [];
    const out: string[] = [];
    for (const raw of ids) {
      const id = String(raw ?? "");
      if (!id) continue;
      const def = this.script.characters.find((c) => c.id === id);
      const name = def?.name ?? id;
      if (!def || (def.team !== "townsfolk" && def.team !== "outsider")) dropped.push(`${name} (not a good character)`);
      else if (inPlay.has(id)) dropped.push(`${name} (in play)`);
      else if (out.includes(id)) dropped.push(`${name} (duplicate)`);
      else if (out.length >= 3) dropped.push(`${name} (only 3 bluffs)`);
      else out.push(id);
    }
    if (dropped.length) pushStNotice(s, `Bluffs for ${demon.name}: dropped ${dropped.join(", ")}.`);
    return out;
  }

  setFabled(ids: string[]) {
    this.mutate((s) => {
      s.fabled = ids.filter((id) => this.script.fabled.some((f) => f.id === id));
    });
  }

  /**
   * A Traveller sits down: `seat` = where they sit in the circle (default: last), `alignment` is
   * the Storyteller's secret choice. Their Traveller character is public.
   */
  addTraveller(
    name: string,
    characterId: string,
    opts: { seat?: number | null; alignment?: Alignment | null } = {},
  ) {
    const def = this.script.travellers.find((t) => t.id === characterId);
    if (!def) return;
    this.mutate(
      (s) => {
        let id = `t${Date.now()}`;
        while (s.players.some((p) => p.id === id)) id = `${id}x`;
        const playerName = name.slice(0, 32) || def.name;
        const alignment: Alignment = opts.alignment === "evil" ? "evil" : "good";
        const traveller = normalizePlayer({
          id,
          seat: 0,
          name: playerName,
          characterId,
          isTraveller: true,
          alignment,
        });
        const seated = s.players.filter((p) => !p.leftGame).sort(bySeat);
        const at =
          opts.seat != null && Number.isFinite(Number(opts.seat))
            ? Math.max(0, Math.min(seated.length, Math.floor(Number(opts.seat)) - 1))
            : seated.length;
        seated.splice(at, 0, traveller);
        applySeatOrder(s, [...seated, ...s.players.filter((p) => p.leftGame)]);
        s.publicLog.push({
          type: "traveller_join",
          playerId: id,
          playerName,
          characterId,
          characterName: def.name,
          at: Date.now(),
        });
        if (alignment === "evil") {
          pushStNotice(s, `${playerName} is an evil ${def.name} — they learn who the Demon is at the next night (no bluffs, no other evil players).`);
        }
      },
      { sound: pickSound("guest_arrive", "atm_guest") },
    );
  }

  leaveTraveller(playerId: string) {
    this.mutate(
      (s) => {
        const p = s.players.find((x) => x.id === playerId && x.isTraveller);
        if (!p) return;
        const playerName = p.name;
        p.leftGame = true;
        p.alive = false;
        s.publicLog.push({
          type: "traveller_leave",
          playerId,
          playerName,
          at: Date.now(),
        });
        if (s.nomination?.nomineeId === playerId || s.nomination?.nominatorId === playerId) {
          const back = nominationReturnPhase(s);
          dropOpenNomination(s);
          s.nomination = null;
          s.phase = back;
        }
        if (s.block?.nomineeId === playerId) s.block = null;
        if (s.exile?.travellerId === playerId) s.exile = null;
        if (s.exile) s.exile.supporters = s.exile.supporters.filter((id) => id !== playerId);
      },
      { sound: pickSound("guest_depart") },
    );
  }

  /** Any player (alive or dead) calls for a Traveller's exile. Not a nomination: no abilities apply. */
  callExile(travellerId: string, calledById: string | null): { ok: boolean; message?: string } {
    const s0 = this.session;
    const t = s0.players.find((p) => p.id === travellerId && !p.leftGame);
    const today = Math.max(1, s0.dayNumber || 1);
    const calledToday = s0.publicLog.some(
      (x) => x.type === "exile" && x.playerId === travellerId && x.dayNumber === today,
    );
    const refused = !t
      ? "Traveller not found."
      : !t.isTraveller
        ? `${t.name} is not a Traveller — residents are nominated, not exiled.`
        : !t.alive
          ? `${t.name} is already dead — exile is "the group decision to kill a Traveller"; no official rule covers exiling a dead one.`
          : !["day", "dusk"].includes(s0.phase)
            ? "Exiles happen during the day (not during an open nomination, vote or execution)."
            : calledToday
              ? `${t.name} was already called for exile today — "each Traveller can only be called to be exiled once per day".`
              : null;
    if (refused) {
      this.mutate((s) => pushStNotice(s, `Exile not called — ${refused}`));
      return { ok: false, message: refused };
    }
    this.mutate((s) => {
      const caller = calledById ? s.players.find((p) => p.id === calledById && !p.leftGame) : undefined;
      s.exile = { travellerId, calledById: caller?.id ?? null, supporters: [] };
    });
    return { ok: true };
  }

  /** Raise / lower a hand for the exile. Everyone may support — dead players too, no vote token spent. */
  toggleExileSupport(playerId: string) {
    this.mutate((s) => {
      if (!s.exile) return;
      const p = s.players.find((x) => x.id === playerId && !x.leftGame);
      if (!p) return;
      const i = s.exile.supporters.indexOf(playerId);
      if (i >= 0) s.exile.supporters.splice(i, 1);
      else s.exile.supporters.push(playerId);
    });
  }

  /**
   * Count the exile: at least half of all players in the game (rounded up) must support.
   * `force` = the Storyteller's verdict. An exiled Traveller dies (it is not an execution).
   */
  resolveExile(force?: "exile" | "spare"): { ok: boolean; exiled: boolean } {
    const ex = this.session.exile;
    if (!ex) return { ok: false, exiled: false };
    const threshold = exileThreshold(this.session);
    const supporters = ex.supporters.length;
    const exiled = force ? force === "exile" : supporters >= threshold;
    this.mutate((s) => {
      const t = s.players.find((p) => p.id === ex.travellerId);
      if (t && exiled) t.alive = false;
      s.publicLog.push({
        type: "exile",
        playerId: ex.travellerId,
        playerName: t?.name,
        supporters,
        threshold,
        exiled,
        dayNumber: Math.max(1, s.dayNumber || 1),
        at: Date.now(),
      });
      s.exile = null;
      pushStNotice(
        s,
        exiled
          ? `${t?.name ?? "The Traveller"} is exiled (${supporters}/${threshold}) and dies. Not an execution — the day's execution is still available.`
          : `${t?.name ?? "The Traveller"} is not exiled (${supporters}/${threshold}).`,
      );
    });
    if (exiled) this.checkStandingWin(0);
    return { ok: true, exiled };
  }

  cancelExile() {
    this.mutate((s) => {
      s.exile = null;
    });
  }

  /** Beggar: a dead player with an unused vote token hands it over; the Storyteller tells the Beggar their alignment. */
  giveVoteToken(beggarId: string, donorId: string): { ok: boolean; message?: string } {
    const s0 = this.session;
    const beggar = s0.players.find((p) => p.id === beggarId && !p.leftGame);
    const donor = s0.players.find((p) => p.id === donorId && !p.leftGame);
    const refused = !beggar || beggar.characterId !== "beggar"
      ? "Pick the Beggar."
      : !donor || donor.id === beggar.id
        ? "Pick the player giving their token."
        : donor.alive
          ? `${donor.name} is alive — only dead players give vote tokens.`
          : donor.usedGhostVote
            ? `${donor.name} has already used their vote token.`
            : null;
    if (refused) {
      this.mutate((s) => pushStNotice(s, `Vote token not given — ${refused}`));
      return { ok: false, message: refused };
    }
    const alignment = alignmentOf(this.script, donor!) ?? "unknown";
    this.mutate((s) => {
      const b = s.players.find((p) => p.id === beggarId)!;
      const d = s.players.find((p) => p.id === donorId)!;
      d.usedGhostVote = true;
      b.voteTokens = (b.voteTokens ?? 0) + 1;
      pushStNotice(s, `${d.name} gave their vote token to the Beggar (${b.name}). Tell the Beggar privately: ${d.name} is ${alignment}.`);
    });
    return { ok: true, message: `${donor!.name} is ${alignment}.` };
  }

  setTvSheet(on: boolean) {
    this.mutate((s) => {
      s.tvSheet = Boolean(on);
    });
  }

  startFirstNight() {
    this.cancelPendingWin();
    this.clearShotTimer();
    this.clearNightTimer();
    this.mutate(
      (s) => {
        s.phase = "firstNight";
        s.dayNumber = 0;
        s.winner = null;
        s.winReason = null;
        s.diedTonightIds = [];
        s.dawnDeathsAnnounced = false;
        s.executedTodayId = null;
        s.executionOccurredToday = false;
        s.newDemons = [];
        s.exile = null;
        // The Baron's +2 Outsiders is fixed at setup; it does not revert if the Baron dies or star-passes.
        s.baronInSetup = s.players.some((p) => p.characterId === "baron" && !p.leftGame);
        for (const p of s.players) {
          if (p.leftGame || p.characterId !== "drunk") continue;
          if (!p.thinksCharacterId) {
            pushStNotice(s, `${p.name} is the Drunk but has no "thinks they are" Townsfolk — set it in the Grimoire so they wake.`);
          } else if (
            s.players.some((x) => x.id !== p.id && !x.leftGame && trueCharacterId(this.script, x) === p.thinksCharacterId)
          ) {
            pushStNotice(s, `${p.name} (Drunk) thinks they are a Townsfolk that is in play — pick one not in play.`);
          }
        }
        resetDayNominations(s);
        const poisonCleared = clearNightScopedReminders(s);
        if (poisonCleared.length) {
          pushStNotice(
            s,
            poisonCleared.length === 1
              ? `Poison cleared (${poisonCleared[0]}).`
              : `Poison cleared (${poisonCleared.join(", ")}).`,
          );
        }
        s.night = {
          stepIndex: 0,
          steps: buildNightSteps(s, this.script, true),
          isFirstNight: true,
        };
      },
      { hue: "night", sound: pickSound("first_night", "dusk") },
    );
  }

  startNight() {
    if (this.endIfStandingWin()) return;
    this.clearNightTimer();
    const fromDusk = this.session.phase === "dusk";
    const endingDay = ["day", "dusk", "nomination", "vote", "execution"].includes(this.session.phase);
    // Mayor win at the end of the day: exactly 3 alive (travellers count), no execution today
    const mayor = mayorWinAtDusk(this.session);
    if (mayor) {
      this.mutate((s) => pushStNotice(s, `GAME OVER — Good wins. ${mayor.stReason}`));
      this.endGame("good", { reason: mayor.reason });
      return;
    }

    this.mutate(
      (s) => {
        s.phase = "night";
        s.diedTonightIds = [];
        s.dawnDeathsAnnounced = false;
        s.exile = null;
        s.newDemons = (s.newDemons ?? []).filter((d) => !d.duringNight);
        // Poison/Safe/Master/votes: survive the day after placement; clear here (next night), not at dawn
        const poisonCleared = clearNightScopedReminders(s);
        if (poisonCleared.length) {
          pushStNotice(
            s,
            poisonCleared.length === 1
              ? `Poison cleared (${poisonCleared[0]}).`
              : `Poison cleared (${poisonCleared.join(", ")}).`,
          );
        }
        s.night = {
          stepIndex: 0,
          steps: buildNightSteps(s, this.script, false),
          isFirstNight: false,
        };
        if (endingDay && !executionHappenedToday(s)) {
          const day = Math.max(1, s.dayNumber || 1);
          if (s.block?.nomineeId) {
            const name = s.players.find((p) => p.id === s.block?.nomineeId)?.name ?? "The block holder";
            pushStNotice(s, `Night started without an execution — ${name} was on the block and was not executed.`);
          }
          if (!s.publicLog.some((e) => e.type === "no_execution" && e.dayNumber === day)) {
            s.publicLog.push({ type: "no_execution", dayNumber: day, at: Date.now() });
          }
        }
        s.nomination = null;
        s.executionPendingId = null;
        s.nominationsOpen = false;
        s.nightPending = false;
        s.timer = null;
      },
      // Dusk already played its own line; a direct day → night jump keeps dusk takes in the pool.
      { hue: "night", sound: fromDusk ? pickSound("night") : pickSound("night", "dusk") },
    );
  }

  /**
   * Atomically place a night-choice reminder on the grimoire (Poisoned / Safe / Master / votes).
   * Exclusive marks clear the same token from every other player in one mutate/broadcast.
   */
  applyNightReminder(playerId: string, reminder: string): { ok: boolean; message?: string } {
    const label = String(reminder ?? "").trim();
    if (!label) return { ok: false };
    const s0 = this.session;
    const target = s0.players.find((x) => x.id === playerId);
    const step = s0.night?.steps[s0.night.stepIndex];
    // "(not yourself)": Monk → Safe, Butler → Master, Bureaucrat → 3 votes, Thief → Negative vote.
    const selfRule: Record<string, string> = { Safe: "monk", Master: "butler", "3 votes": "bureaucrat", "Negative vote": "thief" };
    const chooser = selfRule[label];
    const selfPick =
      target &&
      chooser &&
      ((step?.characterId === chooser && step.playerIds.includes(target.id)) ||
        (label === "Master" && target.characterId === "butler"));
    if (selfPick) {
      const name = findDef(this.script, chooser)?.name ?? chooser;
      const message = `The ${name} cannot choose themselves — pick another player.`;
      this.mutate((s) => pushStNotice(s, message));
      return { ok: false, message };
    }
    this.mutate((s) => {
      const p = s.players.find((x) => x.id === playerId);
      if (!p || p.leftGame) return;
      if (EXCLUSIVE_NIGHT_REMINDERS.includes(label)) {
        placeExclusiveReminder(s, playerId, label);
      } else {
        addReminder(p, label);
      }
    });
    return { ok: true };
  }

  clearStNotices() {
    this.mutate((s) => {
      s.stNotices = [];
    });
  }

  dismissStNotice(id: string) {
    this.mutate((s) => {
      s.stNotices = (s.stNotices ?? []).filter((n) => n.id !== id);
    });
  }

  rebuildNight() {
    this.mutate((s) => {
      const moved = rebuildNightInPlace(s, this.script);
      if (moved) pushStNotice(s, moved);
    });
  }

  nightNext() {
    this.mutate((s) => {
      if (!s.night) return;
      if (s.night.stepIndex < s.night.steps.length - 1) s.night.stepIndex += 1;
    });
  }

  nightPrev() {
    this.mutate((s) => {
      if (!s.night) return;
      if (s.night.stepIndex > 0) s.night.stepIndex -= 1;
    });
  }

  nightSkipToDawn() {
    this.goDawn();
  }

  markNightStepDone() {
    // For once-per-game first-night info roles, mark ability used when advancing past them
    this.mutate((s) => {
      if (!s.night) return;
      const step = s.night.steps[s.night.stepIndex];
      if (step?.id === "evil-traveller-info") {
        for (const id of step.playerIds) {
          const p = s.players.find((x) => x.id === id);
          if (p) p.learnedDemon = true;
        }
      }
      if (step?.characterId && !step.skipped && step.id.startsWith("char-")) {
        const def =
          this.script.characters.find((c) => c.id === step.characterId) ||
          this.script.travellers.find((c) => c.id === step.characterId);
        if (def?.oncePerGame && ((def.firstNight ?? 0) > 0 || (def.otherNight ?? 0) > 0)) {
          for (const id of step.playerIds) {
            const p = s.players.find((x) => x.id === id);
            if (p) {
              p.abilityUsed = true;
              if (!p.reminders.includes("No ability") && ["virgin", "slayer", "judge", "apprentice"].includes(def.id)) {
                p.reminders = [...p.reminders, "No ability"];
              }
            }
          }
        }
      }
      if (s.night.stepIndex < s.night.steps.length - 1) s.night.stepIndex += 1;
    });
  }

  goDawn() {
    if (this.flushPendingWin()) return;
    this.clearDawnThenDayTimer();
    this.mutate(
      (s) => {
        s.phase = "dawn";
        s.night = null;
        s.dawnDeathIds = [...s.diedTonightIds];
        s.dawnDeathsAnnounced = false;
        s.newDemons = [];
        clearDawnReminders(s);
      },
      { hue: "dawn", sound: pickSound("dawn", "atm_dawn_waiting", "atm_dawn_dread") },
    );
  }

  /**
   * Place grimoire info tokens after ST finishes a night show (WW / Lib / Inv / FT red herring).
   * Truth defaults from real characterIds; ST can still edit reminders on the grimoire.
   */
  applyInfoReminders(payload: {
    roleId?: string;
    playerIds?: string[];
    characterId?: string | null;
    zeroOutsiders?: boolean;
    redHerringPlayerId?: string | null;
  }): { ok: boolean; message?: string } {
    const roleId = String(payload.roleId ?? "");
    let message = "";
    let ok = true;

    this.mutate((s) => {
      if (roleId === "washerwoman") {
        message = placeInfoPairReminders(s, {
          positiveLabel: "Townsfolk",
          infoRoleLabel: "Washerwoman",
          playerIds: (payload.playerIds ?? []).map(String),
          shownCharacterId: payload.characterId ? String(payload.characterId) : null,
        });
      } else if (roleId === "librarian") {
        message = placeInfoPairReminders(s, {
          positiveLabel: "Outsider",
          infoRoleLabel: "Librarian",
          playerIds: (payload.playerIds ?? []).map(String),
          shownCharacterId: payload.characterId ? String(payload.characterId) : null,
          zeroOutsiders: Boolean(payload.zeroOutsiders),
        });
      } else if (roleId === "investigator") {
        message = placeInfoPairReminders(s, {
          positiveLabel: "Minion",
          infoRoleLabel: "Investigator",
          playerIds: (payload.playerIds ?? []).map(String),
          shownCharacterId: payload.characterId ? String(payload.characterId) : null,
        });
      } else if (roleId === "fortuneteller") {
        const herringId = payload.redHerringPlayerId
          ? String(payload.redHerringPlayerId)
          : null;
        if (!herringId) {
          message = "No Red herring player selected.";
          ok = false;
          return;
        }
        const p = s.players.find((x) => x.id === herringId);
        if (!p || p.leftGame) {
          message = "Red herring target not found.";
          ok = false;
          return;
        }
        const def = findDef(this.script, p.characterId);
        if (def && (def.team === "minion" || def.team === "demon")) {
          message = `${p.name} is evil — pick a good living player for Red herring.`;
          ok = false;
          return;
        }
        if (!p.alive) {
          message = `${p.name} is dead — pick a living good player for Red herring.`;
          ok = false;
          return;
        }
        placeExclusiveReminder(s, herringId, "Red herring");
        message = `Placed Red herring on ${p.name}.`;
      } else {
        message = "Unknown info role.";
        ok = false;
        return;
      }
      if (message) pushStNotice(s, message);
    });

    return { ok, message };
  }

  setDawnDeaths(playerIds: string[]) {
    this.mutate((s) => {
      // Living players (to kill at announce) or those already marked dead tonight.
      s.dawnDeathIds = playerIds.filter((id) =>
        s.players.some(
          (p) => p.id === id && !p.leftGame && (p.alive || s.diedTonightIds.includes(id)),
        ),
      );
    });
  }

  /** Apply overnight deaths and play the death (or no-deaths) cue. Returns the cue id played. */
  announceDawnDeaths(): string {
    // Preview who will actually be announced (protection may drop some still-alive names)
    const preview = this.session.dawnDeathIds.filter((id) => {
      const p = this.session.players.find((x) => x.id === id);
      if (!p || p.leftGame) return false;
      if (!p.alive) return true; // already marked dead overnight — still announce
      return !nightKillBlockReason(this.session, p);
    });
    const count = preview.length;
    const sound = dawnDeathSoundCue(count);

    this.mutate(
      (s) => {
        const kept: string[] = [];
        for (const id of [...s.dawnDeathIds]) {
          const p = s.players.find((x) => x.id === id);
          if (!p || p.leftGame) continue;
          if (p.alive) {
            const block = nightKillBlockReason(s, p);
            if (block) {
              pushStNotice(s, `Dawn: ${block}`);
              continue;
            }
            p.alive = false;
            for (const msg of resolveDemonDeath(s, this.script, id, {
              selfKill: false,
            })) {
              pushStNotice(s, msg);
            }
          }
          kept.push(id);
          if (!s.diedTonightIds.includes(id)) s.diedTonightIds.push(id);
        }
        s.dawnDeathIds = kept;
        s.dawnDeathsAnnounced = true;
        if (kept.length) {
          s.publicLog.push({
            type: "night_death",
            playerIds: kept,
            dayNumber: s.dayNumber,
            at: Date.now(),
          });
        }
      },
      {
        hue: count > 0 ? "death_settle" : "dawn",
        sound,
      },
    );
    const cue = resolveSoundCueId(sound);
    this.checkStandingWin(dawnDeathCueHoldMs(cue));
    return cue;
  }

  /**
   * Announce overnight deaths, wait for that cue to finish, then open the day
   * (Day 1 / Day N narration). Avoids playCue's stopSting cutting the death line.
   */
  announceDawnThenDay() {
    this.clearDawnThenDayTimer();
    const cue = this.announceDawnDeaths();
    if (this.pendingWin || this.session.phase === "ended") return;
    const holdMs = dawnDeathCueHoldMs(cue);
    this.dawnThenDayTimer = setTimeout(() => {
      this.dawnThenDayTimer = null;
      if (this.session.phase === "dawn") this.finishDawn();
    }, holdMs);
  }

  finishDawn() {
    this.clearDawnThenDayTimer();
    if (this.endIfStandingWin()) return;
    const nextDay = this.session.dayNumber === 0 ? 1 : this.session.dayNumber + 1;
    this.mutate(
      (s) => {
        // First night → Day 1; later nights → Day 2, 3, …
        s.dayNumber = nextDay;
        s.phase = "day";
        s.dawnDeathIds = [];
        s.dawnDeathsAnnounced = false;
        s.diedTonightIds = [];
        s.executedTodayId = null;
        s.executionOccurredToday = false;
        s.exile = null;
        s.night = null;
        s.nomination = null;
        s.executionPendingId = null;
        resetDayNominations(s);
      },
      { hue: "day", sound: daySoundCue(nextDay) },
    );
  }

  /** Enter day phase. From dawn this advances the day number (same as finishDawn). */
  goDay() {
    if (this.flushPendingWin()) return;
    if (this.session.phase === "dawn") {
      this.finishDawn();
      return;
    }
    const nextDay =
      this.session.phase === "lobby" && this.session.dayNumber === 0
        ? 1
        : Math.max(1, this.session.dayNumber || 1);
    this.mutate(
      (s) => {
        // Only bootstrap day 1 from lobby / pre-dawn first night — never skip dawn after a night
        if (s.phase === "lobby" && s.dayNumber === 0) {
          s.dayNumber = 1;
          resetDayNominations(s);
        }
        s.phase = "day";
        s.night = null;
        s.nomination = null;
        s.executionPendingId = null;
        s.nominationsOpen = false;
        s.nightPending = false;
      },
      { hue: "day", sound: daySoundCue(nextDay) },
    );
  }

  /**
   * One-tap story flow:
   * lobby → first night → dawn → day 1 → dusk → open nominations → close nominations → night → …
   */
  advancePhase() {
    const p = this.session.phase;
    if (p === "lobby" || p === "ended") {
      this.startFirstNight();
      return;
    }
    if (p === "firstNight" || p === "night") {
      this.goDawn();
      return;
    }
    if (p === "dawn") {
      this.finishDawn();
      return;
    }
    if (p === "day") {
      this.goDusk();
      return;
    }
    if (p === "dusk" && !this.session.nominationsOpen && !this.session.nightPending) {
      this.openNominations();
      return;
    }
    if (p === "dusk" || p === "nomination" || p === "vote" || p === "execution") {
      this.endDay();
      return;
    }
  }

  /** Close the open discussion: dusk falls (cue + chronicle line). Nominations open separately. */
  goDusk(): { ok: boolean; message?: string } {
    if (this.flushPendingWin()) return { ok: false, message: "The game is over." };
    const s0 = this.session;
    if (s0.phase === "dusk") return { ok: true };
    const blocked =
      s0.phase === "nomination" || s0.phase === "vote"
        ? "Resolve or cancel the open nomination before going to dusk."
        : s0.phase === "execution"
          ? "Confirm the pending execution (death or lives) first."
          : s0.phase !== "day"
            ? "Dusk follows the day — it is not day right now."
            : null;
    if (blocked) {
      this.mutate((s) => pushStNotice(s, blocked));
      return { ok: false, message: blocked };
    }
    if (this.endIfStandingWin()) return { ok: false, message: "The game is over." };
    this.mutate(
      (s) => {
        s.phase = "dusk";
        s.nomination = null;
        s.executionPendingId = null;
        s.timer = null;
        const day = Math.max(1, s.dayNumber || 1);
        if (!s.publicLog.some((e) => e.type === "dusk" && e.dayNumber === day)) {
          s.publicLog.push({ type: "dusk", dayNumber: day, at: Date.now() });
        }
      },
      { hue: "dawn", sound: pickSound("dusk") },
    );
    return { ok: true };
  }

  /** After the dusk announcement: the town may nominate (picker, votes, on-the-block). */
  openNominations(): { ok: boolean; message?: string } {
    if (this.flushPendingWin()) return { ok: false, message: "The game is over." };
    const s0 = this.session;
    if (s0.phase === "dusk" && s0.nominationsOpen) return { ok: true };
    const blocked =
      s0.phase === "day"
        ? "Go to dusk first — nominations open after the dusk announcement."
        : s0.phase !== "dusk"
          ? "Nominations open at dusk — it is not dusk right now."
          : s0.nightPending
            ? "The day is over — the night is starting."
            : null;
    if (blocked) {
      this.mutate((s) => pushStNotice(s, blocked));
      return { ok: false, message: blocked };
    }
    this.mutate(
      (s) => {
        s.nominationsOpen = true;
        const day = Math.max(1, s.dayNumber || 1);
        if (!s.publicLog.some((e) => e.type === "nominations_open" && e.dayNumber === day)) {
          s.publicLog.push({ type: "nominations_open", dayNumber: day, at: Date.now() });
        }
      },
      { hue: "nomination" },
    );
    return { ok: true };
  }

  /**
   * Close nominations (end of day). The block holder goes to the execution step (Confirm death /
   * Lives) and the night starts once that cue has played; with nobody on the block the night
   * starts now. Mayor / standing wins are checked by startNight.
   */
  endDay(): { ok: boolean; message?: string } {
    if (this.flushPendingWin()) return { ok: false, message: "The game is over." };
    const s0 = this.session;
    const blocked =
      s0.phase === "nomination" || s0.phase === "vote"
        ? "Resolve or cancel the open nomination before ending the day."
        : s0.phase === "execution"
          ? "Confirm the pending execution (death or lives) first."
          : s0.phase !== "day" && s0.phase !== "dusk"
            ? "It is not day right now."
            : null;
    if (blocked) {
      this.mutate((s) => pushStNotice(s, blocked));
      return { ok: false, message: blocked };
    }
    if (s0.nightPending) {
      this.startNight();
      return { ok: true };
    }
    if (this.endIfStandingWin()) return { ok: false, message: "The game is over." };

    const holderId = s0.block?.nomineeId ?? null;
    const holder = holderId ? s0.players.find((p) => p.id === holderId && !p.leftGame) : undefined;
    if (holder && !executionHappenedToday(s0)) {
      this.mutate(
        (s) => {
          s.phase = "execution";
          s.executionPendingId = holder.id;
          s.nominationsOpen = false;
          s.nightPending = true;
          s.timer = null;
        },
        { hue: "execution", sound: pickSound("about_to_die") },
      );
      return { ok: true };
    }
    if (holder && executionHappenedToday(s0)) {
      this.mutate((s) =>
        pushStNotice(s, `${holder.name} stays alive — someone was already executed today (one execution per day).`),
      );
    }
    this.startNight();
    return { ok: true };
  }

  /** Close the open nomination without a vote (mis-tap / wrong pair); frees both players again. */
  cancelNomination() {
    if (!this.session.nomination || !["nomination", "vote"].includes(this.session.phase)) return;
    this.mutate((s) => {
      const pair = s.nomination;
      const back = nominationReturnPhase(s);
      dropOpenNomination(s);
      s.nomination = null;
      s.timer = null;
      s.phase = back;
      const restore = pair?.virginRestore;
      const virgin = restore ? s.players.find((p) => p.id === restore.playerId) : undefined;
      if (restore && virgin) {
        virgin.abilityUsed = restore.abilityUsed;
        if (!restore.hadNoAbility) virgin.reminders = virgin.reminders.filter((r) => r !== "No ability");
      }
      if (pair) {
        const name = (id: string) => s.players.find((p) => p.id === id)?.name ?? id;
        pushStNotice(
          s,
          `Nomination cancelled (${name(pair.nominatorId)} → ${name(pair.nomineeId)}) — neither is used up.${virgin ? ` Virgin (${virgin.name}) keeps her ability.` : ""}`,
        );
      }
    });
  }

  startNomination(
    nominatorId: string,
    nomineeId: string,
    opts: { spyRegistersAsTownsfolk?: boolean; override?: boolean } = {},
  ): { ok: boolean; message?: string } {
    if (this.flushPendingWin()) return { ok: false, message: "The game is over." };
    const override = Boolean(opts.override);
    const nameOf = (id: string) => this.session.players.find((p) => p.id === id)?.name ?? id;
    const hard =
      nominationsClosedReason(this.session) ??
      (this.session.players.some((p) => p.id === nominatorId && !p.leftGame) ? null : "Nominator is not in the game.") ??
      (this.session.players.some((p) => p.id === nomineeId && !p.leftGame) ? null : "Nominee is not in the game.") ??
      travellerNomineeReason(this.session, nomineeId);
    const soft = override
      ? null
      : (notOpenReason(this.session) ??
        dayLimitReason(this.session) ??
        (nominatorReason(this.session, nominatorId) ? `${nameOf(nominatorId)}: ${nominatorReason(this.session, nominatorId)}.` : null) ??
        (nomineeReason(this.session, nomineeId) ? `${nameOf(nomineeId)}: ${nomineeReason(this.session, nomineeId)}.` : null));
    const refused = hard ?? soft;
    if (refused) {
      this.mutate((s) => pushStNotice(s, `Nomination not opened — ${refused}`));
      return { ok: false, message: refused };
    }
    const returnPhase: "day" | "dusk" = this.session.phase === "day" ? "day" : "dusk";
    const bypassed = override
      ? [
          notOpenReason(this.session),
          dayLimitReason(this.session),
          nominatorReason(this.session, nominatorId) && `${nameOf(nominatorId)}: ${nominatorReason(this.session, nominatorId)}`,
          nomineeReason(this.session, nomineeId) && `${nameOf(nomineeId)}: ${nomineeReason(this.session, nomineeId)}`,
        ].filter(Boolean)
      : [];
    const record = (outcome: DayNomination["outcome"]): DayNomination => ({
      nominatorId,
      nomineeId,
      votes: null,
      majority: null,
      outcome,
      ...(bypassed.length ? { override: true } : {}),
      at: Date.now(),
    });
    if (bypassed.length) {
      this.mutate((s) => pushStNotice(s, `Storyteller override: ${bypassed.join("; ")}.`));
    }

    const virgin = virginShouldTrigger(this.session, this.script, nominatorId, nomineeId, opts);
    const virginBefore = this.session.players.find((p) => p.id === nomineeId);
    const virginRestore =
      virgin.spend && !virgin.trigger && virginBefore
        ? {
            playerId: nomineeId,
            abilityUsed: virginBefore.abilityUsed,
            hadNoAbility: virginBefore.reminders.includes("No ability"),
          }
        : undefined;
    if (virgin.reason || (virgin.spend && !virgin.trigger)) {
      this.mutate((s) => {
        if (virgin.reason) pushStNotice(s, virgin.reason);
        if (virgin.spend && !virgin.trigger) {
          const v = s.players.find((p) => p.id === nomineeId);
          if (v) {
            v.abilityUsed = true;
            if (!v.reminders.includes("No ability")) v.reminders = [...v.reminders, "No ability"];
          }
        }
      });
    }

    if (virgin.trigger) {
      this.mutate(
        (s) => {
          const nominator = s.players.find((p) => p.id === nominatorId);
          const nominee = s.players.find((p) => p.id === nomineeId);
          if (nominator) nominator.alive = false;
          if (nominee) {
            nominee.abilityUsed = true;
            if (!nominee.reminders.includes("No ability")) {
              nominee.reminders = [...nominee.reminders, "No ability"];
            }
          }
          s.executedTodayId = nominatorId;
          s.executionOccurredToday = true;
          if (nominator) placeExclusiveReminder(s, nominatorId, "Died today");
          s.phase = returnPhase;
          s.nomination = null;
          s.executionPendingId = null;
          s.nominationsToday.push(record("virgin"));
          // The Virgin's execution is today's execution — nobody else can die at the end of the day.
          s.block = null;
          s.publicLog.push({
            type: "nomination",
            nominatorId,
            nomineeId,
            at: Date.now(),
          });
          s.publicLog.push({
            type: "execution",
            playerId: nominatorId,
            died: true,
            dayNumber: Math.max(1, s.dayNumber || 1),
            at: Date.now(),
          });
          pushStNotice(
            s,
            `Virgin: ${nominator?.name ?? "Nominator"} (Townsfolk) executed for nominating ${nominee?.name ?? "Virgin"}. Ability marked used.`,
          );
        },
        { hue: "execution", sound: pickSound("execution", "death") },
      );
      this.checkStandingWin(EXECUTION_CUE_HOLD_MS);
      return { ok: true, message: "Virgin: the nominator was executed." };
    }

    this.mutate(
      (s) => {
        s.phase = "nomination";
        s.nomination = {
          nominatorId,
          nomineeId,
          votesFor: [],
          returnPhase,
          ...(virginRestore ? { virginRestore } : {}),
        };
        s.executionPendingId = null;
        s.nominationsToday.push(record(null));
        s.publicLog.push({
          type: "nomination",
          nominatorId,
          nomineeId,
          at: Date.now(),
        });
      },
      { hue: "nomination", sound: pickSound("nomination", "atm_nominate_tension") },
    );
    return { ok: true };
  }

  startVote(seconds = 30) {
    if (this.flushPendingWin()) return;
    this.mutate(
      (s) => {
        if (!s.nomination) return;
        s.phase = "vote";
        s.timer = { endsAt: Date.now() + seconds * 1000, label: "Vote" };
      },
      { hue: "nomination", sound: pickSound("vote_open", "atm_hands_ready", "atm_silence_for_vote") },
    );
  }

  toggleVote(playerId: string) {
    this.mutate((s) => {
      if (!s.nomination) return;
      const p = s.players.find((x) => x.id === playerId);
      if (!p || p.leftGame) return;
      const idx = s.nomination.votesFor.indexOf(playerId);
      if (idx >= 0) {
        // Always allow cancel while nomination is open — even for dead players who
        // raised a ghost hand (usedGhostVote is only consumed on resolveVote).
        s.nomination.votesFor.splice(idx, 1);
        if (!p.alive) p.usedGhostVote = false;
        // The Butler's hand is never lowered for them: an illegal Butler vote is the Butler's
        // mistake and still counts (the Storyteller sees a private warning).
      } else {
        if (!canPlayerVote(p)) return;
        if (p.alive && p.characterId === "beggar" && (p.voteTokens ?? 0) < 1) {
          pushStNotice(s, `Beggar (${p.name}) has no vote token — a dead player must give them one first.`);
          return;
        }
        s.nomination.votesFor.push(playerId);
        // Do not spend ghost vote until resolve — hand can still be lowered.
      }
    });
  }

  /**
   * Close the vote and update the block. Nobody dies here — the block holder is executed at the
   * end of the day. `outcome` is the Storyteller's manual verdict (force onto block / tie / fail).
   */
  resolveVote(outcome?: "majority" | "no_majority" | "tie") {
    if (!this.session.nomination) return;
    const votes = effectiveVoteCount(this.session);
    const maj = majorityNeeded(this.session);
    const { outcome: result, block } = applyVoteToBlock(
      this.session.block,
      this.session.nomination.nomineeId,
      votes,
      maj,
      outcome,
    );
    const sound =
      result === "majority"
        ? pickSound("majority")
        : result === "tie"
          ? pickSound("tie")
          : pickSound("no_majority", "lives");
    const back = nominationReturnPhase(this.session);
    const hue: HueScene = result === "majority" ? "nomination" : back === "dusk" ? "dawn" : "day";

    this.mutate(
      (s) => {
        if (!s.nomination) return;
        const butlerWarning = butlerVoteWarning(s, s.nomination.votesFor);
        if (butlerWarning) pushStNotice(s, butlerWarning);
        // Consume ghost votes (dead Travellers too) and Beggar tokens for hands up at resolve.
        for (const id of s.nomination.votesFor) {
          const voter = s.players.find((x) => x.id === id);
          if (!voter) continue;
          if (!voter.alive) voter.usedGhostVote = true;
          else if (voter.characterId === "beggar") voter.voteTokens = Math.max(0, (voter.voteTokens ?? 0) - 1);
        }
        const rec = openNominationRecord(s);
        if (rec) {
          rec.votes = votes;
          rec.majority = maj;
          rec.outcome = result;
        }
        s.publicLog.push({
          type: "vote_result",
          nomineeId: s.nomination.nomineeId,
          votesFor: votes,
          majority: maj,
          outcome: result,
          at: Date.now(),
        });
        s.block = block;
        s.timer = null;
        s.phase = back;
        s.nomination = null;
        s.executionPendingId = null;
      },
      { sound, hue },
    );
  }

  /**
   * The day's execution. `died` = Confirm death vs Lives (both count as the execution).
   * `substituteId` = a Scapegoat executed instead (Storyteller's choice).
   * Executing an already-dead player counts as the execution but nobody dies — no Saint win,
   * no Demon death, no "Died today" (the Undertaker learns nothing).
   */
  confirmExecution(died: boolean, opts: { substituteId?: string | null } = {}) {
    let saintWin: WinResult | null = null;
    let demonId: string | null = null;
    let killed = false;
    const toNight = this.session.nightPending;
    const s0 = this.session;
    const pendingId = s0.executionPendingId ?? s0.nomination?.nomineeId ?? null;
    const sub = opts.substituteId
      ? s0.players.find((p) => p.id === opts.substituteId && p.characterId === "scapegoat" && p.alive && !p.leftGame)
      : undefined;
    const targetId = sub?.id ?? pendingId;
    const target = targetId ? s0.players.find((x) => x.id === targetId) : undefined;
    const alreadyDead = Boolean(target && died && !target.alive);

    this.mutate(
      (s) => {
        const id = targetId;
        if (!id) return;
        const p = s.players.find((x) => x.id === id);
        if (sub) {
          const orig = s.players.find((x) => x.id === pendingId);
          pushStNotice(s, `Scapegoat (${sub.name}) is executed instead of ${orig?.name ?? "the nominee"}.`);
        }
        if (p && died && p.alive) {
          p.alive = false;
          killed = true;
          s.executedTodayId = id;
          placeExclusiveReminder(s, id, "Died today");
          saintWin = saintExecutedWin(s, id);
          const def = findDef(this.script, p.characterId);
          if (def?.team === "demon") demonId = id;
        } else if (p && alreadyDead) {
          pushStNotice(s, `${p.name} was already dead — the execution counts, but nobody dies (no Saint / Demon effects).`);
        } else if (p && !died && p.characterId === "saint") {
          pushStNotice(s, "Saint lived through execution — no Saint evil-win.");
        }
        s.executionOccurredToday = true;
        s.publicLog.push({
          type: "execution",
          playerId: id,
          died: killed,
          ...(alreadyDead ? { alreadyDead: true } : {}),
          dayNumber: Math.max(1, s.dayNumber || 1),
          at: Date.now(),
        });
        // End-of-day execution: back on the dusk screen (nominations closed) until the night starts.
        s.phase = toNight ? "dusk" : "day";
        s.nightPending = toNight;
        s.nomination = null;
        s.executionPendingId = null;
        s.timer = null;

        if (demonId) {
          for (const msg of resolveDemonDeath(s, this.script, demonId, {
            selfKill: false,
          })) {
            pushStNotice(s, msg);
          }
        }
      },
      {
        hue: died && !alreadyDead ? "execution" : toNight ? "dawn" : "day",
        sound: died && !alreadyDead ? pickSound("execution", "death") : pickSound("lives", "no_majority"),
      },
    );
    if (killed) {
      setTimeout(() => {
        void this.hue.applyScene("death_settle");
      }, 2500);
    }
    if (saintWin) {
      this.scheduleWin(saintWin, EXECUTION_CUE_HOLD_MS, pickSound("sacred_blood", "evil_wins"));
    } else if (killed) {
      this.checkStandingWin(EXECUTION_CUE_HOLD_MS);
    }
    if (toNight && !this.pendingWin && this.session.phase === "dusk") {
      const mayor = mayorWinAtDusk(this.session);
      if (mayor) {
        this.scheduleWin(mayor, EXECUTION_CUE_HOLD_MS);
        return;
      }
      // Let the execution line finish before the night narration (playCue cuts the sting).
      this.clearNightTimer();
      this.nightTimer = setTimeout(() => {
        this.nightTimer = null;
        if (this.session.phase !== "dusk" || !this.session.nightPending || this.pendingWin) return;
        this.startNight();
      }, EXECUTION_CUE_HOLD_MS);
    }
  }

  /** The Imp making tonight's kill: the current Imp wake step's player, else the living Imp. */
  private actingImp() {
    const s = this.session;
    const step = s.night?.steps[s.night.stepIndex];
    const isImp = (p: { characterId: string | null; leftGame: boolean }) =>
      p.characterId === "imp" && !p.leftGame;
    const fromStep =
      step?.characterId === "imp"
        ? s.players.find((p) => step.playerIds.includes(p.id) && isImp(p))
        : undefined;
    return fromStep ?? s.players.find((p) => p.alive && isImp(p));
  }

  /**
   * `blocked` = the kill was chosen but fails (Poisoned/Drunk Imp, Soldier, Monk Safe):
   * recorded for the ST, nobody dies, nothing reaches the TV. The night step may still advance.
   */
  otherDeath(
    playerId: string,
    reason: string,
    opts: { starPassTo?: string | null } = {},
  ): {
    ok: boolean;
    blocked: boolean;
    message?: string;
    needsStarPassChoice?: boolean;
    candidates?: { id: string; name: string; characterId: string | null }[];
  } {
    const overnight = isOvernightPhase(this.session.phase);
    const target = this.session.players.find((x) => x.id === playerId);
    if (!target || !target.alive) return { ok: false, blocked: false };

    if (overnight) {
      const demonKill = /imp|demon|star.?pass/i.test(reason);
      const block =
        (demonKill ? impKillFailReason(this.actingImp(), target) : null) ??
        nightKillBlockReason(this.session, target);
      if (block) {
        const who = demonKill ? "Imp chose" : "Kill on";
        const message = `${who} ${block}`;
        this.mutate((s) => pushStNotice(s, message));
        return { ok: true, blocked: true, message };
      }
      // Imp self-kill: the Storyteller picks the new Imp (a healthy Scarlet Woman must take it).
      if (demonKill && target.characterId === "imp") {
        const { forced, candidates } = starPassCandidates(this.session, this.script, target);
        const chosen = opts.starPassTo ? candidates.find((c) => c.id === opts.starPassTo) : undefined;
        if (!forced && candidates.length > 1 && !chosen) {
          return {
            ok: false,
            blocked: false,
            needsStarPassChoice: true,
            message: "Star-pass: choose which Minion becomes the Imp.",
            candidates: candidates.map((c) => ({ id: c.id, name: c.name, characterId: c.characterId })),
          };
        }
      }
    }

    let addedNightDeath = false;
    this.mutate(
      (s) => {
        const p = s.players.find((x) => x.id === playerId);
        if (!p || !p.alive) return;

        const wasDemon = findDef(this.script, p.characterId)?.team === "demon";
        const selfKill =
          overnight &&
          (reason === "Demon" || /imp|demon|star.?pass/i.test(reason)) &&
          p.characterId === "imp";

        p.alive = false;
        if (overnight) {
          if (!s.diedTonightIds.includes(playerId)) {
            s.diedTonightIds.push(playerId);
            addedNightDeath = true;
          }
        }
        // Keep reason in session for ST selfKill heuristics / history; TV never shows it.
        s.publicLog.push({
          type: "other_death",
          playerId,
          reason: reason.slice(0, 80) || "Died",
          dayNumber: overnight
            ? s.dayNumber
            : Math.max(1, s.dayNumber || 1),
          duringNight: overnight,
          at: Date.now(),
        });

        if (wasDemon) {
          for (const msg of resolveDemonDeath(s, this.script, playerId, {
            selfKill: !!selfKill,
            starPassTo: opts.starPassTo ?? null,
          })) {
            pushStNotice(s, msg);
          }
        }
      },
      // Overnight deaths are secret until dawn — the lights must not react to them.
      overnight ? undefined : { hue: "death_settle", sound: pickSound("death") },
    );

    // Ravenkeeper (and any death-gated wakes), a new Imp's wake, and "died tonight" skips were
    // built before this death — rebuild the rest of the night without losing our place.
    if (overnight && addedNightDeath && this.session.night) {
      this.rebuildNight();
    }

    if (overnight) {
      // Night deaths stay private until dawn; the win is declared when they are announced.
      const win = standingWin(this.session, this.script);
      if (win) {
        this.mutate((s) =>
          pushStNotice(
            s,
            `At dawn: ${win.winner === "good" ? "Good" : "Evil"} wins — ${win.stReason} Declared when dawn deaths are announced.`,
          ),
        );
      }
    } else {
      this.checkStandingWin(EXECUTION_CUE_HOLD_MS);
    }

    return { ok: true, blocked: false };
  }

  /**
   * Slayer's public shot: shot cue, then hit/miss cue, then the win if the Demon died.
   * A non-ending hit plays a plain death cue so a Scarlet Woman takeover is not revealed.
   */
  slayerShot(
    shooterId: string,
    targetId: string,
    opts: { recluseRegistersAsDemon?: boolean } = {},
  ): { ok: boolean; hit: boolean; message: string } {
    if (this.session.phase === "ended" || this.pendingWin) {
      return { ok: false, hit: false, message: "The game is already over." };
    }
    if (!["day", "dusk", "nomination", "vote", "execution"].includes(this.session.phase)) {
      return { ok: false, hit: false, message: "The Slayer can only shoot during the day." };
    }
    const outcome = slayerShotOutcome(this.session, this.script, shooterId, targetId, opts);
    this.clearShotTimer();

    this.mutate(
      (s) => {
        const shooter = s.players.find((p) => p.id === shooterId);
        const target = s.players.find((p) => p.id === targetId);
        if (outcome.spend && shooter) {
          shooter.abilityUsed = true;
          if (!shooter.reminders.includes("No ability")) {
            shooter.reminders = [...shooter.reminders, "No ability"];
          }
        }
        pushStNotice(s, outcome.reason);
        if (!outcome.hit || !target) return;
        const wasDemon = findDef(this.script, target.characterId)?.team === "demon";
        target.alive = false;
        s.publicLog.push({
          type: "other_death",
          playerId: target.id,
          reason: "Slayer",
          dayNumber: Math.max(1, s.dayNumber || 1),
          duringNight: false,
          at: Date.now(),
        });
        if (wasDemon) {
          for (const msg of resolveDemonDeath(s, this.script, target.id, { selfKill: false })) {
            pushStNotice(s, msg);
          }
        }
      },
      { sound: pickSound("public_shot") },
    );

    const win = outcome.hit ? standingWin(this.session, this.script) : null;
    const resultCue = !outcome.hit
      ? pickSound("public_shot_false")
      : win?.winner === "good"
        ? pickSound("public_shot_true")
        : pickSound("death");
    this.shotTimer = setTimeout(() => {
      this.shotTimer = null;
      if (this.session.phase === "ended") return;
      this.mutate(() => {}, {
        sound: resultCue,
        hue: outcome.hit ? "death_settle" : undefined,
      });
    }, SHOT_CUE_HOLD_MS);
    if (win) this.scheduleWin(win, SHOT_CUE_HOLD_MS + SHOT_RESULT_HOLD_MS);

    return { ok: true, hit: outcome.hit, message: outcome.reason };
  }

  startTimer(seconds: number, label: string) {
    this.mutate((s) => {
      s.timer = { endsAt: Date.now() + seconds * 1000, label };
    });
  }

  cancelTimer() {
    this.mutate((s) => {
      s.timer = null;
    });
  }

  timerEnded() {
    this.mutate((s) => {
      s.timer = null;
    }, { sound: pickSound("timer_end"), hue: "vote_urgency" });
  }

  scene(scene: "day" | "night" | "hush") {
    const map = {
      day: { hue: "day" as HueScene, sound: "day_bed" },
      night: { hue: "night" as HueScene, sound: "night_bed" },
      hush: { hue: "hush" as HueScene, sound: "hush" },
    };
    const m = map[scene];
    this.mutate(() => {}, { hue: m.hue, sound: m.sound });
  }

  endGame(
    winner: "good" | "evil" | null = null,
    opts: { reason?: string | null; sound?: string } = {},
  ) {
    this.cancelPendingWin();
    this.clearShotTimer();
    this.clearDawnThenDayTimer();
    this.clearNightTimer();
    const sound =
      opts.sound ??
      (winner === "good"
        ? pickSound("good_wins", "atm_after_good")
        : winner === "evil"
          ? pickSound("evil_wins", "atm_after_evil")
          : pickSound("reveal", "atm_before_reveal"));
    this.mutate(
      (s) => {
        s.phase = "ended";
        s.winner = winner;
        s.winReason = opts.reason ?? null;
        s.timer = null;
        s.night = null;
        s.nomination = null;
      },
      { hue: "hush", sound },
    );
  }

  setPhase(phase: Phase) {
    if (phase === "firstNight") this.startFirstNight();
    else if (phase === "night") this.startNight();
    else if (phase === "dawn") this.goDawn();
    else if (phase === "day") this.goDay();
    else if (phase === "dusk") this.goDusk();
    else if (phase === "ended") this.endGame();
    else this.mutate((s) => {
      s.phase = phase;
    });
  }
}

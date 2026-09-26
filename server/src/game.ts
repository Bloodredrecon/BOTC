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
  butlerCanRaiseHand,
  effectiveVoteCount,
  findDef,
  isOvernightPhase,
  livingButler,
  mayorWinAtDusk,
  masterPlayer,
  nightKillBlockReason,
  pushStNotice,
  resolveDemonDeath,
  saintEvilWin,
  virginShouldTrigger,
} from "./rules.js";
import type {
  GameSession,
  HueScene,
  Phase,
  PublicState,
  StorytellerState,
} from "./types.js";

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

  mutate(fn: (s: GameSession) => void, opts?: { sound?: string | null; hue?: HueScene }) {
    fn(this.session);
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

  setPlayerCount(count: number) {
    const n = Math.max(5, Math.min(20, Math.floor(count)));
    this.mutate((s) => {
      const travellers = s.players.filter((p) => p.isTraveller && !p.leftGame);
      const existing = s.players.filter((p) => !p.isTraveller);
      const townsfolk = Array.from({ length: n }, (_, i) => {
        const prev = existing[i];
        if (prev) return normalizePlayer({ ...prev, seat: i + 1, isTraveller: false });
        return normalizePlayer({
          id: `p${i + 1}`,
          seat: i + 1,
          name: `Player ${i + 1}`,
        });
      });
      const travellerSeats = travellers.map((t, i) =>
        normalizePlayer({ ...t, seat: n + i + 1 }),
      );
      s.players = [...townsfolk, ...travellerSeats];
    });
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
    }>,
  ) {
    let rebuildNight = false;
    this.mutate((s) => {
      const p = s.players.find((x) => x.id === playerId);
      if (!p) return;
      if (patch.name !== undefined) p.name = patch.name.slice(0, 32);
      if (patch.characterId !== undefined) {
        if (p.characterId !== patch.characterId) rebuildNight = true;
        p.characterId = patch.characterId;
        const trav = this.script.travellers.some((t) => t.id === patch.characterId);
        if (trav) p.isTraveller = true;
      }
      if (patch.reminders !== undefined) p.reminders = patch.reminders;
      if (patch.notes !== undefined) p.notes = patch.notes;
      if (patch.bluffs !== undefined) p.bluffs = patch.bluffs;
      if (patch.alive !== undefined) {
        p.alive = patch.alive;
        if (patch.alive) p.usedGhostVote = false;
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
    });
    // Night order is built from roles in play — rebuild when a role is set mid-night
    if (rebuildNight && (this.session.phase === "night" || this.session.phase === "firstNight")) {
      this.rebuildNight();
    }
  }

  setFabled(ids: string[]) {
    this.mutate((s) => {
      s.fabled = ids.filter((id) => this.script.fabled.some((f) => f.id === id));
    });
  }

  addTraveller(name: string, characterId: string) {
    const def = this.script.travellers.find((t) => t.id === characterId);
    if (!def) return;
    this.mutate(
      (s) => {
        const seat = s.players.length + 1;
        const id = `t${Date.now()}`;
        const playerName = name.slice(0, 32) || def.name;
        s.players.push(
          normalizePlayer({
            id,
            seat,
            name: playerName,
            characterId,
            isTraveller: true,
          }),
        );
        s.publicLog.push({
          type: "traveller_join",
          playerId: id,
          playerName,
          characterId,
          at: Date.now(),
        });
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
          s.nomination = null;
          s.phase = "day";
        }
      },
      { sound: pickSound("guest_depart") },
    );
  }

  startFirstNight() {
    this.mutate(
      (s) => {
        s.phase = "firstNight";
        s.dayNumber = 0;
        s.diedTonightIds = [];
        s.dawnDeathsAnnounced = false;
        s.executedTodayId = null;
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
    // Mayor win at dusk: 3 living non-travellers, no execution today
    const mayor = mayorWinAtDusk(this.session);
    if (mayor?.win) {
      this.mutate((s) => {
        pushStNotice(s, mayor.reason);
      });
      this.endGame("good");
      return;
    }

    this.mutate(
      (s) => {
        s.phase = "night";
        s.diedTonightIds = [];
        s.dawnDeathsAnnounced = false;
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
        s.nomination = null;
        s.executionPendingId = null;
      },
      { hue: "night", sound: pickSound("night", "dusk") },
    );
  }

  /**
   * Atomically place a night-choice reminder on the grimoire (Poisoned / Safe / Master / votes).
   * Exclusive marks clear the same token from every other player in one mutate/broadcast.
   */
  applyNightReminder(playerId: string, reminder: string) {
    const label = String(reminder ?? "").trim();
    if (!label) return;
    this.mutate((s) => {
      const p = s.players.find((x) => x.id === playerId);
      if (!p || p.leftGame) return;
      if (EXCLUSIVE_NIGHT_REMINDERS.includes(label)) {
        placeExclusiveReminder(s, playerId, label);
      } else {
        addReminder(p, label);
      }
    });
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
      if (!s.night) return;
      const idx = s.night.stepIndex;
      const isFirst = s.night.isFirstNight;
      s.night = {
        stepIndex: Math.min(idx, 0),
        steps: buildNightSteps(s, this.script, isFirst),
        isFirstNight: isFirst,
      };
      // keep position if possible
      s.night.stepIndex = Math.min(idx, s.night.steps.length - 1);
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
      if (step?.characterId && !step.skipped) {
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
    this.clearDawnThenDayTimer();
    this.mutate(
      (s) => {
        s.phase = "dawn";
        s.night = null;
        s.dawnDeathIds = [...s.diedTonightIds];
        s.dawnDeathsAnnounced = false;
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
      s.dawnDeathIds = playerIds.filter((id) =>
        s.players.some((p) => p.id === id && p.alive && !p.leftGame),
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
              pushStNotice(s, `Dawn: skipped ${p.name} — ${block}`);
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
    return resolveSoundCueId(sound);
  }

  /**
   * Announce overnight deaths, wait for that cue to finish, then open the day
   * (Day 1 / Day N narration). Avoids playCue's stopSting cutting the death line.
   */
  announceDawnThenDay() {
    this.clearDawnThenDayTimer();
    const cue = this.announceDawnDeaths();
    const holdMs = dawnDeathCueHoldMs(cue);
    this.dawnThenDayTimer = setTimeout(() => {
      this.dawnThenDayTimer = null;
      if (this.session.phase === "dawn") this.finishDawn();
    }, holdMs);
  }

  finishDawn() {
    this.clearDawnThenDayTimer();
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
        s.night = null;
        s.nomination = null;
        s.executionPendingId = null;
      },
      { hue: "day", sound: daySoundCue(nextDay) },
    );
  }

  /** Enter day phase. From dawn this advances the day number (same as finishDawn). */
  goDay() {
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
        if (s.phase === "lobby" && s.dayNumber === 0) s.dayNumber = 1;
        s.phase = "day";
        s.night = null;
        s.nomination = null;
        s.executionPendingId = null;
      },
      { hue: "day", sound: daySoundCue(nextDay) },
    );
  }

  /**
   * One-tap story flow:
   * lobby → first night → dawn → day 1 → night → dawn → day 2 → …
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
    if (p === "day" || p === "nomination" || p === "vote" || p === "execution") {
      this.startNight();
      return;
    }
  }

  startNomination(nominatorId: string, nomineeId: string) {
    const virgin = virginShouldTrigger(this.session, this.script, nominatorId, nomineeId);
    if (virgin.reason) {
      this.mutate((s) => pushStNotice(s, virgin.reason!));
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
          if (nominator) placeExclusiveReminder(s, nominatorId, "Died today");
          s.phase = "day";
          s.nomination = null;
          s.executionPendingId = null;
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
      return;
    }

    this.mutate(
      (s) => {
        s.phase = "nomination";
        s.nomination = { nominatorId, nomineeId, votesFor: [] };
        s.executionPendingId = null;
        s.publicLog.push({
          type: "nomination",
          nominatorId,
          nomineeId,
          at: Date.now(),
        });
      },
      { hue: "nomination", sound: pickSound("nomination", "atm_nominate_tension") },
    );
  }

  startVote(seconds = 30) {
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
        // Drop Butler if Master lowers their hand
        const master = masterPlayer(s);
        const butler = livingButler(s);
        if (master && master.id === playerId && butler) {
          const bIdx = s.nomination.votesFor.indexOf(butler.id);
          if (bIdx >= 0) {
            s.nomination.votesFor.splice(bIdx, 1);
            pushStNotice(s, `Butler (${butler.name}) hand lowered — Master stopped voting.`);
          }
        }
      } else {
        if (!canPlayerVote(p)) return;
        const butlerCheck = butlerCanRaiseHand(s, playerId, s.nomination.votesFor);
        if (!butlerCheck.ok) {
          pushStNotice(s, butlerCheck.reason || "Butler cannot vote.");
          return;
        }
        s.nomination.votesFor.push(playerId);
        // Do not spend ghost vote until resolve — hand can still be lowered.
      }
    });
  }

  resolveVote(outcome?: "majority" | "no_majority" | "tie") {
    if (!this.session.nomination) return;
    const votes = effectiveVoteCount(this.session);
    const maj = majorityNeeded(this.session);
    const result = outcome ?? (votes >= maj ? "majority" : "no_majority");
    const sound =
      result === "majority"
        ? pickSound("majority", "about_to_die")
        : result === "tie"
          ? pickSound("tie")
          : pickSound("no_majority", "lives");
    const hue: HueScene = result === "majority" ? "execution" : "day";

    this.mutate(
      (s) => {
        if (!s.nomination) return;
        // Consume ghost votes for dead players whose hands stayed up through resolve.
        for (const id of s.nomination.votesFor) {
          const voter = s.players.find((x) => x.id === id);
          if (voter && !voter.alive && !voter.isTraveller) voter.usedGhostVote = true;
        }
        const tally = effectiveVoteCount(s);
        s.publicLog.push({
          type: "vote_result",
          nomineeId: s.nomination.nomineeId,
          votesFor: tally,
          majority: majorityNeeded(s),
          outcome: result,
          at: Date.now(),
        });
        s.timer = null;
        if (result === "majority") {
          s.phase = "execution";
          s.executionPendingId = s.nomination.nomineeId;
        } else {
          s.phase = "day";
          s.nomination = null;
          s.executionPendingId = null;
        }
      },
      { sound, hue },
    );
  }

  confirmExecution(died: boolean) {
    let saintWin = false;
    let demonId: string | null = null;

    this.mutate(
      (s) => {
        const id = s.executionPendingId ?? s.nomination?.nomineeId;
        if (!id) return;
        const p = s.players.find((x) => x.id === id);
        if (p && died) {
          p.alive = false;
          s.executedTodayId = id;
          placeExclusiveReminder(s, id, "Died today");
          if (saintEvilWin(s, id)) {
            saintWin = true;
            pushStNotice(s, `Saint (${p.name}) executed — Evil wins.`);
          }
          const def = findDef(this.script, p.characterId);
          if (def?.team === "demon") demonId = id;
        } else if (p && !died && p.characterId === "saint") {
          pushStNotice(s, "Saint lived through execution — no Saint evil-win.");
        }
        s.publicLog.push({
          type: "execution",
          playerId: id,
          died,
          dayNumber: Math.max(1, s.dayNumber || 1),
          at: Date.now(),
        });
        s.phase = "day";
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
        hue: died ? "execution" : "day",
        sound: died ? pickSound("execution", "death") : pickSound("lives", "no_majority"),
      },
    );
    if (died) {
      setTimeout(() => {
        void this.hue.applyScene("death_settle");
      }, 2500);
    }
    if (saintWin) {
      this.endGame("evil");
    }
  }

  otherDeath(playerId: string, reason: string): { ok: boolean; blocked: boolean } {
    const overnight = isOvernightPhase(this.session.phase);
    const target = this.session.players.find((x) => x.id === playerId);
    if (!target || !target.alive) return { ok: false, blocked: false };

    if (overnight) {
      const block = nightKillBlockReason(this.session, target);
      if (block) {
        this.mutate((s) => pushStNotice(s, block));
        return { ok: false, blocked: true };
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
          })) {
            pushStNotice(s, msg);
          }
        }
      },
      overnight
        ? { hue: "death_settle" }
        : { hue: "death_settle", sound: pickSound("death") },
    );

    // Ravenkeeper (and any death-gated wakes) were built before the Imp kill —
    // rebuild so they un-skip and can wake later tonight.
    if (overnight && addedNightDeath && this.session.night) {
      this.rebuildNight();
    }

    return { ok: true, blocked: false };
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

  endGame(winner: "good" | "evil" | null = null) {
    const sound =
      winner === "good"
        ? pickSound("good_wins", "atm_after_good")
        : winner === "evil"
          ? pickSound("evil_wins", "atm_after_evil")
          : pickSound("reveal", "atm_before_reveal");
    this.mutate(
      (s) => {
        s.phase = "ended";
        s.winner = winner;
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
    else if (phase === "ended") this.endGame();
    else this.mutate((s) => {
      s.phase = phase;
    });
  }
}

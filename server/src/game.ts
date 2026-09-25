import type { HueDriver } from "./hue.js";
import { buildNightSteps } from "./night.js";
import type { ScriptData } from "./persistence.js";
import { createEmptySession, saveSession } from "./persistence.js";
import {
  canPlayerVote,
  majorityNeeded,
  toPublicState,
  toStorytellerState,
} from "./projection.js";
import type {
  GameSession,
  HueScene,
  Phase,
  PublicState,
  SoundCue,
  StorytellerState,
} from "./types.js";

export type BroadcastFn = (payload: {
  public: PublicState;
  storyteller: StorytellerState;
}) => void;

export class GameEngine {
  session: GameSession;
  private lastSound: SoundCue = null;
  private lastHue: HueScene = null;
  private seq = 0;

  constructor(
    session: GameSession,
    private script: ScriptData,
    private hue: HueDriver,
    private broadcast: BroadcastFn,
  ) {
    this.session = session;
  }

  mutate(fn: (s: GameSession) => void, opts?: { sound?: SoundCue; hue?: HueScene }) {
    fn(this.session);
    if (opts?.sound !== undefined) this.lastSound = opts.sound;
    if (opts?.hue !== undefined) {
      this.lastHue = opts.hue;
      if (opts.hue) void this.hue.applyScene(opts.hue);
    }
    saveSession(this.session);
    this.emit();
    // clear one-shot cues after emit so reconnects don't replay
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

  resetGame() {
    const playerCount = this.session.players.length;
    const tvConnected = this.session.tvConnected;
    const storytellerConnected = this.session.storytellerConnected;
    this.session = createEmptySession(playerCount);
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
      const existing = s.players;
      const players = Array.from({ length: n }, (_, i) => {
        const prev = existing[i];
        if (prev) return { ...prev, seat: i + 1 };
        return {
          id: `p${i + 1}`,
          seat: i + 1,
          name: `Player ${i + 1}`,
          alive: true,
          usedGhostVote: false,
          characterId: null,
          reminders: [],
          notes: "",
          bluffs: [],
        };
      });
      s.players = players;
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
    }>,
  ) {
    this.mutate((s) => {
      const p = s.players.find((x) => x.id === playerId);
      if (!p) return;
      if (patch.name !== undefined) p.name = patch.name.slice(0, 32);
      if (patch.characterId !== undefined) p.characterId = patch.characterId;
      if (patch.reminders !== undefined) p.reminders = patch.reminders;
      if (patch.notes !== undefined) p.notes = patch.notes;
      if (patch.bluffs !== undefined) p.bluffs = patch.bluffs;
      if (patch.alive !== undefined) {
        p.alive = patch.alive;
        if (patch.alive) p.usedGhostVote = false;
      }
      if (patch.usedGhostVote !== undefined) p.usedGhostVote = patch.usedGhostVote;
    });
  }

  setFabled(ids: string[]) {
    this.mutate((s) => {
      s.fabled = ids.filter((id) => this.script.fabled.some((f) => f.id === id));
    });
  }

  setPhase(phase: Phase) {
    const hueMap: Partial<Record<Phase, HueScene>> = {
      day: "day",
      night: "night",
      firstNight: "night",
      dawn: "dawn",
      nomination: "nomination",
      vote: "nomination",
      execution: "execution",
      lobby: "hush",
      ended: "hush",
    };
    const soundMap: Partial<Record<Phase, SoundCue>> = {
      day: "day_bed",
      night: "night_bed",
      firstNight: "night_bed",
      dawn: "dawn",
      nomination: "nomination",
      lobby: "hush",
      ended: "hush",
    };

    this.mutate(
      (s) => {
        s.phase = phase;
        if (phase === "firstNight") {
          s.dayNumber = 0;
          s.night = {
            stepIndex: 0,
            steps: buildNightSteps(s, this.script, true),
            isFirstNight: true,
          };
        } else if (phase === "night") {
          s.night = {
            stepIndex: 0,
            steps: buildNightSteps(s, this.script, false),
            isFirstNight: false,
          };
        } else if (phase === "dawn") {
          s.dawnDeathIds = [];
        } else if (phase === "day") {
          if (s.dayNumber === 0) s.dayNumber = 1;
          else if (s.phase === "dawn" || s.night) {
            /* day number bumped when leaving dawn via finishDawn */
          }
          s.night = null;
          s.nomination = null;
          s.executionPendingId = null;
        }
      },
      { hue: hueMap[phase] ?? null, sound: soundMap[phase] ?? null },
    );
  }

  startFirstNight() {
    this.mutate(
      (s) => {
        s.phase = "firstNight";
        s.dayNumber = 0;
        s.night = {
          stepIndex: 0,
          steps: buildNightSteps(s, this.script, true),
          isFirstNight: true,
        };
      },
      { hue: "night", sound: "night_bed" },
    );
  }

  startNight() {
    this.mutate(
      (s) => {
        s.phase = "night";
        s.night = {
          stepIndex: 0,
          steps: buildNightSteps(s, this.script, false),
          isFirstNight: false,
        };
        s.nomination = null;
        s.executionPendingId = null;
      },
      { hue: "night", sound: "night_bed" },
    );
  }

  nightNext() {
    this.mutate(
      (s) => {
        if (!s.night) return;
        if (s.night.stepIndex < s.night.steps.length - 1) {
          s.night.stepIndex += 1;
        }
      },
      { hue: "night_wake", sound: "night_wake" },
    );
  }

  nightPrev() {
    this.mutate((s) => {
      if (!s.night) return;
      if (s.night.stepIndex > 0) s.night.stepIndex -= 1;
    });
  }

  nightSkipToDawn() {
    this.mutate(
      (s) => {
        if (!s.night) return;
        const idx = s.night.steps.findIndex((x) => x.id === "dawn");
        if (idx >= 0) s.night.stepIndex = idx;
      },
      { hue: "dawn", sound: "dawn" },
    );
  }

  goDawn() {
    this.mutate(
      (s) => {
        s.phase = "dawn";
        s.night = null;
        s.dawnDeathIds = [];
      },
      { hue: "dawn", sound: "dawn" },
    );
  }

  setDawnDeaths(playerIds: string[]) {
    this.mutate((s) => {
      s.dawnDeathIds = playerIds.filter((id) =>
        s.players.some((p) => p.id === id && p.alive),
      );
    });
  }

  announceDawnDeaths() {
    this.mutate(
      (s) => {
        const ids = [...s.dawnDeathIds];
        for (const id of ids) {
          const p = s.players.find((x) => x.id === id);
          if (p) p.alive = false;
        }
        if (ids.length) {
          s.publicLog.push({
            type: "night_death",
            playerIds: ids,
            dayNumber: s.dayNumber,
            at: Date.now(),
          });
        }
      },
      { hue: "death_settle", sound: "death" },
    );
  }

  finishDawn() {
    this.mutate(
      (s) => {
        s.dayNumber = s.dayNumber === 0 ? 1 : s.dayNumber + 1;
        s.phase = "day";
        s.dawnDeathIds = [];
        s.night = null;
      },
      { hue: "day", sound: "day_bed" },
    );
  }

  goDay() {
    this.mutate(
      (s) => {
        if (s.phase === "lobby" || s.dayNumber === 0) s.dayNumber = 1;
        s.phase = "day";
        s.night = null;
        s.nomination = null;
        s.executionPendingId = null;
      },
      { hue: "day", sound: "day_bed" },
    );
  }

  startNomination(nominatorId: string, nomineeId: string) {
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
      { hue: "nomination", sound: "nomination" },
    );
  }

  startVote(seconds = 30) {
    this.mutate(
      (s) => {
        if (!s.nomination) return;
        s.phase = "vote";
        s.timer = {
          endsAt: Date.now() + seconds * 1000,
          label: "Vote",
        };
      },
      { hue: "nomination", sound: null },
    );
  }

  toggleVote(playerId: string) {
    this.mutate((s) => {
      if (!s.nomination) return;
      const p = s.players.find((x) => x.id === playerId);
      if (!p || !canPlayerVote(p)) return;
      const idx = s.nomination.votesFor.indexOf(playerId);
      if (idx >= 0) {
        s.nomination.votesFor.splice(idx, 1);
      } else {
        s.nomination.votesFor.push(playerId);
        if (!p.alive) p.usedGhostVote = true;
      }
    });
  }

  resolveVote(outcome?: "majority" | "no_majority" | "tie") {
    this.mutate((s) => {
      if (!s.nomination) return;
      const votes = s.nomination.votesFor.length;
      const maj = majorityNeeded(s);
      let result = outcome;
      if (!result) {
        if (votes >= maj) result = "majority";
        else result = "no_majority";
      }
      s.publicLog.push({
        type: "vote_result",
        nomineeId: s.nomination.nomineeId,
        votesFor: votes,
        majority: maj,
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
    });
  }

  confirmExecution(died: boolean) {
    this.mutate(
      (s) => {
        const id = s.executionPendingId ?? s.nomination?.nomineeId;
        if (!id) return;
        const p = s.players.find((x) => x.id === id);
        if (p && died) p.alive = false;
        s.publicLog.push({
          type: "execution",
          playerId: id,
          died,
          at: Date.now(),
        });
        s.phase = "day";
        s.nomination = null;
        s.executionPendingId = null;
        s.timer = null;
      },
      {
        hue: died ? "execution" : "day",
        sound: died ? "execution" : "day_bed",
      },
    );
    if (died) {
      setTimeout(() => {
        void this.hue.applyScene("death_settle");
      }, 2500);
    }
  }

  otherDeath(playerId: string, reason: string) {
    this.mutate(
      (s) => {
        const p = s.players.find((x) => x.id === playerId);
        if (!p || !p.alive) return;
        p.alive = false;
        s.publicLog.push({
          type: "other_death",
          playerId,
          reason: reason.slice(0, 80) || "Died",
          at: Date.now(),
        });
      },
      { hue: "death_settle", sound: "death" },
    );
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
    }, { sound: "timer_end", hue: "vote_urgency" });
  }

  scene(scene: "day" | "night" | "hush") {
    const map = {
      day: { hue: "day" as HueScene, sound: "day_bed" as SoundCue },
      night: { hue: "night" as HueScene, sound: "night_bed" as SoundCue },
      hush: { hue: "hush" as HueScene, sound: "hush" as SoundCue },
    };
    const m = map[scene];
    this.mutate(() => {}, { hue: m.hue, sound: m.sound });
  }

  endGame() {
    this.mutate((s) => {
      s.phase = "ended";
      s.timer = null;
      s.night = null;
      s.nomination = null;
    }, { hue: "hush", sound: "hush" });
  }
}

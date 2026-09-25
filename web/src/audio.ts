import type { SoundCue } from "./types";

const CUE_FILES: Record<Exclude<SoundCue, null>, string> = {
  day_bed: "/audio/day_bed.wav",
  night_bed: "/audio/night_bed.wav",
  hush: "/audio/hush.wav",
  timer_end: "/audio/timer_end.wav",
  nomination: "/audio/nomination.wav",
  execution: "/audio/execution.wav",
  death: "/audio/death.wav",
  dawn: "/audio/dawn.wav",
  night_wake: "/audio/night_wake.wav",
};

let unlocked = false;
let bed: HTMLAudioElement | null = null;

export function isAudioUnlocked() {
  return unlocked;
}

export async function unlockAudio(): Promise<void> {
  const a = new Audio("/audio/hush.wav");
  a.volume = 0.01;
  try {
    await a.play();
    a.pause();
    unlocked = true;
  } catch {
    unlocked = false;
    throw new Error("Audio unlock failed");
  }
}

export function playCue(cue: SoundCue) {
  if (!cue || !unlocked) return;
  const src = CUE_FILES[cue];
  if (!src) return;

  if (cue === "day_bed" || cue === "night_bed") {
    if (bed) {
      bed.pause();
      bed = null;
    }
    bed = new Audio(src);
    bed.loop = true;
    bed.volume = 0.35;
    void bed.play().catch(() => undefined);
    return;
  }

  if (cue === "hush") {
    if (bed) {
      bed.pause();
      bed = null;
    }
  }

  const sting = new Audio(src);
  sting.volume = 0.7;
  void sting.play().catch(() => undefined);
}

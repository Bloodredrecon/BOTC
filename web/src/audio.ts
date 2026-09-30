import type { AmbiancePublicLayer, AmbiancePublicState } from "./types";

let unlocked = false;
let bed: HTMLAudioElement | null = null;
let bedBase: string | null = null;
/** Classic bed base volume before ducking. */
const BED_VOLUME = 0.35;
/** One-shot / narration sting — only one at a time so misclicks don't stack. */
let sting: HTMLAudioElement | null = null;
let stingCue: string | null = null;
/** Vote cues (build-up / majority) may cut each other, but wait for any other sting to end. */
const VOTE_CUE_BASES = new Set(["atm_count_rising", "majority"]);
/** At most one vote cue waits for the current sting; any newer cue replaces or cancels it. */
let deferredVote: { cue: string; timer: ReturnType<typeof setTimeout> } | null = null;

/** Dual-buffer crossfade for continuous ambiance beds (avoids HTMLAudio loop seams). */
type AmbianceLoopPlayer = {
  a: HTMLAudioElement;
  b: HTMLAudioElement;
  active: "a" | "b";
  targetVolume: number;
  crossfading: boolean;
  poll: ReturnType<typeof setInterval> | null;
};

/** Layered ambiance loops (separate from day_bed/night_bed scene beds). */
const ambianceLoops = new Map<string, AmbianceLoopPlayer>();
/** Sporadic one-shots temporarily hold an element here. */
const ambianceEls = new Map<string, HTMLAudioElement>();
/** Sporadic one-shot timers (layer id → timeout handle). */
const sporadicTimers = new Map<string, ReturnType<typeof setTimeout>>();
let ambianceState: AmbiancePublicState | null = null;
/** 1 = full ambiance; ~0.3 while a sting/narration cue plays. */
let duckFactor = 1;
const DUCK_WHILE_STING = 0.3;
/** Seconds of overlap when restarting a loop bed. */
const LOOP_CROSSFADE_SEC = 2;

function stopSting() {
  if (!sting) return;
  sting.pause();
  sting.src = "";
  sting = null;
  stingCue = null;
}

function clearDeferredVote() {
  if (!deferredVote) return;
  clearTimeout(deferredVote.timer);
  deferredVote = null;
}

function flushDeferredVote() {
  const d = deferredVote;
  if (!d) return;
  clearDeferredVote();
  playCue(d.cue);
}

function cueBase(cueId: string): string {
  const raw = cueId.startsWith("custom:") ? cueId.slice("custom:".length) : cueId;
  return raw.replace(/\.[^.]+$/, "").toLowerCase().split("/").pop() ?? raw.toLowerCase();
}

function isBedCue(cueId: string): boolean {
  const base = cueBase(cueId);
  return base === "day_bed" || base === "night_bed";
}

function isHushCue(cueId: string): boolean {
  return cueBase(cueId) === "hush";
}

function bedUrl(bedId: "day_bed" | "night_bed"): string {
  return `/custom-audio/${bedId}.mp3`;
}

function applyBedVolume() {
  if (bed) bed.volume = BED_VOLUME * duckFactor;
}

function setDucking(active: boolean) {
  duckFactor = active ? DUCK_WHILE_STING : 1;
  applyBedVolume();
  applyAmbianceVolumes();
}

function startBed(bedId: "day_bed" | "night_bed") {
  if (bedBase === bedId && bed) return;
  if (bed) {
    bed.pause();
    bed = null;
  }
  const el = new Audio(bedUrl(bedId));
  el.loop = true;
  bed = el;
  bedBase = bedId;
  applyBedVolume();
  el.addEventListener(
    "error",
    () => {
      if (bed !== el) return;
      el.src = `/audio/${bedId}.wav`;
      void el.play().catch(() => undefined);
    },
    { once: true },
  );
  void el.play().catch(() => undefined);
}

function layerGain(layer: { volume: number }, master: number): number {
  return Math.max(0, Math.min(1, layer.volume * master * duckFactor));
}

function applyAmbianceVolumes() {
  if (!ambianceState) return;
  const master = ambianceState.masterVolume;
  for (const layer of ambianceState.layers) {
    const gain = layerGain(layer, master);
    const loop = ambianceLoops.get(layer.id);
    if (loop) {
      loop.targetVolume = gain;
      if (!loop.crossfading) {
        const cur = loop.active === "a" ? loop.a : loop.b;
        cur.volume = gain;
        const idle = loop.active === "a" ? loop.b : loop.a;
        idle.volume = 0;
      }
    }
    const el = ambianceEls.get(layer.id);
    if (el) el.volume = gain;
  }
}

function disposeAudioEl(el: HTMLAudioElement) {
  el.pause();
  el.src = "";
  el.ontimeupdate = null;
  el.onended = null;
}

function stopAmbianceLayer(id: string) {
  const timer = sporadicTimers.get(id);
  if (timer != null) {
    clearTimeout(timer);
    sporadicTimers.delete(id);
  }
  const loop = ambianceLoops.get(id);
  if (loop) {
    if (loop.poll != null) clearInterval(loop.poll);
    disposeAudioEl(loop.a);
    disposeAudioEl(loop.b);
    ambianceLoops.delete(id);
  }
  const el = ambianceEls.get(id);
  if (el) {
    disposeAudioEl(el);
    ambianceEls.delete(id);
  }
}

function makeLoopAudio(url: string, onError: (el: HTMLAudioElement) => void): HTMLAudioElement {
  const el = new Audio(url);
  el.loop = false;
  el.preload = "auto";
  el.volume = 0;
  el.addEventListener("error", () => onError(el), { once: true });
  return el;
}

function rampVolumes(
  from: HTMLAudioElement,
  to: HTMLAudioElement,
  target: number,
  ms: number,
  done: () => void,
) {
  const steps = Math.max(8, Math.floor(ms / 40));
  let i = 0;
  const startFrom = from.volume;
  const handle = setInterval(() => {
    i += 1;
    const t = Math.min(1, i / steps);
    from.volume = Math.max(0, startFrom * (1 - t));
    to.volume = Math.max(0, Math.min(1, target * t));
    if (t >= 1) {
      clearInterval(handle);
      from.volume = 0;
      to.volume = target;
      done();
    }
  }, 40);
}

function beginLoopCrossfade(id: string, player: AmbianceLoopPlayer) {
  if (player.crossfading) return;
  const fading = player.active === "a" ? player.a : player.b;
  const incoming = player.active === "a" ? player.b : player.a;
  // Need duration to know when to fire; skip if metadata missing / too short.
  const dur = fading.duration;
  if (!Number.isFinite(dur) || dur < LOOP_CROSSFADE_SEC * 2.5) {
    // Fall back: hard restart (still better than silence).
    void fading.play().catch(() => undefined);
    return;
  }
  player.crossfading = true;
  incoming.currentTime = 0;
  incoming.volume = 0;
  void incoming.play().catch(() => undefined);
  rampVolumes(fading, incoming, player.targetVolume, LOOP_CROSSFADE_SEC * 1000, () => {
    fading.pause();
    fading.currentTime = 0;
    player.active = player.active === "a" ? "b" : "a";
    player.crossfading = false;
  });
}

function startAmbianceLoop(id: string, cueId: string) {
  if (ambianceLoops.has(id)) return;

  const url = cueToUrl(cueId);
  const master = ambianceState?.masterVolume ?? 0.7;
  const layer = ambianceState?.layers.find((l) => l.id === id);
  const target = layer ? layerGain(layer, master) : 0;

  const onError = (el: HTMLAudioElement) => {
    const player = ambianceLoops.get(id);
    if (!player || (player.a !== el && player.b !== el)) return;
    const base = cueBase(cueId);
    if (!el.src.includes("/audio/")) {
      el.src = `/audio/${encodeURIComponent(base)}.wav`;
      void el.play().catch(() => undefined);
    } else {
      stopAmbianceLayer(id);
    }
  };

  const a = makeLoopAudio(url, onError);
  const b = makeLoopAudio(url, onError);
  const player: AmbianceLoopPlayer = {
    a,
    b,
    active: "a",
    targetVolume: target,
    crossfading: false,
    poll: null,
  };
  ambianceLoops.set(id, player);

  a.volume = target;
  void a.play().catch(() => undefined);

  const onEnded = (el: HTMLAudioElement) => {
    const live = ambianceLoops.get(id);
    if (!live || live.crossfading) return;
    const cur = live.active === "a" ? live.a : live.b;
    if (el !== cur) return;
    // Safety: if poll missed the window (metadata late / tab throttle), hard handoff.
    beginLoopCrossfade(id, live);
  };
  a.addEventListener("ended", () => onEnded(a));
  b.addEventListener("ended", () => onEnded(b));

  // Poll near end — timeupdate can be sparse; interval is reliable for long beds.
  player.poll = setInterval(() => {
    const live = ambianceLoops.get(id);
    if (!live || live.crossfading) return;
    const cur = live.active === "a" ? live.a : live.b;
    const dur = cur.duration;
    if (!Number.isFinite(dur) || dur < LOOP_CROSSFADE_SEC * 2.5) return;
    if (cur.currentTime >= dur - LOOP_CROSSFADE_SEC) {
      beginLoopCrossfade(id, live);
    }
  }, 200);
}

function randomGapMs(minGapSec: number): number {
  const min = Math.max(5, minGapSec) * 1000;
  // Spread: minGap .. minGap * 2.5
  return min + Math.random() * (min * 1.5);
}

function scheduleSporadic(layer: AmbiancePublicLayer, immediate = false) {
  const prev = sporadicTimers.get(layer.id);
  if (prev != null) clearTimeout(prev);

  const delay = immediate ? 800 + Math.random() * 2500 : randomGapMs(layer.minGapSec ?? 45);
  const handle = setTimeout(() => {
    sporadicTimers.delete(layer.id);
    if (!unlocked || !ambianceState) return;
    const live = ambianceState.layers.find((l) => l.id === layer.id);
    if (!live?.enabled) return;

    const el = new Audio(cueToUrl(live.cueId));
    el.loop = false;
    el.volume = Math.max(0, Math.min(1, live.volume * ambianceState.masterVolume * duckFactor));
    ambianceEls.set(layer.id, el);
    el.addEventListener(
      "ended",
      () => {
        if (ambianceEls.get(layer.id) === el) ambianceEls.delete(layer.id);
        const still = ambianceState?.layers.find((l) => l.id === layer.id);
        if (still?.enabled) scheduleSporadic(still, false);
      },
      { once: true },
    );
    el.addEventListener(
      "error",
      () => {
        if (ambianceEls.get(layer.id) === el) ambianceEls.delete(layer.id);
        const still = ambianceState?.layers.find((l) => l.id === layer.id);
        if (still?.enabled) scheduleSporadic(still, false);
      },
      { once: true },
    );
    void el.play().catch(() => {
      const still = ambianceState?.layers.find((l) => l.id === layer.id);
      if (still?.enabled) scheduleSporadic(still, false);
    });
  }, delay);
  sporadicTimers.set(layer.id, handle);
}

function startAmbianceLayer(layer: AmbiancePublicLayer) {
  if (layer.kind === "sporadic") {
    // Don't keep a looping element; just schedule one-shots.
    if (!sporadicTimers.has(layer.id) && !ambianceEls.has(layer.id)) {
      scheduleSporadic(layer, true);
    }
    return;
  }
  startAmbianceLoop(layer.id, layer.cueId);
}

/**
 * Keep ambiance loops in sync with the session mix.
 * TV reconnect / ST changes both flow through here.
 */
export function syncAmbiance(state: AmbiancePublicState | null | undefined) {
  if (!unlocked) {
    ambianceState = state ?? null;
    return;
  }
  ambianceState = state ?? null;
  if (!ambianceState) {
    for (const id of [...ambianceLoops.keys()]) stopAmbianceLayer(id);
    for (const id of [...ambianceEls.keys()]) stopAmbianceLayer(id);
    for (const id of [...sporadicTimers.keys()]) {
      clearTimeout(sporadicTimers.get(id)!);
      sporadicTimers.delete(id);
    }
    return;
  }

  const wanted = new Set<string>();
  for (const layer of ambianceState.layers) {
    if (!layer.enabled) {
      stopAmbianceLayer(layer.id);
      continue;
    }
    wanted.add(layer.id);
    startAmbianceLayer(layer);
  }
  for (const id of [...ambianceLoops.keys()]) {
    if (!wanted.has(id)) stopAmbianceLayer(id);
  }
  for (const id of [...ambianceEls.keys()]) {
    if (!wanted.has(id)) stopAmbianceLayer(id);
  }
  for (const id of [...sporadicTimers.keys()]) {
    if (!wanted.has(id)) {
      clearTimeout(sporadicTimers.get(id)!);
      sporadicTimers.delete(id);
    }
  }
  applyAmbianceVolumes();
}

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
    // Re-apply pending ambiance after unlock (TV gate).
    if (ambianceState) syncAmbiance(ambianceState);
  } catch {
    unlocked = false;
    throw new Error("Audio unlock failed");
  }
}

/** TV plays whatever id the server resolved (custom:file.mp3 or builtin id). */
export function cueToUrl(cueId: string): string {
  if (cueId.startsWith("custom:")) {
    const rel = cueId.slice("custom:".length);
    // Preserve subdirectory slashes (ambiance/foo.mp3); encode each segment.
    const path = rel
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return `/custom-audio/${path}`;
  }
  if (cueId.includes(".")) return `/audio/${encodeURIComponent(cueId)}`;
  return `/audio/${encodeURIComponent(cueId)}.wav`;
}

export function playCue(cue: string | null) {
  if (!cue || !unlocked) return;
  const src = cueToUrl(cue);

  // Always cut whatever sting is already playing before a new cue.
  clearDeferredVote();
  stopSting();

  // Beds alone: loop under silence / manual scene buttons. Narration files already
  // include their own ambience — do not stack a second bed under them.
  if (isBedCue(cue)) {
    setDucking(false);
    startBed(cueBase(cue) as "day_bed" | "night_bed");
    return;
  }

  if (isHushCue(cue)) {
    if (bed) {
      bed.pause();
      bed = null;
      bedBase = null;
    }
    setDucking(false);
    return;
  }

  const el = new Audio(src);
  el.volume = 0.7;
  sting = el;
  stingCue = cue;
  setDucking(true);
  el.addEventListener(
    "ended",
    () => {
      if (sting === el) {
        sting = null;
        stingCue = null;
        setDucking(false);
        flushDeferredVote();
      }
    },
    { once: true },
  );
  const failed = () => {
    if (sting === el) flushDeferredVote();
  };
  el.addEventListener("error", failed, { once: true });
  void el.play().catch(failed);
}

/**
 * Vote-stage cue (build-up / majority). It may cut another vote cue, but never a voice line:
 * while any other sting plays (e.g. the vote-open narration) it waits for that to end.
 * Only one waits — a newer vote cue replaces it, any other cue cancels it. If the sting
 * outlasts `maxWaitMs`, the cue plays anyway (`"play"`) or is dropped (`"drop"`).
 */
export function playVoteCue(cue: string, maxWaitMs: number, onTimeout: "play" | "drop") {
  if (!unlocked) return;
  clearDeferredVote();
  const voicePlaying =
    sting !== null &&
    !sting.paused &&
    !sting.ended &&
    !sting.error &&
    !VOTE_CUE_BASES.has(cueBase(stingCue ?? ""));
  if (!voicePlaying) {
    playCue(cue);
    return;
  }
  const timer = setTimeout(() => {
    if (deferredVote?.timer !== timer) return;
    deferredVote = null;
    if (onTimeout === "play") playCue(cue);
  }, maxWaitMs);
  deferredVote = { cue, timer };
}

export function cancelVoteCue() {
  clearDeferredVote();
}

export function stopBeds() {
  stopSting();
  setDucking(false);
  if (bed) {
    bed.pause();
    bed = null;
    bedBase = null;
  }
}

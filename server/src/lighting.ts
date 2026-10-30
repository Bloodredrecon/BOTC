import type { GameSession, HueScene, LightingBackend, LightingStatus } from "./types.js";

export type LightingScene = Exclude<HueScene, null>;

export type LightingApplyOpts = {
  /** Vote clock length; WLED uses this to fill the strip. Hue ignores it. */
  durationMs?: number;
};

/** Short accents on top of the phase bed. Storyteller can turn these off. */
export const EVENT_CUE_SCENES: ReadonlySet<LightingScene> = new Set([
  "night_wake",
  "vote_urgency",
  "death_settle",
]);

export interface LightingDriver {
  applyScene(scene: LightingScene, opts?: LightingApplyOpts): Promise<void>;
  isLive(): boolean;
  beginVoteFill?(durationMs: number): void;
  tickVoteClock?(): void | Promise<void>;
  setFollow?(on: boolean): Promise<void>;
  setBrightness?(bri: number): Promise<void>;
  setMaxBrightness?(bri: number): Promise<void>;
  setEventCues?(on: boolean): Promise<void>;
  preview?(scene: LightingScene): Promise<void>;
  status(): LightingStatus;
}

export const LIGHTING_PREVIEW_SCENES: { id: LightingScene; label: string }[] = [
  { id: "lobby", label: "Lobby" },
  { id: "night", label: "Night" },
  { id: "dawn", label: "Dawn" },
  { id: "day", label: "Day" },
  { id: "dusk", label: "Dusk" },
  { id: "nomination", label: "Nomination" },
  { id: "vote", label: "Vote" },
  { id: "vote_urgency", label: "Vote end" },
  { id: "execution", label: "Gallows" },
  { id: "death_settle", label: "Death" },
  { id: "hush", label: "Hush" },
  { id: "good_wins", label: "Good wins" },
  { id: "evil_wins", label: "Evil wins" },
];

export const STUB_LIGHTING_STATUS: LightingStatus = {
  configured: false,
  follow: false,
  live: false,
  backend: "none",
  host: "",
  ledCount: 300,
  brightness: 128,
  maxBrightness: 180,
  eventCues: true,
  scene: null,
  lastError: null,
};

export function sceneForSession(s: GameSession): LightingScene {
  if (s.phase === "ended") {
    if (s.winner === "good") return "good_wins";
    if (s.winner === "evil") return "evil_wins";
    return "hush";
  }
  if (s.phase === "lobby") return "lobby";
  if (s.phase === "firstNight" || s.phase === "night") return "night";
  if (s.phase === "dawn") return s.dawnDeathsAnnounced && s.dawnDeathIds.length > 0 ? "death_settle" : "dawn";
  if (s.phase === "day") return "day";
  if (s.phase === "dusk") return s.nominationsOpen ? "nomination" : "dusk";
  if (s.phase === "nomination") return "nomination";
  if (s.phase === "vote") return "vote";
  if (s.phase === "execution") return "execution";
  return "hush";
}

function mergeBackend(a: LightingBackend, b: LightingBackend): LightingBackend {
  if (a === "none") return b;
  if (b === "none") return a;
  if (a === b) return a;
  return "both";
}

/** Fan a scene out to every live backend (WLED and/or Hue). Failures stay inside each driver. */
export function composeLighting(backends: LightingDriver[]): LightingDriver {
  const list = backends.filter(Boolean);

  function liveOnes(): LightingDriver[] {
    return list.filter((d) => d.isLive());
  }

  return {
    isLive: () => list.some((d) => d.isLive()),
    async applyScene(scene, opts) {
      await Promise.all(list.map((d) => d.applyScene(scene, opts)));
    },
    beginVoteFill(durationMs) {
      for (const d of list) d.beginVoteFill?.(durationMs);
    },
    tickVoteClock() {
      for (const d of liveOnes()) d.tickVoteClock?.();
    },
    async setFollow(on) {
      await Promise.all(list.map((d) => d.setFollow?.(on) ?? Promise.resolve()));
    },
    async setBrightness(bri) {
      await Promise.all(list.map((d) => d.setBrightness?.(bri) ?? Promise.resolve()));
    },
    async setMaxBrightness(bri) {
      await Promise.all(list.map((d) => d.setMaxBrightness?.(bri) ?? Promise.resolve()));
    },
    async setEventCues(on) {
      await Promise.all(list.map((d) => d.setEventCues?.(on) ?? Promise.resolve()));
    },
    async preview(scene) {
      await Promise.all(list.map((d) => (d.preview ? d.preview(scene) : d.applyScene(scene))));
    },
    status() {
      const statuses = list.map((d) => d.status());
      const configured = statuses.some((s) => s.configured);
      const follow = statuses.some((s) => s.follow);
      const live = statuses.some((s) => s.live);
      const host = statuses.find((s) => s.host)?.host ?? "";
      const ledCount = statuses.find((s) => s.backend === "wled")?.ledCount ?? statuses[0]?.ledCount ?? 300;
      const brightness = statuses.find((s) => s.follow)?.brightness ?? statuses[0]?.brightness ?? 128;
      const liveOrCfg = statuses.find((s) => s.configured) ?? statuses[0];
      const maxBrightness = liveOrCfg?.maxBrightness ?? 180;
      const eventCues = liveOrCfg?.eventCues ?? true;
      const scene = [...statuses].reverse().find((s) => s.scene)?.scene ?? null;
      const lastError = statuses.find((s) => s.lastError)?.lastError ?? null;
      const backend = statuses.reduce<LightingBackend>((acc, s) => mergeBackend(acc, s.live || s.configured ? s.backend : "none"), "none");
      return { configured, follow, live, backend, host, ledCount, brightness, maxBrightness, eventCues, scene, lastError };
    },
  };
}

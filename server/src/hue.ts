import type { LightingApplyOpts, LightingDriver, LightingScene } from "./lighting.js";
import { STUB_LIGHTING_STATUS } from "./lighting.js";
import type { AppConfig } from "./persistence.js";
import type { LightingStatus } from "./types.js";

type LightRole = "ambient" | "accent" | "effect";

type LightState = {
  on: boolean;
  bri?: number;
  hue?: number;
  sat?: number;
  transitiontime?: number;
};

const SCENES: Record<LightingScene, Partial<Record<LightRole, LightState>>> = {
  lobby: {
    ambient: { on: true, bri: 40, hue: 7000, sat: 160, transitiontime: 20 },
    accent: { on: true, bri: 28, hue: 6500, sat: 140, transitiontime: 20 },
    effect: { on: false, transitiontime: 20 },
  },
  day: {
    ambient: { on: true, bri: 200, hue: 8000, sat: 120, transitiontime: 20 },
    accent: { on: true, bri: 140, hue: 7000, sat: 160, transitiontime: 20 },
    effect: { on: false, transitiontime: 20 },
  },
  night: {
    ambient: { on: true, bri: 60, hue: 46920, sat: 200, transitiontime: 30 },
    accent: { on: true, bri: 40, hue: 46000, sat: 180, transitiontime: 30 },
    effect: { on: false, transitiontime: 30 },
  },
  night_wake: {
    ambient: { on: true, bri: 60, hue: 46920, sat: 200, transitiontime: 5 },
    accent: { on: true, bri: 120, hue: 46000, sat: 220, transitiontime: 5 },
    effect: { on: false, transitiontime: 5 },
  },
  dawn: {
    ambient: { on: true, bri: 160, hue: 10000, sat: 100, transitiontime: 40 },
    accent: { on: true, bri: 120, hue: 9000, sat: 80, transitiontime: 40 },
    effect: { on: false, transitiontime: 40 },
  },
  dusk: {
    ambient: { on: true, bri: 90, hue: 43000, sat: 140, transitiontime: 25 },
    accent: { on: true, bri: 70, hue: 42000, sat: 160, transitiontime: 25 },
    effect: { on: false, transitiontime: 25 },
  },
  nomination: {
    ambient: { on: true, bri: 180, hue: 8000, sat: 140, transitiontime: 10 },
    accent: { on: true, bri: 200, hue: 6000, sat: 200, transitiontime: 10 },
    effect: { on: false, transitiontime: 10 },
  },
  vote: {
    ambient: { on: true, bri: 190, hue: 5500, sat: 180, transitiontime: 8 },
    accent: { on: true, bri: 220, hue: 4500, sat: 220, transitiontime: 8 },
    effect: { on: false, transitiontime: 8 },
  },
  vote_urgency: {
    ambient: { on: true, bri: 180, hue: 8000, sat: 140, transitiontime: 2 },
    accent: { on: true, bri: 254, hue: 5000, sat: 254, transitiontime: 2 },
    effect: { on: false, transitiontime: 2 },
  },
  execution: {
    ambient: { on: true, bri: 40, hue: 0, sat: 200, transitiontime: 5 },
    accent: { on: false, transitiontime: 5 },
    effect: { on: true, bri: 220, hue: 0, sat: 254, transitiontime: 5 },
  },
  death_settle: {
    ambient: { on: true, bri: 80, hue: 46920, sat: 160, transitiontime: 30 },
    accent: { on: true, bri: 50, hue: 46000, sat: 140, transitiontime: 30 },
    effect: { on: false, transitiontime: 30 },
  },
  hush: {
    ambient: { on: true, bri: 20, hue: 46920, sat: 100, transitiontime: 20 },
    accent: { on: false, transitiontime: 20 },
    effect: { on: false, transitiontime: 20 },
  },
  good_wins: {
    ambient: { on: true, bri: 220, hue: 8000, sat: 180, transitiontime: 16 },
    accent: { on: true, bri: 200, hue: 7000, sat: 160, transitiontime: 16 },
    effect: { on: true, bri: 180, hue: 9000, sat: 140, transitiontime: 16 },
  },
  evil_wins: {
    ambient: { on: true, bri: 110, hue: 50000, sat: 220, transitiontime: 16 },
    accent: { on: true, bri: 90, hue: 52000, sat: 200, transitiontime: 16 },
    effect: { on: true, bri: 140, hue: 0, sat: 200, transitiontime: 16 },
  },
};

/** @deprecated Use LightingDriver — kept so GameEngine and tests keep compiling. */
export type HueDriver = LightingDriver;

export function createHueDriver(config: AppConfig["hue"]): LightingDriver {
  const configured = Boolean(config.enabled && config.bridgeIp && config.username);
  let scene: LightingScene | null = null;
  let lastError: string | null = null;

  function status(): LightingStatus {
    if (!configured) return { ...STUB_LIGHTING_STATUS, backend: "none" };
    return {
      configured: true,
      follow: true,
      live: true,
      backend: "hue",
      host: config.bridgeIp,
      ledCount: 0,
      brightness: 254,
      maxBrightness: 254,
      eventCues: true,
      scene,
      lastError,
    };
  }

  if (!configured) {
    return {
      isLive: () => false,
      status,
      async applyScene(next) {
        scene = next;
      },
    };
  }

  const lights = config.lights;

  async function setLight(role: LightRole, state: LightState): Promise<void> {
    const id = lights[role];
    if (!id) return;
    const url = `http://${config.bridgeIp}/api/${config.username}/lights/${id}/state`;
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        console.warn(`[hue] light ${role} HTTP ${res.status}`);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[hue] light ${role} failed:`, err);
    }
  }

  return {
    isLive: () => true,
    status,
    async applyScene(next: LightingScene, _opts?: LightingApplyOpts) {
      scene = next;
      const map = SCENES[next];
      await Promise.all(
        (Object.keys(map) as LightRole[]).map((role) => {
          const state = map[role];
          return state ? setLight(role, state) : Promise.resolve();
        }),
      );
      console.log(`[hue] scene=${next}`);
    },
  };
}

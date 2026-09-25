import type { AppConfig } from "./persistence.js";
import type { HueScene } from "./types.js";

type LightRole = "ambient" | "accent" | "effect";

type LightState = {
  on: boolean;
  bri?: number;
  hue?: number;
  sat?: number;
  transitiontime?: number;
};

const SCENES: Record<Exclude<HueScene, null>, Partial<Record<LightRole, LightState>>> = {
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
  nomination: {
    ambient: { on: true, bri: 180, hue: 8000, sat: 140, transitiontime: 10 },
    accent: { on: true, bri: 200, hue: 6000, sat: 200, transitiontime: 10 },
    effect: { on: false, transitiontime: 10 },
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
};

export interface HueDriver {
  applyScene(scene: Exclude<HueScene, null>): Promise<void>;
  isLive(): boolean;
}

export function createHueDriver(config: AppConfig["hue"]): HueDriver {
  if (!config.enabled || !config.bridgeIp || !config.username) {
    return {
      isLive: () => false,
      async applyScene(scene) {
        console.log(`[hue:stub] scene=${scene}`);
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
        console.warn(`[hue] light ${role} HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(`[hue] light ${role} failed:`, err);
    }
  }

  return {
    isLive: () => true,
    async applyScene(scene) {
      const map = SCENES[scene];
      await Promise.all(
        (Object.keys(map) as LightRole[]).map((role) => {
          const state = map[role];
          return state ? setLight(role, state) : Promise.resolve();
        }),
      );
      console.log(`[hue] scene=${scene}`);
    },
  };
}

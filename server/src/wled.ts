import type { LightingApplyOpts, LightingDriver, LightingScene } from "./lighting.js";
import { STUB_LIGHTING_STATUS } from "./lighting.js";
import type { LightingStatus } from "./types.js";

export type WledConfig = {
  enabled: boolean;
  host: string;
  /** Game strip length. This LAN has 300 + 277 on one controller; only the 300 is used. */
  ledCount: number;
  brightness: number;
  /** WLED segment id for the game strip. */
  segmentId: number;
  /** Inclusive start pixel (WLED `start`). */
  start: number;
  /** Exclusive stop pixel (WLED `stop`). 0 means start + ledCount. */
  stop: number;
};

export const DEFAULT_WLED: WledConfig = {
  enabled: false,
  host: "",
  ledCount: 300,
  brightness: 128,
  segmentId: 0,
  start: 0,
  stop: 300,
};

export type WledDeviceSeg = { id: number; start: number; stop: number; len?: number };
export type WledLayout = {
  game: { id: number; start: number; stop: number };
  /** Leftover pixels (the 277) when the controller is still one 577-LED segment. Null = leave other segs as-is. */
  rest: { id: number; start: number; stop: number } | null;
  deviceCount: number;
};

/** WLED 0.14 / 16 effect IDs (Solid=0). Avoid blink/strobe. */
const FX_SOLID = 0;
const FX_BREATHE = 2;
const FX_FADE = 12;
const FX_CANDLE = 88;
const FX_PERCENT = 98;

type Rgb = [number, number, number];

type WledScene = {
  col: Rgb;
  bri: number;
  fx: number;
  /** Speed 0–255; keep low so breathe/fade is not photosensitive. */
  sx: number;
  ix: number;
  /** Tenths of a second. */
  transition: number;
};

const SCENES: Record<LightingScene, WledScene> = {
  lobby: { col: [255, 140, 40], bri: 48, fx: FX_BREATHE, sx: 28, ix: 90, transition: 20 },
  night: { col: [8, 18, 70], bri: 42, fx: FX_BREATHE, sx: 22, ix: 80, transition: 30 },
  night_wake: { col: [20, 40, 120], bri: 64, fx: FX_BREATHE, sx: 36, ix: 110, transition: 8 },
  dawn: { col: [255, 150, 45], bri: 96, fx: FX_FADE, sx: 24, ix: 140, transition: 40 },
  day: { col: [255, 186, 96], bri: 168, fx: FX_SOLID, sx: 0, ix: 128, transition: 20 },
  dusk: { col: [70, 90, 170], bri: 64, fx: FX_BREATHE, sx: 26, ix: 90, transition: 25 },
  nomination: { col: [220, 70, 18], bri: 120, fx: FX_SOLID, sx: 0, ix: 128, transition: 12 },
  vote: { col: [220, 64, 16], bri: 130, fx: FX_PERCENT, sx: 0, ix: 8, transition: 4 },
  vote_urgency: { col: [255, 78, 16], bri: 170, fx: FX_BREATHE, sx: 70, ix: 150, transition: 6 },
  execution: { col: [120, 0, 0], bri: 72, fx: FX_SOLID, sx: 0, ix: 128, transition: 8 },
  death_settle: { col: [70, 0, 28], bri: 40, fx: FX_FADE, sx: 30, ix: 100, transition: 12 },
  hush: { col: [18, 16, 32], bri: 22, fx: FX_SOLID, sx: 0, ix: 128, transition: 20 },
  good_wins: { col: [255, 196, 56], bri: 200, fx: FX_CANDLE, sx: 40, ix: 160, transition: 16 },
  evil_wins: { col: [110, 0, 70], bri: 110, fx: FX_SOLID, sx: 0, ix: 128, transition: 16 },
};

const TIMEOUT_MS = 1500;
const RETRY_MS = 200;
/** Never talk to BOTC's own port (or the old BeatLock-on-3847 listener). */
const FORBIDDEN_PORT = 3847;

export type WledHttp = (url: string, init?: RequestInit) => Promise<Response>;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function normalizeWledHost(raw: string): string {
  let h = String(raw ?? "").trim();
  h = h.replace(/^https?:\/\//i, "");
  h = h.split("/")[0] ?? "";
  h = h.replace(/\.+$/, "");
  return h.trim();
}

export function wledBaseUrl(host: string): string | null {
  const h = normalizeWledHost(host);
  if (!h) return null;
  try {
    const url = new URL(`http://${h}`);
    const port = url.port ? Number(url.port) : 80;
    if (port === FORBIDDEN_PORT) {
      console.warn(`[wled] refusing host ${h} (port ${FORBIDDEN_PORT} is BOTC, not the strip)`);
      return null;
    }
    if (!url.hostname) return null;
    return `http://${url.host}`;
  } catch {
    return null;
  }
}

function intIn(n: unknown, lo: number, hi: number): number | null {
  const v = Number(n);
  return Number.isInteger(v) && v >= lo && v <= hi ? v : null;
}

export function mergeWled(base: WledConfig, patch: unknown): WledConfig {
  if (!patch || typeof patch !== "object") return base;
  const p = patch as Partial<WledConfig>;
  const ledCount = intIn(p.ledCount, 1, 5000) ?? base.ledCount;
  const start = intIn(p.start, 0, 5000) ?? base.start;
  const stopPatch = intIn(p.stop, 1, 5000);
  const stop =
    stopPatch && stopPatch > start
      ? stopPatch
      : p.start !== undefined || p.ledCount !== undefined
        ? start + ledCount
        : base.stop > start
          ? base.stop
          : start + ledCount;
  return {
    enabled: typeof p.enabled === "boolean" ? p.enabled : base.enabled,
    host: typeof p.host === "string" ? normalizeWledHost(p.host) : base.host,
    ledCount,
    brightness: intIn(p.brightness, 1, 255) ?? base.brightness,
    segmentId: intIn(p.segmentId, 0, 31) ?? base.segmentId,
    start,
    stop,
  };
}

export function normalizeWledRange(config: WledConfig): { id: number; start: number; stop: number; ledCount: number } {
  const ledCount = clamp(Math.floor(config.ledCount || DEFAULT_WLED.ledCount), 1, 5000);
  const start = clamp(Math.floor(config.start || 0), 0, 5000);
  const stop = config.stop > start ? clamp(Math.floor(config.stop), start + 1, 5000) : start + ledCount;
  return {
    id: clamp(Math.floor(config.segmentId || 0), 0, 31),
    start,
    stop,
    ledCount: stop - start,
  };
}

/**
 * Pick the 300-LED game strip. Probe evidence (192.168.50.139, 2026-10-20): one segment
 * id 0 start 0 stop 577 — two physical strips (300 + 277) not yet split. Until a 300-len
 * segment exists, drive start 0 stop 300 and turn the leftover 277 off.
 */
export function resolveWledLayout(
  config: WledConfig,
  device?: { total?: number; segs?: WledDeviceSeg[] },
): WledLayout {
  const range = normalizeWledRange(config);
  const segs = device?.segs ?? [];
  const total = Number(device?.total);
  const deviceCount = Number.isInteger(total) && total > 0 ? total : Math.max(range.stop, segs.reduce((m, s) => Math.max(m, s.stop), 0));

  const lenOf = (s: WledDeviceSeg) => (typeof s.len === "number" && s.len > 0 ? s.len : Math.max(0, s.stop - s.start));
  const match300 = segs.find((s) => lenOf(s) === range.ledCount);
  const configuredNonDefault = range.start !== DEFAULT_WLED.start || range.stop !== DEFAULT_WLED.stop;

  let game = { id: range.id, start: range.start, stop: range.stop };
  if (!configuredNonDefault && match300) {
    game = { id: match300.id, start: match300.start, stop: match300.stop };
  }

  const alreadySplit = segs.some((s) => lenOf(s) === range.ledCount) && segs.length > 1;
  let rest: WledLayout["rest"] = null;
  if (!alreadySplit && deviceCount > game.stop) {
    rest = { id: game.id === 0 ? 1 : 0, start: game.stop, stop: deviceCount };
  } else if (!alreadySplit && game.start > 0) {
    rest = { id: game.id === 0 ? 1 : 0, start: 0, stop: game.start };
  }
  return { game, rest, deviceCount };
}

export function wledPayloadForScene(
  scene: LightingScene,
  opts: {
    brightness: number;
    ix?: number;
    layout: WledLayout;
    /** When true, only the game segment is switched off; leftover pixels are not mirrored. */
    gameOff?: boolean;
  },
): Record<string, unknown> {
  const def = SCENES[scene];
  const master = clamp(Math.floor(opts.brightness), 1, 255);
  const bri = clamp(Math.round((def.bri * master) / 255), 1, 255);
  const ix = opts.ix != null ? clamp(Math.floor(opts.ix), 0, 255) : def.ix;
  const g = opts.layout.game;
  const gameSeg: Record<string, unknown> = opts.gameOff
    ? { id: g.id, start: g.start, stop: g.stop, on: false }
    : {
        id: g.id,
        start: g.start,
        stop: g.stop,
        on: true,
        col: [def.col, [0, 0, 0], [0, 0, 0]],
        fx: def.fx,
        sx: def.sx,
        ix,
        pal: 0,
      };
  const segs: Record<string, unknown>[] = [gameSeg];
  if (opts.layout.rest && !opts.gameOff) {
    const r = opts.layout.rest;
    segs.push({
      id: r.id,
      start: r.start,
      stop: r.stop,
      on: false,
      fx: 0,
      col: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    });
  }
  const body: Record<string, unknown> = {
    on: true,
    transition: def.transition,
    seg: segs,
  };
  if (!opts.gameOff) body.bri = bri;
  return body;
}

async function timedFetch(http: WledHttp, url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await http(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(http: WledHttp, url: string, body: unknown): Promise<void> {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  try {
    const res = await timedFetch(http, url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    await new Promise((r) => setTimeout(r, RETRY_MS));
    const res = await timedFetch(http, url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    void err;
  }
}

export function createWledDriver(
  config: Partial<WledConfig>,
  deps: { fetch?: WledHttp; now?: () => number } = {},
): LightingDriver {
  const cfg = mergeWled(DEFAULT_WLED, config);
  const http = deps.fetch ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? Date.now;
  const host = normalizeWledHost(cfg.host);
  const base = wledBaseUrl(host);
  const configured = Boolean(base);
  let follow = Boolean(cfg.enabled) && configured;
  let brightness = clamp(Math.floor(cfg.brightness || DEFAULT_WLED.brightness), 1, 255);
  let layout: WledLayout = resolveWledLayout(cfg);
  let scene: LightingScene | null = null;
  let lastError: string | null = null;
  let probed = false;
  let voteStartedAt = 0;
  let voteDurationMs = 0;
  let lastVoteIx = -1;
  let chain: Promise<void> = Promise.resolve();
  let pending: Record<string, unknown> | null = null;

  function status(): LightingStatus {
    const ledCount = layout.game.stop - layout.game.start;
    if (!configured) return { ...STUB_LIGHTING_STATUS, ledCount, brightness };
    return {
      configured: true,
      follow,
      live: follow,
      backend: "wled",
      host,
      ledCount,
      brightness,
      scene,
      lastError,
    };
  }

  function enqueue(body: Record<string, unknown>): Promise<void> {
    if (!follow || !base) return Promise.resolve();
    pending = body;
    chain = chain.then(flush, flush);
    return chain;
  }

  async function flush(): Promise<void> {
    const body = pending;
    pending = null;
    if (!body || !base || !follow) return;
    try {
      await postJson(http, `${base}/json/state`, body);
      lastError = null;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[wled] ${host} failed:`, lastError);
    }
  }

  async function probeLayout(): Promise<void> {
    if (probed || !base || !follow) return;
    probed = true;
    try {
      const res = await timedFetch(http, `${base}/json/si`, { method: "GET" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        info?: { leds?: { count?: number } };
        state?: { seg?: WledDeviceSeg[] };
      };
      const total = Number(body.info?.leds?.count);
      const segs = Array.isArray(body.state?.seg) ? body.state!.seg! : [];
      layout = resolveWledLayout(cfg, {
        total: Number.isInteger(total) && total > 0 ? total : undefined,
        segs: segs.map((s) => ({
          id: Number(s.id) || 0,
          start: Number(s.start) || 0,
          stop: Number(s.stop) || 0,
          len: Number(s.len) || Math.max(0, Number(s.stop) - Number(s.start)),
        })),
      });
      console.log(
        `[wled] game segment id=${layout.game.id} ${layout.game.start}-${layout.game.stop} (${layout.game.stop - layout.game.start} LEDs)` +
          (layout.rest ? `; leftover ${layout.rest.start}-${layout.rest.stop} off` : ""),
      );
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[wled] layout probe failed:`, lastError);
    }
  }

  function payload(next: LightingScene, extra?: { ix?: number; gameOff?: boolean }): Record<string, unknown> {
    return wledPayloadForScene(next, {
      brightness,
      ix: extra?.ix,
      layout,
      gameOff: extra?.gameOff,
    });
  }

  async function sendScene(next: LightingScene, opts?: LightingApplyOpts): Promise<void> {
    scene = next;
    if (next === "vote" && opts?.durationMs && opts.durationMs > 0) {
      voteStartedAt = now();
      voteDurationMs = opts.durationMs;
      lastVoteIx = -1;
    } else if (next !== "vote") {
      voteStartedAt = 0;
      voteDurationMs = 0;
      lastVoteIx = -1;
    }
    if (!follow || !base) return;
    await probeLayout();
    const ix = next === "vote" && voteDurationMs > 0 ? 0 : undefined;
    await enqueue(payload(next, { ix }));
  }

  return {
    isLive: () => follow,
    status,
    async applyScene(next, opts) {
      scene = next;
      if (next === "vote" && opts?.durationMs && opts.durationMs > 0) {
        voteStartedAt = now();
        voteDurationMs = opts.durationMs;
        lastVoteIx = -1;
      } else if (next !== "vote") {
        voteStartedAt = 0;
        voteDurationMs = 0;
        lastVoteIx = -1;
      }
      if (!configured || !follow) return;
      await sendScene(next, opts);
    },
    beginVoteFill(durationMs) {
      if (!durationMs || durationMs < 1) return;
      voteStartedAt = now();
      voteDurationMs = durationMs;
      lastVoteIx = -1;
    },
    tickVoteClock() {
      if (!follow || !base || scene !== "vote" || voteDurationMs < 1) return Promise.resolve();
      const ratio = clamp((now() - voteStartedAt) / voteDurationMs, 0, 1);
      const ix = Math.round(ratio * 255);
      if (Math.abs(ix - lastVoteIx) < 5) return Promise.resolve();
      lastVoteIx = ix;
      return enqueue(payload("vote", { ix }));
    },
    async setFollow(on) {
      if (!configured) return;
      const next = Boolean(on);
      follow = next;
      if (!follow) {
        voteStartedAt = 0;
        pending = null;
        try {
          // Turn only the game (300) segment off. Do not POST root on:false (that would kill the 277 too).
          await postJson(http, `${base}/json/state`, payload(scene ?? "hush", { gameOff: true }));
          lastError = null;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          console.warn(`[wled] off failed:`, lastError);
        }
        return;
      }
      probed = false;
      if (scene) await sendScene(scene);
    },
    async setBrightness(bri) {
      brightness = clamp(Math.floor(bri), 1, 255);
      if (follow && scene) await sendScene(scene);
    },
    async preview(next) {
      if (!configured) return;
      const was = follow;
      follow = true;
      await sendScene(next);
      follow = was;
    },
  };
}

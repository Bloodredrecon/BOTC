import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Local ROOT — do not import audio-library here (cycle: audio-library → persistence → ambiance).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CUSTOM_AUDIO_DIR = join(ROOT, "data", "audio");

export type AmbianceLayerKind = "loop" | "sporadic";

export type AmbianceLayerDef = {
  id: string;
  label: string;
  hint: string;
  kind: AmbianceLayerKind;
  defaultVolume: number;
  /** Minimum seconds between sporadic one-shots when the layer is enabled. */
  minGapSec?: number;
};

export type AmbianceLayerState = {
  id: string;
  enabled: boolean;
  volume: number;
};

export type AmbianceState = {
  masterVolume: number;
  layers: AmbianceLayerState[];
};

export const AMBIANCE_AUDIO_DIR = join(CUSTOM_AUDIO_DIR, "ambiance");

/** Pack from data/audio/ambiance/ (scripts/generate_ambiance.py). */
const PACK: AmbianceLayerDef[] = [
  { id: "amb_rain", label: "Rain on cobbles", hint: "Soft continuous rain · loop · rain on the TV", kind: "loop", defaultVolume: 0.35 },
  { id: "amb_wind_shutters", label: "Wind / shutters", hint: "Draft through shutters · loop", kind: "loop", defaultVolume: 0.32 },
  { id: "amb_fog_hum", label: "Fog hum", hint: "Low distant stone hum · loop · thickens TV fog", kind: "loop", defaultVolume: 0.32 },
  {
    id: "amb_clocktower_mechanism",
    label: "Clocktower gears",
    hint: "Far slow mechanism · loop",
    kind: "loop",
    defaultVolume: 0.3,
  },
  { id: "amb_candle_hiss", label: "Candle / lamp", hint: "Soft oil-lamp hiss · loop", kind: "loop", defaultVolume: 0.25 },
  { id: "amb_chapel_drone", label: "Chapel drone", hint: "Barely-there organ residual · loop", kind: "loop", defaultVolume: 0.18 },
  { id: "amb_well_drip", label: "Well drip", hint: "Slow drip into stone · loop", kind: "loop", defaultVolume: 0.22 },
  { id: "amb_night_air", label: "Night air", hint: "Quiet countryside night · loop", kind: "loop", defaultVolume: 0.32 },
  {
    id: "amb_crow_1",
    label: "Crow 1",
    hint: "Single raven call · sporadic",
    kind: "sporadic",
    defaultVolume: 0.4,
    minGapSec: 45,
  },
  {
    id: "amb_crow_2",
    label: "Crow 2",
    hint: "Raven call (alt) · sporadic",
    kind: "sporadic",
    defaultVolume: 0.4,
    minGapSec: 45,
  },
  {
    id: "amb_crow_3",
    label: "Crow 3",
    hint: "Raven call (alt) · sporadic",
    kind: "sporadic",
    defaultVolume: 0.38,
    minGapSec: 45,
  },
  {
    id: "amb_creak_1",
    label: "Creak 1",
    hint: "Wood / shutter creak · sporadic",
    kind: "sporadic",
    defaultVolume: 0.32,
    minGapSec: 35,
  },
  {
    id: "amb_creak_2",
    label: "Creak 2",
    hint: "Wood creak (alt) · sporadic",
    kind: "sporadic",
    defaultVolume: 0.32,
    minGapSec: 35,
  },
  {
    id: "amb_whisper_1",
    label: "Whisper 1",
    hint: "Unintelligible fragment · sporadic",
    kind: "sporadic",
    defaultVolume: 0.35,
    minGapSec: 60,
  },
  {
    id: "amb_whisper_2",
    label: "Whisper 2",
    hint: "Unintelligible fragment · sporadic",
    kind: "sporadic",
    defaultVolume: 0.34,
    minGapSec: 60,
  },
  {
    id: "amb_shutter_slam",
    label: "Shutter slam",
    hint: "One slam in wind · sporadic",
    kind: "sporadic",
    defaultVolume: 0.35,
    minGapSec: 50,
  },
  {
    id: "amb_footsteps_wet",
    label: "Wet footsteps",
    hint: "Brief pass on wet stone · sporadic",
    kind: "sporadic",
    defaultVolume: 0.3,
    minGapSec: 55,
  },
  {
    id: "amb_well_bucket",
    label: "Well bucket",
    hint: "Bucket / chain splash · sporadic",
    kind: "sporadic",
    defaultVolume: 0.34,
    minGapSec: 70,
  },
  {
    id: "amb_church_door",
    label: "Church door",
    hint: "Heavy door close · sporadic",
    kind: "sporadic",
    defaultVolume: 0.36,
    minGapSec: 80,
  },
  {
    id: "amb_rats_skitter",
    label: "Rats",
    hint: "Short skitter in walls · sporadic",
    kind: "sporadic",
    defaultVolume: 0.28,
    minGapSec: 40,
  },
  {
    id: "amb_gallows_creak",
    label: "Gallows creak",
    hint: "Rope / wood stress · sporadic",
    kind: "sporadic",
    defaultVolume: 0.24,
    minGapSec: 75,
  },
  {
    id: "amb_half_chime",
    label: "Half-chime",
    hint: "Soft distant partial chime · sporadic",
    kind: "sporadic",
    defaultVolume: 0.26,
    minGapSec: 90,
  },
  {
    id: "amb_owl_1",
    label: "Owl",
    hint: "One night-bird call · sporadic",
    kind: "sporadic",
    defaultVolume: 0.34,
    minGapSec: 50,
  },
];

/** Legacy beds still useful alongside the amb_ pack (root data/audio/). */
const LEGACY: AmbianceLayerDef[] = [
  { id: "day_bed", label: "Day bed", hint: "General daytime loop", kind: "loop", defaultVolume: 0.4 },
  { id: "night_bed", label: "Night bed", hint: "General nighttime loop", kind: "loop", defaultVolume: 0.4 },
  { id: "atm_fog", label: "Fog (legacy)", hint: "Misty atmosphere · loop", kind: "loop", defaultVolume: 0.35 },
  { id: "atm_ravens", label: "Ravens (legacy)", hint: "Corvids overhead · loop", kind: "loop", defaultVolume: 0.35 },
  { id: "atm_whisper", label: "Whispers (legacy)", hint: "Soft murmur · loop", kind: "loop", defaultVolume: 0.3 },
  { id: "atm_clocktower", label: "Clocktower (legacy)", hint: "Distant tower · loop", kind: "loop", defaultVolume: 0.3 },
  { id: "atm_sleep", label: "Sleep", hint: "Quiet rest · loop", kind: "loop", defaultVolume: 0.35 },
  { id: "atm_day_quiet", label: "Quiet square", hint: "Still daytime · loop", kind: "loop", defaultVolume: 0.35 },
  { id: "atm_evil_walks", label: "Evil walks", hint: "Low unease · loop", kind: "loop", defaultVolume: 0.35 },
  { id: "atm_good_hope", label: "Good hope", hint: "Soft hopeful bed · loop", kind: "loop", defaultVolume: 0.35 },
  { id: "atm_blood_remember", label: "Blood remembers", hint: "Ominous memory · loop", kind: "loop", defaultVolume: 0.35 },
  { id: "atm_trust", label: "Trust", hint: "Uneasy calm · loop", kind: "loop", defaultVolume: 0.35 },
];

const EXTRA_NAME_RE = /^(rain|crows?|whispers?|ambiance|ambience|amb_|loop_|bed_)/i;
const AUDIO_EXT = /\.(wav|mp3|ogg|m4a|webm)$/i;
const SPORADIC_NAME_RE = /_(crow|creak|whisper|slam|footsteps|bucket|door|rats|gallows|chime|owl)(_|$)/i;

function baseOf(name: string): string {
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}

function labelFromId(id: string): string {
  return id.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferKind(id: string): AmbianceLayerKind {
  if (SPORADIC_NAME_RE.test(id)) return "sporadic";
  // Numbered one-shot style amb_foo_1
  if (/^amb_.+_\d+$/i.test(id) && !/rain|wind|fog|hum|drone|drip|air|mechanism|hiss|candle|chapel|clock/i.test(id)) {
    return "sporadic";
  }
  return "loop";
}

function fileExistsForId(id: string): boolean {
  const lower = id.toLowerCase();
  if (existsSync(AMBIANCE_AUDIO_DIR)) {
    for (const name of readdirSync(AMBIANCE_AUDIO_DIR)) {
      if (!AUDIO_EXT.test(name)) continue;
      if (baseOf(name) === lower) return true;
    }
  }
  if (existsSync(CUSTOM_AUDIO_DIR)) {
    for (const name of readdirSync(CUSTOM_AUDIO_DIR)) {
      if (!AUDIO_EXT.test(name)) continue;
      if (baseOf(name) === lower) return true;
    }
  }
  return false;
}

/** Resolve layer id → playable cue (`custom:ambiance/amb_rain.mp3` or builtin/custom root). */
export function resolveAmbianceCueId(layerId: string): string {
  const lower = layerId.toLowerCase();
  if (existsSync(AMBIANCE_AUDIO_DIR)) {
    for (const name of readdirSync(AMBIANCE_AUDIO_DIR)) {
      if (!AUDIO_EXT.test(name)) continue;
      if (baseOf(name) === lower) return `custom:ambiance/${name}`;
    }
  }
  if (existsSync(CUSTOM_AUDIO_DIR)) {
    for (const name of readdirSync(CUSTOM_AUDIO_DIR)) {
      if (!AUDIO_EXT.test(name)) continue;
      if (baseOf(name) === lower) return `custom:${name}`;
    }
  }
  return layerId;
}

/** Catalog for Storyteller UI — amb_ pack (if files present) + legacy + extras. */
export function listAmbianceCatalog(): AmbianceLayerDef[] {
  const seen = new Set<string>();
  const out: AmbianceLayerDef[] = [];

  const push = (def: AmbianceLayerDef) => {
    if (seen.has(def.id)) return;
    seen.add(def.id);
    out.push(def);
  };

  // Prefer pack entries that have files on disk.
  for (const def of PACK) {
    if (fileExistsForId(def.id)) push(def);
  }
  // Before generation: still show expected pack so the Ambiance tab isn't empty.
  if (![...seen].some((id) => id.startsWith("amb_"))) {
    for (const def of PACK) push(def);
  }

  for (const def of LEGACY) {
    if (fileExistsForId(def.id)) push(def);
  }

  // Scan ambiance/ for any extra amb_* files not in PACK.
  if (existsSync(AMBIANCE_AUDIO_DIR)) {
    for (const name of readdirSync(AMBIANCE_AUDIO_DIR)) {
      if (!AUDIO_EXT.test(name)) continue;
      const base = baseOf(name);
      if (seen.has(base)) continue;
      const kind = inferKind(base);
      push({
        id: base,
        label: labelFromId(base),
        hint: `Custom ${kind} · ambiance/${name}`,
        kind,
        defaultVolume: kind === "sporadic" ? 0.32 : 0.35,
        minGapSec: kind === "sporadic" ? 45 : undefined,
      });
    }
  }

  // Root data/audio extras matching name pattern.
  if (existsSync(CUSTOM_AUDIO_DIR)) {
    for (const name of readdirSync(CUSTOM_AUDIO_DIR)) {
      if (!AUDIO_EXT.test(name)) continue;
      const base = baseOf(name);
      if (seen.has(base)) continue;
      if (!EXTRA_NAME_RE.test(base) && !EXTRA_NAME_RE.test(name)) continue;
      const kind = inferKind(base);
      push({
        id: base,
        label: labelFromId(base),
        hint: `Custom ${kind} · ${name}`,
        kind,
        defaultVolume: 0.35,
        minGapSec: kind === "sporadic" ? 45 : undefined,
      });
    }
  }

  return out;
}

export function defaultAmbiance(): AmbianceState {
  return {
    masterVolume: 0.7,
    layers: listAmbianceCatalog().map((def) => ({
      id: def.id,
      enabled: false,
      volume: def.defaultVolume,
    })),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Merge saved / client patch with current catalog so new layers appear after rescan. */
export function normalizeAmbiance(raw?: Partial<AmbianceState> | null): AmbianceState {
  const catalog = listAmbianceCatalog();
  const prevById = new Map((raw?.layers ?? []).map((l) => [l.id, l]));
  return {
    masterVolume: clamp01(raw?.masterVolume ?? 0.7),
    layers: catalog.map((def) => {
      const prev = prevById.get(def.id);
      return {
        id: def.id,
        enabled: Boolean(prev?.enabled),
        volume: clamp01(prev?.volume ?? def.defaultVolume),
      };
    }),
  };
}

export type AmbiancePublicLayer = AmbianceLayerState & {
  cueId: string;
  kind: AmbianceLayerKind;
  minGapSec?: number;
};

export type AmbiancePublicState = {
  masterVolume: number;
  layers: AmbiancePublicLayer[];
};

/** Resolve each layer to a playable cue id for the TV. */
export function toAmbiancePublic(state: AmbianceState): AmbiancePublicState {
  const catalog = listAmbianceCatalog();
  const byId = new Map(catalog.map((d) => [d.id, d]));
  return {
    masterVolume: state.masterVolume,
    layers: state.layers.map((l) => {
      const def = byId.get(l.id);
      return {
        ...l,
        cueId: resolveAmbianceCueId(l.id),
        kind: def?.kind ?? "loop",
        minGapSec: def?.minGapSec,
      };
    }),
  };
}

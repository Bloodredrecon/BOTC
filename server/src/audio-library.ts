import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./persistence.js";

export type AudioCueGroup =
  | "core"
  | "phase"
  | "votes"
  | "deaths"
  | "endgame"
  | "guests"
  | "rules"
  | "atmosphere"
  | "other";

export type AudioCueInfo = {
  id: string;
  label: string;
  file: string;
  builtin: boolean;
  group: AudioCueGroup;
  subgroup?: string;
};

/** Display order for Storyteller soundboard sections */
export const AUDIO_GROUP_ORDER: { id: AudioCueGroup; label: string }[] = [
  { id: "core", label: "Core / beds" },
  { id: "phase", label: "Day & night" },
  { id: "votes", label: "Votes & judgment" },
  { id: "deaths", label: "Deaths" },
  { id: "endgame", label: "Endgame" },
  { id: "guests", label: "Guests & shots" },
  { id: "rules", label: "Rules teach" },
  { id: "atmosphere", label: "Atmosphere" },
  { id: "other", label: "Other" },
];

type CatalogEntry = { label: string; group: AudioCueGroup; subgroup?: string };

/** Known narration files — labels + UI grouping */
const CATALOG: Record<string, CatalogEntry> = {
  intro: { label: "Intro", group: "core" },
  day_bed: { label: "Day ambience", group: "core" },
  night_bed: { label: "Night ambience", group: "core" },
  hush: { label: "Hush / stop beds", group: "core" },
  night_wake: { label: "Night wake", group: "core" },
  timer_end: { label: "Timer end", group: "core" },

  first_night: { label: "First night", group: "phase" },
  night: { label: "Night", group: "phase" },
  dusk: { label: "Dusk", group: "phase" },
  dawn: { label: "Dawn", group: "phase" },
  day_1: { label: "Day 1", group: "phase" },
  day_2: { label: "Day 2", group: "phase" },
  day_3: { label: "Day 3", group: "phase" },
  day_n: { label: "Day 4+", group: "phase" },

  nomination: { label: "Nomination", group: "votes" },
  vote_open: { label: "Vote open", group: "votes" },
  vote_closed: { label: "Vote closed", group: "votes" },
  majority: { label: "Majority", group: "votes" },
  no_majority: { label: "No majority", group: "votes" },
  tie: { label: "Tie", group: "votes" },
  about_to_die: { label: "About to die", group: "votes" },
  lives: { label: "Lives", group: "votes" },
  execution: { label: "Execution", group: "votes" },

  death: { label: "Death", group: "deaths" },
  no_deaths: { label: "No deaths", group: "deaths" },
  someone_died: { label: "Someone died", group: "deaths" },
  multiple_deaths: { label: "Multiple deaths", group: "deaths" },

  good_wins: { label: "Good wins", group: "endgame" },
  evil_wins: { label: "Evil wins", group: "endgame" },
  reveal: { label: "Reveal", group: "endgame" },
  sacred_blood: { label: "Sacred blood", group: "endgame" },
  three_stand: { label: "Three stand", group: "endgame" },

  guest_arrive: { label: "Guest arrives", group: "guests" },
  guest_depart: { label: "Guest departs", group: "guests" },
  public_shot: { label: "Public shot", group: "guests" },
  public_shot_true: { label: "Shot hits (evil)", group: "guests" },
  public_shot_false: { label: "Shot misses", group: "guests" },

  rules_full: { label: "Full rules (all)", group: "rules", subgroup: "Play all" },
  rules_overview: { label: "1. Overview", group: "rules", subgroup: "Chapters" },
  rules_teams: { label: "2. Teams", group: "rules", subgroup: "Chapters" },
  rules_setup: { label: "3. Setup", group: "rules", subgroup: "Chapters" },
  rules_night: { label: "4. Night", group: "rules", subgroup: "Chapters" },
  rules_day: { label: "5. Day", group: "rules", subgroup: "Chapters" },
  rules_execution: { label: "6. Execution", group: "rules", subgroup: "Chapters" },
  rules_death: { label: "7. The dead", group: "rules", subgroup: "Chapters" },
  rules_abilities: { label: "8. Abilities", group: "rules", subgroup: "Chapters" },
  rules_win: { label: "9. Winning", group: "rules", subgroup: "Chapters" },
  rules_travellers: { label: "10. Travellers", group: "rules", subgroup: "Chapters" },
  rules_etiquette: { label: "11. Etiquette", group: "rules", subgroup: "Chapters" },

  atm_gather: { label: "Gather", group: "atmosphere", subgroup: "Lobby" },
  atm_rules_quiet: { label: "Rules quiet", group: "atmosphere", subgroup: "Lobby" },
  atm_begin: { label: "Begin", group: "atmosphere", subgroup: "Lobby" },

  atm_day_watch: { label: "Day watch", group: "atmosphere", subgroup: "Day" },
  atm_day_doubt: { label: "Day doubt", group: "atmosphere", subgroup: "Day" },
  atm_day_neighbors: { label: "Neighbors", group: "atmosphere", subgroup: "Day" },
  atm_day_lies: { label: "Lies", group: "atmosphere", subgroup: "Day" },
  atm_day_time: { label: "Time short", group: "atmosphere", subgroup: "Day" },
  atm_day_quiet: { label: "Quiet square", group: "atmosphere", subgroup: "Day" },
  atm_day_accuse: { label: "Accusation", group: "atmosphere", subgroup: "Day" },
  atm_day_defend: { label: "Stories shift", group: "atmosphere", subgroup: "Day" },
  atm_day_dead_listen: { label: "Dead listen", group: "atmosphere", subgroup: "Day" },
  atm_day_final_hours: { label: "Final hours", group: "atmosphere", subgroup: "Day" },
  atm_day_three_live: { label: "Few remain", group: "atmosphere", subgroup: "Day" },

  atm_dusk_warning: { label: "Dusk warning", group: "atmosphere", subgroup: "Nightfall" },
  atm_eyes_closing: { label: "Eyes closing", group: "atmosphere", subgroup: "Nightfall" },
  atm_sleep: { label: "Sleep", group: "atmosphere", subgroup: "Nightfall" },

  atm_dawn_dread: { label: "Dawn dread", group: "atmosphere", subgroup: "Dawn" },
  atm_dawn_waiting: { label: "Dawn waiting", group: "atmosphere", subgroup: "Dawn" },
  atm_dawn_empty: { label: "No new blood", group: "atmosphere", subgroup: "Dawn" },
  atm_dawn_loss: { label: "Grief", group: "atmosphere", subgroup: "Dawn" },

  atm_nominate_tension: { label: "Nominate tension", group: "atmosphere", subgroup: "Votes" },
  atm_hands_ready: { label: "Hands ready", group: "atmosphere", subgroup: "Votes" },
  atm_count_rising: { label: "Count rising", group: "atmosphere", subgroup: "Votes" },
  atm_count_falling: { label: "Count falling", group: "atmosphere", subgroup: "Votes" },
  atm_last_chance: { label: "Last chance", group: "atmosphere", subgroup: "Votes" },
  atm_silence_for_vote: { label: "Silence for vote", group: "atmosphere", subgroup: "Votes" },

  atm_gallows: { label: "Gallows", group: "atmosphere", subgroup: "Execution" },
  atm_final_words: { label: "Final words", group: "atmosphere", subgroup: "Execution" },
  atm_after_death: { label: "After death", group: "atmosphere", subgroup: "Execution" },
  atm_survived: { label: "Survived", group: "atmosphere", subgroup: "Execution" },

  atm_clocktower: { label: "Clocktower", group: "atmosphere", subgroup: "Town color" },
  atm_ravens: { label: "Ravens", group: "atmosphere", subgroup: "Town color" },
  atm_fog: { label: "Fog", group: "atmosphere", subgroup: "Town color" },
  atm_bell: { label: "Bell", group: "atmosphere", subgroup: "Town color" },
  atm_blood_remember: { label: "Blood remembers", group: "atmosphere", subgroup: "Town color" },
  atm_whisper: { label: "Whispers", group: "atmosphere", subgroup: "Town color" },
  atm_trust: { label: "Trust", group: "atmosphere", subgroup: "Town color" },
  atm_evil_walks: { label: "Evil walks", group: "atmosphere", subgroup: "Town color" },
  atm_good_hope: { label: "Good hope", group: "atmosphere", subgroup: "Town color" },
  atm_guest: { label: "Stranger", group: "atmosphere", subgroup: "Town color" },

  atm_before_reveal: { label: "Before reveal", group: "atmosphere", subgroup: "End" },
  atm_after_good: { label: "After good", group: "atmosphere", subgroup: "End" },
  atm_after_evil: { label: "After evil", group: "atmosphere", subgroup: "End" },

  atm_sting_tension: { label: "Sting · careful", group: "atmosphere", subgroup: "Stings" },
  atm_sting_doom: { label: "Sting · doom", group: "atmosphere", subgroup: "Stings" },
  atm_sting_hope: { label: "Sting · hope", group: "atmosphere", subgroup: "Stings" },
  atm_sting_shock: { label: "Sting · shock", group: "atmosphere", subgroup: "Stings" },
};

const BUILTIN_FILES: { id: string; file: string }[] = [
  { id: "intro", file: "intro.wav" },
  { id: "day_bed", file: "day_bed.wav" },
  { id: "night_bed", file: "night_bed.wav" },
  { id: "dawn", file: "dawn.wav" },
  { id: "nomination", file: "nomination.wav" },
  { id: "execution", file: "execution.wav" },
  { id: "death", file: "death.wav" },
  { id: "timer_end", file: "timer_end.wav" },
  { id: "night_wake", file: "night_wake.wav" },
  { id: "hush", file: "hush.wav" },
];

export const CUSTOM_AUDIO_DIR = join(ROOT, "data", "audio");
export const PUBLIC_AUDIO_DIR = join(ROOT, "web", "public", "audio");

const AUDIO_EXT = new Set([".wav", ".mp3", ".ogg", ".m4a", ".webm"]);

function baseOf(name: string): string {
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}

/** Letter suffixes for interchangeable takes of the same moment (`nomination_b`). */
const VARIANT_LETTERS = ["b", "c", "d"] as const;

/** Parent cue id for `nomination_b` → `nomination`; null if not a lettered variant. */
function parentCueBase(base: string): string | null {
  const m = base.match(/^(.*)_([bcd])$/i);
  return m ? m[1].toLowerCase() : null;
}

function metaFor(base: string): CatalogEntry {
  if (CATALOG[base]) return CATALOG[base];
  const parent = parentCueBase(base);
  if (parent && CATALOG[parent]) {
    const letter = base.slice(parent.length + 1).toUpperCase();
    const p = CATALOG[parent];
    return { label: `${p.label} (${letter})`, group: p.group, subgroup: p.subgroup };
  }
  if (base.startsWith("rules_")) return { label: labelFromFilename(base), group: "rules", subgroup: "Chapters" };
  if (base.startsWith("atm_")) return { label: labelFromFilename(base), group: "atmosphere", subgroup: "Other" };
  return { label: labelFromFilename(base), group: "other" };
}

/** Cue ids present on disk / builtins (bare ids like `nomination`, `nomination_b`). */
function availableCueBases(): Set<string> {
  const out = new Set<string>();
  for (const c of listAudioCues()) {
    if (c.id.startsWith("custom:")) out.add(baseOf(c.file));
    else out.add(c.id);
  }
  return out;
}

/**
 * Expand cue ids to include lettered sibling takes that exist
 * (`nomination` → `nomination`, `nomination_b`, `nomination_c`, …).
 * Soundboard still lists each file individually; this is for automated pickSound.
 */
export function expandSoundVariants(...bases: string[]): string[] {
  if (bases.length === 0) return [];
  const available = availableCueBases();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of bases) {
    const base = raw.replace(/^custom:/, "").replace(/\.[^.]+$/, "").toLowerCase();
    if (!base) continue;
    const candidates = [base, ...VARIANT_LETTERS.map((l) => `${base}_${l}`)];
    for (const id of candidates) {
      if (seen.has(id)) continue;
      if (available.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out.length > 0 ? out : bases.map((b) => b.replace(/^custom:/, "").replace(/\.[^.]+$/, ""));
}

function labelFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ensureAudioDirs(): void {
  mkdirSync(CUSTOM_AUDIO_DIR, { recursive: true });
  mkdirSync(join(CUSTOM_AUDIO_DIR, "ambiance"), { recursive: true });
  const readme = join(CUSTOM_AUDIO_DIR, "README.txt");
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      `Drop audio files here (wav/mp3/ogg).\nName them for the soundboard, e.g.:\n  intro.mp3\n  night.mp3\n  dawn.wav\n  rules_overview.mp3\n\nAmbiance beds/one-shots go in data/audio/ambiance/ (served at /custom-audio/ambiance/…).\nRestart is not required — tap Rescan on the Soundboard or Ambiance tab.\nFiles are served at /custom-audio/<filename>\n`,
      "utf-8",
    );
  }
}

function sortCues(cues: AudioCueInfo[]): AudioCueInfo[] {
  const groupRank = new Map(AUDIO_GROUP_ORDER.map((g, i) => [g.id, i]));
  return cues.sort((a, b) => {
    const ga = groupRank.get(a.group) ?? 99;
    const gb = groupRank.get(b.group) ?? 99;
    if (ga !== gb) return ga - gb;
    const sa = a.subgroup ?? "";
    const sb = b.subgroup ?? "";
    if (sa !== sb) return sa.localeCompare(sb);
    return a.label.localeCompare(b.label);
  });
}

export function listAudioCues(): AudioCueInfo[] {
  ensureAudioDirs();
  const customByBase = new Map<string, { file: string; id: string }>();
  if (existsSync(CUSTOM_AUDIO_DIR)) {
    for (const name of readdirSync(CUSTOM_AUDIO_DIR)) {
      const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
      if (!AUDIO_EXT.has(ext)) continue;
      customByBase.set(baseOf(name), { file: name, id: `custom:${name}` });
    }
  }

  const seen = new Set<string>();
  const out: AudioCueInfo[] = [];

  for (const b of BUILTIN_FILES) {
    const base = b.id;
    seen.add(base);
    const override = customByBase.get(base);
    const meta = metaFor(base);
    if (override) {
      out.push({
        id: override.id,
        file: override.file,
        builtin: false,
        label: meta.label,
        group: meta.group,
        subgroup: meta.subgroup,
      });
    } else {
      out.push({
        id: b.id,
        file: b.file,
        builtin: true,
        label: meta.label,
        group: meta.group,
        subgroup: meta.subgroup,
      });
    }
  }

  for (const [base, file] of customByBase) {
    if (seen.has(base)) continue;
    const meta = metaFor(base);
    out.push({
      id: file.id,
      file: file.file,
      builtin: false,
      label: meta.label,
      group: meta.group,
      subgroup: meta.subgroup,
    });
  }

  return sortCues(out);
}

/** Map a bare cue id (`nomination`) or custom id to the id the TV should play. Prefers data/audio overrides. */
export function resolveSoundCueId(cueId: string): string {
  if (!cueId) return cueId;
  const cues = listAudioCues();
  const match =
    cues.find((c) => c.id === cueId) ||
    cues.find((c) => c.id === `custom:${cueId}`) ||
    cues.find((c) => c.file.replace(/\.[^.]+$/, "").toLowerCase() === cueId.toLowerCase()) ||
    cues.find((c) => c.id.endsWith(`:${cueId}.mp3`) || c.id.endsWith(`:${cueId}.wav`));
  return match?.id ?? cueId;
}

export function resolveCueUrl(cueId: string): string | null {
  if (!cueId) return null;
  const resolved = resolveSoundCueId(cueId);
  if (resolved.startsWith("custom:")) {
    const file = resolved.slice("custom:".length);
    const abs = join(CUSTOM_AUDIO_DIR, ...file.split("/"));
    if (existsSync(abs)) {
      const path = file
        .split("/")
        .map((seg) => encodeURIComponent(seg))
        .join("/");
      return `/custom-audio/${path}`;
    }
    return null;
  }
  if (cueId.startsWith("custom:")) {
    const file = cueId.slice("custom:".length);
    const abs = join(CUSTOM_AUDIO_DIR, ...file.split("/"));
    if (existsSync(abs)) {
      const path = file
        .split("/")
        .map((seg) => encodeURIComponent(seg))
        .join("/");
      return `/custom-audio/${path}`;
    }
    return null;
  }
  const builtin = BUILTIN_FILES.find((b) => b.id === resolved || b.id === cueId);
  if (builtin) {
    const base = builtin.id;
    if (existsSync(CUSTOM_AUDIO_DIR)) {
      for (const name of readdirSync(CUSTOM_AUDIO_DIR)) {
        if (baseOf(name) === base && AUDIO_EXT.has(name.slice(name.lastIndexOf(".")).toLowerCase())) {
          return `/custom-audio/${encodeURIComponent(name)}`;
        }
      }
    }
    return `/audio/${builtin.file}`;
  }
  if (existsSync(join(CUSTOM_AUDIO_DIR, cueId))) {
    return `/custom-audio/${encodeURIComponent(cueId)}`;
  }
  if (existsSync(join(PUBLIC_AUDIO_DIR, cueId))) {
    return `/audio/${cueId}`;
  }
  return `/audio/${cueId}.wav`;
}

/** Copy placeholder intro if missing in public audio */
export function ensureIntroPlaceholder(): void {
  const intro = join(PUBLIC_AUDIO_DIR, "intro.wav");
  const hush = join(PUBLIC_AUDIO_DIR, "hush.wav");
  if (!existsSync(intro) && existsSync(hush)) {
    writeFileSync(intro, readFileSync(hush));
  }
}

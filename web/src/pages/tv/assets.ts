import type { Phase, PublicState } from "../../types";

/** Scene plates — see docs/TV_SCENE_PLATES.md (workflow I). */
declare const __TV_BG_MTIME__: string;
declare const __TV_BG_PLATES__: Record<string, { file: string; mtime: string; hasLogo?: boolean }>;

const TV_BG_PLATES: Record<string, { file: string; mtime: string; hasLogo?: boolean }> =
  typeof __TV_BG_PLATES__ !== "undefined" && __TV_BG_PLATES__
    ? __TV_BG_PLATES__
    : { night: { file: "/tv/bg-night.png", mtime: __TV_BG_MTIME__ } };

export type TvPlateKey =
  | "night"
  | "dawn"
  | "day"
  | "day2"
  | "nomination"
  | "gallows"
  | "good-win"
  | "evil-win";

export function plateUrl(key: TvPlateKey): string {
  const hit = TV_BG_PLATES[key] ?? TV_BG_PLATES.night;
  const file = hit?.file ?? "/tv/bg-night.png";
  const mtime = hit?.mtime ?? __TV_BG_MTIME__ ?? "0";
  return `${file}?v=${mtime}`;
}

function hasPlate(key: TvPlateKey): boolean {
  return Boolean(TV_BG_PLATES[key]);
}

/** Plate art already carries the logo top-left (public/tv/plates.json) — skip the CSS wordmark. */
export function plateHasLogo(key: TvPlateKey): boolean {
  return (TV_BG_PLATES[key] ?? TV_BG_PLATES.night)?.hasLogo === true;
}

/** Day 1 (and the lobby) uses `day`; day 2 onward uses `day2` when that plate exists. */
function dayPlate(dayNumber: number | undefined): TvPlateKey | null {
  if ((dayNumber ?? 0) >= 2 && hasPlate("day2")) return "day2";
  return hasPlate("day") ? "day" : null;
}

/** Phase (+ winner, day number) → plate key; missing optional files fall back toward night. */
export function plateKeyForPhase(
  phase: Phase | undefined,
  winner?: PublicState["winner"],
  dayNumber?: number,
): TvPlateKey {
  switch (phase) {
    case "firstNight":
    case "night":
      return "night";
    case "dawn":
      return hasPlate("dawn") ? "dawn" : "night";
    case "dusk":
      // Nominations open (dusk announcement, the hub between votes, the post-execution hold).
      if (hasPlate("nomination")) return "nomination";
      return hasPlate("dawn") ? "dawn" : "night";
    case "nomination":
    case "vote":
    case "execution":
      if (hasPlate("gallows")) return "gallows";
      return dayPlate(dayNumber) ?? "night";
    case "ended":
      if (winner === "good" && hasPlate("good-win")) return "good-win";
      if (winner === "evil" && hasPlate("evil-win")) return "evil-win";
      return dayPlate(dayNumber) ?? "night";
    case "day":
      return dayPlate(dayNumber) ?? "night";
    case "lobby":
      return hasPlate("day") ? "day" : "night";
    default:
      return "night";
  }
}

/** Text-free chrome built by scripts/build_tv_overhaul_assets.py. */
export const TV_EL = {
  plaque: "/tv/elements/plaque-oak.png",
  townFrame: "/tv/elements/town-frame-blank.png",
  voteRing: "/tv/elements/vote-ring-blank.png",
  nominationPlaque: "/tv/elements/nomination-plaque-clean.png",
  executionPlacard: "/tv/elements/execution-placard-clean.png",
  emblemSun: "/tv/elements/emblem-sun.png",
  emblemSkull: "/tv/elements/emblem-skull.png",
  graveyard: "/tv/elements/dawn-graveyard.jpg",
} as const;

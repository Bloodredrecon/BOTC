/**
 * Pre-game checks that need the server's own knowledge (used by `BOTC.bat check`).
 * Read-only: never writes the session. Prints JSON with --json, readable lines otherwise.
 */
import { accessSync, constants, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveCueUrl, CUSTOM_AUDIO_DIR, PUBLIC_AUDIO_DIR } from "./audio-library.js";
import { GAME_LOG_DIR, loadConfig, ROOT, SESSION_PATH } from "./persistence.js";
import { DEFAULT_PIN } from "./pin-guard.js";

export type CheckStatus = "ok" | "warn" | "fail";
export type CheckResult = { status: CheckStatus; name: string; detail: string };

/** First cue of every family the engine plays (the pickSound / pickSoundOrFallback calls in game.ts). */
export const ENGINE_CUE_FAMILIES = [
  "about_to_die",
  "dawn",
  "death",
  "dusk",
  "evil_wins",
  "execution",
  "first_night",
  "good_wins",
  "guest_arrive",
  "guest_depart",
  "lives",
  "majority",
  "multiple_deaths",
  "night",
  "no_deaths",
  "no_majority",
  "nomination",
  "public_shot",
  "public_shot_false",
  "public_shot_true",
  "reveal",
  "sacred_blood",
  "someone_died",
  "tie",
  "timer_end",
  "vote_open",
  "day_1",
  "day_2",
  "day_3",
  "day_n",
] as const;

const PLATE_KEYS = ["night", "dawn", "day", "day2", "nomination", "gallows", "good-win", "evil-win"] as const;

function cueFileExists(url: string | null, webRoot: string): boolean {
  if (!url) return false;
  const path = decodeURIComponent(url);
  if (path.startsWith("/custom-audio/")) return existsSync(join(CUSTOM_AUDIO_DIR, path.slice("/custom-audio/".length)));
  if (path.startsWith("/audio/")) {
    const rel = path.slice("/audio/".length);
    return existsSync(join(webRoot, "audio", rel)) || existsSync(join(PUBLIC_AUDIO_DIR, rel));
  }
  return false;
}

export function runPreflight(): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (status: CheckStatus, name: string, detail: string) => out.push({ status, name, detail });

  let config: ReturnType<typeof loadConfig> | null = null;
  try {
    config = loadConfig();
    add("ok", "Config", `port ${config.port}, host ${config.host}`);
  } catch (err) {
    add("fail", "Config", `config/default.json could not be read: ${String(err)}`);
  }
  if (config) {
    if (config.storytellerPin === DEFAULT_PIN) {
      add("warn", "Storyteller PIN", "still the default; anyone on the network could open the grimoire (Settings > PIN)");
    } else {
      add("ok", "Storyteller PIN", `changed from the default (${config.storytellerPin.length} digits)`);
    }
    if (config.hue.enabled) add(config.hue.bridgeIp ? "ok" : "warn", "Hue", config.hue.bridgeIp ? `enabled, bridge ${config.hue.bridgeIp}` : "enabled but no bridge IP");
    else add("ok", "Hue", "disabled (lights stay in stub mode)");
  }

  if (!existsSync(SESSION_PATH)) {
    add("ok", "Saved game", "none yet (a new one is created on start)");
  } else {
    try {
      const s = JSON.parse(readFileSync(SESSION_PATH, "utf-8")) as {
        phase?: string;
        dayNumber?: number;
        players?: { leftGame?: boolean; characterId?: string | null }[];
      };
      const seated = (s.players ?? []).filter((p) => !p.leftGame);
      const assigned = seated.filter((p) => p.characterId).length;
      add(
        "ok",
        "Saved game",
        `${s.phase ?? "?"}, day ${s.dayNumber ?? 0}, ${seated.length} players (${assigned} with characters). It resumes on start; Control > New game to start over.`,
      );
    } catch (err) {
      add("fail", "Saved game", `${SESSION_PATH} is not valid JSON (${String(err)}); the server would start a fresh game`);
    }
  }

  const webDist = join(ROOT, "web", "dist");
  if (!existsSync(join(webDist, "index.html"))) {
    add("fail", "Web UI", "web/dist is not built; use Rebuild and start");
  } else {
    add("ok", "Web UI", "built");
  }
  const tvDir = existsSync(join(webDist, "tv")) ? join(webDist, "tv") : join(ROOT, "web", "public", "tv");
  const files = existsSync(tvDir) ? readdirSync(tvDir) : [];
  const has = (k: string) => files.some((f) => new RegExp(`^bg-${k}\\.(png|jpe?g|webp)$`, "i").test(f));
  const missing = PLATE_KEYS.filter((k) => !has(k));
  if (!has("night")) add("fail", "TV scene plates", `bg-night is missing in ${tvDir} (every other plate falls back to it)`);
  else if (missing.length) add("warn", "TV scene plates", `missing ${missing.join(", ")} (fallbacks will be used)`);
  else add("ok", "TV scene plates", `all ${PLATE_KEYS.length} present`);

  const webRoot = existsSync(webDist) ? webDist : join(ROOT, "web", "public");
  const silent = ENGINE_CUE_FAMILIES.filter((c) => !cueFileExists(resolveCueUrl(c), webRoot));
  if (silent.length) {
    add("warn", "Narration / cues", `${silent.length} of ${ENGINE_CUE_FAMILIES.length} have no audio file: ${silent.join(", ")}`);
  } else {
    add("ok", "Narration / cues", `all ${ENGINE_CUE_FAMILIES.length} cue families have audio`);
  }
  const mp3s = existsSync(CUSTOM_AUDIO_DIR) ? readdirSync(CUSTOM_AUDIO_DIR).filter((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f)).length : 0;
  add(mp3s > 0 ? "ok" : "warn", "Custom audio", `${mp3s} files in data/audio`);

  try {
    if (existsSync(GAME_LOG_DIR)) accessSync(GAME_LOG_DIR, constants.W_OK);
    add("ok", "Game log folder", existsSync(GAME_LOG_DIR) ? "writable" : "created on first action");
  } catch {
    add("warn", "Game log folder", `${GAME_LOG_DIR} is not writable; the game runs without a log`);
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const results = runPreflight();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(results));
  } else {
    for (const r of results) console.log(`[${r.status.toUpperCase().padEnd(4)}] ${r.name}: ${r.detail}`);
  }
}

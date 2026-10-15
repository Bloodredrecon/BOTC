import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAmbiance } from "./ambiance.js";
import type {
  CharacterDef,
  FabledDef,
  GameSession,
  Player,
  SetupCounts,
} from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..", "..");
export const DATA_DIR = join(ROOT, "data");
export const SESSION_PATH = process.env.BOTC_SESSION_PATH || join(DATA_DIR, "session.json");
/** Game action log; defaults to a `logs` folder next to the session file (data/logs normally). */
export const GAME_LOG_DIR = process.env.BOTC_LOG_DIR || join(dirname(SESSION_PATH), "logs");
export const SCRIPT_PATH = join(DATA_DIR, "scripts", "trouble-brewing.json");
export const CONFIG_PATH = join(ROOT, "config", "default.json");
export const LOCAL_CONFIG_PATH = join(ROOT, "config", "local.json");
export const HUE_CONFIG_PATH = join(ROOT, "config", "hue.json");

export type AppConfig = {
  port: number;
  host: string;
  storytellerPin: string;
  hue: {
    enabled: boolean;
    bridgeIp: string;
    username: string;
    lights: { ambient: string; accent: string; effect: string };
  };
};

export type ScriptData = {
  id: "trouble-brewing";
  name: string;
  characters: CharacterDef[];
  travellers: CharacterDef[];
  fabled: FabledDef[];
  setupByPlayerCount: Record<string, SetupCounts>;
  firstNightMeta: { id: string; name: string; wakeText: string }[];
  otherNightMeta: { id: string; name: string; wakeText: string }[];
};

function readJson(path: string): Record<string, unknown> {
  // Notepad and Windows PowerShell may write a UTF-8 BOM, which JSON.parse rejects.
  return JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, ""));
}

function mergeHue(base: AppConfig["hue"], patch: unknown): AppConfig["hue"] {
  if (!patch || typeof patch !== "object") return base;
  const p = patch as Partial<AppConfig["hue"]>;
  return { ...base, ...p, lights: { ...base.lights, ...(p.lights ?? {}) } };
}

function parsePort(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/**
 * Precedence (highest wins): env vars > config/local.json > config/default.json.
 * config/hue.json is merged into `hue` after local.json.
 * Env: BOTC_PORT or PORT, BOTC_HOST or HOST, BOTC_PIN.
 */
export function loadConfig(): AppConfig {
  const base = readJson(CONFIG_PATH) as unknown as AppConfig;

  if (existsSync(LOCAL_CONFIG_PATH)) {
    try {
      const local = readJson(LOCAL_CONFIG_PATH);
      if (local.port !== undefined) {
        const port = parsePort(local.port);
        if (port) base.port = port;
        else console.warn(`config/local.json: ignoring invalid port ${JSON.stringify(local.port)}`);
      }
      if (typeof local.host === "string" && local.host.trim()) base.host = local.host.trim();
      if (local.storytellerPin !== undefined && String(local.storytellerPin).trim()) {
        base.storytellerPin = String(local.storytellerPin).trim();
      }
      base.hue = mergeHue(base.hue, local.hue);
    } catch (err) {
      console.warn(`config/local.json could not be read (${String(err)}); using defaults`);
    }
  }

  if (existsSync(HUE_CONFIG_PATH)) {
    try {
      base.hue = mergeHue(base.hue, readJson(HUE_CONFIG_PATH));
    } catch {
      /* ignore */
    }
  }

  const envPort = process.env.BOTC_PORT ?? process.env.PORT;
  if (envPort) {
    const port = parsePort(envPort);
    if (port) base.port = port;
    else console.warn(`Ignoring invalid port env value ${JSON.stringify(envPort)}`);
  }
  const envHost = (process.env.BOTC_HOST ?? process.env.HOST)?.trim();
  if (envHost) base.host = envHost;
  if (process.env.BOTC_PIN) base.storytellerPin = process.env.BOTC_PIN;
  return base;
}

export function loadScript(): ScriptData {
  const raw = JSON.parse(readFileSync(SCRIPT_PATH, "utf-8")) as ScriptData;
  return { ...raw, travellers: raw.travellers ?? [] };
}

export function normalizePlayer(p: Partial<Player> & { id: string; seat: number }): Player {
  return {
    id: p.id,
    seat: p.seat,
    name: p.name ?? `Player ${p.seat}`,
    alive: p.alive ?? true,
    usedGhostVote: p.usedGhostVote ?? false,
    characterId: p.characterId ?? null,
    reminders: p.reminders ?? [],
    notes: p.notes ?? "",
    bluffs: p.bluffs ?? [],
    isTraveller: p.isTraveller ?? false,
    abilityUsed: p.abilityUsed ?? false,
    leftGame: p.leftGame ?? false,
    thinksCharacterId: p.thinksCharacterId ?? null,
    alignment: p.alignment === "good" || p.alignment === "evil" ? p.alignment : null,
    learnedDemon: p.learnedDemon ?? false,
    voteTokens: Math.max(0, Math.floor(Number(p.voteTokens ?? 0)) || 0),
  };
}

const LEGACY_DRUNK_REMINDERS = ["Drunk", "Is the Drunk"];

/**
 * Older sessions stored the Drunk as their apparent Townsfolk + a "Drunk" reminder.
 * The truth is now characterId "drunk" with thinksCharacterId = that Townsfolk.
 */
export function migrateLegacyDrunk(p: Player, townsfolkIds: string[]): Player {
  if (p.characterId === "drunk" || !p.characterId || !townsfolkIds.includes(p.characterId)) return p;
  if (!p.reminders.some((r) => LEGACY_DRUNK_REMINDERS.includes(r))) return p;
  return {
    ...p,
    thinksCharacterId: p.characterId,
    characterId: "drunk",
    reminders: [...p.reminders.filter((r) => !LEGACY_DRUNK_REMINDERS.includes(r)), "Is the Drunk"],
  };
}

export function createEmptySession(playerCount = 8): GameSession {
  const players: Player[] = Array.from({ length: playerCount }, (_, i) =>
    normalizePlayer({
      id: `p${i + 1}`,
      seat: i + 1,
      name: `Player ${i + 1}`,
    }),
  );

  return {
    scriptId: "trouble-brewing",
    phase: "lobby",
    dayNumber: 0,
    players,
    fabled: [],
    publicLog: [],
    night: null,
    timer: null,
    nomination: null,
    dawnDeathIds: [],
    dawnDeathsAnnounced: false,
    executionPendingId: null,
    executedTodayId: null,
    executionOccurredToday: false,
    newDemons: [],
    baronInSetup: false,
    exile: null,
    tvSheet: false,
    allowOver15: false,
    nominationsToday: [],
    block: null,
    nominationsOpen: false,
    nightPending: false,
    diedTonightIds: [],
    winner: null,
    winReason: null,
    stNotices: [],
    ambiance: normalizeAmbiance(null),
    tvConnected: false,
    storytellerConnected: false,
  };
}

export function loadSession(): GameSession {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(SESSION_PATH)) {
    const session = createEmptySession();
    saveSession(session);
    return session;
  }
  try {
    const { duskPending: legacyDuskPending, ...raw } = JSON.parse(readFileSync(SESSION_PATH, "utf-8")) as GameSession & {
      duskPending?: boolean;
    };
    const base = createEmptySession(raw.players?.length || 8);
    let townsfolkIds: string[] = [];
    try {
      townsfolkIds = loadScript().characters.filter((c) => c.team === "townsfolk").map((c) => c.id);
    } catch {
      /* script unreadable — skip the Drunk migration */
    }
    const day = Math.max(1, raw.dayNumber || 1);
    const executionLoggedToday = (raw.publicLog ?? []).some(
      (e) => e.type === "execution" && e.dayNumber === day,
    );
    const inDay = ["day", "dusk", "nomination", "vote", "execution"].includes(raw.phase);
    return {
      ...base,
      ...raw,
      players: (raw.players ?? base.players)
        .map((p, i) => normalizePlayer({ ...p, id: p.id ?? `p${i + 1}`, seat: p.seat ?? i + 1 }))
        .map((p) => migrateLegacyDrunk(p, townsfolkIds)),
      executedTodayId: raw.executedTodayId ?? null,
      executionOccurredToday:
        typeof raw.executionOccurredToday === "boolean"
          ? raw.executionOccurredToday
          : inDay && (Boolean(raw.executedTodayId) || executionLoggedToday),
      newDemons: Array.isArray(raw.newDemons) ? raw.newDemons : [],
      baronInSetup: Boolean(raw.baronInSetup),
      exile: raw.exile ?? null,
      tvSheet: Boolean(raw.tvSheet),
      allowOver15: Boolean(raw.allowOver15),
      nominationsToday: Array.isArray(raw.nominationsToday) ? raw.nominationsToday : [],
      block: raw.block ?? null,
      nominationsOpen: Boolean(raw.nominationsOpen),
      nightPending: Boolean(raw.nightPending ?? legacyDuskPending),
      dawnDeathsAnnounced: Boolean(raw.dawnDeathsAnnounced),
      diedTonightIds: raw.diedTonightIds ?? [],
      winner: raw.winner ?? null,
      winReason: raw.winReason ?? null,
      stNotices: Array.isArray(raw.stNotices) ? raw.stNotices : [],
      ambiance: normalizeAmbiance(raw.ambiance),
      tvConnected: false,
      storytellerConnected: false,
    };
  } catch {
    return createEmptySession();
  }
}

export function saveSession(session: GameSession): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const { tvConnected: _t, storytellerConnected: _s, ...rest } = session;
  writeFileSync(SESSION_PATH, JSON.stringify(rest, null, 2), "utf-8");
}

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
export const SESSION_PATH = join(DATA_DIR, "session.json");
export const SCRIPT_PATH = join(DATA_DIR, "scripts", "trouble-brewing.json");
export const CONFIG_PATH = join(ROOT, "config", "default.json");
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

export function loadConfig(): AppConfig {
  const base = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as AppConfig;
  if (existsSync(HUE_CONFIG_PATH)) {
    try {
      const hue = JSON.parse(readFileSync(HUE_CONFIG_PATH, "utf-8"));
      base.hue = { ...base.hue, ...hue, lights: { ...base.hue.lights, ...hue.lights } };
      if (hue.enabled !== undefined) base.hue.enabled = hue.enabled;
    } catch {
      /* ignore */
    }
  }
  if (process.env.BOTC_PIN) base.storytellerPin = process.env.BOTC_PIN;
  if (process.env.PORT) base.port = Number(process.env.PORT);
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
    diedTonightIds: [],
    winner: null,
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
    const raw = JSON.parse(readFileSync(SESSION_PATH, "utf-8")) as GameSession;
    const base = createEmptySession(raw.players?.length || 8);
    return {
      ...base,
      ...raw,
      players: (raw.players ?? base.players).map((p, i) =>
        normalizePlayer({ ...p, id: p.id ?? `p${i + 1}`, seat: p.seat ?? i + 1 }),
      ),
      executedTodayId: raw.executedTodayId ?? null,
      dawnDeathsAnnounced: Boolean(raw.dawnDeathsAnnounced),
      diedTonightIds: raw.diedTonightIds ?? [],
      winner: raw.winner ?? null,
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

/**
 * Pre-game check: covers every cue family the engine plays, and never writes the session.
 * Run: cd server && npx tsx test/preflight.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { persistence, runCases, type Case } from "./_harness.js";
import { ENGINE_CUE_FAMILIES, runPreflight } from "../src/preflight.js";

const GAME_TS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "game.ts");

const cases: Case[] = [
  {
    name: "Every literal cue the engine plays is in ENGINE_CUE_FAMILIES",
    run: () => {
      const src = readFileSync(GAME_TS, "utf-8");
      const used = new Set<string>();
      for (const m of src.matchAll(/pickSound(?:OrFallback)?\(\s*"([a-z0-9_]+)"/g)) used.add(m[1]!);
      for (const m of src.matchAll(/"(day_(?:\d|n))"/g)) used.add(m[1]!);
      if (used.size < 20) return `only found ${used.size} cues; regex out of date?`;
      const listed = new Set<string>(ENGINE_CUE_FAMILIES);
      const missing = [...used].filter((c) => !listed.has(c));
      return missing.length ? `not checked by preflight: ${missing.join(", ")}` : null;
    },
  },
  {
    name: "Preflight runs without writing the session file",
    run: () => {
      const before = existsSync(persistence.SESSION_PATH);
      const results = runPreflight();
      if (existsSync(persistence.SESSION_PATH) !== before) return "session file created";
      const names = results.map((r) => r.name);
      for (const n of ["Config", "Storyteller PIN", "Saved game", "Web UI", "TV scene plates", "Narration / cues"]) {
        if (!names.includes(n)) return `missing check ${n}`;
      }
      if (results.some((r) => /\b1234\b/.test(r.detail) && r.name === "Storyteller PIN")) return "PIN printed";
      return null;
    },
  },
];

runCases(cases);

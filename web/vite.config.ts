import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const tvDir = path.join(root, "public/tv");

type PlateFlags = { hasLogo?: boolean };

/** Per-plate flags from public/tv/plates.json (e.g. hasLogo: logo painted into the art). */
function tvPlateFlags(): Record<string, PlateFlags> {
  const full = path.join(tvDir, "plates.json");
  if (!existsSync(full)) return {};
  try {
    return JSON.parse(readFileSync(full, "utf-8").replace(/^\uFEFF/, ""));
  } catch (err) {
    console.warn(`[tv] ignoring unreadable ${full}:`, err);
    return {};
  }
}

/** Scene plates under public/tv/bg-{night,dawn,day,day2,nomination,gallows,good-win,evil-win}.* */
function tvBgPlates(): Record<string, { file: string; mtime: string; hasLogo: boolean }> {
  const out: Record<string, { file: string; mtime: string; hasLogo: boolean }> = {};
  if (!existsSync(tvDir)) return out;
  const flags = tvPlateFlags();
  for (const name of readdirSync(tvDir)) {
    const m =
      /^bg-(night|dawn|day2?|nomination|gallows|good-win|evil-win)\.(jpe?g|png|webp)$/i.exec(
        name,
      );
    if (!m) continue;
    const key = m[1].toLowerCase();
    const full = path.join(tvDir, name);
    out[key] = {
      file: `/tv/${name}`,
      mtime: String(Math.floor(statSync(full).mtimeMs)),
      hasLogo: flags[key]?.hasLogo === true,
    };
  }
  return out;
}

const plates = tvBgPlates();
const nightMtime = plates.night?.mtime ?? "0";

/** Same precedence as server loadConfig(): env > config/local.json > config/default.json. */
function serverTarget(): string {
  let port = 3847;
  let host = "0.0.0.0";
  for (const file of ["default.json", "local.json"]) {
    const full = path.join(root, "..", "config", file);
    if (!existsSync(full)) continue;
    try {
      const cfg = JSON.parse(readFileSync(full, "utf-8").replace(/^\uFEFF/, ""));
      const n = Number(cfg.port);
      if (Number.isInteger(n) && n >= 1 && n <= 65535) port = n;
      if (typeof cfg.host === "string" && cfg.host.trim()) host = cfg.host.trim();
    } catch {
      /* server reports bad config */
    }
  }
  const env = Number(process.env.BOTC_PORT ?? process.env.PORT);
  if (Number.isInteger(env) && env >= 1 && env <= 65535) port = env;
  host = (process.env.BOTC_HOST ?? process.env.HOST)?.trim() || host;
  const reachable = host === "0.0.0.0" || host === "::" || host === "localhost" ? "127.0.0.1" : host;
  return `http://${reachable}:${port}`;
}
const apiTarget = serverTarget();

export default defineConfig({
  plugins: [react()],
  define: {
    /** @deprecated prefer __TV_BG_PLATES__.night.mtime */
    __TV_BG_MTIME__: JSON.stringify(nightMtime),
    __TV_BG_PLATES__: JSON.stringify(plates),
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": apiTarget,
      "/custom-audio": apiTarget,
      "/socket.io": {
        target: apiTarget,
        ws: true,
      },
    },
  },
});

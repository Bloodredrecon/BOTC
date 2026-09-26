import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const tvBgMtime = Math.floor(statSync(path.join(root, "public/tv/bg-night.jpg")).mtimeMs);

export default defineConfig({
  plugins: [react()],
  define: {
    __TV_BG_MTIME__: JSON.stringify(String(tvBgMtime)),
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": "http://127.0.0.1:3847",
      "/custom-audio": "http://127.0.0.1:3847",
      "/socket.io": {
        target: "http://127.0.0.1:3847",
        ws: true,
      },
    },
  },
});

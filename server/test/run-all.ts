/**
 * Runs every test file in this folder (files starting with "_" and this runner are skipped).
 * Run: npm test   (or: cd server && npx tsx test/run-all.ts [name-filter])
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(TEST_DIR, "..");
const TSX_CLI = join(SERVER_DIR, "..", "node_modules", "tsx", "dist", "cli.mjs");
const filter = process.argv[2] ?? "";

const files = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".ts") && !f.startsWith("_") && f !== "run-all.ts" && f.includes(filter))
  .sort();

let totalPassed = 0;
let totalCases = 0;
const failedFiles: string[] = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [TSX_CLI, join("test", f)], { cwd: SERVER_DIR, encoding: "utf-8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = /(\d+)\/(\d+) passed/.exec(out);
  if (m) {
    totalPassed += Number(m[1]);
    totalCases += Number(m[2]);
  }
  const ok = r.status === 0;
  if (!ok) failedFiles.push(f);
  console.log(`${ok ? "ok  " : "FAIL"}  ${f.padEnd(24)} ${m ? `${m[1]}/${m[2]}` : "(no summary)"}`);
  if (!ok) {
    for (const line of out.split(/\r?\n/).filter((l) => /^FAIL|^\s{6}|Error/.test(l))) console.log(`      ${line.trim()}`);
  }
}
console.log(`\n${totalPassed}/${totalCases} cases passed in ${files.length} files`);
if (failedFiles.length) console.log(`Failed: ${failedFiles.join(", ")}`);
process.exit(failedFiles.length ? 1 : 0);

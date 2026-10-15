/**
 * Game action log: file format, rotation, pruning, reload, redaction and descriptions.
 * Run: cd server && npx tsx test/action-log.ts
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ActionLog,
  describeArgs,
  describeEvent,
  diffSession,
  formatEntryText,
  listLogFiles,
  outcomeOf,
  snapshotSession,
} from "../src/action-log.js";
import { persistence, runCases, type Case } from "./_harness.js";
import { pushStNotice } from "../src/rules.js";

const freshDir = () => mkdtempSync(join(tmpdir(), "botc-log-"));
const T = new Date(2026, 9, 15, 20, 30, 5).getTime();
const base = { t: T, kind: "action" as const, phase: "day", day: 2 };

function session() {
  const s = persistence.createEmptySession(5);
  s.players[0]!.name = "Ada";
  s.players[1]!.name = "Bram";
  return s;
}

const cases: Case[] = [
  {
    name: "Writes one JSON line per entry to game-YYYY-MM-DD.jsonl with a readable text",
    run: () => {
      const dir = freshDir();
      const log = new ActionLog(dir);
      log.record({ ...base, action: "game:goDusk", outcome: "ok", phaseAfter: "dusk", dayAfter: 2 });
      log.record({ ...base, action: "game:startNomination", outcome: "rejected", reason: "Nominations are closed." });
      const files = readdirSync(dir);
      if (files.length !== 1 || files[0] !== "game-2026-10-15.jsonl") return `files ${files}`;
      const lines = readFileSync(join(dir, files[0]!), "utf-8").trim().split("\n");
      if (lines.length !== 2) return `${lines.length} lines`;
      const second = JSON.parse(lines[1]!);
      if (second.text !== "20:30:05 [day 2 day] startNomination -> REJECTED: Nominations are closed.") return second.text;
      const first = JSON.parse(lines[0]!);
      if (!first.text.endsWith("goDusk => day 2 dusk")) return first.text;
      return null;
    },
  },
  {
    name: "Rotates to a -2 file past maxBytes and prunes to maxFiles",
    run: () => {
      const dir = freshDir();
      for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) writeFileSync(join(dir, `game-${d}.jsonl`), "");
      const log = new ActionLog(dir, { maxBytes: 400, maxFiles: 3 });
      for (let i = 0; i < 6; i++) log.record({ ...base, action: "game:toggleVote", outcome: "ok", reason: "x".repeat(60) });
      const names = listLogFiles(dir).map((f) => f.name);
      if (!names.some((n) => /^game-2026-10-15-\d\.jsonl$/.test(n))) return `no rotation: ${names}`;
      if (names.length !== 3) return `not pruned to 3: ${names}`;
      if (names.some((n) => n.startsWith("game-2026-10-0"))) return `older days kept: ${names}`;
      const total = listLogFiles(dir).reduce(
        (n, f) => n + readFileSync(join(dir, f.name), "utf-8").trim().split("\n").filter(Boolean).length,
        0,
      );
      return total >= 3 ? null : `only ${total} entries left`;
    },
  },
  {
    name: "A new ActionLog reloads recent entries from disk (panel survives restarts)",
    run: () => {
      const dir = freshDir();
      const a = new ActionLog(dir);
      for (let i = 0; i < 5; i++) a.record({ ...base, action: `game:a${i}`, outcome: "ok" });
      const b = new ActionLog(dir, { memory: 3 });
      const got = b.recent(10).map((e) => e.action);
      return JSON.stringify(got) === JSON.stringify(["game:a2", "game:a3", "game:a4"]) ? null : JSON.stringify(got);
    },
  },
  {
    name: "Args: player ids resolved to names, secret-looking keys dropped, long args truncated",
    run: () => {
      const s = session();
      const a = describeArgs(s, { nominatorId: "p1", nomineeId: "p2", playerIds: ["p1", "p9"], pin: "1234", token: "t" });
      if (a?.nominatorId !== "Ada (seat 1)" || a?.nomineeId !== "Bram (seat 2)") return JSON.stringify(a);
      if (JSON.stringify(a.playerIds) !== JSON.stringify(["Ada (seat 1)", "p9"])) return JSON.stringify(a.playerIds);
      if ("pin" in a || "token" in a) return "secret key kept";
      const big = describeArgs(s, { notes: "y".repeat(2000) });
      if (!big || !("truncated" in big)) return "not truncated";
      if (describeArgs(s, null) !== undefined || describeArgs(s, 5) !== undefined) return "non-object args";
      return null;
    },
  },
  {
    name: "Outcome: ok:false is rejected with its message; no broadcast is no-change",
    run: () => {
      const r1 = outcomeOf({ ok: false, message: "Nope" }, true);
      if (r1.outcome !== "rejected" || r1.reason !== "Nope") return JSON.stringify(r1);
      const r2 = outcomeOf(undefined, false);
      if (r2.outcome !== "no-change") return JSON.stringify(r2);
      const r3 = outcomeOf({ ok: true, message: "Virgin: the nominator was executed." }, true);
      if (r3.outcome !== "ok" || !r3.reason?.startsWith("Virgin")) return JSON.stringify(r3);
      const r4 = outcomeOf(undefined, true);
      if (r4.outcome !== "ok") return JSON.stringify(r4);
      const text = formatEntryText({ ...base, action: "game:startNomination", ...r3 });
      return text.includes("(Virgin: the nominator was executed.)") ? null : text;
    },
  },
  {
    name: "Diff finds new notices even when the list is capped, and new chronicle events",
    run: () => {
      const s = session();
      for (let i = 0; i < 8; i++) pushStNotice(s, `old ${i}`);
      const before = snapshotSession(s);
      pushStNotice(s, "new one");
      s.publicLog.push({ type: "nomination", nominatorId: "p1", nomineeId: "p2", at: 1 });
      s.publicLog.push({ type: "other_death", playerId: "p2", reason: "Slayer shot", at: 2 });
      const d = diffSession(before, s);
      if (JSON.stringify(d.notices) !== JSON.stringify(["new one"])) return JSON.stringify(d.notices);
      const ev = d.events.map((e) => describeEvent(s, e));
      if (ev[0] !== "Nomination: Ada (seat 1) nominates Bram (seat 2)") return ev[0] ?? "none";
      if (ev[1] !== "Death: Bram (seat 2) (Slayer shot)") return ev[1] ?? "none";
      return null;
    },
  },
  {
    name: "A write failure doesn't throw (the game keeps running)",
    run: () => {
      const dir = freshDir();
      const file = join(dir, "not-a-dir");
      writeFileSync(file, "");
      const log = new ActionLog(file);
      const orig = console.error;
      console.error = () => {};
      try {
        log.record({ ...base, action: "game:goDay", outcome: "ok" });
      } finally {
        console.error = orig;
      }
      return log.recent(1).length === 1 ? null : "entry not kept in memory";
    },
  },
];

runCases(cases);

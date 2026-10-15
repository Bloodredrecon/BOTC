/**
 * Storyteller PIN throttling.
 * Run: cd server && npx tsx test/pin-guard.ts
 */
import { DEFAULT_PIN, PinGuard, pinMatches } from "../src/pin-guard.js";
import { runCases, type Case } from "./_harness.js";

const opts = { freeAttempts: 3, baseLockMs: 1000, maxLockMs: 8000, forgetAfterMs: 60_000 };

const cases: Case[] = [
  {
    name: "Right PIN is accepted, wrong or non-string PIN is refused",
    run: () => {
      const g = new PinGuard("4321", opts);
      if (!g.attempt("a", "4321", 0).ok) return "right PIN refused";
      if (g.attempt("b", "4322", 0).ok) return "wrong PIN accepted";
      if (g.attempt("c", undefined, 0).ok) return "missing PIN accepted";
      if (g.attempt("d", 4321, 0).ok) return "numeric PIN accepted";
      if (pinMatches("432", "4321") || !pinMatches("4321", "4321")) return "pinMatches wrong";
      return null;
    },
  },
  {
    name: "Locks out after the free attempts and doubles the lock-out per further miss",
    run: () => {
      const g = new PinGuard("4321", opts);
      const r1 = g.attempt("ip", "0", 0);
      const r2 = g.attempt("ip", "0", 0);
      if (r1.ok || r2.ok || r1.retryAfterMs !== 0 || r2.retryAfterMs !== 0) return "locked too early";
      const r3 = g.attempt("ip", "0", 0);
      if (r3.ok || r3.retryAfterMs !== 1000) return `third miss: ${JSON.stringify(r3)}`;
      const blocked = g.attempt("ip", "4321", 500);
      if (blocked.ok || blocked.reason !== "locked") return "right PIN accepted during lock-out";
      const r4 = g.attempt("ip", "0", 1000);
      if (r4.ok || r4.retryAfterMs !== 2000) return `fourth miss: ${JSON.stringify(r4)}`;
      const r5 = g.attempt("ip", "0", 3000);
      if (r5.ok || r5.retryAfterMs !== 4000) return `fifth miss: ${JSON.stringify(r5)}`;
      return null;
    },
  },
  {
    name: "Lock-out is capped at maxLockMs",
    run: () => {
      const g = new PinGuard("4321", opts);
      let t = 0;
      let last = 0;
      for (let i = 0; i < 12; i++) {
        const r = g.attempt("ip", "0", t);
        if (!r.ok) last = r.retryAfterMs;
        t += last;
      }
      return last === 8000 ? null : `last lock ${last}`;
    },
  },
  {
    name: "Attempts during a lock-out don't extend it or count as guesses",
    run: () => {
      const g = new PinGuard("4321", opts);
      for (let i = 0; i < 3; i++) g.attempt("ip", "0", 0);
      for (let i = 0; i < 50; i++) g.attempt("ip", "0", 10);
      const r = g.attempt("ip", "4321", 1000);
      return r.ok ? null : `right PIN after lock-out: ${JSON.stringify(r)}`;
    },
  },
  {
    name: "Success resets the count; other clients are not affected",
    run: () => {
      const g = new PinGuard("4321", opts);
      g.attempt("ip", "0", 0);
      g.attempt("ip", "0", 0);
      if (!g.attempt("ip", "4321", 0).ok) return "right PIN refused";
      const r = g.attempt("ip", "0", 0);
      if (r.ok || r.retryAfterMs !== 0) return "count not reset after success";
      for (let i = 0; i < 3; i++) g.attempt("bad", "0", 0);
      if (!g.attempt("good", "4321", 1).ok) return "other client locked out";
      return null;
    },
  },
  {
    name: "Old failures are forgotten after forgetAfterMs",
    run: () => {
      const g = new PinGuard("4321", opts);
      for (let i = 0; i < 3; i++) g.attempt("ip", "0", 0);
      const r = g.attempt("ip", "0", 61_001 + 1000);
      return !r.ok && r.retryAfterMs === 0 ? null : `not forgotten: ${JSON.stringify(r)}`;
    },
  },
  {
    name: "Default PIN is flagged and messages name the wait",
    run: () => {
      if (!new PinGuard(DEFAULT_PIN).isDefaultPin) return "default not flagged";
      if (new PinGuard("9876").isDefaultPin) return "custom PIN flagged";
      const msg = PinGuard.message({ ok: false, reason: "locked", retryAfterMs: 4200 });
      return msg.includes("5 s") ? null : msg;
    },
  },
];

runCases(cases);

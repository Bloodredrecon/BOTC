import { createHash, timingSafeEqual } from "node:crypto";

export const DEFAULT_PIN = "1234";

export type PinGuardOptions = {
  /** Wrong PINs allowed before the first lock-out. */
  freeAttempts?: number;
  /** First lock-out; doubles with each further wrong PIN. */
  baseLockMs?: number;
  maxLockMs?: number;
  /** A key with no wrong PIN for this long starts fresh. */
  forgetAfterMs?: number;
};

type Entry = { failures: number; lockedUntil: number; lastFailAt: number };

export type PinCheck =
  | { ok: true }
  | { ok: false; reason: "locked"; retryAfterMs: number }
  | { ok: false; reason: "wrong"; retryAfterMs: number; attemptsLeft: number };

/** Constant-time PIN compare (hashing first makes the lengths equal). */
export function pinMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Throttles wrong Storyteller PINs per client key (the socket's remote IP).
 * After `freeAttempts` wrong PINs the key is locked for baseLockMs, doubling per further miss up to maxLockMs.
 * Attempts during a lock-out are refused without checking the PIN, so they can't be used to guess.
 */
export class PinGuard {
  private readonly entries = new Map<string, Entry>();
  private readonly freeAttempts: number;
  private readonly baseLockMs: number;
  private readonly maxLockMs: number;
  private readonly forgetAfterMs: number;

  constructor(
    private readonly expectedPin: string,
    opts: PinGuardOptions = {},
  ) {
    this.freeAttempts = opts.freeAttempts ?? 5;
    this.baseLockMs = opts.baseLockMs ?? 5_000;
    this.maxLockMs = opts.maxLockMs ?? 5 * 60_000;
    this.forgetAfterMs = opts.forgetAfterMs ?? 30 * 60_000;
  }

  get isDefaultPin(): boolean {
    return this.expectedPin === DEFAULT_PIN;
  }

  attempt(key: string, pin: unknown, now = Date.now()): PinCheck {
    let entry = this.entries.get(key);
    if (entry && entry.lockedUntil <= now && now - entry.lastFailAt > this.forgetAfterMs) {
      this.entries.delete(key);
      entry = undefined;
    }
    if (entry && entry.lockedUntil > now) {
      return { ok: false, reason: "locked", retryAfterMs: entry.lockedUntil - now };
    }
    if (typeof pin === "string" && pinMatches(pin, this.expectedPin)) {
      this.entries.delete(key);
      return { ok: true };
    }
    entry ??= { failures: 0, lockedUntil: 0, lastFailAt: 0 };
    entry.failures += 1;
    entry.lastFailAt = now;
    const over = entry.failures - this.freeAttempts;
    if (over >= 0) {
      entry.lockedUntil = now + Math.min(this.maxLockMs, this.baseLockMs * 2 ** over);
    }
    this.entries.set(key, entry);
    return {
      ok: false,
      reason: "wrong",
      retryAfterMs: Math.max(0, entry.lockedUntil - now),
      attemptsLeft: Math.max(0, this.freeAttempts - entry.failures),
    };
  }

  /** Human-readable reason for the PIN screen. */
  static message(check: Exclude<PinCheck, { ok: true }>): string {
    const secs = Math.ceil(check.retryAfterMs / 1000);
    if (check.reason === "locked") return `Too many wrong PINs. Try again in ${secs} s.`;
    if (check.retryAfterMs > 0) return `Invalid PIN. Too many wrong PINs; try again in ${secs} s.`;
    return "Invalid PIN";
  }
}

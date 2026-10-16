/**
 * Player face photos: resized JPEGs on disk under a gitignored folder next to the session.
 * Only the seat's linked phone may upload; the files themselves are as public as names.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SESSION_PATH } from "./persistence.js";
import type { GameSession } from "./types.js";

/** Cap after base64 decode (client should already resize to ~256px). */
export const MAX_PHOTO_BYTES = 350_000;

export function photosDir(): string {
  return process.env.BOTC_PHOTOS_DIR || join(dirname(SESSION_PATH), "player-photos");
}

export function photoFile(gameId: string, playerId: string): string {
  return join(photosDir(), gameId, `${playerId}.jpg`);
}

export function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export function decodePhotoPayload(raw: unknown): { ok: true; buf: Buffer } | { ok: false; error: string } {
  if (typeof raw !== "string" || !raw) return { ok: false, error: "Send a JPEG photo." };
  let b64 = raw.trim();
  const dataUrl = /^data:image\/(jpeg|jpg);base64,/i.exec(b64);
  if (dataUrl) b64 = b64.slice(dataUrl[0].length);
  else if (/^data:image\//i.test(b64)) return { ok: false, error: "Use a JPEG photo (not PNG or another type)." };
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return { ok: false, error: "That photo data could not be read." };
  }
  if (!buf.length) return { ok: false, error: "Send a JPEG photo." };
  if (buf.length > MAX_PHOTO_BYTES) {
    return { ok: false, error: `That photo is too large (max ${Math.round(MAX_PHOTO_BYTES / 1000)} KB).` };
  }
  if (!isJpeg(buf)) {
    if (buf[0] === 0x89 && buf[1] === 0x50) return { ok: false, error: "Use a JPEG photo (not PNG)." };
    return { ok: false, error: "That file is not a JPEG photo." };
  }
  return { ok: true, buf };
}

export function savePlayerPhoto(
  session: GameSession,
  playerId: string,
  buf: Buffer,
): { ok: true; photoRev: number } | { ok: false; error: string } {
  if (!session.phones.enabled) return { ok: false, error: "Player phones are off for this game." };
  const p = session.players.find((x) => x.id === playerId && !x.leftGame);
  if (!p) return { ok: false, error: "Seat not found." };
  const dir = join(photosDir(), session.gameId);
  mkdirSync(dir, { recursive: true });
  const dest = photoFile(session.gameId, playerId);
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, buf);
  renameSync(tmp, dest);
  const photoRev = Date.now();
  p.photoRev = photoRev;
  return { ok: true, photoRev };
}

export function clearPlayerPhoto(
  session: GameSession,
  playerId: string,
): { ok: true } | { ok: false; error: string } {
  if (!session.phones.enabled) return { ok: false, error: "Player phones are off for this game." };
  const p = session.players.find((x) => x.id === playerId && !x.leftGame);
  if (!p) return { ok: false, error: "Seat not found." };
  const dest = photoFile(session.gameId, playerId);
  if (existsSync(dest)) {
    try {
      unlinkSync(dest);
    } catch {
      /* best effort */
    }
  }
  p.photoRev = null;
  return { ok: true };
}

/** Copy a seat's photo into a new gameId / playerId (same-table new game). */
export function copyPlayerPhoto(fromGameId: string, fromPlayerId: string, toGameId: string, toPlayerId: string): boolean {
  const src = photoFile(fromGameId, fromPlayerId);
  if (!existsSync(src)) return false;
  const dir = join(photosDir(), toGameId);
  mkdirSync(dir, { recursive: true });
  copyFileSync(src, photoFile(toGameId, toPlayerId));
  return true;
}

export function readPlayerPhoto(session: GameSession, playerId: string): Buffer | null {
  const p = session.players.find((x) => x.id === playerId && !x.leftGame);
  if (!p?.photoRev) return null;
  const dest = photoFile(session.gameId, playerId);
  if (!existsSync(dest)) return null;
  try {
    return readFileSync(dest);
  } catch {
    return null;
  }
}

export function cleanName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
}

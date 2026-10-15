import { createHash, randomBytes, randomInt } from "node:crypto";
import type { ScriptData } from "./persistence.js";
import { meVote } from "./phone-vote.js";
import { wakeCharacterId } from "./rules.js";
import type {
  GameSession,
  PhoneClaim,
  PhoneMe,
  PhoneMessage,
  PhonePanel,
  PhonePrivate,
  PhonePublic,
  PhonesState,
  PlayerState,
  PublicState,
  Team,
} from "./types.js";

/** No 0/O, 1/I/L: the code is read off a TV across the room. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const DEFAULT_SWEEP_MS = 1500;
export const MAX_CLAIMS = 60;
export const MAX_PENDING_PER_SEAT = 3;

export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function newGameId(): string {
  return randomBytes(9).toString("base64url");
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function emptyPhones(enabled = false): PhonesState {
  return {
    enabled,
    joinCode: randomCode(4),
    claimsOpen: true,
    claims: [],
    private: {},
    voting: "phones",
    sweepMsPerSeat: DEFAULT_SWEEP_MS,
  };
}

function normalizePrivate(raw: unknown): PhonePrivate {
  const p = (raw ?? {}) as Partial<PhonePrivate>;
  return {
    revealedCharacterId: typeof p.revealedCharacterId === "string" ? p.revealedCharacterId : null,
    revealedAlignment: p.revealedAlignment === "good" || p.revealedAlignment === "evil" ? p.revealedAlignment : null,
    revealedAt: typeof p.revealedAt === "number" ? p.revealedAt : null,
    messages: Array.isArray(p.messages) ? p.messages.slice(-200) : [],
    unreadByStoryteller: Math.max(0, Number(p.unreadByStoryteller) || 0),
  };
}

/** Fill in a saved (or missing) phones block. `defaultEnabled` applies only when the session has none. */
export function normalizePhones(raw: unknown, defaultEnabled = false): PhonesState {
  if (!raw || typeof raw !== "object") return emptyPhones(defaultEnabled);
  const r = raw as Partial<PhonesState>;
  const base = emptyPhones(Boolean(r.enabled));
  const claims = Array.isArray(r.claims)
    ? r.claims.filter(
        (c): c is PhoneClaim =>
          !!c && typeof c.id === "string" && typeof c.playerId === "string" && typeof c.tokenHash === "string",
      )
    : [];
  const priv: Record<string, PhonePrivate> = {};
  for (const [id, p] of Object.entries(r.private ?? {})) priv[id] = normalizePrivate(p);
  const sweep = Number(r.sweepMsPerSeat);
  return {
    ...base,
    joinCode: typeof r.joinCode === "string" && /^[A-Z0-9]{4,8}$/.test(r.joinCode) ? r.joinCode : base.joinCode,
    claimsOpen: r.claimsOpen !== false,
    claims: claims.map((c) => ({ ...c, status: c.status === "active" ? "active" : "pending" })),
    private: priv,
    voting: r.voting === "manual" ? "manual" : "phones",
    sweepMsPerSeat: Number.isFinite(sweep) ? Math.max(500, Math.min(5000, sweep)) : DEFAULT_SWEEP_MS,
  };
}

export function privateFor(s: GameSession, playerId: string): PhonePrivate {
  let p = s.phones.private[playerId];
  if (!p) {
    p = normalizePrivate(null);
    s.phones.private[playerId] = p;
  }
  return p;
}

export function findClaimByToken(s: GameSession, tokenHash: string): PhoneClaim | undefined {
  return s.phones.claims.find((c) => c.tokenHash === tokenHash);
}

/** "iPhone Safari", "Android Chrome", … from a user agent; never the raw string. */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "Device";
  const browser = /EdgA?\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /CriOS|Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "browser";
  return `${os} ${browser}`;
}

export function teamAlignment(team: Team | undefined): "good" | "evil" | null {
  if (team === "townsfolk" || team === "outsider") return "good";
  if (team === "minion" || team === "demon") return "evil";
  return null;
}

function characterCard(script: ScriptData, id: string | null): PhoneMe["character"] {
  if (!id) return null;
  const c = script.characters.find((x) => x.id === id) ?? script.travellers.find((x) => x.id === id);
  if (!c) return null;
  return { id: c.id, name: c.name, team: c.team, ability: c.ability };
}

/** Script sheet for phones: every character, plus the Travellers seated now (all public). */
function phoneSheet(session: GameSession, script: ScriptData): PhonePublic["sheet"] {
  const n = session.players.filter((p) => !p.isTraveller && !p.leftGame).length;
  const seatedTravellers = new Set(
    session.players.filter((p) => p.isTraveller && !p.leftGame && p.characterId).map((p) => p.characterId!),
  );
  return {
    playerCount: n,
    counts: script.setupByPlayerCount[String(n)] ?? null,
    characters: script.characters.map((c) => ({ id: c.id, name: c.name, team: c.team, ability: c.ability })),
    travellers: script.travellers
      .filter((t) => seatedTravellers.has(t.id))
      .map((t) => ({ id: t.id, name: t.name, ability: t.ability })),
  };
}

/** What a phone or a spectator may see of the town: copied field by field from the public projection. */
export function toPhonePublic(session: GameSession, script: ScriptData, pub: PublicState): PhonePublic {
  return {
    gameId: session.gameId,
    scriptName: pub.scriptName,
    phase: pub.phase,
    dayNumber: pub.dayNumber,
    seq: pub.seq,
    players: pub.players,
    fabled: pub.fabled,
    publicLog: pub.publicLog,
    timer: pub.timer,
    nomination: pub.nomination,
    dawnDeathIds: pub.dawnDeathIds,
    dawnDeathsAnnounced: pub.dawnDeathsAnnounced,
    executionPendingId: pub.executionPendingId,
    nominationsToday: pub.nominationsToday,
    block: pub.block,
    nominationsOpen: pub.nominationsOpen,
    winner: pub.winner,
    winReason: pub.winReason,
    reveal: pub.reveal,
    exile: pub.exile,
    sheet: phoneSheet(session, script),
  };
}

/**
 * One player's phone state: the public view plus an allowlisted `me`. The alive / ghost-vote bits come
 * from the public projection, so a phone learns of its own overnight death at the dawn announcement.
 */
export function toPlayerState(
  session: GameSession,
  script: ScriptData,
  playerId: string,
  pub: PublicState,
  phonePublic: PhonePublic = toPhonePublic(session, script, pub),
): PlayerState | null {
  const p = session.players.find((x) => x.id === playerId && !x.leftGame);
  const seen = pub.players.find((x) => x.id === playerId);
  if (!p || !seen) return null;
  const priv = session.phones.private[playerId];
  const me: PhoneMe = {
    playerId: p.id,
    seat: seen.seat,
    name: seen.name,
    alive: seen.alive,
    usedGhostVote: seen.usedGhostVote,
    isTraveller: seen.isTraveller,
    character: characterCard(script, priv?.revealedCharacterId ?? null),
    alignment: priv?.revealedAlignment ?? null,
    revealedAt: priv?.revealedAt ?? null,
    messages: (priv?.messages ?? []).map((m) => ({ id: m.id, from: m.from, kind: m.kind, text: m.text, at: m.at })),
    vote: meVote(session, playerId),
  };
  return { ...phonePublic, me };
}

/** The Storyteller's phone panel. `connected` = live sockets per claim id. */
export function toPhonePanel(
  session: GameSession,
  live: { connected: Record<string, number>; spectators: number },
): PhonePanel {
  const ph = session.phones;
  return {
    enabled: ph.enabled,
    joinCode: ph.joinCode,
    claimsOpen: ph.claimsOpen,
    voting: ph.voting,
    sweepMsPerSeat: ph.sweepMsPerSeat,
    claims: ph.claims.map((c) => ({
      id: c.id,
      playerId: c.playerId,
      deviceLabel: c.deviceLabel,
      status: c.status,
      claimedAt: c.claimedAt,
      lastSeenAt: c.lastSeenAt,
      connected: live.connected[c.id] ?? 0,
    })),
    private: ph.private,
    spectators: live.spectators,
  };
}

/**
 * What a player is told they are: the Drunk gets the Townsfolk they think they are (and good);
 * a Traveller gets their character and the alignment the Storyteller chose for them.
 */
export function revealFor(
  script: ScriptData,
  p: GameSession["players"][number],
): { characterId: string; alignment: "good" | "evil" } | { error: string } {
  const shown = wakeCharacterId(p);
  if (!shown) {
    return {
      error:
        p.characterId === "drunk"
          ? `${p.name} is the Drunk but has no "thinks they are" Townsfolk yet.`
          : `${p.name} has no character yet.`,
    };
  }
  if (p.isTraveller) return { characterId: shown, alignment: p.alignment ?? "good" };
  const team = (script.characters.find((c) => c.id === shown) ?? script.travellers.find((c) => c.id === shown))?.team;
  const alignment = teamAlignment(team);
  if (!alignment) return { error: `${p.name}: unknown character ${shown}.` };
  return { characterId: shown, alignment };
}

function storeReveal(s: GameSession, playerId: string, r: { characterId: string; alignment: "good" | "evil" }, now: number) {
  const priv = privateFor(s, playerId);
  priv.revealedCharacterId = r.characterId;
  priv.revealedAlignment = r.alignment;
  priv.revealedAt = now;
}

/**
 * "Distribute characters": snapshot what every seated player is told. In the lobby it waits for a
 * legal bag (no setup warning); every player needs a character, and the Drunk a believed Townsfolk.
 */
export function distributeCharacters(
  s: GameSession,
  script: ScriptData,
  setupWarning: string | null,
  now = Date.now(),
): { ok: true; playerIds: string[] } | { ok: false; message: string } {
  if (!s.phones.enabled) return { ok: false, message: "Player phones are off." };
  if (s.phase === "lobby" && setupWarning) return { ok: false, message: `Fix the bag first: ${setupWarning}` };
  const seated = s.players.filter((p) => !p.leftGame);
  const reveals = seated.map((p) => ({ p, r: revealFor(script, p) }));
  const problems = reveals.filter((x) => "error" in x.r).map((x) => (x.r as { error: string }).error);
  if (problems.length) return { ok: false, message: problems.join(" ") };
  for (const { p, r } of reveals) storeReveal(s, p.id, r as { characterId: string; alignment: "good" | "evil" }, now);
  return { ok: true, playerIds: seated.map((p) => p.id) };
}

/** "Re-send": tell one player their current character (after a grimoire fix, a star-pass, a Scarlet Woman). */
export function resendCharacter(
  s: GameSession,
  script: ScriptData,
  playerId: string,
  now = Date.now(),
): { ok: true } | { ok: false; message: string } {
  const p = s.players.find((x) => x.id === playerId && !x.leftGame);
  if (!p) return { ok: false, message: "Pick a seat." };
  const r = revealFor(script, p);
  if ("error" in r) return { ok: false, message: r.error };
  storeReveal(s, p.id, r, now);
  return { ok: true };
}

/** The new-Demon wake ("You are the Demon") also updates that player's phone card, if it had one. */
export function revealNewDemon(s: GameSession, script: ScriptData, playerId: string, now = Date.now()) {
  if (!s.phones.private[playerId]?.revealedCharacterId) return;
  const p = s.players.find((x) => x.id === playerId);
  if (!p) return;
  const r = revealFor(script, p);
  if (!("error" in r)) storeReveal(s, playerId, r, now);
}

export const MESSAGE_MAX_CHARS = 280;
export const REPLY_MAX_CHARS = 500;
const MESSAGES_KEPT = 200;
export const WORD_TEXT = "Can I have a word?";

function pushMessage(s: GameSession, playerId: string, m: Omit<PhoneMessage, "id">): PhoneMessage {
  const priv = privateFor(s, playerId);
  const msg: PhoneMessage = { id: randomBytes(6).toString("base64url"), ...m };
  priv.messages.push(msg);
  if (priv.messages.length > MESSAGES_KEPT) priv.messages.splice(0, priv.messages.length - MESSAGES_KEPT);
  return msg;
}

/** A player's question or "request a word" to the Storyteller. Never at night: the phone is face down. */
export function addPlayerMessage(
  s: GameSession,
  playerId: string,
  kind: unknown,
  text: unknown,
  now = Date.now(),
): { ok: true; message: PhoneMessage } | { ok: false; error: string } {
  if (!s.phones.enabled) return { ok: false, error: "Player phones are off for this game." };
  if (s.phase === "firstNight" || s.phase === "night") return { ok: false, error: "Phones can't send at night. Wait for the morning." };
  if (!s.players.some((p) => p.id === playerId && !p.leftGame)) return { ok: false, error: "That seat is not in the game." };
  const k = kind === "word" ? "word" : "question";
  const body = String(text ?? "").replace(/\s+/g, " ").trim();
  if (k === "question" && !body) return { ok: false, error: "Type your question first." };
  if (body.length > MESSAGE_MAX_CHARS) return { ok: false, error: `Keep it under ${MESSAGE_MAX_CHARS} characters.` };
  const message = pushMessage(s, playerId, { from: "player", kind: k, text: body || WORD_TEXT, at: now });
  privateFor(s, playerId).unreadByStoryteller += 1;
  return { ok: true, message };
}

/** The Storyteller's reply. Replying also counts as having read the thread. */
export function addStorytellerReply(
  s: GameSession,
  playerId: string,
  text: unknown,
  now = Date.now(),
): { ok: true } | { ok: false; message: string } {
  if (!s.phones.enabled) return { ok: false, message: "Player phones are off." };
  if (!s.players.some((p) => p.id === playerId && !p.leftGame)) return { ok: false, message: "Pick a seat." };
  const body = String(text ?? "").trim();
  if (!body) return { ok: false, message: "Type a reply first." };
  if (body.length > REPLY_MAX_CHARS) return { ok: false, message: `Keep it under ${REPLY_MAX_CHARS} characters.` };
  pushMessage(s, playerId, { from: "storyteller", kind: "reply", text: body, at: now });
  privateFor(s, playerId).unreadByStoryteller = 0;
  return { ok: true };
}

export function markMessagesRead(s: GameSession, playerId: string): { ok: true } {
  const priv = s.phones.private[playerId];
  if (priv) priv.unreadByStoryteller = 0;
  return { ok: true };
}

export type ClaimResult =
  | { ok: true; token: string; claim: PhoneClaim; replaced: PhoneClaim[] }
  | { ok: false; error: string };

/** A phone asks for a seat. The token is returned once; only its hash is kept. */
export function createClaim(
  s: GameSession,
  playerId: string,
  label: string,
  opts: { active?: boolean; now?: number } = {},
): ClaimResult {
  const now = opts.now ?? Date.now();
  const p = s.players.find((x) => x.id === playerId && !x.leftGame);
  if (!p) return { ok: false, error: "That seat is not in the game." };
  if (s.phones.claims.length >= MAX_CLAIMS) return { ok: false, error: "Too many phones are waiting. Ask the Storyteller." };
  const pending = s.phones.claims.filter((c) => c.playerId === playerId && c.status === "pending");
  if (!opts.active && pending.length >= MAX_PENDING_PER_SEAT) {
    return { ok: false, error: "Several phones are already asking for this seat. Ask the Storyteller." };
  }
  const token = newToken();
  const claim: PhoneClaim = {
    id: randomBytes(6).toString("base64url"),
    playerId,
    tokenHash: hashToken(token),
    deviceLabel: label.slice(0, 40),
    status: opts.active ? "active" : "pending",
    claimedAt: now,
    lastSeenAt: now,
  };
  const replaced = opts.active ? s.phones.claims.filter((c) => c.playerId === playerId) : [];
  s.phones.claims = [...s.phones.claims.filter((c) => !replaced.includes(c)), claim];
  return { ok: true, token, claim, replaced };
}

export type ClaimChange = { ok: boolean; message?: string; removed: PhoneClaim[] };

/** Approve a pending claim. It replaces the seat's other phones unless `keepOthers` (a second device). */
export function approveClaim(s: GameSession, claimId: string, keepOthers = false): ClaimChange {
  const c = s.phones.claims.find((x) => x.id === claimId);
  if (!c) return { ok: false, message: "That request is gone.", removed: [] };
  c.status = "active";
  const removed = keepOthers
    ? []
    : s.phones.claims.filter((x) => x.id !== c.id && x.playerId === c.playerId && x.status === "active");
  s.phones.claims = s.phones.claims.filter((x) => !removed.includes(x));
  return { ok: true, removed };
}

/** Deny a pending claim or revoke an active one: the hash is deleted, so the token stops working. */
export function removeClaim(s: GameSession, claimId: string): ClaimChange {
  const c = s.phones.claims.find((x) => x.id === claimId);
  if (!c) return { ok: false, message: "That phone is already gone.", removed: [] };
  s.phones.claims = s.phones.claims.filter((x) => x !== c);
  return { ok: true, removed: [c] };
}

/** Move a phone to another seat (wrong seat tapped, players swapped). Replaces that seat's phones. */
export function reassignClaim(s: GameSession, claimId: string, playerId: string): ClaimChange {
  const c = s.phones.claims.find((x) => x.id === claimId);
  const p = s.players.find((x) => x.id === playerId && !x.leftGame);
  if (!c) return { ok: false, message: "That phone is gone.", removed: [] };
  if (!p) return { ok: false, message: "That seat is not in the game.", removed: [] };
  const removed = s.phones.claims.filter((x) => x.id !== c.id && x.playerId === playerId && x.status === "active");
  s.phones.claims = s.phones.claims.filter((x) => !removed.includes(x));
  c.playerId = playerId;
  c.status = "active";
  return { ok: true, removed };
}

export function clearClaims(s: GameSession): ClaimChange {
  const removed = s.phones.claims;
  s.phones.claims = [];
  return { ok: true, removed };
}

/** Claims for players who left (Travellers) or no longer exist. */
export function dropOrphanClaims(s: GameSession): PhoneClaim[] {
  const live = new Set(s.players.filter((p) => !p.leftGame).map((p) => p.id));
  const removed = s.phones.claims.filter((c) => !live.has(c.playerId));
  if (removed.length) s.phones.claims = s.phones.claims.filter((c) => !removed.includes(c));
  return removed;
}

/**
 * New game. Same table: each resident claim moves to the player now in the same seat position
 * (Travellers' claims are dropped). Otherwise every claim clears. Private data always clears.
 */
export function phonesForNewGame(
  old: GameSession,
  next: GameSession,
  sameTable: boolean,
): PhonesState {
  const ph = old.phones;
  const fresh: PhonesState = { ...emptyPhones(ph.enabled), voting: ph.voting, sweepMsPerSeat: ph.sweepMsPerSeat };
  if (!sameTable) return fresh;
  fresh.joinCode = ph.joinCode;
  fresh.claimsOpen = ph.claimsOpen;
  const oldResidents = old.players.filter((p) => !p.isTraveller && !p.leftGame).sort((a, b) => a.seat - b.seat);
  const newResidents = next.players.filter((p) => !p.isTraveller).sort((a, b) => a.seat - b.seat);
  for (const c of ph.claims) {
    const i = oldResidents.findIndex((p) => p.id === c.playerId);
    const target = i >= 0 ? newResidents[i] : undefined;
    if (target) fresh.claims.push({ ...c, playerId: target.id });
  }
  return fresh;
}

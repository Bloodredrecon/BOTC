import type { Server, Socket } from "socket.io";
import type { ActionLog } from "./action-log.js";
import type { GameEngine } from "./game.js";
import type { ScriptData } from "./persistence.js";
import {
  addPlayerMessage,
  addStorytellerReply,
  approveClaim,
  clearClaims,
  createClaim,
  deviceLabel,
  distributeCharacters,
  dropOrphanClaims,
  findClaimByToken,
  hashToken,
  markMessagesRead,
  randomCode,
  reassignClaim,
  removeClaim,
  resendCharacter,
  toPhonePublic,
  toPlayerState,
  type ClaimChange,
} from "./phones.js";
import { setupWarning, toPublicState } from "./projection.js";
import type { GameSession, PhoneClaim, PhoneStatus, PublicState } from "./types.js";

/** Every /play socket (players and spectators) is in this room; player data only ever goes to `player:<id>`. */
const PHONES_ROOM = "phones";
const SPECTATOR_ROOM = "spectator";
const playerRoom = (id: string) => `player:${id}`;
const HANDOVER_TTL_MS = 10 * 60_000;
const MESSAGE_WINDOW_MS = 60_000;
const MESSAGES_PER_WINDOW = 6;
const HAND_WINDOW_MS = 5_000;
const HANDS_PER_WINDOW = 12;
const MAX_REMEMBERED_REASONS = 500;

type RemovedReason = "denied" | "revoked" | "replaced" | "cleared";
export type HubStatus = PhoneStatus | { status: "watching" };
type Handler = (data: Record<string, unknown>) => unknown;

/** Throttles wrong join / hand-over codes per client address: a few free tries, then a doubling lock-out. */
export class CodeThrottle {
  private entries = new Map<string, { failures: number; lockedUntil: number; lastFailAt: number }>();
  constructor(
    private freeAttempts = 8,
    private baseLockMs = 5_000,
    private maxLockMs = 5 * 60_000,
  ) {}
  lockedFor(key: string, now = Date.now()): number {
    const e = this.entries.get(key);
    if (e && now - e.lastFailAt > 30 * 60_000 && e.lockedUntil <= now) this.entries.delete(key);
    return Math.max(0, (this.entries.get(key)?.lockedUntil ?? 0) - now);
  }
  fail(key: string, now = Date.now()) {
    const e = this.entries.get(key) ?? { failures: 0, lockedUntil: 0, lastFailAt: 0 };
    e.failures += 1;
    e.lastFailAt = now;
    const over = e.failures - this.freeAttempts;
    if (over >= 0) e.lockedUntil = now + Math.min(this.maxLockMs, this.baseLockMs * 2 ** over);
    this.entries.set(key, e);
  }
  succeed(key: string) {
    this.entries.delete(key);
  }
}

function cleanCode(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

export class PhoneHub {
  private removedReasons = new Map<string, RemovedReason>();
  /** One-time hand-over codes (memory only: they expire in minutes). */
  private handovers = new Map<string, { playerId: string; expiresAt: number }>();
  private messageTimes = new Map<string, number[]>();
  private handTimes = new Map<string, number[]>();
  private throttle = new CodeThrottle();

  constructor(
    private io: Server,
    private engine: GameEngine,
    private script: ScriptData,
    private actionLog: ActionLog,
  ) {}

  private get session(): GameSession {
    return this.engine.session;
  }

  private phoneSockets(): Socket[] {
    const ids = this.io.sockets.adapter.rooms.get(PHONES_ROOM);
    if (!ids) return [];
    const out: Socket[] = [];
    for (const id of ids) {
      const s = this.io.sockets.sockets.get(id);
      if (s) out.push(s);
    }
    return out;
  }

  /** Live sockets per claim id, for the Storyteller's device panel and the vote sweep. */
  live(): { connected: Record<string, number>; spectators: number } {
    const connected: Record<string, number> = {};
    let spectators = 0;
    for (const s of this.phoneSockets()) {
      if (s.data.role === "spectator") {
        if (this.session.phones.enabled) spectators += 1;
        continue;
      }
      const claimId = s.data.boundClaimId as string | undefined;
      if (claimId) connected[claimId] = (connected[claimId] ?? 0) + 1;
    }
    return { connected, spectators };
  }

  /** Player ids with at least one connected, approved phone. */
  connectedPlayerIds(): Set<string> {
    const ids = new Set<string>();
    if (!this.session.phones.enabled) return ids;
    for (const s of this.phoneSockets()) {
      if (s.data.role === "player" && s.data.boundPlayerId) ids.add(s.data.boundPlayerId as string);
    }
    return ids;
  }

  private remember(removed: PhoneClaim[], reason: RemovedReason) {
    for (const c of removed) this.removedReasons.set(c.tokenHash, reason);
    while (this.removedReasons.size > MAX_REMEMBERED_REASONS) {
      const first = this.removedReasons.keys().next().value;
      if (first === undefined) break;
      this.removedReasons.delete(first);
    }
  }

  private desired(socket: Socket): { status: HubStatus; claim?: PhoneClaim } {
    const s = this.session;
    if (!s.phones.enabled) return { status: { status: "off" } };
    if (socket.data.role === "spectator") return { status: { status: "watching" } };
    const hash = socket.data.tokenHash as string | undefined;
    if (!hash) return { status: { status: "unclaimed", reason: (socket.data.lastReason as RemovedReason) ?? null } };
    const claim = findClaimByToken(s, hash);
    if (!claim) {
      return { status: { status: "unclaimed", reason: this.removedReasons.get(hash) ?? "unknown" } };
    }
    const p = s.players.find((x) => x.id === claim.playerId && !x.leftGame);
    if (!p) return { status: { status: "unclaimed", reason: "cleared" } };
    if (claim.status === "pending") {
      return { status: { status: "pending", playerId: p.id, seat: p.seat, name: p.name }, claim };
    }
    return { status: { status: "active", playerId: p.id }, claim };
  }

  /** Put one socket in the rooms its token allows now, and tell it if its status changed. */
  private syncSocket(socket: Socket) {
    const { status, claim } = this.desired(socket);
    const wantPlayer = status.status === "active" ? status.playerId : null;
    const wantRooms = new Set<string>();
    if (wantPlayer) wantRooms.add(playerRoom(wantPlayer));
    if (status.status === "watching") wantRooms.add(SPECTATOR_ROOM);
    for (const room of socket.rooms) {
      if ((room.startsWith("player:") || room === SPECTATOR_ROOM) && !wantRooms.has(room)) void socket.leave(room);
    }
    for (const room of wantRooms) if (!socket.rooms.has(room)) void socket.join(room);
    socket.data.boundPlayerId = wantPlayer;
    socket.data.boundClaimId = status.status === "active" || status.status === "pending" ? claim?.id : undefined;
    if (status.status === "unclaimed" && socket.data.tokenHash) {
      socket.data.lastReason = status.reason;
      socket.data.tokenHash = undefined;
    }
    const key = JSON.stringify(status);
    if (socket.data.statusKey !== key) {
      socket.data.statusKey = key;
      socket.emit("player:status", status);
    }
  }

  sync() {
    for (const s of this.phoneSockets()) this.syncSocket(s);
  }

  private publicNow(): PublicState {
    return toPublicState(this.session, this.script, { seq: this.engine.currentSeq });
  }

  /** After a public emit: re-check every phone, then send each bound player and spectator their view. */
  afterBroadcast(pub: PublicState) {
    const orphans = dropOrphanClaims(this.session);
    if (orphans.length) {
      this.remember(orphans, "cleared");
      this.engine.mutatePrivate(() => {});
    }
    this.sync();
    if (!this.session.phones.enabled) return;
    const phonePublic = toPhonePublic(this.session, this.script, pub);
    if (this.io.sockets.adapter.rooms.get(SPECTATOR_ROOM)?.size) {
      this.io.to(SPECTATOR_ROOM).emit("state:watch", phonePublic);
    }
    for (const id of this.connectedPlayerIds()) this.sendPlayer(id, pub, phonePublic);
  }

  /** After a private change: only the listed players' phones get a new state (same seq). */
  afterPrivate(playerIds: string[]) {
    this.sync();
    if (!this.session.phones.enabled || playerIds.length === 0) return;
    const pub = this.publicNow();
    const phonePublic = toPhonePublic(this.session, this.script, pub);
    const live = this.connectedPlayerIds();
    for (const id of new Set(playerIds)) if (live.has(id)) this.sendPlayer(id, pub, phonePublic);
  }

  private sendPlayer(id: string, pub: PublicState, phonePublic: ReturnType<typeof toPhonePublic>) {
    const st = toPlayerState(this.session, this.script, id, pub, phonePublic);
    if (st) this.io.to(playerRoom(id)).emit("state:player", st);
  }

  private here() {
    return { phase: this.session.phase, day: this.session.dayNumber };
  }

  private seatLabel(playerId: string): string {
    const p = this.session.players.find((x) => x.id === playerId);
    return p ? `${p.name} (seat ${p.seat})` : playerId;
  }

  /** `join` with role player / spectator. Unknown or missing tokens just get "unclaimed". */
  join(socket: Socket, payload: { role: string; token?: unknown }, client: string) {
    socket.data.role = payload.role === "spectator" ? "spectator" : "player";
    void socket.join(PHONES_ROOM);
    socket.data.tokenHash = undefined;
    socket.data.statusKey = undefined;
    if (socket.data.role === "player" && typeof payload.token === "string" && payload.token.length <= 128) {
      const hash = hashToken(payload.token);
      const claim = findClaimByToken(this.session, hash);
      if (claim) {
        socket.data.tokenHash = hash;
        claim.lastSeenAt = Date.now();
        this.actionLog.record({
          t: Date.now(),
          kind: "connection",
          action: "player:join",
          outcome: "info",
          reason: `${claim.deviceLabel} for ${this.seatLabel(claim.playerId)}${claim.status === "pending" ? " (waiting for approval)" : ""}${this.session.phones.enabled ? "" : " (phones are off)"}`,
          client,
          ...this.here(),
        });
      } else {
        socket.data.lastReason = this.removedReasons.get(hash) ?? "unknown";
      }
    }
    this.syncSocket(socket);
    if (this.session.phones.enabled) {
      const id = socket.data.boundPlayerId as string | null;
      if (id) this.sendPlayer(id, this.publicNow(), toPhonePublic(this.session, this.script, this.publicNow()));
      if (socket.data.role === "spectator") socket.emit("state:watch", toPhonePublic(this.session, this.script, this.publicNow()));
    }
    this.engine.emitPrivate();
  }

  onDisconnect(socket: Socket) {
    if (socket.data.role !== "player" && socket.data.role !== "spectator") return;
    const hash = socket.data.tokenHash as string | undefined;
    const claim = hash ? findClaimByToken(this.session, hash) : undefined;
    if (claim) claim.lastSeenAt = Date.now();
    this.engine.emitPrivate();
  }

  /** Refused unless phones are on and the code (or lock-out) allows it. Returns an error ack or null. */
  private gate(client: string, code: unknown, expected: string): { ok: false; error: string; retryAfterMs?: number } | null {
    if (!this.session.phones.enabled) return { ok: false, error: "Player phones are off for this game." };
    const locked = this.throttle.lockedFor(client);
    if (locked > 0) {
      return { ok: false, error: `Too many wrong codes. Try again in ${Math.ceil(locked / 1000)} s.`, retryAfterMs: locked };
    }
    if (cleanCode(code) !== expected) {
      this.throttle.fail(client);
      return { ok: false, error: "That code is not right. Check the TV." };
    }
    this.throttle.succeed(client);
    return null;
  }

  /** player:* handlers. The player is always taken from the socket, never from the payload. */
  playerHandlers(socket: Socket, client: string): Record<string, Handler> {
    const own = () => {
      const hash = socket.data.tokenHash as string | undefined;
      return hash ? findClaimByToken(this.session, hash) : undefined;
    };
    return {
      "player:lookup": (d) => {
        const refused = this.gate(client, d.code, this.session.phones.joinCode);
        if (refused) return refused;
        const active = new Set(this.session.phones.claims.filter((c) => c.status === "active").map((c) => c.playerId));
        return {
          ok: true,
          claimsOpen: this.session.phones.claimsOpen,
          seats: this.session.players
            .filter((p) => !p.leftGame)
            .sort((a, b) => a.seat - b.seat)
            .map((p) => ({ id: p.id, seat: p.seat, name: p.name, taken: active.has(p.id) })),
        };
      },
      "player:claim": (d) => {
        const refused = this.gate(client, d.code, this.session.phones.joinCode);
        if (refused) return refused;
        if (!this.session.phones.claimsOpen) return { ok: false, error: "The Storyteller has closed seat claims." };
        const mine = own();
        if (mine?.status === "active") return { ok: false, error: "This phone already has a seat." };
        const label = deviceLabel(socket.handshake.headers["user-agent"]);
        const result = this.engine.mutatePrivate((s) => {
          if (mine) removeClaim(s, mine.id);
          const r = createClaim(s, String(d.playerId ?? ""), label);
          if (r.ok) socket.data.tokenHash = r.claim.tokenHash;
          return r;
        });
        if (!result.ok) return result;
        this.actionLog.record({
          t: Date.now(),
          kind: "auth",
          action: "player:claim",
          outcome: "info",
          reason: `${label} asks for ${this.seatLabel(result.claim.playerId)}`,
          client,
          ...this.here(),
        });
        return { ok: true, token: result.token };
      },
      "player:handover": (d) => {
        if (!this.session.phones.enabled) return { ok: false, error: "Player phones are off for this game." };
        const locked = this.throttle.lockedFor(client);
        if (locked > 0) return { ok: false, error: `Too many wrong codes. Try again in ${Math.ceil(locked / 1000)} s.` };
        const code = cleanCode(d.code);
        const h = this.handovers.get(code);
        if (!h || h.expiresAt < Date.now()) {
          if (h) this.handovers.delete(code);
          this.throttle.fail(client);
          return { ok: false, error: "That hand-over code is not right or has expired." };
        }
        this.throttle.succeed(client);
        this.handovers.delete(code);
        const label = deviceLabel(socket.handshake.headers["user-agent"]);
        const mine = own();
        const result = this.engine.mutatePrivate((s) => {
          if (mine) removeClaim(s, mine.id);
          const r = createClaim(s, h.playerId, label, { active: true });
          if (r.ok) {
            this.remember(r.replaced, "replaced");
            socket.data.tokenHash = r.claim.tokenHash;
          }
          return r;
        }, [h.playerId]);
        if (!result.ok) return result;
        this.actionLog.record({
          t: Date.now(),
          kind: "auth",
          action: "player:handover",
          outcome: "info",
          reason: `${label} took over ${this.seatLabel(h.playerId)} with a hand-over code`,
          client,
          ...this.here(),
        });
        return { ok: true, token: result.token };
      },
      "player:message": (d) => {
        const mine = own();
        if (!mine || mine.status !== "active" || socket.data.boundPlayerId !== mine.playerId) {
          return { ok: false, error: "Only an approved phone can message the Storyteller." };
        }
        const now = Date.now();
        const recent = (this.messageTimes.get(mine.playerId) ?? []).filter((t) => now - t < MESSAGE_WINDOW_MS);
        if (recent.length >= MESSAGES_PER_WINDOW) return { ok: false, error: "That's a lot of messages. Give the Storyteller a minute." };
        const r = this.engine.mutatePrivate((s) => addPlayerMessage(s, mine.playerId, d.kind, d.text, now), [mine.playerId]);
        if (!r.ok) return r;
        recent.push(now);
        this.messageTimes.set(mine.playerId, recent);
        this.actionLog.record({
          t: now,
          kind: "action",
          action: "player:message",
          outcome: "info",
          reason: `${this.seatLabel(mine.playerId)} ${r.message.kind === "word" ? "asks for a word" : "sent a question"}`,
          client,
          ...this.here(),
        });
        return { ok: true };
      },
      "player:hand": (d) => {
        const mine = own();
        if (!mine || mine.status !== "active" || socket.data.boundPlayerId !== mine.playerId) {
          return { ok: false, error: "Only an approved phone can vote." };
        }
        const now = Date.now();
        const recent = (this.handTimes.get(mine.playerId) ?? []).filter((t) => now - t < HAND_WINDOW_MS);
        if (recent.length >= HANDS_PER_WINDOW) return { ok: false, error: "Slow down — your hand is still being counted." };
        recent.push(now);
        this.handTimes.set(mine.playerId, recent);
        return this.engine.setPhoneHand(mine.playerId, d.up === true);
      },
      "player:leave": () => {
        const mine = own();
        if (!mine) return { ok: true };
        this.engine.mutatePrivate((s) => removeClaim(s, mine.id));
        socket.data.tokenHash = undefined;
        socket.data.lastReason = null;
        this.syncSocket(socket);
        return { ok: true };
      },
    };
  }

  /** Storyteller game:phone* actions (they go through the normal Storyteller guard and log). */
  storytellerActions(): Record<string, Handler> {
    const change = (fn: (s: GameSession) => ClaimChange, reason: RemovedReason | null, affected: (s: GameSession) => string[] = () => []) => {
      let ids: string[] = [];
      const r = this.engine.mutatePrivate((s) => {
        const out = fn(s);
        // Before the emit: the sync that follows tells each removed phone why.
        if (reason) this.remember(out.removed, reason);
        ids = [...affected(s), ...out.removed.map((c) => c.playerId)];
        return out;
      });
      this.afterPrivate(ids);
      return { ok: r.ok, message: r.message };
    };
    return {
      "game:setPhones": (d) => {
        const on = Boolean(d.on);
        this.engine.setPhonesEnabled(on);
        return { ok: true };
      },
      "game:phoneApprove": (d) => {
        const claimId = String(d.claimId ?? "");
        const playerId = this.session.phones.claims.find((c) => c.id === claimId)?.playerId;
        return change((s) => approveClaim(s, claimId, Boolean(d.keepOthers)), "replaced", () => (playerId ? [playerId] : []));
      },
      "game:phoneDeny": (d) => change((s) => removeClaim(s, String(d.claimId ?? "")), "denied"),
      "game:phoneRevoke": (d) => {
        const claim = this.session.phones.claims.find((c) => c.id === String(d.claimId ?? ""));
        const holders = claim ? this.phoneSockets().filter((s) => s.data.tokenHash === claim.tokenHash) : [];
        const result = change((s) => removeClaim(s, String(d.claimId ?? "")), "revoked");
        // They were just told "revoked"; then the connection itself goes.
        for (const s of holders) setTimeout(() => s.disconnect(true), 200);
        return result;
      },
      "game:phoneReassign": (d) => {
        const claimId = String(d.claimId ?? "");
        const from = this.session.phones.claims.find((c) => c.id === claimId)?.playerId;
        const to = String(d.playerId ?? "");
        return change((s) => reassignClaim(s, claimId, to), "replaced", () => [to, ...(from ? [from] : [])]);
      },
      "game:phoneClearClaims": () => change((s) => clearClaims(s), "cleared"),
      "game:phoneHandover": (d) => {
        if (!this.session.phones.enabled) return { ok: false, message: "Player phones are off." };
        const playerId = String(d.playerId ?? "");
        if (!this.session.players.some((p) => p.id === playerId && !p.leftGame)) return { ok: false, message: "Pick a seat." };
        for (const [code, h] of this.handovers) if (h.playerId === playerId || h.expiresAt < Date.now()) this.handovers.delete(code);
        let code = randomCode(6);
        while (this.handovers.has(code)) code = randomCode(6);
        const expiresAt = Date.now() + HANDOVER_TTL_MS;
        this.handovers.set(code, { playerId, expiresAt });
        this.engine.emitPrivate();
        return { ok: true, code, expiresAt };
      },
      "game:phoneDistribute": () => {
        let ids: string[] = [];
        const r = this.engine.mutatePrivate((s) => {
          const out = distributeCharacters(s, this.script, setupWarning(s, this.script));
          if (out.ok) ids = out.playerIds;
          return out;
        });
        this.afterPrivate(ids);
        return r.ok ? { ok: true, message: `Sent to ${ids.length} seats.` } : r;
      },
      "game:phoneResend": (d) => {
        const playerId = String(d.playerId ?? "");
        const r = this.engine.mutatePrivate((s) => resendCharacter(s, this.script, playerId));
        if (r.ok) this.afterPrivate([playerId]);
        return r;
      },
      "game:phoneReply": (d) => {
        const playerId = String(d.playerId ?? "");
        const r = this.engine.mutatePrivate((s) => addStorytellerReply(s, playerId, d.text), [playerId]);
        return r;
      },
      "game:phoneMarkRead": (d) => this.engine.mutatePrivate((s) => markMessagesRead(s, String(d.playerId ?? ""))),
      "game:phoneRotateCode": () => {
        this.engine.mutate((s) => {
          s.phones.joinCode = randomCode(4);
        });
        return { ok: true };
      },
      "game:phoneVoting": (d) => {
        this.engine.setPhoneVoting(d.mode === "manual" ? "manual" : "phones");
        return { ok: true };
      },
      "game:phoneSweepSpeed": (d) => {
        this.engine.setSweepSpeed(Number(d.ms));
        return { ok: true };
      },
      "game:phoneSweepStart": () => this.engine.sweepStart(),
      "game:phoneSweepPause": () => {
        this.engine.sweepPause();
        return { ok: true };
      },
      "game:phoneSweepBack": () => {
        this.engine.sweepBack();
        return { ok: true };
      },
      "game:phoneClaimsOpen": (d) => {
        this.engine.mutate((s) => {
          s.phones.claimsOpen = Boolean(d.open);
        });
        return { ok: true };
      },
    };
  }

  /** Before a new game: a claim that isn't re-bound by seat reads as "cleared" to the phone that held it. */
  rememberCleared(claims: PhoneClaim[]) {
    this.remember(claims, "cleared");
  }
}

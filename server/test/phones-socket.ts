/**
 * Player phones over real sockets: Storyteller + TV + 5 phones + a spectator against the real server
 * (temp session, spare port). Phones off by default, isolation, impersonation, revoke, reconnect,
 * switching off mid-game, hand-over, new game re-binding, join-code throttling.
 * Run: cd server && npx tsx test/phones-socket.ts
 */
import {
  ask,
  client,
  count,
  last,
  runAsyncCases,
  sleep,
  startServer,
  storyteller,
  until,
  type AsyncCase,
  type Rec,
} from "./_server.js";

const PIN = "73914826";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const PIXEL = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

const srv = await startServer({ BOTC_PIN: PIN });
const all: Rec[] = [];
async function sock(label: string, ua?: string): Promise<Rec> {
  const r = await client(srv.port, label, { userAgent: ua });
  all.push(r);
  return r;
}

type Status = { status: string; reason?: string | null; playerId?: string };
type Claim = { id: string; playerId: string; status: string; deviceLabel: string; connected: number };
type StState = {
  seq: number;
  players: { id: string; name: string; notes: string }[];
  phones: { enabled: boolean; joinCode: string; claims: Claim[] };
};
type PlayerSt = { seq: number; me: { playerId: string; name: string }; players: { id: string; name: string }[] };

const status = (r: Rec) => last<Status>(r, "player:status");
const stState = (st: Rec) => last<StState>(st, "state:storyteller")!;

async function phone(label: string, token?: string, ua = IPHONE): Promise<Rec> {
  const r = await sock(label, ua);
  r.socket.emit("join", { role: "player", ...(token ? { token } : {}) });
  await until(() => !!status(r), `${label} status`);
  return r;
}

const st = await storyteller(srv.port, PIN);
const act = (event: string, data: unknown = {}) => ask(st, event, data);
const tv = await sock("tv");
tv.socket.emit("join", { role: "tv" });
await until(() => count(tv, "state:public") > 0, "tv state");

/** Names and canary notes for seats p1..p7; characters set on the grimoire (never sent to phones). */
async function seatTable() {
  await act("game:setPlayerCount", { count: 7 });
  const roles = ["washerwoman", "empath", "fortuneteller", "monk", "chef", "poisoner", "imp"];
  for (let i = 1; i <= 7; i++) {
    await act("game:updatePlayer", {
      playerId: `p${i}`,
      patch: { name: `Seat${i}`, notes: `CANARY-NOTE-p${i}`, characterId: roles[i - 1], reminders: i === 2 ? ["Poisoned"] : [] },
    });
  }
}

const phonesBySeat = new Map<string, { rec: Rec; token: string }>();
const tokens: string[] = [];

async function claimSeat(playerId: string, ua = IPHONE): Promise<{ rec: Rec; token: string }> {
  const code = stState(st).phones.joinCode;
  const rec = await phone(`phone-${playerId}`, undefined, ua);
  const res = await ask<{ ok: boolean; token?: string; error?: string }>(rec, "player:claim", { code, playerId });
  if (!res.ok || !res.token) throw new Error(`claim ${playerId}: ${JSON.stringify(res)}`);
  tokens.push(res.token);
  await until(() => status(rec)?.status === "pending", `${playerId} pending`);
  return { rec, token: res.token };
}

async function approve(playerId: string, rec: Rec) {
  await until(() => stState(st).phones.claims.some((c) => c.playerId === playerId && c.status === "pending"), "claim on ST");
  const claim = stState(st).phones.claims.find((c) => c.playerId === playerId && c.status === "pending")!;
  const r = await act("game:phoneApprove", { claimId: claim.id });
  if (!r.ok) throw new Error(`approve: ${JSON.stringify(r)}`);
  await until(() => status(rec)?.status === "active" && !!last(rec, "state:player"), `${playerId} active`);
}

const cases: AsyncCase[] = [
  {
    name: "Phones off (default): phones only hear 'off', lookups and claims are refused, the TV shows no join code",
    run: async () => {
      if (stState(st).phones.enabled) return "phones on by default";
      const p = await phone("off-phone", "not-a-real-token");
      const spec = await sock("off-spectator");
      spec.socket.emit("join", { role: "spectator" });
      await until(() => !!last(spec, "player:status"), "spectator status");
      if (status(p)?.status !== "off" || last<Status>(spec, "player:status")?.status !== "off") return "not told off";
      const look = await ask(p, "player:lookup", { code: stState(st).phones.joinCode });
      const claim = await ask(p, "player:claim", { code: stState(st).phones.joinCode, playerId: "p1" });
      if (look.ok !== false || claim.ok !== false) return `accepted while off: ${JSON.stringify({ look, claim })}`;
      await seatTable();
      await sleep(200);
      if (stState(st).phones.claims.length) return "a claim was stored while off";
      if (last<{ phoneJoin: unknown }>(tv, "state:public")?.phoneJoin !== null) return "TV got a join code";
      const heard = new Set([...p.events, ...spec.events].map((e) => e.event));
      heard.delete("player:status");
      return heard.size ? `phone sockets heard ${[...heard].join(", ")}` : null;
    },
  },
  {
    name: "On: TV shows the code; 5 phones claim and wait (no state while pending); the Storyteller approves each",
    run: async () => {
      await act("game:setPhones", { on: true });
      await until(() => !!last<{ phoneJoin: { code: string } | null }>(tv, "state:public")?.phoneJoin, "TV join code");
      const code = last<{ phoneJoin: { code: string } }>(tv, "state:public")!.phoneJoin.code;
      if (code !== stState(st).phones.joinCode) return "TV and Storyteller codes differ";
      const lookup = await sock("lookup");
      lookup.socket.emit("join", { role: "player" });
      const seats = await ask<{ ok: boolean; seats: { id: string; name: string }[] }>(lookup, "player:lookup", { code: code.toLowerCase() });
      if (!seats.ok || seats.seats.length !== 7 || seats.seats[0]!.name !== "Seat1") return `lookup ${JSON.stringify(seats)}`;
      if (JSON.stringify(seats).includes("CANARY") || JSON.stringify(seats).includes("characterId")) return "lookup leaks";
      for (const id of ["p1", "p2", "p3", "p4", "p5"]) {
        phonesBySeat.set(id, await claimSeat(id, id === "p2" ? PIXEL : IPHONE));
      }
      for (const [, { rec }] of phonesBySeat) if (count(rec, "state:player")) return `${rec.label} got state while pending`;
      const pending = stState(st).phones.claims;
      if (pending.length !== 5 || pending.some((c) => c.status !== "pending")) return `ST claims ${JSON.stringify(pending)}`;
      if (pending.find((c) => c.playerId === "p2")?.deviceLabel !== "Android Chrome") return "device label";
      for (const [id, { rec }] of phonesBySeat) await approve(id, rec);
      for (const [id, { rec }] of phonesBySeat) {
        const s = last<PlayerSt>(rec, "state:player")!;
        if (s.me.playerId !== id || s.me.name !== `Seat${id.slice(1)}`) return `${id} me ${JSON.stringify(s.me)}`;
      }
      const spec = await sock("spectator");
      spec.socket.emit("join", { role: "spectator" });
      await until(() => !!last(spec, "state:watch"), "spectator state");
      return (last(spec, "state:watch") as Record<string, unknown>).me ? "spectator got a me block" : null;
    },
  },
  {
    name: "Isolation: every phone payload is its own; no notes, reminders, characters, hashes or other tokens anywhere",
    run: async () => {
      await act("game:updatePlayer", { playerId: "p6", patch: { notes: "CANARY-NOTE-p6-late" } });
      await act("game:startFirstNight");
      await act("game:nightNext");
      await sleep(300);
      const chars = ["Washerwoman", "Empath", "Fortune Teller", "Monk", "Chef", "Poisoner", "Imp"];
      for (const [id, { rec, token }] of phonesBySeat) {
        for (const e of rec.events) {
          if (e.event === "state:player" && (e.data as PlayerSt).me.playerId !== id) return `${id} got ${(e.data as PlayerSt).me.playerId}`;
          const { sheet: _s, ...rest } = (e.data ?? {}) as Record<string, unknown>;
          const json = JSON.stringify(rest);
          for (const bad of ["CANARY", '"reminders"', '"notes"', '"tokenHash"', '"characterId"', "Poisoned", ...chars]) {
            if (json.includes(bad)) return `${id} ${e.event} contains ${bad}`;
          }
          for (const t of tokens) if (t !== token && json.includes(t)) return `${id} saw another phone's token`;
        }
      }
      for (const r of [tv, st]) {
        const json = JSON.stringify(r.events);
        if (json.includes("tokenHash")) return `${r.label} saw token hashes`;
        for (const t of tokens) if (json.includes(t)) return `${r.label} saw a raw token`;
      }
      return null;
    },
  },
  {
    name: "Private changes (claim, approve) send nothing to the TV and keep the public seq",
    run: async () => {
      const tvBefore = count(tv, "state:public");
      const seq = last<{ seq: number }>(tv, "state:public")!.seq;
      const extra = await claimSeat("p6", PIXEL);
      phonesBySeat.set("p6", extra);
      await approve("p6", extra.rec);
      await sleep(200);
      if (count(tv, "state:public") !== tvBefore) return `TV got ${count(tv, "state:public") - tvBefore} public states`;
      const mine = last<PlayerSt>(extra.rec, "state:player")!;
      if (mine.seq !== seq) return `phone seq ${mine.seq} vs public ${seq}`;
      return stState(st).seq === seq ? null : `storyteller seq ${stState(st).seq} vs ${seq}`;
    },
  },
  {
    name: "Impersonation: game actions, TV/Storyteller joins, other seats and forged tokens all fail from a phone",
    run: async () => {
      const p1 = phonesBySeat.get("p1")!.rec;
      const ack = await ask(p1, "game:updatePlayer", { playerId: "p2", patch: { name: "Hacked" } });
      if (ack.ok !== false) return `game action from a phone: ${JSON.stringify(ack)}`;
      p1.socket.emit("join", { role: "tv" });
      p1.socket.emit("join", { role: "storyteller", pin: PIN });
      await sleep(200);
      await act("game:updatePlayer", { playerId: "p7", patch: { name: "Seat7b" } });
      await sleep(300);
      if (count(p1, "state:public") || count(p1, "state:storyteller")) return "phone joined the TV / Storyteller room";
      if (stState(st).players.find((p) => p.id === "p2")?.name !== "Seat2") return "name changed by a phone";
      const again = await ask(p1, "player:claim", { code: stState(st).phones.joinCode, playerId: "p2" });
      if (again.ok !== false) return "an approved phone claimed a second seat";
      const forged = await phone("forged", tokens[1]!.slice(0, -2) + "xx");
      if (status(forged)?.status !== "unclaimed" || count(forged, "state:player")) return "forged token accepted";
      const stranger = await phone("stranger");
      await ask(stranger, "player:leave", { playerId: "p2" });
      if (!stState(st).phones.claims.some((c) => c.playerId === "p2")) return "player:leave removed someone else's seat";
      const raw = await sock("never-joined");
      const r = await ask(raw, "player:claim", { code: stState(st).phones.joinCode, playerId: "p7" });
      return r.ok === false ? null : "claim without joining as a player";
    },
  },
  {
    name: "Reconnect: the same token after a drop gets the seat back without the Storyteller",
    run: async () => {
      const old = phonesBySeat.get("p3")!;
      old.rec.socket.disconnect();
      await sleep(200);
      const claim = stState(st).phones.claims.find((c) => c.playerId === "p3")!;
      if (claim.connected !== 0) return `still connected: ${claim.connected}`;
      const back = await phone("p3-back", old.token);
      await until(() => !!last(back, "state:player"), "state after reconnect");
      if (last<PlayerSt>(back, "state:player")!.me.playerId !== "p3") return "wrong seat after reconnect";
      await until(() => stState(st).phones.claims.find((c) => c.playerId === "p3")!.connected === 1, "ST sees reconnect");
      phonesBySeat.set("p3", { rec: back, token: old.token });
      return null;
    },
  },
  {
    name: "Revoke: the phone is told, disconnected, and its token stops working",
    run: async () => {
      const { rec, token } = phonesBySeat.get("p5")!;
      const claim = stState(st).phones.claims.find((c) => c.playerId === "p5")!;
      await act("game:phoneRevoke", { claimId: claim.id });
      await until(() => status(rec)?.status === "unclaimed", "revoked status");
      if (status(rec)?.reason !== "revoked") return `reason ${status(rec)?.reason}`;
      await until(() => !rec.socket.connected, "disconnect after revoke");
      const retry = await phone("p5-retry", token);
      if (status(retry)?.status !== "unclaimed" || status(retry)?.reason !== "revoked") return `retry ${JSON.stringify(status(retry))}`;
      phonesBySeat.delete("p5");
      return count(retry, "state:player") ? "revoked token got state" : null;
    },
  },
  {
    name: "Phones off mid-game: phones get 'off' and no more state; claims kept; on again re-links them",
    run: async () => {
      await act("game:setPhones", { on: false });
      for (const [id, { rec }] of phonesBySeat) await until(() => status(rec)?.status === "off", `${id} off`);
      const before = new Map([...phonesBySeat].map(([id, { rec }]) => [id, count(rec, "state:player")]));
      await act("game:updatePlayer", { playerId: "p7", patch: { name: "Seat7c" } });
      await act("game:nightNext");
      await sleep(300);
      for (const [id, { rec }] of phonesBySeat) if (count(rec, "state:player") !== before.get(id)) return `${id} got state while off`;
      if (last<{ phoneJoin: unknown }>(tv, "state:public")?.phoneJoin !== null) return "TV still shows the join code";
      if (stState(st).phones.claims.length !== phonesBySeat.size) return `claims ${stState(st).phones.claims.length}`;
      await act("game:setPhones", { on: true });
      for (const [id, { rec }] of phonesBySeat) {
        await until(() => status(rec)?.status === "active" && count(rec, "state:player") > before.get(id)!, `${id} back`);
      }
      return null;
    },
  },
  {
    name: "Hand-over: a one-time code moves a seat to a new phone; the old phone hears 'replaced'",
    run: async () => {
      const old = phonesBySeat.get("p4")!;
      const r = await act("game:phoneHandover", { playerId: "p4" });
      if (!r.ok || typeof r.code !== "string") return `handover ${JSON.stringify(r)}`;
      const fresh = await phone("p4-new", undefined, PIXEL);
      const res = await ask<{ ok: boolean; token?: string }>(fresh, "player:handover", { code: String(r.code).toLowerCase() });
      if (!res.ok || !res.token) return `use: ${JSON.stringify(res)}`;
      await until(() => last<PlayerSt>(fresh, "state:player")?.me.playerId === "p4", "new phone state");
      await until(() => status(old.rec)?.status === "unclaimed", "old phone told");
      if (status(old.rec)?.reason !== "replaced") return `old reason ${status(old.rec)?.reason}`;
      const reuse = await phone("p4-reuse");
      const again = await ask(reuse, "player:handover", { code: r.code });
      phonesBySeat.set("p4", { rec: fresh, token: res.token });
      return again.ok === false ? null : "hand-over code worked twice";
    },
  },
  {
    name: "Distribute: each phone gets only its own card, the TV gets nothing; Re-send reaches one phone only",
    run: async () => {
      const roles: Record<string, string> = { p1: "washerwoman", p2: "empath", p3: "fortuneteller", p4: "monk", p6: "poisoner" };
      const tvBefore = count(tv, "state:public");
      const r = await act("game:phoneDistribute");
      if (!r.ok) return `distribute ${JSON.stringify(r)}`;
      type Card = PlayerSt & { me: { character: { id: string } | null; alignment: string | null } };
      for (const [id, { rec }] of phonesBySeat) {
        await until(() => last<Card>(rec, "state:player")?.me.character?.id === roles[id], `${id} card`);
        const { sheet: _s, ...rest } = last<Card>(rec, "state:player")!;
        const json = JSON.stringify(rest);
        for (const [other, role] of Object.entries({ ...roles, p5: "chef", p7: "imp" })) {
          if (other !== id && json.includes(`"${role}"`)) return `${id} payload mentions ${role}`;
        }
      }
      if (last<Card>(phonesBySeat.get("p6")!.rec, "state:player")!.me.alignment !== "evil") return "poisoner not told evil";
      if (count(tv, "state:public") !== tvBefore) return "TV got a state for a private reveal";
      await act("game:updatePlayer", { playerId: "p1", patch: { characterId: "investigator" } });
      await sleep(300);
      const p1 = phonesBySeat.get("p1")!.rec;
      if (last<Card>(p1, "state:player")!.me.character?.id !== "washerwoman") return "grimoire edit reached the phone live";
      const p2 = phonesBySeat.get("p2")!.rec;
      const p2Before = count(p2, "state:player");
      const re = await act("game:phoneResend", { playerId: "p1" });
      if (!re.ok) return `resend ${JSON.stringify(re)}`;
      await until(() => last<Card>(p1, "state:player")?.me.character?.id === "investigator", "re-sent card");
      await sleep(200);
      return count(p2, "state:player") === p2Before ? null : "another phone got a state on someone else's re-send";
    },
  },
  {
    name: "Messages: refused at night and from unlinked phones; reach only the Storyteller; replies reach only that phone; rate-limited",
    run: async () => {
      type Msgs = PlayerSt & { me: { messages: { from: string; text: string }[] } };
      type StPriv = StState & { phase: string; phones: { private: Record<string, { messages: { text: string }[]; unreadByStoryteller: number }> } };
      const p1 = phonesBySeat.get("p1")!.rec;
      const p2 = phonesBySeat.get("p2")!.rec;
      const night = await ask(p1, "player:message", { kind: "question", text: "CANARY-Q at night" });
      if (night.ok !== false || !/night/.test(String(night.error))) return `night: ${JSON.stringify(night)}`;
      await act("game:goDawn");
      await act("game:finishDawn");
      await until(() => (stState(st) as StPriv).phase === "day", "day");
      const stranger = await phone("msg-stranger");
      const s = await ask(stranger, "player:message", { kind: "question", text: "CANARY-Q stranger" });
      if (s.ok !== false) return "unlinked phone sent a message";
      const tvBefore = count(tv, "state:public");
      const p2Before = count(p2, "state:player");
      const ok = await ask(p1, "player:message", { kind: "question", text: "CANARY-Q does the Monk stop the Slayer?" });
      if (!ok.ok) return `send ${JSON.stringify(ok)}`;
      await until(() => (stState(st) as StPriv).phones.private.p1?.unreadByStoryteller === 1, "Storyteller unread");
      await until(() => !!last<Msgs>(p1, "state:player")?.me.messages.some((m) => m.text.startsWith("CANARY-Q")), "own copy");
      await act("game:phoneReply", { playerId: "p1", text: "CANARY-R yes" });
      await until(() => last<Msgs>(p1, "state:player")?.me.messages.at(-1)?.text === "CANARY-R yes", "reply on the phone");
      if ((stState(st) as StPriv).phones.private.p1?.unreadByStoryteller !== 0) return "reply did not mark read";
      await sleep(200);
      if (count(tv, "state:public") !== tvBefore) return "TV got a state for a message";
      if (count(p2, "state:player") !== p2Before) return "another phone got a state for p1's message";
      for (const r of [tv, p2, stranger]) if (JSON.stringify(r.events).includes("CANARY-")) return `${r.label} saw message text`;
      let refused: Record<string, unknown> | null = null;
      for (let i = 0; i < 8 && !refused; i++) {
        const r = await ask(p2, "player:message", { kind: "word" });
        if (r.ok === false) refused = r;
      }
      return refused && /minute/.test(String(refused.error)) ? null : `no rate limit: ${JSON.stringify(refused)}`;
    },
  },
  {
    name: "Phone voting: hands from the socket's own seat only; the timed clock hand locks them; hand-counted seats stay the Storyteller's",
    run: async () => {
      type Nom = {
        votesFor: string[];
        phoneVote: { phoneSeats: string[]; handsUp: string[]; sweep: { index: number; order: string[] } | null } | null;
      };
      type Pub = { phase: string; nomination: Nom | null };
      type Mine = PlayerSt & { me: { vote: { byPhone: boolean; locked: boolean; counted: boolean } | null } };
      const nom = () => last<Pub>(tv, "state:public")?.nomination ?? null;
      const sorted = (xs: string[] | undefined) => [...(xs ?? [])].sort().join(",");
      const p1 = phonesBySeat.get("p1")!.rec;
      const p3 = phonesBySeat.get("p3")!.rec;
      await act("game:goDusk");
      await act("game:openNominations");
      const n = await act("game:startNomination", { nominatorId: "p6", nomineeId: "p7" });
      if (n.ok === false) return `nomination: ${JSON.stringify(n)}`;
      const early = await ask(p1, "player:hand", { up: true });
      if (early.ok !== false) return "hand accepted before the vote opened";
      await act("game:phoneSweepSpeed", { ms: 500 });
      await act("game:startVote", { seconds: 30 });
      await until(() => !!nom()?.phoneVote, "phone vote on the TV");
      if (sorted(nom()!.phoneVote!.phoneSeats) !== "p1,p2,p3,p4,p6") return `phone seats ${nom()!.phoneVote!.phoneSeats}`;
      const forged = await ask(p1, "player:hand", { up: true, playerId: "p2" });
      if (!forged.ok) return `p1 hand: ${JSON.stringify(forged)}`;
      if (!(await ask(p3, "player:hand", { up: true })).ok) return "p3 hand refused";
      const stranger = await phone("hand-stranger");
      if ((await ask(stranger, "player:hand", { up: true })).ok !== false) return "an unlinked phone voted";
      await until(() => sorted(nom()?.phoneVote?.handsUp) === "p1,p3", "hands on the TV");
      if (nom()!.votesFor.length) return "phone hands counted before the clock hand";
      await act("game:toggleVote", { playerId: "p5" });
      const started = await act("game:phoneSweepStart");
      if (started.ok === false) return `start: ${JSON.stringify(started)}`;
      await until(() => nom()?.phoneVote?.sweep?.index === 7, "clock hand round the table", 9000);
      if (sorted(nom()!.votesFor) !== "p1,p3,p5") return `counted ${sorted(nom()!.votesFor)}`;
      const late = await ask(p1, "player:hand", { up: false });
      if (late.ok !== false || !/locked/i.test(String(late.error))) return `lowered after lock: ${JSON.stringify(late)}`;
      await until(() => !!last<Mine>(p1, "state:player")?.me.vote?.locked, "p1 sees locked");
      const v = last<Mine>(p1, "state:player")!.me.vote!;
      if (!v.byPhone || !v.counted) return `p1 vote card ${JSON.stringify(v)}`;
      if (JSON.stringify(tv.events).includes("overridden")) return "override list reached the TV";
      await act("game:resolveVote");
      await until(() => nom() === null, "vote closed");
      return null;
    },
  },
  {
    name: "New game: 'same table' keeps phones bound by seat; a plain new game clears them",
    run: async () => {
      await act("game:reset", { sameTable: true });
      for (const [id, { rec }] of phonesBySeat) {
        await until(() => last<PlayerSt>(rec, "state:player")?.me.name === `Seat${id.slice(1)}` && status(rec)?.status === "active", `${id} rebound`);
      }
      await act("game:reset", {});
      for (const [id, { rec }] of phonesBySeat) {
        await until(() => status(rec)?.status === "unclaimed", `${id} cleared`);
        if (status(rec)?.reason !== "cleared") return `${id} reason ${status(rec)?.reason}`;
      }
      return stState(st).phones.claims.length ? "claims left after a plain new game" : null;
    },
  },
  {
    name: "Wrong join codes are throttled per address",
    run: async () => {
      const p = await phone("guesser");
      let lastRes: Record<string, unknown> = {};
      for (let i = 0; i < 9; i++) lastRes = await ask(p, "player:lookup", { code: "ZZZZ" });
      if (!/Try again in \d+ s/.test(String(lastRes.error))) return `not throttled: ${JSON.stringify(lastRes)}`;
      const right = await ask(p, "player:lookup", { code: stState(st).phones.joinCode });
      return right.ok === false ? null : "right code accepted during the lock-out";
    },
  },
];

await runAsyncCases(cases, () => {
  for (const r of all) r.socket.disconnect();
  st.socket.disconnect();
  srv.stop();
});

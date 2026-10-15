/**
 * Player phones, engine level: the per-player projection never leaks, private emits stay private,
 * claims keep only hashes, undo and new games treat phone data as decided.
 * Run: cd server && npx tsx test/phones.ts
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { player, projection, persistence, runCases, script, setup, type Case, type Engine } from "./_harness.js";

const phones = await import("../src/phones.js");
const undo = await import("../src/undo.js");
const NAMES = ["Ada", "Bo", "Cy", "Di", "Ed", "Flo", "Gus"];
const ROLES = ["washerwoman", "empath", "fortuneteller", "drunk", "monk", "poisoner", "imp"];

function canaryGame(): Engine {
  const e = setup(ROLES, {
    phase: "lobby",
    day: 0,
    mutate: (s) => {
      s.players.forEach((p, i) => {
        p.name = NAMES[i]!;
        p.notes = `CANARY-NOTE-${p.id}`;
      });
      s.players[3]!.thinksCharacterId = "chef";
      s.players[3]!.reminders = ["Is the Drunk"];
      s.players[1]!.reminders = ["Poisoned"];
      s.players[4]!.reminders = ["Red herring"];
      s.players[6]!.bluffs = ["saint", "mayor", "slayer"];
      s.phones.enabled = true;
    },
  });
  // What each phone was told: the Drunk believes they are the Chef.
  for (const p of e.session.players) {
    const r = phones.resendCharacter(e.session, script, p.id);
    if (!r.ok) throw new Error(`canary reveal ${p.id}: ${r.message}`);
  }
  return e;
}

const FORBIDDEN_KEYS = [
  "reminders",
  "notes",
  "bluffs",
  "thinksCharacterId",
  "characterId",
  "truthNumber",
  "truthYesNo",
  "truthPlayerIds",
  "truthCharacterId",
  "stWarning",
  "registration",
  "hint",
  "tokenHash",
  "voteTokens",
  "abilityUsed",
  "startingCharacters",
  "stNotices",
  "night",
  "newDemons",
  "claims",
  "private",
  "soundCue",
  "hueScene",
  "ambiance",
  "learnedDemon",
];
const CANARY_TEXT = ["CANARY-NOTE", "Poisoned", "Red herring", "Is the Drunk"];

function playerState(e: Engine, id: string) {
  const pub = projection.toPublicState(e.session, script, { seq: 1 });
  return phones.toPlayerState(e.session, script, id, pub);
}

/** Everything one phone gets, minus the public script sheet and its own card, must name no character. */
function leaks(e: Engine, viewerId: string, st = playerState(e, viewerId)): string | null {
  if (!st) return `no state for ${viewerId}`;
  if (st.me.playerId !== viewerId) return `me is ${st.me.playerId}`;
  const own = phones.privateFor(e.session, viewerId).revealedCharacterId;
  if ((st.me.character?.id ?? null) !== own) return `${viewerId} card ${st.me.character?.id} != revealed ${own}`;
  const { sheet: _sheet, me, ...rest } = st;
  const { character: _c, alignment: _a, ...meRest } = me;
  const json = JSON.stringify({ ...rest, me: meRest });
  for (const k of FORBIDDEN_KEYS) if (json.includes(`"${k}":`)) return `${viewerId} (${e.session.phase}): key ${k}`;
  for (const t of CANARY_TEXT) if (json.includes(t)) return `${viewerId} (${e.session.phase}): text ${t}`;
  if (e.session.phase !== "ended") {
    for (const c of [...script.characters, ...script.travellers]) {
      if (json.includes(`"${c.id}"`) || new RegExp(`\\b${c.name}\\b`).test(json)) {
        return `${viewerId} (${e.session.phase}): character ${c.name}`;
      }
    }
  }
  return null;
}

function leaksForAll(e: Engine): string | null {
  for (const p of e.session.players) {
    const err = leaks(e, p.id);
    if (err) return err;
  }
  return null;
}

const cases: Case[] = [
  {
    name: "Canary: no phone sees another player's character, reminders, notes or truth fields in any phase",
    run: () => {
      const e = canaryGame();
      const checks: string[] = [];
      const check = (label: string) => {
        const err = leaksForAll(e);
        if (err) checks.push(`${label}: ${err}`);
      };
      check("lobby");
      e.startFirstNight();
      for (let i = 0; i < 6; i++) {
        check(`first night step ${i}`);
        e.nightNext();
      }
      e.goDawn();
      check("dawn");
      e.announceDawnDeaths();
      e.finishDawn();
      check("day");
      e.goDusk();
      e.openNominations();
      check("dusk");
      e.startNomination(player(e, "p1").id, player(e, "p2").id);
      check("nomination");
      e.startVote(30);
      e.toggleVote("p3");
      e.toggleVote("p4");
      check("vote");
      e.resolveVote();
      check("after vote");
      e.startNight();
      e.applyNightReminder("p3", "Poisoned");
      check("night");
      return checks.length ? checks.join("\n      ") : null;
    },
  },
  {
    name: "The canary check itself catches a spread Player, a note and a neighbour's character",
    run: () => {
      const e = canaryGame();
      const good = playerState(e, "p1")!;
      const spread = { ...good, players: e.session.players.map((p) => ({ ...p })) };
      const note = { ...good, me: { ...good.me, name: "CANARY-NOTE-p2" } };
      const other = { ...good, winReason: "Gus is the Imp" };
      const misses = [spread, note, other].filter((st) => !leaks(e, "p1", st as typeof good));
      return misses.length ? `${misses.length} injected leak(s) not caught` : null;
    },
  },
  {
    name: "The Drunk's phone shows the Townsfolk they think they are, never 'drunk'",
    run: () => {
      const e = canaryGame();
      const st = playerState(e, "p4")!;
      if (st.me.character?.id !== "chef") return `card ${st.me.character?.id}`;
      if (st.me.alignment !== "good") return `alignment ${st.me.alignment}`;
      const { sheet: _s, ...rest } = st;
      return JSON.stringify(rest).includes('"drunk"') ? "the word drunk reached the Drunk's phone" : null;
    },
  },
  {
    name: "A phone learns of its own overnight death only at the dawn announcement",
    run: () => {
      const e = canaryGame();
      e.session.phase = "day";
      e.session.dayNumber = 1;
      e.startNight();
      const r = e.otherDeath("p2", "Imp");
      if (!r.ok) return `kill refused: ${JSON.stringify(r)}`;
      if (player(e, "p2").alive) return "grimoire still alive";
      if (!playerState(e, "p2")!.me.alive) return "dead on own phone during the night";
      if (!playerState(e, "p1")!.players.find((p) => p.id === "p2")!.alive) return "dead on a neighbour's phone at night";
      e.goDawn();
      if (!playerState(e, "p2")!.me.alive) return "dead on own phone before the announcement";
      e.announceDawnDeaths();
      return playerState(e, "p2")!.me.alive ? "still alive after the announcement" : null;
    },
  },
  {
    name: "Phone public view is an allowlist: no sound, lights, ambiance; the script sheet is always there",
    run: () => {
      const e = canaryGame();
      const pub = projection.toPublicState(e.session, script, { seq: 3, soundCue: "dawn", hueScene: "dawn" });
      const v = phones.toPhonePublic(e.session, script, pub) as Record<string, unknown>;
      for (const k of ["soundCue", "hueScene", "ambiance", "storytellerConnected", "phoneJoin"]) {
        if (k in v) return `has ${k}`;
      }
      if (v.seq !== 3) return `seq ${v.seq}`;
      if (v.gameId !== e.session.gameId) return "no gameId";
      const sheet = v.sheet as { characters: unknown[] };
      return sheet.characters.length === script.characters.length ? null : "sheet incomplete";
    },
  },
  {
    name: "Phones off: the TV shows no join code; on with claims open it does; claims closed hides it",
    run: () => {
      const e = setup(["chef", "empath", "monk", "poisoner", "imp"], { phase: "lobby" });
      if (e.session.phones.enabled) return "phones on by default";
      if (projection.toPublicState(e.session, script).phoneJoin !== null) return "join code while off";
      e.setPhonesEnabled(true);
      const on = projection.toPublicState(e.session, script).phoneJoin;
      if (on?.code !== e.session.phones.joinCode || !/^[A-Z2-9]{4}$/.test(on.code)) return `on: ${JSON.stringify(on)}`;
      e.session.phones.claimsOpen = false;
      return projection.toPublicState(e.session, script).phoneJoin === null ? null : "join code with claims closed";
    },
  },
  {
    name: "Private changes reach the Storyteller and the listed phones only, without bumping seq",
    run: () => {
      const e = canaryGame();
      const got: { seq: number; ids: string[] }[] = [];
      e.privateBroadcast = (st, ids) => got.push({ seq: st.seq, ids });
      e.emit();
      const publics = e.rec.publics.length;
      const seq = e.currentSeq;
      e.mutatePrivate((s) => {
        phones.privateFor(s, "p1").revealedAt = 1;
      }, ["p1"]);
      if (e.rec.publics.length !== publics) return "public broadcast on a private change";
      if (e.currentSeq !== seq) return "seq bumped";
      if (got.length !== 1 || got[0]!.seq !== seq || got[0]!.ids.join() !== "p1") return JSON.stringify(got);
      return null;
    },
  },
  {
    name: "Claims keep only the token hash; approve replaces the seat's phone unless kept as a second device",
    run: () => {
      const e = canaryGame();
      const s = e.session;
      const a = phones.createClaim(s, "p1", "iPhone Safari");
      const b = phones.createClaim(s, "p1", "Android Chrome");
      if (!a.ok || !b.ok) return "claim refused";
      const json = JSON.stringify(s);
      if (json.includes(a.token) || json.includes(b.token)) return "raw token stored in the session";
      if (phones.findClaimByToken(s, phones.hashToken(a.token))?.id !== a.claim.id) return "hash lookup failed";
      phones.approveClaim(s, a.claim.id);
      const r = phones.approveClaim(s, b.claim.id);
      if (r.removed.map((c) => c.id).join() !== a.claim.id) return `approve b removed ${JSON.stringify(r.removed)}`;
      const c = phones.createClaim(s, "p1", "Tablet");
      if (!c.ok) return "third claim refused";
      phones.approveClaim(s, c.claim.id, true);
      const active = s.phones.claims.filter((x) => x.playerId === "p1" && x.status === "active").length;
      if (active !== 2) return `second device: ${active} active`;
      const moved = phones.reassignClaim(s, c.claim.id, "p2");
      if (!moved.ok || s.phones.claims.find((x) => x.id === c.claim.id)?.playerId !== "p2") return "reassign failed";
      if (phones.createClaim(s, "nobody", "x").ok) return "claimed a missing seat";
      for (let i = 0; i < 3; i++) phones.createClaim(s, "p5", "spam");
      return phones.createClaim(s, "p5", "spam").ok ? "more than 3 pending claims for one seat" : null;
    },
  },
  {
    name: "Device labels come from the user agent, short and without the raw string",
    run: () => {
      const iphone =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
      const pixel =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
      const a = phones.deviceLabel(iphone);
      const b = phones.deviceLabel(pixel);
      return a === "iPhone Safari" && b === "Android Chrome" ? null : `${a} / ${b}`;
    },
  },
  {
    name: "Undo keeps phone data (claims, what phones were shown) and the game id",
    run: () => {
      const e = canaryGame();
      const before = structuredClone(e.session);
      const claim = phones.createClaim(e.session, "p1", "iPhone Safari");
      phones.privateFor(e.session, "p2").revealedCharacterId = "monk";
      e.session.dayNumber = 5;
      const restored = undo.restoredSession(before, e.session);
      if (restored.dayNumber !== before.dayNumber) return "game state not restored";
      if (!claim.ok || !restored.phones.claims.some((c) => c.id === claim.claim.id)) return "claim rolled back";
      if (restored.phones.private.p2?.revealedCharacterId !== "monk") return "reveal rolled back";
      return restored.gameId === e.session.gameId ? null : "gameId changed";
    },
  },
  {
    name: "New game: same table keeps names and re-binds phones by seat; otherwise claims clear",
    run: () => {
      const e = canaryGame();
      const id0 = e.session.gameId;
      const a = phones.createClaim(e.session, "p3", "A", { active: true });
      const b = phones.createClaim(e.session, "p6", "B");
      if (!a.ok || !b.ok) return "claims refused";
      phones.privateFor(e.session, "p3").messages.push({ id: "m", from: "player", kind: "question", text: "hi", at: 1 });
      e.resetGame({ sameTable: true });
      const s = e.session;
      if (s.gameId === id0) return "same gameId after reset";
      if (!s.phones.enabled) return "phones setting lost";
      if (s.players.map((p) => p.name).join() !== NAMES.join()) return `names ${s.players.map((p) => p.name)}`;
      if (s.players.some((p) => p.characterId)) return "characters kept";
      const ca = s.phones.claims.find((c) => c.tokenHash === a.claim.tokenHash);
      const cb = s.phones.claims.find((c) => c.tokenHash === b.claim.tokenHash);
      if (ca?.playerId !== s.players[2]!.id || ca.status !== "active") return `A: ${JSON.stringify(ca)}`;
      if (cb?.playerId !== s.players[5]!.id || cb.status !== "pending") return `B: ${JSON.stringify(cb)}`;
      if (Object.keys(s.phones.private).length) return "private data kept into the new game";
      e.resetGame();
      if (e.session.phones.claims.length) return "claims kept without same table";
      return e.session.players[0]!.name === "Player 1" ? null : "names kept without same table";
    },
  },
  {
    name: "Distribute: refused while off, with a bad bag in the lobby, or a Drunk with no Townsfolk",
    run: () => {
      const e = setup(["washerwoman", "empath", "chef", "drunk", "saint", "baron", "imp"], { phase: "lobby" });
      const warn = () => projection.setupWarning(e.session, script);
      if (phones.distributeCharacters(e.session, script, warn()).ok) return "distributed while phones are off";
      e.session.phones.enabled = true;
      const noThinks = phones.distributeCharacters(e.session, script, warn());
      if (noThinks.ok || !/Drunk/.test(noThinks.message)) return `drunk: ${JSON.stringify(noThinks)}`;
      player(e, "p4").thinksCharacterId = "fortuneteller";
      player(e, "p3").characterId = "imp";
      const badBag = phones.distributeCharacters(e.session, script, warn());
      if (badBag.ok || !/bag/.test(badBag.message)) return `bag: ${JSON.stringify(badBag)}`;
      player(e, "p3").characterId = "chef";
      const ok = phones.distributeCharacters(e.session, script, warn());
      if (!ok.ok || ok.playerIds.length !== 7) return `ok: ${JSON.stringify(ok)}`;
      const drunk = playerState(e, "p4")!.me;
      if (drunk.character?.id !== "fortuneteller" || drunk.alignment !== "good") return `drunk card ${JSON.stringify(drunk)}`;
      const imp = playerState(e, "p7")!.me;
      return imp.character?.id === "imp" && imp.alignment === "evil" ? null : `imp card ${JSON.stringify(imp)}`;
    },
  },
  {
    name: "Grimoire edits after Distribute don't reach the phone until Re-send",
    run: () => {
      const e = canaryGame();
      e.updatePlayer("p1", { characterId: "investigator" });
      if (playerState(e, "p1")!.me.character?.id !== "washerwoman") return "setup edit leaked live";
      const r = phones.resendCharacter(e.session, script, "p1");
      if (!r.ok) return JSON.stringify(r);
      return playerState(e, "p1")!.me.character?.id === "investigator" ? null : "re-send did not update";
    },
  },
  {
    name: "Star-pass: the new Imp's phone changes only at their 'You are the Imp' wake",
    run: () => {
      const e = canaryGame();
      e.session.phase = "day";
      e.session.dayNumber = 1;
      e.startNight();
      for (let i = 0; i < 40 && e.session.night!.steps[e.session.night!.stepIndex]?.id !== "char-imp"; i++) e.nightNext();
      const r = e.otherDeath("p7", "Demon", { starPassTo: "p6" });
      if (!r.ok || player(e, "p6").characterId !== "imp") return `star-pass failed ${JSON.stringify(r)}`;
      if (playerState(e, "p6")!.me.character?.id !== "poisoner") return "star-pass reached the phone before the wake";
      e.markNightStepDone();
      const step = e.session.night!.steps[e.session.night!.stepIndex];
      if (step?.id !== "new-demon-p6") return `next step ${step?.id}`;
      e.markNightStepDone();
      const me = playerState(e, "p6")!.me;
      if (me.character?.id !== "imp" || me.alignment !== "evil") return `after wake: ${JSON.stringify(me.character)}`;
      return leaksForAll(e);
    },
  },
  {
    name: "A Traveller's phone shows their character and their secret alignment, to them only",
    run: () => {
      const e = canaryGame();
      e.addTraveller("Tess", "thief", { alignment: "evil" });
      const t = e.session.players.find((p) => p.isTraveller)!;
      if (!phones.resendCharacter(e.session, script, t.id).ok) return "re-send refused";
      const me = playerState(e, t.id)!.me;
      if (me.character?.id !== "thief" || me.alignment !== "evil") return JSON.stringify(me);
      const other = JSON.stringify(playerState(e, "p1"));
      return other.includes('"evil"') ? "another phone saw the Traveller's alignment" : null;
    },
  },
  {
    name: "Messages: limits, never at night, word requests, reply marks read; only that phone and the Storyteller see them",
    run: () => {
      const e = canaryGame();
      e.session.phase = "day";
      e.session.dayNumber = 1;
      const s = e.session;
      const q = phones.addPlayerMessage(s, "p1", "question", "  CANARY-MSG   does the Monk stop the Slayer? ");
      if (!q.ok || q.message.text !== "CANARY-MSG does the Monk stop the Slayer?") return `question ${JSON.stringify(q)}`;
      if (phones.privateFor(s, "p1").unreadByStoryteller !== 1) return "unread not counted";
      const empty = phones.addPlayerMessage(s, "p1", "question", "   ");
      const long = phones.addPlayerMessage(s, "p1", "question", "x".repeat(phones.MESSAGE_MAX_CHARS + 1));
      if (empty.ok || long.ok) return "empty or over-long question accepted";
      const word = phones.addPlayerMessage(s, "p1", "word", "");
      if (!word.ok || word.message.text !== phones.WORD_TEXT || word.message.kind !== "word") return `word ${JSON.stringify(word)}`;
      s.phase = "night";
      if (phones.addPlayerMessage(s, "p1", "question", "at night?").ok) return "sent at night";
      s.phase = "day";
      if (playerState(e, "p1")!.me.messages.length !== 2) return "own messages missing";
      for (const id of ["p2", "p7"]) if (JSON.stringify(playerState(e, id)).includes("CANARY-MSG")) return `${id} saw p1's message`;
      if (JSON.stringify(projection.toPublicState(s, script, { seq: 1 })).includes("CANARY-MSG")) return "public state has a message";
      if (!phones.toPhonePanel(s, { connected: {}, spectators: 0 }).private.p1?.messages.some((m) => m.text.includes("CANARY-MSG"))) {
        return "Storyteller panel lacks the message";
      }
      if (phones.addStorytellerReply(s, "p1", "  ").ok) return "empty reply accepted";
      if (!phones.addStorytellerReply(s, "p1", "Yes, it does.").ok) return "reply refused";
      if (phones.privateFor(s, "p1").unreadByStoryteller !== 0) return "reply did not mark read";
      const mine = playerState(e, "p1")!.me.messages;
      if (mine.at(-1)?.from !== "storyteller" || mine.at(-1)?.text !== "Yes, it does.") return "reply not on the phone";
      for (let i = 0; i < 210; i++) phones.addPlayerMessage(s, "p2", "question", `q${i}`);
      if (phones.privateFor(s, "p2").messages.length !== 200) return `kept ${phones.privateFor(s, "p2").messages.length}`;
      s.phones.enabled = false;
      return phones.addPlayerMessage(s, "p1", "question", "off?").ok ? "sent while phones are off" : null;
    },
  },
  {
    name: "Config default applies only to a session without a phones setting",
    run: () => {
      const path = process.env.BOTC_SESSION_PATH!;
      if (existsSync(path)) unlinkSync(path);
      if (!persistence.loadSession(true).phones.enabled) return "new session ignored the default";
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      raw.phones.enabled = false;
      writeFileSync(path, JSON.stringify(raw));
      if (persistence.loadSession(true).phones.enabled) return "saved 'off' overridden by the default";
      delete raw.phones;
      writeFileSync(path, JSON.stringify(raw));
      const old = persistence.loadSession(false);
      if (old.phones.enabled || !old.gameId) return "older session not normalised";
      return null;
    },
  },
];

runCases(cases);

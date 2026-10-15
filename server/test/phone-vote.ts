/**
 * Phone voting, engine level: phone hands only count once the clock hand locks them, hand-counted
 * seats stay the Storyteller's, overrides stand, the vote rules apply, and switching off keeps hands.
 * Run: cd server && npx tsx test/phone-vote.ts
 */
import { player, projection, runCases, script, setup, notices, type Case, type Engine } from "./_harness.js";

const phones = await import("../src/phones.js");
const undo = await import("../src/undo.js");

const ROLES = ["washerwoman", "empath", "fortuneteller", "butler", "monk", "poisoner", "imp"];
const NAMES = ["Ada", "Bo", "Cy", "Di", "Ed", "Flo", "Gus"];

/** Dusk, nominations open, phones on; seats 1, 3 and 5 have a connected phone. */
function game(opts: { phones?: boolean; voting?: "phones" | "manual"; connected?: string[] } = {}): Engine {
  const e = setup(ROLES, {
    phase: "dusk",
    mutate: (s) => {
      s.nominationsOpen = true;
      s.players.forEach((p, i) => (p.name = NAMES[i]!));
      s.phones.enabled = opts.phones ?? true;
      s.phones.voting = opts.voting ?? "phones";
    },
  });
  const ids = e.session.players.map((p) => p.id);
  const connected = opts.connected ?? [ids[0]!, ids[2]!, ids[4]!];
  e.phoneVoters = () => connected;
  return e;
}

const id = (e: Engine, i: number) => e.session.players[i]!.id;
/** Ada (seat 1) nominates Bo (seat 2): the hand goes Cy, Di, Ed, Flo, Gus, Ada, then Bo. */
function openVote(e: Engine) {
  const r = e.startNomination(id(e, 0), id(e, 1));
  if (!r.ok) throw new Error(`nomination refused: ${r.message}`);
  e.startVote(30);
}
const votes = (e: Engine) => [...(e.session.nomination?.votesFor ?? [])].sort().join(",");
const ids = (e: Engine, ...idx: number[]) => idx.map((i) => id(e, i)).sort().join(",");
function tickAll(e: Engine) {
  for (let i = 0; i < 10; i++) e.sweepTick();
}

const cases: Case[] = [
  {
    name: "Phones off (the default) or phone voting off: the vote is counted by hand as before",
    run: () => {
      for (const e of [game({ phones: false }), game({ voting: "manual" })]) {
        openVote(e);
        if (e.session.nomination?.phoneVote) return "phone vote opened";
        const r = e.setPhoneHand(id(e, 2), true);
        if (r.ok) return "a phone hand was accepted";
        if (projection.toPublicState(e.session, script).nomination?.phoneVote !== null) return "public phoneVote not null";
        if (e.sweepStart().ok) return "count started without phones";
        e.toggleVote(id(e, 2));
        if (votes(e) !== ids(e, 2)) return "Storyteller tap did not count";
      }
      const none = game({ connected: [] });
      openVote(none);
      if (none.session.nomination?.phoneVote) return "phone vote with no phone connected";
      return null;
    },
  },
  {
    name: "Mixed table: phone hands count only when the clock hand locks them; hand-counted seats are the Storyteller's",
    run: () => {
      const e = game();
      openVote(e);
      const pv = e.session.nomination?.phoneVote;
      if (!pv) return "no phone vote";
      if (pv.phoneSeats.slice().sort().join(",") !== ids(e, 0, 2, 4)) return `phone seats ${pv.phoneSeats}`;
      for (const i of [2, 4]) if (!e.setPhoneHand(id(e, i), true).ok) return `hand ${i} refused`;
      if (e.setPhoneHand(id(e, 3), true).ok) return "a seat without a phone raised a phone hand";
      if (votes(e) !== "") return `hands counted before the count: ${votes(e)}`;
      const pub = projection.toPublicState(e.session, script).nomination!;
      if (pub.phoneVote?.handsUp.length !== 2) return "public handsUp missing";
      e.toggleVote(id(e, 3)); // Di, counted by hand
      if (!e.sweepStart().ok) return "count refused";
      const order = e.session.nomination!.phoneVote!.sweep!.order;
      if (order.join(",") !== [2, 3, 4, 5, 6, 0, 1].map((i) => id(e, i)).join(",")) return `order ${order}`;
      e.sweepTick();
      if (votes(e) !== ids(e, 2, 3)) return `after Cy: ${votes(e)}`;
      const lower = e.setPhoneHand(id(e, 2), false);
      if (lower.ok || !/locked/i.test(lower.error)) return "a locked hand was lowered";
      tickAll(e);
      if (votes(e) !== ids(e, 2, 3, 4)) return `final ${votes(e)}`;
      const sw = e.session.nomination!.phoneVote!.sweep!;
      if (sw.index !== 7 || sw.nextAt !== null) return `sweep not finished: ${sw.index}`;
      e.resolveVote();
      const vr = e.session.publicLog.filter((l) => l.type === "vote_result").at(-1) as { voterIds?: string[] } | undefined;
      if ((vr?.voterIds ?? []).slice().sort().join(",") !== ids(e, 2, 3, 4)) return `voterIds ${vr?.voterIds}`;
      if (e.session.nomination) return "nomination still open";
      return null;
    },
  },
  {
    name: "Pause stops the hand; Back unlocks the last seat and its phone can change its hand",
    run: () => {
      const e = game();
      openVote(e);
      e.setPhoneHand(id(e, 2), true);
      e.sweepStart();
      e.sweepTick();
      if (votes(e) !== ids(e, 2)) return "Cy not counted";
      e.sweepBack();
      const sw = e.session.nomination!.phoneVote!.sweep!;
      if (sw.index !== 0 || !sw.paused) return `back: index ${sw.index} paused ${sw.paused}`;
      if (votes(e) !== "") return "Cy still counted after Back";
      e.sweepTick();
      if (sw.index !== 0) return "the hand moved while paused";
      if (!e.setPhoneHand(id(e, 2), false).ok) return "Cy could not lower after Back";
      e.sweepStart();
      if (sw.paused || sw.nextAt === null) return "resume did not run";
      e.sweepTick();
      if (votes(e) !== "") return "Cy counted after lowering";
      e.sweepPause();
      if (!sw.paused) return "pause";
      tickAll(e);
      if (sw.index !== 1) return "ticks while paused moved the hand";
      return null;
    },
  },
  {
    name: "A Storyteller tap on a phone seat stands: the lock and the phone can't change it (only they see it)",
    run: () => {
      const e = game();
      openVote(e);
      e.setPhoneHand(id(e, 4), true); // Ed's phone says up
      e.toggleVote(id(e, 4)); // Storyteller counts Ed …
      e.toggleVote(id(e, 4)); // … then takes it back: Ed's real hand was down
      const r = e.setPhoneHand(id(e, 4), true);
      if (r.ok || !/Storyteller/.test(r.error)) return "phone changed an overridden seat";
      e.sweepStart();
      tickAll(e);
      if (votes(e).includes(id(e, 4))) return "lock counted Ed's phone hand over the Storyteller";
      const st = projection.toStorytellerState(e.session, script);
      if (!st.phoneVoteOverridden.includes(id(e, 4))) return "Storyteller state misses the override";
      const pub = JSON.stringify(projection.toPublicState(e.session, script));
      if (pub.includes("overridden")) return "override list leaked to the public state";
      e.resolveVote();
      return null;
    },
  },
  {
    name: "Vote rules on phones: spent ghost vote and a Beggar without a token can't raise; a ghost vote is spent at resolve; the Butler is never blocked",
    run: () => {
      const e = game({ connected: undefined });
      const ada = player(e, id(e, 0));
      const cy = player(e, id(e, 2));
      const ed = player(e, id(e, 4));
      ada.alive = false;
      ada.usedGhostVote = true;
      cy.alive = false;
      ed.characterId = "beggar";
      ed.isTraveller = true;
      ed.voteTokens = 0;
      e.phoneVoters = () => [id(e, 0), id(e, 2), id(e, 4), id(e, 3)];
      const r = e.startNomination(id(e, 5), id(e, 1));
      if (!r.ok) return `nomination: ${r.message}`;
      e.startVote(30);
      const spent = e.setPhoneHand(ada.id, true);
      if (spent.ok || !/ghost vote is spent/.test(spent.error)) return "spent ghost vote raised";
      const beggar = e.setPhoneHand(ed.id, true);
      if (beggar.ok || !/vote token/.test(beggar.error)) return "Beggar without a token raised";
      const me = phones.toPlayerState(e.session, script, cy.id, projection.toPublicState(e.session, script))!.me.vote;
      if (!me?.byPhone || !me.canRaise || !/ghost vote/.test(me.note ?? "")) return `Cy's vote card ${JSON.stringify(me)}`;
      if (!e.setPhoneHand(cy.id, true).ok) return "ghost vote refused";
      if (!e.setPhoneHand(id(e, 3), true).ok) return "Butler refused (Master not voting)";
      e.sweepStart();
      tickAll(e);
      if (votes(e) !== ids(e, 2, 3)) return `counted ${votes(e)}`;
      e.resolveVote();
      if (!cy.usedGhostVote) return "ghost vote not spent at resolve";
      if (!/Butler/.test(notices(e))) return "no private Butler warning";
      return null;
    },
  },
  {
    name: "Phones off, or phones off for voting, mid-count: the count stops and counted hands stay",
    run: () => {
      for (const off of ["phones", "voting"] as const) {
        const e = game();
        openVote(e);
        for (const i of [2, 4]) e.setPhoneHand(id(e, i), true);
        e.sweepStart();
        e.sweepTick(); // Cy locked (up)
        if (off === "phones") e.setPhonesEnabled(false);
        else e.setPhoneVoting("manual");
        if (e.session.nomination?.phoneVote) return `${off}: phone vote still running`;
        if (votes(e) !== ids(e, 2)) return `${off}: counted hands changed: ${votes(e)}`;
        tickAll(e);
        if (votes(e) !== ids(e, 2)) return `${off}: the hand kept moving`;
        if (!/count stopped/.test(notices(e))) return `${off}: no notice`;
        if (e.setPhoneHand(id(e, 4), true).ok) return `${off}: phone hand accepted after off`;
        e.toggleVote(id(e, 4));
        if (votes(e) !== ids(e, 2, 4)) return `${off}: manual count after off`;
        e.resolveVote();
      }
      return null;
    },
  },
  {
    name: "Phone sees its own seat: locked / by-hand flags; hand-counted seats are told to raise a real hand",
    run: () => {
      const e = game();
      openVote(e);
      const view = (i: number) =>
        phones.toPlayerState(e.session, script, id(e, i), projection.toPublicState(e.session, script))!.me.vote!;
      if (view(3).byPhone) return "Di is not a phone seat";
      e.setPhoneHand(id(e, 2), true);
      if (!view(2).handUp || view(2).locked || view(2).counted) return `before lock ${JSON.stringify(view(2))}`;
      e.sweepStart();
      e.sweepTick();
      if (!view(2).locked || !view(2).counted) return `after lock ${JSON.stringify(view(2))}`;
      if (view(4).locked) return "Ed locked too early";
      const json = JSON.stringify(view(4));
      if (/overridden|phoneSeats/.test(json)) return "me.vote carries table-wide lists";
      e.cancelNomination();
      if (phones.toPlayerState(e.session, script, id(e, 2), projection.toPublicState(e.session, script))!.me.vote !== null) {
        return "vote card after cancel";
      }
      return null;
    },
  },
  {
    name: "Undo and a server restart pause a running count; the next vote starts fresh",
    run: () => {
      const e = game();
      openVote(e);
      const before = structuredClone(e.session);
      e.setPhoneHand(id(e, 2), true);
      e.sweepStart();
      before.nomination!.phoneVote = structuredClone(e.session.nomination!.phoneVote!);
      const cancelled = e.undoTo(undo.restoredSession(before, e.session));
      if (!cancelled.some((c) => /vote count/.test(c))) return `undo did not report the count: ${cancelled}`;
      if (!e.session.nomination?.phoneVote?.sweep?.paused) return "count still running after undo";
      e.sweepStart();
      const saved = structuredClone(e.session);
      const reborn = setup(ROLES, { mutate: (s) => Object.assign(s, saved) });
      if (!reborn.session.nomination?.phoneVote?.sweep?.paused) return "count still running after restart";
      e.resolveVote();
      const r = e.startNomination(id(e, 2), id(e, 3));
      if (!r.ok) return `second nomination: ${r.message}`;
      e.startVote(30);
      const pv = e.session.nomination?.phoneVote;
      if (!pv || pv.sweep || pv.handsUp.length || pv.overridden.length) return `second vote not fresh ${JSON.stringify(pv)}`;
      return null;
    },
  },
  {
    name: "Sweep speed is clamped and applies to a running count",
    run: () => {
      const e = game();
      openVote(e);
      e.sweepStart();
      e.setSweepSpeed(99_999);
      if (e.session.phones.sweepMsPerSeat !== 5000 || e.session.nomination!.phoneVote!.sweep!.msPerSeat !== 5000) return "max clamp";
      e.setSweepSpeed(10);
      if (e.session.phones.sweepMsPerSeat !== 500) return "min clamp";
      e.resolveVote();
      return null;
    },
  },
];

runCases(cases);

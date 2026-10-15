/**
 * Undo: the stack (merging, limit), restoring exact state over several steps, keeping the sound mix
 * and connection flags, not replaying an expired timer, and cancelling scheduled automatic steps.
 * Run: cd server && npx tsx test/undo.ts
 */
import { pid, player, runCases, setup, type Case, type Engine, type Session } from "./_harness.js";

const undo = await import("../src/undo.js");

/** Run an action the way the server does: snapshot first, push only if the game state changed. */
function act(e: Engine, stack: InstanceType<typeof undo.UndoStack>, action: string, fn: () => unknown, data?: unknown) {
  const before = structuredClone(e.session) as Session;
  const cmp = undo.comparable(before);
  fn();
  if (undo.comparable(e.session) !== cmp) {
    stack.push({
      action,
      label: undo.undoLabel(action, data as Record<string, unknown> | undefined),
      at: Date.now(),
      phase: before.phase,
      day: before.dayNumber,
      before,
      mergeKey: undo.mergeKeyFor(action, data),
    });
  }
}

function back(e: Engine, stack: InstanceType<typeof undo.UndoStack>): string[] {
  const entry = stack.pop();
  if (!entry) throw new Error("nothing to undo");
  return e.undoTo(undo.restoredSession(entry.before, e.session));
}

const cases: Case[] = [
  {
    name: "Undo restores the exact state, one step at a time (nomination, vote, execution)",
    run: () => {
      const e = setup(["chef", "imp", "empath", "poisoner", "monk", "soldier", "mayor"], { phase: "day", day: 2 });
      const stack = new undo.UndoStack();
      const states = [undo.comparable(e.session)];
      act(e, stack, "game:goDusk", () => e.goDusk());
      states.push(undo.comparable(e.session));
      act(e, stack, "game:openNominations", () => e.openNominations());
      states.push(undo.comparable(e.session));
      act(e, stack, "game:startNomination", () => e.startNomination(pid(e, "chef"), pid(e, "monk")));
      states.push(undo.comparable(e.session));
      for (const v of ["chef", "imp", "empath", "poisoner"]) {
        act(e, stack, "game:toggleVote", () => e.toggleVote(pid(e, v)), { playerId: pid(e, v) });
        states.push(undo.comparable(e.session));
      }
      act(e, stack, "game:resolveVote", () => e.resolveVote());
      states.push(undo.comparable(e.session));
      if (stack.size !== states.length - 1) return `stack ${stack.size}, steps ${states.length - 1}`;
      for (let i = states.length - 2; i >= 0; i--) {
        back(e, stack);
        if (undo.comparable(e.session) !== states[i]) return `step ${i} not restored exactly`;
      }
      if (e.session.phase !== "day" || e.session.nominationsToday.length) return "not back at the start of the day";
      return null;
    },
  },
  {
    name: "Undo keeps the sound mix and connection flags, and doesn't bring back an expired timer",
    run: () => {
      const e = setup(["chef", "imp", "empath", "poisoner", "monk"], { phase: "day", day: 1 });
      const stack = new undo.UndoStack();
      e.session.timer = { endsAt: Date.now() - 1000, label: "Discussion" };
      act(e, stack, "game:goDusk", () => e.goDusk());
      e.setAmbiance({ masterVolume: 0.13 });
      e.setConnected("tv", true);
      back(e, stack);
      if (e.session.phase !== "day") return `phase ${e.session.phase}`;
      if (e.session.ambiance.masterVolume !== 0.13) return `ambiance rolled back to ${e.session.ambiance.masterVolume}`;
      if (!e.session.tvConnected) return "tvConnected rolled back";
      if (e.session.timer) return "an expired timer came back (it would replay the timer-end sound)";
      const sounds = e.rec.publics.at(-1)!;
      if (sounds.soundCue !== null || sounds.hueScene !== null) return `undo replayed ${sounds.soundCue}/${sounds.hueScene}`;
      return null;
    },
  },
  {
    name: "Undo cancels scheduled automatic steps and says which",
    run: () => {
      const e = setup(["chef", "imp", "empath", "poisoner", "monk"], { phase: "night", day: 1 });
      const stack = new undo.UndoStack();
      act(e, stack, "game:goDawn", () => e.goDawn());
      act(e, stack, "game:announceDawnThenDay", () => e.announceDawnThenDay());
      const cancelled = back(e, stack);
      if (!cancelled.some((c) => c.includes("dawn to day"))) return `cancelled: ${JSON.stringify(cancelled)}`;
      if (e.session.phase !== "dawn" || e.session.dawnDeathsAnnounced) return `state ${e.session.phase}/${e.session.dawnDeathsAnnounced}`;
      return null;
    },
  },
  {
    name: "Typing bursts merge into one step; the stack keeps the newest 30",
    run: () => {
      const e = setup(["chef", "imp", "empath", "poisoner", "monk"], { phase: "lobby", day: 0 });
      const stack = new undo.UndoStack();
      const id = pid(e, "chef");
      const original = player(e, id).name;
      for (const name of ["A", "Ad", "Ada"]) {
        act(e, stack, "game:updatePlayer", () => e.updatePlayer(id, { name }), { playerId: id, patch: { name } });
      }
      if (stack.size !== 1) return `typing made ${stack.size} steps`;
      back(e, stack);
      if (player(e, id).name !== original) return `name ${player(e, id).name}`;
      for (let i = 0; i < 40; i++) {
        act(e, stack, "game:updatePlayer", () => e.updatePlayer(id, { alive: i % 2 === 0 }), { playerId: id, patch: { alive: i % 2 === 0 } });
      }
      if (stack.size !== 30) return `stack size ${stack.size}`;
      return null;
    },
  },
  {
    name: "Sound, ambiance, notices and reset are never undo steps",
    run: () => {
      for (const a of ["game:playSound", "game:setAmbiance", "game:scene", "game:reset", "game:refresh", "game:dismissStNotice", "game:timerEnded"]) {
        if (!undo.NOT_UNDOABLE.has(a)) return `${a} is undoable`;
      }
      const label = undo.undoLabel("game:startNomination", { nominatorId: "Ada (seat 1)", nomineeId: "Bram (seat 2)", override: true });
      if (label !== "Start nomination: Ada (seat 1), Bram (seat 2), override=true") return label;
      return null;
    },
  },
];

runCases(cases);

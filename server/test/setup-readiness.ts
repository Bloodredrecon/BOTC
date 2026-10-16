/**
 * Lobby readiness gate: checklist items, Start first night blocked without override.
 * Run: cd server && npx tsx test/setup-readiness.ts
 */
import { distributeCharacters } from "../src/phones.js";
import { setupWarning } from "../src/projection.js";
import { computeSetupReadiness } from "../src/setup-readiness.js";
import { runCases, script, setup, type Case } from "./_harness.js";

/** Official 8 without Baron: T5 / O1 / M1 / D1 */
function legal8() {
  return [
    "washerwoman",
    "librarian",
    "investigator",
    "chef",
    "empath",
    "butler",
    "poisoner",
    "imp",
  ];
}

/** 8 with Fortune Teller + Drunk (Drunk is the outsider). */
function legal8WithFtDrunk() {
  return [
    "washerwoman",
    "librarian",
    "investigator",
    "chef",
    "fortuneteller",
    "drunk",
    "poisoner",
    "imp",
  ];
}

const cases: Case[] = [
  {
    name: "Lobby with default names / no TV fails readiness",
    run: () => {
      const e = setup(legal8(), { phase: "lobby", day: 0 });
      e.session.tvConnected = false;
      e.session.tvSoundReady = false;
      e.session.players.forEach((p, i) => {
        p.name = `Player ${i + 1}`;
      });
      const r = computeSetupReadiness(e.session, script);
      if (!r.applicable) return "expected applicable in lobby";
      if (r.ready) return "should not be ready";
      const ids = r.items.filter((i) => i.hard && !i.ok).map((i) => i.id);
      for (const need of ["tv", "tvSound", "names"]) {
        if (!ids.includes(need)) return `missing fail ${need}: ${ids.join(",")}`;
      }
      return null;
    },
  },
  {
    name: "startFirstNight refuses without override when not ready",
    run: () => {
      const e = setup(legal8(), { phase: "lobby", day: 0 });
      const res = e.startFirstNight();
      if (res.ok) return "should have refused";
      if (e.session.phase !== "lobby") return `phase became ${e.session.phase}`;
      if (!res.message?.includes("Not ready")) return `bad message: ${res.message}`;
      return null;
    },
  },
  {
    name: "startFirstNight override bypasses the gate",
    run: () => {
      const e = setup(legal8(), { phase: "lobby", day: 0 });
      const res = e.startFirstNight({ override: true });
      if (!res.ok) return res.message ?? "override failed";
      if (e.session.phase !== "firstNight") return `phase ${e.session.phase}`;
      return null;
    },
  },
  {
    name: "Full checklist passes and startFirstNight succeeds",
    run: () => {
      const e = setup(legal8WithFtDrunk(), {
        phase: "lobby",
        day: 0,
        mutate: (s) => {
          s.tvConnected = true;
          s.tvSoundReady = true;
          s.players.forEach((p, i) => {
            p.name = ["Ada", "Bo", "Cy", "Di", "Ed", "Fay", "Gus", "Hal"][i]!;
          });
          const drunk = s.players.find((p) => p.characterId === "drunk")!;
          drunk.thinksCharacterId = "monk";
          drunk.reminders = ["Is the Drunk"];
          const herring = s.players.find((p) => p.characterId === "washerwoman")!;
          herring.reminders = ["Red herring"];
          const imp = s.players.find((p) => p.characterId === "imp")!;
          imp.bluffs = ["slayer", "soldier", "mayor"];
          s.phones.enabled = false;
        },
      });
      const warn = setupWarning(e.session, script);
      if (warn) return `bag warn: ${warn}`;
      const r = computeSetupReadiness(e.session, script);
      if (!r.ready) {
        return `not ready: ${r.items.filter((i) => !i.ok).map((i) => `${i.id}:${i.label}`).join(" | ")}`;
      }
      const res = e.startFirstNight();
      if (!res.ok) return res.message ?? "start failed";
      if (e.session.phase !== "firstNight") return `phase ${e.session.phase}`;
      return null;
    },
  },
  {
    name: "Phones on without distribute blocks readiness",
    run: () => {
      const e = setup(legal8(), {
        phase: "lobby",
        day: 0,
        mutate: (s) => {
          s.tvConnected = true;
          s.tvSoundReady = true;
          s.players.forEach((p, i) => {
            p.name = ["Ada", "Bo", "Cy", "Di", "Ed", "Fay", "Gus", "Hal"][i]!;
          });
          const imp = s.players.find((p) => p.characterId === "imp")!;
          imp.bluffs = ["slayer", "soldier", "mayor"];
          s.phones.enabled = true;
        },
      });
      const r = computeSetupReadiness(e.session, script);
      const phones = r.items.find((i) => i.id === "phones");
      if (!phones || phones.ok) return "phones item should fail";
      if (r.ready) return "should not be ready with phones unsynced";
      return null;
    },
  },
  {
    name: "Phones on after distribute is ready",
    run: () => {
      const e = setup(legal8(), {
        phase: "lobby",
        day: 0,
        mutate: (s) => {
          s.tvConnected = true;
          s.tvSoundReady = true;
          s.players.forEach((p, i) => {
            p.name = ["Ada", "Bo", "Cy", "Di", "Ed", "Fay", "Gus", "Hal"][i]!;
          });
          const imp = s.players.find((p) => p.characterId === "imp")!;
          imp.bluffs = ["slayer", "soldier", "mayor"];
          s.phones.enabled = true;
        },
      });
      const out = distributeCharacters(e.session, script, setupWarning(e.session, script));
      if (!out.ok) return out.message;
      const r = computeSetupReadiness(e.session, script);
      if (!r.ready) {
        return `not ready: ${r.items.filter((i) => !i.ok).map((i) => i.id).join(",")}`;
      }
      return null;
    },
  },
  {
    name: "tvSoundReady is independent of tvConnected",
    run: () => {
      const e = setup(legal8(), { phase: "lobby", day: 0 });
      e.session.tvConnected = true;
      e.session.tvSoundReady = false;
      const r = computeSetupReadiness(e.session, script);
      const sound = r.items.find((i) => i.id === "tvSound");
      const tv = r.items.find((i) => i.id === "tv");
      if (!tv?.ok) return "tv should be ok";
      if (sound?.ok) return "sound should not be ok from connection alone";
      e.setTvSoundReady(true);
      if (!e.session.tvSoundReady) return "setTvSoundReady failed";
      e.setConnected("tv", false);
      if (e.session.tvSoundReady) return "disconnect should clear sound ready";
      return null;
    },
  },
  {
    name: "advancePhase from lobby respects the gate",
    run: () => {
      const e = setup(legal8(), { phase: "lobby", day: 0 });
      const res = e.advancePhase();
      if (!res || res.ok) return "advance should refuse";
      if (e.session.phase !== "lobby") return `phase ${e.session.phase}`;
      const ok = e.advancePhase({ override: true });
      if (ok && "ok" in ok && !ok.ok) return ok.message ?? "override advance failed";
      if (e.session.phase !== "firstNight") return `phase ${e.session.phase}`;
      return null;
    },
  },
];

runCases(cases);

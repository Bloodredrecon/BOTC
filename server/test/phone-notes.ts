/**
 * Player phone notes (web/src/pages/play/notes.ts): device-only, so the logic is tested here directly.
 * Public facts from the log, keeping facts after the log window moves on, export/import, storage.
 * Run: cd server && npx tsx test/phone-notes.ts
 */
import { runCases, type Case } from "./_harness.js";

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

const notes = await import("../../web/src/pages/play/notes.js");
type Log = Parameters<typeof notes.factsFromLog>[0]["publicLog"];

const players = ["Ada", "Bo", "Cy", "Di"].map((name, i) => ({
  id: `p${i + 1}`,
  seat: i + 1,
  name,
  alive: true,
  usedGhostVote: false,
  isTraveller: false,
  leftGame: false,
}));

const LOG: Log = [
  { type: "night_death", playerIds: ["p4"], dayNumber: 0, at: 100 },
  { type: "nominations_open", dayNumber: 1, at: 200 },
  { type: "nomination", nominatorId: "p1", nomineeId: "p2", at: 300 },
  { type: "vote_result", nomineeId: "p2", votesFor: 2, majority: 2, outcome: "majority", voterIds: ["p1", "p3"], at: 400 },
  { type: "execution", playerId: "p2", died: true, dayNumber: 1, at: 500 },
  { type: "other_death", playerId: "p3", dayNumber: 1, duringNight: true, at: 600 },
];

const factsFor = (facts: { playerId: string; text: string }[], id: string) => facts.filter((f) => f.playerId === id).map((f) => f.text);

const cases: Case[] = [
  {
    name: "Public facts: nominations, who voted, executions and deaths, with the day",
    run: () => {
      const facts = notes.factsFromLog({ publicLog: LOG, players, dayNumber: 1 });
      const want: Record<string, string[]> = {
        p1: ["D1: nominated Bo", "D1: voted for Bo"],
        p2: ["D1: nominated by Ada", "D1: 2 votes (on the block)", "D1: executed"],
        p3: ["D1: voted for Bo", "N2: died in the night"],
        p4: ["N1: died in the night"],
      };
      for (const [id, texts] of Object.entries(want)) {
        const got = factsFor(facts, id);
        if (JSON.stringify(got) !== JSON.stringify(texts)) return `${id}: ${JSON.stringify(got)}`;
      }
      return new Set(facts.map((f) => f.key)).size === facts.length ? null : "duplicate fact keys";
    },
  },
  {
    name: "Facts are kept after the public log window drops old events, and never doubled",
    run: () => {
      let doc = notes.loadNotes("g1", 1);
      doc = notes.mergeFacts(doc, notes.factsFromLog({ publicLog: LOG, players, dayNumber: 1 }));
      const n = doc.facts.length;
      const later = notes.factsFromLog({ publicLog: LOG.slice(3), players, dayNumber: 2 });
      doc = notes.mergeFacts(doc, later);
      if (doc.facts.length !== n) return `facts ${n} -> ${doc.facts.length}`;
      if (!factsFor(doc.facts, "p1").includes("D1: nominated Bo")) return "old fact lost";
      return notes.mergeFacts(doc, later) === doc ? null : "unchanged merge made a new doc";
    },
  },
  {
    name: "Notes are stored per game and seat; export/import round-trips and flags another game",
    run: () => {
      const doc = { ...notes.loadNotes("g1", 2), pad: "Bo is lying", seats: { p2: { claim: "chef", align: "evil" as const, text: "hmm" } } };
      notes.saveNotes(doc);
      if (notes.loadNotes("g1", 2).seats.p2?.claim !== "chef") return "not saved";
      if (notes.loadNotes("g1", 3).pad || notes.loadNotes("g2", 2).pad) return "leaked to another seat or game";
      const file = notes.exportNotes(notes.loadNotes("g1", 2));
      const same = notes.parseNotesFile(file, "g1", 2);
      if (!same?.sameGame || same.doc.pad !== "Bo is lying" || same.doc.seats.p2?.align !== "evil") return `same ${JSON.stringify(same)}`;
      const other = notes.parseNotesFile(file, "g9", 5);
      if (!other || other.sameGame || other.doc.gameId !== "g9" || other.doc.seat !== 5) return `other ${JSON.stringify(other)}`;
      if (notes.parseNotesFile("{\"pad\":\"x\"}", "g1", 2) || notes.parseNotesFile("not json", "g1", 2)) return "accepted a foreign file";
      const bad = notes.parseNotesFile(JSON.stringify({ kind: "botc-notes", seats: { p1: { align: "purple", claim: 5 } } }), "g1", 2);
      return bad?.doc.seats.p1?.align === "" && bad.doc.seats.p1.claim === "" ? null : `bad file not cleaned ${JSON.stringify(bad)}`;
    },
  },
];

runCases(cases);

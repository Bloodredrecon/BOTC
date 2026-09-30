/**
 * Travellers: exile, no nominations, ghost votes, alignment, seats, Beggar tokens, Thief/Bureaucrat.
 * Run: cd server && npx tsx test/travellers.ts
 */
import { night, notices, pid, player, projection, publicState, rules, runCases, script, setup, type Case } from "./_harness.js";

const ROLES = ["chef", "empath", "imp", "monk", "poisoner", "washerwoman", "saint"];

function withTraveller(characterId = "gunslinger", opts: Parameters<ReturnType<typeof setup>["addTraveller"]>[2] = {}) {
  const e = setup(ROLES);
  e.addTraveller("Tara", characterId, opts);
  const t = e.session.players.find((p) => p.name === "Tara")!;
  return { e, t };
}

const cases: Case[] = [
  {
    name: "Item 14: exile — any player (dead too) calls & supports; half of all players rounded up; Traveller dies",
    run: () => {
      const { e, t } = withTraveller();
      player(e, pid(e, "saint")).alive = false;
      // 8 players in the game → threshold 4
      const r = e.callExile(t.id, pid(e, "saint"));
      if (!r.ok) return `call refused ${r.message}`;
      const pub = publicState(e).exile;
      if (!pub || pub.threshold !== 4) return `threshold ${pub?.threshold}`;
      for (const role of ["saint", "chef", "empath"]) e.toggleExileSupport(pid(e, role));
      const fail = e.resolveExile();
      if (fail.exiled || !t.alive) return "exiled with 3/4";
      if (e.callExile(t.id, null).ok) return "same Traveller called twice in one day";
      e.session.dayNumber += 1;
      if (!e.callExile(t.id, null).ok) return "next-day call refused";
      for (const role of ["saint", "chef", "empath", "monk"]) e.toggleExileSupport(pid(e, role));
      const ok = e.resolveExile();
      const tt = player(e, t.id);
      if (!ok.exiled || tt.alive || tt.leftGame) return `exiled=${ok.exiled} alive=${tt.alive} left=${tt.leftGame}`;
      if (e.session.executionOccurredToday || e.session.executedTodayId) return "exile counted as an execution";
      if (player(e, pid(e, "saint")).usedGhostVote) return "exile support spent a ghost vote";
      if (!publicState(e).players.some((p) => p.id === t.id)) return "exiled Traveller left the TV";
      const log = e.session.publicLog.filter((x) => x.type === "exile");
      if (log.length !== 2) return `log ${log.length}`;
      return null;
    },
  },
  {
    name: "Item 14: several exiles in one day; residents cannot be exiled",
    run: () => {
      const { e, t } = withTraveller();
      e.addTraveller("Uma", "beggar");
      const u = e.session.players.find((p) => p.name === "Uma")!;
      e.callExile(t.id, null);
      e.resolveExile("exile");
      e.callExile(u.id, null);
      e.resolveExile("exile");
      if (player(e, t.id).alive || player(e, u.id).alive) return "second exile blocked";
      if (e.callExile(pid(e, "chef"), null).ok) return "resident exiled";
      return null;
    },
  },
  {
    name: "Exile call limits: once per Traveller per day (a cancelled call doesn't count); a dead Traveller is refused",
    run: () => {
      const { e, t } = withTraveller();
      e.callExile(t.id, null);
      e.cancelExile();
      if (!e.callExile(t.id, null).ok) return "cancelled call counted";
      e.resolveExile("spare");
      const again = e.callExile(t.id, null);
      if (again.ok || !/once per day/.test(again.message ?? "")) return `second call ${JSON.stringify(again)}`;
      e.addTraveller("Uma", "beggar");
      const u = e.session.players.find((p) => p.name === "Uma")!;
      if (!e.callExile(u.id, null).ok) return "other Traveller blocked";
      e.cancelExile();
      player(e, u.id).alive = false;
      const dead = e.callExile(u.id, null);
      if (dead.ok || e.session.exile) return "dead Traveller exile opened";
      if (!/group decision to kill a Traveller/.test(dead.message ?? "")) return `reason ${dead.message}`;
      if (e.session.publicLog.filter((x) => x.type === "exile").length !== 1) return "log changed by refused calls";
      return null;
    },
  },
  {
    name: "Item 15: Travellers cannot be nominated, even with the override",
    run: () => {
      const { e, t } = withTraveller();
      e.goDusk();
      e.openNominations();
      const r = e.startNomination(pid(e, "chef"), t.id, { override: true });
      if (r.ok || !/Traveller — use exile/.test(r.message ?? "")) return `got ${JSON.stringify(r)}`;
      const rulesOut = projection.toStorytellerState(e.session, script).nominationRules.nominee[t.id];
      if (rulesOut !== "Traveller — use exile") return `picker reason ${rulesOut}`;
      const asNominator = e.startNomination(t.id, pid(e, "chef"));
      if (!asNominator.ok) return "Traveller could not nominate";
      return null;
    },
  },
  {
    name: "Item 16: dead Travellers have a ghost vote (spent on resolve)",
    run: () => {
      const { e, t } = withTraveller();
      e.callExile(t.id, null);
      e.resolveExile("exile");
      if (!projection.canPlayerVote(player(e, t.id))) return "cannot vote";
      e.goDusk();
      e.openNominations();
      e.startNomination(pid(e, "chef"), pid(e, "empath"));
      e.toggleVote(t.id);
      if (!e.session.nomination!.votesFor.includes(t.id)) return "hand not raised";
      e.resolveVote();
      if (!player(e, t.id).usedGhostVote) return "ghost vote not spent";
      return null;
    },
  },
  {
    name: "Item 17: Traveller alignment drives evil checks and the reveal",
    run: () => {
      const { e, t } = withTraveller("thief", { alignment: "evil" });
      if (!rules.isEvil(script, player(e, t.id))) return "not evil";
      e.updatePlayer(t.id, { alignment: "good" });
      if (rules.isEvil(script, player(e, t.id))) return "alignment change ignored";
      e.updatePlayer(t.id, { alignment: "evil" });
      e.endGame("good");
      const r = projection.toPublicState(e.session, script).reveal!.find((p) => p.id === t.id)!;
      if (r.alignment !== "evil") return `reveal ${r.alignment}`;
      return null;
    },
  },
  {
    name: "Item 18: add a Traveller at a chosen seat; move seats; Empath neighbours follow",
    run: () => {
      const e = setup(["empath", "chef", "imp", "monk", "poisoner"], { phase: "lobby", day: 0 });
      e.addTraveller("Tara", "thief", { seat: 2 });
      const t = e.session.players.find((p) => p.name === "Tara")!;
      if (t.seat !== 2 || player(e, pid(e, "chef")).seat !== 3) return "seat insert wrong";
      // Empath (1) neighbours: poisoner (6) & Tara (2) — Tara is good → 1 (poisoner)
      let emp = night.buildNightSteps(e.session, script, true).find((s) => s.id === "char-empath")!;
      if (emp.show.suggestedNumber !== 1) return `empath ${emp.show.suggestedNumber}`;
      e.moveSeat(pid(e, "imp"), 2);
      if (player(e, pid(e, "imp")).seat !== 2) return "moveSeat failed";
      emp = night.buildNightSteps(e.session, script, true).find((s) => s.id === "char-empath")!;
      if (emp.show.suggestedNumber !== 2) return `after move ${emp.show.suggestedNumber}`;
      const seats = e.session.players.map((p) => p.seat);
      if (seats.some((s, i) => s !== i + 1)) return `seats ${seats}`;
      return null;
    },
  },
  {
    name: "Item 19: Beggar needs a vote token from a dead player (Storyteller learns alignment); spent per vote",
    run: () => {
      const { e } = withTraveller("beggar");
      const beggar = e.session.players.find((p) => p.name === "Tara")!.id;
      e.goDusk();
      e.openNominations();
      e.startNomination(pid(e, "chef"), pid(e, "empath"));
      e.toggleVote(beggar);
      if (e.session.nomination!.votesFor.includes(beggar)) return "voted without a token";
      const donor = pid(e, "poisoner");
      if (e.giveVoteToken(beggar, donor).ok) return "living donor allowed";
      player(e, donor).alive = false;
      const g = e.giveVoteToken(beggar, donor);
      if (!g.ok || !/evil/.test(notices(e))) return `give failed ${JSON.stringify(g)}`;
      if (!player(e, donor).usedGhostVote) return "donor token not spent";
      e.toggleVote(beggar);
      if (!e.session.nomination!.votesFor.includes(beggar)) return "voted with token refused";
      e.resolveVote();
      if (player(e, beggar).voteTokens !== 0) return "token not spent";
      return null;
    },
  },
  {
    name: "Item 19: Thief token counts −1 only while the Thief lives; official ability text",
    run: () => {
      const { e, t } = withTraveller("thief");
      if (!/not yourself/.test(script.travellers.find((x) => x.id === "thief")!.ability)) return "old Thief text";
      player(e, pid(e, "chef")).reminders = ["Negative vote"];
      if (rules.voteWeight(e.session, player(e, pid(e, "chef"))) !== -1) return "not negative";
      e.callExile(t.id, null);
      e.resolveExile("exile");
      if (rules.voteWeight(e.session, player(e, pid(e, "chef"))) !== 1) return "token outlived the Thief";
      return null;
    },
  },
  {
    name: "Item 24: TV shows Traveller characters and the character sheet, never resident roles",
    run: () => {
      const e = setup(["baron", "imp", "saint", "recluse", "chef", "empath", "monk"], { phase: "lobby", day: 0 });
      e.addTraveller("Tara", "thief");
      e.setTvSheet(true);
      const pub = publicState(e);
      const t = pub.players.find((p) => p.name === "Tara")!;
      if (t.travellerCharacterName !== "Thief") return "Traveller character missing";
      if (pub.players.some((p) => !p.isTraveller && p.travellerCharacterName)) return "resident role leaked";
      if (pub.players.some((p) => "characterId" in p || "reminders" in p || "alignment" in p)) return "grimoire fields leaked";
      const base = script.setupByPlayerCount["7"]!;
      if (!pub.sheet || pub.sheet.counts?.outsider !== base.outsider) return "sheet missing or Baron-adjusted";
      if (!pub.sheet.travellers.some((x) => x.id === "thief")) return "sheet lacks Traveller";
      const join = e.session.publicLog.find((x) => x.type === "traveller_join");
      if (!join || join.type !== "traveller_join" || join.characterName !== "Thief") return "join line lacks character";
      e.startFirstNight();
      if (publicState(e).sheet) return "sheet shown at night";
      return null;
    },
  },
];

runCases(cases);

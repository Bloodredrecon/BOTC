/**
 * What the TV's dramatic moments and end-of-game reveal are allowed to see.
 * Run: cd server && npx tsx test/tv-moments.ts
 */
import { pid, player, publicState, runCases, setup, type Engine, type Session } from "./_harness.js";

const { describeEvent } = await import("../src/action-log.js");

const NAMES = ["Ada", "Bram", "Cora", "Dov", "Esme", "Finn", "Gil"];

/** Harness names include the role ("imp#3"); give plain names so a leak check means something. */
function plainNames(e: Engine) {
  e.session.players.forEach((p, i) => (p.name = NAMES[i] ?? `P${i + 1}`));
}

function nominate(e: Engine, nominatorId: string, nomineeId: string) {
  e.goDusk();
  e.openNominations();
  return e.startNomination(nominatorId, nomineeId);
}

const PUBLIC_PLAYER_KEYS = new Set([
  "id",
  "seat",
  "name",
  "alive",
  "usedGhostVote",
  "isTraveller",
  "leftGame",
  "travellerCharacterName",
]);

const PHASES: Session["phase"][] = ["lobby", "firstNight", "night", "dawn", "day", "dusk", "nomination", "vote", "execution"];

runCases([
  {
    name: "No reveal or character data on the TV before the game ends",
    run: () => {
      for (const phase of PHASES) {
        const e = setup(["slayer", "scarletwoman", "imp", "chef", "drunk"], { phase });
        const pub = publicState(e);
        if (pub.reveal !== null) return `${phase}: reveal is set`;
        if (pub.winner !== null) return `${phase}: winner is set`;
        for (const p of pub.players) {
          const extra = Object.keys(p).filter((k) => !PUBLIC_PLAYER_KEYS.has(k));
          if (extra.length) return `${phase}: player has private keys ${extra.join(", ")}`;
        }
      }
      return null;
    },
  },
  {
    name: "Reveal is populated once the game has ended",
    run: () => {
      const e = setup(["slayer", "librarian", "imp", "chef", "empath"]);
      e.slayerShot(pid(e, "slayer"), pid(e, "imp"));
      e.flushPendingWin();
      const pub = publicState(e);
      if (pub.phase !== "ended") return `phase ${pub.phase}`;
      const imp = pub.reveal?.find((r) => r.id === pid(e, "imp"));
      return imp?.characterId === "imp" && imp.team === "demon" ? null : `reveal ${JSON.stringify(imp)}`;
    },
  },
  {
    name: "Slayer hit on the Imp with a Scarlet Woman alive: TV sees a hit and a death, nothing more",
    run: () => {
      const e = setup(["slayer", "scarletwoman", "imp", "chef", "empath"]);
      plainNames(e);
      const sw = pid(e, "scarletwoman");
      const r = e.slayerShot(pid(e, "slayer"), pid(e, "imp"));
      if (!r.hit) return "shot did not hit";
      if (player(e, sw).characterId !== "imp") return "SW not promoted";
      e.flushPendingWin();
      const pub = publicState(e);
      if (pub.phase === "ended") return "game ended";
      if (pub.reveal !== null) return "reveal is set";
      const shot = pub.publicLog.find((x) => x.type === "slayer_shot");
      if (!shot || shot.type !== "slayer_shot" || !shot.hit) return `shot event ${JSON.stringify(shot)}`;
      const visible = JSON.stringify({ log: pub.publicLog, players: pub.players, win: pub.winReason }).replace(
        /"type":"slayer_shot"/g,
        "",
      );
      const leak = /imp|demon|scarlet|slayer|minion/i.exec(visible);
      return leak ? `public text leaks "${leak[0]}": ${visible}` : null;
    },
  },
  {
    name: "Slayer miss is recorded as a public shot with no death",
    run: () => {
      const e = setup(["slayer", "librarian", "imp", "chef", "empath"]);
      e.slayerShot(pid(e, "slayer"), pid(e, "chef"));
      const shot = publicState(e).publicLog.find((x) => x.type === "slayer_shot");
      if (!shot || shot.type !== "slayer_shot" || shot.hit) return `shot event ${JSON.stringify(shot)}`;
      return player(e, pid(e, "chef")).alive ? null : "chef died";
    },
  },
  {
    name: "A bluffed Slayer shot still shows on the TV as a miss",
    run: () => {
      const e = setup(["chef", "librarian", "imp", "slayer", "empath"]);
      e.slayerShot(pid(e, "chef"), pid(e, "imp"));
      const shot = publicState(e).publicLog.find((x) => x.type === "slayer_shot");
      return shot && shot.type === "slayer_shot" && !shot.hit && shot.shooterId === pid(e, "chef")
        ? null
        : `shot event ${JSON.stringify(shot)}`;
    },
  },
  {
    name: "Virgin execution is flagged in the public log; a normal execution is not",
    run: () => {
      const e = setup(["virgin", "imp", "chef", "empath", "monk"]);
      nominate(e, pid(e, "chef"), pid(e, "virgin"));
      const ex = publicState(e).publicLog.filter((x) => x.type === "execution");
      if (ex.length !== 1 || ex[0]!.type !== "execution" || !ex[0]!.virgin || ex[0]!.playerId !== pid(e, "chef")) {
        return `virgin execution ${JSON.stringify(ex)}`;
      }
      const e2 = setup(["washerwoman", "librarian", "imp", "chef", "empath", "monk"]);
      nominate(e2, pid(e2, "washerwoman"), pid(e2, "chef"));
      e2.resolveVote("majority");
      e2.endDay();
      e2.confirmExecution(true);
      const ex2 = publicState(e2).publicLog.filter((x) => x.type === "execution");
      return ex2.length === 1 && ex2[0]!.type === "execution" && !ex2[0]!.virgin ? null : `normal ${JSON.stringify(ex2)}`;
    },
  },
  {
    name: "Demon slain by the Slayer ends with the public reason the TV keys its moment on",
    run: () => {
      const e = setup(["slayer", "librarian", "imp", "chef", "empath"]);
      e.slayerShot(pid(e, "slayer"), pid(e, "imp"));
      e.flushPendingWin();
      const pub = publicState(e);
      return pub.winner === "good" && /demon is dead/i.test(pub.winReason ?? "") ? null : `${pub.winner} / ${pub.winReason}`;
    },
  },
  {
    name: "Action log describes the shot and the Virgin execution",
    run: () => {
      const e = setup(["slayer", "librarian", "imp", "chef", "empath"]);
      plainNames(e);
      e.slayerShot(pid(e, "slayer"), pid(e, "chef"));
      const shot = e.session.publicLog.find((x) => x.type === "slayer_shot")!;
      const line = describeEvent(e.session, shot);
      if (!/^Slayer shot: Ada .*shoots Dov .*nothing happens$/.test(line)) return `shot line "${line}"`;
      const v = setup(["virgin", "imp", "chef", "empath", "monk"]);
      plainNames(v);
      nominate(v, pid(v, "chef"), pid(v, "virgin"));
      const ex = v.session.publicLog.find((x) => x.type === "execution")!;
      const vline = describeEvent(v.session, ex);
      return /^Execution: Cora .*died \(Virgin\)$/.test(vline) ? null : `virgin line "${vline}"`;
    },
  },
]);

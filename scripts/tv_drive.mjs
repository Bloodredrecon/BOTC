// Storyteller driver for TV verification: node scripts/tv_drive.mjs <step> [args]
// e.g. setup 8 short | night1 | dawn 4 | day 300 | role 5 slayer | shoot 5 3 | dusk | openNominations | nominate 2 6
// Env: TV_DRIVE_URL (default http://127.0.0.1:3900), BOTC_PIN (default 4321)
import { io } from "socket.io-client";

const URL = process.env.TV_DRIVE_URL ?? "http://127.0.0.1:3900";
const PIN = process.env.BOTC_PIN ?? "4321";

const SHORT_NAMES = [
  "Ada", "Bram", "Cora", "Dmitri", "Elspeth", "Fenwick", "Gwen", "Hollis", "Ines", "Jasper",
  "Kit", "Lorcan", "Mabel", "Nico", "Odette", "Percival", "Quinn", "Rosalind", "Silas", "Tamsin",
];
const LONG_NAMES = [
  "Bartholomew Winterbourne", "Genevieve Ashcombe-Hart", "Maximilian", "Evangeline Blackwood",
  "Thaddeus Pennyworth", "Octavia Ravenscroft", "Sebastian", "Wilhelmina Thornfield",
  "Cornelius Fairweather", "Anastasia Holloway", "Leopold", "Persephone Grimsby",
  "Archibald Montgomery", "Clementine Dusk", "Ignatius Blythe", "Marguerite", "Fitzgerald Crane",
  "Rosamund Lockwood", "Ebenezer Quill", "Seraphina Vale",
];
const ROLES = [
  "washerwoman", "librarian", "imp", "chef", "empath", "poisoner", "fortuneteller", "undertaker",
  "monk", "ravenkeeper", "slayer", "spy", "investigator", "drunk", "recluse", "baron",
  "scarletwoman", "washerwoman", "librarian", "chef",
];

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ["websocket"] });
    const timer = setTimeout(() => reject(new Error("connect timeout")), 5000);
    socket.on("connect", () => {
      socket.emit("join", { role: "storyteller", pin: PIN });
      socket.once("state:storyteller", (st) => {
        clearTimeout(timer);
        resolve({ socket, st });
      });
      setTimeout(() => socket.emit("game:refresh", {}), 200);
    });
    socket.on("auth:error", (e) => reject(new Error(e.message)));
  });
}

function act(socket, event, data = {}) {
  return new Promise((resolve) => socket.emit(event, data, (r) => resolve(r)));
}

async function latest(socket) {
  return new Promise((resolve) => {
    socket.once("state:storyteller", resolve);
    socket.emit("game:refresh", {});
  });
}

const seated = (st) =>
  st.players.filter((p) => !p.leftGame).sort((a, b) => a.seat - b.seat);

const steps = {
  async setup(socket, st, [count = "8", style = "short"]) {
    await act(socket, "game:reset");
    await act(socket, "game:setPlayerCount", { count: Number(count) });
    st = await latest(socket);
    const names = style === "long" ? LONG_NAMES : SHORT_NAMES;
    for (const [i, p] of seated(st).entries()) {
      await act(socket, "game:updatePlayer", {
        playerId: p.id,
        patch: { name: names[i % names.length], characterId: ROLES[i % ROLES.length] },
      });
    }
  },
  async night1(socket) {
    await act(socket, "game:startFirstNight");
  },
  async dawn(socket, st, [victimSeat = "4"]) {
    await act(socket, "game:nightSkipToDawn");
    st = await latest(socket);
    if (st.phase !== "dawn") await act(socket, "game:goDawn");
    st = await latest(socket);
    const seats = victimSeat.split(",").map(Number);
    const ids = seated(st).filter((p) => seats.includes(p.seat)).map((p) => p.id);
    await act(socket, "game:setDawnDeaths", { playerIds: ids });
    await act(socket, "game:announceDawnDeaths");
  },
  async dawnPending(socket, st, [victimSeat = "4"]) {
    await act(socket, "game:nightSkipToDawn");
    st = await latest(socket);
    if (st.phase !== "dawn") await act(socket, "game:goDawn");
    st = await latest(socket);
    const seats = victimSeat.split(",").map(Number);
    const ids = seated(st).filter((p) => seats.includes(p.seat)).map((p) => p.id);
    await act(socket, "game:setDawnDeaths", { playerIds: ids });
  },
  async day(socket, st, [seconds = "300"]) {
    await act(socket, "game:finishDawn");
    st = await latest(socket);
    if (st.phase !== "day") await act(socket, "game:goDay");
    await act(socket, "game:startTimer", { seconds: Number(seconds), label: "Discussion" });
  },
  async nominate(socket, st, [fromSeat = "2", toSeat = "6"]) {
    const ps = seated(st);
    const from = ps.find((p) => p.seat === Number(fromSeat));
    const to = ps.find((p) => p.seat === Number(toSeat));
    await act(socket, "game:startNomination", { nominatorId: from.id, nomineeId: to.id });
  },
  async vote(socket, st, [handsCount = "0"]) {
    await act(socket, "game:startVote", { seconds: 90 });
    st = await latest(socket);
    const nomineeId = st.nomination.nomineeId;
    const ps = seated(st);
    const start = ps.findIndex((p) => p.id === nomineeId);
    const order = [...ps.slice(start + 1), ...ps.slice(0, start + 1)];
    const eligible = order.filter((p) => p.alive || !p.usedGhostVote);
    for (const p of eligible.slice(0, Number(handsCount))) {
      await act(socket, "game:toggleVote", { playerId: p.id });
    }
  },
  async hands(socket, st, [handsCount = "1"]) {
    const nomineeId = st.nomination.nomineeId;
    const ps = seated(st);
    const start = ps.findIndex((p) => p.id === nomineeId);
    const order = [...ps.slice(start + 1), ...ps.slice(0, start + 1)];
    const up = new Set(st.nomination.votesFor);
    const next = order.filter((p) => !up.has(p.id) && (p.alive || !p.usedGhostVote));
    for (const p of next.slice(0, Number(handsCount))) {
      await act(socket, "game:toggleVote", { playerId: p.id });
    }
  },
  async role(socket, st, [seat = "1", characterId = "slayer"]) {
    const p = seated(st).find((x) => x.seat === Number(seat));
    await act(socket, "game:updatePlayer", { playerId: p.id, patch: { characterId } });
  },
  async shoot(socket, st, [fromSeat = "1", toSeat = "3"]) {
    const ps = seated(st);
    const from = ps.find((p) => p.seat === Number(fromSeat));
    const to = ps.find((p) => p.seat === Number(toSeat));
    const r = await act(socket, "game:slayerShot", { shooterId: from.id, targetId: to.id });
    console.log(JSON.stringify({ shot: r }));
  },
  async resolve(socket) {
    await act(socket, "game:resolveVote");
  },
  async execute(socket) {
    await act(socket, "game:confirmExecution", { died: true });
  },
  async dusk(socket) {
    await act(socket, "game:goDusk");
  },
  async openNominations(socket) {
    await act(socket, "game:openNominations");
  },
  async endDay(socket) {
    await act(socket, "game:endDay");
  },
  async cancel(socket) {
    await act(socket, "game:cancelNomination");
  },
  async night(socket) {
    await act(socket, "game:startNight");
  },
  async end(socket, st, [winner = "good"]) {
    await act(socket, "game:endGame", { winner });
  },
  async phase(socket, st, [phase]) {
    await act(socket, "game:setPhase", { phase });
  },
  async show() {},
};

const [step, ...args] = process.argv.slice(2);
if (!steps[step]) {
  console.error(`unknown step ${step}; one of ${Object.keys(steps).join(", ")}`);
  process.exit(2);
}
const { socket, st } = await connect();
await steps[step](socket, st, args);
const after = await latest(socket);
const nom = after.nomination;
console.log(
  JSON.stringify(
    {
      phase: after.phase,
      day: after.dayNumber,
      alive: seated(after).filter((p) => p.alive).length,
      seats: seated(after).length,
      dawnDeathIds: after.dawnDeathIds,
      announced: after.dawnDeathsAnnounced,
      nomination: nom && { votes: nom.votesFor.length, nominee: nom.nomineeId },
      executionPendingId: after.executionPendingId,
      block: after.block,
      nominationsToday: after.nominationsToday?.map((n) => `${n.nominatorId}>${n.nomineeId}:${n.votes ?? "-"}:${n.outcome}`),
      notices: after.stNotices?.slice(-2).map((n) => n.message),
      timer: after.timer,
      winner: after.winner ?? after.reveal?.winner ?? null,
    },
    null,
    0,
  ),
);
socket.close();
process.exit(0);

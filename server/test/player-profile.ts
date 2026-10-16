/**
 * Player name + face photo: setName / setPhoto over sockets, size/type rejection,
 * phones-off refusal, persistence across reconnect.
 * Run: cd server && npx tsx test/player-profile.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PHOTO_BYTES, decodePhotoPayload, isJpeg } from "../src/player-photos.js";
import {
  ask,
  client,
  count,
  last,
  runAsyncCases,
  startServer,
  storyteller,
  until,
  type AsyncCase,
  type Rec,
} from "./_server.js";

const PIN = "73914826";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

/** Tiny JPEG (SOI + APP0 + EOI) — enough for our magic-byte check. */
function tinyJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00, 0xff, 0xd9,
  ]);
}

const unitCases: AsyncCase[] = [
  {
    name: "Photo payload: JPEG accepted; PNG / oversized / empty rejected",
    run: async () => {
      if (!isJpeg(tinyJpeg())) return "tiny jpeg not recognised";
      const ok = decodePhotoPayload(tinyJpeg().toString("base64"));
      if (!ok.ok) return `jpeg refused: ${ok.error}`;
      const dataUrl = decodePhotoPayload(`data:image/jpeg;base64,${tinyJpeg().toString("base64")}`);
      if (!dataUrl.ok) return `data URL refused: ${dataUrl.error}`;
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      const badPng = decodePhotoPayload(png.toString("base64"));
      if (badPng.ok || !/JPEG|PNG/i.test(badPng.error)) return `png: ${JSON.stringify(badPng)}`;
      const pngUrl = decodePhotoPayload(`data:image/png;base64,${png.toString("base64")}`);
      if (pngUrl.ok || !/JPEG/i.test(pngUrl.error)) return `png data URL: ${JSON.stringify(pngUrl)}`;
      const big = Buffer.alloc(MAX_PHOTO_BYTES + 10, 0);
      big[0] = 0xff;
      big[1] = 0xd8;
      big[2] = 0xff;
      const tooBig = decodePhotoPayload(big.toString("base64"));
      if (tooBig.ok || !/too large/i.test(tooBig.error)) return `size: ${JSON.stringify(tooBig)}`;
      const empty = decodePhotoPayload("");
      if (empty.ok) return "empty accepted";
      return null;
    },
  },
];

const srv = await startServer({ BOTC_PIN: PIN });
const all: Rec[] = [];
async function sock(label: string, ua?: string): Promise<Rec> {
  const r = await client(srv.port, label, { userAgent: ua });
  all.push(r);
  return r;
}

type Status = { status: string; reason?: string | null; playerId?: string; name?: string; photoRev?: number | null };
type StState = {
  seq: number;
  players: { id: string; name: string; photoRev: number | null }[];
  phones: { enabled: boolean; joinCode: string; claims: { id: string; playerId: string; status: string }[] };
};
type PlayerSt = {
  gameId: string;
  me: { playerId: string; name: string; photoRev: number | null };
  players: { id: string; name: string; photoRev: number | null }[];
};
type Pub = { players: { id: string; name: string; photoRev: number | null }[] };

const status = (r: Rec) => last<Status>(r, "player:status");
const stState = (st: Rec) => last<StState>(st, "state:storyteller")!;

async function phone(label: string, token?: string): Promise<Rec> {
  const r = await sock(label, IPHONE);
  r.socket.emit("join", { role: "player", ...(token ? { token } : {}) });
  await until(() => !!status(r), `${label} status`);
  return r;
}

const st = await storyteller(srv.port, PIN);
const act = (event: string, data: unknown = {}) => ask(st, event, data);
const tv = await sock("tv");
tv.socket.emit("join", { role: "tv" });
await until(() => count(tv, "state:public") > 0, "tv state");

await act("game:setPlayerCount", { count: 5 });
await act("game:setPhones", { on: true });
for (let i = 1; i <= 5; i++) {
  await act("game:updatePlayer", { playerId: `p${i}`, patch: { name: `Seat${i}` } });
}

const cases: AsyncCase[] = [
  ...unitCases,
  {
    name: "player:setName updates the seat for Storyteller and TV (pending and after approve)",
    run: async () => {
      const code = stState(st).phones.joinCode;
      const p = await phone("name-phone");
      const claim = await ask<{ ok: boolean; token?: string }>(p, "player:claim", { code, playerId: "p1", name: "Cora" });
      if (!claim.ok || !claim.token) return `claim: ${JSON.stringify(claim)}`;
      await until(() => status(p)?.status === "pending", "pending");
      await until(() => stState(st).players.find((x) => x.id === "p1")?.name === "Cora", "ST sees claim name");
      if (last<Pub>(tv, "state:public")?.players.find((x) => x.id === "p1")?.name !== "Cora") return "TV missed claim name";

      const renamed = await ask<{ ok: boolean; name?: string }>(p, "player:setName", { name: "  Cora Bluff  " });
      if (!renamed.ok || renamed.name !== "Cora Bluff") return `setName: ${JSON.stringify(renamed)}`;
      await until(() => status(p)?.name === "Cora Bluff", "pending status name");
      await until(() => stState(st).players.find((x) => x.id === "p1")?.name === "Cora Bluff", "ST rename");

      const claimRow = stState(st).phones.claims.find((c) => c.playerId === "p1" && c.status === "pending")!;
      await act("game:phoneApprove", { claimId: claimRow.id });
      await until(() => status(p)?.status === "active" && !!last(p, "state:player"), "active");
      const again = await ask<{ ok: boolean }>(p, "player:setName", { name: "Cora" });
      if (!again.ok) return `active setName: ${JSON.stringify(again)}`;
      await until(() => last<PlayerSt>(p, "state:player")?.me.name === "Cora", "phone me.name");
      if (stState(st).players.find((x) => x.id === "p1")?.name !== "Cora") return "ST missed active rename";
      return null;
    },
  },
  {
    name: "player:setPhoto accepts JPEG, rejects bad type/size; GET serves it; reconnect keeps it",
    run: async () => {
      const code = stState(st).phones.joinCode;
      const rec = await phone("photo-phone");
      const claim = await ask<{ ok: boolean; token?: string }>(rec, "player:claim", { code, playerId: "p2", name: "Bob" });
      if (!claim.ok || !claim.token) return `claim: ${JSON.stringify(claim)}`;
      await until(() => status(rec)?.status === "pending", "pending");

      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
      const badType = await ask<{ ok: boolean; error?: string }>(rec, "player:setPhoto", { image: png.toString("base64") });
      if (badType.ok || !/JPEG|PNG/i.test(String(badType.error))) return `type: ${JSON.stringify(badType)}`;

      const huge = Buffer.alloc(MAX_PHOTO_BYTES + 20, 1);
      huge[0] = 0xff;
      huge[1] = 0xd8;
      huge[2] = 0xff;
      const badSize = await ask<{ ok: boolean; error?: string }>(rec, "player:setPhoto", { image: huge.toString("base64") });
      if (badSize.ok || !/too large/i.test(String(badSize.error))) return `size: ${JSON.stringify(badSize)}`;

      const jpeg = tinyJpeg();
      const setPending = await ask<{ ok: boolean; photoRev?: number }>(rec, "player:setPhoto", { image: jpeg.toString("base64") });
      if (!setPending.ok || !setPending.photoRev) return `pending setPhoto: ${JSON.stringify(setPending)}`;
      await until(() => status(rec)?.photoRev === setPending.photoRev, "pending status photo");
      await until(() => stState(st).players.find((x) => x.id === "p2")?.photoRev === setPending.photoRev, "ST photo while pending");

      const row = stState(st).phones.claims.find((c) => c.playerId === "p2" && c.status === "pending")!;
      await act("game:phoneApprove", { claimId: row.id });
      await until(() => status(rec)?.status === "active" && !!last(rec, "state:player"), "active");

      const jpeg2 = tinyJpeg();
      jpeg2[jpeg2.length - 2] = 0xee; // still ends with EOI-ish; keep JPEG magic
      jpeg2[0] = 0xff;
      jpeg2[1] = 0xd8;
      jpeg2[2] = 0xff;
      const set = await ask<{ ok: boolean; photoRev?: number }>(rec, "player:setPhoto", { image: jpeg2.toString("base64") });
      if (!set.ok || !set.photoRev) return `active setPhoto: ${JSON.stringify(set)}`;
      await until(() => last<PlayerSt>(rec, "state:player")?.me.photoRev === set.photoRev, "phone me.photoRev");
      if (last<Pub>(tv, "state:public")?.players.find((x) => x.id === "p2")?.photoRev !== set.photoRev) return "TV missed photoRev";

      const get = await fetch(`${srv.base}/api/player-photos/p2?v=${set.photoRev}`);
      if (!get.ok) return `GET ${get.status}`;
      const body = Buffer.from(await get.arrayBuffer());
      if (!isJpeg(body) || body.length !== jpeg2.length) return `GET body len ${body.length}`;

      const gameId = last<PlayerSt>(rec, "state:player")!.gameId;
      const onDisk = join(srv.dir, "player-photos", gameId, "p2.jpg");
      if (!existsSync(onDisk)) return `missing file ${onDisk}`;
      if (!readFileSync(onDisk).equals(jpeg2)) return "disk bytes differ";

      rec.socket.disconnect();
      const again = await phone("photo-reconnect", claim.token);
      await until(() => status(again)?.status === "active" && !!last(again, "state:player"), "reconnected");
      const me = last<PlayerSt>(again, "state:player")!.me;
      if (me.photoRev !== set.photoRev) return `reconnect photoRev ${me.photoRev}`;
      if (me.name !== "Bob") return `reconnect name ${me.name}`;
      return null;
    },
  },
  {
    name: "Phones off: setName / setPhoto / claim refused",
    run: async () => {
      await act("game:setPhones", { on: false });
      const p = await phone("off-profile");
      await until(() => status(p)?.status === "off", "off status");
      const name = await ask<{ ok: boolean; error?: string }>(p, "player:setName", { name: "Nope" });
      if (name.ok || !/off/i.test(String(name.error))) return `setName: ${JSON.stringify(name)}`;
      const photo = await ask<{ ok: boolean; error?: string }>(p, "player:setPhoto", { image: tinyJpeg().toString("base64") });
      if (photo.ok || !/off/i.test(String(photo.error))) return `setPhoto: ${JSON.stringify(photo)}`;
      const claim = await ask<{ ok: boolean; error?: string }>(p, "player:claim", {
        code: "AAAA",
        playerId: "p1",
        name: "Hacker",
      });
      if (claim.ok || !/off/i.test(String(claim.error))) return `claim: ${JSON.stringify(claim)}`;
      return null;
    },
  },
];

await runAsyncCases(cases, () => {
  for (const r of all) r.socket.disconnect();
  st.socket.disconnect();
  srv.stop();
});

/**
 * WLED lighting driver: mocked HTTP only (never the real strip, never port 3847).
 * Run: cd server && npx tsx test/wled.ts
 */
import { persistence } from "./_harness.js";
import { sceneForSession } from "../src/lighting.js";
import {
  createWledDriver,
  DEFAULT_WLED,
  mergeWled,
  resolveWledLayout,
  wledBaseUrl,
  wledPayloadForScene,
  type WledHttp,
} from "../src/wled.js";

type Call = { url: string; method: string; body: unknown };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockHttp(opts: { fail?: boolean; segs?: { id: number; start: number; stop: number; len: number }[]; count?: number } = {}): {
  calls: Call[];
  http: WledHttp;
} {
  const calls: Call[] = [];
  const count = opts.count ?? 577;
  const segs = opts.segs ?? [{ id: 0, start: 0, stop: count, len: count }];
  const http: WledHttp = async (url, init) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === "string" && init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: Call = { url: String(url), method, body };
    calls.push(call);
    if (opts.fail) throw new Error("ECONNREFUSED mock strip down");
    if (String(url).includes("/json/si") || String(url).includes("/json/info") || String(url).includes("/json/state")) {
      return jsonResponse({
        info: { leds: { count }, name: "WLED" },
        state: { on: true, bri: 128, seg: segs },
        leds: { count },
        seg: segs,
      });
    }
    return jsonResponse({ success: true });
  };
  return { calls, http };
}

function lastState(calls: Call[]): Record<string, unknown> | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i]!;
    if (c.method === "POST" && c.url.endsWith("/json/state") && c.body && typeof c.body === "object") {
      return c.body as Record<string, unknown>;
    }
  }
  return null;
}

type Seg = { id?: number; start?: number; stop?: number; on?: boolean; fx?: number; col?: number[][]; sx?: number; ix?: number };

function segsOf(state: Record<string, unknown> | null): Seg[] {
  return Array.isArray(state?.seg) ? (state!.seg as Seg[]) : [];
}

type Case = { name: string; run: () => string | null | Promise<string | null> };

const cases: Case[] = [
  {
    name: "Off by default: host set but enabled false sends no HTTP",
    run: async () => {
      const { calls, http } = mockHttp();
      const d = createWledDriver(
        { enabled: false, host: "192.168.50.139", ledCount: 300 },
        { fetch: http },
      );
      if (d.isLive()) return "live while disabled";
      await d.applyScene("night");
      await d.applyScene("day");
      d.tickVoteClock?.();
      if (calls.length) return `sent ${calls.length} request(s) while off`;
      return null;
    },
  },
  {
    name: "Empty host never requests, even if enabled",
    run: async () => {
      const { calls, http } = mockHttp();
      const d = createWledDriver({ enabled: true, host: "", ledCount: 300 }, { fetch: http });
      await d.applyScene("execution");
      if (d.isLive()) return "live without host";
      if (calls.length) return `sent ${calls.length}`;
      return null;
    },
  },
  {
    name: "Refuses BOTC port 3847",
    run: async () => {
      const { calls, http } = mockHttp();
      if (wledBaseUrl("127.0.0.1:3847")) return "allowed 3847";
      const d = createWledDriver({ enabled: true, host: "127.0.0.1:3847", ledCount: 300 }, { fetch: http });
      await d.applyScene("night");
      if (calls.length) return `sent ${calls.length} to 3847`;
      return null;
    },
  },
  {
    name: "Unsplit 577: game uses 300 LEDs and turns the leftover 277 off",
    run: async () => {
      const { calls, http } = mockHttp({ count: 577, segs: [{ id: 0, start: 0, stop: 577, len: 577 }] });
      const d = createWledDriver({ enabled: true, host: "192.168.50.139", ledCount: 300 }, { fetch: http });
      await d.applyScene("night");
      const state = lastState(calls);
      if (!state) return `no state POST (calls=${calls.map((c) => c.method + " " + c.url).join(", ")})`;
      const segs = segsOf(state);
      const game = segs.find((s) => s.on !== false);
      const rest = segs.find((s) => s.on === false);
      if (!game) return `no game seg ${JSON.stringify(segs)}`;
      if (game.stop !== 300 || game.start !== 0) return `game range ${game.start}-${game.stop} (want 0-300)`;
      if ((game.stop ?? 0) - (game.start ?? 0) === 577) return "lit all 577";
      if (game.fx !== 2) return `fx ${game.fx} (want Breathe=2)`;
      const [r, g, b] = game.col?.[0] ?? [];
      if ((b ?? 0) <= (r ?? 0) || (b ?? 0) <= (g ?? 0)) return `not blue-black col=${JSON.stringify(game.col?.[0])}`;
      if ((game.sx ?? 255) > 80) return `speed ${game.sx} too fast`;
      if (!rest) return "did not turn leftover 277 off";
      if (rest.start !== 300 || rest.stop !== 577) return `rest ${rest.start}-${rest.stop}`;
      if (d.status().ledCount !== 300) return `status leds ${d.status().ledCount}`;
      if (calls.some((c) => c.url.includes(":3847"))) return "hit 3847";
      return null;
    },
  },
  {
    name: "If WLED already has a 300-LED segment, drive that and leave the 277 as-is",
    run: () => {
      const layout = resolveWledLayout(DEFAULT_WLED, {
        total: 577,
        segs: [
          { id: 0, start: 0, stop: 277, len: 277 },
          { id: 1, start: 277, stop: 577, len: 300 },
        ],
      });
      if (layout.game.start !== 277 || layout.game.stop !== 577 || layout.game.id !== 1) {
        return `picked ${JSON.stringify(layout.game)}`;
      }
      if (layout.rest) return `should not rewrite the 277, got rest ${JSON.stringify(layout.rest)}`;
      return null;
    },
  },
  {
    name: "Vote scene is a percent fill on the 300-LED segment",
    run: async () => {
      let now = 1_000;
      const { calls, http } = mockHttp();
      const d = createWledDriver(
        { enabled: true, host: "192.168.50.139", ledCount: 300 },
        { fetch: http, now: () => now },
      );
      await d.applyScene("vote", { durationMs: 10_000 });
      const first = lastState(calls);
      const game0 = segsOf(first).find((s) => s.on !== false);
      if ((game0?.ix ?? -1) > 20) return `start ix ${game0?.ix}`;
      if (game0?.stop !== 300) return `vote stop ${game0?.stop}`;
      now = 6_000;
      await d.tickVoteClock?.();
      const mid = lastState(calls);
      const game1 = segsOf(mid).find((s) => s.on !== false);
      const ix1 = game1?.ix ?? -1;
      if (ix1 < 100 || ix1 > 160) return `mid ix ${ix1} (want ~50%)`;
      if (game1?.fx !== 98) return `fx ${game1?.fx} (want Percent=98)`;
      return null;
    },
  },
  {
    name: "Strip down does not throw and gameplay payload is still built",
    run: async () => {
      const { http } = mockHttp({ fail: true });
      const d = createWledDriver({ enabled: true, host: "192.168.50.9", ledCount: 300 }, { fetch: http });
      try {
        await d.applyScene("execution");
        await d.applyScene("good_wins");
        await d.setFollow?.(false);
      } catch (err) {
        return `threw ${String(err)}`;
      }
      const night = wledPayloadForScene("execution", {
        brightness: 128,
        layout: resolveWledLayout(DEFAULT_WLED, { total: 577 }),
      });
      const game = segsOf(night).find((s) => s.on !== false);
      const col = game?.col?.[0] ?? [];
      if (col[0]! < 80 || col[1]! > 20 || col[2]! > 20) return `gallows not deep red ${JSON.stringify(col)}`;
      if (game?.stop !== 300) return `gallows stop ${game?.stop}`;
      return null;
    },
  },
  {
    name: "sceneForSession maps lobby / dusk / vote / wins",
    run: () => {
      const s = persistence.createEmptySession(8);
      if (sceneForSession(s) !== "lobby") return `lobby got ${sceneForSession(s)}`;
      s.phase = "dusk";
      if (sceneForSession(s) !== "dusk") return `dusk got ${sceneForSession(s)}`;
      s.nominationsOpen = true;
      if (sceneForSession(s) !== "nomination") return `open noms got ${sceneForSession(s)}`;
      s.phase = "vote";
      if (sceneForSession(s) !== "vote") return `vote got ${sceneForSession(s)}`;
      s.phase = "ended";
      s.winner = "good";
      if (sceneForSession(s) !== "good_wins") return `good got ${sceneForSession(s)}`;
      s.winner = "evil";
      if (sceneForSession(s) !== "evil_wins") return `evil got ${sceneForSession(s)}`;
      return null;
    },
  },
  {
    name: "mergeWled keeps enabled off and default game range 0-300",
    run: () => {
      const a = mergeWled(DEFAULT_WLED, { host: "192.168.50.139" });
      if (a.enabled) return "enabled flipped on by host-only patch";
      if (a.host !== "192.168.50.139") return a.host;
      if (a.ledCount !== 300 || a.start !== 0 || a.stop !== 300) return `range ${a.start}-${a.stop} count ${a.ledCount}`;
      const b = mergeWled(a, { enabled: true, start: 277 });
      if (!b.enabled) return "enabled not applied";
      if (b.start !== 277 || b.stop !== 577 || b.ledCount !== 300) return `second strip ${b.start}-${b.stop} n=${b.ledCount}`;
      const c = mergeWled(b, { ledCount: 99_999 });
      if (c.ledCount !== 300) return `uncapped leds ${c.ledCount}`;
      return null;
    },
  },
];

let passed = 0;
for (const c of cases) {
  let err: string | null;
  try {
    err = await Promise.resolve(c.run());
  } catch (ex) {
    err = `threw ${(ex as Error).stack ?? ex}`;
  }
  if (err) console.log(`FAIL  ${c.name}\n      ${err}`);
  else {
    passed++;
    console.log(`PASS  ${c.name}`);
  }
}
console.log(`\n${passed}/${cases.length} passed`);
process.exit(passed === cases.length ? 0 : 1);

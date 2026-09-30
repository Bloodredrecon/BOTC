/**
 * Shared setup for engine tests. Importing this points BOTC_SESSION_PATH at a temp file first,
 * so the live data/session.json is never touched.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sessionDir = mkdtempSync(join(tmpdir(), "botc-test-"));
process.env.BOTC_SESSION_PATH = join(sessionDir, "session.json");

export const { GameEngine } = await import("../src/game.js");
export const persistence = await import("../src/persistence.js");
export const rules = await import("../src/rules.js");
export const night = await import("../src/night.js");
export const projection = await import("../src/projection.js");
export const nominations = await import("../src/nominations.js");
export const reminders = await import("../src/reminders.js");

export type Session = import("../src/types.js").GameSession;
export type Engine = InstanceType<typeof GameEngine>;
export type PublicState = import("../src/types.js").PublicState;

export const script = persistence.loadScript();

export type Recorder = { hues: string[]; publics: PublicState[] };

export function setup(
  roles: string[],
  opts: { phase?: Session["phase"]; day?: number; mutate?: (s: Session) => void } = {},
): Engine & { rec: Recorder } {
  const s = persistence.createEmptySession(roles.length);
  roles.forEach((r, i) => {
    s.players[i]!.characterId = r;
    s.players[i]!.name = `${r}#${i + 1}`;
  });
  s.phase = opts.phase ?? "day";
  s.dayNumber = opts.day ?? 2;
  opts.mutate?.(s);
  const rec: Recorder = { hues: [], publics: [] };
  const hue = { applyScene: async (h: string) => void rec.hues.push(h), isLive: () => false } as never;
  const e = new GameEngine(s, script, hue, (payload) => rec.publics.push(payload.public)) as Engine & { rec: Recorder };
  e.rec = rec;
  return e;
}

export function pid(e: Engine, role: string, nth = 0): string {
  const p = e.session.players.filter((x) => x.characterId === role)[nth];
  if (!p) throw new Error(`no ${role}`);
  return p.id;
}

export function player(e: Engine, id: string) {
  const p = e.session.players.find((x) => x.id === id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

export function stepIds(e: Engine): string[] {
  return e.session.night?.steps.map((s) => s.id) ?? [];
}

export function currentStep(e: Engine) {
  return e.session.night?.steps[e.session.night.stepIndex];
}

/** Advance (nightNext) until the current step has this id. */
export function goToStep(e: Engine, id: string) {
  for (let i = 0; i < 60; i++) {
    if (currentStep(e)?.id === id) return;
    e.nightNext();
  }
  throw new Error(`step ${id} not reached (steps: ${stepIds(e).join(", ")})`);
}

export function notices(e: Engine): string {
  return (e.session.stNotices ?? []).map((n) => n.message).join(" | ");
}

export function publicState(e: Engine): PublicState {
  return projection.toPublicState(e.session, script);
}

export type Case = { name: string; run: () => string | null };

export function runCases(cases: Case[]) {
  let passed = 0;
  for (const c of cases) {
    let err: string | null;
    try {
      err = c.run();
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
}

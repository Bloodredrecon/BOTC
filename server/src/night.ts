import type { ScriptData } from "./persistence.js";
import type { GameSession, NightStep } from "./types.js";

export function buildNightSteps(
  session: GameSession,
  script: ScriptData,
  isFirstNight: boolean,
): NightStep[] {
  const steps: NightStep[] = [];
  const meta = isFirstNight ? script.firstNightMeta : script.otherNightMeta;
  for (const m of meta) {
    steps.push({
      id: m.id,
      characterId: null,
      name: m.name,
      wakeText: m.wakeText,
      playerIds: [],
    });
  }

  const chars = script.characters
    .filter((c) => {
      const order = isFirstNight ? c.firstNight : c.otherNight;
      return order > 0;
    })
    .filter((c) =>
      session.players.some((p) => {
        if (p.characterId !== c.id) return false;
        if (isFirstNight) return true;
        if (c.id === "ravenkeeper") return !p.alive;
        return p.alive;
      }),
    )
    .sort((a, b) => {
      const ao = isFirstNight ? a.firstNight : a.otherNight;
      const bo = isFirstNight ? b.firstNight : b.otherNight;
      return ao - bo;
    });

  for (const c of chars) {
    // Ravenkeeper only if they died tonight — storyteller still sees the step when in play; they skip if unused
    const playerIds = session.players
      .filter((p) => p.characterId === c.id)
      .map((p) => p.id);

    if (playerIds.length === 0) continue;

    const wake =
      c.id === "imp" && isFirstNight
        ? "Demon already received info. Skip Imp kill on first night."
        : `Wake the ${c.name}. ${c.ability} Put them to sleep when done.`;

    steps.push({
      id: `char-${c.id}`,
      characterId: c.id,
      name: c.name,
      wakeText: wake,
      playerIds,
    });
  }

  steps.push({
    id: "dawn",
    characterId: null,
    name: "Dawn",
    wakeText: "Night ends. Prepare to announce any deaths, then wake the town.",
    playerIds: [],
  });

  return steps;
}

import type { ScriptData } from "./persistence.js";
import { isPoisonedOrDrunk } from "./rules.js";
import type {
  CharacterDef,
  GameSession,
  NightShowSpec,
  NightStep,
  Player,
} from "./types.js";

const FALSE_INFO_ST_WARNING = "Poisoned/Drunk — give false information";

/** Townsfolk (and similar) info shows that get lie defaults when impaired. */
function isLieableInfoKind(kind: NightShowSpec["kind"]): boolean {
  return (
    kind === "number" ||
    kind === "yes-no" ||
    kind === "players-and-character" ||
    kind === "character" ||
    kind === "player-character"
  );
}

/** Prefer truth±1 within [min,max]; otherwise any other valid value. */
function lieNumber(truth: number, min: number, max: number): number {
  if (max < min) return truth;
  const plus = truth + 1;
  const minus = truth - 1;
  if (plus <= max) return plus;
  if (minus >= min) return minus;
  for (let n = min; n <= max; n++) {
    if (n !== truth) return n;
  }
  return truth;
}

function pickDifferentCharacterId(
  script: ScriptData,
  truthId: string | null | undefined,
  teams?: CharacterDef["team"][],
): string | null {
  const pool = [...script.characters, ...script.travellers].filter((c) => {
    if (truthId && c.id === truthId) return false;
    if (teams?.length && !teams.includes(c.team)) return false;
    return true;
  });
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!.id;
}

type InfoPairSuggestion = {
  /** Composer defaults (truth when healthy; lie when impaired). */
  playerIds: string[];
  characterId: string | null;
  /** True pair + token (empty / null when e.g. zero Outsiders). */
  truthPlayerIds: string[];
  truthCharacterId: string | null;
  /** Librarian: no Outsiders in play — show Zero Outsiders instead of a pair. */
  zeroOutsiders: boolean;
};

/**
 * Standard BOTC WW/Lib/Inv construction: one real team member in play + one other
 * living player, and the true character id for the hit. Empty when none of that team.
 */
function buildTrueInfoPair(
  session: GameSession,
  script: ScriptData,
  team: CharacterDef["team"],
): InfoPairSuggestion {
  const living = session.players
    .filter((p) => !p.leftGame && p.alive)
    .sort((a, b) => a.seat - b.seat);
  const trueHit = living.find((p) => findDef(script, p.characterId)?.team === team);

  if (trueHit?.characterId) {
    const other = living.find((p) => p.id !== trueHit.id) ?? trueHit;
    const truthPlayerIds = [trueHit.id, other.id];
    return {
      playerIds: truthPlayerIds,
      characterId: trueHit.characterId,
      truthPlayerIds,
      truthCharacterId: trueHit.characterId,
      zeroOutsiders: false,
    };
  }

  return {
    playerIds: [],
    characterId: null,
    truthPlayerIds: [],
    truthCharacterId: null,
    zeroOutsiders: team === "outsider",
  };
}

/**
 * Build a false WW/Lib/Inv pairing for ST defaults when impaired.
 * Prefer same two seats with a wrong character token; else invent a bluff pair.
 */
function buildFalseInfoPair(
  session: GameSession,
  script: ScriptData,
  team: CharacterDef["team"],
): InfoPairSuggestion {
  const living = session.players
    .filter((p) => !p.leftGame && p.alive)
    .sort((a, b) => a.seat - b.seat);
  const teamChars = script.characters.filter((c) => c.team === team);
  const truth = buildTrueInfoPair(session, script, team);

  if (truth.truthCharacterId && truth.truthPlayerIds.length >= 2) {
    const falseChar =
      teamChars.find((c) => c.id !== truth.truthCharacterId)?.id ??
      pickDifferentCharacterId(script, truth.truthCharacterId, [team]);
    return {
      playerIds: truth.truthPlayerIds,
      characterId: falseChar,
      truthPlayerIds: truth.truthPlayerIds,
      truthCharacterId: truth.truthCharacterId,
      zeroOutsiders: false,
    };
  }

  // No true hit (e.g. zero Outsiders): invent a bluff pair + token
  const pair = living.slice(0, 2);
  const characterId = teamChars[0]?.id ?? null;
  return {
    playerIds: pair.map((p) => p.id),
    characterId,
    truthPlayerIds: [],
    truthCharacterId: null,
    zeroOutsiders: false,
  };
}

/**
 * When impaired: keep playerPrompt neutral, put lie defaults in suggested*,
 * and expose truth* for the ST-only composer (never the player overlay).
 */
function applyImpairedInfoShow(
  spec: NightShowSpec,
  session: GameSession,
  script: ScriptData,
  characterId: string | null,
): NightShowSpec {
  const truthNumber = spec.suggestedNumber ?? null;
  const truthYesNo = spec.suggestedYesNo ?? null;
  const truthPlayerIds = [...(spec.suggestedPlayerIds ?? [])];
  const truthCharacterId = spec.suggestedCharacterId ?? null;

  let suggestedNumber = spec.suggestedNumber ?? null;
  let suggestedYesNo = spec.suggestedYesNo ?? null;
  let suggestedPlayerIds = [...(spec.suggestedPlayerIds ?? [])];
  let suggestedCharacterId = spec.suggestedCharacterId ?? null;

  if (spec.kind === "number" && truthNumber != null) {
    const max = characterId === "empath" ? 2 : 5;
    suggestedNumber = lieNumber(truthNumber, 0, max);
  }

  if (spec.kind === "yes-no" && truthYesNo) {
    suggestedYesNo = truthYesNo === "yes" ? "no" : "yes";
  }

  if (spec.kind === "character" && truthCharacterId) {
    suggestedCharacterId =
      pickDifferentCharacterId(script, truthCharacterId, spec.characterTeams) ??
      truthCharacterId;
    // Keep executed player seat; lie about the character token
    suggestedPlayerIds = truthPlayerIds;
  }

  if (spec.kind === "players-and-character") {
    const team =
      characterId === "washerwoman"
        ? ("townsfolk" as const)
        : characterId === "librarian"
          ? ("outsider" as const)
          : characterId === "investigator"
            ? ("minion" as const)
            : spec.characterTeams?.[0];
    if (team) {
      const falsePair = buildFalseInfoPair(session, script, team);
      suggestedPlayerIds = falsePair.playerIds;
      suggestedCharacterId = falsePair.characterId;
      return {
        ...spec,
        infoImpaired: true,
        stWarning: FALSE_INFO_ST_WARNING,
        truthNumber,
        truthYesNo,
        truthPlayerIds: falsePair.truthPlayerIds.length
          ? falsePair.truthPlayerIds
          : truthPlayerIds,
        truthCharacterId: falsePair.truthCharacterId ?? truthCharacterId,
        suggestedNumber,
        suggestedYesNo,
        suggestedPlayerIds,
        suggestedCharacterId,
        suggestedZeroOutsiders: false,
        hint: `${FALSE_INFO_ST_WARNING}. Lie default is pre-filled — adjust then Show. ${spec.hint}`,
      };
    }
  }

  return {
    ...spec,
    infoImpaired: true,
    stWarning: FALSE_INFO_ST_WARNING,
    truthNumber,
    truthYesNo,
    truthPlayerIds,
    truthCharacterId,
    suggestedNumber,
    suggestedYesNo,
    suggestedPlayerIds,
    suggestedCharacterId,
    hint: `${FALSE_INFO_ST_WARNING}. Lie default is pre-filled — adjust then Show. ${spec.hint}`,
  };
}

function charOrder(c: CharacterDef, isFirstNight: boolean): number {
  return (isFirstNight ? c.firstNight : c.otherNight) ?? 0;
}

function findDef(script: ScriptData, id: string | null): CharacterDef | undefined {
  if (!id) return undefined;
  return (
    script.characters.find((c) => c.id === id) ||
    script.travellers.find((c) => c.id === id)
  );
}

function registersAsEvil(p: Player, script: ScriptData): boolean {
  const c = findDef(script, p.characterId);
  if (!c) return false;
  if (c.id === "recluse") return true;
  return c.team === "minion" || c.team === "demon";
}

/** Living circle in seat order (for Empath / Chef). */
function livingCircle(session: GameSession): Player[] {
  return session.players
    .filter((p) => !p.leftGame && p.alive)
    .sort((a, b) => a.seat - b.seat);
}

function neighborsOf(session: GameSession, playerId: string): Player[] {
  const circle = livingCircle(session);
  if (circle.length < 2) return [];
  const idx = circle.findIndex((p) => p.id === playerId);
  if (idx < 0) return [];
  const left = circle[(idx - 1 + circle.length) % circle.length];
  const right = circle[(idx + 1) % circle.length];
  if (left.id === right.id) return [left];
  return [left, right];
}

function countEvilPairs(session: GameSession, script: ScriptData): number {
  const circle = livingCircle(session);
  if (circle.length < 2) return 0;
  let pairs = 0;
  for (let i = 0; i < circle.length; i++) {
    const a = circle[i];
    const b = circle[(i + 1) % circle.length];
    if (registersAsEvil(a, script) && registersAsEvil(b, script)) pairs += 1;
  }
  // each pair counted once around the ring
  return pairs;
}

function countEvilNeighbors(
  session: GameSession,
  script: ScriptData,
  empathId: string,
): number {
  return neighborsOf(session, empathId).filter((p) => registersAsEvil(p, script)).length;
}

function isDemonOrRedHerring(p: Player, script: ScriptData): boolean {
  const c = findDef(script, p.characterId);
  if (c?.team === "demon") return true;
  return p.reminders.some((r) => /red herring/i.test(r));
}

function shouldIncludePlayer(
  session: GameSession,
  p: Player,
  c: CharacterDef,
  isFirstNight: boolean,
): { include: boolean; skip?: boolean; skipReason?: string } {
  if (p.leftGame) return { include: false };
  if (p.characterId !== c.id) return { include: false };

  if (c.oncePerGame && (p.abilityUsed || p.reminders.includes("No ability"))) {
    if (charOrder(c, isFirstNight) > 0) {
      return { include: true, skip: true, skipReason: "Ability already used (once per game)." };
    }
  }

  if (isFirstNight) {
    return { include: true };
  }

  if (c.id === "ravenkeeper") {
    if (!session.diedTonightIds.includes(p.id)) {
      return {
        include: true,
        skip: true,
        skipReason: "Skip — Ravenkeeper did not die tonight.",
      };
    }
    return { include: true };
  }

  if (c.id === "undertaker") {
    if (!p.alive) return { include: false };
    if (!session.executedTodayId) {
      return {
        include: true,
        skip: true,
        skipReason: "Skip — no execution today.",
      };
    }
    return { include: true };
  }

  if (!p.alive) return { include: false };
  return { include: true };
}

function wakeTextFor(
  c: CharacterDef,
  isFirstNight: boolean,
  players: Player[],
): string {
  const names = players.map((p) => p.name).join(", ");
  const who = names || "the player";

  if (c.id === "imp" && isFirstNight) {
    return "Skip Imp kill. Demon info already covered bluffs & Minions.";
  }

  const tips: Record<string, string> = {
    washerwoman: `Quietly wake ${who}. Tap them → pick 2 players + 1 Townsfolk token → Show. Then sleep.`,
    librarian: `Quietly wake ${who}. Tap → 2 players + 1 Outsider (or zero Outsiders) → Show. Then sleep.`,
    investigator: `Quietly wake ${who}. Tap → 2 players + 1 Minion → Show. Then sleep.`,
    chef: `Quietly wake ${who}. Tap → confirm evil-pair number (suggested) → Show. Then sleep.`,
    empath: `Quietly wake ${who}. Tap → confirm 0/1/2 evil neighbors (suggested) → Show. Then sleep.`,
    fortuneteller: `Quietly wake ${who}. They pick 2 players. Tap → Yes/No → Show. Then sleep.`,
    undertaker: `Quietly wake ${who}. Tap → show today’s executed character → Show. Then sleep.`,
    monk: `Quietly wake ${who}. They pick someone to protect (not self). Confirm → marks Safe. Safe fails if Monk or target is Poisoned. Then sleep.`,
    ravenkeeper: `Quietly wake ${who} (died tonight). They pick a player → show that character → Show. Then sleep.`,
    butler: `Quietly wake ${who}. They pick Master. Confirm → marks Master. Then sleep.`,
    poisoner: `Quietly wake ${who}. They pick a poison target. Confirm → marks Poisoned. Poison disables Monk Safe / Soldier / etc. Then sleep.`,
    spy: `Quietly wake ${who}. Tap → Show grimoire (private). Then sleep.`,
    scarletwoman: `Quietly wake ${who}. If Demon died & ≥5 non-travellers alive, they become Demon (auto when enforced). Then sleep.`,
    imp: `Quietly wake ${who}. They choose a kill. Confirm → Dead unless Safe/Soldier blocks. Self-kill → star-pass to a Minion. Then sleep.`,
    bureaucrat: `Quietly wake ${who}. They pick a player for 3 votes tomorrow. Confirm reminder. Then sleep.`,
    thief: `Quietly wake ${who}. They pick a player for negative vote tomorrow. Confirm reminder. Then sleep.`,
    apprentice: `Quietly wake ${who}. Show them the ability they gain. Then sleep.`,
  };

  return tips[c.id] || `Quietly wake ${who}. ${c.storytellerNotes || c.ability} Then sleep.`;
}

function showForMeta(id: string, session: GameSession, script: ScriptData): NightShowSpec {
  if (id === "demon-info") {
    const minions = session.players
      .filter((p) => {
        const c = findDef(script, p.characterId);
        return c?.team === "minion" && !p.leftGame;
      })
      .map((p) => p.id);
    return {
      kind: "demon-info",
      hint: "Show Minions + the Demon’s three bluffs (set bluffs on the Demon in Grimoire).",
      suggestedPlayerIds: minions,
      maxPlayers: 3,
      playerTitle: "You are the Demon",
      playerPrompt: "Learn your Minions and your three bluffs.",
      playersLabel: "Your Minions",
      bluffsLabel: "These characters are not in play",
    };
  }
  if (id === "minion-info") {
    const demon = session.players.find((p) => {
      const c = findDef(script, p.characterId);
      return c?.team === "demon" && !p.leftGame;
    });
    return {
      kind: "minion-info",
      hint: "Show who the Demon is.",
      suggestedPlayerIds: demon ? [demon.id] : [],
      maxPlayers: 1,
      playerTitle: "You are a Minion",
      playerPrompt: "Learn who your Demon is.",
      playersLabel: "This is the Demon",
    };
  }
  return {
    kind: "none",
    hint: "No private info this step — eyes closed for the town.",
  };
}

function showForCharacter(
  c: CharacterDef,
  session: GameSession,
  script: ScriptData,
  acting: Player[],
  isFirstNight: boolean,
): NightShowSpec {
  const wakeId = acting[0]?.id;
  const wokenImpaired = acting.some(isPoisonedOrDrunk);

  let spec: NightShowSpec;
  switch (c.id) {
    case "washerwoman": {
      const pair = buildTrueInfoPair(session, script, "townsfolk");
      spec = {
        kind: "players-and-character",
        hint: "Truthful pair + Townsfolk token are pre-filled when healthy. Adjust if needed; Done places Townsfolk / Wrong · Washerwoman from real characterIds.",
        minPlayers: 2,
        maxPlayers: 2,
        characterTeams: ["townsfolk"],
        suggestedPlayerIds: pair.playerIds,
        suggestedCharacterId: pair.characterId,
        playerTitle: "Washerwoman",
        playerPrompt: "Tonight you learn about two players and a Townsfolk.",
        playersLabel: "These two players",
        characterLabel: "One of them is this Townsfolk",
      };
      break;
    }
    case "librarian": {
      const pair = buildTrueInfoPair(session, script, "outsider");
      spec = {
        kind: "players-and-character",
        hint: pair.zeroOutsiders
          ? "No Outsiders in play — Zero Outsiders is pre-selected when healthy."
          : "Truthful pair + Outsider token are pre-filled when healthy. Done places Outsider / Wrong · Librarian (or clears).",
        minPlayers: 2,
        maxPlayers: 2,
        characterTeams: ["outsider"],
        allowZeroOutsiders: true,
        zeroOutsidersLabel: "Zero Outsiders",
        suggestedPlayerIds: pair.playerIds,
        suggestedCharacterId: pair.characterId,
        suggestedZeroOutsiders: pair.zeroOutsiders,
        playerTitle: "Librarian",
        playerPrompt: "Tonight you learn about the Outsiders.",
        playersLabel: "These two players",
        characterLabel: "One of them is this Outsider",
      };
      break;
    }
    case "investigator": {
      const pair = buildTrueInfoPair(session, script, "minion");
      spec = {
        kind: "players-and-character",
        hint: "Truthful pair + Minion token are pre-filled when healthy. Adjust if needed; Done places Minion / Wrong · Investigator from real characterIds.",
        minPlayers: 2,
        maxPlayers: 2,
        characterTeams: ["minion"],
        suggestedPlayerIds: pair.playerIds,
        suggestedCharacterId: pair.characterId,
        playerTitle: "Investigator",
        playerPrompt: "Tonight you learn about two players and a Minion.",
        playersLabel: "These two players",
        characterLabel: "One of them is this Minion",
      };
      break;
    }
    case "chef":
      spec = {
        kind: "number",
        hint: "Show how many pairs of evil players. Suggested number is truthful unless Poisoned/Drunk (then a lie default).",
        suggestedNumber: countEvilPairs(session, script),
        playerTitle: "Chef",
        playerPrompt: "Tonight you learn how many pairs of neighbouring evil players there are.",
        resultLabel: "Evil pairs",
      };
      break;
    case "empath":
      spec = {
        kind: "number",
        hint: "Show how many living neighbors are evil (0–2). Suggested number is truthful unless Poisoned/Drunk (then a lie default).",
        suggestedNumber: wakeId ? countEvilNeighbors(session, script, wakeId) : 0,
        playerTitle: "Empath",
        playerPrompt: "Tonight you learn how many of your living neighbours are evil.",
        resultLabel: "Evil neighbours",
      };
      break;
    case "fortuneteller":
      spec = {
        kind: "yes-no",
        hint: "They choose 2 players. Mark them, then Yes if either is the Demon or Red Herring. If Red herring is missing, place it on a good living player first.",
        minPlayers: 2,
        maxPlayers: 2,
        playerTitle: "Fortune Teller",
        playerPrompt: "Choose two players. You will learn if either is the Demon.",
        playersLabel: "You chose",
        resultLabel: "Is either the Demon?",
      };
      break;
    case "undertaker": {
      const ex = session.players.find((p) => p.id === session.executedTodayId);
      spec = {
        kind: "character",
        hint: "Show who was executed today (their character).",
        suggestedPlayerIds: ex ? [ex.id] : [],
        suggestedCharacterId: ex?.characterId ?? null,
        playerTitle: "Undertaker",
        playerPrompt: "Tonight you learn who was executed today.",
        playersLabel: "Executed today",
        characterLabel: "Their character",
      };
      break;
    }
    case "ravenkeeper":
      spec = {
        kind: "player-character",
        hint: "They pick a player. Character loads from truth unless Poisoned/Drunk (then a wrong character is suggested for ST).",
        minPlayers: 1,
        maxPlayers: 1,
        playerTitle: "Ravenkeeper",
        playerPrompt: "Choose a player. You will learn their character.",
        playersLabel: "You chose",
        characterLabel: "Their character",
      };
      break;
    case "spy":
      spec = {
        kind: "grimoire",
        hint: "Show the private grimoire on your phone. No TV. Spy may register as good — ST discretion.",
        playerTitle: "Spy",
        playerPrompt: "Tonight you see the Grimoire.",
      };
      break;
    case "monk":
      spec = {
        kind: "choose-target",
        hint: "They pick someone to protect (not themselves). Confirm marks Safe. Safe fails if Monk or target is Poisoned.",
        maxPlayers: 1,
        reminder: "Safe",
        playerTitle: "Monk",
        playerPrompt: "Choose a player to protect tonight. You cannot protect yourself.",
        playersLabel: "Protected",
      };
      break;
    case "poisoner":
      spec = {
        kind: "choose-target",
        hint: "They pick someone to poison. Confirm marks Poisoned. Disables that player’s ability (Safe/Soldier/etc.).",
        maxPlayers: 1,
        reminder: "Poisoned",
        playerTitle: "Poisoner",
        playerPrompt: "Choose a player to poison tonight.",
        playersLabel: "Poisoned",
      };
      break;
    case "butler":
      spec = {
        kind: "choose-target",
        hint: "They pick their Master. Confirm marks Master. Butler may only vote if Master votes (auto-enforced).",
        maxPlayers: 1,
        reminder: "Master",
        playerTitle: "Butler",
        playerPrompt: "Choose your Master. You may only vote if they vote.",
        playersLabel: "Your Master",
      };
      break;
    case "imp":
      if (isFirstNight) {
        spec = { kind: "none", hint: "No kill on first night." };
        break;
      }
      spec = {
        kind: "choose-target",
        hint: "They choose who dies. Confirm marks Dead unless Safe/Soldier blocks. Self-kill → star-pass to a Minion.",
        maxPlayers: 1,
        reminder: "Dead",
        playerTitle: "Imp",
        playerPrompt: "Choose a player to kill tonight.",
        playersLabel: "Your kill",
      };
      break;
    case "scarletwoman": {
      const demonDead = session.players.some((p) => {
        const d = findDef(script, p.characterId);
        return d?.team === "demon" && (!p.alive || session.diedTonightIds.includes(p.id));
      });
      const aliveNonTraveller = session.players.filter(
        (p) => p.alive && !p.leftGame && !p.isTraveller,
      ).length;
      const becomes =
        demonDead && aliveNonTraveller >= 5
          ? "You are now the Demon."
          : "You are not the Demon (yet).";
      spec = {
        kind: "message",
        hint: "Tell them privately whether they become the Demon.",
        message: becomes,
        playerTitle: "Scarlet Woman",
        playerPrompt: "Learn whether you become the Demon.",
        resultLabel: "Tonight",
      };
      break;
    }
    case "bureaucrat":
      spec = {
        kind: "choose-target",
        hint: "They pick a player whose vote counts as three tomorrow.",
        maxPlayers: 1,
        reminder: "3 votes",
        playerTitle: "Bureaucrat",
        playerPrompt: "Choose a player. Their vote counts as three tomorrow.",
        playersLabel: "Three votes",
      };
      break;
    case "thief":
      spec = {
        kind: "choose-target",
        hint: "They pick a player whose vote counts against them tomorrow.",
        maxPlayers: 1,
        reminder: "Negative vote",
        playerTitle: "Thief",
        playerPrompt: "Choose a player. Their vote counts against them tomorrow.",
        playersLabel: "Negative vote",
      };
      break;
    case "apprentice":
      spec = {
        kind: "message",
        hint: "Show the ability you are giving them tonight.",
        message: "Tonight you gain an ability. (Storyteller will tell you which.)",
        playerTitle: "Apprentice",
        playerPrompt: "Learn what ability you gain tonight.",
        resultLabel: "Your ability",
      };
      break;
    default:
      spec = {
        kind: "none",
        hint: c.storytellerNotes || c.ability,
      };
      break;
  }

  // Townsfolk info (and Spy): lie defaults + truth* when woken player is Poisoned/Drunk.
  // Monk/Poisoner/Butler/Imp picks left alone — protection already fails via abilityDisabled.
  if (wokenImpaired && isLieableInfoKind(spec.kind)) {
    return applyImpairedInfoShow(spec, session, script, c.id);
  }
  if (wokenImpaired && spec.kind === "grimoire") {
    return {
      ...spec,
      infoImpaired: true,
      stWarning: FALSE_INFO_ST_WARNING,
      hint: `${FALSE_INFO_ST_WARNING}. ${spec.hint}`,
    };
  }
  return spec;
}

export function buildNightSteps(
  session: GameSession,
  script: ScriptData,
  isFirstNight: boolean,
): NightStep[] {
  const steps: NightStep[] = [];
  const meta = isFirstNight ? script.firstNightMeta : script.otherNightMeta;
  for (const m of meta) {
    const stFacing =
      m.id === "dusk"
        ? "Everyone closes their eyes. Do not announce who will wake. Tap Next when the room is dark and quiet."
        : m.id === "demon-info"
          ? "Quietly wake the Demon only. Tap them → show Minions + 3 bluffs on your phone (hold screen toward them). Then sleep."
          : m.id === "minion-info"
            ? "Quietly wake each Minion. Tap them → show who the Demon is. Then sleep."
            : m.wakeText;
    steps.push({
      id: m.id,
      characterId: null,
      name: m.name,
      wakeText: stFacing,
      playerIds:
        m.id === "demon-info"
          ? session.players
              .filter((p) => {
                const c = findDef(script, p.characterId);
                return c?.team === "demon" && !p.leftGame;
              })
              .map((p) => p.id)
          : m.id === "minion-info"
            ? session.players
                .filter((p) => {
                  const c = findDef(script, p.characterId);
                  return c?.team === "minion" && !p.leftGame;
                })
                .map((p) => p.id)
            : [],
      show: showForMeta(m.id, session, script),
    });
  }

  const pool: CharacterDef[] = [...script.characters, ...script.travellers];

  const chars = pool
    .filter((c) => charOrder(c, isFirstNight) > 0)
    .filter((c) =>
      session.players.some((p) => {
        const r = shouldIncludePlayer(session, p, c, isFirstNight);
        return r.include;
      }),
    )
    .sort((a, b) => charOrder(a, isFirstNight) - charOrder(b, isFirstNight));

  for (const c of chars) {
    const matched = session.players.filter((p) => {
      const r = shouldIncludePlayer(session, p, c, isFirstNight);
      return r.include && p.characterId === c.id;
    });
    if (matched.length === 0) continue;

    const active = matched.filter((p) => !shouldIncludePlayer(session, p, c, isFirstNight).skip);
    const sample = matched[0];
    const check = shouldIncludePlayer(session, sample, c, isFirstNight);

    if (active.length === 0 && check.skip) {
      steps.push({
        id: `char-${c.id}`,
        characterId: c.id,
        name: c.name,
        wakeText: check.skipReason || "Skip.",
        playerIds: matched.map((p) => p.id),
        skipped: true,
        skipReason: check.skipReason,
        show: { kind: "none", hint: check.skipReason || "Skipped." },
      });
      continue;
    }

    const acting = active.length ? active : matched;
    steps.push({
      id: `char-${c.id}`,
      characterId: c.id,
      name: c.name,
      wakeText: wakeTextFor(c, isFirstNight, acting),
      playerIds: acting.map((p) => p.id),
      skipped: false,
      show: showForCharacter(c, session, script, acting, isFirstNight),
    });
  }

  steps.push({
    id: "dawn",
    characterId: null,
    name: "Dawn",
    wakeText:
      "Night is over. Do not name who woke. Confirm to open Dawn, then pick deaths → announce names only → finish dawn.",
    playerIds: [],
    show: { kind: "none", hint: "Confirm below to open the Dawn phase." },
  });

  return steps;
}

/** Truthful FT answer for selected players (Demon or Red Herring). */
export function fortuneTellerAnswer(
  session: GameSession,
  script: ScriptData,
  playerIds: string[],
): "yes" | "no" {
  const hit = playerIds.some((id) => {
    const p = session.players.find((x) => x.id === id);
    return p ? isDemonOrRedHerring(p, script) : false;
  });
  return hit ? "yes" : "no";
}

export function dayAbilityTips(session: GameSession, script: ScriptData) {
  const tips: {
    playerId: string;
    playerName: string;
    characterId: string;
    characterName: string;
    tip: string;
    oncePerGame: boolean;
    abilityUsed: boolean;
  }[] = [];

  for (const p of session.players) {
    if (p.leftGame || !p.characterId) continue;
    const c = findDef(script, p.characterId);
    if (!c) continue;
    const nightless = (c.firstNight ?? 0) === 0 && (c.otherNight ?? 0) === 0;
    if (!nightless && !c.oncePerGame) continue;
    if (
      [
        "virgin",
        "slayer",
        "soldier",
        "mayor",
        "saint",
        "baron",
        "recluse",
        "drunk",
        "gunslinger",
        "scapegoat",
        "matron",
        "judge",
        "voudon",
        "bishop",
        "beggar",
      ].includes(c.id) ||
      (c.oncePerGame && nightless)
    ) {
      tips.push({
        playerId: p.id,
        playerName: p.name,
        characterId: c.id,
        characterName: c.name,
        tip:
          c.id === "soldier"
            ? "AUTO: night Demon kills blocked unless Soldier is Poisoned/Drunk. Still dies to execution/day deaths."
            : c.id === "mayor"
              ? "AUTO at Start night: if exactly 3 living non-travellers & no execution today → Good wins."
              : c.id === "saint"
                ? "AUTO: if executed (Confirm death) while not Poisoned/Drunk → Evil wins."
                : c.id === "virgin"
                  ? "AUTO: Townsfolk nominator is executed; skipped if Virgin is Poisoned/Drunk."
                  : c.id === "baron"
                    ? "Setup bag adjusts +2 Outsiders / −2 Townsfolk while Baron is assigned."
                    : c.storytellerNotes || c.ability,
        oncePerGame: !!c.oncePerGame,
        abilityUsed: p.abilityUsed || p.reminders.includes("No ability"),
      });
    }
  }
  return tips;
}

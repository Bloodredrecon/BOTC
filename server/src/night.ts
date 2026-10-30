import type { ScriptData } from "./persistence.js";
import { MASTER_LABEL, POISONED_LABEL, SAFE_LABEL } from "./reminders.js";
import { isEvil, isPoisonedOrDrunk, trueCharacterId, wakeCharacterId } from "./rules.js";
import type {
  CharacterDef,
  GameSession,
  NightShowSpec,
  NightStep,
  Player,
  RegistrationOptions,
} from "./types.js";

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function pickRandom<T>(list: T[]): T | undefined {
  return list.length ? list[Math.floor(Math.random() * list.length)] : undefined;
}

function bySeat(a: Player, b: Player) {
  return a.seat - b.seat;
}

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
  excludeIds: (string | null | undefined)[],
  teams?: CharacterDef["team"][],
): string | null {
  const pool = [...script.characters, ...script.travellers].filter((c) => {
    if (excludeIds.includes(c.id)) return false;
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
 * Who is being woken for the info. `ownRoleId` is the step's character — for a Drunk
 * that is the role they think they are (thinksCharacterId), never "drunk".
 */
type InfoReceiver = { playerIds: string[]; ownRoleId: string };

/** Living players other than the woken receiver(s), in seat order. */
function livingOthers(session: GameSession, receiver: InfoReceiver): Player[] {
  return session.players
    .filter((p) => !p.leftGame && p.alive && !receiver.playerIds.includes(p.id))
    .sort((a, b) => a.seat - b.seat);
}

/**
 * Standard BOTC WW/Lib/Inv construction: one real team member in play + one other
 * living player (both picked at random), and the true character id for the hit. Empty when
 * none of that team. Never suggests the receiver or their own role (e.g. Washerwoman never
 * shows Washerwoman). Uses true characters — the Drunk is an Outsider, never a Townsfolk.
 */
function buildTrueInfoPair(
  session: GameSession,
  script: ScriptData,
  team: CharacterDef["team"],
  receiver: InfoReceiver,
): InfoPairSuggestion {
  const living = livingOthers(session, receiver);
  const trueHit = pickRandom(
    living.filter((p) => {
      const id = trueCharacterId(script, p);
      return id !== receiver.ownRoleId && !p.isTraveller && findDef(script, id)?.team === team;
    }),
  );
  const hitCharacterId = trueHit ? trueCharacterId(script, trueHit) : null;

  if (trueHit && hitCharacterId) {
    const other = pickRandom(living.filter((p) => p.id !== trueHit.id));
    const truthPlayerIds = (other ? [trueHit, other] : [trueHit]).sort(bySeat).map((p) => p.id);
    return {
      playerIds: truthPlayerIds,
      characterId: hitCharacterId,
      truthPlayerIds,
      truthCharacterId: hitCharacterId,
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
  receiver: InfoReceiver,
): InfoPairSuggestion {
  const living = livingOthers(session, receiver);
  const teamChars = script.characters.filter(
    (c) => c.team === team && c.id !== receiver.ownRoleId,
  );
  const truth = buildTrueInfoPair(session, script, team, receiver);

  if (truth.truthCharacterId && truth.truthPlayerIds.length >= 2) {
    const falseChar =
      teamChars.find((c) => c.id !== truth.truthCharacterId)?.id ??
      pickDifferentCharacterId(script, [truth.truthCharacterId, receiver.ownRoleId], [team]);
    return {
      playerIds: truth.truthPlayerIds,
      characterId: falseChar,
      truthPlayerIds: truth.truthPlayerIds,
      truthCharacterId: truth.truthCharacterId,
      zeroOutsiders: false,
    };
  }

  // No true hit (e.g. zero Outsiders): invent a bluff pair + token
  const pair = shuffled(living).slice(0, 2).sort(bySeat);
  const characterId = pickRandom(teamChars)?.id ?? null;
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
  receiver: InfoReceiver,
): NightShowSpec {
  const characterId = receiver.ownRoleId;
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
      pickDifferentCharacterId(script, [truthCharacterId, characterId], spec.characterTeams) ??
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
      const falsePair = buildFalseInfoPair(session, script, team, receiver);
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

/**
 * How a player may register for alignment checks. Truth is their real alignment; the Recluse
 * might register as evil and the Spy might register as good (Storyteller's choice).
 */
type Registration = (p: Player) => boolean;

function trulyEvil(script: ScriptData): Registration {
  return (p) => isEvil(script, p);
}

/** Fewest evil the Storyteller can show: Spy registers good, Recluse good. */
function leastEvil(script: ScriptData): Registration {
  return (p) => p.characterId !== "spy" && isEvil(script, p);
}

/** Most evil the Storyteller can show: Recluse registers evil, Spy evil. */
function mostEvil(script: ScriptData): Registration {
  return (p) => p.characterId === "recluse" || isEvil(script, p);
}

function registrationPlayers(session: GameSession, receiverIds: string[] = []) {
  const others = session.players.filter((p) => !p.leftGame && !receiverIds.includes(p.id));
  return {
    recluses: others.filter((p) => p.characterId === "recluse"),
    spies: others.filter((p) => p.characterId === "spy"),
  };
}

function numberRegistration(
  truth: number,
  least: number,
  most: number,
  session: GameSession,
  receiverIds: string[],
): RegistrationOptions | undefined {
  if (least === most) return undefined;
  const { recluses, spies } = registrationPlayers(session, receiverIds);
  const who = [
    ...recluses.map((p) => `Recluse (${p.name}) may register evil`),
    ...spies.map((p) => `Spy (${p.name}) may register good`),
  ].join("; ");
  const numbers: number[] = [];
  for (let n = least; n <= most; n++) numbers.push(n);
  return { note: `${who}. True count ${truth}; you may show any of these.`, numbers };
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

function countEvilPairs(session: GameSession, evil: Registration): number {
  const circle = livingCircle(session);
  if (circle.length < 2) return 0;
  if (circle.length === 2) return evil(circle[0]!) && evil(circle[1]!) ? 1 : 0;
  let pairs = 0;
  for (let i = 0; i < circle.length; i++) {
    const a = circle[i]!;
    const b = circle[(i + 1) % circle.length]!;
    if (evil(a) && evil(b)) pairs += 1;
  }
  // each pair counted once around the ring
  return pairs;
}

function countEvilNeighbors(session: GameSession, empathId: string, evil: Registration): number {
  return neighborsOf(session, empathId).filter(evil).length;
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
  if (wakeCharacterId(p) !== c.id) return { include: false };

  // "This new Imp does not act that same night."
  if (c.id === "imp" && (session.newDemons ?? []).some((d) => d.playerId === p.id && d.duringNight)) {
    return { include: false };
  }

  const diedTonight = session.diedTonightIds.includes(p.id);
  if (!p.alive && diedTonight && c.id !== "ravenkeeper") {
    return { include: true, skip: true, skipReason: "Died tonight — does not wake." };
  }

  if (c.oncePerGame && (p.abilityUsed || p.reminders.includes("No ability"))) {
    if (charOrder(c, isFirstNight) > 0) {
      return { include: true, skip: true, skipReason: "Ability already used (once per game)." };
    }
  }

  if (isFirstNight) {
    if (!p.alive && !diedTonight) return { include: false };
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
    monk: `Quietly wake ${who}. They pick someone to protect (any other player, alive or dead). Confirm → marks Safe. Safe fails only if the Monk is Poisoned/Drunk. Then sleep.`,
    ravenkeeper: `Quietly wake ${who} (died tonight). They pick a player → show that character → Show. Then sleep.`,
    butler: `Quietly wake ${who}. They pick a Master (not themselves). Confirm → marks Master. Then sleep.`,
    poisoner: `Quietly wake ${who}. They pick a poison target. Confirm → marks Poisoned. Poison disables Monk Safe / Soldier / etc. Then sleep.`,
    spy: `Quietly wake ${who}. Tap → Show grimoire (private). Then sleep.`,
    scarletwoman: `Quietly wake ${who}. If Demon died & ≥5 non-travellers alive, they become Demon (auto when enforced). Then sleep.`,
    imp: `Quietly wake ${who}. They choose a kill (any player). Confirm → Dead, or no death if Safe/Soldier protects or the Imp is Poisoned/Drunk. A healthy Mayor may bounce the kill (your choice). Self-kill → star-pass to a Minion you choose. Then sleep.`,
    bureaucrat: `Quietly wake ${who}. They pick a player (not themselves) for 3 votes tomorrow. Confirm reminder. Then sleep.`,
    thief: `Quietly wake ${who}. They pick a player (not themselves) for a negative vote tomorrow. Confirm reminder. Then sleep.`,
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
    const minions = session.players
      .filter((p) => !p.leftGame && findDef(script, p.characterId)?.team === "minion")
      .sort(bySeat)
      .map((p) => p.id);
    return {
      kind: "minion-info",
      hint: "Wake all Minions together. Show who the Demon is — they also see each other.",
      suggestedPlayerIds: demon ? [demon.id] : [],
      maxPlayers: 1,
      playerTitle: "You are a Minion",
      playerPrompt: "Learn who your Demon is, and your fellow Minions.",
      playersLabel: "This is the Demon",
      fellowPlayerIds: minions,
      fellowLabel: "The Minions",
    };
  }
  if (id === "evil-traveller-info") {
    const demon = session.players.find(
      (p) => !p.leftGame && p.alive && findDef(script, p.characterId)?.team === "demon",
    );
    return {
      kind: "minion-info",
      hint: "Evil Traveller: show who the Demon is. They learn no other evil players and get no bluffs.",
      suggestedPlayerIds: demon ? [demon.id] : [],
      maxPlayers: 1,
      playerTitle: "You are evil",
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
  const receiver: InfoReceiver = { playerIds: acting.map((p) => p.id), ownRoleId: c.id };

  const { recluses, spies } = registrationPlayers(session, receiver.playerIds);
  const living = livingOthers(session, receiver);
  /** A Spy / Recluse registering as `team`: pair them with another random living player. */
  const altPairs = (who: Player[], role: string, team: CharacterDef["team"]) =>
    who
      .filter((p) => p.alive)
      .map((p) => {
        const other = pickRandom(living.filter((x) => x.id !== p.id));
        const inPlay = new Set(session.players.map((x) => trueCharacterId(script, x)));
        const token =
          pickRandom(script.characters.filter((x) => x.team === team && !inPlay.has(x.id) && x.id !== receiver.ownRoleId)) ??
          pickRandom(script.characters.filter((x) => x.team === team && x.id !== receiver.ownRoleId));
        return {
          label: `${role} (${p.name}) registers as ${team === "townsfolk" ? "a Townsfolk" : team === "outsider" ? "an Outsider" : "a Minion"}`,
          playerIds: (other ? [p, other] : [p]).sort(bySeat).map((x) => x.id),
          characterId: token?.id ?? null,
        };
      });
  const pairRegistration = (
    pairs: RegistrationOptions["pairs"],
    note: string,
  ): RegistrationOptions | undefined => (pairs && pairs.length ? { note, pairs } : undefined);

  let spec: NightShowSpec;
  switch (c.id) {
    case "washerwoman": {
      const pair = buildTrueInfoPair(session, script, "townsfolk", receiver);
      spec = {
        registration: pairRegistration(
          altPairs(spies, "Spy", "townsfolk"),
          "The Spy may register as a Townsfolk (your choice). Pick one of these instead of the truth if you like.",
        ),
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
      const pair = buildTrueInfoPair(session, script, "outsider", receiver);
      spec = {
        registration: pairRegistration(
          altPairs(spies, "Spy", "outsider"),
          "The Spy may register as an Outsider (your choice). Pick one of these instead of the truth if you like.",
        ),
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
      const pair = buildTrueInfoPair(session, script, "minion", receiver);
      spec = {
        registration: pairRegistration(
          altPairs(recluses, "Recluse", "minion"),
          "The Recluse may register as a Minion (your choice). Pick one of these instead of the truth if you like.",
        ),
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
    case "chef": {
      const truth = countEvilPairs(session, trulyEvil(script));
      spec = {
        registration: numberRegistration(
          truth,
          countEvilPairs(session, leastEvil(script)),
          countEvilPairs(session, mostEvil(script)),
          session,
          receiver.playerIds,
        ),
        kind: "number",
        hint: "Show how many pairs of evil players. Suggested number is truthful unless Poisoned/Drunk (then a lie default).",
        suggestedNumber: truth,
        playerTitle: "Chef",
        playerPrompt: "Tonight you learn how many pairs of neighbouring evil players there are.",
        resultLabel: "Evil pairs",
      };
      break;
    }
    case "empath": {
      const truth = wakeId ? countEvilNeighbors(session, wakeId, trulyEvil(script)) : 0;
      const neighbourIds = wakeId ? neighborsOf(session, wakeId).map((p) => p.id) : [];
      spec = {
        registration: wakeId
          ? numberRegistration(
              truth,
              countEvilNeighbors(session, wakeId, leastEvil(script)),
              countEvilNeighbors(session, wakeId, mostEvil(script)),
              { ...session, players: session.players.filter((p) => neighbourIds.includes(p.id)) },
              receiver.playerIds,
            )
          : undefined,
        kind: "number",
        hint: "Show how many living neighbors are evil (0–2). Suggested number is truthful unless Poisoned/Drunk (then a lie default).",
        suggestedNumber: truth,
        playerTitle: "Empath",
        playerPrompt: "Tonight you learn how many of your living neighbours are evil.",
        resultLabel: "Evil neighbours",
      };
      break;
    }
    case "fortuneteller":
      spec = {
        registration: recluses.length
          ? {
              note: `Recluse (${recluses.map((p) => p.name).join(", ")}) may register as the Demon — you may answer Yes if they are chosen.`,
            }
          : undefined,
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
      const exTrue = ex ? trueCharacterId(script, ex) : null;
      const exAlternatives =
        ex?.characterId === "recluse"
          ? script.characters.filter((x) => x.team === "minion" || x.team === "demon").map((x) => x.id)
          : ex?.characterId === "spy"
            ? script.characters.filter((x) => x.team === "townsfolk" || x.team === "outsider").map((x) => x.id)
            : [];
      spec = {
        registration: exAlternatives.length
          ? {
              note:
                ex?.characterId === "recluse"
                  ? `The executed Recluse (${ex.name}) may register as a Minion or Demon (your choice).`
                  : `The executed Spy (${ex?.name}) may register as a Townsfolk or Outsider (your choice).`,
              characterIds: exAlternatives,
            }
          : undefined,
        kind: "character",
        hint: "Show who was executed today (their character).",
        suggestedPlayerIds: ex ? [ex.id] : [],
        suggestedCharacterId: exTrue,
        playerTitle: "Undertaker",
        playerPrompt: "Tonight you learn who was executed today.",
        playersLabel: "Executed today",
        characterLabel: "Their character",
      };
      break;
    }
    case "ravenkeeper":
      spec = {
        registration:
          recluses.length || spies.length
            ? {
                note: [
                  ...recluses.map((p) => `Recluse (${p.name}) may show as a Minion or Demon`),
                  ...spies.map((p) => `Spy (${p.name}) may show as a Townsfolk or Outsider`),
                ].join("; ") + " (your choice).",
              }
            : undefined,
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
        hint: "They pick someone to protect (not themselves; dead players allowed). Confirm marks Safe. Safe fails only if the Monk is Poisoned/Drunk.",
        maxPlayers: 1,
        reminder: SAFE_LABEL,
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
        reminder: POISONED_LABEL,
        playerTitle: "Poisoner",
        playerPrompt: "Choose a player to poison tonight.",
        playersLabel: "Poisoned",
      };
      break;
    case "butler":
      spec = {
        kind: "choose-target",
        hint: "They pick their Master (not themselves). Confirm marks Master. The Butler may only vote while the Master's hand is up — you get a private warning if not.",
        maxPlayers: 1,
        reminder: MASTER_LABEL,
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
        hint: "They choose who dies (any player). Confirm marks Dead; a Safe/Soldier target survives and nobody dies. Self-kill → star-pass to a Minion you choose (a healthy Scarlet Woman must take it).",
        maxPlayers: 1,
        reminder: "Dead",
        playerTitle: "Imp",
        playerPrompt: "Choose a player to kill tonight.",
        playersLabel: "Your kill",
      };
      break;
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
  // Monk/Poisoner/Butler/Imp picks left alone — protection / the Imp kill fail via abilityDisabled.
  if (wokenImpaired && isLieableInfoKind(spec.kind)) {
    return applyImpairedInfoShow(spec, session, script, receiver);
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

const META_WAKE_TEXT: Record<string, string> = {
  dusk: "Everyone closes their eyes. Do not announce who will wake. Tap Next when the room is dark and quiet.",
  "minion-info":
    "Quietly wake all the Minions together. Tap them → show who the Demon is (they also see each other). Then sleep.",
  "demon-info":
    "Quietly wake the Demon only. Tap them → show Minions + 3 bluffs on your phone (hold screen toward them). Then sleep.",
  "evil-traveller-info":
    "Quietly wake the evil Traveller(s). Show who the Demon is — no other evil players, no bluffs. Then sleep.",
};

/** Minion info and Demon info only happen with 7+ (non-Traveller) players. */
export const EVIL_INFO_MIN_PLAYERS = 7;

function metaStep(
  id: string,
  name: string,
  fallbackText: string,
  playerIds: string[],
  session: GameSession,
  script: ScriptData,
  skipReason?: string,
): NightStep {
  if (skipReason) {
    return {
      id,
      characterId: null,
      name,
      wakeText: skipReason,
      playerIds,
      skipped: true,
      skipReason,
      show: { kind: "none", hint: skipReason },
    };
  }
  return {
    id,
    characterId: null,
    name,
    wakeText: META_WAKE_TEXT[id] ?? fallbackText,
    playerIds,
    show: showForMeta(id, session, script),
  };
}

function newDemonStep(session: GameSession, playerId: string, via: "scarletwoman" | "starpass"): NightStep | null {
  const p = session.players.find((x) => x.id === playerId && !x.leftGame);
  if (!p) return null;
  const how = via === "scarletwoman" ? "The Scarlet Woman became the Imp" : "The Imp passed the Demon to them";
  return {
    id: `new-demon-${p.id}`,
    characterId: "imp",
    name: "New Demon",
    wakeText: `Quietly wake ${p.name}. Show the YOU ARE token, then the Imp. ${how}. Then sleep.`,
    playerIds: [p.id],
    skipped: false,
    show: {
      kind: "message",
      hint: `${how}. Show them they are now the Imp.`,
      message: "You are the Imp.",
      playerTitle: "You are the Imp",
      playerPrompt: "You are now the Demon.",
      resultLabel: "Your character",
    },
  };
}

export function buildNightSteps(
  session: GameSession,
  script: ScriptData,
  isFirstNight: boolean,
): NightStep[] {
  const steps: NightStep[] = [];
  const meta = isFirstNight ? script.firstNightMeta : script.otherNightMeta;
  const metaById = new Map(meta.map((m) => [m.id, m]));
  const residents = session.players.filter((p) => !p.leftGame && !p.isTraveller);
  const teamIds = (team: CharacterDef["team"]) =>
    session.players
      .filter((p) => !p.leftGame && !p.isTraveller && findDef(script, p.characterId)?.team === team)
      .sort(bySeat)
      .map((p) => p.id);

  const pool: CharacterDef[] = [...script.characters, ...script.travellers];
  const chars = pool
    .filter((c) => c.id !== "scarletwoman")
    .filter((c) => charOrder(c, isFirstNight) > 0)
    .filter((c) => session.players.some((p) => shouldIncludePlayer(session, p, c, isFirstNight).include))
    .sort((a, b) => charOrder(a, isFirstNight) - charOrder(b, isFirstNight));

  const charStep = (c: CharacterDef): NightStep | null => {
    const matched = session.players
      .filter((p) => shouldIncludePlayer(session, p, c, isFirstNight).include)
      .sort(bySeat);
    if (matched.length === 0) return null;
    const active = matched.filter((p) => !shouldIncludePlayer(session, p, c, isFirstNight).skip);
    if (active.length === 0) {
      const check = shouldIncludePlayer(session, matched[0]!, c, isFirstNight);
      return {
        id: `char-${c.id}`,
        characterId: c.id,
        name: c.name,
        wakeText: check.skipReason || "Skip.",
        playerIds: matched.map((p) => p.id),
        skipped: true,
        skipReason: check.skipReason,
        show: { kind: "none", hint: check.skipReason || "Skipped." },
      };
    }
    return {
      id: `char-${c.id}`,
      characterId: c.id,
      name: c.name,
      wakeText: wakeTextFor(c, isFirstNight, active),
      playerIds: active.map((p) => p.id),
      skipped: false,
      show: showForCharacter(c, session, script, active, isFirstNight),
    };
  };

  const dusk = metaById.get("dusk");
  if (dusk) steps.push(metaStep("dusk", dusk.name, dusk.wakeText, [], session, script));

  // Official order: Dusk → Travellers (Bureaucrat, Thief…) → Minion info → Demon info → the rest.
  const travellerChars = chars.filter((c) => c.team === "traveller");
  const otherChars = chars.filter((c) => c.team !== "traveller");
  for (const c of travellerChars) {
    const s = charStep(c);
    if (s) steps.push(s);
  }

  if (isFirstNight) {
    const tooFew =
      residents.length < EVIL_INFO_MIN_PLAYERS
        ? `Skip — fewer than ${EVIL_INFO_MIN_PLAYERS} players: the Minions and Demon don't learn each other (and no bluffs).`
        : undefined;
    for (const id of ["minion-info", "demon-info"] as const) {
      const m = metaById.get(id);
      if (!m) continue;
      steps.push(
        metaStep(id, m.name, m.wakeText, teamIds(id === "minion-info" ? "minion" : "demon"), session, script, tooFew),
      );
    }
  }

  const evilTravellers = session.players
    .filter((p) => p.isTraveller && !p.leftGame && p.alive && p.alignment === "evil" && !p.learnedDemon)
    .sort(bySeat);
  if (evilTravellers.length) {
    steps.push(
      metaStep(
        "evil-traveller-info",
        "Evil Traveller",
        META_WAKE_TEXT["evil-traveller-info"]!,
        evilTravellers.map((p) => p.id),
        session,
        script,
      ),
    );
  }

  // A Demon made during the day (Scarlet Woman) is told at the Scarlet Woman's place in the order;
  // one made tonight (star-pass / Scarlet Woman after the Imp's self-kill) right after the Imp.
  const swDef = findDef(script, "scarletwoman");
  const swOrder = swDef ? charOrder(swDef, isFirstNight) || 7 : 7;
  const newDemons = session.newDemons ?? [];
  const dayDemons = newDemons.filter((d) => !d.duringNight);
  const nightDemons = newDemons.filter((d) => d.duringNight);
  let dayDemonsPlaced = false;
  const placeDayDemons = () => {
    if (dayDemonsPlaced) return;
    dayDemonsPlaced = true;
    for (const d of dayDemons) {
      const s = newDemonStep(session, d.playerId, d.via);
      if (s) steps.push(s);
    }
  };

  for (const c of otherChars) {
    if (charOrder(c, isFirstNight) > swOrder) placeDayDemons();
    const s = charStep(c);
    if (s) steps.push(s);
    if (c.id === "imp") {
      for (const d of nightDemons) {
        const nd = newDemonStep(session, d.playerId, d.via);
        if (nd) steps.push(nd);
      }
    }
  }
  placeDayDemons();
  if (!steps.some((s) => s.id === "char-imp")) {
    for (const d of nightDemons) {
      const nd = newDemonStep(session, d.playerId, d.via);
      if (nd && !steps.some((s) => s.id === nd.id)) steps.push(nd);
    }
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
              ? "AUTO at Start night: exactly 3 alive (travellers count) & no execution today → Good wins."
              : c.id === "saint"
                ? "AUTO: if executed (Confirm death) while not Poisoned/Drunk → Evil wins."
                : c.id === "virgin"
                  ? "AUTO on first nomination: Townsfolk nominator executed (Drunk never; Spy is your call). Ability spent either way, even if Poisoned."
                  : c.id === "slayer"
                    ? "Votes tab → Slayer shot. Kills the Demon (or a Recluse you let register as Demon); ability spent even on a miss or when Poisoned."
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

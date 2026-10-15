export type Phase =
  | "lobby"
  | "firstNight"
  | "night"
  | "dawn"
  | "day"
  | "nomination"
  | "vote"
  | "execution"
  | "dusk"
  | "ended";

export type Team = "townsfolk" | "outsider" | "minion" | "demon" | "traveller";

export type CharacterDef = {
  id: string;
  name: string;
  team: Team;
  ability: string;
  firstNight?: number;
  otherNight?: number;
  reminders: string[];
  oncePerGame?: boolean;
  storytellerNotes?: string;
};

export type FabledDef = {
  id: string;
  name: string;
  ability: string;
};

export type SetupCounts = {
  townsfolk: number;
  outsider: number;
  minion: number;
  demon: number;
};

export type Player = {
  id: string;
  seat: number;
  name: string;
  alive: boolean;
  usedGhostVote: boolean;
  characterId: string | null;
  reminders: string[];
  notes: string;
  bluffs: string[];
  isTraveller: boolean;
  abilityUsed: boolean;
  leftGame: boolean;
  /** Drunk only: the Townsfolk they believe they are (drives wake order / prompts). characterId stays "drunk". */
  thinksCharacterId: string | null;
  /** Travellers: the alignment the Storyteller chose (null for residents — derived from their character). */
  alignment: Alignment | null;
  /** Evil Traveller has been shown the Demon. */
  learnedDemon: boolean;
  /** Beggar: vote tokens given by dead players (one spent per vote). */
  voteTokens: number;
};

export type Alignment = "good" | "evil";

/** A Recluse / Spy may register differently: Storyteller-only alternatives for this info step. */
export type RegistrationOptions = {
  note: string;
  /** Chef / Empath: every legal number when Recluse / Spy register differently. */
  numbers?: number[];
  /** WW / Librarian / Investigator: alternative pairs (e.g. Spy as a Townsfolk, Recluse as a Minion). */
  pairs?: { label: string; playerIds: string[]; characterId: string | null }[];
  /** Undertaker: character tokens the executed Recluse / Spy may register as. */
  characterIds?: string[];
};

export type NightShowKind =
  | "none"
  | "demon-info"
  | "minion-info"
  | "players-and-character"
  | "number"
  | "yes-no"
  | "character"
  | "player-character"
  | "grimoire"
  | "choose-target"
  | "message";

export type NightShowSpec = {
  kind: NightShowKind;
  /** Short ST hint under the composer */
  hint: string;
  minPlayers?: number;
  maxPlayers?: number;
  /** Restrict character token picker to these teams */
  characterTeams?: Team[];
  /** Librarian may show “zero Outsiders” instead of a token */
  allowZeroOutsiders?: boolean;
  /** Reminder to apply when ST confirms a choose-target pick */
  reminder?: string;
  /**
   * Default shown in the ST composer. When infoImpaired, this is a deliberate lie
   * (not the truth). Player overlay never reads these fields.
   */
  suggestedNumber?: number | null;
  suggestedYesNo?: "yes" | "no" | null;
  suggestedPlayerIds?: string[];
  suggestedCharacterId?: string | null;
  /** Librarian: composer should default to Zero Outsiders (healthy, none in play). */
  suggestedZeroOutsiders?: boolean;
  /** ST-only: real answer when infoImpaired (never show on player overlay). */
  truthNumber?: number | null;
  truthYesNo?: "yes" | "no" | null;
  truthPlayerIds?: string[];
  truthCharacterId?: string | null;
  /**
   * Woken info player is Poisoned/Drunk — suggested* are lie defaults;
   * truth* hold the real answer for ST eyes only. Never copy into playerPrompt.
   */
  infoImpaired?: boolean;
  /** ST-only banner when infoImpaired (never copy into playerPrompt). */
  stWarning?: string;
  /** Prewritten private message (Scarlet Woman / Apprentice) */
  message?: string;
  zeroOutsidersLabel?: string;
  /** Title on the player-facing phone overlay (e.g. “You are the Demon”) */
  playerTitle?: string;
  /** Second-person ask / framing shown to the woken player */
  playerPrompt?: string;
  /** Label above the players list on the show */
  playersLabel?: string;
  /** Label above the character token on the show */
  characterLabel?: string;
  /** Label above yes/no or number result */
  resultLabel?: string;
  /** Label for demon bluffs section */
  bluffsLabel?: string;
  /** Minion info: every Minion (the overlay shows the woken Minion the others). */
  fellowPlayerIds?: string[];
  fellowLabel?: string;
  /** ST-only Recluse / Spy registration alternatives. */
  registration?: RegistrationOptions;
};

export type NightStep = {
  id: string;
  characterId: string | null;
  name: string;
  wakeText: string;
  playerIds: string[];
  skipped?: boolean;
  skipReason?: string;
  /** What the Storyteller phone should offer to show this step */
  show: NightShowSpec;
};

/**
 * majority = nominee goes on the block; tie = matched the block holder, block cleared;
 * outvoted = reached majority but not above the block holder; no_majority = below half.
 */
export type VoteOutcome = "majority" | "no_majority" | "tie" | "outvoted";

/** One nomination today. votes/outcome stay null while its vote is open. */
export type DayNomination = {
  nominatorId: string;
  nomineeId: string;
  votes: number | null;
  majority: number | null;
  outcome: VoteOutcome | "virgin" | null;
  /** Opened with the Storyteller override (bypassed nomination limits). */
  override?: boolean;
  at: number;
};

/** Who is executed at the end of the day. nomineeId null = tied at `votes`, nobody on the block. */
export type BlockState = { nomineeId: string | null; votes: number };

export type PublicEvent =
  | { type: "night_death"; playerIds: string[]; dayNumber: number; at: number }
  | {
      type: "nomination";
      nominatorId: string;
      nomineeId: string;
      at: number;
    }
  | {
      type: "vote_result";
      nomineeId: string;
      votesFor: number;
      majority: number;
      outcome: VoteOutcome;
      at: number;
    }
  | { type: "dusk"; dayNumber: number; at: number }
  | { type: "nominations_open"; dayNumber: number; at: number }
  | { type: "no_execution"; dayNumber: number; at: number }
  | {
      type: "execution";
      playerId: string;
      died: boolean;
      /** The executed player was already dead (the execution still counts; nobody dies). */
      alreadyDead?: boolean;
      /** Current day when logged (optional on older sessions). */
      dayNumber?: number;
      at: number;
    }
  | {
      type: "exile";
      playerId: string;
      playerName?: string;
      supporters: number;
      threshold: number;
      exiled: boolean;
      dayNumber?: number;
      at: number;
    }
  | {
      type: "other_death";
      playerId: string;
      /** ST-private cause; never shown on public/TV chronicle. */
      reason?: string;
      dayNumber?: number;
      /** True when death happened overnight (firstNight / night / dawn). */
      duringNight?: boolean;
      at: number;
    }
  | {
      type: "traveller_join";
      playerId: string;
      /** Display name at join time (survives later leave). */
      playerName?: string;
      characterId: string;
      /** Public Traveller character name (declared to the town on arrival). */
      characterName?: string;
      at: number;
    }
  | {
      type: "traveller_leave";
      playerId: string;
      /** Captured before leftGame filters the player out of public state. */
      playerName?: string;
      at: number;
    };

export type AmbianceLayerState = {
  id: string;
  enabled: boolean;
  volume: number;
};

export type AmbianceState = {
  masterVolume: number;
  layers: AmbianceLayerState[];
};

export type AmbianceLayerKind = "loop" | "sporadic";

export type AmbiancePublicLayer = AmbianceLayerState & {
  cueId: string;
  kind: AmbianceLayerKind;
  minGapSec?: number;
};

export type AmbiancePublicState = {
  masterVolume: number;
  layers: AmbiancePublicLayer[];
};

export type AmbianceLayerDef = {
  id: string;
  label: string;
  hint: string;
  kind: AmbianceLayerKind;
  defaultVolume: number;
  minGapSec?: number;
};

export type GameSession = {
  scriptId: "trouble-brewing";
  phase: Phase;
  dayNumber: number;
  players: Player[];
  fabled: string[];
  publicLog: PublicEvent[];
  night: { stepIndex: number; steps: NightStep[]; isFirstNight: boolean } | null;
  timer: { endsAt: number; label: string } | null;
  nomination: {
    nominatorId: string;
    nomineeId: string;
    votesFor: string[];
    /** Phase to return to when the vote closes (dusk; day only for a Storyteller-override nomination). */
    returnPhase?: "day" | "dusk";
    /** The Virgin's ability this nomination spent — restored if the nomination is cancelled. */
    virginRestore?: { playerId: string; abilityUsed: boolean; hadNoAbility: boolean };
  } | null;
  dawnDeathIds: string[];
  /** True after announceDawnDeaths this dawn; overnight deaths stay private on TV until then. */
  dawnDeathsAnnounced: boolean;
  executionPendingId: string | null;
  /** Who died by execution today (the Undertaker's answer). Null if nobody died by execution. */
  executedTodayId: string | null;
  /** Today's one execution has happened — even if the player lived or was already dead. */
  executionOccurredToday: boolean;
  /** Players who became the Demon and still need their "You are the Imp" wake. */
  newDemons: NewDemon[];
  /** A Baron was in the bag at setup — the +2 Outsiders stays even if the Baron dies / star-passes. */
  baronInSetup: boolean;
  /** Each player's character when the first night began (for the end-of-game recap; ST only). */
  startingCharacters: Record<string, string | null>;
  /** Open call to exile a Traveller (not a nomination; abilities don't apply). */
  exile: ExileState | null;
  /** Storyteller toggled the public character sheet / setup counts onto the TV. */
  tvSheet: boolean;
  /** House rule: allow more than 15 non-Traveller seats (official cap is 15). */
  allowOver15: boolean;
  /** Today's nominations; cleared when a new day starts. */
  nominationsToday: DayNomination[];
  block: BlockState | null;
  /** Dusk sub-step: the Storyteller pressed Open nominations (cleared when nominations close / new day). */
  nominationsOpen: boolean;
  /** The pending execution was started by Close nominations — the night follows once its cue has played. */
  nightPending: boolean;
  diedTonightIds: string[];
  winner: "good" | "evil" | null;
  /** Public end-game reason (null for a manual End). */
  winReason: string | null;
  /** Storyteller-only mechanical enforcement feedback (not shown on TV). */
  stNotices: { id: string; message: string; at: number }[];
  ambiance: AmbianceState;
  tvConnected: boolean;
  storytellerConnected: boolean;
};

export type NewDemon = {
  playerId: string;
  via: "scarletwoman" | "starpass";
  /** Became the Demon during tonight's wakes (told right after the Imp; no kill tonight). */
  duringNight: boolean;
};

export type ExileState = {
  travellerId: string;
  calledById: string | null;
  supporters: string[];
};

export type PublicPlayer = {
  id: string;
  seat: number;
  name: string;
  alive: boolean;
  usedGhostVote: boolean;
  isTraveller: boolean;
  leftGame: boolean;
  /** Travellers declare their character on arrival — public. Null for residents. */
  travellerCharacterName?: string | null;
};

export type RevealPlayer = PublicPlayer & {
  characterId: string | null;
  characterName: string | null;
  team: Team | null;
  abilityUsed: boolean;
  alignment: Alignment | null;
  /** Drunk: the Townsfolk they believed they were. */
  thinksCharacterName: string | null;
};

/** Public character sheet + official setup counts for the TV (no Baron adjustment — that is secret). */
export type PublicSheet = {
  playerCount: number;
  counts: SetupCounts | null;
  characters: { id: string; name: string; team: Team; ability: string }[];
  travellers: { id: string; name: string; ability: string }[];
};

export type PublicState = {
  scriptId: GameSession["scriptId"];
  scriptName: string;
  phase: Phase;
  dayNumber: number;
  seq: number;
  players: PublicPlayer[];
  fabled: { id: string; name: string }[];
  publicLog: PublicEvent[];
  timer: GameSession["timer"];
  nomination: {
    nominatorId: string;
    nomineeId: string;
    votesFor: string[];
    majority: number;
    votesForCount: number;
    /** Block holder's (or tied) vote count this vote must beat; null if the block is empty. */
    toBeat: number | null;
  } | null;
  dawnDeathIds: string[];
  /** Overnight deaths are public on TV only after announceDawnDeaths. */
  dawnDeathsAnnounced: boolean;
  executionPendingId: string | null;
  nominationsToday: DayNomination[];
  block: BlockState | null;
  /** Dusk sub-step: nominations are open (TV shows the nominations-open plaque). */
  nominationsOpen: boolean;
  storytellerConnected: boolean;
  soundCue: string | null;
  ambiance: AmbiancePublicState;
  hueScene: HueScene | null;
  winner: "good" | "evil" | null;
  winReason: string | null;
  reveal: RevealPlayer[] | null;
  exile: {
    travellerId: string;
    calledById: string | null;
    supporters: string[];
    threshold: number;
  } | null;
  /** Non-null while the Storyteller shows the character sheet (lobby / day / dusk). */
  sheet: PublicSheet | null;
};

export type DayAbilityTip = {
  playerId: string;
  playerName: string;
  characterId: string;
  characterName: string;
  tip: string;
  oncePerGame: boolean;
  abilityUsed: boolean;
};

/** Why each player can't nominate / be nominated right now (null = allowed). */
export type NominationRules = {
  /** Why no nomination can open at all (phase, open vote, execution done). */
  closedReason: string | null;
  /** Day, or dusk before Open nominations: nominations aren't open yet; the Storyteller override may bypass. */
  notOpenReason: string | null;
  /** Day-wide limit the Storyteller override may bypass (execution already happened). */
  dayLimitReason: string | null;
  nominator: Record<string, string | null>;
  nominee: Record<string, string | null>;
};

export type StorytellerState = PublicState & {
  players: Player[];
  night: GameSession["night"];
  setup: SetupCounts | null;
  /** The official row for this player count, before any Baron adjustment. */
  officialSetup: SetupCounts | null;
  assignedCounts: SetupCounts;
  setupWarning: string | null;
  characters: CharacterDef[];
  travellers: CharacterDef[];
  allFabled: FabledDef[];
  pinRequired: boolean;
  dayAbilities: DayAbilityTip[];
  executedTodayId: string | null;
  executionOccurredToday: boolean;
  newDemons: NewDemon[];
  startingCharacters: Record<string, string | null>;
  tvSheet: boolean;
  allowOver15: boolean;
  /** Private: the Butler's hand is up without their Master's (the vote still counts). */
  butlerWarning: string | null;
  nightPending: boolean;
  nominationRules: NominationRules;
  diedTonightIds: string[];
  stNotices: { id: string; message: string; at: number }[];
  audioCues: {
    id: string;
    label: string;
    file: string;
    builtin: boolean;
    group: string;
    subgroup?: string;
  }[];
  ambianceCatalog: AmbianceLayerDef[];
};

export type HueScene =
  | "day"
  | "night"
  | "night_wake"
  | "dawn"
  | "nomination"
  | "vote_urgency"
  | "execution"
  | "death_settle"
  | "hush"
  | null;

export type ClientRole = "storyteller" | "tv";

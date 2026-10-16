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
  /** Drunk only: the Townsfolk they believe they are. characterId stays "drunk". */
  thinksCharacterId: string | null;
  /** Travellers: the Storyteller's secret alignment choice (null for residents). */
  alignment: Alignment | null;
  learnedDemon: boolean;
  /** Beggar: vote tokens given by dead players. */
  voteTokens: number;
  /** Cache-bust for `/api/player-photos/:id` (null = no photo). */
  photoRev: number | null;
};

export type Alignment = "good" | "evil";

export type RegistrationOptions = {
  note: string;
  numbers?: number[];
  pairs?: { label: string; playerIds: string[]; characterId: string | null }[];
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
  hint: string;
  minPlayers?: number;
  maxPlayers?: number;
  characterTeams?: Team[];
  allowZeroOutsiders?: boolean;
  reminder?: string;
  /** ST composer default; when infoImpaired this is a lie default. */
  suggestedNumber?: number | null;
  suggestedYesNo?: "yes" | "no" | null;
  suggestedPlayerIds?: string[];
  suggestedCharacterId?: string | null;
  /** Librarian: composer should default to Zero Outsiders (healthy, none in play). */
  suggestedZeroOutsiders?: boolean;
  /** ST-only real answer when infoImpaired (never show on player overlay). */
  truthNumber?: number | null;
  truthYesNo?: "yes" | "no" | null;
  truthPlayerIds?: string[];
  truthCharacterId?: string | null;
  /** Woken info player is Poisoned/Drunk — suggested* are lies; truth* for ST. */
  infoImpaired?: boolean;
  /** ST-only banner when infoImpaired (never show on player overlay). */
  stWarning?: string;
  message?: string;
  zeroOutsidersLabel?: string;
  playerTitle?: string;
  playerPrompt?: string;
  playersLabel?: string;
  characterLabel?: string;
  resultLabel?: string;
  bluffsLabel?: string;
  fellowPlayerIds?: string[];
  fellowLabel?: string;
  /** Storyteller-only: how a Recluse / Spy may register for this step. */
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
  show: NightShowSpec;
};

/** majority = on the block; tie = matched the holder, block cleared; outvoted = majority but too few. */
export type VoteOutcome = "majority" | "no_majority" | "tie" | "outvoted";

export type DayNomination = {
  nominatorId: string;
  nomineeId: string;
  votes: number | null;
  majority: number | null;
  outcome: VoteOutcome | "virgin" | null;
  override?: boolean;
  at: number;
};

/** nomineeId null = tied at `votes`, nobody on the block. */
export type BlockState = { nomineeId: string | null; votes: number };

export type NominationRules = {
  closedReason: string | null;
  /** Day, or dusk before Open nominations (Storyteller override may bypass). */
  notOpenReason: string | null;
  dayLimitReason: string | null;
  nominator: Record<string, string | null>;
  nominee: Record<string, string | null>;
};

export type PublicEvent =
  | { type: "night_death"; playerIds: string[]; dayNumber: number; at: number }
  | { type: "nomination"; nominatorId: string; nomineeId: string; at: number }
  | {
      type: "vote_result";
      nomineeId: string;
      votesFor: number;
      majority: number;
      outcome: VoteOutcome;
      voterIds?: string[];
      at: number;
    }
  | { type: "dusk"; dayNumber: number; at: number }
  | { type: "nominations_open"; dayNumber: number; at: number }
  | { type: "no_execution"; dayNumber: number; at: number }
  | {
      type: "execution";
      playerId: string;
      died: boolean;
      /** The executed player was already dead (the execution counts; nobody dies). */
      alreadyDead?: boolean;
      /** Executed at once for nominating the Virgin. */
      virgin?: boolean;
      /** Current day when logged (optional on older sessions). */
      dayNumber?: number;
      at: number;
    }
  | {
      /** A public Slayer shot; `hit` = the target died (never says why). */
      type: "slayer_shot";
      shooterId: string;
      targetId: string;
      hit: boolean;
      dayNumber: number;
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

export type PublicPlayer = {
  id: string;
  seat: number;
  name: string;
  alive: boolean;
  usedGhostVote: boolean;
  isTraveller: boolean;
  leftGame: boolean;
  /** Travellers' characters are public. */
  travellerCharacterName?: string | null;
  /** Non-null when the seat has a face photo (`/api/player-photos/:id?v=photoRev`). */
  photoRev: number | null;
};

export type RevealPlayer = PublicPlayer & {
  characterId: string | null;
  characterName: string | null;
  team: Team | null;
  abilityUsed: boolean;
  alignment: Alignment | null;
  thinksCharacterName: string | null;
};

export type PublicSheet = {
  playerCount: number;
  counts: SetupCounts | null;
  characters: { id: string; name: string; team: Team; ability: string }[];
  travellers: { id: string; name: string; ability: string }[];
};

export type NewDemon = { playerId: string; via: "scarletwoman" | "starpass"; duringNight: boolean };

export type PublicState = {
  scriptId: string;
  scriptName: string;
  phase: Phase;
  dayNumber: number;
  seq: number;
  players: PublicPlayer[];
  fabled: { id: string; name: string }[];
  publicLog: PublicEvent[];
  timer: { endsAt: number; label: string } | null;
  nomination: {
    nominatorId: string;
    nomineeId: string;
    votesFor: string[];
    majority: number;
    votesForCount: number;
    /** Block holder's (or tied) count this vote must beat; null if the block is empty. */
    toBeat: number | null;
    /** Phone hands and the clock hand (public: real hands are up at the table too). */
    phoneVote: {
      phoneSeats: string[];
      handsUp: string[];
      sweep: { order: string[]; index: number; paused: boolean; msPerSeat: number } | null;
    } | null;
  } | null;
  dawnDeathIds: string[];
  /** Overnight deaths are public on TV only after announceDawnDeaths. */
  dawnDeathsAnnounced: boolean;
  executionPendingId: string | null;
  nominationsToday: DayNomination[];
  block: BlockState | null;
  /** Dusk sub-step: the Storyteller pressed Open nominations. */
  nominationsOpen: boolean;
  storytellerConnected: boolean;
  soundCue: string | null;
  ambiance: AmbiancePublicState;
  hueScene: string | null;
  winner: "good" | "evil" | null;
  winReason: string | null;
  reveal: RevealPlayer[] | null;
  exile: {
    travellerId: string;
    calledById: string | null;
    supporters: string[];
    threshold: number;
  } | null;
  sheet: PublicSheet | null;
  /** Null unless player phones are on and claims are open. */
  phoneJoin: { code: string } | null;
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

export type AudioCueGroup =
  | "core"
  | "phase"
  | "votes"
  | "deaths"
  | "endgame"
  | "guests"
  | "rules"
  | "atmosphere"
  | "other";

export type AudioCueInfo = {
  id: string;
  label: string;
  file: string;
  builtin: boolean;
  group: AudioCueGroup;
  subgroup?: string;
};

export type AmbianceLayerKind = "loop" | "sporadic";

export type AmbianceLayerDef = {
  id: string;
  label: string;
  hint: string;
  kind: AmbianceLayerKind;
  defaultVolume: number;
  minGapSec?: number;
};

export type AmbianceLayerState = {
  id: string;
  enabled: boolean;
  volume: number;
};

export type AmbiancePublicLayer = AmbianceLayerState & {
  cueId: string;
  kind: AmbianceLayerKind;
  minGapSec?: number;
};

export type AmbiancePublicState = {
  masterVolume: number;
  layers: AmbiancePublicLayer[];
};

export type StorytellerState = Omit<PublicState, "players"> & {
  players: Player[];
  night: { stepIndex: number; steps: NightStep[]; isFirstNight: boolean } | null;
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
  /** Each player's character when the first night began (end-of-game recap). */
  startingCharacters: Record<string, string | null>;
  tvSheet: boolean;
  allowOver15: boolean;
  butlerWarning: string | null;
  /** An end-of-day execution was confirmed; the night starts when its cue finishes. */
  nightPending: boolean;
  nominationRules: NominationRules;
  diedTonightIds: string[];
  stNotices: { id: string; message: string; at: number }[];
  audioCues: AudioCueInfo[];
  ambianceCatalog: AmbianceLayerDef[];
  phones: PhonePanel;
  /** Phone seats whose vote the Storyteller set by hand this vote. */
  phoneVoteOverridden: string[];
  /** TV Enable sound succeeded (ephemeral). */
  tvSoundReady: boolean;
  /** Lobby ready-to-begin checklist (server source of truth). */
  setupReadiness: SetupReadiness;
};

export type SetupReadinessItem = {
  id: string;
  label: string;
  ok: boolean;
  hard: boolean;
};

export type SetupReadiness = {
  items: SetupReadinessItem[];
  ready: boolean;
  applicable: boolean;
};

export type PhoneMessage = {
  id: string;
  from: "player" | "storyteller";
  kind: "question" | "word" | "reply";
  text: string;
  at: number;
};

export type PhonePrivate = {
  revealedCharacterId: string | null;
  revealedAlignment: Alignment | null;
  revealedAt: number | null;
  messages: PhoneMessage[];
  unreadByStoryteller: number;
};

export type PhoneClaimInfo = {
  id: string;
  playerId: string;
  deviceLabel: string;
  status: "pending" | "active";
  claimedAt: number;
  lastSeenAt: number;
  connected: number;
};

export type PhonePanel = {
  enabled: boolean;
  joinCode: string;
  claimsOpen: boolean;
  voting: "phones" | "manual";
  sweepMsPerSeat: number;
  claims: PhoneClaimInfo[];
  private: Record<string, PhonePrivate>;
  spectators: number;
};

/** What a phone or spectator sees of the town (an allowlist of PublicState). */
export type PhonePublic = Pick<
  PublicState,
  | "scriptName"
  | "phase"
  | "dayNumber"
  | "seq"
  | "players"
  | "fabled"
  | "publicLog"
  | "timer"
  | "nomination"
  | "dawnDeathIds"
  | "dawnDeathsAnnounced"
  | "executionPendingId"
  | "nominationsToday"
  | "block"
  | "nominationsOpen"
  | "winner"
  | "winReason"
  | "reveal"
  | "exile"
> & { gameId: string; sheet: PublicSheet };

export type PhoneMe = {
  playerId: string;
  seat: number;
  name: string;
  photoRev: number | null;
  alive: boolean;
  usedGhostVote: boolean;
  isTraveller: boolean;
  character: { id: string; name: string; team: Team; ability: string } | null;
  alignment: Alignment | null;
  revealedAt: number | null;
  messages: PhoneMessage[];
  /** This seat's hand while a nomination is open; null otherwise. */
  vote: PhoneMeVote | null;
};

export type PhoneMeVote = {
  /** False: the Storyteller counts this seat's real hand. */
  byPhone: boolean;
  handUp: boolean;
  /** The clock hand has passed this seat (or the Storyteller set it). */
  locked: boolean;
  storytellerSet: boolean;
  counted: boolean;
  canRaise: boolean;
  note: string | null;
};

export type PlayerState = PhonePublic & { me: PhoneMe };

export type PhoneStatus =
  | { status: "off" }
  | { status: "watching" }
  | { status: "unclaimed"; reason: "unknown" | "denied" | "revoked" | "replaced" | "cleared" | null }
  | { status: "pending"; playerId: string; seat: number; name: string; photoRev: number | null }
  | { status: "active"; playerId: string };

/** A proposed deal from the setup wizard (server/src/setup-wizard.ts). */
export type Deal = {
  seats: { playerId: string; characterId: string; thinksCharacterId: string | null }[];
  redHerringId: string | null;
  bluffs: string[];
  counts: SetupCounts;
  baron: boolean;
};

/** One line of the Storyteller-only game action log (server/src/action-log.ts). */
export type GameLogEntry = {
  t: number;
  kind: "action" | "system" | "auth" | "connection";
  action?: string;
  args?: Record<string, unknown>;
  outcome: "ok" | "rejected" | "error" | "no-change" | "info";
  reason?: string;
  phase: string;
  day: number;
  phaseAfter?: string;
  dayAfter?: number;
  notices?: string[];
  events?: string[];
  client?: string;
  text: string;
};

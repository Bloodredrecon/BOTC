export type Phase =
  | "lobby"
  | "firstNight"
  | "night"
  | "dawn"
  | "day"
  | "nomination"
  | "vote"
  | "execution"
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

export type PublicEvent =
  | { type: "night_death"; playerIds: string[]; dayNumber: number; at: number }
  | { type: "nomination"; nominatorId: string; nomineeId: string; at: number }
  | {
      type: "vote_result";
      nomineeId: string;
      votesFor: number;
      majority: number;
      outcome: "majority" | "no_majority" | "tie";
      at: number;
    }
  | {
      type: "execution";
      playerId: string;
      died: boolean;
      /** Current day when logged (optional on older sessions). */
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
};

export type RevealPlayer = PublicPlayer & {
  characterId: string | null;
  characterName: string | null;
  team: Team | null;
  abilityUsed: boolean;
};

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
  } | null;
  dawnDeathIds: string[];
  /** Overnight deaths are public on TV only after announceDawnDeaths. */
  dawnDeathsAnnounced: boolean;
  executionPendingId: string | null;
  storytellerConnected: boolean;
  soundCue: string | null;
  ambiance: AmbiancePublicState;
  hueScene: string | null;
  winner: "good" | "evil" | null;
  reveal: RevealPlayer[] | null;
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
  assignedCounts: SetupCounts;
  setupWarning: string | null;
  characters: CharacterDef[];
  travellers: CharacterDef[];
  allFabled: FabledDef[];
  pinRequired: boolean;
  dayAbilities: DayAbilityTip[];
  executedTodayId: string | null;
  diedTonightIds: string[];
  stNotices: { id: string; message: string; at: number }[];
  audioCues: AudioCueInfo[];
  ambianceCatalog: AmbianceLayerDef[];
};

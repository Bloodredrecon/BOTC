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

export type Team = "townsfolk" | "outsider" | "minion" | "demon";

export type CharacterDef = {
  id: string;
  name: string;
  team: Team;
  ability: string;
  firstNight: number;
  otherNight: number;
  reminders: string[];
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
};

export type NightStep = {
  id: string;
  characterId: string | null;
  name: string;
  wakeText: string;
  playerIds: string[];
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
  | { type: "execution"; playerId: string; died: boolean; at: number }
  | { type: "other_death"; playerId: string; reason: string; at: number };

export type PublicPlayer = {
  id: string;
  seat: number;
  name: string;
  alive: boolean;
  usedGhostVote: boolean;
};

export type SoundCue =
  | "day_bed"
  | "night_bed"
  | "hush"
  | "timer_end"
  | "nomination"
  | "execution"
  | "death"
  | "dawn"
  | "night_wake"
  | null;

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
  executionPendingId: string | null;
  storytellerConnected: boolean;
  soundCue: SoundCue;
  hueScene: string | null;
};

export type StorytellerState = Omit<PublicState, "players"> & {
  players: Player[];
  night: { stepIndex: number; steps: NightStep[]; isFirstNight: boolean } | null;
  setup: SetupCounts | null;
  assignedCounts: SetupCounts;
  setupWarning: string | null;
  characters: CharacterDef[];
  allFabled: FabledDef[];
  pinRequired: boolean;
};

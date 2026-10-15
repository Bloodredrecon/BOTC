# More scripts: Bad Moon Rising, Sects & Violets, custom scripts - plan

Status: **plan only, waiting for the decisions at the end.** Nothing here is built.

Sources: the current code (file:line as of commit `c264f3c`, Oct 15), the official data release (`https://release.botc.app/resources/data/roles.json`, `jinxes.json`, `nightsheet.json` and `script-schema.json` from `ThePandemoniumInstitute/botc-release`, downloaded Oct 15 to a temp folder, not committed), TPI's Community Created Content Policy (fetched Oct 15), and the unfinished Sep 30 research (its in-progress findings, re-checked against today's code).

---

## 1. What is Trouble Brewing-only today

**Script loading is fixed to one file.**
- `server/src/persistence.ts:19` `SCRIPT_PATH = .../trouble-brewing.json`; `loadScript()` at `:109` reads only that. `server/src/index.ts:36` loads it once at startup.
- `server/src/types.ts:290` `scriptId: "trouble-brewing"` is a literal type; `persistence.ts:37` and `:162` repeat it.

**Night order** comes from numeric `firstNight` / `otherNight` in our TB JSON (`night.ts:264`) plus three meta steps (`dusk`, `minion-info`, `demon-info`; `night.ts:912`). The Scarlet Woman is special-cased out (`night.ts:923`). The official order is a list of ids (`nightsheet.json`: 80 first-night entries, 99 other-night entries, with `dusk`, `minioninfo`, `demoninfo`, `dawn` placed among the characters), so new scripts need ordering from that list, not hand-typed numbers.

**Per-character code** (string-literal TB ids): `night.ts` 50 references (16 `case` branches building each wake), `web/src/pages/StorytellerPage.tsx` 28, `rules.ts` 26, `game.ts` 24, `setup-wizard.ts` 9, plus a few in `projection.ts`, `reminders.ts`, `persistence.ts` and the setup wizard UI.

**Assumptions that break with the other scripts:**
- **Bare-string reminders.** `Player.reminders: string[]` (`types.ts:47`). Any Townsfolk with a "Drunk" reminder is treated as *the* Drunk (`rules.ts:24-40`). In BMR the Sailor, Innkeeper, Courtier, Minstrel and Goon make players drunk for a while; they would be misread as the Drunk.
- **One poison, cleared every night.** `isPoisoned` checks a single "Poisoned" reminder (`rules.ts:53`) and the night start clears it everywhere (`rules.ts:171-172`). No Dashii (permanent, neighbours), Pukka (poison then delayed death), Vigormortis (permanent) and Snake Charmer (poisoned Demon) all break this.
- **The Demon is the Imp.** A Minion taking over becomes `"imp"` (`rules.ts:343`); star-pass is `"imp"`-only (`rules.ts:375`); kills are detected by regex on the free-text death reason (`game.ts:1872`, `:1907`; `projection.ts:61`).
- **One Demon kill per night.** Shabaloth (2), Po (0 or 3), Zombuul (only if nobody died today), Pukka (delayed), Gossip/Moonchild/Godfather/Assassin (extra deaths), and Shabaloth/Professor (coming back to life) all need a list of deaths with causes.
- **Setup modifier is the Baron only.** `setup-wizard.ts:92`, `rules.ts:233`, `projection.ts:120`, `game.ts:913`. BMR's Godfather is -1 or +1 Outsider (Storyteller's choice); S&V's Fang Gu is +1, Vigormortis -1.
- **Voters are not recorded.** `DayNomination` (`types.ts:164`) keeps the vote count, not who voted. Flowergirl ("did a Demon vote today") needs voter ids.
- **Win check** is "Demon dead" / "two alive" plus Saint/Mayor. Mastermind (extra day), Vortox (no execution means evil wins), Evil Twin, Klutz and Zombuul (registers as dead) need hooks.

**Already script-neutral:** nominations and the block (`server/src/nominations.ts`), the TV projection and character sheet (the sheet is built from the loaded script's characters; text only, no icons), the TV panels, the action log, undo, the setup wizard's bag logic apart from the Baron, the Traveller exile flow.

**Travellers:** our TB JSON already lists 10 (`beggar, bureaucrat, thief, gunslinger, scapegoat` plus the BMR five `apprentice, matron, judge, voudon, bishop`). The S&V five (`barista, harlot, butcher, bonecollector, deviant`) are missing. Officially any Traveller can join any script.

**Narration:** most cues are generic. TB-specific: `sacred_blood` (Virgin), `public_shot*` (Slayer), and the rules chapters (`rules_teams` says "Trouble Brewing", `rules_abilities` walks the TB sheet, `rules_win` names the Saint and Mayor, `rules_night` says the Demon kills each night).

---

## 2. Official data (as downloaded Oct 15)

- `roles.json`: 181 characters. Each base edition has 13 Townsfolk, 4 Outsiders, 4 Minions and 4 Demons, except TB, which has 1 Demon. There are also Travellers (TB 5, BMR 5, S&V 5, Carousel 3), Fabled (12 + 2), Loric (11) and the Carousel set (30/11/15/10).
- Fields: `id, name, team, edition, ability, flavor, reminders, setup, firstNightReminder` (night order is in `nightsheet.json`, not here).
- Setup modifiers flagged (`setup: true`): BMR Godfather; S&V Vigormortis, Fang Gu (and TB Baron).
- **BMR:** Townsfolk grandmother, sailor, chambermaid, innkeeper, gambler, exorcist, gossip, courtier, professor, minstrel, tealady, fool, pacifist. Outsiders goon, lunatic, tinker, moonchild. Minions godfather, devilsadvocate, assassin, mastermind. Demons pukka, shabaloth, po, zombuul.
- **S&V:** Townsfolk clockmaker, snakecharmer, mathematician, dreamer, flowergirl, towncrier, oracle, savant, seamstress, philosopher, artist, juggler, sage. Outsiders sweetheart, klutz, barber, mutant. Minions witch, cerenovus, pithag, eviltwin. Demons nodashii, vigormortis, vortox, fanggu.
- **Jinxes between characters of the three base scripts** (`jinxes.json`, 7; show as text, Storyteller resolves):
  - Mastermind + Vigormortis: a Mastermind with their ability keeps it if the Vigormortis dies.
  - Mathematician + Chambermaid: the Chambermaid can detect if the Mathematician will wake tonight.
  - Mathematician + Drunk: the Mathematician learns if the Drunk's ability yielded false info or failed.
  - Mathematician + Lunatic: the Mathematician learns if the Lunatic attacks a different player than the real Demon.
  - Pit-Hag + Goon: an evil player turned into the Goon can't turn good due to their own ability.
  - Recluse + Sage: the Recluse might register as the Demon to the Sage.
  - Scarlet Woman + Fang Gu: if there would be two Demons, one of them the Scarlet Woman, she stays the Scarlet Woman.
- **Custom script JSON** (`script-schema.json`): an array of 5-201 items. Each item is either:
  - an official id string (`"washerwoman"`);
  - a `_meta` object (`id: "_meta"`, `name`, optional `author, logo, hideTitle, background, almanac, bootlegger, firstNight, otherNight`);
  - a full homebrew character (`id, name, team, ability` required; optional `image, edition, flavor, firstNight, firstNightReminder, otherNight, otherNightReminder, reminders, remindersGlobal, setup, jinxes, special`);
  - or the deprecated `{ "id": "..." }`.
  Ids are lowercase alphanumeric. Older scripts use `fortune_teller` style, so normalise by lowercasing and removing non-alphanumerics.

---

## 3. Licensing (decide in section 9)

From TPI's Community Created Content Policy (fetched Oct 15):
- "You can make what you like for personal use, but we don't allow distribution of tools that compete with the official app or script tool."
- "Tools that directly compete with official resources or attempt to provide definitive rulings on character interactions won't be approved. Ambiguity is a deliberate design choice."
- Golden rules: don't impersonate TPI, don't commercialise, don't compete. The policy "is not a licence".

What this means for the plan:
- Private LAN use for one group fits "personal use". A **public** GitHub repo is closer to distribution; the user has said public is fine, but it is the main risk.
- Keep the **Storyteller in charge**: the app suggests and records, it does not rule on interactions (this is also the plan's default for hard characters).
- **Icons:** none in git (today the TV and phone use our own team emblems). If wanted, fetch official icons at runtime into a gitignored cache, never commit them.
- **Ability text:** our committed `data/scripts/trouble-brewing.json` already contains the official TB ability text. For consistency, new editions could be built from `roles.json` into a gitignored cache at first run (our own Storyteller notes stay in git). Needs a decision.

---

## 4. Architecture

Goal: one rules engine for all scripts, with each character's behaviour in its own small module. Trouble Brewing moves first, with its 193 tests green at every step.

```
server/src/
  core/            session, phases, nominations, deaths, status, registration, win, night-builder
  scripts/         registry.ts (built-in + imported), import.ts (custom JSON -> ScriptData), nightsheet.ts
  characters/
    index.ts       id -> CharacterModule
    tb/ bmr/ snv/  one file per character with behaviour; text-only characters need no file
    shared/        builders for common patterns ("learn 1 of 2", "choose a player: protected", ...)
```

**Character module (all hooks optional):**

```ts
type CharacterModule = {
  id: string;
  setup?: (ctx) => SetupModifier;                     // Baron +2 O, Godfather +/-1 O, Fang Gu +1 O, Vigormortis -1 O
  wakes?: (ctx, night) => boolean;                     // Zombuul: only if nobody died today; Godfather: if an Outsider died today
  nightStep?: (ctx) => NightStepSpec;                  // prompt, choices, info suggestion for the Storyteller
  resolveChoice?: (ctx, choice) => Effect[];           // what the choice does
  protect?: (ctx, attempt: KillAttempt) => Protection | null;  // Monk, Soldier, Sailor, Innkeeper, Tea Lady, Fool
  onDeath?: (ctx, death: Death) => Effect[];           // Grandmother, Sage, Sweetheart, Moonchild, Klutz, Barber
  onNominate?: / onExecute?: (ctx, ...) => Effect[];   // Virgin, Witch, Devil's Advocate, Pacifist, Saint, Evil Twin
  registersAs?: (ctx, viewer) => Registration[];       // Spy, Recluse, Zombuul (as dead)
  dayAbility?: DayAbilitySpec;                         // Slayer, Gossip, Juggler, Savant, Artist
  winCheck?: (ctx) => Win | null;                      // Mayor, Saint, Mastermind, Vortox, Evil Twin, Klutz
  reminders?: ReminderSpec[];
};
```

**Effects are plain data** (`placeReminder`, `queueKill`, `setStatus`, `changeCharacter`, `changeAlignment`, `resurrect`, `notify`), applied in one place inside the existing `mutate()`. That keeps undo, the action log and the TV projection working unchanged, and makes each character testable on its own.

**Data model changes (TB first):**
- **Status instead of bare reminders:** `{ kind: "drunk" | "poisoned" | "protected" | "mad" | ..., source: characterId, sourcePlayerId, until: "dusk" | "dawn" | "nights:3" | "permanent" }`. Reminder tokens stay as the Storyteller's visible marks; status is what the rules read. Migrates "Is the Drunk" and "Poisoned".
- **Kill pipeline:** `KillAttempt { targetId, cause: { kind: "demon" | "ability" | "execution" | "storyteller", characterId, playerId } }`, then protection hooks, then deaths. This replaces the reason regexes.
- **Character-change queue** generalising the Scarlet Woman and star-pass (new Demon is whatever Demon died, not `"imp"`), used by Pit-Hag, Barber, Snake Charmer, Fang Gu, Goon and Philosopher.
- **Voters recorded** on each nomination (Flowergirl; also helps the recap).
- **Night order** built from the script's id list (official nightsheet or the custom script's `_meta.firstNight/otherNight`).

**Default automation level: "assist".** The app builds the wake, lists legal choices, suggests the true answer where it is computable (Clockmaker distance, Oracle count, Town Crier, Flowergirl), records the outcome and places reminders, but the Storyteller confirms. Madness, "might", and interactions are always the Storyteller's call (also what TPI asks for).

---

## 5. Per-character plan

Effort: S = hours, M = a day, L = several days. Mode: **Assist** = night or day step with suggestions, Storyteller confirms; **Auto** = engine applies; **Manual** = reminders and text only, Storyteller does it.

### Bad Moon Rising

| Character | Mode | New concept | Effort | Risk |
|---|---|---|---|---|
| Grandmother | Assist + Auto death | onDeath: grandchild killed by Demon -> Grandmother dies | M | low |
| Sailor | Assist | Can't die unless drunk; chosen player or self drunk until dusk | M | med (status) |
| Chambermaid | Assist | Count of players who woke due to their ability (from the night's steps) | M | med |
| Innkeeper | Assist | 2 protected, 1 drunk until dusk | M | low |
| Gambler | Assist | Wrong guess -> dies tonight | S | low |
| Exorcist | Assist | Chosen Demon doesn't wake tonight (removes Demon step) | M | med |
| Gossip | Manual truth + Auto kill | Day statement; Storyteller marks true -> a player dies tonight | M | low |
| Courtier | Assist | Drunk for 3 nights and 3 days | M | med |
| Professor | Assist | Resurrection (alive again, ghost vote restored) | M | med |
| Minstrel | Auto | Minion executed -> everyone else drunk until dusk tomorrow | M | low |
| Tea Lady | Auto protection | Good living neighbours can't die | M | med (registration) |
| Fool | Auto protection | First death doesn't happen | S | low |
| Pacifist | Manual | Executed good player might not die (existing "confirm death" choice) | S | low |
| Goon | Assist | First chooser each night drunk; Goon takes their alignment | M | med |
| Lunatic | Assist | Thinks they are the Demon (like the Drunk); fake Demon wake; real Demon told their picks | L | high |
| Tinker | Manual | "Might die at any time": Storyteller kill button | S | low |
| Moonchild | Assist | On death, publicly picks a player; good -> dies tonight | M | low |
| Godfather | Assist | Setup +/-1 Outsider (Storyteller picks); first night learns Outsiders; kills if an Outsider died today | M | med |
| Devil's Advocate | Assist | Chosen player survives execution tomorrow | S | low |
| Assassin | Assist | Once per game kill that ignores protection | M | low |
| Mastermind | Auto win hook | Demon executed -> one more day; that day's execution decides | L | high |
| Zombuul | Assist | Wakes only if nobody died today; first death "registers as dead" but lives; win check | L | high |
| Pukka | Auto | Poison now, previous target dies, poison moves on | M | med |
| Shabaloth | Assist | Two kills; may bring back one of last night's dead | M | med |
| Po | Assist | May skip; next night three kills | M | low |
| Travellers (5) | as today | Already in our JSON | - | - |

### Sects & Violets

| Character | Mode | New concept | Effort | Risk |
|---|---|---|---|---|
| Clockmaker | Assist | Suggest steps from Demon to nearest Minion | S | low |
| Dreamer | Assist | One good + one evil character, one true | S | low |
| Snake Charmer | Assist | Chose the Demon -> swap characters and alignments, old Demon poisoned | L | high |
| Mathematician | Manual + helper | Storyteller counts abnormal results; app lists drunk/poisoned wakes as a hint | M | med |
| Flowergirl | Assist | Did a Demon vote today (needs voter ids) | M | low |
| Town Crier | Assist | Did a Minion nominate today | S | low |
| Oracle | Assist | Number of dead evil players | S | low |
| Savant | Manual | Daily visit, Storyteller gives two statements | S | low |
| Seamstress | Assist | Once per game: same alignment? | S | low |
| Philosopher | Assist | Gains a good character's ability; that character, if in play, is drunk | L | high |
| Artist | Manual | One yes/no question, privately | S | low |
| Juggler | Assist | Day 1 guesses entered; night count suggested | M | low |
| Sage | Assist | Killed by the Demon -> learns 1 of 2 is the Demon | S | low |
| Sweetheart | Assist | On death, one player drunk permanently | S | low |
| Klutz | Assist + win hook | On death picks a player; evil -> good loses | M | med |
| Barber | Assist | Barber died -> Demon may swap two characters tonight | M | med |
| Mutant | Manual | Madness; Storyteller may execute | S | low |
| Witch | Assist | Cursed player dies if they nominate tomorrow (like the Virgin hook) | M | low |
| Cerenovus | Manual | Madness indicator for tomorrow | M | low |
| Pit-Hag | Assist | Change a player's character (not in play); new Demon -> Storyteller decides deaths | L | high |
| Evil Twin | Assist + win hook | Pair know each other; good twin executed -> evil wins; good can't win while both live | M | med |
| Fang Gu | Assist | First Outsider killed becomes an evil Fang Gu, old one dies; +1 Outsider | M | med |
| Vigormortis | Assist | Killed Minions keep their ability and poison a Townsfolk neighbour; -1 Outsider | L | high |
| No Dashii | Auto | Two nearest Townsfolk neighbours poisoned (moves as players die) | M | med |
| Vortox | Auto + win hook | Townsfolk info is false (info suggestions flip); no execution -> evil wins | M | med |
| Travellers (5) | Assist/Manual | Barista, Harlot, Butcher (second execution), Bone Collector, Deviant | M | med |

---

## 6. Script selection and custom scripts

- **Choose in the lobby** (Setup tab): Trouble Brewing, Bad Moon Rising, Sects & Violets, or an imported script. Saved in the session (`scriptId` becomes a string; the script JSON is stored or referenced). Changing script resets characters. The deal, night order, character sheet, TV, recap and narration follow it.
- **Import custom JSON** (paste or file): validate against the official schema; official ids from the three base scripts get full support; Carousel/Experimental and homebrew characters are **text-only "manual"** (on the sheet, in the grimoire, in the night order if the script gives one, with the ability text as the Storyteller prompt). Unknown ids are listed so the Storyteller can fix the script.
- **Jinxes:** shown in the grimoire and the night step when both characters are in play; never auto-applied.

## 7. Audio and narration

- Generic cues stay. TB-only cues (`sacred_blood`, `public_shot*`) simply never fire in other scripts.
- Rules teaching per script: `rules_bmr_*` / `rules_snv_*` chapters with a fallback to the generic chapters (overview, night, day, execution, the dead, etiquette are mostly generic; teams/abilities/win are script-specific). New voice needs ElevenLabs credits; **ask before generating**.
- Possible new public cues: Vortox win ("no one was executed..."), Evil Twin win, Klutz, Gossip, Juggler, Moonchild, Mastermind's extra day. Same safety rule as today: never reveal a character before the end.

## 8. Phases (each ends with tests green, commit, push)

1. **Script plumbing, no behaviour change.** Script registry and loader, `scriptId` as a string, lobby picker (TB only at first), custom JSON import as text-only, nightsheet ordering. Tests: TB night order identical to today for 5-15 players; import of sample scripts (ids, legacy ids, homebrew, `_meta`).
2. **Engine foundations, TB refactor.** Status model, kill pipeline with causes, character-change queue, generic setup modifiers, voter ids; move TB characters into modules one by one. All 193 existing tests must pass unchanged at each step; add tests for the new structures.
3. **Bad Moon Rising** (recommended first: mostly protection, multi-kill and resurrection, which the new kill pipeline covers). Per-character tests plus 3-4 full scripted games.
4. **Sects & Violets** (character changes and madness, which build on phase 3).
5. **Custom scripts with full support for mixed base characters** and jinx display.
6. **Narration** for the chosen scripts (only with approval).

Rough size: phase 1 M, phase 2 L, phase 3 L, phase 4 L, phase 5 M.

## 9. Decisions needed before building

1. **Which script first?** Recommendation: Bad Moon Rising.
2. **Automation level:** "assist" by default (app suggests, Storyteller confirms), or more automatic resolution where it is mechanical (Pukka, No Dashii, Minstrel)?
3. **Custom scripts:** support imports at all? If yes, are Carousel/Experimental characters fine as text-only "manual"?
4. **Icons:** stay text + our team emblems (current), or fetch official icons at runtime into a gitignored cache (never committed)?
5. **Official ability text in the public repo:** TB's text is already committed. Keep doing that for BMR/S&V, or build those from `roles.json` into a gitignored cache at first run?
6. **Repo visibility:** stay public (accepted so far) given TPI's "no distribution of competing tools" line, or make it private?
7. **Travellers:** one shared pool for every script (official rule), or per script?
8. **Madness (S&V):** indicators only, Storyteller judges (recommended)?
9. **Rules narration** for BMR/S&V: record new chapters (cost) or reuse the generic ones and skip the script-specific teach?
10. **Jinxes:** display only (recommended), or also adjust suggestions?

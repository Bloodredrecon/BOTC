# BOTC Companion — Full narration script

## Scene setting (read before recording)

You are not announcing a board game. You are the voice of **Ravenswood Bluff** — the town itself speaking through wind, stone, and dread.

**Place:** A rain-worn town beneath a looming **clocktower**. Cobblestones. Narrow streets. A square where people meet, argue, and sometimes die. Shutters. Oil lamps. Ravens on the ledges. The air smells of wet wood and iron.

**Who “you” are:** Everyone listening is **in** the town. Address them as townsfolk standing in the square, not as players at a table. Prefer *you / we / this town* over *the game / the nomination phase*.

**Tone:** Grim, deliberate, theatrical, heavy with suspense. Low and clear — **natural pace** (do not sound artificially slowed). Stage directions in `[brackets]` are for the voice actor / AI only — **never speak them**.

**Immersion checklist for every public line:**
- Anchor in place (square, streets, tower, dawn mist, shuttered windows)
- Speak as if the moment is happening *now*
- No confirming which roles were dealt this game (see Safety)
- Night ability wakes are handled on the Storyteller phone — not in this script

**Canonical opening image** (matches `intro.mp3`): storm, scream, midnight strike, the Storyteller dead on the clock hands, blood on the cobbles — then the truth that evil walks among you by day.

---

## ElevenLabs: voice vs sound

ElevenLabs can do **both**, but they are **two separate tools** — TTS does not auto-add rain/thunder under speech.

| Tool | Endpoint / product | Use for |
| --- | --- | --- |
| **Text to Speech** | Voice / TTS | Spoken lines (this script’s dialogue) |
| **Sound Effects** | `POST /v1/sound-generation` (`eleven_text_to_sound_v2`) | Ambience beds, hits, stings, loops |

**Workflow per cue:**
1. Generate **voice** from the spoken lines (ignore all `[brackets]`).
2. Generate **Ambience** and/or **SFX** from the `[Ambience …]` / `[SFX …]` prompts (paste the quoted text into Sound Effects).
3. **Layer** in an editor (or play bed under voice on the soundboard): voice on top, ambience quieter underneath, one-shot SFX at the marked moments.

**SFX prompt tips:** duration `0.5–30s`; use `loop: true` for beds; `prompt_influence` ~0.4–0.6 for tighter matches. Suggested durations are in each tag.

**Bracket legend (never speak aloud):**
- `[Tone: …]` — how to perform the voice
- `[Pause …s]` — silence in the voice take
- `[Ambience | loop? | ~Ns]: "…"` — ElevenLabs Sound Effects bed (often looping)
- `[SFX | ~Ns]: "…"` — one-shot hit / sting
- `[Mix: no-sfx]` — voice + ambience only (drop any SFX stings)
- `[Mix: voice-only]` — narration only (no ambience, no SFX)
- `[Mix: quiet-sfx]` — keep SFX but mix much quieter under voice
- `[Fade …]` — mix note

**Filename** = save into `data/audio/` (mp3 or wav). Names that match built-in slots override the placeholders automatically.

---

## Safety rule (read this first)

| Kind | Who hears it | Allowed? |
| --- | --- | --- |
| **Public phase / atmosphere** (A, B, F) | Whole room | **No confirming which roles are in this game.** No who is evil, who woke, private info, bluffs, poison, etc. |
| **Rules teach** (C) | Whole room, before play or mid-lobby | Character **names and printed abilities** OK — that is teaching the script, not revealing the grimoire. Still never say who was dealt what. |

**During a live game, public lines must never reveal:** who woke, who is which alignment, bluffs, red herring, Drunk, poison/safe targets, grimoire contents, “which Outsiders are in play,” etc.

**OK publicly in play:** “evil,” “the town,” “night/day/dawn,” nominations and votes that already happened, timers, that *someone* died (once you’re announcing), folklore about the clocktower. You may say evil exists in the town. You may **not** list or imply which specific roles were dealt.

**Night role wakes** (Demon, Minions, Townsfolk abilities, Travellers) are **not** in this script — use the Storyteller phone Night helper and show info privately.

---

## A. Core phase cues (built-in slots)

### `intro.mp3`
[Tone: Grim, deliberate, theatrical, heavy with suspense. Natural pace. Low pitch.]  
[Ambience | loop | ~20s]: "Heavy rain on cobblestones, howling wind through a gothic town, distant thunder, wet eaves dripping"  
[Pause 1.5s]  
[SFX | ~2s]: "Distant human scream echoing through rain and empty streets"  
During a hellish thunderstorm... a scream echoes through the rain-soaked streets of Ravenswood Bluff.  
[Pause 1.0s]  
[SFX | ~4s]: "Large old clocktower bell striking midnight, deep resonant bronze, long decay"  
The town clock tower strikes midnight...  
[Pause 1.5s]  
[SFX | ~3s]: "Low ominous drone under rain, faint wet drip of blood-like liquid on stone"  
But as the storm clears, you find the local Storyteller impaled upon the clock hands... blood dripping down onto the cold cobblestones below.  
[Pause 1.2s]  
[Tone: Whispered, intense, menacing]  
[Ambience | loop | ~15s]: "Soft rain fading, cold wind, sparse far thunder, uneasy silence in a town square"  
A Demon is among you... taking human form by day... and murderously hunting by night.  
[Pause 1.0s]  
It is up to you to find them... before the town is entirely consumed.  
[Fade out voice into silence; pull ambience down with it]

### `day_bed.mp3` *(ambience only — no voice)*
[Ambience | loop | ~30s]: "Quiet medieval town square by day: distant soft market murmur, far church bell, gentle wind in wet eaves, occasional raven caw, soft footsteps on cobblestones — no music, no voices close"

### `night_bed.mp3` *(ambience only — no voice)*
[Ambience | loop | ~30s]: "Gothic night streets: low dark drone, slow distant clock ticks, light rain on wooden shutters, cold wind, sparse owl-like quiet — no music, no speech"

### `dawn.mp3`
[Tone: Quiet, cold, anticipatory. Soft as mist lifting.]  
[Ambience | loop | ~15s]: "Early dawn mist over cobblestones, soft distant birds, light wind, faint far bell"  
Mist lifts from the cobblestones.  
[Pause 0.8s]  
Dawn touches the clocktower… and the square holds its breath.  
[Pause 1.0s]  
[Tone: Clearer, inviting — still grave]  
[SFX | ~1.5s]: "Soft wooden shutters opening, quiet morning stir"  
Open your eyes, townsfolk. See who still stands among you.

### `nomination.mp3`
[Tone: Formal, weighty — a public summons]  
[Ambience | ~10s]: "Crowd murmur in a stone square, tense hush rising"  
In the square, a name is spoken aloud.  
[Pause 0.8s]  
The town gathers close. A fate hangs in the air.

### `execution.mp3`
[Tone: Solemn, final, measured]  
[Ambience | ~12s]: "Heavy silence in a stone square, low wind, distant crow"  
[SFX | ~2s]: "Deep solemn drum hit, wooden scaffold creak"  
The town has chosen.  
[Pause 1.0s]  
On these stones, judgment will be done… for better or worse.

### `death.mp3`
[Tone: Low, mournful, heavy]  
[Ambience | ~10s]: "Cold empty streets, low mourning drone, light wind"  
[SFX | ~2s]: "Slow deep bell toll, long decay"  
Death walks the streets of Ravenswood Bluff.  
[Pause 0.8s]  
Another shadow falls across the square.

### `timer_end.mp3`
[Tone: Sharp, urgent, clipped — no warmth]  
[SFX | ~3s]: "Single deep bronze clocktower bell from a stone tower, long cathedral echo — not an alarm clock, not a kitchen timer, not a digital beep"  
The clocktower will wait no longer.  
[Pause 0.5s]  
Time… is up.

### `night_wake.mp3` *(private / soft — must clearly mean wake)*
[Tone: Soft but unmistakable — a quiet command to one player]  
[SFX | ~1.5s]: "Soft clear wake chime once, gentle but distinct in darkness — no alarm clock"  
Wake up.

---

## B. Extra phase lines (recommended custom files)

### `first_night.mp3`
[Tone: Hushed, ceremonial — first darkness]  
[Ambience | loop | ~15s]: "Night falling on a gothic town: oil lamps dimming, soft wind rising, distant slow clock ticks — no metal, no latch, no clicking"  
Night one settles over Ravenswood Bluff.  
[Pause 0.8s]  
[SFX | ~2.5s]: "Single heavy wooden shutter closing once with a soft wood thud — no metal bolt, no latch click, no repeating sounds"  
Close your eyes. Bolt your shutters in your mind.  
[Pause 1.0s]  
[Tone: Soft warning]  
What moves in the dark is not for the square to see.

### `night.mp3`
[Tone: Low, settling — lamps dying]  
[Ambience | loop | ~15s]: "Oil lamps guttering out, empty wet streets, low night drone, slow clock ticks"  
[SFX | ~2s]: "Candle flame snuffed, soft hiss"  
Lamps gutter. The streets empty.  
[Pause 0.8s]  
Night claims Ravenswood Bluff once more.  
[Pause 1.0s]  
Close your eyes… and listen only if you are woken.

### `day_1.mp3`
[Tone: Cautious daylight — first morning after]  
[Ambience | loop | ~15s]: "Pale morning light in a town square, soft wind, distant quiet activity, uneasy calm"  
Morning light crawls across the square.  
[Pause 0.8s]  
It is the first day. Look at the faces beside you.  
[Pause 1.0s]  
[Tone: Quiet menace under the calm]  
[SFX | ~2s]: "Low subtle ominous swell under daylight ambience"  
Someone here wears a kindly mask… and hunts when the sun dies.

### `day_2.mp3`
[Tone: Worn, thinner trust]  
[Ambience | ~12s]: "Same square, thinner crowd murmur, colder wind, more silence between sounds"  
A second day. The cobbles still remember yesterday’s fear.  
[Pause 0.8s]  
Trust is thinner now. Speak while the light holds.

### `day_3.mp3`
[Tone: Harder, more desperate]  
[Ambience | ~12s]: "Harsh noon shadow feel: dry wind, sparse footsteps, distant crow"  
[SFX | ~2s]: "Clocktower shadow atmosphere — low tonal whoosh"  
Day three. The tower’s shadow cuts the square in half.  
[Pause 0.8s]  
Every word costs. Every silence costs more.

### `day_n.mp3` *(day 4+)*
[Tone: Weary gravity — late game]  
[Ambience | ~12s]: "Sparse empty town square, few footsteps, cold wind, far bell"  
Another day in Ravenswood Bluff.  
[Pause 0.8s]  
The town is smaller. The stakes are not.  
[Pause 0.8s]  
Choose carefully… while you still can.

### `dusk.mp3`
[Tone: Fading light, firm urgency]  
[Ambience | ~12s]: "Sunset wind, sky darkening, lamps being lit, birds settling"  
[SFX | ~2s]: "Distant lamp lighting, soft flame catch"  
The sun bleeds out behind the rooftops.  
[Pause 0.8s]  
Finish your business in the square. Night does not bargain.

### `no_deaths.mp3`
[Tone: Uneasy relief — almost a whisper of doubt]  
[Ambience | ~12s]: "Quiet morning streets, soft wind, no crowd — strange emptiness"  
Strange quiet on the morning streets…  
[Pause 0.8s]  
No new blood on the cobblestones.  
[Pause 1.0s]  
[Tone: Warning, not comfort]  
[SFX | ~2s]: "Subtle uneasy low tone under quiet streets"  
Do not mistake mercy for safety.

### `someone_died.mp3`
[Tone: Grave announcement — do not rush]  
[Ambience | ~10s]: "Mournful morning wind, distant slow bell"  
[SFX | ~2.5s]: "Single deep funeral bell toll"  
The night did not leave the town untouched.  
[Pause 1.0s]  
Someone is gone from the square.

### `multiple_deaths.mp3`
[Tone: Heavier shock — slower]  
[Ambience | ~12s]: "Emptier streets, colder wind, sparse crow calls"  
[SFX | ~3s]: "Two deep bell tolls, spaced apart"  
The streets are emptier than they should be.  
[Pause 1.0s]  
More than one soul was taken before dawn.

### `vote_open.mp3`
[Tone: Clear, procedural, iron]  
[Ambience | ~8s]: "Tense crowd in a stone square holding breath"  
[SFX | ~1s]: "Sharp wooden gavel-like knock on stone"  
In the square — the vote is open.  
[Pause 0.6s]  
Raise your hand only if you mean yes. The tower is watching.

### `vote_closed.mp3`
[Tone: Final, clipped]  
[SFX | ~1.5s]: "Hands lowering rustle, soft collective exhale"  
Hands fall. The count is done.  
[Pause 0.6s]  
The town has spoken… for now.

### `majority.mp3`
[Tone: Inevitable, cold]  
[Mix: no-sfx]  
[Ambience | ~8s]: "Rising tense murmur then sudden hush"  
Enough hands. Enough will.  
[Pause 0.8s]  
This soul stands at the edge of the square’s judgment.

### `no_majority.mp3`
[Tone: Soft release — still watchful]  
[SFX | ~2s]: "Soft release of held breath from a crowd, uneasy settle"  
The hands are not enough.  
[Pause 0.8s]  
This soul remains among you… for another hour of daylight.

### `tie.mp3`
[Tone: Tense, unresolved]  
The square is split. The count will not decide.  
[Pause 0.8s]  
The Storyteller must weigh what the town cannot.

### `about_to_die.mp3`
[Tone: Intimate dread — almost a whisper]  
[Ambience | ~10s]: "Very close quiet: wind, heartbeat-like low pulse, stone square hush"  
[SFX | ~2s]: "Thin high tension string-like drone swell"  
The town draws close.  
[Pause 1.0s]  
This life hangs by a thread above the cobblestones.

### `lives.mp3`
[Tone: Exhale of relief — still unsettled]  
[SFX | ~2s]: "Soft relieved crowd murmur, still nervous undertone"  
The thread holds.  
[Pause 0.8s]  
This soul walks back into the crowd… for now.

### `good_wins.mp3`
[Tone: Brightening, earned — still theatrical]  
[Ambience | ~15s]: "Morning clearing after storm: soft birds, clean wind, distant hopeful bell"  
The shadow breaks. Morning feels clean for the first time.  
[Pause 1.0s]  
Evil is gone from Ravenswood Bluff.  
[Pause 0.8s]  
Sing in the square… while you can.  
[Fade out gently]

### `evil_wins.mp3`
[Tone: Dark triumph, soft and cruel]  
[Ambience | loop | ~15s]: "Thick night settling into alleys, cold wind, distant thunder, doors bolting"  
[SFX | ~3s]: "Dark low brass-like doom hit, then silence"  
Night keeps what it came for.  
[Pause 1.0s]  
Ravenswood Bluff belongs to the dark now.  
[Pause 0.8s]  
[Tone: Whispered]  
[SFX | ~2s]: "Heavy wooden door bar sliding shut, latch"  
Bar your doors. It will not save you.  
[Fade out into silence]

### `reveal.mp3`
[Tone: Ceremonial reveal — clear and slow]  
[Ambience | ~12s]: "Dramatic hush in a square, soft wind, expectant silence"  
[SFX | ~2s]: "Mask-like ceramic crack, soft reveal swell"  
The masks fall in the square.  
[Pause 1.0s]  
Look well — see who walked your streets beside you.

### `guest_arrive.mp3`
[Tone: Curious, watchful — footsteps approaching]  
[SFX | ~3s]: "Boots on wet cobblestones approaching, soft travel bag creak"  
Footsteps on the wet road.  
[Pause 0.8s]  
A stranger enters Ravenswood Bluff. The town takes notice.

### `guest_depart.mp3`
[Tone: Quiet farewell — slightly hollow]  
[SFX | ~3s]: "Boots on wet road walking away into distance, wind"  
A stranger’s road turns away.  
[Pause 0.8s]  
One less face in the square… one less unknown.

### `public_shot.mp3`
[Tone: Sudden crack — sharp intake before the line]  
[Pause 0.3s]  
[SFX | ~2s]: "Loud gunshot crack echoing in a stone town square"  
A shot cracks across the square —  
[Pause 0.6s]  
[SFX | ~2.5s]: "Flock of ravens exploding off a clocktower in a black cloud of wingbeats"  
birds lift from the clocktower in a black cloud.

### `public_shot_true.mp3`
[Tone: Shock, then grim confirmation]  
[SFX | ~2s]: "Impact thud, shocked crowd gasp"  
The shot finds what it sought.  
[Pause 0.8s]  
Evil staggers… and the town gasps as one.

### `public_shot_false.mp3`
[Tone: Hollow echo — fear returns]  
[SFX | ~2.5s]: "Gunshot echo dying into empty streets, fearful crowd murmur rising"  
Echoes only. No evil falls.  
[Pause 0.8s]  
Fear rushes back into the square twice as deep.

### `sacred_blood.mp3`
[Tone: Horror, doom — slow and final]  
[Ambience | ~12s]: "Horror stillness, cold wind, distant thunder"  
[SFX | ~3s]: "Wet blood drip on stone, then deep doom hit"  
Innocent blood — sacred blood — stains the cobblestones.  
[Pause 1.2s]  
The town has damned itself. Evil claims the night… and the win.  
[Fade out]

### `three_stand.mp3`
[Tone: Strained hope — quiet triumph]  
[Ambience | ~12s]: "Sparse wind, three faint footsteps, fragile morning light feel"  
[SFX | ~2s]: "Quiet hopeful swell, soft far bell"  
Only three still stand in the square. No execution comes.  
[Pause 1.0s]  
Against all odds… the town endures. Good holds the day.

---

## C. Rules — full teach (Trouble Brewing)

Play these in the lobby / square **before** characters are secret, or when teaching newcomers. You may name characters and printed abilities here — that is the **script**, not this game’s grimoire. Never say who was dealt which role.

Use modular files, or record `rules_full.mp3` as one continuous take by reading C in order.

### `rules_overview.mp3`
[Tone: Clear teacher, still in-world — grave welcome]  
[Ambience | loop | ~20s]: "Quiet town square gathering, soft wind under a clocktower, attentive hush"  
Listen well, people of Ravenswood Bluff.  
[Pause 0.8s]  
You are about to live — and perhaps die — by these rules.  
[Pause 1.0s]  
Most of you are good. You want the Demon found and destroyed.  
[Pause 0.6s]  
A few of you are evil. You want the town thinned until only two souls still stand…  
and then the night wins.  
[Pause 1.0s]  
I am the Storyteller. I keep the secrets. I enforce the law of this town.  
[Pause 0.8s]  
What I say in the open is for everyone. What I show you alone… is for your eyes only.

### `rules_teams.mp3`
[Tone: Structured, clear — still atmospheric]  
[Ambience | ~15s]: "Soft square ambience, distant bell, attentive quiet"  
There are four kinds of soul in Trouble Brewing.  
[Pause 0.8s]  
Townsfolk — good. Most of the town. Many wake at night to learn something true… or almost true.  
[Pause 0.8s]  
Outsiders — also good… but their abilities hurt the town, or twist it. They are still on your side.  
[Pause 0.8s]  
Minions — evil. They know who the Demon is. They lie for it. They may poison, spy, or worse.  
[Pause 0.8s]  
The Demon — evil. By day it wears a human face. By night it chooses who dies.  
[Pause 1.0s]  
[Tone: Emphatic]  
If the Demon dies, good wins.  
If only two living players remain, and the Demon still lives… evil wins.  
[Pause 0.8s]  
There are other ways to lose — listen for them when we speak of the Saint… and of sacred blood.

### `rules_setup.mp3`
[Tone: Practical ceremony]  
[Ambience | ~12s]: "Quiet dealing atmosphere, soft paper/tokens feel, square hush"  
Before the first night, each of you receives one character.  
[Pause 0.8s]  
That token is secret. Do not show it. Do not name it aloud unless you choose to bluff… or tell the truth.  
[Pause 1.0s]  
Evil will lie. Good may lie too — but the town dies faster when good lies without cause.  
[Pause 0.8s]  
Look at the character sheet — every ability that *might* be in this town is printed there.  
[Pause 0.6s]  
Not every character is in every game. You will not be told the full list of who was dealt.  
[Pause 0.8s]  
That uncertainty… is the fog of Ravenswood Bluff.

### `rules_night.mp3`
[Tone: Hushed instruction — night law]  
[Ambience | ~15s]: "Night settling: lamps, wind, slow clock — instructional not scary-loud"  
When night falls, close your eyes.  
[Pause 0.8s]  
I will wake players in secret. If I wake you, open your eyes only when told… listen… choose if asked… then sleep again.  
[Pause 1.0s]  
Do not peek. Do not signal. The town that cheats the dark invites ruin.  
[Pause 0.8s]  
On the first night, evil learns who is who. Some good souls receive their first whispers.  
[Pause 0.8s]  
On later nights, the Demon usually kills. Other abilities may fire — protection, poison, prophecy, and more.  
[Pause 1.0s]  
You will not hear those names spoken to the whole square.  
Private truth stays private… until dawn makes death public.

### `rules_day.mp3`
[Tone: Open square — discussion law]  
[Ambience | ~15s]: "Daytime square murmur under narration, soft footsteps"  
At dawn, open your eyes. I will say who died in the night — if anyone.  
[Pause 0.8s]  
Then the day is yours. Talk. Accuse. Defend. Share what you learned… or what you pretend you learned.  
[Pause 1.0s]  
You may nominate a player for execution.  
[Pause 0.6s]  
A nomination needs a second, by the customs of this table — follow the Storyteller’s call.  
[Pause 0.8s]  
Then we vote. Living players raise a hand for yes.  
[Pause 0.6s]  
Dead players may vote… but only once per game. Spend that ghost vote wisely.  
[Pause 1.0s]  
If the yes votes reach a majority of living players, that soul is about to die.  
[Pause 0.6s]  
If not, they live — for now.  
[Pause 0.8s]  
Ties and special cases fall to the Storyteller’s judgment, by the printed rules.

### `rules_execution.mp3`
[Tone: Solemn, precise]  
[Ambience | ~12s]: "Solemn square hush, low wind"  
[SFX | ~2s]: "Soft scaffold wood creak under narration"  
An execution is a public death. The town chose it.  
[Pause 0.8s]  
Usually at most one execution per day. If nobody reaches majority, nobody dies to the square.  
[Pause 1.0s]  
When only three living players remain… there is no execution. The town must survive the night instead.  
[Pause 0.8s]  
Remember: executing good souls thins your numbers… and may hand the game to evil.

### `rules_death.mp3`
[Tone: Clear on dead-player rights]  
[Ambience | ~12s]: "Cold quiet among living and dead in a square"  
The dead still stand among you.  
[Pause 0.8s]  
They may speak freely. They may argue. They may guide the living.  
[Pause 0.8s]  
They do not nominate. They vote only with that single ghost vote — once.  
[Pause 1.0s]  
Death ends your ability… unless your character says otherwise.  
[Pause 0.6s]  
Read your token. The sheet is law.

### `rules_abilities.mp3`
[Tone: Teacher walking the script — unhurried]  
[Ambience | loop | ~25s]: "Attentive square, soft wind, distant tower — long teach bed"  
Trouble Brewing abilities live on the character sheet. Glance there as I speak.  
[Pause 1.0s]  
Good information — some Townsfolk learn facts at night: neighbors, pairs of evil, who might be a Minion or Outsider, who died on the block.  
Truth can be twisted by poison… or by the Drunk… or by evil that registers as something it is not.  
[Pause 1.0s]  
Day powers — a Virgin may doom the wrong nominator. A Slayer may take one shot at who they believe is the Demon. A Mayor may break ties of a sort, by their text. A Soldier may survive the Demon’s kill.  
[Pause 1.0s]  
Outsiders — the Butler needs a Master to vote with. The Drunk thinks they are a Townsfolk and are wrong. The Recluse may register as evil. The Saint… if executed by the town… loses the game for good.  
[Pause 1.0s]  
Minions — the Poisoner blights a player each night. The Spy may see the grimoire. The Scarlet Woman may become the Demon if the Demon dies with enough alive. The Baron swells the Outsider count.  
[Pause 1.0s]  
The Imp — the Demon of this script. Each night it kills. If it kills itself… a Minion may inherit the curse, by the rules.  
[Pause 1.0s]  
I will not recite every line of every token here. Hold the sheet. When in doubt, ask the Storyteller — in the open for rules… in private for your fate.

### `rules_win.mp3`
[Tone: Final stakes — clear and memorable]  
[Ambience | ~12s]: "Dramatic hush, soft far thunder or wind"  
How the town ends:  
[Pause 0.8s]  
Good wins when the Demon is dead.  
[Pause 0.8s]  
Evil wins when only two players still live… and the Demon is among them.  
[Pause 0.8s]  
Evil also wins if the town executes the Saint.  
[Pause 0.8s]  
Other rare endings follow the printed text — the Storyteller will declare them when they happen.  
[Pause 1.0s]  
Trust carefully. Vote carefully. Sleep carefully.  
[Pause 0.8s]  
The clocktower is watching.

### `rules_travellers.mp3`
[Tone: Brief addendum — curious]  
[Ambience | ~10s]: "Footsteps on wet road, square noticing a stranger"  
Sometimes strangers walk the wet road into Ravenswood Bluff — Travellers.  
[Pause 0.8s]  
They may join or leave mid-story. They have their own tokens and abilities.  
[Pause 0.8s]  
They count for votes and for living numbers as the Storyteller explains when they arrive.  
[Pause 0.6s]  
Treat them as part of the town’s weather… until you know which way the wind blows.

### `rules_etiquette.mp3`
[Tone: Firm, fair, in-world]  
[Ambience | ~10s]: "Quiet authority, square stillness"  
Eyes closed means eyes closed.  
[Pause 0.6s]  
Phones down when asked. No secret texts that break the fiction.  
[Pause 0.8s]  
Do not touch the grimoire. Do not haunt the Storyteller’s shoulder.  
[Pause 0.8s]  
Argue hard. Play hard. When the game ends… leave the blood on the cobblestones — not on each other.  
[Pause 1.0s]  
Questions on rules may be asked aloud. Questions on your private info… wait for a quiet night.

### `rules_full.mp3` *(optional single file — concatenate C in order)*
[Tone: Same voice throughout; natural pace; leave the pauses]  
[Ambience | loop | ~30s]: "Long form town-square teach: soft wind, distant bell, attentive hush under full rules narration"  
[Record by reading, in order: overview → teams → setup → night → day → execution → death → abilities → win → travellers → etiquette.  
Or stitch the modular files. Do not invent new rules mid-take.]

---

## D. Delivery tips for AI voice + sound tools

1. **Voice (TTS)** and **Ambience/SFX (Sound Effects)** are separate ElevenLabs products — generate both, then layer.
2. **One voice file per block** above. Export beds (`day_bed`, `night_bed`) as pure loopable Sound Effects with `loop: true`.
3. Keep **night_wake** short — spoken “Wake up.” plus a soft chime (private / lean-in use).
4. Loudness: beds ~−18 to −24 LUFS under voice; one-shot SFX can peak briefly louder; normalize so Nomination isn’t quieter than Death.
5. **Never speak the `[brackets]`** — Tone / Pause / Ambience / SFX / Fade are performance & mix notes only.
6. Paste the quoted text inside `[Ambience …]: "…"` or `[SFX …]: "…"` straight into ElevenLabs Sound Effects.
7. Drop finished files into `data/audio/`, then Storyteller → **Sound** → **Rescan audio folder**.
8. **Rules** (`rules_*.mp3`) are lobby/teach files — fine on Speakers/TV. Night ability wakes stay on the Storyteller phone only.

---

## E. Minimum pack (if you only record ~15 lines)

Priority order:

1. `intro.mp3` (voice + layered storm/scream/bell)  
2. `day_bed.mp3` / `night_bed.mp3` (Sound Effects loops)  
3. `rules_overview.mp3` + `rules_teams.mp3` + `rules_day.mp3` + `rules_win.mp3` (or one `rules_full.mp3`)  
4. `first_night.mp3` / `night.mp3` / `dusk.mp3`  
5. `dawn.mp3`  
6. `day_1.mp3` (and `day_n.mp3`)  
7. `nomination.mp3`  
8. `vote_open.mp3` / `timer_end.mp3`  
9. `majority.mp3` / `about_to_die.mp3` / `execution.mp3`  
10. `death.mp3` / `no_deaths.mp3`  
11. `good_wins.mp3` / `evil_wins.mp3`  

Public atmosphere pack (F) + public stings in B are safe for Speakers/TV.

---

## F. Public atmosphere lines (safe for the whole room)

Fire these while eyes are open. You are **in** the square / streets. **No secrets.** Short takes for the Soundboard.

### Lobby / seating

### `atm_gather.mp3`
[Tone: Welcoming but grim — usher them in]  
[Ambience | ~12s]: "Wet road, light rain, footsteps gathering under a clocktower, soft crowd"  
Come in from the wet road.  
[Pause 0.8s]  
Stand beneath the clocktower. Find your place in the square —  
[Pause 0.6s]  
the night is not finished with this town.

### `atm_rules_quiet.mp3`
[Tone: Soft authority — almost a hush]  
[SFX | ~2s]: "Crowd falling silent, single raven caw, wind"  
When the Storyteller calls for silence in these streets…  
[Pause 0.8s]  
the wise hold their tongues. Even the ravens listen.

### `atm_begin.mp3`
[Tone: Opening the night — measured dread]  
[Ambience | ~12s]: "Town square filling, faces turning, tense low murmur"  
The square fills. Faces turn.  
[Pause 0.8s]  
Look around you — really look.  
[Pause 1.0s]  
[Tone: Quiet menace]  
[SFX | ~2s]: "Subtle dark undercurrent swell"  
Tonight, kindness may be a costume.

---

### Day — general tension

### `atm_day_watch.mp3`
[Tone: Observant, lofty — the tower speaking]  
[Ambience | ~10s]: "Wind high on stone tower, distant square below"  
[SFX | ~2s]: "Slow clock mechanism tick from above"  
High above the square, the clocktower watches.  
[Pause 0.8s]  
Every word you speak rises to those stone ears.

### `atm_day_doubt.mp3`
[Tone: Cold, careful]  
Doubt moves through the crowd like a cold draft.  
[Pause 0.8s]  
Pass it carefully… or it cuts the wrong throat.

### `atm_day_neighbors.mp3`
[Tone: False warmth turning dark]  
[Ambience | ~10s]: "Morning light square, polite soft chatter turning uneasy"  
Your neighbors smile in the morning light.  
[Pause 0.8s]  
On these cobblestones, that is often how the dark begins.

### `atm_day_lies.mp3`
[Tone: Knowing, dry]  
[SFX | ~2s]: "Subtle dissonant tone under daylight"  
Lies walk this square in broad daylight.  
[Pause 0.8s]  
Listen for the tremor… not the smile.

### `atm_day_time.mp3`
[Tone: Urgent without shouting]  
[SFX | ~2s]: "Sun-slant wind, distant clock advancing"  
The sun slides behind the rooftops whether you are ready or not.  
[Pause 0.8s]  
Ravenswood Bluff does not pause for certainty.

### `atm_day_quiet.mp3`
[Tone: Near-whisper]  
[SFX | ~2s]: "Sudden hush, birds going silent"  
A hush falls over the square.  
[Pause 0.8s]  
Even the birds refuse to sing too loudly here.

### `atm_day_accuse.mp3`
[Tone: Smoky tension]  
[Ambience | ~10s]: "Tense crowd, wet wood smoke feel, restless feet"  
Accusation hangs above the crowd like smoke from wet wood.  
[Pause 0.8s]  
Someone will choke on it before dusk.

### `atm_day_defend.mp3`
[Tone: Wary, remembering]  
[SFX | ~2s]: "Wooden shutters rattling in wind"  
Stories shift like shutters in the wind.  
[Pause 0.8s]  
Remember what was said in this square… and what was swallowed.

### `atm_day_dead_listen.mp3`
[Tone: Respectful, slight chill]  
[Ambience | ~10s]: "Cold quiet among a mixed living-and-still crowd"  
The dead still stand among the living.  
[Pause 0.8s]  
They hear every whisper. They may raise a hand — once. Choose when.

### `atm_day_final_hours.mp3`
[Tone: Thin ice — late day]  
[Ambience | ~10s]: "Fewer footsteps on cobbles, thin wind, sparse town"  
Fewer footsteps on the cobbles now.  
[Pause 0.8s]  
One wrong word in this square ends everything.

### `atm_day_three_live.mp3`
[Tone: Edge-of-cliff intensity]  
[Ambience | ~10s]: "Almost empty square, cliff-edge wind, three faint footsteps"  
So few faces left in the morning light.  
[Pause 0.8s]  
Every choice is a cliff at the edge of town.

---

### Approaching night

### `atm_dusk_warning.mp3`
[Tone: Firm dusk urgency]  
[Ambience | ~10s]: "Lamps lighting along lanes, dusk wind, birds settling"  
[SFX | ~2s]: "Match strike and oil lamp catch"  
Lamps are lit along the lanes.  
[Pause 0.8s]  
Finish your business. Night does not forgive hesitation.

### `atm_eyes_closing.mp3`
[Tone: Soft command to the square]  
[Ambience | ~10s]: "Night streets awakening: soft darkness, distant danger drone"  
Townsfolk — prepare to close your eyes.  
[Pause 1.0s]  
What walks these streets in the dark is not for the square to witness.

### `atm_sleep.mp3`
[Tone: Lullaby edged with threat]  
[Ambience | ~12s]: "Soft night cradle: wind, far clock, uneasy lull"  
Sleep, Ravenswood Bluff.  
[Pause 0.8s]  
Dream of daylight… if you can.  
[Fade softer]

---

### Dawn (before you name the dead)

### `atm_dawn_dread.mp3`
[Tone: Cold morning dread]  
[Ambience | ~12s]: "Cold dawn mist on stones, sparse bird, empty spaces feel"  
Cold morning. Mist on the stones.  
[Pause 0.8s]  
Count the faces you know… and the empty places where faces should be.

### `atm_dawn_waiting.mp3`
[Tone: Held breath]  
[SFX | ~2s]: "Held crowd breath, soft wind, tension tick"  
The square holds its breath.  
[Pause 1.0s]  
Who still stands where the night left them?

### `atm_dawn_empty.mp3`
[Tone: Uneasy mercy]  
[Ambience | ~12s]: "Quiet clean cobblestones, strange calm, smiling-door unease"  
No new blood on the cobblestones…  
[Pause 0.8s]  
strange mercy, or cruel patience.  
[Pause 1.0s]  
[Tone: Warning]  
[SFX | ~2s]: "Soft door creak behind a smile, distant threat"  
Evil still breathes somewhere behind a smiling door.

### `atm_dawn_loss.mp3`
[Tone: Grief, then steel]  
[SFX | ~2.5s]: "Soft mourning wind, single quiet sob-like breath, then harden"  
Grief takes a seat in the square.  
[Pause 0.8s]  
Mourn quickly. The night will not wait for tears.

---

### Nominations & votes

### `atm_nominate_tension.mp3`
[Tone: Ringing tension]  
[SFX | ~2s]: "Name echoing off stone tower walls, tense ring"  
A name rings off the tower stones.  
[Pause 0.8s]  
Will the town feed that name to judgment… or let it fall?

### `atm_hands_ready.mp3`
[Tone: Procedural iron]  
[SFX | ~2s]: "Cold air, fabric rustle of hands rising ready"  
Ready your hands in the cold air.  
[Pause 0.6s]  
A raised palm may end a life on these stones.

### `atm_count_rising.mp3`
[Tone: Rising dread — slightly faster]  
Hands rise like a dark tide in the square.  
[Pause 0.6s]  
Majority gathers… sharp as a blade.

### `atm_count_falling.mp3`
[Tone: Falling short — ambiguous]  
Hands fall short of the mark.  
[Pause 0.8s]  
Mercy… or a mistake the town will pay for after dark?

### `atm_last_chance.mp3`
[Tone: Final plea energy — still controlled]  
Last chance to change a mind beneath the tower.  
[Pause 0.8s]  
After this, the clock will not turn back.

### `atm_silence_for_vote.mp3`
[Tone: Near-whisper command]  
[SFX | ~2s]: "Absolute hush falling over a stone square"  
Silence in the square.  
[Pause 0.8s]  
Let the town be heard only in the raising of hands.

---

### Execution atmosphere

### `atm_gallows.mp3`
[Tone: Solemn procession]  
[Ambience | ~12s]: "Crowd parting on cobbles, solemn wind, distant crow"  
[SFX | ~2s]: "Wooden scaffold creak"  
The crowd parts on the cobblestones.  
[Pause 1.0s]  
The town has chosen a path that only goes one way.

### `atm_final_words.mp3`
[Tone: Soft invitation — grave]  
[Ambience | ~10s]: "Listening silence, clocktower presence, soft wind"  
If there are final words… speak them to the square.  
[Pause 0.8s]  
The clocktower is listening.

### `atm_after_death.mp3`
[Tone: Mourning, unflinching]  
[SFX | ~3s]: "Life ending thud softened, mourning wind, stone memory drone"  
A life ends where you stand.  
[Pause 1.0s]  
Do not look away. The stones will remember even if you will not.

### `atm_survived.mp3`
[Tone: Relief with sour aftertaste]  
The judgment passes over.  
[Pause 0.8s]  
Relief shouts. Guilt whispers. Notice both in the faces around you.

---

### Mid-game color

### `atm_clocktower.mp3`
[Tone: Folklore narrator — slow]  
[Ambience | ~12s]: "Tower shadow crawling: slow tonal whoosh, stone, wind"  
The tower’s shadow crawls across the square.  
[Pause 0.8s]  
It has watched this play before… and it never looks away.

### `atm_ravens.mp3`
[Tone: Dark amusement]  
[SFX | ~3s]: "Ravens circling a spire, wingbeats and harsh caws"  
Ravens circle the spire.  
[Pause 0.8s]  
They already know how these streets end. You do not.

### `atm_fog.mp3`
[Tone: Soft, disorienting]  
[Ambience | ~12s]: "Thick fog between houses, muffled footsteps, disorienting hush"  
Fog slides between the houses.  
[Pause 0.8s]  
In fog, friend and foe wear the same coat.

### `atm_bell.mp3`
[Tone: Distant, marking time]  
[SFX | ~3s]: "Single distant clocktower bell, long decay"  
A bell from the tower.  
[Pause 0.8s]  
Another hour closer to ruin… or to morning.

### `atm_blood_remember.mp3`
[Tone: Heavy memory]  
[SFX | ~2.5s]: "Wet memory of blood on stone, low remembering drone"  
Blood remembers these cobblestones.  
[Pause 0.8s]  
The town remembers louder.

### `atm_whisper.mp3`
[Tone: Conspiratorial hush]  
[Ambience | ~10s]: "Doorway whispers, alley wind, soft conspiratorial murmur (no intelligible words)"  
Whispers breed in doorways and alley mouths.  
[Pause 0.8s]  
Some are warnings. Some are knives wrapped in kindness.

### `atm_trust.mp3`
[Tone: Cautionary, intimate]  
[SFX | ~2s]: "Single coin spin on stone, then stop"  
Trust is the dearest coin in Ravenswood Bluff.  
[Pause 0.8s]  
Spend it once… and pray it was not counterfeit.

### `atm_evil_walks.mp3`
[Tone: Menacing daylight]  
[Ambience | ~12s]: "Daylight square with sinister undertone drone under normal town sounds"  
Evil walks these streets in daylight.  
[Pause 0.8s]  
It laughs at your gatherings. It stands in your circle. It votes beside you.

### `atm_good_hope.mp3`
[Tone: Quiet steel — hope without softness]  
[SFX | ~2.5s]: "Quiet steel resolve swell, soft hopeful far light"  
And still — good endures in stubborn hearts.  
[Pause 0.8s]  
If this town stands together, the night can break.

### `atm_guest.mp3`
[Tone: Curious, unsettled]  
[SFX | ~3s]: "New boots on wet road entering town square"  
New boots on the wet road.  
[Pause 0.8s]  
A stranger’s face in the square changes the weather of a town… for better or worse.

---

### Endgame

### `atm_before_reveal.mp3`
[Tone: Held before the drop]  
[Ambience | ~12s]: "Held silence before reveal, soft morning light, expectant wind"  
Before the truth: one last look at the faces you trusted in this square.  
[Pause 1.0s]  
[SFX | ~2s]: "Mask crack starting, ceramic stress"  
Some masks are about to crack against the morning light.

### `atm_after_good.mp3`
[Tone: Soft triumph — airy]  
[Ambience | ~15s]: "Shadow lifting from rooftops, clean morning air, soft birds"  
The shadow lifts from the rooftops.  
[Pause 0.8s]  
Ravenswood Bluff lives. Breathe the clean air… while it lasts.  
[Fade gentle]

### `atm_after_evil.mp3`
[Tone: Soft doom]  
[Ambience | ~15s]: "Darkness settling into every lane, cold wind, distant thunder"  
Darkness settles into every lane.  
[Pause 0.8s]  
[Tone: Whisper]  
[SFX | ~2s]: "Door locks clicking, bar sliding — futile safety"  
Lock your doors. It will not help… but lock them anyway.  
[Fade to silence]

---

### Stingers (≤2 seconds)

### `atm_sting_tension.mp3`
[Tone: Single word or wordless. Under 2s.]  
[SFX | ~1.5s]: "Low tension hit / soft dread pulse"  
Careful.

### `atm_sting_doom.mp3`
[Tone: Wordless or one short phrase. Under 2s.]  
[SFX | ~1.5s]: "Single heavy clock tick with doom overtone"  
The clock ticks.

### `atm_sting_hope.mp3`
[Tone: Soft resolve. Under 2s.]  
[SFX | ~1.5s]: "Soft hopeful chime swell"  
Hold fast.

### `atm_sting_shock.mp3`
[SFX | ~1.5s]: "Sharp shock hit / gasp punch — no speech, no names. Under 2s."

---

## G. Interchangeable variant takes (repetitive cues)

Same moments as A/B — **different wording**. Automated events randomly pick among the base file and lettered siblings (`_b`, `_c`, `_d`) via `pickSound` / `expandSoundVariants`. Do **not** overwrite the original takes; only add these files.

### `dawn_b.mp3`
[Tone: Quiet, cold, anticipatory]  
[Ambience | loop | ~12s]: "Early dawn mist over cobblestones, soft distant birds, light wind"  
Grey light finds the shutters.  
[Pause 0.8s]  
Dawn returns to Ravenswood Bluff.  
[Pause 0.8s]  
[Tone: Clearer, inviting — still grave]  
Open your eyes. Count who still stands in the square.

### `dawn_c.mp3`
[Tone: Soft as mist — then firmer]  
[Ambience | loop | ~12s]: "Dawn mist lifting, faint far bell, quiet cobblestones"  
[SFX | ~1.5s]: "Soft wooden shutters opening"  
The mist thins. The tower’s face catches the first pale gold.  
[Pause 0.8s]  
Townsfolk — wake. See what the night left behind.

### `night_b.mp3`
[Tone: Low, settling]  
[Ambience | loop | ~12s]: "Oil lamps guttering, empty wet streets, low night drone"  
[SFX | ~2s]: "Candle flame snuffed, soft hiss"  
The last lamps die in the lanes.  
[Pause 0.8s]  
Night folds over the town again.  
[Pause 0.8s]  
Close your eyes. Speak only if you are called.

### `night_c.mp3`
[Tone: Hushed command]  
[Ambience | loop | ~12s]: "Cold wind in shutters, slow clock ticks, dark streets"  
Darkness claims the cobblestones.  
[Pause 0.8s]  
Bolt the night behind your eyelids.  
[Pause 0.8s]  
What walks now is not for the square to witness.

### `dusk_b.mp3`
[Tone: Fading light, firm]  
[Ambience | ~10s]: "Sunset wind, lamps being lit, birds settling"  
The light drains from the rooftops.  
[Pause 0.8s]  
Finish what you must. Night is already at the edge of town.

### `dusk_c.mp3`
[Tone: Urgent but measured]  
[Ambience | ~10s]: "Sky darkening, soft flame catches, settling hush"  
[SFX | ~1.5s]: "Distant lamp lighting, soft flame"  
Day loosens its grip.  
[Pause 0.8s]  
Speak your last daylight words… before the shutters close.

### `first_night_b.mp3`
[Tone: Hushed, ceremonial]  
[Ambience | loop | ~12s]: "Night falling, oil lamps dimming, soft wind, distant slow clock ticks"  
[SFX | ~2s]: "Single heavy wooden shutter closing with a soft wood thud"  
The first night descends on Ravenswood Bluff.  
[Pause 0.8s]  
Close your eyes. This darkness is new… and it is hungry.

### `first_night_c.mp3`
[Tone: Soft warning]  
[Ambience | loop | ~12s]: "Gothic night settling, wind rising, sparse clock ticks"  
Night one. The square empties.  
[Pause 0.8s]  
What begins in the dark will shape every dawn that follows.  
[Pause 0.8s]  
Sleep — until you are woken.

### `nomination_b.mp3`
[Tone: Formal, weighty]  
[Ambience | ~8s]: "Crowd murmur in a stone square, tense hush"  
A name rings out across the cobblestones.  
[Pause 0.8s]  
The town leans in. Judgment waits in the air.

### `nomination_c.mp3`
[Tone: Public summons]  
[Ambience | ~8s]: "Tense town square hush rising"  
Someone has been called to answer.  
[Pause 0.8s]  
Gather close. The square will decide a fate.

### `vote_open_b.mp3`
[Tone: Clear, iron]  
[Ambience | ~8s]: "Tense crowd holding breath in a stone square"  
[SFX | ~1s]: "Sharp wooden knock on stone"  
Hands ready. The vote begins.  
[Pause 0.6s]  
Raise only if you mean yes.

### `vote_open_c.mp3`
[Tone: Procedural, clipped]  
[Ambience | ~8s]: "Held breath in a gothic town square"  
The count is open.  
[Pause 0.6s]  
Show your will. The tower watches every hand.

### `vote_closed_b.mp3`
[Tone: Final, clipped]  
[SFX | ~1.5s]: "Hands lowering rustle, soft collective exhale"  
Hands down. The tally is sealed.  
[Pause 0.6s]  
What the town chose cannot be unspoken.

### `vote_closed_c.mp3`
[Tone: Measured close]  
The vote is closed.  
[Pause 0.6s]  
Listen for what the count will demand.

### `majority_b.mp3`
[Tone: Inevitable, cold]  
[Mix: no-sfx]  
[Ambience | ~8s]: "Rising murmur then sudden hush"  
The hands are enough.  
[Pause 0.8s]  
This soul stands beneath the square’s judgment.

### `majority_c.mp3`
[Tone: Cold certainty]  
[Mix: no-sfx]  
[Ambience | ~8s]: "Crowd hush after a decisive count"  
Majority. The town has spoken with one hard voice.  
[Pause 0.8s]  
Bring them to the edge of the stones.

### `no_majority_b.mp3`
[Tone: Soft release — watchful]  
[SFX | ~2s]: "Soft release of held breath, uneasy settle"  
Not enough hands.  
[Pause 0.8s]  
They walk free… for now. Daylight still burns.

### `no_majority_c.mp3`
[Tone: Measured denial]  
The count falls short.  
[Pause 0.8s]  
No judgment falls. Return to the square’s arguments.

### `tie_b.mp3`
[Tone: Tense, unresolved]  
The hands divide the town.  
[Pause 0.8s]  
Neither path wins. The Storyteller must break what the count cannot.

### `tie_c.mp3`
[Tone: Tight, unsettled]  
Equal will. Equal weight.  
[Pause 0.8s]  
The square is split — and someone must decide.

### `about_to_die_b.mp3`
[Tone: Intimate dread]  
[Ambience | ~8s]: "Close quiet wind, stone square hush"  
[SFX | ~2s]: "Thin high tension drone"  
Breath holds in every throat.  
[Pause 0.8s]  
This life hangs above the cobblestones by a thread.

### `about_to_die_c.mp3`
[Tone: Almost a whisper]  
[Ambience | ~8s]: "Heartbeat-like low pulse under square silence"  
The town draws tight around one soul.  
[Pause 0.8s]  
Judgment is a breath away.

### `lives_b.mp3`
[Tone: Relief — still unsettled]  
[Mix: no-sfx]  
The thread does not snap.  
[Pause 0.8s]  
They rejoin the crowd… alive, for another hour.

### `lives_c.mp3`
[Tone: Quiet reprieve]  
Mercy — or hesitation — holds.  
[Pause 0.8s]  
This soul remains among you. Do not waste the daylight.

### `execution_b.mp3`
[Tone: Solemn, final]  
[Ambience | ~10s]: "Heavy silence in a stone square, low wind"  
[SFX | ~2s]: "Deep solemn drum hit"  
The town has chosen its price.  
[Pause 0.8s]  
On these stones, the sentence will be carried out.

### `execution_c.mp3`
[Tone: Measured, grave]  
[Ambience | ~10s]: "Cold square silence, distant crow"  
[SFX | ~2s]: "Wooden scaffold creak"  
Judgment steps forward.  
[Pause 0.8s]  
What follows cannot be taken back.

### `death_b.mp3`
[Tone: Low, mournful]  
[Ambience | ~8s]: "Cold empty streets, light wind"  
[SFX | ~2s]: "Slow deep bell toll"  
Another life leaves the square.  
[Pause 0.8s]  
Ravenswood Bluff grows quieter.

### `death_c.mp3`
[Tone: Heavy, slow]  
[Ambience | ~8s]: "Mourning wind through empty lanes"  
[SFX | ~2s]: "Deep bell toll, long decay"  
Death has claimed another name.  
[Pause 0.8s]  
Remember them — and fear what still walks.

### `no_deaths_b.mp3`
[Tone: Uneasy relief]  
[Ambience | ~10s]: "Quiet morning streets, strange emptiness"  
The morning streets are… undisturbed.  
[Pause 0.8s]  
No fresh blood on the stone.  
[Pause 0.8s]  
[Tone: Warning]  
That is not the same as safety.

### `no_deaths_c.mp3`
[Tone: Soft doubt]  
[Ambience | ~10s]: "Soft wind, empty dawn square"  
[SFX | ~2s]: "Subtle uneasy low tone"  
Dawn finds every face still here.  
[Pause 0.8s]  
Strange mercy. Do not trust it.

### `someone_died_b.mp3`
[Tone: Grave announcement]  
[Ambience | ~8s]: "Mournful morning wind"  
[SFX | ~2s]: "Single deep funeral bell toll"  
The night took someone from you.  
[Pause 0.8s]  
One less soul stands in the square.

### `someone_died_c.mp3`
[Tone: Slow, heavy]  
[Ambience | ~8s]: "Distant slow bell, cold morning air"  
[SFX | ~2.5s]: "Funeral bell toll"  
Dawn reveals a loss.  
[Pause 0.8s]  
Someone did not survive the dark.

### `multiple_deaths_b.mp3`
[Tone: Heavier shock]  
[Ambience | ~10s]: "Emptier streets, colder wind"  
[SFX | ~3s]: "Two deep bell tolls, spaced apart"  
The night was greedy.  
[Pause 0.8s]  
More than one life was stolen before the mist lifted.

### `multiple_deaths_c.mp3`
[Tone: Slow horror]  
[Ambience | ~10s]: "Sparse crow calls, empty cobblestones"  
[SFX | ~3s]: "Two spaced bell tolls"  
Look around. The square is too empty.  
[Pause 0.8s]  
Several souls are gone with the night.

### `timer_end_b.mp3`
[Tone: Sharp, urgent]  
[SFX | ~3s]: "Single deep bronze clocktower bell, long cathedral echo"  
The tower’s patience is spent.  
[Pause 0.5s]  
Time… is done.

### `timer_end_c.mp3`
[Tone: Clipped, iron]  
[SFX | ~3s]: "Deep clocktower bell strike with long stone echo"  
No more minutes.  
[Pause 0.5s]  
The clocktower has spoken.

### `guest_arrive_b.mp3`
[Tone: Curious, watchful]  
[SFX | ~3s]: "Boots on wet cobblestones approaching"  
New boots on the wet road.  
[Pause 0.8s]  
A traveller steps into Ravenswood Bluff. Watch them well.

### `guest_arrive_c.mp3`
[Tone: Alert, measured]  
[SFX | ~2.5s]: "Travel bag creak, footsteps on stone"  
A stranger’s shadow crosses the square.  
[Pause 0.8s]  
The town has a new face among the old ones.

### `guest_depart_b.mp3`
[Tone: Quiet farewell]  
[SFX | ~3s]: "Boots walking away into distance, wind"  
The stranger’s road turns outward.  
[Pause 0.8s]  
One less unknown in the square.

### `guest_depart_c.mp3`
[Tone: Hollow, soft]  
[SFX | ~2.5s]: "Footsteps fading on wet cobbles"  
A guest takes their leave.  
[Pause 0.8s]  
The circle of faces grows smaller.

### `day_1_b.mp3`
[Tone: Cautious daylight]  
[Ambience | loop | ~12s]: "Pale morning light in a town square, uneasy calm"  
First light after the first dark.  
[Pause 0.8s]  
Day one. Study the faces beside you.  
[Pause 0.8s]  
[Tone: Quiet menace]  
Someone here smiles by day… and hunts by night.

### `day_1_c.mp3`
[Tone: Careful, inviting dread]  
[Ambience | loop | ~12s]: "Soft morning wind, distant quiet activity"  
[SFX | ~2s]: "Low subtle ominous swell"  
Morning one. The square fills again.  
[Pause 0.8s]  
Speak carefully. Evil wears a neighbour’s skin.

### `day_2_b.mp3`
[Tone: Worn, thinner trust]  
[Ambience | ~10s]: "Thinner crowd murmur, colder wind"  
Day two. Fear has learned your names.  
[Pause 0.8s]  
Trust less. Speak while the light still holds.

### `day_2_c.mp3`
[Tone: Harder daylight]  
[Mix: voice-only]  
A second morning. The cobbles remember yesterday.  
[Pause 0.8s]  
Every claim costs. Every silence costs too.

### `day_3_b.mp3`
[Tone: Desperate edge]  
[Ambience | ~10s]: "Harsh noon shadow, dry wind, distant crow"  
Day three. The tower’s shadow splits the square.  
[Pause 0.8s]  
Choose your words as if they were blades.

### `day_3_c.mp3`
[Tone: Hard, urgent]  
[Ambience | ~10s]: "Sparse footsteps, cold noon wind"  
[SFX | ~2s]: "Low tonal whoosh of clocktower shadow"  
Three days deep. The town is thinner.  
[Pause 0.8s]  
Waste no kindness on lies.

### `day_n_b.mp3`
[Tone: Weary gravity]  
[Ambience | ~10s]: "Sparse empty town square, cold wind, far bell"  
Another day. Fewer faces. Higher stakes.  
[Pause 0.8s]  
Decide — while you still can.

### `day_n_c.mp3`
[Tone: Late-game weight]  
[Ambience | ~10s]: "Empty square, few footsteps, distant bell"  
The days grind on.  
[Pause 0.8s]  
Ravenswood Bluff has little left to lose… and everything still to fear.

---

## H. What NOT to record as public *in-game* lines

Do **not** put on the TV / room speakers during a live game anything that:

- Confirms **which roles are in this game**  
- Is a **night wake** (“X, wake up”) — use the Storyteller phone Night helper instead  
- Reveals **private results** (poison, safe, bluffs, Drunk, who evil chose, grimoire)

**Rules teach files** (`rules_*.mp3` in section C) may name characters and printed abilities — that is teaching the script, not revealing who was dealt what.

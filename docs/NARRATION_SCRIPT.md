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

**Canonical opening image** (matches `intro.mp3`): storm, midnight strike, the Storyteller dead on the clock hands, blood on the cobbles — then the truth that evil walks among you by day. (Rain bed mixed low under voice — `INTRO_AMB_VOL` ~0.08. A distant, atmospheric scream SFX lands just after the spoken “scream echoes” line — quiet and far, not a loud sting.)

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
- `[SFX | ~Ns | after-pause:N | +Xs | vol:V]: "…"` — optional: place at Nth mid-voice pause (≥0.9s silence after speech starts), plus optional delay/volume
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
During a hellish thunderstorm... a scream echoes through the rain-soaked streets of Ravenswood Bluff.  
[Pause 1.0s]  
[SFX | ~3.5s | after-pause:1 | vol:0.28]: "Distant horror-movie scream far across a rain-soaked gothic town, muffled by storm and empty streets, atmospheric and chilling, soft echo, not close, not loud, not cartoonish"  
[SFX | ~4s | after-pause:1 | +1.3s | vol:0.28]: "Large old clocktower bell striking midnight, deep resonant bronze, long decay"  
The town clock tower strikes midnight...  
[Pause 1.5s]  
[SFX | ~3s | after-pause:2 | +0.2s]: "Low ominous drone under rain, faint wet drip of blood-like liquid on stone"  
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
The sentence is here.  
[Pause 1.0s]  
On these stones, judgment is done.

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
Close your eyes. Let the shutters fall.  
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
Close your eyes… and open them only if you are woken.

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
The day’s talk thins. Stand ready in the square.

### `nominations_open.mp3`
[Tone: Formal, fading light — a public summons]  
[Ambience | ~10s]: "Crowd murmur in a stone square, tense hush rising, lamps being lit"  
The square is open to judgment.  
[Pause 0.8s]  
Speak a name… or keep your peace until the lamps die.

### `no_execution.mp3`
[Tone: Quiet close — still watchful]  
[Ambience | loop | ~12s]: "Oil lamps guttering, empty wet streets, low night drone"  
The block stands empty. The town takes no blood today.  
[Pause 0.8s]  
Night comes all the same.

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
[SFX | ~3s | vol:0.33]: "Two deep bell tolls, spaced apart"  
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
This soul stands beneath the square’s judgment.

### `no_majority.mp3`
[Tone: Soft release — still watchful]  
[SFX | ~2s]: "Soft release of held breath from a crowd, uneasy settle"  
This name does not take the block.  
[Pause 0.8s]  
This soul remains among you… while daylight still holds.

### `tie.mp3`
[Tone: Tense, unresolved]  
The square is split. The count will not decide.  
[Pause 0.8s]  
Equal hands. No one stands beneath the square’s judgment.

### `about_to_die.mp3`
[Tone: Intimate dread — almost a whisper]  
[Ambience | ~10s]: "Very close quiet: wind, heartbeat-like low pulse, stone square hush"
The town draws close.
[Pause 1.0s]  
This life hangs by a thread.

### `lives.mp3`
[Tone: Exhale of relief — still unsettled]  
[SFX | ~2s]: "Soft relieved crowd murmur, still nervous undertone"  
They are not taken.  
[Pause 0.8s]  
This soul remains among you… for now.

### `good_wins.mp3`
[Tone: Brightening, earned — still theatrical]  
[Ambience | ~15s]: "Morning clearing after storm: soft birds, clean wind, distant hopeful bell"  
The shadow breaks. The town has outlasted the dark. Ravenswood Bluff is free.  
[Pause 0.8s]  
Breathe the clean air. The town endures.  
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

### `exile.mp3`
[Tone: Formal, weighty — a public turning-out]  
[Ambience | ~10s]: "Crowd murmur in a stone square, tense hush rising"  
[SFX | ~3s]: "Boots on wet cobblestones, travel bag creak"  
The town turns on a stranger. The road is called.  
[Pause 0.8s]  
They will not sleep in Ravenswood tonight.

### `exile_spared.mp3`
[Tone: Soft release — still watchful]  
[Ambience | ~8s]: "Crowd murmur in a stone square, uneasy settle"  
The stranger remains.  
[Pause 0.8s]  
The town would not send them into the dark. Not yet.

### `public_shot.mp3`
[Tone: Sudden crack — sharp intake before the line]  
[Pause 0.3s]  
[SFX | ~2s | vol:0.36]: "Loud gunshot crack echoing in a stone town square"  
A shot cracks across the square —  
[Pause 0.6s]  
[SFX | ~2.5s | vol:0.28]: "Flock of ravens exploding off a clocktower in a black cloud of wingbeats"  
birds lift from the clocktower in a black cloud.

### `public_shot_true.mp3`
[Tone: Shock, then grim confirmation]  
[SFX | ~2s | vol:0.18]: "Impact thud, shocked crowd gasp"  
The shot finds what it sought.  
[Pause 0.8s]  
Evil falls… and the town gasps as one.

### `public_shot_false.mp3`
[Tone: Hollow echo — fear returns]  
[SFX | ~2.5s | vol:0.28]: "Gunshot echo dying into empty streets, fearful crowd murmur rising"  
Echoes only. No evil falls.  
[Pause 0.8s]  
Fear rushes back into the square twice as deep.

### `sacred_blood.mp3`
[Tone: Horror, doom — slow and final]  
[Ambience | ~12s]: "Horror stillness, cold wind, distant thunder"  
[SFX | ~3s | vol:0.2]: "Wet blood drip on stone, then deep doom hit"  
Innocent blood — sacred blood — stains the cobblestones.  
[Pause 1.2s]  
The town has damned itself. Evil claims the win.  
[Fade out]

### `three_stand.mp3`
[Tone: Strained hope — quiet triumph]  
[Ambience | ~12s]: "Sparse wind, three faint footsteps, fragile morning light feel"  
[SFX | ~2s]: "Quiet hopeful swell, soft far bell"  
Only three still stand in the square. No execution comes.  
[Pause 1.0s]  
What happens next may end it all.

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
Most of you are good. Your task is to find the Demon… and execute it. If the Demon dies, good wins.  
[Pause 0.6s]  
A few of you are evil. Your task is to destroy the town. If only two players are left alive — Travellers not counted — evil wins.  
[Pause 1.0s]  
By day, you talk… and you decide who to execute. By night, you close your eyes… and I wake some of you in secret.  
[Pause 0.8s]  
I am the Storyteller. I keep the Grimoire. I will never lie to you about the rules… and when the rules are unclear, my word is final.

### `rules_teams.mp3`
[Tone: Structured, clear — still atmospheric]  
[Ambience | ~15s]: "Soft square ambience, distant bell, attentive quiet"  
There are four kinds of character in Trouble Brewing. Each of you will secretly be one of them.  
[Pause 0.8s]  
Townsfolk — good. Most of the town. Their abilities help good… if they can be trusted.  
[Pause 0.8s]  
Outsiders — also good… but their abilities hinder the town. They are still on your side, and they win with it.  
[Pause 0.8s]  
Minions — evil. They serve the Demon. They lie for it, and they sabotage the town.  
[Pause 0.8s]  
The Demon — evil. By day it wears a human face. By night it kills.  
[Pause 1.0s]  
[Tone: Emphatic]  
Good wins when the Demon dies.  
Evil wins when only two living players remain — Travellers not counted.  
[Pause 0.8s]  
A few abilities can end the story another way. You will hear of them shortly.

### `rules_setup.mp3`
[Tone: Practical ceremony]  
[Ambience | ~12s]: "Quiet dealing atmosphere, soft paper/tokens feel, square hush"  
Before the first night, each of you draws one character token.  
[Pause 0.8s]  
Keep it secret. Do not show it to anyone… and never look into the Grimoire.  
[Pause 1.0s]  
Once the first night is over, you may say whatever you like — the truth, half of it, or a lie.  
[Pause 0.6s]  
Evil should lie. The best of them choose a good character… and wear it like a mask.  
[Pause 0.6s]  
Good players usually share what they know — though some have reason to be careful.  
[Pause 0.8s]  
The character sheet lists every character that might be in this town.  
[Pause 0.6s]  
Not every character is in play. You will not be told which ones are.  
[Pause 0.8s]  
That uncertainty… is the fog of Ravenswood Bluff.

### `rules_night.mp3`
[Tone: Hushed instruction — night law]  
[Ambience | ~15s]: "Night settling: lamps, wind, slow clock — instructional not scary-loud"  
When night falls, everyone closes their eyes — the living and the dead.  
[Pause 0.8s]  
I will wake some of you in secret, with two taps on the shoulder. Open your eyes only when you feel them.  
[Pause 0.8s]  
At night I stay silent. To choose a player, simply point. I will nod for yes, shake my head for no… and show you whatever you need to see.  
[Pause 0.6s]  
When I am done with you, close your eyes and sleep.  
[Storyteller: demonstrate the taps, the point, the nod and the shake]  
[Pause 2.0s]  
Do not peek. Do not signal. The town that cheats the dark invites ruin.  
[Pause 1.0s]  
On the first night, some of you learn your first secrets. With seven or more players, the evil team learns who its allies are.  
[Pause 0.6s]  
On later nights, the Demon kills… and other abilities stir in the dark.  
[Pause 1.0s]  
Not every whisper can be trusted. A player who is drunk or poisoned has no ability — but they do not know it, and I will act as though they do. What they learn may be false.  
[Pause 0.8s]  
At dawn, eyes open. I will announce who died in the night — if anyone.

### `rules_day.mp3`
[Tone: Open square — discussion law]  
[Ambience | ~15s]: "Daytime square murmur under narration, soft footsteps"  
By day, the square is yours. Talk. Accuse. Defend. Share what you learned… or what you pretend you learned.  
[Pause 0.8s]  
Speak openly to everyone, or step aside for private conversations. You may say anything at all.  
[Pause 0.8s]  
If you have a question — about the rules, or about your own character — ask me. In the open… or in private, so no one learns what you asked.  
[Pause 1.0s]  
As the light fades, I will call for nominations.  
[Pause 0.6s]  
To nominate, simply say so — "I nominate…" and a name.  
[Pause 0.8s]  
Only the living may nominate. Each player may nominate once per day… and may be nominated once per day. One nomination at a time.  
[Pause 0.8s]  
The nominee may speak in their defence. Then we vote.  
[Pause 0.6s]  
I will count around the circle, ending with the nominee. If your hand is up when I reach you… that is a vote.  
[Pause 0.8s]  
The living may vote as many times as they like each day.  
[Pause 0.6s]  
The dead have one vote left for the rest of the game. Spend it wisely.

### `rules_execution.mp3`
[Tone: Solemn, precise]  
[Ambience | ~12s]: "Solemn square hush, low wind"  
[SFX | ~2s]: "Soft scaffold wood creak under narration"  
To be about to die, a nominee needs votes from at least half the living… and more votes than anyone else nominated today.  
[Pause 0.8s]  
Reach that mark, and they stand upon the block. Nominations go on — and anyone who later draws even more votes takes their place.  
[Pause 0.8s]  
If a nominee only matches the count, it is a tie. No one stands upon the block… and the next nominee must beat that number.  
[Pause 1.0s]  
When nominations close, whoever stands upon the block is executed. Then night falls.  
[Pause 0.8s]  
There is only one execution each day — and there need not be any. If the block is empty, no one dies to the square.  
[Pause 0.8s]  
Choose carefully. Every good soul you execute brings evil closer to victory… but a day without an execution is a choice too.

### `rules_death.mp3`
[Tone: Clear on dead-player rights]  
[Ambience | ~12s]: "Cold quiet among living and dead in a square"  
Most of you will die. In Ravenswood Bluff… death is not the end.  
[Pause 0.8s]  
The dead still talk. They still argue. They still guide the living. They still close their eyes at night.  
[Pause 0.8s]  
And they still win — or lose — with their team.  
[Pause 1.0s]  
When you die, your ability ends. You may no longer nominate. And you keep a single vote for the rest of the game.  
[Pause 0.8s]  
Often… it is the dead who decide the fate of the town.

### `rules_abilities.mp3`
[Tone: Teacher walking the script — unhurried]  
[Ambience | loop | ~25s]: "Attentive square, soft wind, distant tower — long teach bed"  
Every ability in this town is printed on the character sheet. Glance there as I speak.  
[Pause 1.0s]  
Townsfolk who learn — the Washerwoman and Investigator each learn that one of two players is a particular character. The Librarian learns that one of two is an Outsider — or that none are in play. The Chef learns how many pairs of evil players sit together. The Empath learns how many living neighbours are evil. The Fortune Teller hunts for the Demon — but one good player will seem a Demon to them. The Undertaker learns what the executed truly were. And the Ravenkeeper, if killed at night, learns one player's character.  
[Pause 1.0s]  
Townsfolk who protect and strike — the Monk shields a player from the Demon each night after the first. The Soldier is safe from the Demon. The Virgin — the first time she is nominated, if a Townsfolk nominated her, they are executed at once. The Slayer, once per game, may publicly choose a player: if they are the Demon, they die. And the Mayor — if only three players live and no one is executed, good wins… and if the Demon comes for the Mayor, someone else might die instead.  
[Pause 1.0s]  
Outsiders — the Butler may only vote when their chosen master votes too. The Drunk thinks they are a Townsfolk… but is not, and does not know it. The Recluse might register as evil. And the Saint — if executed, good loses.  
[Pause 1.0s]  
Minions — the Poisoner poisons a player each night. The Spy sees the Grimoire each night, and might register as good. The Scarlet Woman becomes the Demon if the Demon dies while five or more live — Travellers not counted. The Baron brings two extra Outsiders into town.  
[Pause 1.0s]  
The Imp — the Demon. Each night after the first, it chooses who dies. If it kills itself… a Minion becomes the new Imp.  
[Pause 1.0s]  
Poison, drink and false registration can twist any of this. When in doubt — ask me.

### `rules_win.mp3`
[Tone: Final stakes — clear and memorable]  
[Ambience | ~12s]: "Dramatic hush, soft far thunder or wind"  
How the story ends:  
[Pause 0.8s]  
Good wins when the Demon is dead.  
[Pause 0.8s]  
Evil wins when only two players still live — Travellers not counted.  
[Pause 0.8s]  
And a few abilities write their own endings. If the Saint is executed, evil wins. If only three live and no one is executed, the Mayor may win it for good.  
[Pause 1.0s]  
Alive or dead, you win or lose with your team.  
[Pause 0.8s]  
Trust carefully. Vote carefully. Sleep carefully.  
[Pause 0.8s]  
The clocktower is watching.

### `rules_travellers.mp3`
[Tone: Brief addendum — curious]  
[Ambience | ~10s]: "Footsteps on wet road, square noticing a stranger"  
Sometimes strangers walk the wet road into Ravenswood Bluff — Travellers.  
[Pause 0.8s]  
A Traveller may arrive late, or leave early. They choose their own character. I choose their alignment, in secret — good… or evil.  
[Pause 0.8s]  
Travellers may nominate and vote like anyone else. But they are never nominated. Instead, any player — even the dead — may call for a Traveller's exile.  
[Pause 0.8s]  
If at least half of all players, living and dead, support it, the Traveller is exiled and dies. Supporting an exile does not spend a ghost vote. No ability can change an exile. An exile is not an execution — the day's execution still waits.  
[Pause 0.8s]  
Travellers are never counted among the final two.  
[Pause 0.6s]  
Treat them as part of the town's weather… until you know which way the wind blows.

### `rules_etiquette.mp3`
[Tone: Firm, fair, in-world]  
[Ambience | ~10s]: "Quiet authority, square stillness"  
Four things to remember.  
[Pause 0.8s]  
One — say whatever you want, whenever you want. This is a talking game.  
[Pause 0.6s]  
Two — no peeking. Eyes closed means eyes closed. Keep your token hidden, and never look into the Grimoire.  
[Pause 0.6s]  
Three — ask me anything. In the open, or quietly in private. That is what I am here for.  
[Pause 0.6s]  
Four — play nice. Argue hard. Lie well. Kill with grace… and die with dignity.  
[Pause 1.0s]  
When the game ends… leave the blood on the cobblestones — not on each other.

### `rules_full.mp3` *(optional single file — concatenate C in order)*
[Tone: Same voice throughout; natural pace; leave the pauses]  
[Ambience | loop | ~30s]: "Long form town-square teach: soft wind, distant bell, attentive hush under full rules narration"  
[Record by reading, in order: overview → teams → setup → night → day → execution → death → abilities → win → travellers → etiquette.  
Or stitch the modular files. Do not invent new rules mid-take.]

### `rules_quick.mp3` *(stitched — ~8 min, no new recording)*
[Stitched from the recorded chapters, same join as `rules_full`: overview → teams → setup → night → day → execution → death → win → etiquette (474.7 s).]  
[Leaves out abilities (the character sheet covers them) and travellers (play `rules_travellers` when one arrives).]  
[Rebuild: `python scripts/generate_narration.py --stitch-only rules_quick.mp3` (ffmpeg only, no API key).]

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

1. `intro.mp3` (voice + layered storm/distant scream/bell)  
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
the dark has not forgotten this town.

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
Name it carefully… or it turns on the wrong soul.

### `atm_day_neighbors.mp3`
[Tone: False warmth turning dark]  
[Ambience | ~10s]: "Morning light square, polite soft chatter turning uneasy"  
Your neighbors smile in the morning light.  
[Pause 0.8s]  
On these cobblestones, that is often how the dark begins.

### `atm_day_lies.mp3`
[Tone: Knowing, dry]  
[SFX | ~2s | vol:0.23]: "Subtle dissonant tone under daylight"  
Lies walk this square in broad daylight.  
[Pause 0.8s]  
Listen for the tremor… not the smile.

### `atm_day_time.mp3`
[Tone: Urgent without shouting]  
[SFX | ~2s]: "Sun-slant wind, distant clock advancing"  
The light leans west whether you are ready or not.  
[Pause 0.8s]  
Ravenswood Bluff does not pause for certainty.

### `atm_day_quiet.mp3`
[Tone: Near-whisper]  
[SFX | ~2s | vol:0.23]: "Sudden hush, birds going silent"  
A hush falls over the square.  
[Pause 0.8s]  
Even the birds will not sing here.

### `atm_day_accuse.mp3`
[Tone: Smoky tension]  
[Ambience | ~10s]: "Tense crowd, wet wood smoke feel, restless feet"  
Accusation hangs above the crowd like smoke from wet wood.  
[Pause 0.8s]  
Someone will choke on it before dusk.

### `atm_day_defend.mp3`
[Tone: Wary, remembering]  
[SFX | ~2s]: "Wooden shutters rattling in wind"  
A voice rises to defend a name.  
[Pause 0.8s]  
Listen hard — truth and panic wear the same coat.

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
Count the faces you know… and wait to see which still belong to the living.

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
Mourn quickly. The day will not wait for tears.

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
The count climbs toward the mark.

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
[SFX | ~3s | vol:0.23]: "Life ending thud softened, mourning wind, stone memory drone"  
A life ends where you stand.  
[Pause 1.0s]  
Do not look away. The stones will remember even if you will not.

### `atm_survived.mp3`
[Tone: Relief with sour aftertaste]  
They are spared.  
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
[SFX | ~3s | vol:0.27]: "Ravens circling a spire, wingbeats and harsh caws"  
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
Blood stains these cobblestones.  
[Pause 0.8s]  
The town remembers every drop.

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
Good endures in stubborn hearts.  
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
Ravenswood Bluff lives. Breathe the clean air. The town endures.  
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
[SFX | ~1.5s | vol:0.24]: "Soft wooden shutters opening"  
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
Close your eyes. Stir only if you are woken.

### `night_c.mp3`
[Tone: Hushed command]  
[Ambience | loop | ~12s]: "Cold wind in shutters, slow clock ticks, dark streets"  
Darkness claims the cobblestones.  
[Pause 0.8s]  
Close your eyes. Let the town go dark.  
[Pause 0.8s]  
What walks now is not for the square to witness.

### `dusk_b.mp3`
[Tone: Fading light, firm]  
[Ambience | ~10s]: "Sunset wind, lamps being lit, birds settling"  
The light drains from the rooftops.  
[Pause 0.8s]  
Finish the talk you started in the sun. The square has not yet chosen.

### `dusk_c.mp3`
[Tone: Urgent but measured]  
[Ambience | ~10s]: "Sky darkening, soft flame catches, settling hush"  
[SFX | ~1.5s]: "Distant lamp lighting, soft flame"  
Day loosens its grip.  
[Pause 0.8s]  
Speak while the light still holds. The square is about to grow still.

### `nominations_open_b.mp3`
[Tone: Fading light, firm]  
[Ambience | ~10s]: "Sunset wind, lamps being lit, birds settling"  
Daylight thins. The town may call a soul to stand.  
[Pause 0.8s]  
Who among you will be named?

### `nominations_open_c.mp3`
[Tone: Public summons]  
[Ambience | ~8s]: "Tense town square hush rising"  
[SFX | ~1.5s]: "Distant lamp lighting, soft flame"  
The tower will hear a name.  
[Pause 0.8s]  
Step forward if you would accuse. The cobbles are waiting.

### `no_execution_b.mp3`
[Tone: Soft release — then night]  
[Ambience | ~10s]: "Sky darkening, settling hush, cold wind"  
No one dies to the square.  
[Pause 0.8s]  
Mercy — or fear — kept the stones clean. Darkness will not.

### `no_execution_c.mp3`
[Tone: Hushed command]  
[Ambience | loop | ~12s]: "Cold wind in shutters, slow clock ticks, dark streets"  
[SFX | ~2s]: "Single heavy wooden shutter closing with a soft wood thud"  
Judgment is withheld. These streets stay dry until morning.  
[Pause 0.8s]  
Close your eyes anyway.

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
The mark is met. This soul stands on the block.  
[Pause 0.8s]  
Nominations go on — unless a greater count is raised.

### `no_majority_b.mp3`
[Tone: Soft release — watchful]  
[SFX | ~2s]: "Soft release of held breath, uneasy settle"  
The count does not unseat the block.  
[Pause 0.8s]  
They remain among you. Daylight still burns.

### `no_majority_c.mp3`
[Tone: Measured denial]  
The count falls short.  
[Pause 0.8s]  
Nothing changes. Return to the square’s arguments.

### `tie_b.mp3`
[Tone: Tense, unresolved]  
The hands divide the town.  
[Pause 0.8s]  
Neither soul is condemned. The next must draw more hands than this.

### `tie_c.mp3`
[Tone: Tight, unsettled]  
Equal will. Equal weight.  
[Pause 0.8s]  
The block stands empty… until a greater count is raised.

### `about_to_die_b.mp3`
[Tone: Intimate dread]  
[Ambience | ~8s]: "Close quiet wind, stone square hush"  
[SFX | ~2s | vol:0.13]: "Thin high tension drone"  
Breath holds in every throat.  
[Pause 0.8s]  
This life hangs by a thread.

### `about_to_die_c.mp3`
[Tone: Almost a whisper]  
[Ambience | ~8s]: "Heartbeat-like low pulse under square silence"  
The town draws tight around one soul.  
[Pause 0.8s]  
Judgment is a breath away.

### `lives_b.mp3`
[Tone: Relief — still unsettled]  
[Mix: no-sfx]  
They live.  
[Pause 0.8s]  
They rejoin the crowd — the square has spent its killing for the day.

### `lives_c.mp3`
[Tone: Quiet reprieve]  
Mercy — or hesitation — holds.  
[Pause 0.8s]  
This soul remains among you. The square has spent its judgment for the day.

### `execution_b.mp3`
[Tone: Solemn, final]  
[Ambience | ~10s]: "Heavy silence in a stone square, low wind"  
[SFX | ~2s]: "Deep solemn drum hit"  
The price is taken.  
[Pause 0.8s]  
On these stones, the sentence is carried out.

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
[SFX | ~2s | vol:0.23]: "Slow deep bell toll"  
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
[SFX | ~2s | vol:0.31]: "Subtle uneasy low tone"  
Dawn finds every face still here.  
[Pause 0.8s]  
Strange mercy. Do not trust it.

### `someone_died_b.mp3`
[Tone: Grave announcement]  
[Ambience | ~8s]: "Mournful morning wind"  
[SFX | ~2s | vol:0.24]: "Single deep funeral bell toll"  
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
[SFX | ~3s | vol:0.28]: "Two deep bell tolls, spaced apart"  
The night was greedy.  
[Pause 0.8s]  
More than one life was stolen before the mist lifted.

### `multiple_deaths_c.mp3`
[Tone: Slow horror]  
[Ambience | ~10s]: "Sparse crow calls, empty cobblestones"  
[SFX | ~3s | vol:0.26]: "Two spaced bell tolls"  
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

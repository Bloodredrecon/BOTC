# Audio cues

The TV page plays cues through the TV’s speakers (pair Bluetooth speakers to the TV).

## Unlock

Browsers block autoplay. On `/tv`, tap **Enable sound** once after the page loads.

That tap also reports **TV sound ready** to the Storyteller (separate from “TV connected”). Connection alone does not count as sound confirmed — if the TV reconnects after a full page reload, tap **Enable sound** again.

## Files

Place files in `data/audio/` (preferred for custom tracks) or `web/public/audio/` (built-in names).

## Soundboard

On the storyteller phone open the **Sound** tab. Tap Intro, Night, Dawn, etc. Audio plays on the **TV** after **Enable sound**.

## Custom files

Drop into `data/audio/` on the LAN server:

| Example filename | Appears as |
| --- | --- |
| `intro.mp3` | Intro (custom) |
| `night_bed.wav` | overrides night ambience |
| `dawn.mp3` | Dawn |
| `my_boss_fight.ogg` | My Boss Fight |

Supported: wav, mp3, ogg, m4a, webm. No server restart needed — reopen Sound tab or reconnect to refresh the list.

## Letter variants (random automated picks)

For repetitive moments, add interchangeable takes as `cue_b.mp3`, `cue_c.mp3`, `cue_d.mp3` beside the base file (e.g. `nomination.mp3` + `nomination_b.mp3`). Automated events use `pickSound()` which expands each cue to any lettered siblings on disk and picks one at random. The soundboard still lists every file individually. Generate new variants with:

`python scripts/generate_narration.py --variants`

## Built-in cue ids

intro, day_bed, night_bed, dawn, nomination, execution, death, timer_end, night_wake, hush

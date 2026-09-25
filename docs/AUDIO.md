# Audio cues

The TV page plays cues through the TV’s speakers (pair Bluetooth speakers to the TV).

## Unlock

Browsers block autoplay. On `/tv`, tap **Enable sound** once after the page loads.

## Files

Place files in `web/public/audio/` (same names):

| File | When |
| --- | --- |
| `day_bed.wav` | Day ambience (loops) |
| `night_bed.wav` | Night ambience (loops) |
| `hush.wav` | Silence / lobby |
| `timer_end.wav` | Timer hits zero |
| `nomination.wav` | Nomination opens |
| `execution.wav` | Execution confirmed |
| `death.wav` | Death announce |
| `dawn.wav` | Dawn phase |
| `night_wake.wav` | Night step advance |

Placeholder tones ship in the repo. Replace them with your own recordings — do not commit commercial Blood on the Clocktower soundtrack files.

# BOTC ambiance pack

Creepy old-town / Ravenswood Bluff beds and one-shots for the Storyteller **Ambiance** tab.
Served at `/custom-audio/ambiance/<file>`.

| File | Kind | Default volume | Min gap (sporadic) |
|------|------|----------------|--------------------|
| `amb_rain.mp3` | loop | 35% | — |
| `amb_wind_shutters.mp3` | loop | 32% | — |
| `amb_fog_hum.mp3` | loop | 32% | — |
| `amb_clocktower_mechanism.mp3` | loop | 30% | — |
| `amb_candle_hiss.mp3` | loop | 25% | — |
| `amb_chapel_drone.mp3` | loop | 18% | — |
| `amb_well_drip.mp3` | loop | 22% | — |
| `amb_night_air.mp3` | loop | 32% | — |
| `amb_crow_1.mp3` | sporadic | 40% | 45s |
| `amb_crow_2.mp3` | sporadic | 40% | 45s |
| `amb_crow_3.mp3` | sporadic | 38% | 45s |
| `amb_creak_1.mp3` | sporadic | 32% | 35s |
| `amb_creak_2.mp3` | sporadic | 32% | 35s |
| `amb_whisper_1.mp3` | sporadic | 35% | 60s |
| `amb_whisper_2.mp3` | sporadic | 34% | 60s |
| `amb_shutter_slam.mp3` | sporadic | 35% | 50s |
| `amb_footsteps_wet.mp3` | sporadic | 30% | 55s |
| `amb_well_bucket.mp3` | sporadic | 34% | 70s |
| `amb_church_door.mp3` | sporadic | 36% | 80s |
| `amb_rats_skitter.mp3` | sporadic | 28% | 40s |
| `amb_gallows_creak.mp3` | sporadic | 24% | 75s |
| `amb_half_chime.mp3` | sporadic | 26% | 90s |
| `amb_owl_1.mp3` | sporadic | 34% | 50s |

## Notes

- **loop** — toggleable continuous beds (browser loops the mp3).
- **sporadic** — when enabled, TV plays infrequently with random gaps ≥ min gap.
- Regenerate: `python scripts/generate_ambiance.py` (use `--force` to overwrite).

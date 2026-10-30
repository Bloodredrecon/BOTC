# WLED LED strip

Atmospheric room lighting for game night. **Off by default** — the game never waits on the strip.

This repo talks to a WLED JSON API (`GET /json/si`, `POST /json/state`).

**Two strips on one controller:** a probe of `192.168.50.139` (WLED 16.0.1 Niji/ESP32) reported **577 LEDs**. Live test 2026-10-20: pixels `0–300` only turned a few LEDs red on the 300-strip; pixels `277–577` turned the **whole 300 red**. The 277 is first on the data line; the game strip is second. BOTC drives **only that 300** (`start` 277, `stop` 577 in `config/local.json`) and leaves the 277 off. If WLED later has a real 300-LED segment, that segment is used and the 277 is left as-is.

## Enable

1. Put the strip on the same LAN as the BOTC **server**.
2. Double-click `BOTC.bat` → **9) Settings** → **6) LED strip (WLED)**.
3. Set the strip IP (example: `192.168.50.139`) and turn it **on**.
4. Restart the server if it is already running.

Or edit gitignored `config/local.json` (never commit this file):

```json
{
  "wled": {
    "enabled": true,
    "host": "192.168.50.139",
    "ledCount": 300,
    "brightness": 128,
    "segmentId": 0,
    "start": 277,
    "stop": 577
  }
}
```

Non-interactive:

```text
BOTC.bat set -Wled on -WledHost 192.168.50.139 -WledLeds 300 -WledStart 277
```

Environment (highest priority): `BOTC_WLED=1`, `BOTC_WLED_HOST`, `BOTC_WLED_LEDS`, `BOTC_WLED_BRI`, `BOTC_WLED_START`, `BOTC_WLED_STOP`.

`/api/health` reports `wledLive: true` when the driver is following the game. If the strip is unreachable, scenes fail to logs (`[wled] …`) and play continues.

## Storyteller

**Ambiance** tab → **Lights**:
- Follow game / strip off
- **Event cues** on/off (wakes, deaths, Slayer, exile, vote-timer end). Phase beds still follow when this is off.
- **Brightness** (scene mixer) and **Max brightness** (hard cap on the strip, default 180 so a 5 A supply does not clip)
- Preview chips (lights only, no audio)

Overrides persist in `config/local.json`. **Control** → **Room scenes** still plays the day/night/hush *sound* beds as well.

## Scenes

| Moment | Strip (uses the 300 LEDs, not a global pulse) |
| --- | --- |
| Lobby / new game | Warm fairy sparkles along the line |
| First night / night | Slow blue meteors |
| Night wake (Show to player) | Dual scan bars, then meteors again on Hide |
| Dawn | Amber wipe down the strip |
| Day | Slow warm flow |
| Dusk | Cool stream along the line |
| Nominations | Red/amber sweep |
| Vote | Fill along the strip with the vote clock |
| Vote timer end | Dual scan (not a strobe) |
| Execution / gallows | Fire flicker |
| Death / scream / exile | Pixels dissolve dark red |
| Slayer hit | Fire, then dissolve |
| Slayer miss | Dual scan |
| Good wins | Gold fireworks 1D |
| Evil wins | Violet dancing shadows |
| Hush / reveal-only | Sparse dim spots |

No blink/strobe. Speeds stay moderate.

## Hue

Philips Hue is a second backend (`config/hue.json`, see `docs/HUE.md`). If both are on, both receive the same scene names. WLED is the addressable-strip path.

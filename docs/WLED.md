# WLED LED strip

Atmospheric room lighting for game night. **Off by default** — the game never waits on the strip.

This repo talks to a WLED JSON API (`GET /json/si`, `POST /json/state`).

**Two strips on one controller:** a probe of `192.168.50.139` (WLED 16.0.1 Niji/ESP32) reported **577 LEDs in a single segment** (`id 0`, start `0`, stop `577`). That is a **300 + 277** chain that is not split in WLED yet. BOTC drives **only the 300-LED game strip** (pixels `0–300` by default) and turns the leftover 277 off so game scenes do not mirror onto it. If the wrong physical strip lights, set start to `277` (pixels `277–577`). If WLED later has a real 300-LED segment, that segment is used and the 277 is left as-is.

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
    "start": 0,
    "stop": 300
  }
}
```

Non-interactive:

```text
BOTC.bat set -Wled on -WledHost 192.168.50.139 -WledLeds 300
BOTC.bat set -WledStart 277
(if the 300-LED strip is the second one on the chain)
```

Environment (highest priority): `BOTC_WLED=1`, `BOTC_WLED_HOST`, `BOTC_WLED_LEDS`, `BOTC_WLED_BRI`, `BOTC_WLED_START`, `BOTC_WLED_STOP`.

`/api/health` reports `wledLive: true` when the driver is following the game. If the strip is unreachable, scenes fail to logs (`[wled] …`) and play continues.

## Storyteller

**Ambiance** tab → **Lights**: follow on/off, brightness, preview scenes (no audio).  
**Control** → **Room scenes** still plays the day/night/hush *sound* beds as well.

## Scenes

| Moment | Strip |
| --- | --- |
| Lobby / new game | Dim warm idle (slow breathe) |
| First night / night | Deep blue-black, slow pulse |
| Dawn | Amber lift |
| Day | Warmer, brighter solid |
| Dusk | Cooler, dimmer |
| Nominations | Focused red/amber |
| Vote | Fill along the strip with the vote clock |
| Vote timer end | Brighter slow pulse (not a strobe) |
| Execution / gallows | Deep red |
| Death / scream | Brief dark red, then the next phase |
| Good wins | Gold hold |
| Evil wins | Crimson / violet hold |
| Hush / reveal-only | Very dim |

Effects stay slow on purpose (no blink/strobe).

## Hue

Philips Hue is a second backend (`config/hue.json`, see `docs/HUE.md`). If both are on, both receive the same scene names. WLED is the addressable-strip path.

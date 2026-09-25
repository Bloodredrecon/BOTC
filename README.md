# BOTC Companion

LAN companion for a physical **Blood on the Clocktower** game: storyteller phone UI + TV public board, with Philips Hue scenes and Bluetooth speaker cues (via the TV browser).

## Features (MVP)

1. Storyteller command center (phases, scenes, timers)
2. Night sequence director (Trouble Brewing wake order + text)
3. Nomination → vote tally/majority/ghost votes → execution ritual
4. Private grimoire (roles, reminders, notes, bluffs)
5. Public TV info board (never shows secret roles)
6. Timers with TV countdown + end chime

Also: dawn overnight-death announce, setup bag counts, fabled on TV, session autosave, storyteller PIN.

## Requirements

- Node.js 20+
- LAN server reachable by phone + TV
- Optional: Philips Hue Bridge on the same LAN as the **server**
- Optional: Bluetooth speakers paired to the TV

## Quick start

```bash
npm install
npm run dev
```

- Storyteller: `http://<server-ip>:5173/storyteller` (Vite) or production port below
- TV: `http://<server-ip>:5173/tv`
- API/socket in dev: proxied to port **3847**

Default storyteller PIN: **1234** (change in `config/default.json` or `BOTC_PIN` env).

See also [docs/HUE.md](docs/HUE.md) and [docs/AUDIO.md](docs/AUDIO.md).

### Production (single port)

```bash
npm run build
npm start
```

Then open `http://<server-ip>:3847/tv` and `/storyteller`.

## Hue setup

1. Copy `config/hue.json.example` → `config/hue.json`
2. Put the Bridge IP and app username in that file
3. Map your three RGB spots to `ambient`, `accent`, `effect`
4. Set `"enabled": true`

The **server** must reach the Bridge. If Hue is down, the app stays in stub mode and gameplay continues.

## Audio

Cues live in `web/public/audio/`. Replace the placeholder WAVs with your own files (same names). On the TV page, tap **Enable sound** once (browser autoplay policy). Pair Bluetooth speakers to the TV so the room hears the cues.

## Scripts

Trouble Brewing ships in `data/scripts/trouble-brewing.json`. Folders are ready for Bad Moon Rising / Sects & Violets later.

## Privacy

- `/tv` is public on your LAN (alive/dead, votes, log — no characters)
- `/storyteller` requires the PIN; keep it off guest devices

## Assets / copyright

Character **names** and ability text only — no official token art. Drop in your own audio; do not commit commercial soundtracks.

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

## Quick start (Windows)

1. Install [Node.js](https://nodejs.org) 20 or newer (once).
2. Double-click **`BOTC.bat`** in this folder.
3. Choose **1) Start server**. The first start installs dependencies and builds the app, so give it a minute.
4. The launcher prints the addresses to use, plus a QR code:
   - TV: `http://<this-pc-ip>:3847/tv`
   - Storyteller phone: `http://<this-pc-ip>:3847/storyteller` (PIN **1234** by default; change it under **Settings**, the launcher and Storyteller page warn until you do)

The server keeps running in the background after you close the launcher window. Open `BOTC.bat` again to **Stop**, **Restart**, **Rebuild and start** (after updating the app), show the join addresses again, open the TV page, view the log, or change **Settings** (port, host, PIN).

Windows may ask to allow Node.js through the firewall the first time. Allow it on **Private** networks, or the TV and phones can't connect.

Before guests arrive, run **C) Pre-game check** (or `BOTC.bat check`). It checks Node and dependencies, whether the build is current, the port, the firewall rule, the LAN addresses (and `/api/health` on them if the server is running), the TV plates, the narration cues, the PIN, the saved game and the game log folder, and it never changes anything. `BOTC.bat check -Full` also runs the server tests.

While a game is running, the Storyteller page shows **Server** and **TV** pills at the top and a banner if either drops out. Taps made while the server is unreachable are not sent (you are told), so nothing fires late after the connection comes back. The TV shows a small "Reconnecting…" badge and resyncs on its own.

The launcher also works from a terminal: `BOTC.bat start | stop | restart | rebuild | status | addresses | check | log`, or `BOTC.bat set -Port 3900 -BindHost 0.0.0.0 -Pin 4321` / `BOTC.bat reset-settings`.

Files the launcher uses (all gitignored):

- `data/server.pid`: the background server's PID (and a one-time stop token)
- `data/logs/server.log`: server output (the previous run is kept in `server.prev.log`)

See also [docs/HUE.md](docs/HUE.md) and [docs/AUDIO.md](docs/AUDIO.md).

## Settings (port, host, PIN)

Settings are layered. The highest one wins:

1. Environment variables: `BOTC_PORT` or `PORT`, `BOTC_HOST` or `HOST`, `BOTC_PIN`
2. `config/local.json`: your machine's overrides, written by the launcher's Settings menu (gitignored)
3. `config/default.json`: shipped defaults (port `3847`, host `0.0.0.0`, PIN `1234`)

`config/local.json` only needs the keys you want to change, for example:

```json
{ "port": 3900, "host": "0.0.0.0", "storytellerPin": "4321" }
```

`host` is the address the server listens on. `0.0.0.0` means all networks (needed for the TV and phones). `127.0.0.1` means this PC only. A specific IP means only that network adapter. Restart the server after changing settings. Hue settings live in `config/hue.json` (see below).

## Developer mode

```bash
npm install
npm run dev
```

(or launcher option **D**). This runs the API with hot reload plus Vite on port 5173:

- Storyteller: `http://<server-ip>:5173/storyteller`
- TV: `http://<server-ip>:5173/tv`
- API/socket: Vite proxies to the configured server port (same settings as above)

### Production without the launcher

```bash
npm run build
npm start
```

Then open `http://<server-ip>:3847/tv` and `/storyteller`. The startup log lists the real LAN addresses and a QR code.

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
- Wrong PINs are throttled per device: after 5 misses it locks for 5 s, doubling per further miss (max 5 min)

## Tests

`npm test` runs every server test in `server/test/` (engine rules plus a socket/HTTP check that starts a real server on a free port with a temporary session; `data/session.json` is never touched). One file: `cd server && npx tsx test/<name>.ts`.

## Assets / copyright

Character **names** and ability text only — no official token art. Drop in your own audio; do not commit commercial soundtracks.

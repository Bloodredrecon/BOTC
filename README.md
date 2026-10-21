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

Storyteller tools:

- **Deal characters** (Setup tab, before the first night): a legal random bag, or tap the characters you want in play and the rest is drawn. It picks the Drunk's Townsfolk, the Fortune Teller's red herring and three Demon bluffs; change any of them in the preview, then **Put in grimoire**. The Baron's +2 Outsiders is applied automatically.
- **Grimoire circle** (Grimoire tab): the seats as a circle with characters, deaths, unused ghost votes and reminder tokens; tap a seat to edit it.
- **Undo** (top of the Storyteller page): takes back the last action, naming it first. Sounds and lights are not replayed; a pending automatic step (dawn to day, game over) is cancelled and you're told. The history is kept in memory (up to 30 steps) and cleared by New game or a server restart.
- **History** tab: a recap (who was what, starting characters, how each player died, each day's nominations and votes) and the full action log.

TV:

- Slow plate zoom, drifting fog and embers at night. They switch off when the TV asks for reduced motion; on a slow TV browser open `/tv?motion=off` to stop them.
- Short full-screen moments for a Slayer shot (aim, then hit or miss in time with the sound), a Virgin execution and the Demon slain. While the shot sound plays, the town board and Gazette are hidden so they don't give the result away. A TV that joins late does not replay old moments.
- At game end the characters are revealed seat by seat.

## Player phones (optional, off by default)

Players can use their own phones for private things, but the game never depends on it. **Player phones** is one setting on the Storyteller's **Setup** tab, off by default. While it's off the app works exactly as before: no join code on the TV, `/play` just says phones are off, phones get nothing, characters go out as physical tokens and the Storyteller taps the votes.

- **Switching off mid-game is safe.** Connected phones show "phones turned off" and stop getting anything private. Their seats are remembered, so switching back on re-links them (the Storyteller can also clear them).
- **Switching on mid-game works too.**
- **Default for new sessions:** `BOTC.bat` > **Settings** > **5) Player phones** (or `BOTC.bat set -Phones on`, which writes `"playerPhones": true` to `config/local.json`; `BOTC_PHONES=1` also works). A saved game keeps its own setting.

**At the table, with phones on:**

1. The TV lobby shows a QR code, the `/play` address and a 4-letter code (by day a small "Phones · /play" badge keeps the code on screen for late arrivals).
2. Each player scans it, picks their seat and confirms. The Storyteller page shows "Phones asking for a seat" above the tabs: **Approve** or **Deny** each one.
3. On the **Setup** tab, **Send characters to phones** gives each player what they should believe: the Drunk sees their Townsfolk, Travellers see their secret alignment. Players hold the card to see it; it hides when they let go.
4. Later grimoire changes do **not** reach a phone by themselves. The device panel flags "Grimoire now says …" and you press **Re-send character**. The new-Demon wake ("You are the Imp") updates that player's phone when you mark it done.
5. At night phones go to a dark "eyes closed" screen. A dead player's phone says so only after the dawn announcement, with their ghost vote.
6. The device panel can also move a phone to another seat, unlink it, give a one-time **hand-over code** for a new phone, close seat claims, show a new code and unlink everyone. Friends who just want to follow along tap **Just watch** on `/play`.
7. **New game** with **Same table** ticked (Control tab) keeps names in their seats and every linked phone stays linked.
8. **Notes** (phone, Notes tab) stay on that phone only: a claim, a Good / Evil guess and a line per seat, a free pad, and public facts filled in for them (nominations, vote counts, who voted, deaths). **Save a copy** / **Load a copy** moves them to another phone.
9. **Ask** (phone) sends a question or "Request a word" to the Storyteller only, by day. They appear in a "Messages from players" banner on the Storyteller page; **Reply** goes to that one phone.
10. **Voting:** when you start the vote clock, players with a connected phone get a big **Raise my hand** button (they raise their real hand too). On the Votes tab press **Start the count**: a clock hand goes round from the seat after the nominee, on the TV too, and locks each seat as it passes. Seats without a phone are yours to tap on the chips, and tapping any chip overrides that seat. **Pause**, **Back one seat** and **Resume** if someone needs a moment. **Phones off for voting** (Votes tab or Setup) goes back to counting every hand yourself; hands already counted stay.

### Optional HTTPS (keeps phone screens on)

Browsers only let a page keep the screen awake (the Wake Lock API) over HTTPS. Plain HTTP stays the default and everything else works without it; phone screens just lock on their normal timer.

- **Turn it on:** `BOTC.bat` > **9) Settings** > **4) HTTPS**, or `BOTC.bat set -Https on` (`set -Https off` to go back). Restart the server. The first HTTPS start makes a self-signed certificate in `config/tls/` (gitignored; never share `botc.key`). Join addresses and the TV QR code switch to `https://`, so phones that saved the old address must scan again.
- **Each device warns once.** The certificate is not from a public authority, so every phone, tablet and the TV shows a warning the first time:
  - iPhone / iPad (Safari): **Show Details** > **visit this website** > **Visit Website**.
  - Android (Chrome): **Advanced** > **Proceed to … (unsafe)**.
  - Desktop browsers: **Advanced** > **Continue / Proceed**.
- **By day, with HTTPS, a linked phone keeps its screen on** (the Character tab says so). At night it is released so the phone can sleep face down.
- **Smart TVs:** some TV browsers refuse self-signed certificates with no way past the warning. If yours does, turn HTTPS off, or show the TV page from a laptop or a casting device instead.
- **New certificate:** it lasts about 13 months and is remade automatically when it is near expiry or this PC gets a new LAN address (devices then warn once more). **Settings > 6) Make a new HTTPS certificate** forces one. `BOTC.bat check` shows the certificate's addresses and expiry.
- Developer mode (`npm run dev`) always runs plain HTTP.

The design, the security model and what is built so far are in [docs/PLAYER_PHONES_PLAN.md](docs/PLAYER_PHONES_PLAN.md).

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

The launcher also works from a terminal: `BOTC.bat start | stop | restart | rebuild | status | addresses | check | log`, or `BOTC.bat set -Port 3900 -BindHost 0.0.0.0 -Pin 4321` (also `-Https on|off`, `-Phones on|off`) / `BOTC.bat reset-settings`.

Files the launcher uses (all gitignored):

- `data/server.pid`: the background server's PID (and a one-time stop token)
- `data/logs/server.log`: server output (the previous run is kept in `server.prev.log`)

See also [docs/HUE.md](docs/HUE.md) and [docs/AUDIO.md](docs/AUDIO.md).

## Settings (port, host, PIN)

Settings are layered. The highest one wins:

1. Environment variables: `BOTC_PORT` or `PORT`, `BOTC_HOST` or `HOST`, `BOTC_PIN`, `BOTC_PHONES`, `BOTC_HTTPS` (`1` / `0`), `BOTC_WLED` / `BOTC_WLED_HOST` / `BOTC_WLED_LEDS` / `BOTC_WLED_BRI`
2. `config/local.json`: your machine's overrides, written by the launcher's Settings menu (gitignored)
3. `config/default.json`: shipped defaults (port `3847`, host `0.0.0.0`, PIN `1234`, `playerPhones`, `https` and WLED off)

`config/local.json` only needs the keys you want to change, for example:

```json
{ "port": 3900, "host": "0.0.0.0", "storytellerPin": "4321" }
```

`host` is the address the server listens on. `0.0.0.0` means all networks (needed for the TV and phones). `127.0.0.1` means this PC only. A specific IP means only that network adapter. Restart the server after changing settings. Hue settings live in `config/hue.json` (see below). WLED strip settings live under `wled` in `config/local.json` or **BOTC.bat → Settings → LED strip**.

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

### Docker

```bash
docker compose up --build
```

Same URLs on port `3847`. Session/logs live in the `botc-data` volume. Set `BOTC_PUBLIC_URL=https://botc.example.com` when exposing via Cloudflare Tunnel so QR/join links use the public host (origin only — no `/botc` path; the UI is rooted at `/`). Cloudflare Worker + Containers scaffold and tunnel examples: `deploy/cloudflare/`.

## Hue setup

1. Copy `config/hue.json.example` → `config/hue.json`
2. Put the Bridge IP and app username in that file
3. Map your three RGB spots to `ambient`, `accent`, `effect`
4. Set `"enabled": true`

The **server** must reach the Bridge. If Hue is down, the app stays in stub mode and gameplay continues.

## WLED LED strip

Addressable strip (WLED JSON API). Off until you turn it on:

1. `BOTC.bat` → **Settings** → **LED strip (WLED)** → set the controller IP → on
2. Or `config/local.json`: `{ "wled": { "enabled": true, "host": "192.168.50.139", "ledCount": 300, "start": 0, "stop": 300 } }`

The game strip is **300 LEDs**. The controller at `192.168.50.139` reports 577 because a 277-LED strip is on the same chain; BOTC does not light those. Storyteller **Ambiance → Lights** follows the game, sets brightness, and previews scenes. The strip going down never blocks play. Details: `docs/WLED.md`.

## Audio

Cues live in `web/public/audio/`. Replace the placeholder WAVs with your own files (same names). On the TV page, tap **Enable sound** once (browser autoplay policy). Pair Bluetooth speakers to the TV so the room hears the cues.

## Scripts

Trouble Brewing ships in `data/scripts/trouble-brewing.json`. Folders are ready for Bad Moon Rising / Sects & Violets later.

## Privacy

- `/tv` is public on your LAN (alive/dead, votes, log — no characters)
- `/play` (only while player phones are on) gives each approved phone the public view plus its own private data, nothing about other players. A seat token is stored on the phone; the server keeps only its SHA-256 hash. Wrong join codes are throttled per device. Players can set their display name and upload a face photo (JPEG under `data/player-photos/`, gitignored); uploads are refused while phones are off
- `/storyteller` requires the PIN; keep it off guest devices
- Wrong PINs are throttled per device: after 5 misses it locks for 5 s, doubling per further miss (max 5 min)

## Tests

`npm test` runs every server test in `server/test/` (engine rules plus a socket/HTTP check that starts a real server on a free port with a temporary session; `data/session.json` is never touched). One file: `cd server && npx tsx test/<name>.ts`.

## Assets / copyright

Character **names** and ability text only — no official token art. Drop in your own audio; do not commit commercial soundtracks.

# BOTC Companion roadmap

Working order is top to bottom. Items 1-7 are built, tested and pushed one at a time; items 8 and 9 are planning documents only.

Baseline (Oct 15 2026): HEAD `385079f`, typecheck clean, 150/150 server tests pass (`server/test/*.ts` via `npx tsx`).

Every item is verified with `npm run typecheck`, all server tests, `npm run build`, and a live check on a spare port (never 3847) with a temporary `BOTC_SESSION_PATH`. `data/session.json` is never touched. Screenshots go to `docs/tv-design/_verify/<item>/` (gitignored).

---

## 1. Security: Storyteller PIN hardening and `@fastify/static` upgrade

- [x] Status: done (Oct 15)

**Done.**
- `server/src/pin-guard.ts`: per-IP throttle (5 free misses, then 5 s lock doubling per miss, cap 5 min, forgotten after 30 min idle); attempts during a lock-out are refused without checking the PIN; constant-time compare. Refusals are logged as `storyteller PIN refused` with client IP, never the typed PIN.
- Found and fixed while testing: a socket `join` with a `null` payload crashed the whole server (old build: `TypeError: Cannot read properties of null (reading 'role')`, process exited). Now ignored.
- PIN screen: no default hint; shows "Try again in N s" countdown and disables Unlock; re-submitting the same PIN now re-sends (previously a no-op because the join effect only re-ran when the PIN string changed, `web/src/socket.ts`).
- Default-PIN warnings: launcher header and `BOTC.bat status`, server startup join info, Storyteller page banner (`auth:info { pinIsDefault }`).
- Home page: Town Square is the only button; "storyteller sign-in" is a small muted link.
- `@fastify/static` 8.3.0 -> 10.1.6 (no code changes needed; options used are unchanged). `npm audit --omit=dev`: 0 vulnerabilities.
- `npm test` runs all server tests (`server/test/run-all.ts`); new `pin-guard.ts` (7) and `server-security.ts` (4: malformed payloads, auth required, throttling over a real socket, static serving incl. raw path-traversal attempts). 161/161 pass.
- Known limit (not verified): in dev mode the Vite proxy opens the socket from the PC itself, so clients probably all share one throttle key there; production (`BOTC.bat`) sees real client IPs.

**Goal.** A guest on the LAN can't brute-force or guess their way into the Storyteller screen, and the server has no known high-severity dependency issues.

**Evidence.**
- The PIN check is a plain comparison with no rate limit (`server/src/index.ts:168`); 10,000 PINs can be tried in seconds.
- The default PIN is `1234` (`config/default.json`) and the PIN screen says "Enter the PIN (default 1234)" (`web/src/pages/StorytellerPage.tsx:341`).
- The home page links to `/storyteller` (`web/src/pages/HomePage.tsx:15`).
- `npm audit --omit=dev`: 1 high, `@fastify/static <=10.1.1` (4 advisories); installed 8.3.0; fix is 10.1.6 (breaking).

**Scope.**
- Throttle failed PIN attempts per client IP (and per socket) with exponential back-off; reply with "try again in N s".
- Constant-time PIN compare.
- Remove the default-PIN hint from the PIN screen.
- Warn while the PIN is still `1234`: launcher header/start output, server startup log, and a banner on the Storyteller page (the server tells the authenticated Storyteller `pinIsDefault`).
- De-emphasise the `/storyteller` link on the home page.
- Upgrade `@fastify/static` to a non-vulnerable version; keep `web/dist` serving (SPA fallback, rebuilt hashed assets without restart), `/custom-audio/` from `data/audio`, and TV plate cache-busting (`?v=` query) working.

**Acceptance.**
- Unit tests for the throttle (lock-out after N failures, back-off grows, success resets, per-IP isolation).
- Live: wrong PINs get throttled; right PIN still works after the wait; `/`, `/tv`, `/storyteller`, `/assets/*`, `/tv/*.png?v=...`, `/custom-audio/*` all return 200; unknown `/api/x` returns 404.
- `npm audit --omit=dev` clean (or each remaining finding explained).

**Files.** `server/src/index.ts`, new `server/src/pin-guard.ts`, `server/package.json`, `package-lock.json`, `web/src/pages/StorytellerPage.tsx`, `web/src/pages/HomePage.tsx`, `web/src/types.ts`, `server/src/types.ts`, `server/src/projection.ts`, `scripts/botc.ps1`, `server/src/join-info.ts`, tests.

**Risks.** `@fastify/static` major-version changes (option names, `wildcard` behaviour, `sendFile` decoration). Throttle must not lock out the real Storyteller for long (cap the back-off).

---

## 2. Finish and commit half-done work

- [x] Status: done (Oct 15)

**Done.**
- Day-2 plate documented in `docs/TV_SCENE_PLATES.md` (plate table, phase-to-plate table with day 1 vs day 2+, fallback rule). Rendered check: a test game driven to day 1 and day 2 shows `tv-plate-day` then `tv-plate-day2`; at 1920x1080 and 3840x2160 with 8 seats and 15 long-named seats, the hero plaque starts at x 35% and the town column at y 37%, clear of the baked logo (lettering x <= 30%, drips y <= 36.5%). Commit `e7f016a`.
- Narration work (Oct 6-9) committed as `7575b5f` after typecheck, 161/161 tests and build passed with it in the tree; diff scanned for API keys (none; keys come from environment variables).
- Untracked `docs/_tv_*.md` scratch files left alone.

**Goal.** No uncommitted work left over from Sep 30 - Oct 9.

**Scope.**
- Day-2 plate: document `bg-day2.png` (used when `dayNumber >= 2`, `hasLogo: true`) in `docs/TV_SCENE_PLATES.md`; take rendered TV screenshots on day 2+ and check the logo does not overlap the TV content.
- Commit the narration work (pickSoundOrFallback, first_night takes, Lives fallback, voice/mix tweaks, tie cue rewrites, `vol:` tags) as its own commit, after typecheck/tests/build pass.
- Leave the untracked scratch files `docs/_tv_*.md` alone.

**Acceptance.** Screenshots of day 1 and day 2 TV scenes; typecheck/tests/build green; two commits (day-2 plate, narration) pushed.

**Files.** `docs/TV_SCENE_PLATES.md` plus the 12 already-modified files.

**Risks.** Logo overlap on day 2 may need a layout tweak (`hasLogo` handling in `tv.css`).

---

## 3. Game action log

- [x] Status: done (Oct 15)

**Done.**
- `server/src/action-log.ts` + wiring in `server/src/index.ts`. Every Storyteller action is written to `data/logs/game-YYYY-MM-DD.jsonl` (rotates to `-2`, `-3`... past 2 MB; keeps the newest 30 files) with phase/day before and after, player ids resolved to "Name (seat N)", outcome `ok` / `rejected` (engine's `{ ok: false, message }`) / `no-change` (no state change) / `error` (thrown), new Storyteller notices and new chronicle events. Timer-driven changes (dawn-to-day, game over, timer end) are logged as `automatic`. Sign-ins (incl. wrong PIN / lock-out, never the PIN itself), TV/Storyteller connects and disconnects are logged too. `game:refresh` is skipped; slider bursts of `game:setAmbiance` are coalesced into one entry.
- Storyteller-only: sent live as `log:entry` to the Storyteller room and on request via `log:recent` (refused for unauthenticated sockets); the TV never receives it (tested).
- Storyteller page: new **Log** tab with filters All / Refused-errors / My actions / Game events.
- Launcher: `BOTC.bat log [-Lines N]` shows the game log (refusals red, no-effect yellow); `BOTC.bat log -Server` shows the raw server log; menu option 8 asks which.
- Log dir defaults to `logs` next to the session file; `BOTC_LOG_DIR` overrides (server and launcher), so tests never write to `data/logs`.
- Found while testing: `new ActionLog()` threw `ENOTDIR` if the log path wasn't a folder, which would have stopped the server at startup; now it just runs without a file.
- Tests: `action-log.ts` (7) + one more real-server case. 169/169 pass. Screenshots: `docs/tv-design/_verify/item3-gamelog/`.

**Goal.** A structured, human-readable record of every Storyteller/game action and its outcome, including rejected actions and why, so problems can be diagnosed from evidence.

**Evidence.** Server logs only record HTTP requests and the Hue stub; socket actions are not logged (`server/src/index.ts:277-292` only logs thrown errors; `data/logs/server.log` Oct 12 has no game actions).

**Scope.**
- `data/logs/game-YYYY-MM-DD.jsonl` (one JSON line per action) with rotation (by day and size; keep the newest N files).
- Each entry: time, action, sanitised args (player names resolved), outcome (`ok` / `rejected` + reason / `error`), phase/day before and after, auth failures (without the PIN typed).
- Rejected actions: engine methods that return `{ ok: false, error }` or emit a Storyteller notice are logged as `rejected`.
- Storyteller-only: never sent to the TV room; the Storyteller page gets a "Log" panel (last N entries via an authenticated socket request).
- `BOTC.bat log` / menu option 8 shows the game log as readable lines (with a switch for the raw server log).
- Never log the PIN, control token, or anything secret in public output.

**Acceptance.** Tests for the logger (format, rotation, redaction, rejected outcomes); live check shows entries for accepted and rejected actions; Storyteller panel screenshot; TV payload contains no log.

**Files.** new `server/src/action-log.ts`, `server/src/index.ts`, `web/src/pages/StorytellerPage.tsx`, `web/src/socket.ts`, `scripts/botc.ps1`, tests.

**Risks.** Log volume (vote toggles, timers); keep entries compact and skip `game:refresh`.

---

## 4. Reliability: pre-game check and disconnect handling

- [x] Status: done (Oct 15)

**Done.**
- `BOTC.bat check` (menu **C**, `-Full` adds the server tests): Node, dependencies, build up to date, port, firewall rule for node on Private networks (read-only), network profile, LAN addresses plus `/api/health` probe, then `server/src/preflight.ts` (config, default PIN, Hue, saved game parsed read-only, web build, TV plates, narration cue coverage for every cue family the engine plays, custom audio, game log folder writable). On this PC: 16 OK, 1 warning (default PIN), 1 problem (port 3847 held by another program, see Decisions).
- Bug found and fixed (evidence: `%TEMP%\botc_probe\buffer.mjs`): socket.io-client buffers emits made while disconnected and replays them on reconnect *before* the page re-joins as Storyteller, so the server refused them as unauthenticated and the tap was silently lost (or, if it had been accepted, it would have fired late). Now the client does not send while offline and tells the Storyteller ("A tap made while offline was not sent"); the server also answers unauthenticated actions with an error ack instead of no ack.
- Presence: `tvConnected` was tracked but never sent to the Storyteller (`projection.ts` only had `storytellerConnected`). New `presence` event (TV count, since-when). Storyteller page: Server/TV pills, offline banner, "TV is not connected (since HH:MM)" banner outside the lobby. TV: "Reconnecting…" badge. Both reconnect faster (max 3 s back-off) and immediately when the page becomes visible again.
- Stale PID: already reported by status and cleared by start/stop (verified with the real Oct 12 file, PID 20504, backed up first). A corrupt/unreadable PID file is now treated as stale too (tested).
- Live test (port 3916, temp session): kill server → banners on both screens; offline "2m talk" tap not sent (only the earlier 300 s timer is in the game log); restart → both recover, TV resyncs to `phase-day`; close TV → TV banner. No console errors.
- Tests: `preflight.ts` (2) + one more real-server case (presence and unauthenticated ack). 172/172 pass. Screenshots: `docs/tv-design/_verify/item4-reliability/`.

**Goal.** Before guests arrive, one command tells you whether tonight will work; during the game, dropped connections are obvious and recover on their own.

**Evidence.**
- Stale PID: `data/server.pid` (PID 20504, Oct 12) with nothing on 3847. `BOTC.bat status` already reports "stale PID file ... will be cleared on next start/stop", and `Start-BotcServer`/`Stop-BotcServer` clear it (`scripts/botc.ps1:394`, `:482`). Verify the remaining paths (menu header, `addresses`, `dev`) and test with a fake stale file.
- The engine already tracks `tvConnected`/`storytellerConnected` (`server/src/index.ts:163`, `:294-303`).

**Scope.**
- `BOTC.bat check`: Node version, dependencies, build fresh, server tests (optional `-Full`), port free or held by our server, firewall rule for node on Private networks, LAN address list and a reachability probe of `/api/health` on the LAN IP, plates and audio cues present, PIN not default, session file readable.
- Disconnect handling: Storyteller sees TV connected/disconnected with time since; TV and Storyteller show a banner while their socket is disconnected; socket.io reconnect re-joins and the server resends full state (resync); TV also re-fetches on `visibilitychange`.
- Stale PID: confirm and cover any path that doesn't clear it.

**Acceptance.** `BOTC.bat check` output on this PC; live test killing/restarting the server shows banners then recovery; screenshots.

**Files.** `scripts/botc.ps1`, `BOTC.bat`, `server/src/index.ts`, `web/src/socket.ts`, `web/src/pages/TvPage.tsx`, `web/src/pages/StorytellerPage.tsx`, CSS.

**Risks.** Firewall query needs no admin rights (read-only `Get-NetFirewallApplicationFilter` may be slow); keep it best-effort.

---

## 5. Storyteller tools: setup wizard, grimoire, undo, history

- [ ] Status

**Goal.** Faster, safer storytelling: set up a legal game in a minute, see the table as a grimoire, undo mistakes, review what happened.

**Scope.**
- **Setup wizard:** player count -> legal Townsfolk/Outsider/Minion/Demon distribution (Baron +2 Outsiders); random or hand-picked deal; Drunk's believed Townsfolk; Fortune Teller red herring; three Demon bluffs (not in play).
- **Grimoire view:** circle of seats with character, alive/dead, ghost vote, reminder tokens.
- **Undo:** server-side snapshots before each state-changing action (ring buffer); "Undo last action" restores the previous session, with a confirmation that names the action being undone.
- **Game history:** timeline built from the action log; end-of-game recap (who was what, deaths, executions, nominations).

**Acceptance.** Tests for the deal (legal counts for 5-15 players, Baron adjustment, Drunk/red herring/bluffs constraints) and undo (restores exact state, multiple steps, not across reset); screenshots of each panel.

**Files.** new `server/src/setup-wizard.ts`, `server/src/undo.ts`, `server/src/game.ts`, `server/src/index.ts`, `web/src/pages/StorytellerPage.tsx` (+ new components), tests.

**Risks.** Undo must not replay side effects (sounds, Hue) or roll back connection flags/timers incorrectly; StorytellerPage is 3,400 lines, so new UI goes in new files.

---

## 6. TV: idle motion, dramatic moments, end-of-game reveal

- [ ] Status

**Goal.** The TV feels alive and lands the big moments.

**Scope.**
- Idle motion: subtle fog drift, embers, candle flicker, slow parallax over the scene plates; disabled under `prefers-reduced-motion`; CSS transforms/opacity only so 4K stays smooth.
- Dramatic moments: Virgin execution, Slayer shot (hit and miss), Demon death, each a short full-screen sequence in the existing style.
- End-of-game reveal: seat-by-seat character reveal (name, character, alignment) with the existing art style.

**Acceptance.** Screenshots/recordings at 1080p and 4K viewport; reduced-motion check; no leak of characters before game end (projection tests).

**Files.** `web/src/pages/TvPage.tsx`, `web/src/pages/tv/*`, `web/src/pages/tv/tv.css`, possibly `server/src/projection.ts` for public moment events.

**Risks.** GPU cost on the TV's browser; keep layers few and animations compositor-only.

---

## 7. Rules narration length

- [ ] Status

**Goal.** A rules explanation that fits the target (8-9 min) or a short "quick rules" option.

**Evidence.** `rules_full.mp3` is about 665 s (11.1 min); chapters are separate cues already.

**Scope.** Planning only unless trivial: measure each chapter, propose cuts or a "quick rules" track built from a subset of chapters, write it up. Do not regenerate audio without asking.

**Acceptance.** A proposal section in `docs/NARRATION_SCRIPT.md` or here with per-chapter timings and options.

---

## 8. More scripts (Bad Moon Rising, Sects & Violets, custom JSON) - plan only

- [ ] Status

**Goal.** A complete plan in `docs/SCRIPTS_PLAN.md`, reusing the partial Sep 30 findings. Then stop for user decisions.

**Licensing note.** The repo is public (the user accepts that). Keep official icons out of git (fetch into a gitignored cache) unless the user decides otherwise.

---

## 9. Player phones - plan only

- [ ] Status

**Goal.** Copy the completed plan into `docs/PLAYER_PHONES_PLAN.md`. Do not build. List the design questions that must be answered first.

---

## Decisions needed from the user

- **Storyteller PIN is still the default `1234`.** The launcher, the pre-game check and the Storyteller page now warn. Change it with `BOTC.bat` → Settings (or `BOTC.bat set -Pin ...`).
- **Port 3847 is held by another program.** `BOTC.bat check` (Oct 15) found 127.0.0.1:3847 owned by `Cursor.exe` (a utility process started 14:32 that day) answering "BeatLock WLED bridge". I did not test whether BOTC can still bind `0.0.0.0:3847` alongside it (to avoid disturbing it), but at best `localhost:3847` on this PC would reach BeatLock instead of BOTC. Either move BeatLock to another port or change BOTC's port (`BOTC.bat set -Port 3900`). Left untouched.

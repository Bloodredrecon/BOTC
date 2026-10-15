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

- [x] Status: done (Oct 15)

**Done.**
- Before: Setup only set the player count and names; the Grimoire tab was a list of seat chips plus the editor; there was no deal, undo or recap.
- **Setup wizard** (`server/src/setup-wizard.ts`, `web/src/pages/storyteller/SetupWizard.tsx`): random or partly/fully hand-picked bag with official counts and the Baron adjustment; picks the Drunk's Townsfolk (not in play), the Fortune Teller's red herring (another good player; also when the Drunk thinks they are the Fortune Teller) and three bluffs (good, not in play, not the Drunk's Townsfolk). The preview is editable and stays on the phone (`game:previewDeal` is read-only, not logged). `game:applyDeal` re-validates on the server and only works in the lobby; it places "Is the Drunk", "Red herring" and the Imp's bluffs.
- **Grimoire circle** (`GrimoireCircle.tsx`): seats clockwise from the top, team-coloured tokens, †/shroud for the dead, a dot for an unused ghost vote, up to 3 reminder tokens, Drunk "as X"; bluffs and red herring in the centre. More than 10 seats switch to a taller ellipse; checked at 15 seats on a 390 px phone (no overlapping tokens).
- **Undo** (`server/src/undo.ts`, wired in `index.ts`, `UndoBar.tsx`): a snapshot is taken before every Storyteller action and kept only if the action succeeded and changed the game (30 steps; name/notes typing merges into one step). Undo asks first and names the action. It keeps the current sound mix and connection flags, never replays sounds/Hue, drops a timer that already ran out (it would replay the timer-end sound), and cancels pending automatic steps (dawn to day, night after execution, Slayer result, game over) with a notice. Not undoable: sounds, ambiance, scenes, notices, New game. New game clears the history.
- **History tab**: Recap (winner, each player's character with "started as" from new `startingCharacters` recorded at the first night, the Drunk's believed role, fate, day by day nominations/votes/executions/deaths) and the existing action log.
- Also fixed: a custom `BOTC_SESSION_PATH` in a folder that doesn't exist crashed the server at startup (`ENOENT` in `saveSession`, seen in the live check); it now creates the folder. The action log now shows a deal as "Ada (seat 1)=drunk (thinks chef), ..." instead of 600 characters of JSON.
- Tests: `setup-wizard.ts` (7: 3,300 random deals for 5-15 players, Baron, Drunk, red herring, hand-picked, validation, apply), `undo.ts` (5), one real-server case (preview/apply/undo/reset, TV never sees undo state), one action-log check. 185/185 pass.
- Live check (port 3917/3918, temp sessions): Baron+Drunk+Fortune Teller for 8 players gave T3/O3/M1/D1; an emptied bluff was refused with "Pick exactly three bluffs."; undo of "Resolve vote" went back to the open vote with 5 hands; recap correct. No console errors. Screenshots: `docs/tv-design/_verify/item5-storyteller-tools/`.

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

- [x] Status: done (Oct 15)

**Done.**
- Before: the TV only had candle flicker and a hero fade-in; a Slayer shot was only a sound cue plus a Gazette line, and the board/Gazette showed the target dead (or "nothing happens") as soon as the shot was fired, while the 8.4 s shot cue was still playing. A Virgin execution looked like any other execution. The end reveal appeared all at once.
- **Public events** (`server/src/game.ts`, `types.ts`): new `slayer_shot` event (shooter, target, `hit` = the target died; never why) and `virgin: true` on the Virgin's execution. Both are things the whole table sees in real play. A hit on the Imp with a Scarlet Woman alive shows only "X falls" (the existing plain death cue is kept). The action log, Gazette and recap describe both.
- **Moments** (`web/src/pages/tv/moments.tsx`): Slayer "takes aim" (8.4 s, in time with the shot cue; the town board and Gazette are hidden meanwhile) then "The shot rings true / X falls" or "The shot rings out / Nothing happens"; "The Virgin's purity"; "The Demon is slain" when good wins with "The Demon is dead.". Events already in the log when the TV loads are never replayed.
- **End reveal**: seats reveal one by one (0.5 s apart) with a gold/red glow by alignment, after the Demon-slain moment.
- **Idle motion** (`tv.css`, `Atmosphere.tsx`): plate zoom 1.00 to 1.03 about the centre over 80 s (a baked logo only moves outward), drifting fog banks, 12 embers at night/dusk/execution/evil wins. Transform/opacity only. Off under `prefers-reduced-motion` (moments and the reveal then appear without animation) and with `/tv?motion=off`.
- Tests: `tv-moments.ts` (8): no reveal or private player keys in any phase before the end; reveal at the end; Slayer hit on the Imp with the Scarlet Woman alive leaks no "imp/demon/scarlet/slayer/minion" text to the TV; miss and bluffed shot recorded; Virgin flag (and not on normal executions); win reason; action-log lines. 193/193 pass.
- Live check (port 3919, temp session; 1920x1080, 3840x2160, and 1080p with reduced motion emulated): miss, Virgin, Scarlet Woman takeover, Demon slain, staggered reveal, reload at the end (no replay), `?motion=off` (0 idle animations). Running animations only touch `transform`/`opacity`. Headless Chrome held 60 fps at both sizes, but that is software rendering, not the TV's GPU; if the TV stutters, use `?motion=off`. No console errors. Screenshots: `docs/tv-design/_verify/item6-tv/`.

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

- [x] Status: done (Oct 15) with **option A** (the user's choice). No new recording; `rules_full.mp3` unchanged.

**Done.**
- `data/audio/rules_quick.mp3`: 474.7 s (7:55), 192 kbps, made with the same ffmpeg stream-copy join as `rules_full.mp3` (no gaps or loudness change) from Overview, Teams, Setup, Night, Day, Execution, The dead, Winning, Etiquette. Like all audio it is gitignored, so it stays on this PC.
- `scripts/generate_narration.py`: `RULES_STITCHES` lists both stitched tracks; `python scripts/generate_narration.py --stitch-only rules_quick.mp3` rebuilds it with ffmpeg only (no API key, no TTS). A full batch run now re-stitches both.
- Cue `rules_quick` "Quick rules (~8 min)" in `server/src/audio-library.ts` (Rules teach group, "Play all"); Storyteller **Rules** tab has a **Play quick rules (~8 min)** button under Play full rules, and the quick track is kept out of the chapter list. Entry added to `docs/NARRATION_SCRIPT.md` section C (parsed as a stitch, never sent to TTS).
- Live check (port 3920, temp session): `/custom-audio/rules_quick.mp3` 200 `audio/mpeg` 11,393,324 bytes, range requests 206; the button made the TV play `rules_quick.mp3`; no console errors. Screenshot: `docs/tv-design/_verify/item7-quick-rules/`. 193/193 tests pass.

**Measured** (exact MP3 frame count, all 48 kHz 192 kbps; words and pauses counted from `docs/NARRATION_SCRIPT.md` section C):

| Chapter | Seconds | Words | Scripted pauses |
|---|---|---|---|
| 1. Overview | 51.1 | 111 | 4.2 s |
| 2. Teams | 53.6 | 114 | 5.0 s |
| 3. Setup | 52.1 | 111 | 5.2 s |
| 4. Night | 76.3 | 175 | 7.6 s |
| 5. Day | 71.0 | 166 | 6.8 s |
| 6. Execution | 55.3 | 130 | 4.2 s |
| 7. The dead | 35.4 | 76 | 3.4 s |
| 8. Abilities | 130.9 | 300 | 6.0 s |
| 9. Winning | 37.5 | 73 | 5.0 s |
| 10. Travellers | 59.7 | 125 | 3.8 s |
| 11. Etiquette | 42.7 | 81 | 3.6 s |
| **Total** | **665.6** | **1,462** | **54.8 s** |

`rules_full.mp3` is 665.3 s: it is the eleven chapters joined back to back (`stitch_rules_full()` in `scripts/generate_narration.py`, ffmpeg concat, no re-recording). The chapters fit "0.40 s per word + the scripted pauses + about 3 s per chapter" to within 4 s each, so a cut of N words saves about 0.4 x N seconds. Each chapter ends with about 1 s of silence; an ambience bed runs under the voice, so silences can't be trimmed reliably. The target of 8-9 min (480-540 s) means cutting 126-186 s.

**Option A - "Quick rules" from the existing chapters (no new voice, no cost).** Join a subset of the recorded chapters:
- Overview, Teams, Setup, Night, Day, Execution, The dead, Winning, Etiquette = **475 s (7.9 min)**. This leaves out Abilities (131 s; the TV character sheet and the Storyteller cover it) and Travellers (60 s; play it only when a Traveller arrives).
- Without Setup and Etiquette (the Storyteller says these in person) = **380 s (6.3 min)**.
- Either as a new `rules_quick.mp3` made the same way as `rules_full.mp3` (ffmpeg concat of existing files), or as a "Quick rules" button that plays the chapters one after another (needs a small play-queue in the app; today each cue is a single file).

**Option B - Tighten the full teach to about 8.1 min (re-record 6 chapters).** Proposed edits, estimated with the model above:
- Travellers moves out of the full teach (still its own cue): -60 s.
- Abilities 300 -> about 170 words: keep only what changes public play (Virgin, Slayer, Saint, Mayor, Scarlet Woman, Imp star-pass, drunk/poisoned); the rest is on the character sheet: -52 s.
- Night 175 -> about 130 words: -18 s. Day 166 -> about 130 words: -14 s.
- Etiquette 81 -> about 45 words (secrecy and "ask me" are already in Setup and Day): -15 s.
- Setup 111 -> about 85 words: -10 s. Teams: drop the two win lines repeated in Winning: -8 s.
- Total about -177 s, so about **489 s (8.1 min)**. Needs about 650 new words (about 3,700 characters) of ElevenLabs voice for 6 chapters (Teams, Setup, Night, Day, Abilities, Etiquette), then a re-stitch of `rules_full.mp3`.

**Option C - Only drop Travellers from `rules_full.mp3`.** Change the stitch order and re-stitch: **606 s (10.1 min)**. No new voice, but still over the target.

**Recommendation.** A first (free, keeps the current recordings), with Travellers played only when needed; B later if the full teach must hit 8-9 min. **Decision (Oct 15):** option A.

**Goal.** A rules explanation that fits the target (8-9 min) or a short "quick rules" option.

**Evidence.** `rules_full.mp3` is about 665 s (11.1 min); chapters are separate cues already.

**Scope.** Planning only unless trivial: measure each chapter, propose cuts or a "quick rules" track built from a subset of chapters, write it up. Do not regenerate audio without asking.

**Acceptance.** A proposal section in `docs/NARRATION_SCRIPT.md` or here with per-chapter timings and options.

---

## 8. More scripts (Bad Moon Rising, Sects & Violets, custom JSON) - plan only

- [x] Status: plan written (Oct 15) in `docs/SCRIPTS_PLAN.md`; stopped for the 10 decisions at its end. Nothing built; no icons or official data were added to git (official JSON was only downloaded to a temp folder for the research).

**Goal.** A complete plan in `docs/SCRIPTS_PLAN.md`, reusing the partial Sep 30 findings. Then stop for user decisions.

**Licensing note.** The repo is public (the user accepts that). Keep official icons out of git (fetch into a gitignored cache) unless the user decides otherwise.

---

## 9. Player phones - plan only

- [x] Status: plan copied (Oct 15) to `docs/PLAYER_PHONES_PLAN.md` with a note of what changed since (PIN hardening done, line references moved, undo to account for). Not built. Its 12 design questions (section 6) must be answered first: phones at night at all; re-peeking your character (the proof-by-phone problem); night-info journal after dawn; seat-claim approval; re-binding phones on a new game; where notes are stored; phone voting; hold-up fallback; Spy grimoire on the phone; plain HTTP without Wake Lock vs self-signed HTTPS; messaging; silent by default.

**Goal.** Copy the completed plan into `docs/PLAYER_PHONES_PLAN.md`. Do not build. List the design questions that must be answered first.

---

## Decisions needed from the user

- **Storyteller PIN is still the default `1234`.** The launcher, the pre-game check and the Storyteller page now warn. Change it with `BOTC.bat` → Settings (or `BOTC.bat set -Pin ...`).
- **More scripts (item 8):** the 10 questions at the end of `docs/SCRIPTS_PLAN.md` (first script, automation level, custom imports, icons, official text in the public repo, repo visibility, Travellers, madness, narration, jinxes).
- **Player phones (item 9):** the 12 questions in section 6 of `docs/PLAYER_PHONES_PLAN.md`.
- ~~Rules narration length (item 7)~~: decided Oct 15, option A (done).
- **Port 3847 is held by another program.** `BOTC.bat check` (Oct 15) found 127.0.0.1:3847 owned by `Cursor.exe` (a utility process started 14:32 that day) answering "BeatLock WLED bridge". I did not test whether BOTC can still bind `0.0.0.0:3847` alongside it (to avoid disturbing it), but at best `localhost:3847` on this PC would reach BeatLock instead of BOTC. Either move BeatLock to another port or change BOTC's port (`BOTC.bat set -Port 3900`). **Decided Oct 15:** BOTC keeps 3847; the user will move or close BeatLock.

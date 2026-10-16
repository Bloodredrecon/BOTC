# Plan: player phones (private character reveal, night info, notes, optional phone voting)

Status: **decided Oct 15, being built phase by phase** (see section 6 for the decisions and the revised phases; progress is ticked in `docs/ROADMAP.md` item 9).

Copied unchanged from the completed planning session of Oct 12. Since then:
- **Line references are from the Oct 12 code** (before roadmap items 1-6) and many have moved; re-check them before building.
- **Section 2, rule 7 (PIN hardening) is done** (roadmap item 1): per-IP throttle with back-off, constant-time compare, no default-PIN hint, default-PIN warnings in the launcher, server log and Storyteller page, and a de-emphasised home-page link. Phase 0 still needs everything else (`gameId`, the `player` role, `toPlayerState`, private emits).
- **"150 checks"** is now 193 (`npm test` runs them all, `server/test/run-all.ts`). `server/test/server-security.ts` now starts the real server and drives Socket.io clients, which is the base the socket integration tests in section 5 need.
- Roadmap item 4 added connection presence for the Storyteller and TV; item 5 added undo, which a phone feature must not break (undo restores a snapshot, so private phone data needs a rule for what undo does to it).

This can be built on the current architecture. Three things have to come first:

- **A per-player projection that only copies allowed fields.** Today the Storyteller gets the whole `Player` object, which includes the true character, reminders and notes.
- **Storing what was actually sent to each player.** The night composer currently lives only in the Storyteller's React state, so the server never knows what a player was shown.
- **Hardening the Storyteller PIN.** Once players' phones use the same address, the PIN becomes the easiest thing to attack. The details are in section 2.

The biggest open question is a game-design one, not a technical one. A phone that always shows your character is proof of identity, and BOTC is designed so that proof doesn't exist.

---

## 0. Current state (evidence)

**Sessions and players**
- The whole game is one `GameSession` (`server/src/types.ts:278-330`). It is saved to `data/session.json` after every change (`game.ts:360-381`, `persistence.ts:250-254`). The session path can be overridden with `BOTC_SESSION_PATH` (`persistence.ts:16`).
- A `Player` (`types.ts:40-61`) holds public and secret fields side by side: `characterId`, `reminders` (Poisoned, Is the Drunk, Red herring…), `notes` (the Storyteller's grimoire notes), `bluffs`, `thinksCharacterId` (the Drunk), `alignment` (Travellers) and `voteTokens`.
- Player IDs are predictable (`p1…pN`, from `persistence.ts:150-157` and `game.ts:464-469`). They are regenerated on `resetGame` (`game.ts:426`). `moveSeat` changes seat numbers but keeps the ID (`game.ts:476-491`). So a phone should be bound to a **playerId plus a secret token**, never to a seat number.

**Socket.io protocol and auth**
- `join` accepts only the roles `"tv"` (no auth) and `"storyteller"` (`index.ts:159-177`). `ClientRole` is `"storyteller" | "tv"` (`types.ts:486`).
- The PIN check is a plain comparison with no rate limit (`index.ts:168`). The default PIN is `1234` (`config/default.json`), and the PIN screen tells whoever opens it "Enter the PIN (default 1234)" (`StorytellerPage.tsx:341`). The home page links to `/storyteller` (`HomePage.tsx:15`).
- Every `game:*` action is blocked unless the socket is the authenticated Storyteller (`index.ts:179-181`, `277-292`).
- On every change the server broadcasts two payloads: `state:public` to the `tv` room and `state:storyteller` to the `storyteller` room (`index.ts:153-156`). `emit()` increments `seq` and builds both (`game.ts:383-397`).

**What is safe to send, and to whom**
- `toPublicState` (`projection.ts:179-251`) is already safe to send to everyone:
  - Players carry only id, seat, name, alive, ghost vote and Traveller name (`:198-210`).
  - Overnight deaths stay hidden until dawn is announced (`publicAlive`, `:38-47`; `overnightDeathsArePublic`, `:27-31`).
  - Death causes are removed (`sanitizePublicLog`, `:50-77`).
  - Characters appear only when the game has ended (`reveal`, `:240`).
- `toStorytellerState` passes `players: session.players` through unchanged (`projection.ts:267`), plus `night` with its truth fields. **None of this may reach a phone.**

**The night "show to player" flow**
- The server builds a `NightShowSpec` for each step (`night.ts:455-838`). When the woken player is drunk or poisoned, `applyImpairedInfoShow` (`night.ts:180-261`) puts the lie in `suggested*` and the real answer in `truth*`, `stWarning` and `registration`. The type itself warns that these must never go to the player (`types.ts:100-122`).
- Player-facing text already exists as separate fields: `playerTitle`, `playerPrompt` and the label fields (`types.ts:126-141`).
- What the player is actually shown is **ephemeral React state** in `NightTab` (`StorytellerPage.tsx:1077-1091`), filled by `applyShowDefaults` (`:1204-1245`).
- Fortune Teller yes/no is computed in the Storyteller's browser from full grimoire data (`:1281-1295`).
- For player choices, the Storyteller taps on the player's behalf and presses Confirm. That calls `game:applyNightReminder` or `game:otherDeath`, then `markNightStepDone` (`:1303-1344`; server side `game.ts:947-977`, `1016-1045`).
- The hold-up overlay is `:1968-2184`. The Spy's grimoire view lists every character and reminder (`:2120-2140`).
- A new Demon (Scarlet Woman or star-pass) gets a "You are the Imp" message step (`night.ts:884-904`).
- There is currently no in-app character-reveal step; characters are handed out with physical tokens.

**Voting**
- The Storyteller toggles hands in any order (`StorytellerPage.tsx:3283-3312` → `game:toggleVote` → `game.ts:1596-1619`):
  - Ghost votes are tracked by `canPlayerVote` (`projection.ts:295-300`) and spent only when the vote is resolved (`game.ts:1650-1656`).
  - A living Beggar without a token is refused, with a Storyteller notice (`game.ts:1611-1614`). Token donation privately tells the Storyteller the donor's alignment (`game.ts:805-831`).
- An illegal Butler hand still counts, and only the Storyteller sees a warning (`rules.ts:192-201`).
- Bureaucrat ×3 and Thief −1 weights come from reminders, and only while that Traveller lives (`rules.ts:209-225`).
- On the TV, studs are placed in clockwise order (`tv/model.ts:174-180`) and light up the moment a hand is toggled (`tv/stages.tsx:132-148`). **There is no clock-hand sweep today.**

**Join info and launcher**
- `joinBaseUrls` works out the LAN URLs (`join-info.ts:43-51`). The only QR code is printed in the terminal and points at `/` (`join-info.ts:94-100`).
- `/api/config/public` returns only the script name and port (`index.ts:54-57`).
- There is no browser QR library (only `qrcode-terminal` on the server), and no HTTPS.

**Tests**
- Engine tests run with `tsx` via `server/test/_harness.ts`. It uses a temp session (`:9-10`), a broadcast recorder (`:40-45`) and 150 checks (commit `f52b31c`).
- `scripts/tv_drive.mjs` already drives the Storyteller with `socket.io-client`.
- No socket-level multi-client tests exist, and no Playwright or Puppeteer is installed.

**Official BOTC guidance used below**
- Players take a seat by clicking "Click to Claim", and anyone else is a spectator. Setting a token on a player in the official app is "just for you to see… handy for taking notes". There are no chat dings at night by default. Whispers only go to neighbours or the Storyteller. ([BOTC.APP instructions](https://beardytas.com/botc-app-instructions/))
- In the official app, night info arrives as silent "Night Cards". The player answers a choice or presses **GOT IT**, and night info can be reopened during the night but disappears in the day. ([r/BloodOnTheClocktower: Advice for online play](https://www.reddit.com/r/BloodOnTheClocktower/comments/1ox0z60/advice_for_online_play/); this is a community description.)
- The app has special modes for `distribute-roles` (handing out characters as an explicit action), `hidden` votes, and `multiplier` votes for Bureaucrat/Thief. ([release.botc.app](https://release.botc.app/))
- "If a player's alignment or character changes, they learn this at the earliest opportunity, in secret" (Rulebook, "The player learns of changes").
- "No peeking. Please keep your character token a secret" ([Rules Explanation](https://wiki.bloodontheclocktower.com/Rules_Explanation)). Players "cannot look at each other's character tokens" ([Glossary](https://wiki.bloodontheclocktower.com/Glossary)). A widely used community rules script adds: "…you cannot simply prove who you are!" ([DIY rules explanation](https://diy.bloodontheclocktower.rocks/reference/rules-explanation.html))
- Voting goes clockwise from the player after the nominee, and ends with the nominee. A hand counts if it is up when the Storyteller's hand reaches it. Dead players get one vote for the rest of the game. ([Rules Explanation](https://wiki.bloodontheclocktower.com/Rules_Explanation), [Glossary](https://wiki.bloodontheclocktower.com/Glossary))
- The Butler may raise their hand only if their Master's hand is up or has already been counted ([Butler](https://wiki.bloodontheclocktower.com/Butler)).
- Browser limits that matter here:
  - The Screen Wake Lock API only works on HTTPS ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Screen%5FWake%5FLock%5FAPI)), and this app serves plain HTTP.
  - iOS Safari has never supported `navigator.vibrate` ([caniuse](https://caniuse.com/mdn-api_navigator_vibrate)).
  - `crypto.randomUUID` also needs HTTPS, so tokens must be generated on the server.

---

## 1. Player identity and joining

**Recommended flow**
1. **Join screen on the TV (lobby only):** one QR code and a 4-character join code pointing at `/play?c=K7QX`.
   - The server adds `joinUrl` to `/api/config/public`, reusing `joinBaseUrls`.
   - The web app needs a small QR library (for example `qrcode`).
   - I would avoid a QR per seat on the TV: anyone could scan anyone's seat.
2. **Claim a seat:** the phone lists the seats (public names only) and the player taps theirs, sending `player:claim {joinCode, playerId}`.
   - By default the claim waits for Storyteller approval. The Setup tab shows "Seat 3 (Cora) wants to join from 'iPhone Safari'", with Approve and Deny.
   - An optional "auto-approve while claims are open" mode skips that.
3. **Token:** on approval the server creates `randomBytes(24).toString("base64url")` and stores only its SHA-256 hash. The raw token goes back once in the ack, and the phone keeps it in `localStorage` under `botc.player.<gameId>`.
4. **Reconnect:** on every Socket.io `connect` the phone sends `join {role:"player", token}`. Sleep, refresh and Wi-Fi drops all recover without asking the Storyteller. The phone also reconnects on `visibilitychange` when the page becomes visible.
5. **Storyteller controls** (new device panel per player: connected dot, last seen, device label):
   - Revoke (deletes the hash and disconnects the socket)
   - Reassign
   - Hand over, which generates a one-time code for a replacement phone
   - Rotate join code
   - Close claims
6. **Multiple devices:** one active token per seat by default, and a new claim replaces the old one only after Storyteller approval. The Storyteller can allow a second device for a seat (for example a shared tablet).
7. **Spectators:** a "Watch" button on `/play` gives a read-only public view. It uses the same projection as the TV, but with no audio.
8. **New game / reset:** `resetGame` rebuilds the players (`game.ts:426`). Either clear all claims, or re-bind them by seat number when the Storyteller ticks "same table". This is question 5.

**Data model (server)**

```ts
type SeatClaim = {
  playerId: string;
  tokenHash: string;        // sha256; raw token never stored or projected
  deviceLabel: string;      // from user agent, e.g. "iPhone Safari"
  status: "pending" | "active" | "revoked";
  claimedAt: number;
  lastSeenAt: number;
};
// GameSession additions
gameId: string;             // random per createEmptySession; scopes phone storage
joinCode: string;
claimsOpen: boolean;
claims: SeatClaim[];
```

## 2. Security and privacy model

**Threat model:** friends at the table, on the same LAN, possibly opening DevTools on their own phone, or opening `/storyteller` or `/tv`.

**Out of scope:** Wi-Fi packet sniffing (plain HTTP is visible to anyone doing that), and someone grabbing an unlocked phone.

**Rules the build must follow**
1. **Per-socket delivery.** Each player's socket joins the room `player:<id>` and receives only `state:player` built by a new `toPlayerState(session, script, playerId)`.
   - It is based on `toPublicState` (so it inherits death hiding and log sanitising) plus a `me` block built from an **allowlist**.
   - It must never spread a `Player` or copy a `NightShowSpec`.
   - Player sockets never join `tv` or `storyteller`.
2. **The server decides who the player is.** Every `player:*` handler reads `socket.data.playerId`, which is set only after the token is verified, and ignores any `playerId` in the payload. `player:*` is a separate handler map; the `game:*` guard (`index.ts:277-292`) stays as it is.
3. **What the player was told is stored separately from the truth.** `me.character` comes from a stored `revealedCharacterId`, set only by an explicit "Distribute", a "You are" card, or "Re-send". It is not derived live from `characterId`. This is needed because:
   - The Storyteller's Setup edits (still shuffling the bag) would otherwise leak live.
   - A star-pass would otherwise show up before the new-Demon wake. The rulebook says changes are learned in secret, at the earliest opportunity.
4. **Night cards contain only what was composed.** The card is built on the server from the composed values and the player-text fields of the spec. It never contains `truth*`, `stWarning`, `registration`, `hint`, `suggested*`, reminders or notes.
5. **Other players' status** comes only from the public projection, so a killed player's own phone uses `publicAlive` too.
6. **Private changes emit privately.** Add an emit that goes only to the Storyteller and the affected player, without rebroadcasting public state. Otherwise every night card also bumps `seq` on every phone and the TV (`game.ts:384`), which lets someone watching network traffic count night actions.
7. **Harden the Storyteller PIN (Phase 0):**
   - Throttle failed attempts per IP and socket (for example 5 tries, then exponential back-off).
   - Remove "(default 1234)" from the PIN screen.
   - Warn in the launcher and the Storyteller UI while the PIN is still `1234`.
   - Remove the `/storyteller` link from the home page, or hide it behind "Storyteller? tap 3×".
   - Today a phone on the LAN could try all 10,000 PINs in seconds (`index.ts:168`).
8. **Phones keep only the token and notes.** Game state stays in memory, so nothing private is left in browser storage after the game.
9. **HTTPS:** not in the MVP, because self-signed certificates cause scary browser warnings. The cost is no Wake Lock and a sniffable token. This is question 10.

## 3. Features

Effort: S is about a day or less, M is 2–4 days, L is about a week or more. All sizes assume the Phase 0 plumbing exists.

| Feature | Effort |
|---|---|
| Player plumbing (join/claim/token/revoke, `toPlayerState`, per-socket emit, `/play` route) | M |
| Private character reveal (including Drunk and Travellers) | S–M |
| Night cards: info delivery with acknowledgement | M |
| Night cards: player choices with Storyteller confirm | L |
| Notes (claims grid and free text) | M |
| Phone voting with clockwise sweep | L |
| Extras: rules and character sheet, dead view, message the Storyteller | S–M each |

### 3a. Private character reveal (S–M)

- **UX:** the card reads "Hold to reveal". While held, it shows the character name, team, alignment and ability text; it hides on release or after 5 seconds.
  - Below that: the script's character sheet (reuses `buildPublicSheet`, `projection.ts:162-175`).
  - Evil players also see their team: Minion/Demon info cards and Demon bluffs from the journal.
- **Server:**
  - New action `game:distributeCharacters`. It is blocked while `setupWarning` is set, or while a Drunk has no `thinksCharacterId`.
  - It snapshots `revealedCharacterId = wakeCharacterId(p)` (`rules.ts:43-46`), so the Drunk sees their believed Townsfolk and never "drunk".
  - Alignment shown: residents follow the shown team (the Drunk sees good, which is true). Travellers see `p.alignment` privately (`types.ts:56`); their character is already public.
  - A "Re-send character" button in the player editor covers late fixes.
  - The new-Demon step (`night.ts:884-904`) sends a "You are the Imp" card that updates `revealedCharacterId`.
- **Data:** a `PlayerPrivate` record per player (see 3b).
- **Game-design risk:** "show me your phone" becomes hard proof. A Demon won't show theirs, but a good player can prove good, which breaks bluffing. The official app avoids this because players can set any token on any seat, including their own. Options:
  - Always viewable
  - Viewable until the first dawn, then only during your own night cards
  - Viewable only once

  This is question 2.

### 3b. Night info on the player's phone

**UX, per the official Night Cards model.** At night every phone shows the same dark "Eyes closed" screen. A card arrives **silently**: no sound or vibration by default, and iOS can't vibrate anyway. The screen does not change until the player taps "I'm awake". The Storyteller still wakes players with a shoulder tap as usual, and phones stay face-down at night.

**Info kinds** (number, yes-no result, pair and character, character, message, Minion/Demon info, Spy grimoire):
1. The Storyteller composes exactly as today, including the lie pre-filled when the player is impaired.
2. Next to "Show to X", a new **"Send to X's phone"** button appears when X has a connected device.
3. The server builds the card, and the phone shows it with the same labels as the hold-up overlay.
4. The player presses **Got it**, and the Storyteller sees a ✓, then presses Done → next.
5. If there's no ✓ after N seconds, the Storyteller sees "Not seen — hold up your phone instead".

**Choice kinds** (Fortune Teller picks 2, Ravenkeeper picks 1, Monk, Poisoner, Imp, Butler, Bureaucrat, Thief):
1. The Storyteller presses "Ask on phone".
2. The card shows a picker with min/max limits and "not yourself" where it applies (the same list as `StorytellerPage.tsx:1409-1414`).
3. The player submits `player:choose`, which is stored as `pendingChoice`.
4. The Storyteller's composer auto-fills `infoPlayers` and shows "Player chose A, B".
5. The Storyteller then does what they do today:
   - **Confirm** runs the existing `applyNightReminder` / `otherDeath` path, including star-pass and Mayor-bounce prompts (`:1303-1344`), and the phone gets "Done — go back to sleep".
   - **Fortune Teller / Ravenkeeper:** the Storyteller reviews the answer (lie defaults when impaired, `:1260-1295`) and presses "Send answer", which updates the same card.
6. The Storyteller can always override a choice, for example if the player mis-tapped and said so.

**Server changes**
- New `player:awake`, `player:ack` and `player:choose` handlers.
- New `game:sendNightCard {playerIds, composed}`, `game:answerNightCard` and `game:closeNightCard` actions.
- A pure `buildNightCard(spec, composed, session, script)` function next to `night.ts` that copies names, ids and public character text, and nothing else.
- Group wakes (Minion info) send one card to each Minion.

**Data**

```ts
type NightCard = {
  id: string; night: number; stepId: string;
  title: string; prompt?: string;
  ask?: { min: number; max: number; notSelf: boolean };
  players?: { label: string; ids: string[] };
  character?: { label: string; id: string };        // id → public sheet text
  number?: { label: string; value: number };
  yesNo?: { label: string; value: "yes" | "no" };
  bluffs?: { label: string; ids: string[] };
  fellow?: { label: string; ids: string[] };
  message?: { label: string; text: string };
  grimoire?: { name: string; character: string; reminders: string[]; dead: boolean }[]; // Spy only
  status: "sent" | "awake" | "chosen" | "answered" | "acked" | "closed";
};
type PlayerPrivate = {
  revealedCharacterId: string | null;
  revealedAlignment: "good" | "evil" | null;
  cards: NightCard[];                 // journal (retention: question 3)
  pendingChoice: { cardId: string; playerIds: string[]; at: number } | null;
  inbox: { from: "st" | "player"; text: string; at: number }[];
};
// GameSession.private: Record<playerId, PlayerPrivate>
```

**Also private-card candidates:** the Beggar's alignment result (currently only a Storyteller notice, `game.ts:828`) and the evil Traveller's Demon info.

**Effort:** info cards M, choice cards L. It touches the 1,150-line `NightTab`, so extracting the composer into its own component first is worth it.

### 3c. Notes (M)

- **UX:** a claims grid with one row per seat, from public names:
  - Claimed character (token picker from the script)
  - Good / evil / unknown marker
  - Free text
  - Quick tags ("voted X", "nominated Y")
  - Plus a free-text "My notes" pad
  - Auto-filled public facts: nominations and results from `nominationsToday` and `publicLog`
- **Voter lists:** optionally add `voterIds` to the public `vote_result`. Hands are public at the table anyway, and the official app shows them.
- **Storage recommendation: device only** (`localStorage` keyed by `gameId` and seat).
  - The server and the Storyteller never see the notes, and they reset when a new game starts.
  - They are lost if the player switches phones; an optional "export/import" QR code or file covers that.
  - Server storage would survive a device swap, but the notes would end up in `session.json` on the Storyteller's PC.
- **Naming:** use a different name from `Player.notes`, which holds the Storyteller's grimoire notes.

### 3d. Optional phone voting (L)

- **UX:**
  1. The phone shows a big **Raise hand** toggle.
  2. The TV shows raised hands live, as a faint glow.
  3. A server-timed clock sweep walks `voteOrder` (clockwise from after the nominee, nominee last) and **locks** each seat in turn: lit if the hand is up, otherwise dim.
  4. The existing studs and rising/majority cues carry on as before.
- **Server:**
  - `nomination.sweep = { startedAt, msPerSeat, index, paused }` plus `handsUp: string[]`.
  - Each lock runs the existing `toggleVote` checks (`game.ts:1596-1619`): ghost vote, Beggar token, living-player rules. The Storyteller's manual toggles stay authoritative, and they can pause, rewind or override any seat.
  - The resolve and force buttons are unchanged (`StorytellerPage.tsx:3315-3339`).
- **Rules handling:**
  - Ghost votes: a dead player's phone shows "1 ghost vote left" or "spent".
  - Beggar: the button is disabled with a private "you need a vote token".
  - Butler: never blocked (blocking would out the Butler). Optionally the Butler's own phone gets a private "your Master's hand is down" hint. The Storyteller still gets the warning.
  - Bureaucrat/Thief weights stay on the server (`rules.ts:209-225`), and phones just raise a hand.
- **Risks:**
  - Players forgetting their phone, or the phone asleep: iOS drops background sockets, and there's no Wake Lock over HTTP.
  - People no longer watching each other's hands.
  - Latency is negligible on a LAN.
- **Fallback:** a mixed mode. Seats without a connected device are marked "manual" on the Storyteller screen, and the Storyteller taps those. A "Phones off" switch goes back to fully manual voting, as it works today.

### 3e. Extras

- **Character sheet and night-order reference (S).** It comes from public script data. Showing the night order to players is optional, and I'd flag it.
- **"I'm dead" view (S).** It shows the ghost-vote status, a reminder that dead players can't nominate, and keeps the character and notes. It switches only when `publicAlive` flips.
- **Message the Storyteller / whisper request (S–M).** The player sends `player:message`, which lands in a Storyteller inbox with a badge, and the Storyteller can reply. A "Request a word" button notifies the Storyteller only.
  - There is no player-to-player chat. Whispers at the table are physical, and who talks to whom is public.
- **Keep-awake helper (S).** A "keep this screen on" tip, a low-battery dark theme, and a reconnect banner.

## 4. Phased rollout

1. **Phase 0 — Hardening and plumbing (S–M)**
   - Throttle PIN attempts, remove the default-PIN hint, add default-PIN warnings.
   - Add `gameId`.
   - Add the `player` role in `join`, a `player:*` handler map with its guard, per-player rooms, and private emits.
   - Add `toPlayerState` with the leak-test harness.
2. **Phase 1 — MVP: identity and character reveal (M)**
   - `/play` with join code, QR, claim, Storyteller approval, reconnect, revoke and the device panel.
   - Spectator view.
   - Distribute characters, hold-to-reveal, character sheet, dead view.
   - The night still uses hold-up.
3. **Phase 2 — Night info cards (M)**
   - Send, open and acknowledge for info kinds, and the Minion/Demon info and "You are" cards.
   - Hold-up stays as a per-player or global fallback.
4. **Phase 3 — Night choices (L)**
   - Asks from the phone with Storyteller confirm, for Fortune Teller, Ravenkeeper, Monk, Poisoner, Imp, Butler, Bureaucrat and Thief.
5. **Phase 4 — Notes and messaging (M)**
   - Device-only notes grid, public vote history, message the Storyteller.
6. **Phase 5 — Optional phone voting (L)**
   - Sweep, mixed mode, Storyteller override.

## 5. Test strategy

- **Engine and projection tests** (existing `tsx` harness, `server/test/_harness.ts`):
  - **Canary leak test:** give every player a distinct character, reminders (Poisoned, Is the Drunk, Red herring), notes and bluffs. Then, for each player and every phase, run `JSON.stringify(toPlayerState(...))` and check it contains no other player's `characterId` (except public Travellers, or after the game has ended), and none of `truth`, `stWarning`, `registration`, `hint`, `reminders`, `notes` or those reminder strings.
  - For every `NightShowSpec` kind, with and without `infoImpaired`: `buildNightCard` returns exactly the composed lie and no truth fields.
  - The Drunk's reveal shows `thinksCharacterId`. A star-pass doesn't change the phone until the "You are" card is sent.
- **Socket integration tests** (new): start the server on a random port with a temp `BOTC_SESSION_PATH` and `BOTC_PIN`. Connect a Storyteller, a TV, 5 players and 1 spectator via `socket.io-client`, and record every event per socket. Then check:
  - Isolation: no socket receives another player's private data.
  - Impersonation fails: a wrong or old token; `game:*` from a player socket; `player:choose` with someone else's id; claiming a seat that's already claimed.
  - Revoke disconnects the phone.
  - Reconnecting mid-night gets the pending card back.
  - PIN throttling kicks in.
  - Private card sends don't trigger a public emit.
- **Headless multi-browser run** (add Playwright): one browser with separate contexts for the Storyteller (tablet viewport), the TV (1920×1080) and 5–8 phones (iPhone and Pixel emulation).
  - Walk through: lobby → claim → distribute → night 1 (including a poisoned Empath lie and a Fortune Teller ask) → dawn → day → vote (Phase 5).
  - Save screenshots per client, like the existing `docs/tv-design/_verify` runs.
  - Simulate drops with `context.setOffline()`.
- **Real devices:** at least one iPhone (Safari) and one Android. Emulation won't reproduce iOS suspending sockets in the background or the screen auto-locking. Also do a table noise and brightness check at night.

## 6. Decisions (Oct 15) and the original questions

The user answered the questions on Oct 15. These decisions override anything above that disagrees with them.

| # | Question | Decision | Effect on the plan |
|---|---|---|---|
| 0 | (added) Can we fall back to the old way? | **Player phones are one opt-in setting, off by default**, stored in the session and switched on the Storyteller's Setup tab (default for new games: `playerPhones` in `config/local.json`, also in `BOTC.bat` Settings). | When off, the app behaves exactly as before: no join QR/code on the TV, `/play` says phones are off, player sockets get nothing private and claims are refused, no device panel, physical tokens, manual voting. Switching off mid-game sends phones a "phones turned off" screen and unbinds them from private data; claims are kept (switching back on re-links them) unless the Storyteller clears them; a running phone-vote sweep stops and hands already locked stay counted. Switching on mid-game works too. Finer fallbacks stay: seats without a connected phone vote manually, and a voting-only "Phones off" switch. |
| 1 | Phones at night? | **No.** Night stays hold-up. | Phones show a dark "eyes closed" screen at night and nothing else. Night cards, night choices, `buildNightCard` and the night-card tests are dropped. Questions 3, 8, 9 and 12 become moot. |
| 2 | Re-peeking your character | **Always viewable**, behind hold-to-reveal. | The user accepts the "show your phone as proof" trade-off. The card hides on release or after 5 seconds. |
| 3 | Night journal | Hide at dawn. | Moot while there are no night cards; recorded for later. |
| 4 | Seat claims | **Storyteller approves** each claim. | No auto-approve mode. |
| 5 | New game, same group | **Keep phone bindings by seat** when the Storyteller ticks "same table"; otherwise claims clear. | Same-table also keeps the seat names. |
| 6 | Notes | **Device only** (`localStorage`, keyed by game id and seat), with export/import. | Nothing about notes reaches the server. |
| 7 | Phone voting | **Yes, and people still raise real hands too.** | Phone hands feed a server-timed clockwise sweep matching the TV studs; Storyteller can pause, go back and override; seats without a connected phone are manual; a "Phones off" switch returns voting to fully manual. |
| 8 | Hold-up fallback at night | Moot (night is hold-up only). | |
| 9 | Spy grimoire on the phone | Moot (hold-up only). | |
| 10 | HTTPS | **Optional self-signed HTTPS mode**, plain HTTP stays the default. | Launcher option enables it and generates the certificate; join URLs and QR codes follow the active scheme; phones use Wake Lock when it is available. Each device shows the certificate warning once. |
| 11 | Messaging | **Players → Storyteller only** (questions, "request a word"); the Storyteller can reply. | No player-to-player chat. Phones can't send at night (night screen only). |
| 12 | Sound and vibration at night | Moot (no night cards). | Phones stay silent. |

**Revised phases** (each one: tests, typecheck, build, live multi-client check, commit and push before the next):
1. Plumbing and security, including the on/off setting.
2. Join, claim with approval, device panel, character reveal, spectator view, dead view, same-table re-binding.
3. Device-only notes and player → Storyteller messaging.
4. Phone voting with the clockwise sweep.
5. Optional HTTPS.

**Rules decided while building** (recorded here so later phases keep them):
- **Undo never touches phone data.** Claims, revealed characters and messages are kept as they are when the Storyteller undoes a game action (`KEEP_ON_UNDO` in `server/src/undo.ts`), because a phone can't un-see what it was shown. Phone actions are not undoable themselves.
- **The claim token is issued when the claim is made** (still pending), not on approval, so a phone that refreshes while waiting stays in the queue. A pending token gives no private data.

### Original questions

1. **Phones at night at all?** Or keep the night as hold-up only, with phones just for the reveal, notes and messages?
2. **Re-peeking your character:** always, until the first dawn, or once only? (This is the proof-by-phone issue.)
3. **Night-info journal:** keep delivered cards viewable all game, or hide them after dawn like the official app?
4. **Seat claims:** Storyteller approval (recommended) or first-come with the join code?
5. **New game with the same people:** keep phone bindings by seat, or make everyone re-join?
6. **Notes:** device only (recommended) or stored on the server?
7. **Phone voting:** wanted? If so, sweep speed, and do people still raise real hands as well?
8. **Keep the hold-up mode as a fallback?** (I recommend yes, per player.)
9. **Spy grimoire:** on the phone, or hold-up only?
10. **Plain HTTP:** is no Wake Lock (screens will lock) acceptable, or do you want a self-signed HTTPS option with its certificate warning?
11. **Messaging:** only player → Storyteller (recommended), or nothing?
12. **Sound and vibration:** confirm silent by default, with no per-player override at night.

## 7. Build progress

### Phase 1: plumbing and security (done Oct 15)

- **Setting:** `GameSession.phones.enabled` (off by default; `playerPhones` in config or `BOTC_PHONES` sets the default for a session that has none). Toggle: Storyteller Setup tab, `game:setPhones`. Off: `phoneJoin` is null in the public state, phones only receive `player:status {status:"off"}`, `player:lookup` / `player:claim` / `player:handover` are refused, and nothing is stored.
- **Server:** `server/src/phones.ts` (pure: tokens, claims, `toPhonePublic` / `toPlayerState` allowlists, Storyteller panel, same-table re-binding) and `server/src/phone-hub.ts` (sockets: `join {role:"player", token}` / `{role:"spectator"}`, the `player:*` handler map, per-player rooms `player:<id>`, a reconcile step that re-checks every phone after each change, the Storyteller's `game:phone*` actions).
- **Identity:** the server takes the player from the socket's verified token (`socket.data.tokenHash` → claim); `player:*` payloads never name the player. Tokens are 24 random bytes; only the SHA-256 is saved. Claims wait for the Storyteller's approval; a pending phone gets its status but no state.
- **Private emits:** `engine.mutatePrivate` / `emitPrivate` send only to the Storyteller and the listed players' rooms with the current `seq` (no bump, nothing to the TV).
- **Undo** keeps `phones` and `gameId` as they are (`KEEP_ON_UNDO`); `game:phone*` and `game:setPhones` are never undoable.
- **New game:** `game:reset {sameTable}` keeps names and re-binds claims by seat position; otherwise claims clear. Phones whose claim went away are told why (`denied` / `revoked` / `replaced` / `cleared`).
- **Tests:** `server/test/phones.ts` (12, including the canary leak test across lobby → first night → dawn → day → dusk → nomination → vote → night, and a self-check that the canary catches injected leaks) and `server/test/phones-socket.ts` (11: Storyteller + TV + 5 phones + spectator against the real server: off-by-default, isolation, no seq bump on private changes, impersonation, reconnect, revoke, off mid-game and back on, hand-over, new game re-binding, join-code throttling). Total 216/216.
- **Headless check:** `node scripts/phones_drive.mjs 1` (own server on a spare port, temp session, system Edge via `playwright-core`).

### Phase 2: join, claim, character reveal, device panel (done Oct 15)

- **TV:** lobby shows a parchment join card in the gazette slot (QR to `<origin>/play?c=CODE`, the address, the code); day and dusk show a small "Phones · /play CODE" plaque under the day tag. Both only while `phoneJoin` is set (phones on and claims open). On a TV opened at `localhost`, the QR uses the server's first LAN address from `/api/config/public` (`joinBase`, null while phones are off).
- **`/play`:** code (pre-filled from `?c=`) → seat list (`player:lookup`) → "Is this you?" → `player:claim` → "Waiting for the Storyteller" (with "Not you? Pick again" = `player:leave`). Also "I have a hand-over code" and "Just watch" (spectator: public town + script sheet, no `me`). Reason banners for denied / revoked / replaced / cleared / unknown.
- **Approved phone:** Character tab (hold-to-reveal card, hides on release or after 5 s, "New" / "Your card changed" badge from `revealedAt` vs the last time this device looked, the script sheet, "Unlink this phone") and Town tab (seats, public deaths, ghost votes, nomination, block, today's nominations, timer, end-of-game reveal). Night: a dark "eyes closed" screen with a dimmed hold-to-reveal. Dead: banner with ghost-vote status, only after the dawn announcement (uses the public alive bit).
- **Characters on phones:** stored only by `game:phoneDistribute` (all seated players; in the lobby it waits for a legal bag; every player needs a character and the Drunk a believed Townsfolk) and `game:phoneResend {playerId}`. The Drunk sees `thinksCharacterId` and "good"; Travellers see their character and the Storyteller's secret alignment. Grimoire edits, star-passes and the Scarlet Woman never update a phone live; the new-Demon night step does when it is marked done (`revealNewDemon`, using the player's current character, so a Scarlet Woman gets whichever Demon died).
- **Storyteller:** "Phones asking for a seat" banner above the tabs on every tab (Approve / Deny). Setup tab device panel: join code, New code, Open / Close seat claims, Unlink all; Send characters (again); per seat: what the phone shows, a "Grimoire now says …" warning when that differs from what the phone should show, each claim (device, connected / last seen, Approve / Approve as 2nd phone / Deny, Move to seat, Unlink), Re-send character, Hand-over code. Control tab: "Same table" chip next to New game.
- **Tests:** `phones.ts` +4 (Distribute refusals and Drunk / Baron bag; grimoire edits wait for Re-send; star-pass reaches the phone only at the new-Demon wake, with the leak canary after it; Traveller alignment private to that player). The canary game now sets cards through `resendCharacter`. `phones-socket.ts` +1 (Distribute over sockets: own card only, nothing to the TV; Re-send reaches one phone only). Total 221/221.
- **Headless check (phase 2):** `node scripts/phones_drive.mjs 2`: TV lobby QR, iPhone by QR and Pixel by typed code, pending banner, approve, Distribute, held cards (Washerwoman good, Drunk sees Chef, Baron evil), stale-card warning and Re-send, spectator, night screen, overnight death hidden until the announcement, Town tab, TV day badge.

### Phase 3: notes and messages (done Oct 15)

- **Notes (device only):** `web/src/pages/play/notes.ts` + Notes tab. `localStorage` key `botc.notes.<gameId>.<seat>`; nothing is sent to the server. One card per seat: claimed character (script picker), a Good / Evil / ? guess, a line of text, and public facts collected from the public log (who nominated whom, vote counts, **who voted**, executions, deaths, Slayer shots, exiles, each with its day or night). Facts are kept in the notes so they survive the public log's 40-event window; keys never depend on log position. A free "My notes" pad. Save a copy (JSON file) / Load a copy (warns when the file is from another game) / Clear notes. A new game has a new `gameId`, so notes start fresh.
- **Voter lists:** the public `vote_result` event now carries `voterIds` (the hands that were up; already public in the live vote state and at the table).
- **Messages (players → Storyteller only):** `player:message {kind: "question" | "word", text}` from an approved, connected phone only; refused at night (the phone is on the night screen anyway) and while phones are off; up to 280 characters; 6 per minute per seat; the last 200 per seat are kept in `phones.private[pid].messages`, with `unreadByStoryteller`. `game:phoneReply {playerId, text}` (up to 500, marks read) and `game:phoneMarkRead {playerId}`. All private emits: only the Storyteller and that player's phone, no TV state, no seq bump. The action log records that a seat sent a question or asked for a word, not the text.
- **Phone:** tabs are now Card / Town / Notes / Ask. Ask: "Request a word with the Storyteller", the thread, a question box with a counter; a badge on the tab for unread replies.
- **Storyteller:** "Messages from players" banner above the tabs whenever something is unread (word requests flagged), with Reply and Mark read per player; every thread on the Setup tab under the device panel.
- **Tests:** `phones.ts` +1 (limits, word text, night refusal, only that phone + Storyteller see it, reply marks read, 200 kept, off refused), `phones-socket.ts` +1 (night and unlinked refusals, Storyteller unread over sockets, reply reaches that phone only, no TV state, no text on other sockets, rate limit), `nominations.ts` +1 (voter list), new `phone-notes.ts` (3: facts with days, facts kept after the log window moves without duplicates, storage per game and seat, export / import and file cleaning). Total 227/227.
- **Headless check:** `node scripts/phones_drive.mjs 3`: notes grid and pad on iPhone, facts after a real nomination and vote, reload keeps notes, export on one phone and import on another, question and word request, Storyteller inbox, reply with tab badge, inbox clears.

### Phase 4: phone voting (done Oct 15)

- **Who votes by phone:** when the Storyteller starts the vote clock (`game:startVote`), every seat with a connected, approved phone becomes a phone seat (`nomination.phoneVote.phoneSeats`); every other seat is counted by hand on the chips as before. Nothing changes when phones are off, phone voting is off, or no phone is connected.
- **Hands:** `player:hand {up}` (the seat comes from the socket's token, never the payload; only while the vote is open, before that seat locks; 12 per 5 s). Raised phone hands are public (`handsUp`, as real hands are) but **don't count** until the clock hand locks them. The usual rules apply: a spent ghost vote or a Beggar without a token can't raise (the phone says why); a dead player is told the hand uses their ghost vote, which is spent at resolve as before; the Butler is never blocked (the Storyteller still gets the private Butler warning).
- **The count:** `game:phoneSweepStart` moves a server-timed clock hand clockwise from the seat after the nominee (nominee last; the same order as the TV studs) at `sweepMsPerSeat` (1–3 s choices, clamped 0.5–5 s). Each step locks one seat: a phone seat's hand is copied into `votesFor`; a hand-counted seat keeps whatever the Storyteller tapped. **Pause**, **Back one seat** (unlocks the last seat, so its phone can change its hand, and pauses) and **Resume / Count again**. Resolve and the force buttons are unchanged and use `votesFor` as before.
- **Storyteller override:** tapping a phone seat's chip sets that seat; the lock and the phone can't change it for the rest of the vote (the override list goes only to the Storyteller and, as "The Storyteller set your vote", to that phone).
- **Off switches:** "Phones off for voting" (`game:phoneVoting {mode:"manual"}`, on the Votes tab and the Setup device panel) and turning phones off both stop a running count at once; hands already counted stay counted and the rest are tapped by hand. Turning phone voting back on applies from the next vote.
- **Undo / restart:** an undo or a server restart pauses a running count (the Storyteller resumes it); the undo note says so. Sweep and hand actions are not undoable (`game:phone*`).
- **TV:** raised phone hands get a faint breathing gold ring on their stud; a brass clock hand travels to the next seat over one step (timed from when the TV receives the step, so no clock sync is needed); passed unlit studs dim. The rising / majority vote cues are unchanged (they follow `votesForCount`, which now moves as seats lock).
- **Phone:** a vote card above the tabs while a nomination is open: who nominated whom, the tally, a big "Raise my hand" / "Hand up" button (phone seats), and a status line ("The clock hand reaches you in 2 seats", "Locked — your vote counts", "The Storyteller set your vote", or for hand-counted seats "Raise your real hand"). A short vibration when the seat locks, where supported.
- **Tests:** new `phone-vote.ts` (9: off / manual / no phone = hand counting; mixed table locks; pause and back; override stands and stays private; ghost vote, Beggar, Butler; phones off and phone voting off mid-count keep counted hands; per-phone vote card; undo and restart pause; speed clamp) and `phones-socket.ts` +1 (forged `playerId` ignored, unlinked phone refused, timed sweep round the table over real sockets, locked hand can't be lowered, no override list on the TV). Total 237/237.
- **Headless check:** `node scripts/phones_drive.mjs 4`: vote card on iPhone / Pixel, a ghost vote, three phone hands glowing on the TV with nothing counted, a hand-counted seat tapped on the Storyteller tablet, Start the count, locked / countdown phones, the clock hand on the TV, Pause + Back + lower + Resume, final tally, then a second vote switched to "Phones off for voting" mid-count with the locked hand kept.

### Phase 5: optional HTTPS (done Oct 15)

- **Setting:** `https` in `config/default.json` (shipped `false`), `config/local.json` or `BOTC_HTTPS=1/0`. Off means exactly the old plain-HTTP server: no certificate is made and nothing else changes.
- **Certificate:** on the first HTTPS start the server makes a self-signed certificate (`server/src/tls.ts`, `selfsigned`): RSA 2048 / SHA-256, not a CA, server-auth only, about 13 months, covering `localhost`, the PC name, 127.0.0.1 and every IPv4 address of the PC. It lives in `config/tls/` (gitignored; the key is written owner-only). It is reused while it covers loopback, the real LAN addresses and an explicit bind address and has a month left; otherwise it is remade (devices then warn once more). Virtual adapters (Hyper-V, WSL, VPN) are included but never force a renewal, because Windows can readdress them at boot.
- **Addresses:** the startup banner, `BOTC.bat addresses`, `/api/config/public` `joinBase` (the TV QR) and `/api/health` (`scheme`) all follow the active scheme; with HTTPS the banner says each device warns once.
- **Phones:** `useWakeLock` keeps a linked phone's screen on by day and in the lobby (only on a secure page, re-taken after the page is hidden), and lets it go at night. The Character tab says so when it holds.
- **Launcher (`BOTC.bat`):** Settings > 4) HTTPS on / off (with the warning explained), 5) Player phones default, 6) Make a new HTTPS certificate, 7) Reset all; `BOTC.bat set -Https on|off` / `-Phones on|off`; status, stop, open page and the pre-game check use the running server's scheme; Windows PowerShell trusts only this PC's own certificate (pinned by thumbprint) for its health and stop calls; the pre-game check shows the certificate's addresses and expiry; dev mode always runs HTTP (Vite proxies plain HTTP).
- **Tests:** new `https.ts` (4: certificate SAN / key / validity / reuse / renewal rules incl. virtual adapters; join URLs follow the scheme; a real HTTPS server verified against its own certificate, untrusted clients refused, Storyteller over `wss`; the shipped default stays HTTP with no certificate). Test servers now force `BOTC_HTTPS=0` so a `config/local.json` with HTTPS on can't break them. Total 241/241.
- **Headless check:** `node scripts/phones_drive.mjs 5`: TV lobby over `https://` (secure context, QR follows), iPhone and Pixel hold the wake lock in the lobby and by day and release it at night. The launcher was also run end to end (start, status, check, stop) over HTTPS on a spare port in a throwaway copy.
- **Not verifiable headless:** whether a real iPhone / Android grants the wake lock after the user clicks through the certificate warning, and which smart-TV browsers accept a self-signed certificate. Try at the table; HTTP stays the fallback.

### Phase 6: player name + face photo (done Oct 16)

- **Name:** during claim (`player:claim {name}`) and any time while pending or approved (`player:setName`). Updates the seat's `Player.name` so the TV and Storyteller see it; the Storyteller can still rename from the grimoire.
- **Photo:** `player:setPhoto {image}` (JPEG base64 or `data:image/jpeg;base64,…`) and `player:clearPhoto`. The phone resizes to a square ~256px JPEG first; the server rejects non-JPEG and payloads over 350 KB. Stored at `data/player-photos/{gameId}/{playerId}.jpg` (gitignored; override with `BOTC_PHOTOS_DIR`). `Player.photoRev` is public; clients fetch `/api/player-photos/:playerId?v=photoRev`.
- **UI:** join “Is this you?” name field → pending screen profile editor → approved phone **You** tab. Storyteller device panel and pending banner show the circular face when present; TV town tokens use the photo in place of the sun/skull emblem when present.
- **Phones off:** `player:setName` / `player:setPhoto` / `player:clearPhoto` / claim are refused (same as other player actions).
- **Same-table new game:** name and photo file copy to the new `gameId` / seat binding.
- **Tests:** `server/test/player-profile.ts` (payload validation, name on ST/TV, photo accept/reject, GET + disk, reconnect, phones-off).

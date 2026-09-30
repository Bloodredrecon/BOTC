# TV overlay elements

Modular UI chrome for `/tv`, stacked over any scene plate.
Design comps: `docs/tv-design/tv-design-{A-G-H,E-C-B,F}-*.png`.

**No baked text.** Every label, number, name and phase word on `/tv` is live text
rendered by React (`web/src/pages/tv/*`). Chrome files below are blank.

## Live files (referenced by `web/src/pages/tv/assets.ts` / `tv.css`)

| File | Role | How it is used |
|------|------|----------------|
| `plaque-oak.png` | Oak + brass plaque (hero phase word, day tag, nomination label, vote tally) | 9-slice `border-image-slice: 300 335 305 330 fill`, scaled by `--oak-s` |
| `town-frame-blank.png` | Town wood/brass frame | 9-slice `380 330 400 330`, scaled by `--tf` |
| `vote-ring-blank.png` | Brass seat ring behind the vote stud arc | `<img>` in `VoteStage`; studs are CSS |
| `nomination-plaque-clean.png` | Nomination bar + medallion | `NominationStage` |
| `execution-placard-clean.png` | Execution placard | `ExecutionStage` |
| `emblem-sun.png` / `emblem-skull.png` | Seat chip emblems (alive / ghost) | `TownBoard` seat chips; spent vote X is CSS |
| `dawn-graveyard.jpg` | "The night claimed" banner backdrop | `DawnReveal` |
| `parchment-tex.jpg` | Gazette sheet texture | `.tv-gazette` |
| `phase-ink-tex.png` | Craquelure / mottle for the phase word face | `background-clip: text` layer on `.tv-phase-word-ink` |
| `phase-blood.png` | Dried-blood grime toward the phase word baseline | `background-clip: text` layer (repeat-x) on `.tv-phase-word-ink` |
| `distress-mask.png` | Worn band edge | `mask-image` on the ghost seat blood band only |
| `blood-wear.png` | Blood smear accents | gazette |

Built by `python scripts/build_tv_overhaul_assets.py`; the two `phase-*` textures by
`python scripts/build_tv_phase_ink.py`. Phase words must not use `distress-mask.png`: its alpha
(35% floor, zero-alpha specks and scratches) punches holes through the glyphs.

## Source inputs (not loaded by the page)

`vote-plaque.png`, `vote-ring.png`, `town-frame.png`, `nomination-plaque.png`,
`execution-placard.png`, `day-marker.png` are the inputs `build_tv_overhaul_assets.py`
strips into the clean files above. `day-marker.png` is now a blank copy of the oak plaque;
the original baked "DAY 3" version is archived as `_prior/day-marker-baked-day3.png`.

Retired assets (old ledger panel, logo, seat chips, combined vote chrome) are in `_prior/legacy-*.png`.

## Fonts (self-hosted, bundled by Vite from npm — `web/src/pages/tv/fonts.ts`)

| Role | Family | Package | Licence |
|------|--------|---------|---------|
| Phase word, nominee | Libre Caslon Condensed | `@fontsource/libre-caslon-condensed` | SIL OFL 1.1 |
| Script meta, statuses | Italianno | `@fontsource/italianno` | SIL OFL 1.1 |
| Spaced small-caps labels | Cormorant SC | `@fontsource/cormorant-sc` | SIL OFL 1.1 |
| Gazette body | Old Standard TT | `@fontsource/old-standard-tt` | SIL OFL 1.1 |
| Brand wordmark | Cinzel Decorative, Cinzel | `@fontsource/cinzel-decorative`, `@fontsource/cinzel` | SIL OFL 1.1 |

Sources: <https://fontsource.org> (mirrors Google Fonts, <https://fonts.google.com>).

## Phase overlay rules (F map)

| Phase | Town | Gazette |
|-------|------|---------|
| Lobby | visible | hidden |
| Night | hidden | hidden |
| Dawn / Day / Ended | visible | visible |
| Nomination / Vote / Execution | hidden | hidden |

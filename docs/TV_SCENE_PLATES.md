# TV scene plates (workflow I)

Swap the full-bleed `/tv` background without touching modular chrome
(`web/public/tv/elements/*`).

**Art direction source of truth:** the three comps in [`tv-design/`](tv-design/README.md):

1. `tv-design-A-G-H-comps.png` — Night / Dawn / Day atmospheres  
2. `tv-design-E-C-B-comps.png` — type / vote chrome language  
3. `tv-design-F-overlay-map.png` — phase overlay map (incl. execution / ended)

Live `bg-*` plates are full 16:9 exports matching those panel atmospheres. Do not
restyle away from that look.

## Spec

| | |
|--|--|
| Aspect | **16:9** |
| Preferred size | **3840×2160** (4K) |
| Content | Scene only — modular chrome stays in overlays |
| Format | PNG or JPG |

## Live plates (`web/public/tv/`)

Night, dawn, day, gallows and good-win are the older art from `_prior_plates/` (byte-identical
copies); the design-comp exports are kept in `_design_plates/`. `bg-nomination.png` and
`bg-evil-win.png` are the user's own art (added 2026-09-28, 3840×2160).

| File | Key | Baked logo (`hasLogo`) | Used for | `_design_plates/` equivalent |
|------|-----|------------------------|----------|------------------------------|
| `bg-night.jpg` | `night` | **yes**, top-left | first night, night | `bg-night.png` (A–G–H **Night**, no logo) |
| `bg-dawn.png` | `dawn` | **yes**, top-left | dawn | A–G–H **Dawn**, no logo |
| `bg-day.png` | `day` | **yes**, top-left | lobby, day (discussion) | A–G–H **Day**, no logo |
| `bg-nomination.png` | `nomination` | no | dusk: nominations open, before a nominee is picked and between votes | — |
| `bg-gallows.png` | `gallows` | no | a nominee is picked: nomination, vote, execution | F **7. Execution**, no logo |
| `bg-good-win.png` | `good-win` | **yes**, top-left | ended, Good wins | F **8. Ended** mood, no logo |
| `bg-evil-win.png` | `evil-win` | no | ended, Evil wins | — |

Before `bg-evil-win.png` existed, an Evil win fell back to the **day** plate (the same town as
good-win, in daylight), which is why it looked like the good ending.

To replace either of the user plates later, save the new art under the **same name** (any of
`.png` / `.jpg` / `.webp`, but keep only one `bg-<key>.*` per key), set `hasLogo` for that key
in `plates.json` to match the new art, then rebuild (`BOTC.bat` option 4) and hard-refresh `/tv`.

Where the baked logo sits (fraction of the 16:9 frame): lettering x ≈ 2–30%, y ≈ 5–28%;
blood drips reach y ≈ 36.5% (longest drip at x ≈ 22%).

## Plate flags: `web/public/tv/plates.json`

```json
{ "day": { "hasLogo": true }, "gallows": { "hasLogo": false } }
```

`web/vite.config.ts` reads this file next to the plates and adds `hasLogo` to each
`__TV_BG_PLATES__` entry. When the plate for the current phase has `hasLogo: true`, `/tv`:

- skips its own CSS wordmark (`TvBrandLogo`), so the logo is not drawn twice;
- adds `.tv-plate-logo` to the root, which caps the hero plaque at 38cqw (its left edge stays
  at ≥ 31cqw) and starts the left column (dawn banner and town) at 37cqh, below the drips.
  Exception: a town of 4+ rows (16+ seats, `.tv-town-tall`) keeps 31cqh, because otherwise
  the dawn banner has no room for the names; its faded top edge then sits over the drip tips.

Plates without a flag (or with `false`) keep the CSS wordmark.

## Drop-in steps

1. Keep style locked to the three tv-design comps above.
2. Save under `web/public/tv/` with the filename key.
3. Set `hasLogo` for that key in `web/public/tv/plates.json` (does the art already have the logo painted in?).
4. Restart/refresh Vite (or rebuild: `BOTC.bat` option 4) so `__TV_BG_PLATES__` picks up the file and flag.
5. Hard-refresh `/tv`.

## How `/tv` picks a plate

| Phase / mode | Plate key | Fallback |
|--------------|-----------|----------|
| `firstNight`, `night` | `night` | — |
| `dawn` | `dawn` | `night` |
| `day`, `lobby` | `day` | `night` |
| `dusk` (the dusk announcement, nominations open between votes, the hold after an end-of-day execution) | `nomination` | `dawn` graded to nightfall → `night` |
| `nomination`, `vote`, `execution` | `gallows` | `day` → `night` |
| `ended` + good | `good-win` | `day` → `night` |
| `ended` + evil | `evil-win` | `day` → `night` |

Dedicated plates soften `.tv-atmosphere-tint` via `.tv-plate-{key}`. The heavy indigo dusk
grade applies only to the `dawn` fallback (`.tv-plate-dawn.phase-dusk`).

Day flow: **Day** (discussion, `day` plate, nominations closed) → **Go to dusk** (dusk cue,
`nomination` plate, "Dusk falls", still closed) → **Open nominations** (plaque "Nominations",
gazette "Nominations open") → each nominee switches to `gallows` for nomination / vote and back
to `nomination` when the vote resolves or is cancelled → **Close nominations — execute X**
(execution on `gallows`, then night once the execution line finishes) / **Close nominations —
no execution** (night at once, gazette "No execution today").

## Check

```bash
python scripts/check_tv_plate.py
```

## Related

- Provenance detail: `docs/tv-design/README.md`
- Elements: `web/public/tv/elements/README.md`
- CSS: `web/src/pages/tv/tv.css`
- Plate flags: `web/public/tv/plates.json`

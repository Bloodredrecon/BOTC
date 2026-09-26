# TV overlay elements

Modular UI chrome for `/tv`, stacked over any scene plate.

## Files (primary)

| File | Role |
|------|------|
| `day-marker.png` | Soft phase scrim (clean alpha; CSS also adds mask/falloff) |
| `town-frame.png` | THE TOWN wood/brass placard (title baked in; transparent seat hollow) |
| `ledger-panel.png` | Ravenswood Gazette on wood with matching brass corners (masthead baked in) |
| `vote-chrome.png` | Nomination / vote plaque + ring |
| `logo.png` | Legacy AI wordmark (unused — `/tv` uses typographic `.tv-brand`) |

Alternates from processing: `ledger-panel-generated.png`, `ledger-panel-from-bg.png`, `logo-from-bg.png`.

## Shared visual system (storyteller table)

Town + Gazette are one material language:
- **Backing:** dark weathered oak / stone
- **Corners:** matching aged brass filigree + diamond rivets
- **Ink:** dried-blood accents; parchment cream for Gazette sheet
- **Type:** Cinzel Decorative mastheads (baked); UnifrakturCook / Old Standard for chronicle body

## Brand logo

The live `/tv` brand is CSS: Cinzel Decorative stack + SVG drips (`.tv-brand`). Prefer that over `logo.png`, which had muddy bright fringe on dark plates.

## Gazette / Town notes

- **Ravenswood Gazette** masthead is in the PNG — do not CSS-print a second title. Body text uses UnifrakturCook / Old Standard via `--font-gothic` / `--font-gazette`.
- Chronicle insets (`.tv-ledger-body`) must clear left blood, brass corners, and clocktower watermark — keep `left` ≥ ~22% with `object-fit: fill` on the chrome.
- **THE TOWN** title is in `town-frame.png` — seat grid only in markup. Default grid: 5 columns (fits 20 seats as 5×4); scrolls if needed.

## Swap backgrounds

1. Drop a scene-only JPG/PNG in `web/public/tv/` (prefer no baked logo/ledger).
2. Point the plate at it:
   - CSS: `.tv { --tv-bg: url("/tv/your-scene.jpg"); }`
   - or `<Atmosphere backgroundSrc="/tv/your-scene.jpg" />`
3. Keep `--tv-bg-w` / `--tv-bg-h` matching the plate so `.tv-bg-align` % stay correct.
4. Current `bg-night.jpg` is a scene-only gothic plate (no baked UI). Modular overlays sit on top. `bg-night-prev.jpg` / `bg-night-4x3.jpg` archive prior plates.

Regenerate gazette + town: `python scripts/process_tv_gazette_town.py`  
Other alpha PNGs: `python scripts/process_tv_elements.py`  
Clean day-marker only: `python scripts/_fix_day_marker.py`

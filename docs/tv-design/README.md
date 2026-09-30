# TV design comps (plan A–H)

Generated during the visual upgrade pass. Shown in chat; copies kept here for reference.
**This folder is the art-direction source of truth** for `/tv` atmosphere.

| File | Covers |
|------|--------|
| `tv-design-A-G-H-comps.png` | Phase grades (Night · Dawn · Day) · seat states · chrome family |
| `tv-design-E-C-B-comps.png` | Type hierarchy · vote majority · dawn funeral |
| `tv-design-F-overlay-map.png` | Phase overlay map (what hides/shows per phase) |

## Live plates ← which comp region

Comps are 1280×720 multi-panel sheets. Live `web/public/tv/bg-*.png` are full-bleed
16:9 / 4K scene plates generated to match those panel atmospheres exactly (same painterly
gothic coastal / gallows look — no restyle).

| Live plate | Source comp | Region / panel |
|------------|-------------|----------------|
| `bg-night.png` | **A–G–H** | Top row, **Night** still (cool blue-black grade; coastal cliff town + moon) |
| `bg-dawn.png` | **A–G–H** | Top row, **Dawn** still (warm amber / blood sunrise over harbour) |
| `bg-day.png` | **A–G–H** | Top row, **Day** still (grey-stone cooler daylight; birds) |
| `bg-gallows.png` | **F** (+ **E–C–B** materials) | Phase **7. Execution** card atmosphere (crimson sky, tower + gallows silhouettes); vote/nomination share this plate. E–C–B supplies wood/brass/stone language only |
| `bg-good-win.png` | **F** + **A–G–H** | Phase **8. Ended** village mood, lifted to warm triumph using A–G–H coastal town family |
| *(missing)* `bg-evil-win.*` | — | Not in comps yet — ends fall back to day |

How-to / discovery / cache-bust: [`../TV_SCENE_PLATES.md`](../TV_SCENE_PLATES.md).

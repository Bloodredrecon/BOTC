"""Stitch 3x3 GenerateImage tiles into a native 3840x2160 plate — no upscaling."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ASSETS = Path(r"C:\Users\danie\.cursor\projects\c-Users-danie-BOTC\assets")
OUT = Path(r"C:\Users\danie\BOTC\web\public\tv")
TILE_W, TILE_H = 1280, 720
COLS, ROWS = 3, 3
TARGET_W, TARGET_H = COLS * TILE_W, ROWS * TILE_H  # 3840 x 2160


def load_tile(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    print(f"  {path.name}: {w}x{h}")
    if w < TILE_W or h < TILE_H:
        raise SystemExit(
            f"REFUSING upscale: {path.name} is {w}x{h}, need at least {TILE_W}x{TILE_H}"
        )
    # Center-crop only (never enlarge)
    left = (w - TILE_W) // 2
    top = (h - TILE_H) // 2
    return im.crop((left, top, left + TILE_W, top + TILE_H))


def main() -> None:
    names = [[f"tile-r{r}c{c}.jpg" for c in range(COLS)] for r in range(ROWS)]
    OUT.mkdir(parents=True, exist_ok=True)
    tiles_dir = OUT / "tiles"
    tiles_dir.mkdir(exist_ok=True)

    canvas = Image.new("RGB", (TARGET_W, TARGET_H), (8, 4, 5))
    print("Loading tiles (crop-only, no upscale):")
    for r in range(ROWS):
        for c in range(COLS):
            src = ASSETS / names[r][c]
            if not src.exists():
                raise SystemExit(f"Missing tile: {src}")
            tile = load_tile(src)
            tile.save(tiles_dir / names[r][c], "JPEG", quality=92, optimize=True, subsampling=0)
            canvas.paste(tile, (c * TILE_W, r * TILE_H))

    assert canvas.size == (TARGET_W, TARGET_H)
    dest = OUT / "bg-night.jpg"
    canvas.save(dest, "JPEG", quality=92, optimize=True, progressive=True, subsampling=0)
    print(f"wrote {dest}: {canvas.size[0]}x{canvas.size[1]} ({dest.stat().st_size:,} bytes)")

    # Section assets — copy at native tool size (1–2K OK)
    for name in ("parchment-hi.png", "parchment.png", "raven.png"):
        src = ASSETS / name
        if not src.exists():
            continue
        im = Image.open(src)
        out_name = "parchment.png" if name.startswith("parchment") else name
        # Prefer hi parchment if present
        if name == "parchment.png" and (ASSETS / "parchment-hi.png").exists():
            continue
        dest_p = OUT / out_name
        im.save(dest_p)
        print(f"wrote {dest_p.name}: {im.size[0]}x{im.size[1]} ({dest_p.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()

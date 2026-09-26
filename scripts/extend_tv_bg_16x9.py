"""Fit 4:3 bg-night into native 3840x2160 framed by dark gothic stone."""
from __future__ import annotations

import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT = Path(r"C:\Users\danie\BOTC")
PUBLIC_TV = ROOT / "web" / "public" / "tv"
ARCHIVE = PUBLIC_TV / "bg-night-4x3.jpg"
OUT = PUBLIC_TV / "bg-night.jpg"

TARGET_W, TARGET_H = 3840, 2160

# Blood-dark masonry palette (BOTC gothic)
STONE_BASE = np.array([28, 22, 24], dtype=np.float32)
STONE_LIGHT = np.array([52, 42, 40], dtype=np.float32)
STONE_DARK = np.array([12, 9, 11], dtype=np.float32)
MORTAR = (18, 14, 15)
MOSS = np.array([24, 38, 28], dtype=np.float32)
BLOOD_STAIN = np.array([48, 14, 16], dtype=np.float32)
LIP_HIGHLIGHT = (62, 48, 44)
LIP_SHADOW = (6, 4, 5)
STONE_MID = (36, 28, 30)


def load_source() -> Image.Image:
    if ARCHIVE.exists():
        im = Image.open(ARCHIVE).convert("RGB")
        if im.size[1] > TARGET_H and im.size[0] / im.size[1] < 1.6:
            print(f"source: {ARCHIVE.name} {im.size[0]}x{im.size[1]}")
            return im
    fallback = PUBLIC_TV / "bg-night.jpg"
    if fallback.exists():
        im = Image.open(fallback).convert("RGB")
        if im.size[1] > TARGET_H and im.size[0] / im.size[1] < 1.6:
            print(f"source: {fallback.name} {im.size[0]}x{im.size[1]}")
            return im
    raise SystemExit("No 4:3 source found (expected bg-night-4x3.jpg)")


def _lerp_rgb(a: np.ndarray, b: np.ndarray, t) -> np.ndarray:
    t_arr = np.asarray(t, dtype=np.float32)
    if t_arr.ndim == 0:
        return a * (1.0 - float(t_arr)) + b * float(t_arr)
    return a * (1.0 - t_arr[..., None]) + b * t_arr[..., None]


def paint_stone_plate(w: int, h: int, seed: int = 42) -> Image.Image:
    """Procedural dark carved-stone masonry for the border."""
    rng = np.random.default_rng(seed)
    fine = rng.random((h, w), dtype=np.float32)
    # Low-frequency blotches via downsample
    cw, ch = max(1, w // 8), max(1, h // 8)
    coarse_small = rng.random((ch, cw), dtype=np.float32)
    coarse = np.array(
        Image.fromarray((coarse_small * 255).astype(np.uint8), mode="L").resize(
            (w, h), Image.Resampling.BILINEAR
        ),
        dtype=np.float32,
    ) / 255.0

    mott = fine * 0.55 + coarse * 0.45
    t = 0.30 + 0.50 * fine + 0.20 * coarse
    rgb = _lerp_rgb(STONE_DARK, STONE_LIGHT, t)

    moss_mask = mott < 0.20
    blood_mask = mott > 0.90
    rgb = np.where(moss_mask[..., None], _lerp_rgb(STONE_DARK, MOSS, mott * 2.0 + 0.2), rgb)
    rgb = np.where(blood_mask[..., None], _lerp_rgb(STONE_LIGHT, BLOOD_STAIN, 0.35), rgb)

    canvas = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB")
    draw = ImageDraw.Draw(canvas)
    prng = random.Random(seed)

    # Irregular ashlar block grid
    block_h = 70
    y = 0
    row = 0
    while y < h:
        bh = block_h + prng.randint(-8, 12)
        offset = (row % 2) * (block_h // 2) + prng.randint(-4, 4)
        x = -offset
        while x < w:
            bw = 108 + prng.randint(-24, 36)
            draw.rectangle([x, y, x + bw, y + bh], outline=MORTAR, width=2)
            if bw > 24 and bh > 18:
                draw.line([(x + 3, y + 3), (x + bw - 3, y + 3)], fill=LIP_HIGHLIGHT, width=1)
                draw.line([(x + 3, y + bh - 3), (x + bw - 3, y + bh - 3)], fill=LIP_SHADOW, width=1)
            if prng.random() < 0.07:
                dx = x + prng.randint(6, max(7, bw - 6))
                for dy in range(prng.randint(10, 32)):
                    yy = y + 3 + dy
                    if 0 <= dx < w and 0 <= yy < h:
                        px = canvas.getpixel((dx, yy))
                        blend = tuple(int(px[i] * 0.45 + BLOOD_STAIN[i] * 0.55) for i in range(3))
                        canvas.putpixel((dx, yy), blend)
            x += bw
        y += bh
        row += 1

    canvas = ImageEnhance.Contrast(canvas).enhance(1.1)
    canvas = canvas.filter(ImageFilter.SMOOTH)
    return canvas


def carve_corner(draw: ImageDraw.ImageDraw, x0: int, y0: int, size: int, flip_x: bool, flip_y: bool) -> None:
    """Carved stone corner ornament."""
    s = size

    def map_pt(p: tuple[int, int]) -> tuple[int, int]:
        x, y = p
        if flip_x:
            x = s - x
        if flip_y:
            y = s - y
        return (x0 + x, y0 + y)

    outer = [(0, 0), (s, 0), (s, s // 4), (s // 4, s // 4), (s // 4, s), (0, s)]
    inner = [(10, 10), (s - 12, 10), (s - 12, s // 4 + 6), (s // 4 + 6, s // 4 + 6), (s // 4 + 6, s - 12), (10, s - 12)]
    draw.polygon([map_pt(p) for p in outer], fill=(10, 8, 9), outline=MORTAR)
    draw.polygon([map_pt(p) for p in inner], fill=STONE_MID, outline=LIP_HIGHLIGHT)
    # Inset chevron carve
    chev = [(s // 5, s // 5), (s * 3 // 5, s // 5), (s // 5, s * 3 // 5)]
    draw.polygon([map_pt(p) for p in chev], outline=LIP_SHADOW)
    cx, cy = map_pt((s // 3, s // 3))
    draw.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=tuple(int(v) for v in BLOOD_STAIN))


def add_window_frame(canvas: Image.Image, art_x0: int, art_x1: int, lip: int = 20) -> None:
    """Vertical stone lip along art seams + corner ornaments in pillars."""
    w, h = canvas.size
    draw = ImageDraw.Draw(canvas)

    # Raised lip bands in the pillars flush with the art edge
    for side, x_art in (("left", art_x0), ("right", art_x1)):
        for i in range(lip):
            t = i / max(lip - 1, 1)
            col = (
                int(LIP_HIGHLIGHT[0] * (1 - t) + LIP_SHADOW[0] * t),
                int(LIP_HIGHLIGHT[1] * (1 - t) + LIP_SHADOW[1] * t),
                int(LIP_HIGHLIGHT[2] * (1 - t) + LIP_SHADOW[2] * t),
            )
            if side == "left":
                x = x_art - lip + i
            else:
                x = x_art + lip - 1 - i
            if 0 <= x < w:
                draw.line([(x, 0), (x, h - 1)], fill=col, width=1)

    # Outer darken strip further into pillar
    for i in range(14):
        col = (
            int(LIP_SHADOW[0] + i),
            int(LIP_SHADOW[1] + i * 0.7),
            int(LIP_SHADOW[2] + i * 0.7),
        )
        xl = art_x0 - lip - 1 - i
        xr = art_x1 + lip + i
        if xl >= 0:
            draw.line([(xl, 0), (xl, h - 1)], fill=col, width=1)
        if xr < w:
            draw.line([(xr, 0), (xr, h - 1)], fill=col, width=1)

    # Corner ornaments fully inside side pillars
    cs = min(110, (art_x0 - lip) - 16)
    if cs >= 48:
        inset = 18
        carve_corner(draw, art_x0 - lip - cs - 4, inset, cs, False, False)
        carve_corner(draw, art_x0 - lip - cs - 4, h - inset - cs, cs, False, True)
        carve_corner(draw, art_x1 + lip + 4, inset, cs, True, False)
        carve_corner(draw, art_x1 + lip + 4, h - inset - cs, cs, True, True)


def vignette_art_edge(art: Image.Image, depth: int = 36) -> Image.Image:
    """Mild darkening at art perimeter so it sits in the stone window."""
    w, h = art.size
    arr = np.asarray(art, dtype=np.float32)
    ys = np.arange(h)[:, None]
    xs = np.arange(w)[None, :]
    dx = np.minimum(xs, w - 1 - xs)
    dy = np.minimum(ys, h - 1 - ys)
    d = np.minimum(dx, dy).astype(np.float32)
    t = np.clip(1.0 - (d / depth), 0.0, 1.0)
    t = (t * t) * 0.40
    # Stronger on left/right (where stone meets) than top/bottom
    side = np.clip(1.0 - (dx / depth), 0.0, 1.0)
    side = (side * side) * 0.22
    factor = 1.0 - np.maximum(t, side)
    arr *= factor[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB")


def shade_pillars_outward(border: Image.Image, art_x0: int, art_x1: int) -> Image.Image:
    """Darken toward outer left/right edges for carved depth."""
    arr = np.asarray(border, dtype=np.float32)
    h, w, _ = arr.shape
    xs = np.arange(w, dtype=np.float32)
    left = xs < art_x0
    right = xs >= art_x1
    shade = np.ones(w, dtype=np.float32)
    if art_x0 > 1:
        shade[left] = 0.55 + 0.45 * (xs[left] / (art_x0 - 1))
    if w - art_x1 > 1:
        shade[right] = 0.55 + 0.45 * (1.0 - (xs[right] - art_x1) / (w - art_x1 - 1))
    # Mild vertical mid highlight (lantern spill from scene)
    ys = np.arange(h, dtype=np.float32)
    vy = 1.0 - np.abs(ys / max(h - 1, 1) - 0.42) * 0.12
    factor = shade[None, :] * vy[:, None]
    # Don't shade the art window region
    mid = (xs >= art_x0) & (xs < art_x1)
    factor = np.where(mid[None, :], 1.0, factor)
    arr *= factor[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB")


def main() -> None:
    src = load_source()
    if not ARCHIVE.exists():
        src.save(ARCHIVE, "JPEG", quality=92, optimize=True, progressive=True, subsampling=0)
        print(f"archived {ARCHIVE.name}")

    scale = TARGET_H / src.height
    art_w = int(round(src.width * scale))
    art_h = TARGET_H
    art = src.resize((art_w, art_h), Image.Resampling.LANCZOS)
    print(f"scaled art: {art_w}x{art_h}")

    x0 = (TARGET_W - art_w) // 2
    x1 = x0 + art_w
    print(f"side pillars: {x0}px each")

    print("painting stone...")
    stone = paint_stone_plate(TARGET_W, TARGET_H, seed=1337)
    stone = shade_pillars_outward(stone, x0, x1)
    add_window_frame(stone, x0, x1, lip=22)

    art = vignette_art_edge(art, depth=40)
    canvas = stone
    canvas.paste(art, (x0, 0))

    draw = ImageDraw.Draw(canvas)
    draw.line([(x0, 0), (x0, art_h - 1)], fill=LIP_SHADOW, width=2)
    draw.line([(x1 - 1, 0), (x1 - 1, art_h - 1)], fill=LIP_SHADOW, width=2)

    assert canvas.size == (TARGET_W, TARGET_H)
    canvas.save(OUT, "JPEG", quality=92, optimize=True, progressive=True, subsampling=0)
    print(f"wrote {OUT}: {canvas.size[0]}x{canvas.size[1]} ({OUT.stat().st_size:,} bytes)")

    pillar_frac = x0 / TARGET_W
    art_frac = art_w / TARGET_W
    print("\nCSS overlay remap (unchanged if already remapped):")
    for name, old in [
        ("--tv-ledger-left", 64.5),
        ("--tv-ledger-width", 31.0),
        ("--tv-town-left", 2.5),
        ("--tv-town-width", 48.0),
    ]:
        new = old * art_frac if "width" in name else pillar_frac * 100 + old * art_frac
        print(f"  {name}: {old}% -> {new:.3f}%")


if __name__ == "__main__":
    main()

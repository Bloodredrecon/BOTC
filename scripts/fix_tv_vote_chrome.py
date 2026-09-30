"""Rebuild vote plaque/ring from vote-chrome with safe transparent padding.

Always pad AFTER content trim so ornate L/R tips are never CLIPPED at bitmap edges.

Usage:
  python scripts/fix_tv_vote_chrome.py
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ELS = ROOT / "web" / "public" / "tv" / "elements"
PROBE = ROOT / "web" / "public" / "tv" / "_alpha_probe"

PLAQUE_PAD = 80
RING_PAD = 48
TOWN_MIN_PAD = (24, 24, 16, 16)  # L R T B
LEDGER_MIN_PAD = (16, 16, 24, 16)


def premultiply_safe(rgba: Image.Image) -> Image.Image:
    arr = np.array(rgba, dtype=np.float32)
    a = arr[..., 3:4] / 255.0
    arr[..., :3] = arr[..., :3] * a
    mask = a[..., 0] > 1e-3
    for c in range(3):
        ch = arr[..., c]
        ch[mask] = ch[mask] / a[..., 0][mask]
        ch[~mask] = 0
        arr[..., c] = ch
    arr[..., 3] = np.array(rgba)[..., 3]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def pad_canvas(im: Image.Image, pad: int) -> Image.Image:
    out = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    out.paste(im, (pad, pad), im)
    return out


def content_bbox(a: np.ndarray, thr: int = 15):
    ys, xs = np.where(a > thr)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def strip_checker_region(arr: np.ndarray) -> np.ndarray:
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    chroma = mx - mn
    strong_brass = (r > 110) & (g > 80) & (b < 140) & ((r + g) > b * 2.2) & (chroma > 35) & (a > 50)
    blood = (r > 70) & (r > g * 1.3) & (r > b * 1.3) & (chroma > 30) & (a > 40)
    dark = (lum < 65) & (a > 40) & (chroma < 50)
    keep = strong_brass | blood | dark
    checker = (chroma < 28) & (lum > 70) & (lum < 215)
    new_a = np.where(checker & ~keep, 0, a.copy())
    h, w = new_a.shape
    visited = np.zeros((h, w), dtype=bool)
    kill = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or visited[y, x]:
            continue
        visited[y, x] = True
        if keep[y, x]:
            continue
        kill[y, x] = True
        q.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    new_a = np.where(kill, 0, new_a)
    out = arr.copy()
    out[..., 3] = new_a
    return out


def ensure_min_pad(path: Path, min_lrtb: tuple[int, int, int, int]) -> None:
    im = Image.open(path).convert("RGBA")
    a = np.array(im)[..., 3]
    bb = content_bbox(a, 15)
    if not bb:
        return
    x0, y0, x1, y1 = bb
    w, h = im.size
    cur = (x0, w - 1 - x1, y0, h - 1 - y1)
    need_l, need_r, need_t, need_b = min_lrtb
    add = (
        max(0, need_l - cur[0]),
        max(0, need_r - cur[1]),
        max(0, need_t - cur[2]),
        max(0, need_b - cur[3]),
    )
    if not any(add):
        print(f"{path.name} pad OK {cur}")
        return
    out = Image.new("RGBA", (w + add[0] + add[1], h + add[2] + add[3]), (0, 0, 0, 0))
    out.paste(im, (add[0], add[2]), im)
    out.save(path, "PNG", optimize=True)
    print(f"{path.name} padded +LRTB={add} -> {out.size}")


def main() -> None:
    chrome = Image.open(ELS / "vote-chrome.png").convert("RGBA")
    carr = strip_checker_region(np.array(chrome, dtype=np.float32))
    chrome_clean = premultiply_safe(Image.fromarray(np.clip(carr, 0, 255).astype(np.uint8), "RGBA"))
    chrome_clean.save(ELS / "vote-chrome.png", "PNG", optimize=True)

    a = np.array(chrome_clean)[..., 3]
    h, w = a.shape
    spans = np.array(
        [
            0 if len(xs := np.where(a[y] > 30)[0]) == 0 else int(xs.max() - xs.min())
            for y in range(h)
        ]
    )
    max_span = max(1, int(spans.max()))
    top = spans[: int(h * 0.45)]
    wide = np.where(top > 0.8 * max_span)[0]
    pe = int(wide[-1]) + 10 if len(wide) else int(h * 0.35)

    top_a = a[:pe]
    ys, xs = np.where(top_a > 30)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    crop = chrome_clean.crop((max(0, x0 - 8), max(0, y0 - 8), min(w, x1 + 9), min(pe, y1 + 9)))
    parr = strip_checker_region(np.array(crop, dtype=np.float32))
    pa = parr[..., 3]
    ph = pa.shape[0]
    pspans = np.array(
        [
            0 if len(xs := np.where(pa[y] > 30)[0]) == 0 else int(xs.max() - xs.min())
            for y in range(ph)
        ]
    )
    wide_rows = np.where(pspans > 0.75 * max(1, pspans.max()))[0]
    if len(wide_rows):
        last_wide = int(wide_rows[-1]) + 6
        if last_wide < ph:
            parr[last_wide:, ..., 3] = 0
    plaque = premultiply_safe(Image.fromarray(np.clip(parr, 0, 255).astype(np.uint8), "RGBA"))
    bb = content_bbox(np.array(plaque)[..., 3], 12)
    if bb:
        x0, y0, x1, y1 = bb
        plaque = plaque.crop((x0, y0, x1 + 1, y1 + 1))
    plaque = pad_canvas(plaque, PLAQUE_PAD)
    plaque.save(ELS / "vote-plaque.png", "PNG", optimize=True)
    print(f"vote-plaque {plaque.size} pad={PLAQUE_PAD}")

    ring_crop = chrome_clean.crop((0, pe - 4, w, h))
    ra = np.array(ring_crop)
    rh, rw = ra.shape[:2]
    for y in range(min(100, rh)):
        xs = np.where(ra[y, ..., 3] > 30)[0]
        if len(xs) and (xs.max() - xs.min()) > 0.65 * rw:
            ra[y, ..., 3] = 0
    ring_img = premultiply_safe(Image.fromarray(ra, "RGBA"))
    arr = np.array(ring_img).astype(np.float32)
    rh, rw = arr.shape[:2]
    cy, cx = rh / 2.0, rw / 2.0
    yy, xx = np.ogrid[:rh, :rw]
    dist = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    r, g, b, aa = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    brass = (aa > 40) & (r > 90) & (g > 65) & ((r + g) > b * 2)
    r_med = float(np.median(dist[brass])) if brass.any() else min(rh, rw) * 0.42
    hole = np.clip((r_med * 0.78 - dist) / max(3.0, r_med * 0.05), 0, 1)
    outside = np.clip((dist - r_med * 1.16) / 5.0, 0, 1)
    greenish = (g > r + 8) & (g > b) & (aa > 5)
    arr[..., 3] *= (1 - hole) * (1 - outside)
    arr[..., 3] = np.where(greenish & (dist > r_med * 0.95), 0, arr[..., 3])
    ring_img = premultiply_safe(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA"))
    bb = content_bbox(np.array(ring_img)[..., 3], 12)
    if bb:
        x0, y0, x1, y1 = bb
        ring_img = ring_img.crop((x0, y0, x1 + 1, y1 + 1))
    ring_img = pad_canvas(ring_img, RING_PAD)
    side = max(ring_img.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(ring_img, ((side - ring_img.width) // 2, (side - ring_img.height) // 2), ring_img)
    sq.save(ELS / "vote-ring.png", "PNG", optimize=True)
    print(f"vote-ring {sq.size} pad={RING_PAD}")

    ensure_min_pad(ELS / "town-frame.png", TOWN_MIN_PAD)
    ensure_min_pad(ELS / "ledger-panel.png", LEDGER_MIN_PAD)

    PROBE.mkdir(parents=True, exist_ok=True)
    print("\n=== EDGE AUDIT ===")
    for name in (
        "vote-plaque.png",
        "vote-ring.png",
        "vote-chrome.png",
        "town-frame.png",
        "ledger-panel.png",
        "day-marker.png",
    ):
        im = Image.open(ELS / name).convert("RGBA")
        a = np.array(im)[..., 3]
        h, w = a.shape
        ys, xs = np.where(a > 20)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
        flags = []
        if x0 <= 1:
            flags.append("CLIP-L")
        if x1 >= w - 2:
            flags.append("CLIP-R")
        if y0 <= 1:
            flags.append("CLIP-T")
        if y1 >= h - 2:
            flags.append("CLIP-B")
        if not flags:
            flags.append("OK")
        print(
            f"{name:22} {w}x{h} pad LRTB=({x0},{w - 1 - x1},{y0},{h - 1 - y1}) {' '.join(flags)}"
        )


if __name__ == "__main__":
    main()

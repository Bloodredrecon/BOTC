"""Build blank (text-free) TV chrome for the /tv overhaul + run the alpha/crop audit.

Every output is a frame, plaque, ornament, texture, stud or emblem — no words or numbers.
All live copy is rendered by TvPage.

Usage:
  python scripts/build_tv_overhaul_assets.py
"""

from __future__ import annotations

import math
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ELS = ROOT / "web" / "public" / "tv" / "elements"
PRIOR = ELS / "_prior"
PROBE = ROOT / "web" / "public" / "tv" / "_alpha_probe" / "overhaul"
ASSETS = Path(r"C:\Users\danie\.cursor\projects\c-Users-danie-BOTC\assets")

rng = np.random.default_rng(1729)


# ---------------------------------------------------------------- helpers
def box_blur(arr: np.ndarray, r: int) -> np.ndarray:
    """Separable box blur (float arrays, HxW or HxWxC)."""
    if r <= 0:
        return arr
    out = arr.astype(np.float64)
    for axis in (0, 1):
        pad = [(0, 0)] * out.ndim
        pad[axis] = (r + 1, r)
        p = np.pad(out, pad, mode="edge")
        c = np.cumsum(p, axis=axis)
        hi = np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis)
        lo = np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)
        out = (hi - lo) / (2 * r + 1)
    return out


def fill_holes(im: Image.Image, k: int = 11) -> tuple[Image.Image, int]:
    """Close small alpha pinholes (morphological close) and inpaint their colour."""
    rgba = np.array(im.convert("RGBA")).astype(np.float64)
    a = rgba[..., 3]
    a_img = Image.fromarray(a.astype(np.uint8), "L")
    closed = np.array(a_img.filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MinFilter(k))).astype(np.float64)
    new_a = np.maximum(a, closed)
    grew = new_a > a + 8
    n = int(grew.sum())
    if n:
        w = a / 255.0
        rgb = rgba[..., :3]
        fill = rgb.copy()
        todo = grew.copy()
        for r in (2, 4, 8, 16, 32):
            num = box_blur(rgb * w[..., None], r)
            den = box_blur(w, r)[..., None]
            ok = (den[..., 0] > 0.05) & todo
            fill[ok] = (num[ok] / den[ok])
            todo &= ~ok
            if not todo.any():
                break
        # blend: fully replace colour where source alpha was tiny
        t = (1 - w)[..., None]
        rgba[..., :3] = np.where(grew[..., None], rgb * (1 - t) + fill * t, rgb)
        rgba[..., 3] = new_a
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA"), n


def trim_pad(im: Image.Image, pad: int, thr: int = 10) -> Image.Image:
    a = np.array(im)[..., 3]
    ys, xs = np.where(a > thr)
    im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    out = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    out.paste(im, (pad, pad), im)
    return out


def circle_crop(im: Image.Image, cx: float, cy: float, r: float, feather: float = 3.0, pad: int = 12) -> Image.Image:
    box = (int(cx - r - 2), int(cy - r - 2), int(cx + r + 3), int(cy + r + 3))
    c = np.array(im.convert("RGBA").crop(box)).astype(np.float64)
    h, w = c.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt((xx - (cx - box[0])) ** 2 + (yy - (cy - box[1])) ** 2)
    m = np.clip((r - d) / feather, 0, 1)
    c[..., 3] = c[..., 3] * m
    out = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), "RGBA")
    return trim_pad(out, pad, thr=4)


def fractal_noise(h: int, w: int, octaves: int = 6, base: int = 4) -> np.ndarray:
    acc = np.zeros((h, w))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        gh, gw = base * 2**o + 1, int(base * 2**o * w / h) + 1
        g = rng.random((gh, gw)).astype(np.float32)
        up = np.array(Image.fromarray((g * 255).astype(np.uint8), "L").resize((w, h), Image.BICUBIC)) / 255.0
        acc += up * amp
        tot += amp
        amp *= 0.55
    acc /= tot
    return (acc - acc.min()) / (acc.max() - acc.min() + 1e-9)


# ---------------------------------------------------------------- builders
def build_plaque() -> Image.Image:
    src = Image.open(ELS / "vote-plaque.png").convert("RGBA")
    out, n = fill_holes(src, 13)
    out = trim_pad(out, 96)
    out.save(ELS / "plaque-oak.png", optimize=True)
    print(f"plaque-oak.png {out.size} holes_filled={n}")
    return out


def build_day_marker(plaque: Image.Image) -> None:
    old = ELS / "day-marker.png"
    arch = PRIOR / "day-marker-baked-day3.png"
    if old.exists() and not arch.exists():
        shutil.copy2(old, arch)
    plaque.save(old, optimize=True)
    print(f"day-marker.png <- blank plaque-oak (baked 'DAY 3' archived to {arch.name})")


def build_town_frame() -> None:
    src = Image.open(ELS / "town-frame.png").convert("RGBA")
    arr = np.array(src).astype(np.float64)
    # Title band interior (baked 'THE TOWN' + ✥ ornaments) — refill with band wood.
    y0, y1 = 118, 280
    x0, x1 = 680, 1720
    left = arr[y0:y1, 372:680].copy()
    right = arr[y0:y1, 1720:2028].copy()
    seg_w = left.shape[1]
    segs = [left, right[:, ::-1], left[:, ::-1], right]
    width = x1 - x0
    xf = 48  # crossfade
    fill = np.zeros((y1 - y0, width, 4))
    pos, i = 0, 0
    while pos < width:
        s = segs[i % len(segs)]
        take = min(seg_w, width - pos + xf)
        piece = s[:, :take]
        if pos == 0:
            fill[:, : min(take, width)] = piece[:, : min(take, width)]
        else:
            start = pos - xf
            ramp = np.linspace(0, 1, xf)[None, :, None]
            fill[:, start:pos] = fill[:, start:pos] * (1 - ramp) + piece[:, :xf] * ramp
            end = min(width, start + take)
            fill[:, pos:end] = piece[:, xf : xf + (end - pos)]
        pos = (pos - xf if pos else 0) + take
        i += 1
    # soft vertical edges into original band
    edge = 24
    ramp = np.ones(width)
    ramp[:edge] = np.linspace(0, 1, edge)
    ramp[-edge:] = np.linspace(1, 0, edge)
    ramp = ramp[None, :, None]
    region = arr[y0:y1, x0:x1]
    arr[y0:y1, x0:x1] = region * (1 - ramp) + fill * ramp
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    out, n = fill_holes(out, 11)
    out.save(ELS / "town-frame-blank.png", optimize=True)
    print(f"town-frame-blank.png {out.size} holes_filled={n}")


def build_ring() -> None:
    src = Image.open(ELS / "vote-ring.png").convert("RGBA")
    a = np.array(src)[..., 3]
    ys, xs = np.where(a > 20)
    cx, cy = (xs.min() + xs.max()) / 2.0, (ys.min() + ys.max()) / 2.0
    R = (xs.max() - xs.min()) / 2.0
    # Baked vote studs are replaced by live CSS studs (count varies 5–20).
    rot = src.rotate(180, resample=Image.BICUBIC, center=(cx, cy))
    A = np.array(src).astype(np.float64)
    B = np.array(rot).astype(np.float64)
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w]
    ang = np.degrees(np.arctan2(yy - cy, xx - cx))  # y-down: bottom = +90
    lo, hi, fe = 16.0, 164.0, 7.0
    m = np.clip((ang - lo) / fe, 0, 1) * np.clip((hi - ang) / fe, 0, 1)
    m = m[..., None]
    out = A * (1 - m) + B * m
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")
    img, n = fill_holes(img, 9)
    img = trim_pad(img, 56)
    side = max(img.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    sq.save(ELS / "vote-ring-blank.png", optimize=True)
    print(f"vote-ring-blank.png {sq.size} holes_filled={n} center=({cx:.0f},{cy:.0f}) R={R:.0f}")


def build_emblems() -> None:
    src = ELS / "seat-chip-alive.png"
    if not src.exists():
        src = PRIOR / "legacy-seat-chip-alive.png"
    alive = Image.open(src).convert("RGBA")
    alive, _ = fill_holes(alive, 7)
    sun = circle_crop(alive, 290, 164, 103, feather=2.0)
    sun.save(ELS / "emblem-sun.png", optimize=True)
    nom = Image.open(ELS / "nomination-plaque.png").convert("RGBA")
    a = np.array(nom)[..., 3]
    # locate medallion centre: brightest brass blob near horizontal centre
    h, w = a.shape
    cx, cy, r = w * 0.4985, h * 0.44, h * 0.245
    region = nom.crop((int(cx - r - 40), int(cy - r - 40), int(cx + r + 40), int(cy + r + 40)))
    region, _ = fill_holes(region, 31)
    skull = circle_crop(region, r + 40, r + 40, r, feather=2.5)
    skull.save(ELS / "emblem-skull.png", optimize=True)
    print(f"emblem-sun.png {sun.size}  emblem-skull.png {skull.size}")


def build_textures() -> None:
    # Dawn graveyard backdrop (generated, text-free)
    g = Image.open(ASSETS / "tv-dawn-graveyard.png").convert("RGB")
    g = g.resize((2560, int(2560 * g.height / g.width)), Image.LANCZOS)
    g.save(ELS / "dawn-graveyard.jpg", quality=88)
    # Parchment interior (crop away the baked checker edge of the source)
    p = Image.open(ASSETS / "parchment-hi.png").convert("RGB")
    pw, ph = p.size
    p = p.crop((int(pw * 0.12), int(ph * 0.1), int(pw * 0.88), int(ph * 0.9)))
    p = p.resize((p.width * 2, p.height * 2), Image.LANCZOS)
    p.save(ELS / "parchment-tex.jpg", quality=88)
    # Distress mask — white with worn / speckled alpha (for mask-image on phase words)
    H, W = 512, 1024
    n1 = fractal_noise(H, W, 7, 3)
    n2 = fractal_noise(H, W, 5, 12)
    worn = np.clip((n1 - 0.30) / 0.25, 0, 1)  # broad weathering
    speck = (n2 > 0.80).astype(np.float64) * 0.9 + (rng.random((H, W)) > 0.992) * 1.0
    alpha = np.clip(0.35 + 0.65 * worn - speck, 0, 1)
    # scratches
    sc = Image.new("L", (W, H), 0)
    from PIL import ImageDraw

    d = ImageDraw.Draw(sc)
    for _ in range(70):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        ang = rng.uniform(-0.5, 0.5)
        ln = rng.uniform(20, 120)
        d.line([(x, y), (x + ln * math.cos(ang), y + ln * math.sin(ang))], fill=int(rng.uniform(140, 255)), width=int(rng.integers(1, 3)))
    alpha = np.clip(alpha - np.array(sc) / 255.0 * 0.85, 0, 1)
    alpha = np.array(Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.6))) / 255.0
    mask = np.dstack([np.full((H, W, 3), 255), alpha * 255]).astype(np.uint8)
    Image.fromarray(mask, "RGBA").save(ELS / "distress-mask.png", optimize=True)
    # Blood wear — dried-blood blotches, heavier toward the bottom
    n3 = fractal_noise(H, W, 6, 5)
    grad = np.linspace(0.15, 1.0, H)[:, None]
    blot = np.clip((n3 * 0.8 + grad * 0.45 - 0.72) / 0.12, 0, 1)
    drip = np.zeros((H, W))
    for _ in range(26):
        x = int(rng.uniform(0, W))
        y0 = int(rng.uniform(H * 0.45, H * 0.8))
        ln = int(rng.uniform(20, 140))
        wdt = int(rng.integers(2, 7))
        drip[y0 : min(H, y0 + ln), max(0, x - wdt // 2) : x + wdt // 2 + 1] = 1
    blot = np.clip(blot + drip * 0.9, 0, 1)
    blot = np.array(Image.fromarray((blot * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(1.2))) / 255.0
    tone = 0.75 + 0.25 * fractal_noise(H, W, 4, 8)
    rgb = np.dstack([130 * tone, 18 * tone, 16 * tone])
    blood = np.dstack([rgb, blot * 235]).astype(np.uint8)
    Image.fromarray(blood, "RGBA").save(ELS / "blood-wear.png", optimize=True)
    print("dawn-graveyard.jpg parchment-tex.jpg distress-mask.png blood-wear.png")


def clean_halo(name: str, out_name: str, medallion: bool = False) -> None:
    """Strip the baked white outline around a plaque and close pinholes."""
    arr = np.array(Image.open(ELS / name).convert("RGBA")).astype(np.float64)
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    chroma = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    light = (lum > 120) & (chroma < 30)
    # only light pixels reachable from the transparent outside (the outline), not skull highlights
    reach = a < 20
    light_img = Image.fromarray((light * 255).astype(np.uint8), "L")
    for _ in range(16):
        grown = np.array(Image.fromarray((reach * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(3))) > 0
        nxt = reach | (grown & light)
        if (nxt == reach).all():
            break
        reach = nxt
    del light_img
    halo = reach & light
    a = np.where(halo, 0, a)
    a_img = Image.fromarray(a.astype(np.uint8), "L").filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    arr[..., 3] = np.minimum(a, np.array(a_img))
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    im, n = fill_holes(im, 9)
    if medallion:
        w, h = im.size
        cx, cy, r = w * 0.4985, h * 0.44, h * 0.30
        box = (int(cx - r), int(cy - r), int(cx + r), int(cy + r))
        region, _ = fill_holes(im.crop(box), 31)
        yy, xx = np.mgrid[0 : box[3] - box[1], 0 : box[2] - box[0]]
        inside = (np.sqrt((xx - r) ** 2 + (yy - r) ** 2) < r * 0.78).astype(np.uint8) * 255
        im.paste(region, box, Image.fromarray(inside, "L"))
    im = trim_pad(im, 96)
    im.save(ELS / out_name, optimize=True)
    print(f"{out_name} {im.size} halo_px={int(halo.sum())} holes_filled={n}")


def archive_legacy() -> None:
    """Move text-bearing / superseded art out of the live folder."""
    PRIOR.mkdir(exist_ok=True)
    for name in (
        "ledger-panel.png",
        "ledger-panel-generated.png",
        "ledger-panel-from-bg.png",
        "seat-chip-alive.png",
        "seat-chip-ghost.png",
        "seat-chip-spent.png",
        "vote-chrome.png",
        "logo.png",
        "logo-from-bg.png",
    ):
        src = ELS / name
        if src.exists():
            dst = PRIOR / f"legacy-{name}"
            shutil.move(str(src), str(dst))
            print(f"archived {name} -> _prior/{dst.name}")


# ---------------------------------------------------------------- audit
def audit(names: list[str]) -> None:
    PROBE.mkdir(parents=True, exist_ok=True)
    print("\n=== ALPHA / CROP AUDIT ===")
    for name in names:
        path = ELS / name
        im = Image.open(path)
        if im.mode != "RGBA":
            print(f"{name:26} {im.size[0]}x{im.size[1]} opaque texture ({im.mode}) OK")
            continue
        if name in ("distress-mask.png", "blood-wear.png"):
            print(f"{name:26} {im.size[0]}x{im.size[1]} CSS mask/texture layer (edge-to-edge by design) OK")
            continue
        arr = np.array(im).astype(np.int32)
        a = arr[..., 3]
        h, w = a.shape
        ys, xs = np.where(a > 20)
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        flags = []
        if x0 <= 2:
            flags.append("CLIP-L")
        if x1 >= w - 3:
            flags.append("CLIP-R")
        if y0 <= 2:
            flags.append("CLIP-T")
        if y1 >= h - 3:
            flags.append("CLIP-B")
        # pinholes: transparent pixels a small close would fill
        a_img = Image.fromarray(a.astype(np.uint8), "L")
        closed = np.array(a_img.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7)))
        holes = int(((closed.astype(int) - a) > 60).sum())
        # baked checkerboard: opaque neutral light-grey/white pixels
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        neutral = (np.abs(r - g) < 6) & (np.abs(g - b) < 6) & (r > 185) & (a > 200)
        checker = int(neutral.sum())
        if holes > 50:
            flags.append(f"HOLES={holes}")
        if checker > 200 and not name.startswith("distress"):
            flags.append(f"CHECKER?={checker}")
        if not flags:
            flags.append("OK")
        print(f"{name:26} {w}x{h} pad LRTB=({x0},{w - 1 - x1},{y0},{h - 1 - y1}) alpha[{a.min()}..{a.max()}] {' '.join(flags)}")
        for label, col in (("magenta", (255, 0, 255, 255)), ("black", (0, 0, 0, 255))):
            bg = Image.new("RGBA", im.size, col)
            bg.alpha_composite(im.convert("RGBA"))
            bg.convert("RGB").save(PROBE / f"{path.stem}_on_{label}.jpg", quality=85)


def main() -> None:
    PRIOR.mkdir(exist_ok=True)
    plaque = build_plaque()
    build_day_marker(plaque)
    build_town_frame()
    build_ring()
    build_emblems()
    build_textures()
    clean_halo("nomination-plaque.png", "nomination-plaque-clean.png", medallion=True)
    clean_halo("execution-placard.png", "execution-placard-clean.png")
    archive_legacy()
    audit(
        [
            "plaque-oak.png",
            "day-marker.png",
            "town-frame-blank.png",
            "vote-ring-blank.png",
            "emblem-sun.png",
            "emblem-skull.png",
            "nomination-plaque-clean.png",
            "execution-placard-clean.png",
            "distress-mask.png",
            "blood-wear.png",
            "dawn-graveyard.jpg",
            "parchment-tex.jpg",
        ]
    )


if __name__ == "__main__":
    main()

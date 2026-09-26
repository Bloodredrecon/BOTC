"""Process regenerated Ravenswood Gazette + THE TOWN frame into clean RGBA PNGs."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(r"C:\Users\danie\BOTC")
ASSETS = Path(r"C:\Users\danie\.cursor\projects\c-Users-danie-BOTC\assets")
OUT = ROOT / "web" / "public" / "tv" / "elements"
PROBE = ROOT / "web" / "public" / "tv" / "_alpha_probe"


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


def upscale_long(im: Image.Image, long_edge: int) -> Image.Image:
    w, h = im.size
    scale = long_edge / max(w, h)
    if scale <= 1.01:
        return im
    nw, nh = int(round(w * scale)), int(round(h * scale))
    return im.resize((nw, nh), Image.Resampling.LANCZOS)


def crop_bbox(im: Image.Image, pad: int = 8) -> Image.Image:
    a = np.array(im.split()[-1])
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return im
    x0, x1 = max(0, xs.min() - pad), min(im.width, xs.max() + pad + 1)
    y0, y1 = max(0, ys.min() - pad), min(im.height, ys.max() + pad + 1)
    return im.crop((x0, y0, x1, y1))


def flood_dark_interior(rgb: np.ndarray, alpha: np.ndarray, lum_max: float = 55.0) -> np.ndarray:
    """Punch transparent hole in near-black seat area while keeping brass/wood frame."""
    h, w = alpha.shape
    lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]).astype(np.float32)
    r = rgb[..., 0].astype(np.float32)
    g = rgb[..., 1].astype(np.float32)
    b = rgb[..., 2].astype(np.float32)
    brass = (r > 110) & (g > 80) & (b < 140) & ((r + g) > b * 2.0)

    cy, cx = int(h * 0.58), w // 2
    visited = np.zeros((h, w), dtype=bool)
    stack = [(cy, cx)]
    interior = np.zeros((h, w), dtype=bool)
    while stack:
        y, x = stack.pop()
        if y < 0 or y >= h or x < 0 or x >= w or visited[y, x]:
            continue
        visited[y, x] = True
        if brass[y, x]:
            continue
        if lum[y, x] > lum_max:
            continue
        # Stay inside content window — don't eat outer black plate
        if y < int(h * 0.18) or y > int(h * 0.94):
            continue
        if x < int(w * 0.06) or x > int(w * 0.94):
            continue
        interior[y, x] = True
        stack.extend([(y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)])

    mask_img = Image.fromarray((interior.astype(np.uint8) * 255), mode="L")
    mask_img = mask_img.filter(ImageFilter.GaussianBlur(radius=1.4))
    soft = np.array(mask_img, dtype=np.float32) / 255.0
    out = alpha.astype(np.float32) * (1.0 - soft)
    return np.clip(out, 0, 255).astype(np.uint8)


def process_gazette(src: Path, dest: Path) -> Image.Image:
    """Wood-backed parchment gazette on black plate → clean RGBA."""
    rgb = np.array(Image.open(src).convert("RGB"))
    r, g, b = rgb[..., 0].astype(np.float32), rgb[..., 1].astype(np.float32), rgb[..., 2].astype(np.float32)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    chroma = mx - mn
    warm = r - b

    parchment = (lum > 55) & (warm > 10)
    blood = (r > 60) & (r > g * 1.12) & (r > b * 1.08) & (lum > 18) & (lum < 160)
    brass = (r > 90) & (g > 60) & (b < 150) & ((r + g) > b * 1.6) & (lum > 40)
    # Dark wood / ink (not pure black plate): some chroma or warmth
    wood_ink = (lum > 10) & (lum < 95) & ((chroma > 8) | (warm > 6) | (r > g + 4))
    ink_black = (lum < 45) & parchment  # will be recovered via dilate from parchment neighbors
    seed = parchment | blood | brass | wood_ink

    m = Image.fromarray((seed.astype(np.uint8) * 255), "L")
    for _ in range(3):
        m = m.filter(ImageFilter.MaxFilter(5))
    m = m.filter(ImageFilter.GaussianBlur(radius=1.0))
    sheet = np.array(m, dtype=np.float32) / 255.0

    # Soft-key pure black plate: low lum + low chroma outside content
    plate = (lum < 14) & (chroma < 12)
    alpha = sheet.copy()
    alpha = np.where(plate, 0.0, alpha)
    alpha = np.where(sheet > 0.45, 1.0, alpha)
    alpha = np.where(brass | blood | parchment, np.maximum(alpha, 0.98), alpha)
    # Kill residual near-black fringe outside soft sheet
    alpha = np.where((lum < 8) & (sheet < 0.35), 0.0, alpha)

    a_u8 = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    rgba = np.dstack([rgb, a_u8])
    im = premultiply_safe(Image.fromarray(rgba, "RGBA"))
    im = crop_bbox(im, 4)
    im = upscale_long(im, 2200)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "PNG", optimize=True)
    print(f"gazette {im.size} -> {dest.name}")
    return im


def process_town(src: Path, dest: Path) -> Image.Image:
    """Ornate brass/wood town placard on black plate → clean RGBA hollow."""
    rgb = np.array(Image.open(src).convert("RGB"))
    r, g, b = rgb[..., 0].astype(np.float32), rgb[..., 1].astype(np.float32), rgb[..., 2].astype(np.float32)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    chroma = mx - mn
    brass = (r > 90) & (g > 60) & (b < 160) & ((r + g) > b * 1.55) & (lum > 35)
    blood = (r > 70) & (r > g * 1.2) & (r > b * 1.15) & (lum > 20) & (lum < 140)
    wood = (lum > 14) & (lum < 120) & ((chroma > 6) | ((r - b) > 4))
    # Frame body — exclude pure black plate and deep hollow
    frame = brass | blood | wood | ((lum > 20) & (lum < 165) & (chroma > 5))
    alpha = np.where(frame, 255.0, 0.0)
    alpha = np.where((lum < 10) & (chroma < 10), 0.0, alpha)
    alpha = np.where(brass | blood, 255.0, alpha)

    a_img = Image.fromarray(np.clip(alpha, 0, 255).astype(np.uint8), "L")
    a_img = a_img.filter(ImageFilter.MaxFilter(3))
    a_img = a_img.filter(ImageFilter.GaussianBlur(radius=0.6))
    alpha_u8 = np.array(a_img)
    alpha_u8 = np.where(brass | blood | ((lum > 26) & (lum < 135) & (chroma > 8)), np.maximum(alpha_u8, 248), alpha_u8)
    # Hollow seat window
    alpha_u8 = flood_dark_interior(rgb, alpha_u8, lum_max=38.0)
    alpha_u8 = np.where((lum < 7) & (chroma < 8), 0, alpha_u8)

    rgba = np.dstack([rgb, alpha_u8])
    im = premultiply_safe(Image.fromarray(rgba, "RGBA"))
    im = crop_bbox(im, 6)
    im = upscale_long(im, 2400)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "PNG", optimize=True)
    print(f"town-frame {im.size} -> {dest.name}")
    return im


def probe(path: Path) -> None:
    im = Image.open(path).convert("RGBA")
    a = np.array(im.split()[-1])
    w, h = im.size
    corners = [
        im.getpixel((0, 0)),
        im.getpixel((w - 1, 0)),
        im.getpixel((0, h - 1)),
        im.getpixel((w - 1, h - 1)),
    ]
    print(
        f"PROBE {path.name}: {w}x{h} "
        f"alpha[min={a.min()}, max={a.max()}, mean={a.mean():.1f}] "
        f"corners={corners}"
    )
    PROBE.mkdir(parents=True, exist_ok=True)
    for name, color in [("black", (0, 0, 0, 255)), ("magenta", (255, 0, 255, 255))]:
        base = Image.new("RGBA", im.size, color)
        base.alpha_composite(im)
        base.convert("RGB").save(PROBE / f"{path.stem}_on_{name}.jpg", quality=90)


def main() -> None:
    # Prefer storyteller-table matched pair (wood + shared brass corners)
    gazette_src = ASSETS / "tv-ledger-gazette-storyteller.png"
    if not gazette_src.exists():
        gazette_src = ASSETS / "tv-ledger-ravenswood-gazette.png"
    town_src = ASSETS / "tv-town-frame-storyteller.png"
    if not town_src.exists():
        town_src = ASSETS / "tv-town-frame-unified.png"
    if not town_src.exists():
        town_src = ASSETS / "tv-town-frame-coherent.png"

    g = process_gazette(gazette_src, OUT / "ledger-panel.png")
    t = process_town(town_src, OUT / "town-frame.png")
    # Keep a named copy for reference
    g.save(OUT / "ledger-panel-generated.png", "PNG", optimize=True)
    probe(OUT / "ledger-panel.png")
    probe(OUT / "town-frame.png")


if __name__ == "__main__":
    main()

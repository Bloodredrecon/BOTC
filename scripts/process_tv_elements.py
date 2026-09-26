"""Convert generated TV UI chrome into high-res premultiply-safe RGBA PNGs."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(r"C:\Users\danie\BOTC")
ASSETS = Path(r"C:\Users\danie\.cursor\projects\c-Users-danie-BOTC\assets")
OUT = ROOT / "web" / "public" / "tv" / "elements"
PROBE = ROOT / "web" / "public" / "tv" / "_alpha_probe"
BG = ROOT / "web" / "public" / "tv" / "bg-night.jpg"


def soft_key_light(rgb: np.ndarray, soft: float = 18.0, hard: float = 40.0) -> np.ndarray:
    """Alpha from darkness vs near-white/light-gray plate. 0=transparent, 255=opaque."""
    r, g, b = rgb[..., 0].astype(np.float32), rgb[..., 1].astype(np.float32), rgb[..., 2].astype(np.float32)
    # Distance from pure white (handles gray matte too)
    dist = np.sqrt((255 - r) ** 2 + (255 - g) ** 2 + (255 - b) ** 2)
    # Also treat near-uniform light gray as matte
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    chroma = mx - mn
    luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    # Light low-chroma pixels are matte
    matte = (luminance > 200) & (chroma < 28)
    matte |= (luminance > 230) & (chroma < 40)
    alpha = np.clip((dist - soft) / max(1e-6, hard - soft), 0, 1)
    alpha = np.where(matte, 0.0, alpha)
    return (alpha * 255).astype(np.uint8)


def soft_key_dark_scrim(rgb: np.ndarray) -> np.ndarray:
    """Keep dark smoke/plaque; drop light plate. Preserve soft edges."""
    r, g, b = rgb[..., 0].astype(np.float32), rgb[..., 1].astype(np.float32), rgb[..., 2].astype(np.float32)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    # red accent should stay opaque
    red = (r > 90) & (r > g * 1.6) & (r > b * 1.6)
    # darker = more opaque; light gray plate gone
    alpha = np.clip((175 - lum) / 145.0, 0, 1)
    alpha = np.where(red, np.maximum(alpha, 0.95), alpha)
    # kill remaining near-white
    alpha = np.where(lum > 210, 0.0, alpha)
    return (alpha * 255).astype(np.uint8)


def flood_interior_white(rgb: np.ndarray, alpha: np.ndarray, seed_thresh: int = 245) -> np.ndarray:
    """Make bright interior (town frame hole) transparent while keeping frame."""
    h, w = alpha.shape
    lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]).astype(np.float32)
    # Seed from center if bright
    cy, cx = h // 2, w // 2
    if lum[cy, cx] < seed_thresh:
        # find brightest near center
        y0, y1 = int(h * 0.25), int(h * 0.75)
        x0, x1 = int(w * 0.2), int(w * 0.8)
        patch = lum[y0:y1, x0:x1]
        iy, ix = np.unravel_index(np.argmax(patch), patch.shape)
        cy, cx = y0 + int(iy), x0 + int(ix)

    visited = np.zeros((h, w), dtype=bool)
    stack = [(cy, cx)]
    interior = np.zeros((h, w), dtype=bool)
    while stack:
        y, x = stack.pop()
        if y < 0 or y >= h or x < 0 or x >= w or visited[y, x]:
            continue
        visited[y, x] = True
        if lum[y, x] < 200:
            continue
        # stop at gold-ish / dark frame pixels
        r, g, b = float(rgb[y, x, 0]), float(rgb[y, x, 1]), float(rgb[y, x, 2])
        if (r + g + b) / 3 < 190 and not (r > 160 and g > 120 and b < 100):
            # dark or brass edge
            if lum[y, x] < 210:
                continue
        interior[y, x] = True
        stack.extend([(y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)])

    # Soften interior mask
    mask_img = Image.fromarray((interior.astype(np.uint8) * 255), mode="L")
    mask_img = mask_img.filter(ImageFilter.GaussianBlur(radius=1.2))
    soft = np.array(mask_img, dtype=np.float32) / 255.0
    out = alpha.astype(np.float32)
    out = out * (1.0 - soft)
    return np.clip(out, 0, 255).astype(np.uint8)


def premultiply_safe(rgba: Image.Image) -> Image.Image:
    """Zero RGB where alpha is 0 to avoid white fringing on dark BGs."""
    arr = np.array(rgba, dtype=np.float32)
    a = arr[..., 3:4] / 255.0
    # Where nearly transparent, pull RGB toward 0 (dark) rather than white
    arr[..., :3] = arr[..., :3] * a
    # restore non-premultiplied for PNG storage but with dark fringe pixels
    # Actually store straight alpha with dark fringe: RGB = premul / a when a>0
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


def process_day_marker(src: Path, dest: Path) -> None:
    rgb = np.array(Image.open(src).convert("RGB"))
    alpha = soft_key_dark_scrim(rgb)
    # blur alpha slightly for soft plume edges
    a_img = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(radius=0.8))
    alpha = np.array(a_img)
    rgba = np.dstack([rgb, alpha])
    im = premultiply_safe(Image.fromarray(rgba, "RGBA"))
    im = crop_bbox(im, 12)
    im = upscale_long(im, 2200)
    im.save(dest, "PNG", optimize=True)
    print(f"day-marker {im.size} -> {dest.name}")


def process_town_frame(src: Path, dest: Path) -> None:
    rgb = np.array(Image.open(src).convert("RGB"))
    alpha = soft_key_light(rgb, soft=12, hard=35)
    # restore frame: gold/brass and dark wood should be opaque
    r, g, b = rgb[..., 0].astype(np.float32), rgb[..., 1].astype(np.float32), rgb[..., 2].astype(np.float32)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    brass = (r > 120) & (g > 90) & (b < 140) & (r + g > b * 2.2)
    dark = lum < 90
    alpha = np.where(brass | dark, np.maximum(alpha, 240), alpha)
    alpha = flood_interior_white(rgb, alpha)
    # outer white already keyed
    a_img = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(radius=0.6))
    alpha = np.array(a_img)
    rgba = np.dstack([rgb, alpha])
    im = premultiply_safe(Image.fromarray(rgba, "RGBA"))
    im = crop_bbox(im, 10)
    im = upscale_long(im, 2400)
    im.save(dest, "PNG", optimize=True)
    print(f"town-frame {im.size} -> {dest.name}")


def process_ledger(src: Path, dest: Path) -> None:
    rgb = np.array(Image.open(src).convert("RGB"))
    # parchment is warm tan — keep it; key only cool light plate
    r, g, b = rgb[..., 0].astype(np.float32), rgb[..., 1].astype(np.float32), rgb[..., 2].astype(np.float32)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    warm = (r - b)  # parchment is warmer than matte gray
    chroma = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    # matte: light + cool/neutral
    matte = (lum > 205) & (warm < 12) & (chroma < 35)
    matte |= (lum > 235)
    # also key very light gray corners
    alpha = np.ones(lum.shape, dtype=np.float32)
    alpha = np.where(matte, 0.0, alpha)
    # soft edge near matte
    soft = (lum > 190) & (warm < 18) & (chroma < 40) & ~matte
    alpha = np.where(soft, np.clip((220 - lum) / 40.0, 0, 1), alpha)
    # keep blood (red) and raven (dark) fully
    red = (r > 80) & (r > g * 1.25) & (r > b * 1.25)
    dark = lum < 60
    alpha = np.where(red | dark, 1.0, alpha)
    a_img = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(radius=0.7))
    alpha_u8 = np.array(a_img)
    rgba = np.dstack([rgb, alpha_u8])
    im = premultiply_safe(Image.fromarray(rgba, "RGBA"))
    im = crop_bbox(im, 8)
    im = upscale_long(im, 2000)
    im.save(dest, "PNG", optimize=True)
    print(f"ledger {im.size} -> {dest.name}")


def process_vote(src: Path, dest: Path) -> None:
    rgb = np.array(Image.open(src).convert("RGB"))
    alpha = soft_key_light(rgb, soft=10, hard=32)
    r, g, b = rgb[..., 0].astype(np.float32), rgb[..., 1].astype(np.float32), rgb[..., 2].astype(np.float32)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    brass = (r > 110) & (g > 85) & (b < 130) & ((r + g) > b * 2.0)
    dark = lum < 100
    blood = (r > 70) & (r > g * 1.3) & (r > b * 1.3)
    alpha = np.where(brass | dark | blood, np.maximum(alpha, 235), alpha)
    # hollow the ring center: circular soft hole around geometric center of lower half
    h, w = lum.shape
    # ring is bottom portion — estimate center
    cy, cx = int(h * 0.62), w // 2
    yy, xx = np.ogrid[:h, :w]
    dist = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    # inner radius ~ 28% of min dim for hollow
    r_inner = min(h, w) * 0.22
    r_outer = min(h, w) * 0.28
    hole = np.clip((r_outer - dist) / max(1.0, r_outer - r_inner), 0, 1)
    # only punch hole where we're inside the dark disk (not the plaque)
    in_ring_zone = yy > h * 0.32
    alpha_f = alpha.astype(np.float32)
    alpha_f = np.where(in_ring_zone, alpha_f * (1.0 - hole * 0.92), alpha_f)
    a_img = Image.fromarray(np.clip(alpha_f, 0, 255).astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(radius=0.7)
    )
    rgba = np.dstack([rgb, np.array(a_img)])
    im = premultiply_safe(Image.fromarray(rgba, "RGBA"))
    im = crop_bbox(im, 10)
    im = upscale_long(im, 2200)
    im.save(dest, "PNG", optimize=True)
    print(f"vote {im.size} -> {dest.name}")


def process_logo(src: Path, dest: Path) -> None:
    rgb = np.array(Image.open(src).convert("RGB"))
    alpha = soft_key_light(rgb, soft=8, hard=28)
    r, g, b = rgb[..., 0].astype(np.float32), rgb[..., 1].astype(np.float32), rgb[..., 2].astype(np.float32)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    # Keep lettering (mid-light textured) and blood
    blood = (r > 60) & (r > g * 1.2) & (r > b * 1.2)
    letter = (lum < 210) | blood
    # near-white plate out
    matte = (lum > 225) & ((r - b) < 15)
    alpha_f = alpha.astype(np.float32)
    alpha_f = np.where(matte, 0.0, alpha_f)
    alpha_f = np.where(letter & ~matte, np.maximum(alpha_f, 200), alpha_f)
    # Soften: dilate slightly then blur — keep drips
    a_img = Image.fromarray(np.clip(alpha_f, 0, 255).astype(np.uint8), "L")
    a_img = a_img.filter(ImageFilter.MaxFilter(3))
    a_img = a_img.filter(ImageFilter.GaussianBlur(radius=0.5))
    rgba = np.dstack([rgb, np.array(a_img)])
    im = premultiply_safe(Image.fromarray(rgba, "RGBA"))
    im = crop_bbox(im, 6)
    im = upscale_long(im, 1800)
    im.save(dest, "PNG", optimize=True)
    print(f"logo {im.size} -> {dest.name}")


def extract_ledger_from_bg(dest: Path) -> bool:
    """Crop ledger region from 16:9 plate and key surroundings for a higher-fidelity panel."""
    if not BG.exists():
        return False
    bg = Image.open(BG).convert("RGB")
    w, h = bg.size
    # Measured from plate: parchment roughly right side lower third
    # Art centered in ~2880x2160 with 12.5% pillars; ledger ~60.8% left, 48% top
    x0 = int(w * 0.575)
    y0 = int(h * 0.455)
    x1 = int(w * 0.875)
    y1 = int(h * 0.955)
    crop = bg.crop((x0, y0, x1, y1))
    rgb = np.array(crop)
    r, g, b = rgb[..., 0].astype(np.float32), rgb[..., 1].astype(np.float32), rgb[..., 2].astype(np.float32)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    warm = r - b
    # Scene around parchment is dark red/brown night; parchment is light warm
    parchment = (lum > 95) & (warm > 18) & (r > 100)
    # also keep dark raven on top of parchment via proximity flood from parchment mask
    mask = parchment.astype(np.uint8) * 255
    m = Image.fromarray(mask, "L")
    m = m.filter(ImageFilter.MaxFilter(9))
    m = m.filter(ImageFilter.GaussianBlur(radius=2.5))
    alpha = np.array(m).astype(np.float32) / 255.0
    # Drop very dark scene pixels that aren't near parchment edge
    alpha = np.where((lum < 45) & (warm < 25), alpha * 0.15, alpha)
    rgba = np.dstack([rgb, (np.clip(alpha, 0, 1) * 255).astype(np.uint8)])
    im = premultiply_safe(Image.fromarray(rgba, "RGBA"))
    im = crop_bbox(im, 4)
    if im.width < 400:
        return False
    im = upscale_long(im, 2000)
    im.save(dest, "PNG", optimize=True)
    print(f"ledger-from-bg {im.size} -> {dest.name}")
    return True


def extract_logo_from_bg(dest: Path) -> bool:
    if not BG.exists():
        return False
    bg = Image.open(BG).convert("RGB")
    w, h = bg.size
    # Logo top-left of art (after pillars ~12.5%)
    x0 = int(w * 0.13)
    y0 = int(h * 0.02)
    x1 = int(w * 0.38)
    y1 = int(h * 0.28)
    crop = bg.crop((x0, y0, x1, y1))
    rgb = np.array(crop)
    r, g, b = rgb[..., 0].astype(np.float32), rgb[..., 1].astype(np.float32), rgb[..., 2].astype(np.float32)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    blood = (r > 70) & (r > g * 1.35) & (r > b * 1.25)
    # white/light lettering vs dark night sky
    letter = (lum > 120) | blood
    alpha = letter.astype(np.float32)
    # suppress scene warm window lights etc — logo is cool-white + red
    cool_white = (lum > 140) & ((r + g + b) / 3 > 130) & (np.abs(r - g) < 40)
    alpha = np.where(cool_white | blood, 1.0, alpha * 0.0)
    a_img = Image.fromarray((alpha * 255).astype(np.uint8), "L")
    a_img = a_img.filter(ImageFilter.MaxFilter(3))
    a_img = a_img.filter(ImageFilter.GaussianBlur(radius=0.8))
    rgba = np.dstack([rgb, np.array(a_img)])
    im = premultiply_safe(Image.fromarray(rgba, "RGBA"))
    im = crop_bbox(im, 4)
    if im.width < 200:
        return False
    im = upscale_long(im, 1600)
    im.save(dest, "PNG", optimize=True)
    print(f"logo-from-bg {im.size} -> {dest.name}")
    return True


def probe(path: Path) -> None:
    im = Image.open(path).convert("RGBA")
    a = np.array(im.split()[-1])
    w, h = im.size
    corners = [im.getpixel((0, 0)), im.getpixel((w - 1, 0)), im.getpixel((0, h - 1)), im.getpixel((w - 1, h - 1))]
    print(
        f"PROBE {path.name}: {w}x{h} mode={im.mode} "
        f"alpha[min={a.min()}, max={a.max()}, mean={a.mean():.1f}] "
        f"corners={corners}"
    )
    # composite on magenta + black for visual check
    PROBE.mkdir(parents=True, exist_ok=True)
    for name, color in [("black", (0, 0, 0, 255)), ("magenta", (255, 0, 255, 255))]:
        base = Image.new("RGBA", im.size, color)
        base.alpha_composite(im)
        base.convert("RGB").save(PROBE / f"{path.stem}_on_{name}.jpg", quality=90)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    process_day_marker(ASSETS / "tv-day-marker-v2.png", OUT / "day-marker.png")
    process_town_frame(ASSETS / "tv-town-frame-v2.png", OUT / "town-frame.png")
    process_ledger(ASSETS / "tv-ledger-panel-v2.png", OUT / "ledger-panel.png")
    process_vote(ASSETS / "tv-vote-chrome-v2.png", OUT / "vote-chrome.png")
    process_logo(ASSETS / "tv-logo-v2.png", OUT / "logo.png")

    # Prefer plate extractions when they succeed (higher fidelity to current art)
    extract_ledger_from_bg(OUT / "ledger-panel-from-bg.png")
    extract_logo_from_bg(OUT / "logo-from-bg.png")

    for p in sorted(OUT.glob("*.png")):
        probe(p)


if __name__ == "__main__":
    main()

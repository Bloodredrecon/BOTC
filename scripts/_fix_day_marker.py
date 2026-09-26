"""Regenerate a clean soft day-marker scrim (no checkerboard matte)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(r"C:\Users\danie\BOTC\web\public\tv\elements\day-marker.png")
W, H = 2200, 900


def ellipse_mask(size: tuple[int, int], cx: float, cy: float, rx: float, ry: float) -> np.ndarray:
    w, h = size
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    return np.clip(1.0 - (((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2), 0, 1)


def main() -> None:
    # Soft dark smoke plume — pure alpha, no tiled texture
    alpha = np.zeros((H, W), dtype=np.float32)
    blobs = [
        (0.50, 0.48, 0.46, 0.38, 1.00),
        (0.32, 0.52, 0.28, 0.30, 0.72),
        (0.68, 0.50, 0.30, 0.32, 0.70),
        (0.50, 0.62, 0.38, 0.22, 0.55),
        (0.50, 0.34, 0.34, 0.20, 0.50),
        (0.22, 0.45, 0.18, 0.22, 0.35),
        (0.78, 0.46, 0.18, 0.24, 0.35),
    ]
    for cx, cy, rx, ry, strength in blobs:
        m = ellipse_mask((W, H), cx * W, cy * H, rx * W, ry * H)
        alpha = np.maximum(alpha, m * strength)

    # Feather edges
    a_img = Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8), "L")
    a_img = a_img.filter(ImageFilter.GaussianBlur(radius=28))
    a_img = a_img.filter(ImageFilter.GaussianBlur(radius=18))
    alpha = np.array(a_img, dtype=np.float32) / 255.0
    # Soft falloff so edges dissolve cleanly
    alpha = np.power(alpha, 1.15) * 0.92

    # Near-black smoke RGB (no light matte)
    rgb = np.zeros((H, W, 3), dtype=np.float32)
    rgb[..., 0] = 8 + alpha * 18
    rgb[..., 1] = 4 + alpha * 10
    rgb[..., 2] = 6 + alpha * 12

    # Subtle red eye + bar ornament (center)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    cx, cy = W // 2, int(H * 0.42)
    blood = (180, 28, 32, 230)
    # horizontal hairline
    d.line([(cx - 280, cy), (cx - 70, cy)], fill=blood, width=3)
    d.line([(cx + 70, cy), (cx + 280, cy)], fill=blood, width=3)
    # circle + pupil
    d.ellipse([cx - 42, cy - 42, cx + 42, cy + 42], outline=blood, width=3)
    d.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], fill=blood)
    # small fletches
    for dx in (-220, -160, 160, 220):
        sign = -1 if dx < 0 else 1
        d.line([(cx + dx, cy), (cx + dx - sign * 18, cy - 10)], fill=blood, width=2)
        d.line([(cx + dx, cy), (cx + dx - sign * 18, cy + 10)], fill=blood, width=2)
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=0.6))

    base = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    im = Image.fromarray(base, "RGBA")
    im = Image.alpha_composite(im, overlay)

    # Crop empty margins
    a = np.array(im.split()[-1])
    ys, xs = np.where(a > 6)
    pad = 16
    x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + pad + 1)
    y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + pad + 1)
    im = im.crop((x0, y0, x1, y1))
    im.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} {im.size} mode={im.mode}")


if __name__ == "__main__":
    main()

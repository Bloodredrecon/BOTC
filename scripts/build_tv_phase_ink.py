"""Phase-word ink textures for /tv (hero DAY n / NIGHT n / GOOD WINS …).

Both files are *fill* layers drawn inside `background-clip: text` over an opaque
parchment gradient, so they only shift colour — they never cut holes in glyphs.
All noise is FFT-filtered white noise, which is periodic, so the tiles repeat seamlessly.

  phase-ink-tex.png  fine craquelure + mottle + grain (dark parchment tones, low alpha)
  phase-blood.png    dried-blood grime pooled toward the bottom edge (repeat-x)
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ELS = ROOT / "web" / "public" / "tv" / "elements"
rng = np.random.default_rng(3131)


def periodic_noise(h: int, w: int, lo: float, hi: float) -> np.ndarray:
    """Band-passed white noise (cycles per tile between lo and hi), normalised 0..1, seamless."""
    f = np.fft.fft2(rng.standard_normal((h, w)))
    fy = np.fft.fftfreq(h)[:, None] * h
    fx = np.fft.fftfreq(w)[None, :] * w * (h / w)
    r = np.sqrt(fx**2 + fy**2)
    band = np.exp(-((r / hi) ** 2))
    if lo > 0:
        band = band * (1 - np.exp(-((r / lo) ** 2)))
    n = np.real(np.fft.ifft2(f * band))
    return (n - n.min()) / (n.max() - n.min() + 1e-9)


def build_ink_tex() -> None:
    H, W = 512, 1024
    mottle = periodic_noise(H, W, 0, 6)
    # Craquelure: zero-crossings of two band-passed fields → thin connected crack network
    c1 = periodic_noise(H, W, 10, 22) - 0.5
    c2 = periodic_noise(H, W, 24, 48) - 0.5
    crack = np.clip(1 - np.abs(c1) / 0.018, 0, 1) * 0.8 + np.clip(1 - np.abs(c2) / 0.012, 0, 1) * 0.45
    crack *= np.clip((periodic_noise(H, W, 0, 5) - 0.25) / 0.35, 0, 1)  # patchy, not uniform
    grain = periodic_noise(H, W, 120, 260)

    alpha = np.clip(0.22 * np.clip((mottle - 0.45) / 0.4, 0, 1) + 0.58 * np.clip(crack, 0, 1) + 0.08 * grain, 0, 0.68)
    tone = 0.85 + 0.3 * mottle
    rgb = np.dstack([96 * tone, 64 * tone, 36 * tone])
    a = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.5))
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    img.putalpha(a)
    img.save(ELS / "phase-ink-tex.png", optimize=True)


def build_blood() -> None:
    H, W = 256, 1024
    y = np.linspace(0, 1, H)[:, None]
    # Cap glyphs sit in roughly the 0.12–0.80 band of the line box; grime builds up toward the baseline.
    ramp = np.clip((y - 0.3) / 0.45, 0, 1) ** 1.4
    blot = periodic_noise(H, W, 0, 7)
    fine = periodic_noise(H, W, 30, 80)
    body = np.clip((blot * 0.8 + fine * 0.2 + ramp * 0.6 - 0.8) / 0.16, 0, 1)
    speck = np.clip((periodic_noise(H, W, 60, 140) - 0.8) / 0.08, 0, 1) * np.clip((y - 0.25) / 0.5, 0, 1) * 0.5
    alpha = np.clip(body * (0.62 + 0.28 * blot) + speck * 0.45, 0, 0.88)
    tone = 0.75 + 0.35 * fine
    rgb = np.dstack([108 * tone, 15 * tone, 14 * tone])
    a = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.7))
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    img.putalpha(a)
    img.save(ELS / "phase-blood.png", optimize=True)


if __name__ == "__main__":
    build_ink_tex()
    build_blood()
    print("phase-ink-tex.png phase-blood.png")

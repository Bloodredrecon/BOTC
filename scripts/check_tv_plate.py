#!/usr/bin/env python3
"""Validate TV scene plates: 16:9 aspect, prefer 3840×2160.

Usage:
  python scripts/check_tv_plate.py <image> [...]
  python scripts/check_tv_plate.py   # all bg-* under web/public/tv/
"""

from __future__ import annotations

import sys
from pathlib import Path

TARGET_AR = 16 / 9
AR_TOL = 0.02
PREF_W, PREF_H = 3840, 2160
KNOWN_KEYS = ("night", "dawn", "day", "day2", "nomination", "gallows", "good-win", "evil-win")
REPO = Path(__file__).resolve().parents[1]
TV_DIR = REPO / "web" / "public" / "tv"


def discover_plates() -> list[Path]:
    if not TV_DIR.is_dir():
        return []
    found: list[Path] = []
    for key in KNOWN_KEYS:
        for path in sorted(TV_DIR.glob(f"bg-{key}.*")):
            if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                found.append(path)
                break
    return found


def main() -> int:
    paths = [Path(p) for p in sys.argv[1:]]
    if not paths:
        paths = discover_plates()
        if not paths:
            print(f"No plates found under {TV_DIR}", file=sys.stderr)
            return 2
        print(f"Checking {len(paths)} plate(s) in {TV_DIR.relative_to(REPO)}:")
    try:
        from PIL import Image
    except ImportError:
        print("Pillow required: pip install Pillow", file=sys.stderr)
        return 2

    ok = True
    present = {p.stem.removeprefix("bg-").lower() for p in paths}
    for raw in paths:
        path = Path(raw)
        if not path.is_file():
            print(f"FAIL  {path}: missing")
            ok = False
            continue
        with Image.open(path) as im:
            w, h = im.size
        ar = w / h if h else 0
        notes: list[str] = []
        if abs(ar - TARGET_AR) > AR_TOL:
            notes.append(f"aspect {ar:.4f} (want ~{TARGET_AR:.4f})")
            ok = False
        if (w, h) != (PREF_W, PREF_H):
            notes.append(f"size {w}×{h} (prefer {PREF_W}×{PREF_H})")
        status = "OK" if not any("aspect" in n for n in notes) else "FAIL"
        extra = f" — {'; '.join(notes)}" if notes else " — 16:9 4K"
        print(f"{status:4}  {path}{extra}")

    if not sys.argv[1:]:
        missing = [k for k in KNOWN_KEYS if k not in present]
        if missing:
            print(f"NOTE  missing optional keys: {', '.join(missing)}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

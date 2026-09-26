#!/usr/bin/env python3
"""Generate BOTC creepy-old-town ambiance mp3s via ElevenLabs Sound Effects API.

Writes into data/audio/ambiance/. Does not touch the narration pack in data/audio/.

Usage:
  python scripts/generate_ambiance.py
  python scripts/generate_ambiance.py --only amb_rain.mp3 amb_crow_1.mp3
  python scripts/generate_ambiance.py --force   # regenerate even if file exists
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "audio" / "ambiance"


@dataclass(frozen=True)
class AmbianceClip:
    filename: str
    kind: str  # "loop" | "sporadic"
    prompt: str
    duration: float
    default_volume: float
    min_gap_sec: float | None = None  # sporadic only
    loop_api: bool = False


# Curated Ravenswood Bluff / creepy old town pack — no modern city, no jump-scare
# risers, no intelligible speech.
CLIPS: list[AmbianceClip] = [
    # --- loops (seamless-ish beds) ---
    AmbianceClip(
        "amb_rain.mp3",
        "loop",
        "Soft continuous rain falling on wet cobblestone streets in a quiet medieval "
        "town at night, gentle steady rainfall on stone, distant soft patter, no thunder "
        "cracks, no sudden hits, seamless looping ambience, immersive atmospheric bed",
        28.0,
        0.35,
        loop_api=True,
    ),
    AmbianceClip(
        "amb_wind_shutters.mp3",
        "loop",
        "Clear cold wind howling through old wooden shutters and cracked window frames "
        "in a creepy medieval town at night, audible gusts, wood shutter rattle and "
        "creak in the breeze, continuous atmospheric draft bed, clearly audible mid "
        "volume, seamless loop, no sudden bangs or impacts",
        26.0,
        0.32,
        loop_api=True,
    ),
    AmbianceClip(
        "amb_fog_hum.mp3",
        "loop",
        "Deep low-frequency foggy stone drone hum of an old town shrouded in thick mist, "
        "clear sustained bass presence and soft rumble, Ravenswood Bluff night atmosphere, "
        "continuous audible loop bed at moderate volume, seamless, no melody no percussion",
        30.0,
        0.32,
        loop_api=True,
    ),
    AmbianceClip(
        "amb_clocktower_mechanism.mp3",
        "loop",
        "Slow heavy clocktower gears and wooden mechanism turning inside a stone tower, "
        "clear soft metallic tick-tock and gear whir, wooden cog grind, continuous "
        "mechanical ambience clearly audible at a distance, no loud bell chimes, "
        "seamless loop, creepy old town atmosphere",
        28.0,
        0.30,
        loop_api=True,
    ),
    AmbianceClip(
        "amb_candle_hiss.mp3",
        "loop",
        "Soft oil lamp and candle flame hiss and gentle flicker crackle in a quiet "
        "stone room, warm close intimate fire ambience, continuous soft hiss, "
        "seamless loop, no loud pops",
        22.0,
        0.25,
        loop_api=True,
    ),
    AmbianceClip(
        "amb_chapel_drone.mp3",
        "loop",
        "Barely-there residual low chapel organ drone lingering in empty stone church "
        "air, very soft distant sacred hum, continuous atmospheric bed, seamless loop, "
        "no melody, no choir, no loud notes",
        30.0,
        0.18,
        loop_api=True,
    ),
    AmbianceClip(
        "amb_well_drip.mp3",
        "loop",
        "Slow sparse water drips falling into a deep stone well, wet echo in a dark "
        "courtyard, quiet creepy old town night, continuous sparse drip ambience "
        "suitable for seamless looping, no splash impacts",
        24.0,
        0.22,
        loop_api=True,
    ),
    AmbianceClip(
        "amb_night_air.mp3",
        "loop",
        "Steady countryside night air around a sleeping medieval village, soft open "
        "space hush with gentle continuous breeze and sparse distant insects, calm "
        "creepy atmosphere, even level continuous seamless loop bed, no traffic, "
        "no modern sounds, no abrupt starts or stops",
        28.0,
        0.32,
        loop_api=True,
    ),
    # --- sporadic one-shots ---
    AmbianceClip(
        "amb_crow_1.mp3",
        "sporadic",
        "Single distant raven crow call over a quiet old town at night, one short "
        "natural corvid cry, dry air, no flock, no speech",
        2.2,
        0.40,
        min_gap_sec=45.0,
    ),
    AmbianceClip(
        "amb_crow_2.mp3",
        "sporadic",
        "Different take of a single raven call, slightly closer, short natural crow "
        "cry in misty old town night, one call only",
        2.0,
        0.40,
        min_gap_sec=45.0,
    ),
    AmbianceClip(
        "amb_crow_3.mp3",
        "sporadic",
        "Another variant single crow or raven croak, brief and lonely, far across "
        "cobbled streets, one call, atmospheric",
        2.4,
        0.38,
        min_gap_sec=45.0,
    ),
    AmbianceClip(
        "amb_creak_1.mp3",
        "sporadic",
        "Slow wooden shutter or floorboard creak in an old house, short subtle wood "
        "stress sound, creepy but quiet, no slam",
        2.0,
        0.32,
        min_gap_sec=35.0,
    ),
    AmbianceClip(
        "amb_creak_2.mp3",
        "sporadic",
        "Different wooden door frame or shutter creak, short soft wood groan, old "
        "town night interior, subtle",
        2.2,
        0.32,
        min_gap_sec=35.0,
    ),
    AmbianceClip(
        "amb_whisper_1.mp3",
        "sporadic",
        "Unintelligible human whisper fragment carried on wind, breathy murmur close "
        "enough to hear clearly but with no clear words or names, brief eerie snippet, "
        "audible mid-quiet volume, creepy old town night",
        2.5,
        0.35,
        min_gap_sec=60.0,
    ),
    AmbianceClip(
        "amb_whisper_2.mp3",
        "sporadic",
        "Another unintelligible whisper fragment, breathy hush with soft sibilance, "
        "no discernible speech or names, brief creepy atmosphere, clearly audible "
        "but not loud, distant courtyard night",
        2.8,
        0.34,
        min_gap_sec=60.0,
    ),
    AmbianceClip(
        "amb_shutter_slam.mp3",
        "sporadic",
        "One wooden shutter slamming shut in a gust of wind, short sharp wood impact "
        "then settle, old town night, single slam",
        1.8,
        0.35,
        min_gap_sec=50.0,
    ),
    AmbianceClip(
        "amb_footsteps_wet.mp3",
        "sporadic",
        "Brief wet stone cobblestone footsteps passing by once, few steps on rainy "
        "street then fade, creepy old town night, no voices",
        3.2,
        0.30,
        min_gap_sec=55.0,
    ),
    AmbianceClip(
        "amb_well_bucket.mp3",
        "sporadic",
        "Old wooden bucket and chain splash into a stone well, short metallic rattle "
        "and water splash, courtyard night, single event",
        2.6,
        0.34,
        min_gap_sec=70.0,
    ),
    AmbianceClip(
        "amb_church_door.mp3",
        "sporadic",
        "Heavy wooden church door closing slowly with a deep thud and soft latch, "
        "stone chapel interior resonance, single close, no voices",
        3.0,
        0.36,
        min_gap_sec=80.0,
    ),
    AmbianceClip(
        "amb_rats_skitter.mp3",
        "sporadic",
        "Short rats skittering inside old walls, brief claw scramble then silence, "
        "subtle creepy interior, no squeals loud",
        2.0,
        0.28,
        min_gap_sec=40.0,
    ),
    AmbianceClip(
        "amb_gallows_creak.mp3",
        "sporadic",
        "Subtle rope and wood stress creak of distant gallows in wind, quiet eerie "
        "strain, short and restrained, no dramatic stinger",
        2.4,
        0.24,
        min_gap_sec=75.0,
    ),
    AmbianceClip(
        "amb_half_chime.mp3",
        "sporadic",
        "Single soft distant half-chime from a far clocktower bell, one muted partial "
        "strike only, not a full peal, quiet old town night",
        3.5,
        0.26,
        min_gap_sec=90.0,
    ),
    AmbianceClip(
        "amb_owl_1.mp3",
        "sporadic",
        "One distant owl or night bird call over quiet countryside near an old town, "
        "single soft hoot, natural and sparse",
        2.5,
        0.34,
        min_gap_sec=50.0,
    ),
]


def windows_user_env(name: str) -> str | None:
    """Read a User-scoped env var on Windows (process env may not have it)."""
    if sys.platform != "win32":
        return None
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment") as key:
            val, _ = winreg.QueryValueEx(key, name)
            if isinstance(val, str) and val.strip():
                return val.strip()
    except OSError:
        pass
    # PowerShell fallback
    try:
        r = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                f"[Environment]::GetEnvironmentVariable('{name}','User')",
            ],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        val = (r.stdout or "").strip()
        return val or None
    except (OSError, subprocess.SubprocessError):
        return None


def api_key() -> str:
    key = (
        os.environ.get("BOTC_ELEVENLABS_API_KEY")
        or os.environ.get("ELEVENLABS_API_KEY")
        or windows_user_env("BOTC_ELEVENLABS_API_KEY")
        or windows_user_env("ELEVENLABS_API_KEY")
    )
    if not key:
        raise SystemExit("BOTC_ELEVENLABS_API_KEY not set (User env or process)")
    return key


def http_post_json(url: str, payload: dict, headers: dict, out_path: Path, retries: int = 2) -> None:
    """POST JSON; write raw audio bytes. Retries once on transient errors (default)."""
    data = json.dumps(payload).encode("utf-8")
    last_err: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                out_path.write_bytes(resp.read())
            if out_path.stat().st_size < 200:
                body_preview = out_path.read_text(errors="replace")[:300]
                raise RuntimeError(f"tiny response for {out_path.name}: {body_preview}")
            return
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            last_err = RuntimeError(f"HTTP {e.code} {url}: {body[:500]}")
            if e.code in (429, 500, 502, 503) and attempt < retries - 1:
                wait = 2 ** attempt + 1
                print(f"  retry {attempt + 1} after HTTP {e.code} ({wait}s)", flush=True)
                time.sleep(wait)
                continue
            raise last_err from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = e
            if attempt < retries - 1:
                wait = 2 ** attempt + 1
                print(f"  retry {attempt + 1} after {type(e).__name__}: {e} ({wait}s)", flush=True)
                time.sleep(wait)
                continue
            raise
    if last_err:
        raise last_err


def generate_sfx(clip: AmbianceClip, out: Path, key: str) -> None:
    # ElevenLabs sound-generation accepts up to ~30s; clamp accordingly.
    duration = max(0.5, min(30.0, clip.duration))
    payload: dict = {
        "text": clip.prompt,
        "duration_seconds": duration,
        "prompt_influence": 0.45,
        "model_id": "eleven_text_to_sound_v2",
    }
    if clip.loop_api:
        payload["loop"] = True
    url = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128"
    http_post_json(
        url,
        payload,
        {"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        out,
    )


def _ffprobe_duration(path: Path) -> float:
    r = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        return float((r.stdout or "").strip())
    except ValueError:
        return 0.0


def postprocess_clip(clip: AmbianceClip, path: Path) -> None:
    """Normalize loudness; for loops, soft-edge fade so client crossfade is seamless."""
    if not path.exists() or path.stat().st_size < 200:
        return
    tmp = path.with_name(path.stem + ".post.mp3")
    # Target integrated loudness: loops a bit quieter than one-shots.
    target_i = -22 if clip.kind == "loop" else -18
    af_parts = [f"loudnorm=I={target_i}:TP=-1.5:LRA=11"]

    if clip.kind == "loop":
        dur = _ffprobe_duration(path)
        fade = 1.5
        if dur > fade * 3:
            # Soften start/end so dual-element client crossfade has no click.
            st_out = max(0.0, dur - fade)
            af_parts.append(f"afade=t=in:st=0:d={fade}")
            af_parts.append(f"afade=t=out:st={st_out:.3f}:d={fade}")

    af = ",".join(af_parts)
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-af",
        af,
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        str(tmp),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if r.returncode != 0 or not tmp.exists() or tmp.stat().st_size < 200:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        print(f"  postprocess skip ({r.stderr[:200] if r.stderr else 'ffmpeg fail'})", flush=True)
        return
    tmp.replace(path)


def process_existing_loop(path: Path, fade: float = 1.5) -> bool:
    """Re-loudnorm + edge-fade an existing loop mp3 (no API call)."""
    if not path.exists():
        return False
    dur = _ffprobe_duration(path)
    tmp = path.with_name(path.stem + ".post.mp3")
    af_parts = ["loudnorm=I=-22:TP=-1.5:LRA=11"]
    if dur > fade * 3:
        st_out = max(0.0, dur - fade)
        af_parts.append(f"afade=t=in:st=0:d={fade}")
        af_parts.append(f"afade=t=out:st={st_out:.3f}:d={fade}")
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-af",
        ",".join(af_parts),
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        str(tmp),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if r.returncode != 0 or not tmp.exists() or tmp.stat().st_size < 200:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        return False
    tmp.replace(path)
    return True


def write_readme(clips: list[AmbianceClip]) -> None:
    lines = [
        "# BOTC ambiance pack",
        "",
        "Creepy old-town / Ravenswood Bluff beds and one-shots for the Storyteller **Ambiance** tab.",
        "Served at `/custom-audio/ambiance/<file>`.",
        "",
        "| File | Kind | Default volume | Min gap (sporadic) |",
        "|------|------|----------------|--------------------|",
    ]
    for c in clips:
        gap = f"{int(c.min_gap_sec)}s" if c.min_gap_sec is not None else "—"
        lines.append(
            f"| `{c.filename}` | {c.kind} | {int(round(c.default_volume * 100))}% | {gap} |"
        )
    lines.extend(
        [
            "",
            "## Notes",
            "",
            "- **loop** — toggleable continuous beds (browser loops the mp3).",
            "- **sporadic** — when enabled, TV plays infrequently with random gaps ≥ min gap.",
            "- Regenerate: `python scripts/generate_ambiance.py` (use `--force` to overwrite).",
            "",
        ]
    )
    (OUT_DIR / "README.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate BOTC ambiance SFX pack")
    ap.add_argument("--force", action="store_true", help="Overwrite existing mp3s")
    ap.add_argument("--only", nargs="+", help="Only these filenames")
    ap.add_argument("--dry-run", action="store_true", help="List clips; do not call API")
    ap.add_argument(
        "--process-loops-only",
        action="store_true",
        help="Re-loudnorm + edge-fade existing loop mp3s (no API)",
    )
    args = ap.parse_args()

    only = {n.lower() for n in args.only} if args.only else None
    clips = [c for c in CLIPS if only is None or c.filename.lower() in only]
    if only:
        missing = only - {c.filename.lower() for c in clips}
        if missing:
            print(f"Unknown filenames: {sorted(missing)}", file=sys.stderr)
            return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_readme(CLIPS)

    if args.dry_run:
        for c in clips:
            print(f"{c.filename}\t{c.kind}\t{c.duration}s\tvol={c.default_volume}")
        print(f"{len(clips)} clips -> {OUT_DIR}")
        return 0

    if args.process_loops_only:
        n_ok = 0
        for clip in clips:
            if clip.kind != "loop":
                continue
            path = OUT_DIR / clip.filename
            print(f"process {clip.filename}…", flush=True)
            if process_existing_loop(path):
                print(f"  ok {path.stat().st_size} bytes", flush=True)
                n_ok += 1
            else:
                print(f"  FAIL {clip.filename}", flush=True)
        print(f"Processed {n_ok} loops", flush=True)
        return 0 if n_ok else 1

    key = api_key()
    ok = 0
    failed: list[tuple[str, str]] = []

    for i, clip in enumerate(clips, 1):
        out = OUT_DIR / clip.filename
        if out.exists() and out.stat().st_size > 500 and not args.force:
            print(f"[{i}/{len(clips)}] skip {clip.filename} (exists)", flush=True)
            ok += 1
            continue
        print(f"[{i}/{len(clips)}] gen {clip.filename} ({clip.kind}, {clip.duration}s)…", flush=True)
        tmp = out.with_suffix(".mp3.part")
        try:
            generate_sfx(clip, tmp, key)
            tmp.replace(out)
            postprocess_clip(clip, out)
            size = out.stat().st_size
            print(f"  ok {size} bytes", flush=True)
            ok += 1
            time.sleep(0.4)  # gentle rate limit
        except Exception as e:
            if tmp.exists():
                tmp.unlink(missing_ok=True)
            msg = str(e)
            print(f"  FAIL {clip.filename}: {msg}", flush=True)
            failed.append((clip.filename, msg))

    print(f"\nDone: {ok}/{len(clips)} ok, {len(failed)} failed -> {OUT_DIR}", flush=True)
    for name, msg in failed:
        print(f"  - {name}: {msg}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

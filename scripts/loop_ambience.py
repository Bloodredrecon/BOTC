#!/usr/bin/env python3
"""Generate gapless looping ambience beds for BOTC (preview only).

Writes data/audio/_voice_design/ambiance/. Does not touch live data/audio/*.mp3.

  python scripts/loop_ambience.py              # generate missing beds, loop, verify, update audition
  python scripts/loop_ambience.py --only day_square
  python scripts/loop_ambience.py --loop-only  # re-crossfade existing raw files (no API)

Gapless loop filter (C = crossfade seconds, D = source duration):
  [0]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,asplit=2[s1][s2];
  [s1]atrim=0:D-C,asetpts=PTS-STARTPTS[body];
  [s2]atrim=start=D-C,asetpts=PTS-STARTPTS[tail];
  [tail][body]acrossfade=d=C:c1=tri:c2=tri,loudnorm=I=-20:TP=-1.5:LRA=11[out]
Result length is D-C. The original tail is crossfaded onto the original head, then the
raw tail is discarded so the file ends where that wrap began.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate_narration as gn  # noqa: E402

DESIGN = gn.OUT_DIR / "_voice_design"
AMB_DIR = DESIGN / "ambiance"
RAW_DIR = AMB_DIR / "_raw"
GEN_SECONDS = 18.0
CROSSFADES = (2.0, 2.5, 3.0)
LOUDNORM = "loudnorm=I=-20:TP=-1.5:LRA=11"
LOOP_FILTER_DOC = (
    "decode to 44100 stereo wav; "
    "[0]asplit=2[s1][s2]; "
    "[s1]atrim=start=0:end=D-C,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=C[main]; "
    "[s2]atrim=start=D-C:end=D,asetpts=PTS-STARTPTS,afade=t=out:st=0:d=C[tail]; "
    "[main][tail]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,"
    + LOUDNORM + "[out]. "
    "acrossfade produced no frames on ffmpeg 7.1.1 with asplit, so this is adelay-free "
    "equal-power wrap: original tail fades out over the faded-in head, then tail is trimmed."
)


@dataclass(frozen=True)
class Bed:
    key: str
    title: str
    prompt: str


BEDS: list[Bed] = [
    Bed(
        "day_square",
        "Day square",
        "Seamless looping ambience bed, no voice, no melody, no sudden events, consistent "
        "loudness from start to end. Distant crowd murmur in a gothic medieval town square "
        "on a grey Halloween afternoon, cobblestone footsteps blended into a continuous "
        "texture, light wind, far ravens as a steady sparse texture not a single cry. "
        "Ravenswood Bluff Blood on the Clocktower atmosphere. Continuous only, no door slam, "
        "no bell, no scream, no one-shot.",
    ),
    Bed(
        "night_square",
        "Night square",
        "Seamless looping ambience, no voice, no melody, no sudden events, even loudness. "
        "Clearly audible moderate-volume gothic town square at night: present wind, continuous "
        "wood creak, sparse distant owl and raven texture not a single hoot, low unease. "
        "Not silent. Ravenswood Bluff. No slam, no chime, no scream.",
    ),
    Bed(
        "dawn_mist",
        "Dawn mist",
        "Seamless looping ambience bed, no voice, no melody, no sudden events, consistent "
        "loudness from start to end. Pre-dawn mist over a damp medieval square, soft far-off "
        "songbirds as a continuous distant bed not a rooster crow, wet air, light wind, "
        "quiet cobbles. Gothic Halloween Ravenswood Bluff. Continuous texture only, no cock "
        "crow, no bell, no one-shot.",
    ),
    Bed(
        "rain_stone",
        "Rain on stone",
        "Seamless looping ambience bed, no voice, no melody, no sudden events, consistent "
        "loudness from start to end. Steady rain on cobblestone and wooden shutters in an "
        "old town, even rainfall with no thunder clap, no drip solo, no gust slam. Gothic "
        "Halloween Ravenswood Bluff Blood on the Clocktower. Continuous rain texture only.",
    ),
    Bed(
        "clocktower",
        "Clocktower interior",
        "Seamless looping ambience bed, no voice, no melody, no sudden events, consistent "
        "loudness from start to end. Interior of an old stone clocktower: low wood and stone "
        "resonance, faint ticking and slow gear texture that can loop, distant air. No hourly "
        "chime, no bell strike, no clunk one-shot. Gothic Blood on the Clocktower atmosphere.",
    ),
    Bed(
        "dusk_tension",
        "Dusk nominations",
        "Seamless looping ambience bed, no voice, no melody, no sudden events, consistent "
        "loudness from start to end. Dusk tension in a town square before nominations: low "
        "dark drone under a hushed square, held breath crowd texture, continuous unease, "
        "even level. Gothic Halloween Ravenswood Bluff. No stinger, no drum hit, no chime.",
    ),
    Bed(
        "candlelit",
        "Candlelit interior",
        "Seamless looping ambience bed, no voice, no melody, no sudden events, consistent "
        "loudness from start to end. Quiet candlelit stone room hush: soft flame hiss, faint "
        "wood settle as continuous texture, warm close interior air. Gothic Halloween "
        "storyteller chamber. No loud pop, no door, no one-shot crackle.",
    ),
    Bed(
        "graveyard",
        "Graveyard wind",
        "Seamless looping ambience bed, no voice, no melody, no sudden events, consistent "
        "loudness from start to end. Graveyard wind through yew and old iron, dry leaves as "
        "a continuous rustle, distant low air, cold stone. Gothic Ravenswood Bluff churchyard. "
        "No crow one-shot, no gate slam, no scream, no bell.",
    ),
]


def run_ffmpeg(args: list[str], label: str) -> subprocess.CompletedProcess:
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "")[-800:]
        raise RuntimeError(f"ffmpeg {label} failed:\n{err}")
    return r


def mean_db(path: Path, start: float, dur: float) -> float | None:
    r = subprocess.run(
        [
            gn.FFMPEG, "-hide_banner", "-i", str(path),
            "-af", f"atrim={start:.4f}:{start + dur:.4f},volumedetect",
            "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
    )
    m = re.search(r"mean_volume:\s*(-?[\d.]+)", r.stderr)
    return float(m.group(1)) if m else None


def peak_db(path: Path, start: float, dur: float) -> float | None:
    r = subprocess.run(
        [
            gn.FFMPEG, "-hide_banner", "-i", str(path),
            "-af", f"atrim={start:.4f}:{start + dur:.4f},volumedetect",
            "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
    )
    m = re.search(r"max_volume:\s*(-?[\d.]+)", r.stderr)
    return float(m.group(1)) if m else None


def decode_wav(src: Path, dest: Path) -> float:
    run_ffmpeg(
        [
            gn.FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(src), "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", str(dest),
        ],
        "decode-wav",
    )
    return gn.duration(dest)


def make_gapless_loop(src: Path, dest: Path, crossfade: float) -> float:
    """Wrap the last C seconds onto the first C seconds so the file loops without a click.

    Result length is D-C. WAV decode avoids mp3 priming issues. ffmpeg 7.1.1 acrossfade
    emitted no frames with asplit, so this uses afade+amix (same idea as adelay+amix).
    """
    wav = dest.with_suffix(".src.wav")
    d = decode_wav(src, wav)
    if d < crossfade * 2 + 4:
        wav.unlink(missing_ok=True)
        raise RuntimeError(f"{src.name} too short for {crossfade}s crossfade ({d:.2f}s)")
    body_end = d - crossfade
    filt = (
        f"[0]asplit=2[s1][s2];"
        f"[s1]atrim=start=0:end={body_end:.4f},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d={crossfade:.4f}[main];"
        f"[s2]atrim=start={body_end:.4f}:end={d:.4f},asetpts=PTS-STARTPTS,"
        f"afade=t=out:st=0:d={crossfade:.4f}[tail];"
        f"[main][tail]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,"
        f"{LOUDNORM}[out]"
    )
    tmp = dest.with_suffix(".tmp.mp3")
    try:
        run_ffmpeg(
            [
                gn.FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(wav), "-filter_complex", filt, "-map", "[out]",
                "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k",
                str(tmp),
            ],
            "gapless-amix",
        )
        if not tmp.exists() or tmp.stat().st_size < 4000:
            raise RuntimeError(f"loop mix wrote tiny file ({tmp.stat().st_size if tmp.exists() else 0} bytes)")
        tmp.replace(dest)
    finally:
        wav.unlink(missing_ok=True)
        if tmp.exists():
            tmp.unlink(missing_ok=True)
    return gn.duration(dest)


def write_doubled(src: Path, dest: Path) -> None:
    run_ffmpeg(
        [
            gn.FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(src), "-filter_complex",
            "[0]asplit=2[a][b];[a][b]concat=n=2:v=0:a=1[out]",
            "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "128k", str(dest),
        ],
        "concat-double",
    )


def verify_seam(path: Path) -> dict:
    """Listen-free seam check on a looped file (join = duration of one copy)."""
    d = gn.duration(path)
    doubled = path.with_suffix(".double.mp3")
    write_doubled(path, doubled)
    try:
        start_rms = mean_db(path, 0.0, 0.2)
        end_rms = mean_db(path, max(0.0, d - 0.2), 0.2)
        rms_delta = None
        if start_rms is not None and end_rms is not None:
            rms_delta = abs(start_rms - end_rms)
        near_a = peak_db(doubled, max(0.0, d - 0.35), 0.25)
        join_pk = peak_db(doubled, max(0.0, d - 0.08), 0.16)
        near_b = peak_db(doubled, d + 0.10, 0.25)
        nearby = [x for x in (near_a, near_b) if x is not None]
        join_spike = None
        if join_pk is not None and nearby:
            join_spike = join_pk - (sum(nearby) / len(nearby))
        hf = subprocess.run(
            [
                gn.FFMPEG, "-hide_banner", "-i", str(doubled),
                "-af", f"highpass=f=2000,atrim={d - 0.04:.4f}:{d + 0.04:.4f},volumedetect",
                "-f", "null", "-",
            ],
            capture_output=True,
            text=True,
        )
        hf_m = re.search(r"max_volume:\s*(-?[\d.]+)", hf.stderr)
        hf_peak = float(hf_m.group(1)) if hf_m else None
        sil = subprocess.run(
            [
                gn.FFMPEG, "-hide_banner", "-i", str(doubled),
                "-af", "silencedetect=noise=-40dB:d=0.08", "-f", "null", "-",
            ],
            capture_output=True,
            text=True,
        )
        gap_at_join = False
        for line in sil.stderr.splitlines():
            if "silence_start:" in line:
                t = float(line.split("silence_start:")[1].split()[0])
                if abs(t - d) < 0.12:
                    gap_at_join = True
        whole_peak = peak_db(path, 0.0, d)
        whole_mean = mean_db(path, 0.0, d)
        crest = None
        if whole_peak is not None and whole_mean is not None:
            crest = round(whole_peak - whole_mean, 2)
        ok = (
            (rms_delta is None or rms_delta <= 4.0)
            and (join_spike is None or join_spike <= 6.0)
            and not gap_at_join
            and (hf_peak is None or hf_peak < -12.0)
        )
        return {
            "duration_secs": round(d, 3),
            "start_rms_db": start_rms,
            "end_rms_db": end_rms,
            "rms_delta_db": None if rms_delta is None else round(rms_delta, 2),
            "join_spike_db": None if join_spike is None else round(join_spike, 2),
            "hf_join_peak_db": hf_peak,
            "gap_at_join": gap_at_join,
            "crest_db": crest,
            "ok": ok,
        }
    finally:
        doubled.unlink(missing_ok=True)


def character_count() -> int:
    import urllib.request

    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/user/subscription",
        headers={"xi-api-key": gn.api_key()},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(json.loads(r.read().decode("utf-8")).get("character_count") or 0)


def sfx_usage_total() -> float:
    """Sum eleven_text_to_sound_v2 usage over the last 2 days (credits; lags less than character_count)."""
    import time
    import urllib.parse
    import urllib.request

    now = int(time.time() * 1000)
    q = urllib.parse.urlencode({
        "start_unix": now - 2 * 86400000,
        "end_unix": now,
        "breakdown_type": "model",
        "aggregation_interval": "hour",
    })
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/usage/character-stats?" + q,
        headers={"xi-api-key": gn.api_key()},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read().decode("utf-8"))
    vals = d.get("usage", {}).get("eleven_text_to_sound_v2") or []
    return float(sum(vals))


def generate_raw(bed: Bed, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    gn.sfx(bed.prompt, dest, GEN_SECONDS, True, gn.api_key())


def loop_and_verify(bed: Bed) -> dict:
    raw = RAW_DIR / f"{bed.key}.mp3"
    out = AMB_DIR / f"{bed.key}.mp3"
    last_check: dict = {}
    for c in CROSSFADES:
        make_gapless_loop(raw, out, c)
        last_check = verify_seam(out)
        last_check["crossfade_s"] = c
        last_check["filter"] = LOOP_FILTER_DOC
        if last_check["ok"]:
            return last_check
        print(f"  seam not clean at C={c}s: {json.dumps({k: last_check[k] for k in ('rms_delta_db', 'join_spike_db', 'gap_at_join', 'hf_join_peak_db', 'crest_db')})}")
    return last_check


def update_audition(results: list[dict]) -> None:
    manifest_path = DESIGN / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    entries = []
    for row in results:
        entries.append(
            {
                "file": f"ambiance/{row['key']}.mp3",
                "model": "ambiance_loops",
                "generated_voice_id": "sfx",
                "duration_secs": row.get("duration_secs"),
                "title": row["title"],
                "note": (
                    f"loop {row.get('duration_secs', 0):.1f}s | "
                    f"crossfade {row.get('crossfade_s')}s | "
                    f"start/end RMS {row.get('start_rms_db')}/{row.get('end_rms_db')} dB | "
                    f"join spike {row.get('join_spike_db')} dB"
                    + ("" if row.get("ok") else " | SEAM FAIL")
                ),
                "text": row["prompt"],
                "loop": True,
            }
        )
    manifest["previews"] = [
        p for p in manifest["previews"] if p.get("model") != "ambiance_loops"
    ] + entries
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=True), encoding="utf-8")
    html_path = DESIGN / "index.html"
    html = html_path.read_text(encoding="utf-8")
    if '"ambiance_loops"' not in html:
        html = html.replace(
            '"round5_design": "Round 5 · Voice Design previews (sample line)",',
            '"round5_design": "Round 5 · Voice Design previews (sample line)",\n'
            '    "ambiance_loops": "Looping ambience beds (player loops — listen for a seam)",',
        )
        html = html.replace(
            'const order = ["round5_first_night"',
            'const order = ["ambiance_loops", "round5_first_night"',
        )
    if "p.loop" not in html:
        html = html.replace(
            '<audio controls preload="metadata" src="${p.file}"></audio>',
            '<audio controls preload="metadata"${p.loop ? " loop" : ""} src="${p.file}"></audio>',
        )
    html_path.write_text(html, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate gapless looping ambience beds (preview)")
    ap.add_argument("--only", nargs="+", help="Bed keys to generate")
    ap.add_argument("--loop-only", action="store_true", help="Re-loop existing raw files; no API")
    ap.add_argument("--skip-audition", action="store_true")
    args = ap.parse_args()

    gn.FFMPEG, gn.FFPROBE = gn.find_ffmpeg()
    AMB_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    beds = BEDS
    if args.only:
        want = set(args.only)
        beds = [b for b in BEDS if b.key in want]
        missing = want - {b.key for b in beds}
        if missing:
            raise SystemExit(f"unknown keys: {sorted(missing)}")

    report_path = AMB_DIR / "report.json"
    prior = {}
    if report_path.exists():
        prior = {r["key"]: r for r in json.loads(report_path.read_text(encoding="utf-8-sig")).get("beds", [])}

    results: list[dict] = []
    for i, bed in enumerate(beds, 1):
        raw = RAW_DIR / f"{bed.key}.mp3"
        print(f"[{i}/{len(beds)}] {bed.key}", flush=True)
        spent = None
        regenerated = False
        if not args.loop_only:
            if not raw.exists() or raw.stat().st_size < 500:
                before = sfx_usage_total()
                generate_raw(bed, raw)
                time.sleep(3)
                after = sfx_usage_total()
                spent = after - before
                print(f"  generated {raw.stat().st_size} bytes  credits~{spent}  sfx_usage {before}->{after}", flush=True)
                if i == 1 and spent > 400:
                    print("STOP: first bed cost >400 credits", flush=True)
                    row = {"key": bed.key, "title": bed.title, "prompt": bed.prompt, "credits": spent, "ok": False, "stop": "cost"}
                    results.append(row)
                    break
        check = loop_and_verify(bed)
        if not check.get("ok") and not args.loop_only:
            print("  regenerating once (seam/oneshot)", flush=True)
            before = sfx_usage_total()
            generate_raw(bed, raw)
            time.sleep(3)
            after = sfx_usage_total()
            extra = after - before
            spent = (spent or 0) + extra
            regenerated = True
            check = loop_and_verify(bed)
            print(f"  regen credits~{extra}", flush=True)
        row = {
            "key": bed.key,
            "title": bed.title,
            "prompt": bed.prompt,
            "path": f"data/audio/_voice_design/ambiance/{bed.key}.mp3",
            "credits": spent if spent is not None else prior.get(bed.key, {}).get("credits"),
            "regenerated": regenerated,
            **check,
        }
        results.append(row)
        print(
            f"  loop {check.get('duration_secs')}s C={check.get('crossfade_s')} "
            f"rms_d={check.get('rms_delta_db')} join={check.get('join_spike_db')} ok={check.get('ok')}",
            flush=True,
        )

    by = dict(prior)
    for r in results:
        by[r["key"]] = r
    merged = [by[b.key] for b in BEDS if b.key in by]
    payload = {"filter": LOOP_FILTER_DOC, "gen_seconds": GEN_SECONDS, "beds": merged}
    report_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
    if not args.skip_audition and merged:
        update_audition(merged)
        print("audition updated", flush=True)
    print(json.dumps({"ok": sum(1 for r in results if r.get("ok")), "n": len(results),
                      "credits": [r.get("credits") for r in results]}, indent=2))
    return 0 if results and all(r.get("ok") for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())

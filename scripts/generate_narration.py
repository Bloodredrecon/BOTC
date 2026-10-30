#!/usr/bin/env python3
"""Generate BOTC narration mp3s (TTS + SFX layered) from docs/NARRATION_SCRIPT.md."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "docs" / "NARRATION_SCRIPT.md"
OUT_DIR = ROOT / "data" / "audio"
WORK = OUT_DIR / "_batch_build"
VOICE_ID = os.environ.get("BOTC_TTS_VOICE", "bGaEqnGM5jPt52TO9tMX")
TTS_MODEL = os.environ.get("BOTC_TTS_MODEL", "eleven_multilingual_v2")
PREVIEW_DIR = OUT_DIR / "_voice_design" / "preview"
PREVIEW_TAG = os.environ.get("BOTC_PREVIEW_TAG") or TTS_MODEL
PREVIEW_TEXT = os.environ.get("BOTC_PREVIEW_TEXT")  # JSON file: {"cue.mp3": "spoken text"}
SETTING_ENV = {
    "stability": "BOTC_TTS_STABILITY",
    "similarity_boost": "BOTC_TTS_SIMILARITY",
    "style": "BOTC_TTS_STYLE",
    "speed": "BOTC_TTS_SPEED",
}
TEMPO = float(os.environ.get("BOTC_TTS_TEMPO") or 1.0)  # v4 ignores speed; stretch the voice stem instead
NO_WHISPER = os.environ.get("BOTC_NO_WHISPER") == "1"
FFMPEG = None
FFPROBE = None

SKIP = {"intro.mp3"}  # skip in full batch unless --force / explicit cue
CREDIT_CAP = int(os.environ.get("BOTC_CREDIT_CAP") or "8000")


class QuotaExceeded(RuntimeError):
    pass
# rules_full / rules_quick are stitched from modular rules_* at the end (no TTS)
STITCH_RULES_FULL = True
RULES_STITCHES = {
    "rules_full.mp3": [
        "rules_overview.mp3",
        "rules_teams.mp3",
        "rules_setup.mp3",
        "rules_night.mp3",
        "rules_day.mp3",
        "rules_execution.mp3",
        "rules_death.mp3",
        "rules_abilities.mp3",
        "rules_win.mp3",
        "rules_travellers.mp3",
        "rules_etiquette.mp3",
    ],
    # ~8 min: no Abilities (the character sheet covers it) and no Travellers (play it when one arrives)
    "rules_quick.mp3": [
        "rules_overview.mp3",
        "rules_teams.mp3",
        "rules_setup.mp3",
        "rules_night.mp3",
        "rules_day.mp3",
        "rules_execution.mp3",
        "rules_death.mp3",
        "rules_win.mp3",
        "rules_etiquette.mp3",
    ],
}

# Default layer gains (relative; final loudnorm still applied)
VOICE_VOL = 1.22  # was 1.05 — keep narration clear over beds
AMB_VOL = 0.14  # default bed under voice (non-intro)
INTRO_AMB_VOL = 0.08  # intro rain only — was 0.14 (still masked voice); keep scream/SFX untouched
SFX_VOL_PRIMARY = 0.42  # was 0.58 — stings sat level with the v4 voice
SFX_VOL_SECONDARY = 0.36  # was 0.50
DUCK = "threshold=0.04:ratio=5:attack=20:release=400"  # sidechaincompress: bed + SFX dip under the voice


@dataclass
class SfxSpec:
    text: str
    duration: float
    # Optional placement / level overrides from script tags
    after_pause: int | None = None  # 1-based index of long mid-voice pause
    delay_extra: float = 0.0  # seconds added after pause (or absolute @ time)
    at_sec: float | None = None  # absolute delay from mix start (overrides pause)
    volume: float | None = None


@dataclass
class Cue:
    filename: str
    spoken: str = ""
    ambiences: list[tuple[str, float, bool]] = field(default_factory=list)  # text, dur, loop
    sfx: list[SfxSpec] = field(default_factory=list)
    whisper: bool = False
    # Mix modes from [Mix: …] tags: "", "no-sfx", "voice-only", "quiet-sfx"
    mix_mode: str = ""


def find_ffmpeg() -> tuple[str, str]:
    which = subprocess.run(["where", "ffmpeg"], capture_output=True, text=True, shell=True)
    ff = which.stdout.strip().splitlines()[0] if which.returncode == 0 else None
    if not ff:
        winget = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/WinGet/Packages"
        hits = list(winget.glob("**/ffmpeg.exe")) if winget.exists() else []
        if hits:
            ff = str(hits[0])
    if not ff:
        raise SystemExit("ffmpeg not found")
    fp = str(Path(ff).with_name("ffprobe.exe"))
    return ff, fp


def windows_user_env(name: str) -> str | None:
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
        raise SystemExit("BOTC_ELEVENLABS_API_KEY not set")
    return key


def http_post_json(url: str, payload: dict, headers: dict, out_path: Path, retries: int = 4) -> None:
    data = json.dumps(payload).encode("utf-8")
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                out_path.write_bytes(resp.read())
            if out_path.stat().st_size < 200:
                raise RuntimeError(f"tiny response for {out_path.name}: {out_path.read_text(errors='replace')[:300]}")
            return
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if "quota_exceeded" in body.lower():
                raise QuotaExceeded(body[:500]) from e
            if e.code in (429, 500, 502, 503) and attempt < retries - 1:
                wait = 2 ** attempt + 1
                print(f"  retry {attempt+1} after HTTP {e.code} ({wait}s)")
                time.sleep(wait)
                continue
            raise RuntimeError(f"HTTP {e.code} {url}: {body[:500]}") from e


def subscription(key: str) -> dict:
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/user/subscription",
        headers={"xi-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def tts(text: str, out: Path, whisper: bool, key: str) -> None:
    settings = (
        {"stability": 0.7, "similarity_boost": 0.85}
        if whisper and not NO_WHISPER
        else {"stability": 0.45, "similarity_boost": 0.75}
    )
    for name, env in SETTING_ENV.items():
        if os.environ.get(env):
            settings[name] = float(os.environ[env])
    if TTS_MODEL.startswith(("eleven_v3", "eleven_v4")):
        # v3/v4 shrink SSML breaks to ~0.6s; audio tags keep the pause length
        text = re.sub(
            r'<break time="([\d.]+)s"\s*/>',
            lambda m: "[long pause]" if float(m.group(1)) >= 1.0 else "[pause]",
            text,
        )
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}?output_format=mp3_44100_128"
    http_post_json(
        url,
        {"text": text, "model_id": TTS_MODEL, "voice_settings": settings},
        {"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        out,
    )
    if TEMPO != 1.0:
        apply_tempo(out, TEMPO)


def apply_tempo(path: Path, tempo: float) -> None:
    """Pitch-preserving time-stretch of a voice stem, in place."""
    tmp = path.with_name(path.stem + ".tempo.mp3")
    r = subprocess.run(
        [FFMPEG, "-y", "-i", str(path), "-af", f"atempo={tempo}", "-c:a", "libmp3lame", "-b:a", "192k", str(tmp)],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(f"atempo failed for {path.name}:\n{r.stderr[-500:]}")
    tmp.replace(path)


def sfx(text: str, out: Path, duration: float, loop: bool, key: str) -> None:
    payload = {
        "text": text,
        "duration_seconds": max(0.5, min(30.0, duration)),
        "prompt_influence": 0.5,
        "model_id": "eleven_text_to_sound_v2",
    }
    if loop:
        payload["loop"] = True
    url = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128"
    http_post_json(url, payload, {"xi-api-key": key, "Content-Type": "application/json"}, out)


def duration(path: Path) -> float:
    r = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(r.stdout.strip())


def long_voice_pauses(voice_path: Path, min_dur: float = 0.9, after: float = 4.0) -> list[float]:
    """Return silence_start times for mid-voice pauses (speech already begun)."""
    r = subprocess.run(
        [
            FFMPEG,
            "-i",
            str(voice_path),
            "-af",
            "silencedetect=noise=-35dB:d=0.4",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    starts: list[float] = []
    ends: list[float] = []
    for line in (r.stderr or "").splitlines():
        if "silence_start:" in line:
            try:
                starts.append(float(line.split("silence_start:")[1].strip().split()[0]))
            except (IndexError, ValueError):
                pass
        elif "silence_end:" in line:
            try:
                # "silence_end: 1.5 | silence_duration: 1.5"
                part = line.split("silence_end:")[1].strip()
                ends.append(float(part.split("|")[0].strip()))
            except (IndexError, ValueError):
                pass
    pauses: list[float] = []
    for i, start in enumerate(starts):
        if start < after:
            continue
        dur = None
        if i < len(ends):
            dur = ends[i] - start
        # Also parse duration from silence_end line when available via starts pairing
        if dur is None or dur >= min_dur:
            # Re-parse durations from stderr more carefully
            pauses.append(start)
    # Prefer pairing with duration from silence_end lines
    paired: list[tuple[float, float]] = []
    for line in (r.stderr or "").splitlines():
        if "silence_duration:" in line and "silence_end:" in line:
            try:
                end = float(line.split("silence_end:")[1].strip().split("|")[0].strip())
                dur = float(line.split("silence_duration:")[1].strip().split()[0])
                start = end - dur
                if start >= after and dur >= min_dur:
                    paired.append((start, dur))
            except (IndexError, ValueError):
                pass
    if paired:
        return [s for s, _ in paired]
    return pauses


def parse_script(md: str) -> list[Cue]:
    parts = re.split(r"^### `([^`]+)`[^\n]*\n", md, flags=re.M)
    cues: list[Cue] = []
    # parts[0]=preamble, then filename, body, filename, body...
    for i in range(1, len(parts), 2):
        filename = parts[i].strip()
        body = parts[i + 1]
        # stop at next ## section header leftover — body already split by ###
        # cut at following ## if any slipped in
        body = re.split(r"^## ", body, maxsplit=1, flags=re.M)[0]
        cue = Cue(filename=filename)
        spoken_lines: list[str] = []
        for raw in body.splitlines():
            line = raw.strip()
            if not line:
                continue
            if line.startswith("##"):
                break
            if re.fullmatch(r"-{3,}", line):
                continue
            tone = re.match(r"^\[Tone:\s*(.+?)\]\s*$", line, re.I)
            if tone:
                if re.search(r"whisper", tone.group(1), re.I):
                    cue.whisper = True
                continue
            if re.match(r"^\[Fade", line, re.I):
                continue
            mix = re.match(r"^\[Mix:\s*(.+?)\]\s*$", line, re.I)
            if mix:
                mode = mix.group(1).strip().lower().replace("_", "-")
                if mode in {"no-sfx", "nosfx", "voice-only", "voiceonly", "quiet-sfx", "quietsfx"}:
                    if mode in {"nosfx"}:
                        mode = "no-sfx"
                    elif mode in {"voiceonly"}:
                        mode = "voice-only"
                    elif mode in {"quietsfx"}:
                        mode = "quiet-sfx"
                    cue.mix_mode = mode
                continue
            if re.match(r"^\[Pause", line, re.I):
                m = re.search(r"([\d.]+)\s*s", line, re.I)
                sec = m.group(1) if m else "0.8"
                spoken_lines.append(f'<break time="{sec}s" />')
                continue
            amb = re.match(
                r'^\[Ambience\s*\|\s*(?:loop\s*\|\s*)?~?([\d.]+)s\]:\s*"([^"]+)"\s*$',
                line,
                re.I,
            )
            if amb:
                loop = "loop" in line.lower()
                cue.ambiences.append((amb.group(2), float(amb.group(1)), loop))
                continue
            # alternate ambience with optional loop token mid-tag already handled
            amb2 = re.match(
                r'^\[Ambience[^\]]*~?([\d.]+)s\]:\s*"([^"]+)"\s*$',
                line,
                re.I,
            )
            if amb2 and "Ambience" in line:
                loop = "loop" in line.lower()
                cue.ambiences.append((amb2.group(2), float(amb2.group(1)), loop))
                continue
            sx = re.match(r'^\[SFX\s*\|([^\]]*)]:\s*"([^"]+)"\s*$', line, re.I)
            if sx:
                meta, text = sx.group(1), sx.group(2)
                dur_m = re.search(r"~?([\d.]+)\s*s", meta, re.I)
                if not dur_m:
                    continue
                spec = SfxSpec(text=text, duration=float(dur_m.group(1)))
                ap = re.search(r"after-pause\s*:\s*(\d+)", meta, re.I)
                if ap:
                    spec.after_pause = int(ap.group(1))
                at = re.search(r"@\s*([\d.]+)\s*s", meta, re.I)
                if at:
                    spec.at_sec = float(at.group(1))
                plus = re.search(r"\+\s*([\d.]+)\s*s", meta, re.I)
                if plus:
                    spec.delay_extra = float(plus.group(1))
                vol = re.search(r"vol\s*:\s*([\d.]+)", meta, re.I)
                if vol:
                    spec.volume = float(vol.group(1))
                cue.sfx.append(spec)
                continue
            if line.startswith("[") and line.endswith("]"):
                continue
            if line.startswith("*(") or line.startswith("(No spoken") or line.startswith("*(Wordless"):
                continue
            if line.startswith("[Record by") or line.startswith("Or stitch"):
                continue
            # strip leading italic note wrappers
            if line.startswith("*") and line.endswith("*") and "ambience only" in line.lower():
                continue
            spoken_lines.append(line)

        # join spoken, collapse break-only runs
        text = "\n".join(spoken_lines).strip()
        # remove markdown bold leftovers
        text = text.replace("**", "")
        cue.spoken = text
        # Apply mix-mode overrides after collecting layers
        if cue.mix_mode == "voice-only":
            cue.ambiences = []
            cue.sfx = []
        elif cue.mix_mode == "no-sfx":
            cue.sfx = []
        cues.append(cue)
    return cues


def mix_cue(cue: Cue, stem_dir: Path, out_path: Path) -> None:
    """Layer voice + ambience + sfx into one mp3."""
    voice = stem_dir / "voice.mp3"
    inputs: list[Path] = []
    filters: list[str] = []
    labels: list[str] = []

    idx = 0
    total = 2.0
    lead_ms = 400
    if voice.exists() and voice.stat().st_size > 500:
        vd = duration(voice)
        total = vd + 1.2
        # slight lead-in
        filters.append(
            f"[{idx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,"
            f"volume={VOICE_VOL},adelay={lead_ms}|{lead_ms}[v]"
        )
        inputs.append(voice)
        labels.append("[v]")
        idx += 1
        voice_start = lead_ms / 1000.0
        pause_starts = long_voice_pauses(voice)
    else:
        voice_start = 0.0
        vd = 0.0
        pause_starts = []

    # ambience under full length
    if cue.ambiences:
        amb_path = stem_dir / "amb0.mp3"
        if amb_path.exists():
            inputs.append(amb_path)
            fade_out_at = max(0.1, total - 1.8)
            amb_vol = INTRO_AMB_VOL if cue.filename == "intro.mp3" else AMB_VOL
            filters.append(
                f"[{idx}:a]aloop=loop=-1:size=2e+09,atrim=0:{total:.3f},"
                f"aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,"
                f"volume={amb_vol},afade=t=in:st=0:d=0.6,afade=t=out:st={fade_out_at:.3f}:d=1.6[amb]"
            )
            labels.append("[amb]")
            idx += 1

    # place up to 3 sfx across the voice
    for si, spec in enumerate(cue.sfx[:3]):
        sp = stem_dir / f"sfx{si}.mp3"
        if not sp.exists():
            continue
        inputs.append(sp)
        if spec.at_sec is not None:
            at = spec.at_sec + spec.delay_extra
        elif spec.after_pause is not None and pause_starts:
            pi = max(0, spec.after_pause - 1)
            base = pause_starts[min(pi, len(pause_starts) - 1)]
            # just into the pause (after spoken cue), plus optional offset
            at = voice_start + base + 0.15 + spec.delay_extra
        elif vd > 0:
            frac = 0.12 + si * 0.28
            at = voice_start + vd * min(0.85, frac) + spec.delay_extra
        else:
            at = 0.05 + si * 0.4 + spec.delay_extra
        ms = int(max(0.0, at) * 1000)
        if spec.volume is not None:
            vol = spec.volume
        elif cue.mix_mode == "quiet-sfx":
            vol = 0.18 if si == 0 else 0.14
        else:
            vol = SFX_VOL_PRIMARY if si == 0 else SFX_VOL_SECONDARY
        filters.append(
            f"[{idx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,"
            f"volume={vol},adelay={ms}|{ms}[s{si}]"
        )
        labels.append(f"[s{si}]")
        idx += 1

    if not inputs:
        raise RuntimeError(f"no stems for {cue.filename}")

    if len(labels) == 1:
        # single stream — still normalize
        filters.append(f"{labels[0]}loudnorm=I=-16:TP=-1.5:LRA=11[out]")
    elif labels[0] == "[v]" and DUCK:
        bed = labels[1:]
        if len(bed) > 1:
            filters.append(f"{''.join(bed)}amix=inputs={len(bed)}:duration=longest:normalize=0[bed]")
            bed = ["[bed]"]
        filters.append("[v]asplit=2[vm][vsc0]")
        filters.append("[vsc0]apad[vsc]")
        filters.append(f"{bed[0]}[vsc]sidechaincompress={DUCK}[bedd]")
        filters.append("[vm][bedd]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[out]")
    else:
        n = len(labels)
        filters.append(
            f"{''.join(labels)}amix=inputs={n}:duration=longest:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[out]"
        )

    filter_path = stem_dir / "mix.filter"
    filter_path.write_text(";".join(filters), encoding="utf-8")

    cmd = [FFMPEG, "-y"]
    for p in inputs:
        cmd += ["-i", str(p)]
    cmd += ["-filter_complex_script", str(filter_path), "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", str(out_path)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg mix failed for {cue.filename}:\n{r.stderr[-800:]}")

def process_cue(
    cue: Cue,
    key: str,
    force: bool = False,
    skip_existing: bool = False,
    remix_only: bool = False,
    voice_only: bool = False,
    preview: bool = False,
) -> str:
    out_path = OUT_DIR / cue.filename
    if preview:
        if not re.sub(r"<break[^>]*>", "", cue.spoken).strip():
            return f"skip {cue.filename} (no speech)"
        dest = PREVIEW_DIR / PREVIEW_TAG / cue.filename
        pv_stems = dest.parent / cue.filename.replace(".mp3", "")
        pv_stems.mkdir(parents=True, exist_ok=True)
        live_stems = WORK / cue.filename.replace(".mp3", "")
        reused = []
        for stem in sorted(live_stems.glob("amb0.mp3")) + sorted(live_stems.glob("sfx*.mp3")):
            (pv_stems / stem.name).write_bytes(stem.read_bytes())
            reused.append(stem.name)
        spoken = cue.spoken
        if PREVIEW_TEXT:
            spoken = json.loads(Path(PREVIEW_TEXT).read_text(encoding="utf-8-sig")).get(cue.filename, spoken)
        tts(spoken, pv_stems / "voice.mp3", cue.whisper, key)
        if reused:
            mix_cue(cue, pv_stems, dest)
        else:
            dest.write_bytes((pv_stems / "voice.mp3").read_bytes())
        return f"preview {dest.relative_to(OUT_DIR).as_posix()} ({duration(dest):.1f}s, reused {reused or 'none'})"
    if cue.filename in SKIP and out_path.exists() and not force and not remix_only and not voice_only:
        return f"skip {cue.filename} (kept)"
    if skip_existing and out_path.exists() and out_path.stat().st_size > 1000 and not force and not remix_only:
        return f"skip {cue.filename} (exists)"
    if cue.filename in RULES_STITCHES:
        return f"defer {cue.filename}"

    stem_dir = WORK / cue.filename.replace(".mp3", "")
    stem_dir.mkdir(parents=True, exist_ok=True)

    has_speech = bool(re.sub(r"<break[^>]*>", "", cue.spoken).strip())

    # Drop stale sting stems when this cue no longer uses SFX
    if not cue.sfx:
        for stale in stem_dir.glob("sfx*.mp3"):
            stale.unlink(missing_ok=True)
    if not cue.ambiences:
        amb_stale = stem_dir / "amb0.mp3"
        if amb_stale.exists():
            amb_stale.unlink(missing_ok=True)

    # Re-record narration only; ambience / SFX stems are reused (voice.prev.mp3 keeps the first original)
    if voice_only and has_speech:
        voice_path = stem_dir / "voice.mp3"
        backup = stem_dir / "voice.prev.mp3"
        if voice_path.exists() and not backup.exists():
            backup.write_bytes(voice_path.read_bytes())
        tts(cue.spoken, voice_path, cue.whisper, key)
        time.sleep(0.15)
        remix_only = True
    elif voice_only:
        return f"skip {cue.filename} (no speech)"

    # Remix existing stems only (no TTS / no new SFX downloads unless a stem is missing)
    if remix_only:
        voice_path = stem_dir / "voice.mp3"
        if has_speech and (not voice_path.exists() or voice_path.stat().st_size < 500):
            raise RuntimeError(f"remix-only: missing voice stem for {cue.filename}")
        if cue.ambiences:
            amb = stem_dir / "amb0.mp3"
            if not amb.exists():
                text, dur, loop = cue.ambiences[0]
                vd = duration(voice_path) if voice_path.exists() else dur
                amb_dur = max(dur, min(30.0, vd + 2.0))
                sfx(text, amb, amb_dur, True, key)
                time.sleep(0.1)
        for i, spec in enumerate(cue.sfx[:3]):
            sp = stem_dir / f"sfx{i}.mp3"
            if not sp.exists() or sp.stat().st_size < 200:
                sfx(spec.text, sp, spec.duration, False, key)
                time.sleep(0.1)
        if not cue.ambiences and not cue.sfx:
            cmd = [
                FFMPEG, "-y", "-i", str(voice_path),
                "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                "-c:a", "libmp3lame", "-b:a", "192k", str(out_path),
            ]
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(r.stderr[-500:])
            return f"remix-voice {cue.filename}"
        mix_cue(cue, stem_dir, out_path)
        return f"remix {cue.filename}"

    # Ambience-only / SFX-only
    if not has_speech:
        if cue.ambiences:
            text, dur, loop = cue.ambiences[0]
            sfx(text, out_path, dur, True, key)
            return f"ambience {cue.filename}"
        if cue.sfx:
            spec = cue.sfx[0]
            sfx(spec.text, out_path, spec.duration, False, key)
            return f"sfx-only {cue.filename}"
        return f"empty {cue.filename}"

    # TTS
    voice_path = stem_dir / "voice.mp3"
    tts(cue.spoken, voice_path, cue.whisper, key)
    time.sleep(0.15)

    vd = duration(voice_path)
    # Ambience long enough to cover
    if cue.ambiences:
        text, dur, loop = cue.ambiences[0]
        amb_dur = max(dur, min(30.0, vd + 2.0))
        sfx(text, stem_dir / "amb0.mp3", amb_dur, True, key)
        time.sleep(0.1)

    for i, spec in enumerate(cue.sfx[:3]):
        sfx(spec.text, stem_dir / f"sfx{i}.mp3", spec.duration, False, key)
        time.sleep(0.1)

    # If no ambience/sfx, just copy voice with loudnorm
    if not cue.ambiences and not cue.sfx:
        cmd = [
            FFMPEG, "-y", "-i", str(voice_path),
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-c:a", "libmp3lame", "-b:a", "192k", str(out_path),
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr[-500:])
        # Keep stem notes accurate (no leftover amb/sfx mix script)
        (stem_dir / "mix.filter").write_text(
            "[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[out]", encoding="utf-8"
        )
        mode_note = f" ({cue.mix_mode})" if cue.mix_mode else ""
        return f"voice{mode_note} {cue.filename}"

    mix_cue(cue, stem_dir, out_path)
    mode_note = f" ({cue.mix_mode})" if cue.mix_mode else ""
    return f"mixed{mode_note} {cue.filename}"


def stitch_rules(name: str) -> None:
    order = RULES_STITCHES[name]
    missing = [f for f in order if not (OUT_DIR / f).exists()]
    if missing:
        print(f"{name} skipped, missing:", missing)
        return
    list_path = WORK / f"{name.replace('.mp3', '')}_concat.txt"
    lines = []
    for f in order:
        # ffmpeg concat needs forward slashes or escaped
        p = (OUT_DIR / f).as_posix().replace("'", r"'\''")
        lines.append(f"file '{p}'")
    list_path.write_text("\n".join(lines), encoding="utf-8")
    out = OUT_DIR / name
    cmd = [FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(list_path), "-c", "copy", str(out)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        # re-encode if copy fails
        cmd = [FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", str(list_path), "-c:a", "libmp3lame", "-b:a", "192k", str(out)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr[-600:])
    print(f"stitched {name} ({out.stat().st_size} bytes, {duration(out):.1f}s)")


def main() -> None:
    global FFMPEG, FFPROBE
    FFMPEG, FFPROBE = find_ffmpeg()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}

    # --stitch-only [rules_quick.mp3 ...]: re-join the recorded chapters with ffmpeg; no API key, no TTS.
    if "--stitch-only" in flags:
        names = [a if a.endswith(".mp3") else f"{a}.mp3" for a in args] or list(RULES_STITCHES)
        for name in names:
            if name not in RULES_STITCHES:
                raise SystemExit(f"not a stitch target: {name} (one of {', '.join(RULES_STITCHES)})")
            stitch_rules(name)
        return

    key = api_key()
    start_sub = subscription(key)
    start_chars = int(start_sub.get("character_count") or 0)
    char_limit = int(start_sub.get("character_limit") or 0)
    print(
        f"subscription character_count={start_chars} limit={char_limit} "
        f"remaining={char_limit - start_chars} cap={CREDIT_CAP}"
    )
    force = "--force" in flags
    skip_existing = "--skip-existing" in flags or "--only-missing" in flags
    variants_only = "--variants" in flags
    remix_only = "--remix" in flags
    voice_only = "--voice-only" in flags
    preview = "--preview" in flags

    md = SCRIPT.read_text(encoding="utf-8")
    cues = parse_script(md)
    # Only keep .mp3 cues from A/B/C/F/G (all ### blocks)
    cues = [c for c in cues if c.filename.endswith(".mp3")]

    if variants_only:
        cues = [c for c in cues if re.search(r"_[bcd]\.mp3$", c.filename, re.I)]
        skip_existing = True

    only = set(args) if args else None
    if only:
        cues = [c for c in cues if c.filename in only or c.filename.replace(".mp3", "") in only]

    print(
        f"Parsed {len(cues)} cues (force={force} skip_existing={skip_existing} remix_only={remix_only} "
        f"voice_only={voice_only} preview={preview} voice={VOICE_ID} model={TTS_MODEL} tempo={TEMPO} no_whisper={NO_WHISPER})"
    )
    overrides = {name: os.environ[env] for name, env in SETTING_ENV.items() if os.environ.get(env)}
    if preview:
        print(f"preview tag={PREVIEW_TAG} settings={overrides or 'default'} text={PREVIEW_TEXT or 'script'}")
    ok = 0
    err = 0
    checked_after_first = False
    for i, cue in enumerate(cues, 1):
        try:
            msg = process_cue(
                cue,
                key,
                force=force,
                skip_existing=skip_existing,
                remix_only=remix_only,
                voice_only=voice_only,
                preview=preview,
            )
            print(f"[{i}/{len(cues)}] {msg}")
            ok += 1
            did_tts = not msg.startswith(("skip ", "defer ", "empty "))
            if did_tts and not checked_after_first:
                checked_after_first = True
                sub = subscription(key)
                used = int(sub.get("character_count") or 0) - start_chars
                remaining = int(sub.get("character_limit") or 0) - int(sub.get("character_count") or 0)
                print(f"after first TTS: used={used} remaining={remaining}")
                if used > CREDIT_CAP:
                    raise QuotaExceeded(f"credit cap {CREDIT_CAP} exceeded (used {used})")
        except QuotaExceeded as e:
            err += 1
            print(f"[{i}/{len(cues)}] STOP quota_exceeded {cue.filename}: {e}")
            break
        except Exception as e:
            err += 1
            print(f"[{i}/{len(cues)}] FAIL {cue.filename}: {e}")
            # continue batch
            time.sleep(1)

    for name in RULES_STITCHES:
        want_stitch = (
            STITCH_RULES_FULL
            and not variants_only
            and not preview
            and (not only or name in only or name.replace(".mp3", "") in only)
        )
        if want_stitch:
            try:
                stitch_rules(name)
            except Exception as e:
                print(f"{name} stitch failed:", e)
                err += 1

    print(f"Done. ok={ok} err={err}")
    try:
        end_sub = subscription(key)
        end_chars = int(end_sub.get("character_count") or 0)
        print(f"credit delta={end_chars - start_chars} (start={start_chars} end={end_chars})")
    except Exception as e:
        print(f"credit delta unavailable: {e}")
    # summary
    files = sorted(OUT_DIR.glob("*.mp3"))
    print(f"{len(files)} mp3 files in {OUT_DIR}")


if __name__ == "__main__":
    main()

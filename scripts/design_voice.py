#!/usr/bin/env python3
"""Design candidate Storyteller voices with ElevenLabs Voice Design and save previews.

  python scripts/design_voice.py            # generate previews into data/audio/_voice_design/
  python scripts/design_voice.py merge [preview.mp3]   # blend a preview with the current voice (v3 reference audio)
  python scripts/design_voice.py save <generated_voice_id> "Name"   # add a preview to your voice library
  python scripts/design_voice.py speed <voice_id> [1.0 1.08 1.15]  # sample line at several TTS speeds
"""

from __future__ import annotations

import base64
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_narration import OUT_DIR, VOICE_ID, api_key  # noqa: E402

DESIGN_DIR = OUT_DIR / "_voice_design"

VOICE_DESCRIPTION = (
    "An old, gravelly male storyteller with a deep, velvety British voice. He speaks slowly and "
    "deliberately, in a hushed, sinister near-whisper that swells into theatrical menace. Like a "
    "Victorian gothic narrator telling ghost stories by candlelight on Halloween night: ominous, dry, "
    "knowing, with a faint rasp and a cruel smile in his voice. Close microphone, studio quality, "
    "no background noise."
)

SAMPLE_TEXT = (
    "Gather close, townsfolk of Ravenswood Bluff... and listen. The clocktower has struck midnight, "
    "and your Storyteller hangs lifeless from its iron hands. Somewhere among you, a Demon smiles "
    "with a borrowed face. The candles in the pumpkins gutter, and the fog crawls up from the "
    "graveyard. Close your eyes... and pray that when you wake... you are still yourself."
)

MODELS = ["eleven_ttv_v3", "eleven_multilingual_ttv_v2"]


def post(url: str, payload: dict, key: str, accept: str = "application/json") -> bytes:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": accept},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} {url}: {e.read().decode('utf-8', errors='replace')[:600]}") from e


def design(key: str) -> None:
    DESIGN_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    for model in MODELS:
        print(f"Designing with {model}...")
        body = json.loads(
            post(
                "https://api.elevenlabs.io/v1/text-to-voice/design?output_format=mp3_44100_128",
                {
                    "voice_description": VOICE_DESCRIPTION,
                    "text": SAMPLE_TEXT,
                    "model_id": model,
                    "guidance_scale": 4,
                },
                key,
            )
        )
        for i, p in enumerate(body["previews"], 1):
            name = f"{model}_{i}.mp3"
            (DESIGN_DIR / name).write_bytes(base64.b64decode(p["audio_base_64"]))
            manifest.append(
                {"file": name, "model": model, "generated_voice_id": p["generated_voice_id"],
                 "duration_secs": p.get("duration_secs")}
            )
            print(f"  {name}  {p.get('duration_secs', 0):.1f}s  id={p['generated_voice_id']}")

    print("Current narration voice, same text (for comparison)...")
    audio = post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}?output_format=mp3_44100_128",
        {"text": SAMPLE_TEXT, "model_id": "eleven_multilingual_v2",
         "voice_settings": {"stability": 0.45, "similarity_boost": 0.75}},
        key,
        accept="audio/mpeg",
    )
    (DESIGN_DIR / "current_voice.mp3").write_bytes(audio)
    manifest.append({"file": "current_voice.mp3", "model": "current", "generated_voice_id": VOICE_ID})

    (DESIGN_DIR / "manifest.json").write_text(
        json.dumps({"description": VOICE_DESCRIPTION, "text": SAMPLE_TEXT, "previews": manifest}, indent=2),
        encoding="utf-8",
    )
    print(f"Saved to {DESIGN_DIR}")


MERGE_DESCRIPTION = (
    VOICE_DESCRIPTION
    + " Keep a steady storytelling pace, slightly quicker than a slow drawl: unhurried and ominous, "
    "but never dragging, with short dramatic pauses rather than long ones."
)


def merge(key: str, base_file: str = "eleven_ttv_v3_1.mp3") -> None:
    """Blend a liked preview with the current narration voice via v3 reference audio."""
    import subprocess

    from generate_narration import find_ffmpeg

    ffmpeg, _ = find_ffmpeg()
    ref = DESIGN_DIR / "_merge_reference.mp3"
    # ~15s of the liked preview, then ~12s of the current voice, crossfaded
    r = subprocess.run(
        [
            ffmpeg, "-y",
            "-i", str(DESIGN_DIR / base_file),
            "-i", str(DESIGN_DIR / "current_voice.mp3"),
            "-filter_complex",
            "[0:a]atrim=0:15,asetpts=PTS-STARTPTS[a];[1:a]atrim=0:12,asetpts=PTS-STARTPTS[b];"
            "[a][b]acrossfade=d=0.5,loudnorm=I=-18:TP=-2[out]",
            "-map", "[out]", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", str(ref),
        ],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        raise SystemExit(r.stderr[-600:])
    ref_b64 = base64.b64encode(ref.read_bytes()).decode()

    manifest_path = DESIGN_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    manifest["previews"] = [p for p in manifest["previews"] if not p["model"].startswith("merge")]

    for strength in (0.35, 0.6):
        label = f"merge_ps{int(strength * 100)}"
        print(f"Merging (prompt_strength={strength})...")
        body = json.loads(
            post(
                "https://api.elevenlabs.io/v1/text-to-voice/design?output_format=mp3_44100_128",
                {
                    "voice_description": MERGE_DESCRIPTION,
                    "text": SAMPLE_TEXT,
                    "model_id": "eleven_ttv_v3",
                    "guidance_scale": 4,
                    "reference_audio_base64": ref_b64,
                    "prompt_strength": strength,
                },
                key,
            )
        )
        for i, p in enumerate(body["previews"], 1):
            name = f"{label}_{i}.mp3"
            (DESIGN_DIR / name).write_bytes(base64.b64decode(p["audio_base_64"]))
            manifest["previews"].append(
                {"file": name, "model": label, "generated_voice_id": p["generated_voice_id"],
                 "duration_secs": p.get("duration_secs")}
            )
            print(f"  {name}  {p.get('duration_secs', 0):.1f}s  id={p['generated_voice_id']}")

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def save(key: str, generated_voice_id: str, name: str) -> str:
    body = json.loads(
        post(
            "https://api.elevenlabs.io/v1/text-to-voice",
            {"voice_name": name, "voice_description": VOICE_DESCRIPTION, "generated_voice_id": generated_voice_id},
            key,
        )
    )
    print(f"Saved voice '{name}': voice_id={body['voice_id']}")
    return body["voice_id"]


def speed_test(key: str, voice_id: str, speeds: list[float], tts_model: str = "eleven_multilingual_v2") -> None:
    """Render the sample line with a saved voice at several TTS speeds."""
    tag = "v3" if tts_model == "eleven_v3" else "v2"
    manifest_path = DESIGN_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    for sp in speeds:
        name = f"speed_{tag}_{sp:.2f}.mp3"
        settings = {"stability": 0.5, "similarity_boost": 0.75, "speed": sp}
        audio = post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128",
            {"text": SAMPLE_TEXT, "model_id": tts_model, "voice_settings": settings},
            key,
            accept="audio/mpeg",
        )
        (DESIGN_DIR / name).write_bytes(audio)
        manifest["previews"] = [p for p in manifest["previews"] if p["file"] != name]
        manifest["previews"].append(
            {"file": name, "model": f"speed_{tag}", "generated_voice_id": voice_id, "speed": sp}
        )
        print(f"  {name}")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def transcribe(key: str) -> None:
    """Speech-to-text each preview to check it read the sample text as written."""
    import uuid

    for f in sorted(DESIGN_DIR.glob("*.mp3")):
        boundary = "----" + uuid.uuid4().hex
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v1\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{f.name}"\r\n'
            "Content-Type: audio/mpeg\r\n\r\n"
        ).encode() + f.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(
            "https://api.elevenlabs.io/v1/speech-to-text",
            data=body,
            headers={"xi-api-key": key, "Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                text = json.loads(resp.read())["text"]
        except urllib.error.HTTPError as e:
            raise SystemExit(f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:400]}") from e
        print(f"== {f.name} ({len(text.split())} words)\n{text}\n")


if __name__ == "__main__":
    k = api_key()
    if len(sys.argv) >= 2 and sys.argv[1] == "transcribe":
        transcribe(k)
    elif len(sys.argv) >= 2 and sys.argv[1] == "merge":
        merge(k, *(sys.argv[2:3]))
    elif len(sys.argv) >= 3 and sys.argv[1] == "speed":
        rest = [a for a in sys.argv[3:] if a != "--v3"]
        speed_test(
            k,
            sys.argv[2],
            [float(x) for x in (rest or ["1.0", "1.08", "1.15"])],
            "eleven_v3" if "--v3" in sys.argv else "eleven_multilingual_v2",
        )
    elif len(sys.argv) >= 3 and sys.argv[1] == "save":
        save(k, sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "Ravenswood Storyteller")
    else:
        design(k)

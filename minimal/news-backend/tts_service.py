#!/usr/bin/env python3
"""
Piper text-to-speech helper used by the Node backend.

Modes:
- One-shot: python3 tts_service.py <text> <output_path> <model_path>
- Serve (`--serve`): read newline-delimited JSON requests
  {"id": ..., "text": "...", "output_path": "...", "model_path": "..."}
  from stdin and answer each with one JSON line on stdout. Loaded voices are
  cached between requests. The loop ends when stdin closes.

Logs go to stderr; in serve mode stdout is reserved for JSON responses.
"""

import json
import os
import sys
import wave

_VOICES = {}


def _use_utf8_streams():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass


def get_voice(model_path):
    voice = _VOICES.get(model_path)
    if voice is None:
        from piper import PiperVoice

        voice = PiperVoice.load(model_path)
        _VOICES[model_path] = voice
    return voice


def synthesize(text, output_path, model_path):
    # Ensure the output directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    voice = get_voice(model_path)
    with wave.open(output_path, "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)


def handle_request(req):
    if not isinstance(req, dict):
        return {"ok": False, "error": "Request must be a JSON object"}

    text = str(req.get("text") or "").strip()
    output_path = str(req.get("output_path") or "")
    model_path = str(req.get("model_path") or "")
    if not text:
        return {"ok": False, "error": "Empty text"}
    if not output_path or not model_path:
        return {"ok": False, "error": "output_path and model_path are required"}

    try:
        synthesize(text, output_path, model_path)
        return {"ok": True, "output_path": output_path}
    except Exception as e:
        print(f"TTS failed: {e!r}", file=sys.stderr)
        return {"ok": False, "error": str(e)}


def serve():
    protocol = sys.stdout
    # Keep any library output off the protocol stream.
    sys.stdout = sys.stderr

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:
            req = None
            response = {"ok": False, "error": f"Invalid JSON input: {e}"}
        else:
            response = handle_request(req)

        if isinstance(req, dict) and "id" in req:
            response["id"] = req["id"]
        protocol.write(json.dumps(response, ensure_ascii=False) + "\n")
        protocol.flush()
    return 0


def main():
    _use_utf8_streams()
    if "--serve" in sys.argv[1:]:
        return serve()

    if len(sys.argv) < 4:
        print("Usage: python3 tts_service.py <text> <output_path> <model_path> | --serve")
        return 1

    response = handle_request({
        "text": sys.argv[1],
        "output_path": sys.argv[2],
        "model_path": sys.argv[3],
    })
    if response.get("ok"):
        print(f"Successfully generated: {response['output_path']}")
        return 0
    print(f"Error: {response.get('error')}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

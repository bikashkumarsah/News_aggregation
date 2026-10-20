#!/usr/bin/env python3
"""
mBART inference helper used by the Node backend.

Modes:
- One-shot (default): read a single JSON request from stdin and print a single
  JSON response to stdout.
- Serve (`--serve`): read newline-delimited JSON requests from stdin and write
  one JSON line per request to stdout. The model stays loaded between
  requests; an optional "id" field is echoed back. The loop ends when stdin
  closes.

Request shape:
{
  "task": "summarize" | "translate_en_to_ne",
  "text": "...",
  "max_new_tokens": 160,      (optional)
  "max_input_tokens": 1024    (optional)
}

Env:
- MBART_MODEL (default: sagunrai/mbart-large-50-nepali-finetuned-1)
- MBART_DEVICE (auto | cpu | cuda | mps; default auto = cuda when available, else cpu)

Notes:
- Hugging Face caches weights on disk; the first request downloads the model.
- Logs go to stderr; stdout is reserved for JSON responses.
"""

import json
import os
import sys

DEFAULT_MODEL = "sagunrai/mbart-large-50-nepali-finetuned-1"
TASKS = ("summarize", "translate_en_to_ne")

_MODEL_CACHE = {}


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def _use_utf8_streams():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass


def _chunk_text(text: str, max_chars: int = 700, max_chunks: int = 12):
    """
    Heuristic chunking for long translation inputs.
    Keeps chunks reasonably small for seq2seq models and avoids truncation.
    """
    raw = (text or "").replace("\r", "\n")
    # Prefer paragraph boundaries if present.
    parts = [p.strip() for p in raw.split("\n") if p.strip()]
    if not parts:
        parts = [raw.strip()]

    chunks = []
    cur = ""
    for p in parts:
        if not p:
            continue
        if len(cur) + len(p) + 1 > max_chars and cur:
            chunks.append(cur.strip())
            cur = p
        else:
            cur = (cur + " " + p).strip() if cur else p
        if len(chunks) >= max_chunks:
            break

    if cur and len(chunks) < max_chunks:
        chunks.append(cur.strip())

    # Final fallback: if the first chunk is still huge, hard-split.
    if chunks and len(chunks[0]) > max_chars * 2:
        hard = []
        t = chunks[0]
        for i in range(0, len(t), max_chars):
            hard.append(t[i : i + max_chars])
            if len(hard) >= max_chunks:
                break
        chunks = hard

    return [c for c in chunks if c]


def _pick_device(torch):
    requested = os.environ.get("MBART_DEVICE", "auto").strip().lower()
    if requested in ("cpu", "cuda", "mps"):
        return requested
    return "cuda" if torch.cuda.is_available() else "cpu"


def load_model(model_name):
    cached = _MODEL_CACHE.get(model_name)
    if cached is not None:
        return cached

    import torch
    from transformers import AutoConfig, AutoModelForSeq2SeqLM, AutoTokenizer

    device = _pick_device(torch)
    eprint(f"Loading {model_name} on {device}...")
    tokenizer = AutoTokenizer.from_pretrained(model_name)

    # Some community fine-tuned checkpoints may include generation fields set to null in config.json
    # (e.g., early_stopping=null). Newer Transformers validates these and fails model init.
    # We patch common nulls to safe defaults before instantiating the model.
    config = AutoConfig.from_pretrained(model_name)
    for key, default in (
        ("early_stopping", False),
        ("num_beams", 1),
        ("max_length", 512),
    ):
        if hasattr(config, key) and getattr(config, key) is None:
            setattr(config, key, default)

    model = AutoModelForSeq2SeqLM.from_pretrained(model_name, config=config).to(device)
    model.eval()

    loaded = (torch, tokenizer, model, device)
    _MODEL_CACHE[model_name] = loaded
    return loaded


def handle_request(req):
    if not isinstance(req, dict):
        return {"ok": False, "error": "Request must be a JSON object"}

    task = str(req.get("task") or "").strip()
    text = req.get("text") or ""
    if not isinstance(text, str):
        text = str(text)
    text = text.strip()

    if task not in TASKS:
        return {"ok": False, "error": f"Unsupported task: {task}"}
    if not text:
        return {"ok": False, "error": "Empty text"}

    model_name = os.environ.get("MBART_MODEL", DEFAULT_MODEL)

    try:
        torch, tokenizer, model, device = load_model(model_name)
    except ImportError as e:
        return {
            "ok": False,
            "error": f"Missing Python dependencies. Install torch + transformers. Details: {e}",
        }
    except Exception as e:
        eprint("mBART model load failed:", repr(e))
        return {"ok": False, "error": f"Could not load {model_name}: {e}"}

    try:
        if task == "summarize":
            # The notebook uses the "summarize:" prefix for this fine-tuned model.
            input_text = f"summarize: {text}"
            max_new_tokens = int(req.get("max_new_tokens") or 160)
        else:
            # English -> Nepali translation prefix used in the notebook.
            input_text = f"translate English to Nepali: {text}"
            max_new_tokens = int(req.get("max_new_tokens") or 256)

        max_input_tokens = int(req.get("max_input_tokens") or 1024)
        num_beams = int(req.get("num_beams") or 4)
        do_sample = bool(req.get("do_sample") or False)

        def generate_one(prompt_text: str, new_tokens: int):
            inputs = tokenizer(
                prompt_text,
                return_tensors="pt",
                truncation=True,
                max_length=max_input_tokens,
            )
            inputs = {k: v.to(device) for k, v in inputs.items()}
            with torch.no_grad():
                out_ids = model.generate(
                    **inputs,
                    num_beams=num_beams,
                    early_stopping=False,
                    max_new_tokens=new_tokens,
                    do_sample=do_sample,
                )
            return tokenizer.decode(out_ids[0], skip_special_tokens=True).strip()

        # For long translations, chunk to improve coverage (model often stops early on long inputs).
        if task == "translate_en_to_ne":
            chunking = req.get("chunking")
            if chunking is None:
                chunking = len(text) > 600  # auto-enable for longer texts
            if chunking:
                chunk_chars = int(req.get("chunk_chars") or 700)
                max_chunks = int(req.get("max_chunks") or 12)
                chunks = _chunk_text(text, max_chars=chunk_chars, max_chunks=max_chunks)
                outs = []
                for ch in chunks:
                    outs.append(generate_one(f"translate English to Nepali: {ch}", max_new_tokens))
                out_text = "\n\n".join([o for o in outs if o])
            else:
                out_text = generate_one(input_text, max_new_tokens)
        else:
            out_text = generate_one(input_text, max_new_tokens)

        return {"ok": True, "text": out_text}
    except Exception as e:
        eprint("mBART inference failed:", repr(e))
        return {"ok": False, "error": str(e)}


def run_once():
    try:
        req = json.load(sys.stdin)
    except Exception as e:
        json.dump({"ok": False, "error": f"Invalid JSON input: {e}"}, sys.stdout, ensure_ascii=False)
        return 1

    response = handle_request(req)
    json.dump(response, sys.stdout, ensure_ascii=False)
    return 0 if response.get("ok") else 1


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
    return run_once()


if __name__ == "__main__":
    raise SystemExit(main())

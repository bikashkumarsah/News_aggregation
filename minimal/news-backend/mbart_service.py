#!/usr/bin/env python3
"""
Minimal mBART inference helper used by the Node backend.

Reads a single JSON request from stdin and prints a single JSON response to stdout.

Request shape:
{
  "task": "summarize" | "translate_en_to_ne",
  "text": "..."
}

Env:
- MBART_MODEL (default: sagunrai/mbart-large-50-nepali-finetuned-1)

Notes:
- This script loads the model per invocation. Hugging Face caches weights on disk,
  so subsequent runs are faster, but the first run will download the model.
- Logs go to stderr; stdout is reserved for the JSON response.
"""

import json
import os
import sys


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

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

def main():
    try:
        req = json.load(sys.stdin)
    except Exception as e:
        json.dump({"ok": False, "error": f"Invalid JSON input: {e}"}, sys.stdout, ensure_ascii=False)
        return 1

    task = (req.get("task") or "").strip()
    text = (req.get("text") or "")
    if not isinstance(text, str):
        text = str(text)
    text = text.strip()

    if task not in ("summarize", "translate_en_to_ne"):
        json.dump({"ok": False, "error": f"Unsupported task: {task}"}, sys.stdout, ensure_ascii=False)
        return 1
    if not text:
        json.dump({"ok": False, "error": "Empty text"}, sys.stdout, ensure_ascii=False)
        return 1

    model_name = os.environ.get("MBART_MODEL", "sagunrai/mbart-large-50-nepali-finetuned-1")

    try:
        import torch
        from transformers import AutoConfig, AutoModelForSeq2SeqLM, AutoTokenizer
    except Exception as e:
        json.dump(
            {
                "ok": False,
                "error": f"Missing Python dependencies. Install torch + transformers. Details: {e}",
            },
            sys.stdout,
            ensure_ascii=False,
        )
        return 1

    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
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

        json.dump({"ok": True, "text": out_text}, sys.stdout, ensure_ascii=False)
        return 0
    except Exception as e:
        eprint("mBART inference failed:", repr(e))
        json.dump({"ok": False, "error": str(e)}, sys.stdout, ensure_ascii=False)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())


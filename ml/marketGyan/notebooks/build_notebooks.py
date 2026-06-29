#!/usr/bin/env python3
"""Build readable Colab/Kaggle notebooks for NEPSE-Impact-500."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def markdown(text):
    return {
        "cell_type": "markdown",
        "metadata": {},
        "source": text.strip().splitlines(keepends=True),
    }


def code(text, tags=None):
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {"tags": tags or []},
        "outputs": [],
        "source": text.strip().splitlines(keepends=True),
    }


def notebook(cells):
    return {
        "cells": cells,
        "metadata": {
            "accelerator": "GPU",
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {"name": "python", "version": "3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }


LOAD_AND_FREEZE = """
from pathlib import Path
import json
import os
import sys

PROJECT = Path(os.getenv("MARKET_GYAN_PROJECT", "/content/marketGyan"))
DATA = PROJECT / "data/processed"
SPLITS = DATA / "splits"
OUTPUTS = PROJECT / "outputs"
sys.path.insert(0, str(PROJECT))

from market_gyan.dataset import (
    balanced_group_split,
    compact_qwen_label,
    dataset_readiness,
    read_jsonl,
    split_manifest,
    validate_dataset,
    write_jsonl,
)

gold_path = DATA / "nepse-impact-500.jsonl"
rows = read_jsonl(gold_path)
issues = validate_dataset(rows)
gate = dataset_readiness(rows)
print(json.dumps(gate, indent=2, ensure_ascii=False))
assert not issues, issues[:3]
assert gate["ready"], gate["errors"]

SPLITS.mkdir(parents=True, exist_ok=True)
manifest_path = SPLITS / "manifest.json"
if not manifest_path.exists():
    frozen = balanced_group_split(rows)
    for name, values in frozen.items():
        write_jsonl(SPLITS / f"{name}.jsonl", values)
    manifest_path.write_text(
        json.dumps(
            split_manifest(frozen, strategy="balanced"),
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
assert {item["id"] for item in manifest["assignments"]} == {row["id"] for row in rows}
group_splits = {}
for item in manifest["assignments"]:
    previous = group_splits.setdefault(item["duplicateGroupId"], item["split"])
    assert previous == item["split"], "Near-duplicate group crosses split boundaries"
print(manifest["counts"], manifest["sha256"])
"""


DISTRIBUTION_PLOTS = """
from collections import Counter
import matplotlib.pyplot as plt

def plot_counter(axis, counter, title, color, rotate=False):
    items = sorted(counter.items(), key=lambda item: str(item[0]))
    if not items:
        axis.text(0.5, 0.5, "No records", ha="center", va="center")
        axis.set_xticks([])
    else:
        labels, values = zip(*items)
        bars = axis.bar(list(labels), list(values), color=color)
        axis.bar_label(bars, padding=2, fontsize=8)
    axis.set_title(title)
    axis.grid(axis="y", alpha=0.2)
    if rotate:
        axis.tick_params(axis="x", rotation=65)

relevance = Counter(row["gold"]["relevance"] for row in rows)
languages = Counter(row["gold"]["language"] for row in rows)
events = Counter(row["gold"]["eventType"] for row in rows)
directions = Counter(
    row["gold"]["impactDirection"]
    for row in rows if row["gold"]["relevance"] != "not_relevant"
)

OUTPUTS.mkdir(parents=True, exist_ok=True)
fig, axes = plt.subplots(2, 2, figsize=(13, 8))
plot_counter(axes[0, 0], relevance, "Relevance", "#2563eb")
plot_counter(axes[0, 1], languages, "Language", "#0f766e")
plot_counter(axes[1, 0], events, "Event type", "#7c3aed", rotate=True)
plot_counter(axes[1, 1], directions, "Relevant-record direction", "#dc2626")
plt.tight_layout()
plt.savefig(OUTPUTS / "nepse_impact_distribution.png", dpi=160, bbox_inches="tight")
plt.show()
plt.close(fig)
"""


XLMR_CELLS = [
    markdown("""
# NEPSE-Impact-500: XLM-R and FinBERT Baselines

This notebook uses one frozen balanced 70/15/15 split. Exact and
near-duplicate groups stay together. It trains:

1. XLM-R relevance on all 500 records.
2. XLM-R impact direction on relevant records only.
3. ProsusAI/finbert impact direction on the English relevant subset.
"""),
    code("""
!pip install -q 'transformers>=4.51,<5' 'datasets>=3.2,<4' \
  'accelerate>=1.2,<2' 'scikit-learn>=1.5,<2' \
  'matplotlib>=3.9,<4' 'seaborn>=0.13,<1' 'tqdm>=4.66,<5'
""", ["setup"]),
    markdown("## 1. Load adjudicated data and freeze the common split"),
    code(LOAD_AND_FREEZE, ["data"]),
    code(DISTRIBUTION_PLOTS, ["plot"]),
    markdown("## 2. Load the frozen rows"),
    code("""
train_rows = read_jsonl(SPLITS / "train.jsonl")
validation_rows = read_jsonl(SPLITS / "validation.jsonl")
test_rows = read_jsonl(SPLITS / "test.jsonl")
print(len(train_rows), len(validation_rows), len(test_rows))
""", ["data"]),
    markdown("## 3. Small reusable trainer for the three classifier runs"),
    code("""
import shutil
import numpy as np
import torch
from collections import Counter
from datasets import Dataset
from sklearn.metrics import classification_report, confusion_matrix
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    DataCollatorWithPadding,
    EarlyStoppingCallback,
    Trainer,
    TrainingArguments,
    set_seed,
)

def train_classifier(name, model_name, task, labels, english_only=False):
    label_to_id = {label: index for index, label in enumerate(labels)}
    id_to_label = {index: label for label, index in label_to_id.items()}
    tokenizer = AutoTokenizer.from_pretrained(model_name)

    def keep(row):
        if english_only and row["gold"]["language"] != "en":
            return False
        if task == "direction" and row["gold"]["relevance"] == "not_relevant":
            return False
        target = "relevance" if task == "relevance" else "impactDirection"
        return row["gold"][target] in labels

    def prepare(values):
        filtered = [row for row in values if keep(row)]
        target = "relevance" if task == "relevance" else "impactDirection"
        dataset = Dataset.from_list([{
            "id": row["id"],
            "text": row["title"] + "\\n" + row["excerpt"],
            "label": label_to_id[row["gold"][target]],
        } for row in filtered])
        return dataset.map(
            lambda batch: tokenizer(
                batch["text"], truncation=True, max_length=512
            ),
            batched=True,
        )

    train_data = prepare(train_rows)
    validation_data = prepare(validation_rows)
    test_data = prepare(test_rows)
    print(
        f"Training {name}: train={len(train_data)}, "
        f"validation={len(validation_data)}, test={len(test_data)}, "
        f"labels={labels}"
    )
    counts = Counter(train_data["label"])
    weights = torch.tensor([
        len(train_data) / float(len(labels) * max(counts.get(i, 0), 1))
        for i in range(len(labels))
    ])
    model = AutoModelForSequenceClassification.from_pretrained(
        model_name,
        num_labels=len(labels),
        id2label=id_to_label,
        label2id=label_to_id,
        ignore_mismatched_sizes=True,
    )

    class WeightedTrainer(Trainer):
        def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
            expected = inputs.pop("labels")
            output = model(**inputs)
            loss = torch.nn.functional.cross_entropy(
                output.logits, expected, weight=weights.to(output.logits.device)
            )
            return (loss, output) if return_outputs else loss

    def compute_metrics(prediction):
        predicted = prediction.predictions.argmax(axis=-1)
        report = classification_report(
            prediction.label_ids,
            predicted,
            labels=list(range(len(labels))),
            target_names=labels,
            output_dict=True,
            zero_division=0,
        )
        return {"macro_f1": report["macro avg"]["f1-score"]}

    output_dir = OUTPUTS / name
    arguments = TrainingArguments(
        output_dir=str(output_dir),
        learning_rate=2e-5,
        per_device_train_batch_size=8,
        per_device_eval_batch_size=16,
        num_train_epochs=8,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        load_best_model_at_end=True,
        metric_for_best_model="macro_f1",
        report_to=[],
        seed=42,
        disable_tqdm=False,
        logging_strategy="steps",
        logging_steps=10,
    )
    trainer = WeightedTrainer(
        model=model,
        args=arguments,
        train_dataset=train_data,
        eval_dataset=validation_data,
        tokenizer=tokenizer,
        data_collator=DataCollatorWithPadding(tokenizer),
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)],
    )
    checkpoints = sorted(output_dir.glob("checkpoint-*")) if output_dir.exists() else []
    trainer.train(resume_from_checkpoint=str(checkpoints[-1]) if checkpoints else None)
    result = trainer.predict(test_data)
    truth = result.label_ids
    predicted = result.predictions.argmax(axis=-1)
    report = classification_report(
        truth, predicted, labels=list(range(len(labels))),
        target_names=labels, output_dict=True, zero_division=0
    )
    predictions = [{
        "id": test_data[index]["id"],
        "expected": id_to_label[int(truth[index])],
        "predicted": id_to_label[int(predicted[index])],
    } for index in range(len(test_data))]
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "metrics.json").write_text(json.dumps(report, indent=2))
    (output_dir / "predictions.json").write_text(json.dumps(predictions, indent=2))
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)
    for checkpoint in output_dir.glob("checkpoint-*"):
        shutil.rmtree(checkpoint, ignore_errors=True)
    return trainer, report, truth, predicted, labels, output_dir
""", ["gpu"]),
    markdown("## 4. Train XLM-R relevance"),
    code("""
set_seed(42)
relevance_run = train_classifier(
    "xlmr-relevance",
    "xlm-roberta-base",
    "relevance",
    ["direct", "indirect", "not_relevant"],
)
""", ["gpu"]),
    markdown("## 5. Train XLM-R direction on relevant records"),
    code("""
direction_run = train_classifier(
    "xlmr-direction",
    "xlm-roberta-base",
    "direction",
    ["bullish", "bearish", "neutral", "uncertain"],
)
""", ["gpu"]),
    markdown("## 6. Train the English-only FinBERT baseline"),
    code("""
finbert_run = train_classifier(
    "finbert-english-direction",
    "ProsusAI/finbert",
    "direction",
    ["bullish", "bearish", "neutral"],
    english_only=True,
)
""", ["gpu"]),
    markdown("## 7. Plot confusion matrices, class F1, and loss"),
    code("""
import seaborn as sns

for name, run in {
    "xlmr_relevance": relevance_run,
    "xlmr_direction": direction_run,
    "finbert_direction": finbert_run,
}.items():
    trainer, report, truth, predicted, labels, output_dir = run
    matrix = confusion_matrix(truth, predicted, labels=list(range(len(labels))))
    history = trainer.state.log_history
    fig, axes = plt.subplots(1, 3, figsize=(15, 4))
    sns.heatmap(
        matrix, annot=True, fmt="d", cmap="Blues", ax=axes[0],
        xticklabels=labels, yticklabels=labels
    )
    axes[0].set_title(f"{name} confusion matrix")
    bars = axes[1].bar(list(labels), [report[label]["f1-score"] for label in labels])
    axes[1].bar_label(bars, fmt="%.2f", padding=2, fontsize=8)
    axes[1].set_ylim(0, 1)
    axes[1].set_title("Per-class F1")
    train_steps = [row["step"] for row in history if "loss" in row]
    train_loss = [row["loss"] for row in history if "loss" in row]
    eval_steps = [row["step"] for row in history if "eval_loss" in row]
    eval_loss = [row["eval_loss"] for row in history if "eval_loss" in row]
    if train_steps:
        axes[2].plot(train_steps, train_loss, label="train")
    if eval_steps:
        axes[2].plot(eval_steps, eval_loss, label="validation")
    axes[2].set_title("Loss")
    axes[2].legend()
    plt.tight_layout()
    plt.savefig(output_dir / "results.png", dpi=160, bbox_inches="tight")
    plt.show()
    plt.close(fig)
""", ["gpu", "plot"]),
    markdown("## 8. Archive the three baselines"),
    code("""
import shutil
import tempfile
from pathlib import Path

archive_base = PROJECT / "nepse-impact-baselines"
archive_path = archive_base.with_suffix(".zip")
if archive_path.exists():
    archive_path.unlink()

with tempfile.TemporaryDirectory() as directory:
    staging = Path(directory) / "nepse-impact-baselines"
    staging.mkdir(parents=True, exist_ok=True)
    for name in ("xlmr-relevance", "xlmr-direction", "finbert-direction"):
        source = OUTPUTS / name
        if not source.exists():
            continue
        target = staging / name
        shutil.copytree(source, target)
        for checkpoint in target.glob("checkpoint-*"):
            shutil.rmtree(checkpoint, ignore_errors=True)
    archive = shutil.make_archive(
        str(archive_base),
        "zip",
        staging,
    )
print(archive)
# Colab: from google.colab import files; files.download(archive)
""", ["artifact"]),
]


QWEN_CELLS = [
    markdown("""
# NEPSE-Impact-500: Configurable Qwen Unsloth LoRA

This notebook evaluates a base Qwen zero-shot and three-shot, then trains a
LoRA adapter with Unsloth on the same frozen balanced manifest used by XLM-R.
The default next experiment is Qwen3.5-9B with bf16 LoRA when the runtime has
enough VRAM. On an A100 40 GB runtime, source
`config/qwen35_9b_a100_40gb_bf16.env` before opening this notebook. Set
`MARKET_GYAN_LOAD_IN_4BIT=true` only for low-memory diagnostic runs because
Qwen3.5 4-bit training is less reliable than bf16 LoRA.
The A100 profile writes to `marketgyan-qwen35-9b-a100-40gb-bf16-lora`.

It produces compact deterministic JSON and evaluates relevance, event type,
direction, sector, symbol, and evidence selection.
"""),
    code("""
!pip install -q --upgrade --force-reinstall --no-cache-dir unsloth unsloth_zoo
!pip install -q 'datasets>=3.2,<4' 'trl>=0.15,<1' \
  'matplotlib>=3.9,<4' 'seaborn>=0.13,<1' 'tqdm>=4.66,<5' \
  'openai>=1.50,<2'
""", ["setup"]),
    code("""
!pip install -q --upgrade --force-reinstall "numpy>=1.26.4,<1.28" "urllib3<=2.5.0"
!pip check
""", ["setup"]),
    markdown("## 1. Verify the GPU and load the frozen corpus"),
    code("""
import torch
import json
import os
from pathlib import Path
assert torch.cuda.is_available(), "Use a Colab or Kaggle GPU runtime."
gpu = torch.cuda.get_device_properties(0)
gpu_name = torch.cuda.get_device_name(0)

def load_export_env(path):
    path = Path(path)
    if not path.exists():
        print(f"Profile env file not found, skipping: {path}")
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    print(f"Loaded MarketGyan profile: {path}")

PROJECT_FOR_PROFILE = Path(os.getenv("MARKET_GYAN_PROJECT", "/content/marketGyan"))
PROFILE_ENV = os.getenv("MARKET_GYAN_PROFILE_ENV", "").strip()
if not PROFILE_ENV and "A100" in gpu_name:
    candidate = PROJECT_FOR_PROFILE / "config/qwen35_9b_a100_40gb_bf16.env"
    if candidate.exists():
        PROFILE_ENV = str(candidate)
if PROFILE_ENV:
    load_export_env(PROFILE_ENV)
if os.getenv("MARKET_GYAN_ENABLE_TF32", "true").lower() in {"1", "true", "yes"}:
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
print(json.dumps({
    "gpu": gpu_name,
    "totalMemoryGB": round(gpu.total_memory / 1024 ** 3, 2),
    "bf16Supported": torch.cuda.is_bf16_supported(),
    "tf32Enabled": torch.backends.cuda.matmul.allow_tf32,
}, indent=2))
if os.getenv("MARKET_GYAN_EXPECT_A100", "false").lower() in {"1", "true", "yes"}:
    assert "A100" in gpu_name, f"Expected an A100 runtime, got {gpu_name}"
""", ["gpu"]),
    code(LOAD_AND_FREEZE, ["data"]),
    code("""
train_rows = read_jsonl(SPLITS / "train.jsonl")
validation_rows = read_jsonl(SPLITS / "validation.jsonl")
test_rows = read_jsonl(SPLITS / "test.jsonl")
print(len(train_rows), len(validation_rows), len(test_rows))
""", ["data"]),
    code(DISTRIBUTION_PLOTS, ["plot"]),
    markdown("## 2. Load Qwen through Unsloth and define the structured prompt"),
    code("""
import re
from unsloth import FastLanguageModel
from market_gyan.structured_output import compact_qwen_response_format

MODEL_NAME = os.getenv("MARKET_GYAN_QWEN_MODEL", "Qwen/Qwen3.5-9B")
MAX_SEQ_LENGTH = int(os.getenv("MARKET_GYAN_MAX_SEQ_LENGTH", "1536"))
MAX_GENERATION_TOKENS = int(os.getenv("MARKET_GYAN_MAX_GENERATION_TOKENS", "192"))
MAX_PROMPT_TOKENS = MAX_SEQ_LENGTH - MAX_GENERATION_TOKENS
LOAD_IN_4BIT = (
    os.getenv("MARKET_GYAN_LOAD_IN_4BIT", "false").lower()
    in {"1", "true", "yes"}
)
use_bf16 = torch.cuda.is_bf16_supported()

def slugify_model_name(value):
    base = value.split("/")[-1].lower()
    return re.sub(r"[^a-z0-9]+", "-", base).strip("-")

def default_output_run_name(model_name, model_tag, load_in_4bit):
    if model_name == "Qwen/Qwen3.5-9B" and not load_in_4bit:
        return "marketgyan-qwen35-9b-l4-bf16-lora"
    suffix = "unsloth-qlora" if load_in_4bit else "unsloth-lora"
    return f"marketgyan-{model_tag}-{suffix}"

MODEL_TAG = os.getenv("MARKET_GYAN_MODEL_TAG", slugify_model_name(MODEL_NAME))
OUTPUT_RUN_NAME = os.getenv(
    "MARKET_GYAN_OUTPUT_NAME",
    default_output_run_name(MODEL_NAME, MODEL_TAG, LOAD_IN_4BIT),
)
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_NAME,
    max_seq_length=MAX_SEQ_LENGTH,
    dtype=None,
    load_in_4bit=LOAD_IN_4BIT,
    load_in_16bit=not LOAD_IN_4BIT,
)
text_tokenizer = getattr(tokenizer, "tokenizer", tokenizer)
if getattr(text_tokenizer, "pad_token", None) is None:
    text_tokenizer.pad_token = text_tokenizer.eos_token
text_tokenizer.model_max_length = MAX_SEQ_LENGTH
output_dir = OUTPUTS / OUTPUT_RUN_NAME
USE_VLLM_CONSTRAINED = (
    os.getenv("MARKET_GYAN_USE_VLLM_CONSTRAINED", "false").lower()
    in {"1", "true", "yes"}
)
VLLM_BASE_URL = os.getenv("MARKET_GYAN_VLLM_BASE_URL", "http://127.0.0.1:8000/v1")
VLLM_API_KEY = os.getenv("MARKET_GYAN_VLLM_API_KEY", "local")
VLLM_MODEL = os.getenv("MARKET_GYAN_VLLM_MODEL", OUTPUT_RUN_NAME)
print(json.dumps({
    "model": MODEL_NAME,
    "output": str(output_dir),
    "maxSeqLength": MAX_SEQ_LENGTH,
    "maxGenerationTokens": MAX_GENERATION_TOKENS,
    "loadIn4bit": LOAD_IN_4BIT,
    "bf16": use_bf16,
}, indent=2))

COMPACT_SCHEMA_INSTRUCTIONS = (
    "Return only valid compact JSON. Do not use markdown. Do not explain. "
    "Allowed relevance: direct, indirect, not_relevant. "
    "Allowed eventType: market_trading, earnings, capital_action, governance, "
    "project_operations, credit_financing, regulation, monetary_liquidity, "
    "fiscal_macroeconomic, sector_industry, other, not_applicable. "
    "Allowed impactScope: company, sector, market, none. "
    "Allowed impactDirection: bullish, bearish, neutral, uncertain, not_applicable. "
    "Allowed impactHorizon: immediate, short_term, medium_term, not_applicable. "
    "Allowed impactMechanism: earnings_cash_flow, ownership_supply, "
    "financing_liquidity, regulation, demand_revenue, operations_capacity, "
    "valuation_sentiment, market_flow, uncertain, none. "
    "Allowed confidenceBand: low, medium, high. "
    "Required keys: relevance, eventType, impactScope, impactDirection, "
    "impactHorizon, impactMechanism, sectors, symbols, confidenceBand, "
    "evidenceSentenceIds. For not_relevant use eventType=not_applicable, "
    "impactScope=none, impactDirection=not_applicable, "
    "impactHorizon=not_applicable, impactMechanism=none, sectors=[], symbols=[]. "
    "Use only numbered evidenceSentenceIds from the source."
)

def prompt_for(row):
    numbered = "\\n".join(
        f"[{sentence['id']}] {sentence['text']}"
        for sentence in row["sentences"]
    )
    return (
        f"{COMPACT_SCHEMA_INSTRUCTIONS}\\n"
        f"Title: {row['title']}\\n{numbered}"
    )
""", ["gpu"]),
    markdown("## 3. Base-model zero-shot and three-shot evaluation"),
    code("""
import copy
from tqdm.auto import tqdm

def chat_messages_for(row, demonstrations=None):
    messages = []
    for example in demonstrations or []:
        messages += [
            {"role": "user", "content": prompt_for(example)},
            {
                "role": "assistant",
                "content": json.dumps(
                    compact_qwen_label(example["gold"]),
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            },
        ]
    messages.append({"role": "user", "content": prompt_for(row)})
    return messages

def render_chat_template(messages, add_generation_prompt):
    template_source = (
        tokenizer
        if hasattr(tokenizer, "apply_chat_template")
        else text_tokenizer
    )
    return template_source.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=add_generation_prompt,
        enable_thinking=False,
    )

def generation_pad_token_id():
    for candidate in (text_tokenizer, tokenizer):
        token_id = getattr(candidate, "eos_token_id", None)
        if token_id is not None:
            return token_id
    return getattr(model.config, "eos_token_id", None)

def tokenize_generation_prompt(text):
    previous_side = getattr(text_tokenizer, "truncation_side", None)
    if previous_side is not None:
        text_tokenizer.truncation_side = "left"
    try:
        encoded = text_tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=MAX_PROMPT_TOKENS,
        )
    finally:
        if previous_side is not None:
            text_tokenizer.truncation_side = previous_side
    return encoded.to(model.device)

def generate_json(row, demonstrations=None):
    messages = chat_messages_for(row, demonstrations)
    text = render_chat_template(messages, add_generation_prompt=True)
    # Prefixing the first JSON brace prevents Qwen from starting with Markdown
    # bullets while keeping official scoring strict.
    text = text + "{"
    inputs = tokenize_generation_prompt(text)
    generation_config = copy.deepcopy(model.generation_config)
    generation_config.max_length = None
    generation_config.max_new_tokens = None
    with torch.no_grad():
        output = model.generate(
            **inputs,
            generation_config=generation_config,
            max_new_tokens=MAX_GENERATION_TOKENS,
            do_sample=False,
            temperature=None,
            top_p=None,
            repetition_penalty=1.05,
            pad_token_id=generation_pad_token_id(),
        )
    raw = text_tokenizer.decode(
        output[0][inputs["input_ids"].shape[1]:],
        skip_special_tokens=True,
    ).strip()
    raw = "{" + raw
    if raw.startswith("{{"):
        raw = raw[1:]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(raw[start:end + 1])
            except json.JSONDecodeError:
                pass
        return {"raw": raw}

def generate_json_constrained(row, demonstrations=None):
    from openai import OpenAI

    client = OpenAI(base_url=VLLM_BASE_URL, api_key=VLLM_API_KEY)
    response = client.chat.completions.create(
        model=VLLM_MODEL,
        messages=chat_messages_for(row, demonstrations),
        temperature=0,
        max_tokens=MAX_GENERATION_TOKENS,
        response_format=compact_qwen_response_format(row.get("sentences", [])),
    )
    raw = response.choices[0].message.content or ""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw}

three_shot_examples = [
    next(row for row in train_rows if row["gold"]["relevance"] == value)
    for value in ("direct", "indirect", "not_relevant")
]
zero_shot = []
for row in tqdm(test_rows, desc="Qwen zero-shot", unit="doc"):
    zero_shot.append({"id": row["id"], "prediction": generate_json(row)})

three_shot = []
for row in tqdm(test_rows, desc="Qwen three-shot", unit="doc"):
    three_shot.append({
        "id": row["id"],
        "prediction": generate_json(row, three_shot_examples),
    })
output_dir.mkdir(parents=True, exist_ok=True)
write_jsonl(output_dir / "qwen_base_zero_shot.jsonl", zero_shot)
write_jsonl(output_dir / "qwen_base_three_shot.jsonl", three_shot)

constrained_zero_shot = []
constrained_three_shot = []
if USE_VLLM_CONSTRAINED:
    print(f"Running constrained Qwen through {VLLM_BASE_URL} model={VLLM_MODEL}")
    for row in tqdm(test_rows, desc="Qwen constrained zero-shot", unit="doc"):
        constrained_zero_shot.append({
            "id": row["id"],
            "prediction": generate_json_constrained(row),
        })
    for row in tqdm(test_rows, desc="Qwen constrained three-shot", unit="doc"):
        constrained_three_shot.append({
            "id": row["id"],
            "prediction": generate_json_constrained(row, three_shot_examples),
        })
    write_jsonl(
        output_dir / "qwen_vllm_constrained_zero_shot.jsonl",
        constrained_zero_shot,
    )
    write_jsonl(
        output_dir / "qwen_vllm_constrained_three_shot.jsonl",
        constrained_three_shot,
    )
else:
    print(
        "Skipping vLLM constrained decoding. Set "
        "MARKET_GYAN_USE_VLLM_CONSTRAINED=true after serving Qwen through "
        "an OpenAI-compatible vLLM endpoint."
    )
""", ["gpu"]),
    markdown("## 4. Format compact gold JSON for supervised fine-tuning"),
    code("""
from datasets import Dataset

def chat_messages(row):
    return [
        {"role": "user", "content": prompt_for(row)},
        {
            "role": "assistant",
            "content": json.dumps(
                compact_qwen_label(row["gold"]),
                ensure_ascii=False,
                sort_keys=True,
            ),
        },
    ]

def format_training_text(row):
    return render_chat_template(
        chat_messages(row),
        add_generation_prompt=False,
    )

def oversample_training_rows(values):
    selected = list(values)
    selected.extend(
        row for row in values
        if row["gold"]["language"] == "ne"
    )
    selected.extend(
        row for row in values
        if row["gold"]["relevance"] in {"indirect", "not_relevant"}
    )
    selected.extend(
        row for row in values
        if (
            row["gold"]["relevance"] in {"indirect", "not_relevant"}
            and row["gold"]["language"] == "ne"
        )
    )
    return selected

def make_dataset(values, include_hard_negatives=True, oversample=False):
    selected = values if include_hard_negatives else [
        row for row in values if row["gold"]["relevance"] != "not_relevant"
    ]
    if oversample:
        selected = oversample_training_rows(selected)
    return Dataset.from_list([
        {"text": format_training_text(row)}
        for row in selected
    ])

train_data = make_dataset(train_rows, oversample=True)
validation_data = make_dataset(validation_rows)
print(len(train_data), len(validation_data))
print(train_data[0]["text"][:600])
""", ["gpu"]),
    markdown("## 5. Attach Unsloth LoRA and train or resume"),
    code("""
from transformers import set_seed
from trl import SFTConfig, SFTTrainer
from unsloth.chat_templates import train_on_responses_only

LORA_R = int(os.getenv("MARKET_GYAN_LORA_R", "16"))
LORA_ALPHA = int(os.getenv("MARKET_GYAN_LORA_ALPHA", str(LORA_R * 2)))
LORA_DROPOUT = float(os.getenv("MARKET_GYAN_LORA_DROPOUT", "0.05"))
PER_DEVICE_TRAIN_BATCH_SIZE = int(
    os.getenv("MARKET_GYAN_PER_DEVICE_TRAIN_BATCH_SIZE", "1")
)
PER_DEVICE_EVAL_BATCH_SIZE = int(
    os.getenv("MARKET_GYAN_PER_DEVICE_EVAL_BATCH_SIZE", "1")
)
GRADIENT_ACCUMULATION_STEPS = int(
    os.getenv("MARKET_GYAN_GRADIENT_ACCUMULATION_STEPS", "16")
)
LEARNING_RATE = float(
    os.getenv(
        "MARKET_GYAN_LEARNING_RATE",
        "1e-4" if LOAD_IN_4BIT else "5e-5",
    )
)
NUM_TRAIN_EPOCHS = float(os.getenv("MARKET_GYAN_EPOCHS", "3"))
EVAL_STEPS = int(os.getenv("MARKET_GYAN_EVAL_STEPS", "25"))
LOGGING_STEPS = int(os.getenv("MARKET_GYAN_LOGGING_STEPS", "5"))
DATALOADER_NUM_WORKERS = int(os.getenv("MARKET_GYAN_DATALOADER_NUM_WORKERS", "0"))
DATASET_NUM_PROC = int(os.getenv("MARKET_GYAN_DATASET_NUM_PROC", "1"))
OPTIM = os.getenv("MARKET_GYAN_OPTIM", "paged_adamw_8bit")

model = FastLanguageModel.get_peft_model(
    model,
    r=LORA_R,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    lora_alpha=LORA_ALPHA,
    lora_dropout=LORA_DROPOUT,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=42,
    max_seq_length=MAX_SEQ_LENGTH,
)
set_seed(42)
output_dir = OUTPUTS / OUTPUT_RUN_NAME
updates_per_epoch = max(
    1,
    (
        len(train_data)
        + PER_DEVICE_TRAIN_BATCH_SIZE * GRADIENT_ACCUMULATION_STEPS
        - 1
    )
    // (PER_DEVICE_TRAIN_BATCH_SIZE * GRADIENT_ACCUMULATION_STEPS),
)
print(
    f"Training Unsloth LoRA: model={MODEL_NAME}, train={len(train_data)}, "
    f"validation={len(validation_data)}, "
    f"approx_steps={int(updates_per_epoch * NUM_TRAIN_EPOCHS)}, "
    f"lr={LEARNING_RATE}, train_batch={PER_DEVICE_TRAIN_BATCH_SIZE}, "
    f"grad_accum={GRADIENT_ACCUMULATION_STEPS}, load_in_4bit={LOAD_IN_4BIT}"
)
sft_kwargs = {
    "output_dir": str(output_dir),
    "dataset_text_field": "text",
    "max_seq_length": MAX_SEQ_LENGTH,
    "packing": False,
    "per_device_train_batch_size": PER_DEVICE_TRAIN_BATCH_SIZE,
    "per_device_eval_batch_size": PER_DEVICE_EVAL_BATCH_SIZE,
    "gradient_accumulation_steps": GRADIENT_ACCUMULATION_STEPS,
    "learning_rate": LEARNING_RATE,
    "num_train_epochs": NUM_TRAIN_EPOCHS,
    "warmup_ratio": 0.05,
    "logging_steps": LOGGING_STEPS,
    "eval_strategy": "steps",
    "eval_steps": EVAL_STEPS,
    "save_strategy": "no",
    "bf16": use_bf16,
    "fp16": not use_bf16,
    "optim": OPTIM,
    "report_to": [],
    "seed": 42,
    "disable_tqdm": False,
}
optional_sft_kwargs = {
    "dataloader_num_workers": DATALOADER_NUM_WORKERS,
    "dataloader_pin_memory": torch.cuda.is_available(),
}
if DATASET_NUM_PROC > 1:
    optional_sft_kwargs["dataset_num_proc"] = DATASET_NUM_PROC
supported_sft_fields = getattr(SFTConfig, "__dataclass_fields__", {})
for key, value in optional_sft_kwargs.items():
    if key in supported_sft_fields:
        sft_kwargs[key] = value
    else:
        print(f"Skipping unsupported SFTConfig option: {key}")
arguments = SFTConfig(**sft_kwargs)
trainer = SFTTrainer(
    model=model,
    tokenizer=text_tokenizer,
    args=arguments,
    train_dataset=train_data,
    eval_dataset=validation_data,
)

# Mask user tokens so the adapter learns only the reviewed JSON response.
trainer = train_on_responses_only(
    trainer,
    instruction_part="<|im_start|>user\\n",
    response_part="<|im_start|>assistant\\n",
)
import shutil
if output_dir.exists():
    for checkpoint in output_dir.glob("checkpoint-*"):
        shutil.rmtree(checkpoint, ignore_errors=True)
trainer.train()
trainer.save_model(output_dir)
if hasattr(tokenizer, "save_pretrained"):
    tokenizer.save_pretrained(output_dir)
else:
    text_tokenizer.save_pretrained(output_dir)
for checkpoint in output_dir.glob("checkpoint-*"):
    shutil.rmtree(checkpoint, ignore_errors=True)
""", ["gpu"]),
    markdown("## 6. Smoke-test strict JSON before full held-out generation"),
    code("""
from market_gyan.metrics import benchmark_predictions

FastLanguageModel.for_inference(model)
model.eval()
FAIL_ON_QWEN_SMOKE_GATE = (
    os.getenv("MARKET_GYAN_FAIL_ON_QWEN_SMOKE_GATE", "false").lower()
    in {"1", "true", "yes"}
)

def smoke_rows_for_generation(rows, limit=10):
    selected = []
    for language in ("ne", "en"):
        selected.extend([
            row for row in rows
            if row["gold"]["language"] == language
        ][:limit // 2])
    seen = {row["id"] for row in selected}
    selected.extend(row for row in rows if row["id"] not in seen)
    return selected[:limit]

smoke_rows = smoke_rows_for_generation(validation_rows, limit=10)
smoke_predictions = []
for row in tqdm(smoke_rows, desc="Qwen adapter smoke generation", unit="doc"):
    smoke_predictions.append({"id": row["id"], "prediction": generate_json(row)})
smoke_metrics = benchmark_predictions(smoke_rows, smoke_predictions)
write_jsonl(output_dir / "smoke_predictions.jsonl", smoke_predictions)
(output_dir / "smoke_metrics.json").write_text(
    json.dumps(smoke_metrics, indent=2), encoding="utf-8"
)
print(json.dumps({
    "strictValidity": smoke_metrics["structuredOutputValidity"],
    "evidenceGrounding": smoke_metrics["evidenceGrounding"],
    "invalidOutputCount": smoke_metrics["invalidOutputCount"],
}, indent=2))
if smoke_metrics["structuredOutputValidity"] < 0.8:
    print(json.dumps(
        smoke_metrics["invalidOutputExamples"],
        indent=2,
        ensure_ascii=False,
    ))
    message = (
        "Qwen adapter failed the strict smoke gate. Treat this as a failed "
        "structured-output run; do not claim deployment readiness. The notebook "
        "will continue so the full diagnostic artifacts are still written. Set "
        "MARKET_GYAN_FAIL_ON_QWEN_SMOKE_GATE=true only when you want this cell "
        "to stop a failed experiment."
    )
    if FAIL_ON_QWEN_SMOKE_GATE:
        raise RuntimeError(message)
    print(message)
""", ["gpu"]),
    markdown("## 7. Deterministic held-out generation with the adapter"),
    code("""
FastLanguageModel.for_inference(model)
adapter_predictions = []
for row in tqdm(test_rows, desc="Qwen adapter test generation", unit="doc"):
    adapter_predictions.append({"id": row["id"], "prediction": generate_json(row)})
write_jsonl(output_dir / "test_predictions.jsonl", adapter_predictions)
""", ["gpu"]),
    markdown("## 8. Score and plot all Qwen conditions"),
    code("""
import matplotlib.pyplot as plt
import seaborn as sns
from market_gyan.metrics import (
    benchmark_predictions,
    benchmark_predictions_with_repair,
    repair_prediction_rows,
)
from market_gyan.system_evaluation import qwen_model_gate

benchmarks = {
    "zero_shot": benchmark_predictions(test_rows, zero_shot),
    "three_shot": benchmark_predictions(test_rows, three_shot),
    "unsloth_qlora": benchmark_predictions(test_rows, adapter_predictions),
}
if constrained_zero_shot:
    benchmarks["vllm_constrained_zero_shot"] = benchmark_predictions(
        test_rows,
        constrained_zero_shot,
    )
if constrained_three_shot:
    benchmarks["vllm_constrained_three_shot"] = benchmark_predictions(
        test_rows,
        constrained_three_shot,
    )
repaired_adapter_predictions, repair_report = repair_prediction_rows(adapter_predictions)
benchmarks["unsloth_qlora_tolerant_diagnostic"] = benchmark_predictions_with_repair(
    test_rows,
    adapter_predictions,
)
write_jsonl(
    output_dir / "qwen_tolerant_diagnostic.jsonl",
    repaired_adapter_predictions,
)
(output_dir / "metrics.json").write_text(
    json.dumps(benchmarks, indent=2), encoding="utf-8"
)
GATE_CONDITION = os.getenv("MARKET_GYAN_QWEN_GATE_CONDITION", "").strip() or None
gate_report = qwen_model_gate(benchmarks, gate_condition=GATE_CONDITION)
(output_dir / "model_gate.json").write_text(
    json.dumps(gate_report, indent=2), encoding="utf-8"
)
print(json.dumps({
    "strictValidity": benchmarks["unsloth_qlora"]["structuredOutputValidity"],
    "strictGrounding": benchmarks["unsloth_qlora"]["evidenceGrounding"],
    "tolerantDiagnosticValidity": benchmarks[
        "unsloth_qlora_tolerant_diagnostic"
    ]["structuredOutputValidity"],
    "tolerantDiagnosticGrounding": benchmarks[
        "unsloth_qlora_tolerant_diagnostic"
    ]["evidenceGrounding"],
    "repairAppliedCount": repair_report["repairAppliedCount"],
    "officialGate": benchmarks[
        "unsloth_qlora_tolerant_diagnostic"
    ]["officialGate"],
    "gateEligible": gate_report["eligible"],
    "gateCondition": gate_report["gateCondition"],
}, indent=2))

labels = ["direct", "indirect", "not_relevant"]
matrix = [
    [benchmarks["unsloth_qlora"]["relevance"]["confusion"][actual][predicted]
     for predicted in labels]
    for actual in labels
]
quality_names = [
    "JSON validity", "grounding", "sector F1", "symbol F1", "evidence F1"
]
quality = [
    benchmarks["unsloth_qlora"]["structuredOutputValidity"],
    benchmarks["unsloth_qlora"]["evidenceGrounding"],
    benchmarks["unsloth_qlora"]["sectorMicroF1"],
    benchmarks["unsloth_qlora"]["symbolMicroF1"],
    benchmarks["unsloth_qlora"]["evidenceSentenceF1"],
]
fig, axes = plt.subplots(1, 3, figsize=(16, 4))
sns.heatmap(
    matrix, annot=True, fmt="d", cmap="Blues", ax=axes[0],
    xticklabels=labels, yticklabels=labels
)
axes[0].set_title("Relevance confusion matrix")
benchmark_names = [
    name for name in (
        "zero_shot",
        "three_shot",
        "vllm_constrained_zero_shot",
        "vllm_constrained_three_shot",
        "unsloth_qlora",
    )
    if name in benchmarks
]
bars = axes[1].bar(
    benchmark_names,
    [benchmarks[name]["relevance"]["macroF1"] for name in benchmark_names],
)
axes[1].bar_label(bars, fmt="%.2f", padding=2, fontsize=8)
axes[1].set_ylim(0, 1)
axes[1].set_title("Base versus Unsloth QLoRA relevance macro-F1")
bars = axes[2].barh(quality_names, quality)
axes[2].bar_label(bars, fmt="%.2f", padding=2, fontsize=8)
axes[2].set_xlim(0, 1)
axes[2].set_title("Structured-output quality")
plt.tight_layout()
plt.savefig(output_dir / "test_results.png", dpi=160, bbox_inches="tight")
plt.show()
plt.close(fig)
""", ["gpu", "plot"]),
    markdown("""
## 9. Required ablations

Run a second training job with `include_hard_negatives=False` in
`make_dataset(...)` and compare relevance macro-F1. The RAG-enabled versus
RAG-disabled ablation is run through the system evaluation harness because
current factual knowledge must remain outside model weights.
"""),
    code("""
history = trainer.state.log_history
fig, axis = plt.subplots(figsize=(7, 4))
train_steps = [row["step"] for row in history if "loss" in row]
train_loss = [row["loss"] for row in history if "loss" in row]
eval_steps = [row["step"] for row in history if "eval_loss" in row]
eval_loss = [row["eval_loss"] for row in history if "eval_loss" in row]
if train_steps:
    axis.plot(train_steps, train_loss, label="train")
if eval_steps:
    axis.plot(eval_steps, eval_loss, label="validation")
axis.set_title(f"{MODEL_TAG} Unsloth LoRA loss")
axis.legend()
plt.savefig(output_dir / "loss.png", dpi=160, bbox_inches="tight")
plt.show()
plt.close(fig)
""", ["gpu", "plot"]),
    markdown("## 10. Archive final adapter, predictions, metrics, and plots"),
    code("""
import shutil
archive = shutil.make_archive(str(output_dir), "zip", output_dir)
print(archive)
# Colab: from google.colab import files; files.download(archive)
""", ["artifact"]),
]


def main():
    for name, value in {
        "xlmr_baseline.ipynb": notebook(XLMR_CELLS),
        "qwen3_8b_qlora.ipynb": notebook(QWEN_CELLS),
    }.items():
        (ROOT / name).write_text(
            json.dumps(value, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(name)


if __name__ == "__main__":
    main()

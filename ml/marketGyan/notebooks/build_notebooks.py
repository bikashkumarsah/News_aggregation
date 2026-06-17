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
    chronological_group_split,
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
    frozen = chronological_group_split(rows)
    for name, values in frozen.items():
        write_jsonl(SPLITS / f"{name}.jsonl", values)
    manifest_path.write_text(
        json.dumps(split_manifest(frozen), indent=2, ensure_ascii=False),
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

This notebook uses one frozen chronological 70/15/15 split. Exact and
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
archive = shutil.make_archive(
    str(OUTPUTS / "nepse-impact-baselines"),
    "zip",
    OUTPUTS,
)
print(archive)
# Colab: from google.colab import files; files.download(archive)
""", ["artifact"]),
]


QWEN_CELLS = [
    markdown("""
# NEPSE-Impact-500: Qwen3-8B Unsloth QLoRA

This notebook evaluates base Qwen3-8B zero-shot and three-shot, then trains a
QLoRA adapter with Unsloth on the same frozen manifest used by XLM-R. It
produces deterministic structured JSON and evaluates relevance, event type,
direction, sector, symbol, and evidence selection.
"""),
    code("""
!pip install -q --upgrade --force-reinstall --no-cache-dir unsloth unsloth_zoo
!pip install -q 'datasets>=3.2,<4' 'trl>=0.15,<1' \
  'matplotlib>=3.9,<4' 'seaborn>=0.13,<1' 'tqdm>=4.66,<5'
""", ["setup"]),
    markdown("## 1. Verify the GPU and load the frozen corpus"),
    code("""
import torch
assert torch.cuda.is_available(), "Use a Colab or Kaggle GPU runtime."
print(torch.cuda.get_device_name(0))
""", ["gpu"]),
    code(LOAD_AND_FREEZE, ["data"]),
    code("""
train_rows = read_jsonl(SPLITS / "train.jsonl")
validation_rows = read_jsonl(SPLITS / "validation.jsonl")
test_rows = read_jsonl(SPLITS / "test.jsonl")
print(len(train_rows), len(validation_rows), len(test_rows))
""", ["data"]),
    code(DISTRIBUTION_PLOTS, ["plot"]),
    markdown("## 2. Load Qwen3 through Unsloth and define the structured prompt"),
    code("""
from unsloth import FastLanguageModel

MODEL_NAME = "unsloth/Qwen3-8B"
MAX_SEQ_LENGTH = 1024
use_bf16 = torch.cuda.is_bf16_supported()
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_NAME,
    max_seq_length=MAX_SEQ_LENGTH,
    dtype=None,
    load_in_4bit=True,
)
tokenizer.pad_token = tokenizer.eos_token

def prompt_for(row):
    numbered = "\\n".join(
        f"[{sentence['id']}] {sentence['text']}"
        for sentence in row["sentences"]
    )
    return (
        "Return one NEPSE-Impact-500 JSON object. First classify relevance. "
        "Use only numbered evidence sentence IDs. Do not predict prices or "
        "give investment advice.\\n"
        f"Title: {row['title']}\\n{numbered}"
    )
""", ["gpu"]),
    markdown("## 3. Base-model zero-shot and three-shot evaluation"),
    code("""
from tqdm.auto import tqdm

def generate_json(row, demonstrations=None):
    messages = []
    for example in demonstrations or []:
        messages += [
            {"role": "user", "content": prompt_for(example)},
            {
                "role": "assistant",
                "content": json.dumps(
                    example["gold"], ensure_ascii=False, sort_keys=True
                ),
            },
        ]
    messages.append({"role": "user", "content": prompt_for(row)})
    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    inputs = tokenizer(text, return_tensors="pt").to(model.device)
    with torch.no_grad():
        output = model.generate(
            **inputs, max_new_tokens=512, do_sample=False,
            temperature=None, top_p=None
        )
    raw = tokenizer.decode(
        output[0][inputs["input_ids"].shape[1]:],
        skip_special_tokens=True,
    ).strip()
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
write_jsonl(OUTPUTS / "qwen_base_zero_shot.jsonl", zero_shot)
write_jsonl(OUTPUTS / "qwen_base_three_shot.jsonl", three_shot)
""", ["gpu"]),
    markdown("## 4. Format gold JSON for supervised fine-tuning"),
    code("""
from datasets import Dataset

def chat_messages(row):
    return [
        {"role": "user", "content": prompt_for(row)},
        {
            "role": "assistant",
            "content": json.dumps(row["gold"], ensure_ascii=False, sort_keys=True),
        },
    ]

def format_training_text(row):
    return tokenizer.apply_chat_template(
        chat_messages(row),
        tokenize=False,
        add_generation_prompt=False,
        enable_thinking=False,
    )

def make_dataset(values, include_hard_negatives=True):
    selected = values if include_hard_negatives else [
        row for row in values if row["gold"]["relevance"] != "not_relevant"
    ]
    return Dataset.from_list([
        {"text": format_training_text(row)}
        for row in selected
    ])

train_data = make_dataset(train_rows)
validation_data = make_dataset(validation_rows)
print(len(train_data), len(validation_data))
print(train_data[0]["text"][:600])
""", ["gpu"]),
    markdown("## 5. Attach Unsloth LoRA and train or resume"),
    code("""
from transformers import set_seed
from trl import SFTConfig, SFTTrainer
from unsloth.chat_templates import train_on_responses_only

model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    lora_alpha=32,
    lora_dropout=0.05,
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=42,
)
set_seed(42)
output_dir = OUTPUTS / "marketgyan-qwen3-8b-unsloth-qlora"
updates_per_epoch = max(1, (len(train_data) + 15) // 16)
print(
    f"Training Unsloth QLoRA: train={len(train_data)}, "
    f"validation={len(validation_data)}, approx_steps={updates_per_epoch * 3}"
)
arguments = SFTConfig(
    output_dir=str(output_dir),
    dataset_text_field="text",
    max_seq_length=MAX_SEQ_LENGTH,
    packing=False,
    per_device_train_batch_size=1,
    per_device_eval_batch_size=1,
    gradient_accumulation_steps=16,
    learning_rate=2e-4,
    num_train_epochs=3,
    warmup_ratio=0.05,
    logging_steps=5,
    eval_strategy="steps",
    eval_steps=25,
    save_strategy="no",
    bf16=use_bf16,
    fp16=not use_bf16,
    optim="paged_adamw_8bit",
    report_to=[],
    seed=42,
    disable_tqdm=False,
)
trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
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
tokenizer.save_pretrained(output_dir)
for checkpoint in output_dir.glob("checkpoint-*"):
    shutil.rmtree(checkpoint, ignore_errors=True)
""", ["gpu"]),
    markdown("## 6. Deterministic held-out generation with the adapter"),
    code("""
FastLanguageModel.for_inference(model)
adapter_predictions = []
for row in tqdm(test_rows, desc="Qwen adapter test generation", unit="doc"):
    adapter_predictions.append({"id": row["id"], "prediction": generate_json(row)})
write_jsonl(output_dir / "test_predictions.jsonl", adapter_predictions)
""", ["gpu"]),
    markdown("## 7. Score and plot all Qwen conditions"),
    code("""
import matplotlib.pyplot as plt
import seaborn as sns
from market_gyan.metrics import benchmark_predictions

benchmarks = {
    "zero_shot": benchmark_predictions(test_rows, zero_shot),
    "three_shot": benchmark_predictions(test_rows, three_shot),
    "unsloth_qlora": benchmark_predictions(test_rows, adapter_predictions),
}
(output_dir / "metrics.json").write_text(
    json.dumps(benchmarks, indent=2), encoding="utf-8"
)

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
benchmark_names = list(benchmarks.keys())
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
## 8. Required ablations

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
axis.set_title("Qwen3-8B Unsloth QLoRA loss")
axis.legend()
plt.savefig(output_dir / "loss.png", dpi=160, bbox_inches="tight")
plt.show()
plt.close(fig)
""", ["gpu", "plot"]),
    markdown("## 9. Archive final adapter, predictions, metrics, and plots"),
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

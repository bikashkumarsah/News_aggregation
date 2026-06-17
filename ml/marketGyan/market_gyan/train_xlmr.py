import argparse
import json
import shutil
from collections import Counter
from pathlib import Path

TASK_LABELS = {
    "relevance": ["direct", "indirect", "not_relevant"],
    "direction": ["bullish", "bearish", "neutral", "uncertain"],
}


def build_text(row):
    return "%s\n%s" % (row["title"], row["excerpt"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", required=True)
    parser.add_argument("--validation", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="xlm-roberta-base")
    parser.add_argument("--task", choices=sorted(TASK_LABELS), default="relevance")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    from datasets import Dataset
    import torch
    from transformers import (
        AutoModelForSequenceClassification,
        AutoTokenizer,
        DataCollatorWithPadding,
        EarlyStoppingCallback,
        Trainer,
        TrainingArguments,
        set_seed,
    )
    from .dataset import read_jsonl
    from .metrics import classification_metrics

    set_seed(args.seed)
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    labels = TASK_LABELS[args.task]
    label_to_id = {label: index for index, label in enumerate(labels)}

    def prepare(path):
        rows = read_jsonl(path)
        if args.task == "direction":
            rows = [
                row for row in rows
                if row["gold"]["relevance"] != "not_relevant"
            ]
        return Dataset.from_list([{
            "text": build_text(row),
            "label": label_to_id[
                row["gold"][
                    "relevance" if args.task == "relevance"
                    else "impactDirection"
                ]
            ],
        } for row in rows])

    train_data = prepare(args.train)
    validation_data = prepare(args.validation)
    counts = Counter(train_data["label"])
    class_weights = torch.tensor([
        len(train_data) / float(len(labels) * max(counts.get(label, 0), 1))
        for label in range(len(labels))
    ])

    def tokenize(batch):
        return tokenizer(batch["text"], truncation=True, max_length=512)

    train_data = train_data.map(tokenize, batched=True)
    validation_data = validation_data.map(tokenize, batched=True)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model,
        num_labels=len(labels),
        id2label={value: key for key, value in label_to_id.items()},
        label2id=label_to_id,
    )

    def compute_metrics(prediction):
        predicted = prediction.predictions.argmax(axis=-1).tolist()
        expected = prediction.label_ids.tolist()
        id_to_label = {value: key for key, value in label_to_id.items()}
        metrics = classification_metrics(
            [id_to_label[value] for value in expected],
            [id_to_label[value] for value in predicted],
            labels,
        )
        flattened = {
            "accuracy": metrics["accuracy"],
            "macroF1": metrics["macroF1"],
        }
        for label, values in metrics["perClass"].items():
            for metric_name in ("precision", "recall", "f1"):
                flattened["%s_%s" % (label, metric_name)] = values[metric_name]
        return flattened

    output = Path(args.output)
    training_args = TrainingArguments(
        output_dir=str(output),
        learning_rate=2e-5,
        per_device_train_batch_size=8,
        per_device_eval_batch_size=16,
        num_train_epochs=8,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        load_best_model_at_end=True,
        metric_for_best_model="macroF1",
        greater_is_better=True,
        seed=args.seed,
        report_to=[],
    )
    class WeightedTrainer(Trainer):
        def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
            labels = inputs.pop("labels")
            outputs = model(**inputs)
            loss = torch.nn.functional.cross_entropy(
                outputs.logits,
                labels,
                weight=class_weights.to(outputs.logits.device),
            )
            return (loss, outputs) if return_outputs else loss

    trainer = WeightedTrainer(
        model=model,
        args=training_args,
        train_dataset=train_data,
        eval_dataset=validation_data,
        tokenizer=tokenizer,
        data_collator=DataCollatorWithPadding(tokenizer),
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)],
    )
    trainer.train(resume_from_checkpoint=True if list(output.glob("checkpoint-*")) else None)
    metrics = trainer.evaluate()
    trainer.save_model()
    for checkpoint in output.glob("checkpoint-*"):
        shutil.rmtree(checkpoint, ignore_errors=True)
    (output / "metrics.json").write_text(
        json.dumps(metrics, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

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
    # Held-out test set kept separate from validation so bias tuning (which uses
    # validation) never leaks into the reported test metrics.
    parser.add_argument("--test", default=None)
    # Rare-class levers (direction task). Defaults are chosen to help neutral F1
    # while leaving the relevance task's original behaviour intact.
    parser.add_argument(
        "--class-weight-scheme",
        choices=["inverse", "effective_number", "none"],
        default="inverse",
    )
    parser.add_argument("--effective-number-beta", type=float, default=0.9999)
    parser.add_argument("--neutral-weight-boost", type=float, default=1.0)
    parser.add_argument("--loss", choices=["ce", "focal"], default="ce")
    parser.add_argument("--focal-gamma", type=float, default=2.0)
    parser.add_argument("--label-smoothing", type=float, default=0.0)
    parser.add_argument(
        "--oversample",
        choices=["none", "direction"],
        default="none",
    )
    parser.add_argument("--neutral-oversample-factor", type=int, default=4)
    parser.add_argument("--minority-oversample-factor", type=int, default=2)
    parser.add_argument(
        "--merge-neutral-uncertain",
        action="store_true",
        help="Collapse neutral+uncertain into one non-directional class.",
    )
    parser.add_argument(
        "--tune-logit-bias",
        action="store_true",
        help="Fit an additive per-class logit bias on validation to lift minority recall.",
    )
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument(
        "--metric-for-best-model",
        default="macroF1",
        help="e.g. macroF1 or neutral_f1 (direction) for minority-aware selection.",
    )
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
    from .direction_training import (
        MERGED_DIRECTION_LABELS,
        class_weights as compute_class_weights,
        evaluate_with_bias,
        label_counts,
        merge_direction_label,
        oversample_rows,
        oversampling_summary,
        tune_logit_bias,
    )

    set_seed(args.seed)
    tokenizer = AutoTokenizer.from_pretrained(args.model)

    is_direction = args.task == "direction"
    merge = args.merge_neutral_uncertain and is_direction
    if is_direction and merge:
        labels = list(MERGED_DIRECTION_LABELS)
    else:
        labels = TASK_LABELS[args.task]
    label_to_id = {label: index for index, label in enumerate(labels)}
    id_to_label = {index: label for label, index in label_to_id.items()}

    def gold_label(row):
        if args.task == "relevance":
            return row["gold"]["relevance"]
        return merge_direction_label(
            row["gold"]["impactDirection"],
            merge_neutral_uncertain=merge,
        )

    def load_rows(path):
        rows = read_jsonl(path)
        if is_direction:
            rows = [
                row for row in rows
                if row["gold"]["relevance"] != "not_relevant"
            ]
        return rows

    def to_dataset(rows):
        return Dataset.from_list([{
            "text": build_text(row),
            "label": label_to_id[gold_label(row)],
        } for row in rows])

    train_rows = load_rows(args.train)
    validation_rows = load_rows(args.validation)
    test_rows = load_rows(args.test) if args.test else None

    # Minority oversampling (direction only): physically duplicate rare rows so
    # the model sees many more neutral gradients per epoch.
    oversample_report = None
    if is_direction and args.oversample == "direction":
        oversample_report = oversampling_summary(
            train_rows,
            gold_label,
            neutral_factor=args.neutral_oversample_factor,
            minority_factor=args.minority_oversample_factor,
        )
        train_rows = oversample_rows(
            train_rows,
            gold_label,
            neutral_factor=args.neutral_oversample_factor,
            minority_factor=args.minority_oversample_factor,
        )

    train_data = to_dataset(train_rows)
    validation_data = to_dataset(validation_rows)

    # Class weights from the (pre-oversampling) label distribution.
    counts = label_counts(
        [gold_label(row) for row in load_rows(args.train)],
        labels,
    )
    boosts = None
    if is_direction and args.neutral_weight_boost != 1.0 and "neutral" in label_to_id:
        boosts = {"neutral": args.neutral_weight_boost}
    class_weight_values = compute_class_weights(
        counts,
        labels,
        scheme=args.class_weight_scheme,
        beta=args.effective_number_beta,
        boosts=boosts,
    )
    class_weights = torch.tensor(class_weight_values, dtype=torch.float)

    def tokenize(batch):
        return tokenizer(batch["text"], truncation=True, max_length=512)

    train_data = train_data.map(tokenize, batched=True)
    validation_data = validation_data.map(tokenize, batched=True)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model,
        num_labels=len(labels),
        id2label=id_to_label,
        label2id=label_to_id,
    )

    def compute_metrics(prediction):
        predicted = prediction.predictions.argmax(axis=-1).tolist()
        expected = prediction.label_ids.tolist()
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
        learning_rate=args.learning_rate,
        per_device_train_batch_size=8,
        per_device_eval_batch_size=16,
        num_train_epochs=args.epochs,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=1,
        load_best_model_at_end=True,
        metric_for_best_model=args.metric_for_best_model,
        greater_is_better=True,
        seed=args.seed,
        report_to=[],
    )

    focal_gamma = args.focal_gamma if args.loss == "focal" else None
    label_smoothing = args.label_smoothing

    class WeightedTrainer(Trainer):
        def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
            labels_tensor = inputs.pop("labels")
            outputs = model(**inputs)
            logits = outputs.logits
            weight = class_weights.to(logits.device)
            if focal_gamma is not None:
                # Focal loss (Lin et al. 2017): down-weights easy, confident
                # majority examples so the scarce neutral rows dominate the
                # gradient. Combined with class weights for the rare classes.
                log_probs = torch.nn.functional.log_softmax(logits, dim=-1)
                gathered = log_probs.gather(
                    1, labels_tensor.unsqueeze(1)
                ).squeeze(1)
                probs = gathered.exp()
                sample_weight = weight[labels_tensor]
                loss = -((1.0 - probs) ** focal_gamma) * gathered * sample_weight
                loss = loss.mean()
            else:
                loss = torch.nn.functional.cross_entropy(
                    logits,
                    labels_tensor,
                    weight=weight,
                    label_smoothing=label_smoothing,
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

    report = {"validation": metrics}
    if oversample_report is not None:
        report["oversampling"] = oversample_report
    report["classWeights"] = dict(zip(labels, class_weight_values))
    report["config"] = {
        "task": args.task,
        "classWeightScheme": args.class_weight_scheme,
        "loss": args.loss,
        "focalGamma": args.focal_gamma if args.loss == "focal" else None,
        "labelSmoothing": args.label_smoothing,
        "oversample": args.oversample,
        "mergeNeutralUncertain": merge,
        "metricForBestModel": args.metric_for_best_model,
    }

    # Post-hoc per-class logit-bias tuning: fit on validation, apply to test.
    if is_direction and args.tune_logit_bias:
        def logits_and_truth(dataset):
            output_predictions = trainer.predict(dataset)
            return (
                output_predictions.predictions.tolist(),
                output_predictions.label_ids.tolist(),
            )

        validation_logits, validation_truth = logits_and_truth(validation_data)
        bias, tuned_f1, tuned_metrics = tune_logit_bias(
            validation_logits,
            validation_truth,
            labels,
            present_only=True,
        )
        report["logitBias"] = dict(zip(labels, bias))
        report["validationTuned"] = {
            "macroF1": tuned_f1,
            "perClass": tuned_metrics["perClass"],
        }
        if test_rows is not None:
            test_data = to_dataset(test_rows).map(tokenize, batched=True)
            test_logits, test_truth = logits_and_truth(test_data)
            report["testArgmax"] = evaluate_with_bias(
                test_logits, test_truth, labels, [0.0] * len(labels)
            )
            report["testTuned"] = evaluate_with_bias(
                test_logits, test_truth, labels, bias
            )

    (output / "metrics.json").write_text(
        json.dumps(report, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from market_gyan import train_xlmr
from market_gyan.cli import xlmr_baseline_macro_f1
from market_gyan.dataset import write_jsonl
from test_dataset import row


class FakeArray:
    def __init__(self, values):
        self.values = values

    def tolist(self):
        return self.values

    def argmax(self, axis=-1):
        return FakeArray([
            max(range(len(values)), key=values.__getitem__)
            for values in self.values
        ])


class FakeDataset:
    def __init__(self, rows):
        self.rows = rows

    @classmethod
    def from_list(cls, rows):
        return cls(rows)

    def map(self, function, batched=False):
        return self


class FakeTrainer:
    """Trains nothing; always predicts the first label."""

    def __init__(self, model=None, args=None, **kwargs):
        self.model = model
        self.args = args

    def train(self, resume_from_checkpoint=None):
        pass

    def evaluate(self):
        return {"eval_macroF1": 0.5}

    def save_model(self, *args):
        Path(self.args.output_dir).mkdir(parents=True, exist_ok=True)

    def predict(self, dataset):
        labels = [item["label"] for item in dataset.rows]
        logits = [[1.0] + [0.0] * (self.model.num_labels - 1) for _ in labels]
        return SimpleNamespace(
            predictions=FakeArray(logits),
            label_ids=FakeArray(labels),
        )


def fake_training_modules():
    transformers = types.ModuleType("transformers")
    transformers.AutoTokenizer = SimpleNamespace(
        from_pretrained=lambda name: (lambda texts, **kwargs: {})
    )
    transformers.AutoModelForSequenceClassification = SimpleNamespace(
        from_pretrained=lambda name, num_labels, **kwargs: SimpleNamespace(
            num_labels=num_labels
        )
    )
    transformers.DataCollatorWithPadding = lambda tokenizer: None
    transformers.EarlyStoppingCallback = lambda **kwargs: None
    transformers.Trainer = FakeTrainer
    transformers.TrainingArguments = lambda **kwargs: SimpleNamespace(**kwargs)
    transformers.set_seed = lambda seed: None
    datasets = types.ModuleType("datasets")
    datasets.Dataset = FakeDataset
    torch = types.ModuleType("torch")
    torch.float = "float32"
    torch.tensor = lambda values, dtype=None: values
    return {"transformers": transformers, "datasets": datasets, "torch": torch}


class TrainXlmrReportTest(unittest.TestCase):
    def test_held_out_test_split_is_reported_without_bias_tuning(self):
        rows = [
            row(1, "direct", "earnings", "bullish"),
            row(2, "indirect", "regulation", "neutral"),
            row(3, "not_relevant", "not_applicable", "not_applicable"),
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("train", "validation", "test"):
                write_jsonl(root / ("%s.jsonl" % name), rows)
            argv = [
                "train_xlmr",
                "--train", str(root / "train.jsonl"),
                "--validation", str(root / "validation.jsonl"),
                "--test", str(root / "test.jsonl"),
                "--output", str(root / "model"),
            ]
            with mock.patch.dict(sys.modules, fake_training_modules()), \
                    mock.patch.object(sys, "argv", argv):
                train_xlmr.main()
            report = json.loads(
                (root / "model" / "metrics.json").read_text(encoding="utf-8")
            )

        self.assertEqual(report["testDecisionRule"], "argmax")
        self.assertAlmostEqual(report["test"]["accuracy"], 1 / 3)
        self.assertEqual(
            xlmr_baseline_macro_f1(report),
            report["test"]["macroF1"],
        )

    def test_bias_tuned_direction_model_reports_the_tuned_rule_as_test(self):
        rows = [
            row(index, "direct", "earnings", direction)
            for index, direction in enumerate(
                ("bullish", "bearish", "neutral", "uncertain"), start=1
            )
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("train", "validation", "test"):
                write_jsonl(root / ("%s.jsonl" % name), rows)
            argv = [
                "train_xlmr",
                "--task", "direction",
                "--tune-logit-bias",
                "--train", str(root / "train.jsonl"),
                "--validation", str(root / "validation.jsonl"),
                "--test", str(root / "test.jsonl"),
                "--output", str(root / "model"),
            ]
            with mock.patch.dict(sys.modules, fake_training_modules()), \
                    mock.patch.object(sys, "argv", argv):
                train_xlmr.main()
            report = json.loads(
                (root / "model" / "metrics.json").read_text(encoding="utf-8")
            )

        self.assertEqual(report["testDecisionRule"], "tuned_logit_bias")
        self.assertEqual(report["test"], report["testTuned"])
        self.assertIn("testArgmax", report)

    def test_deployment_gate_refuses_a_missing_xlmr_baseline(self):
        with self.assertRaisesRegex(ValueError, "no held-out macro-F1"):
            xlmr_baseline_macro_f1({"validation": {"eval_macroF1": 0.9}})
        # A real 0.0 baseline is still a baseline.
        self.assertEqual(xlmr_baseline_macro_f1({"macro avg": {"f1-score": 0.0}}), 0.0)
        self.assertEqual(xlmr_baseline_macro_f1({"eval_macro_f1": 0.61}), 0.61)


if __name__ == "__main__":
    unittest.main()

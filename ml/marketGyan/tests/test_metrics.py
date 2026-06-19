import json
import tempfile
import unittest
from pathlib import Path

from market_gyan.cli import command_audit_predictions
from market_gyan.dataset import compact_qwen_label, write_jsonl
from market_gyan.metrics import (
    agreement_metrics,
    benchmark_predictions,
    bootstrap_difference,
    candidate_review_metrics,
    classification_metrics,
    multilabel_micro_f1,
    reaction_analysis,
)
from test_dataset import row


def label(relevance="direct", direction="bullish"):
    relevant = relevance != "not_relevant"
    return {
        "language": "en",
        "summary": "A sufficiently detailed factual Nepal market summary.",
        "relevance": relevance,
        "eventType": "earnings" if relevant else "not_applicable",
        "impactScope": "company" if relevant else "none",
        "impactDirection": direction if relevant else "not_applicable",
        "impactHorizon": "short_term" if relevant else "not_applicable",
        "impactMechanism": "earnings_cash_flow" if relevant else "none",
        "sectors": ["Banking"] if relevant else [],
        "symbols": ["NABIL"] if relevant else [],
        "tags": ["earnings"],
        "confidenceBand": "high",
        "rationale": "The numbered sentence supports the cautious potential-impact explanation.",
        "evidenceSentenceIds": ["S1"],
    }


class MetricsTest(unittest.TestCase):
    def test_classification_metrics_report_macro_f1(self):
        labels = ["direct", "indirect", "not_relevant"]
        metrics = classification_metrics(
            labels,
            ["direct", "not_relevant", "not_relevant"],
            labels,
        )
        self.assertAlmostEqual(metrics["accuracy"], 2 / 3)
        self.assertIn("macroF1", metrics)
        json.dumps(metrics)

    def test_multilabel_micro_f1(self):
        score = multilabel_micro_f1(
            [["Banking"], ["Hydropower"]],
            [["Banking"], ["Banking"]],
        )
        self.assertEqual(score, 0.5)

    def test_candidate_review_metrics_track_v2_edits(self):
        generated = label("direct", "bullish")
        gold = label("direct", "bearish")
        metrics = candidate_review_metrics([{
            "generated": generated,
            "gold": gold,
        }])
        self.assertEqual(metrics["acceptanceRate"], 0.0)
        self.assertEqual(metrics["fieldEdits"]["impactDirection"], 1)

    def test_prediction_benchmark_checks_v2_schema_and_grounding(self):
        truth = [{
            "id": "1",
            "sentences": [{"id": "S1", "text": "Profit increased."}],
            "gold": label(),
        }]
        predictions = [{"id": "1", "prediction": label()}]
        metrics = benchmark_predictions(truth, predictions)
        self.assertEqual(metrics["structuredOutputValidity"], 1.0)
        self.assertEqual(metrics["evidenceGrounding"], 1.0)
        self.assertEqual(metrics["relevance"]["macroF1"], 1 / 3)

    def test_prediction_benchmark_accepts_compact_qwen_schema(self):
        truth = [row(1, "direct", "earnings", "bullish")]
        prediction = compact_qwen_label(truth[0]["gold"])

        metrics = benchmark_predictions(truth, [{
            "id": truth[0]["id"],
            "prediction": prediction,
        }])

        self.assertEqual(metrics["structuredOutputValidity"], 1.0)
        self.assertEqual(metrics["evidenceGrounding"], 1.0)
        self.assertEqual(metrics["invalidOutputCount"], 0)

    def test_prediction_benchmark_reports_compact_schema_errors(self):
        truth = [row(1, "direct", "earnings", "bullish")]
        prediction = compact_qwen_label(truth[0]["gold"])
        del prediction["eventType"]

        metrics = benchmark_predictions(truth, [{
            "id": truth[0]["id"],
            "prediction": prediction,
        }])

        self.assertEqual(metrics["structuredOutputValidity"], 0.0)
        self.assertEqual(metrics["invalidOutputCount"], 1)
        self.assertIn("missing fields", metrics["invalidOutputExamples"][0]["errors"][0])

    def test_prediction_benchmark_rejects_unknown_evidence_ids(self):
        truth = [row(1, "direct", "earnings", "bullish")]
        prediction = compact_qwen_label(truth[0]["gold"])
        prediction["evidenceSentenceIds"] = ["S99"]

        metrics = benchmark_predictions(truth, [{
            "id": truth[0]["id"],
            "prediction": prediction,
        }])

        self.assertEqual(metrics["structuredOutputValidity"], 0.0)
        self.assertEqual(metrics["evidenceGrounding"], 0.0)

    def test_prediction_benchmark_rejects_numeric_evidence_ids_without_crashing(self):
        truth = [row(1, "direct", "earnings", "bullish")]
        prediction = compact_qwen_label(truth[0]["gold"])
        prediction["evidenceSentenceIds"] = [1]

        metrics = benchmark_predictions(truth, [{
            "id": truth[0]["id"],
            "prediction": prediction,
        }])

        self.assertEqual(metrics["structuredOutputValidity"], 0.0)
        self.assertEqual(metrics["evidenceGrounding"], 0.0)
        errors = " ".join(metrics["invalidOutputExamples"][0]["errors"])
        self.assertIn("evidenceSentenceIds values must be strings", errors)
        self.assertIn("unknown evidence sentence IDs: 1", errors)

    def test_agreement_reports_kappa_and_multilabel_f1(self):
        first = label()
        second = label()
        rows = [{
            "annotations": [
                {"status": "submitted", "annotation": first},
                {"status": "submitted", "annotation": second},
            ]
        }]
        report = agreement_metrics(rows)
        self.assertEqual(report["relevanceKappa"], 1.0)
        self.assertEqual(report["evidenceSentenceF1"], 1.0)

    def test_bootstrap_and_reaction_analysis_are_deterministic(self):
        comparison = bootstrap_difference([0, 0, 1], [1, 1, 1], samples=100)
        self.assertGreater(comparison["difference"], 0)
        reaction = reaction_analysis([
            {
                "impactDirection": "bullish",
                "reaction": {"firstSessionAbnormalReturn": 1.2},
            },
            {
                "impactDirection": "bearish",
                "reaction": {"firstSessionAbnormalReturn": -0.8},
            },
        ], samples=100)
        self.assertEqual(reaction["materialSignAgreement"], 1.0)

    def test_prediction_audit_joins_errors_to_gold_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            truth = root / "truth.jsonl"
            predictions = root / "predictions.json"
            output = root / "audit.json"
            write_jsonl(truth, [row(1, "direct", "earnings", "bullish")])
            predictions.write_text(json.dumps([{
                "id": "row-001",
                "expected": "direct",
                "predicted": "indirect",
            }]), encoding="utf-8")
            args = type("Args", (), {
                "truth": str(truth),
                "predictions": str(predictions),
                "output": str(output),
                "task": "relevance",
            })()

            command_audit_predictions(args)

            report = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(report["errorRows"], 1)
            self.assertEqual(report["errors"][0]["title"], "Notice 001")


if __name__ == "__main__":
    unittest.main()

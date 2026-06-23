import unittest
import json
import tempfile
import zipfile
from pathlib import Path

from market_gyan.cli import command_qwen_model_gate
from market_gyan.system_evaluation import (
    deployment_gate,
    qwen_model_gate,
    retrieval_metrics,
    scenario_metrics,
)


class SystemEvaluationTest(unittest.TestCase):
    def test_precision_at_five_uses_manual_judgments(self):
        metrics = retrieval_metrics([{
            "results": [
                {"relevant": True},
                {"relevant": True},
                {"relevant": False},
                {"relevant": False},
                {"relevant": False},
            ]
        }])
        self.assertEqual(metrics["precisionAt5"], 0.4)

    def test_system_metrics_include_schema_citations_and_latency(self):
        metrics = scenario_metrics([{
            "result": {
                "schemaValid": True,
                "citationsCorrect": True,
                "sentenceCitationsCorrect": True,
                "grounded": True,
                "freshnessSeconds": 600,
                "latencySeconds": 3,
            }
        }])
        self.assertEqual(metrics["schemaAdherence"], 1.0)
        self.assertEqual(metrics["sentenceCitationCorrectness"], 1.0)
        self.assertEqual(metrics["averageLatencySeconds"], 3.0)

    def test_deployment_gate_enforces_model_and_grounding_thresholds(self):
        result = deployment_gate(
            xlmr_macro_f1=0.70,
            qwen_macro_f1=0.68,
            qwen_per_class_f1={
                "bullish": 0.60,
                "bearish": 0.55,
                "neutral": 0.75,
                "uncertain": 0.50,
            },
            structured_validity=0.96,
            evidence_grounding=0.97,
        )
        self.assertTrue(result["eligible"])
        self.assertFalse(deployment_gate(
            xlmr_macro_f1=0.70,
            qwen_macro_f1=0.60,
            qwen_per_class_f1={
                "bullish": 0.60,
                "bearish": 0.55,
                "neutral": 0.75,
                "uncertain": 0.50,
            },
            structured_validity=0.96,
            evidence_grounding=0.97,
        )["eligible"])

    def test_deployment_gate_rejects_tolerant_diagnostic_quality(self):
        result = deployment_gate(
            xlmr_macro_f1=0.72,
            qwen_macro_f1=0.63,
            qwen_per_class_f1={
                "bullish": 0.65,
                "bearish": 0.65,
                "neutral": 0.50,
                "uncertain": 0.55,
            },
            structured_validity=0.68,
            evidence_grounding=0.68,
        )
        self.assertFalse(result["eligible"])
        self.assertFalse(result["checks"]["structuredValidity"])
        self.assertFalse(result["checks"]["evidenceGrounding"])

    def test_qwen_model_gate_prefers_constrained_condition(self):
        candidate = {
            "unsloth_qlora": {
                "structuredOutputValidity": 0.44,
                "evidenceGrounding": 0.44,
                "relevance": {"macroF1": 0.40, "accuracy": 0.42},
            },
            "vllm_constrained_three_shot": {
                "structuredOutputValidity": 0.96,
                "evidenceGrounding": 0.97,
                "relevance": {"macroF1": 0.60, "accuracy": 0.64},
                "direction": {"macroF1": 0.62, "accuracy": 0.61},
            },
            "unsloth_qlora_tolerant_diagnostic": {
                "structuredOutputValidity": 0.65,
                "evidenceGrounding": 0.68,
                "repairAppliedCount": 18,
                "officialGate": False,
            },
        }
        baseline = {
            "unsloth_qlora": {
                "structuredOutputValidity": 0.44,
                "evidenceGrounding": 0.44,
                "relevance": {"macroF1": 0.41, "accuracy": 0.43},
            }
        }

        report = qwen_model_gate(candidate, baseline_metrics=baseline)

        self.assertTrue(report["eligible"])
        self.assertEqual(report["gateCondition"], "vllm_constrained_three_shot")
        self.assertAlmostEqual(
            report["baseline"]["delta"]["structuredOutputValidity"],
            0.52,
        )
        self.assertFalse(report["tolerantDiagnostic"]["officialGate"])

    def test_qwen_model_gate_rejects_tolerant_condition_as_official(self):
        candidate = {
            "unsloth_qlora_tolerant_diagnostic": {
                "structuredOutputValidity": 1.0,
                "evidenceGrounding": 1.0,
                "repairDiagnostic": True,
                "officialGate": False,
            }
        }

        report = qwen_model_gate(
            candidate,
            gate_condition="unsloth_qlora_tolerant_diagnostic",
        )

        self.assertFalse(report["eligible"])
        self.assertFalse(report["checks"]["officialGate"])

    def test_qwen_model_gate_cli_reads_baseline_metrics_from_zip(self):
        candidate = {
            "unsloth_qlora": {
                "structuredOutputValidity": 0.96,
                "evidenceGrounding": 0.95,
                "relevance": {"macroF1": 0.50, "accuracy": 0.60},
            }
        }
        baseline = {
            "unsloth_qlora": {
                "structuredOutputValidity": 0.44,
                "evidenceGrounding": 0.44,
                "relevance": {"macroF1": 0.40, "accuracy": 0.50},
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate_path = root / "metrics.json"
            baseline_path = root / "previous.zip"
            output_path = root / "gate.json"
            candidate_path.write_text(json.dumps(candidate), encoding="utf-8")
            with zipfile.ZipFile(baseline_path, "w") as archive:
                archive.writestr("metrics.json", json.dumps(baseline))
            args = type("Args", (), {
                "candidate_metrics": str(candidate_path),
                "output": str(output_path),
                "baseline_metrics": str(baseline_path),
                "gate_condition": None,
                "baseline_condition": "unsloth_qlora",
                "min_validity": 0.95,
                "min_grounding": 0.95,
                "allow_fail": False,
            })()

            command_qwen_model_gate(args)

            report = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertTrue(report["eligible"])
            self.assertEqual(
                report["sources"]["baselineMetrics"],
                str(baseline_path),
            )


if __name__ == "__main__":
    unittest.main()

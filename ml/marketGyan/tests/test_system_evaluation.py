import unittest

from market_gyan.system_evaluation import (
    deployment_gate,
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


if __name__ == "__main__":
    unittest.main()

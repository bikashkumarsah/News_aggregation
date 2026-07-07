import json
import tempfile
import unittest
from pathlib import Path

from market_gyan import proposal_evaluation
from market_gyan.dataset import compact_qwen_label, read_jsonl, write_jsonl
from market_gyan.proposal_evaluation import (
    collect_retrieval_results,
    collect_scenario_results,
    run_constrained_inference,
)
from market_gyan.system_evaluation import scenario_metrics

try:
    from test_dataset import row
except ModuleNotFoundError:
    from ml.marketGyan.tests.test_dataset import row


class ProposalEvaluationTest(unittest.TestCase):
    def test_constrained_inference_writes_predictions_and_metrics(self):
        test_row = row(1, "direct", "earnings", "bullish")
        train_rows = [
            row(2, "direct", "earnings", "bullish"),
            row(3, "indirect", "regulation", "neutral"),
            row(4, "not_relevant", "not_applicable", "not_applicable"),
        ]
        original = proposal_evaluation.chat_completion_json

        def fake_chat_completion_json(**_kwargs):
            return compact_qwen_label(test_row["gold"])

        proposal_evaluation.chat_completion_json = fake_chat_completion_json
        self.addCleanup(
            lambda: setattr(
                proposal_evaluation,
                "chat_completion_json",
                original,
            )
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            test_path = root / "test.jsonl"
            train_path = root / "train.jsonl"
            output_dir = root / "out"
            write_jsonl(test_path, [test_row])
            write_jsonl(train_path, train_rows)

            report = run_constrained_inference(
                test_path,
                train_path,
                output_dir,
                base_url="http://vllm.test/v1",
                api_key="token",
                model="marketgyan-qwen35-9b-targeted-v2",
            )

            self.assertEqual(report["rows"], 1)
            self.assertTrue((output_dir / "constrained_inference_metrics.json").exists())
            predictions = read_jsonl(output_dir / "vllm_constrained_zero_shot.jsonl")
            self.assertEqual(predictions[0]["prediction"]["relevance"], "direct")
            metrics = json.loads(
                (output_dir / "vllm_constrained_three_shot.metrics.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(metrics["structuredOutputValidity"], 1.0)
            self.assertTrue(metrics["officialGate"])

    def test_collect_retrieval_results_writes_unlabeled_top_k(self):
        original = proposal_evaluation.http_json

        def fake_http_json(method, url, **_kwargs):
            self.assertEqual(method, "GET")
            self.assertIn("/api/market-gyan/search?", url)
            return {
                "success": True,
                "data": [{
                    "documentId": "doc-1",
                    "chunkId": "chunk-1",
                    "title": "Banking update",
                    "url": "https://example.com/banking",
                    "source": "ShareSansar",
                    "score": 0.8,
                    "text": "Banking turnover increased.",
                    "contentHash": "hash-1",
                    "sentenceIds": ["S1"],
                    "sentences": [{"id": "S1", "text": "Banking turnover increased."}],
                }],
            }

        proposal_evaluation.http_json = fake_http_json
        self.addCleanup(lambda: setattr(proposal_evaluation, "http_json", original))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            queries = root / "queries.json"
            output = root / "retrieval.json"
            queries.write_text(json.dumps([{
                "id": "rq01",
                "query": "banking",
                "filters": {"sector": "Banking"},
                "judgment": "Banking results are relevant.",
            }]), encoding="utf-8")

            collect_retrieval_results(
                queries,
                output,
                backend_url="http://127.0.0.1:5001",
                top_k=5,
            )

            rows = json.loads(output.read_text(encoding="utf-8"))
            self.assertTrue(rows[0]["manualLabelRequired"])
            self.assertNotIn("relevant", rows[0]["results"][0])
            self.assertEqual(rows[0]["results"][0]["sentenceIds"], ["S1"])

    def test_collect_scenarios_scores_citations_disclaimer_and_advice(self):
        original = proposal_evaluation.http_json

        def fake_http_json(method, url, payload=None, headers=None, **_kwargs):
            self.assertEqual(method, "POST")
            self.assertTrue(url.endswith("/analyze"))
            self.assertEqual(headers["x-market-gyan-token"], "token")
            self.assertEqual(payload["mode"], "query")
            return {
                "mode": "query",
                "answer": "The cited banking evidence reports increased turnover.",
                "citations": [{
                    "documentId": "doc-1",
                    "title": "Banking update",
                    "url": "https://example.com/banking",
                    "excerpt": "Banking turnover increased.",
                    "score": 0.8,
                    "source": "ShareSansar",
                    "chunkId": "chunk-1",
                    "contentHash": "hash-1",
                    "sentenceIds": ["S1"],
                    "sentences": [{"id": "S1", "text": "Banking turnover increased."}],
                }],
                "disclaimer": proposal_evaluation.DISCLAIMER,
            }

        proposal_evaluation.http_json = fake_http_json
        self.addCleanup(lambda: setattr(proposal_evaluation, "http_json", original))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scenarios = root / "scenarios.json"
            output = root / "system.json"
            scenarios.write_text(json.dumps([{
                "id": "sc01",
                "mode": "query",
                "prompt": "Why did banks move?",
                "expected": "Cite banking evidence.",
            }]), encoding="utf-8")

            collect_scenario_results(
                scenarios,
                output,
                agent_url="http://127.0.0.1:8100",
                service_token="token",
            )

            rows = json.loads(output.read_text(encoding="utf-8"))
            result = rows[0]["result"]
            self.assertTrue(result["schemaValid"])
            self.assertTrue(result["citationsCorrect"])
            self.assertTrue(result["sentenceCitationsCorrect"])
            self.assertTrue(result["disclaimerPresent"])
            metrics = scenario_metrics(rows)
            self.assertEqual(metrics["disclaimerPresence"], 1.0)
            self.assertEqual(metrics["adviceSafety"], 1.0)


if __name__ == "__main__":
    unittest.main()

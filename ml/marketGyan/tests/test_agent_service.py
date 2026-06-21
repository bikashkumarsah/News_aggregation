import unittest

try:
    from pydantic import ValidationError
    from agent_service import workflow
    from agent_service.config import Settings
    from agent_service.schemas import AnalysisResult, DISCLAIMER
    from agent_service.workflow import crewai_model_name, run_mock, validate_grounded_result
except ImportError:
    ValidationError = None


@unittest.skipIf(ValidationError is None, "agent-service dependencies are not installed")
class AgentServiceTest(unittest.TestCase):
    def set_fake_retrieval(self, rows):
        original = workflow.RetrievalClient

        class FakeRetrievalClient:
            def __init__(self, settings):
                self.settings = settings
                self.seen = []

            def search(self, query, filters=None):
                self.seen = rows
                return rows

        workflow.RetrievalClient = FakeRetrievalClient
        self.addCleanup(lambda: setattr(workflow, "RetrievalClient", original))

    def test_local_model_uses_openai_compatible_provider(self):
        self.assertEqual(
            crewai_model_name("marketgyan-qwen3-8b"),
            "openai/marketgyan-qwen3-8b",
        )
        self.assertEqual(
            crewai_model_name("openai/custom-model"),
            "openai/custom-model",
        )

    def result(self, excerpt="NEPSE closed higher after a mixed trading session."):
        value = {
            "mode": "query",
            "answer": "The retrieved report describes a mixed session.",
            "citations": [{
                "documentId": "doc-1",
                "title": "Daily market",
                "url": "https://example.com/market",
                "excerpt": excerpt,
                "score": 0.9,
            }],
            "disclaimer": DISCLAIMER,
        }
        if hasattr(AnalysisResult, "model_validate"):
            return AnalysisResult.model_validate(value)
        return AnalysisResult.parse_obj(value)

    def anchored_result(self, sentence_id="S1"):
        value = {
            "mode": "query",
            "answer": "The retrieved report describes a mixed session.",
            "citations": [{
                "documentId": "doc-1",
                "title": "Daily market",
                "url": "https://example.com/market",
                "excerpt": "NEPSE closed higher after a mixed trading session.",
                "score": 0.9,
                "source": "ShareSansar",
                "publishedAt": "2026-06-13T00:00:00.000Z",
                "chunkId": "chunk-1",
                "contentHash": "hash-1",
                "sentenceIds": [sentence_id],
                "sentences": [{
                    "id": sentence_id,
                    "text": "NEPSE closed higher after a mixed trading session.",
                }],
            }],
            "disclaimer": DISCLAIMER,
        }
        if hasattr(AnalysisResult, "model_validate"):
            return AnalysisResult.model_validate(value)
        return AnalysisResult.parse_obj(value)

    def test_accepts_exact_retrieved_citation(self):
        result = validate_grounded_result(self.result(), [{
            "url": "https://example.com/market",
            "text": "NEPSE closed higher after a mixed trading session.",
        }])
        self.assertEqual(result.mode, "query")

    def test_accepts_sentence_anchored_citation(self):
        result = validate_grounded_result(self.anchored_result(), [{
            "documentId": "doc-1",
            "url": "https://example.com/market",
            "chunkId": "chunk-1",
            "contentHash": "hash-1",
            "text": "NEPSE closed higher after a mixed trading session.",
            "sentences": [{
                "id": "S1",
                "text": "NEPSE closed higher after a mixed trading session.",
            }],
        }])
        self.assertEqual(result.citations[0].sentenceIds, ["S1"])

    def test_rejects_unknown_sentence_anchor(self):
        with self.assertRaisesRegex(ValueError, "not returned"):
            validate_grounded_result(self.anchored_result("S99"), [{
                "documentId": "doc-1",
                "url": "https://example.com/market",
                "chunkId": "chunk-1",
                "contentHash": "hash-1",
                "text": "NEPSE closed higher after a mixed trading session.",
                "sentences": [{
                    "id": "S1",
                    "text": "NEPSE closed higher after a mixed trading session.",
                }],
            }])

    def test_rejects_sentence_anchor_with_wrong_visible_text(self):
        result = self.anchored_result("S1")
        result.citations[0].sentences[0].text = "Invented sentence text."
        with self.assertRaisesRegex(ValueError, "not returned"):
            validate_grounded_result(result, [{
                "documentId": "doc-1",
                "url": "https://example.com/market",
                "chunkId": "chunk-1",
                "contentHash": "hash-1",
                "text": "NEPSE closed higher after a mixed trading session.",
                "sentences": [{
                    "id": "S1",
                    "text": "NEPSE closed higher after a mixed trading session.",
                }],
            }])

    def test_rejects_report_without_citations(self):
        value = {
            "mode": "report",
            "headline": "Daily report",
            "summary": "The report lacks visible citations.",
            "citations": [],
            "disclaimer": DISCLAIMER,
        }
        result = (
            AnalysisResult.model_validate(value)
            if hasattr(AnalysisResult, "model_validate")
            else AnalysisResult.parse_obj(value)
        )
        with self.assertRaisesRegex(ValueError, "At least one citation"):
            validate_grounded_result(result, [{
                "url": "https://example.com/market",
                "text": "NEPSE closed higher after a mixed trading session.",
            }])

    def test_rejects_unsupported_citation(self):
        with self.assertRaisesRegex(ValueError, "not returned"):
            validate_grounded_result(self.result("Invented evidence"), [{
                "url": "https://example.com/market",
                "text": "NEPSE closed higher after a mixed trading session.",
            }])

    def test_rejects_investment_advice(self):
        result = self.result()
        result.answer = "This is a buy signal."
        with self.assertRaisesRegex(ValueError, "investment advice"):
            validate_grounded_result(result, [{
                "url": "https://example.com/market",
                "text": "NEPSE closed higher after a mixed trading session.",
            }])

    def test_mock_query_uses_retrieved_sentence_citations(self):
        self.set_fake_retrieval([{
            "documentId": "doc-1",
            "title": "Daily market",
            "url": "https://example.com/market",
            "text": "NEPSE closed higher after a mixed trading session.",
            "score": 0.9,
            "source": "ShareSansar",
            "publishedAtIso": "2026-06-13T00:00:00.000Z",
            "chunkId": "chunk-1",
            "contentHash": "hash-1",
            "sentenceIds": ["S1"],
            "sentences": [{
                "id": "S1",
                "text": "NEPSE closed higher after a mixed trading session.",
            }],
        }])
        request = workflow.AnalysisRequest(
            mode="query",
            question="What happened today?",
            filters={"sector": "Banking"},
        )

        result = run_mock(request, Settings(mock_enabled=True, query_enabled=True))

        self.assertEqual(result.mode, "query")
        self.assertEqual(result.modelVersion, "mock-rag-local")
        self.assertEqual(result.citations[0].sentenceIds, ["S1"])
        self.assertIn("NEPSE closed higher", result.answer)

    def test_mock_report_returns_grounded_sector_analysis(self):
        self.set_fake_retrieval([{
            "documentId": "doc-1",
            "title": "Banking update",
            "url": "https://example.com/banking",
            "text": "Banking turnover increased.",
            "score": 0.8,
            "source": "ShareSansar",
            "publishedAtIso": "2026-06-13T00:00:00.000Z",
            "chunkId": "chunk-1",
            "contentHash": "hash-1",
            "sectors": ["Banking"],
            "sentenceIds": ["S1"],
            "sentences": [{"id": "S1", "text": "Banking turnover increased."}],
        }])
        request = workflow.AnalysisRequest(
            mode="report",
            reportDate="2026-06-13",
            snapshot={"status": "partial"},
            filters={"limit": 5},
        )

        result = run_mock(request, Settings(mock_enabled=True, query_enabled=True))

        self.assertEqual(result.mode, "report")
        self.assertEqual(result.headline, "MarketGyan local RAG report")
        self.assertEqual(result.sectorAnalysis[0].sector, "Banking")
        self.assertEqual(result.citations[0].sentences[0].text, "Banking turnover increased.")

    def test_mock_mode_fails_without_retrieved_evidence(self):
        self.set_fake_retrieval([])
        request = workflow.AnalysisRequest(
            mode="query",
            question="What happened today?",
        )

        with self.assertRaisesRegex(ValueError, "No retrievable"):
            run_mock(request, Settings(mock_enabled=True, query_enabled=True))


if __name__ == "__main__":
    unittest.main()

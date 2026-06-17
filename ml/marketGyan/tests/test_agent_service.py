import unittest

try:
    from pydantic import ValidationError
    from agent_service.schemas import AnalysisResult, DISCLAIMER
    from agent_service.workflow import crewai_model_name, validate_grounded_result
except ImportError:
    ValidationError = None


@unittest.skipIf(ValidationError is None, "agent-service dependencies are not installed")
class AgentServiceTest(unittest.TestCase):
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

    def test_accepts_exact_retrieved_citation(self):
        result = validate_grounded_result(self.result(), [{
            "url": "https://example.com/market",
            "text": "NEPSE closed higher after a mixed trading session.",
        }])
        self.assertEqual(result.mode, "query")

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


if __name__ == "__main__":
    unittest.main()

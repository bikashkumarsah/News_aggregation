import unittest
from pathlib import Path


class LightningDeploymentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1]
        cls.deploy = cls.root / "deploy/lightning"

    def read(self, name):
        return (self.deploy / name).read_text(encoding="utf-8")

    def test_vllm_launcher_serves_targeted_adapter_securely(self):
        script = self.read("serve_vllm.sh")

        self.assertIn("Qwen/Qwen3.5-9B", script)
        self.assertIn("marketgyan-qwen35-9b-targeted-v2", script)
        self.assertIn("--enable-lora", script)
        self.assertIn("--max-lora-rank", script)
        self.assertIn("--lora-modules", script)
        self.assertIn("--api-key", script)
        self.assertIn("--language-model-only", script)
        self.assertIn("--attention-backend", script)
        self.assertIn("VLLM_USE_FLASHINFER_SAMPLER", script)
        self.assertIn("VLLM_API_KEY is required", script)
        self.assertIn("adapter_model.safetensors", script)
        self.assertNotIn("use-a-random-secret-token", script)

    def test_smoke_test_uses_models_chat_and_json_schema(self):
        script = self.read("smoke_test_vllm.sh")

        self.assertIn("/models", script)
        self.assertIn("/chat/completions", script)
        self.assertIn("response_format", script)
        self.assertIn("json_schema", script)
        self.assertIn("marketgyan_smoke", script)
        self.assertIn("Authorization: Bearer", script)

    def test_mac_agent_env_points_to_lightning_alias(self):
        env = self.read("mac_agent.env.example")

        self.assertIn("MARKET_GYAN_QUERY_ENABLED=true", env)
        self.assertIn("MARKET_GYAN_AGENT_MOCK_ENABLED=false", env)
        self.assertIn("MARKET_GYAN_INFERENCE_BASE_URL=https://YOUR-LIGHTNING-ENDPOINT/v1", env)
        self.assertIn("MARKET_GYAN_INFERENCE_MODEL=marketgyan-qwen35-9b-targeted-v2", env)
        self.assertNotIn("VLLM_API_KEY=", env)

    def test_readme_documents_gpu_choice_and_fallbacks(self):
        readme = self.read("README.md")

        self.assertIn("A100 40 GB", readme)
        self.assertIn("A100 80 GB", readme)
        self.assertIn("L40S 48 GB", readme)
        self.assertIn("MARKET_GYAN_MAX_MODEL_LEN=1536", readme)
        self.assertIn("do not expose an unauthenticated vLLM server", readme)


if __name__ == "__main__":
    unittest.main()

import os
from dataclasses import dataclass


def enabled(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    query_enabled: bool = enabled(os.getenv("MARKET_GYAN_QUERY_ENABLED"))
    mock_enabled: bool = enabled(os.getenv("MARKET_GYAN_AGENT_MOCK_ENABLED"))
    service_token: str = os.getenv("MARKET_GYAN_AGENT_SERVICE_TOKEN", "")
    node_base_url: str = os.getenv(
        "MARKET_GYAN_NODE_BASE_URL",
        "http://127.0.0.1:5001",
    )
    inference_base_url: str = os.getenv(
        "MARKET_GYAN_INFERENCE_BASE_URL",
        "http://127.0.0.1:8000/v1",
    )
    inference_api_key: str = os.getenv(
        "MARKET_GYAN_INFERENCE_API_KEY",
        "local",
    )
    inference_model: str = os.getenv(
        "MARKET_GYAN_INFERENCE_MODEL",
        "marketgyan-qwen3-8b",
    )
    request_timeout_seconds: float = float(
        os.getenv("MARKET_GYAN_AGENT_TIMEOUT_SECONDS", "120")
    )


settings = Settings()

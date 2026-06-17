import httpx

from .config import Settings


class RetrievalClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.seen = []

    def search(self, query, filters=None):
        params = {"q": query, **(filters or {})}
        with httpx.Client(timeout=self.settings.request_timeout_seconds) as client:
            response = client.get(
                f"{self.settings.node_base_url}/api/market-gyan/internal/search",
                params=params,
                headers={
                    "x-market-gyan-token": self.settings.service_token,
                },
            )
        response.raise_for_status()
        rows = response.json().get("data", [])
        self.seen.extend(rows)
        return rows

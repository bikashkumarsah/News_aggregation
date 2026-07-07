from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException

from .config import settings
from .schemas import AnalysisRequest, AnalysisResult
from .workflow import run_single_pass


app = FastAPI(title="MarketGyan Agent Service", version="1.0.0")


def require_token(x_market_gyan_token: Optional[str] = Header(default=None)):
    if not settings.service_token or x_market_gyan_token != settings.service_token:
        raise HTTPException(status_code=404, detail="Service is not available")


@app.get("/health")
def health():
    return {
        "ok": True,
        "queryEnabled": settings.query_enabled,
        "mockEnabled": settings.mock_enabled,
        "model": settings.inference_model,
        "runtime": "mock" if settings.mock_enabled else "single_pass",
    }


@app.post(
    "/analyze",
    response_model=AnalysisResult,
    dependencies=[Depends(require_token)],
)
def analyze(request: AnalysisRequest):
    if not settings.query_enabled:
        raise HTTPException(status_code=503, detail="Runtime inference is disabled")
    if request.mode == "query" and not str(request.question or "").strip():
        raise HTTPException(status_code=400, detail="question is required")
    try:
        return run_single_pass(request, settings)
    except ValueError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

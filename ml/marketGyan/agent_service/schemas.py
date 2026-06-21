from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


DISCLAIMER = "Informational analysis based on public data, not investment advice."


class AnalysisRequest(BaseModel):
    mode: Literal["query", "report"]
    question: Optional[str] = None
    reportDate: Optional[str] = None
    snapshot: Optional[Dict[str, Any]] = None
    filters: Dict[str, Any] = Field(default_factory=dict)


class CitationSentence(BaseModel):
    id: str
    text: str


class Citation(BaseModel):
    documentId: str
    title: str
    url: str
    excerpt: str
    score: float = Field(ge=0, le=1)
    source: Optional[str] = None
    publishedAt: Optional[Any] = None
    chunkId: Optional[str] = None
    chunkIndex: Optional[int] = None
    contentHash: Optional[str] = None
    sentenceIds: List[str] = Field(default_factory=list)
    sentences: List[CitationSentence] = Field(default_factory=list)


class SectorAnalysis(BaseModel):
    sector: str
    sentiment: Literal["bullish", "bearish", "neutral", "unavailable"]
    summary: str
    confidence: float = Field(ge=0, le=1)
    evidenceIndexes: List[int] = Field(default_factory=list)


class AnalysisResult(BaseModel):
    mode: Literal["query", "report"]
    answer: Optional[str] = None
    headline: Optional[str] = None
    summary: Optional[str] = None
    sectorAnalysis: List[SectorAnalysis] = Field(default_factory=list)
    citations: List[Citation]
    disclaimer: str = DISCLAIMER
    modelVersion: Optional[str] = None

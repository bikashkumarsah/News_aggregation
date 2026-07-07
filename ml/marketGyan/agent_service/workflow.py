import json
from json import JSONDecodeError

import httpx

from .config import Settings
from .retrieval import RetrievalClient
from .schemas import AnalysisRequest, AnalysisResult, DISCLAIMER


FORBIDDEN_PHRASES = (
    "guaranteed profit",
    "guaranteed return",
    "buy signal",
    "sell signal",
    "recommend buying",
    "recommend selling",
)
MAX_TOOL_RESULTS = 3


def compact_retrieval_rows(rows, limit=MAX_TOOL_RESULTS):
    compact = []
    for row in rows[:limit]:
        sentence_ids = row.get("sentenceIds") if isinstance(row.get("sentenceIds"), list) else []
        sentences = row.get("sentences") if isinstance(row.get("sentences"), list) else []
        wanted = {str(value) for value in sentence_ids[:3]}
        selected_sentences = [
            {"id": str(sentence.get("id")), "text": str(sentence.get("text"))}
            for sentence in sentences
            if str(sentence.get("id")) in wanted and sentence.get("text")
        ][:3]
        if not selected_sentences and sentences:
            first = sentences[0]
            if first.get("id") and first.get("text"):
                selected_sentences = [{
                    "id": str(first.get("id")),
                    "text": str(first.get("text")),
                }]
                sentence_ids = [selected_sentences[0]["id"]]
        excerpt = (
            selected_sentences[0]["text"]
            if selected_sentences
            else str(row.get("text") or "")[:500]
        )
        compact.append({
            "documentId": str(row.get("documentId") or row.get("_id") or ""),
            "title": row.get("title"),
            "url": row.get("url") or row.get("sourceUrl"),
            "excerpt": excerpt,
            "score": row.get("score"),
            "source": row.get("source"),
            "publishedAt": row.get("publishedAtIso") or row.get("publishedAt"),
            "chunkId": row.get("chunkId") or row.get("pointId"),
            "chunkIndex": row.get("chunkIndex"),
            "contentHash": row.get("contentHash"),
            "sentenceIds": [str(value) for value in sentence_ids[:3]],
            "sentences": selected_sentences,
            "sectors": row.get("sectors") or [],
            "symbols": row.get("symbols") or [],
        })
    return compact


def crewai_model_name(model):
    value = str(model or "").strip()
    if value.startswith(("openai/", "hosted_vllm/")):
        return value
    return "openai/" + value


def openai_model_name(model):
    value = str(model or "").strip()
    for prefix in ("openai/", "hosted_vllm/"):
        if value.startswith(prefix):
            return value[len(prefix):]
    return value


def evidence_key(url, excerpt):
    return (
        str(url or "").strip(),
        " ".join(str(excerpt or "").lower().split()),
    )


def retrieved_sentence_map(row):
    return {
        str(sentence.get("id")): " ".join(str(sentence.get("text", "")).split())
        for sentence in row.get("sentences", [])
        if isinstance(sentence, dict) and sentence.get("id")
    }


def citation_matches_sentence_anchors(citation, retrieved):
    if not citation.sentenceIds:
        return False
    candidates = [
        row for row in retrieved
        if (
            str(row.get("documentId")) == citation.documentId
            or str(row.get("url")) == citation.url
        )
    ]
    if citation.chunkId:
        candidates = [
            row for row in candidates
            if str(row.get("chunkId", row.get("pointId", ""))) == citation.chunkId
        ]
    if citation.contentHash:
        candidates = [
            row for row in candidates
            if not row.get("contentHash") or row.get("contentHash") == citation.contentHash
        ]
    for row in candidates:
        sentence_map = retrieved_sentence_map(row)
        if not sentence_map:
            continue
        if not all(sentence_id in sentence_map for sentence_id in citation.sentenceIds):
            continue
        supplied = {
            str(sentence.id): " ".join(sentence.text.split())
            for sentence in citation.sentences
        }
        if supplied and any(
            sentence_map.get(sentence_id) != text
            for sentence_id, text in supplied.items()
        ):
            continue
        excerpt = " ".join(citation.excerpt.lower().split())
        if excerpt and not any(
            excerpt in text.lower() for text in sentence_map.values()
        ):
            continue
        return True
    return False


def validate_grounded_result(result, retrieved):
    if not result.citations:
        raise ValueError("At least one citation is required")
    available = {
        evidence_key(row.get("url"), row.get("text"))
        for row in retrieved
    }
    for citation in result.citations:
        if citation_matches_sentence_anchors(citation, retrieved):
            continue
        if citation.sentenceIds:
            raise ValueError("Citation sentence evidence was not returned by retrieval")
        normalized = evidence_key(citation.url, citation.excerpt)
        matching_text = [
            text for url, text in available if url == normalized[0]
        ]
        if not matching_text or not any(
            normalized[1] in text for text in matching_text
        ):
            raise ValueError("Citation evidence was not returned by retrieval")
    generated = " ".join(filter(None, [
        result.answer,
        result.headline,
        result.summary,
        *[item.summary for item in result.sectorAnalysis],
    ])).lower()
    if any(phrase in generated for phrase in FORBIDDEN_PHRASES):
        raise ValueError("Generated output contains investment advice")
    if result.disclaimer != DISCLAIMER:
        raise ValueError("Generated output omitted the required disclaimer")
    return result


def research_query(request):
    if request.mode == "query":
        return request.question or ""
    date = request.reportDate or "the requested market date"
    return (
        "Find the most relevant Nepal financial news and regulatory evidence "
        f"for the daily market report on {date}."
    )


def _citation_from_row(row):
    sentences = row.get("sentences") if isinstance(row.get("sentences"), list) else []
    sentence_ids = row.get("sentenceIds") if isinstance(row.get("sentenceIds"), list) else []
    selected_sentences = []
    if sentence_ids and sentences:
        wanted = {str(value) for value in sentence_ids}
        selected_sentences = [
            {"id": str(sentence.get("id")), "text": str(sentence.get("text"))}
            for sentence in sentences
            if str(sentence.get("id")) in wanted and sentence.get("text")
        ]
    elif sentences:
        selected_sentences = [{
            "id": str(sentences[0].get("id")),
            "text": str(sentences[0].get("text")),
        }]
        sentence_ids = [selected_sentences[0]["id"]]

    excerpt = (
        selected_sentences[0]["text"]
        if selected_sentences
        else str(row.get("text") or "")
    )
    return {
        "documentId": str(row.get("documentId") or row.get("_id") or ""),
        "title": str(row.get("title") or "Untitled MarketGyan evidence"),
        "url": str(row.get("url") or row.get("sourceUrl") or ""),
        "excerpt": excerpt,
        "score": float(row.get("score") or 0.0),
        "source": row.get("source"),
        "publishedAt": row.get("publishedAtIso") or row.get("publishedAt"),
        "chunkId": row.get("chunkId") or row.get("pointId"),
        "contentHash": row.get("contentHash"),
        "sentenceIds": [str(value) for value in sentence_ids],
        "sentences": selected_sentences,
    }


def _usable_citations(rows, limit=5):
    citations = []
    for row in rows:
        citation = _citation_from_row(row)
        if citation["documentId"] and citation["url"] and citation["excerpt"]:
            citations.append(citation)
        if len(citations) >= limit:
            break
    return citations


def run_mock(request: AnalysisRequest, settings: Settings):
    retrieval = RetrievalClient(settings)
    rows = retrieval.search(research_query(request), request.filters)
    citations = _usable_citations(rows)
    if not citations:
        raise ValueError("No retrievable MarketGyan evidence is available")

    if request.mode == "query":
        result = parse_result({
            "mode": "query",
            "answer": (
                "Retrieved MarketGyan evidence points to: "
                + " ".join(citation["excerpt"] for citation in citations[:2])
            ),
            "citations": citations,
            "disclaimer": DISCLAIMER,
            "modelVersion": "mock-rag-local",
        })
        return validate_grounded_result(result, retrieval.seen)

    sector_names = []
    for row in rows:
        for sector in row.get("sectors") or []:
            if sector and sector not in sector_names:
                sector_names.append(sector)
    sector_analysis = [
        {
            "sector": sector,
            "sentiment": "neutral",
            "summary": "Retrieved evidence mentions this sector; the mock service does not infer a trading recommendation.",
            "confidence": 0.5,
            "evidenceIndexes": [0],
        }
        for sector in sector_names[:5]
    ] or [{
        "sector": "Market",
        "sentiment": "unavailable",
        "summary": "No sector-specific evidence was available in retrieved chunks.",
        "confidence": 0.0,
        "evidenceIndexes": [0],
    }]
    result = parse_result({
        "mode": "report",
        "headline": "MarketGyan local RAG report",
        "summary": (
            "This local mock report is generated only from retrieved evidence "
            "and deterministic market context."
        ),
        "sectorAnalysis": sector_analysis,
        "citations": citations,
        "disclaimer": DISCLAIMER,
        "modelVersion": "mock-rag-local",
    })
    return validate_grounded_result(result, retrieval.seen)


def parse_result(value):
    if hasattr(AnalysisResult, "model_validate"):
        return AnalysisResult.model_validate(value)
    return AnalysisResult.parse_obj(value)


def parse_result_json(value):
    if hasattr(AnalysisResult, "model_validate_json"):
        return AnalysisResult.model_validate_json(value)
    return AnalysisResult.parse_raw(value)


def single_pass_json_schema(mode, citation_count):
    evidence_index = {
        "type": "integer",
        "enum": list(range(citation_count)),
    }
    sector_analysis = {
        "type": "array",
        "items": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "sector",
                "sentiment",
                "summary",
                "confidence",
                "evidenceIndexes",
            ],
            "properties": {
                "sector": {"type": "string"},
                "sentiment": {
                    "type": "string",
                    "enum": ["bullish", "bearish", "neutral", "unavailable"],
                },
                "summary": {"type": "string"},
                "confidence": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                },
                "evidenceIndexes": {
                    "type": "array",
                    "items": evidence_index,
                },
            },
        },
    }
    properties = {
        "mode": {"type": "string", "enum": [mode]},
        "citationIndexes": {
            "type": "array",
            "minItems": 1,
            "items": evidence_index,
        },
    }
    if mode == "query":
        properties["answer"] = {"type": "string"}
        required = ["mode", "answer", "citationIndexes"]
    else:
        properties.update({
            "headline": {"type": "string"},
            "summary": {"type": "string"},
            "sectorAnalysis": sector_analysis,
        })
        required = [
            "mode",
            "headline",
            "summary",
            "sectorAnalysis",
            "citationIndexes",
        ]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": properties,
    }


def single_pass_response_format(mode, citation_count):
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "marketgyan_single_pass_%s" % mode,
            "strict": True,
            "schema": single_pass_json_schema(mode, citation_count),
        },
    }


def single_pass_messages(request, evidence):
    request_payload = {
        "mode": request.mode,
        "question": request.question,
        "reportDate": request.reportDate,
        "snapshot": request.snapshot or {},
    }
    return [
        {
            "role": "system",
            "content": (
                "You are MarketGyan, a Nepal market information assistant. "
                "Return only JSON matching the schema. Do not reveal reasoning. "
                "Use only the provided evidence records. Use cautious language. "
                "Do not give buy/sell advice, price targets, guaranteed returns, "
                "or claims that news proves market movement."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "request": request_payload,
                    "instructions": [
                        "For a query, answer the question directly from evidence.",
                        "For a report, provide a headline, summary, and sectorAnalysis.",
                        "citationIndexes must reference evidence index values only.",
                        "evidenceIndexes inside sectorAnalysis also reference evidence indexes.",
                        "If evidence is weak, say the available evidence is limited.",
                    ],
                    "evidence": [
                        {"index": index, **row}
                        for index, row in enumerate(evidence)
                    ],
                },
                ensure_ascii=False,
            ),
        },
    ]


def chat_completion_json(settings, messages, response_format):
    body = {
        "model": openai_model_name(settings.inference_model),
        "messages": messages,
        "temperature": 0,
        "max_tokens": settings.generation_max_tokens,
        "response_format": response_format,
    }
    try:
        with httpx.Client(timeout=settings.request_timeout_seconds) as client:
            response = client.post(
                settings.inference_base_url.rstrip("/") + "/chat/completions",
                json=body,
                headers={"Authorization": "Bearer %s" % settings.inference_api_key},
            )
        response.raise_for_status()
    except httpx.HTTPStatusError as error:
        detail = error.response.text[:1000] if error.response is not None else ""
        raise RuntimeError(
            "Inference request failed with HTTP %s: %s" % (
                error.response.status_code if error.response is not None else "error",
                detail,
            )
        ) from error
    except httpx.HTTPError as error:
        raise RuntimeError("Inference request failed: %s" % error) from error

    raw = (
        response.json()
        .get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    try:
        return json.loads(raw)
    except (TypeError, JSONDecodeError) as error:
        raise ValueError("Inference response was not valid JSON") from error


def materialize_single_pass_result(payload, request, citations, model_version):
    indexes = payload.get("citationIndexes") or []
    if not indexes:
        raise ValueError("Generated output did not select citations")
    if any(not isinstance(index, int) or index < 0 or index >= len(citations) for index in indexes):
        raise ValueError("Generated output selected an invalid citation index")
    selected = []
    seen = set()
    for index in indexes:
        if index in seen:
            continue
        selected.append(citations[index])
        seen.add(index)

    result_payload = {
        "mode": request.mode,
        "citations": selected,
        "disclaimer": DISCLAIMER,
        "modelVersion": model_version,
    }
    if request.mode == "query":
        result_payload["answer"] = payload.get("answer")
    else:
        result_payload["headline"] = payload.get("headline")
        result_payload["summary"] = payload.get("summary")
        result_payload["sectorAnalysis"] = payload.get("sectorAnalysis") or []
    return parse_result(result_payload)


def run_single_pass(request: AnalysisRequest, settings: Settings):
    if settings.mock_enabled:
        return run_mock(request, settings)

    retrieval = RetrievalClient(settings)
    rows = retrieval.search(research_query(request), request.filters)
    evidence = []
    citations = []
    for row in compact_retrieval_rows(rows):
        citation = _citation_from_row(row)
        if citation["documentId"] and citation["url"] and citation["excerpt"]:
            evidence.append(row)
            citations.append(citation)
    if not citations:
        raise ValueError("No retrievable MarketGyan evidence is available")

    payload = chat_completion_json(
        settings,
        messages=single_pass_messages(request, evidence),
        response_format=single_pass_response_format(request.mode, len(citations)),
    )
    result = materialize_single_pass_result(
        payload,
        request,
        citations,
        model_version=settings.inference_model,
    )
    return validate_grounded_result(result, retrieval.seen)


def run_crew(request: AnalysisRequest, settings: Settings):
    """Backward-compatible name for the former CrewAI entrypoint."""

    return run_single_pass(request, settings)

import json

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


def crewai_model_name(model):
    value = str(model or "").strip()
    if value.startswith(("openai/", "hosted_vllm/")):
        return value
    return "openai/" + value


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


def run_crew(request: AnalysisRequest, settings: Settings):
    if settings.mock_enabled:
        return run_mock(request, settings)

    try:
        from crewai import Agent, Crew, LLM, Process, Task
        from crewai.tools import tool
    except ImportError as error:
        raise RuntimeError(
            "CrewAI is not installed. Install requirements-agent.txt."
        ) from error

    retrieval = RetrievalClient(settings)

    @tool("Search MarketGyan financial documents")
    def search_market_documents(query: str) -> str:
        """Search grounded MarketGyan news and regulatory chunks."""
        return json.dumps(
            retrieval.search(query, request.filters),
            ensure_ascii=False,
        )

    llm = LLM(
        model=crewai_model_name(settings.inference_model),
        base_url=settings.inference_base_url,
        api_key=settings.inference_api_key,
        temperature=0,
    )
    researcher = Agent(
        role="MarketGyan Researcher",
        goal="Retrieve only relevant public financial evidence.",
        backstory=(
            "You search the MarketGyan index and never invent sources. "
            "You distinguish evidence from interpretation."
        ),
        tools=[search_market_documents],
        llm=llm,
        verbose=False,
        allow_delegation=False,
    )
    analyst = Agent(
        role="MarketGyan Analyst",
        goal="Interpret retrieved evidence cautiously with deterministic market data.",
        backstory=(
            "You analyze Nepal market information without claiming causation, "
            "forecasting prices, or giving investment advice."
        ),
        llm=llm,
        verbose=False,
        allow_delegation=False,
    )
    publisher = Agent(
        role="MarketGyan Publisher",
        goal="Return strict grounded JSON with exact citations.",
        backstory=(
            "You publish concise informational analysis. Every claim must be "
            "supported by retrieved evidence and include the required disclaimer."
        ),
        llm=llm,
        verbose=False,
        allow_delegation=False,
    )

    research = Task(
        description=(
            "Use the search tool for this request: {research_query}. "
            "Return the relevant retrieved records and no unsupported facts."
        ),
        expected_output="A compact list of retrieved evidence records.",
        agent=researcher,
    )
    analysis = Task(
        description=(
            "Analyze the retrieved evidence and this market snapshot: {snapshot}. "
            "Use cautious language. Do not give buy/sell advice or claim that news "
            "proved a market movement."
        ),
        expected_output="Evidence-supported analysis notes.",
        agent=analyst,
        context=[research],
    )
    publish = Task(
        description=(
            "Publish the requested {mode} as the required structured object. "
            "Citations must copy exact excerpts and URLs returned by retrieval. "
            "When retrieval returns sentenceIds, sentences, chunkId, source, "
            "publishedAt, and contentHash, include those fields so sentence IDs "
            "remain internal anchors backed by visible citation text. "
            f"The disclaimer must be exactly: {DISCLAIMER}"
        ),
        expected_output="A valid MarketGyan AnalysisResult object.",
        agent=publisher,
        context=[research, analysis],
        output_pydantic=AnalysisResult,
    )
    crew = Crew(
        agents=[researcher, analyst, publisher],
        tasks=[research, analysis, publish],
        process=Process.sequential,
        verbose=False,
        memory=False,
    )
    output = crew.kickoff(inputs={
        "research_query": research_query(request),
        "snapshot": json.dumps(request.snapshot or {}, ensure_ascii=False),
        "mode": request.mode,
    })
    result = output.pydantic
    if result is None:
        if output.json_dict:
            result = parse_result(output.json_dict)
        else:
            result = parse_result_json(output.raw)
    result.modelVersion = settings.inference_model
    return validate_grounded_result(result, retrieval.seen)

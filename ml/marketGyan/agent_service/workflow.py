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


def validate_grounded_result(result, retrieved):
    if not result.citations:
        raise ValueError("At least one citation is required")
    available = {
        evidence_key(row.get("url"), row.get("text"))
        for row in retrieved
    }
    for citation in result.citations:
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


def parse_result(value):
    if hasattr(AnalysisResult, "model_validate"):
        return AnalysisResult.model_validate(value)
    return AnalysisResult.parse_obj(value)


def parse_result_json(value):
    if hasattr(AnalysisResult, "model_validate_json"):
        return AnalysisResult.model_validate_json(value)
    return AnalysisResult.parse_raw(value)


def run_crew(request: AnalysisRequest, settings: Settings):
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

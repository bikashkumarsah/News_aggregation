"""Proposal-aligned runtime evaluation helpers for MarketGyan."""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib import parse, request
from urllib.error import HTTPError, URLError

from .dataset import compact_qwen_label, read_jsonl, write_jsonl
from .metrics import benchmark_predictions
from .structured_output import compact_qwen_response_format


COMPACT_SCHEMA_INSTRUCTIONS = (
    "Return only valid compact JSON. Do not use markdown. Do not explain. "
    "Allowed relevance: direct, indirect, not_relevant. "
    "Allowed eventType: market_trading, earnings, capital_action, governance, "
    "project_operations, credit_financing, regulation, monetary_liquidity, "
    "fiscal_macroeconomic, sector_industry, other, not_applicable. "
    "Allowed impactScope: company, sector, market, none. "
    "Allowed impactDirection: bullish, bearish, neutral, uncertain, not_applicable. "
    "Allowed impactHorizon: immediate, short_term, medium_term, not_applicable. "
    "Allowed impactMechanism: earnings_cash_flow, ownership_supply, "
    "financing_liquidity, regulation, demand_revenue, operations_capacity, "
    "valuation_sentiment, market_flow, uncertain, none. "
    "Allowed confidenceBand: low, medium, high. "
    "Required keys: relevance, eventType, impactScope, impactDirection, "
    "impactHorizon, impactMechanism, sectors, symbols, confidenceBand, "
    "evidenceSentenceIds. For not_relevant use eventType=not_applicable, "
    "impactScope=none, impactDirection=not_applicable, "
    "impactHorizon=not_applicable, impactMechanism=none, sectors=[], symbols=[]. "
    "Use only numbered evidenceSentenceIds from the source. Do not show thinking."
)

DISCLAIMER = "Informational analysis based on public data, not investment advice."
FORBIDDEN_ADVICE_PHRASES = (
    "guaranteed profit",
    "guaranteed return",
    "buy signal",
    "sell signal",
    "recommend buying",
    "recommend selling",
)


def prompt_for(row):
    numbered = "\n".join(
        "[%s] %s" % (sentence["id"], sentence["text"])
        for sentence in row.get("sentences", [])
    )
    return "%s\nTitle: %s\n%s" % (
        COMPACT_SCHEMA_INSTRUCTIONS,
        row.get("title", ""),
        numbered,
    )


def chat_messages_for(row, demonstrations=None):
    messages = [{
        "role": "system",
        "content": (
            "You are MarketGyan. Return only the requested compact JSON. "
            "Do not reveal reasoning or thinking."
        ),
    }]
    for example in demonstrations or []:
        messages += [
            {"role": "user", "content": prompt_for(example)},
            {
                "role": "assistant",
                "content": json.dumps(
                    compact_qwen_label(example["gold"]),
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            },
        ]
    messages.append({"role": "user", "content": prompt_for(row)})
    return messages


def three_shot_examples(train_rows):
    examples = []
    for relevance in ("direct", "indirect", "not_relevant"):
        examples.append(next(
            row for row in train_rows
            if row.get("gold", {}).get("relevance") == relevance
        ))
    return examples


def http_json(method, url, payload=None, headers=None, timeout=120):
    encoded = None
    request_headers = dict(headers or {})
    if payload is not None:
        encoded = json.dumps(payload).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")
    req = request.Request(
        url,
        data=encoded,
        headers=request_headers,
        method=method,
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError("HTTP %s from %s: %s" % (
            error.code,
            url,
            detail[:1000],
        )) from error
    except URLError as error:
        raise RuntimeError("Request failed for %s: %s" % (url, error)) from error
    return json.loads(raw) if raw else {}


def chat_completion_json(
    base_url,
    api_key,
    model,
    messages,
    response_format,
    max_tokens=256,
    timeout=180,
):
    body = {
        "model": model,
        "messages": messages,
        "temperature": 0,
        "max_tokens": max_tokens,
        "response_format": response_format,
    }
    response = http_json(
        "POST",
        base_url.rstrip("/") + "/chat/completions",
        body,
        headers={"Authorization": "Bearer %s" % api_key},
        timeout=timeout,
    )
    raw = (
        response.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw}


def run_constrained_condition(
    rows,
    demonstrations,
    base_url,
    api_key,
    model,
    max_tokens=128,
    timeout=180,
):
    predictions = []
    for row in rows:
        try:
            prediction = chat_completion_json(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=chat_messages_for(row, demonstrations),
                response_format=compact_qwen_response_format(
                    row.get("sentences", [])
                ),
                max_tokens=max_tokens,
                timeout=timeout,
            )
        except RuntimeError as error:
            prediction = {"error": str(error)}
        predictions.append({"id": row["id"], "prediction": prediction})
    return predictions


def run_constrained_inference(
    test_path,
    train_path,
    output_dir,
    base_url,
    api_key,
    model,
    limit=None,
    max_tokens=192,
    timeout=180,
    conditions=None,
):
    test_rows = read_jsonl(test_path)
    if limit:
        test_rows = test_rows[:int(limit)]
    train_rows = read_jsonl(train_path)
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    selected = set(conditions or ("zero_shot", "three_shot"))
    available_conditions = {
        "vllm_constrained_zero_shot": [],
        "vllm_constrained_three_shot": three_shot_examples(train_rows),
    }
    metrics = {}
    for name, demonstrations in available_conditions.items():
        short_name = name.replace("vllm_constrained_", "")
        if short_name not in selected:
            continue
        predictions = run_constrained_condition(
            test_rows,
            demonstrations,
            base_url=base_url,
            api_key=api_key,
            model=model,
            max_tokens=max_tokens,
            timeout=timeout,
        )
        prediction_path = output / ("%s.jsonl" % name)
        metrics_path = output / ("%s.metrics.json" % name)
        write_jsonl(prediction_path, predictions)
        condition_metrics = benchmark_predictions(test_rows, predictions)
        condition_metrics["officialGate"] = True
        metrics[name] = condition_metrics
        metrics_path.write_text(
            json.dumps(condition_metrics, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    summary_path = output / "constrained_inference_metrics.json"
    summary_path.write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return {
        "rows": len(test_rows),
        "output": str(output),
        "metrics": metrics,
        "summaryPath": str(summary_path),
    }


def collect_retrieval_results(
    queries_path,
    output_path,
    backend_url,
    top_k=5,
    timeout=120,
):
    queries = json.loads(Path(queries_path).read_text(encoding="utf-8"))
    rows = []
    for item in queries:
        filters = dict(item.get("filters") or {})
        filters["q"] = item["query"]
        filters["limit"] = str(top_k)
        url = "%s/api/market-gyan/search?%s" % (
            backend_url.rstrip("/"),
            parse.urlencode(filters, doseq=True),
        )
        started = time.perf_counter()
        response = http_json("GET", url, timeout=timeout)
        latency = time.perf_counter() - started
        results = response.get("data", [])[:top_k] if response.get("success") else []
        rows.append({
            "id": item["id"],
            "query": item["query"],
            "filters": item.get("filters", {}),
            "judgment": item.get("judgment"),
            "latencySeconds": latency,
            "results": [
                normalize_retrieval_result(result)
                for result in results
            ],
            "manualLabelRequired": True,
        })
    target = Path(output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"queries": len(rows), "output": str(target)}


def normalize_retrieval_result(result):
    return {
        "documentId": result.get("documentId"),
        "chunkId": result.get("chunkId"),
        "chunkIndex": result.get("chunkIndex"),
        "title": result.get("title"),
        "url": result.get("url"),
        "source": result.get("source"),
        "publishedAt": result.get("publishedAtIso") or result.get("publishedAt"),
        "score": result.get("score"),
        "excerpt": result.get("text") or result.get("excerpt"),
        "contentHash": result.get("contentHash"),
        "sentenceIds": result.get("sentenceIds") or [],
        "sentences": result.get("sentences") or [],
        "sectors": result.get("sectors") or [],
        "symbols": result.get("symbols") or [],
    }


def collect_scenario_results(
    scenarios_path,
    output_path,
    agent_url,
    service_token,
    timeout=180,
    report_date=None,
):
    scenarios = json.loads(Path(scenarios_path).read_text(encoding="utf-8"))
    report_date = report_date or datetime.now(timezone.utc).date().isoformat()
    rows = []
    for scenario in scenarios:
        payload = scenario_payload(scenario, report_date)
        started = time.perf_counter()
        error = None
        response = None
        try:
            response = http_json(
                "POST",
                agent_url.rstrip("/") + "/analyze",
                payload,
                headers={"x-market-gyan-token": service_token},
                timeout=timeout,
            )
        except RuntimeError as exc:
            error = str(exc)
        latency = time.perf_counter() - started
        rows.append({
            "id": scenario["id"],
            "mode": scenario["mode"],
            "prompt": scenario["prompt"],
            "expected": scenario.get("expected"),
            "request": payload,
            "response": response,
            "error": error,
            "result": scenario_result(response, error, latency),
        })
    target = Path(output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"scenarios": len(rows), "output": str(target)}


def scenario_payload(scenario, report_date):
    if scenario.get("mode") == "query":
        return {
            "mode": "query",
            "question": scenario.get("prompt"),
            "filters": {},
        }
    return {
        "mode": "report",
        "reportDate": report_date,
        "snapshot": {"status": "proposal_evaluation"},
        "filters": {"limit": 5},
    }


def scenario_result(response, error, latency):
    if error or not isinstance(response, dict):
        return {
            "schemaValid": False,
            "citationsCorrect": False,
            "sentenceCitationsCorrect": False,
            "grounded": False,
            "disclaimerPresent": False,
            "adviceSafe": False,
            "latencySeconds": latency,
            "error": error,
        }
    citations = response.get("citations") or []
    citation_checks = [citation_complete(citation) for citation in citations]
    sentence_checks = [sentence_citation_complete(citation) for citation in citations]
    text = response_text(response)
    disclaimer_present = response.get("disclaimer") == DISCLAIMER
    advice_safe = not any(
        phrase in text.lower()
        for phrase in FORBIDDEN_ADVICE_PHRASES
    )
    return {
        "schemaValid": bool(response.get("mode") and isinstance(citations, list)),
        "citationsCorrect": bool(citations) and all(citation_checks),
        "sentenceCitationsCorrect": bool(citations) and all(sentence_checks),
        "grounded": bool(citations) and all(citation_checks),
        "disclaimerPresent": disclaimer_present,
        "adviceSafe": advice_safe,
        "latencySeconds": latency,
    }


def citation_complete(citation):
    return all(citation.get(field) for field in (
        "documentId",
        "title",
        "url",
        "excerpt",
        "source",
        "chunkId",
        "contentHash",
    )) and bool(citation.get("sentenceIds")) and bool(citation.get("sentences"))


def sentence_citation_complete(citation):
    ids = {str(value) for value in citation.get("sentenceIds") or []}
    sentences = citation.get("sentences") or []
    sentence_map = {
        str(sentence.get("id")): str(sentence.get("text") or "").strip()
        for sentence in sentences
        if isinstance(sentence, dict)
    }
    return bool(ids) and all(sentence_map.get(value) for value in ids)


def response_text(response):
    parts = [
        response.get("answer"),
        response.get("headline"),
        response.get("summary"),
        response.get("disclaimer"),
    ]
    for item in response.get("sectorAnalysis") or []:
        parts.append(item.get("summary"))
    return " ".join(str(part or "") for part in parts)

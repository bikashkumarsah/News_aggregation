import math


def mean(values):
    return sum(values) / float(len(values)) if values else 0.0


def percentile(values, percentile_value):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(
        int(math.ceil((percentile_value / 100.0) * len(ordered))) - 1,
        len(ordered) - 1,
    )
    return ordered[max(index, 0)]


def retrieval_metrics(rows, k=5):
    precisions = []
    judged_queries = 0
    for row in rows:
        results = row.get("results", [])[:k]
        judged = [item for item in results if "relevant" in item]
        if not judged:
            continue
        judged_queries += 1
        precisions.append(
            sum(1 for item in judged if item["relevant"]) / float(k)
        )
    return {
        "queries": len(rows),
        "judgedQueries": judged_queries,
        "precisionAt%d" % k: mean(precisions),
    }


def scenario_metrics(rows):
    schema = []
    citations = []
    sentence_citations = []
    grounding = []
    freshness = []
    latency = []
    for row in rows:
        result = row.get("result", {})
        if "schemaValid" in result:
            schema.append(bool(result["schemaValid"]))
        if "citationsCorrect" in result:
            citations.append(bool(result["citationsCorrect"]))
        if "sentenceCitationsCorrect" in result:
            sentence_citations.append(bool(result["sentenceCitationsCorrect"]))
        if "grounded" in result:
            grounding.append(bool(result["grounded"]))
        if result.get("freshnessSeconds") is not None:
            freshness.append(float(result["freshnessSeconds"]))
        if result.get("latencySeconds") is not None:
            latency.append(float(result["latencySeconds"]))
    return {
        "scenarios": len(rows),
        "schemaAdherence": mean(schema),
        "citationCorrectness": mean(citations),
        "sentenceCitationCorrectness": mean(sentence_citations),
        "grounding": mean(grounding),
        "averageFreshnessSeconds": mean(freshness),
        "averageLatencySeconds": mean(latency),
        "p95LatencySeconds": percentile(latency, 95),
    }


def deployment_gate(
    xlmr_macro_f1,
    qwen_macro_f1,
    qwen_per_class_f1,
    structured_validity,
    evidence_grounding,
    min_per_class_f1=0.40,
):
    checks = {
        "structuredValidity": structured_validity >= 0.95,
        "evidenceGrounding": evidence_grounding >= 0.95,
        "qwenWithinBaselineMargin": qwen_macro_f1 >= xlmr_macro_f1 - 0.05,
        "perClassUsable": all(
            qwen_per_class_f1.get(label, 0.0) >= min_per_class_f1
            for label in ("bullish", "bearish", "neutral", "uncertain")
        ),
    }
    return {
        "eligible": all(checks.values()),
        "checks": checks,
        "thresholds": {
            "structuredValidity": 0.95,
            "evidenceGrounding": 0.95,
            "baselineMargin": 0.05,
            "minPerClassF1": min_per_class_f1,
        },
    }

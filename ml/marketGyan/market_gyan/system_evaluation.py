import math


QWEN_GATE_CONDITION_ORDER = (
    "vllm_constrained_three_shot",
    "vllm_constrained_zero_shot",
    "unsloth_qlora",
    "three_shot",
    "zero_shot",
)
QWEN_TOLERANT_DIAGNOSTIC = "unsloth_qlora_tolerant_diagnostic"


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
    disclaimers = []
    advice = []
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
        if "disclaimerPresent" in result:
            disclaimers.append(bool(result["disclaimerPresent"]))
        if "adviceSafe" in result:
            advice.append(bool(result["adviceSafe"]))
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
        "disclaimerPresence": mean(disclaimers),
        "adviceSafety": mean(advice),
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


def qwen_condition_summary(metrics):
    direction = metrics.get("direction", {})
    relevance = metrics.get("relevance", {})
    event_type = metrics.get("eventType", {})
    per_language = metrics.get("perLanguage", {})
    return {
        "structuredOutputValidity": metrics.get("structuredOutputValidity", 0.0),
        "evidenceGrounding": metrics.get("evidenceGrounding", 0.0),
        "invalidOutputCount": metrics.get("invalidOutputCount", 0),
        "relevanceMacroF1": relevance.get("macroF1", 0.0),
        "relevanceAccuracy": relevance.get("accuracy", 0.0),
        "eventTypeMacroF1": event_type.get("macroF1", 0.0),
        "eventTypeAccuracy": event_type.get("accuracy", 0.0),
        "directionMacroF1": direction.get("macroF1", 0.0),
        "directionAccuracy": direction.get("accuracy", 0.0),
        "sectorMicroF1": metrics.get("sectorMicroF1", 0.0),
        "symbolMicroF1": metrics.get("symbolMicroF1", 0.0),
        "evidenceSentenceF1": metrics.get("evidenceSentenceF1", 0.0),
        "englishRelevanceAccuracy": per_language.get("en", {}).get(
            "relevanceAccuracy",
            0.0,
        ),
        "nepaliRelevanceAccuracy": per_language.get("ne", {}).get(
            "relevanceAccuracy",
            0.0,
        ),
    }


def qwen_condition_summaries(metrics_document):
    return {
        name: qwen_condition_summary(metrics)
        for name, metrics in metrics_document.items()
        if isinstance(metrics, dict) and (
            "structuredOutputValidity" in metrics
            or "relevance" in metrics
        )
    }


def select_qwen_gate_condition(metrics_document, requested=None):
    if requested:
        if requested not in metrics_document:
            raise ValueError("missing Qwen metrics condition: %s" % requested)
        return requested
    for name in QWEN_GATE_CONDITION_ORDER:
        if name in metrics_document:
            return name
    raise ValueError("no official Qwen metrics condition found")


def qwen_model_gate(
    candidate_metrics,
    baseline_metrics=None,
    gate_condition=None,
    baseline_condition="unsloth_qlora",
    min_validity=0.95,
    min_grounding=0.95,
):
    selected_condition = select_qwen_gate_condition(
        candidate_metrics,
        gate_condition,
    )
    selected_metrics = candidate_metrics[selected_condition]
    selected_summary = qwen_condition_summary(selected_metrics)
    official_gate = not (
        selected_metrics.get("repairDiagnostic")
        or selected_metrics.get("officialGate") is False
        or "tolerant" in selected_condition
    )
    checks = {
        "officialGate": official_gate,
        "structuredValidity": (
            selected_summary["structuredOutputValidity"] >= min_validity
        ),
        "evidenceGrounding": (
            selected_summary["evidenceGrounding"] >= min_grounding
        ),
    }
    report = {
        "eligible": all(checks.values()),
        "gateCondition": selected_condition,
        "checks": checks,
        "thresholds": {
            "structuredOutputValidity": min_validity,
            "evidenceGrounding": min_grounding,
        },
        "candidate": selected_summary,
        "candidateConditions": qwen_condition_summaries(candidate_metrics),
    }
    if QWEN_TOLERANT_DIAGNOSTIC in candidate_metrics:
        tolerant = candidate_metrics[QWEN_TOLERANT_DIAGNOSTIC]
        report["tolerantDiagnostic"] = {
            "condition": QWEN_TOLERANT_DIAGNOSTIC,
            "structuredOutputValidity": tolerant.get(
                "structuredOutputValidity",
                0.0,
            ),
            "evidenceGrounding": tolerant.get("evidenceGrounding", 0.0),
            "repairAppliedCount": tolerant.get("repairAppliedCount", 0),
            "officialGate": tolerant.get("officialGate", False),
        }
    if baseline_metrics is not None:
        baseline_name = (
            baseline_condition
            if baseline_condition in baseline_metrics
            else select_qwen_gate_condition(baseline_metrics)
        )
        baseline_summary = qwen_condition_summary(baseline_metrics[baseline_name])
        numeric_keys = [
            key for key, value in selected_summary.items()
            if isinstance(value, (int, float))
        ]
        report["baseline"] = {
            "condition": baseline_name,
            "metrics": baseline_summary,
            "delta": {
                key: selected_summary[key] - baseline_summary.get(key, 0.0)
                for key in numeric_keys
            },
        }
    return report

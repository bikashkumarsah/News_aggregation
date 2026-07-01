import json
import math
import random
import re
from collections import Counter, defaultdict

from .dataset import (
    COMPACT_QWEN_FIELDS,
    CONFIDENCE_BANDS,
    EVENT_TYPES,
    IMPACT_DIRECTIONS,
    IMPACT_HORIZONS,
    IMPACT_MECHANISMS,
    IMPACT_SCOPES,
    NOT_RELEVANT_COMPACT_VALUES,
    RELEVANCE,
)

RELEVANCE_LABELS = ("direct", "indirect", "not_relevant")
DIRECTION_LABELS = ("bullish", "bearish", "neutral", "uncertain")
_COMPACT_ENUMS = {
    "relevance": RELEVANCE,
    "eventType": EVENT_TYPES,
    "impactScope": IMPACT_SCOPES,
    "impactDirection": IMPACT_DIRECTIONS,
    "impactHorizon": IMPACT_HORIZONS,
    "impactMechanism": IMPACT_MECHANISMS,
    "confidenceBand": CONFIDENCE_BANDS,
}
_COMPACT_ALIASES = {
    "relevant": "direct",
    "irrelevant": "not_relevant",
    "not relevant": "not_relevant",
    "not-relevant": "not_relevant",
    "not applicable": "not_applicable",
    "not-applicable": "not_applicable",
    "positive": "bullish",
    "negative": "bearish",
    "mixed": "uncertain",
    "short term": "short_term",
    "short-term": "short_term",
    "medium term": "medium_term",
    "medium-term": "medium_term",
    "ownership supply": "ownership_supply",
    "earnings cash flow": "earnings_cash_flow",
    "financing liquidity": "financing_liquidity",
    "market flow": "market_flow",
}


def classification_metrics(y_true, y_pred, labels):
    per_class = {}
    f1_values = []
    for label in labels:
        true_positive = sum(
            truth == label and prediction == label
            for truth, prediction in zip(y_true, y_pred)
        )
        false_positive = sum(
            truth != label and prediction == label
            for truth, prediction in zip(y_true, y_pred)
        )
        false_negative = sum(
            truth == label and prediction != label
            for truth, prediction in zip(y_true, y_pred)
        )
        precision = (
            true_positive / float(true_positive + false_positive)
            if true_positive + false_positive else 0.0
        )
        recall = (
            true_positive / float(true_positive + false_negative)
            if true_positive + false_negative else 0.0
        )
        f1 = (
            2 * precision * recall / (precision + recall)
            if precision + recall else 0.0
        )
        per_class[label] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": sum(value == label for value in y_true),
        }
        f1_values.append(f1)
    accuracy = (
        sum(truth == prediction for truth, prediction in zip(y_true, y_pred))
        / float(len(y_true)) if y_true else 0.0
    )
    return {
        "accuracy": accuracy,
        "macroF1": sum(f1_values) / float(len(labels)) if labels else 0.0,
        "perClass": per_class,
        "confusion": {
            truth: {
                prediction: sum(
                    observed_truth == truth and observed_prediction == prediction
                    for observed_truth, observed_prediction in zip(y_true, y_pred)
                )
                for prediction in labels
            }
            for truth in labels
        },
    }


def multilabel_micro_f1(expected, predicted):
    true_positive = false_positive = false_negative = 0
    for truth_values, predicted_values in zip(expected, predicted):
        truth = set(truth_values)
        prediction = set(predicted_values)
        true_positive += len(truth & prediction)
        false_positive += len(prediction - truth)
        false_negative += len(truth - prediction)
    denominator = 2 * true_positive + false_positive + false_negative
    return (2 * true_positive / float(denominator)) if denominator else 1.0


def cohen_kappa(first, second):
    if len(first) != len(second):
        raise ValueError("annotation lists must have equal length")
    if not first:
        return 0.0
    observed = sum(a == b for a, b in zip(first, second)) / float(len(first))
    first_counts = Counter(first)
    second_counts = Counter(second)
    labels = set(first_counts) | set(second_counts)
    expected = sum(
        (first_counts[label] / float(len(first)))
        * (second_counts[label] / float(len(second)))
        for label in labels
    )
    return (observed - expected) / (1.0 - expected) if expected < 1 else 1.0


def agreement_metrics(rows):
    pairs = []
    for row in rows:
        submitted = [
            annotation.get("annotation", {})
            for annotation in row.get("annotations", [])
            if annotation.get("status") == "submitted"
        ]
        if len(submitted) >= 2:
            pairs.append(submitted[:2])
    return {
        "doubleAnnotated": len(pairs),
        "relevanceKappa": cohen_kappa(
            [pair[0].get("relevance") for pair in pairs],
            [pair[1].get("relevance") for pair in pairs],
        ),
        "eventTypeKappa": cohen_kappa(
            [pair[0].get("eventType") for pair in pairs],
            [pair[1].get("eventType") for pair in pairs],
        ),
        "directionKappa": cohen_kappa(
            [pair[0].get("impactDirection") for pair in pairs],
            [pair[1].get("impactDirection") for pair in pairs],
        ),
        "sectorMicroF1": multilabel_micro_f1(
            [pair[0].get("sectors", []) for pair in pairs],
            [pair[1].get("sectors", []) for pair in pairs],
        ),
        "symbolMicroF1": multilabel_micro_f1(
            [pair[0].get("symbols", []) for pair in pairs],
            [pair[1].get("symbols", []) for pair in pairs],
        ),
        "evidenceSentenceF1": multilabel_micro_f1(
            [pair[0].get("evidenceSentenceIds", []) for pair in pairs],
            [pair[1].get("evidenceSentenceIds", []) for pair in pairs],
        ),
    }


def candidate_review_metrics(rows):
    fields = (
        "language", "summary", "relevance", "eventType", "impactScope",
        "impactDirection", "impactHorizon", "impactMechanism", "sectors",
        "symbols", "tags", "confidenceBand", "rationale",
        "evidenceSentenceIds",
    )
    unchanged = 0
    field_edits = Counter()
    for row in rows:
        generated = row.get("generated", {})
        gold = row.get("gold", {})
        changed = False
        for field in fields:
            if generated.get(field) != gold.get(field):
                field_edits[field] += 1
                changed = True
        unchanged += not changed
    total = len(rows)
    return {
        "adjudicated": total,
        "acceptedWithoutEdits": unchanged,
        "acceptanceRate": unchanged / float(total) if total else 0.0,
        "editRate": 1.0 - unchanged / float(total) if total else 0.0,
        "fieldEdits": dict(field_edits),
    }


def _prediction_dict(prediction):
    return prediction if isinstance(prediction, dict) else {}


def _string_list(values):
    if not isinstance(values, list):
        return []
    return [str(value) for value in values]


def _normalize_compact_enum(value, allowed):
    normalized = str(value).strip().strip('",.').lower()
    normalized = _COMPACT_ALIASES.get(normalized, normalized)
    normalized = normalized.replace("-", "_").replace(" ", "_")
    return normalized if normalized in allowed else normalized


def _parse_compact_list(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip().rstrip(",")
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    except json.JSONDecodeError:
        pass
    bracket = re.search(r"\[(.*?)\]", text)
    if bracket:
        text = bracket.group(1)
    return [
        item.strip().strip('"\'')
        for item in re.split(r"[,;]", text)
        if item.strip().strip('"\'')
    ]


def _strip_json_fence(raw):
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _quote_unquoted_json_keys(raw):
    return re.sub(
        r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:',
        r'\1"\2":',
        raw,
    )


def _compact_json_candidates(raw):
    text = _strip_json_fence(raw)
    candidates = [text]
    if "{" in text and "}" in text:
        candidates.append(text[text.find("{"):text.rfind("}") + 1])
    expanded = []
    for candidate in candidates:
        expanded.append(candidate)
        expanded.append(_quote_unquoted_json_keys(candidate))
    if "'" in text:
        for candidate in list(expanded):
            expanded.append(candidate.replace("'", '"'))
            expanded.append(_quote_unquoted_json_keys(candidate.replace("'", '"')))
    seen = set()
    for candidate in expanded:
        candidate = candidate.strip()
        if candidate and candidate not in seen:
            seen.add(candidate)
            yield candidate


def _normalize_compact_prediction(prediction):
    if not isinstance(prediction, dict):
        return prediction
    normalized = dict(prediction)
    for field in ("sectors", "symbols", "evidenceSentenceIds"):
        if field in normalized:
            normalized[field] = _parse_compact_list(normalized[field])
    for field, allowed in _COMPACT_ENUMS.items():
        if field in normalized:
            normalized[field] = _normalize_compact_enum(
                normalized[field],
                allowed,
            )
    if normalized.get("relevance") == "not_relevant":
        normalized.update(NOT_RELEVANT_COMPACT_VALUES)
    return normalized


def repair_compact_prediction(prediction):
    """Best-effort diagnostic repair for raw compact Qwen outputs.

    This is intentionally not part of the official strict gate. It exists to
    diagnose whether a failed generation contains latent compact-label content
    such as JavaScript-style objects with unquoted keys.
    """
    if isinstance(prediction, dict) and "raw" not in prediction:
        return _normalize_compact_prediction(prediction)
    raw = prediction.get("raw", "") if isinstance(prediction, dict) else str(prediction)
    for candidate in _compact_json_candidates(raw):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return _normalize_compact_prediction(parsed)

    repaired = {}
    for line in raw.splitlines():
        match = re.match(
            r'\s*[-*]?\s*`?"?([A-Za-z][A-Za-z0-9 _-]+)`?"?\s*[:=]\s*(.+?)\s*$',
            line,
        )
        if not match:
            continue
        key = match.group(1).replace(" ", "").replace("-", "")
        field = next(
            (
                candidate for candidate in COMPACT_QWEN_FIELDS
                if key.lower() == candidate.lower()
            ),
            None,
        )
        if not field:
            continue
        value = match.group(2)
        if field in {"sectors", "symbols", "evidenceSentenceIds"}:
            repaired[field] = _parse_compact_list(value)
        elif field in _COMPACT_ENUMS:
            repaired[field] = _normalize_compact_enum(value, _COMPACT_ENUMS[field])
    if repaired:
        return _normalize_compact_prediction(repaired)
    return prediction


def repair_prediction_rows(prediction_rows):
    repaired_rows = []
    applied = 0
    for row in prediction_rows:
        original = row.get("prediction", row.get("candidate", {}))
        repaired = repair_compact_prediction(original)
        if repaired != original:
            applied += 1
        repaired_row = dict(row)
        repaired_row["prediction"] = repaired
        repaired_rows.append(repaired_row)
    return repaired_rows, {
        "repairAppliedCount": applied,
        "repairDiagnostic": True,
        "officialGate": False,
        "note": (
            "Tolerant repair is diagnostic only. Official structured-output "
            "validity must use strict benchmark_predictions."
        ),
    }


def _prediction_validation_errors(prediction, sentence_ids):
    if not isinstance(prediction, dict):
        return ["prediction must be an object"]
    if "raw" in prediction:
        return ["prediction contains unparsed raw output"]
    errors = []
    missing = [
        field for field in COMPACT_QWEN_FIELDS
        if field not in prediction
    ]
    if missing:
        errors.append("missing fields: %s" % ", ".join(missing))
    enum_fields = {
        "relevance": RELEVANCE,
        "eventType": EVENT_TYPES,
        "impactScope": IMPACT_SCOPES,
        "impactDirection": IMPACT_DIRECTIONS,
        "impactHorizon": IMPACT_HORIZONS,
        "impactMechanism": IMPACT_MECHANISMS,
        "confidenceBand": CONFIDENCE_BANDS,
    }
    for field, allowed in enum_fields.items():
        if field in prediction and prediction.get(field) not in allowed:
            errors.append("%s is invalid" % field)
    for field in ("sectors", "symbols", "evidenceSentenceIds"):
        if field in prediction and not isinstance(prediction.get(field), list):
            errors.append("%s must be an array" % field)
    evidence_ids = prediction.get("evidenceSentenceIds", [])
    if isinstance(evidence_ids, list):
        if any(not isinstance(value, str) for value in evidence_ids):
            errors.append("evidenceSentenceIds values must be strings")
        normalized_evidence_ids = _string_list(evidence_ids)
        unknown = sorted(set(normalized_evidence_ids) - sentence_ids)
        if unknown:
            errors.append(
                "unknown evidence sentence IDs: %s" % ", ".join(unknown)
            )
        if not normalized_evidence_ids:
            errors.append("evidenceSentenceIds requires at least one ID")
    if prediction.get("relevance") == "not_relevant":
        for field, expected in NOT_RELEVANT_COMPACT_VALUES.items():
            if prediction.get(field) != expected:
                errors.append("%s must be %s for not_relevant" % (field, expected))
    elif prediction.get("relevance") in {"direct", "indirect"}:
        if prediction.get("eventType") == "not_applicable":
            errors.append("relevant predictions require an eventType")
        if prediction.get("impactDirection") == "not_applicable":
            errors.append("relevant predictions require an impactDirection")
    return errors


def _valid_prediction(prediction, sentence_ids):
    return not _prediction_validation_errors(prediction, sentence_ids)


def benchmark_predictions(truth_rows, prediction_rows):
    predictions = {
        row.get("id"): row.get("prediction", row.get("candidate", {}))
        for row in prediction_rows
    }
    matched = [
        (row, predictions[row.get("id")])
        for row in truth_rows if row.get("id") in predictions
    ]
    normalized = [
        (row, _prediction_dict(prediction), prediction)
        for row, prediction in matched
    ]
    relevant = [
        (row, prediction) for row, prediction, _ in normalized
        if row["gold"]["relevance"] != "not_relevant"
    ]
    valid = []
    grounded = []
    invalid_examples = []
    for row, prediction, original in normalized:
        sentence_ids = {item["id"] for item in row.get("sentences", [])}
        errors = _prediction_validation_errors(prediction, sentence_ids)
        valid.append(not errors)
        if errors and len(invalid_examples) < 5:
            invalid_examples.append({
                "id": row.get("id"),
                "title": row.get("title"),
                "errors": errors,
                "raw": str(_prediction_dict(original).get("raw", ""))[:500],
            })
        grounded.append(
            bool(_string_list(prediction.get("evidenceSentenceIds", [])))
            and set(_string_list(
                prediction.get("evidenceSentenceIds", [])
            )) <= sentence_ids
        )
    result = {
        "matched": len(matched),
        "coverage": len(matched) / float(len(truth_rows)) if truth_rows else 0.0,
        "structuredOutputValidity": sum(valid) / float(len(valid)) if valid else 0.0,
        "evidenceGrounding": (
            sum(grounded) / float(len(grounded)) if grounded else 0.0
        ),
        "invalidOutputCount": len(valid) - sum(valid),
        "invalidOutputExamples": invalid_examples,
        "relevance": classification_metrics(
            [row["gold"]["relevance"] for row, prediction, _ in normalized],
            [
                prediction.get("relevance", "invalid")
                for _, prediction, _ in normalized
            ],
            RELEVANCE_LABELS,
        ),
        "eventType": classification_metrics(
            [row["gold"]["eventType"] for row, _ in relevant],
            [prediction.get("eventType", "invalid") for _, prediction in relevant],
            sorted({
                row["gold"]["eventType"] for row, _ in relevant
            }),
        ),
        "direction": classification_metrics(
            [row["gold"]["impactDirection"] for row, _ in relevant],
            [
                prediction.get("impactDirection", "invalid")
                for _, prediction in relevant
            ],
            DIRECTION_LABELS,
        ),
        "sectorMicroF1": multilabel_micro_f1(
            [row["gold"].get("sectors", []) for row, _ in matched],
            [prediction.get("sectors", []) for _, prediction in matched],
        ),
        "symbolMicroF1": multilabel_micro_f1(
            [row["gold"].get("symbols", []) for row, _ in matched],
            [prediction.get("symbols", []) for _, prediction in matched],
        ),
        "evidenceSentenceF1": multilabel_micro_f1(
            [
                row["gold"].get("evidenceSentenceIds", [])
                for row, _ in matched
            ],
            [
                _string_list(prediction.get("evidenceSentenceIds", []))
                for _, prediction in matched
            ],
        ),
    }
    result["perLanguage"] = _grouped_benchmark(matched, "language")
    result["perEvent"] = _grouped_benchmark(relevant, "eventType")
    return result


def benchmark_predictions_with_repair(truth_rows, prediction_rows):
    repaired_rows, repair_report = repair_prediction_rows(prediction_rows)
    result = benchmark_predictions(truth_rows, repaired_rows)
    result.update(repair_report)
    return result


def _set_field_error_summary(truth_rows, predictions, field):
    true_positive = false_positive = false_negative = 0
    extra = Counter()
    missing = Counter()
    worst_rows = []
    for row in truth_rows:
        prediction = _prediction_dict(predictions.get(row.get("id"), {}))
        truth = set(_string_list(row["gold"].get(field, [])))
        predicted = set(_string_list(prediction.get(field, [])))
        row_extra = predicted - truth
        row_missing = truth - predicted
        true_positive += len(truth & predicted)
        false_positive += len(row_extra)
        false_negative += len(row_missing)
        extra.update(row_extra)
        missing.update(row_missing)
        if row_extra or row_missing:
            worst_rows.append({
                "id": row.get("id"),
                "title": row.get("title"),
                "extra": sorted(row_extra),
                "missing": sorted(row_missing),
                "errorCount": len(row_extra) + len(row_missing),
            })
    precision = (
        true_positive / float(true_positive + false_positive)
        if true_positive + false_positive else 1.0
    )
    recall = (
        true_positive / float(true_positive + false_negative)
        if true_positive + false_negative else 1.0
    )
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision + recall else 0.0
    )
    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "falseNegative": false_negative,
        "commonExtra": extra.most_common(10),
        "commonMissing": missing.most_common(10),
        "worstRows": sorted(
            worst_rows,
            key=lambda item: (-item["errorCount"], item["id"]),
        )[:10],
    }


def _field_confusion(truth_rows, predictions, field, relevant_only=False):
    pairs = []
    labels = set()
    for row in truth_rows:
        if relevant_only and row["gold"].get("relevance") == "not_relevant":
            continue
        prediction = _prediction_dict(predictions.get(row.get("id"), {}))
        truth = row["gold"].get(field, "missing")
        predicted = prediction.get(field, "invalid")
        labels.add(truth)
        labels.add(predicted)
        pairs.append((truth, predicted))
    ordered = sorted(labels)
    return {
        "labels": ordered,
        "total": len(pairs),
        "matrix": {
            truth: {
                predicted: sum(
                    observed_truth == truth
                    and observed_prediction == predicted
                    for observed_truth, observed_prediction in pairs
                )
                for predicted in ordered
            }
            for truth in ordered
        },
    }


def deep_error_slices(truth_rows, prediction_rows):
    predictions = {
        row.get("id"): row.get("prediction", row.get("candidate", {}))
        for row in prediction_rows
    }
    invalid_rows = []
    relevance_by_language = defaultdict(lambda: {"correct": 0, "total": 0})
    for row in truth_rows:
        prediction = _prediction_dict(predictions.get(row.get("id"), {}))
        sentence_ids = {item["id"] for item in row.get("sentences", [])}
        errors = _prediction_validation_errors(prediction, sentence_ids)
        if errors:
            invalid_rows.append({
                "id": row.get("id"),
                "title": row.get("title"),
                "language": row["gold"].get("language"),
                "relevance": row["gold"].get("relevance"),
                "eventType": row["gold"].get("eventType"),
                "errors": errors,
                "raw": str(prediction.get("raw", ""))[:500],
            })
        language = row["gold"].get("language", "missing")
        relevance_by_language[language]["total"] += 1
        relevance_by_language[language]["correct"] += (
            row["gold"].get("relevance") == prediction.get("relevance")
        )
    return {
        "invalidRows": invalid_rows,
        "relevanceByLanguage": {
            key: {
                **value,
                "accuracy": value["correct"] / float(value["total"]),
            }
            for key, value in sorted(relevance_by_language.items())
        },
        "eventConfusion": _field_confusion(
            truth_rows,
            predictions,
            "eventType",
            relevant_only=True,
        ),
        "directionConfusion": _field_confusion(
            truth_rows,
            predictions,
            "impactDirection",
            relevant_only=True,
        ),
        "setFields": {
            field: _set_field_error_summary(truth_rows, predictions, field)
            for field in ("sectors", "symbols", "evidenceSentenceIds")
        },
    }


def _grouped_benchmark(matched, gold_field):
    groups = defaultdict(list)
    for row, prediction in matched:
        groups[row["gold"].get(gold_field, "missing")].append((row, prediction))
    output = {}
    for value, pairs in groups.items():
        output[value] = {
            "count": len(pairs),
            "relevanceAccuracy": sum(
                row["gold"]["relevance"] == prediction.get("relevance")
                for row, prediction in pairs
            ) / float(len(pairs)),
        }
    return output


def bootstrap_difference(first_scores, second_scores, samples=2000, seed=42):
    if len(first_scores) != len(second_scores) or not first_scores:
        raise ValueError("paired non-empty score lists are required")
    randomizer = random.Random(seed)
    differences = []
    for _ in range(samples):
        indexes = [
            randomizer.randrange(len(first_scores))
            for _ in range(len(first_scores))
        ]
        differences.append(sum(
            second_scores[index] - first_scores[index] for index in indexes
        ) / float(len(indexes)))
    differences.sort()
    lower = differences[int(samples * 0.025)]
    upper = differences[min(samples - 1, int(samples * 0.975))]
    observed = sum(
        second - first for first, second in zip(first_scores, second_scores)
    ) / float(len(first_scores))
    return {"difference": observed, "ci95": [lower, upper]}


def reaction_analysis(rows, material_threshold=0.5, samples=2000, seed=42):
    grouped = defaultdict(list)
    sign_matches = []
    for row in rows:
        direction = row.get("impactDirection")
        reaction = row.get("reaction", {})
        value = reaction.get("firstSessionAbnormalReturn")
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            continue
        grouped[direction].append(value)
        if abs(value) >= material_threshold and direction in {"bullish", "bearish"}:
            sign_matches.append(
                (direction == "bullish" and value > 0)
                or (direction == "bearish" and value < 0)
            )

    randomizer = random.Random(seed)
    means = {}
    intervals = {}
    for direction, values in grouped.items():
        means[direction] = sum(values) / float(len(values))
        bootstrapped = []
        for _ in range(samples):
            sample = [randomizer.choice(values) for _ in values]
            bootstrapped.append(sum(sample) / float(len(sample)))
        bootstrapped.sort()
        intervals[direction] = [
            bootstrapped[int(samples * 0.025)],
            bootstrapped[min(samples - 1, int(samples * 0.975))],
        ]
    return {
        "meanAbnormalReturn": means,
        "bootstrap95": intervals,
        "materialSignAgreement": (
            sum(sign_matches) / float(len(sign_matches))
            if sign_matches else None
        ),
        "materialCases": len(sign_matches),
        "note": "Exploratory association only; not causal or predictive evidence.",
    }

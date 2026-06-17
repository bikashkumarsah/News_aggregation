import math
import random
from collections import Counter, defaultdict

RELEVANCE_LABELS = ("direct", "indirect", "not_relevant")
DIRECTION_LABELS = ("bullish", "bearish", "neutral", "uncertain")


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


def _valid_prediction(prediction, sentence_ids):
    required = (
        "language", "summary", "relevance", "eventType", "impactScope",
        "impactDirection", "impactHorizon", "impactMechanism", "sectors",
        "symbols", "confidenceBand", "rationale", "evidenceSentenceIds",
    )
    return (
        isinstance(prediction, dict)
        and all(field in prediction for field in required)
        and isinstance(prediction.get("sectors"), list)
        and isinstance(prediction.get("symbols"), list)
        and isinstance(prediction.get("evidenceSentenceIds"), list)
        and set(prediction.get("evidenceSentenceIds", [])) <= sentence_ids
    )


def benchmark_predictions(truth_rows, prediction_rows):
    predictions = {
        row.get("id"): row.get("prediction", row.get("candidate", {}))
        for row in prediction_rows
    }
    matched = [
        (row, predictions[row.get("id")])
        for row in truth_rows if row.get("id") in predictions
    ]
    relevant = [
        (row, prediction) for row, prediction in matched
        if row["gold"]["relevance"] != "not_relevant"
    ]
    valid = []
    grounded = []
    for row, prediction in matched:
        sentence_ids = {item["id"] for item in row.get("sentences", [])}
        valid.append(_valid_prediction(prediction, sentence_ids))
        grounded.append(
            bool(prediction.get("evidenceSentenceIds"))
            and set(prediction.get("evidenceSentenceIds", [])) <= sentence_ids
        )
    result = {
        "matched": len(matched),
        "coverage": len(matched) / float(len(truth_rows)) if truth_rows else 0.0,
        "structuredOutputValidity": sum(valid) / float(len(valid)) if valid else 0.0,
        "evidenceGrounding": (
            sum(grounded) / float(len(grounded)) if grounded else 0.0
        ),
        "relevance": classification_metrics(
            [row["gold"]["relevance"] for row, _ in matched],
            [prediction.get("relevance", "invalid") for _, prediction in matched],
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
                prediction.get("evidenceSentenceIds", [])
                for _, prediction in matched
            ],
        ),
    }
    result["perLanguage"] = _grouped_benchmark(matched, "language")
    result["perEvent"] = _grouped_benchmark(relevant, "eventType")
    return result


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

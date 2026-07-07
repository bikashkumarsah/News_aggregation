"""Rare-class training utilities for the XLM-R impact-direction model.

The impact-direction task has a severe minority-class problem: the frozen gold
split contains only ~14 ``neutral`` training rows against 122 ``uncertain`` /
83 ``bullish`` / 62 ``bearish``. Plain argmax over an inverse-frequency-weighted
softmax almost never predicts ``neutral``, so its F1 collapses to ~0 and drags
macro-F1 down.

This module holds the framework-agnostic pieces of the fix so they can be unit
tested without torch:

* class-weight schemes (inverse frequency and Cui et al. effective-number),
* deterministic minority oversampling of the training rows,
* post-hoc per-class logit-bias tuning on validation (the highest-leverage lever
  for recovering minority recall from an already-trained model),
* optional neutral/uncertain label merging for the honest 3-class variant.

The torch-dependent focal loss lives in ``train_xlmr`` and consumes the class
weights produced here.
"""

from collections import Counter

from .metrics import classification_metrics

DIRECTION_LABELS = ("bullish", "bearish", "neutral", "uncertain")
MERGED_DIRECTION_LABELS = ("bullish", "bearish", "neutral_or_uncertain")


def merge_direction_label(direction, merge_neutral_uncertain=False):
    """Optionally collapse the adjacent ``neutral``/``uncertain`` classes.

    Annotators used ``uncertain`` for mixed/ambiguous impact and ``neutral`` for
    "no net effect"; the two overlap heavily. Merging them yields a cleaner
    3-class target when the goal is a trustworthy non-directional bucket rather
    than separating two labels the corpus cannot support.
    """
    if merge_neutral_uncertain and direction in {"neutral", "uncertain"}:
        return "neutral_or_uncertain"
    return direction


def label_counts(labels, all_labels):
    counts = Counter(labels)
    return {label: counts.get(label, 0) for label in all_labels}


def class_weights(
    counts,
    all_labels,
    scheme="inverse",
    beta=0.9999,
    floor=0.0,
    boosts=None,
):
    """Return per-class loss weights aligned to ``all_labels``.

    ``inverse``           -> total / (num_labels * count)  (the original scheme).
    ``effective_number``  -> Cui et al. (2019) class-balanced weight
                             1 / ((1 - beta**count) / (1 - beta)), which is far
                             gentler than raw inverse frequency for extremely
                             rare classes and avoids exploding the neutral weight.
    ``none``              -> uniform weights.

    ``boosts`` is an optional {label: multiplier} map (e.g. an extra push on
    ``neutral``); ``floor`` clamps the minimum weight. Weights are normalised so
    their mean is 1.0, which keeps the effective learning rate stable across
    schemes.
    """
    total = sum(counts.get(label, 0) for label in all_labels)
    num_labels = len(all_labels)
    raw = {}
    for label in all_labels:
        count = max(counts.get(label, 0), 1)
        if scheme == "none":
            weight = 1.0
        elif scheme == "inverse":
            weight = total / float(num_labels * count)
        elif scheme == "effective_number":
            effective = (1.0 - beta ** count) / (1.0 - beta)
            weight = 1.0 / effective
        else:
            raise ValueError("unknown class-weight scheme: %s" % scheme)
        raw[label] = weight

    if boosts:
        for label, multiplier in boosts.items():
            if label in raw:
                raw[label] *= multiplier

    mean = sum(raw.values()) / float(num_labels)
    if mean > 0:
        raw = {label: weight / mean for label, weight in raw.items()}
    if floor:
        raw = {label: max(weight, floor) for label, weight in raw.items()}
    return [raw[label] for label in all_labels]


def direction_row_weight(direction, neutral_factor=4, minority_factor=2):
    """Integer duplication weight for one training row.

    ``neutral`` rows are duplicated the most (they are the scarcest and the
    target of this work); ``bearish``/``uncertain`` get a smaller minority bump;
    the majority classes stay at weight 1.
    """
    if direction == "neutral":
        return max(1, neutral_factor)
    if direction in {"bearish", "uncertain"}:
        return max(1, minority_factor)
    return 1


def oversample_rows(rows, get_direction, neutral_factor=4, minority_factor=2):
    """Deterministically duplicate minority-direction rows.

    Mirrors the Qwen ``oversample_training_rows`` pattern (physical row
    duplication rather than a sampler) so the expansion is reproducible and
    framework independent. ``get_direction`` maps a row to its (possibly merged)
    direction label. Original row order is preserved; duplicates are appended in
    order so the result is stable.
    """
    selected = []
    for row in rows:
        weight = direction_row_weight(
            get_direction(row),
            neutral_factor=neutral_factor,
            minority_factor=minority_factor,
        )
        selected.extend([row] * weight)
    return selected


def oversampling_summary(rows, get_direction, neutral_factor=4, minority_factor=2):
    before = Counter(get_direction(row) for row in rows)
    weights = [
        direction_row_weight(
            get_direction(row),
            neutral_factor=neutral_factor,
            minority_factor=minority_factor,
        )
        for row in rows
    ]
    after = Counter()
    for row, weight in zip(rows, weights):
        after[get_direction(row)] += weight
    return {
        "originalCount": len(rows),
        "oversampledCount": sum(weights),
        "before": dict(before),
        "after": dict(after),
        "neutralFactor": neutral_factor,
        "minorityFactor": minority_factor,
    }


def _apply_bias(logits, bias):
    return [
        max(range(len(row)), key=lambda index: row[index] + bias[index])
        for row in logits
    ]


def _macro_f1_for(predicted_indices, true_indices, labels, present_only=False):
    id_to_label = {index: label for index, label in enumerate(labels)}
    y_true = [id_to_label[index] for index in true_indices]
    y_pred = [id_to_label[index] for index in predicted_indices]
    scored_labels = list(labels)
    if present_only:
        present = set(y_true)
        scored_labels = [label for label in labels if label in present] or list(labels)
    metrics = classification_metrics(y_true, y_pred, scored_labels)
    return metrics["macroF1"], metrics


def tune_logit_bias(
    logits,
    true_indices,
    labels,
    grid=None,
    passes=2,
    present_only=False,
):
    """Coordinate-ascent search of an additive per-class logit bias.

    A model can be *directionally aware* yet never win ``neutral`` at argmax
    because the class is rare and its logits sit just below the majority. Adding
    a small learned bias to each class logit and re-taking argmax recovers that
    recall without retraining. The bias is fit on validation only (never test),
    maximising macro-F1, and is returned so it can be applied at inference time.

    Pure Python so it is unit-testable without numpy/torch. Returns
    ``(bias, best_macro_f1, metrics)``.
    """
    if grid is None:
        grid = [round(-4.0 + 0.5 * step, 3) for step in range(17)]  # -4.0 .. 4.0
    num_labels = len(labels)
    bias = [0.0] * num_labels
    best_f1, best_metrics = _macro_f1_for(
        _apply_bias(logits, bias), true_indices, labels, present_only
    )
    for _ in range(passes):
        improved = False
        for label_index in range(num_labels):
            current = bias[label_index]
            for candidate in grid:
                trial = list(bias)
                trial[label_index] = candidate
                f1, metrics = _macro_f1_for(
                    _apply_bias(logits, trial), true_indices, labels, present_only
                )
                if f1 > best_f1 + 1e-9:
                    best_f1, best_metrics, current = f1, metrics, candidate
                    improved = True
            bias[label_index] = current
        if not improved:
            break
    return bias, best_f1, best_metrics


def evaluate_with_bias(logits, true_indices, labels, bias):
    """Apply a fitted bias to a fresh split and return full metrics."""
    predicted = _apply_bias(logits, bias)
    _, metrics = _macro_f1_for(predicted, true_indices, labels)
    return metrics

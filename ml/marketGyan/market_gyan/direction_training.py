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
    """Integer duplication weight for one training row (legacy, label-name based).

    Kept for backward compatibility. Prefer :func:`balanced_row_weights`, which
    is count-driven and does not require knowing which labels are minorities in
    advance. This helper hardcodes ``neutral`` as scarcest and
    ``bearish``/``uncertain`` as secondary minorities, which is wrong when
    ``uncertain`` is actually the majority class.
    """
    if direction == "neutral":
        return max(1, neutral_factor)
    if direction in {"bearish", "uncertain"}:
        return max(1, minority_factor)
    return 1


def balanced_row_weights(labels, all_labels, cap=6, power=0.5):
    """Count-driven per-row oversampling weights.

    Rather than hardcoding which classes are rare, size each class's duplication
    from its actual frequency: ``weight(c) = round((max_count / count_c) ** power)``,
    clamped to ``[1, cap]``. ``power`` in (0, 1] softens the ratio so the rarest
    class is boosted without fully inverting the distribution (``power=1`` would
    equalise every class and can swamp training with duplicated rare rows; 0.5 is
    a gentle square-root balance). The majority class always gets weight 1, so no
    class is ever starved relative to another the way a hardcoded list can do.

    Returns ``{label: int_weight}`` for labels that are present.
    """
    counts = Counter(labels)
    if not counts:
        return {label: 1 for label in all_labels}
    max_count = max(counts.values())
    weights = {}
    for label in all_labels:
        count = counts.get(label, 0)
        if count <= 0:
            weights[label] = 1
            continue
        raw = (max_count / float(count)) ** power
        weights[label] = int(max(1, min(cap, round(raw))))
    return weights


def oversample_rows(
    rows,
    get_direction,
    all_labels=None,
    cap=6,
    power=0.5,
    neutral_factor=None,
    minority_factor=None,
):
    """Deterministically duplicate rows toward class balance.

    Default behaviour is count-driven (:func:`balanced_row_weights`): the rarest
    class is boosted the most and the majority class is left at weight 1, using
    the actual label distribution of ``rows``. Pass ``neutral_factor`` /
    ``minority_factor`` to fall back to the legacy label-name scheme.

    Original row order is preserved; duplicates are appended in order so the
    result is fully reproducible and framework independent.
    """
    directions = [get_direction(row) for row in rows]
    if neutral_factor is not None or minority_factor is not None:
        nf = 4 if neutral_factor is None else neutral_factor
        mf = 2 if minority_factor is None else minority_factor
        weight_of = lambda direction: direction_row_weight(
            direction, neutral_factor=nf, minority_factor=mf
        )
    else:
        labels = all_labels or sorted(set(directions))
        weights = balanced_row_weights(directions, labels, cap=cap, power=power)
        weight_of = lambda direction: weights.get(direction, 1)
    selected = []
    for row, direction in zip(rows, directions):
        selected.extend([row] * weight_of(direction))
    return selected


def oversampling_summary(
    rows,
    get_direction,
    all_labels=None,
    cap=6,
    power=0.5,
    neutral_factor=None,
    minority_factor=None,
):
    directions = [get_direction(row) for row in rows]
    before = Counter(directions)
    if neutral_factor is not None or minority_factor is not None:
        nf = 4 if neutral_factor is None else neutral_factor
        mf = 2 if minority_factor is None else minority_factor
        weights = {
            label: direction_row_weight(label, neutral_factor=nf, minority_factor=mf)
            for label in before
        }
    else:
        labels = all_labels or sorted(before)
        weights = balanced_row_weights(directions, labels, cap=cap, power=power)
    after = Counter()
    for direction in directions:
        after[direction] += weights.get(direction, 1)
    return {
        "originalCount": len(rows),
        "oversampledCount": sum(after.values()),
        "before": dict(before),
        "after": dict(after),
        "perClassWeight": {
            label: weights.get(label, 1) for label in sorted(before)
        },
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

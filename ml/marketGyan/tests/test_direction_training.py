import unittest

from market_gyan.direction_training import (
    balanced_row_weights,
    class_weights,
    direction_row_weight,
    evaluate_with_bias,
    label_counts,
    merge_direction_label,
    oversample_rows,
    oversampling_summary,
    tune_logit_bias,
)

DIRECTION_LABELS = ["bullish", "bearish", "neutral", "uncertain"]


def gold(direction):
    return {"gold": {"impactDirection": direction, "relevance": "direct"}}


class DirectionTrainingTest(unittest.TestCase):
    def test_merge_collapses_only_when_enabled(self):
        self.assertEqual(merge_direction_label("neutral"), "neutral")
        self.assertEqual(
            merge_direction_label("neutral", merge_neutral_uncertain=True),
            "neutral_or_uncertain",
        )
        self.assertEqual(
            merge_direction_label("uncertain", merge_neutral_uncertain=True),
            "neutral_or_uncertain",
        )
        self.assertEqual(
            merge_direction_label("bullish", merge_neutral_uncertain=True),
            "bullish",
        )

    def test_inverse_weights_reward_the_rare_class_most(self):
        counts = {"bullish": 83, "bearish": 62, "neutral": 14, "uncertain": 122}
        weights = dict(zip(
            DIRECTION_LABELS,
            class_weights(counts, DIRECTION_LABELS, scheme="inverse"),
        ))
        self.assertGreater(weights["neutral"], weights["bullish"])
        self.assertGreater(weights["neutral"], weights["uncertain"])
        # Normalised so the mean weight is ~1.
        self.assertAlmostEqual(sum(weights.values()) / 4.0, 1.0, places=5)

    def test_effective_number_is_gentler_than_inverse_for_rare_class(self):
        counts = {"bullish": 83, "bearish": 62, "neutral": 14, "uncertain": 122}
        inverse = dict(zip(
            DIRECTION_LABELS,
            class_weights(counts, DIRECTION_LABELS, scheme="inverse"),
        ))
        effective = dict(zip(
            DIRECTION_LABELS,
            class_weights(counts, DIRECTION_LABELS, scheme="effective_number"),
        ))
        # Both up-weight neutral, but the effective-number scheme is less extreme.
        self.assertGreater(effective["neutral"], 1.0)
        self.assertLess(effective["neutral"], inverse["neutral"])

    def test_neutral_boost_multiplies_before_normalisation(self):
        counts = {"bullish": 83, "bearish": 62, "neutral": 14, "uncertain": 122}
        base = dict(zip(
            DIRECTION_LABELS,
            class_weights(counts, DIRECTION_LABELS, scheme="inverse"),
        ))
        boosted = dict(zip(
            DIRECTION_LABELS,
            class_weights(
                counts,
                DIRECTION_LABELS,
                scheme="inverse",
                boosts={"neutral": 2.0},
            ),
        ))
        self.assertGreater(boosted["neutral"], base["neutral"])

    def test_direction_row_weight_prioritises_neutral(self):
        # Legacy label-name scheme (kept for backward compatibility).
        self.assertEqual(direction_row_weight("neutral"), 4)
        self.assertEqual(direction_row_weight("bearish"), 2)
        self.assertEqual(direction_row_weight("uncertain"), 2)
        self.assertEqual(direction_row_weight("bullish"), 1)

    def test_balanced_weights_only_boost_the_genuinely_rare_class(self):
        # Real train distribution: uncertain is the MAJORITY, not a minority.
        labels = ["uncertain"] * 122 + ["bullish"] * 83 + ["bearish"] * 62 + ["neutral"] * 14
        weights = balanced_row_weights(
            labels, DIRECTION_LABELS, cap=6, power=0.5
        )
        # Majority classes stay at 1; only neutral is boosted.
        self.assertEqual(weights["uncertain"], 1)
        self.assertEqual(weights["bullish"], 1)
        self.assertEqual(weights["bearish"], 1)
        self.assertGreater(weights["neutral"], 1)
        self.assertLessEqual(weights["neutral"], 6)

    def test_count_driven_oversample_does_not_starve_a_middle_class(self):
        # The old hardcoded scheme doubled uncertain (majority) and left bullish
        # at 1, starving bullish. The count-driven default must not do that.
        rows = (
            [gold("uncertain")] * 12
            + [gold("bullish")] * 8
            + [gold("neutral")] * 2
        )
        get = lambda row: row["gold"]["impactDirection"]
        summary = oversampling_summary(rows, get, all_labels=DIRECTION_LABELS)
        # bullish is never duplicated below the majority (uncertain) count.
        self.assertEqual(summary["after"]["uncertain"], 12)
        self.assertEqual(summary["after"]["bullish"], 8)
        self.assertGreaterEqual(summary["after"]["neutral"], 2)

    def test_legacy_factors_still_available_via_kwargs(self):
        rows = [gold("bullish"), gold("neutral"), gold("bearish")]
        get = lambda row: row["gold"]["impactDirection"]
        expanded = oversample_rows(
            rows, get, neutral_factor=4, minority_factor=2
        )
        directions = [get(row) for row in expanded]
        self.assertEqual(directions.count("neutral"), 4)
        self.assertEqual(directions.count("bearish"), 2)
        self.assertEqual(directions.count("bullish"), 1)

    def test_label_counts_fills_absent_labels_with_zero(self):
        counts = label_counts(["bullish", "bullish", "neutral"], DIRECTION_LABELS)
        self.assertEqual(counts["bullish"], 2)
        self.assertEqual(counts["bearish"], 0)

    def test_logit_bias_recovers_a_swallowed_neutral_class(self):
        # neutral logit always sits just below bullish; argmax never picks it.
        labels = ["bullish", "neutral"]
        logits = [
            [2.0, 1.9],  # truly neutral, but bullish wins at argmax
            [2.0, 1.8],  # truly neutral
            [3.0, 0.1],  # truly bullish
        ]
        truth = [1, 1, 0]
        # Argmax baseline: predicts bullish for all -> neutral F1 = 0.
        baseline = evaluate_with_bias(logits, truth, labels, [0.0, 0.0])
        self.assertEqual(baseline["perClass"]["neutral"]["f1"], 0.0)
        bias, tuned_f1, metrics = tune_logit_bias(logits, truth, labels)
        # A positive bias on neutral flips the two neutral rows without losing
        # the clearly-bullish row.
        self.assertGreater(metrics["perClass"]["neutral"]["f1"], 0.0)
        self.assertGreaterEqual(tuned_f1, baseline["macroF1"])


if __name__ == "__main__":
    unittest.main()

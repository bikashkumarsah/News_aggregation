import unittest
from pathlib import Path

from market_gyan.dataset import read_jsonl
from market_gyan.qwen_training import (
    TARGETED_V2_SPLIT_HASH,
    assert_targeted_v2_frozen_split,
    legacy_row_weight,
    load_split_manifest_hash,
    oversample_training_rows,
    oversampling_summary,
    targeted_v2_row_weight,
)
from test_dataset import row


class QwenTrainingTest(unittest.TestCase):
    def test_legacy_oversampling_preserves_append_order(self):
        values = [
            row(1, "direct", "earnings", "bullish"),
            row(300, "indirect", "regulation", "neutral"),
            row(401, "not_relevant", "not_applicable", "not_applicable"),
        ]
        selected = oversample_training_rows(values, profile="legacy")

        self.assertEqual(
            [item["id"] for item in selected],
            [
                values[0]["id"],
                values[1]["id"],
                values[2]["id"],
                values[1]["id"],
                values[1]["id"],
                values[2]["id"],
                values[1]["id"],
            ],
        )
        self.assertEqual(
            len(selected),
            sum(legacy_row_weight(value) for value in values),
        )

    def test_targeted_v2_weight_rules_and_cap(self):
        value = row(300, "indirect", "sector_industry", "neutral")
        value["gold"]["language"] = "ne"
        value["gold"]["impactScope"] = "sector"

        self.assertEqual(targeted_v2_row_weight(value), 8)
        selected = oversample_training_rows([value], profile="targeted_v2")
        self.assertEqual(len(selected), 8)

    def test_targeted_v2_frozen_train_expands_to_expected_count(self):
        root = Path(__file__).resolve().parents[1]
        train = read_jsonl(root / "data/processed/splits/train.jsonl")
        manifest_hash = load_split_manifest_hash(
            root / "data/processed/splits/manifest.json"
        )
        summary = oversampling_summary(train, "targeted_v2")

        self.assertEqual(manifest_hash, TARGETED_V2_SPLIT_HASH)
        self.assertEqual(summary["originalTrainCount"], 350)
        self.assertEqual(summary["weightedTrainCount"], 922)
        self.assertLessEqual(
            max(int(weight) for weight in summary["weightHistogram"]),
            8,
        )
        assert_targeted_v2_frozen_split(summary, manifest_hash)

    def test_none_profile_keeps_rows_once(self):
        values = [row(1), row(2)]
        self.assertEqual(oversample_training_rows(values, "none"), values)
        self.assertEqual(
            oversampling_summary(values, "none")["weightHistogram"],
            {"1": 2},
        )


if __name__ == "__main__":
    unittest.main()

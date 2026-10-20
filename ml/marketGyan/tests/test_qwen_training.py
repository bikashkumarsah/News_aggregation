import json
import re
import unittest
from pathlib import Path

from market_gyan.dataset import compact_qwen_label, read_jsonl
from market_gyan.proposal_evaluation import (
    COMPACT_SCHEMA_INSTRUCTIONS,
    TRAINING_SCHEMA_INSTRUCTIONS,
    prompt_for,
)
from market_gyan.qwen_training import (
    TARGETED_V2_SPLIT_HASH,
    assert_targeted_v2_frozen_split,
    fit_rows_to_token_budget,
    legacy_row_weight,
    load_split_manifest_hash,
    oversample_training_rows,
    oversampling_summary,
    qwen_training_messages,
    targeted_v2_row_weight,
)
from market_gyan.train_qwen_qlora import fit_examples, format_example
from test_dataset import row


class WhitespaceTokenizer:
    """Stands in for a Qwen tokenizer: one token per whitespace-separated word."""

    def apply_chat_template(self, messages, tokenize, add_generation_prompt, enable_thinking):
        return " ".join("<%s> %s" % (item["role"], item["content"]) for item in messages)

    def __call__(self, text):
        return {"input_ids": text.split()}


def long_row(sentence_count=6, cited=("S2",)):
    value = row(1, "direct", "earnings", "bullish")
    value["sentences"] = [
        {"id": "S%d" % index, "text": "Sentence %d about bank profit growth." % index}
        for index in range(1, sentence_count + 1)
    ]
    value["gold"]["evidenceSentenceIds"] = list(cited)
    return value


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

    def test_training_prompt_shows_the_numbered_sentences_the_label_cites(self):
        value = long_row(sentence_count=2)
        user, assistant = qwen_training_messages(value)

        self.assertEqual(user["content"], prompt_for(value, TRAINING_SCHEMA_INSTRUCTIONS))
        self.assertIn("[S2] Sentence 2", user["content"])
        self.assertNotIn("Do not show thinking", user["content"])
        self.assertEqual(
            assistant["content"],
            json.dumps(compact_qwen_label(value["gold"]), ensure_ascii=False, sort_keys=True),
        )

    def test_training_and_evaluation_instructions_stay_in_sync(self):
        # Evaluation of existing adapters keeps its exact prompt text...
        self.assertEqual(
            COMPACT_SCHEMA_INSTRUCTIONS,
            TRAINING_SCHEMA_INSTRUCTIONS + " Do not show thinking.",
        )
        # ...and the CLI trains on the notebook's instructions verbatim.
        source = (
            Path(__file__).resolve().parents[1] / "notebooks/build_notebooks.py"
        ).read_text(encoding="utf-8")
        literal = re.search(
            r"COMPACT_SCHEMA_INSTRUCTIONS = \((.*?)\n\)", source, re.S
        ).group(1)
        notebook_instructions = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', literal))
        self.assertEqual(notebook_instructions, TRAINING_SCHEMA_INSTRUCTIONS)

    def test_legacy_prompt_format_reproduces_the_old_cli_prompt(self):
        value = row(1)
        user, _ = qwen_training_messages(value, "legacy-title-text")
        self.assertEqual(
            user["content"],
            "Return only compact NEPSE-Impact JSON. Do not give investment advice.\n"
            "Title: Notice 001\n"
            "Text: The notice changes capital requirements for listed banks.",
        )

    def test_long_examples_drop_uncited_sentences_instead_of_the_answer(self):
        tokenizer = WhitespaceTokenizer()
        value = long_row(sentence_count=6, cited=("S2",))
        full = len(format_example(value, tokenizer).split())

        fitted, report = fit_examples([value], tokenizer, "numbered-v1", full - 1)

        kept = [sentence["id"] for sentence in fitted[0]["sentences"]]
        self.assertEqual(kept, ["S1", "S2", "S3", "S4", "S5"])
        self.assertEqual(report["trimmedRows"], 1)
        self.assertTrue(report["applied"])
        text = format_example(fitted[0], tokenizer)
        self.assertLessEqual(len(text.split()), full - 1)
        self.assertTrue(text.endswith(json.dumps(
            compact_qwen_label(value["gold"]), ensure_ascii=False, sort_keys=True
        )))

    def test_examples_that_cannot_fit_fail_loudly(self):
        tokenizer = WhitespaceTokenizer()
        value = long_row(sentence_count=6, cited=("S1", "S6"))

        def count_tokens(candidate):
            return len(format_example(candidate, tokenizer).split())

        with self.assertRaisesRegex(ValueError, "row-001"):
            fit_rows_to_token_budget([value], count_tokens, 10)

        unchanged, report = fit_examples([value], tokenizer, "legacy-title-text", 10)
        self.assertEqual(unchanged, [value])
        self.assertFalse(report["applied"])


if __name__ == "__main__":
    unittest.main()

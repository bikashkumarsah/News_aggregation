import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from market_gyan.dataset import (
    COMPACT_QWEN_FIELDS,
    CORE_EVENT_TYPES,
    balanced_group_split,
    chronological_group_split,
    compact_qwen_label,
    coverage_report,
    dataset_readiness,
    read_jsonl,
    split_manifest,
    validate_dataset,
    write_jsonl,
)


def row(index, relevance="direct", event_type="earnings", direction="bullish"):
    published = datetime(2025, 1, 1, tzinfo=timezone.utc) + timedelta(days=index)
    relevant = relevance != "not_relevant"
    label = {
        "language": "en" if index % 2 else "ne",
        "summary": "A sufficiently detailed factual Nepal market summary.",
        "relevance": relevance,
        "eventType": event_type if relevant else "not_applicable",
        "impactScope": "company" if relevance == "direct" else (
            "market" if relevant else "none"
        ),
        "impactDirection": direction if relevant else "not_applicable",
        "impactHorizon": "short_term" if relevant else "not_applicable",
        "impactMechanism": "earnings_cash_flow" if relevant else "none",
        "sectors": ["Banking"] if relevant else [],
        "symbols": ["NABIL"] if relevance == "direct" else [],
        "tags": ["capital"],
        "confidenceBand": "medium",
        "rationale": "The supplied numbered sentence supports this cautious classification.",
        "evidenceSentenceIds": ["S1"],
    }
    return {
        "id": "row-%03d" % index,
        "documentId": "doc-%03d" % index,
        "schemaVersion": 2,
        "ontologyVersion": "nepse-impact-ontology-v1",
        "title": "Notice %03d" % index,
        "excerpt": "The notice changes capital requirements for listed banks.",
        "sentences": [{
            "id": "S1",
            "text": "The notice changes capital requirements for listed banks.",
        }],
        "contentHash": "hash-%03d-0123456789" % index,
        "duplicateGroupId": "group-%03d" % index,
        "source": {
            "name": "ShareSansar" if index < 300 else "Online Khabar",
            "url": "https://example.com/%03d" % index,
        },
        "publishedAt": published.isoformat(),
        "generated": dict(label),
        "gold": dict(label),
        "model": {"name": "gemma", "schemaVersion": 2},
        "adjudicatedAt": published.isoformat(),
        "adjudicatedBy": "reviewer-3",
    }


def ready_rows():
    events = sorted(CORE_EVENT_TYPES)
    rows = []
    for index in range(300):
        rows.append(row(
            index,
            "direct",
            events[index % len(events)],
            "bullish" if index % 2 else "bearish",
        ))
    for index in range(300, 400):
        rows.append(row(
            index,
            "indirect",
            events[index % len(events)],
            "neutral" if index % 2 else "uncertain",
        ))
    for index in range(400, 500):
        rows.append(row(index, "not_relevant", "not_applicable", "not_applicable"))
    return rows


class DatasetTest(unittest.TestCase):
    def test_validates_grounded_v2_rows(self):
        self.assertEqual(validate_dataset([row(1)]), [])

    def test_rejects_unknown_sentence_evidence(self):
        value = row(1)
        value["gold"]["evidenceSentenceIds"] = ["S99"]
        issues = validate_dataset([value])
        self.assertIn("unknown evidence", " ".join(issues[0]["errors"]))

    def test_rejects_placeholder_gold_training_text(self):
        value = row(1)
        value["gold"]["summary"] = (
            "Notice 001. The source provides evidence for an earnings label."
        )
        value["gold"]["rationale"] = (
            "This targeted gold label uses source sentences from ShareSansar."
        )
        issues = validate_dataset([value])
        self.assertIn("placeholder training text", " ".join(issues[0]["errors"]))

    def test_chronological_split_keeps_near_duplicate_groups_together(self):
        rows = [row(index) for index in range(5)]
        rows[1]["duplicateGroupId"] = rows[0]["duplicateGroupId"]
        splits = chronological_group_split(rows, train_ratio=0.4, validation_ratio=0.2)
        locations = {
            item["id"]: name
            for name, values in splits.items()
            for item in values
        }
        self.assertEqual(locations["row-000"], locations["row-001"])

    def test_balanced_split_keeps_groups_and_balances_core_labels(self):
        rows = ready_rows()
        rows[1]["duplicateGroupId"] = rows[0]["duplicateGroupId"]
        rows[0]["duplicateGroupId"] = "shared-group"
        rows[1]["duplicateGroupId"] = "shared-group"

        splits = balanced_group_split(rows)

        self.assertEqual(
            {name: len(values) for name, values in splits.items()},
            {"train": 350, "validation": 75, "test": 75},
        )
        locations = {
            item["id"]: name
            for name, values in splits.items()
            for item in values
        }
        self.assertEqual(locations["row-000"], locations["row-001"])
        for values in splits.values():
            coverage = coverage_report(values)
            self.assertTrue({"direct", "indirect", "not_relevant"} <= set(
                coverage["relevance"]
            ))
            self.assertTrue({"en", "ne"} <= set(coverage["languages"]))

    def test_compact_qwen_label_removes_long_fields_and_normalizes_negatives(self):
        compact = compact_qwen_label(row(1, "direct", "earnings", "bullish")["gold"])
        self.assertEqual(set(compact), set(COMPACT_QWEN_FIELDS))
        self.assertNotIn("summary", compact)
        self.assertNotIn("rationale", compact)
        self.assertEqual(compact["relevance"], "direct")

        negative = compact_qwen_label(
            row(2, "not_relevant", "not_applicable", "not_applicable")["gold"]
        )
        self.assertEqual(negative["eventType"], "not_applicable")
        self.assertEqual(negative["impactScope"], "none")
        self.assertEqual(negative["impactDirection"], "not_applicable")
        self.assertEqual(negative["impactHorizon"], "not_applicable")
        self.assertEqual(negative["impactMechanism"], "none")
        self.assertEqual(negative["sectors"], [])
        self.assertEqual(negative["symbols"], [])

    def test_jsonl_round_trip_and_coverage(self):
        rows = [row(1), row(2, "indirect", "regulation", "neutral")]
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "rows.jsonl"
            write_jsonl(target, rows)
            loaded = read_jsonl(target)
        self.assertEqual(len(loaded), 2)
        self.assertEqual(coverage_report(loaded)["relevance"]["direct"], 1)

    def test_dataset_gate_enforces_nepse_impact_500_quotas(self):
        rows = ready_rows()
        self.assertTrue(dataset_readiness(rows)["ready"])
        self.assertFalse(dataset_readiness(rows[:-1])["ready"])

    def test_split_manifest_is_deterministic(self):
        rows = [row(index) for index in range(6)]
        splits = chronological_group_split(rows)
        first = split_manifest(splits)
        second = split_manifest(splits)
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertEqual(first["schemaVersion"], 2)

    def test_balanced_manifest_records_strategy(self):
        splits = balanced_group_split(ready_rows())
        manifest = split_manifest(splits, strategy="balanced")
        self.assertEqual(
            manifest["splitStrategy"],
            "balanced-near-duplicate-grouped-70-15-15",
        )


if __name__ == "__main__":
    unittest.main()

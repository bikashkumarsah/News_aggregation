import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

RELEVANCE = {"direct", "indirect", "not_relevant"}
LANGUAGES = {"en", "ne", "mixed"}
EVENT_TYPES = {
    "market_trading", "earnings", "capital_action", "governance",
    "project_operations", "credit_financing", "regulation",
    "monetary_liquidity", "fiscal_macroeconomic", "sector_industry",
    "other", "not_applicable",
}
CORE_EVENT_TYPES = EVENT_TYPES - {"other", "not_applicable"}
IMPACT_SCOPES = {"company", "sector", "market", "none"}
IMPACT_DIRECTIONS = {
    "bullish", "bearish", "neutral", "uncertain", "not_applicable",
}
IMPACT_HORIZONS = {
    "immediate", "short_term", "medium_term", "not_applicable",
}
IMPACT_MECHANISMS = {
    "earnings_cash_flow", "ownership_supply", "financing_liquidity",
    "regulation", "demand_revenue", "operations_capacity",
    "valuation_sentiment", "market_flow", "uncertain", "none",
}
CONFIDENCE_BANDS = {"low", "medium", "high"}
COMPACT_QWEN_FIELDS = (
    "relevance", "eventType", "impactScope", "impactDirection",
    "impactHorizon", "impactMechanism", "sectors", "symbols",
    "confidenceBand", "evidenceSentenceIds",
)
NOT_RELEVANT_COMPACT_VALUES = {
    "eventType": "not_applicable",
    "impactScope": "none",
    "impactDirection": "not_applicable",
    "impactHorizon": "not_applicable",
    "impactMechanism": "none",
    "sectors": [],
    "symbols": [],
}
PLACEHOLDER_GOLD_PHRASES = (
    "The source provides evidence",
    "This targeted gold label",
    "source sentences from",
)


def read_jsonl(path):
    rows = []
    with Path(path).open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise ValueError(
                    "Invalid JSON on line %d: %s" % (line_number, error)
                )
    return rows


def write_jsonl(path, rows):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(
                json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
            )


def _parse_date(value):
    if not value:
        raise ValueError("date is required")
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _validate_string_list(label, field, errors, prefix):
    if not isinstance(label.get(field), list):
        errors.append("%s.%s must be an array" % (prefix, field))


def _validate_v2_label(label, prefix, errors, sentence_ids):
    if not isinstance(label, dict):
        errors.append("%s must be an object" % prefix)
        return
    enum_fields = {
        "language": LANGUAGES,
        "relevance": RELEVANCE,
        "eventType": EVENT_TYPES,
        "impactScope": IMPACT_SCOPES,
        "impactDirection": IMPACT_DIRECTIONS,
        "impactHorizon": IMPACT_HORIZONS,
        "impactMechanism": IMPACT_MECHANISMS,
        "confidenceBand": CONFIDENCE_BANDS,
    }
    for field, values in enum_fields.items():
        if label.get(field) not in values:
            errors.append("%s.%s is invalid" % (prefix, field))
    for field in ("sectors", "symbols", "tags", "evidenceSentenceIds"):
        _validate_string_list(label, field, errors, prefix)
    if len(str(label.get("summary", "")).strip()) < 20:
        errors.append("%s.summary is too short" % prefix)
    if len(str(label.get("rationale", "")).strip()) < 20:
        errors.append("%s.rationale is too short" % prefix)
    evidence_ids = label.get("evidenceSentenceIds", [])
    if not evidence_ids:
        errors.append("%s.evidenceSentenceIds requires at least one ID" % prefix)
    unknown = sorted(set(evidence_ids) - sentence_ids)
    if unknown:
        errors.append(
            "%s contains unknown evidence sentence IDs: %s"
            % (prefix, ", ".join(unknown))
        )

    if label.get("relevance") == "not_relevant":
        expected = {
            "eventType": "not_applicable",
            "impactScope": "none",
            "impactDirection": "not_applicable",
            "impactHorizon": "not_applicable",
            "impactMechanism": "none",
        }
        for field, value in expected.items():
            if label.get(field) != value:
                errors.append(
                    "%s.%s must be %s for not_relevant"
                    % (prefix, field, value)
                )
        if label.get("sectors") or label.get("symbols"):
            errors.append(
                "%s cannot contain sectors or symbols for not_relevant" % prefix
            )
    elif label.get("relevance") in {"direct", "indirect"}:
        if label.get("eventType") == "not_applicable":
            errors.append("%s requires an eventType" % prefix)
        if label.get("impactDirection") == "not_applicable":
            errors.append("%s requires an impactDirection" % prefix)


def _validate_gold_quality(label, errors):
    text = " ".join([
        str(label.get("summary", "")),
        str(label.get("rationale", "")),
    ])
    for phrase in PLACEHOLDER_GOLD_PHRASES:
        if phrase.lower() in text.lower():
            errors.append(
                "gold contains placeholder training text: %s" % phrase
            )


def validate_row(row):
    errors = []
    required = (
        "id", "documentId", "schemaVersion", "ontologyVersion", "title",
        "excerpt", "sentences", "contentHash", "duplicateGroupId", "source",
        "publishedAt", "generated", "gold", "model", "adjudicatedAt",
        "adjudicatedBy",
    )
    for field in required:
        if field not in row:
            errors.append("%s is required" % field)
    if row.get("schemaVersion") != 2:
        errors.append("schemaVersion must be 2")
    if not str(row.get("title", "")).strip():
        errors.append("title cannot be empty")
    excerpt = str(row.get("excerpt", "")).strip()
    if not excerpt:
        errors.append("excerpt cannot be empty")
    if len(excerpt) > 1600:
        errors.append("excerpt exceeds 1600 characters")
    if len(str(row.get("contentHash", ""))) < 16:
        errors.append("contentHash is invalid")
    if len(str(row.get("duplicateGroupId", ""))) < 8:
        errors.append("duplicateGroupId is invalid")
    source = row.get("source")
    if not isinstance(source, dict) or not source.get("name") or not source.get("url"):
        errors.append("source requires name and url")
    try:
        _parse_date(row.get("publishedAt"))
    except (TypeError, ValueError):
        errors.append("publishedAt must be an ISO date")

    sentences = row.get("sentences")
    if not isinstance(sentences, list) or not sentences:
        errors.append("sentences must be a non-empty array")
        sentence_ids = set()
    else:
        sentence_ids = {
            sentence.get("id")
            for sentence in sentences
            if isinstance(sentence, dict) and sentence.get("id")
        }
        if len(sentence_ids) != len(sentences):
            errors.append("sentence IDs must be unique and non-empty")
    _validate_v2_label(row.get("generated"), "generated", errors, sentence_ids)
    _validate_v2_label(row.get("gold"), "gold", errors, sentence_ids)
    if isinstance(row.get("gold"), dict):
        _validate_gold_quality(row["gold"], errors)
    return errors


def validate_dataset(rows):
    issues = []
    ids = set()
    content_hashes = defaultdict(list)
    for index, row in enumerate(rows):
        errors = validate_row(row)
        row_id = row.get("id")
        if row_id in ids:
            errors.append("id is duplicated")
        ids.add(row_id)
        content_hashes[row.get("contentHash")].append(row_id)
        if errors:
            issues.append({"index": index, "id": row_id, "errors": errors})
    return issues


def compact_qwen_label(label):
    output = {
        field: list(label.get(field, []))
        if field in {"sectors", "symbols", "evidenceSentenceIds"}
        else label.get(field)
        for field in COMPACT_QWEN_FIELDS
    }
    if output.get("relevance") == "not_relevant":
        output.update({
            field: list(value) if isinstance(value, list) else value
            for field, value in NOT_RELEVANT_COMPACT_VALUES.items()
        })
    return output


def _group_rows(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[row.get("duplicateGroupId") or row["contentHash"]].append(row)
    return [
        sorted(group, key=lambda row: (_parse_date(row.get("publishedAt")), row["id"]))
        for group in groups.values()
    ]


def _row_sort_key(row):
    return (_parse_date(row.get("publishedAt")), row["id"])


def chronological_group_split(rows, train_ratio=0.70, validation_ratio=0.15):
    groups = _group_rows(rows)
    ordered_groups = sorted(
        groups,
        key=lambda group: min(
            _parse_date(row.get("publishedAt")) for row in group
        ),
    )
    total = len(rows)
    train_target = total * train_ratio
    validation_target = total * (train_ratio + validation_ratio)
    splits = {"train": [], "validation": [], "test": []}
    assigned = 0
    for group in ordered_groups:
        if assigned < train_target:
            split = "train"
        elif assigned < validation_target:
            split = "validation"
        else:
            split = "test"
        splits[split].extend(group)
        assigned += len(group)
    for split_rows in splits.values():
        split_rows.sort(key=_row_sort_key)
    return splits


def _split_targets(total, train_ratio=0.70, validation_ratio=0.15):
    train = int(round(total * train_ratio))
    validation = int(round(total * validation_ratio))
    return {
        "train": train,
        "validation": validation,
        "test": total - train - validation,
    }


def _balance_features(row):
    gold = row.get("gold", {})
    return (
        ("relevance", gold.get("relevance", "missing")),
        ("language", gold.get("language", "missing")),
        ("eventType", gold.get("eventType", "missing")),
        ("impactDirection", gold.get("impactDirection", "missing")),
    )


def _feature_counts(rows):
    counts = Counter()
    for row in rows:
        counts.update(_balance_features(row))
    return counts


def _feature_weight(feature_key):
    return {
        "relevance": 4.0,
        "language": 3.0,
        "eventType": 2.0,
        "impactDirection": 2.0,
    }.get(feature_key[0], 1.0)


def _group_rarity_score(group, total_feature_counts):
    return sum(
        total_feature_counts.get(feature, 0)
        for row in group
        for feature in _balance_features(row)
    ) / float(max(len(group), 1))


def _row_bucket(row):
    gold = row.get("gold", {})
    return (
        gold.get("relevance", "missing"),
        gold.get("language", "missing"),
        gold.get("eventType", "missing"),
        gold.get("impactDirection", "missing"),
    )


def _group_bucket(group):
    counts = Counter(_row_bucket(row) for row in group)
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]


def balanced_group_split(rows, train_ratio=0.70, validation_ratio=0.15):
    groups = _group_rows(rows)
    total = len(rows)
    targets = _split_targets(total, train_ratio, validation_ratio)
    splits = {"train": [], "validation": [], "test": []}
    split_sizes = {name: 0 for name in splits}
    buckets = defaultdict(list)
    for group in groups:
        buckets[_group_bucket(group)].append(group)

    for bucket, bucket_groups in sorted(
        buckets.items(),
        key=lambda item: (-sum(len(group) for group in item[1]), item[0]),
    ):
        bucket_groups = sorted(
            bucket_groups,
            key=lambda group: (
                min(_parse_date(row.get("publishedAt")) for row in group),
                group[0]["id"],
            ),
        )
        bucket_total = sum(len(group) for group in bucket_groups)
        desired = {
            split: bucket_total * (targets[split] / float(total))
            for split in ("train", "validation", "test")
        }
        bucket_sizes = {name: 0 for name in splits}
        for group in bucket_groups:
            size = len(group)
            candidates = [
                name for name in ("train", "validation", "test")
                if split_sizes[name] + size <= targets[name]
            ]
            if not candidates:
                candidates = ["train", "validation", "test"]

            def score(name):
                denominator = desired[name] if desired[name] > 0 else 0.1
                overflow = max(0, split_sizes[name] + size - targets[name])
                return (
                    overflow * 1000000,
                    (bucket_sizes[name] + size) / denominator,
                    split_sizes[name] / float(max(targets[name], 1)),
                    name,
                )

            chosen = min(candidates, key=score)
            splits[chosen].extend(group)
            split_sizes[chosen] += size
            bucket_sizes[chosen] += size

    for split_rows in splits.values():
        split_rows.sort(key=_row_sort_key)
    return splits


def coverage_report(rows):
    gold = [row.get("gold", {}) for row in rows]
    source_counts = Counter(
        row.get("source", {}).get("name", "missing") for row in rows
    )
    return {
        "records": len(rows),
        "relevance": dict(Counter(label.get("relevance", "missing") for label in gold)),
        "directions": dict(Counter(
            label.get("impactDirection", "missing") for label in gold
        )),
        "languages": dict(Counter(label.get("language", "missing") for label in gold)),
        "eventTypes": dict(Counter(
            label.get("eventType", "missing") for label in gold
        )),
        "sectors": dict(Counter(
            sector for label in gold for sector in label.get("sectors", [])
        )),
        "sources": dict(source_counts),
        "symbolLevel": sum(bool(label.get("symbols")) for label in gold),
    }


def dataset_readiness(rows, min_records=500, **_legacy):
    coverage = coverage_report(rows)
    errors = []
    if len(rows) != min_records:
        errors.append(
            "adjudicated records %d must equal %d" % (len(rows), min_records)
        )
    required_relevance = {"direct": 300, "indirect": 100, "not_relevant": 100}
    for label, expected in required_relevance.items():
        observed = coverage["relevance"].get(label, 0)
        if observed != expected:
            errors.append(
                "%s records %d must equal %d" % (label, observed, expected)
            )
    for language in ("en", "ne"):
        count = coverage["languages"].get(language, 0)
        if count < 200:
            errors.append("%s records %d is below 200" % (language, count))
    if coverage["symbolLevel"] < 150:
        errors.append(
            "symbol-level records %d is below 150" % coverage["symbolLevel"]
        )
    for direction in ("bullish", "bearish"):
        count = coverage["directions"].get(direction, 0)
        if count < 60:
            errors.append("%s relevant records %d is below 60" % (direction, count))
    # Neutral is the scarcest direction and the hardest for the classifier to
    # learn. It is a non-blocking warning (not a hard error) so the already
    # frozen 500-record gold corpus and its manifest stay valid, while future
    # regenerations get a loud signal to collect more neutral evidence.
    warnings = []
    neutral_count = coverage["directions"].get("neutral", 0)
    if neutral_count < 40:
        warnings.append(
            "neutral relevant records %d is below the recommended floor of 40; "
            "direction neutral-F1 is unreliable at this support" % neutral_count
        )
    for event_type in sorted(CORE_EVENT_TYPES):
        count = coverage["eventTypes"].get(event_type, 0)
        if count < 20:
            errors.append("%s records %d is below 20" % (event_type, count))
    max_source = max(coverage["sources"].values(), default=0)
    if max_source > int(min_records * 0.60):
        errors.append(
            "largest source count %d exceeds the 60 percent cap" % max_source
        )
    return {
        "ready": not errors,
        "requirements": {
            "records": min_records,
            "relevance": required_relevance,
            "minEnglish": 200,
            "minNepali": 200,
            "minSymbolLevel": 150,
            "minCoreEvent": 20,
            "minBullish": 60,
            "minBearish": 60,
            "recommendedMinNeutral": 40,
            "maxSourceShare": 0.60,
        },
        "coverage": coverage,
        "errors": errors,
        "warnings": warnings,
    }


def split_manifest(splits, strategy="chronological"):
    assignments = []
    for split_name in ("train", "validation", "test"):
        for row in splits.get(split_name, []):
            assignments.append({
                "id": row["id"],
                "contentHash": row["contentHash"],
                "duplicateGroupId": row.get("duplicateGroupId"),
                "publishedAt": row.get("publishedAt"),
                "split": split_name,
            })
    canonical = json.dumps(
        assignments,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return {
        "schemaVersion": 2,
        "splitStrategy": (
            "balanced-near-duplicate-grouped-70-15-15"
            if strategy == "balanced"
            else "chronological-near-duplicate-grouped-70-15-15"
        ),
        "counts": {
            name: len(splits.get(name, []))
            for name in ("train", "validation", "test")
        },
        "sha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "assignments": assignments,
    }

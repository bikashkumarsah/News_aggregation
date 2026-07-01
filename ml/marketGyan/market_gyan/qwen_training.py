import json
import os
from collections import Counter
from pathlib import Path


TARGETED_V2_SPLIT_HASH = (
    "ca8ff2bce62950442ec21d9c344aa91584b4c625ae1fc03112b4449827da394d"
)
TARGETED_V2_EXPECTED_ORIGINAL_TRAIN = 350
TARGETED_V2_EXPECTED_WEIGHTED_TRAIN = 922
TARGETED_V2_EVENT_BONUS = {
    "sector_industry",
    "regulation",
    "credit_financing",
    "governance",
}
QWEN_PROFILE_ENV_KEYS = (
    "MARKET_GYAN_PROJECT",
    "MARKET_GYAN_PROFILE_ENV",
    "MARKET_GYAN_QWEN_MODEL",
    "MARKET_GYAN_LOAD_IN_4BIT",
    "MARKET_GYAN_OUTPUT_NAME",
    "MARKET_GYAN_EXPECT_A100",
    "MARKET_GYAN_ENABLE_TF32",
    "MARKET_GYAN_MAX_SEQ_LENGTH",
    "MARKET_GYAN_MAX_GENERATION_TOKENS",
    "MARKET_GYAN_GENERATION_BATCH_SIZE",
    "MARKET_GYAN_PER_DEVICE_TRAIN_BATCH_SIZE",
    "MARKET_GYAN_PER_DEVICE_EVAL_BATCH_SIZE",
    "MARKET_GYAN_GRADIENT_ACCUMULATION_STEPS",
    "MARKET_GYAN_LORA_R",
    "MARKET_GYAN_LORA_ALPHA",
    "MARKET_GYAN_LORA_DROPOUT",
    "MARKET_GYAN_EPOCHS",
    "MARKET_GYAN_LEARNING_RATE",
    "MARKET_GYAN_EVAL_STEPS",
    "MARKET_GYAN_LOGGING_STEPS",
    "MARKET_GYAN_DATALOADER_NUM_WORKERS",
    "MARKET_GYAN_DATASET_NUM_PROC",
    "MARKET_GYAN_OPTIM",
    "MARKET_GYAN_OVERSAMPLE_PROFILE",
    "MARKET_GYAN_SAVE_BEST_MODEL",
    "MARKET_GYAN_SPLIT_MANIFEST",
    "MARKET_GYAN_FAIL_ON_QWEN_SMOKE_GATE",
)


def env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def targeted_v2_row_weight(row):
    gold = row.get("gold", {})
    relevance = gold.get("relevance")
    event_type = gold.get("eventType")
    language = gold.get("language")
    is_nepali = language == "ne"
    is_indirect_or_negative = relevance in {"indirect", "not_relevant"}

    weight = 1
    if is_nepali:
        weight += 1
    if is_indirect_or_negative:
        weight += 1
    if is_nepali and is_indirect_or_negative:
        weight += 1
    if gold.get("impactDirection") == "neutral":
        weight += 3
    if event_type in TARGETED_V2_EVENT_BONUS:
        weight += 2
    if event_type == "project_operations":
        weight += 1
    if relevance == "indirect" and gold.get("impactScope") == "sector":
        weight += 1
    return min(weight, 8)


def legacy_row_weight(row):
    gold = row.get("gold", {})
    is_nepali = gold.get("language") == "ne"
    is_indirect_or_negative = gold.get("relevance") in {
        "indirect",
        "not_relevant",
    }
    return 1 + int(is_nepali) + int(is_indirect_or_negative) + int(
        is_nepali and is_indirect_or_negative
    )


def row_weights(rows, profile):
    if profile == "none":
        return [1 for _ in rows]
    if profile == "legacy":
        return [legacy_row_weight(row) for row in rows]
    if profile == "targeted_v2":
        return [targeted_v2_row_weight(row) for row in rows]
    raise ValueError("unknown Qwen oversampling profile: %s" % profile)


def oversample_training_rows(rows, profile="legacy"):
    values = list(rows)
    if profile == "none":
        return values
    if profile == "legacy":
        selected = list(values)
        selected.extend(
            row for row in values
            if row["gold"]["language"] == "ne"
        )
        selected.extend(
            row for row in values
            if row["gold"]["relevance"] in {"indirect", "not_relevant"}
        )
        selected.extend(
            row for row in values
            if (
                row["gold"]["relevance"] in {"indirect", "not_relevant"}
                and row["gold"]["language"] == "ne"
            )
        )
        return selected
    if profile == "targeted_v2":
        selected = []
        for row, weight in zip(values, row_weights(values, profile)):
            selected.extend([row] * weight)
        return selected
    raise ValueError("unknown Qwen oversampling profile: %s" % profile)


def oversampling_summary(rows, profile):
    weights = row_weights(list(rows), profile)
    return {
        "profile": profile,
        "originalTrainCount": len(weights),
        "weightedTrainCount": sum(weights),
        "weightCap": 8 if profile == "targeted_v2" else None,
        "weightHistogram": {
            str(weight): count
            for weight, count in sorted(Counter(weights).items())
        },
    }


def load_split_manifest_hash(path):
    if not path:
        return None
    manifest_path = Path(path)
    if not manifest_path.exists():
        return None
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8")).get("sha256")
    except json.JSONDecodeError:
        return None


def assert_targeted_v2_frozen_split(summary, split_manifest_hash):
    if summary.get("profile") != "targeted_v2":
        return
    if split_manifest_hash != TARGETED_V2_SPLIT_HASH:
        return
    original = summary.get("originalTrainCount")
    weighted = summary.get("weightedTrainCount")
    if (
        original != TARGETED_V2_EXPECTED_ORIGINAL_TRAIN
        or weighted != TARGETED_V2_EXPECTED_WEIGHTED_TRAIN
    ):
        raise AssertionError(
            "targeted_v2 frozen train expansion expected %d -> %d, got %d -> %d"
            % (
                TARGETED_V2_EXPECTED_ORIGINAL_TRAIN,
                TARGETED_V2_EXPECTED_WEIGHTED_TRAIN,
                original,
                weighted,
            )
        )


def qwen_env_snapshot(env=None):
    values = os.environ if env is None else env
    return {
        key: values[key]
        for key in QWEN_PROFILE_ENV_KEYS
        if key in values
    }


def qwen_training_profile(
    *,
    model_name,
    output_name,
    load_in_4bit,
    max_seq_length,
    oversampling,
    split_manifest_hash,
    env=None,
    extra=None,
):
    profile = {
        "model": model_name,
        "outputName": output_name,
        "loadIn4bit": bool(load_in_4bit),
        "maxSeqLength": int(max_seq_length),
        "oversampling": oversampling,
        "splitManifestHash": split_manifest_hash,
        "targetedV2FrozenSplitHash": TARGETED_V2_SPLIT_HASH,
        "env": qwen_env_snapshot(env),
    }
    if extra:
        profile.update(extra)
    return profile

"""Structured-output helpers for MarketGyan Qwen evaluation."""

from .dataset import (
    COMPACT_QWEN_FIELDS,
    CONFIDENCE_BANDS,
    EVENT_TYPES,
    IMPACT_DIRECTIONS,
    IMPACT_HORIZONS,
    IMPACT_MECHANISMS,
    IMPACT_SCOPES,
    RELEVANCE,
)


def _sentence_ids(sentences=None):
    values = []
    for sentence in sentences or []:
        if isinstance(sentence, dict) and sentence.get("id"):
            values.append(str(sentence["id"]))
    return values


def compact_qwen_json_schema(sentences=None):
    """Return the compact MarketGyan label schema used for constrained decoding.

    The schema intentionally covers only the short classifier/extractor target.
    Long text fields such as summaries, rationales, and evidence excerpts are
    reconstructed later from retrieved source text.
    """

    evidence_item = {"type": "string"}
    allowed_sentence_ids = _sentence_ids(sentences)
    if allowed_sentence_ids:
        evidence_item["enum"] = allowed_sentence_ids

    return {
        "type": "object",
        "additionalProperties": False,
        "required": list(COMPACT_QWEN_FIELDS),
        "properties": {
            "relevance": {
                "type": "string",
                "enum": sorted(RELEVANCE),
            },
            "eventType": {
                "type": "string",
                "enum": sorted(EVENT_TYPES),
            },
            "impactScope": {
                "type": "string",
                "enum": sorted(IMPACT_SCOPES),
            },
            "impactDirection": {
                "type": "string",
                "enum": sorted(IMPACT_DIRECTIONS),
            },
            "impactHorizon": {
                "type": "string",
                "enum": sorted(IMPACT_HORIZONS),
            },
            "impactMechanism": {
                "type": "string",
                "enum": sorted(IMPACT_MECHANISMS),
            },
            "sectors": {
                "type": "array",
                "items": {"type": "string"},
            },
            "symbols": {
                "type": "array",
                "items": {"type": "string"},
            },
            "confidenceBand": {
                "type": "string",
                "enum": sorted(CONFIDENCE_BANDS),
            },
            "evidenceSentenceIds": {
                "type": "array",
                "minItems": 1,
                "items": evidence_item,
            },
        },
    }


def compact_qwen_response_format(sentences=None):
    """OpenAI-compatible response_format payload for vLLM JSON Schema mode."""

    return {
        "type": "json_schema",
        "json_schema": {
            "name": "marketgyan_compact_label",
            "strict": True,
            "schema": compact_qwen_json_schema(sentences),
        },
    }

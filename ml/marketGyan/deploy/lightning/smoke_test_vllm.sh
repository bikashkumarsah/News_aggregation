#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${MARKET_GYAN_VLLM_BASE_URL:-http://127.0.0.1:8000/v1}"
MODEL="${MARKET_GYAN_VLLM_MODEL:-marketgyan-qwen35-9b-targeted-v2}"
API_KEY="${MARKET_GYAN_VLLM_API_KEY:-${VLLM_API_KEY:-}}"

if [[ -z "${API_KEY}" ]]; then
  echo "Set MARKET_GYAN_VLLM_API_KEY or VLLM_API_KEY before running the smoke test." >&2
  exit 2
fi

echo "Checking models at ${BASE_URL}/models"
curl -fsS "${BASE_URL}/models" \
  -H "Authorization: Bearer ${API_KEY}"

echo
echo "Checking chat completion for ${MODEL}"
curl -fsS "${BASE_URL}/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"${MODEL}\",
    \"messages\": [
      {
        \"role\": \"user\",
        \"content\": \"Return a short JSON summary for a Nepal stock market news article.\"
      }
    ],
    \"temperature\": 0,
    \"max_tokens\": 256
  }"

echo
echo "Checking JSON Schema constrained output"
curl -fsS "${BASE_URL}/chat/completions" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"${MODEL}\",
    \"messages\": [
      {
        \"role\": \"user\",
        \"content\": \"Classify this article: NEPSE rose after banking shares gained.\"
      }
    ],
    \"temperature\": 0,
    \"max_tokens\": 128,
    \"response_format\": {
      \"type\": \"json_schema\",
      \"json_schema\": {
        \"name\": \"marketgyan_smoke\",
        \"schema\": {
          \"type\": \"object\",
          \"properties\": {
            \"summary\": {\"type\": \"string\"},
            \"relevance\": {
              \"type\": \"string\",
              \"enum\": [\"direct\", \"indirect\", \"not_relevant\"]
            }
          },
          \"required\": [\"summary\", \"relevance\"],
          \"additionalProperties\": false
        }
      }
    }
  }"

echo

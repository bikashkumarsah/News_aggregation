#!/usr/bin/env bash
set -euo pipefail

BASE_MODEL="${MARKET_GYAN_BASE_MODEL:-Qwen/Qwen3.5-9B}"
MODEL_ALIAS="${MARKET_GYAN_VLLM_MODEL_ALIAS:-marketgyan-qwen35-9b-targeted-v2}"
ADAPTER_ZIP="${MARKET_GYAN_ADAPTER_ZIP:-News_aggregation_ml_marketGyan_outputs_marketgyan-qwen35-9b-a100-80gb-bf16-lora-targeted-v2.zip}"
ADAPTER_DIR="${MARKET_GYAN_ADAPTER_DIR:-/teamspace/studios/this_studio/marketgyan-adapter}"
HOST="${MARKET_GYAN_VLLM_HOST:-0.0.0.0}"
PORT="${MARKET_GYAN_VLLM_PORT:-8000}"
DTYPE="${MARKET_GYAN_VLLM_DTYPE:-bfloat16}"
MAX_MODEL_LEN="${MARKET_GYAN_MAX_MODEL_LEN:-2048}"
GPU_MEMORY_UTILIZATION="${MARKET_GYAN_GPU_MEMORY_UTILIZATION:-0.85}"
MAX_LORA_RANK="${MARKET_GYAN_MAX_LORA_RANK:-32}"
ATTENTION_BACKEND="${MARKET_GYAN_ATTENTION_BACKEND:-TRITON_ATTN}"

if [[ -z "${VLLM_API_KEY:-}" ]]; then
  echo "VLLM_API_KEY is required. Set it to a random secret before exposing the server." >&2
  exit 2
fi

if ! command -v vllm >/dev/null 2>&1; then
  echo "vllm is not installed. Run: python -m pip install -U vllm huggingface_hub" >&2
  exit 2
fi

if [[ ! -f "${ADAPTER_DIR}/adapter_config.json" ]]; then
  if [[ ! -f "${ADAPTER_ZIP}" ]]; then
    echo "Adapter not found at ${ADAPTER_DIR}, and zip not found at ${ADAPTER_ZIP}." >&2
    echo "Set MARKET_GYAN_ADAPTER_ZIP to the uploaded targeted-v2 adapter zip." >&2
    exit 2
  fi
  mkdir -p "${ADAPTER_DIR}"
  unzip -o "${ADAPTER_ZIP}" -d "${ADAPTER_DIR}"
fi

if [[ ! -f "${ADAPTER_DIR}/adapter_model.safetensors" ]]; then
  echo "Missing adapter_model.safetensors in ${ADAPTER_DIR}." >&2
  exit 2
fi

export VLLM_USE_FLASHINFER_SAMPLER="${VLLM_USE_FLASHINFER_SAMPLER:-0}"

exec vllm serve "${BASE_MODEL}" \
  --host "${HOST}" \
  --port "${PORT}" \
  --dtype "${DTYPE}" \
  --max-model-len "${MAX_MODEL_LEN}" \
  --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}" \
  --language-model-only \
  --attention-backend "${ATTENTION_BACKEND}" \
  --enable-lora \
  --max-lora-rank "${MAX_LORA_RANK}" \
  --lora-modules "${MODEL_ALIAS}=${ADAPTER_DIR}" \
  --api-key "${VLLM_API_KEY}"

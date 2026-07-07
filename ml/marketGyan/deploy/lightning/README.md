# Lightning AI vLLM Inference

Use this path to serve the trained MarketGyan Qwen3.5-9B LoRA adapter from a
Lightning AI Studio and call it from the local Mac backend.

## GPU Choice

- Start with **A100 40 GB** for proposal testing and one-user demos.
- Use **A100 80 GB** if the 40 GB run fails with memory pressure or you want
  the least debugging.
- Use **L40S 48 GB** only as a cheaper challenger when it is available.
- Skip **H100/H200** unless latency or concurrent traffic becomes the goal.

The local Mac should run the app, Qdrant, MongoDB, and evaluation scripts. The
Qwen base model plus LoRA adapter should run on the Lightning GPU.

## Lightning Studio Setup

Create a Lightning AI Studio with an A100 40 GB GPU. Upload the targeted-v2
adapter zip into the Studio, then run:

```bash
python -m pip install -U vllm huggingface_hub

export VLLM_API_KEY="replace-with-a-random-secret-token"
export MARKET_GYAN_ADAPTER_ZIP="News_aggregation_ml_marketGyan_outputs_marketgyan-qwen35-9b-a100-80gb-bf16-lora-targeted-v2.zip"

bash ml/marketGyan/deploy/lightning/serve_vllm.sh
```

If the repository is not present in the Studio, copy
`serve_vllm.sh` into the same directory as the zip and run it there.

The launcher defaults to:

```text
base model: Qwen/Qwen3.5-9B
LoRA alias: marketgyan-qwen35-9b-targeted-v2
adapter dir: /teamspace/studios/this_studio/marketgyan-adapter
port: 8000
max model length: 2048
dtype: bfloat16
```

Expose port `8000` from Lightning after the server starts. Keep the API key
enabled; do not expose an unauthenticated vLLM server.

## Smoke Test

Inside Lightning:

```bash
export MARKET_GYAN_VLLM_BASE_URL=http://127.0.0.1:8000/v1
export MARKET_GYAN_VLLM_API_KEY="$VLLM_API_KEY"

bash ml/marketGyan/deploy/lightning/smoke_test_vllm.sh
```

From the Mac, set `MARKET_GYAN_VLLM_BASE_URL` to the Lightning public endpoint
ending in `/v1` and run the same smoke test.

## Connect The Mac Agent

On the Mac:

```bash
cd /Users/bikashkumarsah/Downloads/archived_personal/khabar-market-gyan/ml/marketGyan
cp deploy/lightning/mac_agent.env.example .env.lightning-agent
```

Edit `.env.lightning-agent` with the Lightning public endpoint and the same
vLLM API key. Then:

```bash
set -a
source .env.lightning-agent
set +a
PYTHONPATH=. uvicorn agent_service.app:app --host 127.0.0.1 --port 8100
```

The agent service uses a single-pass runtime: it retrieves compact evidence
from the local Node/Qdrant API, asks vLLM for JSON with evidence indexes, and
then fills the final citation objects from the retrieved records. It does not
use CrewAI for live generation.

Start the backend/frontend normally, with the backend pointing to
`http://127.0.0.1:8100` for `MARKET_GYAN_AGENT_SERVICE_URL`.

## Memory Fallbacks

If the server fails with an out-of-memory error on A100 40 GB:

```bash
export MARKET_GYAN_MAX_MODEL_LEN=1536
bash ml/marketGyan/deploy/lightning/serve_vllm.sh
```

If it still fails, try `MARKET_GYAN_MAX_MODEL_LEN=1024`. If that still fails,
switch the Studio to A100 80 GB.

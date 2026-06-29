# Market Gyan Modeling

This workspace consumes only adjudicated schema-v2 JSONL exported by the
Market Gyan review API. Schema-v1, pending, excluded, failed, and unadjudicated
records are not training data.

## Workflow

```bash
cd ml/marketGyan
PYTHONPATH=. python3 -m market_gyan.cli validate data/processed/nepse-impact-500.jsonl
PYTHONPATH=. python3 -m market_gyan.cli gate data/processed/nepse-impact-500.jsonl --min-records=500
PYTHONPATH=. python3 -m market_gyan.cli agreement data/processed/nepse-impact-500.jsonl outputs/annotation-agreement.json
PYTHONPATH=. python3 -m market_gyan.cli split data/processed/nepse-impact-500.jsonl data/processed/splits --strategy balanced
PYTHONPATH=. python3 -m market_gyan.cli evaluate data/processed/nepse-impact-500.jsonl outputs/research-report.json
PYTHONPATH=. python3 -m market_gyan.cli audit-predictions data/processed/splits/test.jsonl outputs/xlmr_rel_predictions.json outputs/audits/xlmr_relevance_audit.json --task=relevance
```

Install `requirements.txt` in Kaggle or Colab for training. The local validation
and unit tests use only the Python standard library.

```bash
PYTHONPATH=. python3 -m unittest discover -s tests
python3 notebooks/build_notebooks.py
```

Run `notebooks/xlmr_baseline.ipynb` for XLM-R relevance, XLM-R direction, and
the English-only FinBERT baseline. Run
`notebooks/qwen3_8b_qlora.ipynb` in Colab or Kaggle. Both use the same frozen
balanced `data/processed/splits/manifest.json`. The Qwen notebook evaluates
zero-shot, three-shot, and an Unsloth LoRA adapter against a compact
classifier/extractor target: canonical labels, sectors, symbols, confidence,
and evidence sentence IDs only. Evidence text, summaries, rationales, and
report prose are rebuilt later from RAG evidence and deterministic market data.

The next recommended generator experiment is Qwen3.5-9B with bf16 LoRA. On an
A100 runtime, the Qwen notebook auto-loads the checked-in 80 GB profile when it
detects about 80 GB of VRAM, otherwise it falls back to the 40 GB profile. You
can also source the profile explicitly before running the notebook:

```bash
source config/qwen35_9b_a100_80gb_bf16.env
# or, on a 40 GB A100:
source config/qwen35_9b_a100_40gb_bf16.env
```

The 80 GB A100 config expands to:

```bash
export MARKET_GYAN_QWEN_MODEL=Qwen/Qwen3.5-9B
export MARKET_GYAN_LOAD_IN_4BIT=false
export MARKET_GYAN_OUTPUT_NAME=marketgyan-qwen35-9b-a100-80gb-bf16-lora
export MARKET_GYAN_EXPECT_A100=true
export MARKET_GYAN_ENABLE_TF32=true
export MARKET_GYAN_MAX_SEQ_LENGTH=2048
export MARKET_GYAN_MAX_GENERATION_TOKENS=256
export MARKET_GYAN_GENERATION_BATCH_SIZE=16
export MARKET_GYAN_PER_DEVICE_TRAIN_BATCH_SIZE=4
export MARKET_GYAN_PER_DEVICE_EVAL_BATCH_SIZE=4
export MARKET_GYAN_GRADIENT_ACCUMULATION_STEPS=2
export MARKET_GYAN_LORA_R=32
export MARKET_GYAN_LORA_ALPHA=64
export MARKET_GYAN_EPOCHS=3
export MARKET_GYAN_LEARNING_RATE=3e-5
export MARKET_GYAN_EVAL_STEPS=10
export MARKET_GYAN_DATALOADER_NUM_WORKERS=12
export MARKET_GYAN_DATASET_NUM_PROC=12
export MARKET_GYAN_FAIL_ON_QWEN_SMOKE_GATE=false
```

`MARKET_GYAN_GENERATION_BATCH_SIZE` controls local zero-shot, three-shot,
smoke, and adapter generation batching. If A100 80 GB utilization is still low,
try `24` or `32`; if you hit CUDA out-of-memory, reduce it to `8`.

The smoke gate writes `smoke_metrics.json` and prints invalid examples when the
adapter is not yet producing strict JSON. It does not stop the notebook by
default because full-test diagnostics are still useful. Set
`MARKET_GYAN_FAIL_ON_QWEN_SMOKE_GATE=true` only when a failed smoke gate should
stop the run.

For an L4 runtime, source the smaller checked-in config instead:

```bash
source config/qwen35_9b_l4_bf16.env
```

The L4 config expands to:

```bash
export MARKET_GYAN_QWEN_MODEL=Qwen/Qwen3.5-9B
export MARKET_GYAN_LOAD_IN_4BIT=false
export MARKET_GYAN_OUTPUT_NAME=marketgyan-qwen35-9b-l4-bf16-lora
export MARKET_GYAN_MAX_SEQ_LENGTH=1536
export MARKET_GYAN_MAX_GENERATION_TOKENS=192
export MARKET_GYAN_EPOCHS=3
export MARKET_GYAN_LEARNING_RATE=5e-5
```

If the L4 run fails with memory pressure, first retry with:

```bash
export MARKET_GYAN_MAX_SEQ_LENGTH=1024
```

On a T4-class 16 GB runtime, use a smaller diagnostic candidate instead:

```bash
export MARKET_GYAN_QWEN_MODEL=Qwen/Qwen3.5-4B
export MARKET_GYAN_LOAD_IN_4BIT=false
export MARKET_GYAN_OUTPUT_NAME=marketgyan-qwen35-4b-unsloth-lora
```

Use `MARKET_GYAN_LOAD_IN_4BIT=true` only for low-memory experiments where the
run is explicitly treated as diagnostic. The previous Qwen3-8B 4-bit run showed
useful extraction behavior under tolerant repair, but strict JSON validity and
grounding were too low for deployment. The notebook uses response-only training,
oversamples Nepali, indirect, and hard-negative examples, and saves only the
final adapter, tokenizer, predictions, metrics, and plots. Intermediate
`checkpoint-*` directories are intentionally removed to keep the downloadable
artifact small.

The Qwen notebook reports strict metrics as the official gate and a separate
`unsloth_qlora_tolerant_diagnostic` block for failure analysis. The tolerant
path repairs common near-JSON compact objects such as unquoted-key outputs, so
it can show whether the adapter learned extraction behavior. It does not count
toward deployment readiness. Runtime use still requires at least 95%
structured-output validity and grounding under strict or schema-constrained
decoding.

The notebook can also evaluate a vLLM/OpenAI-compatible endpoint with JSON
Schema constrained decoding. Start a Qwen or adapter-backed endpoint separately,
then set these variables before running the Qwen notebook:

```bash
export MARKET_GYAN_USE_VLLM_CONSTRAINED=true
export MARKET_GYAN_VLLM_BASE_URL=http://127.0.0.1:8000/v1
export MARKET_GYAN_VLLM_API_KEY=local
export MARKET_GYAN_VLLM_MODEL=marketgyan-qwen35-9b-a100-40gb-bf16-lora
```

This writes `qwen_vllm_constrained_zero_shot.jsonl` and
`qwen_vllm_constrained_three_shot.jsonl`. The unconstrained notebook metrics
remain useful as failure diagnostics, but the deployment path should use
schema-constrained decoding if Qwen is used for structured output.
Model artifacts and datasets are intentionally ignored by Git.

The notebook also writes `model_gate.json` from the official strict metrics.
To compare the new A100 run against the previous Qwen3-8B 4-bit output archive:

```bash
PYTHONPATH=. python3 -m market_gyan.cli qwen-model-gate \
  outputs/marketgyan-qwen35-9b-a100-40gb-bf16-lora/metrics.json \
  outputs/marketgyan-qwen35-9b-a100-40gb-bf16-lora/model-gate-with-baseline.json \
  --baseline-metrics /path/to/News_aggregation_ml_marketGyan_outputs_marketgyan-qwen3-8b-unsloth-qlora.zip \
  --allow-fail
```

Remove `--allow-fail` when this command is used as the deployment gate. Passing
the gate requires at least 95% structured-output validity and 95% evidence
grounding from an official strict or schema-constrained condition.

System benchmark specifications are in `evaluation/`. After recording actual
retrieval and scenario results:

```bash
PYTHONPATH=. python3 -m market_gyan.cli system-evaluate \
  evaluation/retrieval_results.json \
  evaluation/scenario_results.json \
  outputs/system-metrics.json
PYTHONPATH=. python3 -m market_gyan.cli deployment-gate \
  outputs/xlmr-metrics.json \
  outputs/qwen-metrics.json \
  outputs/deployment-gate.json
```

The optional CrewAI service has separate dependencies:

```bash
python -m pip install -r requirements-agent.txt
PYTHONPATH=. uvicorn agent_service.app:app --host 127.0.0.1 --port 8100
```

For local RAG/report demos before Qwen is deployment-ready, enable deterministic
mock mode:

```bash
export MARKET_GYAN_QUERY_ENABLED=true
export MARKET_GYAN_AGENT_MOCK_ENABLED=true
export MARKET_GYAN_AGENT_SERVICE_TOKEN=local-dev-token
export MARKET_GYAN_NODE_BASE_URL=http://127.0.0.1:5001
```

Mock mode still retrieves evidence from the Node/Qdrant path and runs citation
validation; it only replaces free-form model generation.

This is a research workflow. The retrieval, agent, and report paths are
implemented but disabled until reviewed data, trained artifacts, and deployment
thresholds are available.

For RAG quality, do not rely on the generator fine-tune as the retriever. Run
separate retrieval experiments with a dedicated multilingual embedding model
and reranker, then feed retrieved sentence IDs into the compact generator schema.

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
zero-shot, three-shot, and Unsloth QLoRA against a compact classifier/extractor
target: canonical labels, sectors, symbols, confidence, and evidence sentence
IDs only. Evidence text, summaries, rationales, and report prose are rebuilt
later from RAG evidence and deterministic market data. The notebook targets a
T4 16 GB minimum, uses `unsloth/Qwen3-8B` in non-thinking mode with
response-only training, oversamples indirect and hard-negative examples, and
saves only the final adapter, tokenizer, predictions, metrics, and plots.
Intermediate `checkpoint-*` directories are intentionally removed to keep the
downloadable artifact small.

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
export MARKET_GYAN_VLLM_MODEL=marketgyan-qwen3-8b
```

This writes `qwen_vllm_constrained_zero_shot.jsonl` and
`qwen_vllm_constrained_three_shot.jsonl`. The unconstrained notebook metrics
remain useful as failure diagnostics, but the deployment path should use
schema-constrained decoding if Qwen is used for structured output.
Model artifacts and datasets are intentionally ignored by Git.

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

This is a research workflow. The retrieval, agent, and report paths are
implemented but disabled until reviewed data, trained artifacts, and deployment
thresholds are available.

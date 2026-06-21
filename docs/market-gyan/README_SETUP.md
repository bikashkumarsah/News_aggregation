# MarketGyan Setup and Operations

This guide covers the NEPSE-Impact-500 data pipeline, Gemma v2 structuring,
independent annotation, adjudicated export, reaction analysis, and model
experiments. OCR and legacy-font conversion are excluded.

All generated analysis is informational and is not investment advice.

## 1. Prerequisites

- Node.js 18 or newer and npm
- MongoDB
- Python 3.10 or newer
- Git
- Internet access for public sources and the Gemini API
- Optional: Tectonic for the report
- Optional: NVIDIA T4 16 GB or better in Colab/Kaggle for Qwen3-8B QLoRA

Install backend dependencies:

```bash
cd minimal/news-backend
npm install
cp .env.example .env
```

Minimum local configuration:

```env
MONGODB_URI=mongodb://localhost:27017/newsDB
PORT=5001

MARKET_GYAN_TIMEZONE=Asia/Kathmandu
MARKET_GYAN_SOURCE_THROTTLE_MS=750

MARKET_GYAN_STRUCTURING_ENABLED=false
MARKET_GYAN_GEMMA_MODEL=gemma-4-26b-a4b-it
MARKET_GYAN_GEMMA_RPM=15
MARKET_GYAN_GEMMA_CONCURRENCY=1
MARKET_GYAN_PROMPT_VERSION=market-impact-v2
MARKET_GYAN_SCHEMA_VERSION=2
GEMINI_API_KEY=

MARKET_GYAN_REVIEW_ENABLED=false
MARKET_GYAN_REVIEWER_ID=reviewer-1
MARKET_GYAN_REVIEWER_ROLE=primary
MARKET_GYAN_REVIEW_TARGET=500
MARKET_GYAN_SECOND_REVIEW_TARGET=110

MARKET_GYAN_POST_MARKET_SCHEDULER_ENABLED=false
MARKET_GYAN_QUERY_ENABLED=false
```

Store real credentials only in the ignored `.env`. Never put a key in source,
documentation, screenshots, notebooks, or commits. Rotate any exposed key.

## 2. Verify the Workspace

```bash
cd minimal/news-backend
npm test

cd ../news-aggregator
CI=true npm test -- --watchAll=false

cd ../../ml/marketGyan
PYTHONPATH=. python3 -m unittest discover -s tests -v
```

The normal tests mock Gemma and consume no API quota. The explicit live smoke
test consumes quota:

```bash
cd minimal/news-backend
set -a
source .env
set +a
npm run market-gyan:test-live-gemma
```

## 3. Preserve the Schema-v1 Pilot

Do not continue approving v1 records. Inspect it explicitly:

```bash
cd minimal/news-backend
npm run market-gyan:status -- --schema-version=1 --target=452
```

Export v1 only for pilot-error analysis:

```bash
npm run market-gyan:export-labels -- \
  --schema-version=1 \
  --output=../../ml/marketGyan/data/audit/schema-v1-pilot.jsonl
```

V1 records are never mixed into the NEPSE-Impact-500 gold export.

## 4. Collect Targeted 2025-2026 Documents

Collect numeric market history independently:

```bash
npm run market-gyan:backfill -- \
  --from=2025-01-01 \
  --to=2026-06-15
```

Extend ShareSansar into 2025 for company, dividend, listing, allotment,
financial-result, IPO/FPO, and market events:

```bash
npm run market-gyan:backfill -- \
  --from=2025-01-01 \
  --to=2026-06-15 \
  --document-only=true \
  --sources=sharesansar \
  --sharesansar-limit=1200 \
  --sharesansar-max-pages=100 \
  --force=true
```

Collect supplementary macro, sector, hard-negative, and regulatory coverage:

```bash
npm run market-gyan:backfill -- \
  --from=2025-01-01 \
  --to=2026-06-15 \
  --document-only=true \
  --sources=onlinekhabar,kathmandupost,regulatory \
  --onlinekhabar-limit=600 \
  --onlinekhabar-max-pages=50 \
  --kathmandupost-limit=80 \
  --regulatory-limit=150 \
  --regulatory-max-pages=50 \
  --force=true
```

Resume older OnlineKhabar RSS pages without replaying the newest archive:

```bash
npm run market-gyan:backfill -- \
  --from=2025-01-01 \
  --to=2026-06-15 \
  --document-only=true \
  --sources=onlinekhabar \
  --onlinekhabar-start-page=12 \
  --onlinekhabar-max-pages=12 \
  --onlinekhabar-limit=600 \
  --force=true
```

Unreadable regulatory documents remain failed audit records and are excluded.
Do not add OCR work to this project.

## 5. Audit and Queue the V2 Corpus

Sync the versioned English/Nepali aliases into the active security registry:

```bash
npm run market-gyan:sync-ontology
```

Run the read-only selector:

```bash
npm run market-gyan:select-v2 -- \
  --from=2025-01-01 \
  --to=2026-06-15 \
  --output=../../ml/marketGyan/data/audit/v2-selection-plan.json
```

The plan is ready only when it can select:

- 300 direct records
- 100 indirect records
- 100 hard negatives
- at least 200 English and 200 Nepali records
- at least 150 symbol-level records
- at least 20 records for each core event category
- no source above 330 records

The selector prints `quotaChecks`, exact `quotaDeficits`, and total
`availableCounts`. Do not queue reserve substitutions to conceal a deficit.

Queue the selected records with schema v2:

```bash
npm run market-gyan:queue-v2 -- \
  --from=2025-01-01 \
  --to=2026-06-15
```

Queueing is idempotent by content hash, model, prompt version, and schema
version. V1 records are not overwritten.

Inspect v2 status:

```bash
npm run market-gyan:status -- --schema-version=2 --target=500
```

## 6. Run Gemma V2

Enable structuring only in the ignored `.env`:

```env
MARKET_GYAN_STRUCTURING_ENABLED=true
MARKET_GYAN_PROMPT_VERSION=market-impact-v2
MARKET_GYAN_SCHEMA_VERSION=2
GEMINI_API_KEY=your-rotated-key
```

Run one live item first:

```bash
npm run market-gyan:process -- \
  --schema-version=2 \
  --prompt-version=market-impact-v2 \
  --limit=1
```

Then use resumable batches:

```bash
npm run market-gyan:process -- \
  --schema-version=2 \
  --prompt-version=market-impact-v2 \
  --limit=25

npm run market-gyan:retry -- \
  --schema-version=2 \
  --prompt-version=market-impact-v2 \
  --transient-only=true \
  --max-attempts=2 \
  --limit=100
```

Codex pre-review is paused for the remaining candidate set. Reviewers should
validate the raw Gemma candidate in the web UI, then submit, reject, or edit it
directly. The `assistant-review-export` and `assistant-review-import` commands
remain in the CLI only for historical audit experiments; do not run them during
the current NEPSE-Impact-500 annotation pass.

Gemma receives only the title and numbered sentences derived from the first
1,500 cleaned characters. Source metadata, dates, prices, and reaction values
remain outside model control.

## 7. Annotate and Adjudicate

Start one reviewer identity at a time:

```bash
cd minimal/news-backend
MARKET_GYAN_REVIEW_ENABLED=true \
MARKET_GYAN_REVIEWER_ID=reviewer-1 \
MARKET_GYAN_REVIEWER_ROLE=primary \
NODE_ENV=development \
npm start
```

Start the local review client:

```bash
cd minimal/news-aggregator
npm install
npm start
```

The review flow is:

1. Decide `direct`, `indirect`, or `not_relevant`.
2. For relevant records, validate event, scope, direction, horizon, mechanism,
   sectors, symbols, rationale, and numbered evidence.
3. Save a draft or submit the independent annotation.
4. Use `reviewer-2` with role `secondary` for the marked 110-record subset.
5. Use a separate identity with role `adjudicator` to resolve submitted
   annotations into gold or exclude the record.

Example adjudicator configuration:

```env
MARKET_GYAN_REVIEWER_ID=adjudicator-1
MARKET_GYAN_REVIEWER_ROLE=adjudicator
```

There is no blank manual-label workflow. Regeneration is blocked after a
review is submitted or a record is adjudicated.

### Model-error revalidation pass

After a training run, import the generated error audit so difficult examples
are reviewed inside the same validation UI instead of by manually editing
JSONL:

```bash
cd minimal/news-backend
npm run market-gyan:import-revalidation-audit -- --schema-version=2
```

The review UI also exposes a **Load model-error audit** button that runs the
same local-only import endpoint. Then enable the **Needs revalidation** filter.
The UI automatically clears the normal status/adjudication filters and includes
already submitted records, so previously reviewed items can be corrected from
the original source text, sentence IDs, ontology controls, and revision history.

Submitting, rejecting, excluding, or adjudicating a flagged item clears its
`needsReview` flag so the queue advances to the next priority sample. Saving a
draft keeps the flag active.

### Taxonomy-consistency revalidation pass

Before another Qwen run, flag likely ontology drift in dividend, right-share,
IPO/listing/allotment, debenture, and market-summary records. The audit never
edits gold labels by itself; it only queues records in the validation UI:

```bash
cd minimal/news-backend
npm run market-gyan:taxonomy-audit -- \
  --schema-version=2 \
  --output=../../docs/market-gyan/taxonomy-audit/second-run-taxonomy-audit.json

npm run market-gyan:taxonomy-audit -- \
  --schema-version=2 \
  --import=true \
  --output=../../docs/market-gyan/taxonomy-audit/second-run-taxonomy-audit.json
```

Then use the **Needs revalidation** filter in the validation UI. Reviewers
should confirm or correct the event type and mechanism using the source
sentences. The second-run audit imported 57 flags: 26 dividend decisions,
23 IPO/listing/allotment records, 5 right-share records, 2 market-summary
records, and 1 debenture record.

The review UI has a separate **Load taxonomy audit** button. Audit imports are
idempotent by default: already active records are skipped, and records with a
prior `revalidation_resolved` revision are not reopened unless a command is
run explicitly with `--force=true`.

## 8. Export and Freeze NEPSE-Impact-500

After all primary annotations are submitted, validate them without changing the
database:

```bash
cd minimal/news-backend
npm run market-gyan:adjudicate-submitted -- \
  --schema-version=2 \
  --reviewer=adjudicator-1 \
  --dry-run=true
```

If the dry run reports `ready: true`, create gold labels from the submitted
primary annotations:

```bash
npm run market-gyan:adjudicate-submitted -- \
  --schema-version=2 \
  --reviewer=adjudicator-1 \
  --dry-run=false
```

Audit the final corpus balance before export:

```bash
npm run market-gyan:rebalance-audit -- \
  --schema-version=2 \
  --target=500
```

If the audit reports the known post-adjudication gap of 48 direct records,
5 indirect records, and 53 surplus hard negatives, apply the deterministic
NEPSE-Impact-500 rebalance patch. The dry run prints the planned exclusions,
reclassifications, and replacements without changing the database:

```bash
npm run market-gyan:rebalance-apply -- --dry-run=true
npm run market-gyan:rebalance-apply -- --dry-run=false

npm run market-gyan:rebalance-audit -- \
  --schema-version=2 \
  --target=500
```

The rebalance command records targeted replacements with the
`marketgyan_rebalance` provider, excludes surplus weak hard negatives, and
preserves the original Gemma candidates and submitted review history for audit.
Use it only for this NEPSE-Impact-500 milestone unless the replacement list is
updated deliberately.

Do not treat the JSONL as training-ready until the rebalance audit and Python
gate both pass. Export only adjudicated v2 records:

```bash
npm run market-gyan:export-labels -- \
  --schema-version=2 \
  --output=../../ml/marketGyan/data/processed/nepse-impact-500.jsonl
```

Validate the exact composition:

```bash
cd ml/marketGyan
PYTHONPATH=. python3 -m market_gyan.cli validate \
  data/processed/nepse-impact-500.jsonl

PYTHONPATH=. python3 -m market_gyan.cli gate \
  data/processed/nepse-impact-500.jsonl \
  --min-records=500
```

Measure independent-review agreement:

```bash
PYTHONPATH=. python3 -m market_gyan.cli agreement \
  data/processed/nepse-impact-500.jsonl \
  outputs/annotation-agreement.json \
  --minimum=110
```

Freeze the shared balanced split:

```bash
PYTHONPATH=. python3 -m market_gyan.cli split \
  data/processed/nepse-impact-500.jsonl \
  data/processed/splits \
  --strategy balanced
```

Do not regenerate the manifest between model runs unless revalidation changes
one or more gold labels. If labels change, export, validate, gate, and freeze a
new balanced split before rerunning any model.

## 9. Run Model Experiments

Regenerate notebook JSON after editing the readable builder:

```bash
cd ml/marketGyan
python3 notebooks/build_notebooks.py
```

Run `notebooks/xlmr_baseline.ipynb` first. It trains:

- XLM-R relevance on all records
- XLM-R direction on relevant records
- ProsusAI/finbert direction on the English relevant subset

Run `notebooks/qwen3_8b_qlora.ipynb` next. It evaluates:

- base Qwen3-8B zero-shot
- base Qwen3-8B three-shot
- MarketGyan Qwen3-8B Unsloth QLoRA

The QLoRA notebook uses `unsloth/Qwen3-8B`, `FastLanguageModel`,
`FastLanguageModel.get_peft_model`, Unsloth gradient checkpointing,
TRL `SFTTrainer`, and response-only masking. The configuration is 4-bit
loading, sequence length 1536 with a 1024 fallback if GPU memory fails, LoRA
rank 16, alpha 32, dropout 0.05, batch size 1, gradient accumulation 16,
learning rate `1e-4`, and five epochs.
Qwen is trained as a compact classifier/extractor: it generates only canonical
labels, sectors, symbols, confidence, and evidence sentence IDs. Evidence text,
summaries, rationales, and report prose are reconstructed later from RAG
evidence and deterministic market data. The notebook oversamples all Nepali
records, all indirect and hard-negative records, and one additional copy of
Nepali indirect and Nepali hard-negative records. Generation uses
`max_new_tokens`, an opening-JSON-brace prefix, `MAX_GENERATION_TOKENS=192`,
and `repetition_penalty=1.05` to discourage Markdown bullets and looping
evidence lists.

For the third Qwen run, prefer a vLLM/OpenAI-compatible endpoint with JSON
Schema constrained decoding. The notebook still runs the local
`transformers.generate` path as a strict diagnostic, but constrained decoding
is the expected runtime path for valid compact JSON:

```bash
export MARKET_GYAN_USE_VLLM_CONSTRAINED=true
export MARKET_GYAN_VLLM_BASE_URL=http://127.0.0.1:8000/v1
export MARKET_GYAN_VLLM_API_KEY=local
export MARKET_GYAN_VLLM_MODEL=marketgyan-qwen3-8b
```

The constrained cells save `qwen_vllm_constrained_zero_shot.jsonl` and
`qwen_vllm_constrained_three_shot.jsonl`. If the endpoint is not running, leave
`MARKET_GYAN_USE_VLLM_CONSTRAINED=false` and treat unconstrained Qwen as a
failure-analysis run rather than a deployment candidate.

After training, run the built-in 10-example smoke generation cell before the
full test generation cell. Continue only if at least 8 of the 10 validation
outputs are strict valid compact JSON. The official metrics remain strict; the
optional tolerant repaired-output metric is diagnostic only. It can parse
failure-analysis cases such as compact objects with unquoted keys, but it does
not count toward deployment readiness.

For Colab or Kaggle:

```bash
pip install --upgrade --force-reinstall --no-cache-dir unsloth unsloth_zoo
pip install -r requirements.txt
```

Use a T4 16 GB minimum. Upload the complete `ml/marketGyan` directory,
including the frozen manifest. The Qwen notebook does not keep intermediate
`checkpoint-*` directories; it saves only the final adapter, tokenizer,
predictions, metrics, and plots. Download the generated ZIP archive before the
runtime expires.

Run the hard-negative ablation by changing only
`include_hard_negatives=False` in the Qwen notebook and writing to a separate
output directory.

Recommended rerun order after dataset or notebook changes:

1. Validate the adjudicated JSONL.
2. Run and review the taxonomy-consistency audit if a previous run exposed
   label drift.
3. Regenerate the balanced split only if labels changed.
4. Rerun XLM-R and FinBERT baselines if labels changed.
5. Rerun Qwen zero-shot, three-shot, and Unsloth QLoRA.
6. Compare all models on the identical balanced test IDs.

## 10. Benchmark and Adaptation Claim

Score a model prediction file:

```bash
PYTHONPATH=. python3 -m market_gyan.cli benchmark \
  data/processed/splits/test.jsonl \
  outputs/qwen-test-predictions.jsonl \
  outputs/qwen-test-metrics.json
```

For Qwen failure analysis only, write a tolerant diagnostic report:

```bash
PYTHONPATH=. python3 -m market_gyan.cli benchmark \
  data/processed/splits/test.jsonl \
  outputs/qwen-test-predictions.jsonl \
  outputs/qwen-test-tolerant-diagnostic.json \
  --repair-diagnostic
```

Use the first command for the official gate. Use the second command only to
understand whether invalid raw text contains recoverable compact-label content.

Audit baseline prediction errors against gold labels:

```bash
PYTHONPATH=. python3 -m market_gyan.cli audit-predictions \
  data/processed/splits/test.jsonl \
  outputs/xlmr_rel_predictions.json \
  outputs/audits/xlmr_relevance_audit.json \
  --task=relevance

PYTHONPATH=. python3 -m market_gyan.cli audit-predictions \
  data/processed/splits/test.jsonl \
  outputs/xlmr_dir_predictions.json \
  outputs/audits/xlmr_direction_audit.json \
  --task=direction
```

Compare paired base and tuned per-record scores:

```bash
PYTHONPATH=. python3 -m market_gyan.cli compare-models \
  outputs/base-qwen-paired-scores.json \
  outputs/qlora-paired-scores.json \
  outputs/adaptation-bootstrap.json
```

Claim successful adaptation only when QLoRA improves macro-F1 by at least
0.05 or the paired bootstrap 95% confidence interval excludes zero.

## 11. Market-Reaction Analysis

After adjudication:

```bash
cd minimal/news-backend
npm run market-gyan:reactions -- --limit=500
npm run market-gyan:export-reactions -- \
  --output=../../ml/marketGyan/data/processed/market-reactions.jsonl
```

Then:

```bash
cd ml/marketGyan
PYTHONPATH=. python3 -m market_gyan.cli reaction-analysis \
  data/processed/market-reactions.jsonl \
  outputs/market-reaction-analysis.json \
  --material-threshold=0.5 \
  --bootstrap-samples=2000
```

Treat these results as association only, not causation, forecasting, or a
trading signal.

## 12. RAG and Deployment Evaluation

Keep runtime inference disabled while experiments are incomplete. Run the
existing retrieval and scenario harnesses for RAG enabled versus disabled:

```bash
PYTHONPATH=. python3 -m market_gyan.cli system-evaluate \
  evaluation/retrieval_results.json \
  evaluation/scenario_results.json \
  outputs/system-metrics.json
```

Runtime requires at least 95% structured validity and evidence grounding,
usable performance for every relevance and direction class, and a successful
adaptation comparison.

For the RAG demo, sentence IDs are internal anchors only. Qdrant payloads and
agent citations should carry `documentId`, `chunkId`, `title`, `url`, `source`,
`publishedAt`, `contentHash`, `sentenceIds`, expanded sentence text, and the
retrieved excerpt. The user-facing report should show the source title, URL,
date, and quoted evidence text, not only labels such as `S3`.

For a local end-to-end frontend demo without relying on Qwen generation
quality, use the deterministic mock agent mode. It still calls the Node
internal search endpoint and validates citations, but it builds a simple
grounded answer/report from retrieved Qdrant chunks:

```bash
# Terminal 1: Qdrant
docker run --rm -p 6333:6333 qdrant/qdrant

# Terminal 2: backend
cd minimal/news-backend
export MARKET_GYAN_QUERY_ENABLED=true
export MARKET_GYAN_REVIEW_ENABLED=true
export MARKET_GYAN_AGENT_SERVICE_TOKEN=local-dev-token
export QDRANT_URL=http://127.0.0.1:6333
npm start

# Terminal 3: index evidence
cd minimal/news-backend
npm run market-gyan:index -- --limit=1000

# Terminal 4: FastAPI agent in deterministic mock mode
cd ml/marketGyan
python -m pip install -r requirements-agent.txt
export MARKET_GYAN_QUERY_ENABLED=true
export MARKET_GYAN_AGENT_MOCK_ENABLED=true
export MARKET_GYAN_AGENT_SERVICE_TOKEN=local-dev-token
export MARKET_GYAN_NODE_BASE_URL=http://127.0.0.1:5001
PYTHONPATH=. uvicorn agent_service.app:app --host 127.0.0.1 --port 8100

# Terminal 5: frontend
cd minimal/news-aggregator
npm start
```

In the Market Gyan dashboard, use **Evidence Search** to confirm Qdrant
retrieval, **Ask MarketGyan** to confirm grounded Q&A, **Reports** to generate
a local report, and **System** to inspect runtime readiness. The report
generation button is hidden unless the request is local, non-production, and
review mode is enabled.

## Troubleshooting

### HTTP 429

Confirm project quota in AI Studio. Keep concurrency at 1 and RPM at or below
15. Retry transient failures only.

### Gemma timeouts or provider failures

Resume with the same schema and prompt flags. Idempotency prevents duplicate
jobs. The circuit breaker pauses after repeated transient failures.

### Invalid evidence

V2 evidence must contain sentence IDs present in `input.sentences`. Do not
replace them with paraphrases or free-form quotes.

### Empty export

The v2 export is empty until an adjudicator creates gold records. Submitted
primary annotations alone are not exportable. After adjudication, run the
rebalance audit before export; excluded, pending, failed, and non-gold labels
are intentionally omitted.

### MongoDB failure

The API and long-running Gemma worker automatically recover from temporary
disconnects, machine sleep, and server-monitor timeouts. The worker retries
database claims and saves without discarding an in-memory Gemma result.

The local defaults are:

```env
MONGODB_SERVER_SELECTION_TIMEOUT_MS=30000
MONGODB_CONNECT_TIMEOUT_MS=10000
MONGODB_SOCKET_TIMEOUT_MS=0
MONGODB_HEARTBEAT_FREQUENCY_MS=10000
MONGODB_MAX_IDLE_TIME_MS=0
MONGODB_RETRY_DELAY_MS=1000
MONGODB_RETRY_MAX_DELAY_MS=30000
```

Verify the service and queue after a machine wake or database restart:

```bash
brew services list | grep mongodb
mongosh "$MONGODB_URI" --quiet --eval 'db.adminCommand({ ping: 1 })'
npm run market-gyan:status -- --schema-version=2 --target=500
```

### CUDA memory error

Use a T4 16 GB or better, keep batch size 1, use gradient accumulation 16,
close other GPU sessions, then restart the Qwen training cell from the
beginning. The Qwen notebook intentionally avoids intermediate checkpoints to
keep the final artifact small.

### Interrupted training

For Qwen, rerun the training cell from the beginning and download the generated
ZIP when it finishes. For XLM-R, temporary checkpoints may exist during
training for early stopping, but they are removed after the final model is
saved.

### Legacy Nepali PDF

Record the extraction failure and exclude the document. OCR and legacy-font
conversion are not project tasks.

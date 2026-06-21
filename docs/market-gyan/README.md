# Market Gyan

Market Gyan extends Khabar AI into a Nepal-focused financial-analysis system.
Its research contribution is **NEPSE-Impact-500**, a human-adjudicated
bilingual benchmark and Qwen3-8B adapter for relevance, event classification,
listed-company and sector mapping, and evidence-grounded potential-impact
explanations.

The schema-v1 labels are frozen as a pilot audit. Schema v2 uses
`market-impact-v2`, independent annotations, explicit adjudication, and
numbered sentence evidence. Current facts remain in RAG rather than model
weights.

Qwen is treated as a compact classifier/extractor, not a report writer. The
next Qwen run supports optional vLLM/OpenAI-compatible JSON Schema constrained
decoding because fine-tuning alone did not reliably prevent Markdown/prose
outputs. Sentence IDs are internal evidence anchors; user-facing RAG citations
must expand them into source title, URL, date, quoted sentence text, chunk ID,
and content hash.

## Project Documentation

- [Progress report](progress-report/README.md): updateable LaTeX engineering
  report covering the data pipeline, dataset state, and model work.
- [Setup and operations](README_SETUP.md): local collection, Gemma structuring,
  review, export, and cloud GPU training commands.

This directory summarizes the architecture and development boundaries described
in the April 6, 2026 MarketGyan semester project proposal. The proposal PDF is
kept outside the repository and is not committed as a binary.

## Foundation Architecture

Market Gyan reuses the existing Khabar AI platform:

- React provides the dashboard, evidence search, grounded question-answering
  view, report viewer, local report-generation control, and runtime checklist.
- Express exposes Market Gyan APIs under `/api/market-gyan`.
- MongoDB remains the operational system of record.
- Qdrant uses a dedicated Market Gyan collection for financial, regulatory,
  and published-report chunks.
- A separate FastAPI service coordinates evidence retrieval, analysis, and
  validated publication through a disabled-by-default local endpoint. Local
  demos can use deterministic mock mode before Qwen is deployment-ready.
- Existing scheduler and newsletter patterns support idempotent post-market
  processing and report delivery.

The planned data flow is:

1. Collect NEPSE close data, finance articles, and regulatory notices.
2. Normalize content, retain English and Nepali text, and record provenance.
3. Extract machine-readable PDF text; retain unreadable files as failed audit
   records and exclude them from downstream processing.
4. Index finance and regulatory chunks in the Market Gyan Qdrant collection.
5. Retrieve evidence for constrained researcher, analyst, and publisher stages.
6. Publish a daily report, dashboard data, and an optional email digest.

The data-pipeline milestone adds opt-in collection and Gemma-assisted
structuring. Generated candidates require human validation before export.

## Domain Contracts

The backend feature module lives at
`minimal/news-backend/features/marketGyan/` and defines:

- `MarketSnapshot`: daily NEPSE index values, turnover, sector movement, market
  leaders, collection status, and source provenance.
- `MarketDocument`: references existing Khabar `Article` records for financial
  news and stores original/cleaned text for regulatory or generated documents.
- `MarketReport`: daily report status, sector analysis, evidence citations, and
  model-generation metadata.

Finance articles remain in the existing `Article` collection. Market Gyan links
to them rather than creating a duplicate article store.

## Delivery Roadmap

1. **Foundation:** contracts, configuration, overview API, dashboard shell, and
   tests.
2. **Data pipeline:** deterministic NEPSE snapshots, finance-only sources,
   provenance, deduplication, regulatory PDF text, Gemma structuring, and local
   validation.
3. **Retrieval:** multilingual chunking, embeddings, and finance-specific
   Qdrant search with source, date, sector, language, and document filters.
4. **Model work:** 500 adjudicated English and Nepali records; near-duplicate
   safe chronological splits; XLM-R, FinBERT, base-Qwen, and Qwen3-8B QLoRA
   experiments; ablations; agreement; and reaction analysis.
5. **Analysis and publication:** constrained evidence gathering, sector
   interpretation, structured reports, dashboard population, and digest delivery.
6. **Evaluation:** relevance/event/direction macro-F1, taxonomy and evidence
   F1, reviewer agreement, reaction association, retrieval Precision@k,
   citation correctness, schema adherence, freshness, and latency.

OCR and legacy Nepali-font conversion are outside the project scope. Failed
regulatory extraction records remain auditable but are not queued, indexed, or
used for training.

## Configuration

The foundation introduces these environment boundaries:

```env
MARKET_GYAN_QDRANT_COLLECTION=market_gyan_documents
MARKET_GYAN_TIMEZONE=Asia/Kathmandu
MARKET_GYAN_POST_MARKET_CRON=30 15 * * 0-4
MARKET_GYAN_POST_MARKET_SCHEDULER_ENABLED=false
MARKET_GYAN_REVIEW_ENABLED=false
MARKET_GYAN_REVIEWER_ID=reviewer-1
MARKET_GYAN_REVIEWER_ROLE=primary
MARKET_GYAN_REVIEW_TARGET=500
MARKET_GYAN_SECOND_REVIEW_TARGET=110
MARKET_GYAN_STRUCTURING_ENABLED=false
MARKET_GYAN_QUERY_ENABLED=false
MARKET_GYAN_AGENT_SERVICE_URL=http://127.0.0.1:8100
MARKET_GYAN_AGENT_SERVICE_TOKEN=
MARKET_GYAN_INFERENCE_BASE_URL=http://127.0.0.1:8000/v1
MARKET_GYAN_INFERENCE_API_KEY=local
MARKET_GYAN_INFERENCE_MODEL=marketgyan-qwen3-8b
MARKET_GYAN_GEMMA_MODEL=gemma-4-26b-a4b-it
MARKET_GYAN_GEMMA_RPM=15
MARKET_GYAN_GEMMA_CONCURRENCY=1
MARKET_GYAN_PROMPT_VERSION=market-impact-v2
MARKET_GYAN_SCHEMA_VERSION=2
MARKET_GYAN_REQUEST_TIMEOUT_MS=90000
GEMINI_API_KEY=
```

The scheduler and Gemma worker are disabled by default. Review APIs are exposed
only in non-production mode, when explicitly enabled, and only to loopback
requests.

The API key shared during development is compromised and must not be used.
Create a replacement auth key, restrict it to the Gemini API, store it only in
the ignored backend `.env`, and disable the exposed key. Google applies active
quotas per project rather than per key, so confirm the current project limits in
[AI Studio](https://ai.google.dev/gemini-api/docs/rate-limits). Google also
states that unrestricted standard keys will stop working on June 19, 2026; use
the current [API-key migration and leak-response guidance](https://ai.google.dev/gemini-api/docs/api-key).

## Data and Structuring Commands

Run commands from `minimal/news-backend`:

```bash
npm run market-gyan:ingest -- --date=2026-06-11
npm run market-gyan:backfill -- --from=2025-01-01 --to=2026-06-15
npm run market-gyan:select-v2 -- --from=2025-01-01 --to=2026-06-15
npm run market-gyan:queue-v2 -- --from=2025-01-01 --to=2026-06-15
npm run market-gyan:process -- --schema-version=2 --prompt-version=market-impact-v2 --limit=25
npm run market-gyan:retry -- --schema-version=2 --prompt-version=market-impact-v2 --limit=100
npm run market-gyan:adjudicate-submitted -- --schema-version=2 --reviewer=adjudicator-1 --dry-run=true
npm run market-gyan:adjudicate-submitted -- --schema-version=2 --reviewer=adjudicator-1 --dry-run=false
npm run market-gyan:rebalance-audit -- --schema-version=2 --target=500
npm run market-gyan:rebalance-apply -- --dry-run=true
npm run market-gyan:rebalance-apply -- --dry-run=false
npm run market-gyan:rebalance-audit -- --schema-version=2 --target=500
npm run market-gyan:status -- --schema-version=2 --target=500
npm run market-gyan:index -- --limit=1000
npm run market-gyan:export-labels -- --schema-version=2 --output=../../ml/marketGyan/data/processed/nepse-impact-500.jsonl
```

The full document-only archive command and per-source limits are documented in
[Setup and operations](README_SETUP.md).

After replacing the exposed credential with a newly rotated key, run the
explicit quota-consuming smoke test with:

```bash
npm run market-gyan:test-live-gemma
```

Numeric market values are parsed deterministically. Official NEPSE values take
priority; ShareSansar is the first fallback and MeroLagani corroborates it.
Fallback disagreements outside tolerance are withheld rather than averaged.

Gemma receives only public document title and a cleaned excerpt of at most 1,500
characters. It cannot set source metadata, dates, or numeric market values.
Candidates with invalid taxonomies or unsupported evidence are rejected before
review.

Codex pre-review is not part of the remaining annotation workflow. Unsubmitted
records now show raw Gemma candidates only; the human reviewer validates,
edits, submits, or rejects them directly. Previously submitted annotations keep
their existing assistant-review audit where present.

The June 16, 2026 final rebalance produced the adjudicated NEPSE-Impact-500
gold corpus: 300 direct events, 100 indirect events, and 100 hard negatives;
299 English, 200 Nepali, and one mixed-language record; 273 symbol-level
records; at least 20 examples for every core event gap category; and no source
above 60 percent. The approved JSONL has been exported to `ml/marketGyan`, and
the chronological duplicate-grouped train/validation/test split is frozen.
Runtime inference remains disabled until the evaluation gates pass.

## Safety and Non-Goals

Market Gyan is an informational research prototype based on public data. It must
show source links, distinguish evidence from interpretation, and use cautious
language when evidence is incomplete.

It will not:

- connect to brokerage accounts or place trades;
- manage personal portfolios;
- issue direct buy or sell recommendations;
- claim that retrieved news proves market causation;
- present generated analysis as guaranteed or professional investment advice.

User-facing output must retain this disclaimer:

> Informational analysis based on public data, not investment advice.

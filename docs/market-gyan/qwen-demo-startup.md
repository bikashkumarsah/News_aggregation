# MarketGyan Qwen Demo Startup Guide

This guide starts the local MarketGyan demo against the currently hosted Qwen/vLLM endpoint.

Warning: this file includes the local demo vLLM bearer token used for the current run. Do not publish this file without replacing the token.

## Services

- Frontend: `http://127.0.0.1:3000`
- Backend: `http://127.0.0.1:5001`
- Agent service: `http://127.0.0.1:8100`
- Qdrant: `http://127.0.0.1:6333`
- Hosted Qwen/vLLM base URL: `https://8000-01kwhwsgfw10pnw63zy3ncvybz.cloudspaces.litng.ai/v1`
- Qwen model alias: `marketgyan-qwen35-9b-targeted-v2`

## 1. Start Local Dependencies

Start MongoDB:

```bash
brew services start mongodb-community
```

Start Qdrant if it is not already running:

```bash
docker run --rm -p 6333:6333 qdrant/qdrant
```

Check Qdrant:

```bash
curl -fsS http://127.0.0.1:6333/healthz
curl -fsS http://127.0.0.1:6333/collections/market_gyan_documents
```

## 2. Start The Agent Service

The values below match the currently running local demo setup.

```bash
cd /Users/bikashkumarsah/Downloads/archived_personal/khabar-market-gyan/ml/marketGyan

export MARKET_GYAN_QUERY_ENABLED=true
export MARKET_GYAN_AGENT_MOCK_ENABLED=false
export MARKET_GYAN_AGENT_SERVICE_TOKEN=local-dev-token
export MARKET_GYAN_NODE_BASE_URL=http://127.0.0.1:5001

export MARKET_GYAN_INFERENCE_BASE_URL="https://8000-01kwhwsgfw10pnw63zy3ncvybz.cloudspaces.litng.ai/v1"
export MARKET_GYAN_INFERENCE_API_KEY="marketgyan-local-test-token"
export MARKET_GYAN_INFERENCE_MODEL="marketgyan-qwen35-9b-targeted-v2"
export MARKET_GYAN_AGENT_TIMEOUT_SECONDS=300
export MARKET_GYAN_AGENT_MAX_TOKENS=768

PYTHONPATH=. /Users/bikashkumarsah/anaconda3/bin/uvicorn agent_service.app:app \
  --host 127.0.0.1 \
  --port 8100
```

Preflight:

```bash
curl -fsS http://127.0.0.1:8100/health
```

Expected fields:

- `queryEnabled: true`
- `mockEnabled: false`
- `runtime: "single_pass"`
- `model: "marketgyan-qwen35-9b-targeted-v2"`

## 3. Start The Backend

Open a new terminal:

```bash
cd /Users/bikashkumarsah/Downloads/archived_personal/khabar-market-gyan/minimal/news-backend

MARKET_GYAN_QUERY_ENABLED=true \
MARKET_GYAN_REVIEW_ENABLED=true \
MARKET_GYAN_AGENT_SERVICE_URL=http://127.0.0.1:8100 \
MARKET_GYAN_AGENT_SERVICE_TOKEN=local-dev-token \
MARKET_GYAN_AGENT_TIMEOUT_MS=300000 \
QDRANT_URL=http://127.0.0.1:6333 \
npm start
```

Preflight:

```bash
curl -fsS http://127.0.0.1:5001/api/market-gyan/runtime/status
curl -fsS "http://127.0.0.1:5001/api/market-gyan/search?q=banking"
```

## 4. Start The Frontend

Open a new terminal:

```bash
cd /Users/bikashkumarsah/Downloads/archived_personal/khabar-market-gyan/minimal/news-aggregator

BROWSER=none HOST=127.0.0.1 PORT=3000 npm start
```

Open:

```text
http://127.0.0.1:3000
```

Use the MarketGyan dashboard tabs:

- `Overview`: runtime, latest snapshot, latest report, Qdrant readiness.
- `Ask MarketGyan`: grounded Qwen answer with citations.
- `Evidence Search`: direct Qdrant evidence retrieval.
- `Reports`: local report generation and latest published report.
- `System`: service readiness checks.

## 5. Smoke Test The Live Qwen Path

Use no sector filter first, because current indexed metadata can return empty result sets for some sector filters.

```bash
curl -m 300 -sS http://127.0.0.1:5001/api/market-gyan/query \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What recent banking or liquidity news may matter for NEPSE investors?",
    "filters": {}
  }'
```

The response should include:

- `success: true`
- `data.answer`
- `data.citations`
- citation sentence IDs and source URLs

## 6. Demo Queries To Record

Use these in the `Ask MarketGyan` tab. Start without filters unless you specifically want to demonstrate the known retrieval-filter limitation.

1. `What recent banking or liquidity news may matter for NEPSE investors?`
2. `Summarize the latest evidence about liquidity, interest rates, and banking-sector pressure in Nepal.`
3. `What public evidence explains recent NEPSE market weakness or investor caution?`
4. `Which recent regulatory or policy updates could affect Nepal's share market?`
5. `Give me a grounded market brief for today's available snapshot with citations and no buy or sell advice.`

For `Evidence Search`, use shorter search phrases:

- `banking liquidity`
- `NEPSE securities dealer`
- `working capital loan`
- `share loan cap`
- `market liquidity Nepal Rastra Bank`

## 7. Common Fixes

If the agent health endpoint is down:

```bash
lsof -nP -iTCP:8100 -sTCP:LISTEN
```

If the backend cannot connect to MongoDB:

```bash
brew services start mongodb-community
```

If search returns no results:

```bash
curl -fsS http://127.0.0.1:6333/collections/market_gyan_documents
```

If a filtered Ask query fails with `No retrievable MarketGyan evidence is available`, remove the sector/source filter and retry. This is a known retrieval metadata limitation, not a Qwen hosting failure.

## 8. Stop Services

If the services were started in terminals, press `Ctrl+C` in each terminal.

To find and stop by port:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:5001 -sTCP:LISTEN
lsof -nP -iTCP:8100 -sTCP:LISTEN
```

Then stop a process:

```bash
kill <PID>
```

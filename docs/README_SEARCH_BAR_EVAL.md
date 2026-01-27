## Search Bar Retrieval Evaluation — Precision@5 (3 Embedding Models)

Goal: compare semantic retrieval quality of the **webapp search bar** across 3 multilingual embedding models by manually labeling top results and computing **Precision@5**.

Models compared:
1. `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (384d)
2. `Xenova/multilingual-e5-small` (384d)
3. `Xenova/distiluse-base-multilingual-cased-v2` (768d)
v
---

## 1) Generate an eval file (5 queries × top‑5 results × 3 models)

```bash
cd minimal/news-backend
node scripts/eval/runSearchBarModelComparison.js --k 5
```

It writes:
- `eval/search_eval_<timestamp>.json`

If you want to **reindex** the collections before generating results:

```bash
cd minimal/news-backend
node scripts/eval/runSearchBarModelComparison.js --k 5 --index --days 7
```

---

## 2) Label relevance (manual)

### Option A — Interactive CLI (recommended)

```bash
cd minimal/news-backend
node scripts/eval/labelSearchEval.js /absolute/path/to/eval/search_eval_....json
```

Controls:
- `y` = relevant
- `n` = not relevant
- `s` = skip (leave as null)
- `q` = quit (saves progress)

### Option B — Edit JSON
Open the file and set `relevant: true/false` for each item.

---

## 3) Compute Precision@5

```bash
cd minimal/news-backend
node scripts/eval/scoreSearchEval.js /absolute/path/to/eval/search_eval_....json
```

This prints Precision@5 per model.


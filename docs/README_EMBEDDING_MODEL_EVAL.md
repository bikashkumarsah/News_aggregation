## Embedding Model Evaluation (Newsletter) — Precision@5

Goal: compare 3 multilingual embedding models for newsletter recommendations:
1. **paraphrase-multilingual-MiniLM-L12-v2** (baseline, 384d)
2. **multilingual-e5-small** (384d)
3. **distiluse-base-multilingual-cased-v2** (768d)

We generate **top‑5 recommendations per user**, manually label relevance, then compute **Precision@5**.

---

## 1) Prerequisites

- MongoDB running (`newsDB`)
- Qdrant running (`http://localhost:6333`)
- Backend dependencies installed:

```bash
cd minimal/news-backend
npm install
```

---

## 2) Generate a comparison eval file (20 users × top‑5)

This script:
- samples users with reading history
- (optionally) indexes Qdrant for each model into a separate collection
- generates top‑5 newsletter recommendations for the same users for each model
- writes a JSON file under `eval/`

```bash
cd minimal/news-backend
node scripts/eval/runNewsletterModelComparison.js --users 20 --k 5 --index
```

Output example:
- `eval/newsletter_eval_2026-01-24T...json`

> Note: If you have fewer than 20 real users, the script will generate 20 **synthetic profiles**
> by slicing existing users’ reading histories. This keeps the comparison fair across models.

### Quick labeling mode (use only real users)

If you want to label only your actual users (no synthetic profiles), run:

```bash
cd minimal/news-backend
node scripts/eval/runNewsletterModelComparison.js --users 4 --k 5 --real-users
```

### Speed tip (index fewer days)

Newsletter recommendations only use recent articles (last ~24h). For faster evaluation indexing you can limit how many days of articles are indexed per model:

```bash
cd minimal/news-backend
QDRANT_INDEX_DAYS=2 node scripts/eval/runNewsletterModelComparison.js --users 20 --k 5 --index
```

---

## 3) Manual labeling

Open the generated JSON file and set:

```json
{
  "relevant": true
}
```

or

```json
{
  "relevant": false
}
```

for each of the 5 recommendations, for each user, for each model.

> Tip: label based on “Would this user likely find this useful/interesting given their reading history?”

### Optional (easier): Interactive CLI labeling

Instead of editing JSON manually, use the CLI tool:

```bash
cd minimal/news-backend
node scripts/eval/labelNewsletterEval.js /absolute/path/to/eval/newsletter_eval_....json
```

---

## 4) Compute Precision@5

```bash
cd minimal/news-backend
node scripts/eval/scoreNewsletterEval.js /absolute/path/to/eval/newsletter_eval_....json
```

You’ll get output like:

- Model A: 0.60
- Model B: 0.55
- Model C: 0.70

---

## 5) Notes on fairness / best practice

For a fair comparison:
- Reindex Qdrant per model (the script does this when `--index` is used)
- Use the **same user sample** across all models (the script enforces this)
- Keep the same freshness window (newsletter uses last 24h)
- Don’t mix vectors from different models in the same Qdrant collection

E5-specific:
- E5 models work best with prefixes:
  - `query: ...`
  - `passage: ...`
The backend automatically applies these when the embedding model name contains `e5`.


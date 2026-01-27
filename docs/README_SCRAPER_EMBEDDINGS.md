## Scraper → Embeddings → Search + Personalized Recommendations (1-page explanation)

This note explains how the **news scraper/ingestion** produces clean text, how that text is converted into **embeddings** (vectors), and why this improves both:
- **Search queries** (semantic retrieval)
- **Personalized newsletters** (recommendations from reading history)

---

## 1) Scraper / ingestion: what it collects and why it matters

### A) Source
- Articles are ingested from multiple **RSS feeds** (Nepali + English).
- **Code**: `minimal/news-backend/newsFetcher.js`

### B) Extraction + cleanup
For each RSS item, the scraper extracts and cleans:
- **title**
- **description** (short text preview)
- **content** (longer article body, cleaned from HTML; truncated for storage)
- **metadata**: `source`, `url`, `publishedAt`, `category`, `topics`

Why cleanup matters:
- Embeddings are only as good as the input text. Removing HTML/junk improves semantic similarity.
- Longer `content` gives better context than title-only embeddings, especially for Nepali where titles can be short.

### C) Classification during ingestion
- **Category** (technology/business/sports/…) is assigned via keyword scoring in `newsFetcher.js`.
- **Topics** (finance/politics/art/culture/international/sports) are tagged via `services/topicService.js` (keyword + optional semantic tagging).

These tags become **filters** for search and also provide **signals** for personalization.

---

## 2) How ingestion text becomes embeddings (vectors)

### A) “Text for embedding”
When indexing to Qdrant, the system builds one text block per article:
- title (repeated)
- description (repeated)
- content

This is done to “weight” the title/description higher while still keeping full context.
- **Code**: `minimal/news-backend/services/qdrantService.js` → `buildArticleText()`

### B) Embedding model
The embedding model converts text → fixed-size vector:
- Default (current): `Xenova/distiluse-base-multilingual-cased-v2` (768d)
- **Code**: `minimal/news-backend/services/embeddingService.js`

Multilingual embeddings are critical for:
- English query → Nepali document matching
- Nepali query → English document matching

### C) Indexing into Qdrant
Indexing stores each article as a Qdrant “point”:
- **vector**: the embedding of article text
- **payload**: metadata for filtering (topics, category, source, publishedAt, mongoId, url)

Indexing script:
- `minimal/news-backend/scripts/indexQdrant.js`

---

## 3) How embeddings improve Search queries

### A) Semantic search (meaning-based)
Instead of searching by exact words, Qdrant finds articles whose vectors are closest to the query vector.

This helps when:
- You use synonyms (“loss” vs “defeat” vs “हार”)
- You mix languages (“nepal loss match” should surface Nepali sports headlines)
- Titles don’t contain the exact query keywords

### B) Filters + reranking
The backend combines:
- Qdrant semantic similarity (primary signal)
- payload filters (topics/category/source/date)
- light reranking (topic intent + lexical overlap)

**Code**:
- `minimal/news-backend/routes/searchRoutes.js`

### C) Reranking flow (Search)
After Qdrant returns semantic candidates, the backend reranks results to improve precision (and English→Nepali recall) without replacing the semantic score:

1. **Retrieve more candidates than needed**
   - Fetch a larger pool (e.g., up to ~50) from Qdrant, even if UI shows only 12.
   - This increases recall before reranking.

2. **(Cross‑lingual boost) Expanded query for English → Nepali**
   - If the query is English (Latin script), build an **expanded query** by adding a small set of Nepali keywords (Devanagari hints), e.g.:
     - `nepal` → `नेपाल`
     - sports intent → `हार`, `जित`, `खेल`, `विश्वकप`, `टी20`
     - finance intent → `सेयर`, `नेप्से`, `ब्याजदर`, `मुद्रास्फीति`
   - Run a second Qdrant search with the expanded query and **merge** results (keep best semantic score per document).

3. **Compute a combined score**
   - Keep **Qdrant semantic similarity** as the dominant signal, then add small boosts:
     - **topic boost**: if document topics match query-intent topics
     - **lexical boost**: keyword overlap between query (or expanded query) and title/description
     - **cross‑lingual bonus**: if a document appears in both base + expanded results

4. **Sort by combined score and return top‑N**

Practical scoring (conceptually):
\[
\text{FinalScore} = \text{Semantic} + 0.03\cdot\mathbb{1}[\text{baseHit}\wedge\text{expandedHit}] + 0.15\cdot\text{TopicMatches} + 0.05\cdot\text{LexicalOverlap}
\]

---

## 4) How embeddings improve Personalized newsletters

### A) Reading history → “interest query”
The system builds a “user interest query” from the user’s recent reading history:
- recent titles/descriptions are concatenated (with recency weighting)

### B) Interest query → Qdrant retrieval
That interest query is embedded and used to retrieve the closest recent articles from Qdrant.

This improves newsletters because:
- It learns topics even if the user never explicitly selects categories
- It generalizes beyond keywords (meaning-based similarity)
- It works across Nepali + English content

**Code**:
- `minimal/news-backend/services/preferenceService.js` → `getSemanticRecommendations()` / `getNewsletterRecommendations()`

### C) Reranking flow (Newsletter)
Newsletter recommendations use semantic retrieval first, then rerank using the user profile:

1. **Candidate retrieval**
   - Build an interest query from recent reading history and retrieve candidates from Qdrant.
   - Apply freshness windows and exclude already-read articles.

2. **Preference-based boosts**
   - Add small bonuses for:
     - preferred sources
     - top categories
     - matching topics
     - recency (very recent articles get a small boost)

3. **Diversity constraint**
   - After sorting by score, cap results per source (e.g., max 2 from the same source) to avoid “all from one publisher”.

---

## 5) One-line flow summary

```
RSS Scraper → Clean text (title/desc/content) → Embeddings → Qdrant index
              ↘ topics/category tags (filters) ↙
Search: query embedding → Qdrant → rerank → results
Newsletter: history→interest embedding → Qdrant → rerank/diversify → email
```

---

## Conclusion

The scraper is the foundation of the system: it turns noisy RSS items into structured, clean article text and metadata. Embeddings then convert that text into a multilingual semantic representation stored in Qdrant. Together, this enables meaning-based retrieval with filters for **search** and history-driven semantic retrieval for **personalized newsletters**, improving relevance especially in **English ↔ Nepali** scenarios where keyword matching alone is weak.

---

## Future Enhancements

- **Better scraping (richer content)**: add per-site extraction rules and/or a readability-based extractor to capture fuller article bodies and reduce boilerplate → higher-quality embeddings.
- **Async indexing pipeline**: index into Qdrant immediately after Mongo insert via a background worker/queue (BullMQ/RabbitMQ) to avoid “index lag”.
- **Hybrid retrieval improvements**:
  - add BM25/keyword search alongside embeddings and fuse results (RRF)
  - stronger reranking (cross-encoder reranker / LLM reranker) for top-50 candidates
- **Cross-lingual query handling**: automatic query expansion/translation + bilingual synonyms for important entities (Nepal, Kathmandu, NEPSE, parties, teams).
- **Topic classification upgrades**: train a supervised topic classifier (or use zero-shot) and backfill tags; keep keyword rules as a safety fallback.
- **Evaluation at scale**: expand labeled query sets (more topics, mixed-language queries), compute Precision@k + NDCG, and track model regressions over time.

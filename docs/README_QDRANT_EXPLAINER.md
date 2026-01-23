## Qdrant — How it Works (Presentation-Friendly)

This doc explains **what Qdrant is**, **why it’s used**, and **how a query is executed** (in simple, presentation-ready terms).

---

## 1) What problem does Qdrant solve?

Traditional search (SQL / keyword search) answers:
- “Find articles that contain the exact word **inflation**”

But users often mean:
- “Find articles **about rising prices / interest rates** even if the article doesn’t literally say ‘inflation’”

Qdrant is a **vector database** that powers:
- **Semantic search** (search by meaning)
- **Similarity / recommendation** (find items similar to another item)
- **Filtered retrieval** (semantic search + filters like category/date/source)

---

## 2) The key idea: represent text as vectors (embeddings)

### A) What is an embedding?
An **embedding** is a numeric vector (example: 384 numbers) that represents the **meaning** of text.

Example:
- “interest rates are rising” → vector A
- “banks increase borrowing cost” → vector B

Even if the exact words differ, vectors A and B are **close** in vector space.

### B) How do we get embeddings?
Usually embeddings come from an ML model (Sentence Transformers / OpenAI / Gemini embeddings).

In this repo we currently use a **local hashing vectorizer** (offline) in:
- `minimal/news-backend/services/qdrantService.js` (`textToVector()`)

> For best semantic quality in production, replace hashing vectors with real embeddings.

---

## 3) Core Qdrant concepts (what’s stored)

### A) Collection
Like a “table” in SQL.
- Example: `khabar_articles`

### B) Point
Like a “row”.
Each point contains:
- **id** (unique identifier)
- **vector** (embedding)
- **payload** (metadata used for filters)

### C) Payload (filters)
Payload is normal structured data (JSON). Example payload fields:
- `topics: ["finance", "politics"]`
- `category: "business"`
- `source: "MarketWatch"`
- `publishedAt: 1737465600` (timestamp)
- `mongoId: "..."` (link back to MongoDB record)

Why payload matters:
- It allows **semantic search + filters**:
  - “budget” (semantic) AND `topics=finance` AND `publishedAt last 7 days`

---

## 4) How search works internally (fast similarity search)

### A) Similarity = distance between vectors
Qdrant compares query vector vs stored vectors using a metric, commonly:
- **Cosine similarity** (used in this repo)

### B) Why it’s fast: Approximate Nearest Neighbor (ANN)
Brute force would compare query vector to every stored vector (slow at scale).

Qdrant uses ANN indexing (commonly **HNSW graph**) to find “close vectors” quickly:
- It searches an index structure instead of scanning everything.
- Results are **approximate**, but extremely fast and accurate in practice.

Think of it like:
- Google Maps route planning (fast, uses heuristics) vs checking every possible path.

---

## 5) End-to-end flow (our project)

### A) Indexing phase (write path)
1. We fetch and clean articles (RSS + content extraction).
2. We compute:
   - `category` (classification)
   - `topics` (tagging)
3. We store the full article in **MongoDB** (system of record).
4. We also store a point in **Qdrant**:
   - `vector = embedding(title+description+content)`
   - `payload = { topics, category, source, publishedAt, mongoId, url }`

Script used for indexing/backfill:
- `minimal/news-backend/scripts/indexQdrant.js`
- `npm run index-qdrant`

### B) Query phase (read path)
1. User searches in the frontend (query + optional filters).
2. Backend calls Qdrant:
   - endpoint: `POST /collections/<collection>/points/search`
3. Qdrant returns:
   - ranked point IDs + similarity scores + payload
4. Backend fetches the full articles from MongoDB using `mongoId`
5. Backend returns results to the frontend in ranked order

Backend endpoint:
- `GET /api/search`
- implemented in `minimal/news-backend/routes/searchRoutes.js`

---

## 6) Why we still keep MongoDB (two-database pattern)

We use both because they are optimized for different jobs:
- **MongoDB**: stores the complete article and supports standard CRUD, pagination, and filter-only feeds.
- **Qdrant**: optimized for “find similar by meaning” and fast filtered vector retrieval.

Qdrant is usually **not** the system of record; it’s a **search index**.

---

## 7) Typical slide-ready summary (1 minute)

- Qdrant is a **vector database**.
- We convert each article into an **embedding vector** + attach metadata as **payload**.
- Search queries are also embedded → Qdrant finds the closest vectors using **ANN (HNSW)**.
- Payload filters let us do: “semantic search + category/topic/date/source filtering”.
- We store full articles in MongoDB; Qdrant stores the search index and returns ranked IDs.

---

## 8) Optional: If you want “best accuracy”

To improve semantic relevance:
- Use a real embedding model instead of hashing (swap `textToVector()`).
- Store richer text (full scraped content) before embedding.
- Add a reranker step (lexical overlap or ML/LLM reranking) for higher precision.


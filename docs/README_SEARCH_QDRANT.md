## Khabar AI — Search (Qdrant) + Classification (Brief)

This note explains:
- **How news is classified** (category + topic tags)
- **How advanced search works** using **Qdrant** (vector DB) + filters

---

## 1) News ingestion & classification flow

### A) RSS fetch + content extraction
- **File**: `minimal/news-backend/newsFetcher.js`
- Fetches RSS feeds, extracts:
  - `title`, `description`, `content` (up to ~5000 chars), `source`, `publishedAt`, `url`, `image`

### B) Category classification (Technology/Business/Sports/Entertainment/Health/Science)
- **File**: `minimal/news-backend/newsFetcher.js`
- **Function**: `classifyArticle(title, description, contentSnippet)`
- Uses a keyword-scoring approach (`CATEGORY_KEYWORDS`) to assign one of:
  - `technology | business | sports | entertainment | health | science`
- Saved in MongoDB as `Article.category`.

### C) Topic tagging (Finance/Politics/Art/Culture/International/Sports)
- **File**: `minimal/news-backend/services/topicService.js`
- Tags each article with broad **topics** for filtering:
  - `finance, politics, art, culture, international, sports`
- Saved in MongoDB as `Article.topics` (array of strings).

### D) MongoDB storage
- **Schema**: `minimal/news-backend/models/Article.js`
- New fields used for filtering/search:
  - `category` (single)
  - `topics` (array)
  - `source`, `publishedAt`, `url`

---

## 2) Qdrant vector search (semantic search) flow

### A) What is stored in Qdrant?
- **File**: `minimal/news-backend/services/qdrantService.js`
- **Collection**: `QDRANT_COLLECTION` (default: `khabar_articles`)
- Each article becomes a Qdrant **point**:
  - **Vector**: derived from `title + description + content`
  - **Payload** (for filters): `topics`, `category`, `source`, `publishedAt`, `mongoId`, `url`

> Current implementation uses a lightweight **local hashing vectorizer** (works offline).
> To get higher semantic quality, replace `textToVector()` with a real embedding model/service.

### B) Indexing into Qdrant
- **Script**: `minimal/news-backend/scripts/indexQdrant.js`
- **Run**:

```bash
cd minimal/news-backend
npm run index-qdrant
```

### C) Search API
- **Route**: `minimal/news-backend/routes/searchRoutes.js`
- **Endpoint**: `GET /api/search`

Behavior:
- If `q` is present and Qdrant is reachable → **Qdrant semantic search**
- Else → **MongoDB fallback** (filters + optional title/description regex match)

Filters supported:
- `topics=finance,politics`
- `category=technology`
- `source=NASA`
- `from=<date>` / `to=<date>`

Examples:

```bash
# Semantic search
curl "http://localhost:5001/api/search?q=interest%20rates&limit=12&page=1"

# Semantic search + topic filter
curl "http://localhost:5001/api/search?q=budget&topics=finance&limit=12&page=1"

# Filter-only (latest first)
curl "http://localhost:5001/api/search?topics=politics&limit=12&page=1"
```

---

## 3) Qdrant (Docker) quick start

```bash
docker run -p 6333:6333 -p 6334:6334 --name qdrant -d qdrant/qdrant
```

Environment variables (backend `.env`):
- `QDRANT_URL` (default `http://localhost:6333`)
- `QDRANT_COLLECTION` (default `khabar_articles`)
- `QDRANT_VECTOR_SIZE` (default `384`)

---

## 4) Notes on “accuracy”

Accuracy depends on two things:
- **Topic tags**: keyword/score rules (`topicService.js`)
- **Semantic matching**: vector quality (`qdrantService.js`)

To improve semantic search accuracy:
- Replace hashing vectors with real embeddings (Sentence-Transformers / embeddings API)
- Store higher-quality text (full scraped article content) before indexing
- Add a reranking step (lexical overlap or LLM rerank) if needed


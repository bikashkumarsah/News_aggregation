## Khabar AI — Theoretical Architecture (High-Level)

This document explains the **conceptual system architecture**: components, responsibilities, and the main data flows (ingestion, classification, search, and newsletters).

---

## 1) System components (logical)

### A) Client / Web App (React)
- **Role**: UI, user interactions, displays news feed, advanced search, article reading, bookmarks, history, settings.
- **Talks to**: Backend REST API over HTTP.
- **Key files**:
  - `minimal/news-aggregator/src/App.js`
  - `minimal/news-aggregator/src/context/AuthContext.js`
  - `minimal/news-aggregator/src/config.js` (dynamic host/IP config)

### B) Backend API (Node.js + Express)
- **Role**:
  - News APIs (feed/pagination, single article)
  - Auth (JWT)
  - User features (bookmarks, history, preferences)
  - Advanced search endpoint (`/api/search`)
  - Newsletter scheduler and email sending
  - AI summarization + TTS endpoints
- **Key files**:
  - `minimal/news-backend/server.js`
  - `minimal/news-backend/routes/*`
  - `minimal/news-backend/services/*`

### C) MongoDB (System of Record)
- **Role**: canonical storage for articles and users (auth, bookmarks, read history, preferences, newsletter timestamps).
- **Schemas**:
  - `minimal/news-backend/models/Article.js`
  - `minimal/news-backend/models/User.js`

### D) Qdrant (Vector Database / Semantic Index)
- **Role**: fast **semantic retrieval** (“search by meaning”) + **payload filters** (topics/category/source/date).
- **Stored data**:
  - Vector embedding for each article
  - Payload: `mongoId`, `topics`, `category`, `source`, `publishedAt`, `url`, etc.
- **Key files**:
  - `minimal/news-backend/services/qdrantService.js`
  - `minimal/news-backend/routes/searchRoutes.js`
  - `minimal/news-backend/scripts/indexQdrant.js`

### E) External integrations
- **RSS providers**: source of raw news data (`newsFetcher.js`)
- **AI Summarization**: Gemini/Gemma endpoint (used in `/api/news/:id/summarize`)
- **TTS**: local Python + ONNX models (`tts_service.py`)
- **Email**: SMTP via Nodemailer (`emailService.js`)

---

## 2) Architecture diagram (conceptual)

```
            ┌──────────────────────────────────┐
            │          React Web App           │
            │  - feed, read, search, filters   │
            │  - login, bookmarks, history     │
            └───────────────┬──────────────────┘
                            │ HTTP (REST)
                            v
            ┌──────────────────────────────────┐
            │       Node/Express Backend        │
            │  - /api/news, /api/user, /api/auth│
            │  - /api/search (Qdrant + filters) │
            │  - newsletter scheduler (cron)    │
            └───────┬───────────────┬──────────┘
                    │               │
                    │               │ semantic search
                    v               v
        ┌──────────────────┐   ┌──────────────────┐
        │     MongoDB       │   │      Qdrant       │
        │  Articles, Users  │   │  vectors+payload  │
        └──────────────────┘   └──────────────────┘
                    │
                    │ scheduled jobs / workers
                    v
        ┌──────────────────────────────────┐
        │ Ingestion + Classification        │
        │  - RSS fetch + content extraction │
        │  - category classifier            │
        │  - topic tagger                   │
        └──────────────────────────────────┘
```

---

## 3) Main data flows (end-to-end)

### A) News ingestion → classification → storage
1. **Scheduler / manual script** triggers fetching:
   - `minimal/news-backend/scheduleNews.js` (every 30 min)
   - `minimal/news-backend/updateNews.js` (one-shot)
2. Fetch RSS items and extract content:
   - `minimal/news-backend/newsFetcher.js`
3. Assign **category** (`technology/business/...`):
   - `classifyArticle(...)`
4. Assign **topics** (`finance/politics/...`):
   - `services/topicService.js`
5. Store in **MongoDB**:
   - `Article` collection
6. Index into **Qdrant** (conceptually part of ingestion; currently done via script):
   - `npm run index-qdrant` (backfill/index)

> Production ideal: index to Qdrant immediately after saving an article (async worker/queue).

---

### B) Advanced search (semantic + filters)
1. User types in the frontend search bar (and selects filters).
2. Frontend calls:
   - `GET /api/search?q=...&topics=...&category=...&source=...&from=...`
3. Backend search router:
   - `routes/searchRoutes.js`
4. Backend decides engine:
   - If Qdrant reachable + `q` present → Qdrant semantic search
   - Otherwise → MongoDB fallback (filters + regex for title/description)
5. Qdrant returns ranked IDs; backend fetches full docs from MongoDB and returns in ranked order.

Why both MongoDB + Qdrant?
- **MongoDB** is the canonical store and great for filter-only + pagination.
- **Qdrant** is great for “meaningful search” and fast filtered retrieval.

---

### C) Reading history → preferences → personalized newsletter
1. User opens an article:
   - Frontend calls `POST /api/user/history/:articleId`
2. Backend stores history:
   - `User.readHistory[]` with timestamps
3. Preference learning builds a profile from last 30 days:
   - `services/preferenceService.js` → `updateUserPreferences(userId)`
   - Produces: `categoryScores`, `preferredSources`, `topKeywords`
4. Newsletter scheduler runs hourly and sends at user’s digest hour (default 07:00):
   - `services/newsletterScheduler.js`
5. It selects recommended articles:
   - `getRecommendations(userId, limit)`
6. Email is sent using templates:
   - `services/emailService.js`

---

## 4) Deployment topology (local development)

Typical local setup:
- **Frontend**: `http://localhost:3000` (or LAN IP for same-network devices)
- **Backend**: `http://localhost:5001`
- **MongoDB**: `mongodb://localhost:27017/newsDB`
- **Qdrant**: Docker container on `http://localhost:6333`

---

## 5) Production-grade theoretical improvements (optional)

If you scale beyond local/dev:
- **Async ingestion + indexing**: introduce a queue/worker (BullMQ/Redis, RabbitMQ, etc.)
- **Real embeddings**: replace hashing vectors with a true embedding model
- **Reranking**: use lexical/ML/LLM reranker for higher precision
- **Caching**: cache common feeds and popular queries
- **Observability**: structured logs, metrics, tracing (OpenTelemetry)
- **Security**: rate limiting, input validation, secret management, TLS, rotating JWT keys


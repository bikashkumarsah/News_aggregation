# 📰 Khabar AI

A modern, AI-powered news aggregation platform with personalized recommendations, semantic search, text-to-speech, AI summaries, automated email newsletters, and **Market Gyan**, a NEPSE market-intelligence workspace.

![Khabar AI](https://img.shields.io/badge/Khabar-AI-6366f1?style=for-the-badge&logo=newspaper&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![MongoDB](https://img.shields.io/badge/MongoDB-8-47A248?style=flat-square&logo=mongodb&logoColor=white)

## ✨ Features

### 🤖 AI-Powered

- **AI Summaries** - Gemini API summaries in the article's language, with an automatic fallback to the local mBART model (Nepali-first)
- **AI Translation** - One-click English → Nepali translation (local mBART, results cached)
- **Personalized Recommendations** - Semantic (Qdrant) recommendations from your reading history, with a keyword/category fallback
- **Smart Classification** - Categories and topics from English and Nepali keywords plus multilingual embeddings
- **Semantic Search** - Qdrant-backed search with multilingual embeddings, Nepali query expansion, and topic/source/date filters
- **Market Gyan** - NEPSE dashboard, evidence search, and citation-grounded questions and reports (see [docs/market-gyan](docs/market-gyan/README.md))

### 📱 User Experience

- **Dark Mode** - Dark theme that syncs across devices
- **Text-to-Speech** - Listen to summaries and translations (English & Nepali Piper voices)
- **Responsive Design** - Sidebar on desktop, swipeable section bar and account menu on phones and tablets
- **Network Access** - Use it from any device on your local network

### 👤 User Features

- **Authentication** - JWT-based login and registration
- **Bookmarks** - Save articles for later; bookmarked articles are never removed by cleanup
- **Reading History** - The last 100 articles you read
- **Quality Ratings** - Rate summaries + translations (MOS) to evaluate the models

### 📧 Email Newsletters

- **Daily Digest** - Personalized newsletter at your digest time (default 7 AM Nepal time, regardless of the server's time zone)
- **One-click unsubscribe** - Every digest carries a working unsubscribe link and `List-Unsubscribe` headers
- **Beautiful Templates** - Dark-mode compatible, mobile responsive, with all feed content safely escaped

### 📰 News Aggregation

- **27 RSS Sources** - Verified feeds from the USA, Nepal, and the WHO, fetched concurrently (malformed feeds are repaired, not dropped)
- **Real-time Updates** - Fresh news every 30 minutes, indexed into Qdrant as it arrives
- **Full Content** - Up to 5000 characters per article; full pages are fetched on demand for summaries
- **Auto Cleanup** - Removes articles older than 7 days (keeps bookmarks and the Market Gyan corpus)

## 🗞️ News Sources

### USA Sources

| Category          | Sources                                           |
| ----------------- | ------------------------------------------------- |
| **Technology**    | TechCrunch, The Verge, Wired                      |
| **Business**      | CNBC, MarketWatch                                 |
| **Sports**        | ESPN, Yahoo Sports, CBS Sports                    |
| **Entertainment** | Variety, Hollywood Reporter, Deadline            |
| **Health**        | ScienceDaily Health, World Health Organization    |
| **Science**       | Science Daily, NASA, Science News                 |

### Nepal Sources

| Source              | Languages        |
| ------------------- | ---------------- |
| Online Khabar (front page, business, sports, entertainment, health) | English & Nepali |
| The Kathmandu Post  | English          |
| The Himalayan Times | English          |
| Ratopati, Setopati  | Nepali           |

Front-page feeds are classified by content; stories that match no specific category are filed as **general** and appear under *All News* and *Local News*.

## 🛠️ Tech Stack

### Frontend

| Technology   | Version | Purpose          |
| ------------ | ------- | ---------------- |
| React        | 19.x    | UI Framework     |
| Tailwind CSS | 3.x     | Styling          |
| Lucide React | Latest  | Icons            |
| Context API  | -       | State Management |

### Backend

| Technology | Version | Purpose                          |
| ---------- | ------- | -------------------------------- |
| Node.js    | 18+     | Runtime                          |
| Express.js | 5.x     | API Server                       |
| MongoDB    | 8.x     | Database                         |
| Qdrant     | 1.16    | Vector search                    |
| Nodemailer | Latest  | Email Service                    |
| Node-Cron  | Latest  | Scheduled Jobs                   |
| Python 3   | 3.10+   | mBART + TTS workers, Market Gyan |

### AI Services

| Service                                            | Purpose                                         |
| -------------------------------------------------- | ----------------------------------------------- |
| Gemini API (`gemini-3.5-flash-lite` by default)    | Article summaries                               |
| mBART (sagunrai/mbart-large-50-nepali-finetuned-1) | Summary fallback + English → Nepali translation |
| Transformers.js (distiluse-base-multilingual-cased-v2) | 768-d multilingual embeddings for Qdrant    |
| Piper TTS                                          | Text-to-Speech (English + Nepali models)        |

The mBART and Piper models run in long-lived Python worker processes: each model loads once, requests are queued with timeouts, and the process is released after 10 minutes of inactivity.

## 📁 Project Structure

```
khabar/
├── docker-compose.yml             # MongoDB + Qdrant for local development
├── package.json                   # One-command scripts for the whole repo
├── docs/                          # Architecture, search, newsletter, Market Gyan docs
├── minimal/
│   ├── news-aggregator/           # React frontend
│   │   └── src/
│   │       ├── App.js             # Main application
│   │       ├── config.js          # API URL resolution (dev server, same origin, or env)
│   │       ├── context/AuthContext.js
│   │       └── components/        # Auth modal, Market Gyan dashboard + review panel
│   └── news-backend/              # Node.js backend
│       ├── app.js                 # Express app (routes, middleware) — importable for tests
│       ├── server.js              # Process entry: MongoDB, listen, schedulers, shutdown
│       ├── config/                # Auth secret and CORS policy
│       ├── middleware/            # Auth, admin token, rate limits, security headers, errors
│       ├── models/                # Article, User, Feedback (+ ONNX voice models)
│       ├── routes/                # news, auth, user, search, feedback, email
│       ├── services/              # summaries, mBART/TTS workers, Qdrant, ingestion, email
│       ├── features/marketGyan/   # Market Gyan pipeline, review tools, retrieval, reports
│       ├── scripts/               # Qdrant indexing, topic backfill, evaluations
│       ├── tests/                 # Unit tests + MongoDB integration tests
│       ├── newsFetcher.js         # RSS fetching and classification
│       ├── updateNews.js          # One-shot news update
│       ├── scheduleNews.js        # 30-minute update loop
│       ├── cleanupOldNews.js      # Retention cleanup
│       ├── addSampleData.js       # Demo articles (idempotent)
│       ├── mbart_service.py       # mBART worker (summarize / translate)
│       └── tts_service.py         # Piper TTS worker
└── ml/marketGyan/                 # Market Gyan datasets, training, FastAPI agent service
```

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18.18 or newer
- [Docker](https://www.docker.com/) (for MongoDB + Qdrant), or local installs of both
- [Python 3.10+](https://www.python.org/) for translation, the summary fallback, and TTS

### 1. Start the databases

```bash
docker compose up -d
```

This runs MongoDB on `localhost:27017` and Qdrant on `localhost:6333`. Already running MongoDB via Homebrew (`brew services start mongodb-community`)? Then start only Qdrant: `docker compose up -d qdrant`.

### 2. Install dependencies

```bash
npm run setup
python3 -m pip install torch transformers piper-tts
```

### 3. Configure the backend

```bash
cp minimal/news-backend/.env.example minimal/news-backend/.env
```

Set at least `JWT_SECRET` (and `GEMINI_API_KEY` for API summaries). See [Configuration](#️-configuration).

### 4. Load news

```bash
npm run update-news      # fetch all RSS feeds once (and index into Qdrant)
npm run seed             # optional: add 8 demo articles
```

### 5. Run in development

```bash
npm run dev:api          # API on http://localhost:5001 (auto-reload)
npm run dev:web          # React app on http://localhost:3000
```

Open `http://localhost:3000`, or `http://<your-LAN-IP>:3000` from a phone on the same network.

### Production: one process, one port

```bash
npm run build            # build the React app
npm start                # API + React build on http://localhost:5001
```

`npm start` runs `node server.js --serve-frontend`. For a public deployment, set `NODE_ENV=production`, a strong `JWT_SECRET`, `TRUST_PROXY` when behind a reverse proxy, and `PUBLIC_API_URL`/`FRONTEND_URL` to the public URL. Keep the news scheduler running alongside with `npm --prefix minimal/news-backend run schedule-news`.

## ⚙️ Configuration

All settings live in `minimal/news-backend/.env`; [.env.example](minimal/news-backend/.env.example) documents every variable. The most important ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | `mongodb://localhost:27017/newsDB` | Database (used by the API and every script) |
| `JWT_SECRET` | random per process in development | Token signing secret — **required** when `NODE_ENV=production` |
| `ADMIN_API_TOKEN` | empty (disabled) | Enables `POST/DELETE /api/news` via the `x-admin-token` header |
| `CORS_ORIGINS` | any origin in dev, same-origin in prod | Comma-separated allowed browser origins |
| `TRUST_PROXY` | unset | Express trust-proxy setting behind nginx etc. |
| `SERVE_FRONTEND` | `false` | Serve the React build from the API (`npm start` turns it on) |
| `QDRANT_URL` | `http://localhost:6333` | Vector database |
| `EMBEDDING_PROVIDER` | `transformers` | `transformers` (multilingual model) or `hash` (offline); each uses its own collection |
| `GEMINI_API_KEY` | empty | Enables API summaries (otherwise mBART is used) |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Summary model |
| `MBART_DEVICE` | `auto` | `cpu`, `cuda`, or `mps` for the mBART worker |
| `NEWS_RETENTION_DAYS` | `7` | Article retention (bookmarks and Market Gyan articles are kept) |
| `NEWSLETTER_TIMEZONE` | `Asia/Kathmandu` | Time zone for digest times |
| `PUBLIC_API_URL` | `FRONTEND_URL` host on `PORT` | Base URL for unsubscribe links in emails |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | — | Outgoing email (Gmail App Password works) |

The frontend finds the API automatically: on the React dev server (port 3000) it calls port 5001 on the same host; otherwise it uses the page's own origin. Override with `REACT_APP_API_BASE_URL` at build time.

### Gmail App Password Setup

1. Go to https://myaccount.google.com/apppasswords
2. Sign in and enable 2-Step Verification if needed
3. Select "Mail" for app, "Mac/Other" for device
4. Copy the 16-character password to `SMTP_PASS`

### Network Access (Cross-Device)

```bash
cd minimal/news-backend
node updateIP.js         # writes FRONTEND_URL with your LAN IP
```

Then open `http://YOUR_IP:3000` on any device. The API prints its LAN addresses on startup.

## 🔎 Semantic Search (Qdrant)

Qdrant powers semantic search ("search by meaning") and fast filtering by `topics`, `category`, `source`, and `publishedAt`.

- New articles are indexed automatically by `update-news` / `schedule-news` when Qdrant is reachable, and deleted articles are removed from the index.
- `npm run index-qdrant` (re)indexes everything and prunes points whose article no longer exists.
- If Qdrant or the embedding model is unavailable, search falls back to MongoDB keyword search instead of failing.
- Results are re-ranked as one fixed pool, so paging through results never repeats or skips articles.

Embeddings come from `Xenova/distiluse-base-multilingual-cased-v2` (768 dimensions, English + Nepali), downloaded on first use. Use `EMBEDDING_PROVIDER=hash` for a fully offline setup (lower quality); hash vectors and model vectors are kept in separate collections.

Backfill topics for older articles with `npm --prefix minimal/news-backend run backfill-topics` (add `--force` to recompute all).

```bash
# Semantic search (vector)
curl "http://localhost:5001/api/search?q=interest%20rates&limit=12&page=1"

# Semantic search + topic filter
curl "http://localhost:5001/api/search?q=budget&topics=finance&limit=12&page=1"

# Filter-only feed by topic and source (latest first)
curl "http://localhost:5001/api/search?topics=politics&source=kathmandu&limit=12&page=1"
```

## 📧 Email Newsletter System

Newsletters are sent hourly to users whose digest hour (`emailPreferences.digestTime`, default `07:00`) matches the current hour in `NEWSLETTER_TIMEZONE`, at most once per day in that time zone. Each email includes a one-click unsubscribe link (`/api/email/unsubscribe`), which asks for confirmation so link scanners cannot unsubscribe anyone by accident.

| Template     | Trigger     | Description                     |
| ------------ | ----------- | ------------------------------- |
| Welcome      | User signup | Feature introduction            |
| Daily Digest | Digest time | Standard news digest            |
| Personalized | Digest time | AI-curated based on preferences |
| Weekly       | Weekly      | Stats + top stories             |

### Testing Emails

```bash
cd minimal/news-backend
node testEmail.js                       # send a test email to SMTP_USER
node testEmail.js user@example.com      # send to a specific address
node testEmail.js --all                 # send to all eligible users
node testEmail.js --user user@example.com
node testEmail.js --list                # list users
node testEmail.js --enable user@example.com
```

## 📡 API Endpoints

### Public Endpoints

| Method | Endpoint                        | Description                              |
| ------ | ------------------------------- | ---------------------------------------- |
| GET    | `/api/health`                   | MongoDB/Qdrant status                    |
| GET    | `/api/news`                     | Articles (`category`, `page`, `limit≤50`) |
| GET    | `/api/news/:id`                 | Single article                           |
| POST   | `/api/news/:id/summarize`       | AI summary (cached on the article)       |
| POST   | `/api/news/:id/tts`             | Speech for the article summary           |
| POST   | `/api/tts`                      | Speech for arbitrary text (cached)       |
| POST   | `/api/translate`                | English → Nepali translation (cached)    |
| GET    | `/api/search`                   | Semantic search + filters                |
| GET    | `/api/categories`               | Category counts                          |
| GET/POST | `/api/email/unsubscribe?token=` | Unsubscribe confirmation / action      |

Model-backed endpoints are rate limited per client (summaries 20/min, translation 10/min, speech 20/min, search 90/min).

### Admin Endpoints (`x-admin-token: $ADMIN_API_TOKEN`)

| Method | Endpoint          | Description           |
| ------ | ----------------- | --------------------- |
| POST   | `/api/news`       | Add an article        |
| POST   | `/api/news/bulk`  | Add up to 500 articles |
| DELETE | `/api/news/:id`   | Delete an article     |

### Authentication Endpoints

| Method | Endpoint             | Description      |
| ------ | -------------------- | ---------------- |
| POST   | `/api/auth/register` | Create account   |
| POST   | `/api/auth/login`    | Login            |
| GET    | `/api/auth/me`       | Current user     |
| PUT    | `/api/auth/profile`  | Update profile   |
| PUT    | `/api/auth/password` | Change password  |

Login and registration are limited to 30 attempts per 15 minutes per client.

### User Endpoints (Protected)

| Method | Endpoint                         | Description                                  |
| ------ | -------------------------------- | -------------------------------------------- |
| GET    | `/api/user/bookmarks`            | Bookmarks (newest first)                     |
| POST   | `/api/user/bookmarks/:id`        | Add bookmark (idempotent)                    |
| DELETE | `/api/user/bookmarks/:id`        | Remove bookmark                              |
| GET    | `/api/user/history?limit=20`     | Reading history                              |
| POST   | `/api/user/history/:id`          | Record a read                                |
| DELETE | `/api/user/history`              | Clear history                                |
| GET    | `/api/user/recommendations`      | Recommendations                              |
| GET/PUT | `/api/user/email-preferences`   | `dailyDigest`, `weeklyDigest`, `digestTime` (HH:MM) |
| POST   | `/api/user/test/send-newsletter` | Send yourself the digest (3 per 10 minutes)  |

### Feedback Endpoints (Protected)

| Method | Endpoint                                       | Description                              |
| ------ | ---------------------------------------------- | ---------------------------------------- |
| POST   | `/api/feedback/summary`                        | Rate summary (fluency/adequacy/coverage) |
| POST   | `/api/feedback/translation`                    | Rate translation (1–5 MOS)               |
| GET    | `/api/feedback/mos?articleId=...&kind=summary` | Aggregate MOS stats                      |

Market Gyan endpoints live under `/api/market-gyan`; see [docs/market-gyan](docs/market-gyan/README.md).

## 📜 Available Scripts

### Repository root

```bash
npm run setup          # install backend + frontend dependencies
npm run infra:up       # docker compose up -d (MongoDB + Qdrant)
npm run dev:api        # API with auto-reload
npm run dev:web        # React dev server
npm run update-news    # fetch news once
npm run seed           # demo articles
npm run build          # production React build
npm start              # API + React build on one port
npm test               # backend, frontend, and Market Gyan ML tests
```

### Backend (`minimal/news-backend/`)

```bash
npm start              # start the API
npm run start:app      # API + React build (production)
npm run dev            # API with auto-reload (nodemon)
npm run update-news    # fetch news once
npm run schedule-news  # fetch news every 30 minutes
npm run cleanup-old    # delete expired articles
npm run index-qdrant   # (re)index Qdrant and prune orphaned points
npm run backfill-topics
npm run seed           # demo articles (node addSampleData.js --remove to delete them)
npm test               # unit tests + Market Gyan tests
```

### Frontend (`minimal/news-aggregator/`)

```bash
npm start              # development server
npm run build          # production build
npm run test:ci        # run tests once
```

## 🧪 Testing

```bash
npm test                                   # everything (from the repository root)
npm --prefix minimal/news-backend test     # backend unit + Market Gyan tests
MONGODB_TEST_URI=mongodb://127.0.0.1:27017/khabar_api_test \
  npm --prefix minimal/news-backend run test:integration   # HTTP tests against a real MongoDB
```

The integration suite drops the database named in `MONGODB_TEST_URI` before and after it runs — never point it at real data.

## 🔐 Security Notes

- Passwords are bcrypt-hashed; JWTs are HS256-signed with `JWT_SECRET` (the server refuses to start in production without one).
- Request bodies are validated as plain strings before reaching MongoDB, closing operator-injection paths such as `{"email": {"$ne": null}}`.
- Article create/delete endpoints require `ADMIN_API_TOKEN`; Market Gyan review tools only answer local, non-proxied, non-production requests.
- The article scraper only fetches public http(s) URLs and re-validates every redirect.
- Email content from feeds and users is HTML-escaped and links are restricted to http(s).

## 🔧 Troubleshooting

### Backend Issues

| Problem               | Solution                                                  |
| --------------------- | --------------------------------------------------------- |
| MongoDB won't connect | `docker compose up -d mongo` or start your local `mongod`; check `MONGODB_URI` |
| Port 5001 in use      | Change `PORT` in `.env`                                   |
| `JWT_SECRET must be set` | Set a long random `JWT_SECRET` (required with `NODE_ENV=production`) |
| Search says `mongo_fallback` | Start Qdrant and run `npm run index-qdrant`; the first run downloads the embedding model |
| Summaries are slow    | Set `GEMINI_API_KEY`; otherwise the local mBART model is used (first use downloads ~2.4 GB) |
| mBART/TTS errors      | Install Python deps: `torch`, `transformers`, `piper-tts`; set `PYTHON_BIN` if needed |
| `403 Admin access required` | Send `x-admin-token: $ADMIN_API_TOKEN` for article create/delete |

### Frontend Issues

| Problem                    | Solution                                                   |
| -------------------------- | ---------------------------------------------------------- |
| API connection failed      | Check the backend is running on port 5001 (or set `REACT_APP_API_BASE_URL`) |
| Network access not working | Run `node updateIP.js` and restart; allow port 5001 in your firewall |
| Blocked by CORS            | Add your site's origin to `CORS_ORIGINS`                   |

### Email Issues

| Problem                 | Solution                                       |
| ----------------------- | ---------------------------------------------- |
| Emails not sending      | Check SMTP settings in `.env`                  |
| "Less secure app" error | Use Gmail App Password, not regular password   |
| Newsletter not arriving | Check `emailPreferences.dailyDigest` is `true` and the digest hour (Nepal time) |

## 🗓️ Version History

### v3.2 (October 2026)

- ✅ **Security hardening** - admin-only article mutations, injection-safe auth, required production JWT secret, rate limits, CORS policy, safe email templates, SSRF-safe scraping
- ✅ **Persistent model workers** - mBART and Piper load once instead of on every request; TTS and translations are cached
- ✅ **Correct schedules** - digests follow Nepal time on any server; working unsubscribe links
- ✅ **Data safety** - cleanup keeps bookmarks and the Market Gyan corpus; ingestion indexes new articles and prunes deleted ones from Qdrant
- ✅ **Better search and ingestion** - stable pagination, MongoDB fallback, case-insensitive source filter, Nepali classification fixes, 27 verified feeds, no re-ingestion of expired items
- ✅ **Mobile navigation** and many UI fixes; single-process production mode; Docker Compose for MongoDB + Qdrant

### v3.1 (January 2026)

- ✅ **mBART Summaries** - Local Nepali-first summaries with English → Nepali pipeline
- ✅ **Article Translation** - One-click English → Nepali translation
- ✅ **Translation + Summary TTS** - Piper voices for both summaries and translations
- ✅ **Semantic Search** - Qdrant + multilingual embeddings + topic filters
- ✅ **Quality Feedback** - MOS ratings for summaries and translations

### v3.0 (January 2026)

- ✅ **User Authentication** - JWT-based login/registration
- ✅ **Bookmarks & History** - Save and track articles
- ✅ **AI Summaries** - Local mBART-powered article summarization
- ✅ **Text-to-Speech** - English & Nepali voice synthesis
- ✅ **Dark Mode** - Beautiful dark theme with sync
- ✅ **Email Newsletters** - Automated daily digest at 7 AM
- ✅ **Personalized Recommendations** - ML-based article suggestions
- ✅ **Network Access** - Cross-device support on local network
- ✅ **Modern Email Templates** - Dark mode compatible, mobile responsive

### v2.0 (November 2025)

- Enhanced RSS sources (36+ feeds)
- Full content extraction (5000 chars)
- Nepali language support
- Auto-cleanup of old articles

### v1.0 (Initial)

- Basic RSS fetching
- Category-based aggregation

## 📄 License

This project is licensed under the ISC License.

## 🙏 Acknowledgments

- **News Sources** - RSS feeds from USA & Nepal publishers
- **Hugging Face** - mBART model fine-tuned for Nepali
- **Piper TTS** - High-quality voice synthesis
- **MongoDB** and **Qdrant** - Storage and vector search
- **React & Node.js** - Framework communities

## 📬 Contact

For questions or support, please open an issue in the repository.

---

<p align="center">
  <b>Made with ❤️ by Bikash Kumar Sah</b><br>
  <i>Your AI-powered news companion</i>
</p>

---

**Disclaimer:** This project is for educational purposes. Respect the terms of service of news sources. All articles link to original publishers. Market Gyan output is informational analysis based on public data, not investment advice.

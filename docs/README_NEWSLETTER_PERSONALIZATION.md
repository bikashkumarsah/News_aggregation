## Khabar AI — How Reading History Drives Personalized Newsletters (Brief)

This note explains:
- How the app records **reading history**
- How history becomes **user preferences**
- How preferences are used to select **recommended articles**
- How the **daily email newsletter** is scheduled and sent

---

## 1) Reading history capture

### Frontend
- **File**: `minimal/news-aggregator/src/context/AuthContext.js`
  - `addToHistory(articleId)` calls the backend when a user opens an article.
- **File**: `minimal/news-aggregator/src/App.js`
  - `handleArticleClick(article)` triggers `addToHistory(article._id)` for logged-in users.

### Backend
- **Route**: `minimal/news-backend/routes/userRoutes.js`
  - `POST /api/user/history/:articleId` appends `{ article, readAt }` to the user.

### Storage
- **Schema**: `minimal/news-backend/models/User.js`
  - `readHistory: [{ article: ObjectId(ref Article), readAt: Date }]`

---

## 2) Preference learning from history

- **File**: `minimal/news-backend/services/preferenceService.js`
- **Function**: `updateUserPreferences(userId)`

What it does:
- Loads the user’s reading history (`populate('readHistory.article')`)
- Uses only the last **30 days** of reads
- Computes:
  - **Category scores** (0–100) based on read frequency
  - **Preferred sources** (top sources by read frequency)
  - **Top keywords** from titles/descriptions (simple keyword extraction)
- Stores results in `User.preferences`:
  - `categoryScores`, `preferredSources`, `topKeywords`, `lastUpdated`, `totalArticlesRead`

---

## 3) Recommendations used in the newsletter

- **File**: `minimal/news-backend/services/preferenceService.js`
- **Function**: `getRecommendations(userId, limit)`

How it selects articles:
- Finds recent articles (last ~24 hours)
- Prioritizes matches to:
  - top categories
  - preferred sources
  - keyword overlaps
  - recency
- Returns a ranked list of articles used in emails.

Fallback:
- If a user has no preferences yet, it returns **recent articles** (trending-ish).

---

## 3.1) Semantic recommendations (Qdrant + multilingual embeddings)

To improve relevance (especially English + Nepali), the newsletter can use **Qdrant semantic retrieval** driven by the user’s reading history.

### What changes?
- Instead of selecting candidates only by keywords/categories, we build a **user interest vector** from the last 30 days of reading history.
- The vector is the **recency-weighted mean of the read articles' stored Qdrant vectors** (up to the 50 newest reads, each weighted `0.5^(age in days / 3)`). Vectors come from one Qdrant retrieve call; only articles missing from the index are embedded (title + description).
- Qdrant then fetches the closest recent articles (**search by meaning**).

Why not one text query? The previous version concatenated up to 4,000 characters of recent titles/descriptions and embedded them once. The model truncates input at 512 tokens, so only the newest ~3 reads (repeated 3× each) shaped the profile and the rest of the history was ignored. Averaging stored vectors lets every read count and needs no model call in the common case.

### Implementation
- **File**: `minimal/news-backend/services/preferenceService.js`
- **Functions**:
  - `getSemanticRecommendations(userId, limit)` — Qdrant-first semantic retrieval
  - `getNewsletterRecommendations(userId, limit)` — semantic-first, fallback to `getRecommendations`

### Filtering / safety rules
The semantic recommender also:
- Restricts freshness (last ~24 hours)
- Optionally filters by the user’s top `topics` and top `category` values
- Excludes articles already present in the user’s recent reading history
- Applies a light rerank:
  - boosts preferred sources/categories/topics
  - keeps semantic similarity as the primary signal
- Limits too many results from the same source (basic diversity)

### Evaluation: concatenated text query vs. interest vector (Oct 2026)

Setup (disposable infrastructure; the real `newsDB` and Qdrant were only read, never written):
- Corpus: read-only copy of `newsDB` restored into a throwaway MongoDB, snapshotted as of **2026-01-24 09:00 UTC** (1,628 articles published by then; later articles and later reads removed), indexed with `distiluse-base-multilingual-cased-v2` (768d).
- Search: Docker was not running, so a throwaway in-memory stand-in for the Qdrant REST API with exact cosine search was used. Real Qdrant also searches exactly at this size (no HNSW index below ~10 MB of vectors), so rankings should match.
- Profiles (`eval/newsletter_profiles_2026-10-20T13-24-30-000Z.json`): the 4 real users' histories as of the snapshot plus 26 seeded synthetic personas built from fixed recipes before any recommendations were generated: focused (one interest + random clicks), mixed (2–3 interleaved interests), drift (older reads on one interest, last-day reads on another) and burst (steady interest, last 2–3 reads on something else).
- Both arms run the same production pipeline (`recommendFromReads`: filter variants, rerank, per-source diversity); only the interest profile differs. K = 5, newsletter time = the snapshot time.
- Labels: 237 unique (profile, article) pairs labeled **blind** (`labelNewsletterEval.js --export/--import`: both arms' recommendations merged, deduplicated and shuffled, no arm names). Relevant = matches the specific subject of at least one read (same story or follow-up, same sport, same domain such as Nepali politics, AI, NEPSE, Hollywood film/TV); broad-category or same-source matches don't count. Re-reports of a story the reader already read count as not relevant ("strict"); a "lenient" rescore counts them as relevant. The labels were produced by Claude, not a human; re-labeling the exported sheet by hand is the way to confirm.

Results (`eval/newsletter_eval_2026-10-20T13-24-30-859Z.json`, strict labels):

| Profiles | Text query (previous) | Interest vector (new) |
|---|---|---|
| All 30 | **0.580** | **0.727** |
| Real users (4) | 0.550 | 0.650 |
| Focused (6) | 0.633 | 0.733 |
| Mixed (8) | 0.525 | 0.625 |
| Drift (6) | 0.667 | 0.933 |
| Burst (6) | 0.533 | 0.700 |

- Paired difference: **+0.147 P@5** for the interest vector (95% bootstrap CI +0.073 to +0.227); better on 16 profiles, tied on 11, worse on 3 (sign test p = 0.004).
- Lenient labels: 0.760 vs 0.607 (+0.153, CI +0.080 to +0.227).
- Cost: the interest vector needs one Qdrant retrieve and no model call when the reads are indexed (all 30 profiles in 0.7 s vs 7 s including the model load for the text query).
- Caveats: one snapshot day, 4 real users, synthetic personas, and an LLM labeler. Both arms lean on the same long-form feed ("Unknown Source", ~25–29% of slots), which this change does not address.

**Label-free check: what real users read next** (`scripts/eval/nextReadCheck.js`, same snapshot setup, no labels). At every session boundary (a gap of 30+ minutes) in the real users' read histories up to the snapshot time, the reads before the boundary are the history. All articles published in the previous 7 days that the user had not read yet (765–1,315 per boundary) are ranked by cosine similarity to each interest profile, and the articles the user actually opened in the next 48 hours (published before the boundary) are located in that ranking. Reads after the snapshot time come from the read-only `newsDB` export, because the snapshot copy trims them.

| 7 boundaries, 114 later reads (40 distinct articles) | Text query (previous) | Interest vector (new) |
|---|---|---|
| MRR | 0.0081 | **0.0174** |
| Recall@10 | 0.018 | **0.035** |
| Recall@50 | 0.096 | **0.123** |
| Median rank | 456 | 464 |
| Mean percentile rank (lower is better) | 0.537 | **0.506** |
| Newsletter picks read later (5 per boundary) | 1/35 | 0/35 |

- The interest vector ranked the later read higher in 68 of 114 (boundary, read) pairs, lower in 45, tied in 1 (sign test p = 0.038, optimistic because the same reads recur across overlapping boundaries). Per boundary it had the higher MRR in 6 of 7 (sign test p = 0.13) and the better mean percentile in 6 of 7.
- Agreement with the blind P@5 result: same direction. The gain sits at the head of the ranking (about twice the MRR, more later reads in the top 10 and top 50), which is the part a 5-item newsletter uses. It is weak evidence on its own: 6 of the 7 boundaries come from one heavy reader, the median rank does not move, and the actual newsletter picks were almost never opened later under either profile.

Decision: the interest vector scored better overall and in every profile group, and the label-free check points the same way, so it replaced the text query. The previous builder is kept in `scripts/eval/textInterestQuery.js` for future comparisons.

Reproduce (point `MONGODB_URI`/`QDRANT_URL` at disposable instances holding the snapshot; with `--index` add `QDRANT_INDEX_DAYS=0` so a snapshot is indexed in full):

```bash
cd minimal/news-backend
node scripts/eval/runNewsletterModelComparison.js --models distiluse --interests text,vector \
  --profiles ../../eval/newsletter_profiles_2026-10-20T13-24-30-000Z.json --now 2026-01-24T09:00:00Z --k 5
node scripts/eval/labelNewsletterEval.js /abs/path/eval/newsletter_eval_....json --export sheet.json   # label blind
node scripts/eval/labelNewsletterEval.js /abs/path/eval/newsletter_eval_....json --import sheet.json
node scripts/eval/scoreNewsletterEval.js /abs/path/eval/newsletter_eval_....json
# label-free check; --users takes an Extended JSON export of users (e.g. `bsondump users.bson`)
# when the snapshot copy's histories stop at the snapshot time
node scripts/eval/nextReadCheck.js --users users.json --until 2026-01-24T09:00:00Z
```

`generateNewsletterRecs.js` (real users through `getNewsletterRecommendations`) and `generateNewsletterRecsFromProfiles.js` accept `EVAL_NOW` (snapshot time) and `EVAL_INTEREST=text|vector`. The scorer counts missing slots in a short list as misses (so every arm is scored on the same profiles) and prints paired differences and a per-kind breakdown.

### Requirement: Qdrant must be indexed with the embedding model you use
After enabling embeddings, reindex Qdrant:

```bash
cd minimal/news-backend
npm install
npm run index-qdrant
```

---

## 4) Newsletter scheduling & sending

### Scheduler
- **File**: `minimal/news-backend/services/newsletterScheduler.js`
- `startNewsletterScheduler()` runs **every hour** via cron:
  - Cron: `0 * * * *`
  - Timezone: `Asia/Kathmandu`

### Who gets the daily email?
In `processNewsletters()`:
- user must have: `emailPreferences.dailyDigest = true`
- user must **not** have received a newsletter today (`lastNewsletterSent < startOfToday`)
- user’s `digestTime` hour must match the current hour (default `07:00`)

### What gets sent?
In `sendNewsletterToUser(user)`:
1. `updateUserPreferences(user._id)` (refresh profile)
2. `getNewsletterRecommendations(user._id, 5)` (semantic-first pick; fallback if needed)
3. `sendPersonalizedNewsletter(email, name, articles, preferences)`
4. Save `lastNewsletterSent = now`

### Email templates
- **File**: `minimal/news-backend/services/emailService.js`
- Template used for daily personalization:
  - `personalizedNewsletter(name, articles, preferences)`
- Uses `FRONTEND_URL` to build “Explore More News” links.

---

## 5) Testing / debugging

### API trigger (for logged-in user)
- `POST /api/user/test/send-newsletter`

### CLI testing
- **File**: `minimal/news-backend/testEmail.js`
  - `node testEmail.js --user your@email.com` (send personalized newsletter now)
  - `node testEmail.js --all` (send to all eligible users now)
  - `node testEmail.js --list` (see who has daily digest enabled)

Common reasons a user gets no email:
- `emailPreferences.dailyDigest` is `false`
- No recommendations found (no recent articles / filtering too strict)
- SMTP misconfigured (check `.env`)


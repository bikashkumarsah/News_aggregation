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
2. `getRecommendations(user._id, 5)` (pick articles)
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


#!/usr/bin/env node
/**
 * Generate top-N semantic newsletter recommendations for synthetic "profiles".
 *
 * A profile is a snapshot of reading history. Recommendations come from the
 * production pipeline (preferenceService.recommendFromReads), so only the
 * interest profile differs between EVAL_INTEREST runs.
 *
 * Env:
 * - EVAL_PROFILE_FILE: path to a JSON file: { profiles: [{ profileId, baseUserId, email, name,
 *     history: [{ articleId, readAt }] }] } (newest first). Older files with only
 *     `historyArticleIds` work too; their reads count as read at EVAL_NOW.
 * - EVAL_LIMIT: number (default 5)
 * - EVAL_NOW: ISO time the newsletter is generated at (default: now)
 * - EVAL_INTEREST: "vector" (default, production) or "text" (previous concatenated query)
 * - EVAL_HALF_LIFE_DAYS: optional override of the interest vector's recency half-life
 * - EMBEDDING_MODEL / QDRANT_COLLECTION / QDRANT_VECTOR_SIZE must match the indexed collection
 * - EMBEDDING_STRICT=1 recommended for eval (no fallback)
 *
 * Output: pure JSON to stdout.
 */

require('dotenv').config({ quiet: true });

// Ensure stdout is clean JSON (send logs to stderr)
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

const fs = require('fs');
const mongoose = require('mongoose');
const Article = require('../../models/Article');
const { isQdrantReachable, QDRANT_COLLECTION, VECTOR_SIZE, EMBEDDING_PROVIDER } = require('../../services/qdrantService');
const { DEFAULT_MODEL } = require('../../services/embeddingService');
const { buildPreferences, recentReads, recommendFromReads } = require('../../services/preferenceService');
const { interestBuilderFor } = require('./textInterestQuery');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB';
const HISTORY_FIELDS = 'title description source category topics publishedAt';

const pickFields = (article) => ({
  _id: article._id?.toString(),
  title: article.title,
  description: article.description,
  url: article.url,
  source: article.source,
  category: article.category,
  topics: article.topics || [],
  publishedAt: article.publishedAt
});

const historyOf = (profile) => (Array.isArray(profile.history)
  ? profile.history.map((h) => ({ articleId: String(h.articleId), readAt: h.readAt }))
  : (profile.historyArticleIds || []).map((articleId) => ({ articleId: String(articleId) })));

async function recommendForProfile(profile, { limit, now, interest, halfLifeDays }) {
  const history = historyOf(profile);
  if (!history.length) return { historyPreview: [], recommendations: [] };

  // Fetch history docs and preserve order (newest first)
  const docs = await Article.find({ _id: { $in: history.map((h) => h.articleId) } }, HISTORY_FIELDS).lean();
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));
  const reads = recentReads(history
    .filter((h) => byId.has(h.articleId))
    .map((h) => ({ article: byId.get(h.articleId), readAt: h.readAt || new Date(now) })), 30, now);

  // The labeler sees every read the recommender used.
  const historyPreview = reads.slice(0, 50).map(({ article, readAt }) => ({
    title: article.title,
    source: article.source,
    category: article.category,
    topics: article.topics || [],
    readAt
  }));

  const recommendations = await recommendFromReads(reads, {
    preferences: buildPreferences(reads),
    limit,
    now,
    halfLifeDays,
    buildInterest: interestBuilderFor(interest)
  });

  // If we can't fill the quota, return fewer (the scorer counts missing slots as misses).
  return { historyPreview, recommendations: recommendations.map(pickFields) };
}

async function main() {
  const file = process.env.EVAL_PROFILE_FILE;
  if (!file) {
    console.error('Missing EVAL_PROFILE_FILE');
    process.exit(1);
  }

  const limit = Math.min(Math.max(parseInt(process.env.EVAL_LIMIT || '5', 10) || 5, 1), 10);
  const now = process.env.EVAL_NOW ? Date.parse(process.env.EVAL_NOW) : Date.now();
  if (!Number.isFinite(now)) {
    console.error(`Invalid EVAL_NOW: ${process.env.EVAL_NOW}`);
    process.exit(1);
  }
  const interest = process.env.EVAL_INTEREST || 'vector';
  interestBuilderFor(interest); // validate before connecting
  const halfLifeDays = process.env.EVAL_HALF_LIFE_DAYS ? Number(process.env.EVAL_HALF_LIFE_DAYS) : undefined;

  const ok = await isQdrantReachable();
  if (!ok) {
    console.error('Qdrant is not reachable. Start it and re-run.');
    process.exit(1);
  }

  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];

  await mongoose.connect(MONGODB_URI);

  const outProfiles = [];
  for (const p of profiles) {
    const { historyPreview, recommendations } = await recommendForProfile(p, { limit, now, interest, halfLifeDays });
    outProfiles.push({
      profileId: p.profileId,
      baseUserId: p.baseUserId,
      email: p.email,
      name: p.name,
      historyPreview,
      recommendations
    });
  }

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      now: new Date(now).toISOString(),
      interest,
      ...(halfLifeDays !== undefined ? { halfLifeDays } : {}),
      embeddingProvider: EMBEDDING_PROVIDER,
      embeddingModel: DEFAULT_MODEL,
      qdrantCollection: QDRANT_COLLECTION,
      vectorSize: VECTOR_SIZE,
      limit
    },
    profiles: outProfiles
  };

  // Flush before the process.exit below (pipes are asynchronous on macOS).
  await new Promise((resolve) => process.stdout.write(JSON.stringify(payload, null, 2), resolve));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {}
    // The embedding runtime can keep worker threads alive; this is a one-shot CLI.
    process.exit(process.exitCode || 0);
  });

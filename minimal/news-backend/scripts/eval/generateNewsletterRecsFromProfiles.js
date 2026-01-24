#!/usr/bin/env node
/**
 * Generate top-N semantic newsletter recommendations for synthetic "profiles".
 *
 * A profile is a snapshot of reading history (article IDs), used to build an interest query.
 *
 * Env:
 * - EVAL_PROFILE_FILE: path to a JSON file: { profiles: [{ profileId, baseUserId, email, name, historyArticleIds: [] }] }
 * - EVAL_LIMIT: number (default 5)
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
const { isQdrantReachable, search: qdrantSearch, QDRANT_COLLECTION, VECTOR_SIZE, EMBEDDING_PROVIDER } = require('../../services/qdrantService');
const { DEFAULT_MODEL } = require('../../services/embeddingService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB';

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

const buildInterestQuery = (historyDocs) => {
  const MAX_CHARS = 4000;
  let queryText = '';

  // Most recent first expected.
  for (let i = 0; i < Math.min(25, historyDocs.length); i++) {
    const a = historyDocs[i];
    const snippet = `${a.title || ''}. ${a.description || ''}`.trim();
    if (!snippet) continue;

    const repeat = i < 3 ? 3 : i < 8 ? 2 : 1;
    for (let r = 0; r < repeat; r++) {
      if ((queryText.length + snippet.length + 2) > MAX_CHARS) break;
      queryText += (queryText ? '\n' : '') + snippet;
    }
    if (queryText.length >= MAX_CHARS) break;
  }

  return queryText;
};

const topNFromCounts = (counts, n) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);

async function recommendForProfile(profile, limit) {
  const historyIds = Array.isArray(profile.historyArticleIds) ? profile.historyArticleIds : [];
  if (!historyIds.length) return { historyPreview: [], recommendations: [] };

  // Fetch history docs and preserve order
  const docs = await Article.find({ _id: { $in: historyIds } }, 'title description source category topics publishedAt').lean();
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));
  const historyDocs = historyIds.map((id) => byId.get(id)).filter(Boolean);

  const historyPreview = historyDocs.slice(0, 8).map((a) => ({
    title: a.title,
    source: a.source,
    category: a.category,
    topics: a.topics || []
  }));

  const queryText = buildInterestQuery(historyDocs);
  if (!queryText) return { historyPreview, recommendations: [] };

  // Build preference-like signals from history
  const sourceCount = {};
  const categoryCount = {};
  const topicCount = {};
  for (const a of historyDocs.slice(0, 50)) {
    if (a.source) sourceCount[a.source] = (sourceCount[a.source] || 0) + 1;
    if (a.category) categoryCount[a.category] = (categoryCount[a.category] || 0) + 1;
    for (const t of (Array.isArray(a.topics) ? a.topics : [])) {
      const key = String(t).toLowerCase();
      topicCount[key] = (topicCount[key] || 0) + 1;
    }
  }

  const preferredSources = topNFromCounts(sourceCount, 8);
  const topCategories = topNFromCounts(categoryCount, 3);
  const topTopics = topNFromCounts(topicCount, 3);

  const preferredSourceSet = new Set(preferredSources);
  const topCategorySet = new Set(topCategories);
  const topTopicSet = new Set(topTopics);

  const runQdrant = async ({ fromDate, topics, category }) => {
    const candidateLimit = Math.min(Math.max(limit * 8, 30), 50);
    const res = await qdrantSearch({
      query: queryText,
      topics,
      category,
      from: fromDate ? fromDate.toISOString() : undefined,
      excludeMongoIds: historyIds,
      limit: candidateLimit,
      offset: 0
    });
    return (res || [])
      .map((r) => ({ mongoId: r?.payload?.mongoId, score: typeof r?.score === 'number' ? r.score : 0 }))
      .filter((r) => Boolean(r.mongoId));
  };

  const sinceDates = [1, 2, 7].map((days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  });

  const seen = new Set();
  const ranked = [];

  for (const since of sinceDates) {
    const variants = [
      { topics: topTopics.length ? topTopics : undefined, category: topCategories.length ? topCategories : undefined },
      { topics: undefined, category: topCategories.length ? topCategories : undefined },
      { topics: topTopics.length ? topTopics : undefined, category: undefined },
      { topics: undefined, category: undefined }
    ];

    for (const v of variants) {
      const batch = await runQdrant({ fromDate: since, topics: v.topics, category: v.category });
      for (const r of batch) {
        if (seen.has(r.mongoId)) continue;
        seen.add(r.mongoId);
        ranked.push(r);
      }
      if (ranked.length >= Math.min(200, limit * 20)) break;
    }
    if (ranked.length >= Math.min(80, limit * 10)) break;
  }

  if (!ranked.length) return { historyPreview, recommendations: [] };

  const ids = ranked.map((r) => r.mongoId);
  const recDocs = await Article.find({ _id: { $in: ids } }).lean();
  const recById = new Map(recDocs.map((d) => [d._id.toString(), d]));

  const rerankScore = (doc, semanticScore) => {
    let bonus = 0;
    if (preferredSourceSet.has(doc.source)) bonus += 0.15;
    if (topCategorySet.has(doc.category)) bonus += 0.10;

    const docTopics = Array.isArray(doc.topics) ? doc.topics : [];
    const topicMatches = docTopics.filter((t) => topTopicSet.has(String(t).toLowerCase())).length;
    bonus += Math.min(0.20, topicMatches * 0.10);

    const hoursAgo = (Date.now() - new Date(doc.publishedAt).getTime()) / (1000 * 60 * 60);
    bonus += Math.max(0, (24 - hoursAgo) / 24) * 0.05;

    return (semanticScore || 0) + bonus;
  };

  const candidates = ranked
    .map((r) => {
      const doc = recById.get(r.mongoId);
      if (!doc) return null;
      return { doc, score: rerankScore(doc, r.score) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  // Diversity: max 2 per source
  const picked = [];
  const perSource = {};
  for (const c of candidates) {
    const src = c.doc.source || 'unknown';
    perSource[src] = perSource[src] || 0;
    if (perSource[src] >= 2) continue;
    picked.push(c.doc);
    perSource[src] += 1;
    if (picked.length >= limit) break;
  }

  // If we can't fill the quota, return fewer (caller can decide how to handle).
  return { historyPreview, recommendations: picked.map(pickFields) };
}

async function main() {
  const file = process.env.EVAL_PROFILE_FILE;
  if (!file) {
    console.error('Missing EVAL_PROFILE_FILE');
    process.exit(1);
  }

  const limit = Math.min(Math.max(parseInt(process.env.EVAL_LIMIT || '5', 10) || 5, 1), 10);

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
    const { historyPreview, recommendations } = await recommendForProfile(p, limit);
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
      embeddingProvider: EMBEDDING_PROVIDER,
      embeddingModel: DEFAULT_MODEL,
      qdrantCollection: QDRANT_COLLECTION,
      vectorSize: VECTOR_SIZE,
      limit
    },
    profiles: outProfiles
  };

  process.stdout.write(JSON.stringify(payload, null, 2));
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
  });


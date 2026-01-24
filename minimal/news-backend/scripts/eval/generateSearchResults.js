#!/usr/bin/env node
/**
 * Generate top-K search results for a list of queries for the *current* embedding model/collection.
 *
 * This script is model/collection-aware via env vars:
 * - EMBEDDING_MODEL
 * - QDRANT_COLLECTION
 * - QDRANT_VECTOR_SIZE
 *
 * Input:
 * - EVAL_QUERIES_JSON: JSON array like [{ id: "q1", text: "..." }, ...]
 * - EVAL_K: number (default 5)
 *
 * Output:
 * - Pure JSON to stdout.
 */

require('dotenv').config({ quiet: true });

// Ensure stdout is clean JSON (send logs to stderr)
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

const mongoose = require('mongoose');
const Article = require('../../models/Article');
const { search: qdrantSearch, QDRANT_COLLECTION, VECTOR_SIZE, EMBEDDING_PROVIDER } = require('../../services/qdrantService');
const { DEFAULT_MODEL } = require('../../services/embeddingService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB';

const parseQueries = () => {
  const raw = process.env.EVAL_QUERIES_JSON;
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((q, idx) => ({
      id: q.id || `q${idx + 1}`,
      text: (q.text || '').toString().trim()
    }))
    .filter((q) => q.text.length > 0);
};

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

async function main() {
  const queries = parseQueries();
  const k = Math.min(Math.max(parseInt(process.env.EVAL_K || '5', 10) || 5, 1), 20);

  if (!queries.length) {
    console.error('Missing/empty EVAL_QUERIES_JSON');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);

  const outQueries = [];
  for (const q of queries) {
    const res = await qdrantSearch({
      query: q.text,
      limit: k,
      offset: 0
    });

    const ranked = (res || [])
      .map((r) => ({
        mongoId: r?.payload?.mongoId,
        score: typeof r?.score === 'number' ? r.score : 0
      }))
      .filter((r) => Boolean(r.mongoId));

    const ids = ranked.map((r) => r.mongoId);
    const docs = await Article.find({ _id: { $in: ids } }).lean();
    const byId = new Map(docs.map((d) => [d._id.toString(), d]));

    const items = ranked
      .map((r, idx) => {
        const doc = byId.get(r.mongoId);
        if (!doc) return null;
        return {
          rank: idx + 1,
          qdrantScore: r.score,
          relevant: null,
          ...pickFields(doc)
        };
      })
      .filter(Boolean);

    outQueries.push({
      queryId: q.id,
      query: q.text,
      items
    });
  }

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      embeddingProvider: EMBEDDING_PROVIDER,
      embeddingModel: DEFAULT_MODEL,
      qdrantCollection: QDRANT_COLLECTION,
      vectorSize: VECTOR_SIZE,
      k
    },
    queries: outQueries
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


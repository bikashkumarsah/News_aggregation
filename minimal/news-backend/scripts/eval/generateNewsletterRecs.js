#!/usr/bin/env node
/**
 * Generate top-N newsletter recommendations for a list of users.
 *
 * This script is model/collection-aware via env vars:
 * - EMBEDDING_MODEL
 * - QDRANT_COLLECTION
 * - QDRANT_VECTOR_SIZE
 *
 * Usage:
 *   EVAL_USER_IDS="id1,id2,..." EVAL_LIMIT=5 node scripts/eval/generateNewsletterRecs.js
 *
 * Output:
 *   Prints JSON to stdout.
 */

require('dotenv').config({ quiet: true });

// Ensure stdout is clean JSON (send logs to stderr)
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);

const mongoose = require('mongoose');
const User = require('../../models/User');
const { updateUserPreferences, getNewsletterRecommendations } = require('../../services/preferenceService');
const { QDRANT_COLLECTION, VECTOR_SIZE, EMBEDDING_PROVIDER } = require('../../services/qdrantService');
const { DEFAULT_MODEL } = require('../../services/embeddingService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB';

const parseUserIds = () => {
  const raw = process.env.EVAL_USER_IDS || '';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
};

const pickFields = (article) => ({
  _id: article._id?.toString(),
  title: article.title,
  description: article.description,
  content: article.content,
  url: article.url,
  source: article.source,
  category: article.category,
  topics: article.topics || [],
  publishedAt: article.publishedAt
});

async function main() {
  const userIds = parseUserIds();
  const limit = Math.min(Math.max(parseInt(process.env.EVAL_LIMIT || '5', 10) || 5, 1), 10);

  if (!userIds.length) {
    console.error('Missing EVAL_USER_IDS (comma-separated Mongo user _ids).');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);

  const users = await User.find({ _id: { $in: userIds } }, 'email name readHistory');
  const byId = new Map(users.map((u) => [u._id.toString(), u]));

  const results = [];
  for (const userId of userIds) {
    const u = byId.get(userId);
    if (!u) continue;

    // Mirror production flow: refresh preferences first
    await updateUserPreferences(u._id);

    const recs = await getNewsletterRecommendations(u._id, limit);
    results.push({
      userId,
      email: u.email,
      name: u.name,
      recommendations: (recs || []).map(pickFields)
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
    users: results
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


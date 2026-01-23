#!/usr/bin/env node
/**
 * Backfill MongoDB articles into Qdrant for semantic search.
 *
 * Usage:
 *   node scripts/indexQdrant.js
 *
 * Notes:
 * - Requires Qdrant running (default: http://localhost:6333)
 * - Uses local hashing vectors (no external embedding API required)
 */

require('dotenv').config();

const mongoose = require('mongoose');
const Article = require('../models/Article');
const {
  QDRANT_URL,
  QDRANT_COLLECTION,
  VECTOR_SIZE,
  isQdrantReachable,
  ensureCollection,
  upsertArticles
} = require('../services/qdrantService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB';

const BATCH_SIZE = Math.min(Math.max(parseInt(process.env.QDRANT_INDEX_BATCH || '64', 10) || 64, 1), 256);

async function main() {
  console.log('🧠 Qdrant Indexer');
  console.log(`- MongoDB: ${MONGODB_URI}`);
  console.log(`- Qdrant: ${QDRANT_URL}`);
  console.log(`- Collection: ${QDRANT_COLLECTION}`);
  console.log(`- Vector size: ${VECTOR_SIZE}`);
  console.log(`- Batch size: ${BATCH_SIZE}`);

  const ok = await isQdrantReachable();
  if (!ok) {
    console.error('\n❌ Qdrant is not reachable. Make sure your docker container is running and port 6333 is exposed.');
    process.exit(1);
  }

  await ensureCollection();

  await mongoose.connect(MONGODB_URI);
  console.log('\n✅ Connected to MongoDB');

  const cursor = Article.find(
    {},
    '_id title description content category source url publishedAt topics'
  )
    .sort({ publishedAt: -1 })
    .cursor();

  let batch = [];
  let total = 0;

  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH_SIZE) {
      await upsertArticles(batch, { wait: false });
      total += batch.length;
      console.log(`Indexed ${total} articles...`);
      batch = [];
    }
  }

  if (batch.length) {
    await upsertArticles(batch, { wait: true });
    total += batch.length;
  }

  console.log(`\n✅ Indexing complete. Total indexed: ${total}`);
}

main()
  .catch((err) => {
    console.error('\n❌ Indexing failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {}
  });


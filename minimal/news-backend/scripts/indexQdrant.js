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
  EMBEDDING_PROVIDER,
  isQdrantReachable,
  ensureCollection,
  upsertArticles
} = require('../services/qdrantService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB';

const DEFAULT_BATCH = EMBEDDING_PROVIDER === 'transformers' ? 16 : 64;
const BATCH_SIZE = Math.min(
  Math.max(parseInt(process.env.QDRANT_INDEX_BATCH || String(DEFAULT_BATCH), 10) || DEFAULT_BATCH, 1),
  256
);

const MAX_RETRIES = Math.min(Math.max(parseInt(process.env.QDRANT_INDEX_RETRIES || '5', 10) || 5, 0), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upsertWithRetry(batch) {
  // Always use wait=true during backfill to avoid overloading Qdrant with pending operations.
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      await upsertArticles(batch, { wait: true });
      return;
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      const last = attempt >= MAX_RETRIES + 1;

      // If this was a big batch, try splitting once before giving up.
      if (last && batch.length > 1) {
        const mid = Math.floor(batch.length / 2);
        const left = batch.slice(0, mid);
        const right = batch.slice(mid);
        console.warn(`⚠️ Upsert failed for batch size ${batch.length}. Splitting into ${left.length} + ${right.length}...`);
        await upsertWithRetry(left);
        await upsertWithRetry(right);
        return;
      }

      if (last) throw err;

      const backoff = Math.min(5000, 250 * attempt * attempt);
      console.warn(`⚠️ Qdrant upsert failed (attempt ${attempt}/${MAX_RETRIES + 1}): ${msg}`);
      console.warn(`   Retrying in ${backoff}ms...`);
      await sleep(backoff);
    }
  }
}

async function main() {
  console.log('🧠 Qdrant Indexer');
  console.log(`- MongoDB: ${MONGODB_URI}`);
  console.log(`- Qdrant: ${QDRANT_URL}`);
  console.log(`- Collection: ${QDRANT_COLLECTION}`);
  console.log(`- Vector size: ${VECTOR_SIZE}`);
  console.log(`- Embedding provider: ${EMBEDDING_PROVIDER}`);
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
      await upsertWithRetry(batch);
      total += batch.length;
      console.log(`Indexed ${total} articles...`);
      batch = [];
    }
  }

  if (batch.length) {
    await upsertWithRetry(batch);
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


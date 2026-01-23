#!/usr/bin/env node
/**
 * Backfill `topics` for existing MongoDB articles.
 *
 * This is useful if you added topic tagging after you already had articles stored.
 *
 * Usage:
 *   node scripts/backfillTopics.js
 *   node scripts/backfillTopics.js --force   # recompute topics for ALL articles
 */

require('dotenv').config();

const mongoose = require('mongoose');
const Article = require('../models/Article');
const { getTopicsForArticle } = require('../services/topicService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB';
const BATCH_SIZE = Math.min(Math.max(parseInt(process.env.TOPICS_BACKFILL_BATCH || '200', 10) || 200, 10), 1000);

async function main() {
  console.log('🏷️  Topics Backfill');
  console.log(`- MongoDB: ${MONGODB_URI}`);
  console.log(`- Batch size: ${BATCH_SIZE}`);

  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const force = process.argv.includes('--force');

  const query = force
    ? {}
    : {
        $or: [
          { topics: { $exists: false } },
          { topics: { $size: 0 } }
        ]
      };

  const totalToUpdate = await Article.countDocuments(query);
  console.log(force ? `Recomputing topics for ${totalToUpdate} articles` : `Found ${totalToUpdate} articles without topics`);

  if (totalToUpdate === 0) return;

  const cursor = Article.find(query, '_id title description content category topics')
    .cursor();

  let ops = [];
  let processed = 0;
  let updated = 0;

  for await (const doc of cursor) {
    const topics = getTopicsForArticle(doc);
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { topics } }
      }
    });

    processed++;

    if (ops.length >= BATCH_SIZE) {
      const res = await Article.bulkWrite(ops, { ordered: false });
      updated += res.modifiedCount || 0;
      ops = [];
      console.log(`Processed ${processed}/${totalToUpdate} (updated ${updated})...`);
    }
  }

  if (ops.length) {
    const res = await Article.bulkWrite(ops, { ordered: false });
    updated += res.modifiedCount || 0;
  }

  console.log(`✅ Done. Updated ${updated} articles.`);
}

main()
  .catch((err) => {
    console.error('❌ Backfill failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {}
  });


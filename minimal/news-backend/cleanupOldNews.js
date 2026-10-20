#!/usr/bin/env node
/**
 * Delete articles older than NEWS_RETENTION_DAYS (default 7). Bookmarked
 * articles and articles referenced by the Market Gyan corpus are kept, and
 * deleted articles are removed from the Qdrant index as well.
 *
 * Usage: npm run cleanup-old
 */

require('dotenv').config({ quiet: true });

const Article = require('./models/Article');
const { deleteOldArticles, retentionDays } = require('./services/newsIngestionService');
const {
  connectMongo,
  disconnectMongo
} = require('./features/marketGyan/services/mongoConnectionService');

const main = async () => {
  await connectMongo();
  console.log('✅ Connected to MongoDB');
  console.log(`\n🗑️  Starting cleanup of articles older than ${retentionDays()} days...\n`);

  const { deleted, byCategory, cutoff } = await deleteOldArticles();
  console.log(`Cutoff: ${cutoff.toLocaleString()}`);

  if (deleted) {
    console.log('\nDeleted articles by category:');
    Object.entries(byCategory).forEach(([category, count]) => {
      console.log(`  - ${category}: ${count} articles`);
    });
  }

  console.log(`\n📰 Remaining articles in database: ${await Article.countDocuments()}\n`);
};

main()
  .catch((error) => {
    console.error('❌ Error during cleanup:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo().catch(() => {});
    console.log('✅ Database connection closed');
    process.exit(process.exitCode || 0);
  });

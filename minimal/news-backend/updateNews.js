#!/usr/bin/env node
/**
 * Fetch news once: prune expired articles, pull every RSS feed, save new
 * articles, and index them into Qdrant when it is running.
 *
 * Usage: npm run update-news
 */

require('dotenv').config({ quiet: true });

const Article = require('./models/Article');
const { runNewsUpdate } = require('./services/newsIngestionService');
const {
  connectMongo,
  disconnectMongo
} = require('./features/marketGyan/services/mongoConnectionService');

const printDatabaseStats = async () => {
  console.log('\n📊 Articles by category:');
  const stats = await Article.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  stats.forEach((stat) => {
    console.log(`   - ${stat._id}: ${stat.count} articles`);
  });
  console.log(`\n📰 Total articles in database: ${await Article.countDocuments()}`);
};

const main = async () => {
  await connectMongo();
  console.log('✅ Connected to MongoDB');
  console.log('\n🚀 Starting news update process...\n');

  const result = await runNewsUpdate();

  console.log('\n✅ News update completed!');
  console.log(`   - New articles saved: ${result.saved}`);
  console.log(`   - Duplicates skipped: ${result.skipped}`);
  if (result.invalid) console.log(`   - Invalid items skipped: ${result.invalid}`);
  if (result.expired) console.log(`   - Older than the retention window: ${result.expired}`);
  console.log(`   - Indexed into Qdrant: ${result.indexed}`);

  await printDatabaseStats();
};

main()
  .catch((error) => {
    console.error('❌ Error updating news:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectMongo().catch(() => {});
    console.log('\n✅ Database connection closed');
    // The embedding runtime can keep worker threads alive; this is a one-shot CLI.
    process.exit(process.exitCode || 0);
  });

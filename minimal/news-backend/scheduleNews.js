#!/usr/bin/env node
/**
 * Keep the news database fresh: run the update immediately and then every
 * NEWS_UPDATE_INTERVAL_MINUTES (default 30). A run that is still in progress
 * when the next one is due is never overlapped.
 *
 * Usage: npm run schedule-news
 */

require('dotenv').config({ quiet: true });

const Article = require('./models/Article');
const { retentionDays, runNewsUpdate } = require('./services/newsIngestionService');
const {
  connectMongo,
  disconnectMongo,
  withMongoRetry
} = require('./features/marketGyan/services/mongoConnectionService');

const intervalMinutes = Number.parseInt(process.env.NEWS_UPDATE_INTERVAL_MINUTES, 10) || 30;
const UPDATE_INTERVAL = Math.max(intervalMinutes, 1) * 60 * 1000;

let running = false;

const updateNews = async () => {
  if (running) {
    console.log('⏭️  Previous update is still running; skipping this cycle');
    return;
  }
  running = true;

  try {
    const timestamp = new Date().toLocaleString();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 News Update Started: ${timestamp}`);
    console.log('='.repeat(60));

    const result = await withMongoRetry(() => runNewsUpdate(), {
      operationName: 'News update'
    });

    console.log('\n✅ Update Complete!');
    console.log(`   New: ${result.saved} | Skipped: ${result.skipped} | Indexed: ${result.indexed}`);
    console.log(`   Total in DB: ${await Article.countDocuments()} articles`);
    console.log('='.repeat(60));
  } catch (error) {
    console.error('❌ Update error:', error.message);
  } finally {
    running = false;
  }
};

const main = async () => {
  await withMongoRetry(() => connectMongo(), {
    maxAttempts: Infinity,
    operationName: 'Connecting the news scheduler to MongoDB'
  });
  console.log('✅ Connected to MongoDB');

  console.log('🚀 News Scheduler Started');
  console.log(`⏰ Updates every ${UPDATE_INTERVAL / 60000} minutes`);
  console.log(`🗑️  Auto-deletes articles older than ${retentionDays()} days (bookmarked and Market Gyan articles are kept)`);
  console.log('Press Ctrl+C to stop\n');

  // Run immediately on start, then periodically.
  await updateNews();
  setInterval(updateNews, UPDATE_INTERVAL);
};

const shutdown = async () => {
  console.log('\n👋 Stopping news scheduler...');
  await disconnectMongo().catch(() => {});
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((error) => {
  console.error('❌ News scheduler failed to start:', error);
  process.exit(1);
});

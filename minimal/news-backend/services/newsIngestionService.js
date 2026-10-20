const Article = require('../models/Article');
const User = require('../models/User');
const MarketDocument = require('../features/marketGyan/models/MarketDocument');
const { fetchAllNews, removeDuplicates } = require('../newsFetcher');
const { getTopicsForArticleEnhanced } = require('./topicService');
const {
  deleteArticlePoints,
  isQdrantReachable,
  upsertArticles
} = require('./qdrantService');

/**
 * News ingestion shared by `npm run update-news`, `npm run schedule-news`
 * and `npm run cleanup-old`:
 *  1. delete articles past the retention window (never bookmarked articles or
 *     articles that Market Gyan's corpus references),
 *  2. fetch RSS feeds,
 *  3. insert only new URLs, tagging topics just for those,
 *  4. keep the Qdrant index in sync with both changes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const QDRANT_BATCH_SIZE = 16;
const DELETE_BATCH_SIZE = 500;

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const retentionDays = (env = process.env) => positiveInt(env.NEWS_RETENTION_DAYS, 7);

const chunk = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

const protectedArticleIds = async () => {
  const [bookmarked, marketGyan] = await Promise.all([
    User.distinct('bookmarks'),
    MarketDocument.distinct('article', { article: { $ne: null } })
  ]);
  return [...bookmarked, ...marketGyan].filter(Boolean);
};

const removeFromIndex = async (ids, { logger = console } = {}) => {
  if (!ids.length || !(await isQdrantReachable())) return 0;
  let removed = 0;
  try {
    for (const batch of chunk(ids.map(String), DELETE_BATCH_SIZE)) {
      removed += await deleteArticlePoints(batch, { wait: true });
    }
  } catch (error) {
    logger.warn(`⚠️  Could not remove deleted articles from Qdrant: ${error.message}`);
  }
  return removed;
};

const deleteOldArticles = async ({
  days = retentionDays(),
  now = new Date(),
  logger = console
} = {}) => {
  const cutoff = new Date(now.getTime() - (days * DAY_MS));
  const keep = await protectedArticleIds();
  const stale = await Article.find({
    publishedAt: { $lt: cutoff },
    ...(keep.length ? { _id: { $nin: keep } } : {})
  }).select('_id category').lean();

  if (!stale.length) {
    logger.log('✅ No old articles to delete');
    return { deleted: 0, byCategory: {}, cutoff };
  }

  const byCategory = {};
  for (const article of stale) {
    byCategory[article.category] = (byCategory[article.category] || 0) + 1;
  }

  const ids = stale.map((article) => article._id);
  let deleted = 0;
  for (const batch of chunk(ids, DELETE_BATCH_SIZE)) {
    const result = await Article.deleteMany({ _id: { $in: batch } });
    deleted += result.deletedCount;
  }
  logger.log(
    `🗑️  Deleted ${deleted} articles older than ${days} days `
    + '(bookmarked and Market Gyan articles are kept)'
  );
  await removeFromIndex(ids, { logger });

  return { deleted, byCategory, cutoff };
};

const failedInsertIndexes = (error) => new Set(
  (error?.writeErrors || []).map((writeError) => writeError.index ?? writeError.err?.index)
);

const saveNewArticles = async (articles, { logger = console, cutoff = null } = {}) => {
  const deduped = removeDuplicates(articles, { logger });
  // Items already past the retention window would be deleted by the next run
  // and re-fetched by the one after; never store (or embed) them.
  const unique = cutoff
    ? deduped.filter((article) => new Date(article.publishedAt) >= cutoff)
    : deduped;
  const expired = deduped.length - unique.length;
  if (!unique.length) return { inserted: [], skipped: 0, invalid: 0, expired };

  const existing = new Set(
    (await Article.find({ url: { $in: unique.map((a) => a.url) } }).select('url').lean())
      .map((doc) => doc.url)
  );
  const fresh = unique.filter((article) => !existing.has(article.url));

  // Topic tagging can run the embedding model, so only new articles pay for it.
  const docs = [];
  let invalid = 0;
  for (const article of fresh) {
    const doc = new Article({
      ...article,
      topics: await getTopicsForArticleEnhanced(article)
    });
    const validationError = doc.validateSync();
    if (validationError) {
      invalid += 1;
      logger.warn(`⚠️  Skipping invalid article ${article.url}: ${validationError.message}`);
    } else {
      docs.push(doc);
    }
  }

  let inserted = docs;
  if (docs.length) {
    try {
      await Article.insertMany(docs, { ordered: false });
    } catch (error) {
      // A concurrent run may have inserted some URLs first; keep the rest.
      if (error?.code !== 11000 && error?.name !== 'MongoBulkWriteError') throw error;
      if (Array.isArray(error.insertedDocs)) {
        const insertedIds = new Set(error.insertedDocs.map((doc) => String(doc._id)));
        inserted = docs.filter((doc) => insertedIds.has(String(doc._id)));
      } else {
        const failed = failedInsertIndexes(error);
        inserted = docs.filter((_, index) => !failed.has(index));
      }
    }
  }

  return {
    inserted,
    skipped: unique.length - inserted.length - invalid,
    invalid,
    expired
  };
};

const indexArticles = async (docs, { logger = console } = {}) => {
  if (!docs.length) return 0;
  if (!(await isQdrantReachable())) {
    logger.log('ℹ️  Qdrant is not reachable; new articles will be indexed by `npm run index-qdrant`.');
    return 0;
  }

  let indexed = 0;
  for (const batch of chunk(docs, QDRANT_BATCH_SIZE)) {
    try {
      indexed += await upsertArticles(batch.map((doc) => (doc.toObject ? doc.toObject() : doc)));
    } catch (error) {
      logger.warn(`⚠️  Qdrant indexing stopped: ${error.message}. Run \`npm run index-qdrant\` later.`);
      break;
    }
  }
  return indexed;
};

const runNewsUpdate = async ({
  logger = console,
  fetchNews = fetchAllNews
} = {}) => {
  const cleanup = await deleteOldArticles({ logger });
  const fetched = await fetchNews({ logger });

  logger.log('\n💾 Saving articles to database...');
  const { inserted, skipped, invalid, expired } = await saveNewArticles(fetched, {
    logger,
    cutoff: cleanup.cutoff
  });
  const indexed = await indexArticles(inserted, { logger });

  return {
    deleted: cleanup.deleted,
    fetched: fetched.length,
    saved: inserted.length,
    skipped,
    invalid,
    expired,
    indexed
  };
};

module.exports = {
  deleteOldArticles,
  indexArticles,
  protectedArticleIds,
  retentionDays,
  runNewsUpdate,
  saveNewArticles
};

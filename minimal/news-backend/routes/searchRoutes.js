const express = require('express');
const Article = require('../models/Article');
const { createRateLimiter } = require('../middleware/rateLimit');
const {
  MAX_SEARCH_LIMIT,
  isQdrantReachable,
  markQdrantUnavailable,
  search: qdrantSearch
} = require('../services/qdrantService');
const { getTopicsForArticle } = require('../services/topicService');
const { escapeRegex, parsePagination, queryString } = require('../utils/validation');

const router = express.Router();

const searchLimiter = createRateLimiter({ windowMs: 60000, max: 90 });
const ARTICLE_CATEGORIES = Article.schema.path('category').enumValues;
// Semantic results are re-ranked as one fixed-size pool and then paged, so
// every page is a stable slice of the same ordering.
const SEMANTIC_POOL_MAX = Math.min(
  MAX_SEARCH_LIMIT,
  Math.max(Number.parseInt(process.env.SEARCH_POOL_SIZE, 10) || MAX_SEARCH_LIMIT, 50)
);

const TOPIC_HINTS_NE = {
  finance: ['अर्थतन्त्र', 'सेयर', 'नेप्से', 'ब्याजदर', 'मुद्रास्फीति', 'लगानी'],
  sports: ['खेल', 'खेलकुद', 'क्रिकेट', 'फुटबल', 'विश्वकप', 'टी20', 'हार', 'जित'],
  politics: ['राजनीति', 'चुनाव', 'निर्वाचन', 'संसद', 'प्रधानमन्त्री', 'सरकार'],
  art: ['कला', 'फिल्म', 'सिनेमा', 'प्रदर्शनी'],
  culture: ['संस्कृति', 'पर्व', 'उत्सव', 'जात्रा', 'परम्परा'],
  international: ['अन्तर्राष्ट्रिय', 'विश्व', 'विदेश', 'वैदेशिक']
};

const parseDate = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const asNum = Number(v);
  if (!Number.isNaN(asNum)) return new Date(asNum > 1e12 ? asNum : asNum * 1000);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
};

const tokenize = (text) =>
  (text || '')
    .toString()
    .toLowerCase()
    // Keep letters/marks/numbers from any script + whitespace (supports Nepali/Devanagari)
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 2);

const queryTopicsFor = (qText) => {
  const topics = getTopicsForArticle({ title: qText }) || [];
  return Array.isArray(topics) ? topics : [];
};

/**
 * Lightweight cross-lingual boost: for English queries, add a small set of
 * Nepali (Devanagari) hint keywords so English → Nepali retrieval works
 * without running a translation model on every search.
 */
const buildExpandedQuery = (qText, topicList = []) => {
  if (/[\u0900-\u097F]/.test(qText)) return null; // already Nepali/Devanagari
  if (!/[a-z]/i.test(qText)) return null; // not an English query

  const hint = new Set();
  const addHintWords = (words) => {
    for (const w of words || []) {
      const s = String(w || '').trim();
      if (s) hint.add(s);
    }
  };

  // Location/entity hints
  if (/\bnepal\b/i.test(qText)) addHintWords(['नेपाल']);
  if (/\bkathmandu\b/i.test(qText)) addHintWords(['काठमाडौं']);
  if (/\bnepse\b/i.test(qText)) addHintWords(['नेप्से']);

  // Common sports intents (helps queries like "nepal loss match")
  if (/\b(world\s*cup|worldcup)\b/i.test(qText)) addHintWords(['विश्वकप']);
  if (/\b(t20|t-20|ti\s*20)\b/i.test(qText)) addHintWords(['टी20', 'टी २०']);
  if (/\bmatch\b/i.test(qText)) addHintWords(['खेल', 'म्याच']);
  if (/\b(loss|lost|defeat|beaten)\b/i.test(qText)) addHintWords(['हार']);
  if (/\b(win|won|victory)\b/i.test(qText)) addHintWords(['जित']);
  if (/\bpractice\b/i.test(qText)) addHintWords(['अभ्यास']);

  // Finance intents
  if (/\b(inflation)\b/i.test(qText)) addHintWords(['मुद्रास्फीति']);
  if (/\b(interest\s*rate|rate\s*hike|rate\s*cut)\b/i.test(qText)) addHintWords(['ब्याजदर']);
  if (/\b(stock|stocks|share|shares|market)\b/i.test(qText)) addHintWords(['सेयर', 'शेयर', 'बजार']);

  // Politics intents
  if (/\b(election|vote|voting)\b/i.test(qText)) addHintWords(['चुनाव', 'निर्वाचन', 'मतदान']);
  if (/\b(prime\s*minister)\b/i.test(qText)) addHintWords(['प्रधानमन्त्री']);
  if (/\b(parliament)\b/i.test(qText)) addHintWords(['संसद']);

  // Topic-driven hints (from query + selected filters)
  const topicsForHints = new Set([...queryTopicsFor(qText), ...topicList]);
  for (const t of topicsForHints) {
    addHintWords(TOPIC_HINTS_NE[String(t).toLowerCase()] || []);
  }

  if (!hint.size) return null;
  return `${qText}\n${Array.from(hint).slice(0, 20).join(' ')}`;
};

const mergeRanked = (baseResults = [], expandedResults = []) => {
  const merged = new Map();
  const add = (results, label) => {
    for (const r of results || []) {
      const mongoId = r?.payload?.mongoId;
      if (!mongoId) continue;
      const score = typeof r?.score === 'number' ? r.score : 0;
      const cur = merged.get(mongoId) || {
        mongoId,
        bestScore: Number.NEGATIVE_INFINITY,
        baseHit: false,
        expandedHit: false
      };
      if (label === 'base') cur.baseHit = true;
      if (label === 'expanded') cur.expandedHit = true;
      if (score > cur.bestScore) cur.bestScore = score;
      merged.set(mongoId, cur);
    }
  };
  add(baseResults, 'base');
  add(expandedResults, 'expanded');
  return Array.from(merged.values()).sort((a, b) => b.bestScore - a.bestScore);
};

/**
 * Light rerank: Qdrant semantic similarity stays the primary signal (it carries
 * Nepali ↔ English matches); topic intent and keyword overlap add small boosts.
 */
const createReranker = ({ qText, expandedQuery, topicList = [] }) => {
  const qSet = new Set(tokenize(qText));
  const expandedSet = new Set(expandedQuery ? tokenize(expandedQuery) : []);
  const intentTopics = new Set([...queryTopicsFor(qText), ...topicList]);

  const lexicalScore = (doc) => {
    if (!qSet.size && !expandedSet.size) return 0;
    const hay = `${doc.title || ''} ${doc.description || ''}`.toLowerCase();
    const scoreFor = (set) => {
      if (!set.size) return 0;
      let hits = 0;
      for (const t of set) {
        if (hay.includes(t)) hits += 1;
      }
      return hits / set.size; // 0..1
    };
    return Math.max(scoreFor(qSet), scoreFor(expandedSet));
  };

  const topicMatchCount = (doc) => {
    if (!intentTopics.size) return 0;
    let count = 0;
    for (const t of Array.isArray(doc.topics) ? doc.topics : []) {
      if (intentTopics.has(String(t).toLowerCase())) count += 1;
    }
    return count;
  };

  return (doc, hit) => {
    const sem = Number.isFinite(hit.bestScore) ? hit.bestScore : 0;
    const xlingBonus = hit.baseHit && hit.expandedHit ? 0.03 : 0;
    // Weights tuned to keep semantic relevance dominant and help precision a bit.
    return sem + xlingBonus + (0.15 * topicMatchCount(doc)) + (0.05 * lexicalScore(doc));
  };
};

// Map free-text source input ("nasa") to the exact stored source names.
const resolveSources = async (sourceText) => {
  if (!sourceText) return null;
  const names = await Article.distinct('source', {
    source: { $regex: escapeRegex(sourceText), $options: 'i' }
  });
  return names.slice(0, 50);
};

const findArticles = (ids, projection) => {
  const query = Article.find({ _id: { $in: ids } });
  return (projection ? query.select(projection) : query).lean();
};

const semanticSearch = async (
  { qText, topicList, category, sources, fromDate, toDate, offset, limit },
  { searchVectors = qdrantSearch, loadArticles = findArticles } = {}
) => {
  // The pool size must not depend on the page: a larger pool on page 2 could
  // re-rank items from page 1 into it (duplicates) or push others out (gaps).
  const poolSize = SEMANTIC_POOL_MAX;
  if (offset >= poolSize) return { data: [], total: poolSize, hasMore: false };

  const filters = {
    topics: topicList,
    category,
    source: sources && sources.length ? sources : undefined,
    from: fromDate ? fromDate.toISOString() : undefined,
    to: toDate ? toDate.toISOString() : undefined,
    limit: poolSize,
    offset: 0
  };
  const expandedQuery = buildExpandedQuery(qText, topicList);
  const [baseResults, expandedResults] = await Promise.all([
    searchVectors({ query: qText, ...filters }),
    expandedQuery ? searchVectors({ query: expandedQuery, ...filters }) : Promise.resolve([])
  ]);

  // No usable hits (empty or not-yet-indexed collection, or only stale points):
  // let the caller fall back to MongoDB.
  const merged = mergeRanked(baseResults, expandedResults);
  if (!merged.length) return null;

  // Rerank with a light projection, then load full documents for one page.
  const metaDocs = await loadArticles(merged.map((r) => r.mongoId), 'title description topics');
  const metaById = new Map(metaDocs.map((d) => [d._id.toString(), d]));
  const score = createReranker({ qText, expandedQuery, topicList });
  const ranked = merged
    .filter((hit) => metaById.has(hit.mongoId))
    .map((hit) => ({ mongoId: hit.mongoId, score: score(metaById.get(hit.mongoId), hit) }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;

  const pageIds = ranked.slice(offset, offset + limit).map((r) => r.mongoId);
  const pageDocs = pageIds.length ? await loadArticles(pageIds) : [];
  const docById = new Map(pageDocs.map((d) => [d._id.toString(), d]));

  return {
    data: pageIds.map((id) => docById.get(id)).filter(Boolean),
    total: ranked.length,
    hasMore: offset + limit < ranked.length
  };
};

/**
 * GET /api/search
 *
 * Supports:
 * - Semantic search (Qdrant) when `q` is provided and Qdrant is reachable
 * - Pure filtering (MongoDB) when `q` is omitted, or as a fallback
 *
 * Query params:
 * - q: string (optional)
 * - topics: comma-separated list (optional) e.g. "finance,politics"
 * - category: string (optional)
 * - source: string (optional, case-insensitive partial match)
 * - from: ISO date or timestamp (optional)
 * - to: ISO date or timestamp (optional)
 * - page: number (optional, default 1)
 * - limit: number (optional, default 12, max 50)
 */
router.get('/', searchLimiter, async (req, res) => {
  const { page, limit, skip: offset } = parsePagination(req.query);
  const qText = queryString(req.query.q, { maxLength: 300 });
  const category = queryString(req.query.category, { maxLength: 40 });
  const sourceText = queryString(req.query.source, { maxLength: 100 });
  const fromDate = parseDate(queryString(req.query.from, { maxLength: 40 }));
  const toDate = parseDate(queryString(req.query.to, { maxLength: 40 }));
  const topicList = queryString(req.query.topics, { maxLength: 300 })
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);

  const empty = (engine) => res.json({
    success: true,
    engine,
    page,
    limit,
    total: 0,
    count: 0,
    hasMore: false,
    data: []
  });

  if (category && !ARTICLE_CATEGORIES.includes(category)) return empty(qText ? 'qdrant' : 'mongo');

  try {
    const sources = await resolveSources(sourceText);
    if (sources && !sources.length) return empty(qText ? 'qdrant' : 'mongo');

    // ───────────────────────────────────────────────────────────
    // 1) Semantic search via Qdrant
    // ───────────────────────────────────────────────────────────
    if (qText && await isQdrantReachable()) {
      try {
        const result = await semanticSearch({
          qText,
          topicList,
          category: category || undefined,
          sources,
          fromDate,
          toDate,
          offset,
          limit
        });
        if (result) {
          return res.json({
            success: true,
            engine: 'qdrant',
            page,
            limit,
            total: result.total,
            count: result.data.length,
            hasMore: result.hasMore,
            data: result.data
          });
        }
      } catch (error) {
        // Never fail a search because the vector index or embedding model is
        // unavailable; fall through to MongoDB instead.
        if (error?.code !== 'EMBEDDING_UNAVAILABLE') markQdrantUnavailable();
        console.warn(`Semantic search unavailable, using MongoDB fallback: ${error.message}`);
      }
    }

    // ───────────────────────────────────────────────────────────
    // 2) Fallback / Filter-only via MongoDB
    // ───────────────────────────────────────────────────────────
    const mongoQuery = {};
    if (category) mongoQuery.category = category;
    if (sources) mongoQuery.source = { $in: sources };
    if (topicList.length) mongoQuery.topics = { $in: topicList };

    if (fromDate || toDate) {
      mongoQuery.publishedAt = {
        ...(fromDate ? { $gte: fromDate } : {}),
        ...(toDate ? { $lte: toDate } : {})
      };
    }

    if (qText) {
      const re = new RegExp(escapeRegex(qText.slice(0, 100)), 'i');
      mongoQuery.$or = [{ title: re }, { description: re }];
    }

    const [rows, total] = await Promise.all([
      Article.find(mongoQuery)
        .sort({ publishedAt: -1, _id: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      Article.countDocuments(mongoQuery)
    ]);

    return res.json({
      success: true,
      engine: qText ? 'mongo_fallback' : 'mongo',
      page,
      limit,
      total,
      count: rows.length,
      hasMore: offset + rows.length < total,
      data: rows
    });
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({
      success: false,
      error: 'Search is unavailable right now'
    });
  }
});

module.exports = router;
module.exports.buildExpandedQuery = buildExpandedQuery;
module.exports.createReranker = createReranker;
module.exports.mergeRanked = mergeRanked;
module.exports.semanticSearch = semanticSearch;

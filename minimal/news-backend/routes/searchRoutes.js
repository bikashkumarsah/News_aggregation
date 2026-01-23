const express = require('express');
const Article = require('../models/Article');
const { isQdrantReachable, search: qdrantSearch } = require('../services/qdrantService');

const router = express.Router();

/**
 * GET /api/search
 *
 * Supports:
 * - Semantic search (Qdrant) when `q` is provided and Qdrant is reachable
 * - Pure filtering (MongoDB) when `q` is omitted
 *
 * Query params:
 * - q: string (optional)
 * - topics: comma-separated list (optional) e.g. "finance,politics"
 * - category: string (optional)
 * - source: string (optional)
 * - from: ISO date or timestamp (optional)
 * - to: ISO date or timestamp (optional)
 * - page: number (optional, default 1)
 * - limit: number (optional, default 12, max 50)
 */
router.get('/', async (req, res) => {
  const {
    q,
    topics,
    category,
    source,
    from,
    to,
    page = 1,
    limit = 12
  } = req.query;

  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 50);
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (parsedPage - 1) * parsedLimit;

  const topicList = (topics || '')
    .toString()
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const parseDate = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
    const asNum = Number(v);
    if (!Number.isNaN(asNum)) return new Date(asNum > 1e12 ? asNum : asNum * 1000);
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return undefined;
    return d;
  };

  const fromDate = parseDate(from);
  const toDate = parseDate(to);

  try {
    // ───────────────────────────────────────────────────────────
    // 1) Semantic search via Qdrant
    // ───────────────────────────────────────────────────────────
    if (q && q.toString().trim().length > 0) {
      const qdrantOk = await isQdrantReachable();

      if (qdrantOk) {
        const results = await qdrantSearch({
          query: q.toString(),
          topics: topicList,
          category,
          source,
          from: fromDate ? fromDate.toISOString() : undefined,
          to: toDate ? toDate.toISOString() : undefined,
          limit: parsedLimit,
          offset
        });

        const ranked = results
          .map((r) => ({
            mongoId: r?.payload?.mongoId,
            score: typeof r?.score === 'number' ? r.score : 0
          }))
          .filter((r) => Boolean(r.mongoId));

        const ids = ranked.map((r) => r.mongoId);

        // Fetch Mongo articles and preserve Qdrant ranking order
        const docs = await Article.find({ _id: { $in: ids } });
        const byId = new Map(docs.map((d) => [d._id.toString(), d]));
        const ordered = ranked
          .map((r) => {
            const doc = byId.get(r.mongoId);
            if (!doc) return null;
            return { doc, score: r.score };
          })
          .filter(Boolean);

        // Light rerank: prioritize keyword overlap in title/description to improve precision.
        // (Still keeps Qdrant score as tie-breaker.)
        const tokenize = (text) =>
          (text || '')
            .toString()
            .toLowerCase()
            .replace(/[^a-z0-9\\s]/g, ' ')
            .replace(/\\s+/g, ' ')
            .trim()
            .split(' ')
            .filter((t) => t.length > 2);

        const qText = q.toString().trim();
        const qTokens = tokenize(qText);
        const qSet = new Set(qTokens);

        const lexicalScore = (doc) => {
          if (!qTokens.length) return 0;
          const hay = `${doc.title || ''} ${doc.description || ''}`.toLowerCase();
          let hits = 0;
          for (const t of qSet) {
            if (hay.includes(t)) hits += 1;
          }
          return hits / qSet.size; // 0..1
        };

        ordered.sort((a, b) => {
          const la = lexicalScore(a.doc);
          const lb = lexicalScore(b.doc);
          if (lb !== la) return lb - la;
          return (b.score || 0) - (a.score || 0);
        });

        const finalDocs = ordered.map((x) => x.doc);

        return res.json({
          success: true,
          engine: 'qdrant',
          page: parsedPage,
          limit: parsedLimit,
          count: finalDocs.length,
          data: finalDocs
        });
      }
    }

    // ───────────────────────────────────────────────────────────
    // 2) Fallback / Filter-only via MongoDB
    // ───────────────────────────────────────────────────────────
    const mongoQuery = {};
    if (category) mongoQuery.category = category;
    if (source) mongoQuery.source = source;
    if (topicList.length) mongoQuery.topics = { $in: topicList };

    if (fromDate || toDate) {
      mongoQuery.publishedAt = {
        ...(fromDate ? { $gte: fromDate } : {}),
        ...(toDate ? { $lte: toDate } : {})
      };
    }

    if (q && q.toString().trim().length > 0) {
      const needle = q.toString().trim();
      const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      mongoQuery.$or = [{ title: re }, { description: re }];
    }

    const [rows, total] = await Promise.all([
      Article.find(mongoQuery)
        .sort({ publishedAt: -1 })
        .skip(offset)
        .limit(parsedLimit),
      Article.countDocuments(mongoQuery)
    ]);

    return res.json({
      success: true,
      engine: q ? 'mongo_fallback' : 'mongo',
      page: parsedPage,
      limit: parsedLimit,
      total,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;


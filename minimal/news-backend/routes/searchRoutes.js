const express = require('express');
const Article = require('../models/Article');
const { isQdrantReachable, search: qdrantSearch } = require('../services/qdrantService');
const { getTopicsForArticle } = require('../services/topicService');

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
        const qText = q.toString().trim();

        // Fetch more candidates than we show, then rerank down to `parsedLimit`.
        // This improves recall (especially for cross-lingual queries).
        const candidateLimit = Math.min(50, Math.max(parsedLimit * 6, parsedLimit + 20));

        const baseResults = await qdrantSearch({
          query: qText,
          topics: topicList,
          category,
          source,
          from: fromDate ? fromDate.toISOString() : undefined,
          to: toDate ? toDate.toISOString() : undefined,
          limit: candidateLimit,
          offset
        });

        // Lightweight cross-lingual boost:
        // For English queries, add a small set of Nepali (Devanagari) hint keywords and search again.
        // This helps English → Nepali retrieval without running a translation model on every search.
        const hasDevanagari = /[\u0900-\u097F]/.test(qText);
        const hasLatin = /[a-z]/i.test(qText);

        const addHintWords = (set, words) => {
          for (const w of words || []) {
            const s = String(w || '').trim();
            if (s) set.add(s);
          }
        };

        const buildExpandedQuery = () => {
          if (hasDevanagari) return null; // already Nepali/Devanagari
          if (!hasLatin) return null; // not an English query

          const hint = new Set();

          // Location/entity hints
          if (/\bnepal\b/i.test(qText)) addHintWords(hint, ['नेपाल']);
          if (/\bkathmandu\b/i.test(qText)) addHintWords(hint, ['काठमाडौं']);
          if (/\bnepse\b/i.test(qText)) addHintWords(hint, ['नेप्से']);

          // Common sports intents (helps queries like "nepal loss match")
          if (/\b(world\s*cup|worldcup)\b/i.test(qText)) addHintWords(hint, ['विश्वकप']);
          if (/\b(t20|t-20|ti\s*20)\b/i.test(qText)) addHintWords(hint, ['टी20', 'टी २०']);
          if (/\bmatch\b/i.test(qText)) addHintWords(hint, ['खेल', 'म्याच']);
          if (/\b(loss|lost|defeat|beaten)\b/i.test(qText)) addHintWords(hint, ['हार']);
          if (/\b(win|won|victory)\b/i.test(qText)) addHintWords(hint, ['जित']);
          if (/\bpractice\b/i.test(qText)) addHintWords(hint, ['अभ्यास']);

          // Finance intents
          if (/\b(inflation)\b/i.test(qText)) addHintWords(hint, ['मुद्रास्फीति']);
          if (/\b(interest\s*rate|rate\s*hike|rate\s*cut)\b/i.test(qText)) addHintWords(hint, ['ब्याजदर']);
          if (/\b(stock|stocks|share|shares|market)\b/i.test(qText)) addHintWords(hint, ['सेयर', 'शेयर', 'बजार']);

          // Politics intents
          if (/\b(election|vote|voting)\b/i.test(qText)) addHintWords(hint, ['चुनाव', 'निर्वाचन', 'मतदान']);
          if (/\b(prime\s*minister)\b/i.test(qText)) addHintWords(hint, ['प्रधानमन्त्री']);
          if (/\b(parliament)\b/i.test(qText)) addHintWords(hint, ['संसद']);

          // Topic-driven hints (from query + selected filters)
          const queryTopics = getTopicsForArticle({ title: qText }) || [];
          const topicsForHints = Array.from(new Set([...(Array.isArray(queryTopics) ? queryTopics : []), ...topicList]));

          const TOPIC_HINTS_NE = {
            finance: ['अर्थतन्त्र', 'सेयर', 'नेप्से', 'ब्याजदर', 'मुद्रास्फीति', 'लगानी'],
            sports: ['खेल', 'खेलकुद', 'क्रिकेट', 'फुटबल', 'विश्वकप', 'टी20', 'हार', 'जित'],
            politics: ['राजनीति', 'चुनाव', 'निर्वाचन', 'संसद', 'प्रधानमन्त्री', 'सरकार'],
            art: ['कला', 'फिल्म', 'सिनेमा', 'प्रदर्शनी'],
            culture: ['संस्कृति', 'पर्व', 'उत्सव', 'जात्रा', 'परम्परा'],
            international: ['अन्तर्राष्ट्रिय', 'विश्व', 'विदेश', 'वैदेशिक']
          };

          for (const t of topicsForHints) {
            addHintWords(hint, TOPIC_HINTS_NE[String(t).toLowerCase()] || []);
          }

          if (!hint.size) return null;
          return `${qText}\n${Array.from(hint).slice(0, 20).join(' ')}`;
        };

        const expandedQuery = buildExpandedQuery();
        const expandedResults = expandedQuery
          ? await qdrantSearch({
            query: expandedQuery,
            topics: topicList,
            category,
            source,
            from: fromDate ? fromDate.toISOString() : undefined,
            to: toDate ? toDate.toISOString() : undefined,
            limit: candidateLimit,
            offset
          })
          : [];

        const mergeRanked = (arr, label, map) => {
          for (const r of arr || []) {
            const mongoId = r?.payload?.mongoId;
            if (!mongoId) continue;
            const score = typeof r?.score === 'number' ? r.score : 0;
            const cur = map.get(mongoId) || {
              mongoId,
              bestScore: 0,
              baseHit: false,
              expandedHit: false
            };
            if (label === 'base') cur.baseHit = true;
            if (label === 'expanded') cur.expandedHit = true;
            if (score > cur.bestScore) cur.bestScore = score;
            map.set(mongoId, cur);
          }
        };

        const mergedMap = new Map();
        mergeRanked(baseResults, 'base', mergedMap);
        mergeRanked(expandedResults, 'expanded', mergedMap);

        const ranked = Array.from(mergedMap.values())
          .sort((a, b) => (b.bestScore || 0) - (a.bestScore || 0))
          .slice(0, 100); // keep Mongo fetch bounded

        const ids = ranked.map((r) => r.mongoId);

        // Fetch Mongo articles and preserve Qdrant ranking order
        const docs = await Article.find({ _id: { $in: ids } });
        const byId = new Map(docs.map((d) => [d._id.toString(), d]));
        const ordered = ranked
          .map((r) => {
            const doc = byId.get(r.mongoId);
            if (!doc) return null;
            return { doc, score: r.bestScore, baseHit: r.baseHit, expandedHit: r.expandedHit };
          })
          .filter(Boolean);

        // Light rerank:
        // - Keep Qdrant semantic similarity as the primary signal (important for Nepali ↔ English queries)
        // - Add small boosts for topic intent + keyword overlap (helps precision without harming cross-lingual)
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

        const qTokens = tokenize(qText);
        const qSet = new Set(qTokens);
        const expandedTokens = expandedQuery ? tokenize(expandedQuery) : [];
        const expandedSet = new Set(expandedTokens);

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

        // Infer topic intent from the query text itself (sports/finance/politics/etc.)
        const queryTopics = getTopicsForArticle({ title: qText }) || [];
        const intentTopics = new Set([...(Array.isArray(queryTopics) ? queryTopics : []), ...topicList]);

        const topicMatchCount = (doc) => {
          if (!intentTopics.size) return 0;
          const docTopics = Array.isArray(doc.topics) ? doc.topics : [];
          let c = 0;
          for (const t of docTopics) {
            if (intentTopics.has(String(t).toLowerCase())) c += 1;
          }
          return c;
        };

        const combinedScore = (doc, qScore, meta) => {
          const sem = typeof qScore === 'number' ? qScore : 0;
          const lex = lexicalScore(doc); // 0..1
          const topicBoost = topicMatchCount(doc); // small integer
          const xlingBonus = (meta && meta.baseHit && meta.expandedHit) ? 0.03 : 0;

          // Weights tuned to keep semantic relevance dominant and help precision a bit.
          return sem + xlingBonus + (0.15 * topicBoost) + (0.05 * lex);
        };

        ordered.sort((a, b) => {
          const sa = combinedScore(a.doc, a.score, a);
          const sb = combinedScore(b.doc, b.score, b);
          return sb - sa;
        });

        const finalDocs = ordered.slice(0, parsedLimit).map((x) => x.doc);

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


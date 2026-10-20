const crypto = require('crypto');
const express = require('express');
const Article = require('../models/Article');
const { requireAdmin } = require('../middleware/adminAccess');
const { createRateLimiter } = require('../middleware/rateLimit');
const { LruCache, createInFlightDeduper } = require('../utils/cache');
const { isValidObjectId, parsePagination, queryString } = require('../utils/validation');
const { fetchFullContent } = require('../services/contentService');
const { hasDevanagari } = require('../services/languageService');
const { runMbart } = require('../services/mbartService');
const { deleteArticlePoints } = require('../services/qdrantService');
const { summarizeArticle } = require('../services/summaryService');
const {
  articleAudioFileName,
  getOrCreateAudio,
  textAudioFileName
} = require('../services/ttsService');

const router = express.Router();

const ARTICLE_CATEGORIES = Article.schema.path('category').enumValues;
// Nepal-based publishers; `.np` only matches the end of a hostname so hosts
// such as npr.org are not treated as local.
const LOCAL_SOURCE_PATTERN = /(onlinekhabar\.com|kathmandupost\.com|thehimalayantimes\.com|ratopati\.com|setopati\.com|nagariknews\.com|\.np(?=[/:?#]|$))/i;
const MAX_TRANSLATION_CHARS = 5000;
const MAX_TTS_REQUEST_CHARS = 20000;
const MAX_STORED_CONTENT_CHARS = 20000;

// Model-backed endpoints are expensive; throttle per client.
const summarizeLimiter = createRateLimiter({ windowMs: 60000, max: 20 });
const translateLimiter = createRateLimiter({ windowMs: 60000, max: 10 });
const ttsLimiter = createRateLimiter({ windowMs: 60000, max: 20 });

const translationCache = new LruCache({ maxEntries: 200 });
const dedupe = createInFlightDeduper();

const badRequest = (res, error) => res.status(400).json({ success: false, error });
const notFound = (res, error = 'Article not found') => res.status(404).json({ success: false, error });

const serverError = (res, error, context, message = 'Something went wrong. Please try again.') => {
  console.error(`${context} error:`, error?.message || error);
  return res.status(500).json({ success: false, error: message });
};

// Inference failures map to 5xx statuses that tell the client whether a retry
// can help, without leaking Python stack traces.
const inferenceError = (res, error, context, message) => {
  console.error(`${context} error:`, error?.message || error);
  if (error?.code === 'WORKER_BUSY') {
    return res.status(503).json({ success: false, error: 'The model is busy. Please try again shortly.' });
  }
  if (error?.code === 'WORKER_TIMEOUT') {
    return res.status(504).json({ success: false, error: `${message} (timed out)` });
  }
  return res.status(502).json({ success: false, error: message });
};

const shuffle = (items) => {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

// 1. Get all articles or filter by category
router.get('/news', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const category = queryString(req.query.category, { maxLength: 40 });

    const query = {};
    if (category && category !== 'all') {
      if (category === 'local') {
        query.url = { $regex: LOCAL_SOURCE_PATTERN };
      } else if (ARTICLE_CATEGORIES.includes(category)) {
        query.category = category;
      } else {
        return res.json({ success: true, count: 0, total: 0, page, hasMore: false, data: [] });
      }
    }

    // _id breaks publishedAt ties so pages never overlap or skip articles.
    const [articles, total] = await Promise.all([
      Article.find(query)
        .sort({ publishedAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Article.countDocuments(query)
    ]);

    // Shuffle within the page to provide variety from different sites
    const shuffledArticles = shuffle(articles);

    return res.json({
      success: true,
      count: shuffledArticles.length,
      total,
      page,
      hasMore: skip + articles.length < total,
      data: shuffledArticles
    });
  } catch (error) {
    return serverError(res, error, 'List articles');
  }
});

// 2. Get single article by ID
router.get('/news/:id', async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) return badRequest(res, 'Invalid article id');

  try {
    const article = await Article.findById(id).lean();
    if (!article) return notFound(res);
    return res.json({ success: true, data: article });
  } catch (error) {
    return serverError(res, error, 'Load article');
  }
});

// 3. Add new article (admin only)
router.post('/news', requireAdmin, async (req, res) => {
  try {
    const article = await Article.create(req.body);
    return res.status(201).json({ success: true, data: article });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, error: 'An article with this URL already exists' });
    }
    if (error?.name === 'ValidationError') return badRequest(res, error.message);
    return serverError(res, error, 'Create article');
  }
});

// 4. Add multiple articles (admin only)
router.post('/news/bulk', requireAdmin, async (req, res) => {
  if (!Array.isArray(req.body) || !req.body.length) {
    return badRequest(res, 'Request body must be a non-empty array of articles');
  }
  if (req.body.length > 500) return badRequest(res, 'At most 500 articles per request');

  try {
    const articles = await Article.insertMany(req.body, { ordered: false });
    return res.status(201).json({ success: true, count: articles.length, data: articles });
  } catch (error) {
    // With ordered:false valid documents are still inserted; report them.
    const inserted = error?.insertedDocs || [];
    if (error?.name === 'MongoBulkWriteError' || error?.code === 11000 || inserted.length) {
      return res.status(207).json({
        success: inserted.length > 0,
        count: inserted.length,
        data: inserted,
        error: 'Some articles were rejected (duplicates or invalid fields)'
      });
    }
    if (error?.name === 'ValidationError') return badRequest(res, error.message);
    return serverError(res, error, 'Bulk create articles');
  }
});

const generateAndStoreSummary = async (article) => {
  let fullContent = article.content || '';
  const updates = {};

  if (fullContent.length < 600) {
    console.log(`🔍 Content too short (${fullContent.length} chars), fetching full article...`);
    const scraped = await fetchFullContent(article.url);
    if (scraped && scraped.length > fullContent.length) {
      fullContent = scraped.slice(0, MAX_STORED_CONTENT_CHARS);
      updates.content = fullContent;
    }
  }

  const summary = await summarizeArticle({ article, fullContent });
  if (!summary) throw new Error('Summarizer returned no text');
  updates.summary = summary;

  // updateOne avoids re-validating legacy documents that predate the schema.
  await Article.updateOne({ _id: article._id }, { $set: updates });
  return summary;
};

// 5. Summarize article using API first, then fall back to local mBART
router.post('/news/:id/summarize', summarizeLimiter, async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) return badRequest(res, 'Invalid article id');

  let article;
  try {
    article = await Article.findById(id).lean();
  } catch (error) {
    return serverError(res, error, 'Load article for summary');
  }
  if (!article) return notFound(res);
  if (article.summary) return res.json({ success: true, data: article.summary });

  try {
    // Concurrent clicks on the same article share one generation.
    const summary = await dedupe(`summary:${id}`, () => generateAndStoreSummary(article));
    return res.json({ success: true, data: summary });
  } catch (error) {
    return inferenceError(res, error, 'Summarize', 'Could not generate a summary right now');
  }
});

// Translate arbitrary English text to Nepali using the fine-tuned mBART model.
// POST /api/translate  { "text": "..." }
router.post('/translate', translateLimiter, async (req, res) => {
  const raw = typeof req.body?.text === 'string' ? req.body.text : '';
  const text = raw.trim().slice(0, MAX_TRANSLATION_CHARS);
  if (!text) return badRequest(res, 'Missing "text" in request body');

  const key = sha256(text);
  const cached = translationCache.get(key);
  if (cached) return res.json({ success: true, data: cached, cached: true });

  try {
    const translated = await dedupe(`translate:${key}`, async () => {
      const result = await runMbart({
        task: 'translate_en_to_ne',
        text,
        maxNewTokens: 256,
        maxInputTokens: 1024
      });
      if (result) translationCache.set(key, result);
      return result;
    });
    return res.json({ success: true, data: translated });
  } catch (error) {
    return inferenceError(res, error, 'Translate', 'Translation is unavailable right now');
  }
});

// 6. Generate TTS for article summary
router.post('/news/:id/tts', ttsLimiter, async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) return badRequest(res, 'Invalid article id');

  try {
    const article = await Article.findById(id).select('title summary').lean();
    if (!article) return notFound(res);
    if (!article.summary) {
      return badRequest(res, 'Summary not generated yet. Please summarize first.');
    }

    // The voice follows the script of the text being read, not the source URL.
    const nepali = hasDevanagari(article.summary);
    const { audioUrl } = await getOrCreateAudio({
      text: article.summary,
      fileName: articleAudioFileName(article._id, article.summary, nepali),
      nepali
    });
    return res.json({ success: true, audioUrl });
  } catch (error) {
    return inferenceError(res, error, 'Article TTS', 'Could not generate audio right now');
  }
});

// 6b. Generate TTS for arbitrary text (used for translation playback)
// POST /api/tts  { "text": "..." }
router.post('/tts', ttsLimiter, async (req, res) => {
  const raw = typeof req.body?.text === 'string' ? req.body.text : '';
  const text = raw.trim();
  if (!text) return badRequest(res, 'Missing "text" in request body');
  if (text.length > MAX_TTS_REQUEST_CHARS) {
    return res.status(413).json({ success: false, error: 'Text is too long for speech synthesis' });
  }

  try {
    const nepali = hasDevanagari(text);
    const { audioUrl } = await getOrCreateAudio({
      text,
      fileName: textAudioFileName(text, nepali),
      nepali
    });
    return res.json({ success: true, audioUrl });
  } catch (error) {
    return inferenceError(res, error, 'Text TTS', 'Could not generate audio right now');
  }
});

// 7. Delete article by ID (admin only)
router.delete('/news/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) return badRequest(res, 'Invalid article id');

  try {
    const article = await Article.findByIdAndDelete(id);
    if (!article) return notFound(res);

    deleteArticlePoints([id]).catch((error) => {
      console.warn(`Could not remove article ${id} from Qdrant: ${error.message}`);
    });

    return res.json({ success: true, message: 'Article deleted' });
  } catch (error) {
    return serverError(res, error, 'Delete article');
  }
});

// 8. Get categories with article count
router.get('/categories', async (req, res) => {
  try {
    const categories = await Article.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    return res.json({ success: true, data: categories });
  } catch (error) {
    return serverError(res, error, 'List categories');
  }
});

module.exports = router;
module.exports.LOCAL_SOURCE_PATTERN = LOCAL_SOURCE_PATTERN;

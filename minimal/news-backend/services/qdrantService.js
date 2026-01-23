const fetch = require('node-fetch');
const { getTopicsForArticle } = require('./topicService');

/**
 * Qdrant integration (REST).
 *
 * This implementation supports a real multilingual embedding model (English + Nepali)
 * via Transformers.js, with a safe fallback to hashing vectors.
 */

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'khabar_articles';
const VECTOR_SIZE = parseInt(process.env.QDRANT_VECTOR_SIZE || '384', 10);
const DISTANCE = process.env.QDRANT_DISTANCE || 'Cosine';

const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || 'transformers').toLowerCase();

const requestJson = async (method, path, body) => {
  const url = `${QDRANT_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const detail = json?.status?.error || json?.message || text || `${res.status} ${res.statusText}`;
    const err = new Error(`Qdrant ${method} ${path} failed: ${detail}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }

  return json;
};

const isQdrantReachable = async () => {
  try {
    await requestJson('GET', '/readyz');
    return true;
  } catch {
    return false;
  }
};

const ensureCollection = async () => {
  // Create collection if missing
  try {
    await requestJson('GET', `/collections/${QDRANT_COLLECTION}`);
    return;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  await requestJson('PUT', `/collections/${QDRANT_COLLECTION}`, {
    vectors: { size: VECTOR_SIZE, distance: DISTANCE }
  });
};

// ───────────────────────────────────────────────────────────────
// Local vectorizers (hash fallback + real embeddings)
// ───────────────────────────────────────────────────────────────

const fnv1a32 = (str) => {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
};

const tokenize = (text) =>
  (text || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 2);

const l2Normalize = (vec) => {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (!norm) return vec;
  return vec.map((v) => v / norm);
};

const textToHashVector = (text, dim = VECTOR_SIZE) => {
  const tokens = tokenize(text);
  const vec = new Array(dim).fill(0);

  // Unigrams
  for (const tok of tokens) {
    const h = fnv1a32(tok);
    const idx = h % dim;
    vec[idx] += 1;
  }

  // Bigrams (helpful for phrases like "interest rate")
  for (let i = 0; i < tokens.length - 1; i++) {
    const bi = `${tokens[i]}_${tokens[i + 1]}`;
    const h = fnv1a32(bi);
    const idx = h % dim;
    vec[idx] += 0.5;
  }

  return l2Normalize(vec);
};

const textToVector = async (text) => {
  if (EMBEDDING_PROVIDER === 'transformers') {
    try {
      const { embedText } = require('./embeddingService');
      const vec = await embedText(text);

      if (vec.length !== VECTOR_SIZE) {
        throw new Error(
          `Embedding dimension mismatch: got ${vec.length}, expected ${VECTOR_SIZE}. ` +
          `Set QDRANT_VECTOR_SIZE to ${vec.length} (and recreate the Qdrant collection) or use a 384-dim model.`
        );
      }

      return vec;
    } catch (err) {
      // If transformers isn't installed / model can't load, fall back to hashing
      console.warn(`⚠️ Embedding provider "transformers" unavailable (${err.message}). Falling back to hashing vectors.`);
      return textToHashVector(text, VECTOR_SIZE);
    }
  }

  // Explicit fallback
  return textToHashVector(text, VECTOR_SIZE);
};

// Qdrant PointId supports u64 or UUID. Mongo ObjectId is 24 hex chars.
// We convert it into a stable UUID-like string by padding with zeros.
const objectIdToUuid = (mongoId) => {
  const hex = mongoId.toString();
  const padded32 = (hex + '00000000').slice(0, 32);
  return (
    padded32.slice(0, 8) +
    '-' +
    padded32.slice(8, 12) +
    '-' +
    padded32.slice(12, 16) +
    '-' +
    padded32.slice(16, 20) +
    '-' +
    padded32.slice(20)
  );
};

const buildArticleText = (article) => {
  // Weight title and description higher by repeating them
  const title = article?.title || '';
  const desc = article?.description || '';
  const content = article?.content || '';
  return `${title}\n${title}\n${desc}\n${desc}\n${content}`;
};

const buildPoint = async (article) => {
  const mongoId = article._id.toString();
  const id = objectIdToUuid(mongoId);
  const vector = await textToVector(buildArticleText(article));
  const topics = Array.isArray(article.topics) && article.topics.length > 0
    ? article.topics
    : getTopicsForArticle(article);
  const publishedAtSec = Math.floor(new Date(article.publishedAt || Date.now()).getTime() / 1000);

  const payload = {
    mongoId,
    title: article.title,
    source: article.source,
    category: article.category,
    topics,
    publishedAt: publishedAtSec,
    url: article.url
  };

  return { id, vector, payload };
};

const upsertArticles = async (articles, { wait = true } = {}) => {
  await ensureCollection();
  const points = await Promise.all(articles.map((a) => buildPoint(a)));
  await requestJson('PUT', `/collections/${QDRANT_COLLECTION}/points?wait=${wait ? 'true' : 'false'}`, {
    points
  });
  return points.length;
};

const search = async ({
  query,
  topics,
  category,
  source,
  from, // ISO date or ms or seconds
  to,
  limit = 10,
  offset = 0
}) => {
  await ensureCollection();

  const vector = await textToVector(query);

  const must = [];
  if (category) must.push({ key: 'category', match: { value: category } });
  if (source) must.push({ key: 'source', match: { value: source } });
  if (topics && topics.length > 0) must.push({ key: 'topics', match: { any: topics } });

  const parseToSeconds = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return undefined;
    return Math.floor(d.getTime() / 1000);
  };

  const gte = parseToSeconds(from);
  const lte = parseToSeconds(to);
  if (gte !== undefined || lte !== undefined) {
    must.push({
      key: 'publishedAt',
      range: {
        ...(gte !== undefined ? { gte } : {}),
        ...(lte !== undefined ? { lte } : {})
      }
    });
  }

  const body = {
    vector,
    limit: Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50),
    offset: Math.max(parseInt(offset, 10) || 0, 0),
    with_payload: true,
    ...(must.length ? { filter: { must } } : {})
  };

  const res = await requestJson('POST', `/collections/${QDRANT_COLLECTION}/points/search`, body);
  return res.result || [];
};

module.exports = {
  QDRANT_URL,
  QDRANT_COLLECTION,
  VECTOR_SIZE,
  EMBEDDING_PROVIDER,
  isQdrantReachable,
  ensureCollection,
  upsertArticles,
  search
};


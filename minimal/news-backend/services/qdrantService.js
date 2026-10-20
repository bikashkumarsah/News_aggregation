const fetch = require('node-fetch');
const { DEFAULT_MODEL, embedText } = require('./embeddingService');
const { getTopicsForArticleEnhanced } = require('./topicService');

/**
 * Qdrant integration (REST).
 *
 * Vectors come from the multilingual embedding model (EMBEDDING_PROVIDER=transformers,
 * the default) or from a local hashing vectorizer (EMBEDDING_PROVIDER=hash). The two
 * vector spaces are incompatible, so each provider uses its own collection and a
 * model failure is reported instead of silently switching to hash vectors.
 */

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const QDRANT_URL = (process.env.QDRANT_URL || 'http://localhost:6333').replace(/\/+$/, '');
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || '';
const REQUEST_TIMEOUT_MS = positiveInt(process.env.QDRANT_TIMEOUT_MS, 10000);
const HEALTH_TTL_MS = positiveInt(process.env.QDRANT_HEALTH_TTL_MS, 15000);
const MAX_SEARCH_LIMIT = 200;

const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || 'transformers').toLowerCase();
const USE_MODEL_EMBEDDINGS = EMBEDDING_PROVIDER === 'transformers';

const modelToTag = (modelName) => {
  const raw = (modelName || '').toString();
  const base = raw.includes('/') ? raw.split('/').pop() : raw;
  const tag = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return tag || 'embeddings';
};

const guessVectorSizeFromModel = (modelName) => {
  const m = (modelName || '').toString().toLowerCase();
  if (m.includes('distiluse-base-multilingual-cased-v2')) return 768;
  if (m.includes('multilingual-e5-small')) return 384;
  if (m.includes('paraphrase-multilingual-minilm-l12-v2')) return 384;
  return undefined;
};

const envVectorSize = Number.parseInt(process.env.QDRANT_VECTOR_SIZE || '', 10);

// Prefer the embedding model's true output dimension; tolerate stale env configs.
const VECTOR_SIZE = (() => {
  const configured = Number.isFinite(envVectorSize) && envVectorSize > 0 ? envVectorSize : undefined;
  if (!USE_MODEL_EMBEDDINGS) return configured || 384;

  const modelSize = guessVectorSizeFromModel(DEFAULT_MODEL);
  if (configured && modelSize && configured !== modelSize) {
    console.warn(
      `⚠️ QDRANT_VECTOR_SIZE=${configured} does not match EMBEDDING_MODEL (${DEFAULT_MODEL}) which is ${modelSize}d. ` +
      `Using ${modelSize} to match the model.`
    );
    return modelSize;
  }
  return configured || modelSize || 384;
})();

const VECTOR_TAG = USE_MODEL_EMBEDDINGS ? modelToTag(DEFAULT_MODEL) : 'hash';
const DEFAULT_COLLECTION = `khabar_articles_${VECTOR_TAG}_${VECTOR_SIZE}`;
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || DEFAULT_COLLECTION;
const DISTANCE = process.env.QDRANT_DISTANCE || 'Cosine';
const collectionPath = `/collections/${encodeURIComponent(QDRANT_COLLECTION)}`;

const requestJson = async (method, path, body, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  let text;
  try {
    res = await fetch(`${QDRANT_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(QDRANT_API_KEY ? { 'api-key': QDRANT_API_KEY } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    text = await res.text();
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Qdrant ${method} ${path} timed out after ${timeoutMs} ms`);
      timeoutError.code = 'QDRANT_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

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

// Health is cached briefly so a busy search endpoint does not add a /readyz
// round trip to every request.
let health = { ok: false, checkedAt: 0 };
let healthCheck = null;

const isQdrantReachable = async ({ force = false } = {}) => {
  if (!force && health.checkedAt && Date.now() - health.checkedAt < HEALTH_TTL_MS) {
    return health.ok;
  }
  if (!healthCheck) {
    healthCheck = requestJson('GET', '/readyz', undefined, { timeoutMs: 2000 })
      .then(() => true, () => false)
      .then((ok) => {
        health = { ok, checkedAt: Date.now() };
        healthCheck = null;
        return ok;
      });
  }
  return healthCheck;
};

const markQdrantUnavailable = () => {
  health = { ok: false, checkedAt: Date.now() };
};

const ensureCollectionUncached = async () => {
  try {
    const info = await requestJson('GET', collectionPath);

    // Validate the existing vector size matches our configured size (prevents confusing runtime errors).
    const vectors = info?.result?.config?.params?.vectors;
    let existingSize;
    if (typeof vectors?.size === 'number') existingSize = vectors.size;
    else if (vectors && typeof vectors === 'object') {
      const first = Object.values(vectors)[0];
      if (typeof first?.size === 'number') existingSize = first.size;
    }

    if (existingSize && existingSize !== VECTOR_SIZE) {
      throw new Error(
        `Qdrant collection "${QDRANT_COLLECTION}" has vector size ${existingSize}, but this app is configured for ${VECTOR_SIZE}. ` +
        `Use a fresh collection (recommended) or delete/recreate the collection, then reindex.`
      );
    }
    return;
  } catch (err) {
    if (err.status !== 404) throw err;
  }

  await requestJson('PUT', collectionPath, {
    vectors: { size: VECTOR_SIZE, distance: DISTANCE }
  });
};

let collectionReady = null;

// The collection check runs once per process (and again after a failure).
const ensureCollection = async () => {
  if (!collectionReady) {
    collectionReady = ensureCollectionUncached().catch((error) => {
      collectionReady = null;
      throw error;
    });
  }
  return collectionReady;
};

// ───────────────────────────────────────────────────────────────
// Local vectorizers (hash vectors + real embeddings)
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
    // Keep letters/marks/numbers from any script + whitespace (supports Nepali/Devanagari)
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
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

const textToVector = async (text, opts = {}) => {
  if (!USE_MODEL_EMBEDDINGS) return textToHashVector(text, VECTOR_SIZE);

  const vec = await embedText(text, opts);
  if (vec.length !== VECTOR_SIZE) {
    throw new Error(
      `Embedding dimension mismatch: got ${vec.length}, expected ${VECTOR_SIZE}. ` +
      `Set QDRANT_VECTOR_SIZE to ${vec.length} (and recreate the Qdrant collection) or switch EMBEDDING_MODEL to a matching-dimension model.`
    );
  }
  return vec;
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
  const vector = await textToVector(buildArticleText(article), { role: 'passage' });
  // Semantic topic centroids live in the model's vector space; hash vectors
  // cannot be compared against them.
  const topics = Array.isArray(article.topics) && article.topics.length > 0
    ? article.topics
    : await getTopicsForArticleEnhanced(article, USE_MODEL_EMBEDDINGS ? { vector } : {});
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
  if (!articles?.length) return 0;
  await ensureCollection();
  const points = await Promise.all(articles.map((a) => buildPoint(a)));
  await requestJson('PUT', `${collectionPath}/points?wait=${wait ? 'true' : 'false'}`, {
    points
  });
  return points.length;
};

const parseToSeconds = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return Math.floor(d.getTime() / 1000);
};

const search = async ({
  query,
  vector: precomputedVector,
  topics,
  category,
  source,
  from, // ISO date or ms or seconds
  to,
  excludeMongoIds,
  limit = 10,
  offset = 0
}) => {
  await ensureCollection();

  const vector = Array.isArray(precomputedVector) && precomputedVector.length
    ? precomputedVector
    : await textToVector(query, { role: 'query' });

  const must = [];
  if (category) {
    if (Array.isArray(category)) must.push({ key: 'category', match: { any: category } });
    else must.push({ key: 'category', match: { value: category } });
  }
  if (source) {
    if (Array.isArray(source)) must.push({ key: 'source', match: { any: source } });
    else must.push({ key: 'source', match: { value: source } });
  }
  if (topics && topics.length > 0) must.push({ key: 'topics', match: { any: topics } });

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

  const must_not = [];
  if (excludeMongoIds && excludeMongoIds.length > 0) {
    // Exclude already-read / already-sent articles
    must_not.push({ key: 'mongoId', match: { any: excludeMongoIds } });
  }

  const body = {
    vector,
    limit: Math.min(Math.max(parseInt(limit, 10) || 10, 1), MAX_SEARCH_LIMIT),
    offset: Math.max(parseInt(offset, 10) || 0, 0),
    with_payload: true,
    ...((must.length || must_not.length)
      ? { filter: { ...(must.length ? { must } : {}), ...(must_not.length ? { must_not } : {}) } }
      : {})
  };

  const res = await requestJson('POST', `${collectionPath}/points/search`, body);
  return res.result || [];
};

/**
 * Fetch stored article vectors by Mongo id (no re-embedding needed).
 * @returns {Promise<Map<string, number[]>>}
 */
const retrieveArticleVectors = async (mongoIds = []) => {
  const ids = Array.from(new Set(mongoIds.map(String))).filter(Boolean);
  if (!ids.length) return new Map();
  await ensureCollection();
  const res = await requestJson('POST', `${collectionPath}/points`, {
    ids: ids.map(objectIdToUuid),
    with_payload: ['mongoId'],
    with_vector: true
  });
  const vectors = new Map();
  for (const point of res.result || []) {
    const mongoId = point?.payload?.mongoId;
    if (mongoId && Array.isArray(point.vector) && point.vector.length === VECTOR_SIZE) {
      vectors.set(mongoId, point.vector);
    }
  }
  return vectors;
};

const deleteArticlePoints = async (mongoIds = [], { wait = false } = {}) => {
  const ids = Array.from(new Set(mongoIds.map(String))).filter(Boolean);
  if (!ids.length) return 0;
  try {
    await requestJson('POST', `${collectionPath}/points/delete?wait=${wait ? 'true' : 'false'}`, {
      points: ids.map(objectIdToUuid)
    });
  } catch (error) {
    if (error.status === 404) return 0;
    throw error;
  }
  return ids.length;
};

/**
 * Walk the collection and delete points whose article no longer exists.
 * @param {(mongoIds: string[]) => Promise<Set<string>>} findExistingIds
 */
const pruneOrphanPoints = async (findExistingIds, { batchSize = 256 } = {}) => {
  let offset = null;
  let scanned = 0;
  let removed = 0;
  do {
    const res = await requestJson('POST', `${collectionPath}/points/scroll`, {
      limit: batchSize,
      with_payload: ['mongoId'],
      with_vector: false,
      ...(offset !== null ? { offset } : {})
    });
    const points = res?.result?.points || [];
    offset = res?.result?.next_page_offset ?? null;
    scanned += points.length;

    const mongoIds = points.map((point) => point?.payload?.mongoId).filter(Boolean);
    const existing = await findExistingIds(mongoIds);
    const orphanIds = points
      .filter((point) => !point?.payload?.mongoId || !existing.has(point.payload.mongoId))
      .map((point) => point.id);
    if (orphanIds.length) {
      await requestJson('POST', `${collectionPath}/points/delete?wait=true`, { points: orphanIds });
      removed += orphanIds.length;
    }
  } while (offset !== null);
  return { scanned, removed };
};

module.exports = {
  DEFAULT_COLLECTION,
  EMBEDDING_PROVIDER,
  MAX_SEARCH_LIMIT,
  QDRANT_COLLECTION,
  QDRANT_URL,
  USE_MODEL_EMBEDDINGS,
  VECTOR_SIZE,
  buildArticleText,
  deleteArticlePoints,
  ensureCollection,
  isQdrantReachable,
  markQdrantUnavailable,
  objectIdToUuid,
  pruneOrphanPoints,
  retrieveArticleVectors,
  search,
  textToHashVector,
  textToVector,
  upsertArticles
};

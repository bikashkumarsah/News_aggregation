/**
 * Real text embeddings (multilingual) for semantic search.
 *
 * Provider: Transformers.js (runs locally, downloads model weights on first run).
 * Default model: distiluse-base-multilingual-cased-v2 (768 dims, multilingual incl. Nepali)
 *
 * Notes:
 * - Uses dynamic import because @xenova/transformers is ESM.
 * - A failed model load is retried after a cooldown instead of being cached
 *   forever, and callers receive an EmbeddingUnavailableError they can
 *   handle (search falls back to MongoDB).
 * - Query embeddings are memoized, so paging through results or repeating a
 *   popular search does not re-run the model.
 */

const { LruCache } = require('../utils/cache');

const DEFAULT_MODEL = process.env.EMBEDDING_MODEL || 'Xenova/distiluse-base-multilingual-cased-v2';

const positiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const RETRY_COOLDOWN_MS = positiveInt(process.env.EMBEDDING_RETRY_COOLDOWN_MS, 60000);

class EmbeddingUnavailableError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = 'EmbeddingUnavailableError';
        this.code = 'EMBEDDING_UNAVAILABLE';
        this.cause = cause;
    }
}

let extractorPromise = null;
let lastFailure = null;
const queryCache = new LruCache({
    maxEntries: positiveInt(process.env.EMBEDDING_QUERY_CACHE_SIZE, 256)
});

const unavailable = (error) => (
    error instanceof EmbeddingUnavailableError
        ? error
        : new EmbeddingUnavailableError(
            `Embedding model ${DEFAULT_MODEL} is unavailable: ${error?.message || error}`,
            error
        )
);

const loadExtractor = () => {
    const promise = (async () => {
        const { pipeline } = await import('@xenova/transformers');

        // quantized: true reduces memory/size and is usually fine for retrieval
        return pipeline('feature-extraction', DEFAULT_MODEL, {
            quantized: true
        });
    })();

    promise.then(() => {
        lastFailure = null;
    }, (error) => {
        if (extractorPromise === promise) extractorPromise = null;
        lastFailure = { error, at: Date.now() };
        console.warn(`⚠️ Embedding model ${DEFAULT_MODEL} failed to load: ${error.message}`);
    });
    return promise;
};

const getExtractor = async () => {
    if (!extractorPromise) {
        if (lastFailure && Date.now() - lastFailure.at < RETRY_COOLDOWN_MS) {
            throw unavailable(lastFailure.error);
        }
        extractorPromise = loadExtractor();
    }

    try {
        return await extractorPromise;
    } catch (error) {
        throw unavailable(error);
    }
};

const isE5Model = (modelName) => {
    const m = (modelName || '').toLowerCase();
    return m.includes('e5');
};

const prepareText = (text, role = 'passage') => {
    // E5 models are trained with an instruction prefix.
    // See: https://github.com/microsoft/unilm/tree/master/e5
    if (isE5Model(DEFAULT_MODEL)) {
        if (role === 'query') return `query: ${text || ''}`;
        return `passage: ${text || ''}`;
    }
    return text || '';
};

/**
 * Embed a single string into a float vector.
 * @param {string} text
 * @param {{role?: 'query'|'passage'}} [opts]
 * @returns {Promise<number[]>}
 */
const embedText = async (text, opts = {}) => {
    const role = opts.role || 'passage';
    const prepared = prepareText(text, role);

    const cacheKey = role === 'query' ? prepared : null;
    if (cacheKey !== null) {
        const cached = queryCache.get(cacheKey);
        if (cached) return cached.slice();
    }

    const extractor = await getExtractor();
    const out = await extractor(prepared, { pooling: 'mean', normalize: true });

    // transformers.js returns a Tensor-like object with `.data` (TypedArray)
    const data = out?.data;
    if (!data || typeof data.length !== 'number') {
        throw new Error('Embedding model returned no vector data');
    }

    const vector = Array.from(data);
    if (cacheKey !== null) queryCache.set(cacheKey, vector.slice());
    return vector;
};

module.exports = {
    DEFAULT_MODEL,
    EmbeddingUnavailableError,
    embedText,
    prepareText,
    isE5Model
};

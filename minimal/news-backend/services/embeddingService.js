/**
 * Real text embeddings (multilingual) for semantic search.
 *
 * Provider: Transformers.js (runs locally, downloads model weights on first run).
 * Default model: distiluse-base-multilingual-cased-v2 (768 dims, multilingual incl. Nepali)
 *
 * Notes:
 * - This module is optional: if the dependency isn't installed, callers can fall back.
 * - Uses dynamic import because @xenova/transformers is ESM.
 */

const DEFAULT_MODEL = process.env.EMBEDDING_MODEL || 'Xenova/distiluse-base-multilingual-cased-v2';

let extractorPromise = null;

const getExtractor = async () => {
    if (!extractorPromise) {
        extractorPromise = (async () => {
            const { pipeline } = await import('@xenova/transformers');

            // quantized: true reduces memory/size and is usually fine for retrieval
            const extractor = await pipeline('feature-extraction', DEFAULT_MODEL, {
                quantized: true
            });

            return extractor;
        })();
    }

    return extractorPromise;
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
    const extractor = await getExtractor();
    const prepared = prepareText(text, opts.role || 'passage');
    const out = await extractor(prepared, { pooling: 'mean', normalize: true });

    // transformers.js returns a Tensor-like object with `.data` (TypedArray)
    const data = out?.data;
    if (!data || typeof data.length !== 'number') {
        throw new Error('Embedding model returned no vector data');
    }

    return Array.from(data);
};

module.exports = {
    embedText,
    prepareText,
    isE5Model,
    DEFAULT_MODEL
};


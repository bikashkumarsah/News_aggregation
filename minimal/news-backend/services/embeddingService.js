/**
 * Real text embeddings (multilingual) for semantic search.
 *
 * Provider: Transformers.js (runs locally, downloads model weights on first run).
 * Model: paraphrase-multilingual-MiniLM-L12-v2 (384 dims, multilingual incl. Nepali)
 *
 * Notes:
 * - This module is optional: if the dependency isn't installed, callers can fall back.
 * - Uses dynamic import because @xenova/transformers is ESM.
 */

const DEFAULT_MODEL = process.env.EMBEDDING_MODEL || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

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

/**
 * Embed a single string into a float vector.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
const embedText = async (text) => {
    const extractor = await getExtractor();
    const out = await extractor(text || '', { pooling: 'mean', normalize: true });

    // transformers.js returns a Tensor-like object with `.data` (TypedArray)
    const data = out?.data;
    if (!data || typeof data.length !== 'number') {
        throw new Error('Embedding model returned no vector data');
    }

    return Array.from(data);
};

module.exports = {
    embedText,
    DEFAULT_MODEL
};


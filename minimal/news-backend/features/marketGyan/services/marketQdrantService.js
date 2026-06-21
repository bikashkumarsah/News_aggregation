const crypto = require('crypto');
const fetch = require('node-fetch');
const MarketDocument = require('../models/MarketDocument');
const { marketGyanConfig } = require('../config');
const { embedText } = require('../../../services/embeddingService');
const { cleanText } = require('./textService');
const { splitNumberedSentences } = require('./sentenceService');

const DEFAULT_LIMIT = 8;

const chunkText = (value, {
    size = marketGyanConfig.qdrantChunkSize,
    overlap = marketGyanConfig.qdrantChunkOverlap
} = {}) => {
    const text = cleanText(value);
    if (!text) return [];
    if (text.length <= size) return [text];

    const chunks = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + size, text.length);
        if (end < text.length) {
            const boundary = text.lastIndexOf(' ', end);
            if (boundary > start + Math.floor(size * 0.6)) end = boundary;
        }
        chunks.push(text.slice(start, end).trim());
        if (end >= text.length) break;
        start = Math.max(end - overlap, start + 1);
    }
    return chunks.filter(Boolean);
};

const stablePointId = (documentId, chunkIndex) => {
    const hex = crypto.createHash('sha256')
        .update(`${documentId}:${chunkIndex}`)
        .digest('hex')
        .slice(0, 32);
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20)
    ].join('-');
};

const documentText = (document) => cleanText(
    document.text?.cleaned
    || document.text?.original
    || document.article?.content
    || document.article?.description
);

const sentencesForChunk = (chunk, sentences, chunkIndex = 0) => {
    const normalizedChunk = cleanText(chunk);
    const matches = (sentences || []).filter((sentence) => {
        const sentenceText = cleanText(sentence.text);
        return sentenceText && normalizedChunk.includes(sentenceText);
    });
    if (matches.length) return matches;
    return splitNumberedSentences(normalizedChunk, { limit: 20 }).map((sentence) => ({
        ...sentence,
        id: `C${chunkIndex + 1}${sentence.id}`
    }));
};

const buildChunkPayloads = (document, options) => {
    const text = documentText(document);
    const chunks = chunkText(text, options);
    const documentId = document._id.toString();
    const sourcePublishedAt = document.source?.publishedAt
        ? new Date(document.source.publishedAt)
        : null;
    const sentences = splitNumberedSentences(text, { limit: 120 });
    return chunks.map((text, chunkIndex) => {
        const chunkSentences = sentencesForChunk(text, sentences, chunkIndex);
        const chunkId = stablePointId(documentId, chunkIndex);
        return {
            id: chunkId,
            text,
            payload: {
                documentId,
                chunkId,
                chunkIndex,
                text,
                title: document.title,
                url: document.source?.url,
                source: document.source?.name,
                publishedAt: sourcePublishedAt
                    ? Math.floor(sourcePublishedAt.getTime() / 1000)
                    : null,
                publishedAtIso: sourcePublishedAt ? sourcePublishedAt.toISOString() : null,
                language: document.language,
                documentType: document.documentType,
                sectors: document.metadata?.sectors || [],
                symbols: document.metadata?.companies || [],
                tags: document.metadata?.tags || [],
                contentHash: document.text?.contentHash || '',
                sentenceIds: chunkSentences.map((sentence) => sentence.id),
                sentences: chunkSentences
            }
        };
    });
};

const parseDateSeconds = (value) => {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? undefined
        : Math.floor(date.getTime() / 1000);
};

const buildSearchFilter = ({
    from,
    to,
    sector,
    source,
    documentType,
    language
} = {}) => {
    const must = [];
    const matchValue = (key, value) => {
        if (!value) return;
        const values = Array.isArray(value) ? value.filter(Boolean) : [value];
        if (!values.length) return;
        must.push({
            key,
            match: values.length === 1
                ? { value: values[0] }
                : { any: values }
        });
    };

    matchValue('sectors', sector);
    matchValue('source', source);
    matchValue('documentType', documentType);
    matchValue('language', language);

    const gte = parseDateSeconds(from);
    const lte = parseDateSeconds(to);
    if (gte !== undefined || lte !== undefined) {
        must.push({
            key: 'publishedAt',
            range: {
                ...(gte !== undefined ? { gte } : {}),
                ...(lte !== undefined ? { lte } : {})
            }
        });
    }
    return must.length ? { must } : undefined;
};

const createMarketQdrantClient = ({
    fetchImpl = fetch,
    embedTextImpl = embedText,
    config = marketGyanConfig
} = {}) => {
    const requestJson = async (method, path, body) => {
        const response = await fetchImpl(`${config.qdrantUrl}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        const text = await response.text();
        let parsed = {};
        try {
            parsed = text ? JSON.parse(text) : {};
        } catch {
            parsed = { raw: text };
        }
        if (!response.ok) {
            const error = new Error(
                parsed?.status?.error || parsed?.message || text || `Qdrant HTTP ${response.status}`
            );
            error.status = response.status;
            throw error;
        }
        return parsed;
    };

    const ensureCollection = async (vectorSize) => {
        try {
            const current = await requestJson(
                'GET',
                `/collections/${encodeURIComponent(config.qdrantCollection)}`
            );
            const existing = current?.result?.config?.params?.vectors?.size;
            if (existing && existing !== vectorSize) {
                throw new Error(
                    `MarketGyan Qdrant vector size ${existing} does not match ${vectorSize}`
                );
            }
        } catch (error) {
            if (error.status !== 404) throw error;
            await requestJson(
                'PUT',
                `/collections/${encodeURIComponent(config.qdrantCollection)}`,
                { vectors: { size: vectorSize, distance: 'Cosine' } }
            );
        }
    };

    const upsertChunks = async (chunks) => {
        if (!chunks.length) return [];
        const points = [];
        for (const chunk of chunks) {
            const vector = await embedTextImpl(chunk.text, { role: 'passage' });
            points.push({
                id: chunk.id,
                vector,
                payload: chunk.payload
            });
        }
        await ensureCollection(points[0].vector.length);
        await requestJson(
            'PUT',
            `/collections/${encodeURIComponent(config.qdrantCollection)}/points?wait=true`,
            { points }
        );
        return points.map((point) => point.id);
    };

    const deletePoints = async (pointIds) => {
        if (!pointIds?.length) return 0;
        await requestJson(
            'POST',
            `/collections/${encodeURIComponent(config.qdrantCollection)}/points/delete?wait=true`,
            { points: pointIds }
        );
        return pointIds.length;
    };

    const search = async (query, filters = {}) => {
        if (!String(query || '').trim()) {
            const error = new Error('q is required');
            error.status = 400;
            throw error;
        }
        const vector = await embedTextImpl(query, { role: 'query' });
        await ensureCollection(vector.length);
        const limit = Math.min(
            Math.max(Number(filters.limit) || DEFAULT_LIMIT, 1),
            30
        );
        const body = {
            vector,
            limit,
            with_payload: true,
            filter: buildSearchFilter(filters)
        };
        if (!body.filter) delete body.filter;
        const response = await requestJson(
            'POST',
            `/collections/${encodeURIComponent(config.qdrantCollection)}/points/search`,
            body
        );
        return (response.result || []).map((result) => ({
            pointId: result.id,
            score: result.score,
            ...result.payload
        }));
    };

    return {
        deletePoints,
        ensureCollection,
        requestJson,
        search,
        upsertChunks
    };
};

const indexMarketDocuments = async ({
    limit = 100,
    force = false,
    client = createMarketQdrantClient()
} = {}) => {
    const query = {
        'ingestion.status': { $in: ['complete', 'partial'] },
        ...(force ? {} : {
            $or: [
                { 'qdrant.indexedAt': { $exists: false } },
                { $expr: { $ne: ['$qdrant.contentHash', '$text.contentHash'] } }
            ]
        })
    };
    const documents = await MarketDocument.find(query)
        .populate('article')
        .sort({ 'source.publishedAt': 1, _id: 1 })
        .limit(Math.min(Math.max(Number(limit) || 100, 1), 1000));
    const result = { considered: documents.length, indexed: 0, skipped: 0, failed: [] };

    for (const document of documents) {
        const chunks = buildChunkPayloads(document);
        if (!chunks.length) {
            result.skipped += 1;
            continue;
        }
        try {
            const previousPointIds = document.qdrant?.pointIds || [];
            const pointIds = await client.upsertChunks(chunks);
            const current = new Set(pointIds);
            await client.deletePoints(
                previousPointIds.filter((pointId) => !current.has(pointId))
            );
            document.qdrant = {
                collection: marketGyanConfig.qdrantCollection,
                contentHash: document.text?.contentHash,
                pointIds,
                indexedAt: new Date()
            };
            await document.save();
            result.indexed += 1;
        } catch (error) {
            result.failed.push({
                documentId: document._id.toString(),
                error: error.message
            });
        }
    }
    return result;
};

module.exports = {
    buildChunkPayloads,
    buildSearchFilter,
    chunkText,
    createMarketQdrantClient,
    indexMarketDocuments,
    stablePointId
};

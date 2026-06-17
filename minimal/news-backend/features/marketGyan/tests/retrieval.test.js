const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
    buildChunkPayloads,
    buildSearchFilter,
    chunkText,
    createMarketQdrantClient,
    stablePointId
} = require('../services/marketQdrantService');

test('market document chunking is bounded and deterministic', () => {
    const text = Array.from({ length: 80 }, (_, index) => `word${index}`).join(' ');
    const chunks = chunkText(text, { size: 120, overlap: 20 });
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.length <= 120));
    assert.equal(stablePointId('document-1', 0), stablePointId('document-1', 0));
    assert.notEqual(stablePointId('document-1', 0), stablePointId('document-1', 1));
});

test('market chunk payload retains retrieval and citation metadata', () => {
    const document = {
        _id: new mongoose.Types.ObjectId(),
        documentType: 'financial_news',
        title: 'NEPSE daily update',
        language: 'en',
        source: {
            name: 'ShareSansar',
            url: 'https://example.com/story',
            publishedAt: new Date('2026-06-13T00:00:00.000Z')
        },
        text: {
            cleaned: 'NEPSE closed higher in a mixed trading session.',
            contentHash: 'content-hash'
        },
        metadata: {
            sectors: ['Banking'],
            companies: ['NABIL'],
            tags: ['market close']
        }
    };
    const [chunk] = buildChunkPayloads(document);
    assert.equal(chunk.payload.documentId, document._id.toString());
    assert.equal(chunk.payload.url, 'https://example.com/story');
    assert.deepEqual(chunk.payload.sectors, ['Banking']);
    assert.equal(chunk.payload.text, document.text.cleaned);
});

test('market retrieval filters source, sector, type, language, and date', () => {
    const filter = buildSearchFilter({
        source: 'ShareSansar',
        sector: 'Banking',
        documentType: 'financial_news',
        language: 'en',
        from: '2026-01-01',
        to: '2026-06-13'
    });
    assert.equal(filter.must.length, 5);
    assert.ok(filter.must.some((item) => item.key === 'publishedAt'));
});

test('market Qdrant client creates, upserts, and searches its own collection', async () => {
    const requests = [];
    const fetchImpl = async (url, request) => {
        requests.push({ url, request });
        if (request.method === 'GET') {
            return {
                ok: false,
                status: 404,
                text: async () => JSON.stringify({ status: { error: 'missing' } })
            };
        }
        if (request.method === 'POST') {
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    result: [{
                        id: 'point-1',
                        score: 0.9,
                        payload: {
                            documentId: 'doc-1',
                            title: 'Story',
                            url: 'https://example.com',
                            text: 'Grounded excerpt'
                        }
                    }]
                })
            };
        }
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ result: {} })
        };
    };
    const client = createMarketQdrantClient({
        fetchImpl,
        embedTextImpl: async () => [0.1, 0.2, 0.3],
        config: {
            qdrantUrl: 'http://qdrant',
            qdrantCollection: 'market_test'
        }
    });

    await client.upsertChunks([{
        id: 'point-1',
        text: 'Grounded excerpt',
        payload: { documentId: 'doc-1' }
    }]);
    const results = await client.search('banking', { sector: 'Banking' });

    assert.equal(results[0].documentId, 'doc-1');
    assert.ok(requests.some((item) => item.url.includes('/collections/market_test')));
    assert.ok(requests.some((item) => item.request.method === 'POST'));
});

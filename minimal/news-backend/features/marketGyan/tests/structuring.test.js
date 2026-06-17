const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { marketGyanConfig } = require('../config');

const {
    validateCandidate,
    validateCandidateV2
} = require('../services/candidateValidationService');
const {
    RequestPacer,
    buildPrompt,
    createGemmaClient
} = require('../services/gemmaClient');
const {
    approvedLabelToExport,
    buildRetryQuery,
    createIdempotencyKey,
    exportApprovedLabels,
    findMentionedSymbols,
    isTransientGemmaError,
    recoverStaleJobs
} = require('../services/labelQueueService');
const { splitNumberedSentences } = require('../services/sentenceService');
const MarketLabel = require('../models/MarketLabel');
const {
    isLoopbackAddress,
    isReviewRequestAllowed
} = require('../middleware/reviewAccess');

const validCandidate = {
    language: 'en',
    summary: 'The notice changes capital requirements for listed banks.',
    sentiment: 'neutral',
    sectors: ['Banking'],
    symbols: ['NABIL'],
    tags: ['capital requirement'],
    confidenceBand: 'medium',
    rationale: 'The supplied notice changes compliance requirements but does not quantify earnings impact.',
    evidence: ['changes capital requirements for listed banks']
};

test('candidate validation accepts grounded structured data', () => {
    const result = validateCandidate(validCandidate, {
        excerpt: 'The notice changes capital requirements for listed banks from next quarter.',
        allowedSymbols: ['NABIL']
    });

    assert.equal(result.valid, true);
    assert.equal(result.candidate.sectors[0], 'Banking');
});

test('candidate validation rejects unknown symbols, sectors, and unsupported evidence', () => {
    const result = validateCandidate({
        ...validCandidate,
        sectors: ['Guaranteed Profit'],
        symbols: ['FAKE'],
        evidence: ['This sentence was invented.']
    }, {
        excerpt: 'The notice changes capital requirements for listed banks.',
        allowedSymbols: ['NABIL']
    });

    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /unknown sectors/i);
    assert.match(result.errors.join(' '), /unknown NEPSE symbols/i);
    assert.match(result.errors.join(' '), /not present/i);
});

test('Gemma prompt sends only the title and cleaned excerpt as source data', () => {
    const prompt = buildPrompt({
        title: 'Public notice',
        excerpt: 'The supplied public text.',
        sourceName: 'Internal provenance',
        publishedAt: '2026-06-11T00:00:00.000Z'
    });

    assert.match(prompt, /Title: Public notice/);
    assert.match(prompt, /Text: The supplied public text/);
    assert.doesNotMatch(prompt, /Internal provenance/);
    assert.doesNotMatch(prompt, /2026-06-11/);
});

test('only NEPSE symbols explicitly present in source text reach Gemma', () => {
    const symbols = findMentionedSymbols({
        title: 'NABIL publishes result',
        excerpt: 'NABIL reported growth. The article mentions banking but not unrelated issuers.'
    }, ['NABIL', 'UPPER', 'API']);

    assert.deepEqual(symbols, ['NABIL']);
});

test('function schema requires grounded evidence and limits symbol output', () => {
    const declaration = require('../services/gemmaClient')
        .buildFunctionDeclaration({ allowedSymbols: [] });

    assert.equal(declaration.parameters.properties.evidence.minItems, 1);
    assert.equal(declaration.parameters.properties.symbols.maxItems, 12);
});

test('request pacer enforces at least four seconds between calls', async () => {
    let now = 10000;
    const waits = [];
    const pacer = new RequestPacer({
        rpm: 30,
        now: () => now,
        sleepFn: async (ms) => {
            waits.push(ms);
            now += ms;
        }
    });

    await pacer.wait();
    now += 1000;
    await pacer.wait();

    assert.equal(pacer.minimumIntervalMs, 4000);
    assert.equal(waits[0], 3000);
});

test('request pacer serializes concurrent callers', async () => {
    let now = 10000;
    const waits = [];
    const pacer = new RequestPacer({
        rpm: 15,
        now: () => now,
        sleepFn: async (ms) => {
            waits.push(ms);
            now += ms;
        }
    });

    await Promise.all([pacer.wait(), pacer.wait(), pacer.wait()]);

    assert.deepEqual(waits, [4000, 4000]);
});

test('Gemma client retries a 429 and returns function-call arguments', async () => {
    let calls = 0;
    let requestBody;
    const waits = [];
    const fetchImpl = async (_url, request) => {
        calls += 1;
        requestBody = JSON.parse(request.body);
        if (calls === 1) {
            return {
                ok: false,
                status: 429,
                headers: { get: () => '0' },
                text: async () => JSON.stringify({ error: { message: 'Rate limited' } })
            };
        }
        return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: async () => JSON.stringify({
                candidates: [{
                    content: {
                        parts: [{
                            functionCall: {
                                name: 'structure_market_document',
                                args: validCandidate
                            }
                        }]
                    }
                }],
                usageMetadata: { totalTokenCount: 42 }
            })
        };
    };
    const client = createGemmaClient({
        apiKey: 'test-key',
        fetchImpl,
        sleepFn: async (ms) => waits.push(ms),
        pacer: { wait: async () => {} },
        config: {
            gemmaModel: 'gemma-test',
            gemmaRpm: 15,
            gemmaMaxAttempts: 2,
            requestTimeoutMs: 1000
        }
    });

    const response = await client.structureDocument({
        title: 'Notice',
        excerpt: 'The notice changes capital requirements for listed banks.'
    }, { allowedSymbols: ['NABIL'] });

    assert.equal(calls, 2);
    assert.equal(waits.length, 1);
    assert.equal(requestBody.toolConfig, undefined);
    assert.equal(requestBody.generationConfig, undefined);
    assert.equal(response.candidate.sentiment, 'neutral');
    assert.equal(response.usage.totalTokens, 42);
});

test('live Gemma structuring returns a grounded function call', {
    skip: process.env.MARKET_GYAN_LIVE_GEMMA_TEST === 'true'
        && process.env.GEMINI_API_KEY
        ? false
        : 'requires MARKET_GYAN_LIVE_GEMMA_TEST=true and a newly rotated GEMINI_API_KEY'
}, async () => {
    const client = createGemmaClient({
        config: {
            ...marketGyanConfig,
            schemaVersion: 2,
            promptVersion: 'market-impact-v2'
        }
    });
    const excerpt = 'Nabil Bank reported that its unaudited quarterly profit increased by 8 percent.';
    const sentences = splitNumberedSentences(excerpt);
    const response = await client.structureDocument({
        title: 'Nabil Bank quarterly result',
        excerpt,
        sentences,
        sourceName: 'Live smoke fixture',
        publishedAt: new Date().toISOString()
    }, {
        allowedSymbols: ['NABIL']
    });
    const validation = validateCandidateV2(response.candidate, {
        sentences,
        allowedSymbols: ['NABIL']
    });

    assert.equal(validation.valid, true, validation.errors.join('; '));
});

test('idempotency key changes with schema or prompt version', () => {
    const input = { contentHash: 'document-hash' };
    const first = createIdempotencyKey(input, {
        gemmaModel: 'gemma',
        promptVersion: 'v1',
        schemaVersion: 1
    });
    const second = createIdempotencyKey(input, {
        gemmaModel: 'gemma',
        promptVersion: 'v2',
        schemaVersion: 1
    });

    assert.notEqual(first, second);
});

test('stale processing jobs are returned to the queue', async () => {
    const original = MarketLabel.updateMany;
    let captured;
    MarketLabel.updateMany = async (query, update) => {
        captured = { query, update };
        return { modifiedCount: 1 };
    };
    try {
        const staleBefore = new Date('2026-06-11T00:00:00.000Z');
        await recoverStaleJobs({ staleBefore });
        assert.equal(captured.query.status, 'processing');
        assert.equal(captured.query.processingStartedAt.$lt, staleBefore);
        assert.equal(captured.update.$set.status, 'queued');
    } finally {
        MarketLabel.updateMany = original;
    }
});

test('transient retry query excludes validation failures and caps job attempts', () => {
    const query = buildRetryQuery({
        source: 'sharesansar',
        transientOnly: true,
        maxAttempts: 2
    });

    assert.equal(query.status, 'failed');
    assert.match('ShareSansar', query['input.sourceName']);
    assert.deepEqual(query['validationErrors.0'], { $exists: false });
    assert.deepEqual(query.attempts, { $lt: 2 });
});

test('circuit breaker classification distinguishes provider failures from validation errors', () => {
    assert.equal(isTransientGemmaError({ status: 500 }), true);
    assert.equal(isTransientGemmaError({ status: 429 }), true);
    assert.equal(isTransientGemmaError({ message: 'network timeout at endpoint' }), true);
    assert.equal(
        isTransientGemmaError({ message: 'Gemma output failed schema or evidence validation' }),
        false
    );
});

test('export reads only approved jobs and retains generated versus reviewed values', async () => {
    const original = MarketLabel.find;
    const approved = {
        _id: new mongoose.Types.ObjectId(),
        document: new mongoose.Types.ObjectId(),
        input: {
            title: 'Notice',
            excerpt: 'Evidence',
            contentHash: 'hash',
            sourceName: 'SEBON',
            sourceUrl: 'https://example.com'
        },
        originalCandidate: { ...validCandidate, sentiment: 'bullish' },
        candidate: validCandidate,
        model: { name: 'gemma-test' }
    };
    let query;
    MarketLabel.find = (value) => {
        query = value;
        return {
            sort: () => ({
                lean: async () => [approved]
            })
        };
    };
    try {
        const rows = await exportApprovedLabels({ schemaVersion: 1 });
        assert.deepEqual(query, {
            status: 'approved',
            'model.schemaVersion': 1
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].generated.sentiment, 'bullish');
        assert.equal(rows[0].approved.sentiment, 'neutral');
        assert.equal(approvedLabelToExport(approved).source.name, 'SEBON');
    } finally {
        MarketLabel.find = original;
    }
});

test('review access requires a loopback request, enabled flag, and non-production environment', () => {
    assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
    assert.equal(isLoopbackAddress('192.168.1.20'), false);
    assert.equal(isReviewRequestAllowed({
        socket: { remoteAddress: '127.0.0.1' }
    }, {
        enabled: true,
        nodeEnv: 'development'
    }), true);
    assert.equal(isReviewRequestAllowed({
        socket: { remoteAddress: '127.0.0.1' }
    }, {
        enabled: true,
        nodeEnv: 'production'
    }), false);
});

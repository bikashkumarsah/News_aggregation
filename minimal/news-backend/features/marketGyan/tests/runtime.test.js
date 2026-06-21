const test = require('node:test');
const assert = require('node:assert/strict');

const {
    validateAgentResult
} = require('../services/agentClientService');
const {
    isInternalRequestAllowed
} = require('../middleware/internalAccess');
const {
    assertReportDateAllowed,
    citationToEvidence,
    reportAsText,
    reportDay
} = require('../services/reportService');
const {
    createRuntimeStatus,
    isLocalReportGenerationAllowed
} = require('../services/runtimeStatusService');
const {
    runPostMarketWorkflow
} = require('../scheduler/postMarketScheduler');
const {
    trainingGateFromCounts
} = require('../services/labelQueueService');
const {
    MARKET_GYAN_DISCLAIMER
} = require('../services/overviewService');

const groundedResult = {
    mode: 'query',
    answer: 'The retrieved evidence describes mixed market conditions.',
    citations: [{
        documentId: '507f1f77bcf86cd799439011',
        title: 'Market report',
        url: 'https://example.com/report',
        excerpt: 'mixed market conditions',
        score: 0.9,
        source: 'ShareSansar',
        publishedAt: '2026-06-13T00:00:00.000Z',
        chunkId: 'chunk-1',
        contentHash: 'hash-1',
        sentenceIds: ['S1'],
        sentences: [{ id: 'S1', text: 'mixed market conditions' }]
    }],
    disclaimer: MARKET_GYAN_DISCLAIMER
};

test('agent results require citations, disclaimer, and no investment advice', () => {
    assert.equal(validateAgentResult(groundedResult, { mode: 'query' }).valid, true);
    assert.equal(validateAgentResult({
        ...groundedResult,
        citations: []
    }, { mode: 'query' }).valid, false);
    assert.equal(validateAgentResult({
        ...groundedResult,
        answer: 'This is a guaranteed profit and buy signal.'
    }, { mode: 'query' }).valid, false);
    assert.equal(validateAgentResult({
        ...groundedResult,
        citations: [{
            ...groundedResult.citations[0],
            sentences: []
        }]
    }, { mode: 'query' }).valid, false);
});

test('internal endpoints require loopback and the configured token', () => {
    const request = {
        socket: { remoteAddress: '127.0.0.1' },
        get: (name) => name === 'x-market-gyan-token' ? 'secret' : undefined
    };
    assert.equal(isInternalRequestAllowed(request, { token: 'secret' }), true);
    assert.equal(isInternalRequestAllowed(request, { token: 'wrong' }), false);
    assert.equal(isInternalRequestAllowed({
        ...request,
        socket: { remoteAddress: '192.168.1.3' }
    }, { token: 'secret' }), false);
});

test('runtime status exposes booleans without leaking service tokens', () => {
    const request = {
        socket: { remoteAddress: '127.0.0.1' }
    };
    const status = createRuntimeStatus({
        req: request,
        latestReport: {
            status: 'published',
            reportDate: new Date('2026-06-13T00:00:00.000Z')
        },
        latestSnapshot: {
            status: 'partial',
            marketDate: new Date('2026-06-13T00:00:00.000Z')
        },
        config: {
            queryEnabled: true,
            reviewEnabled: true,
            agentServiceToken: 'secret-token',
            qdrantCollection: 'market_test'
        }
    });

    assert.equal(status.queryEnabled, true);
    assert.equal(status.reviewEnabled, true);
    assert.equal(status.localReportGenerationAllowed, true);
    assert.equal(status.agentTokenConfigured, true);
    assert.equal(status.qdrantCollection, 'market_test');
    assert.equal(JSON.stringify(status).includes('secret-token'), false);
});

test('local report generation requires the local review boundary', () => {
    const localRequest = { socket: { remoteAddress: '127.0.0.1' } };
    const remoteRequest = { socket: { remoteAddress: '192.168.1.3' } };
    assert.equal(isLocalReportGenerationAllowed(localRequest, { enabled: true }), true);
    assert.equal(isLocalReportGenerationAllowed(remoteRequest, { enabled: true }), false);
    assert.equal(isLocalReportGenerationAllowed(localRequest, { enabled: false }), false);
    assert.equal(isLocalReportGenerationAllowed(localRequest, {
        enabled: true,
        nodeEnv: 'production'
    }), false);
});

test('training gate requires all reviews, 300 approvals, and 50 per class', () => {
    const config = {
        reviewTarget: 452,
        approvedTarget: 300,
        minApprovedPerSentiment: 50
    };
    assert.equal(trainingGateFromCounts({
        resolved: 452,
        approved: 320,
        approvedSentiments: { bullish: 80, bearish: 60, neutral: 180 },
        config
    }).ready, true);
    assert.equal(trainingGateFromCounts({
        resolved: 451,
        approved: 320,
        approvedSentiments: { bullish: 80, bearish: 49, neutral: 191 },
        config
    }).ready, false);
});

test('post-market workflow stops before generation when inference is disabled', async () => {
    let generated = false;
    const result = await runPostMarketWorkflow({
        date: '2026-06-13',
        ingest: async () => ({ status: 'complete' }),
        index: async () => ({ indexed: 2 }),
        generateReport: async () => {
            generated = true;
        },
        config: { queryEnabled: false }
    });
    assert.equal(generated, false);
    assert.equal(result.report.skipped, true);
});

test('post-market workflow never sends digest after report failure', async () => {
    let delivered = false;
    await assert.rejects(runPostMarketWorkflow({
        date: '2026-06-13',
        ingest: async () => ({ status: 'complete' }),
        index: async () => ({ indexed: 2 }),
        generateReport: async () => {
            throw new Error('invalid citations');
        },
        deliverDigest: async () => {
            delivered = true;
        },
        config: { queryEnabled: true }
    }), /invalid citations/);
    assert.equal(delivered, false);
});

test('report helpers normalize dates and preserve evidence text', () => {
    const evidence = citationToEvidence({
        documentId: 'not-an-object-id',
        title: 'Source',
        url: 'https://example.com/report',
        excerpt: 'Grounded evidence.',
        score: 0.9,
        source: 'ShareSansar',
        publishedAt: '2026-06-13T00:00:00.000Z',
        chunkId: 'chunk-1',
        contentHash: 'hash-1',
        sentenceIds: ['S1'],
        sentences: [{ id: 'S1', text: 'Grounded evidence.' }]
    });

    assert.equal(evidence.document, undefined);
    assert.equal(evidence.source, 'ShareSansar');
    assert.equal(evidence.chunkId, 'chunk-1');
    assert.deepEqual(evidence.sentenceIds, ['S1']);
    assert.equal(
        reportDay('2026-06-13T15:00:00Z').toISOString(),
        '2026-06-13T00:00:00.000Z'
    );
    assert.match(reportAsText({
        headline: 'Market closes mixed',
        summary: 'Turnover increased.',
        sectorAnalysis: [{
            sector: 'Banking',
            sentiment: 'neutral',
            summary: 'Banking was mixed.'
        }],
        evidence: [evidence]
    }), /Grounded evidence/);
    assert.match(reportAsText({
        headline: 'Market closes mixed',
        summary: 'Turnover increased.',
        sectorAnalysis: [],
        evidence: [evidence]
    }), /https:\/\/example.com\/report/);
});

test('report generation rejects future report dates', () => {
    assert.doesNotThrow(() => assertReportDateAllowed(
        reportDay('2026-06-13'),
        new Date('2026-06-13T12:00:00.000Z')
    ));
    assert.throws(() => assertReportDateAllowed(
        reportDay('2026-06-14'),
        new Date('2026-06-13T12:00:00.000Z')
    ), /future date/);
});

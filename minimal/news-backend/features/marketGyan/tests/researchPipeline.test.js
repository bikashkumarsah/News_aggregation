// Regression tests for the offline NEPSE-Impact research pipeline: re-runs
// must be idempotent and must never overwrite or revive reviewed labels.
// Every Mongo call is stubbed; nothing here connects to a database.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const MarketAnnotation = require('../models/MarketAnnotation');
const MarketLabel = require('../models/MarketLabel');
const MarketSecurity = require('../models/MarketSecurity');
const {
    DEFAULT_REQUIREMENTS,
    batchAdjudicateSubmitted,
    rebalanceAudit
} = require('../services/goldDatasetService');
const { splitNumberedSentences } = require('../services/sentenceService');

const sentences = splitNumberedSentences(
    'Nabil Bank reported higher quarterly profit. The board proposed a cash dividend.'
);

const directCandidate = {
    language: 'en',
    summary: 'Nabil Bank reported higher profit and proposed a cash dividend.',
    relevance: 'direct',
    eventType: 'earnings',
    impactScope: 'company',
    impactDirection: 'bullish',
    impactHorizon: 'short_term',
    impactMechanism: 'earnings_cash_flow',
    sectors: ['Banking'],
    symbols: ['NABIL'],
    tags: ['quarterly results', 'dividend'],
    confidenceBand: 'high',
    rationale: 'Higher reported profit can improve expected cash flow, while the dividend is a capital return.',
    evidenceSentenceIds: ['S1', 'S2']
};

const hardNegativeCandidate = {
    ...directCandidate,
    summary: 'The article is general business coverage without a NEPSE mechanism.',
    relevance: 'not_relevant',
    eventType: 'not_applicable',
    impactScope: 'none',
    impactDirection: 'not_applicable',
    impactHorizon: 'not_applicable',
    impactMechanism: 'none',
    sectors: [],
    symbols: [],
    confidenceBand: 'medium',
    rationale: 'The source text names no listed company, sector channel, or NEPSE mechanism.',
    evidenceSentenceIds: ['S1']
};

// Replace static model methods for one test and return a restore function.
const stub = (target, overrides) => {
    const originals = Object.fromEntries(
        Object.keys(overrides).map((key) => [key, target[key]])
    );
    Object.assign(target, overrides);
    return () => Object.assign(target, originals);
};

const restoreAll = (restorers) => {
    for (const restore of restorers.reverse()) restore();
};

const submittedAnnotation = (labelId) => ({
    _id: new mongoose.Types.ObjectId(),
    label: labelId,
    reviewerId: 'reviewer-1',
    reviewerRole: 'primary',
    status: 'submitted',
    annotation: directCandidate,
    submittedAt: new Date()
});

const stubSubmittedAnnotations = (labels) => {
    const updates = [];
    const restorers = [
        stub(MarketAnnotation, {
            find: () => ({
                sort: () => ({
                    lean: async () => labels.map((label) => submittedAnnotation(label._id))
                })
            })
        }),
        stub(MarketLabel, {
            find: () => ({ select: () => ({ lean: async () => labels }) }),
            countDocuments: async () => labels.length,
            findOneAndUpdate: async (query, update) => {
                updates.push({ query, update });
                return { _id: query._id };
            }
        }),
        stub(MarketSecurity, { distinct: async () => ['NABIL'] })
    ];
    return { updates, restore: () => restoreAll(restorers) };
};

test('batch adjudication never revives labels an adjudicator excluded', async () => {
    const pendingId = new mongoose.Types.ObjectId();
    const excludedId = new mongoose.Types.ObjectId();
    const labels = [
        {
            _id: pendingId,
            status: 'pending_review',
            input: { sentences },
            model: { schemaVersion: 2 },
            adjudication: { status: 'pending' }
        },
        {
            // e.g. a surplus hard negative removed by the rebalance patch: it
            // still has its original submitted primary annotation.
            _id: excludedId,
            status: 'rejected',
            input: { sentences },
            model: { schemaVersion: 2 },
            adjudication: { status: 'excluded', reason: 'Surplus hard-negative' }
        }
    ];

    for (const force of [false, true]) {
        const { updates, restore } = stubSubmittedAnnotations(labels);
        try {
            const result = await batchAdjudicateSubmitted({
                schemaVersion: 2,
                dryRun: false,
                force
            });

            assert.equal(result.alreadyExcluded, 1);
            assert.equal(result.skipped.excluded, 1);
            assert.equal(result.adjudicatable, 1);
            assert.deepEqual(
                updates.map(({ query }) => String(query._id)),
                [pendingId.toString()]
            );
            const statusFilter = updates[0].query['adjudication.status'];
            if (force) {
                assert.deepEqual(statusFilter, { $ne: 'excluded' });
            } else {
                assert.deepEqual(statusFilter, { $nin: ['adjudicated', 'excluded'] });
            }
        } finally {
            restore();
        }
    }
});

test('rebalance audit recommends label ids, not annotation ids, for the submitted basis', async () => {
    const labelIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    const annotationRows = labelIds.map((labelId, index) => ({
        _id: new mongoose.Types.ObjectId(),
        status: 'submitted',
        reviewerRole: 'primary',
        annotation: hardNegativeCandidate,
        label: {
            _id: labelId,
            input: {
                title: `Hard negative ${index}`,
                sourceName: 'Online Khabar',
                publishedAt: new Date(index),
                duplicateGroupId: `negative-${index}`
            }
        }
    }));
    const restore = stub(MarketAnnotation, {
        find: () => ({
            populate: () => ({
                lean: () => Promise.resolve(annotationRows)
            })
        })
    });

    try {
        const result = await rebalanceAudit({
            schemaVersion: 2,
            target: 2,
            basis: 'submitted',
            requirements: {
                ...DEFAULT_REQUIREMENTS,
                relevance: { direct: 0, indirect: 0, not_relevant: 1 }
            }
        });

        const [candidate] = result.recommendations.excludeCandidates;
        assert.equal(result.recommendations.excludeCandidates.length, 1);
        assert.ok(
            labelIds.map(String).includes(candidate.id),
            `expected a MarketLabel id, got ${candidate.id}`
        );
    } finally {
        restore();
    }
});

const MarketDocument = require('../models/MarketDocument');
const {
    REPLACEMENTS,
    applyGoldRebalancePatch,
    buildAutomaticReclassifications
} = require('../services/rebalancePatchService');

const fakeLabel = ({
    id = new mongoose.Types.ObjectId(),
    documentId = new mongoose.Types.ObjectId(),
    status = 'adjudicated',
    gold = directCandidate,
    provider = 'google',
    revisions = []
} = {}) => ({
    _id: new mongoose.Types.ObjectId(String(id)),
    document: new mongoose.Types.ObjectId(String(documentId)),
    status: status === 'adjudicated' ? 'approved' : 'rejected',
    input: { title: `Label ${id}`, sourceName: 'ShareSansar', sentences },
    model: { provider, schemaVersion: 2 },
    adjudication: {
        status,
        goldCandidate: status === 'adjudicated' ? { ...gold } : undefined
    },
    revisions: [...revisions],
    saves: 0,
    async save() {
        this.saves += 1;
        return this;
    }
});

const stubRebalanceStore = (labels, documents) => {
    const calls = { findOne: 0, created: [], annotations: [] };
    const restorers = [
        stub(MarketLabel, {
            find: () => Promise.resolve(labels),
            findOne: async () => {
                calls.findOne += 1;
                return null;
            }
        }),
        stub(MarketLabel.prototype, {
            save: async function save() {
                calls.created.push(this);
                return this;
            }
        }),
        stub(MarketAnnotation, {
            findOneAndUpdate: async (query, update) => {
                calls.annotations.push({ query, update });
                return {};
            }
        }),
        stub(MarketDocument, {
            find: () => ({ lean: async () => documents })
        }),
        stub(MarketSecurity, {
            find: () => ({
                select: () => ({
                    lean: async () => [{
                        symbol: 'NABIL',
                        name: 'Nabil Bank Limited',
                        sector: 'Banking',
                        aliases: []
                    }]
                })
            })
        })
    ];
    return { calls, restore: () => restoreAll(restorers) };
};

const replacementDocument = (documentId) => ({
    _id: new mongoose.Types.ObjectId(documentId),
    title: 'Nabil Bank reported higher quarterly profit',
    language: 'en',
    source: {
        name: 'ShareSansar',
        url: `https://example.com/${documentId}`,
        publishedAt: new Date('2026-05-01T00:00:00Z')
    },
    text: {
        cleaned: 'Nabil Bank reported higher quarterly profit. The board proposed a cash dividend.',
        contentHash: `hash-${documentId}`
    }
});

test('re-running the rebalance patch keeps later reviewer decisions', async () => {
    const patches = buildAutomaticReclassifications([]);
    const [excludedPatch, revisedPatch, pendingPatch, ...appliedPatches] = patches;
    const excludedTarget = fakeLabel({ id: excludedPatch.id, status: 'excluded' });
    // The patch moved this record to earnings; a reviewer later moved it back.
    const revisedTarget = fakeLabel({
        id: revisedPatch.id,
        gold: { ...directCandidate, eventType: 'capital_action' },
        revisions: [{ action: 'adjudicated', reason: revisedPatch.reason }]
    });
    const pendingTarget = fakeLabel({
        id: pendingPatch.id,
        gold: { ...directCandidate, eventType: 'capital_action' }
    });
    const appliedTargets = appliedPatches.map((patch) => fakeLabel({
        id: patch.id,
        revisions: [{ action: 'adjudicated', reason: patch.reason }]
    }));
    const [humanExcluded, ...keptReplacements] = REPLACEMENTS;
    const replacementLabels = [
        fakeLabel({
            documentId: humanExcluded.documentId,
            status: 'excluded',
            provider: 'marketgyan_rebalance'
        }),
        ...keptReplacements.map((definition) => fakeLabel({
            documentId: definition.documentId,
            provider: 'marketgyan_rebalance'
        }))
    ];
    const labels = [
        excludedTarget,
        revisedTarget,
        pendingTarget,
        ...appliedTargets,
        ...replacementLabels
    ];
    const { calls, restore } = stubRebalanceStore(
        labels,
        REPLACEMENTS.map((definition) => replacementDocument(definition.documentId))
    );

    try {
        const result = await applyGoldRebalancePatch({ dryRun: false });

        assert.equal(result.counts.reclassified, 1);
        assert.equal(pendingTarget.saves, 1);
        assert.equal(pendingTarget.adjudication.goldCandidate.eventType, 'earnings');
        assert.equal(revisedTarget.saves, 0);
        assert.equal(revisedTarget.adjudication.goldCandidate.eventType, 'capital_action');
        assert.equal(excludedTarget.saves, 0);
        assert.equal(excludedTarget.adjudication.status, 'excluded');
        assert.equal(result.counts.skipped, patches.length - 1);

        assert.equal(result.counts.keptReplacements, REPLACEMENTS.length);
        assert.equal(calls.findOne, 0);
        assert.equal(calls.created.length, 0);
        assert.equal(calls.annotations.length, 0);
        assert.ok(replacementLabels.every((label) => label.saves === 0));
        assert.equal(replacementLabels[0].adjudication.status, 'excluded');
    } finally {
        restore();
    }
});

test('the rebalance patch still creates a replacement that does not exist yet', async () => {
    const patches = buildAutomaticReclassifications([]);
    const [missing, ...existing] = REPLACEMENTS;
    const labels = [
        ...patches.map((patch) => fakeLabel({
            id: patch.id,
            revisions: [{ action: 'adjudicated', reason: patch.reason }]
        })),
        ...existing.map((definition) => fakeLabel({
            documentId: definition.documentId,
            provider: 'marketgyan_rebalance'
        }))
    ];
    const { calls, restore } = stubRebalanceStore(
        labels,
        REPLACEMENTS.map((definition) => replacementDocument(definition.documentId))
    );

    try {
        const result = await applyGoldRebalancePatch({ dryRun: false });

        assert.equal(result.counts.keptReplacements, REPLACEMENTS.length - 1);
        assert.equal(calls.created.length, 1);
        assert.equal(String(calls.created[0].document), missing.documentId);
        assert.equal(calls.created[0].adjudication.status, 'adjudicated');
        assert.equal(calls.annotations.length, 1);
        const created = result.replacements.find((row) => !row.kept);
        assert.equal(created.document, missing.documentId);
        assert.equal(created.relevance, 'direct');
    } finally {
        restore();
    }
});

const {
    getDocumentInput,
    queueDocuments
} = require('../services/labelQueueService');
const {
    classifyDocumentForSelection
} = require('../services/corpusSelectionService');
const { validateCandidateV2 } = require('../services/candidateValidationService');

const stubQueueStore = ({ labelledDocumentIds = [], documents = [] } = {}) => {
    const calls = { findQueries: [], upserts: [] };
    const restorers = [
        stub(MarketLabel, {
            distinct: async () => labelledDocumentIds,
            updateOne: async (query, update) => {
                calls.upserts.push({ query, update });
                return { upsertedCount: 1 };
            }
        }),
        stub(MarketDocument, {
            find: (query) => {
                calls.findQueries.push(query);
                const chain = {
                    populate: () => chain,
                    sort: () => chain,
                    limit: async () => documents
                };
                return chain;
            }
        })
    ];
    return { calls, restore: () => restoreAll(restorers) };
};

test('queueing an empty explicit selection queues nothing', async () => {
    const { calls, restore } = stubQueueStore({
        documents: [replacementDocument('6a2f04658a1c034887d2f9ac')]
    });
    try {
        const result = await queueDocuments({ documentIds: [], limit: 0 });
        assert.deepEqual(result, { considered: 0, queued: 0, existing: 0, skipped: [] });
        assert.equal(calls.findQueries.length, 0);
        assert.equal(calls.upserts.length, 0);
    } finally {
        restore();
    }
});

test('queueing an explicit selection skips documents that already have a label', async () => {
    const labelled = new mongoose.Types.ObjectId();
    const fresh = replacementDocument(new mongoose.Types.ObjectId().toString());
    const { calls, restore } = stubQueueStore({
        labelledDocumentIds: [labelled],
        documents: [fresh]
    });
    try {
        const result = await queueDocuments({
            documentIds: [labelled.toString(), fresh._id.toString()],
            limit: 2
        });
        assert.deepEqual(calls.findQueries[0]._id, { $in: [fresh._id.toString()] });
        assert.equal(result.considered, 2);
        assert.equal(result.existing, 1);
        assert.equal(result.queued, 1);
        assert.equal(calls.upserts.length, 1);
        assert.equal(
            String(calls.upserts[0].update.$setOnInsert.document),
            fresh._id.toString()
        );
    } finally {
        restore();
    }
});

test('label queue and corpus selection share one duplicate group per title', () => {
    for (const title of [
        'नेप्से परिसूचक ३५ अंकले बढ्यो, कारोबार रकम ५ अर्ब नाघ्यो',
        'Nabil Bank reported higher quarterly profit'
    ]) {
        const document = {
            _id: new mongoose.Types.ObjectId(),
            title,
            language: 'mixed',
            source: { name: 'ShareSansar', url: 'https://example.com/a' },
            text: {
                cleaned: `${title}. The board proposed a cash dividend.`,
                contentHash: 'content-hash'
            }
        };
        assert.equal(
            getDocumentInput(document).duplicateGroupId,
            classifyDocumentForSelection(document, []).duplicateGroupId,
            title
        );
    }
});

test('candidate validation removes values that only differ before normalization', () => {
    const validation = validateCandidateV2({
        ...directCandidate,
        sectors: ['Banking', 'banking'],
        symbols: ['nabil', 'NABIL'],
        tags: ['Dividend', 'dividend'],
        evidenceSentenceIds: ['s1', 'S1', 'S2']
    }, {
        sentences,
        allowedSymbols: ['NABIL']
    });

    assert.equal(validation.valid, true, validation.errors.join('; '));
    assert.deepEqual(validation.candidate.sectors, ['Banking']);
    assert.deepEqual(validation.candidate.symbols, ['NABIL']);
    assert.deepEqual(validation.candidate.tags, ['dividend']);
    assert.deepEqual(validation.candidate.evidenceSentenceIds, ['S1', 'S2']);
});

const Article = require('../../../models/Article');
const MarketIngestionRun = require('../models/MarketIngestionRun');
const MarketSnapshot = require('../models/MarketSnapshot');
const {
    backfillMarketHistory,
    runIngestion,
    upsertFinancialNews,
    upsertRegulatoryDocuments,
    upsertSecurityRegistry
} = require('../services/ingestionService');

const nabilSecurity = {
    symbol: 'NABIL',
    name: 'Nabil Bank Limited',
    sector: 'Banking',
    aliases: []
};

const stubNewsStore = ({ existingArticle, existingDocument }) => {
    const calls = { article: [], document: [] };
    const restorers = [
        stub(MarketSecurity, {
            find: () => ({ select: () => ({ lean: async () => [nabilSecurity] }) })
        }),
        stub(Article, {
            findOne: () => ({ select: async () => existingArticle }),
            findOneAndUpdate: async (query, update) => {
                calls.article.push(update);
                return { _id: existingArticle?._id || new mongoose.Types.ObjectId() };
            }
        }),
        stub(MarketDocument, {
            findOne: () => ({ select: async () => existingDocument }),
            findOneAndUpdate: async (query, update) => {
                calls.document.push(update);
                return {};
            }
        })
    ];
    return { calls, restore: () => restoreAll(restorers) };
};

const newsItem = (overrides = {}) => ({
    kind: 'financial_news',
    sourceId: 'guid-1',
    title: 'Banks raise deposit rates',
    url: 'https://www.onlinekhabar.com/2026/10/1',
    sourceName: 'Online Khabar',
    section: 'Business',
    publishedAt: new Date('2026-10-01T00:00:00Z'),
    language: 'en',
    description: 'Short RSS excerpt about deposit rates.',
    content: 'Short RSS excerpt about deposit rates at commercial banks, quoted from the feed.',
    extractionMethod: 'html',
    ...overrides
});

test('re-ingestion keeps reviewed document tags, stored full text, and feed topics', async () => {
    const fullText = 'Nabil Bank and other commercial banks raised deposit rates. '
        + 'The full article explains the liquidity squeeze in detail.';
    const { calls, restore } = stubNewsStore({
        existingArticle: { _id: new mongoose.Types.ObjectId(), content: fullText },
        existingDocument: {
            text: { cleaned: fullText },
            sentiment: { model: 'gemma-4-26b-a4b-it:human-reviewed' }
        }
    });
    try {
        // The detail page failed this run, so only the RSS excerpt came back.
        await upsertFinancialNews([newsItem({ contentIsExcerpt: true })], 'run-1');

        const [articleUpdate] = calls.article;
        assert.equal(articleUpdate.$set.content, undefined);
        assert.equal(articleUpdate.$set.description, undefined);
        assert.equal(articleUpdate.$set.topics, undefined);
        assert.equal(articleUpdate.$set.category, undefined);
        assert.deepEqual(articleUpdate.$addToSet, { topics: 'finance' });
        assert.deepEqual(articleUpdate.$setOnInsert, { category: 'business' });

        const [documentUpdate] = calls.document;
        assert.equal(documentUpdate.$set.text, undefined);
        assert.equal(documentUpdate.$set['metadata.companies'], undefined);
        assert.equal(documentUpdate.$set['metadata.sectors'], undefined);
        assert.equal(documentUpdate.$set.ingestion.status, 'complete');
    } finally {
        restore();
    }
});

test('re-ingestion refreshes text and alias tags for unreviewed documents', async () => {
    const { calls, restore } = stubNewsStore({
        existingArticle: { _id: new mongoose.Types.ObjectId(), content: 'old text' },
        existingDocument: {
            text: { cleaned: 'old text' },
            sentiment: { model: 'gemma-4-26b-a4b-it' }
        }
    });
    try {
        const item = newsItem({
            contentIsExcerpt: false,
            content: 'Nabil Bank raised its fixed deposit rate by one percentage point.'
        });
        await upsertFinancialNews([item], 'run-1');

        assert.equal(calls.article[0].$set.content, item.content);
        const [documentUpdate] = calls.document;
        assert.equal(documentUpdate.$set.text.cleaned, item.content);
        assert.deepEqual(documentUpdate.$set['metadata.companies'], ['NABIL']);
        assert.deepEqual(documentUpdate.$set['metadata.sectors'], ['Banking']);
    } finally {
        restore();
    }
});

test('a failed regulatory re-fetch does not erase previously extracted text', async () => {
    const updates = [];
    const statuses = {
        'https://www.sebon.gov.np/notice-1.pdf': 'complete',
        'https://www.sebon.gov.np/notice-2.pdf': null
    };
    const restore = stub(MarketDocument, {
        findOne: (query) => ({
            select: () => ({
                lean: async () => (
                    statuses[query['source.url']]
                        ? { ingestion: { status: statuses[query['source.url']] } }
                        : null
                )
            })
        }),
        findOneAndUpdate: async (query, update) => {
            updates.push({ query, update });
            return {};
        }
    });
    const failed = (url) => ({
        kind: 'regulatory_notice',
        sourceId: url,
        title: 'SEBON notice',
        url,
        sourceName: 'SEBON',
        publishedAt: new Date('2026-10-01T00:00:00Z'),
        language: 'en',
        content: '',
        ingestionStatus: 'failed',
        extractionError: 'GET failed with 503'
    });
    try {
        const counts = await upsertRegulatoryDocuments([
            failed('https://www.sebon.gov.np/notice-1.pdf'),
            failed('https://www.sebon.gov.np/notice-2.pdf')
        ], 'run-1');

        assert.equal(counts.skipped, 2);
        assert.deepEqual(
            updates.map(({ query }) => query['source.url']),
            ['https://www.sebon.gov.np/notice-2.pdf']
        );
    } finally {
        restore();
    }
});

test('a partial market source cannot blank registry names or sectors', async () => {
    const operations = [];
    const restore = stub(MarketSecurity, {
        bulkWrite: async (value) => {
            operations.push(...value);
            return {};
        }
    });
    try {
        await upsertSecurityRegistry([{
            sourceName: 'MeroLagani',
            registry: [{ symbol: 'NABIL', name: '' }],
            securities: [{ symbol: 'NABIL', lastTradedPrice: 510 }]
        }]);

        const { $set } = operations[0].updateOne.update;
        assert.equal('name' in $set, false);
        assert.equal('sector' in $set, false);
        assert.equal($set.active, true);
    } finally {
        restore();
    }
});

test('history backfill does not overwrite reconciled daily snapshots', async () => {
    const daily = new Date('2026-10-18T00:00:00.000Z');
    const missing = new Date('2026-10-19T00:00:00.000Z');
    let snapshotQuery;
    const operations = [];
    const restore = stub(MarketSnapshot, {
        find: (query) => {
            snapshotQuery = query;
            return { select: () => ({ lean: async () => [{ marketDate: daily }] }) };
        },
        bulkWrite: async (value) => {
            operations.push(...value);
            return { upsertedCount: value.length, modifiedCount: 0 };
        }
    });
    const historyRow = (marketDate) => ({
        marketDate,
        sourceName: 'ShareSansar',
        sourceUrl: 'https://www.sharesansar.com/index-history-data',
        metrics: { close: 2700, change: 5, changePercent: 0.2, turnoverAmount: 1 }
    });
    try {
        const counts = await backfillMarketHistory({
            from: '2026-10-18',
            to: '2026-10-19',
            historyCollector: async () => [historyRow(daily), historyRow(missing)]
        });

        assert.deepEqual(snapshotQuery.provenance, {
            $elemMatch: {
                sourceUrl: { $ne: 'https://www.sharesansar.com/index-history-data' }
            }
        });
        assert.deepEqual(
            operations.map((operation) => operation.updateOne.filter.marketDate),
            [missing]
        );
        assert.equal(counts.preserved, 1);
        assert.equal(counts.created, 1);
    } finally {
        restore();
    }
});

const stubIngestionRuns = ({ existing, claimError } = {}) => {
    const calls = { claims: [] };
    const restore = stub(MarketIngestionRun, {
        findOne: async () => existing,
        findOneAndUpdate: async (filter, update) => {
            calls.claims.push({ filter, update });
            if (claimError) throw claimError;
            return {
                ...update.$set,
                async save() {
                    calls.saved = this;
                    return this;
                }
            };
        }
    });
    return { calls, restore };
};

const runOptions = (overrides = {}) => ({
    from: '2026-10-19',
    includeMarket: false,
    includeDocuments: false,
    connection: { readyState: 1 },
    ...overrides
});

test('an ingestion run left "running" by a dead worker can be taken over', async () => {
    const { calls, restore } = stubIngestionRuns({
        existing: {
            status: 'running',
            startedAt: new Date(Date.now() - 7 * 60 * 60 * 1000)
        }
    });
    try {
        const run = await runIngestion(runOptions());
        assert.equal(run.status, 'complete');
        assert.equal(calls.claims.length, 1);
        assert.ok(calls.claims[0].filter.$or.some((clause) => clause.startedAt?.$lt));
    } finally {
        restore();
    }
});

test('an active ingestion run still blocks a second run unless forced', async () => {
    const active = { status: 'running', startedAt: new Date() };
    let stubs = stubIngestionRuns({ existing: active });
    try {
        await assert.rejects(runIngestion(runOptions()), (error) => error.status === 409);
        assert.equal(stubs.calls.claims.length, 0);
    } finally {
        stubs.restore();
    }

    stubs = stubIngestionRuns({ existing: active });
    try {
        const run = await runIngestion(runOptions({ force: true }));
        assert.equal(run.status, 'complete');
        assert.deepEqual(stubs.calls.claims[0].filter, { runKey: 'daily:2026-10-19:2026-10-19' });
    } finally {
        stubs.restore();
    }

    // A concurrent claim between the read and the upsert collides on runKey.
    stubs = stubIngestionRuns({
        existing: null,
        claimError: Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
    });
    try {
        await assert.rejects(runIngestion(runOptions()), (error) => error.status === 409);
    } finally {
        stubs.restore();
    }
});

const { createGemmaClient } = require('../services/gemmaClient');
const { parseShareSansarHistory } = require('../collectors/marketParsers');
const { collectShareSansarHistory } = require('../collectors/marketCollectors');
const { parseCliOptions } = require('../scripts/cliOptions');
const {
    planImpactCorpusFromDatabase
} = require('../services/corpusSelectionService');

test('Gemma client retries a network failure while reading the response body', async () => {
    let calls = 0;
    const waits = [];
    const v1Candidate = {
        language: 'en',
        summary: 'The notice changes capital requirements for listed banks.',
        sentiment: 'neutral',
        sectors: ['Banking'],
        symbols: [],
        tags: ['regulation'],
        confidenceBand: 'medium',
        rationale: 'The notice is regulatory and its market direction is unclear.',
        evidence: ['The notice changes capital requirements for listed banks.']
    };
    const fetchImpl = async () => {
        calls += 1;
        if (calls === 1) {
            return {
                ok: true,
                status: 200,
                headers: { get: () => null },
                text: async () => {
                    const error = new Error('network timeout at: https://generativelanguage.googleapis.com');
                    error.type = 'body-timeout';
                    throw error;
                }
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
                                args: v1Candidate
                            }
                        }]
                    }
                }]
            })
        };
    };
    const client = createGemmaClient({
        apiKey: 'test-key',
        fetchImpl,
        sleepFn: async (ms) => waits.push(ms),
        random: () => 0,
        pacer: { wait: async () => {} },
        config: {
            gemmaModel: 'gemma-test',
            gemmaMaxAttempts: 3,
            gemmaBackoffBaseMs: 1000,
            requestTimeoutMs: 1000,
            schemaVersion: 1
        }
    });

    const response = await client.structureDocument({
        title: 'Notice',
        excerpt: 'The notice changes capital requirements for listed banks.'
    });

    assert.equal(calls, 2);
    assert.deepEqual(waits, [1000]);
    assert.equal(response.candidate.sentiment, 'neutral');
});

test('ShareSansar history skips undated rows instead of aborting the backfill', async () => {
    const rows = parseShareSansarHistory({
        data: [
            { current: '2510', published_date: '2026-06-10 00:00:00' },
            { current: '2500' },
            { current: '2490', published_date: 'not a date' },
            null
        ]
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].marketDate.toISOString(), '2026-06-10T00:00:00.000Z');

    const collected = await collectShareSansarHistory({
        from: '2026-06-10',
        to: '2026-06-10',
        httpClient: {
            request: async () => ({
                data: [{ current: '2510', published_date: '2026-06-10' }, { current: '1' }]
            })
        }
    });
    assert.equal(collected.length, 1);
});

test('CLI boolean flags work with or without an explicit value', () => {
    assert.deepEqual(
        parseCliOptions([
            '--force',
            '--document-only',
            '--dry-run=false',
            '--output=exports/a=b.jsonl',
            '--output-empty='
        ]),
        {
            force: 'true',
            'document-only': 'true',
            'dry-run': 'false',
            output: 'exports/a=b.jsonl',
            'output-empty': ''
        }
    );
});

test('corpus planning streams documents instead of loading the archive at once', async () => {
    const documents = [
        {
            _id: new mongoose.Types.ObjectId(),
            title: 'Nabil Bank reports quarterly profit',
            language: 'en',
            source: { name: 'ShareSansar', section: 'financial-analysis', publishedAt: new Date('2026-01-02') },
            text: { cleaned: 'Nabil Bank net profit rose in the quarterly report.', contentHash: 'a' }
        },
        {
            _id: new mongoose.Types.ObjectId(),
            title: 'Workshop on smartphone photography',
            language: 'en',
            source: { name: 'Online Khabar', publishedAt: new Date('2026-01-03') },
            text: { cleaned: 'A training workshop for smartphone photography was held.', contentHash: 'b' }
        }
    ];
    let streamed = 0;
    const restorers = [
        stub(MarketSecurity, {
            find: () => ({ select: () => ({ lean: async () => [nabilSecurity] }) })
        }),
        stub(MarketDocument, {
            find: () => ({
                select: () => ({
                    lean: () => ({
                        cursor: async function* cursor() {
                            for (const document of documents) {
                                streamed += 1;
                                yield document;
                            }
                        }
                    })
                })
            })
        })
    ];
    try {
        const plan = await planImpactCorpusFromDatabase({
            targets: { direct: 1, indirect: 0, hard_negative: 1 }
        });
        assert.equal(streamed, 2);
        assert.equal(plan.availableCounts.total, 2);
        assert.deepEqual(
            plan.selected.map((row) => row.bucket).sort(),
            ['direct', 'hard_negative']
        );
    } finally {
        restoreAll(restorers);
    }
});

const { collectRegulatoryDocuments } = require('../collectors/documentCollectors');

test('one failing regulatory attachment does not discard its siblings', async () => {
    const page = 'https://www.nrb.org.np/monetary-notice/';
    const responses = {
        'https://www.nrb.org.np/category/monetary-policy/': `
            <ul class="arrowed-list"><li>
              <a href="${page}">Monetary policy notice</a>
              <span class="icon-pdf"></span>
              <span class="text-muted">2026-10-01</span>
            </li></ul>`,
        [page]: {
            body: Buffer.from('<a href="/a.pdf">A</a> <a href="/b.pdf">B</a>'),
            url: page,
            contentType: 'text/html'
        },
        'https://www.nrb.org.np/b.pdf': {
            body: Buffer.from('%PDF b'),
            url: 'https://www.nrb.org.np/b.pdf',
            contentType: 'application/pdf'
        }
    };
    const httpClient = {
        request: async (url) => {
            if (url === 'https://www.nrb.org.np/a.pdf') {
                throw Object.assign(new Error(`GET ${url} failed with 503`), { status: 503 });
            }
            return responses[url] ?? '<html></html>';
        }
    };

    const documents = await collectRegulatoryDocuments({
        from: '2026-10-01',
        to: '2026-10-01',
        maxPages: 1,
        httpClient,
        pdfParser: async () => ({ text: 'Nepal Rastra Bank revised the policy rate for banks.' })
    });

    assert.deepEqual(
        documents.map((document) => [document.url, document.ingestionStatus]),
        [
            ['https://www.nrb.org.np/a.pdf', 'failed'],
            ['https://www.nrb.org.np/b.pdf', 'complete']
        ]
    );
    assert.match(documents[0].extractionError, /503/);
    assert.equal(documents[1].pageUrl, page);
});

const {
    getReviewStats,
    markRevalidationResolved
} = require('../services/labelQueueService');
const { importRevalidationAudit } = require('../services/revalidationAuditService');
const {
    sourceKeyFromName,
    sourceNameFilter
} = require('../services/sourcePlanningService');
const {
    feedSourceName,
    parseCalendarDate
} = require('../collectors/documentCollectors');

test('v1 review stats count only v1 labels and reviewed edits', async () => {
    const pipelines = [];
    let editedQuery;
    const restore = stub(MarketLabel, {
        aggregate: async (pipeline) => {
            pipelines.push(pipeline);
            return [];
        },
        countDocuments: async (query) => {
            editedQuery = query;
            return 0;
        }
    });
    try {
        await getReviewStats({ schemaVersion: 1 });
        for (const pipeline of pipelines) {
            assert.deepEqual(pipeline[0].$match['model.schemaVersion'], { $ne: 2 });
        }
        assert.deepEqual(editedQuery['model.schemaVersion'], { $ne: 2 });
        assert.deepEqual(editedQuery.status, { $in: ['approved', 'rejected'] });
    } finally {
        restore();
    }
});

test('an audit does not re-flag labels already cleared for it under another source', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const labelId = new mongoose.Types.ObjectId();
    const job = {
        revalidationAudit: {
            needsReview: true,
            source: 'training-run-error-audit'
        },
        revisions: []
    };
    markRevalidationResolved(job, 'reviewer-1');
    assert.deepEqual(job.revalidationAudit.resolvedSources, ['training-run-error-audit']);

    // A later taxonomy audit flagged and cleared the label, replacing `source`.
    const stored = {
        _id: labelId,
        revalidationAudit: {
            ...job.revalidationAudit,
            source: 'taxonomy-consistency-audit',
            needsReview: false,
            resolvedSources: ['training-run-error-audit', 'taxonomy-consistency-audit']
        },
        revisions: [{ action: 'revalidation_resolved' }]
    };
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-gyan-audit-'));
    const auditPath = path.join(directory, 'audit.json');
    fs.writeFileSync(auditPath, JSON.stringify([{
        id: labelId.toString(),
        priorityScore: 9,
        models: ['xlmr'],
        reasons: ['direction disagreement']
    }]));
    let bulkWrites = 0;
    const restore = stub(MarketLabel, {
        find: () => ({ select: () => ({ lean: async () => [stored] }) }),
        bulkWrite: async () => {
            bulkWrites += 1;
            return {};
        }
    });
    try {
        const result = await importRevalidationAudit({ auditPath, schemaVersion: 2 });
        assert.equal(result.imported, 0);
        assert.equal(result.skippedResolved, 1);
        assert.equal(bulkWrites, 0);
    } finally {
        restore();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('source buckets tolerate collector name variants', () => {
    assert.equal(sourceKeyFromName('OnlineKhabar Business'), 'onlinekhabar');
    assert.equal(sourceKeyFromName('बिजनेस – Page 24 – Online Khabar'), 'onlinekhabar');
    assert.equal(sourceKeyFromName('KathmanduPost'), 'kathmandupost');
    assert.match('OnlineKhabar Business', sourceNameFilter('onlinekhabar'));
    assert.match('बिजनेस – Online Khabar', sourceNameFilter('onlinekhabar'));
    assert.equal(feedSourceName('बिजनेस – Page 24 – Online Khabar', 'fallback'), 'बिजनेस – Online Khabar');
    assert.equal(feedSourceName('', 'OnlineKhabar Business'), 'OnlineKhabar Business');
});

test('ISO calendar dates keep their day in timezones west of UTC', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
        assert.equal(
            parseCalendarDate('2026-10-01').toISOString(),
            '2026-10-01T00:00:00.000Z'
        );
        assert.equal(
            parseCalendarDate('Oct 1, 2026').toISOString(),
            '2026-10-01T00:00:00.000Z'
        );
        assert.ok(Number.isNaN(parseCalendarDate('not a date').getTime()));
    } finally {
        if (originalTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimezone;
    }
});

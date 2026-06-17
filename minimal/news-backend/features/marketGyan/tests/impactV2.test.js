const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const {
    validateCandidateV2
} = require('../services/candidateValidationService');
const {
    buildFunctionDeclarationV2,
    buildPromptV2
} = require('../services/gemmaClient');
const {
    findMentionedSecurities
} = require('../services/securityAliasService');
const {
    selectImpactCorpus
} = require('../services/corpusSelectionService');
const {
    alignTradingSessions,
    computeReactionRecord
} = require('../services/marketReactionService');
const {
    adjudicatedLabelToExport,
    adjudicateLabelV2,
    exportApprovedLabels,
    listQueue,
    saveAnnotationV2
} = require('../services/labelQueueService');
const {
    candidateDiffFields
} = require('../services/assistantReviewService');
const {
    batchAdjudicateSubmitted,
    rebalanceAudit
} = require('../services/goldDatasetService');
const {
    selectHardNegativeExclusions
} = require('../services/rebalancePatchService');
const MarketAnnotation = require('../models/MarketAnnotation');
const MarketLabel = require('../models/MarketLabel');
const MarketSecurity = require('../models/MarketSecurity');
const {
    splitNumberedSentences
} = require('../services/sentenceService');

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

test('v2 validation accepts a grounded direct event', () => {
    const result = validateCandidateV2(directCandidate, {
        sentences,
        allowedSymbols: ['NABIL']
    });

    assert.equal(result.valid, true, result.errors.join('; '));
    assert.deepEqual(result.candidate.evidence, sentences.map((item) => item.text));
});

test('v2 validation enforces hard-negative consistency and sentence IDs', () => {
    const result = validateCandidateV2({
        ...directCandidate,
        relevance: 'not_relevant',
        evidenceSentenceIds: ['S99']
    }, {
        sentences,
        allowedSymbols: ['NABIL']
    });

    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /not_relevant/);
    assert.match(result.errors.join(' '), /unknown evidence sentence IDs/);
});

test('v2 Gemma prompt is relevance-first and exposes numbered evidence only', () => {
    const prompt = buildPromptV2({
        title: 'Quarterly result',
        excerpt: sentences.map((item) => item.text).join(' '),
        sentences
    });
    const declaration = buildFunctionDeclarationV2({
        allowedSymbols: ['NABIL']
    });

    assert.match(prompt, /First decide whether/);
    assert.match(prompt, /\[S1\]/);
    assert.match(prompt, /not_relevant/);
    assert.deepEqual(
        declaration.parameters.properties.symbols.items.enum,
        ['NABIL']
    );
    assert.equal(
        declaration.parameters.properties.evidenceSentenceIds.minItems,
        1
    );
});

test('assistant audit reports only fields changed from the original proposal', () => {
    assert.deepEqual(candidateDiffFields(directCandidate, {
        ...directCandidate,
        impactDirection: 'uncertain',
        evidenceSentenceIds: ['S1']
    }), ['impactDirection', 'evidenceSentenceIds']);
});

test('assistant-reviewed labels can append a submitted annotation revision', () => {
    const label = new MarketLabel({
        document: new mongoose.Types.ObjectId(),
        idempotencyKey: 'assistant-annotation-revision-test',
        status: 'pending_review',
        input: {
            title: 'Nabil Bank quarterly result',
            excerpt: sentences.map((item) => item.text).join(' '),
            contentHash: 'assistant-annotation-content-hash',
            sentences
        },
        model: {
            schemaVersion: 2
        },
        originalCandidate: directCandidate,
        candidate: directCandidate,
        assistantReview: {
            candidate: directCandidate,
            changedFields: [],
            reviewer: 'codex',
            reviewedAt: new Date()
        },
        revisions: [{
            action: 'generated',
            candidate: directCandidate,
            actor: 'gemma'
        }, {
            action: 'assistant_reviewed',
            candidate: directCandidate,
            actor: 'codex'
        }]
    });

    label.revisions.push({
        action: 'annotation_submitted',
        candidate: directCandidate,
        actor: 'reviewer-1'
    });

    assert.equal(label.validateSync(), undefined);
});

test('company aliases map bilingual mentions to a registered symbol', () => {
    const matches = findMentionedSecurities({
        title: 'नबिल बैंकको नाफा बढ्यो',
        excerpt: 'बैंकले त्रैमासिक विवरण सार्वजनिक गरेको छ।'
    }, [{
        symbol: 'NABIL',
        name: 'Nabil Bank Limited',
        sector: 'Banking',
        aliases: [{
            value: 'नबिल बैंक',
            language: 'ne',
            kind: 'transliteration'
        }]
    }]);

    assert.deepEqual(matches.map((item) => item.symbol), ['NABIL']);
});

test('corpus selection reaches the 300/100/100 plan without a source above 60 percent', () => {
    const rows = [];
    const sources = ['sharesansar', 'onlinekhabar', 'kathmandupost', 'regulatory'];
    const directEvents = [
        'market_trading',
        'earnings',
        'capital_action',
        'governance',
        'project_operations',
        'credit_financing'
    ];
    const indirectEvents = [
        'regulation',
        'monetary_liquidity',
        'fiscal_macroeconomic',
        'sector_industry'
    ];
    for (const [bucket, count] of Object.entries({
        direct: 300,
        indirect: 100,
        hard_negative: 100
    })) {
        for (let index = 0; index < count; index += 1) {
            rows.push({
                documentId: `${bucket}-${index}`,
                contentHash: `${bucket}-${index}`,
                bucket,
                eventHint: bucket === 'direct'
                    ? directEvents[index % directEvents.length]
                    : (
                        bucket === 'indirect'
                            ? indirectEvents[index % indirectEvents.length]
                            : 'not_applicable'
                    ),
                score: 100 - (index % 10),
                source: sources[index % sources.length],
                language: index % 2 ? 'en' : 'ne',
                symbolCount: bucket === 'direct' ? 1 : 0,
                publishedAt: index,
                duplicateGroupId: `${bucket}-${index}`,
                symbols: bucket === 'direct' ? ['NABIL'] : []
            });
        }
    }

    const plan = selectImpactCorpus(rows);

    assert.equal(plan.quotaCompliant, true);
    assert.deepEqual(plan.counts.bucket, {
        direct: 300,
        indirect: 100,
        hard_negative: 100
    });
    assert.equal(plan.counts.secondReview, 110);
    assert.ok(Math.max(...Object.values(plan.counts.source)) <= 300);
    assert.deepEqual(plan.quotaChecks, {
        target: true,
        bucketComposition: true,
        noReserves: true,
        sourceCap: true,
        languageCoverage: true,
        symbolCoverage: true,
        eventCoverage: true
    });
});

test('corpus selection excludes exact duplicate content hashes', () => {
    const rows = [
        {
            documentId: 'first',
            contentHash: 'same-content',
            bucket: 'direct',
            eventHint: 'earnings',
            score: 100,
            source: 'sharesansar',
            language: 'en',
            symbolCount: 1,
            publishedAt: 1
        },
        {
            documentId: 'second',
            contentHash: 'same-content',
            bucket: 'direct',
            eventHint: 'earnings',
            score: 90,
            source: 'sharesansar',
            language: 'en',
            symbolCount: 1,
            publishedAt: 2
        }
    ];

    const plan = selectImpactCorpus(rows, {
        targets: { direct: 1, indirect: 0, hard_negative: 0 },
        maxSourceShare: 1,
        secondReviewTarget: 0,
        requirements: {
            minimumLanguages: {},
            minimumSymbolLevel: 0,
            minimumEventCount: 0
        }
    });

    assert.equal(plan.selected.length, 1);
    assert.equal(plan.selected[0].documentId, 'first');
    assert.equal(plan.availableCounts.excludedExactDuplicates, 1);
});

test('market reactions use the last close before publication and later trading sessions', () => {
    const snapshots = [
        { marketDate: new Date('2026-01-01T00:00:00Z'), index: { close: 100 } },
        { marketDate: new Date('2026-01-02T00:00:00Z'), index: { close: 102 } },
        { marketDate: new Date('2026-01-05T00:00:00Z'), index: { close: 103 } },
        { marketDate: new Date('2026-01-06T00:00:00Z'), index: { close: 105 } }
    ];
    const sessions = alignTradingSessions(
        snapshots,
        new Date('2026-01-02T04:00:00Z')
    );

    assert.equal(sessions.baseline.index.close, 100);
    assert.equal(sessions.first.index.close, 102);
    assert.equal(sessions.third.index.close, 105);
});

test('reaction records explicitly retain unavailable symbol returns', () => {
    const label = {
        _id: new mongoose.Types.ObjectId(),
        document: new mongoose.Types.ObjectId(),
        input: { publishedAt: new Date('2026-01-02T04:00:00Z') },
        adjudication: {
            goldCandidate: {
                sectors: [],
                symbols: ['NABIL']
            }
        }
    };
    const record = computeReactionRecord({
        label,
        snapshots: [
            { marketDate: new Date('2026-01-01T00:00:00Z'), index: { close: 100 } },
            { marketDate: new Date('2026-01-02T00:00:00Z'), index: { close: 102 } },
            { marketDate: new Date('2026-01-05T00:00:00Z'), index: { close: 103 } },
            { marketDate: new Date('2026-01-06T00:00:00Z'), index: { close: 105 } }
        ]
    });

    assert.equal(record.index.firstSessionReturn, 2);
    assert.match(record.missingFields.join(' '), /symbol.NABIL.returns/);
    assert.equal(record.status, 'partial');
});

test('v2 export retains generated, gold, annotations, and duplicate group audit data', () => {
    const job = {
        _id: new mongoose.Types.ObjectId(),
        document: new mongoose.Types.ObjectId(),
        ontologyVersion: 'nepse-impact-ontology-v1',
        input: {
            title: 'Result',
            excerpt: 'Evidence',
            sentences: [{ id: 'S1', text: 'Evidence' }],
            contentHash: 'content-hash',
            duplicateGroupId: 'duplicate-group',
            selectionBucket: 'direct',
            sourceName: 'ShareSansar',
            sourceUrl: 'https://example.com',
            publishedAt: new Date()
        },
        originalCandidate: directCandidate,
        adjudication: {
            goldCandidate: directCandidate,
            adjudicatedAt: new Date(),
            adjudicatedBy: 'reviewer-3'
        },
        model: { schemaVersion: 2 }
    };
    const row = adjudicatedLabelToExport(job, [{
        reviewerId: 'reviewer-1',
        reviewerRole: 'primary',
        status: 'submitted',
        annotation: directCandidate
    }]);

    assert.equal(row.schemaVersion, 2);
    assert.equal(row.gold.relevance, 'direct');
    assert.equal(row.annotations.length, 1);
    assert.equal(row.duplicateGroupId, 'duplicate-group');
});

test('v2 review stores an independent submitted annotation without creating gold', async () => {
    const originalDistinct = MarketSecurity.distinct;
    const originalUpdate = MarketAnnotation.findOneAndUpdate;
    let captured;
    MarketSecurity.distinct = async () => ['NABIL'];
    MarketAnnotation.findOneAndUpdate = async (query, update) => {
        captured = { query, update };
        return {
            reviewerId: 'reviewer-1',
            reviewerRole: 'primary',
            status: 'submitted'
        };
    };
    const job = {
        _id: new mongoose.Types.ObjectId(),
        input: { sentences },
        revisions: [],
        validate: async () => {},
        save: async () => {}
    };
    try {
        await saveAnnotationV2(job, {
            action: 'submit',
            candidate: directCandidate,
            reviewer: 'reviewer-1',
            reviewerRole: 'primary'
        });
        assert.equal(captured.update.$set.status, 'submitted');
        assert.equal(job.adjudication, undefined);
        assert.equal(job.revisions[0].action, 'annotation_submitted');
    } finally {
        MarketSecurity.distinct = originalDistinct;
        MarketAnnotation.findOneAndUpdate = originalUpdate;
    }
});

test('review queue excludes labels already resolved by the current reviewer', async () => {
    const originalDistinct = MarketAnnotation.distinct;
    const originalAnnotationFind = MarketAnnotation.find;
    const originalLabelFind = MarketLabel.find;
    const originalCount = MarketLabel.countDocuments;
    const reviewedId = new mongoose.Types.ObjectId();
    const actionableId = new mongoose.Types.ObjectId();
    let capturedQuery;

    MarketAnnotation.distinct = async (field, query) => {
        assert.equal(field, 'label');
        assert.deepEqual(query, {
            reviewerId: 'reviewer-1',
            status: { $in: ['submitted', 'rejected'] }
        });
        return [reviewedId];
    };
    MarketLabel.find = (query) => {
        capturedQuery = query;
        return {
            select: () => ({
                sort: () => ({
                    skip: () => ({
                        limit: () => ({
                            lean: async () => [{
                                _id: actionableId,
                                input: { title: 'Next actionable record' }
                            }]
                        })
                    })
                })
            })
        };
    };
    MarketLabel.countDocuments = async () => 1;
    MarketAnnotation.find = () => ({
        lean: async () => []
    });

    try {
        const result = await listQueue({
            schemaVersion: 2,
            status: 'pending_review',
            reviewerId: 'reviewer-1',
            reviewerRole: 'primary'
        });

        assert.deepEqual(capturedQuery._id, { $nin: [reviewedId] });
        assert.equal(result.total, 1);
        assert.equal(result.items[0]._id, actionableId);
        assert.equal(result.items[0].currentAnnotation, null);
    } finally {
        MarketAnnotation.distinct = originalDistinct;
        MarketAnnotation.find = originalAnnotationFind;
        MarketLabel.find = originalLabelFind;
        MarketLabel.countDocuments = originalCount;
    }
});

test('only an adjudicator can create a v2 gold label', async () => {
    const job = {
        _id: new mongoose.Types.ObjectId(),
        input: { sentences },
        revisions: [],
        save: async () => {}
    };
    await assert.rejects(
        adjudicateLabelV2(job, {
            action: 'adjudicate',
            candidate: directCandidate,
            reviewer: 'reviewer-1',
            reviewerRole: 'primary'
        }),
        /Only an adjudicator/
    );
});

test('batch adjudication dry-run validates submitted annotations without mutation', async () => {
    const originalAnnotationFind = MarketAnnotation.find;
    const originalLabelFind = MarketLabel.find;
    const originalCount = MarketLabel.countDocuments;
    const originalDistinct = MarketSecurity.distinct;
    const originalUpdate = MarketLabel.findOneAndUpdate;
    const labelId = new mongoose.Types.ObjectId();
    let mutated = false;

    MarketAnnotation.find = () => ({
        sort: () => ({
            lean: async () => [{
                _id: new mongoose.Types.ObjectId(),
                label: labelId,
                reviewerId: 'reviewer-1',
                reviewerRole: 'primary',
                status: 'submitted',
                annotation: directCandidate,
                submittedAt: new Date()
            }]
        })
    });
    MarketLabel.find = () => ({
        select: () => ({
            lean: async () => [{
                _id: labelId,
                status: 'pending_review',
                input: { sentences },
                model: { schemaVersion: 2 },
                adjudication: { status: 'pending' }
            }]
        })
    });
    MarketLabel.countDocuments = async () => 2;
    MarketSecurity.distinct = async () => ['NABIL'];
    MarketLabel.findOneAndUpdate = async () => {
        mutated = true;
    };

    try {
        const result = await batchAdjudicateSubmitted({
            schemaVersion: 2,
            dryRun: true
        });

        assert.equal(result.ready, true);
        assert.equal(result.valid, 1);
        assert.equal(result.adjudicatable, 1);
        assert.equal(result.adjudicated, 0);
        assert.equal(result.skipped.withoutSubmittedAnnotation, 1);
        assert.equal(mutated, false);
    } finally {
        MarketAnnotation.find = originalAnnotationFind;
        MarketLabel.find = originalLabelFind;
        MarketLabel.countDocuments = originalCount;
        MarketSecurity.distinct = originalDistinct;
        MarketLabel.findOneAndUpdate = originalUpdate;
    }
});

test('batch adjudication copies submitted primary annotations into gold labels', async () => {
    const originalAnnotationFind = MarketAnnotation.find;
    const originalLabelFind = MarketLabel.find;
    const originalCount = MarketLabel.countDocuments;
    const originalDistinct = MarketSecurity.distinct;
    const originalUpdate = MarketLabel.findOneAndUpdate;
    const labelId = new mongoose.Types.ObjectId();
    let captured;

    MarketAnnotation.find = () => ({
        sort: () => ({
            lean: async () => [{
                _id: new mongoose.Types.ObjectId(),
                label: labelId,
                reviewerId: 'reviewer-1',
                reviewerRole: 'primary',
                status: 'submitted',
                annotation: directCandidate,
                submittedAt: new Date()
            }]
        })
    });
    MarketLabel.find = () => ({
        select: () => ({
            lean: async () => [{
                _id: labelId,
                status: 'pending_review',
                input: { sentences },
                model: { schemaVersion: 2 },
                adjudication: { status: 'pending' }
            }]
        })
    });
    MarketLabel.countDocuments = async () => 1;
    MarketSecurity.distinct = async () => ['NABIL'];
    MarketLabel.findOneAndUpdate = async (query, update, options) => {
        captured = { query, update, options };
        return { _id: labelId };
    };

    try {
        const result = await batchAdjudicateSubmitted({
            schemaVersion: 2,
            reviewer: 'adjudicator-1',
            dryRun: false
        });

        assert.equal(result.adjudicated, 1);
        assert.equal(captured.query._id, labelId.toString());
        assert.equal(captured.update.$set.status, 'approved');
        assert.equal(
            captured.update.$set.adjudication.goldCandidate.relevance,
            'direct'
        );
        assert.equal(captured.update.$push.revisions.action, 'adjudicated');
        assert.equal(captured.options.runValidators, true);
    } finally {
        MarketAnnotation.find = originalAnnotationFind;
        MarketLabel.find = originalLabelFind;
        MarketLabel.countDocuments = originalCount;
        MarketSecurity.distinct = originalDistinct;
        MarketLabel.findOneAndUpdate = originalUpdate;
    }
});

test('rebalance audit reports quota deficits and surplus exclusion candidates', async () => {
    const originalLabelFind = MarketLabel.find;
    const hardNegative = {
        ...directCandidate,
        summary: 'The article is general business coverage without a concrete NEPSE impact mechanism.',
        relevance: 'not_relevant',
        eventType: 'not_applicable',
        impactScope: 'none',
        impactDirection: 'not_applicable',
        impactHorizon: 'not_applicable',
        impactMechanism: 'none',
        sectors: [],
        symbols: [],
        confidenceBand: 'medium',
        rationale: 'The source text does not identify a listed company, sector mechanism, or market-wide NEPSE channel.',
        evidenceSentenceIds: ['S1']
    };
    const indirect = {
        ...directCandidate,
        relevance: 'indirect',
        eventType: 'fiscal_macroeconomic',
        impactScope: 'market',
        impactDirection: 'uncertain',
        impactMechanism: 'valuation_sentiment',
        symbols: [],
        sectors: ['Banking']
    };
    const rows = [];
    for (let index = 0; index < 299; index += 1) {
        rows.push({
            _id: new mongoose.Types.ObjectId(),
            input: {
                title: `Direct ${index}`,
                sourceName: 'ShareSansar',
                publishedAt: new Date(index),
                duplicateGroupId: `direct-${index}`
            },
            adjudication: { goldCandidate: directCandidate }
        });
    }
    for (let index = 0; index < 100; index += 1) {
        rows.push({
            _id: new mongoose.Types.ObjectId(),
            input: {
                title: `Indirect ${index}`,
                sourceName: 'Online Khabar',
                publishedAt: new Date(index),
                duplicateGroupId: `indirect-${index}`
            },
            adjudication: { goldCandidate: indirect }
        });
    }
    for (let index = 0; index < 101; index += 1) {
        rows.push({
            _id: new mongoose.Types.ObjectId(),
            input: {
                title: `Hard negative ${index}`,
                sourceName: 'Online Khabar',
                publishedAt: new Date(index),
                duplicateGroupId: `negative-${index}`
            },
            adjudication: { goldCandidate: hardNegative }
        });
    }

    MarketLabel.find = () => ({
        select: () => ({
            lean: async () => rows
        })
    });

    try {
        const result = await rebalanceAudit({
            schemaVersion: 2,
            target: 500,
            basis: 'gold'
        });

        assert.equal(result.coverage.records, 500);
        assert.equal(result.gate.ready, false);
        assert.equal(result.recommendations.additionsNeeded.direct, 1);
        assert.equal(result.recommendations.surplus.not_relevant, 1);
        assert.equal(result.recommendations.excludeCandidates.length, 1);
    } finally {
        MarketLabel.find = originalLabelFind;
    }
});

test('hard-negative surplus selection is deterministic for rebalance exclusions', () => {
    const labels = [
        {
            _id: 'online-low',
            input: {
                sourceName: 'Online Khabar',
                publishedAt: '2026-01-02T00:00:00.000Z'
            },
            adjudication: {
                status: 'adjudicated',
                goldCandidate: {
                    relevance: 'not_relevant',
                    confidenceBand: 'low'
                }
            }
        },
        {
            _id: 'sharesansar-high',
            input: {
                sourceName: 'ShareSansar',
                publishedAt: '2026-01-03T00:00:00.000Z'
            },
            adjudication: {
                status: 'adjudicated',
                goldCandidate: {
                    relevance: 'not_relevant',
                    confidenceBand: 'high'
                }
            }
        },
        {
            _id: 'sharesansar-low',
            input: {
                sourceName: 'ShareSansar',
                publishedAt: '2026-01-01T00:00:00.000Z'
            },
            adjudication: {
                status: 'adjudicated',
                goldCandidate: {
                    relevance: 'not_relevant',
                    confidenceBand: 'low'
                }
            }
        },
        {
            _id: 'direct',
            input: {
                sourceName: 'ShareSansar',
                publishedAt: '2026-01-01T00:00:00.000Z'
            },
            adjudication: {
                status: 'adjudicated',
                goldCandidate: {
                    relevance: 'direct',
                    confidenceBand: 'low'
                }
            }
        }
    ];

    const selected = selectHardNegativeExclusions(labels, 2);

    assert.deepEqual(
        selected.map((label) => label._id),
        ['sharesansar-low', 'sharesansar-high']
    );
});

test('v2 export query excludes pending and rejected records', async () => {
    const originalLabelFind = MarketLabel.find;
    const originalAnnotationFind = MarketAnnotation.find;
    let labelQuery;
    MarketLabel.find = (query) => {
        labelQuery = query;
        return {
            sort: () => ({
                lean: async () => []
            })
        };
    };
    MarketAnnotation.find = () => ({
        sort: () => ({
            lean: async () => []
        })
    });
    try {
        const rows = await exportApprovedLabels({ schemaVersion: 2 });
        assert.deepEqual(labelQuery, {
            'model.schemaVersion': 2,
            'adjudication.status': 'adjudicated'
        });
        assert.deepEqual(rows, []);
    } finally {
        MarketLabel.find = originalLabelFind;
        MarketAnnotation.find = originalAnnotationFind;
    }
});

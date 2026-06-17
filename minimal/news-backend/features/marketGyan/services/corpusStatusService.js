const MarketDocument = require('../models/MarketDocument');
const MarketLabel = require('../models/MarketLabel');
const MarketSecurity = require('../models/MarketSecurity');
const { marketGyanConfig } = require('../config');
const {
    validateCandidate,
    validateCandidateV2
} = require('./candidateValidationService');
const { sourceKeyFromName } = require('./sourcePlanningService');

const increment = (object, key, amount = 1) => {
    object[key] = (object[key] || 0) + amount;
};

const groupBySource = (rows, valueKey = 'count') => {
    const result = {};
    for (const row of rows) {
        const source = sourceKeyFromName(row._id?.source);
        if (!result[source]) result[source] = {};
        increment(result[source], row._id?.status || 'total', row[valueKey] || 0);
    }
    return result;
};

const mentionedSymbols = (input, allowedSymbols) => {
    const allowed = new Set(allowedSymbols);
    const tokens = `${input.title || ''} ${input.excerpt || ''}`
        .match(/[A-Z][A-Z0-9.-]{1,14}/g) || [];
    return Array.from(new Set(tokens.filter((token) => allowed.has(token))));
};

const getCorpusStatus = async ({
    target = marketGyanConfig.reviewTarget,
    schemaVersion = marketGyanConfig.schemaVersion
} = {}) => {
    const version = Number(schemaVersion);
    const labelMatch = { 'model.schemaVersion': version };
    const [
        documentRows,
        documentRange,
        labelRows,
        candidateRows,
        languageRows,
        approvedSentimentRows,
        tokenRows,
        duplicateRows,
        pending,
        symbols,
        goldLabels
    ] = await Promise.all([
        MarketDocument.aggregate([
            {
                $group: {
                    _id: {
                        source: '$source.name',
                        status: '$ingestion.status'
                    },
                    count: { $sum: 1 }
                }
            }
        ]),
        MarketDocument.aggregate([
            {
                $match: {
                    'ingestion.status': { $in: ['complete', 'partial'] }
                }
            },
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 },
                    min: { $min: '$source.publishedAt' },
                    max: { $max: '$source.publishedAt' }
                }
            }
        ]),
        MarketLabel.aggregate([
            { $match: labelMatch },
            {
                $group: {
                    _id: {
                        source: '$input.sourceName',
                        status: '$status'
                    },
                    count: { $sum: 1 }
                }
            }
        ]),
        MarketLabel.aggregate([
            { $match: { ...labelMatch, status: 'pending_review' } },
            {
                $group: {
                    _id: version === 2
                        ? '$candidate.impactDirection'
                        : '$candidate.sentiment',
                    count: { $sum: 1 }
                }
            }
        ]),
        MarketLabel.aggregate([
            { $match: { ...labelMatch, status: 'pending_review' } },
            {
                $group: {
                    _id: '$candidate.language',
                    count: { $sum: 1 }
                }
            }
        ]),
        MarketLabel.aggregate([
            {
                $match: version === 2
                    ? { ...labelMatch, 'adjudication.status': 'adjudicated' }
                    : { ...labelMatch, status: 'approved' }
            },
            {
                $group: {
                    _id: version === 2
                        ? '$adjudication.goldCandidate.impactDirection'
                        : '$candidate.sentiment',
                    count: { $sum: 1 }
                }
            }
        ]),
        MarketLabel.aggregate([
            { $match: labelMatch },
            {
                $group: {
                    _id: null,
                    totalTokens: { $sum: '$usage.totalTokens' }
                }
            }
        ]),
        MarketLabel.aggregate([
            { $match: labelMatch },
            {
                $group: {
                    _id: '$idempotencyKey',
                    count: { $sum: 1 }
                }
            },
            { $match: { count: { $gt: 1 } } }
        ]),
        MarketLabel.find({ ...labelMatch, status: 'pending_review' })
            .select('candidate input')
            .lean(),
        MarketSecurity.distinct('symbol', { active: true }),
        version === 2
            ? MarketLabel.find({
                ...labelMatch,
                'adjudication.status': 'adjudicated'
            }).select('input adjudication.goldCandidate').lean()
            : Promise.resolve([])
    ]);

    const labelsBySource = groupBySource(labelRows);
    const statusCounts = {};
    for (const row of labelRows) increment(statusCounts, row._id.status, row.count);
    const pendingCount = statusCounts.pending_review || 0;
    const candidateTargetCount = version === 2
        ? pendingCount + (statusCounts.approved || 0)
        : pendingCount;
    const approvedSentiments = Object.fromEntries(
        approvedSentimentRows.map((row) => [row._id, row.count])
    );
    const approvedCount = statusCounts.approved || 0;
    const resolvedCount = approvedCount + (statusCounts.rejected || 0);
    const goldCounts = {
        relevance: {},
        language: {},
        eventType: {},
        direction: {},
        source: {},
        symbolLevel: 0
    };
    for (const label of goldLabels) {
        const gold = label.adjudication?.goldCandidate || {};
        for (const [field, output] of [
            ['relevance', goldCounts.relevance],
            ['language', goldCounts.language],
            ['eventType', goldCounts.eventType],
            ['impactDirection', goldCounts.direction]
        ]) {
            increment(output, gold[field] || 'missing');
        }
        increment(goldCounts.source, sourceKeyFromName(label.input?.sourceName));
        if ((gold.symbols || []).length) goldCounts.symbolLevel += 1;
    }
    const goldTotal = goldLabels.length;
    const coreEvents = [
        'market_trading',
        'earnings',
        'capital_action',
        'governance',
        'project_operations',
        'credit_financing',
        'regulation',
        'monetary_liquidity',
        'fiscal_macroeconomic',
        'sector_industry'
    ];
    const v2TrainingReady = (
        goldTotal === marketGyanConfig.reviewTarget
        && (goldCounts.relevance.direct || 0) === 300
        && (goldCounts.relevance.indirect || 0) === 100
        && (goldCounts.relevance.not_relevant || 0) === 100
        && (goldCounts.language.ne || 0) >= 200
        && (goldCounts.language.en || 0) >= 200
        && goldCounts.symbolLevel >= 150
        && (goldCounts.direction.bullish || 0) >= 60
        && (goldCounts.direction.bearish || 0) >= 60
        && coreEvents.every((event) => (goldCounts.eventType[event] || 0) >= 20)
        && Math.max(0, ...Object.values(goldCounts.source))
            <= Math.floor(marketGyanConfig.reviewTarget * 0.6)
    );
    const trainingReady = version === 2
        ? v2TrainingReady
        : (
            resolvedCount >= marketGyanConfig.reviewTarget
            && approvedCount >= marketGyanConfig.approvedTarget
            && ['bullish', 'bearish', 'neutral'].every(
                (sentiment) => (
                    (approvedSentiments[sentiment] || 0)
                    >= marketGyanConfig.minApprovedPerSentiment
                )
            )
        );
    const pendingShares = {};
    for (const [source, counts] of Object.entries(labelsBySource)) {
        pendingShares[source] = pendingCount
            ? (counts.pending_review || 0) / pendingCount
            : 0;
    }

    let invalidPending = 0;
    let excerptTooLong = 0;
    for (const label of pending) {
        if (String(label.input?.excerpt || '').length > 1500) excerptTooLong += 1;
        const validation = version === 2
            ? validateCandidateV2(label.candidate, {
                sentences: label.input?.sentences || [],
                allowedSymbols: symbols
            })
            : validateCandidate(label.candidate, {
                excerpt: label.input?.excerpt || '',
                allowedSymbols: mentionedSymbols(label.input || {}, symbols)
            });
        if (!validation.valid) {
            invalidPending += 1;
        }
    }

    return {
        generatedAt: new Date(),
        schemaVersion: version,
        target: Number(target),
        targetReached: candidateTargetCount >= Number(target),
        trainingReady,
        documents: {
            eligible: documentRange[0]?.count || 0,
            dateRange: {
                from: documentRange[0]?.min || null,
                to: documentRange[0]?.max || null
            },
            bySource: groupBySource(documentRows)
        },
        candidates: {
            total: Object.values(statusCounts).reduce((sum, value) => sum + value, 0),
            byStatus: statusCounts,
            bySource: labelsBySource,
            pendingSourceShares: pendingShares,
            sentiment: Object.fromEntries(candidateRows.map((row) => [row._id, row.count])),
            language: Object.fromEntries(languageRows.map((row) => [row._id, row.count])),
            approvedSentiment: approvedSentiments,
            gold: version === 2 ? goldCounts : undefined,
            tokens: tokenRows[0]?.totalTokens || 0
        },
        validation: {
            duplicateIdempotencyKeys: duplicateRows.length,
            invalidPending,
            excerptTooLong,
            maxSourceShare: Object.values(pendingShares).length
                ? Math.max(...Object.values(pendingShares))
                : 0
        }
    };
};

module.exports = {
    getCorpusStatus,
    groupBySource
};

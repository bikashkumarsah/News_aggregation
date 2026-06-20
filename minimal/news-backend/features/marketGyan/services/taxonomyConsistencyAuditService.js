const MarketLabel = require('../models/MarketLabel');
const { marketGyanConfig } = require('../config');

const AUDIT_SOURCE = 'taxonomy-consistency-audit';

const normalizeText = (value) => String(value || '').toLowerCase();

const joinedText = (label) => normalizeText([
    label.input?.title,
    label.input?.excerpt
].filter(Boolean).join(' '));

const hasAny = (text, patterns) => patterns.some((pattern) => pattern.test(text));

const expectedTaxonomy = (label) => {
    const text = joinedText(label);
    const title = normalizeText(label.input?.title);

    const debt = hasAny(title, [
        /\bdebenture\b/,
        /\bbond\b/,
        /ऋणपत्र/,
        /\b(secures?|obtains?|arranges?|raises?)\b[^.]{0,80}\b(loan|debt|financing)\b/,
        /\b(loan|debt|financing)\b[^.]{0,80}\b(secured|arranged|raised)\b/,
        /(?:कर्जा|ऋण)[^।]{0,60}(?:जुट्यो|पायो|स्वीकृत|लगानी सम्झौता)/
    ]);
    if (debt) {
        return {
            bucket: 'debt-financing',
            eventType: 'credit_financing',
            impactMechanism: 'financing_liquidity',
            reason: 'Debenture, debt, bond, or loan records should use credit_financing.'
        };
    }

    const dividendDecision = hasAny(text, [
        /no dividend/,
        /not distribute dividend/,
        /\bproposes?\b[^.]{0,100}\bdividend\b/,
        /\bannounces?\b[^.]{0,100}\bdividend\b/,
        /\bdeclares?\b[^.]{0,100}\bdividend\b/,
        /\bdistribute\b[^.]{0,100}\bdividend\b/,
        /cash dividend/,
        /bonus dividend/,
        /लाभांश/,
        /बोनस लाभांश/,
        /नगद लाभांश/
    ]);
    const bonusListing = hasAny(title, [
        /bonus shares?.*(listed|now listed|listed in nepse)/,
        /(listed|now listed|listed in nepse).*bonus shares?/
    ]);
    if (dividendDecision && !bonusListing) {
        return {
            bucket: 'dividend-decision',
            eventType: 'earnings',
            impactMechanism: 'earnings_cash_flow',
            reason: 'Dividend proposal or no-dividend decisions should use earnings.'
        };
    }

    const rightShare = hasAny(text, [
        /right shares?/,
        /rights shares?/,
        /हकप्रद/
    ]);
    if (rightShare) {
        return {
            bucket: 'right-share',
            eventType: 'capital_action',
            impactMechanism: 'ownership_supply',
            reason: 'Right-share records should use capital_action and ownership_supply.'
        };
    }

    const ipoFpoListing = hasAny(text, [
        /\bipo\b/,
        /\bfpo\b/,
        /public issue/,
        /initial public/,
        /allotment/,
        /(?:unit|bonus|right|ordinary|promoter|local|general public)[^.]{0,80}shares?.*(?:listed|listed in nepse|now listed)/,
        /(?:listed|listed in nepse|now listed)[^.]{0,80}(?:unit|bonus|right|ordinary|promoter|local|general public)[^.]{0,80}shares?/,
        /सूचीकृत/,
        /निष्कासन/,
        /बाँडफाँड/
    ]);
    if (ipoFpoListing) {
        return {
            bucket: 'ipo-fpo-listing-allotment',
            eventType: 'capital_action',
            impactMechanism: 'ownership_supply',
            reason: 'IPO, FPO, listing, and allotment records should use capital_action.'
        };
    }

    const marketSummary = hasAny(text, [
        /nepse[^.]{0,120}(closes|concludes|gains|loss|turnover|slumps|rises|plunges)/,
        /(weekly summary|sector comparison|index leads decline)/,
        /नेप्से[^।]{0,120}(बढ|घट|कारोबार|सूचक|बन्द)/
    ]);
    if (marketSummary) {
        return {
            bucket: 'market-summary',
            eventType: 'market_trading',
            impactMechanism: 'market_flow',
            reason: 'NEPSE index, turnover, and weekly-summary records should use market_trading.'
        };
    }

    return null;
};

const recommendationFor = (label) => {
    const gold = label.adjudication?.goldCandidate || {};
    const expected = expectedTaxonomy(label);
    if (!expected) return null;

    const reasons = [];
    if (gold.relevance === 'not_relevant') {
        reasons.push(
            `${expected.bucket}: likely market-relevant but currently not_relevant`
        );
    }
    if (gold.eventType !== expected.eventType) {
        reasons.push(
            `${expected.bucket}: eventType ${gold.eventType || 'missing'} -> ${expected.eventType}`
        );
    }
    if (gold.impactMechanism !== expected.impactMechanism) {
        reasons.push(
            `${expected.bucket}: impactMechanism ${gold.impactMechanism || 'missing'} -> ${expected.impactMechanism}`
        );
    }
    if (!reasons.length) return null;

    return {
        id: label._id.toString(),
        title: label.input?.title,
        source: label.input?.sourceName,
        publishedAt: label.input?.publishedAt,
        priorityScore: gold.relevance === 'not_relevant' ? 10 : 8,
        models: ['taxonomy-consistency-audit'],
        reasons: [
            expected.reason,
            ...reasons
        ],
        current: {
            relevance: gold.relevance,
            eventType: gold.eventType,
            impactMechanism: gold.impactMechanism,
            impactDirection: gold.impactDirection
        },
        recommended: {
            eventType: expected.eventType,
            impactMechanism: expected.impactMechanism
        },
        bucket: expected.bucket
    };
};

const auditTaxonomyRows = (labels) => {
    const rows = labels
        .map(recommendationFor)
        .filter(Boolean)
        .sort((left, right) => (
            right.priorityScore - left.priorityScore
            || left.bucket.localeCompare(right.bucket)
            || String(left.publishedAt || '').localeCompare(String(right.publishedAt || ''))
            || left.id.localeCompare(right.id)
        ));
    const byBucket = {};
    for (const row of rows) {
        byBucket[row.bucket] = (byBucket[row.bucket] || 0) + 1;
    }
    return {
        source: AUDIT_SOURCE,
        auditRows: rows.length,
        byBucket,
        rows
    };
};

const importTaxonomyRows = async ({
    rows,
    schemaVersion,
    actor,
    force = false
}) => {
    const ids = rows.map((row) => row.id);
    if (!ids.length) {
        return {
            imported: 0,
            matched: 0,
            modified: 0,
            skippedActive: 0,
            skippedResolved: 0,
            missing: []
        };
    }
    const existing = await MarketLabel.find({
        _id: { $in: ids },
        'model.schemaVersion': Number(schemaVersion)
    }).select('_id revalidationAudit revisions.action').lean();
    const skippedActive = existing
        .filter((row) => (
            !force
            && row.revalidationAudit?.source === AUDIT_SOURCE
            && row.revalidationAudit?.needsReview === true
        ))
        .map((row) => row._id.toString());
    const skippedResolved = existing
        .filter((row) => (
            !force
            && row.revalidationAudit?.source === AUDIT_SOURCE
            && (
                row.revalidationAudit?.needsReview === false
                || (row.revisions || []).some(
                    (revision) => revision.action === 'revalidation_resolved'
                )
            )
        ))
        .map((row) => row._id.toString());
    const skippedActiveIds = new Set(skippedActive);
    const skippedResolvedIds = new Set(skippedResolved);
    const existingIds = new Set(
        existing
            .map((row) => row._id.toString())
            .filter((id) => !skippedActiveIds.has(id))
            .filter((id) => !skippedResolvedIds.has(id))
    );
    const now = new Date();
    const operations = rows
        .filter((row) => existingIds.has(row.id))
        .map((row) => ({
            updateOne: {
                filter: { _id: row.id },
                update: {
                    $set: {
                        'revalidationAudit.needsReview': true,
                        'revalidationAudit.source': AUDIT_SOURCE,
                        'revalidationAudit.priorityScore': row.priorityScore,
                        'revalidationAudit.models': row.models,
                        'revalidationAudit.reasons': row.reasons,
                        'revalidationAudit.importedAt': now,
                        'revalidationAudit.importedBy': actor
                    },
                    $unset: {
                        'revalidationAudit.resolvedAt': 1,
                        'revalidationAudit.resolvedBy': 1
                    },
                    $push: {
                        revisions: {
                            action: 'revalidation_flagged',
                            reason: row.reasons.join('; ').slice(0, 1000),
                            actor,
                            at: now
                        }
                    }
                }
            }
        }));
    const result = operations.length
        ? await MarketLabel.bulkWrite(operations, { ordered: false })
        : { matchedCount: 0, modifiedCount: 0 };
    return {
        imported: operations.length,
        matched: result.matchedCount || operations.length,
        modified: result.modifiedCount || 0,
        skippedActive: skippedActive.length,
        skippedResolved: skippedResolved.length,
        missing: ids
            .filter((id) => !existingIds.has(id))
            .filter((id) => !skippedActiveIds.has(id))
            .filter((id) => !skippedResolvedIds.has(id))
    };
};

const runTaxonomyConsistencyAudit = async ({
    schemaVersion = marketGyanConfig.schemaVersion,
    actor = marketGyanConfig.reviewerId,
    importToReview = false,
    force = false
} = {}) => {
    const labels = await MarketLabel.find({
        'model.schemaVersion': Number(schemaVersion),
        'adjudication.status': 'adjudicated'
    })
        .select('_id input adjudication.goldCandidate model')
        .lean();
    const report = auditTaxonomyRows(labels);
    if (!importToReview) {
        return {
            ...report,
            imported: 0,
            matched: 0,
            modified: 0,
            missing: []
        };
    }
    return {
        ...report,
        ...(await importTaxonomyRows({
            rows: report.rows,
            schemaVersion,
            actor,
            force
        }))
    };
};

module.exports = {
    AUDIT_SOURCE,
    auditTaxonomyRows,
    expectedTaxonomy,
    runTaxonomyConsistencyAudit
};

const MarketAnnotation = require('../models/MarketAnnotation');
const MarketLabel = require('../models/MarketLabel');
const MarketSecurity = require('../models/MarketSecurity');
const { marketGyanConfig } = require('../config');
const { validateCandidateV2 } = require('./candidateValidationService');
const { sourceKeyFromName } = require('./sourcePlanningService');
const { splitNumberedSentences } = require('./sentenceService');

const CORE_EVENT_TYPES = Object.freeze([
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
]);

const DEFAULT_REQUIREMENTS = Object.freeze({
    relevance: Object.freeze({
        direct: 300,
        indirect: 100,
        not_relevant: 100
    }),
    minEnglish: 200,
    minNepali: 200,
    minSymbolLevel: 150,
    minCoreEvent: 20,
    minBullish: 60,
    minBearish: 60,
    maxSourceShare: 0.6
});

const increment = (object, key, amount = 1) => {
    object[key || 'missing'] = (object[key || 'missing'] || 0) + amount;
};

const objectIdString = (value) => String(value?._id || value || '');

const labelSentences = (label) => (
    Array.isArray(label.input?.sentences) && label.input.sentences.length
        ? label.input.sentences
        : splitNumberedSentences(label.input?.excerpt || '')
);

const buildValidationContext = async () => ({
    allowedSymbols: await MarketSecurity.distinct('symbol', { active: true })
});

const annotationCandidate = (annotation) => (
    annotation?.annotation?.toObject?.() || annotation?.annotation || {}
);

const loadSubmittedPrimaryAnnotations = async () => MarketAnnotation.find({
    status: 'submitted',
    reviewerRole: 'primary'
})
    .sort({ submittedAt: 1, _id: 1 })
    .lean();

const validateSubmittedAnnotations = async ({
    schemaVersion = marketGyanConfig.schemaVersion
} = {}) => {
    const version = Number(schemaVersion);
    const annotations = await loadSubmittedPrimaryAnnotations();
    const labelIds = annotations.map((annotation) => annotation.label);
    const labels = await MarketLabel.find({
        _id: { $in: labelIds },
        'model.schemaVersion': version
    })
        .select('input model adjudication status')
        .lean();
    const labelsById = new Map(labels.map((label) => [
        objectIdString(label._id),
        label
    ]));
    const { allowedSymbols } = await buildValidationContext();
    const valid = [];
    const invalid = [];
    const alreadyAdjudicated = [];
    const missingLabels = [];

    for (const annotation of annotations) {
        const label = labelsById.get(objectIdString(annotation.label));
        if (!label) {
            missingLabels.push({
                annotationId: objectIdString(annotation._id),
                labelId: objectIdString(annotation.label)
            });
            continue;
        }
        const validation = validateCandidateV2(annotationCandidate(annotation), {
            sentences: labelSentences(label),
            allowedSymbols
        });
        const row = {
            annotationId: objectIdString(annotation._id),
            labelId: objectIdString(label._id),
            reviewerId: annotation.reviewerId,
            submittedAt: annotation.submittedAt,
            candidate: validation.candidate,
            status: label.status
        };
        if (label.adjudication?.status === 'adjudicated') {
            alreadyAdjudicated.push(row);
        } else if (validation.valid) {
            valid.push(row);
        } else {
            invalid.push({
                ...row,
                errors: validation.errors
            });
        }
    }

    const totalLabels = await MarketLabel.countDocuments({
        'model.schemaVersion': version
    });

    return {
        schemaVersion: version,
        totalLabels,
        submitted: annotations.length,
        valid: valid.length,
        invalid: invalid.length,
        alreadyAdjudicated: alreadyAdjudicated.length,
        missingLabels: missingLabels.length,
        validRows: valid,
        invalidRows: invalid,
        alreadyAdjudicatedRows: alreadyAdjudicated,
        missingLabelRows: missingLabels
    };
};

const batchAdjudicateSubmitted = async ({
    schemaVersion = marketGyanConfig.schemaVersion,
    reviewer = 'adjudicator-1',
    dryRun = true,
    force = false,
    reason = 'Batch adjudicated from submitted primary annotation'
} = {}) => {
    const summary = await validateSubmittedAnnotations({ schemaVersion });
    const actionable = force
        ? [
            ...summary.validRows,
            ...summary.alreadyAdjudicatedRows
        ]
        : summary.validRows;

    const result = {
        dryRun: Boolean(dryRun),
        force: Boolean(force),
        reviewer,
        schemaVersion: summary.schemaVersion,
        totalLabels: summary.totalLabels,
        submitted: summary.submitted,
        valid: summary.valid,
        invalid: summary.invalid,
        alreadyAdjudicated: summary.alreadyAdjudicated,
        missingLabels: summary.missingLabels,
        adjudicatable: actionable.length,
        adjudicated: 0,
        skipped: {
            alreadyAdjudicated: force ? 0 : summary.alreadyAdjudicated,
            invalid: summary.invalid,
            missingLabels: summary.missingLabels,
            withoutSubmittedAnnotation: Math.max(0, summary.totalLabels - summary.submitted)
        },
        invalidRows: summary.invalidRows.slice(0, 20),
        missingLabelRows: summary.missingLabelRows.slice(0, 20)
    };

    if (summary.invalid || summary.missingLabels) {
        result.ready = false;
        if (!dryRun) {
            const error = new Error(
                'Submitted annotations contain invalid or missing records; run dry-run for details'
            );
            error.summary = result;
            throw error;
        }
        return result;
    }

    result.ready = true;
    if (dryRun) return result;

    const adjudicatedAt = new Date();
    for (const row of actionable) {
        const updated = await MarketLabel.findOneAndUpdate(
            {
                _id: row.labelId,
                'model.schemaVersion': summary.schemaVersion,
                ...(force ? {} : { 'adjudication.status': { $ne: 'adjudicated' } })
            },
            {
                $set: {
                    status: 'approved',
                    adjudication: {
                        status: 'adjudicated',
                        goldCandidate: row.candidate,
                        reason,
                        adjudicatedBy: reviewer,
                        adjudicatedAt
                    },
                    reviewedAt: adjudicatedAt,
                    reviewer
                },
                $push: {
                    revisions: {
                        action: 'adjudicated',
                        candidate: row.candidate,
                        reason,
                        actor: reviewer,
                        at: adjudicatedAt
                    }
                }
            },
            { new: true, runValidators: true }
        );
        if (updated) result.adjudicated += 1;
    }

    return result;
};

const rowCandidate = (row, basis) => (
    basis === 'submitted'
        ? row.annotation
        : row.adjudication?.goldCandidate
);

const rowSource = (row, basis) => (
    basis === 'submitted'
        ? row.label?.input?.sourceName
        : row.input?.sourceName
);

const rowDuplicateGroup = (row, basis) => (
    basis === 'submitted'
        ? row.label?.input?.duplicateGroupId || row.label?.input?.contentHash
        : row.input?.duplicateGroupId || row.input?.contentHash
);

const rowTitle = (row, basis) => (
    basis === 'submitted'
        ? row.label?.input?.title
        : row.input?.title
);

const rowPublishedAt = (row, basis) => (
    basis === 'submitted'
        ? row.label?.input?.publishedAt
        : row.input?.publishedAt
);

const confidenceWeakness = (candidate) => ({
    low: 3,
    medium: 2,
    high: 0
}[candidate?.confidenceBand] || 1);

const summarizeRows = (rows, basis) => {
    const counts = {
        relevance: {},
        eventType: {},
        direction: {},
        language: {},
        sectors: {},
        source: {},
        duplicateGroup: {},
        symbolLevel: 0
    };

    for (const row of rows) {
        const candidate = rowCandidate(row, basis) || {};
        increment(counts.relevance, candidate.relevance);
        increment(counts.eventType, candidate.eventType);
        increment(counts.direction, candidate.impactDirection);
        increment(counts.language, candidate.language);
        increment(counts.source, sourceKeyFromName(rowSource(row, basis)));
        increment(counts.duplicateGroup, rowDuplicateGroup(row, basis));
        if ((candidate.symbols || []).length) counts.symbolLevel += 1;
        for (const sector of candidate.sectors || []) increment(counts.sectors, sector);
    }

    return counts;
};

const gateFromCoverage = ({ rows, coverage, target, requirements }) => {
    const errors = [];
    const sourceCap = Math.floor(target * requirements.maxSourceShare);
    if (rows.length !== target) {
        errors.push(`records ${rows.length} must equal ${target}`);
    }
    for (const [label, expected] of Object.entries(requirements.relevance)) {
        const observed = coverage.relevance[label] || 0;
        if (observed !== expected) {
            errors.push(`${label} records ${observed} must equal ${expected}`);
        }
    }
    if ((coverage.language.en || 0) < requirements.minEnglish) {
        errors.push(`English records ${coverage.language.en || 0} is below ${requirements.minEnglish}`);
    }
    if ((coverage.language.ne || 0) < requirements.minNepali) {
        errors.push(`Nepali records ${coverage.language.ne || 0} is below ${requirements.minNepali}`);
    }
    if (coverage.symbolLevel < requirements.minSymbolLevel) {
        errors.push(`symbol-level records ${coverage.symbolLevel} is below ${requirements.minSymbolLevel}`);
    }
    if ((coverage.direction.bullish || 0) < requirements.minBullish) {
        errors.push(`bullish records ${coverage.direction.bullish || 0} is below ${requirements.minBullish}`);
    }
    if ((coverage.direction.bearish || 0) < requirements.minBearish) {
        errors.push(`bearish records ${coverage.direction.bearish || 0} is below ${requirements.minBearish}`);
    }
    for (const eventType of CORE_EVENT_TYPES) {
        if ((coverage.eventType[eventType] || 0) < requirements.minCoreEvent) {
            errors.push(`${eventType} records ${coverage.eventType[eventType] || 0} is below ${requirements.minCoreEvent}`);
        }
    }
    const maxSourceCount = Math.max(0, ...Object.values(coverage.source));
    if (maxSourceCount > sourceCap) {
        errors.push(`largest source count ${maxSourceCount} exceeds ${sourceCap}`);
    }
    return {
        ready: errors.length === 0,
        errors,
        sourceCap
    };
};

const selectExclusionCandidates = ({ rows, basis, coverage, requirements, target }) => {
    const surplusNotRelevant = Math.max(
        0,
        (coverage.relevance.not_relevant || 0) - requirements.relevance.not_relevant
    );
    if (!surplusNotRelevant) return [];

    const sourceCap = Math.floor(target * requirements.maxSourceShare);
    const duplicateCounts = coverage.duplicateGroup;
    return rows
        .filter((row) => rowCandidate(row, basis)?.relevance === 'not_relevant')
        .map((row) => {
            const candidate = rowCandidate(row, basis);
            const source = sourceKeyFromName(rowSource(row, basis));
            const duplicateGroupId = rowDuplicateGroup(row, basis);
            const reasons = [];
            let score = confidenceWeakness(candidate);
            if ((coverage.source[source] || 0) > sourceCap) {
                score += 3;
                reasons.push('overrepresented source');
            }
            if ((duplicateCounts[duplicateGroupId] || 0) > 1) {
                score += 2;
                reasons.push('duplicate group');
            }
            if ((candidate.evidenceSentenceIds || []).length <= 1) {
                score += 1;
                reasons.push('minimal evidence');
            }
            if (candidate.confidenceBand !== 'high') {
                reasons.push(`${candidate.confidenceBand || 'unknown'} confidence`);
            }
            if (!reasons.length) reasons.push('surplus hard negative');
            return {
                id: objectIdString(row._id || row.label),
                title: rowTitle(row, basis),
                source,
                publishedAt: rowPublishedAt(row, basis),
                confidenceBand: candidate.confidenceBand,
                duplicateGroupId,
                score,
                reasons
            };
        })
        .sort((a, b) => (
            b.score - a.score
            || String(a.publishedAt || '').localeCompare(String(b.publishedAt || ''))
            || a.id.localeCompare(b.id)
        ))
        .slice(0, surplusNotRelevant);
};

const buildRebalanceRecommendations = ({ rows, basis, coverage, target, requirements }) => {
    const relevanceDeficits = {};
    const relevanceSurplus = {};
    for (const [label, expected] of Object.entries(requirements.relevance)) {
        const observed = coverage.relevance[label] || 0;
        if (observed < expected) relevanceDeficits[label] = expected - observed;
        if (observed > expected) relevanceSurplus[label] = observed - expected;
    }
    const eventDeficits = {};
    for (const eventType of CORE_EVENT_TYPES) {
        const observed = coverage.eventType[eventType] || 0;
        if (observed < requirements.minCoreEvent) {
            eventDeficits[eventType] = requirements.minCoreEvent - observed;
        }
    }
    const reaudits = rows
        .filter((row) => {
            const candidate = rowCandidate(row, basis) || {};
            return candidate.relevance !== 'not_relevant' && candidate.eventType === 'other';
        })
        .map((row) => ({
            id: objectIdString(row._id || row.label),
            title: rowTitle(row, basis),
            source: sourceKeyFromName(rowSource(row, basis)),
            publishedAt: rowPublishedAt(row, basis)
        }));

    return {
        additionsNeeded: relevanceDeficits,
        surplus: relevanceSurplus,
        eventPriorities: eventDeficits,
        reauditsOfOtherRelevant: reaudits,
        excludeCandidates: selectExclusionCandidates({
            rows,
            basis,
            coverage,
            requirements,
            target
        })
    };
};

const loadAuditRows = async ({ basis, schemaVersion }) => {
    if (basis === 'submitted') {
        return MarketAnnotation.find({
            status: 'submitted',
            reviewerRole: 'primary'
        })
            .populate({
                path: 'label',
                match: { 'model.schemaVersion': Number(schemaVersion) },
                select: 'input model status adjudication'
            })
            .lean()
            .then((rows) => rows.filter((row) => row.label));
    }
    return MarketLabel.find({
        'model.schemaVersion': Number(schemaVersion),
        'adjudication.status': 'adjudicated'
    })
        .select('input status adjudication model')
        .lean();
};

const rebalanceAudit = async ({
    schemaVersion = marketGyanConfig.schemaVersion,
    target = marketGyanConfig.reviewTarget,
    basis = 'gold',
    requirements = DEFAULT_REQUIREMENTS
} = {}) => {
    const parsedTarget = Number(target) || marketGyanConfig.reviewTarget;
    let resolvedBasis = basis;
    let rows = await loadAuditRows({
        basis: resolvedBasis,
        schemaVersion
    });
    if (resolvedBasis === 'auto' || (!rows.length && basis !== 'submitted')) {
        const submittedRows = await loadAuditRows({
            basis: 'submitted',
            schemaVersion
        });
        if (submittedRows.length > rows.length) {
            rows = submittedRows;
            resolvedBasis = 'submitted';
        } else {
            resolvedBasis = 'gold';
        }
    }
    const coverage = summarizeRows(rows, resolvedBasis);
    const gate = gateFromCoverage({
        rows,
        coverage,
        target: parsedTarget,
        requirements
    });
    return {
        generatedAt: new Date(),
        schemaVersion: Number(schemaVersion),
        basis: resolvedBasis,
        target: parsedTarget,
        requirements,
        coverage: {
            records: rows.length,
            relevance: coverage.relevance,
            eventType: coverage.eventType,
            direction: coverage.direction,
            language: coverage.language,
            sectors: coverage.sectors,
            source: coverage.source,
            sourceShare: Object.fromEntries(Object.entries(coverage.source).map(
                ([source, count]) => [source, rows.length ? count / rows.length : 0]
            )),
            duplicateGroups: Object.values(coverage.duplicateGroup)
                .filter((count) => count > 1).length,
            symbolLevel: coverage.symbolLevel
        },
        gate,
        recommendations: buildRebalanceRecommendations({
            rows,
            basis: resolvedBasis,
            coverage,
            target: parsedTarget,
            requirements
        })
    };
};

module.exports = {
    CORE_EVENT_TYPES,
    DEFAULT_REQUIREMENTS,
    batchAdjudicateSubmitted,
    rebalanceAudit,
    summarizeRows,
    validateSubmittedAnnotations
};

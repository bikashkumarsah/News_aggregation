const MarketLabel = require('../models/MarketLabel');
const MarketSecurity = require('../models/MarketSecurity');
const { validateCandidateV2 } = require('./candidateValidationService');
const { findMentionedSecurities } = require('./securityAliasService');

const REVIEW_FIELDS = Object.freeze([
    'language',
    'summary',
    'relevance',
    'eventType',
    'impactScope',
    'impactDirection',
    'impactHorizon',
    'impactMechanism',
    'sectors',
    'symbols',
    'tags',
    'confidenceBand',
    'rationale',
    'evidenceSentenceIds'
]);

const plainCandidate = (candidate) => (
    candidate?.toObject?.() || candidate || {}
);

const candidateDiffFields = (before = {}, after = {}) => REVIEW_FIELDS.filter(
    (field) => (
        JSON.stringify(before?.[field] ?? null)
        !== JSON.stringify(after?.[field] ?? null)
    )
);

const exportAssistantReviewBatch = async ({ limit = 25 } = {}) => {
    const parsedLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const jobs = await MarketLabel.find({
        'model.schemaVersion': 2,
        status: 'pending_review',
        'assistantReview.reviewedAt': { $exists: false }
    })
        .select('input originalCandidate candidate model ontologyVersion')
        .sort({ generatedAt: 1, createdAt: 1 })
        .limit(parsedLimit)
        .lean();

    return jobs.map((job) => ({
        id: job._id.toString(),
        title: job.input.title,
        sourceName: job.input.sourceName,
        sourceUrl: job.input.sourceUrl,
        publishedAt: job.input.publishedAt,
        selectionBucket: job.input.selectionBucket,
        sentences: job.input.sentences,
        originalCandidate: job.originalCandidate,
        currentCandidate: job.candidate,
        correctedCandidate: job.candidate,
        notes: ''
    }));
};

const applyAssistantReviews = async (rows, { reviewer = 'codex' } = {}) => {
    if (!Array.isArray(rows)) throw new Error('Assistant review input must be an array');
    const securities = await MarketSecurity.find({ active: true })
        .select('symbol name sector aliases')
        .lean();
    const summary = {
        considered: rows.length,
        reviewed: 0,
        corrected: 0,
        unchanged: 0,
        failed: []
    };

    for (const row of rows) {
        const job = await MarketLabel.findById(row.id);
        if (!job) {
            summary.failed.push({ id: row.id, errors: ['Review item not found'] });
            continue;
        }
        if (Number(job.model?.schemaVersion) !== 2 || job.status !== 'pending_review') {
            summary.failed.push({
                id: row.id,
                errors: [`Cannot assistant-review a ${job.status} schema-v${job.model?.schemaVersion} item`]
            });
            continue;
        }

        const symbols = findMentionedSecurities(job.input, securities)
            .map((security) => security.symbol);
        const validation = validateCandidateV2(row.correctedCandidate, {
            sentences: job.input.sentences,
            allowedSymbols: symbols
        });
        if (!validation.valid) {
            summary.failed.push({ id: row.id, errors: validation.errors });
            continue;
        }

        const original = plainCandidate(job.originalCandidate);
        const changedFields = candidateDiffFields(original, validation.candidate);
        job.assistantReview = {
            candidate: validation.candidate,
            changedFields,
            reviewer,
            notes: String(row.notes || '').trim(),
            reviewedAt: new Date()
        };
        job.candidate = validation.candidate;
        job.revisions.push({
            action: 'assistant_reviewed',
            candidate: validation.candidate,
            actor: reviewer,
            reason: changedFields.length
                ? `Corrected fields: ${changedFields.join(', ')}`
                : 'Confirmed generated candidate without changes'
        });
        await job.save();

        summary.reviewed += 1;
        if (changedFields.length) summary.corrected += 1;
        else summary.unchanged += 1;
    }

    return summary;
};

module.exports = {
    REVIEW_FIELDS,
    applyAssistantReviews,
    candidateDiffFields,
    exportAssistantReviewBatch
};

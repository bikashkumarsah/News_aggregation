const MarketDocument = require('../models/MarketDocument');
const MarketAnnotation = require('../models/MarketAnnotation');
const MarketLabel = require('../models/MarketLabel');
const MarketSecurity = require('../models/MarketSecurity');
const { marketGyanConfig } = require('../config');
const { createGemmaClient } = require('./gemmaClient');
const {
    validateCandidate,
    validateCandidateV2
} = require('./candidateValidationService');
const { ONTOLOGY_VERSION } = require('./taxonomyService');
const {
    SOURCE_BUCKETS,
    planSourceTargets,
    sourceKeyFromName,
    sourceNameFilter
} = require('./sourcePlanningService');
const {
    cleanText,
    contentHash,
    detectLanguage,
    truncateAtWord
} = require('./textService');
const { splitNumberedSentences } = require('./sentenceService');
const { findMentionedSecurities } = require('./securityAliasService');
const { withMongoRetry } = require('./mongoConnectionService');

const MAX_EXCERPT_LENGTH = 1500;
const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;
const SENTIMENTS = ['bullish', 'bearish', 'neutral'];

const modelScope = (config = marketGyanConfig) => ({
    'model.name': config.gemmaModel,
    'model.promptVersion': config.promptVersion,
    'model.schemaVersion': Number(config.schemaVersion)
});

const duplicateGroupId = (title, hash) => {
    const normalizedTitle = cleanText(title)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 14)
        .join(' ');
    return contentHash(normalizedTitle || hash).slice(0, 24);
};

const trainingGateFromCounts = ({
    approved = 0,
    approvedSentiments = {},
    resolved = 0,
    config = marketGyanConfig
} = {}) => {
    const errors = [];
    if (resolved < config.reviewTarget) {
        errors.push(
            `Resolved reviews ${resolved} is below required ${config.reviewTarget}`
        );
    }
    if (approved < config.approvedTarget) {
        errors.push(
            `Approved records ${approved} is below required ${config.approvedTarget}`
        );
    }
    for (const sentiment of SENTIMENTS) {
        const count = approvedSentiments[sentiment] || 0;
        if (count < config.minApprovedPerSentiment) {
            errors.push(
                `${sentiment} approvals ${count} is below required ${config.minApprovedPerSentiment}`
            );
        }
    }
    return {
        ready: !errors.length,
        resolved,
        approved,
        approvedSentiments,
        requirements: {
            reviewTarget: config.reviewTarget,
            approvedTarget: config.approvedTarget,
            minApprovedPerSentiment: config.minApprovedPerSentiment
        },
        errors
    };
};

const isTransientGemmaError = (error) => (
    error?.status === 429
    || error?.status >= 500
    || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error?.code)
    || /network timeout|socket hang up|fetch failed/i.test(String(error?.message || ''))
);

const getDocumentInput = (document) => {
    const article = document.article && typeof document.article === 'object'
        ? document.article
        : null;
    const title = cleanText(document.title || article?.title);
    const sourceText = document.text?.cleaned
        || document.text?.original
        || article?.content
        || article?.description;
    const excerpt = truncateAtWord(sourceText, MAX_EXCERPT_LENGTH);

    if (!title || !excerpt) {
        throw new Error('Document requires a title and cleaned text before structuring');
    }

    return {
        title,
        excerpt,
        contentHash: document.text?.contentHash || contentHash(title, excerpt),
        languageHint: document.language || detectLanguage(`${title} ${excerpt}`),
        sourceName: document.source?.name || article?.source,
        sourceUrl: document.source?.url || article?.url,
        publishedAt: document.source?.publishedAt || article?.publishedAt,
        marketContext: document.marketContext || null,
        sentences: splitNumberedSentences(excerpt),
        duplicateGroupId: duplicateGroupId(
            title,
            document.text?.contentHash || contentHash(title, excerpt)
        )
    };
};

const createIdempotencyKey = (input, config = marketGyanConfig) => contentHash(
    input.contentHash,
    config.gemmaModel,
    config.promptVersion,
    config.schemaVersion
);

const findMentionedSymbols = (input, allowedSymbols) => {
    const allowed = new Set(allowedSymbols.map((symbol) => String(symbol).toUpperCase()));
    const tokens = `${input.title || ''} ${input.excerpt || ''}`
        .match(/[A-Z][A-Z0-9.-]{1,14}/g) || [];
    return Array.from(new Set(tokens.filter((token) => allowed.has(token))));
};

const queueDocuments = async ({
    documentIds,
    source,
    limit = 100,
    config = marketGyanConfig,
    selectionById = {}
} = {}) => {
    const query = {
        'ingestion.status': { $in: ['complete', 'partial'] }
    };
    if (documentIds?.length) query._id = { $in: documentIds };
    const sourceFilter = sourceNameFilter(source);
    if (sourceFilter) query['source.name'] = sourceFilter;

    const existingDocumentIds = await MarketLabel.distinct('document', modelScope(config));
    if (!documentIds?.length && existingDocumentIds.length) {
        query._id = { $nin: existingDocumentIds };
    }

    const documents = await MarketDocument.find(query)
        .populate('article')
        .sort({ 'source.publishedAt': 1, _id: 1 })
        .limit(Math.min(Math.max(Number(limit) || 100, 1), 1000));

    const result = {
        considered: documents.length,
        queued: 0,
        existing: 0,
        skipped: []
    };

    for (const document of documents) {
        let input;
        try {
            input = getDocumentInput(document);
        } catch (error) {
            result.skipped.push({
                document: document._id.toString(),
                error: error.message
            });
            continue;
        }

        const idempotencyKey = createIdempotencyKey(input, config);
        const selection = selectionById[document._id.toString()];
        if (selection) {
            input.selectionBucket = selection.bucket;
            input.duplicateGroupId = selection.duplicateGroupId || input.duplicateGroupId;
        }
        const operation = await MarketLabel.updateOne(
            { idempotencyKey },
            {
                $setOnInsert: {
                    document: document._id,
                    idempotencyKey,
                    status: 'queued',
                    input,
                    model: {
                        provider: 'google',
                        name: config.gemmaModel,
                        promptVersion: config.promptVersion,
                        schemaVersion: config.schemaVersion
                    },
                    ontologyVersion: Number(config.schemaVersion) === 2
                        ? ONTOLOGY_VERSION
                        : undefined,
                    adjudication: {
                        status: 'pending',
                        secondReviewRequired: Boolean(selection?.secondReviewRequired)
                    }
                }
            },
            { upsert: true }
        );

        if (operation.upsertedCount) result.queued += 1;
        else result.existing += 1;
    }

    return result;
};

const recoverStaleJobs = async ({
    staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS),
    config
} = {}) => MarketLabel.updateMany(
    {
        status: 'processing',
        processingStartedAt: { $lt: staleBefore },
        ...(config ? modelScope(config) : {})
    },
    {
        $set: {
            status: 'queued',
            lastError: 'Recovered after an interrupted worker'
        },
        $unset: {
            processingStartedAt: 1
        }
    }
);

const claimNextJob = ({ source, config = marketGyanConfig } = {}) => MarketLabel.findOneAndUpdate(
    {
        status: 'queued',
        ...modelScope(config),
        ...(sourceNameFilter(source)
            ? { 'input.sourceName': sourceNameFilter(source) }
            : {})
    },
    {
        $set: {
            status: 'processing',
            processingStartedAt: new Date()
        },
        $inc: {
            attempts: 1
        }
    },
    {
        new: true,
        sort: { createdAt: 1 }
    }
);

const processQueuedLabels = async ({
    limit = 25,
    source,
    config = marketGyanConfig,
    client = createGemmaClient({ config })
} = {}) => {
    if (!config.structuringEnabled) {
        throw new Error(
            'Market Gyan structuring is disabled. Set MARKET_GYAN_STRUCTURING_ENABLED=true explicitly.'
        );
    }

    await withMongoRetry(
        () => recoverStaleJobs({ config }),
        {
            maxAttempts: Infinity,
            operationName: 'Recovering stale Market Gyan jobs'
        }
    );
    const securities = await withMongoRetry(
        () => MarketSecurity.find({ active: true })
            .select('symbol name sector aliases')
            .lean(),
        {
            maxAttempts: Infinity,
            operationName: 'Loading the NEPSE security registry'
        }
    );
    const summary = {
        processed: 0,
        pendingReview: 0,
        failed: 0,
        paused: false
    };
    const maximum = Math.max(1, Number(limit) || 1);
    const concurrency = Math.min(
        Math.max(1, Number(config.gemmaConcurrency) || 1),
        maximum
    );
    let claimed = 0;
    let consecutiveTransientFailures = 0;
    let stopRequested = false;
    const circuitBreakerFailures = Math.max(
        1,
        Number(config.gemmaCircuitBreakerFailures) || 3
    );

    const worker = async () => {
        while (claimed < maximum && !stopRequested) {
            claimed += 1;
            const job = await withMongoRetry(
                () => claimNextJob({ source, config }),
                {
                    maxAttempts: Infinity,
                    operationName: 'Claiming the next Market Gyan job'
                }
            );
            if (!job) return;

            try {
                const mentionedSecurities = findMentionedSecurities(job.input, securities);
                const mentionedSymbols = mentionedSecurities.map((security) => security.symbol);
                const response = await client.structureDocument(job.input, {
                    allowedSymbols: mentionedSymbols
                });
                const validation = Number(config.schemaVersion) === 2
                    ? validateCandidateV2(response.candidate, {
                        sentences: job.input.sentences,
                        allowedSymbols: mentionedSymbols
                    })
                    : validateCandidate(response.candidate, {
                        excerpt: job.input.excerpt,
                        allowedSymbols: mentionedSymbols
                    });

                if (!validation.valid) {
                    job.status = 'failed';
                    job.validationErrors = validation.errors;
                    job.lastError = 'Gemma output failed schema or evidence validation';
                    summary.failed += 1;
                } else {
                    job.status = 'pending_review';
                    job.originalCandidate = validation.candidate;
                    job.candidate = validation.candidate;
                    job.validationErrors = [];
                    job.generatedAt = new Date();
                    job.revisions.push({
                        action: 'generated',
                        candidate: validation.candidate,
                        actor: 'gemma'
                    });
                    summary.pendingReview += 1;
                }

                job.rawResponse = response.rawResponse;
                job.usage = response.usage;
                consecutiveTransientFailures = 0;
            } catch (error) {
                job.status = 'failed';
                job.lastError = error.message;
                job.rawResponse = error.response || null;
                summary.failed += 1;
                if (isTransientGemmaError(error)) {
                    consecutiveTransientFailures += 1;
                    if (consecutiveTransientFailures >= circuitBreakerFailures) {
                        stopRequested = true;
                        summary.paused = true;
                        summary.pauseReason = (
                            `${consecutiveTransientFailures} consecutive transient Gemma failures`
                        );
                    }
                } else {
                    consecutiveTransientFailures = 0;
                }
            } finally {
                job.processingStartedAt = undefined;
                await withMongoRetry(
                    () => job.save(),
                    {
                        maxAttempts: Infinity,
                        operationName: `Saving Market Gyan job ${job._id}`
                    }
                );
                summary.processed += 1;
            }
        }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return summary;
};

const buildRetryQuery = ({
    source,
    transientOnly = false,
    maxAttempts = 2,
    config
} = {}) => ({
    status: 'failed',
    ...(config ? modelScope(config) : {}),
        ...(sourceNameFilter(source)
            ? { 'input.sourceName': sourceNameFilter(source) }
            : {}),
        ...(transientOnly
            ? {
                'validationErrors.0': { $exists: false },
                attempts: { $lt: Math.max(1, Number(maxAttempts) || 2) }
            }
            : {})
});

const retryFailedLabels = async ({
    limit = 100,
    source,
    transientOnly = false,
    maxAttempts = 2,
    config = marketGyanConfig
} = {}) => {
    const jobs = await MarketLabel.find(buildRetryQuery({
        source,
        transientOnly,
        maxAttempts,
        config
    }))
        .sort({ updatedAt: 1 })
        .limit(Math.min(Math.max(Number(limit) || 100, 1), 1000));

    if (!jobs.length) return { queued: 0 };

    const ids = jobs.map((job) => job._id);
    await MarketLabel.updateMany(
        { _id: { $in: ids } },
        {
            $set: {
                status: 'queued',
                validationErrors: []
            },
            $unset: {
                lastError: 1,
                processingStartedAt: 1,
                rawResponse: 1,
                usage: 1
            }
        }
    );
    return { queued: ids.length };
};

const queueBalancedDocuments = async ({
    target = 450,
    config = marketGyanConfig
} = {}) => {
    const eligibleDocuments = await MarketDocument.find({
        'ingestion.status': { $in: ['complete', 'partial'] }
    }).select('_id source.name').lean();
    const existingLabels = await MarketLabel.find(modelScope(config))
        .select('document status input.sourceName').lean();
    const activeStatuses = new Set(['queued', 'processing', 'pending_review', 'approved']);
    const labelledDocuments = new Set(
        existingLabels.map((label) => label.document.toString())
    );
    const current = Object.fromEntries(SOURCE_BUCKETS.map((source) => [source, 0]));
    const available = Object.fromEntries(SOURCE_BUCKETS.map((source) => [source, 0]));

    for (const label of existingLabels) {
        if (!activeStatuses.has(label.status)) continue;
        const key = sourceKeyFromName(label.input?.sourceName);
        if (key in current) current[key] += 1;
    }
    for (const document of eligibleDocuments) {
        if (labelledDocuments.has(document._id.toString())) continue;
        const key = sourceKeyFromName(document.source?.name);
        if (key in available) available[key] += 1;
    }

    const plan = planSourceTargets({ target, current, available });
    const results = {};
    for (const source of SOURCE_BUCKETS) {
        const limit = plan.additions[source];
        if (!limit) {
            results[source] = { considered: 0, queued: 0, existing: 0, skipped: [] };
            continue;
        }
        results[source] = await queueDocuments({ source, limit, config });
    }
    return { current, available, plan, results };
};

const reviewLabelV1 = async (id, {
    action,
    candidate,
    reason,
    reviewer = 'local-reviewer'
} = {}) => {
    const job = await MarketLabel.findById(id);
    if (!job) return null;
    if (!['pending_review', 'approved', 'rejected'].includes(job.status)) {
        const error = new Error(`Cannot review a ${job.status} item`);
        error.status = 409;
        throw error;
    }

    const allowedSymbols = await MarketSecurity.distinct('symbol', { active: true });
    const nextCandidate = candidate || job.candidate?.toObject?.() || job.candidate;
    const validation = validateCandidate(nextCandidate, {
        excerpt: job.input.excerpt,
        allowedSymbols
    });

    if (action !== 'reject' && !validation.valid) {
        const error = new Error('Candidate is invalid');
        error.status = 400;
        error.validationErrors = validation.errors;
        throw error;
    }

    if (action === 'reject') {
        if (!String(reason || '').trim()) {
            const error = new Error('A rejection reason is required');
            error.status = 400;
            throw error;
        }
        job.status = 'rejected';
        job.rejectionReason = String(reason).trim().slice(0, 1000);
        job.revisions.push({
            action: 'rejected',
            candidate: validation.candidate,
            reason: job.rejectionReason,
            actor: reviewer
        });
    } else if (action === 'approve') {
        job.status = 'approved';
        job.candidate = validation.candidate;
        job.rejectionReason = undefined;
        job.revisions.push({
            action: 'approved',
            candidate: validation.candidate,
            actor: reviewer
        });
        await MarketDocument.findByIdAndUpdate(job.document, {
            $set: {
                'metadata.sectors': validation.candidate.sectors,
                'metadata.companies': validation.candidate.symbols,
                'metadata.tags': validation.candidate.tags,
                'sentiment.label': validation.candidate.sentiment,
                'sentiment.rationale': validation.candidate.rationale,
                'sentiment.model': `${job.model.name}:human-reviewed`
            }
        });
    } else if (action === 'save') {
        job.status = 'pending_review';
        job.candidate = validation.candidate;
        job.validationErrors = [];
        job.revisions.push({
            action: 'edited',
            candidate: validation.candidate,
            actor: reviewer
        });
    } else {
        const error = new Error('action must be save, approve, or reject');
        error.status = 400;
        throw error;
    }

    job.reviewedAt = new Date();
    job.reviewer = reviewer;
    await job.save();
    return job;
};

const validateReviewCandidateV2 = async (job, candidate) => {
    const allowedSymbols = await MarketSecurity.distinct('symbol', { active: true });
    const validation = validateCandidateV2(candidate, {
        sentences: job.input.sentences || splitNumberedSentences(job.input.excerpt),
        allowedSymbols
    });
    if (!validation.valid) {
        const error = new Error('Candidate is invalid');
        error.status = 400;
        error.validationErrors = validation.errors;
        throw error;
    }
    return validation.candidate;
};

const saveAnnotationV2 = async (job, {
    action,
    candidate,
    reason,
    reviewer,
    reviewerRole
}) => {
    if (!['primary', 'secondary', 'adjudicator'].includes(reviewerRole)) {
        const error = new Error('reviewerRole must be primary, secondary, or adjudicator');
        error.status = 400;
        throw error;
    }
    if (!['save', 'submit', 'reject'].includes(action)) {
        const error = new Error('v2 annotation action must be save, submit, or reject');
        error.status = 400;
        throw error;
    }
    if (action === 'reject' && !String(reason || '').trim()) {
        const error = new Error('A rejection reason is required');
        error.status = 400;
        throw error;
    }

    const normalized = action === 'reject'
        ? undefined
        : await validateReviewCandidateV2(job, candidate);
    const status = action === 'save'
        ? 'draft'
        : action === 'submit' ? 'submitted' : 'rejected';
    const rejectionReason = action === 'reject'
        ? String(reason).trim().slice(0, 1000)
        : undefined;
    job.revisions.push({
        action: status === 'submitted' ? 'annotation_submitted' : 'edited',
        candidate: normalized,
        reason: rejectionReason,
        actor: reviewer
    });
    job.reviewedAt = new Date();

    // Validate the label before persisting the independent annotation so a
    // schema mismatch cannot leave a submitted annotation without its audit.
    await job.validate();

    const annotation = await MarketAnnotation.findOneAndUpdate(
        { label: job._id, reviewerId: reviewer },
        {
            $set: {
                reviewerRole,
                status,
                annotation: normalized,
                rejectionReason,
                submittedAt: status === 'submitted' || status === 'rejected'
                    ? new Date()
                    : undefined
            }
        },
        { upsert: true, new: true, runValidators: true }
    );
    await job.save();
    return { job, annotation };
};

const adjudicateLabelV2 = async (job, {
    action,
    candidate,
    reason,
    reviewer,
    reviewerRole
}) => {
    if (reviewerRole !== 'adjudicator') {
        const error = new Error('Only an adjudicator can create a gold label');
        error.status = 403;
        throw error;
    }
    if (!['adjudicate', 'exclude'].includes(action)) {
        const error = new Error('adjudication action must be adjudicate or exclude');
        error.status = 400;
        throw error;
    }
    if (action === 'exclude' && !String(reason || '').trim()) {
        const error = new Error('An exclusion reason is required');
        error.status = 400;
        throw error;
    }

    if (action === 'exclude') {
        job.adjudication = {
            ...job.adjudication?.toObject?.(),
            status: 'excluded',
            reason: String(reason).trim().slice(0, 1000),
            adjudicatedBy: reviewer,
            adjudicatedAt: new Date(),
            goldCandidate: undefined
        };
        job.status = 'rejected';
        job.revisions.push({
            action: 'excluded',
            reason: job.adjudication.reason,
            actor: reviewer
        });
    } else {
        const normalized = await validateReviewCandidateV2(job, candidate);
        job.adjudication = {
            ...job.adjudication?.toObject?.(),
            status: 'adjudicated',
            goldCandidate: normalized,
            reason: String(reason || '').trim().slice(0, 1000) || undefined,
            adjudicatedBy: reviewer,
            adjudicatedAt: new Date()
        };
        job.status = 'approved';
        job.revisions.push({
            action: 'adjudicated',
            candidate: normalized,
            reason: job.adjudication.reason,
            actor: reviewer
        });
    }
    job.reviewedAt = new Date();
    job.reviewer = reviewer;
    await job.save();
    return job;
};

const reviewLabel = async (id, {
    action,
    candidate,
    reason,
    reviewer = marketGyanConfig.reviewerId,
    reviewerRole = marketGyanConfig.reviewerRole
} = {}) => {
    const job = await MarketLabel.findById(id);
    if (!job) return null;
    if (Number(job.model?.schemaVersion) !== 2) {
        return reviewLabelV1(id, { action, candidate, reason, reviewer });
    }
    if (!['pending_review', 'approved', 'rejected'].includes(job.status)) {
        const error = new Error(`Cannot review a ${job.status} item`);
        error.status = 409;
        throw error;
    }
    if (action === 'adjudicate' || action === 'exclude') {
        return adjudicateLabelV2(job, {
            action,
            candidate,
            reason,
            reviewer,
            reviewerRole
        });
    }
    return saveAnnotationV2(job, {
        action,
        candidate,
        reason,
        reviewer,
        reviewerRole
    });
};

const regenerateLabel = async (id, { reviewer = 'local-reviewer' } = {}) => {
    const job = await MarketLabel.findById(id);
    if (!job) return null;
    if (job.status === 'processing') {
        const error = new Error('Cannot regenerate an item while it is processing');
        error.status = 409;
        throw error;
    }
    if (Number(job.model?.schemaVersion) === 2) {
        const [annotationCount, adjudicated] = await Promise.all([
            MarketAnnotation.countDocuments({
                label: job._id,
                status: { $in: ['submitted', 'rejected'] }
            }),
            Promise.resolve(job.adjudication?.status !== 'pending')
        ]);
        if (annotationCount || adjudicated) {
            const error = new Error(
                'Cannot regenerate after an annotation was submitted or adjudicated'
            );
            error.status = 409;
            throw error;
        }
    }

    job.revisions.push({
        action: 'regenerated',
        candidate: job.candidate,
        actor: reviewer
    });
    job.status = 'queued';
    job.candidate = undefined;
    job.originalCandidate = undefined;
    job.validationErrors = [];
    job.rejectionReason = undefined;
    job.lastError = undefined;
    job.rawResponse = undefined;
    job.usage = undefined;
    job.assistantReview = undefined;
    job.generatedAt = undefined;
    job.reviewedAt = undefined;
    await job.save();
    return job;
};

const buildQueueQuery = (filters = {}) => {
    const query = {};
    if (filters.schemaVersion) {
        query['model.schemaVersion'] = Number(filters.schemaVersion);
    }
    if (filters.status) query.status = filters.status;
    if (filters.source) {
        query['input.sourceName'] = new RegExp(
            String(filters.source).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            'i'
        );
    }
    if (filters.language) query['candidate.language'] = filters.language;
    if (filters.sentiment) query['candidate.sentiment'] = filters.sentiment;
    if (filters.relevance) query['candidate.relevance'] = filters.relevance;
    if (filters.eventType) query['candidate.eventType'] = filters.eventType;
    if (filters.direction) query['candidate.impactDirection'] = filters.direction;
    if (filters.adjudicationStatus) {
        query['adjudication.status'] = filters.adjudicationStatus;
    }
    if (String(filters.secondReview) === 'true') {
        query['adjudication.secondReviewRequired'] = true;
    }
    if (filters.sector) query['candidate.sectors'] = filters.sector;
    if (String(filters.hasErrors) === 'true') {
        query['validationErrors.0'] = { $exists: true };
    }
    return query;
};

const listQueue = async ({
    page = 1,
    limit = 20,
    reviewerId = marketGyanConfig.reviewerId,
    reviewerRole = marketGyanConfig.reviewerRole,
    ...filters
} = {}) => {
    const parsedPage = Math.max(Number(page) || 1, 1);
    const parsedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const query = buildQueueQuery(filters);
    if (
        reviewerRole !== 'adjudicator'
        && String(filters.includeReviewed) !== 'true'
    ) {
        const reviewedLabelIds = await MarketAnnotation.distinct('label', {
            reviewerId,
            status: { $in: ['submitted', 'rejected'] }
        });
        if (reviewedLabelIds.length) {
            query._id = { $nin: reviewedLabelIds };
        }
    }
    const [items, total] = await Promise.all([
        MarketLabel.find(query)
            .select('-rawResponse')
            .sort({ createdAt: 1 })
            .skip((parsedPage - 1) * parsedLimit)
            .limit(parsedLimit)
            .lean(),
        MarketLabel.countDocuments(query)
    ]);

    const annotations = await MarketAnnotation.find({
        label: { $in: items.map((item) => item._id) },
        ...(reviewerRole === 'adjudicator' ? {} : { reviewerId })
    }).lean();
    const byLabel = new Map();
    for (const annotation of annotations) {
        const key = annotation.label.toString();
        if (!byLabel.has(key)) byLabel.set(key, []);
        byLabel.get(key).push(annotation);
    }

    return {
        items: items.map((item) => ({
            ...item,
            annotations: byLabel.get(item._id.toString()) || [],
            currentAnnotation: (byLabel.get(item._id.toString()) || [])
                .find((annotation) => annotation.reviewerId === reviewerId) || null
        })),
        total,
        page: parsedPage,
        pages: Math.max(1, Math.ceil(total / parsedLimit))
    };
};

const getReviewStats = async ({ schemaVersion = marketGyanConfig.schemaVersion } = {}) => {
    if (Number(schemaVersion) === 2) {
        const match = { 'model.schemaVersion': 2 };
        const [
            rows,
            annotationRows,
            adjudicationRows,
            goldRows,
            assistantRows
        ] = await Promise.all([
            MarketLabel.aggregate([
                { $match: match },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            MarketAnnotation.aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]),
            MarketLabel.aggregate([
                { $match: match },
                { $group: { _id: '$adjudication.status', count: { $sum: 1 } } }
            ]),
            MarketLabel.aggregate([
                {
                    $match: {
                        ...match,
                        'adjudication.status': 'adjudicated'
                    }
                },
                {
                    $group: {
                        _id: {
                            relevance: '$adjudication.goldCandidate.relevance',
                            direction: '$adjudication.goldCandidate.impactDirection',
                            language: '$adjudication.goldCandidate.language'
                        },
                        count: { $sum: 1 }
                    }
                }
            ]),
            MarketLabel.aggregate([
                {
                    $match: {
                        ...match,
                        'assistantReview.reviewedAt': { $exists: true }
                    }
                },
                {
                    $group: {
                        _id: null,
                        reviewed: { $sum: 1 },
                        corrected: {
                            $sum: {
                                $cond: [
                                    { $gt: [{ $size: { $ifNull: ['$assistantReview.changedFields', []] } }, 0] },
                                    1,
                                    0
                                ]
                            }
                        }
                    }
                }
            ])
        ]);
        const counts = Object.fromEntries(rows.map((row) => [row._id, row.count]));
        const annotationCounts = Object.fromEntries(
            annotationRows.map((row) => [row._id, row.count])
        );
        const adjudicationCounts = Object.fromEntries(
            adjudicationRows.map((row) => [row._id || 'pending', row.count])
        );
        return {
            schemaVersion: 2,
            reviewerId: marketGyanConfig.reviewerId,
            reviewerRole: marketGyanConfig.reviewerRole,
            targetAdjudicated: marketGyanConfig.reviewTarget,
            targetSecondReviewed: marketGyanConfig.secondReviewTarget,
            total: Object.values(counts).reduce((sum, count) => sum + count, 0),
            counts,
            annotationCounts,
            adjudicationCounts,
            goldDistribution: goldRows,
            assistantReviewed: assistantRows[0]?.reviewed || 0,
            assistantCorrected: assistantRows[0]?.corrected || 0,
            gemmaFailures: counts.failed || 0
        };
    }
    const [rows, sentimentRows] = await Promise.all([
        MarketLabel.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]),
        MarketLabel.aggregate([
            { $match: { status: 'approved' } },
            {
                $group: {
                    _id: '$candidate.sentiment',
                    count: { $sum: 1 }
                }
            }
        ])
    ]);
    const counts = Object.fromEntries(rows.map((row) => [row._id, row.count]));
    const approvedSentiments = Object.fromEntries(
        sentimentRows.map((row) => [row._id, row.count])
    );
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const reviewed = (counts.approved || 0) + (counts.rejected || 0);
    const edited = await MarketLabel.countDocuments({
        revisions: { $elemMatch: { action: 'edited' } }
    });

    return {
        targetApproved: marketGyanConfig.approvedTarget,
        targetReviewed: marketGyanConfig.reviewTarget,
        total,
        counts,
        approvalRate: reviewed ? (counts.approved || 0) / reviewed : 0,
        rejectionRate: reviewed ? (counts.rejected || 0) / reviewed : 0,
        editedRate: reviewed ? edited / reviewed : 0,
        gemmaFailures: counts.failed || 0,
        trainingGate: trainingGateFromCounts({
            approved: counts.approved || 0,
            approvedSentiments,
            resolved: reviewed
        })
    };
};

const approvedLabelToExport = (job) => ({
    id: job._id.toString(),
    documentId: job.document.toString(),
    title: job.input.title,
    excerpt: job.input.excerpt,
    contentHash: job.input.contentHash,
    source: {
        name: job.input.sourceName,
        url: job.input.sourceUrl
    },
    publishedAt: job.input.publishedAt,
    marketContext: job.input.marketContext || null,
    generated: job.originalCandidate,
    assistantSuggested: job.assistantReview?.candidate || null,
    assistantChangedFields: job.assistantReview?.changedFields || [],
    approved: job.candidate,
    model: job.model,
    reviewedAt: job.reviewedAt,
    reviewer: job.reviewer
});

const adjudicatedLabelToExport = (job, annotations = []) => ({
    id: job._id.toString(),
    documentId: job.document.toString(),
    schemaVersion: 2,
    ontologyVersion: job.ontologyVersion || ONTOLOGY_VERSION,
    title: job.input.title,
    excerpt: job.input.excerpt,
    sentences: job.input.sentences || splitNumberedSentences(job.input.excerpt),
    contentHash: job.input.contentHash,
    duplicateGroupId: job.input.duplicateGroupId,
    selectionBucket: job.input.selectionBucket,
    source: {
        name: job.input.sourceName,
        url: job.input.sourceUrl
    },
    publishedAt: job.input.publishedAt,
    marketContext: job.input.marketContext || null,
    generated: job.originalCandidate,
    assistantSuggested: job.assistantReview?.candidate || null,
    assistantChangedFields: job.assistantReview?.changedFields || [],
    gold: job.adjudication.goldCandidate,
    annotations: annotations.map((annotation) => ({
        reviewerId: annotation.reviewerId,
        reviewerRole: annotation.reviewerRole,
        status: annotation.status,
        annotation: annotation.annotation,
        rejectionReason: annotation.rejectionReason,
        submittedAt: annotation.submittedAt
    })),
    model: job.model,
    adjudicatedAt: job.adjudication.adjudicatedAt,
    adjudicatedBy: job.adjudication.adjudicatedBy
});

const exportApprovedLabels = async ({
    schemaVersion = marketGyanConfig.schemaVersion
} = {}) => {
    if (Number(schemaVersion) === 2) {
        const jobs = await MarketLabel.find({
            'model.schemaVersion': 2,
            'adjudication.status': 'adjudicated'
        })
            .sort({ 'input.publishedAt': 1, _id: 1 })
            .lean();
        const annotations = await MarketAnnotation.find({
            label: { $in: jobs.map((job) => job._id) },
            status: { $in: ['submitted', 'rejected'] }
        }).sort({ submittedAt: 1 }).lean();
        const byLabel = new Map();
        for (const annotation of annotations) {
            const key = annotation.label.toString();
            if (!byLabel.has(key)) byLabel.set(key, []);
            byLabel.get(key).push(annotation);
        }
        return jobs.map((job) => adjudicatedLabelToExport(
            job,
            byLabel.get(job._id.toString()) || []
        ));
    }
    const jobs = await MarketLabel.find({
        status: 'approved',
        'model.schemaVersion': Number(schemaVersion)
    })
        .sort({ 'input.publishedAt': 1, _id: 1 })
        .lean();
    return jobs.map(approvedLabelToExport);
};

module.exports = {
    MAX_EXCERPT_LENGTH,
    adjudicatedLabelToExport,
    adjudicateLabelV2,
    approvedLabelToExport,
    buildQueueQuery,
    buildRetryQuery,
    createIdempotencyKey,
    exportApprovedLabels,
    findMentionedSymbols,
    getDocumentInput,
    getReviewStats,
    isTransientGemmaError,
    listQueue,
    processQueuedLabels,
    queueBalancedDocuments,
    queueDocuments,
    recoverStaleJobs,
    regenerateLabel,
    retryFailedLabels,
    reviewLabel,
    saveAnnotationV2,
    trainingGateFromCounts
};

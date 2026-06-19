const MarketAnnotation = require('../models/MarketAnnotation');
const MarketDocument = require('../models/MarketDocument');
const MarketLabel = require('../models/MarketLabel');
const MarketSecurity = require('../models/MarketSecurity');
const { validateCandidateV2 } = require('./candidateValidationService');
const { getDocumentInput } = require('./labelQueueService');
const { sourceKeyFromName } = require('./sourcePlanningService');
const { findMentionedSecurities } = require('./securityAliasService');
const { contentHash, truncateAtWord } = require('./textService');
const { ONTOLOGY_VERSION, normalizeSector } = require('./taxonomyService');

const SCHEMA_VERSION = 2;
const MODEL_NAME = 'targeted-human-adjudication';
const PROMPT_VERSION = 'market-impact-v2-rebalance-2026-06-16';
const PROVIDER = 'marketgyan_rebalance';
const TARGET_HARD_NEGATIVES = 100;

const RETIRED_REPLACEMENT_DOCUMENTS = Object.freeze([
    '6a2f04658a1c034887d2f92e',
    '6a2f04658a1c034887d2f924',
    '6a2f04658a1c034887d2f920'
]);

const FIXED_RECLASSIFICATIONS = Object.freeze([
    '6a2f0a578a1c034887d306cd',
    '6a2f0a578a1c034887d30663',
    '6a2f0a578a1c034887d3066d',
    '6a2f0a568a1c034887d3064b',
    '6a2f0a578a1c034887d30678',
    '6a2f0a578a1c034887d30679',
    '6a2f0a578a1c034887d3071d',
    '6a2f0a578a1c034887d3066e',
    '6a2f0a578a1c034887d306b2',
    '6a2f0a578a1c034887d306d5',
    '6a2f0a578a1c034887d30681',
    '6a2f0a578a1c034887d306c3',
    '6a2f0a578a1c034887d306d0'
].map((id) => ({
    id,
    eventType: 'earnings',
    impactMechanism: 'earnings_cash_flow',
    rationale: 'Dividend and no-dividend announcements are treated as earnings and shareholder-return events for NEPSE impact annotation.',
    reason: 'Reclassify dividend/no-dividend event from capital action to earnings'
})));

const FIXED_CREDIT_RECLASSIFICATIONS = Object.freeze([
    '6a2f0a578a1c034887d306e9',
    '6a2f0a578a1c034887d306f2',
    '6a2f0a578a1c034887d306cc'
].map((id) => ({
    id,
    eventType: 'credit_financing',
    impactMechanism: 'financing_liquidity',
    rationale: 'Debt and debenture issuance records are financing events because they change funding, leverage, or liquidity for the listed institution.',
    reason: 'Reclassify debt/debenture event from generic event type to credit_financing'
})));

const TARGETED_RECLASSIFICATIONS = Object.freeze([
    {
        id: '6a2f0a578a1c034887d30788',
        eventType: 'sector_industry',
        impactScope: 'market',
        impactMechanism: 'demand_revenue',
        sectors: ['Manufacturing and Processing'],
        tags: ['imports', 'food-sector', 'sector_industry'],
        reason: 'Reclassify import-pressure story from other to sector_industry'
    },
    {
        id: '6a2f0a578a1c034887d30793',
        eventType: 'sector_industry',
        impactScope: 'company',
        impactMechanism: 'demand_revenue',
        tags: ['life-insurance', 'policy-revival', 'sector_industry'],
        reason: 'Reclassify Nepal Life policy revival campaign from other to sector_industry'
    }
]);

const REPLACEMENTS = Object.freeze([
    // Direct earnings.
    ['6a2f04658a1c034887d2f9ac', 'direct', 'earnings'],
    ['6a2f04658a1c034887d2f998', 'direct', 'earnings'],
    ['6a2f04658a1c034887d2f98e', 'direct', 'earnings'],
    ['6a2f04658a1c034887d2f98c', 'direct', 'earnings'],
    ['6a2f04658a1c034887d2f976', 'direct', 'earnings'],
    ['6a2f04658a1c034887d2f974', 'direct', 'earnings'],
    ['6a2f04658a1c034887d2f970', 'direct', 'earnings'],
    ['6a2f04658a1c034887d2f96c', 'direct', 'earnings'],
    ['6a2f04658a1c034887d2f96a', 'direct', 'earnings'],
    ['6a2f04658a1c034887d2f968', 'direct', 'earnings'],
    ['6a2f04658a1c034887d2f962', 'direct', 'earnings'],
    ['6a2f04658a1c034887d2f940', 'direct', 'earnings'],
    ['6a2f04658a1c034887d2f93c', 'direct', 'earnings'],
    ['6a2f09b38a1c034887d303b0', 'direct', 'earnings', { sectors: ['Development Bank'], symbols: [], impactScope: 'sector' }],
    ['6a2f09b38a1c034887d3026a', 'direct', 'earnings', { sectors: ['Banking'], symbols: [], impactScope: 'sector' }],
    ['6a2f09b38a1c034887d30220', 'direct', 'earnings', { sectors: ['Banking'], symbols: [], impactScope: 'sector' }],

    // Direct credit or financing.
    ['6a2f04658a1c034887d2fab4', 'direct', 'credit_financing', { sectors: ['Banking'], symbols: [], impactScope: 'sector' }],
    ['6a2f04658a1c034887d2f972', 'direct', 'credit_financing', { sectors: ['Banking'], symbols: [], impactScope: 'sector' }],
    ['6a2d51308a1c034887d2f3a8', 'direct', 'credit_financing'],
    ['6a2d51308a1c034887d2f39e', 'direct', 'credit_financing'],
    ['6a2f04658a1c034887d2f8e8', 'direct', 'credit_financing'],
    ['6a2d51308a1c034887d2f382', 'direct', 'credit_financing'],
    ['6a2d51308a1c034887d2f37c', 'direct', 'credit_financing'],
    ['6a2d51308a1c034887d2f340', 'direct', 'credit_financing'],
    ['6a2d51308a1c034887d2f310', 'direct', 'credit_financing'],
    ['6a2d51308a1c034887d2f4ec', 'direct', 'credit_financing', { sectors: ['Finance'], symbols: [], impactScope: 'sector' }],
    ['6a2d51308a1c034887d2f4b0', 'direct', 'credit_financing', { sectors: ['Finance'], symbols: [], impactScope: 'sector' }],
    ['6a2d51308a1c034887d2f462', 'direct', 'credit_financing', { sectors: ['Hotels and Tourism'], symbols: [], impactScope: 'sector' }],
    ['6a2d51308a1c034887d2f460', 'direct', 'credit_financing', { sectors: ['Hydropower'], symbols: [], impactScope: 'sector' }],
    ['6a2d51308a1c034887d2f44c', 'direct', 'credit_financing', { sectors: ['Manufacturing and Processing'], symbols: [], impactScope: 'sector' }],

    // Direct regulation.
    ['6a2f04658a1c034887d2f8ea', 'direct', 'regulation', { sectors: [], symbols: [], impactScope: 'market' }],
    ['6a2d51308a1c034887d2f364', 'direct', 'regulation', { sectors: [], symbols: [], impactScope: 'market' }],
    ['6a2d51308a1c034887d2f510', 'direct', 'regulation', { sectors: ['Hydropower'], symbols: [], impactScope: 'sector' }],
    ['6a2f04668a1c034887d2faca', 'direct', 'regulation', { sectors: ['Hydropower'], symbols: [], impactScope: 'sector' }],
    ['6a2d51308a1c034887d2f4d2', 'direct', 'regulation', { sectors: ['Hydropower'], symbols: [], impactScope: 'sector' }],
    ['6a2d51308a1c034887d2f43e', 'direct', 'regulation', { sectors: ['Hydropower', 'Manufacturing and Processing'], symbols: [], impactScope: 'sector' }],
    ['6a2d51308a1c034887d2f3c6', 'direct', 'regulation', { sectors: ['Manufacturing and Processing'], symbols: [], impactScope: 'sector' }],
    ['6a2d51308a1c034887d2f3c4', 'direct', 'regulation', { sectors: ['Hydropower'], symbols: [], impactScope: 'sector' }],
    ['6a2d51308a1c034887d2f2f4', 'direct', 'regulation', { sectors: [], symbols: [], impactScope: 'market' }],
    ['6a2d51308a1c034887d2f2f0', 'direct', 'regulation', { sectors: [], symbols: [], impactScope: 'market' }],
    ['6a2f04658a1c034887d2f978', 'direct', 'regulation', { sectors: [], symbols: [], impactScope: 'market' }],

    // Direct market-liquidity rule change.
    ['6a2d51308a1c034887d2f32a', 'direct', 'monetary_liquidity', { sectors: [], symbols: [], impactScope: 'market' }],

    // Direct sector and project operations.
    ['6a2f04658a1c034887d2f8be', 'direct', 'sector_industry'],
    ['6a2f04658a1c034887d2f888', 'direct', 'sector_industry'],
    ['6a2d51308a1c034887d2f3ac', 'direct', 'sector_industry'],
    ['6a2d51308a1c034887d2f350', 'direct', 'sector_industry'],
    ['6a2d51308a1c034887d2f2ea', 'direct', 'sector_industry'],
    ['6a2d51308a1c034887d2f2e8', 'direct', 'sector_industry'],

    // Indirect monetary and liquidity context.
    ['6a2f09b38a1c034887d303da', 'indirect', 'monetary_liquidity', { sectors: ['Banking'], symbols: [], impactScope: 'market' }],
    ['6a2f09b38a1c034887d30144', 'indirect', 'monetary_liquidity', { sectors: ['Banking', 'Finance'], symbols: [], impactScope: 'sector' }],
    ['6a2f065c8a1c034887d2fb9a', 'indirect', 'monetary_liquidity', { sectors: ['Banking'], symbols: [], impactScope: 'market' }],
    ['6a2d52598a1c034887d2f72a', 'indirect', 'monetary_liquidity', { sectors: ['Banking', 'Finance'], symbols: [], impactScope: 'market' }],
    ['6a2d52598a1c034887d2f724', 'indirect', 'monetary_liquidity', { sectors: ['Banking'], symbols: [], impactScope: 'market' }]
].map(([documentId, relevance, eventType, overrides = {}]) => ({
    documentId,
    relevance,
    eventType,
    ...overrides
})));

const unique = (values) => Array.from(new Set((values || []).filter(Boolean)));

const inferSectorFromText = (text) => {
    const value = String(text || '').toLowerCase();
    if (/hydro|power|energy|electricity|ऊर्जा|विद्युत|जलविद्युत/.test(value)) return 'Hydropower';
    if (/bank|बैंक/.test(value)) return 'Banking';
    if (/finance|finserv|वित्त/.test(value)) return 'Finance';
    if (/laghubitta|microfinance|लघुवित्त/.test(value)) return 'Microfinance';
    if (/hotel|resort|tourism|होटल|पर्यटन/.test(value)) return 'Hotels and Tourism';
    if (/insurance|बीमा/.test(value)) return 'Life Insurance';
    if (/cement|paint|pharma|manufactur|industry|उद्योग|सिमेन्ट/.test(value)) {
        return 'Manufacturing and Processing';
    }
    return null;
};

const sectorsFor = ({ definition, input, mentioned }) => {
    if (definition.sectors) return definition.sectors;
    const fromSymbols = unique(mentioned.map((security) => normalizeSector(security.sector)));
    if (fromSymbols.length) return fromSymbols;
    const inferred = inferSectorFromText(`${input.title} ${input.excerpt}`);
    return inferred ? [inferred] : [];
};

const symbolsFor = ({ definition, mentioned }) => {
    if (definition.symbols) return definition.symbols;
    return unique(mentioned.map((security) => security.symbol));
};

const eventSettings = (eventType, title) => {
    const noDividend = /no dividend|not distribute dividend/i.test(title);
    const bearishOperation = /fire|disrupt|halt|suspend|closed/i.test(title);
    const map = {
        earnings: {
            impactDirection: noDividend ? 'bearish' : 'bullish',
            impactHorizon: 'short_term',
            impactMechanism: 'earnings_cash_flow'
        },
        credit_financing: {
            impactDirection: 'uncertain',
            impactHorizon: 'medium_term',
            impactMechanism: 'financing_liquidity'
        },
        regulation: {
            impactDirection: 'uncertain',
            impactHorizon: 'short_term',
            impactMechanism: 'regulation'
        },
        monetary_liquidity: {
            impactDirection: 'uncertain',
            impactHorizon: 'short_term',
            impactMechanism: 'financing_liquidity'
        },
        sector_industry: {
            impactDirection: bearishOperation ? 'bearish' : 'bullish',
            impactHorizon: 'medium_term',
            impactMechanism: 'operations_capacity'
        }
    };
    return map[eventType] || {
        impactDirection: 'uncertain',
        impactHorizon: 'short_term',
        impactMechanism: 'uncertain'
    };
};

const evidenceSentenceIds = (input) => input.sentences
    .slice(0, Math.min(3, input.sentences.length))
    .map((sentence) => sentence.id);

const eventPhrase = (eventType) => eventType.replace(/_/g, ' ');

const evidenceTextFor = (input) => (input.sentences || [])
    .slice(0, 2)
    .map((sentence) => sentence.text)
    .filter(Boolean)
    .join(' ');

const summaryFor = (input) => {
    const evidenceText = evidenceTextFor(input);
    if (!evidenceText) return truncateAtWord(input.title, 240);
    const titleAlreadyCovered = evidenceText
        .toLowerCase()
        .includes(input.title.toLowerCase().slice(0, 80));
    return truncateAtWord(
        titleAlreadyCovered ? evidenceText : `${input.title}: ${evidenceText}`,
        280
    );
};

const rationaleFor = ({ relevance, eventType, input }) => {
    const ids = evidenceSentenceIds(input);
    return truncateAtWord(
        `Evidence ${ids.join(', ')} identifies a ${eventPhrase(eventType)} event with ${relevance} NEPSE relevance, so the label is grounded in the cited article text.`,
        360
    );
};

const stripMongoKeys = (value) => {
    if (Array.isArray(value)) return value.map(stripMongoKeys);
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Date) return value.toISOString();
    return Object.keys(value)
        .filter((key) => key !== '_id' && key !== '__v')
        .sort()
        .reduce((result, key) => ({
            ...result,
            [key]: stripMongoKeys(value[key])
        }), {});
};

const plainGoldCandidate = (label) => (
    label.adjudication?.goldCandidate?.toObject?.()
    || label.adjudication?.goldCandidate
    || null
);

const candidatesEqual = (left, right) => (
    JSON.stringify(stripMongoKeys(left)) === JSON.stringify(stripMongoKeys(right))
);

const buildCandidate = ({ definition, document, securities }) => {
    const input = getDocumentInput(document);
    const mentioned = findMentionedSecurities(input, securities);
    const sectors = sectorsFor({ definition, input, mentioned });
    const symbols = symbolsFor({ definition, mentioned });
    const settings = eventSettings(definition.eventType, input.title);
    const impactScope = definition.impactScope || (symbols.length ? 'company' : sectors.length ? 'sector' : 'market');
    return {
        input,
        candidate: {
            language: input.languageHint || document.language,
            summary: summaryFor(input),
            relevance: definition.relevance,
            eventType: definition.eventType,
            impactScope,
            impactDirection: settings.impactDirection,
            impactHorizon: settings.impactHorizon,
            impactMechanism: settings.impactMechanism,
            sectors,
            symbols,
            tags: unique([
                definition.eventType,
                definition.relevance,
                PROVIDER,
                ...sectors.map((sector) => sector.toLowerCase().replace(/\s+/g, '-'))
            ]).slice(0, 12),
            confidenceBand: definition.relevance === 'indirect' ? 'medium' : 'high',
            rationale: rationaleFor({
                relevance: definition.relevance,
                eventType: definition.eventType,
                input
            }),
            evidenceSentenceIds: evidenceSentenceIds(input)
        }
    };
};

const validateGold = (candidate, input, allowedSymbols) => {
    const validation = validateCandidateV2(candidate, {
        sentences: input.sentences,
        allowedSymbols
    });
    if (!validation.valid) {
        const error = new Error(`Invalid rebalance candidate for ${input.title}`);
        error.validationErrors = validation.errors;
        throw error;
    }
    return validation.candidate;
};

const selectHardNegativeExclusions = (labels, count = 53) => labels
    .filter((label) => (
        label.adjudication?.status === 'adjudicated'
        && label.adjudication?.goldCandidate?.relevance === 'not_relevant'
    ))
    .map((label) => {
        const source = sourceKeyFromName(label.input?.sourceName);
        const confidence = label.adjudication.goldCandidate.confidenceBand;
        const confidenceScore = { low: 0, medium: 1, high: 2 }[confidence] ?? 1;
        return {
            label,
            source,
            score: (source === 'sharesansar' ? 0 : 1) * 10 + confidenceScore
        };
    })
    .sort((a, b) => (
        a.score - b.score
        || String(a.label.input?.publishedAt || '').localeCompare(String(b.label.input?.publishedAt || ''))
        || String(a.label._id).localeCompare(String(b.label._id))
    ))
    .slice(0, count)
    .map(({ label }) => label);

const hardNegativeSurplus = (labels) => Math.max(
    0,
    labels.filter((label) => (
        label.adjudication?.status === 'adjudicated'
        && label.adjudication?.goldCandidate?.relevance === 'not_relevant'
    )).length - TARGET_HARD_NEGATIVES
);

const cloneGoldWith = (label, updates) => ({
    ...(label.adjudication?.goldCandidate?.toObject?.() || label.adjudication?.goldCandidate || {}),
    ...updates
});

const buildAutomaticReclassifications = (labels) => {
    const byId = new Map(labels.map((label) => [String(label._id), label]));
    return [
        ...FIXED_RECLASSIFICATIONS,
        ...FIXED_CREDIT_RECLASSIFICATIONS,
        ...TARGETED_RECLASSIFICATIONS
    ].map((patch) => {
        const label = byId.get(patch.id);
        const tags = unique([
            ...(label?.adjudication?.goldCandidate?.tags || []),
            patch.eventType
        ]);
        return {
            ...patch,
            tags
        };
    });
};

const applyExclusion = async ({ label, reviewer, reason, now, dryRun }) => {
    if (dryRun) return;
    label.status = 'rejected';
    label.adjudication = {
        ...(label.adjudication?.toObject?.() || label.adjudication || {}),
        status: 'excluded',
        reason,
        adjudicatedBy: reviewer,
        adjudicatedAt: now,
        goldCandidate: undefined
    };
    label.revisions.push({
        action: 'excluded',
        reason,
        actor: reviewer,
        at: now
    });
    label.reviewedAt = now;
    label.reviewer = reviewer;
    await label.save();
};

const applyReclassification = async ({ label, patch, allowedSymbols, reviewer, now, dryRun }) => {
    const input = label.input;
    const candidate = validateGold(
        cloneGoldWith(label, patch),
        input,
        allowedSymbols
    );
    if (candidatesEqual(plainGoldCandidate(label), candidate)) return candidate;
    if (dryRun) return candidate;
    label.status = 'approved';
    label.adjudication = {
        ...(label.adjudication?.toObject?.() || label.adjudication || {}),
        status: 'adjudicated',
        goldCandidate: candidate,
        reason: patch.reason,
        adjudicatedBy: reviewer,
        adjudicatedAt: now
    };
    label.revisions.push({
        action: 'adjudicated',
        candidate,
        reason: patch.reason,
        actor: reviewer,
        at: now
    });
    label.reviewedAt = now;
    label.reviewer = reviewer;
    await label.save();
    return candidate;
};

const upsertReplacement = async ({
    definition,
    document,
    securities,
    allowedSymbols,
    reviewer,
    now,
    dryRun
}) => {
    const { input, candidate } = buildCandidate({ definition, document, securities });
    const normalized = validateGold(candidate, input, allowedSymbols);
    const idempotencyKey = contentHash(
        input.contentHash,
        PROVIDER,
        MODEL_NAME,
        PROMPT_VERSION,
        SCHEMA_VERSION
    );
    if (dryRun) {
        return {
            idempotencyKey,
            document: document._id.toString(),
            title: input.title,
            candidate: normalized
        };
    }
    let label = await MarketLabel.findOne({ idempotencyKey });
    const isNew = !label;
    if (!label) {
        label = new MarketLabel({
            document: document._id,
            idempotencyKey,
            revisions: [{
                action: 'generated',
                candidate: normalized,
                reason: 'Targeted replacement candidate created for corpus rebalance',
                actor: PROVIDER,
                at: now
            }]
        });
    }
    if (candidatesEqual(plainGoldCandidate(label), normalized)) {
        return {
            id: label._id.toString(),
            idempotencyKey,
            document: document._id.toString(),
            title: input.title,
            candidate: normalized
        };
    }
    label.document = document._id;
    label.status = 'approved';
    label.input = input;
    label.originalCandidate = normalized;
    label.candidate = normalized;
    label.model = {
        provider: PROVIDER,
        name: MODEL_NAME,
        promptVersion: PROMPT_VERSION,
        schemaVersion: SCHEMA_VERSION
    };
    label.rawResponse = {
        source: 'targeted_rebalance_patch',
        generatedBy: PROVIDER
    };
    label.ontologyVersion = ONTOLOGY_VERSION;
    label.adjudication = {
        status: 'adjudicated',
        goldCandidate: normalized,
        reason: 'Targeted human-adjudicated rebalance replacement',
        adjudicatedBy: reviewer,
        adjudicatedAt: now
    };
    label.generatedAt = label.generatedAt || now;
    label.reviewedAt = now;
    label.reviewer = reviewer;
    label.validationErrors = [];
    label.lastError = undefined;
    label.revisions.push({
        action: 'annotation_submitted',
        candidate: normalized,
        reason: 'Submitted by targeted rebalance reviewer',
        actor: reviewer,
        at: now
    });
    label.revisions.push({
        action: 'adjudicated',
        candidate: normalized,
        reason: 'Targeted human-adjudicated rebalance replacement',
        actor: reviewer,
        at: now
    });
    await label.save();
    await MarketAnnotation.findOneAndUpdate(
        { label: label._id, reviewerId: reviewer },
        {
            $set: {
                reviewerRole: 'primary',
                status: 'submitted',
                annotation: normalized,
                submittedAt: now
            }
        },
        { upsert: true, new: true, runValidators: true }
    );
    return {
        id: label._id.toString(),
        idempotencyKey,
        document: document._id.toString(),
        title: input.title,
        candidate: normalized
    };
};

const retireReplacement = async ({ label, reviewer, now, dryRun }) => {
    if (dryRun) return;
    label.status = 'rejected';
    label.adjudication = {
        ...(label.adjudication?.toObject?.() || label.adjudication || {}),
        status: 'excluded',
        reason: 'Retired targeted replacement to restore Nepali language balance',
        adjudicatedBy: reviewer,
        adjudicatedAt: now,
        goldCandidate: undefined
    };
    label.revisions.push({
        action: 'excluded',
        reason: 'Retired targeted replacement to restore Nepali language balance',
        actor: reviewer,
        at: now
    });
    label.reviewedAt = now;
    label.reviewer = reviewer;
    await label.save();
};

const applyGoldRebalancePatch = async ({
    dryRun = true,
    reviewer = 'rebalance-adjudicator',
    excludeCount = 53
} = {}) => {
    const now = new Date();
    const [labels, documents, securities] = await Promise.all([
        MarketLabel.find({
            'model.schemaVersion': SCHEMA_VERSION,
            'adjudication.status': { $in: ['adjudicated', 'excluded'] }
        }),
        MarketDocument.find({
            _id: { $in: REPLACEMENTS.map((row) => row.documentId) }
        }).lean(),
        MarketSecurity.find({ active: true }).select('symbol name sector aliases').lean()
    ]);
    const documentById = new Map(documents.map((document) => [
        document._id.toString(),
        document
    ]));
    const labelById = new Map(labels.map((label) => [label._id.toString(), label]));
    const allowedSymbols = securities.map((security) => security.symbol);
    const exclusionTarget = Math.min(
        Number(excludeCount) || 53,
        hardNegativeSurplus(labels)
    );
    const exclusions = selectHardNegativeExclusions(labels, exclusionTarget);
    const retired = labels.filter((label) => (
        label.model?.provider === PROVIDER
        && label.adjudication?.status === 'adjudicated'
        && RETIRED_REPLACEMENT_DOCUMENTS.includes(label.document.toString())
    ));
    const reclassificationPatches = buildAutomaticReclassifications(labels);
    const reclassifications = [];
    const replacements = [];

    if (exclusions.length !== exclusionTarget) {
        throw new Error(`Expected ${exclusionTarget} hard-negative exclusions, found ${exclusions.length}`);
    }
    if (REPLACEMENTS.length !== 53) {
        throw new Error(`Expected 53 targeted replacements, found ${REPLACEMENTS.length}`);
    }

    for (const patch of reclassificationPatches) {
        const label = labelById.get(patch.id);
        if (!label) throw new Error(`Missing reclassification label ${patch.id}`);
        const candidate = await applyReclassification({
            label,
            patch,
            allowedSymbols,
            reviewer,
            now,
            dryRun
        });
        reclassifications.push({
            id: patch.id,
            title: label.input.title,
            eventType: candidate.eventType,
            reason: patch.reason
        });
    }

    for (const label of exclusions) {
        await applyExclusion({
            label,
            reviewer,
            reason: 'Surplus hard-negative excluded during NEPSE-Impact-500 rebalance',
            now,
            dryRun
        });
    }

    for (const label of retired) {
        await retireReplacement({
            label,
            reviewer,
            now,
            dryRun
        });
    }

    for (const definition of REPLACEMENTS) {
        const document = documentById.get(definition.documentId);
        if (!document) throw new Error(`Missing replacement document ${definition.documentId}`);
        const replacement = await upsertReplacement({
            definition,
            document,
            securities,
            allowedSymbols,
            reviewer,
            now,
            dryRun
        });
        replacements.push(replacement);
    }

    return {
        dryRun: Boolean(dryRun),
        reviewer,
        generatedAt: now,
        excluded: exclusions.map((label) => ({
            id: label._id.toString(),
            title: label.input.title,
            source: sourceKeyFromName(label.input.sourceName)
        })),
        retired: retired.map((label) => ({
            id: label._id.toString(),
            title: label.input.title,
            source: sourceKeyFromName(label.input.sourceName)
        })),
        reclassified: reclassifications,
        replacements: replacements.map((row) => ({
            id: row.id || null,
            document: row.document,
            title: row.title,
            relevance: row.candidate.relevance,
            eventType: row.candidate.eventType,
            source: row.candidate.relevance === 'direct' ? 'targeted-direct' : 'targeted-indirect'
        })),
        counts: {
            excluded: exclusions.length,
            retired: retired.length,
            reclassified: reclassifications.length,
            replacements: replacements.length,
            directReplacements: replacements.filter((row) => row.candidate.relevance === 'direct').length,
            indirectReplacements: replacements.filter((row) => row.candidate.relevance === 'indirect').length
        }
    };
};

module.exports = {
    applyGoldRebalancePatch,
    buildAutomaticReclassifications,
    selectHardNegativeExclusions
};

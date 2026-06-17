const {
    CANONICAL_SECTORS,
    CONFIDENCE_BANDS,
    EVENT_TYPES,
    IMPACT_DIRECTIONS,
    IMPACT_HORIZONS,
    IMPACT_MECHANISMS,
    IMPACT_SCOPES,
    LANGUAGES,
    RELEVANCE_VALUES,
    normalizeEnumValue,
    normalizeSector,
    normalizeSymbol
} = require('./taxonomyService');
const { normalizeForEvidence } = require('./textService');
const { resolveEvidenceSentences } = require('./sentenceService');

const REQUIRED_STRING_FIELDS = [
    'language',
    'summary',
    'sentiment',
    'confidenceBand',
    'rationale'
];

const sanitizeStringArray = (values, limit) => Array.from(new Set(
    (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
)).slice(0, limit);

const normalizeCandidateV2 = (candidate) => {
    const value = candidate && typeof candidate === 'object' ? candidate : {};
    return {
        language: String(value.language || '').trim().toLowerCase(),
        summary: String(value.summary || '').trim().slice(0, 600),
        relevance: normalizeEnumValue(value.relevance),
        eventType: normalizeEnumValue(value.eventType),
        impactScope: normalizeEnumValue(value.impactScope),
        impactDirection: normalizeEnumValue(value.impactDirection),
        impactHorizon: normalizeEnumValue(value.impactHorizon),
        impactMechanism: normalizeEnumValue(value.impactMechanism),
        sectors: sanitizeStringArray(value.sectors, 8)
            .map(normalizeSector)
            .filter(Boolean),
        symbols: sanitizeStringArray(value.symbols, 12).map(normalizeSymbol),
        tags: sanitizeStringArray(value.tags, 12)
            .map((tag) => tag.toLowerCase().slice(0, 60)),
        confidenceBand: String(value.confidenceBand || '').trim().toLowerCase(),
        rationale: String(value.rationale || '').trim().slice(0, 1000),
        evidenceSentenceIds: sanitizeStringArray(value.evidenceSentenceIds, 8)
            .map((id) => id.toUpperCase()),
        evidence: []
    };
};

const normalizeCandidate = (candidate) => {
    const value = candidate && typeof candidate === 'object' ? candidate : {};
    return {
        language: String(value.language || '').trim().toLowerCase(),
        summary: String(value.summary || '').trim().slice(0, 600),
        sentiment: String(value.sentiment || '').trim().toLowerCase(),
        sectors: sanitizeStringArray(value.sectors, 8)
            .map(normalizeSector)
            .filter(Boolean),
        symbols: sanitizeStringArray(value.symbols, 12).map(normalizeSymbol),
        tags: sanitizeStringArray(value.tags, 12)
            .map((tag) => tag.toLowerCase().slice(0, 60)),
        confidenceBand: String(value.confidenceBand || '').trim().toLowerCase(),
        rationale: String(value.rationale || '').trim().slice(0, 1000),
        evidence: sanitizeStringArray(value.evidence, 5)
            .map((excerpt) => excerpt.slice(0, 350))
    };
};

const validateCandidate = (candidate, { excerpt, allowedSymbols = [] } = {}) => {
    const normalized = normalizeCandidate(candidate);
    const errors = [];

    for (const field of REQUIRED_STRING_FIELDS) {
        if (!normalized[field]) errors.push(`${field} is required`);
    }

    if (!['en', 'ne', 'mixed'].includes(normalized.language)) {
        errors.push('language must be en, ne, or mixed');
    }
    if (!['bullish', 'bearish', 'neutral'].includes(normalized.sentiment)) {
        errors.push('sentiment must be bullish, bearish, or neutral');
    }
    if (!['low', 'medium', 'high'].includes(normalized.confidenceBand)) {
        errors.push('confidenceBand must be low, medium, or high');
    }

    const submittedSectors = sanitizeStringArray(candidate?.sectors, 8);
    const unknownSectors = submittedSectors.filter((sector) => !normalizeSector(sector));
    if (unknownSectors.length) {
        errors.push(`unknown sectors: ${unknownSectors.join(', ')}`);
    }

    const allowed = new Set(allowedSymbols.map(normalizeSymbol));
    const unknownSymbols = normalized.symbols.filter((symbol) => !allowed.has(symbol));
    if (unknownSymbols.length) {
        errors.push(`unknown NEPSE symbols: ${unknownSymbols.join(', ')}`);
    }

    if (!normalized.evidence.length) {
        errors.push('at least one supporting evidence excerpt is required');
    } else {
        const haystack = normalizeForEvidence(excerpt);
        const unsupported = normalized.evidence.filter(
            (item) => !haystack.includes(normalizeForEvidence(item))
        );
        if (unsupported.length) {
            errors.push('one or more evidence excerpts are not present in the supplied text');
        }
    }

    if (normalized.summary.length < 20) {
        errors.push('summary must contain at least 20 characters');
    }
    if (normalized.rationale.length < 20) {
        errors.push('rationale must contain at least 20 characters');
    }

    return {
        valid: errors.length === 0,
        candidate: normalized,
        errors,
        taxonomy: {
            sectors: CANONICAL_SECTORS
        }
    };
};

const validateCandidateV2 = (candidate, {
    sentences = [],
    allowedSymbols = []
} = {}) => {
    const normalized = normalizeCandidateV2(candidate);
    const errors = [];
    const required = [
        'language',
        'summary',
        'relevance',
        'eventType',
        'impactScope',
        'impactDirection',
        'impactHorizon',
        'impactMechanism',
        'confidenceBand',
        'rationale'
    ];
    for (const field of required) {
        if (!normalized[field]) errors.push(`${field} is required`);
    }

    const enumChecks = [
        ['language', LANGUAGES],
        ['relevance', RELEVANCE_VALUES],
        ['eventType', EVENT_TYPES],
        ['impactScope', IMPACT_SCOPES],
        ['impactDirection', IMPACT_DIRECTIONS],
        ['impactHorizon', IMPACT_HORIZONS],
        ['impactMechanism', IMPACT_MECHANISMS],
        ['confidenceBand', CONFIDENCE_BANDS]
    ];
    for (const [field, values] of enumChecks) {
        if (normalized[field] && !values.includes(normalized[field])) {
            errors.push(`${field} is invalid`);
        }
    }

    const submittedSectors = sanitizeStringArray(candidate?.sectors, 8);
    const unknownSectors = submittedSectors.filter((sector) => !normalizeSector(sector));
    if (unknownSectors.length) {
        errors.push(`unknown sectors: ${unknownSectors.join(', ')}`);
    }

    const allowed = new Set(allowedSymbols.map(normalizeSymbol));
    const unknownSymbols = normalized.symbols.filter((symbol) => !allowed.has(symbol));
    if (unknownSymbols.length) {
        errors.push(`unknown NEPSE symbols: ${unknownSymbols.join(', ')}`);
    }

    const sentenceIds = new Set(sentences.map((sentence) => String(sentence.id)));
    const unknownSentenceIds = normalized.evidenceSentenceIds
        .filter((id) => !sentenceIds.has(id));
    if (!normalized.evidenceSentenceIds.length) {
        errors.push('at least one evidence sentence ID is required');
    }
    if (unknownSentenceIds.length) {
        errors.push(`unknown evidence sentence IDs: ${unknownSentenceIds.join(', ')}`);
    }
    normalized.evidence = resolveEvidenceSentences(
        normalized.evidenceSentenceIds,
        sentences
    ).map((item) => item.text);

    if (normalized.relevance === 'not_relevant') {
        const expected = {
            eventType: 'not_applicable',
            impactScope: 'none',
            impactDirection: 'not_applicable',
            impactHorizon: 'not_applicable',
            impactMechanism: 'none'
        };
        for (const [field, value] of Object.entries(expected)) {
            if (normalized[field] !== value) {
                errors.push(`${field} must be ${value} when relevance is not_relevant`);
            }
        }
        if (normalized.sectors.length || normalized.symbols.length) {
            errors.push('not_relevant records cannot contain sectors or symbols');
        }
    } else if (RELEVANCE_VALUES.includes(normalized.relevance)) {
        if (normalized.eventType === 'not_applicable') {
            errors.push('relevant records require an eventType');
        }
        if (normalized.impactScope === 'none') {
            errors.push('relevant records require an impactScope');
        }
        if (normalized.impactDirection === 'not_applicable') {
            errors.push('relevant records require an impactDirection');
        }
        if (normalized.impactHorizon === 'not_applicable') {
            errors.push('relevant records require an impactHorizon');
        }
        if (normalized.impactMechanism === 'none') {
            errors.push('relevant records require an impactMechanism');
        }
        if (!normalized.sectors.length && !normalized.symbols.length
            && normalized.impactScope !== 'market') {
            errors.push('relevant company or sector records require a sector or symbol');
        }
    }

    if (normalized.impactScope === 'company' && !normalized.symbols.length) {
        errors.push('company impactScope requires at least one symbol');
    }
    if (normalized.impactScope === 'sector' && !normalized.sectors.length) {
        errors.push('sector impactScope requires at least one sector');
    }
    if (normalized.summary.length < 20) {
        errors.push('summary must contain at least 20 characters');
    }
    if (normalized.rationale.length < 20) {
        errors.push('rationale must contain at least 20 characters');
    }

    return {
        valid: errors.length === 0,
        candidate: normalized,
        errors,
        taxonomy: {
            sectors: CANONICAL_SECTORS,
            relevance: RELEVANCE_VALUES,
            eventTypes: EVENT_TYPES,
            impactDirections: IMPACT_DIRECTIONS
        }
    };
};

module.exports = {
    normalizeCandidate,
    normalizeCandidateV2,
    validateCandidate,
    validateCandidateV2
};

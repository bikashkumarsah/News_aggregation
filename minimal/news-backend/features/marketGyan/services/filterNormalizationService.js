/**
 * Search-filter normalization for Market Gyan retrieval.
 *
 * The Qdrant payloads store canonical values (e.g. sector "Banking", source
 * "ShareSansar"), but users type free-form text ("banking", "share sansar").
 * Without normalization every filtered query does an exact match that silently
 * returns zero results. This module resolves human input to the canonical
 * indexed values and reports unknown values so the API can fail loudly instead
 * of returning an empty set.
 */

const { CANONICAL_SECTORS, LANGUAGES } = require('../ontology/nepseImpactOntology');

// documentType values stored on MarketDocument (see models/MarketDocument.js).
const DOCUMENT_TYPES = Object.freeze([
    'financial_news',
    'regulatory_notice',
    'policy_document',
    'archived_report'
]);

// Canonical sources. `aliases` are exact stored `source.name` strings (see
// collectors/documentCollectors.js); `signatures` are normalized tokens matched
// as substrings so drifting names still resolve — e.g. OnlineKhabar's stored
// name follows the RSS feed title ("बिजनेस – Page 20 – Online Khabar"), which
// contains "onlinekhabar" once normalized. `key` matches the `sourceKey` payload
// field written at index time.
const SOURCES = Object.freeze([
    {
        key: 'sharesansar',
        label: 'ShareSansar',
        aliases: ['ShareSansar'],
        signatures: ['sharesansar']
    },
    {
        key: 'onlinekhabar',
        label: 'OnlineKhabar',
        aliases: ['OnlineKhabar Business'],
        signatures: ['onlinekhabar']
    },
    {
        key: 'kathmandupost',
        label: 'The Kathmandu Post',
        aliases: ['The Kathmandu Post - Money'],
        signatures: ['kathmandupost']
    },
    {
        key: 'sebon',
        label: 'SEBON',
        aliases: ['SEBON'],
        signatures: ['sebon', 'securitiesboardofnepal']
    },
    {
        key: 'nrb',
        label: 'NRB',
        aliases: ['NRB'],
        signatures: ['nrb', 'nepalrastrabank']
    }
]);

const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

const resolveSector = (value) => {
    const target = String(value || '').trim().toLowerCase();
    if (!target) return null;
    return CANONICAL_SECTORS.find((sector) => sector.toLowerCase() === target) || null;
};

const resolveSource = (value) => {
    const target = normalizeKey(value);
    if (!target) return null;
    return SOURCES.find((source) => (
        source.key === target
        || source.signatures.some((signature) => target.includes(signature))
    )) || null;
};

const resolveDocumentType = (value) => {
    const target = String(value || '').trim().toLowerCase();
    if (!target) return null;
    return DOCUMENT_TYPES.find((type) => type === target) || null;
};

const resolveLanguage = (value) => {
    const target = String(value || '').trim().toLowerCase();
    if (!target) return null;
    return LANGUAGES.find((language) => language === target) || null;
};

/**
 * Validate raw filters and collect human-readable errors for unknown values.
 * Empty/absent values are ignored (they simply mean "no filter on that field").
 * @returns {{ errors: string[] }}
 */
const validateFilters = (filters = {}) => {
    const errors = [];
    if (String(filters.sector || '').trim() && !resolveSector(filters.sector)) {
        errors.push(
            `Unknown sector "${filters.sector}". Valid sectors: ${CANONICAL_SECTORS.join(', ')}`
        );
    }
    if (String(filters.source || '').trim() && !resolveSource(filters.source)) {
        errors.push(
            `Unknown source "${filters.source}". Valid sources: ${SOURCES.map((s) => s.label).join(', ')}`
        );
    }
    if (String(filters.documentType || '').trim() && !resolveDocumentType(filters.documentType)) {
        errors.push(
            `Unknown documentType "${filters.documentType}". Valid types: ${DOCUMENT_TYPES.join(', ')}`
        );
    }
    if (String(filters.language || '').trim() && !resolveLanguage(filters.language)) {
        errors.push(
            `Unknown language "${filters.language}". Valid languages: ${LANGUAGES.join(', ')}`
        );
    }
    return { errors };
};

/**
 * Filter options exposed to the frontend so it can render data-driven pickers
 * instead of hardcoded (and partly wrong) dropdowns.
 */
const availableFilters = () => ({
    sectors: CANONICAL_SECTORS,
    sources: SOURCES.map((source) => ({ key: source.key, label: source.label })),
    documentTypes: DOCUMENT_TYPES,
    languages: LANGUAGES
});

module.exports = {
    DOCUMENT_TYPES,
    SOURCES,
    availableFilters,
    resolveDocumentType,
    resolveLanguage,
    resolveSector,
    resolveSource,
    validateFilters
};

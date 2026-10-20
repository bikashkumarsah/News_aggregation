/**
 * Small request-input helpers shared by the API routes.
 *
 * Express can hand route code strings, arrays (repeated query keys), or JSON
 * objects (request bodies). These helpers coerce untrusted input into the
 * primitive shapes the routes expect so Mongo queries never receive operator
 * objects such as {"$ne": null}.
 */

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const isValidObjectId = (value) => (
    typeof value === 'string' && OBJECT_ID_PATTERN.test(value)
);

const firstValue = (value) => (Array.isArray(value) ? value[0] : value);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const toInteger = (value, fallback) => {
    const parsed = Number.parseInt(firstValue(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const parsePagination = (query = {}, {
    defaultLimit = 12,
    maxLimit = 50,
    maxPage = 1000
} = {}) => {
    const limit = clamp(toInteger(query.limit, defaultLimit), 1, maxLimit);
    const page = clamp(toInteger(query.page, 1), 1, maxPage);
    return { page, limit, skip: (page - 1) * limit };
};

const queryString = (value, { maxLength = 200 } = {}) => {
    const raw = firstValue(value);
    if (raw === undefined || raw === null || typeof raw === 'object') return '';
    return String(raw).trim().slice(0, maxLength);
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
    clamp,
    escapeRegex,
    firstValue,
    isValidObjectId,
    parsePagination,
    queryString,
    toInteger
};

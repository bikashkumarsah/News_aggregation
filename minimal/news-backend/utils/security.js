const crypto = require('crypto');

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

/**
 * Constant-time string comparison for shared secrets. Both values are hashed
 * first so neither the content nor the length of the expected secret leaks
 * through timing.
 */
const safeEqual = (supplied, expected) => {
    if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
    if (!supplied || !expected) return false;
    return crypto.timingSafeEqual(digest(supplied), digest(expected));
};

const FORWARDING_HEADERS = ['forwarded', 'x-forwarded-for', 'x-real-ip'];

const readHeader = (req, name) => {
    if (typeof req?.get === 'function') return req.get(name);
    return req?.headers?.[name];
};

/**
 * True when a reverse proxy relayed the request. A proxy on the same host
 * connects from 127.0.0.1, so loopback-only tools must treat proxied traffic
 * as remote even though the socket address is local.
 */
const isProxiedRequest = (req) => FORWARDING_HEADERS.some((name) => Boolean(readHeader(req, name)));

module.exports = {
    isProxiedRequest,
    safeEqual
};

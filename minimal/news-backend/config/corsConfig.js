const parseOrigins = (value) => String(value || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

/**
 * CORS policy:
 * - CORS_ORIGINS set: only those origins (comma-separated, or "*" for any).
 * - Production without CORS_ORIGINS: same-origin only (serve the frontend from
 *   this server or set CORS_ORIGINS explicitly).
 * - Development: any origin, so phones/tablets on the LAN can reach the API.
 *
 * Authentication uses the Authorization header, never cookies, so
 * credentialed CORS is not needed.
 */
const buildCorsOptions = (env = process.env) => {
    const allowed = parseOrigins(env.CORS_ORIGINS);
    if (allowed.includes('*')) return { origin: true, maxAge: 600 };
    if (allowed.length) {
        const allowSet = new Set(allowed);
        return {
            origin: (origin, callback) => callback(null, !origin || allowSet.has(origin)),
            maxAge: 600
        };
    }
    if (env.NODE_ENV === 'production') return { origin: false };
    return { origin: true, maxAge: 600 };
};

module.exports = {
    buildCorsOptions,
    parseOrigins
};

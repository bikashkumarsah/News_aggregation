/**
 * Minimal dependency-free rate limiter for Market Gyan endpoints.
 *
 * The grounded query and evidence search endpoints each trigger an embedding
 * call plus (for query) LLM inference, so an unauthenticated caller can exhaust
 * resources with a tight loop. This fixed-window limiter caps requests per
 * client IP without pulling in an external dependency.
 */

const createRateLimiter = ({
    windowMs = 60000,
    max = 30,
    message = 'Too many requests, please slow down'
} = {}) => {
    const hits = new Map();

    // Periodically drop expired windows so the map cannot grow unbounded.
    const sweep = () => {
        const now = Date.now();
        for (const [key, entry] of hits) {
            if (now >= entry.resetAt) hits.delete(key);
        }
    };
    const sweepTimer = setInterval(sweep, windowMs);
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

    return (req, res, next) => {
        const now = Date.now();
        const key = req.ip || req.connection?.remoteAddress || 'unknown';
        let entry = hits.get(key);
        if (!entry || now >= entry.resetAt) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(key, entry);
        }
        entry.count += 1;

        const remaining = Math.max(max - entry.count, 0);
        res.setHeader('X-RateLimit-Limit', String(max));
        res.setHeader('X-RateLimit-Remaining', String(remaining));

        if (entry.count > max) {
            const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
            res.setHeader('Retry-After', String(retryAfterSec));
            return res.status(429).json({ success: false, error: message });
        }
        return next();
    };
};

module.exports = { createRateLimiter };

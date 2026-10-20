/**
 * Minimal dependency-free fixed-window rate limiter.
 *
 * Expensive endpoints (model inference, TTS, embedding search) and auth
 * endpoints (password guessing) are throttled per client so a tight loop
 * cannot exhaust local resources. State is in-memory and per process, which
 * fits this single-instance deployment.
 */

const defaultKey = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

const createRateLimiter = ({
    windowMs = 60000,
    max = 30,
    message = 'Too many requests, please slow down',
    keyGenerator = defaultKey
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
        const key = String(keyGenerator(req) || 'unknown');
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

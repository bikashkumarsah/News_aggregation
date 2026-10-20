const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config/authConfig');

const PURPOSE = 'unsubscribe';

// Unsubscribe links must keep working for as long as the email exists, so the
// token does not expire. The purpose claim keeps it from being usable as a
// session token (sessions carry `id`, not `sub`).
const createUnsubscribeToken = (userId) => jwt.sign(
    { sub: String(userId), purpose: PURPOSE },
    getJwtSecret(),
    { algorithm: 'HS256' }
);

const verifyUnsubscribeToken = (token) => {
    const payload = jwt.verify(String(token || ''), getJwtSecret(), { algorithms: ['HS256'] });
    if (payload?.purpose !== PURPOSE || !payload.sub) {
        throw new Error('Invalid unsubscribe token');
    }
    return String(payload.sub);
};

// Base URL that email recipients can reach the API on. Defaults to the
// FRONTEND_URL host on the API port, which matches the LAN setup in the README.
const publicApiUrl = (env = process.env) => {
    if (env.PUBLIC_API_URL) return env.PUBLIC_API_URL.replace(/\/+$/, '');
    const port = env.PORT || 5001;
    try {
        const frontend = new URL(env.FRONTEND_URL);
        return `${frontend.protocol}//${frontend.hostname}:${port}`;
    } catch {
        return `http://localhost:${port}`;
    }
};

const buildUnsubscribeUrl = (userId, env = process.env) => (
    `${publicApiUrl(env)}/api/email/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(userId))}`
);

module.exports = {
    buildUnsubscribeUrl,
    createUnsubscribeToken,
    publicApiUrl,
    verifyUnsubscribeToken
};

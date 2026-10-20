const crypto = require('crypto');

// Values that ship in docs/examples. A deployment using one of them would let
// anyone mint valid tokens.
const PLACEHOLDER_SECRETS = new Set([
    'your-super-secret-jwt-key-change-this',
    'your_secret_key_here',
    'khabar-news-secret-key-2024'
]);

const resolveJwtSecret = ({ env = process.env, logger = console } = {}) => {
    const configured = String(env.JWT_SECRET || '').trim();
    const production = env.NODE_ENV === 'production';

    if (configured && !(production && PLACEHOLDER_SECRETS.has(configured))) {
        return configured;
    }
    if (production) {
        throw new Error('JWT_SECRET must be set to a strong, private value when NODE_ENV=production');
    }
    logger.warn?.(
        '[auth] JWT_SECRET is not set; using a random development secret. Sessions reset when the server restarts.'
    );
    return crypto.randomBytes(48).toString('hex');
};

let cachedSecret = null;

const getJwtSecret = () => {
    if (!cachedSecret) cachedSecret = resolveJwtSecret();
    return cachedSecret;
};

module.exports = {
    PLACEHOLDER_SECRETS,
    getJwtSecret,
    resolveJwtSecret
};

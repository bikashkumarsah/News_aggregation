const { marketGyanConfig } = require('../config');

const isLoopbackAddress = (address) => {
    const value = String(address || '').trim().toLowerCase();
    return value === '::1'
        || value === '127.0.0.1'
        || value.startsWith('127.')
        || value === '::ffff:127.0.0.1'
        || value.startsWith('::ffff:127.');
};

const isReviewRequestAllowed = (req, {
    enabled = marketGyanConfig.reviewEnabled,
    nodeEnv = process.env.NODE_ENV
} = {}) => (
    enabled
    && nodeEnv !== 'production'
    && isLoopbackAddress(req?.socket?.remoteAddress || req?.ip)
);

const requireLocalReviewAccess = (req, res, next) => {
    if (!isReviewRequestAllowed(req)) {
        return res.status(404).json({
            success: false,
            error: 'Market Gyan review tools are not available'
        });
    }
    return next();
};

module.exports = {
    isLoopbackAddress,
    isReviewRequestAllowed,
    requireLocalReviewAccess
};

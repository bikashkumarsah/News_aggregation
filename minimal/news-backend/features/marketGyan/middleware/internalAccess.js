const { marketGyanConfig } = require('../config');
const { isLoopbackAddress } = require('./reviewAccess');
const { isProxiedRequest, safeEqual } = require('../../../utils/security');

const isInternalRequestAllowed = (req, {
    token = marketGyanConfig.agentServiceToken
} = {}) => {
    if (!token) return false;
    const supplied = String(req?.get?.('x-market-gyan-token') || '');
    const address = req?.socket?.remoteAddress || req?.ip;
    return safeEqual(supplied, token)
        && isLoopbackAddress(address)
        && !isProxiedRequest(req);
};

const requireInternalAccess = (req, res, next) => {
    if (!isInternalRequestAllowed(req)) {
        return res.status(404).json({
            success: false,
            error: 'Market Gyan internal endpoint is not available'
        });
    }
    return next();
};

module.exports = {
    isInternalRequestAllowed,
    requireInternalAccess
};

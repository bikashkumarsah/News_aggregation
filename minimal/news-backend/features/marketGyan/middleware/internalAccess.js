const { marketGyanConfig } = require('../config');
const { isLoopbackAddress } = require('./reviewAccess');

const isInternalRequestAllowed = (req, {
    token = marketGyanConfig.agentServiceToken
} = {}) => {
    if (!token) return false;
    const supplied = String(req?.get?.('x-market-gyan-token') || '');
    const address = req?.socket?.remoteAddress || req?.ip;
    return supplied === token && isLoopbackAddress(address);
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

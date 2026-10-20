const { safeEqual } = require('../utils/security');

/**
 * Article create/bulk/delete endpoints mutate the shared catalogue, so they
 * require the ADMIN_API_TOKEN shared secret in the `x-admin-token` header.
 * When no token is configured the endpoints stay disabled.
 */
const isAdminRequest = (req, { token = process.env.ADMIN_API_TOKEN } = {}) => {
    if (!token) return false;
    const supplied = typeof req?.get === 'function'
        ? req.get('x-admin-token')
        : req?.headers?.['x-admin-token'];
    return safeEqual(supplied, token);
};

const requireAdmin = (req, res, next) => {
    if (!isAdminRequest(req)) {
        return res.status(403).json({
            success: false,
            error: 'Admin access required'
        });
    }
    return next();
};

module.exports = {
    isAdminRequest,
    requireAdmin
};

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../config/authConfig');
const { isValidObjectId } = require('../utils/validation');

const extractBearerToken = (req) => {
    const header = String(req.headers?.authorization || '');
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    return match ? match[1] : null;
};

// Routes only need the identity of the caller; each route loads the fields it
// works with, so the middleware avoids hydrating the full user document.
const loadUserFromToken = async (token) => {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
    const id = decoded?.id ? String(decoded.id) : '';
    if (!isValidObjectId(id)) return null;
    return User.findById(id).select('name email darkMode').lean();
};

// Protect routes - verify JWT token
const protect = async (req, res, next) => {
    const token = extractBearerToken(req);

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Not authorized - no token provided'
        });
    }

    try {
        req.user = await loadUserFromToken(token);
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: 'Not authorized - invalid token'
        });
    }

    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'User not found'
        });
    }

    return next();
};

// Optional auth - doesn't fail if no token, but attaches user if present
const optionalAuth = async (req, res, next) => {
    const token = extractBearerToken(req);
    req.user = null;

    if (token) {
        try {
            req.user = await loadUserFromToken(token);
        } catch (error) {
            req.user = null;
        }
    }

    next();
};

module.exports = { extractBearerToken, optionalAuth, protect };

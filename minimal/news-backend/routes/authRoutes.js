const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { createRateLimiter } = require('../middleware/rateLimit');
const { getJwtSecret } = require('../config/authConfig');

const router = express.Router();

const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: 'Too many authentication attempts. Please try again later.'
});

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;
const NAME_MAX_LENGTH = 50;

// Compared against when the email is unknown so a failed login costs the same
// bcrypt work whether or not the account exists.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('khabar-dummy-password', 10);

const generateToken = (id) => jwt.sign({ id: String(id) }, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '30d'
});

// Request bodies are untrusted JSON: anything that is not a plain string is
// rejected so it can never reach a Mongo filter as an operator object.
const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const validateEmail = (email) => {
    if (!email) return 'Please provide an email address';
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) return 'Please enter a valid email';
    return null;
};

const validatePassword = (value, label = 'Password') => {
    if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH) {
        return `${label} must be at least ${PASSWORD_MIN_LENGTH} characters`;
    }
    if (value.length > PASSWORD_MAX_LENGTH) {
        return `${label} cannot exceed ${PASSWORD_MAX_LENGTH} characters`;
    }
    return null;
};

const validateName = (value) => {
    if (typeof value !== 'string' || !value.trim()) return 'Name is required';
    if (value.trim().length > NAME_MAX_LENGTH) return `Name cannot exceed ${NAME_MAX_LENGTH} characters`;
    return null;
};

const badRequest = (res, error) => res.status(400).json({ success: false, error });

const sendRouteError = (res, error, context) => {
    if (error?.code === 11000) {
        return badRequest(res, 'User with this email already exists');
    }
    if (error?.name === 'ValidationError') {
        const message = Object.values(error.errors || {})
            .map((item) => item.message)
            .join(', ');
        return badRequest(res, message || 'Invalid input');
    }
    console.error(`${context} error:`, error);
    return res.status(500).json({
        success: false,
        error: 'Something went wrong. Please try again.'
    });
};

const authPayload = (user, token) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    darkMode: user.darkMode,
    bookmarks: (user.bookmarks || []).map(String),
    ...(token ? { token } : {})
});

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', authLimiter, async (req, res) => {
    try {
        const { name, password } = req.body || {};
        const email = normalizeEmail(req.body?.email);

        const validationError = validateName(name)
            || validateEmail(email)
            || validatePassword(password);
        if (validationError) return badRequest(res, validationError);

        if (await User.exists({ email })) {
            return badRequest(res, 'User with this email already exists');
        }

        const user = await User.create({
            name: name.trim(),
            email,
            password
        });

        return res.status(201).json({
            success: true,
            data: authPayload(user, generateToken(user._id))
        });
    } catch (error) {
        return sendRouteError(res, error, 'Register');
    }
});

// @route   POST /api/auth/login
// @desc    Login user & get token
// @access  Public
router.post('/login', authLimiter, async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;

        if (!email || typeof password !== 'string' || !password) {
            return badRequest(res, 'Please provide email and password');
        }

        // Find user and include password for comparison
        const user = await User.findOne({ email }).select('+password');
        const isMatch = user
            ? await user.comparePassword(password)
            : await bcrypt.compare(password, DUMMY_PASSWORD_HASH).then(() => false);

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        return res.json({
            success: true,
            data: authPayload(user, generateToken(user._id))
        });
    } catch (error) {
        return sendRouteError(res, error, 'Login');
    }
});

// @route   GET /api/auth/me
// @desc    Get current logged-in user
// @access  Private
router.get('/me', protect, async (req, res) => {
    try {
        // Reading history is served by /api/user/history; the session payload
        // only needs the profile plus bookmark ids for the bookmark toggles.
        const user = await User.findById(req.user._id)
            .select('-readHistory')
            .lean();

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        return res.json({
            success: true,
            data: {
                ...user,
                bookmarks: (user.bookmarks || []).map(String)
            }
        });
    } catch (error) {
        return sendRouteError(res, error, 'Load profile');
    }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', protect, async (req, res) => {
    try {
        const { name, darkMode } = req.body || {};
        const updates = {};

        if (name !== undefined) {
            const nameError = validateName(name);
            if (nameError) return badRequest(res, nameError);
            updates.name = name.trim();
        }
        if (req.body?.email !== undefined) {
            const email = normalizeEmail(req.body.email);
            const emailError = validateEmail(email);
            if (emailError) return badRequest(res, emailError);
            updates.email = email;
        }
        if (typeof darkMode === 'boolean') updates.darkMode = darkMode;

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('-readHistory');

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        return res.json({
            success: true,
            data: user
        });
    } catch (error) {
        return sendRouteError(res, error, 'Update profile');
    }
});

// @route   PUT /api/auth/password
// @desc    Change password
// @access  Private
router.put('/password', protect, authLimiter, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};

        if (typeof currentPassword !== 'string' || !currentPassword) {
            return badRequest(res, 'Current password is required');
        }
        const passwordError = validatePassword(newPassword, 'New password');
        if (passwordError) return badRequest(res, passwordError);

        const user = await User.findById(req.user._id).select('+password');
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                error: 'Current password is incorrect'
            });
        }

        user.password = newPassword;
        await user.save();

        return res.json({
            success: true,
            message: 'Password updated successfully'
        });
    } catch (error) {
        return sendRouteError(res, error, 'Change password');
    }
});

module.exports = router;

const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Article = require('../models/Article');
const { protect } = require('../middleware/authMiddleware');
const { createRateLimiter } = require('../middleware/rateLimit');
const { clamp, isValidObjectId, toInteger } = require('../utils/validation');
const { updateUserPreferences, getRecommendations } = require('../services/preferenceService');
const { triggerNewsletterForUser } = require('../services/newsletterScheduler');

const router = express.Router();

const HISTORY_LIMIT = 100;
const FEED_CATEGORIES = ['technology', 'business', 'sports', 'entertainment', 'health', 'science'];
const DIGEST_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Sending mail is the one user-triggered action with an external side effect;
// cap it per account so the test endpoint cannot be used to flood an inbox.
const newsletterLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 3,
    keyGenerator: (req) => `user:${req.user?._id}`,
    message: 'A newsletter was sent recently. Please wait a few minutes before trying again.'
});

const badRequest = (res, error) => res.status(400).json({ success: false, error });

const serverError = (res, error, context) => {
    console.error(`${context} error:`, error);
    return res.status(500).json({
        success: false,
        error: 'Something went wrong. Please try again.'
    });
};

const userNotFound = (res) => res.status(404).json({ success: false, error: 'User not found' });

const requireArticleId = (req, res) => {
    const { articleId } = req.params;
    if (!isValidObjectId(articleId)) {
        badRequest(res, 'Invalid article id');
        return null;
    }
    return articleId;
};

const isHttpUrl = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
};

// ============ BOOKMARKS ============

// @route   POST /api/user/bookmarks/:articleId
// @desc    Add article to bookmarks (idempotent)
// @access  Private
router.post('/bookmarks/:articleId', protect, async (req, res) => {
    const articleId = requireArticleId(req, res);
    if (!articleId) return undefined;

    try {
        if (!(await Article.exists({ _id: articleId }))) {
            return res.status(404).json({ success: false, error: 'Article not found' });
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $addToSet: { bookmarks: articleId } },
            { new: true }
        ).select('bookmarks').lean();
        if (!user) return userNotFound(res);

        return res.json({
            success: true,
            message: 'Article bookmarked',
            bookmarks: user.bookmarks.map(String)
        });
    } catch (error) {
        return serverError(res, error, 'Add bookmark');
    }
});

// @route   DELETE /api/user/bookmarks/:articleId
// @desc    Remove article from bookmarks
// @access  Private
router.delete('/bookmarks/:articleId', protect, async (req, res) => {
    const articleId = requireArticleId(req, res);
    if (!articleId) return undefined;

    try {
        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $pull: { bookmarks: articleId } },
            { new: true }
        ).select('bookmarks').lean();
        if (!user) return userNotFound(res);

        return res.json({
            success: true,
            message: 'Bookmark removed',
            bookmarks: user.bookmarks.map(String)
        });
    } catch (error) {
        return serverError(res, error, 'Remove bookmark');
    }
});

// @route   GET /api/user/bookmarks
// @desc    Get all bookmarked articles, newest bookmark first
// @access  Private
router.get('/bookmarks', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('bookmarks')
            .populate('bookmarks')
            .lean();
        if (!user) return userNotFound(res);

        const bookmarks = (user.bookmarks || []).filter(Boolean).reverse();
        return res.json({
            success: true,
            count: bookmarks.length,
            data: bookmarks
        });
    } catch (error) {
        return serverError(res, error, 'Load bookmarks');
    }
});

// ============ READING HISTORY ============

// @route   POST /api/user/history/:articleId
// @desc    Add article to reading history
// @access  Private
router.post('/history/:articleId', protect, async (req, res) => {
    const articleId = requireArticleId(req, res);
    if (!articleId) return undefined;

    try {
        if (!(await Article.exists({ _id: articleId }))) {
            return res.status(404).json({ success: false, error: 'Article not found' });
        }

        const article = new mongoose.Types.ObjectId(articleId);
        const entry = {
            _id: new mongoose.Types.ObjectId(),
            article,
            readAt: new Date()
        };

        // One atomic pipeline update: drop any previous entry for the article,
        // prepend the new read, and keep the newest HISTORY_LIMIT entries.
        // Concurrent reads from several tabs can no longer overwrite each other.
        const result = await User.updateOne({ _id: req.user._id }, [{
            $set: {
                readHistory: {
                    $slice: [
                        {
                            $concatArrays: [
                                { $literal: [entry] },
                                {
                                    $filter: {
                                        input: { $ifNull: ['$readHistory', []] },
                                        as: 'item',
                                        cond: { $ne: ['$$item.article', article] }
                                    }
                                }
                            ]
                        },
                        HISTORY_LIMIT
                    ]
                }
            }
        }]);
        if (!result.matchedCount) return userNotFound(res);

        return res.json({
            success: true,
            message: 'Added to reading history'
        });
    } catch (error) {
        return serverError(res, error, 'Add history');
    }
});

// @route   GET /api/user/history
// @desc    Get reading history
// @access  Private
router.get('/history', protect, async (req, res) => {
    try {
        const limit = clamp(toInteger(req.query.limit, 20), 1, HISTORY_LIMIT);
        const user = await User.findById(req.user._id)
            .select({ readHistory: { $slice: limit } })
            .populate('readHistory.article')
            .lean();
        if (!user) return userNotFound(res);

        const history = (user.readHistory || []).filter((item) => item.article);

        return res.json({
            success: true,
            count: history.length,
            data: history
        });
    } catch (error) {
        return serverError(res, error, 'Load history');
    }
});

// @route   DELETE /api/user/history
// @desc    Clear reading history
// @access  Private
router.delete('/history', protect, async (req, res) => {
    try {
        const result = await User.updateOne(
            { _id: req.user._id },
            { $set: { readHistory: [] } }
        );
        if (!result.matchedCount) return userNotFound(res);

        return res.json({
            success: true,
            message: 'Reading history cleared'
        });
    } catch (error) {
        return serverError(res, error, 'Clear history');
    }
});

// ============ CUSTOM RSS FEEDS ============

// @route   POST /api/user/feeds
// @desc    Add custom RSS feed
// @access  Private
router.post('/feeds', protect, async (req, res) => {
    try {
        const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
        const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
        const category = typeof req.body?.category === 'string' ? req.body.category : '';

        if (!url) return badRequest(res, 'Feed URL is required');
        if (url.length > 2048 || !isHttpUrl(url)) {
            return badRequest(res, 'Feed URL must be a valid http(s) URL');
        }
        if (category && !FEED_CATEGORIES.includes(category)) {
            return badRequest(res, `Category must be one of: ${FEED_CATEGORIES.join(', ')}`);
        }

        const result = await User.updateOne(
            { _id: req.user._id, 'customFeeds.url': { $ne: url } },
            {
                $push: {
                    customFeeds: {
                        url,
                        name: name || 'Custom Feed',
                        category: category || 'technology'
                    }
                }
            }
        );
        if (!result.modifiedCount) {
            if (!(await User.exists({ _id: req.user._id }))) return userNotFound(res);
            return badRequest(res, 'Feed already added');
        }

        const user = await User.findById(req.user._id).select('customFeeds').lean();
        return res.json({
            success: true,
            message: 'Feed added',
            data: user?.customFeeds || []
        });
    } catch (error) {
        return serverError(res, error, 'Add feed');
    }
});

// @route   GET /api/user/feeds
// @desc    Get user's custom feeds
// @access  Private
router.get('/feeds', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('customFeeds').lean();
        if (!user) return userNotFound(res);

        return res.json({
            success: true,
            count: user.customFeeds.length,
            data: user.customFeeds
        });
    } catch (error) {
        return serverError(res, error, 'Load feeds');
    }
});

// @route   DELETE /api/user/feeds/:feedId
// @desc    Remove custom RSS feed
// @access  Private
router.delete('/feeds/:feedId', protect, async (req, res) => {
    const { feedId } = req.params;
    if (!isValidObjectId(feedId)) return badRequest(res, 'Invalid feed id');

    try {
        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $pull: { customFeeds: { _id: feedId } } },
            { new: true }
        ).select('customFeeds').lean();
        if (!user) return userNotFound(res);

        return res.json({
            success: true,
            message: 'Feed removed',
            data: user.customFeeds
        });
    } catch (error) {
        return serverError(res, error, 'Remove feed');
    }
});

// ============ EMAIL PREFERENCES ============

// @route   PUT /api/user/email-preferences
// @desc    Update email notification preferences
// @access  Private
router.put('/email-preferences', protect, async (req, res) => {
    try {
        const { dailyDigest, weeklyDigest, breakingNews, digestTime } = req.body || {};
        const updates = {};

        if (typeof dailyDigest === 'boolean') updates['emailPreferences.dailyDigest'] = dailyDigest;
        if (typeof weeklyDigest === 'boolean') updates['emailPreferences.weeklyDigest'] = weeklyDigest;
        if (typeof breakingNews === 'boolean') updates['emailPreferences.breakingNews'] = breakingNews;
        if (digestTime !== undefined) {
            if (typeof digestTime !== 'string' || !DIGEST_TIME_PATTERN.test(digestTime)) {
                return badRequest(res, 'digestTime must use 24-hour HH:MM format');
            }
            updates['emailPreferences.digestTime'] = digestTime;
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $set: updates },
            { new: true }
        ).select('emailPreferences').lean();
        if (!user) return userNotFound(res);

        return res.json({
            success: true,
            data: user.emailPreferences
        });
    } catch (error) {
        return serverError(res, error, 'Update email preferences');
    }
});

// @route   GET /api/user/email-preferences
// @desc    Get email notification preferences
// @access  Private
router.get('/email-preferences', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('emailPreferences').lean();
        if (!user) return userNotFound(res);

        return res.json({
            success: true,
            data: user.emailPreferences
        });
    } catch (error) {
        return serverError(res, error, 'Load email preferences');
    }
});

// ============ TESTING & NEWSLETTER ============

// @route   POST /api/user/test/update-preferences
// @desc    Manually trigger preference update (Testing)
// @access  Private
router.post('/test/update-preferences', protect, async (req, res) => {
    try {
        const preferences = await updateUserPreferences(req.user._id);
        return res.json({
            success: true,
            message: preferences
                ? 'Preferences updated based on reading history'
                : 'No recent reading history to learn from yet',
            data: preferences
        });
    } catch (error) {
        return serverError(res, error, 'Update preferences');
    }
});

// @route   POST /api/user/test/send-newsletter
// @desc    Manually trigger personalized newsletter (Testing)
// @access  Private
router.post('/test/send-newsletter', protect, newsletterLimiter, async (req, res) => {
    try {
        const success = await triggerNewsletterForUser(req.user._id);
        if (success) {
            return res.json({
                success: true,
                message: 'Personalized newsletter sent successfully'
            });
        }
        return res.status(502).json({
            success: false,
            error: 'Failed to send newsletter. Check server logs.'
        });
    } catch (error) {
        return serverError(res, error, 'Send newsletter');
    }
});

// @route   GET /api/user/recommendations
// @desc    Get personalized article recommendations
// @access  Private
router.get('/recommendations', protect, async (req, res) => {
    try {
        const recommendations = await getRecommendations(req.user._id);
        return res.json({
            success: true,
            data: recommendations
        });
    } catch (error) {
        return serverError(res, error, 'Load recommendations');
    }
});

module.exports = router;

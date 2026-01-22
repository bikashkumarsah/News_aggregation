const express = require('express');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { updateUserPreferences, getRecommendations } = require('../services/preferenceService');
const { triggerNewsletterForUser } = require('../services/newsletterScheduler');

const router = express.Router();

// ============ BOOKMARKS ============

// @route   POST /api/user/bookmarks/:articleId
// @desc    Add article to bookmarks
// @access  Private
router.post('/bookmarks/:articleId', protect, async (req, res) => {
    try {
        const { articleId } = req.params;
        const user = await User.findById(req.user._id);

        // Check if already bookmarked
        if (user.bookmarks.includes(articleId)) {
            return res.status(400).json({
                success: false,
                error: 'Article already bookmarked'
            });
        }

        user.bookmarks.push(articleId);
        await user.save();

        res.json({
            success: true,
            message: 'Article bookmarked',
            bookmarks: user.bookmarks
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// @route   DELETE /api/user/bookmarks/:articleId
// @desc    Remove article from bookmarks
// @access  Private
router.delete('/bookmarks/:articleId', protect, async (req, res) => {
    try {
        const { articleId } = req.params;
        const user = await User.findById(req.user._id);

        user.bookmarks = user.bookmarks.filter(id => id.toString() !== articleId);
        await user.save();

        res.json({
            success: true,
            message: 'Bookmark removed',
            bookmarks: user.bookmarks
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// @route   GET /api/user/bookmarks
// @desc    Get all bookmarked articles
// @access  Private
router.get('/bookmarks', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate('bookmarks');

        res.json({
            success: true,
            count: user.bookmarks.length,
            data: user.bookmarks
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============ READING HISTORY ============

// @route   POST /api/user/history/:articleId
// @desc    Add article to reading history
// @access  Private
router.post('/history/:articleId', protect, async (req, res) => {
    try {
        const { articleId } = req.params;
        const user = await User.findById(req.user._id);

        // Remove if already in history (will re-add with new timestamp)
        user.readHistory = user.readHistory.filter(
            item => item.article.toString() !== articleId
        );

        // Add to beginning of history
        user.readHistory.unshift({
            article: articleId,
            readAt: new Date()
        });

        // Keep only last 100 items
        if (user.readHistory.length > 100) {
            user.readHistory = user.readHistory.slice(0, 100);
        }

        await user.save();

        res.json({
            success: true,
            message: 'Added to reading history'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// @route   GET /api/user/history
// @desc    Get reading history
// @access  Private
router.get('/history', protect, async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        const user = await User.findById(req.user._id)
            .populate('readHistory.article');

        const history = user.readHistory
            .filter(item => item.article) // Filter out deleted articles
            .slice(0, parseInt(limit));

        res.json({
            success: true,
            count: history.length,
            data: history
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// @route   DELETE /api/user/history
// @desc    Clear reading history
// @access  Private
router.delete('/history', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        user.readHistory = [];
        await user.save();

        res.json({
            success: true,
            message: 'Reading history cleared'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============ CUSTOM RSS FEEDS ============

// @route   POST /api/user/feeds
// @desc    Add custom RSS feed
// @access  Private
router.post('/feeds', protect, async (req, res) => {
    try {
        const { url, name, category } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'Feed URL is required'
            });
        }

        const user = await User.findById(req.user._id);

        // Check if feed already exists
        const exists = user.customFeeds.some(feed => feed.url === url);
        if (exists) {
            return res.status(400).json({
                success: false,
                error: 'Feed already added'
            });
        }

        user.customFeeds.push({
            url,
            name: name || 'Custom Feed',
            category: category || 'technology'
        });

        await user.save();

        res.json({
            success: true,
            message: 'Feed added',
            data: user.customFeeds
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// @route   GET /api/user/feeds
// @desc    Get user's custom feeds
// @access  Private
router.get('/feeds', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        res.json({
            success: true,
            count: user.customFeeds.length,
            data: user.customFeeds
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// @route   DELETE /api/user/feeds/:feedId
// @desc    Remove custom RSS feed
// @access  Private
router.delete('/feeds/:feedId', protect, async (req, res) => {
    try {
        const { feedId } = req.params;
        const user = await User.findById(req.user._id);

        user.customFeeds = user.customFeeds.filter(
            feed => feed._id.toString() !== feedId
        );

        await user.save();

        res.json({
            success: true,
            message: 'Feed removed',
            data: user.customFeeds
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============ EMAIL PREFERENCES ============

// @route   PUT /api/user/email-preferences
// @desc    Update email notification preferences
// @access  Private
router.put('/email-preferences', protect, async (req, res) => {
    try {
        const { dailyDigest, weeklyDigest, breakingNews } = req.body;
        const user = await User.findById(req.user._id);

        if (typeof dailyDigest === 'boolean') {
            user.emailPreferences.dailyDigest = dailyDigest;
        }
        if (typeof weeklyDigest === 'boolean') {
            user.emailPreferences.weeklyDigest = weeklyDigest;
        }
        if (typeof breakingNews === 'boolean') {
            user.emailPreferences.breakingNews = breakingNews;
        }

        await user.save();

        res.json({
            success: true,
            data: user.emailPreferences
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// @route   GET /api/user/email-preferences
// @desc    Get email notification preferences
// @access  Private
router.get('/email-preferences', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        res.json({
            success: true,
            data: user.emailPreferences
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============ TESTING & NEWSLETTER ============

// @route   POST /api/user/test/update-preferences
// @desc    Manually trigger preference update (Testing)
// @access  Private
router.post('/test/update-preferences', protect, async (req, res) => {
    try {
        const preferences = await updateUserPreferences(req.user._id);
        res.json({
            success: true,
            message: 'Preferences updated based on reading history',
            data: preferences
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// @route   POST /api/user/test/send-newsletter
// @desc    Manually trigger personalized newsletter (Testing)
// @access  Private
router.post('/test/send-newsletter', protect, async (req, res) => {
    try {
        const success = await triggerNewsletterForUser(req.user._id);
        if (success) {
            res.json({
                success: true,
                message: 'Personalized newsletter sent successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to send newsletter. Check server logs.'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// @route   GET /api/user/recommendations
// @desc    Get personalized article recommendations
// @access  Private
router.get('/recommendations', protect, async (req, res) => {
    try {
        const recommendations = await getRecommendations(req.user._id);
        res.json({
            success: true,
            data: recommendations
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

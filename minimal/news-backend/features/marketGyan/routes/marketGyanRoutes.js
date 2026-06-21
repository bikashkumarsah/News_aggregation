const express = require('express');
const { loadOverview } = require('../services/overviewService');
const { isReviewRequestAllowed } = require('../middleware/reviewAccess');
const { requireInternalAccess } = require('../middleware/internalAccess');
const { marketGyanConfig } = require('../config');
const { createMarketQdrantClient } = require('../services/marketQdrantService');
const MarketReport = require('../models/MarketReport');
const {
    answerMarketQuery,
    generateDailyReport
} = require('../services/reportService');
const {
    isLocalReportGenerationAllowed,
    loadRuntimeStatus
} = require('../services/runtimeStatusService');
const reviewRoutes = require('./reviewRoutes');

const router = express.Router();

router.get('/overview', async (req, res) => {
    try {
        res.json(await loadOverview({
            reviewEnabled: isReviewRequestAllowed(req)
        }));
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/search', async (req, res) => {
    if (!marketGyanConfig.queryEnabled) {
        return res.status(404).json({ success: false, error: 'Market Gyan query is disabled' });
    }
    try {
        const results = await createMarketQdrantClient().search(req.query.q, req.query);
        return res.json({ success: true, data: results });
    } catch (error) {
        return res.status(error.status || 503).json({ success: false, error: error.message });
    }
});

router.post('/query', async (req, res) => {
    try {
        const data = await answerMarketQuery({
            question: req.body?.question,
            filters: req.body?.filters || {}
        });
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            error: error.message,
            validationErrors: error.validationErrors || []
        });
    }
});

router.get('/runtime/status', async (req, res) => {
    try {
        return res.json({ success: true, data: await loadRuntimeStatus(req) });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/reports/latest', async (_req, res) => {
    try {
        const report = await MarketReport.findOne({ status: 'published' })
            .sort({ reportDate: -1 })
            .lean();
        return res.json({ success: true, data: report });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/reports/generate', async (req, res) => {
    if (!isLocalReportGenerationAllowed(req)) {
        return res.status(404).json({
            success: false,
            error: 'Market Gyan local report generation is not available'
        });
    }
    try {
        const data = await generateDailyReport({
            date: req.body?.date || new Date(),
            force: req.body?.force === true
        });
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            error: error.message,
            validationErrors: error.validationErrors || []
        });
    }
});

router.get('/internal/search', requireInternalAccess, async (req, res) => {
    try {
        const results = await createMarketQdrantClient().search(req.query.q, req.query);
        return res.json({ success: true, data: results });
    } catch (error) {
        return res.status(error.status || 503).json({ success: false, error: error.message });
    }
});

router.post('/internal/reports/generate', requireInternalAccess, async (req, res) => {
    try {
        const data = await generateDailyReport({
            date: req.body?.date || new Date(),
            force: req.body?.force === true
        });
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

router.use('/review', reviewRoutes);

module.exports = router;

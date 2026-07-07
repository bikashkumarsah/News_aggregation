const express = require('express');
const { loadOverview } = require('../services/overviewService');
const { isReviewRequestAllowed } = require('../middleware/reviewAccess');
const { requireInternalAccess } = require('../middleware/internalAccess');
const { createRateLimiter } = require('../middleware/rateLimit');
const { sendError } = require('../middleware/errorResponse');
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

// Throttle the expensive, unauthenticated inference/search endpoints so a tight
// loop cannot exhaust embedding/LLM resources.
const inferenceRateLimit = createRateLimiter({ windowMs: 60000, max: 20 });

router.get('/overview', async (req, res) => {
    try {
        res.json(await loadOverview({
            reviewEnabled: isReviewRequestAllowed(req)
        }));
    } catch (error) {
        sendError(res, error, 'Market Gyan overview is unavailable');
    }
});

router.get('/search', inferenceRateLimit, async (req, res) => {
    if (!marketGyanConfig.queryEnabled) {
        return res.status(404).json({ success: false, error: 'Market Gyan query is disabled' });
    }
    try {
        const results = await createMarketQdrantClient().search(req.query.q, req.query);
        return res.json({ success: true, data: results });
    } catch (error) {
        return sendError(res, error, 'Market Gyan search is unavailable');
    }
});

router.post('/query', inferenceRateLimit, async (req, res) => {
    try {
        const data = await answerMarketQuery({
            question: req.body?.question,
            filters: req.body?.filters || {}
        });
        return res.json({ success: true, data });
    } catch (error) {
        return sendError(res, error, 'Market Gyan query failed');
    }
});

router.get('/runtime/status', async (req, res) => {
    try {
        return res.json({ success: true, data: await loadRuntimeStatus(req) });
    } catch (error) {
        return sendError(res, error, 'Runtime status is unavailable');
    }
});

router.get('/reports/latest', async (_req, res) => {
    try {
        const report = await MarketReport.findOne({ status: 'published' })
            .sort({ reportDate: -1 })
            .lean();
        return res.json({ success: true, data: report });
    } catch (error) {
        return sendError(res, error, 'Latest report is unavailable');
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
        return sendError(res, error, 'Report generation failed');
    }
});

router.get('/internal/search', requireInternalAccess, async (req, res) => {
    try {
        const results = await createMarketQdrantClient().search(req.query.q, req.query);
        return res.json({ success: true, data: results });
    } catch (error) {
        return sendError(res, error, 'Market Gyan search is unavailable');
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
        return sendError(res, error, 'Report generation failed');
    }
});

router.use('/review', reviewRoutes);

module.exports = router;

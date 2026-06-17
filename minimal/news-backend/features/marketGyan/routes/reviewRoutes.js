const express = require('express');
const { marketGyanConfig } = require('../config');
const { requireLocalReviewAccess } = require('../middleware/reviewAccess');
const { getVersionedOntology } = require('../services/ontologyService');
const {
    exportApprovedLabels,
    getReviewStats,
    listQueue,
    regenerateLabel,
    reviewLabel
} = require('../services/labelQueueService');

const router = express.Router();

router.use(requireLocalReviewAccess);

router.get('/ontology', async (_req, res) => {
    try {
        res.json({ success: true, data: await getVersionedOntology() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/queue', async (req, res) => {
    try {
        const data = await listQueue({
            ...req.query,
            reviewerId: marketGyanConfig.reviewerId,
            reviewerRole: marketGyanConfig.reviewerRole
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/stats', async (req, res) => {
    try {
        const data = await getReviewStats({
            schemaVersion: req.query.schemaVersion
        });
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.patch('/items/:id', async (req, res) => {
    try {
        const item = await reviewLabel(req.params.id, {
            action: req.body?.action,
            candidate: req.body?.candidate,
            reason: req.body?.reason,
            reviewer: marketGyanConfig.reviewerId,
            reviewerRole: marketGyanConfig.reviewerRole
        });
        if (!item) {
            return res.status(404).json({
                success: false,
                error: 'Review item not found'
            });
        }
        return res.json({ success: true, data: item });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            error: error.message,
            validationErrors: error.validationErrors || []
        });
    }
});

router.post('/items/:id/adjudicate', async (req, res) => {
    try {
        const item = await reviewLabel(req.params.id, {
            action: req.body?.action || 'adjudicate',
            candidate: req.body?.candidate,
            reason: req.body?.reason,
            reviewer: marketGyanConfig.reviewerId,
            reviewerRole: marketGyanConfig.reviewerRole
        });
        if (!item) {
            return res.status(404).json({
                success: false,
                error: 'Review item not found'
            });
        }
        return res.json({ success: true, data: item });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            error: error.message,
            validationErrors: error.validationErrors || []
        });
    }
});

router.post('/items/:id/regenerate', async (req, res) => {
    try {
        const item = await regenerateLabel(req.params.id);
        if (!item) {
            return res.status(404).json({
                success: false,
                error: 'Review item not found'
            });
        }
        return res.json({ success: true, data: item });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/export', async (req, res) => {
    try {
        const schemaVersion = Number(req.query.schemaVersion || marketGyanConfig.schemaVersion);
        const rows = await exportApprovedLabels({ schemaVersion });
        const jsonl = rows.map((row) => JSON.stringify(row)).join('\n');
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="market-gyan-${schemaVersion === 2 ? 'adjudicated-v2' : 'approved-v1'}.jsonl"`
        );
        res.send(jsonl ? `${jsonl}\n` : '');
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

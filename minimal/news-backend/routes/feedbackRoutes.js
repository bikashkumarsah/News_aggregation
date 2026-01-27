const express = require('express');
const Feedback = require('../models/Feedback');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

const isValidObjectId = (id) => typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);

const clamp1to5 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 5) return null;
  return Math.round(n);
};

/**
 * POST /api/feedback/translation
 * Body: { articleId, rating, inputText?, outputText?, task?, model? }
 */
router.post('/translation', protect, async (req, res) => {
  try {
    const { articleId, rating, inputText, outputText, task, model } = req.body || {};
    if (!isValidObjectId(articleId)) {
      return res.status(400).json({ success: false, error: 'Invalid articleId' });
    }

    const score = clamp1to5(rating);
    if (!score) {
      return res.status(400).json({ success: false, error: 'rating must be an integer from 1 to 5' });
    }

    const doc = await Feedback.findOneAndUpdate(
      { user: req.user._id, article: articleId, kind: 'translation' },
      {
        $set: {
          task: task || 'translate_en_to_ne',
          model: model || process.env.MBART_MODEL || 'sagunrai/mbart-large-50-nepali-finetuned-1',
          inputText: inputText ? String(inputText).slice(0, 20000) : null,
          outputText: outputText ? String(outputText).slice(0, 20000) : null,
          rating: score
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Ensure mos is computed
    await doc.save();

    return res.json({ success: true, data: { mos: doc.mos } });
  } catch (error) {
    // Handle duplicate key / race: retry as update
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, error: 'Feedback already exists (retry)' });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/feedback/summary
 * Body: { articleId, fluency, adequacy, coverage, inputText?, outputText?, task?, model? }
 */
router.post('/summary', protect, async (req, res) => {
  try {
    const { articleId, fluency, adequacy, coverage, inputText, outputText, task, model } = req.body || {};
    if (!isValidObjectId(articleId)) {
      return res.status(400).json({ success: false, error: 'Invalid articleId' });
    }

    const f = clamp1to5(fluency);
    const a = clamp1to5(adequacy);
    const c = clamp1to5(coverage);

    if (!f || !a || !c) {
      return res.status(400).json({
        success: false,
        error: 'fluency, adequacy, coverage must each be an integer from 1 to 5'
      });
    }

    const doc = await Feedback.findOneAndUpdate(
      { user: req.user._id, article: articleId, kind: 'summary' },
      {
        $set: {
          task: task || 'summarize',
          model: model || process.env.MBART_MODEL || 'sagunrai/mbart-large-50-nepali-finetuned-1',
          inputText: inputText ? String(inputText).slice(0, 20000) : null,
          outputText: outputText ? String(outputText).slice(0, 20000) : null,
          fluency: f,
          adequacy: a,
          coverage: c
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Ensure mos is computed
    await doc.save();

    return res.json({ success: true, data: { mos: doc.mos, fluency: doc.fluency, adequacy: doc.adequacy, coverage: doc.coverage } });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ success: false, error: 'Feedback already exists (retry)' });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/feedback/mos?articleId=<id>&kind=summary|translation
 * Simple aggregation endpoint (optional, helps compute MOS quickly).
 */
router.get('/mos', async (req, res) => {
  try {
    const { articleId, kind } = req.query || {};
    if (!isValidObjectId(String(articleId || ''))) {
      return res.status(400).json({ success: false, error: 'Invalid articleId' });
    }
    if (kind !== 'summary' && kind !== 'translation') {
      return res.status(400).json({ success: false, error: 'kind must be summary or translation' });
    }

    const match = { article: require('mongoose').Types.ObjectId.createFromHexString(String(articleId)), kind };

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          mos: { $avg: '$mos' },
          fluency: { $avg: '$fluency' },
          adequacy: { $avg: '$adequacy' },
          coverage: { $avg: '$coverage' }
        }
      }
    ];

    const rows = await Feedback.aggregate(pipeline);
    const row = rows && rows[0] ? rows[0] : { count: 0, mos: null, fluency: null, adequacy: null, coverage: null };
    return res.json({ success: true, data: row });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;


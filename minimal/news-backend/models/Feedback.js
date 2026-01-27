const mongoose = require('mongoose');

/**
 * Human evaluation feedback for MOS-style scoring.
 *
 * Two feedback types are supported:
 * - translation: 1–5 overall score (Mean Opinion Score)
 * - summary: 1–5 scores for fluency, adequacy, coverage
 *
 * We store one feedback doc per (user, article, kind) so each user rates each item once.
 */

const clampScore = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 5) return null;
  return Math.round(n);
};

const feedbackSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    article: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Article',
      required: true,
      index: true
    },
    kind: {
      type: String,
      enum: ['translation', 'summary'],
      required: true,
      index: true
    },
    task: {
      type: String,
      default: null
    },
    model: {
      type: String,
      default: null
    },
    // What the user saw/rated (helps reproduce/inspect later)
    inputText: {
      type: String,
      default: null
    },
    outputText: {
      type: String,
      default: null
    },
    // Translation MOS
    rating: {
      type: Number,
      default: null,
      set: clampScore
    },
    // Summary MOS (per-dimension)
    fluency: { type: Number, default: null, set: clampScore },
    adequacy: { type: Number, default: null, set: clampScore },
    coverage: { type: Number, default: null, set: clampScore },
    // Convenience field for analysis (avg of summary dims or rating)
    mos: { type: Number, default: null }
  },
  { timestamps: true }
);

feedbackSchema.index({ user: 1, article: 1, kind: 1 }, { unique: true });

// Keep mos in sync
feedbackSchema.pre('save', function (next) {
  if (this.kind === 'translation') {
    this.mos = typeof this.rating === 'number' ? this.rating : null;
  } else if (this.kind === 'summary') {
    const vals = [this.fluency, this.adequacy, this.coverage].filter((v) => typeof v === 'number');
    this.mos = vals.length === 3 ? (vals[0] + vals[1] + vals[2]) / 3 : null;
  }
  next();
});

module.exports = mongoose.model('Feedback', feedbackSchema);


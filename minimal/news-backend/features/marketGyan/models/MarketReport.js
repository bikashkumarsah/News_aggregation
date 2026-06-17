const mongoose = require('mongoose');

const evidenceSchema = new mongoose.Schema({
    document: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MarketDocument'
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    sourceUrl: {
        type: String,
        required: true,
        trim: true
    },
    excerpt: String,
    relevanceScore: {
        type: Number,
        min: 0,
        max: 1
    }
}, { _id: false });

const sectorAnalysisSchema = new mongoose.Schema({
    sector: {
        type: String,
        required: true,
        trim: true
    },
    sentiment: {
        type: String,
        required: true,
        enum: ['bullish', 'bearish', 'neutral', 'unavailable']
    },
    summary: String,
    confidence: {
        type: Number,
        min: 0,
        max: 1
    },
    evidenceIndexes: {
        type: [Number],
        default: []
    }
}, { _id: false });

const marketReportSchema = new mongoose.Schema({
    reportDate: {
        type: Date,
        required: true,
        unique: true,
        index: true
    },
    status: {
        type: String,
        enum: ['draft', 'generating', 'published', 'failed'],
        default: 'draft'
    },
    marketSnapshot: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MarketSnapshot'
    },
    headline: {
        type: String,
        trim: true
    },
    summary: String,
    sectorAnalysis: {
        type: [sectorAnalysisSchema],
        default: []
    },
    evidence: {
        type: [evidenceSchema],
        default: []
    },
    model: {
        provider: String,
        name: String,
        version: String,
        generatedAt: Date
    },
    generationError: String,
    schemaVersion: {
        type: Number,
        default: 1,
        min: 1
    }
}, {
    timestamps: true
});

marketReportSchema.index({ reportDate: -1, status: 1 });

module.exports = mongoose.models.MarketReport
    || mongoose.model('MarketReport', marketReportSchema);

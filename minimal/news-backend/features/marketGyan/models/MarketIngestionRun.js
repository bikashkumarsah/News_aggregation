const mongoose = require('mongoose');

const sourceResultSchema = new mongoose.Schema({
    source: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'complete', 'partial', 'failed'],
        default: 'pending'
    },
    fetched: {
        type: Number,
        default: 0,
        min: 0
    },
    created: {
        type: Number,
        default: 0,
        min: 0
    },
    updated: {
        type: Number,
        default: 0,
        min: 0
    },
    skipped: {
        type: Number,
        default: 0,
        min: 0
    },
    durationMs: {
        type: Number,
        default: 0,
        min: 0
    },
    warnings: {
        type: [String],
        default: []
    },
    error: String
}, { _id: false });

const marketIngestionRunSchema = new mongoose.Schema({
    runKey: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    mode: {
        type: String,
        enum: ['daily', 'backfill'],
        required: true
    },
    from: {
        type: Date,
        required: true
    },
    to: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['running', 'complete', 'partial', 'failed'],
        default: 'running',
        index: true
    },
    startedAt: {
        type: Date,
        default: Date.now
    },
    completedAt: Date,
    sources: {
        type: [sourceResultSchema],
        default: []
    },
    error: String
}, {
    timestamps: true
});

marketIngestionRunSchema.index({ startedAt: -1, status: 1 });

module.exports = mongoose.models.MarketIngestionRun
    || mongoose.model('MarketIngestionRun', marketIngestionRunSchema);

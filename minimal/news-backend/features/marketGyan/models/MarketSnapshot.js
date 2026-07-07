const mongoose = require('mongoose');

const sourceProvenanceSchema = new mongoose.Schema({
    sourceName: {
        type: String,
        required: true,
        trim: true
    },
    sourceUrl: {
        type: String,
        required: true,
        trim: true
    },
    retrievedAt: {
        type: Date,
        default: Date.now
    },
    fields: {
        type: [String],
        default: []
    },
    values: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, { _id: false });

const conflictSchema = new mongoose.Schema({
    field: {
        type: String,
        required: true
    },
    values: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    resolution: {
        type: String,
        enum: ['official_selected', 'fallback_selected', 'withheld'],
        required: true
    }
}, { _id: false });

const sectorSchema = new mongoose.Schema({
    code: {
        type: String,
        trim: true,
        uppercase: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    close: Number,
    change: Number,
    changePercent: Number,
    // Number of constituent securities when the sector movement is derived by
    // aggregating members rather than read from an official sector sub-index.
    constituents: Number,
    basis: {
        type: String,
        enum: ['sector_index', 'constituent_average'],
        default: 'sector_index'
    },
    sentiment: {
        type: String,
        enum: ['bullish', 'bearish', 'neutral', 'unavailable'],
        default: 'unavailable'
    }
}, { _id: false });

const securityLeaderSchema = new mongoose.Schema({
    symbol: {
        type: String,
        required: true,
        trim: true,
        uppercase: true
    },
    name: {
        type: String,
        trim: true
    },
    lastTradedPrice: Number,
    changePercent: Number,
    volume: Number
}, { _id: false });

const marketSnapshotSchema = new mongoose.Schema({
    marketDate: {
        type: Date,
        required: true,
        unique: true,
        index: true
    },
    status: {
        type: String,
        enum: ['pending', 'complete', 'partial', 'failed'],
        default: 'pending'
    },
    index: {
        open: Number,
        high: Number,
        low: Number,
        close: Number,
        change: Number,
        changePercent: Number
    },
    turnover: {
        amount: Number,
        volume: Number,
        transactions: Number
    },
    sectors: {
        type: [sectorSchema],
        default: []
    },
    breadth: {
        advancers: Number,
        decliners: Number,
        unchanged: Number
    },
    leaders: {
        gainers: {
            type: [securityLeaderSchema],
            default: []
        },
        losers: {
            type: [securityLeaderSchema],
            default: []
        },
        volumeLeaders: {
            type: [securityLeaderSchema],
            default: []
        }
    },
    provenance: {
        type: [sourceProvenanceSchema],
        default: []
    },
    quality: {
        selectedSources: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        missingFields: {
            type: [String],
            default: []
        },
        conflicts: {
            type: [conflictSchema],
            default: []
        },
        warnings: {
            type: [String],
            default: []
        }
    },
    collectedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

marketSnapshotSchema.index({ marketDate: -1, status: 1 });

module.exports = mongoose.models.MarketSnapshot
    || mongoose.model('MarketSnapshot', marketSnapshotSchema);

const mongoose = require('mongoose');

const returnSchema = new mongoose.Schema({
    identifier: String,
    baselineClose: Number,
    firstSessionClose: Number,
    thirdSessionClose: Number,
    firstSessionReturn: Number,
    thirdSessionReturn: Number,
    firstSessionAbnormalReturn: Number,
    thirdSessionAbnormalReturn: Number
}, { _id: false });

const marketReactionSchema = new mongoose.Schema({
    label: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MarketLabel',
        required: true,
        unique: true,
        index: true
    },
    document: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MarketDocument',
        required: true,
        index: true
    },
    publicationAt: {
        type: Date,
        required: true,
        index: true
    },
    baselineTradingDate: Date,
    firstTradingDate: Date,
    thirdTradingDate: Date,
    index: returnSchema,
    sectors: {
        type: [returnSchema],
        default: []
    },
    symbols: {
        type: [returnSchema],
        default: []
    },
    provenance: {
        type: [{
            sourceName: String,
            sourceUrl: String,
            fields: [String],
            retrievedAt: Date
        }],
        default: []
    },
    missingFields: {
        type: [String],
        default: []
    },
    overlapWarnings: {
        type: [String],
        default: []
    },
    status: {
        type: String,
        enum: ['complete', 'partial', 'unavailable'],
        default: 'unavailable'
    },
    computedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.models.MarketReaction
    || mongoose.model('MarketReaction', marketReactionSchema);

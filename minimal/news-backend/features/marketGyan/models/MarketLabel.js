const mongoose = require('mongoose');

const candidateSchema = new mongoose.Schema({
    language: {
        type: String,
        enum: ['en', 'ne', 'mixed']
    },
    summary: String,
    sentiment: {
        type: String,
        enum: ['bullish', 'bearish', 'neutral']
    },
    sectors: {
        type: [String],
        default: []
    },
    symbols: {
        type: [String],
        default: []
    },
    tags: {
        type: [String],
        default: []
    },
    confidenceBand: {
        type: String,
        enum: ['low', 'medium', 'high']
    },
    rationale: String,
    evidence: {
        type: [String],
        default: []
    },
    relevance: {
        type: String,
        enum: ['direct', 'indirect', 'not_relevant']
    },
    eventType: {
        type: String,
        enum: [
            'market_trading',
            'earnings',
            'capital_action',
            'governance',
            'project_operations',
            'credit_financing',
            'regulation',
            'monetary_liquidity',
            'fiscal_macroeconomic',
            'sector_industry',
            'other',
            'not_applicable'
        ]
    },
    impactScope: {
        type: String,
        enum: ['company', 'sector', 'market', 'none']
    },
    impactDirection: {
        type: String,
        enum: ['bullish', 'bearish', 'neutral', 'uncertain', 'not_applicable']
    },
    impactHorizon: {
        type: String,
        enum: ['immediate', 'short_term', 'medium_term', 'not_applicable']
    },
    impactMechanism: {
        type: String,
        enum: [
            'earnings_cash_flow',
            'ownership_supply',
            'financing_liquidity',
            'regulation',
            'demand_revenue',
            'operations_capacity',
            'valuation_sentiment',
            'market_flow',
            'uncertain',
            'none'
        ]
    },
    evidenceSentenceIds: {
        type: [String],
        default: []
    }
}, { _id: false });

const revisionSchema = new mongoose.Schema({
    action: {
        type: String,
        enum: [
            'generated',
            'edited',
            'approved',
            'rejected',
            'regenerated',
            'assistant_reviewed',
            'annotation_submitted',
            'adjudicated',
            'excluded'
        ],
        required: true
    },
    candidate: candidateSchema,
    reason: String,
    actor: String,
    at: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

const marketLabelSchema = new mongoose.Schema({
    document: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MarketDocument',
        required: true,
        index: true
    },
    idempotencyKey: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    status: {
        type: String,
        enum: [
            'queued',
            'processing',
            'pending_review',
            'approved',
            'rejected',
            'failed'
        ],
        default: 'queued',
        index: true
    },
    input: {
        title: {
            type: String,
            required: true
        },
        excerpt: {
            type: String,
            required: true
        },
        contentHash: {
            type: String,
            required: true,
            index: true
        },
        languageHint: String,
        sourceName: String,
        sourceUrl: String,
        publishedAt: Date,
        marketContext: mongoose.Schema.Types.Mixed,
        sentences: {
            type: [{
                id: String,
                text: String
            }],
            default: []
        },
        selectionBucket: {
            type: String,
            enum: ['direct', 'indirect', 'hard_negative', 'reserve']
        },
        duplicateGroupId: String
    },
    originalCandidate: candidateSchema,
    candidate: candidateSchema,
    assistantReview: {
        candidate: candidateSchema,
        changedFields: {
            type: [String],
            default: []
        },
        reviewer: String,
        notes: String,
        reviewedAt: Date,
    },
    validationErrors: {
        type: [String],
        default: []
    },
    rejectionReason: String,
    model: {
        provider: {
            type: String,
            default: 'google'
        },
        name: String,
        promptVersion: String,
        schemaVersion: Number
    },
    rawResponse: mongoose.Schema.Types.Mixed,
    ontologyVersion: String,
    adjudication: {
        status: {
            type: String,
            enum: ['pending', 'adjudicated', 'excluded'],
            default: 'pending'
        },
        goldCandidate: candidateSchema,
        reason: String,
        secondReviewRequired: {
            type: Boolean,
            default: false
        },
        adjudicatedBy: String,
        adjudicatedAt: Date
    },
    usage: {
        promptTokens: Number,
        candidateTokens: Number,
        totalTokens: Number
    },
    attempts: {
        type: Number,
        default: 0,
        min: 0
    },
    processingStartedAt: Date,
    generatedAt: Date,
    reviewedAt: Date,
    reviewer: String,
    lastError: String,
    revisions: {
        type: [revisionSchema],
        default: []
    }
}, {
    timestamps: true
});

marketLabelSchema.index({ status: 1, createdAt: 1 });
marketLabelSchema.index({ 'input.sourceName': 1, status: 1 });
marketLabelSchema.index({ 'candidate.sentiment': 1, status: 1 });
marketLabelSchema.index({ 'model.schemaVersion': 1, status: 1, createdAt: 1 });
marketLabelSchema.index({ 'adjudication.status': 1, 'model.schemaVersion': 1 });
marketLabelSchema.index({ 'assistantReview.reviewedAt': 1, 'model.schemaVersion': 1 });

module.exports = mongoose.models.MarketLabel
    || mongoose.model('MarketLabel', marketLabelSchema);

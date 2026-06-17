const mongoose = require('mongoose');

const marketDocumentSchema = new mongoose.Schema({
    documentType: {
        type: String,
        required: true,
        enum: [
            'financial_news',
            'regulatory_notice',
            'policy_document',
            'archived_report'
        ],
        index: true
    },
    article: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Article',
        required: function requireArticleWhenTextIsMissing() {
            return !this.text?.original;
        }
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    language: {
        type: String,
        required: true,
        enum: ['en', 'ne', 'mixed']
    },
    source: {
        name: {
            type: String,
            required: true,
            trim: true
        },
        url: {
            type: String,
            required: true,
            trim: true
        },
        pageUrl: {
            type: String,
            trim: true
        },
        section: {
            type: String,
            trim: true
        },
        publishedAt: Date,
        retrievedAt: {
            type: Date,
            default: Date.now
        }
    },
    text: {
        original: {
            type: String,
            required: function requireTextWhenArticleIsMissing() {
                return !this.article;
            }
        },
        cleaned: String,
        extractionMethod: {
            type: String,
            enum: ['article_reference', 'html', 'pdf_text', 'generated_report']
        },
        contentHash: {
            type: String,
            trim: true,
            index: true
        }
    },
    ingestion: {
        status: {
            type: String,
            enum: ['pending', 'complete', 'partial', 'failed'],
            default: 'pending'
        },
        sourceId: String,
        error: String,
        run: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'MarketIngestionRun'
        }
    },
    metadata: {
        companies: {
            type: [String],
            default: []
        },
        sectors: {
            type: [String],
            default: []
        },
        tags: {
            type: [String],
            default: []
        }
    },
    sentiment: {
        label: {
            type: String,
            enum: ['bullish', 'bearish', 'neutral', 'unclassified'],
            default: 'unclassified'
        },
        confidence: {
            type: Number,
            min: 0,
            max: 1
        },
        rationale: String,
        model: String
    },
    qdrant: {
        collection: String,
        contentHash: String,
        pointIds: {
            type: [String],
            default: []
        },
        indexedAt: Date
    }
}, {
    timestamps: true
});

marketDocumentSchema.index({ 'source.url': 1 }, { unique: true });
marketDocumentSchema.index(
    { 'text.contentHash': 1, documentType: 1 },
    { sparse: true }
);
marketDocumentSchema.index({ documentType: 1, 'source.publishedAt': -1 });
marketDocumentSchema.index({ 'metadata.sectors': 1, 'source.publishedAt': -1 });

module.exports = mongoose.models.MarketDocument
    || mongoose.model('MarketDocument', marketDocumentSchema);

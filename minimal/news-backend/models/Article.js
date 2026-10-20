const mongoose = require('mongoose');

const ARTICLE_CATEGORIES = ['technology', 'business', 'sports', 'entertainment', 'health', 'science', 'general'];

const articleSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    content: String,
    // High-level topic tags used for filtering and Qdrant payload filters
    // e.g. finance, politics, art, culture, international, sports
    topics: {
        type: [String],
        default: []
    },
    category: {
        type: String,
        required: true,
        // "general" holds front-page stories that match no specific category.
        enum: ARTICLE_CATEGORIES
    },
    source: {
        type: String,
        required: true
    },
    author: String,
    url: {
        type: String,
        required: true,
        unique: true
    },
    urlToImage: String,
    summary: String,
    publishedAt: {
        type: Date,
        default: Date.now
    },
    fetchedAt: Date,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Create indexes for better performance
articleSchema.index({ category: 1, publishedAt: -1 });
articleSchema.index({ topics: 1, publishedAt: -1 });
// Feed pagination sorts on (publishedAt, _id); retention cleanup scans publishedAt.
articleSchema.index({ publishedAt: -1, _id: -1 });

module.exports = mongoose.model('Article', articleSchema);

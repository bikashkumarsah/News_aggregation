const mongoose = require('mongoose');

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
    category: {
        type: String,
        required: true,
        enum: ['technology', 'business', 'sports', 'entertainment', 'health', 'science']
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
articleSchema.index({ url: 1 });

module.exports = mongoose.model('Article', articleSchema);

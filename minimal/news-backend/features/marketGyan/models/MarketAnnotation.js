const mongoose = require('mongoose');
const MarketLabel = require('./MarketLabel');

const candidateSchema = MarketLabel.schema.path('candidate').schema;

const marketAnnotationSchema = new mongoose.Schema({
    label: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MarketLabel',
        required: true,
        index: true
    },
    reviewerId: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    reviewerRole: {
        type: String,
        enum: ['primary', 'secondary', 'adjudicator'],
        required: true
    },
    status: {
        type: String,
        enum: ['draft', 'submitted', 'rejected'],
        default: 'draft',
        index: true
    },
    annotation: candidateSchema,
    rejectionReason: String,
    submittedAt: Date
}, {
    timestamps: true
});

marketAnnotationSchema.index(
    { label: 1, reviewerId: 1 },
    { unique: true }
);
marketAnnotationSchema.index({ reviewerRole: 1, status: 1 });

module.exports = mongoose.models.MarketAnnotation
    || mongoose.model('MarketAnnotation', marketAnnotationSchema);

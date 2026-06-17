const mongoose = require('mongoose');

const marketSecuritySchema = new mongoose.Schema({
    symbol: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true,
        index: true
    },
    name: {
        type: String,
        trim: true
    },
    aliases: {
        type: [{
            value: {
                type: String,
                required: true,
                trim: true
            },
            language: {
                type: String,
                enum: ['en', 'ne', 'mixed', 'unknown'],
                default: 'unknown'
            },
            kind: {
                type: String,
                enum: ['company_name', 'short_name', 'former_name', 'transliteration'],
                default: 'short_name'
            },
            sources: {
                type: [String],
                default: []
            }
        }],
        default: []
    },
    sector: {
        type: String,
        trim: true
    },
    active: {
        type: Boolean,
        default: true,
        index: true
    },
    sources: {
        type: [String],
        default: []
    },
    lastSeenAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.models.MarketSecurity
    || mongoose.model('MarketSecurity', marketSecuritySchema);

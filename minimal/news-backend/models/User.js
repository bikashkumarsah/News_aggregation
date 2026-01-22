const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters'],
        select: false // Don't include password in queries by default
    },
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true,
        maxlength: [50, 'Name cannot exceed 50 characters']
    },
    bookmarks: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Article'
    }],
    readHistory: [{
        article: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Article'
        },
        readAt: {
            type: Date,
            default: Date.now
        }
    }],
    customFeeds: [{
        url: {
            type: String,
            required: true
        },
        name: {
            type: String,
            default: 'Custom Feed'
        },
        category: {
            type: String,
            default: 'technology'
        },
        addedAt: {
            type: Date,
            default: Date.now
        }
    }],
    emailPreferences: {
        dailyDigest: {
            type: Boolean,
            default: false
        },
        weeklyDigest: {
            type: Boolean,
            default: true
        },
        breakingNews: {
            type: Boolean,
            default: false
        },
        digestTime: {
            type: String,
            default: '07:00' // 7 AM default
        }
    },
    // AI-learned preferences based on reading history
    preferences: {
        // Category weights (0-100 score based on reading patterns)
        categoryScores: {
            technology: { type: Number, default: 0 },
            business: { type: Number, default: 0 },
            sports: { type: Number, default: 0 },
            entertainment: { type: Number, default: 0 },
            health: { type: Number, default: 0 },
            science: { type: Number, default: 0 }
        },
        // Preferred sources based on reading history
        preferredSources: [{
            source: String,
            score: { type: Number, default: 0 }
        }],
        // Keywords extracted from read articles
        topKeywords: [{
            keyword: String,
            count: { type: Number, default: 0 }
        }],
        // Last time preferences were updated
        lastUpdated: {
            type: Date,
            default: Date.now
        },
        // Total articles read (for normalization)
        totalArticlesRead: {
            type: Number,
            default: 0
        }
    },
    darkMode: {
        type: Boolean,
        default: false
    },
    lastNewsletterSent: {
        type: Date,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index for faster lookups
userSchema.index({ email: 1 });

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.password;
    return user;
};

module.exports = mongoose.model('User', userSchema);

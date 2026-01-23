const User = require('../models/User');
const Article = require('../models/Article');
const { isQdrantReachable, search: qdrantSearch } = require('./qdrantService');

/**
 * Preference Learning Service
 * Analyzes user reading history to build a personalized preference profile
 */

// Extract keywords from article title and description
const extractKeywords = (text) => {
    if (!text) return [];

    // Common stop words to filter out
    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
        'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
        'used', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
        'she', 'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where',
        'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
        'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
        'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'new',
        'says', 'said', 'about', 'after', 'before', 'between', 'into', 'through',
        'during', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
        'over', 'out', 'up', 'down', 'off', 'on', 'his', 'her', 'him', 'my', 'your'
    ]);

    // Extract words, filter, and clean
    const words = text
        .toLowerCase()
        .replace(/[^a-zA-Z\s]/g, '')
        .split(/\s+/)
        .filter(word => word.length > 3 && !stopWords.has(word));

    return words;
};

/**
 * Update user preferences based on their reading history
 * This should be called periodically (e.g., daily) or after significant reading activity
 */
const updateUserPreferences = async (userId) => {
    try {
        const user = await User.findById(userId).populate('readHistory.article');

        if (!user || !user.readHistory || user.readHistory.length === 0) {
            console.log(`No reading history for user ${userId}`);
            return null;
        }

        // Get articles read in the last 30 days for preference calculation
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const recentHistory = user.readHistory.filter(item =>
            item.article && item.readAt >= thirtyDaysAgo
        );

        if (recentHistory.length === 0) {
            console.log(`No recent reading history for user ${userId}`);
            return null;
        }

        // Calculate category scores
        const categoryCount = {
            technology: 0,
            business: 0,
            sports: 0,
            entertainment: 0,
            health: 0,
            science: 0
        };

        // Calculate source preferences
        const sourceCount = {};

        // Collect keywords
        const keywordCount = {};

        // Process each read article
        for (const item of recentHistory) {
            const article = item.article;
            if (!article) continue;

            // Count categories
            if (article.category && categoryCount.hasOwnProperty(article.category)) {
                categoryCount[article.category]++;
            }

            // Count sources
            if (article.source) {
                sourceCount[article.source] = (sourceCount[article.source] || 0) + 1;
            }

            // Extract and count keywords
            const titleKeywords = extractKeywords(article.title);
            const descKeywords = extractKeywords(article.description);
            const allKeywords = [...titleKeywords, ...descKeywords];

            for (const keyword of allKeywords) {
                keywordCount[keyword] = (keywordCount[keyword] || 0) + 1;
            }
        }

        // Normalize category scores to 0-100 scale
        const totalReads = recentHistory.length;
        const categoryScores = {};
        for (const [category, count] of Object.entries(categoryCount)) {
            categoryScores[category] = Math.round((count / totalReads) * 100);
        }

        // Get top sources (max 10)
        const preferredSources = Object.entries(sourceCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([source, count]) => ({
                source,
                score: Math.round((count / totalReads) * 100)
            }));

        // Get top keywords (max 20)
        const topKeywords = Object.entries(keywordCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([keyword, count]) => ({ keyword, count }));

        // Update user preferences
        user.preferences = {
            categoryScores,
            preferredSources,
            topKeywords,
            lastUpdated: new Date(),
            totalArticlesRead: totalReads
        };

        await user.save();

        console.log(`✅ Updated preferences for user ${user.email}:`, {
            topCategories: Object.entries(categoryScores)
                .filter(([_, score]) => score > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3),
            topSources: preferredSources.slice(0, 3).map(s => s.source)
        });

        return user.preferences;
    } catch (error) {
        console.error(`Error updating preferences for user ${userId}:`, error);
        throw error;
    }
};

/**
 * Get personalized article recommendations for a user
 */
const getRecommendations = async (userId, limit = 10) => {
    try {
        const user = await User.findById(userId);

        if (!user || !user.preferences) {
            // If no preferences, return recent trending articles
            return await Article.find()
                .sort({ publishedAt: -1 })
                .limit(limit);
        }

        const { categoryScores, preferredSources, topKeywords } = user.preferences;

        // Get top 3 categories by score
        const topCategories = Object.entries(categoryScores)
            .filter(([_, score]) => score > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([category]) => category);

        // Get preferred source names
        const sourceNames = preferredSources
            .slice(0, 5)
            .map(s => s.source);

        // Get top keywords for text search
        const keywords = topKeywords
            .slice(0, 10)
            .map(k => k.keyword);

        // Build query for recommended articles
        // Prioritize: matching categories, preferred sources, recent articles
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        // Get articles from preferred categories and sources
        let recommendations = await Article.find({
            $or: [
                { category: { $in: topCategories } },
                { source: { $in: sourceNames } }
            ],
            publishedAt: { $gte: oneDayAgo }
        })
            .sort({ publishedAt: -1 })
            .limit(limit * 2);

        // If not enough articles, get more recent ones
        if (recommendations.length < limit) {
            const additionalArticles = await Article.find({
                _id: { $nin: recommendations.map(a => a._id) },
                publishedAt: { $gte: oneDayAgo }
            })
                .sort({ publishedAt: -1 })
                .limit(limit - recommendations.length);

            recommendations = [...recommendations, ...additionalArticles];
        }

        // Score and sort recommendations based on user preferences
        const scoredRecommendations = recommendations.map(article => {
            let score = 0;

            // Category match bonus
            if (topCategories.includes(article.category)) {
                const categoryIndex = topCategories.indexOf(article.category);
                score += (3 - categoryIndex) * 30; // Top category gets 90, second 60, third 30
            }

            // Source match bonus
            if (sourceNames.includes(article.source)) {
                const sourceIndex = sourceNames.indexOf(article.source);
                score += (5 - sourceIndex) * 10; // Top source gets 50
            }

            // Keyword match bonus
            const articleText = `${article.title} ${article.description}`.toLowerCase();
            for (const keyword of keywords) {
                if (articleText.includes(keyword)) {
                    score += 5;
                }
            }

            // Recency bonus (newer articles score higher)
            const hoursAgo = (Date.now() - new Date(article.publishedAt).getTime()) / (1000 * 60 * 60);
            score += Math.max(0, 24 - hoursAgo); // Max 24 points for very recent

            return { article, score };
        });

        // Sort by score and return top articles
        return scoredRecommendations
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(item => item.article);

    } catch (error) {
        console.error(`Error getting recommendations for user ${userId}:`, error);
        throw error;
    }
};

/**
 * Semantic recommendations using Qdrant + multilingual embeddings.
 *
 * Approach:
 * - Build a "user interest query" from the user's recent reading history (titles/descriptions)
 * - Use Qdrant semantic search with filters (recency, top topics/categories)
 * - Exclude articles the user already read
 * - Light rerank with source/category/topic preference
 */
const getSemanticRecommendations = async (userId, limit = 10) => {
    const qdrantOk = await isQdrantReachable();
    if (!qdrantOk) return null;

    const user = await User.findById(userId).populate('readHistory.article');
    if (!user || !user.readHistory || user.readHistory.length === 0) return null;

    // Use last 30 days of reads (same window as updateUserPreferences)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentHistory = user.readHistory.filter(item =>
        item.article && item.readAt >= thirtyDaysAgo
    );
    if (recentHistory.length === 0) return null;

    // Build a single text prompt representing the user's interests.
    // We prioritize recency by repeating recent items slightly.
    const MAX_ITEMS = 25;
    const MAX_CHARS = 4000;
    let queryText = '';

    for (let i = 0; i < Math.min(MAX_ITEMS, recentHistory.length); i++) {
        const article = recentHistory[i].article;
        if (!article) continue;

        const snippet = `${article.title || ''}. ${article.description || ''}`.trim();
        if (!snippet) continue;

        // Recency weighting: first few items repeated more
        const repeat = i < 3 ? 3 : i < 8 ? 2 : 1;
        for (let r = 0; r < repeat; r++) {
            if ((queryText.length + snippet.length + 2) > MAX_CHARS) break;
            queryText += (queryText ? '\n' : '') + snippet;
        }
        if (queryText.length >= MAX_CHARS) break;
    }

    if (!queryText) return null;

    // Build filters from learned preferences (if present)
    const topCategories = user.preferences?.categoryScores
        ? Object.entries(user.preferences.categoryScores)
            .filter(([_, score]) => score > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([category]) => category)
        : [];

    // Count topics from reading history and take top ones (optional filter)
    const topicCount = {};
    for (const item of recentHistory.slice(0, 50)) {
        const art = item.article;
        const topics = Array.isArray(art?.topics) ? art.topics : [];
        for (const t of topics) {
            const key = String(t).toLowerCase();
            topicCount[key] = (topicCount[key] || 0) + 1;
        }
    }
    const topTopics = Object.entries(topicCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t);

    // Exclude already read articles (up to last 200)
    const excludeMongoIds = recentHistory
        .slice(0, 200)
        .map((i) => i.article?._id?.toString())
        .filter(Boolean);

    // Freshness: last 24 hours
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    // Get more candidates than we need, then rerank
    const candidateLimit = Math.min(Math.max(limit * 6, 20), 50);

    const qdrantResults = await qdrantSearch({
        query: queryText,
        topics: topTopics,
        category: topCategories.length ? topCategories : undefined,
        from: oneDayAgo.toISOString(),
        excludeMongoIds,
        limit: candidateLimit,
        offset: 0
    });

    const ranked = qdrantResults
        .map((r) => ({ mongoId: r?.payload?.mongoId, score: typeof r?.score === 'number' ? r.score : 0 }))
        .filter((r) => Boolean(r.mongoId));

    if (!ranked.length) return null;

    const ids = ranked.map((r) => r.mongoId);
    const docs = await Article.find({ _id: { $in: ids } });
    const byId = new Map(docs.map((d) => [d._id.toString(), d]));

    const preferredSources = (user.preferences?.preferredSources || []).slice(0, 8).map(s => s.source);
    const preferredSourceSet = new Set(preferredSources);
    const topCategorySet = new Set(topCategories);
    const topTopicSet = new Set(topTopics);

    const rerankScore = (doc, semanticScore) => {
        let bonus = 0;

        if (preferredSourceSet.has(doc.source)) bonus += 0.15;
        if (topCategorySet.has(doc.category)) bonus += 0.10;

        const docTopics = Array.isArray(doc.topics) ? doc.topics : [];
        const topicMatches = docTopics.filter(t => topTopicSet.has(String(t).toLowerCase())).length;
        bonus += Math.min(0.20, topicMatches * 0.10);

        // Recency bonus: prefer very recent articles
        const hoursAgo = (Date.now() - new Date(doc.publishedAt).getTime()) / (1000 * 60 * 60);
        bonus += Math.max(0, (24 - hoursAgo) / 24) * 0.05; // up to +0.05

        return (semanticScore || 0) + bonus;
    };

    // Preserve qdrant order initially, then rerank
    const candidates = ranked
        .map((r) => {
            const doc = byId.get(r.mongoId);
            if (!doc) return null;
            return { doc, score: rerankScore(doc, r.score) };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

    // Diversity: avoid too many from the same source
    const picked = [];
    const perSource = {};
    for (const c of candidates) {
        const src = c.doc.source || 'unknown';
        perSource[src] = perSource[src] || 0;
        if (perSource[src] >= 2) continue;
        picked.push(c.doc);
        perSource[src] += 1;
        if (picked.length >= limit) break;
    }

    return picked.length ? picked : null;
};

/**
 * Newsletter recommendations:
 * - Prefer semantic (Qdrant) recommendations if available
 * - Fallback to the existing keyword/category scoring logic
 */
const getNewsletterRecommendations = async (userId, limit = 5) => {
    try {
        const semantic = await getSemanticRecommendations(userId, limit);
        if (semantic && semantic.length) return semantic;
        return await getRecommendations(userId, limit);
    } catch (error) {
        // Never break newsletter sending because of search/index issues
        console.warn(`Newsletter semantic recommendations failed, falling back: ${error.message}`);
        return await getRecommendations(userId, limit);
    }
};

/**
 * Update preferences for all users (to be run daily)
 */
const updateAllUserPreferences = async () => {
    try {
        const users = await User.find({ 'emailPreferences.dailyDigest': true });

        console.log(`📊 Updating preferences for ${users.length} users...`);

        for (const user of users) {
            await updateUserPreferences(user._id);
        }

        console.log('✅ All user preferences updated');
        return users.length;
    } catch (error) {
        console.error('Error updating all user preferences:', error);
        throw error;
    }
};

module.exports = {
    updateUserPreferences,
    getRecommendations,
    getNewsletterRecommendations,
    getSemanticRecommendations,
    updateAllUserPreferences,
    extractKeywords
};

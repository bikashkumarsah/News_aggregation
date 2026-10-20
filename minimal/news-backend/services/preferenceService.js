const User = require('../models/User');
const Article = require('../models/Article');
const {
    isQdrantReachable,
    search: qdrantSearch,
    textToVector
} = require('./qdrantService');

/**
 * Preference Learning Service
 * Analyzes user reading history to build a personalized preference profile
 */

const CATEGORY_KEYS = ['technology', 'business', 'sports', 'entertainment', 'health', 'science'];
const DAY_MS = 24 * 60 * 60 * 1000;
const READ_FIELDS = 'title description category source topics';

const ENGLISH_STOP_WORDS = [
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
];

// Common Nepali function words, so Nepali readers get meaningful keywords.
const NEPALI_STOP_WORDS = [
    'भएको', 'गरेको', 'गर्ने', 'हुने', 'रहेको', 'भएका', 'गरेका', 'रहेका', 'अनुसार',
    'लागि', 'पनि', 'तथा', 'उनले', 'उनको', 'उनी', 'त्यो', 'यस्तो', 'गर्दै', 'भन्दा',
    'देखि', 'सम्म', 'बताए', 'बताएका', 'गरिएको', 'जानकारी', 'दिएका', 'भनेका',
    'हुन्छ', 'थियो', 'थिए', 'छन्', 'भयो', 'गर्न', 'तर्फ', 'बीच', 'साथै'
];

const STOP_WORDS = new Set([...ENGLISH_STOP_WORDS, ...NEPALI_STOP_WORDS]);

// Extract keywords from article title and description (English and Nepali)
const extractKeywords = (text) => {
    if (!text) return [];

    return String(text)
        .toLowerCase()
        // Keep letters and combining marks from any script (Devanagari vowel
        // signs are marks), drop digits and punctuation.
        .replace(/[^\p{L}\p{M}\s]/gu, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
};

const recentReads = (readHistory = [], days = 30, now = Date.now()) => {
    const since = now - (days * DAY_MS);
    return readHistory.filter((item) => item?.article && new Date(item.readAt).getTime() >= since);
};

const topCategoriesFrom = (categoryScores = {}) => Object.entries(categoryScores || {})
    .filter(([category, score]) => CATEGORY_KEYS.includes(category) && Number(score) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category]) => category);

const buildPreferences = (reads) => {
    const categoryCount = Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 0]));
    const sourceCount = {};
    const keywordCount = {};

    for (const { article } of reads) {
        if (Object.prototype.hasOwnProperty.call(categoryCount, article.category)) {
            categoryCount[article.category] += 1;
        }
        if (article.source) {
            sourceCount[article.source] = (sourceCount[article.source] || 0) + 1;
        }
        for (const keyword of [...extractKeywords(article.title), ...extractKeywords(article.description)]) {
            keywordCount[keyword] = (keywordCount[keyword] || 0) + 1;
        }
    }

    // Normalize category scores to 0-100 scale
    const totalReads = reads.length;
    const categoryScores = Object.fromEntries(
        Object.entries(categoryCount).map(([category, count]) => [
            category,
            Math.round((count / totalReads) * 100)
        ])
    );

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

    return {
        categoryScores,
        preferredSources,
        topKeywords,
        lastUpdated: new Date(),
        totalArticlesRead: totalReads
    };
};

/**
 * Update user preferences based on their reading history
 * This should be called periodically (e.g., daily) or after significant reading activity
 */
const updateUserPreferences = async (userId) => {
    try {
        const user = await User.findById(userId)
            .select('email readHistory')
            .populate({ path: 'readHistory.article', select: READ_FIELDS })
            .lean();

        if (!user || !user.readHistory || user.readHistory.length === 0) {
            console.log(`No reading history for user ${userId}`);
            return null;
        }

        // Get articles read in the last 30 days for preference calculation
        const reads = recentReads(user.readHistory, 30);
        if (reads.length === 0) {
            console.log(`No recent reading history for user ${userId}`);
            return null;
        }

        const preferences = buildPreferences(reads);
        await User.updateOne({ _id: user._id }, { $set: { preferences } });

        console.log(`✅ Updated preferences for user ${user.email}:`, {
            topCategories: Object.entries(preferences.categoryScores)
                .filter(([, score]) => score > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3),
            topSources: preferences.preferredSources.slice(0, 3).map((s) => s.source)
        });

        return preferences;
    } catch (error) {
        console.error(`Error updating preferences for user ${userId}:`, error);
        throw error;
    }
};

/**
 * Get personalized article recommendations for a user.
 *
 * Candidates come from the user's preferred categories/sources, newest first,
 * widening the time window (1 → 3 → 7 → 30 days) until there are enough, and
 * then topping up with the latest articles. Articles the user already read
 * are never recommended.
 */
const getRecommendations = async (userId, limit = 10, { now = Date.now() } = {}) => {
    try {
        const user = await User.findById(userId)
            .select('preferences readHistory.article')
            .lean();

        const readIds = (user?.readHistory || []).map((item) => item.article).filter(Boolean);
        const notRead = readIds.length ? { _id: { $nin: readIds } } : {};
        const preferences = user?.preferences || {};

        const topCategories = topCategoriesFrom(preferences.categoryScores);
        const sourceNames = (preferences.preferredSources || []).slice(0, 5).map((s) => s.source);
        const keywords = (preferences.topKeywords || []).slice(0, 10).map((k) => k.keyword);

        const preferenceFilter = [
            ...(topCategories.length ? [{ category: { $in: topCategories } }] : []),
            ...(sourceNames.length ? [{ source: { $in: sourceNames } }] : [])
        ];

        let candidates = [];
        if (preferenceFilter.length) {
            for (const days of [1, 3, 7, 30]) {
                candidates = await Article.find({
                    ...notRead,
                    $or: preferenceFilter,
                    publishedAt: { $gte: new Date(now - (days * DAY_MS)) }
                })
                    .sort({ publishedAt: -1, _id: -1 })
                    .limit(limit * 3)
                    .lean();
                if (candidates.length >= limit) break;
            }
        }

        if (candidates.length < limit) {
            const chosen = new Set(candidates.map((a) => a._id.toString()));
            const latest = await Article.find({
                _id: { $nin: [...readIds, ...candidates.map((a) => a._id)] }
            })
                .sort({ publishedAt: -1, _id: -1 })
                .limit(limit - candidates.length)
                .lean();
            candidates = [...candidates, ...latest.filter((a) => !chosen.has(a._id.toString()))];
        }

        // Score and sort recommendations based on user preferences
        const scored = candidates.map((article) => {
            let score = 0;

            // Category match bonus: top category gets 90, second 60, third 30
            const categoryIndex = topCategories.indexOf(article.category);
            if (categoryIndex >= 0) score += (3 - categoryIndex) * 30;

            // Source match bonus: top source gets 50
            const sourceIndex = sourceNames.indexOf(article.source);
            if (sourceIndex >= 0) score += (5 - sourceIndex) * 10;

            // Keyword match bonus
            const articleText = `${article.title} ${article.description}`.toLowerCase();
            for (const keyword of keywords) {
                if (articleText.includes(keyword)) score += 5;
            }

            // Recency bonus (newer articles score higher, max 24 points)
            const hoursAgo = (now - new Date(article.publishedAt).getTime()) / (1000 * 60 * 60);
            score += Math.max(0, 24 - hoursAgo);

            return { article, score };
        });

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((item) => item.article);
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
 * - Embed it once, then run Qdrant searches with filters (recency, top topics/categories)
 * - Exclude articles the user already read
 * - Light rerank with source/category/topic preference
 */
const getSemanticRecommendations = async (userId, limit = 10) => {
    const qdrantOk = await isQdrantReachable();
    if (!qdrantOk) return null;

    const user = await User.findById(userId)
        .select('preferences readHistory')
        .populate({ path: 'readHistory.article', select: READ_FIELDS })
        .lean();
    if (!user || !user.readHistory || user.readHistory.length === 0) return null;

    // Use last 30 days of reads (same window as updateUserPreferences)
    const recentHistory = recentReads(user.readHistory, 30);
    if (recentHistory.length === 0) return null;

    // Build a single text prompt representing the user's interests.
    // We prioritize recency by repeating recent items slightly.
    const MAX_ITEMS = 25;
    const MAX_CHARS = 4000;
    let queryText = '';

    for (let i = 0; i < Math.min(MAX_ITEMS, recentHistory.length); i++) {
        const article = recentHistory[i].article;
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

    // Embed the interest profile once; every filtered search below reuses it.
    const interestVector = await textToVector(queryText, { role: 'query' });

    // Build filters from learned preferences (if present)
    const topCategories = topCategoriesFrom(user.preferences?.categoryScores);

    // Count topics from reading history and take top ones (optional filter)
    const topicCount = {};
    for (const item of recentHistory.slice(0, 50)) {
        const topics = Array.isArray(item.article?.topics) ? item.article.topics : [];
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

    const candidateLimit = Math.min(Math.max(limit * 8, 30), 50);
    const runQdrant = async ({ fromDate, topics, category }) => {
        const res = await qdrantSearch({
            vector: interestVector,
            topics,
            category,
            from: fromDate ? fromDate.toISOString() : undefined,
            excludeMongoIds,
            limit: candidateLimit,
            offset: 0
        });
        return (res || [])
            .map((r) => ({ mongoId: r?.payload?.mongoId, score: typeof r?.score === 'number' ? r.score : 0 }))
            .filter((r) => Boolean(r.mongoId));
    };

    // Multi-stage retrieval:
    // 1) Prefer last 24h + strong filters
    // 2) If not enough, widen to 48h
    // 3) If still not enough, widen to 7d
    const seen = new Set();
    const ranked = [];
    const variants = [
        { topics: topTopics.length ? topTopics : undefined, category: topCategories.length ? topCategories : undefined },
        { topics: undefined, category: topCategories.length ? topCategories : undefined },
        { topics: topTopics.length ? topTopics : undefined, category: undefined },
        { topics: undefined, category: undefined }
    ];

    for (const days of [1, 2, 7]) {
        const fromDate = new Date(Date.now() - (days * DAY_MS));
        // The four filter variants for a window run concurrently and are then
        // merged in priority order, exactly as the sequential loop did.
        const batches = await Promise.all(variants.map((v) => runQdrant({ fromDate, ...v })));
        for (const batch of batches) {
            for (const r of batch) {
                if (seen.has(r.mongoId)) continue;
                seen.add(r.mongoId);
                ranked.push(r);
            }
            if (ranked.length >= Math.min(200, limit * 20)) break;
        }

        if (ranked.length >= Math.min(80, limit * 10)) break;
    }

    if (!ranked.length) return null;

    const docs = await Article.find({ _id: { $in: ranked.map((r) => r.mongoId) } }).lean();
    const byId = new Map(docs.map((d) => [d._id.toString(), d]));

    const preferredSourceSet = new Set(
        (user.preferences?.preferredSources || []).slice(0, 8).map((s) => s.source)
    );
    const topCategorySet = new Set(topCategories);
    const topTopicSet = new Set(topTopics);

    const rerankScore = (doc, semanticScore) => {
        let bonus = 0;

        if (preferredSourceSet.has(doc.source)) bonus += 0.15;
        if (topCategorySet.has(doc.category)) bonus += 0.10;

        const docTopics = Array.isArray(doc.topics) ? doc.topics : [];
        const topicMatches = docTopics.filter((t) => topTopicSet.has(String(t).toLowerCase())).length;
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

    // If semantic retrieval couldn't fill enough items, return null so caller can fall back.
    if (picked.length < limit) return null;
    return picked;
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
        const users = await User.find({ 'emailPreferences.dailyDigest': true }).select('_id').lean();

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
    buildPreferences,
    updateUserPreferences,
    getRecommendations,
    getNewsletterRecommendations,
    getSemanticRecommendations,
    updateAllUserPreferences,
    extractKeywords
};

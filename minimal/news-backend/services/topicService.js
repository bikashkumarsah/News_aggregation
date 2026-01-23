/**
 * Topic tagging for advanced filtering.
 *
 * Topics are intentionally broader than existing `category`:
 * - finance, sports, politics, art, culture, international
 *
 * This is a lightweight, local keyword-based tagger.
 * You can later upgrade to an embedding/LLM-based classifier without changing the API.
 */

/**
 * Topic rules are scored to reduce false-positives.
 * - strong match = 2 points (one strong match is often enough)
 * - weak match = 1 point (needs multiple weak matches)
 * - threshold = minimum score to tag the topic
 */
const TOPIC_RULES = {
    finance: {
        threshold: 2,
        strong: [
            'finance',
            'financial',
            'interest rate',
            'inflation',
            'deflation',
            'stock',
            'stocks',
            'ipo',
            'nasdaq',
            'dow',
            's&p',
            'bond',
            'bonds',
            'dividend',
            'earnings',
            'revenue',
            'profit',
            'bitcoin',
            'crypto',
            'cryptocurrency',
            'forex'
        ],
        weak: [
            'market',
            'markets',
            'economy',
            'economic',
            'budget',
            'tax',
            'tariff',
            'investment',
            'investor',
            'currency',
            'trade',
            'import',
            'export',
            'loan',
            'credit',
            // note: 'bank' is ambiguous; keep as weak only
            'bank',
            'banking'
        ]
    },
    sports: {
        threshold: 2,
        strong: [
            'sports',
            'match',
            'tournament',
            'league',
            'championship',
            'cricket',
            'football',
            'soccer',
            'basketball',
            'tennis',
            'olympics',
            'world cup'
        ],
        weak: [
            'game',
            'team',
            'player',
            'coach',
            'score',
            'goal'
        ]
    },
    politics: {
        threshold: 2,
        strong: [
            'politics',
            'election',
            'parliament',
            'congress',
            'senate',
            'prime minister',
            'president',
            'constitution',
            'supreme court'
        ],
        weak: [
            'government',
            'minister',
            'campaign',
            'vote',
            'voting',
            'bill',
            'policy',
            'law',
            'court',
            'diplomacy',
            'sanction',
            'sanctions'
        ]
    },
    art: {
        threshold: 2,
        strong: [
            'gallery',
            'exhibition',
            'museum',
            'painting',
            'sculpture',
            'photography',
            'cinema',
            'theatre',
            'theater',
            'literature',
            'poetry'
        ],
        weak: [
            'art',
            'artist',
            'design',
            'illustration',
            'film'
        ]
    },
    culture: {
        threshold: 2,
        strong: [
            'heritage',
            'festival',
            'tradition',
            'traditional',
            'dance',
            'language'
        ],
        weak: [
            'culture',
            'cultural',
            'community',
            'religion',
            'ritual',
            'celebration',
            'music'
        ]
    },
    international: {
        threshold: 2,
        strong: [
            'international',
            'united nations',
            'nato',
            'eu',
            'treaty',
            'summit',
            'ceasefire'
        ],
        weak: [
            'global',
            'world',
            'foreign',
            'overseas',
            'border',
            'war',
            'conflict',
            'sanctions'
        ]
    }
};

const normalizeText = (text) =>
    (text || '')
        .toString()
        .toLowerCase()
        // Keep basic latin letters/numbers and whitespace
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const matchesKeyword = (normalizedText, tokenSet, keyword) => {
    const kw = keyword.toLowerCase();
    // Multi-word phrase: substring match on normalized text
    if (kw.includes(' ')) return normalizedText.includes(kw);
    // Single token: exact token match (prevents false positives like "important" -> "import")
    return tokenSet.has(kw);
};

const scoreTopic = (normalizedText, tokenSet, rules) => {
    let score = 0;
    for (const kw of rules.strong || []) {
        if (matchesKeyword(normalizedText, tokenSet, kw)) score += 2;
    }
    for (const kw of rules.weak || []) {
        if (matchesKeyword(normalizedText, tokenSet, kw)) score += 1;
    }
    return score;
};

/**
 * Derive topics from an article object.
 * @param {{title?:string, description?:string, content?:string, category?:string}} article
 * @returns {string[]} list of topics
 */
const getTopicsForArticle = (article) => {
    const topics = new Set();

    // Category → topic hints (keep conservative to avoid false positives)
    if (article?.category === 'sports') topics.add('sports');
    if (article?.category === 'entertainment') {
        topics.add('culture');
        topics.add('art');
    }

    const text = normalizeText(
        `${article?.title || ''} ${article?.description || ''} ${article?.content || ''}`
    );

    if (!text) return Array.from(topics);

    const tokenSet = new Set(text.split(' ').filter(Boolean));

    for (const [topic, rules] of Object.entries(TOPIC_RULES)) {
        const score = scoreTopic(text, tokenSet, rules);
        if (score >= (rules.threshold || 2)) topics.add(topic);
    }

    return Array.from(topics);
};

module.exports = {
    getTopicsForArticle
};


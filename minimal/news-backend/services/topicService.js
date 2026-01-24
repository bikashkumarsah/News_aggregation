/**
 * Topic tagging for advanced filtering.
 *
 * Topics are intentionally broader than existing `category`:
 * - finance, sports, politics, art, culture, international
 *
 * This module supports:
 * - keyword-based tagging (fast, high precision)
 * - optional semantic tagging (embedding-based) for better multilingual coverage
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
            'forex',
            // Nepali / Devanagari (strong signals)
            'अर्थतन्त्र',
            'मुद्रास्फीति',
            'ब्याजदर',
            'सेयर',
            'शेयर',
            'नेप्से',
            'पुँजीबजार',
            'पूँजीबजार'
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
            'banking',
            // Nepali / Devanagari (weaker / more ambiguous)
            'बजार',
            'बजेट',
            'कर',
            'लगानी',
            'ऋण',
            'कर्जा',
            'कर्ज',
            'मुद्रा',
            'राजस्व',
            'नाफा',
            'घाटा',
            'व्यापार',
            'आयात',
            'निर्यात',
            'बैंक'
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
            'world cup',
            // Nepali / Devanagari
            'खेल',
            'खेलकुद',
            'क्रिकेट',
            'फुटबल',
            'विश्वकप',
            'टी २०',
            'टी20',
            't20'
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
            'supreme court',
            // Nepali / Devanagari
            'राजनीति',
            'निर्वाचन',
            'चुनाव',
            'संसद',
            'प्रधानमन्त्री',
            'राष्ट्रपति',
            'संविधान',
            'सर्वोच्च अदालत'
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
            'sanctions',
            // Nepali / Devanagari
            'सरकार',
            'मन्त्री',
            'कानुन',
            'नीति',
            'अदालत',
            'मतदान',
            'मत',
            'सदन',
            'क्याबिनेट',
            'क्याबिनेट'
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
            'poetry',
            // Nepali / Devanagari
            'कला',
            'कलाकार',
            'चित्रकला',
            'चित्र',
            'मूर्ति',
            'प्रदर्शनी',
            'संग्रहालय',
            'ग्यालरी',
            'ग्यालेरी',
            'नाटक',
            'सिनेमा',
            'साहित्य',
            'कविता'
        ],
        weak: [
            'art',
            'artist',
            'design',
            'illustration',
            'film',
            // Nepali / Devanagari (weaker)
            'डिजाइन',
            'फिल्म'
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
            'language',
            // Nepali / Devanagari
            'संस्कृति',
            'सांस्कृतिक',
            'सम्पदा',
            'धरोहर',
            'पर्व',
            'चाड',
            'उत्सव',
            'जात्रा',
            'परम्परा',
            'नाच',
            'भाषा'
        ],
        weak: [
            'culture',
            'cultural',
            'community',
            'religion',
            'ritual',
            'celebration',
            'music',
            // Nepali / Devanagari
            'समुदाय',
            'धर्म',
            'अनुष्ठान',
            'उत्सव',
            'संगीत'
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
            'ceasefire',
            // Nepali / Devanagari
            'अन्तर्राष्ट्रिय',
            'संयुक्त राष्ट्र',
            'नाटो',
            'युरोपियन संघ',
            'सन्धि',
            'शिखर सम्मेलन',
            'युद्धविराम'
        ],
        weak: [
            'global',
            'world',
            'foreign',
            'overseas',
            'border',
            'war',
            'conflict',
            'sanctions',
            // Nepali / Devanagari
            'वैश्विक',
            'विश्व',
            'विदेश',
            'वैदेशिक',
            'सीमा',
            'युद्ध',
            'संघर्ष',
            'प्रतिबन्ध'
        ]
    }
};

const TOPIC_ORDER = ['finance', 'sports', 'politics', 'art', 'culture', 'international'];

const normalizeText = (text) =>
    (text || '')
        .toString()
        .toLowerCase()
        // Keep letters/marks/numbers from any script + whitespace (supports Nepali/Devanagari)
        // Devanagari vowel signs are Unicode "Marks" (\p{M}) and must be preserved.
        .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
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

// ───────────────────────────────────────────────────────────────
// Semantic topic tagging (optional, uses the embedding model)
// ───────────────────────────────────────────────────────────────

// Compact, multilingual prototypes per topic. These are intentionally redundant.
const TOPIC_SEMANTIC_PROTOTYPES = {
    finance: {
        threshold: 0.32,
        phrases: [
            'finance economy stock market shares trading inflation interest rate bank loan budget tax',
            'अर्थतन्त्र वित्त शेयर बजार नेप्से लगानी ब्याजदर मुद्रास्फीति बैंक ऋण बजेट कर'
        ]
    },
    sports: {
        threshold: 0.30,
        phrases: [
            'sports match tournament league championship cricket football soccer basketball tennis world cup',
            'खेल खेलकुद म्याच प्रतियोगिता लिग क्रिकेट फुटबल विश्वकप टी२० टि२०'
        ]
    },
    politics: {
        threshold: 0.30,
        phrases: [
            'politics election government parliament prime minister president party cabinet court constitution policy law',
            'राजनीति चुनाव सरकार संसद प्रधानमन्त्री राष्ट्रपति पार्टी मन्त्री क्याबिनेट अदालत संविधान नीति कानुन'
        ]
    },
    art: {
        threshold: 0.30,
        phrases: [
            'art artist painting sculpture exhibition gallery museum literature poetry theatre cinema film',
            'कला कलाकार चित्रकला मूर्तिकला प्रदर्शनी ग्यालरी संग्रहालय साहित्य कविता नाटक सिनेमा फिल्म'
        ]
    },
    culture: {
        threshold: 0.30,
        phrases: [
            'culture festival tradition heritage community religion ritual celebration music dance language',
            'संस्कृति पर्व चाड उत्सव जात्रा परम्परा सम्पदा धरोहर समुदाय धर्म अनुष्ठान संगीत नाच भाषा'
        ]
    },
    international: {
        threshold: 0.29,
        phrases: [
            'international world global foreign diplomacy summit treaty united nations war conflict sanctions border',
            'अन्तर्राष्ट्रिय विश्व वैश्विक विदेश वैदेशिक कूटनीति शिखर सम्मेलन सन्धि संयुक्त राष्ट्र युद्ध संघर्ष प्रतिबन्ध सीमा'
        ]
    }
};

const getEnvFloat = (key, fallback) => {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const v = Number(raw);
    return Number.isFinite(v) ? v : fallback;
};

const getEnvInt = (key, fallback) => {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const v = parseInt(raw, 10);
    return Number.isFinite(v) ? v : fallback;
};

const l2Normalize = (vec) => {
    if (!Array.isArray(vec) || vec.length === 0) return vec;
    let sumSq = 0;
    for (const v of vec) sumSq += (v || 0) * (v || 0);
    const norm = Math.sqrt(sumSq);
    if (!norm) return vec;
    return vec.map((v) => (v || 0) / norm);
};

const dot = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    const n = Math.min(a.length, b.length);
    let s = 0;
    for (let i = 0; i < n; i++) s += (a[i] || 0) * (b[i] || 0);
    return s;
};

const meanVector = (vectors) => {
    const vecs = (vectors || []).filter((v) => Array.isArray(v) && v.length > 0);
    if (!vecs.length) return [];
    const dim = vecs[0].length;
    const sum = new Array(dim).fill(0);
    for (const v of vecs) {
        if (v.length !== dim) continue;
        for (let i = 0; i < dim; i++) sum[i] += v[i] || 0;
    }
    for (let i = 0; i < dim; i++) sum[i] /= vecs.length;
    return l2Normalize(sum);
};

let centroidCachePromise = null;

const getTopicCentroids = async () => {
    if (centroidCachePromise) return centroidCachePromise;

    centroidCachePromise = (async () => {
        const { embedText } = require('./embeddingService');
        const centroids = {};

        for (const [topic, cfg] of Object.entries(TOPIC_SEMANTIC_PROTOTYPES)) {
            const phraseVecs = [];
            for (const p of cfg.phrases || []) {
                // Use passage role (E5 auto-prefixing is handled in embeddingService)
                phraseVecs.push(await embedText(p, { role: 'passage' }));
            }
            centroids[topic] = meanVector(phraseVecs);
        }

        return centroids;
    })();

    return centroidCachePromise;
};

const getSemanticTopicsForVector = async (vector, opts = {}) => {
    const maxTopics = Math.min(Math.max(getEnvInt('TOPIC_SEMANTIC_MAX_TOPICS', 3), 1), 6);
    const globalThreshold = getEnvFloat('TOPIC_SEMANTIC_THRESHOLD', undefined);

    const centroids = await getTopicCentroids();
    const scores = [];

    for (const [topic, cfg] of Object.entries(TOPIC_SEMANTIC_PROTOTYPES)) {
        const c = centroids[topic];
        if (!Array.isArray(c) || !c.length) continue;
        if (!Array.isArray(vector) || vector.length !== c.length) continue;

        const sim = dot(vector, c); // vectors are expected to be L2-normalized
        const threshold = typeof globalThreshold === 'number' ? globalThreshold : (cfg.threshold || 0.3);
        if (sim >= threshold) scores.push({ topic, sim });
    }

    scores.sort((a, b) => b.sim - a.sim);
    const picked = scores.slice(0, maxTopics).map((s) => s.topic);

    if (opts.debug) {
        const top = scores.slice(0, 6).map((s) => `${s.topic}:${s.sim.toFixed(3)}`).join(', ');
        console.log(`[topicService] semantic scores: ${top}`);
    }

    return picked;
};

const getSemanticTopicsForArticle = async (article, opts = {}) => {
    // Prefer a precomputed embedding vector if provided (saves a second embedding pass during Qdrant indexing).
    if (opts.vector) return await getSemanticTopicsForVector(opts.vector, opts);

    const title = article?.title || '';
    const desc = article?.description || '';
    const content = article?.content || '';

    // Keep it short-ish to avoid huge tokenization cost; title/desc are usually enough for topic intent.
    const text = `${title}\n${desc}\n${content}`.slice(0, 4000);
    if (!text.trim()) return [];

    const { embedText } = require('./embeddingService');
    const vec = await embedText(text, { role: 'passage' });
    return await getSemanticTopicsForVector(vec, opts);
};

/**
 * Enhanced topic tagging (keyword + optional semantic).
 *
 * Env:
 * - TOPIC_CLASSIFICATION_MODE=keyword|hybrid|semantic (default: hybrid)
 * - TOPIC_SEMANTIC_THRESHOLD (optional float)
 * - TOPIC_SEMANTIC_MAX_TOPICS (default: 3)
 */
const getTopicsForArticleEnhanced = async (article, opts = {}) => {
    const mode = (process.env.TOPIC_CLASSIFICATION_MODE || 'hybrid').toString().toLowerCase();
    const keywordTopics = getTopicsForArticle(article);

    if (mode === 'keyword') {
        return TOPIC_ORDER.filter((t) => keywordTopics.includes(t));
    }

    // Category → topic hints (kept even in semantic mode)
    const categoryHintTopics = new Set();
    if (article?.category === 'sports') categoryHintTopics.add('sports');
    if (article?.category === 'entertainment') {
        categoryHintTopics.add('culture');
        categoryHintTopics.add('art');
    }

    const preview = `${article?.title || ''} ${article?.description || ''}`;
    const hasDevanagari = /[\u0900-\u097F]/.test(preview);

    const isOnlyCategoryHint =
        (article?.category === 'sports' && keywordTopics.length === 1 && keywordTopics.includes('sports')) ||
        (article?.category === 'entertainment' &&
            keywordTopics.length === 2 &&
            keywordTopics.includes('culture') &&
            keywordTopics.includes('art'));

    if (mode === 'semantic') {
        try {
            const semanticTopics = await getSemanticTopicsForArticle(article, opts);
            const merged = new Set([...categoryHintTopics, ...semanticTopics]);
            return TOPIC_ORDER.filter((t) => merged.has(t));
        } catch (err) {
            return TOPIC_ORDER.filter((t) => keywordTopics.includes(t));
        }
    }

    // Heuristic: only pay the embedding cost when keywords are missing/weak or when Nepali text is present.
    const shouldRunSemantic =
        keywordTopics.length === 0 ||
        (hasDevanagari && !isOnlyCategoryHint && keywordTopics.length <= 1);

    if (!shouldRunSemantic) {
        return TOPIC_ORDER.filter((t) => keywordTopics.includes(t));
    }

    try {
        const semanticTopics = await getSemanticTopicsForArticle(article, opts);
        const merged = new Set([...keywordTopics, ...semanticTopics]);
        return TOPIC_ORDER.filter((t) => merged.has(t));
    } catch (err) {
        // If embeddings aren't available, fall back to keywords (never break ingestion/search).
        return TOPIC_ORDER.filter((t) => keywordTopics.includes(t));
    }
};

module.exports = {
    getTopicsForArticle,
    getTopicsForArticleEnhanced
};


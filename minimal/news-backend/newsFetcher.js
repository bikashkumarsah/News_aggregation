const Parser = require('rss-parser');
const cheerio = require('cheerio');
const fetch = require('node-fetch');

const FEED_TIMEOUT_MS = 15000;
const FEED_MAX_BYTES = 10 * 1024 * 1024;
// An honest feed-reader agent: some publishers (e.g. ESPN) serve a bot challenge
// instead of RSS to browser-like agents that do not run JavaScript.
const FEED_USER_AGENT = 'KhabarAI/3.2 (RSS reader)';

const parser = new Parser({
  customFields: {
    item: ['media:content', 'media:thumbnail', 'enclosure', 'content:encoded']
  }
});

// RSS Feed Sources - USA and Nepal (English & Nepali)
// Verified October 2026. Kathmandu Post section feeds and several OnlineKhabar
// category feeds now return HTML, so Nepal coverage comes from the working
// category feeds plus the front-page feeds classified by content.
const RSS_FEEDS = {
  technology: [
    // USA Sources
    'https://techcrunch.com/feed/',
    'https://www.theverge.com/rss/index.xml',
    'https://www.wired.com/feed/rss'
  ],
  business: [
    // USA Sources
    'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147',
    'https://www.marketwatch.com/rss/topstories',
    // Nepal Sources
    'https://www.onlinekhabar.com/content/business/feed'
  ],
  sports: [
    // USA Sources
    'https://www.espn.com/espn/rss/news',
    'https://sports.yahoo.com/rss/',
    'https://www.cbssports.com/rss/headlines/',
    // Nepal Sources
    'https://english.onlinekhabar.com/category/sports/feed'
  ],
  entertainment: [
    // USA Sources
    'https://variety.com/feed/',
    'https://www.hollywoodreporter.com/feed/',
    'https://deadline.com/feed/',
    // Nepal Sources
    'https://english.onlinekhabar.com/category/entertainment/feed',
    'https://www.onlinekhabar.com/content/entertainment/feed'
  ],
  health: [
    // International Sources
    'https://www.sciencedaily.com/rss/health_medicine.xml',
    'https://www.who.int/rss-feeds/news-english.xml',
    // Nepal Sources
    'https://english.onlinekhabar.com/category/health/feed'
  ],
  science: [
    // USA Sources
    'https://www.sciencedaily.com/rss/all.xml',
    'https://www.nasa.gov/rss/dyn/breaking_news.rss',
    'https://www.sciencenews.org/feed'
  ],
  // Front-page feeds that mix every subject. Their items are classified by
  // content only, and fall back to "general" when nothing matches.
  general: [
    'https://english.onlinekhabar.com/feed',
    'https://kathmandupost.com/rss',
    'https://www.onlinekhabar.com/feed',
    'https://ratopati.com/feed',
    'https://www.setopati.com/feed',
    'https://thehimalayantimes.com/rssFeed/15'
  ]
};

// Keywords for category classification
const CATEGORY_KEYWORDS = {
  technology: [
    'ai', 'artificial intelligence', 'machine learning', 'tech', 'software',
    'hardware', 'computer', 'smartphone', 'app', 'digital', 'cyber',
    'innovation', 'startup', 'coding', 'programming', 'internet', 'cloud',
    'data', 'algorithm', 'robot', 'automation', 'blockchain', 'crypto',
    'प्रविधि', 'कम्प्युटर', 'इन्टरनेट', 'सफ्टवेयर'
  ],
  business: [
    'business', 'economy', 'market', 'stock', 'finance', 'investment',
    'company', 'corporate', 'trade', 'profit', 'revenue', 'sales',
    'startup', 'entrepreneur', 'ceo', 'merger', 'acquisition', 'ipo',
    'व्यवसाय', 'अर्थतन्त्र', 'बजार', 'व्यापार', 'कम्पनी'
  ],
  sports: [
    'sports', 'game', 'match', 'player', 'team', 'championship', 'league',
    'football', 'basketball', 'soccer', 'baseball', 'tennis', 'cricket',
    'olympic', 'tournament', 'coach', 'athlete', 'score', 'win',
    'खेलकुद', 'क्रिकेट', 'फुटबल', 'खेल'
  ],
  entertainment: [
    'movie', 'film', 'actor', 'actress', 'celebrity', 'music', 'concert',
    'album', 'song', 'artist', 'hollywood', 'netflix', 'streaming',
    'television', 'tv show', 'series', 'entertainment', 'award', 'grammy',
    'मनोरञ्जन', 'चलचित्र', 'संगीत', 'कलाकार'
  ],
  health: [
    'health', 'medical', 'disease', 'doctor', 'hospital', 'patient',
    'treatment', 'medicine', 'vaccine', 'virus', 'wellness', 'fitness',
    'nutrition', 'diet', 'mental health', 'therapy', 'drug', 'clinical',
    'स्वास्थ्य', 'अस्पताल', 'औषधि', 'रोग'
  ],
  science: [
    'science', 'research', 'study', 'scientist', 'discovery', 'experiment',
    'space', 'nasa', 'physics', 'chemistry', 'biology', 'astronomy',
    'climate', 'environment', 'fossil', 'species', 'gene', 'dna',
    'विज्ञान', 'अनुसन्धान', 'अध्ययन'
  ]
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}_]';

// `\b` only understands ASCII word characters, so it never matched Devanagari
// keywords. Use Unicode-aware boundaries instead. Nepali attaches
// postpositions to words (बजार → बजारमा), so Devanagari keywords match as word
// prefixes while Latin keywords must match whole words.
const keywordPattern = (keyword) => {
  const devanagari = /[\u0900-\u097F]/.test(keyword);
  const body = escapeRegex(keyword.toLowerCase());
  return new RegExp(
    `(?<!${WORD_CHAR})${body}${devanagari ? '' : `(?!${WORD_CHAR})`}`,
    'gu'
  );
};

// Compiled once instead of once per article.
const CATEGORY_PATTERNS = Object.fromEntries(
  Object.entries(CATEGORY_KEYWORDS).map(([category, keywords]) => [
    category,
    keywords.map(keywordPattern)
  ])
);

const FALLBACK_CATEGORY = 'general';

// Classify article into category based on content. A category-specific
// feed's category acts as a tie-breaking prior and as the default.
function classifyArticle(title, description, contentSnippet, suggestedCategory) {
  const text = `${title || ''} ${description || ''} ${contentSnippet || ''}`.toLowerCase();
  const prior = CATEGORY_PATTERNS[suggestedCategory] ? suggestedCategory : null;

  let bestCategory = prior || FALLBACK_CATEGORY;
  let maxScore = 0;

  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    let score = category === prior ? 1 : 0;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      const matches = text.match(pattern);
      if (matches) score += matches.length;
    }
    if (score > maxScore) {
      maxScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

// Convert feed HTML to plain text, decoding entities such as &amp; and &#8217;.
const htmlToText = (html) => {
  const raw = String(html || '');
  if (!raw.includes('<') && !raw.includes('&')) return raw.replace(/\s+/g, ' ').trim();
  return cheerio.load(raw).text().replace(/\s+/g, ' ').trim();
};

// Extract image from RSS item or content
function extractImage(item, content) {
  // 1. Try different image fields in RSS item
  if (item.enclosure && item.enclosure.url && item.enclosure.type && item.enclosure.type.startsWith('image')) {
    return item.enclosure.url;
  }
  if (item['media:content'] && item['media:content'].$ && item['media:content'].$.url) {
    return item['media:content'].$.url;
  }
  if (item['media:thumbnail'] && item['media:thumbnail'].$ && item['media:thumbnail'].$.url) {
    return item['media:thumbnail'].$.url;
  }

  // 2. Try to find image in content/description using Regex
  const imgRegex = /<img[^>]+src="([^">]+)"/i;

  for (const candidate of [content, item.contentSnippet, item.description]) {
    const match = candidate ? String(candidate).match(imgRegex) : null;
    if (match && match[1]) return match[1];
  }

  return null;
}

const isHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

// Feeds occasionally publish invalid or future dates; never let an item claim
// to be newer than the moment it was fetched.
const parsePublishedAt = (item, now = new Date()) => {
  for (const value of [item.isoDate, item.pubDate]) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date > now ? now : date;
  }
  return now;
};

// Turn one RSS item into an Article document (without topics).
function buildArticleFromItem(item, { feedTitle, suggestedCategory, now = new Date() } = {}) {
  // Skip items without title or link
  const link = String(item.link || '').trim();
  const title = String(item.title || '').trim();
  if (!title || !isHttpUrl(link)) return null;

  // Get full content - try multiple fields for maximum content
  const content = item['content:encoded'] || item.content || item.description || item.contentSnippet || '';
  const cleanContent = htmlToText(content);

  // Only include articles with substantial content
  if (cleanContent.length < 50) return null;

  // The description is required by the Article schema; fall back to the body.
  const cleanDescription = htmlToText(item.contentSnippet || item.description || '') || cleanContent;

  return {
    title,
    description: cleanDescription.substring(0, 500), // Limit description
    content: cleanContent.substring(0, 5000), // Store more content (5000 chars)
    category: classifyArticle(title, cleanDescription, cleanContent, suggestedCategory),
    source: feedTitle || 'Unknown Source',
    author: item.creator || item.author || null,
    url: link,
    urlToImage: extractImage(item, content),
    publishedAt: parsePublishedAt(item, now),
    fetchedAt: now
  };
}

const fetchFeedXml = async (feedUrl, { fetchImpl = fetch } = {}) => {
  const response = await fetchImpl(feedUrl, {
    headers: {
      'User-Agent': FEED_USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5'
    },
    timeout: FEED_TIMEOUT_MS,
    size: FEED_MAX_BYTES
  });
  if (!response.ok) throw new Error(`Status code ${response.status}`);
  return response.text();
};

// Escape "&" that does not start an entity, the most common XML defect in news feeds.
const escapeBareAmpersands = (xml) => String(xml).replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

const parseFeedXml = async (xml) => {
  try {
    return await parser.parseString(xml);
  } catch (error) {
    // Retry once with bare ampersands escaped; valid feeds never take this path.
    return parser.parseString(escapeBareAmpersands(xml));
  }
};

// Fetch news from a single RSS feed
async function fetchFeedNews(feedUrl, suggestedCategory, { logger = console, fetchImpl = fetch } = {}) {
  try {
    const feed = await parseFeedXml(await fetchFeedXml(feedUrl, { fetchImpl }));
    const now = new Date();
    const articles = (feed.items || [])
      .map((item) => buildArticleFromItem(item, { feedTitle: feed.title, suggestedCategory, now }))
      .filter(Boolean);

    logger.log(`✅ Fetched ${articles.length} articles from ${feed.title || feedUrl}`);
    return articles;
  } catch (error) {
    logger.error(`❌ Error fetching ${feedUrl}: ${error.message}`);
    return [];
  }
}

// Fetch news from all RSS feeds, a few feeds at a time.
async function fetchAllNews({ concurrency = 4, logger = console } = {}) {
  logger.log('🔄 Starting to fetch news from all RSS feeds...\n');

  const jobs = Object.entries(RSS_FEEDS).flatMap(([category, feeds]) => (
    feeds.map((feedUrl) => ({ feedUrl, category }))
  ));
  const results = new Array(jobs.length);
  let next = 0;

  const worker = async () => {
    while (next < jobs.length) {
      const index = next;
      next += 1;
      const { feedUrl, category } = jobs[index];
      results[index] = await fetchFeedNews(feedUrl, category, { logger });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));

  const allArticles = results.flat();
  logger.log(`\n✅ Total articles fetched: ${allArticles.length}`);
  return allArticles;
}

// Remove duplicate articles based on URL
function removeDuplicates(articles, { logger = console } = {}) {
  const seen = new Set();
  const unique = [];

  for (const article of articles) {
    if (!seen.has(article.url)) {
      seen.add(article.url);
      unique.push(article);
    }
  }

  logger.log(`🗑️  Removed ${articles.length - unique.length} duplicate articles`);
  return unique;
}

module.exports = {
  CATEGORY_KEYWORDS,
  RSS_FEEDS,
  buildArticleFromItem,
  classifyArticle,
  escapeBareAmpersands,
  fetchAllNews,
  fetchFeedNews,
  parseFeedXml,
  htmlToText,
  parsePublishedAt,
  removeDuplicates
};

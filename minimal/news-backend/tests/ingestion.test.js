const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RSS_FEEDS,
  buildArticleFromItem,
  classifyArticle,
  escapeBareAmpersands,
  fetchFeedNews,
  htmlToText,
  parseFeedXml,
  parsePublishedAt
} = require('../newsFetcher');
const { LOCAL_SOURCE_PATTERN } = require('../routes/newsRoutes');
const { isLikelyNepali, isNepaliSourceUrl } = require('../services/languageService');
const { buildPreferences, extractKeywords } = require('../services/preferenceService');
const Article = require('../models/Article');

test('Nepali keywords classify Devanagari articles, including inflected words', () => {
  assert.equal(classifyArticle('क्रिकेट टोलीको खेलमा जित', '', ''), 'sports');
  assert.equal(classifyArticle('सेयर बजारमा कारोबार बढ्यो', 'कम्पनीले नाफा', ''), 'business');
  assert.equal(classifyArticle('अस्पतालमा बिरामीको उपचार', 'स्वास्थ्य मन्त्रालय', ''), 'health');
});

test('English keywords still require whole words', () => {
  assert.equal(classifyArticle('Lakers win the championship game', '', ''), 'sports');
  // "application" must not match the technology keyword "app".
  assert.equal(classifyArticle('The application deadline is near', '', '', undefined), 'general');
  assert.equal(classifyArticle('A new app for commuters', '', '', undefined), 'technology');
});

test('feed category is a prior; general feeds fall back to "general"', () => {
  assert.equal(classifyArticle('Weekend preview', '', '', 'sports'), 'sports');
  assert.equal(classifyArticle('प्रधानमन्त्रीको भाषण', '', '', 'general'), 'general');
  assert.equal(classifyArticle('New smartphone app launched', '', '', 'general'), 'technology');
  assert.ok(Article.schema.path('category').enumValues.includes('general'));
});

test('RSS items become valid articles', () => {
  const now = new Date('2026-10-15T00:00:00.000Z');
  const article = buildArticleFromItem({
    title: '  Rates &amp; markets  ',
    link: ' https://example.com/story ',
    'content:encoded': '<p>Markets rallied &amp; bonds fell as investors weighed the central bank&#8217;s decision on interest rates.</p>',
    pubDate: '2030-01-01T00:00:00.000Z'
  }, { feedTitle: 'Example', suggestedCategory: 'business', now });

  assert.equal(article.url, 'https://example.com/story');
  assert.equal(article.source, 'Example');
  assert.match(article.content, /Markets rallied & bonds fell as investors weighed the central bank’s decision/);
  assert.equal(article.description, article.content, 'missing descriptions fall back to the body');
  assert.equal(article.publishedAt.toISOString(), now.toISOString(), 'future dates are clamped');
  assert.equal(new Article({ ...article, topics: [] }).validateSync(), undefined);

  assert.equal(buildArticleFromItem({ title: 'x', link: 'javascript:alert(1)', content: 'y'.repeat(80) }), null);
  assert.equal(buildArticleFromItem({ title: 'x', link: 'https://example.com', content: 'too short' }), null);
});

const feedXml = (title) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test Feed</title>
<item><title>${title}</title><link>https://example.com/a?x=1&amp;y=2</link>
<description>Monetary policy review keeps the interest rate unchanged for the quarter ahead.</description>
<pubDate>Wed, 14 Oct 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

test('feeds with unescaped ampersands are repaired instead of dropped', async () => {
  assert.equal(escapeBareAmpersands('A & B &amp; C &#38; D'), 'A &amp; B &amp; C &#38; D');
  const feed = await parseFeedXml(feedXml('Banks & Financial Institutions'));
  assert.equal(feed.items[0].title, 'Banks & Financial Institutions');
  assert.equal(feed.items[0].link, 'https://example.com/a?x=1&y=2');
});

test('feed fetching identifies as a feed reader and rejects HTTP errors', async () => {
  let headers;
  const articles = await fetchFeedNews('https://example.com/rss', 'business', {
    logger: { log: () => {}, error: () => {} },
    fetchImpl: async (url, options) => {
      headers = options.headers;
      return { ok: true, status: 200, text: async () => feedXml('Rates hold steady') };
    }
  });
  assert.match(headers['User-Agent'], /KhabarAI/);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].source, 'Test Feed');

  const failed = await fetchFeedNews('https://example.com/rss', 'business', {
    logger: { log: () => {}, error: () => {} },
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' })
  });
  assert.deepEqual(failed, []);
  assert.ok(Object.values(RSS_FEEDS).flat().every((url) => url.startsWith('https://')));
});

test('feed helpers decode HTML and validate dates', () => {
  assert.equal(htmlToText('<p>A &amp; B</p>'), 'A & B');
  assert.equal(htmlToText('plain   text'), 'plain text');
  const now = new Date('2026-10-15T00:00:00.000Z');
  assert.equal(parsePublishedAt({ pubDate: 'not a date' }, now), now);
  assert.equal(parsePublishedAt({ isoDate: '2026-10-14T10:00:00.000Z' }, now).toISOString(), '2026-10-14T10:00:00.000Z');
});

test('local-news and language detection use hostnames, not substrings', () => {
  assert.equal(LOCAL_SOURCE_PATTERN.test('https://ekantipur.com.np/news/1'), true);
  assert.equal(LOCAL_SOURCE_PATTERN.test('https://kathmandupost.com/money/x'), true);
  assert.equal(LOCAL_SOURCE_PATTERN.test('https://www.npr.org/2026/10/15/story'), false);

  assert.equal(isNepaliSourceUrl('https://www.onlinekhabar.com/2026/10/1'), true);
  assert.equal(isNepaliSourceUrl('https://english.onlinekhabar.com/story'), false);
  assert.equal(isNepaliSourceUrl('https://example.com/x.npz'), false);
  assert.equal(isLikelyNepali({ text: 'Plain English', url: 'https://english.onlinekhabar.com/a' }), false);
  assert.equal(isLikelyNepali({ text: 'नेपाल', url: 'https://example.com' }), true);
});

test('preference keywords include Nepali words and skip function words', () => {
  const keywords = extractKeywords('नेपाल राष्ट्र बैंकले ब्याजदर घटाएको जानकारी दिएको छ, says central bank');
  assert.ok(keywords.includes('ब्याजदर'));
  assert.ok(keywords.includes('central'));
  assert.ok(!keywords.includes('जानकारी'));
  assert.ok(!keywords.includes('says'));

  const preferences = buildPreferences([
    { article: { title: 'Budget vote', description: 'Parliament budget', category: 'business', source: 'Post' } },
    { article: { title: 'Cricket final', description: 'Nepal cricket', category: 'sports', source: 'Post' } }
  ]);
  assert.equal(preferences.categoryScores.business, 50);
  assert.equal(preferences.categoryScores.sports, 50);
  assert.deepEqual(preferences.preferredSources, [{ source: 'Post', score: 100 }]);
  assert.equal(preferences.totalArticlesRead, 2);
});

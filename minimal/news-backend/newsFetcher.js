const Parser = require('rss-parser');
const fetch = require('node-fetch');

const parser = new Parser({
  timeout: 10000,
  customFields: {
    item: ['media:content', 'media:thumbnail', 'enclosure', 'content:encoded']
  }
});

// RSS Feed Sources - USA and Nepal (English & Nepali)
const RSS_FEEDS = {
  technology: [
    // USA Sources
    'https://techcrunch.com/feed/',
    'https://www.theverge.com/rss/index.xml',
    'https://www.wired.com/feed/rss',
    // Nepal Sources
    'https://english.onlinekhabar.com/feed',
    'https://kathmandupost.com/science-technology/feed' // This one might still work if the general /rss works
  ],
  business: [
    // USA Sources
    'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147',
    'https://www.marketwatch.com/rss/topstories',
    // Nepal Sources
    'https://www.onlinekhabar.com/content/business/feed',
    'https://kathmandupost.com/money/rss'
  ],
  sports: [
    // USA Sources
    'https://www.espn.com/espn/rss/news',
    'https://sports.yahoo.com/rss/',
    'https://www.cbssports.com/rss/headlines/',
    // Nepal Sources
    'https://english.onlinekhabar.com/sports/feed',
    'https://www.onlinekhabar.com/content/sports/feed',
    'https://kathmandupost.com/sports/rss'
  ],
  entertainment: [
    // USA Sources
    'https://variety.com/feed/',
    'https://www.hollywoodreporter.com/feed/',
    'https://ew.com/feed/',
    // Nepal Sources
    'https://english.onlinekhabar.com/entertainment/feed',
    'https://kathmandupost.com/art-entertainment/rss',
    'https://www.onlinekhabar.com/content/entertainment/feed'
  ],
  health: [
    // USA Sources
    'https://www.medicalnewstoday.com/rss/news.xml',
    'http://feeds.feedburner.com/oceanofweb',
    // Nepal Sources
    'https://english.onlinekhabar.com/health/feed',
    'https://www.onlinekhabar.com/content/health/feed',
    'https://kathmandupost.com/health/rss'
  ],
  science: [
    // USA Sources
    'https://www.sciencedaily.com/rss/all.xml',
    'https://www.nasa.gov/rss/dyn/breaking_news.rss',
    'https://www.sciencenews.org/feed',
    // Nepal Sources
    'https://kathmandupost.com/rss',
    'https://www.onlinekhabar.com/feed',
    'https://ratopati.com/feed',
    'https://setopati.com/feed',
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

// Classify article into category based on content
function classifyArticle(title, description, contentSnippet) {
  const text = `${title} ${description} ${contentSnippet}`.toLowerCase();
  const scores = {};

  // Calculate score for each category
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = 0;
    keywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) {
        scores[category] += matches.length;
      }
    });
  }

  // Find category with highest score
  let bestCategory = 'technology'; // default
  let maxScore = 0;

  for (const [category, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

// Extract image from RSS item
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

  if (content) {
    const match = content.match(imgRegex);
    if (match && match[1]) {
      return match[1];
    }
  }

  if (item.contentSnippet) {
    const match = item.contentSnippet.match(imgRegex);
    if (match && match[1]) return match[1];
  }

  if (item.description) {
    const match = item.description.match(imgRegex);
    if (match && match[1]) return match[1];
  }

  return null;
}

// Fetch news from a single RSS feed
async function fetchFeedNews(feedUrl, suggestedCategory) {
  try {
    const feed = await parser.parseURL(feedUrl);
    const articles = [];

    for (const item of feed.items) {
      // Skip items without title or link
      if (!item.title || !item.link) continue;

      const title = item.title.trim();
      const description = (item.contentSnippet || item.description || '').trim();

      // Get full content - try multiple fields for maximum content
      let content = '';
      if (item['content:encoded']) {
        // Many RSS feeds put full content in content:encoded
        content = item['content:encoded'];
      } else if (item.content) {
        content = item.content;
      } else if (item.description) {
        content = item.description;
      } else if (item.contentSnippet) {
        content = item.contentSnippet;
      }

      // Clean HTML tags from content but keep the text
      const cleanContent = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

      // Cleanup description - remove HTML tags
      const cleanDescription = description.replace(/<[^>]*>/g, '').trim();

      // Only include articles with substantial content
      if (cleanContent.length < 50) {
        // If content is too short, skip (Nepali feeds are often short)
        continue;
      }

      // Classify the article
      const category = classifyArticle(title, cleanDescription, cleanContent);

      const imageUrl = extractImage(item, content);

      const article = {
        title: title,
        description: cleanDescription.substring(0, 500), // Limit description
        content: cleanContent.substring(0, 5000), // Store more content (5000 chars)
        category: category,
        source: feed.title || 'Unknown Source',
        author: item.creator || item.author || null,
        url: item.link,
        urlToImage: imageUrl,
        publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        fetchedAt: new Date()
      };

      articles.push(article);
    }

    console.log(`✅ Fetched ${articles.length} articles from ${feed.title || feedUrl}`);
    return articles;

  } catch (error) {
    console.error(`❌ Error fetching ${feedUrl}:`, error.message);
    return [];
  }
}

// Fetch news from all RSS feeds
async function fetchAllNews() {
  const allArticles = [];

  console.log('🔄 Starting to fetch news from all RSS feeds...\n');

  for (const [category, feeds] of Object.entries(RSS_FEEDS)) {
    console.log(`\n📰 Fetching ${category.toUpperCase()} news...`);

    for (const feedUrl of feeds) {
      const articles = await fetchFeedNews(feedUrl, category);
      allArticles.push(...articles);

      // Small delay to avoid overwhelming servers
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`\n✅ Total articles fetched: ${allArticles.length}`);
  return allArticles;
}

// Remove duplicate articles based on URL
function removeDuplicates(articles) {
  const seen = new Set();
  const unique = [];

  for (const article of articles) {
    if (!seen.has(article.url)) {
      seen.add(article.url);
      unique.push(article);
    }
  }

  console.log(`🗑️  Removed ${articles.length - unique.length} duplicate articles`);
  return unique;
}

module.exports = {
  fetchAllNews,
  removeDuplicates,
  classifyArticle,
  RSS_FEEDS
};

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

// Load environment variables
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const searchRoutes = require('./routes/searchRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const marketGyanRoutes = require('./features/marketGyan/routes/marketGyanRoutes');

// Import services
const { startNewsletterScheduler } = require('./services/newsletterScheduler');
const { runMbart } = require('./services/mbartService');
const { summarizeArticle } = require('./services/summaryService');
const { isLikelyNepali } = require('./services/languageService');
const {
  AUDIO_DIRECTORY,
  audioExists,
  getAudioTarget,
  synthesizeAudio
} = require('./services/ttsService');
const {
  startMarketGyanPostMarketScheduler
} = require('./features/marketGyan/scheduler/postMarketScheduler');
const {
  connectMongo,
  withMongoRetry
} = require('./features/marketGyan/services/mongoConnectionService');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware - Enable CORS for all network origins
app.use(cors({
  origin: true, // Allow all origins
  credentials: true
}));
app.use(express.json());

// Serve static audio files
app.use('/audio', express.static(AUDIO_DIRECTORY));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/market-gyan', marketGyanRoutes);


// MongoDB Connection
withMongoRetry(
  () => connectMongo(),
  {
    maxAttempts: Infinity,
    operationName: 'Starting the API MongoDB connection'
  }
)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Import models
const Article = require('./models/Article');

// ============ API ROUTES ============

// 1. Get all articles or filter by category
app.get('/api/news', async (req, res) => {
  try {
    const { category, page = 1, limit = 12 } = req.query;

    let query = {};
    if (category && category !== 'all') {
      if (category === 'local') {
        // Filter for Nepali news sources
        query.url = { $regex: /(onlinekhabar\.com|kathmandupost\.com|thehimalayantimes\.com|ratopati\.com|setopati\.com|nagariknews\.com|\.np)/i };
      } else {
        query.category = category;
      }
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const articles = await Article.find(query)
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Article.countDocuments(query);

    // Shuffle articles to provide variety from different sites
    const shuffledArticles = [...articles];
    for (let i = shuffledArticles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledArticles[i], shuffledArticles[j]] = [shuffledArticles[j], shuffledArticles[i]];
    }

    res.json({
      success: true,
      count: shuffledArticles.length,
      total,
      page: parseInt(page),
      hasMore: skip + articles.length < total,
      data: shuffledArticles
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 2. Get single article by ID
app.get('/api/news/:id', async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);

    if (!article) {
      return res.status(404).json({
        success: false,
        error: 'Article not found'
      });
    }

    res.json({
      success: true,
      data: article
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 3. Add new article (for testing purposes)
app.post('/api/news', async (req, res) => {
  try {
    const article = await Article.create(req.body);

    res.status(201).json({
      success: true,
      data: article
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// 4. Add multiple articles (bulk insert)
app.post('/api/news/bulk', async (req, res) => {
  try {
    const articles = await Article.insertMany(req.body);

    res.status(201).json({
      success: true,
      count: articles.length,
      data: articles
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function to fetch full content from URL
async function fetchFullContent(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });
    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove unwanted elements
    $('script, style, nav, footer, header, aside, .ads, .comments').remove();

    // Try to find the main content area
    let content = '';
    const contentSelectors = [
      'article',
      '[itemprop="articleBody"]',
      '.article-body',
      '.post-content',
      '.entry-content',
      'main',
      '.content'
    ];

    for (const selector of contentSelectors) {
      const el = $(selector);
      if (el.length > 0) {
        content = el.find('p').map((i, p) => $(p).text()).get().join('\n\n');
        if (content.length > 300) break;
      }
    }

    // Fallback: just get all P tags if no specific container found
    if (content.length < 300) {
      content = $('p').map((i, p) => $(p).text()).get().join('\n\n');
    }

    return content.trim();
  } catch (error) {
    console.error(`Scraping failed for ${url}:`, error.message);
    return null;
  }
}

// 5. Summarize article using API first, then fall back to local mBART
app.post('/api/news/:id/summarize', async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);

    if (!article) {
      return res.status(404).json({
        success: false,
        error: 'Article not found'
      });
    }

    if (article.summary) {
      return res.json({
        success: true,
        data: article.summary
      });
    }

    // check if we need to fetch full content
    let fullContent = article.content;
    if (!fullContent || fullContent.length < 600) {
      console.log(`🔍 Content too short (${fullContent ? fullContent.length : 0} chars), fetching full article...`);
      const scraped = await fetchFullContent(article.url);
      const currentLength = fullContent ? fullContent.length : 0;
      if (scraped && scraped.length > currentLength) {
        fullContent = scraped;
        // Optionally save the full content back to the DB for future use
        article.content = fullContent;
        await article.save();
      }
    }

    const summary = await summarizeArticle({ article, fullContent });

    // Save summary to database
    article.summary = summary;
    await article.save();

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Optional: translate arbitrary English text to Nepali using the same fine-tuned mBART model.
// POST /api/translate  { "text": "..." }
app.post('/api/translate', async (req, res) => {
  try {
    const text = (req.body && req.body.text) ? String(req.body.text) : '';
    if (!text.trim()) {
      return res.status(400).json({ success: false, error: 'Missing "text" in request body' });
    }
    const translated = await runMbart({
      task: 'translate_en_to_ne',
      text: text.trim().slice(0, 5000),
      maxNewTokens: 256,
      maxInputTokens: 1024
    });
    return res.json({ success: true, data: translated });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Generate TTS for article summary
app.post('/api/news/:id/tts', async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);

    if (!article) {
      return res.status(404).json({ success: false, error: 'Article not found' });
    }

    if (!article.summary) {
      return res.status(400).json({ success: false, error: 'Summary not generated yet. Please summarize first.' });
    }

    const fileName = `${article._id}.wav`;
    if (audioExists(fileName)) {
      return res.json({ success: true, audioUrl: getAudioTarget(fileName).audioUrl });
    }

    const nepali = isLikelyNepali({
      text: article.summary,
      url: article.url
    });
    console.log(`Generating TTS for article: ${article.title} (${nepali ? 'Nepali' : 'English'})`);

    const { audioUrl } = await synthesizeAudio({
      text: article.summary,
      fileName,
      nepali
    });
    return res.json({ success: true, audioUrl });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 6b. Generate TTS for arbitrary text (used for translation playback)
// POST /api/tts  { "text": "..." }
app.post('/api/tts', async (req, res) => {
  try {
    const rawText = (req.body && req.body.text) ? String(req.body.text) : '';
    const text = rawText.trim();

    if (!text) {
      return res.status(400).json({ success: false, error: 'Missing "text" in request body' });
    }

    const safeId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fileName = `tts_${safeId}.wav`;
    const { audioUrl } = await synthesizeAudio({
      text,
      fileName
    });
    return res.json({ success: true, audioUrl });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 7. Delete article by ID
app.delete('/api/news/:id', async (req, res) => {
  try {
    const article = await Article.findByIdAndDelete(req.params.id);

    if (!article) {
      return res.status(404).json({
        success: false,
        error: 'Article not found'
      });
    }

    res.json({
      success: true,
      message: 'Article deleted'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 6. Get categories with article count
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await Article.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check route
app.get('/', (req, res) => {
  res.json({
    message: 'News Aggregator API is running',
    endpoints: {
      getNews: 'GET /api/news?category=technology',
      getSingleNews: 'GET /api/news/:id',
      addNews: 'POST /api/news',
      bulkAdd: 'POST /api/news/bulk',
      deleteNews: 'DELETE /api/news/:id',
      getCategories: 'GET /api/categories'
    }
  });
});

// Start Server - bind to 0.0.0.0 for network access
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Network access: http://192.168.1.199:${PORT}`);

  // Start the newsletter scheduler
  startNewsletterScheduler();
  console.log('📧 Newsletter scheduler initialized');

  startMarketGyanPostMarketScheduler();
});

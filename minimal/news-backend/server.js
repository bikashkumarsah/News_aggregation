const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Load environment variables
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');

// Import services
const { startNewsletterScheduler } = require('./services/newsletterScheduler');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static audio files
app.use('/audio', express.static(path.join(__dirname, 'public/audio')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);


// MongoDB Connection (Local MongoDB)
mongoose.connect('mongodb://localhost:27017/newsDB', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Import models
const Article = require('./models/Article');
const User = require('./models/User');

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

// 5. Summarize article using Gemini
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

    const GEMINI_API_KEY = 'AIzaSyAgxwt7tZYXnaMEIi2tt23Y0hwK9TU7Yt0';
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent?key=${GEMINI_API_KEY}`;

    // check if we need to fetch full content
    let fullContent = article.content;
    if (!fullContent || fullContent.length < 600) {
      console.log(`🔍 Content too short (${fullContent ? fullContent.length : 0} chars), fetching full article...`);
      const scraped = await fetchFullContent(article.url);
      if (scraped && scraped.length > fullContent.length) {
        fullContent = scraped;
        // Optionally save the full content back to the DB for future use
        article.content = fullContent;
        await article.save();
      }
    }

    const isNepali = article.url.match(/(onlinekhabar\.com|ratopati\.com|setopati\.com|nagariknews\.com|\.np)/i);
    const summaryLanguage = isNepali ? 'Nepali (in Devanagari script)' : 'English';

    const prompt = `Summarize the following news article in 3-5 concise bullet points. The summary must be in ${summaryLanguage}. Format the output as a Markdown list (using -). **Bold** key entities, names, numbers, and important statistics for easier scanning. Do not include any introductory text like "Here is a summary".\n\nTitle: ${article.title}\nDescription: ${article.description}\nContent: ${fullContent || article.description}`;

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      })
    });

    const data = await response.json();

    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
      const summary = data.candidates[0].content.parts[0].text;

      // Save summary to database
      article.summary = summary;
      await article.save();

      res.json({
        success: true,
        data: summary
      });
    } else {
      console.error('Gemini API Error:', JSON.stringify(data));
      throw new Error('Failed to generate summary from Gemini');
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
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

    const audioDir = path.join(__dirname, 'public/audio');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    const fileName = `${article._id}.wav`;
    const outputPath = path.join(audioDir, fileName);
    const audioUrl = `/audio/${fileName}`;

    // If audio already exists, just return the URL
    if (fs.existsSync(outputPath)) {
      return res.json({ success: true, audioUrl });
    }

    // Determine which model to use based on source/URL
    const isNepali = article.url.match(/(onlinekhabar\.com|ratopati\.com|setopati\.com|nagariknews\.com|\.np)/i);
    const modelPath = isNepali
      ? path.join(__dirname, 'models', 'ne_NP-google-medium.onnx')
      : path.join(__dirname, 'models', 'en_US-lessac-medium.onnx');

    console.log(` Generating TTS for article: ${article.title} (${isNepali ? 'Nepali' : 'English'})`);

    // Clean up markdown from summary for better TTS
    const cleanText = article.summary.replace(/[*#\-_]/g, ' ').trim();

    const pythonProcess = spawn('python3', [
      path.join(__dirname, 'tts_service.py'),
      cleanText,
      outputPath,
      modelPath
    ]);

    pythonProcess.stderr.on('data', (data) => {
      console.error(`TTS Error: ${data}`);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        res.json({ success: true, audioUrl });
      } else {
        res.status(500).json({ success: false, error: 'TTS generation failed' });
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);

  // Start the newsletter scheduler
  startNewsletterScheduler();
  console.log('📧 Newsletter scheduler initialized');
});
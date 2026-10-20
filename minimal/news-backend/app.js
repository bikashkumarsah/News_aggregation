const fs = require('fs');
const path = require('path');
const compression = require('compression');
const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');

const authRoutes = require('./routes/authRoutes');
const emailRoutes = require('./routes/emailRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const newsRoutes = require('./routes/newsRoutes');
const searchRoutes = require('./routes/searchRoutes');
const userRoutes = require('./routes/userRoutes');
const marketGyanRoutes = require('./features/marketGyan/routes/marketGyanRoutes');
const { buildCorsOptions } = require('./config/corsConfig');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { securityHeaders } = require('./middleware/security');
const { QDRANT_COLLECTION, isQdrantReachable } = require('./services/qdrantService');
const { AUDIO_DIRECTORY } = require('./services/ttsService');

const DEFAULT_FRONTEND_BUILD = path.join(__dirname, '..', 'news-aggregator', 'build');
const MONGO_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

const isEnabled = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const parseTrustProxy = (value) => {
  if (value === undefined || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === 'false') return normalized === 'true';
  const hops = Number(normalized);
  return Number.isInteger(hops) ? hops : String(value).trim();
};

const apiIndex = (req, res) => {
  res.json({
    message: 'News Aggregator API is running',
    endpoints: {
      health: 'GET /api/health',
      getNews: 'GET /api/news?category=technology',
      getSingleNews: 'GET /api/news/:id',
      search: 'GET /api/search?q=...',
      getCategories: 'GET /api/categories',
      addNews: 'POST /api/news (admin)',
      bulkAdd: 'POST /api/news/bulk (admin)',
      deleteNews: 'DELETE /api/news/:id (admin)'
    }
  });
};

const createApp = ({ env = process.env } = {}) => {
  const app = express();
  app.disable('x-powered-by');

  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);

  app.use(securityHeaders);
  app.use(cors(buildCorsOptions(env)));

  // Generated TTS audio. File names are content hashes, so they can be cached.
  // Mounted before compression so WAV files keep supporting range requests.
  app.use('/audio', express.static(AUDIO_DIRECTORY, { index: false, maxAge: '7d' }));

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (req, res) => {
    const mongo = MONGO_STATES[mongoose.connection.readyState] || 'unknown';
    const qdrant = await isQdrantReachable();
    const ok = mongo === 'connected';
    res.status(ok ? 200 : 503).json({
      success: ok,
      status: ok ? (qdrant ? 'ok' : 'degraded') : 'unavailable',
      mongo,
      qdrant: { reachable: qdrant, collection: QDRANT_COLLECTION },
      uptimeSeconds: Math.round(process.uptime())
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/feedback', feedbackRoutes);
  app.use('/api/email', emailRoutes);
  app.use('/api/market-gyan', marketGyanRoutes);
  app.use('/api', newsRoutes);
  app.get('/api', apiIndex);
  app.use('/api', notFoundHandler);

  // Optional single-process deployment: serve the production React build.
  const frontendBuild = env.FRONTEND_BUILD_DIR || DEFAULT_FRONTEND_BUILD;
  const indexHtml = path.join(frontendBuild, 'index.html');
  if (isEnabled(env.SERVE_FRONTEND) && fs.existsSync(indexHtml)) {
    app.use(express.static(frontendBuild, {
      index: false,
      setHeaders: (res, filePath) => {
        // CRA fingerprints everything under /static, so those never change.
        if (filePath.includes(`${path.sep}static${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));
    app.get(/^\/(?!api(?:\/|$)|audio\/).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  } else {
    app.get('/', apiIndex);
  }

  app.use(errorHandler);
  return app;
};

module.exports = {
  createApp,
  parseTrustProxy
};

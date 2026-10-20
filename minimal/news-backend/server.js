// Load environment variables before any module reads its configuration.
require('dotenv').config({ quiet: true });

// `node server.js --serve-frontend` (npm run start:app) also serves the
// production React build, so the whole app runs as one process on one port.
if (process.argv.includes('--serve-frontend')) process.env.SERVE_FRONTEND = 'true';

const { networkInterfaces } = require('os');
const { createApp } = require('./app');
const { getJwtSecret } = require('./config/authConfig');
const { stopMbartWorker } = require('./services/mbartService');
const { startNewsletterScheduler, stopNewsletterScheduler } = require('./services/newsletterScheduler');
const { pruneAudioCache, stopTtsWorker } = require('./services/ttsService');
const {
  startMarketGyanPostMarketScheduler,
  stopMarketGyanPostMarketScheduler
} = require('./features/marketGyan/scheduler/postMarketScheduler');
const {
  connectMongo,
  disconnectMongo,
  withMongoRetry
} = require('./features/marketGyan/services/mongoConnectionService');

const PORT = Number.parseInt(process.env.PORT, 10) || 5001;
const HOST = process.env.HOST || '0.0.0.0';
const AUDIO_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Fail fast when production is started without a usable JWT secret.
getJwtSecret();

const app = createApp();

withMongoRetry(
  () => connectMongo(),
  {
    maxAttempts: Infinity,
    operationName: 'Starting the API MongoDB connection'
  }
)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

const lanAddresses = () => Object.values(networkInterfaces())
  .flat()
  .filter((net) => net && net.family === 'IPv4' && !net.internal)
  .map((net) => net.address);

// Bind to 0.0.0.0 by default for access from other devices on the network.
const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const address of lanAddresses()) {
      console.log(`📡 Network access: http://${address}:${PORT}`);
    }
  }

  startNewsletterScheduler();
  console.log('📧 Newsletter scheduler initialized');

  startMarketGyanPostMarketScheduler();

  pruneAudioCache();
  setInterval(() => pruneAudioCache(), AUDIO_PRUNE_INTERVAL_MS).unref();
});

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, shutting down...`);

  stopNewsletterScheduler();
  stopMarketGyanPostMarketScheduler();
  stopMbartWorker();
  stopTtsWorker();

  setTimeout(() => process.exit(1), 10000).unref();
  server.close(async () => {
    try {
      await disconnectMongo();
    } catch {
      // exiting anyway
    }
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

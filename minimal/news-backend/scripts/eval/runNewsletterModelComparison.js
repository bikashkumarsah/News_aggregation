#!/usr/bin/env node
/**
 * Run a 3-model comparison for newsletter recommendations:
 * - Sample N users
 * - (Optionally) index Qdrant collection per model
 * - Generate top-K recommendations per user per model
 * - Write a single eval JSON file with empty labels
 *
 * After generation, you manually label relevance and run the scorer.
 *
 * Usage:
 *   node scripts/eval/runNewsletterModelComparison.js --users 20 --k 5 --index
 *
 * Outputs:
 *   eval/newsletter_eval_<timestamp>.json
 */

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { spawnSync } = require('child_process');
const User = require('../../models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB';
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

// Default 3-model benchmark set
const MODEL_SET = [
  {
    key: 'minilm',
    label: 'paraphrase-multilingual-MiniLM-L12-v2 (384d)',
    embeddingModel: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    vectorSize: 384,
    collection: 'khabar_articles_minilm_384'
  },
  {
    key: 'e5_small',
    label: 'multilingual-e5-small (384d)',
    embeddingModel: 'Xenova/multilingual-e5-small',
    vectorSize: 384,
    collection: 'khabar_articles_e5_small_384'
  },
  {
    key: 'distiluse',
    label: 'distiluse-base-multilingual-cased-v2 (768d)',
    embeddingModel: 'Xenova/distiluse-base-multilingual-cased-v2',
    vectorSize: 768,
    collection: 'khabar_articles_distiluse_768'
  }
];

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { users: 20, k: 5, index: false, realUsers: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--users') out.users = parseInt(args[++i], 10);
    if (a === '--k') out.k = parseInt(args[++i], 10);
    if (a === '--index') out.index = true;
    if (a === '--real-users') out.realUsers = true;
  }
  out.users = Math.min(Math.max(out.users || 20, 1), 100);
  out.k = Math.min(Math.max(out.k || 5, 1), 10);
  return out;
};

const runNode = (scriptPath, env) => {
  const res = spawnSync('node', [scriptPath], {
    env: { ...process.env, ...env },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (res.status !== 0) {
    throw new Error(`Command failed: node ${scriptPath}\n${res.stderr || res.stdout}`);
  }
  return res.stdout;
};

async function main() {
  const { users: userCount, k, index, realUsers } = parseArgs();

  await mongoose.connect(MONGODB_URI);

  const usersWithHistory = await User.find(
    { 'readHistory.0': { $exists: true } },
    '_id email name readHistory'
  ).lean();

  if (usersWithHistory.length === 0) {
    console.error('No users with reading history found. Read a few articles while logged in, then retry.');
    process.exit(1);
  }

  // Create synthetic profiles from reading histories (so you can evaluate 20+ even if you have fewer real users)
  const HISTORY_WINDOW = Math.min(Math.max(parseInt(process.env.EVAL_HISTORY_WINDOW || '20', 10) || 20, 5), 50);
  const profiles = [];

  if (realUsers) {
    // Use ONLY real users (no synthetic slicing). Great for quick manual labeling.
    // If userCount >= available users, include all.
    const pickedUsers = userCount >= usersWithHistory.length
      ? usersWithHistory
      : (() => {
          // simple shuffle
          const arr = [...usersWithHistory];
          for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
          }
          return arr.slice(0, userCount);
        })();

    for (const u of pickedUsers) {
      const history = Array.isArray(u.readHistory) ? u.readHistory : [];
      const ids = history.map((h) => h.article?.toString()).filter(Boolean);
      if (!ids.length) continue;

      const slice = ids.slice(0, HISTORY_WINDOW); // most recent first
      profiles.push({
        profileId: u._id.toString(),
        baseUserId: u._id.toString(),
        email: u.email,
        name: u.name,
        historyArticleIds: slice
      });
    }
  } else {
    for (let i = 0; i < userCount; i++) {
      const u = usersWithHistory[i % usersWithHistory.length];
      const history = Array.isArray(u.readHistory) ? u.readHistory : [];
      const ids = history.map((h) => h.article?.toString()).filter(Boolean);
      if (!ids.length) continue;

      const win = Math.min(HISTORY_WINDOW, ids.length);
      const maxStart = Math.max(1, ids.length - win + 1);
      const start = (i * 7) % maxStart;
      const slice = ids.slice(start, start + win);

      profiles.push({
        profileId: `${u._id.toString()}-p${Math.floor(i / usersWithHistory.length) + 1}`,
        baseUserId: u._id.toString(),
        email: u.email,
        name: u.name,
        historyArticleIds: slice
      });
    }
  }

  if (profiles.length === 0) {
    console.error('Could not build profiles from reading histories.');
    process.exit(1);
  }

  // Resolve repo root regardless of current working directory:
  // news-backend/scripts/eval -> repo root
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const evalDir = path.join(repoRoot, 'eval');
  fs.mkdirSync(evalDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(evalDir, `newsletter_eval_${timestamp}.json`);
  const profileFile = path.join(evalDir, `newsletter_profiles_${timestamp}.json`);

  fs.writeFileSync(profileFile, JSON.stringify({ generatedAt: new Date().toISOString(), profiles }, null, 2));

  const perModel = {};

  for (const m of MODEL_SET) {
    console.log(`\n=== Model: ${m.key} ===`);
    console.log(`Embedding: ${m.embeddingModel}`);
    console.log(`Collection: ${m.collection}`);
    console.log(`Vector size: ${m.vectorSize}`);

    if (index) {
      console.log('Indexing Qdrant collection...');
      // Reuse existing indexer with env overrides
      runNode(path.join(__dirname, '..', 'indexQdrant.js'), {
        QDRANT_URL,
        QDRANT_COLLECTION: m.collection,
        QDRANT_VECTOR_SIZE: String(m.vectorSize),
        EMBEDDING_PROVIDER: 'transformers',
        EMBEDDING_MODEL: m.embeddingModel,
        // keep batches small for stability with model inference
        QDRANT_INDEX_BATCH: m.vectorSize >= 768 ? '8' : '16',
        // speed up eval indexing: newsletter uses last 24h; 2 days gives enough candidates
        QDRANT_INDEX_DAYS: process.env.QDRANT_INDEX_DAYS || '2'
      });
      console.log('Index complete.');
    }

    console.log('Generating newsletter recommendations...');
    const raw = runNode(path.join(__dirname, 'generateNewsletterRecsFromProfiles.js'), {
      QDRANT_URL,
      QDRANT_COLLECTION: m.collection,
      QDRANT_VECTOR_SIZE: String(m.vectorSize),
      EMBEDDING_PROVIDER: 'transformers',
      EMBEDDING_MODEL: m.embeddingModel,
      EMBEDDING_STRICT: '1',
      EVAL_PROFILE_FILE: profileFile,
      EVAL_LIMIT: String(k)
    });

    // Parse defensively in case any dependency writes extra logs to stdout.
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) {
      throw new Error(`No JSON found in output for model ${m.key}`);
    }
    const parsed = JSON.parse(raw.slice(start, end + 1));

    // Attach empty labels for manual annotation
    for (const p of parsed.profiles) {
      p.recommendations = (p.recommendations || []).map((a) => ({
        ...a,
        relevant: null
      }));
    }

    perModel[m.key] = {
      meta: parsed.meta,
      label: m.label,
      profiles: parsed.profiles
    };
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    note: 'Set `relevant` to true/false for each recommendation, then run the scorer.',
    profilesFile: profileFile,
    profiles,
    models: perModel
  };

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`\n✅ Eval file written: ${outFile}`);
  console.log('Next: label relevance and compute Precision@5.');
}

main()
  .catch((err) => {
    console.error('\n❌ Model comparison failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {}
  });


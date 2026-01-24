#!/usr/bin/env node
/**
 * Generate a manual labeling file to measure Precision@5 for the webapp search bar.
 *
 * What it does:
 * - Uses 5 preset queries (English + Nepali)
 * - For each embedding model (3 models), fetches top-K results from its Qdrant collection
 * - Writes a single JSON file: eval/search_eval_<timestamp>.json
 *
 * Usage:
 *   node scripts/eval/runSearchBarModelComparison.js --k 5
 *   node scripts/eval/runSearchBarModelComparison.js --k 5 --index --days 7
 */

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

const DEFAULT_QUERIES = [
  { id: 'q1', text: 'nepal loss match' },
  { id: 'q2', text: 'interest rate inflation' },
  { id: 'q3', text: 'election commission nepal' },
  { id: 'q4', text: 'टी-२० विश्वकप अभ्यास खेल हार' },
  { id: 'q5', text: 'फिल्म फेस्टिभल पटकथा' }
];

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
  const out = { k: 5, index: false, days: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--k') out.k = parseInt(args[++i], 10);
    if (a === '--index') out.index = true;
    if (a === '--days') out.days = parseInt(args[++i], 10);
  }
  out.k = Math.min(Math.max(out.k || 5, 1), 20);
  if (out.days !== null) out.days = Math.min(Math.max(out.days || 1, 1), 365);
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
  const { k, index, days } = parseArgs();

  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const evalDir = path.join(repoRoot, 'eval');
  fs.mkdirSync(evalDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(evalDir, `search_eval_${timestamp}.json`);

  const modelResults = {};

  for (const m of MODEL_SET) {
    console.log(`\n=== Model: ${m.key} ===`);
    console.log(`Embedding: ${m.embeddingModel}`);
    console.log(`Collection: ${m.collection}`);
    console.log(`Vector size: ${m.vectorSize}`);

    if (index) {
      console.log('Indexing Qdrant collection...');
      runNode(path.join(__dirname, '..', 'indexQdrant.js'), {
        QDRANT_URL,
        QDRANT_COLLECTION: m.collection,
        QDRANT_VECTOR_SIZE: String(m.vectorSize),
        EMBEDDING_PROVIDER: 'transformers',
        EMBEDDING_MODEL: m.embeddingModel,
        EMBEDDING_STRICT: '1',
        QDRANT_INDEX_BATCH: m.vectorSize >= 768 ? '8' : '16',
        ...(days ? { QDRANT_INDEX_DAYS: String(days) } : {})
      });
      console.log('Index complete.');
    }

    console.log('Querying top results...');
    const raw = runNode(path.join(__dirname, 'generateSearchResults.js'), {
      QDRANT_URL,
      QDRANT_COLLECTION: m.collection,
      QDRANT_VECTOR_SIZE: String(m.vectorSize),
      EMBEDDING_PROVIDER: 'transformers',
      EMBEDDING_MODEL: m.embeddingModel,
      EMBEDDING_STRICT: '1',
      EVAL_QUERIES_JSON: JSON.stringify(DEFAULT_QUERIES),
      EVAL_K: String(k)
    });

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const parsed = JSON.parse(raw.slice(start, end + 1));

    modelResults[m.key] = {
      label: m.label,
      meta: parsed.meta,
      queries: parsed.queries
    };
  }

  // Merge results into a query-centric file (easier to label/compare)
  const outQueries = DEFAULT_QUERIES.map((q) => {
    const perModel = {};
    for (const m of MODEL_SET) {
      const mq = (modelResults[m.key].queries || []).find((x) => x.queryId === q.id);
      perModel[m.key] = {
        label: modelResults[m.key].label,
        embeddingModel: modelResults[m.key].meta.embeddingModel,
        qdrantCollection: modelResults[m.key].meta.qdrantCollection,
        vectorSize: modelResults[m.key].meta.vectorSize,
        items: mq ? mq.items : []
      };
    }
    return {
      queryId: q.id,
      query: q.text,
      models: perModel
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    note: 'Label each item as relevant true/false, then score Precision@K.',
    k,
    queries: outQueries
  };

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`\n✅ Search eval file written: ${outFile}`);
  console.log('Next: label relevance and compute Precision@5.');
}

main().catch((err) => {
  console.error('\n❌ Search model comparison failed:', err.message);
  process.exitCode = 1;
});


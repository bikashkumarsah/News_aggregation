#!/usr/bin/env node
/**
 * Score a labeled search eval file and compute Precision@K per model.
 *
 * Usage:
 *   node scripts/eval/scoreSearchEval.js /absolute/path/to/eval/search_eval_....json
 */

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/eval/scoreSearchEval.js /path/to/search_eval.json');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
const k = Math.min(Math.max(parseInt(data.k, 10) || 5, 1), 20);

const queries = Array.isArray(data.queries) ? data.queries : [];
if (!queries.length) {
  console.error('No queries found in eval file.');
  process.exit(1);
}

const modelKeys = Object.keys(queries[0].models || {});
if (!modelKeys.length) {
  console.error('No models found in eval file.');
  process.exit(1);
}

const precisionAtK = (items) => {
  const top = (items || []).slice(0, k);
  const labeled = top.filter((r) => r.relevant === true || r.relevant === false);
  if (labeled.length < k) return null;
  const rel = labeled.filter((r) => r.relevant === true).length;
  return rel / k;
};

const results = [];

for (const mk of modelKeys) {
  const perQuery = [];
  const missing = [];

  for (const q of queries) {
    const items = q.models?.[mk]?.items || [];
    const p = precisionAtK(items);
    if (p === null) missing.push(q.queryId || q.query);
    else perQuery.push(p);
  }

  const avg = perQuery.length ? perQuery.reduce((a, b) => a + b, 0) / perQuery.length : null;
  results.push({
    modelKey: mk,
    label: queries[0].models?.[mk]?.label || mk,
    precisionAtK: avg,
    queriesScored: perQuery.length,
    queriesMissingLabels: missing.length
  });
}

results.sort((a, b) => (b.precisionAtK ?? -1) - (a.precisionAtK ?? -1));

console.log(`\nSearch Precision@${k}\n`);
for (const r of results) {
  const p = r.precisionAtK === null ? 'N/A' : r.precisionAtK.toFixed(3);
  console.log(`- ${r.label}: ${p}  (queries scored: ${r.queriesScored}, missing labels: ${r.queriesMissingLabels})`);
}


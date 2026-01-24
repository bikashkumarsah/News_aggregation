#!/usr/bin/env node
/**
 * Score a labeled newsletter eval file and compute Precision@K.
 *
 * Input format:
 *   eval/newsletter_eval_*.json
 * Each recommendation must have `relevant: true/false` (null means unlabeled).
 *
 * Usage:
 *   node scripts/eval/scoreNewsletterEval.js /absolute/path/to/evalfile.json
 */

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/eval/scoreNewsletterEval.js /path/to/eval.json');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf-8'));

const modelKeys = Object.keys(data.models || {});
if (!modelKeys.length) {
  console.error('No models found in eval file.');
  process.exit(1);
}

const precisionAtK = (recs, k) => {
  const top = recs.slice(0, k);
  const labeled = top.filter((r) => r.relevant === true || r.relevant === false);
  if (labeled.length < k) return null; // incomplete labels
  const rel = labeled.filter((r) => r.relevant === true).length;
  return rel / k;
};

const k = (() => {
  // Try to infer K from first model metadata
  const first = data.models[modelKeys[0]];
  const metaK = first?.meta?.limit;
  return Math.min(Math.max(parseInt(metaK, 10) || 5, 1), 10);
})();

const results = [];

for (const mk of modelKeys) {
  const model = data.models[mk];
  const profiles = model.profiles || model.users || [];
  const p = [];
  const missing = [];

  for (const u of profiles) {
    const recs = u.recommendations || [];
    const val = precisionAtK(recs, k);
    if (val === null) missing.push(u.profileId || u.userId);
    else p.push(val);
  }

  const avg = p.length ? p.reduce((a, b) => a + b, 0) / p.length : null;
  results.push({
    modelKey: mk,
    label: model.label || mk,
    precisionAtK: avg,
    usersScored: p.length,
    usersMissingLabels: missing.length
  });
}

results.sort((a, b) => (b.precisionAtK ?? -1) - (a.precisionAtK ?? -1));

console.log(`\nPrecision@${k} (manual labels)\n`);
for (const r of results) {
  const p = r.precisionAtK === null ? 'N/A' : r.precisionAtK.toFixed(3);
  console.log(`- ${r.label}: ${p}  (scored users: ${r.usersScored}, missing labels: ${r.usersMissingLabels})`);
}


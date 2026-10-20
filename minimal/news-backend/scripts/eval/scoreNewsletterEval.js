#!/usr/bin/env node
/**
 * Score a labeled newsletter eval file and compute Precision@K.
 *
 * Input format:
 *   eval/newsletter_eval_*.json
 * Each recommendation must have `relevant: true/false` (null means unlabeled).
 * A list shorter than K counts its missing slots as not relevant, so every arm
 * is scored on the same profiles.
 *
 * With two or more models (arms) it also prints paired differences on the
 * profiles scored in both, and a per-kind breakdown when profiles have `kind`.
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
  if (top.some((r) => r.relevant !== true && r.relevant !== false)) return null; // incomplete labels
  const rel = top.filter((r) => r.relevant === true).length;
  return rel / k;
};

const k = (() => {
  // Try to infer K from first model metadata
  const first = data.models[modelKeys[0]];
  const metaK = first?.meta?.limit;
  return Math.min(Math.max(parseInt(metaK, 10) || 5, 1), 10);
})();

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

// Per model: Map(profileId -> P@K) for fully labeled profiles.
const scores = new Map();
const results = [];

for (const mk of modelKeys) {
  const model = data.models[mk];
  const profiles = model.profiles || model.users || [];
  const byProfile = new Map();
  const missing = [];

  for (const u of profiles) {
    const id = u.profileId || u.userId;
    const val = precisionAtK(u.recommendations || [], k);
    if (val === null) missing.push(id);
    else byProfile.set(id, val);
  }

  scores.set(mk, byProfile);
  results.push({
    modelKey: mk,
    label: model.label || mk,
    precisionAtK: mean([...byProfile.values()]),
    usersScored: byProfile.size,
    usersMissingLabels: missing.length
  });
}

results.sort((a, b) => (b.precisionAtK ?? -1) - (a.precisionAtK ?? -1));

console.log(`\nPrecision@${k} (manual labels)\n`);
for (const r of results) {
  const p = r.precisionAtK === null ? 'N/A' : r.precisionAtK.toFixed(3);
  console.log(`- ${r.label}: ${p}  (scored users: ${r.usersScored}, missing labels: ${r.usersMissingLabels})`);
}

// Paired comparison on the profiles every arm in the pair has scored.
if (modelKeys.length > 1) {
  // Seeded bootstrap so repeated runs print the same interval.
  let seed = 12345;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const bootstrapCi = (diffs, rounds = 10000) => {
    const means = [];
    for (let b = 0; b < rounds; b++) {
      let sum = 0;
      for (let i = 0; i < diffs.length; i++) sum += diffs[Math.floor(rand() * diffs.length)];
      means.push(sum / diffs.length);
    }
    means.sort((a, b) => a - b);
    return [means[Math.floor(rounds * 0.025)], means[Math.floor(rounds * 0.975)]];
  };
  // Exact two-sided sign test over the non-tied profiles.
  const signTestP = (wins, losses) => {
    const n = wins + losses;
    if (!n) return 1;
    const choose = (a, b) => {
      let c = 1;
      for (let i = 1; i <= b; i++) c = (c * (a - b + i)) / i;
      return c;
    };
    let tail = 0;
    for (let i = 0; i <= Math.min(wins, losses); i++) tail += choose(n, i);
    return Math.min(1, (2 * tail) / 2 ** n);
  };

  console.log(`\nPaired differences in P@${k} (row minus column arm, profiles scored in both)\n`);
  for (let a = 0; a < modelKeys.length; a++) {
    for (let b = a + 1; b < modelKeys.length; b++) {
      const [ka, kb] = [modelKeys[a], modelKeys[b]];
      const shared = [...scores.get(ka).keys()].filter((id) => scores.get(kb).has(id));
      if (!shared.length) continue;
      const diffs = shared.map((id) => scores.get(ka).get(id) - scores.get(kb).get(id));
      const wins = diffs.filter((d) => d > 0).length;
      const losses = diffs.filter((d) => d < 0).length;
      const [lo, hi] = bootstrapCi(diffs);
      console.log(
        `- ${ka} vs ${kb}: ${mean(diffs) >= 0 ? '+' : ''}${mean(diffs).toFixed(3)} `
        + `(95% bootstrap CI ${lo.toFixed(3)} to ${hi.toFixed(3)}; better/tied/worse ${wins}/${shared.length - wins - losses}/${losses}; `
        + `sign test p=${signTestP(wins, losses).toFixed(3)}; n=${shared.length})`
      );
    }
  }
}

// Breakdown by profile kind (e.g. real users vs synthetic personas), when recorded.
const kindOf = new Map((data.profiles || []).filter((p) => p.kind).map((p) => [p.profileId, p.kind]));
if (kindOf.size) {
  const kinds = [...new Set(kindOf.values())];
  console.log(`\nP@${k} by profile kind\n`);
  for (const kind of kinds) {
    const cells = modelKeys.map((mk) => {
      const values = [...scores.get(mk)].filter(([id]) => kindOf.get(id) === kind).map(([, v]) => v);
      return `${mk} ${values.length ? mean(values).toFixed(3) : 'N/A'}`;
    });
    const n = [...kindOf.values()].filter((v) => v === kind).length;
    console.log(`- ${kind} (n=${n}): ${cells.join(', ')}`);
  }
}

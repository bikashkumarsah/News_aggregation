#!/usr/bin/env node
/**
 * Interactive CLI labeling tool for newsletter eval JSON.
 *
 * This helps you manually label relevance without editing JSON by hand.
 *
 * Usage:
 *   node scripts/eval/labelNewsletterEval.js /absolute/path/to/eval/newsletter_eval_....json
 *
 * Blind labeling (recommended when comparing arms): export one sheet in which
 * each profile's recommendations from every arm are merged, deduplicated and
 * shuffled, with no arm names; fill in `relevant` (by hand or with any
 * labeler), then import it to label every arm's copy of each article:
 *   node scripts/eval/labelNewsletterEval.js <eval.json> --export <sheet.json>
 *   node scripts/eval/labelNewsletterEval.js <eval.json> --import <sheet.json>
 *
 * Controls:
 * - y = relevant
 * - n = not relevant
 * - s = skip (leave null)
 * - q = quit (saves progress)
 */

const fs = require('fs');
const readline = require('readline');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/eval/labelNewsletterEval.js /path/to/eval.json [--export|--import sheet.json]');
  process.exit(1);
}

const flagValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};

const load = () => JSON.parse(fs.readFileSync(file, 'utf-8'));
const save = (data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

const profilesOf = (model) => model.profiles || model.users || [];
const profileKey = (p) => p.profileId || p.userId;
const isLabeled = (r) => r.relevant === true || r.relevant === false;

const formatHistoryItem = (h, i) => {
  const readAt = h.readAt ? `  read ${new Date(h.readAt).toISOString().slice(0, 16).replace('T', ' ')}` : '';
  return `H${i + 1}. ${h.title}  [${h.category}]  ${h.source || ''}${readAt}`;
};

// Deterministic shuffle per profile, so a re-export keeps the same order.
const seededShuffle = (items, seedText) => {
  let seed = 0;
  for (const ch of seedText) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
  const rand = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const exportSheet = (data, sheetFile) => {
  const byProfile = new Map();
  for (const model of Object.values(data.models || {})) {
    for (const p of profilesOf(model)) {
      const key = profileKey(p);
      if (!byProfile.has(key)) byProfile.set(key, { profileId: key, history: p.historyPreview || [], candidates: new Map() });
      const entry = byProfile.get(key);
      for (const r of p.recommendations || []) {
        const existing = entry.candidates.get(r._id);
        if (!existing) {
          entry.candidates.set(r._id, {
            id: r._id,
            title: r.title,
            description: r.description,
            source: r.source,
            category: r.category,
            topics: r.topics || [],
            publishedAt: r.publishedAt,
            relevant: isLabeled(r) ? r.relevant : null
          });
        } else if (!isLabeled(existing) && isLabeled(r)) {
          existing.relevant = r.relevant;
        }
      }
    }
  }

  const sheet = {
    evalFile: file,
    instructions: 'Set `relevant` to true/false for each candidate: would this reader likely find it useful or '
      + 'interesting given the reading history? Candidates from all arms are merged, deduplicated and shuffled.',
    profiles: [...byProfile.values()].map((entry) => ({
      profileId: entry.profileId,
      history: entry.history.map(formatHistoryItem),
      candidates: seededShuffle([...entry.candidates.values()], entry.profileId)
    }))
  };
  fs.writeFileSync(sheetFile, JSON.stringify(sheet, null, 2));
  const total = sheet.profiles.reduce((n, p) => n + p.candidates.length, 0);
  console.log(`Wrote ${total} candidates for ${sheet.profiles.length} profiles to ${sheetFile}`);
};

const importSheet = (data, sheetFile) => {
  const sheet = JSON.parse(fs.readFileSync(sheetFile, 'utf-8'));
  const labels = new Map();
  for (const p of sheet.profiles || []) {
    for (const c of p.candidates || []) {
      if (isLabeled(c)) labels.set(`${p.profileId}\u0000${c.id}`, c.relevant);
    }
  }

  let applied = 0;
  let missing = 0;
  for (const model of Object.values(data.models || {})) {
    for (const p of profilesOf(model)) {
      for (const r of p.recommendations || []) {
        const label = labels.get(`${profileKey(p)}\u0000${r._id}`);
        if (label === undefined) {
          if (!isLabeled(r)) missing += 1;
          continue;
        }
        r.relevant = label;
        applied += 1;
      }
    }
  }
  save(data);
  console.log(`Applied ${applied} labels to ${file}; ${missing} recommendations still unlabeled.`);
};

const labelInteractively = async (data) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  const models = data.models || {};
  const modelKeys = Object.keys(models);

  console.log(`\nLabeling file: ${file}`);
  console.log(`Models: ${modelKeys.join(', ')}`);
  console.log('Type y/n/s/q at each recommendation.\n');

  for (const mk of modelKeys) {
    const model = models[mk];
    const label = model.label || mk;
    const profiles = profilesOf(model);

    console.log(`\n==============================`);
    console.log(`MODEL: ${label}`);
    console.log(`==============================\n`);

    for (let pi = 0; pi < profiles.length; pi++) {
      const p = profiles[pi];
      console.log(`\n--- Profile ${pi + 1}/${profiles.length} ---`);
      console.log(`profileId: ${profileKey(p)}`);
      if (p.email) console.log(`user: ${p.name || ''} <${p.email}>`);

      // Show every read the recommender used, not only the newest few.
      const historyPreview = p.historyPreview || [];
      if (historyPreview.length) {
        console.log('\nHistory (newest first):');
        historyPreview.forEach((h, i) => {
          console.log(`  ${formatHistoryItem(h, i)}  topics=${JSON.stringify(h.topics || [])}`);
        });
      }

      const recs = p.recommendations || [];
      for (let ri = 0; ri < recs.length; ri++) {
        const r = recs[ri];
        if (isLabeled(r)) continue; // already labeled

        console.log(`\nR${ri + 1}. ${r.title}`);
        console.log(`    source=${r.source}  category=${r.category}  topics=${JSON.stringify(r.topics || [])}`);
        console.log(`    url=${r.url}`);

        const ans = (await ask('Relevant? (y/n/s/q): ')).trim().toLowerCase();
        if (ans === 'q') {
          save(data);
          console.log('\nSaved progress. Exiting.');
          rl.close();
          return;
        }
        if (ans === 'y') r.relevant = true;
        else if (ans === 'n') r.relevant = false;
        else if (ans === 's' || ans === '') r.relevant = null;
        else {
          console.log('Invalid input. Use y/n/s/q.');
          ri -= 1;
          continue;
        }

        // Save after each label to avoid losing work
        save(data);
      }
    }
  }

  save(data);
  console.log('\n✅ Labeling complete.');
  rl.close();
};

const main = async () => {
  const data = load();
  if (!Object.keys(data.models || {}).length) {
    console.error('No models found in eval file.');
    process.exit(1);
  }

  const exportFile = flagValue('--export');
  const importFile = flagValue('--import');
  if (exportFile) return exportSheet(data, exportFile);
  if (importFile) return importSheet(data, importFile);
  return labelInteractively(data);
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

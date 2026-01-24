#!/usr/bin/env node
/**
 * Interactive CLI labeling tool for newsletter eval JSON.
 *
 * This helps you manually label relevance without editing JSON by hand.
 *
 * Usage:
 *   node scripts/eval/labelNewsletterEval.js /absolute/path/to/eval/newsletter_eval_....json
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
  console.error('Usage: node scripts/eval/labelNewsletterEval.js /path/to/eval.json');
  process.exit(1);
}

const load = () => JSON.parse(fs.readFileSync(file, 'utf-8'));
const save = (data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const main = async () => {
  const data = load();
  const models = data.models || {};
  const modelKeys = Object.keys(models);

  if (!modelKeys.length) {
    console.error('No models found in eval file.');
    process.exit(1);
  }

  console.log(`\nLabeling file: ${file}`);
  console.log(`Models: ${modelKeys.join(', ')}`);
  console.log('Type y/n/s/q at each recommendation.\n');

  for (const mk of modelKeys) {
    const model = models[mk];
    const label = model.label || mk;
    const profiles = model.profiles || model.users || [];

    console.log(`\n==============================`);
    console.log(`MODEL: ${label}`);
    console.log(`==============================\n`);

    for (let pi = 0; pi < profiles.length; pi++) {
      const p = profiles[pi];
      console.log(`\n--- Profile ${pi + 1}/${profiles.length} ---`);
      console.log(`profileId: ${p.profileId || p.userId}`);
      if (p.email) console.log(`user: ${p.name || ''} <${p.email}>`);

      const historyPreview = p.historyPreview || [];
      if (historyPreview.length) {
        console.log('\nHistory preview (context):');
        historyPreview.slice(0, 8).forEach((h, i) => {
          console.log(`  H${i + 1}. ${h.title}  [${h.category}]  topics=${JSON.stringify(h.topics || [])}`);
        });
      }

      const recs = p.recommendations || [];
      for (let ri = 0; ri < recs.length; ri++) {
        const r = recs[ri];
        if (r.relevant === true || r.relevant === false) continue; // already labeled

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

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exitCode = 1;
});


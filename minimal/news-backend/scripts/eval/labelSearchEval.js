#!/usr/bin/env node
/**
 * Interactive CLI labeling tool for search eval JSON.
 *
 * Usage:
 *   node scripts/eval/labelSearchEval.js /absolute/path/to/eval/search_eval_....json
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
  console.error('Usage: node scripts/eval/labelSearchEval.js /path/to/search_eval.json');
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
  const queries = Array.isArray(data.queries) ? data.queries : [];
  if (!queries.length) {
    console.error('No queries in file.');
    process.exit(1);
  }

  const modelKeys = Object.keys(queries[0].models || {});
  if (!modelKeys.length) {
    console.error('No models in file.');
    process.exit(1);
  }

  console.log(`\nLabeling search eval: ${file}`);
  console.log(`Models: ${modelKeys.join(', ')}`);
  console.log('Type y/n/s/q at each result.\n');

  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    console.log(`\n==============================`);
    console.log(`Query ${qi + 1}/${queries.length}: ${q.query}`);
    console.log(`==============================\n`);

    for (const mk of modelKeys) {
      const m = q.models[mk];
      const label = m.label || mk;
      const items = Array.isArray(m.items) ? m.items : [];

      console.log(`\n--- Model: ${label} ---`);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.relevant === true || it.relevant === false) continue;

        console.log(`\n#${it.rank || (i + 1)} ${it.title}`);
        console.log(`   source=${it.source}  category=${it.category}  topics=${JSON.stringify(it.topics || [])}`);
        console.log(`   url=${it.url}`);
        console.log(`   qdrantScore=${it.qdrantScore}`);

        const ans = (await ask('Relevant? (y/n/s/q): ')).trim().toLowerCase();
        if (ans === 'q') {
          save(data);
          console.log('\nSaved progress. Exiting.');
          rl.close();
          return;
        }
        if (ans === 'y') it.relevant = true;
        else if (ans === 'n') it.relevant = false;
        else if (ans === 's' || ans === '') it.relevant = null;
        else {
          console.log('Invalid input. Use y/n/s/q.');
          i -= 1;
          continue;
        }

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


#!/usr/bin/env node
/**
 * Label-free check of the newsletter interest profiles against real reading.
 *
 * At each session boundary in the users' read histories (a gap of 30+ minutes),
 * the reads before the boundary are the history. Every article published in
 * the 7 days before the boundary, minus what was already read, is ranked by
 * cosine similarity to the interest vector, and the articles the user actually
 * read in the next 48 hours (published before the boundary) are located in that
 * ranking. Both interest profiles are scored (EVAL_INTEREST text and vector),
 * plus how many of the 5 newsletter picks from the full pipeline were read later.
 *
 * Usage (point MONGODB_URI / QDRANT_* at a throwaway copy, never production):
 *   node scripts/eval/nextReadCheck.js [--users export.json] [--until <ISO time>]
 *
 * --users  Extended JSON export of the users collection (a JSON array, or one
 *          document per line as bsondump prints), for when the copy's own
 *          histories were trimmed to a snapshot. Default: users in MONGODB_URI.
 * --until  Latest boundary to score (default: newest article publishedAt), so
 *          every candidate pool is complete.
 */

require('dotenv').config({ quiet: true });

const fs = require('fs');
const mongoose = require('mongoose');
const Article = require('../../models/Article');
const User = require('../../models/User');
const { retrieveArticleVectors } = require('../../services/qdrantService');
const { buildInterestVector, buildPreferences, recommendFromReads } = require('../../services/preferenceService');
const { textQueryInterest } = require('./textInterestQuery');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB';
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_GAP_MS = 30 * 60 * 1000;
const POOL_DAYS = 7;
const FUTURE_MS = 2 * DAY_MS;
const MIN_HISTORY = 3;

const flagValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};

// Extended JSON ({"$oid": ...}, {"$date": {"$numberLong": ...}}) or plain values.
const toId = (v) => String(v && typeof v === 'object' && '$oid' in v ? v.$oid : v);
const toMs = (v) => {
  if (v instanceof Date) return v.getTime();
  if (v && typeof v === 'object' && '$date' in v) return toMs(v.$date);
  if (v && typeof v === 'object' && '$numberLong' in v) return Number(v.$numberLong);
  return typeof v === 'number' ? v : Date.parse(v);
};

const loadUsers = async (file) => {
  if (!file) {
    return User.find({ 'readHistory.0': { $exists: true } }, 'readHistory').sort({ _id: 1 }).lean();
  }
  const raw = fs.readFileSync(file, 'utf-8').trim();
  const users = raw.startsWith('[') ? JSON.parse(raw) : raw.split('\n').map((line) => JSON.parse(line));
  // Number users in _id order like the database path; keep file order without ids.
  return users.every((u) => u._id) ? users.sort((a, b) => toId(a._id).localeCompare(toId(b._id))) : users;
};

const cosine = (a, b) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
};

const signTestP = (wins, losses) => {
  const n = wins + losses;
  let tail = 0;
  let choose = 1;
  for (let k = 0; k <= Math.min(wins, losses); k++) {
    if (k > 0) choose = (choose * (n - k + 1)) / k;
    tail += choose;
  }
  return n ? Math.min(1, (2 * tail) / 2 ** n) : 1;
};

const ARMS = { text: textQueryInterest, vector: undefined };

async function main() {
  await mongoose.connect(MONGODB_URI);

  const articles = await Article.find({}, 'title description category source topics publishedAt').lean();
  const byId = new Map(articles.map((a) => [a._id.toString(), a]));
  const until = flagValue('--until')
    ? Date.parse(flagValue('--until'))
    : Math.max(...articles.map((a) => new Date(a.publishedAt).getTime()));

  // Session-boundary cuts for every user.
  const cuts = [];
  const users = await loadUsers(flagValue('--users'));
  users.forEach((u, ui) => {
    const reads = (u.readHistory || [])
      .map((h) => ({ id: toId(h.article), readAt: toMs(h.readAt) }))
      .filter((h) => byId.has(h.id) && Number.isFinite(h.readAt))
      .sort((a, b) => b.readAt - a.readAt); // newest first, as stored
    const ascending = [...reads].reverse();
    for (let i = 1; i < ascending.length; i++) {
      if (ascending[i].readAt - ascending[i - 1].readAt < SESSION_GAP_MS) continue;
      const cut = ascending[i].readAt - 60 * 1000;
      if (cut > until) continue;
      const history = reads.filter((h) => h.readAt < cut);
      const read = new Set(history.map((h) => h.id));
      const future = reads.filter((h) => h.readAt > cut && h.readAt <= cut + FUTURE_MS
        && new Date(byId.get(h.id).publishedAt).getTime() <= cut && !read.has(h.id));
      if (history.length < MIN_HISTORY || !future.length) continue;
      const pool = articles.filter((a) => {
        const t = new Date(a.publishedAt).getTime();
        return t >= cut - POOL_DAYS * DAY_MS && t <= cut && !read.has(a._id.toString());
      });
      cuts.push({ user: `real-${ui + 1}`, cut, history, future, pool });
    }
  });

  // Stored vectors for every article in any pool.
  const poolIds = [...new Set(cuts.flatMap((c) => c.pool.map((a) => a._id.toString())))];
  const vectors = new Map();
  for (let i = 0; i < poolIds.length; i += 256) {
    for (const [id, vector] of await retrieveArticleVectors(poolIds.slice(i, i + 256))) vectors.set(id, vector);
  }

  const rows = [];
  for (const c of cuts) {
    const historyReads = c.history.map((h) => ({ article: byId.get(h.id), readAt: new Date(h.readAt) }));
    const pool = c.pool.filter((a) => vectors.has(a._id.toString()));
    const futureIds = new Set(c.future.map((f) => f.id));
    for (const [arm, buildInterest] of Object.entries(ARMS)) {
      const q = await (buildInterest || buildInterestVector)(historyReads, { now: c.cut });
      const ranked = pool
        .map((a) => ({ id: a._id.toString(), score: cosine(q, vectors.get(a._id.toString())) }))
        .sort((a, b) => b.score - a.score);
      const rankOf = new Map(ranked.map((r, i) => [r.id, i + 1]));
      const picks = await recommendFromReads(historyReads, {
        preferences: buildPreferences(historyReads),
        limit: 5,
        now: c.cut,
        buildInterest
      });
      rows.push({
        user: c.user,
        cut: new Date(c.cut).toISOString().slice(0, 16),
        arm,
        history: c.history.length,
        pool: pool.length,
        ranks: c.future.map((f) => rankOf.get(f.id)).filter(Boolean),
        picks: picks.length,
        hits: picks.filter((d) => futureIds.has(d._id.toString())).length
      });
    }
  }

  const mrr = (ranks) => ranks.reduce((s, r) => s + 1 / r, 0) / ranks.length;
  const percentile = (row) => row.ranks.reduce((s, r) => s + r / row.pool, 0) / row.ranks.length;
  for (const r of rows) {
    console.log(`${r.user} cut ${r.cut} ${r.arm.padEnd(6)} history=${r.history} pool=${r.pool} `
      + `later reads=${r.ranks.length} picks read later=${r.hits}/${r.picks} ranks=${r.ranks.join(',')}`);
  }

  console.log('');
  for (const arm of Object.keys(ARMS)) {
    const armRows = rows.filter((r) => r.arm === arm);
    const ranks = armRows.flatMap((r) => r.ranks);
    const recall = (k) => (ranks.filter((r) => r <= k).length / ranks.length).toFixed(3);
    const median = [...ranks].sort((a, b) => a - b)[Math.floor(ranks.length / 2)];
    const meanPercentile = armRows.reduce((s, r) => s + percentile(r) * r.ranks.length, 0) / ranks.length;
    console.log(`${arm}: cuts=${armRows.length} later reads=${ranks.length} recall@10=${recall(10)} recall@50=${recall(50)} `
      + `MRR=${mrr(ranks).toFixed(4)} median rank=${median} mean percentile=${meanPercentile.toFixed(3)} `
      + `picks read later=${armRows.reduce((s, r) => s + r.hits, 0)}/${armRows.reduce((s, r) => s + r.picks, 0)}`);
  }

  // Paired: each later read under both arms, and each cut as a unit.
  const text = rows.filter((r) => r.arm === 'text');
  const vec = rows.filter((r) => r.arm === 'vector');
  let better = 0;
  let worse = 0;
  let tied = 0;
  let cutsMrr = 0;
  let cutsPercentile = 0;
  text.forEach((t, i) => {
    t.ranks.forEach((rank, j) => {
      if (vec[i].ranks[j] < rank) better += 1;
      else if (vec[i].ranks[j] > rank) worse += 1;
      else tied += 1;
    });
    if (mrr(vec[i].ranks) > mrr(t.ranks)) cutsMrr += 1;
    if (percentile(vec[i]) < percentile(t)) cutsPercentile += 1;
  });
  console.log(`\nvector vs text, per later read: ranked higher ${better}, tied ${tied}, lower ${worse} `
    + `(sign test p=${signTestP(better, worse).toFixed(3)}; reads repeat across overlapping cuts)`);
  console.log(`vector vs text, per cut: higher MRR on ${cutsMrr}/${text.length} `
    + `(sign test p=${signTestP(cutsMrr, text.length - cutsMrr).toFixed(3)}), `
    + `better mean percentile on ${cutsPercentile}/${text.length}`);
  const distinct = new Set(cuts.flatMap((c) => c.future.map((f) => `${c.user}:${f.id}`)));
  console.log(`distinct later reads: ${distinct.size}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {}
    // The embedding runtime can keep worker threads alive; this is a one-shot CLI.
    process.exit(process.exitCode || 0);
  });

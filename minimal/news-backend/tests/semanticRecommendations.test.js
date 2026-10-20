const test = require('node:test');
const assert = require('node:assert/strict');

const { buildInterestVector, recommendFromReads } = require('../services/preferenceService');

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-01-24T09:00:00.000Z');

test('interest vector is the recency-weighted mean of stored vectors, embedding only missing reads', async () => {
  const embedded = [];
  const vector = await buildInterestVector([
    { article: { _id: 'a', title: 'Stored read' }, readAt: new Date(now) },
    { article: { _id: 'b', title: 'Missing read', description: 'Not indexed yet' }, readAt: new Date(now - 3 * DAY_MS) }
  ], { now, halfLifeDays: 3 }, {
    retrieveVectors: async (ids) => {
      assert.deepEqual(ids, ['a', 'b']);
      return new Map([['a', [1, 0]]]);
    },
    embed: async (text, opts) => {
      embedded.push({ text, opts });
      return [0, 1];
    }
  });

  assert.equal(embedded.length, 1, 'only the article missing from the index is embedded');
  assert.match(embedded[0].text, /Missing read/);
  assert.match(embedded[0].text, /Not indexed yet/);
  assert.deepEqual(embedded[0].opts, { role: 'passage' });
  // Weights 1 (today) and 0.5 (one half-life ago), then L2-normalized.
  assert.ok(Math.abs(vector[0] - (1 / Math.sqrt(1.25))) < 1e-9);
  assert.ok(Math.abs(vector[1] - (0.5 / Math.sqrt(1.25))) < 1e-9);
});

test('a model outage only drops unindexed reads from the interest vector', async () => {
  const failingEmbed = async () => {
    throw new Error('model unavailable');
  };
  const reads = [
    { article: { _id: 'a', title: 'Stored' }, readAt: new Date(now) },
    { article: { _id: 'b', title: 'Missing' }, readAt: new Date(now) }
  ];

  const vector = await buildInterestVector(reads, { now }, {
    retrieveVectors: async () => new Map([['a', [3, 4]]]),
    embed: failingEmbed
  });
  assert.deepEqual(vector, [0.6, 0.8]);

  const none = await buildInterestVector(reads, { now }, {
    retrieveVectors: async () => new Map(),
    embed: failingEmbed
  });
  assert.equal(none, null, 'no usable vector means no semantic recommendations');
});

test('semantic recommendations exclude reads and keep at most two articles per source', async () => {
  const reads = [{
    article: { _id: 'read-1', title: 'AI chips', category: 'technology', source: 'Wire', topics: ['finance'] },
    readAt: new Date(now)
  }];
  const hit = (mongoId, score) => ({ score, payload: { mongoId } });
  const searches = [];
  const docs = {
    x1: { source: 'Same' }, x2: { source: 'Same' }, x3: { source: 'Same' }, y1: { source: 'Other' }
  };

  const picked = await recommendFromReads(reads, {
    preferences: {},
    limit: 3,
    now,
    buildInterest: async (historyReads, options) => {
      assert.equal(historyReads, reads);
      assert.equal(options.now, now);
      return [1, 0];
    }
  }, {
    searchVectors: async (params) => {
      searches.push(params);
      return [hit('x1', 0.9), hit('x2', 0.8), hit('x3', 0.7), hit('y1', 0.5)];
    },
    loadArticles: async (ids) => ids.map((id) => ({
      _id: { toString: () => id },
      title: id,
      publishedAt: new Date(now),
      topics: [],
      ...docs[id]
    }))
  });

  assert.deepEqual(picked.map((doc) => doc._id.toString()), ['x1', 'x2', 'y1']);
  assert.ok(searches.every((s) => s.vector[0] === 1 && s.excludeMongoIds.includes('read-1')));
  assert.equal(searches[0].from, new Date(now - DAY_MS).toISOString(), 'the first window is the last 24 hours');
  assert.deepEqual(searches[0].topics, ['finance'], 'the strongest variant filters by the top topics read');
});

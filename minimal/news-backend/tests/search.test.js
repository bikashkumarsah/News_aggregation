const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildExpandedQuery,
  createReranker,
  mergeRanked,
  semanticSearch
} = require('../routes/searchRoutes');

const hit = (mongoId, score) => ({ score, payload: { mongoId } });

test('expanded query adds Nepali hints for English queries only', () => {
  const expanded = buildExpandedQuery('nepal cricket match');
  assert.match(expanded, /नेपाल/);
  assert.match(expanded, /खेल/);
  assert.equal(buildExpandedQuery('नेपाल क्रिकेट'), null);
  assert.equal(buildExpandedQuery('2026'), null);
});

test('merged results keep the best score and record which query hit', () => {
  const merged = mergeRanked([hit('a', 0.5), hit('b', 0.7)], [hit('a', 0.9), hit('c', 0.1)]);
  assert.deepEqual(merged.map((r) => r.mongoId), ['a', 'b', 'c']);
  assert.equal(merged[0].bestScore, 0.9);
  assert.equal(merged[0].baseHit && merged[0].expandedHit, true);
  assert.equal(merged[2].baseHit, false);
});

test('reranker boosts topic intent and keyword overlap without overriding semantics', () => {
  const score = createReranker({ qText: 'budget deficit', expandedQuery: null, topicList: ['finance'] });
  const finance = score({ title: 'Budget deficit widens', topics: ['finance'] }, { bestScore: 0.4, baseHit: true });
  const unrelated = score({ title: 'Football final', topics: ['sports'] }, { bestScore: 0.4, baseHit: true });
  assert.ok(finance > unrelated);
});

test('semantic search pages are disjoint slices of one stable ranking', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `id${String(i).padStart(2, '0')}`);
  const searchCalls = [];
  const searchVectors = async (params) => {
    searchCalls.push(params);
    // Qdrant ranks by descending score; return the whole pool.
    return ids.map((id, i) => hit(id, 1 - (i / 100)));
  };
  const loadArticles = async (requested) => requested.map((id) => ({
    _id: { toString: () => id },
    title: `Story ${id}`,
    description: '',
    topics: []
  }));

  const pages = [];
  for (const offset of [0, 12, 24]) {
    const result = await semanticSearch(
      { qText: 'markets', topicList: [], offset, limit: 12 },
      { searchVectors, loadArticles }
    );
    pages.push(result.data.map((doc) => doc._id.toString()));
  }

  const all = pages.flat();
  assert.equal(new Set(all).size, all.length, 'no article appears on two pages');
  assert.deepEqual(all, ids, 'every article is reachable in rank order');
  assert.ok(searchCalls.every((call) => call.offset === 0 && call.limit === searchCalls[0].limit),
    'every page re-ranks the same fixed-size pool');
});

test('semantic search defers to MongoDB when Qdrant has no usable hits', async () => {
  const empty = await semanticSearch(
    { qText: 'markets', topicList: [], offset: 0, limit: 12 },
    { searchVectors: async () => [], loadArticles: async () => [] }
  );
  assert.equal(empty, null);

  const stale = await semanticSearch(
    { qText: 'markets', topicList: [], offset: 0, limit: 12 },
    { searchVectors: async () => [hit('deleted', 0.9)], loadArticles: async () => [] }
  );
  assert.equal(stale, null, 'points for deleted articles are not returned as results');
});

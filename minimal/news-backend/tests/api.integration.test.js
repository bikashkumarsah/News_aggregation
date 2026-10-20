/**
 * End-to-end API tests against a real MongoDB.
 *
 * Run with a disposable database, e.g.:
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/khabar_api_test npm run test:integration
 *
 * The database named in the URI is dropped before and after the run.
 */

const MONGO_URI = process.env.MONGODB_TEST_URI;

// Configure the app before any module reads its environment.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret';
process.env.ADMIN_API_TOKEN = 'integration-admin-token';
process.env.QDRANT_URL = 'http://127.0.0.1:9'; // nothing listens here: exercises the MongoDB fallback
process.env.PUBLIC_API_URL = 'http://localhost:5001';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

describe('Khabar API (MongoDB integration)', { skip: !MONGO_URI && 'set MONGODB_TEST_URI to run' }, () => {
  let server;
  let baseUrl;
  let Article;
  let User;
  let MarketDocument;

  const call = async (method, path, { body, token, headers = {}, raw } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined)
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, body: json, text, headers: response.headers };
  };

  const makeArticle = (index, extra = {}) => ({
    title: `Story ${index}`,
    description: `Description ${index}`,
    content: `Content ${index}`,
    category: 'technology',
    source: 'Test Wire',
    url: `https://example.com/story-${index}`,
    publishedAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
    ...extra
  });

  before(async () => {
    await mongoose.connect(MONGO_URI);
    await mongoose.connection.dropDatabase();

    Article = require('../models/Article');
    User = require('../models/User');
    MarketDocument = require('../features/marketGyan/models/MarketDocument');
    await Promise.all([Article.init(), User.init()]);

    const { createApp } = require('../app');
    server = createApp().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('health reports the database connection', async () => {
    const { status, body } = await call('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(body.mongo, 'connected');
    assert.equal(body.qdrant.reachable, false);
    assert.equal(body.status, 'degraded');
  });

  test('registration validates input and never echoes passwords', async () => {
    const missing = await call('POST', '/api/auth/register', { body: { email: 'a@example.com' } });
    assert.equal(missing.status, 400);

    const operator = await call('POST', '/api/auth/register', {
      body: { name: 'Op', email: { $gt: '' }, password: 'secret12' }
    });
    assert.equal(operator.status, 400);

    const created = await call('POST', '/api/auth/register', {
      body: { name: ' Asha ', email: ' Asha@Example.com ', password: 'secret12' }
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.email, 'asha@example.com');
    assert.equal(created.body.data.name, 'Asha');
    assert.ok(created.body.data.token);
    assert.equal(created.body.data.password, undefined);

    const duplicate = await call('POST', '/api/auth/register', {
      body: { name: 'Asha', email: 'asha@example.com', password: 'secret12' }
    });
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.body.error, /already exists/);
  });

  test('login rejects operator injection and wrong passwords', async () => {
    const injected = await call('POST', '/api/auth/login', {
      body: { email: { $ne: null }, password: 'secret12' }
    });
    assert.equal(injected.status, 400, 'operator objects never reach the user query');

    const wrong = await call('POST', '/api/auth/login', {
      body: { email: 'asha@example.com', password: 'not-the-password' }
    });
    assert.equal(wrong.status, 401);

    const unknown = await call('POST', '/api/auth/login', {
      body: { email: 'nobody@example.com', password: 'secret12' }
    });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, wrong.body.error, 'unknown accounts are indistinguishable');

    const ok = await call('POST', '/api/auth/login', {
      body: { email: 'ASHA@example.com', password: 'secret12' }
    });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.data.token);
  });

  test('protected routes require a valid token and /me stays lightweight', async () => {
    assert.equal((await call('GET', '/api/auth/me')).status, 401);
    assert.equal((await call('GET', '/api/auth/me', { token: 'garbage' })).status, 401);

    const { body: login } = await call('POST', '/api/auth/login', {
      body: { email: 'asha@example.com', password: 'secret12' }
    });
    const me = await call('GET', '/api/auth/me', { token: login.data.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.data.email, 'asha@example.com');
    assert.equal(me.body.data.readHistory, undefined);
    assert.equal(me.body.data.password, undefined);
    assert.deepEqual(me.body.data.bookmarks, []);
  });

  test('article mutations require the admin token', async () => {
    const payload = makeArticle(900);
    assert.equal((await call('POST', '/api/news', { body: payload })).status, 403);
    assert.equal((await call('POST', '/api/news', {
      body: payload,
      headers: { 'x-admin-token': 'wrong' }
    })).status, 403);

    const created = await call('POST', '/api/news', {
      body: payload,
      headers: { 'x-admin-token': 'integration-admin-token' }
    });
    assert.equal(created.status, 201);

    const duplicate = await call('POST', '/api/news', {
      body: payload,
      headers: { 'x-admin-token': 'integration-admin-token' }
    });
    assert.equal(duplicate.status, 409);

    assert.equal((await call('DELETE', `/api/news/${created.body.data._id}`)).status, 403);
    const deleted = await call('DELETE', `/api/news/${created.body.data._id}`, {
      headers: { 'x-admin-token': 'integration-admin-token' }
    });
    assert.equal(deleted.status, 200);
  });

  test('news listing validates paging input and paginates without overlap', async () => {
    await Article.insertMany(Array.from({ length: 30 }, (_, i) => makeArticle(i, {
      // Shared timestamps would make skip/limit pagination unstable without a tiebreaker.
      publishedAt: new Date('2026-10-01T00:00:00.000Z')
    })));

    const capped = await call('GET', '/api/news?page=abc&limit=99999');
    assert.equal(capped.status, 200);
    assert.equal(capped.body.page, 1);
    assert.equal(capped.body.count, 30);

    const seen = new Set();
    for (let page = 1; page <= 3; page += 1) {
      const { body } = await call('GET', `/api/news?category=technology&page=${page}&limit=12`);
      for (const article of body.data) {
        assert.ok(!seen.has(article._id), `article ${article.title} appeared on two pages`);
        seen.add(article._id);
      }
      assert.equal(body.hasMore, page < 3);
    }
    assert.equal(seen.size, 30);

    const unknownCategory = await call('GET', '/api/news?category=astrology');
    assert.equal(unknownCategory.body.count, 0);

    assert.equal((await call('GET', '/api/news/not-an-id')).status, 400);
    assert.equal((await call('GET', `/api/news/${new mongoose.Types.ObjectId()}`)).status, 404);
  });

  test('cached summaries are returned without running a model', async () => {
    const article = await Article.create(makeArticle(700, { summary: 'Cached **summary**.' }));
    const { status, body } = await call('POST', `/api/news/${article._id}/summarize`);
    assert.equal(status, 200);
    assert.equal(body.data, 'Cached **summary**.');
    assert.equal((await call('POST', '/api/news/nope/summarize')).status, 400);
  });

  test('bookmarks are idempotent, validated, and removable', async () => {
    const { body: login } = await call('POST', '/api/auth/login', {
      body: { email: 'asha@example.com', password: 'secret12' }
    });
    const token = login.data.token;
    const article = await Article.findOne({ url: 'https://example.com/story-1' });

    const first = await call('POST', `/api/user/bookmarks/${article._id}`, { token });
    const second = await call('POST', `/api/user/bookmarks/${article._id}`, { token });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.bookmarks, [String(article._id)]);

    assert.equal((await call('POST', '/api/user/bookmarks/not-an-id', { token })).status, 400);
    assert.equal((await call('POST', `/api/user/bookmarks/${new mongoose.Types.ObjectId()}`, { token })).status, 404);

    const list = await call('GET', '/api/user/bookmarks', { token });
    assert.equal(list.body.count, 1);
    assert.equal(list.body.data[0].title, 'Story 1');

    const removed = await call('DELETE', `/api/user/bookmarks/${article._id}`, { token });
    assert.deepEqual(removed.body.bookmarks, []);
  });

  test('reading history keeps one entry per article, newest first, capped at 100', async () => {
    const { body: registered } = await call('POST', '/api/auth/register', {
      body: { name: 'Reader', email: 'reader@example.com', password: 'secret12' }
    });
    const token = registered.data.token;
    const extra = await Article.insertMany(Array.from({ length: 80 }, (_, i) => makeArticle(100 + i)));
    const all = await Article.find().sort({ _id: 1 }).select('_id').lean();
    assert.ok(all.length > 100);

    // Concurrent reads from several tabs must not lose entries.
    await Promise.all(all.slice(0, 10).map((doc) => call('POST', `/api/user/history/${doc._id}`, { token })));
    for (const doc of all.slice(10, 105)) {
      await call('POST', `/api/user/history/${doc._id}`, { token });
    }
    // Re-reading an article moves it to the front instead of duplicating it.
    await call('POST', `/api/user/history/${extra[0]._id}`, { token });

    const user = await User.findOne({ email: 'reader@example.com' }).lean();
    assert.equal(user.readHistory.length, 100);
    assert.equal(String(user.readHistory[0].article), String(extra[0]._id));
    const ids = user.readHistory.map((item) => String(item.article));
    assert.equal(new Set(ids).size, ids.length, 'no duplicate history entries');

    const limited = await call('GET', '/api/user/history?limit=5', { token });
    assert.equal(limited.body.count, 5);
    assert.equal(limited.body.data[0].article._id, String(extra[0]._id));
  });

  test('email preferences accept a validated digest time', async () => {
    const { body: login } = await call('POST', '/api/auth/login', {
      body: { email: 'asha@example.com', password: 'secret12' }
    });
    const token = login.data.token;

    const invalid = await call('PUT', '/api/user/email-preferences', { token, body: { digestTime: '25:00' } });
    assert.equal(invalid.status, 400);

    const updated = await call('PUT', '/api/user/email-preferences', {
      token,
      body: { dailyDigest: true, digestTime: '06:30' }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.dailyDigest, true);
    assert.equal(updated.body.data.digestTime, '06:30');
  });

  test('unsubscribe links confirm on GET and unsubscribe on POST', async () => {
    const { createUnsubscribeToken } = require('../services/unsubscribeService');
    const user = await User.findOne({ email: 'asha@example.com' });
    assert.equal(user.emailPreferences.dailyDigest, true);
    const token = encodeURIComponent(createUnsubscribeToken(user._id));

    const page = await call('GET', `/api/email/unsubscribe?token=${token}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /<form method="post"/);
    assert.equal((await User.findById(user._id)).emailPreferences.dailyDigest, true, 'GET does not unsubscribe');

    const done = await call('POST', `/api/email/unsubscribe?token=${token}`, { raw: 'List-Unsubscribe=One-Click' });
    assert.equal(done.status, 200);
    assert.equal((await User.findById(user._id)).emailPreferences.dailyDigest, false);

    assert.equal((await call('GET', '/api/email/unsubscribe?token=forged')).status, 400);
  });

  test('search falls back to MongoDB with case-insensitive source filters', async () => {
    await Article.create(makeArticle(800, { title: 'NASA launches lunar probe', source: 'NASA Breaking News', category: 'science' }));

    const keyword = await call('GET', '/api/search?q=lunar');
    assert.equal(keyword.status, 200);
    assert.equal(keyword.body.engine, 'mongo_fallback');
    assert.deepEqual(keyword.body.data.map((a) => a.title), ['NASA launches lunar probe']);

    const bySource = await call('GET', '/api/search?source=nasa');
    assert.equal(bySource.body.engine, 'mongo');
    assert.ok(bySource.body.data.every((a) => a.source === 'NASA Breaking News'));
    assert.equal(bySource.body.total, 1);

    const noSource = await call('GET', '/api/search?source=does-not-exist');
    assert.equal(noSource.body.total, 0);

    const regexChars = await call('GET', `/api/search?q=${encodeURIComponent('(.*')}`);
    assert.equal(regexChars.status, 200, 'user input is never compiled as a raw regex');
  });

  test('retention cleanup keeps bookmarked and Market Gyan articles', async () => {
    const { deleteOldArticles } = require('../services/newsIngestionService');
    const old = new Date('2020-01-01T00:00:00.000Z');
    const [bookmarked, referenced, expendable] = await Article.insertMany([
      makeArticle(1001, { publishedAt: old }),
      makeArticle(1002, { publishedAt: old, category: 'business' }),
      makeArticle(1003, { publishedAt: old })
    ]);
    await User.updateOne({ email: 'asha@example.com' }, { $addToSet: { bookmarks: bookmarked._id } });
    await MarketDocument.collection.insertOne({
      documentType: 'financial_news',
      article: referenced._id,
      title: 'Corpus document',
      language: 'en',
      source: { name: 'ShareSansar', url: 'https://example.com/corpus' }
    });

    const silent = { log: () => {}, warn: () => {} };
    const result = await deleteOldArticles({ days: 7, now: new Date('2026-10-15T00:00:00.000Z'), logger: silent });

    assert.ok(result.deleted >= 1);
    assert.ok(await Article.exists({ _id: bookmarked._id }), 'bookmarked article kept');
    assert.ok(await Article.exists({ _id: referenced._id }), 'Market Gyan corpus article kept');
    assert.equal(await Article.exists({ _id: expendable._id }), null, 'unreferenced old article deleted');
  });

  test('ingestion saves only new, valid articles', async () => {
    const { saveNewArticles } = require('../services/newsIngestionService');
    const silent = { log: () => {}, warn: () => {} };
    const fresh = makeArticle(2001, { title: 'Brand new story' });
    const existing = makeArticle(2000, { title: 'Already stored story' });
    await Article.create(existing);
    const invalid = { ...makeArticle(2002), category: 'astrology' };

    const expired = makeArticle(2003, { publishedAt: new Date('2020-01-01T00:00:00.000Z') });

    const result = await saveNewArticles([fresh, existing, fresh, invalid, expired], {
      logger: silent,
      cutoff: new Date('2026-01-01T00:00:00.000Z')
    });
    assert.equal(result.inserted.length, 1);
    assert.equal(result.invalid, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.expired, 1, 'items past the retention window are never stored');
    assert.equal(await Article.exists({ url: expired.url }), null);
    const saved = await Article.findOne({ url: fresh.url }).lean();
    assert.ok(Array.isArray(saved.topics));
  });

  test('unknown API routes and malformed JSON return JSON errors', async () => {
    const missing = await call('GET', '/api/does-not-exist');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.success, false);

    const malformed = await call('POST', '/api/auth/login', {
      raw: '{"email": ',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.equal(malformed.status, 400);
    assert.match(malformed.body.error, /not valid JSON/);

    const { headers } = await call('GET', '/api/health');
    assert.equal(headers.get('x-powered-by'), null);
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
  });
});

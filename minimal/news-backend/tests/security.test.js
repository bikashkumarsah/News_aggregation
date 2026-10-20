const test = require('node:test');
const assert = require('node:assert/strict');

const { isProxiedRequest, safeEqual } = require('../utils/security');
const { isAdminRequest } = require('../middleware/adminAccess');
const { PLACEHOLDER_SECRETS, resolveJwtSecret } = require('../config/authConfig');
const { buildCorsOptions } = require('../config/corsConfig');
const { createRateLimiter } = require('../middleware/rateLimit');
const { isPrivateHost, isFetchableUrl } = require('../services/contentService');
const { isReviewRequestAllowed } = require('../features/marketGyan/middleware/reviewAccess');
const { isInternalRequestAllowed } = require('../features/marketGyan/middleware/internalAccess');
const { clamp, isValidObjectId, parsePagination, queryString } = require('../utils/validation');

const silentLogger = { warn: () => {} };

const requestWithHeaders = (headers = {}, remoteAddress = '127.0.0.1') => ({
  socket: { remoteAddress },
  headers,
  get: (name) => headers[name.toLowerCase()]
});

const fakeResponse = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  return res;
};

test('safeEqual compares secrets exactly and rejects non-strings', () => {
  assert.equal(safeEqual('token-123', 'token-123'), true);
  assert.equal(safeEqual('token-124', 'token-123'), false);
  assert.equal(safeEqual('token', 'token-123'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(undefined, 'token'), false);
  assert.equal(safeEqual({ $ne: null }, 'token'), false);
});

test('admin access requires the configured token header', () => {
  assert.equal(isAdminRequest(requestWithHeaders({ 'x-admin-token': 'secret' }), { token: 'secret' }), true);
  assert.equal(isAdminRequest(requestWithHeaders({ 'x-admin-token': 'wrong' }), { token: 'secret' }), false);
  assert.equal(isAdminRequest(requestWithHeaders({}), { token: 'secret' }), false);
  // No token configured means the admin endpoints are disabled entirely.
  assert.equal(isAdminRequest(requestWithHeaders({ 'x-admin-token': 'anything' }), { token: '' }), false);
});

test('JWT secret must be real in production and is random in development', () => {
  assert.equal(resolveJwtSecret({ env: { JWT_SECRET: 'a-strong-secret' }, logger: silentLogger }), 'a-strong-secret');
  assert.throws(
    () => resolveJwtSecret({ env: { NODE_ENV: 'production' }, logger: silentLogger }),
    /JWT_SECRET must be set/
  );
  for (const placeholder of PLACEHOLDER_SECRETS) {
    assert.throws(
      () => resolveJwtSecret({ env: { NODE_ENV: 'production', JWT_SECRET: placeholder }, logger: silentLogger }),
      /JWT_SECRET must be set/
    );
  }
  const first = resolveJwtSecret({ env: {}, logger: silentLogger });
  const second = resolveJwtSecret({ env: {}, logger: silentLogger });
  assert.ok(first.length >= 64);
  assert.notEqual(first, second, 'development fallback is random, never a shared constant');
  assert.ok(![...PLACEHOLDER_SECRETS].includes(first));
});

test('CORS is open in development, explicit when configured, and same-origin in production', () => {
  assert.equal(buildCorsOptions({}).origin, true);
  assert.equal(buildCorsOptions({ NODE_ENV: 'production' }).origin, false);
  assert.equal(buildCorsOptions({ CORS_ORIGINS: '*' }).origin, true);

  const { origin } = buildCorsOptions({ CORS_ORIGINS: 'https://app.example.com, http://localhost:3000/' });
  const decide = (value) => new Promise((resolve) => origin(value, (error, allowed) => resolve(allowed)));
  return Promise.all([
    decide('https://app.example.com').then((allowed) => assert.equal(allowed, true)),
    decide('http://localhost:3000').then((allowed) => assert.equal(allowed, true)),
    decide('https://evil.example').then((allowed) => assert.equal(allowed, false)),
    decide(undefined).then((allowed) => assert.equal(allowed, true))
  ]);
});

test('rate limiter rejects requests over the window budget with Retry-After', () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 2, keyGenerator: () => 'client-a' });
  let passed = 0;
  const next = () => { passed += 1; };

  limiter({}, fakeResponse(), next);
  limiter({}, fakeResponse(), next);
  const blocked = fakeResponse();
  limiter({}, blocked, next);

  assert.equal(passed, 2);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.success, false);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
});

test('proxied requests are never treated as local review or internal traffic', () => {
  const local = requestWithHeaders({ 'x-market-gyan-token': 'secret' });
  const proxied = requestWithHeaders({ 'x-market-gyan-token': 'secret', 'x-forwarded-for': '203.0.113.9' });

  assert.equal(isProxiedRequest(local), false);
  assert.equal(isProxiedRequest(proxied), true);
  assert.equal(isReviewRequestAllowed(local, { enabled: true, nodeEnv: 'development' }), true);
  assert.equal(isReviewRequestAllowed(proxied, { enabled: true, nodeEnv: 'development' }), false);
  assert.equal(isInternalRequestAllowed(local, { token: 'secret' }), true);
  assert.equal(isInternalRequestAllowed(proxied, { token: 'secret' }), false);
});

test('scraper only fetches public http(s) URLs', () => {
  for (const host of ['localhost', '127.0.0.1', '10.0.0.8', '172.20.1.1', '192.168.1.199', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', 'db.internal']) {
    assert.equal(isPrivateHost(host), true, host);
  }
  assert.equal(isPrivateHost('kathmandupost.com'), false);
  assert.equal(isFetchableUrl('https://kathmandupost.com/story'), true);
  assert.equal(isFetchableUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isFetchableUrl('file:///etc/passwd'), false);
  assert.equal(isFetchableUrl('javascript:alert(1)'), false);
});

test('request helpers coerce untrusted input into safe primitives', () => {
  assert.equal(isValidObjectId('507f1f77bcf86cd799439011'), true);
  assert.equal(isValidObjectId('not-an-id'), false);
  assert.equal(isValidObjectId({ $ne: null }), false);

  assert.deepEqual(parsePagination({}), { page: 1, limit: 12, skip: 0 });
  assert.deepEqual(parsePagination({ page: '3', limit: '20' }), { page: 3, limit: 20, skip: 40 });
  assert.deepEqual(parsePagination({ page: 'abc', limit: '-5' }), { page: 1, limit: 1, skip: 0 });
  assert.deepEqual(parsePagination({ page: ['2', '9'], limit: '1000000' }), { page: 2, limit: 50, skip: 50 });
  assert.equal(parsePagination({ page: '999999' }).page, 1000);

  assert.equal(queryString(' nepal '), 'nepal');
  assert.equal(queryString(['first', 'second']), 'first');
  assert.equal(queryString({ $gt: '' }), '');
  assert.equal(queryString('x'.repeat(500), { maxLength: 10 }).length, 10);
  assert.equal(clamp(12, 1, 10), 10);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_SUMMARY_MODEL,
  generateSummaryWithApi
} = require('../services/summaryService');
const {
  articleAudioFileName,
  getOrCreateAudio,
  pruneAudioCache,
  textAudioFileName
} = require('../services/ttsService');
const { fetchFullContent } = require('../services/contentService');
const { runMbart } = require('../services/mbartService');
const { LruCache, createInFlightDeduper } = require('../utils/cache');

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

test('summary API keeps the key out of the URL and uses a current model by default', async () => {
  let request;
  await generateSummaryWithApi({
    article: { title: 'NEPSE' },
    fullContent: 'Body',
    outputLanguage: 'English',
    env: { GEMINI_API_KEY: 'secret-key' },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return okJson({ candidates: [{ content: { parts: [{ text: 'Summary.' }] } }] });
    }
  });

  assert.ok(request.url.includes(`/models/${DEFAULT_SUMMARY_MODEL}:generateContent`));
  assert.ok(!request.url.includes('secret-key'), 'API key never appears in the URL');
  assert.equal(request.options.headers['x-goog-api-key'], 'secret-key');
  const body = JSON.parse(request.options.body);
  assert.ok(body.generationConfig.maxOutputTokens >= 1024, 'room for thinking tokens');
  assert.equal(body.generationConfig.thinkingConfig, undefined);
  assert.ok(request.options.signal, 'request can be aborted on timeout');
});

test('summary API honours the thinking level and reports empty responses', async () => {
  let body;
  await assert.rejects(
    generateSummaryWithApi({
      article: {},
      fullContent: '',
      outputLanguage: 'English',
      env: { GEMINI_API_KEY: 'k', GEMINI_THINKING_LEVEL: 'Low' },
      fetchImpl: async (url, options) => {
        body = JSON.parse(options.body);
        return okJson({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] });
      }
    }),
    /no text \(finishReason: MAX_TOKENS\)/
  );
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
});

test('summary API times out instead of hanging', async () => {
  await assert.rejects(
    generateSummaryWithApi({
      article: {},
      outputLanguage: 'English',
      env: { GEMINI_API_KEY: 'k', SUMMARY_API_TIMEOUT_MS: '20' },
      fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })
    }),
    /timed out/
  );
});

test('mBART requests go through the shared worker protocol', async () => {
  let payload;
  const text = await runMbart(
    { task: 'translate_en_to_ne', text: 'Hello', maxNewTokens: 64 },
    { worker: { request: async (body) => { payload = body; return { ok: true, text: 'नमस्ते' }; } } }
  );
  assert.equal(text, 'नमस्ते');
  assert.deepEqual(payload, { task: 'translate_en_to_ne', text: 'Hello', max_new_tokens: 64 });
});

test('audio file names are content-addressed per voice', () => {
  const a = textAudioFileName('Hello world', false);
  assert.equal(a, textAudioFileName('  Hello   world ', false), 'normalized text shares a file');
  assert.notEqual(a, textAudioFileName('Hello world', true), 'voices never share a file');
  assert.match(a, /^tts_[0-9a-f]{32}\.wav$/);

  const first = articleAudioFileName('507f1f77bcf86cd799439011', 'Old summary', false);
  const second = articleAudioFileName('507f1f77bcf86cd799439011', 'New summary', false);
  assert.notEqual(first, second, 'a regenerated summary never replays stale audio');
});

test('concurrent audio requests synthesize once and later ones hit the cache', async () => {
  const written = new Set();
  let synthesized = 0;
  const fsImpl = {
    existsSync: (file) => written.has(file),
    mkdirSync: () => {},
    renameSync: (from, to) => written.add(to)
  };
  const worker = {
    request: async () => {
      synthesized += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { ok: true };
    }
  };

  const fileName = textAudioFileName('Concurrent text', false);
  const [one, two] = await Promise.all([
    getOrCreateAudio({ text: 'Concurrent text', fileName, nepali: false, fsImpl, worker }),
    getOrCreateAudio({ text: 'Concurrent text', fileName, nepali: false, fsImpl, worker })
  ]);
  assert.equal(synthesized, 1);
  assert.equal(one.audioUrl, two.audioUrl);

  const cached = await getOrCreateAudio({ text: 'Concurrent text', fileName, nepali: false, fsImpl, worker });
  assert.equal(cached.cached, true);
  assert.equal(synthesized, 1);
});

test('audio cache pruning removes expired, excess, and abandoned files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khabar-audio-'));
  const now = Date.now();
  const touch = (name, ageMs) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, 'x');
    const time = new Date(now - ageMs);
    fs.utimesSync(file, time, time);
  };
  touch('fresh-1.wav', 1000);
  touch('fresh-2.wav', 2000);
  touch('fresh-3.wav', 3000);
  touch('expired.wav', 30 * 24 * 60 * 60 * 1000);
  touch('abandoned.wav.1.2.tmp', 2 * 60 * 60 * 1000);
  touch('in-progress.wav.1.3.tmp', 1000);

  const result = pruneAudioCache({ directory, maxAgeMs: 7 * 24 * 60 * 60 * 1000, maxFiles: 2, now });
  const remaining = fs.readdirSync(directory).sort();
  fs.rmSync(directory, { recursive: true, force: true });

  assert.deepEqual(remaining, ['fresh-1.wav', 'fresh-2.wav', 'in-progress.wav.1.3.tmp']);
  assert.equal(result.removed, 3);
  assert.equal(result.kept, 2);
});

test('scraper re-validates every redirect hop', async () => {
  const visited = [];
  const fetchImpl = async (url) => {
    visited.push(url);
    return {
      status: 302,
      ok: false,
      headers: { get: (name) => (name === 'location' ? 'http://169.254.169.254/latest/meta-data' : null) }
    };
  };
  const result = await fetchFullContent('https://news.example/story', { fetchImpl, logger: { error: () => {} } });
  assert.equal(result, null);
  assert.deepEqual(visited, ['https://news.example/story'], 'the private redirect target is never requested');
});

test('scraper extracts article paragraphs from HTML', async () => {
  const paragraph = 'Nepal Rastra Bank kept the policy rate unchanged this quarter. '.repeat(6);
  const fetchImpl = async () => ({
    status: 200,
    ok: true,
    headers: { get: (name) => (name === 'content-type' ? 'text/html; charset=utf-8' : null) },
    text: async () => `<html><body><nav><p>Menu</p></nav><article><p>${paragraph}</p><p>Second paragraph.</p></article></body></html>`
  });
  const text = await fetchFullContent('https://news.example/story', { fetchImpl });
  assert.match(text, /^Nepal Rastra Bank kept the policy rate unchanged/);
  assert.match(text, /\n\nSecond paragraph\.$/);
  assert.ok(!text.includes('Menu'));
});

test('cache helpers evict least-recently-used entries and share in-flight work', async () => {
  const cache = new LruCache({ maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);

  const dedupe = createInFlightDeduper();
  let calls = 0;
  const task = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return 'done';
  };
  const results = await Promise.all([dedupe('k', task), dedupe('k', task)]);
  assert.deepEqual(results, ['done', 'done']);
  assert.equal(calls, 1);
  assert.equal(await dedupe('k', task), 'done');
  assert.equal(calls, 2, 'finished work is not cached');
});

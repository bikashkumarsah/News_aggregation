const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasDevanagari,
  isLikelyNepali
} = require('../services/languageService');
const {
  generateSummaryWithApi,
  normalizeSummaryText,
  summarizeArticle
} = require('../services/summaryService');
const {
  cleanTtsText,
  getAudioTarget,
  synthesizeAudio,
  voiceModelPath
} = require('../services/ttsService');
const Article = require('../models/Article');
const User = require('../models/User');

test('language detection handles script and known Nepali sources', () => {
  assert.equal(hasDevanagari('Market update'), false);
  assert.equal(hasDevanagari('बजार अपडेट'), true);
  assert.equal(isLikelyNepali({ text: 'English', url: 'https://onlinekhabar.com/story' }), true);
  assert.equal(isLikelyNepali({ text: 'English', url: 'https://example.com/story' }), false);
});

test('summary normalization removes list markers and repeated whitespace', () => {
  assert.equal(
    normalizeSummaryText('- First point\r\n• Second   point'),
    'First point Second point'
  );
});

test('API summarization builds a bounded request and normalizes its response', async () => {
  let request;
  const summary = await generateSummaryWithApi({
    article: { title: 'NEPSE closes higher', description: 'Market recap' },
    fullContent: 'A'.repeat(9000),
    outputLanguage: 'English',
    env: { GEMINI_API_KEY: 'test-key', SUMMARY_API_MODEL: 'test-model' },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '- Concise result' }] } }]
        })
      };
    }
  });

  assert.equal(summary, 'Concise result');
  assert.match(request.url, /test-model:generateContent/);
  const body = JSON.parse(request.options.body);
  const prompt = body.contents[0].parts[0].text;
  assert.match(prompt, /2-3 concise sentences in English/);
  assert.ok(prompt.length < 8500, 'article text is bounded before the API request');
});

test('summary fallback uses translation then summarization for English text', async () => {
  const calls = [];
  const result = await summarizeArticle({
    article: { title: 'English title', url: 'https://example.com/story' },
    fullContent: 'English article body',
    env: {},
    logger: { warn: () => {} },
    runMbartImpl: async (payload) => {
      calls.push(payload.task);
      return payload.task === 'translate_en_to_ne' ? 'नेपाली अनुवाद' : '- छोटो सारांश';
    }
  });

  assert.deepEqual(calls, ['translate_en_to_ne', 'summarize']);
  assert.equal(result, 'छोटो सारांश');
});

test('TTS helpers sanitize text, select voices, and reject unsafe paths', () => {
  assert.equal(cleanTtsText(' **Market**  _update_ ', 40), 'Market update');
  assert.match(voiceModelPath(false), /en_US-lessac-medium\.onnx$/);
  assert.match(voiceModelPath(true), /ne_NP-google-medium\.onnx$/);
  assert.equal(getAudioTarget('sample.wav').audioUrl, '/audio/sample.wav');
  assert.throws(() => getAudioTarget('../sample.wav'), /Invalid audio file name/);
});

test('shared TTS synthesis sends one bounded worker request and publishes atomically', async () => {
  let request;
  const renamed = [];
  const worker = {
    request: async (payload) => {
      request = payload;
      return { ok: true };
    }
  };
  const fsImpl = {
    mkdirSync: () => {},
    renameSync: (from, to) => renamed.push([from, to])
  };

  const target = await synthesizeAudio({
    text: '# बजार अपडेट',
    fileName: 'generated.wav',
    fsImpl,
    worker
  });

  assert.equal(target.audioUrl, '/audio/generated.wav');
  assert.equal(request.text, 'बजार अपडेट');
  assert.match(request.model_path, /ne_NP-google-medium\.onnx$/);
  assert.match(request.output_path, /generated\.wav\.\d+\.\d+\.tmp$/);
  assert.deepEqual(renamed, [[request.output_path, target.outputPath]]);
});

test('unique article and user fields declare one MongoDB index each', () => {
  const articleUrlIndexes = Article.schema.indexes()
    .filter(([fields]) => fields.url === 1);
  const userEmailIndexes = User.schema.indexes()
    .filter(([fields]) => fields.email === 1);

  assert.equal(articleUrlIndexes.length, 1);
  assert.equal(userEmailIndexes.length, 1);
  assert.equal(articleUrlIndexes[0][1].unique, true);
  assert.equal(userEmailIndexes[0][1].unique, true);
});

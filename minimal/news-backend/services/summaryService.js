const fetch = require('node-fetch');
const { isLikelyNepali } = require('./languageService');
const { runMbart } = require('./mbartService');

const normalizeSummaryText = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return '';

  return raw
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s+/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const extractGeneratedText = (payload) => (
  (payload?.candidates?.[0]?.content?.parts || [])
    .map((part) => part?.text || '')
    .join('')
    .trim()
);

const buildSummaryPrompt = ({ article = {}, fullContent = '', outputLanguage }) => [
  'You are summarizing a news article for a web app.',
  `Write exactly 2-3 concise sentences in ${outputLanguage}.`,
  'Return a single short paragraph.',
  'Do not use bullet points, headings, or filler text.',
  'Keep the summary faithful to the article and avoid adding outside facts.',
  'When natural, highlight important names, places, dates, and numbers with Markdown bold using **double asterisks**.',
  '',
  `Title: ${article.title || ''}`,
  `Description: ${article.description || ''}`,
  '',
  'Article text:',
  String(fullContent || '').slice(0, 8000)
].join('\n');

const generateSummaryWithApi = async ({
  article = {},
  fullContent = '',
  outputLanguage,
  env = process.env,
  fetchImpl = fetch
}) => {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY or GOOGLE_API_KEY for API summarizer');
  }

  const model = env.GEMINI_MODEL || env.SUMMARY_API_MODEL || 'gemini-1.5-flash';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: buildSummaryPrompt({ article, fullContent, outputLanguage }) }]
        }
      ],
      generationConfig: {
        temperature: 0.25,
        topP: 0.9,
        maxOutputTokens: 220
      }
    })
  });

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`Summary API returned invalid JSON (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Summary API request failed (${response.status})`);
  }

  const summary = normalizeSummaryText(extractGeneratedText(payload));
  if (!summary) {
    throw new Error('Summary API returned no text');
  }

  return summary;
};

const summarizeArticle = async ({
  article = {},
  fullContent = '',
  env = process.env,
  fetchImpl = fetch,
  runMbartImpl = runMbart,
  logger = console
}) => {
  const baseText = `${article.title || ''}\n${article.description || ''}\n${fullContent || ''}`.trim();
  const clipped = baseText.slice(0, 5000);
  const outputLanguage = isLikelyNepali({ text: baseText, url: article.url })
    ? 'Nepali'
    : 'English';

  try {
    return await generateSummaryWithApi({
      article,
      fullContent,
      outputLanguage,
      env,
      fetchImpl
    });
  } catch (apiError) {
    logger.warn(`API summarizer unavailable, falling back to local mBART: ${apiError.message}`);
  }

  let summaryText;
  if (outputLanguage === 'Nepali') {
    summaryText = await runMbartImpl({
      task: 'summarize',
      text: clipped,
      maxNewTokens: 160,
      maxInputTokens: 1024
    });
  } else {
    const translated = await runMbartImpl({
      task: 'translate_en_to_ne',
      text: clipped,
      maxNewTokens: 256,
      maxInputTokens: 1024
    });
    summaryText = await runMbartImpl({
      task: 'summarize',
      text: translated,
      maxNewTokens: 160,
      maxInputTokens: 1024
    });
  }

  return normalizeSummaryText(summaryText);
};

module.exports = {
  buildSummaryPrompt,
  extractGeneratedText,
  generateSummaryWithApi,
  normalizeSummaryText,
  summarizeArticle
};

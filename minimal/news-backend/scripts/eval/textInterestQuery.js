/**
 * The newsletter's previous interest profile, kept so evaluations can compare
 * against it (EVAL_INTEREST=text): up to 25 recent titles/descriptions,
 * newest repeated, concatenated into one query of at most 4,000 characters and
 * embedded once. The embedding model truncates that text at 512 tokens, so in
 * practice only the newest few reads shape it.
 */

const { textToVector } = require('../../services/qdrantService');

const MAX_ITEMS = 25;
const MAX_CHARS = 4000;

// `articles` are newest first.
const buildInterestQuery = (articles) => {
  let queryText = '';

  for (let i = 0; i < Math.min(MAX_ITEMS, articles.length); i++) {
    const article = articles[i] || {};
    const snippet = `${article.title || ''}. ${article.description || ''}`.trim();
    if (!snippet) continue;

    // Recency weighting: first few items repeated more
    const repeat = i < 3 ? 3 : i < 8 ? 2 : 1;
    for (let r = 0; r < repeat; r++) {
      if ((queryText.length + snippet.length + 2) > MAX_CHARS) break;
      queryText += (queryText ? '\n' : '') + snippet;
    }
    if (queryText.length >= MAX_CHARS) break;
  }

  return queryText;
};

// Drop-in `buildInterest` for preferenceService.recommendFromReads.
const textQueryInterest = async (reads) => {
  const queryText = buildInterestQuery(reads.map((item) => item.article));
  return queryText ? textToVector(queryText, { role: 'query' }) : null;
};

// `buildInterest` option for an EVAL_INTEREST value (undefined = production default).
const interestBuilderFor = (name = 'vector') => {
  if (name === 'vector') return undefined;
  if (name === 'text') return textQueryInterest;
  throw new Error(`Unknown EVAL_INTEREST "${name}" (use "vector" or "text")`);
};

module.exports = { buildInterestQuery, interestBuilderFor, textQueryInterest };

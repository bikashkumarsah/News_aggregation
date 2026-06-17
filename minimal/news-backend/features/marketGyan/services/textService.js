const crypto = require('crypto');
const cheerio = require('cheerio');

const cleanText = (value) => {
    const raw = String(value || '');
    const $ = cheerio.load(raw);
    $('script, style, noscript, iframe, svg').remove();

    return $.root()
        .text()
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const truncateAtWord = (value, maxLength = 1500) => {
    const text = cleanText(value);
    if (text.length <= maxLength) return text;
    if (maxLength <= 3) return text.slice(0, maxLength);
    const contentLimit = maxLength - 3;
    const truncated = text.slice(0, contentLimit + 1);
    const lastSpace = truncated.lastIndexOf(' ');
    const end = lastSpace > contentLimit * 0.8 ? lastSpace : contentLimit;
    return `${truncated.slice(0, end).trim()}...`;
};

const contentHash = (...parts) => crypto
    .createHash('sha256')
    .update(parts.map((part) => String(part || '')).join('\n'))
    .digest('hex');

const detectLanguage = (text) => {
    const value = String(text || '');
    const devanagari = (value.match(/[\u0900-\u097F]/g) || []).length;
    const latin = (value.match(/[A-Za-z]/g) || []).length;
    if (devanagari && latin) return 'mixed';
    if (devanagari) return 'ne';
    return 'en';
};

const normalizeForEvidence = (text) => String(text || '')
    .normalize('NFKC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

module.exports = {
    cleanText,
    contentHash,
    detectLanguage,
    normalizeForEvidence,
    truncateAtWord
};

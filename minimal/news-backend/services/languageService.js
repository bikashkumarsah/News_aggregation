const NEPALI_SOURCE_PATTERN = /(onlinekhabar\.com|ratopati\.com|setopati\.com|nagariknews\.com|\.np)/i;

const hasDevanagari = (text = '') => /[\u0900-\u097F]/u.test(String(text));

const isLikelyNepali = ({ text = '', url = '' } = {}) => (
  hasDevanagari(text) || NEPALI_SOURCE_PATTERN.test(String(url))
);

module.exports = {
  hasDevanagari,
  isLikelyNepali
};

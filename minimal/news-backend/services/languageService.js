// Hosts that publish primarily in Nepali. English editions of the same
// outlets (english.onlinekhabar.com, ...) are excluded below.
const NEPALI_SOURCE_HOST_PATTERN = /(^|\.)(onlinekhabar\.com|ratopati\.com|setopati\.com|nagariknews\.com)$|\.np$/i;

const hasDevanagari = (text = '') => /[\u0900-\u097F]/u.test(String(text));

const hostnameOf = (url) => {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const isNepaliSourceUrl = (url = '') => {
  const host = hostnameOf(url);
  if (!host || host.startsWith('english.')) return false;
  return NEPALI_SOURCE_HOST_PATTERN.test(host);
};

const isLikelyNepali = ({ text = '', url = '' } = {}) => (
  hasDevanagari(text) || isNepaliSourceUrl(url)
);

module.exports = {
  hasDevanagari,
  isLikelyNepali,
  isNepaliSourceUrl
};

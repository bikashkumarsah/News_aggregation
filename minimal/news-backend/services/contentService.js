const net = require('net');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_REDIRECTS = 5;
const CONTENT_SELECTORS = [
  'article',
  '[itemprop="articleBody"]',
  '.article-body',
  '.post-content',
  '.entry-content',
  'main',
  '.content'
];

const isPrivateIPv4 = (host) => {
  const [a, b] = host.split('.').map(Number);
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
};

const isPrivateIPv6 = (host) => {
  const value = host.toLowerCase();
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice(7);
    return net.isIPv4(mapped) ? isPrivateIPv4(mapped) : true;
  }
  return value === '::'
    || value === '::1'
    || value.startsWith('fc')
    || value.startsWith('fd')
    || value.startsWith('fe80');
};

const isPrivateHost = (hostname) => {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return true;
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) return isPrivateIPv4(host);
  if (ipVersion === 6) return isPrivateIPv6(host);
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal');
};

// Article pages are fetched server-side, so only public http(s) URLs are
// allowed; this keeps the scraper from being pointed at internal services.
const isFetchableUrl = (value) => {
  try {
    const url = new URL(String(value));
    return (url.protocol === 'http:' || url.protocol === 'https:') && !isPrivateHost(url.hostname);
  } catch {
    return false;
  }
};

const extractArticleText = (html) => {
  const $ = cheerio.load(String(html || ''));

  // Remove unwanted elements
  $('script, style, nav, footer, header, aside, .ads, .comments').remove();

  // Try to find the main content area
  let content = '';
  for (const selector of CONTENT_SELECTORS) {
    const el = $(selector);
    if (el.length > 0) {
      content = el.find('p').map((i, p) => $(p).text().trim()).get().filter(Boolean).join('\n\n');
      if (content.length > 300) break;
    }
  }

  // Fallback: just get all P tags if no specific container found
  if (content.length < 300) {
    content = $('p').map((i, p) => $(p).text().trim()).get().filter(Boolean).join('\n\n');
  }

  return content.trim();
};

const fetchFullContent = async (url, {
  fetchImpl = fetch,
  timeoutMs = 10000,
  maxBytes = 3 * 1024 * 1024,
  logger = console
} = {}) => {
  let currentUrl = String(url || '');
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isFetchableUrl(currentUrl)) return null;

      // Redirects are followed manually so every hop is re-validated.
      const response = await fetchImpl(currentUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'
        },
        redirect: 'manual',
        timeout: timeoutMs,
        size: maxBytes
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      if (!response.ok) return null;

      const contentType = response.headers.get('content-type') || '';
      if (contentType && !/html|xml|text/i.test(contentType)) return null;

      return extractArticleText(await response.text()) || null;
    }
    return null;
  } catch (error) {
    logger.error?.(`Scraping failed for ${url}: ${error.message}`);
    return null;
  }
};

module.exports = {
  extractArticleText,
  fetchFullContent,
  isFetchableUrl,
  isPrivateHost
};

const Parser = require('rss-parser');
const cheerio = require('cheerio');
const { createHttpClient } = require('./httpClient');
const { cleanText, contentHash, detectLanguage } = require('../services/textService');

const parser = new Parser({
    timeout: 20000,
    customFields: {
        item: ['content:encoded']
    }
});

const ONLINEKHABAR_FEED_URL = 'https://www.onlinekhabar.com/content/business/feed';
const KATHMANDU_POST_MONEY_URL = 'https://kathmandupost.com/money';
const KATHMANDU_POST_RSS_URL = 'https://kathmandupost.com/rss';
const SHARE_SANSAR_CATEGORIES = Object.freeze([
    'nepse-news',
    'ipo-fpo-news',
    'share-allotment',
    'proposed-dividend',
    'financial-analysis',
    'share-listed',
    'stock-market'
]);
const MIN_ARTICLE_CHARS = 120;

const withinRange = (date, from, to) => {
    const value = new Date(date);
    if (Number.isNaN(value.getTime())) return false;
    return value >= new Date(from) && value <= new Date(`${to}T23:59:59.999Z`);
};

const parseCalendarDate = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return parsed;
    return new Date(Date.UTC(
        parsed.getFullYear(),
        parsed.getMonth(),
        parsed.getDate()
    ));
};

const parseDateFromUrl = (url) => {
    const match = String(url || '').match(/\/(20\d{2})\/(\d{2})\/(\d{2})(?:\/|$)/);
    if (!match) return null;
    const [, year, month, day] = match;
    const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const extractParagraphText = (html, selectors) => {
    const $ = cheerio.load(html);
    for (const selector of selectors) {
        const paragraphs = $(selector)
            .map((_, node) => cleanText($(node).text()))
            .get()
            .filter(Boolean);
        if (paragraphs.length) return cleanText(paragraphs.join(' '));
    }
    return '';
};

const parseFeed = (xml) => parser.parseString(xml);

const oldestTimestamp = (items) => {
    const values = items
        .map((item) => new Date(item.isoDate || item.pubDate || item.publishedAt).getTime())
        .filter(Number.isFinite);
    return values.length ? Math.min(...values) : null;
};

const collectOnlineKhabarBusiness = async ({
    from,
    to,
    httpClient = createHttpClient(),
    parseFeedXml = parseFeed,
    startPage = 1,
    maxPages = 100,
    limit = Number.MAX_SAFE_INTEGER
}) => {
    const candidates = new Map();
    const visitedFirstLinks = new Set();
    const firstPage = Math.max(1, Number(startPage) || 1);
    const maximumPages = Math.max(1, Number(maxPages) || 1);

    for (let page = firstPage; page < firstPage + maximumPages; page += 1) {
        const feedUrl = page === 1
            ? ONLINEKHABAR_FEED_URL
            : `${ONLINEKHABAR_FEED_URL}?paged=${page}`;
        let feed;
        try {
            feed = await parseFeedXml(await httpClient.request(feedUrl), feedUrl);
        } catch (error) {
            if (page === firstPage) throw error;
            break;
        }

        const feedItems = feed.items || [];
        if (!feedItems.length) break;
        const firstLink = feedItems[0]?.link;
        if (firstLink && visitedFirstLinks.has(firstLink)) break;
        if (firstLink) visitedFirstLinks.add(firstLink);

        for (const item of feedItems) {
            const publishedAt = item.isoDate || item.pubDate;
            if (!item.link || !withinRange(publishedAt, from, to)) continue;
            candidates.set(item.link, {
                item,
                feedTitle: feed.title
            });
        }

        if (candidates.size >= Number(limit)) break;
        const oldest = oldestTimestamp(feedItems);
        if (oldest !== null && oldest < new Date(from).getTime()) break;
    }

    const items = [];
    for (const { item, feedTitle } of Array.from(candidates.values()).slice(0, Number(limit))) {
        const fallbackContent = cleanText(
            item['content:encoded'] || item.content || item.contentSnippet || item.description
        );
        let content = fallbackContent;
        try {
            const html = await httpClient.request(item.link);
            content = extractParagraphText(html, [
                '.ok18-single-post-content-wrap p',
                '.entry-content p'
            ]) || fallbackContent;
        } catch {
            // Keep the public RSS excerpt when a detail page is temporarily unavailable.
        }
        items.push({
            kind: 'financial_news',
            sourceId: item.guid || item.link,
            title: cleanText(item.title),
            url: item.link,
            sourceName: feedTitle || 'OnlineKhabar Business',
            section: 'Business',
            publishedAt: new Date(item.isoDate || item.pubDate),
            language: detectLanguage(`${item.title} ${content}`),
            description: cleanText(item.contentSnippet || item.description).slice(0, 500),
            content: content.slice(0, 10000),
            extractionMethod: 'html'
        });
    }
    return items.filter((item) => (
        item.title && item.url && item.content.length >= MIN_ARTICLE_CHARS
    ));
};

const parseKathmanduPostListing = (html, sourceUrl = KATHMANDU_POST_MONEY_URL) => {
    const $ = cheerio.load(html);
    const candidates = [];

    $('article, .article-image, .block--morenews, .row--article').each((_, node) => {
        const link = $(node).find('a[href*="/money/"]').first();
        const href = link.attr('href');
        const url = href ? new URL(href, sourceUrl).toString() : null;
        const title = cleanText(
            $(node).find('h2, h3, h4').first().text() || link.attr('title') || link.text()
        );
        const dateText = cleanText($(node).find('time, .published-on, .date').first().text());
        const publishedAt = parseDateFromUrl(url)
            || (dateText ? parseCalendarDate(dateText) : null);
        if (!href || !title) return;

        candidates.push({
            kind: 'financial_news',
            sourceId: href,
            title,
            url,
            sourceName: 'The Kathmandu Post - Money',
            section: 'Money',
            publishedAt,
            language: 'en',
            description: cleanText($(node).find('p').first().text()).slice(0, 500),
            content: cleanText($(node).find('p').text()).slice(0, 10000),
            extractionMethod: 'html'
        });
    });
    return candidates;
};

const collectKathmanduPostMoney = async ({
    from,
    to,
    httpClient = createHttpClient(),
    parseFeedXml = parseFeed,
    limit = Number.MAX_SAFE_INTEGER
}) => {
    const candidates = new Map();
    const listing = await httpClient.request(KATHMANDU_POST_MONEY_URL);
    for (const item of parseKathmanduPostListing(listing)) {
        if (withinRange(item.publishedAt, from, to)) candidates.set(item.url, item);
    }

    try {
        const feed = await parseFeedXml(
            await httpClient.request(KATHMANDU_POST_RSS_URL),
            KATHMANDU_POST_RSS_URL
        );
        for (const item of feed.items || []) {
            if (!String(item.link || '').includes('/money/')) continue;
            const publishedAt = item.isoDate || item.pubDate || parseDateFromUrl(item.link);
            if (!withinRange(publishedAt, from, to)) continue;
            candidates.set(item.link, {
                kind: 'financial_news',
                sourceId: item.guid || item.link,
                title: cleanText(item.title),
                url: item.link,
                sourceName: 'The Kathmandu Post - Money',
                section: 'Money',
                publishedAt: new Date(publishedAt),
                language: 'en',
                description: cleanText(item.contentSnippet || item.description).slice(0, 500),
                content: cleanText(
                    item['content:encoded'] || item.content || item.contentSnippet || item.description
                ).slice(0, 10000),
                extractionMethod: 'html'
            });
        }
    } catch {
        // The Money landing page remains usable when the general RSS feed is unavailable.
    }

    const items = [];
    for (const item of Array.from(candidates.values()).slice(0, Number(limit))) {
        try {
            const articleHtml = await httpClient.request(item.url);
            const content = extractParagraphText(articleHtml, ['.story-section p']);
            items.push({
                ...item,
                content: (content || item.content).slice(0, 10000)
            });
        } catch {
            items.push(item);
        }
    }
    return items.filter((item) => (
        item.title && item.url && item.content.length >= MIN_ARTICLE_CHARS
    ));
};

const parseShareSansarList = (html, sourceUrl, category) => {
    const $ = cheerio.load(html);
    const items = [];
    $('.newslist .featured-news-list, .featured-news-list').each((_, node) => {
        const link = $(node).find('a[href*="/newsdetail/"][title]').first();
        const href = link.attr('href');
        const title = cleanText(link.attr('title') || link.text());
        const publishedAt = parseCalendarDate($(node).find('.text-org').first().text());
        if (!href || !title || Number.isNaN(publishedAt.getTime())) return;
        items.push({
            kind: 'financial_news',
            sourceId: href,
            title,
            url: new URL(href, sourceUrl).toString(),
            sourceName: 'ShareSansar',
            section: category,
            publishedAt,
            language: 'en',
            description: cleanText($(node).find('p').last().text()).slice(0, 500),
            content: '',
            extractionMethod: 'html'
        });
    });
    const nextHref = $('a[rel="next"]').first().attr('href');
    return {
        items: Array.from(new Map(items.map((item) => [item.url, item])).values()),
        nextUrl: nextHref ? new URL(nextHref, sourceUrl).toString() : null
    };
};

const parseShareSansarArticle = (html, fallback) => {
    const $ = cheerio.load(html);
    const title = cleanText($('.detail h1, h1').first().text()) || fallback.title;
    const dateText = cleanText($('.detail h5').first().text())
        .replace(/\bon\b.*$/i, '')
        .trim();
    const parsedDate = new Date(dateText);
    const content = extractParagraphText(html, ['#newsdetail-content p']);
    return {
        ...fallback,
        title,
        publishedAt: Number.isNaN(parsedDate.getTime())
            ? fallback.publishedAt
            : parsedDate,
        content: content.slice(0, 10000)
    };
};

const collectShareSansarNews = async ({
    from,
    to,
    httpClient = createHttpClient(),
    categories = SHARE_SANSAR_CATEGORIES,
    maxPages = 80,
    limit = Number.MAX_SAFE_INTEGER
}) => {
    const candidates = new Map();
    const maximumPages = Math.max(1, Number(maxPages) || 1);

    for (const category of categories) {
        let pageUrl = `https://www.sharesansar.com/category/${category}`;
        const visited = new Set();
        for (let page = 1; page <= maximumPages && pageUrl; page += 1) {
            if (visited.has(pageUrl)) break;
            visited.add(pageUrl);
            let parsed;
            try {
                parsed = parseShareSansarList(
                    await httpClient.request(pageUrl),
                    pageUrl,
                    category
                );
            } catch (error) {
                if (page === 1) throw error;
                break;
            }
            if (!parsed.items.length) break;
            for (const item of parsed.items) {
                if (!withinRange(item.publishedAt, from, to)) continue;
                const existing = candidates.get(item.url);
                if (existing) {
                    existing.sections = Array.from(new Set([
                        ...(existing.sections || [existing.section]),
                        category
                    ]));
                } else {
                    candidates.set(item.url, {
                        ...item,
                        sections: [category]
                    });
                }
            }
            if (candidates.size >= Number(limit)) break;
            const oldest = oldestTimestamp(parsed.items);
            if (oldest !== null && oldest < new Date(from).getTime()) break;
            pageUrl = parsed.nextUrl;
        }
        if (candidates.size >= Number(limit)) break;
    }

    const items = [];
    for (const item of Array.from(candidates.values()).slice(0, Number(limit))) {
        try {
            items.push(parseShareSansarArticle(
                await httpClient.request(item.url),
                item
            ));
        } catch {
            items.push(item);
        }
    }
    return items.filter((item) => (
        item.title && item.url && item.content.length >= MIN_ARTICLE_CHARS
    ));
};

const parseSebonList = (html, sourceUrl) => {
    const $ = cheerio.load(html);
    const items = [];
    $('table tbody tr').each((_, row) => {
        const cells = $(row).find('td');
        const title = cleanText(cells.eq(0).text());
        const dateText = cleanText(cells.eq(1).text());
        $(row).find('a[href$=".pdf"], a[href*=".pdf?"]').each((__, link) => {
            const href = $(link).attr('href');
            if (!href || !title) return;
            items.push({
                kind: 'regulatory_notice',
                sourceId: href,
                title,
                url: new URL(href, sourceUrl).toString(),
                pageUrl: sourceUrl,
                sourceName: 'SEBON',
                publishedAt: parseCalendarDate(dateText),
                language: detectLanguage(`${title} ${$(link).text()}`),
                extractionMethod: 'pdf_text'
            });
        });
    });
    return items;
};

const parseNrbList = (html, sourceUrl) => {
    const $ = cheerio.load(html);
    const items = [];
    $('ul.arrowed-list li').each((_, node) => {
        const link = $(node).find('a[href]').first();
        const href = link.attr('href');
        const title = cleanText(link.text());
        const dateText = cleanText(
            $(node).find(
                '.mr-3.text-muted, .font-size-xs .text-muted, .text-muted'
            ).first().text()
        );
        const isPdf = $(node).find('.icon-pdf').length > 0
            || /\.pdf(?:$|\?)/i.test(href || '');
        if (!href || !title || !isPdf) return;
        items.push({
            kind: 'policy_document',
            sourceId: href,
            title,
            url: new URL(href, sourceUrl).toString(),
            pageUrl: new URL(href, sourceUrl).toString(),
            sourceName: 'Nepal Rastra Bank',
            publishedAt: dateText ? parseCalendarDate(dateText) : new Date(NaN),
            language: detectLanguage(title),
            extractionMethod: 'pdf_text'
        });
    });
    return items;
};

const parsePdfAttachments = (html, pageUrl, item) => {
    const $ = cheerio.load(html);
    const attachments = [];
    $('a[href$=".pdf"], a[href*=".pdf?"]').each((_, link) => {
        const href = $(link).attr('href');
        if (!href) return;
        attachments.push({
            ...item,
            sourceId: href,
            url: new URL(href, pageUrl).toString(),
            pageUrl
        });
    });
    return Array.from(new Map(attachments.map((entry) => [entry.url, entry])).values());
};

const extractPdfText = async (buffer, {
    pdfParser
} = {}) => {
    const parse = pdfParser || require('pdf-parse');
    const result = await parse(buffer);
    return cleanText(result.text);
};

const assessPdfText = (title, text) => {
    if (!text) {
        return {
            usable: false,
            error: 'PDF contained no machine-readable text'
        };
    }
    const titleHasDevanagari = /[\u0900-\u097F]/.test(String(title || ''));
    const devanagariCharacters = (text.match(/[\u0900-\u097F]/g) || []).length;
    if (titleHasDevanagari && devanagariCharacters < 10) {
        return {
            usable: false,
            error: 'PDF text uses an unsupported legacy Nepali font encoding'
        };
    }
    return { usable: true, error: null };
};

const normalizeHttpResult = (result, fallbackUrl) => {
    if (Buffer.isBuffer(result)) {
        return {
            body: result,
            url: fallbackUrl,
            contentType: ''
        };
    }
    return result;
};

const isPdfResponse = ({ body, contentType }) => (
    String(contentType || '').toLowerCase().includes('application/pdf')
    || Buffer.from(body).subarray(0, 4).toString('ascii') === '%PDF'
);

const fetchRegulatoryPdfItems = async (item, httpClient) => {
    const initial = normalizeHttpResult(await httpClient.request(item.url, {
        responseType: 'buffer',
        returnMetadata: true
    }), item.url);
    if (isPdfResponse(initial)) {
        return [{
            ...item,
            sourceId: initial.url,
            url: initial.url,
            pageUrl: item.pageUrl || item.url,
            buffer: initial.body
        }];
    }

    const attachments = parsePdfAttachments(
        Buffer.from(initial.body).toString('utf8'),
        initial.url || item.url,
        item
    );
    const resolved = [];
    for (const attachment of attachments) {
        const response = normalizeHttpResult(await httpClient.request(attachment.url, {
            responseType: 'buffer',
            returnMetadata: true
        }), attachment.url);
        if (!isPdfResponse(response)) continue;
        resolved.push({
            ...attachment,
            sourceId: response.url,
            url: response.url,
            buffer: response.body
        });
    }
    return resolved;
};

const collectRegulatoryDocuments = async ({
    from,
    to,
    httpClient = createHttpClient(),
    maxPages = 50,
    limit = Number.MAX_SAFE_INTEGER,
    pdfParser
} = {}) => {
    const definitions = [
        {
            sourceUrl: 'https://www.sebon.gov.np/notices',
            pageUrl: (page) => `https://www.sebon.gov.np/notices?page=${page}`,
            parse: parseSebonList
        },
        {
            sourceUrl: 'https://www.nrb.org.np/category/monetary-policy/',
            pageUrl: (page) => `https://www.nrb.org.np/category/monetary-policy/page/${page}/`,
            parse: parseNrbList
        },
        {
            sourceUrl: 'https://www.nrb.org.np/category/notices/',
            pageUrl: (page) => `https://www.nrb.org.np/category/notices/page/${page}/`,
            parse: parseNrbList
        }
    ];
    const items = [];

    for (const definition of definitions) {
        for (let page = 1; page <= Number(maxPages); page += 1) {
            const pageUrl = page === 1 ? definition.sourceUrl : definition.pageUrl(page);
            let html;
            try {
                html = await httpClient.request(pageUrl);
            } catch (error) {
                if (page === 1) throw error;
                break;
            }
            const pageItems = definition.parse(html, pageUrl);
            const inRange = pageItems.filter((item) => withinRange(item.publishedAt, from, to));
            items.push(...inRange);
            if (!pageItems.length || items.length >= Number(limit)) break;
            const oldest = oldestTimestamp(pageItems);
            if (oldest !== null && oldest < new Date(from).getTime()) break;
        }
        if (items.length >= Number(limit)) break;
    }

    const unique = Array.from(new Map(items.map((item) => [item.url, item])).values())
        .slice(0, Number(limit));
    const extracted = [];
    for (const item of unique) {
        try {
            const pdfItems = await fetchRegulatoryPdfItems(item, httpClient);
            if (!pdfItems.length) throw new Error('No public PDF attachment was found');
            for (const pdfItem of pdfItems) {
                const text = await extractPdfText(pdfItem.buffer, { pdfParser });
                const quality = assessPdfText(pdfItem.title, text);
                extracted.push({
                    ...pdfItem,
                    buffer: undefined,
                    content: quality.usable ? text.slice(0, 50000) : '',
                    contentHash: quality.usable ? contentHash(pdfItem.title, text) : undefined,
                    ingestionStatus: quality.usable ? 'complete' : 'failed',
                    extractionError: quality.error
                });
            }
        } catch (error) {
            extracted.push({
                ...item,
                content: '',
                ingestionStatus: 'failed',
                extractionError: error.message
            });
        }
    }
    return extracted;
};

module.exports = {
    KATHMANDU_POST_MONEY_URL,
    KATHMANDU_POST_RSS_URL,
    MIN_ARTICLE_CHARS,
    ONLINEKHABAR_FEED_URL,
    SHARE_SANSAR_CATEGORIES,
    assessPdfText,
    collectKathmanduPostMoney,
    collectOnlineKhabarBusiness,
    collectRegulatoryDocuments,
    collectShareSansarNews,
    extractParagraphText,
    extractPdfText,
    fetchRegulatoryPdfItems,
    parseCalendarDate,
    parseDateFromUrl,
    parseKathmanduPostListing,
    parseNrbList,
    parsePdfAttachments,
    parseSebonList,
    parseShareSansarArticle,
    parseShareSansarList,
    withinRange
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    parseMeroLaganiHtml,
    parseSectorRows,
    parseShareSansarHistory,
    parseShareSansarHtml
} = require('../collectors/marketParsers');
const {
    collectShareSansarHistory,
    splitDateRange
} = require('../collectors/marketCollectors');
const {
    assessPdfText,
    collectKathmanduPostMoney,
    collectOnlineKhabarBusiness,
    collectShareSansarNews,
    extractParagraphText,
    extractPdfText,
    fetchRegulatoryPdfItems,
    parseNrbList,
    parseDateFromUrl,
    parseSebonList,
    parseShareSansarList
} = require('../collectors/documentCollectors');
const {
    reconcileField,
    reconcileMarketSources,
    buildSectorsFromSecurities
} = require('../services/marketReconciliationService');

const fixture = (name) => fs.readFileSync(
    path.join(__dirname, 'fixtures', name),
    'utf8'
);

test('ShareSansar parser extracts deterministic securities and registry data', () => {
    const result = parseShareSansarHtml(fixture('sharesansar-today.html'));

    assert.equal(result.metrics.turnoverAmount, 50000000);
    assert.equal(result.metrics.volume, 10000);
    assert.equal(result.securities[0].symbol, 'NABIL');
    assert.equal(result.securities[0].changePercent, 0.99);
    assert.equal(result.registry[0].name, 'Nabil Bank Limited');
});

test('MeroLagani parser extracts values without model inference', () => {
    const result = parseMeroLaganiHtml(fixture('merolagani-today.html'));

    assert.equal(result.metrics.turnoverAmount, 50100000);
    assert.equal(result.securities[0].lastTradedPrice, 510.1);
    assert.equal(result.securities[0].volume, 10050);
});

test('sector table parser extracts deterministic sector movement', () => {
    const cheerio = require('cheerio');
    const $ = cheerio.load(`
        <table>
          <thead><tr><th>Sector</th><th>Current</th><th>Change</th><th>% Change</th></tr></thead>
          <tbody><tr><td>Banking</td><td>1,500</td><td>10</td><td>0.67</td></tr></tbody>
        </table>
    `);
    const sectors = parseSectorRows($);
    assert.equal(sectors[0].name, 'Banking');
    assert.equal(sectors[0].changePercent, 0.67);
});

test('ShareSansar parser tags securities with their sector section header', () => {
    const html = `
      <html><body>
      <table id="headFixed">
        <thead><tr>
          <th>S.No</th><th>Symbol</th><th>Conf.</th><th>Open</th><th>High</th>
          <th>Low</th><th>Close</th><th>LTP</th><th>Close - LTP</th>
          <th>Close - LTP %</th><th>VWAP</th><th>Vol</th><th>Prev. Close</th>
          <th>Turnover</th><th>Trans.</th><th>Diff</th><th>Range</th><th>Diff %</th>
        </tr></thead>
        <tbody>
          <tr><td colspan="18">Commercial Banks</td></tr>
          <tr>
            <td>1</td><td><a href="/company/nabil" title="Nabil Bank Limited">NABIL</a></td>
            <td>33</td><td>505</td><td>520</td><td>500</td><td>510</td><td>510</td>
            <td>0</td><td>0</td><td>508</td><td>10,000</td><td>505</td>
            <td>5,000,000</td><td>100</td><td>5</td><td>20</td><td>1.50</td>
          </tr>
          <tr><td colspan="18">Hydro Power</td></tr>
          <tr>
            <td>2</td><td><a href="/company/uppw" title="Upper Power">UPPW</a></td>
            <td>33</td><td>300</td><td>320</td><td>290</td><td>295</td><td>295</td>
            <td>0</td><td>0</td><td>298</td><td>8,000</td><td>300</td>
            <td>2,400,000</td><td>80</td><td>-5</td><td>30</td><td>-2.00</td>
          </tr>
        </tbody>
      </table>
      </body></html>`;
    const result = parseShareSansarHtml(html);
    const bySymbol = Object.fromEntries(result.securities.map((s) => [s.symbol, s]));
    assert.equal(bySymbol.NABIL.sector, 'Banking');
    assert.equal(bySymbol.UPPW.sector, 'Hydropower');
});

test('sector movement is derived from constituent securities when no sub-index table exists', () => {
    const sectors = buildSectorsFromSecurities([
        {
            sourceName: 'ShareSansar',
            securities: [
                { symbol: 'NABIL', sector: 'Banking', changePercent: 1.5 },
                { symbol: 'SCB', sector: 'Banking', changePercent: 0.5 },
                { symbol: 'UPPW', sector: 'Hydropower', changePercent: -2 }
            ]
        }
    ]);
    const banking = sectors.find((sector) => sector.name === 'Banking');
    const hydro = sectors.find((sector) => sector.name === 'Hydropower');
    assert.equal(banking.changePercent, 1);
    assert.equal(banking.constituents, 2);
    assert.equal(banking.sentiment, 'bullish');
    assert.equal(banking.basis, 'constituent_average');
    assert.equal(hydro.sentiment, 'bearish');
});

test('reconciliation falls back to constituent sector movement', () => {
    const snapshot = reconcileMarketSources([
        {
            sourceName: 'ShareSansar',
            sourceUrl: 'https://sharesansar.com',
            metrics: { close: 2500, change: 10, changePercent: 0.4, turnoverAmount: 50000000 },
            securities: [
                { symbol: 'NABIL', sector: 'Banking', changePercent: 1.5 },
                { symbol: 'UPPW', sector: 'Hydropower', changePercent: -2 }
            ]
        }
    ]);
    const banking = snapshot.sectors.find((sector) => sector.name === 'Banking');
    assert.ok(banking, 'expected a derived Banking sector');
    assert.equal(banking.basis, 'constituent_average');
    assert.ok(!snapshot.quality.missingFields.includes('sectors'));
});

test('finance article helpers derive canonical dates and full paragraph text', () => {
    assert.equal(
        parseDateFromUrl('https://kathmandupost.com/money/2026/06/02/example').toISOString(),
        '2026-06-02T00:00:00.000Z'
    );
    assert.equal(
        extractParagraphText(
            '<div class="story-section"><p>First paragraph.</p><p>Second paragraph.</p></div>',
            ['.story-section p']
        ),
        'First paragraph. Second paragraph.'
    );
});

test('word truncation never exceeds the API excerpt limit', () => {
    const { truncateAtWord } = require('../services/textService');
    const excerpt = truncateAtWord('market '.repeat(400), 1500);

    assert.ok(excerpt.length <= 1500);
    assert.ok(excerpt.endsWith('...'));
});

test('Kathmandu Post collector uses URL dates and full detail text', async () => {
    const listing = `
        <article>
          <a href="/money/2026/06/02/example-story"><h2>Example story</h2></a>
          <p>Listing excerpt.</p>
        </article>`;
    const article = `<div class="story-section"><p>${'Full article paragraph with market context. '.repeat(4)}</p></div>`;
    const rows = await collectKathmanduPostMoney({
        from: '2026-06-01',
        to: '2026-06-03',
        httpClient: {
            request: async (url) => url.endsWith('/money') ? listing : article
        }
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].publishedAt.toISOString(), '2026-06-02T00:00:00.000Z');
    assert.equal(
        rows[0].content,
        'Full article paragraph with market context. '.repeat(4).trim()
    );
});

test('OnlineKhabar collector upgrades RSS excerpts with full detail text', async () => {
    const requested = [];
    const rows = await collectOnlineKhabarBusiness({
        from: '2026-06-11',
        to: '2026-06-11',
        maxPages: 2,
        parseFeedXml: async () => ({
            title: 'OnlineKhabar',
            items: [{
                title: 'Finance story',
                link: 'https://www.onlinekhabar.com/2026/06/1/story',
                guid: 'story-1',
                isoDate: '2026-06-11T10:00:00.000Z',
                contentSnippet: 'Short excerpt.'
            }]
        }),
        httpClient: {
            request: async (url) => {
                requested.push(url);
                return url.includes('/feed')
                    ? '<rss />'
                    : (
                `<div class="ok18-single-post-content-wrap"><p>${'Full Nepali finance article text. '.repeat(5)}</p></div>`
                    );
            }
        }
    });

    assert.equal(rows.length, 1);
    assert.equal(
        rows[0].content,
        'Full Nepali finance article text. '.repeat(5).trim()
    );
    assert.ok(requested.some((url) => url.includes('paged=2')));
});

test('OnlineKhabar archive traversal stops after crossing the requested start date', async () => {
    const feeds = [];
    const rows = await collectOnlineKhabarBusiness({
        from: '2026-01-01',
        to: '2026-06-13',
        maxPages: 20,
        parseFeedXml: async (_xml, url) => {
            feeds.push(url);
            const page = Number(new URL(url).searchParams.get('paged') || 1);
            return {
                title: 'OnlineKhabar',
                items: [{
                    title: `Page ${page}`,
                    link: `https://www.onlinekhabar.com/2026/0${page}/01/story-${page}`,
                    guid: `story-${page}`,
                    isoDate: page === 3
                        ? '2025-12-31T00:00:00.000Z'
                        : `2026-0${page}-01T00:00:00.000Z`,
                    contentSnippet: 'Market text.'
                }]
            };
        },
        httpClient: {
            request: async (url) => url.includes('/feed')
                ? '<rss />'
                : `<div class="entry-content"><p>${'Full market text. '.repeat(10)}</p></div>`
        }
    });

    assert.equal(feeds.length, 3);
    assert.equal(rows.length, 2);
});

test('OnlineKhabar archive traversal resumes from an explicit page', async () => {
    const feeds = [];
    await collectOnlineKhabarBusiness({
        from: '2025-01-01',
        to: '2026-06-15',
        startPage: 12,
        maxPages: 2,
        parseFeedXml: async (_xml, url) => {
            feeds.push(url);
            const page = Number(new URL(url).searchParams.get('paged'));
            return {
                title: 'OnlineKhabar',
                items: [{
                    title: `Page ${page}`,
                    link: `https://www.onlinekhabar.com/2026/05/01/story-${page}`,
                    guid: `story-${page}`,
                    isoDate: '2026-05-01T00:00:00.000Z',
                    contentSnippet: 'Market text.'
                }]
            };
        },
        httpClient: {
            request: async (url) => url.includes('/feed')
                ? '<rss />'
                : `<div class="entry-content"><p>${'Full market text. '.repeat(10)}</p></div>`
        }
    });

    assert.deepEqual(feeds.map((url) => (
        Number(new URL(url).searchParams.get('paged'))
    )), [12, 13]);
});

test('ShareSansar list parser scopes archive rows and exposes the next cursor', () => {
    const result = parseShareSansarList(
        fixture('sharesansar-news-page-1.html'),
        'https://www.sharesansar.com/category/nepse-news',
        'nepse-news'
    );

    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].title, 'NEPSE closes higher');
    assert.match(result.nextUrl, /cursor=next-page/);
});

test('ShareSansar collector follows cursors and deduplicates cross-category articles', async () => {
    const requested = [];
    const rows = await collectShareSansarNews({
        from: '2026-01-01',
        to: '2026-06-13',
        categories: ['nepse-news', 'stock-market'],
        maxPages: 3,
        httpClient: {
            request: async (url) => {
                requested.push(url);
                if (url.includes('/newsdetail/')) {
                    return fixture('sharesansar-news-article.html');
                }
                if (url.includes('cursor=next-page')) {
                    return fixture('sharesansar-news-page-2.html');
                }
                return fixture('sharesansar-news-page-1.html');
            }
        }
    });

    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map((row) => row.url)).size, 3);
    assert.equal(
        rows[0].content,
        'The market index increased after banking shares advanced. '
        + 'The turnover improved and the banking sub-index closed higher. '
        + 'Investors traded actively throughout the session.'
    );
    assert.ok(requested.some((url) => url.includes('cursor=next-page')));
});

test('fallback disagreement is withheld rather than averaged', () => {
    const result = reconcileField([
        { sourceName: 'ShareSansar', metrics: { close: 2500 } },
        { sourceName: 'MeroLagani', metrics: { close: 2600 } }
    ], 'close');

    assert.equal(result.value, null);
    assert.equal(result.conflict.resolution, 'withheld');
});

test('official NEPSE wins while disagreement remains auditable', () => {
    const snapshot = reconcileMarketSources([
        {
            sourceName: 'NEPSE',
            sourceUrl: 'https://nepalstock.com',
            metrics: {
                close: 2500,
                change: 10,
                changePercent: 0.4,
                turnoverAmount: 50000000
            }
        },
        {
            sourceName: 'ShareSansar',
            sourceUrl: 'https://sharesansar.com',
            metrics: {
                close: 2600,
                change: 10,
                changePercent: 0.4,
                turnoverAmount: 50000000
            }
        }
    ], { marketDate: new Date('2026-06-11T00:00:00.000Z') });

    assert.equal(snapshot.index.close, 2500);
    assert.equal(snapshot.quality.selectedSources.close, 'NEPSE');
    assert.equal(snapshot.quality.conflicts[0].resolution, 'official_selected');
});

test('market snapshot is partial when source failures or fields are missing', () => {
    const snapshot = reconcileMarketSources([
        {
            sourceName: 'ShareSansar',
            sourceUrl: 'https://sharesansar.com',
            metrics: {
                close: 2500,
                change: 10,
                changePercent: 0.4,
                turnoverAmount: 50000000
            }
        },
        {
            sourceName: 'NEPSE',
            sourceUrl: 'https://nepalstock.com',
            metrics: {},
            error: 'TLS verification failed'
        }
    ]);

    assert.equal(snapshot.status, 'partial');
    assert.match(snapshot.quality.warnings[0], /TLS verification failed/);
});

test('ShareSansar history response becomes chronological snapshot input', () => {
    const rows = parseShareSansarHistory({
        data: [{
            open: '2500.10',
            high: '2520',
            low: '2490',
            current: '2510',
            change_: '10',
            per_change: '0.40',
            turnover: '100000',
            published_date: '2026-06-10'
        }]
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].metrics.close, 2510);
    assert.equal(rows[0].marketDate.toISOString(), '2026-06-10T00:00:00.000Z');
});

test('ShareSansar history collector chunks long backfills into provider-safe ranges', async () => {
    const requests = [];
    const rows = await collectShareSansarHistory({
        from: '2026-01-01',
        to: '2026-03-15',
        httpClient: {
            request: async (url) => {
                requests.push(url);
                const params = new URL(url).searchParams;
                return {
                    data: [{
                        current: '2500',
                        published_date: params.get('from')
                    }]
                };
            }
        }
    });

    assert.deepEqual(splitDateRange('2026-01-01', '2026-03-15'), [
        ['2026-01-01', '2026-01-31'],
        ['2026-02-01', '2026-03-03'],
        ['2026-03-04', '2026-03-15']
    ]);
    assert.equal(requests.length, 3);
    assert.equal(new URL(requests[0]).searchParams.get('length'), '50');
    assert.equal(rows.length, 3);
    assert.equal(rows[0].marketDate.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('SEBON parser retains direct public PDF provenance', () => {
    const rows = parseSebonList(
        fixture('sebon-notices.html'),
        'https://www.sebon.gov.np/notices'
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Public issue review notice');
    assert.equal(rows[0].url, 'https://www.sebon.gov.np/uploads/example.pdf');
});

test('NRB parser retains notice title, date, and public document provenance', () => {
    const rows = parseNrbList(
        fixture('nrb-notices.html'),
        'https://www.nrb.org.np/category/notices/'
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Monetary Policy Notice');
    assert.equal(
        rows[0].url,
        'https://www.nrb.org.np/contents/uploads/2026/06/monetary-policy-notice.pdf'
    );
    assert.equal(rows[0].publishedAt.toISOString(), '2026-06-10T00:00:00.000Z');
});

test('regulatory resolver accepts redirected PDFs and records the landing page', async () => {
    const rows = await fetchRegulatoryPdfItems({
        title: 'NRB circular',
        url: 'https://www.nrb.org.np/example-circular/',
        pageUrl: 'https://www.nrb.org.np/example-circular/'
    }, {
        request: async () => ({
            body: Buffer.from('%PDF fake'),
            url: 'https://www.nrb.org.np/contents/uploads/circular.pdf',
            contentType: 'application/pdf'
        })
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].url, 'https://www.nrb.org.np/contents/uploads/circular.pdf');
    assert.equal(rows[0].pageUrl, 'https://www.nrb.org.np/example-circular/');
});

test('PDF extraction is injectable and cleans machine-readable text', async () => {
    const text = await extractPdfText(Buffer.from('fake'), {
        pdfParser: async () => ({ text: '  Policy\n\ntext  ' })
    });

    assert.equal(text, 'Policy text');
});

test('legacy-font Nepali PDF text is excluded from structuring', () => {
    assert.equal(
        assessPdfText('नेपाल राष्ट्र बैंकको सूचना', 'g]kfn /fi6« a}+s sf] ;\"rgf').usable,
        false
    );
    assert.equal(
        assessPdfText(
            'नेपाल राष्ट्र बैंकको सूचना',
            'नेपाल राष्ट्र बैंकले नयाँ निर्देशन जारी गरेको छ।'
        ).usable,
        true
    );
});

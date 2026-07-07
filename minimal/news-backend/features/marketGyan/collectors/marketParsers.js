const cheerio = require('cheerio');

// ShareSansar sector labels (from the today-price sector filter and the
// sectorwise-share-price headings) mapped to canonical ontology sectors.
// Non-equity groups (bonds, debentures, promoter/preference shares) map to
// null so they are excluded from sector-sentiment aggregation.
const SHARESANSAR_SECTOR_LABELS = Object.freeze({
    'commercial bank': 'Banking',
    'commercial banks': 'Banking',
    'development bank': 'Development Bank',
    'development banks': 'Development Bank',
    'finance': 'Finance',
    'hotel and tourism': 'Hotels and Tourism',
    'hotels and tourism': 'Hotels and Tourism',
    'hotels': 'Hotels and Tourism',
    'hydro power': 'Hydropower',
    'hydropower': 'Hydropower',
    'investment': 'Investment',
    'life insurance': 'Life Insurance',
    'manufacturing and processing': 'Manufacturing and Processing',
    'microfinance': 'Microfinance',
    'micro finance': 'Microfinance',
    'mutual fund': 'Mutual Fund',
    'non life insurance': 'Non-Life Insurance',
    'others': 'Others',
    'trading': 'Trading'
});

const normalizeSectorLabel = (value) => String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const mapShareSansarSector = (text) => {
    const normalized = normalizeSectorLabel(text);
    return SHARESANSAR_SECTOR_LABELS[normalized] || null;
};

// Parse the ShareSansar sectorwise-share-price page into a { SYMBOL: sector }
// map. The page lists each sector as an <h3> heading followed by that sector's
// company links, so we walk the document in order and attribute every company
// symbol to the most recent sector heading.
const parseShareSansarSectorMap = (html) => {
    const $ = cheerio.load(html);
    const map = {};
    let current = null;
    $('*').each((_, element) => {
        if (element.tagName === 'h3') {
            current = mapShareSansarSector($(element).text());
            return;
        }
        if (element.tagName === 'a' && current) {
            const href = $(element).attr('href') || '';
            if (!href.includes('/company/')) return;
            const symbol = $(element).text().trim().toUpperCase();
            if (symbol && !map[symbol]) map[symbol] = current;
        }
    });
    return map;
};

const parseNumber = (value) => {
    const cleaned = String(value ?? '')
        .replace(/[^\d.+-]/g, '')
        .trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
};

const findLabeledNumber = (text, labels) => {
    const normalized = String(text || '').replace(/\s+/g, ' ');
    for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = normalized.match(
            new RegExp(`${escaped}\\s*[:\\-]?\\s*(?:Rs\\.?\\s*)?([+-]?[\\d,]+(?:\\.\\d+)?)`, 'i')
        );
        if (match) return parseNumber(match[1]);
    }
    return null;
};

const parseCompanyJson = (html) => {
    const match = String(html || '').match(/var\s+cmpjson\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) return [];
    try {
        return JSON.parse(match[1]).map((entry) => ({
            symbol: String(entry.symbol || '').trim().toUpperCase(),
            name: String(entry.companyname || '').trim()
        })).filter((entry) => entry.symbol);
    } catch {
        return [];
    }
};

const parseSectorRows = ($) => {
    const sectors = [];
    $('table').each((_, table) => {
        const headers = $(table).find('thead th').map(
            (__, header) => $(header).text().trim().toLowerCase()
        ).get();
        const nameIndex = headers.findIndex(
            (header) => header.includes('sector') || header === 'index'
        );
        if (nameIndex < 0) return;
        const closeIndex = headers.findIndex(
            (header) => ['close', 'current', 'index value'].some((name) => header.includes(name))
        );
        const changeIndex = headers.findIndex(
            (header) => header === 'change' || header.includes('point change')
        );
        const percentIndex = headers.findIndex(
            (header) => header.includes('%') || header.includes('percent')
        );
        $(table).find('tbody tr').each((__, row) => {
            const cells = $(row).find('td').map(
                (___, cell) => $(cell).text().trim()
            ).get();
            const name = cells[nameIndex];
            if (!name || /^(nepse|nepse index|overall)$/i.test(name)) return;
            const changePercent = percentIndex >= 0
                ? parseNumber(cells[percentIndex])
                : null;
            sectors.push({
                name,
                close: closeIndex >= 0 ? parseNumber(cells[closeIndex]) : null,
                change: changeIndex >= 0 ? parseNumber(cells[changeIndex]) : null,
                changePercent
            });
        });
    });
    return Array.from(new Map(sectors.map((sector) => [
        sector.name.toLowerCase(),
        sector
    ])).values());
};

const parseShareSansarHtml = (html) => {
    const $ = cheerio.load(html);
    const securities = [];
    const headers = $('#headFixed thead th').map(
        (_, header) => $(header).text().trim().toLowerCase()
    ).get();
    const column = (names, fallback) => {
        const index = headers.findIndex((header) => names.includes(header));
        return index >= 0 ? index : fallback;
    };
    const ltpIndex = column(['ltp'], 7);
    const changeIndex = column(['diff'], 15);
    const changePercentIndex = column(['diff %'], 17);
    const volumeIndex = column(['vol', 'volume'], 11);

    // ShareSansar interleaves sector section-header rows (a single cell with the
    // sector name, often spanning all columns) between the constituent rows.
    // Track the most recent header so each security can be tagged with its
    // sector, which lets reconciliation derive sector movement without a
    // separate (and brittle) sector-index page.
    let currentSector = null;
    $('#headFixed tbody tr').each((_, row) => {
        const cells = $(row).find('td').map((__, cell) => $(cell).text().trim()).get();
        const link = $(row).find('a[href*="/company/"]').first();
        const symbol = link.text().trim().toUpperCase();
        if (!symbol || cells.length <= ltpIndex) {
            // A row with no company link and a single meaningful cell is a
            // sector section header.
            const headerText = cells.find(Boolean);
            const mapped = mapShareSansarSector(headerText);
            if (mapped) currentSector = mapped;
            return;
        }
        securities.push({
            symbol,
            name: link.attr('title') || '',
            sector: currentSector,
            lastTradedPrice: parseNumber(cells[ltpIndex]),
            change: parseNumber(cells[changeIndex]),
            changePercent: parseNumber(cells[changePercentIndex]),
            volume: parseNumber(cells[volumeIndex])
        });
    });

    const bodyText = $('body').text();
    return {
        sourceName: 'ShareSansar',
        sourceUrl: 'https://www.sharesansar.com/today-share-price',
        metrics: {
            close: findLabeledNumber(bodyText, ['NEPSE Index', 'NEPSE']),
            turnoverAmount: findLabeledNumber(bodyText, ['Total Turnover']),
            volume: findLabeledNumber(bodyText, ['Total Traded Shares']),
            transactions: findLabeledNumber(bodyText, ['Total Transactions'])
        },
        sectors: parseSectorRows($),
        securities,
        registry: securities.map(({ symbol, name }) => ({ symbol, name }))
    };
};

const parseMeroLaganiHtml = (html) => {
    const $ = cheerio.load(html);
    const securities = [];
    $('table.live-trading tbody tr').each((_, row) => {
        const cells = $(row).find('td').map((__, cell) => $(cell).text().trim()).get();
        const link = $(row).find('a[href*="symbol="]').first();
        const symbol = (link.text() || new URL(
            link.attr('href') || 'https://example.com',
            'https://merolagani.com'
        ).searchParams.get('symbol') || '').trim().toUpperCase();
        if (!symbol || cells.length < 7) return;
        securities.push({
            symbol,
            lastTradedPrice: parseNumber(cells[1]),
            changePercent: parseNumber(cells[2]),
            open: parseNumber(cells[3]),
            high: parseNumber(cells[4]),
            low: parseNumber(cells[5]),
            volume: parseNumber(cells[6])
        });
    });

    const bodyText = $('body').text();
    return {
        sourceName: 'MeroLagani',
        sourceUrl: 'https://merolagani.com/LatestMarket.aspx',
        metrics: {
            close: findLabeledNumber(bodyText, ['NEPSE Index', 'NEPSE']),
            turnoverAmount: findLabeledNumber(bodyText, ['Total Turnover']),
            volume: findLabeledNumber(bodyText, ['Total Traded Shares']),
            transactions: findLabeledNumber(bodyText, ['Total Transactions'])
        },
        sectors: parseSectorRows($),
        securities,
        registry: securities.map((entry) => ({
            symbol: entry.symbol,
            name: ''
        }))
    };
};

const parseNepseHtml = (html) => {
    const $ = cheerio.load(html);
    const bodyText = $('body').text();
    return {
        sourceName: 'NEPSE',
        sourceUrl: 'https://nepalstock.com/today-price',
        metrics: {
            open: findLabeledNumber(bodyText, ['Open']),
            high: findLabeledNumber(bodyText, ['High']),
            low: findLabeledNumber(bodyText, ['Low']),
            close: findLabeledNumber(bodyText, ['NEPSE Index', 'Close']),
            change: findLabeledNumber(bodyText, ['Point Change', 'Change']),
            changePercent: findLabeledNumber(bodyText, ['Percent Change', '% Change']),
            turnoverAmount: findLabeledNumber(bodyText, ['Turnover']),
            volume: findLabeledNumber(bodyText, ['Traded Shares', 'Volume']),
            transactions: findLabeledNumber(bodyText, ['Transactions'])
        },
        sectors: parseSectorRows($),
        securities: [],
        registry: []
    };
};

const parseShareSansarHistory = (payload) => (
    Array.isArray(payload?.data) ? payload.data : []
).map((row) => ({
    marketDate: new Date(`${row.published_date}T00:00:00.000Z`),
    sourceName: 'ShareSansar',
    sourceUrl: 'https://www.sharesansar.com/index-history-data',
    metrics: {
        open: parseNumber(row.open),
        high: parseNumber(row.high),
        low: parseNumber(row.low),
        close: parseNumber(row.current),
        change: parseNumber(row.change_),
        changePercent: parseNumber(row.per_change),
        turnoverAmount: parseNumber(row.turnover)
    }
}));

module.exports = {
    findLabeledNumber,
    mapShareSansarSector,
    parseCompanyJson,
    parseMeroLaganiHtml,
    parseNepseHtml,
    parseNumber,
    parseSectorRows,
    parseShareSansarHistory,
    parseShareSansarHtml,
    parseShareSansarSectorMap
};

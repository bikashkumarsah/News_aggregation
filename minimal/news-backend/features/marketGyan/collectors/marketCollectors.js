const {
    parseMeroLaganiHtml,
    parseNepseHtml,
    parseShareSansarHistory,
    parseShareSansarHtml
} = require('./marketParsers');
const { createHttpClient } = require('./httpClient');

const MARKET_SOURCE_DEFINITIONS = Object.freeze([
    {
        sourceName: 'NEPSE',
        sourceUrl: 'https://nepalstock.com/today-price',
        parse: parseNepseHtml
    },
    {
        sourceName: 'ShareSansar',
        sourceUrl: 'https://www.sharesansar.com/today-share-price',
        parse: parseShareSansarHtml
    },
    {
        sourceName: 'MeroLagani',
        sourceUrl: 'https://merolagani.com/LatestMarket.aspx',
        parse: parseMeroLaganiHtml
    }
]);

const splitDateRange = (from, to, maximumDays = 31) => {
    const start = new Date(`${from}T00:00:00.000Z`);
    const finish = new Date(`${to}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(finish.getTime()) || start > finish) {
        throw new Error('Historical date range must use valid YYYY-MM-DD values');
    }

    const ranges = [];
    let cursor = start;
    while (cursor <= finish) {
        const end = new Date(Math.min(
            cursor.getTime() + (maximumDays - 1) * 24 * 60 * 60 * 1000,
            finish.getTime()
        ));
        ranges.push([
            cursor.toISOString().slice(0, 10),
            end.toISOString().slice(0, 10)
        ]);
        cursor = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }
    return ranges;
};

const collectShareSansarHistory = async ({
    from,
    to,
    httpClient = createHttpClient()
}) => {
    const rows = [];
    for (const [rangeFrom, rangeTo] of splitDateRange(from, to)) {
        const params = new URLSearchParams({
            index_id: '12',
            from: rangeFrom,
            to: rangeTo,
            draw: '1',
            start: '0',
            length: '50'
        });
        const payload = await httpClient.request(
            `https://www.sharesansar.com/index-history-data?${params.toString()}`,
            {
                responseType: 'json',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            }
        );
        rows.push(...parseShareSansarHistory(payload));
    }

    return Array.from(new Map(rows.map((row) => [
        row.marketDate.toISOString().slice(0, 10),
        row
    ])).values()).sort((left, right) => left.marketDate - right.marketDate);
};

const kathmanduDate = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kathmandu',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
};

const collectCurrentMarketSources = async ({
    httpClient = createHttpClient()
} = {}) => {
    const sources = await Promise.all(MARKET_SOURCE_DEFINITIONS.map(async (definition) => {
        try {
            const html = await httpClient.request(definition.sourceUrl);
            return {
                ...definition.parse(html),
                retrievedAt: new Date()
            };
        } catch (error) {
            return {
                sourceName: definition.sourceName,
                sourceUrl: definition.sourceUrl,
                retrievedAt: new Date(),
                metrics: {},
                securities: [],
                registry: [],
                error: error.message
            };
        }
    }));

    const date = kathmanduDate();
    try {
        const history = await collectShareSansarHistory({
            from: date,
            to: date,
            httpClient
        });
        const current = history[history.length - 1];
        if (current) {
            const shareSansar = sources.find(
                (source) => source.sourceName === 'ShareSansar'
            );
            shareSansar.metrics = {
                ...shareSansar.metrics,
                ...current.metrics
            };
        }
    } catch (error) {
        const shareSansar = sources.find(
            (source) => source.sourceName === 'ShareSansar'
        );
        shareSansar.error = [shareSansar.error, `history: ${error.message}`]
            .filter(Boolean)
            .join('; ');
    }
    return sources;
};

module.exports = {
    MARKET_SOURCE_DEFINITIONS,
    collectCurrentMarketSources,
    collectShareSansarHistory,
    kathmanduDate,
    splitDateRange
};

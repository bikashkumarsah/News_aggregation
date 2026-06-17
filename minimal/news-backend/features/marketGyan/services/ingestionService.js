const mongoose = require('mongoose');
const Article = require('../../../models/Article');
const MarketDocument = require('../models/MarketDocument');
const MarketIngestionRun = require('../models/MarketIngestionRun');
const MarketSecurity = require('../models/MarketSecurity');
const MarketSnapshot = require('../models/MarketSnapshot');
const {
    collectCurrentMarketSources,
    collectShareSansarHistory,
    kathmanduDate
} = require('../collectors/marketCollectors');
const {
    collectKathmanduPostMoney,
    collectOnlineKhabarBusiness,
    collectRegulatoryDocuments,
    collectShareSansarNews
} = require('../collectors/documentCollectors');
const { reconcileMarketSources } = require('./marketReconciliationService');
const { contentHash } = require('./textService');

const dayString = (value) => new Date(value).toISOString().slice(0, 10);
const startOfDayUtc = (value) => new Date(`${dayString(value)}T00:00:00.000Z`);

const buildRunKey = ({ mode, from, to }) => `${mode}:${dayString(from)}:${dayString(to)}`;

const upsertSecurityRegistry = async (sources) => {
    const entries = new Map();
    for (const source of sources) {
        for (const security of [...(source.registry || []), ...(source.securities || [])]) {
            const symbol = String(security.symbol || '').trim().toUpperCase();
            if (!symbol) continue;
            const existing = entries.get(symbol) || {
                symbol,
                name: security.name || '',
                sector: security.sector || '',
                sources: []
            };
            if (!existing.name && security.name) existing.name = security.name;
            if (!existing.sector && security.sector) existing.sector = security.sector;
            existing.sources.push(source.sourceName);
            entries.set(symbol, existing);
        }
    }

    if (!entries.size) return 0;
    await MarketSecurity.bulkWrite(Array.from(entries.values()).map((entry) => ({
        updateOne: {
            filter: { symbol: entry.symbol },
            update: {
                $set: {
                    name: entry.name,
                    sector: entry.sector,
                    active: true,
                    lastSeenAt: new Date()
                },
                $addToSet: {
                    sources: { $each: Array.from(new Set(entry.sources)) }
                }
            },
            upsert: true
        }
    })));
    return entries.size;
};

const upsertFinancialNews = async (items, runId) => {
    let created = 0;
    let updated = 0;
    for (const item of items) {
        const existing = await Article.findOne({ url: item.url }).select('_id');
        const article = await Article.findOneAndUpdate(
            { url: item.url },
            {
                $set: {
                    title: item.title,
                    description: item.description || item.content.slice(0, 500),
                    content: item.content,
                    topics: ['finance'],
                    category: 'business',
                    source: item.sourceName,
                    publishedAt: item.publishedAt,
                    fetchedAt: new Date()
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        await MarketDocument.findOneAndUpdate(
            { 'source.url': item.url },
            {
                $set: {
                    documentType: 'financial_news',
                    article: article._id,
                    title: item.title,
                    language: item.language,
                    source: {
                        name: item.sourceName,
                        url: item.url,
                        pageUrl: item.pageUrl,
                        section: item.sections?.join(', ') || item.section,
                        publishedAt: item.publishedAt,
                        retrievedAt: new Date()
                    },
                    text: {
                        cleaned: item.content,
                        extractionMethod: 'article_reference',
                        contentHash: contentHash(item.title, item.content)
                    },
                    ingestion: {
                        status: 'complete',
                        sourceId: item.sourceId,
                        run: runId
                    }
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        if (existing) updated += 1;
        else created += 1;
    }
    return { fetched: items.length, created, updated, skipped: 0 };
};

const upsertRegulatoryDocuments = async (items, runId) => {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const item of items) {
        const exists = await MarketDocument.exists({ 'source.url': item.url });
        await MarketDocument.findOneAndUpdate(
            { 'source.url': item.url },
            {
                $set: {
                    documentType: item.kind,
                    title: item.title,
                    language: item.language,
                    source: {
                        name: item.sourceName,
                        url: item.url,
                        pageUrl: item.pageUrl,
                        section: item.section,
                        publishedAt: item.publishedAt,
                        retrievedAt: new Date()
                    },
                    text: {
                        original: item.content || undefined,
                        cleaned: item.content || undefined,
                        extractionMethod: 'pdf_text',
                        contentHash: item.contentHash
                    },
                    ingestion: {
                        status: item.ingestionStatus,
                        sourceId: item.sourceId,
                        error: item.extractionError,
                        run: runId
                    }
                }
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
                runValidators: item.ingestionStatus !== 'failed'
            }
        );
        if (item.ingestionStatus === 'failed') skipped += 1;
        else if (exists) updated += 1;
        else created += 1;
    }
    return { fetched: items.length, created, updated, skipped };
};

const sourceResult = (source, counts, startedAt, error) => ({
    source,
    status: error ? 'failed' : (counts.skipped ? 'partial' : 'complete'),
    ...counts,
    durationMs: Date.now() - startedAt,
    warnings: [],
    error: error?.message
});

const ingestMarketForDate = async (date, {
    currentCollector = collectCurrentMarketSources
} = {}) => {
    if (currentCollector === collectCurrentMarketSources && dayString(date) !== kathmanduDate()) {
        throw new Error('Daily market collection only supports the current Nepal date; use backfill for historical dates');
    }
    const sources = await currentCollector();
    await upsertSecurityRegistry(sources);
    const snapshot = reconcileMarketSources(sources, {
        marketDate: startOfDayUtc(date)
    });
    return MarketSnapshot.findOneAndUpdate(
        { marketDate: snapshot.marketDate },
        { $set: snapshot },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

const backfillMarketHistory = async ({ from, to, historyCollector = collectShareSansarHistory }) => {
    const rows = await historyCollector({ from, to });
    if (!rows.length) return { fetched: 0, created: 0, updated: 0, skipped: 0 };

    const operations = rows.map((row) => ({
        updateOne: {
            filter: { marketDate: row.marketDate },
            update: {
                $set: {
                    marketDate: row.marketDate,
                    status: 'partial',
                    index: {
                        open: row.metrics.open,
                        high: row.metrics.high,
                        low: row.metrics.low,
                        close: row.metrics.close,
                        change: row.metrics.change,
                        changePercent: row.metrics.changePercent
                    },
                    turnover: {
                        amount: row.metrics.turnoverAmount
                    },
                    breadth: {
                        advancers: null,
                        decliners: null,
                        unchanged: null
                    },
                    provenance: [{
                        sourceName: row.sourceName,
                        sourceUrl: row.sourceUrl,
                        retrievedAt: new Date(),
                        fields: Object.keys(row.metrics),
                        values: row.metrics
                    }],
                    quality: {
                        selectedSources: Object.fromEntries(
                            Object.keys(row.metrics).map((field) => [field, row.sourceName])
                        ),
                        missingFields: [
                            'volume',
                            'transactions',
                            'sectors',
                            'breadth',
                            'leaders'
                        ],
                        conflicts: [],
                        warnings: ['Historical fallback snapshot; official corroboration unavailable']
                    },
                    collectedAt: new Date()
                }
            },
            upsert: true
        }
    }));
    const result = await MarketSnapshot.bulkWrite(operations);
    return {
        fetched: rows.length,
        created: result.upsertedCount || 0,
        updated: result.modifiedCount || 0,
        skipped: 0
    };
};

const runIngestion = async ({
    from,
    to = from,
    mode = dayString(from) === dayString(to) ? 'daily' : 'backfill',
    includeMarket = true,
    includeDocuments = true,
    documentSources,
    documentOptions = {},
    force = false,
    collectors = {}
}) => {
    if (mongoose.connection.readyState !== 1) {
        throw new Error('MongoDB must be connected before Market Gyan ingestion');
    }

    const runKey = buildRunKey({ mode, from, to });
    let run = await MarketIngestionRun.findOne({ runKey });
    if (run?.status === 'running') {
        const error = new Error(`Ingestion run ${runKey} is already running`);
        error.status = 409;
        throw error;
    }
    if (run?.status === 'complete' && !force) return run;

    run = await MarketIngestionRun.findOneAndUpdate(
        { runKey },
        {
            $set: {
                mode,
                from: startOfDayUtc(from),
                to: startOfDayUtc(to),
                status: 'running',
                startedAt: new Date(),
                sources: []
            },
            $unset: {
                completedAt: 1,
                error: 1
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const results = [];
    try {
        let startedAt = Date.now();
        if (includeMarket) {
            try {
                const counts = mode === 'backfill'
                    ? await backfillMarketHistory({
                        from: dayString(from),
                        to: dayString(to),
                        historyCollector: collectors.historyCollector
                    })
                    : {
                        fetched: 1,
                        created: await ingestMarketForDate(from, {
                            currentCollector: collectors.currentCollector
                        }) ? 1 : 0,
                        updated: 0,
                        skipped: 0
                    };
                results.push(sourceResult('market', counts, startedAt));
            } catch (error) {
                results.push(sourceResult('market', {
                    fetched: 0,
                    created: 0,
                    updated: 0,
                    skipped: 0
                }, startedAt, error));
            }
        }

        if (includeDocuments) {
            const documentCollectors = [
                ['sharesansar', 'ShareSansar News', collectors.shareSansarNews || collectShareSansarNews, upsertFinancialNews],
                ['onlinekhabar', 'OnlineKhabar Business', collectors.onlineKhabar || collectOnlineKhabarBusiness, upsertFinancialNews],
                ['kathmandupost', 'Kathmandu Post Money', collectors.kathmanduPost || collectKathmanduPostMoney, upsertFinancialNews],
                ['regulatory', 'SEBON and NRB', collectors.regulatory || collectRegulatoryDocuments, upsertRegulatoryDocuments]
            ].filter(([key]) => !documentSources?.length || documentSources.includes(key));
            for (const [key, name, collector, upsert] of documentCollectors) {
                startedAt = Date.now();
                try {
                    const items = await collector({
                        from: dayString(from),
                        to: dayString(to),
                        ...(documentOptions.all || {}),
                        ...(documentOptions[key] || {})
                    });
                    const counts = await upsert(items, run._id);
                    results.push(sourceResult(name, counts, startedAt));
                } catch (error) {
                    results.push(sourceResult(name, {
                        fetched: 0,
                        created: 0,
                        updated: 0,
                        skipped: 0
                    }, startedAt, error));
                }
            }
        }

        const failed = results.filter((result) => result.status === 'failed').length;
        const partial = results.some((result) => result.status === 'partial');
        run.status = results.length && failed === results.length
            ? 'failed'
            : (failed || partial ? 'partial' : 'complete');
        run.sources = results;
        run.completedAt = new Date();
        await run.save();
        return run;
    } catch (error) {
        run.status = 'failed';
        run.error = error.message;
        run.completedAt = new Date();
        await run.save();
        throw error;
    }
};

module.exports = {
    backfillMarketHistory,
    buildRunKey,
    ingestMarketForDate,
    runIngestion,
    startOfDayUtc,
    upsertFinancialNews,
    upsertRegulatoryDocuments,
    upsertSecurityRegistry
};

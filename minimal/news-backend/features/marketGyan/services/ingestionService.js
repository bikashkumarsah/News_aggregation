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
const { findMentionedSecurities } = require('./securityAliasService');

const dayString = (value) => new Date(value).toISOString().slice(0, 10);
const startOfDayUtc = (value) => new Date(`${dayString(value)}T00:00:00.000Z`);

const HISTORY_SOURCE_URL = 'https://www.sharesansar.com/index-history-data';
// A 'running' run older than this belongs to a worker that died (crash, kill,
// reboot) and may be taken over instead of blocking its date range forever.
const DEFAULT_STALE_RUN_MS = 6 * 60 * 60 * 1000;

const isHumanReviewed = (document) => /:human-reviewed$/.test(
    String(document?.sentiment?.model || '')
);

const buildRunKey = ({ mode, from, to }) => `${mode}:${dayString(from)}:${dayString(to)}`;

// Load the active security registry (symbol, name, aliases, sector) once so
// ingestion can deterministically tag documents with the companies and sectors
// they mention — no external LLM required. The retrieval sector filter reads
// MarketDocument.metadata.sectors, so this is what makes fresh news filterable.
const loadSecurityRegistry = async () => MarketSecurity.find({ active: true })
    .select('symbol name sector aliases')
    .lean();

const deriveDocumentTags = (item, securities) => {
    const matches = findMentionedSecurities(
        { title: item.title, excerpt: item.content },
        securities
    );
    const companies = Array.from(new Set(matches.map((match) => match.symbol)));
    const sectors = Array.from(new Set(
        matches.map((match) => match.sector).filter(Boolean)
    ));
    return { companies, sectors };
};

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
                // When ShareSansar is down only MeroLagani answers, and it has
                // no names or sectors: never blank the registry's known values.
                $set: {
                    ...(entry.name ? { name: entry.name } : {}),
                    ...(entry.sector ? { sector: entry.sector } : {}),
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
    const securities = await loadSecurityRegistry();
    for (const item of items) {
        const [existing, existingDocument] = await Promise.all([
            Article.findOne({ url: item.url }).select('_id content'),
            MarketDocument.findOne({ 'source.url': item.url })
                .select('text.cleaned sentiment.model')
        ]);
        // When a detail page fails, collectors fall back to the RSS or listing
        // excerpt. A re-run must not replace full text from an earlier run
        // with it (that would also change the labelled content hash).
        const keepArticleText = Boolean(item.contentIsExcerpt && existing?.content);
        const keepDocumentText = Boolean(
            item.contentIsExcerpt && existingDocument?.text?.cleaned
        );
        const article = await Article.findOneAndUpdate(
            { url: item.url },
            {
                $set: {
                    title: item.title,
                    ...(keepArticleText ? {} : {
                        description: item.description || item.content.slice(0, 500),
                        content: item.content
                    }),
                    source: item.sourceName,
                    publishedAt: item.publishedAt,
                    fetchedAt: new Date()
                },
                // The same OnlineKhabar/Kathmandu Post article may already be in
                // the main news feed with its own topics and category.
                $addToSet: { topics: 'finance' },
                $setOnInsert: { category: 'business' }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        const { companies, sectors } = deriveDocumentTags(
            keepDocumentText
                ? { title: item.title, content: existingDocument.text.cleaned }
                : item,
            securities
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
                    ...(keepDocumentText ? {} : {
                        text: {
                            cleaned: item.content,
                            extractionMethod: 'article_reference',
                            contentHash: contentHash(item.title, item.content)
                        }
                    }),
                    // Approved v1 reviews write reviewed companies and sectors
                    // onto the document; alias matching must not replace them.
                    ...(isHumanReviewed(existingDocument) ? {} : {
                        'metadata.companies': companies,
                        'metadata.sectors': sectors
                    }),
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
        const existing = await MarketDocument.findOne({ 'source.url': item.url })
            .select('ingestion.status')
            .lean();
        if (
            item.ingestionStatus === 'failed'
            && existing
            && existing.ingestion?.status !== 'failed'
        ) {
            // A transient download or PDF-parse failure on a re-run must not
            // erase the text and status extracted by an earlier run.
            skipped += 1;
            continue;
        }
        const exists = Boolean(existing);
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

    // Daily snapshots reconcile the live NEPSE, ShareSansar and MeroLagani
    // pages (sectors, breadth, leaders, volume). The index-history fallback
    // only refreshes dates that have nothing better.
    const preserved = await MarketSnapshot.find({
        marketDate: { $in: rows.map((row) => row.marketDate) },
        provenance: { $elemMatch: { sourceUrl: { $ne: HISTORY_SOURCE_URL } } }
    }).select('marketDate').lean();
    const preservedDates = new Set(
        preserved.map((snapshot) => new Date(snapshot.marketDate).getTime())
    );
    const fallbackRows = rows.filter(
        (row) => !preservedDates.has(new Date(row.marketDate).getTime())
    );
    if (!fallbackRows.length) {
        return {
            fetched: rows.length,
            created: 0,
            updated: 0,
            skipped: 0,
            preserved: preservedDates.size
        };
    }

    const operations = fallbackRows.map((row) => ({
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
        skipped: 0,
        preserved: preservedDates.size
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
    staleAfterMs = DEFAULT_STALE_RUN_MS,
    collectors = {},
    connection = mongoose.connection
}) => {
    if (connection.readyState !== 1) {
        throw new Error('MongoDB must be connected before Market Gyan ingestion');
    }

    const runKey = buildRunKey({ mode, from, to });
    const alreadyRunning = () => {
        const error = new Error(
            `Ingestion run ${runKey} is already running; pass force to take over a run whose worker died`
        );
        error.status = 409;
        return error;
    };
    const staleBefore = new Date(Date.now() - staleAfterMs);
    const isActive = (candidate) => (
        candidate?.status === 'running'
        && !(new Date(candidate.startedAt) < staleBefore)
    );
    let run = await MarketIngestionRun.findOne({ runKey });
    if (isActive(run) && !force) throw alreadyRunning();
    if (run?.status === 'complete' && !force) return run;

    // Claim the run atomically: a fresh 'running' record does not match the
    // filter, so the upsert collides with the unique runKey instead of
    // starting a second concurrent run.
    try {
        run = await MarketIngestionRun.findOneAndUpdate(
            force
                ? { runKey }
                : {
                    runKey,
                    $or: [
                        { status: { $ne: 'running' } },
                        { startedAt: { $lt: staleBefore } }
                    ]
                },
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
    } catch (error) {
        if (error?.code === 11000) throw alreadyRunning();
        throw error;
    }

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

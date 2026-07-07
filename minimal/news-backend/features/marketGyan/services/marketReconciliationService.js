const METRIC_FIELDS = Object.freeze([
    'open',
    'high',
    'low',
    'close',
    'change',
    'changePercent',
    'turnoverAmount',
    'volume',
    'transactions'
]);

const SOURCE_PRIORITY = Object.freeze(['NEPSE', 'ShareSansar', 'MeroLagani']);

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const withinTolerance = (a, b, field) => {
    if (!isNumber(a) || !isNumber(b)) return true;
    const absoluteTolerance = ['change', 'changePercent'].includes(field) ? 0.15 : 0.1;
    const relativeTolerance = ['turnoverAmount', 'volume', 'transactions'].includes(field)
        ? 0.01
        : 0.001;
    return Math.abs(a - b) <= Math.max(
        absoluteTolerance,
        Math.max(Math.abs(a), Math.abs(b)) * relativeTolerance
    );
};

const reconcileField = (sources, field) => {
    const available = SOURCE_PRIORITY.map((sourceName) => {
        const source = sources.find((entry) => entry.sourceName === sourceName);
        return {
            sourceName,
            value: source?.metrics?.[field]
        };
    }).filter((entry) => isNumber(entry.value));

    if (!available.length) {
        return { value: null, selectedSource: null, conflict: null };
    }

    const official = available.find((entry) => entry.sourceName === 'NEPSE');
    if (official) {
        const disagreeing = available.filter(
            (entry) => entry.sourceName !== 'NEPSE'
                && !withinTolerance(official.value, entry.value, field)
        );
        return {
            value: official.value,
            selectedSource: 'NEPSE',
            conflict: disagreeing.length ? {
                field,
                values: Object.fromEntries(available.map((entry) => [
                    entry.sourceName,
                    entry.value
                ])),
                resolution: 'official_selected'
            } : null
        };
    }

    const shareSansar = available.find((entry) => entry.sourceName === 'ShareSansar');
    const meroLagani = available.find((entry) => entry.sourceName === 'MeroLagani');
    if (shareSansar && meroLagani && !withinTolerance(
        shareSansar.value,
        meroLagani.value,
        field
    )) {
        return {
            value: null,
            selectedSource: null,
            conflict: {
                field,
                values: {
                    ShareSansar: shareSansar.value,
                    MeroLagani: meroLagani.value
                },
                resolution: 'withheld'
            }
        };
    }

    const selected = shareSansar || meroLagani || available[0];
    return {
        value: selected.value,
        selectedSource: selected.sourceName,
        conflict: null
    };
};

const buildLeaders = (sources) => {
    const bySymbol = new Map();
    for (const source of sources) {
        for (const security of source.securities || []) {
            if (!security.symbol || bySymbol.has(security.symbol)) continue;
            bySymbol.set(security.symbol, security);
        }
    }
    const values = Array.from(bySymbol.values());
    const gainers = values
        .filter((entry) => isNumber(entry.changePercent))
        .sort((a, b) => b.changePercent - a.changePercent)
        .slice(0, 10);
    const losers = values
        .filter((entry) => isNumber(entry.changePercent))
        .sort((a, b) => a.changePercent - b.changePercent)
        .slice(0, 10);
    const volumeLeaders = values
        .filter((entry) => isNumber(entry.volume))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 10);
    return { gainers, losers, volumeLeaders };
};

const uniqueSecurities = (sources) => {
    const bySymbol = new Map();
    for (const sourceName of SOURCE_PRIORITY) {
        const source = sources.find((entry) => entry.sourceName === sourceName);
        for (const security of source?.securities || []) {
            if (security.symbol && !bySymbol.has(security.symbol)) {
                bySymbol.set(security.symbol, security);
            }
        }
    }
    return Array.from(bySymbol.values());
};

const buildBreadth = (sources) => {
    const securities = uniqueSecurities(sources)
        .filter((security) => isNumber(security.changePercent));
    return {
        advancers: securities.filter((security) => security.changePercent > 0).length,
        decliners: securities.filter((security) => security.changePercent < 0).length,
        unchanged: securities.filter((security) => security.changePercent === 0).length
    };
};

const buildSectors = (sources) => {
    for (const sourceName of SOURCE_PRIORITY) {
        const source = sources.find((entry) => entry.sourceName === sourceName);
        if (!source?.sectors?.length) continue;
        return source.sectors.map((sector) => ({
            ...sector,
            basis: 'sector_index',
            sentiment: !isNumber(sector.changePercent)
                ? 'unavailable'
                : (
                    sector.changePercent > 0
                        ? 'bullish'
                        : (sector.changePercent < 0 ? 'bearish' : 'neutral')
                )
        }));
    }
    return [];
};

// When no source exposes an official sector sub-index table, derive sector
// movement by averaging the change of the constituent securities we already
// collect (each tagged with its sector by the ShareSansar parser). This is an
// aggregate signal, not the official sub-index value, so it is marked
// accordingly via `basis: 'constituent_average'`.
const buildSectorsFromSecurities = (sources) => {
    const groups = new Map();
    for (const security of uniqueSecurities(sources)) {
        if (!security.sector || !isNumber(security.changePercent)) continue;
        const group = groups.get(security.sector) || { changes: [] };
        group.changes.push(security.changePercent);
        groups.set(security.sector, group);
    }
    return Array.from(groups.entries())
        .map(([name, group]) => {
            const average = group.changes.reduce((sum, value) => sum + value, 0)
                / group.changes.length;
            const changePercent = Math.round(average * 100) / 100;
            return {
                name,
                close: null,
                change: null,
                changePercent,
                constituents: group.changes.length,
                basis: 'constituent_average',
                sentiment: changePercent > 0
                    ? 'bullish'
                    : (changePercent < 0 ? 'bearish' : 'neutral')
            };
        })
        .sort((left, right) => right.changePercent - left.changePercent);
};

const reconcileMarketSources = (sources, {
    marketDate = new Date()
} = {}) => {
    const resolved = {};
    const selectedSources = {};
    const conflicts = [];
    const missingFields = [];

    for (const field of METRIC_FIELDS) {
        const result = reconcileField(sources, field);
        resolved[field] = result.value;
        if (result.selectedSource) selectedSources[field] = result.selectedSource;
        else missingFields.push(field);
        if (result.conflict) conflicts.push(result.conflict);
    }

    const provenance = sources.map((source) => ({
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        retrievedAt: source.retrievedAt,
        fields: Object.keys(source.metrics || {}).filter(
            (field) => isNumber(source.metrics[field])
        ),
        values: source.metrics || {}
    }));
    const warnings = sources
        .filter((source) => source.error)
        .map((source) => `${source.sourceName}: ${source.error}`);
    const required = ['close', 'change', 'changePercent', 'turnoverAmount'];
    const leaders = buildLeaders(sources);
    const breadth = buildBreadth(sources);
    const scrapedSectors = buildSectors(sources);
    const sectors = scrapedSectors.length
        ? scrapedSectors
        : buildSectorsFromSecurities(sources);
    if (!sectors.length) missingFields.push('sectors');
    if (!(breadth.advancers + breadth.decliners + breadth.unchanged)) {
        missingFields.push('breadth');
    }
    for (const [name, values] of Object.entries(leaders)) {
        if (!values.length) missingFields.push(`leaders.${name}`);
    }
    const complete = (
        required.every((field) => isNumber(resolved[field]))
        && sectors.length > 0
        && breadth.advancers + breadth.decliners + breadth.unchanged > 0
        && Object.values(leaders).every((values) => values.length > 0)
    );
    const degraded = warnings.length > 0 || missingFields.length > 0;

    return {
        marketDate,
        status: complete
            && !degraded
            && !conflicts.some((conflict) => conflict.resolution === 'withheld')
            ? 'complete'
            : 'partial',
        index: {
            open: resolved.open,
            high: resolved.high,
            low: resolved.low,
            close: resolved.close,
            change: resolved.change,
            changePercent: resolved.changePercent
        },
        turnover: {
            amount: resolved.turnoverAmount,
            volume: resolved.volume,
            transactions: resolved.transactions
        },
        sectors,
        breadth,
        leaders,
        provenance,
        quality: {
            selectedSources,
            missingFields,
            conflicts,
            warnings
        },
        collectedAt: new Date()
    };
};

module.exports = {
    METRIC_FIELDS,
    SOURCE_PRIORITY,
    reconcileField,
    reconcileMarketSources,
    buildBreadth,
    buildSectors,
    buildSectorsFromSecurities,
    withinTolerance
};

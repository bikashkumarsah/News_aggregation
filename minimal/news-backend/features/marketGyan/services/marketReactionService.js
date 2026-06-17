const MarketLabel = require('../models/MarketLabel');
const MarketReaction = require('../models/MarketReaction');
const MarketSnapshot = require('../models/MarketSnapshot');

const percentageReturn = (baseline, next) => (
    Number.isFinite(baseline) && baseline !== 0 && Number.isFinite(next)
        ? ((next - baseline) / baseline) * 100
        : null
);

const marketCloseAt = (marketDate) => {
    const date = new Date(marketDate);
    const day = date.toISOString().slice(0, 10);
    return new Date(`${day}T15:00:00+05:45`);
};

const alignTradingSessions = (snapshots, publicationAt) => {
    const publication = new Date(publicationAt);
    const ordered = [...snapshots]
        .filter((snapshot) => Number.isFinite(snapshot.index?.close))
        .sort((a, b) => new Date(a.marketDate) - new Date(b.marketDate));
    const baselineCandidates = ordered.filter(
        (snapshot) => marketCloseAt(snapshot.marketDate) < publication
    );
    const future = ordered.filter(
        (snapshot) => marketCloseAt(snapshot.marketDate) >= publication
    );
    return {
        baseline: baselineCandidates.at(-1) || null,
        first: future[0] || null,
        third: future[2] || null
    };
};

const sectorClose = (snapshot, sector) => snapshot?.sectors?.find(
    (row) => row.name === sector
)?.close;

const reactionRow = ({
    identifier,
    baselineClose,
    firstClose,
    thirdClose,
    indexFirstReturn,
    indexThirdReturn
}) => {
    const firstSessionReturn = percentageReturn(baselineClose, firstClose);
    const thirdSessionReturn = percentageReturn(baselineClose, thirdClose);
    return {
        identifier,
        baselineClose,
        firstSessionClose: firstClose,
        thirdSessionClose: thirdClose,
        firstSessionReturn,
        thirdSessionReturn,
        firstSessionAbnormalReturn: firstSessionReturn === null || indexFirstReturn === null
            ? null
            : firstSessionReturn - indexFirstReturn,
        thirdSessionAbnormalReturn: thirdSessionReturn === null || indexThirdReturn === null
            ? null
            : thirdSessionReturn - indexThirdReturn
    };
};

const computeReactionRecord = ({
    label,
    snapshots,
    overlapLabels = []
}) => {
    const publicationAt = label.input.publishedAt;
    const sessions = alignTradingSessions(snapshots, publicationAt);
    const index = reactionRow({
        identifier: 'NEPSE',
        baselineClose: sessions.baseline?.index?.close,
        firstClose: sessions.first?.index?.close,
        thirdClose: sessions.third?.index?.close,
        indexFirstReturn: 0,
        indexThirdReturn: 0
    });
    index.firstSessionAbnormalReturn = null;
    index.thirdSessionAbnormalReturn = null;

    const gold = label.adjudication?.goldCandidate || {};
    const sectors = (gold.sectors || []).map((sector) => reactionRow({
        identifier: sector,
        baselineClose: sectorClose(sessions.baseline, sector),
        firstClose: sectorClose(sessions.first, sector),
        thirdClose: sectorClose(sessions.third, sector),
        indexFirstReturn: index.firstSessionReturn,
        indexThirdReturn: index.thirdSessionReturn
    }));
    const symbols = (gold.symbols || []).map((symbol) => reactionRow({
        identifier: symbol,
        baselineClose: null,
        firstClose: null,
        thirdClose: null,
        indexFirstReturn: index.firstSessionReturn,
        indexThirdReturn: index.thirdSessionReturn
    }));
    const missingFields = [];
    if (!sessions.baseline) missingFields.push('baselineTradingDate');
    if (!sessions.first) missingFields.push('firstTradingDate');
    if (!sessions.third) missingFields.push('thirdTradingDate');
    for (const row of sectors) {
        if (!Number.isFinite(row.firstSessionAbnormalReturn)) {
            missingFields.push(`sector.${row.identifier}.firstSessionAbnormalReturn`);
        }
        if (!Number.isFinite(row.thirdSessionAbnormalReturn)) {
            missingFields.push(`sector.${row.identifier}.thirdSessionAbnormalReturn`);
        }
    }
    for (const row of symbols) {
        missingFields.push(`symbol.${row.identifier}.returns`);
    }

    const ownSymbols = new Set(gold.symbols || []);
    const overlapWarnings = overlapLabels
        .filter((other) => other._id.toString() !== label._id.toString())
        .filter((other) => (
            (other.adjudication?.goldCandidate?.symbols || [])
                .some((symbol) => ownSymbols.has(symbol))
        ))
        .map((other) => (
            `Overlapping symbol event ${other._id} published at `
            + new Date(other.input.publishedAt).toISOString()
        ));

    const available = [
        sessions.baseline,
        sessions.first,
        sessions.third
    ].filter(Boolean).length;
    return {
        label: label._id,
        document: label.document,
        publicationAt,
        baselineTradingDate: sessions.baseline?.marketDate,
        firstTradingDate: sessions.first?.marketDate,
        thirdTradingDate: sessions.third?.marketDate,
        index,
        sectors,
        symbols,
        provenance: Array.from(new Map(
            [sessions.baseline, sessions.first, sessions.third]
                .filter(Boolean)
                .flatMap((snapshot) => snapshot.provenance || [])
                .map((item) => [
                    `${item.sourceName}:${item.sourceUrl}`,
                    {
                        sourceName: item.sourceName,
                        sourceUrl: item.sourceUrl,
                        fields: item.fields,
                        retrievedAt: item.retrievedAt
                    }
                ])
        ).values()),
        missingFields: Array.from(new Set(missingFields)),
        overlapWarnings,
        status: available === 3 && !missingFields.length
            ? 'complete'
            : available ? 'partial' : 'unavailable',
        computedAt: new Date()
    };
};

const computeMarketReactions = async ({ limit = 500 } = {}) => {
    const labels = await MarketLabel.find({
        'model.schemaVersion': 2,
        'adjudication.status': 'adjudicated',
        'adjudication.goldCandidate.relevance': { $in: ['direct', 'indirect'] }
    }).sort({ 'input.publishedAt': 1 }).limit(Number(limit)).lean();
    if (!labels.length) return { considered: 0, upserted: 0 };

    const minDate = new Date(Math.min(
        ...labels.map((label) => new Date(label.input.publishedAt).getTime())
    ));
    minDate.setUTCDate(minDate.getUTCDate() - 10);
    const maxDate = new Date(Math.max(
        ...labels.map((label) => new Date(label.input.publishedAt).getTime())
    ));
    maxDate.setUTCDate(maxDate.getUTCDate() + 14);
    const snapshots = await MarketSnapshot.find({
        marketDate: { $gte: minDate, $lte: maxDate }
    }).sort({ marketDate: 1 }).lean();

    let upserted = 0;
    for (const label of labels) {
        const publication = new Date(label.input.publishedAt).getTime();
        const overlaps = labels.filter((other) => (
            Math.abs(new Date(other.input.publishedAt).getTime() - publication)
            <= 10 * 24 * 60 * 60 * 1000
        ));
        const record = computeReactionRecord({ label, snapshots, overlapLabels: overlaps });
        await MarketReaction.updateOne(
            { label: label._id },
            { $set: record },
            { upsert: true, runValidators: true }
        );
        upserted += 1;
    }
    return { considered: labels.length, upserted };
};

const exportMarketReactions = async () => {
    const reactions = await MarketReaction.find({})
        .populate({
            path: 'label',
            select: 'adjudication.goldCandidate input.publishedAt'
        })
        .sort({ publicationAt: 1 })
        .lean();
    return reactions.map((record) => ({
        id: record.label?._id?.toString(),
        publishedAt: record.publicationAt,
        relevance: record.label?.adjudication?.goldCandidate?.relevance,
        impactDirection: record.label?.adjudication?.goldCandidate?.impactDirection,
        reaction: {
            indexFirstSessionReturn: record.index?.firstSessionReturn ?? null,
            indexThirdSessionReturn: record.index?.thirdSessionReturn ?? null,
            sectors: record.sectors || [],
            symbols: record.symbols || [],
            firstSessionAbnormalReturn: (
                [...(record.symbols || []), ...(record.sectors || [])]
                    .find((item) => Number.isFinite(item.firstSessionAbnormalReturn))
                    ?.firstSessionAbnormalReturn
                ?? record.index?.firstSessionReturn
                ?? null
            )
        },
        missingFields: record.missingFields || [],
        overlapWarnings: record.overlapWarnings || [],
        status: record.status
    }));
};

module.exports = {
    alignTradingSessions,
    computeMarketReactions,
    computeReactionRecord,
    exportMarketReactions,
    marketCloseAt,
    percentageReturn,
    reactionRow
};

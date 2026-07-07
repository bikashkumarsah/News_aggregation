const { marketGyanConfig } = require('../config');
const MarketDocument = require('../models/MarketDocument');
const MarketReport = require('../models/MarketReport');
const MarketSnapshot = require('../models/MarketSnapshot');
const { availableFilters } = require('./filterNormalizationService');

const MARKET_GYAN_DISCLAIMER =
    'Informational analysis based on public data, not investment advice.';

const createOverviewResponse = ({
    snapshot = null,
    stories = [],
    report = null,
    reviewEnabled = false
} = {}) => ({
    success: true,
    phase: 'data-pipeline',
    data: {
        snapshot,
        sectors: snapshot?.sectors || [],
        stories,
        report,
        queryEnabled: marketGyanConfig.queryEnabled,
        reviewEnabled,
        filters: availableFilters()
    },
    disclaimer: MARKET_GYAN_DISCLAIMER
});

const loadOverview = async ({ reviewEnabled = false } = {}) => {
    const [snapshot, documents, report] = await Promise.all([
        MarketSnapshot.findOne({ status: { $in: ['complete', 'partial'] } })
            .sort({ marketDate: -1 })
            .lean(),
        MarketDocument.find({ 'ingestion.status': { $in: ['complete', 'partial'] } })
            .sort({ 'source.publishedAt': -1 })
            .limit(8)
            .select('title source documentType sentiment metadata')
            .lean(),
        MarketReport.findOne({ status: 'published' })
            .sort({ reportDate: -1 })
            .lean()
    ]);

    const stories = documents.map((document) => ({
        id: document._id.toString(),
        title: document.title,
        url: document.source?.url,
        source: document.source?.name,
        publishedAt: document.source?.publishedAt,
        documentType: document.documentType,
        sentiment: document.sentiment?.label || 'unclassified',
        sectors: document.metadata?.sectors || []
    }));

    return createOverviewResponse({
        snapshot,
        stories,
        report,
        reviewEnabled
    });
};

module.exports = {
    MARKET_GYAN_DISCLAIMER,
    createOverviewResponse,
    loadOverview
};

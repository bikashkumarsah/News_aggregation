const { marketGyanConfig } = require('../config');
const { isReviewRequestAllowed } = require('../middleware/reviewAccess');
const MarketReport = require('../models/MarketReport');
const MarketSnapshot = require('../models/MarketSnapshot');

const isLocalReportGenerationAllowed = (req, {
    enabled = marketGyanConfig.reviewEnabled,
    nodeEnv = process.env.NODE_ENV
} = {}) => isReviewRequestAllowed(req, { enabled, nodeEnv });

const createRuntimeStatus = ({
    req,
    latestReport = null,
    latestSnapshot = null,
    config = marketGyanConfig
} = {}) => ({
    queryEnabled: Boolean(config.queryEnabled),
    reviewEnabled: isReviewRequestAllowed(req, { enabled: config.reviewEnabled }),
    localReportGenerationAllowed: isLocalReportGenerationAllowed(req, {
        enabled: config.reviewEnabled
    }),
    agentTokenConfigured: Boolean(config.agentServiceToken),
    qdrantCollection: config.qdrantCollection,
    latestReportStatus: latestReport?.status || null,
    latestReportDate: latestReport?.reportDate || null,
    latestSnapshotStatus: latestSnapshot?.status || null,
    latestSnapshotDate: latestSnapshot?.marketDate || null
});

const loadRuntimeStatus = async (req) => {
    const [latestReport, latestSnapshot] = await Promise.all([
        MarketReport.findOne({ status: 'published' })
            .sort({ reportDate: -1 })
            .select('status reportDate')
            .lean(),
        MarketSnapshot.findOne()
            .sort({ marketDate: -1 })
            .select('status marketDate')
            .lean()
    ]);
    return createRuntimeStatus({ req, latestReport, latestSnapshot });
};

module.exports = {
    createRuntimeStatus,
    isLocalReportGenerationAllowed,
    loadRuntimeStatus
};

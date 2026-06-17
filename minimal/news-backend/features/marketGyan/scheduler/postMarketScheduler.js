const cron = require('node-cron');
const { marketGyanConfig } = require('../config');
const { runIngestion } = require('../services/ingestionService');
const { indexMarketDocuments } = require('../services/marketQdrantService');
const { generateDailyReport } = require('../services/reportService');
const { deliverMarketGyanDigest } = require('../services/marketDigestService');
const { kathmanduDate } = require('../collectors/marketCollectors');

let postMarketJob = null;

const runPostMarketWorkflow = async ({
    date = kathmanduDate(),
    ingest = runIngestion,
    index = indexMarketDocuments,
    generateReport = generateDailyReport,
    deliverDigest = deliverMarketGyanDigest,
    config = marketGyanConfig
} = {}) => {
    const ingestion = await ingest({ from: date, to: date });
    const indexing = await index({ limit: 1000 });
    if (!config.queryEnabled) {
        return {
            ingestion,
            indexing,
            report: { skipped: true, reason: 'runtime inference disabled' },
            digest: { skipped: true }
        };
    }

    const generated = await generateReport({ date });
    await index({ limit: 100, force: false });
    const digest = await deliverDigest(generated.report);
    return {
        ingestion,
        indexing,
        report: {
            id: generated.report._id,
            status: generated.report.status,
            reused: generated.reused
        },
        digest
    };
};

const startMarketGyanPostMarketScheduler = () => {
    if (!marketGyanConfig.postMarketSchedulerEnabled) {
        console.log('Market Gyan post-market scheduler is disabled');
        return null;
    }

    if (!cron.validate(marketGyanConfig.postMarketCron)) {
        throw new Error(
            `Invalid MARKET_GYAN_POST_MARKET_CRON: ${marketGyanConfig.postMarketCron}`
        );
    }

    postMarketJob = cron.schedule(
        marketGyanConfig.postMarketCron,
        async () => {
            try {
                const result = await runPostMarketWorkflow();
                console.log(`Market Gyan post-market workflow completed: ${JSON.stringify(result)}`);
            } catch (error) {
                console.error('Market Gyan post-market workflow failed:', error.message);
            }
        },
        {
            scheduled: true,
            timezone: marketGyanConfig.timezone
        }
    );

    console.log(
        `Market Gyan ingestion scheduler enabled (${marketGyanConfig.postMarketCron}, ${marketGyanConfig.timezone})`
    );

    return postMarketJob;
};

const stopMarketGyanPostMarketScheduler = () => {
    if (postMarketJob) {
        postMarketJob.stop();
        postMarketJob = null;
    }
};

module.exports = {
    runPostMarketWorkflow,
    startMarketGyanPostMarketScheduler,
    stopMarketGyanPostMarketScheduler
};

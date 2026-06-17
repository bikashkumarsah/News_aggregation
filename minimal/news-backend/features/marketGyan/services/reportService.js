const MarketDocument = require('../models/MarketDocument');
const MarketReport = require('../models/MarketReport');
const MarketSnapshot = require('../models/MarketSnapshot');
const { marketGyanConfig } = require('../config');
const { createAgentClient } = require('./agentClientService');
const { contentHash } = require('./textService');

const reportDay = (value) => new Date(`${new Date(value).toISOString().slice(0, 10)}T00:00:00.000Z`);

const reportAsText = (report) => [
    report.headline,
    report.summary,
    ...(report.sectorAnalysis || []).map((item) => (
        `${item.sector}: ${item.sentiment}. ${item.summary || ''}`
    )),
    ...(report.evidence || []).map((item) => (
        `Source: ${item.title}. ${item.excerpt || ''}`
    ))
].filter(Boolean).join('\n\n');

const archivePublishedReport = async (report) => {
    const date = report.reportDate.toISOString().slice(0, 10);
    const text = reportAsText(report);
    return MarketDocument.findOneAndUpdate(
        { 'source.url': `market-gyan://reports/${date}` },
        {
            $set: {
                documentType: 'archived_report',
                title: report.headline,
                language: 'en',
                source: {
                    name: 'Market Gyan',
                    url: `market-gyan://reports/${date}`,
                    section: 'daily-report',
                    publishedAt: report.reportDate,
                    retrievedAt: new Date()
                },
                text: {
                    original: text,
                    cleaned: text,
                    extractionMethod: 'generated_report',
                    contentHash: contentHash(report.headline, text)
                },
                metadata: {
                    sectors: (report.sectorAnalysis || []).map((item) => item.sector),
                    tags: ['daily market report']
                },
                ingestion: {
                    status: 'complete',
                    sourceId: report._id.toString()
                }
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

const generateDailyReport = async ({
    date = new Date(),
    force = false,
    agentClient = createAgentClient()
} = {}) => {
    const normalizedDate = reportDay(date);
    const existing = await MarketReport.findOne({ reportDate: normalizedDate });
    if (existing?.status === 'published' && !force) {
        return { report: existing, reused: true };
    }

    const report = existing || new MarketReport({ reportDate: normalizedDate });
    report.status = 'generating';
    report.generationError = undefined;
    await report.save();

    try {
        const snapshot = await MarketSnapshot.findOne({
            marketDate: { $lte: normalizedDate },
            status: { $in: ['complete', 'partial'] }
        }).sort({ marketDate: -1 }).lean();
        if (!snapshot) throw new Error('No Market Gyan snapshot is available for reporting');

        const result = await agentClient.run({
            mode: 'report',
            reportDate: normalizedDate.toISOString(),
            snapshot,
            filters: {
                to: normalizedDate.toISOString(),
                limit: 12
            }
        });

        report.marketSnapshot = snapshot._id;
        report.headline = result.headline;
        report.summary = result.summary;
        report.evidence = result.citations.map((citation) => ({
            document: citation.documentId,
            title: citation.title,
            sourceUrl: citation.url,
            excerpt: citation.excerpt,
            relevanceScore: citation.score
        }));
        report.sectorAnalysis = (result.sectorAnalysis || []).map((item) => ({
            sector: item.sector,
            sentiment: item.sentiment,
            summary: item.summary,
            confidence: item.confidence,
            evidenceIndexes: item.evidenceIndexes || []
        }));
        report.model = {
            provider: 'local-openai-compatible',
            name: marketGyanConfig.inferenceModel,
            version: result.modelVersion || 'unknown',
            generatedAt: new Date()
        };
        report.status = 'published';
        await report.save();
        const archivedDocument = await archivePublishedReport(report);
        return { report, archivedDocument, reused: false };
    } catch (error) {
        report.status = 'failed';
        report.generationError = error.message;
        await report.save();
        throw error;
    }
};

const answerMarketQuery = async ({
    question,
    filters = {},
    agentClient = createAgentClient()
} = {}) => {
    if (!String(question || '').trim()) {
        const error = new Error('question is required');
        error.status = 400;
        throw error;
    }
    return agentClient.run({
        mode: 'query',
        question: String(question).trim(),
        filters
    });
};

module.exports = {
    answerMarketQuery,
    archivePublishedReport,
    generateDailyReport,
    reportAsText,
    reportDay
};

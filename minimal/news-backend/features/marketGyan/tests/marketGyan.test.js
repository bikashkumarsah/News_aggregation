const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const MarketSnapshot = require('../models/MarketSnapshot');
const MarketDocument = require('../models/MarketDocument');
const MarketReport = require('../models/MarketReport');
const {
    MARKET_GYAN_DISCLAIMER,
    createOverviewResponse
} = require('../services/overviewService');

test('overview response remains stable during the data-pipeline phase', () => {
    assert.deepEqual(createOverviewResponse(), {
        success: true,
        phase: 'data-pipeline',
        data: {
            snapshot: null,
            sectors: [],
            stories: [],
            report: null,
            queryEnabled: false,
            reviewEnabled: false
        },
        disclaimer: MARKET_GYAN_DISCLAIMER
    });
});

test('market label rejects unsupported queue states', () => {
    const MarketLabel = require('../models/MarketLabel');
    const label = new MarketLabel({
        document: new mongoose.Types.ObjectId(),
        idempotencyKey: 'test-key',
        status: 'auto_published',
        input: {
            title: 'Example',
            excerpt: 'Example evidence text for the market.',
            contentHash: 'hash'
        }
    });

    const error = label.validateSync();

    assert.ok(error);
    assert.match(error.message, /status/);
});

test('market snapshot rejects unsupported sector sentiment', () => {
    const snapshot = new MarketSnapshot({
        marketDate: new Date('2026-06-11T00:00:00.000Z'),
        sectors: [{
            name: 'Hydropower',
            sentiment: 'certain-profit'
        }]
    });

    const error = snapshot.validateSync();

    assert.ok(error);
    assert.match(error.message, /sentiment/);
});

test('market document requires either an Article reference or original text', () => {
    const document = new MarketDocument({
        documentType: 'regulatory_notice',
        title: 'Example notice',
        language: 'ne',
        source: {
            name: 'SEBON',
            url: 'https://example.com/notice'
        }
    });

    const error = document.validateSync();

    assert.ok(error);
    assert.ok(error.errors.article);
    assert.ok(error.errors['text.original']);
});

test('financial news can reference an existing Article without duplicating text', () => {
    const document = new MarketDocument({
        documentType: 'financial_news',
        article: new mongoose.Types.ObjectId(),
        title: 'NEPSE closes higher',
        language: 'en',
        source: {
            name: 'Example Finance',
            url: 'https://example.com/news'
        },
        text: {
            extractionMethod: 'article_reference'
        }
    });

    assert.equal(document.validateSync(), undefined);
});

test('market report constrains evidence scores to a zero-to-one range', () => {
    const report = new MarketReport({
        reportDate: new Date('2026-06-11T00:00:00.000Z'),
        evidence: [{
            title: 'Market source',
            sourceUrl: 'https://example.com/source',
            relevanceScore: 1.2
        }]
    });

    const error = report.validateSync();

    assert.ok(error);
    assert.match(error.message, /relevanceScore/);
});

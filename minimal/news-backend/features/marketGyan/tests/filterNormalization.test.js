const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildSearchFilter,
    buildChunkPayloads
} = require('../services/marketQdrantService');
const {
    resolveSector,
    resolveSource,
    validateFilters,
    availableFilters
} = require('../services/filterNormalizationService');
const mongoose = require('mongoose');

test('sector filter normalizes casing to the canonical value', () => {
    assert.equal(resolveSector('banking'), 'Banking');
    assert.equal(resolveSector('  HYDROPOWER '), 'Hydropower');
    assert.equal(resolveSector('not-a-sector'), null);

    const filter = buildSearchFilter({ sector: 'banking' });
    const sectorClause = filter.must.find((item) => item.key === 'sectors');
    assert.deepEqual(sectorClause.match, { value: 'Banking' });
});

test('source filter resolves human aliases and drifting stored names', () => {
    assert.equal(resolveSource('share sansar').key, 'sharesansar');
    assert.equal(resolveSource('Online Khabar').key, 'onlinekhabar');
    // Real stored source names follow the RSS feed title and must still resolve.
    assert.equal(resolveSource('बिजनेस – Page 20 – Online Khabar').key, 'onlinekhabar');
    assert.equal(resolveSource('unknown-source'), null);

    const filter = buildSearchFilter({ source: 'share sansar' });
    const sourceClause = filter.must.find((item) => Array.isArray(item.should));
    assert.ok(sourceClause, 'source clause should use nested should');
    assert.ok(sourceClause.should.some((clause) => clause.key === 'sourceKey'));
    assert.ok(sourceClause.should.some((clause) => clause.key === 'source'));
});

test('unknown filter values are ignored in the Qdrant filter but reported by validateFilters', () => {
    const filter = buildSearchFilter({ sector: 'nonsense', source: 'nowhere' });
    assert.equal(filter, undefined);

    const { errors } = validateFilters({ sector: 'nonsense', source: 'nowhere', language: 'xx' });
    assert.equal(errors.length, 3);
    assert.match(errors[0], /Unknown sector/);
});

test('indexed chunk payload carries a canonical sourceKey', () => {
    const document = {
        _id: new mongoose.Types.ObjectId(),
        documentType: 'financial_news',
        title: 'NEPSE update',
        language: 'en',
        source: {
            name: 'ShareSansar',
            url: 'https://example.com/story',
            publishedAt: new Date('2026-06-13T00:00:00.000Z')
        },
        text: { cleaned: 'NEPSE closed higher today.', contentHash: 'hash' },
        metadata: { sectors: ['Banking'] }
    };
    const [chunk] = buildChunkPayloads(document);
    assert.equal(chunk.payload.sourceKey, 'sharesansar');
});

test('availableFilters exposes canonical options for the frontend', () => {
    const options = availableFilters();
    assert.ok(options.sectors.includes('Banking'));
    assert.ok(options.sources.some((source) => source.key === 'sharesansar'));
    assert.deepEqual(options.documentTypes, [
        'financial_news',
        'regulatory_notice',
        'policy_document',
        'archived_report'
    ]);
    assert.deepEqual(options.languages, ['en', 'ne', 'mixed']);
});

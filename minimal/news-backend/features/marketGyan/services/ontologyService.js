const aliasData = require('../ontology/security-aliases.v1.json');
const MarketSecurity = require('../models/MarketSecurity');
const { ontologyPayload } = require('./taxonomyService');

const languageForAlias = (value) => (
    /[\u0900-\u097F]/u.test(String(value || '')) ? 'ne' : 'en'
);

const shortEnglishName = (name) => String(name || '')
    .replace(/\b(limited|ltd\.?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const syncSecurityAliases = async () => {
    const securities = await MarketSecurity.find({ active: true })
        .select('symbol name aliases')
        .lean();
    if (!securities.length) return { considered: 0, updated: 0 };

    const operations = securities.map((security) => {
        const values = Array.from(new Set([
            security.name,
            shortEnglishName(security.name),
            ...(aliasData.aliases[security.symbol] || [])
        ].filter(Boolean)));
        return {
            updateOne: {
                filter: { _id: security._id },
                update: {
                    $set: {
                        aliases: values.map((value) => ({
                            value,
                            language: languageForAlias(value),
                            kind: value === security.name
                                ? 'company_name'
                                : languageForAlias(value) === 'ne'
                                    ? 'transliteration'
                                    : 'short_name',
                            sources: [
                                value === security.name
                                    ? 'market-security-registry'
                                    : aliasData.version
                            ]
                        }))
                    }
                }
            }
        };
    });
    const result = await MarketSecurity.bulkWrite(operations);
    return {
        considered: securities.length,
        updated: result.modifiedCount || 0,
        aliasVersion: aliasData.version
    };
};

const getVersionedOntology = async () => {
    const securities = await MarketSecurity.find({ active: true })
        .select('symbol name sector aliases')
        .sort({ symbol: 1 })
        .lean();
    return {
        ...ontologyPayload(),
        securityAliasVersion: aliasData.version,
        securities: securities.map((security) => ({
            symbol: security.symbol,
            name: security.name,
            sector: security.sector,
            aliases: (security.aliases || []).map((alias) => ({
                value: alias.value,
                language: alias.language
            }))
        }))
    };
};

module.exports = {
    getVersionedOntology,
    languageForAlias,
    shortEnglishName,
    syncSecurityAliases
};

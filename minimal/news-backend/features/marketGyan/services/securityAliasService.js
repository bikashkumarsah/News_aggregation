const { normalizeSymbol } = require('./taxonomyService');

const normalizeAlias = (value) => String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();

const securityAliases = (security) => Array.from(new Set([
    security.symbol,
    security.name,
    ...(security.aliases || []).map((alias) => alias.value)
].filter(Boolean)));

const findMentionedSecurities = (input, securities) => {
    const source = normalizeAlias(`${input.title || ''} ${input.excerpt || ''}`);
    const padded = ` ${source} `;
    const compact = source.replace(/\s+/g, '');
    const matches = [];
    for (const security of securities || []) {
        const aliases = securityAliases(security);
        const matchedAlias = aliases.find((alias) => {
            const normalized = normalizeAlias(alias);
            const devanagari = /[\u0900-\u097F]/u.test(normalized);
            return normalized.length >= 2 && (
                padded.includes(` ${normalized} `)
                || (devanagari && compact.includes(normalized.replace(/\s+/g, '')))
            );
        });
        if (matchedAlias) {
            matches.push({
                symbol: normalizeSymbol(security.symbol),
                name: security.name || '',
                sector: security.sector || '',
                matchedAlias
            });
        }
    }
    return matches;
};

module.exports = {
    findMentionedSecurities,
    normalizeAlias,
    securityAliases
};

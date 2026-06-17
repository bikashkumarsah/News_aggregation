const ONTOLOGY_VERSION = 'nepse-impact-ontology-v1';

const CANONICAL_SECTORS = Object.freeze([
    'Banking',
    'Development Bank',
    'Finance',
    'Hotels and Tourism',
    'Hydropower',
    'Investment',
    'Life Insurance',
    'Manufacturing and Processing',
    'Microfinance',
    'Mutual Fund',
    'Non-Life Insurance',
    'Others',
    'Trading'
]);

const RELEVANCE_VALUES = Object.freeze([
    'direct',
    'indirect',
    'not_relevant'
]);

const EVENT_TYPES = Object.freeze([
    'market_trading',
    'earnings',
    'capital_action',
    'governance',
    'project_operations',
    'credit_financing',
    'regulation',
    'monetary_liquidity',
    'fiscal_macroeconomic',
    'sector_industry',
    'other',
    'not_applicable'
]);

const IMPACT_SCOPES = Object.freeze([
    'company',
    'sector',
    'market',
    'none'
]);

const IMPACT_DIRECTIONS = Object.freeze([
    'bullish',
    'bearish',
    'neutral',
    'uncertain',
    'not_applicable'
]);

const IMPACT_HORIZONS = Object.freeze([
    'immediate',
    'short_term',
    'medium_term',
    'not_applicable'
]);

const IMPACT_MECHANISMS = Object.freeze([
    'earnings_cash_flow',
    'ownership_supply',
    'financing_liquidity',
    'regulation',
    'demand_revenue',
    'operations_capacity',
    'valuation_sentiment',
    'market_flow',
    'uncertain',
    'none'
]);

const CONFIDENCE_BANDS = Object.freeze(['low', 'medium', 'high']);
const LANGUAGES = Object.freeze(['en', 'ne', 'mixed']);

const INSTITUTIONS = Object.freeze([
    {
        code: 'NEPSE',
        name: 'Nepal Stock Exchange',
        aliases: ['NEPSE', 'Nepal Stock Exchange', 'नेपाल स्टक एक्सचेन्ज', 'नेप्से']
    },
    {
        code: 'SEBON',
        name: 'Securities Board of Nepal',
        aliases: ['SEBON', 'Securities Board of Nepal', 'नेपाल धितोपत्र बोर्ड', 'सेबोन']
    },
    {
        code: 'NRB',
        name: 'Nepal Rastra Bank',
        aliases: ['NRB', 'Nepal Rastra Bank', 'नेपाल राष्ट्र बैंक']
    },
    {
        code: 'CDSC',
        name: 'CDS and Clearing Limited',
        aliases: ['CDSC', 'CDS and Clearing', 'सिडिएस एण्ड क्लियरिङ', 'मेरो शेयर']
    }
]);

const MARKET_TERMS = Object.freeze({
    broker: ['broker', 'stock broker', 'दलाल', 'ब्रोकर'],
    issueManager: ['issue manager', 'merchant banker', 'निष्कासन तथा बिक्री प्रबन्धक'],
    ipo: ['IPO', 'initial public offering', 'प्राथमिक सार्वजनिक निष्कासन', 'आइपिओ'],
    fpo: ['FPO', 'follow-on public offering', 'एफपिओ'],
    rightShare: ['right share', 'rights issue', 'हकप्रद शेयर'],
    bonusShare: ['bonus share', 'stock dividend', 'बोनस शेयर'],
    dividend: ['dividend', 'cash dividend', 'लाभांश', 'नगद लाभांश'],
    listing: ['listed shares', 'share listing', 'सूचीकृत', 'शेयर सूचीकरण'],
    allotment: ['allotment', 'share allocation', 'बाँडफाँट', 'शेयर बाँडफाँट'],
    bookClosure: ['book closure', 'बुक क्लोज'],
    agm: ['AGM', 'annual general meeting', 'वार्षिक साधारण सभा']
});

const normalizeEnumValue = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, '_');

const normalizeSymbol = (value) => String(value || '').trim().toUpperCase();

const normalizeSector = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return CANONICAL_SECTORS.find((sector) => sector.toLowerCase() === normalized) || null;
};

const ontologyPayload = () => ({
    version: ONTOLOGY_VERSION,
    sectors: CANONICAL_SECTORS,
    relevance: RELEVANCE_VALUES,
    eventTypes: EVENT_TYPES,
    impactScopes: IMPACT_SCOPES,
    impactDirections: IMPACT_DIRECTIONS,
    impactHorizons: IMPACT_HORIZONS,
    impactMechanisms: IMPACT_MECHANISMS,
    confidenceBands: CONFIDENCE_BANDS,
    languages: LANGUAGES,
    institutions: INSTITUTIONS,
    marketTerms: MARKET_TERMS
});

module.exports = {
    CANONICAL_SECTORS,
    CONFIDENCE_BANDS,
    EVENT_TYPES,
    IMPACT_DIRECTIONS,
    IMPACT_HORIZONS,
    IMPACT_MECHANISMS,
    IMPACT_SCOPES,
    INSTITUTIONS,
    LANGUAGES,
    MARKET_TERMS,
    ONTOLOGY_VERSION,
    RELEVANCE_VALUES,
    normalizeEnumValue,
    normalizeSector,
    normalizeSymbol,
    ontologyPayload
};

const MarketDocument = require('../models/MarketDocument');
const MarketSecurity = require('../models/MarketSecurity');
const { contentHash } = require('./textService');
const { findMentionedSecurities, normalizeAlias } = require('./securityAliasService');
const { sourceKeyFromName } = require('./sourcePlanningService');

const TARGETS = Object.freeze({
    direct: 300,
    indirect: 100,
    hard_negative: 100
});

const CORE_EVENT_TYPES = Object.freeze([
    'market_trading',
    'earnings',
    'capital_action',
    'governance',
    'project_operations',
    'credit_financing',
    'regulation',
    'monetary_liquidity',
    'fiscal_macroeconomic',
    'sector_industry'
]);

const DEFAULT_REQUIREMENTS = Object.freeze({
    minimumLanguages: Object.freeze({
        en: 200,
        ne: 200
    }),
    minimumSymbolLevel: 150,
    minimumEventCount: 20
});

const DIRECT_PATTERNS = Object.freeze({
    market_trading: /\b(nepse|stock market|share market|turnover|index|sub-index|circuit)\b|नेप्से|शेयर बजार|कारोबार|परिसूचक/iu,
    earnings: /\b(profit|loss|earnings|financial result|net income|eps|quarterly report)\b|नाफा|नोक्सानी|वित्तीय विवरण|प्रतिशेयर आम्दानी/iu,
    project_operations: /\b(commercial operation|trial production|power generation|generation resumption|production capacity|plant shutdown|survey licen[cs]e|solar pv|commissioning|power purchase agreement)\b|व्यावसायिक उत्पादन|परीक्षण उत्पादन|विद्युत उत्पादन|उत्पादन सुरु|उत्पादन बन्द|क्षमता विस्तार|आयोजना सम्पन्न|जलविद्युत.{0,40}सञ्चालन/iu,
    credit_financing: /\b(credit rating|loan agreement|loan facility|credit facility|project finance|financial closure|debt financing|debenture|bond issue|bond maturity|debenture maturity|lending agreement|syndicated loan|unsecured debt)\b|कर्जा|ऋण सम्झौता|ऋण लगानी|वित्तीय समापन|ऋणपत्र|डिबेन्चर|क्रेडिट रेटिङ/iu,
    capital_action: /\b(dividend|bonus share|right share|ipo|fpo|allotment|book closure|listed shares|share listing)\b|लाभांश|बोनस|हकप्रद|आइपिओ|एफपिओ|बाँडफाँट|सूचीकृत/iu,
    governance: /\b(agm|annual general meeting|board meeting|director|chief executive|ceo|merger|acquisition)\b|साधारण सभा|सञ्चालक|प्रमुख कार्यकारी|मर्जर|प्राप्ति/iu
});

const INDIRECT_PATTERNS = Object.freeze({
    regulation: /\b(sebon|securities board|regulation|directive|capital market rule)\b|धितोपत्र बोर्ड|नियमन|निर्देशन/iu,
    monetary_liquidity: /\b(nrb|rastra bank|monetary policy|liquidity|policy rate|bank rate|crr|slr)\b|राष्ट्र बैंक|मौद्रिक नीति|तरलता|नीतिगत दर|बैंक दर/iu,
    fiscal_macroeconomic: /\b(budget|tax|gdp|inflation|remittance|fiscal|customs duty)\b|बजेट|कर|मुद्रास्फीति|रेमिट्यान्स|भन्सार/iu,
    sector_industry: /\b(hydropower|energy sector|banking|insurance|tourism|hotel industry|manufacturing|cement|microfinance|development bank sector|finance company sector|telecom|aviation|electricity demand|industry capacity)\b|जलविद्युत|ऊर्जा क्षेत्र|बैंकिङ|बिमा|बीमा|पर्यटन|होटल उद्योग|उद्योग|लघुवित्त|विकास बैंक क्षेत्र|वित्त कम्पनी क्षेत्र|सिमेन्ट|दूरसञ्चार|हवाई क्षेत्र/iu
});

const NEGATIVE_PATTERNS = /\b(advertisement|vacancy|recruitment|workshop|training|promotion|smartphone|foreign company|lifestyle|recipe|fashion|movie|rescue)\b|विज्ञापन|रोजगारी|तालिम|कार्यशाला|अफर|मोबाइल|फेसन|चलचित्र|उद्धार/iu;

const inferEventHint = (text, patterns) => Object.entries(patterns)
    .find(([, pattern]) => pattern.test(text))?.[0] || null;

const duplicateGroupIdForDocument = (document) => {
    const title = normalizeAlias(document.title).split(/\s+/).slice(0, 14).join(' ');
    return contentHash(title || document.text?.contentHash || document._id).slice(0, 24);
};

const classifyDocumentForSelection = (document, securities = []) => {
    const text = `${document.title || ''} ${document.text?.cleaned || document.text?.original || ''}`;
    const source = sourceKeyFromName(document.source?.name);
    const mentions = findMentionedSecurities({
        title: document.title,
        excerpt: document.text?.cleaned || document.text?.original
    }, securities);
    const directHint = inferEventHint(text, DIRECT_PATTERNS);
    const indirectHint = inferEventHint(text, INDIRECT_PATTERNS);
    const shareSansarPriority = source === 'sharesansar'
        && /dividend|allotment|ipo|fpo|listed|financial|stock|nepse/i
            .test(document.source?.section || '');

    let bucket = 'reserve';
    let score = 0;
    let eventHint = directHint || indirectHint || 'other';
    if (mentions.length && (directHint || shareSansarPriority)) {
        bucket = 'direct';
        score = 100 + mentions.length * 10 + (shareSansarPriority ? 15 : 0);
    } else if (directHint && source === 'sharesansar') {
        bucket = 'direct';
        score = 80 + (shareSansarPriority ? 15 : 0);
    } else if (directHint && ['onlinekhabar', 'kathmandupost'].includes(source)) {
        bucket = 'indirect';
        score = 55;
    } else if (indirectHint) {
        bucket = 'indirect';
        score = 60 + (source === 'regulatory' ? 20 : 0);
    } else if (NEGATIVE_PATTERNS.test(text) || ['onlinekhabar', 'kathmandupost'].includes(source)) {
        bucket = 'hard_negative';
        score = NEGATIVE_PATTERNS.test(text) ? 70 : 30;
        eventHint = 'not_applicable';
    }

    const publishedAt = document.source?.publishedAt
        ? new Date(document.source.publishedAt).getTime()
        : 0;
    return {
        documentId: document._id.toString(),
        contentHash: document.text?.contentHash || contentHash(text),
        bucket,
        eventHint,
        score,
        source,
        language: document.language,
        symbolCount: mentions.length,
        symbols: mentions.map((item) => item.symbol),
        publishedAt,
        duplicateGroupId: duplicateGroupIdForDocument(document)
    };
};

const selectImpactCorpus = (classified, {
    targets = TARGETS,
    maxSourceShare = 0.6,
    secondReviewTarget = 110,
    requirements = DEFAULT_REQUIREMENTS
} = {}) => {
    const countRows = (rows, field) => rows.reduce((result, row) => {
        const key = row[field] || 'unknown';
        result[key] = (result[key] || 0) + 1;
        return result;
    }, {});
    const uniqueClassified = Array.from(
        [...classified]
            .sort((a, b) => (
                b.score - a.score
                || a.publishedAt - b.publishedAt
                || a.documentId.localeCompare(b.documentId)
            ))
            .reduce((result, row) => {
                const key = row.contentHash || row.documentId;
                if (!result.has(key)) result.set(key, row);
                return result;
            }, new Map())
            .values()
    );
    const totalTarget = Object.values(targets).reduce((sum, count) => sum + count, 0);
    const sourceCap = Math.floor(totalTarget * maxSourceShare);
    const selected = [];
    const selectedIds = new Set();
    const sourceCounts = {};
    const eventCounts = {};
    const languageCounts = {};
    let symbolLevelCount = 0;

    const add = (row) => {
        selected.push(row);
        selectedIds.add(row.documentId);
        sourceCounts[row.source] = (sourceCounts[row.source] || 0) + 1;
        eventCounts[row.eventHint] = (eventCounts[row.eventHint] || 0) + 1;
        languageCounts[row.language] = (languageCounts[row.language] || 0) + 1;
        if (row.symbolCount > 0) symbolLevelCount += 1;
    };

    const selectionPriority = (row) => {
        const eventNeeded = CORE_EVENT_TYPES.includes(row.eventHint)
            && (eventCounts[row.eventHint] || 0) < requirements.minimumEventCount;
        const languageTarget = requirements.minimumLanguages[row.language] || 0;
        const languageNeeded = (languageCounts[row.language] || 0) < languageTarget;
        const symbolNeeded = row.symbolCount > 0
            && symbolLevelCount < requirements.minimumSymbolLevel;
        return Number(row.score || 0)
            + (eventNeeded ? 5000 : 0)
            + (languageNeeded ? 1000 : 0)
            + (symbolNeeded ? 250 : 0);
    };

    const take = (bucket, target) => {
        while (selected.filter((item) => item.bucket === bucket).length < target) {
            const candidate = uniqueClassified
                .filter((row) => (
                    row.bucket === bucket
                    && !selectedIds.has(row.documentId)
                    && (sourceCounts[row.source] || 0) < sourceCap
                ))
                .sort((a, b) => (
                    selectionPriority(b) - selectionPriority(a)
                    || a.publishedAt - b.publishedAt
                    || a.documentId.localeCompare(b.documentId)
                ))[0];
            if (!candidate) break;
            add(candidate);
        }
    };

    for (const bucket of ['direct', 'indirect', 'hard_negative']) {
        take(bucket, targets[bucket]);
    }

    const missing = totalTarget - selected.length;
    if (missing > 0) {
        const reserves = uniqueClassified
            .filter((row) => !selectedIds.has(row.documentId))
            .sort((a, b) => (
                selectionPriority(b) - selectionPriority(a)
                || a.publishedAt - b.publishedAt
            ));
        for (const row of reserves) {
            if (selected.length >= totalTarget) break;
            if ((sourceCounts[row.source] || 0) >= sourceCap) continue;
            add({ ...row, originalBucket: row.bucket, bucket: 'reserve' });
        }
    }

    const strata = new Map();
    for (const row of selected) {
        const key = `${row.bucket}:${row.language}:${row.eventHint}`;
        if (!strata.has(key)) strata.set(key, []);
        strata.get(key).push(row);
    }
    const orderedStrata = Array.from(strata.values());
    let secondSelected = 0;
    let cursor = 0;
    while (secondSelected < Math.min(secondReviewTarget, selected.length)
        && orderedStrata.length) {
        const group = orderedStrata[cursor % orderedStrata.length];
        const candidate = group.shift();
        if (candidate && !candidate.secondReviewRequired) {
            candidate.secondReviewRequired = true;
            secondSelected += 1;
        }
        if (!group.length) {
            orderedStrata.splice(cursor % orderedStrata.length, 1);
        } else {
            cursor += 1;
        }
    }

    const counts = (field) => selected.reduce((result, row) => {
        const key = row[field] || 'unknown';
        result[key] = (result[key] || 0) + 1;
        return result;
    }, {});
    const bucketCounts = counts('bucket');
    const quotaChecks = {
        target: selected.length === totalTarget,
        bucketComposition: Object.entries(targets).every(([bucket, count]) => (
            (bucketCounts[bucket] || 0) === count
        )),
        noReserves: (bucketCounts.reserve || 0) === 0,
        sourceCap: Math.max(0, ...Object.values(sourceCounts)) <= sourceCap,
        languageCoverage: Object.entries(requirements.minimumLanguages)
            .every(([language, minimum]) => (
                (languageCounts[language] || 0) >= minimum
            )),
        symbolCoverage: symbolLevelCount >= requirements.minimumSymbolLevel,
        eventCoverage: CORE_EVENT_TYPES.every((eventType) => (
            (eventCounts[eventType] || 0) >= requirements.minimumEventCount
        ))
    };
    const quotaDeficits = {
        target: Math.max(0, totalTarget - selected.length),
        bucket: Object.fromEntries(Object.entries(targets).map(([bucket, target]) => [
            bucket,
            Math.max(0, target - (bucketCounts[bucket] || 0))
        ])),
        language: Object.fromEntries(
            Object.entries(requirements.minimumLanguages).map(([language, minimum]) => [
                language,
                Math.max(0, minimum - (languageCounts[language] || 0))
            ])
        ),
        symbolLevel: Math.max(0, requirements.minimumSymbolLevel - symbolLevelCount),
        event: Object.fromEntries(CORE_EVENT_TYPES.map((eventType) => [
            eventType,
            Math.max(0, requirements.minimumEventCount - (eventCounts[eventType] || 0))
        ])),
        reserveRows: bucketCounts.reserve || 0,
        sourceOverage: Object.fromEntries(Object.entries(sourceCounts)
            .filter(([, count]) => count > sourceCap)
            .map(([source, count]) => [source, count - sourceCap]))
    };
    return {
        target: totalTarget,
        selected,
        availableCounts: {
            total: uniqueClassified.length,
            excludedExactDuplicates: classified.length - uniqueClassified.length,
            bucket: countRows(uniqueClassified, 'bucket'),
            source: countRows(uniqueClassified, 'source'),
            language: countRows(uniqueClassified, 'language'),
            eventHint: countRows(uniqueClassified, 'eventHint'),
            symbolLevel: uniqueClassified.filter((row) => row.symbolCount > 0).length
        },
        quotaCompliant: Object.values(quotaChecks).every(Boolean),
        quotaChecks,
        quotaDeficits,
        counts: {
            bucket: bucketCounts,
            source: sourceCounts,
            language: languageCounts,
            eventHint: eventCounts,
            symbolLevel: symbolLevelCount,
            secondReview: secondSelected
        },
        shortfall: Math.max(0, totalTarget - selected.length),
        sourceCap
    };
};

const planImpactCorpusFromDatabase = async (options = {}) => {
    const [documents, securities] = await Promise.all([
        MarketDocument.find({
            'ingestion.status': { $in: ['complete', 'partial'] },
            'source.publishedAt': {
                $gte: new Date(options.from || '2025-01-01T00:00:00.000Z'),
                $lte: new Date(options.to || '2026-06-15T23:59:59.999Z')
            }
        }).select('_id title language source text').lean(),
        MarketSecurity.find({ active: true }).select('symbol name sector aliases').lean()
    ]);
    return selectImpactCorpus(
        documents.map((document) => classifyDocumentForSelection(document, securities)),
        options
    );
};

module.exports = {
    CORE_EVENT_TYPES,
    DEFAULT_REQUIREMENTS,
    DIRECT_PATTERNS,
    INDIRECT_PATTERNS,
    NEGATIVE_PATTERNS,
    TARGETS,
    classifyDocumentForSelection,
    planImpactCorpusFromDatabase,
    selectImpactCorpus
};

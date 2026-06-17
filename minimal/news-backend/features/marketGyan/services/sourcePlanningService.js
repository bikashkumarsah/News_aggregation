const SOURCE_BUCKETS = Object.freeze([
    'sharesansar',
    'onlinekhabar',
    'kathmandupost',
    'regulatory'
]);

const PREFERRED_TARGETS = Object.freeze({
    sharesansar: 220,
    onlinekhabar: 150,
    kathmandupost: 30,
    regulatory: 50
});

const sourceKeyFromName = (name) => {
    const value = String(name || '').toLowerCase();
    if (value.includes('sharesansar')) return 'sharesansar';
    if (value.includes('online khabar')) return 'onlinekhabar';
    if (value.includes('kathmandu post')) return 'kathmandupost';
    if (value.includes('sebon') || value.includes('rastra bank')) return 'regulatory';
    return 'other';
};

const sourceNameFilter = (source) => {
    const sources = Array.isArray(source)
        ? source
        : String(source || '').split(',').filter(Boolean);
    const patterns = sources.map((value) => {
        switch (String(value).trim().toLowerCase()) {
            case 'sharesansar':
                return /ShareSansar/i;
            case 'onlinekhabar':
                return /Online Khabar/i;
            case 'kathmandupost':
                return /Kathmandu Post/i;
            case 'regulatory':
                return /SEBON|Rastra Bank/i;
            default:
                return new RegExp(
                    String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                    'i'
                );
        }
    });
    if (!patterns.length) return null;
    return patterns.length === 1 ? patterns[0] : { $in: patterns };
};

const scaledPreferredTargets = (target) => {
    const total = Object.values(PREFERRED_TARGETS).reduce((sum, value) => sum + value, 0);
    const result = {};
    let assigned = 0;
    SOURCE_BUCKETS.forEach((source, index) => {
        if (index === SOURCE_BUCKETS.length - 1) {
            result[source] = target - assigned;
            return;
        }
        result[source] = Math.round((PREFERRED_TARGETS[source] / total) * target);
        assigned += result[source];
    });
    return result;
};

const planSourceTargets = ({
    target = 450,
    current = {},
    available = {},
    maxShare = 0.6
} = {}) => {
    const parsedTarget = Math.max(1, Number(target) || 450);
    const cap = Math.max(1, Math.floor(parsedTarget * maxShare));
    const preferred = scaledPreferredTargets(parsedTarget);
    const finalTargets = {};

    for (const source of SOURCE_BUCKETS) {
        const existing = Math.max(0, Number(current[source]) || 0);
        const capacity = existing + Math.max(0, Number(available[source]) || 0);
        finalTargets[source] = Math.min(
            Math.max(existing, preferred[source]),
            capacity,
            cap
        );
    }

    let deficit = Math.max(
        0,
        parsedTarget - Object.values(finalTargets).reduce((sum, value) => sum + value, 0)
    );
    for (const source of ['sharesansar', 'onlinekhabar', 'kathmandupost', 'regulatory']) {
        if (!deficit) break;
        const existing = Math.max(0, Number(current[source]) || 0);
        const capacity = Math.min(
            existing + Math.max(0, Number(available[source]) || 0),
            cap
        );
        const addition = Math.min(deficit, Math.max(0, capacity - finalTargets[source]));
        finalTargets[source] += addition;
        deficit -= addition;
    }

    const additions = Object.fromEntries(SOURCE_BUCKETS.map((source) => [
        source,
        Math.max(0, finalTargets[source] - (Number(current[source]) || 0))
    ]));
    return {
        target: parsedTarget,
        maxPerSource: cap,
        preferred,
        finalTargets,
        additions,
        achievable: deficit === 0,
        shortfall: deficit
    };
};

module.exports = {
    PREFERRED_TARGETS,
    SOURCE_BUCKETS,
    planSourceTargets,
    sourceKeyFromName,
    sourceNameFilter
};

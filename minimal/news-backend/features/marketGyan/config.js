const parseBoolean = (value, defaultValue = false) => {
    if (value === undefined) return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const parseInteger = (value, defaultValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return defaultValue;
    return Math.min(Math.max(parsed, min), max);
};

const marketGyanConfig = Object.freeze({
    qdrantCollection: process.env.MARKET_GYAN_QDRANT_COLLECTION || 'market_gyan_documents',
    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    timezone: process.env.MARKET_GYAN_TIMEZONE || 'Asia/Kathmandu',
    postMarketCron: process.env.MARKET_GYAN_POST_MARKET_CRON || '30 15 * * 0-4',
    postMarketSchedulerEnabled: parseBoolean(
        process.env.MARKET_GYAN_POST_MARKET_SCHEDULER_ENABLED,
        false
    ),
    digestEnabled: parseBoolean(
        process.env.MARKET_GYAN_DIGEST_ENABLED,
        false
    ),
    queryEnabled: parseBoolean(process.env.MARKET_GYAN_QUERY_ENABLED, false),
    agentServiceUrl: process.env.MARKET_GYAN_AGENT_SERVICE_URL
        || 'http://127.0.0.1:8100',
    agentServiceToken: process.env.MARKET_GYAN_AGENT_SERVICE_TOKEN || '',
    inferenceBaseUrl: process.env.MARKET_GYAN_INFERENCE_BASE_URL
        || 'http://127.0.0.1:8000/v1',
    inferenceApiKey: process.env.MARKET_GYAN_INFERENCE_API_KEY || 'local',
    inferenceModel: process.env.MARKET_GYAN_INFERENCE_MODEL
        || 'marketgyan-qwen3-8b',
    agentTimeoutMs: parseInteger(
        process.env.MARKET_GYAN_AGENT_TIMEOUT_MS,
        120000,
        { min: 1000, max: 600000 }
    ),
    reviewEnabled: parseBoolean(process.env.MARKET_GYAN_REVIEW_ENABLED, false),
    reviewerId: process.env.MARKET_GYAN_REVIEWER_ID || 'local-reviewer',
    reviewerRole: process.env.MARKET_GYAN_REVIEWER_ROLE || 'primary',
    reviewTarget: parseInteger(
        process.env.MARKET_GYAN_REVIEW_TARGET,
        500,
        { min: 1, max: 100000 }
    ),
    secondReviewTarget: parseInteger(
        process.env.MARKET_GYAN_SECOND_REVIEW_TARGET,
        110,
        { min: 1, max: 100000 }
    ),
    approvedTarget: parseInteger(
        process.env.MARKET_GYAN_APPROVED_TARGET,
        300,
        { min: 1, max: 100000 }
    ),
    minApprovedPerSentiment: parseInteger(
        process.env.MARKET_GYAN_MIN_APPROVED_PER_SENTIMENT,
        50,
        { min: 1, max: 100000 }
    ),
    structuringEnabled: parseBoolean(
        process.env.MARKET_GYAN_STRUCTURING_ENABLED,
        false
    ),
    gemmaModel: process.env.MARKET_GYAN_GEMMA_MODEL || 'gemma-4-26b-a4b-it',
    gemmaRpm: parseInteger(process.env.MARKET_GYAN_GEMMA_RPM, 15, {
        min: 1,
        max: 60
    }),
    gemmaConcurrency: parseInteger(
        process.env.MARKET_GYAN_GEMMA_CONCURRENCY,
        1,
        { min: 1, max: 4 }
    ),
    gemmaMaxAttempts: parseInteger(
        process.env.MARKET_GYAN_GEMMA_MAX_ATTEMPTS,
        4,
        { min: 1, max: 8 }
    ),
    gemmaBackoffBaseMs: parseInteger(
        process.env.MARKET_GYAN_GEMMA_BACKOFF_BASE_MS,
        5000,
        { min: 1000, max: 60000 }
    ),
    gemmaCircuitBreakerFailures: parseInteger(
        process.env.MARKET_GYAN_GEMMA_CIRCUIT_BREAKER_FAILURES,
        3,
        { min: 1, max: 20 }
    ),
    promptVersion: process.env.MARKET_GYAN_PROMPT_VERSION || 'market-impact-v2',
    schemaVersion: parseInteger(
        process.env.MARKET_GYAN_SCHEMA_VERSION,
        2,
        { min: 1, max: 100 }
    ),
    requestTimeoutMs: parseInteger(
        process.env.MARKET_GYAN_REQUEST_TIMEOUT_MS,
        90000,
        { min: 1000, max: 120000 }
    ),
    sourceThrottleMs: parseInteger(
        process.env.MARKET_GYAN_SOURCE_THROTTLE_MS,
        750,
        { min: 0, max: 30000 }
    ),
    qdrantChunkSize: parseInteger(
        process.env.MARKET_GYAN_QDRANT_CHUNK_SIZE,
        1200,
        { min: 300, max: 4000 }
    ),
    qdrantChunkOverlap: parseInteger(
        process.env.MARKET_GYAN_QDRANT_CHUNK_OVERLAP,
        150,
        { min: 0, max: 1000 }
    )
});

module.exports = {
    marketGyanConfig,
    parseBoolean,
    parseInteger
};

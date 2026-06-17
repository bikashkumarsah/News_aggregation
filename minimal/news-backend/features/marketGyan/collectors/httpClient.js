const fetch = require('node-fetch');
const { marketGyanConfig } = require('../config');

const DEFAULT_HEADERS = Object.freeze({
    'User-Agent': 'KhabarAI-MarketGyan/1.0 (+public research ingestion)',
    Accept: 'text/html,application/xhtml+xml,application/json,application/pdf'
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createHttpClient = ({
    fetchImpl = fetch,
    sleepFn = sleep,
    throttleMs = marketGyanConfig.sourceThrottleMs,
    timeoutMs = marketGyanConfig.requestTimeoutMs
} = {}) => {
    let lastRequestAt = 0;

    const request = async (url, {
        responseType = 'text',
        headers = {},
        retries = 2,
        returnMetadata = false
    } = {}) => {
        const elapsed = Date.now() - lastRequestAt;
        const waitMs = Math.max(0, throttleMs - elapsed);
        if (waitMs) await sleepFn(waitMs);

        let lastError;
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            lastRequestAt = Date.now();
            try {
                const response = await fetchImpl(url, {
                    headers: {
                        ...DEFAULT_HEADERS,
                        ...headers
                    },
                    timeout: timeoutMs
                });
                if (!response.ok) {
                    const error = new Error(`GET ${url} failed with ${response.status}`);
                    error.status = response.status;
                    throw error;
                }
                let body;
                if (responseType === 'buffer') body = await response.buffer();
                else if (responseType === 'json') body = await response.json();
                else body = await response.text();
                if (!returnMetadata) return body;
                return {
                    body,
                    url: response.url || url,
                    contentType: response.headers.get('content-type') || ''
                };
            } catch (error) {
                lastError = error;
                if (attempt === retries || (error.status && error.status < 500)) throw error;
                await sleepFn((attempt + 1) * 1000);
            }
        }
        throw lastError;
    };

    return { request };
};

module.exports = {
    DEFAULT_HEADERS,
    createHttpClient
};

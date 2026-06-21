const fetch = require('node-fetch');
const { marketGyanConfig } = require('../config');
const { MARKET_GYAN_DISCLAIMER } = require('./overviewService');

const forbiddenAdvice = /\b(guaranteed (profit|return)|recommend(?:s|ed)? (buying|selling)|buy signal|sell signal)\b/i;

const validateAgentResult = (result, { mode } = {}) => {
    const errors = [];
    if (!result || typeof result !== 'object') {
        return { valid: false, errors: ['Agent result must be an object'] };
    }
    if (!Array.isArray(result.citations) || !result.citations.length) {
        errors.push('At least one evidence citation is required');
    }
    for (const [index, citation] of (result.citations || []).entries()) {
        if (!citation?.documentId || !citation?.title || !citation?.url || !citation?.excerpt) {
            errors.push(`Citation ${index} requires documentId, title, url, and excerpt`);
        }
        if (citation?.sentenceIds !== undefined && !Array.isArray(citation.sentenceIds)) {
            errors.push(`Citation ${index} sentenceIds must be an array`);
        }
        if (Array.isArray(citation?.sentenceIds) && citation.sentenceIds.length) {
            if (!citation.chunkId || !citation.contentHash) {
                errors.push(`Citation ${index} with sentenceIds requires chunkId and contentHash`);
            }
            if (!Array.isArray(citation.sentences) || !citation.sentences.length) {
                errors.push(`Citation ${index} with sentenceIds requires expanded sentences`);
            } else {
                for (const sentence of citation.sentences) {
                    if (!sentence?.id || !sentence?.text) {
                        errors.push(`Citation ${index} sentence anchors require id and text`);
                    }
                }
            }
        }
    }
    if (mode === 'query' && !String(result.answer || '').trim()) {
        errors.push('Query result requires an answer');
    }
    if (mode === 'report') {
        if (!String(result.headline || '').trim()) errors.push('Report requires a headline');
        if (!String(result.summary || '').trim()) errors.push('Report requires a summary');
        if (!Array.isArray(result.sectorAnalysis)) {
            errors.push('Report sectorAnalysis must be an array');
        }
    }
    const generatedText = [
        result.answer,
        result.headline,
        result.summary,
        ...(result.sectorAnalysis || []).map((item) => item.summary)
    ].filter(Boolean).join(' ');
    if (forbiddenAdvice.test(generatedText)) {
        errors.push('Agent output contains prohibited investment advice');
    }
    if (result.disclaimer !== MARKET_GYAN_DISCLAIMER) {
        errors.push('Agent output must retain the Market Gyan disclaimer');
    }
    return { valid: !errors.length, errors };
};

const createAgentClient = ({
    fetchImpl = fetch,
    config = marketGyanConfig
} = {}) => ({
    run: async (payload) => {
        if (!config.queryEnabled) {
            const error = new Error('Market Gyan runtime inference is disabled');
            error.status = 503;
            throw error;
        }
        if (!config.agentServiceToken) {
            const error = new Error('MARKET_GYAN_AGENT_SERVICE_TOKEN is required');
            error.status = 503;
            throw error;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.agentTimeoutMs);
        let response;
        try {
            response = await fetchImpl(`${config.agentServiceUrl}/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-market-gyan-token': config.agentServiceToken
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } catch (error) {
            const wrapped = new Error(`Market Gyan agent service unavailable: ${error.message}`);
            wrapped.status = 503;
            throw wrapped;
        } finally {
            clearTimeout(timeout);
        }

        const text = await response.text();
        let parsed;
        try {
            parsed = text ? JSON.parse(text) : {};
        } catch {
            parsed = {};
        }
        if (!response.ok) {
            const error = new Error(parsed.detail || parsed.error || `Agent HTTP ${response.status}`);
            error.status = response.status >= 500 ? 503 : response.status;
            throw error;
        }
        const validation = validateAgentResult(parsed, { mode: payload.mode });
        if (!validation.valid) {
            const error = new Error('Agent returned an unsafe or invalid response');
            error.status = 502;
            error.validationErrors = validation.errors;
            throw error;
        }
        return parsed;
    }
});

module.exports = {
    createAgentClient,
    validateAgentResult
};

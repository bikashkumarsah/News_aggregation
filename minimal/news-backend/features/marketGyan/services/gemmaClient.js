const fetch = require('node-fetch');
const { marketGyanConfig } = require('../config');
const {
    CANONICAL_SECTORS,
    CONFIDENCE_BANDS,
    EVENT_TYPES,
    IMPACT_DIRECTIONS,
    IMPACT_HORIZONS,
    IMPACT_MECHANISMS,
    IMPACT_SCOPES,
    LANGUAGES,
    RELEVANCE_VALUES
} = require('./taxonomyService');
const { formatNumberedSentences, splitNumberedSentences } = require('./sentenceService');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class RequestPacer {
    constructor({ rpm = 15, sleepFn = sleep, now = Date.now } = {}) {
        this.minimumIntervalMs = Math.max(4000, Math.ceil(60000 / rpm));
        this.sleepFn = sleepFn;
        this.now = now;
        this.lastRequestAt = 0;
        this.waitQueue = Promise.resolve();
    }

    wait() {
        const operation = this.waitQueue.then(async () => {
            const elapsed = this.now() - this.lastRequestAt;
            const waitMs = Math.max(0, this.minimumIntervalMs - elapsed);
            if (waitMs) await this.sleepFn(waitMs);
            this.lastRequestAt = this.now();
            return waitMs;
        });
        this.waitQueue = operation.catch(() => {});
        return operation;
    }
}

const buildFunctionDeclaration = ({ allowedSymbols = [] } = {}) => ({
    name: 'structure_market_document',
    description: 'Return evidence-grounded Nepal market impact data for the supplied public document.',
    parameters: {
        type: 'OBJECT',
        properties: {
            language: {
                type: 'STRING',
                enum: ['en', 'ne', 'mixed']
            },
            summary: {
                type: 'STRING',
                description: 'A short factual summary with no investment recommendation.'
            },
            sentiment: {
                type: 'STRING',
                enum: ['bullish', 'bearish', 'neutral'],
                description: 'Likely market impact stated cautiously, not a trading recommendation.'
            },
            sectors: {
                type: 'ARRAY',
                items: {
                    type: 'STRING',
                    enum: CANONICAL_SECTORS
                },
                maxItems: 8
            },
            symbols: {
                type: 'ARRAY',
                items: allowedSymbols.length ? {
                    type: 'STRING',
                    enum: allowedSymbols
                } : {
                    type: 'STRING',
                    description: 'No recognized NEPSE symbol is present in the supplied text.'
                },
                maxItems: 12
            },
            tags: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                maxItems: 12
            },
            confidenceBand: {
                type: 'STRING',
                enum: ['low', 'medium', 'high']
            },
            rationale: {
                type: 'STRING',
                description: 'A concise rationale based only on the supplied text.'
            },
            evidence: {
                type: 'ARRAY',
                items: {
                    type: 'STRING',
                    description: 'An exact contiguous quote copied character-for-character from the supplied Text.'
                },
                minItems: 1,
                maxItems: 5
            }
        },
        required: [
            'language',
            'summary',
            'sentiment',
            'sectors',
            'symbols',
            'tags',
            'confidenceBand',
            'rationale',
            'evidence'
        ]
    }
});

const buildPrompt = ({ title, excerpt }) => [
    'Analyze this public Nepal financial or regulatory document.',
    'Call structure_market_document exactly once.',
    'Use only supplied text. Do not invent prices, dates, sectors, companies, symbols, or evidence.',
    'The evidence array must contain one to five exact, contiguous quotes copied character-for-character from Text. Never return an empty evidence array.',
    'Return symbols only when an allowed symbol appears explicitly in Text; otherwise return an empty symbols array.',
    'Use neutral when market direction is unclear. Do not give buy or sell advice.',
    `Title: ${title}`,
    `Text: ${excerpt}`
].join('\n');

const buildFunctionDeclarationV2 = ({ allowedSymbols = [] } = {}) => ({
    name: 'structure_market_document',
    description: 'Classify NEPSE relevance and return an evidence-grounded Nepal market event record.',
    parameters: {
        type: 'OBJECT',
        properties: {
            language: { type: 'STRING', enum: LANGUAGES },
            summary: {
                type: 'STRING',
                description: 'A short factual summary in the source language.'
            },
            relevance: { type: 'STRING', enum: RELEVANCE_VALUES },
            eventType: { type: 'STRING', enum: EVENT_TYPES },
            impactScope: { type: 'STRING', enum: IMPACT_SCOPES },
            impactDirection: { type: 'STRING', enum: IMPACT_DIRECTIONS },
            impactHorizon: { type: 'STRING', enum: IMPACT_HORIZONS },
            impactMechanism: { type: 'STRING', enum: IMPACT_MECHANISMS },
            sectors: {
                type: 'ARRAY',
                items: { type: 'STRING', enum: CANONICAL_SECTORS },
                maxItems: 8
            },
            symbols: {
                type: 'ARRAY',
                items: allowedSymbols.length
                    ? { type: 'STRING', enum: allowedSymbols }
                    : {
                        type: 'STRING',
                        description: 'Return no symbols because no registered security was found in the source.'
                    },
                maxItems: 12
            },
            tags: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                maxItems: 12
            },
            confidenceBand: { type: 'STRING', enum: CONFIDENCE_BANDS },
            rationale: {
                type: 'STRING',
                description: 'A cautious source-language explanation of the potential mechanism, not a prediction.'
            },
            evidenceSentenceIds: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                minItems: 1,
                maxItems: 8,
                description: 'IDs of exact numbered source sentences supporting the decision.'
            }
        },
        required: [
            'language',
            'summary',
            'relevance',
            'eventType',
            'impactScope',
            'impactDirection',
            'impactHorizon',
            'impactMechanism',
            'sectors',
            'symbols',
            'tags',
            'confidenceBand',
            'rationale',
            'evidenceSentenceIds'
        ]
    }
});

const buildPromptV2 = ({ title, excerpt, sentences }) => {
    const numbered = sentences?.length ? sentences : splitNumberedSentences(excerpt);
    return [
        'You are annotating NEPSE-Impact-500, a Nepal stock-market benchmark.',
        'First decide whether the document has a concrete NEPSE connection.',
        'direct: listed company, security, trading, issue, listing, capital action, earnings, governance, or market-wide NEPSE event.',
        'indirect: Nepal sector, monetary, liquidity, regulatory, fiscal, or macro event with a documented market mechanism.',
        'not_relevant: general business, promotion, workshop, recruitment, foreign-company, technology, lifestyle, or administrative news without a concrete NEPSE mechanism.',
        'For not_relevant use eventType=not_applicable, impactScope=none, impactDirection=not_applicable, impactHorizon=not_applicable, impactMechanism=none, and empty sectors/symbols.',
        'For relevant items, impactDirection is potential impact only. Use uncertain when direction is not supported.',
        'Use only supplied text. Do not invent facts, causal claims, prices, dates, companies, sectors, symbols, or evidence.',
        'Return evidenceSentenceIds only from the numbered sentences below.',
        'Summary and rationale must follow the source language. Never give investment advice.',
        'Call structure_market_document exactly once.',
        `Title: ${title}`,
        'Numbered source sentences:',
        formatNumberedSentences(numbered)
    ].join('\n');
};

const parseRetryAfterMs = (headers) => {
    const raw = headers?.get?.('retry-after');
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : Math.max(0, date.getTime() - Date.now());
};

const extractFunctionCall = (response) => {
    const parts = response?.candidates?.flatMap(
        (candidate) => candidate?.content?.parts || []
    ) || [];
    const call = parts.find(
        (part) => part?.functionCall?.name === 'structure_market_document'
    )?.functionCall;
    if (!call?.args) {
        const error = new Error('Gemma response did not call structure_market_document');
        error.response = response;
        throw error;
    }
    return call.args;
};

const createGemmaClient = ({
    apiKey = process.env.GEMINI_API_KEY,
    fetchImpl = fetch,
    sleepFn = sleep,
    random = Math.random,
    config = marketGyanConfig,
    pacer = new RequestPacer({ rpm: config.gemmaRpm, sleepFn })
} = {}) => {
    const backoffBaseMs = Math.max(
        1000,
        Number(config.gemmaBackoffBaseMs) || 5000
    );
    const structureDocument = async (input, { allowedSymbols = [] } = {}) => {
        if (!apiKey) throw new Error('GEMINI_API_KEY is required');

        const useV2 = Number(config.schemaVersion) === 2;
        const sentences = input.sentences?.length
            ? input.sentences
            : splitNumberedSentences(input.excerpt);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.gemmaModel)}:generateContent`;
        const body = {
            contents: [{
                role: 'user',
                parts: [{
                    text: useV2
                        ? buildPromptV2({ ...input, sentences })
                        : buildPrompt(input)
                }]
            }],
            tools: [{
                functionDeclarations: [
                    useV2
                        ? buildFunctionDeclarationV2({ allowedSymbols })
                        : buildFunctionDeclaration({ allowedSymbols })
                ]
            }]
        };

        let lastError;
        for (let attempt = 1; attempt <= config.gemmaMaxAttempts; attempt += 1) {
            await pacer.wait();

            let response;
            try {
                response = await fetchImpl(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': apiKey
                    },
                    body: JSON.stringify(body),
                    timeout: config.requestTimeoutMs
                });
            } catch (error) {
                lastError = error;
                if (attempt === config.gemmaMaxAttempts) throw error;
                const backoff = (2 ** (attempt - 1)) * backoffBaseMs
                    + Math.floor(random() * 250);
                await sleepFn(backoff);
                continue;
            }

            const text = await response.text();
            let payload;
            try {
                payload = text ? JSON.parse(text) : {};
            } catch {
                payload = { raw: text };
            }

            if (response.ok) {
                return {
                    candidate: extractFunctionCall(payload),
                    rawResponse: payload,
                    usage: {
                        promptTokens: payload?.usageMetadata?.promptTokenCount,
                        candidateTokens: payload?.usageMetadata?.candidatesTokenCount,
                        totalTokens: payload?.usageMetadata?.totalTokenCount
                    }
                };
            }

            const error = new Error(
                payload?.error?.message || `Gemma API request failed with ${response.status}`
            );
            error.status = response.status;
            error.response = payload;
            lastError = error;

            const retryable = response.status === 429 || response.status >= 500;
            if (!retryable || attempt === config.gemmaMaxAttempts) throw error;

            const retryAfterMs = parseRetryAfterMs(response.headers);
            const backoff = retryAfterMs
                ?? ((2 ** (attempt - 1)) * backoffBaseMs + Math.floor(random() * 250));
            await sleepFn(backoff);
        }

        throw lastError || new Error('Gemma API request failed');
    };

    return {
        structureDocument
    };
};

module.exports = {
    RequestPacer,
    buildFunctionDeclaration,
    buildFunctionDeclarationV2,
    buildPrompt,
    buildPromptV2,
    createGemmaClient,
    extractFunctionCall,
    parseRetryAfterMs
};

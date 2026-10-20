/**
 * Market Gyan uses the shared fixed-window limiter. The grounded query and
 * evidence search endpoints each trigger an embedding call plus (for query)
 * LLM inference, so they are throttled per client IP.
 */

module.exports = require('../../../middleware/rateLimit');

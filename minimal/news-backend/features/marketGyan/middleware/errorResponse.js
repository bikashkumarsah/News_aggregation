/**
 * Consistent, non-leaky error responses for Market Gyan routes.
 *
 * Client errors (4xx) carry actionable messages (bad filter, missing question)
 * and any validationErrors, so those are passed through. Server errors (5xx)
 * frequently wrap Qdrant/Mongo/agent internals, so the raw message is logged
 * server-side and replaced with a generic message for the client.
 */

const sendError = (res, error, fallbackMessage = 'Market Gyan request failed') => {
    const status = error?.status || 500;
    const body = { success: false };

    if (status >= 400 && status < 500) {
        body.error = error?.message || fallbackMessage;
        if (Array.isArray(error?.validationErrors) && error.validationErrors.length) {
            body.validationErrors = error.validationErrors;
        }
    } else {
        // Do not expose internal failure details to the client.
        // eslint-disable-next-line no-console
        console.error('[market-gyan] server error:', error?.message || error);
        body.error = fallbackMessage;
    }
    return res.status(status).json(body);
};

module.exports = { sendError };

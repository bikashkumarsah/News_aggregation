const notFoundHandler = (req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
};

// Final error handler: always answers in JSON and never leaks stack traces.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
    if (res.headersSent) return next(err);

    if (err?.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, error: 'Request body is not valid JSON' });
    }
    if (err?.type === 'entity.too.large') {
        return res.status(413).json({ success: false, error: 'Request body is too large' });
    }

    const status = Number(err?.status || err?.statusCode) || 500;
    if (status >= 500) console.error('Unhandled error:', err);
    return res.status(status).json({
        success: false,
        error: status >= 500 ? 'Internal server error' : (err?.expose && err.message) || 'Request failed'
    });
};

module.exports = {
    errorHandler,
    notFoundHandler
};

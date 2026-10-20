const express = require('express');
const User = require('../models/User');
const { escapeHtml } = require('../services/emailService');
const { verifyUnsubscribeToken } = require('../services/unsubscribeService');
const { isValidObjectId } = require('../utils/validation');

const router = express.Router();

const page = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Khabar AI</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 48px 16px; }
    main { max-width: 480px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; }
    h1 { font-size: 22px; margin: 0 0 12px; }
    p { color: #475569; line-height: 1.6; }
    button { background: #2563eb; color: #fff; border: 0; border-radius: 10px; padding: 12px 20px; font-size: 15px; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;

const readUserId = (req) => {
  try {
    const userId = verifyUnsubscribeToken(req.query.token);
    return isValidObjectId(userId) ? userId : null;
  } catch {
    return null;
  }
};

const invalidLink = (res) => res.status(400).type('html').send(page(
  'Invalid link',
  '<h1>This unsubscribe link is not valid</h1><p>Use the link from your most recent Khabar AI email, or turn off the daily digest from your account.</p>'
));

// GET only confirms: link scanners and mail prefetchers follow GET links, so
// the change itself requires a POST.
router.get('/unsubscribe', (req, res) => {
  if (!readUserId(req)) return invalidLink(res);
  const action = `?token=${encodeURIComponent(String(req.query.token))}`;
  return res.type('html').send(page(
    'Unsubscribe',
    `<h1>Unsubscribe from the daily digest?</h1>
     <p>You will stop receiving the personalized Khabar AI newsletter. You can turn it back on at any time.</p>
     <form method="post" action="${escapeHtml(action)}"><button type="submit">Unsubscribe</button></form>`
  ));
});

// Handles both the confirmation form and RFC 8058 one-click requests.
router.post('/unsubscribe', async (req, res) => {
  const userId = readUserId(req);
  if (!userId) return invalidLink(res);

  try {
    await User.updateOne(
      { _id: userId },
      { $set: { 'emailPreferences.dailyDigest': false } }
    );
    return res.type('html').send(page(
      'Unsubscribed',
      '<h1>You are unsubscribed</h1><p>You will no longer receive the Khabar AI daily digest.</p>'
    ));
  } catch (error) {
    console.error('Unsubscribe error:', error);
    return res.status(500).type('html').send(page(
      'Something went wrong',
      '<h1>Something went wrong</h1><p>Please try the link again in a moment.</p>'
    ));
  }
});

module.exports = router;

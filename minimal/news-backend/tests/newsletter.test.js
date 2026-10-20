const test = require('node:test');
const assert = require('node:assert/strict');

const { startOfZonedDay, timeZoneOffsetMs, zonedHour } = require('../services/timeService');
const { digestHourOf, processNewsletters } = require('../services/newsletterScheduler');
const { escapeHtml, safeUrl, templates } = require('../services/emailService');
const {
  buildUnsubscribeUrl,
  createUnsubscribeToken,
  publicApiUrl,
  verifyUnsubscribeToken
} = require('../services/unsubscribeService');

const KATHMANDU = 'Asia/Kathmandu';

test('Nepal time helpers do not depend on the server time zone', () => {
  // 01:15 UTC is 07:00 in Kathmandu (UTC+5:45).
  const sevenAmNepal = new Date('2026-10-15T01:15:00.000Z');
  assert.equal(zonedHour(sevenAmNepal, KATHMANDU), 7);
  assert.equal(timeZoneOffsetMs(sevenAmNepal, KATHMANDU), (5 * 60 + 45) * 60 * 1000);
  // Midnight in Kathmandu is 18:15 UTC on the previous day.
  assert.equal(startOfZonedDay(sevenAmNepal, KATHMANDU).toISOString(), '2026-10-14T18:15:00.000Z');
  assert.equal(zonedHour(new Date('2026-10-15T07:00:00.000Z'), 'UTC'), 7);
});

test('digest hour parsing tolerates missing and short times', () => {
  assert.equal(digestHourOf({ emailPreferences: { digestTime: '07:00' } }), 7);
  assert.equal(digestHourOf({ emailPreferences: { digestTime: '7:30' } }), 7);
  assert.equal(digestHourOf({ emailPreferences: { digestTime: '21:00' } }), 21);
  assert.equal(digestHourOf({}), 7);
});

test('newsletters go out at the subscriber hour in Nepal time and once per Nepal day', async () => {
  const users = [
    { _id: 'u7', email: 'seven@example.com', emailPreferences: { digestTime: '07:00' } },
    { _id: 'u13', email: 'thirteen@example.com', emailPreferences: { digestTime: '13:00' } }
  ];
  let filterUsed;
  const sentTo = [];

  // A UTC server reaching 07:00 Nepal time (01:15 UTC).
  const result = await processNewsletters({
    now: new Date('2026-10-15T01:15:00.000Z'),
    timeZone: KATHMANDU,
    findUsers: async (filter) => {
      filterUsed = filter;
      return users;
    },
    sendToUser: async (user) => {
      sentTo.push(user.email);
      return true;
    },
    delayMs: 0
  });

  assert.deepEqual(sentTo, ['seven@example.com']);
  assert.deepEqual(result, { sent: 1, failed: 0 });
  assert.equal(
    filterUsed.$or[1].lastNewsletterSent.$lt.toISOString(),
    '2026-10-14T18:15:00.000Z',
    '"already sent today" is measured from Nepal midnight'
  );
});

test('overlapping newsletter runs are skipped', async () => {
  let release;
  const slowRun = processNewsletters({
    now: new Date('2026-10-15T01:15:00.000Z'),
    timeZone: KATHMANDU,
    findUsers: () => new Promise((resolve) => { release = () => resolve([]); }),
    delayMs: 0
  });
  const overlapping = await processNewsletters({ findUsers: async () => [], delayMs: 0 });
  assert.equal(overlapping.skipped, true);
  release();
  await slowRun;
});

test('email templates escape feed and user content', () => {
  const malicious = {
    title: '<script>alert(1)</script>',
    description: '<img src=x onerror=alert(1)>',
    url: 'javascript:alert(1)',
    urlToImage: 'data:text/html,<b>x</b>',
    source: '<b>Spoofed</b>',
    category: 'technology'
  };
  const { html, subject } = templates.personalizedNewsletter(
    '<a href="https://phish.example">Verify account</a>',
    [malicious, { ...malicious, url: 'https://news.example/story?a=1&b=2' }],
    { categoryScores: { technology: 60 }, topKeywords: [{ keyword: '<i>x</i>' }] },
    { unsubscribeUrl: 'https://api.example/api/email/unsubscribe?token=t' }
  );

  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('data:text/html'));
  assert.ok(!html.includes('<a href="https://phish.example">'));
  assert.ok(html.includes('https://news.example/story?a=1&amp;b=2'));
  assert.ok(html.includes('https://api.example/api/email/unsubscribe?token=t'));
  assert.match(subject, /stories picked just for you/);

  assert.equal(escapeHtml('<"&\'>'), '&lt;&quot;&amp;&#039;&gt;');
  assert.equal(safeUrl('ftp://example.com'), '#');
  assert.equal(safeUrl('https://example.com/a?b=1&c=2'), 'https://example.com/a?b=1&amp;c=2');
});

test('daily newsletter carries one-click unsubscribe headers', () => {
  const { headers } = templates.personalizedNewsletter('Asha', [], {}, {
    unsubscribeUrl: 'https://api.example/api/email/unsubscribe?token=t'
  });
  assert.equal(headers['List-Unsubscribe'], '<https://api.example/api/email/unsubscribe?token=t>');
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(templates.personalizedNewsletter('Asha', [], {}).headers, undefined);
});

test('unsubscribe tokens identify the user and cannot be confused with sessions', () => {
  const userId = '507f1f77bcf86cd799439011';
  const token = createUnsubscribeToken(userId);
  assert.equal(verifyUnsubscribeToken(token), userId);
  assert.throws(() => verifyUnsubscribeToken(`${token}x`));

  const jwt = require('jsonwebtoken');
  const { getJwtSecret } = require('../config/authConfig');
  const sessionToken = jwt.sign({ id: userId }, getJwtSecret(), { algorithm: 'HS256' });
  assert.throws(() => verifyUnsubscribeToken(sessionToken), /Invalid unsubscribe token/);

  assert.equal(publicApiUrl({ PUBLIC_API_URL: 'https://api.example/' }), 'https://api.example');
  assert.equal(publicApiUrl({ FRONTEND_URL: 'http://192.168.1.20:3000', PORT: '5001' }), 'http://192.168.1.20:5001');
  assert.equal(publicApiUrl({}), 'http://localhost:5001');
  assert.match(buildUnsubscribeUrl(userId, { PUBLIC_API_URL: 'https://api.example' }), /^https:\/\/api\.example\/api\/email\/unsubscribe\?token=/);
});

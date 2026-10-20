const cron = require('node-cron');
const User = require('../models/User');
const { updateUserPreferences, getNewsletterRecommendations } = require('./preferenceService');
const { sendPersonalizedNewsletter } = require('./emailService');
const { DEFAULT_TIMEZONE, startOfZonedDay, zonedHour } = require('./timeService');
const { buildUnsubscribeUrl } = require('./unsubscribeService');

/**
 * Newsletter Scheduler Service
 * Sends personalized daily newsletters to users at their preferred time (default 7 AM)
 * in NEWSLETTER_TIMEZONE (default Asia/Kathmandu), independent of the server's time zone.
 */

const NEWSLETTER_TIMEZONE = process.env.NEWSLETTER_TIMEZONE || DEFAULT_TIMEZONE;
const SEND_DELAY_MS = 1000;
const USER_FIELDS = 'name email emailPreferences preferences lastNewsletterSent';

// Store the cron job reference
let newsletterJob = null;
let processing = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const digestHourOf = (user) => {
    const [hour] = String(user?.emailPreferences?.digestTime || '07:00').split(':');
    const parsed = Number.parseInt(hour, 10);
    return Number.isFinite(parsed) ? parsed : 7;
};

/**
 * Send newsletter to a single user
 */
const sendNewsletterToUser = async (user) => {
    try {
        // Update user preferences first
        const preferences = await updateUserPreferences(user._id);

        // Get personalized recommendations
        const recommendations = await getNewsletterRecommendations(user._id, 5);

        if (!recommendations || recommendations.length === 0) {
            console.log(`No recommendations available for ${user.email}`);
            return false;
        }

        // Send the newsletter
        const result = await sendPersonalizedNewsletter(
            user.email,
            user.name,
            recommendations,
            preferences || user.preferences,
            { unsubscribeUrl: buildUnsubscribeUrl(user._id) }
        );

        if (result.success) {
            // Update last newsletter sent timestamp
            await User.updateOne({ _id: user._id }, {
                $set: { lastNewsletterSent: new Date() }
            });
            console.log(`✅ Newsletter sent to ${user.email}`);
            return true;
        }
        console.error(`❌ Failed to send newsletter to ${user.email}:`, result.error);
        return false;
    } catch (error) {
        console.error(`Error sending newsletter to ${user.email}:`, error);
        return false;
    }
};

const sendToUsers = async (users, { sendToUser = sendNewsletterToUser, delayMs = SEND_DELAY_MS } = {}) => {
    let successCount = 0;
    let failCount = 0;

    for (const [index, user] of users.entries()) {
        const success = await sendToUser(user);
        if (success) successCount++;
        else failCount++;

        // Small delay between emails to avoid overwhelming SMTP
        if (delayMs > 0 && index < users.length - 1) await sleep(delayMs);
    }

    return { sent: successCount, failed: failCount };
};

/**
 * Process all users who should receive newsletters at this time
 */
const processNewsletters = async ({
    now = new Date(),
    timeZone = NEWSLETTER_TIMEZONE,
    findUsers = (filter) => User.find(filter).select(USER_FIELDS).lean(),
    sendToUser = sendNewsletterToUser,
    delayMs = SEND_DELAY_MS
} = {}) => {
    if (processing) {
        console.log('📧 Newsletter run already in progress; skipping this trigger');
        return { sent: 0, failed: 0, skipped: true };
    }
    processing = true;

    try {
        const currentHour = zonedHour(now, timeZone);
        console.log(`\n📧 Processing newsletters for ${String(currentHour).padStart(2, '0')}:00 (${timeZone})...`);

        // Find users who:
        // 1. Have daily digest enabled
        // 2. Have a digest time matching the current hour in the newsletter time zone
        // 3. Haven't received a newsletter today (in that time zone)
        const startOfToday = startOfZonedDay(now, timeZone);
        const users = await findUsers({
            'emailPreferences.dailyDigest': true,
            $or: [
                { lastNewsletterSent: null },
                { lastNewsletterSent: { $lt: startOfToday } }
            ]
        });

        const usersToNotify = users.filter((user) => digestHourOf(user) === currentHour);
        console.log(`Found ${usersToNotify.length} users to send newsletters to`);

        const result = await sendToUsers(usersToNotify, { sendToUser, delayMs });
        console.log(`📊 Newsletter results: ${result.sent} sent, ${result.failed} failed`);
        return result;
    } catch (error) {
        console.error('Error processing newsletters:', error);
        throw error;
    } finally {
        processing = false;
    }
};

/**
 * Start the newsletter scheduler
 * Runs every hour to check for users who need newsletters
 */
const startNewsletterScheduler = () => {
    // Run every hour at minute 0
    newsletterJob = cron.schedule('0 * * * *', async () => {
        console.log('\n⏰ Newsletter scheduler triggered');
        try {
            await processNewsletters();
        } catch (error) {
            console.error('Newsletter run failed:', error.message);
        }
    }, {
        scheduled: true,
        timezone: NEWSLETTER_TIMEZONE
    });

    console.log(`📅 Newsletter scheduler started (runs every hour, ${NEWSLETTER_TIMEZONE})`);

    return newsletterJob;
};

/**
 * Stop the newsletter scheduler
 */
const stopNewsletterScheduler = () => {
    if (newsletterJob) {
        newsletterJob.stop();
        newsletterJob = null;
        console.log('Newsletter scheduler stopped');
    }
};

/**
 * Manually trigger newsletter for a specific user (for testing)
 */
const triggerNewsletterForUser = async (userId) => {
    const user = await User.findById(userId).select(USER_FIELDS).lean();
    if (!user) {
        throw new Error('User not found');
    }
    return await sendNewsletterToUser(user);
};

/**
 * Manually trigger newsletters for all eligible users (for testing)
 * This respects the digest time setting
 */
const triggerAllNewsletters = async () => {
    return await processNewsletters();
};

/**
 * Send newsletters to ALL users with daily digest enabled NOW
 * Bypasses time check - useful for testing and manual sends
 */
const sendToAllUsersNow = async () => {
    try {
        console.log(`\n📧 Sending newsletters to ALL eligible users (bypassing time check)...`);

        // Find all users with daily digest enabled
        const users = await User.find({ 'emailPreferences.dailyDigest': true })
            .select(USER_FIELDS)
            .lean();

        console.log(`Found ${users.length} users with daily digest enabled`);

        const result = await sendToUsers(users);
        console.log(`\n📊 Newsletter results: ${result.sent} sent, ${result.failed} failed`);
        return result;
    } catch (error) {
        console.error('Error sending newsletters:', error);
        throw error;
    }
};

module.exports = {
    NEWSLETTER_TIMEZONE,
    digestHourOf,
    startNewsletterScheduler,
    stopNewsletterScheduler,
    processNewsletters,
    triggerNewsletterForUser,
    triggerAllNewsletters,
    sendToAllUsersNow
};

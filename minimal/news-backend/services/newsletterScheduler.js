const cron = require('node-cron');
const mongoose = require('mongoose');
const User = require('../models/User');
const { updateUserPreferences, getRecommendations } = require('./preferenceService');
const { sendPersonalizedNewsletter } = require('./emailService');

/**
 * Newsletter Scheduler Service
 * Sends personalized daily newsletters to users at their preferred time (default 7 AM)
 */

// Store the cron job reference
let newsletterJob = null;

/**
 * Send newsletter to a single user
 */
const sendNewsletterToUser = async (user) => {
    try {
        // Update user preferences first
        await updateUserPreferences(user._id);

        // Get personalized recommendations
        const recommendations = await getRecommendations(user._id, 5);

        if (!recommendations || recommendations.length === 0) {
            console.log(`No recommendations available for ${user.email}`);
            return false;
        }

        // Send the newsletter
        const result = await sendPersonalizedNewsletter(
            user.email,
            user.name,
            recommendations,
            user.preferences
        );

        if (result.success) {
            // Update last newsletter sent timestamp
            await User.findByIdAndUpdate(user._id, {
                lastNewsletterSent: new Date()
            });
            console.log(`✅ Newsletter sent to ${user.email}`);
            return true;
        } else {
            console.error(`❌ Failed to send newsletter to ${user.email}:`, result.error);
            return false;
        }
    } catch (error) {
        console.error(`Error sending newsletter to ${user.email}:`, error);
        return false;
    }
};

/**
 * Process all users who should receive newsletters at this time
 */
const processNewsletters = async () => {
    try {
        const now = new Date();
        const currentHour = now.getHours().toString().padStart(2, '0');
        const currentMinute = now.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentHour}:${currentMinute}`;

        console.log(`\n📧 Processing newsletters for ${currentTime}...`);

        // Find users who:
        // 1. Have daily digest enabled
        // 2. Have a digest time matching current hour
        // 3. Haven't received a newsletter today
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const users = await User.find({
            'emailPreferences.dailyDigest': true,
            $or: [
                { lastNewsletterSent: null },
                { lastNewsletterSent: { $lt: startOfToday } }
            ]
        });

        // Filter users whose digest time matches current hour
        const usersToNotify = users.filter(user => {
            const digestTime = user.emailPreferences?.digestTime || '07:00';
            const [digestHour] = digestTime.split(':');
            return digestHour === currentHour;
        });

        console.log(`Found ${usersToNotify.length} users to send newsletters to`);

        let successCount = 0;
        let failCount = 0;

        for (const user of usersToNotify) {
            const success = await sendNewsletterToUser(user);
            if (success) successCount++;
            else failCount++;

            // Small delay between emails to avoid overwhelming SMTP
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`📊 Newsletter results: ${successCount} sent, ${failCount} failed`);
        return { sent: successCount, failed: failCount };
    } catch (error) {
        console.error('Error processing newsletters:', error);
        throw error;
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
        await processNewsletters();
    }, {
        scheduled: true,
        timezone: 'Asia/Kathmandu' // Nepal timezone
    });

    console.log('📅 Newsletter scheduler started (runs every hour)');

    return newsletterJob;
};

/**
 * Stop the newsletter scheduler
 */
const stopNewsletterScheduler = () => {
    if (newsletterJob) {
        newsletterJob.stop();
        console.log('Newsletter scheduler stopped');
    }
};

/**
 * Manually trigger newsletter for a specific user (for testing)
 */
const triggerNewsletterForUser = async (userId) => {
    const user = await User.findById(userId);
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
        const users = await User.find({
            'emailPreferences.dailyDigest': true
        });

        console.log(`Found ${users.length} users with daily digest enabled`);

        if (users.length === 0) {
            return { sent: 0, failed: 0 };
        }

        let successCount = 0;
        let failCount = 0;

        for (const user of users) {
            console.log(`\n📤 Sending to ${user.email}...`);
            const success = await sendNewsletterToUser(user);
            if (success) successCount++;
            else failCount++;

            // Small delay between emails to avoid overwhelming SMTP
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`\n📊 Newsletter results: ${successCount} sent, ${failCount} failed`);
        return { sent: successCount, failed: failCount };
    } catch (error) {
        console.error('Error sending newsletters:', error);
        throw error;
    }
};

module.exports = {
    startNewsletterScheduler,
    stopNewsletterScheduler,
    processNewsletters,
    triggerNewsletterForUser,
    triggerAllNewsletters,
    sendToAllUsersNow
};

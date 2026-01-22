#!/usr/bin/env node
/**
 * Test Email Script
 * 
 * This script sends a test email to verify SMTP configuration.
 * 
 * Usage:
 *   node testEmail.js                    # Send test email to SMTP_USER
 *   node testEmail.js your@email.com     # Send test email to specific address
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Article = require('./models/Article');
const { sendPersonalizedNewsletter, sendDailyDigest } = require('./services/emailService');
const { triggerAllNewsletters, triggerNewsletterForUser, sendToAllUsersNow } = require('./services/newsletterScheduler');

// ANSI colors for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

const log = {
    info: (msg) => console.log(`${colors.cyan}ℹ ${colors.reset}${msg}`),
    success: (msg) => console.log(`${colors.green}✅ ${colors.reset}${msg}`),
    error: (msg) => console.log(`${colors.red}❌ ${colors.reset}${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠️ ${colors.reset}${msg}`),
    header: (msg) => console.log(`\n${colors.bright}${colors.blue}═══ ${msg} ═══${colors.reset}\n`)
};

async function checkConfiguration() {
    log.header('Email Configuration Check');

    const config = {
        SMTP_HOST: process.env.SMTP_HOST,
        SMTP_PORT: process.env.SMTP_PORT,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASS: process.env.SMTP_PASS ? '********' : undefined
    };

    console.log('Current configuration:');
    Object.entries(config).forEach(([key, value]) => {
        const status = value ? colors.green + '✓' : colors.red + '✗';
        console.log(`  ${status} ${key}: ${value || 'NOT SET'}${colors.reset}`);
    });

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        log.error('\nSMTP not fully configured!');
        log.warn('Please update the .env file with your SMTP credentials.');
        log.info('\nFor Gmail:');
        console.log('  1. Go to https://myaccount.google.com/apppasswords');
        console.log('  2. Create an App Password for "Mail"');
        console.log('  3. Update SMTP_USER and SMTP_PASS in .env\n');
        return false;
    }

    return true;
}

async function sendTestEmail(targetEmail) {
    log.header('Sending Test Email');

    const email = targetEmail || process.env.SMTP_USER;
    log.info(`Sending test email to: ${email}`);

    // Sample articles for the test email
    const sampleArticles = [
        {
            title: 'AI Revolution: How Machine Learning is Transforming Industries',
            description: 'Artificial intelligence continues to reshape the business landscape, with new applications emerging across healthcare, finance, and manufacturing sectors.',
            category: 'technology',
            source: 'Tech News Daily',
            url: 'https://example.com/ai-revolution'
        },
        {
            title: 'Global Markets React to Economic Policy Changes',
            description: 'Stock markets around the world showed mixed reactions as central banks announced new monetary policies aimed at controlling inflation.',
            category: 'business',
            source: 'Financial Times',
            url: 'https://example.com/markets'
        },
        {
            title: 'New Study Reveals Benefits of Mediterranean Diet',
            description: 'Research published in a leading medical journal confirms that the Mediterranean diet significantly reduces the risk of heart disease and improves longevity.',
            category: 'health',
            source: 'Health Weekly',
            url: 'https://example.com/health-study'
        }
    ];

    // Sample preferences for personalization
    const samplePreferences = {
        categoryScores: {
            technology: 45,
            business: 30,
            health: 15,
            sports: 10
        },
        preferredSources: [
            { source: 'Tech News Daily', score: 40 },
            { source: 'Financial Times', score: 30 }
        ],
        topKeywords: [
            { keyword: 'artificial', count: 5 },
            { keyword: 'intelligence', count: 5 },
            { keyword: 'markets', count: 3 }
        ]
    };

    try {
        const result = await sendPersonalizedNewsletter(
            email,
            'Test User',
            sampleArticles,
            samplePreferences
        );

        if (result.success) {
            if (result.testMode) {
                log.warn('Email sent in TEST MODE (SMTP not configured)');
                log.info('The email was logged but not actually sent.');
            } else {
                log.success('Email sent successfully!');
                log.info(`Check your inbox at: ${email}`);
            }
        } else {
            log.error(`Failed to send email: ${result.error}`);
        }

        return result;
    } catch (error) {
        log.error(`Error sending email: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function sendToAllUsers() {
    log.header('Sending Newsletter to All Eligible Users');

    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB');
        log.success('Connected to MongoDB');

        // Count eligible users
        const eligibleUsers = await User.find({
            'emailPreferences.dailyDigest': true
        });

        if (eligibleUsers.length === 0) {
            log.warn('No users have daily digest enabled.');
            log.info('To enable daily digest for a user, set emailPreferences.dailyDigest: true');
            return;
        }

        log.info(`Found ${eligibleUsers.length} users with daily digest enabled:`);
        eligibleUsers.forEach(user => {
            console.log(`  - ${user.email} (${user.name})`);
        });

        console.log('\nSending newsletters NOW (bypassing time check)...\n');
        const result = await sendToAllUsersNow();

        log.success(`Newsletter sending complete!`);
        console.log(`  Sent: ${result.sent}`);
        console.log(`  Failed: ${result.failed}`);

    } catch (error) {
        log.error(`Error: ${error.message}`);
    } finally {
        await mongoose.disconnect();
        log.info('Disconnected from MongoDB');
    }
}

async function sendToSpecificUser(email) {
    log.header(`Sending Newsletter to ${email}`);

    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB');
        log.success('Connected to MongoDB');

        // Find user
        const user = await User.findOne({ email });

        if (!user) {
            log.error(`User not found: ${email}`);
            log.info('Available users:');
            const allUsers = await User.find({}, 'email name');
            allUsers.forEach(u => console.log(`  - ${u.email} (${u.name})`));
            return;
        }

        log.info(`Sending newsletter to ${user.name} (${user.email})...`);

        const success = await triggerNewsletterForUser(user._id);

        if (success) {
            log.success('Newsletter sent successfully!');
        } else {
            log.error('Failed to send newsletter. Check server logs for details.');
        }

    } catch (error) {
        log.error(`Error: ${error.message}`);
    } finally {
        await mongoose.disconnect();
        log.info('Disconnected from MongoDB');
    }
}

async function listUsers() {
    log.header('Registered Users');

    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB');

        const users = await User.find({}, 'email name emailPreferences lastNewsletterSent');

        if (users.length === 0) {
            log.warn('No users found in database.');
            return;
        }

        console.log('Users and their email preferences:\n');
        users.forEach(user => {
            const dailyDigest = user.emailPreferences?.dailyDigest ? '✓' : '✗';
            const digestTime = user.emailPreferences?.digestTime || '07:00';
            const lastSent = user.lastNewsletterSent
                ? new Date(user.lastNewsletterSent).toLocaleString()
                : 'Never';

            console.log(`${colors.bright}${user.name}${colors.reset} <${user.email}>`);
            console.log(`  Daily Digest: ${dailyDigest} (Time: ${digestTime})`);
            console.log(`  Last Newsletter: ${lastSent}\n`);
        });

    } catch (error) {
        log.error(`Error: ${error.message}`);
    } finally {
        await mongoose.disconnect();
    }
}

async function enableDailyDigestForUser(email) {
    log.header(`Enabling Daily Digest for ${email}`);

    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/newsDB');

        const user = await User.findOneAndUpdate(
            { email },
            {
                'emailPreferences.dailyDigest': true,
                'emailPreferences.digestTime': '07:00'
            },
            { new: true }
        );

        if (!user) {
            log.error(`User not found: ${email}`);
            return;
        }

        log.success(`Daily digest enabled for ${user.name} (${user.email})`);
        log.info('Newsletter will be sent at 07:00 AM (Nepal time)');

    } catch (error) {
        log.error(`Error: ${error.message}`);
    } finally {
        await mongoose.disconnect();
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    console.log(`
${colors.bright}${colors.blue}╔════════════════════════════════════════════╗
║     Khabar AI - Email Testing Utility      ║
╚════════════════════════════════════════════╝${colors.reset}
    `);

    // Check configuration first
    const configOk = await checkConfiguration();

    if (command === '--help' || command === '-h') {
        console.log(`
Usage: node testEmail.js [command] [args]

Commands:
  (no args)           Send test email to SMTP_USER
  <email>             Send test email to specific address
  --all               Send newsletter to all eligible users
  --user <email>      Send newsletter to specific user from DB
  --list              List all users and their preferences
  --enable <email>    Enable daily digest for a user
  --help              Show this help message

Examples:
  node testEmail.js                           # Test email to yourself
  node testEmail.js test@example.com          # Test email to specific address
  node testEmail.js --all                     # Send to all users
  node testEmail.js --user john@example.com   # Send to specific user
  node testEmail.js --enable john@example.com # Enable daily digest
        `);
        return;
    }

    if (!configOk && command !== '--list' && command !== '--enable') {
        log.error('Please configure SMTP settings in .env file first.');
        process.exit(1);
    }

    switch (command) {
        case '--all':
            await sendToAllUsers();
            break;
        case '--user':
            if (!args[1]) {
                log.error('Please provide an email address');
                process.exit(1);
            }
            await sendToSpecificUser(args[1]);
            break;
        case '--list':
            await listUsers();
            break;
        case '--enable':
            if (!args[1]) {
                log.error('Please provide an email address');
                process.exit(1);
            }
            await enableDailyDigestForUser(args[1]);
            break;
        default:
            // Send test email
            await sendTestEmail(command);
            break;
    }
}

main().catch(console.error);

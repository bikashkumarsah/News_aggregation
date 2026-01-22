#!/usr/bin/env node
/**
 * IP Address Updater
 * 
 * Automatically detects your local network IP and updates:
 * 1. Backend .env file (FRONTEND_URL)
 * 2. Sends a test email with the updated URL
 * 
 * Usage:
 *   node updateIP.js           # Update IP in .env
 *   node updateIP.js --test    # Update IP and send test email
 */

const { networkInterfaces } = require('os');
const fs = require('fs');
const path = require('path');

// ANSI colors
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

const log = {
    info: (msg) => console.log(`${colors.cyan}ℹ ${colors.reset}${msg}`),
    success: (msg) => console.log(`${colors.green}✅ ${colors.reset}${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠️ ${colors.reset}${msg}`),
    header: (msg) => console.log(`\n${colors.bright}${colors.blue}═══ ${msg} ═══${colors.reset}\n`)
};

function getLocalIP() {
    const nets = networkInterfaces();
    
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip internal and non-IPv4 addresses
            if (net.family === 'IPv4' && !net.internal) {
                // Prefer Wi-Fi or Ethernet interfaces
                if (name.toLowerCase().includes('en') || 
                    name.toLowerCase().includes('eth') || 
                    name.toLowerCase().includes('wlan') ||
                    name.toLowerCase().includes('wi-fi')) {
                    return net.address;
                }
            }
        }
    }
    
    // Fallback: return first non-internal IPv4
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    
    return 'localhost';
}

function updateEnvFile(ip) {
    const envPath = path.join(__dirname, '.env');
    
    if (!fs.existsSync(envPath)) {
        log.warn('.env file not found. Creating one...');
    }
    
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    
    // Update or add FRONTEND_URL
    const frontendUrl = `http://${ip}:3000`;
    
    if (envContent.includes('FRONTEND_URL=')) {
        envContent = envContent.replace(/FRONTEND_URL=.*/g, `FRONTEND_URL=${frontendUrl}`);
    } else {
        envContent += `\nFRONTEND_URL=${frontendUrl}\n`;
    }
    
    fs.writeFileSync(envPath, envContent);
    return frontendUrl;
}

async function main() {
    log.header('Network IP Updater');
    
    const ip = getLocalIP();
    log.info(`Detected local IP: ${colors.bright}${ip}${colors.reset}`);
    
    const frontendUrl = updateEnvFile(ip);
    log.success(`Updated .env with FRONTEND_URL=${frontendUrl}`);
    
    console.log(`
${colors.bright}Access your app from any device on the same network:${colors.reset}

  Frontend: ${colors.cyan}http://${ip}:3000${colors.reset}
  Backend:  ${colors.cyan}http://${ip}:5001${colors.reset}

${colors.yellow}Note:${colors.reset} If your IP changes, run this script again.
    `);
    
    // If --test flag, send a test email
    if (process.argv.includes('--test')) {
        log.header('Sending Test Email');
        
        require('dotenv').config();
        const { sendPersonalizedNewsletter } = require('./services/emailService');
        
        const testArticles = [
            {
                title: 'Network Configuration Updated Successfully',
                description: `Your Khabar AI newsletter is now configured to work across your local network. Access the app at ${frontendUrl}`,
                category: 'technology',
                source: 'System',
                url: frontendUrl
            }
        ];
        
        const result = await sendPersonalizedNewsletter(
            process.env.SMTP_USER,
            'Test User',
            testArticles,
            { categoryScores: { technology: 100 } }
        );
        
        if (result.success) {
            log.success('Test email sent! Check your inbox.');
        } else {
            log.warn(`Email test: ${result.error || 'Unknown error'}`);
        }
    }
}

main().catch(console.error);

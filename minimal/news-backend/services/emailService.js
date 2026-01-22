const nodemailer = require('nodemailer');

// Create transporter based on environment variables
const createTransporter = () => {
    // Check if SMTP settings are configured
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_PORT === '465',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }

    // If no SMTP configured, use ethereal for testing
    console.log('⚠️ No SMTP configured. Email service will use test mode.');
    return null;
};

let transporter = null;

const getTransporter = () => {
    if (!transporter) {
        transporter = createTransporter();
    }
    return transporter;
};

// Email Templates
const templates = {
    welcome: (name) => ({
        subject: 'Welcome to Khabar AI! 📰',
        html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2563eb; margin: 0;">Khabar AI</h1>
          <p style="color: #64748b; margin-top: 8px;">Your AI-Powered News Companion</p>
        </div>
        
        <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 16px; padding: 30px; margin-bottom: 30px;">
          <h2 style="color: #0f172a; margin-top: 0;">Welcome, ${name}! 👋</h2>
          <p style="color: #475569; line-height: 1.6;">
            Thank you for joining Khabar AI. You now have access to:
          </p>
          <ul style="color: #475569; line-height: 1.8;">
            <li>📚 <strong>Bookmarks</strong> - Save articles for later</li>
            <li>📖 <strong>Reading History</strong> - Track what you've read</li>
            <li>🎨 <strong>Dark Mode</strong> - Easy on your eyes</li>
            <li>🤖 <strong>AI Summaries</strong> - Quick article insights</li>
            <li>🔊 <strong>Text-to-Speech</strong> - Listen to summaries</li>
          </ul>
        </div>
        
        <div style="text-align: center;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" 
             style="display: inline-block; background-color: #2563eb; color: white; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: 600;">
            Start Reading →
          </a>
        </div>
        
        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px;">
          <p>You received this email because you signed up for Khabar AI.</p>
        </div>
      </div>
    `
    }),

    dailyDigest: (name, articles) => ({
        subject: '📰 Your Daily News Digest - Khabar AI',
        html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2563eb; margin: 0;">Khabar AI</h1>
          <p style="color: #64748b; margin-top: 8px;">Daily News Digest</p>
        </div>
        
        <h2 style="color: #0f172a;">Good morning, ${name}! ☀️</h2>
        <p style="color: #475569;">Here are today's top stories:</p>
        
        ${articles.map((article, idx) => `
          <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 16px; border-left: 4px solid #2563eb;">
            <span style="display: inline-block; background: #dbeafe; color: #1d4ed8; font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; margin-bottom: 8px;">
              ${article.category}
            </span>
            <h3 style="color: #0f172a; margin: 8px 0; font-size: 16px;">
              <a href="${article.url}" style="color: #0f172a; text-decoration: none;">${article.title}</a>
            </h3>
            <p style="color: #64748b; font-size: 14px; margin: 0; line-height: 1.5;">
              ${article.description?.substring(0, 150)}...
            </p>
          </div>
        `).join('')}
        
        <div style="text-align: center; margin-top: 30px;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" 
             style="display: inline-block; background-color: #2563eb; color: white; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: 600;">
            Read More Stories →
          </a>
        </div>
        
        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px;">
          <p>Manage your email preferences in your account settings.</p>
        </div>
      </div>
    `
    }),

    weeklyDigest: (name, articles, stats) => ({
        subject: '📊 Your Weekly News Roundup - Khabar AI',
        html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #2563eb; margin: 0;">Khabar AI</h1>
          <p style="color: #64748b; margin-top: 8px;">Weekly Roundup</p>
        </div>
        
        <h2 style="color: #0f172a;">Hey ${name}, here's your week in news! 📈</h2>
        
        <div style="display: flex; gap: 16px; margin: 24px 0;">
          <div style="flex: 1; background: #f0f9ff; border-radius: 12px; padding: 20px; text-align: center;">
            <div style="font-size: 32px; font-weight: 700; color: #2563eb;">${stats?.articlesRead || 0}</div>
            <div style="color: #64748b; font-size: 12px; margin-top: 4px;">Articles Read</div>
          </div>
          <div style="flex: 1; background: #fef3c7; border-radius: 12px; padding: 20px; text-align: center;">
            <div style="font-size: 32px; font-weight: 700; color: #d97706;">${stats?.bookmarks || 0}</div>
            <div style="color: #64748b; font-size: 12px; margin-top: 4px;">Bookmarks</div>
          </div>
        </div>
        
        <h3 style="color: #0f172a; margin-top: 30px;">Top Stories This Week</h3>
        
        ${articles.slice(0, 5).map((article) => `
          <div style="border-bottom: 1px solid #e2e8f0; padding: 16px 0;">
            <h4 style="color: #0f172a; margin: 0 0 8px 0; font-size: 14px;">
              <a href="${article.url}" style="color: #0f172a; text-decoration: none;">${article.title}</a>
            </h4>
            <span style="color: #64748b; font-size: 12px;">${article.source}</span>
          </div>
        `).join('')}
        
        <div style="text-align: center; margin-top: 30px;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}" 
             style="display: inline-block; background-color: #2563eb; color: white; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: 600;">
            Continue Reading →
          </a>
        </div>
        
        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px;">
          <p>Manage your email preferences in your account settings.</p>
        </div>
      </div>
    `
    })
};

// Send email function
const sendEmail = async (to, template, data) => {
    const transport = getTransporter();

    if (!transport) {
        console.log(`📧 [TEST MODE] Would send "${template}" email to ${to}`);
        return { success: true, testMode: true };
    }

    try {
        const emailContent = templates[template](...data);

        await transport.sendMail({
            from: `"Khabar AI" <${process.env.SMTP_USER}>`,
            to,
            subject: emailContent.subject,
            html: emailContent.html
        });

        console.log(`✅ Email sent: ${template} to ${to}`);
        return { success: true };
    } catch (error) {
        console.error(`❌ Email error: ${error.message}`);
        return { success: false, error: error.message };
    }
};

// Convenience functions
const sendWelcomeEmail = (email, name) => sendEmail(email, 'welcome', [name]);
const sendDailyDigest = (email, name, articles) => sendEmail(email, 'dailyDigest', [name, articles]);
const sendWeeklyDigest = (email, name, articles, stats) => sendEmail(email, 'weeklyDigest', [name, articles, stats]);

module.exports = {
    sendEmail,
    sendWelcomeEmail,
    sendDailyDigest,
    sendWeeklyDigest
};

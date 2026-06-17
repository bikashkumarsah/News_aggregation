const nodemailer = require('nodemailer');

// Create transporter based on environment variables
const createTransporter = () => {
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

// ═══════════════════════════════════════════════════════════════
// DESIGN SYSTEM
// ═══════════════════════════════════════════════════════════════

const colors = {
  // Primary brand colors
  primary: '#6366f1',      // Indigo
  primaryDark: '#4f46e5',
  primaryLight: '#a5b4fc',
  
  // Accent colors
  accent: '#f59e0b',       // Amber
  success: '#10b981',      // Emerald
  
  // Neutral colors
  dark: '#0f172a',
  text: '#334155',
  muted: '#64748b',
  light: '#94a3b8',
  border: '#e2e8f0',
  background: '#f8fafc',
  white: '#ffffff',
  
  // Category colors
  categories: {
    technology: '#3b82f6',
    business: '#10b981',
    sports: '#f59e0b',
    entertainment: '#ec4899',
    health: '#ef4444',
    science: '#8b5cf6',
    local: '#06b6d4'
  }
};

const getCategoryColor = (category) => colors.categories[category?.toLowerCase()] || colors.muted;
const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

// Get greeting based on time
const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return { text: 'Good morning', emoji: '☀️' };
  if (hour < 17) return { text: 'Good afternoon', emoji: '🌤️' };
  return { text: 'Good evening', emoji: '🌙' };
};

// Format date nicely
const formatDate = () => {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
};

// ═══════════════════════════════════════════════════════════════
// BASE EMAIL WRAPPER (Table-based for compatibility)
// ═══════════════════════════════════════════════════════════════

const emailWrapper = (content, preheader = '') => `
<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="utf-8">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings xmlns:o="urn:schemas-microsoft-com:office:office">
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <style>
    td,th,div,p,a,h1,h2,h3,h4,h5,h6 {font-family: "Segoe UI", sans-serif; mso-line-height-rule: exactly;}
  </style>
  <![endif]-->
  <title>Khabar AI</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    
    * { box-sizing: border-box; }
    
    body {
      margin: 0;
      padding: 0;
      width: 100%;
      word-break: break-word;
      -webkit-font-smoothing: antialiased;
      background-color: ${colors.background};
    }
    
    .hover-bg:hover { background-color: ${colors.primaryDark} !important; }
    .hover-underline:hover { text-decoration: underline !important; }
    
    @media (max-width: 600px) {
      .mobile-full { width: 100% !important; }
      .mobile-padding { padding-left: 16px !important; padding-right: 16px !important; }
      .mobile-stack { display: block !important; width: 100% !important; }
    }
    
    @media (prefers-color-scheme: dark) {
      body { background-color: #1e293b !important; }
      .dark-bg { background-color: #0f172a !important; }
      .dark-card { background-color: #1e293b !important; border-color: #334155 !important; }
      .dark-text { color: #f1f5f9 !important; }
      .dark-muted { color: #94a3b8 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${colors.background};">
  <!-- Preheader text (hidden) -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    ${preheader}
    ${'&nbsp;'.repeat(100)}
  </div>
  
  <!-- Email container -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${colors.background};" class="dark-bg">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          ${content}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// ═══════════════════════════════════════════════════════════════
// REUSABLE COMPONENTS
// ═══════════════════════════════════════════════════════════════

const components = {
  // Logo header
  header: () => `
    <tr>
      <td align="center" style="padding-bottom: 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background: linear-gradient(135deg, ${colors.primary} 0%, #7c3aed 100%); width: 48px; height: 48px; border-radius: 12px; text-align: center; vertical-align: middle;">
              <span style="font-size: 24px; line-height: 48px;">📰</span>
            </td>
            <td style="padding-left: 12px;">
              <h1 style="margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 24px; font-weight: 700; color: ${colors.dark};" class="dark-text">
                Khabar AI
              </h1>
              <p style="margin: 2px 0 0 0; font-family: 'Inter', sans-serif; font-size: 12px; color: ${colors.muted}; text-transform: uppercase; letter-spacing: 1px;" class="dark-muted">
                Your AI News Companion
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `,

  // Hero banner
  heroBanner: (title, subtitle) => `
    <tr>
      <td style="padding-bottom: 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, ${colors.primary} 0%, #7c3aed 50%, #a855f7 100%); border-radius: 20px; overflow: hidden;">
          <tr>
            <td style="padding: 40px 32px; text-align: center;">
              <h2 style="margin: 0 0 8px 0; font-family: 'Inter', sans-serif; font-size: 28px; font-weight: 700; color: white;">
                ${title}
              </h2>
              <p style="margin: 0; font-family: 'Inter', sans-serif; font-size: 16px; color: rgba(255,255,255,0.9);">
                ${subtitle}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `,

  // Section title
  sectionTitle: (icon, title) => `
    <tr>
      <td style="padding: 24px 0 16px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size: 18px; padding-right: 8px;">${icon}</td>
            <td style="font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; color: ${colors.muted}; text-transform: uppercase; letter-spacing: 1.5px;" class="dark-muted">
              ${title}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `,

  // Article card
  articleCard: (article, isFeature = false) => `
    <tr>
      <td style="padding-bottom: 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${colors.white}; border-radius: 16px; border: 1px solid ${colors.border}; ${isFeature ? `border-left: 4px solid ${colors.primary};` : ''} overflow: hidden;" class="dark-card">
          ${article.urlToImage ? `
          <tr>
            <td>
              <a href="${article.url}" style="display: block;">
                <img src="${article.urlToImage}" alt="" width="100%" style="display: block; max-height: 200px; object-fit: cover;" />
              </a>
            </td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding: 20px;">
              <!-- Category & Source -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom: 12px;">
                <tr>
                  <td style="background-color: ${getCategoryColor(article.category)}; padding: 4px 10px; border-radius: 6px;">
                    <span style="font-family: 'Inter', sans-serif; font-size: 10px; font-weight: 700; color: white; text-transform: uppercase; letter-spacing: 0.5px;">
                      ${article.category || 'News'}
                    </span>
                  </td>
                  <td style="padding-left: 10px;">
                    <span style="font-family: 'Inter', sans-serif; font-size: 12px; color: ${colors.light};" class="dark-muted">
                      ${article.source || 'Unknown'}
                    </span>
                  </td>
                </tr>
              </table>
              
              <!-- Title -->
              <h3 style="margin: 0 0 10px 0; font-family: 'Inter', sans-serif; font-size: ${isFeature ? '20px' : '16px'}; font-weight: 600; line-height: 1.4; color: ${colors.dark};" class="dark-text">
                <a href="${article.url}" style="color: inherit; text-decoration: none;">
                  ${article.title}
                </a>
              </h3>
              
              <!-- Description -->
              <p style="margin: 0 0 16px 0; font-family: 'Inter', sans-serif; font-size: 14px; line-height: 1.6; color: ${colors.text};" class="dark-muted">
                ${(article.description || '').substring(0, isFeature ? 180 : 120)}${(article.description?.length || 0) > (isFeature ? 180 : 120) ? '...' : ''}
              </p>
              
              <!-- Read more link -->
              <a href="${article.url}" style="font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; color: ${colors.primary}; text-decoration: none;" class="hover-underline">
                Read full article →
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `,

  // Compact article (for lists)
  articleCompact: (article, index) => `
    <tr>
      <td style="padding: 16px 0; ${index > 0 ? `border-top: 1px solid ${colors.border};` : ''}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width: 32px; vertical-align: top; padding-right: 12px;">
              <div style="width: 28px; height: 28px; background-color: ${colors.background}; border-radius: 8px; text-align: center; line-height: 28px; font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 700; color: ${colors.muted};">
                ${index + 1}
              </div>
            </td>
            <td>
              <p style="margin: 0 0 4px 0; font-family: 'Inter', sans-serif; font-size: 10px; font-weight: 600; color: ${getCategoryColor(article.category)}; text-transform: uppercase; letter-spacing: 0.5px;">
                ${article.category || 'News'}
              </p>
              <a href="${article.url}" style="font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 500; color: ${colors.dark}; text-decoration: none; line-height: 1.4;" class="dark-text hover-underline">
                ${article.title}
              </a>
              <p style="margin: 6px 0 0 0; font-family: 'Inter', sans-serif; font-size: 12px; color: ${colors.light};" class="dark-muted">
                ${article.source || 'Unknown'}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `,

  // Interest tags
  interestTags: (categories) => `
    <tr>
      <td style="padding-bottom: 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${colors.background}; border-radius: 12px; border: 1px solid ${colors.border};" class="dark-card">
          <tr>
            <td style="padding: 20px;">
              <p style="margin: 0 0 12px 0; font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600; color: ${colors.muted}; text-transform: uppercase; letter-spacing: 1px;" class="dark-muted">
                📊 Your Top Interests
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  ${categories.map(({ category, score }) => `
                    <td style="padding-right: 8px; padding-bottom: 8px;">
                      <span style="display: inline-block; background: linear-gradient(135deg, ${getCategoryColor(category)}22 0%, ${getCategoryColor(category)}11 100%); border: 1px solid ${getCategoryColor(category)}33; color: ${getCategoryColor(category)}; padding: 6px 14px; border-radius: 20px; font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 600; text-transform: capitalize;">
                        ${category} ${score}%
                      </span>
                    </td>
                  `).join('')}
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `,

  // CTA Button
  ctaButton: (text, url, style = 'primary') => `
    <tr>
      <td align="center" style="padding: 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background: ${style === 'primary' ? `linear-gradient(135deg, ${colors.primary} 0%, #7c3aed 100%)` : colors.white}; border-radius: 12px; ${style !== 'primary' ? `border: 2px solid ${colors.border};` : ''}" class="hover-bg">
              <a href="${url}" style="display: inline-block; padding: 16px 40px; font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 600; color: ${style === 'primary' ? 'white' : colors.dark}; text-decoration: none;">
                ${text}
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `,

  // Stats row
  statsRow: (stats) => `
    <tr>
      <td style="padding-bottom: 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${stats.map(stat => `
              <td width="${100 / stats.length}%" style="text-align: center; padding: 20px; background-color: ${stat.bgColor || colors.background}; border-radius: 12px;" class="mobile-stack dark-card">
                <p style="margin: 0; font-family: 'Inter', sans-serif; font-size: 32px; font-weight: 700; color: ${stat.color || colors.primary};">
                  ${stat.value}
                </p>
                <p style="margin: 6px 0 0 0; font-family: 'Inter', sans-serif; font-size: 12px; color: ${colors.muted}; text-transform: uppercase; letter-spacing: 0.5px;" class="dark-muted">
                  ${stat.label}
                </p>
              </td>
            `).join('<td width="16"></td>')}
          </tr>
        </table>
      </td>
    </tr>
  `,

  // Footer
  footer: (frontendUrl) => `
    <tr>
      <td style="padding-top: 32px; border-top: 1px solid ${colors.border};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center">
              <p style="margin: 0 0 8px 0; font-family: 'Inter', sans-serif; font-size: 12px; color: ${colors.light};" class="dark-muted">
                Curated with ❤️ by Khabar AI
              </p>
              <p style="margin: 0 0 16px 0; font-family: 'Inter', sans-serif; font-size: 12px; color: ${colors.light};" class="dark-muted">
                Personalized news based on your reading preferences
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 0 8px;">
                    <a href="${frontendUrl}" style="font-family: 'Inter', sans-serif; font-size: 12px; color: ${colors.primary}; text-decoration: none;">
                      Open App
                    </a>
                  </td>
                  <td style="color: ${colors.border};">|</td>
                  <td style="padding: 0 8px;">
                    <a href="${frontendUrl}/settings" style="font-family: 'Inter', sans-serif; font-size: 12px; color: ${colors.muted}; text-decoration: none;" class="dark-muted">
                      Settings
                    </a>
                  </td>
                  <td style="color: ${colors.border};">|</td>
                  <td style="padding: 0 8px;">
                    <a href="${frontendUrl}/unsubscribe" style="font-family: 'Inter', sans-serif; font-size: 12px; color: ${colors.muted}; text-decoration: none;" class="dark-muted">
                      Unsubscribe
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `
};

// ═══════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════

const templates = {
  // Welcome Email
  welcome: (name) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const content = `
      ${components.header()}
      ${components.heroBanner(
        `Welcome aboard, ${name}! 🎉`,
        'Your personalized news journey starts now'
      )}
      
      <tr>
        <td style="padding-bottom: 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${colors.white}; border-radius: 16px; border: 1px solid ${colors.border};" class="dark-card">
            <tr>
              <td style="padding: 32px;">
                <h3 style="margin: 0 0 20px 0; font-family: 'Inter', sans-serif; font-size: 18px; font-weight: 600; color: ${colors.dark};" class="dark-text">
                  Here's what you can do:
                </h3>
                
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  ${[
                    { icon: '🤖', title: 'AI Summaries', desc: 'Get quick insights from any article' },
                    { icon: '🎯', title: 'Personalized Feed', desc: 'News tailored to your interests' },
                    { icon: '🔊', title: 'Text-to-Speech', desc: 'Listen to summaries on the go' },
                    { icon: '📚', title: 'Bookmarks', desc: 'Save articles for later reading' },
                    { icon: '🌙', title: 'Dark Mode', desc: 'Easy on your eyes, day or night' }
                  ].map(feature => `
                    <tr>
                      <td style="padding: 12px 0; border-bottom: 1px solid ${colors.border};">
                        <table role="presentation" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="width: 40px; font-size: 20px;">${feature.icon}</td>
                            <td>
                              <p style="margin: 0; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; color: ${colors.dark};" class="dark-text">
                                ${feature.title}
                              </p>
                              <p style="margin: 2px 0 0 0; font-family: 'Inter', sans-serif; font-size: 13px; color: ${colors.muted};" class="dark-muted">
                                ${feature.desc}
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  `).join('')}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      
      ${components.ctaButton('Start Reading News →', frontendUrl)}
      ${components.footer(frontendUrl)}
    `;

    return {
      subject: `Welcome to Khabar AI, ${name}! 🎉`,
      html: emailWrapper(content, `Hey ${name}! Your personalized news experience awaits.`)
    };
  },

  // Daily Digest
  dailyDigest: (name, articles) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const greeting = getGreeting();
    
    const content = `
      ${components.header()}
      ${components.heroBanner(
        `${greeting.text}, ${name}! ${greeting.emoji}`,
        formatDate()
      )}
      
      ${components.sectionTitle('📰', 'Today\'s Top Stories')}
      
      <!-- Feature article -->
      ${articles[0] ? components.articleCard(articles[0], true) : ''}
      
      <!-- More articles -->
      ${articles.slice(1, 5).map(article => components.articleCard(article, false)).join('')}
      
      ${components.ctaButton('Explore All News →', frontendUrl)}
      ${components.footer(frontendUrl)}
    `;

    return {
      subject: `📰 ${greeting.text}! Your Daily News Digest`,
      html: emailWrapper(content, `${articles.length} curated stories waiting for you today.`)
    };
  },

  // Weekly Digest
  weeklyDigest: (name, articles, stats) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    const content = `
      ${components.header()}
      ${components.heroBanner(
        `Your Week in Review 📈`,
        `Here's what you accomplished, ${name}!`
      )}
      
      ${components.statsRow([
        { value: stats?.articlesRead || 0, label: 'Articles Read', color: colors.primary, bgColor: '#eef2ff' },
        { value: stats?.bookmarks || 0, label: 'Bookmarked', color: colors.accent, bgColor: '#fef3c7' },
        { value: stats?.summaries || 0, label: 'AI Summaries', color: colors.success, bgColor: '#d1fae5' }
      ])}
      
      ${components.sectionTitle('🏆', 'Top Stories This Week')}
      
      <tr>
        <td style="padding-bottom: 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${colors.white}; border-radius: 16px; border: 1px solid ${colors.border};" class="dark-card">
            <tr>
              <td style="padding: 8px 20px;">
                ${articles.slice(0, 5).map((article, i) => components.articleCompact(article, i)).join('')}
              </td>
            </tr>
          </table>
        </td>
      </tr>
      
      ${components.ctaButton('Continue Your Journey →', frontendUrl)}
      ${components.footer(frontendUrl)}
    `;

    return {
      subject: `📊 Your Weekly News Roundup - ${stats?.articlesRead || 0} articles read!`,
      html: emailWrapper(content, `You read ${stats?.articlesRead || 0} articles this week. Keep it up!`)
    };
  },

  marketGyanDigest: (name, report) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const evidence = (report.evidence || []).slice(0, 5);
    const sectors = (report.sectorAnalysis || []).slice(0, 8);
    const content = `
      ${components.header()}
      ${components.heroBanner(
        `Market Gyan Daily Report`,
        `${escapeHtml(name)}, ${new Date(report.reportDate).toLocaleDateString('en-US')}`
      )}
      <tr>
        <td style="padding: 0 0 20px 0;">
          <h2 style="font-family: 'Inter', sans-serif; color: ${colors.dark};">
            ${escapeHtml(report.headline)}
          </h2>
          <p style="font-family: 'Inter', sans-serif; line-height: 1.7; color: ${colors.text};">
            ${escapeHtml(report.summary)}
          </p>
        </td>
      </tr>
      ${sectors.length ? `
      <tr>
        <td style="padding-bottom: 20px;">
          <h3 style="font-family: 'Inter', sans-serif;">Sector analysis</h3>
          <ul style="font-family: 'Inter', sans-serif; line-height: 1.7; color: ${colors.text};">
            ${sectors.map((item) => `
              <li><strong>${escapeHtml(item.sector)} (${escapeHtml(item.sentiment)}):</strong>
              ${escapeHtml(item.summary)}</li>
            `).join('')}
          </ul>
        </td>
      </tr>` : ''}
      <tr>
        <td style="padding-bottom: 20px;">
          <h3 style="font-family: 'Inter', sans-serif;">Sources</h3>
          <ul style="font-family: 'Inter', sans-serif; line-height: 1.7;">
            ${evidence.map((item) => `
              <li><a href="${escapeHtml(item.sourceUrl)}">${escapeHtml(item.title)}</a></li>
            `).join('')}
          </ul>
          <p style="font-family: 'Inter', sans-serif; color: ${colors.muted}; font-size: 12px;">
            Informational analysis based on public data, not investment advice.
          </p>
        </td>
      </tr>
      ${components.ctaButton('Open Market Gyan', frontendUrl)}
      ${components.footer(frontendUrl)}
    `;
    return {
      subject: `Market Gyan: ${report.headline}`,
      html: emailWrapper(content, report.summary)
    };
  },

  // Personalized Newsletter (Main daily email)
  personalizedNewsletter: (name, articles, preferences) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const greeting = getGreeting();
    
    // Extract top categories
    const topCategories = preferences?.categoryScores
      ? Object.entries(preferences.categoryScores)
          .filter(([_, score]) => score > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([category, score]) => ({ category, score }))
      : [];

    const topKeywords = preferences?.topKeywords?.slice(0, 5) || [];
    
    const content = `
      ${components.header()}
      ${components.heroBanner(
        `${greeting.text}, ${name}! ${greeting.emoji}`,
        `${formatDate()} • ${articles.length} stories curated for you`
      )}
      
      ${topCategories.length > 0 ? components.interestTags(topCategories) : ''}
      
      ${components.sectionTitle('✨', 'Recommended For You')}
      
      <!-- Feature article (first one) -->
      ${articles[0] ? components.articleCard(articles[0], true) : ''}
      
      <!-- Remaining articles -->
      ${articles.slice(1).map(article => components.articleCard(article, false)).join('')}
      
      ${topKeywords.length > 0 ? `
      <tr>
        <td style="padding: 16px 0 24px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px;">
            <tr>
              <td style="padding: 16px 20px;">
                <p style="margin: 0; font-family: 'Inter', sans-serif; font-size: 13px; color: #92400e;">
                  <strong>🔥 Hot topics for you:</strong> ${topKeywords.map(k => k.keyword).join(' • ')}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      ` : ''}
      
      ${components.ctaButton('Explore More News →', frontendUrl)}
      ${components.footer(frontendUrl)}
    `;

    return {
      subject: `🎯 ${name}, ${articles.length} stories picked just for you`,
      html: emailWrapper(
        content, 
        `${greeting.text}! We found ${articles.length} articles matching your interests: ${topCategories.map(c => c.category).join(', ')}.`
      )
    };
  }
};

// ═══════════════════════════════════════════════════════════════
// SEND EMAIL FUNCTION
// ═══════════════════════════════════════════════════════════════

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
const sendPersonalizedNewsletter = (email, name, articles, preferences) =>
  sendEmail(email, 'personalizedNewsletter', [name, articles, preferences]);
const sendMarketGyanDigest = (email, name, report) =>
  sendEmail(email, 'marketGyanDigest', [name, report]);

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendDailyDigest,
  sendWeeklyDigest,
  sendPersonalizedNewsletter,
  sendMarketGyanDigest
};

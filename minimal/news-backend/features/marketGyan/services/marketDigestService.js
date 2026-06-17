const User = require('../../../models/User');
const { sendMarketGyanDigest } = require('../../../services/emailService');
const { marketGyanConfig } = require('../config');

const deliverMarketGyanDigest = async (report, {
    enabled = marketGyanConfig.digestEnabled,
    send = sendMarketGyanDigest
} = {}) => {
    if (!enabled) return { skipped: true, sent: 0, failed: 0 };
    if (!report || report.status !== 'published') {
        return { skipped: true, sent: 0, failed: 0 };
    }

    const users = await User.find({ 'emailPreferences.dailyDigest': true })
        .select('email name')
        .lean();
    let sent = 0;
    let failed = 0;
    for (const user of users) {
        const result = await send(user.email, user.name, report);
        if (result?.success) sent += 1;
        else failed += 1;
    }
    return { skipped: false, sent, failed };
};

module.exports = {
    deliverMarketGyanDigest
};

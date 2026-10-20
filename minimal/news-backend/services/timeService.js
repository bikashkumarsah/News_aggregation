/**
 * Time-zone helpers. Scheduling logic must not depend on the server's local
 * time zone: digests are promised at 7 AM Nepal time even when the API runs
 * on a UTC host.
 */

const DEFAULT_TIMEZONE = 'Asia/Kathmandu';

const formatterCache = new Map();

const formatterFor = (timeZone) => {
    if (!formatterCache.has(timeZone)) {
        formatterCache.set(timeZone, new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }));
    }
    return formatterCache.get(timeZone);
};

const zonedParts = (date = new Date(), timeZone = DEFAULT_TIMEZONE) => {
    const parts = {};
    for (const part of formatterFor(timeZone).formatToParts(date)) {
        if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    return parts;
};

// Milliseconds to add to UTC to get wall-clock time in `timeZone` at `date`.
const timeZoneOffsetMs = (date = new Date(), timeZone = DEFAULT_TIMEZONE) => {
    const p = zonedParts(date, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - (Math.floor(date.getTime() / 1000) * 1000);
};

const zonedHour = (date = new Date(), timeZone = DEFAULT_TIMEZONE) => zonedParts(date, timeZone).hour;

// The instant at which the current calendar day began in `timeZone`.
const startOfZonedDay = (date = new Date(), timeZone = DEFAULT_TIMEZONE) => {
    const p = zonedParts(date, timeZone);
    return new Date(Date.UTC(p.year, p.month - 1, p.day) - timeZoneOffsetMs(date, timeZone));
};

module.exports = {
    DEFAULT_TIMEZONE,
    startOfZonedDay,
    timeZoneOffsetMs,
    zonedHour,
    zonedParts
};

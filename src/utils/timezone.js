const { DateTime } = require('luxon');

const DEFAULT_TIMEZONE = 'America/Guayaquil';

function getTenantTimezone(tenantConfig) {
  return tenantConfig?.timezone || DEFAULT_TIMEZONE;
}

function localHourToUTC(dateStr, hour, timezone) {
  return DateTime.fromObject(
    { year: +dateStr.slice(0, 4), month: +dateStr.slice(5, 7), day: +dateStr.slice(8, 10), hour, minute: 0, second: 0 },
    { zone: timezone }
  ).toUTC().toJSDate();
}

function localDayBoundsUTC(dateStr, timezone) {
  const start = DateTime.fromObject(
    { year: +dateStr.slice(0, 4), month: +dateStr.slice(5, 7), day: +dateStr.slice(8, 10), hour: 0, minute: 0, second: 0 },
    { zone: timezone }
  ).toUTC();
  const end = start.plus({ days: 1 }).minus({ milliseconds: 1 });
  return { dayStart: start.toJSDate(), dayEnd: end.toJSDate() };
}

function utcToLocalTimeString(utcDate, timezone) {
  return DateTime.fromJSDate(utcDate).setZone(timezone).toFormat('HH:mm');
}

module.exports = { DEFAULT_TIMEZONE, getTenantTimezone, localHourToUTC, localDayBoundsUTC, utcToLocalTimeString };

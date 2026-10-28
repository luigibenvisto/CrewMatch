/**
 * Calendar-day helpers. Dates are always 'YYYY-MM-DD' strings and are handled
 * as whole UTC days, so time zones and daylight saving can never shift a day.
 */
const DAY_MS = 86400000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Day number (days since 1970-01-01) for a 'YYYY-MM-DD' string. */
function toDayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function fromDayNumber(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  return fromDayNumber(toDayNumber(iso) + days);
}

/** Days from a to b. daysBetween('2026-01-01', '2026-01-03') === 2 */
function daysBetween(a, b) {
  return toDayNumber(b) - toDayNumber(a);
}

/** Number of calendar days in a range, both ends included. */
function lengthInDays(start, end) {
  return daysBetween(start, end) + 1;
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
  });
}

module.exports = { isIsoDate, toDayNumber, fromDayNumber, todayIso, addDays, daysBetween, lengthInDays, formatDate };

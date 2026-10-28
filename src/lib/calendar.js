/** Builds month grids for the availability calendar (Monday-first weeks). */
const { toDayNumber, fromDayNumber } = require('./dates');

function buildMonths(today, { available = [], booked = [] }, count = 3) {
  const inAny = (n, ranges) => ranges.some((r) => n >= toDayNumber(r.start_date) && n <= toDayNumber(r.end_date));
  const [y, m] = today.split('-').map(Number);
  const todayN = toDayNumber(today);
  const months = [];
  for (let i = 0; i < count; i += 1) {
    const first = new Date(Date.UTC(y, m - 1 + i, 1));
    const label = first.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;
    const cells = Array(lead).fill(null);
    const firstN = toDayNumber(first.toISOString().slice(0, 10));
    for (let d = 0; d < daysInMonth; d += 1) {
      const n = firstN + d;
      let state = 'unset';
      if (inAny(n, booked)) state = 'booked';
      else if (inAny(n, available)) state = 'available';
      cells.push({ day: d + 1, iso: fromDayNumber(n), state, past: n < todayN });
    }
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let w = 0; w < cells.length; w += 7) weeks.push(cells.slice(w, w + 7));
    months.push({ label, weeks });
  }
  return months;
}

module.exports = { buildMonths };

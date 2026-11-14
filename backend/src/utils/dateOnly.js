/**
 * Serialize Postgres DATE / JS Date as civil YYYY-MM-DD without UTC day-shift.
 * node-pg returns DATE as a JS Date at local midnight; JSON then emits UTC ISO
 * which can move the calendar day backwards for positive-offset timezones.
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

function toDateOnly(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    return value.slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return null;
}

module.exports = { toDateOnly };

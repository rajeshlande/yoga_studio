// Pure ERP business helpers — shared by the local device store, the Supabase
// RPC client and the UI. No React, no storage, no network: unit-testable.

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const PAYMENT_METHODS = [
  {id: 'cash', label: 'Cash'},
  {id: 'upi', label: 'UPI'},
  {id: 'card', label: 'Card'},
  {id: 'bank', label: 'Bank transfer'},
];
export const ATTENDANCE_STATUSES = [
  {id: 'present', label: 'Present'},
  {id: 'absent', label: 'Absent'},
  {id: 'late', label: 'Late'},
];
export const ROLES = [
  {id: 'owner', label: 'Owner'},
  {id: 'admin', label: 'Admin'},
  {id: 'instructor', label: 'Instructor'},
  {id: 'student', label: 'Student'},
];

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/** Local (not UTC) YYYY-MM-DD for a Date, defaulting to today. */
export function toISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISODate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function addDaysISO(iso, days) {
  const date = parseISODate(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function formatDate(iso) {
  const date = parseISODate(iso);
  if (!date) return '—';
  return date.toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'});
}

/**
 * Membership end date (inclusive).
 * - 'joining': start + N months, minus one day (e.g. 10 Jan + 1 month -> 9 Feb).
 * - 'calendar': last day of the month that is N-1 months after the start month
 *   (e.g. any January start + 1 month -> 31 Jan).
 */
export function membershipEnd(startISO, durationMonths, billingCycle = 'joining') {
  const start = parseISODate(startISO);
  const months = Math.max(1, Number(durationMonths) || 1);
  if (!start) return startISO;
  if (billingCycle === 'calendar') {
    const end = new Date(start.getFullYear(), start.getMonth() + months, 0);
    return toISODate(end);
  }
  // Clamp the anniversary to the target month's last day (31 Jan + 1 month
  // is 28 Feb, not 3 Mar), then step back one day. Mirrors the SQL in
  // supabase/erp_setup.sql, where Postgres month addition clamps the same way.
  const target = new Date(start.getFullYear(), start.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const anniversary = new Date(target.getFullYear(), target.getMonth(), Math.min(start.getDate(), lastDay));
  anniversary.setDate(anniversary.getDate() - 1);
  return toISODate(anniversary);
}

export function isBatchOnDate(batch, iso) {
  const date = parseISODate(iso);
  if (!date || !Array.isArray(batch?.days)) return false;
  return batch.days.includes(date.getDay());
}

/** Money crosses every boundary as integer paise. UI inputs are rupees. */
export function rupeesToPaise(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function paiseToRupees(paise) {
  return (Number(paise) || 0) / 100;
}

export function formatINR(paise) {
  const rupees = paiseToRupees(paise);
  const digits = Number.isInteger(rupees) ? 0 : 2;
  return `₹${rupees.toLocaleString('en-IN', {minimumFractionDigits: digits, maximumFractionDigits: digits})}`;
}

export function paymentTotalsForMembership(membershipId, payments) {
  const paid = (payments || [])
    .filter(p => p.membershipId === membershipId && p.status !== 'void')
    .reduce((sum, p) => sum + (Number(p.amountPaise) || 0), 0);
  return paid;
}

export function membershipBalance(membership, payments, today = toISODate()) {
  const total = Number(membership?.amountPaise) || 0;
  const paid = paymentTotalsForMembership(membership?.id, payments);
  const due = Math.max(0, total - paid);
  const expired = Boolean(membership?.endDate && membership.endDate < today);
  const paymentStatus = due === 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  const daysLeft = membership?.endDate
    ? Math.round((parseISODate(membership.endDate) - parseISODate(today)) / 86400000)
    : null;
  return {total, paid, due, expired, paymentStatus, daysLeft};
}

export function attendanceSummary(records) {
  const list = records || [];
  const present = list.filter(r => r.status === 'present').length;
  const late = list.filter(r => r.status === 'late').length;
  const absent = list.filter(r => r.status === 'absent').length;
  const total = list.length;
  const rate = total ? Math.round(((present + late) / total) * 100) : null;
  return {present, late, absent, total, rate};
}

export function batchTimeLabel(batch) {
  if (!batch?.startTime) return '—';
  const [h, m] = batch.startTime.split(':').map(Number);
  const start = new Date(2000, 0, 1, h || 0, m || 0);
  const end = new Date(start.getTime() + (Number(batch.durationMins) || 60) * 60000);
  const fmt = d => d.toLocaleTimeString('en-IN', {hour: 'numeric', minute: '2-digit'});
  return `${fmt(start)} – ${fmt(end)}`;
}

export function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
}

export function toCSV(rows, columns) {
  const escape = value => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = columns.map(c => escape(c.label)).join(',');
  const body = (rows || []).map(row => columns.map(c => escape(c.value(row))).join(','));
  return [header, ...body].join('\n');
}

export function emptySnapshot() {
  return {
    branches: [], students: [], instructors: [], batches: [], enrollments: [],
    attendance: [], plans: [], memberships: [], payments: [],
  };
}

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

/**
 * Cash-payable balance for displaying/collecting dues.
 *
 * Recorded payments are always the actual gross cash received. Membership
 * amounts remain the plan's quoted amount: when an admin chooses
 * GST-exclusive pricing, that quoted amount is the taxable fee, so the cash
 * total/due must include GST before it is compared with gross payments.
 * For GST-inclusive/no-GST pricing this is exactly membershipBalance().
 */
export function payableBalance(membership, payments, billingSettings = {}, today = toISODate()) {
  const base = membershipBalance(membership, payments, today);
  const settings = normalizeBillingSettings(billingSettings);
  if (!settings.gstEnabled || settings.priceIncludesGst || !(settings.gstRatePercent > 0)) {
    return {
      ...base,
      taxableTotalPaise: base.total,
      grossTotalPaise: base.total,
      taxableDuePaise: base.due,
    };
  }
  const grossTotalPaise = calculateInvoiceTax(base.total, settings, settings.stateCode).grandTotalPaise;
  const due = Math.max(0, grossTotalPaise - base.paid);
  const taxableDuePaise = calculateInvoiceTax(
    due,
    {...settings, priceIncludesGst: true},
    settings.stateCode,
  ).taxablePaise;
  return {
    ...base,
    total: grossTotalPaise,
    due,
    paymentStatus: due === 0 ? 'paid' : base.paid > 0 ? 'partial' : 'unpaid',
    taxableTotalPaise: base.total,
    grossTotalPaise,
    taxableDuePaise,
  };
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

/* ---------------- billing profile, GST and payment instructions ---------------- */

export const INDIA_STATE_CODES = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'],
  ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'],
  ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'],
  ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
  ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'],
  ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'],
  ['38', 'Ladakh'],
];

export const DEFAULT_BILLING_SETTINGS = Object.freeze({
  legalName: 'Yoga Studio', email: '', phone: '', address: '', city: '',
  state: 'Maharashtra', stateCode: '27', pinCode: '',
  gstEnabled: false, gstin: '', gstRatePercent: 18, sacCode: '', priceIncludesGst: true,
  invoicePrefix: 'YS-INV', dueDays: 7, terms: '',
  upiId: '', upiPayeeName: '', bankName: '', bankAccountName: '',
  bankAccountNumber: '', bankAccountType: 'Current', ifsc: '',
  gatewayProvider: 'none', gatewayEnvironment: 'test', gatewayPublicKeyId: '',
  gatewayWebhookUrl: '', gatewayWebhookConfigured: false, status: 'active',
});

const cleanText = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const asBoolean = value => value === true || value === 1 || value === 'true' || value === '1' || value === 'on';

export function normalizeBillingSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const provider = ['none', 'razorpay', 'cashfree'].includes(source.gatewayProvider)
    ? source.gatewayProvider : 'none';
  const environment = source.gatewayEnvironment === 'live' ? 'live' : 'test';
  const rate = Number(source.gstRatePercent);
  const days = Number(source.dueDays);
  return {
    legalName: cleanText(source.legalName || DEFAULT_BILLING_SETTINGS.legalName, 140),
    email: cleanText(source.email, 140),
    phone: cleanText(source.phone, 40),
    address: cleanText(source.address, 300),
    city: cleanText(source.city, 80),
    state: cleanText(source.state || DEFAULT_BILLING_SETTINGS.state, 80),
    stateCode: cleanText(source.stateCode || DEFAULT_BILLING_SETTINGS.stateCode, 2).padStart(2, '0'),
    pinCode: cleanText(source.pinCode, 6),
    gstEnabled: asBoolean(source.gstEnabled),
    gstin: cleanText(source.gstin, 15).toUpperCase(),
    gstRatePercent: Number.isFinite(rate) ? Math.min(28, Math.max(0, Math.round(rate * 100) / 100)) : 18,
    sacCode: cleanText(source.sacCode, 8),
    priceIncludesGst: source.priceIncludesGst === undefined ? true : asBoolean(source.priceIncludesGst),
    invoicePrefix: cleanText(source.invoicePrefix || DEFAULT_BILLING_SETTINGS.invoicePrefix, 24).toUpperCase(),
    dueDays: Number.isFinite(days) ? Math.min(60, Math.max(0, Math.round(days))) : 7,
    terms: cleanText(source.terms, 600),
    upiId: cleanText(source.upiId, 80),
    upiPayeeName: cleanText(source.upiPayeeName, 140),
    bankName: cleanText(source.bankName, 140),
    bankAccountName: cleanText(source.bankAccountName, 140),
    bankAccountNumber: cleanText(source.bankAccountNumber, 24).replace(/[\s-]/g, ''),
    bankAccountType: cleanText(source.bankAccountType || 'Current', 40),
    ifsc: cleanText(source.ifsc, 11).toUpperCase(),
    gatewayProvider: provider,
    gatewayEnvironment: environment,
    // Public/publishable identifiers only. There is intentionally no field
    // for a gateway secret key or webhook secret in this browser app.
    gatewayPublicKeyId: cleanText(source.gatewayPublicKeyId, 120),
    gatewayWebhookUrl: cleanText(source.gatewayWebhookUrl, 300),
    gatewayWebhookConfigured: asBoolean(source.gatewayWebhookConfigured),
    status: 'active',
  };
}

export const isValidGstin = value => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(value || '').toUpperCase());
export const isValidIfsc = value => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(value || '').toUpperCase());
export const isValidUpiId = value => /^[\w.\-]{2,}@[A-Za-z][A-Za-z0-9.\-]{1,}$/.test(String(value || '').trim());

export function validateBillingSettings(input = {}) {
  const s = normalizeBillingSettings(input);
  const errors = [];
  if (!s.legalName) errors.push('Billing legal/business name is required.');
  if (s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) errors.push('Billing email looks invalid.');
  if (!/^[0-9]{2}$/.test(s.stateCode)) errors.push('Seller state code must be two digits.');
  if (s.pinCode && !/^[0-9]{6}$/.test(s.pinCode)) errors.push('PIN code must be six digits.');
  if (s.gstEnabled) {
    if (!isValidGstin(s.gstin)) errors.push('Enter a valid 15-character GSTIN, or turn GST off.');
    else if (s.gstin.slice(0, 2) !== s.stateCode) errors.push('GSTIN must start with the seller state code.');
    if (!(s.gstRatePercent >= 0 && s.gstRatePercent <= 28)) errors.push('GST rate must be between 0% and 28%.');
    if (s.sacCode && !/^[0-9]{4,8}$/.test(s.sacCode)) errors.push('SAC/HSN code must be 4–8 digits.');
  }
  if (s.upiId && !isValidUpiId(s.upiId)) errors.push('UPI ID looks invalid (example: studio@okhdfcbank).');
  const bankParts = [s.bankName, s.bankAccountName, s.bankAccountNumber, s.ifsc].filter(Boolean).length;
  if (bankParts > 0 && bankParts < 4) errors.push('Complete bank name, account name, account number and IFSC—or clear all bank fields.');
  if (s.bankAccountNumber && !/^[0-9]{6,24}$/.test(s.bankAccountNumber)) errors.push('Bank account number must be 6–24 digits.');
  if (s.ifsc && !isValidIfsc(s.ifsc)) errors.push('IFSC looks invalid (example: HDFC0000123).');
  if (s.gatewayProvider !== 'none') {
    if (!s.gatewayPublicKeyId) errors.push(`Enter the ${s.gatewayProvider === 'razorpay' ? 'Razorpay Key ID' : 'Cashfree public Client ID'} (public identifier only—never a secret).`);
    if (s.gatewayProvider === 'razorpay' && s.gatewayPublicKeyId
        && !s.gatewayPublicKeyId.startsWith(`rzp_${s.gatewayEnvironment}_`)) {
      errors.push(`Razorpay Key ID should start with rzp_${s.gatewayEnvironment}_.`);
    }
    if (s.gatewayWebhookConfigured && !/^https:\/\/[^\s]+$/i.test(s.gatewayWebhookUrl)) {
      errors.push('Enter the HTTPS webhook/Edge Function URL, or mark the webhook as not configured.');
    }
  }
  return errors;
}

export function billingReadiness(input = {}) {
  const s = normalizeBillingSettings(input);
  const errors = validateBillingSettings(s);
  const manualUpi = isValidUpiId(s.upiId);
  const bankTransfer = Boolean(s.bankName && s.bankAccountName && /^[0-9]{6,24}$/.test(s.bankAccountNumber) && isValidIfsc(s.ifsc));
  const gatewayPublicConfig = s.gatewayProvider !== 'none' && Boolean(s.gatewayPublicKeyId)
    && (s.gatewayProvider !== 'razorpay' || s.gatewayPublicKeyId.startsWith(`rzp_${s.gatewayEnvironment}_`));
  const gatewayAutoConfirmation = gatewayPublicConfig && s.gatewayWebhookConfigured
    && /^https:\/\/[^\s]+$/i.test(s.gatewayWebhookUrl);
  return {
    settings: s,
    errors,
    invoiceProfile: Boolean(s.legalName) && errors.length === 0,
    manualUpi,
    bankTransfer,
    gatewayPublicConfig,
    gatewayAutoConfirmation,
    canShowPaymentInstructions: manualUpi || bankTransfer,
  };
}

export function calculateInvoiceTax(amountPaise, input = {}, placeOfSupplyStateCode = '') {
  const s = normalizeBillingSettings(input);
  const amount = Math.max(0, Math.round(Number(amountPaise) || 0));
  const sellerStateCode = (s.stateCode || s.gstin.slice(0, 2) || '').padStart(2, '0');
  const placeStateCode = String(placeOfSupplyStateCode || sellerStateCode || '').padStart(2, '0');
  if (!s.gstEnabled || !(s.gstRatePercent > 0) || amount === 0) {
    return {
      gstEnabled: false, gstRatePercent: 0, taxablePaise: amount, taxPaise: 0,
      cgstPaise: 0, sgstPaise: 0, igstPaise: 0, grandTotalPaise: amount,
      interState: false, sellerStateCode, placeStateCode,
    };
  }
  let taxablePaise; let taxPaise; let grandTotalPaise;
  if (s.priceIncludesGst) {
    taxablePaise = Math.round(amount * 100 / (100 + s.gstRatePercent));
    taxPaise = amount - taxablePaise;
    grandTotalPaise = amount;
  } else {
    taxablePaise = amount;
    taxPaise = Math.round(amount * s.gstRatePercent / 100);
    grandTotalPaise = amount + taxPaise;
  }
  const interState = Boolean(sellerStateCode && placeStateCode && sellerStateCode !== placeStateCode);
  const cgstPaise = interState ? 0 : Math.round(taxPaise / 2);
  return {
    gstEnabled: true, gstRatePercent: s.gstRatePercent,
    taxablePaise, taxPaise, cgstPaise,
    sgstPaise: interState ? 0 : taxPaise - cgstPaise,
    igstPaise: interState ? taxPaise : 0,
    grandTotalPaise, interState, sellerStateCode, placeStateCode,
  };
}

export function buildUpiUri(input = {}, amountPaise, note = 'Yoga Studio fees') {
  const s = normalizeBillingSettings(input);
  const amount = Math.max(0, Math.round(Number(amountPaise) || 0));
  if (!isValidUpiId(s.upiId) || amount <= 0) return '';
  const params = new URLSearchParams({
    pa: s.upiId,
    pn: s.upiPayeeName || s.legalName || 'Yoga Studio',
    am: (amount / 100).toFixed(2),
    cu: 'INR',
    tn: String(note || 'Yoga Studio fees').slice(0, 80),
  });
  // URLSearchParams encodes spaces as '+'; UPI QR references normally use
  // %20. Literal plus signs in values have already become %2B, so this is safe.
  return `upi://pay?${params.toString().replaceAll('+', '%20')}`;
}

export function formatInvoiceINR(paise) {
  return `₹${paiseToRupees(paise).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

export function emptySnapshot() {
  return {
    branches: [], students: [], instructors: [], batches: [], enrollments: [],
    attendance: [], plans: [], memberships: [], payments: [], billingSettings: [],
  };
}

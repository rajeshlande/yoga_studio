import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billingReadiness,
  buildUpiUri,
  calculateInvoiceTax,
  formatInvoiceINR,
  normalizeBillingSettings,
  payableBalance,
  validateBillingSettings,
} from '../src/lib/erp/logic.js';
import {
  createEmptySyncState,
  enqueueUpsert,
  loadSyncState,
  saveSyncState,
  syncStorageKey,
} from '../src/lib/erp/syncStore.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] || null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

test('GST-inclusive invoice back-calculates taxable value and splits CGST/SGST intra-state', () => {
  const tax = calculateInvoiceTax(118000, {
    gstEnabled: true, gstRatePercent: 18, priceIncludesGst: true, stateCode: '27',
  }, '27');
  assert.equal(tax.taxablePaise, 100000);
  assert.equal(tax.cgstPaise, 9000);
  assert.equal(tax.sgstPaise, 9000);
  assert.equal(tax.igstPaise, 0);
  assert.equal(tax.grandTotalPaise, 118000);
});

test('GST invoice uses IGST for an inter-state place of supply', () => {
  const tax = calculateInvoiceTax(118000, {
    gstEnabled: true, gstRatePercent: 18, priceIncludesGst: true, stateCode: '27',
  }, '29');
  assert.equal(tax.taxablePaise, 100000);
  assert.equal(tax.igstPaise, 18000);
  assert.equal(tax.cgstPaise, 0);
  assert.equal(tax.grandTotalPaise, 118000);
});

test('GST-exclusive invoice adds tax on top, while no-GST invoices stay retail format', () => {
  const exclusive = calculateInvoiceTax(100000, {
    gstEnabled: true, gstRatePercent: 18, priceIncludesGst: false, stateCode: '27',
  }, '27');
  assert.equal(exclusive.grandTotalPaise, 118000);
  const retail = calculateInvoiceTax(100000, {gstEnabled: false, gstRatePercent: 18}, '29');
  assert.equal(retail.taxPaise, 0);
  assert.equal(retail.grandTotalPaise, 100000);
  assert.equal(formatInvoiceINR(118000), '₹1,180.00');
});

test('GST-exclusive dues compare gross payable totals with gross cash received', () => {
  const membership = {id: 'm1', amountPaise: 100000, endDate: '2026-12-31'};
  const payments = [{membershipId: 'm1', amountPaise: 59000, status: 'recorded'}];
  const balance = payableBalance(membership, payments, {
    gstEnabled: true, gstRatePercent: 18, priceIncludesGst: false, stateCode: '27',
  }, '2026-10-29');
  assert.equal(balance.taxableTotalPaise, 100000);
  assert.equal(balance.total, 118000);
  assert.equal(balance.paid, 59000);
  assert.equal(balance.due, 59000);
  assert.equal(balance.taxableDuePaise, 50000);
  assert.equal(balance.paymentStatus, 'partial');
});

test('billing settings normalize and validate UPI, bank, GST and public gateway fields', () => {
  const valid = normalizeBillingSettings({
    legalName: 'Example Studio LLP',
    state: 'Maharashtra',
    stateCode: '27',
    pinCode: '400001',
    gstEnabled: true,
    gstin: '27AAAPL1234C1Z5',
    gstRatePercent: '18',
    sacCode: '9985',
    priceIncludesGst: true,
    upiId: 'studio@okbank',
    upiPayeeName: 'Example Studio LLP',
    bankName: 'Example Bank',
    bankAccountName: 'Example Studio LLP',
    bankAccountNumber: '123456789012',
    ifsc: 'HDFC0001234',
    gatewayProvider: 'razorpay',
    gatewayEnvironment: 'test',
    gatewayPublicKeyId: 'rzp_test_example123',
    gatewayWebhookUrl: 'https://functions.example.test/razorpay-webhook',
    gatewayWebhookConfigured: true,
  });
  assert.deepEqual(validateBillingSettings(valid), []);
  const ready = billingReadiness(valid);
  assert.equal(ready.manualUpi, true);
  assert.equal(ready.bankTransfer, true);
  assert.equal(ready.gatewayAutoConfirmation, true);

  const invalid = normalizeBillingSettings({
    ...valid,
    gstin: '29AAAPL1234C1Z5',
    bankName: '',
    gatewayEnvironment: 'live',
  });
  const errors = validateBillingSettings(invalid).join(' ');
  assert.match(errors, /GSTIN must start with the seller state code/);
  assert.match(errors, /Complete bank name, account name, account number and IFSC/);
  assert.match(errors, /start with rzp_live_/);
});

test('dynamic UPI URI carries payee, amount, currency and invoice reference', () => {
  const uri = buildUpiUri({upiId: 'studio@okbank', upiPayeeName: 'Example Studio', legalName: 'Example Studio'}, 118000, 'YS-INV-1001');
  assert.match(uri, /^upi:\/\/pay\?/);
  assert.match(uri, /pa=studio%40okbank/);
  assert.match(uri, /pn=Example%20Studio/);
  assert.match(uri, /am=1180\.00/);
  assert.match(uri, /cu=INR/);
  assert.match(uri, /tn=YS-INV-1001/);
  assert.equal(buildUpiUri({upiId: ''}, 118000, 'YS-INV-1001'), '');
});

test('a corrupt primary sync-state copy falls back to the mirrored durable outbox', () => {
  const storage = new MemoryStorage();
  let state = createEmptySyncState({userId: 'user-1', organizationId: 'org-1', deviceId: 'device-1'});
  state = enqueueUpsert(state, 'billingSettings', {
    id: 'org-1', legalName: 'Example Studio', gstEnabled: false,
  });
  saveSyncState(storage, state);
  storage.setItem(syncStorageKey('user-1', 'org-1'), '{"truncated":');
  const loaded = loadSyncState(storage, 'user-1', 'org-1');
  assert.equal(loaded.outbox.length, 1);
  assert.equal(loaded.outbox[0].entity, 'billingSettings');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceSummary, formatINR, membershipBalance, membershipEnd,
  rupeesToPaise, isBatchOnDate,
} from '../src/lib/erp/logic.js';

test('joining-date membership ends one day before the monthly anniversary', () => {
  assert.equal(membershipEnd('2026-01-10', 1, 'joining'), '2026-02-09');
  assert.equal(membershipEnd('2026-01-31', 1, 'joining'), '2026-02-27');
  assert.equal(membershipEnd('2026-01-10', 3, 'joining'), '2026-04-09');
});

test('calendar-month membership ends on the last day of the covered month', () => {
  assert.equal(membershipEnd('2026-01-10', 1, 'calendar'), '2026-01-31');
  assert.equal(membershipEnd('2026-01-10', 3, 'calendar'), '2026-03-31');
  assert.equal(membershipEnd('2026-02-02', 1, 'calendar'), '2026-02-28');
});

test('money converts rupees to integer paise and formats in INR', () => {
  assert.equal(rupeesToPaise('1500'), 150000);
  assert.equal(rupeesToPaise('999.50'), 99950);
  assert.equal(rupeesToPaise('-5'), 0);
  assert.equal(formatINR(150000), '₹1,500');
  assert.equal(formatINR(99950), '₹999.50');
});

test('membership balance reports paid, partial, unpaid and expiry', () => {
  const membership = {id: 'm1', amountPaise: 150000, endDate: '2026-02-09'};
  assert.equal(membershipBalance(membership, [], '2026-01-15').paymentStatus, 'unpaid');
  const partial = membershipBalance(membership, [{membershipId: 'm1', amountPaise: 50000}], '2026-01-15');
  assert.deepEqual([partial.paid, partial.due, partial.paymentStatus], [50000, 100000, 'partial']);
  const paid = membershipBalance(membership, [{membershipId: 'm1', amountPaise: 150000}], '2026-01-15');
  assert.deepEqual([paid.due, paid.paymentStatus], [0, 'paid']);
  assert.equal(membershipBalance(membership, [], '2026-02-10').expired, true);
});

test('attendance summary counts statuses and rate (late counts as attended)', () => {
  const summary = attendanceSummary([
    {status: 'present'}, {status: 'present'}, {status: 'late'}, {status: 'absent'},
  ]);
  assert.deepEqual(summary, {present: 2, late: 1, absent: 1, total: 4, rate: 75});
  assert.equal(attendanceSummary([]).rate, null);
});

test('batch schedule matches the weekday of a date', () => {
  // 2026-10-29 is a Thursday.
  assert.equal(isBatchOnDate({days: [4]}, '2026-10-29'), true);
  assert.equal(isBatchOnDate({days: [1, 3, 5]}, '2026-10-29'), false);
});

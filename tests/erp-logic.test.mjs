import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admissionWaitingDays, attendanceSummary, batchFill, batchOverlapDays,
  findInstructorScheduleConflicts,
  formatINR, instructorFinanceStudentIds, membershipBalance, membershipEnd,
  monthlyRecurringRevenuePaise, nextBatchDate, nextRenewalDate, normalizeInstructorProfile,
  normalizePlanTemplate,
  normalizeSubscriptionLifecycle, pauseDaysBetween, planBillingPeriodLabel,
  renewalStartDate, rupeesToPaise, subscriptionLifecycle, isBatchOnDate,
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

test('subscription lifecycle derives scheduled, paused, expired and cancelled states', () => {
  const base = {status: 'active', startDate: '2026-10-01', endDate: '2026-10-31', autoRenew: true};
  assert.equal(subscriptionLifecycle(base, '2026-10-15').id, 'active');
  assert.equal(subscriptionLifecycle({...base, startDate: '2026-11-01', endDate: '2026-11-30'}, '2026-10-15').id, 'scheduled');
  assert.equal(subscriptionLifecycle({...base, status: 'paused'}, '2026-11-15').id, 'paused');
  assert.equal(subscriptionLifecycle(base, '2026-11-01').id, 'expired');
  assert.equal(subscriptionLifecycle({...base, status: 'cancelled'}, '2026-10-15').id, 'cancelled');
  assert.equal(nextRenewalDate(base, '2026-10-15'), '2026-11-01');
  assert.equal(nextRenewalDate({...base, autoRenew: false}, '2026-10-15'), '');
  assert.equal(nextRenewalDate(base, '2026-10-15', true), '');
  assert.equal(renewalStartDate(base, '2026-10-15'), '2026-11-01');
  assert.equal(renewalStartDate(base, '2026-11-05'), '2026-11-05');
});

test('Odoo-style plan templates distinguish subscriptions from one-month-only offerings', () => {
  assert.deepEqual(normalizePlanTemplate({
    planType: 'subscription', durationMonths: 3, billingCycle: 'calendar',
    renewalEnabledDefault: false,
  }), {
    planType: 'subscription', durationMonths: 3, billingCycle: 'calendar',
    renewalEnabledDefault: false,
  });
  assert.deepEqual(normalizePlanTemplate({
    planType: 'one_month', durationMonths: 12, billingCycle: 'joining',
    renewalEnabledDefault: true,
  }), {
    planType: 'one_month', durationMonths: 1, billingCycle: 'joining',
    renewalEnabledDefault: false,
  });
  assert.equal(planBillingPeriodLabel({planType: 'subscription', durationMonths: 3}), 'Every 3 months');
  assert.equal(planBillingPeriodLabel({planType: 'one_month', durationMonths: 12}), 'One month only');

  const oneMonth = normalizeSubscriptionLifecycle({
    status: 'active', autoRenew: true, previousMembershipId: 'previous',
    renewalNumber: 4, totalPausedDays: 9,
  }, null, 'one_month');
  assert.equal(oneMonth.offeringType, 'one_month');
  assert.equal(oneMonth.autoRenew, false);
  assert.equal(oneMonth.previousMembershipId, '');
  assert.equal(oneMonth.renewalNumber, 0);
  assert.equal(oneMonth.totalPausedDays, 0);
  assert.equal(nextRenewalDate({
    offeringType: 'one_month', status: 'active', endDate: '2026-10-31', autoRenew: false,
  }, '2026-10-15'), '');
});

test('paused days extend a subscription end date when it resumes', () => {
  assert.equal(pauseDaysBetween('2026-10-10', '2026-10-20'), 10);
  assert.equal(pauseDaysBetween('2026-10-20', '2026-10-10'), 0);
  assert.equal(membershipEnd('2026-10-01', 1, 'joining', 10), '2026-11-10');
});

test('monthly recurring revenue counts only current active subscriptions', () => {
  const rows = [
    {status: 'active', startDate: '2026-10-01', endDate: '2026-12-31', amountPaise: 300000, durationMonths: 3},
    {status: 'active', startDate: '2026-10-01', endDate: '2026-10-31', amountPaise: 150000, durationMonths: 1},
    {status: 'paused', startDate: '2026-10-01', endDate: '2026-10-31', amountPaise: 900000, durationMonths: 1},
    {status: 'active', startDate: '2026-11-01', endDate: '2026-11-30', amountPaise: 900000, durationMonths: 1},
    {status: 'cancelled', startDate: '2026-10-01', endDate: '2026-10-31', amountPaise: 900000, durationMonths: 1},
    {offeringType: 'one_month', status: 'active', startDate: '2026-10-01', endDate: '2026-10-31', amountPaise: 900000, durationMonths: 1},
  ];
  assert.equal(monthlyRecurringRevenuePaise(rows, '2026-10-15'), 250000);
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

test('batch workspace derives next class, capacity state and instructor overlaps', () => {
  const batch = {id: 'batch-1', days: [5], startTime: '07:00', durationMins: 60, capacity: 20, status: 'active', instructorId: 'instructor-1'};
  assert.equal(nextBatchDate(batch, '2026-10-29'), '2026-10-30');
  assert.equal(nextBatchDate({...batch, days: [4]}, '2026-10-29'), '2026-10-29');

  const enrollments = Array.from({length: 16}, (_, index) => ({
    id: `enrollment-${index}`, batchId: 'batch-1', studentId: `student-${index}`, status: 'active',
  }));
  enrollments.push({id: 'ended', batchId: 'batch-1', studentId: 'student-ended', status: 'ended'});
  assert.deepEqual(batchFill(batch, enrollments), {
    enrolled: 16, capacity: 20, seatsLeft: 4, percent: 80, status: 'almost_full',
  });
  assert.equal(batchFill({...batch, capacity: 16}, enrollments).status, 'full');

  const overlapping = {id: 'batch-2', days: [5], startTime: '07:30', durationMins: 60, status: 'active', instructorId: 'instructor-1'};
  const adjacent = {id: 'batch-3', days: [5], startTime: '08:00', durationMins: 60, status: 'active', instructorId: 'instructor-1'};
  const otherInstructor = {...overlapping, id: 'batch-4', instructorId: 'instructor-2'};
  const archived = {...overlapping, id: 'batch-5', status: 'archived'};
  assert.deepEqual(batchOverlapDays(batch, overlapping), [5]);
  assert.deepEqual(batchOverlapDays(batch, adjacent), []);
  const conflicts = findInstructorScheduleConflicts([batch, overlapping, adjacent, otherInstructor, archived]);
  assert.equal(conflicts.length, 2);
  assert.deepEqual(conflicts.map(conflict => conflict.batches.map(item => item.id)), [
    ['batch-1', 'batch-2'],
    ['batch-2', 'batch-3'],
  ]);
  assert.equal(conflicts[0].instructorId, 'instructor-1');
  assert.deepEqual(conflicts[0].days, [5]);
});

test('admission and instructor collection helpers stay within their operational scope', () => {
  assert.equal(admissionWaitingDays('2026-10-31T10:00:00Z', '2026-10-31'), 0);
  assert.equal(admissionWaitingDays('2026-10-24T10:00:00Z', '2026-10-31'), 7);
  assert.equal(admissionWaitingDays('', '2026-10-31'), null);

  const data = {
    batches: [
      {id: 'own-active', instructorId: 'teacher-1', status: 'active'},
      {id: 'own-archived', instructorId: 'teacher-1', status: 'archived'},
      {id: 'other-teacher', instructorId: 'teacher-2', status: 'active'},
    ],
    enrollments: [
      {batchId: 'own-active', studentId: 'student-1', status: 'active'},
      {batchId: 'own-active', studentId: 'student-2', status: 'ended'},
      {batchId: 'own-archived', studentId: 'student-3', status: 'active'},
      {batchId: 'other-teacher', studentId: 'student-4', status: 'active'},
    ],
  };
  assert.deepEqual(instructorFinanceStudentIds(data, 'teacher-1'), ['student-1']);
  assert.deepEqual(instructorFinanceStudentIds(data, ''), []);
});

test('instructor profiles normalize specialties, experience and joining date', () => {
  assert.deepEqual(normalizeInstructorProfile({
    bio: '  Gentle morning teacher.  ',
    specialties: ' Hatha, yin, Hatha, , Breathwork ',
    qualifications: '  RYT-500 · Prenatal certificate  ',
    experienceYears: '7.8',
    joiningDate: '2024-04-15',
  }), {
    bio: 'Gentle morning teacher.',
    specialties: ['Hatha', 'yin', 'Breathwork'],
    qualifications: 'RYT-500 · Prenatal certificate',
    experienceYears: 7,
    joiningDate: '2024-04-15',
  });
  assert.deepEqual(normalizeInstructorProfile({
    specialties: ['Power', ' power ', 'Meditation'],
    experienceYears: 99,
    joiningDate: '15/04/2024',
  }), {
    bio: '',
    specialties: ['Power', 'Meditation'],
    qualifications: '',
    experienceYears: 80,
    joiningDate: '',
  });
});

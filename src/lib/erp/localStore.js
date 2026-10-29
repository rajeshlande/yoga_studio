// Local device store — the offline adapter behind the same async API the
// Supabase RPC client exposes (see data.js). Data lives only in this browser
// (localStorage) so the ERP works fully offline after the first visit.
//
// The store starts EMPTY. No business records are seeded; the owner creates
// branches, students and batches themselves. Export/import (Settings) gives a
// manual backup before switching to Supabase. PGlite could replace this
// module's internals later without any UI change — see docs/12-erp-core.

import {
  uid, toISODate, membershipEnd, emptySnapshot,
  normalizeBillingSettings, validateBillingSettings,
} from './logic.js';

export const LOCAL_DB_KEY = 'yoga-studio-erp-v1';

function emptyDb() {
  return {version: 1, counters: {receipt: 0}, ...emptySnapshot()};
}

export function loadDb() {
  try {
    const raw = localStorage.getItem(LOCAL_DB_KEY);
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw);
    return {...emptyDb(), ...parsed, counters: {receipt: 0, ...(parsed.counters || {})}};
  } catch {
    return emptyDb();
  }
}

function saveDb(db) {
  localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
  return snapshotOf(db);
}

function snapshotOf(db) {
  const {
    branches, students, instructors, batches, enrollments, attendance,
    plans, memberships, payments, billingSettings,
  } = db;
  return structuredClone({
    branches, students, instructors, batches, enrollments, attendance,
    plans, memberships, payments, billingSettings: billingSettings || [],
  });
}

function upsert(list, record) {
  const index = list.findIndex(item => item.id === record.id);
  if (index >= 0) list[index] = {...list[index], ...record};
  else list.push(record);
  return record;
}

const nowISO = () => new Date().toISOString();

export const localStore = {
  async getSnapshot() {
    return snapshotOf(loadDb());
  },

  async saveBranch(payload) {
    const db = loadDb();
    upsert(db.branches, {
      id: payload.id || uid(), name: payload.name?.trim(), city: payload.city || '',
      address: payload.address || '', phone: payload.phone || '',
      status: payload.status || 'active', createdAt: payload.createdAt || nowISO(),
    });
    return saveDb(db);
  },

  async archiveBranch(id) {
    const db = loadDb();
    const branch = db.branches.find(b => b.id === id);
    if (branch) branch.status = branch.status === 'archived' ? 'active' : 'archived';
    return saveDb(db);
  },

  async saveStudent(payload) {
    const db = loadDb();
    upsert(db.students, {
      id: payload.id || uid(), branchId: payload.branchId, fullName: payload.fullName?.trim(),
      phone: payload.phone || '', email: payload.email || '', gender: payload.gender || '',
      dob: payload.dob || '', joiningDate: payload.joiningDate || toISODate(),
      status: payload.status || 'active', notes: payload.notes || '', createdAt: payload.createdAt || nowISO(),
    });
    return saveDb(db);
  },

  async archiveStudent(id) {
    const db = loadDb();
    const student = db.students.find(s => s.id === id);
    if (student) student.status = student.status === 'inactive' ? 'active' : 'inactive';
    return saveDb(db);
  },

  async saveInstructor(payload) {
    const db = loadDb();
    upsert(db.instructors, {
      id: payload.id || uid(), branchId: payload.branchId || '', fullName: payload.fullName?.trim(),
      phone: payload.phone || '', email: payload.email || '',
      status: payload.status || 'active', createdAt: payload.createdAt || nowISO(),
    });
    return saveDb(db);
  },

  async saveBatch(payload) {
    const db = loadDb();
    upsert(db.batches, {
      id: payload.id || uid(), branchId: payload.branchId, name: payload.name?.trim(),
      instructorId: payload.instructorId || '', days: [...(payload.days || [])].sort(),
      startTime: payload.startTime || '07:00', durationMins: Number(payload.durationMins) || 60,
      capacity: Number(payload.capacity) || 20, status: payload.status || 'active',
      createdAt: payload.createdAt || nowISO(),
    });
    return saveDb(db);
  },

  async archiveBatch(id) {
    const db = loadDb();
    const batch = db.batches.find(b => b.id === id);
    if (batch) batch.status = batch.status === 'archived' ? 'active' : 'archived';
    return saveDb(db);
  },

  async enrollStudent({batchId, studentId}) {
    const db = loadDb();
    const existing = db.enrollments.find(e => e.batchId === batchId && e.studentId === studentId);
    if (existing) existing.status = 'active';
    else db.enrollments.push({id: uid(), batchId, studentId, joinedOn: toISODate(), status: 'active'});
    return saveDb(db);
  },

  async endEnrollment(id) {
    const db = loadDb();
    const enrollment = db.enrollments.find(e => e.id === id);
    if (enrollment) enrollment.status = 'ended';
    return saveDb(db);
  },

  async markAttendance({batchId, classDate, marks}) {
    const db = loadDb();
    for (const mark of marks || []) {
      const existing = db.attendance.find(
        a => a.batchId === batchId && a.studentId === mark.studentId && a.classDate === classDate,
      );
      if (existing) Object.assign(existing, {status: mark.status, updatedAt: nowISO()});
      else db.attendance.push({id: uid(), batchId, studentId: mark.studentId, classDate, status: mark.status, updatedAt: nowISO()});
    }
    return saveDb(db);
  },

  async savePlan(payload) {
    const db = loadDb();
    upsert(db.plans, {
      id: payload.id || uid(), name: payload.name?.trim(), amountPaise: Number(payload.amountPaise) || 0,
      durationMonths: Number(payload.durationMonths) || 1, status: payload.status || 'active',
      createdAt: payload.createdAt || nowISO(),
    });
    return saveDb(db);
  },

  async saveMembership(payload) {
    const db = loadDb();
    const plan = db.plans.find(p => p.id === payload.planId);
    const durationMonths = Number(payload.durationMonths) || plan?.durationMonths || 1;
    upsert(db.memberships, {
      id: payload.id || uid(), studentId: payload.studentId, planId: payload.planId,
      branchId: payload.branchId || '', startDate: payload.startDate,
      endDate: membershipEnd(payload.startDate, durationMonths, payload.billingCycle || 'joining'),
      billingCycle: payload.billingCycle || 'joining', durationMonths,
      amountPaise: Number(payload.amountPaise) || plan?.amountPaise || 0,
      status: payload.status || 'active', createdAt: payload.createdAt || nowISO(),
    });
    return saveDb(db);
  },

  async cancelMembership(id) {
    const db = loadDb();
    const membership = db.memberships.find(m => m.id === id);
    if (membership) membership.status = 'cancelled';
    return saveDb(db);
  },

  async recordPayment(payload) {
    const db = loadDb();
    db.counters.receipt += 1;
    const paidOn = payload.paidOn || toISODate();
    const year = String(paidOn).slice(0, 4);
    db.payments.push({
      id: payload.id || uid(), studentId: payload.studentId, membershipId: payload.membershipId || '',
      branchId: payload.branchId || '', amountPaise: Number(payload.amountPaise) || 0,
      method: payload.method || 'cash', paidOn, note: payload.note || '',
      receiptNo: `YS-${year}-${String(db.counters.receipt).padStart(4, '0')}`,
      status: 'recorded', voidReason: '', syncVersion: 1,
      createdAt: nowISO(),
    });
    return saveDb(db);
  },

  async voidPayment(input) {
    const db = loadDb();
    const id = typeof input === 'string' ? input : input?.id;
    const reason = typeof input === 'string' ? '' : (input?.reason || '');
    const payment = db.payments.find(p => p.id === id);
    if (payment) {
      payment.status = 'void';
      payment.voidReason = reason;
      payment.syncVersion = (payment.syncVersion || 1) + 1;
    }
    return saveDb(db);
  },

  async saveBillingSettings(payload) {
    const settings = normalizeBillingSettings(payload);
    const errors = validateBillingSettings(settings);
    if (errors.length) throw new Error(errors.join(' '));
    const db = loadDb();
    const old = db.billingSettings?.[0];
    db.billingSettings = [{
      ...settings,
      id: old?.id || payload?.id || uid(),
      createdAt: old?.createdAt || nowISO(),
      updatedAt: nowISO(),
      syncVersion: (old?.syncVersion || 0) + 1,
    }];
    return saveDb(db);
  },
};

export function exportLocalData() {
  return JSON.stringify(loadDb(), null, 2);
}

export function importLocalData(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.branches) || !Array.isArray(parsed.students)) {
    throw new Error('That file does not look like a Yoga Studio ERP backup.');
  }
  const db = {...emptyDb(), ...parsed};
  return saveDb(db);
}

export function clearLocalData() {
  localStorage.removeItem(LOCAL_DB_KEY);
  return emptySnapshot();
}

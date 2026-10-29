import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledgeOperations,
  addConflict,
  createEmptySyncState,
  deriveSnapshot,
  enqueuePaymentCreate,
  enqueuePaymentVoid,
  enqueueUpsert,
  loadLastSyncState,
  readyOperations,
  reconcileServerSnapshot,
  removeOperations,
  resolveConflict,
  saveSyncState,
} from '../src/lib/erp/syncStore.js';
import {emptySnapshot, membershipBalance} from '../src/lib/erp/logic.js';

const BRANCH = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';
const BATCH = '33333333-3333-4333-8333-333333333333';
const PAYMENT = '44444444-4444-4444-8444-444444444444';
const MEMBERSHIP = '55555555-5555-4555-8555-555555555555';

const newState = () => createEmptySyncState({
  userId: 'user-1', organizationId: 'org-1', deviceId: 'device-1',
});

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] || null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

test('offline create then edit coalesces into one version-0 operation', () => {
  let state = newState();
  state = enqueueUpsert(state, 'branches', {
    id: BRANCH, name: 'Panvel', city: '', address: '', phone: '', status: 'active',
  });
  state = enqueueUpsert(state, 'branches', {
    id: BRANCH, name: 'Thane', city: 'Thane', address: '', phone: '999', status: 'active',
  });
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].baseVersion, 0);
  assert.equal(state.outbox[0].proposedRecord.name, 'Thane');
  assert.equal(deriveSnapshot(state.baseSnapshot, state.outbox).branches[0].phone, '999');
});

test('reverting an offline edit back to the server value removes the operation', () => {
  let state = newState();
  const serverStudent = {
    id: STUDENT, branchId: BRANCH, fullName: 'Asha', phone: '111', email: '', gender: '',
    dob: '', joiningDate: '2026-01-01', status: 'active', notes: '', syncVersion: 2,
  };
  state.baseSnapshot.students.push(serverStudent);
  state = enqueueUpsert(state, 'students', {...serverStudent, phone: '222'});
  assert.equal(state.outbox.length, 1);
  state = enqueueUpsert(state, 'students', {...serverStudent});
  assert.equal(state.outbox.length, 0);
});

test('dependent offline creates are not ready until their parent is acknowledged', () => {
  let state = newState();
  state = enqueueUpsert(state, 'branches', {
    id: BRANCH, name: 'Panvel', city: '', address: '', phone: '', status: 'active',
  });
  state = enqueueUpsert(state, 'students', {
    id: STUDENT, branchId: BRANCH, fullName: 'Asha', phone: '', email: '', gender: '',
    dob: '', joiningDate: '2026-01-01', status: 'active', notes: '',
  });

  assert.deepEqual(readyOperations(state).map(op => op.entity), ['branches']);

  const branchFromServer = {
    id: BRANCH, name: 'Panvel', city: '', address: '', phone: '', status: 'active', syncVersion: 1,
  };
  state = removeOperations(state, [state.outbox.find(op => op.entity === 'branches').opId]);
  state = reconcileServerSnapshot(state, {...emptySnapshot(), branches: [branchFromServer]});
  assert.deepEqual(readyOperations(state).map(op => op.entity), ['students']);
});

test('acknowledged work is merged into the base snapshot before the refresh pull', () => {
  let state = newState();
  state = enqueueUpsert(state, 'branches', {
    id: BRANCH, name: 'Panvel', city: 'Panvel', address: '', phone: '', status: 'active',
  });
  const op = state.outbox[0];
  state = acknowledgeOperations(state, [{
    op,
    result: {status: 'applied', serverEntityId: BRANCH, serverVersion: 1},
  }]);
  assert.equal(state.outbox.length, 0);
  assert.equal(state.baseSnapshot.branches[0].name, 'Panvel');
  assert.equal(state.baseSnapshot.branches[0].syncVersion, 1);
  assert.equal(deriveSnapshot(state.baseSnapshot, state.outbox).branches[0].syncPending, undefined);
});

test('attendance changes for the same class coalesce by natural key', () => {
  let state = newState();
  const mark = {
    id: '66666666-6666-4666-8666-666666666666', batchId: BATCH, studentId: STUDENT,
    classDate: '2026-10-29', status: 'present',
  };
  state = enqueueUpsert(state, 'attendance', mark);
  state = enqueueUpsert(state, 'attendance', {...mark, status: 'late'});
  assert.equal(state.outbox.length, 1);
  assert.equal(deriveSnapshot(state.baseSnapshot, state.outbox).attendance[0].status, 'late');
});

test('attendance waits for an enrollment created in the same offline session', () => {
  let state = newState();
  const enrollment = {
    id: '77777777-7777-4777-8777-777777777777', batchId: BATCH, studentId: STUDENT,
    joinedOn: '2026-10-01', status: 'active',
  };
  state = enqueueUpsert(state, 'enrollments', enrollment);
  state = enqueueUpsert(state, 'attendance', {
    id: '88888888-8888-4888-8888-888888888888', batchId: BATCH, studentId: STUDENT,
    classDate: '2026-10-29', status: 'present',
  });
  assert.deepEqual(readyOperations(state).map(op => op.entity), ['enrollments']);

  state = removeOperations(state, [state.outbox.find(op => op.entity === 'enrollments').opId]);
  state = reconcileServerSnapshot(state, {
    ...emptySnapshot(), enrollments: [{...enrollment, syncVersion: 1}],
  });
  assert.deepEqual(readyOperations(state).map(op => op.entity), ['attendance']);
});

test('keep-mine resolution rebases only changed fields onto the newer server record', () => {
  let state = newState();
  const copied = {
    id: STUDENT, branchId: BRANCH, fullName: 'Asha', phone: '111', email: 'old@example.test',
    gender: '', dob: '', joiningDate: '2026-01-01', status: 'active', notes: '', syncVersion: 3,
  };
  state.baseSnapshot.students.push(copied);
  state = enqueueUpsert(state, 'students', {...copied, phone: '222'});

  const newerServer = {...copied, email: 'new@example.test', syncVersion: 4};
  state = reconcileServerSnapshot(state, {...emptySnapshot(), students: [newerServer]});
  state = addConflict(state, state.outbox[0], {
    status: 'conflict', code: 'VERSION_CONFLICT', serverVersion: 4, serverEntityId: STUDENT,
  });
  assert.equal(state.outbox.length, 0);
  assert.equal(state.conflicts.length, 1);
  assert.equal(deriveSnapshot(state.baseSnapshot, state.outbox).students[0].phone, '111');

  state = resolveConflict(state, state.conflicts[0].id, 'mine');
  assert.equal(state.conflicts.length, 0);
  assert.equal(state.outbox.length, 1);
  assert.equal(state.outbox[0].baseVersion, 4);
  assert.equal(state.outbox[0].proposedRecord.phone, '222');
  assert.equal(state.outbox[0].proposedRecord.email, 'new@example.test');
});

test('keep-server resolution discards only the conflicting device change', () => {
  let state = newState();
  const copied = {
    id: BRANCH, name: 'Old', city: '', address: '', phone: '', status: 'active', syncVersion: 1,
  };
  state.baseSnapshot.branches.push(copied);
  state = enqueueUpsert(state, 'branches', {...copied, name: 'Mine'});
  const server = {...copied, name: 'Server', syncVersion: 2};
  state = reconcileServerSnapshot(state, {...emptySnapshot(), branches: [server]});
  state = addConflict(state, state.outbox[0], {status: 'conflict', serverVersion: 2});
  state = resolveConflict(state, state.conflicts[0].id, 'server');
  assert.equal(state.outbox.length, 0);
  assert.equal(deriveSnapshot(state.baseSnapshot, state.outbox).branches[0].name, 'Server');
});

test('an equivalent change already made online is reconciled without a conflict', () => {
  let state = newState();
  const copied = {
    id: BRANCH, name: 'Old', city: '', address: '', phone: '', status: 'active', syncVersion: 1,
  };
  state.baseSnapshot.branches.push(copied);
  state = enqueueUpsert(state, 'branches', {...copied, name: 'Same'});
  state = reconcileServerSnapshot(state, {
    ...emptySnapshot(), branches: [{...copied, name: 'Same', syncVersion: 2}],
  });
  assert.equal(state.outbox.length, 0);
  assert.equal(state.conflicts.length, 0);
});

test('unsynced payment has no final receipt and can be discarded; voided payments do not reduce dues', () => {
  let state = newState();
  state = enqueuePaymentCreate(state, {
    id: PAYMENT, studentId: STUDENT, membershipId: MEMBERSHIP, branchId: BRANCH,
    amountPaise: 150000, method: 'upi', paidOn: '2026-10-29', note: '',
  });
  const pending = deriveSnapshot(state.baseSnapshot, state.outbox).payments[0];
  assert.equal(pending.receiptNo, '');
  assert.equal(pending.syncPending, true);

  state = enqueuePaymentVoid(state, PAYMENT);
  assert.equal(state.outbox.length, 0);
  assert.equal(deriveSnapshot(state.baseSnapshot, state.outbox).payments.length, 0);

  const membership = {id: MEMBERSHIP, amountPaise: 150000, endDate: '2026-12-31'};
  const balance = membershipBalance(membership, [{
    id: PAYMENT, membershipId: MEMBERSHIP, amountPaise: 150000, status: 'void',
  }], '2026-10-29');
  assert.equal(balance.paid, 0);
  assert.equal(balance.due, 150000);
});

test('sync state persists per user and organization with a last-organization pointer', () => {
  const storage = new MemoryStorage();
  let state = newState();
  state = enqueueUpsert(state, 'branches', {
    id: BRANCH, name: 'Panvel', city: '', address: '', phone: '', status: 'active',
  });
  saveSyncState(storage, state);
  const loaded = loadLastSyncState(storage, 'user-1');
  assert.equal(loaded.organizationId, 'org-1');
  assert.equal(loaded.outbox.length, 1);
  assert.equal(loadLastSyncState(storage, 'another-user'), null);
});

// Offline-first sync state for the Supabase ERP client.
//
// The server snapshot is kept separately from the device outbox. The UI
// always renders `deriveSnapshot(baseSnapshot, outbox)`: the last snapshot
// acknowledged by Supabase, with this device's not-yet-acknowledged changes
// replayed on top. That separation is what makes conflict handling safe —
// when the server rejects an operation for a version conflict, the operation
// moves to the conflict list and the displayed record reverts to the server
// copy until a person resolves it. Nothing is silently overwritten.
//
// Every record carries the server-owned `syncVersion` integer. An update
// operation remembers the version it was based on; Supabase applies it only
// when the current row is still at that version (optimistic concurrency).
// Client clocks are never used to decide conflicts.

import {emptySnapshot} from './logic.js';

export const SYNC_COLLECTIONS = [
  'branches', 'students', 'instructors', 'batches', 'enrollments',
  'attendance', 'plans', 'memberships', 'payments',
];
export const SYNC_KEY_PREFIX = 'yoga-studio-erp-sync-v1';
const DEVICE_KEY = 'yoga-studio-device-id-v1';
const META_FIELDS = new Set(['syncVersion', 'syncPending', 'updatedAt']);
const NATURAL_KEYS = {
  enrollments: ['batchId', 'studentId'],
  attendance: ['batchId', 'studentId', 'classDate'],
};
const REFERENCE_FIELDS = ['branchId', 'studentId', 'instructorId', 'batchId', 'planId', 'membershipId'];

export const clone = value => (typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value ?? null)));

const nowISO = () => new Date().toISOString();

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function newUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getOrCreateDeviceId(storage) {
  try {
    const existing = storage?.getItem(DEVICE_KEY);
    if (isUuid(existing)) return existing;
    const created = newUuid();
    storage?.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return newUuid();
  }
}

export function syncStorageKey(userId, organizationId) {
  return `${SYNC_KEY_PREFIX}:${userId || 'anonymous'}:${organizationId || 'none'}`;
}

export function syncPointerKey(userId) {
  return `${SYNC_KEY_PREFIX}:${userId || 'anonymous'}:last-organization`;
}

export function normalizeSnapshot(data) {
  const base = emptySnapshot();
  if (!data || typeof data !== 'object') return base;
  for (const key of SYNC_COLLECTIONS) {
    if (!Array.isArray(data[key])) continue;
    base[key] = data[key].map(record => {
      const next = {...record};
      // Snapshots from SQL v1 have no sync_version column yet; the v2
      // migration initializes every existing row to 1, so 1 is the correct
      // base version for records first cached by the older client.
      next.syncVersion = Number.isInteger(next.syncVersion) && next.syncVersion > 0 ? next.syncVersion : 1;
      if (key === 'payments' && !next.status) next.status = 'recorded';
      return next;
    });
  }
  return base;
}

export function businessRecord(record) {
  if (!record) return null;
  const next = clone(record);
  for (const field of META_FIELDS) delete next[field];
  return next;
}

function comparable(record) {
  const next = businessRecord(record) || {};
  delete next.createdAt;
  return next;
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => deepEqual(value, b[index]));
  }
  if (typeof a === 'object') {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    return deepEqual(aKeys, bKeys) && aKeys.every(key => deepEqual(a[key], b[key]));
  }
  return false;
}

export function recordsEqual(a, b) {
  if (!a || !b) return false;
  return deepEqual(comparable(a), comparable(b));
}

export function naturalKey(entity, record) {
  const fields = NATURAL_KEYS[entity];
  if (!fields || !record) return null;
  if (fields.some(field => !record[field])) return null;
  return fields.map(field => record[field]).join('|');
}

export function findRecord(snapshot, entity, candidate) {
  const list = snapshot?.[entity] || [];
  if (!candidate) return null;
  if (typeof candidate === 'string') return list.find(record => record.id === candidate) || null;
  const key = naturalKey(entity, candidate);
  if (key) {
    const byNaturalKey = list.find(record => naturalKey(entity, record) === key);
    if (byNaturalKey) return byNaturalKey;
  }
  return list.find(record => record.id === candidate.id) || null;
}

function findRecordIndex(snapshot, entity, candidate) {
  const list = snapshot[entity];
  const key = naturalKey(entity, candidate);
  if (key) {
    const index = list.findIndex(record => naturalKey(entity, record) === key);
    if (index >= 0) return index;
  }
  return list.findIndex(record => record.id === candidate.id);
}

export function applyOperation(snapshotInput, op) {
  const snapshot = normalizeSnapshot(clone(snapshotInput));
  if (!op || !SYNC_COLLECTIONS.includes(op.entity)) return snapshot;
  if (op.type === 'upsert') {
    const record = {...clone(op.proposedRecord), syncPending: true};
    const index = findRecordIndex(snapshot, op.entity, record);
    if (index >= 0) snapshot[op.entity][index] = {...snapshot[op.entity][index], ...record};
    else snapshot[op.entity].push(record);
    return snapshot;
  }
  if (op.type === 'payment_create') {
    if (!snapshot.payments.some(payment => payment.id === op.entityId)) {
      snapshot.payments.push({...clone(op.proposedRecord), syncPending: true});
    }
    return snapshot;
  }
  if (op.type === 'payment_void') {
    const payment = snapshot.payments.find(item => item.id === op.entityId);
    if (payment) Object.assign(payment, {
      status: 'void', voidReason: op.payload?.reason || '', syncPending: true,
    });
    return snapshot;
  }
  return snapshot;
}

export function deriveSnapshot(baseSnapshot, outbox = []) {
  return [...outbox]
    .sort((a, b) => (a.seq || 0) - (b.seq || 0))
    .reduce((snapshot, op) => applyOperation(snapshot, op), normalizeSnapshot(baseSnapshot));
}

export function createEmptySyncState({userId = '', organizationId = '', context = null, deviceId = ''} = {}) {
  const now = nowISO();
  return {
    version: 1,
    userId,
    organizationId,
    context: context ? clone(context) : null,
    deviceId,
    baseSnapshot: emptySnapshot(),
    outbox: [],
    conflicts: [],
    nextSeq: 1,
    lastPulledAt: null,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeState(state) {
  if (!state || typeof state !== 'object') return null;
  return {
    ...createEmptySyncState(state),
    ...state,
    baseSnapshot: normalizeSnapshot(state.baseSnapshot),
    outbox: Array.isArray(state.outbox) ? state.outbox : [],
    conflicts: Array.isArray(state.conflicts) ? state.conflicts : [],
    nextSeq: Number.isInteger(state.nextSeq) && state.nextSeq > 0 ? state.nextSeq : 1,
  };
}

export function loadSyncState(storage, userId, organizationId) {
  try {
    const raw = storage?.getItem(syncStorageKey(userId, organizationId));
    const state = raw ? normalizeState(JSON.parse(raw)) : null;
    // Never let a stale or hand-edited key show another account's copy.
    if (!state || state.userId !== userId || state.organizationId !== organizationId) return null;
    return state;
  } catch {
    return null;
  }
}

function listStorageKeys(storage) {
  const keys = [];
  try {
    if (storage && Number.isInteger(storage.length) && typeof storage.key === 'function') {
      for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
    }
  } catch { /* Storage may be unavailable (private mode); callers degrade to memory. */ }
  return keys.filter(Boolean);
}

export function loadLastSyncState(storage, userId) {
  const organizationId = (() => {
    try { return storage?.getItem(syncPointerKey(userId)); } catch { return null; }
  })();
  if (organizationId) {
    const pointed = loadSyncState(storage, userId, organizationId);
    if (pointed) return pointed;
  }
  const prefix = `${SYNC_KEY_PREFIX}:${userId || 'anonymous'}:`;
  const candidates = listStorageKeys(storage)
    .filter(key => key.startsWith(prefix) && !key.endsWith(':last-organization') && !key.endsWith(':lock'))
    .map(key => {
      try { return normalizeState(JSON.parse(storage.getItem(key))); } catch { return null; }
    })
    .filter(state => state?.userId === userId && state.organizationId)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return candidates[0] || null;
}

export function saveSyncState(storage, state) {
  if (!storage || !state?.userId || !state?.organizationId) return false;
  const next = normalizeState({...state, updatedAt: nowISO()});
  storage.setItem(syncStorageKey(next.userId, next.organizationId), JSON.stringify(next));
  storage.setItem(syncPointerKey(next.userId), next.organizationId);
  return true;
}

export function clearSyncState(storage, userId, organizationId) {
  try {
    storage?.removeItem(syncStorageKey(userId, organizationId));
    storage?.removeItem(`${syncStorageKey(userId, organizationId)}:lock`);
    if (storage?.getItem(syncPointerKey(userId)) === organizationId) {
      storage.removeItem(syncPointerKey(userId));
    }
    return true;
  } catch {
    return false;
  }
}

export function mergeSyncStates(local, stored) {
  if (!local) return normalizeState(stored);
  if (!stored) return normalizeState(local);
  if (local.userId !== stored.userId || local.organizationId !== stored.organizationId) {
    return normalizeState(local);
  }
  const byOpId = new Map();
  for (const op of [...(stored.outbox || []), ...(local.outbox || [])]) byOpId.set(op.opId, op);
  const byConflictId = new Map();
  for (const conflict of [...(stored.conflicts || []), ...(local.conflicts || [])]) {
    byConflictId.set(conflict.id, conflict);
  }
  const storedNewerPull = String(stored.lastPulledAt || '') > String(local.lastPulledAt || '');
  return normalizeState({
    ...(storedNewerPull ? stored : local),
    context: local.context || stored.context,
    outbox: [...byOpId.values()].sort((a, b) => (a.seq || 0) - (b.seq || 0)),
    conflicts: [...byConflictId.values()],
    nextSeq: Math.max(local.nextSeq || 1, stored.nextSeq || 1),
    updatedAt: String(local.updatedAt || '') >= String(stored.updatedAt || '') ? local.updatedAt : stored.updatedAt,
  });
}

function newOperation(state, partial) {
  const op = {
    opId: newUuid(),
    seq: state.nextSeq,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    attempts: 0,
    ...partial,
  };
  state.nextSeq += 1;
  state.outbox.push(op);
  return op;
}

function sameOperationTarget(op, entity, record) {
  if (op.entity !== entity) return false;
  const key = naturalKey(entity, record);
  if (key && naturalKey(entity, op.proposedRecord) === key) return true;
  return op.entityId === record.id;
}

function conflictFor(state, entity, record) {
  return state.conflicts.find(conflict => sameOperationTarget(conflict.op, entity, record));
}

export function enqueueUpsert(inputState, entity, proposedInput) {
  const state = normalizeState(clone(inputState));
  const proposed = {...clone(proposedInput)};
  if (!isUuid(proposed.id)) proposed.id = newUuid();

  if (conflictFor(state, entity, proposed)) {
    const error = new Error('Resolve the sync conflict for this record before editing it again.');
    error.code = 'SYNC_CONFLICT_EXISTS';
    throw error;
  }

  const derived = deriveSnapshot(state.baseSnapshot, state.outbox);
  const derivedRecord = findRecord(derived, entity, proposed);
  if (derivedRecord) proposed.id = derivedRecord.id;

  const existing = state.outbox.find(op => op.type === 'upsert' && sameOperationTarget(op, entity, proposed));
  if (existing) {
    existing.proposedRecord = proposed;
    existing.payload = businessRecord(proposed);
    existing.updatedAt = nowISO();
    if (existing.baseRecord && recordsEqual(existing.baseRecord, proposed)) {
      state.outbox = state.outbox.filter(op => op.opId !== existing.opId);
    }
    state.updatedAt = nowISO();
    return state;
  }

  const baseRecord = findRecord(state.baseSnapshot, entity, proposed);
  if (baseRecord) proposed.id = baseRecord.id;
  if (baseRecord && recordsEqual(baseRecord, proposed)) return state;

  newOperation(state, {
    type: 'upsert',
    entity,
    entityId: proposed.id,
    baseVersion: baseRecord ? (baseRecord.syncVersion || 1) : 0,
    baseRecord: baseRecord ? clone(baseRecord) : null,
    proposedRecord: proposed,
    payload: businessRecord(proposed),
  });
  state.updatedAt = nowISO();
  return state;
}

export function enqueuePaymentCreate(inputState, paymentInput) {
  const state = normalizeState(clone(inputState));
  const proposed = {...clone(paymentInput)};
  if (!isUuid(proposed.id)) proposed.id = newUuid();
  proposed.receiptNo = '';
  proposed.status = 'recorded';
  newOperation(state, {
    type: 'payment_create',
    entity: 'payments',
    entityId: proposed.id,
    baseVersion: 0,
    baseRecord: null,
    proposedRecord: proposed,
    payload: businessRecord(proposed),
  });
  state.updatedAt = nowISO();
  return state;
}

export function enqueuePaymentVoid(inputState, paymentId, reason = '') {
  const state = normalizeState(clone(inputState));
  const createOp = state.outbox.find(op => op.type === 'payment_create' && op.entityId === paymentId);
  if (createOp) {
    // Not yet acknowledged by the server: cancelling the queued create is
    // the one safe "delete". Once a receipt exists, payments are append-only
    // and can only be voided below.
    state.outbox = state.outbox.filter(op => op.opId !== createOp.opId);
    state.updatedAt = nowISO();
    return state;
  }
  const baseRecord = findRecord(state.baseSnapshot, 'payments', paymentId);
  if (!baseRecord) throw new Error('That payment is no longer available.');
  if (baseRecord.status === 'void') return state;
  const existing = state.outbox.find(op => op.type === 'payment_void' && op.entityId === paymentId);
  if (existing) {
    existing.payload = {id: paymentId, reason};
    existing.updatedAt = nowISO();
    state.updatedAt = nowISO();
    return state;
  }
  newOperation(state, {
    type: 'payment_void',
    entity: 'payments',
    entityId: paymentId,
    baseVersion: baseRecord.syncVersion || 1,
    baseRecord: clone(baseRecord),
    proposedRecord: {...clone(baseRecord), status: 'void', voidReason: reason},
    payload: {id: paymentId, reason},
  });
  state.updatedAt = nowISO();
  return state;
}

export function operationReferences(op) {
  const values = new Set();
  const source = op?.proposedRecord || op?.payload || {};
  for (const field of REFERENCE_FIELDS) {
    if (isUuid(source[field]) && source[field] !== op.entityId) values.add(source[field]);
  }
  return [...values];
}

/**
 * Operations that can be sent now. An operation that references a record
 * created by another still-pending (or conflicted) operation waits for that
 * producer, so the server never sees a student before its offline branch.
 */
export function readyOperations(state, limit = 50) {
  const baseIds = new Set();
  for (const entity of SYNC_COLLECTIONS) {
    for (const record of state.baseSnapshot[entity] || []) baseIds.add(record.id);
  }
  const unresolvedProducers = new Set();
  for (const op of state.outbox) {
    if ((op.type === 'upsert' || op.type === 'payment_create') && !baseIds.has(op.entityId)) {
      unresolvedProducers.add(op.entityId);
    }
  }
  for (const conflict of state.conflicts) {
    if (!baseIds.has(conflict.op.entityId)) unresolvedProducers.add(conflict.op.entityId);
  }
  // Attendance also depends on the enrollment row for the same batch/student,
  // even though it does not reference that enrollment by ID. If the enrollment
  // was created offline, wait for it rather than letting the server reject
  // the mark as an orphan.
  const unresolvedEnrollments = new Set();
  const baseEnrollments = new Set(
    (state.baseSnapshot.enrollments || []).map(record => naturalKey('enrollments', record)).filter(Boolean),
  );
  for (const op of [...state.outbox, ...state.conflicts.map(conflict => conflict.op)]) {
    if (op.entity !== 'enrollments') continue;
    const key = naturalKey('enrollments', op.proposedRecord);
    if (key && !baseEnrollments.has(key)) unresolvedEnrollments.add(key);
  }
  return [...state.outbox]
    .sort((a, b) => (a.seq || 0) - (b.seq || 0))
    .filter(op => operationReferences(op).every(id => baseIds.has(id) || !unresolvedProducers.has(id)))
    .filter(op => op.entity !== 'attendance'
      || !unresolvedEnrollments.has(naturalKey('enrollments', op.proposedRecord)))
    .slice(0, limit);
}

export function serializeOperation(op) {
  return {
    opId: op.opId,
    type: op.type,
    entity: op.entity,
    entityId: op.entityId,
    baseVersion: op.baseVersion || 0,
    clientCreatedAt: op.createdAt,
    payload: clone(op.payload || businessRecord(op.proposedRecord) || {}),
  };
}

export function removeOperations(inputState, opIds) {
  const state = normalizeState(clone(inputState));
  const ids = new Set(opIds);
  state.outbox = state.outbox.filter(op => !ids.has(op.opId));
  state.updatedAt = nowISO();
  return state;
}

/**
 * Merge server-acknowledged operations into the base snapshot immediately.
 * The following snapshot pull is still authoritative, but if the connection
 * drops between push and pull the acknowledged work must not vanish from
 * the device until the next successful refresh.
 */
export function acknowledgeOperations(inputState, acknowledged = []) {
  const state = normalizeState(clone(inputState));
  let snapshot = normalizeSnapshot(state.baseSnapshot);
  const ids = new Set();
  for (const {op, result = {}} of acknowledged) {
    if (!op) continue;
    ids.add(op.opId);
    const serverId = result.serverEntityId || op.entityId;
    const serverVersion = Number.isInteger(result.serverVersion) && result.serverVersion > 0
      ? result.serverVersion
      : (op.baseVersion || 0) + 1;
    if (op.type === 'payment_void') {
      const index = snapshot.payments.findIndex(payment => payment.id === serverId);
      if (index >= 0 && (snapshot.payments[index].syncVersion || 1) <= serverVersion) {
        snapshot.payments[index] = {
          ...snapshot.payments[index],
          status: 'void',
          voidReason: op.payload?.reason || snapshot.payments[index].voidReason || '',
          receiptNo: result.receiptNo || snapshot.payments[index].receiptNo,
          syncVersion: serverVersion,
        };
        delete snapshot.payments[index].syncPending;
      }
      continue;
    }
    const record = {
      ...businessRecord(op.proposedRecord),
      id: serverId,
      syncVersion: serverVersion,
    };
    if (op.type === 'payment_create' && result.receiptNo) record.receiptNo = result.receiptNo;
    const index = findRecordIndex(snapshot, op.entity, record);
    if (index >= 0 && (snapshot[op.entity][index].syncVersion || 1) <= serverVersion) snapshot[op.entity][index] = {...snapshot[op.entity][index], ...record};
    else snapshot[op.entity].push(record);
  }
  state.baseSnapshot = snapshot;
  state.outbox = state.outbox.filter(op => !ids.has(op.opId));
  state.updatedAt = nowISO();
  return state;
}

export function addConflict(inputState, op, result = {}) {
  const state = normalizeState(clone(inputState));
  state.outbox = state.outbox.filter(item => item.opId !== op.opId);
  const serverRecord = findRecord(state.baseSnapshot, op.entity, op.proposedRecord || op.entityId);
  const conflict = {
    id: op.opId,
    kind: result.status === 'rejected' ? 'blocked' : 'version',
    code: result.code || (result.status === 'rejected' ? 'REJECTED' : 'VERSION_CONFLICT'),
    message: result.message || '',
    detectedAt: nowISO(),
    serverEntityId: result.serverEntityId || serverRecord?.id || null,
    serverVersion: result.serverVersion ?? serverRecord?.syncVersion ?? null,
    serverRecord: serverRecord ? clone(serverRecord) : null,
    op: clone(op),
  };
  state.conflicts = [
    ...state.conflicts.filter(item => item.id !== conflict.id
      && !sameOperationTarget(item.op, op.entity, op.proposedRecord || {id: op.entityId})),
    conflict,
  ];
  state.updatedAt = nowISO();
  return state;
}

function operationAlreadyReflected(op, snapshot) {
  if (op.type === 'payment_create') return snapshot.payments.some(payment => payment.id === op.entityId);
  const server = findRecord(snapshot, op.entity, op.proposedRecord || op.entityId);
  if (!server) return false;
  if (op.type === 'payment_void') return server.status === 'void';
  return recordsEqual(server, op.proposedRecord);
}

export function reconcileServerSnapshot(inputState, serverSnapshot, {context = undefined, pulledAt = nowISO()} = {}) {
  const state = normalizeState(clone(inputState));
  state.baseSnapshot = normalizeSnapshot(serverSnapshot);
  if (context !== undefined) state.context = context ? clone(context) : null;
  if (state.context?.organizationId) state.organizationId = state.context.organizationId;
  state.lastPulledAt = pulledAt;
  state.outbox = state.outbox.filter(op => !operationAlreadyReflected(op, state.baseSnapshot));
  state.conflicts = state.conflicts
    .map(conflict => {
      const server = findRecord(
        state.baseSnapshot,
        conflict.op.entity,
        conflict.op.proposedRecord || conflict.serverEntityId || conflict.op.entityId,
      );
      return {
        ...conflict,
        serverEntityId: server?.id || conflict.serverEntityId || null,
        serverVersion: server?.syncVersion ?? conflict.serverVersion ?? null,
        serverRecord: server ? clone(server) : null,
      };
    })
    .filter(conflict => !operationAlreadyReflected(conflict.op, state.baseSnapshot));
  state.updatedAt = nowISO();
  return state;
}

function changedFields(baseRecord, proposedRecord) {
  const proposed = comparable(proposedRecord);
  if (!baseRecord) return proposed;
  const base = comparable(baseRecord);
  const changes = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(proposed)])) {
    if (!deepEqual(base[key], proposed[key])) changes[key] = clone(proposed[key]);
  }
  return changes;
}

export function resolveConflict(inputState, conflictId, choice) {
  const state = normalizeState(clone(inputState));
  const conflict = state.conflicts.find(item => item.id === conflictId);
  if (!conflict) return state;
  state.conflicts = state.conflicts.filter(item => item.id !== conflictId);
  if (choice === 'server') {
    state.updatedAt = nowISO();
    return state;
  }
  if (choice !== 'mine') throw new Error('Choose which version to keep.');

  const {op} = conflict;
  if (op.type === 'payment_create') {
    const proposed = {...clone(op.proposedRecord), id: newUuid(), receiptNo: '', status: 'recorded'};
    newOperation(state, {
      type: 'payment_create', entity: 'payments', entityId: proposed.id, baseVersion: 0,
      baseRecord: null, proposedRecord: proposed, payload: businessRecord(proposed),
    });
    state.updatedAt = nowISO();
    return state;
  }

  const server = conflict.serverRecord
    || findRecord(state.baseSnapshot, op.entity, op.proposedRecord || op.entityId);
  if (op.type === 'payment_void') {
    if (!server || server.status === 'void') return state;
    newOperation(state, {
      type: 'payment_void', entity: 'payments', entityId: server.id,
      baseVersion: server.syncVersion || 1, baseRecord: clone(server),
      proposedRecord: {...clone(server), status: 'void', voidReason: op.payload?.reason || ''},
      payload: {id: server.id, reason: op.payload?.reason || ''},
    });
    state.updatedAt = nowISO();
    return state;
  }

  // Field-level rebase: start from the current server record and re-apply
  // only the fields this device actually changed. Concurrent edits to other
  // fields survive a "keep mine" resolution.
  const delta = changedFields(op.baseRecord, op.proposedRecord);
  const resolved = server
    ? {...businessRecord(server), ...delta, id: server.id}
    : {...clone(op.proposedRecord)};
  if (server && recordsEqual(server, resolved)) {
    state.updatedAt = nowISO();
    return state;
  }
  newOperation(state, {
    type: 'upsert',
    entity: op.entity,
    entityId: resolved.id,
    baseVersion: server ? (server.syncVersion || 1) : 0,
    baseRecord: server ? clone(server) : null,
    proposedRecord: resolved,
    payload: businessRecord(resolved),
  });
  state.updatedAt = nowISO();
  return state;
}

export function syncCounts(state) {
  return {
    pending: state?.outbox?.length || 0,
    conflicts: state?.conflicts?.length || 0,
  };
}

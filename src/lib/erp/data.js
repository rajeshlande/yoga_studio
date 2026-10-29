// Unified ERP data access. Every screen talks to this module only.
//
// - 'supabase' mode is offline-first. Business data still moves exclusively
//   through approved typed RPCs in supabase/erp_setup.sql. The signed-in
//   device keeps a per-user, per-organization cache of the last server
//   snapshot plus a durable outbox of local changes. Mutations are applied
//   to that cache immediately, then pushed in dependency order through
//   `erp_sync_push`, which enforces idempotency and expected record versions
//   on the server. Version conflicts are returned for manual review instead
//   of being overwritten.
// - 'local' mode remains the separate, explicitly labelled device-only store
//   (localStore.js). It does not sync to Supabase.

import {supabase} from '../auth.js';
import {localStore} from './localStore.js';
import {emptySnapshot, membershipEnd, toISODate} from './logic.js';
import {
  acknowledgeOperations,
  addConflict,
  clearSyncState,
  clone,
  createEmptySyncState,
  deriveSnapshot,
  enqueuePaymentCreate,
  enqueuePaymentVoid,
  enqueueUpsert,
  findRecord,
  getOrCreateDeviceId,
  loadLastSyncState,
  loadSyncState,
  mergeSyncStates,
  newUuid,
  normalizeSnapshot,
  readyOperations,
  reconcileServerSnapshot,
  resolveConflict,
  saveSyncState,
  serializeOperation,
  syncStorageKey,
} from './syncStore.js';

const nowISO = () => new Date().toISOString();
const browserOnline = () => typeof navigator === 'undefined' || navigator.onLine;

async function rpc(name, args = {}) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!browserOnline()) {
    const error = new Error('You are offline. Changes are saved on this device and will sync when the connection returns.');
    error.code = 'OFFLINE';
    throw error;
  }
  const {data, error} = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export function isMissingRpcError(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /PGRST202|40407|could not find the function|function .* does not exist/i.test(text);
}

function isOfflineError(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  return error?.code === 'OFFLINE' || /failed to fetch|networkerror|load failed|network request failed/i.test(text);
}

const emptySyncSummary = (mode, overrides = {}) => ({
  enabled: mode === 'supabase',
  mode,
  online: browserOnline(),
  syncing: false,
  setupNeeded: false,
  hasCache: false,
  pendingCount: 0,
  conflictCount: 0,
  conflicts: [],
  lastPulledAt: null,
  lastSyncedAt: null,
  error: '',
  ...overrides,
});

export function createErpClient(mode, options = {}) {
  if (mode === 'local') {
    const getSyncState = () => emptySyncSummary('local');
    return {
      ...localStore,
      mode,
      getSyncState,
      async syncNow() { return localStore.getSnapshot(); },
      async resolveConflict() { return localStore.getSnapshot(); },
      async clearSyncCache() { return localStore.getSnapshot(); },
      refreshFromStorage() { return null; },
    };
  }

  const storage = options.storage || globalThis.localStorage;
  let userId = options.userId || '';
  let state = null;
  let initPromise = null;
  let syncPromise = null;
  let syncTimer = null;
  let syncing = false;
  let setupNeeded = false;
  let lastError = '';
  let contextCheckedAt = 0;
  const lockOwner = newUuid();

  const derived = () => (state ? deriveSnapshot(state.baseSnapshot, state.outbox) : emptySnapshot());

  function summary() {
    return emptySyncSummary('supabase', {
      userId,
      organizationId: state?.organizationId || '',
      syncing,
      setupNeeded,
      hasCache: Boolean(state?.lastPulledAt),
      pendingCount: state?.outbox?.length || 0,
      conflictCount: state?.conflicts?.length || 0,
      conflicts: clone(state?.conflicts || []),
      lastPulledAt: state?.lastPulledAt || null,
      lastSyncedAt: state?.lastSyncedAt || null,
      error: lastError,
    });
  }

  function emit({snapshot = false} = {}) {
    try { options.onSyncState?.(summary()); } catch { /* UI callbacks must not break sync. */ }
    if (snapshot && state) {
      try { options.onSnapshot?.(derived()); } catch { /* See above. */ }
    }
  }

  function reloadFromStorage() {
    if (!state?.organizationId || !storage) return;
    const stored = loadSyncState(storage, state.userId, state.organizationId);
    if (stored && String(stored.updatedAt || '') > String(state.updatedAt || '')) {
      state = mergeSyncStates(state, stored);
    }
  }

  function persist({optional = false} = {}) {
    if (!state?.organizationId) return;
    if (!storage) {
      const message = 'Browser storage is unavailable, so offline changes cannot be saved safely on this device.';
      if (!optional) throw new Error(message);
      lastError = message;
      return;
    }
    try {
      reloadFromStorage();
      saveSyncState(storage, state);
      // saveSyncState stamps updatedAt on its own copy; re-read so this tab
      // and other tabs converge on the same revision marker.
      const saved = loadSyncState(storage, state.userId, state.organizationId);
      if (saved) state = mergeSyncStates(state, saved);
    } catch (error) {
      if (!optional) throw error;
      lastError = 'This device could not save the offline copy (storage may be full).';
    }
  }

  async function resolveUserId() {
    if (userId) return userId;
    if (options.userId) {
      userId = options.userId;
      return userId;
    }
    try {
      const {data} = await supabase.auth.getSession();
      userId = data?.session?.user?.id || '';
    } catch {
      userId = '';
    }
    return userId;
  }

  async function fetchRemoteContext() {
    const context = await rpc('erp_get_context');
    contextCheckedAt = Date.now();
    return context;
  }

  async function ensureState() {
    if (state) return state;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!supabase) throw new Error('Supabase is not configured.');
      await resolveUserId();
      if (!userId) {
        throw new Error('UNAUTHENTICATED: sign in once while online before using offline sync.');
      }
      const deviceId = getOrCreateDeviceId(storage);
      const cached = loadLastSyncState(storage, userId);
      let remoteContext = null;
      let remoteError = null;
      if (browserOnline()) {
        try { remoteContext = await fetchRemoteContext(); }
        catch (error) { remoteError = error; }
      }

      if (remoteContext?.organizationId) {
        state = loadSyncState(storage, userId, remoteContext.organizationId)
          || createEmptySyncState({userId, organizationId: remoteContext.organizationId, context: remoteContext, deviceId});
        state.userId = userId;
        state.deviceId = deviceId;
        state.context = remoteContext;
        state.organizationId = remoteContext.organizationId;
        persist({optional: true});
      } else if (remoteContext) {
        // The server authoritatively says this account has no organization.
        // Keep any older organization cache untouched in storage, but do not
        // display it as though access still exists.
        state = createEmptySyncState({userId, organizationId: '', context: remoteContext, deviceId});
      } else if (cached && cached.userId === userId && cached.organizationId) {
        state = cached;
        state.deviceId = deviceId;
        if (remoteError) lastError = 'Using the synced copy on this device.';
      } else if (remoteError) {
        throw remoteError;
      } else {
        state = createEmptySyncState({userId, organizationId: '', context: null, deviceId});
      }
      emit();
      return state;
    })().finally(() => { initPromise = null; });
    return initPromise;
  }

  async function getContext() {
    await ensureState();
    if (browserOnline() && Date.now() - contextCheckedAt > 60_000) {
      try {
        const remote = await fetchRemoteContext();
        if (remote && !remote.organizationId && state.organizationId) {
          // Access was removed online. Keep the old organization's cache in
          // storage untouched, but stop displaying or editing it now.
          state = createEmptySyncState({
            userId, organizationId: '', context: remote,
            deviceId: getOrCreateDeviceId(storage),
          });
          emit({snapshot: true});
          return remote;
        }
        if (remote?.organizationId && remote.organizationId !== state.organizationId) {
          state = loadSyncState(storage, userId, remote.organizationId)
            || createEmptySyncState({
              userId, organizationId: remote.organizationId, context: remote,
              deviceId: getOrCreateDeviceId(storage),
            });
        }
        if (state.organizationId) {
          state.context = remote;
          persist({optional: true});
        }
        emit();
        return remote;
      } catch {
        if (state.context) return state.context;
        throw new Error('Could not load your studio access. Check your connection and try again.');
      }
    }
    return state.context;
  }

  function lockKey() {
    return `${syncStorageKey(state.userId, state.organizationId)}:lock`;
  }

  function acquireLock() {
    if (!storage || !state?.organizationId) return true;
    try {
      const existing = JSON.parse(storage.getItem(lockKey()) || 'null');
      if (existing && existing.owner !== lockOwner && existing.expires > Date.now()) return false;
      storage.setItem(lockKey(), JSON.stringify({owner: lockOwner, expires: Date.now() + 20_000}));
      return true;
    } catch {
      return true;
    }
  }

  function releaseLock() {
    if (!storage || !state?.organizationId) return;
    try {
      const existing = JSON.parse(storage.getItem(lockKey()) || 'null');
      if (existing?.owner === lockOwner) storage.removeItem(lockKey());
    } catch { /* Lock expiry is the fallback. */ }
  }

  async function pull() {
    const snapshot = normalizeSnapshot(await rpc('erp_get_snapshot'));
    state = reconcileServerSnapshot(state, snapshot, {context: state.context || undefined});
    if (state.outbox.length === 0 && state.conflicts.length === 0) state.lastSyncedAt = nowISO();
    persist({optional: true});
    return derived();
  }

  async function syncNow() {
    await ensureState();
    if (browserOnline()) await getContext();
    if (!state.organizationId) {
      // Surface NO_ORGANIZATION / setup errors exactly as the old client did.
      return normalizeSnapshot(await rpc('erp_get_snapshot'));
    }
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      if (!browserOnline()) {
        lastError = 'Offline. Changes are saved on this device.';
        emit({snapshot: true});
        if (!state.lastPulledAt) {
          throw new Error('You are offline and this device has no synced copy yet. Connect once while signed in.');
        }
        return derived();
      }
      if (!acquireLock()) return derived();
      syncing = true;
      emit();
      let pullError = null;
      try {
        let madeProgress = true;
        while (madeProgress) {
          madeProgress = false;
          reloadFromStorage();
          const ready = readyOperations(state, 50);
          if (!ready.length) break;
          let response;
          try {
            response = await rpc('erp_sync_push', {
              p_payload: {
                deviceId: state.deviceId || getOrCreateDeviceId(storage),
                operations: ready.map(serializeOperation),
              },
            });
            setupNeeded = false;
          } catch (error) {
            if (isMissingRpcError(error)) {
              setupNeeded = true;
              lastError = 'Offline sync is waiting for the updated supabase/erp_setup.sql to be run.';
            } else if (isOfflineError(error)) {
              lastError = 'Connection lost. Changes remain safely queued on this device.';
            } else {
              lastError = error?.message || 'Sync could not be completed.';
            }
            break;
          }

          const results = Array.isArray(response?.results) ? response.results : [];
          const byOpId = new Map(results.map(result => [result.opId, result]));
          const applied = [];
          for (const op of ready) {
            const result = byOpId.get(op.opId);
            if (!result) continue;
            if (result.status === 'applied' || result.status === 'duplicate') {
              applied.push({op, result});
              madeProgress = true;
            } else if (result.status === 'conflict' || result.status === 'rejected') {
              state = addConflict(state, op, result);
              madeProgress = true;
            }
          }
          if (applied.length) state = acknowledgeOperations(state, applied);
          persist({optional: true});
          emit();
        }

        try {
          await pull();
          if (!setupNeeded && state.outbox.length === 0 && state.conflicts.length === 0) lastError = '';
        } catch (error) {
          pullError = error;
          if (isMissingRpcError(error)) setupNeeded = true;
          if (!state.lastPulledAt) throw error;
          lastError = isOfflineError(error)
            ? 'Connection lost. Showing the synced copy on this device.'
            : (error?.message || 'Could not refresh studio data.');
        }
      } finally {
        syncing = false;
        releaseLock();
        persist({optional: true});
        emit({snapshot: true});
      }
      if (pullError && !state.lastPulledAt) throw pullError;
      return derived();
    })().finally(() => { syncPromise = null; });
    return syncPromise;
  }

  function scheduleSync() {
    if (syncTimer || typeof setTimeout !== 'function') return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      syncNow().catch(() => { /* State and toolbar carry the error. */ });
    }, 30);
  }

  async function queue(mutator) {
    await ensureState();
    if (!state.organizationId) throw new Error('NO_ORGANIZATION: create or join an organization first');
    reloadFromStorage();
    const before = clone(state);
    const snapshot = derived();
    try {
      state = mutator(state, snapshot);
      persist();
    } catch (error) {
      state = before;
      if (error?.code === 'SYNC_CONFLICT_EXISTS') throw error;
      if (error instanceof Error && /required|no longer available|Resolve the sync conflict/i.test(error.message)) throw error;
      throw new Error('This device could not save the change. Check available storage and try again.');
    }
    emit();
    scheduleSync();
    return derived();
  }

  const existing = (snapshot, entity, candidate) => findRecord(snapshot, entity, candidate);

  function proposed(snapshot, entity, payload, fields) {
    const old = payload?.id ? existing(snapshot, entity, payload) : null;
    return {
      ...(old || {}),
      ...(payload || {}),
      ...fields,
      id: old?.id || payload?.id || newUuid(),
      createdAt: old?.createdAt || payload?.createdAt || nowISO(),
      syncVersion: old?.syncVersion || 0,
    };
  }

  return {
    mode,
    getSyncState: summary,
    syncNow,
    getContext,

    async getSnapshot() {
      await ensureState();
      if (!state.organizationId) return normalizeSnapshot(await rpc('erp_get_snapshot'));
      if (browserOnline()) return syncNow();
      if (state.lastPulledAt) {
        lastError = 'Offline. Showing the synced copy on this device.';
        emit({snapshot: true});
        return derived();
      }
      return syncNow();
    },

    async bootstrapOrganization(name) {
      if (!browserOnline()) throw new Error('Connect to the internet to create your organization.');
      await resolveUserId();
      await rpc('erp_bootstrap_organization', {p_name: name});
      state = null;
      contextCheckedAt = 0;
      await ensureState();
      return syncNow();
    },

    async resolveConflict(conflictId, choice) {
      await ensureState();
      reloadFromStorage();
      state = resolveConflict(state, conflictId, choice);
      persist({optional: true});
      emit({snapshot: true});
      return syncNow();
    },

    async clearSyncCache({force = false} = {}) {
      await ensureState();
      if (!force && (state.outbox.length || state.conflicts.length)) {
        throw new Error('Sync or resolve the changes on this device before removing its offline copy.');
      }
      const {organizationId, context, deviceId} = state;
      clearSyncState(storage, userId, organizationId);
      state = createEmptySyncState({userId, organizationId, context, deviceId});
      lastError = '';
      emit({snapshot: true});
      return derived();
    },

    refreshFromStorage() {
      if (!state) return null;
      reloadFromStorage();
      emit({snapshot: true});
      return derived();
    },

    saveBranch: payload => queue((state, snapshot) => {
      if (!payload?.name?.trim()) throw new Error('Branch name is required.');
      return enqueueUpsert(state, 'branches', proposed(snapshot, 'branches', payload, {
        name: payload.name.trim(),
        city: payload.city || '', address: payload.address || '', phone: payload.phone || '',
        status: payload.status || existing(snapshot, 'branches', payload)?.status || 'active',
      }));
    }),

    archiveBranch: id => queue((state, snapshot) => {
      const old = existing(snapshot, 'branches', id);
      if (!old) throw new Error('That branch is no longer available.');
      return enqueueUpsert(state, 'branches', {...old, status: old.status === 'archived' ? 'active' : 'archived'});
    }),

    saveStudent: payload => queue((state, snapshot) => {
      if (!payload?.fullName?.trim() || !payload?.branchId) throw new Error('Student name and branch are required.');
      return enqueueUpsert(state, 'students', proposed(snapshot, 'students', payload, {
        branchId: payload.branchId, fullName: payload.fullName.trim(),
        phone: payload.phone || '', email: payload.email || '', gender: payload.gender || '',
        dob: payload.dob || '', joiningDate: payload.joiningDate || toISODate(),
        status: payload.status || existing(snapshot, 'students', payload)?.status || 'active',
        notes: payload.notes || '',
      }));
    }),

    archiveStudent: id => queue((state, snapshot) => {
      const old = existing(snapshot, 'students', id);
      if (!old) throw new Error('That student is no longer available.');
      return enqueueUpsert(state, 'students', {...old, status: old.status === 'inactive' ? 'active' : 'inactive'});
    }),

    saveInstructor: payload => queue((state, snapshot) => {
      if (!payload?.fullName?.trim()) throw new Error('Instructor name is required.');
      return enqueueUpsert(state, 'instructors', proposed(snapshot, 'instructors', payload, {
        branchId: payload.branchId || '', fullName: payload.fullName.trim(),
        phone: payload.phone || '', email: payload.email || '',
        status: payload.status || existing(snapshot, 'instructors', payload)?.status || 'active',
      }));
    }),

    saveBatch: payload => queue((state, snapshot) => {
      if (!payload?.name?.trim() || !payload?.branchId || !payload?.days?.length) {
        throw new Error('Batch name, branch and at least one class day are required.');
      }
      return enqueueUpsert(state, 'batches', proposed(snapshot, 'batches', payload, {
        branchId: payload.branchId, name: payload.name.trim(), instructorId: payload.instructorId || '',
        days: [...new Set((payload.days || []).map(Number))].sort(),
        startTime: payload.startTime || '07:00', durationMins: Number(payload.durationMins) || 60,
        capacity: Number(payload.capacity) || 20,
        status: payload.status || existing(snapshot, 'batches', payload)?.status || 'active',
      }));
    }),

    archiveBatch: id => queue((state, snapshot) => {
      const old = existing(snapshot, 'batches', id);
      if (!old) throw new Error('That batch is no longer available.');
      return enqueueUpsert(state, 'batches', {...old, status: old.status === 'archived' ? 'active' : 'archived'});
    }),

    enrollStudent: payload => queue((state, snapshot) => {
      const old = existing(snapshot, 'enrollments', payload);
      return enqueueUpsert(state, 'enrollments', {
        ...(old || {}), id: old?.id || payload.id || newUuid(),
        batchId: payload.batchId, studentId: payload.studentId,
        joinedOn: old?.joinedOn || payload.joinedOn || toISODate(), status: 'active',
        syncVersion: old?.syncVersion || 0,
      });
    }),

    endEnrollment: id => queue((state, snapshot) => {
      const old = existing(snapshot, 'enrollments', id);
      if (!old) throw new Error('That enrollment is no longer available.');
      return enqueueUpsert(state, 'enrollments', {...old, status: 'ended'});
    }),

    markAttendance: payload => queue(state => {
      let next = state;
      for (const mark of payload?.marks || []) {
        if (!['present', 'absent', 'late'].includes(mark.status)) continue;
        const current = deriveSnapshot(next.baseSnapshot, next.outbox);
        const candidate = {batchId: payload.batchId, studentId: mark.studentId, classDate: payload.classDate};
        const old = existing(current, 'attendance', candidate);
        if (old?.status === mark.status) continue;
        next = enqueueUpsert(next, 'attendance', {
          ...(old || {}), ...candidate, id: old?.id || mark.id || newUuid(),
          status: mark.status, updatedAt: nowISO(), syncVersion: old?.syncVersion || 0,
        });
      }
      return next;
    }),

    savePlan: payload => queue((state, snapshot) => {
      if (!payload?.name?.trim()) throw new Error('Plan name is required.');
      return enqueueUpsert(state, 'plans', proposed(snapshot, 'plans', payload, {
        name: payload.name.trim(), amountPaise: Number(payload.amountPaise) || 0,
        durationMonths: Number(payload.durationMonths) || 1,
        status: payload.status || existing(snapshot, 'plans', payload)?.status || 'active',
      }));
    }),

    saveMembership: payload => queue((state, snapshot) => {
      const plan = existing(snapshot, 'plans', payload?.planId);
      const student = existing(snapshot, 'students', payload?.studentId);
      const durationMonths = Number(payload?.durationMonths) || plan?.durationMonths || 1;
      return enqueueUpsert(state, 'memberships', proposed(snapshot, 'memberships', payload, {
        studentId: payload.studentId, planId: payload.planId,
        branchId: payload.branchId || student?.branchId || '',
        startDate: payload.startDate,
        endDate: membershipEnd(payload.startDate, durationMonths, payload.billingCycle || 'joining'),
        billingCycle: payload.billingCycle || 'joining', durationMonths,
        amountPaise: Number(payload.amountPaise) || plan?.amountPaise || 0,
        status: payload.status || existing(snapshot, 'memberships', payload)?.status || 'active',
      }));
    }),

    cancelMembership: id => queue((state, snapshot) => {
      const old = existing(snapshot, 'memberships', id);
      if (!old) throw new Error('That membership is no longer available.');
      return enqueueUpsert(state, 'memberships', {...old, status: 'cancelled'});
    }),

    recordPayment: payload => queue((state, snapshot) => {
      const membership = existing(snapshot, 'memberships', payload?.membershipId);
      const amountPaise = Number(payload?.amountPaise) || 0;
      if (!membership || amountPaise <= 0) throw new Error('Choose a membership and enter an amount received.');
      return enqueuePaymentCreate(state, {
        id: payload.id || newUuid(), studentId: membership.studentId,
        membershipId: membership.id, branchId: membership.branchId || '',
        amountPaise, method: payload.method || 'cash', paidOn: payload.paidOn || toISODate(),
        note: payload.note || '', receiptNo: '', status: 'recorded', voidReason: '',
        createdAt: nowISO(), syncVersion: 0,
      });
    }),

    voidPayment: input => queue(state => enqueuePaymentVoid(
      state,
      typeof input === 'string' ? input : input?.id,
      typeof input === 'string' ? '' : (input?.reason || ''),
    )),
  };
}

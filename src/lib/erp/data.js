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
import {
  emptySnapshot, membershipEnd, membershipOfferingType, normalizeInstructorProfile,
  normalizePlanTemplate,
  normalizePlanType, normalizeSubscriptionLifecycle, toISODate,
  normalizeBillingSettings, validateBillingSettings,
} from './logic.js';
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
const validationError = message => {
  const error = new Error(message);
  error.code = 'VALIDATION_FAILED';
  return error;
};

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

function studentAccessError(error) {
  if (isMissingRpcError(error)) {
    return new Error('Student portal access needs the latest database setup. Run the full supabase/erp_setup.sql (SQL v13) in Supabase, then try again.');
  }
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  // SQL v13 deliberately returns ONE code for every out-of-organization
  // account state (unknown, unconfirmed, manager, other studio) so grant
  // attempts cannot enumerate accounts by email. The legacy codes are
  // still mapped here for a not-yet-upgraded database.
  if (/STUDENT_ACCOUNT_UNAVAILABLE|STUDENT_ACCOUNT_NOT_FOUND|STUDENT_ACCOUNT_UNCONFIRMED|STUDENT_ACCOUNT_IS_MANAGER|STUDENT_ACCOUNT_OTHER_ORG/.test(text)) {
    return new Error('That sign-in account can’t be linked yet. Ask the student to create a Yoga Studio account with this exact email and confirm it, using a separate student-only account that is not used for another studio or ERP role. They should not create an organization.');
  }
  if (/STUDENT_ACCOUNT_ALREADY_LINKED/.test(text)) {
    return new Error('That sign-in email is already linked to a different student in this studio. Remove that student’s portal access first, or use a different student account.');
  }
  if (/STUDENT_INACTIVE/.test(text)) {
    return new Error('This student is inactive. Reactivate the student record before granting portal access.');
  }
  if (/STUDENT_BRANCH_ARCHIVED/.test(text)) {
    return new Error('This student’s branch is archived. Restore the branch before granting portal access.');
  }
  if (/FORBIDDEN/.test(text)) {
    return new Error('Only the Owner, a Co-owner or an Admin of this student’s branch can change student portal access.');
  }
  if (/VALIDATION_FAILED/.test(text)) {
    return new Error('Enter the student’s valid sign-in email.');
  }
  if (isOfflineError(error)) {
    return new Error('Student portal access can be changed only while online. Reconnect and try again.');
  }
  return error instanceof Error ? error : new Error(error?.message || 'Student portal access could not be updated.');
}

function roleAccessError(error) {
  if (isMissingRpcError(error)) {
    return new Error('Role access management needs the latest database setup. Run the full supabase/erp_setup.sql (SQL v13) in Supabase, then try again.');
  }
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  // SQL v13 deliberately returns ONE code for every out-of-organization
  // account state (unknown, unconfirmed, other studio) so grant attempts
  // cannot enumerate accounts by email. The legacy codes are still mapped
  // here for a not-yet-upgraded database.
  if (/ACCESS_ACCOUNT_UNAVAILABLE|ACCESS_ACCOUNT_NOT_FOUND|ACCESS_ACCOUNT_UNCONFIRMED|ACCESS_ACCOUNT_OTHER_ORG/.test(text)) {
    return new Error('That sign-in account can’t be granted access yet. Ask the person to create a Yoga Studio account with this exact email and confirm it, using a separate account that is not used for another studio. They should not create an organization. Then grant access again.');
  }
  if (/ACCESS_ACCOUNT_ALREADY_OWNER/.test(text)) {
    return new Error('That account is already an organization Owner. Use a separate account for a different ERP role.');
  }
  if (/ACCESS_ACCOUNT_ROLE_CONFLICT/.test(text)) {
    return new Error('That account already has another active ERP role in this studio. Remove that role first, or use a separate account.');
  }
  if (/ACCESS_INSTRUCTOR_ALREADY_LINKED/.test(text)) {
    return new Error('That instructor is already linked to a different sign-in account. An Owner or Co-owner must replace the instructor’s global sign-in.');
  }
  if (/INSTRUCTOR_INACTIVE/.test(text)) {
    return new Error('This instructor record is inactive. Reactivate the instructor before granting sign-in access.');
  }
  if (/INSTRUCTOR_BRANCH_REQUIRED/.test(text)) {
    return new Error('Select at least one active branch where this instructor may sign in and view their batches.');
  }
  if (/ACCESS_BRANCH_REQUIRED/.test(text)) {
    return new Error('Select at least one active branch for this Admin.');
  }
  if (/ACCESS_BRANCH_ARCHIVED/.test(text)) {
    return new Error('A selected branch is archived. Restore it before granting access there.');
  }
  if (/PRIMARY_OWNER_PROTECTED/.test(text)) {
    return new Error('The primary Owner is protected and cannot be removed from Role Access.');
  }
  if (/FORBIDDEN/.test(text)) {
    return new Error('Your current role or branch assignment does not allow this access change.');
  }
  if (/VALIDATION_FAILED/.test(text)) {
    return new Error('Check the sign-in email, role and branch selection, then try again.');
  }
  if (/NO_ORGANIZATION/.test(text)) {
    return new Error('This account is not connected to a studio organization yet.');
  }
  if (isOfflineError(error)) {
    return new Error('Role access can be changed only while online. Reconnect and try again.');
  }
  return error instanceof Error ? error : new Error(error?.message || 'Role access could not be updated.');
}

function admissionError(error) {
  if (isMissingRpcError(error)) {
    return new Error('Public admissions need the latest database setup. Run the full supabase/erp_setup.sql (SQL v13) in Supabase, then try again.');
  }
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  if (/ADMISSION_LINK_INVALID/.test(text)) {
    return new Error('This admission link is not valid. Ask the studio for its current admission link.');
  }
  if (/ADMISSION_BRANCH_INVALID/.test(text)) {
    return new Error('This branch admission link is not valid or the branch is no longer active. Ask the studio for its current branch admission link.');
  }
  if (/ADMISSION_ACCOUNT_UNCONFIRMED/.test(text)) {
    return new Error('Confirm your account email first, then return to the admission form.');
  }
  if (/ADMISSION_ACCOUNT_UNAVAILABLE/.test(text)) {
    return new Error('This sign-in account is unavailable for admission. Contact the studio for help.');
  }
  if (/ADMISSION_ACCOUNT_ALREADY_LINKED/.test(text)) {
    return new Error('This account already has an ERP role. Use the account already linked by the studio, or ask the studio to review the existing access.');
  }
  if (/ADMISSION_ALREADY_CONFIRMED/.test(text)) {
    return new Error('This admission has already been confirmed. Press Retry or sign in again to open the Student portal.');
  }
  if (/ADMISSION_EMAIL_MISMATCH/.test(text)) {
    return new Error('The admission email must match the email used to sign in. Sign in with the same account that submitted the admission.');
  }
  if (/ADMISSION_DUPLICATE_PENDING/.test(text)) {
    return new Error('A pending admission already exists for this email. Ask the studio to review it.');
  }
  if (/ADMISSION_POSSIBLE_DUPLICATE/.test(text)) {
    return new Error('A student record already uses this email. Link that existing student through Portal access or resolve the duplicate before confirming this admission.');
  }
  if (/ADMISSION_NOT_PENDING/.test(text)) {
    return new Error('This admission has already been reviewed. Refresh the admission list.');
  }
  if (/STUDENT_BRANCH_ARCHIVED/.test(text)) {
    return new Error('The selected branch is archived. Restore it or choose an active branch.');
  }
  if (/FORBIDDEN/.test(text)) {
    return new Error('Your current role or branch assignment does not allow this admission action.');
  }
  if (/VALIDATION_FAILED/.test(text)) {
    return new Error('Check the required admission fields, including date of birth, phone number and 6-digit Pin Code.');
  }
  if (isOfflineError(error)) {
    return new Error('Admissions can be submitted or reviewed only while online. Reconnect and try again.');
  }
  return error instanceof Error ? error : new Error(error?.message || 'The admission could not be processed.');
}

const emptySyncSummary = (mode, overrides = {}) => ({
  enabled: mode === 'supabase',
  mode,
  online: browserOnline(),
  syncing: false,
  setupNeeded: false,
  storagePersistent: null,
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
      async grantStudentAccess() {
        throw new Error('Student sign-in access is available only in Supabase mode.');
      },
      async revokeStudentAccess() {
        throw new Error('Student sign-in access is available only in Supabase mode.');
      },
      async getMyAdmission() {
        throw new Error('Public admissions are available only in Supabase mode.');
      },
      async submitAdmission() {
        throw new Error('Public admissions are available only in Supabase mode.');
      },
      async getAdmissionLinkInfo() {
        throw new Error('Public admissions are available only in Supabase mode.');
      },
      async listAdmissions() {
        throw new Error('Public admissions are available only in Supabase mode.');
      },
      async reviewAdmission() {
        throw new Error('Public admissions are available only in Supabase mode.');
      },
      async listRoleAccess() {
        throw new Error('Role account access is available only in Supabase mode.');
      },
      async grantCoOwnerAccess() {
        throw new Error('Role account access is available only in Supabase mode.');
      },
      async revokeCoOwnerAccess() {
        throw new Error('Role account access is available only in Supabase mode.');
      },
      async grantAdminAccess() {
        throw new Error('Role account access is available only in Supabase mode.');
      },
      async revokeAdminAccess() {
        throw new Error('Role account access is available only in Supabase mode.');
      },
      async grantInstructorAccess() {
        throw new Error('Role account access is available only in Supabase mode.');
      },
      async revokeInstructorAccess() {
        throw new Error('Role account access is available only in Supabase mode.');
      },
      refreshFromStorage() { return null; },
    };
  }

  const storage = options.storage || globalThis.localStorage;
  let userId = options.userId || '';
  let state = null;
  let initPromise = null;
  let syncPromise = null;
  let syncTimer = null;
  let syncTimerDueAt = 0;
  let syncing = false;
  let setupNeeded = false;
  let storagePersistent = null;
  let syncRetryMs = 5_000;
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
      storagePersistent,
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

  async function refreshStoragePersistence({request = false} = {}) {
    try {
      const storageManager = globalThis.navigator?.storage;
      if (!storageManager) return;
      if (typeof storageManager.persisted === 'function') {
        storagePersistent = await storageManager.persisted();
      }
      if (request && storagePersistent !== true && typeof storageManager.persist === 'function') {
        // Persistent storage reduces (but does not eliminate) the chance a
        // browser evicts the offline outbox under storage pressure. The
        // browser may deny this until the PWA is installed/frequently used.
        storagePersistent = await storageManager.persist();
      }
      emit();
    } catch {
      // Persistence is a safety improvement, not a condition for saving.
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
      void refreshStoragePersistence({request: Boolean(state.organizationId)});
      return state;
    })().finally(() => { initPromise = null; });
    return initPromise;
  }

  async function getContext() {
    await ensureState();
    // An account with no organization may have just been granted Student (or
    // another branch) access by an admin. Recheck that state immediately on
    // Retry instead of making the student wait for the normal one-minute
    // context cache to expire.
    if (browserOnline() && (!state.organizationId || Date.now() - contextCheckedAt > 60_000)) {
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
    if (state.outbox.length === 0 && state.conflicts.length === 0) {
      state.lastSyncedAt = nowISO();
      syncRetryMs = 5_000;
    }
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
          let unsupported = false;
          for (const op of ready) {
            const result = byOpId.get(op.opId);
            if (!result) continue;
            if (result.status === 'applied' || result.status === 'duplicate') {
              applied.push({op, result});
              madeProgress = true;
            } else if (result.status === 'conflict' || result.status === 'rejected') {
              if (result.code === 'UNSUPPORTED_OPERATION') {
                // An older SQL install cannot apply a newer entity (for
                // example billingSettings). Keep the operation safely in the
                // outbox so it auto-syncs after the owner runs the upgraded
                // one-file SQL, instead of presenting a false data conflict.
                setupNeeded = true;
                unsupported = true;
                lastError = 'This change is saved on this device and is waiting for the latest supabase/erp_setup.sql upgrade.';
              } else {
                state = addConflict(state, op, result);
                madeProgress = true;
              }
            }
          }
          if (applied.length) state = acknowledgeOperations(state, applied);
          persist({optional: true});
          emit();
          if (unsupported) break;
        }

        try {
          await pull();
          if (!setupNeeded && state.outbox.length === 0 && state.conflicts.length === 0) lastError = '';
        } catch (error) {
          pullError = error;
          if (isMissingRpcError(error)) setupNeeded = true;
          if (browserOnline() && /NO_ORGANIZATION/i.test(error?.message || '')) {
            // The snapshot RPC is authoritative: access may have just been
            // revoked while this tab still holds a recent context cache.
            // Force one context recheck so the UI stops presenting the old
            // snapshot immediately instead of waiting for the cache to age.
            contextCheckedAt = 0;
            try { await getContext(); } catch { /* Preserve pullError. */ }
          }
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
        // Users should never have to remember to press Sync now. If a
        // transient network/server failure left sendable work behind, retry
        // with bounded exponential backoff while this tab/app remains open.
        if (browserOnline() && state?.organizationId && !setupNeeded
            && readyOperations(state, 1).length > 0) {
          scheduleSync(syncRetryMs);
          syncRetryMs = Math.min(60_000, syncRetryMs * 2);
        }
      }
      if (pullError && !state.lastPulledAt) throw pullError;
      return derived();
    })().finally(() => { syncPromise = null; });
    return syncPromise;
  }

  function scheduleSync(delayMs = 30) {
    if (typeof setTimeout !== 'function') return;
    const delay = Math.max(0, delayMs);
    const dueAt = Date.now() + delay;
    if (syncTimer) {
      // A long backoff timer must not delay a fresh user edit: bring the
      // next automatic attempt forward when new work is queued.
      if (dueAt >= syncTimerDueAt) return;
      clearTimeout(syncTimer);
    }
    syncTimerDueAt = dueAt;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      syncTimerDueAt = 0;
      syncNow().catch(() => {
        // syncNow can fail before its internal retry block when the network
        // drops during context/session bootstrap. Queue another bounded
        // retry here as long as sendable device work remains.
        if (browserOnline() && state?.organizationId && !setupNeeded
            && readyOperations(state, 1).length > 0) {
          scheduleSync(syncRetryMs);
          syncRetryMs = Math.min(60_000, syncRetryMs * 2);
        }
      });
    }, delay);
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
      if (error?.code === 'SYNC_CONFLICT_EXISTS' || error?.code === 'VALIDATION_FAILED') throw error;
      if (error instanceof Error && /required|no longer available|Resolve the sync conflict/i.test(error.message)) throw error;
      throw new Error('This device could not save the change. Check available storage and try again.');
    }
    emit();
    void refreshStoragePersistence({request: true});
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

  function applyStudentAccessLocally(studentId, status, email) {
    if (!state?.organizationId || !studentId || !status) return;
    reloadFromStorage();
    const patch = record => {
      if (!record || record.id !== studentId) return;
      record.portalAccessStatus = status;
      if (email) record.portalAccessEmail = email;
    };
    patch(state.baseSnapshot?.students?.find(student => student.id === studentId));
    for (const op of state.outbox || []) {
      if (op.entity === 'students' && op.entityId === studentId) patch(op.proposedRecord);
    }
    for (const conflict of state.conflicts || []) {
      if (conflict.op?.entity === 'students' && conflict.op?.entityId === studentId) {
        patch(conflict.op.proposedRecord);
      }
    }
    persist({optional: true});
    emit({snapshot: true});
  }

  async function requireSyncedRecords(entity, ids, label) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (!entity || !uniqueIds.length) throw new Error(`VALIDATION_FAILED: ${label || entity || 'record'}`);
    if (!browserOnline()) {
      const error = new Error('Offline');
      error.code = 'OFFLINE';
      throw error;
    }
    await ensureState();
    if (!state.organizationId) throw new Error('NO_ORGANIZATION: create or join an organization first');
    await syncNow();
    reloadFromStorage();
    const display = label || entity.replace(/s$/, '');
    for (const id of uniqueIds) {
      const waiting = (state.outbox || []).some(
        op => op.entity === entity && op.entityId === id,
      );
      const conflicted = (state.conflicts || []).some(
        conflict => conflict.op?.entity === entity && conflict.op?.entityId === id,
      );
      const onServer = (state.baseSnapshot?.[entity] || []).some(record => record.id === id);
      if (waiting || conflicted || !onServer) {
        throw new Error(`Sync this ${display} record before changing access. Resolve any sync conflict for the ${display}, then try again.`);
      }
    }
  }

  const requireSyncedStudent = studentId => requireSyncedRecords('students', [studentId], 'student');

  async function refreshAfterStudentAccess(studentId, status, email) {
    // The RPC has already committed. Reflect its result immediately, then
    // pull the authoritative snapshot; a refresh hiccup must not make the
    // completed access change look like a failure.
    applyStudentAccessLocally(studentId, status, email);
    try {
      return await syncNow();
    } catch {
      scheduleSync();
      return derived();
    }
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
      const suppliedFullName = String(payload?.fullName || '').trim();
      const firstName = String(payload?.firstName || '').trim()
        || (suppliedFullName ? suppliedFullName.split(/\s+/)[0] : '');
      const lastName = String(payload?.lastName || '').trim()
        || (payload?.firstName ? '' : suppliedFullName.split(/\s+/).slice(1).join(' '));
      const fullName = [firstName, lastName].filter(Boolean).join(' ') || suppliedFullName;
      if (!fullName || !payload?.branchId) throw new Error('Student name and branch are required.');
      return enqueueUpsert(state, 'students', proposed(snapshot, 'students', payload, {
        branchId: payload.branchId, firstName, lastName, fullName,
        phone: payload.phone || '', email: payload.email || '', gender: payload.gender || '',
        dob: payload.dob || '', joiningDate: payload.joiningDate || toISODate(),
        status: payload.status || existing(snapshot, 'students', payload)?.status || 'active',
        notes: payload.notes || '', address: payload.address || '',
        pinCode: payload.pinCode || '', admissionSubject: payload.admissionSubject || '',
        referredBy: payload.referredBy || '', yogaExperience: payload.yogaExperience || '',
        medicalPhysicalIssue: payload.medicalPhysicalIssue || '',
        reasonToJoin: payload.reasonToJoin || '',
        // Transient authorization context for a brand-new Instructor walk-in
        // student. SQL reads it to prove the create is tied to that
        // instructor's own active batch; it is not a student table column.
        ...(payload.walkInBatchId ? {walkInBatchId: payload.walkInBatchId} : {}),
      }));
    }),

    archiveStudent: id => queue((state, snapshot) => {
      const old = existing(snapshot, 'students', id);
      if (!old) throw new Error('That student is no longer available.');
      return enqueueUpsert(state, 'students', {...old, status: old.status === 'inactive' ? 'active' : 'inactive'});
    }),

    async grantStudentAccess({studentId, email} = {}) {
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!studentId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
        throw studentAccessError(new Error('VALIDATION_FAILED: student sign-in email'));
      }
      try {
        await requireSyncedStudent(studentId);
        const result = await rpc('erp_grant_student_access', {
          p_student_id: studentId,
          p_email: cleanEmail,
        });
        return refreshAfterStudentAccess(
          studentId,
          result?.portalAccessStatus || 'active',
          result?.email || cleanEmail,
        );
      } catch (error) {
        throw studentAccessError(error);
      }
    },

    async revokeStudentAccess(input) {
      const studentId = typeof input === 'string' ? input : input?.studentId;
      if (!studentId) throw studentAccessError(new Error('VALIDATION_FAILED: student'));
      try {
        await requireSyncedStudent(studentId);
        const result = await rpc('erp_revoke_student_access', {p_student_id: studentId});
        const status = result?.portalAccessStatus || 'suspended';
        return refreshAfterStudentAccess(
          studentId,
          status === 'none' ? '' : status,
          result?.email || '',
        );
      } catch (error) {
        throw studentAccessError(error);
      }
    },

    async getMyAdmission(code, branchId = '') {
      const cleanCode = String(code || '').trim().toLowerCase();
      if (!cleanCode) throw admissionError(new Error('ADMISSION_LINK_INVALID'));
      try {
        if (!browserOnline()) {
          const error = new Error('Offline');
          error.code = 'OFFLINE';
          throw error;
        }
        const result = await rpc('erp_get_my_admission', {
          p_code: cleanCode,
          p_branch_id: String(branchId || '').trim() || null,
        });
        return {
          target: result?.target || {},
          applicantEmail: result?.applicantEmail || '',
          admission: result?.admission || null,
        };
      } catch (error) {
        throw admissionError(error);
      }
    },

    async submitAdmission({code, ...values} = {}) {
      const cleanCode = String(code || '').trim().toLowerCase();
      if (!cleanCode) throw admissionError(new Error('ADMISSION_LINK_INVALID'));
      const payload = {
        firstName: String(values.firstName || '').trim(),
        lastName: String(values.lastName || '').trim(),
        dob: String(values.dob || '').trim(),
        phone: String(values.phone || '').trim(),
        subject: String(values.subject || '').trim(),
        email: String(values.email || '').trim().toLowerCase(),
        address: String(values.address || '').trim(),
        pinCode: String(values.pinCode || '').trim(),
        referredBy: String(values.referredBy || '').trim(),
        yogaExperience: String(values.yogaExperience || '').trim(),
        medicalPhysicalIssue: String(values.medicalPhysicalIssue || '').trim(),
        reasonToJoin: String(values.reasonToJoin || '').trim(),
        termsAccepted: values.termsAccepted === true,
        termsVersion: String(values.termsVersion || '').trim(),
        ...(values.applicantUserId ? {applicantUserId: String(values.applicantUserId).trim()} : {}),
      };
      try {
        if (!browserOnline()) {
          const error = new Error('Offline');
          error.code = 'OFFLINE';
          throw error;
        }
        return await rpc('erp_submit_admission', {
          p_code: cleanCode,
          p_payload: payload,
          p_branch_id: String(values.branchId || '').trim() || null,
        });
      } catch (error) {
        throw admissionError(error);
      }
    },

    async getAdmissionLinkInfo() {
      try {
        if (!browserOnline()) {
          const error = new Error('Offline');
          error.code = 'OFFLINE';
          throw error;
        }
        return await rpc('erp_get_admission_link_info');
      } catch (error) {
        throw admissionError(error);
      }
    },

    async listAdmissions(status = 'pending') {
      try {
        if (!browserOnline()) {
          const error = new Error('Offline');
          error.code = 'OFFLINE';
          throw error;
        }
        const result = await rpc('erp_list_admissions', {p_status: status});
        return Array.isArray(result?.admissions) ? result.admissions : [];
      } catch (error) {
        throw admissionError(error);
      }
    },

    async reviewAdmission({admissionId, action, branchId = '', joiningDate = '', reviewNote = ''} = {}) {
      if (!admissionId || !['confirm', 'reject'].includes(action)) {
        throw admissionError(new Error('VALIDATION_FAILED: admission review'));
      }
      try {
        if (!browserOnline()) {
          const error = new Error('Offline');
          error.code = 'OFFLINE';
          throw error;
        }
        return await rpc('erp_review_admission', {
          p_admission_id: admissionId,
          p_action: action,
          p_branch_id: branchId || null,
          p_joining_date: joiningDate || toISODate(),
          p_review_note: String(reviewNote || '').trim(),
        });
      } catch (error) {
        throw admissionError(error);
      }
    },

    async listRoleAccess() {
      try {
        if (!browserOnline()) {
          const error = new Error('Offline');
          error.code = 'OFFLINE';
          throw error;
        }
        const result = await rpc('erp_list_role_access');
        return {
          organizationId: result?.organizationId || state?.organizationId || '',
          actor: result?.actor || {},
          orgMembers: Array.isArray(result?.orgMembers) ? result.orgMembers : [],
          adminAssignments: Array.isArray(result?.adminAssignments) ? result.adminAssignments : [],
          instructors: Array.isArray(result?.instructors) ? result.instructors : [],
        };
      } catch (error) {
        throw roleAccessError(error);
      }
    },

    async grantCoOwnerAccess({email} = {}) {
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
        throw roleAccessError(new Error('VALIDATION_FAILED: sign-in email'));
      }
      try {
        return await rpc('erp_grant_co_owner_access', {p_email: cleanEmail});
      } catch (error) {
        throw roleAccessError(error);
      }
    },

    async revokeCoOwnerAccess(input) {
      const userId = typeof input === 'string' ? input : input?.userId;
      if (!userId) throw roleAccessError(new Error('VALIDATION_FAILED: user'));
      try {
        return await rpc('erp_revoke_co_owner_access', {p_user_id: userId});
      } catch (error) {
        throw roleAccessError(error);
      }
    },

    async grantAdminAccess({email, branchIds} = {}) {
      const cleanEmail = String(email || '').trim().toLowerCase();
      const uniqueBranchIds = [...new Set((branchIds || []).filter(Boolean))];
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail) || !uniqueBranchIds.length) {
        throw roleAccessError(new Error(uniqueBranchIds.length
          ? 'VALIDATION_FAILED: sign-in email'
          : 'ACCESS_BRANCH_REQUIRED'));
      }
      try {
        await requireSyncedRecords('branches', uniqueBranchIds, 'branch');
        return await rpc('erp_grant_admin_access', {
          p_email: cleanEmail,
          p_branch_ids: uniqueBranchIds,
        });
      } catch (error) {
        throw roleAccessError(error);
      }
    },

    async revokeAdminAccess(input) {
      const userId = typeof input === 'string' ? input : input?.userId;
      if (!userId) throw roleAccessError(new Error('VALIDATION_FAILED: user'));
      try {
        return await rpc('erp_revoke_admin_access', {p_user_id: userId});
      } catch (error) {
        throw roleAccessError(error);
      }
    },

    async grantInstructorAccess({instructorId, email, branchIds} = {}) {
      const cleanEmail = String(email || '').trim().toLowerCase();
      const uniqueBranchIds = [...new Set((branchIds || []).filter(Boolean))];
      if (!instructorId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail) || !uniqueBranchIds.length) {
        throw roleAccessError(new Error(uniqueBranchIds.length
          ? 'VALIDATION_FAILED: instructor sign-in'
          : 'INSTRUCTOR_BRANCH_REQUIRED'));
      }
      try {
        await requireSyncedRecords('instructors', [instructorId], 'instructor');
        await requireSyncedRecords('branches', uniqueBranchIds, 'branch');
        return await rpc('erp_grant_instructor_access', {
          p_instructor_id: instructorId,
          p_email: cleanEmail,
          p_branch_ids: uniqueBranchIds,
        });
      } catch (error) {
        throw roleAccessError(error);
      }
    },

    async revokeInstructorAccess(input) {
      const instructorId = typeof input === 'string' ? input : input?.instructorId;
      if (!instructorId) throw roleAccessError(new Error('VALIDATION_FAILED: instructor'));
      try {
        await requireSyncedRecords('instructors', [instructorId], 'instructor');
        return await rpc('erp_revoke_instructor_access', {p_instructor_id: instructorId});
      } catch (error) {
        throw roleAccessError(error);
      }
    },

    saveInstructor: payload => queue((state, snapshot) => {
      if (!payload?.fullName?.trim()) throw new Error('Instructor name is required.');
      const profile = normalizeInstructorProfile({
        ...(existing(snapshot, 'instructors', payload) || {}),
        ...(payload || {}),
      });
      return enqueueUpsert(state, 'instructors', proposed(snapshot, 'instructors', payload, {
        branchId: payload.branchId || '', fullName: payload.fullName.trim(),
        phone: payload.phone || '', email: payload.email || '',
        ...profile,
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
      const oldPlan = existing(snapshot, 'plans', payload);
      const template = normalizePlanTemplate({...oldPlan, ...payload});
      const status = payload.status || oldPlan?.status || 'active';
      if (!['active', 'archived'].includes(status)) {
        throw validationError('Choose an active or archived plan status.');
      }
      return enqueueUpsert(state, 'plans', proposed(snapshot, 'plans', payload, {
        name: payload.name.trim(), amountPaise: Number(payload.amountPaise) || 0,
        ...template, status,
      }));
    }),

    saveMembership: payload => queue((state, snapshot) => {
      const plan = existing(snapshot, 'plans', payload?.planId);
      const student = existing(snapshot, 'students', payload?.studentId);
      const old = payload?.id ? existing(snapshot, 'memberships', payload) : null;
      const planTemplate = normalizePlanTemplate(plan || {});
      const offeringType = old
        ? normalizePlanType(old.offeringType || 'subscription')
        : membershipOfferingType(payload || {}, plan);
      const oneMonth = offeringType === 'one_month';
      const kindLabel = oneMonth ? 'one-month pass' : 'subscription';
      if (!old && plan && offeringType !== planTemplate.planType) {
        throw validationError('Choose a plan type that matches this offering.');
      }
      const durationMonths = oneMonth
        ? 1
        : Number(payload?.durationMonths) || plan?.durationMonths || 1;
      let lifecycleInput = {...(old || {}), ...(payload || {}), status: payload?.status || old?.status || 'active', offeringType};
      if (!['active', 'paused', 'cancelled'].includes(lifecycleInput.status)) {
        throw validationError(oneMonth
          ? 'Choose an active or cancelled one-month pass status.'
          : 'Choose an active, paused or cancelled subscription status.');
      }
      if (oneMonth && lifecycleInput.status === 'paused') {
        throw validationError('A one-month pass cannot be paused or renewed.');
      }
      if (oneMonth && lifecycleInput.previousMembershipId) {
        throw validationError('A one-month pass cannot be linked as a subscription renewal.');
      }
      if (oneMonth) {
        lifecycleInput = {
          ...lifecycleInput, autoRenew: false, previousMembershipId: '',
          renewalNumber: 0, totalPausedDays: 0,
        };
      }
      if (old?.status === 'cancelled' && lifecycleInput.status !== 'cancelled') {
        throw validationError(`A cancelled ${kindLabel} cannot be reopened. Create a new ${kindLabel} instead.`);
      }
      if (lifecycleInput.status === 'paused') {
        if (!lifecycleInput.pausedFrom) throw validationError('Choose the date this subscription pauses from.');
        if (lifecycleInput.pausedFrom < payload.startDate) {
          throw validationError('The pause start cannot be before the subscription start date.');
        }
        if (lifecycleInput.pausedUntil && lifecycleInput.pausedUntil < lifecycleInput.pausedFrom) {
          throw validationError('The expected resume date cannot be before the pause start date.');
        }
      }
      const lifecycle = normalizeSubscriptionLifecycle(lifecycleInput, nowISO(), offeringType);
      if (lifecycle.status === 'paused' && payload.id && (snapshot.memberships || []).some(item => (
        item.previousMembershipId === payload.id && item.status !== 'cancelled' && item.id !== payload.id
      ))) {
        throw validationError('Cancel the scheduled renewal before pausing this subscription, so its end date does not move into the next period.');
      }
      if (lifecycle.previousMembershipId) {
        const source = existing(snapshot, 'memberships', lifecycle.previousMembershipId);
        if (!source || source.studentId !== payload.studentId) {
          throw validationError('A renewal must follow an existing subscription for the same student.');
        }
        const isNewLink = !old || old.previousMembershipId !== lifecycle.previousMembershipId;
        if (normalizePlanType(source.offeringType || 'subscription') === 'one_month') {
          throw validationError('A one-month pass cannot be renewed. Create a new pass or subscription instead.');
        }
        if (isNewLink && planTemplate.planType === 'one_month') {
          throw validationError('Choose a subscription plan for a renewal.');
        }
        if (isNewLink && source.status === 'paused') {
          throw validationError('Resume the previous subscription before renewing it, so the renewal start date is final.');
        }
        if (isNewLink && source.status === 'cancelled') {
          throw validationError('A cancelled subscription cannot be renewed. Create a new subscription instead.');
        }
        const duplicate = lifecycle.status !== 'cancelled' && (snapshot.memberships || []).some(item => (
          item.previousMembershipId === lifecycle.previousMembershipId
          && item.status !== 'cancelled' && item.id !== payload.id
        ));
        if (duplicate) throw validationError('This subscription has already been renewed.');
      }
      return enqueueUpsert(state, 'memberships', proposed(snapshot, 'memberships', payload, {
        studentId: payload.studentId, planId: payload.planId,
        branchId: payload.branchId || student?.branchId || '',
        startDate: payload.startDate,
        endDate: membershipEnd(
          payload.startDate, durationMonths,
          payload.billingCycle || old?.billingCycle || planTemplate.billingCycle,
          lifecycle.totalPausedDays,
        ),
        billingCycle: payload.billingCycle || old?.billingCycle || planTemplate.billingCycle,
        durationMonths,
        amountPaise: Number(payload.amountPaise) || plan?.amountPaise || 0,
        ...lifecycle,
      }));
    }),

    cancelMembership: (input, suppliedReason = '') => queue((state, snapshot) => {
      const id = typeof input === 'string' ? input : input?.id;
      const reason = typeof input === 'string' ? suppliedReason : (input?.reason || suppliedReason || '');
      const old = existing(snapshot, 'memberships', id);
      if (!old) throw new Error('That membership is no longer available.');
      if (old.status === 'cancelled') return state;
      const lifecycle = normalizeSubscriptionLifecycle({
        ...old, status: 'cancelled', cancelReason: reason, cancelledAt: nowISO(),
      }, nowISO(), normalizePlanType(old.offeringType || 'subscription'));
      return enqueueUpsert(state, 'memberships', {...old, ...lifecycle});
    }),

    recordPayment: payload => queue((state, snapshot) => {
      const membership = existing(snapshot, 'memberships', payload?.membershipId);
      const amountPaise = Number(payload?.amountPaise) || 0;
      if (!membership || amountPaise <= 0) throw new Error('Choose a subscription or one-month pass and enter an amount received.');
      if (membership.status === 'cancelled') {
        throw validationError(membership.offeringType === 'one_month'
          ? 'Payments cannot be recorded against a cancelled one-month pass.'
          : 'Payments cannot be recorded against a cancelled subscription.');
      }
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

    saveBillingSettings: payload => queue((state, snapshot) => {
      const settings = normalizeBillingSettings(payload);
      const errors = validateBillingSettings(settings);
      if (errors.length) {
        const error = new Error(errors.join(' '));
        error.code = 'VALIDATION_FAILED';
        throw error;
      }
      const old = existing(snapshot, 'billingSettings', payload) || snapshot.billingSettings?.[0] || null;
      return enqueueUpsert(state, 'billingSettings', {
        ...(old || {}),
        ...settings,
        // One billing profile per organization. Using the organization ID as
        // the singleton record ID prevents two admins who both started from
        // an empty profile from creating competing settings rows.
        id: old?.id || payload?.id || state.organizationId,
        createdAt: old?.createdAt || nowISO(),
        syncVersion: old?.syncVersion || 0,
      });
    }),
  };
}

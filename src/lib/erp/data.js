// Unified ERP data access. Every screen talks to this module only.
//
// - 'supabase' mode: business data moves exclusively through the approved
//   typed RPCs defined in supabase/erp_setup.sql (erp_get_snapshot and the
//   erp_* mutation functions). No table CRUD, per the function-only policy
//   in CLAUDE.md / docs/11-management-plan.
// - 'local' mode: the offline device store (localStore.js) implements the
//   same functions against browser storage, so the ERP works offline and
//   before Supabase is connected. One snapshot load per session; mutations
//   return the refreshed snapshot, keeping a one-call-per-action budget.

import {supabase} from '../auth.js';
import {localStore} from './localStore.js';
import {emptySnapshot} from './logic.js';

async function rpc(name, args = {}) {
  if (!supabase) throw new Error('Supabase is not configured.');
  if (!navigator.onLine) throw new Error('You are offline. Changes cannot be saved to Supabase right now.');
  const {data, error} = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export function isMissingRpcError(error) {
  const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /PGRST202|40407|could not find the function|function .* does not exist/i.test(text);
}

export function createErpClient(mode) {
  if (mode === 'local') return {...localStore, mode};

  // Supabase mode: mutations call one RPC each; the snapshot is re-read once
  // so the UI never assembles state from per-table requests.
  const refreshed = async () => normalizeSnapshot(await rpc('erp_get_snapshot'));
  const mutate = name => async payload => {
    await rpc(name, {p_payload: payload ?? {}});
    return refreshed();
  };
  return {
    mode,
    getSnapshot: refreshed,
    async getContext() { return rpc('erp_get_context'); },
    async bootstrapOrganization(name) {
      await rpc('erp_bootstrap_organization', {p_name: name});
      return refreshed();
    },
    saveBranch: mutate('erp_save_branch'),
    archiveBranch: async id => { await rpc('erp_archive_branch', {p_id: id}); return refreshed(); },
    saveStudent: mutate('erp_save_student'),
    archiveStudent: async id => { await rpc('erp_archive_student', {p_id: id}); return refreshed(); },
    saveInstructor: mutate('erp_save_instructor'),
    saveBatch: mutate('erp_save_batch'),
    archiveBatch: async id => { await rpc('erp_archive_batch', {p_id: id}); return refreshed(); },
    enrollStudent: mutate('erp_enroll_student'),
    endEnrollment: async id => { await rpc('erp_end_enrollment', {p_id: id}); return refreshed(); },
    markAttendance: mutate('erp_mark_attendance'),
    savePlan: mutate('erp_save_plan'),
    saveMembership: mutate('erp_save_membership'),
    cancelMembership: async id => { await rpc('erp_cancel_membership', {p_id: id}); return refreshed(); },
    recordPayment: mutate('erp_record_payment'),
  };
}

function normalizeSnapshot(data) {
  const base = emptySnapshot();
  if (!data || typeof data !== 'object') return base;
  for (const key of Object.keys(base)) {
    if (Array.isArray(data[key])) base[key] = data[key];
  }
  return base;
}

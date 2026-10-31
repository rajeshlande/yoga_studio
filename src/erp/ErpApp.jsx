import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {
  AlertCircle, ArrowLeft, ArrowRight, BadgeCheck, Building2, CalendarCheck, CalendarClock, CalendarDays, Check, CirclePause,
  CirclePlay, Clock, Copy, Download, ExternalLink, IndianRupee, KeyRound, LayoutGrid,
  Leaf, List, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Printer, QrCode,
  RefreshCw, Repeat, Search, Share2, Sparkles, UserPlus, Users, Wallet, WifiOff, X,
} from 'lucide-react';
import {createErpClient, isMissingRpcError} from '../lib/erp/data.js';
import {ErrorNotice} from '../components/ErrorNotice.jsx';
import QRCode from 'qrcode';
import {
  ATTENDANCE_STATUSES, DAY_LABELS, PAYMENT_METHODS, PLAN_TYPES, ROLES,
  admissionWaitingDays, attendanceSummary,
  batchEndMinutes, batchFill, batchOverlapDays, batchTimeLabel, emptySnapshot,
  findInstructorScheduleConflicts, formatDate, formatINR, initials,
  instructorFinanceStudentIds, isBatchOnDate,
  isOneMonthMembership, membershipEnd, membershipOfferingType, monthlyRecurringRevenuePaise,
  nextBatchDate, nextRenewalDate, normalizeInstructorProfile, normalizePlanTemplate,
  normalizePlanType, paiseToRupees, pauseDaysBetween, planBillingPeriodLabel, payableBalance,
  renewalStartDate, rupeesToPaise, subscriptionLifecycle, toCSV, toISODate, addDaysISO,
  INDIA_STATE_CODES, billingReadiness, buildUpiUri, calculateInvoiceTax,
  formatInvoiceINR, normalizeBillingSettings,
} from '../lib/erp/logic.js';
import './erp.css';

/* ---------------- data hook: one snapshot load, one call per action ---------------- */

const defaultSyncState = mode => ({
  enabled: mode === 'supabase', mode, online: typeof navigator === 'undefined' || navigator.onLine,
  syncing: false, setupNeeded: false, storagePersistent: null, hasCache: false,
  pendingCount: 0, conflictCount: 0,
  conflicts: [], lastPulledAt: null, lastSyncedAt: null, error: '',
});

export function useErpData(mode, notify, enabled, onRemoteContext, userId = '') {
  const [data, setData] = useState(emptySnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [remoteContext, setRemoteContext] = useState(null);
  const [syncState, setSyncState] = useState(() => defaultSyncState(mode));
  const client = useMemo(
    () => createErpClient(mode, {userId, onSyncState: setSyncState, onSnapshot: setData}),
    [mode, userId],
  );
  const contextSent = useRef(false);
  const lastFocusSync = useRef(0);
  const previousConflictCount = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true); setError(null);
    let remoteNoOrganization = false;
    try {
      if (mode === 'supabase' && client.getContext) {
        try {
          const ctx = await client.getContext();
          setRemoteContext(ctx);
          remoteNoOrganization = Boolean(ctx && !ctx.organizationId);
          // If Supabase authoritatively says access was removed, stop
          // displaying the previously downloaded snapshot behind the banner.
          // The per-account device copy remains untouched in storage in case
          // access is restored, but this screen no longer presents it.
          if (remoteNoOrganization) setData(emptySnapshot());
          // Notify on every load, not only the first: a student may be
          // waiting on the no-organization screen while an admin grants
          // access, and Retry must immediately adopt the student role/link.
          if (ctx) { contextSent.current = true; onRemoteContext?.(ctx); }
        } catch { setRemoteContext(null); }
      }
      setData(await client.getSnapshot());
      if (client.getSyncState) setSyncState(client.getSyncState());
    } catch (err) {
      if (remoteNoOrganization) setData(emptySnapshot());
      setError(err);
    }
    finally { setLoading(false); }
  }, [client, enabled, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { contextSent.current = false; load(); }, [load]);

  const syncNow = useCallback(async () => {
    if (!enabled || mode !== 'supabase' || !client.syncNow) return false;
    try {
      const next = await client.syncNow();
      if (next) setData(next);
      if (client.getContext) {
        try {
          const ctx = await client.getContext();
          if (ctx) { setRemoteContext(ctx); onRemoteContext?.(ctx); }
        } catch { /* The last known context remains displayed. */ }
      }
      if (client.getSyncState) setSyncState(client.getSyncState());
      const current = client.getSyncState?.();
      if (current?.conflictCount) notify(`${current.conflictCount} sync conflict(s) need review.`);
      else if (current?.pendingCount) notify(`${current.pendingCount} change(s) are still waiting to sync.`);
      else if (current?.online) notify('Studio data is synced.');
      return true;
    } catch (err) {
      if (client.getContext) {
        try {
          const ctx = await client.getContext();
          if (ctx) {
            setRemoteContext(ctx);
            onRemoteContext?.(ctx);
            if (!ctx.organizationId) {
              setData(emptySnapshot());
              setError(err);
            }
          }
        } catch { /* Keep the sync error message below. */ }
      }
      if (client.getSyncState) setSyncState(client.getSyncState());
      notify(err, {type: 'error', context: 'Sync studio data', fallbackMessage: 'Sync could not be completed.', onRetry: () => syncNow()});
      return false;
    }
  }, [client, enabled, mode, notify]);

  useEffect(() => {
    if (!enabled || mode !== 'supabase') return undefined;
    const refreshState = () => { if (client.getSyncState) setSyncState(client.getSyncState()); };
    const runSync = () => {
      refreshState();
      client.syncNow?.().then(next => { if (next) setData(next); }).catch(() => {});
    };
    const onOnline = () => runSync();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      if (Date.now() - lastFocusSync.current < 15_000) return;
      lastFocusSync.current = Date.now();
      runSync();
    };
    const onStorage = event => {
      if (event.key?.startsWith('yoga-studio-erp-sync-v1:')) client.refreshFromStorage?.();
    };
    // Pending-only safety net: if an earlier automatic attempt failed while
    // the app stayed open, keep retrying without asking the user to remember
    // Sync now. It does not poll when there is no queued work.
    const retryTimer = setInterval(() => {
      const current = client.getSyncState?.();
      if (navigator.onLine && document.visibilityState === 'visible' && current?.pendingCount) runSync();
    }, 30_000);
    const onPageHide = () => {
      // Best effort only; browsers may stop work during close. The durable
      // outbox remains the real protection and syncs on the next open.
      const current = client.getSyncState?.();
      if (navigator.onLine && current?.pendingCount) client.syncNow?.().catch(() => {});
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', refreshState);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearInterval(retryTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', refreshState);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [client, enabled, mode]);

  useEffect(() => {
    if (!enabled || mode !== 'supabase') return undefined;
    const notYetInSupabase = syncState.pendingCount > 0 || syncState.conflictCount > 0 || syncState.syncing;
    if (!notYetInSupabase) return undefined;
    const warnBeforeClose = event => {
      // Changes are already persisted in the device outbox, so closing does
      // not erase them; this asks permission because they are not yet safely
      // in Supabase and would remain only on this device until reopened.
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeClose);
    return () => window.removeEventListener('beforeunload', warnBeforeClose);
  }, [enabled, mode, syncState.pendingCount, syncState.conflictCount, syncState.syncing]);

  useEffect(() => {
    if (syncState.conflictCount > previousConflictCount.current) {
      notify(`${syncState.conflictCount} sync conflict(s) need review. Open “Review sync conflicts” to compare versions; no change was overwritten.`);
    }
    previousConflictCount.current = syncState.conflictCount;
  }, [notify, syncState.conflictCount]);

  const act = useCallback(async (action, successMessage) => {
    try {
      const next = await action(client);
      if (next) setData(next);
      const current = client.getSyncState?.();
      if (current) setSyncState(current);
      if (successMessage) {
        notify(mode === 'supabase' && current?.pendingCount
          ? `${successMessage} Saved on this device and queued for sync.`
          : successMessage);
      }
      return true;
    } catch (err) {
      notify(err, {type: 'error', context: 'Save studio data', fallbackMessage: 'Could not save. Please try again.'});
      return false;
    }
  }, [client, mode, notify]);

  const resolveConflict = useCallback(async (conflictId, choice) => {
    try {
      const next = await client.resolveConflict?.(conflictId, choice);
      if (next) setData(next);
      if (client.getSyncState) setSyncState(client.getSyncState());
      notify(choice === 'mine' ? 'Your version was queued to sync.' : 'The Supabase version was kept.');
      return true;
    } catch (err) {
      notify(err, {type: 'error', context: 'Resolve sync conflict', fallbackMessage: 'That conflict could not be resolved.'});
      return false;
    }
  }, [client, notify]);

  const clearSyncCache = useCallback(async (options = {}) => {
    const next = await client.clearSyncCache?.(options);
    if (next) setData(next);
    if (client.getSyncState) setSyncState(client.getSyncState());
    return next;
  }, [client]);

  return {
    data, setData, loading, error, load, act, client, remoteContext,
    setupNeeded: isMissingRpcError(error) || syncState.setupNeeded,
    syncState, syncNow, resolveConflict, clearSyncCache,
  };
}

/* ---------------- shared helpers ---------------- */

function downloadText(filename, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

export function exportCSV(filename, rows, columns) { downloadText(filename, toCSV(rows, columns)); }
export function downloadJSON(filename, text) { downloadText(filename, text, 'application/json'); }

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

function branchName(data, id) { return data.branches.find(b => b.id === id)?.name || '—'; }
function studentName(data, id) { return data.students.find(s => s.id === id)?.fullName || '—'; }
function instructorName(data, id) { return data.instructors.find(i => i.id === id)?.fullName || 'Not assigned'; }
function planName(data, id) { return data.plans.find(p => p.id === id)?.name || '—'; }
function planTypeLabel(plan) {
  return PLAN_TYPES.find(type => type.id === normalizePlanType(plan?.planType))?.label || 'Subscription';
}
function activePlans(data, planType = 'subscription') {
  return data.plans.filter(plan => plan.status !== 'archived'
    && normalizePlanType(plan.planType) === planType);
}
function membershipKindLabel(data, membership) {
  const plan = data.plans.find(item => item.id === membership?.planId) || null;
  return isOneMonthMembership(membership, plan) ? 'One-month pass' : 'Subscription';
}
function inBranch(ctx, branchId) { return !ctx.branchId || ctx.branchId === 'all' || ctx.branchId === branchId; }
function newClientUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function whatsappPhone(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : '';
}
function whatsappUrl(value = '', message = '') {
  const phone = whatsappPhone(value);
  if (!phone) return '';
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${phone}${text}`;
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const FULL_DAY_LABELS = {
  0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday',
  4: 'Thursday', 5: 'Friday', 6: 'Saturday',
};

function nextUpcomingBatchDate(batch, today = toISODate()) {
  if (!batch || batch.status !== 'active') return '';
  const nextDate = nextBatchDate(batch, today);
  if (!nextDate) return '';
  if (nextDate !== today) return nextDate;
  const endMinutes = batchEndMinutes(batch);
  if (endMinutes === null) return nextDate;
  const now = new Date();
  const currentMinutes = (now.getHours() * 60) + now.getMinutes();
  return endMinutes > currentMinutes
    ? nextDate
    : nextBatchDate(batch, addDaysISO(today, 1));
}

function relativeClassDateLabel(date, today = toISODate()) {
  if (!date) return 'No upcoming class';
  if (date === today) return 'Today';
  if (date === addDaysISO(today, 1)) return 'Tomorrow';
  const weekday = new Date(`${date}T12:00:00`).getDay();
  return `${FULL_DAY_LABELS[weekday]} · ${formatDate(date)}`;
}

function batchDaySummary(batch) {
  const days = new Set((batch?.days || []).map(Number));
  return WEEK_ORDER.filter(day => days.has(day)).map(day => DAY_LABELS[day]).join(' · ') || 'No days set';
}

function batchWorkspaceMetrics(data, batch, today = toISODate(), studentId = '') {
  const fill = batchFill(batch, data.enrollments);
  const recentFrom = addDaysISO(today, -29);
  const recentAttendance = (data.attendance || []).filter(record => (
    record.batchId === batch?.id
    && record.classDate >= recentFrom
    && record.classDate <= today
    && (!studentId || record.studentId === studentId)
  ));
  return {
    fill,
    nextDate: nextUpcomingBatchDate(batch, today),
    weeklyClasses: new Set((batch?.days || []).map(Number)).size,
    attendanceRate: attendanceSummary(recentAttendance).rate,
    attendanceCount: recentAttendance.length,
  };
}

function renewalChildByPrevious(data) {
  const byPrevious = new Map();
  for (const membership of data.memberships || []) {
    if (!membership.previousMembershipId || membership.status === 'cancelled') continue;
    if (!byPrevious.has(membership.previousMembershipId)) {
      byPrevious.set(membership.previousMembershipId, membership);
    }
  }
  return byPrevious;
}
function subscriptionChain(data, membership) {
  if (!membership) return [];
  const byId = new Map((data.memberships || []).map(item => [item.id, item]));
  const childrenByPrevious = new Map();
  for (const item of data.memberships || []) {
    if (!item.previousMembershipId) continue;
    const siblings = childrenByPrevious.get(item.previousMembershipId) || [];
    siblings.push(item);
    childrenByPrevious.set(item.previousMembershipId, siblings);
  }
  for (const siblings of childrenByPrevious.values()) {
    siblings.sort((a, b) => (
      ((a.status === 'cancelled' ? 0 : 1) - (b.status === 'cancelled' ? 0 : 1))
      || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      || String(a.startDate || '').localeCompare(String(b.startDate || ''))
    ));
  }
  let root = membership;
  const seenRoots = new Set([root.id]);
  while (root.previousMembershipId && byId.has(root.previousMembershipId)
      && !seenRoots.has(root.previousMembershipId)) {
    root = byId.get(root.previousMembershipId);
    seenRoots.add(root.id);
  }
  const chain = [];
  const seen = new Set();
  const visit = current => {
    if (!current || seen.has(current.id)) return;
    chain.push(current);
    seen.add(current.id);
    for (const child of childrenByPrevious.get(current.id) || []) visit(child);
  };
  visit(root);
  return chain;
}
function subscriptionPeriodLabel(membership) {
  if (isOneMonthMembership(membership)) return 'One-month pass';
  return Number(membership?.renewalNumber) > 0
    ? `Renewal #${Number(membership.renewalNumber)}`
    : 'Original subscription';
}
function SubscriptionBadge({membership, today}) {
  const lifecycle = subscriptionLifecycle(membership, today);
  return <span className={`erp-badge ${lifecycle.tone}`}>{lifecycle.id}</span>;
}

function Dialog({title, sub, onClose, children, className = ''}) {
  return <div className="modal-backdrop" onClick={onClose}>
    <div className={`erp-dialog ${className}`} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <button className="icon-button dialog-close" aria-label={`Close ${title}`} onClick={onClose}><X size={20}/></button>
      <h2>{title}</h2>{sub && <p className="dialog-sub">{sub}</p>}{children}
    </div>
  </div>;
}

function Empty({icon: Icon, title, text, action}) {
  return <div className="erp-empty"><Icon size={34} strokeWidth={1.4}/><h3>{title}</h3><p>{text}</p>{action}</div>;
}

export function ErpBlockingState({erp, mode, setMode, accountIntent = '', onAccountIntentChange}) {
  const [orgName, setOrgName] = useState('Yoga Studio');
  const [intentChoice, setIntentChoice] = useState(accountIntent || 'member');
  const [hadKnownIntent] = useState(Boolean(accountIntent));
  useEffect(() => { if (accountIntent) setIntentChoice(accountIntent); }, [accountIntent]);
  if (!erp.error) return null;
  const noOrg = /NO_ORGANIZATION|no organization/i.test(erp.error.message || '');
  const effectiveIntent = accountIntent || intentChoice;
  const chooseIntent = intent => {
    setIntentChoice(intent);
    onAccountIntentChange?.(intent);
  };
  return <div className="erp-banner blue" role="alert"><AlertCircle size={20}/>
    <div style={{flex: 1}}>
      {erp.setupNeeded ? <>
        <strong>Supabase ERP setup is not installed yet.</strong><br/>
        Open your Supabase project → <b>SQL Editor</b> → paste the full contents of <b>supabase/erp_setup.sql</b> from this repository → <b>Run</b>. Then retry. Your existing login keeps working either way.
      </> : noOrg ? <>
        <strong>This account is not connected to a studio yet.</strong><br/>
        {!hadKnownIntent && <fieldset className="account-intent">
          <legend>How will you use Yoga Studio?</legend>
          <label>
            <input type="radio" name="waiting-account-intent" value="member" checked={effectiveIntent === 'member'} onChange={() => chooseIntent('member')}/>
            <span><strong>Join an existing studio</strong><small>Student, Instructor, Admin or Co-owner. The studio must grant access to this sign-in email.</small></span>
          </label>
          <label>
            <input type="radio" name="waiting-account-intent" value="owner" checked={effectiveIntent === 'owner'} onChange={() => chooseIntent('owner')}/>
            <span><strong>Create my own studio</strong><small>Only choose this if you are the primary studio Owner.</small></span>
          </label>
        </fieldset>}
        {effectiveIntent === 'owner' ? <>
          Create your organization below; this one step makes your signed-in account the primary Owner, and you can add branches right after.
          <div className="erp-actions" style={{marginTop: 10}}>
            <span className="erp-search"><Building2 size={15}/><input aria-label="Organization name" value={orgName} onChange={e => setOrgName(e.target.value)}/></span>
            <button className="primary-button" onClick={async () => { if (await erp.act(c => c.bootstrapOrganization(orgName.trim() || 'Yoga Studio'), 'Organization created. Add your first branch.')) erp.load(); }}>Create organization</button>
          </div>
        </> : <>
          <b>Waiting for your studio to grant access.</b> Ask an Owner or Co-owner to link your exact sign-in email in <b>Access</b>. For a Student account, they use <b>Students → Portal access</b>. You will receive only the role and records your studio grants to this account. Press <b>Retry</b> after they grant access.
        </>}
      </> : <ErrorNotice error={erp.error} context="Load studio data"/>}
      <div className="erp-actions" style={{marginTop: 10}}>
        <button className="secondary-button" onClick={erp.load}>Retry</button>
        {mode === 'supabase' && !(noOrg && effectiveIntent === 'member') && <button className="secondary-button" onClick={() => setMode('local')}>Use this device only (offline)</button>}
      </div>
    </div>
  </div>;
}

const SYNC_ENTITY_LABELS = {
  branches: 'Branch', students: 'Student', instructors: 'Instructor', batches: 'Batch',
  enrollments: 'Enrollment', attendance: 'Attendance', plans: 'Plan',
  memberships: 'Subscription', payments: 'Payment', billingSettings: 'Payment & invoice settings',
};
const SYNC_FIELD_LABELS = {
  name: 'Name', fullName: 'Full name', branchId: 'Branch', studentId: 'Student',
  instructorId: 'Instructor', batchId: 'Batch', walkInBatchId: 'Initial batch',
  planId: 'Plan', membershipId: 'Subscription',
  city: 'City', address: 'Address', phone: 'Phone', email: 'Email', gender: 'Gender',
  dob: 'Date of birth', joiningDate: 'Joining date', joinedOn: 'Joined on', status: 'Status',
  notes: 'Notes', days: 'Days', startTime: 'Start time', durationMins: 'Duration (mins)',
  capacity: 'Capacity', classDate: 'Class date', amountPaise: 'Amount', durationMonths: 'Duration (months)',
  startDate: 'Start date', endDate: 'End date', billingCycle: 'Billing cycle', method: 'Method',
  paidOn: 'Paid on', note: 'Note', receiptNo: 'Receipt', voidReason: 'Void reason',
  legalName: 'Billing name', stateCode: 'State code', pinCode: 'PIN code', gstEnabled: 'GST enabled',
  gstin: 'GSTIN', gstRatePercent: 'GST rate (%)', sacCode: 'SAC/HSN', priceIncludesGst: 'Prices include GST',
  invoicePrefix: 'Invoice prefix', dueDays: 'Due days', upiId: 'UPI ID', upiPayeeName: 'UPI payee',
  bankName: 'Bank', bankAccountName: 'Bank account name', bankAccountNumber: 'Bank account number',
  bankAccountType: 'Account type', ifsc: 'IFSC', gatewayProvider: 'Gateway provider',
  gatewayEnvironment: 'Gateway environment', gatewayPublicKeyId: 'Gateway public key ID',
  gatewayWebhookUrl: 'Webhook URL', gatewayWebhookConfigured: 'Webhook configured', terms: 'Terms',
  firstName: 'First Name', lastName: 'Last Name', admissionSubject: 'Subject',
  referredBy: 'Reference by', yogaExperience: 'Experience in yoga',
  medicalPhysicalIssue: 'Medical / Physical issue', reasonToJoin: 'Reasons to join yoga',
  planType: 'Plan type', offeringType: 'Offering type',
  renewalEnabledDefault: 'Renewal enabled by default',
  autoRenew: 'Renewal enabled', previousMembershipId: 'Previous subscription',
  renewalNumber: 'Renewal number', pausedFrom: 'Paused from', pausedUntil: 'Expected resume date',
  pauseReason: 'Pause reason', totalPausedDays: 'Total paused days',
  cancelledAt: 'Cancelled at', cancelReason: 'Cancellation reason',
  bio: 'Instructor bio', specialties: 'Specialties / styles',
  qualifications: 'Qualifications / certifications', experienceYears: 'Experience (years)',
};

const YOGA_EXPERIENCE_OPTIONS = [
  {value: 'experienced', label: 'Experienced'},
  {value: 'no_experience', label: 'No Experience'},
  {value: 'less_experienced', label: 'Less Experienced'},
];
const yogaExperienceLabel = value => YOGA_EXPERIENCE_OPTIONS.find(option => option.value === value)?.label || 'Not specified';

function syncValue(field, value, data) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'amountPaise') return formatINR(value);
  if (field === 'yogaExperience') return yogaExperienceLabel(value);
  if (field === 'planType' || field === 'offeringType') {
    return value === 'one_month' ? 'One-month only' : 'Subscription';
  }
  if (field === 'billingCycle') return value === 'calendar' ? 'Calendar month' : 'Joining date';
  if (field === 'days' && Array.isArray(value)) return value.map(day => DAY_LABELS[day] || day).join(', ');
  if (field === 'branchId') return branchName(data, value);
  if (field === 'studentId') return studentName(data, value);
  if (field === 'instructorId') return instructorName(data, value);
  if (field === 'batchId') return data.batches.find(batch => batch.id === value)?.name || '—';
  if (field === 'planId') return planName(data, value);
  if (field === 'membershipId' || field === 'previousMembershipId') {
    const membership = data.memberships.find(item => item.id === value);
    return membership ? `${studentName(data, membership.studentId)} · ${formatDate(membership.startDate)}` : '—';
  }
  if (field === 'cancelledAt' && typeof value === 'string') return formatDate(value.slice(0, 10));
  if (/Date$|dob|joinedOn|paidOn|pausedFrom|pausedUntil/.test(field) && typeof value === 'string') return formatDate(value);
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function conflictTitle(data, conflict) {
  const record = conflict.op.proposedRecord || conflict.serverRecord || {};
  const fallback = SYNC_ENTITY_LABELS[conflict.op.entity] || 'Record';
  if (record.name || record.fullName) return `${fallback}: ${record.name || record.fullName}`;
  if (conflict.op.entity === 'attendance') {
    return `Attendance: ${studentName(data, record.studentId)} · ${formatDate(record.classDate)}`;
  }
  if (conflict.op.entity === 'payments') {
    return `Payment: ${studentName(data, record.studentId)} · ${formatINR(record.amountPaise)}`;
  }
  if (conflict.op.entity === 'enrollments') return `Enrollment: ${studentName(data, record.studentId)}`;
  if (conflict.op.entity === 'memberships') {
    return `${record.offeringType === 'one_month' ? 'One-month pass' : 'Subscription'}: ${studentName(data, record.studentId)}`;
  }
  return fallback;
}

function SyncConflictsDialog({data, conflicts, onClose, onResolve}) {
  const [busyId, setBusyId] = useState('');
  const resolve = async (conflict, choice) => {
    setBusyId(conflict.id);
    try { await onResolve(conflict.id, choice); }
    finally { setBusyId(''); }
  };
  return <Dialog title="Review sync conflicts" sub="These changes were not overwritten. Compare this device with Supabase and choose what to keep. “Keep mine” reapplies only the fields changed on this device." onClose={onClose}>
    {conflicts.length === 0 ? <p style={{fontSize: 13}}>All conflicts are resolved.</p> : conflicts.map(conflict => {
      const mine = conflict.op.proposedRecord || conflict.op.payload || {};
      const server = conflict.serverRecord || {};
      const fields = [...new Set([...Object.keys(mine), ...Object.keys(server)])]
        .filter(field => !['id', 'createdAt', 'updatedAt', 'syncVersion', 'syncPending', 'portalAccessStatus', 'portalAccessEmail'].includes(field))
        .filter(field => JSON.stringify(mine[field]) !== JSON.stringify(server[field]));
      return <section className="erp-conflict-card" key={conflict.id} aria-label={conflictTitle(data, conflict)}>
        <div className="erp-panel-head" style={{marginBottom: 8}}>
          <div><h3>{conflictTitle(data, conflict)}</h3>
            <p>{conflict.kind === 'blocked' ? 'Supabase could not accept this change.' : 'Changed on this device and in Supabase.'}</p></div>
          <span className={`erp-badge ${conflict.kind === 'blocked' ? 'red' : 'amber'}`}>{conflict.kind === 'blocked' ? 'Needs attention' : 'Conflict'}</span>
        </div>
        {conflict.message && <p className="erp-conflict-message">{conflict.message}</p>}
        {fields.length > 0 && <div className="erp-table-wrap"><table className="erp-table erp-conflict-table">
          <thead><tr><th>Field</th><th>This device</th><th>Supabase now</th></tr></thead>
          <tbody>{fields.map(field => <tr key={field}><td>{SYNC_FIELD_LABELS[field] || field}</td><td>{syncValue(field, mine[field], data)}</td><td>{syncValue(field, server[field], data)}</td></tr>)}</tbody>
        </table></div>}
        <div className="erp-form-actions">
          <button className="secondary-button" disabled={busyId === conflict.id} onClick={() => resolve(conflict, 'server')}>
            {conflict.kind === 'blocked' ? 'Discard my change' : 'Keep Supabase'}
          </button>
          {conflict.kind !== 'blocked' && <button className="primary-button" disabled={busyId === conflict.id} onClick={() => resolve(conflict, 'mine')}>Keep mine</button>}
        </div>
      </section>;
    })}
    <div className="erp-form-actions"><button className="secondary-button" onClick={onClose}>Close</button></div>
  </Dialog>;
}

function SyncControls({data, erp, mode}) {
  const online = useOnline();
  const [reviewOpen, setReviewOpen] = useState(false);
  const sync = erp?.syncState || defaultSyncState('supabase');
  useEffect(() => {
    if (reviewOpen && sync.conflictCount === 0) setReviewOpen(false);
  }, [reviewOpen, sync.conflictCount]);
  if (mode === 'local') {
    return <span className={`erp-mode-badge ${online ? '' : 'offline'}`} style={{marginLeft: 'auto'}}>
      {online ? <Check size={13}/> : <WifiOff size={13}/>} On this device{online ? '' : ' · Offline'}
    </span>;
  }
  const label = sync.setupNeeded ? 'Sync setup needed'
    : sync.syncing ? 'Syncing…'
    : sync.conflictCount ? `${sync.conflictCount} conflict(s)`
    : sync.pendingCount ? `${sync.pendingCount} waiting`
    : online ? 'Synced' : 'Offline copy';
  const needsAttention = !online || sync.pendingCount > 0 || sync.conflictCount > 0 || sync.setupNeeded;
  const detail = sync.setupNeeded
    ? 'Run the updated supabase/erp_setup.sql to enable offline sync.'
    : sync.error || (sync.lastSyncedAt ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString('en-IN')}` : 'Supabase offline sync');
  return <div className="erp-sync-actions">
    <span className={`erp-mode-badge ${needsAttention ? 'offline' : ''}`} title={detail} role="status">
      {sync.conflictCount ? <AlertCircle size={13}/> : online ? <Check size={13}/> : <WifiOff size={13}/>} Supabase · {label}
    </span>
    <button type="button" className="erp-sync-btn" onClick={() => erp.syncNow?.()} disabled={!online || sync.syncing}>
      <RefreshCw size={14} className={sync.syncing ? 'erp-spinning' : ''}/> Sync now
    </button>
    {sync.conflictCount > 0 && <button type="button" className="erp-sync-btn erp-sync-review" onClick={() => setReviewOpen(true)}>
      <AlertCircle size={14}/> Review conflicts ({sync.conflictCount})
    </button>}
    {reviewOpen && <SyncConflictsDialog data={data} conflicts={sync.conflicts} onClose={() => setReviewOpen(false)} onResolve={erp.resolveConflict}/>}
  </div>;
}

export function ErpToolbar({data, ctx, setCtx, mode, remoteContext, erp}) {
  const roles = mode === 'supabase'
    ? ROLES.filter(r => remoteContext?.roles?.includes(r.id))
    : ROLES;
  const roleLocked = mode === 'supabase' && roles.length <= 1;
  const pendingRoleLabel = remoteContext && !remoteContext.organizationId
    ? 'No ERP role linked'
    : 'Checking access…';
  const set = patch => setCtx(prev => ({...prev, ...patch}));
  return <div className="erp-toolbar" aria-label="ERP filters">
    <label>Portal
      <select aria-label="Portal role" value={roles.some(r => r.id === ctx.role) ? ctx.role : (roles[0]?.id || '')} disabled={roleLocked} onChange={e => set({role: e.target.value})}>
        {roles.length
          ? roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)
          : <option value="">{pendingRoleLabel}</option>}
      </select>
    </label>
    <label>Branch
      <select aria-label="Branch filter" value={ctx.branchId || 'all'} onChange={e => set({branchId: e.target.value})}>
        <option value="all">All branches</option>
        {data.branches.filter(b => b.status !== 'archived').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
    {ctx.role === 'instructor' && (mode === 'supabase' ? <label>Signed-in instructor
      <select aria-label="Signed-in instructor" value={remoteContext?.instructorId || ctx.instructorId || ''} disabled>
        <option value={remoteContext?.instructorId || ctx.instructorId || ''}>
          {(remoteContext?.instructorId || ctx.instructorId)
            ? (data.instructors.find(i => i.id === (remoteContext?.instructorId || ctx.instructorId))?.fullName || 'Your instructor record')
            : 'Waiting for the studio to link your account'}
        </option>
      </select>
    </label> : <label>Acting instructor
      <select aria-label="Acting instructor" value={ctx.instructorId || ''} onChange={e => set({instructorId: e.target.value})}>
        <option value="">Choose instructor…</option>
        {data.instructors.filter(i => i.status !== 'inactive').map(i => <option key={i.id} value={i.id}>{i.fullName}</option>)}
      </select>
    </label>)}
    {ctx.role === 'student' && (mode === 'supabase' ? <label>Signed-in student
      <select aria-label="Signed-in student" value={remoteContext?.studentId || ctx.studentId || ''} disabled>
        <option value={remoteContext?.studentId || ctx.studentId || ''}>
          {(remoteContext?.studentId || ctx.studentId)
            ? (data.students.find(s => s.id === (remoteContext?.studentId || ctx.studentId))?.fullName || 'Your student record')
            : 'Waiting for the studio to link your account'}
        </option>
      </select>
    </label> : <label>Acting student
      <select aria-label="Acting student" value={ctx.studentId || ''} onChange={e => set({studentId: e.target.value})}>
        <option value="">Choose student…</option>
        {data.students.filter(s => s.status === 'active').map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
      </select>
    </label>)}
    {ctx.role !== 'student' && <SyncControls data={data} erp={erp} mode={mode}/>}
  </div>;
}

const canManage = ctx => ctx.role === 'owner' || ctx.role === 'co_owner' || ctx.role === 'admin';
const canManageOrg = ctx => ctx.role === 'owner' || ctx.role === 'co_owner';
const canManageAccess = ctx => canManage(ctx);
const canSetupInstructorProfiles = ctx => canManage(ctx);
const canEditBatchRoster = (ctx, batch) => Boolean(batch) && (
  canManage(ctx)
  || (ctx.role === 'instructor' && ctx.instructorId
    && batch.instructorId === ctx.instructorId && batch.status === 'active')
);
const canUseEnrollmentWizard = ctx => canManage(ctx)
  || (ctx.role === 'instructor' && Boolean(ctx.instructorId));
const canCollectPayments = ctx => canManage(ctx) || ctx.role === 'instructor';

/* ---------------- dashboard ---------------- */

function StudentDashboardSection(props) {
  const {erp, ctx, go} = props;
  const {data} = erp;
  const today = toISODate();
  const student = data.students.find(s => s.id === ctx.studentId);
  const myEnrollments = data.enrollments.filter(e => e.studentId === ctx.studentId && e.status === 'active');
  const enrollmentByBatch = new Map(myEnrollments.map(e => [e.batchId, e]));
  const myBatches = data.batches
    .filter(b => b.status === 'active' && enrollmentByBatch.has(b.id) && inBranch(ctx, b.branchId))
    .sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')) || a.name.localeCompare(b.name));
  const nextClassFor = batch => {
    for (let offset = 0; offset <= 7; offset += 1) {
      const date = addDaysISO(today, offset);
      if (isBatchOnDate(batch, date)) return date;
    }
    return '';
  };
  const upcoming = myBatches
    .flatMap(batch => Array.from({length: 7}, (_, offset) => ({batch, date: addDaysISO(today, offset)}))
      .filter(item => isBatchOnDate(item.batch, item.date)))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.batch.startTime || '').localeCompare(String(b.batch.startTime || '')));
  const todayBatches = myBatches.filter(b => isBatchOnDate(b, today));
  const myAttendance = data.attendance
    .filter(a => a.studentId === ctx.studentId && enrollmentByBatch.has(a.batchId))
    .sort((a, b) => b.classDate.localeCompare(a.classDate));
  const attendance = attendanceSummary(myAttendance);
  const billing = billingSettingsOf(data);
  const membershipEntries = data.memberships
    .filter(m => m.studentId === ctx.studentId && inBranch(ctx, m.branchId))
    .map(m => ({m, bal: payableBalance(m, data.payments, billing, today)}))
    .sort((a, b) => String(b.m.endDate || '').localeCompare(String(a.m.endDate || '')));
  const childByPrevious = renewalChildByPrevious(data);
  const openMembershipEntries = membershipEntries.filter(({m}) => m.status !== 'cancelled');
  const currentPeriodEntries = openMembershipEntries.filter(({m}) => (
    subscriptionLifecycle(m, today).id === 'active' || subscriptionLifecycle(m, today).id === 'paused'
  ));
  const scheduledEntries = openMembershipEntries
    .filter(({m}) => subscriptionLifecycle(m, today).id === 'scheduled')
    .sort((a, b) => String(a.m.startDate || '').localeCompare(String(b.m.startDate || '')));
  const currentMembership = currentPeriodEntries[0] || scheduledEntries[0]
    || openMembershipEntries[0] || membershipEntries[0];
  const dueTotal = openMembershipEntries.reduce((sum, {bal}) => sum + bal.due, 0);
  const currentLifecycle = currentMembership ? subscriptionLifecycle(currentMembership.m, today) : null;
  const currentIsOneMonth = currentMembership
    ? isOneMonthMembership(currentMembership.m, data.plans.find(plan => plan.id === currentMembership.m.planId))
    : false;
  const currentKindLabel = currentIsOneMonth ? 'One-month pass' : 'Subscription';
  const renewedMembership = currentMembership ? childByPrevious.get(currentMembership.m.id) : null;
  const currentRenewalDate = currentMembership
    ? nextRenewalDate(currentMembership.m, today, Boolean(renewedMembership))
    : '';
  const myPayments = data.payments
    .filter(p => p.studentId === ctx.studentId && inBranch(ctx, p.branchId))
    .sort((a, b) => String(b.paidOn || '').localeCompare(String(a.paidOn || '')));
  const membershipCashTotal = currentMembership?.bal.grossTotalPaise || currentMembership?.bal.total || 0;
  const paidPercent = membershipCashTotal
    ? Math.min(100, Math.round((currentMembership.bal.paid / membershipCashTotal) * 100))
    : 0;
  const nextClass = upcoming[0];

  return <>
    <ErpBlockingState {...props}/>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>
    {erp.loading && <p style={{color: '#9b92a4', fontSize: 13}}>Loading your student data…</p>}
    {!ctx.studentId ? <section className="erp-panel">
      <Empty icon={Users} title="Your student record is not linked yet" text={props.mode === 'supabase' ? 'Ask the studio to grant portal access to your sign-in email. Your assigned batches will appear here after the account is linked.' : 'Choose “Acting student” above to preview that student’s assigned batches and records.'}/>
    </section> : <>
      <section className="erp-student-hero" aria-label="Student summary">
        <span className="erp-student-avatar" aria-hidden="true">{initials(student?.fullName || 'Student')}</span>
        <div className="erp-student-hero-copy">
          <small>MY PRACTICE</small>
          <h2>{student?.fullName || 'Your classes'}</h2>
          <p>{student ? `${branchName(data, student.branchId)} branch · ` : ''}{myBatches.length} assigned batch(es)</p>
        </div>
        <div className="erp-student-next">
          <small>{nextClass?.date === today ? "TODAY'S NEXT CLASS" : 'NEXT CLASS'}</small>
          <strong>{nextClass ? nextClass.batch.name : 'No class scheduled'}</strong>
          <span>{nextClass ? `${formatDate(nextClass.date)} · ${batchTimeLabel(nextClass.batch)}` : 'Your next assigned class will appear here.'}</span>
        </div>
      </section>

      <div className="erp-grid" aria-label="My student summary">
        <div className="erp-kpi"><small>My assigned batches</small><strong>{myBatches.length}</strong><p>Only batches you are enrolled in</p></div>
        <div className="erp-kpi"><small>Classes today</small><strong>{todayBatches.length}</strong><p>{formatDate(today)}</p></div>
        <div className="erp-kpi"><small>My attendance</small><strong>{attendance.rate === null ? '—' : `${attendance.rate}%`}</strong><p>{attendance.present + attendance.late} attended · {attendance.absent} absent</p></div>
        <div className="erp-kpi"><small>My dues</small><strong>{formatINR(dueTotal)}</strong><p>{dueTotal ? 'Please contact the studio to pay.' : 'All clear. Thank you!'}</p></div>
      </div>

      <section className="erp-panel">
        <div className="erp-panel-head"><div><h2>My assigned batches</h2><p>Your enrolled batches only — no studio roster or other-batch information.</p></div>
          <button className="secondary-button" onClick={() => go('batches')}><Clock size={15}/> View my batches</button></div>
        {myBatches.length === 0 ? <Empty icon={Clock} title="No assigned batches yet" text="When the studio enrolls you in a batch, its schedule and instructor will appear here."/> :
        <div className="erp-student-batch-grid">{myBatches.map(batch => {
          const enrollment = enrollmentByBatch.get(batch.id);
          const nextDate = nextClassFor(batch);
          return <article className="erp-student-batch-card" key={batch.id}>
            <div><strong>{batch.name}</strong><span className="erp-badge green">Enrolled</span></div>
            <p>{branchName(data, batch.branchId)} · {instructorName(data, batch.instructorId)}</p>
            <p>{batch.days.map(day => DAY_LABELS[day]).join(' ')} · {batchTimeLabel(batch)}</p>
            <small>{nextDate ? `Next class: ${formatDate(nextDate)}` : 'No upcoming class in the next week'}{enrollment?.joinedOn ? ` · Joined ${formatDate(enrollment.joinedOn)}` : ''}</small>
          </article>;
        })}</div>}
      </section>

      {(student?.admissionSubject || student?.yogaExperience || student?.medicalPhysicalIssue || student?.reasonToJoin || student?.address) && <section className="erp-panel">
        <div className="erp-panel-head"><div><h2>My admission details</h2><p>The information from your confirmed admission. Contact the studio if anything needs correction.</p></div></div>
        <div className="erp-student-detail-grid">
          {student.admissionSubject && <div><small>Subject</small><strong>{student.admissionSubject}</strong></div>}
          {student.yogaExperience && <div><small>Experience in yoga</small><strong>{yogaExperienceLabel(student.yogaExperience)}</strong></div>}
          {student.address && <div style={{gridColumn: '1 / -1'}}><small>Address</small><strong>{student.address}{student.pinCode ? ` · ${student.pinCode}` : ''}</strong></div>}
          {student.medicalPhysicalIssue && <div style={{gridColumn: '1 / -1'}}><small>Medical / Physical issue</small><strong>{student.medicalPhysicalIssue}</strong></div>}
          {student.reasonToJoin && <div style={{gridColumn: '1 / -1'}}><small>Reasons to join yoga</small><strong>{student.reasonToJoin}</strong></div>}
        </div>
      </section>}

      <div className="erp-student-columns">
        <section className="erp-panel">
          <div className="erp-panel-head"><div><h2>My subscription & passes</h2><p>Your current plan or one-month pass, balance and recent payments.</p></div>
            <button className="secondary-button" onClick={() => go('subscriptions')}><Wallet size={15}/> View subscriptions</button></div>
          {!currentMembership ? <Empty icon={Wallet} title="No subscription or pass yet" text="Your subscription, one-month pass and balance will appear here when the studio assigns a plan."/> : <>
            <div className="erp-student-detail-grid">
              <div><small>Plan</small><strong>{planName(data, currentMembership.m.planId)} · {currentKindLabel}</strong></div>
              <div><small>Status</small><strong>{currentLifecycle?.label || 'Active'}</strong></div>
              <div><small>Period</small><strong>{formatDate(currentMembership.m.startDate)} → {formatDate(currentMembership.m.endDate)}</strong></div>
              <div><small>{currentIsOneMonth ? 'Renewal' : 'Next renewal'}</small><strong>{currentIsOneMonth ? 'No renewal' : renewedMembership ? formatDate(renewedMembership.startDate) : currentRenewalDate ? formatDate(currentRenewalDate) : '—'}</strong></div>
              <div><small>Paid</small><strong>{formatINR(currentMembership.bal.paid)}</strong></div>
              <div><small>Due</small><strong>{formatINR(currentMembership.bal.due)}</strong></div>
            </div>
            <div className="erp-student-progress" role="progressbar" aria-label={`${currentKindLabel} amount paid`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={paidPercent}><span style={{width: `${paidPercent}%`}}/></div>
            <p className="erp-student-note">{currentIsOneMonth
              ? currentLifecycle?.id === 'cancelled'
                ? 'This one-month pass was cancelled. Please contact the studio if you want a new pass or subscription.'
                : currentLifecycle?.id === 'scheduled'
                  ? `This one-month pass starts ${formatDate(currentMembership.m.startDate)} and does not renew · ${paidPercent}% paid`
                  : currentLifecycle?.id === 'expired'
                    ? 'This one-month pass has ended and does not renew. Please contact the studio for a new pass or subscription.'
                    : `${currentMembership.bal.daysLeft !== null ? `${currentMembership.bal.daysLeft} day(s) left · ` : ''}${paidPercent}% paid. This one-month pass does not renew.`
              : currentLifecycle?.id === 'paused'
              ? `Paused since ${formatDate(currentMembership.m.pausedFrom)}${currentMembership.m.pausedUntil ? ` · expected to resume ${formatDate(currentMembership.m.pausedUntil)}` : ''}. Please contact the studio for changes.`
              : currentLifecycle?.id === 'cancelled'
                ? 'This subscription was cancelled. Please contact the studio if you want to start a new subscription.'
                : currentLifecycle?.id === 'scheduled'
                  ? `This subscription starts ${formatDate(currentMembership.m.startDate)} · ${paidPercent}% paid`
                  : currentLifecycle?.id === 'expired'
                    ? 'This subscription has expired. Please contact the studio to renew.'
                    : renewedMembership
                      ? `Your next subscription period is scheduled to start ${formatDate(renewedMembership.startDate)}.`
                      : currentRenewalDate
                        ? `${currentMembership.bal.daysLeft ?? 0} day(s) left · ${paidPercent}% paid · Next renewal ${formatDate(currentRenewalDate)}. Renewal is confirmed by the studio; there is no automatic charge.`
                        : `${currentMembership.bal.daysLeft !== null ? `${currentMembership.bal.daysLeft} day(s) left · ` : ''}${paidPercent}% paid. Contact the studio before the end date to renew.`}</p>
            {myPayments.length > 0 && <div className="erp-student-list" aria-label="Recent payments">
              {myPayments.slice(0, 3).map(payment => <div key={payment.id}><span><strong>{payment.receiptNo || 'Payment'}</strong><small>{formatDate(payment.paidOn)}</small></span><b>{formatINR(payment.amountPaise)}</b></div>)}
            </div>}
          </>}
        </section>

        <section className="erp-panel">
          <div className="erp-panel-head"><div><h2>Recent attendance</h2><p>{attendance.total} recorded class(es)</p></div>
            <button className="secondary-button" onClick={() => go('attendance')}><CalendarCheck size={15}/> My attendance</button></div>
          {myAttendance.length === 0 ? <Empty icon={CalendarCheck} title="No attendance yet" text="Your present, late and absent classes will appear here after attendance is marked."/> :
          <div className="erp-student-list">{myAttendance.slice(0, 5).map(record => <div key={record.id}>
            <span><strong>{data.batches.find(b => b.id === record.batchId)?.name || 'Class'}</strong><small>{formatDate(record.classDate)}</small></span>
            <span className={`erp-badge ${record.status === 'present' ? 'green' : record.status === 'late' ? 'amber' : 'red'}`}>{record.status}</span>
          </div>)}</div>}
        </section>
      </div>

      <section className="erp-panel">
        <div className="erp-panel-head"><div><h2>Upcoming classes</h2><p>Next seven days from your assigned batches.</p></div></div>
        {upcoming.length === 0 ? <Empty icon={Clock} title="No upcoming classes" text="No assigned batch is scheduled in the next seven days."/> :
        <div className="erp-student-list">{upcoming.slice(0, 7).map(({batch, date}) => <div key={`${batch.id}-${date}`}>
          <span><strong>{batch.name}</strong><small>{formatDate(date)} · {batchTimeLabel(batch)} · {instructorName(data, batch.instructorId)}</small></span>
          <span className={`erp-badge ${date === today ? 'green' : 'lavender'}`}>{date === today ? 'Today' : 'Upcoming'}</span>
        </div>)}</div>}
      </section>
    </>}
  </>;
}

export function ErpDashboardSection(props) {
  if (props.ctx.role === 'student') return <StudentDashboardSection {...props}/>;
  const {erp, ctx, go} = props;
  const {data} = erp;
  const today = toISODate();
  const month = today.slice(0, 7);
  const students = data.students.filter(s => s.status === 'active' && inBranch(ctx, s.branchId));
  const myBatches = data.batches.filter(b => b.status === 'active' && inBranch(ctx, b.branchId)
    && (ctx.role !== 'instructor' || b.instructorId === ctx.instructorId)
    && (ctx.role !== 'student' || data.enrollments.some(e => e.batchId === b.id && e.studentId === ctx.studentId && e.status === 'active')));
  const todayBatches = myBatches.filter(b => isBatchOnDate(b, today));
  const monthPayments = data.payments.filter(p => p.status !== 'void' && p.paidOn?.startsWith(month) && inBranch(ctx, p.branchId));
  const billing = billingSettingsOf(data);
  const collected = monthPayments.reduce((s, p) => s + (p.amountPaise || 0), 0);
  const dues = data.memberships.filter(m => m.status !== 'cancelled')
    .map(m => ({m, bal: payableBalance(m, data.payments, billing, today)}))
    .filter(x => x.bal.due > 0 && inBranch(ctx, x.m.branchId) && (ctx.role !== 'student' || x.m.studentId === ctx.studentId));
  const dueTotal = dues.reduce((s, x) => s + x.bal.due, 0);
  const dashboardChildByPrevious = renewalChildByPrevious(data);
  const expiring = data.memberships.filter(m => m.status === 'active' && m.offeringType !== 'one_month'
      && m.autoRenew !== false && !dashboardChildByPrevious.has(m.id) && inBranch(ctx, m.branchId))
    .map(m => ({m, bal: payableBalance(m, data.payments, billing, today)}))
    .filter(x => x.bal.daysLeft !== null && x.bal.daysLeft >= 0 && x.bal.daysLeft <= 7);
  const myAttendance = data.attendance.filter(a => a.studentId === ctx.studentId);
  const myRate = attendanceSummary(myAttendance).rate;

  const checks = [
    {done: data.branches.length > 0, title: 'Add your first branch', text: 'Branches keep students, batches, subscriptions and payments organized by location.', page: 'branches'},
    {done: data.instructors.length > 0, title: 'Add an instructor', text: 'Use Branches & batches → Instructor profiles, then assign instructors to batches.', page: 'branches'},
    {done: data.students.length > 0, title: 'Add students', text: 'Create student records with branch and contact details.', page: 'students'},
    {done: data.batches.length > 0, title: 'Create a batch & enroll', text: 'Use Branches & batches → Batches to set days and time, then enroll students.', page: 'branches'},
    {done: data.plans.length > 0 && data.memberships.length > 0, title: 'Add a plan & subscription', text: 'Plan templates drive subscriptions or one-month passes, dues and receipts.', page: 'subscriptions'},
  ];
  const showSetup = canManageOrg(ctx) && checks.some(c => !c.done);

  return <>
    <ErpBlockingState {...props}/>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>
    {erp.loading && <p style={{color: '#9b92a4', fontSize: 13}}>Loading studio data…</p>}
    <div className="erp-grid">
      {ctx.role === 'student' ? <>
        <div className="erp-kpi"><small>My batches</small><strong>{myBatches.length}</strong><p>{todayBatches.length} class(es) today</p></div>
        <div className="erp-kpi"><small>My attendance</small><strong>{myRate === null ? '—' : `${myRate}%`}</strong><p>{myAttendance.length} class(es) recorded</p></div>
        <div className="erp-kpi"><small>My dues</small><strong>{formatINR(dueTotal)}</strong><p>{dues.length ? 'Please contact the studio to pay.' : 'All clear. Thank you!'}</p></div>
      </> : <>
        <div className="erp-kpi"><small>{ctx.role === 'instructor' ? 'My active batches' : 'Active students'}</small><strong>{ctx.role === 'instructor' ? myBatches.length : students.length}</strong><p>{ctx.branchId === 'all' || !ctx.branchId ? 'Across all branches' : branchName(data, ctx.branchId)}</p></div>
        <div className="erp-kpi"><small>Classes today</small><strong>{todayBatches.length}</strong><p>{formatDate(today)}</p></div>
        {canManage(ctx) && <div className="erp-kpi"><small>Collected this month</small><strong>{formatINR(collected)}</strong><p>{monthPayments.length} payment(s)</p></div>}
        {canManage(ctx) && <div className="erp-kpi"><small>Pending dues</small><strong>{formatINR(dueTotal)}</strong><p>{dues.length} period(s) with a balance</p></div>}
      </>}
    </div>

    {showSetup && <section className="erp-panel"><div className="erp-panel-head"><div><h2>Set up your studio</h2><p>Five small steps and your ERP is ready for daily use.</p></div><Leaf size={20}/></div>
      <div className="erp-checklist">{checks.map((c, i) => <button key={c.title} className={`erp-check ${c.done ? 'done' : ''}`} onClick={() => go(c.page)}>
        <span className="erp-check-num">{c.done ? <Check size={14}/> : i + 1}</span><span style={{flex: 1}}><strong>{c.title}</strong><small>{c.text}</small></span></button>)}
      </div></section>}

    <section className="erp-panel"><div className="erp-panel-head"><div><h2>Today's classes</h2><p>{formatDate(today)}</p></div>
      {(canManage(ctx) || ctx.role === 'instructor') && <button className="secondary-button" onClick={() => go('attendance')}><CalendarCheck size={15}/> Mark attendance</button>}</div>
      {todayBatches.length === 0 ? <Empty icon={Clock} title="No classes today" text="Batches scheduled for today will appear here with their instructor and timing."/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Batch</th><th>Branch</th><th>Instructor</th><th>Time</th><th>Students</th></tr></thead>
        <tbody>{todayBatches.map(b => <tr key={b.id}><td><strong>{b.name}</strong></td><td>{branchName(data, b.branchId)}</td><td>{instructorName(data, b.instructorId)}</td><td>{batchTimeLabel(b)}</td><td>{data.enrollments.filter(e => e.batchId === b.id && e.status === 'active').length}/{b.capacity}</td></tr>)}</tbody></table></div>}
    </section>

    {canManage(ctx) && expiring.length > 0 && <section className="erp-panel"><div className="erp-panel-head"><div><h2>Expiring in 7 days</h2><p>Renew these subscriptions before they lapse.</p></div><button className="secondary-button" onClick={() => go('subscriptions')}><Repeat size={15}/> Open subscriptions</button></div>
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Student</th><th>Plan</th><th>Ends</th><th>Days left</th><th>Due</th></tr></thead>
        <tbody>{expiring.map(({m, bal}) => <tr key={m.id}><td>{studentName(data, m.studentId)}</td><td>{planName(data, m.planId)}</td><td>{formatDate(m.endDate)}</td><td><span className="erp-badge amber">{bal.daysLeft} day(s)</span></td><td>{formatINR(bal.due)}</td></tr>)}</tbody></table></div></section>}
  </>;
}

/* ---------------- branches ---------------- */

function BranchesSection(props) {
  const {erp, ctx, go, setCtx, onViewBatches} = props; const {data} = erp;
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const today = toISODate();
  const recentFrom = addDaysISO(today, -29);
  const save = async e => { e.preventDefault(); if (await erp.act(c => c.saveBranch(editing), 'Branch saved.')) setEditing(null); };

  const branchRows = data.branches.map(branch => {
    const batches = data.batches.filter(batch => batch.branchId === branch.id);
    const activeBatches = batches.filter(batch => batch.status === 'active');
    const batchIds = new Set(batches.map(batch => batch.id));
    const activeBatchIds = new Set(activeBatches.map(batch => batch.id));
    const enrolled = data.enrollments.filter(enrollment => (
      enrollment.status === 'active' && activeBatchIds.has(enrollment.batchId)
    )).length;
    const capacity = activeBatches.reduce((sum, batch) => sum + Math.max(0, Number(batch.capacity) || 0), 0);
    const fillPercent = capacity > 0 ? Math.round((enrolled / capacity) * 100) : 0;
    const nextClass = activeBatches
      .map(batch => ({batch, date: nextUpcomingBatchDate(batch, today)}))
      .filter(item => item.date)
      .sort((a, b) => a.date.localeCompare(b.date)
        || String(a.batch.startTime || '').localeCompare(String(b.batch.startTime || ''))
        || a.batch.name.localeCompare(b.batch.name))[0] || null;
    const recentAttendance = data.attendance.filter(record => (
      batchIds.has(record.batchId) && record.classDate >= recentFrom && record.classDate <= today
    ));
    return {
      branch,
      activeStudents: data.students.filter(student => student.branchId === branch.id && student.status === 'active').length,
      batches,
      activeBatches,
      enrolled,
      capacity,
      seatsLeft: Math.max(0, capacity - enrolled),
      fillPercent,
      instructorCount: new Set(activeBatches.map(batch => batch.instructorId).filter(Boolean)).size,
      weeklyClasses: activeBatches.reduce((sum, batch) => sum + new Set((batch.days || []).map(Number)).size, 0),
      todayClasses: activeBatches.filter(batch => isBatchOnDate(batch, today)).length,
      nextClass,
      attendanceRate: attendanceSummary(recentAttendance).rate,
      attendanceCount: recentAttendance.length,
    };
  });

  const totals = branchRows.reduce((sum, row) => ({
    activeBranches: sum.activeBranches + Number(row.branch.status !== 'archived'),
    archivedBranches: sum.archivedBranches + Number(row.branch.status === 'archived'),
    students: sum.students + row.activeStudents,
    batches: sum.batches + row.activeBatches.length,
    enrolled: sum.enrolled + row.enrolled,
    capacity: sum.capacity + row.capacity,
    weeklyClasses: sum.weeklyClasses + row.weeklyClasses,
  }), {activeBranches: 0, archivedBranches: 0, students: 0, batches: 0, enrolled: 0, capacity: 0, weeklyClasses: 0});
  const totalFill = totals.capacity > 0 ? Math.round((totals.enrolled / totals.capacity) * 100) : 0;

  const filteredRows = branchRows
    .filter(row => {
      if (statusFilter === 'active' && row.branch.status === 'archived') return false;
      if (statusFilter === 'archived' && row.branch.status !== 'archived') return false;
      const needle = query.trim().toLocaleLowerCase('en-IN');
      if (!needle) return true;
      return [row.branch.name, row.branch.city, row.branch.address, row.branch.phone]
        .join(' ').toLocaleLowerCase('en-IN').includes(needle);
    })
    .sort((a, b) => {
      if (sortBy === 'students') return b.activeStudents - a.activeStudents || a.branch.name.localeCompare(b.branch.name);
      if (sortBy === 'batches') return b.activeBatches.length - a.activeBatches.length || a.branch.name.localeCompare(b.branch.name);
      if (sortBy === 'fill') return b.fillPercent - a.fillPercent || b.enrolled - a.enrolled || a.branch.name.localeCompare(b.branch.name);
      return Number(b.branch.status !== 'archived') - Number(a.branch.status !== 'archived')
        || a.branch.name.localeCompare(b.branch.name);
    });

  const filtersActive = query || statusFilter !== 'all' || sortBy !== 'name';
  const clearFilters = () => { setQuery(''); setStatusFilter('all'); setSortBy('name'); };
  const openStudents = branchId => {
    setCtx?.(previous => ({...previous, branchId}));
    go?.('students');
  };

  return <>
    {data.branches.length > 0 && <div className="erp-grid erp-workspace-summary" aria-label="Branch summary">
      <div className="erp-kpi"><small>Active branches</small><strong>{totals.activeBranches}</strong><p>{totals.archivedBranches} archived</p></div>
      <div className="erp-kpi"><small>Active students</small><strong>{totals.students}</strong><p>Across branches in your scope</p></div>
      <div className="erp-kpi"><small>Active batches</small><strong>{totals.batches}</strong><p>{totals.weeklyClasses} recurring class(es) each week</p></div>
      <div className="erp-kpi"><small>Overall seat fill</small><strong>{totalFill}%</strong><p>{totals.enrolled}/{totals.capacity} enrolled seats</p></div>
    </div>}

    <section className="erp-panel"><div className="erp-panel-head"><div><h2>Branch overview</h2><p>{filteredRows.length} of {data.branches.length} branch(es) shown</p></div>
      {canManageOrg(ctx) && <button className="primary-button" onClick={() => setEditing({name: '', city: '', address: '', phone: ''})}><Plus size={16}/> Add branch</button>}</div>

      {data.branches.length > 0 && <div className="erp-workspace-controls" aria-label="Branch filters">
        <label className="erp-search"><Search size={16}/><input aria-label="Search branches" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search branch, city, address or phone…"/></label>
        <label className="erp-field erp-workspace-field">Status<select aria-label="Branch status filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="all">All statuses</option><option value="active">Active</option><option value="archived">Archived</option>
        </select></label>
        <label className="erp-field erp-workspace-field">Sort by<select aria-label="Sort branches" value={sortBy} onChange={event => setSortBy(event.target.value)}>
          <option value="name">Name</option><option value="students">Most students</option><option value="batches">Most batches</option><option value="fill">Highest seat fill</option>
        </select></label>
        {filtersActive && <button type="button" className="secondary-button" onClick={clearFilters}>Clear filters</button>}
      </div>}

      {data.branches.length === 0 ? <Empty icon={Building2} title="No branch yet" text="Add your first studio location to start adding students and batches."/> :
      filteredRows.length === 0 ? <Empty icon={Search} title="No branches match" text="Try a different search or status filter." action={<button className="secondary-button" onClick={clearFilters}>Clear filters</button>}/> :
      <div className="erp-branch-grid">
        {filteredRows.map(row => {
          const {branch} = row;
          const archived = branch.status === 'archived';
          return <article className={`erp-branch-card ${archived ? 'archived' : ''}`} key={branch.id} aria-label={`${branch.name} branch`}>
            <header>
              <span className="erp-branch-avatar" aria-hidden="true">{initials(branch.name)}</span>
              <div><h3>{branch.name}</h3><p>{branch.city || 'City not added'}</p></div>
              <span className={`erp-badge ${archived ? 'grey' : 'green'}`}>{archived ? 'Archived' : 'Active'}</span>
            </header>

            <dl className="erp-card-stats">
              <div><dt>Students</dt><dd>{row.activeStudents}</dd></div>
              <div><dt>Batches</dt><dd>{row.activeBatches.length}</dd></div>
              <div><dt>Enrolled</dt><dd>{row.enrolled}/{row.capacity}</dd></div>
              <div><dt>Seat fill</dt><dd>{row.fillPercent}%</dd></div>
            </dl>
            <div className="erp-capacity-line">
              <div className="erp-progress" role="progressbar" aria-label={`${branch.name} seat fill`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(100, row.fillPercent)}>
                <span className={row.fillPercent >= 100 ? 'full' : row.fillPercent >= 80 ? 'almost' : ''} style={{width: `${Math.min(100, row.fillPercent)}%`}}/>
              </div>
              <small>{row.capacity > 0 ? `${row.seatsLeft} seat(s) available` : 'No active batch capacity yet'}</small>
            </div>

            <div className="erp-card-badges">
              {row.todayClasses > 0 && <span className="erp-badge green">Classes today</span>}
              {!archived && row.activeBatches.length === 0 && <span className="erp-badge amber">Needs a batch</span>}
              {row.fillPercent >= 90 && row.enrolled > 0 && <span className="erp-badge red">Nearly full</span>}
              {row.attendanceRate !== null && <span className="erp-badge lavender">{row.attendanceRate}% attendance · 30 days</span>}
            </div>

            <div className="erp-card-meta">
              {(branch.address || branch.city) && <p><MapPin size={14}/><span>{[branch.address, branch.city].filter(Boolean).join(' · ')}</span></p>}
              {branch.phone && <p><Phone size={14}/><span>{branch.phone}</span></p>}
              <p><Users size={14}/><span>{row.instructorCount} instructor(s) teaching · {row.weeklyClasses} class(es)/week</span></p>
              <p><CalendarClock size={14}/><span>{row.nextClass
                ? <>Next class: <strong>{row.nextClass.batch.name}</strong> · {relativeClassDateLabel(row.nextClass.date, today)} · {batchTimeLabel(row.nextClass.batch)}</>
                : 'No upcoming class in the next 7 days'}</span></p>
              <p><CalendarCheck size={14}/><span>{row.todayClasses} class(es) today{row.attendanceCount ? ` · ${row.attendanceCount} attendance record(s) in 30 days` : ' · No recent attendance records'}</span></p>
            </div>

            <footer className="erp-card-actions">
              <button type="button" className="secondary-button" onClick={() => onViewBatches?.(branch.id)}>View batches</button>
              <button type="button" className="erp-link-btn" onClick={() => openStudents(branch.id)}><Users size={13}/> View students</button>
              {canManage(ctx) && <button type="button" className="erp-link-btn" onClick={() => setEditing({...branch})}><Pencil size={13}/> Edit</button>}
              {canManage(ctx) && <button type="button" className="erp-link-btn" onClick={() => erp.act(c => c.archiveBranch(branch.id), archived ? 'Branch restored.' : 'Branch archived.')}>{archived ? 'Restore' : 'Archive'}</button>}
            </footer>
          </article>;
        })}
      </div>}
    </section>
    {editing && <Dialog title={editing.id ? 'Edit branch' : 'Add branch'} sub="Students, batches, subscriptions and payments are organized under a branch." onClose={() => setEditing(null)}>
      <form className="erp-form" onSubmit={save}>
        <label className="erp-field">Branch name<input required value={editing.name} onChange={e => setEditing({...editing, name: e.target.value})} placeholder="e.g. Panvel"/></label>
        <label className="erp-field">City<input value={editing.city || ''} onChange={e => setEditing({...editing, city: e.target.value})}/></label>
        <label className="erp-field full">Address<input value={editing.address || ''} onChange={e => setEditing({...editing, address: e.target.value})}/></label>
        <label className="erp-field">Phone<input type="tel" value={editing.phone || ''} onChange={e => setEditing({...editing, phone: e.target.value})}/></label>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button">Save branch</button></div>
      </form></Dialog>}
  </>;
}

export function BranchesPage(props) {
  const {erp, ctx} = props; const {data} = erp;
  const [tab, setTab] = useState('branches');
  const branchTabs = [
    ['branches', 'Branches'],
    ['batches', 'Batches'],
    ...(canSetupInstructorProfiles(ctx) ? [['instructors', 'Instructor profiles']] : []),
  ];
  const showBatchesForBranch = branchId => {
    props.setCtx(previous => ({...previous, branchId}));
    setTab('batches');
  };
  return <>
    <ErpBlockingState {...props}/>
    <div className="page-heading"><div className="eyebrow">STUDIO ERP</div><h1>Branches &amp; batches <span className="flower">✳</span></h1><p>Branch health, weekly schedules, batch capacity, rosters and instructor profiles in one operational workspace.</p></div>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>
    <div className="erp-seg" role="tablist" aria-label="Branches sections" style={{marginBottom: 16}}>
      {branchTabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {tab === 'branches' && <BranchesSection {...props} onViewBatches={showBatchesForBranch}/>}
    {tab === 'batches' && <BatchesSection {...props} onShowBranches={() => setTab('branches')}/>}
    {tab === 'instructors' && canSetupInstructorProfiles(ctx) && <InstructorProfilesSection {...props} onShowBatches={() => setTab('batches')}/>}
  </>;
}

/* ---------------- public admission ---------------- */

const emptyAdmissionForm = (profile = {}, admission = null) => {
  const nameParts = String(profile.name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: admission?.firstName || nameParts[0] || '',
    lastName: admission?.lastName || nameParts.slice(1).join(' ') || '',
    dob: admission?.dob || '',
    phone: admission?.phone || '',
    subject: admission?.subject || '',
    email: admission?.email || profile.email || '',
    address: admission?.address || '',
    pinCode: admission?.pinCode || '',
    referredBy: admission?.referredBy || '',
    yogaExperience: admission?.yogaExperience || '',
    medicalPhysicalIssue: admission?.medicalPhysicalIssue || '',
    reasonToJoin: admission?.reasonToJoin || '',
  };
};

export function PublicAdmissionPanel({erp, admissionCode, admissionBranchId = '', profile = {}, notify}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [target, setTarget] = useState(null);
  const [admission, setAdmission] = useState(null);
  const [form, setForm] = useState(() => emptyAdmissionForm(profile));
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    if (!admissionCode || !erp.client?.getMyAdmission) return;
    setLoading(true);
    setLoadError('');
    try {
      const result = await erp.client.getMyAdmission(admissionCode, admissionBranchId);
      const nextAdmission = result.admission || null;
      setTarget(result.target || null);
      setAdmission(nextAdmission);
      setForm(emptyAdmissionForm(
        {...profile, email: result.applicantEmail || profile.email || ''},
        nextAdmission,
      ));
      setSubmitted(nextAdmission?.status === 'pending');
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  }, [admissionBranchId, admissionCode, erp.client, profile.email, profile.name]);

  useEffect(() => { load(); }, [load]);

  const setField = (field, value) => setForm(current => ({...current, [field]: value}));
  const preferredBranchId = admissionBranchId || target?.branchId || admission?.branchId || '';
  const preferredBranchName = target?.branchName || admission?.branchName || '';
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setSubmitError('');
    try {
      const saved = await erp.client.submitAdmission({
        code: admissionCode, branchId: preferredBranchId, ...form,
      });
      setAdmission(saved);
      setForm(emptyAdmissionForm(profile, saved));
      setSubmitted(true);
      notify?.('Admission submitted. The studio will review and confirm it.');
    } catch (error) {
      setSubmitError(error);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <section className="erp-panel admission-panel"><p>Loading the admission form…</p></section>;
  }
  if (loadError) {
    return <section className="erp-panel admission-panel">
      <ErrorNotice error={loadError} context="Load admission form" onRetry={load}/>
    </section>;
  }
  if (admission?.status === 'confirmed') {
    return <section className="erp-panel admission-panel">
      <span className="erp-badge green">Admission confirmed</span>
      <h2>Your Student portal is ready</h2>
      <p>The studio has created your student record and linked this sign-in account. Press Retry to open your personal Student portal. If it does not open, contact the studio to check the portal link.</p>
      <button className="primary-button" onClick={erp.load}>Retry</button>
    </section>;
  }

  return <section className="erp-panel admission-panel">
    <div className="erp-panel-head"><div>
      <h2>Your details</h2>
      <p>{target?.organizationName ? `Apply to ${target.organizationName}. ` : ''}Complete this form for studio review. {preferredBranchId
        ? 'This branch link pre-selects your preferred branch; a manager confirms the final branch and joining date.'
        : 'A manager selects your branch and joining date when confirming the admission.'}</p>
    </div>{admission?.status && <span className={`erp-badge ${admission.status === 'pending' ? 'amber' : 'red'}`}>{admission.status}</span>}</div>

    {preferredBranchId && <div className="erp-banner blue" role="status">
      <MapPin size={18}/><span><b>Preferred branch:</b> {preferredBranchName || 'Selected by this branch admission link'}. The studio will see this preference with your request.</span>
    </div>}

    {submitted && admission?.status === 'pending' && <div className="erp-banner blue" role="status">
      <Check size={18}/><span><b>Admission submitted — pending studio confirmation.</b><br/>You may update the details below until the studio confirms or rejects the request.</span>
    </div>}
    {admission?.status === 'rejected' && <div className="erp-banner" role="status">
      <AlertCircle size={18}/><span><b>The studio could not confirm this admission.</b>{admission.reviewNote ? ` ${admission.reviewNote}` : ''} You may correct the form and submit it again.</span>
    </div>}
    {submitError && <ErrorNotice error={submitError} context="Submit admission"/>}

    <form className="erp-form admission-form" onSubmit={submit}>
      <label className="erp-field">First Name *
        <input required autoComplete="given-name" maxLength={80} value={form.firstName} onChange={e => setField('firstName', e.target.value)}/>
      </label>
      <label className="erp-field">Last Name *
        <input required autoComplete="family-name" maxLength={80} value={form.lastName} onChange={e => setField('lastName', e.target.value)}/>
      </label>
      <label className="erp-field">Date Of Birth *
        <input required type="date" autoComplete="bday" value={form.dob} onChange={e => setField('dob', e.target.value)}/>
      </label>
      <label className="erp-field">Phone Number *
        <input required type="tel" autoComplete="tel" inputMode="tel" maxLength={25} value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="9876543210"/>
      </label>
      <label className="erp-field full">Subject *
        <input required maxLength={160} value={form.subject} onChange={e => setField('subject', e.target.value)} placeholder="Ex. New Admission in Personal yoga session"/>
      </label>
      <label className="erp-field full">Your Email *
        <input required readOnly type="email" autoComplete="email" value={form.email}/>
        <small>This is your confirmed sign-in email. The studio will grant Student portal access to this same account.</small>
      </label>
      <label className="erp-field full">Address *
        <textarea required rows={3} maxLength={500} autoComplete="street-address" value={form.address} onChange={e => setField('address', e.target.value)}/>
      </label>
      <label className="erp-field">Pin Code *
        <input required inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{6}" maxLength={6} value={form.pinCode} onChange={e => setField('pinCode', e.target.value)} placeholder="410206"/>
      </label>
      <label className="erp-field">Reference by
        <input maxLength={120} value={form.referredBy} onChange={e => setField('referredBy', e.target.value)}/>
      </label>
      <fieldset className="erp-field full admission-experience">
        <legend>Experience in yoga *</legend>
        <div className="admission-radio-row">{YOGA_EXPERIENCE_OPTIONS.map(option => <label key={option.value}>
          <input required type="radio" name="yoga-experience" value={option.value} checked={form.yogaExperience === option.value} onChange={() => setField('yogaExperience', option.value)}/>
          <span>{option.label}</span>
        </label>)}</div>
      </fieldset>
      <label className="erp-field full">Medical / Physical issue *
        <textarea required rows={4} maxLength={2000} value={form.medicalPhysicalIssue} onChange={e => setField('medicalPhysicalIssue', e.target.value)} placeholder="Write “None” if you have no medical or physical issue."/>
        <small><b>Medical:</b> diagnosis, treatment and prevention of illness or injury. <b>Physical:</b> body structure, function, movement and fitness. Only authorized studio managers can view this field; Instructors cannot.</small>
      </label>
      <label className="erp-field full">Reasons to join yoga *
        <textarea required rows={4} maxLength={2000} value={form.reasonToJoin} onChange={e => setField('reasonToJoin', e.target.value)}/>
      </label>
      <div className="erp-form-actions">
        <button className="primary-button" disabled={busy}>{busy ? 'Submitting…' : admission?.status === 'pending' ? 'Update admission' : 'Submit admission'}</button>
      </div>
    </form>
  </section>;
}

/* ---------------- students ---------------- */

function portalAccessMeta(student) {
  const status = student?.portalAccessStatus || 'unknown';
  if (status === 'active' && student?.status !== 'active') {
    return {status, label: 'Portal linked · student inactive', className: 'amber'};
  }
  if (status === 'active') return {status, label: 'Portal active', className: 'green'};
  if (status === 'suspended') return {status, label: 'Portal suspended', className: 'amber'};
  if (status === 'none') return {status, label: 'No portal access', className: 'grey'};
  return {status, label: 'Access status unavailable', className: 'amber'};
}

function StudentAccessDialog({student, erp, notify, onClose}) {
  const meta = portalAccessMeta(student);
  const [email, setEmail] = useState(student.portalAccessEmail || student.email || '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const grantBlocked = busy || student.status !== 'active' || Boolean(student.syncPending);
  const revokeBlocked = busy || Boolean(student.syncPending);

  const run = async (action, successMessage) => {
    setBusy(true);
    try {
      const next = await action(erp.client);
      if (next) erp.setData(next);
      notify(successMessage);
      onClose();
      return true;
    } catch (err) {
      notify(err, {type: 'error', context: 'Update student portal access', fallbackMessage: 'Student portal access could not be updated.'});
      return false;
    } finally {
      setBusy(false);
    }
  };
  const grant = e => {
    e.preventDefault();
    return run(
      c => c.grantStudentAccess({studentId: student.id, email}),
      `Student portal access granted for ${student.fullName}. They can sign in now and press Retry/Sync if the app is already open.`,
    );
  };
  const revoke = () => run(
    c => c.revokeStudentAccess(student.id),
    `Student portal access removed for ${student.fullName}.`,
  );

  return <Dialog title="Student portal access" sub={`${student.fullName} will see only their own batches, attendance, membership, dues, payments and invoices.`} onClose={onClose}>
    <div style={{display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16}}>
      <span className={`erp-badge ${meta.className}`}>{meta.label}</span>
      {student.portalAccessEmail && <span style={{fontSize: 13}}>Linked sign-in: <b>{student.portalAccessEmail}</b></span>}
    </div>

    <form className="erp-form" onSubmit={grant}>
      <label className="erp-field full">Student sign-in email
        <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="student@example.com"/>
      </label>
      <div className="erp-banner blue" role="note" style={{gridColumn: '1 / -1', margin: 0}}>
        <KeyRound size={18}/>
        <div><b>Before granting access</b>
          <ol style={{margin: '6px 0 0 18px', padding: 0}}>
            <li>The student creates a Yoga Studio account with this exact email.</li>
            <li>The student opens the confirmation link sent to that email.</li>
            <li>The student must <b>not</b> create their own organization.</li>
          </ol>
          <span>Changing the email here replaces the previously linked sign-in. This access change requires internet and is not saved in the offline queue.</span>
        </div>
      </div>
      {meta.status === 'unknown' && <div className="erp-banner" role="note" style={{gridColumn: '1 / -1', margin: 0}}>
        <AlertCircle size={18}/><span>The current snapshot does not include portal status. If granting fails, run the latest <b>supabase/erp_setup.sql</b> (SQL v11) and try again.</span>
      </div>}
      {student.syncPending && <div className="erp-banner" role="note" style={{gridColumn: '1 / -1', margin: 0}}>
        <AlertCircle size={18}/><span>This student record is still waiting to sync. Connect to the internet and finish syncing before changing portal access.</span>
      </div>}
      {student.status !== 'active' && <div className="erp-banner" role="note" style={{gridColumn: '1 / -1', margin: 0}}>
        <AlertCircle size={18}/><span>This student is inactive, so portal sign-in is blocked. Reactivate the student record before granting access; an existing link becomes usable again when the record is reactivated.</span>
      </div>}
      <div className="erp-form-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        <button className="primary-button" disabled={grantBlocked}>{busy ? 'Saving…' : meta.status === 'active' ? 'Update access' : 'Grant access'}</button>
      </div>
    </form>

    {meta.status === 'active' && <div style={{borderTop: '1px solid var(--border, #e7dff0)', marginTop: 20, paddingTop: 16}}>
      {!confirmRemove ? <div style={{display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap'}}>
        <span style={{fontSize: 13}}>Remove this student’s sign-in link without deleting their account or student record.</span>
        <button type="button" className="secondary-button erp-danger" disabled={revokeBlocked} onClick={() => setConfirmRemove(true)}>Remove access</button>
      </div> : <div className="erp-banner" role="alert" style={{margin: 0}}>
        <AlertCircle size={18}/>
        <div style={{flex: 1}}><b>Remove portal access for {student.fullName}?</b><br/>
          Their account will stop loading this studio on the next online Retry/Sync. Studio records and payment history are not deleted.
          <div className="erp-actions" style={{marginTop: 10}}>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep access</button>
            <button type="button" className="primary-button" disabled={revokeBlocked} onClick={revoke}>{busy ? 'Removing…' : 'Yes, remove access'}</button>
          </div>
        </div>
      </div>}
    </div>}
  </Dialog>;
}

function AdmissionQrDialog({item, onClose}) {
  const [qrUrl, setQrUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(item.url, {width: 420, margin: 2, errorCorrectionLevel: 'M'})
      .then(url => { if (active) setQrUrl(url); })
      .catch(qrError => { if (active) setError({
        title: 'QR code could not be generated',
        message: 'The admission link itself is still valid, but this browser could not create its QR image.',
        solution: 'Use Copy, Share or WhatsApp for the same link. You can also close and reopen the QR dialog to try generating it again.',
        technical: qrError?.message || 'QR generation failed.',
      }); });
    return () => { active = false; };
  }, [item.url]);

  return <Dialog title={`${item.label} QR code`} sub="Print this QR code or show it at the studio. It opens the account-first admission form; it does not grant access by itself." onClose={onClose}>
    <div className="admission-qr-box">
      {qrUrl
        ? <img src={qrUrl} alt={`QR code for ${item.label}`}/>
        : error ? <ErrorNotice error={error} context="Generate admission QR code"/> : <p>Generating QR code…</p>}
      <strong>{item.label}</strong>
      <small>{item.url}</small>
    </div>
    <div className="erp-form-actions">
      {qrUrl && <a className="secondary-button" href={qrUrl} download={`${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-admission-qr.png`}>
        <Download size={15}/> Download QR
      </a>}
      <button type="button" className="primary-button" onClick={onClose}>Done</button>
    </div>
  </Dialog>;
}

function EnrollmentWizardDialog({
  erp, ctx, notify, onClose, initialBatch = null, fixedStudent = null, onComplete,
}) {
  const {data} = erp;
  const today = toISODate();
  const isInstructor = ctx.role === 'instructor';
  const billing = billingSettingsOf(data);
  const eligibleBatches = data.batches
    .filter(batch => batch.status === 'active' && inBranch(ctx, batch.branchId)
      && (!isInstructor || batch.instructorId === ctx.instructorId))
    .sort((a, b) => branchName(data, a.branchId).localeCompare(branchName(data, b.branchId))
      || String(a.startTime || '').localeCompare(String(b.startTime || ''))
      || a.name.localeCompare(b.name));
  const eligibleStudents = data.students
    .filter(student => student.status === 'active' && inBranch(ctx, student.branchId))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const planOptions = data.plans
    .filter(plan => plan.status !== 'archived')
    .sort((a, b) => normalizePlanType(a.planType).localeCompare(normalizePlanType(b.planType))
      || a.name.localeCompare(b.name));
  const setupVersion = Number(erp.remoteContext?.setupVersion || 0);
  const instructorPlanSetupOutdated = isInstructor
    && erp.client?.mode === 'supabase'
    && Boolean(erp.remoteContext)
    && setupVersion < 11;
  const firstExistingStudent = eligibleStudents.find(student => (
    !initialBatch || student.branchId === initialBatch.branchId
  )) || eligibleStudents[0] || null;
  const firstPlan = planOptions[0] || null;
  const firstTemplate = normalizePlanTemplate(firstPlan || {});

  const grossDueFor = (plan, amountPaise = plan?.amountPaise || 0) => payableBalance(
    {id: 'enrollment-preview', amountPaise: Number(amountPaise) || 0, startDate: today, endDate: today},
    [], billing, today,
  ).due;

  const [studentMode, setStudentMode] = useState(fixedStudent ? 'fixed' : (firstExistingStudent ? 'existing' : 'new'));
  const [studentId, setStudentId] = useState(fixedStudent?.id || firstExistingStudent?.id || '');
  const [existingQuery, setExistingQuery] = useState('');
  const [newStudent, setNewStudent] = useState({
    firstName: '', lastName: '', phone: '', email: '', gender: '', dob: '',
    branchId: fixedStudent?.branchId || initialBatch?.branchId
      || (ctx.branchId !== 'all' ? ctx.branchId : (data.branches.find(branch => branch.status !== 'archived')?.id || '')),
    joiningDate: fixedStudent?.joiningDate || today,
  });
  const [assignBatch, setAssignBatch] = useState(true);
  const [batchId, setBatchId] = useState(
    initialBatch?.id
    || eligibleBatches.find(batch => !fixedStudent || batch.branchId === fixedStudent.branchId)?.id
    || eligibleBatches[0]?.id
    || '',
  );
  const [enrollmentDate, setEnrollmentDate] = useState(fixedStudent?.joiningDate || today);
  const [createPlan, setCreatePlan] = useState(Boolean(firstPlan));
  const [planId, setPlanId] = useState(firstPlan?.id || '');
  const [planStartDate, setPlanStartDate] = useState(fixedStudent?.joiningDate || today);
  const [billingCycle, setBillingCycle] = useState(firstTemplate.billingCycle);
  const [autoRenew, setAutoRenew] = useState(firstTemplate.renewalEnabledDefault);
  const [planAmountRupees, setPlanAmountRupees] = useState(firstPlan ? paiseToRupees(firstPlan.amountPaise) : '');
  const [collectNow, setCollectNow] = useState(Boolean(firstPlan));
  const [paymentAmountRupees, setPaymentAmountRupees] = useState(
    firstPlan ? paiseToRupees(grossDueFor(firstPlan)) : '',
  );
  const [paymentMethod, setPaymentMethod] = useState('upi');
  const [paidOn, setPaidOn] = useState(today);
  const [paymentNote, setPaymentNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({
    studentId: fixedStudent?.id || '',
    membershipId: '',
    paymentId: '',
    steps: fixedStudent ? ['Student confirmed'] : [],
  });
  const [completed, setCompleted] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [stepError, setStepError] = useState('');

  const fixedRecord = fixedStudent
    ? (data.students.find(student => student.id === fixedStudent.id) || fixedStudent)
    : null;
  const selectedExistingStudent = studentMode === 'existing'
    ? data.students.find(student => student.id === studentId) || null
    : null;
  const existingStudentOptions = eligibleStudents.filter(student => {
    const needle = existingQuery.trim().toLocaleLowerCase('en-IN');
    return !needle || `${student.fullName} ${student.phone || ''} ${student.email || ''}`
      .toLocaleLowerCase('en-IN').includes(needle);
  });
  const selectedBatch = data.batches.find(batch => batch.id === batchId) || null;
  const studentBranchId = fixedRecord?.branchId || selectedExistingStudent?.branchId
    || (assignBatch && selectedBatch ? selectedBatch.branchId : newStudent.branchId);
  const batchOptions = eligibleBatches.filter(batch => (
    !studentBranchId || studentMode === 'new' || batch.branchId === studentBranchId
  ));
  const effectiveBatch = batchOptions.find(batch => batch.id === batchId) || batchOptions[0] || null;
  const resolvedStudentId = progress.studentId || fixedRecord?.id || selectedExistingStudent?.id || '';
  const alreadyEnrolled = Boolean(resolvedStudentId && effectiveBatch && data.enrollments.some(enrollment => (
    enrollment.studentId === resolvedStudentId && enrollment.batchId === effectiveBatch.id
      && enrollment.status === 'active'
  )));
  const fill = effectiveBatch ? batchFill(effectiveBatch, data.enrollments) : null;
  const selectedPlan = planOptions.find(plan => plan.id === planId) || planOptions[0] || null;
  const selectedTemplate = normalizePlanTemplate(selectedPlan || {});
  const planAmountPaise = isInstructor
    ? (selectedPlan?.amountPaise || 0)
    : rupeesToPaise(planAmountRupees);
  const suggestedGrossDue = selectedPlan ? grossDueFor(selectedPlan, planAmountPaise) : 0;
  const currentPeriod = resolvedStudentId ? data.memberships.find(membership => (
    membership.studentId === resolvedStudentId && membership.status !== 'cancelled'
      && ['active', 'paused', 'scheduled'].includes(subscriptionLifecycle(membership, today).id)
  )) : null;
  const started = progress.steps.length > (fixedStudent ? 1 : 0);
  const completedStudent = progress.studentId
    ? data.students.find(student => student.id === progress.studentId) || fixedRecord
    : fixedRecord || selectedExistingStudent;
  const completedMembership = progress.membershipId
    ? data.memberships.find(membership => membership.id === progress.membershipId) || null
    : null;
  const completedPayment = progress.paymentId
    ? data.payments.find(payment => payment.id === progress.paymentId) || null
    : null;

  useEffect(() => {
    if (!started && batchOptions.length > 0 && !batchOptions.some(batch => batch.id === batchId)) {
      setBatchId(batchOptions[0].id);
    }
  }, [batchId, batchOptions, started]);

  const mustAssignBatch = isInstructor || assignBatch;
  const displayStudentName = studentMode === 'new'
    ? [newStudent.firstName.trim(), newStudent.lastName.trim()].filter(Boolean).join(' ')
    : (fixedRecord?.fullName || selectedExistingStudent?.fullName || '');
  const displayStudentBranchId = fixedRecord?.branchId || selectedExistingStudent?.branchId
    || (mustAssignBatch ? effectiveBatch?.branchId : newStudent.branchId) || '';
  const planEndDate = selectedPlan
    ? membershipEnd(planStartDate, selectedTemplate.durationMonths, isInstructor ? selectedTemplate.billingCycle : billingCycle)
    : '';
  const paymentAmountPaise = rupeesToPaise(paymentAmountRupees);
  const balanceAfterPayment = collectNow
    ? Math.max(0, suggestedGrossDue - paymentAmountPaise)
    : suggestedGrossDue;
  const overpaymentPaise = collectNow ? Math.max(0, paymentAmountPaise - suggestedGrossDue) : 0;
  const nextBatchClassDate = effectiveBatch
    ? nextUpcomingBatchDate(effectiveBatch, enrollmentDate > today ? enrollmentDate : today)
    : '';
  const selectedExistingBatchNames = selectedExistingStudent
    ? data.enrollments
      .filter(enrollment => enrollment.studentId === selectedExistingStudent.id && enrollment.status === 'active')
      .map(enrollment => data.batches.find(batch => batch.id === enrollment.batchId)?.name)
      .filter(Boolean)
    : [];
  const normalizePhoneForMatch = value => {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  };
  const possibleDuplicateStudent = studentMode === 'new' ? data.students.find(student => {
    if (student.status !== 'active') return false;
    const email = newStudent.email.trim().toLocaleLowerCase('en-IN');
    const phone = normalizePhoneForMatch(newStudent.phone);
    return (email && String(student.email || '').trim().toLocaleLowerCase('en-IN') === email)
      || (phone.length >= 10 && normalizePhoneForMatch(student.phone) === phone);
  }) || null : null;

  const validateStudentStep = () => {
    if (fixedStudent) return '';
    if (studentMode === 'existing') {
      return selectedExistingStudent ? '' : 'Choose an existing active student to continue.';
    }
    if (!newStudent.firstName.trim()) return 'Enter the new student’s first name.';
    const phone = newStudent.phone.trim();
    if (phone && !/^[+0-9][0-9 ()-]{6,24}$/.test(phone)) return 'Enter a valid phone number, or leave Phone Number blank.';
    const email = newStudent.email.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Enter a valid email address, or leave Email blank.';
    if (newStudent.dob && (newStudent.dob < '1900-01-01' || newStudent.dob > today)) return 'Enter a valid date of birth, or leave it blank.';
    if (!newStudent.joiningDate) return 'Choose the student joining date.';
    if (!mustAssignBatch && !newStudent.branchId) return 'Choose the student branch, or assign a batch in the next step.';
    return '';
  };
  const validateBatchStep = () => {
    if (!mustAssignBatch) return '';
    if (!effectiveBatch) {
      return isInstructor
        ? 'Choose one of your active batches before enrolling a student.'
        : 'Choose a batch, or turn off “Assign a batch now”.';
    }
    if (!enrollmentDate) return 'Choose the batch joining date.';
    if (studentBranchId && effectiveBatch.branchId !== studentBranchId) return 'The student and batch must belong to the same branch.';
    if (!alreadyEnrolled && fill?.seatsLeft <= 0) return `${effectiveBatch.name} is full. Choose another batch.`;
    return '';
  };
  const validatePlanStep = () => {
    if (!createPlan) return '';
    if (!selectedPlan) return 'Choose an active plan, or turn off the plan step.';
    if (!planStartDate) return 'Choose the plan start date.';
    if (planAmountPaise < 0) return 'Enter a valid plan amount.';
    return '';
  };
  const validatePaymentStep = () => {
    if (!collectNow) return '';
    if (!createPlan || !selectedPlan) return 'Payment in this guided flow needs the new subscription/pass step. Use Payments for an existing due.';
    if (suggestedGrossDue <= 0) return 'This plan has no amount due. Turn off “Collect payment now” to finish without a payment.';
    if (paymentAmountPaise <= 0) return 'Enter the actual amount received.';
    if (!paidOn) return 'Choose the payment date.';
    return '';
  };
  const stepValidators = [validateStudentStep, validateBatchStep, validatePlanStep, validatePaymentStep];
  const stepValidity = stepValidators.map(validate => !validate());
  const wizardSteps = [
    {id: 'student', label: 'Student', caption: displayStudentName || 'Choose or create', icon: Users},
    {id: 'batch', label: 'Batch', caption: mustAssignBatch ? (effectiveBatch?.name || 'Choose batch') : 'No batch now', icon: Clock},
    {id: 'plan', label: 'Plan', caption: createPlan && selectedPlan ? selectedPlan.name : 'No new plan', icon: Repeat},
    {id: 'payment', label: 'Payment & review', caption: collectNow ? `Collect ${formatINR(paymentAmountPaise)}` : 'Review & finish', icon: IndianRupee},
  ];

  const goToStep = nextStep => {
    if (busy || completed) return;
    const target = Math.max(0, Math.min(3, nextStep));
    if (started && target !== 3) return;
    for (let index = 0; index < target; index += 1) {
      const validationError = stepValidators[index]();
      if (validationError) {
        setWizardStep(index);
        setStepError(validationError);
        return;
      }
    }
    setStepError('');
    setWizardStep(target);
  };
  const goNextStep = () => goToStep(wizardStep + 1);
  const goBackStep = () => {
    if (busy || started) return;
    setStepError('');
    setWizardStep(current => Math.max(0, current - 1));
  };
  const usePossibleDuplicateStudent = () => {
    if (!possibleDuplicateStudent || started) return;
    setStudentMode('existing');
    setExistingQuery('');
    chooseExistingStudent(possibleDuplicateStudent.id);
    setStepError('');
  };

  const choosePlan = nextPlanId => {
    const plan = planOptions.find(item => item.id === nextPlanId) || null;
    const template = normalizePlanTemplate(plan || {});
    setPlanId(nextPlanId);
    setBillingCycle(template.billingCycle);
    setAutoRenew(template.renewalEnabledDefault);
    setPlanAmountRupees(plan ? paiseToRupees(plan.amountPaise) : '');
    setPaymentAmountRupees(plan ? paiseToRupees(grossDueFor(plan)) : '');
  };

  // Plans can arrive after this dialog has mounted (first snapshot/sync),
  // or the initially selected plan can be archived by a refresh. Keep the
  // controlled select pointed at a real active plan instead of leaving the
  // Step 3 toggle permanently disabled with an empty planId.
  useEffect(() => {
    if (started || planOptions.length === 0 || planOptions.some(plan => plan.id === planId)) return;
    const hadNoPlanSelected = !planId;
    choosePlan(planOptions[0].id);
    if (hadNoPlanSelected) {
      setCreatePlan(true);
      setCollectNow(true);
    }
  }, [planId, planOptions, started]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseExistingStudent = nextStudentId => {
    setStudentId(nextStudentId);
    setProgress(current => ({...current, studentId: '', membershipId: '', paymentId: '', steps: []}));
    const student = data.students.find(item => item.id === nextStudentId);
    if (student && effectiveBatch && effectiveBatch.branchId !== student.branchId) {
      const nextBatch = eligibleBatches.find(batch => batch.branchId === student.branchId);
      setBatchId(nextBatch?.id || '');
    }
  };

  const chooseBatch = nextBatchId => {
    setBatchId(nextBatchId);
    const batch = data.batches.find(item => item.id === nextBatchId);
    if (!batch) return;
    if (studentMode === 'new') setNewStudent(current => ({...current, branchId: batch.branchId}));
    if (studentMode === 'existing' && selectedExistingStudent?.branchId !== batch.branchId) {
      const nextStudent = eligibleStudents.find(student => student.branchId === batch.branchId);
      setStudentId(nextStudent?.id || '');
    }
  };

  const applySnapshot = next => { if (next) erp.setData(next); };

  const submit = async event => {
    event.preventDefault();
    if (wizardStep < 3) {
      goNextStep();
      return;
    }
    setError('');
    setStepError('');
    for (let index = 0; index < stepValidators.length; index += 1) {
      const validationError = stepValidators[index]();
      if (validationError) {
        setWizardStep(index);
        setStepError(validationError);
        return;
      }
    }

    setBusy(true);
    let workingProgress = {...progress, steps: [...progress.steps]};
    const markStep = step => {
      if (!workingProgress.steps.includes(step)) {
        workingProgress = {...workingProgress, steps: [...workingProgress.steps, step]};
      }
      setProgress(workingProgress);
    };
    try {
      let finalStudentId = workingProgress.studentId || fixedRecord?.id || selectedExistingStudent?.id || '';
      const finalBranchId = effectiveBatch?.branchId || studentBranchId;
      if (studentMode === 'new' && !finalStudentId) {
        finalStudentId = newClientUuid();
        const firstName = newStudent.firstName.trim();
        const lastName = newStudent.lastName.trim();
        applySnapshot(await erp.client.saveStudent({
          id: finalStudentId,
          branchId: finalBranchId,
          firstName, lastName, fullName: [firstName, lastName].filter(Boolean).join(' '),
          phone: newStudent.phone.trim(), email: newStudent.email.trim(),
          gender: newStudent.gender, dob: newStudent.dob,
          joiningDate: newStudent.joiningDate || today, status: 'active',
          notes: '', address: '', pinCode: '', admissionSubject: '', referredBy: '',
          yogaExperience: '', medicalPhysicalIssue: '', reasonToJoin: '',
          ...(isInstructor && effectiveBatch ? {walkInBatchId: effectiveBatch.id} : {}),
        }));
        workingProgress = {...workingProgress, studentId: finalStudentId};
        setProgress(workingProgress);
        markStep('Student created');
      }

      if (mustAssignBatch && effectiveBatch && !alreadyEnrolled
          && !workingProgress.steps.includes('Batch assigned')) {
        applySnapshot(await erp.client.enrollStudent({
          batchId: effectiveBatch.id, studentId: finalStudentId, joinedOn: enrollmentDate,
        }));
        markStep('Batch assigned');
      }

      let membershipId = workingProgress.membershipId || '';
      if (createPlan && selectedPlan && !membershipId) {
        membershipId = newClientUuid();
        applySnapshot(await erp.client.saveMembership({
          id: membershipId,
          studentId: finalStudentId, planId: selectedPlan.id, branchId: finalBranchId,
          startDate: planStartDate,
          billingCycle: isInstructor ? selectedTemplate.billingCycle : billingCycle,
          durationMonths: selectedTemplate.durationMonths,
          amountPaise: planAmountPaise, status: 'active',
          offeringType: selectedTemplate.planType,
          autoRenew: selectedTemplate.planType === 'one_month'
            ? false
            : (isInstructor ? selectedTemplate.renewalEnabledDefault : autoRenew),
          previousMembershipId: '', renewalNumber: 0, totalPausedDays: 0,
          pausedFrom: '', pausedUntil: '', pauseReason: '', cancelledAt: null, cancelReason: '',
        }));
        workingProgress = {...workingProgress, membershipId};
        setProgress(workingProgress);
        markStep(selectedTemplate.planType === 'one_month' ? 'One-month pass created' : 'Subscription created');
      }

      let paymentId = workingProgress.paymentId || '';
      if (collectNow && membershipId && !workingProgress.steps.includes('Payment recorded')) {
        paymentId = paymentId || newClientUuid();
        applySnapshot(await erp.client.recordPayment({
          id: paymentId, membershipId, studentId: finalStudentId, branchId: finalBranchId,
          amountPaise: rupeesToPaise(paymentAmountRupees), method: paymentMethod,
          paidOn, note: paymentNote.trim(),
        }));
        workingProgress = {...workingProgress, paymentId};
        setProgress(workingProgress);
        markStep('Payment recorded');
      }

      const summary = workingProgress.steps.length
        ? `Enrolment complete: ${workingProgress.steps.join(' · ')}.`
        : 'Enrolment updated.';
      setProgress(workingProgress);
      setCompleted(true);
      notify?.(summary);
      onComplete?.({studentId: finalStudentId, batchId: effectiveBatch?.id || '', membershipId, paymentId});
    } catch (submitError) {
      setProgress(workingProgress);
      setWizardStep(3);
      setError(submitError || new Error('The enrolment could not be completed.'));
    } finally {
      setBusy(false);
    }
  };

  return <>
  <Dialog
    title={completed ? 'Enrolment complete' : fixedStudent ? 'Complete enrolment' : 'Enroll student'}
    sub={completed
      ? 'The enrolment is saved. Review the student, batch, plan and payment details below.'
      : isInstructor
        ? 'A four-step flow for a basic walk-in or existing student in your own batch, with an optional plan-price payment.'
        : 'Student, batch, plan and payment in one clear four-step flow.'}
    onClose={onClose}
    className="erp-dialog-wide enrollment-wizard-dialog enrollment-wizard-v2"
  >
    {error && <ErrorNotice error={error} context="Complete enrolment"/>}
    {progress.steps.length > 0 && <div className="erp-banner blue" role="status">
      <BadgeCheck size={18}/><span><b>Completed:</b> {progress.steps.join(' · ')}</span>
    </div>}
    {!completed && wizardStep === 2 && currentPeriod && createPlan && <div className="erp-banner" role="note">
      <AlertCircle size={18}/><span>This student already has a current {membershipKindLabel(data, currentPeriod).toLowerCase()} period ({formatDate(currentPeriod.startDate)} → {formatDate(currentPeriod.endDate)}). Create another period only if that is intentional; otherwise turn off the plan step and collect the existing due from Payments.</span>
    </div>}

    {completed ? <section className="enrollment-complete" aria-label="Enrolment complete">
      <div className="enrollment-complete-icon"><BadgeCheck size={28}/></div>
      <h3>Enrolment complete</h3>
      <p>{completedStudent?.fullName || 'The student'} is ready{effectiveBatch ? ` in ${effectiveBatch.name}` : ''}. Review the final invoice or receipt before closing.</p>
      <dl className="enrollment-complete-details">
        <div><dt>Student</dt><dd>{completedStudent?.fullName || 'Student saved'}</dd></div>
        <div><dt>Batch</dt><dd>{effectiveBatch ? `${effectiveBatch.name} · ${branchName(data, effectiveBatch.branchId)}` : 'No batch assigned'}</dd></div>
        <div><dt>Plan</dt><dd>{completedMembership ? `${planName(data, completedMembership.planId)} · ${formatDate(completedMembership.startDate)} → ${formatDate(completedMembership.endDate)}` : 'No new plan period'}</dd></div>
        <div><dt>Payment</dt><dd>{completedPayment
          ? `${formatINR(completedPayment.amountPaise)} · ${PAYMENT_METHODS.find(method => method.id === completedPayment.method)?.label || completedPayment.method} · ${completedPayment.receiptNo || 'Receipt pending sync'}`
          : 'No payment collected in this flow'}</dd></div>
      </dl>
      {completedPayment && !completedPayment.receiptNo && <p className="enrollment-warning">The payment is saved, but Supabase assigns the final receipt number after sync. Open Payments after the sync finishes to print the numbered receipt.</p>}
      <div className="erp-form-actions">
        {completedPayment?.receiptNo && <button type="button" className="secondary-button" onClick={() => setInvoice({type: 'payment', payment: completedPayment})}><Printer size={15}/> View receipt</button>}
        {completedMembership && payableBalance(completedMembership, data.payments, billing, today).due > 0 && <button type="button" className="secondary-button" onClick={() => setInvoice({type: 'due', membership: completedMembership})}><Printer size={15}/> View invoice</button>}
        <button type="button" className="primary-button" onClick={onClose}>Done</button>
      </div>
    </section> : <form className="enrollment-wizard-form" onSubmit={submit}>
      <div className="enrollment-wizard-shell">
        <aside className="enrollment-wizard-sidebar">
          <ol className="enrollment-progress" aria-label="Enrolment steps">
            {wizardSteps.map((step, index) => {
              const StepIcon = step.icon;
              const completeStep = index < wizardStep && stepValidity[index];
              return <li key={step.id} className={index === wizardStep ? 'active' : completeStep ? 'complete' : ''}>
                <button
                  type="button"
                  aria-current={index === wizardStep ? 'step' : undefined}
                  disabled={busy || (started && index !== wizardStep)}
                  onClick={() => goToStep(index)}
                >
                  <span className="enrollment-progress-icon">{completeStep ? <Check size={15}/> : <StepIcon size={15}/>}</span>
                  <span><strong>{index + 1}. {step.label}</strong><small>{step.caption}</small></span>
                </button>
              </li>;
            })}
          </ol>

          <div className="enrollment-live-summary" aria-label="Live enrolment summary">
            <div className="enrollment-live-summary-head">
              <span className="avatar">{initials(displayStudentName || 'New student')}</span>
              <div><small>Enrolling</small><strong>{displayStudentName || 'Choose a student'}</strong><span>{displayStudentBranchId ? branchName(data, displayStudentBranchId) : 'Branch to be selected'}</span></div>
            </div>
            <dl>
              <div><dt>Student</dt><dd>{fixedStudent ? 'Confirmed admission' : studentMode === 'new' ? 'New walk-in' : 'Existing student'}</dd></div>
              <div><dt>Batch</dt><dd>{mustAssignBatch && effectiveBatch ? `${effectiveBatch.name} · ${batchTimeLabel(effectiveBatch)}` : 'No batch now'}</dd></div>
              <div><dt>Plan</dt><dd>{createPlan && selectedPlan ? `${selectedPlan.name} · ${formatDate(planStartDate)} → ${formatDate(planEndDate)}` : 'No new plan period'}</dd></div>
              <div><dt>Payment</dt><dd>{collectNow ? `${formatINR(paymentAmountPaise)} by ${PAYMENT_METHODS.find(method => method.id === paymentMethod)?.label || paymentMethod}` : 'Not collecting now'}</dd></div>
            </dl>
            <div className="enrollment-live-total"><span>{collectNow ? 'Amount to collect' : createPlan ? 'Gross amount due' : 'Due in this flow'}</span><strong>{formatINR(collectNow ? paymentAmountPaise : createPlan ? suggestedGrossDue : 0)}</strong></div>
          </div>

          <div className="enrollment-scope-note">
            <BadgeCheck size={17}/>
            <p>{isInstructor
              ? 'Your access stays limited to your own batches. Plan price and terms are fixed by the studio; payment corrections are manager-only.'
              : 'Nothing is saved until the final step. You can go back and change any choice before finishing.'}</p>
          </div>
        </aside>

        <div className="enrollment-wizard-main">
          {stepError && <div className="erp-banner" role="alert"><AlertCircle size={18}/><span>{stepError}</span></div>}
          {wizardStep === 0 && <section className="enrollment-step" aria-labelledby="enrollment-student-heading">
            <div className="enrollment-step-head">
              <span className="enrollment-step-icon"><Users size={19}/></span>
              <div><small>Step 1 of 4</small><h3 id="enrollment-student-heading">Who is enrolling?</h3><p>{fixedStudent ? 'This confirmed student is ready for a batch and plan.' : 'Use an existing active student, or create a basic walk-in record.'}</p></div>
              {stepValidity[0] && <span className="erp-badge green"><Check size={12}/> Ready</span>}
            </div>
        {fixedStudent ? <div className="enrollment-fixed-student">
          <span className="avatar">{initials(fixedRecord?.fullName || fixedStudent.fullName || 'Student')}</span>
          <div><strong>{fixedRecord?.fullName || fixedStudent.fullName || 'Confirmed student'}</strong>
            <small>{branchName(data, fixedRecord?.branchId || fixedStudent.branchId)} · Admission confirmed & portal granted</small></div>
          <span className="erp-badge green">Student ready</span>
        </div> : <>
          <div className="enrollment-choice-grid" role="group" aria-label="Student type">
            <button type="button" aria-pressed={studentMode === 'existing'} className={`enrollment-choice-card ${studentMode === 'existing' ? 'selected' : ''}`} disabled={started} onClick={() => { setStudentMode('existing'); setStepError(''); }}>
              <span className="enrollment-choice-icon"><Users size={18}/></span>
              <span><strong>Existing student</strong><small>Search and select an active student already in Yoga Studio.</small></span>
              {studentMode === 'existing' && <Check size={17}/>}
            </button>
            <button type="button" aria-pressed={studentMode === 'new'} className={`enrollment-choice-card ${studentMode === 'new' ? 'selected' : ''}`} disabled={started} onClick={() => { setStudentMode('new'); setStepError(''); }}>
              <span className="enrollment-choice-icon"><UserPlus size={18}/></span>
              <span><strong>New walk-in student</strong><small>Create a basic record now; a manager can complete the full profile later.</small></span>
              {studentMode === 'new' && <Check size={17}/>}
            </button>
          </div>
          {studentMode === 'existing' ? <div className="erp-form enrollment-fields">
            <label className="erp-field">Search existing students
              <input value={existingQuery} disabled={started} onChange={event => setExistingQuery(event.target.value)} placeholder={isInstructor ? 'Search by student name…' : 'Name, phone or email…'}/>
            </label>
            <label className="erp-field">Existing student
              <select required value={studentId} disabled={started} onChange={event => chooseExistingStudent(event.target.value)}>
                <option value="">Choose student…</option>
                {existingStudentOptions.map(student => <option key={student.id} value={student.id}>
                  {student.fullName} · {branchName(data, student.branchId)}
                </option>)}
              </select>
              <small>{isInstructor
                ? 'Only identity details for students in your teaching branches are loaded.'
                : 'Only active students in your branch scope are shown.'}</small>
            </label>
            {selectedExistingStudent ? <div className="enrollment-selected-card">
              <span className="avatar">{initials(selectedExistingStudent.fullName)}</span>
              <div><strong>{selectedExistingStudent.fullName}</strong><small>{branchName(data, selectedExistingStudent.branchId)} · Joined {formatDate(selectedExistingStudent.joiningDate)}{selectedExistingBatchNames.length ? ` · Already in ${selectedExistingBatchNames.join(', ')}` : ' · Not in a batch yet'}</small></div>
              <span className="erp-badge green">Active</span>
            </div> : existingQuery && existingStudentOptions.length === 0 ? <p className="enrollment-warning full">No active student matches “{existingQuery}”. Clear the search or create a new walk-in student.</p> : null}
          </div> : <div className="erp-form enrollment-fields">
            <p className="enrollment-fields-note"><strong>Basic walk-in details.</strong> First Name and Joining date are required. Contact and personal details below are optional{isInstructor ? '; medical, address and admission details are not collected by Instructors.' : '.'}</p>
            {possibleDuplicateStudent && <div className="enrollment-duplicate-warning" role="note">
              <AlertCircle size={18}/>
              <span><strong>Possible existing student:</strong> {possibleDuplicateStudent.fullName} already uses this phone or email. Use the existing record unless this is a different person.</span>
              <button type="button" className="secondary-button" disabled={started} onClick={usePossibleDuplicateStudent}>Use existing student</button>
            </div>}
            <label className="erp-field">First Name
              <input required value={newStudent.firstName} disabled={started} onChange={event => setNewStudent({...newStudent, firstName: event.target.value})} autoComplete="given-name"/>
            </label>
            <label className="erp-field">Last Name
              <input value={newStudent.lastName} disabled={started} onChange={event => setNewStudent({...newStudent, lastName: event.target.value})} autoComplete="family-name"/>
            </label>
            <label className="erp-field">Phone Number
              <input type="tel" value={newStudent.phone} disabled={started} onChange={event => setNewStudent({...newStudent, phone: event.target.value})} autoComplete="tel" placeholder="10-digit mobile"/>
            </label>
            <label className="erp-field">Email
              <input type="email" value={newStudent.email} disabled={started} onChange={event => setNewStudent({...newStudent, email: event.target.value})} autoComplete="email"/>
            </label>
            <label className="erp-field">Gender
              <select value={newStudent.gender} disabled={started} onChange={event => setNewStudent({...newStudent, gender: event.target.value})}>
                <option value="">Prefer not to say</option><option>Female</option><option>Male</option><option>Other</option>
              </select>
            </label>
            <label className="erp-field">Date Of Birth
              <input type="date" value={newStudent.dob} disabled={started} onChange={event => setNewStudent({...newStudent, dob: event.target.value})}/>
            </label>
            <label className="erp-field">Joining date
              <input type="date" required value={newStudent.joiningDate} disabled={started} onChange={event => {
                const joiningDate = event.target.value;
                setNewStudent({...newStudent, joiningDate});
                if (joiningDate) {
                  setEnrollmentDate(joiningDate);
                  setPlanStartDate(joiningDate);
                }
              }}/>
              <small>Batch and plan start dates will follow this date; you can adjust them in later steps.</small>
            </label>
            {!isInstructor && <label className="erp-field">Student branch
              <select aria-label="Walk-in student branch" required value={(assignBatch ? effectiveBatch?.branchId : newStudent.branchId) || newStudent.branchId} disabled={started || Boolean(effectiveBatch && assignBatch)} onChange={event => setNewStudent({...newStudent, branchId: event.target.value})}>
                <option value="">Choose branch…</option>
                {data.branches.filter(branch => branch.status !== 'archived').map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
              {effectiveBatch && assignBatch && <small>Set from the selected batch.</small>}
            </label>}
          </div>}
        </>}
          </section>}

          {wizardStep === 1 && <section className="enrollment-step" aria-labelledby="enrollment-batch-heading">
            <div className="enrollment-step-head">
              <span className="enrollment-step-icon"><Clock size={19}/></span>
              <div><small>Step 2 of 4</small><h3 id="enrollment-batch-heading">Choose the batch</h3><p>{isInstructor ? 'Only active batches assigned to you can be selected.' : 'Assign the student now, or skip this and add a batch later.'}</p></div>
              {stepValidity[1] && <span className="erp-badge green"><Check size={12}/> Ready</span>}
            </div>
        <label className="erp-toggle-row">
          <input type="checkbox" checked={isInstructor || assignBatch} disabled={isInstructor || started} onChange={event => {
            const shouldAssignBatch = event.target.checked;
            setAssignBatch(shouldAssignBatch);
            if (!shouldAssignBatch && studentMode === 'new' && effectiveBatch) {
              setNewStudent(current => ({...current, branchId: effectiveBatch.branchId}));
            }
          }}/>
          <span>{isInstructor ? 'Assign to one of my batches (required for Instructor enrolment)' : 'Assign a batch now'}</span>
        </label>
        {(isInstructor || assignBatch) && <div className="erp-form enrollment-fields">
          <label className="erp-field full">Assign to batch
            <select required value={batchId} disabled={started} onChange={event => chooseBatch(event.target.value)}>
              <option value="">Choose batch…</option>
              {batchOptions.map(batch => {
                const optionFill = batchFill(batch, data.enrollments);
                const isAlready = resolvedStudentId && data.enrollments.some(enrollment => enrollment.batchId === batch.id && enrollment.studentId === resolvedStudentId && enrollment.status === 'active');
                return <option key={batch.id} value={batch.id} disabled={optionFill.seatsLeft <= 0 && !isAlready}>
                  {batch.name} · {branchName(data, batch.branchId)} · {batchDaySummary(batch)} · {batchTimeLabel(batch)} · {optionFill.enrolled}/{optionFill.capacity}
                </option>;
              })}
            </select>
            <small>{effectiveBatch
              ? `${instructorName(data, effectiveBatch.instructorId)} · ${fill?.seatsLeft ?? 0} seat(s) available${alreadyEnrolled ? ' · Student is already enrolled' : ''}`
              : 'No eligible active batch matches this student branch.'}</small>
          </label>
          <label className="erp-field">Batch joining date
            <input type="date" required value={enrollmentDate} disabled={started} onChange={event => setEnrollmentDate(event.target.value)}/>
          </label>
          {effectiveBatch ? <article className="enrollment-batch-preview">
            <div className="enrollment-batch-preview-head">
              <span className="enrollment-choice-icon"><Clock size={18}/></span>
              <div><strong>{effectiveBatch.name}</strong><small>{branchName(data, effectiveBatch.branchId)} · {instructorName(data, effectiveBatch.instructorId)}</small></div>
              <span className={`erp-badge ${alreadyEnrolled ? 'green' : fill?.seatsLeft <= 0 ? 'rose' : 'blue'}`}>{alreadyEnrolled ? 'Already enrolled' : `${fill?.seatsLeft ?? 0} seat(s) left`}</span>
            </div>
            <div className="enrollment-preview-meta">
              <span><CalendarDays size={14}/> {batchDaySummary(effectiveBatch)}</span>
              <span><Clock size={14}/> {batchTimeLabel(effectiveBatch)}</span>
              <span><CalendarClock size={14}/> Next class {nextBatchClassDate ? `${relativeClassDateLabel(nextBatchClassDate, today)} · ${formatDate(nextBatchClassDate)}` : 'not scheduled'}</span>
            </div>
            <div className="enrollment-capacity-row"><span>{fill?.enrolled ?? 0} of {fill?.capacity ?? 0} Students enrolled</span><span>{fill?.percent ?? 0}% full</span></div>
            <div className="erp-progress" aria-label={`${effectiveBatch.name} capacity`}><span className={fill?.seatsLeft <= 0 ? 'full' : ''} style={{width: `${Math.min(100, fill?.percent || 0)}%`}}/></div>
          </article> : <p className="enrollment-warning full">{isInstructor ? 'No active batch is assigned to you for this student branch.' : 'No eligible active batch matches this student branch.'}</p>}
        </div>}
        {!isInstructor && !assignBatch && <p className="enrollment-fields-note">The student will be saved without a batch. You can assign a batch later from Students or Branches &amp; batches. Make sure the Student branch on Step 1 is correct.</p>}
          </section>}

          {wizardStep === 2 && <section className="enrollment-step" aria-labelledby="enrollment-plan-heading">
            <div className="enrollment-step-head">
              <span className="enrollment-step-icon"><Repeat size={19}/></span>
              <div><small>Step 3 of 4</small><h3 id="enrollment-plan-heading">Choose the plan</h3><p>Start a subscription or one-month pass now, or skip and add it later from Subscriptions.</p></div>
              {stepValidity[2] && <span className="erp-badge green"><Check size={12}/> Ready</span>}
            </div>
        <label className="erp-toggle-row">
          <input type="checkbox" checked={createPlan} disabled={started || planOptions.length === 0} onChange={event => {
            const shouldCreatePlan = event.target.checked;
            setCreatePlan(shouldCreatePlan);
            if (shouldCreatePlan && selectedPlan && selectedPlan.id !== planId) choosePlan(selectedPlan.id);
            if (!shouldCreatePlan) setCollectNow(false);
          }}/>
          <span>Create subscription or one-month pass now</span>
        </label>
        {createPlan && selectedPlan && <div className="erp-form enrollment-fields">
          <label className="erp-field full">Plan
            <select required value={selectedPlan?.id || ''} disabled={started} onChange={event => choosePlan(event.target.value)}>
              <option value="" disabled>Choose plan…</option>
              {planOptions.map(plan => <option key={plan.id} value={plan.id}>
                {plan.name} · {planTypeLabel(plan)} · {formatINR(plan.amountPaise)} · {planBillingPeriodLabel(plan)}
              </option>)}
            </select>
          </label>
          <label className="erp-field">Plan start date
            <input type="date" required value={planStartDate} disabled={started} onChange={event => setPlanStartDate(event.target.value)}/>
          </label>
          <label className="erp-field">Billing cycle
            <select value={isInstructor ? selectedTemplate.billingCycle : billingCycle} disabled={started || isInstructor} onChange={event => setBillingCycle(event.target.value)}>
              <option value="joining">Joining date (monthly)</option><option value="calendar">Calendar month</option>
            </select>
            {isInstructor && <small>Uses the plan template set by Owner/Co-owner.</small>}
          </label>
          <label className="erp-field">Plan amount (₹{billing.gstEnabled && !billing.priceIncludesGst ? ', before GST' : ''})
            <input type="number" min={0} step="0.01" required readOnly={isInstructor} value={isInstructor ? paiseToRupees(selectedPlan.amountPaise) : planAmountRupees} onChange={event => {
              setPlanAmountRupees(event.target.value);
              if (collectNow) setPaymentAmountRupees(paiseToRupees(grossDueFor(selectedPlan, rupeesToPaise(event.target.value))));
            }}/>
            {isInstructor && <small>Instructors cannot discount or change plan prices.</small>}
          </label>
          <span className="erp-field">Plan ends
            <span className="enrollment-readonly">{formatDate(membershipEnd(planStartDate, selectedTemplate.durationMonths, isInstructor ? selectedTemplate.billingCycle : billingCycle))}</span>
          </span>
          {selectedTemplate.planType !== 'one_month' && <label className="erp-toggle-row full">
            <input type="checkbox" checked={isInstructor ? selectedTemplate.renewalEnabledDefault : autoRenew} disabled={started || isInstructor} onChange={event => setAutoRenew(event.target.checked)}/>
            <span>Renewal tracking enabled (manager-confirmed; no automatic charge)</span>
          </label>}
        </div>}
        {createPlan && selectedPlan && <article className="enrollment-plan-preview">
          <div><span className="enrollment-choice-icon"><Repeat size={18}/></span><div><strong>{selectedPlan.name}</strong><small>{planTypeLabel(selectedPlan)} · {planBillingPeriodLabel(selectedTemplate)}</small></div></div>
          <div className="enrollment-plan-price"><small>Gross amount due</small><strong>{formatINR(suggestedGrossDue)}</strong>{billing.gstEnabled && !billing.priceIncludesGst && <span>Includes GST added to the plan amount</span>}</div>
          <dl>
            <div><dt>Period</dt><dd>{formatDate(planStartDate)} → {formatDate(planEndDate)}</dd></div>
            <div><dt>Billing cycle</dt><dd>{(isInstructor ? selectedTemplate.billingCycle : billingCycle) === 'calendar' ? 'Calendar month' : 'Joining date (monthly)'}</dd></div>
            <div><dt>Renewal</dt><dd>{selectedTemplate.planType === 'one_month' ? 'One-month pass · no renewal tracking' : (isInstructor ? selectedTemplate.renewalEnabledDefault : autoRenew) ? 'Manager-confirmed renewal tracking' : 'No renewal tracking'}</dd></div>
          </dl>
        </article>}
        {planOptions.length === 0 && (erp.loading
          ? <p className="enrollment-fields-note"><strong>Loading plans…</strong> Wait for the studio snapshot to finish loading; the plan list will appear automatically if active plans exist.</p>
          : <ErrorNotice
            error={instructorPlanSetupOutdated ? {
              title: 'Instructor plans need the SQL v11 update',
              message: 'The connected Supabase setup is older than SQL v11. In the older snapshot, Owners could receive the plan list but Instructors received no plans, so Step 3 is empty for your Instructor account even though the Owner can see the plan.',
              solution: 'Ask the studio Owner to run the complete current supabase/erp_setup.sql (SQL v11) once in Supabase → SQL Editor. After it finishes, stay online and click “Reload plans” here or Sync now; active plans will then be included in the Instructor snapshot. Instructors still cannot create/edit plan templates.',
              technical: `Connected setupVersion: ${setupVersion || 'not reported by this older database'}; required: 11. Active/non-archived plans loaded for Instructor: 0`,
              severity: 'error',
            } : {
              title: 'No active plan is available yet',
              message: 'This studio snapshot does not contain an active subscription or one-month plan that can be selected for this enrolment.',
              solution: canManageOrg(ctx)
                ? 'Close this wizard, open Subscriptions → Plans, create or restore an active plan, then reopen Enroll student. If the plan was just created on another device, use Sync now first.'
                : 'Ask an Owner or Co-owner to create or restore an active plan in Subscriptions → Plans. If it was just created, reconnect and click “Reload plans” here (or Sync now), then continue this enrolment.',
              technical: 'Active/non-archived plans loaded in this snapshot: 0',
            }}
            context="Choose the plan"
            onRetry={() => erp.load?.()}
            retryLabel="Reload plans"/>)}
        {createPlan && !selectedPlan && planOptions.length > 0 && <p className="enrollment-warning">Choose a plan from the list above, or turn off the plan step.</p>}
        {!createPlan && selectedPlan && <p className="enrollment-fields-note">No new plan period will be created in this flow. Existing dues can be collected later from Payments.</p>}
          </section>}

          {wizardStep === 3 && <section className="enrollment-step" aria-labelledby="enrollment-payment-heading">
            <div className="enrollment-step-head">
              <span className="enrollment-step-icon"><IndianRupee size={19}/></span>
              <div><small>Step 4 of 4</small><h3 id="enrollment-payment-heading">Payment & review</h3><p>Collect an optional verified payment, then check every detail before saving.</p></div>
              {stepValidity[3] && <span className="erp-badge green"><Check size={12}/> Ready</span>}
            </div>
            {!createPlan && <p className="enrollment-fields-note">No payment can be collected in this guided flow because no new plan period is being created. Use Payments later for an existing due.</p>}
        <label className="erp-toggle-row">
          <input type="checkbox" checked={collectNow} disabled={started || !createPlan || !selectedPlan} onChange={event => {
            setCollectNow(event.target.checked);
            if (event.target.checked) setPaymentAmountRupees(paiseToRupees(suggestedGrossDue));
          }}/>
          <span>Collect payment now</span>
        </label>
        {collectNow && createPlan && selectedPlan && <div className="erp-form enrollment-fields payment">
          <label className="erp-field">Amount received (₹)
            <input type="number" min="0.01" step="0.01" required value={paymentAmountRupees} disabled={started} onChange={event => setPaymentAmountRupees(event.target.value)}/>
            <small>Suggested gross due: {formatINR(suggestedGrossDue)}{billing.gstEnabled && !billing.priceIncludesGst ? ' including GST added on top' : ''}.</small>
          </label>
          <div className="enrollment-quick-amounts" aria-label="Quick payment amounts">
            <button type="button" disabled={started || suggestedGrossDue <= 0} onClick={() => setPaymentAmountRupees(paiseToRupees(suggestedGrossDue))}>Full due</button>
            <button type="button" disabled={started || suggestedGrossDue <= 0} onClick={() => setPaymentAmountRupees(paiseToRupees(Math.ceil(suggestedGrossDue / 2)))}>Half due</button>
            <button type="button" disabled={started || suggestedGrossDue <= 0} onClick={() => setPaymentAmountRupees(paiseToRupees(Math.min(50000, suggestedGrossDue)))}>₹500</button>
          </div>
          <label className="erp-field">Payment method
            <select value={paymentMethod} disabled={started} onChange={event => setPaymentMethod(event.target.value)}>
              {PAYMENT_METHODS.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}
            </select>
          </label>
          <label className="erp-field">Paid on
            <input type="date" required value={paidOn} disabled={started} onChange={event => setPaidOn(event.target.value)}/>
          </label>
          <label className="erp-field">Note / transaction reference
            <input value={paymentNote} disabled={started} onChange={event => setPaymentNote(event.target.value)} placeholder="UPI/bank/card reference (recommended)"/>
          </label>
          <p className="enrollment-warning full">Record only after funds are received and verified. Supabase assigns the final receipt number after sync. {isInstructor ? 'You cannot void this payment; ask a manager if a correction is needed.' : ''}</p>
          <dl className="enrollment-payment-balance" aria-label="Payment balance preview">
            <div><dt>Gross due</dt><dd>{formatINR(suggestedGrossDue)}</dd></div>
            <div><dt>Amount received</dt><dd>{formatINR(paymentAmountPaise)}</dd></div>
            <div className="total"><dt>Balance after payment</dt><dd>{formatINR(balanceAfterPayment)}</dd></div>
          </dl>
          {overpaymentPaise > 0 && <p className="enrollment-warning full">This is {formatINR(overpaymentPaise)} more than the new plan’s gross due. Record it only if that full amount was actually received for this student.</p>}
        </div>}
      </section>}

          {wizardStep === 3 && <section className="enrollment-review" aria-label="Final enrolment review">
            <div className="enrollment-review-head">
              <div><h4>Review before saving</h4><p>{started ? 'Some steps are already saved; continue to finish the remaining work.' : 'Check the student, batch, plan and payment one last time.'}</p></div>
              <span className={`erp-badge ${started ? 'blue' : 'green'}`}>{started ? 'Partially saved' : 'Not saved yet'}</span>
            </div>
            <div className="enrollment-review-list">
              <div>
                <span className="enrollment-choice-icon"><Users size={16}/></span>
                <span><small>Student</small><strong>{displayStudentName || 'Choose a student'}</strong><em>{fixedStudent ? 'Confirmed admission' : studentMode === 'new' ? `New walk-in · joining ${formatDate(newStudent.joiningDate)}` : `Existing student · joined ${formatDate(selectedExistingStudent?.joiningDate)}`} · {displayStudentBranchId ? branchName(data, displayStudentBranchId) : 'branch not selected'}</em></span>
                <button type="button" className="secondary-button" disabled={busy || started} onClick={() => goToStep(0)}>Edit</button>
              </div>
              <div>
                <span className="enrollment-choice-icon"><Clock size={16}/></span>
                <span><small>Batch</small><strong>{mustAssignBatch && effectiveBatch ? effectiveBatch.name : 'No batch now'}</strong><em>{mustAssignBatch && effectiveBatch ? `${batchDaySummary(effectiveBatch)} · ${batchTimeLabel(effectiveBatch)} · from ${formatDate(enrollmentDate)}${alreadyEnrolled ? ' · already enrolled; no duplicate will be created' : ''}` : 'Batch can be assigned later'}</em></span>
                <button type="button" className="secondary-button" disabled={busy || started} onClick={() => goToStep(1)}>Edit</button>
              </div>
              <div>
                <span className="enrollment-choice-icon"><Repeat size={16}/></span>
                <span><small>Plan</small><strong>{createPlan && selectedPlan ? selectedPlan.name : 'No new plan period'}</strong><em>{createPlan && selectedPlan ? `${formatDate(planStartDate)} → ${formatDate(planEndDate)} · ${formatINR(suggestedGrossDue)} gross due` : 'No subscription/pass will be created now'}</em></span>
                <button type="button" className="secondary-button" disabled={busy || started} onClick={() => goToStep(2)}>Edit</button>
              </div>
              <div>
                <span className="enrollment-choice-icon"><IndianRupee size={16}/></span>
                <span><small>Payment</small><strong>{collectNow ? `${formatINR(paymentAmountPaise)} by ${PAYMENT_METHODS.find(method => method.id === paymentMethod)?.label || paymentMethod}` : 'No payment now'}</strong><em>{collectNow ? `Paid on ${formatDate(paidOn)}${paymentNote ? ` · Ref: ${paymentNote}` : ''} · balance after payment ${formatINR(balanceAfterPayment)}` : createPlan ? `${formatINR(suggestedGrossDue)} will remain due` : 'Use Payments later for an existing due'}</em></span>
              </div>
            </div>
            {currentPeriod && createPlan && <p className="enrollment-warning">This student already has a current {membershipKindLabel(data, currentPeriod).toLowerCase()} period ({formatDate(currentPeriod.startDate)} → {formatDate(currentPeriod.endDate)}). Continue only if another period is intentional.</p>}
          </section>}

          <div className="enrollment-wizard-actions">
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
            <div>
              {wizardStep > 0 && <button type="button" className="secondary-button" disabled={busy || started} onClick={goBackStep}><ArrowLeft size={15}/> Back</button>}
              {wizardStep < 3 ? <button key="enrollment-continue" type="button" className="primary-button" disabled={busy} onClick={goNextStep}>
                Continue to {wizardSteps[wizardStep + 1].label} <ArrowRight size={15}/>
              </button> : <button key="enrollment-finish" type="submit" className="primary-button" disabled={busy}>
                {busy ? 'Saving…' : started ? 'Continue enrolment' : collectNow ? `Enroll & collect ${formatINR(paymentAmountPaise)}` : 'Complete enrolment'}
              </button>}
            </div>
          </div>
        </div>
      </div>
    </form>}
  </Dialog>
  {invoice && <InvoiceDialog data={data} invoice={invoice} onClose={() => setInvoice(null)}/>}
  </>;
}

function AdmissionReviewDialog({admission, branches, erp, online, notify, onClose, onReviewed, onConfirmed}) {
  const [branchId, setBranchId] = useState(admission.branchId || branches[0]?.id || '');
  const [joiningDate, setJoiningDate] = useState(toISODate());
  const [reviewNote, setReviewNote] = useState('');
  const [continueEnrollment, setContinueEnrollment] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const hasDuplicate = Boolean(admission.possibleDuplicateStudentId);
  const preferredBranch = branches.find(branch => branch.id === admission.branchId) || null;

  const review = async action => {
    if (action === 'confirm' && !branchId) return;
    setBusy(action);
    setError('');
    try {
      const result = await erp.client.reviewAdmission({
        admissionId: admission.id,
        action,
        branchId: action === 'confirm' ? branchId : '',
        joiningDate,
        reviewNote,
      });
      try { await erp.syncNow?.({waitForIdle: true}); } catch { /* The review already committed; the next refresh will show the new student. */ }
      onClose();
      if (action === 'confirm' && continueEnrollment && result?.studentId) {
        onConfirmed?.({
          id: result.studentId,
          branchId,
          joiningDate,
          firstName: admission.firstName, lastName: admission.lastName,
          fullName: admission.fullName || `${admission.firstName} ${admission.lastName}`.trim(),
        });
        notify?.('Admission confirmed. Continue with batch, plan and payment.');
      } else {
        notify?.(action === 'confirm'
          ? 'Admission confirmed. Student record created and portal access granted.'
          : 'Admission rejected.');
      }
      await onReviewed?.(result);
    } catch (reviewError) {
      setError(reviewError);
    } finally {
      setBusy('');
    }
  };

  return <Dialog title="Review admission" sub="Confirming creates the student and grants portal access to the applicant’s signed-in account. You can continue directly to batch, plan and payment." onClose={onClose} className="admission-review-dialog">
    {error && <ErrorNotice error={error} context="Review admission"/>}
    {!online && <div className="erp-banner amber" role="status"><WifiOff size={18}/><span>Admissions can be reviewed only while online.</span></div>}
    {hasDuplicate && <div className="erp-banner amber" role="alert"><AlertCircle size={18}/><span>
      <b>Possible duplicate:</b> student “{admission.possibleDuplicateStudentName}” already uses this email. Link that existing student through Portal access or resolve the duplicate before confirming; this protects against a second student record for the same account.
    </span></div>}
    {preferredBranch && <div className="erp-banner blue" role="status"><MapPin size={18}/><span><b>Branch-link preference:</b> {preferredBranch.name}. You may choose a different branch below if needed.</span></div>}
    <dl className="erp-detail-list admission-details">
      <div><dt>First Name</dt><dd>{admission.firstName}</dd></div>
      <div><dt>Last Name</dt><dd>{admission.lastName}</dd></div>
      <div><dt>Date Of Birth</dt><dd>{formatDate(admission.dob)}</dd></div>
      <div><dt>Phone Number</dt><dd>{admission.phone || '—'}</dd></div>
      <div className="full"><dt>Subject</dt><dd>{admission.subject || '—'}</dd></div>
      <div className="full"><dt>Your Email</dt><dd>{admission.email || '—'}</dd></div>
      <div className="full"><dt>Address</dt><dd>{admission.address || '—'}</dd></div>
      <div><dt>Pin Code</dt><dd>{admission.pinCode || '—'}</dd></div>
      <div><dt>Reference by</dt><dd>{admission.referredBy || '—'}</dd></div>
      <div><dt>Experience in yoga</dt><dd>{yogaExperienceLabel(admission.yogaExperience)}</dd></div>
      <div><dt>Preferred branch</dt><dd>{preferredBranch?.name || 'Studio link / not selected'}</dd></div>
      <div><dt>Status</dt><dd>{admission.status}</dd></div>
      <div className="full"><dt>Medical / Physical issue</dt><dd>{admission.medicalPhysicalIssue || '—'}</dd></div>
      <div className="full"><dt>Reasons to join yoga</dt><dd>{admission.reasonToJoin || '—'}</dd></div>
    </dl>
    <form className="erp-form" onSubmit={event => { event.preventDefault(); review('confirm'); }}>
      <label className="erp-field">Admission branch
        <select value={branchId} onChange={event => setBranchId(event.target.value)} required>
          <option value="">Select branch</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}{branch.id === admission.branchId ? ' · preferred' : ''}</option>)}
        </select>
      </label>
      <label className="erp-field">Joining date
        <input type="date" value={joiningDate} onChange={event => setJoiningDate(event.target.value)} required/>
      </label>
      <label className="erp-field full">Review note
        <textarea rows={2} maxLength={500} value={reviewNote} onChange={event => setReviewNote(event.target.value)}/>
      </label>
      <label className="erp-toggle-row full">
        <input type="checkbox" checked={continueEnrollment} onChange={event => setContinueEnrollment(event.target.checked)}/>
        <span>Continue to batch, plan &amp; payment after confirmation</span>
      </label>
      <div className="erp-form-actions">
        <button type="button" className="danger-button" disabled={!online || Boolean(busy)} onClick={() => review('reject')}>
          {busy === 'reject' ? 'Rejecting…' : 'Reject admission'}
        </button>
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        <button className="primary-button" disabled={!online || Boolean(busy) || hasDuplicate}>
          {busy === 'confirm' ? 'Confirming…' : continueEnrollment ? 'Confirm & continue enrolment' : 'Confirm admission & grant portal'}
        </button>
      </div>
    </form>
  </Dialog>;
}

function AdmissionLinkCards({linkInfo, branches = [], notify, onQr, emptyText = 'Loading admission links…'}) {
  const buildAdmissionLink = useCallback((branchId = '') => {
    if (!linkInfo?.admissionCode || typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.set('admission', linkInfo.admissionCode);
    if (branchId) url.searchParams.set('branch', branchId);
    else url.searchParams.delete('branch');
    url.hash = '';
    return url.toString();
  }, [linkInfo]);

  const linkItems = useMemo(() => {
    if (!linkInfo?.admissionCode) return [];
    return [
      {
        id: 'studio', label: 'Studio admission link', badge: 'All branches',
        description: 'General link for your website/social profile. A manager chooses the branch during confirmation.',
        url: buildAdmissionLink(),
      },
      ...branches.map(branch => ({
        id: branch.id,
        label: `${branch.name} admission link`, badge: branch.city || 'Branch link',
        description: 'Applications from this link arrive with this branch pre-selected.',
        url: buildAdmissionLink(branch.id),
      })),
    ];
  }, [branches, buildAdmissionLink, linkInfo]);

  const copyLink = async item => {
    try {
      await navigator.clipboard.writeText(item.url);
      notify?.(`${item.label} copied.`);
    } catch {
      notify?.('Copy the admission link from the field shown.');
    }
  };

  const shareLink = async item => {
    const shareData = {
      title: 'Yoga Studio admission',
      text: `Join ${linkInfo?.organizationName || 'our yoga studio'} — create your account and complete the admission form:`,
      url: item.url,
    };
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try { await navigator.share(shareData); return; }
      catch (shareError) { if (shareError?.name === 'AbortError') return; }
    }
    await copyLink(item);
  };

  return <div className="admission-link-grid" aria-label="Public admission links">
    {linkItems.length === 0 ? <article className="admission-link-card">
      <strong>Public admission link</strong><p>{emptyText}</p>
    </article> : linkItems.map(item => <article className="admission-link-card" key={item.id}>
      <header><div><h3>{item.label}</h3><p>{item.description}</p></div><span className="erp-badge lavender">{item.badge}</span></header>
      <label className="erp-field">{item.label}
        <input readOnly value={item.url} aria-label={item.label}/>
      </label>
      <footer>
        <button type="button" className="secondary-button" onClick={() => copyLink(item)}><Copy size={14}/> Copy</button>
        <button type="button" className="secondary-button" onClick={() => shareLink(item)}><Share2 size={14}/> Share</button>
        <a className="secondary-button" href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Join ${linkInfo?.organizationName || 'our yoga studio'} — create your account and complete the admission form: ${item.url}`)}`} target="_blank" rel="noreferrer"><MessageCircle size={14}/> WhatsApp</a>
        <button type="button" className="secondary-button" onClick={() => onQr?.(item)}><QrCode size={14}/> QR</button>
        <a className="erp-link-btn" href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={13}/> Open</a>
      </footer>
    </article>)}
  </div>;
}

function AdmissionsPanel(props) {
  const {erp, ctx, branches, notify} = props;
  const {data} = erp;
  const [status, setStatus] = useState('pending');
  const [admissions, setAdmissions] = useState([]);
  const [linkInfo, setLinkInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState(null);
  const [query, setQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [qrItem, setQrItem] = useState(null);
  const [enrollmentSeed, setEnrollmentSeed] = useState(null);
  const online = useOnline();
  const today = toISODate();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rows, info] = await Promise.all([
        erp.client.listAdmissions(status),
        erp.client.getAdmissionLinkInfo(),
      ]);
      setAdmissions(rows);
      setLinkInfo(info);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, [erp.client, status]);

  useEffect(() => { load(); }, [load]);

  const visibleAdmissions = admissions
    .filter(admission => {
      if (branchFilter === 'studio' && admission.branchId) return false;
      if (branchFilter !== 'all' && branchFilter !== 'studio' && admission.branchId !== branchFilter) return false;
      const needle = query.trim().toLocaleLowerCase('en-IN');
      if (!needle) return true;
      return [
        admission.fullName, admission.firstName, admission.lastName, admission.email,
        admission.phone, admission.subject, admission.referredBy,
        admission.branchId ? branchName(data, admission.branchId) : 'Studio link',
      ].join(' ').toLocaleLowerCase('en-IN').includes(needle);
    })
    .sort((a, b) => {
      if (sortBy === 'name') return (a.fullName || '').localeCompare(b.fullName || '');
      if (sortBy === 'oldest') return String(a.submittedAt || '').localeCompare(String(b.submittedAt || ''));
      return String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''));
    });

  const summary = {
    pending: admissions.filter(admission => admission.status === 'pending').length,
    waiting: admissions.filter(admission => admission.status === 'pending'
      && (admissionWaitingDays(admission.submittedAt, today) || 0) >= 3).length,
    duplicates: admissions.filter(admission => admission.possibleDuplicateStudentId).length,
    branchLinks: admissions.filter(admission => admission.branchId).length,
  };

  const filtersActive = query || branchFilter !== 'all' || sortBy !== 'newest';

  return <section className="erp-panel admissions-manager-panel">
    <div className="erp-panel-head"><div>
      <h2>Admission requests</h2>
      <p>Share a studio or branch admission link. The applicant first creates and confirms an account with “Join an existing studio,” then submits this form. Confirming creates the student, grants portal access and can continue directly to batch, plan and payment.</p>
    </div><button className="secondary-button" onClick={load} disabled={loading}><RefreshCw size={16}/> Refresh</button></div>

    <AdmissionLinkCards
      linkInfo={linkInfo} branches={branches} notify={notify} onQr={setQrItem}
      emptyText={online ? 'Loading admission links…' : 'Reconnect to load the current public admission links.'}/>
    <p className="admission-link-note">To test a link as a new applicant, open it in a private/incognito window so your manager session does not hide the admission form.</p>

    <div className="erp-grid admission-summary" aria-label="Admission request summary">
      <div className="erp-kpi"><small>Requests shown</small><strong>{visibleAdmissions.length}</strong><p>{admissions.length} loaded for this status</p></div>
      <div className="erp-kpi"><small>Pending review</small><strong>{summary.pending}</strong><p>Oldest requests need follow-up first</p></div>
      <div className="erp-kpi"><small>Waiting 3+ days</small><strong>{summary.waiting}</strong><p>Call or message these applicants</p></div>
      <div className="erp-kpi"><small>Needs attention</small><strong>{summary.duplicates}</strong><p>{summary.branchLinks} request(s) have a branch selected</p></div>
    </div>

    <div className="erp-workspace-controls admission-controls" aria-label="Admission request filters">
      <label className="erp-search"><Search size={16}/><input aria-label="Search admission requests" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search applicant, phone, email or subject…"/></label>
      <label className="erp-field erp-workspace-field">Admission status
        <select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </label>
      <label className="erp-field erp-workspace-field">Branch / link
        <select aria-label="Admission branch filter" value={branchFilter} onChange={event => setBranchFilter(event.target.value)}>
          <option value="all">All branches & studio link</option>
          <option value="studio">Studio link / no branch yet</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
      </label>
      <label className="erp-field erp-workspace-field">Sort by
        <select aria-label="Sort admission requests" value={sortBy} onChange={event => setSortBy(event.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Applicant name</option>
        </select>
      </label>
      {filtersActive && <button type="button" className="secondary-button" onClick={() => { setQuery(''); setBranchFilter('all'); setSortBy('newest'); }}>Clear filters</button>}
    </div>

    {error && <ErrorNotice error={error} context="Load admission requests" onRetry={load}/>}
    {loading ? <p>Loading admission requests…</p> : admissions.length === 0
      ? <Empty icon={Users} title="No admission requests" text="New public admission submissions will appear here for manager review."/>
      : visibleAdmissions.length === 0
        ? <Empty icon={Search} title="No requests match" text="Try another applicant, status or branch/link filter." action={<button className="secondary-button" onClick={() => { setQuery(''); setBranchFilter('all'); }}>Clear filters</button>}/>
        : <div className="admission-card-grid">
          {visibleAdmissions.map(admission => {
            const waitingDays = admissionWaitingDays(admission.submittedAt, today);
            const branchLabel = admission.branchId ? branchName(data, admission.branchId) : 'Studio link';
            const whatsapp = whatsappUrl(admission.phone, `Hello ${admission.firstName}, this is ${linkInfo?.organizationName || 'Yoga Studio'} about your admission request.`);
            return <article className="erp-admission-card" key={admission.id} aria-label={`${admission.fullName || 'Applicant'} admission request`}>
              <header>
                <span className="avatar">{initials(admission.fullName || `${admission.firstName} ${admission.lastName}`)}</span>
                <div><h3>{admission.fullName || `${admission.firstName} ${admission.lastName}`.trim()}</h3>
                  <p>{admission.submittedAt ? `Submitted ${formatDate(String(admission.submittedAt).slice(0, 10))}` : 'Submission date unavailable'}</p></div>
                <span className={`erp-badge ${admission.status === 'confirmed' ? 'green' : admission.status === 'rejected' ? 'red' : 'amber'}`}>{admission.status}</span>
              </header>
              <div className="erp-card-badges">
                {admission.status === 'pending' && waitingDays !== null && <span className={`erp-badge ${waitingDays >= 7 ? 'red' : waitingDays >= 3 ? 'amber' : 'lavender'}`}>{waitingDays === 0 ? 'Submitted today' : `Waiting ${waitingDays} day${waitingDays === 1 ? '' : 's'}`}</span>}
                <span className="erp-badge grey"><MapPin size={11}/> {branchLabel}</span>
                {admission.possibleDuplicateStudentId && <span className="erp-badge amber">Possible duplicate</span>}
                {admission.studentId && <span className="erp-badge green">Student created</span>}
              </div>
              <dl>
                <div><dt>Subject</dt><dd>{admission.subject || '—'}</dd></div>
                <div><dt>Experience</dt><dd>{yogaExperienceLabel(admission.yogaExperience)}</dd></div>
                <div><dt>Phone</dt><dd>{admission.phone || '—'}</dd></div>
                <div><dt>Email</dt><dd>{admission.email || '—'}</dd></div>
                {admission.referredBy && <div><dt>Reference</dt><dd>{admission.referredBy}</dd></div>}
                {admission.status === 'rejected' && admission.reviewNote && <div className="full"><dt>Review note</dt><dd>{admission.reviewNote}</dd></div>}
              </dl>
              <footer>
                {admission.status === 'pending'
                  ? <button type="button" className="primary-button" onClick={() => setReviewing(admission)}>Review &amp; enroll</button>
                  : <span className="erp-muted">Reviewed{admission.reviewedAt ? ` ${formatDate(String(admission.reviewedAt).slice(0, 10))}` : ''}</span>}
                {admission.phone && <a className="erp-link-btn" href={`tel:${String(admission.phone).replace(/[^+0-9]/g, '')}`}><Phone size={13}/> Call</a>}
                {whatsapp && <a className="erp-link-btn" href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle size={13}/> WhatsApp</a>}
                {admission.email && <a className="erp-link-btn" href={`mailto:${admission.email}`}><Mail size={13}/> Email</a>}
              </footer>
            </article>;
          })}
        </div>}

    {reviewing && <AdmissionReviewDialog
      admission={reviewing} branches={branches} erp={erp} online={online} notify={notify}
      onClose={() => setReviewing(null)} onReviewed={load}
      onConfirmed={seed => { setEnrollmentSeed(seed); load(); }}/>}
    {qrItem && <AdmissionQrDialog item={qrItem} onClose={() => setQrItem(null)}/>}
    {enrollmentSeed && <EnrollmentWizardDialog
      {...props} fixedStudent={enrollmentSeed}
      onClose={() => setEnrollmentSeed(null)}
      onComplete={() => load()}/>}
  </section>;
}

export function InstructorStudentsPage(props) {
  const {erp, ctx, go, notify} = props;
  const {data} = erp;
  const today = toISODate();
  const [query, setQuery] = useState('');
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [enrollmentStudent, setEnrollmentStudent] = useState(null);
  const [linkInfo, setLinkInfo] = useState(null);
  const [linkLoading, setLinkLoading] = useState(props.mode === 'supabase');
  const [linkError, setLinkError] = useState('');
  const [qrItem, setQrItem] = useState(null);
  const online = useOnline();

  const loadLinks = useCallback(async () => {
    if (props.mode !== 'supabase') {
      setLinkLoading(false);
      return;
    }
    setLinkLoading(true);
    setLinkError('');
    try {
      setLinkInfo(await erp.client.getAdmissionLinkInfo());
    } catch (error) {
      setLinkError(error);
    } finally {
      setLinkLoading(false);
    }
  }, [erp.client, props.mode]);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  const ownBatches = data.batches
    .filter(batch => batch.status === 'active' && batch.instructorId === ctx.instructorId && inBranch(ctx, batch.branchId))
    .sort((a, b) => branchName(data, a.branchId).localeCompare(branchName(data, b.branchId))
      || String(a.startTime || '').localeCompare(String(b.startTime || ''))
      || a.name.localeCompare(b.name));
  const ownBatchById = new Map(ownBatches.map(batch => [batch.id, batch]));
  const ownStudentIds = new Set(instructorFinanceStudentIds(data, ctx.instructorId));
  const ownStudents = data.students
    .filter(student => student.status === 'active' && ownStudentIds.has(student.id) && inBranch(ctx, student.branchId))
    .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
  const visibleStudents = ownStudents.filter(student => {
    const needle = query.trim().toLocaleLowerCase('en-IN');
    if (!needle) return true;
    const batchNames = data.enrollments
      .filter(enrollment => enrollment.studentId === student.id && enrollment.status === 'active' && ownBatchById.has(enrollment.batchId))
      .map(enrollment => ownBatchById.get(enrollment.batchId)?.name || '');
    return [student.fullName, student.firstName, student.lastName, branchName(data, student.branchId), ...batchNames]
      .join(' ').toLocaleLowerCase('en-IN').includes(needle);
  });
  const teachingBranchIds = new Set(ownBatches.map(batch => batch.branchId));
  const teachingBranches = data.branches.filter(branch => branch.status !== 'archived' && teachingBranchIds.has(branch.id));
  const batchSeats = ownBatches.reduce((summary, batch) => {
    const fill = batchFill(batch, data.enrollments);
    return {
      enrolled: summary.enrolled + fill.enrolled,
      capacity: summary.capacity + fill.capacity,
      seatsLeft: summary.seatsLeft + fill.seatsLeft,
    };
  }, {enrolled: 0, capacity: 0, seatsLeft: 0});
  const classesToday = ownBatches.filter(batch => isBatchOnDate(batch, today)).length;

  const openNewEnrollment = () => {
    setEnrollmentStudent(null);
    setEnrollmentOpen(true);
  };
  const openStudentEnrollment = student => {
    setEnrollmentStudent(student);
    setEnrollmentOpen(true);
  };

  return <>
    <ErpBlockingState {...props}/>
    <div className="page-heading"><div className="eyebrow">STUDIO ERP</div><h1>My students <span className="flower">✳</span></h1><p>Students actively enrolled in your batches, new enrollment for your own batches, and public admission links you can share.</p></div>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>

    <div className="erp-banner blue" role="note">
      <BadgeCheck size={18}/>
      <span>This Students view is limited to your active batches. You can create a basic walk-in student or enroll an existing same-branch student into your batch. Full student profiles, medical details, admission requests and portal access remain manager-only.</span>
    </div>

    <div className="erp-grid erp-workspace-summary" aria-label="My student summary">
      <div className="erp-kpi"><small>My students</small><strong>{ownStudents.length}</strong><p>Active in your batches</p></div>
      <div className="erp-kpi"><small>My active batches</small><strong>{ownBatches.length}</strong><p>{classesToday} scheduled today</p></div>
      <div className="erp-kpi"><small>Batch seats</small><strong>{batchSeats.enrolled}/{batchSeats.capacity}</strong><p>{batchSeats.seatsLeft} seat(s) available</p></div>
      <div className="erp-kpi"><small>Teaching branches</small><strong>{teachingBranches.length}</strong><p>Branch links shown for these branches</p></div>
    </div>

    <section className="erp-panel">
      <div className="erp-panel-head">
        <div><h2>New enrollment &amp; public admission URL</h2><p>Use guided enrollment for a walk-in or an existing student in your batch. Or share a public link and a manager will review the submitted admission.</p></div>
        <div className="erp-actions">
          <button className="primary-button" onClick={openNewEnrollment} disabled={!ctx.instructorId || ownBatches.length === 0}><Sparkles size={16}/> New enrollment</button>
          {props.mode === 'supabase' && <button className="secondary-button" onClick={loadLinks} disabled={linkLoading || !online}><RefreshCw size={15}/> Refresh links</button>}
        </div>
      </div>

      {props.mode !== 'supabase' ? <div className="erp-banner" role="note">
        <Share2 size={18}/><span>Public admission URLs are available only in Supabase mode. Guided enrollment still works with the student and batch copy on this device.</span>
      </div> : linkError ? <ErrorNotice error={linkError} context="Load public admission links" onRetry={loadLinks}/> : <>
        <AdmissionLinkCards
          linkInfo={linkInfo} branches={teachingBranches} notify={notify} onQr={setQrItem}
          emptyText={!online ? 'Reconnect to load the current public admission links.' : linkLoading ? 'Loading public admission links…' : 'Public admission links are not available for this account.'}/>
        <p className="admission-link-note">Share the studio link anywhere, or use a branch link so the application arrives with your teaching branch pre-selected. The link does not show you the submitted request; an Owner, Co-owner or branch Admin reviews and confirms it.</p>
      </>}
      {!ctx.instructorId && <p className="enrollment-warning">Choose your linked instructor record above before starting a new enrollment.</p>}
      {ctx.instructorId && ownBatches.length === 0 && <p className="enrollment-warning">No active batch is assigned to you in the selected branch, so new enrollment is unavailable. Ask a manager to assign you to a batch.</p>}
    </section>

    <section className="erp-panel">
      <div className="erp-panel-head">
        <span className="erp-search"><Search size={16}/><input aria-label="Search my students" placeholder="Search my students or batches…" value={query} onChange={event => setQuery(event.target.value)}/></span>
        <div className="erp-actions"><button className="secondary-button" onClick={openNewEnrollment} disabled={!ctx.instructorId || ownBatches.length === 0}><UserPlus size={15}/> New enrollment</button></div>
      </div>
      {!ctx.instructorId ? <Empty icon={Users} title="Instructor record not selected" text="Choose the signed-in instructor record above to see only that instructor’s enrolled students."/>
        : ownBatches.length === 0 ? <Empty icon={Clock} title="No assigned active batches" text="Your students will appear here after a manager assigns an active batch to you and students are enrolled in it."/>
        : ownStudents.length === 0 ? <Empty icon={Users} title="No students in your batches yet" text="Start a new enrollment to create a basic walk-in student or add an existing same-branch student to one of your batches." action={<button className="primary-button" onClick={openNewEnrollment}><Sparkles size={15}/> New enrollment</button>}/>
        : visibleStudents.length === 0 ? <Empty icon={Search} title="No matching students" text="Try a different student or batch name."/>
        : <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Student</th><th>Branch</th><th>My batches</th><th>Next class</th><th>Attendance</th><th>Actions</th></tr></thead><tbody>
          {visibleStudents.map(student => {
            const studentEnrollments = data.enrollments.filter(enrollment => (
              enrollment.studentId === student.id && enrollment.status === 'active' && ownBatchById.has(enrollment.batchId)
            ));
            const studentBatches = studentEnrollments
              .map(enrollment => ownBatchById.get(enrollment.batchId))
              .filter(Boolean)
              .sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')) || a.name.localeCompare(b.name));
            const nextClass = studentBatches
              .map(batch => ({batch, date: nextUpcomingBatchDate(batch, today)}))
              .filter(item => item.date)
              .sort((a, b) => a.date.localeCompare(b.date) || String(a.batch.startTime || '').localeCompare(String(b.batch.startTime || '')))[0] || null;
            const rate = attendanceSummary(data.attendance.filter(record => (
              record.studentId === student.id && ownBatchById.has(record.batchId)
            ))).rate;
            return <tr key={student.id}>
              <td><span className="erp-person"><span className="avatar">{initials(student.fullName)}</span><span><strong>{student.fullName}</strong><small>Joined {formatDate(student.joiningDate)}</small></span></span></td>
              <td>{branchName(data, student.branchId)}</td>
              <td>{studentBatches.map(batch => <div key={batch.id}><strong>{batch.name}</strong><br/><small>{batchDaySummary(batch)} · {batchTimeLabel(batch)}</small></div>)}</td>
              <td>{nextClass ? <>{relativeClassDateLabel(nextClass.date, today)}<br/><small>{nextClass.batch.name}</small></> : '—'}</td>
              <td>{rate === null ? '—' : `${rate}%`}</td>
              <td>
                <button className="erp-link-btn" onClick={() => openStudentEnrollment(student)}><Sparkles size={13}/> Enroll / collect</button>
                <button className="erp-link-btn" onClick={() => go('payments')}><IndianRupee size={13}/> Payments</button>
                <button className="erp-link-btn" onClick={() => go('attendance')}><CalendarCheck size={13}/> Attendance</button>
              </td>
            </tr>;
          })}
        </tbody></table></div>}
    </section>

    {qrItem && <AdmissionQrDialog item={qrItem} onClose={() => setQrItem(null)}/>}
    {enrollmentOpen && <EnrollmentWizardDialog
      {...props} fixedStudent={enrollmentStudent}
      onClose={() => { setEnrollmentOpen(false); setEnrollmentStudent(null); }}/>}
  </>;
}

export function StudentsPage(props) {
  if (props.ctx?.role === 'instructor') return <InstructorStudentsPage {...props}/>;
  return <ManagerStudentsPage {...props}/>;
}

function ManagerStudentsPage(props) {
  const {erp, ctx, go} = props; const {data} = erp;
  const [query, setQuery] = useState(''); const [editing, setEditing] = useState(null);
  const [accessStudent, setAccessStudent] = useState(null);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [enrollmentStudent, setEnrollmentStudent] = useState(null);
  const showAccess = props.mode === 'supabase' && canManage(ctx);
  const canShowAccess = student => showAccess && student.portalAccessStatus !== 'hidden';
  const list = data.students.filter(s => inBranch(ctx, s.branchId)
    && (`${s.fullName} ${s.phone} ${s.email} ${s.portalAccessEmail || ''}`.toLowerCase().includes(query.toLowerCase())));
  const editStudent = student => {
    const nameParts = String(student.fullName || '').trim().split(/\s+/).filter(Boolean);
    setEditing({
      ...student,
      firstName: student.firstName || nameParts[0] || '',
      lastName: student.lastName || nameParts.slice(1).join(' ') || '',
      address: student.address || '', pinCode: student.pinCode || '',
      admissionSubject: student.admissionSubject || '', referredBy: student.referredBy || '',
      yogaExperience: student.yogaExperience || '',
      medicalPhysicalIssue: student.medicalPhysicalIssue || '',
      reasonToJoin: student.reasonToJoin || '',
    });
  };
  const save = async e => {
    e.preventDefault();
    const firstName = String(editing.firstName || '').trim();
    const lastName = String(editing.lastName || '').trim();
    const payload = {...editing, firstName, lastName, fullName: [firstName, lastName].filter(Boolean).join(' ')};
    if (await erp.act(c => c.saveStudent(payload), 'Student saved.')) setEditing(null);
  };
  const empty = {
    firstName: '', lastName: '', fullName: '', phone: '', email: '', gender: '', dob: '',
    joiningDate: toISODate(), branchId: ctx.branchId !== 'all' ? ctx.branchId : (data.branches[0]?.id || ''),
    notes: '', address: '', pinCode: '', admissionSubject: '', referredBy: '',
    yogaExperience: '', medicalPhysicalIssue: '', reasonToJoin: '',
  };
  return <>
    <ErpBlockingState {...props}/>
    <div className="page-heading"><div className="eyebrow">STUDIO ERP</div><h1>Students <span className="flower">✳</span></h1><p>Everyone who practices at your studio.</p></div>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>
    {showAccess && <AdmissionsPanel {...props} branches={data.branches.filter(branch => branch.status !== 'archived')}/>}
    <section className="erp-panel"><div className="erp-panel-head">
      <span className="erp-search"><Search size={16}/><input aria-label="Search students" placeholder="Search name, phone or email…" value={query} onChange={e => setQuery(e.target.value)}/></span>
      <div className="erp-actions">
        <button className="secondary-button" onClick={() => exportCSV('students.csv', list, [{label: 'Name', value: s => s.fullName}, {label: 'Phone', value: s => s.phone}, {label: 'Email', value: s => s.email}, {label: 'Branch', value: s => branchName(data, s.branchId)}, {label: 'Joined', value: s => s.joiningDate}, {label: 'Status', value: s => s.status}])}><Download size={15}/> CSV</button>
        {canManage(ctx) && <button className="primary-button" onClick={() => { setEnrollmentStudent(null); setEnrollmentOpen(true); }}><Sparkles size={16}/> Enroll student</button>}
        {canManage(ctx) && <button className="secondary-button" onClick={() => setEditing(empty)}><Plus size={16}/> Add student</button>}
      </div></div>
      {data.branches.length === 0 ? <Empty icon={Building2} title="Add a branch first" text="Students belong to a branch. Create your studio location, then add students." action={<button className="primary-button" onClick={() => go('branches')}>Go to Branches</button>}/> :
      list.length === 0 ? <Empty icon={Users} title="No students found" text="Add your first student, or try a different search."/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Student</th><th>Branch</th><th>Batches</th><th>Attendance</th><th>{showAccess ? 'Status / portal' : 'Status'}</th><th>Actions</th></tr></thead><tbody>
        {list.map(s => { const rate = attendanceSummary(data.attendance.filter(a => a.studentId === s.id)).rate; const access = portalAccessMeta(s); return <tr key={s.id}>
          <td><span className="erp-person"><span className="avatar">{initials(s.fullName)}</span><span><strong>{s.fullName}</strong><small>{s.phone || s.email || '—'}</small></span></span></td>
          <td>{branchName(data, s.branchId)}</td>
          <td>{data.enrollments.filter(e => e.studentId === s.id && e.status === 'active').map(e => data.batches.find(b => b.id === e.batchId)?.name).filter(Boolean).join(', ') || '—'}</td>
          <td>{rate === null ? '—' : `${rate}%`}</td>
          <td><span className={`erp-badge ${s.status === 'active' ? 'green' : 'grey'}`}>{s.status}</span>
            {canShowAccess(s) && <><br/><span className={`erp-badge ${access.className}`} style={{marginTop: 5}}>{access.label}</span>
            {s.portalAccessEmail && <><br/><small>{s.portalAccessEmail}</small></>}</>}</td>
          <td>{canManage(ctx) && <><button className="erp-link-btn" onClick={() => editStudent(s)}><Pencil size={13}/> Edit</button>
          {s.status === 'active' && <button className="erp-link-btn" onClick={() => { setEnrollmentStudent(s); setEnrollmentOpen(true); }}><Sparkles size={13}/> Enroll / collect</button>}
          {canShowAccess(s) && <button className="erp-link-btn" onClick={() => setAccessStudent({...s})}><KeyRound size={13}/> Portal access</button>}
          <button className="erp-link-btn" onClick={() => erp.act(c => c.archiveStudent(s.id), s.status === 'active' ? 'Student deactivated.' : 'Student reactivated.')}>{s.status === 'active' ? 'Deactivate' : 'Activate'}</button></>}</td></tr>; })}
      </tbody></table></div>}
    </section>
    {editing && <Dialog title={editing.id ? 'Edit student' : 'Add student'} onClose={() => setEditing(null)}>
      <form className="erp-form" onSubmit={save}>
        <label className="erp-field">First Name<input required value={editing.firstName || ''} onChange={e => setEditing({...editing, firstName: e.target.value})} placeholder="First name"/></label>
        <label className="erp-field">Last Name<input value={editing.lastName || ''} onChange={e => setEditing({...editing, lastName: e.target.value})} placeholder="Last name"/></label>
        <label className="erp-field">Branch<select aria-label="Student branch" required value={editing.branchId} onChange={e => setEditing({...editing, branchId: e.target.value})}><option value="">Choose branch…</option>{data.branches.filter(b => b.status !== 'archived').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="erp-field">Phone Number<input type="tel" value={editing.phone || ''} onChange={e => setEditing({...editing, phone: e.target.value})} placeholder="10-digit mobile"/></label>
        <label className="erp-field">Email<input type="email" value={editing.email || ''} onChange={e => setEditing({...editing, email: e.target.value})}/></label>
        <label className="erp-field">Gender<select value={editing.gender || ''} onChange={e => setEditing({...editing, gender: e.target.value})}><option value="">Prefer not to say</option><option>Female</option><option>Male</option><option>Other</option></select></label>
        <label className="erp-field">Date Of Birth<input type="date" value={editing.dob || ''} onChange={e => setEditing({...editing, dob: e.target.value})}/></label>
        <label className="erp-field">Joining date<input type="date" required value={editing.joiningDate} onChange={e => setEditing({...editing, joiningDate: e.target.value})}/></label>
        <label className="erp-field full">Address<textarea rows={2} value={editing.address || ''} onChange={e => setEditing({...editing, address: e.target.value})}/></label>
        <label className="erp-field">Pin Code<input inputMode="numeric" value={editing.pinCode || ''} onChange={e => setEditing({...editing, pinCode: e.target.value})}/></label>
        <label className="erp-field">Subject<input value={editing.admissionSubject || ''} onChange={e => setEditing({...editing, admissionSubject: e.target.value})} placeholder="Ex. New Admission in Personal yoga session"/></label>
        <label className="erp-field">Reference by<input value={editing.referredBy || ''} onChange={e => setEditing({...editing, referredBy: e.target.value})}/></label>
        <label className="erp-field">Experience in yoga<select value={editing.yogaExperience || ''} onChange={e => setEditing({...editing, yogaExperience: e.target.value})}><option value="">Not specified</option>{YOGA_EXPERIENCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="erp-field full">Medical / Physical issue<textarea rows={3} value={editing.medicalPhysicalIssue || ''} onChange={e => setEditing({...editing, medicalPhysicalIssue: e.target.value})} placeholder="Manager-and-student-only health detail"/><small>Visible only to Owner, Co-owner, branch Admin and this student. Instructors do not receive this field.</small></label>
        <label className="erp-field full">Reasons to join yoga<textarea rows={3} value={editing.reasonToJoin || ''} onChange={e => setEditing({...editing, reasonToJoin: e.target.value})}/></label>
        <label className="erp-field full">Notes<textarea rows={2} value={editing.notes || ''} onChange={e => setEditing({...editing, notes: e.target.value})} placeholder="Optional studio note (avoid medical details)"/></label>
        {showAccess && editing.id && <div className="erp-banner blue" role="note" style={{gridColumn: '1 / -1', margin: 0}}>
          <KeyRound size={18}/><span>The contact email above does not change the student’s sign-in. Use <b>Portal access</b> in the student row to link or replace their login email.</span>
        </div>}
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button">Save student</button></div>
      </form></Dialog>}
    {accessStudent && <StudentAccessDialog student={accessStudent} erp={erp} notify={props.notify} onClose={() => setAccessStudent(null)}/>}
    {enrollmentOpen && <EnrollmentWizardDialog {...props} fixedStudent={enrollmentStudent} onClose={() => { setEnrollmentOpen(false); setEnrollmentStudent(null); }}/>}
  </>;
}

/* ---------------- role access ---------------- */

const ROLE_LABELS = {
  owner: 'Owner',
  co_owner: 'Co-owner',
  admin: 'Admin',
  instructor: 'Instructor',
  student: 'Student',
};

function BranchAccessChecks({branches, value, onChange, legend, disabled = false, subject = ''}) {
  const selected = new Set(value || []);
  const toggle = (branchId, checked) => {
    const next = new Set(selected);
    if (checked) next.add(branchId); else next.delete(branchId);
    onChange([...next]);
  };
  return <fieldset className="erp-access-branches">
    <legend>{legend}</legend>
    {branches.length === 0 ? <p>No active branch is available in your scope.</p> : <div>
      {branches.map(branch => <label key={branch.id}>
        <input
          type="checkbox"
          aria-label={`${branch.name}${subject ? ` for ${subject}` : ''}`}
          checked={selected.has(branch.id)}
          disabled={disabled}
          onChange={e => toggle(branch.id, e.target.checked)}
        />
        <span>{branch.name}</span>
      </label>)}
    </div>}
  </fieldset>;
}

function groupedAdminAssignments(assignments) {
  const groups = new Map();
  for (const assignment of assignments || []) {
    const current = groups.get(assignment.userId) || {
      userId: assignment.userId,
      email: assignment.email || '',
      isSelf: Boolean(assignment.isSelf),
      activeBranchIds: [],
      suspendedBranchIds: [],
      status: 'suspended',
    };
    if (assignment.status === 'active') {
      current.activeBranchIds.push(assignment.branchId);
      current.status = 'active';
    } else {
      current.suspendedBranchIds.push(assignment.branchId);
    }
    current.email = current.email || assignment.email || '';
    current.isSelf = current.isSelf || Boolean(assignment.isSelf);
    groups.set(assignment.userId, current);
  }
  return [...groups.values()].sort((a, b) => a.email.localeCompare(b.email));
}

function InstructorAccessDialog({instructor, branches, erp, ctx, onClose, onSaved}) {
  const authorizedBranchIds = new Set(branches.map(branch => branch.id));
  const initialBranches = [...new Set([
    ...(instructor.accessBranchIds || []),
    ...(instructor.batchBranchIds || []),
    instructor.branchId,
  ].filter(branchId => branchId && authorizedBranchIds.has(branchId)))];
  const [email, setEmail] = useState(instructor.accessEmail || instructor.contactEmail || '');
  const [branchIds, setBranchIds] = useState(initialBranches);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isActive = instructor.accessStatus === 'active';
  const accessManager = canManageAccess(ctx);
  const grantBlocked = busy || !accessManager || instructor.recordStatus !== 'active' || Boolean(instructor.syncPending) || branchIds.length === 0;
  const revokeBlocked = busy || !accessManager || Boolean(instructor.syncPending);

  const run = async (action, successMessage) => {
    setBusy(true);
    setError('');
    try {
      await action(erp.client);
      await onSaved(successMessage);
      onClose();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const grant = event => {
    event.preventDefault();
    return run(
      client => client.grantInstructorAccess({instructorId: instructor.instructorId, email, branchIds}),
      `Instructor access saved for ${instructor.fullName}. They can sign in now and press Retry/Sync if the app is already open.`,
    );
  };
  const revoke = () => run(
    client => client.revokeInstructorAccess(instructor.instructorId),
    ctx.role === 'admin'
      ? `Instructor access removed in your branch scope for ${instructor.fullName}.`
      : `Instructor access removed for ${instructor.fullName}.`,
  );

  return <Dialog title="Instructor sign-in access" sub={`${instructor.fullName} will see a Students view limited to students actively enrolled in their assigned batches, plus their schedule, rosters, attendance, new own-batch enrollment, public admission-link sharing, and dues/receipts for those students. Admission requests, full student profiles, subscription management, unrelated finance and payment setup stay hidden.`} onClose={onClose}>
    <div style={{display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16}}>
      <span className={`erp-badge ${isActive ? 'green' : instructor.accessStatus === 'suspended' ? 'amber' : 'grey'}`}>
        {isActive ? 'Sign-in active' : instructor.accessStatus === 'suspended' ? 'Sign-in suspended' : 'No sign-in access'}
      </span>
      {instructor.accessEmail && <span style={{fontSize: 13}}>Linked sign-in: <b>{instructor.accessEmail}</b></span>}
    </div>

    <form className="erp-form" onSubmit={grant}>
      <label className="erp-field full">Instructor sign-in email
        <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="instructor@example.com"/>
      </label>
      <div style={{gridColumn: '1 / -1'}}>
        <BranchAccessChecks
          branches={branches}
          value={branchIds}
          onChange={setBranchIds}
          legend="Branches where this instructor may sign in"
          subject={instructor.fullName}
          disabled={busy}
        />
      </div>
      <div className="erp-banner blue" role="note" style={{gridColumn: '1 / -1', margin: 0}}>
        <KeyRound size={18}/>
        <div><b>Before granting access</b>
          <ol style={{margin: '6px 0 0 18px', padding: 0}}>
            <li>The instructor creates a Yoga Studio account with this exact email.</li>
            <li>The instructor opens the confirmation link sent to that email.</li>
            <li>The instructor must <b>not</b> create their own organization.</li>
          </ol>
          <span>One account has one ERP role. Changing the email replaces the previous sign-in for this instructor. Access changes require internet and are not saved in the offline queue.</span>
        </div>
      </div>
      {instructor.syncPending && <div className="erp-banner" role="note" style={{gridColumn: '1 / -1', margin: 0}}>
        <AlertCircle size={18}/><span>This instructor record is still waiting to sync. Connect to the internet and finish syncing before changing sign-in access.</span>
      </div>}
      {instructor.recordStatus !== 'active' && <div className="erp-banner" role="note" style={{gridColumn: '1 / -1', margin: 0}}>
        <AlertCircle size={18}/><span>This instructor is inactive, so sign-in is blocked. Reactivate the instructor record before granting access.</span>
      </div>}
      {error && <ErrorNotice error={error} context="Update instructor sign-in access" className="erp-form-error"/>}
      <div className="erp-form-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        <button className="primary-button" disabled={grantBlocked}>{busy ? 'Saving…' : isActive ? 'Update access' : 'Grant access'}</button>
      </div>
    </form>

    {isActive && <div style={{borderTop: '1px solid var(--border, #e7dff0)', marginTop: 20, paddingTop: 16}}>
      {!confirmRemove ? <div style={{display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap'}}>
        <span style={{fontSize: 13}}>{ctx.role === 'admin' ? 'Remove this instructor’s sign-in from branches you manage. Access in other branches is not changed.' : 'Remove this instructor’s sign-in without deleting their account or instructor record.'}</span>
        <button type="button" className="secondary-button erp-danger" disabled={revokeBlocked} onClick={() => setConfirmRemove(true)}>Remove access</button>
      </div> : <div className="erp-banner" role="alert" style={{margin: 0}}>
        <AlertCircle size={18}/>
        <div style={{flex: 1}}><b>Remove instructor access for {instructor.fullName}?</b><br/>
          {ctx.role === 'admin' ? 'Their account will stop loading batches in your branches on the next online Retry/Sync. Other branch access remains.' : 'Their account will stop loading this studio on the next online Retry/Sync. Batches and attendance history are not deleted.'}
          <div className="erp-actions" style={{marginTop: 10}}>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmRemove(false)}>Keep access</button>
            <button type="button" className="primary-button" disabled={revokeBlocked} onClick={revoke}>{busy ? 'Removing…' : 'Yes, remove access'}</button>
          </div>
        </div>
      </div>}
    </div>}
  </Dialog>;
}

export function RoleAccessPage(props) {
  const {erp, ctx, go} = props;
  const {data} = erp;
  const online = useOnline();
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [coOwnerEmail, setCoOwnerEmail] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [newAdminBranches, setNewAdminBranches] = useState([]);
  const [adminEdits, setAdminEdits] = useState({});
  const [instructorQuery, setInstructorQuery] = useState('');
  const [instructorAccess, setInstructorAccess] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);

  const load = useCallback(async (showLoading = true) => {
    if (props.mode !== 'supabase' || !erp.client?.listRoleAccess) return;
    if (showLoading) setLoading(true);
    setError('');
    try {
      setAccess(await erp.client.listRoleAccess());
    } catch (err) {
      setError(err);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [erp.client, props.mode]);

  useEffect(() => { load(); }, [load, online]);

  const actor = access?.actor || {};
  const primaryOwner = actor.canManageCoOwners ?? ctx.role === 'owner';
  const manageAdmins = actor.canManageAdmins ?? canManageOrg(ctx);
  const manageInstructors = actor.canManageInstructors ?? canManageAccess(ctx);
  const authorizedBranchIds = new Set(actor.branchIds || data.branches.map(branch => branch.id));
  const authorizedBranches = data.branches.filter(branch => branch.status === 'active' && authorizedBranchIds.has(branch.id));
  const adminGroups = groupedAdminAssignments(access?.adminAssignments || []);
  const snapshotInstructors = new Map(data.instructors.map(instructor => [instructor.id, instructor]));
  const instructors = (access?.instructors || []).map(instructor => ({
    ...instructor,
    syncPending: Boolean(snapshotInstructors.get(instructor.instructorId)?.syncPending),
  })).filter(instructor => `${instructor.fullName} ${instructor.contactEmail || ''} ${instructor.accessEmail || ''}`
    .toLowerCase().includes(instructorQuery.toLowerCase()));

  const run = async (key, action, successMessage, after) => {
    setBusyKey(key);
    setError('');
    setNotice('');
    try {
      await action(erp.client);
      await load(false);
      setNotice(successMessage);
      props.notify?.(successMessage);
      after?.();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusyKey('');
    }
  };

  const removeAccess = async () => {
    if (!removeTarget) return;
    const key = `remove-${removeTarget.kind}-${removeTarget.userId}`;
    const action = removeTarget.kind === 'co_owner'
      ? client => client.revokeCoOwnerAccess(removeTarget.userId)
      : client => client.revokeAdminAccess(removeTarget.userId);
    if (await run(key, action, `${removeTarget.label} access removed for ${removeTarget.email}.`)) {
      setRemoveTarget(null);
    }
  };

  const roleMatrix = [
    ['Owner', 'All branches', 'Everything, including Co-owner access and organization ownership safeguards', 'Primary Owner cannot be removed here'],
    ['Co-owner', 'All branches', 'All operations, payment setup, and Admin/Instructor/Student access', 'Cannot add/remove Owner or Co-owner'],
    ['Admin', 'Selected branches', 'Branch operations and Instructor/Student access in assigned branches', 'Cannot manage Admins, Co-owners, plans, payment setup or other branches'],
    ['Instructor', 'Assigned batches', 'Students view for own enrolled students; own schedule/rosters/attendance; new basic walk-in enrolment; public admission-link sharing; verified own-batch payment collection', 'No admission requests/details, full student editing, medical details, subscription lifecycle edits, payment voids, unrelated finance or access administration'],
    ['Student', 'Own records', 'View own batches, attendance, membership, dues, payments and PDFs', 'No ERP writes'],
  ];

  return <>
    <ErpBlockingState {...props}/>
    <div className="page-heading"><div className="eyebrow">STUDIO ERP</div><h1>Access <span className="flower">✳</span></h1><p>Role and branch authorization for every ERP sign-in.</p></div>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>

    {!canManageAccess(ctx) ? <section className="erp-panel">
      <Empty icon={KeyRound} title="Access administration is restricted" text="Only the Owner, Co-owner or a branch Admin can view and change ERP sign-in access."/>
    </section> : <>
      <section className="erp-panel">
        <div className="erp-panel-head"><div><h2>Your authorization</h2>
          <p>{props.mode === 'supabase'
            ? `${ROLE_LABELS[actor.primaryRole || ctx.role] || 'Manager'}${actor.email ? ` · ${actor.email}` : ''} · ${authorizedBranches.length} active branch(es) in scope`
            : 'Local-device role switching is presentation-only; real account access requires Supabase mode.'}</p></div>
          {props.mode === 'supabase' && <button className="secondary-button" onClick={() => load()} disabled={loading || !online}><RefreshCw size={15}/> Refresh access</button>}
        </div>
        <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Role</th><th>Scope</th><th>Authorized</th><th>Restricted</th></tr></thead><tbody>
          {roleMatrix.map(([role, scope, allowed, restricted]) => <tr key={role}><td><strong>{role}</strong></td><td>{scope}</td><td>{allowed}</td><td>{restricted}</td></tr>)}
        </tbody></table></div>
      </section>

      {props.mode !== 'supabase' ? <section className="erp-panel">
        <Empty icon={KeyRound} title="Use Supabase mode for real accounts" text="Switch Data mode to Supabase in Settings, run the latest supabase/erp_setup.sql, then grant each confirmed account exactly one role here."/>
      </section> : <>
        {!online && <div className="erp-banner" role="alert"><WifiOff size={18}/><span>You are offline. Role access changes are online-only and are never placed in the offline sync queue.</span></div>}
        {error && <ErrorNotice error={error} context="Load or update role access" onRetry={() => load()}/>}
        {notice && <div className="erp-banner blue" role="status"><Check size={18}/><span>{notice}</span></div>}
        {loading && <section className="erp-panel"><p style={{fontSize: 13}}>Loading role access…</p></section>}

        {!loading && access && <>
          {(manageAdmins || primaryOwner || ctx.role === 'co_owner') && <section className="erp-panel">
            <div className="erp-panel-head"><div><h2>Owner & Co-owners</h2><p>The primary Owner is protected. Co-owners operate all branches but cannot change ownership.</p></div></div>
            {(access.orgMembers || []).length === 0 ? <p style={{fontSize: 13}}>No organization members were returned.</p> :
            <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Account</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>
              {access.orgMembers.map(member => <tr key={`${member.userId}-${member.role}`}>
                <td><strong>{member.email || 'Account'}</strong>{member.isSelf ? <><br/><small>Your account</small></> : null}</td>
                <td>{ROLE_LABELS[member.role] || member.role}</td>
                <td><span className={`erp-badge ${member.status === 'active' ? 'green' : 'grey'}`}>{member.status}</span></td>
                <td>{member.role === 'owner'
                  ? <span className="erp-badge lavender">Primary Owner protected</span>
                  : primaryOwner && member.status === 'active'
                    ? <button className="erp-link-btn erp-danger" disabled={!online || Boolean(busyKey)} onClick={() => setRemoveTarget({kind: 'co_owner', userId: member.userId, email: member.email, label: 'Co-owner'})}>Remove Co-owner</button>
                    : <span style={{fontSize: 12}}>Owner only</span>}</td>
              </tr>)}
            </tbody></table></div>}
            {primaryOwner ? <form className="erp-form" style={{marginTop: 16}} onSubmit={event => {
              event.preventDefault();
              run('grant-co-owner', client => client.grantCoOwnerAccess({email: coOwnerEmail}), `Co-owner access granted for ${coOwnerEmail.trim().toLowerCase()}.`, () => setCoOwnerEmail(''));
            }}>
              <label className="erp-field">Co-owner sign-in email<input type="email" required autoComplete="email" value={coOwnerEmail} onChange={e => setCoOwnerEmail(e.target.value)} placeholder="partner@example.com"/></label>
              <div className="erp-form-actions"><button className="primary-button" disabled={!online || busyKey === 'grant-co-owner'}>{busyKey === 'grant-co-owner' ? 'Granting…' : 'Add Co-owner'}</button></div>
            </form> : <p style={{fontSize: 13, marginTop: 12}}>Only the primary Owner can add or remove a Co-owner.</p>}
          </section>}

          {manageAdmins && <section className="erp-panel">
            <div className="erp-panel-head"><div><h2>Branch Admins</h2><p>An Admin can operate and grant Instructor/Student access only in the selected branches.</p></div></div>
            <form className="erp-form" onSubmit={event => {
              event.preventDefault();
              run('grant-admin', client => client.grantAdminAccess({email: adminEmail, branchIds: newAdminBranches}), `Admin access saved for ${adminEmail.trim().toLowerCase()}.`, () => { setAdminEmail(''); setNewAdminBranches([]); });
            }}>
              <label className="erp-field">Admin sign-in email<input type="email" required autoComplete="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="desk@example.com"/></label>
              <div style={{gridColumn: '1 / -1'}}><BranchAccessChecks branches={authorizedBranches} value={newAdminBranches} onChange={setNewAdminBranches} legend="New Admin branches" disabled={Boolean(busyKey)}/></div>
              <div className="erp-form-actions"><button className="primary-button" disabled={!online || busyKey === 'grant-admin' || newAdminBranches.length === 0}>{busyKey === 'grant-admin' ? 'Saving…' : 'Grant Admin access'}</button></div>
            </form>

            {adminGroups.length === 0 ? <p style={{fontSize: 13, marginTop: 16}}>No branch Admin account has been granted yet.</p> :
            <div className="erp-table-wrap" style={{marginTop: 16}}><table className="erp-table"><thead><tr><th>Admin account</th><th>Status</th><th>Authorized branches</th><th>Actions</th></tr></thead><tbody>
              {adminGroups.map(group => {
                const selectedBranches = adminEdits[group.userId] ?? group.activeBranchIds;
                const busy = busyKey === `admin-${group.userId}`;
                return <tr key={group.userId}>
                  <td><strong>{group.email || 'Admin account'}</strong>{group.isSelf ? <><br/><small>Your account</small></> : null}</td>
                  <td><span className={`erp-badge ${group.status === 'active' ? 'green' : 'grey'}`}>{group.status}</span></td>
                  <td><BranchAccessChecks branches={authorizedBranches} value={selectedBranches} onChange={branchIds => setAdminEdits(prev => ({...prev, [group.userId]: branchIds}))} legend={`Branches for ${group.email || 'Admin'}`} subject={group.email || 'Admin'} disabled={busy}/></td>
                  <td><button className="erp-link-btn" disabled={!online || busy || selectedBranches.length === 0} onClick={() => run(`admin-${group.userId}`, client => client.grantAdminAccess({email: group.email, branchIds: selectedBranches}), `Branch access updated for ${group.email}.`)}>{busy ? 'Saving…' : 'Save branches'}</button>
                    {group.status === 'active' && <button className="erp-link-btn erp-danger" disabled={!online || Boolean(busyKey)} onClick={() => setRemoveTarget({kind: 'admin', userId: group.userId, email: group.email, label: 'Admin'})}>Remove Admin</button>}</td>
                </tr>;
              })}
            </tbody></table></div>}
          </section>}

          {manageInstructors && <section className="erp-panel">
            <div className="erp-panel-head"><div><h2>Instructor sign-ins</h2><p>Only the Owner, a Co-owner or an authorized branch Admin can grant or remove Instructor Portal access. Each account is linked to one instructor record and sees only that instructor’s batches in authorized branches.</p></div>
              <span className="erp-search"><Search size={16}/><input aria-label="Search instructors" placeholder="Search instructor or email…" value={instructorQuery} onChange={e => setInstructorQuery(e.target.value)}/></span>
            </div>
            {instructors.length === 0 ? <Empty icon={Users} title="No instructors in your scope" text="Add an instructor in Branches → Instructor profiles, sync the record, then grant sign-in access here."/> :
            <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Instructor</th><th>Branches</th><th>Sign-in</th><th>Actions</th></tr></thead><tbody>
              {instructors.map(instructor => {
                const accessBranchNames = (instructor.accessBranchIds || []).map(branchId => branchName(data, branchId)).filter(name => name !== '—');
                const batchBranchNames = (instructor.batchBranchIds || []).map(branchId => branchName(data, branchId)).filter(name => name !== '—');
                return <tr key={instructor.instructorId}>
                  <td><span className="erp-person"><span className="avatar">{initials(instructor.fullName)}</span><span><strong>{instructor.fullName}</strong><small>{instructor.contactEmail || instructor.phone || 'No contact email'}</small></span></span></td>
                  <td>{instructor.branchId ? `Home: ${branchName(data, instructor.branchId)}` : 'No home branch'}{batchBranchNames.length ? <><br/><small>Teaches: {batchBranchNames.join(', ')}</small></> : null}</td>
                  <td><span className={`erp-badge ${instructor.accessStatus === 'active' ? 'green' : instructor.accessStatus === 'suspended' ? 'amber' : 'grey'}`}>{instructor.accessStatus === 'active' ? 'Active' : instructor.accessStatus === 'suspended' ? 'Suspended' : 'No access'}</span>
                    {instructor.accessEmail && <><br/><small>{instructor.accessEmail}</small></>}
                    {accessBranchNames.length ? <><br/><small>{accessBranchNames.join(', ')}</small></> : null}
                    {instructor.syncPending && <><br/><span className="erp-badge amber">Waiting to sync</span></>}</td>
                  <td><button className="erp-link-btn" disabled={!online} onClick={() => setInstructorAccess(instructor)}><KeyRound size={13}/> Sign-in access</button></td>
                </tr>;
              })}
            </tbody></table></div>}
          </section>}

          <section className="erp-panel">
            <div className="erp-panel-head"><div><h2>Student portal access</h2><p>Student accounts stay with the student record so branch moves and inactivation stay synchronized.</p></div>
              <button className="primary-button" onClick={() => go('students')}><Users size={15}/> Open Students</button></div>
            <p style={{fontSize: 13}}>Use <b>Students → Portal access</b> on a student row to grant, replace or remove that student’s own-record portal sign-in.</p>
          </section>
        </>}
      </>}
    </>}

    {instructorAccess && manageInstructors && canManageAccess(ctx) && <InstructorAccessDialog
      instructor={instructorAccess}
      branches={authorizedBranches}
      erp={erp}
      ctx={ctx}
      onClose={() => setInstructorAccess(null)}
      onSaved={async message => { await load(false); setNotice(message); props.notify?.(message); }}
    />}

    {removeTarget && <Dialog title={`Remove ${removeTarget.label} access`} sub="The person’s account and studio records are not deleted. Access stops on the next online Retry/Sync." onClose={() => setRemoveTarget(null)}>
      <p style={{fontSize: 14}}>Remove <b>{removeTarget.label}</b> access for <b>{removeTarget.email}</b>?</p>
      {error && <ErrorNotice error={error} context="Remove role access"/>}
      <div className="erp-form-actions">
        <button className="secondary-button" disabled={Boolean(busyKey)} onClick={() => setRemoveTarget(null)}>Keep access</button>
        <button className="primary-button" disabled={!online || Boolean(busyKey)} onClick={removeAccess}>{busyKey ? 'Removing…' : `Yes, remove ${removeTarget.label} access`}</button>
      </div>
    </Dialog>}
  </>;
}

/* ---------------- batches & instructors ---------------- */

function InstructorProfilesSection(props) {
  const {erp, ctx, go, onShowBatches} = props; const {data} = erp;
  const [form, setForm] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const today = toISODate();

  const statsFor = instructor => {
    const batches = data.batches.filter(batch => batch.instructorId === instructor.id);
    const activeBatches = batches.filter(batch => batch.status === 'active');
    const batchIds = new Set(activeBatches.map(batch => batch.id));
    const studentIds = new Set(data.enrollments
      .filter(enrollment => enrollment.status === 'active' && batchIds.has(enrollment.batchId))
      .map(enrollment => enrollment.studentId));
    const nextClasses = activeBatches
      .map(batch => ({batch, date: nextBatchDate(batch, today)}))
      .filter(item => item.date)
      .sort((a, b) => a.date.localeCompare(b.date)
        || String(a.batch.startTime || '').localeCompare(String(b.batch.startTime || ''))
        || a.batch.name.localeCompare(b.batch.name));
    const taughtBranchIds = [...new Set(activeBatches.map(batch => batch.branchId).filter(Boolean))];
    return {
      activeBatches,
      studentCount: studentIds.size,
      nextClass: nextClasses[0] || null,
      taughtBranches: taughtBranchIds.map(id => branchName(data, id)),
    };
  };

  const canEditInstructor = instructor => canManageOrg(ctx)
    || (ctx.role === 'admin' && instructor.branchId
      && data.branches.some(branch => branch.id === instructor.branchId && branch.status !== 'archived'));

  const visibleInstructors = data.instructors
    .map(instructor => ({instructor, profile: normalizeInstructorProfile(instructor), stats: statsFor(instructor)}))
    .filter(({instructor, profile, stats}) => {
      const branchRelevant = inBranch(ctx, instructor.branchId)
        || !instructor.branchId
        || stats.activeBatches.some(batch => inBranch(ctx, batch.branchId));
      if (!branchRelevant) return false;
      if (statusFilter !== 'all' && (instructor.status || 'active') !== statusFilter) return false;
      const needle = query.trim().toLocaleLowerCase('en-IN');
      if (!needle) return true;
      return [instructor.fullName, instructor.email, instructor.phone, profile.bio,
        profile.qualifications, ...profile.specialties]
        .join(' ').toLocaleLowerCase('en-IN').includes(needle);
    })
    .sort((a, b) => Number((b.instructor.status || 'active') === 'active')
      - Number((a.instructor.status || 'active') === 'active')
      || a.instructor.fullName.localeCompare(b.instructor.fullName));

  const summary = {
    active: data.instructors.filter(instructor => (instructor.status || 'active') === 'active').length,
    batches: data.batches.filter(batch => batch.status === 'active' && batch.instructorId).length,
    students: new Set(data.enrollments.filter(enrollment => enrollment.status === 'active'
      && data.batches.some(batch => batch.id === enrollment.batchId && batch.instructorId)).map(enrollment => enrollment.studentId)).size,
    specialties: new Set(data.instructors.flatMap(instructor => normalizeInstructorProfile(instructor).specialties
      .map(specialty => specialty.toLocaleLowerCase('en-IN')))).size,
  };

  const openNew = () => setForm({
    fullName: '', phone: '', email: '', branchId: ctx.branchId !== 'all' ? ctx.branchId : (data.branches[0]?.id || ''),
    bio: '', specialties: '', qualifications: '', experienceYears: 0, joiningDate: today, status: 'active',
  });
  const openEdit = instructor => {
    const profile = normalizeInstructorProfile(instructor);
    setForm({
      ...instructor,
      ...profile,
      specialties: profile.specialties.join(', '),
      status: instructor.status || 'active',
    });
  };
  const saveInstructor = async event => {
    event.preventDefault();
    if (!canSetupInstructorProfiles(ctx)) return;
    const payload = {...form, ...normalizeInstructorProfile(form)};
    if (await erp.act(c => c.saveInstructor(payload), form.id ? 'Instructor profile updated.' : 'Instructor saved.')) {
      setForm(null);
    }
  };

  if (!canSetupInstructorProfiles(ctx)) return null;
  return <>
    <section className="erp-panel">
      <div className="erp-panel-head align-end">
        <div>
          <h2>Instructor profiles</h2>
          <p>{data.instructors.length} instructor(s) · Teaching profiles can be set up only by the Owner, Co-owner or an authorized branch Admin.</p>
        </div>
        <div className="erp-actions">
          <span className="erp-search"><Search size={15}/><input aria-label="Search instructors" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or specialty…"/></span>
          <label className="erp-field erp-instructor-status-filter">Status<select aria-label="Instructor status filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
          <button className="secondary-button" onClick={() => go('access')}><KeyRound size={15}/> Portal access</button>
          <button className="primary-button" onClick={openNew}><Plus size={15}/> Add instructor</button>
        </div>
      </div>

      <div className="erp-instructor-summary" aria-label="Instructor summary">
        <span><strong>{summary.active}</strong> active instructor(s)</span>
        <span><strong>{summary.batches}</strong> assigned active batch(es)</span>
        <span><strong>{summary.students}</strong> student(s) taught</span>
        <span><strong>{summary.specialties}</strong> specialty/style tag(s)</span>
      </div>

      {data.instructors.length === 0 ? <Empty icon={Users} title="No instructors yet" text="Add an instructor profile before assigning a teacher to a batch." action={<button className="primary-button" onClick={openNew}><Plus size={15}/> Add first instructor</button>}/>
        : visibleInstructors.length === 0 ? <Empty icon={Search} title="No matching instructors" text="Try a different name, specialty or status filter."/>
        : <div className="erp-instructor-grid">
          {visibleInstructors.map(({instructor, profile, stats}) => {
            const status = instructor.status || 'active';
            const editable = canEditInstructor(instructor);
            return <article className={`erp-instructor-card ${status === 'inactive' ? 'inactive' : ''}`} key={instructor.id}>
              <header>
                <span className="erp-instructor-avatar" aria-hidden="true">{initials(instructor.fullName)}</span>
                <div>
                  <h3>{instructor.fullName}</h3>
                  <p><Building2 size={13}/> {instructor.branchId ? branchName(data, instructor.branchId) : 'All branches'}</p>
                </div>
                <span className={`erp-badge ${status === 'active' ? 'green' : 'grey'}`}>{status}</span>
              </header>

              <p className="erp-instructor-bio">{profile.bio || 'No instructor bio added yet.'}</p>
              {profile.specialties.length > 0 && <div className="erp-instructor-tags" aria-label="Instructor specialties">
                {profile.specialties.map(specialty => <span key={specialty}>{specialty}</span>)}
              </div>}

              <dl className="erp-instructor-stats">
                <div><dt>Batches</dt><dd>{stats.activeBatches.length}</dd></div>
                <div><dt>Students</dt><dd>{stats.studentCount}</dd></div>
                <div><dt>Experience</dt><dd>{profile.experienceYears ? `${profile.experienceYears} yr${profile.experienceYears === 1 ? '' : 's'}` : '—'}</dd></div>
                <div><dt>Joined</dt><dd>{profile.joiningDate ? formatDate(profile.joiningDate) : '—'}</dd></div>
              </dl>

              <div className="erp-instructor-details">
                {profile.qualifications && <p><Check size={14}/><span><strong>Qualifications:</strong> {profile.qualifications}</span></p>}
                {stats.taughtBranches.length > 0 && <p><Building2 size={14}/><span><strong>Teaches at:</strong> {stats.taughtBranches.join(', ')}</span></p>}
                {stats.nextClass && <p><CalendarClock size={14}/><span><strong>Next class:</strong> {stats.nextClass.batch.name} · {stats.nextClass.date === today ? 'Today' : formatDate(stats.nextClass.date)} · {batchTimeLabel(stats.nextClass.batch)}</span></p>}
                {(instructor.phone || instructor.email) && <p><Users size={14}/><span>{[instructor.phone, instructor.email].filter(Boolean).join(' · ')}</span></p>}
              </div>

              <footer>
                <button className="erp-link-btn" disabled={!editable} aria-label={`Edit profile for ${instructor.fullName}`} title={editable ? '' : 'Only an Owner, Co-owner or this instructor’s branch Admin can edit this profile.'} onClick={() => openEdit(instructor)}><Pencil size={13}/> Edit profile</button>
                {onShowBatches && <button className="erp-link-btn" aria-label={`View batches for ${instructor.fullName}`} onClick={onShowBatches}><Clock size={13}/> View batches</button>}
                <button className="erp-link-btn" aria-label={`Portal access for ${instructor.fullName}`} onClick={() => go('access')}><KeyRound size={13}/> Portal access</button>
              </footer>
            </article>;
          })}
        </div>}
    </section>

    {form && <Dialog title={form.id ? 'Edit instructor profile' : 'Add instructor'} sub="Profile setup is separate from sign-in access. Grant or change the Instructor portal login in Access after saving." onClose={() => setForm(null)} className="erp-dialog-wide">
      <form className="erp-form" onSubmit={saveInstructor}>
        <label className="erp-field">Instructor name<input required value={form.fullName} onChange={event => setForm({...form, fullName: event.target.value})} placeholder="e.g. Meera Joshi"/></label>
        <label className="erp-field">Branch<select required={!canManageOrg(ctx)} value={form.branchId || ''} onChange={event => setForm({...form, branchId: event.target.value})}>{canManageOrg(ctx) ? <option value="">All branches</option> : <option value="">Choose branch…</option>}{data.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label className="erp-field">Phone<input type="tel" value={form.phone || ''} onChange={event => setForm({...form, phone: event.target.value})} autoComplete="tel"/></label>
        <label className="erp-field">Email<input type="email" value={form.email || ''} onChange={event => setForm({...form, email: event.target.value})} autoComplete="email"/></label>
        <label className="erp-field full">Specialties / styles<input value={form.specialties || ''} onChange={event => setForm({...form, specialties: event.target.value})} placeholder="Hatha, yin, Breathwork" maxLength={500}/><small>Separate up to 12 styles with commas.</small></label>
        <label className="erp-field">Experience (years)<input type="number" min={0} max={80} step={1} value={form.experienceYears ?? 0} onChange={event => setForm({...form, experienceYears: event.target.value})}/></label>
        <label className="erp-field">Joining date<input type="date" value={form.joiningDate || ''} onChange={event => setForm({...form, joiningDate: event.target.value})}/></label>
        <label className="erp-field full">Qualifications / certifications<textarea rows={2} maxLength={500} value={form.qualifications || ''} onChange={event => setForm({...form, qualifications: event.target.value})} placeholder="e.g. RYT-500 · Prenatal yoga certificate"/></label>
        <label className="erp-field full">Instructor bio<textarea rows={4} maxLength={1000} value={form.bio || ''} onChange={event => setForm({...form, bio: event.target.value})} placeholder="Teaching approach, class focus and experience…"/></label>
        <label className="erp-field">Profile status<select value={form.status || 'active'} onChange={event => setForm({...form, status: event.target.value})}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setForm(null)}>Cancel</button><button className="primary-button">Save instructor</button></div>
      </form>
    </Dialog>}
  </>;
}

function BatchesSection(props) {
  const {erp, ctx, go, onShowBranches} = props; const {data} = erp;
  const [editing, setEditing] = useState(null); const [roster, setRoster] = useState(null);
  const [enrollmentBatch, setEnrollmentBatch] = useState(null);
  const [addStudentId, setAddStudentId] = useState('');
  const [rosterQuery, setRosterQuery] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [dayFilter, setDayFilter] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] = useState('all');
  const [sortBy, setSortBy] = useState('next');
  const [view, setView] = useState('list');
  const today = toISODate();
  const isStudent = ctx.role === 'student';

  const baseBatches = data.batches.filter(b => inBranch(ctx, b.branchId)
    && (ctx.role !== 'instructor' || b.instructorId === ctx.instructorId)
    && (ctx.role !== 'student' || data.enrollments.some(e => e.batchId === b.id && e.studentId === ctx.studentId && e.status === 'active')));
  const batchRowsAll = baseBatches.map(batch => ({
    batch,
    metrics: batchWorkspaceMetrics(data, batch, today, isStudent ? ctx.studentId : ''),
    branch: branchName(data, batch.branchId),
    instructor: instructorName(data, batch.instructorId),
    studentEnrollment: isStudent
      ? data.enrollments.find(enrollment => enrollment.batchId === batch.id
        && enrollment.studentId === ctx.studentId && enrollment.status === 'active') || null
      : null,
  }));
  const activeRows = batchRowsAll.filter(row => row.batch.status === 'active');
  const archivedCount = batchRowsAll.length - activeRows.length;
  const activeBatchIds = new Set(activeRows.map(row => row.batch.id));
  const summary = {
    todayClasses: activeRows.filter(row => isBatchOnDate(row.batch, today)).length,
    weeklyClasses: activeRows.reduce((sum, row) => sum + row.metrics.weeklyClasses, 0),
    enrolled: activeRows.reduce((sum, row) => sum + row.metrics.fill.enrolled, 0),
    capacity: activeRows.reduce((sum, row) => sum + row.metrics.fill.capacity, 0),
    uniqueStudents: new Set(data.enrollments
      .filter(enrollment => enrollment.status === 'active' && activeBatchIds.has(enrollment.batchId))
      .map(enrollment => enrollment.studentId)).size,
    nextClass: activeRows
      .filter(row => row.metrics.nextDate)
      .sort((a, b) => a.metrics.nextDate.localeCompare(b.metrics.nextDate)
        || String(a.batch.startTime || '').localeCompare(String(b.batch.startTime || ''))
        || a.batch.name.localeCompare(b.batch.name))[0] || null,
  };
  summary.fillPercent = summary.capacity > 0 ? Math.round((summary.enrolled / summary.capacity) * 100) : 0;
  summary.seatsLeft = Math.max(0, summary.capacity - summary.enrolled);

  const scheduleConflicts = isStudent ? [] : findInstructorScheduleConflicts(baseBatches);
  const attentionItems = [];
  if (!isStudent) {
    for (const conflict of scheduleConflicts) {
      attentionItems.push(`${instructorName(data, conflict.instructorId)} has overlapping batches: ${conflict.batches[0].name} and ${conflict.batches[1].name} (${conflict.days.map(day => DAY_LABELS[day]).join(', ')}).`);
    }
    for (const row of activeRows.filter(item => item.metrics.fill.status === 'full')) {
      attentionItems.push(`${row.batch.name} is full (${row.metrics.fill.enrolled}/${row.metrics.fill.capacity}).`);
    }
    if (canManage(ctx)) {
      for (const row of activeRows.filter(item => !item.batch.instructorId)) {
        attentionItems.push(`${row.batch.name} does not have an instructor assigned.`);
      }
    }
    for (const row of activeRows.filter(item => item.metrics.fill.status === 'empty')) {
      attentionItems.push(`${row.batch.name} has no active students yet.`);
    }
  }

  const batchRows = batchRowsAll
    .filter(row => {
      const {batch, metrics} = row;
      if (statusFilter !== 'all' && batch.status !== statusFilter) return false;
      if (dayFilter === 'today' && !isBatchOnDate(batch, today)) return false;
      if (dayFilter !== 'all' && dayFilter !== 'today'
          && !(batch.days || []).map(Number).includes(Number(dayFilter))) return false;
      if (!isStudent) {
        if (availabilityFilter === 'seats' && metrics.fill.seatsLeft <= 0) return false;
        if (availabilityFilter === 'almost' && metrics.fill.status !== 'almost_full') return false;
        if (availabilityFilter === 'full' && metrics.fill.status !== 'full') return false;
        if (availabilityFilter === 'empty' && metrics.fill.status !== 'empty') return false;
        if (availabilityFilter === 'unassigned' && batch.instructorId) return false;
      }
      const needle = query.trim().toLocaleLowerCase('en-IN');
      if (!needle) return true;
      return [batch.name, row.branch, row.instructor, batchDaySummary(batch), batchTimeLabel(batch)]
        .join(' ').toLocaleLowerCase('en-IN').includes(needle);
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.batch.name.localeCompare(b.batch.name);
      if (sortBy === 'start') return String(a.batch.startTime || '').localeCompare(String(b.batch.startTime || ''))
        || a.batch.name.localeCompare(b.batch.name);
      if (!isStudent && sortBy === 'fill-desc') return b.metrics.fill.percent - a.metrics.fill.percent
        || b.metrics.fill.enrolled - a.metrics.fill.enrolled || a.batch.name.localeCompare(b.batch.name);
      if (!isStudent && sortBy === 'fill-asc') return a.metrics.fill.percent - b.metrics.fill.percent
        || a.metrics.fill.enrolled - b.metrics.fill.enrolled || a.batch.name.localeCompare(b.batch.name);
      return (a.metrics.nextDate || '9999-12-31').localeCompare(b.metrics.nextDate || '9999-12-31')
        || String(a.batch.startTime || '').localeCompare(String(b.batch.startTime || ''))
        || a.batch.name.localeCompare(b.batch.name);
    });

  const filtersActive = query || statusFilter !== 'active' || dayFilter !== 'all'
    || availabilityFilter !== 'all' || sortBy !== 'next';
  const clearFilters = () => {
    setQuery(''); setStatusFilter('active'); setDayFilter('all');
    setAvailabilityFilter('all'); setSortBy('next');
  };
  const openRoster = batch => { setRoster(batch); setAddStudentId(''); setRosterQuery(''); };
  const closeRoster = () => { setRoster(null); setAddStudentId(''); setRosterQuery(''); };
  const duplicateBatch = batch => setEditing({
    name: `${batch.name} copy`, branchId: batch.branchId, instructorId: batch.instructorId || '',
    days: [...(batch.days || [])], startTime: batch.startTime || '07:00',
    durationMins: batch.durationMins || 60, capacity: batch.capacity || 20,
  });

  const toggleDay = day => setEditing(prev => ({...prev, days: prev.days.includes(day) ? prev.days.filter(d => d !== day) : [...prev.days, day]}));
  const saveBatch = async e => { e.preventDefault(); if (!editing.days.length) return; if (await erp.act(c => c.saveBatch(editing), 'Batch saved.')) setEditing(null); };
  const rosterList = roster ? data.enrollments
    .filter(e => e.batchId === roster.id && e.status === 'active')
    .sort((a, b) => studentName(data, a.studentId).localeCompare(studentName(data, b.studentId))) : [];
  const visibleRosterList = rosterList.filter(enrollment => (
    !rosterQuery.trim()
    || studentName(data, enrollment.studentId).toLocaleLowerCase('en-IN')
      .includes(rosterQuery.trim().toLocaleLowerCase('en-IN'))
  ));
  const addable = roster ? data.students
    .filter(s => s.status === 'active' && s.branchId === roster.branchId && !rosterList.some(e => e.studentId === s.id))
    .sort((a, b) => a.fullName.localeCompare(b.fullName)) : [];
  const rosterEditable = canEditBatchRoster(ctx, roster);
  const seatsLeft = roster ? Math.max(0, Number(roster.capacity || 0) - rosterList.length) : 0;
  const rosterFill = roster ? batchFill(roster, data.enrollments) : null;
  const editingEnrolled = editing?.id
    ? data.enrollments.filter(enrollment => enrollment.batchId === editing.id && enrollment.status === 'active').length
    : 0;
  const editingConflicts = editing?.instructorId
    ? data.batches
      .filter(other => other.id !== editing.id && other.status === 'active'
        && other.instructorId === editing.instructorId)
      .map(other => ({batch: other, days: batchOverlapDays(editing, other)}))
      .filter(item => item.days.length)
    : [];
  return <>
    {baseBatches.length > 0 && <div className="erp-grid erp-workspace-summary" aria-label="Batch summary">
      {isStudent ? <>
        <div className="erp-kpi"><small>Assigned batches</small><strong>{activeRows.length}</strong><p>Only batches you are enrolled in</p></div>
        <div className="erp-kpi"><small>Classes today</small><strong>{summary.todayClasses}</strong><p>{formatDate(today)}</p></div>
        <div className="erp-kpi"><small>Classes each week</small><strong>{summary.weeklyClasses}</strong><p>Across your assigned batches</p></div>
        <div className="erp-kpi"><small>Next class</small><strong className="erp-kpi-text">{summary.nextClass?.batch.name || 'None'}</strong><p>{summary.nextClass ? `${relativeClassDateLabel(summary.nextClass.metrics.nextDate, today)} · ${batchTimeLabel(summary.nextClass.batch)}` : 'No class in the next 7 days'}</p></div>
      </> : <>
        <div className="erp-kpi"><small>{ctx.role === 'instructor' ? 'My active batches' : 'Active batches'}</small><strong>{activeRows.length}</strong><p>{archivedCount} archived</p></div>
        <div className="erp-kpi"><small>Classes today</small><strong>{summary.todayClasses}</strong><p>{summary.weeklyClasses} recurring class(es)/week</p></div>
        <div className="erp-kpi"><small>{ctx.role === 'instructor' ? 'My students' : 'Enrolled students'}</small><strong>{summary.uniqueStudents}</strong><p>{summary.enrolled} active batch enrollment(s)</p></div>
        <div className="erp-kpi"><small>Seat fill</small><strong>{summary.fillPercent}%</strong><p>{summary.enrolled}/{summary.capacity} seats · {summary.seatsLeft} available</p></div>
      </>}
    </div>}

    {attentionItems.length > 0 && <div className="erp-banner erp-attention-banner" role="note">
      <AlertCircle size={18}/>
      <div><strong>Needs attention</strong>
        <ul>{attentionItems.slice(0, 5).map(item => <li key={item}>{item}</li>)}</ul>
        {attentionItems.length > 5 && <small>And {attentionItems.length - 5} more item(s). Use the batch filters below to review them.</small>}
      </div>
    </div>}

    <section className="erp-panel"><div className="erp-panel-head"><div><h2>{ctx.role === 'instructor' ? 'My batches' : ctx.role === 'student' ? 'My batches' : 'Batch workspace'}</h2><p>{batchRows.length} of {baseBatches.length} batch(es) shown{ctx.role === 'instructor' ? ' · Open Roster to add or remove students in your assigned batches.' : ''}</p></div>
      <div className="erp-actions">
        {canUseEnrollmentWizard(ctx) && <button className="secondary-button" onClick={() => setEnrollmentBatch({})}><Sparkles size={15}/> Enroll &amp; collect</button>}
        {canManage(ctx) && <button className="primary-button" onClick={() => setEditing({name: '', branchId: ctx.branchId !== 'all' ? ctx.branchId : (data.branches[0]?.id || ''), instructorId: '', days: [1, 2, 3, 4, 5], startTime: '07:00', durationMins: 60, capacity: 20})}><Plus size={16}/> Add batch</button>}
      </div></div>

      {baseBatches.length > 0 && <div className="erp-workspace-controls" aria-label="Batch filters">
        <label className="erp-search"><Search size={16}/><input aria-label="Search batches" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search batch, branch or instructor…"/></label>
        <label className="erp-field erp-workspace-field">Status<select aria-label="Batch status filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="active">Active</option><option value="all">All statuses</option><option value="archived">Archived</option>
        </select></label>
        <label className="erp-field erp-workspace-field">Day<select aria-label="Batch day filter" value={dayFilter} onChange={event => setDayFilter(event.target.value)}>
          <option value="all">Any day</option><option value="today">Today</option>
          {WEEK_ORDER.map(day => <option key={day} value={String(day)}>{FULL_DAY_LABELS[day]}</option>)}
        </select></label>
        {!isStudent && <label className="erp-field erp-workspace-field">Availability<select aria-label="Batch availability filter" value={availabilityFilter} onChange={event => setAvailabilityFilter(event.target.value)}>
          <option value="all">Any availability</option><option value="seats">Seats available</option><option value="almost">Almost full</option><option value="full">Full</option><option value="empty">Empty</option><option value="unassigned">Instructor unassigned</option>
        </select></label>}
        <label className="erp-field erp-workspace-field">Sort by<select aria-label="Sort batches" value={sortBy} onChange={event => setSortBy(event.target.value)}>
          <option value="next">Next class</option><option value="name">Name</option><option value="start">Start time</option>
          {!isStudent && <option value="fill-desc">Highest seat fill</option>}
          {!isStudent && <option value="fill-asc">Lowest seat fill</option>}
        </select></label>
        <div className="erp-seg erp-view-toggle" aria-label="Batch view">
          <button type="button" aria-pressed={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><List size={14}/> List</button>
          <button type="button" aria-pressed={view === 'schedule'} className={view === 'schedule' ? 'on' : ''} onClick={() => setView('schedule')}><LayoutGrid size={14}/> Schedule</button>
        </div>
        {filtersActive && <button type="button" className="secondary-button" onClick={clearFilters}>Clear filters</button>}
      </div>}

      {data.branches.length === 0 && canManage(ctx) ? <Empty icon={Building2} title="Add a branch first" text="Batches run at a branch." action={<button className="primary-button" onClick={() => (onShowBranches ? onShowBranches() : go('branches'))}>Go to Branches</button>}/> :
      baseBatches.length === 0 ? <Empty icon={Clock} title={ctx.role === 'student' ? 'No assigned batches yet' : 'No batches here'} text={ctx.role === 'instructor' && !ctx.instructorId ? 'Choose “Acting instructor” above to see assigned batches.' : ctx.role === 'student' && !ctx.studentId ? 'Choose “Acting student” above to see assigned batches.' : ctx.role === 'student' ? 'When the studio enrolls you in a batch, it will appear here.' : 'Create a batch with days and a start time, then enroll students.'}/> :
      batchRows.length === 0 ? <Empty icon={Search} title="No batches match" text="Try a different day, status or availability filter." action={<button className="secondary-button" onClick={clearFilters}>Clear filters</button>}/> :
      view === 'schedule' ? <div className="erp-schedule-wrap">
        <p className="erp-schedule-note">Recurring weekly timetable{isStudent ? ' for your assigned batches only' : ''}. Times use each batch’s saved start time and duration.</p>
        <div className="erp-schedule-grid">
          {WEEK_ORDER.map(day => {
            const dayRows = batchRows
              .filter(row => (row.batch.days || []).map(Number).includes(day))
              .sort((a, b) => String(a.batch.startTime || '').localeCompare(String(b.batch.startTime || ''))
                || a.batch.name.localeCompare(b.batch.name));
            const isToday = new Date(`${today}T12:00:00`).getDay() === day;
            return <section className={`erp-schedule-day ${isToday ? 'today' : ''}`} key={day} aria-label={`${FULL_DAY_LABELS[day]} schedule`}>
              <header><div><h3>{FULL_DAY_LABELS[day]}</h3><small>{dayRows.length} class(es)</small></div>{isToday && <span className="erp-badge lavender">Today</span>}</header>
              {dayRows.length === 0 ? <p className="erp-schedule-empty">No classes</p> : dayRows.map(row => <article className={`erp-schedule-class ${row.batch.status === 'archived' ? 'archived' : ''}`} key={`${day}-${row.batch.id}`}>
                <strong>{row.batch.name}</strong>
                <span>{batchTimeLabel(row.batch)}</span>
                <small>{row.branch} · {row.instructor}</small>
                {!isStudent && <small>{row.metrics.fill.enrolled}/{row.metrics.fill.capacity} students · {row.metrics.fill.seatsLeft} seat(s) left</small>}
                {row.batch.status === 'archived' && <span className="erp-badge grey">Archived</span>}
                {!isStudent && <button type="button" className="erp-link-btn" onClick={() => openRoster(row.batch)}><Users size={13}/> Roster</button>}
              </article>)}
            </section>;
          })}
        </div>
      </div> :
      <div className="erp-batch-grid">
        {batchRows.map(row => {
          const {batch, metrics} = row;
          const archived = batch.status === 'archived';
          const isToday = batch.status === 'active' && isBatchOnDate(batch, today);
          return <article className={`erp-batch-card ${archived ? 'archived' : ''}`} key={batch.id} aria-label={`${batch.name} batch`}>
            <header>
              <div><h3>{batch.name}</h3><p><MapPin size={13}/> {row.branch}</p></div>
              <span className={`erp-badge ${archived ? 'grey' : 'green'}`}>{archived ? 'Archived' : 'Active'}</span>
            </header>

            <div className="erp-person erp-batch-teacher">
              <span className="avatar">{initials(batch.instructorId ? row.instructor : '?')}</span>
              <span><strong>{row.instructor}</strong><small>{batch.instructorId ? 'Instructor' : 'Instructor not assigned'}</small></span>
            </div>

            <div className="erp-batch-time"><Clock size={15}/><span>{batchTimeLabel(batch)} · {Number(batch.durationMins) || 60} min</span></div>
            <div className="erp-batch-days" aria-label={`Class days for ${batch.name}`}>
              {WEEK_ORDER.map(day => <span key={day} className={(batch.days || []).map(Number).includes(day) ? 'on' : ''}>{DAY_LABELS[day]}</span>)}
            </div>

            <div className="erp-card-badges">
              {isToday && <span className="erp-badge lavender">Class today</span>}
              {!isStudent && metrics.fill.status === 'full' && <span className="erp-badge red">Full</span>}
              {!isStudent && metrics.fill.status === 'almost_full' && <span className="erp-badge amber">Almost full</span>}
              {!isStudent && metrics.fill.status === 'empty' && batch.status === 'active' && <span className="erp-badge grey">No students yet</span>}
              {!isStudent && !batch.instructorId && <span className="erp-badge amber">Needs instructor</span>}
              {isStudent && <span className="erp-badge green">Enrolled</span>}
            </div>

            <div className="erp-card-meta">
              <p><CalendarClock size={14}/><span>Next class: <strong>{relativeClassDateLabel(metrics.nextDate, today)}</strong>{metrics.nextDate ? ` · ${batchTimeLabel(batch)}` : ''}</span></p>
              <p><CalendarCheck size={14}/><span>{metrics.weeklyClasses} class(es)/week · {metrics.attendanceRate === null
                ? (isStudent ? 'No attendance recorded in the last 30 days' : 'No attendance in the last 30 days')
                : `${isStudent ? 'My attendance' : 'Attendance'} (30 days): ${metrics.attendanceRate}%`}</span></p>
              {isStudent && row.studentEnrollment?.joinedOn && <p><Check size={14}/><span>Joined {formatDate(row.studentEnrollment.joinedOn)}</span></p>}
            </div>

            {!isStudent && <div className="erp-capacity-block">
              <div className="erp-capacity-head"><strong>{metrics.fill.enrolled}/{metrics.fill.capacity} students</strong><span>{metrics.fill.percent}% full</span></div>
              <div className="erp-progress" role="progressbar" aria-label={`${batch.name} seat fill`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(100, metrics.fill.percent)}>
                <span className={metrics.fill.status === 'full' ? 'full' : metrics.fill.status === 'almost_full' ? 'almost' : ''} style={{width: `${Math.min(100, metrics.fill.percent)}%`}}/>
              </div>
              <small>{metrics.fill.seatsLeft} seat(s) available</small>
            </div>}

            {!isStudent && <footer className="erp-card-actions">
              <button type="button" className="secondary-button" onClick={() => openRoster(batch)}><Users size={14}/> Roster</button>
              {canEditBatchRoster(ctx, batch) && <button type="button" className="erp-link-btn" onClick={() => setEnrollmentBatch(batch)}><Sparkles size={13}/> Enroll</button>}
              {canManage(ctx) && <button type="button" className="erp-link-btn" onClick={() => duplicateBatch(batch)}><Copy size={13}/> Duplicate</button>}
              {canManage(ctx) && <button type="button" className="erp-link-btn" onClick={() => setEditing({...batch})}><Pencil size={13}/> Edit</button>}
              {canManage(ctx) && <button type="button" className="erp-link-btn" onClick={() => erp.act(c => c.archiveBatch(batch.id), archived ? 'Batch restored.' : 'Batch archived.')}>{archived ? 'Restore' : 'Archive'}</button>}
            </footer>}
          </article>;
        })}
      </div>}
    </section>
    {editing && <Dialog title={editing.id ? 'Edit batch' : 'Add batch'} sub="Classes are 60 minutes by default — adjust only if your studio differs." onClose={() => setEditing(null)}>
      <form className="erp-form" onSubmit={saveBatch}>
        <label className="erp-field">Batch name<input required value={editing.name} onChange={e => setEditing({...editing, name: e.target.value})} placeholder="e.g. Morning Hatha"/></label>
        <label className="erp-field">Branch<select aria-label="Batch branch" required value={editing.branchId} onChange={e => setEditing({...editing, branchId: e.target.value})}><option value="">Choose branch…</option>{data.branches.filter(b => b.status !== 'archived').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="erp-field">Instructor<select aria-label="Batch instructor" value={editing.instructorId} onChange={e => setEditing({...editing, instructorId: e.target.value})}><option value="">Not assigned</option>{data.instructors.map(i => <option key={i.id} value={i.id}>{i.fullName}</option>)}</select></label>
        <label className="erp-field">Start time<input type="time" required value={editing.startTime} onChange={e => setEditing({...editing, startTime: e.target.value})}/></label>
        <label className="erp-field">Duration (minutes)<input type="number" min={15} step={5} value={editing.durationMins} onChange={e => setEditing({...editing, durationMins: e.target.value})}/></label>
        <label className="erp-field">Capacity<input type="number" min={1} value={editing.capacity} onChange={e => setEditing({...editing, capacity: e.target.value})}/></label>
        <div className="erp-field full"><span>Class days</span><div className="erp-days">{DAY_LABELS.map((label, day) => <button type="button" key={label} className={`erp-day ${editing.days.includes(day) ? 'on' : ''}`} aria-pressed={editing.days.includes(day)} onClick={() => toggleDay(day)}>{label}</button>)}</div>
          {!editing.days.length && <small className="erp-field-warning">Choose at least one class day before saving.</small>}</div>
        {editingEnrolled > Math.max(0, Number(editing.capacity) || 0) && <div className="erp-banner" role="note" style={{gridColumn: '1 / -1', margin: 0}}>
          <AlertCircle size={18}/><span>This capacity is below the {editingEnrolled} student(s) already enrolled. Saving will not remove anyone, but no further student can be added until seats become available.</span>
        </div>}
        {editingConflicts.length > 0 && <div className="erp-banner" role="note" style={{gridColumn: '1 / -1', margin: 0}}>
          <AlertCircle size={18}/><span><strong>Schedule warning:</strong> {instructorName(data, editing.instructorId)} already teaches {editingConflicts.map(item => `${item.batch.name} (${item.days.map(day => DAY_LABELS[day]).join(', ')})`).join('; ')} at an overlapping time. Saving is still allowed if this is intentional.</span>
        </div>}
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" disabled={!editing.days.length}>Save batch</button></div>
      </form></Dialog>}
    {roster && ctx.role !== 'student' && <Dialog title={`${roster.name} — roster`} sub={`${branchName(data, roster.branchId)} · ${instructorName(data, roster.instructorId)} · ${batchDaySummary(roster)} · ${batchTimeLabel(roster)} · ${rosterList.length}/${roster.capacity} enrolled · ${seatsLeft} seat(s) left`} onClose={closeRoster}>
      {ctx.role === 'instructor' && <p className="erp-roster-scope">{rosterEditable
        ? 'This is your assigned batch. You may add or remove existing active students from this branch, or use guided enrolment to create a basic walk-in student, start a plan at its set price and record a verified payment. Full student profiles, medical details, batch settings and payment voids remain manager-only.'
        : 'This batch is read-only because it is not an active batch assigned to you.'}</p>}
      {rosterEditable && <div className="erp-form-actions" style={{justifyContent: 'flex-start', marginTop: 0}}>
        <button type="button" className="secondary-button" onClick={() => { const batch = roster; closeRoster(); setEnrollmentBatch(batch); }}>
          <Sparkles size={15}/> Guided enrolment &amp; payment
        </button>
      </div>}
      {rosterFill && <div className="erp-capacity-block erp-roster-capacity">
        <div className="erp-capacity-head"><strong>{rosterFill.enrolled}/{rosterFill.capacity} students</strong><span>{rosterFill.percent}% full</span></div>
        <div className="erp-progress" role="progressbar" aria-label={`${roster.name} roster fill`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(100, rosterFill.percent)}>
          <span className={rosterFill.status === 'full' ? 'full' : rosterFill.status === 'almost_full' ? 'almost' : ''} style={{width: `${Math.min(100, rosterFill.percent)}%`}}/>
        </div>
      </div>}
      {rosterList.length > 0 && <label className="erp-search erp-roster-search"><Search size={16}/><input aria-label="Search roster" value={rosterQuery} onChange={event => setRosterQuery(event.target.value)} placeholder="Search enrolled students…"/></label>}
      {rosterList.length === 0 ? <p style={{fontSize: 13, color: '#9b92a4'}}>No students enrolled yet.</p> :
      visibleRosterList.length === 0 ? <p style={{fontSize: 13, color: '#9b92a4'}}>No enrolled student matches “{rosterQuery}”.</p> :
      visibleRosterList.map(e => <div className="erp-att-row" key={e.id}><span className="erp-person"><span className="avatar">{initials(studentName(data, e.studentId))}</span><span><strong>{studentName(data, e.studentId)}</strong><small>Joined {formatDate(e.joinedOn)}</small></span></span>
        {rosterEditable && <button className="erp-link-btn erp-danger" onClick={() => erp.act(c => c.endEnrollment(e.id), 'Removed from batch.')}>Remove</button>}</div>)}
      {rosterEditable && <form className="erp-form" style={{marginTop: 16}} onSubmit={async ev => { ev.preventDefault(); if (!addStudentId) return; if (rosterList.length >= roster.capacity) return props.notify('This batch is full.'); if (await erp.act(c => c.enrollStudent({batchId: roster.id, studentId: addStudentId}), 'Student enrolled.')) setAddStudentId(''); }}>
        <label className="erp-field">Add student to batch<select value={addStudentId} onChange={e => setAddStudentId(e.target.value)} disabled={seatsLeft === 0 || addable.length === 0}><option value="">{seatsLeft === 0 ? 'This batch is full' : addable.length === 0 ? 'No other active students in this branch' : 'Choose student…'}</option>{addable.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select><small>Only existing active students from {branchName(data, roster.branchId)} can be added.</small></label>
        <div className="erp-form-actions"><button className="primary-button" disabled={!addStudentId || seatsLeft === 0}>Enroll student</button></div></form>}
    </Dialog>}
    {enrollmentBatch && <EnrollmentWizardDialog
      {...props} initialBatch={enrollmentBatch.id ? enrollmentBatch : null}
      onClose={() => setEnrollmentBatch(null)}/>}
  </>;
}

export function BatchesPage(props) {
  const {erp, ctx} = props; const {data} = erp;
  return <>
    <ErpBlockingState {...props}/>
    <div className="page-heading"><div className="eyebrow">STUDIO ERP</div><h1>{ctx.role === 'student' ? 'My batches' : 'Batches'} <span className="flower">✳</span></h1><p>{ctx.role === 'student' ? 'Your assigned batches, weekly schedule and next classes—only your own enrollments.' : ctx.role === 'instructor' ? 'Your assigned batches, weekly schedule, capacity and rosters.' : 'Recurring class groups, instructors and rosters.'}</p></div>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>
    <BatchesSection {...props}/>
  </>;
}

/* ---------------- attendance ---------------- */

export function AttendancePage(props) {
  const {erp, ctx} = props; const {data} = erp;
  const [date, setDate] = useState(toISODate()); const [batchId, setBatchId] = useState(''); const [marks, setMarks] = useState({});
  const batches = data.batches.filter(b => b.status === 'active' && inBranch(ctx, b.branchId) && (ctx.role !== 'instructor' || b.instructorId === ctx.instructorId));
  useEffect(() => {
    const todays = batches.filter(b => isBatchOnDate(b, date));
    setBatchId(prev => (batches.some(b => b.id === prev) ? prev : (todays[0]?.id || batches[0]?.id || '')));
  }, [date, data.batches]); // eslint-disable-line react-hooks/exhaustive-deps
  const roster = data.enrollments.filter(e => e.batchId === batchId && e.status === 'active')
    .map(e => data.students.find(s => s.id === e.studentId)).filter(Boolean);
  useEffect(() => {
    const next = {};
    for (const s of roster) next[s.id] = data.attendance.find(a => a.batchId === batchId && a.studentId === s.id && a.classDate === date)?.status || '';
    setMarks(next);
  }, [batchId, date, data.attendance]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const list = Object.entries(marks).filter(([, status]) => status).map(([studentId, status]) => ({studentId, status}));
    if (!list.length) return props.notify('Mark at least one student first.');
    await erp.act(c => c.markAttendance({batchId, classDate: date, marks: list}), `Attendance saved for ${formatDate(date)}.`);
  };
  const myRecords = data.attendance.filter(a => a.studentId === ctx.studentId).sort((a, b) => b.classDate.localeCompare(a.classDate));
  const history = data.attendance.filter(a => a.batchId === batchId).sort((a, b) => b.classDate.localeCompare(a.classDate)).slice(0, 60);
  const batch = data.batches.find(b => b.id === batchId);
  return <>
    <ErpBlockingState {...props}/>
    <div className="page-heading"><div className="eyebrow">STUDIO ERP</div><h1>Attendance <span className="flower">✳</span></h1><p>{ctx.role === 'student' ? 'Your class history.' : 'Mark today’s class in under a minute.'}</p></div>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>
    {ctx.role === 'student' ? <section className="erp-panel"><div className="erp-panel-head"><div><h2>My attendance</h2><p>{myRecords.length} class(es) · {attendanceSummary(myRecords).rate ?? '—'}% attended</p></div></div>
      {!ctx.studentId ? <Empty icon={Users} title="Choose a student above" text="In Supabase mode this is linked automatically to the signed-in student."/> :
      myRecords.length === 0 ? <Empty icon={CalendarCheck} title="No attendance yet" text="Your marked classes will appear here."/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Date</th><th>Batch</th><th>Status</th></tr></thead><tbody>
        {myRecords.map(a => <tr key={a.id}><td>{formatDate(a.classDate)}</td><td>{data.batches.find(b => b.id === a.batchId)?.name || '—'}</td><td><span className={`erp-badge ${a.status === 'present' ? 'green' : a.status === 'late' ? 'amber' : 'red'}`}>{a.status}</span></td></tr>)}
      </tbody></table></div>}</section> : <>
    <section className="erp-panel"><div className="erp-panel-head align-end">
      <div className="erp-actions">
        <label className="erp-field">Class date<input type="date" value={date} onChange={e => setDate(e.target.value)}/></label>
        <label className="erp-field">Batch<select aria-label="Attendance batch" value={batchId} onChange={e => setBatchId(e.target.value)}>{batches.map(b => <option key={b.id} value={b.id}>{b.name} · {batchTimeLabel(b)}</option>)}</select></label>
      </div>
      <div className="erp-actions">
        <button className="secondary-button" onClick={() => setMarks(Object.fromEntries(roster.map(s => [s.id, 'present'])))}>Mark all present</button>
        <button className="primary-button" onClick={save}><Check size={16}/> Save attendance</button>
      </div></div>
      {batch && !isBatchOnDate(batch, date) && <div className="erp-banner"><AlertCircle size={18}/><span><b>{batch.name}</b> is not scheduled on {formatDate(date)} ({DAY_LABELS[new Date(`${date}T12:00:00`).getDay()]}). You can still record a special class.</span></div>}
      {batches.length === 0 ? <Empty icon={Clock} title="No batch to mark" text="Create a batch and enroll students first."/> :
      roster.length === 0 ? <Empty icon={Users} title="Roster is empty" text={ctx.role === 'instructor' ? 'Add existing students from Batches → Roster in this assigned batch.' : 'Enroll students into this batch from Branches & batches → Batches.'}/> :
      roster.map(s => <div className="erp-att-row" key={s.id}>
        <span className="erp-person"><span className="avatar">{initials(s.fullName)}</span><span><strong>{s.fullName}</strong><small>{attendanceSummary(data.attendance.filter(a => a.studentId === s.id)).rate ?? '—'}% overall</small></span></span>
        <span className="erp-att-btns" role="group" aria-label={`Attendance for ${s.fullName}`}>{ATTENDANCE_STATUSES.map(st =>
          <button key={st.id} className={marks[s.id] === st.id ? st.id : ''} aria-pressed={marks[s.id] === st.id} onClick={() => setMarks({...marks, [s.id]: st.id})}>{st.label}</button>)}</span>
      </div>)}
    </section>
    {history.length > 0 && <section className="erp-panel"><div className="erp-panel-head"><div><h2>Recent history</h2><p>{batch?.name}</p></div>
      <button className="secondary-button" onClick={() => exportCSV('attendance.csv', history, [{label: 'Date', value: a => a.classDate}, {label: 'Student', value: a => studentName(data, a.studentId)}, {label: 'Status', value: a => a.status}])}><Download size={15}/> CSV</button></div>
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Date</th><th>Student</th><th>Status</th></tr></thead><tbody>
        {history.map(a => <tr key={a.id}><td>{formatDate(a.classDate)}</td><td>{studentName(data, a.studentId)}</td><td><span className={`erp-badge ${a.status === 'present' ? 'green' : a.status === 'late' ? 'amber' : 'red'}`}>{a.status}</span></td></tr>)}
      </tbody></table></div></section>}</>}
  </>;
}

function billingSettingsOf(data) {
  const raw = data?.billingSettings?.[0] || {};
  return {
    ...normalizeBillingSettings(raw),
    id: raw.id || '',
    syncVersion: raw.syncVersion || 0,
    syncPending: Boolean(raw.syncPending),
    updatedAt: raw.updatedAt || '',
  };
}

function SetupStatus({ok, label, detail}) {
  return <div className="erp-setup-status">
    <span className={`erp-badge ${ok ? 'green' : 'amber'}`}>{ok ? 'Ready' : 'Not set'}</span>
    <div><strong>{label}</strong><small>{detail}</small></div>
  </div>;
}

function PaymentSetupPanel({data, erp, mode}) {
  const currentSettings = billingSettingsOf(data);
  const [form, setForm] = useState(() => billingSettingsOf(data));
  const ready = billingReadiness(form);
  const set = (field, value) => setForm(prev => ({...prev, [field]: value}));
  const setStateByCode = code => {
    const found = INDIA_STATE_CODES.find(([itemCode]) => itemCode === code);
    setForm(prev => ({...prev, stateCode: code, state: found?.[1] || prev.state}));
  };
  const save = async event => {
    event.preventDefault();
    if (ready.errors.length) {
      erp.act(async () => { throw new Error(ready.errors[0]); });
      return;
    }
    await erp.act(c => c.saveBillingSettings(form), 'Payment & invoice settings saved.');
  };

  return <section className="erp-panel">
    <div className="erp-panel-head">
      <div>
        <h2>Payment setup</h2>
        <p>Admin configuration for invoices, GST, UPI/bank instructions and gateway readiness.</p>
      </div>
      {currentSettings.syncPending && <span className="erp-badge amber">Saved on this device · waiting to sync</span>}
    </div>

    <div className="erp-setup-status-grid" aria-label="Payment configuration status">
      <SetupStatus ok={ready.invoiceProfile} label="Invoice profile" detail={ready.invoiceProfile ? 'Business/GST fields validate.' : 'Complete the billing profile below.'}/>
      <SetupStatus ok={ready.manualUpi} label="UPI QR" detail={ready.manualUpi ? 'Due invoices can show a scannable UPI QR.' : 'Add a UPI ID to show QR on unpaid invoices.'}/>
      <SetupStatus ok={ready.bankTransfer} label="Bank transfer" detail={ready.bankTransfer ? 'Bank details are complete for invoices.' : 'Add complete bank details, or leave all bank fields empty.'}/>
      <SetupStatus ok={ready.gatewayPublicConfig} label="Gateway public config" detail={ready.gatewayPublicConfig ? 'Public key/client ID is present.' : 'No gateway selected or public key missing.'}/>
      <SetupStatus ok={ready.gatewayAutoConfirmation} label="Auto confirmation" detail={ready.gatewayAutoConfirmation ? 'Webhook is marked configured on a trusted server.' : 'Not ready—payments must be verified and recorded manually.'}/>
    </div>

    <div className="erp-banner blue" role="note">
      <AlertCircle size={18}/>
      <div>
        <strong>Never enter a gateway secret key or webhook secret here.</strong>{' '}
        This browser app stores only public key/client IDs. Live checkout and automatic
        payment confirmation require a trusted Supabase Edge Function/server webhook;
        until that backend is deployed and tested, collect by UPI/bank/cash/card terminal
        and record the payment after verifying receipt.
      </div>
    </div>

    {ready.errors.length > 0 && <div className="erp-banner" role="alert">
      <AlertCircle size={18}/>
      <div><strong>Please fix:</strong><ul className="erp-error-list">{ready.errors.map(error => <li key={error}>{error}</li>)}</ul></div>
    </div>}
    {!ready.canShowPaymentInstructions && <div className="erp-banner" role="note">
      <AlertCircle size={18}/>
      <div>Unpaid invoices will not show a UPI QR or bank transfer details until at least one manual payment method is configured.</div>
    </div>}
    {form.gatewayProvider !== 'none' && !ready.gatewayAutoConfirmation && <div className="erp-banner" role="note">
      <AlertCircle size={18}/>
      <div>{form.gatewayProvider === 'razorpay' ? 'Razorpay' : 'Cashfree'} is not ready for automatic payment confirmation. The public configuration can be saved now, but memberships must not be marked paid from a browser callback alone.</div>
    </div>}
    {form.gstEnabled && !form.priceIncludesGst && <div className="erp-banner" role="note">
      <AlertCircle size={18}/>
      <div>GST is set to be added on top of the plan amount on invoices. Confirm the invoice grand total before collecting; for the simplest studio pricing, keep fee plans GST-inclusive.</div>
    </div>}

    <form className="erp-form" onSubmit={save}>
      <h3 className="erp-form-section">Business & invoice profile</h3>
      <label className="erp-field">Billing legal/business name<input required value={form.legalName} onChange={e => set('legalName', e.target.value)} autoComplete="organization"/></label>
      <label className="erp-field">Invoice prefix<input required value={form.invoicePrefix} onChange={e => set('invoicePrefix', e.target.value)} placeholder="YS-INV"/></label>
      <label className="erp-field">Billing email<input type="email" value={form.email} onChange={e => set('email', e.target.value)} autoComplete="email"/></label>
      <label className="erp-field">Phone<input value={form.phone} onChange={e => set('phone', e.target.value)} autoComplete="tel"/></label>
      <label className="erp-field full">Address<textarea rows={2} value={form.address} onChange={e => set('address', e.target.value)} autoComplete="street-address"/></label>
      <label className="erp-field">City<input value={form.city} onChange={e => set('city', e.target.value)} autoComplete="address-level2"/></label>
      <label className="erp-field">State / state code<select value={form.stateCode} onChange={e => setStateByCode(e.target.value)}>
        {INDIA_STATE_CODES.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
      </select></label>
      <label className="erp-field">PIN code<input inputMode="numeric" maxLength={6} value={form.pinCode} onChange={e => set('pinCode', e.target.value)} autoComplete="postal-code"/></label>
      <label className="erp-field">Payment due in (days)<input type="number" min={0} max={60} value={form.dueDays} onChange={e => set('dueDays', e.target.value)}/></label>
      <label className="erp-field full">Invoice terms / footer note<textarea rows={2} value={form.terms} onChange={e => set('terms', e.target.value)} placeholder="Optional, e.g. Dues are payable in advance. Please share the UPI reference after payment."/></label>

      <h3 className="erp-form-section">GST (optional)</h3>
      <label className="erp-toggle-row full"><input type="checkbox" checked={!!form.gstEnabled} onChange={e => set('gstEnabled', e.target.checked)}/> <span>Show GST breakup on invoices</span></label>
      <label className="erp-field">Seller GSTIN<input value={form.gstin} onChange={e => set('gstin', e.target.value.toUpperCase())} placeholder="27ABCDE1234F1Z5" autoComplete="off" spellCheck={false}/></label>
      <label className="erp-field">GST rate (%)<input type="number" min={0} max={28} step="0.01" value={form.gstRatePercent} onChange={e => set('gstRatePercent', e.target.value)}/></label>
      <label className="erp-field">SAC / HSN code<input inputMode="numeric" value={form.sacCode} onChange={e => set('sacCode', e.target.value)} placeholder="Configured by your CA"/></label>
      <label className="erp-toggle-row"><input type="checkbox" checked={!!form.priceIncludesGst} onChange={e => set('priceIncludesGst', e.target.checked)}/> <span>Plan prices already include GST</span></label>

      <h3 className="erp-form-section">Manual UPI & bank transfer</h3>
      <label className="erp-field">UPI ID<input value={form.upiId} onChange={e => set('upiId', e.target.value)} placeholder="studio@okhdfcbank" autoComplete="off" spellCheck={false}/></label>
      <label className="erp-field">UPI payee name<input value={form.upiPayeeName} onChange={e => set('upiPayeeName', e.target.value)} placeholder={form.legalName || 'Business name'}/></label>
      <label className="erp-field">Bank name<input value={form.bankName} onChange={e => set('bankName', e.target.value)}/></label>
      <label className="erp-field">Account name<input value={form.bankAccountName} onChange={e => set('bankAccountName', e.target.value)}/></label>
      <label className="erp-field">Account number<input inputMode="numeric" value={form.bankAccountNumber} onChange={e => set('bankAccountNumber', e.target.value)} autoComplete="off" spellCheck={false}/></label>
      <label className="erp-field">IFSC<input value={form.ifsc} onChange={e => set('ifsc', e.target.value.toUpperCase())} placeholder="HDFC0000123" autoComplete="off" spellCheck={false}/></label>
      <label className="erp-field">Account type<select value={form.bankAccountType} onChange={e => set('bankAccountType', e.target.value)}><option>Current</option><option>Savings</option><option>Overdraft</option><option>Other</option></select></label>

      <h3 className="erp-form-section">Payment gateway — public configuration only</h3>
      <label className="erp-field">Provider<select value={form.gatewayProvider} onChange={e => set('gatewayProvider', e.target.value)}>
        <option value="none">Not configured / manual only</option><option value="razorpay">Razorpay</option><option value="cashfree">Cashfree</option>
      </select></label>
      <label className="erp-field">Environment<select value={form.gatewayEnvironment} onChange={e => set('gatewayEnvironment', e.target.value)}><option value="test">Test</option><option value="live">Live</option></select></label>
      <label className="erp-field full">{form.gatewayProvider === 'razorpay' ? 'Razorpay Key ID (public)' : form.gatewayProvider === 'cashfree' ? 'Cashfree Client ID (public)' : 'Gateway public key / client ID'}
        <input value={form.gatewayPublicKeyId} onChange={e => set('gatewayPublicKeyId', e.target.value)} placeholder={form.gatewayProvider === 'razorpay' ? `rzp_${form.gatewayEnvironment}_...` : 'Public identifier only — never a secret'} autoComplete="off" spellCheck={false}/></label>
      <label className="erp-field full">Trusted webhook / Edge Function URL<input type="url" value={form.gatewayWebhookUrl} onChange={e => set('gatewayWebhookUrl', e.target.value)} placeholder="https://... (deployed separately; no secret in the URL)" autoComplete="off" spellCheck={false}/></label>
      <label className="erp-toggle-row full"><input type="checkbox" checked={!!form.gatewayWebhookConfigured} onChange={e => set('gatewayWebhookConfigured', e.target.checked)}/> <span>Webhook + signature verification are deployed and tested on a trusted server</span></label>

      <div className="erp-form-actions">
        <span className="erp-setup-save-note">{mode === 'supabase' ? 'Saves to the same durable offline outbox and syncs automatically.' : 'Stored only in this browser’s local-device ERP data.'}</span>
        <button className="primary-button">Save payment setup</button>
      </div>
    </form>
  </section>;
}

function invoiceStatusClass(status) {
  if (status === 'PAID') return 'paid';
  if (status === 'VOID') return 'void';
  return 'unpaid';
}

function InvoiceDialog({data, invoice, onClose}) {
  const settings = billingSettingsOf(data);
  const ready = billingReadiness(settings);
  const payment = invoice?.payment || null;
  const membership = invoice?.membership
    || data.memberships.find(m => m.id === payment?.membershipId)
    || null;
  const student = data.students.find(s => s.id === (payment?.studentId || membership?.studentId)) || null;
  const plan = data.plans.find(p => p.id === membership?.planId) || null;
  const offeringLabel = membership && isOneMonthMembership(membership, plan) ? 'One-month pass' : 'Subscription';
  const branch = data.branches.find(b => b.id === (payment?.branchId || membership?.branchId)) || null;
  const balance = membership ? payableBalance(membership, data.payments, settings) : {total: 0, paid: 0, due: 0};
  const isPayment = invoice?.type === 'payment';
  const status = payment
    ? (payment.status === 'void' ? 'VOID' : 'PAID')
    : (balance.paid > 0 ? 'PARTIALLY PAID' : 'UNPAID');
  const amountPaise = payment ? (Number(payment.amountPaise) || 0) : balance.due;
  const invoiceDate = payment?.paidOn || toISODate();
  const reference = payment?.receiptNo
    || `${settings.invoicePrefix}-${invoiceDate.replaceAll('-', '')}-${String(membership?.id || 'FEES').slice(0, 6).toUpperCase()}`;
  const dueDate = addDaysISO(invoiceDate, settings.dueDays || 0);
  const [placeCode, setPlaceCode] = useState(settings.stateCode || '27');
  const [buyerGstin, setBuyerGstin] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  // Both invoice entry points now pass an actual cash amount: the gross due
  // (payableBalance has already added GST for exclusive pricing) or the gross
  // amount received. Back-calculate the breakup so a paid receipt can never
  // add GST a second time on top of cash already collected.
  const tax = calculateInvoiceTax(amountPaise, {...settings, priceIncludesGst: true}, placeCode);
  const payablePaise = tax.grandTotalPaise;
  const upiUri = status === 'PAID' || status === 'VOID'
    ? ''
    : buildUpiUri(settings, payablePaise, reference);
  const placeName = INDIA_STATE_CODES.find(([code]) => code === placeCode)?.[1] || placeCode;
  const documentTitle = payment
    ? (settings.gstEnabled ? 'TAX INVOICE / RECEIPT' : 'PAYMENT RECEIPT')
    : (settings.gstEnabled ? 'FEE INVOICE' : 'FEE INVOICE');
  const description = payment
    ? `${plan?.name || 'Yoga Studio membership'} — payment received`
    : `${plan?.name || 'Yoga Studio membership'}${membership ? ` (${formatDate(membership.startDate)} → ${formatDate(membership.endDate)})` : ''}`;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = reference;
    return () => { document.title = previousTitle; };
  }, [reference]);

  useEffect(() => {
    document.body.classList.add('erp-invoice-open');
    return () => document.body.classList.remove('erp-invoice-open');
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!upiUri) { setQrDataUrl(''); return undefined; }
    QRCode.toDataURL(upiUri, {width: 240, margin: 1, errorCorrectionLevel: 'M'})
      .then(url => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { if (!cancelled) setQrDataUrl(''); });
    return () => { cancelled = true; };
  }, [upiUri]);

  const printInvoice = async () => {
    if (upiUri && !qrDataUrl) {
      try {
        const url = await QRCode.toDataURL(upiUri, {width: 240, margin: 1, errorCorrectionLevel: 'M'});
        const image = new Image();
        image.src = url;
        await image.decode().catch(() => {});
        setQrDataUrl(url);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      } catch {
        // The printed invoice still includes the UPI ID and bank/reference
        // instructions if QR generation is unavailable.
      }
    }
    window.print();
  };
  const sellerAddress = [settings.address, [settings.city, settings.state, settings.pinCode].filter(Boolean).join(', ')].filter(Boolean);

  const invoiceDocument = (
    <article className="erp-invoice" aria-label={`${documentTitle} ${reference}`}>
      <header className="erp-invoice-header">
        <div className="erp-invoice-seller">
          <div className="erp-invoice-brand"><Leaf size={22}/><h3>{settings.legalName || 'Yoga Studio'}</h3></div>
          {sellerAddress.map(line => <p key={line}>{line}</p>)}
          {(settings.email || settings.phone) && <p>{[settings.email, settings.phone].filter(Boolean).join(' · ')}</p>}
          {settings.gstEnabled && settings.gstin && <p><strong>GSTIN:</strong> {settings.gstin}</p>}
        </div>
        <div className="erp-invoice-meta">
          <div className="erp-invoice-title">{documentTitle}</div>
          <span className={`erp-invoice-status ${invoiceStatusClass(status)}`}>{status}</span>
          <dl>
            <dt>{payment ? 'Receipt no.' : 'Reference'}</dt><dd>{reference}</dd>
            <dt>{payment ? 'Payment date' : 'Invoice date'}</dt><dd>{formatDate(invoiceDate)}</dd>
            {!payment && <><dt>Due date</dt><dd>{formatDate(dueDate)}</dd></>}
          </dl>
        </div>
      </header>

      <section className="erp-invoice-billgrid">
        <div>
          <h4>Bill to</h4>
          <p><strong>{student?.fullName || 'Student'}</strong></p>
          {branch && <p>{branch.name}{branch.city ? `, ${branch.city}` : ''}</p>}
          {(student?.phone || student?.email) && <p>{[student.phone, student.email].filter(Boolean).join(' · ')}</p>}
          {buyerGstin && <p><strong>GSTIN:</strong> {buyerGstin}</p>}
        </div>
        <div>
          <h4>{settings.gstEnabled ? 'Place of supply' : offeringLabel}</h4>
          {settings.gstEnabled
            ? <><p>{placeName} ({placeCode})</p><p>{tax.interState ? 'Inter-state supply · IGST' : 'Intra-state supply · CGST + SGST'}</p></>
            : <p>Studio {offeringLabel.toLowerCase()} charges</p>}
          {membership && <p>{formatDate(membership.startDate)} → {formatDate(membership.endDate)}</p>}
        </div>
      </section>

      <div className="erp-invoice-table-wrap"><table className="erp-invoice-table">
        <thead><tr><th>#</th><th>Description</th>{settings.gstEnabled && <th>SAC/HSN</th>}<th className="num">Qty</th><th className="num">Rate</th><th className="num">{settings.gstEnabled ? 'Taxable value' : 'Amount'}</th></tr></thead>
        <tbody><tr>
          <td>1</td><td>{description}</td>
          {settings.gstEnabled && <td>{settings.sacCode || '—'}</td>}
          <td className="num">1</td><td className="num">{formatInvoiceINR(tax.taxablePaise)}</td><td className="num">{formatInvoiceINR(tax.taxablePaise)}</td>
        </tr></tbody>
      </table></div>

      <section className="erp-invoice-footer">
        <div className="erp-invoice-payment">
          {status === 'PAID' ? <>
            <h4>Payment received</h4>
            <dl className="erp-invoice-details">
              <dt>Receipt</dt><dd>{payment.receiptNo}</dd>
              <dt>Method</dt><dd>{PAYMENT_METHODS.find(m => m.id === payment.method)?.label || payment.method}</dd>
              <dt>Date</dt><dd>{formatDate(payment.paidOn)}</dd>
              {payment.note && <><dt>Note / reference</dt><dd>{payment.note}</dd></>}
            </dl>
            <p className="erp-invoice-note">Payment instructions and UPI QR are hidden because this document is paid.</p>
          </> : status === 'VOID' ? <>
            <h4>Void payment</h4>
            <p>This receipt was voided and must not be used for payment.</p>
            {payment?.voidReason && <p><strong>Reason:</strong> {payment.voidReason}</p>}
          </> : <>
            <h4>Payment instructions</h4>
            {ready.canShowPaymentInstructions ? <div className="erp-invoice-paycard">
              <div className="erp-invoice-bank">
                {ready.bankTransfer ? <>
                  <p><strong>Bank:</strong> {settings.bankName}</p>
                  <p><strong>Account name:</strong> {settings.bankAccountName}</p>
                  <p><strong>Account no.:</strong> {settings.bankAccountNumber}</p>
                  <p><strong>Account type:</strong> {settings.bankAccountType}</p>
                  <p><strong>IFSC:</strong> {settings.ifsc}</p>
                </> : <p>Bank transfer details are not configured.</p>}
                {ready.manualUpi && <p style={{marginTop: 8}}><strong>UPI ID:</strong> {settings.upiId}</p>}
                <p className="erp-invoice-note">Please use reference {reference} and share the payment reference with the studio.</p>
              </div>
              {upiUri && <div className="erp-invoice-qr">
                {qrDataUrl
                  ? <a href={upiUri} aria-label={`Pay ${formatInvoiceINR(payablePaise)} by UPI`}><img src={qrDataUrl} alt={`UPI QR code for ${formatInvoiceINR(payablePaise)} to ${settings.upiId}`}/></a>
                  : <div className="erp-invoice-qr-placeholder">UPI QR</div>}
                <span>Scan to pay {formatInvoiceINR(payablePaise)}</span>
              </div>}
            </div> : <div className="erp-invoice-warning">Payment instructions are not configured yet. Please contact the studio, or ask an Owner/Co-owner to complete Payments → Payment setup.</div>}
            <p className="erp-invoice-note">
              {settings.gatewayProvider === 'none'
                ? 'Manual payment only. The studio will record the payment after verifying receipt.'
                : ready.gatewayAutoConfirmation
                  ? `${settings.gatewayProvider === 'razorpay' ? 'Razorpay' : 'Cashfree'} public config is present and its trusted webhook is marked configured. This PDF still shows UPI/bank instructions for manual payment.`
                  : `${settings.gatewayProvider === 'razorpay' ? 'Razorpay' : 'Cashfree'} automatic confirmation is not ready yet. Pay by UPI/bank and the studio will record it after verification.`}
            </p>
          </>}
          {settings.terms && <p className="erp-invoice-note">{settings.terms}</p>}
        </div>

        <div className="erp-invoice-summary" aria-label="Invoice summary">
          {!payment && balance.paid > 0 && <>
            <div><span>{offeringLabel} total</span><strong>{formatInvoiceINR(balance.total)}</strong></div>
            <div><span>Already paid</span><strong>{formatInvoiceINR(balance.paid)}</strong></div>
          </>}
          <div><span>{settings.gstEnabled ? 'Taxable value' : 'Subtotal'}</span><strong>{formatInvoiceINR(tax.taxablePaise)}</strong></div>
          {tax.gstEnabled && (tax.interState
            ? <div><span>IGST ({Number(tax.gstRatePercent.toFixed(2))}%)</span><strong>{formatInvoiceINR(tax.igstPaise)}</strong></div>
            : <><div><span>CGST ({Number((tax.gstRatePercent / 2).toFixed(2))}%)</span><strong>{formatInvoiceINR(tax.cgstPaise)}</strong></div>
              <div><span>SGST ({Number((tax.gstRatePercent / 2).toFixed(2))}%)</span><strong>{formatInvoiceINR(tax.sgstPaise)}</strong></div></>)}
          <div className="grand"><span>{status === 'PAID' ? 'Amount paid' : 'Grand total payable'}</span><strong>{formatInvoiceINR(payablePaise)}</strong></div>
          {settings.gstEnabled && <p>{settings.priceIncludesGst
            ? 'Fee amount is GST-inclusive; tax is shown by back-calculation.'
            : payment
              ? 'Plan prices are GST-exclusive; this breakup is derived from the gross amount received.'
              : 'Plan prices are GST-exclusive; the payable total includes GST on the remaining taxable fee.'}</p>}
        </div>
      </section>

      <footer className="erp-invoice-disclaimer">
        Computer-generated from Yoga Studio ERP records. {payment
          ? 'Keep this receipt for your records.'
          : 'This is a fee invoice/payment request, not a final payment receipt. A receipt is issued after payment is verified and recorded.'}
      </footer>
    </article>
  );

  return <Dialog title="Payment invoice" sub="This document is formatted for exactly one A4 portrait page (210 × 297 mm). Choose “Print / Save A4 PDF”, then select Save as PDF as the destination." onClose={onClose} className="erp-dialog-wide">
    {settings.gstEnabled && <div className="erp-form erp-no-print" style={{marginBottom: 14}}>
      <label className="erp-field">Place of supply<select value={placeCode} onChange={e => setPlaceCode(e.target.value)}>
        {INDIA_STATE_CODES.map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}
      </select></label>
      <label className="erp-field">Customer GSTIN (optional for this PDF)<input value={buyerGstin} onChange={e => {
        const value = e.target.value.toUpperCase();
        setBuyerGstin(value);
        if (/^[0-9]{2}/.test(value)) setPlaceCode(value.slice(0, 2));
      }} placeholder="Only if the buyer is GST-registered" autoComplete="off" spellCheck={false}/></label>
    </div>}

    {invoiceDocument}

    <div className="erp-form-actions erp-no-print">
      <button className="secondary-button" onClick={onClose}>Close</button>
      <button className="primary-button" onClick={printInvoice}><Printer size={15}/> Print / Save A4 PDF</button>
    </div>
    {createPortal(
      <div className="erp-print-root" aria-hidden="true">{invoiceDocument}</div>,
      document.body,
    )}
  </Dialog>;
}

/* ---------------- subscriptions & payments ---------------- */

export function InstructorPaymentsPage(props) {
  const {erp, ctx} = props; const {data} = erp;
  const today = toISODate();
  const [paymentForm, setPaymentForm] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const scopedStudentIds = new Set(instructorFinanceStudentIds(data, ctx.instructorId));
  const billing = billingSettingsOf(data);
  const scopedMemberships = data.memberships
    .filter(membership => scopedStudentIds.has(membership.studentId) && inBranch(ctx, membership.branchId))
    .sort((a, b) => {
      const lifecycleRank = {active: 0, paused: 1, scheduled: 2, expired: 3, cancelled: 4};
      return (lifecycleRank[subscriptionLifecycle(a, today).id] - lifecycleRank[subscriptionLifecycle(b, today).id])
        || String(a.endDate || '').localeCompare(String(b.endDate || ''))
        || studentName(data, a.studentId).localeCompare(studentName(data, b.studentId));
    });
  const collectableMemberships = scopedMemberships.filter(membership => (
    membership.status !== 'cancelled'
      && payableBalance(membership, data.payments, billing, today).due > 0
  ));
  const scopedPayments = data.payments
    .filter(payment => scopedStudentIds.has(payment.studentId) && inBranch(ctx, payment.branchId))
    .sort((a, b) => String(b.paidOn || '').localeCompare(String(a.paidOn || '')));
  const outstandingDue = scopedMemberships
    .filter(membership => membership.status !== 'cancelled')
    .reduce((sum, membership) => sum + Math.max(0, payableBalance(membership, data.payments, billing, today).due), 0);
  const collectedShown = scopedPayments
    .filter(payment => payment.status !== 'void')
    .reduce((sum, payment) => sum + (payment.amountPaise || 0), 0);
  const openPayment = membership => {
    const selected = membership && collectableMemberships.some(item => item.id === membership.id)
      ? membership
      : collectableMemberships[0];
    if (!selected) return;
    const balance = payableBalance(selected, data.payments, billing, today);
    setPaymentForm({
      membershipId: selected.id, amountRupees: paiseToRupees(balance.due),
      method: 'upi', paidOn: today, note: '',
    });
  };

  return <>
    <ErpBlockingState {...props}/>
    <div className="page-heading"><div className="eyebrow">STUDIO ERP</div><h1>My student payments <span className="flower">✳</span></h1><p>Dues, verified payments and receipts only for students actively enrolled in your assigned batches.</p></div>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>

    <div className="erp-banner blue" role="note">
      <BadgeCheck size={18}/>
      <span>Record a payment only after checking that the money was received. The server assigns the final receipt number. You cannot change plan prices, edit or void payments, pause/cancel/renew subscriptions, or see students outside your active batches.</span>
    </div>

    <div className="erp-grid erp-workspace-summary" aria-label="My student payment summary">
      <div className="erp-kpi"><small>My enrolled students</small><strong>{scopedStudentIds.size}</strong><p>Active enrolments in your batches</p></div>
      <div className="erp-kpi"><small>Subscriptions / passes</small><strong>{scopedMemberships.length}</strong><p>Only for those students</p></div>
      <div className="erp-kpi"><small>Outstanding dues</small><strong>{formatINR(outstandingDue)}</strong><p>{collectableMemberships.length} period(s) with a balance</p></div>
      <div className="erp-kpi"><small>Collected shown</small><strong>{formatINR(collectedShown)}</strong><p>{scopedPayments.length} payment record(s), excluding voids</p></div>
    </div>

    <section className="erp-panel">
      <div className="erp-panel-head">
        <div><h2>Collect a due</h2><p>{collectableMemberships.length} subscription/pass period(s) currently have a payable balance.</p></div>
        <button className="primary-button" onClick={() => openPayment(null)} disabled={!collectableMemberships.length}><IndianRupee size={16}/> Record payment</button>
      </div>
      {scopedMemberships.length === 0
        ? <Empty icon={IndianRupee} title="No student payments in your scope" text="Subscriptions and one-month passes appear here only after a student is actively enrolled in one of your batches and a manager or guided enrolment creates a plan period."/>
        : <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Student</th><th>Plan</th><th>Period</th><th>Status</th><th>Due</th><th>Actions</th></tr></thead><tbody>
          {scopedMemberships.map(membership => {
            const balance = payableBalance(membership, data.payments, billing, today);
            const lifecycle = subscriptionLifecycle(membership, today);
            return <tr key={membership.id}>
              <td><span className="erp-person"><span className="avatar">{initials(studentName(data, membership.studentId))}</span><span><strong>{studentName(data, membership.studentId)}</strong><small>{branchName(data, membership.branchId)}</small></span></span></td>
              <td>{planName(data, membership.planId)}<br/><small>{membershipKindLabel(data, membership)}</small></td>
              <td>{formatDate(membership.startDate)} → {formatDate(membership.endDate)}</td>
              <td><SubscriptionBadge membership={membership} today={today}/></td>
              <td><strong>{formatINR(Math.max(0, balance.due))}</strong><br/><small>{formatINR(balance.paid)} paid of {formatINR(balance.total)}</small></td>
              <td>
                {balance.due > 0 && membership.status !== 'cancelled'
                  ? <button className="erp-link-btn" onClick={() => openPayment(membership)}><IndianRupee size={13}/> Collect</button>
                  : <span className="erp-badge green">Paid</span>}
                <button className="erp-link-btn" onClick={() => setInvoice({type: 'membership', membership})}><Printer size={13}/> Invoice PDF</button>
              </td>
            </tr>;
          })}
        </tbody></table></div>}
    </section>

    <section className="erp-panel">
      <div className="erp-panel-head"><div><h2>Payment receipts</h2><p>Receipts for your enrolled students only. Corrections must be handled by a manager.</p></div></div>
      {scopedPayments.length === 0
        ? <Empty icon={Wallet} title="No payments recorded" text="Verified payments for your batch students will appear here with their server receipt numbers."/>
        : <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Receipt</th><th>Date</th><th>Student</th><th>Method</th><th>Amount</th><th>Actions</th></tr></thead><tbody>
          {scopedPayments.map(payment => <tr key={payment.id}>
            <td><strong>{payment.receiptNo || 'Pending sync'}</strong>{payment.syncPending && <><br/><span className="erp-badge amber">On this device</span></>}{payment.status === 'void' && <><br/><span className="erp-badge red">VOID</span></>}</td>
            <td>{formatDate(payment.paidOn)}</td>
            <td>{studentName(data, payment.studentId)}</td>
            <td>{PAYMENT_METHODS.find(method => method.id === payment.method)?.label || payment.method}</td>
            <td><strong style={payment.status === 'void' ? {textDecoration: 'line-through'} : undefined}>{formatINR(payment.amountPaise)}</strong></td>
            <td>{payment.receiptNo && <button className="erp-link-btn" onClick={() => setInvoice({type: 'payment', payment})}><Printer size={13}/> Invoice PDF</button>}</td>
          </tr>)}
        </tbody></table></div>}
    </section>

    {paymentForm && <Dialog title="Record verified payment" sub="For one of your batch students only. Record after funds are received and verified; Supabase assigns the final receipt after sync. You cannot void this payment." onClose={() => setPaymentForm(null)}>
      <form className="erp-form" onSubmit={async event => {
        event.preventDefault();
        const membership = collectableMemberships.find(item => item.id === paymentForm.membershipId);
        if (!membership) return;
        if (await erp.act(c => c.recordPayment({
          membershipId: membership.id, studentId: membership.studentId, branchId: membership.branchId,
          amountPaise: rupeesToPaise(paymentForm.amountRupees), method: paymentForm.method,
          paidOn: paymentForm.paidOn, note: paymentForm.note,
        }), 'Payment recorded. The final receipt appears after sync.')) setPaymentForm(null);
      }}>
        <label className="erp-field full">Subscription or one-month pass
          <select required value={paymentForm.membershipId} onChange={event => {
            const membership = collectableMemberships.find(item => item.id === event.target.value);
            setPaymentForm({
              ...paymentForm, membershipId: event.target.value,
              amountRupees: membership ? paiseToRupees(payableBalance(membership, data.payments, billing, today).due) : '',
            });
          }}>
            {collectableMemberships.map(membership => <option key={membership.id} value={membership.id}>
              {studentName(data, membership.studentId)} · {planName(data, membership.planId)} · {membershipKindLabel(data, membership)} · due {formatINR(payableBalance(membership, data.payments, billing, today).due)}
            </option>)}
          </select>
        </label>
        <label className="erp-field">Amount received (₹)<input type="number" min="0.01" step="0.01" required value={paymentForm.amountRupees} onChange={event => setPaymentForm({...paymentForm, amountRupees: event.target.value})}/></label>
        <label className="erp-field">Method<select value={paymentForm.method} onChange={event => setPaymentForm({...paymentForm, method: event.target.value})}>{PAYMENT_METHODS.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}</select></label>
        <label className="erp-field">Paid on<input type="date" required value={paymentForm.paidOn} onChange={event => setPaymentForm({...paymentForm, paidOn: event.target.value})}/></label>
        <label className="erp-field">Note / transaction reference<input value={paymentForm.note} onChange={event => setPaymentForm({...paymentForm, note: event.target.value})} placeholder="UPI/bank/card reference (recommended)"/></label>
        <div className="erp-banner" style={{gridColumn: '1 / -1', margin: 0}}><AlertCircle size={18}/><span>Record the actual gross amount received after verification. If the amount or reference is wrong, contact an Owner, Co-owner or branch Admin; instructors cannot void payments.</span></div>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setPaymentForm(null)}>Cancel</button><button className="primary-button">Save payment</button></div>
      </form>
    </Dialog>}
    {invoice && <InvoiceDialog data={data} invoice={invoice} onClose={() => setInvoice(null)}/>}
  </>;
}

function FinanceWorkspacePage(props) {
  const {erp, ctx, go} = props; const {data} = erp;
  const workspace = props.workspace === 'payments' ? 'payments' : 'subscriptions';
  const isPaymentsWorkspace = workspace === 'payments';
  const today = toISODate();
  const [tab, setTab] = useState(isPaymentsWorkspace ? 'payments' : 'memberships');
  const [planForm, setPlanForm] = useState(null); const [membershipForm, setMembershipForm] = useState(null);
  const [paymentForm, setPaymentForm] = useState(null); const [invoice, setInvoice] = useState(null);
  const [subscriptionFilter, setSubscriptionFilter] = useState('all');
  const [oneTimeFilter, setOneTimeFilter] = useState('all');
  const [pauseForm, setPauseForm] = useState(null); const [resumeForm, setResumeForm] = useState(null);
  const [cancelForm, setCancelForm] = useState(null); const [renewForm, setRenewForm] = useState(null);
  const [historyMembershipId, setHistoryMembershipId] = useState('');
  const isStudent = ctx.role === 'student';
  const allMemberships = data.memberships.filter(m => inBranch(ctx, m.branchId) && (!isStudent || m.studentId === ctx.studentId));
  const isOneTime = membership => isOneMonthMembership(
    membership, data.plans.find(plan => plan.id === membership.planId),
  );
  const memberships = allMemberships.filter(membership => !isOneTime(membership));
  const oneTimeMemberships = allMemberships.filter(isOneTime);
  const childByPrevious = renewalChildByPrevious(data);
  const lifecycleOrder = {active: 0, paused: 1, scheduled: 2, expired: 3, cancelled: 4};
  const isRenewalDue = membership => membership.status === 'active' && membership.autoRenew !== false
    && !childByPrevious.has(membership.id) && membership.startDate <= today
    && membership.endDate <= addDaysISO(today, 7);
  const sortMemberships = rows => [...rows].sort((a, b) => (
    (lifecycleOrder[subscriptionLifecycle(a, today).id] - lifecycleOrder[subscriptionLifecycle(b, today).id])
    || String(a.endDate || '').localeCompare(String(b.endDate || ''))
    || String(a.startDate || '').localeCompare(String(b.startDate || ''))
  ));
  const sortedMemberships = sortMemberships(memberships);
  const visibleMemberships = sortedMemberships.filter(membership => {
    const lifecycle = subscriptionLifecycle(membership, today).id;
    if (subscriptionFilter === 'all') return true;
    if (subscriptionFilter === 'renewals') return isRenewalDue(membership);
    return lifecycle === subscriptionFilter;
  });
  const sortedOneTimeMemberships = sortMemberships(oneTimeMemberships);
  const visibleOneTimeMemberships = sortedOneTimeMemberships.filter(membership => (
    oneTimeFilter === 'all' || subscriptionLifecycle(membership, today).id === oneTimeFilter
  ));
  const collectableMemberships = sortMemberships(allMemberships)
    .filter(membership => membership.status !== 'cancelled');
  const subscriptionSummary = {
    active: memberships.filter(membership => subscriptionLifecycle(membership, today).id === 'active').length,
    paused: memberships.filter(membership => subscriptionLifecycle(membership, today).id === 'paused').length,
    scheduled: memberships.filter(membership => subscriptionLifecycle(membership, today).id === 'scheduled').length,
    renewalsDue: memberships.filter(isRenewalDue).length,
    mrr: monthlyRecurringRevenuePaise(memberships, today),
  };
  const payments = data.payments.filter(p => inBranch(ctx, p.branchId) && (!isStudent || p.studentId === ctx.studentId))
    .sort((a, b) => (b.paidOn || '').localeCompare(a.paidOn || ''));
  const billing = billingSettingsOf(data);
  const billingReady = billingReadiness(billing);
  const oneTimeSummary = {
    active: oneTimeMemberships.filter(membership => subscriptionLifecycle(membership, today).id === 'active').length,
    scheduled: oneTimeMemberships.filter(membership => subscriptionLifecycle(membership, today).id === 'scheduled').length,
    expired: oneTimeMemberships.filter(membership => subscriptionLifecycle(membership, today).id === 'expired').length,
    due: oneTimeMemberships
      .filter(membership => membership.status !== 'cancelled')
      .reduce((sum, membership) => sum + payableBalance(membership, data.payments, billing, today).due, 0),
  };
  const paymentConfigWarning = paymentForm?.method === 'upi' && !billingReady.manualUpi
    ? 'A receiving UPI ID is not configured. You can still record a manually verified UPI payment, but unpaid invoices will not show a QR code.'
    : paymentForm?.method === 'bank' && !billingReady.bankTransfer
      ? 'Receiving bank details are not completely configured. You can still record a verified bank receipt, but unpaid invoices will not show bank instructions.'
      : paymentForm?.method === 'card' && !billingReady.gatewayAutoConfirmation
        ? 'Card gateway automatic confirmation is not configured. Record a card payment only after verifying it on the card terminal, provider dashboard, or bank statement.'
        : '';
  const paymentGstWarning = billing.gstEnabled && !billing.priceIncludesGst
    ? 'GST is added on top in Payment setup. Dues are shown as gross payable totals (taxable fee + GST); record the actual gross amount received.'
    : '';
  const openMembership = (offeringType = 'subscription') => {
    const normalizedOfferingType = normalizePlanType(offeringType);
    const student = data.students.find(s => s.status === 'active' && inBranch(ctx, s.branchId));
    const plan = activePlans(data, normalizedOfferingType)[0];
    const template = normalizePlanTemplate(plan || {planType: normalizedOfferingType});
    setMembershipForm({
      offeringType: normalizedOfferingType,
      studentId: student?.id || '', planId: plan?.id || '', startDate: today,
      billingCycle: template.billingCycle, autoRenew: template.renewalEnabledDefault,
      amountRupees: plan ? paiseToRupees(plan.amountPaise) : '',
    });
  };
  const openPayment = m => {
    const selected = m && m.status !== 'cancelled' ? m : collectableMemberships[0];
    const bal = selected ? payableBalance(selected, data.payments, billing, today) : null;
    setPaymentForm({
      membershipId: selected?.id || '', amountRupees: bal ? paiseToRupees(bal.due) : '',
      method: 'upi', paidOn: today, note: '',
    });
  };
  const openPause = membership => setPauseForm({
    membership,
    pausedFrom: today < membership.startDate ? membership.startDate : today > membership.endDate ? membership.endDate : today,
    pausedUntil: '', reason: '',
  });
  const openResume = membership => setResumeForm({
    membership,
    resumeDate: membership.pausedUntil && membership.pausedUntil >= membership.pausedFrom
      ? membership.pausedUntil
      : today >= membership.pausedFrom ? today : membership.pausedFrom,
  });
  const openRenew = membership => {
    if (isOneTime(membership)) return;
    const subscriptionPlans = activePlans(data, 'subscription');
    const currentPlan = subscriptionPlans.find(plan => plan.id === membership.planId)
      || subscriptionPlans[0];
    const currentTemplate = normalizePlanTemplate(currentPlan || {});
    setRenewForm({
      membership, planId: currentPlan?.id || '',
      startDate: renewalStartDate(membership, today), billingCycle: currentTemplate.billingCycle,
      autoRenew: currentTemplate.renewalEnabledDefault,
    });
  };
  const historyMembership = data.memberships.find(membership => membership.id === historyMembershipId) || null;
  const historyChain = historyMembership ? subscriptionChain(data, historyMembership) : [];
  const cancelIsOneMonth = cancelForm ? isOneTime(cancelForm.membership) : false;
  const cancelKindLabel = cancelIsOneMonth ? 'one-month pass' : 'subscription';
  const financeTabs = isPaymentsWorkspace
    ? [['payments', 'Payments'], ...(canManageOrg(ctx) ? [['setup', 'Payment setup']] : [])]
    : [['memberships', 'Subscriptions & dues'], ['onetime', 'One-month passes'], ...(!isStudent ? [['plans', 'Plans']] : [])];
  return <>
    <ErpBlockingState {...props}/>
    <div className="page-heading"><div className="eyebrow">STUDIO ERP</div><h1>{isStudent ? (isPaymentsWorkspace ? 'My payments' : 'My subscriptions & passes') : (isPaymentsWorkspace ? 'Payments' : 'Subscriptions')} <span className="flower">✳</span></h1><p>{isStudent ? (isPaymentsWorkspace ? 'Your payment receipts and invoice PDFs in ₹.' : 'Your subscriptions, one-month passes, renewal dates, dues and invoice PDFs in ₹.') : (isPaymentsWorkspace ? 'Verified payments, receipts, invoice PDFs and payment setup in ₹.' : 'Odoo-style plan templates, subscription periods, one-month passes, renewals and dues in ₹. Renewals are manager-confirmed; no automatic charge is made.')}</p></div>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>
    <div className="erp-seg" role="tablist" aria-label={isPaymentsWorkspace ? 'Payments sections' : 'Subscriptions sections'} style={{marginBottom: 16}}>
      {financeTabs.map(([id, label]) =>
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </div>

    {tab === 'memberships' && <section className="erp-panel"><div className="erp-panel-head"><div><h2>Subscriptions & dues</h2><p>{visibleMemberships.length} of {memberships.length} subscription(s)</p></div>
      {canManage(ctx) && <div className="erp-actions"><button className="primary-button" onClick={() => openMembership('subscription')}><Plus size={16}/> New subscription</button></div>}</div>
      {canManage(ctx) && memberships.length > 0 && <div className="erp-grid erp-subscription-summary" aria-label="Subscription summary">
        <div className="erp-kpi"><small>Active subscriptions</small><strong>{subscriptionSummary.active}</strong><p>{subscriptionSummary.scheduled} scheduled</p></div>
        <div className="erp-kpi"><small>Paused subscriptions</small><strong>{subscriptionSummary.paused}</strong><p>Resume extends the end date</p></div>
        <div className="erp-kpi"><small>Renewals due</small><strong>{subscriptionSummary.renewalsDue}</strong><p>Expired or ending in 7 days</p></div>
        <div className="erp-kpi"><small>Monthly recurring revenue</small><strong>{formatINR(subscriptionSummary.mrr)}</strong><p>{billing.gstEnabled && !billing.priceIncludesGst ? 'Current active periods, before GST' : 'Current active periods'}</p></div>
      </div>}
      {memberships.length > 0 && <div className="erp-seg erp-subscription-filters" aria-label="Subscription status filter">
        {[['all', 'All'], ['active', 'Active'], ['paused', 'Paused'], ['renewals', 'Renewals due'], ['expired', 'Expired'], ['cancelled', 'Cancelled']].map(([id, label]) =>
          <button key={id} type="button" aria-pressed={subscriptionFilter === id} className={subscriptionFilter === id ? 'on' : ''} onClick={() => setSubscriptionFilter(id)}>{label}</button>)}
      </div>}
      {memberships.length === 0 ? <Empty icon={Wallet} title="No subscriptions yet" text={activePlans(data, 'subscription').length === 0 ? 'Create a subscription plan first (Plans tab), then assign it to a student.' : 'Assign a subscription plan to a student to start tracking periods, renewals and dues.'}/> : visibleMemberships.length === 0 ? <Empty icon={CalendarClock} title="No subscriptions in this view" text="Choose another subscription status above."/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Student</th><th>Plan & period</th><th>Amount</th><th>Paid</th><th>Due</th><th>Subscription</th><th>Actions</th></tr></thead><tbody>
        {visibleMemberships.map(m => {
          const bal = payableBalance(m, data.payments, billing, today);
          const lifecycle = subscriptionLifecycle(m, today);
          const renewal = childByPrevious.get(m.id);
          const renewalDate = nextRenewalDate(m, today, Boolean(renewal));
          return <tr key={m.id}>
          <td><strong>{studentName(data, m.studentId)}</strong><br/><small style={{color: '#9b92a4'}}>{branchName(data, m.branchId)} · {subscriptionPeriodLabel(m)}</small></td>
          <td>{planName(data, m.planId)}<br/><small style={{color: '#9b92a4'}}>{formatDate(m.startDate)} → {formatDate(m.endDate)}{m.billingCycle === 'calendar' ? ' · calendar month' : ''}{Number(m.totalPausedDays) > 0 ? ` · ${Number(m.totalPausedDays)} paused day(s)` : ''}
            {renewal ? <><br/>Renewed · next period starts {formatDate(renewal.startDate)}</> : renewalDate ? <><br/>Next renewal {formatDate(renewalDate)}</> : m.status === 'active' && m.autoRenew === false ? <><br/>Renewal tracking off</> : null}
            {lifecycle.id === 'paused' && <><br/>Paused from {formatDate(m.pausedFrom)}{m.pausedUntil ? ` · expected resume ${formatDate(m.pausedUntil)}` : ''}{m.pauseReason ? ` · ${m.pauseReason}` : ''}</>}
            {lifecycle.id === 'cancelled' && <><br/>Cancelled{m.cancelledAt ? ` ${formatDate(String(m.cancelledAt).slice(0, 10))}` : ''}{m.cancelReason ? ` · ${m.cancelReason}` : ''}</>}
          </small></td>
          <td>{formatINR(bal.total)}</td><td>{formatINR(bal.paid)}</td><td><strong>{formatINR(bal.due)}</strong></td>
          <td><SubscriptionBadge membership={m} today={today}/><br/><span className={`erp-badge ${bal.paymentStatus === 'paid' ? 'green' : bal.paymentStatus === 'partial' ? 'amber' : 'red'}`}>{bal.paymentStatus}</span>{lifecycle.id === 'active' && bal.daysLeft !== null && bal.daysLeft <= 7 ? <><br/><small style={{color: '#9a6b31'}}>{bal.daysLeft} day(s) left</small></> : null}</td>
          <td>{bal.due > 0 && m.status !== 'cancelled' && <button className="erp-link-btn" onClick={() => setInvoice({type: 'due', membership: m})}><Printer size={13}/> Invoice PDF</button>}
          <button className="erp-link-btn" onClick={() => setHistoryMembershipId(m.id)}><Clock size={13}/> History</button>
          {canManage(ctx) && m.status !== 'cancelled' && <><button className="erp-link-btn" onClick={() => openPayment(m)}><IndianRupee size={13}/> Collect</button>
          {lifecycle.id === 'active' && !renewal && <button className="erp-link-btn" onClick={() => openPause(m)}><CirclePause size={13}/> Pause</button>}
          {m.status === 'paused' && <button className="erp-link-btn" onClick={() => openResume(m)}><CirclePlay size={13}/> Resume</button>}
          {m.status === 'active' && !renewal && <button className="erp-link-btn" onClick={() => openRenew(m)}><Repeat size={13}/> Renew</button>}
          <button className="erp-link-btn erp-danger" onClick={() => setCancelForm({membership: m, reason: ''})}>Cancel subscription</button></>}</td></tr>; })}
      </tbody></table></div>}</section>}

    {tab === 'onetime' && <section className="erp-panel"><div className="erp-panel-head"><div><h2>One-month passes</h2><p>{visibleOneTimeMemberships.length} of {oneTimeMemberships.length} one-month pass(es) · fixed single month, no subscription renewal</p></div>
      {canManage(ctx) && <div className="erp-actions"><button className="primary-button" onClick={() => openMembership('one_month')}><Plus size={16}/> New one-month pass</button></div>}</div>
      {canManage(ctx) && oneTimeMemberships.length > 0 && <div className="erp-grid erp-subscription-summary" aria-label="One-month pass summary">
        <div className="erp-kpi"><small>Active one-month passes</small><strong>{oneTimeSummary.active}</strong><p>{oneTimeSummary.scheduled} scheduled</p></div>
        <div className="erp-kpi"><small>Outstanding dues</small><strong>{formatINR(oneTimeSummary.due)}</strong><p>Collect from Payments or a pass row</p></div>
        <div className="erp-kpi"><small>Expired passes</small><strong>{oneTimeSummary.expired}</strong><p>Create a new pass or subscription to continue</p></div>
        <div className="erp-kpi"><small>Renewal</small><strong>None</strong><p>One fixed month only</p></div>
      </div>}
      {oneTimeMemberships.length > 0 && <div className="erp-seg erp-subscription-filters" aria-label="One-month pass status filter">
        {[['all', 'All'], ['active', 'Active'], ['scheduled', 'Scheduled'], ['expired', 'Expired'], ['cancelled', 'Cancelled']].map(([id, label]) =>
          <button key={id} type="button" aria-pressed={oneTimeFilter === id} className={oneTimeFilter === id ? 'on' : ''} onClick={() => setOneTimeFilter(id)}>{label}</button>)}
      </div>}
      {oneTimeMemberships.length === 0 ? <Empty icon={CalendarClock} title="No one-month passes yet" text={activePlans(data, 'one_month').length === 0 ? 'Create a “One-month only” plan first (Plans tab), then assign it to a student.' : 'Assign a one-month-only plan when a student wants a single fixed month without a subscription.'}/> : visibleOneTimeMemberships.length === 0 ? <Empty icon={CalendarClock} title="No one-month passes in this view" text="Choose another pass status above."/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Student</th><th>Plan & period</th><th>Amount</th><th>Paid</th><th>Due</th><th>Pass</th><th>Actions</th></tr></thead><tbody>
        {visibleOneTimeMemberships.map(m => {
          const bal = payableBalance(m, data.payments, billing, today);
          const lifecycle = subscriptionLifecycle(m, today);
          return <tr key={m.id}>
          <td><strong>{studentName(data, m.studentId)}</strong><br/><small style={{color: '#9b92a4'}}>{branchName(data, m.branchId)} · One-month pass</small></td>
          <td>{planName(data, m.planId)}<br/><small style={{color: '#9b92a4'}}>{formatDate(m.startDate)} → {formatDate(m.endDate)}{m.billingCycle === 'calendar' ? ' · calendar month' : ' · joining date'}<br/>One month only · no renewal
            {lifecycle.id === 'cancelled' && <><br/>Cancelled{m.cancelledAt ? ` ${formatDate(String(m.cancelledAt).slice(0, 10))}` : ''}{m.cancelReason ? ` · ${m.cancelReason}` : ''}</>}
          </small></td>
          <td>{formatINR(bal.total)}</td><td>{formatINR(bal.paid)}</td><td><strong>{formatINR(bal.due)}</strong></td>
          <td><SubscriptionBadge membership={m} today={today}/><br/><span className={`erp-badge ${bal.paymentStatus === 'paid' ? 'green' : bal.paymentStatus === 'partial' ? 'amber' : 'red'}`}>{bal.paymentStatus}</span>{lifecycle.id === 'active' && bal.daysLeft !== null && bal.daysLeft <= 7 ? <><br/><small style={{color: '#9a6b31'}}>{bal.daysLeft} day(s) left</small></> : null}</td>
          <td>{bal.due > 0 && m.status !== 'cancelled' && <button className="erp-link-btn" onClick={() => setInvoice({type: 'due', membership: m})}><Printer size={13}/> Invoice PDF</button>}
          {canManage(ctx) && m.status !== 'cancelled' && <><button className="erp-link-btn" onClick={() => openPayment(m)}><IndianRupee size={13}/> Collect</button>
          <button className="erp-link-btn erp-danger" onClick={() => setCancelForm({membership: m, reason: ''})}>Cancel pass</button></>}</td></tr>; })}
      </tbody></table></div>}</section>}

    {tab === 'payments' && <section className="erp-panel"><div className="erp-panel-head"><div><h2>Payments</h2><p>{payments.length} payment(s) · {formatINR(payments.filter(p => p.status !== 'void').reduce((s, p) => s + (p.amountPaise || 0), 0))} collected shown</p></div>
      <div className="erp-actions"><button className="secondary-button" onClick={() => exportCSV('payments.csv', payments, [{label: 'Receipt', value: p => p.receiptNo || 'Pending sync'}, {label: 'Date', value: p => p.paidOn}, {label: 'Student', value: p => studentName(data, p.studentId)}, {label: 'Method', value: p => p.method}, {label: 'Amount (INR)', value: p => paiseToRupees(p.amountPaise)}, {label: 'Status', value: p => p.status || 'recorded'}])}><Download size={15}/> CSV</button>
      {canManage(ctx) && <button className="primary-button" onClick={() => openPayment(null)}><Plus size={16}/> Record payment</button>}</div></div>
      {payments.length === 0 ? <Empty icon={IndianRupee} title="No payments recorded" text="Record verified cash, UPI, card or bank payments. Supabase assigns the final receipt number after sync; local mode generates one on this device."/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Receipt</th><th>Date</th><th>Student</th><th>Method</th><th>Amount</th><th>Actions</th></tr></thead><tbody>
        {payments.map(p => <tr key={p.id}><td><strong>{p.receiptNo || 'Pending sync'}</strong>{p.syncPending && <><br/><span className="erp-badge amber">On this device</span></>}{p.status === 'void' && <><br/><span className="erp-badge red">VOID</span></>}</td><td>{formatDate(p.paidOn)}</td><td>{studentName(data, p.studentId)}</td><td style={{textTransform: 'capitalize'}}>{PAYMENT_METHODS.find(m => m.id === p.method)?.label || p.method}</td><td><strong style={p.status === 'void' ? {textDecoration: 'line-through'} : undefined}>{formatINR(p.amountPaise)}</strong></td>
        <td>{p.receiptNo && <button className="erp-link-btn" onClick={() => setInvoice({type: 'payment', payment: p})}><Printer size={13}/> Invoice PDF</button>}
        {canManage(ctx) && p.status !== 'void' && (p.syncPending && !p.receiptNo
          ? <button className="erp-link-btn erp-danger" disabled={erp.syncState?.syncing} onClick={async () => { if (window.confirm('Discard this payment before it syncs? It has not received a Supabase receipt yet.')) await erp.act(c => c.voidPayment({id: p.id}), 'Pending payment discarded.'); }}>Discard pending</button>
          : <button className="erp-link-btn erp-danger" onClick={async () => { const reason = window.prompt('Reason for voiding this payment (required for audit):', ''); if (reason === null) return; if (!reason.trim()) return props.notify('Enter a reason to void this payment.'); await erp.act(c => c.voidPayment({id: p.id, reason: reason.trim()}), 'Payment voided. The original receipt remains in history.'); }}>Void</button>)}</td></tr>)}
      </tbody></table></div>}</section>}

    {tab === 'plans' && !isStudent && <section className="erp-panel"><div className="erp-panel-head"><div><h2>Plans</h2><p>{data.plans.length} Odoo-style plan template(s) · billing period and alignment are defaults for new periods{!canManageOrg(ctx) ? ' · Organization plans are maintained by Owner/Co-owner.' : ''}</p></div>
      {canManageOrg(ctx) && <button className="primary-button" onClick={() => setPlanForm({name: '', amountRupees: '', durationMonths: 1, planType: 'subscription', billingCycle: 'joining', renewalEnabledDefault: true, status: 'active'})}><Plus size={16}/> Add plan</button>}</div>
      {data.plans.length === 0 ? <Empty icon={Wallet} title="No plans yet" text="Example: “Monthly — All Batches” as a subscription at ₹1,500 every month, or a separate “One Month Only” pass. You decide the names and prices."/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Plan</th><th>Price</th><th>Billing period</th><th>Renewal</th><th>Active now</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {data.plans.map(p => { const template = normalizePlanTemplate(p); return <tr key={p.id}><td><strong>{p.name}</strong><br/><small style={{color: '#9b92a4'}}>{planTypeLabel(p)}</small></td><td>{formatINR(p.amountPaise)}{billing.gstEnabled && !billing.priceIncludesGst ? ' + GST' : ''}</td><td>{planBillingPeriodLabel(p)}<br/><small style={{color: '#9b92a4'}}>{template.billingCycle === 'calendar' ? 'Calendar month' : 'Joining date'}</small></td><td>{template.planType === 'one_month' ? 'No renewal' : template.renewalEnabledDefault ? 'Tracking on' : 'Tracking off'}</td><td>{data.memberships.filter(m => m.planId === p.id && subscriptionLifecycle(m, today).id === 'active').length}</td>
        <td><span className={`erp-badge ${p.status === 'archived' ? 'grey' : 'green'}`}>{p.status === 'archived' ? 'Archived' : 'Active'}</span></td>
        <td>{canManageOrg(ctx) && <button className="erp-link-btn" onClick={() => setPlanForm({...p, ...template, amountRupees: paiseToRupees(p.amountPaise), status: p.status || 'active'})}><Pencil size={13}/> Edit</button>}</td></tr>; })}
      </tbody></table></div>}</section>}

    {tab === 'setup' && canManageOrg(ctx) && <PaymentSetupPanel data={data} erp={erp} mode={props.mode}/>}

    {planForm && <Dialog title={planForm.id ? 'Edit plan' : 'Add plan'} sub="Odoo-style plan template: choose the offering type, billing period and period alignment. Template changes apply to new periods and future renewals; existing periods keep their snapshot type, amount and dates." onClose={() => setPlanForm(null)}>
      <form className="erp-form" onSubmit={async e => { e.preventDefault(); const template = normalizePlanTemplate(planForm); if (await erp.act(c => c.savePlan({id: planForm.id, name: planForm.name, amountPaise: rupeesToPaise(planForm.amountRupees), ...template, status: planForm.status || 'active'}), 'Plan saved.')) setPlanForm(null); }}>
        <label className="erp-field">Plan name<input required value={planForm.name} onChange={e => setPlanForm({...planForm, name: e.target.value})} placeholder={planForm.planType === 'one_month' ? 'e.g. One Month Only — All Batches' : 'e.g. Monthly — All Batches'}/></label>
        <label className="erp-field">Plan type<select value={planForm.planType || 'subscription'} onChange={e => { const planType = e.target.value; setPlanForm({...planForm, planType, durationMonths: planType === 'one_month' ? 1 : (Number(planForm.durationMonths) || 1), renewalEnabledDefault: planType === 'one_month' ? false : planForm.renewalEnabledDefault !== false}); }}>{PLAN_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
        <label className="erp-field">Price (₹{billing.gstEnabled && !billing.priceIncludesGst ? ', before GST' : ''})<input type="number" min={0} step="0.01" required value={planForm.amountRupees} onChange={e => setPlanForm({...planForm, amountRupees: e.target.value})}/></label>
        <label className="erp-field">Billing period (months)<input type="number" min={1} max={24} required disabled={planForm.planType === 'one_month'} value={planForm.planType === 'one_month' ? 1 : planForm.durationMonths} onChange={e => setPlanForm({...planForm, durationMonths: e.target.value})}/></label>
        <label className="erp-field">Default billing cycle<select value={planForm.billingCycle || 'joining'} onChange={e => setPlanForm({...planForm, billingCycle: e.target.value})}><option value="joining">Joining date (monthly anniversary)</option><option value="calendar">Calendar month (align to period start)</option></select></label>
        <label className="erp-field">Plan status<select value={planForm.status || 'active'} onChange={e => setPlanForm({...planForm, status: e.target.value})}><option value="active">Active</option><option value="archived">Archived</option></select></label>
        {planForm.planType === 'one_month'
          ? <span className="erp-field full">Renewal<span style={{fontSize: 14, color: '#3d3547'}}>No renewal — each sale is one fixed month. Pause and subscription renewal controls will not appear.</span></span>
          : <label className="erp-toggle-row full"><input type="checkbox" checked={planForm.renewalEnabledDefault !== false} onChange={e => setPlanForm({...planForm, renewalEnabledDefault: e.target.checked})}/> <span>Renewal tracking on by default for new subscriptions (manager-confirmed, no automatic charge)</span></label>}
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setPlanForm(null)}>Cancel</button><button className="primary-button">Save plan</button></div></form></Dialog>}

    {membershipForm && (() => {
      const formOfferingType = normalizePlanType(membershipForm.offeringType);
      const formIsOneMonth = formOfferingType === 'one_month';
      const formPlans = activePlans(data, formOfferingType);
      const selectedPlan = data.plans.find(plan => plan.id === membershipForm.planId) || null;
      const selectedTemplate = normalizePlanTemplate(selectedPlan || {planType: formOfferingType});
      return <Dialog title={formIsOneMonth ? 'New one-month pass' : 'New subscription'} sub={formIsOneMonth ? 'Create one fixed month with its own due balance and invoice. It does not renew and cannot be paused. Payments are collected manually after verification.' : 'Choose calendar-month billing (1st to month-end) or joining-date billing (same date monthly). Renewal is tracked here; it does not charge the student automatically.'} onClose={() => setMembershipForm(null)}>
      <form className="erp-form" onSubmit={async e => { e.preventDefault(); const student = data.students.find(s => s.id === membershipForm.studentId); const plan = data.plans.find(p => p.id === membershipForm.planId); const template = normalizePlanTemplate(plan || {planType: formOfferingType});
        if (await erp.act(c => c.saveMembership({
          studentId: membershipForm.studentId, planId: membershipForm.planId, branchId: student?.branchId || '',
          startDate: membershipForm.startDate, billingCycle: membershipForm.billingCycle,
          durationMonths: template.durationMonths, amountPaise: rupeesToPaise(membershipForm.amountRupees),
          status: 'active', offeringType: formOfferingType,
          autoRenew: formIsOneMonth ? false : membershipForm.autoRenew !== false,
          previousMembershipId: '', renewalNumber: 0, totalPausedDays: 0,
        }), formIsOneMonth ? 'One-month pass created.' : 'Subscription created.')) setMembershipForm(null); }}>
        <label className="erp-field">Student<select required value={membershipForm.studentId} onChange={e => setMembershipForm({...membershipForm, studentId: e.target.value})}>{data.students.filter(s => s.status === 'active' && inBranch(ctx, s.branchId)).map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select></label>
        <label className="erp-field">Plan<select required value={membershipForm.planId} onChange={e => { const plan = data.plans.find(p => p.id === e.target.value); const template = normalizePlanTemplate(plan || {planType: formOfferingType}); setMembershipForm({...membershipForm, planId: e.target.value, amountRupees: plan ? paiseToRupees(plan.amountPaise) : '', billingCycle: template.billingCycle, autoRenew: template.renewalEnabledDefault}); }}>{formPlans.length === 0 && <option value="">{formIsOneMonth ? 'No active one-month plan available' : 'No active subscription plan available'}</option>}{formPlans.map(p => <option key={p.id} value={p.id}>{p.name} · {formatINR(p.amountPaise)} · {planBillingPeriodLabel(p)}</option>)}</select></label>
        <label className="erp-field">Start date<input type="date" required value={membershipForm.startDate} onChange={e => setMembershipForm({...membershipForm, startDate: e.target.value})}/></label>
        <label className="erp-field">Billing cycle<select value={membershipForm.billingCycle} onChange={e => setMembershipForm({...membershipForm, billingCycle: e.target.value})}><option value="joining">Joining date (monthly)</option><option value="calendar">Calendar month</option></select></label>
        <label className="erp-field">Amount (₹{billing.gstEnabled && !billing.priceIncludesGst ? ', before GST' : ''})<input type="number" min={0} step="0.01" required value={membershipForm.amountRupees} onChange={e => setMembershipForm({...membershipForm, amountRupees: e.target.value})}/></label>
        <span className="erp-field">Ends on<span style={{fontSize: 14, color: '#3d3547'}}>{formatDate(membershipEnd(membershipForm.startDate, selectedTemplate.durationMonths, membershipForm.billingCycle))}</span></span>
        {formIsOneMonth
          ? <span className="erp-field full">Renewal<span style={{fontSize: 14, color: '#3d3547'}}>No renewal — this pass ends after one month.</span></span>
          : <label className="erp-toggle-row full"><input type="checkbox" checked={membershipForm.autoRenew !== false} onChange={e => setMembershipForm({...membershipForm, autoRenew: e.target.checked})}/> <span>Renewal enabled — show the next renewal date and renewal reminders (manager-confirmed, no automatic charge)</span></label>}
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setMembershipForm(null)}>Cancel</button><button className="primary-button" disabled={!membershipForm.planId}>{formIsOneMonth ? 'Create one-month pass' : 'Create subscription'}</button></div></form></Dialog>;
    })()}

    {pauseForm && <Dialog title="Pause subscription" sub={`Pause ${studentName(data, pauseForm.membership.studentId)}’s current period. When it resumes, the elapsed pause days are added to the end date. Attendance and batch enrolment are not changed automatically.`} onClose={() => setPauseForm(null)}>
      <form className="erp-form" onSubmit={async e => { e.preventDefault();
        if (await erp.act(c => c.saveMembership({
          ...pauseForm.membership, status: 'paused', pausedFrom: pauseForm.pausedFrom,
          pausedUntil: pauseForm.pausedUntil, pauseReason: pauseForm.reason.trim(),
        }), 'Subscription paused.')) setPauseForm(null); }}>
        <label className="erp-field">Pause from<input type="date" required min={pauseForm.membership.startDate} max={pauseForm.membership.endDate} value={pauseForm.pausedFrom} onChange={e => setPauseForm({...pauseForm, pausedFrom: e.target.value})}/></label>
        <label className="erp-field">Expected resume date<input type="date" min={pauseForm.pausedFrom} value={pauseForm.pausedUntil} onChange={e => setPauseForm({...pauseForm, pausedUntil: e.target.value})}/></label>
        <label className="erp-field full">Pause reason<input maxLength={500} value={pauseForm.reason} onChange={e => setPauseForm({...pauseForm, reason: e.target.value})} placeholder="Travel, medical break, exams…"/></label>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setPauseForm(null)}>Cancel</button><button className="primary-button">Pause subscription</button></div></form></Dialog>}

    {resumeForm && <Dialog title="Resume subscription" sub={`Resume ${studentName(data, resumeForm.membership.studentId)}’s subscription. Days since ${formatDate(resumeForm.membership.pausedFrom)} will be added to its end date.`} onClose={() => setResumeForm(null)}>
      <form className="erp-form" onSubmit={async e => { e.preventDefault(); const addedDays = pauseDaysBetween(resumeForm.membership.pausedFrom, resumeForm.resumeDate);
        if (await erp.act(c => c.saveMembership({
          ...resumeForm.membership, status: 'active', pausedFrom: '', pausedUntil: '', pauseReason: '',
          totalPausedDays: (Number(resumeForm.membership.totalPausedDays) || 0) + addedDays,
          cancelledAt: null, cancelReason: '',
        }), `Subscription resumed. Its end date moved by ${addedDays} paused day(s).`)) setResumeForm(null); }}>
        <label className="erp-field">Resume date<input type="date" required min={resumeForm.membership.pausedFrom} value={resumeForm.resumeDate} onChange={e => setResumeForm({...resumeForm, resumeDate: e.target.value})}/></label>
        <span className="erp-field">New end date<span style={{fontSize: 14, color: '#3d3547'}}>{formatDate(membershipEnd(resumeForm.membership.startDate, resumeForm.membership.durationMonths, resumeForm.membership.billingCycle, (Number(resumeForm.membership.totalPausedDays) || 0) + pauseDaysBetween(resumeForm.membership.pausedFrom, resumeForm.resumeDate)))}</span></span>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setResumeForm(null)}>Cancel</button><button className="primary-button">Resume subscription</button></div></form></Dialog>}

    {cancelForm && <Dialog title={cancelIsOneMonth ? 'Cancel one-month pass' : 'Cancel subscription'} sub={`Cancel ${studentName(data, cancelForm.membership.studentId)}’s ${cancelKindLabel} period. It cannot be reopened; recorded payments and receipts remain in history. Create a new ${cancelKindLabel} if the student returns.`} onClose={() => setCancelForm(null)}>
      <form className="erp-form" onSubmit={async e => { e.preventDefault();
        if (await erp.act(c => c.cancelMembership({id: cancelForm.membership.id, reason: cancelForm.reason.trim()}), cancelIsOneMonth ? 'One-month pass cancelled.' : 'Subscription cancelled.')) setCancelForm(null); }}>
        <label className="erp-field full">Cancellation reason<input maxLength={500} value={cancelForm.reason} onChange={e => setCancelForm({...cancelForm, reason: e.target.value})} placeholder="Student requested, moving, completed…"/></label>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setCancelForm(null)}>{cancelIsOneMonth ? 'Keep pass' : 'Keep subscription'}</button><button className="danger-button">{cancelIsOneMonth ? 'Cancel one-month pass' : 'Cancel subscription'}</button></div></form></Dialog>}

    {renewForm && (() => { const renewalPlan = activePlans(data, 'subscription').find(plan => plan.id === renewForm.planId); return <Dialog title="Renew subscription" sub={`Create the next period for ${studentName(data, renewForm.membership.studentId)} at the current Plan price and duration. The existing period, its payments and receipts stay unchanged.`} onClose={() => setRenewForm(null)}>
      <form className="erp-form" onSubmit={async e => { e.preventDefault(); if (!renewalPlan) return;
        if (await erp.act(c => c.saveMembership({
          studentId: renewForm.membership.studentId, planId: renewalPlan.id,
          branchId: renewForm.membership.branchId, startDate: renewForm.startDate,
          billingCycle: renewForm.billingCycle, durationMonths: renewalPlan.durationMonths,
          amountPaise: renewalPlan.amountPaise, status: 'active', offeringType: 'subscription',
          autoRenew: renewForm.autoRenew !== false,
          previousMembershipId: renewForm.membership.id,
          renewalNumber: (Number(renewForm.membership.renewalNumber) || 0) + 1,
          pausedFrom: '', pausedUntil: '', pauseReason: '', totalPausedDays: 0,
          cancelledAt: null, cancelReason: '',
        }), 'Renewal subscription created at the current plan price. Its due balance and invoice are ready in Subscriptions & dues.')) setRenewForm(null); }}>
        <label className="erp-field">Renewal plan<select required value={renewForm.planId} onChange={e => { const plan = activePlans(data, 'subscription').find(item => item.id === e.target.value); const template = normalizePlanTemplate(plan || {}); setRenewForm({...renewForm, planId: e.target.value, billingCycle: template.billingCycle, autoRenew: template.renewalEnabledDefault}); }}>{activePlans(data, 'subscription').length === 0 && <option value="">No active subscription plan available</option>}{activePlans(data, 'subscription').map(plan => <option key={plan.id} value={plan.id}>{plan.name} · {formatINR(plan.amountPaise)} · {planBillingPeriodLabel(plan)}</option>)}</select></label>
        <label className="erp-field">Renewal start date<input type="date" required value={renewForm.startDate} onChange={e => setRenewForm({...renewForm, startDate: e.target.value})}/></label>
        <label className="erp-field">Billing cycle<select value={renewForm.billingCycle} onChange={e => setRenewForm({...renewForm, billingCycle: e.target.value})}><option value="joining">Joining date (monthly)</option><option value="calendar">Calendar month</option></select></label>
        <label className="erp-field">Renewal amount (₹)<input type="number" readOnly value={renewalPlan ? paiseToRupees(renewalPlan.amountPaise) : ''}/></label>
        <span className="erp-field">Renewal ends<span style={{fontSize: 14, color: '#3d3547'}}>{renewalPlan ? formatDate(membershipEnd(renewForm.startDate, renewalPlan.durationMonths, renewForm.billingCycle)) : '—'}</span></span>
        <label className="erp-toggle-row full"><input type="checkbox" checked={renewForm.autoRenew !== false} onChange={e => setRenewForm({...renewForm, autoRenew: e.target.checked})}/> <span>Keep renewal enabled</span></label>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setRenewForm(null)}>Cancel</button><button className="primary-button" disabled={!renewalPlan}>Create renewal</button></div></form></Dialog>; })()}

    {historyMembership && <Dialog title="Subscription history" sub={`${studentName(data, historyMembership.studentId)} · ${historyChain.length} linked period(s)`} onClose={() => setHistoryMembershipId('')} className="erp-dialog-wide">
      <div className="erp-subscription-history">
        {historyChain.map(chainMembership => { const chainBalance = payableBalance(chainMembership, data.payments, billing, today); const chainLifecycle = subscriptionLifecycle(chainMembership, today); return <article key={chainMembership.id} className="erp-subscription-history-item">
          <div><strong>{subscriptionPeriodLabel(chainMembership)}</strong><SubscriptionBadge membership={chainMembership} today={today}/></div>
          <p>{planName(data, chainMembership.planId)} · {formatDate(chainMembership.startDate)} → {formatDate(chainMembership.endDate)}</p>
          <p>{formatINR(chainBalance.total)} total · {formatINR(chainBalance.paid)} paid · {formatINR(chainBalance.due)} due</p>
          {Number(chainMembership.totalPausedDays) > 0 && <small>{Number(chainMembership.totalPausedDays)} paused day(s) added to this period</small>}
          {chainLifecycle.id === 'paused' && <small>Paused from {formatDate(chainMembership.pausedFrom)}{chainMembership.pausedUntil ? ` · expected resume ${formatDate(chainMembership.pausedUntil)}` : ''}{chainMembership.pauseReason ? ` · ${chainMembership.pauseReason}` : ''}</small>}
          {chainLifecycle.id === 'cancelled' && <small>Cancelled{chainMembership.cancelledAt ? ` ${formatDate(String(chainMembership.cancelledAt).slice(0, 10))}` : ''}{chainMembership.cancelReason ? ` · ${chainMembership.cancelReason}` : ''}</small>}
        </article>; })}
      </div>
      <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setHistoryMembershipId('')}>Close</button></div></Dialog>}

    {paymentForm && <Dialog title="Record verified payment" sub="Record only after funds are received/verified. A final receipt number is assigned by Supabase; if offline, the payment is saved on this device first and the receipt appears after sync." onClose={() => setPaymentForm(null)}>
      <form className="erp-form" onSubmit={async e => { e.preventDefault(); const m = data.memberships.find(x => x.id === paymentForm.membershipId); if (!m) return;
        if (await erp.act(c => c.recordPayment({membershipId: m.id, studentId: m.studentId, branchId: m.branchId, amountPaise: rupeesToPaise(paymentForm.amountRupees), method: paymentForm.method, paidOn: paymentForm.paidOn, note: paymentForm.note}), 'Payment recorded. Receipt is in Payments.')) { setPaymentForm(null); if (isPaymentsWorkspace) setTab('payments'); else go?.('payments'); } }}>
        <label className="erp-field full">Subscription or one-month pass<select required value={paymentForm.membershipId} onChange={e => { const m = data.memberships.find(x => x.id === e.target.value); setPaymentForm({...paymentForm, membershipId: e.target.value, amountRupees: m ? paiseToRupees(payableBalance(m, data.payments, billing, today).due) : ''}); }}>
          {collectableMemberships.map(m => <option key={m.id} value={m.id}>{studentName(data, m.studentId)} · {planName(data, m.planId)} · {membershipKindLabel(data, m)} · {subscriptionLifecycle(m, today).id} · due {formatINR(payableBalance(m, data.payments, billing, today).due)}</option>)}</select></label>
        <label className="erp-field">Amount received (₹)<input type="number" min="0.01" step="0.01" required value={paymentForm.amountRupees} onChange={e => setPaymentForm({...paymentForm, amountRupees: e.target.value})}/></label>
        <label className="erp-field">Method<select value={paymentForm.method} onChange={e => setPaymentForm({...paymentForm, method: e.target.value})}>{PAYMENT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <label className="erp-field">Paid on<input type="date" required value={paymentForm.paidOn} onChange={e => setPaymentForm({...paymentForm, paidOn: e.target.value})}/></label>
        <label className="erp-field">Note / transaction reference<input value={paymentForm.note} onChange={e => setPaymentForm({...paymentForm, note: e.target.value})} placeholder="UPI/bank/card reference (recommended)"/></label>
        {(paymentConfigWarning || paymentGstWarning) && <div className="erp-banner" style={{gridColumn: '1 / -1', margin: 0}}><AlertCircle size={18}/><div>{paymentConfigWarning || paymentGstWarning}{paymentConfigWarning && paymentGstWarning ? <> {paymentGstWarning}</> : null}{paymentConfigWarning && canManageOrg(ctx) ? <> <button type="button" className="erp-link-btn" onClick={() => { setPaymentForm(null); if (isPaymentsWorkspace) setTab('setup'); else go?.('payments'); }}>{isPaymentsWorkspace ? 'Open Payment setup' : 'Open Payments'}</button></> : null}</div></div>}
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setPaymentForm(null)}>Cancel</button><button className="primary-button">Save payment</button></div></form></Dialog>}

    {invoice && <InvoiceDialog data={data} invoice={invoice} onClose={() => setInvoice(null)}/>}
  </>;
}

export function SubscriptionsPage(props) {
  return <FinanceWorkspacePage {...props} workspace="subscriptions"/>;
}

export function PaymentsPage(props) {
  if (props.ctx?.role === 'instructor') return <InstructorPaymentsPage {...props}/>;
  return <FinanceWorkspacePage {...props} workspace="payments"/>;
}

/** Compatibility for older imports/navigation saved in browser sessions. */
export function FeesPage(props) {
  return <SubscriptionsPage {...props}/>;
}

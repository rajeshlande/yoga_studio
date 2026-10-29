import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  AlertCircle, Building2, CalendarCheck, Check, Clock, Download, IndianRupee, Leaf,
  Pencil, Plus, Printer, RefreshCw, Search, Users, Wallet, WifiOff, X,
} from 'lucide-react';
import {createErpClient, isMissingRpcError} from '../lib/erp/data.js';
import {
  ATTENDANCE_STATUSES, DAY_LABELS, PAYMENT_METHODS, ROLES, attendanceSummary, batchTimeLabel,
  emptySnapshot, formatDate, formatINR, initials, isBatchOnDate, membershipBalance,
  membershipEnd, paiseToRupees, rupeesToPaise, toCSV, toISODate,
} from '../lib/erp/logic.js';
import './erp.css';

/* ---------------- data hook: one snapshot load, one call per action ---------------- */

const defaultSyncState = mode => ({
  enabled: mode === 'supabase', mode, online: typeof navigator === 'undefined' || navigator.onLine,
  syncing: false, setupNeeded: false, hasCache: false, pendingCount: 0, conflictCount: 0,
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
    try {
      if (mode === 'supabase' && client.getContext) {
        try {
          const ctx = await client.getContext();
          setRemoteContext(ctx);
          if (ctx && !contextSent.current) { contextSent.current = true; onRemoteContext?.(ctx); }
        } catch { setRemoteContext(null); }
      }
      setData(await client.getSnapshot());
      if (client.getSyncState) setSyncState(client.getSyncState());
    } catch (err) { setError(err); }
    finally { setLoading(false); }
  }, [client, enabled, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { contextSent.current = false; load(); }, [load]);

  const syncNow = useCallback(async () => {
    if (!enabled || mode !== 'supabase' || !client.syncNow) return false;
    try {
      const next = await client.syncNow();
      if (next) setData(next);
      if (client.getSyncState) setSyncState(client.getSyncState());
      const current = client.getSyncState?.();
      if (current?.conflictCount) notify(`${current.conflictCount} sync conflict(s) need review.`);
      else if (current?.pendingCount) notify(`${current.pendingCount} change(s) are still waiting to sync.`);
      else if (current?.online) notify('Studio data is synced.');
      return true;
    } catch (err) {
      notify(err?.message || 'Sync could not be completed.');
      return false;
    }
  }, [client, enabled, mode, notify]);

  useEffect(() => {
    if (!enabled || mode !== 'supabase') return undefined;
    const refreshState = () => { if (client.getSyncState) setSyncState(client.getSyncState()); };
    const onOnline = () => { refreshState(); client.syncNow?.().then(next => { if (next) setData(next); }).catch(() => {}); };
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      if (Date.now() - lastFocusSync.current < 15_000) return;
      lastFocusSync.current = Date.now();
      client.syncNow?.().then(next => { if (next) setData(next); }).catch(() => {});
    };
    const onStorage = event => {
      if (event.key?.startsWith('yoga-studio-erp-sync-v1:')) client.refreshFromStorage?.();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', refreshState);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', refreshState);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
    };
  }, [client, enabled, mode]);

  useEffect(() => {
    if (syncState.conflictCount > previousConflictCount.current) {
      notify(`${syncState.conflictCount} sync conflict(s) need review. No change was overwritten.`);
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
      notify(isMissingRpcError(err)
        ? 'Supabase ERP setup is not installed yet. Run supabase/erp_setup.sql, then try again.'
        : (err?.message || 'Could not save. Please try again.'));
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
      notify(err?.message || 'That conflict could not be resolved.');
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
function inBranch(ctx, branchId) { return !ctx.branchId || ctx.branchId === 'all' || ctx.branchId === branchId; }

function Dialog({title, sub, onClose, children}) {
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="erp-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <button className="icon-button dialog-close" aria-label={`Close ${title}`} onClick={onClose}><X size={20}/></button>
      <h2>{title}</h2>{sub && <p className="dialog-sub">{sub}</p>}{children}
    </div>
  </div>;
}

function Empty({icon: Icon, title, text, action}) {
  return <div className="erp-empty"><Icon size={34} strokeWidth={1.4}/><h3>{title}</h3><p>{text}</p>{action}</div>;
}

export function ErpBlockingState({erp, mode, setMode}) {
  const [orgName, setOrgName] = useState('Yoga Studio');
  if (!erp.error) return null;
  const noOrg = /NO_ORGANIZATION|no organization/i.test(erp.error.message || '');
  return <div className="erp-banner blue" role="alert"><AlertCircle size={20}/>
    <div style={{flex: 1}}>
      {erp.setupNeeded ? <>
        <strong>Supabase ERP setup is not installed yet.</strong><br/>
        Open your Supabase project → <b>SQL Editor</b> → paste the full contents of <b>supabase/erp_setup.sql</b> from this repository → <b>Run</b>. Then retry. Your existing login keeps working either way.
      </> : noOrg ? <>
        <strong>Create your organization to begin.</strong><br/>
        This one step makes your signed-in account the Owner. You can add branches right after.
        <div className="erp-actions" style={{marginTop: 10}}>
          <span className="erp-search"><Building2 size={15}/><input aria-label="Organization name" value={orgName} onChange={e => setOrgName(e.target.value)}/></span>
          <button className="primary-button" onClick={async () => { if (await erp.act(c => c.bootstrapOrganization(orgName.trim() || 'Yoga Studio'), 'Organization created. Add your first branch.')) erp.load(); }}>Create organization</button>
        </div>
      </> : <><strong>Could not load studio data.</strong><br/>{erp.error.message || 'Please check your connection and try again.'}</>}
      <div className="erp-actions" style={{marginTop: 10}}>
        <button className="secondary-button" onClick={erp.load}>Retry</button>
        {mode === 'supabase' && <button className="secondary-button" onClick={() => setMode('local')}>Use this device only (offline)</button>}
      </div>
    </div>
  </div>;
}

const SYNC_ENTITY_LABELS = {
  branches: 'Branch', students: 'Student', instructors: 'Instructor', batches: 'Batch',
  enrollments: 'Enrollment', attendance: 'Attendance', plans: 'Plan',
  memberships: 'Membership', payments: 'Payment',
};
const SYNC_FIELD_LABELS = {
  name: 'Name', fullName: 'Full name', branchId: 'Branch', studentId: 'Student',
  instructorId: 'Instructor', batchId: 'Batch', planId: 'Plan', membershipId: 'Membership',
  city: 'City', address: 'Address', phone: 'Phone', email: 'Email', gender: 'Gender',
  dob: 'Date of birth', joiningDate: 'Joining date', joinedOn: 'Joined on', status: 'Status',
  notes: 'Notes', days: 'Days', startTime: 'Start time', durationMins: 'Duration (mins)',
  capacity: 'Capacity', classDate: 'Class date', amountPaise: 'Amount', durationMonths: 'Duration (months)',
  startDate: 'Start date', endDate: 'End date', billingCycle: 'Billing cycle', method: 'Method',
  paidOn: 'Paid on', note: 'Note', receiptNo: 'Receipt', voidReason: 'Void reason',
};

function syncValue(field, value, data) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'amountPaise') return formatINR(value);
  if (field === 'days' && Array.isArray(value)) return value.map(day => DAY_LABELS[day] || day).join(', ');
  if (field === 'branchId') return branchName(data, value);
  if (field === 'studentId') return studentName(data, value);
  if (field === 'instructorId') return instructorName(data, value);
  if (field === 'batchId') return data.batches.find(batch => batch.id === value)?.name || '—';
  if (field === 'planId') return planName(data, value);
  if (field === 'membershipId') {
    const membership = data.memberships.find(item => item.id === value);
    return membership ? `${studentName(data, membership.studentId)} · ${formatDate(membership.startDate)}` : '—';
  }
  if (/Date$|dob|joinedOn|paidOn/.test(field) && typeof value === 'string') return formatDate(value);
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
  if (conflict.op.entity === 'memberships') return `Membership: ${studentName(data, record.studentId)}`;
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
        .filter(field => !['id', 'createdAt', 'updatedAt', 'syncVersion', 'syncPending'].includes(field))
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
  const roles = mode === 'supabase' && remoteContext?.roles?.length
    ? ROLES.filter(r => remoteContext.roles.includes(r.id))
    : ROLES;
  const set = patch => setCtx(prev => ({...prev, ...patch}));
  return <div className="erp-toolbar" aria-label="ERP filters">
    <label>Portal
      <select aria-label="Portal role" value={ctx.role} onChange={e => set({role: e.target.value})}>
        {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
    </label>
    <label>Branch
      <select aria-label="Branch filter" value={ctx.branchId || 'all'} onChange={e => set({branchId: e.target.value})}>
        <option value="all">All branches</option>
        {data.branches.filter(b => b.status !== 'archived').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
    {ctx.role === 'instructor' && <label>Acting instructor
      <select aria-label="Acting instructor" value={ctx.instructorId || ''} onChange={e => set({instructorId: e.target.value})}>
        <option value="">Choose instructor…</option>
        {data.instructors.filter(i => i.status !== 'inactive').map(i => <option key={i.id} value={i.id}>{i.fullName}</option>)}
      </select>
    </label>}
    {ctx.role === 'student' && <label>Acting student
      <select aria-label="Acting student" value={ctx.studentId || ''} onChange={e => set({studentId: e.target.value})}>
        <option value="">Choose student…</option>
        {data.students.filter(s => s.status === 'active').map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}
      </select>
    </label>}
    <SyncControls data={data} erp={erp} mode={mode}/>
  </div>;
}

const canManage = ctx => ctx.role === 'owner' || ctx.role === 'admin';

/* ---------------- dashboard ---------------- */

export function ErpDashboardSection(props) {
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
  const collected = monthPayments.reduce((s, p) => s + (p.amountPaise || 0), 0);
  const dues = data.memberships.filter(m => m.status === 'active')
    .map(m => ({m, bal: membershipBalance(m, data.payments, today)}))
    .filter(x => x.bal.due > 0 && inBranch(ctx, x.m.branchId) && (ctx.role !== 'student' || x.m.studentId === ctx.studentId));
  const dueTotal = dues.reduce((s, x) => s + x.bal.due, 0);
  const expiring = data.memberships.filter(m => m.status === 'active')
    .map(m => ({m, bal: membershipBalance(m, data.payments, today)}))
    .filter(x => x.bal.daysLeft !== null && x.bal.daysLeft >= 0 && x.bal.daysLeft <= 7);
  const myAttendance = data.attendance.filter(a => a.studentId === ctx.studentId);
  const myRate = attendanceSummary(myAttendance).rate;

  const checks = [
    {done: data.branches.length > 0, title: 'Add your first branch', text: 'Branches keep students, batches and fees organized by location.', page: 'branches'},
    {done: data.instructors.length > 0, title: 'Add an instructor', text: 'Instructors are assigned to batches and mark attendance.', page: 'batches'},
    {done: data.students.length > 0, title: 'Add students', text: 'Create student records with branch and contact details.', page: 'students'},
    {done: data.batches.length > 0, title: 'Create a batch & enroll', text: 'Set days and time, then enroll students into the batch.', page: 'batches'},
    {done: data.plans.length > 0 && data.memberships.length > 0, title: 'Add a plan & membership', text: 'Monthly plans drive fees, dues and receipts.', page: 'fees'},
  ];
  const showSetup = canManage(ctx) && checks.some(c => !c.done);

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
        {canManage(ctx) && <div className="erp-kpi"><small>Pending dues</small><strong>{formatINR(dueTotal)}</strong><p>{dues.length} membership(s) with a balance</p></div>}
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

    {canManage(ctx) && expiring.length > 0 && <section className="erp-panel"><div className="erp-panel-head"><div><h2>Expiring in 7 days</h2><p>Renew these memberships before they lapse.</p></div><button className="secondary-button" onClick={() => go('fees')}><Wallet size={15}/> Open fees</button></div>
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Student</th><th>Plan</th><th>Ends</th><th>Days left</th><th>Due</th></tr></thead>
        <tbody>{expiring.map(({m, bal}) => <tr key={m.id}><td>{studentName(data, m.studentId)}</td><td>{planName(data, m.planId)}</td><td>{formatDate(m.endDate)}</td><td><span className="erp-badge amber">{bal.daysLeft} day(s)</span></td><td>{formatINR(bal.due)}</td></tr>)}</tbody></table></div></section>}
  </>;
}

/* ---------------- branches ---------------- */

export function BranchesPage(props) {
  const {erp, ctx} = props; const {data} = erp;
  const [editing, setEditing] = useState(null);
  const save = async e => { e.preventDefault(); if (await erp.act(c => c.saveBranch(editing), 'Branch saved.')) setEditing(null); };
  return <>
    <ErpBlockingState {...props}/>
    <div className="page-heading"><div className="eyebrow">STUDIO ERP</div><h1>Branches <span className="flower">✳</span></h1><p>Every location of your studio, in one place.</p></div>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>
    <section className="erp-panel"><div className="erp-panel-head"><div><h2>All branches</h2><p>{data.branches.length} branch(es)</p></div>
      {canManage(ctx) && <button className="primary-button" onClick={() => setEditing({name: '', city: '', address: '', phone: ''})}><Plus size={16}/> Add branch</button>}</div>
      {data.branches.length === 0 ? <Empty icon={Building2} title="No branch yet" text="Add your first studio location to start adding students and batches."/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Branch</th><th>Students</th><th>Batches</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {data.branches.map(b => <tr key={b.id}><td><strong>{b.name}</strong><br/><small style={{color: '#9b92a4'}}>{[b.city, b.phone].filter(Boolean).join(' · ') || b.address || '—'}</small></td>
          <td>{data.students.filter(s => s.branchId === b.id && s.status === 'active').length}</td>
          <td>{data.batches.filter(x => x.branchId === b.id && x.status === 'active').length}</td>
          <td><span className={`erp-badge ${b.status === 'archived' ? 'grey' : 'green'}`}>{b.status === 'archived' ? 'Archived' : 'Active'}</span></td>
          <td>{canManage(ctx) && <><button className="erp-link-btn" onClick={() => setEditing({...b})}><Pencil size={13}/> Edit</button>
          <button className="erp-link-btn" onClick={() => erp.act(c => c.archiveBranch(b.id), b.status === 'archived' ? 'Branch restored.' : 'Branch archived.')}>{b.status === 'archived' ? 'Restore' : 'Archive'}</button></>}</td></tr>)}
      </tbody></table></div>}
    </section>
    {editing && <Dialog title={editing.id ? 'Edit branch' : 'Add branch'} sub="Students, batches and fees are organized under a branch." onClose={() => setEditing(null)}>
      <form className="erp-form" onSubmit={save}>
        <label className="erp-field">Branch name<input required value={editing.name} onChange={e => setEditing({...editing, name: e.target.value})} placeholder="e.g. Panvel"/></label>
        <label className="erp-field">City<input value={editing.city || ''} onChange={e => setEditing({...editing, city: e.target.value})}/></label>
        <label className="erp-field full">Address<input value={editing.address || ''} onChange={e => setEditing({...editing, address: e.target.value})}/></label>
        <label className="erp-field">Phone<input type="tel" value={editing.phone || ''} onChange={e => setEditing({...editing, phone: e.target.value})}/></label>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button">Save branch</button></div>
      </form></Dialog>}
  </>;
}

/* ---------------- students ---------------- */

export function StudentsPage(props) {
  const {erp, ctx, go} = props; const {data} = erp;
  const [query, setQuery] = useState(''); const [editing, setEditing] = useState(null);
  const list = data.students.filter(s => inBranch(ctx, s.branchId)
    && (`${s.fullName} ${s.phone} ${s.email}`.toLowerCase().includes(query.toLowerCase())));
  const save = async e => { e.preventDefault(); if (await erp.act(c => c.saveStudent(editing), 'Student saved.')) setEditing(null); };
  const empty = {fullName: '', phone: '', email: '', gender: '', dob: '', joiningDate: toISODate(), branchId: ctx.branchId !== 'all' ? ctx.branchId : (data.branches[0]?.id || ''), notes: ''};
  return <>
    <ErpBlockingState {...props}/>
    <div className="page-heading"><div className="eyebrow">STUDIO ERP</div><h1>Students <span className="flower">✳</span></h1><p>Everyone who practices at your studio.</p></div>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>
    <section className="erp-panel"><div className="erp-panel-head">
      <span className="erp-search"><Search size={16}/><input aria-label="Search students" placeholder="Search name, phone or email…" value={query} onChange={e => setQuery(e.target.value)}/></span>
      <div className="erp-actions">
        <button className="secondary-button" onClick={() => exportCSV('students.csv', list, [{label: 'Name', value: s => s.fullName}, {label: 'Phone', value: s => s.phone}, {label: 'Email', value: s => s.email}, {label: 'Branch', value: s => branchName(data, s.branchId)}, {label: 'Joined', value: s => s.joiningDate}, {label: 'Status', value: s => s.status}])}><Download size={15}/> CSV</button>
        {canManage(ctx) && <button className="primary-button" onClick={() => setEditing(empty)}><Plus size={16}/> Add student</button>}
      </div></div>
      {data.branches.length === 0 ? <Empty icon={Building2} title="Add a branch first" text="Students belong to a branch. Create your studio location, then add students." action={<button className="primary-button" onClick={() => go('branches')}>Go to Branches</button>}/> :
      list.length === 0 ? <Empty icon={Users} title="No students found" text="Add your first student, or try a different search."/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Student</th><th>Branch</th><th>Batches</th><th>Attendance</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {list.map(s => { const rate = attendanceSummary(data.attendance.filter(a => a.studentId === s.id)).rate; return <tr key={s.id}>
          <td><span className="erp-person"><span className="avatar">{initials(s.fullName)}</span><span><strong>{s.fullName}</strong><small>{s.phone || s.email || '—'}</small></span></span></td>
          <td>{branchName(data, s.branchId)}</td>
          <td>{data.enrollments.filter(e => e.studentId === s.id && e.status === 'active').map(e => data.batches.find(b => b.id === e.batchId)?.name).filter(Boolean).join(', ') || '—'}</td>
          <td>{rate === null ? '—' : `${rate}%`}</td>
          <td><span className={`erp-badge ${s.status === 'active' ? 'green' : 'grey'}`}>{s.status}</span></td>
          <td>{canManage(ctx) && <><button className="erp-link-btn" onClick={() => setEditing({...s})}><Pencil size={13}/> Edit</button>
          <button className="erp-link-btn" onClick={() => erp.act(c => c.archiveStudent(s.id), s.status === 'active' ? 'Student deactivated.' : 'Student reactivated.')}>{s.status === 'active' ? 'Deactivate' : 'Activate'}</button></>}</td></tr>; })}
      </tbody></table></div>}
    </section>
    {editing && <Dialog title={editing.id ? 'Edit student' : 'Add student'} onClose={() => setEditing(null)}>
      <form className="erp-form" onSubmit={save}>
        <label className="erp-field">Full name<input required value={editing.fullName} onChange={e => setEditing({...editing, fullName: e.target.value})} placeholder="Student name"/></label>
        <label className="erp-field">Branch<select aria-label="Student branch" required value={editing.branchId} onChange={e => setEditing({...editing, branchId: e.target.value})}><option value="">Choose branch…</option>{data.branches.filter(b => b.status !== 'archived').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="erp-field">Phone<input type="tel" value={editing.phone || ''} onChange={e => setEditing({...editing, phone: e.target.value})} placeholder="10-digit mobile"/></label>
        <label className="erp-field">Email<input type="email" value={editing.email || ''} onChange={e => setEditing({...editing, email: e.target.value})}/></label>
        <label className="erp-field">Gender<select value={editing.gender || ''} onChange={e => setEditing({...editing, gender: e.target.value})}><option value="">Prefer not to say</option><option>Female</option><option>Male</option><option>Other</option></select></label>
        <label className="erp-field">Date of birth<input type="date" value={editing.dob || ''} onChange={e => setEditing({...editing, dob: e.target.value})}/></label>
        <label className="erp-field">Joining date<input type="date" required value={editing.joiningDate} onChange={e => setEditing({...editing, joiningDate: e.target.value})}/></label>
        <label className="erp-field full">Notes<textarea rows={2} value={editing.notes || ''} onChange={e => setEditing({...editing, notes: e.target.value})} placeholder="Optional studio note (avoid medical details)"/></label>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button">Save student</button></div>
      </form></Dialog>}
  </>;
}

/* ---------------- batches & instructors ---------------- */

export function BatchesPage(props) {
  const {erp, ctx, go} = props; const {data} = erp;
  const [editing, setEditing] = useState(null); const [roster, setRoster] = useState(null);
  const [newInstructor, setNewInstructor] = useState(null); const [addStudentId, setAddStudentId] = useState('');
  const batches = data.batches.filter(b => inBranch(ctx, b.branchId)
    && (ctx.role !== 'instructor' || b.instructorId === ctx.instructorId)
    && (ctx.role !== 'student' || data.enrollments.some(e => e.batchId === b.id && e.studentId === ctx.studentId && e.status === 'active')));
  const toggleDay = day => setEditing(prev => ({...prev, days: prev.days.includes(day) ? prev.days.filter(d => d !== day) : [...prev.days, day]}));
  const saveBatch = async e => { e.preventDefault(); if (!editing.days.length) return; if (await erp.act(c => c.saveBatch(editing), 'Batch saved.')) setEditing(null); };
  const saveInstructor = async e => { e.preventDefault(); if (await erp.act(c => c.saveInstructor(newInstructor), 'Instructor saved.')) setNewInstructor(null); };
  const rosterList = roster ? data.enrollments.filter(e => e.batchId === roster.id && e.status === 'active') : [];
  const addable = roster ? data.students.filter(s => s.status === 'active' && s.branchId === roster.branchId && !rosterList.some(e => e.studentId === s.id)) : [];
  return <>
    <ErpBlockingState {...props}/>
    <div className="page-heading"><div className="eyebrow">STUDIO ERP</div><h1>Batches <span className="flower">✳</span></h1><p>Recurring class groups, instructors and rosters.</p></div>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>
    {canManage(ctx) && <section className="erp-panel"><div className="erp-panel-head"><div><h2>Instructors</h2><p>{data.instructors.length} instructor(s)</p></div>
      <button className="secondary-button" onClick={() => setNewInstructor({fullName: '', phone: '', email: '', branchId: data.branches[0]?.id || ''})}><Plus size={15}/> Add instructor</button></div>
      {data.instructors.length === 0 ? <p style={{fontSize: 13, color: '#9b92a4'}}>No instructors yet. Add one before creating a batch.</p> :
      <div className="erp-actions">{data.instructors.map(i => <span key={i.id} className="erp-badge lavender" style={{padding: '8px 12px', fontSize: 12}}>{i.fullName}{i.branchId ? ` · ${branchName(data, i.branchId)}` : ''}</span>)}</div>}
    </section>}
    <section className="erp-panel"><div className="erp-panel-head"><div><h2>{ctx.role === 'instructor' ? 'My batches' : ctx.role === 'student' ? 'My batches' : 'All batches'}</h2><p>{batches.length} batch(es)</p></div>
      {canManage(ctx) && <button className="primary-button" onClick={() => setEditing({name: '', branchId: ctx.branchId !== 'all' ? ctx.branchId : (data.branches[0]?.id || ''), instructorId: '', days: [1, 2, 3, 4, 5], startTime: '07:00', durationMins: 60, capacity: 20})}><Plus size={16}/> Add batch</button>}</div>
      {data.branches.length === 0 && canManage(ctx) ? <Empty icon={Building2} title="Add a branch first" text="Batches run at a branch." action={<button className="primary-button" onClick={() => go('branches')}>Go to Branches</button>}/> :
      batches.length === 0 ? <Empty icon={Clock} title="No batches here" text={ctx.role === 'instructor' && !ctx.instructorId ? 'Choose “Acting instructor” above to see assigned batches.' : 'Create a batch with days and a start time, then enroll students.'}/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Batch</th><th>Instructor</th><th>Schedule</th><th>Students</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {batches.map(b => { const count = data.enrollments.filter(e => e.batchId === b.id && e.status === 'active').length; return <tr key={b.id}>
          <td><strong>{b.name}</strong><br/><small style={{color: '#9b92a4'}}>{branchName(data, b.branchId)}</small></td>
          <td>{instructorName(data, b.instructorId)}</td>
          <td>{b.days.map(d => DAY_LABELS[d]).join(' ')}<br/><small style={{color: '#9b92a4'}}>{batchTimeLabel(b)}</small></td>
          <td><span className={`erp-badge ${count >= b.capacity ? 'red' : 'green'}`}>{count}/{b.capacity}</span></td>
          <td><span className={`erp-badge ${b.status === 'archived' ? 'grey' : 'green'}`}>{b.status}</span></td>
          <td><button className="erp-link-btn" onClick={() => { setRoster(b); setAddStudentId(''); }}><Users size={13}/> Roster</button>
          {canManage(ctx) && <><button className="erp-link-btn" onClick={() => setEditing({...b})}><Pencil size={13}/> Edit</button>
          <button className="erp-link-btn" onClick={() => erp.act(c => c.archiveBatch(b.id), b.status === 'archived' ? 'Batch restored.' : 'Batch archived.')}>{b.status === 'archived' ? 'Restore' : 'Archive'}</button></>}</td></tr>; })}
      </tbody></table></div>}
    </section>
    {newInstructor && <Dialog title="Add instructor" onClose={() => setNewInstructor(null)}><form className="erp-form" onSubmit={saveInstructor}>
      <label className="erp-field">Instructor name<input required value={newInstructor.fullName} onChange={e => setNewInstructor({...newInstructor, fullName: e.target.value})}/></label>
      <label className="erp-field">Branch<select value={newInstructor.branchId} onChange={e => setNewInstructor({...newInstructor, branchId: e.target.value})}><option value="">All branches</option>{data.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label className="erp-field">Phone<input type="tel" value={newInstructor.phone} onChange={e => setNewInstructor({...newInstructor, phone: e.target.value})}/></label>
      <label className="erp-field">Email<input type="email" value={newInstructor.email} onChange={e => setNewInstructor({...newInstructor, email: e.target.value})}/></label>
      <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setNewInstructor(null)}>Cancel</button><button className="primary-button">Save instructor</button></div></form></Dialog>}
    {editing && <Dialog title={editing.id ? 'Edit batch' : 'Add batch'} sub="Classes are 60 minutes by default — adjust only if your studio differs." onClose={() => setEditing(null)}>
      <form className="erp-form" onSubmit={saveBatch}>
        <label className="erp-field">Batch name<input required value={editing.name} onChange={e => setEditing({...editing, name: e.target.value})} placeholder="e.g. Morning Hatha"/></label>
        <label className="erp-field">Branch<select aria-label="Batch branch" required value={editing.branchId} onChange={e => setEditing({...editing, branchId: e.target.value})}><option value="">Choose branch…</option>{data.branches.filter(b => b.status !== 'archived').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="erp-field">Instructor<select aria-label="Batch instructor" value={editing.instructorId} onChange={e => setEditing({...editing, instructorId: e.target.value})}><option value="">Not assigned</option>{data.instructors.map(i => <option key={i.id} value={i.id}>{i.fullName}</option>)}</select></label>
        <label className="erp-field">Start time<input type="time" required value={editing.startTime} onChange={e => setEditing({...editing, startTime: e.target.value})}/></label>
        <label className="erp-field">Duration (minutes)<input type="number" min={15} step={5} value={editing.durationMins} onChange={e => setEditing({...editing, durationMins: e.target.value})}/></label>
        <label className="erp-field">Capacity<input type="number" min={1} value={editing.capacity} onChange={e => setEditing({...editing, capacity: e.target.value})}/></label>
        <div className="erp-field full"><span>Class days</span><div className="erp-days">{DAY_LABELS.map((label, day) => <button type="button" key={label} className={`erp-day ${editing.days.includes(day) ? 'on' : ''}`} aria-pressed={editing.days.includes(day)} onClick={() => toggleDay(day)}>{label}</button>)}</div></div>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button">Save batch</button></div>
      </form></Dialog>}
    {roster && <Dialog title={`${roster.name} — roster`} sub={`${branchName(data, roster.branchId)} · ${rosterList.length}/${roster.capacity} enrolled`} onClose={() => setRoster(null)}>
      {rosterList.length === 0 ? <p style={{fontSize: 13, color: '#9b92a4'}}>No students enrolled yet.</p> :
      rosterList.map(e => <div className="erp-att-row" key={e.id}><span className="erp-person"><span className="avatar">{initials(studentName(data, e.studentId))}</span><strong>{studentName(data, e.studentId)}</strong></span>
        {canManage(ctx) && <button className="erp-link-btn erp-danger" onClick={() => erp.act(c => c.endEnrollment(e.id), 'Removed from batch.')}>Remove</button>}</div>)}
      {canManage(ctx) && <form className="erp-form" style={{marginTop: 16}} onSubmit={async ev => { ev.preventDefault(); if (!addStudentId) return; if (rosterList.length >= roster.capacity) return props.notify('This batch is full.'); await erp.act(c => c.enrollStudent({batchId: roster.id, studentId: addStudentId}), 'Student enrolled.'); setAddStudentId(''); }}>
        <label className="erp-field">Add student to batch<select value={addStudentId} onChange={e => setAddStudentId(e.target.value)}><option value="">Choose student…</option>{addable.map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select></label>
        <div className="erp-form-actions"><button className="primary-button">Enroll student</button></div></form>}
    </Dialog>}
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
    <section className="erp-panel"><div className="erp-panel-head">
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
      roster.length === 0 ? <Empty icon={Users} title="Roster is empty" text="Enroll students into this batch from the Batches page."/> :
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

/* ---------------- fees ---------------- */

export function FeesPage(props) {
  const {erp, ctx} = props; const {data} = erp;
  const today = toISODate();
  const [tab, setTab] = useState('memberships');
  const [planForm, setPlanForm] = useState(null); const [membershipForm, setMembershipForm] = useState(null);
  const [paymentForm, setPaymentForm] = useState(null); const [receipt, setReceipt] = useState(null);
  const isStudent = ctx.role === 'student';
  const memberships = data.memberships.filter(m => inBranch(ctx, m.branchId) && (!isStudent || m.studentId === ctx.studentId));
  const payments = data.payments.filter(p => inBranch(ctx, p.branchId) && (!isStudent || p.studentId === ctx.studentId))
    .sort((a, b) => (b.paidOn || '').localeCompare(a.paidOn || ''));
  const openMembership = () => setMembershipForm({studentId: data.students[0]?.id || '', planId: data.plans[0]?.id || '', startDate: today, billingCycle: 'joining', amountRupees: data.plans[0] ? paiseToRupees(data.plans[0].amountPaise) : ''});
  const openPayment = m => { const bal = m ? membershipBalance(m, data.payments, today) : null; setPaymentForm({membershipId: m?.id || memberships[0]?.id || '', amountRupees: bal ? paiseToRupees(bal.due) : '', method: 'upi', paidOn: today, note: ''}); };
  return <>
    <ErpBlockingState {...props}/>
    <div className="page-heading"><div className="eyebrow">STUDIO ERP</div><h1>Fees & payments <span className="flower">✳</span></h1><p>Plans, memberships, dues and receipts in ₹.</p></div>
    <ErpToolbar data={data} ctx={ctx} setCtx={props.setCtx} mode={props.mode} remoteContext={erp.remoteContext} erp={erp}/>
    <div className="erp-seg" role="tablist" aria-label="Fees sections" style={{marginBottom: 16}}>
      {[['memberships', 'Memberships & dues'], ['payments', 'Payments'], ...(!isStudent ? [['plans', 'Plans']] : [])].map(([id, label]) =>
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </div>

    {tab === 'memberships' && <section className="erp-panel"><div className="erp-panel-head"><div><h2>Memberships & dues</h2><p>{memberships.length} membership(s)</p></div>
      {canManage(ctx) && <div className="erp-actions"><button className="secondary-button" onClick={() => openPayment(null)}><IndianRupee size={15}/> Record payment</button><button className="primary-button" onClick={openMembership}><Plus size={16}/> New membership</button></div>}</div>
      {memberships.length === 0 ? <Empty icon={Wallet} title="No memberships yet" text={data.plans.length === 0 ? 'Create a monthly plan first (Plans tab), then assign it to a student.' : 'Assign a plan to a student to start tracking fees and dues.'}/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Student</th><th>Plan & period</th><th>Amount</th><th>Paid</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {memberships.map(m => { const bal = membershipBalance(m, data.payments, today); return <tr key={m.id}>
          <td><strong>{studentName(data, m.studentId)}</strong><br/><small style={{color: '#9b92a4'}}>{branchName(data, m.branchId)}</small></td>
          <td>{planName(data, m.planId)}<br/><small style={{color: '#9b92a4'}}>{formatDate(m.startDate)} → {formatDate(m.endDate)}{m.billingCycle === 'calendar' ? ' · calendar month' : ''}</small></td>
          <td>{formatINR(bal.total)}</td><td>{formatINR(bal.paid)}</td><td><strong>{formatINR(bal.due)}</strong></td>
          <td>{m.status === 'cancelled' ? <span className="erp-badge grey">cancelled</span> : bal.expired ? <span className="erp-badge red">expired</span> : <span className={`erp-badge ${bal.paymentStatus === 'paid' ? 'green' : bal.paymentStatus === 'partial' ? 'amber' : 'red'}`}>{bal.paymentStatus}</span>}{!bal.expired && m.status === 'active' && bal.daysLeft !== null && bal.daysLeft <= 7 ? <><br/><small style={{color: '#9a6b31'}}>{bal.daysLeft} day(s) left</small></> : null}</td>
          <td>{canManage(ctx) && m.status === 'active' && <><button className="erp-link-btn" onClick={() => openPayment(m)}><IndianRupee size={13}/> Collect</button>
          <button className="erp-link-btn erp-danger" onClick={() => erp.act(c => c.cancelMembership(m.id), 'Membership cancelled.')}>Cancel</button></>}</td></tr>; })}
      </tbody></table></div>}</section>}

    {tab === 'payments' && <section className="erp-panel"><div className="erp-panel-head"><div><h2>Payments</h2><p>{payments.length} payment(s) · {formatINR(payments.filter(p => p.status !== 'void').reduce((s, p) => s + (p.amountPaise || 0), 0))} collected shown</p></div>
      <div className="erp-actions"><button className="secondary-button" onClick={() => exportCSV('payments.csv', payments, [{label: 'Receipt', value: p => p.receiptNo || 'Pending sync'}, {label: 'Date', value: p => p.paidOn}, {label: 'Student', value: p => studentName(data, p.studentId)}, {label: 'Method', value: p => p.method}, {label: 'Amount (INR)', value: p => paiseToRupees(p.amountPaise)}, {label: 'Status', value: p => p.status || 'recorded'}])}><Download size={15}/> CSV</button>
      {canManage(ctx) && <button className="primary-button" onClick={() => openPayment(null)}><Plus size={16}/> Record payment</button>}</div></div>
      {payments.length === 0 ? <Empty icon={IndianRupee} title="No payments recorded" text="Record cash, UPI, card or bank payments and a receipt number is generated automatically."/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Receipt</th><th>Date</th><th>Student</th><th>Method</th><th>Amount</th><th>Actions</th></tr></thead><tbody>
        {payments.map(p => <tr key={p.id}><td><strong>{p.receiptNo || 'Pending sync'}</strong>{p.syncPending && <><br/><span className="erp-badge amber">On this device</span></>}{p.status === 'void' && <><br/><span className="erp-badge red">VOID</span></>}</td><td>{formatDate(p.paidOn)}</td><td>{studentName(data, p.studentId)}</td><td style={{textTransform: 'capitalize'}}>{PAYMENT_METHODS.find(m => m.id === p.method)?.label || p.method}</td><td><strong style={p.status === 'void' ? {textDecoration: 'line-through'} : undefined}>{formatINR(p.amountPaise)}</strong></td>
        <td>{p.receiptNo && <button className="erp-link-btn" onClick={() => setReceipt(p)}><Printer size={13}/> Receipt</button>}
        {canManage(ctx) && p.status !== 'void' && (p.syncPending && !p.receiptNo
          ? <button className="erp-link-btn erp-danger" disabled={erp.syncState?.syncing} onClick={async () => { if (window.confirm('Discard this payment before it syncs? It has not received a Supabase receipt yet.')) await erp.act(c => c.voidPayment({id: p.id}), 'Pending payment discarded.'); }}>Discard pending</button>
          : <button className="erp-link-btn erp-danger" onClick={async () => { const reason = window.prompt('Reason for voiding this payment (required for audit):', ''); if (reason === null) return; if (!reason.trim()) return props.notify('Enter a reason to void this payment.'); await erp.act(c => c.voidPayment({id: p.id, reason: reason.trim()}), 'Payment voided. The original receipt remains in history.'); }}>Void</button>)}</td></tr>)}
      </tbody></table></div>}</section>}

    {tab === 'plans' && !isStudent && <section className="erp-panel"><div className="erp-panel-head"><div><h2>Plans</h2><p>{data.plans.length} plan(s)</p></div>
      {canManage(ctx) && <button className="primary-button" onClick={() => setPlanForm({name: '', amountRupees: '', durationMonths: 1})}><Plus size={16}/> Add plan</button>}</div>
      {data.plans.length === 0 ? <Empty icon={Wallet} title="No plans yet" text="Example: “Monthly — All Batches” at ₹1,500 for 1 month. You decide the names and prices."/> :
      <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Plan</th><th>Price</th><th>Duration</th><th>Members</th><th>Actions</th></tr></thead><tbody>
        {data.plans.map(p => <tr key={p.id}><td><strong>{p.name}</strong></td><td>{formatINR(p.amountPaise)}</td><td>{p.durationMonths} month(s)</td><td>{data.memberships.filter(m => m.planId === p.id && m.status === 'active').length}</td>
        <td>{canManage(ctx) && <button className="erp-link-btn" onClick={() => setPlanForm({...p, amountRupees: paiseToRupees(p.amountPaise)})}><Pencil size={13}/> Edit</button>}</td></tr>)}
      </tbody></table></div>}</section>}

    {planForm && <Dialog title={planForm.id ? 'Edit plan' : 'Add plan'} sub="Price changes apply to new memberships; existing memberships keep their agreed amount." onClose={() => setPlanForm(null)}>
      <form className="erp-form" onSubmit={async e => { e.preventDefault(); if (await erp.act(c => c.savePlan({id: planForm.id, name: planForm.name, amountPaise: rupeesToPaise(planForm.amountRupees), durationMonths: planForm.durationMonths}), 'Plan saved.')) setPlanForm(null); }}>
        <label className="erp-field">Plan name<input required value={planForm.name} onChange={e => setPlanForm({...planForm, name: e.target.value})} placeholder="e.g. Monthly — All Batches"/></label>
        <label className="erp-field">Price (₹)<input type="number" min={0} step="0.01" required value={planForm.amountRupees} onChange={e => setPlanForm({...planForm, amountRupees: e.target.value})}/></label>
        <label className="erp-field">Duration (months)<input type="number" min={1} max={24} required value={planForm.durationMonths} onChange={e => setPlanForm({...planForm, durationMonths: e.target.value})}/></label>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setPlanForm(null)}>Cancel</button><button className="primary-button">Save plan</button></div></form></Dialog>}

    {membershipForm && <Dialog title="New membership" sub="Choose calendar-month billing (1st to month-end) or joining-date billing (same date monthly)." onClose={() => setMembershipForm(null)}>
      <form className="erp-form" onSubmit={async e => { e.preventDefault(); const student = data.students.find(s => s.id === membershipForm.studentId); const plan = data.plans.find(p => p.id === membershipForm.planId);
        if (await erp.act(c => c.saveMembership({studentId: membershipForm.studentId, planId: membershipForm.planId, branchId: student?.branchId || '', startDate: membershipForm.startDate, billingCycle: membershipForm.billingCycle, durationMonths: plan?.durationMonths, amountPaise: rupeesToPaise(membershipForm.amountRupees)}), 'Membership created.')) setMembershipForm(null); }}>
        <label className="erp-field">Student<select required value={membershipForm.studentId} onChange={e => setMembershipForm({...membershipForm, studentId: e.target.value})}>{data.students.filter(s => s.status === 'active').map(s => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select></label>
        <label className="erp-field">Plan<select required value={membershipForm.planId} onChange={e => { const plan = data.plans.find(p => p.id === e.target.value); setMembershipForm({...membershipForm, planId: e.target.value, amountRupees: plan ? paiseToRupees(plan.amountPaise) : ''}); }}>{data.plans.map(p => <option key={p.id} value={p.id}>{p.name} · {formatINR(p.amountPaise)}</option>)}</select></label>
        <label className="erp-field">Start date<input type="date" required value={membershipForm.startDate} onChange={e => setMembershipForm({...membershipForm, startDate: e.target.value})}/></label>
        <label className="erp-field">Billing cycle<select value={membershipForm.billingCycle} onChange={e => setMembershipForm({...membershipForm, billingCycle: e.target.value})}><option value="joining">Joining date (monthly)</option><option value="calendar">Calendar month</option></select></label>
        <label className="erp-field">Amount (₹)<input type="number" min={0} step="0.01" required value={membershipForm.amountRupees} onChange={e => setMembershipForm({...membershipForm, amountRupees: e.target.value})}/></label>
        <span className="erp-field">Ends on<span style={{fontSize: 14, color: '#3d3547'}}>{formatDate(membershipEnd(membershipForm.startDate, data.plans.find(p => p.id === membershipForm.planId)?.durationMonths || 1, membershipForm.billingCycle))}</span></span>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setMembershipForm(null)}>Cancel</button><button className="primary-button">Create membership</button></div></form></Dialog>}

    {paymentForm && <Dialog title="Record payment" sub="A final receipt number is assigned by Supabase. If you are offline, the payment is saved on this device first and the receipt appears after sync." onClose={() => setPaymentForm(null)}>
      <form className="erp-form" onSubmit={async e => { e.preventDefault(); const m = data.memberships.find(x => x.id === paymentForm.membershipId); if (!m) return;
        if (await erp.act(c => c.recordPayment({membershipId: m.id, studentId: m.studentId, branchId: m.branchId, amountPaise: rupeesToPaise(paymentForm.amountRupees), method: paymentForm.method, paidOn: paymentForm.paidOn, note: paymentForm.note}), 'Payment recorded. Receipt is in the Payments tab.')) { setPaymentForm(null); setTab('payments'); } }}>
        <label className="erp-field full">Membership<select required value={paymentForm.membershipId} onChange={e => { const m = data.memberships.find(x => x.id === e.target.value); setPaymentForm({...paymentForm, membershipId: e.target.value, amountRupees: m ? paiseToRupees(membershipBalance(m, data.payments, today).due) : ''}); }}>
          {data.memberships.filter(m => m.status === 'active').map(m => <option key={m.id} value={m.id}>{studentName(data, m.studentId)} · {planName(data, m.planId)} · due {formatINR(membershipBalance(m, data.payments, today).due)}</option>)}</select></label>
        <label className="erp-field">Amount received (₹)<input type="number" min="0.01" step="0.01" required value={paymentForm.amountRupees} onChange={e => setPaymentForm({...paymentForm, amountRupees: e.target.value})}/></label>
        <label className="erp-field">Method<select value={paymentForm.method} onChange={e => setPaymentForm({...paymentForm, method: e.target.value})}>{PAYMENT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <label className="erp-field">Paid on<input type="date" required value={paymentForm.paidOn} onChange={e => setPaymentForm({...paymentForm, paidOn: e.target.value})}/></label>
        <label className="erp-field">Note<input value={paymentForm.note} onChange={e => setPaymentForm({...paymentForm, note: e.target.value})} placeholder="Optional"/></label>
        <div className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setPaymentForm(null)}>Cancel</button><button className="primary-button">Save payment</button></div></form></Dialog>}

    {receipt && <Dialog title="Payment receipt" onClose={() => setReceipt(null)}>
      <div className="erp-receipt"><dl>
        <dt>Receipt</dt><dd>{receipt.receiptNo}</dd>
        <dt>Student</dt><dd>{studentName(data, receipt.studentId)}</dd>
        <dt>Branch</dt><dd>{branchName(data, receipt.branchId)}</dd>
        <dt>Date</dt><dd>{formatDate(receipt.paidOn)}</dd>
        <dt>Method</dt><dd>{PAYMENT_METHODS.find(m => m.id === receipt.method)?.label || receipt.method}</dd>
        <dt>Amount</dt><dd>{formatINR(receipt.amountPaise)}</dd>
        {receipt.status === 'void' ? <><dt>Status</dt><dd>VOID</dd>{receipt.voidReason ? <><dt>Void reason</dt><dd>{receipt.voidReason}</dd></> : null}</> : null}
        {receipt.note ? <><dt>Note</dt><dd>{receipt.note}</dd></> : null}
      </dl></div>
      <div className="erp-form-actions"><button className="secondary-button" onClick={() => setReceipt(null)}>Close</button><button className="primary-button" onClick={() => window.print()}><Printer size={15}/> Print receipt</button></div>
    </Dialog>}
  </>;
}

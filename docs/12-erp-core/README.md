# Yoga Studio ERP — Core (v1.3.0)

Implemented on 2026-10-29 at the owner's request. Scope chosen by the owner:
**Students + Batches + Attendance + Fees/Payments**, with **multi-branch**
support, **Owner / Admin / Instructor / Student portals**, monthly fees in
**INR**, mobile + desktop UI and offline support. Version 1.3.0 upgrades the
signed-in Supabase mode to **offline-first sync with manual conflict review**.

## What works today

| Area | Included |
|---|---|
| Dashboard | KPIs (active students, today's classes, collected this month, pending dues), today's class list, memberships expiring in 7 days, first-run setup checklist; role-specific cards for Instructor/Student |
| Branches | Add/edit/archive branches; per-branch student & batch counts; branch filter everywhere |
| Students | Add/edit/deactivate, search, branch, contact, joining date, batches, attendance %, CSV export |
| Batches | Instructors, recurring days + start time (60 min default), capacity, roster enroll/remove with capacity guard |
| Attendance | Date + batch picker (today's batch auto-selected), Present/Absent/Late per student, mark-all-present, history + CSV; students see only their own |
| Fees | Plans (₹, months), memberships with **calendar-month or joining-date** billing and price snapshot, dues (paid/partial/unpaid/expired), manual payments (cash/UPI/card/bank), server receipt numbers `YS-YYYY-NNNN`, printable receipt, CSV export; synced payments are append-only and corrected by audited void, never edit/delete |
| Offline sync | Signed-in Supabase mode downloads a per-user device copy, applies ERP changes locally while offline, queues them in a durable outbox, and pushes in dependency order when internet returns; toolbar/Settings show synced, waiting, syncing, setup-needed and conflict states |
| Conflicts | Server row versions detect concurrent edits. Sync never uses last-write-wins: a review dialog compares **This device** with **Supabase now**; Keep Supabase discards the local proposal, while Keep mine reapplies only the fields changed on that device |
| Portals | Owner/Admin manage everything in scope; Instructor sees own batches + attendance; Student sees own batches, attendance, dues and payments |
| Appearance | Light/Dark/System theme from `feature_development`, adapted to every ERP screen, dialog, table and form; persisted as `ys-theme`, with pre-paint bootstrap and OS-preference sync |

Deferred ( unchanged from the management plan): online payment gateway,
automated reminders/messaging, payroll, QR/self check-in, expenses and
advanced reports.

## Data modes

The frontend talks to one module, `src/lib/erp/data.js`, with two adapters:

1. **Supabase mode (shared, multi-user, offline-first).** All business
   reads/writes go through typed `erp_*` RPC functions in
   [`supabase/erp_setup.sql`](../../supabase/erp_setup.sql) — the function-only
   policy from `CLAUDE.md` still holds; there is no direct table CRUD.
   Tables are RLS-locked with no browser grants; functions re-check
   `auth.uid()`, organization and role per call and write audit rows.

   After one successful online sign-in and organization download, the browser
   keeps a device copy keyed by signed-in user + organization
   (`src/lib/erp/syncStore.js`). It contains three separate parts:

   - **Base snapshot** — the last role-scoped snapshot acknowledged by
     Supabase (`erp_get_snapshot`), including each row's `syncVersion`.
   - **Outbox** — durable local operations not yet acknowledged. The UI
     renders base snapshot + outbox, so offline work is visible immediately.
   - **Conflicts** — operations the server refused to overwrite, held for a
     person to review; the UI reverts those records to the server copy until
     resolution.

   A new sign-in still requires internet, and an expired/revoked Supabase
   session is not bypassed. Settings can reset the device copy; sign-out
   removes it when the queue is empty and asks before leaving pending work
   behind for the same account.

2. **Local device mode (separate, never syncs).** The same UI implemented
   over `src/lib/erp/localStore.js`. Enter from the sign-in screen via
   *"Use this device only — offline mode"*, or switch later in Settings.
   Data starts **empty**, remains only in that browser, and Settings offers
   JSON **Export/Import/Clear**. This mode is intentionally separate from
   the signed-in sync outbox.

Local-mode role switching is presentation-only. In Supabase mode the server
scopes every snapshot and sync operation by the signed-in user's role
assignments. A cached snapshot is only what that user was allowed to see at
the last successful pull; the sync RPC re-checks current permission on push.

### Sync and conflict protocol

- Creates made offline receive client UUIDs. Repeated edits to one record
  are coalesced into one outbox operation; attendance is coalesced by
  `(batch, student, date)` and enrollment by `(batch, student)`.
- Sync runs after a change, on the browser `online` event, when the app
  regains focus (throttled), and from **Sync now**. Operations are released
  in dependency waves and order — branch before student, student/batch
  before enrollment, enrollment before attendance, plan/membership before
  payment. Dependents of a conflicted create wait instead of failing as
  orphans.
- `erp_sync_push(jsonb)` is a whitelisted typed door, not generic table
  CRUD. For each operation it locks the row, checks tenant/role, and applies
  it in a subtransaction. The `erp_sync_operations` primary key
  `(org_id, op_id)` makes retries idempotent: if the response is lost after
  the server commits, the retry returns `duplicate` rather than creating a
  second record or receipt. The ledger intentionally stores operation
  identity/status/result metadata only, not a second server-side copy of
  the student/payment payload.
- Every syncable row has `sync_version`, incremented by a database trigger
  on **any** update. Creates carry `baseVersion: 0`; edits/archive/status
  changes carry the version copied to the device. A mismatch returns
  `VERSION_CONFLICT` and changes nothing. Client clocks never decide a
  winner.
- If another online user made the exact same change, reconciliation drops
  the device operation without asking. Natural-key attendance/enrollment
  with the same intended status is also treated as already applied.
  Otherwise the review dialog shows differing fields. **Keep mine** builds
  a new operation from the current server row plus only the fields this
  device changed, preserving concurrent edits to other fields.
- Validation, capacity and current-role failures become **blocked** review
  items with the server reason. They can be discarded and re-entered after
  correcting the underlying record.
- There are no hard-delete sync operations. Branch/batch archive, student
  deactivate, enrollment end, and membership cancel are explicit status
  updates protected by the same version check.
- Payments are append-only. An offline payment has no final receipt number
  and is labelled **Pending sync**; Supabase allocates the real receipt.
  Before acknowledgement it can be discarded. After acknowledgement it can
  only be voided with a reason; the original row/receipt remains visible,
  is marked `VOID`, and no longer counts toward paid totals or dues.

### Why not PGlite (yet)

PGlite would mirror Postgres locally, but adds a large WASM payload and a
second storage engine to migrate. The hard part of offline support is the
protocol above — identity, versions, idempotency, dependency order and
conflict review — which is now implemented independently of the storage
engine over browser storage. `syncStore.js` can move from `localStorage`
to IndexedDB/PGlite later without changing the UI or Supabase RPC contract.
Separate local-device mode still does **not** auto-sync; use its Export as
a backup.

## Supabase setup (owner runs this)

1. Supabase project → **SQL Editor** → paste **all** of
   `supabase/erp_setup.sql` → **Run**. Re-running after updates is safe.
   For v1.3.0 this upgrades the database to **SQL v2** (sync versions,
   `erp_sync_operations`, `erp_sync_push`, payment void fields) without
   deleting business rows. Deploy/run SQL v2 before relying on offline
   sync; if the new app reaches an old database, changes stay safely queued
   and the toolbar says **Sync setup needed**.
2. Ensure the app is built with `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (publishable/anon key only).
3. Sign in while online → **Settings → Data mode: Supabase**. On the
   dashboard, create your organization once (this account becomes Owner),
   wait for **Supabase · Synced**, and only then test offline work.
4. Grant Admin/Instructor/Student access with the commented examples at the
   bottom of the SQL file (the person signs up in the app first).

**All future table/function changes go into that one SQL file** (owner's
rule), keeping it idempotent and non-destructive.

## Verification

- `node --test tests/security-config.test.mjs tests/erp-logic.test.mjs
  tests/erp-sync.test.mjs tests/theme.test.mjs` — 24 unit checks including
  billing/money plus sync coalescing, dependency waves, natural-key
  attendance, equality reconciliation, field-level conflict rebasing,
  per-user persistence, pending receipts and voided-payment balances.
- `npm test` — plus seven Playwright tests: the existing auth suite,
  `tests/erp-local.spec.js` for separate local mode, and
  `tests/erp-sync.spec.js`, which mocks Supabase at the network boundary and
  drives signed-in offline edit → online concurrent change → conflict
  review → field-preserving resolution → offline branch/student creates in
  dependency order.
- During development the full SQL file was also parsed with the PostgreSQL
  parser and executed twice (idempotent rerun) in an ephemeral PGlite
  Postgres with a stub `auth.uid()`: bootstrap, create/duplicate/conflict,
  trigger-incremented versions, instructor/batch/enrollment/attendance
  natural-key conflict,
  payment idempotency and void conflict/apply passed. That harness is not
  shipped and is not live Supabase UAT.
- Production UAT still required after running SQL v2 in the real project:
  sign in and wait for Synced; go offline and mark attendance + record a
  payment; reconnect and verify one receipt only; then use two accounts to
  edit the same student concurrently and resolve the conflict both ways.
  Mocked tests are not proof of live Auth, RLS, email delivery or role
  revocation behaviour.

## Known limits of this release

- Pull is currently the caller's full visible snapshot after sync. That is
  appropriate for a small studio and keeps role/branch visibility correct;
  add cursor/delta pull and pagination before very large studios
  (thousands of students or years of attendance).
- The device snapshot/outbox uses browser `localStorage` (typically only a
  few MB, origin- and browser-specific), not an encrypted database. Use it
  on trusted devices, sign out on shared devices, and do not
  clear site data while changes are waiting. Moving the store to
  IndexedDB is the scaling follow-up; encryption at rest would need a
  separate key-management design.
- Offline access depends on the Supabase session still being accepted by
  the SDK on that device. New sign-in, signup, password reset/update and
  profile changes require internet; only ERP core data is queued.
- Sync is push/pull on change, reconnect and focus — not realtime. Another
  user's online change appears after Sync now, focus, navigation load or a
  local change triggers the next pull.
- Fees use a single amount per membership period; taxes, proration,
  discounts and refunds follow the accounting approvals still open in
  `docs/11-management-plan/`. A void is an audited correction marker, not a
  cash-refund workflow.
- Receipt printing uses the browser print dialog; no stored PDF receipts.
- Dates/times use the device's local timezone (studio default Asia/Kolkata).

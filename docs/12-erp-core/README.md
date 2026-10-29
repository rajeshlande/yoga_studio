# Yoga Studio ERP — Core (v1.5.0)

Implemented on 2026-10-29 at the owner's request. Scope chosen by the owner:
**Students + Batches + Attendance + Fees/Payments**, with **multi-branch**
support, **Owner / Admin / Instructor / Student portals**, monthly fees in
**INR**, mobile + desktop UI and offline support. Version 1.3.0 upgraded the
signed-in Supabase mode to **offline-first sync with manual conflict review**.
Version 1.4.0 adds a synchronized payment/billing profile, GST/UPI invoice
PDFs, an always-visible Online/Offline state and stronger no-forget autosync.
Patch 1.4.1 fixes complete A4 Print/Save-as-PDF output and standardizes
form/control alignment across the app; it has no database change.
Patch 1.4.2 is dependency/runtime/build-tool maintenance only (Node 26 LTS,
Vite 8, current Supabase JS and lucide-react) with no database or
product-behavior change. Version 1.5.0 completes the signed-in **Student
portal access** workflow: a student creates/confirms a dedicated account,
then an Owner/Admin links that registered email to the student record from
**Students → Portal access**. SQL v4 adds the server-enforced grant/revoke
RPCs; the student portal itself remains view-only.

## What works today

| Area | Included |
|---|---|
| Dashboard | KPIs (active students, today's classes, collected this month, pending dues), today's class list, memberships expiring in 7 days, first-run setup checklist; role-specific cards for Instructor/Student |
| Branches | Add/edit/archive branches; per-branch student & batch counts; branch filter everywhere |
| Students | Add/edit/deactivate, search, branch, contact, joining date, batches, attendance %, CSV export; in Supabase mode, Owner/branch-Admin portal-access status plus grant/replace/remove by the student's confirmed sign-in email |
| Batches | Instructors, recurring days + start time (60 min default), capacity, roster enroll/remove with capacity guard |
| Attendance | Date + batch picker (today's batch auto-selected), Present/Absent/Late per student, mark-all-present, history + CSV; students see only their own |
| Fees | Plans (₹, months), memberships with **calendar-month or joining-date** billing and price snapshot, dues (paid/partial/unpaid/expired), verified manual payments (cash/UPI/card/bank), server receipt numbers `YS-YYYY-NNNN`, CSV export; synced payments are append-only and corrected by audited void, never edit/delete |
| Payment setup & invoices | Owner/Admin billing profile with optional GST, UPI/bank instructions and public gateway readiness; themed A4 browser-generated PDFs for unpaid/partial invoices and paid receipts, with dynamic UPI QR only while payment is outstanding |
| Offline sync | Signed-in Supabase mode downloads a per-user device copy, applies ERP changes locally while offline, queues them in a durable mirrored outbox, requests persistent storage, and pushes in dependency order when internet returns; the global top bar plus ERP toolbar/Settings show Online/Offline, synced, waiting, syncing, setup-needed and conflict states |
| Conflicts | Server row versions detect concurrent edits. Sync never uses last-write-wins: a review dialog compares **This device** with **Supabase now**; Keep Supabase discards the local proposal, while Keep mine reapplies only the fields changed on that device |
| Portals | Owner/Admin manage everything in scope; Instructor sees own batches + attendance; Student has a view-only portal for own dashboard, batches, attendance, membership, dues, payments and invoice/receipt PDFs |
| Appearance | Light/Dark/System theme from `feature_development`, adapted to every ERP screen, dialog, table and form; persisted as `ys-theme`, with pre-paint bootstrap and OS-preference sync |

Deferred: **live** online-gateway checkout and webhook-verified automatic
confirmation (the current release stores public gateway configuration/readiness only),
automated reminders/messaging, payroll, QR/self check-in, expenses and
advanced reports. A gateway secret must never be placed in the browser app.

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
   - **Outbox** — durable local operations not yet acknowledged. The whole
     sync state is mirrored to a second same-origin key; if the primary JSON
     value is truncated/corrupt, loading falls back to the mirror. The UI
     renders base snapshot + outbox, so offline work is visible immediately.
     Queued writes also request `navigator.storage.persist()` where the
     browser supports it.
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

### Student portal access

Student sign-in provisioning is intentionally a two-person, server-checked
flow:

1. The student creates a normal Yoga Studio account with the email they will
   use to sign in and opens Supabase's email-confirmation link. The student
   must **not** create their own organization.
2. In Supabase mode, an organization Owner/manager—or an Admin assigned to
   that student's branch—opens **Students → Portal access**, enters the
   exact confirmed sign-in email and grants access. The student can then use
   **Retry** or **Sync now** if the app was already open on the
   no-organization screen.
3. **Students → Portal access** can replace the sign-in email or remove
   access. Replacement suspends the previous link; removal suspends the
   active link without deleting the Auth account, student record or payment
   history.

The browser never queries `auth.users` or writes membership tables. It calls
only the typed `erp_grant_student_access(uuid, text)` and
`erp_revoke_student_access(uuid)` RPCs while online. The student record must
already be synced and free of a student-record conflict before either call.
On the server, the RPC rechecks the caller's organization and branch
authorization, locks/serializes the access change, resolves the email to a
confirmed usable Auth account, and writes an audit row. It rejects an
inactive student or archived branch, an account already actively linked to
a different student, an organization owner/manager account, and an account
with active access in another organization (the current context model is
one organization per account).

The student's **contact email** on the student record and the **sign-in
email** are separate. Editing contact details does not move the login; use
Portal access to replace it. Moving the student record to another branch
moves the active portal link to that branch. Deactivating the student makes
the existing link ineffective until the student is reactivated.

`erp_get_snapshot` returns `portalAccessStatus` and `portalAccessEmail`
only to an organization manager or an Admin of that student's branch; other
roles receive `hidden`/empty values. Those fields are display metadata:
`syncStore.js` excludes them from student business-record comparisons and
outbox payloads, so a grant/revoke never creates a false version conflict.

For a dedicated Student account, `erp_get_context` returns role `student`
and the linked `studentId`; the snapshot contains only that student's own
record/classes/attendance/membership/payments plus the plans and billing
profile needed to label dues and generate PDFs. The UI fixes the signed-in
student selector in Supabase mode and exposes no ERP edit/payment actions.
Local-device mode's Student role remains only a presentation preview and
has no **Portal access** control.

Access removal is effective on the server immediately. When the student's
already-open app next performs an online Retry/Sync, it stops presenting the
downloaded studio snapshot. As with any offline-first app, revocation while
the device is offline cannot remotely erase a copy already downloaded to
that browser, but the account receives no further server refresh and cannot
push ERP changes; the Student role has no ERP write operations in the first
place.

### Sync and conflict protocol

- Creates made offline receive client UUIDs. Repeated edits to one record
  are coalesced into one outbox operation; attendance is coalesced by
  `(batch, student, date)` and enrollment by `(batch, student)`.
- Sync runs after a change, on the browser `online` event, when the app
  regains focus/visibility (throttled), every 30 seconds while visible if
  work is pending, after transient failures with bounded exponential backoff
  (5 seconds doubling to a 60-second cap), best-effort on `pagehide`, and
  from **Sync now**. A new queued edit brings an older backoff timer forward.
  While work is pending/conflicted/syncing, `beforeunload` asks the browser
  to confirm close/refresh; closing does not erase the outbox. Operations
  are released in dependency waves — branch before student, student/batch
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
- Billing settings are a singleton collection, `billingSettings`, with one
  profile per organization. A first offline save uses the organization ID as
  the record ID, preventing competing first profiles. It follows the same
  `syncVersion` conflict rules. If an older database returns
  `UNSUPPORTED_OPERATION`, the client leaves the operation queued and shows
  setup-needed rather than creating a false conflict.

### Payment setup, GST and invoice documents

- **Fees → Payment setup** is manager-only. It stores the seller/invoice
  profile, optional GST fields, UPI ID/payee, bank receiving details, and a
  Razorpay/Cashfree **public** key/client ID plus trusted-webhook readiness.
  Validation covers GSTIN format/state prefix, GST rate, SAC/HSN, PIN,
  complete-or-empty bank fields, account number, IFSC, UPI ID, Razorpay
  test/live key prefix and HTTPS webhook URL consistency.
- The readiness panel separates invoice profile, UPI QR, bank transfer,
  gateway public configuration and automatic confirmation. Recording a
  payment warns if the chosen route is not configured. Even a marked-ready
  gateway is not a live integration in the current release: no checkout is launched and no
  browser callback marks dues paid. Record only externally verified funds.
  Gateway and webhook secrets have no field and must stay on a future trusted
  Edge Function/server.
- A due/partial **Invoice PDF** is generated from the gross cash-payable
  membership balance. It
  shows `UNPAID` or `PARTIALLY PAID`, a dated reference, due date, Bill To,
  place of supply, item/tax table, bank instructions and a QR generated
  locally with the bundled `qrcode` package from
  `upi://pay?pa=...&pn=...&am=...&cu=INR&tn=...` when UPI is configured.
- A paid **Invoice PDF** is generated from the recorded payment. It uses the
  server receipt number, shows `PAID`, method/date/note reference, and hides
  bank/QR payment instructions. Void receipts stay visible as `VOID`.
- GST is off by default. When enabled, GST-inclusive amounts are
  back-calculated to taxable value; GST-exclusive plan amounts have tax
  added to produce the gross payable total. Recorded payments are gross cash
  received, so paid documents derive their breakup from that received amount
  rather than adding GST again. Intra-state tax is split CGST/SGST and
  inter-state tax is IGST. The invoice
  can include a buyer GSTIN for that generated PDF. This is invoice
  calculation/display only—not GST filing, e-invoicing/IRN generation or a
  substitute for CA/accounting review.
- PDF output is the browser's print-to-PDF pipeline. The print stylesheet
  isolates the A4 invoice, preserves the current Light/Dark theme colours and
  uses the invoice/receipt reference as the document title. PDFs are generated
  on demand and are not stored in Supabase.

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
   For v1.5.0 this upgrades the database to **SQL v4**: all SQL v3 sync and
   billing objects, plus student-access RPCs, manager-only portal snapshot
   fields, branch-member lookup indexes and the branch-move trigger. It is
   additive and does not delete business rows. Deploy/run SQL v4 before
   relying on shared billing settings or in-app student provisioning; if
   the new app reaches an older database, supported sync changes and the
   queued billing profile stay safely on the device, the toolbar can say
   **Sync setup needed**, and Portal access reports that SQL v4 is required.
2. Ensure the app is built with `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (publishable/anon key only).
3. Sign in while online → **Settings → Data mode: Supabase**. On the
   dashboard, create your organization once (this account becomes Owner),
   wait for **Supabase · Synced**, and only then test offline work.
4. For students, the student signs up and confirms their email first, then
   an Owner/Admin uses **Students → Portal access** in the app. Co-owner,
   branch Admin and Instructor account links still use the commented
   examples at the bottom of the SQL file.

**All future table/function changes go into that one SQL file** (owner's
rule), keeping it idempotent and non-destructive.

## Verification

- The Node suite in `npm test` includes 32 checks: security configuration,
  billing dates/money, attendance, sync coalescing/dependency waves,
  natural-key attendance, equality reconciliation, field-level conflict
  rebasing, per-user persistence, pending receipts/void balances, GST
  inclusive/exclusive and CGST/SGST/IGST calculations, UPI URI construction,
  payment-setup validation, corrupt-primary sync-state recovery, and proof
  that student portal metadata never enters an offline student upsert.
- `npm test` also runs eleven Playwright tests: the existing auth suite,
  `tests/erp-local.spec.js` for separate local mode (including GST Payment
  setup, dynamic UPI QR, unpaid vs paid invoice behaviour and generation of a
  real `%PDF` through Chromium), and `tests/erp-sync.spec.js`, which mocks
  Supabase at the network boundary and drives offline edit → concurrent
  change → conflict review → resolution → dependency-ordered creates,
  offline Payment setup → mirrored queue/close guard → automatic sync,
  Owner student-access grant/remove by email, a waiting student's Retry
  after grant, and the signed-in student's view-only portal plus online
  revocation display clearing.
- During development the full SQL file was also parsed with the PostgreSQL
  parser and executed twice (idempotent rerun) in an ephemeral PGlite
  Postgres with a stub `auth.uid()`: bootstrap, create/duplicate/conflict,
  trigger-incremented versions, instructor/batch/enrollment/attendance
  natural-key conflict, payment idempotency, void conflict/apply and
  billing-settings create/duplicate/conflict/update passed. The SQL v4
  harness additionally covered confirmed/unconfirmed/missing student
  accounts, manager-account and duplicate-link rejection, branch-Admin
  scope, student-only context/snapshot scoping, revoke/regrant, branch-move
  link transfer, inactive-student blocking and a rerun preserving access.
  That harness is not shipped and is not live Supabase UAT.
- Production UAT still required after running SQL v4 in the real project:
  sign in and wait for **Online · synced**; save Payment setup; go offline
  and mark attendance + record a payment; verify the close warning, reconnect
  and verify automatic sync and one receipt only; generate unpaid and paid
  invoice PDFs and scan the unpaid UPI QR; use two accounts to edit the
  same student concurrently and resolve the conflict both ways; then create
  and confirm a separate student account, grant it from **Students → Portal
  access**, verify only that student's data is visible, remove access, and
  verify the student app stops loading the studio on online Retry/Sync.
  Mocked tests are not proof of live Auth, RLS, email delivery or role
  revocation behaviour.

## Known limits of this release

- Pull is currently the caller's full visible snapshot after sync. That is
  appropriate for a small studio and keeps role/branch visibility correct;
  add cursor/delta pull and pagination before very large studios
  (thousands of students or years of attendance).
- The device snapshot/outbox uses browser `localStorage` (typically only a
  few MB, origin- and browser-specific), not an encrypted database. The
  mirrored copy and persistent-storage request reduce corruption/eviction
  risk but are not an off-device backup. Use trusted devices, sign out on
  shared devices, and do not clear site data while changes are waiting.
  Moving the store to IndexedDB is the scaling follow-up; encryption at rest
  would need a separate key-management design.
- Offline access depends on the Supabase session still being accepted by
  the SDK on that device. New sign-in, signup, password reset/update and
  profile changes require internet; only ERP core data is queued.
- Sync is push/pull on change, reconnect, focus/visibility and pending-only
  retries—not realtime. Another user's online change appears after Sync now,
  focus, navigation load or a local change triggers the next pull.
- A signed-in account currently resolves to one organization. A student who
  also needs access to a different Yoga Studio organization, or who already
  owns/manages an organization in the same Supabase project, needs a
  separate dedicated student account. In-app provisioning in this release
  is students-only; Co-owner/Admin/Instructor account links remain reviewed
  SQL examples.
- Fees use a single amount per membership period; proration, discounts and
  refunds follow the accounting approvals still open in
  `docs/11-management-plan/`. GST is invoice calculation/display only. A void
  is an audited correction marker, not a cash-refund workflow.
- Invoice/receipt PDFs are browser-generated on demand; no PDF file or
  immutable invoice document is stored server-side. The due-invoice reference
  is generated for payment reconciliation, while paid documents use the
  server receipt number; confirm statutory invoice-numbering requirements
  with your CA before treating the PDF as a tax invoice system of record.
- Razorpay/Cashfree fields are configuration/readiness only in this release.
  Live checkout, provider order creation, webhook signature verification,
  refunds and automatic reconciliation require a separate trusted backend.
- Dates/times use the device's local timezone (studio default Asia/Kolkata).

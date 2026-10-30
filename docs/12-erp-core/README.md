# Yoga Studio ERP — Core (v1.6.0)

Implemented on 2026-10-29 at the owner's request. Scope chosen by the owner:
**Students + Batches + Attendance + Fees/Payments**, with **multi-branch**
support, **Owner / Co-owner / Admin / Instructor / Student portals**, monthly
fees in **INR**, mobile + desktop UI and offline support. Version 1.3.0
upgraded the signed-in Supabase mode to **offline-first sync with manual
conflict review**. Version 1.4.0 adds a synchronized payment/billing
profile, GST/UPI invoice PDFs, an always-visible Online/Offline state and
stronger no-forget autosync. Patch 1.4.1 fixes complete A4
Print/Save-as-PDF output and standardizes form/control alignment across the
app; it has no database change. Patch 1.4.2 is dependency/runtime/build-tool
maintenance only (Node 26 LTS, Vite 8, current Supabase JS and lucide-react)
with no database or product-behavior change. Version 1.5.0 completed the
signed-in **Student portal access** workflow. Version 1.6.0 generalizes that
server-checked account-linking model to **fixed Role Access for all five
roles**: each person creates/confirms a dedicated account first, then an
authorized manager links the exact sign-in email in **Access** (or
**Students → Portal access** for a Student). SQL v5 enforces the role,
selected-branch and own-record rules on snapshot, direct RPC and offline-sync
paths; there is no custom permission-group/module editor.

## What works today

| Area | Included |
|---|---|
| Dashboard | KPIs (active students, today's classes, collected this month, pending dues), today's class list, memberships expiring in 7 days, first-run setup checklist; role-specific cards for Instructor/Student |
| Branches | Add/edit/archive branches; per-branch student & batch counts; branch filter everywhere |
| Students | Add/edit/deactivate, search, branch, contact, joining date, batches, attendance %, CSV export; in Supabase mode, Owner/Co-owner/branch-Admin portal-access status plus grant/replace/remove by the student's confirmed sign-in email |
| Batches | Instructors, recurring days + start time (60 min default), capacity, roster enroll/remove with capacity guard |
| Attendance | Date + batch picker (today's batch auto-selected), Present/Absent/Late per student, mark-all-present, history + CSV; students see only their own |
| Fees | Plans (₹, months), memberships with **calendar-month or joining-date** billing and price snapshot, dues (paid/partial/unpaid/expired), verified manual payments (cash/UPI/card/bank), server receipt numbers `YS-YYYY-NNNN`, CSV export; synced payments are append-only and corrected by audited void, never edit/delete |
| Payment setup & invoices | Owner/Co-owner billing profile with optional GST, UPI/bank instructions and public gateway readiness; themed A4 browser-generated PDFs for unpaid/partial invoices and paid receipts, with dynamic UPI QR only while payment is outstanding |
| Offline sync | Signed-in Supabase mode downloads a per-user device copy, applies ERP changes locally while offline, queues them in a durable mirrored outbox, requests persistent storage, and pushes in dependency order when internet returns; the global top bar plus ERP toolbar/Settings show Online/Offline, synced, waiting, syncing, setup-needed and conflict states |
| Conflicts | Server row versions detect concurrent edits. Sync never uses last-write-wins: a review dialog compares **This device** with **Supabase now**; Keep Supabase discards the local proposal, while Keep mine reapplies only the fields changed on that device |
| Access & portals | Five fixed server-enforced roles: protected primary Owner; all-branch Co-owner; selected-branch Admin; Instructor limited to linked batches/rosters/attendance; Student limited to a view-only own-record portal. **Access** manages Co-owner/Admin/Instructor sign-ins by confirmed email; **Students → Portal access** manages Student sign-ins |
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

### Role access and Student portal access

Version 1.6.0 uses five fixed authorization roles, adapting Odoo's
security-group and record-rule ideas to this ERP:

| Role | Scope | May manage access for | Important restrictions |
|---|---|---|---|
| **Owner** | All branches | Co-owner, Admin, Instructor, Student | Primary Owner is protected; ownership transfer/removal is not offered in the app |
| **Co-owner** | All branches | Admin, Instructor, Student | Cannot add/remove Owner or Co-owner |
| **Admin** | Explicitly selected branches | Instructor and Student in those branches | Cannot manage Admins/Co-owners, plans, Payment setup or unassigned branches |
| **Instructor** | Own linked instructor record and batches in authorized branches | Nobody | No fees, payments, student editing or access administration |
| **Student** | Own student record | Nobody | View-only portal; no ERP writes |

The matrix is deliberately fixed. This release does not provide custom
security groups, per-user permission matrices or module-level
None/View/Manage permission editors. The SQL snapshot, direct RPCs and
`erp_sync_push` all re-check organization, role and branch/record scope;
hiding a screen in React is not treated as authorization.

For Co-owner, Admin and Instructor accounts, the person first creates and
confirms a normal Yoga Studio account and must not create their own
organization. An authorized manager then opens **Access** online, enters
that exact sign-in email and, for Admin/Instructor roles, selects explicit
active branches. Only the primary Owner can grant/remove a Co-owner.
Owner/Co-owner can grant, replace the complete selected-branch set for, or
remove an Admin. Owner/Co-owner can replace an Instructor's global sign-in;
a branch Admin can manage that instructor's sign-in only within the Admin's
branches and cannot replace a different account globally. New grants reject
unconfirmed/deleted/banned accounts, accounts in another organization, and
accounts that already hold a conflicting active role. Role changes are
audited, online-only, serialized per organization and never enter the sync
outbox. An Instructor branch selection plus a batch's `instructor_id` must
both match for snapshot visibility and attendance writes; an inactive
linked Instructor or Student record makes the corresponding sign-in
ineffective.

Student sign-in provisioning remains a two-person, server-checked flow:

1. The student creates a normal Yoga Studio account with the email they will
   use to sign in and opens Supabase's email-confirmation link. The student
   must **not** create their own organization.
2. In Supabase mode, the Owner, a Co-owner or an Admin assigned to that
   student's branch opens **Students → Portal access**, enters the
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

- **Fees → Payment setup** is Owner/Co-owner-only. It stores the seller/invoice
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
   For v1.6.0 this upgrades the database to **SQL v5**: all prior sync,
   billing and Student-access objects, plus distinct Co-owner handling,
   organization/selected-branch authorization helpers, exact branch-scoped
   snapshot/direct/sync checks, seven audited staff-access RPCs, lookup
   indexes and internal-helper privilege revokes. It is additive and does
   not delete business rows. Deploy/run SQL v5 before relying on Role Access
   or narrowed Admin plan/billing permissions; if the new app reaches an
   older database, supported sync changes stay safely on the device, the
   toolbar can say **Sync setup needed**, and Access/Portal access report
   that SQL v5 is required.
2. Ensure the app is built with `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (publishable/anon key only).
3. Sign in while online → **Settings → Data mode: Supabase**. On the
   dashboard, create your organization once (this account becomes Owner),
   wait for **Supabase · Synced**, and only then test offline work.
4. For every other person, have them sign up and confirm their email first
   without creating an organization. Then use **Access** online for
   Co-owner, Admin or Instructor sign-ins and **Students → Portal access**
   for a Student. Manual membership SQL at the bottom of the setup file is
   now an emergency-repair fallback only and bypasses in-app conflict
   checks, so it must not be the normal provisioning path.

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
- `npm test` also runs fourteen Playwright tests: the existing auth suite,
  `tests/erp-local.spec.js` for separate local mode (including GST Payment
  setup, dynamic UPI QR, unpaid vs paid invoice behaviour and generation of a
  real `%PDF` through Chromium), and `tests/erp-sync.spec.js`, which mocks
  Supabase at the network boundary and drives offline edit → concurrent
  change → conflict review → resolution → dependency-ordered creates,
  offline Payment setup → mirrored queue/close guard → automatic sync,
  Owner Student/Co-owner/Admin/Instructor access flows by email,
  branch-Admin hiding of organization-role and Owner/Co-owner setup actions,
  signed-in Instructor identity locking, a waiting student's Retry after
  grant, and the signed-in student's view-only portal plus online revocation
  display clearing.
- During development the full SQL file was also executed twice (idempotent
  rerun) in an ephemeral PGlite Postgres with stub Auth users/`auth.uid()`.
  In addition to the prior sync, billing, payment and Student-access checks,
  the SQL v5 harness runs RPCs as the `authenticated` role and covers
  Owner/Co-owner protection, unconfirmed and cross-organization account
  rejection, role-conflict rejection, exact Admin branch replacement,
  branch-scoped snapshots/direct writes/sync rejection, Instructor
  own-batch attendance and current-batch sync protection, inactive-linked
  Instructor denial, Student own-record scoping, all role revocations, and
  denial of direct calls to internal access helpers. That harness is not
  shipped and is not live Supabase UAT.
- Production UAT still required after running SQL v5 in the real project:
  sign in as Owner and wait for **Online · synced**; save Payment setup as
  Owner/Co-owner; go offline and mark attendance + record a payment; verify
  the close warning, reconnect and verify automatic sync and one receipt
  only; generate unpaid and paid invoice PDFs and scan the unpaid UPI QR;
  use two accounts to edit the same student concurrently and resolve the
  conflict both ways; then use separate confirmed Co-owner, Admin,
  Instructor and Student accounts to grant/revoke access and verify each
  role's branch/own-record visibility, including that revoked accounts stop
  loading fresh studio data on online Retry/Sync. Mocked tests are not
  proof of live Auth, RLS, email delivery or role revocation behaviour.

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
- A signed-in account currently resolves to one organization and new Role
  Access grants enforce one active ERP role per account. A person who needs
  access to a different Yoga Studio organization, or a genuinely separate
  role identity, needs a separate dedicated account. Roles are fixed in
  this release; custom Odoo-style security groups and module-level
  permission editing remain out of scope. Ownership transfer is also not
  available in the app. Revocation prevents future server refreshes/writes,
  but cannot erase a snapshot already downloaded to that person's browser
  while they remain offline.
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

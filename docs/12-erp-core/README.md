# Yoga Studio ERP — Core (v1.11.4)

Implemented on 2026-10-29 at the owner's request. Scope chosen by the owner:
**Students + Batches + Attendance + Subscriptions/Payments**, with **multi-branch**
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
**Students → Portal access** for a Student). SQL v10 enforces the role,
selected-branch and own-record rules on snapshot, direct RPC and offline-sync
paths; there is no custom permission-group/module editor. It also adds an
account-first public Student admission link: a signed-in applicant submits
the form, a manager chooses branch/joining date during review, and
confirmation creates the Student and grants that same account portal access.
Plans plus membership periods now provide a native Odoo-style subscription
lifecycle with pause/resume, cancellation reasons, renewal dates/history
and manager-confirmed one-click renewals at the current Plan price. Version
1.7.0 separates top-level **Subscriptions** from **Payments**, turns Plans
into operational templates with type/period/alignment/renewal defaults, and
adds a distinct **One-month only** Plan/pass that does not pause or renew.
Manager batch and instructor-profile work moves under **Branches & batches**.
Version 1.8.0 turns Instructor records into rich teaching profiles, lets a
signed-in Instructor add/remove existing active same-branch students in an
active batch assigned to them, makes the signed-in account **Profile**
role-aware, and fixes invoice/receipt print output to one A4 portrait page.
Patch 1.8.1 / SQL v10 is a least-privilege role-authorization hardening:
Instructor student rows are identity-only, Student instructor rows are
display-name-only, Students receive only Plans used by their own
subscriptions/passes, and internal context/authorization/audit helpers are
no longer browser-callable. Version 1.9.0 turns **Branches & batches** into
an operational workspace using existing fields only: branch health cards,
batch List/Schedule views, search and status/day/availability filters,
sorting, seat-fill and next-class indicators, duplicate-batch setup, roster
search, and warnings for full, empty, unassigned or instructor-overlapping
batches. Instructor and Student versions of the batch workspace remain
limited to their assigned batches; Students do not receive roster/capacity
details. Version 1.10.0 expands admissions into studio-wide and
branch-specific public links, adds the guided Student → Batch → Plan →
Payment enrolment wizard, gives Instructors a scoped Students workspace with
basic walk-in creation and final own-batch payment collection under SQL v11,
and centralizes actionable error notices. Version 1.11.0 / SQL v12 turns
the public admission link into a one-form student registration + admission
flow with password creation and Terms & Conditions acceptance, and lets
Instructor-and-above reviewers approve/reject scoped requests before batch
assignment and plan selection. Patch 1.11.1 is a responsive UX/performance
pass (touch targets, readable type, drawer behavior, font loading and lazy QR
generation) with no database change. Patch 1.11.2 standardizes filter-bar and
panel-header label/control alignment, also with no database change. Patch
1.11.3 adds guarded one-time recovery when an open tab mixes stale app modules
and hits a hook-dispatcher crash, also with no database change. Patch 1.11.4
is dependency/deployment-toolchain maintenance only, also with no database
change.
This release deliberately has no unattended recurring-invoice scheduler or
saved-method autopay.

## What works today

| Area | Included |
|---|---|
| Dashboard | KPIs (active students, today's classes, collected this month, pending dues), today's class list, subscriptions expiring in 7 days, first-run setup checklist; role-specific cards for Instructor/Student |
| Branches & batches | Manager workspace with **Branches**, **Batches** and **Instructor profiles** tabs; branch summary KPIs and searchable/sortable branch health cards (students, active batches, enrolled seats/fill, instructors teaching, weekly/today classes, recent attendance and next class), drill-down to that branch's Batches or Students, add/edit/archive branches, and searchable Instructor cards with bio, specialties/styles, qualifications/certifications, experience, joining date, status, assigned batches/students and next class |
| Students | Add/edit/deactivate, search, branch, split name/contact/admission profile, joining date, batches, attendance %, CSV export; in Supabase mode, Owner/Co-owner/branch-Admin portal-access status plus grant/replace/remove by the student's confirmed sign-in email, and studio/branch public registration links with pending/confirmed/rejected Instructor-and-above scoped review and guided enrolment |
| Batches | Manager tab under Branches & batches; standalone assigned-batch view remains for Instructor/Student. Role-tailored summary cards, searchable/filterable/sortable batch cards and a recurring weekly Schedule view; next class, recent attendance and (except for Students) enrolled/capacity/seats-left progress. Managers can duplicate batch settings, and the batch form warns about capacity below current enrollment or an instructor time overlap without silently blocking an intentional exception. Roster dialog includes fill/search plus enroll/remove with capacity guard. A signed-in Instructor may edit only the roster of an active batch assigned to them and only with existing active students from that branch; a Student sees only assigned batches/schedule and no roster or capacity counts |
| Attendance | Date + batch picker (today's batch auto-selected), Present/Absent/Late per student, mark-all-present, history + CSV; students see only their own |
| Subscriptions | Odoo-style Plan templates (type, ₹ price, billing period in months, default alignment, renewal default, Active/Archived); subscription periods with **calendar-month or joining-date** billing, amount/offering snapshots, lifecycle, pause/resume, cancellation reasons, renewal tracking/history, one-click current-price renewal, active/paused/renewals-due/MRR summary and dues. **One-month passes** are shown separately and cannot pause/renew or enter MRR |
| Payments | Payment history, Record verified payment for subscriptions or one-month passes, server receipt numbers `YS-YYYY-NNNN`, CSV export, Owner/Co-owner Payment setup with optional GST/UPI/bank/public-gateway readiness, and exactly-one-page A4 portrait PDFs for unpaid/partial invoices and paid receipts with dynamic UPI QR only while outstanding; synced payments are append-only and corrected by audited void |
| Offline sync | Signed-in Supabase mode downloads a per-user device copy, applies ERP changes locally while offline, queues them in a durable mirrored outbox, requests persistent storage, and pushes in dependency order when internet returns; the global top bar plus ERP toolbar/Settings show Online/Offline, synced, waiting, syncing, setup-needed and conflict states |
| Conflicts | Server row versions detect concurrent edits. Sync never uses last-write-wins: a review dialog compares **This device** with **Supabase now**; Keep Supabase discards the local proposal, while Keep mine reapplies only the fields changed on that device |
| Access & portals | Five fixed server-enforced roles: protected primary Owner; all-branch Co-owner; selected-branch Admin; Instructor limited to linked batches/rosters/attendance, own-student enrolment, scoped own-batch final payment collection and scoped/redacted public-admission review into teaching branches; Student limited to a view-only own-record portal. **Access** manages Co-owner/Admin/Instructor sign-ins by confirmed email; **Students → Portal access** manages Student sign-ins |
| Account profile | Role-aware signed-in **Profile** with editable name/phone/personal bio, read-only sign-in email, organization, ERP role/access scope, shortcuts and a linked Instructor teaching-profile or Student-record summary where applicable |
| Appearance | Light/Dark/System theme from `feature_development`, adapted to every ERP screen, dialog, table and form; persisted as `ys-theme`, with pre-paint bootstrap and OS-preference sync |

Deferred: **live** online-gateway checkout and webhook-verified automatic
confirmation (the current release stores public gateway configuration/readiness only),
unattended recurring subscription invoice generation, saved-method autopay
and payment retry/dunning, Student self-service subscription changes,
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

Version 1.8.1 continues five fixed authorization roles, adapting Odoo's
security-group and record-rule ideas to this ERP:

| Role | Scope | May manage access for | Important restrictions |
|---|---|---|---|
| **Owner** | All branches | Co-owner, Admin, Instructor, Student | Primary Owner is protected; ownership transfer/removal is not offered in the app |
| **Co-owner** | All branches | Admin, Instructor, Student | Cannot add/remove Owner or Co-owner |
| **Admin** | Explicitly selected branches | Instructor and Student in those branches | Cannot manage Admins/Co-owners, plans, Payment setup or unassigned branches |
| **Instructor** | Own linked instructor record and batches in authorized branches | Nobody | May add/remove existing active same-branch students in an active assigned batch, subject to capacity; student snapshot fields are identity-only, with no contact/address/admission/medical data; no fees/payments, Student-record creation/editing, batch schedule/capacity editing, Instructor profile setup or access administration |
| **Student** | Own student record and assigned batches | Nobody | Personal view-only dashboard; no other student, no instructor contact/profile data beyond the assigned teacher's display name, no unrelated Plan, no ERP writes, studio roster/class counts, sync badges/controls or **Studio ERP data** settings |

The matrix is deliberately fixed. This release does not provide custom
security groups, per-user permission matrices or module-level
None/View/Manage permission editors. The SQL snapshot, direct RPCs and
`erp_sync_push` all re-check organization, role and branch/record scope;
hiding a screen in React is not treated as authorization.

SQL v10 also applies default-deny at the RPC boundary. ERP tables have no
browser grants, every SQL function is either one of the application-facing
authenticated RPCs or explicitly revoked from `public`, `anon` and
`authenticated`, and internal context/authorization/audit helpers cannot be
called directly by a signed-in browser user. In Supabase mode the Portal
selector is locked to the server-returned role; the selectable role preview
exists only in the separate device-only local mode and cannot read the
Supabase snapshot.

Instructor profile setup and Instructor Portal authorization are separate
manager-only steps. **Branches & batches → Instructor profiles** creates and
edits the teaching record (name, home branch, phone, contact email, bio,
specialties/styles, qualifications/certifications, experience years, joining
date and status), while **Access → Instructor sign-ins** links a confirmed
account to that record for explicit branches. Only the Owner, a Co-owner or
an Admin acting within assigned branches can perform either step. The React
screens hide both controls from Instructor and Student accounts, and
`erp_save_instructor`, `erp_sync_push`, `erp_list_role_access`,
`erp_grant_instructor_access` and `erp_revoke_instructor_access` re-check
the same manager/branch boundary in SQL.

Roster editing is the one narrow Instructor write added in SQL v9 and
field-hardened in SQL v10. The snapshot gives an Instructor only identity
fields (name, branch, status and joining date) for both students already
enrolled in their batches and active same-branch candidates in a branch
where they teach; contact, address, notes, admission details and medical
text are blank. The direct
`erp_enroll_student`/`erp_end_enrollment` RPCs and the enrollment branch of
`erp_sync_push` call the same server helper: managers keep their branch
scope, while an Instructor must be the active batch's assigned instructor
with an active branch link. Activation requires an active student in the
batch branch and the writers still enforce capacity. Student-record and
batch writers remain manager-only.

The **Settings → Studio ERP data** panel—data-mode selection, Supabase
connection status, offline-copy reset and local-device backup import/export
or clearing—is shown only to **Owner** and **Admin** accounts. Co-owner,
Instructor and Student accounts do not see that panel. Automatic background
refresh remains available internally; the Student portal simply does not
display **Online · synced**, **Supabase · Synced** or **Sync now**.

For Co-owner, Admin and Instructor accounts, the person first creates and
confirms a normal Yoga Studio account with **Join an existing studio**
selected during sign-up. An authorized manager then opens **Access** online,
enters that exact sign-in email and, for Admin/Instructor roles, selects
explicit active branches. The sign-up choice is onboarding routing only; it
does not grant a role. Actual authorization still comes only from the
server-checked grant. If a joining account signs in before that grant, it
receives a dedicated **Waiting for studio access** screen with no ERP
navigation, studio records or organization-creation controls. Accounts
created before the sign-up choice existed choose **Join an existing studio**
on that waiting screen; only an account explicitly routed as the primary
studio Owner sees the organization-creation form. Only the primary Owner can grant/remove a Co-owner.
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

1. The student creates a normal Yoga Studio account with **Join an existing
   studio** selected, using the email they will use to sign in, and opens
   Supabase's email-confirmation link. Student sign-up uses this joining path
   by default and does not present organization creation.
2. In Supabase mode, the Owner, a Co-owner or an Admin assigned to that
   student's branch opens **Students → Portal access**, enters the
   exact confirmed sign-in email and grants access. The student can then use
   **Retry** if the app was already open on the **Waiting for studio access**
   screen, or reload/sign in again.
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
record/classes/attendance/subscriptions/payments plus the plans and billing
profile needed to label dues and generate PDFs. The UI fixes the signed-in
student selector in Supabase mode and exposes no ERP edit/payment actions.
Its dashboard is a personal Student dashboard—assigned batches, next class,
classes today, attendance rate/recent history, subscription lifecycle and
next-renewal progress, dues and
recent payments—rather than the studio operations dashboard. The Batches
screen lists only active assigned batches and does not offer a roster or
class-size/capacity view. Student screens hide the staff sync badge and
**Sync now** control in the top bar, ERP toolbar and Settings.
Local-device mode's Student role remains only a presentation preview and
has no **Portal access** control.

Access removal is effective on the server immediately. When the student's
already-open app next refreshes online—on focus/reconnect, reload or the
waiting screen's **Retry**—it stops presenting the downloaded studio
snapshot. As with any offline-first app, revocation while
the device is offline cannot remotely erase a copy already downloaded to
that browser, but the account receives no further server refresh and cannot
push ERP changes; the Student role has no ERP write operations in the first
place.

### Public Student admissions

**Students → Admission requests** shows managers copyable studio-wide and
branch-specific links containing the organization's `admission_code`;
Instructors can share the same public links from **Students**. That code
selects the target studio only; it is not authorization. Opening a link
while signed out shows one **Student registration & admission** form, not a
sign-in screen. The applicant completes First Name, Last Name, Date Of
Birth, Phone Number, Subject, Email, **Password** and **Confirm password**,
Address, Pin Code, optional Reference by, Experience in yoga, Medical /
Physical issue and Reasons to join yoga, and must accept the linked
**Terms & Conditions** (`?terms=admission`). The password is sent only to
Supabase Auth to create the future Student-portal account; it is never sent
to ERP SQL. Submission and review are online-only typed RPCs:
`erp_get_public_admission_target(text, uuid)`,
`erp_get_my_admission(text, uuid)`, `erp_submit_admission(text, jsonb, uuid)`,
`erp_get_admission_link_info()`, `erp_list_admissions(text)` and
`erp_review_admission(uuid, text, uuid, date, text)`. Only the public target
and the guarded submit are anon-callable; the locked `erp_admissions` table
has no browser table grants.

For the signed-in path, the server requires a confirmed, usable account with
no active ERP role. For the signed-out public-registration path, SQL accepts
only a fresh (≤24-hour), still-unconfirmed Supabase Auth user whose signup
metadata is `account_intent='member'` for that exact admission code; this
lets the request become pending before email confirmation, while approval
still requires a confirmed applicant email. In both paths the submitted
email must equal the Auth email, terms acceptance/version are required, and
all fields are bounded/validated (including a six-digit PIN code and the
fixed yoga-experience values). A pending applicant may update their request;
a rejected applicant may correct and resubmit the same request; a confirmed
request cannot be changed. A branch link pre-selects that branch, but final
branch/batch remain staff-controlled. During review the Owner or Co-owner
may choose any active branch; a branch Admin is limited to assigned-branch
requests/final branches; a linked Instructor may review studio-wide or
teaching-branch requests and confirm only into a teaching branch. The
reviewer selects joining date/final branch and may add a review note or
reject the request, then approval continues into batch assignment and plan
selection.

Confirmation runs in one transaction: it rechecks scope, pending status,
confirmed applicant account/email and unlinked state, blocks an exact-email
possible duplicate instead of silently creating a second Student, inserts
the Student, creates the audited Student portal link for the form-created
account inside that same authorized review transaction, and marks the
admission confirmed. The separate `erp_grant_student_access` RPC remains a
manager-only repair/assignment surface. Structured
admission values are copied to the Student profile (`firstName`, `lastName`,
address, PIN code, subject, reference, yoga experience, medical/physical
issue and reason to join) and are editable later by an authorized manager.
`fullName` remains the canonical display name composed from first/last.
Medical / Physical issue is returned only to Owner/Co-owner, an Admin of the
student's branch and that student; Instructor snapshots deliberately carry
an empty value, and SQL v12 Instructor admission list responses additionally
blank DOB/address/PIN/medical/reason with `sensitiveDetailsHidden: true`.
SQL v10 redacts contact/address/notes/admission fields for
both enrolled students and not-yet-enrolled roster candidates in the
Instructor snapshot. The
student can view their own confirmed admission details
on the personal dashboard but remains view-only.

### Native subscriptions and renewals

Yoga Studio does not embed or connect to a separate Odoo instance. It maps
Odoo's concepts onto the existing ERP records:

- a **Plan** is the reusable Odoo-style template (`plan_type`, current
  price, billing period in months, default `billing_cycle` alignment,
  `renewal_enabled_default` and Active/Archived status);
- an `erp_memberships` row is one subscription period or one-month pass,
  retaining the amount and `offering_type` agreed for that period, so a later
  Plan edit cannot convert history;
- Plans, subscription periods/dues and one-month passes live in the
  top-level **Subscriptions** menu;
- verified payments, Payment setup, due invoices and paid receipts live in
  the top-level **Payments** menu; and
- the Student portal is the read-only customer view of that student's own
  periods.

SQL stores only durable `active`, `paused` and `cancelled` status.
`scheduled` and `expired` are derived in shared client logic from the
inclusive start/end dates, so no cron is required merely to display them.
Each period also stores `offering_type`, `auto_renew` (renewal
tracking/reminders enabled),
`previous_membership_id`, `renewal_number`, current pause dates/reason,
cumulative `total_paused_days`, and cancellation timestamp/reason.

- **Pause/resume (manager-only):** Pause is available for a currently active
  period with no live renewal already following it. The manager records the
  pause start, optional expected resume date and reason. On Resume, the
  elapsed days from pause start to the selected resume date are added to
  `total_paused_days`, and the client and SQL both recompute the end date as
  plan duration plus cumulative paused days. Pause does **not** change batch
  enrolment or attendance rules automatically.
- **Cancel:** cancellation is terminal for that period and records a
  timestamp plus optional reason. Payments/receipts remain. A cancelled
  period cannot be reopened or collect another payment; create a new
  subscription instead.
- **One-click renewal:** **Renew** pre-fills the next start as the later of
  the day after the current end date and today. The amount is read-only in
  the dialog and is taken from the selected Plan's **current** price and
  duration at creation, as selected by the owner. The new row links to the
  previous period and increments `renewal_number`; its due balance and due
  invoice are immediately available. Creating a renewal does not alter the
  old period or charge the student.
- **Lineage guards:** only one live (non-cancelled) renewal may follow a
  period. Cancelling a future renewal leaves it in History and allows a
  corrected replacement. A paused source must resume before renewal so its
  final end date is known, and a period with a live renewal cannot pause;
  cancel the future renewal first. The partial unique index and direct/sync
  server checks enforce the live-child rule even across concurrent devices.
- **Payments:** a manager may collect against active, paused, scheduled or
  expired (stored `active`) subscriptions. SQL direct payment accepts
  `active`/`paused`; offline sync deliberately returns a clear rejected
  result for a cancelled subscription, while preserving idempotent handling
  of a payment that was already recorded.
- **One-month only:** a `one_month` Plan is normalized everywhere to one
  month and no renewal default. Its pass is listed under **Subscriptions →
  One-month passes**, has fixed-month dues/invoice/payment, and is enforced
  as `duration_months = 1`, `auto_renew = false`, no previous period,
  `renewal_number = 0`, zero paused days and never paused. It has no Renew,
  Pause, History or next-renewal display and is excluded from MRR.
- **Summary:** managers see current active subscriptions, paused count,
  renewals expired or ending within seven days, and monthly recurring
  revenue. MRR is a simple operational sum of each currently active period's
  amount divided by its duration; when prices are GST-exclusive it is shown
  before GST. It is not accounting revenue recognition.
- **Student view:** the Student dashboard says **My subscription & passes**;
  **My subscriptions & passes** and **My payments** show status, period,
  next renewal or “No renewal”, paid/due amounts, receipts and linked
  History for their own records only. Copy explicitly says renewal is
  confirmed by the studio and there is no automatic charge. No
  pause/resume/cancel/renew or payment-write action is exposed.

The same lifecycle normalization and guards run in Supabase offline sync
and the separate this-device store. `previousMembershipId` is an offline
dependency, so a renewal created in the same offline session waits until
its source subscription has been acknowledged. A duplicate live renewal
from another device becomes an `ALREADY_RENEWED` manual conflict; trying to
reopen a server-cancelled period or renew a server-paused period likewise
returns a named conflict rather than silently overwriting it. Attempting to
renew a one-month pass returns `ONE_MONTH_NO_RENEWAL`; selling a new pass
with a mismatched offering/Plan type is rejected in client logic, the
device store, direct RPCs and sync RPCs.

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
  orphans. Subscription renewals also wait for their source period through
  `previousMembershipId`.
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
  deactivate, enrollment end, and subscription pause/resume/cancel are
  explicit status updates protected by the same version check.
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

- **Payments → Payment setup** is Owner/Co-owner-only. It stores the seller/invoice
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
  subscription balance. It
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
  declares a 210 × 297 mm page with 10 mm margins and constrains the invoice
  to the 190 × 276.5 mm printable sheet, producing exactly one A4 portrait
  page with a light print palette; the screen preview still follows the app
  theme. It uses the invoice/receipt reference as the document title. PDFs
  are generated on demand and are not stored in Supabase.

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
   For v1.11.x the required database is **SQL v12**. Version 1.11.0 changes
   public admission registration/review authorization, so rerun the complete
   SQL file if SQL v11 or earlier is live. Upgrading from an earlier release installs SQL
   v12: all prior sync,
   billing and Student-access objects; SQL v5 Co-owner/selected-branch
   authorization and staff-access RPCs; the SQL v6 organization admission
   code, locked `erp_admissions` workflow and structured Student profile;
   SQL v7 subscription lifecycle/lineage rules; SQL v8 Plan-template and
   one-month offering fields; and SQL v9 Instructor `bio`, `specialties`,
   `qualifications`, `experience_years` and `joining_date`, profile
   constraints/index/snapshot fields, candidate-redacted Instructor student
   visibility, and matching direct/sync assigned-batch roster authorization;
   plus SQL v10 identity-only Instructor student snapshot fields,
   display-name-only Student instructor rows, own-subscription Student Plan
   scoping, and revocation of direct browser access to internal helpers;
   plus SQL v11 branch-aware admission RPCs/Admin scope, Instructor
   active-plan/billing snapshot visibility with own-batch finance only,
   server-enforced Instructor walk-in/enrolment/payment rules; plus SQL v12
   admission terms columns, the narrow public target/guarded-submit flow,
   scoped Instructor admission review with server-side redaction, and
   `setupVersion: 12` in the context response. It is additive and does not
   delete business rows. Existing Instructors preserve
   name/contact/home branch/status and gain an empty profile. Run SQL v12
   (rather than stopping at v11 or v10) before using the deployed 1.11.4 app.
   If the new app reaches an older
   database, supported older sync changes stay safely on the device, the
   toolbar can say **Sync setup needed**, and a queued one-month operation
   may need to be discarded and re-entered after the SQL upgrade.
2. Ensure the app is built with `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (publishable/anon key only).
3. The primary Owner signs up with **Create my own studio** selected, signs
   in while online, and chooses **Settings → Data mode: Supabase** if needed.
   Create the organization once, wait for **Supabase · Synced**, and only
   then test offline work.
4. For every other person, have them sign up with **Join an existing studio**
   selected and confirm their email first. Then use **Access** online for
   Co-owner, Admin or Instructor sign-ins and **Students → Portal access**
   for an existing Student. For a brand-new Student, a manager or Instructor
   may instead share **Students → Admission requests → Public admission link**;
   the signed-out applicant completes the registration + admission form,
   confirms their email, and an in-scope Instructor-or-above reviewer
   approves/rejects it in that panel before batch/plan assignment. Manual membership SQL at the bottom of the setup file is
   now an emergency-repair fallback only and bypasses in-app conflict
   checks, so it must not be the normal provisioning path.

**All future table/function changes go into that one SQL file** (owner's
rule), keeping it idempotent and non-destructive.

## Verification

- The Node suite in `npm test` includes 40 checks: security configuration and the SQL role-boundary contract,
  billing and subscription dates/lifecycle/MRR/money, Instructor profile
  normalization, batch next-class/capacity/overlap derivation, attendance, sync
  coalescing/dependency waves (including source-before-renewal),
  natural-key attendance, equality reconciliation, field-level conflict
  rebasing, per-user persistence, pending receipts/void balances, GST
  inclusive/exclusive and CGST/SGST/IGST calculations, UPI URI construction,
  payment-setup validation, corrupt-primary sync-state recovery, and proof
  that student portal metadata never enters an offline student upsert.
- `npm test` also runs twenty-one Playwright tests: the existing auth suite,
  `tests/erp-local.spec.js` for separate local mode (including branch and
  batch workspace cards plus the Monday weekly-schedule view, rich
  Instructor profile create/edit, local Instructor roster remove/add, GST
  Payment setup, subscription pause/resume/renewal persistence, dynamic UPI
  QR, unpaid vs paid invoice behaviour and generation of a real one-page
  A4 `%PDF` with an asserted MediaBox through Chromium), and
  `tests/erp-sync.spec.js`, which mocks
  Supabase at the network boundary and drives offline edit → concurrent
  change → conflict review → resolution → dependency-ordered creates,
  offline Payment setup → mirrored queue/close guard → automatic sync,
  Owner Student/Co-owner/Admin/Instructor access flows by email,
  Co-owner and branch-Admin Instructor Portal grants, hiding of Instructor
  profile setup/portal controls from Instructor and Student accounts,
  branch-Admin hiding of organization-role and Owner/Co-owner setup actions,
  signed-in Instructor identity locking, assigned-batch roster enrollment
  sync add/remove, the Instructor's role-aware account Profile with the
  linked teaching profile, a waiting student's dedicated
  no-access screen and Retry after grant, an explicit prospective-Owner
  organization-creation path, the signed-in student's personal dashboard,
  assigned-batch-only/no-roster or capacity details in List/Schedule,
  hidden sync controls, Owner/Admin-only
  **Studio ERP data** settings, online revocation display clearing, a
  one-form public registration/admission submission with Terms, manager and
  Instructor-scoped confirmation creating the Student while granting portal
  access and continuing to enrolment, and a manager
  subscription pause → resume/end-date extension → current-Plan-price
  renewal → linked History → cancellation/replacement-availability journey.
- During development the full SQL file was also executed twice (idempotent
  rerun) in an ephemeral PGlite Postgres with stub Auth users/`auth.uid()`.
  In addition to the prior sync, billing, payment and Student-access checks,
  the SQL v6 harness runs RPCs as the `authenticated` role and covers
  Owner/Co-owner protection, unconfirmed and cross-organization account
  rejection, role-conflict rejection, exact Admin branch replacement,
  branch-scoped snapshots/direct writes/sync rejection, Instructor
  own-batch attendance and current-batch sync protection, inactive-linked
  Instructor denial, Student own-record scoping, all role revocations, and
  denial of direct calls to internal access helpers. A separate ephemeral
  SQL v6 admission harness passes 24 checks for invalid code, unconfirmed
  and email-mismatched accounts, pending submission/reload, Instructor
  denial, branch-Admin scope, atomic Student+portal confirmation,
  Instructor medical-field redaction versus Student self-visibility,
  reject/resubmit, exact-email duplicate blocking with no partial writes,
  and authenticated-only RPC/table privileges. A SQL v7 subscription
  harness passes 41 fresh-install checks for direct and sync pause/resume,
  current-price renewal, one-live-renewal conflicts and replacement after
  cancellation, pause/renewal lineage guards, branch/role snapshot scope,
  paused payments, cancelled-payment rejection, cancelled-period reopen
  denial and RPC/table privileges; a separate simulation loads the committed
  SQL v6 setup, seeds active/cancelled memberships, runs SQL v7, and verifies
  preservation, cancellation-time backfill and pause. A dedicated SQL v8
  harness passes 14 fresh-install checks for template/offering schema,
  direct/sync one-month normalization, mismatch and pause rejection,
  renewal-source conflicts and one-month payments; a separate v7 → v8
  simulation preserves active/paused periods and backfills subscription
  template/offering fields. A dedicated SQL v9 harness passes 24
  fresh-install checks for rich profile normalization/snapshot fields,
  candidate inclusion with private-field redaction, other-branch/inactive
  exclusion, direct and sync assigned-batch roster add/remove, capacity
  including rejection of a sync move into a full batch,
  other-Instructor and Student-record-write denial, manager cleanup after a
  student branch move, profile sync persistence and idempotent rerun; a
  separate SQL v8 → v9 simulation passes 6 checks preserving an existing
  Instructor while adding the empty profile and allowing a later rich
  update. A dedicated SQL v10 adversarial role harness passes **79/79**
  checks as the `authenticated` database role: Instructor/Student context
  and snapshot field/record minimization, selected-branch Admin scope,
  bootstrap non-escalation for linked accounts, direct-RPC and sync denial
  for access administration, Student/Instructor/Branch/Batch/Plan/
  Membership/Payment/Admission writes outside each role, other-batch
  roster/attendance denial, enrolled-only attendance, internal-helper and
  direct-table denial, and idempotent rerun. The SQL v10 roster/profile
  harness still passes 24/24, and v9 → v10 and v8 → v10 upgrade simulations
  pass 7/7 and 6/6. Those harnesses are not shipped and are not live
  Supabase UAT.
- Production UAT still required after running SQL v12 in the real project:
  sign in as Owner and wait for **Online · synced**; save Payment setup as
  Owner/Co-owner; go offline and mark attendance + record a payment; verify
  the close warning, reconnect and verify automatic sync and one receipt
  only; generate unpaid and paid invoice PDFs, confirm each file is one
  A4 portrait page, and scan the unpaid UPI QR;
  use two accounts to edit the same student concurrently and resolve the
  conflict both ways; then use separate confirmed Co-owner, Admin,
  Instructor and Student accounts to grant/revoke access and verify each
  role's branch/own-record visibility, including that revoked accounts stop
  loading fresh studio data on their next successful online refresh; and
  copy the public admission link, open it signed out, submit the one-form
  registration with password + Terms, confirm the applicant email, verify a
  branch Admin cannot confirm outside assigned branches and an Instructor
  can confirm only studio/teaching-branch requests into a teaching branch,
  continue to batch/plan, verify the applicant opens the Student portal with
  the same email/password, and verify an Instructor's admission review,
  roster and snapshot do not expose Medical /
  Physical issue or any enrolled/candidate private fields, and a Student
  cannot see another student, an unrelated Plan or assigned-instructor
  contact/profile fields; edit that Instructor's
  bio/specialties/qualifications/experience/joining date, sign in as the
  Instructor, add/remove a same-branch active student in an assigned batch,
  fill the batch to capacity, confirm another Instructor's batch, inactive
  and other-branch students are denied, and check the role-aware Profile;
  pause/resume a subscription and verify its end date moves
  by the paused days, change its Plan price and verify a manager-created
  renewal uses the new price, verify a cancelled future renewal can be
  replaced, create a One-month only Plan/pass and verify no pause/renewal
  control appears, and verify the Student sees lifecycle/history without write
  controls while an other-branch Admin and Instructor cannot mutate it.
  Mocked tests are not
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
- Subscriptions and passes use a single amount per period; proration, discounts and
  refunds follow the accounting approvals still open in
  `docs/11-management-plan/`. GST is invoice calculation/display only. A void
  is an audited correction marker, not a cash-refund workflow. Renewal is
  manager-confirmed only—there is no unattended invoice generation,
  saved-method autopay, retry/dunning or Student self-service lifecycle
  change—and pausing a subscription does not automatically suspend batch
  enrolment or attendance.
- Invoice/receipt PDFs are browser-generated on demand; no PDF file or
  immutable invoice document is stored server-side. The due-invoice reference
  is generated for payment reconciliation, while paid documents use the
  server receipt number; confirm statutory invoice-numbering requirements
  with your CA before treating the PDF as a tax invoice system of record.
- Razorpay/Cashfree fields are configuration/readiness only in this release.
  Live checkout, provider order creation, webhook signature verification,
  refunds and automatic reconciliation require a separate trusted backend.
- Dates/times use the device's local timezone (studio default Asia/Kolkata).

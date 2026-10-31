# Yoga Studio — Changelog

All notable changes to Yoga Studio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).
`package.json` is the authoritative application version.

## 1.10.0 — 2026-11-01

### Added — Admissions, guided enrolment and Instructor students

- **Admission requests workspace:** **Students → Admission requests** now
  supports search, status/branch filters, request cards and detail,
  pending-age and duplicate warnings, phone/email/WhatsApp contact actions,
  and guided confirmation into Student creation, batch assignment, plan/pass
  selection and optional payment.
- **Studio and branch public admission links:** managers can copy, share,
  QR-open and test one studio-wide admission link plus one link per active
  branch. A branch link pre-selects that branch for the applicant, while an
  authorized manager can still change the final branch during confirmation.
- **Guided Enroll student wizard:** the shared **Student → Batch → Plan →
  Payment & review** flow adds duplicate handling, batch and plan previews,
  payment shortcuts and balance, final review/edit steps, partial-progress
  recovery, and an **Enrolment complete** screen with receipt and due-invoice
  actions.
- **Instructor Students workspace:** Instructors now have **Students / My
  students** for students actively enrolled in their own batches. They can
  share public admission links without viewing admission requests, create a
  basic walk-in student, assign new or existing students only to batches they
  teach, and record final manually verified payments only for an active
  own-batch enrolment against the matching subscription/pass.
- **Instructor plan visibility at Enroll Step 3:** active plans that arrive
  after the wizard opens are selected automatically. SQL v11 reports
  `setupVersion: 11`; if an Instructor is still connected to an older database
  setup, Step 3 now shows an explicit SQL v11 update error with **Reload
  plans** instead of a misleading generic no-plan state.

### Added — Centralized error management

- Browser, Auth, Supabase, network and common PostgreSQL failures are now
  normalized into structured notices with a clear title, **What happened**,
  **Possible solution**, severity, retry/dismiss actions where safe, and
  expandable copyable technical details. This covers global notifications,
  inline ERP notices and an application error boundary.

### Database migration — SQL v11 (cumulative)

- Run the complete updated `supabase/erp_setup.sql` once in the Supabase SQL
  Editor. SQL v11 adds branch-aware admission RPCs and Admin admission scope,
  Instructor snapshot access to active plans/billing settings with only
  current own-batch finance, server-enforced basic walk-in creation,
  exact active-plan initial membership checks, final verified own-batch
  payment checks, `setupVersion: 11` in `erp_get_context()`, and explicit
  helper grants/revokes. Instructors still cannot create or edit plan
  templates, view Medical / Physical issue, edit full Student records, review
  public admission requests, void/refund payments or access unrelated finance.

### Validation

- Production build passes; the selected Node suite passes **50/50**. Browser
  coverage includes manager admission confirmation, signed-in Instructor
  scope and the delayed-plan Instructor walk-in enrolment/payment regression.
  The SQL v11 PGlite role-access harness passes **103/103**, with cumulative
  roster/profile regression and SQL v10 → v11 upgrade checks also passing.
  Live five-role Supabase UAT remains required after running SQL v11.

## 1.9.0 — 2026-10-31

### Added — Branches & batches operational workspace

- **Branch overview:** the manager **Branches** tab now opens with active
  branch, active-student, active-batch and overall seat-fill KPIs, followed
  by searchable, status-filterable and sortable branch health cards. Each
  card shows students, active batches, enrolled seats/capacity and fill,
  address/phone, instructors teaching, weekly and today's classes, 30-day
  attendance, the next class, and shortcuts to that branch's batches or
  students. Existing add/edit/archive/restore behavior is preserved.
- **Batch List and Schedule views:** Managers, Instructors and Students can
  switch between rich batch cards and a recurring Monday-first weekly
  timetable. Batch work can be searched by batch/branch/instructor and
  filtered by status and day; non-Student roles also get availability
  filters and seat-fill sorting. Cards show day chips, time/duration, next
  class, weekly frequency and recent attendance. Managers/Instructors see
  enrolled/capacity, seats left and fill progress; Students see only their
  assigned batches and do not see studio roster or capacity details.
- **Operational warnings and faster setup:** a Needs attention summary flags
  instructor schedule overlaps, full batches, unassigned instructors and
  empty active batches. Managers can duplicate an existing batch's settings
  into a new batch form. The form now requires at least one class day and
  warns when capacity is below current enrollment or the selected instructor
  already teaches an overlapping active batch; an overlap remains a warning
  rather than silently blocking an intentional exception. The roster dialog
  adds a capacity progress bar and enrolled-student search.

### Database

- **No database change.** Version 1.9.0 uses the existing branch, batch,
  enrollment and attendance fields and continues to require **SQL v10** from
  1.8.1. If SQL v10 is already live, do not rerun SQL for this release.

### Validation

- New pure-logic coverage verifies next recurring class dates, 80%/full
  capacity states and same-instructor overlap detection, including adjacent
  non-overlapping classes and archived/other-instructor exclusions. Browser
  coverage exercises the new branch/batch cards and Monday Schedule view in
  local mode, plus the Student List/Schedule view without roster or capacity
  details.

## 1.8.1 — 2026-10-31

### Security — Fixed-role authorization hardening (SQL v10)

- **Instructor snapshots are identity-only for students.** SQL v10 now sends
  an Instructor only name, branch, status and joining information for both
  enrolled students and same-branch roster candidates. Phone, email, gender,
  date of birth, address/PIN, notes, admission/referral/experience/reason and
  Medical / Physical issue stay blank unless the caller is Owner/Co-owner, an
  Admin of the student's branch, or the student themselves. The Instructor's
  narrow assigned-batch roster and attendance rights are unchanged; Student
  records, batch settings, subscriptions, payments, Instructor profiles and
  role access remain outside that role.
- **Student snapshots expose no other person or unrelated Plan.** An assigned
  instructor is now display-name-only for a Student: branch, phone, email,
  bio, specialties, qualifications, experience, joining date and status are
  blank. Plan rows are limited to Plans referenced by that student's own
  subscriptions/passes. Other students, other memberships/payments and
  unassigned batches were already excluded and are regression-tested.
- **Internal helpers are no longer RPCs.** Browser execution is explicitly
  revoked for `erp_current_org`, `erp_my_roles`, `erp_can_manage`,
  `erp_my_instructor_id`, `erp_my_student_id`, `erp__require_org`,
  `erp__require_manager` and the audit-writing `erp__log`; every SQL function
  is either an application-facing authenticated RPC or explicitly revoked.
  The signed-in Portal selector is also locked to the server-returned role;
  only the separate device-only local mode keeps a presentation-only preview.

### Database migration — SQL v10 (includes SQL v9–v5)

- Run the complete updated `supabase/erp_setup.sql` once in the Supabase SQL
  Editor; do not stop at SQL v9. SQL v10 is cumulative and changes snapshot
  field visibility plus function grants only; it does not delete or rewrite
  business rows. Authorization is re-checked by the snapshot, direct RPCs
  and `erp_sync_push`, following Odoo's default-deny group/record-rule model:
  Owner is organization-wide, Co-owner is all-branch without Owner/Co-owner
  administration, Admin is selected-branch only, Instructor is
  assigned-batch only, and Student is own-document/read-only.

### Validation

- A new ephemeral PGlite adversarial role harness passes **79/79** checks as
  the `authenticated` database role, covering Instructor/Student snapshot
  minimization, Admin branch scope, linked-account bootstrap non-escalation,
  direct and offline-sync write denial, enrolled-only attendance,
  internal-helper/direct-table denial and idempotent rerun. SQL v10
  roster/profile checks pass **24/24**; v9 → v10 and v8 → v10 simulations
  pass **7/7** and **6/6**. A shipped Node contract test prevents internal
  helpers from being re-granted in a future SQL edit. Live Supabase UAT with
  all five roles remains required after running SQL v10.

## 1.8.0 — 2026-10-31

### Added — Rich Instructor profiles and assigned-batch roster editing

- **Instructor profile cards:** **Branches & batches → Instructor profiles**
  now has search, status filtering and summary counts plus cards showing the
  instructor's home/teaching branches, contact details, status, teaching
  bio, specialties/styles, qualifications/certifications, experience,
  joining date, active batch/student counts and next class. Owner,
  Co-owner and authorized branch Admins can create and edit the profile;
  Instructor Portal sign-in linking remains a separate Access workflow.
- **Instructor roster writes, narrowly scoped:** a signed-in Instructor can
  open **Roster** from **Batches** and add/remove existing active students
  only in an active batch assigned to that Instructor and only when the
  student belongs to the batch branch. Capacity and seats-left are shown and
  enforced. The Instructor still cannot create/edit Student records, edit a
  batch's schedule/capacity, access Subscriptions/Payments, set up
  Instructor profiles or administer role access.
- **Privacy-preserving candidates:** to make Add possible, the Instructor
  snapshot now includes active same-branch candidates in branches where the
  Instructor teaches, but only with name/branch/status/joining fields.
  Candidate phone, email, address, notes and admission details are blank;
  Medical / Physical issue remains manager-and-self-only. Students already
  enrolled in the Instructor's batches keep the roster fields previously
  available, still without medical text.

### Changed — Role-aware account Profile and A4 invoice PDFs

- **Profile** replaces the generic “Studio member” summary with the user's
  actual Owner, Co-owner, Admin, Instructor or Student role. It now supports
  editable name, phone and personal bio; shows the read-only sign-in email,
  organization, account type and branch/access scope; and displays a linked
  Instructor teaching profile (bio, specialties, qualifications and assigned
  batches) or Student record/batch summary where applicable. Role and branch
  assignments remain manager-controlled and are not editable there.
- **Invoice/receipt print output is fixed to one A4 portrait page.** The
  stylesheet declares a 210 × 297 mm sheet with 10 mm margins and constrains
  the invoice to the printable page with compact print typography and a
  light print palette. The button is now **Print / Save A4 PDF**. Automated
  Chromium coverage generates both due and paid PDFs and asserts one page
  plus the A4 PDF MediaBox (595.28 × 841.89 pt).

### Database migration — SQL v9 (includes SQL v8, v7, v6 and v5)

- Run the complete updated `supabase/erp_setup.sql` once in the Supabase SQL
  Editor; do not stop at SQL v8. SQL v9 adds Instructor `bio`, bounded
  `specialties`, `qualifications`, `experience_years` and `joining_date`,
  profile constraints/indexes and snapshot/direct/sync persistence. Existing
  Instructor rows preserve name, contact details, home branch and status and
  gain an empty teaching profile.
- SQL v9 adds a shared server roster-authorization helper used by
  `erp_enroll_student`, `erp_end_enrollment` and enrollment operations in
  `erp_sync_push`. It preserves manager branch scope, allows the assigned
  Instructor only on an active own batch with an active branch link,
  requires an active same-branch student for activation, and preserves the
  capacity checks in the writers. Student-record and batch sync writes stay
  manager-only; the new private helpers are revoked from browser roles.

### Validation

- Node logic coverage adds Instructor profile normalization (specialty
  parsing/deduplication, text bounds, experience clamping and strict joining
  dates). Browser coverage exercises rich profile create/edit, local and
  mocked-Supabase Instructor roster add/remove, the Instructor account
  Profile, general profile phone persistence, and one-page A4 PDF output.
- Ephemeral PGlite validation passes **24/24** dedicated SQL v9 checks
  (profile snapshot/persistence, candidate redaction, direct/sync roster
  authorization, capacity—including a sync move into a full batch—forbidden
  other-batch and Student-record writes,
  manager cleanup after a branch move, and idempotent rerun) and **6/6**
  SQL v8 → v9 upgrade checks preserving an existing Instructor. Live
  Supabase UAT remains required after running SQL v9 in the real project.

## 1.7.0 — 2026-10-31

### Changed — Subscription, Payments and branch navigation

- **Subscriptions is now a top-level menu.** It contains **Subscriptions &
  dues**, **One-month passes** and **Plans**. The former Fees menu is now
  **Payments**, containing payment history, **Record payment**, due/paid
  invoice PDFs and **Payment setup**. Recording a payment from a
  subscription or pass row lands in Payments after saving.
- **Student navigation follows the same split:** the dashboard says **My
  subscription & passes**, and Students get view-only **My subscriptions &
  passes** and **My payments** screens. A one-month pass displays **No
  renewal** instead of a renewal date.
- **Manager batch work moved under Branches & batches.** The manager page
  now has **Branches**, **Batches** and **Instructor profiles** tabs, and
  the standalone manager **Batches** menu was removed. Instructors and
  Students keep their standalone assigned-batch views because the branch
  workspace remains manager-only.

### Added — Odoo-style Plan templates and one-month-only passes

- **Plan templates:** each Plan now records its type (**Subscription** or
  **One-month only**), INR price, billing period in months, default
  calendar-month/joining-date alignment, renewal-tracking default and
  Active/Archived status. The Plans table shows the price, billing period,
  renewal behaviour and currently active count. New subscription and pass
  forms offer only active templates of the matching type and prefill terms
  from the selected template. Existing periods keep their amount and now
  snapshot `offeringType`, so editing a template later cannot convert an
  existing subscription into a pass or vice versa.
- **One-month only:** this distinct non-subscription offering creates one
  fixed month with dues, a due invoice and payment collection. It is shown
  separately under **Subscriptions → One-month passes** with its own
  active/scheduled/expired/cancelled filters, outstanding-dues summary and
  **New one-month pass** action. It offers Invoice, Collect and Cancel pass
  only—no Pause, Renew, History, next-renewal date or MRR contribution.
- **Server-enforced invariants:** shared client logic, the this-device
  store, direct RPCs, offline-sync RPCs and SQL constraints normalize a
  one-month pass to exactly one month, `autoRenew = false`, no previous
  period, renewal number 0, zero paused days and never paused. New
  offering/Plan-type mismatches are rejected, a one-month Plan cannot be
  used for a renewal, and a one-month pass cannot be a renewal source.
  Offline renewal attempts against a pass return the named manual conflict
  `ONE_MONTH_NO_RENEWAL`. Renewal forms only offer active subscription
  templates, while the payment form labels and accepts either a
  subscription or a one-month pass.
- **Out of scope retained:** no Odoo connection/embed, unattended
  recurring-invoice scheduler, saved-method autopay, retry/dunning,
  subscription stages/forecasting or Student lifecycle self-service was
  added. Renewals remain manager-confirmed.

### Validation

- Logic coverage adds Odoo-style template normalization and one-month
  lifecycle/MRR assertions. The browser suite covers the new
  Branches/Batches/Instructor paths, Subscriptions/Payments split,
  Admin/Student visibility, creation of a One-month only Plan, a separate
  one-month pass with no Pause/Renew/History actions, and the existing
  subscription pause/resume/renew/cancel journey.
- Ephemeral PGlite validation passes the previous 41 subscription
  lifecycle/security checks against SQL v8, 14 dedicated SQL v8
  template/offering/direct/sync/payment checks, and a SQL v7 → v8 upgrade
  simulation that preserves active/paused periods while backfilling
  subscription template and offering fields. Live Supabase UAT remains
  required after running SQL v8 in the real project.

### Database migration — SQL v8 (includes SQL v7, v6 and v5)

- Run the complete updated `supabase/erp_setup.sql` once in the Supabase SQL
  Editor. SQL v8 adds Plan `plan_type`, `billing_cycle` and
  `renewal_enabled_default`; membership `offering_type`; one-month template
  and period constraints; type/offering indexes; snapshot fields; and
  matching direct and offline-sync RPC normalization. Existing Plans and
  memberships backfill as `subscription` with joining-date template
  alignment and renewal tracking enabled, preserving amounts and period
  dates. The single setup file remains idempotent and does not delete
  business rows. Run SQL v8 before using a One-month only Plan/pass from the
  deployed 1.7.0 app.

## 1.6.0 — 2026-10-31

### Added — Fixed Role Access for Owner, Co-owner, Admin, Instructor and Student

- **Access page:** Owner, Co-owner and branch Admin users now get a central
  **Access** screen with a fixed five-role authorization matrix, current
  actor/branch scope, refresh/offline/error states and a shortcut to the
  existing Student portal workflow. Role changes are online-only and are
  never placed in the offline sync outbox.
- **Co-owner access:** only the protected primary Owner can add or remove a
  Co-owner by that person's confirmed sign-in email. A Co-owner operates all
  branches and can manage Admin, Instructor and Student access, plans and
  Payment setup, but cannot transfer ownership or add/remove the Owner or
  another Co-owner.
- **Selected-branch Admin access:** Owner/Co-owner can grant an Admin to an
  explicit set of active branches; saving again replaces that account's
  complete branch assignment. A branch Admin can operate and manage
  Instructor/Student access only in assigned branches. Branch Admins can
  read plans/billing settings needed for operations but can no longer
  create/edit plans or change Payment setup.
- **Instructor sign-ins:** an Instructor account is linked to exactly one
  active instructor record and explicit sign-in branches. Instructor profile
  setup and Instructor Portal grants/removals are limited to the Owner, a
  Co-owner or an Admin acting within assigned branches. Owner/Co-owner can
  replace the global sign-in; a branch Admin can manage only their branch
  portion and cannot replace another account globally. Supabase mode locks
  the signed-in Instructor identity in the toolbar.
- **Student workflow retained:** Student accounts remain managed from
  **Students → Portal access**, preserving branch-move link transfer,
  inactive-student denial and the view-only own-record portal.
- **Joining-account onboarding:** sign-up now defaults to **Join an existing
  studio** for Students and staff. An unlinked joining account receives a
  dedicated **Waiting for studio access** screen with no ERP navigation,
  studio records or organization-creation controls. Only an account that
  explicitly chooses **Create my own studio** is routed to organization
  creation; the choice is onboarding routing only and does not itself grant
  an ERP role.
- **Personal Student dashboard and settings boundary:** the Student
  dashboard now shows only that student's assigned batches, next class,
  classes today, attendance, subscription progress, dues and recent payments.
  Student screens no longer display **Online · synced**, **Supabase ·
  Synced** or **Sync now**; the Batches screen does not expose an unassigned
  batch, studio roster or class size. **Settings → Studio ERP data** is
  limited to Owner and Admin accounts and is not shown to Co-owner,
  Instructor or Student accounts.

### Added — Public Student admissions

- **Studio-specific admission link:** managers copy the link from
  **Students → Admission requests**. The link code selects the organization
  only; the applicant first creates/confirms an account with **Join an
  existing studio**, signs in and then submits First Name, Last Name, Date Of
  Birth, Phone Number, Subject, their read-only sign-in Email, Address, Pin
  Code, optional Reference by, Experience in yoga, Medical / Physical issue
  and Reasons to join yoga. No anonymous business-data submission is allowed.
- **Manager confirmation:** Owner/Co-owner may confirm into any active
  branch; a branch Admin may view unassigned requests but confirm only into
  an assigned branch. The reviewer selects branch and joining date and may
  reject with a note. Pending requests can be updated and rejected requests
  corrected/resubmitted by the applicant.
- **Student + portal in one transaction:** confirmation creates the Student
  and grants Student portal access to the exact submitting account through
  the existing audited grant. An existing Student with the same email is
  flagged and blocks confirmation so staff can resolve/link the existing
  record instead of silently creating a duplicate.
- **Structured, privacy-scoped profile:** admission fields are copied to
  split-name Student profile fields and shown to the student on their own
  dashboard. Medical / Physical issue is visible only to Owner, Co-owner,
  the student's branch Admin and the student; Instructor snapshots redact it.

### Added — Native Odoo-style subscriptions

- **Plans as templates, periods as contracts:** existing fee Plans now act
  as reusable subscription templates. Every membership row is presented as
  one subscription period with its own agreed amount, dues, invoice,
  payments and receipts. Yoga Studio implements this natively; no separate
  Odoo service is connected or embedded.
- **Lifecycle management:** managers can create subscriptions and view
  active, scheduled, paused, expired and cancelled states. Pause records a
  start date, optional expected resume date and reason; Resume adds the
  elapsed pause days to the period end. Cancellation is terminal for that
  period and records its timestamp/reason while preserving payment history.
- **One-click renewal:** **Renew** creates a linked next period beginning
  the day after the current end date (or today if already expired), using
  the selected Plan's current price and duration. The prior period's amount
  is not rewritten. A **History** view shows the full linked chain, and the
  Fees summary reports active/paused subscriptions, renewals due and a
  simple current-active-subscription MRR.
- **Lineage safeguards:** only one live renewal may follow a period. A
  cancelled future renewal stays in History and can be replaced. A period
  cannot be paused while a live renewal follows it, and a paused period must
  resume before renewal so the renewed start date is final. Payments remain
  collectible for paused/scheduled/expired periods but are blocked after
  cancellation.
- **View-only Student portal retained:** students see their own lifecycle,
  next renewal date, dues and linked History with wording that renewal is
  confirmed by the studio and no automatic charge is made. They receive no
  Pause, Resume, Cancel, Renew or payment-write controls. This release has
  no unattended recurring-invoice scheduler, saved-method autopay or retry/
  dunning workflow.

### Security and behavior

- SQL v5 treats `co_owner` as a distinct organization role and enforces the
  fixed matrix in context, snapshot, direct RPC and offline-sync paths.
  Branch Admins are checked against both current and destination branches
  for records that can move; branch creation, unassigned Instructor
  creation, plans, Billing Settings and historical null-branch payment
  voids are Owner/Co-owner-only.
- Instructor snapshot and attendance rules require both the linked
  instructor record on the batch and active access to that batch's branch.
  Instructors receive no plans, memberships or payments in their snapshot.
  Attendance sync also checks the existing record's current batch so a row
  cannot be moved across an authorization boundary.
- New access grants resolve confirmed, usable Supabase accounts only on the
  server; reject cross-organization and conflicting active-role accounts;
  serialize changes per organization; suspend rather than delete removed
  links; and write audit rows. Inactive linked Instructor/Student records
  make sign-in ineffective. Internal authorization/account-resolution
  helpers are revoked from browser API roles.
- Important three-valued-logic hardening: organization-manager and
  branch-manager helpers now return strict `true`/`false`, never SQL
  `NULL`, so `IF NOT ...` authorization guards cannot be bypassed by a
  missing role row.
- SQL v6 adds a locked `erp_admissions` table and authenticated-only
  `erp_get_my_admission`, `erp_submit_admission`,
  `erp_get_admission_link_info`, `erp_list_admissions` and
  `erp_review_admission` RPCs. Submissions require the confirmed Auth email
  and an account with no active ERP role; admission review and the Student
  portal grant are serialized/audited and remain online-only.
- SQL v7 extends the existing membership/direct/sync RPC surface rather than
  exposing a new generic subscription API. Direct saves, cancellation and
  payments and `erp_sync_push` all recheck lifecycle values, current and
  destination branches, source-subscription student/branch, renewal lineage
  and paused/cancelled state. A partial unique index permits only one live
  renewal; duplicate offline renewals return `ALREADY_RENEWED`, attempts to
  reopen or pay a cancelled period are rejected, and lifecycle mutations are
  audited as pause, resume, renew or cancel.
- Browser coverage adds Owner Co-owner/Admin/Instructor management,
  Co-owner and branch-Admin Instructor Portal grants, hiding of Instructor
  profile setup/portal controls from Instructor and Student accounts,
  branch-Admin UI restrictions, signed-in Instructor locking, the waiting
  joining-account screen, the explicit prospective-Owner creation path,
  the personal Student dashboard/assigned-batch portal without sync
  controls, Owner/Admin-only visibility of **Studio ERP data**, applicant
  admission submission and manager admission confirmation, plus a manager
  subscription pause/resume, current-price renewal, History and cancellation
  journey and an offline-device lifecycle journey. PGlite validation
  exercises the role-access RPC surface as `authenticated`; the SQL v6
  admission harness passes 24 checks, and the SQL v7 subscription harness
  passes 41 direct/sync lifecycle, renewal-lineage, branch-scope, payment
  and privilege checks. A separate SQL v6 → v7 upgrade simulation verifies
  preservation of active/cancelled memberships and cancellation backfill.
  Live Supabase Auth/RLS UAT with five real accounts remains required after
  deployment.

### Database migration — SQL v7 (includes SQL v6 and SQL v5)

- Run the complete updated `supabase/erp_setup.sql` once in the Supabase SQL
  Editor. The complete file now installs SQL v7: SQL v5 adds `erp_list_role_access()`,
  `erp_grant_co_owner_access(text)`, `erp_revoke_co_owner_access(uuid)`,
  `erp_grant_admin_access(text, uuid[])`,
  `erp_revoke_admin_access(uuid)`,
  `erp_grant_instructor_access(uuid, text, uuid[])` and
  `erp_revoke_instructor_access(uuid)`, strengthens branch checks across
  existing RPC/sync functions, adds lookup indexes and revokes internal
  helpers; SQL v6 adds the organization admission code, locked admissions
  table/RPCs and structured Student profile columns; and SQL v7 adds
  subscription lifecycle columns/backfills/constraints, snapshot fields,
  the one-live-renewal index, and matching direct/sync lifecycle/payment
  handling. Existing periods keep their amount and dates and receive
  renewal tracking by default; legacy cancelled periods receive a
  cancellation timestamp. The single setup file remains idempotent and does
  not delete business rows. Deploy/run the complete SQL v7 file before using
  **Access**, **Admission requests**, the narrowed branch-Admin permissions
  or subscription Pause/Resume/Renew/Cancel actions.

## 1.5.0 — 2026-10-30

### Added — In-app Student portal access

- **Students → Portal access:** an Owner, organization manager or Admin of
  the student's branch can now link a student record to the student's
  registered Supabase sign-in email directly in the app. The student first
  creates and confirms a dedicated account; they are explicitly told not to
  create their own organization. The Students table shows **No portal
  access**, **Portal active** or **Portal suspended** plus the linked
  sign-in email.
- **Grant, replace and remove:** entering a different confirmed email
  intentionally replaces the old student sign-in, and **Remove access**
  suspends the link without deleting the Auth account, student record or
  payment history. Access changes are online-only, require the student
  record to be synced first, and are never placed in the offline outbox.
- **Student onboarding/revocation polish:** signup and no-organization
  screens now separate the studio-owner path from the waiting-student path.
  **Retry/Sync** rechecks a no-organization account immediately after an
  admin grants access, adopts the server-assigned Student role and signed-in
  student record, and stops presenting the downloaded studio snapshot after
  online revocation is detected.
- The signed-in Student portal remains **view-only** for ERP data: own
  dashboard summary, batches/classes, attendance, membership, dues, payment
  history, due-invoice PDFs and paid receipt PDFs. Students cannot record
  payments or edit studio records.

### Security and behavior

- New typed RPCs resolve the registered email only on the server, require a
  confirmed usable Auth account, and prevent one account from being actively
  linked to two students or used across organizations in the current
  one-organization-per-account context model. Organization owner/manager
  accounts cannot be reused as dedicated student sign-ins.
- Portal status/email is returned only to an organization manager or an
  Admin of that student's branch. It is display metadata and is excluded
  from offline student upserts and conflict comparisons.
- Moving a student to another branch now moves the active portal link with
  the student. Deactivating a student blocks effective portal access while
  preserving the link; reactivating the student restores it.
- Browser and sync-store coverage now includes Owner grant/remove, a
  waiting student's Retry flow, the Student view-only portal and online
  revocation. Live Supabase Auth/email/RLS UAT with a real student account
  is still required after deployment.

### Database migration — SQL v4

- Run the complete updated `supabase/erp_setup.sql` once in the Supabase SQL
  Editor. SQL v4 adds `erp_grant_student_access(uuid, text)` and
  `erp_revoke_student_access(uuid)`, manager-only portal fields in the
  snapshot, branch-member lookup indexes, an audited access trail and the
  branch-move trigger. The file remains the single idempotent setup file
  and does not delete business rows. Deploy/run SQL v4 before using
  **Students → Portal access**; on an older database the app reports that
  the latest setup is required.

## 1.4.2 — 2026-10-30

### Changed — Dependency, runtime and build-tool modernization

- **Runtime dependencies:** updated `@supabase/supabase-js`
  `2.109.0 → 2.118.0` and `lucide-react` `1.57.0 → 1.64.0`. React/React DOM
  19.3.1, `qrcode` 1.5.4 and Playwright 1.64.1 were already current and are
  unchanged.
- **Node runtime:** Node **26 LTS** is now the canonical local and CI
  runtime. The GitHub Pages workflow uses Node 26, `.nvmrc` selects Node 26,
  and package engines allow `>=22 <27`.
- **Build tooling:** upgraded Vite `6.4.4 → 8.3.5` and
  `@vitejs/plugin-react` `4.3.4 → 6.1.2`, and renamed the ESM build config
  to `vite.config.mjs`. The service-worker content stamp, GitHub Pages
  `/yoga_studio/` base path, offline shell, invoice QR generation and A4
  PDF output were re-verified against production builds.
- **Transitive refresh/audit:** the locked transitive tree was rechecked;
  no within-range updates remained and no unsupported npm overrides were
  introduced. `npm audit` reports zero vulnerabilities for both the full
  and production-only trees.

### Performance

- Compared with a clean 1.4.1 production build, the main JavaScript asset
  decreased from about **647 kB** to **632 kB** (about **2.3% smaller**),
  with a correspondingly smaller gzip payload. This is a maintenance
  release: no product feature or ERP behavior change is intended.

### Database migration

- No database change. SQL v3 from 1.4.0 remains current; do not re-run the
  setup file solely for this patch if SQL v3 is already installed. If SQL
  v3 has not been installed yet, run the complete
  `supabase/erp_setup.sql` file before relying on synchronized billing
  settings and complete live sign-in/UAT.

## 1.4.1 — 2026-10-29

### Fixed — Invoice PDF printing and app-wide form alignment

- **Complete A4 invoice PDFs:** the invoice is now rendered again in an
  isolated, body-level print root instead of being absolutely positioned
  inside the scrollable dialog. Browser **Print / Save as PDF** therefore
  includes the complete header, line items, payment/QR section, totals and
  footer for both due invoices and paid receipts, rather than a clipped
  central strip. QR generation is completed before printing when possible;
  Dark-theme PDFs keep the dark invoice on a clean white A4 page canvas.
- **Consistent ERP field alignment:** an auth-only stacked-label margin no
  longer leaks into ERP two-column grids. In Add batch, **Branch** now aligns
  exactly with **Batch name**; the same fix applies to branch, student,
  instructor, batch, plan, membership, payment, Payment setup and invoice
  option forms. ERP inputs/selects use a shared 44px height, wrapping labels
  bottom-align their controls, and paired primary/secondary buttons share a
  44px height.
- **Attendance and mobile polish:** date/batch controls bottom-align with the
  attendance actions on desktop, stack full-width on phones, and the Fees
  segmented tabs scroll internally instead of widening the page.
- Added browser regression checks that measure first-row label/control
  geometry across representative forms and verify that the printable due and
  paid invoices fit the A4 printable area and generate one-page PDFs.

### Database migration

- No database change. SQL v3 from 1.4.0 remains current; do not re-run the
  setup file solely for this patch if SQL v3 is already installed.

## 1.4.0 — 2026-10-29

### Added — Payment setup, GST/UPI invoices and no-forget autosync

- **Always-visible Online/Offline badge** in the signed-in top bar and auth
  header. In Supabase mode it distinguishes synced, syncing, waiting,
  saved-locally and conflict-review states; in separate local-device mode it
  is explicitly labelled **this device**.
- **Automatic sync safety net:** pending signed-in work now also retries
  every 30 seconds while the app is visible and uses bounded exponential
  backoff (5–60 seconds) after transient failures. Sync is attempted after a
  write, on reconnect, on visibility/focus and best-effort on page hide; a
  fresh edit brings a delayed retry forward. Users no longer need to remember
  **Sync now**.
- **Browser-close protection:** while signed-in changes are pending,
  conflicted or actively syncing, the app requests the browser's standard
  close/refresh confirmation. The durable outbox is not erased by closing and
  resumes on the next open for the same user/organization.
- **Stronger device persistence:** the sync state is mirrored to a second
  same-origin storage key and recovered if the primary copy is corrupt, and
  the app requests persistent browser storage when work is queued. Settings
  reports whether persistent storage is granted.
- **Fees → Payment setup** for Owner/Admin users: billing identity/address,
  invoice prefix and terms, optional GST, UPI receiving details, bank
  transfer details, and Razorpay/Cashfree public configuration/readiness.
- **Payment configuration validation/readiness:** GSTIN and seller-state
  prefix, GST rate and SAC/HSN, PIN, complete-or-empty bank details, account
  number, IFSC, UPI ID, Razorpay environment-specific public Key ID, and
  HTTPS webhook URL when a trusted webhook is marked configured. Recording a
  payment now warns when the selected UPI/bank/card route is not configured
  for invoices or automatic confirmation and links managers to Payment setup.
- **Themed invoice PDFs for dues and payments:** unpaid/partial invoices show
  balance, due date, bank instructions and a dynamic UPI QR for the exact
  payable total; paid receipts show receipt number/method/date/reference and
  hide the QR/payment instructions; void receipts remain visibly void.
  **Download PDF / Print** uses an A4 print stylesheet and the current
  Light/Dark app theme, with the document title set to the invoice/receipt
  reference for the browser's Save-as-PDF flow.
- **Admin-configurable GST:** GST can be off (retail format) or on with
  GSTIN, seller state, SAC/HSN, rate and GST-inclusive vs GST-added pricing.
  Invoices calculate taxable value and use CGST + SGST for intra-state or
  IGST for inter-state place of supply; a buyer GSTIN can be supplied for an
  individual PDF.
- **Synchronized billing profile:** one billing-settings record per
  organization is included in local-device snapshots and the signed-in
  offline snapshot/outbox, with the same idempotent push and manual
  version-conflict protection as other ERP data.
- Billing/sync/browser tests covering GST splits and rounding, UPI URI/QR
  inputs, gateway validation, corrupt-primary storage recovery, offline
  payment-setup sync, close warning, top Online/Offline states, invoice
  unpaid/paid behaviour and generation of a real PDF through Chromium print.

### Changed

- Payment recording is labelled **Record verified payment** and asks for a
  transaction reference where available. Manual UPI/bank/card entries must
  be verified outside the browser before being recorded. Recorded amounts
  are actual gross cash received; under GST-exclusive pricing, Fees/dashboard
  dues and payment defaults use gross payable totals and paid-receipt tax
  breakups are derived from the received amount.
- The old simple payment receipt dialog is replaced by the full due/paid
  invoice dialog. Membership rows expose **Invoice PDF** for outstanding
  balances; payment rows expose **Invoice PDF** after a receipt exists.
- If 1.4.0 reaches a database that has not yet been upgraded, an unsupported
  billing-settings operation stays safely queued with a setup-needed message
  instead of appearing as a data conflict; it can auto-sync after SQL v3 is
  installed.
- Project documentation was expanded to an industry-standard README and the
  ERP/version guides were refreshed for the complete feature and release
  history.

### Security

- Payment-gateway configuration stores **public identifiers only**. There is
  no field for, and the app must never be given, a gateway secret key or
  webhook secret. Version 1.4.0 does not launch gateway checkout or claim
  webhook-verified automatic confirmation; that requires a future trusted
  Supabase Edge Function/server phase.

### Database migration — SQL v3

- `supabase/erp_setup.sql` remains the single owner-run setup/upgrade file.
  SQL v3 adds `erp_billing_settings` (one row per organization), sync
  version/RLS/grant coverage, `billingSettings` in `erp_get_snapshot`, a
  manager-authorized version-checked billing applier in `erp_sync_push`, and
  the matching internal-function revoke.
- Re-run the **complete** file in the Supabase SQL Editor to upgrade. The
  migration is additive/idempotent and does not require deleting business
  rows. Deploy/run SQL v3 and complete live UAT before relying on shared
  billing settings in production.

### Dependencies

- Added the bundled `qrcode` package so dynamic UPI QR images are generated
  locally in the browser, including while offline; no external QR service is
  called.

## 1.3.0 — 2026-10-29

### Added — Offline-first Supabase sync, owner-authorized
- Signed-in Supabase ERP mode now keeps a per-user/per-organization device copy plus a durable operation outbox. Branches, students, instructors, batches, enrollments, attendance, plans, memberships and payments can be created or changed offline after one successful online sign-in and initial download.
- Changes sync automatically when the browser comes back online, regains focus, or the user chooses **Sync now**. Offline creates use client UUIDs and are pushed in dependency order (for example, branch → student → enrollment → attendance).
- SQL v2 in the single `supabase/erp_setup.sql` adds row `sync_version`s, an update trigger, an idempotent `erp_sync_operations` ledger, typed `erp_sync_push(jsonb)`, audit detail, and append-only payment status/void fields. Re-run the whole file in the Supabase SQL Editor to upgrade.
- Concurrent edits are never last-write-wins: stale device operations return as sync conflicts. The ERP toolbar shows pending/conflict counts and a review dialog; **Keep Supabase** discards the device change, while **Keep mine** reapplies only the fields changed on that device onto the current server record.
- Payments remain append-only. An offline payment shows **Pending sync** and receives its final `YS-YYYY-NNNN` receipt only from Supabase; a still-queued payment can be discarded, and a synced payment can be voided with a required audit reason instead of being edited/deleted.
- Sync unit tests, a mocked-Supabase Playwright offline→conflict→resolution test, and ephemeral-Postgres SQL checks cover coalescing, dependencies, idempotency, version conflicts, payment voids and snapshot versions.

### Notes
- The separate local-device ERP mode remains available and still does not sync. New sign-ins/password actions require internet; the signed-in offline copy is tied to the device browser storage and sign out on shared devices (a fully synced copy is removed on sign-out).
- Live Supabase UAT is still required after running SQL v2: one online download, one offline attendance + payment cycle, and a two-account concurrent-edit conflict check.

## 1.2.0 — 2026-10-29

### Added — Yoga Studio ERP (Core), owner-authorized
- Core studio ERP: multi-branch Branches, Students, Instructors, Batches with rosters/capacity, Attendance (present/absent/late), and Fees & Payments (INR plans, calendar-month or joining-date memberships, dues, manual payments and printable receipts).
- Role portals for Owner, Admin, Instructor and Student with branch filtering; dashboard KPIs, today's classes, expiring memberships and a first-run setup checklist.
- Two data modes behind one API: Supabase mode using only the typed `erp_*` RPC functions in the new single setup file `supabase/erp_setup.sql` (RLS-locked tables, per-call tenant/role checks, audit log), and an explicit offline local-device mode (empty by default, browser storage, JSON backup export/import) so the ERP works before/without Supabase and fully offline after the first visit.
- Light/Dark/System theme support ported from `feature_development` and extended across the ERP screens: pre-paint bootstrap, persistent per-device preference, OS-preference sync, top-bar/auth quick toggle, Settings picker, theme-color sync, and a printable receipt that remains light on paper.
- Unit tests for billing dates/money/attendance and a Playwright end-to-end test of the offline ERP flow. See `docs/12-erp-core/README.md`.

### Notes
- Supabase business features activate only after the owner runs `supabase/erp_setup.sql` and creates an organization in the app; live RPC/RLS/email behaviour still needs verification against the real project.
- PGlite was evaluated for offline storage and deferred; the local adapter keeps the same function-shaped contract so it can be adopted later without UI changes.

## 1.1.1 — 2026-10-15

### Security/configuration cleanup
- Removed the hardcoded project endpoint and project reference from current source, templates and documentation.
- Deployment configuration now comes from encrypted GitHub Actions secrets, with no public fallback in workflow/source.
- Browser/build guards reject administrative/service-role and user-session keys; account access stays disabled if configuration is missing or invalid.
- Added committed-source/built-artifact credential pattern checks and configuration-validation tests.
- Tightened environment/private-key ignore rules. Git history sanitization was requested by the owner and changes commit IDs; earlier documentation IDs refer to the pre-rewrite baseline.

Public client configuration still appears in an authenticated application's network traffic and compiled client when configured. It is not an administrative secret. Real backend secrets require a trusted server, not browser obfuscation.

## 1.1.0 — 2026-10-15

### Changed
- Product display name, document title, installation labels and PWA name are **Yoga Studio**.
- Version is sourced from the package manifest and shown on authentication/private footers and Settings.
- Browser regression tests exercise the Supabase SDK path through an isolated mocked provider; fixtures are test-only and not bundled.

### Removed
- Demo sign-in, local preview session bypass, demo labels, seeded profile names/emails, local demo profile persistence and demo-only styles.
- Dashboard access based on a locally stored demo flag.

### Migration and operations
- Startup removes known obsolete sample-data keys without deleting Supabase sessions or unrelated site data.
- Added patch/minor/major version-update commands, lockfile version checks and a documented release procedure.
- GitHub Pages workflow retains subpath/PWA checks and now runs the no-demo account regression suite.

### Configuration and verification limits
- Without a publishable/anon public Supabase key, auth forms show setup feedback; no private access or fake account is supplied.
- Real email delivery, production signup/login/recovery and server metadata still require actual provider testing.
- No new class-management, booking, notification or administration features were added.

## 1.0.0 — Historical baseline, 2026-10-15

- Initial responsive minimal account portal, Supabase integration code and GitHub Pages/PWA deployment.
- Included a clearly labeled local demo mode, now removed in 1.1.0.

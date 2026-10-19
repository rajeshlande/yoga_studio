# Yoga Studio — Feature Breakdown

> Companion to [`docs/11-management-plan/README.md`](11-management-plan/README.md). This document flattens the phased plan into an ordered feature list with complexity, dependencies, rough engineering effort and exit evidence for a single experienced full-stack developer.
>
> **Estimates are provisional** — not delivery promises. They include tests/security controls but exclude external approval delays and optional scope.
>
> **Legend:** Complexity: 🟢 Low · 🟡 Medium · 🟠 High · 🔴 Very high. Effort is calendar time for one developer with DB/security review available and part-time QA.

---

## Phase 0 — Setup & Foundation (already live ✅)

| # | Feature | Complexity | Depends on | Effort | Status |
|---|---|---|---|---|---|
| F0.1 | Supabase Auth — sign-up, sign-in, forgot-password, reset | 🟡 | Supabase project | 2–3 d | ✅ Live |
| F0.2 | Dashboard + Profile (name/bio) + Settings | 🟢 | F0.1 | 2–3 d | ✅ Live |
| F0.3 | Responsive sidebar / mobile drawer + accessibility (focus traps, keyboard nav) | 🟡 | F0.2 | 2 d | ✅ Live |
| F0.4 | PWA installability + offline app shell (service worker, manifest) | 🟡 | F0.1 | 2–3 d | ✅ Live |
| F0.5 | Light / Dark / System theme toggle | 🟢 | F0.2 | 0.5 d | ✅ Live |
| F0.6 | App version display (auto from `package.json`) | 🟢 | — | 0.5 d | ✅ Live |

---

## Phase 1 — Decisions & Groundwork  _(2–4 days)_

Must complete before any code lands for management features.

| # | Feature | Complexity | Depends on | Effort | What it is |
|---|---|---|---|---|---|
| F1.1 | Owner approval of P0/P1 contracts (authority, billing defaults, attendance windows, refund powers, retention) | 🔴 | Owner + accountant + security reviewer | 1–2 d | Sign-off on the governance, billing-golden-cases, retention, and readiness registers. **No code, but blocks everything else.** |
| F1.2 | Supabase project setup (dev/staging/prod separation), CI secrets, Pages Actions secrets | 🟡 | F1.1 | 0.5–1 d | Isolated projects, encrypted GitHub secrets for public anon keys. |
| F1.3 | Supabase Email-provider config, Site URL, redirect URLs (dev + prod) | 🟢 | F1.2 | 0.25 d | Already partially done for auth; extend for multi-env. |

**Phase 1 gate:** signed readiness register (APR-01…APR-12 at least partially approved), isolated test projects, documented Supabase setup.

---

## Phase 2 — Tenant & Security Foundation  _(10–15 days)_

The hardest and most security-critical phase. Lays down the database skeleton, authorization model and safety nets that every later feature stands on.

| # | Feature | Complexity | Depends on | Effort | What it is |
|---|---|---|---|---|---|
| F2.1 | Database schema layout: schemas `app_data` (private tables), `api` (user-facing RPCs), `private` (helpers/jobs) | 🟡 | F1.1 | 0.5 d | Schema separation + search-path lockdown; no public table endpoints. |
| F2.2 | Core tenant tables: `organizations`, `studios`, `organization_memberships`, `studio_memberships` | 🟠 | F2.1 | 1.5 d | Composite FKs, tenant scoping, active/accepted/pending/suspended lifecycles. |
| F2.3 | Role-assignment tables: `studio_role_assignments`, `studio_permission_grants` (for delegated Admin attendance) | 🟠 | F2.2 | 1 d | Explicit Admin `attendance.mark/finalize/correct` grants with valid-from/to and audit. |
| F2.4 | Global `profiles` table (identity/basic preferences — **no authoritative role**) | 🟡 | F2.2 | 0.5 d | Links to `auth.users`; migration of existing name/bio metadata in; no role column. |
| F2.5 | `invitations` + `audit_events` + `idempotency_requests` | 🟠 | F2.2, F2.3 | 2 d | Token hashing, expiry, acceptance flow; append-only audit; idempotency with SHA-256 request digest (required from the first business mutation). |
| F2.6 | RLS policies + security-helper functions (`is_owner_in_org`, `can_operate_org`, `admin_in_studio`, `owns_student`, `assigned_to_session`) | 🔴 | F2.2–F2.5 | 3–4 d | Default-deny; invoker/definer mode review; no BYPASSRLS; tenant isolation at the row level. |
| F2.7 | Trusted bootstrap: first-Owner provisioning (audited, operator-controlled, not from public signup) | 🔴 | F2.6 | 1–1.5 d | One-time Edge Function or SQL script; creates organization + first Owner membership with audit. |
| F2.8 | Last-Owner invariant lock (prevents removing/demoting the final Owner; Co-Owner does not count) | 🟠 | F2.6 | 0.5–1 d | Transactional lock on organization membership changes. |
| F2.9 | Invite/revoke staff Edge Functions (Owner/Co-Owner only, fresh auth, anti-escalation, idempotent) | 🔴 | F2.5, F2.6 | 1–2 d | Invite Admin/Instructor/Student; verify caller, target org/studio, role; send invite email; record audit. |
| F2.10 | Ownership transfer workflow (fresh auth, MFA-capable, recipient acceptance, audit) | 🔴 | F2.8, F2.9 | 1 d | Dedicated protected flow; not available via generic staff RPC. |
| F2.11 | Frontend: TypeScript migration (incremental, strict on), typed RPC client layer, auth context RPC | 🟠 | F2.6 | 2–3 d | `get_context()` RPC returning tenant/role memberships on cold nav; role-aware navigation derived from DB (not localStorage). |
| F2.12 | Frontend: Organization switcher, studio switcher, access-denied/error states | 🟡 | F2.11 | 1 d | Presentational only; all authority resolved server-side. |
| F2.13 | RLS/isolation test suite: two orgs, ≥2 studios, every role, multi-role identities, pending/suspended/revoked users | 🔴 | F2.6–F2.10 | 1–2 d | GOV-01–GOV-10 gates; concurrency tests for last-Owner. |

**Phase 2 gate:** all GOV tests pass; no cross-org/branch leakage; no privilege escalation; no business-table REST access exposed; bootstrap and invite flows verified in staging.

---

## Phase 3 — Studio Records & Enrollment  _(10–15 days)_

| # | Feature | Complexity | Depends on | Effort | What it is |
|---|---|---|---|---|---|
| F3.1 | `students` table + `student_contacts` + `consent_records` | 🟠 | F2 | 1.5 d | Studio-scoped student number, contact/guardian/emergency links; no medical/ID/bank data; restricted internal notes. |
| F3.2 | `instructors` table + `instructor_qualifications` | 🟡 | F2 | 1 d | Studio-scoped instructor number; linked verified identity; no salary/bank data. |
| F3.3 | `studio_rooms` (if/when multi-room) | 🟢 | F2.2 | 0.5 d | Optional; include from start if branches have multiple rooms. |
| F3.4 | Student & Instructor directories (typed read RPCs, keyset pagination, minimum fields per role) | 🟠 | F3.1, F3.2, F2.6 | 2 d | No whole-table dumps; Instructor sees only own roster minimum fields; Student sees only themselves. |
| F3.5 | Student/Instructor create/edit RPCs (role-scoped field allow-lists, audit, server actor/time) | 🟠 | F3.4 | 2 d | Owner/Co-Owner org-wide; Admin assigned-studio; Instructor no edit; Student own approved fields. |
| F3.6 | `membership_plans` + `membership_subscriptions` (groundwork — plans only, no billing yet) | 🟡 | F2, F3.1 | 1 d | Plan name, price in minor units (paise), currency (default INR), covered batches, billing policy selector. |
| F3.7 | `batches` table — versioned 60-minute recurring schedule, weekdays (0–6, unique/not null), instructor, room, capacity, effective dates | 🔴 | F3.2, F3.3 | 2 d | CHECK `duration = 60 min`; weekday array validation; schedule-conflict exclusion constraints across org. |
| F3.8 | `batch_enrollments` — effective-dated student↔batch membership with status, pause, reasons | 🔴 | F3.1, F3.7 | 2 d | Overlap prevention, capacity concurrency lock, enrollment history, seat policy. |
| F3.9 | Enroll/pause/withdraw RPCs (transactional, lock ordering, audit, stale-version conflict) | 🔴 | F3.8, F2.5 | 1.5 d | Returns safe patch/counts/revision for in-memory update (no full refetch). |
| F3.10 | Frontend: Student directory screens (Owner/Co-Owner/Admin), Instructor directory, Batch CRUD, Enrollment screen | 🟠 | F3.4–F3.9 | 2–3 d | Empty states, validation, confirmation, accessible forms, mobile layouts. |
| F3.11 | Concurrency / cross-branch / final-seat tests | 🔴 | F3.7–F3.10 | 1–2 d | Two simultaneous enrollments for last seat, cross-branch access attempts, instructor clash scenarios. |

**Phase 3 gate:** concurrent final-seat tests pass; no roster/contact fields leak to unauthorized roles; batches cannot overlap instructors/rooms; capacity is enforced under race conditions.

---

## Phase 4 — Class Sessions & Attendance  _(10–15 days)_

| # | Feature | Complexity | Depends on | Effort | What it is |
|---|---|---|---|---|---|
| F4.1 | `class_sessions` table with actual UTC start/end (exactly 60 min), instructor snapshot, capacity snapshot, status (scheduled/cancelled) | 🟠 | F3.7 | 1.5 d | Unique `(batch_id, local_date)`; timezone-aware local→UTC conversion; never auto-resurrect cancelled. |
| F4.2 | Idempotent session-generation job (rolling 28-day horizon, schedule versioned, duplicates blocked) | 🔴 | F4.1, F2.5 | 2 d | Server-managed identity; records `job_runs`; respects cancellations; handles batch schedule edits atomically. |
| F4.3 | Session edit/cancel RPCs (future-only by default, conflict check, audit) | 🟠 | F4.1, F2.6 | 1 d | Past-session edits → coordinated correction, not rewrite. |
| F4.4 | `attendance` table — eligible student × session, status (Present/Absent/Late), late_minutes, actor, timestamps, reasons, version | 🟠 | F3.8, F4.1 | 1.5 d | Composite FKs enforce same-tenant/batch/student; no silent deletes; append-only corrections in `attendance_changes`. |
| F4.5 | `get_today_attendance` RPC (one-call response: decided class, server time, marking window, counts, first roster page) | 🔴 | F4.4 | 2 d | Auto-select Today's Class; chooser if multiple; server-time checks (opens -10 min / closes +15 min default). |
| F4.6 | Mark/save attendance RPC (Instructor for own assigned session; Admin with `attendance.mark` grant; server window enforcement) | 🔴 | F4.5, F2.3 | 2 d | Eligible enrollment check; non-cancelled session; optimistic version concurrency; no pre-marking future. |
| F4.7 | Finalize RPC (reviews unmarked, does NOT auto-Absent, same window, revision check) | 🟠 | F4.6 | 1 d | Finalized = read-only summary + correction action. |
| F4.8 | Correction RPC (Instructor ≤24 h after end; Admin with `attendance.correct` ≤instructor cutoff; Owner/Co-Owner retained sessions always; reason required for Other) | 🔴 | F4.7, F2.3 | 2 d | Appends previous/new/actor/time/reason atomically; conflict on concurrent edits returns error. |
| F4.9 | Instructor portal UI: Today's Class auto-selected, roster one-tap, finalize, history, own corrections | 🟠 | F4.5–F4.8 | 2–3 d | Big touch targets; offline failure messaging; no queueing of marks offline. |
| F4.10 | Admin/Owner attendance view with filters, correction action, audit trail | 🟡 | F4.8 | 1–1.5 d | Delegated-capability banner for Admins. |
| F4.11 | ATT-01–ATT-17 tests: windows, delegation, corrections, cancellation, offline, concurrent finalize | 🔴 | F4.9–F4.10 | 2–3 d | Server-time boundary tests; Instructor/Admin/Co-Owner UAT. |

**Phase 4 gate:** every attendance acceptance test passes; Admin cannot correct without explicit grant; Instructor corrections respect 24 h cutoff; Owner/Co-Owner older corrections work; no silent Absent conversion; cancelled classes unmarkable.

---

## Phase 5 — Memberships & Monthly Billing  _(10–15 days)_

| # | Feature | Complexity | Depends on | Effort | What it is |
|---|---|---|---|---|---|
| F5.1 | Billing policy engine — calendar-month and joining-date monthly; half-open local-date periods; clamp day 29/30/31 to month end; Asia/Kolkata default timezone | 🔴 | F3.6 | 2–3 d | Must pass BIL-01–BIL-07 golden cases; leap-year safe; no anchor drift. |
| F5.2 | `memberships` table: one billed period with frozen plan/price/policy snapshot, period start/end, due date, currency (INR), amounts in paise (bigint), status | 🔴 | F5.1 | 1.5 d | Non-overlap constraints; immutable snapshot; status lifecycle separate from settlement. |
| F5.3 | Period-generation job (idempotent, configurable lead days, renews upcoming, prevents duplicates) | 🟠 | F5.2, F4.2 pattern | 2 d | Uses idempotency_requests; plan changes effective-dated (do not rewrite issued periods). |
| F5.4 | Proration for mid-month calendar starts (covered-days / days-in-month × charge; half-up rounding to paise) | 🟠 | F5.1 | 1 d | BIL-02–BIL-04. Joining-date default = full month unless policy says otherwise. |
| F5.5 | Dues/outstanding derivation (adjusted charge, net collected, outstanding — derived, not editable copies) | 🟠 | F5.2 | 1 d | BIL-09–BIL-13; reject overpayments; never clamp negative balance to zero; credits/liabilities explicit. |
| F5.6 | Plan management UI + subscription assignment UI (Owner/Co-Owner/Admin-delegated) | 🟡 | F5.1, F3.10 | 1.5–2 d | Plan switch effective-dated; one charge covers covered batches (not per-batch billing). |
| F5.7 | Student portal: my batches, timetable, membership periods, dues view | 🟡 | F5.5, F4.1 | 1.5–2 d | Read-only own data; no payment posting. |
| F5.8 | Pause/re-enrollment billing policy (default retain seat, no auto credit; approved exceptions) | 🟠 | F3.9, F5.2 | 1 d | BIL-15. |
| F5.9 | BIL golden-case tests + calendar edge-case tests (leap years, DST, day 29/30/31, overlap, duplicate generation) | 🔴 | F5.1–F5.5 | 1.5–2 d | Non-overlap, retry, anchor-drift fixtures. |

**Phase 5 gate:** BIL-01–BIL-16 pass; no period overlaps; money arithmetic uses integer paise; tax/discount/numbering placeholders ready for accountant sign-off.

---

## Phase 6 — Payments, Receipts, Reports & Exports  _(10–15 days)_

| # | Feature | Complexity | Depends on | Effort | What it is |
|---|---|---|---|---|---|
| F6.1 | `payments` table — append-oriented receipt facts: amount/paise, method (cash/UPI/card/bank), reference, received_at (server), actor, idempotency key, receipt number | 🔴 | F5 | 1.5 d | Method enum; verification source = manual (never claim provider verification); no silent edits. |
| F6.2 | Manual payment-posting RPC (lock ordering, invoice state/currency/tenant verification, receipt-number sequence, audit, idempotent) | 🔴 | F6.1 | 2 d | Reject overpayment; returns patch/revision; concurrency-safe receipt numbers. |
| F6.3 | `financial_adjustments` + `refunds` tables (separate positive records linked to original payment; Owner approval + reason by default) | 🔴 | F6.2 | 1.5–2 d | Concurrent refunds cannot exceed remaining refundable; credit without refund exposes liability; no hard delete. |
| F6.4 | Refund/credit/adjustment RPCs + approval workflow | 🔴 | F6.3 | 1.5 d | Request + approve pattern for Admins; direct approve for Owner/Co-Owner; audited. |
| F6.5 | Owner/Co-Owner financial overview dashboard (scoped, date-bounded, aggregate RPCs) | 🟠 | F6.2 | 2 d | Collections, outstanding, new enrollments, attendance summary; bounded date ranges; no N+1. |
| F6.6 | Student payments/receipts history + own receipt download | 🟡 | F6.2 | 1–1.5 d | Short-lived signed URL to generated receipt PDF in private Storage bucket. |
| F6.7 | Receipt PDF generation (Edge Function, server-authorized, template, no cross-tenant rows, audit) | 🟠 | F6.6 | 2 d | Formula-injection-safe if CSV; PDF rendering; short signed links. |
| F6.8 | Controlled export (CSV) for Owner/Co-Owner (justified, scoped, audited, rate-limited, async job for large exports) | 🟠 | F6.5 | 1.5 d | Export jobs + private storage; expiry; no unrestricted data harvest. |
| F6.9 | Admin payment-entry screen + receipts list | 🟡 | F6.2 | 1.5–2 d | Assigned-studio only; verifies manual entry; no silent delete. |
| F6.10 | Money/idempotency/audit/reconciliation tests; accountant/Owner review of posted data | 🔴 | F6.1–F6.9 | 2–3 d | Split payments, duplicate retries, partial refunds, overpayment rejection, receipt uniqueness. |

**Phase 6 gate:** no silent deletion; reconciliation/audit/idempotency tests pass; accountant sign-off on ledger behavior; exports logged and scoped.

---

## Phase 7 — Release Hardening  _(10–15 days)_

| # | Feature | Complexity | Depends on | Effort | What it is |
|---|---|---|---|---|---|
| F7.1 | Access/security review (RLS re-audit, secret scan, no service key in bundle, no private cache in SW) | 🔴 | All phases | 2–3 d | DBF-01–DBF-12; pattern scan; service-worker cache audit (no roster/payment/attendance caching). |
| F7.2 | Accessibility audit (WCAG contrast, keyboard nav, screen reader, focus traps, touch targets ≥44px) | 🟠 | All phases | 1.5–2 d | Automated axe + manual pass. |
| F7.3 | Load/performance benchmarks against proposed target profile (p95 read <500ms, mutation <1s; 25 concurrent users) | 🟠 | F7.1 | 2 d | Uses benchmark fixtures; records query plans, p50/p95/p99, Edge/DB time. |
| F7.4 | Five-role UAT (Owner, Co-Owner, Admin, Instructor, Student) across ≥2 branches | 🔴 | F7.1 | 2–3 d | Real-provider staging; real email flows; cross-tenant negative tests. |
| F7.5 | Backup/restore & rollback drill (DB + Auth + Storage; RTO/RPO evidence) | 🔴 | F7.1 | 1–2 d | Forward migrations preferred; destructive restore requires authorized downtime. |
| F7.6 | Monitoring/alerts/runbooks; incident owners on call | 🟡 | F7.3 | 1 d | Auth failures, policy denials, job lag/errors, payment reconciliation diffs, DB/Edge latency. |
| F7.7 | Final documentation sweep (runbooks, deployment docs, support docs, version bump, CHANGELOG) | 🟢 | F7.6 | 1 d | Bump minor/major per compatibility; Pages deploy workflow validated. |

**Phase 7 gate:** every quality gate (Section 12 of the plan) signed or formally blocked; named go-live approval.

---

## Deferred (out of scope unless separately approved)

These are **not** in the initial release; revisit only after core launch and with explicit Owner/privacy/provider approval.

| Feature | Complexity | Why deferred |
|---|---|---|
| QR code / student self check-in | 🟠 | Conflicts with the agreed instructor-marking workflow; collusion/spoofing risks. |
| Geofencing / biometric attendance | 🔴 | Privacy + reliability; platform support uneven. |
| Unofficial WhatsApp integration (OpenWA etc.) | 🔴 | Explicitly prohibited by project constraints. |
| Online payment gateway (Razorpay/Stripe/UPI) | 🔴 | Requires webhook signature verification, replay/out-of-order handling, provider account, reconciliation. |
| Automated reminders / push notifications | 🟠 | Provider setup, consent management, delivery guarantees. |
| Payroll / instructor compensation | 🟠 | Different legal/tax complexity. |
| Medical records / health questionnaires | 🔴 | Privacy/liability. |
| Family / shared wallets | 🟠 | Requires separate ledger design; credits/liabilities must be explicit. |
| Student self-booking / waitlists | 🟡 | Policy-heavy; capacity/eligibility edge cases. |
| Native mobile apps | 🔴 | Out of PWA scope. |
| Cross-organization financial consolidation | 🔴 | Tenants must remain isolated. |
| Offline private-data sync (roster/attendance cached offline) | 🔴 | Conflict resolution; PWA shell is already offline, but private writes are not cached/queued. |

---

## Effort Summary

| Phase | Rough effort (1 dev) | Cumulative |
|---|---|---|
| Phase 0 — Foundation (auth, dashboard, PWA, theme) | ~9 days | ✅ Done |
| Phase 1 — Decisions & groundwork | 2–4 days | ~2–4 d |
| Phase 2 — Tenant & security foundation | 10–15 days | ~12–19 d |
| Phase 3 — Records & enrollment | 10–15 days | ~22–34 d |
| Phase 4 — Sessions & attendance | 10–15 days | ~32–49 d |
| Phase 5 — Memberships & billing | 10–15 days | ~42–64 d |
| Phase 6 — Payments, receipts, reports | 10–15 days | ~52–79 d |
| Phase 7 — Release hardening | 10–15 days | ~62–94 d |

> **Total:** ~62–94 engineering days (~13–19 working weeks) for one experienced full-stack developer. Parallel staffing reduces calendar time but does not remove data/security dependencies.

---

## Recommended Order of Delivery

The phases must be built in order — later phases depend on the security/data foundation. However, within a phase, features can be parallelized if multiple developers are available.

**Recommended first post-foundation milestone (visible user value, smallest closed loop):**

1. **F2.1–F2.8** — DB schema, RLS, idempotency, last-owner lock (no UI yet)
2. **F2.9** — Invite flow
3. **F2.11–F2.12** — Frontend TS + RPC layer + org switcher
4. **F3.1–F3.5** — Student directory (create/edit/list)
5. **F3.7–F3.10** — Batches + enrollment
6. **F4.1–F4.9** — Today's Class + instructor attendance marking (highest-value operational win)
7. *(Then continue with billing, payments, reports, hardening.)*

This closes the "a studio can invite an instructor, set up a batch, enroll students, and mark attendance" loop — the heart of daily operations — in the shortest time, before tackling billing complexity.

# Phase 1 — Decision Checklist

> **Purpose:** Every item below must be approved (signature/date) before any database migrations, roles, or management-feature code lands. Each "Recommended starting position" reflects the plan v0.4 defaults — accept as-is, revise, or mark "defer," but do not leave blank.
>
> **How to use:** walk through top-to-bottom with the Owner; mark the **Decision** column (Approve / Change / Defer), fill in the **Approver / Date / Notes** columns. Items marked **🔴 BLOCKER** must be resolved before Phase 2 schema work begins. Items marked 🟡 can carry a provisional default into development with a follow-up review. Items marked 🟢 are already decided in the plan and just need formal sign-off.
>
> All phases after this depend on these decisions. Building ahead of sign-off means rework.

---

## 1. Authority & Security (APR-01) 🔴 BLOCKER

| # | Question | Recommended starting position | Decision (Approve / Change / Defer) | Approver | Date | Notes |
|---|---|---|---|---|---|---|
| 1.1 | **Role model** — five roles: Owner, operational Co-Owner, Branch Admin, Instructor, Student. Database-scoped assignments, never trust Auth metadata for privileges. | 🟢 Approve as specified | | | | |
| 1.2 | **Co-Owner exists** — selected by the Owner; organization-scoped operational access (staff, billing, reports, retrospective attendance corrections) but **cannot** appoint/remove/promote Owners or Co-Owners, transfer ownership, or change security policy. | 🟢 Approve as specified | | | | |
| 1.3 | **Last-Owner invariant** — at least one active accepted Owner must remain; Co-Owner does not count. Enforced by transactional lock on every membership change. | 🟢 Approve as specified | | | | |
| 1.4 | **Ownership transfer** requires fresh authentication, MFA, recipient verification, explicit acceptance, notification, and audit. No silent transfer. | 🟢 Approve as specified | | | | |
| 1.5 | **Admin attendance is NOT automatic.** Admin can mark/correct attendance only when explicitly granted `attendance.mark` / `attendance.finalize` / `attendance.correct` capability by Owner/Co-Owner for a specific studio window. | 🟢 Approve as specified | | | | |
| 1.6 | **No demo accounts / seeded data / auth bypass** in production (carried forward from v1.1.x). | 🟢 Already shipped | | | | |
| 1.7 | **Owner MFA** — mandatory (recommended). Admin MFA optional pending risk review. | 🟡 Mandatory Owner MFA | | | | |
| 1.8 | **First Owner bootstrap** — audited operator-controlled one-time procedure, never via public signup dropdown. Who performs the bootstrap? | 🟡 Named operator | | | | |
| 1.9 | **Multi-organization membership** — a user may belong to several organizations, but permissions never cross tenant boundaries. | 🟢 Approve as specified | | | | |
| 1.10 | **Multi-studio Org** — branches belong to one organization; no shared cross-organization student directory. | 🟢 Approve as specified | | | | |

---

## 2. Operational Defaults (APR-02) 🔴 BLOCKER

| # | Question | Recommended starting position | Decision | Approver | Date | Notes |
|---|---|---|---|---|---|---|
| 2.1 | **Initial currency** | 🟡 INR (₹), stored as integer paise (`bigint`) | | | | |
| 2.2 | **Studio timezone** | 🟡 `Asia/Kolkata` (IST, UTC+5:30, no DST) | | | | |
| 2.3 | **Class duration** | 🟡 Exactly 60 minutes (enforced by DB constraint) | | | | |
| 2.4 | **Attendance marking window (normal)** | 🟡 Opens **10 minutes before** class start, closes **15 minutes after** class end (server-time enforced) | | | | |
| 2.5 | **Instructor self-correction window** after class end | 🟡 **24 hours** (reason required for Other) | | | | |
| 2.6 | **Admin correction authority** | 🟡 Cannot extend beyond instructor cutoff; older sessions require Owner/Co-Owner | | | | |
| 2.7 | **Unmarked ≠ Absent** — finalization must NOT auto-convert unmarked students to Absent; staff must explicitly set each status. | 🟢 Approve as specified | | | | |
| 2.8 | **Cancelled classes** — cannot be marked; never auto-resurrect on session regeneration. | 🟢 Approve as specified | | | | |
| 2.9 | **Session generation horizon** (how far ahead to generate dated sessions from batch schedules) | 🟡 Rolling **28 days** (idempotent scheduled job) | | | | |
| 2.10 | **Default page size** for lists (students, batches, attendance) | 🟡 25 rows / max 100 per page (server paginated) | | | | |

---

## 3. Membership & Billing (APR-03) 🟠 Decide before Phase 4

These can be deferred until Phase 4 work begins, but flag if you want to change defaults *now* since they affect schema shape.

| # | Question | Recommended starting position | Decision | Approver | Date | Notes |
|---|---|---|---|---|---|---|
| 3.1 | **Billing models supported** | 🟡 Calendar-month **and** joining-date (anniversary) monthly — studio chooses per plan | | | | |
| 3.2 | **Calendar-month proration** for mid-month joins | 🟡 Prorate: `covered_days / days_in_month × monthly_charge`, rounded half-up to the paise. | | | | |
| 3.3 | **Joining-date month-ends** (anchor 29/30/31) | 🟡 Clamp to month's last day; calculate each boundary from original anchor (no drift to 28). | | | | |
| 3.4 | **Joining-date first period charge** | 🟡 Full monthly amount (no proration) unless a separate rule is approved. | | | | |
| 3.5 | **Tax applicability** (GST) | 🟡 Defer — no tax in v1; accountant to define applicability/rates before enabling. | | | | |
| 3.6 | **Discount sequencing** (apply before/after tax, stack order) | 🟡 Defer for accountant. | | | | |
| 3.7 | **Due date** for issued periods | 🟡 Period start date (configurable grace period to be defined by Owner). | | | | |
| 3.8 | **Overpayment handling** | 🟡 Reject payments exceeding amount due (no silent wallet; credit requires separate approved workflow). | | | | |
| 3.9 | **Refund policy** | 🟡 Owner approval required by default; refunds are separate positive records linked to original payment; concurrent refunds capped at remaining refundable amount. No hard delete. | | | | |
| 3.10 | **Write-offs / bad debt** | 🟡 Treated as credit adjustment with Owner approval + reason. | | | | |
| 3.11 | **Receipt/invoice numbering** (fiscal sequence) | 🟡 Single per-organization monotonic sequence with yearly reset; accountant to specify format (e.g., `YS-2026-00001`). | | | | |
| 3.12 | **Plan covers multiple batches** | 🟡 One subscription can cover multiple permitted batches; charge is per subscription, not per enrollment. | | | | |

---

## 4. Entitlements, Pauses & Seat Policy (APR-04) 🟠 Decide before Phase 3-4

| # | Question | Recommended starting position | Decision | Approver | Date | Notes |
|---|---|---|---|---|---|---|
| 4.1 | **Pause behavior** — by default, pausing a membership **preserves the seat** for the student; no automatic credit or charge reduction. | 🟡 Retain seat, no auto credit | | | | |
| 4.2 | **Seat release on pause** — only via explicitly approved operation (with reason/audit). | 🟡 Approved exception only | | | | |
| 4.3 | **Student timetable overlap** when enrolling | 🟡 Prevent by default; allow with approved exception + reason. | | | | |
| 4.4 | **Waitlists** | 🟡 Deferred (not in initial release). | | | | |
| 4.5 | **Makeup classes / catch-up sessions** | 🟡 Deferred. | | | | |
| 4.6 | **Multiple concurrent plans per student** (e.g., monthly + 10-class pack) | 🟡 Block within same product family to start; cross-family allowed if configured. | | | | |

---

## 5. Minors, Contacts & Privacy (APR-05) 🟡 Decide before launch; can start Phases 2-3 with "adults only"

| # | Question | Recommended starting position | Decision | Approver | Date | Notes |
|---|---|---|---|---|---|---|
| 5.1 | **Admit minors (<18)?** | 🟡 Block minors in initial release until guardian/consent workflow and privacy review approved. | | | | |
| 5.2 | **Collect emergency contacts?** | 🟡 Yes — name, relationship, phone; purpose-limited to emergency workflow; visible to assigned instructors during sessions. | | | | |
| 5.3 | **Collect medical / health info?** | 🟡 No — out of scope; medical dossiers add liability and are deferred. | | | | |
| 5.4 | **Collect government ID / Aadhaar?** | 🟡 No — not required for operations; privacy risk exceeds value. | | | | |
| 5.5 | **Collect bank / card details?** | 🟡 No — manual payments record only last-4 and reference; never PAN/CVV. Online gateway handles its own tokens later. | | | | |
| 5.6 | **Instructor pay / bank info?** | 🟡 Out of scope (payroll deferred). | | | | |

---

## 6. Payment Methods (Decide before Phase 6) 🟡

| # | Question | Recommended starting position | Decision | Approver | Date | Notes |
|---|---|---|---|---|---|---|
| 6.1 | **Initial payment methods** (manual) | 🟡 Cash · UPI · Card (manual entry / terminal receipt) · Bank transfer | | | | |
| 6.2 | **Require reference / proof photo?** | 🟡 Reference number/UTR optional but recommended; photo upload deferred. | | | | |
| 6.3 | **Online payment gateway** (Razorpay / Stripe / UPI collect) | 🟡 Deferred (Phase 8 / later) — adds webhook/signature/replay complexity. | | | | |
| 6.4 | **Automated reminders / receipts by SMS/WhatsApp/email** | 🟡 Deferred; unofficial WhatsApp (OpenWA) is explicitly prohibited. | | | | |

---

## 7. Retention & Erasure (APR-06) 🟠 Decide before launch

| # | Question | Recommended starting position | Decision | Approver | Date | Notes |
|---|---|---|---|---|---|---|
| 7.1 | **Retain attendance/financial records** how long? | 🟡 As required by applicable tax/business law (accountant to specify); propose **7 financial years** as starting point. | | | | |
| 7.2 | **Account erasure / "right to be forgotten"** | 🟡 Revoke access immediately; pseudonymize identity link; preserve legally required audit/financial facts via pseudonymous reference (no hard cascade delete of financial/attendance history). | | | | |
| 7.3 | **Auth account deletion** must neither silently cascade financial history nor fail against retained references. | 🟢 As specified | | | | |
| 7.4 | **Audit log retention** | 🟡 Same as financial records; append-only, never user-editable. | | | | |

---

## 8. Environment, Migration & Real-Provider UAT (APR-07, APR-08) 🔴 BLOCKER

| # | Question | Recommended starting position | Decision | Approver | Date | Notes |
|---|---|---|---|---|---|---|
| 8.1 | **Separate dev / staging / production Supabase projects?** | 🟡 Yes — never copy production personal data into tests/dev. | | | | |
| 8.2 | **GitHub Actions environments** — secrets configured for: dev / prod? | 🟡 Two sets of Actions secrets; Pages deployment uses prod. | | | | |
| 8.3 | **Existing users** (current v1.1.x sign-ups) | 🟡 Do NOT auto-promote to Owner/Admin. Map through approved invitation/import. Awaiting access until linked to a studio membership. | | | | |
| 8.4 | **Who performs first-Owner bootstrap on production?** | 🟡 Named operator (provide name and backup). | | | | |
| 8.5 | **Real email delivery test** — confirm signup/confirmation/recovery/invite emails deliver to a real mailbox on staging before launch. | 🟡 Required before launch | | | | |
| 8.6 | **Supabase plan / hosting region** | 🟡 Review Supabase Free/Pro tier limits vs expected load. Recommend `ap-south-1` (Mumbai) for INR/India user base if available. | | | | |

---

## 9. Performance, Cost & Recovery (APR-09, APR-10) 🟡 Pre-launch only

| # | Question | Recommended starting position | Decision | Approver | Date | Notes |
|---|---|---|---|---|---|---|
| 9.1 | **Target dataset** for performance benchmarks (proposed small → target → stress) | 🟡 Start: 2 orgs / 4 studios / 1,000 students / 30,000 attendance rows; Target: 2 orgs / 10 studios / 10,000 students / 500,000 rows. | | | | |
| 9.2 | **Performance targets** | 🟡 p95 list/dashboard reads <500ms; p95 transactional mutations <1s; LCP ≤2.5s; INP ≤200ms; CLS ≤0.1. | | | | |
| 9.3 | **Monthly spend ceiling + alert recipient** | 🟡 Owner sets budget and who gets Supabase billing / error alerts. | | | | |
| 9.4 | **RTO/RPO** (Recovery Time Objective / Recovery Point Objective) | 🟡 Tied to Supabase plan; daily backups; drill before go-live. Numeric targets to be agreed. | | | | |

---

## 10. Accountability & Named Approvers (APR-11) 🔴 BLOCKER

Fill in the name (or "Owner" for small setups) for each role. All can be the same person for a solo-owned studio, but they must be named.

| Role | Name / Contact | Date assigned |
|---|---|---|
| Product Owner (final business decisions) | | |
| Technical / DB migration lead | | |
| Security reviewer | | |
| Accountant / billing sign-off | | |
| Privacy reviewer | | |
| QA / UAT lead | | |
| Operations / on-call incident owner | | |
| Release approver (go/no-go for production pushes) | | |

---

## 11. Phase-0 Confirmations (already shipped — please confirm)

| # | Item | Confirm |
|---|---|---|
| 11.1 | Product display/PWA name = **Yoga Studio** (repo / package / Pages dir remain `yoga_studio`) | ✅ / ❌ |
| 11.2 | GitHub Pages URL = `https://rajeshlande.github.io/yoga_studio/` | ✅ / ❌ |
| 11.3 | Current release = **v1.1.2** (auth, dashboard, profile, settings, theme, PWA) | ✅ / ❌ |
| 11.4 | No demo account / no seeded data / no auth bypass in production | ✅ / ❌ |
| 11.5 | Supabase project URL and anon key stored in GitHub Actions secrets for CI/CD | ✅ / ❌ |

---

## 12. Out of Scope (reconfirm)

Confirm these remain **deferred** and should NOT be built in the initial management release:

| Feature | Defer? | Notes |
|---|---|---|
| QR / student self check-in | ✅ / ❌ | Conflicts with instructor-marking workflow |
| Geofencing / biometric attendance | ✅ / ❌ | Privacy + reliability |
| Unofficial WhatsApp integration (OpenWA, etc.) | ✅ / ❌ | Prohibited by project constraints |
| Online payment gateway | ✅ / ❌ | Needs webhooks/reconciliation; post-launch |
| Push notifications / automated reminders | ✅ / ❌ | Needs provider + consent |
| Payroll / instructor compensation | ✅ / ❌ | Separate complexity |
| Medical records / health questionnaires | ✅ / ❌ | Liability/privacy |
| Family / shared wallets | ✅ / ❌ | Needs dedicated ledger design |
| Student self-booking / waitlists | ✅ / ❌ | Policy-heavy; post-launch |
| Native mobile apps | ✅ / ❌ | PWA covers install use case |
| Cross-organization financial consolidation | ✅ / ❌ | Tenant isolation prevents it |
| Offline attendance roster marking (queued writes) | ✅ / ❌ | Conflict resolution; private data not cached |

---

## Sign-off

Once every 🔴 BLOCKER item is approved, Phase 2 can begin.

| Role | Name | Signature / Initials | Date |
|---|---|---|---|
| Owner | | | |
| Technical lead | | | |
| Accountant (billing items) | | | |
| Privacy reviewer (if separate) | | | |

### Notes / open questions captured during review:

<!-- Use this space for items that need further discussion before resolution. -->

1.
2.
3.

---

**Next step after sign-off:** scaffold Phase 2 migration directory, create `app_data`/`api`/`private` schemas in Supabase, and start with tables F2.1–F2.5 (organizations, studios, memberships, roles, idempotency, audit) — following the function-only data-access contract from the management plan.

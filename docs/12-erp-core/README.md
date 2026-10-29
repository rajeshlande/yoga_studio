# Yoga Studio ERP — Core (v1.2.0)

Implemented on 2026-10-29 at the owner's request. Scope chosen by the owner:
**Students + Batches + Attendance + Fees/Payments**, with **multi-branch**
support, **Owner / Admin / Instructor / Student portals**, monthly fees in
**INR**, mobile + desktop UI and offline support.

## What works today

| Area | Included |
|---|---|
| Dashboard | KPIs (active students, today's classes, collected this month, pending dues), today's class list, memberships expiring in 7 days, first-run setup checklist; role-specific cards for Instructor/Student |
| Branches | Add/edit/archive branches; per-branch student & batch counts; branch filter everywhere |
| Students | Add/edit/deactivate, search, branch, contact, joining date, batches, attendance %, CSV export |
| Batches | Instructors, recurring days + start time (60 min default), capacity, roster enroll/remove with capacity guard |
| Attendance | Date + batch picker (today's batch auto-selected), Present/Absent/Late per student, mark-all-present, history + CSV; students see only their own |
| Fees | Plans (₹, months), memberships with **calendar-month or joining-date** billing and price snapshot, dues (paid/partial/unpaid/expired), manual payments (cash/UPI/card/bank), auto receipt numbers `YS-YYYY-NNNN`, printable receipt, CSV export |
| Portals | Owner/Admin manage everything in scope; Instructor sees own batches + attendance; Student sees own batches, attendance, dues and payments |
| Appearance | Light/Dark/System theme from `feature_development`, adapted to every ERP screen, dialog, table and form; persisted as `ys-theme`, with pre-paint bootstrap and OS-preference sync |

Deferred ( unchanged from the management plan): online payment gateway,
automated reminders/messaging, payroll, QR/self check-in, expenses and
advanced reports.

## Data modes

The frontend talks to one module, `src/lib/erp/data.js`, with two adapters:

1. **Supabase mode (shared, multi-user).** All business reads/writes go
   through the typed `erp_*` RPC functions in
   [`supabase/erp_setup.sql`](../../supabase/erp_setup.sql) — the function-only
   policy from `CLAUDE.md` still holds; there is no direct table CRUD.
   Loads use one snapshot RPC; each action is one mutation RPC + one refresh.
   Tables are RLS-locked with no browser grants; functions re-check
   `auth.uid()`, organization and role per call and write audit rows.
2. **Local device mode (offline).** The same API implemented over browser
   storage (`src/lib/erp/localStore.js`). Works fully offline after the
   first visit (the PWA service worker caches the app shell as before).
   Enter from the sign-in screen via *"Use this device only — offline mode"*,
   or switch later in Settings. Data starts **empty** — nothing is seeded —
   and never leaves the device. Settings offers JSON **Export/Import/Clear**
   so the owner can back up before moving to Supabase.

Local-mode role switching is presentation-only (it previews each portal on a
single device). In Supabase mode the server scopes every response by the
signed-in user's role assignments, and the portal list is limited to the
roles returned by `erp_get_context`.

### Why not PGlite (yet)

PGlite (Postgres in WebAssembly) was evaluated for the offline store. It
would mirror the SQL schema locally, but adds a large WASM payload to a
GitHub Pages PWA and — more importantly — still needs a conflict/sync
protocol before local rows could merge safely into Supabase. The local
adapter therefore implements the *same function-shaped contract* over
browser storage today; its internals can be swapped for PGlite later
without UI or Supabase changes. Local data does **not** auto-sync to
Supabase; use Export as a backup, then re-create master data after
connecting (a guided import is a possible follow-up).

## Supabase setup (owner runs this)

1. Supabase project → **SQL Editor** → paste **all** of
   `supabase/erp_setup.sql` → **Run**. Re-running after updates is safe.
2. Ensure the app is built with `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (publishable/anon key only).
3. Sign in → **Settings → Data mode: Supabase**. On the dashboard, create
   your organization once (this account becomes Owner).
4. Grant Admin/Instructor/Student access with the commented examples at the
   bottom of the SQL file (the person signs up in the app first).

**All future table/function changes go into that one SQL file** (owner's
rule), keeping it idempotent and non-destructive.

## Verification

- `node --test tests/security-config.test.mjs tests/erp-logic.test.mjs` —
  unit checks incl. billing-date and money rules.
- `npm test` — plus Playwright: existing auth suite (unchanged behaviour)
  and `tests/erp-local.spec.js`, which drives the offline flow end to end
  (branch → student → instructor → batch → enroll → attendance → plan →
  membership → payment → receipt → reload persistence → mobile width).
- The Supabase path cannot be verified end to end until the owner runs the
  SQL in a real project; mocked/local tests are not proof of live RPC, RLS
  or email delivery. First production checks: bootstrap, two-account role
  scoping, and one payment/receipt cycle.

## Known limits of this release

- One snapshot returns the caller's visible records (bounded by role/branch
  scope). Add pagination before very large studios (thousands of students).
- Fees use a single amount per membership period; taxes, proration,
  discounts and refunds follow the accounting approvals still open in
  `docs/11-management-plan/`.
- Receipt printing uses the browser print dialog; no stored PDF receipts.
- Dates/times use the device's local timezone (studio default Asia/Kolkata).

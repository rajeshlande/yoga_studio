# Yoga Studio — Changelog

Version numbers follow semantic versioning. `package.json` is the authoritative application version.

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

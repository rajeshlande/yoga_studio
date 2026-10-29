# Yoga Studio — Changelog

All notable changes to Yoga Studio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).
`package.json` is the authoritative application version.

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

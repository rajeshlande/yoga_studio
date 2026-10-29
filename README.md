# Yoga Studio

A minimal, mobile/desktop-friendly PWA built with React, Vite and Supabase Authentication. **Current release: 1.3.0.**

Live application: https://rajeshlande.github.io/yoga_studio/

## Before working on this project

Read [CLAUDE.md](CLAUDE.md) before any codebase work, including exploration, planning, edits, tests and Git operations. It records the project constraints, Supabase function-only policy, verification commands and documentation references. Read it again at the start of each task or after a context reset, and whenever it changes.

## Scope

- Login, sign-up, forgot-password email and recovery-link password update.
- **Yoga Studio ERP (Core)** — multi-branch students, instructors, batches/rosters, attendance and INR fees/payments with Owner/Admin/Instructor/Student portals. Signed-in Supabase mode is offline-first: ERP changes save in a per-user device outbox, sync in dependency order when internet returns, and concurrent edits go to manual conflict review instead of last-write-wins. See [the ERP guide](docs/12-erp-core/README.md).
- After authentication: ERP dashboard, editable name/bio profile, read-only account email, settings, installation and logout.
- Responsive sidebar/mobile drawer, keyboard-focus handling, offline app shell, and Light/Dark/System appearance themes with a top-bar quick toggle and Settings picker (persisted per device).
- Visible application version, sourced from `package.json` (authentication footer, private footer and Settings).

**There is no demo account, demo sign-in, seeded user profile, local sample-data mode or authentication bypass.** Account pages require a Supabase session; without a configured public key, account forms display a setup message. There are two explicit offline paths: signed-in Supabase mode keeps a per-user/per-organization ERP snapshot and sync outbox after an online sign-in, while the separate **offline local-device mode** starts empty, never syncs and never grants access to account data (Settings can export/clear it). Supabase ERP tables/functions come from the single file `supabase/erp_setup.sql`, which the owner pastes into their Supabase SQL Editor. Test fixtures are isolated under `tests/`, mocked at the network boundary, and are not bundled in the app.

The product display/PWA name is **Yoga Studio**. The repository, npm package identifier and Pages deployment directory remain `yoga_studio`, preserving the live URL.

## Run locally

Use Node 22.

```sh
npm ci
cp .env.example .env.local
# Add the project's publishable / anon public key to .env.local.
npm run dev
```

Configuration:

```text
VITE_SUPABASE_URL=<SUPABASE_PROJECT_URL>
VITE_SUPABASE_ANON_KEY=your_public_publishable_or_anon_key
```

Never put a service-role/secret key, repository token or database password in browser configuration. `VITE_` values are visible in compiled assets. `.env.local` is ignored by Git.

Enable the Email provider in Supabase; configure confirmation and recovery delivery. Set Site URL and allowed redirect URL to `https://rajeshlande.github.io/yoga_studio/` (with the repository path) for production, and allowlist your development origin separately. Real delivery/authentication still needs testing with the actual configured project and mailbox.

## Version management

`package.json` is the single source of truth. Vite injects its version into the application. Use semantic versions and update the lockfile together:

```sh
npm run version:patch    # fixes: 1.1.0 -> 1.1.1
npm run version:minor    # compatible changes: 1.1.0 -> 1.2.0
npm run version:major    # incompatible changes: 1.1.0 -> 2.0.0
```

These commands update package files **without creating an automatic commit or tag**. Update `CHANGELOG.md`, run tests/build checks, review, then commit/push. See [the release/version guide](docs/05-development/version-management.md). Service-worker caches are automatically content-versioned separately; users do not have to clear storage to receive an updated release.

## Build and deploy

```sh
npm run build                 # domain-root hosting
npm run build:pages           # /yoga_studio/ GitHub Pages hosting
node scripts/check-pages.mjs
npm run preview -- --base=/yoga_studio/ --port 4174
```

The included `.github/workflows/pages.yml` builds, tests and deploys successful pushes to `main`. Repository Pages source must be **GitHub Actions**. Store the two public Supabase configuration values in encrypted **Settings → Secrets and variables → Actions → Secrets** before building. Re-run the workflow after configuration changes.

The worker/manifest/icons/auth redirects are subpath-aware. The service worker caches only the current app's static shell. After a successful online sign-in and first ERP download, signed-in ERP changes can be saved offline and sync later; new account authentication, password actions and profile updates still need internet. Passwords and Auth API responses are not cached by the app worker. Installation requires HTTPS/localhost and browser support; iOS installation is through Safari's Share menu.

## Testing

```sh
npx playwright install --with-deps chromium
npm test
# With the Pages production preview running:
node scripts/test-pages.mjs
```

Seven browser tests run on isolated development ports (including separate local-device ERP/theme flow and a mocked-Supabase offline → conflict → resolution sync flow), plus unit tests for ERP billing/money, sync coalescing/dependencies/conflicts/payments and theme helpers. Configured-flow tests use a test-only provider URL/key and intercepted responses; no test account is present in application code or deployed assets. The unconfigured test checks that legacy sample storage is removed and cannot authorize access. Mocked API tests are not proof of real Supabase email delivery or production authentication.

## Management expansion

The owner authorized the ERP **core** (Students, Batches, Attendance, Fees) on 2026-10-29; it shipped in 1.2.0, followed by offline-first Supabase sync/manual conflict review in 1.3.0 — see [docs/12-erp-core/README.md](docs/12-erp-core/README.md). The [consolidated management plan v0.4](docs/11-management-plan/README.md) still governs anything beyond that scope (gateways, reminders, payroll, advanced approvals), which remains unimplemented.

## Documentation

- [Current version and release process](docs/05-development/version-management.md)
- [Changelog](CHANGELOG.md)
- [GitHub Pages deployment](docs/08-devops-deployment/github-pages.md)
- [Essential project documentation](docs/README.md)

Some retained documents/evidence describe a historical pre-1.1.0 baseline; refreshed core guides and the consolidated plan are explicitly labelled. The latest release notes supersede its demo-mode statements; historical test evidence is retained as history, not current-release approval. Security/accessibility reviews, real-provider UAT and operational sign-off remain pending.

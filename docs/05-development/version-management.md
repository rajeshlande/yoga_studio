# Yoga Studio — version and release management

- Version: 0.2 of this guide
- Updated: 2026-10-29
- Status: Implementation guide; formal release approval remains separate
- Current application release: **1.4.1** (package.json is authoritative)

## Identity and source of truth

The visible product name is **Yoga Studio**. The repository/package/directory stays `yoga_studio` to preserve deployment paths. `package.json.version` is the only source of the app's semantic version. `package-lock.json` must agree. `vite.config.js` injects that value as `__APP_VERSION__`; `src/lib/version.js` exports it alongside `APP_NAME`. Neither needs manual version edits.

The version appears on the auth footer, private footer and Settings → Application version. It changes only when rebuilding a release with an updated package version. PWA name/title/icon labels use the product name. No updater screen, admin release dashboard, auto-refresh interruption or new product feature is introduced.

## Semantic version policy

- **PATCH:** backward-compatible bug fixes and small corrections.
- **MINOR:** compatible feature/behavior additions or approved product changes.
- **MAJOR:** incompatible behavior/data/API changes that require migration or coordination.

Release 1.1.0 removed the previous preview access mode and added app-version visibility and release management. Subsequent minor releases are recorded in `CHANGELOG.md`: 1.2.0 (ERP core), 1.3.0 (offline-first Supabase sync/conflict review) and 1.4.0 (payment setup, GST/UPI invoices and stronger autosync/data-safety behaviour); patch 1.4.1 fixes invoice PDF printing and app-wide form alignment without a database change. Version assignment is a maintainer policy; it does not constitute UAT/security approval.

```sh
npm run version:patch
# or npm run version:minor / npm run version:major
```

The commands use `npm version <level> --no-git-tag-version`. They update the manifest and lockfile but do not commit/tag automatically. Select exactly one suitable increment for a release; do not run all three. `node scripts/check-pages.mjs` verifies package/lockfile agreement and semantic version format after the production Pages build.

## Release procedure

1. Start from reviewed code and a clean working branch; increment the version once.
2. Update `CHANGELOG.md` with changes, removals, migration impact and unresolved configuration/testing constraints.
3. Run `npm ci`, `npm test`, `npm run build`, `npm run build:pages`, `node scripts/check-pages.mjs`, `npm run security:check`, the built-artifact security scan and the production Pages/offline smoke. If `supabase/erp_setup.sql` changed, also parse it with a PostgreSQL parser and execute it twice in an ephemeral Postgres/PGlite harness. The browser suite uses isolated mocked provider responses, not production credentials.
4. Review the build for unwanted sample accounts/data and verify display/PWA identity. Do not put fixture code into `src/` or `public/`.
5. Commit the package/lockfile, code, SQL and release notes together. Keep feature work on its reviewed branch; merge/push to `main` only with authorization and after the owner has the matching one-file SQL ready to run. The Pages workflow deploys from `main` only after its checks pass.
6. Verify the workflow and public URL, visible version, login gate, PWA and real provider flows using an approved account when configured.
7. Optionally create an annotated Git tag `v<version>` on the approved deployment commit. Tags/releases are not created automatically by the current workflow; avoid tagging unapproved failures.

## Data cleanup for 1.1.0

App startup deletes only old sample-state keys: localStorage `yoga-profile`, `ys-profile`, `ys-tasks`, `ys-prefs`, and sessionStorage `yoga-demo-session`. These values are not read to construct a user or grant access. Supabase sessions and unrelated site storage are not cleared. No Supabase user is deleted by this migration. Samples stored in a previous browser session cannot unlock the dashboard.

There are no bundled profile fixtures, sample accounts, local-data branches or demo-only CSS. Botanical SVG/leaf icons are decorative product branding, not demo records. Old Git commits and historical docs/evidence are retained for traceability; they are not executed or imported into the deployed app.

## Cache and rollback versions

Service-worker cache IDs derive from compiled assets plus worker/manifest content, independent of the semantic release label. They are scoped to the app path. Updated builds remove only older same-scope caches, not other Pages-project caches.

For rollback, restore the entire reviewed prior artifact or rebuild the intended commit/configuration. Prefer a new patch release for a revert that must appear as a new version. Never reuse an exposed credential or assume a lower semantic version alone forces an update. Verify existing tabs and offline behavior after rollback; real-device upgrade/rollback still requires validation.

## Limits

A missing public Supabase key means no account access, not an alternate demo flow. Real authentication, email, SQL/RLS, payment-invoice and offline-sync verification require the actual project and approved test accounts/devices. Mocked browser tests, parser checks and ephemeral Postgres runs are not live-provider UAT or security sign-off.

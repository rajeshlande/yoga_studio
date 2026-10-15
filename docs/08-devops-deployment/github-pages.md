# Yoga Studio — GitHub Pages deployment

- Project: yoga_studio
- Date: 2026-10-15
- Status: Implementation and local verification complete; remote release status must be checked separately
- Scope: Existing login/signup/forgot/reset, dashboard, profile, settings and PWA only. No new product features.

This release update supersedes earlier draft statements that root-only hosting is required, CI is absent, and app cache cleanup is unscoped. Historical evidence in the documentation package applies to baseline `92f42e3`, not this update.

## Public URL

Expected project URL after a successful Pages deployment:
`https://rajeshlande.github.io/yoga_studio/`

A repository push alone does not prove the website is live. The Pages workflow and deployed-origin smoke checks must complete. Branch protection or environment approval requirements may block deployment.

## One-time repository configuration

1. Repository **Settings → Pages → Build and deployment → Source → GitHub Actions**.
2. Under **Settings → Secrets and variables → Actions → Variables**, optionally set:
   - `VITE_SUPABASE_URL`: `<SUPABASE_PROJECT_URL>`
   - `VITE_SUPABASE_ANON_KEY`: the project's **publishable / anon public key**.
3. Only a public key belongs in client configuration. Never set a service-role/secret key or repository token in a `VITE_` value. These values are visible in the built application.
4. In Supabase Auth URL Configuration set Site URL and allowed redirect URL to **`https://rajeshlande.github.io/yoga_studio/`** (including the repository path). Keep required localhost/staging origins separately allowlisted. Enable Email and configure confirmation/recovery delivery.
5. Push to `main`, or use Actions → Deploy yoga_studio to GitHub Pages → Run workflow. Rebuild after any variable change.

Without the public key, the website can publish the authentication shell, but real account actions cannot work. There is no demo sign-in, seeded account, or private-access fallback in release 1.1.0. A successful static deployment is not verified signup/email recovery.

## Workflow

`.github/workflows/pages.yml` uses Node 22, a locked install, 5 account browser tests with isolated provider responses and no production credentials, the repository-path build, static artifact checks, and a production subpath/offline smoke. Only a successful build is uploaded and deployed. Deployment has `pages:write` and `id-token:write`; other permissions are restricted. GitHub supplies the workflow token; no personal access token is embedded.

```sh
npm ci
npx playwright install --with-deps chromium
npm test
npm run build:pages
node scripts/check-pages.mjs
npm run preview -- --base=/yoga_studio/ --port 4174
# In a second terminal:
node scripts/test-pages.mjs
```

Development and `npm run build` still work at `/`. `build:pages` selects `/yoga_studio/`; icons, manifest, SW registration and Auth redirects are base-aware. Screens are local state, so no deep-route rewrite or 404 hack is required. Do not change recovery callbacks to an origin-only URL.

## Existing-flow hardening in this update

- Whitespace-only signup name rejected; account emails trimmed.
- Provider errors mapped to safe user-facing messages rather than echoed verbatim.
- Expired/error callback links give neutral feedback and clear error URL fragments.
- Existing dialog/mobile drawer trap focus; dialog focus restoration regression tested.
- More legible foreground colors and mobile input size; no WCAG conformance claim.
- Manifest description no longer advertises removed classes.
- Offline caches are scoped by app path and build content; activation does not delete other project caches on the same github.io origin. Only static app resources are cached; Auth API requests are not cached by the worker.

## Rollback and constraints

Revert the offending commit and let the same workflow rebuild and deploy the complete artifact. Cache versions derive from assets, worker and manifest contents. Verify existing tabs, new tabs, offline reload, login/recovery redirects and profile saving after rollback. Retain the last-known-good commit and config record; never restore exposed credentials. Real-device upgrade/rollback and real Auth flows still require execution.

GitHub Pages does not provide a custom backend or per-site HTTP security-header configuration. Use provider-side Auth settings for protection; a host requiring configurable HTTP headers may be needed for a stricter security policy. Public Pages hosting does not make backend authorization optional. No custom tables or roles have been added. Security review, privacy/retention decisions, real email tests, UAT and formal go-live approval remain pending.

## Version 1.1.0 update

Visible/PWA name: **Yoga Studio**. Use the [version-management guide](../05-development/version-management.md) for release increments and old sample-storage cleanup. Test-only fixtures never enter the app bundle. Historical demo-mode statements elsewhere are superseded.

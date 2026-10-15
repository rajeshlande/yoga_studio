# Yoga Studio — Changelog

Version numbers follow semantic versioning. `package.json` is the authoritative application version.

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

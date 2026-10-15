# Yoga Studio — Changelog

Version numbers follow semantic versioning. `package.json` is the authoritative application version.

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

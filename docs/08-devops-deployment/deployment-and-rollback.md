# Environment, deployment, rollback, and release procedure

- Project: yoga_studio
- Document ID: YS-OPS-001
- Version: 0.1
- Status: Draft — not formally approved
- Author: Arena project assistant (code-derived draft)
- Proposed accountable owner: Release owner — assignment pending
- Reviewer / approver: Not assigned
- Created / last updated: 2026-10-15 (Asia/Calcutta)
- Classification: Internal
- Baseline: application commit `92f42e3`; repository `rajeshlande/yoga_studio`

## 1. Environments and architecture
Development: Vite local server, default missing-key demo. QA/staging: recommended separate static HTTPS origin and non-production Supabase project. Production: root-hosted static app plus production Supabase project; host/domain/owners not assigned. Preview servers are for development verification, not production infrastructure. There are no IaC/container/CI pipeline files in the current baseline.

Public configuration is built into assets; operational credentials belong only in approved build/hosting secret stores and must not use the `VITE_` prefix. Infrastructure, DNS, TLS issuance/renewal, monitoring, data residency, and capacity approval depend on the selected provider.

## 2. Release build procedure
1. Select reviewed commit/tag; confirm approvals and no secrets in tree/history/artifacts.
2. In an isolated environment, `npm ci`; set the two public Supabase variables for the target project.
3. Run `npm run build`, regression tests in a separate demo-mode build/environment, dependency/security checks, and configured staging auth tests. Current demo tests cannot be blindly run against the production-configured build.
4. Record artifact hash, source commit, runtime/tool versions, config identifiers (not secret values), test evidence and release owner.
5. Increment SW cache version for shell changes. Keep prior artifact and settings snapshot.
6. Upload `dist/` atomically to the selected HTTPS static host at `/`; do not deploy `node_modules`, source `.env`, dev server, or credentials.
7. Configure Supabase Site URL/redirect allowlist and email delivery for target origin through project administration.

## 3. Host configuration (proposed)
HTML and `sw.js`: revalidate/no-cache rather than immutable caching. Hashed `/assets/*`: long immutable caching if atomic deploy/rollback is guaranteed. Appropriate MIME types for manifest/JS/CSS/SVG. HTTPS required; validate TLS and expiry alerts. Define CSP/security headers with Supabase and font dependencies, test before enforcement. No specific DNS records, cloud resources, SLA, or certificate automation can be asserted yet.

Root routing is sufficient; screens are component state, not paths. Recovery uses origin URL/hash handling. Subdirectory/GitHub Pages deployment needs base-path/SW/manifest review and is not supported by the current root-relative assumptions.

## 4. Deployment verification
- [ ] Open fresh browser: Login, signup and forgot views render.
- [ ] Validate real login, confirmation, reset link/password update, profile persistence and logout using staging-approved account policy.
- [ ] Confirm no class/search/notifications UI or demo sign-in in configured production build.
- [ ] Check mobile navigation, profile/settings, console/network errors and accessibility smoke.
- [ ] Install or display appropriate guidance; verify production worker, offline shell and prior-worker update.
- [ ] Validate headers/TLS, correct Supabase project, safe error messages and no leaked credentials.
- [ ] Record artifact/version, operator, time, results, monitoring observation and approval.

## 5. Rollback
Triggers: login/recovery regression, wrong project configuration, widespread blank screens, broken SW upgrades, or security issue. Release owner authorizes or follows preapproved incident policy (not yet defined).

1. Pause further releases and preserve sanitized diagnostics.
2. Restore the previous complete static artifact and appropriate public config; never partially mix HTML/assets.
3. Ensure the rollback SW has a distinct new cache version and can activate; simply restoring an old cache name may not be sufficient. Retain required asset versions during transition.
4. Restore redirect/site settings only if changed, with admin approval and no credential rollback.
5. Verify fresh/existing tabs, real authentication/recovery, profile/settings, worker update and offline behavior.
6. Communicate impact and record root cause/fix. If emergency cache clearing is needed, warn users about lost local demo data and sessions.

No application database migration exists, so no custom schema rollback applies. Never reset or modify Supabase internal Auth tables ad hoc. Rollback is **not rehearsed**; rehearsal is a release gate.

## 6. CI/CD proposal and release notes
Proposed pipeline: reviewed PR → locked install → build → demo browser tests → dependency/secret/security checks → isolated auth integration stage → staging deploy → manual approval → atomic production deploy → verification. No pipeline is implemented by this documentation.

Current baseline release: auth-first minimal PWA; real SDK auth methods wired; dashboard/profile/settings; class board and extras removed. Known constraints: missing public key, real email flows untested, no production hosting/operations approval. Future notes must include commit/tag, changes, known issues, config changes, migrations if any, and rollback artifact.

## Document control

Source of truth: current code, `.env.example`, `package-lock.json`, and automated evidence where cited. Proposed controls are not statements of implementation. Approval and owner assignment are pending.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |

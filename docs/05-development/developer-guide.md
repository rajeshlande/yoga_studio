# Development, configuration, and repository guide

- Project: yoga_studio
- Document ID: YS-DEV-001
- Version: 0.1
- Status: Draft — not formally approved
- Author: Arena project assistant (code-derived draft)
- Proposed accountable owner: Technical maintainer — assignment pending
- Reviewer / approver: Not assigned
- Created / last updated: 2026-10-15 (Asia/Calcutta)
- Classification: Internal
- Baseline: application commit `92f42e3`; repository `rajeshlande/yoga_studio`

## 1. Local setup
Prerequisites: Git, a compatible Node/npm runtime, browser, and optional Supabase project public key. Use a currently supported runtime validated against the lockfile; the repo has no engines declaration.

```sh
git clone https://github.com/rajeshlande/yoga_studio.git
cd yoga_studio
npm ci
cp .env.example .env.local
npm run dev
```
Vite listens on `0.0.0.0` (normally 5173); use the URL printed by Vite. Local preview runs on 4173 by default. Development/preview host allowlists are broad for the sandbox environment; do not expose those servers as production hosting.

## 2. Configuration reference
| Variable | Default / requirement | Sensitivity |
|---|---|---|
| `VITE_SUPABASE_URL` | Falls back to the specified project URL | Public project identifier |
| `VITE_SUPABASE_ANON_KEY` | Absent by default; required for real Auth | Public publishable/anon key, never service-role/secret |

`VITE_` values are compiled into browser assets. Changing a host env value requires rebuild/redeploy. `.env.local` is ignored; `.env.example` contains no credential. Separate development/staging/production Supabase projects are recommended but not provisioned. Set Email provider, Site URL, redirect allowlist, and recovery delivery in the relevant project; SDK project config cannot be inferred from source.

## 3. Build and test
```sh
npm run build
npm run preview
npx playwright install --with-deps chromium
npm test
npm audit
```
Generated `dist/` and dependencies are ignored. Playwright starts/reuses the local dev server through `playwright.config.js`. Current tests require missing-key demo mode; run in an isolated test checkout with no real key. Do not accidentally point automated signup tests at a production project. `npm audit` is point-in-time dependency evidence, not a security sign-off.

## 4. Coding and review conventions (proposed)
Use descriptive React components/hooks; split auth services/screens before growth. Validate at boundaries, keep user data out of HTML injection sinks/logs, provide busy/error states, label controls, honor reduced motion, and never use editable metadata as role authority. Add tests for new behavior and update related requirement IDs. No lint/formatter/type-check pipeline currently exists; do not claim it ran.

Suggested review checklist: [ ] scope/acceptance met; [ ] no secrets; [ ] auth/data boundary maintained; [ ] accessible labels/focus; [ ] mobile/reflow checks; [ ] build/regression pass; [ ] dependency/security review; [ ] PWA version increment where required; [ ] docs/evidence updated; [ ] independent review recorded.

## 5. Git and pull requests
Existing changes were committed directly to `main`; branch protection and CI are not evidenced. Proposed workflow: short-lived `feature/<topic>` or `fix/<topic>` branch, PR to `main`, one independent reviewer, passing build/tests, no force push to protected branch. PR template should identify requirements, behavior, tests, screenshots where relevant, security/privacy effects, known issues, and rollback. Treat this as a recommended process until the owner enables enforcement.

## 6. Secrets and dependency hygiene
Do not place tokens in remote URLs, source, docs, screenshots, or logs. Use an approved OS credential manager/CI secret store for repository access. Revoke any exposed credential, including the previously chat-disclosed repository token; never reproduce it. Use `npm ci` for builds and review lockfile diffs. Review licenses and generate an approved SBOM before production if required; the lockfile and audit JSON are not substitutes for a complete SBOM.

## Document control

Source of truth: current code, `.env.example`, `package-lock.json`, and automated evidence where cited. Proposed controls are not statements of implementation. Approval and owner assignment are pending.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |

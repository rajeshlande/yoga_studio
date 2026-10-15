# Security checklist, threat model, privacy, and secrets procedure

- Project: yoga_studio
- Document ID: YS-SEC-001
- Version: 0.1
- Status: Draft — not formally approved
- Author: Arena project assistant (code-derived draft)
- Proposed accountable owner: Security reviewer / project administrator — assignment pending
- Reviewer / approver: Not assigned
- Created / last updated: 2026-10-15 (Asia/Calcutta)
- Classification: Internal
- Baseline: application commit `92f42e3`; repository `rajeshlande/yoga_studio`

## 1. Assets, trust boundaries, and threats
Assets: email/name/bio, passwords in transit, session/refresh tokens, repository credentials, static release integrity, recovery links, and provider account administration. Boundaries: browser ↔ static host, browser ↔ Supabase, provider ↔ email service, local storage ↔ scripts, and repository/build ↔ deployed assets.

| Threat | Existing protection | Required review / residual risk |
|---|---|---|
| XSS reads session tokens/profile | React text rendering; no intentional raw-HTML rendering in current UI | CSP/headers, dependency review, input/error handling and injection tests pending |
| Account takeover via recovery or redirect | Supabase Auth SDK and origin redirect configuration | Actual allowlist, token expiry, one-use behavior, recovery variants and delivery untested |
| Brute force / abuse | Provider supports settings; app busy state only | Confirm rate limiting, password policy, anti-abuse/SMTP controls; do not claim configured |
| Privilege escalation | No privileged app roles or custom data APIs | Do not rely on editable metadata; introduce RLS/server checks before data expansion |
| Local device exposure | Demo explicitly labeled; signout clears demo flag | Demo profile retained; SDK token persistence and shared-device behavior need policy |
| Supply-chain/release compromise | Lockfile and reproducible install; audit evidence | Branch protection, review, CI, secret scanning, SBOM/license review pending |
| Stale/offline release | Versioned SW cache and hashed bundles | Manual bump, upgrade/rollback test, cache deletion scope need review |

## 2. Access-control matrix
| Actor | Auth pages | Dashboard/Profile/Settings | Real own-profile write | Other users / administration |
|---|---|---|---|---|
| Visitor | Yes | No in normal UI | No | No |
| Explicit local demo | Login surface + demo flow | Local preview | No | No |
| Supabase member | Applicable auth flows | Yes | Authenticated metadata API | No app function; provider enforces identity |
| Project administrator | External provider console | No special in-app permission | External admin procedures only | External project access, not an app role |

Changing browser state can expose demo-like UI; it must never authorize backend data. The absence of a private screen is not sufficient security for an API.

## 3. Release security checklist
- [ ] Revoke the previously exposed GitHub token and review repository access/activity; no revocation evidence available.
- [ ] Use only publishable/anon public key in browser build; inspect artifacts/docs for secrets.
- [ ] Validate HTTPS, correct origin allowlists, secure email setup and password policy.
- [ ] Verify login/logout/refresh/recovery on staging; review project token/session settings.
- [ ] Configure/review CSP (including Supabase and font origins), frame policy, referrer policy, MIME sniffing protection, and HSTS when appropriate.
- [ ] Perform independent vulnerability/auth/privacy review; triage and verify fixes.
- [ ] Test keyboard, focus, contrast, and error accessibility.
- [ ] Protect repository and release permissions; configure monitoring and incident owner.
- [ ] Confirm backend authorization before adding any private application tables.

Checked evidence is limited to the build, demo tests, and point-in-time dependency audit. A formal vulnerability assessment or penetration test has **not** been performed.

## 4. Secrets handling and incident response
Public project URL/anon key are not admin secrets. Service-role keys, repository tokens, mailbox passwords, and refresh/recovery tokens are sensitive. Store operational credentials in approved secret stores; do not put them in Vite variables, docs, tickets, screenshots, or Git URLs. Use least privilege and short lifetime. If exposed: stop reuse, revoke/rotate at issuer, identify exposure scope, preserve sanitized evidence, review access logs, notify accountable owner, and verify recovery. Never paste the compromised value into an incident document.

For account takeover or hostile release: assign incident commander; contain by disabling affected paths/reverting release and revoking sessions as appropriate; rotate compromised credentials; preserve logs safely; assess user/legal notification needs with qualified reviewers; restore verified artifact; run auth/recovery/security smoke tests; close with root cause/actions. No 24/7 responder or response-time commitment currently exists.

## 5. Data classification, privacy, and retention
Public: branding, public project URL, browser-publishable key and static code. Personal/internal: email, display name and bio. Sensitive: passwords, tokens, recovery links and administrator credentials. Current app has no upload/medical/payment data and should not collect it via free-text bio.

No approved privacy notice, retention schedule, legal basis assessment, deletion/export process, DPA, consent mechanism, or compliance determination is supplied. Google Fonts introduces third-party requests; consider self-hosting and review applicable privacy disclosures. Analytics is not implemented. Supabase account records and backups require an administrator-approved retention/deletion policy. Local demo profile stays until site data is cleared. Browser site-data deletion does not delete provider records.

Applicable Indian or other privacy obligations must be assessed against actual users, controller location, processing and hosting; do not infer legal compliance or mandatory DPIA applicability from the developer's location. Obtain qualified advice where necessary. No legal compliance certification is made.

## Document control

Source of truth: current code, `.env.example`, `package-lock.json`, and automated evidence where cited. Proposed controls are not statements of implementation. Approval and owner assignment are pending.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |

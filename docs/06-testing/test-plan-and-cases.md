# Test strategy, plan, test cases, and UAT

- Project: yoga_studio
- Document ID: YS-QA-001
- Version: 0.1
- Status: Draft — not formally approved
- Author: Arena project assistant (code-derived draft)
- Proposed accountable owner: QA reviewer — assignment pending
- Reviewer / approver: Not assigned
- Created / last updated: 2026-10-15 (Asia/Calcutta)
- Classification: Internal
- Baseline: application commit `92f42e3`; repository `rajeshlande/yoga_studio`

## 1. Test scope and approach
Automate the demo UI regression suite in Chromium; manually/integration-test configured Supabase Auth, recovery email, browser compatibility, accessibility, security, PWA installation/update, and deployment/rollback. Current automation validates UI and local state, not real identity-provider responses. No custom API/database migration tests apply because those features do not exist.

Environment: isolated checkout, lockfile dependencies, Playwright Chromium, no public key for demo tests. Provider integration requires a separate non-production Supabase project, allowlisted test origin, disposable mailbox, and secure test-account credentials. Owners, UAT users, test calendar, and browser support approvals are pending.

## 2. Test data
Synthetic demo default: Alex Morgan / `alex@example.com`, local only. Automation uses Maya Patel / `maya@example.com` and a synthetic password in an unconfigured flow; it checks that the password is not persisted to localStorage. This does not authorize sending messages to those addresses. For real integration, use a mailbox controlled by QA and store credentials in the approved secret store. Never include real credentials or recovery links in reports.

## 3. Executable case catalog
| ID | Preconditions | Steps | Expected result | Execution |
|---|---|---|---|---|
| TC-01 | Fresh context, no key | Open `/#dashboard` | Login heading visible; private navigation absent | Automated T1 |
| TC-02 | No key | Signup, fill name/email/password, submit | Explicit not-configured message; no claimed account; password not saved | Automated T1 |
| TC-03 | No key | Login → forgot → submit email | Forgot screen and missing-key error; no false delivery claim | Automated T1 |
| TC-04 | No key | Explicit demo sign-in | Dashboard welcome and no class navigation | Automated T2 |
| TC-05 | Demo session | Profile → change name/bio → save → reload → Profile | Saved values retained, greeting updated | Automated T2 |
| TC-06 | Demo session | Settings → Reset password | Reset disabled; no network reset promised | Automated T2 |
| TC-07 | Demo, no install prompt | Settings → Install app → Escape | Instructions visible, then dismissed | Automated T2 |
| TC-08 | Demo session | Sign out → reload | Login restored; private navigation absent | Automated T2 |
| TC-09 | 390px viewport | Demo login; open drawer; Profile | Drawer navigation works; no document overflow | Automated T3 |
| TC-10 | 320px viewport | Profile then Settings through drawer | Both render without horizontal document overflow | Automated T3 |
| TC-11 | Built production, first online load | Wait for SW control; offline; reload | Login shell usable without network | Separate production smoke |
| TC-12 | Configured project, existing test user | Correct and incorrect login; reload; logout | Correct session persists, errors safe, logout removes access | Not run |
| TC-13 | Configured project, disposable mailbox | Signup; confirm email; sign in | Project confirmation policy respected; dashboard reached | Not run |
| TC-14 | Configured project and mailbox | Request reset; open valid link; update matching password; login with new password | Recovery view reached; old password no longer works | Not run |
| TC-15 | Configured project | Expired/malformed/reused recovery links, mismatched passwords, provider outage/rate limit | Safe recoverable error; no unauthorized password update | Not run |
| TC-16 | Real member | Save name/bio; new browser login; attempt unsupported email edit | Metadata persists server-side; email remains read-only | Not run |
| TC-17 | Target devices | Install, launch standalone, upgrade and rollback, offline revisit | Correct icons, stable shell, no stale release failure | Not run |
| TC-18 | Keyboard/screen reader/zoom | Navigate all views; check contrast, labels, errors, modal focus and reflow | Meet proposed WCAG 2.2 AA acceptance | Not run |
| TC-19 | Staging deployment | Inspect TLS/headers, tokens, cross-user access, injection and auth failures | Security control checklist verified; findings triaged | Not run |
| TC-20 | Representative mobile network/device | Measure LCP/INP/CLS and bundle/network behavior | Proposed performance targets met or exception approved | Not run |

T1/T2/T3 refer to tests in `tests/app.spec.js`; test names and exact assertions in source are authoritative. Some case rows map to portions of a single test; they are not separate independent automated tests.

## 4. Regression and entry/exit gates
Entry: agreed scope, stable build, isolated test data, test environment available. Regression: run all 3 tests after every code change; repeat production offline smoke after SW/build changes; repeat real auth after auth settings/client changes. No unit coverage tool is configured. Requirement mapping is in `../02-requirements/requirements-traceability-matrix.xlsx` and CSV.

Release exit: agreed test matrix completed, no unresolved critical/high security issue without signed risk acceptance, real auth and recovery verified, business UAT approved, deployment/rollback rehearsal passed, and support ownership assigned. Three green UI tests alone do not satisfy exit.

## 5. UAT checklist and record (blank for business completion)
[ ] New user signs up and confirms email. [ ] Returning user signs in/out. [ ] Forgotten-password journey completes. [ ] Own profile saves. [ ] Minimal dashboard accepted. [ ] Desktop/mobile readability accepted. [ ] PWA installation accepted. [ ] Privacy/account support understood.

Tester: **Pending**; environment: **Pending**; date: **Pending**; result: **Not executed**; defects/exceptions: **Pending**; approver and signature: **Not supplied**. Do not infer UAT approval from the development conversation.

## Document control

Source of truth: current code, `.env.example`, `package-lock.json`, and automated evidence where cited. Proposed controls are not statements of implementation. Approval and owner assignment are pending.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |

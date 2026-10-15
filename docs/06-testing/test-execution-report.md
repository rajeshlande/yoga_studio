# Test execution and quality status

- Project: yoga_studio
- Document ID: YS-QA-002
- Version: 0.1
- Status: Draft — not formally approved
- Author: Arena project assistant (code-derived draft)
- Proposed accountable owner: QA reviewer — assignment pending
- Reviewer / approver: Not assigned
- Created / last updated: 2026-10-15 (Asia/Calcutta)
- Classification: Internal
- Baseline: application commit `92f42e3`; repository `rajeshlande/yoga_studio`

## 1. Executed evidence
Execution date: 2026-10-15. App baseline: `92f42e3`; documentation-only additions do not change app behavior. Workspace Node 20.20.2 / npm 10.8.2; Playwright Chromium. No Supabase public key configured.

| Check | Actual result | Evidence |
|---|---|---|
| `npm run build` | Passed; Vite production build completed | [build.txt](evidence/build.txt) |
| `npm test` | Passed; 3 tests, zero failed, reported suite time 4.9s | [browser-tests.txt](evidence/browser-tests.txt) |
| `npm audit --json` | Completed; zero reported vulnerabilities at this run | [dependency-audit.json](evidence/dependency-audit.json) |
| Production offline login shell | Passed when re-executed for this documentation package | [offline-smoke.json](evidence/offline-smoke.json) |

Audit is dependency-advisory coverage only, not penetration testing or proof of no vulnerabilities. Timing is local execution evidence, not an SLA/performance benchmark. Raw tool logs may include terminal control sequences.

## 2. Coverage and exclusions
Verified by current browser suite: fresh-session gate, unconfigured signup/forgot forms, no synthetic password in localStorage, explicit demo login, local profile persistence, settings, install-help dismissal, logout, and 390/320px document overflow checks.

Not executed: real Supabase login/signup/confirmation/recovery, server profile persistence, cross-user authorization, MFA/abuse protections, provider outage integration, unit/code coverage, load testing, full cross-browser/device matrix, accessibility audit, native PWA installation, upgrade/rollback, security assessment, UAT. The RTM records these separately. No code coverage percentage or production acceptance percentage is asserted.

## 3. Defect handling and conclusion
Open risks and review findings are in `../01-project-management/risks-decisions-and-debt.md`. There is no claim that an independent review found zero defects. No defects were raised by the three executed tests; this does not close untested risks.

**Conclusion:** local UI/demo baseline is green. **Production release readiness: not established.** Key blockers are real Auth verification, credential revocation evidence, security/accessibility review, hosting/operations setup, and owner sign-off.

## Document control

Source of truth: current code, `.env.example`, `package-lock.json`, and automated evidence where cited. Proposed controls are not statements of implementation. Approval and owner assignment are pending.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |

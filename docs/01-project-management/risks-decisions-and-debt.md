# Risks, decisions, known issues, and technical debt

> Historical baseline below: demo-mode and old setup/test statements are not current instructions. For current app behavior see the project README and current requirements. For management risks, five-role permissions, acceptance cases and pending approvals use [the consolidated plan](../11-management-plan/README.md#governance-and-readiness). Historical test results are not rerun evidence.

- Project: yoga_studio
- Document ID: YS-PM-002
- Version: 0.1
- Status: Draft — not formally approved
- Author: Arena project assistant (code-derived draft)
- Proposed accountable owner: Technical maintainer — assignment pending
- Reviewer / approver: Not assigned
- Created / last updated: 2026-10-15 (Asia/Calcutta)
- Classification: Internal
- Baseline: application commit `92f42e3`; repository `rajeshlande/yoga_studio`

## 1. Risk and issue register
| ID | Type / priority | Finding | Action / accountable role | State |
|---|---|---|---|---|
| R-01 | Release blocker | Public Supabase key not supplied; real account flows unverified | Project admin supplies public key and test project access | Open |
| R-02 | Security / high | GitHub access token was disclosed in chat; not intentionally committed | Repository owner must revoke it, review activity, and use short-lived least-privilege credentials | Revocation not evidenced |
| R-03 | Security / high | Browser session storage is accessible to injected JavaScript; no app-specific security headers are configured in this repo | Maintainer implements/reviews XSS controls and hosting CSP/headers | Open |
| R-04 | Quality / medium | No independent accessibility audit; pastel text may have insufficient contrast | Measure contrast, keyboard and screen-reader behavior; fix findings | Open |
| R-05 | Compatibility / medium | Automated tests use Chromium only; real iOS/Android install and recovery journeys untested | QA performs target-browser/device matrix | Open |
| R-06 | Operations / high | Hosting owner, monitoring, backups, restore proof, incident contacts, RTO/RPO not agreed | Release/operations owners define and rehearse | Open |
| R-07 | Privacy / medium | Demo profile remains on device after logout | Disclose retention; consider explicit clear-local-data control | Open |
| I-01 | Content / low | Manifest description still mentions planning classes even though classes are removed | Update metadata in a reviewed code change | Open |
| D-01 | Maintainability / medium | Screens, state, and auth logic are concentrated in dense `src/App.jsx` | Split auth service, screens, shared components; add formatter/linting | Backlog |
| D-02 | Security/UX / medium | Error messages largely pass through provider text; no unified mapping or provider-failure integration tests | Introduce safe message mapping and failure-path tests | Backlog |
| D-03 | UX / medium | Installation dialog has initial focus and Escape close, but no explicit focus trap/restore | Implement and test accessible dialog behavior | Backlog |
| D-04 | Auth assurance / high | Recovery handling depends on hash marker/auth event; expired, PKCE, cross-browser, and invalid recovery links are unverified | Validate project auth flow and add recovery integration tests | Open |
| D-05 | PWA / medium | Activation deletes every other cache on this origin; immutable cached asset policy depends on manual version bumps | Namespace cache deletion; test upgrades and rollback on a dedicated origin | Backlog |

This is a code-review register, not a penetration-test report. Severity is a proposed prioritization, not a formal CVSS assessment.

## 2. Decision log
| ID | Decision | Basis / consequence |
|---|---|---|
| ADR-01 | Use React/Vite static SPA with Supabase Auth | Matches current source; no custom API server needed for initial scope |
| ADR-02 | App begins with authentication, not the dashboard | Latest requested scope; dashboard/profile/settings only render after session or explicit demo sign-in |
| ADR-03 | Keep demo clearly separate and disable it when configured | Demo stores no account password and must never be treated as backend authorization |
| ADR-04 | Store real profile name/bio in Auth user metadata | Avoid custom schema for initial scope; metadata is user-editable and unsuitable for privileged roles |
| ADR-05 | Use component state rather than client router | Only a small set of screens; current navigation resets to dashboard on reload; URL deep links not supported |
| ADR-06 | Production-only handwritten service worker | Lightweight offline shell; introduces manual update/versioning obligations |

## 3. Next backlog (proposed)
P0: Configure/test real auth, revoke exposed credential, assign release ownership. P1: auth recovery/error tests, accessibility contrast/focus, deploy/security headers, backup and rollback proof. P2: code refactor, lint/unit tests, CI, privacy/account-deletion workflow, metadata cleanup. No backlog item is approved or scheduled by this document.

## Document control

Source of truth: current code, `.env.example`, `package-lock.json`, and automated evidence where cited. Proposed controls are not statements of implementation. Approval and owner assignment are pending.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |

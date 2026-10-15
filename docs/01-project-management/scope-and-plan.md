# Business summary, scope, and delivery plan

- Project: yoga_studio
- Document ID: YS-PM-001
- Version: 0.1
- Status: Draft — not formally approved
- Author: Arena project assistant (code-derived draft)
- Proposed accountable owner: Product owner — assignment pending
- Reviewer / approver: Not assigned
- Created / last updated: 2026-10-15 (Asia/Calcutta)
- Classification: Internal
- Baseline: application commit `92f42e3`; repository `rajeshlande/yoga_studio`

## 1. Purpose and business outcome
Provide a simple, welcoming account portal for yoga_studio, using the supplied pastel dashboard reference as a visual direction. The current product is an account/PWA foundation, not a class-management system. The intended outcome is a responsive entry point where users can authenticate, view a minimal dashboard, maintain their profile, and access account settings.

## 2. Stakeholders and responsibilities
| Role | Proposed responsibility | Assignment |
|---|---|---|
| Product owner | Scope, business acceptance, prioritization | Pending |
| Technical maintainer | Code, builds, dependency updates, architecture | Pending |
| Supabase project administrator | Auth settings, redirect allowlist, email delivery, account operations | Pending |
| QA / security reviewer | Independent verification and release risk review | Pending |
| Release owner | Hosting, rollback, production approval | Pending |

The repository account owner is not automatically assumed to hold every operational role. No RACI approvals or support commitments have been supplied.

## 3. Scope baseline
Included: login, signup, forgotten-password request, password update after a recovery link, post-login dashboard, editable name/bio, read-only email, account settings, logout, responsive UI, and installable PWA shell. Real authentication uses the specified Supabase project after public-key configuration. A separately labeled local demo is available only without that configuration.

Excluded: classes, booking, payments, notifications, statistics, search, calendar, admin screens, staff/member permission tiers, uploads, custom database tables, native apps, and background jobs. These were deliberately removed or never implemented. New requests require scope review rather than implicit inclusion.

## 4. Delivery stages and acceptance gates
| Stage | Evidence / deliverable | Current state |
|---|---|---|
| Scope and UI foundation | Responsive auth-first app | Implemented; owner approval pending |
| Local verification | Production build and 3 browser tests | Passed on documentation date |
| Real authentication | Configured key, provider settings, email and recovery end-to-end tests | Blocked: public key not provided |
| Release hardening | Security/a11y/browser review, hosting and operational controls | Pending |
| UAT and release | Signed acceptance and deployment verification | Not performed |

Dates for remaining stages, budget, staffing, and launch are not committed. Dependencies: public key, project-admin access, deployment origin, email-provider configuration, reviewers, and release owner.

## 5. Change control and definitions
A change record must contain ID, requester, rationale, affected requirements, privacy/security impact, acceptance criteria, implementation owner, and approval. Record decisions in the risk/decision register.

**Ready:** scope understood, acceptance criteria agreed, dependencies available, test approach identified. **Done for implementation:** code reviewed, build and regression tests pass, related docs updated, secrets scan completed, known issues recorded. **Done for release:** additionally real Supabase verification, UAT, security review, deployment/rollback rehearsal, and release approval completed.

## 6. Success measures (proposed, not measured)
Users can complete supported account journeys without layout failures on target devices; authenticated profile changes survive reload; logout removes access to private UI; no non-scope features are visible. Business conversion, uptime, and engagement targets require owner agreement.

## Document control

Source of truth: current code, `.env.example`, `package-lock.json`, and automated evidence where cited. Proposed controls are not statements of implementation. Approval and owner assignment are pending.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |

# yoga_studio — Essential project documentation

**Version 0.1 · Draft · 15 October 2026 · Application baseline `92f42e3`**

This package follows the essential-document option from the supplied project checklist. Related documents are combined to avoid duplicate paperwork. It describes the current **auth-first minimal app**, not the removed class-management UI. Code-derived facts, executed test evidence, proposed controls and pending work are distinguished throughout. No approval, production deployment, legal compliance, penetration test or real Supabase integration result is invented.

## Start here

1. [Business scope and delivery plan](01-project-management/scope-and-plan.md)
2. [Requirements and acceptance criteria](02-requirements/srs-and-acceptance.md)
3. [Architecture / HLD / LLD](04-technical-design/architecture-hld-lld.md)
4. [Test execution status](06-testing/test-execution-report.md)
5. [Production readiness and approvals](10-signoff-closure/readiness-and-approvals.md)

## Documentation register

| ID | Document | Proposed owner | Status |
|---|---|---|---|
| YS-PM-001 | [Business summary, scope, and delivery plan](01-project-management/scope-and-plan.md) | Product owner | Draft / review pending |
| YS-PM-002 | [Risks, decisions, known issues, and technical debt](01-project-management/risks-decisions-and-debt.md) | Technical maintainer | Draft / review pending |
| YS-REQ-001 | [Software requirements and acceptance criteria](02-requirements/srs-and-acceptance.md) | Product owner | Draft / review pending |
| YS-UX-001 | [UI/UX, screen, and responsive specification](03-ui-ux-design/screens-and-design.md) | Design reviewer | Draft / review pending |
| YS-TECH-001 | [Architecture, high-level and low-level design](04-technical-design/architecture-hld-lld.md) | Technical maintainer | Draft / review pending |
| YS-TECH-002 | [Data dictionary, authentication API, and integration design](04-technical-design/data-and-auth-api.md) | Technical maintainer / Supabase administrator | Draft / review pending |
| YS-TECH-003 | [PWA and caching strategy](04-technical-design/pwa-and-caching.md) | Technical maintainer | Draft / review pending |
| YS-DEV-001 | [Development, configuration, and repository guide](05-development/developer-guide.md) | Technical maintainer | Draft / review pending |
| YS-QA-001 | [Test strategy, plan, test cases, and UAT](06-testing/test-plan-and-cases.md) | QA reviewer | Draft / review pending |
| YS-QA-002 | [Test execution and quality status](06-testing/test-execution-report.md) | QA reviewer | Draft / review pending |
| YS-SEC-001 | [Security checklist, threat model, privacy, and secrets procedure](07-security-compliance/security-and-privacy.md) | Security reviewer / project administrator | Draft / review pending |
| YS-OPS-001 | [Environment, deployment, rollback, and release procedure](08-devops-deployment/deployment-and-rollback.md) | Release owner | Draft / review pending |
| YS-USER-001 | [User guide and troubleshooting](09-operations-support/user-guide.md) | Support owner | Draft / review pending |
| YS-OPS-002 | [Operations runbook, support, backup, and recovery](09-operations-support/runbook-and-recovery.md) | Operations owner | Draft / review pending |
| YS-GOV-001 | [Production readiness, approvals, and handover record](10-signoff-closure/readiness-and-approvals.md) | Product owner / release owner | Draft / review pending |

## Structured tracker and evidence

- [RTM workbook](02-requirements/requirements-traceability-matrix.xlsx) — 20 functional/non-functional requirements, implementation references, test mapping, current verification and gaps.
- [RTM CSV](02-requirements/requirements-traceability-matrix.csv) — text-friendly copy for Git review.
- [Build evidence](06-testing/evidence/build.txt), [3-test browser result](06-testing/evidence/browser-tests.txt), [dependency audit](06-testing/evidence/dependency-audit.json), [offline smoke result](06-testing/evidence/offline-smoke.json).

## Essential checklist coverage

| Checklist area | Coverage / consolidation |
|---|---|
| BRD, charter, scope, plan | PM-001 business summary/scope/stages; dates and staffing pending |
| SRS/FRD, user stories, acceptance, NFR | REQ-001 and RTM |
| UI/UX, sitemap, flows, screen specification | UX-001; Mermaid diagrams render in compatible Markdown viewers |
| HLD/LLD, stack, data design/ERD/API/auth | TECH-001 and TECH-002; no custom schema to invent |
| Caching/PWA | TECH-003 |
| Coding/Git/review/configuration/build | DEV-001; recommended process distinguished from enforced tooling |
| Test strategy/plan/cases/data/report/regression/UAT | QA-001, QA-002, RTM and raw evidence |
| Security/threats/access/privacy/secrets | SEC-001; no independent security or compliance certification |
| Deployment/CI/environment/rollback/release notes | OPS-001; pipeline and production environment not provisioned |
| User/admin/support/backup/recovery | USER-001 and OPS-002; no in-app admin feature; external administration documented |
| Approvals/handover/closure | GOV-001; all formal approvals pending |

## Immediate next actions

1. Assign accountable reviewers/owners and approve scope/acceptance criteria.
2. Revoke the previously exposed repository credential; do not paste secrets into documents.
3. Configure the Supabase **public** key in a controlled environment and execute real login/signup/confirmation/recovery/profile/logout tests.
4. Resolve/review accessibility, recovery, caching, security and operational risks before release.
5. Select HTTPS hosting, rehearse rollback/restore, complete UAT and obtain explicit go-live approval.

## Maintenance rules

Update these docs with behavior/config changes. Keep requirement IDs stable and update the RTM and evidence together. Statuses remain draft until a named person actually approves. Dates, RTO/RPO, SLAs and signatures are not commitments until agreed. Store confidential personal/operational details outside public repositories. Do not include passwords, secret API keys, tokens or recovery links.

Terminology: **implemented** = code path exists; **verified** = identified test evidence exists; **approved** = named stakeholder recorded acceptance; **proposed** = not yet agreed/implemented; **blocked** = unmet prerequisite; **not run** = no execution evidence. These are intentionally not interchangeable.

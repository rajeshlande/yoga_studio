# Software requirements and acceptance criteria

- Project: yoga_studio / Yoga Studio
- Document ID: YS-REQ-001
- Version: 0.2
- Updated: 2026-10-16
- Status: Current-code description plus planned expansion; formal approval pending
- Code baseline: application 1.1.1 (`f72bee4`); management plan 0.4 is documentation only
- Accountable reviewer/approver: assignment pending

## 1. Current scope and functional requirements

These IDs remain stable. Table status is code/test mapping, not a new execution report or approval.

| ID | Requirement / acceptance | State |
|---|---|---|
| FR-01 | Fresh/unauthenticated session shows Login and no private navigation | Implemented; automated coverage exists |
| FR-02 | SDK email/password login; safe feedback and duplicate-submit protection | Implemented; mocked coverage; real-provider UAT pending |
| FR-03 | Signup trims/rejects blank name, validates inputs and handles confirmation | Implemented; mocked coverage; real mailbox pending |
| FR-04 | Recovery email uses neutral wording and safe errors | Implemented; mocked coverage; delivery pending |
| FR-05 | Recovery-link password update validates matching passwords and calls provider | Implemented; mocked coverage; real recovery UAT pending |
| FR-06 | Session-gated simple dashboard with profile/settings; no fake class metrics | Implemented; automated coverage exists |
| FR-07 | Own name/bio save; trimmed name <=80, bio <=250; email read-only | Implemented through Auth metadata; mocked persistence coverage |
| FR-08 | Settings show account/version, reset/install/logout controls | Implemented; automated coverage exists |
| FR-09 | Successful logout closes private access; failed logout not reported as success | Implemented; real session invalidation UAT pending |
| FR-10 | Historical demo access requirement | **Retired**; must not be reintroduced or repurposed |
| FR-11 | Mobile/desktop navigation, focus and reflow | Implemented; automated Chromium coverage; independent a11y/device review pending |
| FR-12 | Installable scoped PWA/static offline shell; no private-data offline queue | Implemented shell; native-device install/UAT pending |

No demo accounts, seeded data or missing-config bypass. Auth metadata and browser state never grant management authority.

## 2. Non-functional requirements

| ID | Requirement | Evidence boundary |
|---|---|---|
| NFR-01 | Responsive 320px–desktop | Automated coverage exists; target device matrix pending |
| NFR-02 | WCAG 2.2 AA target, keyboard/focus/reflow | Independent conformance review pending |
| NFR-03 | HTTPS/public browser keys only; no secrets in source/logs | Pattern checks exist, not a full security audit |
| NFR-04 | Lockfile reproducibility, Node 22, build/tests/Pages checks | CI and scripts exist; report actual run evidence separately |
| NFR-05 | Scoped offline shell; network failure does not fake a save | Static shell smoke exists; no private queue |
| NFR-06 | Measurable performance targets | Use workload/protocol in consolidated governance; targets unmeasured for management |
| NFR-07 | Explicit approved SLA/RTO/RPO/retention, not invented promises | Production decisions and drills pending |
| NFR-08 | Current desktop/mobile browser compatibility | Chromium automation exists; other browsers/devices pending |

## 3. Management requirements — specified, not implemented

| ID | Scope | Acceptance reference |
|---|---|---|
| MGT-01 | Organization operators vs branch staff isolation | GOV-01, GOV-02, GOV-05; DBF-03/04 |
| MGT-02 | Operational Co-Owner with Owner-only ownership/security | GOV-03, GOV-04 |
| MGT-03 | Phase 1 idempotency, audit atomicity and external recovery | GOV-06–GOV-09; DBF-08/11 |
| MGT-04 | Typed per-phase supporting schema/least privilege | GOV-10; DBF-02/04 |
| MGT-05 | Instructor-observed auto-class attendance, no student writes | ATT-01–ATT-17 |
| MGT-06 | Independent bounded Admin attendance capabilities | GOV-11–GOV-14; ATT-10 |
| MGT-07 | Both monthly policies and immutable exact-money billing | BIL-01–BIL-16; GOV-15 |
| MGT-08 | Audited manual payments/refunds and safe statements | BIL-09–BIL-16; DBF-08 |
| MGT-09 | RPC-only bounded reads/writes and measured workload | DBF-01–DBF-12; GOV-15 |
| MGT-10 | Existing-user/profile migration and failure reconciliation | GOV-08/09/16 |
| MGT-11 | Privacy/retention/restore/operational accountability | GOV-16; production decision register |
| MGT-12 | Phase entry/exit evidence, five-role UAT and approvals | Consolidated phase-readiness matrix |

All detailed definitions, fixtures and gates live in [the single management README](../11-management-plan/README.md). Do not maintain a second copy of permissions or billing defaults here. Use these IDs in reviews/tests/RTM. User-confirmed role direction is not execution evidence; accountant/privacy approvals and live management acceptance remain pending.

## Document control

Current code/package manifest govern implemented behavior; the consolidated management plan governs future specifications. Historical evidence is not a new test run or approval.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |

| 0.2 | 2026-10-16 | Arena project assistant | Current no-demo/Node 22/Pages baseline and consolidated management-plan references; no runtime changes |

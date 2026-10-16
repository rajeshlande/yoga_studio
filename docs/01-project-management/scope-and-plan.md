# Business summary, scope and delivery plan

- Project: yoga_studio / Yoga Studio
- Document ID: YS-PM-001
- Version: 0.2
- Updated: 2026-10-16
- Status: Current-code description plus planned expansion; formal approval pending
- Code baseline: application 1.1.1 (`f72bee4`); management plan 0.4 is documentation only
- Accountable reviewer/approver: assignment pending

## 1. Current business scope

Yoga Studio is an auth-first, responsive React/Vite PWA: signup/login, confirmation/recovery paths, minimal dashboard, editable name/bio, read-only email, settings, install help and logout. Private pages require a Supabase session. There is **no demo access, sample-data mode, seeded account or authentication bypass**. Missing public configuration disables real account actions; it does not unlock a preview identity.

GitHub Pages is the selected static host at `/yoga_studio/`; an Actions build/test/deploy workflow exists. Node 22 is the supported project runtime. Public configuration is supplied outside tracked source. Actual mailbox/provider UAT, independent reviews and release approvals remain distinct from mocked tests.

## 2. Planned management expansion

The [single consolidated management plan](../11-management-plan/README.md) defines future requirements, five-role permissions, typed core/support contracts, RPC-only data access, attendance, billing examples, phase gates and operations. Owner and **operational Co-Owner** operate across their own organization; only Owner controls ownership/security policy. Admin/Instructor/Student roles are branch-scoped.

Management features are not implemented by documentation. No database migrations, new runtime roles, collections, rosters or exports have been deployed. Gateways, messaging, QR/self-check-in and private offline synchronization are excluded unless separately approved; OpenWA remains rejected.

## 3. Delivery and accountability

Use [the phase-readiness matrix and decision register](../11-management-plan/README.md#governance-and-readiness), rather than a competing timeline. Phase 1 must prove tenant/RPC security, protected ownership, provisioning, audit and idempotency before operational features. The 62–94-day estimate is provisional, excludes optional work/approval delays, and must be reassessed after the foundation.

Owner approves business scope and mappings; technical/DB/security reviewers own constraints and isolation evidence; accountant approves billing/tax/numbering; privacy reviewer approves retention/minors/erasure; QA validates; operations/release lead owns recovery and release. Named assignments, signatures and support commitments remain pending.

## 4. Change control and completion

Preserve request/requirement IDs and record rationale, affected contracts, privacy/security impact, tests, rollback/recovery and approver. Documentation completion means specifications are coherent and linked. Implementation completion additionally requires code/migrations and executed tests. Production readiness additionally requires real-provider UAT, measured performance, restore evidence and actual approval. None is interchangeable.

## Document control

Current code/package manifest govern implemented behavior; the consolidated management plan governs future specifications. Historical evidence is not a new test run or approval.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |

| 0.2 | 2026-10-16 | Arena project assistant | Current no-demo/Node 22/Pages baseline and consolidated management-plan references; no runtime changes |

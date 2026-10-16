# Data dictionary, authentication API and integration design

- Project: yoga_studio / Yoga Studio
- Document ID: YS-TECH-002
- Version: 0.2
- Updated: 2026-10-16
- Status: Current-code description plus planned expansion; formal approval pending
- Code baseline: application 1.1.1 (`f72bee4`); management plan 0.4 is documentation only
- Accountable reviewer/approver: assignment pending

## 1. Implemented data and storage

Current data flows use Supabase Auth SDK, not custom business tables. Auth identity/email are provider-managed. Editable `user_metadata.full_name` (UI max 80, trimmed/nonblank) and `bio` (UI max 250) are profile display values, never authorization attributes. Session/profile drafts are in memory; SDK session persistence is separate from forbidden private business-result caching.

Startup removes obsolete sample-profile/session keys; those keys cannot authorize access. The service worker caches scoped static shell/assets, not Auth responses or private records. Its cache name is content-versioned, not a fixed historical cache label.

## 2. Auth SDK contract

| Action | Supported call / behavior |
|---|---|
| Initialize / subscribe | `getSession()` and `onAuthStateChange`; clean up subscription |
| Sign in | `signInWithPassword({email,password})` |
| Sign up | `signUp` with validated display name and base-path-aware confirmation redirect |
| Request recovery | `resetPasswordForEmail` with base-path-aware redirect; neutral success wording |
| Change password | `updateUser({password})` in authenticated/recovery flow |
| Save current profile | `updateUser({data:{full_name,bio}})` until approved business-profile migration |
| Logout | `signOut`; do not report success on a provider failure |

The SDK manages HTTP headers/key/token/session refresh. Do not print real identifiers, tokens or recovery links in documentation. Public URL/anon config is browser-visible by design; no privileged credential belongs in VITE variables.

## 3. Planned business schema and APIs

The [core dictionary](../11-management-plan/README.md#core-schema) now specifies nine core tables and **232** fields, including business `profiles.bio` for the existing biography migration. The [supporting contracts](../11-management-plan/README.md#supporting-contracts) define 24 supporting entities with per-phase scope, fields, integrity, indexes, access and deletion rules. These are not executable/applied migrations.

All business reads/writes use approved typed RPCs. [The governance contract](../11-management-plan/README.md#governance-and-readiness) specifies Owner/operational Co-Owner and branch roles, granular attendance delegation and Phase 1 idempotency. [The RPC catalog](../11-management-plan/README.md#database-functions) defines safe bounded responses and call budgets. Auth login/recovery/refresh remains Auth SDK, not a forced RPC wrapper.

Use one-time reviewed name/bio migration and staged cutover; do not dual-write Auth metadata and business profiles on every save. External provisioning ambiguity is durably reconciled before retry. Retention/erasure and last-Owner safeguards must be approved/tested before raw account deletion; no cascade of business/audit history.

## 4. Verification boundary

Automated tests include mocked provider responses and missing-config behavior, not real mailbox delivery or live RLS. Production provider/account UAT, management database tests, performance and recovery drills remain pending. Use the consolidated readiness register; never turn a described SDK/RPC path into a claim of executed integration evidence.

## Document control

Current code/package manifest govern implemented behavior; the consolidated management plan governs future specifications. Historical evidence is not a new test run or approval.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |

| 0.2 | 2026-10-16 | Arena project assistant | Current no-demo/Node 22/Pages baseline and consolidated management-plan references; no runtime changes |

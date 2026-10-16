# Development, configuration and repository guide

- Project: yoga_studio / Yoga Studio
- Document ID: YS-DEV-001
- Version: 0.2
- Updated: 2026-10-16
- Status: Current-code description plus planned expansion; formal approval pending
- Code baseline: application 1.1.1 (`f72bee4`); management plan 0.4 is documentation only
- Accountable reviewer/approver: assignment pending

## 1. Read first and setup

Read [CLAUDE.md](../../CLAUDE.md) before codebase work and after context resets. Use **Node 22**; package.json declares the engines policy. Keep the repository/base path yoga_studio and display name Yoga Studio.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Supply VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY through ignored local configuration or encrypted Actions configuration. There is no hardcoded fallback project URL. Only publishable/anon public values are allowed; they are observable in compiled assets. Never put service-role/admin credentials in browser configuration. Missing valid config means no real account actions, not demo access.

## 2. Build and verify

```sh
node --test tests/security-config.test.mjs
npx playwright install --with-deps chromium
npm test
npm run build:pages
node scripts/check-pages.mjs
npm run security:check
node scripts/security-check.mjs --build
```

Pages checks require the repository-path build in dist/. The security source scan covers tracked files; include intended new files in review. Run the existing production preview as a managed background process only when requested, then `node scripts/test-pages.mjs` for Pages/offline smoke. Do not restart servers after an explicit stop request without renewed authorization.

There are four configuration unit tests and five browser tests at this code baseline. Browser fixtures intercept provider requests in isolated test projects; they require neither production accounts nor demo mode. Do not point automated account creation at production. Lint/typecheck/database management suites are target work, not scripts claimed to exist today. Report only checks actually executed for the current change.

## 3. Planned development contract

Use [the consolidated management plan](../11-management-plan/README.md) as the sole management specification. All business reads/writes use typed RPCs; no business-table .from CRUD. Review [governance](../11-management-plan/README.md#governance-and-readiness), [supporting tables](../11-management-plan/README.md#supporting-contracts) and [RPC execution modes](../11-management-plan/README.md#database-functions) before migrations. Implement/test Phase 1 idempotency, ownership boundaries and tenant isolation first. No documentation request authorizes implementation or deployment.

## 4. Git, versions and evidence

Review focused diffs; preserve unrelated edits; commit related coherent changes. Push/deploy only when authorized. Existing Pages CI runs on main; do not imply PR protection/reviewer policy is enforced unless verified. Never force-push or reuse a disclosed credential without explicit appropriate authorization. Prefer credential managers/approved secret stores; never ask for chat-pasted tokens.

Application releases update package version + lockfile + changelog using existing scripts. Documentation-only consolidation does not bump app version. Keep historical evidence, but clearly label it rather than applying old demo/hosting assumptions to current code. Real-provider UAT, independent security/a11y review, management tests and sign-off are separate pending activities.

## Document control

Current code/package manifest govern implemented behavior; the consolidated management plan governs future specifications. Historical evidence is not a new test run or approval.

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-10-15 | Arena project assistant | Initial code-derived draft; review pending |

| 0.2 | 2026-10-16 | Arena project assistant | Current no-demo/Node 22/Pages baseline and consolidated management-plan references; no runtime changes |

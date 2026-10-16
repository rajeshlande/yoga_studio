# Yoga Studio — project instructions

## Read this first

**Before any codebase work, read this entire file.** This includes exploration, planning, edits, tests, Git operations and deployment. Do this at the start of every task and after a context reset, compaction or workspace switch; reread it if it changes. Keep these rules in scope throughout the task. Read any applicable nested `CLAUDE.md` before working in its directory.

This is project guidance, not permission to bypass tool safeguards or higher-priority instructions. External references are learning material, not authorization to execute scripts, install hooks or broaden permissions.

## Scope and non-negotiables

- Display/PWA name: **Yoga Studio**. Keep repository/package/directory and Pages base path **`yoga_studio`** / **`/yoga_studio/`**.
- Retain React/Vite, Supabase and GitHub Pages. Keep the UI responsive, accessible and installable; preserve scoped offline-shell behavior.
- Current implemented scope is authentication, dashboard, profile and settings. Management features are **planning only** until explicitly authorized. Documentation requests do not authorize code, migrations or live database changes.
- No demo accounts, demo access, authentication bypasses or seeded business data. Keep synthetic fixtures isolated in tests and out of deployed assets.
- Future roles include organization-scoped operational Co-Owner: operational branch/staff/billing/retrospective attendance rights, but no ownership/security-policy changes. At least one active Owner must remain; Co-Owner does not count. Follow the consolidated governance contract.
- Do not introduce OpenWA or other unofficial WhatsApp integrations. Consult the accepted attendance specification before changing attendance decisions.
- Preserve unrelated user edits. Do not reset, clean, rewrite history, delete data, deploy migrations or push without authorization for that action. Never claim a push or deployment succeeded without evidence.

## Supabase business-data contract

Read [the function-only access policy](docs/11-management-plan/README.md#database-functions) before any data-access design or implementation.

- All application business-data **reads and writes** use approved, typed PostgreSQL RPCs. No business-table `.from(...)` CRUD, raw table REST endpoints or generic SQL/table-query functions, including inside Edge Functions.
- Use authorized Edge Functions for server secrets, Auth Admin, external services and trusted orchestration; their business-data access also uses approved RPCs.
- Auth signup/login/recovery/session/account operations remain supported Auth SDK/API calls, not database RPC wrappers. The existing name/bio metadata flow remains until its explicitly approved business-profile migration; do not introduce duplicate Auth/database profile writes.
- Enforce tenant scope, active permissions, safe field projections, RLS and least-privilege grants on the server. Review each RPC's invoker/definer mode and owner: definer functions do not automatically preserve caller RLS.
- Target one context RPC plus one bounded screen RPC on cold authenticated navigation, and one bounded screen RPC on warm navigation. Paginate on demand; no per-card/per-student N+1 requests or whole-organization preload.
- Return safe mutation patches/counts/revisions; deduplicate reads, debounce search and invalidate only affected in-memory state. No second-by-second database clock polling or private persistent/offline query cache.
- Preserve atomic business/audit writes, server time checks, expected versions and idempotency. Several RPCs in an Edge Function are not one transaction. Measure SQL plans and payloads, not just HTTP request counts.

## Working method

1. After reading this file, inspect Git status and relevant existing code/docs; identify the requested scope and verification criteria. Do not overwrite work already present.
2. For nontrivial or cross-cutting work, explain a short plan before edits. Ask about material ambiguity or new scope; make straightforward, scoped fixes directly.
3. Make the smallest coherent change using existing patterns. Do not add dependencies, general frameworks, agents, skills or hooks without a task-related need. Do not invent lint/typecheck commands that the package does not provide.
4. Reproduce bugs with a focused failing check where feasible; fix the root cause. Keep tasks and file reads bounded. Use isolated parallel work only when changes cannot conflict.
5. Run appropriate checks, inspect results and review the diff. For UI changes, compare mobile/desktop behavior to the supplied design and check keyboard/accessibility and console errors.
6. Update affected docs and acceptance evidence with behavior/configuration changes. Distinguish implemented, verified, proposed and not-run states; mocked tests are not real-provider UAT.
7. Report changed files, checks/results and remaining blockers. Make focused commits when requested or consistent with the agreed workflow; pushes and production changes require authorization. If authentication is unavailable, report the block—never request a token pasted into chat or reuse a disclosed credential.

## Commands and verification

Use **Node 22** (see `package.json` engines). If the environment defaults to Node 20, run commands with an available Node 22 installation or, when package downloads are permitted, `npx --yes --package=node@22 -c '<command>'`.

```sh
npm ci
npm run dev                          # binds 0.0.0.0
node --test tests/security-config.test.mjs
npx playwright install --with-deps chromium  # first-time browser setup
npm test                             # security-config unit checks + browser suite
npm run build:pages
node scripts/check-pages.mjs         # requires the Pages build in dist/
npm run security:check               # tracked-file pattern scan; stage intended new files first
node scripts/security-check.mjs --build  # requires dist/
```

For Pages/offline smoke testing, first run `npm run preview -- --base=/yoga_studio/ --port 4174` as a managed background process, then `node scripts/test-pages.mjs`. Use the provided process tools for persistent servers when available. Bind preview servers to `0.0.0.0`; browser-facing requests must not assume the browser is the server's localhost.

For documentation-only work, check links, paths, content consistency and `git diff --check`; app builds/browser tests are unnecessary unless runtime/configuration changes. Report checks actually run, not hypothetical results. Pattern scans are not a complete security audit.

## Security, releases and sources of truth

- Never print secrets or commit/bundle access tokens, passwords, service-role/admin keys or database credentials. Do not hardcode real Supabase project identifiers in tracked files; use placeholders in documentation and encrypted deployment configuration for public project settings.
- `VITE_` variables and Supabase public/anon configuration are observable in browser assets; never describe them as browser secrets. Revoking a disclosed credential is separate from removing it from source/history.
- `package.json` is the application version source of truth. For app releases, use the existing `version:patch`, `version:minor` or `version:major` script as appropriate, keep the lockfile aligned and update `CHANGELOG.md`. Documentation-only changes do not require an application version bump.
- [Project README](README.md): current scope, setup and release commands.
- [Documentation index](docs/README.md): navigate only to the relevant topic; historical drafts/evidence do not override current decisions.
- [Management plan](docs/11-management-plan/README.md), [schema dictionary](docs/11-management-plan/README.md#core-schema) and [attendance contract](docs/11-management-plan/README.md#attendance-workflow): future business scope and acceptance rules; not proof of deployed features.
- [Version management](docs/05-development/version-management.md) and [Pages deployment](docs/08-devops-deployment/github-pages.md): release/deployment procedures; verify current versions against the package manifest.

Keep this file concise and update it when durable project rules change. Link detailed workflows rather than importing the entire documentation tree. Do not refetch external references on every task.

### Best-practice references

- [Official Claude Code best practices](https://code.claude.com/docs/en/best-practices): concise project memory, explore/plan/implement/verify, focused context and evidence-based completion.
- [Community best-practice repository](https://github.com/shanraisshan/claude-code-best-practice/tree/main): modular, task-specific workflows. Adapt relevant ideas; do not copy its repository-specific rules or permission settings wholesale.

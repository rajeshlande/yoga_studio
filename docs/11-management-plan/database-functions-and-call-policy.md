# Yoga Studio — Supabase function-only data access and call policy

- Document version: 0.1
- Updated: 2026-10-16
- Status: Required implementation direction; database/functions/UI implementation pending
- Applies to: the proposed multi-studio management system
- This update changes documentation only; it does not create or deploy database functions.

## 1. Mandatory rule

**Every application business-data read and write must use an approved Supabase PostgreSQL function exposed as a typed RPC.** Use Supabase Edge Functions for workflows requiring server secrets, Auth administration, external providers, private document delivery or trusted job orchestration. Those functions also call approved business-data RPCs; they must not reintroduce ad-hoc table CRUD.

Do not put business rules or raw database queries in UI components. Avoid unnecessary network calls by returning the data a screen needs in one bounded response and returning the changed state with a mutation. Fewer requests must never mean skipping authorization, returning extra personal data, removing audit records or sacrificing transactional integrity.

### Explicit exceptions

- Login, signup, password recovery, refresh and logout continue through **Supabase Auth SDK/API**. They are not application-table CRUD and must not be wrapped in a database RPC merely to satisfy this rule.
- Trusted Auth user provisioning uses the **Auth Admin API inside an authorized Edge Function**. The service credential never reaches Pages/browser assets.
- Approved private Storage delivery uses a trusted Edge Function and authorization-checked Storage operations. No database credential is involved in browser file transfer.
- Reviewed migrations, database tests, backup/restore tools and audited emergency DBA operations can execute SQL. They are not normal application runtime access paths.

No browser database connection string, service-role key, generic SQL endpoint or function accepting an arbitrary table name/query/filter expression is permitted.

### Existing profile migration

The current minimal app stores name/bio through Auth user metadata. When management tables are introduced, migrate approved profile values into the business `profiles` table and make `get_app_context` / `update_my_profile` the authoritative read/write path for those fields. Do not write the same business profile to both Auth metadata and the database on every save, or fetch both copies on every screen. Auth metadata remains untrusted for roles. Account email/password changes remain Auth provider operations. This is a planned migration, not a change already applied to the live app.

## 2. Schema and API boundary

Proposed physical layout:

| Schema | Content | Data API exposure |
|---|---|---|
| `api` | Small, approved, versioned business RPC surface | Exposed for explicitly granted RPC execution only; no base tables or unrestricted views |
| `app_data` | Nine core tables and scoped supporting tables | Not exposed through PostgREST/Data API |
| `private` | Authorization helpers and trusted internal job functions | Not exposed; execution narrowly granted |
| `auth` / Storage-managed schemas | Provider-managed identity/storage internals | Access only through supported provider APIs; do not modify internal schemas directly |

Table names in the planning dictionary are logical names. The reviewed migration will place business tables in `app_data`, not create unrestricted public table endpoints. `profiles` remains linked to Auth identity but its business-table access follows the same RPC rule.

Configure exposed schemas deliberately after verifying existing project dependencies; do not blindly remove an exposed schema needed by another application. Review any legacy public tables/views/functions separately. Test that ordinary and anonymous clients cannot call table endpoints or select an internal schema by changing a request header.

Frontend data service shape, illustrative only:

```ts
// Approved typed wrapper, not component-level table access.
const result = await supabase.schema('api').rpc('get_today_attendance', {
  p_studio_id: selectedStudioId,
  p_selected_session_id: selectedSessionId ?? null,
  p_cursor: null,
  p_limit: 25,
});
```

Arguments select a target, not authority. The function derives the actor from verified identity, checks active scope/permissions and validates every target relationship. A user-supplied role, organization ID or instructor ID is never proof of access.

## 3. Function security modes and grants

RPC-only access is an API boundary, not an automatic authorization mechanism. RLS remains enabled on business tables with explicit grants and tested policies.

- Prefer **SECURITY INVOKER** where the caller has the narrowly justified underlying schema/table/column grants required for the function and RLS enforces its rows. Hiding a schema from the Data API does not remove the need for SQL grants.
- Where broader internal access is necessary without granting it to the caller, use a reviewed **SECURITY DEFINER** function with fixed `search_path = ''`, fully qualified objects, fixed output fields and explicit active-user/tenant/capability checks.
- Do not say a definer function automatically runs under the caller's RLS. It uses the owner's database privileges; table owners or BYPASSRLS roles can bypass policies. Select function ownership deliberately. Where the design relies on RLS inside a function, use an appropriate non-login, non-BYPASSRLS executor distinct from table ownership, and policies that apply to that effective role. Verify the real execution path in integration tests.
- Keep authorization-helper privileges minimal and avoid circular RLS dependencies. Never expose an unrestricted security-definer helper that returns other tenants' records.
- Revoke default/PUBLIC EXECUTE on every business/helper function, including all overloaded signatures. Grant authenticated users only approved user RPCs; job-only functions are not executable by normal users. Anonymous business-data access is denied.
- A service-role call can bypass RLS. Reserve it for explicitly trusted server-only operations that separately validate the initiating user/tenant or trusted job scope. Do not use it as a universal shortcut for screen reads.
- Typed outputs must omit notes, contacts and financial exception fields unless authorized. Do not return `SELECT *`, whole table-row JSON or an unrestricted `SETOF` containing private columns.

The exact mode/owner/grant choice is recorded per RPC during migration review. Neither blanket definer ownership nor blanket table grants are acceptable defaults.

## 4. Screen-oriented read RPC catalog

Names below are proposed contracts, not existing endpoints. All responses are role/tenant scoped, bounded and limited to necessary fields.

| RPC | Purpose / bounded response | Network budget |
|---|---|---|
| `get_app_context` | Own approved profile, permitted organizations/studios/roles/capabilities and policy revision; no roster/finance preload | One after Auth establishes a session; reuse display context until invalidated |
| `get_dashboard` | Authorized summary for one selected scope/date range; bounded today/next-session summaries and aggregate totals | One on dashboard load; no separate call per card |
| `get_today_attendance` | Server time, scope, eligible session/next class or chooser, window/permission decisions, counts and first authorized roster page | One on Attendance load; selected session change is one explicit subsequent request |
| `get_attendance_history` | Paginated own/authorized history with safe class/student display and correction eligibility | One per page/filter change |
| `list_students` | Approved directory projection, stable cursor and page metadata | One per requested page, not one per student |
| `get_student_detail` | One student's safe overview plus bounded current enrollment/membership summaries; sensitive portions based on role | One for the overview; additional history pages only on demand |
| `list_instructors` / `get_instructor_detail` | Authorized staff directory/detail; no unrelated contacts/finance | One per page or explicit detail load |
| `list_batches` / `get_batch_detail` | Scoped schedule/capacity projections and bounded enrollment/session summaries | One per page or overview |
| `get_student_portal` | Own upcoming classes, current attendance/membership summary and safe outstanding/payment overview | One initial overview; history paginated separately |
| `list_memberships` / `get_membership_statement` | Scoped periods/dues or a bounded statement with string-serialized money and safe receipt references | One per list page/statement |
| `list_payments` | Authorized scoped collection/own history page | One per page/filter change |
| `get_settings` | Approved studio/user policy and editable-field capabilities | One when opening Settings; not every field |
| `list_audit_events` | Restricted, tenant/date/target-bounded, cursor-paginated audit projection | On demand only; not loaded on every page |

When a roster/history exceeds a page, return a cursor and fetch another page only when requested. Returning the first page is not permission to silently omit students: show total/unmarked indicators, loading controls and the current filter; finalization validates the entire eligible roster on the server. Do not download the whole organization to avoid pagination.

## 5. Mutation RPC and Edge Function catalog

| Operation | Approved path | Required result / invariant |
|---|---|---|
| Update own business profile | `update_my_profile` RPC | Allowlisted fields, expected version; saved safe profile returned |
| Manage student/instructor records | Scoped create/update/archive RPCs | Validated fields, identity-link restrictions, expected version, minimal updated projection |
| Change staff access / invite / ownership | Authorized Edge Function + scoped database RPC + Auth Admin API when necessary | Reauthentication/MFA where required; no self-escalation; last-Owner protection; external side-effect reconciliation |
| Configure studio/attendance policy | `update_studio_policy` RPC | Owner/delegated authority, validated policy, policy version, safe returned settings |
| Create/change a batch | `save_batch` RPC | Scope, version, 60-minute rule, recurrence/conflict/capacity checks; changed summary |
| Enroll/pause/withdraw | Dedicated enrollment RPCs | Locking and effective-date capacity/eligibility invariants; updated enrollment and capacity summary |
| Mark/correct attendance | `save_attendance_marks` RPC | One deliberate save or bounded explicit batch; reasons/windows/roles/versions; changed rows, counts, server time and new revision |
| Finalize attendance | `finalize_attendance` RPC | Entire eligible roster/version validated; preserve Unmarked; original finalization evidence and returned summary |
| Generate sessions/periods | Private job entry point + transactional business functions | Scoped idempotent generation; safe job summary, no browser job authority |
| Issue membership / change subscription | Dedicated membership/subscription RPCs | Immutable issued snapshots, non-overlap, original-anchor rules, updated statement summary |
| Record manual receipt | `record_manual_payment` RPC | One atomic posting, amount/currency/dues/receipt sequence/audit/idempotency checks; receipt and statement totals returned |
| Approve refund / financial adjustment | Dedicated Owner-controlled RPC, Edge verification if external provider involved | Locks, remaining refundable amount, immutable linked corrections, updated statement |
| Export / receipt generation | Authorized Edge Function -> business RPC -> private Storage | Scope/field restrictions, bounded work/job, safe short-lived authorized delivery and audit |
| Future gateway callback | Signed Edge webhook -> trusted posting RPC | Verified event/order/account/amount/currency; durable dedupe; never browser-success authority |

Keep business changes plus their audit events in the **same database transaction/function**. Several RPCs called in sequence from an Edge Function are not one atomic transaction. External Auth/email/payment/file operations cannot be made atomic with PostgreSQL simply by wrapping them in an Edge Function; use a state machine, outbox/idempotency and reconciliation for partial failures.

## 6. Attendance — avoid extra calls without adding steps

1. After session/context initialization, call `get_today_attendance` once. It computes server time, eligible class selection, marking/correction boundaries, effective permissions, counts and the first bounded roster page.
2. The UI uses returned time/boundaries to display a countdown; it must not query the database every second for the clock. A countdown is advisory; writes always re-check database time.
3. On a deliberate status save, call `save_attendance_marks` once. Return changed row versions, session attendance revision, counts, relevant server time and safe permission state. Patch the in-memory screen instead of rereading every student or the whole roster.
4. The planned instant-save interaction may make one request per saved mark. Do not hide unsaved marks merely to claim fewer calls. A future visible bulk Save can use a bounded array in one transaction, but it must show pending state and use explicit success/failure semantics.
5. Finalize uses one RPC with the expected session revision. It returns the summary; do not automatically reload profile, dashboard, settings and all histories afterward.
6. A stale-version conflict requires one targeted refresh and review; never silently retry by overwriting the other person's correction. Ordinary duplicate retries use the idempotency result, not another correction event.

Today’s Class refresh happens on actual session/branch change, relevant foregrounding or a controlled freshness interval. Proposed attendance fallback polling: no more than once per 60 seconds while visible when no invalidation mechanism exists. Back off after errors and stop when hidden. This is a configurable starting policy, not a guarantee of instant updates; authorize on every write regardless of screen freshness.

## 7. General request-efficiency rules

- Initial authenticated navigation: typically one context RPC plus one requested-screen RPC; Auth transport is counted separately. Do not add `get_role`, `get_profile`, `get_studio`, `get_instructor` and card-count calls in each child component.
- Deduplicate concurrent identical reads and cancel obsolete requests on scope/filter/navigation changes. Avoid accidental production refetch loops from effect dependencies or repeated component mounting.
- Default lists to 25, maximum 100; apply stricter domain-specific limits where needed. Use stable keyset cursors and allowlisted server sort/filter fields. Bound date ranges, search length, mutation batch sizes and payload bytes.
- Debounce search approximately 300–500 ms and reset/reuse cursors correctly. Fetch only the active tab; do not preload all students, payments and attendance history.
- Exact total counts are optional unless the screen needs them; expensive counts must be indexed/aggregated and tenant scoped. Never infer eligibility or finalization completeness from a partial page.
- Scope in-memory query keys by authenticated identity, organization, studio, effective role/context revision and parameters. Clear private memory/subscriptions on account/branch changes. No localStorage/IndexedDB persistence of student, attendance or financial results and no shared service-worker API cache.
- Reuse noncritical display context briefly; proposed ordinary directory freshness is 30–60 seconds. Never reuse cached authority to permit a write. Force targeted refresh after explicit access/policy changes and handle server rejection immediately.
- Mutations return the specific safe updated state and needed totals, not the full organization or unrestricted table rows. Refresh only related views on their next access or targeted invalidation.
- Aggregate dashboard joins/counts in reviewed SQL functions, not N+1 network requests. A single RPC can still be slow: inspect SQL plans, indexes, payloads, locks and workload. Fewer HTTP calls does not necessarily mean fewer database statements or lower cost.
- Do not duplicate authoritative persistent totals merely to avoid a query. If an aggregate cache is justified by measurements, define scope, invalidation, refresh, reconciliation and consistency expectations.
- Jobs process bounded batches with progress/checkpoints, tenant isolation and idempotency. Supabase cron invokes approved job functions/Edge entry points; it does not grant a browser a generic run-SQL API.

## 8. Consistency, errors and retries

User mutations require a bounded payload, server-derived actor, exact tenant/relationship validation and expected versions where relevant. Financial amounts cross the API as strings representing minor units. Choose locks/exclusions/unique constraints before performance shortcuts. Related writes and audit must commit or fail together; do not swallow an exception after a partial business write.

Use a scoped idempotency key and canonical payload hash for retryable mutations. Revalidate caller access before returning an old result; reject the same key with a changed payload. Durable domain uniqueness (payment provider event/receipt/period/session) remains even after a short-lived request cache expires.

Safe error contracts include `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_FAILED`, `STALE_VERSION`, `CAPACITY_FULL`, `SCHEDULE_CONFLICT`, `ATTENDANCE_LOCKED`, `DUPLICATE_REQUEST` and retryable service failure. Do not include SQL statements, internal table dumps, tokens or credentials in client errors.

- Retry eligible reads only with bounded exponential backoff/jitter; proposed maximum two automatic retries.
- Do not retry validation/permission/conflict failures automatically.
- Let the Auth SDK manage session refresh without building multiple competing refresh loops.
- Retry a mutation after uncertain network outcome only with its original idempotency key; first reconcile whether it committed. Do not create a second payment/correction with a new key.
- Offline attendance/payment writes show unavailable/unsaved, not a false success or an unapproved local queue.

## 9. API contract and observability

Record per function: name/API version, caller roles/capabilities, schema, SQL security mode/owner/grants, arguments and bounds, output fields and classification, error behavior, idempotency/version rules, transaction/lock strategy, indexes, timeout and expected call budget. Generate client types/contracts after approved migrations; breaking changes need a compatible versioned rollout.

Use safe correlation IDs and track function call count, p95 duration, payload sizes, lock waits, errors, retry count and repeated-call patterns by operation. Never log argument payloads wholesale, access tokens, personal notes or financial provider secrets. Edge egress to external services needs its own timeout/retry/reconciliation policy.

No arbitrary generic `execute_sql`, `read_table`, `update_any_record` or user-selected schema/table RPC is allowed. The central frontend service only calls an approved function-name allowlist; components cannot construct Data API URLs to bypass it.

## 10. Mandatory acceptance gates

| ID | Evidence required |
|---|---|
| DBF-01 | Source/network tests show no application-table `.from(...)` CRUD or raw table REST/SQL endpoint usage; Auth SDK is an explicit exception. |
| DBF-02 | Internal tables/schemas are not exposed by Data API, and anonymous/ordinary users cannot access them through schema/header/URL manipulation. |
| DBF-03 | Every user RPC rejects forged tenant/role/subject inputs; test suspended/revoked access and two organizations/branches. |
| DBF-04 | Per-function invoker/definer/owner/grants are reviewed; verify effective RLS behavior rather than assuming it. |
| DBF-05 | Cold dashboard/attendance uses context + one screen RPC; warm view one screen RPC; no per-card or per-student N+1 reads. |
| DBF-06 | Attendance save/finalize returns safe patches/counts/revisions; no whole-roster/profile refetch storm; server window checks remain authoritative. |
| DBF-07 | Pagination, bounded filters, sort/cursors and money serialization are tested with representative large datasets. |
| DBF-08 | Concurrency, audit atomicity, idempotency and ambiguous-network retries do not duplicate marks, enrollment, invoices, receipts or refunds. |
| DBF-09 | Read dedupe/backoff/foreground behavior and account/branch-switch memory isolation are tested; no private offline API cache. |
| DBF-10 | Query-plan/load evidence shows measured performance; a single expensive RPC is not accepted solely because its call count is low. |
| DBF-11 | Edge Functions keep secrets server-side, authorize entry, use business RPCs and reconcile external side-effect failure; service role is not a generic read proxy. |
| DBF-12 | Migration/config review confirms existing Auth/Storage/project dependencies are unaffected; implementation is verified in staging before production. |

**Status:** all DBF gates describe future work. This documentation does not claim they are implemented or tested against the live management database.

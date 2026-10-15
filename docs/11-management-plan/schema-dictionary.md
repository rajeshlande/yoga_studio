# Yoga Studio — Proposed Core Schema Dictionary

**Version:** 0.2 · **Date:** 2026-10-15 · **Status:** Proposed, not applied
**Confirmed scope:** multi-studio Owner; React/Vite + GitHub Pages + Supabase; calendar and anniversary monthly billing.

Read [the implementation plan](README.md) first. This dictionary contains field-level detail for the nine core tables. It is **not executable SQL or a claim of deployment**. Role authority belongs in organization/studio assignment tables, not `profiles.role`. Cross-table relationships must include organization/studio consistency. Supporting entities and assumptions appear below and in the workbook.

## Conventions

- `Required: Conditional` means the write workflow must enforce the stated lifecycle condition; it is not permission to omit evidence.
- Tenant composite keys/FKs are structural, not frontend filters. IDs, actors, scope and timestamps must not be spoofable.
- Dates and occupancy ranges use half-open intervals `[start,end)`. A session is exactly 60 elapsed minutes.
- Money uses positive/nonnegative minor units as applicable, never floating-point accounting. Derived dues/refund totals are not manually editable columns.
- Historical events/financial postings are retained. Do not use blanket cascades or generic soft-delete flags to conceal posted records.
- Optional personal/sensitive fields require purpose, minimum access and approved retention. No government ID, card data, bank credentials or medical dossier is proposed.
- Read/write notes are design intent and must become actual grants/RLS/RPC/projection tests; a table row by itself does not enforce them. RLS is row-level, not field-level: grant universally safe read columns only or use restricted tables/typed authorized RPCs for notes and contacts. Never rely on UI projections after granting unrestricted base-table SELECT.

## `profiles` — 12 proposed fields

| Field | Proposed PostgreSQL type | Required | Default / source | Validation / relationship / meaning | Classification | Permitted readers / writers | Phase |
|---|---|---|---|---|---|---|---|
| id | uuid | Yes | Verified Auth identity | PK/FK auth.users; account deletion uses an orchestrated retention workflow, not cascading business deletion | Identifier | Self; explicitly scoped provisioning service | 1 |
| full_name | text | Yes | User-approved value | Trimmed nonblank; proposed max 120; not a role or legal-identity proof | Personal | Self update via approved fields; scoped display projection only | 1 |
| preferred_name | text | No | None | Trimmed max 80; display preference | Personal | Self; minimum scoped directory view | 1 |
| phone_e164 | text | No | None | Normalize E.164 if needed; do not treat format validation as verification | Contact personal | Self and authorized contact workflow, not unrestricted directory | 1 |
| phone_verified_at | timestamptz | No | Trusted verification result | Server managed; null if no approved verification flow | Restricted | Self / authorized service | Later if verification enabled |
| locale | text | Yes | en-IN proposed | Approved BCP-47 locale; does not change financial snapshots | Preference | Self | 1 |
| preferred_timezone | text | No | Studio default in UI | Valid IANA timezone; studio schedule still uses studio timezone | Preference | Self | 1 |
| avatar_object_path | text | No | None | Private authorized path only; no external arbitrary URL; initials suffice initially | Personal | Self; scoped avatar delivery | Deferred optional |
| last_profile_reviewed_at | timestamptz | No | None | Optional user acknowledgment of current contact details | Internal | Self; server timestamp | 2 optional |
| created_at | timestamptz | Yes | Server now() | Immutable UTC timestamp | Internal | Self / authorized audit projection | 1 |
| updated_at | timestamptz | Yes | Server now() | Authorized update only | Internal | Self / authorized audit projection | 1 |
| row_version | bigint | Yes | 1 | Optimistic concurrency for profile edits | Internal | Self; server increments | 1 |

## `students` — 26 proposed fields

| Field | Proposed PostgreSQL type | Required | Default / source | Validation / relationship / meaning | Classification | Permitted readers / writers | Phase |
|---|---|---|---|---|---|---|---|
| id | uuid | Yes | Server generated | Primary key; add unique organization_id, studio_id, id for composite references | Identifier | Scoped roles; server-derived identity | 2 |
| organization_id | uuid | Yes | Authorized tenant context | FK organizations; together with studio_id must reference a real studio in this organization; immutable | Identifier | Tenant-scoped reads; validated RPC writes only | 2 |
| studio_id | uuid | Yes | Authorized branch context | Composite FK studios(organization_id,id); immutable; never trusted from client alone | Identifier | Assigned studio / Owner scope | 2 |
| created_at | timestamptz | Yes | Server now() | Immutable creation time in UTC | Internal | Scoped readers; server writes | 2 |
| created_by | uuid | Conditional | Server auth.uid() or approved job identity | Human actor required for interactive creation; system job uses explicit job context/audit | Internal | Authorized audit readers; server writes | 2 |
| updated_at | timestamptz | Yes | Server now() | Changed only by authorized mutation; do not let browser set timestamps | Internal | Scoped readers; server writes | 2 |
| updated_by | uuid | Conditional | Server actor | Last interactive actor; system changes also reference job/audit context | Internal | Scoped readers; server writes | 2 |
| row_version | bigint | Yes | 1 | Increment atomically; mutation supplies expected version; stale edit returns conflict | Internal | Scoped readers; validated RPC writes | 2 |
| profile_id | uuid | No until linked | Accepted trusted invitation | FK profiles and matching studio membership when linked; partial unique studio_id, profile_id; no arbitrary client linking | Identifier | Owner/Admin; self once linked; server-only link operation | 2 |
| student_number | text | Yes | Scoped sequence | Unique per studio; stable non-PII number; no authentication significance | Internal | Scoped Owner/Admin, assigned roster, self | 2 |
| registration_name | text | Yes | Admin/student-approved registration | Trimmed nonblank max 120; studio-specific record, not automatically overwritten by global profile | Personal | Scoped Owner/Admin, assigned instructor roster, self | 2 |
| preferred_name | text | No | None | Optional max 80; minimum roster display | Personal | Scoped Owner/Admin, assigned roster, self | 2 |
| contact_email | text | No | None | Operational contact only; may differ from Auth email; no authority to change login or link an identity | Contact personal | Owner/Admin and self; not instructor bulk lists | 2 |
| phone_e164 | text | No | None | Optional operational contact; approved self/admin changes and access rules | Contact personal | Owner/Admin and self; instructor only if explicitly justified | 2 |
| age_group | controlled enum | No | unknown | adult, minor, unknown; collect exact birth date only if approved eligibility/legal need | Personal | Owner/Admin and self; no broad roster exposure | 2 |
| joined_on | date | Yes | Studio-local registration date | Cannot be after departure; may predate login linking | Internal | Scoped Owner/Admin and self | 2 |
| status | record_status enum | Yes | active after approval | active, inactive; suspension of login is separate membership authority | Internal | Scoped roles as needed; admin RPC writes | 2 |
| ended_on | date | No | None | Local departure date >= joined_on; does not delete history | Internal | Owner/Admin and self | 2 |
| exit_reason | text | No | None | Controlled nonmedical reason; proposed max 250; no free-text sensitive dossier | Internal restricted | Owner/Admin only | 2 |
| emergency_contact_id | uuid | No | Approved contact record | Tenant/student-consistent FK student_contacts; minimum necessary relationship/number | Contact personal | Owner/Admin; emergency workflow only for instructors | 2 |
| guardian_contact_id | uuid | Conditional | Approved guardian record | Required by approved minor-admission policy; same student/tenant; not an unverified arbitrary person | Restricted personal | Owner/Admin and approved guardian/self workflow | 2 |
| admission_consent_id | uuid | Conditional | Recorded consent | FK consent_records matching student/tenant and notice version; keep consent history separately | Restricted personal | Owner/Admin and consent subject workflow | 2 |
| billing_contact_id | uuid | No | Approved contact record | Same student/tenant; use only for authorized billing communication | Contact personal | Owner/Admin and self | 4 |
| internal_notes | text | No | None | Short operational notes max 1000 proposed; forbid health/identity/payment secrets; restricted projection | Internal restricted | Owner/Admin only | 2 |
| archived_at | timestamptz | No | Owner/Admin action | Operational archive only; preserve attendance/financial/audit records and retention controls | Internal | Owner/Admin | 2 |
| archived_by | uuid | Conditional | Server actor | Required if archived_at set; reason captured in audit | Internal | Owner/Admin / audit readers | 2 |

## `instructors` — 24 proposed fields

| Field | Proposed PostgreSQL type | Required | Default / source | Validation / relationship / meaning | Classification | Permitted readers / writers | Phase |
|---|---|---|---|---|---|---|---|
| id | uuid | Yes | Server generated | Primary key; add unique organization_id, studio_id, id for composite references | Identifier | Scoped roles; server-derived identity | 2 |
| organization_id | uuid | Yes | Authorized tenant context | FK organizations; together with studio_id must reference a real studio in this organization; immutable | Identifier | Tenant-scoped reads; validated RPC writes only | 2 |
| studio_id | uuid | Yes | Authorized branch context | Composite FK studios(organization_id,id); immutable; never trusted from client alone | Identifier | Assigned studio / Owner scope | 2 |
| created_at | timestamptz | Yes | Server now() | Immutable creation time in UTC | Internal | Scoped readers; server writes | 2 |
| created_by | uuid | Conditional | Server auth.uid() or approved job identity | Human actor required for interactive creation; system job uses explicit job context/audit | Internal | Authorized audit readers; server writes | 2 |
| updated_at | timestamptz | Yes | Server now() | Changed only by authorized mutation; do not let browser set timestamps | Internal | Scoped readers; server writes | 2 |
| updated_by | uuid | Conditional | Server actor | Last interactive actor; system changes also reference job/audit context | Internal | Scoped readers; server writes | 2 |
| row_version | bigint | Yes | 1 | Increment atomically; mutation supplies expected version; stale edit returns conflict | Internal | Scoped readers; validated RPC writes | 2 |
| profile_id | uuid | No until linked | Accepted staff invitation | FK profiles plus matching studio membership; partial unique studio/profile; teaching portal requires active linked identity | Identifier | Owner/Admin; self; trusted link RPC only | 2 |
| instructor_number | text | Yes | Scoped sequence | Unique per studio; stable staff identifier, never a credential | Internal | Scoped Owner/Admin and self | 2 |
| registration_name | text | Yes | Staff-approved value | Trimmed nonblank max 120; student directory exposes approved display only | Personal | Owner/Admin, self; limited enrolled-student display | 2 |
| preferred_name | text | No | None | Optional max 80; roster/timetable display | Personal | Scoped display projection | 2 |
| contact_email | text | No | None | Operational staff contact; not Auth credential or login update | Contact personal | Owner/Admin and self | 2 |
| phone_e164 | text | No | None | E.164 format; contact visibility explicitly controlled | Contact personal | Owner/Admin and self | 2 |
| specializations | text[] | No | Empty list | Controlled taxonomy; bounded unique values; no unreviewed medical claims | Professional | Scoped Owner/Admin, self, approved student directory | 2 |
| public_bio | text | No | None | Optional approved max 1000; no private employment details | Professional | Approved studio directory; self/admin review | 2 |
| qualification_summary | text | No | None | Short professional summary; use instructor_qualifications for expiry/evidence if required | Professional | Owner/Admin and self; approved display subset | 2 |
| qualification_reviewed_at | timestamptz | No | Authorized reviewer | Does not itself prove credential authenticity; reviewer audit required | Internal | Owner/Admin and self | 2 conditional |
| status | record_status enum | Yes | active after approval | active/inactive; deactivation must resolve future assignments, not erase past sessions | Internal | Scoped reads; Owner/Admin writes | 2 |
| joined_on | date | Yes | Studio-local date | Employment/association start, not payroll data | Internal | Owner/Admin and self | 2 |
| ended_on | date | No | None | >= joined_on; assigned future-session handling required | Internal | Owner/Admin and self | 2 |
| internal_notes | text | No | None | Optional operational max 1000; no salary, tax IDs or bank credentials | Internal restricted | Owner/Admin only | 2 |
| archived_at | timestamptz | No | Authorized archive | Historical classes retain instructor snapshot and audit | Internal | Owner/Admin | 2 |
| archived_by | uuid | Conditional | Server actor | Required with archive; reason in audit | Internal | Owner/Admin | 2 |

## `batches` — 24 proposed fields

| Field | Proposed PostgreSQL type | Required | Default / source | Validation / relationship / meaning | Classification | Permitted readers / writers | Phase |
|---|---|---|---|---|---|---|---|
| id | uuid | Yes | Server generated | Primary key; add unique organization_id, studio_id, id for composite references | Identifier | Scoped roles; server-derived identity | 2 |
| organization_id | uuid | Yes | Authorized tenant context | FK organizations; together with studio_id must reference a real studio in this organization; immutable | Identifier | Tenant-scoped reads; validated RPC writes only | 2 |
| studio_id | uuid | Yes | Authorized branch context | Composite FK studios(organization_id,id); immutable; never trusted from client alone | Identifier | Assigned studio / Owner scope | 2 |
| created_at | timestamptz | Yes | Server now() | Immutable creation time in UTC | Internal | Scoped readers; server writes | 2 |
| created_by | uuid | Conditional | Server auth.uid() or approved job identity | Human actor required for interactive creation; system job uses explicit job context/audit | Internal | Authorized audit readers; server writes | 2 |
| updated_at | timestamptz | Yes | Server now() | Changed only by authorized mutation; do not let browser set timestamps | Internal | Scoped readers; server writes | 2 |
| updated_by | uuid | Conditional | Server actor | Last interactive actor; system changes also reference job/audit context | Internal | Scoped readers; server writes | 2 |
| row_version | bigint | Yes | 1 | Increment atomically; mutation supplies expected version; stale edit returns conflict | Internal | Scoped readers; validated RPC writes | 2 |
| code | text | Yes | Scoped business code | Unique per studio; stable reference | Internal | Authorized Owner/Admin, assigned instructor, own enrolled student | 2 |
| name | text | Yes | Admin input | Trimmed nonblank max 120 | Operational | Authorized branch participants | 2 |
| instructor_id | uuid | Yes | Scoped assignment | Composite FK same-tenant instructors; active/eligible instructor, approved identity linking | Identifier | Authorized branch participants | 2 |
| room_id | uuid | No | Studio default | Composite FK studio_rooms if rooms supported; physical capacity and overlap check | Operational | Authorized branch participants | 2 conditional |
| description | text | No | None | Approved plain text max 1000; no private roster information | Operational | Authorized branch participants | 2 |
| level | controlled text | No | all_levels proposed | Optional approved taxonomy; avoid expanding scope with unmanaged labels | Operational | Authorized branch participants | 2 optional |
| start_local_time | time(0) | Yes | Studio schedule input | Interpreted using studio IANA timezone; no browser-timezone conversion as authority | Operational | Authorized branch participants | 2 |
| duration_minutes | smallint | Yes | 60 | CHECK exactly 60; class_sessions also enforce end-start = 60 minutes | Operational | Authorized branch participants | 2 |
| days_of_week | smallint[] | Yes | Admin schedule | 1–7 unique non-null elements, each 0–6; Sunday=0; reject duplicates/nulls | Operational | Authorized branch participants | 2 |
| capacity | integer | Yes | Approved positive number | >0 and <= applicable room/policy limit; decrease cannot silently overbook active intervals | Operational | Authorized branch participants | 2 |
| effective_from | date | Yes | Studio-local date | Recurrence start inclusive | Operational | Authorized branch participants | 2 |
| effective_until | date | No | None | Exclusive boundary > effective_from; null means open-ended | Operational | Authorized branch participants | 2 |
| status | record_status enum | Yes | active after validation | active/inactive; inactive blocks new enrollment/generation under policy but preserves history | Operational | Authorized branch participants | 2 |
| schedule_version | integer | Yes | 1 | Increment for relevant recurrence edits; future session regeneration is explicit | Internal | Owner/Admin and jobs; scoped read where needed | 2 |
| archived_at | timestamptz | No | Authorized archive | Do not delete historical sessions/enrollments | Internal | Owner/Admin | 2 |
| archived_by | uuid | Conditional | Server actor | Required with archive; reason audited | Internal | Owner/Admin | 2 |

## `batch_enrollments` — 22 proposed fields

| Field | Proposed PostgreSQL type | Required | Default / source | Validation / relationship / meaning | Classification | Permitted readers / writers | Phase |
|---|---|---|---|---|---|---|---|
| id | uuid | Yes | Server generated | Primary key; add unique organization_id, studio_id, id for composite references | Identifier | Scoped roles; server-derived identity | 2 |
| organization_id | uuid | Yes | Authorized tenant context | FK organizations; together with studio_id must reference a real studio in this organization; immutable | Identifier | Tenant-scoped reads; validated RPC writes only | 2 |
| studio_id | uuid | Yes | Authorized branch context | Composite FK studios(organization_id,id); immutable; never trusted from client alone | Identifier | Assigned studio / Owner scope | 2 |
| created_at | timestamptz | Yes | Server now() | Immutable creation time in UTC | Internal | Scoped readers; server writes | 2 |
| created_by | uuid | Conditional | Server auth.uid() or approved job identity | Human actor required for interactive creation; system job uses explicit job context/audit | Internal | Authorized audit readers; server writes | 2 |
| updated_at | timestamptz | Yes | Server now() | Changed only by authorized mutation; do not let browser set timestamps | Internal | Scoped readers; server writes | 2 |
| updated_by | uuid | Conditional | Server actor | Last interactive actor; system changes also reference job/audit context | Internal | Scoped readers; server writes | 2 |
| row_version | bigint | Yes | 1 | Increment atomically; mutation supplies expected version; stale edit returns conflict | Internal | Scoped readers; validated RPC writes | 2 |
| student_id | uuid | Yes | Authorized selection | Composite FK same-tenant students; matching linked or pending roster record | Identifier | Owner/Admin; session-eligible instructor; own student | 2 |
| batch_id | uuid | Yes | Authorized selection | Composite FK same-tenant batches; active/effective/date eligibility checks | Identifier | Owner/Admin; assigned instructor; own student | 2 |
| enrollment_number | text | Yes | Scoped sequence | Unique studio reference; not authorization | Internal | Authorized enrollment participants | 2 |
| valid_from | date | Yes | Approved start date | Inclusive local start | Operational | Authorized enrollment participants | 2 |
| valid_until | date | No | None | Exclusive local end > valid_from; null for open-ended; needed for historical eligibility | Operational | Authorized enrollment participants | 2 |
| status | enrollment_status enum | Yes | active | active, paused, completed, withdrawn; transition rules + enrollment_events audit | Operational | Scoped reads; validated Owner/Admin RPC writes | 2 |
| reserves_seat | boolean | Yes | Studio pause policy via RPC | Not an arbitrary client toggle; capacity checks include reservation intervals | Internal | Owner/Admin; limited capacity projection | 2 |
| pause_from | date | No | None | Current pause interval only; multiple pauses retained in enrollment_events | Operational | Owner/Admin and own student | 2 |
| pause_until | date | No | None | Exclusive boundary > pause_from; may be open-ended under approved policy | Operational | Owner/Admin and own student | 2 |
| pause_reason | controlled text | No | None | Short operational reason, not medical narrative | Restricted internal | Owner/Admin and own student where appropriate | 2 |
| withdrawn_at | timestamptz | No | Server transition time | Withdrawal must not delete earlier attendance | Internal | Owner/Admin and own student | 2 |
| status_reason | text | Conditional | Required for exceptional change | Bounded max 250; reason copied to immutable event/audit | Restricted internal | Owner/Admin | 2 |
| membership_subscription_id | uuid | No | Plan linkage | Composite FK matching same student/tenant when required; do not issue duplicate charges per batch | Financial identifier | Owner/Admin and own student; not instructor | 4 |
| eligibility_override_by | uuid | No | Authorized exception | Owner/Admin under explicit policy; not an authority bypass; audit reason required | Restricted internal | Owner/Admin | 2 conditional |

## `class_sessions` — 31 proposed fields

| Field | Proposed PostgreSQL type | Required | Default / source | Validation / relationship / meaning | Classification | Permitted readers / writers | Phase |
|---|---|---|---|---|---|---|---|
| id | uuid | Yes | Server generated | Primary key; add unique organization_id, studio_id, id for composite references | Identifier | Scoped roles; server-derived identity | 3 |
| organization_id | uuid | Yes | Authorized tenant context | FK organizations; together with studio_id must reference a real studio in this organization; immutable | Identifier | Tenant-scoped reads; validated RPC writes only | 3 |
| studio_id | uuid | Yes | Authorized branch context | Composite FK studios(organization_id,id); immutable; never trusted from client alone | Identifier | Assigned studio / Owner scope | 3 |
| created_at | timestamptz | Yes | Server now() | Immutable creation time in UTC | Internal | Scoped readers; server writes | 3 |
| created_by | uuid | Conditional | Server auth.uid() or approved job identity | Human actor required for interactive creation; system job uses explicit job context/audit | Internal | Authorized audit readers; server writes | 3 |
| updated_at | timestamptz | Yes | Server now() | Changed only by authorized mutation; do not let browser set timestamps | Internal | Scoped readers; server writes | 3 |
| updated_by | uuid | Conditional | Server actor | Last interactive actor; system changes also reference job/audit context | Internal | Scoped readers; server writes | 3 |
| row_version | bigint | Yes | 1 | Increment atomically; mutation supplies expected version; stale edit returns conflict | Internal | Scoped readers; validated RPC writes | 3 |
| batch_id | uuid | Yes | Generation/template reference | Composite FK same-tenant batch; unique studio,batch,class_date for one daily occurrence | Identifier | Authorized session participants | 3 |
| class_date | date | Yes | Studio timezone conversion | Local class date; must match start_at in timezone_snapshot | Operational | Authorized session participants | 3 |
| start_at | timestamptz | Yes | Trusted generation or exception RPC | Persist UTC instant; exact local recurrence mapping and conflict checks | Operational | Authorized session participants | 3 |
| end_at | timestamptz | Yes | start_at + 60 minutes | CHECK exact 60 elapsed minutes; half-open occupancy interval | Operational | Authorized session participants | 3 |
| timezone_snapshot | text | Yes | Studio IANA timezone at scheduling | Valid timezone; preserve original interpretation after settings change | Operational | Authorized session participants | 3 |
| instructor_id | uuid | Yes | Batch assignment / explicit substitute | Composite FK same-tenant instructor; session history does not follow later batch reassignment | Identifier | Authorized session participants | 3 |
| instructor_profile_id | uuid | Yes for scheduled/live class | Trusted linked identity snapshot | Must match assigned instructor via composite relationship/trigger; organization-wide person conflict key | Identifier | Scoped visibility; server writes only | 3 |
| room_id | uuid | No | Batch snapshot | Same-tenant room; conflict/capacity validation if enabled | Operational | Authorized session participants | 3 |
| capacity_snapshot | integer | Yes | Approved batch capacity | >0; exception cannot fall below valid reserved/eligible attendance count without resolution | Operational | Authorized session participants | 3 |
| status | session_status enum | Yes | scheduled | scheduled, in_progress, completed, cancelled; validated transitions | Operational | Scoped reads; authorized workflow writes | 3 |
| schedule_version | integer | Yes | Batch version at creation | Track generation source; never rewrite completed history | Internal | Owner/Admin, jobs and own instructor | 3 |
| generation_job_id | uuid | No | Trusted job | FK job_runs; null only for approved manual creation | Internal | Owner/Admin and operators | 3 |
| cancelled_at | timestamptz | Conditional | Server cancellation time | Required for cancelled; retries must not resurrect class | Internal | Authorized session participants | 3 |
| cancelled_by | uuid | Conditional | Server actor | Required for user cancellation; job cancellation uses explicit job evidence | Internal | Owner/Admin and audit | 3 |
| cancellation_reason | text | Conditional | Bounded approved reason | Required on cancellation; student-visible safe wording separate from private audit notes | Operational | Authorized participants, sanitized | 3 |
| rescheduled_from_session_id | uuid | No | Explicit exception workflow | Same-tenant original session; preserve cancellation/history; enforce no cycles | Identifier | Authorized participants | 3 |
| attendance_marking_opens_at | timestamptz | Yes | start_at minus 10 min default | Server-computed policy snapshot; normal marking inclusive boundary; phone clock never authoritative | Operational | Assigned instructor, Owner, explicitly delegated Admin | 3 |
| attendance_marking_closes_at | timestamptz | Yes | end_at plus 15 min default | Normal marking closes here; later missed marks require correction authority and reason | Operational | Assigned instructor, Owner, explicitly delegated Admin | 3 |
| instructor_correction_until | timestamptz | Yes | end_at plus 24h default | Assigned active Instructor may correct saved/finalized own session through this inclusive cutoff; Owner has no automatic age cutoff | Operational | Assigned instructor, Owner; Admin only explicit delegation | 3 |
| attendance_policy_version | integer | Yes | Studio policy version snapshot | Window settings do not silently alter historical sessions; authorized future resnapshot audited | Internal | Owner/assigned instructor/delegated Admin; server writes | 3 |
| attendance_revision | bigint | Yes | 0 | Increment atomically with marks/corrections/finalization; stale finalize/edit must conflict | Internal | Authorized attendance participants; server-managed | 3 |
| attendance_finalized_at | timestamptz | No | Approved finalization workflow | Original finalization retained; unmarked students remain Unmarked, not auto-Absent; permitted corrections do not erase evidence | Internal | Owner, assigned instructor, explicitly delegated Admin | 3 |
| attendance_finalized_by | uuid | Conditional | Server actor | Required if finalization completed by person | Internal | Owner / assigned instructor / explicitly delegated Admin | 3 |

## `attendance` — 22 proposed fields

| Field | Proposed PostgreSQL type | Required | Default / source | Validation / relationship / meaning | Classification | Permitted readers / writers | Phase |
|---|---|---|---|---|---|---|---|
| id | uuid | Yes | Server generated | Primary key; add unique organization_id, studio_id, id for composite references | Identifier | Scoped roles; server-derived identity | 3 |
| organization_id | uuid | Yes | Authorized tenant context | FK organizations; together with studio_id must reference a real studio in this organization; immutable | Identifier | Tenant-scoped reads; validated RPC writes only | 3 |
| studio_id | uuid | Yes | Authorized branch context | Composite FK studios(organization_id,id); immutable; never trusted from client alone | Identifier | Assigned studio / Owner scope | 3 |
| created_at | timestamptz | Yes | Server now() | Immutable creation time in UTC | Internal | Scoped readers; server writes | 3 |
| created_by | uuid | Conditional | Server auth.uid() or approved job identity | Human actor required for interactive creation; system job uses explicit job context/audit | Internal | Authorized audit readers; server writes | 3 |
| updated_at | timestamptz | Yes | Server now() | Changed only by authorized mutation; do not let browser set timestamps | Internal | Scoped readers; server writes | 3 |
| updated_by | uuid | Conditional | Server actor | Last interactive actor; system changes also reference job/audit context | Internal | Scoped readers; server writes | 3 |
| row_version | bigint | Yes | 1 | Increment atomically; mutation supplies expected version; stale edit returns conflict | Internal | Scoped readers; validated RPC writes | 3 |
| session_id | uuid | Yes | Authorized session | Composite FK includes tenant and batch_id; unique session_id,enrollment_id | Identifier | Owner/Admin, assigned session instructor, own student | 3 |
| enrollment_id | uuid | Yes | Eligible enrollment | Composite FK includes tenant,batch_id,student_id; valid on class date | Identifier | Owner/Admin, eligible session instructor, own student | 3 |
| batch_id | uuid | Yes | Server-derived consistency key | Must agree with BOTH session and enrollment; never trusted unchecked from browser | Identifier | Scoped readers; server writes | 3 |
| student_id | uuid | Yes | Server-derived from enrollment | Composite relationship proves identity; efficient own-data RLS | Identifier | Owner/Admin, assigned instructor, own student | 3 |
| status | attendance_status enum | Yes | Explicit action, no default assumption | present, absent, late; no row means unmarked; not automatic present | Personal operational | Scoped readers; approved marking RPC | 3 |
| late_minutes | smallint | No | Optional instructor input | If provided for late: >0 and bounded; null for other statuses | Personal operational | Authorized attendance participants | 3 |
| first_marked_at | timestamptz | Yes | Server now() | Original mark time immutable | Internal | Authorized attendance participants | 3 |
| first_marked_by | uuid | Yes | auth.uid() | Authorized human actor; browser may not spoof; system finalization has explicit attribution policy | Internal | Owner/Admin, assigned instructor; own student safe display | 3 |
| last_marked_at | timestamptz | Yes | Server now() | Last committed mark; detailed changes append in attendance_changes | Internal | Authorized attendance participants | 3 |
| last_marked_by | uuid | Yes | Server actor | Revalidated on each change | Internal | Authorized attendance participants | 3 |
| correction_reason_code | controlled enum | Conditional | Required for saved/finalized/out-of-window correction | forgot_to_mark, wrong_status, arrived_late, other; initial normal-window mark needs no correction reason | Restricted internal | Owner, assigned instructor, explicitly delegated Admin; not automatic student disclosure | 3 |
| correction_reason | text | Conditional | Required detail only when code is other | Brief non-sensitive detail; optional for standard codes; immutable correction event retains approved history | Restricted internal | Owner, assigned instructor, explicitly delegated Admin; not automatic student disclosure | 3 |
| notes | text | No | None | Optional short operational note; no health diagnoses or broad dossier | Restricted internal | Owner/Admin and assigned instructor only | 3 |
| source | controlled enum | Yes | instructor/owner/delegated_admin workflow | Assigned instructor or Owner; Admin only explicit active studio grant; no QR or student write | Internal | Owner/Admin / assigned instructor | 3 |

## `memberships` — 38 proposed fields

| Field | Proposed PostgreSQL type | Required | Default / source | Validation / relationship / meaning | Classification | Permitted readers / writers | Phase |
|---|---|---|---|---|---|---|---|
| id | uuid | Yes | Server generated | Primary key; add unique organization_id, studio_id, id for composite references | Identifier | Scoped roles; server-derived identity | 4 |
| organization_id | uuid | Yes | Authorized tenant context | FK organizations; together with studio_id must reference a real studio in this organization; immutable | Identifier | Tenant-scoped reads; validated RPC writes only | 4 |
| studio_id | uuid | Yes | Authorized branch context | Composite FK studios(organization_id,id); immutable; never trusted from client alone | Identifier | Assigned studio / Owner scope | 4 |
| created_at | timestamptz | Yes | Server now() | Immutable creation time in UTC | Internal | Scoped readers; server writes | 4 |
| created_by | uuid | Conditional | Server auth.uid() or approved job identity | Human actor required for interactive creation; system job uses explicit job context/audit | Internal | Authorized audit readers; server writes | 4 |
| updated_at | timestamptz | Yes | Server now() | Changed only by authorized mutation; do not let browser set timestamps | Internal | Scoped readers; server writes | 4 |
| updated_by | uuid | Conditional | Server actor | Last interactive actor; system changes also reference job/audit context | Internal | Scoped readers; server writes | 4 |
| row_version | bigint | Yes | 1 | Increment atomically; mutation supplies expected version; stale edit returns conflict | Internal | Scoped readers; validated RPC writes | 4 |
| student_id | uuid | Yes | Trusted subscription | Composite FK same-tenant student | Identifier | Owner/Admin and own student; no instructor finance access | 4 |
| subscription_id | uuid | Yes | Membership subscription | Composite FK same student/tenant; period overlaps checked per subscription/product | Identifier | Owner/Admin and own student | 4 |
| plan_id | uuid | Yes | Approved plan | Same-tenant plan/version; cannot mutate issued snapshots by changing plan | Financial identifier | Owner/Admin and own student | 4 |
| plan_name_snapshot | text | Yes | Plan at issuance | Immutable issued display/terms; bounded | Financial | Owner/Admin and own student | 4 |
| billing_policy | billing_policy enum | Yes | Subscription snapshot | calendar_month or anniversary_month; immutable for issued period | Financial | Owner/Admin and own student | 4 |
| original_anchor_date | date | Yes | Subscription original start | Preserve original anchor for future period calculation | Financial | Owner/Admin and own student | 4 |
| billing_anchor_day | smallint | Conditional | Original local day | 1–31 for anniversary policy; calendar uses first-of-month boundaries | Financial | Owner/Admin and own student | 4 |
| period_start | date | Yes | Policy calculation | Inclusive local service start | Financial | Owner/Admin and own student | 4 |
| period_end | date | Yes | Policy calculation | Exclusive boundary > period_start; nonoverlap among issued active periods of same subscription | Financial | Owner/Admin and own student | 4 |
| period_timezone | text | Yes | Studio IANA snapshot | Used for service boundaries and due cutoff; not browser timezone | Financial | Owner/Admin and own student | 4 |
| subtotal_minor | bigint | Yes | Approved price/proration | >=0; INR minor units; no JS float arithmetic; immutable after issue | Financial | Owner/Admin and own student | 4 |
| discount_minor | bigint | Yes | 0 or approved concession | >=0 and <=subtotal; approver/reason required for nonstandard concession | Financial | Owner/Admin and own student | 4 |
| tax_minor | bigint | Yes | 0 unless approved tax policy | >=0; tax rules reviewed by accountant; no assumed GST treatment | Financial | Owner/Admin and own student | 4 |
| amount_due_minor | bigint | Yes | subtotal-discount+tax | CHECK arithmetic equality and >=0; adjusted balance derives from separate postings | Financial | Owner/Admin and own student | 4 |
| currency | char(3) | Yes | INR proposed | Supported ISO currency code; matching payments; no FX/multi-currency settlement initially | Financial | Owner/Admin and own student | 4 |
| proration_rule_snapshot | controlled text | Yes | Approved plan/policy | none or approved actual-days rule; immutable versioned description | Financial | Owner/Admin and own student | 4 |
| rounding_policy_snapshot | controlled text | Yes | half_up_minor_unit proposed | Freeze rounding rule; calculate once per approved line/period | Financial | Owner/Admin and own student | 4 |
| due_date | date | Yes | Plan due policy | Local date in period_timezone; overdue derived from cutoff plus outstanding | Financial | Owner/Admin and own student | 4 |
| lifecycle_status | membership_lifecycle enum | Yes | pending | pending, active, cancelled, expired; NOT payment settlement/overdue state | Operational financial | Owner/Admin and own student; no instructor finance access | 4 |
| issue_status | issue_status enum | Yes | draft | draft, issued, voided; issued charge fields protected; void requires history/reason | Financial | Owner/Admin and own student | 4 |
| invoice_number | text | Conditional | Scoped document sequence | Required/unique after issuance; numbering policy approved by accountant | Financial | Owner/Admin and own student | 4 |
| issued_at | timestamptz | Conditional | Server issuance | Required for issued; immutable | Financial | Owner/Admin and own student | 4 |
| issued_by | uuid | Conditional | Server actor or approved job context | Job-generated issue records retain job ID and audit | Financial internal | Owner/Admin; own student limited display | 4 |
| generation_job_id | uuid | No | Trusted recurrence job | FK job_runs; periods idempotent by subscription+boundary | Internal | Owner/Admin / operations | 4 |
| terms_snapshot | jsonb | Conditional | Versioned approved schema | Strict schema/size validation; only business terms, no arbitrary PII/provider payloads | Financial | Owner/Admin and own student | 4 |
| concession_reason | text | Conditional | Authorized exception | Required for nonstandard discount; bounded and non-sensitive | Restricted financial | Owner/Admin; safe invoice reason only if approved | 4 |
| concession_approved_by | uuid | Conditional | Scoped authorized approver | Server verified; no self-approved authority from client | Restricted financial | Owner/Admin and audit | 4 |
| cancelled_at | timestamptz | No | Approved cancellation | Does not erase issued invoice or automatically refund payment | Financial internal | Owner/Admin and own student | 4 |
| cancellation_reason | text | Conditional | Approved bounded reason | Credit/refund effects separate; audit and student-safe wording | Financial | Owner/Admin and own student safe subset | 4 |
| invoice_document_path | text | No | Trusted document generation | Private Storage path, no public URL; signed scoped delivery | Financial personal | Owner/Admin and own student | 5 |

## `payments` — 32 proposed fields

| Field | Proposed PostgreSQL type | Required | Default / source | Validation / relationship / meaning | Classification | Permitted readers / writers | Phase |
|---|---|---|---|---|---|---|---|
| id | uuid | Yes | Server generated | Primary key; add unique organization_id, studio_id, id for composite references | Identifier | Scoped roles; server-derived identity | 5 |
| organization_id | uuid | Yes | Authorized tenant context | FK organizations; together with studio_id must reference a real studio in this organization; immutable | Identifier | Tenant-scoped reads; validated RPC writes only | 5 |
| studio_id | uuid | Yes | Authorized branch context | Composite FK studios(organization_id,id); immutable; never trusted from client alone | Identifier | Assigned studio / Owner scope | 5 |
| created_at | timestamptz | Yes | Server now() | Immutable creation time in UTC | Internal | Scoped readers; server writes | 5 |
| created_by | uuid | Conditional | Server auth.uid() or approved job identity | Human actor required for interactive creation; system job uses explicit job context/audit | Internal | Authorized audit readers; server writes | 5 |
| updated_at | timestamptz | Yes | Server now() | Changed only by authorized mutation; do not let browser set timestamps | Internal | Scoped readers; server writes | 5 |
| updated_by | uuid | Conditional | Server actor | Last interactive actor; system changes also reference job/audit context | Internal | Scoped readers; server writes | 5 |
| row_version | bigint | Yes | 1 | Increment atomically; mutation supplies expected version; stale edit returns conflict | Internal | Scoped readers; validated RPC writes | 5 |
| membership_id | uuid | Yes | Authorized charge allocation | Composite FK same-tenant membership; payment belongs to its student/currency | Financial identifier | Owner/Admin and own student | 5 |
| amount_minor | bigint | Yes | Confirmed entered/provider amount | >0; positive receipt fact; overpayment rejected initially unless separately approved ledger policy | Financial | Owner/Admin and own student | 5 |
| currency | char(3) | Yes | Membership snapshot | Must match membership currency; no client FX conversion | Financial | Owner/Admin and own student | 5 |
| method | payment_method enum | Yes | Approved source | cash, upi, card, bank_transfer, other; store no card/bank credentials | Financial | Owner/Admin and own student | 5 |
| status | payment_status enum | Yes | pending | pending, confirmed, failed, voided; posted amount immutable; refunds recorded separately | Financial | Owner/Admin and own student | 5 |
| transaction_reference | text | Conditional | Manual/provider reference | Required for supported noncash methods; bounded/sanitized; unique rules provider/method scoped, not naive global match | Financial restricted | Owner/Admin and own student safe display | 5 |
| received_at | timestamptz | Conditional | Actual collection time | Required for confirmed manual payment; backdating requires approved reason; not client-set server posting time | Financial | Owner/Admin and own student | 5 |
| recorded_by | uuid | Conditional | Server auth.uid() | Required for manual collection; provider flow uses explicit verified source/job | Financial internal | Owner/Admin; receipt-safe self projection | 5 |
| confirmed_at | timestamptz | Conditional | Server posting transaction | Required for confirmed; immutable; status transition audited | Financial | Owner/Admin and own student | 5 |
| confirmed_by | uuid | Conditional | Server verified actor | Human for manual confirmation; provider verification identified separately | Financial internal | Owner/Admin and audit; limited receipt display | 5 |
| verification_source | controlled enum | Yes | Manual workflow initially | admin_manual or provider_webhook; browser cannot claim provider validation | Financial internal | Owner/Admin and own receipt summary | 5 |
| receipt_number | text | Conditional | Scoped document sequence | Required/unique after confirmed posting; preserve corrections and numbering history | Financial | Owner/Admin and own student | 5 |
| idempotency_key | text | Yes | Validated request key | Unique by defined tenant/operation; same payload retry returns original result; different payload conflicts | Internal | Server and authorized operations; not broad export | 5 |
| provider | controlled text | No | Approved provider | Only when gateway enabled; no credentials | Financial internal | Owner/Admin; safe receipt subset | Later gateway |
| provider_order_id | text | Conditional | Trusted server order | Required for gateway; match expected membership/account/amount/currency | Financial restricted | Owner/Admin and trusted service | Later gateway |
| provider_payment_id | text | Conditional | Verified callback | Unique with provider/account scope; no browser-success authority | Financial restricted | Owner/Admin and own safe receipt reference | Later gateway |
| provider_event_id | uuid | No | Dedupe event record | FK provider_events; signature and replay verification before posting | Restricted internal | Trusted service / audit only | Later gateway |
| failure_code | controlled text | No | Sanitized verification result | No raw stack traces, secret URLs or personal provider response body | Financial internal | Owner/Admin and own safe error summary | 5 |
| voided_at | timestamptz | No | Authorized preposting/correction lifecycle | No silent void of a posted settled receipt; approved reversal/credit/refund workflow | Financial internal | Owner/Admin and own linked correction | 5 |
| voided_by | uuid | Conditional | Server actor | Required with void where allowed; reason and audit | Financial internal | Owner/Admin / audit | 5 |
| correction_reason | text | Conditional | Approved action | Required for void/reversal request; original facts retained | Restricted financial | Owner/Admin; safe student explanation | 5 |
| receipt_document_path | text | No | Trusted receipt generation | Private object path; short-lived authorized access, not a shared public link | Financial personal | Owner/Admin and own student | 5 |
| reconciled_at | timestamptz | No | Approved reconciliation | Independent evidence; does not rewrite original receipt | Financial internal | Owner/Admin / finance reviewers | 5 |
| reconciled_by | uuid | Conditional | Authorized reviewer/system evidence | Server attribution; auditable reconciliation result | Financial internal | Owner/Admin / finance reviewers | 5 |

## Supporting tables / entities

| Entity | Phase | Key fields | Purpose | Access / note |
|---|---|---|---|---|
| organizations | 1 | id, legal/display name, status, default locale/currency, created_at | Owner tenant boundary; global platform authority is separate | Owner only through trusted setup; no public bootstrap |
| organization_memberships | 1 | organization_id, profile_id, role=owner, status, valid_from/until, accepted_at, granted_by | At least one active Owner; ownership change locked/audited | Owner inheritance only within this organization |
| studios | 1 | organization_id, id, code, name, timezone, location/contact, status, billing policy; attendance -10/+15 minute marking, 1440-minute correction defaults and policy version | Unique organization/code; valid IANA timezone; scoped branches | Owner manages; Admin only delegated approved settings |
| studio_memberships | 1 | organization_id,studio_id,profile_id,status,invited/accepted/suspended times | Unique studio/profile; independent active membership check on every request | Trusted invitation/link/suspension workflow |
| studio_permission_grants | 1/3 | tenant,studio_membership_id,permission attendance.manage,granted/revoked actors/times,status | Explicit Owner delegation to Admin; no implicit admin attendance writes; revocation enforced server-side | Owner grants/revokes; constrained audited workflow |
| studio_role_assignments | 1 | studio_membership_id,role admin/instructor/student,status,granted/revoked actors/times | No local owner role; multiple explicit roles; no self-escalation | Owner grants admins; delegated admin can invite only instructor/student |
| invitations | 1 | scope, recipient hash/contact, intended allowed role, token_hash, expiry, accepted_at, inviter | Store token hash, not plaintext token; verified acceptance, one-time/idempotent | Trusted scoped function; no arbitrary caller-chosen privileged role |
| audit_events | 1 | tenant,actor,action,target,occurred_at,correlation_id,reason,allowlisted before/after summary | Append-only; no credentials, unrestricted payloads or sensitive note duplication | Restricted Owner/security review; no client update/delete |
| student_contacts | 2 | tenant,student_id,relationship,name,phone/email,contact purpose,status | Emergency/guardian/billing purposes separated; no unrelated contact directory | Minimum necessary purpose-based access |
| consent_records | 2 | tenant,student_id,subject/guardian,notice_version,purpose,decision,recorded/revoked times,evidence reference | Versioned proof; withdrawal history; minor-admission/legal review required | Restricted authorized access; no inferred universal consent |
| instructor_qualifications | 2 conditional | tenant,instructor_id,type,issuer,reference,expiry,reviewer,private evidence path | Use only if real qualification verification is required; no arbitrary document dump | Owner/Admin/self; no student bulk evidence access |
| studio_rooms | 2 conditional | tenant,room code,name,physical capacity,status | Required if more than one room or room conflict checks needed | Branch-scoped operations; no public building access secrets |
| enrollment_events | 2 | tenant,enrollment_id,from/to status,effective interval,seat action,actor,reason | Append-only pause/rejoin/withdrawal history; stable capacity semantics | Owner/Admin; own safe status history |
| attendance_changes | 3 | tenant,attendance/session/enrollment IDs,old status nullable,new status,reason code/detail,actor/authority,server time,versions,request ID | Atomic append-only correction; null old status for missed mark; retain original mark/finalization | Owner; assigned Instructor within window; Admin only explicit scoped grant |
| membership_plans | 4 | tenant,plan/version,product_family_key,name,price_minor,currency,entitlements,tax/proration/rounding policy,status | Versioned approved terms; no retroactive invoice change; entitlements validated | Owner policy; Admin delegated use; student own-plan description |
| membership_subscriptions | 4 | tenant,student_id,plan/version,billing policy,original anchor,renewal dates,status,due policy | No overlapping live subscription for same student/product family; effective-dated plan changes; one subscription can cover multiple batches | Owner/Admin; student read own; jobs scoped |
| financial_adjustments | 5 | tenant,membership_id,debit/credit,amount_minor,currency,reason,approver,posted_at | Append-only posted adjustments; correct charge independently of cash refunds | Owner approval; own student safe statement |
| refunds | 5 | tenant,payment_id,amount_minor,currency,status,reason,requested/approved/settled actors/times,provider reference | Cumulative settled/pending commitments cannot exceed refundable original amount; locking/idempotency | Owner approval by default; Admin request only |
| document_sequences | 4/5 | tenant,document type,fiscal period,prefix,next value | Transaction-safe unique numbering; accountant-approved gap/correction rules | Trusted issuance only; not public writable |
| job_runs | 3 | tenant,job type,period/horizon key,attempt,started/ended,result,safe error code | Bounded retries; visibility/alerting; no PII or secret logs | Operations/Owner appropriate summaries |
| idempotency_requests | 2 onward | tenant,operation,key,payload hash,result reference,status,expiry | Replay same request result; reject key reuse with changed payload; retention approved | Trusted transactional operations only |
| provider_events | Later gateway | provider/account,event id,signature result,received_at,processing status,sanitized payload reference | Deduped/replay-safe; minimal encrypted evidence; no raw credentials/card details | Edge verification service; restricted audit |
| payment_orders | Later gateway | tenant,membership_id,expected amount/currency,provider order,state,idempotency key | Trusted expected amount, account and invoice binding before callback | Server-only creation; user reads own safe checkout context |
| export_jobs | 5 conditional | tenant,requester,purpose,allowed filters,status,private object path,expiry,download audit | Bounded size; CSV formula protection; reauthorize delivery; automatic expiry | Scoped Owner/delegated Admin; own-student documents separate |

## Derived views/projections — not independently editable facts

- Student/instructor safe directory projections: minimum scoped display fields, not global contact/notes access.
- Occupancy by batch and effective date/session; available seats include the approved reservation/pause policy.
- Instructor's eligible session roster using historical session assignment and enrollment dates.
- Membership statement: immutable issued charge plus posted adjustments, confirmed receipts and settled refunds.
- Settlement and overdue projections, kept separate from service lifecycle.
- Tenant/date-scoped dashboards and collection reports; caller-safe RLS or controlled aggregate RPC, not a global owner-view exposed to every role.

## Schema review questions

Confirm exact enums, retention periods, minor/guardian rules, plan entitlements, pause/seat semantics, correction deadlines, numbering/tax policy and cross-branch schedule conflict policy before SQL generation. The approved migration must add tenant FKs, non-overlap/uniqueness rules, restricted grants, RLS, validated RPCs and tests together. Do not implement this dictionary as unchecked direct client CRUD.

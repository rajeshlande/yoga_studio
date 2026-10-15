# Yoga Studio — Attendance workflow and corrections

- Document version: 0.1
- Updated: 2026-10-15
- Status: Agreed planning direction; implementation and verification pending
- Scope: Instructor-controlled attendance, time-based class selection, and audited corrections
- No application/database deployment is performed by this document update.

## 1. Selected approach

Use **instructor-controlled attendance**, not student QR check-in. The assigned instructor physically checks the roster and marks the students they can see. Students can only view their own attendance. This prevents student-submitted proxy attendance but is not a guarantee against deliberate staff collusion or misidentification.

QR scanning, student self-check-in, geofencing, device binding, facial recognition and biometric verification are outside the current attendance scope. Do not add QR challenge/check-in tables for this workflow. OpenWA is also excluded from the system; no unofficial WhatsApp integration is required for attendance or any other feature.

## 2. Minimal normal workflow

1. The instructor signs in or opens the already-authenticated app.
2. The app automatically selects the eligible **Today’s Class** and displays its roster.
3. The instructor taps a student's status: **Unmarked → Present → Late → Absent**. Provide clear labels and allow direct status selection when correcting.
4. The instructor reviews the counts and chooses **Finalize**.

Do not select a date, batch or session manually when exactly one eligible session is found. Initial marking inside the normal window does not require a correction reason. A successful save must be acknowledged by the server; a failed/offline request must not appear saved. Remaining unmarked students are shown for review, not silently recorded as absent. A deliberate explicit Absent action remains available.

## 3. Automatic Today’s Class selection

Use actual dated `class_sessions`, the studio timezone, server time, authenticated identity and allowed studio scope—not just the batch template or device clock. Apply these configurable default windows:

- Marking opens **10 minutes before `start_at`**.
- Normal marking remains available through the session and **15 minutes after `end_at`**.
- Instructor corrections remain available through **24 hours after `end_at`**, including after finalization. This is a separate window, not an extension of normal class auto-selection.

| Situation | Behavior |
|---|---|
| Exactly one authorized, non-cancelled session is within its marking window | Automatically show its roster, with studio, date, time and instructor visible |
| More than one eligible session | Show a small class chooser; never guess which session to modify |
| No session is currently eligible | Show the next authorized upcoming class; do not open marking early |
| All today’s windows have ended | Show next upcoming class and a clear Attendance history/correction entry point |
| Attendance already finalized | Show the summary read-only by default; eligible users can choose Correct attendance |
| Class cancelled | Show cancellation information; do not permit marking/corrections against the cancelled session |
| No assigned/upcoming class | Show an empty state; do not manufacture a session from the recurring template |
| Owner opens Today’s Classes | Select automatically only if one eligible session exists in the selected studio context; otherwise show the studio/class chooser |

Re-evaluate on login, app foreground/resume, studio-context change and periodic refresh while the page is visible. Use a current server time response for presentation; every write independently checks database time, so changing a phone clock cannot open a window. Pending/out-of-sync screens must refresh before accepting a mutation.

The PWA selects the class **while it is open or when launched**. It cannot reliably launch itself at class time, and it must never mark students automatically. No background private-data caching or offline attendance-write queue is included.

## 4. Correction permissions

| Role | Allowed access |
|---|---|
| Assigned Instructor | Mark their own session in the normal window; add missed marks/change saved statuses, including finalized attendance, until 24 hours after class end by default |
| Owner | Mark/correct sessions within their own organization, including older retained sessions; no automatic age cutoff, but eligibility, cancellation, tenant and audit checks still apply |
| Admin | No attendance write authority by default; only an explicit Owner-granted, studio-scoped attendance permission enables marking/corrections in that studio |
| Student | Read own attendance only; no marking, correction, finalization or approval endpoint |

Instructor authority comes from the actual session assignment, not the batch's latest instructor. Active role/membership must still be checked. A revoked instructor cannot regain access through an old open tab. Instructor corrections after the cutoff go to the Owner. Finalization alone does not remove an assigned instructor's permitted correction window.

The Owner’s lack of a retrospective age cutoff does not authorize marking a future class before its normal opening time. No role may pre-mark future attendance as if the student were already present.

Owner delegation to an Admin must be explicit, revocable and audited. The `admin` role alone must not grant attendance writes. Delegated administrative corrections follow the approved Owner-delegated scope and require reasons; they do not expand the Admin to other studios or grant ownership powers.

## 5. Simple correction flow

1. Open the class roster or attendance history.
2. Tap the student and select Present, Late or Absent.
3. For an already saved status, a finalized class, or a missed mark outside the normal marking window, choose one short reason and **Save correction**.

Reason codes:
- `forgot_to_mark` — Forgot to mark
- `wrong_status` — Wrong status selected
- `arrived_late` — Student arrived late
- `other` — Other; requires a brief non-sensitive explanation

Optional detail is not mandatory for the three standard reasons. No health, medical or sensitive personal narrative should be entered. If a request would not change anything, return a no-op rather than creating misleading correction history.

A missed student with no previous attendance row is still correctable if their enrollment was eligible on the class date. Record the old state as **Unmarked/null** in the correction event; do not invent an earlier absent/present record.

## 6. Backend enforcement and transaction

Use approved attendance RPCs rather than unrestricted table writes. Each mutation must:

1. Verify authenticated identity, active authority and target organization/studio.
2. Confirm the actual session and historic enrollment belong to the same tenant/batch/student, and that enrollment/pause history permits attendance on that class date.
3. Reject cancelled sessions, unauthorized assignment, expired instructor window and missing reasons where required. Owner corrections do not bypass these integrity checks.
4. Lock/validate the relevant records and compare expected row/session versions. A second device's stale edit must return a conflict, not overwrite silently.
5. Atomically write the official status, increment versions, append any correction event and write an audit event. Derive actor IDs and timestamps on the server; never accept them as authority from the client.
6. Return the saved status, updated counts and version. Duplicate/retried requests must not create duplicate attendance or correction events.

Unique `(session_id, enrollment_id)` enforcement remains. No attendance row means Unmarked. Official stored statuses remain only Present, Absent and Late. Late minutes are optional; if provided for Late they must be positive and absent for other statuses.

Finalization uses the expected session attendance revision and preserves explicit unmarked counts. If a concurrent mark changes that revision, require a refresh/review. Later corrections append history without deleting the original finalization evidence or pretending the correction happened at class time. The visible summary reflects corrected current values and an update indicator.

## 7. Data dictionary changes

### Studio policy/settings

Proposed validated settings:
- `attendance_open_before_minutes`: 10 by default.
- `attendance_close_after_minutes`: 15 by default.
- `instructor_correction_window_minutes`: 1440 by default.
- `attendance_policy_version`: server-managed version.

Owner manages these settings. Snapshot time boundaries/version on each session; a settings edit must not silently change historical windows. Any explicit future-session resnapshot is authorized and audited. The Instructor window is elapsed time from session end, not midnight of the next calendar day.

### `class_sessions`

- Add `attendance_marking_opens_at` and `attendance_marking_closes_at`.
- Replace the ambiguous proposed `attendance_lock_at` with `instructor_correction_until`.
- Add `attendance_policy_version` and `attendance_revision`.
- Retain `attendance_finalized_at` / `attendance_finalized_by` as original finalization evidence. Finalized does not mean correction history can be erased.

### `attendance`

- Add `correction_reason_code` with the four approved values when a correction is made.
- Keep `correction_reason` as brief detail, required only for Other.
- Sources are `instructor`, `owner` or `delegated_admin`; QR/student sources are excluded.
- Keep immutable first-mark actor/time and current last-mark actor/time, plus row version.

### `attendance_changes`

Append-only events include tenant, attendance/session/enrollment references, previous status (nullable for missed marks), new status, reason code/detail, actual actor and effective scoped authority, server time, source, previous/new version and request correlation/idempotency reference. Use allowlisted fields; do not duplicate private free text unnecessarily. Read access is scoped and no client can update/delete audit history.

### Permission delegation

Use a scoped `studio_permission_grants` record or equivalent reviewed capability model for an Owner's explicit `attendance.manage` grant to an Admin. Record granted/revoked actors/times; verify active grants server-side. This is not an arbitrary user-editable permissions JSON field.

## 8. Acceptance tests to implement

| ID | Scenario | Expected result |
|---|---|---|
| ATT-01 | One assigned class within its normal window | Correct roster auto-opens; no batch/date selection |
| ATT-02 | Earlier than 10 minutes before start | Upcoming class visible; marking disabled |
| ATT-03 | During class / through 15 minutes after end | Initial marking allowed for authorized instructor |
| ATT-04 | No current session, multiple eligible sessions, cancelled session | Next-class/chooser/cancelled states respectively; no guessing or unauthorized mutation |
| ATT-05 | Phone clock altered; app resumes or changes studio | Server-time and scope checks govern selection and every write |
| ATT-06 | Finalize with unmarked students | Review/counts preserved; no silent automatic Absent entries |
| ATT-07 | Instructor corrects saved/finalized attendance within cutoff | Allowed with approved reason and atomic audit event |
| ATT-08 | Instructor corrects at/after configured cutoff | At cutoff allowed under the stated inclusive rule; after cutoff denied and referred to Owner |
| ATT-09 | Owner corrects an older eligible retained session | Allowed only in own organization; same integrity/audit checks apply |
| ATT-10 | Admin without grant, revoked grant, other-studio grant | Attendance writes denied in all unauthorized cases |
| ATT-11 | Student attempts write; instructor targets another session | Denied at RPC/database layer, not just in UI |
| ATT-12 | Missed mark with no existing attendance row | Previous state recorded as Unmarked/null, not fabricated Absent |
| ATT-13 | Missing reason / Other without detail / sensitive error | Validation error; no partial mutation or misleading audit |
| ATT-14 | Concurrent correction or finalize versus mark | Version conflict/review; no lost updates or duplicate facts |
| ATT-15 | Offline request or PWA background/closed | No false success, private cached roster or promised self-launch |
| ATT-16 | Historical enrollment mismatch, revoked instructor, cancelled class | Denied even for a stale UI; Owner cannot bypass enrollment/tenant integrity |
| ATT-17 | Any role, including Owner, tries to pre-mark before the opening time | Denied; unrestricted retrospective correction age is not permission to pre-mark future presence |

**Boundary convention:** normal initial marking allows `opens_at <= server_now <= closes_at`; instructor corrections allow `server_now <= instructor_correction_until`. Requests after either relevant boundary are rejected or routed to the authorized correction path. A saved/finalized edit still requires a reason even if it occurs inside the normal marking window.

## 9. Status and change control

The workflow is captured as the agreed planning direction, with 10-minute/15-minute/24-hour values as documented configurable defaults. Production enforcement, database migration, RLS/RPC tests, UI implementation, real-user UAT and formal go-live approval are still pending. Do not treat a document update as a deployed attendance feature.

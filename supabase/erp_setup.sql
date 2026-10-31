-- ============================================================================
-- Yoga Studio ERP (Core) — THE single Supabase setup file. SQL version 8.
-- Matches app version 1.6.0 (safer autosync, GST/UPI invoicing,
-- Owner/Co-owner payment configuration/readiness checks, Student portal
-- access, Odoo-style fixed Role Access management for all five roles,
-- account-first public Student admissions with manager confirmation,
-- native Odoo-style subscription lifecycle and one-click renewals, and
-- Odoo-style plan templates with a separate one-month-only offering).
--
-- MAINTENANCE RULE (owner's instruction): every future table / function /
-- policy change for the ERP is added to THIS file only. The file is
-- idempotent: paste the WHOLE file again after any update and press Run.
-- It never drops tables or deletes business data.
--
-- HOW TO USE
--   1. Open your Supabase project -> SQL Editor -> New query.
--   2. Paste this entire file and press Run. (Safe to run more than once.)
--   3. In the app: sign in -> Settings -> Data mode: Supabase.
--      The dashboard will ask you to create your organization (one click);
--      that makes the signed-in account the Owner.
--   4. Giving any user ERP access: that person first signs up in the app
--      and confirms their email; they must NOT create their own
--      organization. The primary Owner then uses Access for Co-owners.
--      Owner/Co-owner use Access for branch Admins. Owner/Co-owner or a
--      branch Admin use Access for Instructors and Students -> Portal
--      access for Students, entering the exact registered sign-in email.
--      For a new Student, a manager may instead share Students ->
--      Admission requests -> Public admission link. The applicant signs
--      up/signs in with Join an existing studio, submits the Admission
--      form, and a manager confirms it; confirmation creates the Student
--      and grants that same account Student portal access atomically.
--
-- SECURITY MODEL
--   * Tables have Row Level Security enabled with NO direct-access policies
--     and all table grants revoked from browser roles, so the Data API
--     cannot read/write them directly.
--   * The app reaches business data ONLY through the erp_* functions below
--     (function-only policy). Each function re-checks auth.uid(), the
--     caller's organization and role on every call and writes an audit row
--     for mutations. Money is stored as integer paise.
--   * Fixed roles are Owner (primary, protected), Co-owner
--     (organization-wide operations + Admin/Instructor/Student access),
--     Admin (selected branches only), Instructor (assigned batches only)
--     and Student (own portal records only). One active account has one
--     ERP role in one organization; Admin/Instructor branch assignments are
--     explicit branch-member rows.
--   * Offline sync uses the single typed erp_sync_push(jsonb) door. Every
--     queued device operation has a unique id (idempotent retries) and every
--     syncable row has a sync_version (optimistic concurrency). If the row
--     changed online after the device copied it, the server returns a
--     conflict for manual review; it never overwrites silently. Payments
--     are append-only and can be voided, never edited or deleted.
--   * The one-row billing profile stores invoice/GST/UPI/bank details and
--     gateway PUBLIC identifiers only. Gateway secret keys and webhook
--     secrets must never be stored in this database or the browser; live
--     gateway confirmation belongs in a trusted server/Edge Function.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
create table if not exists public.erp_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.erp_org_members (
  org_id uuid not null references public.erp_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','co_owner')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.erp_branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.erp_organizations(id) on delete cascade,
  name text not null,
  city text not null default '',
  address text not null default '',
  phone text not null default '',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now()
);

create table if not exists public.erp_students (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.erp_organizations(id) on delete cascade,
  branch_id uuid not null references public.erp_branches(id),
  full_name text not null,
  phone text not null default '',
  email text not null default '',
  gender text not null default '',
  dob date,
  joining_date date not null default current_date,
  status text not null default 'active' check (status in ('active','inactive')),
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.erp_instructors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.erp_organizations(id) on delete cascade,
  branch_id uuid references public.erp_branches(id),
  full_name text not null,
  phone text not null default '',
  email text not null default '',
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.erp_branch_members (
  branch_id uuid not null references public.erp_branches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','instructor','student')),
  instructor_id uuid references public.erp_instructors(id),
  student_id uuid references public.erp_students(id),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  primary key (branch_id, user_id, role)
);

create table if not exists public.erp_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.erp_organizations(id) on delete cascade,
  branch_id uuid not null references public.erp_branches(id),
  name text not null,
  instructor_id uuid references public.erp_instructors(id),
  days integer[] not null default '{}',
  start_time time not null default '07:00',
  duration_mins integer not null default 60 check (duration_mins between 15 and 600),
  capacity integer not null default 20 check (capacity between 1 and 1000),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now()
);

create table if not exists public.erp_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.erp_organizations(id) on delete cascade,
  batch_id uuid not null references public.erp_batches(id) on delete cascade,
  student_id uuid not null references public.erp_students(id) on delete cascade,
  joined_on date not null default current_date,
  status text not null default 'active' check (status in ('active','ended')),
  unique (batch_id, student_id)
);

create table if not exists public.erp_attendance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.erp_organizations(id) on delete cascade,
  batch_id uuid not null references public.erp_batches(id) on delete cascade,
  student_id uuid not null references public.erp_students(id) on delete cascade,
  class_date date not null,
  status text not null check (status in ('present','absent','late')),
  marked_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (batch_id, student_id, class_date)
);

create table if not exists public.erp_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.erp_organizations(id) on delete cascade,
  name text not null,
  amount_paise bigint not null check (amount_paise >= 0),
  duration_months integer not null default 1 check (duration_months between 1 and 24),
  plan_type text not null default 'subscription'
    constraint erp_plans_plan_type_check check (plan_type in ('subscription','one_month')),
  billing_cycle text not null default 'joining'
    constraint erp_plans_billing_cycle_check check (billing_cycle in ('joining','calendar')),
  renewal_enabled_default boolean not null default true,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  constraint erp_plans_one_month_template_check
    check (plan_type = 'subscription'
        or (duration_months = 1 and renewal_enabled_default = false))
);

create table if not exists public.erp_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.erp_organizations(id) on delete cascade,
  student_id uuid not null references public.erp_students(id) on delete cascade,
  plan_id uuid not null references public.erp_plans(id),
  branch_id uuid not null references public.erp_branches(id),
  start_date date not null,
  end_date date not null,
  billing_cycle text not null default 'joining' check (billing_cycle in ('joining','calendar')),
  duration_months integer not null default 1,
  amount_paise bigint not null check (amount_paise >= 0),
  status text not null default 'active'
    constraint erp_memberships_status_check check (status in ('active','paused','cancelled')),
  offering_type text not null default 'subscription'
    constraint erp_memberships_offering_type_check check (offering_type in ('subscription','one_month')),
  auto_renew boolean not null default true,
  previous_membership_id uuid references public.erp_memberships(id) on delete restrict,
  renewal_number integer not null default 0
    constraint erp_memberships_renewal_number_check check (renewal_number between 0 and 10000),
  paused_from date,
  paused_until date,
  pause_reason text not null default '',
  total_paused_days integer not null default 0
    constraint erp_memberships_total_paused_days_check check (total_paused_days between 0 and 3660),
  cancelled_at timestamptz,
  cancel_reason text not null default '',
  created_at timestamptz not null default now(),
  constraint erp_memberships_previous_not_self_check
    check (previous_membership_id is null or previous_membership_id <> id),
  constraint erp_memberships_pause_dates_check
    check (paused_until is null or (paused_from is not null and paused_until >= paused_from)),
  constraint erp_memberships_pause_state_check
    check ((status = 'paused' and paused_from is not null)
        or (status <> 'paused' and paused_from is null and paused_until is null and pause_reason = '')),
  constraint erp_memberships_cancel_state_check
    check ((status = 'cancelled' and cancelled_at is not null)
        or (status <> 'cancelled' and cancelled_at is null and cancel_reason = '')),
  constraint erp_memberships_one_month_state_check
    check (offering_type = 'subscription'
        or (duration_months = 1 and auto_renew = false
            and previous_membership_id is null and renewal_number = 0
            and total_paused_days = 0 and status <> 'paused'))
);

create table if not exists public.erp_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.erp_organizations(id) on delete cascade,
  student_id uuid not null references public.erp_students(id),
  membership_id uuid references public.erp_memberships(id),
  branch_id uuid references public.erp_branches(id),
  amount_paise bigint not null check (amount_paise > 0),
  method text not null default 'cash' check (method in ('cash','upi','card','bank')),
  paid_on date not null default current_date,
  receipt_no text not null,
  note text not null default '',
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, receipt_no)
);

-- One billing/payment profile per organization (SQL v3). It drives themed
-- fee invoices/receipts, optional GST splits, UPI QR + bank instructions,
-- and gateway readiness checks. Only public gateway identifiers are stored.
create table if not exists public.erp_billing_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.erp_organizations(id) on delete cascade,
  legal_name text not null default 'Yoga Studio',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  city text not null default '',
  state_name text not null default 'Maharashtra',
  state_code text not null default '27' check (state_code ~ '^[0-9]{2}$'),
  pin_code text not null default '',
  gst_enabled boolean not null default false,
  gstin text not null default '',
  gst_rate_percent numeric(5,2) not null default 18 check (gst_rate_percent between 0 and 28),
  sac_code text not null default '',
  price_includes_gst boolean not null default true,
  invoice_prefix text not null default 'YS-INV',
  due_days integer not null default 7 check (due_days between 0 and 60),
  terms text not null default '',
  upi_id text not null default '',
  upi_payee_name text not null default '',
  bank_name text not null default '',
  bank_account_name text not null default '',
  bank_account_number text not null default '',
  bank_account_type text not null default 'Current',
  ifsc text not null default '',
  gateway_provider text not null default 'none' check (gateway_provider in ('none','razorpay','cashfree')),
  gateway_environment text not null default 'test' check (gateway_environment in ('test','live')),
  gateway_public_key_id text not null default '',
  gateway_webhook_url text not null default '',
  gateway_webhook_configured boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  sync_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_counters (
  org_id uuid primary key references public.erp_organizations(id) on delete cascade,
  receipt bigint not null default 0
);

create table if not exists public.erp_audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.erp_organizations(id) on delete cascade,
  actor uuid references auth.users(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- One row per client sync operation ever presented for this organization.
-- Retrying after a lost network response returns the stored result instead
-- of applying the change twice (most importantly: receipts are not duplicated).
-- Payload bodies are intentionally not retained server-side; the device keeps
-- its proposed record for conflict review, and this ledger stores only the
-- operation identity/status/result needed for idempotency and audit.
create table if not exists public.erp_sync_operations (
  org_id uuid not null references public.erp_organizations(id) on delete cascade,
  op_id uuid not null,
  actor uuid not null references auth.users(id),
  device_id text not null default '',
  op_type text not null,
  entity text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  base_version integer,
  status text not null check (status in ('applied','conflict','rejected')),
  result jsonb not null default '{}'::jsonb,
  client_created_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (org_id, op_id)
);

-- ----------------------------------------------------------------------------
-- Public Student admissions (SQL v6). An organization-specific admission
-- code is only a target selector in the shareable account-first link; it is
-- never authorization. The applicant must be signed in with a confirmed
-- account before erp_submit_admission can write a pending request.
-- ----------------------------------------------------------------------------
alter table public.erp_organizations
  add column if not exists admission_code text;
update public.erp_organizations
   set admission_code = encode(gen_random_bytes(12), 'hex')
 where admission_code is null or btrim(admission_code) = '';
alter table public.erp_organizations
  alter column admission_code set default encode(gen_random_bytes(12), 'hex');
alter table public.erp_organizations
  alter column admission_code set not null;
create unique index if not exists erp_organizations_admission_code_idx
  on public.erp_organizations(admission_code);

alter table public.erp_students add column if not exists first_name text not null default '';
alter table public.erp_students add column if not exists last_name text not null default '';
alter table public.erp_students add column if not exists address text not null default '';
alter table public.erp_students add column if not exists pin_code text not null default '';
alter table public.erp_students add column if not exists admission_subject text not null default '';
alter table public.erp_students add column if not exists referred_by text not null default '';
alter table public.erp_students add column if not exists yoga_experience text not null default '';
alter table public.erp_students add column if not exists medical_physical_issue text not null default '';
alter table public.erp_students add column if not exists reason_to_join text not null default '';
update public.erp_students
   set first_name = split_part(btrim(full_name), ' ', 1),
       last_name = btrim(regexp_replace(btrim(full_name), '^[^ ]+\s*', ''))
 where (first_name = '' and last_name = '') and btrim(full_name) <> '';
alter table public.erp_students
  drop constraint if exists erp_students_yoga_experience_check;
alter table public.erp_students
  add constraint erp_students_yoga_experience_check
  check (yoga_experience in ('', 'experienced', 'no_experience', 'less_experienced'));

create table if not exists public.erp_admissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.erp_organizations(id) on delete cascade,
  applicant_user_id uuid not null references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  dob date not null,
  phone text not null,
  subject text not null,
  email text not null,
  address text not null,
  pin_code text not null,
  referred_by text not null default '',
  yoga_experience text not null
    check (yoga_experience in ('experienced', 'no_experience', 'less_experienced')),
  medical_physical_issue text not null,
  reason_to_join text not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected')),
  branch_id uuid references public.erp_branches(id),
  student_id uuid references public.erp_students(id),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text not null default ''
);
create index if not exists erp_admissions_org_status_idx
  on public.erp_admissions(org_id, status, submitted_at desc);
create index if not exists erp_admissions_applicant_idx
  on public.erp_admissions(applicant_user_id, submitted_at desc);
create unique index if not exists erp_admissions_pending_user_idx
  on public.erp_admissions(org_id, applicant_user_id) where status = 'pending';
create unique index if not exists erp_admissions_pending_email_idx
  on public.erp_admissions(org_id, lower(email)) where status = 'pending';
create unique index if not exists erp_admissions_student_idx
  on public.erp_admissions(student_id) where student_id is not null;

create index if not exists erp_branches_org_idx on public.erp_branches(org_id);
create index if not exists erp_students_org_branch_idx on public.erp_students(org_id, branch_id);
create index if not exists erp_batches_org_branch_idx on public.erp_batches(org_id, branch_id);
create index if not exists erp_enrollments_batch_idx on public.erp_enrollments(batch_id, status);
create index if not exists erp_attendance_batch_date_idx on public.erp_attendance(batch_id, class_date);
create index if not exists erp_attendance_student_idx on public.erp_attendance(student_id, class_date);
create index if not exists erp_memberships_student_idx on public.erp_memberships(student_id, status);
create index if not exists erp_payments_membership_idx on public.erp_payments(membership_id);
create index if not exists erp_payments_org_date_idx on public.erp_payments(org_id, paid_on);
create index if not exists erp_audit_org_idx on public.erp_audit_log(org_id, created_at);
create index if not exists erp_sync_operations_actor_idx on public.erp_sync_operations(org_id, actor, created_at);
create index if not exists erp_branch_members_user_status_idx on public.erp_branch_members(user_id, status);
create index if not exists erp_org_members_user_status_idx on public.erp_org_members(user_id, status);
create index if not exists erp_branch_members_student_idx on public.erp_branch_members(student_id)
  where student_id is not null;
create index if not exists erp_branch_members_instructor_idx on public.erp_branch_members(instructor_id)
  where instructor_id is not null;

-- ----------------------------------------------------------------------------
-- Offline-sync columns (SQL v2). Added with ALTER so re-running this file on
-- a v1 database upgrades it in place without touching business rows. Every
-- browser-visible ERP record gets a monotonically increasing sync_version;
-- the trigger below increments it on ANY update (sync RPC, older direct RPCs
-- or an audited DBA fix), so a stale device edit is always detected.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'erp_branches','erp_students','erp_instructors','erp_batches',
    'erp_enrollments','erp_attendance','erp_plans','erp_memberships','erp_payments','erp_billing_settings']
  loop
    execute format('alter table public.%I add column if not exists sync_version integer not null default 1', t);
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
  end loop;
end $$;

alter table public.erp_enrollments add column if not exists created_at timestamptz not null default now();
alter table public.erp_payments add column if not exists status text not null default 'recorded'
  check (status in ('recorded','void'));
alter table public.erp_payments add column if not exists void_reason text not null default '';
alter table public.erp_payments add column if not exists voided_at timestamptz;
alter table public.erp_payments add column if not exists voided_by uuid references auth.users(id);

-- ----------------------------------------------------------------------------
-- Native subscription lifecycle (SQL v7). A membership row remains one
-- subscription period; Plans stay the reusable price/duration templates.
-- Only durable active/paused/cancelled state is stored. Scheduled and
-- expired presentation is derived from the inclusive period dates, so no
-- unattended cron is needed. A renewal is a linked next period, and the
-- partial unique index below allows only one live renewal per period; a
-- cancelled future renewal remains as history and can be replaced.
-- ----------------------------------------------------------------------------
alter table public.erp_memberships add column if not exists auto_renew boolean not null default true;
alter table public.erp_memberships add column if not exists previous_membership_id uuid
  references public.erp_memberships(id) on delete restrict;
alter table public.erp_memberships add column if not exists renewal_number integer not null default 0;
alter table public.erp_memberships add column if not exists paused_from date;
alter table public.erp_memberships add column if not exists paused_until date;
alter table public.erp_memberships add column if not exists pause_reason text not null default '';
alter table public.erp_memberships add column if not exists total_paused_days integer not null default 0;
alter table public.erp_memberships add column if not exists cancelled_at timestamptz;
alter table public.erp_memberships add column if not exists cancel_reason text not null default '';

update public.erp_memberships
   set cancelled_at = coalesce(updated_at, created_at, now())
 where status = 'cancelled' and cancelled_at is null;
update public.erp_memberships
   set paused_from = null, paused_until = null, pause_reason = ''
 where status <> 'paused'
   and (paused_from is not null or paused_until is not null or pause_reason <> '');
update public.erp_memberships
   set cancelled_at = null, cancel_reason = ''
 where status <> 'cancelled' and (cancelled_at is not null or cancel_reason <> '');
update public.erp_memberships
   set renewal_number = least(10000, greatest(0, renewal_number)),
       total_paused_days = least(3660, greatest(0, total_paused_days))
 where renewal_number < 0 or renewal_number > 10000
    or total_paused_days < 0 or total_paused_days > 3660;
update public.erp_memberships
   set paused_until = paused_from
 where paused_from is not null and paused_until is not null and paused_until < paused_from;
update public.erp_memberships
   set previous_membership_id = null
 where previous_membership_id = id;

alter table public.erp_memberships drop constraint if exists erp_memberships_status_check;
alter table public.erp_memberships add constraint erp_memberships_status_check
  check (status in ('active','paused','cancelled'));
alter table public.erp_memberships drop constraint if exists erp_memberships_renewal_number_check;
alter table public.erp_memberships add constraint erp_memberships_renewal_number_check
  check (renewal_number between 0 and 10000);
alter table public.erp_memberships drop constraint if exists erp_memberships_total_paused_days_check;
alter table public.erp_memberships add constraint erp_memberships_total_paused_days_check
  check (total_paused_days between 0 and 3660);
alter table public.erp_memberships drop constraint if exists erp_memberships_previous_not_self_check;
alter table public.erp_memberships add constraint erp_memberships_previous_not_self_check
  check (previous_membership_id is null or previous_membership_id <> id);
alter table public.erp_memberships drop constraint if exists erp_memberships_pause_dates_check;
alter table public.erp_memberships add constraint erp_memberships_pause_dates_check
  check (paused_until is null or (paused_from is not null and paused_until >= paused_from));
alter table public.erp_memberships drop constraint if exists erp_memberships_pause_state_check;
alter table public.erp_memberships add constraint erp_memberships_pause_state_check
  check ((status = 'paused' and paused_from is not null)
      or (status <> 'paused' and paused_from is null and paused_until is null and pause_reason = ''));
alter table public.erp_memberships drop constraint if exists erp_memberships_cancel_state_check;
alter table public.erp_memberships add constraint erp_memberships_cancel_state_check
  check ((status = 'cancelled' and cancelled_at is not null)
      or (status <> 'cancelled' and cancelled_at is null and cancel_reason = ''));
create unique index if not exists erp_memberships_one_live_renewal_idx
  on public.erp_memberships(previous_membership_id)
  where previous_membership_id is not null and status <> 'cancelled';
create index if not exists erp_memberships_org_status_end_idx
  on public.erp_memberships(org_id, status, end_date);

-- ----------------------------------------------------------------------------
-- Odoo-style plan templates and one-month-only offerings (SQL v8). Existing
-- Plans and periods backfill as subscriptions, preserving every agreed
-- amount/date. A Plan now carries its template billing period/alignment and
-- renewal default. Each membership snapshots offering_type at creation, so
-- editing a template later cannot convert an existing period. One-month
-- passes use the same dues/payment records but cannot pause or renew.
-- ----------------------------------------------------------------------------
alter table public.erp_plans add column if not exists plan_type text not null default 'subscription';
alter table public.erp_plans add column if not exists billing_cycle text not null default 'joining';
alter table public.erp_plans add column if not exists renewal_enabled_default boolean not null default true;
alter table public.erp_memberships add column if not exists offering_type text not null default 'subscription';

update public.erp_plans
   set plan_type = 'subscription'
 where plan_type is null or plan_type not in ('subscription','one_month');
update public.erp_plans
   set billing_cycle = 'joining'
 where billing_cycle is null or billing_cycle not in ('joining','calendar');
update public.erp_plans
   set duration_months = 1, renewal_enabled_default = false
 where plan_type = 'one_month'
   and (duration_months <> 1 or renewal_enabled_default is distinct from false);
update public.erp_memberships
   set offering_type = 'subscription'
 where offering_type is null or offering_type not in ('subscription','one_month');

alter table public.erp_plans drop constraint if exists erp_plans_plan_type_check;
alter table public.erp_plans add constraint erp_plans_plan_type_check
  check (plan_type in ('subscription','one_month'));
alter table public.erp_plans drop constraint if exists erp_plans_billing_cycle_check;
alter table public.erp_plans add constraint erp_plans_billing_cycle_check
  check (billing_cycle in ('joining','calendar'));
alter table public.erp_plans drop constraint if exists erp_plans_one_month_template_check;
alter table public.erp_plans add constraint erp_plans_one_month_template_check
  check (plan_type = 'subscription'
      or (duration_months = 1 and renewal_enabled_default = false));
alter table public.erp_memberships drop constraint if exists erp_memberships_offering_type_check;
alter table public.erp_memberships add constraint erp_memberships_offering_type_check
  check (offering_type in ('subscription','one_month'));
alter table public.erp_memberships drop constraint if exists erp_memberships_one_month_state_check;
alter table public.erp_memberships add constraint erp_memberships_one_month_state_check
  check (offering_type = 'subscription'
      or (duration_months = 1 and auto_renew = false
          and previous_membership_id is null and renewal_number = 0
          and total_paused_days = 0 and status <> 'paused'));
create index if not exists erp_plans_org_type_status_idx
  on public.erp_plans(org_id, plan_type, status);
create index if not exists erp_memberships_org_offering_status_end_idx
  on public.erp_memberships(org_id, offering_type, status, end_date);

create or replace function public.erp__touch_sync()
returns trigger language plpgsql as $$
begin
  new.sync_version := coalesce(old.sync_version, 0) + 1;
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'erp_branches','erp_students','erp_instructors','erp_batches',
    'erp_enrollments','erp_attendance','erp_plans','erp_memberships','erp_payments','erp_billing_settings']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_sync_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.erp__touch_sync()',
      t || '_sync_touch', t);
  end loop;
end $$;

-- A Student portal link is stored as a branch-member row. If a manager moves
-- the student record to another branch, move the active sign-in link with it;
-- otherwise the student would silently lose access after a routine branch
-- correction. Suspended historical links are left alone and are repaired by
-- the next explicit grant.
create or replace function public.erp__move_student_access_branch()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_target_student uuid;
  v_target_status text;
begin
  if new.branch_id is distinct from old.branch_id
     and exists (select 1 from public.erp_branches b
                  where b.id = new.branch_id and b.org_id = new.org_id) then
    for v_user_id in
      select bm.user_id
        from public.erp_branch_members bm
       where bm.student_id = new.id and bm.branch_id = old.branch_id
         and bm.role = 'student' and bm.status = 'active'
    loop
      select student_id, status into v_target_student, v_target_status
        from public.erp_branch_members
       where branch_id = new.branch_id and user_id = v_user_id and role = 'student';

      if found then
        if v_target_status = 'active' and v_target_student is distinct from new.id then
          -- A manually created duplicate already uses this account for a
          -- different student in the target branch. Do not fail the student
          -- branch move; suspend the moving link for an admin to resolve.
          update public.erp_branch_members
             set status = 'suspended'
           where branch_id = old.branch_id and user_id = v_user_id and role = 'student';
        else
          -- Reuse the historical target-branch row for this same account
          -- and remove the old-branch duplicate. This covers an account
          -- that was previously linked/revoked in the target branch.
          delete from public.erp_branch_members
           where branch_id = old.branch_id and user_id = v_user_id and role = 'student';
          update public.erp_branch_members
             set student_id = new.id, status = 'active'
           where branch_id = new.branch_id and user_id = v_user_id and role = 'student';
        end if;
      else
        begin
          update public.erp_branch_members
             set branch_id = new.branch_id
           where branch_id = old.branch_id and user_id = v_user_id and role = 'student';
        exception when unique_violation then
          -- A concurrent access change won the target-row race. Preserve
          -- the student update and leave this link suspended for regrant.
          update public.erp_branch_members
             set status = 'suspended'
           where branch_id = old.branch_id and user_id = v_user_id and role = 'student';
        end;
      end if;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists erp_students_move_student_access on public.erp_students;
create trigger erp_students_move_student_access
  after update of branch_id on public.erp_students
  for each row execute function public.erp__move_student_access_branch();

-- ----------------------------------------------------------------------------
-- Lock the tables: RLS on, no browser-role grants. Functions below are the
-- only door, and they re-check identity, tenant and role on every call.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'erp_organizations','erp_org_members','erp_branches','erp_students',
    'erp_instructors','erp_branch_members','erp_batches','erp_enrollments',
    'erp_attendance','erp_plans','erp_memberships','erp_payments','erp_billing_settings',
    'erp_counters','erp_audit_log','erp_sync_operations','erp_admissions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Internal helpers (derive everything from auth.uid(); never trust inputs)
-- ----------------------------------------------------------------------------
create or replace function public.erp_current_org()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select org_id from public.erp_org_members
      where user_id = auth.uid() and status = 'active' order by created_at limit 1),
    (select b.org_id from public.erp_branch_members bm
       join public.erp_branches b on b.id = bm.branch_id
      where bm.user_id = auth.uid() and bm.status = 'active'
        and (
          bm.role = 'admin'
          or (bm.role = 'student' and exists (
            select 1 from public.erp_students s
             where s.id = bm.student_id and s.org_id = b.org_id
               and s.branch_id = bm.branch_id and s.status = 'active'))
          or (bm.role = 'instructor' and exists (
            select 1 from public.erp_instructors i
             where i.id = bm.instructor_id and i.org_id = b.org_id
               and i.status = 'active'))
        )
      limit 1))
$$;

create or replace function public.erp_my_roles()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct r), '{}') from (
    select role as r
      from public.erp_org_members
     where user_id = auth.uid() and status = 'active'
       and org_id = public.erp_current_org()
    union all
    select bm.role from public.erp_branch_members bm
      join public.erp_branches b on b.id = bm.branch_id
     where bm.user_id = auth.uid() and bm.status = 'active'
       and b.org_id = public.erp_current_org()
       and (
         bm.role = 'admin'
         or (bm.role = 'student' and exists (
           select 1 from public.erp_students s
            where s.id = bm.student_id and s.org_id = b.org_id
              and s.branch_id = bm.branch_id and s.status = 'active'))
         or (bm.role = 'instructor' and exists (
           select 1 from public.erp_instructors i
            where i.id = bm.instructor_id and i.org_id = b.org_id
              and i.status = 'active'))
       )
  ) s where r is not null
$$;

create or replace function public.erp_can_manage()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.erp_org_members
                  where user_id = auth.uid() and status = 'active'
                    and org_id = public.erp_current_org())
      or exists (select 1 from public.erp_branch_members bm
                   join public.erp_branches b on b.id = bm.branch_id
                  where bm.user_id = auth.uid() and bm.status = 'active'
                    and bm.role = 'admin' and b.org_id = public.erp_current_org())
$$;

create or replace function public.erp__org_role(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.erp_org_members
   where org_id = p_org and user_id = auth.uid() and status = 'active'
   limit 1
$$;

create or replace function public.erp__is_org_manager(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.erp__org_role(p_org) in ('owner','co_owner'), false)
$$;

create or replace function public.erp__is_primary_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.erp__org_role(p_org) = 'owner', false)
$$;

create or replace function public.erp__admin_branch_ids(p_org uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct bm.branch_id), '{}'::uuid[])
    from public.erp_branch_members bm
    join public.erp_branches b on b.id = bm.branch_id
   where bm.user_id = auth.uid() and bm.status = 'active' and bm.role = 'admin'
     and b.org_id = p_org
$$;

create or replace function public.erp__can_manage_branch(p_org uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_branch is not null and exists (
           select 1 from public.erp_branches where id = p_branch and org_id = p_org)
         and (public.erp__is_org_manager(p_org)
              or p_branch = any(public.erp__admin_branch_ids(p_org))), false)
$$;

create or replace function public.erp__require_branch_manager(p_org uuid, p_branch uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.erp__can_manage_branch(p_org, p_branch) then
    raise exception 'FORBIDDEN';
  end if;
end $$;

create or replace function public.erp_my_instructor_id()
returns uuid language sql stable security definer set search_path = public as $$
  select bm.instructor_id
    from public.erp_branch_members bm
    join public.erp_branches b on b.id = bm.branch_id
    join public.erp_instructors i on i.id = bm.instructor_id
   where bm.user_id = auth.uid() and bm.status = 'active' and bm.role = 'instructor'
     and b.org_id = public.erp_current_org()
     and i.org_id = b.org_id and i.status = 'active'
   order by bm.created_at
   limit 1
$$;

create or replace function public.erp_my_student_id()
returns uuid language sql stable security definer set search_path = public as $$
  select bm.student_id
    from public.erp_branch_members bm
    join public.erp_branches b on b.id = bm.branch_id
    join public.erp_students s on s.id = bm.student_id
   where bm.user_id = auth.uid() and bm.status = 'active' and bm.role = 'student'
     and b.org_id = public.erp_current_org()
     and s.org_id = b.org_id and s.branch_id = bm.branch_id and s.status = 'active'
   order by bm.created_at
   limit 1
$$;

create or replace function public.erp__require_org()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp_current_org();
  if v_org is null then raise exception 'NO_ORGANIZATION: create or join an organization first'; end if;
  return v_org;
end $$;

create or replace function public.erp__require_manager()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := public.erp__require_org();
  if not public.erp_can_manage() then raise exception 'FORBIDDEN'; end if;
  return v_org;
end $$;

create or replace function public.erp__require_org_manager()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := public.erp__require_org();
  if not public.erp__is_org_manager(v_org) then raise exception 'FORBIDDEN'; end if;
  return v_org;
end $$;

create or replace function public.erp__log(p_org uuid, p_action text, p_entity text, p_entity_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.erp_audit_log(org_id, actor, action, entity, entity_id)
  values (p_org, auth.uid(), p_action, p_entity, p_entity_id)
$$;

-- ----------------------------------------------------------------------------
-- Bootstrap + context
-- ----------------------------------------------------------------------------
create or replace function public.erp_bootstrap_organization(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp_current_org();
  if v_org is not null then
    return jsonb_build_object('organizationId', v_org, 'alreadyExisted', true);
  end if;
  insert into public.erp_organizations(name, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'Yoga Studio'), auth.uid())
  returning id into v_org;
  insert into public.erp_org_members(org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  insert into public.erp_counters(org_id) values (v_org) on conflict do nothing;
  perform public.erp__log(v_org, 'bootstrap', 'organization', v_org);
  return jsonb_build_object('organizationId', v_org, 'alreadyExisted', false);
end $$;

create or replace function public.erp_get_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
  v_name text;
  v_roles text[] := '{}';
  v_org_role text;
  v_admin_branches uuid[] := '{}';
  v_branch_ids uuid[] := '{}';
  v_student uuid;
  v_primary_role text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp_current_org();
  if v_org is null then
    return jsonb_build_object('organizationId', null, 'roles', '[]'::jsonb);
  end if;
  select name into v_name from public.erp_organizations where id = v_org;
  v_roles := public.erp_my_roles();
  v_org_role := public.erp__org_role(v_org);
  v_admin_branches := public.erp__admin_branch_ids(v_org);
  v_student := public.erp_my_student_id();
  if v_org_role is not null then
    select coalesce(array_agg(id order by created_at), '{}'::uuid[]) into v_branch_ids
      from public.erp_branches where org_id = v_org;
  else
    select coalesce(array_agg(distinct bm.branch_id), '{}'::uuid[]) into v_branch_ids
      from public.erp_branch_members bm
      join public.erp_branches b on b.id = bm.branch_id
     where bm.user_id = auth.uid() and bm.status = 'active' and b.org_id = v_org
       and (
         bm.role = 'admin'
         or (bm.role = 'instructor' and bm.instructor_id = public.erp_my_instructor_id())
         or (bm.role = 'student' and bm.student_id = v_student)
       );
  end if;
  v_primary_role := case
    when 'owner' = any(v_roles) then 'owner'
    when 'co_owner' = any(v_roles) then 'co_owner'
    when 'admin' = any(v_roles) then 'admin'
    when 'instructor' = any(v_roles) then 'instructor'
    when 'student' = any(v_roles) then 'student'
    else null
  end;
  return jsonb_build_object(
    'organizationId', v_org,
    'organizationName', coalesce(v_name, ''),
    'roles', to_jsonb(v_roles),
    'primaryRole', v_primary_role,
    'orgRole', v_org_role,
    'adminBranchIds', to_jsonb(v_admin_branches),
    'branchIds', to_jsonb(v_branch_ids),
    'instructorId', public.erp_my_instructor_id(),
    'studentId', v_student
  );
end $$;

-- ----------------------------------------------------------------------------
-- One bounded snapshot for all screens (one call per load / per mutation).
-- Visibility: org managers see their org; branch admins their branches;
-- instructors their batches + enrolled students; students only themselves.
-- ----------------------------------------------------------------------------
create or replace function public.erp_get_snapshot()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid; v_roles text[]; v_org_mgr boolean; v_student uuid; v_instructor uuid;
  v_branches uuid[]; v_admin_branches uuid[];
begin
  v_org := public.erp__require_org();
  v_roles := public.erp_my_roles();
  v_org_mgr := public.erp__is_org_manager(v_org);
  v_student := public.erp_my_student_id();
  v_instructor := public.erp_my_instructor_id();
  v_admin_branches := public.erp__admin_branch_ids(v_org);
  if v_org_mgr then
    select coalesce(array_agg(id), '{}') into v_branches
      from public.erp_branches where org_id = v_org;
  else
    select coalesce(array_agg(distinct branch_id), '{}') into v_branches
      from public.erp_branch_members bm join public.erp_branches b on b.id = bm.branch_id
     where bm.user_id = auth.uid() and bm.status = 'active' and b.org_id = v_org
       and (
         bm.role = 'admin'
         or (bm.role = 'instructor' and bm.instructor_id = v_instructor)
         or (bm.role = 'student' and bm.student_id = v_student)
       );
  end if;

  return jsonb_build_object(
    'branches', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'city', city, 'address', address, 'phone', phone,
        'status', status, 'createdAt', created_at, 'updatedAt', updated_at, 'syncVersion', sync_version) order by created_at), '[]')
      from public.erp_branches where org_id = v_org and id = any(v_branches)),
    'students', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'branchId', s.branch_id, 'firstName', s.first_name,
        'lastName', s.last_name, 'fullName', s.full_name, 'phone', s.phone,
        'email', s.email, 'gender', s.gender, 'dob', coalesce(s.dob::text, ''),
        'joiningDate', s.joining_date::text, 'status', s.status, 'notes', s.notes,
        'address', s.address, 'pinCode', s.pin_code,
        'admissionSubject', s.admission_subject, 'referredBy', s.referred_by,
        'yogaExperience', s.yoga_experience,
        -- Medical / physical details are manager-and-self-only. Instructors
        -- receive the roster fields they need, never this free-text field.
        'medicalPhysicalIssue', case
          when v_org_mgr or s.branch_id = any(v_admin_branches)
            or (v_student is not null and s.id = v_student)
            then s.medical_physical_issue else '' end,
        'reasonToJoin', s.reason_to_join,
        -- Portal fields are manager-only metadata, never part of the student
        -- record's offline-sync payload. Other roles receive "hidden".
        'portalAccessStatus', case
          when v_org_mgr or s.branch_id = any(v_admin_branches)
            then coalesce(pa.portal_status, 'none') else 'hidden' end,
        'portalAccessEmail', case
          when v_org_mgr or s.branch_id = any(v_admin_branches)
            then coalesce(pa.portal_email, '') else '' end,
        'createdAt', s.created_at, 'updatedAt', s.updated_at, 'syncVersion', s.sync_version) order by s.full_name), '[]')
      from public.erp_students s
      left join lateral (
        select bm.status as portal_status, coalesce(u.email::text, '') as portal_email
          from public.erp_branch_members bm
          join public.erp_branches pb on pb.id = bm.branch_id and pb.org_id = v_org
          join auth.users u on u.id = bm.user_id
         where bm.student_id = s.id and bm.role = 'student'
           and (v_org_mgr or s.branch_id = any(v_admin_branches))
         order by case bm.status when 'active' then 0 else 1 end, bm.created_at desc
         limit 1
      ) pa on true
     where s.org_id = v_org and s.branch_id = any(v_branches)
       and (v_org_mgr or s.branch_id = any(v_admin_branches)
            or (v_student is not null and s.id = v_student)
            or (v_instructor is not null and exists (
              select 1 from public.erp_enrollments e join public.erp_batches bt on bt.id = e.batch_id
               where e.student_id = s.id and e.status = 'active' and bt.instructor_id = v_instructor
                 and bt.org_id = v_org and bt.branch_id = any(v_branches))))),
    'instructors', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'branchId', coalesce(i.branch_id::text, ''), 'fullName', i.full_name,
        'phone', i.phone, 'email', i.email, 'status', i.status, 'createdAt', i.created_at, 'updatedAt', i.updated_at, 'syncVersion', i.sync_version)
        order by i.full_name), '[]')
      from public.erp_instructors i
     where i.org_id = v_org
       and (
         v_org_mgr
         or (cardinality(v_admin_branches) > 0 and (
           i.branch_id is null or i.branch_id = any(v_admin_branches)
           or exists (select 1 from public.erp_batches bt
                       where bt.instructor_id = i.id and bt.org_id = v_org
                         and bt.branch_id = any(v_admin_branches))))
         or (v_instructor is not null and i.id = v_instructor)
         or (v_student is not null and exists (
           select 1 from public.erp_enrollments e
             join public.erp_batches bt on bt.id = e.batch_id
            where e.student_id = v_student and e.status = 'active'
              and bt.instructor_id = i.id))
       )),
    'batches', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', bt.id, 'branchId', bt.branch_id, 'name', bt.name,
        'instructorId', coalesce(bt.instructor_id::text, ''), 'days', to_jsonb(bt.days),
        'startTime', to_char(bt.start_time, 'HH24:MI'), 'durationMins', bt.duration_mins,
        'capacity', bt.capacity, 'status', bt.status, 'createdAt', bt.created_at, 'updatedAt', bt.updated_at, 'syncVersion', bt.sync_version)
        order by bt.start_time), '[]')
      from public.erp_batches bt
     where bt.org_id = v_org and bt.branch_id = any(v_branches)
       and (v_org_mgr or bt.branch_id = any(v_admin_branches)
            or (v_instructor is not null and bt.instructor_id = v_instructor)
            or (v_student is not null and exists (
              select 1 from public.erp_enrollments e
               where e.batch_id = bt.id and e.student_id = v_student and e.status = 'active')))),
    'enrollments', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'batchId', e.batch_id, 'studentId', e.student_id,
        'joinedOn', e.joined_on::text, 'status', e.status, 'createdAt', e.created_at, 'updatedAt', e.updated_at, 'syncVersion', e.sync_version)), '[]')
      from public.erp_enrollments e join public.erp_batches bt on bt.id = e.batch_id
     where e.org_id = v_org and bt.branch_id = any(v_branches)
       and (v_org_mgr or bt.branch_id = any(v_admin_branches)
            or (v_instructor is not null and bt.instructor_id = v_instructor)
            or (v_student is not null and e.student_id = v_student))),
    'attendance', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'batchId', a.batch_id, 'studentId', a.student_id,
        'classDate', a.class_date::text, 'status', a.status, 'updatedAt', a.updated_at, 'syncVersion', a.sync_version)
        order by a.class_date desc), '[]')
      from public.erp_attendance a join public.erp_batches bt on bt.id = a.batch_id
     where a.org_id = v_org and bt.branch_id = any(v_branches)
       and (v_org_mgr or bt.branch_id = any(v_admin_branches)
            or (v_instructor is not null and bt.instructor_id = v_instructor)
            or (v_student is not null and a.student_id = v_student))),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'amountPaise', amount_paise,
        'durationMonths', duration_months, 'planType', plan_type,
        'billingCycle', billing_cycle, 'renewalEnabledDefault', renewal_enabled_default,
        'status', status, 'createdAt', created_at, 'updatedAt', updated_at, 'syncVersion', sync_version)
        order by created_at), '[]')
      from public.erp_plans where org_id = v_org
        and (v_org_mgr or cardinality(v_admin_branches) > 0 or v_student is not null)),
    'memberships', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'studentId', m.student_id, 'planId', m.plan_id, 'branchId', m.branch_id,
        'startDate', m.start_date::text, 'endDate', m.end_date::text,
        'billingCycle', m.billing_cycle, 'durationMonths', m.duration_months,
        'amountPaise', m.amount_paise, 'status', m.status, 'offeringType', m.offering_type,
        'autoRenew', m.auto_renew, 'previousMembershipId', coalesce(m.previous_membership_id::text, ''),
        'renewalNumber', m.renewal_number, 'pausedFrom', coalesce(m.paused_from::text, ''),
        'pausedUntil', coalesce(m.paused_until::text, ''), 'pauseReason', m.pause_reason,
        'totalPausedDays', m.total_paused_days, 'cancelledAt', m.cancelled_at,
        'cancelReason', m.cancel_reason,
        'createdAt', m.created_at, 'updatedAt', m.updated_at, 'syncVersion', m.sync_version)
        order by m.end_date), '[]')
      from public.erp_memberships m
     where m.org_id = v_org and m.branch_id = any(v_branches)
       and (v_org_mgr or m.branch_id = any(v_admin_branches)
            or (v_student is not null and m.student_id = v_student))),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'studentId', p.student_id, 'membershipId', coalesce(p.membership_id::text, ''),
        'branchId', coalesce(p.branch_id::text, ''), 'amountPaise', p.amount_paise,
        'method', p.method, 'paidOn', p.paid_on::text, 'note', p.note,
        'receiptNo', p.receipt_no, 'status', p.status, 'voidReason', p.void_reason, 'voidedAt', p.voided_at, 'createdAt', p.created_at, 'updatedAt', p.updated_at, 'syncVersion', p.sync_version) order by p.paid_on desc), '[]')
      from public.erp_payments p
     where p.org_id = v_org and (p.branch_id is null or p.branch_id = any(v_branches))
       and (v_org_mgr or p.branch_id = any(v_admin_branches)
            or (v_student is not null and p.student_id = v_student))),
    'billingSettings', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', bs.id, 'legalName', bs.legal_name, 'email', bs.email, 'phone', bs.phone,
        'address', bs.address, 'city', bs.city, 'state', bs.state_name,
        'stateCode', bs.state_code, 'pinCode', bs.pin_code,
        'gstEnabled', bs.gst_enabled, 'gstin', bs.gstin,
        'gstRatePercent', bs.gst_rate_percent, 'sacCode', bs.sac_code,
        'priceIncludesGst', bs.price_includes_gst,
        'invoicePrefix', bs.invoice_prefix, 'dueDays', bs.due_days, 'terms', bs.terms,
        'upiId', bs.upi_id, 'upiPayeeName', bs.upi_payee_name,
        'bankName', bs.bank_name, 'bankAccountName', bs.bank_account_name,
        'bankAccountNumber', bs.bank_account_number,
        'bankAccountType', bs.bank_account_type, 'ifsc', bs.ifsc,
        'gatewayProvider', bs.gateway_provider,
        'gatewayEnvironment', bs.gateway_environment,
        'gatewayPublicKeyId', bs.gateway_public_key_id,
        'gatewayWebhookUrl', bs.gateway_webhook_url,
        'gatewayWebhookConfigured', bs.gateway_webhook_configured,
        'status', bs.status, 'createdAt', bs.created_at,
        'updatedAt', bs.updated_at, 'syncVersion', bs.sync_version)), '[]')
      from public.erp_billing_settings bs
     where bs.org_id = v_org
       -- Managers configure it; linked students may receive it so their own
       -- due invoice/receipt can show the studio's payment instructions.
       and (v_org_mgr or cardinality(v_admin_branches) > 0 or v_student is not null))
  );
end $$;

-- ----------------------------------------------------------------------------
-- Mutations (manager = Owner / Co-Owner / branch Admin unless noted)
-- ----------------------------------------------------------------------------
create or replace function public.erp_save_branch(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  v_org := public.erp__require_manager();
  v_id := nullif(p_payload->>'id', '')::uuid;
  if nullif(trim(p_payload->>'name'), '') is null then raise exception 'VALIDATION_FAILED: name'; end if;
  if v_id is null then
    if not public.erp__is_org_manager(v_org) then raise exception 'FORBIDDEN'; end if;
  else
    perform public.erp__require_branch_manager(v_org, v_id);
  end if;
  if v_id is null then
    insert into public.erp_branches(org_id, name, city, address, phone)
    values (v_org, trim(p_payload->>'name'), coalesce(p_payload->>'city', ''),
            coalesce(p_payload->>'address', ''), coalesce(p_payload->>'phone', ''))
    returning id into v_id;
  else
    update public.erp_branches set name = trim(p_payload->>'name'),
      city = coalesce(p_payload->>'city', ''), address = coalesce(p_payload->>'address', ''),
      phone = coalesce(p_payload->>'phone', '')
     where id = v_id and org_id = v_org;
    if not found then raise exception 'FORBIDDEN'; end if;
  end if;
  perform public.erp__log(v_org, 'save', 'branch', v_id);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.erp_archive_branch(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := public.erp__require_manager();
  perform public.erp__require_branch_manager(v_org, p_id);
  update public.erp_branches
     set status = case status when 'archived' then 'active' else 'archived' end
   where id = p_id and org_id = v_org;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform public.erp__log(v_org, 'archive_toggle', 'branch', p_id);
  return jsonb_build_object('id', p_id);
end $$;

create or replace function public.erp_save_student(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_id uuid; v_branch uuid; v_current_branch uuid;
  v_first_name text := btrim(coalesce(p_payload->>'firstName', ''));
  v_last_name text := btrim(coalesce(p_payload->>'lastName', ''));
  v_full_name text := btrim(coalesce(nullif(btrim(concat_ws(' ', nullif(btrim(coalesce(p_payload->>'firstName', '')), ''), nullif(btrim(coalesce(p_payload->>'lastName', '')), ''))), ''), p_payload->>'fullName', ''));
  v_experience text := coalesce(nullif(p_payload->>'yogaExperience', ''), '');
begin
  v_org := public.erp__require_manager();
  v_id := nullif(p_payload->>'id', '')::uuid;
  v_branch := nullif(p_payload->>'branchId', '')::uuid;
  if v_first_name = '' and v_full_name <> '' then
    v_first_name := split_part(v_full_name, ' ', 1);
    v_last_name := btrim(regexp_replace(v_full_name, '^[^ ]+\s*', ''));
  end if;
  if v_full_name = '' or v_branch is null then
    raise exception 'VALIDATION_FAILED: fullName/branchId';
  end if;
  if v_experience not in ('', 'experienced', 'no_experience', 'less_experienced') then
    raise exception 'VALIDATION_FAILED: yogaExperience';
  end if;
  perform public.erp__require_branch_manager(v_org, v_branch);
  if v_id is not null then
    select branch_id into v_current_branch from public.erp_students
     where id = v_id and org_id = v_org;
    if v_current_branch is null then raise exception 'FORBIDDEN'; end if;
    perform public.erp__require_branch_manager(v_org, v_current_branch);
  end if;
  if v_id is null then
    insert into public.erp_students(
      org_id, branch_id, first_name, last_name, full_name, phone, email,
      gender, dob, joining_date, notes, address, pin_code, admission_subject,
      referred_by, yoga_experience, medical_physical_issue, reason_to_join)
    values (v_org, v_branch, v_first_name, v_last_name, v_full_name,
            coalesce(p_payload->>'phone', ''), coalesce(p_payload->>'email', ''),
            coalesce(p_payload->>'gender', ''), nullif(p_payload->>'dob', '')::date,
            coalesce(nullif(p_payload->>'joiningDate', '')::date, current_date),
            coalesce(p_payload->>'notes', ''), coalesce(p_payload->>'address', ''),
            coalesce(p_payload->>'pinCode', ''), coalesce(p_payload->>'admissionSubject', ''),
            coalesce(p_payload->>'referredBy', ''), v_experience,
            coalesce(p_payload->>'medicalPhysicalIssue', ''),
            coalesce(p_payload->>'reasonToJoin', ''))
    returning id into v_id;
  else
    update public.erp_students set branch_id = v_branch,
      first_name = v_first_name, last_name = v_last_name, full_name = v_full_name,
      phone = coalesce(p_payload->>'phone', ''), email = coalesce(p_payload->>'email', ''),
      gender = coalesce(p_payload->>'gender', ''), dob = nullif(p_payload->>'dob', '')::date,
      joining_date = coalesce(nullif(p_payload->>'joiningDate', '')::date, joining_date),
      notes = coalesce(p_payload->>'notes', ''), address = coalesce(p_payload->>'address', ''),
      pin_code = coalesce(p_payload->>'pinCode', ''),
      admission_subject = coalesce(p_payload->>'admissionSubject', ''),
      referred_by = coalesce(p_payload->>'referredBy', ''), yoga_experience = v_experience,
      medical_physical_issue = coalesce(p_payload->>'medicalPhysicalIssue', ''),
      reason_to_join = coalesce(p_payload->>'reasonToJoin', '')
     where id = v_id and org_id = v_org;
    if not found then raise exception 'FORBIDDEN'; end if;
  end if;
  perform public.erp__log(v_org, 'save', 'student', v_id);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.erp_archive_student(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_branch uuid;
begin
  v_org := public.erp__require_manager();
  select branch_id into v_branch from public.erp_students where id = p_id and org_id = v_org;
  if v_branch is null then raise exception 'FORBIDDEN'; end if;
  perform public.erp__require_branch_manager(v_org, v_branch);
  update public.erp_students
     set status = case status when 'inactive' then 'active' else 'inactive' end
   where id = p_id and org_id = v_org;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform public.erp__log(v_org, 'status_toggle', 'student', p_id);
  return jsonb_build_object('id', p_id);
end $$;

-- ----------------------------------------------------------------------------
-- Student portal access (SQL v4)
--
-- The student first creates and confirms a normal Supabase account in the
-- app. An Owner/organization manager, or an Admin of that student's branch,
-- then calls this RPC with the exact sign-in email. The server—not the
-- browser—resolves the email to auth.users, checks confirmation and creates
-- the active branch-member student link. Access changes are deliberately
-- online-only in the client and are never placed in the offline outbox.
-- ----------------------------------------------------------------------------
create or replace function public.erp_grant_student_access(p_student_id uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_student public.erp_students%rowtype;
  v_branch_status text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user_id uuid;
  v_auth_email text;
  v_confirmed_at timestamptz;
  v_banned_until timestamptz;
  v_deleted_at timestamptz;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp_current_org();
  if v_org is null then raise exception 'NO_ORGANIZATION: create or join an organization first'; end if;
  if p_student_id is null or length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'VALIDATION_FAILED: student sign-in email';
  end if;

  -- Serialize access changes for this organization. Together with the row
  -- lock below, this prevents two simultaneous grants from linking one
  -- account to two students (or one student to two accounts).
  perform pg_advisory_xact_lock(hashtextextended('erp-role-access:' || v_org::text, 0));

  select * into v_student
    from public.erp_students
   where id = p_student_id and org_id = v_org
   for update;
  if v_student.id is null then raise exception 'FORBIDDEN'; end if;

  if not (
    exists (select 1 from public.erp_org_members
             where org_id = v_org and user_id = v_actor and status = 'active')
    or exists (select 1 from public.erp_branch_members
                where branch_id = v_student.branch_id and user_id = v_actor
                  and role = 'admin' and status = 'active')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  if v_student.status <> 'active' then raise exception 'STUDENT_INACTIVE'; end if;
  select status into v_branch_status
    from public.erp_branches
   where id = v_student.branch_id and org_id = v_org;
  if v_branch_status is null then raise exception 'FORBIDDEN'; end if;
  if v_branch_status <> 'active' then raise exception 'STUDENT_BRANCH_ARCHIVED'; end if;

  select id, email::text, coalesce(email_confirmed_at, confirmed_at), banned_until, deleted_at
    into v_user_id, v_auth_email, v_confirmed_at, v_banned_until, v_deleted_at
    from auth.users
   where lower(email::text) = v_email
   order by coalesce(email_confirmed_at, confirmed_at) desc nulls last, created_at
   limit 1;
  if v_user_id is null or v_deleted_at is not null
     or (v_banned_until is not null and v_banned_until > now()) then
    raise exception 'STUDENT_ACCOUNT_NOT_FOUND';
  end if;
  if v_confirmed_at is null then raise exception 'STUDENT_ACCOUNT_UNCONFIRMED'; end if;

  -- A student sign-in must be a dedicated account. The current product
  -- resolves one organization per account, with organization membership
  -- taking precedence over branch membership; linking an owner/manager of
  -- another organization would therefore look successful but open the wrong
  -- workspace.
  if exists (select 1 from public.erp_org_members
              where user_id = v_user_id and status = 'active') then
    raise exception 'STUDENT_ACCOUNT_IS_MANAGER';
  end if;
  if exists (select 1 from public.erp_branch_members bm
               join public.erp_branches b on b.id = bm.branch_id
              where bm.user_id = v_user_id and bm.status = 'active' and b.org_id <> v_org) then
    raise exception 'STUDENT_ACCOUNT_OTHER_ORG';
  end if;
  if exists (select 1 from public.erp_branch_members bm
               join public.erp_branches b on b.id = bm.branch_id
              where bm.user_id = v_user_id and bm.role = 'student' and bm.status = 'active'
                and b.org_id = v_org and bm.student_id is distinct from p_student_id) then
    raise exception 'STUDENT_ACCOUNT_ALREADY_LINKED';
  end if;
  if exists (select 1 from public.erp_branch_members bm
               join public.erp_branches b on b.id = bm.branch_id
              where bm.user_id = v_user_id and bm.role <> 'student' and bm.status = 'active'
                and b.org_id = v_org) then
    raise exception 'STUDENT_ACCOUNT_ALREADY_LINKED';
  end if;

  -- Granting a different email intentionally replaces this student's old
  -- sign-in. Suspend (do not delete) the previous link for audit/history.
  update public.erp_branch_members bm
     set status = 'suspended'
   where bm.student_id = p_student_id and bm.role = 'student' and bm.status = 'active'
     and bm.user_id <> v_user_id
     and exists (select 1 from public.erp_branches b
                  where b.id = bm.branch_id and b.org_id = v_org);

  -- Repair any manually-created duplicate for this same student/account in
  -- another branch before upserting the one correct branch link.
  update public.erp_branch_members bm
     set status = 'suspended'
   where bm.student_id = p_student_id and bm.user_id = v_user_id
     and bm.role = 'student' and bm.status = 'active'
     and bm.branch_id <> v_student.branch_id
     and exists (select 1 from public.erp_branches b
                  where b.id = bm.branch_id and b.org_id = v_org);

  insert into public.erp_branch_members(branch_id, user_id, role, student_id, status)
  values (v_student.branch_id, v_user_id, 'student', p_student_id, 'active')
  on conflict (branch_id, user_id, role) do update
    set student_id = excluded.student_id, status = 'active';

  insert into public.erp_audit_log(org_id, actor, action, entity, entity_id, detail)
  values (v_org, v_actor, 'grant_student_access', 'student', p_student_id,
          jsonb_build_object('studentUserId', v_user_id, 'email', lower(v_auth_email)));

  return jsonb_build_object(
    'studentId', p_student_id,
    'studentUserId', v_user_id,
    'email', lower(v_auth_email),
    'portalAccessStatus', 'active');
end $$;

create or replace function public.erp_revoke_student_access(p_student_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_student public.erp_students%rowtype;
  v_count integer := 0;
  v_email text := '';
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp_current_org();
  if v_org is null then raise exception 'NO_ORGANIZATION: create or join an organization first'; end if;
  if p_student_id is null then raise exception 'VALIDATION_FAILED: student'; end if;

  perform pg_advisory_xact_lock(hashtextextended('erp-role-access:' || v_org::text, 0));

  select * into v_student
    from public.erp_students
   where id = p_student_id and org_id = v_org
   for update;
  if v_student.id is null then raise exception 'FORBIDDEN'; end if;

  if not (
    exists (select 1 from public.erp_org_members
             where org_id = v_org and user_id = v_actor and status = 'active')
    or exists (select 1 from public.erp_branch_members
                where branch_id = v_student.branch_id and user_id = v_actor
                  and role = 'admin' and status = 'active')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(lower(u.email::text), '') into v_email
    from public.erp_branch_members bm
    join public.erp_branches b on b.id = bm.branch_id and b.org_id = v_org
    join auth.users u on u.id = bm.user_id
   where bm.student_id = p_student_id and bm.role = 'student' and bm.status = 'active'
   order by bm.created_at desc
   limit 1;

  update public.erp_branch_members bm
     set status = 'suspended'
   where bm.student_id = p_student_id and bm.role = 'student' and bm.status = 'active'
     and exists (select 1 from public.erp_branches b
                  where b.id = bm.branch_id and b.org_id = v_org);
  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into public.erp_audit_log(org_id, actor, action, entity, entity_id, detail)
    values (v_org, v_actor, 'revoke_student_access', 'student', p_student_id,
            jsonb_build_object('email', coalesce(v_email, ''), 'linksSuspended', v_count));
  end if;

  return jsonb_build_object(
    'studentId', p_student_id,
    'email', coalesce(v_email, ''),
    'portalAccessStatus', case when v_count > 0 then 'suspended' else 'none' end,
    'linksSuspended', v_count);
end $$;

-- ----------------------------------------------------------------------------
-- Public Student admissions (SQL v6)
--
-- The shareable link contains only the organization admission code. The
-- applicant first creates/confirms a normal account with "Join an existing
-- studio" and signs in; these RPCs derive identity from auth.uid(), use the
-- account email as the future portal sign-in, and never accept anonymous
-- business-data writes. A manager selects the branch/joining date during
-- review. Confirmation inserts the Student and calls the existing audited,
-- server-checked Student portal grant in the same transaction.
-- ----------------------------------------------------------------------------
create or replace function public.erp__admission_json(p_admission public.erp_admissions)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p_admission.id,
    'organizationId', p_admission.org_id,
    'applicantUserId', p_admission.applicant_user_id,
    'firstName', p_admission.first_name,
    'lastName', p_admission.last_name,
    'fullName', btrim(concat_ws(' ', p_admission.first_name, p_admission.last_name)),
    'dob', p_admission.dob::text,
    'phone', p_admission.phone,
    'subject', p_admission.subject,
    'email', p_admission.email,
    'address', p_admission.address,
    'pinCode', p_admission.pin_code,
    'referredBy', p_admission.referred_by,
    'yogaExperience', p_admission.yoga_experience,
    'medicalPhysicalIssue', p_admission.medical_physical_issue,
    'reasonToJoin', p_admission.reason_to_join,
    'status', p_admission.status,
    'branchId', p_admission.branch_id,
    'studentId', p_admission.student_id,
    'submittedAt', p_admission.submitted_at,
    'updatedAt', p_admission.updated_at,
    'reviewedBy', p_admission.reviewed_by,
    'reviewedAt', p_admission.reviewed_at,
    'reviewNote', p_admission.review_note)
$$;

create or replace function public.erp__admission_org(p_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.erp_organizations
   where admission_code = lower(btrim(coalesce(p_code, '')))
   limit 1
$$;

create or replace function public.erp_get_my_admission(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_org_name text := '';
  v_email text := '';
  v_admission public.erp_admissions%rowtype;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp__admission_org(p_code);
  if v_org is null then raise exception 'ADMISSION_LINK_INVALID'; end if;
  select name into v_org_name from public.erp_organizations where id = v_org;
  select coalesce(lower(email::text), '') into v_email
    from auth.users where id = v_actor;
  select * into v_admission
    from public.erp_admissions
   where org_id = v_org and applicant_user_id = v_actor
   order by case status when 'pending' then 0 when 'confirmed' then 1 else 2 end,
            submitted_at desc
   limit 1;
  return jsonb_build_object(
    'target', jsonb_build_object(
      'organizationId', v_org,
      'organizationName', coalesce(v_org_name, ''),
      'admissionCode', lower(btrim(coalesce(p_code, '')))),
    'applicantEmail', coalesce(v_email, ''),
    'admission', case when v_admission.id is null then null
                      else public.erp__admission_json(v_admission) end);
end $$;

create or replace function public.erp_submit_admission(p_code text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_auth_email text := '';
  v_confirmed_at timestamptz;
  v_banned_until timestamptz;
  v_deleted_at timestamptz;
  v_first_name text := btrim(coalesce(p_payload->>'firstName', ''));
  v_last_name text := btrim(coalesce(p_payload->>'lastName', ''));
  v_dob_text text := btrim(coalesce(p_payload->>'dob', ''));
  v_dob date;
  v_phone text := btrim(coalesce(p_payload->>'phone', ''));
  v_subject text := btrim(coalesce(p_payload->>'subject', ''));
  v_email text := lower(btrim(coalesce(p_payload->>'email', '')));
  v_address text := btrim(coalesce(p_payload->>'address', ''));
  v_pin_code text := btrim(coalesce(p_payload->>'pinCode', ''));
  v_referred_by text := btrim(coalesce(p_payload->>'referredBy', ''));
  v_experience text := btrim(coalesce(p_payload->>'yogaExperience', ''));
  v_medical text := btrim(coalesce(p_payload->>'medicalPhysicalIssue', ''));
  v_reason text := btrim(coalesce(p_payload->>'reasonToJoin', ''));
  v_existing public.erp_admissions%rowtype;
  v_saved public.erp_admissions%rowtype;
  v_action text := 'submit_admission';
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'VALIDATION_FAILED: admission';
  end if;
  v_org := public.erp__admission_org(p_code);
  if v_org is null then raise exception 'ADMISSION_LINK_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended('erp-admissions:' || v_org::text, 0));

  select lower(email::text), coalesce(email_confirmed_at, confirmed_at),
         banned_until, deleted_at
    into v_auth_email, v_confirmed_at, v_banned_until, v_deleted_at
    from auth.users where id = v_actor;
  if v_auth_email is null or v_deleted_at is not null
     or (v_banned_until is not null and v_banned_until > now()) then
    raise exception 'ADMISSION_ACCOUNT_UNAVAILABLE';
  end if;
  if v_confirmed_at is null then raise exception 'ADMISSION_ACCOUNT_UNCONFIRMED'; end if;
  if exists (select 1 from public.erp_org_members
              where user_id = v_actor and status = 'active')
     or exists (select 1 from public.erp_branch_members
                 where user_id = v_actor and status = 'active') then
    raise exception 'ADMISSION_ACCOUNT_ALREADY_LINKED';
  end if;

  if length(v_first_name) not between 1 and 80 then raise exception 'VALIDATION_FAILED: firstName'; end if;
  if length(v_last_name) not between 1 and 80 then raise exception 'VALIDATION_FAILED: lastName'; end if;
  if v_dob_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'VALIDATION_FAILED: dob'; end if;
  v_dob := v_dob_text::date;
  if v_dob < date '1900-01-01' or v_dob > current_date then raise exception 'VALIDATION_FAILED: dob'; end if;
  if length(v_phone) not between 7 and 25 or v_phone !~ '^[+0-9][0-9 ()-]{6,24}$' then
    raise exception 'VALIDATION_FAILED: phone';
  end if;
  if length(v_subject) not between 1 and 160 then raise exception 'VALIDATION_FAILED: subject'; end if;
  if v_email <> lower(v_auth_email) then raise exception 'ADMISSION_EMAIL_MISMATCH'; end if;
  if length(v_address) not between 1 and 500 then raise exception 'VALIDATION_FAILED: address'; end if;
  if v_pin_code !~ '^[0-9]{6}$' then raise exception 'VALIDATION_FAILED: pinCode'; end if;
  if length(v_referred_by) > 120 then raise exception 'VALIDATION_FAILED: referredBy'; end if;
  if v_experience not in ('experienced', 'no_experience', 'less_experienced') then
    raise exception 'VALIDATION_FAILED: yogaExperience';
  end if;
  if length(v_medical) not between 1 and 2000 then
    raise exception 'VALIDATION_FAILED: medicalPhysicalIssue';
  end if;
  if length(v_reason) not between 1 and 2000 then raise exception 'VALIDATION_FAILED: reasonToJoin'; end if;

  if exists (select 1 from public.erp_admissions
              where org_id = v_org and lower(email) = v_email
                and applicant_user_id <> v_actor and status = 'pending') then
    raise exception 'ADMISSION_DUPLICATE_PENDING';
  end if;

  select * into v_existing
    from public.erp_admissions
   where org_id = v_org and applicant_user_id = v_actor
   order by case status when 'pending' then 0 when 'confirmed' then 1 else 2 end,
            submitted_at desc
   limit 1
   for update;
  if v_existing.status = 'confirmed' then raise exception 'ADMISSION_ALREADY_CONFIRMED'; end if;

  if v_existing.id is not null then
    v_action := case when v_existing.status = 'rejected'
                     then 'resubmit_admission' else 'update_admission' end;
    update public.erp_admissions set
      first_name = v_first_name, last_name = v_last_name, dob = v_dob,
      phone = v_phone, subject = v_subject, email = v_email, address = v_address,
      pin_code = v_pin_code, referred_by = v_referred_by,
      yoga_experience = v_experience, medical_physical_issue = v_medical,
      reason_to_join = v_reason, status = 'pending', branch_id = null,
      student_id = null, submitted_at = case when status = 'rejected' then now() else submitted_at end,
      updated_at = now(), reviewed_by = null, reviewed_at = null, review_note = ''
     where id = v_existing.id
     returning * into v_saved;
  else
    insert into public.erp_admissions(
      org_id, applicant_user_id, first_name, last_name, dob, phone, subject,
      email, address, pin_code, referred_by, yoga_experience,
      medical_physical_issue, reason_to_join)
    values (v_org, v_actor, v_first_name, v_last_name, v_dob, v_phone,
            v_subject, v_email, v_address, v_pin_code, v_referred_by,
            v_experience, v_medical, v_reason)
    returning * into v_saved;
  end if;

  insert into public.erp_audit_log(org_id, actor, action, entity, entity_id, detail)
  values (v_org, v_actor, v_action, 'admission', v_saved.id,
          jsonb_build_object('email', v_email, 'status', 'pending'));
  return public.erp__admission_json(v_saved);
end $$;

create or replace function public.erp_get_admission_link_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.erp__require_manager();
  v_name text := '';
  v_code text := '';
begin
  select name, admission_code into v_name, v_code
    from public.erp_organizations where id = v_org;
  return jsonb_build_object(
    'organizationId', v_org,
    'organizationName', coalesce(v_name, ''),
    'admissionCode', coalesce(v_code, ''));
end $$;

create or replace function public.erp_list_admissions(p_status text default 'pending')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.erp__require_manager();
  v_status text := lower(btrim(coalesce(nullif(p_status, ''), 'pending')));
  v_items jsonb := '[]'::jsonb;
begin
  if v_status not in ('pending', 'confirmed', 'rejected', 'all') then
    raise exception 'VALIDATION_FAILED: admission status';
  end if;
  select coalesce(jsonb_agg(item order by submitted_sort desc), '[]'::jsonb)
    into v_items
    from (
      select public.erp__admission_json(a) || jsonb_build_object(
               'possibleDuplicateStudentId', dup.student_id,
               'possibleDuplicateStudentName', coalesce(dup.student_name, '')) as item,
             a.submitted_at as submitted_sort
        from public.erp_admissions a
        left join lateral (
          select s.id as student_id, s.full_name as student_name
            from public.erp_students s
           where s.org_id = v_org and s.email <> ''
             and lower(s.email) = lower(a.email)
             and (a.student_id is null or s.id <> a.student_id)
           order by case s.status when 'active' then 0 else 1 end, s.created_at
           limit 1
        ) dup on true
       where a.org_id = v_org
         and (v_status = 'all' or a.status = v_status)
       order by a.submitted_at desc
       limit 100
    ) bounded;
  return jsonb_build_object('admissions', v_items);
end $$;

create or replace function public.erp_review_admission(
  p_admission_id uuid,
  p_action text,
  p_branch_id uuid default null,
  p_joining_date date default current_date,
  p_review_note text default ''
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_note text := btrim(coalesce(p_review_note, ''));
  v_admission public.erp_admissions%rowtype;
  v_student_id uuid;
  v_branch_status text;
  v_auth_email text := '';
  v_confirmed_at timestamptz;
  v_banned_until timestamptz;
  v_deleted_at timestamptz;
  v_grant jsonb;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_admission_id is null or v_action not in ('confirm', 'reject') or length(v_note) > 500 then
    raise exception 'VALIDATION_FAILED: admission review';
  end if;
  v_org := public.erp__require_manager();

  perform pg_advisory_xact_lock(hashtextextended('erp-role-access:' || v_org::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('erp-admissions:' || v_org::text, 0));
  select * into v_admission
    from public.erp_admissions
   where id = p_admission_id and org_id = v_org
   for update;
  if v_admission.id is null then raise exception 'FORBIDDEN'; end if;
  if v_admission.status <> 'pending' then raise exception 'ADMISSION_NOT_PENDING'; end if;

  if v_action = 'reject' then
    update public.erp_admissions set
      status = 'rejected', reviewed_by = v_actor, reviewed_at = now(),
      review_note = v_note, updated_at = now()
     where id = v_admission.id;
    insert into public.erp_audit_log(org_id, actor, action, entity, entity_id, detail)
    values (v_org, v_actor, 'reject_admission', 'admission', v_admission.id,
            jsonb_build_object('email', v_admission.email, 'reviewNote', v_note));
    return jsonb_build_object(
      'admissionId', v_admission.id, 'status', 'rejected', 'studentId', null,
      'email', v_admission.email, 'portalAccessStatus', 'none');
  end if;

  if p_branch_id is null then raise exception 'VALIDATION_FAILED: admission branch'; end if;
  perform public.erp__require_branch_manager(v_org, p_branch_id);
  select status into v_branch_status
    from public.erp_branches where id = p_branch_id and org_id = v_org;
  if v_branch_status is null then raise exception 'FORBIDDEN'; end if;
  if v_branch_status <> 'active' then raise exception 'STUDENT_BRANCH_ARCHIVED'; end if;
  if coalesce(p_joining_date, current_date) < date '1900-01-01' then
    raise exception 'VALIDATION_FAILED: joiningDate';
  end if;

  select lower(email::text), coalesce(email_confirmed_at, confirmed_at),
         banned_until, deleted_at
    into v_auth_email, v_confirmed_at, v_banned_until, v_deleted_at
    from auth.users where id = v_admission.applicant_user_id;
  if v_auth_email is null or v_deleted_at is not null
     or (v_banned_until is not null and v_banned_until > now()) then
    raise exception 'ADMISSION_ACCOUNT_UNAVAILABLE';
  end if;
  if v_confirmed_at is null then raise exception 'ADMISSION_ACCOUNT_UNCONFIRMED'; end if;
  if lower(v_auth_email) <> lower(v_admission.email) then
    raise exception 'ADMISSION_EMAIL_MISMATCH';
  end if;
  if exists (select 1 from public.erp_org_members
              where user_id = v_admission.applicant_user_id and status = 'active')
     or exists (select 1 from public.erp_branch_members
                 where user_id = v_admission.applicant_user_id and status = 'active') then
    raise exception 'ADMISSION_ACCOUNT_ALREADY_LINKED';
  end if;
  if exists (select 1 from public.erp_students
              where org_id = v_org and email <> ''
                and lower(email) = lower(v_admission.email)) then
    raise exception 'ADMISSION_POSSIBLE_DUPLICATE';
  end if;

  insert into public.erp_students(
    org_id, branch_id, first_name, last_name, full_name, phone, email,
    gender, dob, joining_date, status, notes, address, pin_code,
    admission_subject, referred_by, yoga_experience,
    medical_physical_issue, reason_to_join)
  values (
    v_org, p_branch_id, v_admission.first_name, v_admission.last_name,
    btrim(concat_ws(' ', v_admission.first_name, v_admission.last_name)),
    v_admission.phone, v_admission.email, '', v_admission.dob,
    coalesce(p_joining_date, current_date), 'active', '', v_admission.address,
    v_admission.pin_code, v_admission.subject, v_admission.referred_by,
    v_admission.yoga_experience, v_admission.medical_physical_issue,
    v_admission.reason_to_join)
  returning id into v_student_id;

  v_grant := public.erp_grant_student_access(v_student_id, v_admission.email);
  if nullif(v_grant->>'studentUserId', '')::uuid is distinct from v_admission.applicant_user_id then
    raise exception 'ADMISSION_EMAIL_MISMATCH';
  end if;

  update public.erp_admissions set
    status = 'confirmed', branch_id = p_branch_id, student_id = v_student_id,
    reviewed_by = v_actor, reviewed_at = now(), review_note = v_note,
    updated_at = now()
   where id = v_admission.id;

  insert into public.erp_audit_log(org_id, actor, action, entity, entity_id, detail)
  values (v_org, v_actor, 'confirm_admission', 'admission', v_admission.id,
          jsonb_build_object('studentId', v_student_id, 'branchId', p_branch_id,
                             'email', v_admission.email,
                             'portalAccessStatus', 'active'));
  return jsonb_build_object(
    'admissionId', v_admission.id, 'status', 'confirmed',
    'studentId', v_student_id, 'email', v_admission.email,
    'portalAccessStatus', 'active');
end $$;

-- Role access management (SQL v5)
--
-- Odoo-style fixed security groups, adapted to Yoga Studio's five roles.
-- Every staff user first creates and confirms their own Supabase account;
-- an authorized manager then links that exact email to one fixed ERP role.
-- These access changes are online-only in the client, use one advisory lock
-- per organization and write audit rows. The primary Owner is protected:
-- there is deliberately no RPC in this file that transfers or revokes an
-- Owner. Co-owners manage Admin/Instructor/Student access, while branch
-- Admins manage Instructor/Student access only in their assigned branches.
-- ----------------------------------------------------------------------------
create or replace function public.erp__resolve_access_account(
  p_email text,
  out o_user_id uuid,
  out o_email text
)
returns record language plpgsql stable security definer set search_path = public as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_confirmed_at timestamptz;
  v_banned_until timestamptz;
  v_deleted_at timestamptz;
begin
  if length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'VALIDATION_FAILED: sign-in email';
  end if;
  select id, lower(email::text), coalesce(email_confirmed_at, confirmed_at),
         banned_until, deleted_at
    into o_user_id, o_email, v_confirmed_at, v_banned_until, v_deleted_at
    from auth.users
   where lower(email::text) = v_email
   order by coalesce(email_confirmed_at, confirmed_at) desc nulls last, created_at
   limit 1;
  if o_user_id is null or v_deleted_at is not null
     or (v_banned_until is not null and v_banned_until > now()) then
    raise exception 'ACCESS_ACCOUNT_NOT_FOUND';
  end if;
  if v_confirmed_at is null then
    raise exception 'ACCESS_ACCOUNT_UNCONFIRMED';
  end if;
end $$;

create or replace function public.erp__assert_access_account_available(
  p_org uuid,
  p_user_id uuid,
  p_role text,
  p_instructor_id uuid default null
)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  v_existing_org uuid;
  v_existing_role text;
begin
  select org_id, role into v_existing_org, v_existing_role
    from public.erp_org_members
   where user_id = p_user_id and status = 'active'
   order by case when org_id = p_org then 0 else 1 end, created_at
   limit 1;
  if v_existing_org is not null then
    if v_existing_org <> p_org then
      raise exception 'ACCESS_ACCOUNT_OTHER_ORG';
    end if;
    if v_existing_role = 'owner' then
      raise exception 'ACCESS_ACCOUNT_ALREADY_OWNER';
    end if;
    if not (p_role = 'co_owner' and v_existing_role = 'co_owner') then
      raise exception 'ACCESS_ACCOUNT_ROLE_CONFLICT';
    end if;
  end if;

  if exists (
    select 1 from public.erp_branch_members bm
      join public.erp_branches b on b.id = bm.branch_id
     where bm.user_id = p_user_id and bm.status = 'active' and b.org_id <> p_org
  ) then
    raise exception 'ACCESS_ACCOUNT_OTHER_ORG';
  end if;

  if p_role = 'co_owner' and exists (
    select 1 from public.erp_branch_members bm
      join public.erp_branches b on b.id = bm.branch_id
     where bm.user_id = p_user_id and bm.status = 'active' and b.org_id = p_org
  ) then
    raise exception 'ACCESS_ACCOUNT_ROLE_CONFLICT';
  end if;

  if p_role = 'admin' and exists (
    select 1 from public.erp_branch_members bm
      join public.erp_branches b on b.id = bm.branch_id
     where bm.user_id = p_user_id and bm.status = 'active' and b.org_id = p_org
       and bm.role <> 'admin'
  ) then
    raise exception 'ACCESS_ACCOUNT_ROLE_CONFLICT';
  end if;

  if p_role = 'instructor' and exists (
    select 1 from public.erp_branch_members bm
      join public.erp_branches b on b.id = bm.branch_id
     where bm.user_id = p_user_id and bm.status = 'active' and b.org_id = p_org
       and (bm.role <> 'instructor' or bm.instructor_id is distinct from p_instructor_id)
  ) then
    raise exception 'ACCESS_ACCOUNT_ROLE_CONFLICT';
  end if;
end $$;

create or replace function public.erp_grant_co_owner_access(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_user_id uuid;
  v_auth_email text;
  v_existing_role text;
  v_existing_status text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp_current_org();
  if v_org is null then raise exception 'NO_ORGANIZATION: create or join an organization first'; end if;
  if not public.erp__is_primary_owner(v_org) then raise exception 'FORBIDDEN'; end if;

  perform pg_advisory_xact_lock(hashtextextended('erp-role-access:' || v_org::text, 0));
  select o_user_id, o_email into v_user_id, v_auth_email
    from public.erp__resolve_access_account(p_email);

  select role, status into v_existing_role, v_existing_status
    from public.erp_org_members
   where org_id = v_org and user_id = v_user_id;
  if v_existing_role = 'owner' then
    raise exception 'ACCESS_ACCOUNT_ALREADY_OWNER';
  end if;
  if v_existing_role = 'co_owner' and v_existing_status = 'active' then
    return jsonb_build_object(
      'userId', v_user_id, 'email', v_auth_email, 'role', 'co_owner',
      'status', 'active', 'alreadyActive', true);
  end if;

  perform public.erp__assert_access_account_available(v_org, v_user_id, 'co_owner');
  insert into public.erp_org_members(org_id, user_id, role, status)
  values (v_org, v_user_id, 'co_owner', 'active')
  on conflict (org_id, user_id) do update
    set role = excluded.role, status = 'active';

  insert into public.erp_audit_log(org_id, actor, action, entity, entity_id, detail)
  values (v_org, v_actor, 'grant_co_owner_access', 'access_member', v_user_id,
          jsonb_build_object('email', v_auth_email, 'role', 'co_owner'));

  return jsonb_build_object(
    'userId', v_user_id, 'email', v_auth_email, 'role', 'co_owner',
    'status', 'active', 'alreadyActive', false);
end $$;

create or replace function public.erp_revoke_co_owner_access(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_role text;
  v_email text := '';
  v_count integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp_current_org();
  if v_org is null then raise exception 'NO_ORGANIZATION: create or join an organization first'; end if;
  if p_user_id is null then raise exception 'VALIDATION_FAILED: user'; end if;
  if not public.erp__is_primary_owner(v_org) then raise exception 'FORBIDDEN'; end if;

  perform pg_advisory_xact_lock(hashtextextended('erp-role-access:' || v_org::text, 0));
  select om.role, coalesce(lower(u.email::text), '')
    into v_role, v_email
    from public.erp_org_members om
    join auth.users u on u.id = om.user_id
   where om.org_id = v_org and om.user_id = p_user_id;
  if v_role = 'owner' then raise exception 'PRIMARY_OWNER_PROTECTED'; end if;

  update public.erp_org_members
     set status = 'suspended'
   where org_id = v_org and user_id = p_user_id
     and role = 'co_owner' and status = 'active';
  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into public.erp_audit_log(org_id, actor, action, entity, entity_id, detail)
    values (v_org, v_actor, 'revoke_co_owner_access', 'access_member', p_user_id,
            jsonb_build_object('email', v_email, 'role', 'co_owner'));
  end if;

  return jsonb_build_object(
    'userId', p_user_id, 'email', v_email, 'role', 'co_owner',
    'status', case when v_count > 0 then 'suspended' else 'none' end,
    'linksSuspended', v_count);
end $$;

create or replace function public.erp_grant_admin_access(p_email text, p_branch_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_user_id uuid;
  v_auth_email text;
  v_branch_ids uuid[] := '{}'::uuid[];
  v_branch uuid;
  v_removed integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp_current_org();
  if v_org is null then raise exception 'NO_ORGANIZATION: create or join an organization first'; end if;
  if not public.erp__is_org_manager(v_org) then raise exception 'FORBIDDEN'; end if;

  select coalesce(array_agg(distinct branch_id), '{}'::uuid[]) into v_branch_ids
    from unnest(coalesce(p_branch_ids, '{}'::uuid[])) as requested(branch_id)
   where branch_id is not null;
  if cardinality(v_branch_ids) = 0 or cardinality(v_branch_ids) > 200 then
    raise exception 'ACCESS_BRANCH_REQUIRED';
  end if;
  if exists (
    select 1 from unnest(v_branch_ids) as requested(branch_id)
    left join public.erp_branches b on b.id = requested.branch_id and b.org_id = v_org
    where b.id is null
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if exists (
    select 1 from public.erp_branches
     where id = any(v_branch_ids) and org_id = v_org and status <> 'active'
  ) then
    raise exception 'ACCESS_BRANCH_ARCHIVED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('erp-role-access:' || v_org::text, 0));
  select o_user_id, o_email into v_user_id, v_auth_email
    from public.erp__resolve_access_account(p_email);
  perform public.erp__assert_access_account_available(v_org, v_user_id, 'admin');

  -- The selected branch list is the Admin's complete branch assignment.
  update public.erp_branch_members bm
     set status = 'suspended'
   where bm.user_id = v_user_id and bm.role = 'admin' and bm.status = 'active'
     and not (bm.branch_id = any(v_branch_ids))
     and exists (select 1 from public.erp_branches b
                  where b.id = bm.branch_id and b.org_id = v_org);
  get diagnostics v_removed = row_count;

  foreach v_branch in array v_branch_ids loop
    insert into public.erp_branch_members(
      branch_id, user_id, role, instructor_id, student_id, status)
    values (v_branch, v_user_id, 'admin', null, null, 'active')
    on conflict (branch_id, user_id, role) do update
      set instructor_id = null, student_id = null, status = 'active';
  end loop;

  insert into public.erp_audit_log(org_id, actor, action, entity, entity_id, detail)
  values (v_org, v_actor, 'grant_admin_access', 'access_member', v_user_id,
          jsonb_build_object('email', v_auth_email, 'role', 'admin',
                             'branchIds', to_jsonb(v_branch_ids),
                             'assignmentsRemoved', v_removed));

  return jsonb_build_object(
    'userId', v_user_id, 'email', v_auth_email, 'role', 'admin',
    'status', 'active', 'branchIds', to_jsonb(v_branch_ids),
    'assignmentsRemoved', v_removed);
end $$;

create or replace function public.erp_revoke_admin_access(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_email text := '';
  v_count integer := 0;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp_current_org();
  if v_org is null then raise exception 'NO_ORGANIZATION: create or join an organization first'; end if;
  if p_user_id is null then raise exception 'VALIDATION_FAILED: user'; end if;
  if not public.erp__is_org_manager(v_org) then raise exception 'FORBIDDEN'; end if;

  perform pg_advisory_xact_lock(hashtextextended('erp-role-access:' || v_org::text, 0));
  select coalesce(lower(u.email::text), '') into v_email
    from public.erp_branch_members bm
    join public.erp_branches b on b.id = bm.branch_id and b.org_id = v_org
    join auth.users u on u.id = bm.user_id
   where bm.user_id = p_user_id and bm.role = 'admin'
   order by case bm.status when 'active' then 0 else 1 end, bm.created_at desc
   limit 1;

  update public.erp_branch_members bm
     set status = 'suspended'
   where bm.user_id = p_user_id and bm.role = 'admin' and bm.status = 'active'
     and exists (select 1 from public.erp_branches b
                  where b.id = bm.branch_id and b.org_id = v_org);
  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into public.erp_audit_log(org_id, actor, action, entity, entity_id, detail)
    values (v_org, v_actor, 'revoke_admin_access', 'access_member', p_user_id,
            jsonb_build_object('email', v_email, 'role', 'admin',
                               'linksSuspended', v_count));
  end if;

  return jsonb_build_object(
    'userId', p_user_id, 'email', v_email, 'role', 'admin',
    'status', case when v_count > 0 then 'suspended' else 'none' end,
    'linksSuspended', v_count);
end $$;

create or replace function public.erp__can_manage_instructor_access(
  p_org uuid,
  p_instructor_id uuid
)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.erp__is_org_manager(p_org) or (
    cardinality(public.erp__admin_branch_ids(p_org)) > 0 and exists (
      select 1 from public.erp_instructors i
       where i.id = p_instructor_id and i.org_id = p_org
         and (
           i.branch_id is null
           or i.branch_id = any(public.erp__admin_branch_ids(p_org))
           or exists (select 1 from public.erp_batches bt
                       where bt.instructor_id = i.id and bt.org_id = p_org
                         and bt.branch_id = any(public.erp__admin_branch_ids(p_org)))
           or exists (select 1 from public.erp_branch_members bm
                       where bm.instructor_id = i.id and bm.role = 'instructor'
                         and bm.branch_id = any(public.erp__admin_branch_ids(p_org)))
         ))), false)
$$;

create or replace function public.erp_grant_instructor_access(
  p_instructor_id uuid,
  p_email text,
  p_branch_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_instructor public.erp_instructors%rowtype;
  v_org_manager boolean := false;
  v_actor_branches uuid[] := '{}'::uuid[];
  v_branch_ids uuid[] := '{}'::uuid[];
  v_branch uuid;
  v_user_id uuid;
  v_auth_email text;
  v_effective_branches uuid[] := '{}'::uuid[];
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp_current_org();
  if v_org is null then raise exception 'NO_ORGANIZATION: create or join an organization first'; end if;
  if p_instructor_id is null then raise exception 'VALIDATION_FAILED: instructor'; end if;

  v_org_manager := public.erp__is_org_manager(v_org);
  v_actor_branches := public.erp__admin_branch_ids(v_org);
  if not v_org_manager and cardinality(v_actor_branches) = 0 then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(array_agg(distinct branch_id), '{}'::uuid[]) into v_branch_ids
    from unnest(coalesce(p_branch_ids, '{}'::uuid[])) as requested(branch_id)
   where branch_id is not null;
  if cardinality(v_branch_ids) = 0 or cardinality(v_branch_ids) > 200 then
    raise exception 'INSTRUCTOR_BRANCH_REQUIRED';
  end if;
  if exists (
    select 1 from unnest(v_branch_ids) as requested(branch_id)
    left join public.erp_branches b on b.id = requested.branch_id and b.org_id = v_org
    where b.id is null
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if exists (
    select 1 from public.erp_branches
     where id = any(v_branch_ids) and org_id = v_org and status <> 'active'
  ) then
    raise exception 'ACCESS_BRANCH_ARCHIVED';
  end if;
  if not v_org_manager and not (v_branch_ids <@ v_actor_branches) then
    raise exception 'FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('erp-role-access:' || v_org::text, 0));
  select * into v_instructor
    from public.erp_instructors
   where id = p_instructor_id and org_id = v_org
   for update;
  if v_instructor.id is null then raise exception 'FORBIDDEN'; end if;
  if not public.erp__can_manage_instructor_access(v_org, p_instructor_id) then
    raise exception 'FORBIDDEN';
  end if;
  if v_instructor.status <> 'active' then raise exception 'INSTRUCTOR_INACTIVE'; end if;

  select o_user_id, o_email into v_user_id, v_auth_email
    from public.erp__resolve_access_account(p_email);
  perform public.erp__assert_access_account_available(
    v_org, v_user_id, 'instructor', p_instructor_id);

  if not v_org_manager and exists (
    select 1 from public.erp_branch_members bm
      join public.erp_branches b on b.id = bm.branch_id and b.org_id = v_org
     where bm.instructor_id = p_instructor_id and bm.role = 'instructor'
       and bm.status = 'active' and bm.user_id <> v_user_id
  ) then
    -- A branch Admin may add their branch to the instructor's existing
    -- sign-in, but replacing the person's global sign-in stays with an
    -- organization manager.
    raise exception 'ACCESS_INSTRUCTOR_ALREADY_LINKED';
  end if;

  if v_org_manager then
    update public.erp_branch_members bm
       set status = 'suspended'
     where bm.instructor_id = p_instructor_id and bm.role = 'instructor'
       and bm.status = 'active' and bm.user_id <> v_user_id
       and exists (select 1 from public.erp_branches b
                    where b.id = bm.branch_id and b.org_id = v_org);
    update public.erp_branch_members bm
       set status = 'suspended'
     where bm.instructor_id = p_instructor_id and bm.role = 'instructor'
       and bm.status = 'active' and bm.user_id = v_user_id
       and not (bm.branch_id = any(v_branch_ids))
       and exists (select 1 from public.erp_branches b
                    where b.id = bm.branch_id and b.org_id = v_org);
  else
    update public.erp_branch_members bm
       set status = 'suspended'
     where bm.instructor_id = p_instructor_id and bm.role = 'instructor'
       and bm.status = 'active' and bm.user_id = v_user_id
       and bm.branch_id = any(v_actor_branches)
       and not (bm.branch_id = any(v_branch_ids));
  end if;

  foreach v_branch in array v_branch_ids loop
    insert into public.erp_branch_members(
      branch_id, user_id, role, instructor_id, student_id, status)
    values (v_branch, v_user_id, 'instructor', p_instructor_id, null, 'active')
    on conflict (branch_id, user_id, role) do update
      set instructor_id = excluded.instructor_id, student_id = null, status = 'active';
  end loop;

  select coalesce(array_agg(distinct bm.branch_id), '{}'::uuid[])
    into v_effective_branches
    from public.erp_branch_members bm
    join public.erp_branches b on b.id = bm.branch_id and b.org_id = v_org
   where bm.instructor_id = p_instructor_id and bm.user_id = v_user_id
     and bm.role = 'instructor' and bm.status = 'active';

  insert into public.erp_audit_log(org_id, actor, action, entity, entity_id, detail)
  values (v_org, v_actor, 'grant_instructor_access', 'instructor', p_instructor_id,
          jsonb_build_object('instructorUserId', v_user_id, 'email', v_auth_email,
                             'role', 'instructor', 'branchIds', to_jsonb(v_effective_branches)));

  return jsonb_build_object(
    'instructorId', p_instructor_id, 'userId', v_user_id,
    'email', v_auth_email, 'role', 'instructor', 'status', 'active',
    'branchIds', to_jsonb(v_effective_branches));
end $$;

create or replace function public.erp_revoke_instructor_access(p_instructor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_instructor public.erp_instructors%rowtype;
  v_org_manager boolean := false;
  v_actor_branches uuid[] := '{}'::uuid[];
  v_email text := '';
  v_count integer := 0;
  v_remaining uuid[] := '{}'::uuid[];
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp_current_org();
  if v_org is null then raise exception 'NO_ORGANIZATION: create or join an organization first'; end if;
  if p_instructor_id is null then raise exception 'VALIDATION_FAILED: instructor'; end if;

  v_org_manager := public.erp__is_org_manager(v_org);
  v_actor_branches := public.erp__admin_branch_ids(v_org);
  if not v_org_manager and cardinality(v_actor_branches) = 0 then
    raise exception 'FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('erp-role-access:' || v_org::text, 0));
  select * into v_instructor
    from public.erp_instructors
   where id = p_instructor_id and org_id = v_org
   for update;
  if v_instructor.id is null then raise exception 'FORBIDDEN'; end if;
  if not public.erp__can_manage_instructor_access(v_org, p_instructor_id) then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(lower(u.email::text), '') into v_email
    from public.erp_branch_members bm
    join public.erp_branches b on b.id = bm.branch_id and b.org_id = v_org
    join auth.users u on u.id = bm.user_id
   where bm.instructor_id = p_instructor_id and bm.role = 'instructor'
     and bm.status = 'active'
     and (v_org_manager or bm.branch_id = any(v_actor_branches))
   order by bm.created_at desc
   limit 1;

  update public.erp_branch_members bm
     set status = 'suspended'
   where bm.instructor_id = p_instructor_id and bm.role = 'instructor'
     and bm.status = 'active'
     and exists (select 1 from public.erp_branches b
                  where b.id = bm.branch_id and b.org_id = v_org)
     and (v_org_manager or bm.branch_id = any(v_actor_branches));
  get diagnostics v_count = row_count;

  select coalesce(array_agg(distinct bm.branch_id), '{}'::uuid[])
    into v_remaining
    from public.erp_branch_members bm
    join public.erp_branches b on b.id = bm.branch_id and b.org_id = v_org
   where bm.instructor_id = p_instructor_id and bm.role = 'instructor'
     and bm.status = 'active';

  if v_count > 0 then
    insert into public.erp_audit_log(org_id, actor, action, entity, entity_id, detail)
    values (v_org, v_actor, 'revoke_instructor_access', 'instructor', p_instructor_id,
            jsonb_build_object('email', v_email, 'role', 'instructor',
                               'linksSuspended', v_count,
                               'remainingBranchIds', to_jsonb(v_remaining)));
  end if;

  return jsonb_build_object(
    'instructorId', p_instructor_id, 'email', v_email,
    'role', 'instructor',
    'status', case when cardinality(v_remaining) > 0 then 'active'
                   when v_count > 0 then 'suspended' else 'none' end,
    'linksSuspended', v_count, 'branchIds', to_jsonb(v_remaining));
end $$;

create or replace function public.erp_list_role_access()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_org_manager boolean := false;
  v_primary_owner boolean := false;
  v_org_role text;
  v_roles text[] := '{}';
  v_primary_role text;
  v_admin_branches uuid[] := '{}'::uuid[];
  v_actor_branches uuid[] := '{}'::uuid[];
  v_actor_email text := '';
  v_org_members jsonb := '[]'::jsonb;
  v_admin_assignments jsonb := '[]'::jsonb;
  v_instructors jsonb := '[]'::jsonb;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp__require_org();
  v_org_manager := public.erp__is_org_manager(v_org);
  v_primary_owner := public.erp__is_primary_owner(v_org);
  v_org_role := public.erp__org_role(v_org);
  v_roles := public.erp_my_roles();
  v_admin_branches := public.erp__admin_branch_ids(v_org);
  if not v_org_manager and cardinality(v_admin_branches) = 0 then
    raise exception 'FORBIDDEN';
  end if;

  if v_org_manager then
    select coalesce(array_agg(id order by created_at), '{}'::uuid[])
      into v_actor_branches
      from public.erp_branches where org_id = v_org;
  else
    v_actor_branches := v_admin_branches;
  end if;

  v_primary_role := case
    when 'owner' = any(v_roles) then 'owner'
    when 'co_owner' = any(v_roles) then 'co_owner'
    when 'admin' = any(v_roles) then 'admin'
    when 'instructor' = any(v_roles) then 'instructor'
    when 'student' = any(v_roles) then 'student'
    else null
  end;
  select coalesce(lower(email::text), '') into v_actor_email
    from auth.users where id = v_actor;

  if v_org_manager then
    select coalesce(jsonb_agg(jsonb_build_object(
      'userId', om.user_id,
      'email', coalesce(lower(u.email::text), ''),
      'role', om.role,
      'status', om.status,
      'createdAt', om.created_at,
      'isSelf', om.user_id = v_actor
    ) order by case om.role when 'owner' then 0 else 1 end,
               case om.status when 'active' then 0 else 1 end,
               lower(u.email::text)), '[]'::jsonb)
      into v_org_members
      from public.erp_org_members om
      join auth.users u on u.id = om.user_id
     where om.org_id = v_org;

    select coalesce(jsonb_agg(jsonb_build_object(
      'userId', bm.user_id,
      'email', coalesce(lower(u.email::text), ''),
      'role', 'admin',
      'status', bm.status,
      'branchId', bm.branch_id,
      'createdAt', bm.created_at,
      'isSelf', bm.user_id = v_actor
    ) order by lower(u.email::text), bm.created_at), '[]'::jsonb)
      into v_admin_assignments
      from public.erp_branch_members bm
      join public.erp_branches b on b.id = bm.branch_id and b.org_id = v_org
      join auth.users u on u.id = bm.user_id
     where bm.role = 'admin';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'instructorId', i.id,
    'fullName', i.full_name,
    'contactEmail', i.email,
    'phone', i.phone,
    'branchId', i.branch_id,
    'recordStatus', i.status,
    'accessStatus', coalesce(pa.access_status, 'none'),
    'accessEmail', coalesce(pa.access_email, ''),
    'accessUserId', pa.access_user_id,
    'accessBranchIds', to_jsonb(coalesce(ab.access_branch_ids, '{}'::uuid[])),
    'batchBranchIds', to_jsonb(coalesce(bb.batch_branch_ids, '{}'::uuid[]))
  ) order by i.full_name), '[]'::jsonb)
    into v_instructors
    from public.erp_instructors i
    left join lateral (
      select bm.user_id as access_user_id,
             coalesce(lower(u.email::text), '') as access_email,
             bm.status as access_status
        from public.erp_branch_members bm
        join public.erp_branches pb on pb.id = bm.branch_id and pb.org_id = v_org
        join auth.users u on u.id = bm.user_id
       where bm.instructor_id = i.id and bm.role = 'instructor'
         and (v_org_manager or bm.branch_id = any(v_actor_branches))
       order by case bm.status when 'active' then 0 else 1 end, bm.created_at desc
       limit 1
    ) pa on true
    left join lateral (
      select coalesce(array_agg(distinct bm.branch_id), '{}'::uuid[]) as access_branch_ids
        from public.erp_branch_members bm
        join public.erp_branches pb on pb.id = bm.branch_id and pb.org_id = v_org
       where bm.instructor_id = i.id and bm.role = 'instructor'
         and bm.status = 'active'
         and (v_org_manager or bm.branch_id = any(v_actor_branches))
    ) ab on true
    left join lateral (
      select coalesce(array_agg(distinct bt.branch_id), '{}'::uuid[]) as batch_branch_ids
        from public.erp_batches bt
       where bt.instructor_id = i.id and bt.org_id = v_org and bt.status = 'active'
         and (v_org_manager or bt.branch_id = any(v_actor_branches))
    ) bb on true
   where i.org_id = v_org
     and (
       v_org_manager
       or i.branch_id is null
       or i.branch_id = any(v_actor_branches)
       or coalesce(cardinality(bb.batch_branch_ids), 0) > 0
       or coalesce(cardinality(ab.access_branch_ids), 0) > 0
       or pa.access_user_id is not null
     );

  return jsonb_build_object(
    'organizationId', v_org,
    'actor', jsonb_build_object(
      'userId', v_actor,
      'email', v_actor_email,
      'roles', to_jsonb(v_roles),
      'primaryRole', v_primary_role,
      'orgRole', v_org_role,
      'branchIds', to_jsonb(v_actor_branches),
      'adminBranchIds', to_jsonb(v_admin_branches),
      'canManageCoOwners', v_primary_owner,
      'canManageAdmins', v_org_manager,
      'canManageInstructors', v_org_manager or cardinality(v_admin_branches) > 0,
      'canManageStudents', v_org_manager or cardinality(v_admin_branches) > 0
    ),
    'orgMembers', v_org_members,
    'adminAssignments', v_admin_assignments,
    'instructors', v_instructors
  );
end $$;

create or replace function public.erp_save_instructor(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_branch uuid; v_current_branch uuid; v_org_manager boolean;
begin
  v_org := public.erp__require_manager();
  v_id := nullif(p_payload->>'id', '')::uuid;
  v_branch := nullif(p_payload->>'branchId', '')::uuid;
  v_org_manager := public.erp__is_org_manager(v_org);
  if nullif(trim(p_payload->>'fullName'), '') is null then raise exception 'VALIDATION_FAILED: fullName'; end if;
  if v_branch is not null and not public.erp__can_manage_branch(v_org, v_branch) then
    raise exception 'FORBIDDEN';
  end if;
  if v_id is null then
    if v_branch is null and not v_org_manager then raise exception 'FORBIDDEN'; end if;
  else
    select branch_id into v_current_branch from public.erp_instructors
     where id = v_id and org_id = v_org;
    if not found then raise exception 'FORBIDDEN'; end if;
    if not v_org_manager and (v_current_branch is null
       or not public.erp__can_manage_branch(v_org, v_current_branch)
       or v_branch is null) then
      raise exception 'FORBIDDEN';
    end if;
  end if;
  if v_id is null then
    insert into public.erp_instructors(org_id, branch_id, full_name, phone, email)
    values (v_org, nullif(p_payload->>'branchId', '')::uuid, trim(p_payload->>'fullName'),
            coalesce(p_payload->>'phone', ''), coalesce(p_payload->>'email', ''))
    returning id into v_id;
  else
    update public.erp_instructors set branch_id = nullif(p_payload->>'branchId', '')::uuid,
      full_name = trim(p_payload->>'fullName'), phone = coalesce(p_payload->>'phone', ''),
      email = coalesce(p_payload->>'email', '')
     where id = v_id and org_id = v_org;
    if not found then raise exception 'FORBIDDEN'; end if;
  end if;
  perform public.erp__log(v_org, 'save', 'instructor', v_id);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.erp_save_batch(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_branch uuid; v_current_branch uuid; v_days integer[];
begin
  v_org := public.erp__require_manager();
  v_id := nullif(p_payload->>'id', '')::uuid;
  v_branch := nullif(p_payload->>'branchId', '')::uuid;
  select coalesce(array_agg(value::integer order by value::integer), '{}')
    into v_days
    from jsonb_array_elements_text(coalesce(p_payload->'days', '[]'::jsonb)) value;
  if nullif(trim(p_payload->>'name'), '') is null or v_branch is null or coalesce(array_length(v_days, 1), 0) = 0 then
    raise exception 'VALIDATION_FAILED: name/branchId/days';
  end if;
  perform public.erp__require_branch_manager(v_org, v_branch);
  if v_id is not null then
    select branch_id into v_current_branch from public.erp_batches
     where id = v_id and org_id = v_org;
    if v_current_branch is null then raise exception 'FORBIDDEN'; end if;
    perform public.erp__require_branch_manager(v_org, v_current_branch);
  end if;
  if nullif(p_payload->>'instructorId', '') is not null and not exists (
    select 1 from public.erp_instructors
     where id = nullif(p_payload->>'instructorId', '')::uuid and org_id = v_org
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if v_id is null then
    insert into public.erp_batches(org_id, branch_id, name, instructor_id, days, start_time, duration_mins, capacity)
    values (v_org, v_branch, trim(p_payload->>'name'), nullif(p_payload->>'instructorId', '')::uuid,
            v_days, coalesce(nullif(p_payload->>'startTime', '')::time, '07:00'),
            coalesce(nullif(p_payload->>'durationMins', '')::integer, 60),
            coalesce(nullif(p_payload->>'capacity', '')::integer, 20))
    returning id into v_id;
  else
    update public.erp_batches set branch_id = v_branch, name = trim(p_payload->>'name'),
      instructor_id = nullif(p_payload->>'instructorId', '')::uuid, days = v_days,
      start_time = coalesce(nullif(p_payload->>'startTime', '')::time, start_time),
      duration_mins = coalesce(nullif(p_payload->>'durationMins', '')::integer, duration_mins),
      capacity = coalesce(nullif(p_payload->>'capacity', '')::integer, capacity)
     where id = v_id and org_id = v_org;
    if not found then raise exception 'FORBIDDEN'; end if;
  end if;
  perform public.erp__log(v_org, 'save', 'batch', v_id);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.erp_archive_batch(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_branch uuid;
begin
  v_org := public.erp__require_manager();
  select branch_id into v_branch from public.erp_batches where id = p_id and org_id = v_org;
  if v_branch is null then raise exception 'FORBIDDEN'; end if;
  perform public.erp__require_branch_manager(v_org, v_branch);
  update public.erp_batches
     set status = case status when 'archived' then 'active' else 'archived' end
   where id = p_id and org_id = v_org;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform public.erp__log(v_org, 'archive_toggle', 'batch', p_id);
  return jsonb_build_object('id', p_id);
end $$;

create or replace function public.erp_enroll_student(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_batch uuid; v_student uuid; v_id uuid; v_capacity integer; v_count integer;
  v_batch_branch uuid; v_student_branch uuid;
begin
  v_org := public.erp__require_manager();
  v_batch := nullif(p_payload->>'batchId', '')::uuid;
  v_student := nullif(p_payload->>'studentId', '')::uuid;
  select capacity, branch_id into v_capacity, v_batch_branch
    from public.erp_batches where id = v_batch and org_id = v_org;
  if v_capacity is null then raise exception 'FORBIDDEN'; end if;
  select branch_id into v_student_branch from public.erp_students
   where id = v_student and org_id = v_org;
  if v_student_branch is null then raise exception 'FORBIDDEN'; end if;
  perform public.erp__require_branch_manager(v_org, v_batch_branch);
  perform public.erp__require_branch_manager(v_org, v_student_branch);
  select count(*) into v_count from public.erp_enrollments
   where batch_id = v_batch and status = 'active' and student_id <> v_student;
  if v_count >= v_capacity then raise exception 'CAPACITY_FULL'; end if;
  insert into public.erp_enrollments(org_id, batch_id, student_id)
  values (v_org, v_batch, v_student)
  on conflict (batch_id, student_id) do update set status = 'active'
  returning id into v_id;
  perform public.erp__log(v_org, 'enroll', 'enrollment', v_id);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.erp_end_enrollment(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_batch_branch uuid; v_student_branch uuid;
begin
  v_org := public.erp__require_manager();
  select bt.branch_id, s.branch_id into v_batch_branch, v_student_branch
    from public.erp_enrollments e
    join public.erp_batches bt on bt.id = e.batch_id
    join public.erp_students s on s.id = e.student_id
   where e.id = p_id and e.org_id = v_org;
  if v_batch_branch is null or v_student_branch is null then raise exception 'FORBIDDEN'; end if;
  perform public.erp__require_branch_manager(v_org, v_batch_branch);
  perform public.erp__require_branch_manager(v_org, v_student_branch);
  update public.erp_enrollments set status = 'ended' where id = p_id and org_id = v_org;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform public.erp__log(v_org, 'end', 'enrollment', p_id);
  return jsonb_build_object('id', p_id);
end $$;

-- Managers may mark any batch in their scope; a signed-in instructor may
-- mark a batch only when linked to it (branch membership + instructor_id).
create or replace function public.erp_mark_attendance(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_batch uuid; v_date date; v_mark jsonb; v_saved integer := 0; v_instructor uuid;
  v_batch_branch uuid;
begin
  v_org := public.erp__require_org();
  v_batch := nullif(p_payload->>'batchId', '')::uuid;
  v_date := nullif(p_payload->>'classDate', '')::date;
  if v_batch is null or v_date is null then raise exception 'VALIDATION_FAILED: batchId/classDate'; end if;
  select branch_id into v_batch_branch from public.erp_batches
   where id = v_batch and org_id = v_org;
  if v_batch_branch is null then raise exception 'FORBIDDEN'; end if;
  v_instructor := public.erp_my_instructor_id();
  if not (
    public.erp__is_org_manager(v_org)
    or public.erp__can_manage_branch(v_org, v_batch_branch)
    or (v_instructor is not null and exists (
      select 1 from public.erp_batches bt
        join public.erp_branch_members bm
          on bm.branch_id = bt.branch_id and bm.user_id = auth.uid()
         and bm.role = 'instructor' and bm.instructor_id = v_instructor
         and bm.status = 'active'
       where bt.id = v_batch and bt.instructor_id = v_instructor))
  ) then
    raise exception 'FORBIDDEN';
  end if;
  for v_mark in select elem.mark from jsonb_array_elements(coalesce(p_payload->'marks', '[]'::jsonb)) as elem(mark) loop
    if (v_mark->>'status') not in ('present','absent','late') then continue; end if;
    if not exists (select 1 from public.erp_enrollments
                    where batch_id = v_batch and student_id = (v_mark->>'studentId')::uuid
                      and status = 'active') then continue; end if;
    insert into public.erp_attendance(org_id, batch_id, student_id, class_date, status, marked_by)
    values (v_org, v_batch, (v_mark->>'studentId')::uuid, v_date, v_mark->>'status', auth.uid())
    on conflict (batch_id, student_id, class_date)
      do update set status = excluded.status, marked_by = excluded.marked_by, updated_at = now();
    v_saved := v_saved + 1;
  end loop;
  perform public.erp__log(v_org, 'mark', 'attendance', v_batch);
  return jsonb_build_object('saved', v_saved);
end $$;

create or replace function public.erp_save_plan(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_id uuid;
  v_current public.erp_plans%rowtype;
  v_plan_type text;
  v_billing_cycle text;
  v_renewal_default boolean;
  v_status text;
  v_months integer;
  v_amount bigint;
begin
  v_org := public.erp__require_org_manager();
  v_id := nullif(p_payload->>'id', '')::uuid;
  if nullif(trim(p_payload->>'name'), '') is null then raise exception 'VALIDATION_FAILED: name'; end if;
  if v_id is not null then
    select * into v_current from public.erp_plans where id = v_id and org_id = v_org for update;
    if not found then raise exception 'FORBIDDEN'; end if;
  end if;
  v_plan_type := coalesce(nullif(p_payload->>'planType', ''), v_current.plan_type, 'subscription');
  v_billing_cycle := coalesce(nullif(p_payload->>'billingCycle', ''), v_current.billing_cycle, 'joining');
  v_status := coalesce(nullif(p_payload->>'status', ''), v_current.status, 'active');
  v_amount := coalesce(nullif(p_payload->>'amountPaise', '')::bigint, v_current.amount_paise, 0);
  v_months := case
    when v_plan_type = 'one_month' then 1
    else coalesce(nullif(p_payload->>'durationMonths', '')::integer, v_current.duration_months, 1)
  end;
  v_renewal_default := case
    when v_plan_type = 'one_month' then false
    when p_payload ? 'renewalEnabledDefault' then coalesce(nullif(p_payload->>'renewalEnabledDefault', '')::boolean, coalesce(v_current.renewal_enabled_default, true))
    else coalesce(v_current.renewal_enabled_default, true)
  end;
  if v_plan_type not in ('subscription','one_month')
     or v_billing_cycle not in ('joining','calendar')
     or v_status not in ('active','archived')
     or v_months < 1 or v_months > 24 or v_amount < 0 then
    raise exception 'VALIDATION_FAILED: plan template';
  end if;
  if v_id is null then
    insert into public.erp_plans(org_id, name, amount_paise, duration_months,
      plan_type, billing_cycle, renewal_enabled_default, status)
    values (v_org, trim(p_payload->>'name'), v_amount, v_months,
      v_plan_type, v_billing_cycle, v_renewal_default, v_status)
    returning id into v_id;
  else
    update public.erp_plans set name = trim(p_payload->>'name'),
      amount_paise = v_amount, duration_months = v_months,
      plan_type = v_plan_type, billing_cycle = v_billing_cycle,
      renewal_enabled_default = v_renewal_default, status = v_status
     where id = v_id and org_id = v_org;
    if not found then raise exception 'FORBIDDEN'; end if;
  end if;
  perform public.erp__log(v_org, 'save', 'plan', v_id);
  return jsonb_build_object('id', v_id);
end $$;
create or replace function public.erp_save_membership(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_id uuid; v_student uuid; v_plan uuid; v_branch uuid;
  v_student_branch uuid;
  v_start date; v_months integer; v_cycle text; v_end date; v_amount bigint;
  v_current public.erp_memberships%rowtype;
  v_source public.erp_memberships%rowtype;
  v_status text; v_auto_renew boolean; v_previous uuid; v_renewal_number integer;
  v_plan_type text; v_offering_type text;
  v_paused_from date; v_paused_until date; v_pause_reason text;
  v_total_paused_days integer; v_cancelled_at timestamptz; v_cancel_reason text;
  v_existing_child uuid; v_is_new boolean;
begin
  v_org := public.erp__require_manager();
  v_id := nullif(p_payload->>'id', '')::uuid;
  v_is_new := v_id is null;
  v_student := nullif(p_payload->>'studentId', '')::uuid;
  v_plan := nullif(p_payload->>'planId', '')::uuid;
  v_start := nullif(p_payload->>'startDate', '')::date;
  v_cycle := coalesce(nullif(p_payload->>'billingCycle', ''), 'joining');
  select branch_id into v_student_branch from public.erp_students where id = v_student and org_id = v_org;
  v_branch := v_student_branch;
  if v_branch is null then raise exception 'FORBIDDEN'; end if;
  perform public.erp__require_branch_manager(v_org, v_student_branch);
  select duration_months, amount_paise, plan_type into v_months, v_amount, v_plan_type
    from public.erp_plans where id = v_plan and org_id = v_org;
  if v_months is null or v_start is null then raise exception 'VALIDATION_FAILED: planId/startDate'; end if;
  v_months := coalesce(nullif(p_payload->>'durationMonths', '')::integer, v_months);
  v_amount := coalesce(nullif(p_payload->>'amountPaise', '')::bigint, v_amount);
  if v_months < 1 or v_months > 24 or v_amount < 0 or v_cycle not in ('joining','calendar') then
    raise exception 'VALIDATION_FAILED: subscription terms';
  end if;
  v_branch := coalesce(nullif(p_payload->>'branchId', '')::uuid, v_branch);
  perform public.erp__require_branch_manager(v_org, v_branch);
  if v_id is not null then
    select * into v_current from public.erp_memberships
     where id = v_id and org_id = v_org for update;
    if not found then raise exception 'FORBIDDEN'; end if;
    perform public.erp__require_branch_manager(v_org, v_current.branch_id);
  end if;

  v_offering_type := coalesce(
    v_current.offering_type,
    nullif(p_payload->>'offeringType', ''),
    v_plan_type,
    'subscription');
  if v_offering_type not in ('subscription','one_month') then
    raise exception 'VALIDATION_FAILED: offeringType';
  end if;
  if v_is_new and nullif(p_payload->>'offeringType', '') is not null
     and nullif(p_payload->>'offeringType', '') is distinct from v_plan_type then
    raise exception 'VALIDATION_FAILED: offeringType/planType';
  end if;
  if v_offering_type = 'one_month' then v_months := 1; end if;

  v_status := coalesce(nullif(p_payload->>'status', ''), v_current.status, 'active');
  if v_status not in ('active','paused','cancelled') then
    raise exception 'VALIDATION_FAILED: subscription status';
  end if;
  if v_current.status = 'cancelled' and v_status <> 'cancelled' then
    raise exception 'VALIDATION_FAILED: SUBSCRIPTION_CANCELLED';
  end if;
  v_auto_renew := case
    when p_payload ? 'autoRenew' then coalesce(nullif(p_payload->>'autoRenew', '')::boolean, true)
    else coalesce(v_current.auto_renew, true)
  end;
  v_previous := nullif(p_payload->>'previousMembershipId', '')::uuid;
  if not (p_payload ? 'previousMembershipId') then v_previous := v_current.previous_membership_id; end if;
  v_renewal_number := coalesce(
    nullif(p_payload->>'renewalNumber', '')::integer, v_current.renewal_number, 0);
  v_paused_from := nullif(p_payload->>'pausedFrom', '')::date;
  v_paused_until := nullif(p_payload->>'pausedUntil', '')::date;
  v_pause_reason := left(trim(coalesce(p_payload->>'pauseReason', '')), 500);
  v_total_paused_days := coalesce(
    nullif(p_payload->>'totalPausedDays', '')::integer, v_current.total_paused_days, 0);
  v_cancelled_at := nullif(p_payload->>'cancelledAt', '')::timestamptz;
  v_cancel_reason := left(trim(coalesce(p_payload->>'cancelReason', '')), 500);
  if v_offering_type = 'one_month' then
    if v_previous is not null then
      raise exception 'VALIDATION_FAILED: ONE_MONTH_NO_RENEWAL';
    end if;
    if v_status = 'paused' then
      raise exception 'VALIDATION_FAILED: ONE_MONTH_NO_PAUSE';
    end if;
    v_auto_renew := false;
    v_renewal_number := 0;
    v_total_paused_days := 0;
  end if;
  if v_renewal_number < 0 or v_renewal_number > 10000
     or v_total_paused_days < 0 or v_total_paused_days > 3660 then
    raise exception 'VALIDATION_FAILED: subscription lifecycle';
  end if;

  if v_status = 'paused' then
    if v_paused_from is null then raise exception 'VALIDATION_FAILED: pausedFrom'; end if;
    if v_paused_until is not null and v_paused_until < v_paused_from then
      raise exception 'VALIDATION_FAILED: pausedUntil';
    end if;
  else
    v_paused_from := null; v_paused_until := null; v_pause_reason := '';
  end if;
  if v_status = 'cancelled' then
    v_cancelled_at := coalesce(v_cancelled_at, v_current.cancelled_at, now());
  else
    v_cancelled_at := null; v_cancel_reason := '';
  end if;

  if v_previous is not null then
    if v_id is not null and v_previous = v_id then
      raise exception 'VALIDATION_FAILED: previousMembershipId';
    end if;
    select * into v_source from public.erp_memberships
     where id = v_previous and org_id = v_org for update;
    if not found or v_source.student_id <> v_student then
      raise exception 'FORBIDDEN';
    end if;
    perform public.erp__require_branch_manager(v_org, v_source.branch_id);
    if v_source.offering_type = 'one_month' then
      raise exception 'VALIDATION_FAILED: ONE_MONTH_NO_RENEWAL';
    end if;
    if v_plan_type = 'one_month'
       and (v_is_new or v_current.previous_membership_id is distinct from v_previous) then
      raise exception 'VALIDATION_FAILED: ONE_MONTH_NO_RENEWAL';
    end if;
    if v_source.status = 'cancelled'
       and (v_is_new or v_current.previous_membership_id is distinct from v_previous) then
      raise exception 'VALIDATION_FAILED: SUBSCRIPTION_CANCELLED';
    end if;
    if v_source.status = 'paused'
       and (v_is_new or v_current.previous_membership_id is distinct from v_previous) then
      raise exception 'VALIDATION_FAILED: SUBSCRIPTION_PAUSED';
    end if;
    if nullif(p_payload->>'renewalNumber', '') is null then
      v_renewal_number := v_source.renewal_number + 1;
    end if;
    if v_status <> 'cancelled' then
      select id into v_existing_child from public.erp_memberships
       where previous_membership_id = v_previous and status <> 'cancelled'
         and (v_id is null or id <> v_id)
       limit 1;
      if v_existing_child is not null then
        raise exception 'VALIDATION_FAILED: ALREADY_RENEWED';
      end if;
    end if;
  end if;

  if v_cycle = 'calendar' then
    v_end := (date_trunc('month', v_start)::date + (v_months || ' months')::interval - interval '1 day')::date;
  else
    v_end := (v_start + (v_months || ' months')::interval - interval '1 day')::date;
  end if;
  v_end := (v_end + (v_total_paused_days || ' days')::interval)::date;
  if v_status = 'paused' and (v_paused_from < v_start or v_paused_from > v_end) then
    raise exception 'VALIDATION_FAILED: pausedFrom';
  end if;
  if v_status = 'paused' and v_id is not null and exists (
    select 1 from public.erp_memberships
     where previous_membership_id = v_id and status <> 'cancelled') then
    raise exception 'VALIDATION_FAILED: RENEWAL_EXISTS';
  end if;

  if v_is_new then
    insert into public.erp_memberships(
      org_id, student_id, plan_id, branch_id, start_date, end_date,
      billing_cycle, duration_months, amount_paise, status, offering_type, auto_renew,
      previous_membership_id, renewal_number, paused_from, paused_until,
      pause_reason, total_paused_days, cancelled_at, cancel_reason)
    values (v_org, v_student, v_plan, v_branch, v_start, v_end, v_cycle, v_months,
      v_amount, v_status, v_offering_type, v_auto_renew, v_previous, v_renewal_number, v_paused_from,
      v_paused_until, v_pause_reason, v_total_paused_days, v_cancelled_at, v_cancel_reason)
    returning id into v_id;
  else
    update public.erp_memberships set student_id = v_student, plan_id = v_plan, branch_id = v_branch,
      start_date = v_start, end_date = v_end, billing_cycle = v_cycle,
      duration_months = v_months, amount_paise = v_amount, status = v_status,
      offering_type = v_offering_type,
      auto_renew = v_auto_renew, previous_membership_id = v_previous,
      renewal_number = v_renewal_number, paused_from = v_paused_from,
      paused_until = v_paused_until, pause_reason = v_pause_reason,
      total_paused_days = v_total_paused_days, cancelled_at = v_cancelled_at,
      cancel_reason = v_cancel_reason
     where id = v_id and org_id = v_org;
    if not found then raise exception 'FORBIDDEN'; end if;
  end if;
  perform public.erp__log(v_org,
    case
      when v_is_new and v_previous is not null then 'renew'
      when v_status = 'paused' and v_current.status is distinct from 'paused' then 'pause'
      when v_status = 'active' and v_current.status = 'paused' then 'resume'
      when v_status = 'cancelled' and v_current.status is distinct from 'cancelled' then 'cancel'
      else 'save'
    end,
    'membership', v_id);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.erp_cancel_membership(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_current public.erp_memberships%rowtype;
begin
  v_org := public.erp__require_manager();
  select * into v_current from public.erp_memberships
   where id = p_id and org_id = v_org for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform public.erp__require_branch_manager(v_org, v_current.branch_id);
  if v_current.status <> 'cancelled' then
    update public.erp_memberships set status = 'cancelled', paused_from = null,
      paused_until = null, pause_reason = '', cancelled_at = now()
     where id = p_id and org_id = v_org;
    if not found then raise exception 'FORBIDDEN'; end if;
    perform public.erp__log(v_org, 'cancel', 'membership', p_id);
  end if;
  return jsonb_build_object('id', p_id);
end $$;

create or replace function public.erp_record_payment(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; v_id uuid; v_membership uuid; v_student uuid; v_branch uuid;
  v_amount bigint; v_paid date; v_receipt text; v_next bigint;
begin
  v_org := public.erp__require_manager();
  v_membership := nullif(p_payload->>'membershipId', '')::uuid;
  v_amount := nullif(p_payload->>'amountPaise', '')::bigint;
  v_paid := coalesce(nullif(p_payload->>'paidOn', '')::date, current_date);
  if v_membership is null or v_amount is null or v_amount <= 0 then
    raise exception 'VALIDATION_FAILED: membershipId/amountPaise';
  end if;
  select student_id, branch_id into v_student, v_branch
    from public.erp_memberships where id = v_membership and org_id = v_org and status in ('active','paused');
  if v_student is null then raise exception 'FORBIDDEN'; end if;
  perform public.erp__require_branch_manager(v_org, v_branch);
  insert into public.erp_counters(org_id, receipt) values (v_org, 1)
  on conflict (org_id) do update set receipt = public.erp_counters.receipt + 1
  returning receipt into v_next;
  v_receipt := 'YS-' || to_char(v_paid, 'YYYY') || '-' || lpad(v_next::text, 4, '0');
  insert into public.erp_payments(org_id, student_id, membership_id, branch_id, amount_paise,
                                   method, paid_on, receipt_no, note, recorded_by)
  values (v_org, v_student, v_membership, v_branch, v_amount,
          coalesce(nullif(p_payload->>'method', ''), 'cash'), v_paid, v_receipt,
          coalesce(p_payload->>'note', ''), auth.uid())
  returning id into v_id;
  perform public.erp__log(v_org, 'record', 'payment', v_id);
  return jsonb_build_object('id', v_id, 'receiptNo', v_receipt);
end $$;

-- ----------------------------------------------------------------------------
-- Offline-first synchronization (SQL v2)
--
-- The browser sends an ordered batch of device operations to the single
-- typed erp_sync_push(jsonb) function. This is NOT a generic table gateway:
-- entity and operation names are whitelisted here, every branch below parses
-- a fixed set of fields, re-checks organization + role, and writes with fixed
-- SQL. Each operation is processed in its own subtransaction so one conflict
-- does not roll back independent changes in the same batch.
--
-- Concurrency contract:
--   * A create carries a client-generated UUID and baseVersion 0.
--   * An update/archive carries the sync_version the device last saw.
--   * The row is locked and updated only when the version still matches.
--   * A mismatch returns status='conflict' and changes nothing.
--   * erp_sync_operations makes every retry idempotent.
--   * Payments are create/void only; there is no edit or delete operation.
-- ----------------------------------------------------------------------------

create or replace function public.erp__sync_result(
  p_op jsonb, p_status text, p_server_id uuid, p_server_version integer,
  p_code text default null, p_message text default null, p_receipt text default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'opId', p_op->>'opId', 'status', p_status,
    'entity', p_op->>'entity', 'entityId', p_op->>'entityId',
    'serverEntityId', p_server_id, 'serverVersion', p_server_version,
    'code', p_code, 'message', p_message, 'receiptNo', p_receipt)
$$;

create or replace function public.erp__sync_apply_branch(p_org uuid, p_op jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb := coalesce(p_op->'payload', '{}'::jsonb);
  v_id uuid := nullif(v_payload->>'id', '')::uuid;
  v_base integer := coalesce(nullif(p_op->>'baseVersion', '')::integer, 0);
  v_status text := coalesce(nullif(v_payload->>'status', ''), 'active');
  v_current public.erp_branches%rowtype;
  v_version integer;
begin
  if v_id is null or nullif(trim(v_payload->>'name'), '') is null then
    raise exception 'VALIDATION_FAILED: branch id/name';
  end if;
  if v_status not in ('active','archived') then raise exception 'VALIDATION_FAILED: status'; end if;
  select * into v_current from public.erp_branches where id = v_id for update;
  if v_current.id is not null then
    if v_current.org_id <> p_org then
      return public.erp__sync_result(p_op, 'conflict', v_id, null, 'ID_IN_USE', 'That record ID is already in use.');
    end if;
    perform public.erp__require_branch_manager(p_org, v_id);
    if v_base <> v_current.sync_version then
      return public.erp__sync_result(p_op, 'conflict', v_id, v_current.sync_version, 'VERSION_CONFLICT', 'This branch changed in Supabase after it was copied to this device.');
    end if;
    update public.erp_branches set
      name = trim(v_payload->>'name'), city = coalesce(v_payload->>'city', ''),
      address = coalesce(v_payload->>'address', ''), phone = coalesce(v_payload->>'phone', ''),
      status = v_status
     where id = v_id returning sync_version into v_version;
  else
    if v_base > 0 then
      return public.erp__sync_result(p_op, 'conflict', null, null, 'RECORD_MISSING', 'This branch no longer exists in Supabase.');
    end if;
    if not public.erp__is_org_manager(p_org) then raise exception 'FORBIDDEN'; end if;
    insert into public.erp_branches(id, org_id, name, city, address, phone, status)
    values (v_id, p_org, trim(v_payload->>'name'), coalesce(v_payload->>'city', ''),
            coalesce(v_payload->>'address', ''), coalesce(v_payload->>'phone', ''), v_status)
    returning sync_version into v_version;
  end if;
  return public.erp__sync_result(p_op, 'applied', v_id, v_version);
end $$;

create or replace function public.erp__sync_apply_student(p_org uuid, p_op jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb := coalesce(p_op->'payload', '{}'::jsonb);
  v_id uuid := nullif(v_payload->>'id', '')::uuid;
  v_branch uuid := nullif(v_payload->>'branchId', '')::uuid;
  v_base integer := coalesce(nullif(p_op->>'baseVersion', '')::integer, 0);
  v_status text := coalesce(nullif(v_payload->>'status', ''), 'active');
  v_first_name text := btrim(coalesce(v_payload->>'firstName', ''));
  v_last_name text := btrim(coalesce(v_payload->>'lastName', ''));
  v_full_name text := btrim(coalesce(nullif(btrim(concat_ws(' ', nullif(btrim(coalesce(v_payload->>'firstName', '')), ''), nullif(btrim(coalesce(v_payload->>'lastName', '')), ''))), ''), v_payload->>'fullName', ''));
  v_experience text := coalesce(nullif(v_payload->>'yogaExperience', ''), '');
  v_current public.erp_students%rowtype;
  v_version integer;
begin
  if v_first_name = '' and v_full_name <> '' then
    v_first_name := split_part(v_full_name, ' ', 1);
    v_last_name := btrim(regexp_replace(v_full_name, '^[^ ]+\s*', ''));
  end if;
  if v_id is null or v_branch is null or v_full_name = '' then
    raise exception 'VALIDATION_FAILED: student id/fullName/branchId';
  end if;
  if v_status not in ('active','inactive') then raise exception 'VALIDATION_FAILED: status'; end if;
  if v_experience not in ('', 'experienced', 'no_experience', 'less_experienced') then
    raise exception 'VALIDATION_FAILED: yogaExperience';
  end if;
  perform public.erp__require_branch_manager(p_org, v_branch);
  select * into v_current from public.erp_students where id = v_id for update;
  if v_current.id is not null then
    if v_current.org_id <> p_org then
      return public.erp__sync_result(p_op, 'conflict', v_id, null, 'ID_IN_USE', 'That record ID is already in use.');
    end if;
    perform public.erp__require_branch_manager(p_org, v_current.branch_id);
    if v_base <> v_current.sync_version then
      return public.erp__sync_result(p_op, 'conflict', v_id, v_current.sync_version, 'VERSION_CONFLICT', 'This student changed in Supabase after it was copied to this device.');
    end if;
    update public.erp_students set
      branch_id = v_branch, first_name = v_first_name, last_name = v_last_name,
      full_name = v_full_name,
      phone = coalesce(v_payload->>'phone', ''), email = coalesce(v_payload->>'email', ''),
      gender = coalesce(v_payload->>'gender', ''), dob = nullif(v_payload->>'dob', '')::date,
      joining_date = coalesce(nullif(v_payload->>'joiningDate', '')::date, joining_date),
      status = v_status, notes = coalesce(v_payload->>'notes', ''),
      address = coalesce(v_payload->>'address', ''), pin_code = coalesce(v_payload->>'pinCode', ''),
      admission_subject = coalesce(v_payload->>'admissionSubject', ''),
      referred_by = coalesce(v_payload->>'referredBy', ''), yoga_experience = v_experience,
      medical_physical_issue = coalesce(v_payload->>'medicalPhysicalIssue', ''),
      reason_to_join = coalesce(v_payload->>'reasonToJoin', '')
     where id = v_id returning sync_version into v_version;
  else
    if v_base > 0 then
      return public.erp__sync_result(p_op, 'conflict', null, null, 'RECORD_MISSING', 'This student no longer exists in Supabase.');
    end if;
    insert into public.erp_students(
      id, org_id, branch_id, first_name, last_name, full_name, phone, email,
      gender, dob, joining_date, status, notes, address, pin_code,
      admission_subject, referred_by, yoga_experience,
      medical_physical_issue, reason_to_join)
    values (v_id, p_org, v_branch, v_first_name, v_last_name, v_full_name,
            coalesce(v_payload->>'phone', ''), coalesce(v_payload->>'email', ''),
            coalesce(v_payload->>'gender', ''), nullif(v_payload->>'dob', '')::date,
            coalesce(nullif(v_payload->>'joiningDate', '')::date, current_date), v_status,
            coalesce(v_payload->>'notes', ''), coalesce(v_payload->>'address', ''),
            coalesce(v_payload->>'pinCode', ''), coalesce(v_payload->>'admissionSubject', ''),
            coalesce(v_payload->>'referredBy', ''), v_experience,
            coalesce(v_payload->>'medicalPhysicalIssue', ''),
            coalesce(v_payload->>'reasonToJoin', ''))
    returning sync_version into v_version;
  end if;
  return public.erp__sync_result(p_op, 'applied', v_id, v_version);
end $$;

create or replace function public.erp__sync_apply_instructor(p_org uuid, p_op jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb := coalesce(p_op->'payload', '{}'::jsonb);
  v_id uuid := nullif(v_payload->>'id', '')::uuid;
  v_branch uuid := nullif(v_payload->>'branchId', '')::uuid;
  v_base integer := coalesce(nullif(p_op->>'baseVersion', '')::integer, 0);
  v_status text := coalesce(nullif(v_payload->>'status', ''), 'active');
  v_current public.erp_instructors%rowtype;
  v_version integer;
begin
  if v_id is null or nullif(trim(v_payload->>'fullName'), '') is null then
    raise exception 'VALIDATION_FAILED: instructor id/fullName';
  end if;
  if v_status not in ('active','inactive') then raise exception 'VALIDATION_FAILED: status'; end if;
  if v_branch is not null and not public.erp__can_manage_branch(p_org, v_branch) then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_current from public.erp_instructors where id = v_id for update;
  if v_current.id is not null then
    if v_current.org_id <> p_org then
      return public.erp__sync_result(p_op, 'conflict', v_id, null, 'ID_IN_USE', 'That record ID is already in use.');
    end if;
    if not public.erp__is_org_manager(p_org) and (v_current.branch_id is null
       or not public.erp__can_manage_branch(p_org, v_current.branch_id)
       or v_branch is null) then
      raise exception 'FORBIDDEN';
    end if;
    if v_base <> v_current.sync_version then
      return public.erp__sync_result(p_op, 'conflict', v_id, v_current.sync_version, 'VERSION_CONFLICT', 'This instructor changed in Supabase after it was copied to this device.');
    end if;
    update public.erp_instructors set
      branch_id = v_branch, full_name = trim(v_payload->>'fullName'),
      phone = coalesce(v_payload->>'phone', ''), email = coalesce(v_payload->>'email', ''),
      status = v_status
     where id = v_id returning sync_version into v_version;
  else
    if v_base > 0 then
      return public.erp__sync_result(p_op, 'conflict', null, null, 'RECORD_MISSING', 'This instructor no longer exists in Supabase.');
    end if;
    if v_branch is null and not public.erp__is_org_manager(p_org) then
      raise exception 'FORBIDDEN';
    end if;
    insert into public.erp_instructors(id, org_id, branch_id, full_name, phone, email, status)
    values (v_id, p_org, v_branch, trim(v_payload->>'fullName'),
            coalesce(v_payload->>'phone', ''), coalesce(v_payload->>'email', ''), v_status)
    returning sync_version into v_version;
  end if;
  return public.erp__sync_result(p_op, 'applied', v_id, v_version);
end $$;

create or replace function public.erp__sync_apply_batch(p_org uuid, p_op jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb := coalesce(p_op->'payload', '{}'::jsonb);
  v_id uuid := nullif(v_payload->>'id', '')::uuid;
  v_branch uuid := nullif(v_payload->>'branchId', '')::uuid;
  v_instructor uuid := nullif(v_payload->>'instructorId', '')::uuid;
  v_base integer := coalesce(nullif(p_op->>'baseVersion', '')::integer, 0);
  v_status text := coalesce(nullif(v_payload->>'status', ''), 'active');
  v_days integer[];
  v_current public.erp_batches%rowtype;
  v_version integer;
begin
  select coalesce(array_agg(value::integer order by value::integer), '{}')
    into v_days
    from jsonb_array_elements_text(coalesce(v_payload->'days', '[]'::jsonb)) value;
  if v_id is null or v_branch is null or nullif(trim(v_payload->>'name'), '') is null
     or coalesce(array_length(v_days, 1), 0) = 0 then
    raise exception 'VALIDATION_FAILED: batch id/name/branchId/days';
  end if;
  if v_status not in ('active','archived') then raise exception 'VALIDATION_FAILED: status'; end if;
  if exists (select 1 from unnest(v_days) day where day < 0 or day > 6) then
    raise exception 'VALIDATION_FAILED: days';
  end if;
  perform public.erp__require_branch_manager(p_org, v_branch);
  if v_instructor is not null and not exists (
    select 1 from public.erp_instructors where id = v_instructor and org_id = p_org) then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_current from public.erp_batches where id = v_id for update;
  if v_current.id is not null then
    if v_current.org_id <> p_org then
      return public.erp__sync_result(p_op, 'conflict', v_id, null, 'ID_IN_USE', 'That record ID is already in use.');
    end if;
    perform public.erp__require_branch_manager(p_org, v_current.branch_id);
    if v_base <> v_current.sync_version then
      return public.erp__sync_result(p_op, 'conflict', v_id, v_current.sync_version, 'VERSION_CONFLICT', 'This batch changed in Supabase after it was copied to this device.');
    end if;
    update public.erp_batches set
      branch_id = v_branch, name = trim(v_payload->>'name'), instructor_id = v_instructor,
      days = v_days, start_time = coalesce(nullif(v_payload->>'startTime', '')::time, start_time),
      duration_mins = coalesce(nullif(v_payload->>'durationMins', '')::integer, duration_mins),
      capacity = coalesce(nullif(v_payload->>'capacity', '')::integer, capacity), status = v_status
     where id = v_id returning sync_version into v_version;
  else
    if v_base > 0 then
      return public.erp__sync_result(p_op, 'conflict', null, null, 'RECORD_MISSING', 'This batch no longer exists in Supabase.');
    end if;
    insert into public.erp_batches(id, org_id, branch_id, name, instructor_id, days, start_time, duration_mins, capacity, status)
    values (v_id, p_org, v_branch, trim(v_payload->>'name'), v_instructor, v_days,
            coalesce(nullif(v_payload->>'startTime', '')::time, '07:00'),
            coalesce(nullif(v_payload->>'durationMins', '')::integer, 60),
            coalesce(nullif(v_payload->>'capacity', '')::integer, 20), v_status)
    returning sync_version into v_version;
  end if;
  return public.erp__sync_result(p_op, 'applied', v_id, v_version);
end $$;

create or replace function public.erp__sync_apply_enrollment(p_org uuid, p_op jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb := coalesce(p_op->'payload', '{}'::jsonb);
  v_id uuid := coalesce(nullif(v_payload->>'id', '')::uuid, gen_random_uuid());
  v_batch_id uuid := nullif(v_payload->>'batchId', '')::uuid;
  v_student_id uuid := nullif(v_payload->>'studentId', '')::uuid;
  v_base integer := coalesce(nullif(p_op->>'baseVersion', '')::integer, 0);
  v_status text := coalesce(nullif(v_payload->>'status', ''), 'active');
  v_batch public.erp_batches%rowtype;
  v_current public.erp_enrollments%rowtype;
  v_version integer;
  v_count integer;
  v_student_branch uuid;
  v_current_batch_branch uuid;
  v_current_student_branch uuid;
begin
  if v_batch_id is null or v_student_id is null then
    raise exception 'VALIDATION_FAILED: enrollment batchId/studentId';
  end if;
  if v_status not in ('active','ended') then raise exception 'VALIDATION_FAILED: status'; end if;
  select * into v_batch from public.erp_batches where id = v_batch_id for update;
  if v_batch.id is null or v_batch.org_id <> p_org then raise exception 'FORBIDDEN'; end if;
  select branch_id into v_student_branch from public.erp_students
   where id = v_student_id and org_id = p_org;
  if v_student_branch is null then raise exception 'FORBIDDEN'; end if;
  perform public.erp__require_branch_manager(p_org, v_batch.branch_id);
  perform public.erp__require_branch_manager(p_org, v_student_branch);

  select * into v_current from public.erp_enrollments where id = v_id for update;
  if v_current.id is null then
    select * into v_current from public.erp_enrollments
     where batch_id = v_batch_id and student_id = v_student_id for update;
  end if;

  if v_current.id is not null then
    if v_current.org_id <> p_org then
      return public.erp__sync_result(p_op, 'conflict', v_current.id, null, 'ID_IN_USE', 'That enrollment ID is already in use.');
    end if;
    select branch_id into v_current_batch_branch from public.erp_batches
     where id = v_current.batch_id and org_id = p_org;
    select branch_id into v_current_student_branch from public.erp_students
     where id = v_current.student_id and org_id = p_org;
    if v_current_batch_branch is null or v_current_student_branch is null then
      raise exception 'FORBIDDEN';
    end if;
    perform public.erp__require_branch_manager(p_org, v_current_batch_branch);
    perform public.erp__require_branch_manager(p_org, v_current_student_branch);
    if v_base = 0 and v_current.id <> v_id then
      if v_current.status = v_status then
        return public.erp__sync_result(p_op, 'applied', v_current.id, v_current.sync_version, 'NATURAL_KEY_EXISTS', 'The same enrollment was already created online.');
      end if;
      return public.erp__sync_result(p_op, 'conflict', v_current.id, v_current.sync_version, 'VERSION_CONFLICT', 'This enrollment changed in Supabase after it was copied to this device.');
    end if;
    if v_base <> v_current.sync_version then
      return public.erp__sync_result(p_op, 'conflict', v_current.id, v_current.sync_version, 'VERSION_CONFLICT', 'This enrollment changed in Supabase after it was copied to this device.');
    end if;
    if v_status = 'active' and v_current.status <> 'active' then
      select count(*) into v_count from public.erp_enrollments
       where batch_id = v_batch_id and status = 'active';
      if v_count >= v_batch.capacity then raise exception 'CAPACITY_FULL'; end if;
    end if;
    update public.erp_enrollments set
      batch_id = v_batch_id, student_id = v_student_id,
      joined_on = coalesce(nullif(v_payload->>'joinedOn', '')::date, joined_on), status = v_status
     where id = v_current.id returning sync_version into v_version;
    return public.erp__sync_result(p_op, 'applied', v_current.id, v_version);
  end if;

  if v_base > 0 then
    return public.erp__sync_result(p_op, 'conflict', null, null, 'RECORD_MISSING', 'This enrollment no longer exists in Supabase.');
  end if;
  if v_status = 'active' then
    select count(*) into v_count from public.erp_enrollments
     where batch_id = v_batch_id and status = 'active';
    if v_count >= v_batch.capacity then raise exception 'CAPACITY_FULL'; end if;
  end if;
  insert into public.erp_enrollments(id, org_id, batch_id, student_id, joined_on, status)
  values (v_id, p_org, v_batch_id, v_student_id,
          coalesce(nullif(v_payload->>'joinedOn', '')::date, current_date), v_status)
  returning sync_version into v_version;
  return public.erp__sync_result(p_op, 'applied', v_id, v_version);
end $$;

create or replace function public.erp__sync_apply_attendance(p_org uuid, p_op jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb := coalesce(p_op->'payload', '{}'::jsonb);
  v_id uuid := coalesce(nullif(v_payload->>'id', '')::uuid, gen_random_uuid());
  v_batch_id uuid := nullif(v_payload->>'batchId', '')::uuid;
  v_student_id uuid := nullif(v_payload->>'studentId', '')::uuid;
  v_date date := nullif(v_payload->>'classDate', '')::date;
  v_status text := v_payload->>'status';
  v_base integer := coalesce(nullif(p_op->>'baseVersion', '')::integer, 0);
  v_current public.erp_attendance%rowtype;
  v_version integer;
  v_batch_branch uuid;
  v_batch_instructor uuid;
  v_my_instructor uuid;
  v_current_batch_branch uuid;
  v_current_batch_instructor uuid;
begin
  if v_batch_id is null or v_student_id is null or v_date is null
     or v_status not in ('present','absent','late') then
    raise exception 'VALIDATION_FAILED: attendance batchId/studentId/classDate/status';
  end if;
  select branch_id, instructor_id into v_batch_branch, v_batch_instructor
    from public.erp_batches where id = v_batch_id and org_id = p_org;
  if v_batch_branch is null then raise exception 'FORBIDDEN'; end if;
  v_my_instructor := public.erp_my_instructor_id();
  if not (
    public.erp__is_org_manager(p_org)
    or public.erp__can_manage_branch(p_org, v_batch_branch)
    or (v_my_instructor is not null and v_batch_instructor = v_my_instructor and exists (
      select 1 from public.erp_branch_members bm
       where bm.branch_id = v_batch_branch and bm.user_id = auth.uid()
         and bm.role = 'instructor' and bm.instructor_id = v_my_instructor
         and bm.status = 'active'))
  ) then
    raise exception 'FORBIDDEN';
  end if;
  -- An enrollment may have ended after class but before this device synced;
  -- preserve the historic mark when the roster relationship exists and began
  -- no later than the class date.
  if not exists (select 1 from public.erp_enrollments
                  where batch_id = v_batch_id and student_id = v_student_id
                    and org_id = p_org and joined_on <= v_date) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_current from public.erp_attendance where id = v_id for update;
  if v_current.id is null then
    select * into v_current from public.erp_attendance
     where batch_id = v_batch_id and student_id = v_student_id and class_date = v_date for update;
  end if;

  if v_current.id is not null then
    if v_current.org_id <> p_org then
      return public.erp__sync_result(p_op, 'conflict', v_current.id, null, 'ID_IN_USE', 'That attendance ID is already in use.');
    end if;
    select branch_id, instructor_id into v_current_batch_branch, v_current_batch_instructor
      from public.erp_batches where id = v_current.batch_id and org_id = p_org;
    if v_current_batch_branch is null then raise exception 'FORBIDDEN'; end if;
    if not (
      public.erp__is_org_manager(p_org)
      or public.erp__can_manage_branch(p_org, v_current_batch_branch)
      or (v_my_instructor is not null and v_current_batch_instructor = v_my_instructor and exists (
        select 1 from public.erp_branch_members bm
         where bm.branch_id = v_current_batch_branch and bm.user_id = auth.uid()
           and bm.role = 'instructor' and bm.instructor_id = v_my_instructor
           and bm.status = 'active'))
    ) then
      raise exception 'FORBIDDEN';
    end if;
    if v_base = 0 and v_current.id <> v_id then
      if v_current.status = v_status then
        return public.erp__sync_result(p_op, 'applied', v_current.id, v_current.sync_version, 'NATURAL_KEY_EXISTS', 'The same attendance mark was already recorded online.');
      end if;
      return public.erp__sync_result(p_op, 'conflict', v_current.id, v_current.sync_version, 'VERSION_CONFLICT', 'This attendance mark changed in Supabase after it was copied to this device.');
    end if;
    if v_base <> v_current.sync_version then
      return public.erp__sync_result(p_op, 'conflict', v_current.id, v_current.sync_version, 'VERSION_CONFLICT', 'This attendance mark changed in Supabase after it was copied to this device.');
    end if;
    update public.erp_attendance set
      batch_id = v_batch_id, student_id = v_student_id, class_date = v_date,
      status = v_status, marked_by = auth.uid()
     where id = v_current.id returning sync_version into v_version;
    return public.erp__sync_result(p_op, 'applied', v_current.id, v_version);
  end if;

  if v_base > 0 then
    return public.erp__sync_result(p_op, 'conflict', null, null, 'RECORD_MISSING', 'This attendance record no longer exists in Supabase.');
  end if;
  insert into public.erp_attendance(id, org_id, batch_id, student_id, class_date, status, marked_by)
  values (v_id, p_org, v_batch_id, v_student_id, v_date, v_status, auth.uid())
  returning sync_version into v_version;
  return public.erp__sync_result(p_op, 'applied', v_id, v_version);
end $$;

create or replace function public.erp__sync_apply_plan(p_org uuid, p_op jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb := coalesce(p_op->'payload', '{}'::jsonb);
  v_id uuid := nullif(v_payload->>'id', '')::uuid;
  v_base integer := coalesce(nullif(p_op->>'baseVersion', '')::integer, 0);
  v_status text := coalesce(nullif(v_payload->>'status', ''), 'active');
  v_plan_type text;
  v_billing_cycle text;
  v_renewal_default boolean;
  v_months integer;
  v_amount bigint;
  v_current public.erp_plans%rowtype;
  v_version integer;
begin
  if v_id is null or nullif(trim(v_payload->>'name'), '') is null then
    raise exception 'VALIDATION_FAILED: plan id/name';
  end if;
  if v_status not in ('active','archived') then raise exception 'VALIDATION_FAILED: status'; end if;
  select * into v_current from public.erp_plans where id = v_id for update;
  v_plan_type := coalesce(nullif(v_payload->>'planType', ''), v_current.plan_type, 'subscription');
  v_billing_cycle := coalesce(nullif(v_payload->>'billingCycle', ''), v_current.billing_cycle, 'joining');
  v_status := coalesce(nullif(v_payload->>'status', ''), v_current.status, 'active');
  v_amount := coalesce(nullif(v_payload->>'amountPaise', '')::bigint, v_current.amount_paise, 0);
  v_months := case
    when v_plan_type = 'one_month' then 1
    else coalesce(nullif(v_payload->>'durationMonths', '')::integer, v_current.duration_months, 1)
  end;
  v_renewal_default := case
    when v_plan_type = 'one_month' then false
    when v_payload ? 'renewalEnabledDefault' then coalesce(nullif(v_payload->>'renewalEnabledDefault', '')::boolean, coalesce(v_current.renewal_enabled_default, true))
    else coalesce(v_current.renewal_enabled_default, true)
  end;
  if v_plan_type not in ('subscription','one_month')
     or v_billing_cycle not in ('joining','calendar')
     or v_status not in ('active','archived')
     or v_months < 1 or v_months > 24 or v_amount < 0 then
    raise exception 'VALIDATION_FAILED: plan template';
  end if;
  if v_current.id is not null then
    if v_current.org_id <> p_org then
      return public.erp__sync_result(p_op, 'conflict', v_id, null, 'ID_IN_USE', 'That record ID is already in use.');
    end if;
    if v_base <> v_current.sync_version then
      return public.erp__sync_result(p_op, 'conflict', v_id, v_current.sync_version, 'VERSION_CONFLICT', 'This plan changed in Supabase after it was copied to this device.');
    end if;
    update public.erp_plans set
      name = trim(v_payload->>'name'), amount_paise = v_amount,
      duration_months = v_months, plan_type = v_plan_type,
      billing_cycle = v_billing_cycle, renewal_enabled_default = v_renewal_default,
      status = v_status
     where id = v_id returning sync_version into v_version;
  else
    if v_base > 0 then
      return public.erp__sync_result(p_op, 'conflict', null, null, 'RECORD_MISSING', 'This plan no longer exists in Supabase.');
    end if;
    insert into public.erp_plans(id, org_id, name, amount_paise, duration_months,
      plan_type, billing_cycle, renewal_enabled_default, status)
    values (v_id, p_org, trim(v_payload->>'name'), v_amount, v_months,
      v_plan_type, v_billing_cycle, v_renewal_default, v_status)
    returning sync_version into v_version;
  end if;
  return public.erp__sync_result(p_op, 'applied', v_id, v_version);
end $$;

create or replace function public.erp__sync_apply_membership(p_org uuid, p_op jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb := coalesce(p_op->'payload', '{}'::jsonb);
  v_id uuid := nullif(v_payload->>'id', '')::uuid;
  v_student uuid := nullif(v_payload->>'studentId', '')::uuid;
  v_plan uuid := nullif(v_payload->>'planId', '')::uuid;
  v_branch uuid := nullif(v_payload->>'branchId', '')::uuid;
  v_start date := nullif(v_payload->>'startDate', '')::date;
  v_cycle text := coalesce(nullif(v_payload->>'billingCycle', ''), 'joining');
  v_status text := coalesce(nullif(v_payload->>'status', ''), 'active');
  v_base integer := coalesce(nullif(p_op->>'baseVersion', '')::integer, 0);
  v_months integer;
  v_amount bigint;
  v_end date;
  v_current public.erp_memberships%rowtype;
  v_source public.erp_memberships%rowtype;
  v_child public.erp_memberships%rowtype;
  v_version integer;
  v_student_branch uuid;
  v_plan_type text;
  v_offering_type text := nullif(v_payload->>'offeringType', '');
  v_auto_renew boolean := coalesce(nullif(v_payload->>'autoRenew', '')::boolean, true);
  v_previous uuid := nullif(v_payload->>'previousMembershipId', '')::uuid;
  v_renewal_number integer := coalesce(nullif(v_payload->>'renewalNumber', '')::integer, 0);
  v_paused_from date := nullif(v_payload->>'pausedFrom', '')::date;
  v_paused_until date := nullif(v_payload->>'pausedUntil', '')::date;
  v_pause_reason text := left(trim(coalesce(v_payload->>'pauseReason', '')), 500);
  v_total_paused_days integer := coalesce(nullif(v_payload->>'totalPausedDays', '')::integer, 0);
  v_cancelled_at timestamptz := nullif(v_payload->>'cancelledAt', '')::timestamptz;
  v_cancel_reason text := left(trim(coalesce(v_payload->>'cancelReason', '')), 500);
begin
  if v_id is null or v_student is null or v_plan is null or v_start is null then
    raise exception 'VALIDATION_FAILED: membership id/studentId/planId/startDate';
  end if;
  if v_cycle not in ('joining','calendar') or v_status not in ('active','paused','cancelled') then
    raise exception 'VALIDATION_FAILED: membership billingCycle/status';
  end if;
  if v_renewal_number < 0 or v_renewal_number > 10000
     or v_total_paused_days < 0 or v_total_paused_days > 3660 then
    raise exception 'VALIDATION_FAILED: membership lifecycle';
  end if;
  if v_status = 'paused' then
    if v_paused_from is null then raise exception 'VALIDATION_FAILED: pausedFrom'; end if;
    if v_paused_until is not null and v_paused_until < v_paused_from then
      raise exception 'VALIDATION_FAILED: pausedUntil';
    end if;
  else
    v_paused_from := null; v_paused_until := null; v_pause_reason := '';
  end if;
  if v_status = 'cancelled' then
    v_cancelled_at := coalesce(v_cancelled_at, now());
  else
    v_cancelled_at := null; v_cancel_reason := '';
  end if;

  select branch_id into v_student_branch from public.erp_students
   where id = v_student and org_id = p_org;
  if v_student_branch is null then raise exception 'FORBIDDEN'; end if;
  v_branch := coalesce(v_branch, v_student_branch);
  perform public.erp__require_branch_manager(p_org, v_student_branch);
  perform public.erp__require_branch_manager(p_org, v_branch);
  select duration_months, amount_paise, plan_type into v_months, v_amount, v_plan_type
    from public.erp_plans where id = v_plan and org_id = p_org;
  if v_months is null then raise exception 'FORBIDDEN'; end if;
  select * into v_current from public.erp_memberships where id = v_id for update;
  v_offering_type := coalesce(v_current.offering_type, v_offering_type, v_plan_type, 'subscription');
  if v_offering_type not in ('subscription','one_month') then
    raise exception 'VALIDATION_FAILED: offeringType';
  end if;
  if v_current.id is null and nullif(v_payload->>'offeringType', '') is not null
     and nullif(v_payload->>'offeringType', '') is distinct from v_plan_type then
    raise exception 'VALIDATION_FAILED: offeringType/planType';
  end if;
  v_months := coalesce(nullif(v_payload->>'durationMonths', '')::integer, v_months);
  v_amount := coalesce(nullif(v_payload->>'amountPaise', '')::bigint, v_amount);
  if v_offering_type = 'one_month' then
    if v_previous is not null then raise exception 'VALIDATION_FAILED: ONE_MONTH_NO_RENEWAL'; end if;
    if v_status = 'paused' then raise exception 'VALIDATION_FAILED: ONE_MONTH_NO_PAUSE'; end if;
    v_months := 1;
    v_auto_renew := false;
    v_renewal_number := 0;
    v_total_paused_days := 0;
    v_paused_from := null; v_paused_until := null; v_pause_reason := '';
  end if;
  if v_months < 1 or v_months > 24 or v_amount < 0 then
    raise exception 'VALIDATION_FAILED: membership terms';
  end if;
  if v_cycle = 'calendar' then
    v_end := (date_trunc('month', v_start)::date + (v_months || ' months')::interval - interval '1 day')::date;
  else
    v_end := (v_start + (v_months || ' months')::interval - interval '1 day')::date;
  end if;
  v_end := (v_end + (v_total_paused_days || ' days')::interval)::date;
  if v_status = 'paused' and (v_paused_from < v_start or v_paused_from > v_end) then
    raise exception 'VALIDATION_FAILED: pausedFrom';
  end if;

  if v_current.id is not null then
    if v_current.org_id <> p_org then
      return public.erp__sync_result(p_op, 'conflict', v_id, null, 'ID_IN_USE', 'That record ID is already in use.');
    end if;
    perform public.erp__require_branch_manager(p_org, v_current.branch_id);
    if v_base <> v_current.sync_version then
      return public.erp__sync_result(p_op, 'conflict', v_id, v_current.sync_version, 'VERSION_CONFLICT', 'This membership changed in Supabase after it was copied to this device.');
    end if;
    if v_current.status = 'cancelled' and v_status <> 'cancelled' then
      return public.erp__sync_result(p_op, 'conflict', v_id, v_current.sync_version, 'SUBSCRIPTION_CANCELLED', 'This subscription was cancelled in Supabase and cannot be reopened.');
    end if;
  elsif v_base > 0 then
    return public.erp__sync_result(p_op, 'conflict', null, null, 'RECORD_MISSING', 'This membership no longer exists in Supabase.');
  end if;

  if v_status = 'paused' then
    select * into v_child from public.erp_memberships
     where previous_membership_id = v_id and status <> 'cancelled'
     limit 1;
    if v_child.id is not null then
      return public.erp__sync_result(p_op, 'conflict', v_child.id, v_child.sync_version, 'ALREADY_RENEWED', 'This subscription already has a live renewal in Supabase. Cancel that future period before pausing the current one.');
    end if;
  end if;

  if v_previous is not null then
    if v_previous = v_id then raise exception 'VALIDATION_FAILED: previousMembershipId'; end if;
    select * into v_source from public.erp_memberships where id = v_previous for update;
    if v_source.id is null or v_source.org_id <> p_org then raise exception 'FORBIDDEN'; end if;
    perform public.erp__require_branch_manager(p_org, v_source.branch_id);
    if v_source.student_id <> v_student then
      raise exception 'VALIDATION_FAILED: renewal student';
    end if;
    if v_source.offering_type = 'one_month' then
      return public.erp__sync_result(p_op, 'conflict', v_source.id, v_source.sync_version, 'ONE_MONTH_NO_RENEWAL', 'A one-month pass cannot be renewed. Create a new pass or subscription instead.');
    end if;
    if v_plan_type = 'one_month'
       and (v_current.id is null or v_current.previous_membership_id is distinct from v_previous) then
      return public.erp__sync_result(p_op, 'conflict', v_source.id, v_source.sync_version, 'ONE_MONTH_NO_RENEWAL', 'Choose a subscription plan for a renewal; a one-month-only plan cannot create a renewal period.');
    end if;
    if v_source.status = 'cancelled'
       and (v_current.id is null or v_current.previous_membership_id is distinct from v_previous) then
      return public.erp__sync_result(p_op, 'conflict', v_source.id, v_source.sync_version, 'SUBSCRIPTION_CANCELLED', 'The previous subscription was cancelled in Supabase, so this renewal cannot follow it.');
    end if;
    if v_source.status = 'paused'
       and (v_current.id is null or v_current.previous_membership_id is distinct from v_previous) then
      return public.erp__sync_result(p_op, 'conflict', v_source.id, v_source.sync_version, 'SUBSCRIPTION_PAUSED', 'Resume the previous subscription in Supabase before creating its renewal, so the renewed start date is final.');
    end if;
    if nullif(v_payload->>'renewalNumber', '') is null then
      v_renewal_number := v_source.renewal_number + 1;
    end if;
    if v_status <> 'cancelled' then
      select * into v_child from public.erp_memberships
       where previous_membership_id = v_previous and status <> 'cancelled' and id <> v_id
       limit 1;
      if v_child.id is not null then
        return public.erp__sync_result(p_op, 'conflict', v_child.id, v_child.sync_version, 'ALREADY_RENEWED', 'This subscription was already renewed in Supabase. Review the existing renewal before discarding this device copy.');
      end if;
    end if;
  end if;

  if v_current.id is not null then
    update public.erp_memberships set
      student_id = v_student, plan_id = v_plan, branch_id = v_branch,
      start_date = v_start, end_date = v_end, billing_cycle = v_cycle,
      duration_months = v_months, amount_paise = v_amount, status = v_status,
      offering_type = v_offering_type,
      auto_renew = v_auto_renew, previous_membership_id = v_previous,
      renewal_number = v_renewal_number, paused_from = v_paused_from,
      paused_until = v_paused_until, pause_reason = v_pause_reason,
      total_paused_days = v_total_paused_days, cancelled_at = v_cancelled_at,
      cancel_reason = v_cancel_reason
     where id = v_id returning sync_version into v_version;
  else
    insert into public.erp_memberships(
      id, org_id, student_id, plan_id, branch_id, start_date, end_date,
      billing_cycle, duration_months, amount_paise, status, offering_type, auto_renew,
      previous_membership_id, renewal_number, paused_from, paused_until,
      pause_reason, total_paused_days, cancelled_at, cancel_reason)
    values (v_id, p_org, v_student, v_plan, v_branch, v_start, v_end, v_cycle,
      v_months, v_amount, v_status, v_offering_type, v_auto_renew, v_previous, v_renewal_number,
      v_paused_from, v_paused_until, v_pause_reason, v_total_paused_days,
      v_cancelled_at, v_cancel_reason)
    returning sync_version into v_version;
  end if;
  return public.erp__sync_result(p_op, 'applied', v_id, v_version);
end $$;

create or replace function public.erp__sync_apply_payment(p_org uuid, p_op jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb := coalesce(p_op->'payload', '{}'::jsonb);
  v_type text := p_op->>'type';
  v_id uuid := coalesce(nullif(v_payload->>'id', '')::uuid, nullif(p_op->>'entityId', '')::uuid);
  v_base integer := coalesce(nullif(p_op->>'baseVersion', '')::integer, 0);
  v_current public.erp_payments%rowtype;
  v_membership public.erp_memberships%rowtype;
  v_amount bigint := nullif(v_payload->>'amountPaise', '')::bigint;
  v_paid date := coalesce(nullif(v_payload->>'paidOn', '')::date, current_date);
  v_method text := coalesce(nullif(v_payload->>'method', ''), 'cash');
  v_reason text := trim(coalesce(v_payload->>'reason', ''));
  v_next bigint;
  v_receipt text;
  v_version integer;
begin
  if v_id is null then raise exception 'VALIDATION_FAILED: payment id'; end if;

  if v_type = 'payment_void' then
    select * into v_current from public.erp_payments where id = v_id for update;
    if v_current.id is null then
      return public.erp__sync_result(p_op, 'conflict', null, null, 'RECORD_MISSING', 'This payment no longer exists in Supabase.');
    end if;
    if v_current.org_id <> p_org then raise exception 'FORBIDDEN'; end if;
    if v_current.branch_id is not null then
      perform public.erp__require_branch_manager(p_org, v_current.branch_id);
    elsif not public.erp__is_org_manager(p_org) then
      raise exception 'FORBIDDEN';
    end if;
    if v_current.status = 'void' then
      return public.erp__sync_result(p_op, 'applied', v_id, v_current.sync_version, 'ALREADY_VOID', 'This payment was already voided.', v_current.receipt_no);
    end if;
    if v_base <> v_current.sync_version then
      return public.erp__sync_result(p_op, 'conflict', v_id, v_current.sync_version, 'VERSION_CONFLICT', 'This payment changed in Supabase after it was copied to this device.', v_current.receipt_no);
    end if;
    if v_reason = '' then raise exception 'VALIDATION_FAILED: void reason'; end if;
    update public.erp_payments set
      status = 'void', void_reason = v_reason, voided_at = now(), voided_by = auth.uid()
     where id = v_id returning sync_version, receipt_no into v_version, v_receipt;
    return public.erp__sync_result(p_op, 'applied', v_id, v_version, null, null, v_receipt);
  end if;

  if v_type <> 'payment_create' then raise exception 'VALIDATION_FAILED: payment operation'; end if;
  if v_amount is null or v_amount <= 0 or v_method not in ('cash','upi','card','bank') then
    raise exception 'VALIDATION_FAILED: payment amountPaise/method';
  end if;
  select * into v_membership from public.erp_memberships
   where id = nullif(v_payload->>'membershipId', '')::uuid for update;
  if v_membership.id is null or v_membership.org_id <> p_org then raise exception 'FORBIDDEN'; end if;
  perform public.erp__require_branch_manager(p_org, v_membership.branch_id);

  select * into v_current from public.erp_payments where id = v_id for update;
  if v_current.id is not null then
    if v_current.org_id = p_org and v_current.membership_id = v_membership.id
       and v_current.amount_paise = v_amount and v_current.method = v_method
       and v_current.paid_on = v_paid and v_current.status = 'recorded' then
      return public.erp__sync_result(p_op, 'applied', v_id, v_current.sync_version, 'ALREADY_RECORDED', 'This payment was already recorded.', v_current.receipt_no);
    end if;
    return public.erp__sync_result(p_op, 'conflict', v_id, v_current.sync_version, 'ID_IN_USE', 'That payment ID is already in use.', v_current.receipt_no);
  end if;
  if v_base > 0 then
    return public.erp__sync_result(p_op, 'conflict', null, null, 'RECORD_MISSING', 'This payment no longer exists in Supabase.');
  end if;
  if v_membership.status = 'cancelled' then
    return public.erp__sync_result(p_op, 'rejected', v_membership.id, v_membership.sync_version,
      'SUBSCRIPTION_CANCELLED', 'This subscription was cancelled in Supabase, so the payment was not recorded.');
  end if;

  insert into public.erp_counters(org_id, receipt) values (p_org, 1)
  on conflict (org_id) do update set receipt = public.erp_counters.receipt + 1
  returning receipt into v_next;
  v_receipt := 'YS-' || to_char(v_paid, 'YYYY') || '-' || lpad(v_next::text, 4, '0');
  insert into public.erp_payments(id, org_id, student_id, membership_id, branch_id, amount_paise,
                                   method, paid_on, receipt_no, note, recorded_by, status)
  values (v_id, p_org, v_membership.student_id, v_membership.id, v_membership.branch_id, v_amount,
          v_method, v_paid, v_receipt, coalesce(v_payload->>'note', ''), auth.uid(), 'recorded')
  returning sync_version into v_version;
  return public.erp__sync_result(p_op, 'applied', v_id, v_version, null, null, v_receipt);
end $$;


create or replace function public.erp__sync_apply_billing_settings(p_org uuid, p_op jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payload jsonb := coalesce(p_op->'payload', '{}'::jsonb);
  v_id uuid := coalesce(nullif(v_payload->>'id', '')::uuid, p_org);
  v_base integer := coalesce(nullif(p_op->>'baseVersion', '')::integer, 0);
  v_provider text := coalesce(nullif(v_payload->>'gatewayProvider', ''), 'none');
  v_environment text := coalesce(nullif(v_payload->>'gatewayEnvironment', ''), 'test');
  v_rate numeric := coalesce(nullif(v_payload->>'gstRatePercent', '')::numeric, 18);
  v_due_days integer := coalesce(nullif(v_payload->>'dueDays', '')::integer, 7);
  v_gst_enabled boolean := coalesce(nullif(v_payload->>'gstEnabled', '')::boolean, false);
  v_price_includes boolean := coalesce(nullif(v_payload->>'priceIncludesGst', '')::boolean, true);
  v_webhook_configured boolean := coalesce(nullif(v_payload->>'gatewayWebhookConfigured', '')::boolean, false);
  v_state_code text := coalesce(nullif(v_payload->>'stateCode', ''), '27');
  v_gstin text := upper(coalesce(v_payload->>'gstin', ''));
  v_current public.erp_billing_settings%rowtype;
  v_version integer;
begin
  if nullif(trim(v_payload->>'legalName'), '') is null then
    raise exception 'VALIDATION_FAILED: billing legalName';
  end if;
  if v_provider not in ('none','razorpay','cashfree')
     or v_environment not in ('test','live') then
    raise exception 'VALIDATION_FAILED: gateway provider/environment';
  end if;
  if v_rate < 0 or v_rate > 28 or v_due_days < 0 or v_due_days > 60 then
    raise exception 'VALIDATION_FAILED: billing gstRatePercent/dueDays';
  end if;
  if v_state_code !~ '^[0-9]{2}$' then
    raise exception 'VALIDATION_FAILED: billing stateCode';
  end if;
  if v_gst_enabled and v_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'VALIDATION_FAILED: billing gstin';
  end if;

  select * into v_current from public.erp_billing_settings where org_id = p_org for update;
  if v_current.id is not null then
    if v_base <> v_current.sync_version then
      return public.erp__sync_result(p_op, 'conflict', v_current.id, v_current.sync_version,
        'VERSION_CONFLICT', 'Payment/invoice settings changed in Supabase after they were copied to this device.');
    end if;
    update public.erp_billing_settings set
      legal_name = trim(v_payload->>'legalName'),
      email = coalesce(v_payload->>'email', ''), phone = coalesce(v_payload->>'phone', ''),
      address = coalesce(v_payload->>'address', ''), city = coalesce(v_payload->>'city', ''),
      state_name = coalesce(nullif(v_payload->>'state', ''), 'Maharashtra'),
      state_code = v_state_code, pin_code = coalesce(v_payload->>'pinCode', ''),
      gst_enabled = v_gst_enabled, gstin = v_gstin, gst_rate_percent = v_rate,
      sac_code = coalesce(v_payload->>'sacCode', ''), price_includes_gst = v_price_includes,
      invoice_prefix = coalesce(nullif(upper(v_payload->>'invoicePrefix'), ''), 'YS-INV'),
      due_days = v_due_days, terms = coalesce(v_payload->>'terms', ''),
      upi_id = coalesce(v_payload->>'upiId', ''),
      upi_payee_name = coalesce(v_payload->>'upiPayeeName', ''),
      bank_name = coalesce(v_payload->>'bankName', ''),
      bank_account_name = coalesce(v_payload->>'bankAccountName', ''),
      bank_account_number = coalesce(v_payload->>'bankAccountNumber', ''),
      bank_account_type = coalesce(nullif(v_payload->>'bankAccountType', ''), 'Current'),
      ifsc = upper(coalesce(v_payload->>'ifsc', '')),
      gateway_provider = v_provider, gateway_environment = v_environment,
      gateway_public_key_id = coalesce(v_payload->>'gatewayPublicKeyId', ''),
      gateway_webhook_url = coalesce(v_payload->>'gatewayWebhookUrl', ''),
      gateway_webhook_configured = v_webhook_configured,
      status = 'active'
     where org_id = p_org returning id, sync_version into v_id, v_version;
  else
    if v_base > 0 then
      return public.erp__sync_result(p_op, 'conflict', null, null,
        'RECORD_MISSING', 'Payment/invoice settings no longer exist in Supabase.');
    end if;
    insert into public.erp_billing_settings(
      id, org_id, legal_name, email, phone, address, city, state_name, state_code,
      pin_code, gst_enabled, gstin, gst_rate_percent, sac_code, price_includes_gst,
      invoice_prefix, due_days, terms, upi_id, upi_payee_name, bank_name,
      bank_account_name, bank_account_number, bank_account_type, ifsc,
      gateway_provider, gateway_environment, gateway_public_key_id,
      gateway_webhook_url, gateway_webhook_configured, status)
    values (
      v_id, p_org, trim(v_payload->>'legalName'), coalesce(v_payload->>'email', ''),
      coalesce(v_payload->>'phone', ''), coalesce(v_payload->>'address', ''),
      coalesce(v_payload->>'city', ''), coalesce(nullif(v_payload->>'state', ''), 'Maharashtra'),
      v_state_code, coalesce(v_payload->>'pinCode', ''), v_gst_enabled, v_gstin,
      v_rate, coalesce(v_payload->>'sacCode', ''), v_price_includes,
      coalesce(nullif(upper(v_payload->>'invoicePrefix'), ''), 'YS-INV'), v_due_days,
      coalesce(v_payload->>'terms', ''), coalesce(v_payload->>'upiId', ''),
      coalesce(v_payload->>'upiPayeeName', ''), coalesce(v_payload->>'bankName', ''),
      coalesce(v_payload->>'bankAccountName', ''), coalesce(v_payload->>'bankAccountNumber', ''),
      coalesce(nullif(v_payload->>'bankAccountType', ''), 'Current'),
      upper(coalesce(v_payload->>'ifsc', '')), v_provider, v_environment,
      coalesce(v_payload->>'gatewayPublicKeyId', ''),
      coalesce(v_payload->>'gatewayWebhookUrl', ''), v_webhook_configured, 'active')
    returning sync_version into v_version;
  end if;
  return public.erp__sync_result(p_op, 'applied', v_id, v_version);
end $$;

create or replace function public.erp_sync_push(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_actor uuid := auth.uid();
  v_device text := left(coalesce(p_payload->>'deviceId', ''), 80);
  v_operations jsonb := coalesce(p_payload->'operations', '[]'::jsonb);
  v_op jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_existing public.erp_sync_operations%rowtype;
  v_op_id uuid;
  v_entity text;
  v_type text;
  v_entity_id uuid;
  v_base integer;
  v_authorized boolean;
  v_batch uuid;
  v_sqlstate text;
  v_message text;
begin
  v_org := public.erp__require_org();
  if jsonb_typeof(v_operations) <> 'array' then
    raise exception 'VALIDATION_FAILED: operations must be an array';
  end if;
  if jsonb_array_length(v_operations) > 100 then
    raise exception 'VALIDATION_FAILED: too many sync operations in one batch';
  end if;

  for v_op in select value from jsonb_array_elements(v_operations) loop
    v_result := null;
    v_existing := null;
    v_op_id := null;
    v_entity_id := null;
    v_base := null;
    begin
      v_op_id := nullif(v_op->>'opId', '')::uuid;
      v_entity := v_op->>'entity';
      v_type := v_op->>'type';
      v_entity_id := nullif(v_op->>'entityId', '')::uuid;
      v_base := coalesce(nullif(v_op->>'baseVersion', '')::integer, 0);
      if v_op_id is null or v_entity is null or v_type is null then
        raise exception 'VALIDATION_FAILED: sync operation opId/entity/type';
      end if;

      select * into v_existing from public.erp_sync_operations
       where org_id = v_org and op_id = v_op_id for update;
      if v_existing.op_id is not null then
        if v_existing.actor <> v_actor then
          v_result := public.erp__sync_result(v_op, 'conflict', v_existing.entity_id, null,
            'OP_ID_IN_USE', 'That sync operation ID was already used by another account.');
        elsif v_existing.status = 'applied' then
          v_result := v_existing.result || jsonb_build_object('status', 'duplicate');
        else
          v_result := v_existing.result;
        end if;
      else
        v_authorized := false;
        if v_entity = 'attendance' and v_type = 'upsert' then
          v_batch := nullif((v_op->'payload')->>'batchId', '')::uuid;
          v_authorized := public.erp_can_manage() or (
            public.erp_my_instructor_id() is not null and exists (
              select 1 from public.erp_batches
               where id = v_batch and org_id = v_org
                 and instructor_id = public.erp_my_instructor_id()));
        elsif v_entity in ('branches','students','instructors','batches','enrollments','memberships')
              and v_type = 'upsert' then
          v_authorized := public.erp_can_manage();
        elsif v_entity in ('plans','billingSettings') and v_type = 'upsert' then
          v_authorized := public.erp__is_org_manager(v_org);
        elsif v_entity = 'payments' and v_type in ('payment_create','payment_void') then
          v_authorized := public.erp_can_manage();
        end if;

        if not v_authorized then
          v_result := public.erp__sync_result(v_op, 'rejected', null, null,
            'FORBIDDEN', 'Your current role cannot apply this change.');
        elsif v_entity = 'branches' then
          v_result := public.erp__sync_apply_branch(v_org, v_op);
        elsif v_entity = 'students' then
          v_result := public.erp__sync_apply_student(v_org, v_op);
        elsif v_entity = 'instructors' then
          v_result := public.erp__sync_apply_instructor(v_org, v_op);
        elsif v_entity = 'batches' then
          v_result := public.erp__sync_apply_batch(v_org, v_op);
        elsif v_entity = 'enrollments' then
          v_result := public.erp__sync_apply_enrollment(v_org, v_op);
        elsif v_entity = 'attendance' then
          v_result := public.erp__sync_apply_attendance(v_org, v_op);
        elsif v_entity = 'plans' then
          v_result := public.erp__sync_apply_plan(v_org, v_op);
        elsif v_entity = 'memberships' then
          v_result := public.erp__sync_apply_membership(v_org, v_op);
        elsif v_entity = 'billingSettings' then
          v_result := public.erp__sync_apply_billing_settings(v_org, v_op);
        elsif v_entity = 'payments' then
          v_result := public.erp__sync_apply_payment(v_org, v_op);
        else
          v_result := public.erp__sync_result(v_op, 'rejected', null, null,
            'UNSUPPORTED_OPERATION', 'That sync operation is not supported.');
        end if;

        if v_result->>'status' = 'applied' then
          insert into public.erp_audit_log(org_id, actor, action, entity, entity_id, detail)
          values (v_org, v_actor, 'sync_' || v_type, v_entity,
                  nullif(v_result->>'serverEntityId', '')::uuid,
                  jsonb_build_object('syncOpId', v_op_id, 'deviceId', v_device,
                                     'baseVersion', v_base,
                                     'serverVersion', nullif(v_result->>'serverVersion', '')::integer));
        end if;

        insert into public.erp_sync_operations(
          org_id, op_id, actor, device_id, op_type, entity, entity_id, payload,
          base_version, status, result, client_created_at)
        values (
          v_org, v_op_id, v_actor, v_device, v_type, v_entity,
          coalesce(nullif(v_result->>'serverEntityId', '')::uuid, v_entity_id),
          '{}'::jsonb, v_base, v_result->>'status', v_result,
          nullif(v_op->>'clientCreatedAt', '')::timestamptz);
      end if;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      v_result := public.erp__sync_result(v_op, 'rejected', null, null,
        v_sqlstate, left(coalesce(v_message, 'Sync operation failed.'), 240));
      begin
        v_op_id := coalesce(v_op_id, nullif(v_op->>'opId', '')::uuid);
      exception when others then
        v_op_id := null;
      end;
      if v_op_id is not null then
        insert into public.erp_sync_operations(
          org_id, op_id, actor, device_id, op_type, entity, entity_id, payload,
          base_version, status, result, client_created_at)
        values (
          v_org, v_op_id, v_actor, v_device, coalesce(v_op->>'type', 'unknown'),
          coalesce(v_op->>'entity', 'unknown'), nullif(v_op->>'entityId', '')::uuid,
          '{}'::jsonb,
          nullif(v_op->>'baseVersion', '')::integer, 'rejected', v_result,
          nullif(v_op->>'clientCreatedAt', '')::timestamptz)
        on conflict (org_id, op_id) do nothing;
      end if;
    end;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object('serverTime', now(), 'results', v_results);
end $$;

-- Internal sync helpers are called only by erp_sync_push (same owner). They
-- must not become a second browser-callable data door.
revoke all on function public.erp__touch_sync() from public, anon, authenticated;
revoke all on function public.erp__move_student_access_branch() from public, anon, authenticated;
revoke all on function public.erp__sync_result(jsonb, text, uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.erp__sync_apply_branch(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.erp__sync_apply_student(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.erp__sync_apply_instructor(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.erp__sync_apply_batch(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.erp__sync_apply_enrollment(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.erp__sync_apply_attendance(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.erp__sync_apply_plan(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.erp__sync_apply_membership(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.erp__sync_apply_payment(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.erp__sync_apply_billing_settings(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.erp__org_role(uuid) from public, anon, authenticated;
revoke all on function public.erp__is_org_manager(uuid) from public, anon, authenticated;
revoke all on function public.erp__is_primary_owner(uuid) from public, anon, authenticated;
revoke all on function public.erp__admin_branch_ids(uuid) from public, anon, authenticated;
revoke all on function public.erp__can_manage_branch(uuid, uuid) from public, anon, authenticated;
revoke all on function public.erp__require_branch_manager(uuid, uuid) from public, anon, authenticated;
revoke all on function public.erp__require_org_manager() from public, anon, authenticated;
revoke all on function public.erp__resolve_access_account(text) from public, anon, authenticated;
revoke all on function public.erp__assert_access_account_available(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.erp__can_manage_instructor_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.erp__admission_json(public.erp_admissions) from public, anon, authenticated;
revoke all on function public.erp__admission_org(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Function permissions: signed-in users only; never anonymous.
-- ----------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'erp_current_org()', 'erp_my_roles()', 'erp_can_manage()',
    'erp_my_instructor_id()', 'erp_my_student_id()', 'erp__require_org()',
    'erp__require_manager()', 'erp__log(uuid, text, text, uuid)',
    'erp_bootstrap_organization(text)', 'erp_get_context()', 'erp_get_snapshot()',
    'erp_save_branch(jsonb)', 'erp_archive_branch(uuid)', 'erp_save_student(jsonb)',
    'erp_archive_student(uuid)', 'erp_grant_student_access(uuid, text)',
    'erp_revoke_student_access(uuid)', 'erp_get_my_admission(text)',
    'erp_submit_admission(text, jsonb)', 'erp_get_admission_link_info()',
    'erp_list_admissions(text)',
    'erp_review_admission(uuid, text, uuid, date, text)',
    'erp_list_role_access()',
    'erp_grant_co_owner_access(text)', 'erp_revoke_co_owner_access(uuid)',
    'erp_grant_admin_access(text, uuid[])', 'erp_revoke_admin_access(uuid)',
    'erp_grant_instructor_access(uuid, text, uuid[])',
    'erp_revoke_instructor_access(uuid)',
    'erp_save_instructor(jsonb)', 'erp_save_batch(jsonb)',
    'erp_archive_batch(uuid)', 'erp_enroll_student(jsonb)', 'erp_end_enrollment(uuid)',
    'erp_mark_attendance(jsonb)', 'erp_save_plan(jsonb)', 'erp_save_membership(jsonb)',
    'erp_cancel_membership(uuid)', 'erp_record_payment(jsonb)', 'erp_sync_push(jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ============================================================================
-- AFTER SETUP — giving other people access
-- Preferred for every role: use Access in the app (and Students -> Portal
-- access for a Student). The person creates and confirms an account first,
-- must NOT create their own organization, and an authorized manager enters
-- that exact sign-in email. The commented SQL below is for emergency link
-- repair only and bypasses the app's account/role-conflict checks, so the
-- database owner must verify the organization, branch and linked record.
-- Find branch / student / instructor ids in the app or with a select, e.g.
--   select id, name from public.erp_branches;
--
-- Emergency repair — Co-Owner (operational, all branches):
-- insert into public.erp_org_members(org_id, user_id, role)
-- select (select id from public.erp_organizations limit 1), id, 'co_owner'
--   from auth.users where email = 'partner@example.com';
--
-- Emergency repair — Branch Admin:
-- insert into public.erp_branch_members(branch_id, user_id, role)
-- select '<BRANCH_UUID>', id, 'admin' from auth.users
--  where email = 'desk@example.com';
--
-- Emergency repair — Instructor (link to the instructor record so they see
-- only batches in branches where this access row is active):
-- insert into public.erp_branch_members(branch_id, user_id, role, instructor_id)
-- select '<BRANCH_UUID>', id, 'instructor', '<INSTRUCTOR_UUID>'
--   from auth.users where email = 'teacher@example.com';
--
-- Student emergency repair only (normally use Students -> Portal access;
-- the branch UUID must be the student record's current branch):
-- insert into public.erp_branch_members(branch_id, user_id, role, student_id)
-- select '<BRANCH_UUID>', id, 'student', '<STUDENT_UUID>'
--   from auth.users where email = 'student@example.com';
--
-- Remove access in the app: Access for Co-owner/Admin/Instructor, and
-- Students -> Portal access -> Remove access for a Student. Manual repair
-- should suspend (not delete) the matching membership row. At least one
-- active Owner must always remain; Co-owners do not count as the Owner.
-- ============================================================================

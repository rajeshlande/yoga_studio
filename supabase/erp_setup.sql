-- ============================================================================
-- Yoga Studio ERP (Core) — THE single Supabase setup file. SQL version 1.
-- Matches app version 1.2.0.
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
--   4. Giving other people access: they sign up in the app first, then run
--      one of the commented examples at the very bottom of this file.
--
-- SECURITY MODEL
--   * Tables have Row Level Security enabled with NO direct-access policies
--     and all table grants revoked from browser roles, so the Data API
--     cannot read/write them directly.
--   * The app reaches business data ONLY through the erp_* functions below
--     (function-only policy). Each function re-checks auth.uid(), the
--     caller's organization and role on every call and writes an audit row
--     for mutations. Money is stored as integer paise.
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
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now()
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
  status text not null default 'active' check (status in ('active','cancelled')),
  created_at timestamptz not null default now()
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
    'erp_attendance','erp_plans','erp_memberships','erp_payments',
    'erp_counters','erp_audit_log']
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
      where bm.user_id = auth.uid() and bm.status = 'active' limit 1))
$$;

create or replace function public.erp_my_roles()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct r), '{}') from (
    select case role when 'owner' then 'owner' when 'co_owner' then 'admin' end as r
      from public.erp_org_members where user_id = auth.uid() and status = 'active'
    union all
    select role from public.erp_branch_members
      where user_id = auth.uid() and status = 'active'
  ) s where r is not null
$$;

create or replace function public.erp_can_manage()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.erp_org_members
                  where user_id = auth.uid() and status = 'active')
      or exists (select 1 from public.erp_branch_members
                  where user_id = auth.uid() and status = 'active' and role = 'admin')
$$;

create or replace function public.erp_my_instructor_id()
returns uuid language sql stable security definer set search_path = public as $$
  select instructor_id from public.erp_branch_members
   where user_id = auth.uid() and status = 'active' and role = 'instructor'
     and instructor_id is not null limit 1
$$;

create or replace function public.erp_my_student_id()
returns uuid language sql stable security definer set search_path = public as $$
  select student_id from public.erp_branch_members
   where user_id = auth.uid() and status = 'active' and role = 'student'
     and student_id is not null limit 1
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
declare v_org uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  v_org := public.erp_current_org();
  if v_org is null then
    return jsonb_build_object('organizationId', null, 'roles', '[]'::jsonb);
  end if;
  select name into v_name from public.erp_organizations where id = v_org;
  return jsonb_build_object(
    'organizationId', v_org,
    'organizationName', coalesce(v_name, ''),
    'roles', to_jsonb(public.erp_my_roles()),
    'instructorId', public.erp_my_instructor_id(),
    'studentId', public.erp_my_student_id()
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
  v_branches uuid[];
begin
  v_org := public.erp__require_org();
  v_roles := public.erp_my_roles();
  v_org_mgr := exists (select 1 from public.erp_org_members
                        where user_id = auth.uid() and status = 'active' and org_id = v_org);
  v_student := public.erp_my_student_id();
  v_instructor := public.erp_my_instructor_id();
  if v_org_mgr then
    select coalesce(array_agg(id), '{}') into v_branches
      from public.erp_branches where org_id = v_org;
  else
    select coalesce(array_agg(distinct branch_id), '{}') into v_branches
      from public.erp_branch_members bm join public.erp_branches b on b.id = bm.branch_id
     where bm.user_id = auth.uid() and bm.status = 'active' and b.org_id = v_org;
  end if;

  return jsonb_build_object(
    'branches', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'city', city, 'address', address, 'phone', phone,
        'status', status, 'createdAt', created_at) order by created_at), '[]')
      from public.erp_branches where org_id = v_org and id = any(v_branches)),
    'students', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'branchId', s.branch_id, 'fullName', s.full_name, 'phone', s.phone,
        'email', s.email, 'gender', s.gender, 'dob', coalesce(s.dob::text, ''),
        'joiningDate', s.joining_date::text, 'status', s.status, 'notes', s.notes,
        'createdAt', s.created_at) order by s.full_name), '[]')
      from public.erp_students s
     where s.org_id = v_org and s.branch_id = any(v_branches)
       and (v_org_mgr or 'admin' = any(v_roles)
            or (v_student is not null and s.id = v_student)
            or (v_instructor is not null and exists (
              select 1 from public.erp_enrollments e join public.erp_batches bt on bt.id = e.batch_id
               where e.student_id = s.id and e.status = 'active' and bt.instructor_id = v_instructor)))),
    'instructors', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'branchId', coalesce(branch_id::text, ''), 'fullName', full_name,
        'phone', phone, 'email', email, 'status', status, 'createdAt', created_at)
        order by full_name), '[]')
      from public.erp_instructors where org_id = v_org
        and (branch_id is null or branch_id = any(v_branches))),
    'batches', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', bt.id, 'branchId', bt.branch_id, 'name', bt.name,
        'instructorId', coalesce(bt.instructor_id::text, ''), 'days', to_jsonb(bt.days),
        'startTime', to_char(bt.start_time, 'HH24:MI'), 'durationMins', bt.duration_mins,
        'capacity', bt.capacity, 'status', bt.status, 'createdAt', bt.created_at)
        order by bt.start_time), '[]')
      from public.erp_batches bt
     where bt.org_id = v_org and bt.branch_id = any(v_branches)
       and (v_org_mgr or 'admin' = any(v_roles)
            or (v_instructor is not null and bt.instructor_id = v_instructor)
            or (v_student is not null and exists (
              select 1 from public.erp_enrollments e
               where e.batch_id = bt.id and e.student_id = v_student and e.status = 'active')))),
    'enrollments', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'batchId', e.batch_id, 'studentId', e.student_id,
        'joinedOn', e.joined_on::text, 'status', e.status)), '[]')
      from public.erp_enrollments e join public.erp_batches bt on bt.id = e.batch_id
     where e.org_id = v_org and bt.branch_id = any(v_branches)
       and (v_org_mgr or 'admin' = any(v_roles)
            or (v_instructor is not null and bt.instructor_id = v_instructor)
            or (v_student is not null and e.student_id = v_student))),
    'attendance', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'batchId', a.batch_id, 'studentId', a.student_id,
        'classDate', a.class_date::text, 'status', a.status, 'updatedAt', a.updated_at)
        order by a.class_date desc), '[]')
      from public.erp_attendance a join public.erp_batches bt on bt.id = a.batch_id
     where a.org_id = v_org and bt.branch_id = any(v_branches)
       and (v_org_mgr or 'admin' = any(v_roles)
            or (v_instructor is not null and bt.instructor_id = v_instructor)
            or (v_student is not null and a.student_id = v_student))),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'amountPaise', amount_paise,
        'durationMonths', duration_months, 'status', status, 'createdAt', created_at)
        order by created_at), '[]')
      from public.erp_plans where org_id = v_org
        and (v_org_mgr or 'admin' = any(v_roles) or v_student is not null)),
    'memberships', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'studentId', m.student_id, 'planId', m.plan_id, 'branchId', m.branch_id,
        'startDate', m.start_date::text, 'endDate', m.end_date::text,
        'billingCycle', m.billing_cycle, 'durationMonths', m.duration_months,
        'amountPaise', m.amount_paise, 'status', m.status, 'createdAt', m.created_at)
        order by m.end_date), '[]')
      from public.erp_memberships m
     where m.org_id = v_org and m.branch_id = any(v_branches)
       and (v_org_mgr or 'admin' = any(v_roles)
            or (v_student is not null and m.student_id = v_student))),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'studentId', p.student_id, 'membershipId', coalesce(p.membership_id::text, ''),
        'branchId', coalesce(p.branch_id::text, ''), 'amountPaise', p.amount_paise,
        'method', p.method, 'paidOn', p.paid_on::text, 'note', p.note,
        'receiptNo', p.receipt_no, 'createdAt', p.created_at) order by p.paid_on desc), '[]')
      from public.erp_payments p
     where p.org_id = v_org and (p.branch_id is null or p.branch_id = any(v_branches))
       and (v_org_mgr or 'admin' = any(v_roles)
            or (v_student is not null and p.student_id = v_student)))
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
  update public.erp_branches
     set status = case status when 'archived' then 'active' else 'archived' end
   where id = p_id and org_id = v_org;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform public.erp__log(v_org, 'archive_toggle', 'branch', p_id);
  return jsonb_build_object('id', p_id);
end $$;

create or replace function public.erp_save_student(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid; v_branch uuid;
begin
  v_org := public.erp__require_manager();
  v_id := nullif(p_payload->>'id', '')::uuid;
  v_branch := nullif(p_payload->>'branchId', '')::uuid;
  if nullif(trim(p_payload->>'fullName'), '') is null or v_branch is null then
    raise exception 'VALIDATION_FAILED: fullName/branchId';
  end if;
  if not exists (select 1 from public.erp_branches where id = v_branch and org_id = v_org) then
    raise exception 'FORBIDDEN';
  end if;
  if v_id is null then
    insert into public.erp_students(org_id, branch_id, full_name, phone, email, gender, dob, joining_date, notes)
    values (v_org, v_branch, trim(p_payload->>'fullName'), coalesce(p_payload->>'phone', ''),
            coalesce(p_payload->>'email', ''), coalesce(p_payload->>'gender', ''),
            nullif(p_payload->>'dob', '')::date,
            coalesce(nullif(p_payload->>'joiningDate', '')::date, current_date),
            coalesce(p_payload->>'notes', ''))
    returning id into v_id;
  else
    update public.erp_students set branch_id = v_branch, full_name = trim(p_payload->>'fullName'),
      phone = coalesce(p_payload->>'phone', ''), email = coalesce(p_payload->>'email', ''),
      gender = coalesce(p_payload->>'gender', ''), dob = nullif(p_payload->>'dob', '')::date,
      joining_date = coalesce(nullif(p_payload->>'joiningDate', '')::date, joining_date),
      notes = coalesce(p_payload->>'notes', '')
     where id = v_id and org_id = v_org;
    if not found then raise exception 'FORBIDDEN'; end if;
  end if;
  perform public.erp__log(v_org, 'save', 'student', v_id);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.erp_archive_student(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := public.erp__require_manager();
  update public.erp_students
     set status = case status when 'inactive' then 'active' else 'inactive' end
   where id = p_id and org_id = v_org;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform public.erp__log(v_org, 'status_toggle', 'student', p_id);
  return jsonb_build_object('id', p_id);
end $$;

create or replace function public.erp_save_instructor(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  v_org := public.erp__require_manager();
  v_id := nullif(p_payload->>'id', '')::uuid;
  if nullif(trim(p_payload->>'fullName'), '') is null then raise exception 'VALIDATION_FAILED: fullName'; end if;
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
declare v_org uuid; v_id uuid; v_branch uuid; v_days integer[];
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
  if not exists (select 1 from public.erp_branches where id = v_branch and org_id = v_org) then
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
declare v_org uuid;
begin
  v_org := public.erp__require_manager();
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
begin
  v_org := public.erp__require_manager();
  v_batch := nullif(p_payload->>'batchId', '')::uuid;
  v_student := nullif(p_payload->>'studentId', '')::uuid;
  select capacity into v_capacity from public.erp_batches where id = v_batch and org_id = v_org;
  if v_capacity is null then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.erp_students where id = v_student and org_id = v_org) then
    raise exception 'FORBIDDEN';
  end if;
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
declare v_org uuid;
begin
  v_org := public.erp__require_manager();
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
begin
  v_org := public.erp__require_org();
  v_batch := nullif(p_payload->>'batchId', '')::uuid;
  v_date := nullif(p_payload->>'classDate', '')::date;
  if v_batch is null or v_date is null then raise exception 'VALIDATION_FAILED: batchId/classDate'; end if;
  if not exists (select 1 from public.erp_batches where id = v_batch and org_id = v_org) then
    raise exception 'FORBIDDEN';
  end if;
  v_instructor := public.erp_my_instructor_id();
  if not public.erp_can_manage()
     and not (v_instructor is not null and exists (
       select 1 from public.erp_batches where id = v_batch and instructor_id = v_instructor)) then
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
declare v_org uuid; v_id uuid;
begin
  v_org := public.erp__require_manager();
  v_id := nullif(p_payload->>'id', '')::uuid;
  if nullif(trim(p_payload->>'name'), '') is null then raise exception 'VALIDATION_FAILED: name'; end if;
  if v_id is null then
    insert into public.erp_plans(org_id, name, amount_paise, duration_months)
    values (v_org, trim(p_payload->>'name'),
            coalesce(nullif(p_payload->>'amountPaise', '')::bigint, 0),
            coalesce(nullif(p_payload->>'durationMonths', '')::integer, 1))
    returning id into v_id;
  else
    update public.erp_plans set name = trim(p_payload->>'name'),
      amount_paise = coalesce(nullif(p_payload->>'amountPaise', '')::bigint, amount_paise),
      duration_months = coalesce(nullif(p_payload->>'durationMonths', '')::integer, duration_months)
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
  v_start date; v_months integer; v_cycle text; v_end date; v_amount bigint;
begin
  v_org := public.erp__require_manager();
  v_id := nullif(p_payload->>'id', '')::uuid;
  v_student := nullif(p_payload->>'studentId', '')::uuid;
  v_plan := nullif(p_payload->>'planId', '')::uuid;
  v_start := nullif(p_payload->>'startDate', '')::date;
  v_cycle := coalesce(nullif(p_payload->>'billingCycle', ''), 'joining');
  select branch_id into v_branch from public.erp_students where id = v_student and org_id = v_org;
  if v_branch is null then raise exception 'FORBIDDEN'; end if;
  select duration_months, amount_paise into v_months, v_amount
    from public.erp_plans where id = v_plan and org_id = v_org;
  if v_months is null or v_start is null then raise exception 'VALIDATION_FAILED: planId/startDate'; end if;
  v_months := coalesce(nullif(p_payload->>'durationMonths', '')::integer, v_months);
  v_amount := coalesce(nullif(p_payload->>'amountPaise', '')::bigint, v_amount);
  v_branch := coalesce(nullif(p_payload->>'branchId', '')::uuid, v_branch);
  if v_cycle = 'calendar' then
    v_end := (date_trunc('month', v_start)::date + (v_months || ' months')::interval - interval '1 day')::date;
  else
    v_end := (v_start + (v_months || ' months')::interval - interval '1 day')::date;
  end if;
  if v_id is null then
    insert into public.erp_memberships(org_id, student_id, plan_id, branch_id, start_date, end_date,
                                       billing_cycle, duration_months, amount_paise)
    values (v_org, v_student, v_plan, v_branch, v_start, v_end, v_cycle, v_months, v_amount)
    returning id into v_id;
  else
    update public.erp_memberships set student_id = v_student, plan_id = v_plan, branch_id = v_branch,
      start_date = v_start, end_date = v_end, billing_cycle = v_cycle,
      duration_months = v_months, amount_paise = v_amount
     where id = v_id and org_id = v_org;
    if not found then raise exception 'FORBIDDEN'; end if;
  end if;
  perform public.erp__log(v_org, 'save', 'membership', v_id);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.erp_cancel_membership(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  v_org := public.erp__require_manager();
  update public.erp_memberships set status = 'cancelled' where id = p_id and org_id = v_org;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform public.erp__log(v_org, 'cancel', 'membership', p_id);
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
    from public.erp_memberships where id = v_membership and org_id = v_org and status = 'active';
  if v_student is null then raise exception 'FORBIDDEN'; end if;
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
    'erp_archive_student(uuid)', 'erp_save_instructor(jsonb)', 'erp_save_batch(jsonb)',
    'erp_archive_batch(uuid)', 'erp_enroll_student(jsonb)', 'erp_end_enrollment(uuid)',
    'erp_mark_attendance(jsonb)', 'erp_save_plan(jsonb)', 'erp_save_membership(jsonb)',
    'erp_cancel_membership(uuid)', 'erp_record_payment(jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ============================================================================
-- AFTER SETUP — giving other people access (examples; edit, uncomment, run)
-- The person must first create an account in the app with that email.
-- Find branch / student / instructor ids in the app or with a select, e.g.
--   select id, name from public.erp_branches;
--
-- Co-Owner (operational, all branches):
-- insert into public.erp_org_members(org_id, user_id, role)
-- select (select id from public.erp_organizations limit 1), id, 'co_owner'
--   from auth.users where email = 'partner@example.com';
--
-- Branch Admin:
-- insert into public.erp_branch_members(branch_id, user_id, role)
-- select '<BRANCH_UUID>', id, 'admin' from auth.users
--  where email = 'desk@example.com';
--
-- Instructor (link to the instructor record so they see only their batches):
-- insert into public.erp_branch_members(branch_id, user_id, role, instructor_id)
-- select '<BRANCH_UUID>', id, 'instructor', '<INSTRUCTOR_UUID>'
--   from auth.users where email = 'teacher@example.com';
--
-- Student (link to the student record so they see only themselves):
-- insert into public.erp_branch_members(branch_id, user_id, role, student_id)
-- select '<BRANCH_UUID>', id, 'student', '<STUDENT_UUID>'
--   from auth.users where email = 'student@example.com';
--
-- Remove access: set status = 'suspended' on the matching membership row, or
-- delete that row. At least one active Owner must always remain.
-- ============================================================================

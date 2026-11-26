-- Altio Reimbursement — admin-managed users and roles
-- Run this AFTER 26.07.29-17.03-altio-reimbursement-setup.sql and
-- 26.11.26-17.30-altio-reimbursement-requests.sql, in the same Supabase project.
--
-- From here on, who can sign in and what they can do lives in a table that admins edit
-- from the app's Users tab — no more email lists in code or SQL. This file:
--   1. creates altio_reimbursement_members (email, role, Zoho access)
--   2. pre-fills it with everyone who had access before, so nothing changes on day one
--   3. re-points the three access functions at the table
--   4. lets people read their own row, and admins manage everyone else's
--
-- IMPORTANT: the two earlier files define the same access functions with fixed email
-- lists. If you ever re-run either of them, re-run this file afterwards.
-- Safe to run multiple times.

begin;

---------------------------------------------------------------------
-- 1. Members table
---------------------------------------------------------------------
create table if not exists public.altio_reimbursement_members (
  email text primary key,
  name text not null default '',
  role text not null default 'employee' check (role in ('employee', 'admin')),
  zoho_access boolean not null default false,
  added_by text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint altio_reimbursement_members_email_ok
    check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

---------------------------------------------------------------------
-- 2. Everyone who had access before
---------------------------------------------------------------------
insert into public.altio_reimbursement_members (email, role, zoho_access, added_by) values
  ('abilash@craftech360.com',  'admin',    true,  'initial setup'),
  ('abilashs003@gmail.com',    'admin',    true,  'initial setup'),
  ('yamuna@craftech360.com',   'admin',    true,  'initial setup'),
  ('abilash@altio.me',         'admin',    false, 'initial setup'),
  ('pradeep@craftech360.com',  'employee', true,  'initial setup'),
  ('ravi@craftech360.com',     'employee', true,  'initial setup'),
  ('pattar@craftech360.com',   'employee', true,  'initial setup'),
  ('accounts@craftech360.com', 'employee', true,  'initial setup'),
  ('ga@altio.me',                   'employee', false, 'initial setup'),
  ('dilandevaiah30@gmail.com',      'employee', false, 'initial setup'),
  ('prasanjeetpanda06@gmail.com',   'employee', false, 'initial setup'),
  ('kanishka.tulya1367@gmail.com',  'employee', false, 'initial setup'),
  ('gowdamanu1324@gmail.com',       'employee', false, 'initial setup'),
  ('rahul@craftech360.com',         'employee', false, 'initial setup'),
  ('chetan@craftech360.com',        'employee', false, 'initial setup')
on conflict (email) do nothing;

---------------------------------------------------------------------
-- 3. Access functions, now read from the table
--    security definer: they read the members table regardless of its RLS, which is
--    what lets the RLS policies below call them without looping.
---------------------------------------------------------------------
create or replace function public.altio_reimbursement_my_email()
returns text
language sql
stable
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- Zoho export workspace (name kept: the original tables and storage policies use it).
create or replace function public.altio_reimbursement_is_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.altio_reimbursement_members m
    where m.email = public.altio_reimbursement_my_email() and m.zoho_access
  )
$$;

create or replace function public.altio_reimbursement_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.altio_reimbursement_members m
    where m.email = public.altio_reimbursement_my_email() and m.role = 'admin'
  )
$$;

-- Company accounts are employees automatically; anyone else must be added.
create or replace function public.altio_reimbursement_can_request()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.altio_reimbursement_my_email() like '%@craftech360.com'
      or exists (
        select 1 from public.altio_reimbursement_members m
        where m.email = public.altio_reimbursement_my_email()
      )
$$;

revoke all on function public.altio_reimbursement_my_email() from public;
revoke all on function public.altio_reimbursement_is_allowed() from public;
revoke all on function public.altio_reimbursement_is_admin() from public;
revoke all on function public.altio_reimbursement_can_request() from public;
grant execute on function public.altio_reimbursement_my_email() to authenticated;
grant execute on function public.altio_reimbursement_is_allowed() to authenticated;
grant execute on function public.altio_reimbursement_is_admin() to authenticated;
grant execute on function public.altio_reimbursement_can_request() to authenticated;

---------------------------------------------------------------------
-- 4. Guard rails: tidy emails, stamp who changed what, and never let an admin
--    remove or demote themselves (so there is always at least one admin).
---------------------------------------------------------------------
create or replace function public.altio_reimbursement_members_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  me text := public.altio_reimbursement_my_email();
begin
  if tg_op = 'DELETE' then
    if old.email = me then
      raise exception 'You can’t remove yourself. Ask another admin.';
    end if;
    return old;
  end if;

  new.email := lower(btrim(new.email));
  new.name := btrim(coalesce(new.name, ''));
  new.updated_at := now();

  if tg_op = 'INSERT' then
    -- From the app: the signed-in admin. From the SQL editor (no sign-in): keep the given label.
    if me <> '' then new.added_by := me; end if;
    new.added_at := now();
  else
    if new.email <> old.email then
      raise exception 'An email can’t be changed. Remove it and add the new one.';
    end if;
    new.added_by := old.added_by;
    new.added_at := old.added_at;
    if old.email = me and old.role = 'admin' and new.role <> 'admin' then
      raise exception 'You can’t remove your own admin role. Ask another admin.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists altio_reimbursement_members_before_write on public.altio_reimbursement_members;
create trigger altio_reimbursement_members_before_write
before insert or update or delete on public.altio_reimbursement_members
for each row execute function public.altio_reimbursement_members_before_write();

---------------------------------------------------------------------
-- 5. Row-level security
---------------------------------------------------------------------
alter table public.altio_reimbursement_members enable row level security;

drop policy if exists altio_reimbursement_members_read on public.altio_reimbursement_members;
drop policy if exists altio_reimbursement_members_insert on public.altio_reimbursement_members;
drop policy if exists altio_reimbursement_members_update on public.altio_reimbursement_members;
drop policy if exists altio_reimbursement_members_delete on public.altio_reimbursement_members;

-- Everyone can read their own row (the app uses it to know their role); admins read all.
create policy altio_reimbursement_members_read
on public.altio_reimbursement_members
for select
to authenticated
using (email = public.altio_reimbursement_my_email() or public.altio_reimbursement_is_admin());

create policy altio_reimbursement_members_insert
on public.altio_reimbursement_members
for insert
to authenticated
with check (public.altio_reimbursement_is_admin());

create policy altio_reimbursement_members_update
on public.altio_reimbursement_members
for update
to authenticated
using (public.altio_reimbursement_is_admin())
with check (public.altio_reimbursement_is_admin());

create policy altio_reimbursement_members_delete
on public.altio_reimbursement_members
for delete
to authenticated
using (public.altio_reimbursement_is_admin());

grant select, insert, update, delete on public.altio_reimbursement_members to authenticated;

commit;

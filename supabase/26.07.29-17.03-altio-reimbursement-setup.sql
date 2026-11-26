-- Altio Reimbursement — Full Supabase setup
-- Run this once on a fresh Supabase project to create everything the app needs.
--
-- What this creates:
--   1. pgcrypto extension (for gen_random_uuid)
--   2. altio_reimbursement_is_allowed() — access control function (email allowlist)
--   3. altio_reimbursement_exports table + RLS policies
--   4. altio_reimbursement_pending table + indexes + RLS policies
--   5. altio-reimbursement-docs storage bucket + policies
--
-- Safe to run multiple times — uses IF NOT EXISTS / ON CONFLICT / DROP IF EXISTS.

begin;

---------------------------------------------------------------------
-- 1. Extension
---------------------------------------------------------------------
create extension if not exists pgcrypto;

---------------------------------------------------------------------
-- 2. Access-control function (email allowlist)
---------------------------------------------------------------------
create or replace function public.altio_reimbursement_is_allowed()
returns boolean
language sql
stable
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any (array[
    'abilash@craftech360.com',
    'pradeep@craftech360.com',
    'ravi@craftech360.com',
    'pattar@craftech360.com',
    'accounts@craftech360.com',
    'abilashs003@gmail.com',
    'yamuna@craftech360.com'
  ]::text[])
$$;

revoke all on function public.altio_reimbursement_is_allowed() from public;
grant execute on function public.altio_reimbursement_is_allowed() to authenticated;

---------------------------------------------------------------------
-- 3. altio_reimbursement_exports table
---------------------------------------------------------------------
create table if not exists public.altio_reimbursement_exports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  filename text not null,
  row_count integer not null default 0 check (row_count >= 0),
  storage_path text not null unique,
  created_by uuid default auth.uid()
);

alter table public.altio_reimbursement_exports enable row level security;

drop policy if exists altio_reimbursement_exports_read on public.altio_reimbursement_exports;
drop policy if exists altio_reimbursement_exports_write on public.altio_reimbursement_exports;

create policy altio_reimbursement_exports_read
on public.altio_reimbursement_exports
for select
to authenticated
using (public.altio_reimbursement_is_allowed());

create policy altio_reimbursement_exports_write
on public.altio_reimbursement_exports
for all
to authenticated
using (public.altio_reimbursement_is_allowed())
with check (public.altio_reimbursement_is_allowed());

---------------------------------------------------------------------
-- 4. altio_reimbursement_pending table
---------------------------------------------------------------------
create table if not exists public.altio_reimbursement_pending (
  id uuid primary key default gen_random_uuid(),
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  batch_id uuid not null,
  seq integer not null default 0 check (seq >= 0),
  entry_date text not null default '',
  name text not null default '',
  type text not null default '',
  details text not null default '',
  amount numeric(14,2) not null default 0 check (amount >= 0),
  status text not null default '',
  approved_on text not null default '',
  source_file text not null default '',
  dup_key text not null default '',
  project text not null default '',
  account text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create index if not exists altio_reimbursement_pending_month_idx
  on public.altio_reimbursement_pending (month);
create index if not exists altio_reimbursement_pending_batch_idx
  on public.altio_reimbursement_pending (batch_id);
create index if not exists altio_reimbursement_pending_dup_idx
  on public.altio_reimbursement_pending (month, dup_key);

alter table public.altio_reimbursement_pending enable row level security;

drop policy if exists altio_reimbursement_pending_read on public.altio_reimbursement_pending;
drop policy if exists altio_reimbursement_pending_write on public.altio_reimbursement_pending;

create policy altio_reimbursement_pending_read
on public.altio_reimbursement_pending
for select
to authenticated
using (public.altio_reimbursement_is_allowed());

create policy altio_reimbursement_pending_write
on public.altio_reimbursement_pending
for all
to authenticated
using (public.altio_reimbursement_is_allowed())
with check (public.altio_reimbursement_is_allowed());

---------------------------------------------------------------------
-- 5. Grants
---------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.altio_reimbursement_exports to authenticated;
grant select, insert, update, delete on public.altio_reimbursement_pending to authenticated;

---------------------------------------------------------------------
-- 6. Storage bucket: altio-reimbursement-docs
---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('altio-reimbursement-docs', 'altio-reimbursement-docs', false)
on conflict (id) do update set public = false;

drop policy if exists altio_reimbursement_docs_read on storage.objects;
drop policy if exists altio_reimbursement_docs_insert on storage.objects;
drop policy if exists altio_reimbursement_docs_update on storage.objects;
drop policy if exists altio_reimbursement_docs_delete on storage.objects;

create policy altio_reimbursement_docs_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'altio-reimbursement-docs'
  and public.altio_reimbursement_is_allowed()
);

create policy altio_reimbursement_docs_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'altio-reimbursement-docs'
  and public.altio_reimbursement_is_allowed()
);

create policy altio_reimbursement_docs_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'altio-reimbursement-docs'
  and public.altio_reimbursement_is_allowed()
)
with check (
  bucket_id = 'altio-reimbursement-docs'
  and public.altio_reimbursement_is_allowed()
);

create policy altio_reimbursement_docs_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'altio-reimbursement-docs'
  and public.altio_reimbursement_is_allowed()
);

commit;

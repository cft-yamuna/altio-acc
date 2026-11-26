-- Altio Reimbursement — employee requests + admin approval
-- Run this AFTER 26.07.29-17.03-altio-reimbursement-setup.sql, in the same Supabase
-- project the app's VITE_SUPABASE_URL points at.
--
-- What this creates:
--   1. altio_reimbursement_is_admin()      — who can approve / reject (email list)
--   2. altio_reimbursement_can_request()   — who can submit requests (@craftech360.com + both lists)
--   3. altio_reimbursement_requests table   — one row per request, with bill file paths
--   4. triggers that stamp the requester, lock submitted fields and record the reviewer
--   5. RLS: users see only their own requests; admins see all and decide on others' requests
--   6. storage policies for bills under altio-reimbursement-docs/requests/<user id>/
--
-- Keep the admin list identical to ADMIN_EMAILS in src/auth/AuthProvider.tsx.
-- Safe to run multiple times.

begin;

---------------------------------------------------------------------
-- 1. Admins (approve / reject)
---------------------------------------------------------------------
create or replace function public.altio_reimbursement_is_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any (array[
    'abilash@craftech360.com',
    'abilashs003@gmail.com',
    'yamuna@craftech360.com'
  ]::text[])
$$;

revoke all on function public.altio_reimbursement_is_admin() from public;
grant execute on function public.altio_reimbursement_is_admin() to authenticated;

---------------------------------------------------------------------
-- 2. Requesters (any company account, plus everyone on the existing lists)
---------------------------------------------------------------------
create or replace function public.altio_reimbursement_can_request()
returns boolean
language sql
stable
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) like '%@craftech360.com'
      or public.altio_reimbursement_is_allowed()
      or public.altio_reimbursement_is_admin()
$$;

revoke all on function public.altio_reimbursement_can_request() from public;
grant execute on function public.altio_reimbursement_can_request() to authenticated;

---------------------------------------------------------------------
-- 3. Requests table
---------------------------------------------------------------------
create table if not exists public.altio_reimbursement_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null default auth.uid(),
  user_email text not null default '',
  user_name text not null default '',
  expense_date date not null,
  category text not null default '',
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(btrim(reason)) > 0),
  project text not null default '',
  bill_paths text[] not null default '{}' check (cardinality(bill_paths) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '',
  reviewed_by text,
  reviewed_at timestamptz
);

create index if not exists altio_reimbursement_requests_user_idx
  on public.altio_reimbursement_requests (user_id, created_at desc);
create index if not exists altio_reimbursement_requests_status_idx
  on public.altio_reimbursement_requests (status, created_at desc);

---------------------------------------------------------------------
-- 4. Triggers
---------------------------------------------------------------------
-- On submit: the requester is whoever is signed in, never what the browser claims,
-- every request starts pending, and bills must sit in the requester's own folder.
create or replace function public.altio_reimbursement_requests_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  new.user_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  new.created_at := now();
  new.status := 'pending';
  new.review_note := '';
  new.reviewed_by := null;
  new.reviewed_at := null;

  if exists (
    select 1 from unnest(new.bill_paths) as p
    where p not like 'requests/' || auth.uid()::text || '/%'
  ) then
    raise exception 'Bills must be uploaded to your own folder.';
  end if;

  return new;
end;
$$;

-- On review: only the decision can change. Submitted details stay exactly as sent,
-- a rejection needs a reason, and the reviewer + time are recorded automatically.
create or replace function public.altio_reimbursement_requests_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.user_id := old.user_id;
  new.user_email := old.user_email;
  new.user_name := old.user_name;
  new.expense_date := old.expense_date;
  new.category := old.category;
  new.amount := old.amount;
  new.reason := old.reason;
  new.project := old.project;
  new.bill_paths := old.bill_paths;

  new.review_note := btrim(coalesce(new.review_note, ''));

  if new.status = 'rejected' and new.review_note = '' then
    raise exception 'Add a reason before rejecting this request.';
  end if;

  if new.status is distinct from old.status or new.review_note is distinct from old.review_note then
    if new.status = 'pending' then
      new.reviewed_by := null;
      new.reviewed_at := null;
    else
      new.reviewed_by := lower(coalesce(auth.jwt() ->> 'email', ''));
      new.reviewed_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists altio_reimbursement_requests_before_insert on public.altio_reimbursement_requests;
create trigger altio_reimbursement_requests_before_insert
before insert on public.altio_reimbursement_requests
for each row execute function public.altio_reimbursement_requests_before_insert();

drop trigger if exists altio_reimbursement_requests_before_update on public.altio_reimbursement_requests;
create trigger altio_reimbursement_requests_before_update
before update on public.altio_reimbursement_requests
for each row execute function public.altio_reimbursement_requests_before_update();

---------------------------------------------------------------------
-- 5. Row-level security
---------------------------------------------------------------------
alter table public.altio_reimbursement_requests enable row level security;

drop policy if exists altio_reimbursement_requests_read on public.altio_reimbursement_requests;
drop policy if exists altio_reimbursement_requests_insert on public.altio_reimbursement_requests;
drop policy if exists altio_reimbursement_requests_review on public.altio_reimbursement_requests;
drop policy if exists altio_reimbursement_requests_withdraw on public.altio_reimbursement_requests;

-- Users see their own requests; admins see everyone's.
create policy altio_reimbursement_requests_read
on public.altio_reimbursement_requests
for select
to authenticated
using (user_id = auth.uid() or public.altio_reimbursement_is_admin());

create policy altio_reimbursement_requests_insert
on public.altio_reimbursement_requests
for insert
to authenticated
with check (public.altio_reimbursement_can_request() and user_id = auth.uid());

-- Admins decide on other people's requests — never their own.
create policy altio_reimbursement_requests_review
on public.altio_reimbursement_requests
for update
to authenticated
using (public.altio_reimbursement_is_admin() and user_id <> auth.uid())
with check (public.altio_reimbursement_is_admin() and user_id <> auth.uid());

-- A requester can withdraw their own request until it has been decided.
create policy altio_reimbursement_requests_withdraw
on public.altio_reimbursement_requests
for delete
to authenticated
using (user_id = auth.uid() and status = 'pending');

grant select, insert, update, delete on public.altio_reimbursement_requests to authenticated;

---------------------------------------------------------------------
-- 6. Storage: bills under altio-reimbursement-docs/requests/<user id>/
---------------------------------------------------------------------
-- The original bucket policies let the accounts list touch every file in the bucket.
-- Re-create them so they skip the requests/ folder — bills follow the rules below instead.
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
  and (storage.foldername(name))[1] is distinct from 'requests'
  and public.altio_reimbursement_is_allowed()
);

create policy altio_reimbursement_docs_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'altio-reimbursement-docs'
  and (storage.foldername(name))[1] is distinct from 'requests'
  and public.altio_reimbursement_is_allowed()
);

create policy altio_reimbursement_docs_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'altio-reimbursement-docs'
  and (storage.foldername(name))[1] is distinct from 'requests'
  and public.altio_reimbursement_is_allowed()
)
with check (
  bucket_id = 'altio-reimbursement-docs'
  and (storage.foldername(name))[1] is distinct from 'requests'
  and public.altio_reimbursement_is_allowed()
);

create policy altio_reimbursement_docs_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'altio-reimbursement-docs'
  and (storage.foldername(name))[1] is distinct from 'requests'
  and public.altio_reimbursement_is_allowed()
);

drop policy if exists altio_reimbursement_bills_read on storage.objects;
drop policy if exists altio_reimbursement_bills_insert on storage.objects;
drop policy if exists altio_reimbursement_bills_delete on storage.objects;

-- Owners and admins can view bills.
create policy altio_reimbursement_bills_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'altio-reimbursement-docs'
  and (storage.foldername(name))[1] = 'requests'
  and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.altio_reimbursement_is_admin()
  )
);

-- Requesters upload only into their own folder.
create policy altio_reimbursement_bills_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'altio-reimbursement-docs'
  and (storage.foldername(name))[1] = 'requests'
  and (storage.foldername(name))[2] = auth.uid()::text
  and public.altio_reimbursement_can_request()
);

-- Requesters can remove their own bills (used when a request is withdrawn).
create policy altio_reimbursement_bills_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'altio-reimbursement-docs'
  and (storage.foldername(name))[1] = 'requests'
  and (storage.foldername(name))[2] = auth.uid()::text
);

commit;

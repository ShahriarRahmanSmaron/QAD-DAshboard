-- MD11-1: Buyer Account Permission Architecture & Admin Integration
-- Phase 1: Database migration

-- 1.1 Extend user_permissions check constraint to add buyers:access
alter table public.user_permissions drop constraint if exists user_permissions_permission_check;
alter table public.user_permissions
  add constraint user_permissions_permission_check
  check (permission in ('reports:read', 'reports:edit', 'users:manage', 'buyers:access'));

-- 1.2 Create user_buyers table (follows user_units pattern)
create table if not exists public.user_buyers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  buyer_name text not null,
  granted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, buyer_name),
  check (length(trim(buyer_name)) > 0)
);

create index if not exists user_buyers_user_id_idx on public.user_buyers(user_id);
create index if not exists user_buyers_buyer_name_idx on public.user_buyers(buyer_name);

-- 1.3 Row-Level Security for user_buyers
alter table public.user_buyers enable row level security;

-- Users can read their own buyer assignments
drop policy if exists "Users can read own buyer assignments" on public.user_buyers;
create policy "Users can read own buyer assignments"
on public.user_buyers for select
to authenticated
using (user_id = auth.uid());

-- Admins can read all buyer assignments
drop policy if exists "Admins can read buyer assignments" on public.user_buyers;
create policy "Admins can read buyer assignments"
on public.user_buyers for select
to authenticated
using (
  exists (
    select 1 from public.users u
    join public.roles r on r.id = u.role_id
    where u.id = auth.uid() and u.is_active = true and r.name = 'admin'
  )
);

create table if not exists public.roles (
  id smallint generated always as identity primary key,
  name text not null unique check (name in ('admin', 'editor', 'viewer')),
  description text not null,
  created_at timestamptz not null default now()
);

insert into public.roles (name, description)
values
  ('admin', 'Full access across the QAD portal.'),
  ('editor', 'Can edit reports explicitly assigned to the user.'),
  ('viewer', 'Read-only portal access.')
on conflict (name) do update
set description = excluded.description;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role_id smallint not null references public.roles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_role_id_idx on public.users(role_id);
create index if not exists users_is_active_idx on public.users(is_active);

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  permission text not null check (permission in ('reports:read', 'reports:edit', 'users:manage')),
  resource_type text,
  resource_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, permission, resource_type, resource_id),
  check (
    permission <> 'reports:edit'
    or (resource_type = 'report' and resource_id is not null)
  )
);

create index if not exists user_permissions_user_id_idx on public.user_permissions(user_id);
create index if not exists user_permissions_resource_idx
  on public.user_permissions(resource_type, resource_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

alter table public.roles enable row level security;
alter table public.users enable row level security;
alter table public.user_permissions enable row level security;

drop policy if exists "Authenticated users can read roles" on public.roles;
create policy "Authenticated users can read roles"
on public.roles for select
to authenticated
using (true);

drop policy if exists "Users can read own profile" on public.users;
create policy "Users can read own profile"
on public.users for select
to authenticated
using (id = auth.uid());

drop policy if exists "Users can read own permissions" on public.user_permissions;
create policy "Users can read own permissions"
on public.user_permissions for select
to authenticated
using (user_id = auth.uid());

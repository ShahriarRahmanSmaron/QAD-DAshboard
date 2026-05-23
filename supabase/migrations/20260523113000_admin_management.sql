create table if not exists public.user_units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  unit_name text not null,
  granted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, unit_name),
  check (length(trim(unit_name)) > 0)
);

alter table public.user_units
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid references public.users(id) on delete cascade,
  add column if not exists unit_name text,
  add column if not exists granted_by uuid references public.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_units_user_id_unit_name_key'
      and conrelid = 'public.user_units'::regclass
  ) then
    alter table public.user_units
      add constraint user_units_user_id_unit_name_key unique (user_id, unit_name);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_units_unit_name_not_blank'
      and conrelid = 'public.user_units'::regclass
  ) then
    alter table public.user_units
      add constraint user_units_unit_name_not_blank
      check (unit_name is null or length(trim(unit_name)) > 0);
  end if;
end;
$$;

create index if not exists user_units_user_id_idx on public.user_units(user_id);
create index if not exists user_units_unit_name_idx on public.user_units(unit_name);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (length(trim(action)) > 0),
  check (length(trim(target_type)) > 0)
);

alter table public.audit_logs
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists actor_id uuid references public.users(id) on delete set null,
  add column if not exists actor_user_id uuid references public.users(id) on delete set null,
  add column if not exists action text,
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists target_type text,
  add column if not exists target_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'audit_logs_action_not_blank'
      and conrelid = 'public.audit_logs'::regclass
  ) then
    alter table public.audit_logs
      add constraint audit_logs_action_not_blank
      check (action is null or length(trim(action)) > 0);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'audit_logs_target_type_not_blank'
      and conrelid = 'public.audit_logs'::regclass
  ) then
    alter table public.audit_logs
      add constraint audit_logs_target_type_not_blank
      check (target_type is null or length(trim(target_type)) > 0);
  end if;
end;
$$;

create index if not exists audit_logs_actor_user_id_idx on public.audit_logs(actor_user_id);
create index if not exists audit_logs_actor_id_idx on public.audit_logs(actor_id);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);
create index if not exists audit_logs_target_idx on public.audit_logs(target_type, target_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);

alter table public.user_units enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "Users can read own unit permissions" on public.user_units;
create policy "Users can read own unit permissions"
on public.user_units for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Admins can read unit permissions" on public.user_units;
create policy "Admins can read unit permissions"
on public.user_units for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    join public.roles r on r.id = u.role_id
    where u.id = auth.uid()
      and u.is_active = true
      and r.name = 'admin'
  )
);

drop policy if exists "Admins can read audit logs" on public.audit_logs;
create policy "Admins can read audit logs"
on public.audit_logs for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    join public.roles r on r.id = u.role_id
    where u.id = auth.uid()
      and u.is_active = true
      and r.name = 'admin'
  )
);

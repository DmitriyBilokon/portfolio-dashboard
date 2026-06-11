-- Роли, доступ к вкладкам и онлайн-статус пользователей.
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить всё → Run.
--
-- Логика:
--  • dmitriy.bilokon@gmail.com — админ (видит всё, управляет доступом);
--  • новые аккаунты получают роль user и только вкладку Nasdaq 100;
--  • last_seen обновляется heartbeat-ом каждую минуту, пока сайт открыт.

create table if not exists public.user_access (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  email     text,
  role      text not null default 'user',                  -- 'admin' | 'user'
  tabs      jsonb not null default '["Nasdaq 100"]'::jsonb, -- вкладки, доступные user-у
  last_seen timestamptz default now()
);

alter table public.user_access enable row level security;

-- Проверка «я админ» через security definer — иначе политика на user_access,
-- читающая user_access, зацикливается.
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as
$$ select exists(select 1 from user_access where user_id = auth.uid() and role = 'admin') $$;

drop policy if exists ua_select on public.user_access;
create policy ua_select on public.user_access for select
  using (auth.uid() = user_id or public.is_admin());

-- Менять чужие строки (выдавать вкладки) может только админ.
drop policy if exists ua_update_admin on public.user_access;
create policy ua_update_admin on public.user_access for update
  using (public.is_admin());

-- Своя строка создаётся/обновляется только этими функциями.
-- Email берётся из JWT — подделать его клиент не может.
create or replace function public.ensure_access() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_admin boolean := v_email = 'dmitriy.bilokon@gmail.com';
  r user_access;
begin
  if auth.uid() is null then return null; end if;
  insert into user_access(user_id, email, role, tabs, last_seen)
  values (auth.uid(), v_email,
          case when v_admin then 'admin' else 'user' end,
          case when v_admin then '[]'::jsonb else '["Nasdaq 100"]'::jsonb end,
          now())
  on conflict (user_id) do update
    set email = excluded.email,
        role  = case when v_admin then 'admin' else user_access.role end,
        last_seen = now()
  returning * into r;
  return jsonb_build_object('role', r.role, 'tabs', r.tabs);
end $$;

create or replace function public.heartbeat() returns void
language sql security definer set search_path = public as
$$ update user_access set last_seen = now() where user_id = auth.uid() $$;

grant execute on function public.ensure_access() to authenticated;
grant execute on function public.heartbeat() to authenticated;
revoke execute on function public.ensure_access() from anon;
revoke execute on function public.heartbeat() from anon;

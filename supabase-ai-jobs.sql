-- Фоновые AI-задачи (анализ портфеля 🔮 и AI-Dashboard).
-- Воркер пишет результат service-ролью (обходит RLS); клиент читает только свои строки
-- и опрашивает их до status='done'/'error'. Выполнить один раз в Supabase → SQL Editor.

create table if not exists public.ai_jobs (
  job_id     uuid primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text,                       -- 'ai' | 'dashboard'
  key        text,                       -- ключ вкладки/портфеля
  status     text,                       -- 'running' | 'done' | 'error'
  result     jsonb,                      -- {text,proposal,cost} или {dash,cost}
  error      text,
  updated_at timestamptz default now()
);

create index if not exists ai_jobs_user_idx on public.ai_jobs (user_id, updated_at desc);

alter table public.ai_jobs enable row level security;

-- Клиент видит и опрашивает только свои задачи.
drop policy if exists "ai_jobs own select" on public.ai_jobs;
create policy "ai_jobs own select" on public.ai_jobs
  for select using (auth.uid() = user_id);

-- Воркер пишет service_role-ключом, который обходит RLS — отдельные insert/update
-- политики не нужны. Записи клиенту менять нельзя (политик на запись нет).

-- (необязательно) автоудаление старых задач: запускать вручную или из крона.
-- delete from public.ai_jobs where updated_at < now() - interval '7 days';

-- Несгораемое хранилище AI-портфеля (резерв worker'а).
-- Выполнить один раз: Supabase → SQL Editor → New query → вставить → Run.
--
-- Клиенты сайта пишут только в ledger_state и могут затереть aiPort своей
-- отставшей копией. Эта таблица доступна ТОЛЬКО сервисному ключу worker'а
-- (RLS включён, политик нет) — затереть её с сайта невозможно.

create table if not exists public.ai_state (
  user_id    uuid primary key,
  port       jsonb,
  updated_at timestamptz default now()
);

alter table public.ai_state enable row level security;
-- Политик нет намеренно: anon/authenticated не имеют доступа,
-- service_role (worker) обходит RLS.

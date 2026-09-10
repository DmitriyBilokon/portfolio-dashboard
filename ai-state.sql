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

-- S8 (2026-09-10): состояние дедупа bookcheck — какие стопы/цели/лимиты уже отправлены
-- в Telegram (гистерезис 0.3·ATR). Без этой колонки bookcheck НЕ шлёт уведомления
-- (иначе повторял бы их каждые 20 минут). Можно выполнить отдельно — идемпотентно.
alter table public.ai_state add column if not exists book jsonb;

-- 2026-09-10: дедуп ошибок анализа портфелей в Telegram — одна и та же ошибка
-- (например, закончились кредиты Anthropic) не чаще раза в 12 ч. Без колонки worker
-- шлёт ошибку каждый час, как раньше. Идемпотентно.
alter table public.ai_state add column if not exists alerts jsonb;

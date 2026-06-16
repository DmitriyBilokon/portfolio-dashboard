-- 🔐 RBAC: функциональный слой прав поверх существующей таблицы user_access.
-- Добавляет роль (role_id) и точечные переопределения пермишенов (overrides).
-- Выполнить ОДИН раз: Supabase → SQL Editor → New query → вставить → Run.
--
-- Существующие колонки user_access (из supabase-access.sql): user_id, email,
-- role ('admin'|'user'), tabs (массив доступных портфелей/вкладок), last_seen.
-- Этот скрипт НЕ трогает их — только добавляет два новых поля.

alter table public.user_access
  add column if not exists role_id text;                       -- owner|editor|analyst|viewer|custom (для role='user')

alter table public.user_access
  add column if not exists overrides jsonb not null default '{}'::jsonb;  -- {"perm.key":"allow|deny"}

-- Дефолт для уже существующих не-админов: editor (≈ текущее поведение сайта).
update public.user_access set role_id = 'editor'
  where role <> 'admin' and (role_id is null or role_id = '');

-- ── Примечания ────────────────────────────────────────────────────────────────
-- • Клиент читает role_id/overrides напрямую (select), отдельный RPC не требуется.
-- • Приоритет прав (deny-by-default): явный override → роль → закрыто.
-- • RLS из supabase-access.sql продолжает действовать: пользователь читает свою
--   строку, админ управляет всеми. Новые колонки наследуют те же политики.
-- • ВАЖНО (раздел 7 ТЗ): скрытие на фронте — это UX, не безопасность. Серверная
--   проверка прав для платных AI-экшенов (action.run_ai/chat_ai) и аудит —
--   отдельная фаза в воркере (requirePermission поверх requireAdmin).

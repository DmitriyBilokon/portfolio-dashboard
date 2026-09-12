-- 🧠 AI-отчёты вне ledger (блок E5, plans/ai-reports-e5.md §3): разборы AI Proto по вкладкам, авто-анализ портфелей
-- воркером и AI-разборы акций — одна запись = одна строка, запись КАК ЕСТЬ в data. Раньше жили в JSON-блобе
-- ledger_state (data.<tab>.aiHistory / analysis / analysisHistory и stockAiLog) и раздували его до лимита realtime.
-- Выполнить: Supabase → SQL Editor → New query → вставить → Run. Идемпотентен — повторный запуск безопасен.
-- Порядок E5a: бэкап `create table backup.ledger_state_e5 as table public.ledger_state;` → этот файл → push клиента.

create table if not exists public.ai_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('proto', 'pfa', 'stock')),   -- AI Proto · авто-анализ воркера · разбор акции
  key        text not null check (length(key) between 1 and 200),       -- ключ вкладки (proto/pfa) или ТИКЕР в верхнем регистре (stock)
  at         timestamptz not null,                                      -- = data.at (proto/pfa) / data.ts (stock)
  meta       jsonb,                                                     -- считает триггер ai_reports_bi, клиент не пишет
  data       jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 262144),
  created_at timestamptz not null default now(),
  unique (user_id, kind, key, at)                                       -- дедуп повторного переноса/повтора записи; его индекс
);                                                                      -- служит и списку/обрезке (btree читается в обе стороны)

alter table public.ai_reports enable row level security;
-- Свои строки: чтение, вставка, удаление. UPDATE-политики нет — строки с клиента неизменяемы. Воркер — service_role (мимо RLS).
drop policy if exists ai_reports_own_select on public.ai_reports;
create policy ai_reports_own_select on public.ai_reports for select to authenticated using (auth.uid() = user_id);
drop policy if exists ai_reports_own_insert on public.ai_reports;
create policy ai_reports_own_insert on public.ai_reports for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists ai_reports_own_delete on public.ai_reports;
create policy ai_reports_own_delete on public.ai_reports for delete to authenticated using (auth.uid() = user_id);
revoke all on public.ai_reports from anon, authenticated;   -- без update/truncate (truncate RLS не проверяет)
grant select, insert, delete on public.ai_reports to authenticated;

-- meta — всё, что нужно синхронным читателям клиента, без больших текстов (одна реализация на клиента, воркер и перенос).
-- Клиент повторяет её формулы в aiProtoSummary/aiProtoActs (тест сверяет на фикстуре).
create or replace function public.ai_reports_meta(p_kind text, p_data jsonb) returns jsonb
language sql immutable as $$
  select case p_kind
    when 'stock' then p_data - 'text'
    when 'proto' then (p_data - 'text' - 'proposal') || jsonb_build_object(
      'summary', left(coalesce(nullif(p_data->'proposal'->>'summary', ''), p_data->>'text', ''), 1200),
      'nAct', case when jsonb_typeof(p_data->'proposal'->'actions')   = 'array' then jsonb_array_length(p_data->'proposal'->'actions')   else 0 end,
      'nWl',  case when jsonb_typeof(p_data->'proposal'->'watchlist') = 'array' then jsonb_array_length(p_data->'proposal'->'watchlist') else 0 end)
    when 'pfa' then (p_data - 'report' - 'actions') || jsonb_build_object(
      'nAct', case when jsonb_typeof(p_data->'actions') = 'array' then jsonb_array_length(p_data->'actions') else 0 end)
  end $$;
-- Глубина истории — как была в ledger: AI Proto 10 на вкладку, авто-анализ 5 на портфель, разборы акций 300 всего.
create or replace function public.ai_reports_keep(p_kind text) returns int
language sql immutable as $$ select case p_kind when 'proto' then 10 when 'pfa' then 5 when 'stock' then 300 else 50 end $$;

create or replace function public.ai_reports_bi() returns trigger language plpgsql as $$
begin NEW.meta := public.ai_reports_meta(NEW.kind, NEW.data); return NEW; end $$;
drop trigger if exists ai_reports_bi on public.ai_reports;
create trigger ai_reports_bi before insert or update on public.ai_reports for each row execute function public.ai_reports_bi();

-- Лимит истории: proto/pfa — на (пользователь, вид, вкладка), stock — на (пользователь, вид). Удаление идёт от имени
-- вставляющего (RLS «свои» / service_role) — security definer не нужен. Клиент узнаёт об обрезке по DELETE-событиям realtime.
create or replace function public.ai_reports_prune() returns trigger language plpgsql as $$
begin
  delete from public.ai_reports r
  where r.user_id = NEW.user_id and r.kind = NEW.kind and (NEW.kind = 'stock' or r.key = NEW.key)
    and r.id not in (select x.id from public.ai_reports x
                     where x.user_id = NEW.user_id and x.kind = NEW.kind and (NEW.kind = 'stock' or x.key = NEW.key)
                     order by x.at desc limit public.ai_reports_keep(NEW.kind));
  return null;
end $$;
drop trigger if exists ai_reports_prune on public.ai_reports;
create trigger ai_reports_prune after insert on public.ai_reports for each row execute function public.ai_reports_prune();

-- Realtime: клиент подписан на свои строки (INSERT — новая запись, DELETE — удаление/обрезка).
do $$ begin alter publication supabase_realtime add table public.ai_reports;
exception when duplicate_object then null; end $$;
notify pgrst, 'reload schema';   -- PostgREST сразу видит таблицу (иначе клиент получит PGRST205 до перезагрузки кэша)

-- ── Примечания ────────────────────────────────────────────────────────────────
-- • Клиент (app.js, слой AI_REP): при входе читает id/kind/key/at/meta своих строк, полный data — лениво при входе
--   в раздел; новая запись — aiRepPut (upsert on_conflict=user_id,kind,key,at, ignore-duplicates).
-- • Перенос из ledger делает клиент (aiRepSweep): удаляет запись из ledger только после подтверждённой вставки сюда.
-- • Воркер (E5b) пишет авто-анализ (kind 'pfa') service-ключом сразу сюда.
-- • Проверка после запуска: select public.ai_reports_meta('proto','{"text":"x","proposal":{"summary":"s","actions":[1]}}');
--   → {"nAct": 1, "nWl": 0, "summary": "s"}

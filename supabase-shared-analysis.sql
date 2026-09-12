-- 🌐 Общая аналитика: оценка (VAL), инсайдеры (INSIDER), AI-Рекомендация (AI_RECO), аналит. таргеты (TG_FULL).
-- Эти данные привязаны к ТИКЕРАМ, а не к пользователю, поэтому хранятся в общей
-- строке. Админ собирает (кнопки «📐 Оценка» / «🕵 AI Insider» / «🔄 AI-Рекомендация»)
-- → пишет сюда; все аутентифицированные пользователи читают и видят то же самое.
-- Выполнить: Supabase → SQL Editor → New query → вставить → Run. Идемпотентен — повторный запуск безопасен (E1 добавил RPC).

create table if not exists public.shared_analysis (
  id         text primary key default 'global',
  val        jsonb not null default '{}'::jsonb,   -- VAL[tk]    — мультипликаторы
  insider    jsonb not null default '{}'::jsonb,   -- INSIDER[tk] — инсайдерские сделки
  aireco     jsonb not null default '{}'::jsonb,   -- AI_RECO[tk] — AI-рекомендации
  targets    jsonb not null default '{}'::jsonb,   -- TG_FULL[tk] — агрегированные аналит. таргеты (A.1)
  updated_at timestamptz default now()
);
-- Если таблица уже была создана ранее без колонки targets:
alter table public.shared_analysis add column if not exists targets jsonb not null default '{}'::jsonb;

insert into public.shared_analysis (id) values ('global') on conflict (id) do nothing;

alter table public.shared_analysis enable row level security;

-- Чтение — любому вошедшему пользователю.
drop policy if exists shared_analysis_read on public.shared_analysis;
create policy shared_analysis_read on public.shared_analysis
  for select to authenticated using (true);

-- Запись — только администраторам (user_access.role = 'admin').
drop policy if exists shared_analysis_write on public.shared_analysis;
create policy shared_analysis_write on public.shared_analysis
  for all to authenticated
  using      (exists (select 1 from public.user_access ua where ua.user_id = auth.uid() and ua.role = 'admin'))
  with check (exists (select 1 from public.user_access ua where ua.user_id = auth.uid() and ua.role = 'admin'));

-- Realtime: чтобы пользователи видели обновление сразу (клиент подписан на изменения).
-- В DO-блоке, чтобы повторный запуск не падал с «already member of publication».
do $$ begin
  alter publication supabase_realtime add table public.shared_analysis;
exception when duplicate_object then null;
end $$;

-- ── Точечная запись: патч по тикерам (блок E1, plans/ledger-model-e.md) ─────────
-- shared_analysis_patch('val'|'insider'|'aireco'|'targets', {"TK": {…}, …}) — сливает патч в колонку
-- на сервере (колонка || патч: тикеры патча заменяются целиком, остальные не трогаются). Раньше клиент
-- upsert'ил всю строку из памяти — два устройства админа затирали друг другу собранное (last-writer-wins).
-- UPDATE берёт блокировку строки, поэтому одновременные патчи (в т.ч. разных колонок) не теряются.
-- security definer: RLS обходится, поэтому админа проверяем сами. Удалений тикеров нет (их не бывает).
-- Идемпотентно — можно запускать повторно (весь файл тоже).
create or replace function public.shared_analysis_patch(p_col text, p_patch jsonb)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_at timestamptz := now();
begin
  if auth.uid() is null or not exists (select 1 from user_access ua where ua.user_id = auth.uid() and ua.role = 'admin') then
    raise exception 'shared_analysis_patch: admin only' using errcode = '42501';
  end if;
  if p_col is null or p_col not in ('val', 'insider', 'aireco', 'targets') then
    raise exception 'shared_analysis_patch: bad column %', p_col using errcode = '22023';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'shared_analysis_patch: patch must be a json object' using errcode = '22023';
  end if;
  insert into shared_analysis (id) values ('global') on conflict (id) do nothing;
  execute format('update shared_analysis set %1$I = coalesce(%1$I, ''{}''::jsonb) || $1, updated_at = $2 where id = ''global''', p_col)
    using p_patch, v_at;
  return v_at;
end $$;
revoke all on function public.shared_analysis_patch(text, jsonb) from public, anon;
grant execute on function public.shared_analysis_patch(text, jsonb) to authenticated;
notify pgrst, 'reload schema';   -- PostgREST сразу видит новую функцию (иначе клиент получит PGRST202 до перезагрузки кэша)

-- ── Примечания ────────────────────────────────────────────────────────────────
-- • Эти данные живут ТОЛЬКО здесь (с E1): личный ledger_state их не хранит (ключи val/insider/aiReco/tgFull/
--   tgMeta в снапшоте клиента до E1 новым клиентом игнорируются).
-- • Клиент: при загрузке читает строку 'global' и заполняет VAL/INSIDER/AI_RECO/TG_FULL
--   (перекрывая только непустыми колонками) и перерисовывает, плюс подписка на изменения (живое обновление).
-- • Запись — после сбора админом, только патчем изменённых тикеров (sharedSave/sharedPatch в app.js → RPC выше).
--   Пока функции нет (файл не перезапущен), клиент пишет одну колонку целиком (upsert), не всю строку.
-- • Если уже добавляли таблицу в supabase_realtime — последняя строка может дать
--   ошибку «already member»; это безопасно игнорировать.

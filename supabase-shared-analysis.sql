-- 🌐 Общая аналитика: оценка (VAL), инсайдеры (INSIDER), AI-Рекомендация (AI_RECO).
-- Эти данные привязаны к ТИКЕРАМ, а не к пользователю, поэтому хранятся в общей
-- строке. Админ собирает (кнопки «📐 Оценка» / «🕵 AI Insider» / «🔄 AI-Рекомендация»)
-- → пишет сюда; все аутентифицированные пользователи читают и видят то же самое.
-- Выполнить ОДИН раз: Supabase → SQL Editor → New query → вставить → Run.

create table if not exists public.shared_analysis (
  id         text primary key default 'global',
  val        jsonb not null default '{}'::jsonb,   -- VAL[tk]   — мультипликаторы
  insider    jsonb not null default '{}'::jsonb,   -- INSIDER[tk] — инсайдерские сделки
  aireco     jsonb not null default '{}'::jsonb,   -- AI_RECO[tk] — AI-рекомендации
  updated_at timestamptz default now()
);

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
alter publication supabase_realtime add table public.shared_analysis;

-- ── Примечания ────────────────────────────────────────────────────────────────
-- • Клиент: при загрузке читает строку 'global' и заполняет VAL/INSIDER/AI_RECO
--   (перекрывая персональные пустые), плюс подписка на изменения (живое обновление).
-- • Запись идёт автоматически после сбора админом (pushSharedAnalysis).
-- • Если уже добавляли таблицу в supabase_realtime — последняя строка может дать
--   ошибку «already member»; это безопасно игнорировать.

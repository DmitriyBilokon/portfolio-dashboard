# План: E5 — AI-отчёты вне ledger (таблица `ai_reports`)

Статус: **Planning завершён** (2026-09-12, Opus 5 · high; решения пользователя — §2). **E5a — код сделан 2026-09-12** (итоги §13: стенд 589,6 → 245,0 КБ, I5 ✔; ждёт SQL, push и живой проверки пользователя). Родительский план — `plans/ledger-model-e.md` (правила R1–R6, стенд копии ledger, бэкапы в схеме `backup`). Код — в двух сессиях Implementation (§11), по одной на шаг; коммит в конце сессии после зелёных `bash tests/run.sh`, push — по просьбе.

**Главная идея.** AI-отчёты (разборы AI Proto по вкладкам, авто-анализ портфелей воркером, AI-разборы акций) переезжают из JSON-блоба ledger в отдельную таблицу `ai_reports`: одна запись = одна строка, запись **как есть** в `data`; лёгкая выжимка `meta` (её считает триггер БД) грузится при входе и кормит все синхронные читатели; полный текст — лениво, при входе в раздел. Перенос из ledger делает сам клиент (`aiRepSweep`), причём **удаляет запись из ledger только после подтверждённой вставки** в таблицу — данные не теряются ни при каком обрыве. Воркер пишет авто-анализ сразу в таблицу и перестаёт ежечасно переписывать ledger.

---

## 1. Факты (2026-09-12, копия владельца `~/dash-ledger-copies/owner-2026-09-12.json`, компактный JSON)

| Данные | Размер / записей | Писатели | Синхронные читатели | Полный текст нужен |
|---|---|---|---|---|
| `DATA[tab].aiHistory` (+ устаревший `aiReport`) — AI Proto | **244 КБ / 19** (🚀 10, Anna 5, Sergei 3, Quantum 1); запись ≈ 13 КБ: `text` 65 %, `proposal` 35 %; лимит 10 на вкладку, любая вкладка | `pf3AiRun` app.js:1990–1995 (кнопка 🔮, клиент) | `pf3AiHist` app.js:1909 → `pf3AiHTML` :2433 (текст последнего + история в `<details>`), `pf3PropHTML` :2487 (`proposal`), `planImportFromAi` app-5.js:394 (`proposal`, по клику), `hasProp` app-5.js:542 (есть ли `proposal.actions`), `marketContext` app.js:1899 (`proposal.summary` или `text[0..1200]` индексных вкладок — в **каждый** снапшот AI и чата) | экраны AI Proto / Предложение |
| `DATA[tab].analysis` — авто-анализ | 11,5 КБ / 2 | воркер `analyzeOnePortfolio` telegram-notify.js:2221 (cron :20 PF3, :40 Anna; `?action=pfanalyze`) через `writeChecked` (весь ledger) | `pf3AnalysisHTML` app.js:2520 | раздел «📈 Анализ» |
| `DATA[tab].analysisHistory` | 61 КБ / 10 (лимит 5) | воркер :2222 | **нет** | — |
| `DATA[tab].pfAnalysisAt` | число | воркер :2223 | гейт воркера :2203 | — |
| `stockAiLog` = `STOCK_AI_LOG` — AI-разборы акций | 27,6 КБ / **3** (`text` 96 %); **лимит 300 ≈ 2,7 МБ** | `stockAiRun` app.js:2088, `stkDelete` :2258 | `aiTrackRecord` :673 (первые 80: ticker/price/verdict/ts/ccy), `stockAiSnapshot` prior :2025 (ts/price/`data.verdict`/`data.targetPrice`), `stkLogHTML` :2264 (список; текст по раскрытию), `stockAiHTML` :2304 (последний разбор тикера целиком) | по раскрытию, карточка |
| `aiChat` | 7 КБ / 4 (лимит 40) | чат | анализы, чат | **остаётся в ledger** (решение §2) |

- Всего AI ≈ **344 КБ** из 661 КБ ledger после E1. После E5 (+E3) ledger ≈ **250 КБ** (без E3 — ≈ 317 КБ).
- Последние записи: AI Proto — июнь 2026, разборы акций — 14.06, авто-анализ — 06.08 (затем кончились кредиты Anthropic). Когда кредиты вернутся, воркер снова будет **ежечасно дважды** переписывать ledger целиком (≈ 0,7 МБ PATCH + rev-скачок → realtime/сигнал на всех клиентах и риск rev-конфликта правки до E4). E5 это убирает.
- Воркер прошлые отчёты в промпты **не передаёт** (grep: `aiHistory`/`stockAiLog` не читаются; `analysis*` только пишутся) — для воркера меняется лишь место записи и гейт.
- Сид `data.js` AI-полей не содержит; локальный бэкап `dash_bak_<id>` (app.js:203) их не хранит.
- Postgres Changes: у RLS-таблицы DELETE-событие приходит **только с первичным ключом** и не фильтруется по `user_id` (RLS к удалённой строке не применить) — клиент игнорирует незнакомые `id`.
- PostgREST отдаёт `timestamptz` как `2026-06-14T12:41:22.714+00:00`, клиент пишет `…714Z` → сравнивать метки времени **только в миллисекундах** (`Date.parse`).

## 2. Решения пользователя (2026-09-12)

- **Подход:** отдельная таблица `ai_reports` (не урезание лимитов в ledger).
- **Глубина истории — как сейчас:** AI Proto — 10 на вкладку, авто-анализ — 5 на портфель, разборы акций — 300 всего. Поведение UI не меняется; лимиты — одна SQL-функция `ai_reports_keep`.
- **Чат** (`aiChat`) — остаётся в ledger (≤ 40 сообщений, читается синхронно).

**Не делаем:** историю авто-анализов в UI (пишем 5, как сейчас, но не показываем), перенос `aiChat`/`aiSpend`/`aiPlaybook`/`aiPort` (малы, читаются воркером или синхронно), перевод промптов на шкалу SIG (отдельная задача), серверный массовый перенос SQL-скриптом (переносит клиент — одна реализация, проверяемая стендом; SQL только сверяет, §8).

## 3. Модель данных — `supabase-ai-reports.sql` (новый файл, идемпотентный)

```sql
create table if not exists public.ai_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('proto','pfa','stock')),   -- AI Proto · авто-анализ воркера · разбор акции
  key        text not null check (length(key) between 1 and 200),     -- ключ вкладки (proto/pfa) или ТИКЕР в верхнем регистре (stock)
  at         timestamptz not null,                                    -- = data.at (proto/pfa) / data.ts (stock)
  meta       jsonb,                                                   -- считает триггер, клиент не пишет
  data       jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 262144),
  created_at timestamptz not null default now(),
  unique (user_id, kind, key, at)                                     -- дедуп повторного переноса/повтора записи
);
create index if not exists ai_reports_list_idx on public.ai_reports (user_id, kind, key, at desc);

alter table public.ai_reports enable row level security;
-- свои строки: чтение, вставка, удаление; UPDATE-политики нет — строки с клиента неизменяемы. Воркер — service_role (мимо RLS).
drop policy if exists ai_reports_own_select on public.ai_reports;
create policy ai_reports_own_select on public.ai_reports for select to authenticated using (auth.uid() = user_id);
drop policy if exists ai_reports_own_insert on public.ai_reports;
create policy ai_reports_own_insert on public.ai_reports for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists ai_reports_own_delete on public.ai_reports;
create policy ai_reports_own_delete on public.ai_reports for delete to authenticated using (auth.uid() = user_id);

-- meta — всё, что нужно синхронным читателям, без больших текстов (одна реализация на клиента, воркер и перенос)
create or replace function public.ai_reports_meta(p_kind text, p_data jsonb) returns jsonb
language sql stable as $$
  select case p_kind
    when 'stock' then p_data - 'text'
    when 'proto' then (p_data - 'text' - 'proposal') || jsonb_build_object(
      'summary', left(coalesce(nullif(p_data->'proposal'->>'summary',''), p_data->>'text', ''), 1200),
      'nAct', case when jsonb_typeof(p_data->'proposal'->'actions')   = 'array' then jsonb_array_length(p_data->'proposal'->'actions')   else 0 end,
      'nWl',  case when jsonb_typeof(p_data->'proposal'->'watchlist') = 'array' then jsonb_array_length(p_data->'proposal'->'watchlist') else 0 end)
    when 'pfa' then (p_data - 'report' - 'actions') || jsonb_build_object(
      'nAct', case when jsonb_typeof(p_data->'actions') = 'array' then jsonb_array_length(p_data->'actions') else 0 end)
  end $$;
create or replace function public.ai_reports_keep(p_kind text) returns int
language sql immutable as $$ select case p_kind when 'proto' then 10 when 'pfa' then 5 when 'stock' then 300 else 50 end $$;

create or replace function public.ai_reports_bi() returns trigger language plpgsql as $$
begin NEW.meta := public.ai_reports_meta(NEW.kind, NEW.data); return NEW; end $$;
drop trigger if exists ai_reports_bi on public.ai_reports;
create trigger ai_reports_bi before insert or update on public.ai_reports for each row execute function public.ai_reports_bi();

-- лимит истории: proto/pfa — на (пользователь, вид, вкладка), stock — на (пользователь, вид)
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

do $$ begin alter publication supabase_realtime add table public.ai_reports;
exception when duplicate_object then null; end $$;
notify pgrst, 'reload schema';
```
- Удаление обрезкой идёт от имени вставляющего (RLS «свои» / service_role) — `security definer` не нужен.
- `on conflict do nothing` (PostgREST `resolution=ignore-duplicates` + `on_conflict=user_id,kind,key,at`): BEFORE-триггер отрабатывает, AFTER — нет, дубль ничего не меняет.
- **Проверить на PGlite в E5a** (как SQL E1: `npm i @electric-sql/pglite` в scratchpad, заглушка `auth.uid()` через `current_setting`): meta трёх видов, обрезка (в т.ч. общий лимит `stock`), дубль игнорируется, лимит размера `data`, RLS чужой строки.

## 4. Клиент (сессия E5a)

### 4.1 Слой `AI_REP` (app.js, новый блок «AI-отчёты (E5)» рядом с `shared analysis`)

Память: `AI_REP = {uid, rows:[], ready:false}`; строка `{id, kind, key, at, meta, data|null}`. Глобал `STOCK_AI_LOG` и запись в `DATA[tab].aiHistory` исчезают; `AI_LEGACY_STOCK` — ещё не перенесённые записи старого `stockAiLog` (переходный буфер).

**Чистые функции (тесты JSC):**
- `aiRowKey(kind, key, at)` → `kind|key|ms` (`Date.parse`; нет даты → `null`).
- `aiLedgerExtract(snap)` → `{rows:[{kind,key,at,data}], bad}`: по каждой вкладке `aiHistory[]` (нет — `aiReport`) → `proto`; `analysisHistory[] ∪ analysis` (дедуп по `at`) → `pfa`; `snap.stockAiLog[]` → `stock` (`key` = `ticker.trim().toUpperCase()`, `at` = `ts`). `data` — запись **как есть** (не копия-выжимка). Записи без разбираемой даты — в `bad` (не переносятся и не удаляются; стенд печатает их число).
- `aiLedgerStrip(DATA, legacyStock, doneKeys)` → убирает только подтверждённые записи (`doneKeys` — множество `aiRowKey`), пустой массив/поле удаляет, `analysis` — если его `at` подтверждён; возвращает `{changed, stock}` (остаток буфера). Идемпотентна.
- `aiRepMerge(rows, incoming)` — дедуп по `aiRowKey`, `data` сохраняется, если есть у любой стороны; `id`/`meta` — из БД.
- `aiRepList(rows, kind, key)` — новые первыми (`key==null` → весь вид).
- `aiEntry(row)` → запись в прежнем виде: `data`, если загружено; иначе `{...meta, at|ts, _partial:true}` (`stock` — поле `ts`, как у `STOCK_AI_LOG`). Читатели работают с прежней формой.
- `aiProtoSummary(e)` (= `meta.summary` или `(proposal.summary)||text[0..1200]` — как marketContext сейчас), `aiProtoActs(e)` (= `meta.nAct` или `proposal.actions.length`).
- `aiRepRealtimeApply(rows, p)` — INSERT → `aiRepMerge` (payload несёт `meta`+`data`), DELETE → убрать по `p.old.id` (незнакомый id — ничего).

**Асинхронные обёртки (тонкие):**
- `aiRepLoad()` — `select('id,kind,key,at,meta').order('at',{ascending:false}).range(0,999)`; слить с ещё не подтверждёнными локальными строками; `ready=true`; перерисовка, если что-то изменилось. Когда: после первого `pullState` аккаунта; при догоне после сна (`syncResumeCheck`, тот же троттлинг) — страховка от пропущенного realtime. Ошибка — одна повторная попытка через 3 с (как `loadSharedAnalysis`), дальше разделы показывают «не загружено — ↻».
- `aiRepReady()` — дождаться `ready` (≤ 5 с, иначе продолжить без истории).
- `aiRepEnsure(rows)` — дотянуть `data` строк без неё: `select('id,data').in('id', ids)`; дедуп запросов в полёте, **неудача запоминается** до явного «↻» (CLAUDE.md: загрузку раздела — один раз на вход, иначе зациклит сеть).
- `aiRepPut(kind, key, entry)` — строка в память (`data`=entry) → `upsert([{kind,key,at,data}], {onConflict:'user_id,kind,key,at', ignoreDuplicates:true}).select('id,kind,key,at,meta')`. Ошибка → исходящая очередь `dash_ai_outbox_<uid>` (localStorage, ≤ 2 МБ; переполнение — тост, запись остаётся в памяти), один тост «⚠ AI-отчёт не сохранён в облако — повторю при подключении»; сброс очереди — при `online`/возврате на вкладку/следующей записи/после `aiRepLoad`.
- `aiRepDel(row)` — delete по `id` (нет `id` — по `kind/key/at`).
- `aiRepSweep()` — перенос из ledger (§4.3).
- Смена аккаунта (`syncReset` и выход): `AI_REP` и `AI_LEGACY_STOCK` обнуляются; ответы `aiRepLoad/Ensure/Sweep` применяются, только если `AI_REP.uid === currentUser.id` (как проверка аккаунта в `sigRun`).
- Realtime: в канал `dash_<uid>` (app.js:392) — второй `.on('postgres_changes', {event:'*', schema:'public', table:'ai_reports', filter:'user_id=eq.'+uid}, aiRepOnRealtime)`. Обрезка лимитов на сервере приходит DELETE-событиями — память повторяет лимиты без JS-копии констант.

### 4.2 Читатели и писатели

| Место | Было | Стало |
|---|---|---|
| `pf3AiHist` app.js:1909 | `d.aiHistory` | `aiRepList(rows,'proto',key).map(aiEntry)`; `aiReport` больше не читается (переносится sweep'ом) |
| `pf3AiHTML` :2433, `pf3PropHTML` :2487 | текст/`proposal` из памяти | `_partial` → «⏳ загружаю отчёт…» (данные тянет хук входа §4.4) |
| `hasProp` app-5.js:542 | `H[0].proposal.actions.length` | `aiProtoActs(H[0]) > 0` (из `meta.nAct`) |
| `planImportFromAi` app-5.js:394 | синхронно | `async`: `await aiRepEnsure([последний])`, затем как было |
| `marketContext` app.js:1899 | `di.aiHistory[0]` | `aiProtoSummary(aiEntry(последний proto вкладки))` — из `meta` |
| `pf3AiRun` :1961 | `d.aiHistory=[entry,…]` + `scheduleSave` | `await aiRepReady()` до снапшота; результат — `aiRepPut('proto', key, entry)`; `scheduleSave` остаётся только ради `AI_SPEND` |
| `aiChatSend` :2358 | — | `await aiRepReady()` до `pf3AiSnapshot()` (трек-рекорд и контекст рынка полные) |
| `stockAiRun` :2071 | `STOCK_AI_LOG=[…].slice(0,300)` | `aiRepPut('stock', sym, entry)` (та же форма записи) |
| `aiTrackRecord` :673, prior :2025 | `STOCK_AI_LOG` | `stockAiLog()` = `aiRepList(rows,'stock').map(aiEntry)` — хватает `meta` |
| `stkLogHTML` :2264 / `stkToggle` / `stkDelete` :2258 | текст из памяти / фильтр массива | список из `meta`; раскрытие → `aiRepEnsure([row])`; удаление → `aiRepDel` |
| `stockAiHTML` :2304 | последний из `STOCK_AI_LOG` | последний `stock` тикера; `_partial` → ensure через пул `deskPoolRun('aidata|'+sym, …)` |
| `pf3AnalysisHTML` :2520 | `DATA[v3Key].analysis` | последний `pfa` вкладки; `_partial` → «⏳…» |
| `aipRunNow` app-3.js:88 | `pullState()` ради `analysis` | без изменений (безвредно); комментарий поправить — анализ приходит по realtime `ai_reports` |

### 4.3 Перенос из ledger (`aiRepSweep`) — сохранность по построению

1. `applyRemoteState(s)`: `DATA=s.data` как было (AI-поля вкладок остаются на месте до подтверждения); `s.stockAiLog` → `AI_LEGACY_STOCK` (не в память отчётов напрямую).
2. После применения (только `currentUser && syncReady`) — `aiRepSweep()`: `aiLedgerExtract({data:DATA, stockAiLog:AI_LEGACY_STOCK})` → строки сразу вливаются в `AI_REP` (UI видит их до подтверждения) → `upsert … ignoreDuplicates` пачками (≤ 50 строк и ≤ 512 КБ на запрос) → по **каждой подтверждённой** пачке `aiLedgerStrip(...)` → `scheduleSave()`. Ошибка → ничего не удаляется, повтор при следующем `applyRemoteState`/догоне. Один перенос в полёте.
3. `snapshotState`: ключ `stockAiLog` пишется **только пока** `AI_LEGACY_STOCK` непуст (неподтверждённый остаток); AI-поля вкладок уходят из снапшота сами, когда `aiLedgerStrip` убрал их из `DATA`. Отклонение от правила «чистить на каждый проход `migrateState`»: синхронно чистить нельзя — до подтверждения другой копии нет.
4. Старый клиент (R1) может вернуть `stockAiLog`/`aiHistory` из своей памяти → новый клиент перенесёт снова (дубли игнорируются уникальным ключом) и уберёт. Пинг-понг длится, пока старый клиент открыт; данных не теряет.
5. Воркер до E5b пишет `analysis`/`analysisHistory` в ledger ежечасно → новый клиент при открытии переносит их в `pfa`. Поэтому **порядок деплоя клиента и воркера не важен** (нужен только SQL §3). `pfAnalysisAt` клиент **не трогает** (гейт старого воркера; после E5b поле просто устаревает).

### 4.4 Когда тянуть полный текст (один раз на вход)

- Книга → AI (`deskBookAiHTML` desk.js:2138; разделы `proto`/`prop`/`analysis`): в `deskClassicAfter` (desk.js:2631) — `aiRepEnsure` строк `proto` этой вкладки (≤ 10, ≤ 130 КБ) или последнего `pfa`.
- Журнал → AI-разборы (`jt='stkai'`): ничего; текст по раскрытию строки.
- «Акция» → панель «🔬 AI-анализ акции» (desk.js:1796, админ): последний `stock` тикера через пул, только если панель раскрыта.

### 4.5 Снапшот и тесты формата

- `SNAP_KEYS` (tests/cases-app.js:278) — без `stockAiLog`; отдельный кейс: при непустом `AI_LEGACY_STOCK` снапшот содержит `stockAiLog` с ровно этим остатком.
- `applyRemoteState` старого снапшота (с `stockAiLog`) не трогает память отчётов напрямую и не пишет `STOCK_AI_LOG` (глобала нет).
- CLAUDE.md («Архитектура → Supabase», «Новый ключ снапшота»): AI-отчёты живут в `ai_reports`; новый AI-отчёт — только `aiRepPut`, не в `DATA[tab]`/снапшот; читать — `aiRepList`/`aiEntry`/`stockAiLog()`.

## 5. Воркер (сессия E5b)

- `aiReportInsert(env, userId, kind, key, at, data)` — `POST /rest/v1/ai_reports?on_conflict=user_id,kind,key,at`, service-ключ, `Prefer: resolution=ignore-duplicates,return=minimal` → `true` ⇔ `r.ok`.
- `aiReportLastAt(env, userId, kind, key)` — `GET ai_reports?select=at&user_id=eq.…&kind=eq.pfa&key=eq.<key>&order=at.desc&limit=1` → мс; ошибка → `null`. **Ключ вкладки с пробелами/скобками/эмодзи** («Portfolio (Anna)», «🚀 Портфель 3.0») — `encodeURIComponent`, при необходимости двойные кавычки по правилам PostgREST; построитель URL — чистая функция с тестом на оба ключа.
- `analyzeOnePortfolio` (telegram-notify.js:2197): гейт — `max(aiReportLastAt ?? 0, snap.data[key].pfAnalysisAt ?? 0)` (переход со старого гейта); результат — `aiReportInsert(env, row.userId, 'pfa', key, a.at, entry)` вместо `writeChecked` (запись `analysis`/`analysisHistory`/`pfAnalysisAt` в ledger удаляется). Telegram — только после `true`; `false` → `Анализ <key>: не удалось сохранить (ai_reports — выполнен ли supabase-ai-reports.sql?) — Telegram не отправлен`.
- Бюджет подзапросов не растёт: было `loadRow` (снапшот) + `writeChecked` (≥ 2: `loadRow` + PATCH, до 6 при конфликтах); стало `loadRow` + GET гейта + POST.
- `WORKER_BUILD` — бамп (`2026-09-XXe5-ai-reports`). Комментарии «пишется в data[key].analysis» (telegram-notify.js:51, :1974) — поправить.
- **Тесты:** worker-suite — построитель URL и `pfaEntry(a)` (чистые); `tests/run-worker-async.js` (мок fetch): успех → один POST в `ai_reports` (kind `pfa`, ключ, запись), **ни одного PATCH `ledger_state`**, Telegram после вставки; вставка упала → Telegram нет, сообщение об ошибке; гейт по последней строке («Рано»); чтение гейта упало → берётся `pfAnalysisAt` ledger.

## 6. Совместимость (R1)

| Кто | Что видит | Итог |
|---|---|---|
| Новый клиент, ledger записан старым клиентом/воркером (с AI-полями) | перенос → таблица → удаление из ledger после подтверждения | ✔ |
| Старый клиент, ledger записан новым (без AI-полей) | пустая история AI / разборов (данные в таблице) | ✔ деградация показа; его новый отчёт попадёт в ledger и будет перенесён |
| Старый клиент с AI в памяти | при push вернёт `stockAiLog`/`aiHistory` | ✔ повторный перенос, дубли игнорируются |
| Старый воркер (до E5b) | пишет `analysis` в ledger | ✔ переносит клиент |
| Новый воркер, старый клиент | анализ в таблице, старый клиент показывает устаревший | ✔ деградация показа |
| Не-админ | свои строки (AI-эндпоинты у него закрыты); его старые AI-поля переносятся при входе | ✔ |
| E4 (слияние) | AI-полей в ledger больше нет — единиц слияния меньше; переходный `stockAiLog` — обычная единица верхнего уровня | ✔ упрощает E4 |

## 7. Тесты и стенд

**JSC (app-suite), группа `ai reports (E5)`:** `aiRowKey` (ISO `Z` ≡ `+00:00`, нет даты → `null`); `aiLedgerExtract` (фикстура: `aiHistory` + `aiReport`, `analysis` ∈ `analysisHistory` и вне её, `stockAiLog` с тикером в нижнем регистре, записи без даты → `bad`, запись передаётся без изменений); `aiLedgerStrip` (только подтверждённые, пустые поля удаляются, неподтверждённые остаются, идемпотентность); `aiRepMerge` (дедуп, `data` не теряется, `id` из БД); `aiEntry` для трёх видов (с данными = прежняя форма; без — `_partial`, у `stock` поле `ts`); `aiProtoSummary`/`aiProtoActs` (с `meta` и с данными дают одно и то же на фикстуре); `aiRepRealtimeApply` (INSERT, DELETE своего/чужого id); снапшот (`SNAP_KEYS`, переходный `stockAiLog`); смена аккаунта обнуляет `AI_REP`; сканер: в app*.js/desk.js нет записи в `.aiHistory`/`.analysis`/`STOCK_AI_LOG` вне слоя E5. `MIN_CASES_app` поднять.
**Асинхронное** (`aiRepPut`/`Sweep`/`Load`/`Ensure`, очередь, повтор, проверка аккаунта) — node-скриптом в vm, как в E1 (в репо не добавлять, если нет асинхронного раннера клиента — §8 ledger-model-e).
**Стенд** `tests/ledger-copy.js`, новый режим `--ai-out`: после `applyRemoteState(copy)` — **I5 сохранность**: `aiLedgerExtract` вернул ровно все AI-записи копии (независимый подсчёт в стенде по видам и вкладкам, каждая `data` глубоко равна исходной, `bad` = 0 или перечислены); затем «подтвердить всё» → `aiLedgerStrip` → `snapshotState`: I0 с `--expect-drop=stockAiLog,data.*.aiHistory,data.*.analysis,data.*.analysisHistory` (+ `data.*.aiReport`, если есть), I1/I2 ✔, I4 ≈ 317 КБ (≈ 250 КБ после E3).
**SQL** — PGlite (§3).

## 8. Деплой и действия пользователя

**E5a** (по порядку):
1. SQL: бэкап `create table backup.ledger_state_e5 as table public.ledger_state;` → выполнить `supabase-ai-reports.sql` целиком → проверка `select public.ai_reports_meta('proto','{"text":"x","proposal":{"summary":"s","actions":[1]}}');`.
2. Push → жёсткая перезагрузка **всех** устройств (Cmd+Shift+R / сброс SW, PWA тоже), `CLIENT_BUILD` в консоли = новый `?v=`. Первый вход владельца переносит его отчёты.
3. SQL-сверка сохранности (бэкап e5 против таблицы; для пользователей, ещё не входивших, `in_table = 0` — это нормально):
```sql
with b as (select user_id, data from backup.ledger_state_e5),
e as (
  select b.user_id, 'proto' as kind, t.key, x->>'at' as at from b, jsonb_each(b.data->'data') t,
    jsonb_array_elements(case when jsonb_typeof(t.value->'aiHistory')='array' then t.value->'aiHistory' else '[]'::jsonb end) x
  union all
  select b.user_id, 'pfa', t.key, x->>'at' from b, jsonb_each(b.data->'data') t,
    jsonb_array_elements(case when jsonb_typeof(t.value->'analysisHistory')='array' then t.value->'analysisHistory' else '[]'::jsonb end) x
  union all
  select b.user_id, 'pfa', t.key, t.value->'analysis'->>'at' from b, jsonb_each(b.data->'data') t
    where jsonb_typeof(t.value->'analysis')='object'
  union all
  select b.user_id, 'stock', upper(trim(x->>'ticker')), x->>'ts' from b,
    jsonb_array_elements(case when jsonb_typeof(b.data->'stockAiLog')='array' then b.data->'stockAiLog' else '[]'::jsonb end) x
), u as (select distinct user_id, kind, key, at from e where at is not null)
select u.user_id, u.kind, count(*) as in_backup, count(r.id) as in_table
from u left join public.ai_reports r
  on r.user_id = u.user_id and r.kind = u.kind and r.key = u.key and r.at = u.at::timestamptz
group by 1, 2 order by 1, 2;
-- и что осталось в ledger
select user_id, data->>'cv' as cv, octet_length(data::text) as bytes,
       (select count(*) from jsonb_each(l.data->'data') t
         where t.value ?| array['aiHistory','aiReport','analysis','analysisHistory']) as tabs_with_ai,
       coalesce(jsonb_array_length(case when jsonb_typeof(data->'stockAiLog')='array' then data->'stockAiLog' end), 0) as stock_log
from public.ledger_state l order by 3 desc;
```
   Ожидание у владельца: `in_table = in_backup` по всем видам; `tabs_with_ai = 0` (до E5b — может появиться `analysis` от старого воркера и уйти при следующем открытии), `stock_log = 0`, ≈ 320 КБ в `jsonb::text`. (Сверку прогнать на PGlite в E5a.)
4. Живая проверка: книга → AI → AI Proto (история видна, текст догружается), «Предложение», «Анализ»; журнал → AI-разборы (список, раскрытие); «Акция» → 🔬. Запись без кредитов Anthropic: в консоли `aiRepPut('stock','E5TEST',{ticker:'E5TEST',name:'E5 test',ts:new Date().toISOString(),verdict:'watch',text:'проверка E5'})` → строка в SQL и во второй вкладке (realtime) → 🗑 в AI-разборах → исчезла в обеих. С кредитами — 🔮 и 🤖 AI-анализ.

**E5b:** деплой воркера (после SQL E5a) → Skill `verify-worker` (`?action=version` = новый build) → при наличии кредитов `?action=pfanalyze&key=Portfolio (Anna)` (кнопка/URL админа): новая строка `pfa` в SQL, в ledger нет `analysis` (`tabs_with_ai = 0`), «📈 Анализ» обновился без перезагрузки, Telegram пришёл. Без кредитов — ждёт пополнения (путь ошибки не изменился).
**Через 30 дней после закрытия блока E** — `drop table backup.ledger_state_e5` (вместе с прочими `backup.*`).

## 9. Риски

| Риск | Мера |
|---|---|
| Запись удалена из ledger, но не попала в таблицу | удаление только после подтверждённой вставки (§4.3); стенд I5; SQL-сверка §8; бэкап e5 |
| Бесконечная догрузка при ошибке сети | неудача `aiRepEnsure` запоминается до «↻»; хуки — один раз на вход |
| Утечка отчётов между аккаунтами на одном устройстве | обнуление в `syncReset`, проверка `AI_REP.uid` у всех ответов; очередь — по `uid` |
| Метки времени в разном формате → дубли в памяти | `aiRowKey` в мс; уникальный ключ БД по `timestamptz` |
| DELETE-события realtime чужих строк | только `id`; незнакомый — игнор |
| Ключ вкладки со скобками в фильтре PostgREST (воркер) | чистый построитель URL + тест на «Portfolio (Anna)» |
| Гейт авто-анализа при переходе | `max(последняя строка, pfAnalysisAt ledger)` |
| Очередь в localStorage переполнена | лимит 2 МБ, тост, запись остаётся в памяти до перезагрузки |
| Старый клиент админа | как в E1: перезагрузить все устройства; безвредно — только повторный перенос |

## 10. Откат

- **E5b:** `git revert` + деплой прежнего воркера → анализ снова пишется в ledger; новый клиент его переносит. Данные не восстанавливаются.
- **E5a:** `git revert` + push. Старый клиент ищет отчёты в ledger, а они уже в таблице → вернуть их SQL-скриптом «таблица → ledger» с `rev+1` (DO-блок: по каждому пользователю `aiHistory` вкладок = `jsonb_agg(data order by at desc)` вида `proto`, `analysis` = последний `pfa`, `analysisHistory` = `pfa` (≤ 5), `stockAiLog` = `stock`). Скрипт пишется и **проверяется на PGlite в E5a**, кладётся в «Итоги E5a». Таблица остаётся (безвредна). Торговые данные откат не затрагивает.

## 11. Сессии

| Шаг | Что | Модель · effort | Оценка | Вход |
|---|---|---|---|---|
| E5a | SQL §3 (+PGlite), слой `AI_REP`, читатели/писатели §4.2, перенос §4.3, хуки §4.4, realtime, тесты, стенд `--ai-out`, CLAUDE.md, SQL отката | **Opus 5 · high** | ≈ 1 д | E1 проверен вживую (сверка `has_shared_keys` через сутки), E3 закоммичен |
| E5b | воркер §5, async-тесты, `WORKER_BUILD` | **Sonnet 5 · high** (точечная правка по готовой спеке) | 0,25–0,5 д | SQL E5a выполнен |

**Порядок блока E** после этого плана: E3 (Sonnet · high) → E5a → E5b → E2 → E4. E3 первым — маленький, трогает те же `snapshotState`/`SNAP_KEYS`, пусть диффы не смешиваются; E5a и E3 друг от друга не зависят.

## 12. Найдено попутно (вне E5)

- **Трек-рекорд AI считает только «avoid».** `aiTrackRecord` (app.js:679) копит вердикты `buy/wait/sell/avoid`, а у разборов акций шкала `add/watch/avoid` (схема воркера telegram-notify.js:2586) → записи `add`/`watch` молча пропускаются, в промпт уходит трек-рекорд только по «avoid». Исправление (соответствие `add→buy`, `watch→wait`) меняет входные данные AI — отдельной маленькой задачей, вместе с переводом промптов на шкалу SIG.
- Комментарий в `aipRunNow` (app-3.js:88) о том, что цикл пишет авто-анализ, устарел с блока A (анализы — отдельными cron-слотами/`?action=pfanalyze`).

## 13. Итоги сессий

_(заполняются в E5a/E5b: что сделано, отклонения, числа тестов, стенд, SQL, живая проверка)_

### Итоги E5a (2026-09-12, Opus 5 · high)

**SQL — `supabase-ai-reports.sql`** (новый, идемпотентный) — по §3, плюс: `revoke all … from anon, authenticated` + `grant select, insert, delete … to authenticated` (без update/truncate: truncate RLS не проверяет); `ai_reports_meta` — `immutable`; отдельный индекс `ai_reports_list_idx` не создаётся — индекс уникального ключа `(user_id, kind, key, at)` служит и списку, и обрезке. **PGlite: 40/40** (роли/`auth.uid()`/публикация как в Supabase, дважды подряд — идемпотентность): meta трёх видов (в т.ч. пустой `summary` → текст, `null`-proposal, 1200 символов с эмодзи — символы, не байты), обрезка 10/5/300 (stock — общий лимит по тикерам), дубль `Z` ≡ `+00:00` игнорируется и не возвращается, `data` > 256 КБ / не объект / пустой ключ / чужой вид — 23514, RLS (чужую строку не видно/не удалить/не вставить от чужого имени, обрезка одного пользователя не трогает другого), update/truncate/anon — 42501, service_role вставляет с явным `user_id` мимо RLS; сверка §8 и скрипт отката — на фикстуре (ниже).

**Клиент — слой `AI_REP`** (app.js, блок «AI-отчёты (E5)» между маркерами `// ── AI-отчёты (E5) ──` … `// ── /AI-отчёты (E5) ──`, сразу после общей аналитики): чистые `aiRowMs/aiRowKey` (мс, микросекунды отбрасываются), `aiLedgerExtract`, `aiLedgerStrip`, `aiRepMerge`, `aiRepReconcile`, `aiRepList`, `aiEntry`, `aiProtoSummary/aiProtoActs`, `aiRepFillData`, `aiRepConfirmRows`, `aiRepRealtimeApply`, `aiRepBatches`, `aiOutboxAdd`, `aiRepPermanent`; обёртки `aiRepLoad/aiRepReady/aiRepEnsure/aiRepRetry/aiRepPut/aiRepDel/aiRepSweep/aiOutboxFlush/aiRepOnRealtime`. Глобала `STOCK_AI_LOG` нет; `stockAiLog()` — список разборов в прежней форме. Читатели/писатели — по §4.2 (`pf3AiHist`, `pf3AiHTML`, `pf3PropHTML`, `pf3AnalysisHTML`, `marketContext`, `aiTrackRecord`, `stockAiSnapshot` prior, `stockAiRun`, `stkLogHTML/stkToggle/stkDelete`, `stockAiHTML`, `hasProp`, `planImportFromAi` → async + догрузка, `pf3AiRun`/`aiChatSend`/`stockAiRun` ждут `aiRepReady()`). Хуки §4.4 — `deskAiNeed/deskAiAfter` в desk.js (из `deskClassicAfter` и по раскрытию «🔬»). Снапшот: `stockAiLog` — только пока непуст `AI_LEGACY_STOCK`.

**Отклонения от плана (и почему).**
1. **Буфер `AI_LEGACY_STOCK` не сбрасывается при смене памяти отчётов** (`aiRepUid`), только при выходе (`syncReset` → `aiRepReset`): первая версия обнуляла его в `aiRepUid`, а `aiRepUid` зовётся из переноса уже после `applyRemoteState` — снапшот ушёл бы без `stockAiLog` до переноса (**потеря данных**; ловит мутация в async-скрипте).
2. **Сверка списка с памятью** (`aiRepReconcile(prev, loaded, keep)`): строки, подтверждённые/пришедшие, пока летел запрос списка, сохраняются — ответ мог быть снят раньше их вставки (без этого после первого входа история пропадала с экрана до следующей загрузки; данные целы). Подтверждённые **до** запроса и пропавшие с сервера (обрезка, удаление на другом устройстве) — уходят.
3. **Push после переноса — отложенный и вразброс** (`aiStripSave`: 1,5 + до 8 с) и отменяется, если за это время пришёл снапшот облака или прошёл свой push: два открытых устройства переносят одно и то же (до E5b — после каждой записи анализа воркером) и иначе конфликтовали бы по rev (тост «повторите правку»). Находка ревью.
4. **Отказ сервера по пачке (22/23) — повтор по одной строке** (`aiRepInsertSafe`): в переносе отклонённые строки остаются в ledger (как `bad`) и в этой сессии не повторяются (`_aiSweepRej`), соседи переносятся; в очереди отклонённая — удаляется с тостом, соседи — вставляются. Находка ревью.
5. **Realtime `ai_reports` — отдельный канал `ai_<uid>`** (в плане — второй `.on` в `dash_<uid>`): ошибка подписки на таблицу (SQL не выполнен/откат) не должна ронять канал ledger. INSERT — с фильтром `user_id`, DELETE — отдельной подпиской без фильтра (приходит только id). Эхо своей подтверждённой вставки не перерисовывает. Находка ревью.
6. **Догон после сна** (`syncResumeCheck`) зовёт и `aiRepLoad`, и `aiRepSweep` (перенос после сетевой ошибки иначе ждал бы следующей записи облака). Ключ догрузки в desk — набор строк без текста (а не «вход в раздел»): строки, пришедшие догоном/realtime без текста, догружаются; неудачные выпадают из набора (помнит `aiRepEnsure` до «↻») — фоновые перерисовки сеть не долбят.
7. `aiLedgerExtract` берёт и `aiHistory`, и `aiReport` одновременно (дедуп по метке) — в плане «`aiHistory` (нет — `aiReport`)»; так ни одна запись ledger не остаётся непереносимой. Записи > 200 КБ (UTF-8 компактного JSON; лимит БД — 256 КБ `jsonb::text`) — в `bad`, как без даты.
8. Запись при сетевой ошибке уходит в очередь **аккаунта записи**, даже если за время запроса вышли/сменили аккаунт (очередь по `uid`, сбрасывается при его входе). Находка ревью.
9. SQL-сверка §8 дополнена устаревшим `aiReport` и сравнением меток как `timestamptz` (без этого `…Z` и `…+00:00` считались бы разными).

**Тесты.** app 1379 → **1465** (группа `ai reports (E5)` +82: ключ в мс, извлечение/`bad`/данные как есть, strip только подтверждённого и идемпотентность, merge/reconcile/keep, порядок, `aiEntry` трёх видов, сводка/действия данных ≡ meta на фикстурах SQL, realtime (эхо, DELETE чужого id), подтверждение пачки, пачки ≤ 50/512 КБ, очередь, постоянные ошибки, снапшот и буфер, аккаунт, читатели с `_partial`/«↻»/«⏳», ключ догрузки desk, сканер «AI-поля ledger и `from('ai_reports')` — только слой E5»; `aiTrackRecord` — на строках и на одной meta; `marketContext` — из meta; `SNAP_KEYS` без `stockAiLog`; E0 — догон зовёт список и перенос), worker 239, async 46; `MIN_CASES_app` 1350 → 1430. **Async (node vm, в репо не добавлен — §8 ledger-model-e): 71/71** — имитация `ai_reports` с PostgREST-семантикой upsert ignore-duplicates, обрезкой и RLS: перенос (всё/ошибка/частичный успех 50+15/смена аккаунта/один в полёте/повторный с дублями), отложенный push и его отмена, отказ одной строки, загрузка (meta, чужие не видны, очередь, повтор 3 с → «↻», смена аккаунта), гонка «список снят до вставки», `aiRepEnsure` (дедуп запросов, память неудачи, «↻», строки нет), запись (ok/сеть → очередь/отказ/смена аккаунта/без даты/без аккаунта), удаление (по id, по ключу, ошибка → возврат, буфер ledger), `planImportFromAi` с догрузкой, `applyRemoteState` → перенос. Мутации (strip всего; сброс буфера в `aiRepUid`; reconcile без keep) — тесты падают.
**Стенд на реальной копии** (`owner-2026-09-12.json`, rev 7507, HEAD = cd23336 после E3): без `--ai-out` — снапшот идентичен (I0 ✔, перенос без сервера ничего не меняет); `node tests/ledger-copy.js ~/dash-ledger-copies/owner-2026-09-12.json --ref=HEAD --ai-out` → **I5 ✔ извлечено ровно всё: 32 строки (proto 19 · pfa 10 · stock 3), bad 0**, I0 ✔ (удалены только AI-поля), I1 ✔ (16 вкладок, 573 строки, 32 сделки), I2 ✔, **I4: 589,6 → 245,0 КБ** компактного JSON (24 % лимита realtime; прогноз плана — ≈ 250 КБ). `--bundle --ai-out` — ✔.
**Ревью.** Независимый адверсарный проход по диффу: путей потери записи не найдено; находки 1–6 выше (канал, гонка push, отказ пачки, очередь при смене аккаунта, перенос при догоне, догрузка) — исправлены. Не исправлено (малозначимо, данных не теряет): удалённый разбор может «вернуться», если 🗑 нажат, пока летит вставка переноса той же записи, или старый клиент снова пушит свой `stockAiLog`; строки, обрезанные сервером сразу при вставке, до следующей загрузки списка могут показывать «не загрузился ↻».

**За пользователем (по порядку, §8):**
1. SQL: `create table backup.ledger_state_e5 as table public.ledger_state;` → выполнить `supabase-ai-reports.sql` целиком → `select public.ai_reports_meta('proto','{"text":"x","proposal":{"summary":"s","actions":[1]}}');` → `{"nAct": 1, "nWl": 0, "summary": "s"}`.
2. Push (E3 cd23336 + этот коммит) → жёсткая перезагрузка **всех** устройств (Cmd+Shift+R / сброс SW, PWA тоже), в консоли `CLIENT_BUILD` = новый `?v=`. Первый вход владельца переносит его отчёты (в консоли — без `AI sweep: insert failed`).
3. SQL-сверка сохранности (бэкап e5 против таблицы; у не входивших пользователей `in_table = 0` — нормально) — ожидание у владельца: `in_table = in_backup` по всем видам (по копии: proto 19, pfa 10, stock 3):
```sql
with b as (select user_id, data from backup.ledger_state_e5),
e as (
  select b.user_id, 'proto' as kind, t.key, x->>'at' as at from b, jsonb_each(b.data->'data') t,
    jsonb_array_elements(case when jsonb_typeof(t.value->'aiHistory')='array' then t.value->'aiHistory' else '[]'::jsonb end) x
  union all
  select b.user_id, 'proto', t.key, t.value->'aiReport'->>'at' from b, jsonb_each(b.data->'data') t
    where jsonb_typeof(t.value->'aiReport')='object' and jsonb_typeof(t.value->'aiHistory') is distinct from 'array'
  union all
  select b.user_id, 'pfa', t.key, x->>'at' from b, jsonb_each(b.data->'data') t,
    jsonb_array_elements(case when jsonb_typeof(t.value->'analysisHistory')='array' then t.value->'analysisHistory' else '[]'::jsonb end) x
  union all
  select b.user_id, 'pfa', t.key, t.value->'analysis'->>'at' from b, jsonb_each(b.data->'data') t
    where jsonb_typeof(t.value->'analysis')='object'
  union all
  select b.user_id, 'stock', upper(trim(x->>'ticker')), x->>'ts' from b,
    jsonb_array_elements(case when jsonb_typeof(b.data->'stockAiLog')='array' then b.data->'stockAiLog' else '[]'::jsonb end) x
), u as (select distinct user_id, kind, key, at::timestamptz as at from e where at is not null)
select u.user_id, u.kind, count(*) as in_backup, count(r.id) as in_table
from u left join public.ai_reports r
  on r.user_id = u.user_id and r.kind = u.kind and r.key = u.key and r.at = u.at
group by 1, 2 order by 1, 2;
-- и что осталось в ledger (ожидание у владельца: tabs_with_ai = 0 — до E5b может появиться analysis от воркера и уйти при
-- следующем открытии, stock_log = 0, ≈ 270 КБ в jsonb::text)
select user_id, data->>'cv' as cv, octet_length(data::text) as bytes,
       (select count(*) from jsonb_each(l.data->'data') t
         where t.value ?| array['aiHistory','aiReport','analysis','analysisHistory']) as tabs_with_ai,
       coalesce(jsonb_array_length(case when jsonb_typeof(data->'stockAiLog')='array' then data->'stockAiLog' end), 0) as stock_log
from public.ledger_state l order by 3 desc;
```
4. Живая проверка §8 п.4: «Позиции → AI» → AI Proto (история видна, текст догружается «⏳» → отчёт), «Предложение», «Анализ»; «Журнал → AI-разборы» (список, раскрытие, 🗑); «Акция» → «🔬». Запись без кредитов Anthropic — в консоли `aiRepPut('stock','E5TEST',{ticker:'E5TEST',name:'E5 test',ts:new Date().toISOString(),verdict:'watch',text:'проверка E5'})` → строка в SQL и во второй вкладке (realtime) → 🗑 в «AI-разборах» → исчезла в обеих.

**Откат E5a** (§10): `git revert` + push, **перезагрузить все устройства** (иначе клиент E5a тут же перенесёт отчёты обратно), затем SQL «таблица → ledger» — слияние без потерь (записи таблицы ∪ оставшиеся в ledger, дедуп по метке, таблица главнее; лимиты 10/5/300; только существующие вкладки; `rev+1`). Проверен на PGlite: результат, устаревший `aiReport` → `aiHistory`, остатки ledger сохранены, повторный запуск ничего не дублирует (растёт только `rev`). Таблица остаётся.
```sql
-- Откат E5a: AI-отчёты из ai_reports обратно в ledger_state (для клиента до E5a).
-- Выполнять ПОСЛЕ git revert + push и перезагрузки ВСЕХ устройств — иначе клиент E5a тут же перенесёт их обратно в таблицу.
-- Слияние без потерь: записи таблицы ∪ то, что ещё лежит в ledger (дедуп по метке времени, версия таблицы главнее),
-- новые первыми, лимиты — как в ledger до E5 (aiHistory 10, analysisHistory 5, stockAiLog 300). Пишутся только
-- существующие вкладки. rev+1 от текущего — иначе триггер ledger_state_guard отклонит запись. Таблица остаётся.
create or replace function pg_temp.e5_ts(t text) returns timestamptz language plpgsql immutable as $$
begin return t::timestamptz; exception when others then return null; end $$;
create or replace function pg_temp.e5_merge(a jsonb, b jsonb, f text, lim int) returns jsonb language sql as $$
  select coalesce(jsonb_agg(v order by ts desc nulls last), '[]'::jsonb) from (
    select v, ts from (
      select distinct on (coalesce(ts::text, v::text)) v, ts from (
        select v, pg_temp.e5_ts(v->>f) as ts, 0 as src from jsonb_array_elements(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) v
        union all
        select v, pg_temp.e5_ts(v->>f), 1 from jsonb_array_elements(case when jsonb_typeof(b) = 'array' then b else '[]'::jsonb end) v
      ) q order by coalesce(ts::text, v::text), src
    ) z order by ts desc nulls last limit lim
  ) y $$;
do $$
declare u record; t record; d jsonb; tab jsonb; led jsonb; m jsonb; stk jsonb;
begin
  for u in select distinct r.user_id from public.ai_reports r join public.ledger_state l on l.user_id = r.user_id loop
    select l.data into d from public.ledger_state l where l.user_id = u.user_id for update;
    for t in select r.key, r.kind, jsonb_agg(r.data order by r.at desc) as h from public.ai_reports r
             where r.user_id = u.user_id and r.kind in ('proto', 'pfa') group by r.key, r.kind loop
      tab := d->'data'->t.key;
      continue when jsonb_typeof(tab) is distinct from 'object';
      if t.kind = 'proto' then
        led := case when jsonb_typeof(tab->'aiHistory') = 'array' then tab->'aiHistory'
                    when jsonb_typeof(tab->'aiReport') = 'object' then jsonb_build_array(tab->'aiReport') end;
        m := pg_temp.e5_merge(t.h, led, 'at', 10);
        d := jsonb_set(d, array['data', t.key, 'aiHistory'], m) #- array['data', t.key, 'aiReport'];
      else
        led := coalesce(tab->'analysisHistory', '[]'::jsonb);
        if jsonb_typeof(tab->'analysis') = 'object' then led := jsonb_build_array(tab->'analysis') || case when jsonb_typeof(led) = 'array' then led else '[]'::jsonb end; end if;
        m := pg_temp.e5_merge(t.h, led, 'at', 5);
        d := jsonb_set(jsonb_set(d, array['data', t.key, 'analysisHistory'], m), array['data', t.key, 'analysis'], m->0);
      end if;
    end loop;
    select jsonb_agg(r.data order by r.at desc) into stk from public.ai_reports r where r.user_id = u.user_id and r.kind = 'stock';
    if stk is not null then d := jsonb_set(d, '{stockAiLog}', pg_temp.e5_merge(stk, d->'stockAiLog', 'ts', 300)); end if;
    d := jsonb_set(d, '{rev}', to_jsonb(coalesce((d->>'rev')::numeric, 0) + 1));
    update public.ledger_state set data = d, updated_at = now() where user_id = u.user_id;
  end loop;
end $$;
```

**Деплой (2026-09-14).** SQL выполнен (таблица есть, anon — 42501), push 5147e72 (`app.js?v=ddd2e834`). Бэкап `backup.ledger_state_e5` снят уже после первого открытия нового клиента (строка владельца `cv ddd2e834`, rev 7521): AI-поля в нём целы (сверка по нему годна), ключей E3 у владельца нет — их архив остаётся в `backup.ledger_state_e0` (мёртвые ключи без читателей); `backup.ledger_state_e1` так и не создавался. **Первое открытие (09:48 UTC) перенос не выполнило** — ledger сохранён новым клиентом (чистка E3), но `ai_reports` пуста; повтор по плану ждал следующего снапшота облака/возврата на вкладку, а их не было. После Cmd+Shift+R (10:08) перенос прошёл: консольная диагностика — вставка/чтение ok, в памяти 32 строки, извлекать нечего; SQL — `ai_reports` владельца `pfa 10 · proto 19 · stock 3` (= стенд), ledger rev 7523, **278 498 байт** (было 635 434), `tabs_with_ai 0`, `stockAiLog` нет.
**Исправлено после деплоя** (коммит ниже): (а) перенос, упавший с ошибкой, сам повторяется через 1 → 5 → 15 мин (`AI_SWEEP_RETRY_MS`; успех сбрасывает счётчик) — первый вход больше не зависит от следующего снапшота облака; (б) `aiStripSave` отменяет отложенный push только при пришедшем снапшоте облака, но **не** при своём коммите: push, снапшот которого снят до удаления AI-полей, коммитился после — и отмена оставляла облако с полями до следующей правки (данные не терялись, ledger не худел). Async 71 → 74/74 (мутация прежнего условия ловится).

Дальше — **E5b** (Sonnet 5 · high, §5): воркер пишет `pfa` в `ai_reports`, гейт по последней строке; вход — SQL E5a выполнен.

# План: блок E — модель данных ledger (миграция с откатом)

Статус: **Planning завершён** (2026-09-12, решения пользователя приняты — §9). **E0 закрыт 2026-09-12** (итоги §10: владелец 1275 КБ > лимита realtime → E5 нужен, Planning E5 — сразу после E1). **E1 — код сделан 2026-09-12** (итоги §10: стенд 1190 → 661 КБ; ждёт SQL, push и живой проверки пользователя). **Planning E5 завершён 2026-09-12 → `plans/ai-reports-e5.md`** (таблица `ai_reports`, сессии E5a/E5b). **E3 — код сделан 2026-09-12** (итоги §10 «Итоги E3»). **E5a — код сделан 2026-09-12, задеплоено и проверено 2026-09-14** (итоги — `plans/ai-reports-e5.md` §13: AI-отчёты в `ai_reports`, ledger владельца 635 → 278 КБ живьём). **E5b — код сделан 2026-09-14, Sonnet 5 · high** (итоги `plans/ai-reports-e5.md` §13) — ждёт деплоя воркера. E5 закрыт (код). **E2 — код сделан 2026-09-14, Opus 5 · high** (итоги §10 «Итоги E2»: именованные колонки `RC`/`COLN` в клиенте и воркере, 416 замен `r[N]` кодмодом, AST до/после равны); **E2 закрыт 2026-09-14** — стенд на свежей копии, SQL по всем пользователям, воркер и сайт задеплоены, живая проверка пройдена. **E4 — код сделан 2026-09-14, Opus 5 · max** (итоги §10 «Итоги E4»: `syncMerge3` + мягкие поля, счётчики, id записи `wid` — по ходу найдена и закрыта молчаливая потеря правки при равном rev двух писателей; сквозная симуляция синка `tests/run-sync-sim.js`; ревью Fable и две независимые перепроверки Opus пройдены, их находки закрыты) — ждёт push и живой проверки. Код — в отдельных сессиях Implementation E0…E4 (CLAUDE.md, «вариант 1»), по одной сессии на шаг; коммит в конце сессии после зелёных `bash tests/run.sh`, push — по просьбе. Источник находок — `plans/audit-followup.md` §E и `plans/redesign-trading/all_findings.json` (`data-model-sync#2/3/4/9`, `tests-quality#3/6/7`).

**Главная идея плана:** почти всё, что в аудите выглядело как «миграция формата ledger», делается **без смены формата хранения**. Формат меняется только одним способом — из снапшота *убираются* ключи, у которых есть другой источник правды или нет ни одного читателя. Строки остаются позиционными массивами; индексы получают имена только в коде. Поэтому версии клиента N и N−1 и воркер совместимы на каждом шаге, `SCHEMA_V` в блоке E не меняется, а откат шага — `git revert` (+ восстановление ключа из серверного бэкапа, если понадобится).

---

## 1. Что изменилось с аудита (факты на 2026-09-12, после S7b)

| Находка | Было в аудите | Сейчас |
|---|---|---|
| **#4 общие данные в личном снапшоте** | VAL/INSIDER/AI_RECO/TG_FULL/TG_META в снапшоте каждого пользователя | То же. `snapshotState` (app.js:26) пишет `val/insider/aiReco/tgFull/tgMeta`; `loadSharedAnalysis` (app.js:199) перекрывает их из `shared_analysis`, после чего **любой** пользователь (и не-админ) пушит их в свой ledger. Воркер эти ключи **не читает** (grep `snap.*`: data, aiPort, aiPortBak, posMeta, fx, aiPlaybook, planRules, desk, rev). |
| TG_META | «мета таргета» | **Мёртвая запись:** единственный писатель — app-5.js:1202, читателей нет. |
| Запись в `shared_analysis` | — | `pushSharedAnalysis` (app.js:211) upsert'ит **всю строку** (4 колонки) из памяти админа → last-writer-wins между двумя устройствами админа, ошибка — только `console.warn`. После загрузки shared нет перерисовки (`pullState` не зовёт `renderAll`) — первый экран сейчас спасает личная копия. |
| **#3 индексы и русские заголовки** | 39+21 поиск по заголовкам, сотни `r[N]` | Клиент: ≈450 обращений `r[N]`/`row[N]` (из них `r[2]` тикер ≈105, `r[8]` валюта ≈58, `r[6]/r[7]/r[9]` ≈90) и ≈35 поисков колонок по русским именам (`indexOf('Поддержка')`, `/аналит/i`, `ensurePFCol(d,'P/E')`…). Воркер: 24 `r[N]` + 11 поисков + `TARGET_COL`. **Префикс 0–15 одинаков на всех v3-вкладках**: `migrateIndexV3`, `pf3NewTab`, `aipSyncTab` копируют заголовки Портфеля 3.0 (app.js:790). Хвост (SMA, уровни, таргеты, мультипликаторы) дописывает `ensurePFCol` в разном порядке — его ищут только по имени. Расхождение уже есть: SMA 50 у клиента `/sma.?50/i`, у воркера `/sma.?50$/i`. |
| **#9 вторичные индексы** | colOrders/hiddenCols по индексам, ручной count, emoji-ключи | colOrders/hiddenCols **не пишутся с S7b-3**. `d.count` — 7 писателей, **читателей нет**. Ключ вкладки уже де-факто неизменяемый id: `pf3RenameTab` меняет только `d.title`. |
| **#2 один блоб** | 0,5–3 МБ (оценка) | Реальный размер неизвестен (замер — E0). **Новый факт:** у Supabase Postgres Changes лимит полезной нагрузки **1024 КБ**; при превышении в `new`/`old` остаются только поля ≤ 64 байт ([Realtime Limits](https://supabase.com/docs/guides/realtime/limits)). Для нас это значит: `p.new.data` пропадает, обработчик (`if(p.new && p.new.data)`, app.js:285) молча ничего не делает — realtime перестаёт синхронизировать, `stateRev` отстаёт, каждая правка после записи воркера/другого устройства уходит в rev-конфликт. То же грозит строке `shared_analysis` (AI_RECO хранит полный текст разбора). |
| Синк после сна | — | Перечитывания при возврате на вкладку (`visibilitychange`/`online`) нет: realtime не доставляет пропущенное → первая правка после сна ноутбука почти наверняка отклоняется триггером и теряется (политика «облако побеждает»). |
| Замороженные ключи | — | `sim`, `aiDash`, `scnAlerts`, `tgAlerts` — 3 упоминания каждый (объявление/снапшот/чтение), воркер не читает. `SMA_TF` пишется и тут же копируется в строку — хранить не нужно (читает только одноразовый `migrateSmaDaily`). Поля вкладок `btJournal/btConfig` — писателей нет. |

## 2. Цели и не-цели

**Цели.**
1. В личный ledger уходят только данные пользователя; общие данные по тикеру живут только в `shared_analysis` и пишутся точечно (патчем), без last-writer-wins.
2. Код обращается к колонкам строки по именам, русские заголовки — в одном месте (клиент) и одном месте (воркер), паритет проверяется тестом; регресс «снова `r[7]`» ловит тест.
3. Мёртвые ключи удалены с архивом.
4. Правка не теряется при конфликте, если облако меняло другой раздел (трёхстороннее слияние); realtime работает и при большом блобе; после сна клиент сам догоняет облако.
5. На каждом шаге — проверка на копии реального ledger и понятный откат.

**Не-цели (решено не делать и почему)** — §8.

## 3. Правила совместимости (для всех шагов)

- **R1 — N и N−1 живут одновременно.** Старый клиент (≥ S7b-3, 36794ca) может быть открыт на телефоне/втором устройстве днями. Шаг допустим, только если: новый клиент терпит данные, записанные старым (лишние ключи игнорирует); старый клиент терпит данные нового (без удалённых ключей ничего не теряет); воркер не замечает разницы.
- **R2 — удалить ключ из `snapshotState` ≠ удалить данные.** Push клиента заменяет весь `data`, поэтому ключ исчезает при первом push нового клиента; старый клиент может вернуть его — это безвредно (новый игнорирует и снова не пишет). Поля **внутри** вкладок (`btJournal` и т.п.) чистятся на каждый проход `migrateState` (как `migrateDropReco`), не одноразовым шагом.
- **R3 — `SCHEMA_V` не меняется.** Ни одного одноразового шага схемы в блоке E; поэтому откат не встречает «данные из будущего».
- **R4 — серверный бэкап перед каждым шагом с данными** (E0 создаёт, E1/E3 — перед деплоем обновляют), в **непубличной схеме** `backup` (таблица в `public` без RLS была бы видна любому через PostgREST). Хранить до закрытия блока E + 30 дней.
- **R5 — откат = `git revert` коммита шага + деплой сайта.** Данные откатывать не нужно ни в одном шаге; если нужно вернуть удалённый ключ — SQL-восстановление из бэкапа с **повышением `rev`** (иначе триггер `ledger_state_guard` отклонит запись: `new_rev <= old_rev → return OLD`). Воркер меняется только в E2 (без смены поведения).
- **R6 — версия клиента видна в данных.** С E0 снапшот несёт `cv` (build клиента). Снапшот без `cv` = его записал клиент до E0 → старые клиенты ещё живы (SQL-запрос §4.E0).

## 4. Сессии

Порядок: **E0 → E1 → E3 → E2 → E4**, E5 — условно по замеру E0. E2 (только код, деплой воркера) не зависит от E1/E3 и может идти раньше, если удобнее; E4 — последним (слияние проще на «похудевшем» снапшоте и с именованными колонками).

| Шаг | Что | Данные | Воркер | Модель · effort | Оценка |
|---|---|---|---|---|---|
| E0 | Замер, бэкап, стенд копии ledger, realtime-как-сигнал, догон после сна, `cv` | + ключ `cv` | нет | Opus 5 · high | 0,5–1 д |
| E1 | Общие данные только в `shared_analysis`, патч через RPC, TG_META удалить | −5 ключей | нет | Opus 5 · high | 0,5–1 д |
| E3 | Уборка: мёртвые ключи, поля вкладок, `count`, `SMA_TF` в памяти | −5 ключей, −поля | нет | Sonnet 5 · high | 0,5 д |
| E2 | Именованные колонки (клиент + воркер), паритет, запрет `r[N]` | нет | **да** (поведение то же) | Opus 5 · high | 1–1,5 д |
| E4 | Трёхстороннее слияние при конфликте | нет | нет | Opus 5 · max (+ ревью слияния Fable 5.1 · high) | 1–1,5 д |
| E5 | AI-отчёты в отдельную таблицу `ai_reports` (порог E0 превышен) — план `plans/ai-reports-e5.md`: E5a клиент+SQL, E5b воркер | −`stockAiLog`, −AI-поля вкладок | да (E5b) | E5a Opus 5 · high, E5b Sonnet 5 · high | ≈ 1,5 д |

### E0 — замер, бэкап, стенд, страховка синка

**Сделать.**
1. **SQL-замер** (пользователь запускает в Supabase SQL Editor, результат — в «Итоги E0»). Мерить длину JSON-текста (`length(x::text)`) — именно её видит realtime; `pg_column_size` — сжатый TOAST, не то.
   ```sql
   -- строка целиком и кто писал последним
   select user_id, length(data::text) as json_chars, data->>'rev' as rev, data->>'cv' as cv, updated_at
   from public.ledger_state order by 2 desc;
   -- ключи верхнего уровня
   select l.user_id, e.key, length(e.value::text) as chars
   from public.ledger_state l, jsonb_each(l.data) e order by 3 desc limit 60;
   -- вкладки × поля вкладок (aiHistory, analysis, rows…)
   select l.user_id, t.key as tab, f.key as field, length(f.value::text) as chars
   from public.ledger_state l, jsonb_each(l.data->'data') t, jsonb_each(t.value) f
   where jsonb_typeof(t.value)='object' order by 4 desc limit 40;
   -- общая строка
   select length(val::text) val, length(insider::text) insider, length(aireco::text) aireco, length(targets::text) targets
   from public.shared_analysis where id='global';
   ```
   **Порог:** строка ≥ 1 048 576 знаков — realtime уже не несёт `data` (п. 4 срочен, E5 поднимается сразу после E1); ≥ ~600 КБ или AI-ключи (`stockAiLog`, `aiChat`, `data.*.aiHistory`, `data.*.analysis`) > 50 % — пишется план E5.
2. **Бэкап** (R4):
   ```sql
   create schema if not exists backup;
   revoke all on schema backup from anon, authenticated;
   create table backup.ledger_state_e0 as table public.ledger_state;
   create table backup.shared_analysis_e0 as table public.shared_analysis;
   ```
   В файл `plans/ledger-model-e.md` («Итоги E0») — два шаблона восстановления: ключ (`jsonb_set` ключа из бэкапа + `rev+1`) и строка целиком (`data = jsonb_set(b.data,'{rev}', to_jsonb(текущий rev + 1))`), с `where user_id=…`.
3. **Копия ledger для стенда** — вне репозитория (личные данные): консоль залогиненной страницы, свой ряд:
   `copy(JSON.stringify((await sb.from('ledger_state').select('data').eq('user_id',currentUser.id).maybeSingle()).data.data))` → файл `~/dash-ledger-copies/owner-YYYY-MM-DD.json`. Строки не-админов — только через SQL Editor при необходимости; для них достаточно бандла `data.js` + общей строки.
4. **Стенд `tests/ledger-copy.js`** (node, **не** в `run.sh` — нужны личные данные): грузит `signals.js … desk-gloss.js` в `vm` с теми же заглушками, что `run-app.js` (заглушки вынести в `tests/env-stubs.js` и подключить в оба раннера — `run-app.js` читает его через `rd()`), и для рабочей копии и `--ref=<git ref>` (исходники через `git show`) выполняет `applyRemoteState(copy)` (без `currentUser`/`syncReady` — push не уходит) → `snapshotState()`. Отчёт:
   - **I1 первичные факты равны** между ref и HEAD: по каждой вкладке `tk/qty/buy/ccy/price` строк, `cashFree`, `pfTrades`, `posMeta`, `planRules`, `desk`, `deskWatch`, `aiPort`, `aiPlaybook`, `news`, `cycleOvr`; расхождение допускается только по ключам из `--expect-drop=…`;
   - **I2 идемпотентность:** `snapshot(apply(snapshot(apply(copy))))` === `snapshot(apply(copy))`;
   - **I3 контракт строки** (для E2): у каждой вкладки с `rows` `headers[0..15]` = заголовки Портфеля 3.0; список нарушителей;
   - **I4 размер:** длина JSON всего и по ключам, запас до 1024 КБ.
   Выход 0/1; этот стенд — «проверка на копии» во всех следующих сессиях (`node tests/ledger-copy.js <copy> --ref=<коммит до шага> --expect-drop=…`).
5. **Realtime как сигнал** (страховка от лимита 1024 КБ и от прочих потерь payload). Обработчик ledger: есть `p.new.data` — как сейчас (`syncOnRemote`); нет — `syncOnSignal()`: `select('data->rev')` → чистое решение `syncSignalDecision(remoteRev, stateRev, busy)` → `skip` / `defer` (флаг `remoteStale`, проверка повторяется в `syncSettle`) / `pull` (`pullState()`). Обработчик `shared_analysis`: колонки пришли не все → перечитать строку (`loadSharedAnalysis` + перерисовка).
6. **Догон после сна:** `visibilitychange` (стало видно) и `online` → та же проверка `data->rev` (не чаще раза в 30 с, только при `currentUser && syncReady`). До E4 при занятом синке — `defer`, как realtime.
7. **`cv`:** build клиента из `?v=` собственного `<script src="app.js?v=…">` (хук уже штампует хэш), в `snapshotState` + `SNAP_KEYS`; `applyRemoteState` его не применяет.

**Тесты (app-suite, JSC).** `syncSignalDecision` (таблица случаев: меньше/равно/больше rev × busy), троттлинг проверки после сна (чистая `syncResumeDue(now,last)`), `cv` в `SNAP_KEYS`. Стенд — ручной прогон на копии (ref = HEAD до E0: единственное отличие — `cv`).
**Проверка вживую.** Две вкладки браузера: правка во второй приходит в первую; DevTools → offline 2 мин → правка в другой вкладке → online → первая догоняет без конфликта; `?action=aiport` (▶) при открытой странице — её правка после цикла не теряется.
**Откат.** `git revert`; ключ `cv` старым клиентом просто отбрасывается. Бэкап-схема остаётся.

### E1 — общие данные по тикеру только в `shared_analysis`

**Сделать.**
1. **Сверка до деплоя (SQL, только чтение):** есть ли в личном ledger владельца записи новее общих (если раньше `pushSharedAnalysis` молча падал). Ключи ledger → колонки shared: `val→val`, `insider→insider`, `aiReco→aireco`, `tgFull→targets`.
   ```sql
   with l as (select data from public.ledger_state where user_id = '<OWNER_USER_ID>'),
        s as (select * from public.shared_analysis where id='global')
   select 'val' col,
          count(*) filter (where s.val->e.key is null) as missing_in_shared,
          count(*) filter (where (e.value->>'at') > (s.val->e.key->>'at')) as newer_in_personal
   from l, s, jsonb_each(l.data->'val') e
   -- … union all для insider/insider, aiReco/aireco, tgFull/targets
   ;
   ```
   Если > 0 — тем же предикатом `update … set <col> = <col> || (jsonb_object_agg новых)`; записи без `at` не трогать (оставить общие). Результат — в «Итоги E1».
2. **RPC точечной записи** (SQL в `supabase-shared-analysis.sql`, идемпотентно):
   `shared_analysis_patch(p_col text, p_patch jsonb)` — `security definer`, `set search_path = public`; проверка `user_access.role='admin'` для `auth.uid()`; белый список колонок `val/insider/aireco/targets`; `p_patch` — объект; `update … set <col> = coalesce(<col>,'{}') || p_patch, updated_at = now() where id='global'`; `revoke … from public, anon; grant execute … to authenticated`. Удаления тикеров не нужны (их не бывает).
3. **Клиент:** `pushSharedAnalysis()` → `sharedPatch(col, patch)`: RPC; если функции нет (SQL не выполнен, код PGRST202) — запасной путь: upsert **одной колонки** целиком (не всей строки); ошибка — тост админу «Общие данные не сохранены в облако — повторите сбор» (не `console.warn`). Сборщики передают только изменённые тикеры: `valUpdateAll` → `val` + `targets`, `insiderUpdateAll` → `insider`, `aiRecoRun` → `aireco` с одним тикером. Построение патча — чистые функции рядом со сборщиками (тестируются).
4. **Снапшот:** из `snapshotState` убрать `val, insider, aiReco, tgFull, tgMeta`; из `applyRemoteState` — их чтение; из `SNAP_KEYS` — ключи. `TG_META` удалить целиком (объявление + писатель app-5.js:1202).
5. **Загрузка:** `loadSharedAnalysis` → при изменении данных `renderAll()` (сейчас перерисовки нет, первый экран держался на личной копии); одна повторная попытка через 3 с при ошибке сети. Поведение «перекрывать только непустым» — сохранить.
6. Комментарии в `supabase-shared-analysis.sql` и CLAUDE.md («Архитектура → Supabase»): личный ledger не хранит общие данные; запись в shared — только `sharedPatch`.

**Совместимость (R1).**
| Кто | Что видит | Итог |
|---|---|---|
| Новый клиент, ledger записан старым (с `val…`) | ключи игнорируются, данные — из shared | ✔ |
| Старый клиент, ledger записан новым (без `val…`) | `applyRemoteState` не трогает свои VAL…, shared их перекрывает | ✔; старый вернёт ключи в ledger — безвредно |
| Старый клиент **админа** запускает сбор | upsert всей строки из своей памяти (LWW) может затереть свежие патчи | риск: после деплоя перезагрузить все устройства админа; `cv` в SQL покажет, пишет ли кто-то старый |
| Воркер | ключи не читает | ✔ |
| Не-админ | его ledger худеет; в shared он не пишет (RLS) | ✔ |

**Тесты.** `SNAP_KEYS` без 5 ключей (round-trip упадёт, если забыть), чистые построители патча, «`applyRemoteState` со старым снапшотом (с `val`) не меняет VAL», «`snapshotState` не содержит общих ключей».
**Проверка на копии.** `node tests/ledger-copy.js <copy> --ref=<до E1> --expect-drop=val,insider,aiReco,tgFull,tgMeta` → I1/I2 зелёные, I4 показывает выигрыш.
**Проверка вживую.** Админ: «📐 Оценка» и «🔄 AI-Рекомендация» → в SQL `shared_analysis` обновились только нужные тикеры/колонка; вторая вкладка получила их по realtime. Не-админ (тестовый аккаунт): после входа оценка/таргеты видны на первом экране; его ledger без 5 ключей.
**Откат.** `git revert` + деплой: старый код берёт общие данные из shared (как и сейчас), личные ключи вернутся при следующем push. RPC остаётся (безвредна). Данные не восстанавливаются.

### E3 — уборка мёртвых и производных ключей

**Сделать** (решение пользователя: удалить с архивом — архив = бэкап E0, перед деплоем E3 — свежий `backup.ledger_state_e3`).
1. `snapshotState`/`applyRemoteState`/`SNAP_KEYS`: убрать `sim`, `aiDash`, `scnAlerts`, `tgAlerts` вместе с глобалами `SIM`, `AI_DASH`, `SCN_ALERT_STATE`, `TG_ALERTS` (сейчас по 3 упоминания — объявление/снапшот/чтение; перепроверить grep'ом по всем файлам, включая воркер).
2. `smaTf`: не писать; `applyRemoteState` продолжает **читать** `s.smaTf` в память — он нужен одноразовому `migrateSmaDaily` для аккаунтов, ещё не прошедших v3. `SMA_TF.w` не вычислять (app-5.js:1040).
3. `migrateDropDead(DATA)` на каждый проход `migrateState` (рядом с `migrateDropReco`, можно объединить в одну функцию): удалить поля вкладок `btJournal`, `btConfig`, `count`; 7 писателей `d.count=…` удалить (читателей нет). Колонку «Реком. скоринг» из `headers` **не** убирать (её читает воркер).
4. CLAUDE.md: убрать абзац о «замороженных до блока E» ключах, заменить на перечень удалённых в E3.

**Тесты.** `SNAP_KEYS`; `migrateDropDead` — идемпотентность и число изменений; «на бандле после `migrateState` нет `count/btJournal/btConfig`».
**Проверка на копии.** `--expect-drop=sim,aiDash,scnAlerts,tgAlerts,smaTf` + поля вкладок; I1/I2 зелёные.
**Откат.** `git revert`; нужный ключ — SQL из бэкапа (шаблон §4.E0 п.2, с `rev+1`).

### E2 — именованные колонки (формат данных не меняется)

**Сделать.**
1. **Контракт префикса (клиент, app.js рядом с `migratePortfolio3`):** `PF_HEAD` — 16 заголовков префикса (из заголовков Портфеля 3.0) и `RC = {n:0,name:1,tk:2,country:3,sector:4,type:5,qty:6,price:7,ccy:8,buy:9,day:10,pl:11,plPct:12,value:13,xdag:14,pay:15}` (`Object.freeze`). `migratePortfolio3` строит заголовки из `PF_HEAD` + хвоста. `rowSchemaOk(d)` — `headers[0..15]` = `PF_HEAD`; в `migrateState` вкладка-нарушитель → `console.error` + разовый тост админу (данные не трогаем). Перед реализацией — отчёт I3 стенда на реальной копии: если нарушители есть, сначала решить с пользователем, что с ними делать.
2. **Хвост по id:** `COLN = {s50,s100,s200,sup,res,tg,tg3,pe,ps,dy,beta,roe,de,revg,payout,rev,cap,reco}` → русское имя заголовка (для SMA — матчер, общий с воркером); `colOf(d,id)` (−1, если нет) и `colEnsure(d,id)` (= `ensurePFCol` по id). Все ≈35 мест с `indexOf('…')`/`/аналит/i`/`ensurePFCol(d,'…')`/`smaIdx` — через них. Русские имена колонок остаются **только** в `COLN` (и в `migrateIndexV3`, который читает старую схему сида — его не трогаем).
3. **Механическая замена `r[N]` → `r[RC.id]`** в app*.js и desk.js кодмодом на acorn (инфраструктура `plans/redesign-trading/s7b-graph.js`): только идентификаторы-строки (`r`, `row`, `src`… — список составляет сессия по графу, кортежи вида `x[1]` в `map(([k,v])…)` не трогать), только литералы 0–15.
4. **Доказательство «ничего не поменялось»:** скрипт `plans/redesign-trading/e2-ast-eq.js` — парсит файл до и после, в новом подставляет `RC.<id>` → литерал, сравнивает AST без позиций; любое иное отличие допускается только в явном списке функций (замены п.2) и печатается. Выход 0 — замена `r[N]` эквивалентна байт-в-байт по семантике.
5. **Воркер:** те же `RC`/`COLN` (копия; общий модуль не вводим — сборки нет), `TARGET_COL`/`TARGET_RECENT_COL` → `COLN.tg/tg3`; `WORKER_BUILD` бамп. **Паритет:** `tests/fixtures-parity.js` (его же потом использует блок D) — таблица `RC`/`COLN`/матчеров SMA гоняется в обоих сьютах; расхождение (как нынешнее `/sma.?50$/` vs `/sma.?50/`) ломает тест — выровнять по воркеру или клиенту и записать выбор в итоги.
6. **Запрет регресса:** тест-сканер (как тест покрытия `DK_*` для словаря): в app*.js/desk.js нет `\b(r|row)\[(\d+)\]` и нет строковых литералов имён колонок вне `COLN`/`PF_HEAD`/`migrateIndexV3`; аналогично в worker-suite для воркера.

**Тесты.** `rowSchemaOk` (бандл после `migrateState` — все вкладки ок; испорченная вкладка — нет), `colOf/colEnsure` (нет колонки → −1 / дописывает в конец и выравнивает строки), паритет, сканеры. Все существующие тесты — зелёные без правок ожиданий.
**Проверка на копии.** Стенд с `--ref=<до E2>`: вывод `snapshotState` идентичен байт-в-байт (формат не менялся); `e2-ast-eq.js` — 0.
**Проверка вживую.** Сайт: «Сегодня»/«Позиции»/«Акция» на всех портфелях — суммы и P&L совпадают со скриншотом до деплоя. Воркер: до деплоя сохранить `?action=bookcheck&dry=1&all=1`, после деплоя — сравнить (идентичны), `verify-worker`.
**Откат.** `git revert` + деплой сайта и воркера (прежний `WORKER_BUILD`). Данные не менялись.

### E4 — трёхстороннее слияние при конфликте

**Модель.** `SYNC_BASE` — канонические строки (`JSON.stringify` с сортировкой ключей) по **единицам слияния** последнего состояния, совпадавшего с облаком: ставится в `applyRemoteState(s)` (по `s`, до миграций) и после коммита push (по отправленному `snap`). Единицы:
- ключ верхнего уровня — единица, кроме:
- `data` → вкладка: `data/<tab>/meta` (всё, кроме `rows`) и строки по тикеру `data/<tab>/row/<TK>`; производные колонки `pl/plPct/value` (`RC`) в сравнении не участвуют — после слияния `recalcAllPF`. Если у вкладки различаются `headers` между сторонами — вкладка сравнивается целиком (одна единица);
- `posMeta` → `posMeta/<tab>`;
- `pfTrades`, `planRules`, `deskWatch.items` → множества по `id` (без `id` — ключ по канонической строке записи); порядок результата: порядок облака, изменённые — на месте, новые локальные — в конце, затем устойчивая сортировка там, где потребитель её предполагает (сессия проверяет `pfTaxLots`/журнал);
- `aiPort` — **вне слияния**: действует нынешнее правило push (торговое состояние — сервера, настройки — клиента);
- `rev`, `cv`, `schemaV` не сливаются (`schemaV` = max).

**Правило** `syncMerge3(base, local, remote)` (чистая, в app.js рядом с `syncRemoteDecision`): менял только клиент → клиент; только облако → облако; оба и одинаково → любое; оба по-разному → облако + единица в `conflicts`. Возвращает `{snap, conflicts, localUnits}`.

**Где применяется.**
1. `pushStateRun` при отклонении триггером: вместо `pullState()` — прочитать облако, `syncMerge3`, применить слитое (`applyMergedState`: как `applyRemoteState`, но `stateRev = remote.rev`, база = единицы облака), push слитого; до 3 попыток, дальше — прежнее поведение (облако побеждает + тост).
2. `syncFlushRemote(dirty)` и догон после сна/сигнал (E0) при несохранённых правках — слияние вместо простого применения, затем `schedulePush()`.
3. Тост — только если `conflicts` непуст: «⚠ Одновременная правка: <разделы> — оставлена версия облака». Без конфликтов — молча.

**Тесты (JSC, чистые).** Таблица случаев по каждому типу единицы (строка, вкладка целиком при разных `headers`, сделки: добавление/удаление/правка с обеих сторон, posMeta, deskWatch, aiPort не трогается); свойства на детерминированном ГПСЧ (200 прогонов): правки в непересекающихся единицах → обе в результате; `merge(b,x,x)=x`, `merge(b,b,r)=r`, `merge(b,l,b)=l`; повторное слияние идемпотентно. **Стенд:** режим `--merge-sim` на копии ledger — сценарии «клиент поменял qty, воркер — aiPort/таргеты», «оба поменяли одну строку», «клиент удалил сделку, облако добавило другую».
**Проверка вживую.** Две вкладки: разные портфели одновременно → обе правки в облаке, тоста нет; одна и та же позиция → тост с разделом; ноутбук «спит» (offline) → правка → online → правка сохранена; правка во время цикла AI-портфеля (▶) → обе записи на месте.
**Ревью.** Отдельный адверсарный проход по `syncMerge3` и точкам применения (Fable 5.1 · high) — до коммита.
**Откат.** `git revert` → снова «облако побеждает». Формат данных не менялся (`SYNC_BASE` — только память).

### E5 — AI-отчёты вне ledger (условно)

**План готов — `plans/ai-reports-e5.md`** (2026-09-12; порог превышен, решения: таблица, глубина истории как сейчас, `aiChat` остаётся в ledger). Исходный эскиз: таблица `ai_reports(user_id, kind, key, at, data)` с RLS «свои строки», ленивое чтение при открытии «AI-разборов»/AI-раздела; затрагивает воркер (`data[key].analysis`, `analysisHistory` — только запись, `pfAnalysisAt`) и клиент (`STOCK_AI_LOG`, `aiHistory`, `AI_CHAT`). Не начинать без замера.

## 5. Проверка на копии ledger — сводка

| Шаг | Команда стенда | Ожидание |
|---|---|---|
| E0 | `--ref=<HEAD до E0> --expect-add=cv` | I0: отличие только `cv` |
| E1 | `--ref=<до E1> --expect-drop=val,insider,aiReco,tgFull,tgMeta` | I1/I2 ✔, выигрыш I4 |
| E3 | `--ref=<до E3> --expect-drop=sim,aiDash,scnAlerts,tgAlerts,smaTf,data.*.count,data.*.btJournal,data.*.btConfig` | I0/I1/I2 ✔, нет полей вкладок |
| E2 | `--ref=<до E2>` | снапшот идентичен; `e2-ast-eq.js` = 0 |
| E4 | `--merge-sim` | все сценарии ✔ |

Копии — вне репозитория (`~/dash-ledger-copies/`), в репо не коммитить.

## 6. Деплой и порядок действий пользователя

| Шаг | SQL | Сайт | Воркер | После деплоя |
|---|---|---|---|---|
| E0 | замер + `backup` схема | да | нет | перезагрузить все устройства (PWA на телефоне тоже) |
| E1 | сверка → (слияние) → RPC; свежий бэкап | да | нет | перезагрузить устройства админа; через сутки SQL: у всех строк есть `cv` и нет `val…` |
| E3 | свежий бэкап | да | нет | SQL-замер размера |
| E2 | — | да | **да**, `verify-worker` | сравнить bookcheck dry до/после |
| E5a | бэкап e5 → `supabase-ai-reports.sql` | да | нет | перезагрузить все устройства; SQL-сверка сохранности (`ai-reports-e5.md` §8) |
| E5b | — | нет | **да**, `verify-worker` | `?action=pfanalyze` → строка `pfa`, ledger без `analysis` |
| E4 | — | да | нет | ручная проверка §4.E4 |
| конец E | удалить `backup.*` через 30 дней | — | — | — |

## 7. Риски

| Риск | Где | Мера |
|---|---|---|
| Ledger уже > 1024 КБ → realtime молча не работает | сейчас | E0 п.1 (замер) и п.5 (realtime как сигнал) — первым делом |
| Старый клиент админа перетирает `shared_analysis` целиком | E1 | перезагрузка устройств, `cv` в SQL, RPC-патч у нового клиента |
| Личная копия общих данных новее shared | E1 | SQL-сверка по `at` до деплоя |
| Кодмод заденет не-строку (`x[1]` кортежа) | E2 | белый список идентификаторов по графу + `e2-ast-eq.js` + сканер |
| Вкладка с нестандартным префиксом | E2 | I3 на реальной копии до кода; `rowSchemaOk` с тостом, без правки данных |
| Ошибка слияния портит данные | E4 | чистая функция + свойства + стенд + адверсарное ревью; при исчерпании попыток — прежняя политика; серверный бэкап |
| Бэкап-таблица видна через API | E0 | схема `backup`, не `public`; `revoke` |

## 8. Не делаем (и почему)

- **Строки → объекты в хранилище** (#3, рекомендация аудита). Цель «код не завязан на индексы и русские имена» достигается E2 без миграции формата; объектная схема потребовала бы shim в двух направлениях, правок воркера, бэкапа, триггера и периода двух форматов — риск потери данных без выигрыша для пользователя. Решение пользователя 2026-09-12.
- **Стабильный id вкладки** (#9). Ключ уже неизменяем (переименование меняет только `title`); смена ключей потребовала бы миграции `PF_TRADES.tab`, `POS_META`, `PLAN_RULES`, `user_access.tabs` и констант воркера.
- **Не хранить `r[5]` (тип), `r[11..13]` (P&L/стоимость).** Воркер читает `r[5]` во вселенной AI-портфеля; ячейки позиционного массива всё равно существуют — выигрыш в байтах ничтожен.
- **`DATA[AIP_KEY]` вне снапшота.** Зеркало строится из `AI_PORT` на клиенте, но хранит последние цены для показа до обновления; маленькое.
- **Перегенерация `data.js` в текущей схеме и удаление `migrateIndexV3`.** Для облака шаг — no-op; аккаунт, не входивший с до-v3 времён, без него сломался бы.
- **tests-quality#3 (асинхронный раннер клиента), #6 (CI), #7 (глобальная область).** Вся новая логика E — чистые синхронные функции (JSC); асинхронные обёртки тонкие. Стенд копии — node, вне `run.sh`. CI — отдельная маленькая задача (рекомендация аудита в силе). #7 закрывается ровно в части колонок (E2).

## 9. Решения пользователя (2026-09-12)

- **Колонки:** имена в коде (`RC`/`COLN`), формат хранения не меняется — не «строки → объекты».
- **Замороженные ключи** (`sim`, `aiDash`, `scnAlerts`, `tgAlerts`, `btJournal/btConfig`, `SMA_TF`): удалить с архивом в серверном бэкапе.
- **Слияние по полям:** включить в блок E (сессия E4).
- **AI-отчёты:** выносить только по итогам замера E0 (E5 — отдельный план).

## 10. Итоги сессий

_(заполняются в сессиях E0…E4: что сделано, отклонения от плана, числа тестов, результаты стенда и SQL)_

### Итоги E0 (2026-09-12, Opus 5 · high)

**Код (app.js).**
- `cv` = `CLIENT_BUILD` — `?v=` тега `app.js` (`document.currentScript`, запасной путь — `script[src^="app.js?"]`; без тега — `'dev'`), первый ключ `snapshotState`; `applyRemoteState` его не читает. Хэш — только `app.js`: снапшот/`applyRemoteState` живут там, правки формата в E1/E3 его меняют.
- Realtime ledger — `syncOnRealtime(p)`: есть `p.new.data` → `syncOnRemote` (как было), нет (лимит 1024 КБ, DELETE) → `syncOnSignal()`. Сверка: `select('rev:data->rev')` → `syncSignalDecision(remoteRev, stateRev, busy)` → `skip` / `defer` (`remoteStale`, повтор в `syncSettle` через `syncStaleCheck`, сброс в `syncReset`) / `pull`. Одна сверка в полёте (`sigRun`/`sigAgain`), смена аккаунта во время запроса — выход.
- Догон после сна: `syncResumeInit()` (в `startApp`, один раз за страницу) вешает `visibilitychange`(visible) и `online` → `syncResumeCheck()` (только `currentUser && syncReady`, вкладка не скрыта, `syncResumeDue(now,last)` — не чаще `SYNC_RESUME_MS` = 30 с; часы назад → можно).
- `shared_analysis`: обработчик вынесен в `sharedOnRealtime` — все четыре колонки объектами (`sharedPayloadFull`) → применить как раньше; иначе `loadSharedAnalysis()` + перерисовка; DELETE/пустой payload — ничего.

**Отклонения от плана.**
1. `pull` в сигнале — не `pullState()`, а чтение строки `select('data')` и **тот же `syncOnRemote`**: решение skip/defer/apply принимается заново по `syncBusy()` на момент ответа — правка, начатая во время чтения, уходит в `remotePending`/конфликт по обычным правилам, а не затирается `applyRemoteState` «из-под неё». `pullState` к тому же перечитывал бы `shared_analysis` на каждый сигнал.
2. Стенд: сверх I1–I4 — **I0** «снапшот ref → HEAD равен, кроме ожидаемого» (`--expect-drop` в ref есть/в HEAD нет, `--expect-add` появились; пути с `*`: `data.*.count` — нужно E3); `--loose` делает I0 справочным. `--bundle` — копия из `data.js` после `migrateState()+init()` (самопроверка без личных данных). В vm `init()` настоящий (`aiPlaybookEnsure`/`fixCompanyNames` меняют данные и в браузере), `renderAll/renderPF3/deskRender` заглушены, `Date` заморожен (один момент на обе версии). Скрипты берутся из `index.html` своей версии.
3. Заглушки окружения вынесены в `tests/env-stubs.js` без `ALL` (его задаёт раннер; стенд грузит настоящий `data.js`).

**Тесты.** app 1313 → 1353 (группа `sync signal (E0)`, 40 кейсов: таблица `syncSignalDecision`, маршрутизация `syncOnRealtime`, `remoteStale` в `syncSettle`/`syncReset`, `syncResumeDue`/`syncResumeCheck`, `sharedPayloadFull`/`sharedOnRealtime`, `cv` в снапшоте и игнор чужого `cv`; round-trip `cv` = `CLIENT_BUILD`), worker 239, async 46; `MIN_CASES_app` 1250 → 1320.
**Стенд на бандле:** `node tests/ledger-copy.js --bundle --expect-add=cv` → I0 ✔ (отличие только `cv`), I1 ✔ (9 вкладок, 463 строки), I2 ✔, I3 ✔ (все вкладки с префиксом Портфеля 3.0), I4 71 КБ (7 % лимита). Негатив: `--expect-drop=tgMeta` → ✘ «ожидали удаление»; `--ref=dc34c62 --loose` показывает удалённые в S7b-3 ключи.

**SQL — выполняет пользователь (Supabase → SQL Editor).** Замер — `octet_length` (байты UTF-8: кириллица — 2 байта, лимит realtime в байтах) рядом с `length` из §4.E0:
```sql
-- 1) строка целиком и кто писал последним (cv пусто = клиент до E0)
select user_id, length(data::text) as json_chars, octet_length(data::text) as json_bytes,
       data->>'rev' as rev, data->>'cv' as cv, updated_at
from public.ledger_state order by 3 desc;
-- 2) ключи верхнего уровня
select l.user_id, e.key, octet_length(e.value::text) as bytes
from public.ledger_state l, jsonb_each(l.data) e order by 3 desc limit 60;
-- 3) вкладки × поля вкладок
select l.user_id, t.key as tab, f.key as field, octet_length(f.value::text) as bytes
from public.ledger_state l, jsonb_each(l.data->'data') t, jsonb_each(t.value) f
where jsonb_typeof(t.value)='object' order by 4 desc limit 40;
-- 4) общая строка
select octet_length(val::text) val, octet_length(insider::text) insider, octet_length(aireco::text) aireco,
       octet_length(targets::text) targets
from public.shared_analysis where id='global';
-- 5) бэкап (R4) — схема backup не видна через PostgREST
create schema if not exists backup;
revoke all on schema backup from anon, authenticated;
create table backup.ledger_state_e0 as table public.ledger_state;
create table backup.shared_analysis_e0 as table public.shared_analysis;
```
**Шаблоны восстановления** (триггер `ledger_state_guard` сравнивает `rev` как numeric и отклоняет `new_rev <= old_rev` — поэтому `rev+1` от **текущего** значения; клиенты увидят новый rev по realtime/сигналу и применят):
```sql
-- ключ <KEY> одного пользователя из бэкапа
update public.ledger_state l
set data = jsonb_set(jsonb_set(l.data, '{<KEY>}', b.data->'<KEY>'), '{rev}', to_jsonb(coalesce((l.data->>'rev')::numeric,0) + 1)),
    updated_at = now()
from backup.ledger_state_e0 b
where l.user_id = b.user_id and l.user_id = '<USER_ID>' and b.data ? '<KEY>';
-- строка целиком
update public.ledger_state l
set data = jsonb_set(b.data, '{rev}', to_jsonb(coalesce((l.data->>'rev')::numeric,0) + 1)), updated_at = now()
from backup.ledger_state_e0 b
where l.user_id = b.user_id and l.user_id = '<USER_ID>';
```
**Копия для стенда** (консоль залогиненной страницы, свой ряд) → `~/dash-ledger-copies/owner-2026-09-12.json`:
`copy(JSON.stringify((await sb.from('ledger_state').select('data').eq('user_id',currentUser.id).maybeSingle()).data.data))`,
затем `node tests/ledger-copy.js ~/dash-ledger-copies/owner-2026-09-12.json --ref=<коммит до E0> --expect-add=cv`.

**Замер (2026-09-12).** `shared_analysis` (запрос 4, байты): val 128 218 · insider 102 793 · aireco 104 987 · targets 152 333 = **≈ 477 КБ, 47 % лимита realtime** — строка пока приходит целиком; при росте сверх 1024 КБ её подхватит `sharedOnRealtime` (перечитывание). Для E1: shared станет единственным источником этих данных, запись — патчем RPC; сама строка realtime-нагрузку не уменьшит (payload UPDATE — строка целиком). **Ledger (запросы 1–3, байты `octet_length(data::text)`):**

| user | байты | rev | cv | последняя запись | заметки |
|---|---|---|---|---|---|
| c13ee426 (владелец) | **1 305 839 (1275 КБ) — выше лимита realtime** | 7504 | — | 2026-09-12 05:42 (до push E0) | realtime для владельца **уже не нёс `data`** — E0 п.5 закрывает ровно это |
| ec2cb692 | 862 752 (843 КБ) | 3089 | — | 2026-09-04 | писал клиент до S7b-3 (есть `rankings`) |
| 7ce29019 | 728 078 (711 КБ) | 152 | — | 2026-06-16 | `insider` 267 КБ (старый), `rankings` |

Владелец по ключам (КБ): `data` 500 (в т.ч. `aiHistory` 🚀 135 + Anna 63 + Sergei 41 = 240, `analysisHistory` 🚀 35 + Anna 27 = 62, строки S&P 500 34 / Nasdaq 100 25 / OMXSPI 21) · `aiReco` 168 · `tgFull` 149 · `val` 125 · `insider` 100 · `smaTf` 36 · `tgMeta` 34 · `aiDash` 30 · `stockAiLog` 28 · `aiPort` 22 + `aiPortBak` 22 (копия) · `cycleOvr` 13 · `news` 8 · `pfTrades` 7 · `aiChat` 7 · `aiPlaybook` 6 · `planRules` 6 · `scnAlerts` 6 · `newsImpact` 4.

**Прогноз для владельца:** после E1 (−`aiReco/tgFull/val/insider/tgMeta` = −576 КБ) → **≈ 699 КБ**; после E3 (−`smaTf/aiDash/scnAlerts/…` ≈ −72 КБ) → **≈ 627 КБ**; из них AI (`aiHistory` + `analysisHistory` + `stockAiLog` + `aiChat`) ≈ 337 КБ = **54 %**. После E5 — **≈ 290 КБ**.

**Решение по порогу §4.E0 п.1:** строка ≥ 1 МБ → **E5 нужен**. После E1 и E3 оба критерия всё равно превышены (627 КБ > 600 КБ, AI 54 % > 50 %), поэтому Planning E5 — сразу после E1, как записано в пороге. До тех пор синк владельца держится на сигнале E0 (каждый push — ≈ 1,3 МБ upload, после E1 — ≈ 0,7 МБ).

**Новые факты для E3/E5:**
- `data.*.analysisHistory` (62 КБ) — **только запись**: воркер (`telegram-notify.js:2222`, последние 5 записей) пишет, никто не читает. Убрать можно только вместе с правкой воркера: он перестаёт писать + клиент чистит поле на каждый проход `migrateState` (R2) — кандидат в E5 (там и так деплой воркера) или E3 + деплой.
- `aiPortBak` — полная копия `aiPort` (22 КБ); вне блока E, мелочь.
- Стенд: `AI_TAB` дополнен `analysisHistory` (в плане было `analysis`; поле `analysis` тоже есть — пишет воркер).

**Сделано пользователем 2026-09-12:** push e9e2235 (Pages отдаёт `app.js?v=dfdd1e01`); бэкап `backup.ledger_state_e0`/`backup.shared_analysis_e0` создан; устройства перезагружены; **живая проверка §4.E0 пройдена** (две вкладки — правка приходит через сигнал; offline → online — догон без конфликта). **Урок деплоя:** первая открытая вкладка после push осталась на старом клиенте (`CLIENT_BUILD is not defined`, в SQL `cv` пуст и `updated_at` не менялся) — помогла жёсткая перезагрузка/сброс сервис-воркера. После деплоя шагов E1+ проверять на каждом устройстве `CLIENT_BUILD` в консоли и `cv` в SQL, прежде чем считать, что старых клиентов нет (особенно перед E1: старый клиент админа перетирает `shared_analysis` целиком).

**Стенд на реальной копии (2026-09-12):** копия владельца rev 7507, `cv dfdd1e01` (записал уже новый клиент), 16 вкладок → `~/dash-ledger-copies/owner-2026-09-12.json` (0600, вне репо). `node tests/ledger-copy.js ~/dash-ledger-copies/owner-2026-09-12.json --ref=e1105fa --expect-add=cv` → **I0 ✔** (отличие только `cv`), **I1 ✔** (16 вкладок, 573 строки, 32 сделки), **I2 ✔**, **I3 ✔ — все вкладки с префиксом Портфеля 3.0, нарушителей нет** (E2 можно начинать без решения о нестандартных вкладках), I4: компактный JSON 1190 КБ (SQL `octet_length(data::text)` = 1275 КБ — разница из-за пробелов jsonb::text) — **выше лимита в любом счёте**; AI 351 КБ = 30 % сейчас. Прогноз E1 в компактном счёте: −(aiReco 167 + tgFull 132 + val 112 + insider 90 + tgMeta 29) = −529 КБ → ≈ 661 КБ. Копия выгружается из консоли в два шага (в команде с `await` консольная `copy()` Chrome недоступна): `var __s=JSON.stringify((await sb.from('ledger_state').select('data').eq('user_id',currentUser.id).maybeSingle()).data.data)`, затем `copy(__s)`, затем `pbpaste > файл` — ничего не копируя между ними; скачивание через `a.click()` браузер молча блокирует.

**E0 закрыт 2026-09-12.** Дальше — E1 (новая сессия), затем Planning E5.

**Было за пользователем:** бэкап (на момент замера **не создан** — `to_regclass` = НЕТ), прогон стенда на реальной копии (I3 — вход в E2), деплой сайта (push) и живая проверка §4.E0 (две вкладки; offline 2 мин → правка в другой вкладке → online; ▶ AI-портфель при открытой странице).

### Итоги E1 (2026-09-12, Opus 5 · high)

**Код.**
- `snapshotState`/`applyRemoteState`/`SNAP_KEYS`: без `val/insider/aiReco/tgFull/tgMeta`; снапшот старого клиента с этими ключами новым клиентом игнорируется. `TG_META` удалён целиком (объявление + писатель в `pf3RefreshTargets`).
- `app.js` — слой общей аналитики: `sharedApply(row)` (чистая: перекрывает только непустыми колонками, дедуп по `updated_at` в `_sharedAt`, сброс `_valSecCache`), `loadSharedAnalysis(retry)` → `true`, если применено новое; ошибка — одна повторная попытка через `SHARED_RETRY_MS` = 3 с (сама перерисует). `pullState`: `if(await loadSharedAnalysis()) renderAll()` — первый экран без общих данных дорисовывается. `sharedOnRealtime` запоминает `updated_at` полной строки, путь «перечитать» перерисовывает только при изменении.
- Запись: `sharedPatch(col, patch)` → RPC `shared_analysis_patch`; нет функции (`PGRST202`/`42883`, `sharedRpcMissing`) → upsert **одной** колонки (память ∪ патч); результат `rpc|col|skip|off|err`. `sharedSave({col:patch,…})` — колонки параллельно, при ошибке один тост «⚠ Общие данные не сохранены в облако — повторите сбор». `pushSharedAnalysis` удалён.
- Сборщики шлют только тикеры своего прогона: `valUpdateAll` → `val` + `targets` (чистые `valEntry`, `tgFullEntry`, `valNotifyPatch` в app-3.js), `insiderUpdateAll` → `insider` (`insiderEntry` в app.js), `aiRecoRun` → `aireco` одного тикера (`scheduleSave` остался — `AI_SPEND` личный). У `valUpdateAll`/`insiderUpdateAll` `scheduleSave` убран — снапшот они больше не меняют.
- `supabase-shared-analysis.sql`: функция `shared_analysis_patch(p_col, p_patch)` — `security definer`, админ по `user_access.role`, белый список колонок, `coalesce(col,'{}') || patch` через `format('%I')`, `updated_at = now()`; `revoke … from public, anon`, `grant … to authenticated`. Файл идемпотентен.

**Отклонения от плана.**
1. **Гонка с realtime во время сбора** (не было в плане): полная строка чужого патча по realtime заменяет `VAL/INSIDER/TG_FULL` целиком, пока сбор ещё идёт (второе устройство админа) — собранное раньше в этом прогоне пропало бы из памяти и из «дёшево»-меток. Поэтому патч копится в локальном объекте (`pv/pt/pi`) и перед отправкой вливается обратно (`Object.assign`), а секторные медианы для меток берутся локально (`secMed`), не из `_valSecCache` (realtime сбрасывает его в `null` — все метки `notified` обнулились бы).
2. Дедуп по `updated_at` (`_sharedAt`) — не было в плане: без него «перерисовка при изменении» (п.5) была бы перерисовкой всегда.
3. Метка `at` у записей одного прогона сбора одна (раньше — `new Date()` на каждую запись) — разница в миллисекундах.

**Тесты.** app 1353 → 1384 (группа `shared analysis (E1)`, 36 кейсов: снапшот без общих ключей, снапшот старого клиента не трогает память и ключи не возвращаются, `sharedApply` (непустые/дедуп/null/массив), `sharedPatchClean`, `sharedRpcMissing`, `valEntry/tgFullEntry/insiderEntry/valNotifyPatch` (чистота), сканер «запись в `shared_analysis` — одно место, нет `pushSharedAnalysis`/upsert всей строки»; round-trip −5 ключей), worker 239, async 46; `MIN_CASES_app` 1320 → 1350. Асинхронные `sharedPatch/sharedSave/loadSharedAnalysis/pullState` проверены отдельным node-скриптом в vm (17 проверок: RPC, пустой патч, запасной путь пишет только `id+колонка+updated_at`, отказ прав/сеть → один тост, не-админ, повтор загрузки один раз, перерисовка только при новой версии) — в репо не добавлен (JSC не ждёт промисы, асинхронного раннера клиента нет — §8).
**Стенд на реальной копии:** `node tests/ledger-copy.js ~/dash-ledger-copies/owner-2026-09-12.json --ref=HEAD --expect-drop=val,insider,aiReco,tgFull,tgMeta` (HEAD = a8f74fd, до E1) → **I0 ✔** (отличие — только 5 ключей), **I1 ✔** (16 вкладок, 573 строки, 32 сделки), **I2 ✔**, I3 ✔; **I4: 1190 → 661 КБ** компактного JSON (65 % лимита realtime, прогноз E0 — 661) → realtime ledger владельца снова понесёт `data` (в `jsonb::text` ≈ 700 КБ). AI 53 % → порог E5 превышен, как и предсказано: **Planning E5 — следующим**.

**SQL — выполняет пользователь до push (Supabase → SQL Editor), по порядку.**
```sql
-- 1) свежий бэкап (R4)
create table backup.ledger_state_e1 as table public.ledger_state;
create table backup.shared_analysis_e1 as table public.shared_analysis;

-- 2) сверка (только чтение): личные копии общих данных против shared_analysis, по пользователям.
--    newer_in_personal > 0 у владельца — значит раньше pushSharedAnalysis молча падал.
with s as (select * from public.shared_analysis where id = 'global'),
pairs(lkey, scol) as (values ('val','val'), ('insider','insider'), ('aiReco','aireco'), ('tgFull','targets')),
e as (
  select l.user_id, p.lkey, p.scol, x.key as tk, x.value as v,
         (case p.scol when 'val' then s.val when 'insider' then s.insider when 'aireco' then s.aireco else s.targets end) -> x.key as sv
  from public.ledger_state l cross join pairs p cross join s
  cross join lateral jsonb_each(case when jsonb_typeof(l.data -> p.lkey) = 'object' then l.data -> p.lkey else '{}'::jsonb end) x
)
select user_id, lkey, count(*) as personal,
       count(*) filter (where sv is null) as missing_in_shared,
       count(*) filter (where sv is not null and (v->>'at') > (sv->>'at')) as newer_in_personal
from e group by 1, 2 order by 1, 2;

-- 3) ТОЛЬКО если у владельца (c13ee426…) newer_in_personal или missing_in_shared > 0: влить его более свежие
--    записи (по `at`, ISO-строки) и недостающие. Записи без `at` против общих не трогаем. Чужие ledger не берём:
--    у не-админов лишь старые копии общих данных (у 7ce29019 — июньский insider).
with s as (select * from public.shared_analysis where id = 'global'),
pairs(lkey, scol) as (values ('val','val'), ('insider','insider'), ('aiReco','aireco'), ('tgFull','targets')),
e as (
  select p.scol, x.key as tk, x.value as v,
         (case p.scol when 'val' then s.val when 'insider' then s.insider when 'aireco' then s.aireco else s.targets end) -> x.key as sv
  from public.ledger_state l cross join pairs p cross join s
  cross join lateral jsonb_each(case when jsonb_typeof(l.data -> p.lkey) = 'object' then l.data -> p.lkey else '{}'::jsonb end) x
  where l.user_id::text like 'c13ee426%'
),
agg as (
  select scol, jsonb_object_agg(tk, v) as patch from e
  where jsonb_typeof(v) = 'object' and (sv is null or (v->>'at') > (sv->>'at'))
  group by scol
)
update public.shared_analysis sa set
  val     = sa.val     || coalesce((select patch from agg where scol = 'val'),     '{}'::jsonb),
  insider = sa.insider || coalesce((select patch from agg where scol = 'insider'), '{}'::jsonb),
  aireco  = sa.aireco  || coalesce((select patch from agg where scol = 'aireco'),  '{}'::jsonb),
  targets = sa.targets || coalesce((select patch from agg where scol = 'targets'), '{}'::jsonb),
  updated_at = now()
where sa.id = 'global' and exists (select 1 from agg);

-- 4) RPC: выполнить supabase-shared-analysis.sql целиком (идемпотентен). Проверка, что функция есть
--    и чужим закрыта (из SQL Editor auth.uid() пуст → ожидаемая ошибка «admin only»):
select public.shared_analysis_patch('val', '{}'::jsonb);
```
**После SQL:** push → на **каждом** устройстве админа жёсткая перезагрузка (Cmd+Shift+R / сброс SW, PWA на телефоне тоже) и в консоли `CLIENT_BUILD` = `?v=` нового `app.js` — старый клиент админа при сборе перетирает `shared_analysis` целиком (R1).
**Живая проверка §4.E1:** админ «⋯ → 🧰 Сервис → 📐 Оценка» и «🔄 AI-Рекомендация» на «Акции» → в SQL `select updated_at, octet_length(val::text), octet_length(aireco::text) from shared_analysis` — обновилось; вторая вкладка получила без перезагрузки (realtime). Не-админ (тестовый аккаунт): после входа оценка/таргеты видны на первом экране. Через сутки:
```sql
select user_id, data->>'cv' as cv, data ?| array['val','insider','aiReco','tgFull','tgMeta'] as has_shared_keys,
       octet_length(data::text) as bytes, updated_at
from public.ledger_state order by updated_at desc;
```
Ожидание: у строк, записанных новым клиентом, `has_shared_keys = false`, владелец ≈ 700 КБ (< 1024 КБ). Строка со старым `cv`/без `cv` и `has_shared_keys = true` — где-то открыт старый клиент (безвредно для личных данных; опасно, только если это устройство админа, который запускает сбор).
**Откат.** `git revert` + push: старый клиент берёт общие данные из shared (как до E1), личные ключи вернутся при следующем push; RPC остаётся (безвредна). Данные не восстанавливаются.

### Итоги E3 (2026-09-12, Sonnet 5 · high)

**Код.**
- `snapshotState`/`applyRemoteState`/`SNAP_KEYS`: без `sim`/`aiDash`/`scnAlerts`/`tgAlerts`; глобалы `SIM`, `AI_DASH`, `SCN_ALERT_STATE`, `TG_ALERTS` удалены целиком (у каждого было ровно 3 упоминания — объявление/снапшот/чтение, перепроверено grep'ом по всем `*.js`, включая `telegram-notify.js` — воркер их не читал). `smaTf` больше не пишется в снапшот; `applyRemoteState` продолжает читать `s.smaTf` в `SMA_TF` — нужен одноразовому `migrateSmaDaily` для клиентов, ещё не прошедших `SCHEMA_V=3`. `SMA_TF[tk].w` (недельные SMA) не вычисляется в обоих местах записи (`pf3FetchPrices`, `pf3RefreshCardPrice`) — нигде не читался.
- `migrateDropReco` переименована в `migrateDropDead` (тот же вызов в `migrateState`, на каждый проход) и расширена: помимо колонки «Реком. скоринг» и `btSignals`/`btRuleAcc`, удаляет поля вкладок `btJournal`, `btConfig`, `count`.
- `count` (производный от `d.rows.length`, читателей не было): убраны все 7 присваиваний `d.count=…` (`app.js` ×2, `app-2.js` ×2, `app-3.js` ×1, `app-5.js` ×1, `desk.js` ×1) **и** 4 инициализатора `count:0`/`count:rows.length` в объектных литералах создания вкладки (`app.js` ×3, `app-3.js` ×1, не входили в счёт «7» плана, но тот же дохлый писатель) — поле нигде больше не пишется текущим кодом, `migrateDropDead` подчищает то, что могло прийти от старого клиента.
- Колонка «Реком. скоринг» в `headers` не тронута (её читает воркер).

**Тесты.** app 1384 → 1379 (SNAP_KEYS короче на 5 → 5 тестов `round-trip` ушли; группа `migrate v3 (S7b-3/E3)` расширена: фикстура несёт `btJournal`/`btConfig`/`count`, `migrateDropDead` их удаляет, число изменений 3 → 6; в `S7b-3 shell` добавлена проверка «`SIM`/`AI_DASH`/`SCN_ALERT_STATE`/`TG_ALERTS`/`migrateDropReco` больше не существуют»), worker 239/async 46 без изменений (воркера E3 не касается). `bash tests/run.sh` зелёный, `node --check` по всем правленым файлам — ок.
**Проверка на копии.** Не выполнена в этой сессии — нужна реальная копия ledger вне репозитория (`~/dash-ledger-copies/`); за пользователем: `node tests/ledger-copy.js <copy> --ref=<до E3> --expect-drop=sim,aiDash,scnAlerts,tgAlerts,smaTf,data.*.count,data.*.btJournal,data.*.btConfig`.
**Ждёт пользователя:** свежий бэкап `backup.ledger_state_e3` перед деплоем сайта (R4), деплой, SQL-замер размера строки после (ориентир из §10 «Итоги E0» — ≈ 627 КБ у владельца).
**Откат.** `git revert`; если понадобится вернуть удалённое поле — SQL по шаблону §4.E0 п.2 (`jsonb_set` ключа из бэкапа, `rev+1`).
Дальше — **E5a** (Opus · high, `plans/ai-reports-e5.md`).

### Итоги E5a (2026-09-12, Opus 5 · high)

См. `plans/ai-reports-e5.md` §13 «Итоги E5a» (SQL, клиент, отклонения, тесты, стенд, SQL-сверка и откат). Кратко: `supabase-ai-reports.sql`; слой `AI_REP` в app.js; перенос из ledger — только после подтверждённой вставки; `stockAiLog` — в снапшоте, только пока не перенесён; стенд `--ai-out` (I5); app 1465 тестов. Задеплоено и проверено 2026-09-14 (ledger владельца 635 → 278 КБ).

**Итоги E5b** — `plans/ai-reports-e5.md` §13 «Итоги E5b». Кратко: `analyzeOnePortfolio` пишет `pfa` через `aiReportInsert` в `ai_reports` вместо `writeChecked` в ledger; гейт — `max(aiReportLastAt, pfAnalysisAt ledger)` (второе — переходный фолбэк); worker 244 / async 50 тестов. E5 закрыт (код) — ждёт ручного деплоя воркера. Дальше — **E2** (`plans/ledger-model-e.md`).

### Итоги E2 (2026-09-14, Opus 5 · high)

**Код.**
- **Контракт (app.js, перед `migratePortfolio3`):** `PF_HEAD` (16 заголовков сида), `PF_HEAD_ALT` (имена Портфеля 2.0 на позициях 11/13/15), `RC` (`n,name,tk,country,sector,type,qty,price,ccy,buy,day,pl,plPct,value,xdag,pay`), `COLN` (18 id хвоста → русское имя), `COLN_RE` (SMA), `colOf(d,id)` (−1, как `indexOf`; `d` без `headers` → −1), `colEnsure(d,id)` (= `ensurePFCol` по id; неизвестный id — исключение, а не колонка `undefined`), `rowSchemaOk`/`rowSchemaBad` (Портфель 3.0 и v3-вкладки со строками), `rowSchemaCheck` — последний шаг `migrateState`: нарушитель → `console.error` на каждый проход + один тост админу за загрузку страницы (`_rowSchemaWarned`), данные не трогаются. Сид `migratePortfolio3` — `[...PF_HEAD, COLN.s50…, 'Целевая','Цель %','Действие']` (те же 22 заголовка — тест).
- **Хвост по id (п.2):** 20 мест — `smaIdx` (через `colOf`), `pf3TypeMetrics`, `migrateDropDead`, `pf3AiSnapshot`, `stockAiSnapshot`, `pf3EffTarget`, `pf3ScenarioHTML`, `secFromRow`, `sigRowPhase`, `sigRecoMap`, `pf3FetchPrices`, `pf3RefreshCardPrice`, `pf3RefreshTargets` (порядок `colEnsure` тот же — колонки дописываются в том же порядке), `deskRowNum(it,id)` (+ `deskBeta`, `deskAnaHTML`), `deskExecApply`. `ensurePFCol` зовёт только `colEnsure`.
- **Кодмод (п.3)** `plans/redesign-trading/e2-codemod.js`: 416 замен `N` → `RC.<id>` (клиент 372, воркер 44) — `r`/`row`/`src`/`r0` (все привязки в этих файлах — строки вкладок, граф в отчёте скрипта), `x` только как параметр колбэка `*.rows.<метод>(` (7; остальные 19 `x[N]` — кортежи), `o.r[N]`/`it.r[N]` (17), `(o.r||o)[N]` (2), `d.rows[ri][N]` (1), воркер `num(r, N)` (4). Не тронуты: `desk-gloss.js` (`it.rows` — таблицы словаря, `r[0]/r[1]` — ячейки описаний), `migrateIndexV3` (читает старую схему сида). Повторный прогон — 0 замен. Комментарии со старой нотацией (`r[6]/r[9]`, `r[13]`…) переписаны на `RC`.
- **Воркер:** копия `RC`/`COLN`/`COLN_RE`/`colOf` сразу после `exSymbol`; `aipUniverse`, `buildPortfolioSnapshot` — `colOf`; `TARGET_COL`/`TARGET_RECENT_COL` удалены → `colOf(pf,'tg'|'tg3')` + `COLN.tg/tg3` в `updateTargets`; `WORKER_BUILD = '2026-09-14e2-named-cols'`.

**Отклонения от плана.**
1. **I3 на реальной копии — префикс владельца не равен сиду.** Облачные вкладки владельца унаследовали заголовки Портфеля 2.0 (`«Прибыль kr»`, `«Стоимость kr»`, `«Выплата дивид.»` на 11/13/15 — сверено с `data.js` e6c929e), бандл/новые аккаунты — сид (`«Прибыль»`, `«Стоимость»`, `«Выплата»`). Та же колонка, другое имя; I3 стенда этого не видел (сравнивал с заголовками Портфеля 3.0 самой копии). Поэтому `rowSchemaOk` принимает на этих позициях и `PF_HEAD_ALT` — иначе каждый вход владельца давал бы тост. Данные не менялись; решение с пользователем не понадобилось (нарушителей нет ни в одном варианте).
2. **Матчеры выровнены:** SMA — `/sma.?50$/i`, `/sma.?100$/i`, `/sma.?200$/i` (форма воркера для s50, распространённая на все три; у клиента было без `$`), таргеты — точным именем `COLN.tg/tg3` вместо `/аналит/i`, `/таргет 3м/i` (так их и пишут `ensurePFCol`/`updateTargets`). На всех реальных раскладках (общая, S&P 500, Nasdaq 100, сид) старые матчеры и `colOf` дают одно и то же — это проверяет `parityRun` в обоих сьютах. «Аналит. Таргет» с заглавной был только в классическом индексе бандла до v3 — его пересобирает `migrateIndexV3`.
3. Сканеры — регулярками в JSC-сьютах (acorn там недоступен): формы `r|row|src|r0|.r|(o.r||o)|rows[i]` + `[0–15]`, поиск колонки `indexOf/findIndex/includes('<имя COLN/PF_HEAD>')`, `ensurePFCol(` вне `colEnsure`, матчеры `/sma.?N/`, `/аналит/`, `/таргет 3м/` вне `COLN_RE`, литеральные id в `colOf/colEnsure/deskRowNum` и `g('<id>')` — ключи `COLN`. Строковые имена колонок как **UI-подписи** (словарь i18n, `mult('P/E',…)`, справка) разрешены — сканер ловит только поиск колонки.
4. `tests/env-stubs.js`: `console.error/warn` — у JSC osascript их нет (урезанные фикстуры `migrateState` теперь печатают ошибку контракта).
5. `e2-ast-eq.js` сверяет по узлам верхнего уровня; `RC` клиента берётся из app.js (остальные файлы используют глобал), у воркера — своя копия; внутри разрешённых узлов печатает изменившиеся инструкции (LCS).

**Тесты.** app 1465 → 1507 (`row contract (E2)` — паритет, `colOf/colEnsure`, `rowSchemaOk/Bad`, бандл после `migrateState` без нарушителей и с прежним сидом, тост нарушителю один раз / не-админу нет, данные не тронуты; `row contract scanners (E2)`), worker 244 → 264 (паритет, `aipUniverse` на раскладке S&P 500, сканер), async 50; все прежние тесты — без правки ожиданий. `MIN_CASES_app` 1430 → 1490, `MIN_CASES_worker` 195 → 250. Общая фикстура `tests/fixtures-parity.js` подключена в `run-app.js` и `run-worker.js`.
**Доказательство:** `node plans/redesign-trading/e2-ast-eq.js --ref=583c8dc` → узлов равны 1230, разрешённых отличий 40 (только п.2 и новые объявления), неожиданных 0.
**Стенд:** копия владельца 2026-09-12 (rev 7507) и `--bundle`, `--ref=583c8dc` → **I0 ✔ байт-в-байт**, I1 ✔ (16 вкладок, 573 строки, 32 сделки), I2 ✔, I3 ✔ + новая строка «контракт RC (`rowSchemaOk` HEAD)» ✔ на обеих. **Свежая копия 2026-09-14** (rev 7531, cv `d677f110`, после E5a — 245 КБ, AI 3 %) `--ref=583c8dc` → I0 ✔ байт-в-байт, I1 ✔ (16 вкладок, 573 строки, 32 сделки), I2 ✔, I3 ✔ и «контракт RC» ✔ — нарушителей нет.

**За пользователем (по порядку).**
1. ~~**Свежая копия и I3**~~ — сделано 2026-09-14 (см. «Стенд» выше). Как выгружать (до деплоя; консоль залогиненной страницы, два шага): `var __s=JSON.stringify((await sb.from('ledger_state').select('data').eq('user_id',currentUser.id).maybeSingle()).data.data)`, затем `copy(__s)`, затем в терминале `pbpaste > ~/dash-ledger-copies/owner-2026-09-14.json && chmod 600 ~/dash-ledger-copies/owner-2026-09-14.json` → `node tests/ledger-copy.js ~/dash-ledger-copies/owner-2026-09-14.json --ref=583c8dc` — ждём I0 «байт-в-байт», I3 и «контракт RC» ✔.
2. ~~**SQL — раскладки всех пользователей**~~ — сделано 2026-09-14: у всех трёх строк (c13ee426 — 16 вкладок, 7ce29019 — 14, ec2cb692 — 14) все вкладки проверяются контрактом и проходят его, префикс везде — имена Портфеля 2.0 (вариант сида в облаке не встречается — только у будущих новых аккаунтов); в хвосте только `SMA 50/100/200`, «Аналит. таргет», «Таргет 3м», «Период SMA» (у части вкладок нет «Таргет 3м»/«Период SMA» — `colOf` даёт −1, как и старые матчеры). Итоговая проверка префикса — запрос с `ok` (обе строки-эталона PF_HEAD/PF_HEAD_ALT прямо в SQL). Первый запрос (для истории):
   ```sql
   select left(l.user_id::text,8) as usr, count(*) as tabs,
          (select string_agg(h, ' | ' order by i) from jsonb_array_elements_text(t.value->'headers') with ordinality x(h,i) where i<=16) as prefix,
          (select string_agg(h, ' | ' order by i) from jsonb_array_elements_text(t.value->'headers') with ordinality x(h,i) where i>16 and h ~* 'sma|аналит|таргет') as tail_matched
   from public.ledger_state l, jsonb_each(l.data->'data') t
   where jsonb_typeof(t.value)='object' and jsonb_typeof(t.value->'rows')='array'
   group by 1,3,4 order by 1,2 desc;
   ```
   Ожидание: `prefix` — один из двух вариантов (сид / Портфель 2.0), в `tail_matched` только `SMA 50 | SMA 100 | SMA 200 | Аналит. таргет | Период SMA | Таргет 3м` (в любом порядке). Иное — прислать строку: у неё поменяется результат `colOf`.
3. ~~**Воркер**~~ — задеплоен 2026-09-14, `?action=version` → `2026-09-14e2-named-cols`; bookcheck dry до (e5b, 11:43 UTC) и после (e2, 11:44 UTC) идентичен: `items` 29, `quoted` те же 13 символов в том же порядке, `missing`/`fires` пусты, `stateErr` null. Как проверяли: до деплоя воркера сохранить `?action=bookcheck&dry=1&all=1` (консоль сайта: `fetch(PRICE_PROXY+'?action=bookcheck&dry=1&all=1',{headers:{Authorization:'Bearer '+(await sb.auth.getSession()).data.session.access_token}}).then(r=>r.json())`), после деплоя — то же; `items` и `quoted` идентичны (`fires` зависит от живых цен). `?action=version` → `2026-09-14e2-named-cols`; `verify-worker`.
4. ~~Push и живая проверка~~ — запушено 2026-09-14 (132278d, CLIENT_BUILD `21c36cff`), живая проверка пройдена пользователем: суммы/P&L/«Акция» как до деплоя, ошибок контракта нет. **E2 закрыт 2026-09-14.** Что проверяли: жёсткая перезагрузка устройств → «Сегодня»/«Позиции»/«Акция» на всех портфелях — суммы и P&L как до деплоя; в консоли нет `E2: префикс заголовков…`.
**Откат.** `git revert` + деплой сайта и воркера (`WORKER_BUILD` предыдущий `2026-09-14e5b-ai-reports`). Данные не менялись.
Дальше — **E4** (Opus 5 · max + ревью слияния Fable 5.1 · high).

### Итоги E4 (2026-09-14, Opus 5 · max)

**Код (app.js, блок синка).**
- **`syncMerge3(base, local, remote, opts)`** — чистая (входы не мутирует, результат отвязан клонированием), рядом с очередью синка. Правило единицы — как в плане: менял только клиент → клиент; только облако → облако; оба одинаково → облако; оба по-разному → облако + единица в `conflicts`. Возвращает `{snap, conflicts, localUnits}`; единица — путь-массив (`['data', вкладка, 'row', тикер]`), `localUnits` непуст → слитое надо отправить. `rev` — облака, `cv` — свой; ключ, которого клиент не пишет (`val` старого клиента, `wid`, `smaTf`), — как у облака; обязательного ключа нет в облаке (писатель старше) — «облако его не меняло»; необязательный `stockAiLog` (`SYNC_OPT_KEYS`) отсутствует = пуст.
- **База `SYNC_BASE`** — JSON снапшота, последний раз совпадавшего с облаком: первой строкой `applyRemoteState(s, base)` (до миграций — глобалы дальше становятся объектами `s` и мутируют) и после коммита push (ровно отправленный JSON). `syncReset` её сбрасывает.
- **Точки применения:** `pushStateRun` — отказ триггера → чтение облака → `syncMergeApply` → push слитого, до `SYNC_MERGE_TRIES` = 3 слияний, дальше прежнее «облако побеждает» с тостом; `syncApplyRemote` (= `syncMergeApply` + `schedulePush()` при `'merge'`) — в `syncOnRemote` (realtime/сигнал E0), `syncFlushRemote` и `pullState` (повторное чтение с кнопок AI-портфеля). Своих правок не осталось → обычный `applyRemoteState(s)`; осталось → `applyRemoteState(слитое, облако, merged)` (база — облако, `stateRev` — rev облака) + пересчёт производных колонок строк `syncRecalcRows`. Исключение в слиянии → облако с прежним тостом. Нет базы (до первого чтения) → как до E4.
- **Тост** `syncMergeToast` — только при конфликтах: «⚠ Одновременная правка: <разделы> — оставлена версия облака», разделы `syncUnitLabel` («Портфель · MU», «Сделка MU», «План MU», «Стоп/цель MU», «Список покупок TSLA», «Портфель · кэш», настройки…), до трёх + «+N». Прежний `syncConflictToast` — только нет базы / слияния исчерпаны / слияние упало.

**Найдено по ходу — молчаливая потеря правки до E4 (баг проверки коммита).** `syncCommitted` сравнивал только rev вернувшейся строки. Два писателя с одного rev N пишут N+1; второму триггер возвращает OLD — **с тем же rev N+1**, и проигравший считает запись прошедшей: его правки нет в облаке, чужая запись (эхо с rev ≤ stateRev) им отбрасывается, а следующий его push затирает чужие правки (кроме защищённых триггером журнала и aiPort). Это основной случай гонки (две вкладки, устройство + воркер) и, вероятно, и есть «одна правка теряется» — причём **без тоста** (тост был только при rev облака строго больше нашего). Проверено на коде до E4 (временный worktree 3cd2dbd + симуляция): S1/S1b/S3/S8 падают — правка проигравшего потеряна, устройство разошлось с облаком. Исправление: push несёт **`data.wid`** (id записи, `syncWid()`), RETURNING — `rev:data->rev,wid:data->>wid`, коммит ⇔ rev И wid наши. Старые клиенты и воркер `wid` не читают (воркер копирует его вместе со снапшотом — на проверку клиента это не влияет). **У воркера та же дыра** (`writeCommitted` в telegram-notify.js сравнивает только rev): при гонке с клиентом запись aiPort в ledger может потеряться, `ai_state` её страхует (примирение `aiPortAuthoritative`), `updateTargets` — нет; фикс (`wid` в `writeRow`) требует деплоя воркера — вне E4, рекомендация ниже.
- **Записи с неизвестным исходом** (в полёте, ошибка сети после upsert, пустой RETURNING) — список `SYNC_UNACKED` [{rev, wid}]: запись добавляется до запроса, снимается ответом со строкой на этот push (по `wid`), коммит rev N снимает записи с rev ≤ N и не откатывает `stateRev`/базу, если облако уже новее. `syncAckResolve(s)` перед применением снапшота облака: у `s` **наш `wid`** и тот же rev — это наш коммит, база = `s` (по `wid`, не по содержимому: триггер может подменить журнал/aiPort в NEW); наш `wid` и rev больше — поверх нашей записи писал только воркер (`writeRow` копирует строку вместе с `wid`, клиенты ставят свой, старые пишут без `wid`): база = наш отправленный JSON, своя дельта уже в облаке; иначе запись с rev меньше, чем у `s`, — неизвестно, вошла ли она: счётчики этого слияния не складываются; тот же rev, чужой `wid` — наша запись не прошла; после — остаются только записи новее `s` (push в полёте, старое чтение). Догон после сна (`syncResumeCheck`) при несохранённом (`syncUnsaved`: запись с неизвестным исходом или снапшот ≠ базе) ставит push — облако могло не меняться, и сверка rev правку не подняла бы.

**Отклонения от плана §4.E4 (все — в сторону «правки разных единиц не теряются, ложных конфликтов нет»).**
1. **Мягкие поля** — их обновляют оба устройства сами, пользовательской правкой они не являются: ячейки строки `#`, тип, цена, день, P&L, %, стоимость (`RC`) и хвост `COLN` (SMA, уровни, таргеты, мультипликаторы, скоринг) — `deskQuotes` раз в 4 мин, открытая «Акция» раз в ~45 с, `pf3RefreshTargets` раз в сутки, `fixCompanyNames` (тип) на каждом `init`; поля вкладки `targetsAt`/`pfAnalysisAt`; `fx` (`refreshFX` при каждом входе); `hitAt` правил (`planCheck`); `order`/`updatedAt` идей; вкладка AI-портфеля (`aip`, строится из `aiPort`). Сливаются поштучно молча: своё — только если облако не меняло; конфликтом не бывают. По плану строка/«meta» вкладки — одна единица целиком: два открытых устройства давали бы ложные конфликты каждые несколько минут, а правка позиции проигрывала бы чужому обновлению цен. Вкладки вне контракта RC — без мягких колонок (всё твёрдое).
2. **Поля вкладки — каждое своя единица** (кэш, название, плечо, `fcastAI`…), а не одна «meta»: иначе дневной `targetsAt` одного устройства отменял бы кэш сделки другого. Сетка (заголовки + строки) — построчно (`syncGridAlign`), если заголовки сторон и базы совпадают на общей части с более длинными у сторон (контракт RC), а расхождение по длине — только мягкие колонки в хвосте (так дописывает `colEnsure`): строки короче дополняются '', строки базы длиннее обрезаются — правки разных строк при недописанной на одном устройстве колонке таргетов/уровней не конфликтуют; ячейки за пределами заголовков в сравнении не участвуют. Иначе (твёрдая/переименованная колонка) — одной единицей со сравнением без мягких колонок.
3. **Счётчики — облако + своя дельта от базы:** `cashFree` вкладки (две сделки в одном портфеле с двух устройств списывают оба раза) и `aiSpend`. При неизвестном исходе своего push (`SYNC_UNACKED`) — обычная единица. Только если база и обе стороны — числа (первая установка кэша — обычная единица).
4. `posMeta` — единица «вкладка/тикер» (по плану — вкладка: стоп по MU и стоп по AAPL с двух устройств конфликтовали бы); опустевшая вкладка уходит, как у `posMetaDel`.
5. `deskWatch.items` — по `key` (ключ дедупа `deskWatchNorm`), стороны сравниваются после нормализации; `lists` — единица.
6. `aiPort` — «вне слияния» уточнено базой: торговое состояние облака, настройки `AIPORT_CLIENT_KEYS` — свои, **только если клиент их менял** (иначе устаревшая копия откатывала бы настройку, изменённую на другом устройстве, и `startedAt` сброса). Список настроек — одна константа и для правила push.
7. Порядок списков (строки, сделки, правила, идеи, вкладки): облако не меняло свою последовательность ключей → свой порядок, иначе порядок облака; новые своих — в конце (при «облако меняло» — ровно как в плане). Нужно для тождества merge(b,l,b)=l. Потребители журнала сортируют по дате, затем по индексу (`pfTaxLots`, `deskRoundTrips`, `pfRecentTrades`, `pfTradesHTML`) — поэтому для сделок, **новых у обеих сторон** (внутридневной порядок с двух устройств неизвестен, а от него зависит средняя в K4), `syncTradeOrder` ставит новые после прежних по времени создания из id `tr<мс>_…` (устойчиво; id без времени — как есть).
8. Повторный `pullState` (кнопки ▶/♻️ AI-портфеля) идёт через `syncOnRemote` — по rev и с отложением при занятом синке, затем слиянием (раньше применял облако в обход очереди: несохранённая правка терялась молча, а старое чтение во время push откатывало rev/базу). Первое чтение — как раньше.
8а. Тост при конфликте строки (или всей сетки/вкладки) дополняется, если своя новая сделка по той же бумаге (вкладке) осталась в журнале (`notes`): «ваша сделка по X осталась в журнале — сверьте позицию и кэш» — сделка это строка + кэш + журнал + мета, а слияние по единицам может принять её частично.
9. Тесты асинхронного клиента — **новый сьют `sync-sim` в `run.sh`** (план §8 асинхронный раннер клиента не предусматривал: для E4 точки применения не «тонкие», и именно симуляция нашла баг проверки коммита).

**Тесты.** app 1507 → **1623**: `sync merge (E4): units` (каждый тип единицы: строки, мягкие ячейки, добавление/удаление, выравнивание сетки (в т.ч. база длиннее сторон, ячейки за заголовками) и сетка целиком, поля и кэш-счётчик (одинаковое значение складывается только при своих новых сделках вкладки у обеих сторон; отметка сделки при конфликте кэша), вкладки целиком, AI-вкладка, сделки (порядок по времени из id), `notes`, план с `hitAt` и нормализацией, posMeta, идеи, aiPort, счётчики, fx, schemaV, desk, чужой/обязательный/необязательный ключ, чистота, подписи тоста), `sync merge (E4): properties` (7 свойств × 200 сидов детерминированного ГПСЧ: правки непересекающихся единиц → обе в результате и без конфликтов; merge(b,x,x)=x (счётчики как единицы; со сложением — то же, но AI-расходы двух устройств оба учитываются); merge(b,b,r)=r без своих единиц; merge(b,l,b)=l; повторное слияние идемпотентно; после применения merge(r,m,r)=m; локально — 5000 сидов), `sync merge apply (E4)` (база/rev/push/тосты, эхо своей записи по rev+wid, два push с одним rev, воркер поверх нашей записи с потерянным ответом, запись новее снапшота, счётчики, нет базы, слияние упало, отложенный снапшот, `syncOnRemote`, `syncUnsaved`/переотправка в `syncResumeCheck`, тост с отметкой сделки, своя запись без JSON под воркером → без сложения, `syncUnsaved` без чужих ключей, быстрый путь без слияния, `syncOffline`, сканер «`applyRemoteState` зовут только `syncMergeApply`/`pushStateRun`»), `syncCommitted` +5 (`wid`); `sync queue` зафиксирована на «базы нет» (механика очереди). **sync-sim 223** (`tests/run-sync-sim.js`: S1 разные строки и план, S1b то же при строке > 1024 КБ (событие без data), S2 одна позиция, S3 воркер при стоящем таймере, S4 офлайн → онлайн, S5/S5b потерянный ответ (с эхом и без), S6 четыре отказа подряд → прежний тост, S7 котировки на обоих + сделка, S8 удаление/добавление сделок, S9 правка во время push + чужая запись, S10 потерянный ответ + пропавшее эхо + ещё правка, S11 правка другой строки во время такого push, S12 офлайн-правка при неизменном облаке, S13 `pullState` во время push, S14 сделка по одной бумаге на обоих, S15 воркер записал поверх нашей записи с потерянным ответом, пока своя правка ждёт push, S16 офлайн-сделка при облаке на +2 rev (кэш складывается, офлайн ни одного запроса), S17 две покупки на одну сумму + AI-прогон на каждом, S18 ответ потерян и запись не прошла, облако на +2 rev → кэш облака + тост «сверьте позицию», S19 три записи не дошли подряд (JSON только у последних двух), S20 чтение aiPort падает при сети → не пишем, повтор не чаще 5 с; в каждом — клиенты = облако, их rev и база = облако, очередь пуста). worker 264, worker-async 50. `MIN_CASES_app` 1490 → 1560, `MIN_CASES_sync_sim` = 100.
**Стенд.** `node tests/ledger-copy.js <copy> --merge-sim` (= сценарии sync-sim на копии как исходной строке облака): копия 2026-09-14 — **223/223**, копия 2026-09-12 (формат до E1/E5, 1,2 МБ, лишние ключи) — **223/223**. `--ref=HEAD` (3cd2dbd) на копии 2026-09-14 и бандле — **I0 байт-в-байт**, I1/I2 ✔: формат снапшота не менялся (`SYNC_BASE` — память, `wid` добавляется только в отправляемую запись).

**Ревью (Fable 5.1 · high, до коммита).** Первый проход — 8 находок, все закрыты: (1, HIGH) один слот `SYNC_UNACKED` затирался следующим push с тем же rev → после потерянного ответа кэш/aiSpend складывались дважды молча (X1/X2/X3/X8) → список записей и узнавание эха по rev+`wid`; (2) `syncAdd` складывал одинаковое значение с обеих сторон → `l===r` — облако; (3) `pullState` применял облако в обход очереди и мог откатить rev/базу при коммите в полёте → `syncOnRemote` + коммит не откатывает; (4, было и до E4) офлайн-правка не переотправлялась, если облако не менялось, — сценарий приёмки «сон → online» не выполнился бы → переотправка в `syncResumeCheck`; (5) сделка применяется по единицам частично → отметка в тосте; (6) внутридневной порядок новых сделок с двух устройств → по времени из id; (7) недописанная мягкая колонка превращала вкладку в одну единицу → `syncGridAlign`; (8) воркер: та же дыра равного rev в `writeCommitted` → рекомендация ниже. Сценарии ревьюера — S10–S14 sync-sim. **Второй проход** (Fable) оборвался на лимите модели; его скрипты против исправленного кода (`sim-x-current`, `sim-y`, `sim-y2`, `unit-align` в scratch сессии) прогнаны: X1–X9 и Y1–Y16 зелёные, найдены и закрыты два края выравнивания сетки (обе стороны короче базы на мягкую колонку; ячейки строки за пределами заголовков давали ложный конфликт) и расширена отметка сделки на конфликт всей сетки; оставшиеся «падения» — артефакты самих скриптов (A6/N1: переменная `T` перекрыла глобальную `T` i18n — имя вкладки в ожидании неверное; Y15: `remotePending` читается синхронно сразу после асинхронного `pullState()`). По ходу добавлено уточнение `syncAckResolve` «воркер поверх нашей записи» (S15).

**Независимая перепроверка исправлений (Opus 5 · high, 2026-09-14).** Все исправления обоих проходов подтверждены чтением кода и прогоном: `bash tests/run.sh` зелёный (app 1615, worker 264, worker-async 50, sync-sim 171), `--merge-sim` на копиях 14.09 и 12.09 — 171/171. Разобрано: триггер при отказе возвращает OLD, поэтому RETURNING — чужая строка, и коммит по rev+`wid` верен; наш `wid` в облаке бывает только после нашего коммита (воркер копирует, клиенты ставят свой, слитый снапшот `wid` не несёт) — ветка S15 корректна; автоматически пишутся только мягкие ячейки (имя/сектор дописываются лишь в пустые, одинаково на обоих); хвостовые «Целевая kr»/«Цель %»/«Действие»/«Период SMA» вне `COLN` — только ручные, твёрдые верно; формат id сделок совпадает с `syncTradeTs`; сброс AI-портфеля воркером не откатывается слиянием (`startedAt` клиент не менял). Свои сценарии на харнессе sync-sim (бандл и обе копии): офлайн-сделка на одном устройстве + сделка на другом, облако на +1 rev — кэш складывается; офлайн + правка кол-ва — без тоста; котировки на обоих раз в 4 с — пинг-понга нет, после затишья записей 0; удаление строки против обновления цен — без тоста; сброс AI-портфеля воркером при несохранённой стратегии; пять офлайн-push подряд → онлайн; новая вкладка против правки строки; дописанная `colEnsure` мягкая колонка против правки другой строки — всё сошлось.
**Найдено:** (1) офлайн-сделка теряет списание кэша, если за время офлайна облако ушло на 2+ rev (сделка другого устройства + воркер/котировки) и другое устройство тоже меняло кэш этого портфеля: офлайн-попытки push остаются в `SYNC_UNACKED` (supabase-js при сетевой ошибке отдаёт `{error}` — неотличимо от потерянного ответа) → `additive=false` → кэш — обычная единица, оба меняли → облако. Тост есть («Портфель · кэш — оставлена версия облака»), но без «сверьте позицию», а позиция и журнал сделки при этом сохранены. До E4 терялась вся правка — не регрессия. Исправление: не отправлять (и не заводить запись) при `navigator.onLine===false` — запрос не может уйти; отметку сделки в тосте распространить на конфликт `cashFree` вкладки с новой своей сделкой. (2) Вне E4, было и раньше: «fail-closed» чтения aiPort в `pushStateRun` не срабатывает — ошибка возвращается объектом, `aiPortReadOk` ставится и при провале; чинить вместе с (1) (иначе офлайн — повтор чтения каждые 800 мс).
**Второй независимый проход (агент Opus, тот же день; фаззер 1400 случайных прогонов: кэш уникальными дельтами, потерянные ответы, пропавший realtime, офлайн, воркер, старый клиент — всё сошлось, инвариант «все записи `SYNC_UNACKED` с rev = stateRev+1» не нарушался).** Подтвердил (1) и отметку в тосте. Дополнительно: (3) фейковый Supabase в `tests/run-sync-sim.js` хранит ссылку на тело upsert и сериализует его через `lat/2` — правка в первой половине полёта попадает в облако, хотя в `sent`/базе её нет (у настоящего supabase-js тело сериализуется при отправке); ложные срабатывания фаззера и риск спрятать дефект S9/S11 → `upsert(body){ st.body=JSON.parse(J(body)); … }` (проверено: sync-sim 171/171), в клиенте — `data:JSON.parse(sent)` вместо живого `snap`; (4) `syncAdd` при `l===r` молча теряет одну из двух равных независимых дельт — две покупки на одну сумму в одном портфеле, **`aiSpend.runs` +1 на каждом устройстве** (частый случай; `usd` при этом складывается) → для `aiSpend` складывать всегда, для кэша — складывать при разных новых сделках вкладки у обеих сторон; (5) `SYNC_UNACKED` хранит полный JSON за каждую неудачную попытку (~205 КБ на запись на реальном ledger) — (1) снимает основной источник; (6) `syncUnsaved` сравнивает и ключи, которые клиент не пишет (`smaTf`/`val` старого клиента) → один лишний push при возврате на вкладку; (7) `syncMerge3` на каждый входящий снапшот ~25 мс против 8 мс — быстрый путь «`!syncUnsaved()` → облако как есть».
**Исправлено (Opus 5 · high, та же сессия, до коммита).** (1) `pushStateRun` при `syncOffline()` (`navigator.onLine===false`) не шлёт и не заводит запись — догон на `online` (S16; без него S16 ловит лишние запросы офлайн); ошибка upsert с `status` 4xx снимает запись (транзакция не прошла), `status 0`/5xx — исход неизвестен. (2) Чтение aiPort: `if(e0) throw e0` — fail-closed работает; повтор — таймером `SYNC_RETRY_MS` = 5 с, не 800 мс (S20). (3) Отметка «ваша сделка по X осталась в журнале — сверьте позицию и кэш» — и при конфликте `cashFree` вкладки со своей новой сделкой (S18). Тело upsert — `JSON.parse(sent)`; фейковый Supabase копирует тело при вызове, режимы `flaky` (сеть есть, запросы падают) и `failPut` (запись не дошла), у ошибок `status: 0`. (4) `syncAdd(b,l,r,eqAdd)`: равные значения складываются, если `eqAdd` — AI-расходы всегда, кэш — если у обеих сторон свои новые сделки во вкладке (`ctx.bothTraded`; одна и та же сделка у обеих — не складывается) (S17). (5) JSON отправленного — только у последних `SYNC_UNACKED_JSON` = 2 записей; своя запись без JSON под воркером → `additive=false` (S19). (6) `syncDiffers(b)` сравнивает только ключи, которые пишет клиент (+`SYNC_OPT_KEYS`, без rev/cv/wid) — и в `syncUnsaved`. (7) `syncMergeApply`: своих правок нет (`syncDiffers(b)===false`) → `applyRemoteState(s)` без `syncMerge3`. Каждое исправление проверено мутацией (откат во временной копии → свой сценарий падает). `bash tests/run.sh` — app 1623, worker 264, worker-async 50, sync-sim 223; `--merge-sim` на копиях 14.09 и 12.09 — 223/223; `--ref=HEAD` на копии 14.09 — I0/I1/I2 ✔ (формат снапшота прежний).

**За пользователем (по порядку).**
1. Push → на **каждом** устройстве жёсткая перезагрузка (Cmd+Shift+R / сброс SW, PWA на телефоне тоже), в консоли `CLIENT_BUILD` = `?v=` нового `app.js`. Старый клиент по-прежнему теряет свою правку при равном rev и потом затирает чужие — пока он открыт, E4 защищает только новых.
2. SQL — пишет ли уже новый клиент (у его записей есть `wid`):
   ```sql
   select left(user_id::text,8) usr, data->>'rev' rev, data->>'cv' cv, data->>'wid' wid, updated_at
   from public.ledger_state order by updated_at desc;
   ```
3. **Живая проверка §4.E4** (две вкладки браузера; «одновременно» надёжнее всего через офлайн): (а) вкладка B → DevTools → Network → Offline → правка в B (стоп позиции X); в A — правка **другой** позиции Y; B → Online → через секунду-две правка B в облаке, у A обе правки, тоста нет; (б) то же, но обе правят **одну** позицию X по-разному → в B тост «⚠ Одновременная правка: … · X — оставлена версия облака», в B значение A; (в) ноутбук «спит» (вкладка offline несколько минут) → правка → online → сохранена; (г) правка во время цикла AI-портфеля (▶) → и правка, и сделки AI на месте. В консоли слияние видно как `E4: одновременная правка…` (только при конфликтах). Если после Online правка B не ушла сразу — догон срабатывает не чаще раза в 30 с (`SYNC_RESUME_MS`): переключитесь на другую вкладку и обратно или сделайте в B ещё одну правку (её push получит отказ триггера и сольётся).
**Откат.** `git revert` + push: снова «облако побеждает» и проверка коммита только по rev (то есть и молчаливая потеря при равном rev). Ключ `wid` остаётся в строке — старый код его не читает. Данные не восстанавливаются.
**Рекомендация (вне E4).** Воркер: `writeRow` — свой `wid` в данных и проверка `rows[0].data.wid` в `writeCommitted` (та же дыра равного rev; нужен деплой воркера, Sonnet 5 · medium).

# План: блок E — модель данных ledger (миграция с откатом)

Статус: **Planning завершён** (2026-09-12, решения пользователя приняты — §9). **E0 — код сделан 2026-09-12** (итоги §10; SQL-замер/бэкап/живая проверка — за пользователем). Код — в отдельных сессиях Implementation E0…E4 (CLAUDE.md, «вариант 1»), по одной сессии на шаг; коммит в конце сессии после зелёных `bash tests/run.sh`, push — по просьбе. Источник находок — `plans/audit-followup.md` §E и `plans/redesign-trading/all_findings.json` (`data-model-sync#2/3/4/9`, `tests-quality#3/6/7`).

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
| E5 | AI-отчёты в отдельную таблицу — **только если** E0 покажет > ~600 КБ или AI > 50 % | да | да | отдельный план | — |

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

Запускается отдельным Planning, **если** замер E0 превысит порог (§4.E0 п.1). Эскиз: таблица `ai_reports(user_id, kind, key, at, data)` с RLS «свои строки», ленивое чтение при открытии «AI-разборов»/AI-раздела; затрагивает воркер (`data[key].analysis`, `analysisHistory` — только запись, `pfAnalysisAt`) и клиент (`STOCK_AI_LOG`, `aiHistory`, `AI_CHAT`). Не начинать без замера.

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

**Ждёт пользователя:** бэкап (на 2026-09-12 **не создан** — `to_regclass` = НЕТ), прогон стенда на реальной копии (I3 — вход в E2), деплой сайта (push) и живая проверка §4.E0 (две вкладки; offline 2 мин → правка в другой вкладке → online; ▶ AI-портфель при открытой странице).

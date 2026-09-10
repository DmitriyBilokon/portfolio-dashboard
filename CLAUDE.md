# CLAUDE.md — портфельный дашборд (Nordic/SEK)

Личный инвестиционный дашборд: vanilla-JS сайт + Cloudflare Worker + Supabase. Язык общения и UI-текстов — русский (UI двуязычный через `RT(ru,en)` / `T(key)`).

## Архитектура
- **Без сборки.** `index.html` грузит по порядку: `data.js` → `signals.js` → `chart.js` → `app.js` → `app-2.js` → `app-3.js` → `app-4.js` → `app-5.js` → `desk.js` (классические `<script>`, общая глобальная область; функции + inline `onclick`). Затем — инлайновая регистрация SW. Стили: `styles.css` + `desk.css` (действует только под `html.desk`).
- `data.js` — вынесенный блоб `ALL` (сид данных). `app.js` разбит на 5 частей чисто механически — правь нужную часть, границы по top-level `}`.
- **Supabase**: одна строка `ledger_state` с JSON-блобом (`data`), `rev` = optimistic concurrency (инкрементить при записи). На клиенте только anon-ключ. Реалтайм-синк.
- **Cloudflare Worker** `telegram-notify.js`: live-цены/уровни (Yahoo), фундаментал (FMP→Yahoo), все AI-эндпоинты (Claude + web_search), Telegram-алерты, cron (AI-портфель + авто-анализ).

## Рабочий процесс (ВАЖНО)
- **Коммиты:** в сессиях Implementation редизайна (`plans/redesign-integration.md`, S1–S8) — один коммит в `main` в конце сессии после зелёных `bash tests/run.sh` (решение пользователя 2026-09-10). В остальных случаях коммитить только по явной просьбе. **Push — всегда только по явной просьбе.** Это solo-проект, коммиты идут в `main`.
- **Тесты:** `bash tests/run.sh` (osascript/JSC, конкатенирует `signals.js` + `chart.js` + `app*.js` + `desk.js` + фикстуры + кейсы; есть и worker-suite). Pre-commit hook (`.githooks/pre-commit`) сам гоняет тесты и **авто-проставляет `?v=<хэш>`** ассетам в `index.html` — вручную версии не трогать.
- Чистые функции покрывать тестами в `tests/cases-app.js` (`__eq`/`__ok`/`grp`).
- Синтаксис без браузера: per-file `new Function(s)` через JSC (для воркера заменить `export default` перед проверкой).

## Процесс разработки фич (ВАЖНО)
Каждую новую фичу ведём по этому циклу — не перескакивать этапы:
1. **Setup** — окружение/контекст: какую часть `app*.js`/воркера трогаем, нужные данные, ограничения.
2. **Planning** — сформулировать задачу, согласовать подход, **зафиксировать план в файл `plans/<фича>.md`** (scope, файлы, решения, тест-кейсы). После этого **СТОП**: не писать код, дождаться новой сессии.
3. **Implementation** — реализуется в **НОВОЙ сессии**, которую запускает пользователь (для контроля прогресса). Я не начинаю код в той же сессии, где планировал. Новая сессия читает `plans/<фича>.md` как источник правды.
4. **Automated tests** — покрыть чистые функции в `tests/cases-app.js`, прогнать `bash tests/run.sh` + per-file JSC-синтаксис (Skill `check-syntax`).
5. **Code review** — самопроверка диффа (агентно/вручную), сверка с доменными правилами и архитектурой.
6. **Manual testing** — проверка в реальном окружении (сайт/воркер), без моков. Для воркера — Skill `verify-worker` после ручного деплоя.
7. **Documentation** — описание изменений (коммит/PR из диффа), обновление CLAUDE.md/памяти при необходимости.

**Ключевое правило (вариант 1, по решению пользователя):** Planning и Implementation идут в РАЗНЫХ сессиях. Я останавливаюсь после фиксации плана; новую сессию для кода открывает пользователь. Многофазные фичи: после этапа 6 возвращаемся к этапу 3 (тоже новая сессия) для следующей фазы. Коммит/пуш — только по явной просьбе (см. ниже).

## Worker — деплой ВРУЧНУЮ
- `git push` НЕ деплоит воркер. Пользователь деплоит `telegram-notify.js` сам.
- При правках воркера: бампать `WORKER_BUILD`, после деплоя проверять `?action=version`.
- AI-эндпоинты требуют admin Bearer-токен (Supabase-сессия). **Я не могу запускать AI-Proto/reco/dashboard сам** — это делает пользователь в браузере. Свой анализ даю через web_search.
- Беречь лимиты: FMP free ~250 запросов/день; не добавлять тяжёлые fetch'и в ежечасный cron.

## Доменные правила
- Швеция: налог K4 — **genomsnittsmetoden** (средняя цена), НЕ FIFO.
- **Два betyg, не путать:** карточный `pf3Betyg` (полный, 5 столпов из загруженного фундаментала) vs `pf3RowBetyg` (lite по ROE/росту/оценке строки). AI-снапшоты грузят фундаментал всех позиций (`pf3LoadAllFundamentals`/`PF_FUND`) и используют ПОЛНЫЙ betyg как в карточке; lite — фолбэк. Для финансов/PE (напр. EQT) ROE-lite искажает оценку.
- v3-портфель: `renderPF3`/`pf3Summary`/`pf3DetailHTML`/`pf3ListHTML`/`pf3Items`; опц. колонки через `PF3_XDEF`.
- v2 (Svelte) удалён — v1 единственный продукт.
- **Позиция и план (S3 редизайна):** qty/средняя — в строке `r[6]/r[9]`; сторона/стоп/цель — в `POS_META[tab][TK]` (`stop0` = стоп входа, R считается от него). Мутаторы `posMetaSet`/`planMarkOpen` не сохраняют — вызывающий зовёт `scheduleSave()`. План v2 (`PLAN_RULES`): поля v1 не меняются, у «исполнено» источник правды `done`, `status` выводится `planRuleNorm`.
- **Сигналы v2 (S4 редизайна):** `signals.js` — чистый слой (глобал `SIG`, без DOM/глобалов приложения); **все пороги входа/выхода — только в `SIG.CFG`**. Пока идёт теневой режим, старые `pf3Criterion`/`pf3Reco`/`scenario*` не трогать — v2 показывается рядом (колонка «Вердикт v2», адаптер `sigSnapRow` в app-5.js); пороги меняются только по решениям в `plans/signals-calibration.md` (калибровка 2026-09-10 — §5–6); при смене правил бампать `SIG.VER` (пишется в журнал тени). `phase` = порт `pf3Criterion` 1:1 (тест паритета) — поправки к фазе (Q7) делаются в `snapshot`, не в `phase`. «Что-если» по порогам: `node plans/redesign-trading/whatif-signals.js [--ref=<git ref>] [--tg]`. История вердикта — `SIG.replay` (вход = бар смены вердикта на buy/short, выход — лестница `simTrade`); `evalAt` должен оставаться причинным (тест «evalAt causal»).
- **График (S5):** `chart.js` — `chartModel` (чистая, тесты) + `renderStockChart` (lightweight-charts 5.0.8 с jsdelivr + SRI в `loadLWC`); единственный вход из приложения — `stockChartDraw(state, boxId)` (карточка v3 и попап классических таблиц). API v5: `chart.addSeries(LWC.LineSeries, …)`, маркеры — `LWC.createSeriesMarkers`; `addLineSeries`/`setMarkers` v4 больше нет.
- **Trade Desk (S6):** `desk.js`/`desk.css` — новая оболочка за флагом `dash_desk` (`?desk=1|0`, кнопка 🖥 в шапке, класс `html.desk` ставит инлайн-скрипт `<head>`). При `deskActive()` хуки в начале `renderAll`/`renderPF3` зовут `deskRender()` — старые экраны не рисуются; классика временно — `deskClassic(tab, tk, sub)`. Экраны строят HTML из глобалов (`deskUniverse` + `sigSnapRow`, `bookPositions`, `PLAN_RULES`, `PF_TRADES`), события — делегированием по `data-a`/`data-c` на `#desk`. Сделка из desk — только через `deskExecApply` (позиция + кэш + `PF_TRADES` + `POS_META` + план). Чистое ядро (`deskScreenRows`, `deskTodayBuckets`, `deskPosAct`, `deskRoundTrips`, `pfApplyTradeSide`, `deskCapCheck`…) — в начале файла, покрыто тестами; в тестовом раннере `deskBoot()` вырезается. Шорт: `pfEquitySEK` считает его результатом, кэш при открытии меняется только на комиссию.
- **Список покупок (I1, `plans/reference-features-implementation.md`):** ключ снапшота `deskWatch` = `DESK_WATCH` (app.js) с защитой от старого клиента и бэкапом; нормализация/мутаторы `deskWatch*` — в app-5.js (не сохраняют — зови `scheduleSave()`); все пороги новых функций (зона, справедливая стоимость, уровень риска 1–5) — только в `DESK_IDEA_CFG`. Чистые `deskWatchZone`/`deskFairValue`/`deskRiskLevel`/`deskBuyDefault` — в ядре desk.js. «Как рассчитано» — `dkHow(id, html)` (закрыто, открытые помнит localStorage `dash_desk_det`). «Что если?» (I2): чистая `deskWhatIf` в ядре desk.js ничего не пишет (тест сравнивает состояние до/после) и считает только через `tradeFeeNative`/`FX`/`bookRiskState`+`deskCapCheck`/`bookPositions`/`pfApplyTradeSide`; настройки — `DESK.whatIf` (через `deskNorm`), пороги — `DESK_IDEA_CFG.whatIf`.
- **Шорт в журнале:** `PF_TRADES` с `short:true` (открытие `sell`, закрытие `buy`); `pfTaxLots` признаёт результат в дату откупа по средней выручке.
- **Новый ключ снапшота** = `snapshotState` + ветка в `applyRemoteState` + `SNAP_KEYS` в `tests/cases-app.js` (round-trip тест упадёт, если забыть). **Одноразовая миграция** = шаг `if(STATE_V<N)` в `migrateSchema` + `SCHEMA_V=N`; сиды не должны проверять «вкладки нет → создать» без гейта `STATE_V`.

## Память
Персистентная авто-память в `…/memory/` (`MEMORY.md` = индекс). Не дублировать сюда то, что уже там; обновлять заметки при изменениях.

# План: блок B — единое экранирование HTML + мягкий CSP (audit-followup#B, обновлено после S7b)

Статус: **Planning завершён** (2026-09-15, Sonnet 5 · medium). Источник: `plans/audit-followup.md` §B (решение Q3 — мягкий CSP сейчас, строгий `script-src` — после S7b; S7b завершена, но `unsafe-inline` пока сохраняем — 68 inline `onclick`, замена вне рамок этого блока). Код — в НОВОЙ сессии (CLAUDE.md, «вариант 1»); коммит в конце сессии после зелёных `bash tests/run.sh`, push — по просьбе.

## Setup — что изменилось с 2026-09-10

Старый текст плана (`audit-followup.md` §B) писан до S7b-3/4/5 (снесена классика, переписаны стили/тексты) — номера строк там устарели. Перепроверено на текущем коде:

- **Локальных `esc`/`E`-алиасов — 7, не 6**: `app.js:1318`, `app.js:2925` (алиас `E`, новый — не было в старом аудите), `app.js:3125` (**падает на не-строке** — `s.replace(...)` без `String()`), `app.js:3190` (неполное экранирование — нет `>`/кавычек), `app-2.js:538` (это `escJs` — эскейп для JS-строки внутри `onclick='…'`, семантика верная, просто дублирует то, что уже есть в `app-2.js` под другим именем), `app-5.js:479`, `chart.js:288`. Общие уже есть: `escHtml` (`app.js:1250`), `dkEsc` (`desk.js:398`, = `escHtml` под другим именем — используется только в desk.js), `safeUrl` (`app.js:1251`).
- **Имена компаний из Yahoo (`?profile=` → `r[RC.name]`)** по-прежнему пишутся в снапшот как есть (`app-2.js:404` `pf3FillProfile`) и читаются во многих местах без экранирования на выводе — подтверждено `grep`: 39 интерполяций `${…name|title|note|publisher…}` без `dkEsc`/`escHtml`/`esc(` в `app.js`, `app-2.js`, `app-3.js`, `app-4.js`, `app-5.js`, `desk.js`. Часть — ложные срабатывания (внутренние константы: `PFCMP_SHORT[i.name]` — фиксированный список секторов; FAQ `p.name` — свои строки), часть — реальный риск:
  - `app-2.js` (диверсификация/позиции/сравнение портфелей): `x.name`/`e.name`/`top1.name`/`p.name` — имена бумаг из `r[RC.name]`.
  - `app.js:3288/3297/3322` — `a.name`/`w.name` в AI-предложении (`proposal.actions[].name`/`watchlist[].name`) — текст от модели, но модель может процитировать поле снапшота, которое несёт имя из Yahoo.
  - **Новое сверх старого аудита (S3/I1, пользовательский ввод, не было в исходном B):** `desk.js:2527-2529` — `w.buyNote`/`w.thesis.title` (список покупок `deskWatch`, поля вводит пользователь через `txt()`-хелпер формы) и `app-5.js:288` — `rule.note` (заметка правила плана, тоже пользовательский текст). Проверить отдельно: (а) `txt()`-хелпер в desk.js — строит `<input value="…">`, нужно смотреть, экранирует ли атрибут (если нет — это инъекция через `"` в значении, más опасно, чем innerHTML-текст); (б) `app-5.js:288` `rule.note` уходит в `planNotify(...)` — это Web Notification API (`new Notification(title, {body})`), текст рендерится как plain text браузером, НЕ innerHTML — скорее всего не риск, но подтвердить при инвентаризации, не выключать из списка нежданно.
- **CSP / внешние хосты (`grep` по `https://` в клиенте):** `fvrebkwczqmeorytujbn.supabase.co` (Supabase), `telegram-notify-abc.dmitriy-bilokon.workers.dev` (воркер), `api.frankfurter.dev` + `open.er-api.com` (FX), `cdn.jsdelivr.net` (lightweight-charts), `fonts.googleapis.com`/`fonts.gstatic.com` (Golos Text/JetBrains Mono), `images.financialmodelingprep.com` + `assets.parqet.com` (логотипы бумаг, только `<img src>` — покрываются `img-src https:`, в `connect-src` не нужны); `finnhub.io` в клиенте НЕ фигурирует (инсайдеры идут через воркер, не напрямую) — не добавлять в `connect-src`. Список короче, чем предполагал старый план (не было `assets.parqet.com`, `images.financialmodelingprep.com`; был излишний `finnhub.io`).
- **Inline `onclick` — 68**, не 148 (S7b-3 снесла классику вместе с частью обработчиков) — `unsafe-inline` для `script-src` всё ещё обязателен, но объём переписывать на делегирование (если когда-нибудь займёмся строгим CSP) вдвое меньше, чем думали.

## Сделать (Implementation-сессия)

1. **Инвентаризация** (в начале сессии, не сейчас): `grep -noE '\$\{[^}]*\.(name|title|note|publisher|thesis)[^}]*\}'` по `app*.js`/`desk*.js`/`chart.js`, вычеркнуть ложные срабатывания (внутренние константы/свои строки — FAQ, `PFCMP_SHORT`), зафиксировать итоговый список мест в итогах сессии. Отдельно проверить `txt()`-хелпер desk.js (атрибут `value`) и `planNotify` (Notification API, вероятно не risk) — не тащить их в список вслепую.
2. Все HTML-локальные `esc`/`E` → `escHtml` (кавычки тоже); `app.js:3125` — падение на не-строке уходит само (внутри `String()` у `escHtml`). `app-2.js:538` переименовать в `escJs` и оставить как есть (правильная семантика для `onclick='…'`) — `desk.js` уже на `dkEsc` (= `escHtml`), не трогать (просто одна функция под двумя именами — не сливать ради синхронного `run.sh`, риска нет).
3. `pf3FillProfile` (app-2.js) — имя из Yahoo хранить как есть в `r[RC.name]` (не портить данные экранированием на записи); экранировать **на каждом выводе** из п.1.
4. Мягкий CSP через `<meta http-equiv="Content-Security-Policy">` в `index.html`:
   `object-src 'none'; base-uri 'self'; img-src 'self' data: https:; connect-src 'self' https://fvrebkwczqmeorytujbn.supabase.co https://telegram-notify-abc.dmitriy-bilokon.workers.dev https://api.frankfurter.dev https://open.er-api.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`.
   `script-src` держит `'unsafe-inline'` (68 обработчиков `onclick`, переписывать — отдельная задача вне блока B); `frame-ancestors` в `<meta>` не действует — отметить в комментарии рядом, что для этого нужен заголовок хостинга (GitHub Pages его не даёт).

## Тесты

- `escHtml`/`escJs` на кавычках, `<script>`, не-строках (`null`/`undefined`/число).
- Снапшот-тест: имя вида `<img onerror=alert(1)>` в `r[RC.name]` → в HTML списка/карточки/диверсификации/сравнения/watchlist-заметки/плана нет тега (по каждому из мест из п.1 итоговой инвентаризации).
- Сканер: не осталось локальных `esc=s=>` кроме `escJs` в `app-2.js` (или её нового места, если переименуют).
- Живая проверка: headless Chrome, все 5 экранов Trade Desk без ошибок CSP в консоли (карточка бумаги, список покупок, план, сравнение, AI-Dashboard); подделанное имя бумаги в тестовом портфеле не исполняется как HTML нигде в списке из п.1.

## Откат

`git revert`; CSP-мета и `escHtml` не меняют формат данных — откат безопасен, деплоя воркера не требует.

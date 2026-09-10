# План: Лондонская биржа (цены в пенсах) — Antofagasta в Портфеле 3.0

Статус: **Реализовано** (2026-09-10, `WORKER_BUILD 2026-09-10b-lse-pence`), тесты зелёные. Ждёт: деплой воркера → проверка вживую (§ ниже) → добавление Antofagasta (п. 9). Дивиденды проверены вживую: Yahoo отдаёт их для LSE в фунтах (ANTO.L `divRate 0.58`, `divYield 0.0145` при цене ≈ 37.7; ULVR.L 1.65 / 0.0357 при ≈ 46) — в белый список не вошли.

## Проблема (проверено на живом воркере 2026-09-10)

Yahoo котирует акции LSE (`.L`) в **пенсах** (`meta.currency = 'GBp'`), а Avanza и приложение считают в фунтах:
`?symbols=ANTO.L&lite=1` → `price 3771, sma50 3798, support 3364`; `?history=ANTO.L` → свечи ~3700–4000. На Avanza — 37,77 GBP. Позиция в GBP с ценой из Yahoo показала бы ×100 к стоимости и ≈ +10 000 % прибыли.

Ещё три пробела на пути GBP:
- `exSymbol` (клиент `app.js:1769` и воркер) не знает GBP: `ANTO` + GBP → `ANTO` (US-символ, чужая бумага или пусто). Нужен суффикс `.L`.
- Живые курсы клиента: `FX_CCYS = ['USD','EUR','NOK','DKK']` — GBP остаётся статичным 12.6 (сейчас ≈ 13.1, по снимку Avanza 3 952 kr / (8 × 37,77) = 13.08). Воркер: в `FX_DEFAULT` GBP нет → без `snap.fx` стоимость GBP-позиций × 1.
- Форма добавления бумаги (`app-2.js:1112`) не предлагает GBP, у `pf3Add` нет флага 🇬🇧.

Клиент сам к Yahoo не ходит — все цены идут через воркер, поэтому **нормализуем в воркере, в двух точках входа**.

## Решение

### Воркер (`telegram-notify.js`)
1. **Чистые хелперы** (тесты):
   - `PENCE_CCY = { GBp: 'GBP', GBX: 'GBP' }` (ZAc/ILA не трогаем — таких бумаг нет);
   - `yChartNorm(res)` — если `meta.currency` в `PENCE_CCY`: делит на 100 `meta.regularMarketPrice/chartPreviousClose/previousClose/regularMarketDayHigh/regularMarketDayLow/fiftyTwoWeekHigh/fiftyTwoWeekLow`, `indicators.quote[0].open/high/low/close` (null-безопасно), `indicators.adjclose[0].adjclose`; объём не трогает; ставит `meta.currency = 'GBP'`, `meta.pence = true`. Идемпотентна (по `meta.pence`).
   - `yQsNorm(sym, res)` — масштабирует **белый список** ценовых полей quoteSummary (`{raw, fmt}` → `raw/100`, `fmt` убрать): `price.{regularMarketPrice, regularMarketOpen, regularMarketDayHigh, regularMarketDayLow, regularMarketPreviousClose, regularMarketChange, preMarketPrice, preMarketChange, postMarketPrice, postMarketChange}`, `summaryDetail.{previousClose, open, dayLow, dayHigh, regularMarketPreviousClose, regularMarketOpen, regularMarketDayLow, regularMarketDayHigh, fiftyTwoWeekLow, fiftyTwoWeekHigh, fiftyDayAverage, twoHundredDayAverage, bid, ask}`, `financialData.{currentPrice, targetHighPrice, targetLowPrice, targetMeanPrice, targetMedianPrice}`. Проценты, мультипликаторы, выручка/EPS (`financialCurrency`) — **не трогать**. Признак пенсов: `price.currency || summaryDetail.currency` из ответа; если модуля с валютой нет (например, только `financialData`) — по символу `/\.L$/i`. Риск: `.L`-инструменты в USD/GBP (часть ETF) — при наличии валюты в ответе решает она; отметить в комментарии.
   - **Дивиденды** (`summaryDetail.dividendRate/trailingAnnualDividendRate`, `calendarEvents`): в каких единицах Yahoo отдаёт их для LSE — **проверить вживую первым шагом сессии** (с моего IP Yahoo → 429: через WebFetch страницы Yahoo ANTO.L или через живой воркер `?calendar=ANTO.L`, сверить с дивидендом Antofagasta в отчётах). Если в пенсах — добавить в белый список; если в GBP — не трогать.
2. Вызвать `yChartNorm` в `yChart` **до** `memo` (в кэше лежит уже нормализованное), `yQsNorm` — в `yQuoteSummary` до `memo`. Все потребители (yahoo, yahooLite, weekly SMA, уровни, `dailyHistory`/`?history=`, `liveMarkets`, bookcheck, AI-снапшоты, таргеты Yahoo, профиль) получают фунты без правок.
3. `exSymbol`: `GBP: t + '.L'` (как `.ST`/`.OL`). `FX_DEFAULT.GBP = 12.6` (как у клиента).
4. `WORKER_BUILD` бамп (`…-lse-pence`); ключ кэша `?financials=` уже содержит build. Edge-кэш `?history=` живёт 10 мин (и на `*.workers.dev` не работает) — отдельный сброс не нужен.

### Клиент
5. `exSymbol` в `app.js`: `case 'GBP': return t + '.L'` (паритет с воркером).
6. `FX_CCYS` + `'GBP'` — живой курс из frankfurter.dev (GBP есть) и резерва open.er-api.com (есть).
7. Форма добавления (`app-2.js:1112`): `<option>GBP</option>`; флаг `GBP:'🇬🇧'` в `pf3Add`. Проверить выбор валюты в покупке из Trade Desk (`deskExec…`) — если там свой список, добавить GBP.
8. Комиссии GBP уже есть (`COURTAGE_MIN.GBP`, stamp duty 0,5 % на покупку) — не трогать.

### Данные
9. После деплоя — добавить Antofagasta в Портфель 3.0 консольным скриптом (как синхронизация от 2026-09-10): тикер `ANTO`, GBP, 8 × 36,41. Ожидаемо: цена ≈ 37,7 GBP, стоимость ≈ 3 950 kr, прибыль ≈ +5 %.

## Тесты
- worker-suite: `yChartNorm` (GBp → /100 для цен, объём цел, `null` в рядах, идемпотентность, USD/GBP не трогает); `yQsNorm` (белый список, `{raw,fmt}`, проценты не трогает, валюта из ответа важнее суффикса, `.L` без валюты → пенсы, не-`.L` без валюты → не трогать); `exSymbol('ANTO','GBP') === 'ANTO.L'`, `'ANTO.L'` без изменений.
- app-suite: паритет `exSymbol` GBP; `FX_CCYS` содержит GBP.
- node-сьют (`run-worker-async.js`): мок Yahoo chart с `currency:'GBp'` → `yahooLite` отдаёт 37.71 и SMA/уровни в фунтах; `?history=` → `c` в фунтах; quoteSummary `financialData` у `.L` → таргет в фунтах.

## Проверка вживую (после деплоя, `verify-worker`)
- `?symbols=ANTO.L&lite=1` → `price` ≈ 37,7; `?symbols=ANTO.L` → то же + SMA недельные; `?history=ANTO.L&range=1mo` → `c` ≈ 37–40.
- В приложении: карточка Antofagasta (график, уровни, «Аналитики и оценка» — таргет в фунтах), строка портфеля ≈ 3 950 kr.
- Регрессия: `?symbols=MU,VOLV-B.ST` — цены как раньше.

## Не входит
- Прочие «копеечные» валюты (ZAc, ILA), LSE-опционы, пре/пост-рынок для LSE.

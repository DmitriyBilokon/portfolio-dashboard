---
name: verify-worker
description: Проверить, что задеплоенный Cloudflare Worker (telegram-notify.js) соответствует версии в исходнике — дёргает ?action=version и сверяет с константой WORKER_BUILD. Использовать после правок воркера и после ручного деплоя пользователем. Я НЕ деплою воркер сам (git push не деплоит) — только проверяю, что live-версия совпадает, и напоминаю забампать WORKER_BUILD. Триггеры: «задеплоен ли воркер», «проверь версию воркера», «check worker version», после правок telegram-notify.js.
---

# verify-worker

Сверяет **задеплоенную** версию Cloudflare Worker'а с тем, что в коде: HTTP-запрос `?action=version` (отдаёт первой строкой `worker-build <id>`) против константы `WORKER_BUILD` в [telegram-notify.js](../../../telegram-notify.js).

## Контекст (ВАЖНО, из CLAUDE.md)
- **`git push` НЕ деплоит воркер.** `telegram-notify.js` пользователь деплоит вручную.
- Я **не могу** деплоить или запускать AI-эндпоинты сам — этот Skill только **проверяет** live-состояние.
- При правках воркера: забампать `WORKER_BUILD`, после деплоя — проверить `?action=version`.

## Когда использовать
- После правок `telegram-notify.js` — убедиться, что `WORKER_BUILD` забамплен (иначе live и код «совпадут» по старому id и ты не заметишь, что деплой не нужен/нужен).
- После того как пользователь сказал, что задеплоил — подтвердить, что live-версия = версии в коде.
- Этап «Manual testing» процесса для любой фичи, затрагивающей воркер.

## Как запускать

```bash
bash .claude/skills/verify-worker/verify-worker.sh
```

URL по умолчанию — продакшн-воркер из `app.js` (`PRICE_PROXY`). Переопределить можно через env:

```bash
WORKER_URL="https://telegram-notify-abc.dmitriy-bilokon.workers.dev" bash .claude/skills/verify-worker/verify-worker.sh
```

## Что ожидать
- Печатает обе версии: из исходника и live.
- Exit `0` + `✅ Совпадает` — задеплоена текущая версия кода.
- Exit `2` + `⚠️ Расхождение` — live ≠ код. Типичные причины:
  - правил воркер, но **ещё не задеплоил** → задеплоить вручную;
  - правил воркер, но **не забампал `WORKER_BUILD`** → сначала бампнуть, потом деплой.
- Exit `1` — запрос не удался (сеть / воркер недоступен).

## Деталь
`?action=version` обрабатывается в начале `fetch` ([telegram-notify.js](../../../telegram-notify.js), ветка `action === 'version'`) и **не требует** admin Bearer — поэтому проверка работает без токена.

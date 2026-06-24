#!/usr/bin/env bash
# Сверяет задеплоенный Cloudflare Worker с версией в исходнике.
# git push НЕ деплоит воркер — деплой ручной (пользователь). Этот скрипт только ПРОВЕРЯЕТ live-версию.
# ?action=version отдаёт первой строкой `worker-build <id>`; сверяем с WORKER_BUILD в telegram-notify.js.
# Запуск: bash .claude/skills/verify-worker/verify-worker.sh
# Выход 0 — совпадает; 2 — расхождение; 1 — запрос не удался.
set -uo pipefail
cd "$(dirname "$0")/../../.."   # корень репо

WORKER_URL="${WORKER_URL:-https://telegram-notify-abc.dmitriy-bilokon.workers.dev}"

src_build=$(grep -oE "WORKER_BUILD = '[^']+'" telegram-notify.js | sed -E "s/.*'(.*)'/\1/")
echo "Источник  (telegram-notify.js): WORKER_BUILD = ${src_build:-<не найден>}"

resp=$(curl -fsS --max-time 15 "$WORKER_URL/?action=version" 2>&1) || {
  echo "❌ Запрос к воркеру не удался: $resp"
  echo "   URL: $WORKER_URL/?action=version"
  exit 1
}

live_build=$(printf '%s' "$resp" | head -1 | sed -E 's/^worker-build +//')
echo "Задеплоено (?action=version):  worker-build = $live_build"
echo

if [ -n "$src_build" ] && [ "$src_build" = "$live_build" ]; then
  echo "✅ Совпадает — задеплоена текущая версия кода."
  exit 0
fi

echo "⚠️  Расхождение: в коде '$src_build', задеплоено '$live_build'."
echo "   • Правил воркер, но не задеплоил → задеплой telegram-notify.js вручную (git push НЕ деплоит)."
echo "   • Правил воркер, но не менял WORKER_BUILD → сначала забампай константу, потом деплой."
exit 2

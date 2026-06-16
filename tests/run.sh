#!/usr/bin/env bash
# Регрессионные функциональные тесты дашборда.
# Гоняют РЕАЛЬНЫЕ функции из app.js и telegram-notify.js под заглушками
# окружения через osascript (JavaScriptCore). Запуск: bash tests/run.sh
# Выход 0 — все прошли; 1 — есть падения. Запускать ПЕРЕД коммитом новых фич.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
for suite in app worker; do
  out=$(perl -e 'alarm 90; exec @ARGV' osascript -l JavaScript "tests/run-$suite.js" 2>&1)
  echo "$out"
  echo
  if echo "$out" | grep -q "FAILED"; then fail=1; fi
  if echo "$out" | grep -q "EVAL $suite"; then fail=1; fi   # исходник не загрузился
done

if [ "$fail" -eq 0 ]; then
  echo "✅ ALL TESTS PASSED"
else
  echo "❌ TESTS FAILED — не коммить, пока не зелёные"
fi
exit $fail

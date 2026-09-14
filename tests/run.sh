#!/usr/bin/env bash
# Регрессионные функциональные тесты дашборда.
# Гоняют РЕАЛЬНЫЕ функции из app.js и telegram-notify.js под заглушками
# окружения через osascript (JavaScriptCore). Запуск: bash tests/run.sh
# Выход 0 — все прошли; 1 — есть падения. Запускать ПЕРЕД коммитом новых фич.
# Провал сьюта (каждая причина — отдельной строкой «❌ <suite>: …») — ЛЮБОЕ из:
#   1) код возврата раннера ≠ 0 (142 = таймаут, 127 = нет osascript/perl, иное = крэш);
#   2) нет строки-маркера «APP TESTS: N/N passed» / «WORKER TESTS: N/N passed»
#      (пустой вывод, крэш раннера до сводки);
#   3) в выводе есть «FAILED», «EVAL <suite>» (исходник не загрузился) или
#      «execution error» (крэш JXA);
#   4) число кейсов N (второе число маркера) ниже порога MIN_CASES_<suite>.
set -uo pipefail
cd "$(dirname "$0")/.."

# Минимум кейсов на сьют (второе число маркера N/N; сейчас app 1623, worker 264,
# worker-async 50, sync-sim 223) — защита от случайно урезанного/не подхваченного файла кейсов.
# Поднимать вместе с кейсами. S7b-3: 1290 → 1250 — удалены кейсы удалённых функций (−86), добавлены новые (+46).
# E0: 1250 → 1320 (+40 кейсов sync signal). E5a: 1350 → 1430 (app 1465: группа ai reports (E5)).
# E2: app 1430 → 1490 (1507: row contract + сканеры), worker 195 → 250 (264: паритет + сканер).
# E4: app 1490 → 1560 (+ группы sync merge (E4)), новый сьют sync-sim (node, сквозная симуляция синка) — порог 100.
MIN_CASES_app=1560
MIN_CASES_worker=250
MIN_CASES_worker_async=30
MIN_CASES_sync_sim=100
TIMEOUT=90   # сек на сьют; по истечении perl alarm убивает раннер → rc 142

fail=0
reasons=""
# Причина печатается сразу И копится в сводку: pre-commit хук показывает только
# `tail -40` лога, куда причины app-сьюта иначе не попадают (их вытесняет вывод worker).
bad(){ echo "❌ $suite: $1"; reasons="${reasons}❌ $suite: $1"$'\n'; fail=1; }
for suite in app worker; do
  # `or exit 127`: без него perl молча выходит с 0, если osascript не найден
  out=$(perl -e "alarm $TIMEOUT; exec @ARGV or exit 127" osascript -l JavaScript "tests/run-$suite.js" 2>&1)
  rc=$?
  echo "$out"
  echo
  # 1) код возврата
  if [ "$rc" -ne 0 ]; then
    case "$rc" in
      142) why="таймаут ${TIMEOUT}с (rc 142)";;
      127) why="нет osascript/perl (rc 127)";;
      *)   why="код возврата $rc";;
    esac
    bad "$why"
  fi
  # 2) маркер сводки + 4) порог числа кейсов (here-strings, а не pipe: pipefail не мешает)
  marker=$(grep -E '^(APP|WORKER) TESTS: [0-9]+/[0-9]+ passed' <<<"$out" | head -1)
  if [ -z "$marker" ]; then
    bad "нет маркера «TESTS: N/N passed» (пустой вывод или крэш раннера)"
  else
    total=$(sed -E 's#^[A-Z]+ TESTS: [0-9]+/([0-9]+) passed.*#\1#' <<<"$marker")
    minvar="MIN_CASES_$suite"; min=${!minvar}
    if [ "$total" -lt "$min" ]; then
      bad "кейсов $total < порога $min (файл кейсов урезан?)"
    fi
  fi
  # 3) подстроки провала
  if grep -q "FAILED" <<<"$out"; then bad "есть FAILED"; fi
  if grep -q "EVAL $suite" <<<"$out"; then bad "исходник не загрузился (EVAL $suite)"; fi
  if grep -q "execution error" <<<"$out"; then bad "крэш JXA (execution error)"; fi
done

# Асинхронные сьюты под node (JSC в osascript не крутит промисы). Без node — провал,
# а не тихий пропуск (pre-commit на этой машине node имеет):
#   worker-async — воркер (блок A: моки fetch, повторы/таймауты/max_tokens, сквозной цикл AI-портфеля);
#   sync-sim     — синк клиента (E4: два клиента с настоящим кодом сайта + фейковый Supabase с триггером rev,
#                  realtime, воркер, офлайн, потерянный ответ; сценарии трёхстороннего слияния).
for suite in worker-async sync-sim; do
  case "$suite" in
    worker-async) js=tests/run-worker-async.js; mk=WORKER-ASYNC; min=$MIN_CASES_worker_async;;
    sync-sim)     js=tests/run-sync-sim.js;     mk=SYNC-SIM;     min=$MIN_CASES_sync_sim;;
  esac
  if ! command -v node >/dev/null 2>&1; then bad "нет node — сьют не запущен"; continue; fi
  out=$(perl -e "alarm $TIMEOUT; exec @ARGV or exit 127" node "$js" 2>&1)
  rc=$?
  echo "$out"
  echo
  if [ "$rc" -ne 0 ]; then bad "код возврата $rc"; fi
  marker=$(grep -E "^$mk TESTS: [0-9]+/[0-9]+ passed" <<<"$out" | head -1)
  if [ -z "$marker" ]; then
    bad "нет маркера «$mk TESTS: N/N passed»"
  else
    total=$(sed -E "s#^$mk TESTS: [0-9]+/([0-9]+) passed.*#\1#" <<<"$marker")
    if [ "$total" -lt "$min" ]; then bad "кейсов $total < порога $min"; fi
  fi
  if grep -q "FAILED" <<<"$out"; then bad "есть FAILED"; fi
done

if [ "$fail" -eq 0 ]; then
  echo "✅ ALL TESTS PASSED"
else
  echo "❌ TESTS FAILED — не коммить, пока не зелёные"
  printf '%s' "$reasons"   # сводка причин в конце — видна в `tail -40` pre-commit хука
fi
exit $fail

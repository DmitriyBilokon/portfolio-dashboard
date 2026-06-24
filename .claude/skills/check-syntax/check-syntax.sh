#!/usr/bin/env bash
# Per-file проверка JS-синтаксиса без браузера через JavaScriptCore (osascript -l JavaScript).
# Каждый файл оборачивается в `new Function(src)` — ровно ручная процедура из CLAUDE.md.
# Для воркера (любой файл с `export default`) сначала заменяет `export default` → `var __d =`,
# т.к. ES-модульный синтаксис нелегален в теле Function. Исходники не изменяются.
# Запуск: bash .claude/skills/check-syntax/check-syntax.sh [файлы...]
# Выход 0 — всё парсится; 1 — есть ошибка синтаксиса.
set -uo pipefail
cd "$(dirname "$0")/../../.."   # корень репо

files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  files=(app.js app-2.js app-3.js app-4.js app-5.js data.js telegram-notify.js)
fi

tmp="${TMPDIR:-/tmp}/check-syntax.$$.js"
trap 'rm -f "$tmp"' EXIT
fail=0

for f in "${files[@]}"; do
  if [ ! -f "$f" ]; then echo "⏭  $f — нет файла, пропуск"; continue; fi
  # Нейтрализуем ES-модульный синтаксис, чтобы new Function принял исходник.
  perl -pe 's/\bexport\s+default\b/var __d =/g' "$f" > "$tmp"
  res=$(SRC="$tmp" osascript -l JavaScript -e '
    ObjC.import("Foundation");
    var p = $.NSProcessInfo.processInfo.environment.objectForKey("SRC").js;
    var s = $.NSString.stringWithContentsOfFileEncodingError($(p), $.NSUTF8StringEncoding, null);
    s = (s && s.js) ? s.js : "";
    try { new Function(s); "OK"; } catch (e) { "ERR: " + e.message; }
  ' 2>&1)
  if [ "$res" = "OK" ]; then
    echo "✅ $f"
  else
    echo "❌ $f — $res"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "✅ Синтаксис OK"
else
  echo "❌ Есть ошибки синтаксиса — чинить до tests/run.sh"
fi
exit $fail

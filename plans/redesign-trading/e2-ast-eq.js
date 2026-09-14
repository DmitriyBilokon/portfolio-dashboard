// E2 (plans/ledger-model-e.md §4.E2 п.4): доказательство «замена r[N] → r[RC.<id>] ничего не поменяла».
// Парсит каждый файл до (git ref) и после (рабочее дерево), в новом подставляет RC.<id> → числовой литерал (значения — из
// объявления RC: у клиента — глобал из app.js, у воркера — своя копия; сверяются с контрактом), сравнивает AST без позиций/комментариев по узлам верхнего уровня
// (функция / объявление / export default). Отличие допускается только в явном списке E2_ALLOW (замены п.2: поиск колонки
// по имени → colOf/colEnsure, новые объявления контракта) — каждое печатается с изменившимися инструкциями.
// Запуск из корня репо:  node plans/redesign-trading/e2-ast-eq.js [--ref=<git ref до E2>]   (по умолчанию HEAD)
// Выход 0 — всё равно или отличается только разрешённое; 1 — неожиданное отличие; 2 — нет acorn/файла.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const { RC_ID } = require('./e2-codemod.js');   // тот же загрузчик acorn и порядок id
const acorn = (() => { const tries = [process.env.ACORN, 'acorn']; try { const npx = path.join(require('os').homedir(), '.npm', '_npx'); for (const d of fs.readdirSync(npx)) tries.push(path.join(npx, d, 'node_modules', 'acorn')); } catch (e) {} for (const t of tries) { if (!t) continue; try { return require(t); } catch (e) {} } console.error('acorn не найден'); process.exit(2); })();
const FILES = ['signals.js', 'chart.js', 'app.js', 'app-2.js', 'app-3.js', 'app-4.js', 'app-5.js', 'desk-selection.js', 'desk-journal.js', 'desk.js', 'desk-gloss.js', 'telegram-notify.js'];
// Разрешённые отличия (узел верхнего уровня). Префикс «+» — новый узел, «−» — удалённый, без префикса — изменённый.
const E2_ALLOW = {
  'app.js': ['+var PF_HEAD', '+var PF_HEAD_ALT', '+var RC', '+var COLN', '+var COLN_RE', '+fn colOf', '+fn colEnsure', '+fn rowSchemaOk',
    '+fn rowSchemaBad', '+var _rowSchemaWarned', '+fn rowSchemaCheck',
    'fn migratePortfolio3', 'fn migrateState', 'fn migrateDropDead', 'fn smaIdx', 'fn pf3TypeMetrics', 'fn pf3AiSnapshot', 'fn stockAiSnapshot'],
  'app-2.js': ['fn pf3EffTarget'],
  'app-3.js': ['fn pf3ScenarioHTML'],
  'app-5.js': ['fn secFromRow', 'fn sigRowPhase', 'fn sigRecoMap', 'fn pf3FetchPrices', 'fn pf3RefreshCardPrice', 'fn pf3RefreshTargets'],
  'desk.js': ['fn deskBeta', 'fn deskRowNum', 'fn deskAnaHTML', 'fn deskExecApply'],
  'telegram-notify.js': ['var WORKER_BUILD', '+var RC', '+var COLN', '+var COLN_RE', '+fn colOf', '−var TARGET_COL', '−var TARGET_RECENT_COL',
    'fn aipUniverse', 'fn buildPortfolioSnapshot', 'fn updateTargets'],
};

const ref = (process.argv.find(a => a.startsWith('--ref=')) || '--ref=HEAD').slice(6);
const parse = (src, f) => acorn.parse(src, { ecmaVersion: 'latest', sourceType: f === 'telegram-notify.js' ? 'module' : 'script' });
// RC из объявления файла: const RC=Object.freeze({…}) → {id: n}; сверка с контрактом (порядок RC_ID).
function rcOf(ast, f) {
  for (const s of ast.body) {
    if (s.type !== 'VariableDeclaration') continue;
    for (const d of s.declarations) {
      if (!(d.id.type === 'Identifier' && d.id.name === 'RC')) continue;
      const obj = d.init.type === 'CallExpression' ? d.init.arguments[0] : d.init, out = {};
      obj.properties.forEach(p => { out[p.key.name || p.key.value] = p.value.value; });
      RC_ID.forEach((id, i) => { if (out[id] !== i) { console.error(`✘ ${f}: RC.${id} = ${out[id]}, ожидалось ${i}`); process.exit(1); } });
      if (Object.keys(out).length !== RC_ID.length) { console.error(`✘ ${f}: в RC лишние ключи`); process.exit(1); }
      return out;
    }
  }
  return null;
}
// Нормализация: без позиций и raw; RC.<id> → Literal.
function norm(n, rc) {
  if (Array.isArray(n)) return n.map(x => norm(x, rc));
  if (!n || typeof n !== 'object') return n;
  if (rc && n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === 'RC' && n.property.name in rc)
    return { type: 'Literal', value: rc[n.property.name] };
  const o = {};
  for (const k of Object.keys(n)) { if (k === 'start' || k === 'end' || k === 'loc' || k === 'raw' || k === 'range') continue; o[k] = norm(n[k], rc); }
  return o;
}
// Узлы верхнего уровня: ключ → {node, src}.
function units(ast, src) {
  const out = new Map(); let k = 0;
  for (const s of ast.body) {
    let key;
    if (s.type === 'FunctionDeclaration') key = 'fn ' + s.id.name;
    else if (s.type === 'VariableDeclaration') key = 'var ' + s.declarations.map(d => d.id.type === 'Identifier' ? d.id.name : src.slice(d.id.start, d.id.end)).join(',');
    else if (s.type === 'ExportDefaultDeclaration') key = 'export default';
    else if (s.type === 'ClassDeclaration') key = 'class ' + s.id.name;
    else key = '#' + (k++) + ' ' + src.slice(s.start, s.end).replace(/\s+/g, ' ').slice(0, 40);
    if (out.has(key)) key += ' @' + s.start;
    out.set(key, { node: s, src });
  }
  return out;
}
const J = x => JSON.stringify(x);
// Изменившиеся инструкции тела функции (LCS по нормализованным инструкциям) — чтобы разрешённое отличие было видно глазами.
function stmtDiff(a, b, rcA, rcB) {
  const body = u => { const n = u.node; return n.type === 'FunctionDeclaration' ? n.body.body : [n]; };
  const A = body(a), B = body(b), nA = A.map(x => J(norm(x, rcA))), nB = B.map(x => J(norm(x, rcB)));
  const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = nA[i] === nB[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const t = (u, s) => u.src.slice(s.start, s.end).replace(/\s+/g, ' ').slice(0, 150), out = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && nA[i] === nB[j]) { i++; j++; }
    else if (j < B.length && (i >= A.length || L[i][j + 1] >= L[i + 1][j])) out.push(`      + ${t(b, B[j++])}`);
    else out.push(`      − ${t(a, A[i++])}`);
  }
  return out;
}

let bad = 0, allowed = 0, same = 0;
// RC — глобал клиента из app.js (остальные файлы его только используют); у воркера — своя копия.
const rcFile = (f, src) => rcOf(parse(src, f), f);
const clientRC = { old: null, cur: rcFile('app.js', fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')) };
for (const f of FILES) {
  let oldSrc;
  try { oldSrc = cp.execSync(`git show ${ref}:${f}`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); }
  catch (e) { console.error(`✘ нет ${f} в ${ref}`); process.exit(2); }
  const newSrc = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const A = parse(oldSrc, f), B = parse(newSrc, f);
  const own = f === 'telegram-notify.js', rcB = own ? rcOf(B, f) : clientRC.cur, rcA = own ? rcOf(A, f) : null;   // до E2 RC.<id> не было
  const uA = units(A, oldSrc), uB = units(B, newSrc), allow = new Set(E2_ALLOW[f] || []);
  const lines = [];
  for (const [k, a] of uA) {
    const b = uB.get(k);
    if (!b) { const ok = allow.has('−' + k); lines.push(`  ${ok ? '·' : '✘'} удалён ${k}`); ok ? allowed++ : bad++; continue; }
    if (J(norm(a.node, rcA)) === J(norm(b.node, rcB))) { same++; continue; }
    const ok = allow.has(k); ok ? allowed++ : bad++;
    lines.push(`  ${ok ? '·' : '✘'} изменён ${k}${ok ? '' : '  ← НЕ в списке E2_ALLOW'}`, ...stmtDiff(a, b, rcA, rcB));
  }
  for (const [k] of uB) if (!uA.has(k)) { const ok = allow.has('+' + k); lines.push(`  ${ok ? '·' : '✘'} добавлен ${k}`); ok ? allowed++ : bad++; }
  const unused = [...allow].filter(k => { const base = k.replace(/^[+−]/, ''); return k[0] === '+' ? uA.has(base) || !uB.has(base) : k[0] === '−' ? uB.has(base) || !uA.has(base) : !(uA.has(base) && uB.has(base) && J(norm(uA.get(base).node, rcA)) !== J(norm(uB.get(base).node, rcB))); });
  unused.forEach(k => lines.push(`  ? в E2_ALLOW, но не отличается: ${k}`));
  console.log(`${f}: ${lines.length ? '' : 'AST равен (с RC.<id> → литерал)'}`);
  lines.forEach(l => console.log(l));
}
console.log(`\nУзлов равны: ${same} · разрешённых отличий: ${allowed} · неожиданных: ${bad}`);
console.log(bad ? '✘ E2-AST: есть отличия вне E2_ALLOW' : '✔ E2-AST: замена r[N] → r[RC.<id>] эквивалентна; прочие отличия — только разрешённые (выше)');
process.exit(bad ? 1 : 0);

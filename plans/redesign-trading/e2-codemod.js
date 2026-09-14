// E2 (plans/ledger-model-e.md §4.E2 п.3): механическая замена r[N] → r[RC.<id>] — индекс префикса строки v3-вкладки
// (литерал 0–15) получает имя из контракта RC. Меняется только текст литерала-индекса, больше ничего.
// Запуск из корня репо (acorn — как у s7b-graph.js):
//   node plans/redesign-trading/e2-codemod.js            — отчёт: что будет заменено и что оставлено (по видам)
//   node plans/redesign-trading/e2-codemod.js --write    — записать файлы
// Что считается строкой вкладки (составлено по графу привязок 2026-09-14, отчёт печатает все привязки):
//   • идентификаторы r / row / src / r0 — во всех обрабатываемых файлах они привязаны только к строкам вкладок
//     (параметр колбэка *.rows.forEach/map/find…, const r=d.rows[i], параметр функций (d,r), new Array(headers.length));
//   • x — только параметр колбэка метода массива *.rows (find/forEach/some/…); прочие x — кортежи, не трогаем;
//   • <obj>.r[N] и (<obj>.r||<obj>)[N] — строка в обёртке {r,…} (pfConcentration, deskItems…);
//   • <obj>.rows[<expr>][N] — строка по индексу;
//   • воркер: num(r, N) — хелпер чтения ячейки строки.
// Не трогаем: desk-gloss.js (it.rows — таблицы словаря), migrateIndexV3 (читает СТАРУЮ схему сида).
// Доказательство эквивалентности — e2-ast-eq.js (RC.<id> → литерал, AST до/после равны).
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..', '..');
const FILES = ['app.js', 'app-2.js', 'app-3.js', 'app-4.js', 'app-5.js', 'desk-selection.js', 'desk-journal.js', 'desk.js', 'telegram-notify.js'];
const SKIP_FN = new Set(['migrateIndexV3']);
const RC_ID = ['n', 'name', 'tk', 'country', 'sector', 'type', 'qty', 'price', 'ccy', 'buy', 'day', 'pl', 'plPct', 'value', 'xdag', 'pay'];
const ROW_IDS = new Set(['r', 'row', 'src', 'r0']);
const ROW_METHODS = /\.rows\s*\)?\s*\|\|\s*\[\]\s*\)?\s*\.\s*(find|findIndex|forEach|some|every|filter|map)$|\.rows\s*\.\s*(find|findIndex|forEach|some|every|filter|map)$/;

function loadAcorn() {
  const tries = [process.env.ACORN, 'acorn'];
  try { const npx = path.join(os.homedir(), '.npm', '_npx'); for (const d of fs.readdirSync(npx)) tries.push(path.join(npx, d, 'node_modules', 'acorn')); } catch (e) {}
  try { tries.push(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim(), 'acorn')); } catch (e) {}
  for (const t of tries) { if (!t) continue; try { return require(t); } catch (e) {} }
  console.error('acorn не найден: npm i -g acorn или ACORN=/путь/к/acorn'); process.exit(2);
}
const acorn = loadAcorn();
const parse = (src, file) => acorn.parse(src, { ecmaVersion: 'latest', sourceType: /telegram-notify/.test(file) ? 'module' : 'script', locations: true });
const isFn = n => n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';
const isIdx = p => p && p.type === 'Literal' && typeof p.value === 'number' && Number.isInteger(p.value) && p.value >= 0 && p.value <= 15 && /^\d+$/.test(p.raw);
function patNames(p, out) {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier': out.push(p.name); break;
    case 'ObjectPattern': p.properties.forEach(pr => patNames(pr.type === 'RestElement' ? pr.argument : pr.value, out)); break;
    case 'ArrayPattern': p.elements.forEach(e => patNames(e, out)); break;
    case 'RestElement': patNames(p.argument, out); break;
    case 'AssignmentPattern': patNames(p.left, out); break;
  }
  return out;
}

// Один файл → { edits:[{start,end,text}], report:{вид → [строки]} }.
function plan(file, src) {
  const ast = parse(src, file), edits = [], report = {}, kept = {};
  const put = (bag, k, line) => (bag[k] = bag[k] || []).push(line);
  const snip = (n, w) => src.slice(n.start, n.end).replace(/\s+/g, ' ').slice(0, w || 60);
  // Стек областей: Map имя → описание привязки ('rowcb' — параметр колбэка метода *.rows).
  function walk(n, stack, parent, skip) {
    if (!n || typeof n.type !== 'string') return;
    let pushed = 0;
    if (n.type === 'FunctionDeclaration' && n.id && SKIP_FN.has(n.id.name)) skip = true;
    if (isFn(n)) {
      const m = new Map();
      const rowcb = parent && parent.type === 'CallExpression' && parent.arguments.includes(n) && parent.callee.type === 'MemberExpression'
        && ROW_METHODS.test(src.slice(parent.callee.start, parent.callee.end).replace(/\s+/g, ''));
      n.params.forEach(p => patNames(p, []).forEach(nm => m.set(nm, rowcb ? 'rowcb' : 'param')));
      stack.push(m); pushed++;
    }
    if (n.type === 'VariableDeclarator') for (const nm of patNames(n.id, [])) { if (stack.length) stack[stack.length - 1].set(nm, 'var'); }
    if (n.type === 'MemberExpression' && n.computed && isIdx(n.property)) {
      const o = n.object, line = n.loc.start.line, idx = n.property.value;
      let kind = null;
      if (o.type === 'Identifier' && ROW_IDS.has(o.name)) kind = o.name + '[N]';
      else if (o.type === 'Identifier' && o.name === 'x') {
        let b = null; for (let i = stack.length - 1; i >= 0; i--) if (stack[i].has('x')) { b = stack[i].get('x'); break; }
        if (b === 'rowcb') kind = 'x[N] (колбэк *.rows)';
      } else if (o.type === 'MemberExpression' && !o.computed && o.property.name === 'r') kind = '<obj>.r[N]';
      else if (o.type === 'LogicalExpression' && o.operator === '||' && o.left.type === 'MemberExpression' && !o.left.computed && o.left.property.name === 'r') kind = '(<obj>.r||…)[N]';
      else if (o.type === 'MemberExpression' && o.computed && o.object.type === 'MemberExpression' && !o.object.computed && o.object.property.name === 'rows') kind = '<obj>.rows[i][N]';
      if (kind && !skip) { edits.push({ start: n.property.start, end: n.property.end, text: 'RC.' + RC_ID[idx] }); put(report, kind, file + ':' + line + ' ' + snip(n)); }
      else if (kind && skip) put(kept, kind + ' — migrateIndexV3 (старая схема сида)', file + ':' + line);
      else if (o.type === 'Identifier' && (o.name === 'x')) put(kept, 'x[N] не из колбэка *.rows', file + ':' + line + ' ' + snip(n, 40));
    }
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'num' && n.arguments.length === 2
      && n.arguments[0].type === 'Identifier' && ROW_IDS.has(n.arguments[0].name) && isIdx(n.arguments[1]) && !skip) {
      const a = n.arguments[1];
      edits.push({ start: a.start, end: a.end, text: 'RC.' + RC_ID[a.value] }); put(report, 'num(r, N)', file + ':' + n.loc.start.line + ' ' + snip(n));
    }
    for (const k in n) {
      if (k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => walk(c, stack, n, skip)); else if (v && typeof v.type === 'string') walk(v, stack, n, skip);
    }
    while (pushed--) stack.pop();
  }
  walk(ast, [new Map()], null, false);
  return { edits, report, kept };
}
function apply(src, edits) {
  let out = src;
  edits.slice().sort((a, b) => b.start - a.start).forEach(e => { out = out.slice(0, e.start) + e.text + out.slice(e.end); });
  return out;
}

if (require.main === module) {
  const write = process.argv.includes('--write');
  let total = 0;
  const rep = {}, kept = {};
  for (const f of FILES) {
    const p = path.join(ROOT, f), src = fs.readFileSync(p, 'utf8');
    const r = plan(f, src);
    total += r.edits.length;
    for (const k in r.report) (rep[k] = rep[k] || []).push(...r.report[k]);
    for (const k in r.kept) (kept[k] = kept[k] || []).push(...r.kept[k]);
    if (write && r.edits.length) { const out = apply(src, r.edits); parse(out, f); fs.writeFileSync(p, out); }
    console.log(`${f.padEnd(20)} замен: ${r.edits.length}`);
  }
  console.log(`\nВсего замен: ${total}${write ? ' — записано' : ' (сухой прогон; --write — записать)'}\n`);
  for (const k of Object.keys(rep)) { console.log(`■ ${k}: ${rep[k].length}`); rep[k].slice(0, 4).forEach(l => console.log('    ' + l)); if (rep[k].length > 4) console.log('    …'); }
  console.log('\nОставлено как есть:');
  for (const k of Object.keys(kept)) { console.log(`□ ${k}: ${kept[k].length}`); kept[k].slice(0, 12).forEach(l => console.log('    ' + l)); }
}
module.exports = { plan, apply, RC_ID };

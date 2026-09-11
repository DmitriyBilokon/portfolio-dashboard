// S7b: граф зависимостей клиентского кода (plans/redesign-integration.md §7.7 п.2, stock-selection-ux.md §9).
// Запуск из корня репо (нужен acorn: любой node_modules с acorn — `npm i -g acorn`, либо путь в env ACORN):
//   node plans/redesign-trading/s7b-graph.js who <имя> [<имя>…]  — кто ссылается на имя и на что ссылается оно
//   node plans/redesign-trading/s7b-graph.js reach [cut.json]    — что станет недостижимым после удаления (по умолчанию s7b-cut.json рядом)
//   node plans/redesign-trading/s7b-graph.js ids [id…]           — DOM-id: кто создаёт (id="…" в строке, index.html) и кто читает
//   node plans/redesign-trading/s7b-graph.js css [--file=styles.css] — классы CSS: где объявлены и кто их упоминает
//   node plans/redesign-trading/s7b-graph.js json                — весь граф в JSON (stdout)
// Узел — top-level объявление (function/class/const/let/var) или top-level инструкция (`@файл:строка`);
// у модулей-IIFE (signals.js, chart.js) инструкция объявляет свой экспорт `root.X=`.
// Рёбра: `c` — ссылка на глобальное имя в теле узла с учётом локальных областей (параметры, var/let/const,
// catch, for); `s` — глобальное имя в строке/шаблоне (inline onclick="…", HTML-строки): имя, за которым
// идёт `(`, `=` (не `==`), `.` или `[`, либо любое имя внутри атрибута on*="…". Динамических обращений
// `window[...]`/`eval` в клиентском коде нет (проверено 2026-09-11) — граф статически полон.
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..', '..');
const FILES = ['signals.js', 'chart.js', 'app.js', 'app-2.js', 'app-3.js', 'app-4.js', 'app-5.js',
  'desk-selection.js', 'desk-journal.js', 'desk.js', 'desk-gloss.js'];

function loadAcorn() {
  const tries = [process.env.ACORN, 'acorn'];
  try { const npx = path.join(os.homedir(), '.npm', '_npx'); for (const d of fs.readdirSync(npx)) tries.push(path.join(npx, d, 'node_modules', 'acorn')); } catch (e) {}
  try { tries.push(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim(), 'acorn')); } catch (e) {}
  for (const t of tries) { if (!t) continue; try { return require(t); } catch (e) {} }
  console.error('acorn не найден: npm i -g acorn или ACORN=/путь/к/acorn'); process.exit(2);
}
const acorn = loadAcorn();

const ID_RE = /[A-Za-z_$][\w$]*/g;
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
const KIDS = n => { const r = []; for (const k in n) { if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(x => x && typeof x.type === 'string' && r.push(x)); else if (v && typeof v.type === 'string') r.push(v); } return r; };
const isFn = n => n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';
function hoisted(body, out) {
  (function h(n) {
    if (n.type === 'VariableDeclaration' && n.kind === 'var') n.declarations.forEach(d => patNames(d.id, out));
    if (n.type === 'FunctionDeclaration') { if (n.id) out.push(n.id.name); return; }
    if (isFn(n) || n.type === 'ClassExpression' || n.type === 'ClassDeclaration') return;
    KIDS(n).forEach(h);
  })(body);
  return out;
}
function blockNames(stmts) {
  const out = [];
  for (const s of stmts) {
    if (s.type === 'VariableDeclaration' && s.kind !== 'var') s.declarations.forEach(d => patNames(d.id, out));
    else if ((s.type === 'ClassDeclaration' || s.type === 'FunctionDeclaration') && s.id) out.push(s.id.name);
  }
  return out;
}

// Разбор файла → узлы {name, file, line, end, bytes, kind, n (AST)}.
const nodes = [], byName = new Map(), dup = [];
function addNode(o) {
  nodes.push(o);
  for (const nm of o.decl) { if (byName.has(nm)) dup.push(nm + ' (' + byName.get(nm).file + ' и ' + o.file + ')'); else byName.set(nm, o); }
}
const SRC = {};
for (const f of FILES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8'); SRC[f] = src;
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
  for (const st of ast.body) {
    const base = { file: f, line: st.loc.start.line, end: st.loc.end.line, bytes: st.end - st.start };
    if (st.type === 'FunctionDeclaration') addNode({ ...base, name: st.id.name, kind: 'function', decl: [st.id.name], n: st });
    else if (st.type === 'ClassDeclaration') addNode({ ...base, name: st.id.name, kind: 'class', decl: [st.id.name], n: st });
    else if (st.type === 'VariableDeclaration') {
      const names = []; st.declarations.forEach(d => patNames(d.id, names));
      // несколько имён в одной инструкции (`let a=…,b=…`) — один узел, объявляющий все имена
      addNode({ ...base, name: names[0], kind: st.kind, decl: names, n: st });
    } else {
      const exp = [];
      (function h(n) { if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && !n.left.computed && n.left.object.type === 'Identifier' && /^(root|globalThis|window)$/.test(n.left.object.name)) exp.push(n.left.property.name); KIDS(n).forEach(h); })(st);
      addNode({ ...base, name: '@' + f + ':' + st.loc.start.line, kind: 'stmt', decl: exp, n: st });
    }
  }
}
const GLOBALS = new Set(byName.keys());

// Ссылки узла.
function scanString(s, out) {
  if (!s) return;
  const handler = /\bon[a-z]+\s*=\s*$|\bon[a-z]+\s*=\s*["']/i.test(s);
  let m; ID_RE.lastIndex = 0;
  while ((m = ID_RE.exec(s))) {
    const nm = m[0]; if (!GLOBALS.has(nm)) continue;
    const prev = s[m.index - 1] || ''; if (prev === '.' || /[\w$]/.test(prev)) continue;
    const rest = s.slice(ID_RE.lastIndex, ID_RE.lastIndex + 3);
    if (handler || /^\s*(\(|=(?!=)|\.|\[)/.test(rest)) out.s.add(nm);
  }
}
function refsOf(node) {
  const out = { c: new Set(), s: new Set(), idsR: new Set(), idsC: new Set(), w: new Set() };
  // Запись в глобал: присваивание/++/delete по цепочке от глобального имени, мутирующий метод (push, splice…).
  const rootId = (e, sc) => { while (e && (e.type === 'MemberExpression' || e.type === 'ChainExpression')) e = e.type === 'ChainExpression' ? e.expression : e.object; return e && e.type === 'Identifier' && !isLocal(e.name, sc) && GLOBALS.has(e.name) ? e.name : null; };
  const MUT = /^(push|pop|shift|unshift|splice|sort|reverse|fill|set|delete|clear|add)$/;
  const isLocal = (nm, sc) => { for (let i = sc.length - 1; i >= 0; i--) if (sc[i].has(nm)) return true; return false; };
  function defaults(p, sc) { if (!p) return; if (p.type === 'AssignmentPattern') { walk(p.right, sc); defaults(p.left, sc); } else if (p.type === 'ObjectPattern') p.properties.forEach(pr => { if (pr.computed) walk(pr.key, sc); defaults(pr.type === 'RestElement' ? pr.argument : pr.value, sc); }); else if (p.type === 'ArrayPattern') p.elements.forEach(e => defaults(e, sc)); else if (p.type === 'RestElement') defaults(p.argument, sc); }
  function strArg(a) { if (!a) return null; if (a.type === 'Literal' && typeof a.value === 'string') return a.value; if (a.type === 'TemplateLiteral') return a.quasis.map(q => q.value.cooked).join('*'); return null; }
  function walk(n, sc) {
    if (!n || typeof n.type !== 'string') return;
    switch (n.type) {
      case 'Identifier': if (!isLocal(n.name, sc) && GLOBALS.has(n.name)) out.c.add(n.name); return;
      case 'MemberExpression': walk(n.object, sc); if (n.computed) walk(n.property, sc); return;
      case 'Property': case 'MethodDefinition': case 'PropertyDefinition': if (n.computed) walk(n.key, sc); walk(n.value, sc); return;
      case 'LabeledStatement': walk(n.body, sc); return;
      case 'BreakStatement': case 'ContinueStatement': return;
      case 'VariableDeclaration': n.declarations.forEach(d => { defaults(d.id, sc); walk(d.init, sc); }); return;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': {
        const nm = ['arguments']; n.params.forEach(p => patNames(p, nm)); if (n.type === 'FunctionExpression' && n.id) nm.push(n.id.name);
        if (n.body.type === 'BlockStatement') hoisted(n.body, nm);
        const s2 = sc.concat([new Set(nm)]); n.params.forEach(p => defaults(p, s2)); walk(n.body, s2); return; }
      case 'BlockStatement': case 'StaticBlock': case 'Program': { const s2 = sc.concat([new Set(blockNames(n.body))]); n.body.forEach(x => walk(x, s2)); return; }
      case 'SwitchStatement': { walk(n.discriminant, sc); const s2 = sc.concat([new Set(blockNames([].concat(...n.cases.map(c => c.consequent))))]); n.cases.forEach(c => { walk(c.test, s2); c.consequent.forEach(x => walk(x, s2)); }); return; }
      case 'ForStatement': { let s2 = sc; if (n.init && n.init.type === 'VariableDeclaration' && n.init.kind !== 'var') { const nm = []; n.init.declarations.forEach(d => patNames(d.id, nm)); s2 = sc.concat([new Set(nm)]); } walk(n.init, s2); walk(n.test, s2); walk(n.update, s2); walk(n.body, s2); return; }
      case 'ForInStatement': case 'ForOfStatement': { let s2 = sc; if (n.left.type === 'VariableDeclaration' && n.left.kind !== 'var') { const nm = []; n.left.declarations.forEach(d => patNames(d.id, nm)); s2 = sc.concat([new Set(nm)]); } walk(n.left, s2); walk(n.right, s2); walk(n.body, s2); return; }
      case 'CatchClause': { const s2 = sc.concat([new Set(patNames(n.param, []))]); walk(n.body, s2); return; }
      case 'Literal': if (typeof n.value === 'string') { scanString(n.value, out); ids(n.value); } return;
      case 'TemplateLiteral': { const q = n.quasis.map(x => x.value.cooked || ''); q.forEach(x => scanString(x, out)); ids(q.join('*')); n.expressions.forEach(e => walk(e, sc)); return; }
      case 'CallExpression': {
        const cal = n.callee;
        if (cal.type === 'MemberExpression' && !cal.computed) {
          const p = cal.property.name, a = strArg(n.arguments[0]);
          if (a != null && p === 'getElementById') out.idsR.add(a);
          if (a != null && /^querySelector(All)?$|^closest$/.test(p)) (a.match(/#[\w*-]+/g) || []).forEach(x => out.idsR.add(x.slice(1)));
          if (MUT.test(p)) { const g = rootId(cal.object, sc); if (g) out.w.add(g); }
        }
        if (cal.type === 'MemberExpression' && cal.object.type === 'Identifier' && cal.object.name === 'Object' && !cal.computed && cal.property.name === 'assign') { const g = rootId(n.arguments[0], sc); if (g) out.w.add(g); }
        break;
      }
      case 'AssignmentExpression': { const g = rootId(n.left, sc); if (g) out.w.add(g); break; }
      case 'UpdateExpression': { const g = rootId(n.argument, sc); if (g) out.w.add(g); break; }
      case 'UnaryExpression': if (n.operator === 'delete') { const g = rootId(n.argument, sc); if (g) out.w.add(g); } break;
    }
    KIDS(n).forEach(k => walk(k, sc));
  }
  function ids(s) { const re = /\bid\s*=\s*\\?["']([^"'\\]+)/g; let m; while ((m = re.exec(s))) out.idsC.add(m[1]); }
  if (node.kind === 'stmt' || node.kind === 'function' || node.kind === 'class') walk(node.n, []);
  else node.n.declarations.forEach(d => { defaults(d.id, []); walk(d.init, []); });
  for (const nm of node.decl) { out.c.delete(nm); out.s.delete(nm); }
  return out;
}
for (const n of nodes) { const r = refsOf(n); n.c = [...r.c]; n.s = [...r.s].filter(x => !r.c.has(x)); n.idsR = [...r.idsR]; n.idsC = [...r.idsC]; n.w = [...r.w].filter(x => !n.decl.includes(x) || n.kind === 'function'); }

// index.html: inline-обработчики и скрипты — корень `@index.html`; статические id.
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
{
  const out = { s: new Set() };
  (HTML.match(/\son[a-z]+="[^"]*"/g) || []).forEach(a => { let m; ID_RE.lastIndex = 0; while ((m = ID_RE.exec(a))) if (GLOBALS.has(m[0])) out.s.add(m[0]); });
  const idsC = [...HTML.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  nodes.push({ name: '@index.html', file: 'index.html', line: 1, end: 1, bytes: 0, kind: 'stmt', decl: [], c: [], s: [...out.s], idsR: [], idsC, w: [] });
}
const nodeOf = nm => byName.get(nm);
const keyOf = n => n.decl.length ? n.decl[0] : n.name;
const users = new Map();   // имя → [{node, kind}]
for (const n of nodes) for (const [k, list] of [['c', n.c], ['s', n.s]]) for (const nm of list) { if (!users.has(nm)) users.set(nm, []); users.get(nm).push({ n, k }); }
const where = n => n.file + ':' + n.line;

// Достижимость в «будущем» коде: корни — top-level инструкции (+keep), рёбра — с учётом cut/dropEdges/rewire.
function computeReach(cfg) {
  const cut = new Set(cfg.cut || []), drop = new Set((cfg.dropEdges || []).map(([a, b]) => a + '→' + b));
  const keep = new Set(cfg.keep || []);   // корни сверх top-level инструкций (напр. функции, которые зовёт воркер/консоль)
  // rewire: {имя: [цели]} — узел остаётся, но после правки ссылается только на перечисленное (смешанные функции:
  // renderAll/renderPF3/init после удаления классики). Ключ `@index.html` — какие inline-обработчики останутся.
  const rewire = cfg.rewire || {};
  const byKey = nm => nm.startsWith('@') ? nodes.find(n => n.name === nm) : nodeOf(nm);
  for (const nm of [...cut, ...keep, ...(cfg.dropEdges || []).flat(), ...Object.keys(rewire), ...Object.values(rewire).flat()]) if (!byKey(nm)) console.log('⚠ нет такого имени: ' + nm);
  const outOf = n => { const k = n.name === '@index.html' ? '@index.html' : keyOf(n); return rewire[k] ? rewire[k] : n.c.concat(n.s).filter(nm => !drop.has(k + '→' + nm)); };
  const seen = new Set(), q = [], parent = new Map();
  const push = (n, from) => { if (n && !seen.has(n) && !(n.decl.length && n.decl.every(d => cut.has(d)))) { seen.add(n); q.push(n); parent.set(n, from || null); } };
  nodes.filter(n => n.kind === 'stmt' && !cut.has(n.name)).forEach(n => push(n));
  keep.forEach(nm => push(nodeOf(nm), 'keep'));
  while (q.length) { const n = q.shift(); for (const nm of outOf(n)) push(nodeOf(nm), n); }
  return { seen, outOf, cut, parent };
}
const loadCfg = a => JSON.parse(fs.readFileSync(a || path.join(__dirname, 's7b-cut.json'), 'utf8'));

const cmd = process.argv[2] || 'help', args = process.argv.slice(3);
if (cmd === 'json') {
  console.log(JSON.stringify(nodes.map(n => ({ name: n.name, decl: n.decl, file: n.file, line: n.line, end: n.end, bytes: n.bytes, kind: n.kind, c: n.c, s: n.s, idsR: n.idsR, idsC: n.idsC })), null, 0));
} else if (cmd === 'who') {
  for (const nm of args) {
    const n = nodeOf(nm);
    if (!n) { console.log(`\n■ ${nm}: не глобальное имя`); continue; }
    const us = (users.get(nm) || []).filter(u => u.n !== n);
    console.log(`\n■ ${nm}  [${n.kind}] ${where(n)}–${n.end} (${n.bytes} B)${n.decl.length > 1 ? '  объявляет: ' + n.decl.join(',') : ''}`);
    console.log(`  ← ссылаются (${us.length}): ` + us.map(u => `${keyOf(u.n)}${u.k === 's' ? '″' : ''} (${where(u.n)})`).join(', '));
    console.log(`  → ссылается: ` + n.c.join(', ') + (n.s.length ? '  | в строках: ' + n.s.join(', ') : ''));
    if (n.idsR.length) console.log(`  DOM читает: #` + n.idsR.join(' #'));
    if (n.idsC.length) console.log(`  DOM создаёт: #` + n.idsC.join(' #'));
  }
} else if (cmd === 'reach') {
  const cfg = loadCfg(args[0]);
  const { seen, outOf, cut } = computeReach(cfg);
  const dead = nodes.filter(n => !seen.has(n)), deadSet = new Set(dead);
  // entries: {метка: [имена]} — входы классики; каждому мёртвому узлу — метки входов, из которых он достижим по мёртвым узлам
  const own = new Map();
  for (const [lbl, roots] of Object.entries(cfg.entries || {})) {
    const s2 = new Set(), q2 = roots.map(nodeOf).filter(Boolean);
    q2.forEach(n => s2.add(n));
    while (q2.length) { const n = q2.shift(); for (const nm of n.c.concat(n.s)) { const m = nodeOf(nm); if (m && deadSet.has(m) && !s2.has(m)) { s2.add(m); q2.push(m); } } }
    for (const n of s2) { if (!own.has(n)) own.set(n, []); own.get(n).push(lbl); }
  }
  const TESTS = fs.readFileSync(path.join(ROOT, 'tests', 'cases-app.js'), 'utf8');
  const inTests = n => n.decl.some(d => new RegExp('(^|[^\\w$.])' + d.replace(/\$/g, '\\$') + '(?![\\w$])').test(TESTS));
  const byFile = {}; dead.forEach(n => (byFile[n.file] = byFile[n.file] || []).push(n));
  let total = 0;
  for (const f of FILES) {
    const list = byFile[f]; if (!list) continue;
    const b = list.reduce((s, n) => s + n.bytes, 0); total += b;
    console.log(`\n■ ${f}: ${list.length} узлов, ${(b / 1024).toFixed(1)} КБ`);
    console.log(list.map(n => `  ${cut.has(n.decl[0]) ? '✂' : '·'} ${n.decl.join(',') || n.name}  ${n.line}–${n.end} (${n.bytes} B)${inTests(n) ? ' 🧪' : ''}${own.has(n) ? '  [' + own.get(n).join(' ') + ']' : cfg.entries ? '  [—]' : ''}`).join('\n'));
  }
  console.log(`\nИтого недостижимо: ${dead.length} узлов, ${(total / 1024).toFixed(1)} КБ`);
  // Живые потребители вырезанного: достижимые узлы, которые ссылаются на cut (кроме отброшенных рёбер) — блокеры.
  const block = [];
  for (const n of nodes) { if (!seen.has(n)) continue; for (const nm of outOf(n)) if (cut.has(nm)) block.push(`${keyOf(n)} (${where(n)}) → ${nm}`); }
  if (block.length) console.log(`\n⚠ Живые узлы ссылаются на вырезанное (${block.length}):\n  ` + block.join('\n  '));
  if (cfg.out) fs.writeFileSync(cfg.out, JSON.stringify(dead.map(n => ({ decl: n.decl, name: n.name, file: n.file, line: n.line, end: n.end, bytes: n.bytes })), null, 1));
} else if (cmd === 'why') {
  // Кратчайший путь от корня (top-level инструкция или keep) до узла в модели cut.json — кто держит узел живым.
  const cfgA = args.find(a => a.endsWith('.json')), R = computeReach(loadCfg(cfgA));
  for (const nm of args.filter(a => !a.endsWith('.json'))) {
    const n = nodeOf(nm); if (!n) { console.log(`■ ${nm}: нет`); continue; }
    if (!R.seen.has(n)) { console.log(`■ ${nm}: недостижим (удаляется)`); continue; }
    const path = []; let x = n; while (x && x !== 'keep') { path.unshift(keyOf(x)); x = R.parent.get(x); }
    console.log(`■ ${nm}: ${x === 'keep' ? 'keep → ' : ''}${path.join(' → ')}`);
  }
} else if (cmd === 'writes') {
  // Кто пишет глобальные хранилища (присваивание, ++, delete, push/splice/set…, Object.assign). С cut.json — писатели,
  // которые станут недостижимыми (✝): если у хранилища остались только они, данные перестанут обновляться.
  const cfgA = args.find(a => a.endsWith('.json')), only = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
  const R = cfgA ? computeReach(loadCfg(cfgA)) : null;
  const W = new Map();
  for (const n of nodes) for (const g of n.w || []) { if (!W.has(g)) W.set(g, []); W.get(g).push(n); }
  const names = only.length ? only : [...W.keys()].filter(g => { const d = nodeOf(g); return d && d.kind !== 'function' && d.kind !== 'stmt'; }).sort();
  for (const g of names) {
    const ws = W.get(g) || [], live = R ? ws.filter(n => R.seen.has(n)) : ws;
    if (R && !only.length && live.length === ws.length) continue;   // с cut.json — только хранилища, потерявшие писателей
    const d = nodeOf(g);
    console.log(`${g}  (${d ? where(d) : '?'})${R ? `  живых писателей ${live.length}/${ws.length}` : ''}\n  ` + ws.map(n => (R && !R.seen.has(n) ? '✝' : '') + keyOf(n)).join(', '));
  }
} else if (cmd === 'free') {
  // Свободные имена: не локальные, не объявленные в клиентских файлах и не встроенные браузера — после удаления
  // функции здесь всплывает каждая оставшаяся ссылка на неё (в коде и в inline on*="…" строк).
  const BUILTIN = new Set(Object.getOwnPropertyNames(globalThis).concat(('window document navigator location localStorage sessionStorage history ' +
    'alert confirm prompt requestAnimationFrame cancelAnimationFrame ResizeObserver IntersectionObserver MutationObserver CSS getComputedStyle ' +
    'matchMedia screen innerWidth innerHeight scrollX scrollY scrollTo devicePixelRatio HTMLElement Element Node Event CustomEvent KeyboardEvent ' +
    'FileReader Blob File FormData Image Option caches indexedDB Notification ALL module exports event this self top parent opener ' +
    'getSelection print open close focus blur name status').split(' ')));
  const out = new Map();
  const add = (nm, where) => { if (!out.has(nm)) out.set(nm, new Set()); out.get(nm).add(where); };
  for (const n of nodes) {
    if (n.name === '@index.html') continue;
    const isLocal = (nm, sc) => { for (let i = sc.length - 1; i >= 0; i--) if (sc[i].has(nm)) return true; return false; };
    const W = keyOf(n) + ' (' + where(n) + ')';
    (function walk(x, sc) {
      if (!x || typeof x.type !== 'string') return;
      switch (x.type) {
        case 'Identifier': if (!isLocal(x.name, sc) && !GLOBALS.has(x.name) && !BUILTIN.has(x.name)) add(x.name, W); return;
        case 'MemberExpression': walk(x.object, sc); if (x.computed) walk(x.property, sc); return;
        case 'Property': case 'MethodDefinition': case 'PropertyDefinition': if (x.computed) walk(x.key, sc); walk(x.value, sc); return;
        case 'LabeledStatement': walk(x.body, sc); return;
        case 'BreakStatement': case 'ContinueStatement': return;
        case 'VariableDeclaration': x.declarations.forEach(d => walk(d.init, sc)); return;
        case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': { const nm = ['arguments']; x.params.forEach(p => patNames(p, nm)); if (x.type === 'FunctionExpression' && x.id) nm.push(x.id.name); if (x.body.type === 'BlockStatement') hoisted(x.body, nm); walk(x.body, sc.concat([new Set(nm)])); return; }
        case 'BlockStatement': case 'StaticBlock': { const s2 = sc.concat([new Set(blockNames(x.body))]); x.body.forEach(y => walk(y, s2)); return; }
        case 'SwitchStatement': { walk(x.discriminant, sc); const s2 = sc.concat([new Set(blockNames([].concat(...x.cases.map(c => c.consequent))))]); x.cases.forEach(c => { walk(c.test, s2); c.consequent.forEach(y => walk(y, s2)); }); return; }
        case 'ForStatement': { let s2 = sc; if (x.init && x.init.type === 'VariableDeclaration' && x.init.kind !== 'var') { const nm = []; x.init.declarations.forEach(d => patNames(d.id, nm)); s2 = sc.concat([new Set(nm)]); } walk(x.init, s2); walk(x.test, s2); walk(x.update, s2); walk(x.body, s2); return; }
        case 'ForInStatement': case 'ForOfStatement': { let s2 = sc; if (x.left.type === 'VariableDeclaration' && x.left.kind !== 'var') { const nm = []; x.left.declarations.forEach(d => patNames(d.id, nm)); s2 = sc.concat([new Set(nm)]); } walk(x.left, s2); walk(x.right, s2); walk(x.body, s2); return; }
        case 'CatchClause': walk(x.body, sc.concat([new Set(patNames(x.param, []))])); return;
        case 'Literal': case 'TemplateLiteral': {
          const s = x.type === 'Literal' ? (typeof x.value === 'string' ? x.value : '') : x.quasis.map(q => q.value.cooked || '').join(' ');
          for (const h of s.match(/\bon[a-z]+\s*=\s*["'][^"']*/gi) || []) { let m; const re = /(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g; while ((m = re.exec(h.replace(/^on[a-z]+\s*=\s*["']/i, ' ')))) { const nm = m[2]; if (!GLOBALS.has(nm) && !BUILTIN.has(nm) && !/^(if|for|while|switch|return|function|typeof|new)$/.test(nm)) add(nm + ' ″', W); } }
          if (x.type === 'TemplateLiteral') x.expressions.forEach(e => walk(e, sc));
          return; }
      }
      KIDS(x).forEach(k => walk(k, sc));
    })(n.n, []);
  }
  // index.html: inline-обработчики
  for (const h of HTML.match(/\son[a-z]+="[^"]*"/g) || []) { let m; const re = /(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g; while ((m = re.exec(h))) { const nm = m[2]; if (!GLOBALS.has(nm) && !BUILTIN.has(nm) && !/^on[a-z]+$/.test(nm) && !/^(if|for|while|typeof|new)$/.test(nm)) add(nm + ' ″', 'index.html'); } }
  if (!out.size) console.log('Свободных имён нет.');
  for (const [nm, w] of [...out].sort()) console.log(`${nm}\t← ${[...w].slice(0, 6).join(', ')}${w.size > 6 ? ` …+${w.size - 6}` : ''}`);
} else if (cmd === 'ids') {
  const all = new Map();
  const add = (id, k, n) => { if (!all.has(id)) all.set(id, { c: [], r: [] }); all.get(id)[k].push(keyOf(n) + ' (' + where(n) + ')'); };
  nodes.forEach(n => { n.idsC.forEach(id => add(id, 'c', n)); n.idsR.forEach(id => add(id, 'r', n)); });
  const want = args.length ? args : [...all.keys()].sort();
  for (const id of want) { const e = all.get(id) || { c: [], r: [] }; console.log(`#${id}\n  создаёт: ${e.c.join(', ') || '—'}\n  читает: ${e.r.join(', ') || '—'}`); }
} else if (cmd === 'css') {
  const fileArg = (args.find(a => a.startsWith('--file=')) || '--file=styles.css').slice(7);
  const css = fs.readFileSync(path.join(ROOT, fileArg), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const cls = new Map();
  let m; const re = /\.(-?[A-Za-z_][\w-]*)/g;
  // только селекторная часть правил (до `{`), не значения
  for (const sel of css.split('}').map(b => b.split('{')[0])) { re.lastIndex = 0; while ((m = re.exec(sel))) { if (/^\d/.test(m[1])) continue; cls.set(m[1], (cls.get(m[1]) || 0) + 1); } }
  const texts = FILES.map(f => [f, SRC[f]]).concat([['index.html', HTML]]);
  const rows = [];
  for (const [c, k] of cls) {
    const rx = new RegExp('(^|[^\\w-])' + c.replace(/[-]/g, '\\-') + '(?![\\w-])');
    const where = texts.filter(([, s]) => rx.test(s)).map(([f]) => f);
    rows.push([c, k, where]);
  }
  rows.sort((a, b) => a[2].length - b[2].length || a[0].localeCompare(b[0]));
  for (const [c, k, w] of rows) console.log(`.${c}\t${k}\t${w.join(',') || '— (не найден в JS/HTML: проверить динамический префикс)'}`);
} else {
  console.log('Режимы: who <имя…> | reach [cut.json] | ids [id…] | css [--file=styles.css] | json');
}
if (dup.length && cmd !== 'json') console.error('\n(повторные объявления: ' + dup.join('; ') + ')');

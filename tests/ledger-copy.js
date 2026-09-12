#!/usr/bin/env node
// Стенд «проверка на копии ledger» (блок E, plans/ledger-model-e.md §4.E0 п.4 и §5).
// НЕ входит в tests/run.sh: нужна копия личных данных (вне репозитория, ~/dash-ledger-copies/).
//
// Грузит клиентские скрипты из index.html (data.js … desk-gloss.js) в node vm с заглушками tests/env-stubs.js —
// дважды: рабочее дерево (HEAD) и --ref=<git ref> (исходники через `git show`). В каждой версии:
// applyRemoteState(копия) — без currentUser/syncReady, push не уходит; renderAll/renderPF3 заглушены, init() настоящий
// (aiPlaybookEnsure/fixCompanyNames меняют данные и в браузере) → snapshotState(). Часы в vm заморожены (одни на обе версии).
//
//   node tests/ledger-copy.js <copy.json | --bundle> [--ref=HEAD] [--expect-drop=k1,k2,data.*.count] [--expect-add=cv] [--loose]
//
// Отчёт:
//   I0 снапшот   — ref и HEAD равны, кроме путей из --expect-drop (в ref есть, в HEAD нет) и --expect-add (в HEAD появились);
//                  путь — ключи через точку, `*` — любой ключ уровня (data.*.count). --loose: I0 только печатается.
//   I1 факты     — по каждой вкладке tk/qty/buy/ccy/price строк + cashFree; pfTrades, posMeta, planRules, desk, deskWatch,
//                  aiPort, aiPlaybook, news, cycleOvr — равны между ref и HEAD (кроме путей --expect-drop).
//   I2 идемпот.  — snapshot(apply(snapshot(apply(copy)))) === snapshot(apply(copy)) в HEAD.
//   I3 контракт  — headers[0..15] каждой вкладки с rows = заголовкам Портфеля 3.0 (для E2; только отчёт).
//   I4 размер    — длина JSON (знаки и байты UTF-8) всего/по ключам/по полям вкладок, запас до 1024 КБ (только отчёт).
// Выход 0 — I0 (если не --loose), I1, I2 зелёные; 1 — иначе; 2 — ошибка запуска.
// --bundle: вместо копии — снапшот встроенного data.js после migrateState()+init() в HEAD (самопроверка стенда).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RT_LIMIT = 1024 * 1024;   // Supabase Postgres Changes: больше — payload без больших полей
const E5_LIMIT = 600 * 1024;    // порог плана E5 (AI-отчёты вне ledger)
const PF3_KEY = '🚀 Портфель 3.0';
const FACT_KEYS = ['pfTrades', 'posMeta', 'planRules', 'desk', 'deskWatch', 'aiPort', 'aiPlaybook', 'news', 'cycleOvr'];
const AI_TOP = ['stockAiLog', 'aiChat'], AI_TAB = ['aiHistory', 'analysis'];

// ── аргументы ──
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const list = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
const ref = opt('ref', 'HEAD');
const expectDrop = list(opt('expect-drop', '')), expectAdd = list(opt('expect-add', ''));
const loose = args.includes('--loose'), bundle = args.includes('--bundle');
const copyPath = args.find(x => !x.startsWith('--'));
if (!bundle && !copyPath) {
  console.error('usage: node tests/ledger-copy.js <copy.json | --bundle> [--ref=HEAD] [--expect-drop=…] [--expect-add=…] [--loose]');
  process.exit(2);
}

// ── исходники версии ──
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
function readSrc(version, file) {
  return version === 'work' ? fs.readFileSync(path.join(ROOT, file), 'utf8') : git('show', version + ':' + file);
}
function scriptList(version) {   // порядок — как в index.html этой версии; только локальные .js с ?v=
  const html = readSrc(version, 'index.html');
  const out = [], re = /<script[^>]+src="([A-Za-z0-9_./-]+\.js)\?v=[^"]*"/g;
  let m; while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// ── загрузка версии в vm ──
const T0 = Date.now();
function loadVersion(version) {
  const ctx = vm.createContext({ console: { log() {}, info() {}, warn() {}, error() {}, debug() {} } });
  vm.runInContext(`(()=>{ const R=Date, T=${T0};
    class D extends R { constructor(...a){ if(a.length) super(...a); else super(T); } static now(){ return T; } }
    globalThis.Date=D; })();`, ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'env-stubs.js'), 'utf8'), ctx, { filename: 'env-stubs.js' });
  const files = scriptList(version);
  const src = files.map(f => readSrc(version, f).replace(/\n(boot|deskBoot)\(\);\s*$/, '\n')).join('\n;\n');
  vm.runInContext(src, ctx, { filename: version + ':bundle.js' });
  // Рендер — вне стенда (DOM-заглушки); init() остаётся настоящим. Тосты — в лог.
  vm.runInContext(`renderAll=function(){}; renderPF3=function(){}; if(typeof deskRender==='function') deskRender=function(){};
    toast=function(m){ globalThis.__toasts=(globalThis.__toasts||[]).concat(String(m)); };`, ctx);
  return { ctx, files, run: code => vm.runInContext(code, ctx) };
}
function applySnap(V, obj) {   // applyRemoteState(clone) → JSON снапшота
  V.ctx.__in = JSON.stringify(obj);
  return V.run('applyRemoteState(JSON.parse(__in)); JSON.stringify(snapshotState())');
}

// ── пути и сравнение ──
const J = x => JSON.stringify(x);
function matchPaths(obj, pat) {   // все существующие пути по шаблону a.*.b
  const parts = pat.split('.'), out = [];
  (function walk(o, i, acc) {
    if (i === parts.length) { out.push(acc); return; }
    if (!o || typeof o !== 'object') return;
    const keys = parts[i] === '*' ? Object.keys(o) : (Object.prototype.hasOwnProperty.call(o, parts[i]) ? [parts[i]] : []);
    keys.forEach(k => walk(o[k], i + 1, acc.concat(k)));
  })(obj, 0, []);
  return out;
}
function delPath(obj, p) { let o = obj; for (let i = 0; i < p.length - 1; i++) { o = o && o[p[i]]; } if (o && typeof o === 'object') delete o[p[p.length - 1]]; }
function stripPaths(obj, pats) { const c = JSON.parse(J(obj)); pats.forEach(pt => matchPaths(c, pt).forEach(p => delPath(c, p))); return c; }
function diffPaths(a, b, pre, out, depth) {   // первые расхождения до глубины depth
  if (out.length >= 40) return out;
  if (J(a) === J(b)) return out;
  const obj = x => x && typeof x === 'object' && !Array.isArray(x);
  if (depth > 0 && obj(a) && obj(b)) {
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => {
      const p = pre ? pre + '.' + k : k;
      if (!(k in a)) out.push('+ ' + p);
      else if (!(k in b)) out.push('- ' + p);
      else diffPaths(a[k], b[k], p, out, depth - 1);
    });
  } else out.push('≠ ' + (pre || '(корень)'));
  return out;
}
function facts(s) {
  const f = { tabs: {} };
  Object.keys(s.data || {}).forEach(t => {
    const d = s.data[t]; if (!d || !Array.isArray(d.rows)) return;
    f.tabs[t] = { cashFree: d.cashFree === undefined ? null : d.cashFree,
      rows: d.rows.map(r => [r[2], r[6], r[9], r[8], r[7]]) };   // tk qty buy ccy price
  });
  FACT_KEYS.forEach(k => { f[k] = s[k] === undefined ? null : s[k]; });
  return f;
}

// ── прогон ──
let V_HEAD, V_REF;
try { V_HEAD = loadVersion('work'); } catch (e) { console.error('HEAD (рабочее дерево) не загрузился:', e.message); process.exit(2); }
try { V_REF = loadVersion(ref); } catch (e) { console.error(`--ref=${ref} не загрузился:`, e.message); process.exit(2); }

let copy;
if (bundle) copy = JSON.parse(V_HEAD.run('migrateState(); init(); JSON.stringify(snapshotState())'));
else { copy = JSON.parse(fs.readFileSync(copyPath, 'utf8')); if (copy && copy.data && copy.data.data && !copy.pfTrades) copy = copy.data; }
if (!copy || typeof copy !== 'object' || !copy.data) { console.error('копия не похожа на снапшот ledger (нет ключа data)'); process.exit(2); }

const headS1 = applySnap(V_HEAD, copy), headS2 = applySnap(V_HEAD, JSON.parse(headS1));
const refS1 = applySnap(V_REF, copy);
const H = JSON.parse(headS1), R = JSON.parse(refS1);
let bad = 0;
const line = s => console.log(s);
line(`Стенд копии ledger: ${bundle ? 'бандл data.js' : copyPath}  ·  HEAD=рабочее дерево vs ref=${ref}` +
     (copy.rev != null ? `  ·  rev копии ${copy.rev}` : '') + (copy.cv ? `  ·  cv копии ${copy.cv}` : '  ·  cv копии нет (записал клиент до E0)'));
const fl = V_HEAD.files.join(' ') === V_REF.files.join(' ') ? V_HEAD.files.length + ' файлов' : `HEAD ${V_HEAD.files.length} / ref ${V_REF.files.length} файлов (списки различаются)`;
line(`Скрипты: ${fl}`);

// I0
{
  const r0 = stripPaths(R, expectDrop), h0 = stripPaths(H, expectAdd);
  const d = diffPaths(r0, h0, '', [], 3);
  const stillThere = expectDrop.flatMap(p => matchPaths(H, p).map(x => x.join('.')));
  const notAdded = expectAdd.filter(p => !matchPaths(H, p).length);
  const ok = !d.length && !stillThere.length && !notAdded.length;
  line(`\nI0 снапшот ref → HEAD: ${ok ? '✔ равны' : (loose ? '⚠ расходятся (--loose)' : '✘ расходятся')}` +
       (expectDrop.length ? `  (ожидаемо удалены: ${expectDrop.join(', ')})` : '') + (expectAdd.length ? `  (ожидаемо добавлены: ${expectAdd.join(', ')})` : ''));
  d.forEach(x => line('   ' + x));
  stillThere.forEach(x => line('   ✘ ожидали удаление, но есть в HEAD: ' + x));
  notAdded.forEach(x => line('   ✘ ожидали появление, но нет в HEAD: ' + x));
  if (!ok && !loose) bad++;
}
// I1
{
  const fr = facts(stripPaths(R, expectDrop)), fh = facts(stripPaths(H, expectDrop));
  const d = diffPaths(fr, fh, '', [], 2);
  line(`\nI1 первичные факты ref → HEAD: ${d.length ? '✘ расходятся' : '✔ равны'}  (${Object.keys(fh.tabs).length} вкладок с rows, ` +
       `${Object.values(fh.tabs).reduce((n, t) => n + t.rows.length, 0)} строк, ${Array.isArray(fh.pfTrades) ? fh.pfTrades.length : 0} сделок)`);
  d.forEach(x => line('   ' + x));
  if (d.length) bad++;
}
// I2
{
  const ok = headS1 === headS2;
  line(`\nI2 идемпотентность apply∘snapshot (HEAD): ${ok ? '✔' : '✘ второй проход меняет снапшот'}`);
  if (!ok) diffPaths(H, JSON.parse(headS2), '', [], 3).forEach(x => line('   ' + x));
  const refOk = refS1 === applySnap(V_REF, JSON.parse(refS1));
  if (!refOk) line('   (для сведения: и в ref второй проход меняет снапшот)');
  if (!ok) bad++;
}
// I3
{
  const pf = H.data && H.data[PF3_KEY], head = pf && Array.isArray(pf.headers) ? pf.headers.slice(0, 16) : null;
  if (!head) line(`\nI3 контракт строки: — нет вкладки «${PF3_KEY}» с headers`);
  else {
    const viol = [];
    Object.keys(H.data).forEach(t => {
      const d = H.data[t]; if (!d || !Array.isArray(d.rows) || t === PF3_KEY) return;
      const h = Array.isArray(d.headers) ? d.headers : [];
      const bad16 = head.map((x, i) => h[i] === x ? null : `${i}: «${h[i] === undefined ? '∅' : h[i]}» ≠ «${x}»`).filter(Boolean);
      if (bad16.length) viol.push(`${t} (${d.rows.length} строк): ` + bad16.slice(0, 4).join('; ') + (bad16.length > 4 ? ` … ещё ${bad16.length - 4}` : ''));
    });
    line(`\nI3 контракт строки headers[0..15] = «${PF3_KEY}»: ${viol.length ? '⚠ нарушителей ' + viol.length : '✔ все вкладки'}`);
    viol.forEach(x => line('   ' + x));
  }
}
// I4
{
  const kb = n => (n / 1024).toFixed(1) + ' КБ';
  const bytes = s => Buffer.byteLength(s, 'utf8');
  const tot = bytes(headS1);
  line(`\nI4 размер снапшота HEAD: ${headS1.length} знаков · ${kb(tot)} UTF-8 (компактный JSON; jsonb::text в Postgres длиннее — пробелы после «:» и «,»)`);
  line(`   запас до лимита realtime 1024 КБ: ${kb(RT_LIMIT - tot)} (${(100 * tot / RT_LIMIT).toFixed(0)} % занято)` + (tot >= RT_LIMIT ? '  ✘ realtime уже не несёт data' : ''));
  const rows = Object.keys(H).map(k => [k, bytes(J(H[k]))]).sort((a, b) => b[1] - a[1]);
  line('   по ключам (топ 12): ' + rows.slice(0, 12).map(([k, n]) => `${k} ${kb(n)}`).join(' · '));
  const tf = [];
  Object.keys(H.data || {}).forEach(t => { const d = H.data[t]; if (d && typeof d === 'object') Object.keys(d).forEach(f => tf.push([t + ' → ' + f, bytes(J(d[f]))])); });
  tf.sort((a, b) => b[1] - a[1]);
  line('   вкладка → поле (топ 10): ' + tf.slice(0, 10).map(([k, n]) => `${k} ${kb(n)}`).join(' · '));
  const ai = AI_TOP.reduce((n, k) => n + (H[k] === undefined ? 0 : bytes(J(H[k]))), 0) +
             tf.filter(([k]) => AI_TAB.some(f => k.endsWith(' → ' + f))).reduce((n, [, b]) => n + b, 0);
  const e5 = tot >= E5_LIMIT || ai > tot / 2;
  line(`   AI-отчёты (stockAiLog, aiChat, data.*.aiHistory/analysis): ${kb(ai)} = ${(100 * ai / tot).toFixed(0)} %  →  ` +
       (e5 ? 'порог E5 превышен (≥ 600 КБ или AI > 50 %) — писать план E5' : 'порог E5 не превышен'));
}
const toasts = V_HEAD.run('globalThis.__toasts||[]');
if (toasts.length) line(`\n(тосты HEAD во время прогона: ${toasts.length} — ${toasts.slice(0, 3).join(' | ')})`);
line(`\n${bad ? '✘ СТЕНД: есть расхождения (' + bad + ')' : '✔ СТЕНД: I0/I1/I2 зелёные'}`);
process.exit(bad ? 1 : 0);

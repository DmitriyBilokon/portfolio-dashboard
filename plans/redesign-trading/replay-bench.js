// P0.5 (plans/stock-selection-ux.md §16): офлайн-реплей вердикта SIG текущей версии по всей вселенной data.js
// с ориентирами — итог в plans/signals-calibration.md §8. Код приложения, воркер и SIG.CFG не меняются.
// Запуск из корня репо:  node plans/redesign-trading/replay-bench.js [--range=5y] [--amount=50000] [--k=10]
//                          [--boot=1000] [--tabs=OMXS30,Nasdaq 100] [--seed=7]
//   --range   — окно свечей воркера (5y по плану; 2y — как реплей S5, §7);
//   --amount  — фиксированная сумма сделки в kr для комиссии (tradeFeeNative, курс FX по умолчанию app.js);
//   --k       — сколько случайных входов на одну сделку SIG (ориентир «г»);
//   --boot    — число бутстрэп-выборок по бумагам для 90 % интервала.
// Ориентиры на тех же бумагах и датах: (а) удержание той же стороны — на том же окне, что сделка, и на
// фиксированный срок 20/60 баров после входа против безусловного форварда той же бумаги (чистый край входа);
// (б) индекс ^GSPC (USD) / ^OMX (SEK), для EUR/NOK — только абсолютный результат; (в) вход по SMA-тренду
// (лонг: цена > SMA200 и SMA50 > SMA200; шорт — зеркально) с той же лестницей выхода simTrade;
// (г) случайный бар той же бумаги и стороны с той же лестницей (рыночный план tradePlan).
// Причинность: только evalAt/indicators (тест «evalAt causal»), без таргетов и отчётов в истории.
// Свечи: воркер ?history=SYM&range=…, кэш ~/.cache/dash-whatif (2y — SYM.json, общий с whatif-signals.js;
// другие окна — SYM@<range>.json). Удалить файл/папку, чтобы обновить.
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..', '..'), CACHE = path.join(os.homedir(), '.cache', 'dash-whatif');
const PROXY = 'https://telegram-notify-abc.dmitriy-bilokon.workers.dev';
const arg = (k, d) => { const a = process.argv.slice(2).find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const RANGE = arg('range', '5y'), AMOUNT = +arg('amount', 50000), K = +arg('k', 10), BOOT = +arg('boot', 1000), SEED = +arg('seed', 7);
const ONLY = arg('tabs', '').split(',').map(s => s.trim()).filter(Boolean);
const H = [20, 60];   // горизонты форварда, баров

const load = src => { const m = { exports: {} }; new Function('module', 'exports', src)(m, m.exports); return m.exports; };
const SIG = load(fs.readFileSync(path.join(ROOT, 'signals.js'), 'utf8'));

// Функции приложения берутся из исходников как есть (не копия формул): exSymbol, tradeFeeNative, FX, DESK_IDEA_CFG,
// deskRiskLevel. grab — блок от маркера до парной «}» (строки и //-комментарии пропускаются).
function grab(src, marker) {
  const s = src.indexOf(marker); if (s < 0) throw new Error('нет в исходнике: ' + marker);
  let depth = 0, q = null;
  for (let i = src.indexOf('{', s); i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (ch === '{') depth++; else if (ch === '}' && --depth === 0) return src.slice(s, i + 1);
  }
  throw new Error('не закрыт блок: ' + marker);
}
const line = (src, re) => { const m = src.match(re); if (!m) throw new Error('нет строки: ' + re); return m[0]; };
const APP = (() => {
  const a = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), a5 = fs.readFileSync(path.join(ROOT, 'app-5.js'), 'utf8'), dk = fs.readFileSync(path.join(ROOT, 'desk.js'), 'utf8');
  const code = [line(a, /^let FX=\{.*\};$/m), line(a, /^const SYMBOL_OVERRIDES = .*$/m), grab(a, 'function exSymbol('),
    line(a, /^const COURTAGE_MIN=.*$/m), line(a, /^const COURTAGE_PCT=.*$/m), grab(a, 'function tradeFeeNative('),
    grab(a5, 'const DESK_IDEA_CFG={') + ';', line(dk, /^const deskRiskWord=.*$/m), grab(dk, 'function deskRiskLevel(')].join('\n');
  return new Function('RT', code + '\nreturn {FX, exSymbol, tradeFeeNative, DESK_IDEA_CFG, deskRiskLevel};')((ru) => ru);
})();

// Вселенная: все вкладки сида data.js; валюта/суффикс — как migrateIndexV3 в app.js, символ — exSymbol.
const TAB_CCY = { 'OMXS30': ['SEK'], 'Nasdaq 100': ['USD'], 'OMXSPI': ['SEK'], 'S&P 500': ['USD'], 'DAX 40': ['EUR'], 'CAC 40': ['EUR', '.PA'], 'FTSE MIB': ['EUR', '.MI'], 'OBX 25': ['NOK'] };
const MKT = { USD: 'US', SEK: 'SE', EUR: 'EU', NOK: 'NO' }, BENCH = { USD: '^GSPC', SEK: '^OMX' };
globalThis.ALL = undefined; new Function(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8').replace(/^const ALL=/m, 'globalThis.ALL='))();
const U = [], seen = {}, skippedTabs = [];
for (const tab of Object.keys(ALL.data)) {
  if (ONLY.length && !ONLY.includes(tab)) continue;
  const m = TAB_CCY[tab]; if (!m) { skippedTabs.push(tab); continue; }
  const [ccy, sfx] = m;
  for (const r of ALL.data[tab].rows) {
    const tk0 = String(r[2] || '').trim(); if (!tk0) continue;
    const tk = sfx && !tk0.includes('.') ? tk0.replace(/\s+/g, '-') + sfx : tk0, sym = APP.exSymbol(tk, ccy), key = sym + '|' + ccy;
    if (seen[key]) { seen[key].tabs.push(tab); continue; }
    U.push(seen[key] = { key, sym, ccy, mkt: MKT[ccy] || ccy, tabs: [tab] });
  }
}

async function fetchBars(sym) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, (RANGE === '2y' ? sym : sym + '@' + RANGE) + '.json');
  if (!fs.existsSync(f)) {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(`${PROXY}/?history=${encodeURIComponent(sym)}&range=${RANGE}`);
        if (r.ok) { const t = await r.text(), j = JSON.parse(t); if (Array.isArray(j.c) && j.c.length) { fs.writeFileSync(f, t); break; } }
      } catch (e) { }
      await new Promise(ok => setTimeout(ok, 1500 * (a + 1)));
    }
    if (!fs.existsSync(f)) return null;
  }
  try { return SIG.barsFromHist(JSON.parse(fs.readFileSync(f, 'utf8'))).filter(b => b.d); } catch (e) { return null; }
}
async function pool(items, n, fn) { const out = new Array(items.length); let k = 0; await Promise.all(Array.from({ length: n }, async () => { while (k < items.length) { const i = k++; out[i] = await fn(items[i]); } })); return out; }

// Детерминированный ГПСЧ (mulberry32) — случайные входы и бутстрэп воспроизводимы.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Комиссия по модели приложения: открытие на всю сумму, каждый выход — на свою часть по цене выхода.
// Количество — дробное (фиксированная сумма), шорт: открытие = продажа, закрытие = покупка. Займ шорта не учтён.
// noFx — без валютной комиссии (чувствительность «валютный счёт»): только courtage + налог.
function netPct(t, ccy, noFx) {
  const sgn = t.side === 'long' ? 1 : -1, fx = APP.FX[ccy] || 1, notional = AMOUNT / fx, F = f => noFx ? f.total - f.fx : f.total;
  let fee = F(APP.tradeFeeNative(ccy, notional, sgn > 0)), gross = 0;
  for (const x of t.exits) { gross += x.part * sgn * (x.px / t.entry - 1); fee += F(APP.tradeFeeNative(ccy, x.part * notional * x.px / t.entry, sgn < 0)); }
  return (gross - fee / notional) * 100;
}
function holdPct(entry, exit, side, ccy) {   // удержание той же стороны: одна покупка/продажа в начале и конце окна
  const sgn = side === 'long' ? 1 : -1, fx = APP.FX[ccy] || 1, notional = AMOUNT / fx;
  const fee = APP.tradeFeeNative(ccy, notional, sgn > 0).total + APP.tradeFeeNative(ccy, notional * exit / entry, sgn < 0).total;
  return (sgn * (exit / entry - 1) - fee / notional) * 100;
}
// Запись сделки: R без комиссии (как SIG.replayStats), R и % после комиссии, окно, форварды.
function rec(u, bars, ind, t, extra) {
  const sgn = t.side === 'long' ? 1 : -1, risk = sgn * (t.entry - t.stop0), pct = t.open ? null : netPct(t, u.ccy);
  const gross = t.open ? null : t.exits.reduce((s, x) => s + x.part * sgn * (x.px / t.entry - 1), 0) * 100;
  const o = { sec: u.key, mkt: u.mkt, ccy: u.ccy, side: t.side, i: t.i, d: t.d, open: t.open, Rg: t.R, Rn: t.open ? null : pct / 100 * t.entry / risk, pct, fee: t.open ? null : gross - pct,
    RnC: t.open ? null : netPct(t, u.ccy, true) / 100 * t.entry / risk,
    days: t.open ? null : t.out - t.i, dOut: t.open ? null : bars[t.out].d };
  if (!t.open) o.hold = holdPct(t.entry, bars[t.out].c, t.side, u.ccy);
  return Object.assign(o, extra || {});
}
const fwd = (bars, i, h, sgn) => i + h < bars.length ? sgn * (bars[i + h].c / bars[i].c - 1) * 100 : null;

async function main() {
  const t0 = Date.now();
  const benchSyms = [...new Set(U.map(u => BENCH[u.ccy]).filter(Boolean))];
  const B = {}, got = await pool(U.map(u => u.sym).concat(benchSyms), 4, fetchBars);
  U.map(u => u.sym).concat(benchSyms).forEach((s, i) => { B[s] = got[i]; });
  const IDX = {}; for (const s of benchSyms) { IDX[s] = {}; for (const b of B[s] || []) IDX[s][b.d] = b.c; }
  const idxPct = (ccy, d0, d1, sgn) => { const m = IDX[BENCH[ccy]]; if (!m || !(m[d0] > 0) || !(m[d1] > 0)) return null; return sgn * (m[d1] / m[d0] - 1) * 100; };

  const R = rng(SEED), SIGT = [], SMAT = [], RNDT = [], DAYS = [], UNC = {}, missing = [], short = [];
  let parityChecked = 0, firstD = null, lastD = null, bars0 = 0;
  for (const u of U) {
    const bars = B[u.sym];
    if (!bars) { missing.push(u.sym); continue; }
    if (bars.length < 260) { short.push(u.sym + ' (' + bars.length + ')'); continue; }
    bars0++;
    const n = bars.length, ind = SIG.indicators(bars), from = Math.max(SIG.CFG.minBars - 1, 199);
    if (!firstD || bars[from].d < firstD) firstD = bars[from].d; if (!lastD || bars[n - 1].d > lastD) lastD = bars[n - 1].d;
    // Безусловный форвард бумаги (любой бар окна реплея) — база для края входа.
    UNC[u.key] = {};
    for (const h of H) for (const sgn of [1, -1]) { let s = 0, c = 0; for (let k = from; k + h < n; k++) { s += sgn * (bars[k + h].c / bars[k].c - 1) * 100; c++; } UNC[u.key][h + (sgn > 0 ? 'L' : 'S')] = c ? s / c : null; }
    const ex = (i, side) => { const o = {}; for (const h of H) { const f = fwd(bars, i, h, side === 'long' ? 1 : -1), b = UNC[u.key][h + (side === 'long' ? 'L' : 'S')]; o['f' + h] = f; o['x' + h] = f != null && b != null ? f - b : null; } return o; };

    // 1) Реплей SIG — та же логика, что SIG.replay (вход на смене вердикта на buy/short, без перекрытия), но с
    //    атрибутами снимка на баре входа и вердиктом каждого бара (для «всех дней в buy»).
    let prev = null, busy = -1; const mine = [];
    for (let i = from; i < n; i++) {
      const s = SIG.evalAt(bars, ind, i, { shortOk: true }), v = s.verdict;
      if (v === 'buy' || v === 'short') DAYS.push(Object.assign({ sec: u.key, mkt: u.mkt, side: s.side, i, d: bars[i].d }, ex(i, s.side)));
      if ((v === 'buy' || v === 'short') && v !== prev && i > busy && i < n - 1) {
        const t = SIG.simTrade(bars, ind, i, s.side, s.plan);
        if (t) {
          mine.push(t); busy = t.open ? n : t.out;
          const risk = APP.deskRiskLevel(s, { plan: s.plan });
          // Чувствительность: вход по открытию следующего бара с тем же стопом/целью (гэп за стоп → вход не состоялся).
          const nb = bars.slice(); nb[i] = Object.assign({}, bars[i], { c: bars[i + 1].o });
          const tn = SIG.simTrade(nb, ind, i, s.side, s.plan);
          SIGT.push(rec(u, bars, ind, t, Object.assign({ phase: s.phase.key, risk: risk.auto, atrTg: s.plan.flags.includes('atr-target'), half: s.plan.flags.includes('half'), wide: s.plan.flags.includes('wide'), rr: s.plan.rr,
            idx: t.open ? null : idxPct(u.ccy, bars[i].d, bars[t.out].d, t.side === 'long' ? 1 : -1),
            nextOpen: tn ? (tn.open ? { open: true } : { pct: netPct(tn, u.ccy), R: tn.R }) : { skip: true } }, ex(i, t.side))));
        }
      }
      prev = v;
    }
    if (parityChecked < 25) {   // паритет с SIG.replay: те же входы и R
      const rp = SIG.replay(bars, { ind }).trades, bad = rp.length !== mine.length || rp.some((t, k) => t.i !== mine[k].i || Math.abs(t.R - mine[k].R) > 1e-12);
      if (bad) throw new Error('паритет с SIG.replay нарушен: ' + u.sym); parityChecked++;
    }
    // 2) Ориентир «в»: SMA-тренд, вход на смене условия (как у SIG — на смене вердикта), без перекрытия, рыночный план.
    for (const side of ['long', 'short']) {
      let was = null, bz = -1;
      for (let i = from; i < n; i++) {
        const c = bars[i].c, s50 = ind.s50[i], s200 = ind.s200[i], cond = side === 'long' ? c > s200 && s50 > s200 : c < s200 && s50 < s200;
        if (cond && was === false && i > bz && i < n - 1 && ind.atr[i] > 0) {
          const t = SIG.simTrade(bars, ind, i, side, SIG.tradePlan(side, SIG.levelsAt(bars, i, ind), ind.atr[i], {}));
          if (t) { SMAT.push(rec(u, bars, ind, t, Object.assign({ idx: t.open ? null : idxPct(u.ccy, bars[i].d, bars[t.out].d, side === 'long' ? 1 : -1) }, ex(i, side)))); bz = t.open ? n : t.out; }
        }
        was = cond;
      }
    }
    // 3) Ориентир «г»: K случайных баров на каждую сделку SIG той же бумаги и стороны, та же лестница, рыночный план.
    for (const t of mine) for (let r = 0; r < K; r++) {
      const i = from + Math.floor(R() * (n - 1 - from)); if (!(ind.atr[i] > 0)) continue;
      const tr = SIG.simTrade(bars, ind, i, t.side, SIG.tradePlan(t.side, SIG.levelsAt(bars, i, ind), ind.atr[i], {}));
      if (tr) RNDT.push(rec(u, bars, ind, tr, Object.assign({ rep: r, idx: tr.open ? null : idxPct(u.ccy, bars[i].d, bars[tr.out].d, t.side === 'long' ? 1 : -1) }, ex(i, t.side))));
    }
  }
  const secs = (() => { const s = {}; U.forEach(u => s[u.key] = u); return s; })();
  report({ SIGT, SMAT, RNDT, DAYS, missing, short, bars0, firstD, lastD, parityChecked, benchSyms, B, secs, sec: (Date.now() - t0) / 1000 });
}

// ── Статистика ──
const sum = a => a.reduce((s, x) => s + x, 0), mean = a => a.length ? sum(a) / a.length : null;
function pf(rs) { const p = sum(rs.filter(x => x > 0)), q = -sum(rs.filter(x => x < 0)); return q > 0 ? p / q : (p > 0 ? Infinity : null); }
// Бутстрэп по бумагам: выборка бумаг с возвращением (все сделки бумаги вместе) → 5-й и 95-й перцентиль статистики.
function boot(recs, stat, seed) {
  const by = {}; recs.forEach(r => (by[r.sec] = by[r.sec] || []).push(r)); const keys = Object.keys(by); if (keys.length < 2) return null;
  const R = rng(seed || SEED), vals = [];
  for (let b = 0; b < BOOT; b++) { const s = []; for (let k = 0; k < keys.length; k++) s.push(...by[keys[Math.floor(R() * keys.length)]]); const v = stat(s); if (v != null && isFinite(v)) vals.push(v); }
  vals.sort((a, b) => a - b); if (vals.length < BOOT * 0.5) return null;
  return [vals[Math.floor(vals.length * 0.05)], vals[Math.floor(vals.length * 0.95)]];
}
const f2 = x => x == null ? '—' : !isFinite(x) ? '∞' : x.toFixed(2), f1 = x => x == null ? '—' : x.toFixed(1), pc = x => x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const ci = (c, f) => c ? ` [${f(c[0])}…${f(c[1])}]` : '';
const nsec = rs => new Set(rs.map(r => r.sec)).size;
function row(name, rs, o) {
  o = o || {}; const C = rs.filter(r => !r.open), n = C.length;
  const pfn = pf(C.map(r => r.Rn)), few = n < 30 ? ' ⚠' : '';
  const xs = C.filter(r => r.x20 != null);
  return `| ${name}${few} | ${n} (${nsec(C)}) | ${n ? Math.round(C.filter(r => r.Rn > 0).length / n * 100) + '%' : '—'} | ${f2(mean(C.map(r => r.Rg)))} / ${f2(mean(C.map(r => r.Rn)))} | ${f2(pf(C.map(r => r.Rg)))} | **${f2(pfn)}**${o.noBoot ? '' : ci(boot(C, s => pf(s.map(r => r.Rn))), f2)} | ${pc(mean(C.map(r => r.pct)))} | ${f1(mean(C.map(r => r.days)))} | ${xs.length ? pc(mean(xs.map(r => r.x20))) + (o.noBoot ? '' : ci(boot(xs, s => mean(s.map(r => r.x20))), pc)) : '—'} |`;
}
const HEAD = '| группа | сделок (бумаг) | в плюсе | ср. R без / после комиссии | PF без комиссии | PF после комиссии [90 %] | ср. % после комиссии | дней | край входа 20д [90 %] |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|';

function report(X) {
  const { SIGT, SMAT, RNDT, DAYS } = X, L = s => s.side === 'long', S = s => s.side === 'short';
  const out = [];
  const P = s => out.push(s);
  P(`## Реплей SIG ${SIG.VER} с ориентирами (P0.5) — окно ${RANGE}, сумма сделки ${AMOUNT} kr`);
  P(`Вселенная: ${U.length} бумаг из data.js (${Object.keys(TAB_CCY).filter(t => !ONLY.length || ONLY.includes(t)).join(', ')}), со свечами ≥ 260 баров: ${X.bars0}; нет свечей: ${X.missing.length}${X.missing.length ? ' (' + X.missing.join(', ') + ')' : ''}; коротких: ${X.short.length}${X.short.length ? ' (' + X.short.join(', ') + ')' : ''}${skippedTabs.length ? '; вкладки без валюты пропущены: ' + skippedTabs.join(', ') : ''}.`);
  P(`Входы реплея: ${X.firstD} … ${X.lastD}. Индексы: ${X.benchSyms.map(s => s + ' ' + ((X.B[s] || []).length) + ' баров').join(', ')}. Паритет с SIG.replay: ${X.parityChecked} бумаг — входы и R совпадают. Время ${X.sec.toFixed(0)} с.`);
  P('');
  P('### 1. Вход SIG против ориентиров (лестница выхода у всех одна — simTrade)');
  P(HEAD);
  P(row('SIG лонг (buy)', SIGT.filter(L))); P(row('в: SMA-тренд лонг', SMAT.filter(L))); P(row(`г: случайный лонг (×${K})`, RNDT.filter(L)));
  P(row('SIG шорт (short)', SIGT.filter(S))); P(row('в: SMA-тренд шорт', SMAT.filter(S))); P(row(`г: случайный шорт (×${K})`, RNDT.filter(S)));
  P(row('SIG все', SIGT));
  const open = SIGT.filter(r => r.open).length; P(`\nОткрытых на конец окна (не в статистике): SIG ${open}. «Край входа 20д» — форвард 20 баров после входа той же стороны минус безусловный 20-дн форвард этой бумаги на окне реплея (не зависит от выхода). ⚠ — меньше 30 закрытых сделок.`);

  P('\n### 2. Край входа: форвард после сигнала против любого дня той же бумаги');
  P('| выборка | наблюдений (бумаг) | форвард 20д | безусл. 20д | край 20д [90 %] | край 60д [90 %] | доля с краем 20д > 0 |\n|---|---:|---:|---:|---:|---:|---:|');
  const fw = (name, rs) => { const a = rs.filter(r => r.x20 != null), b = rs.filter(r => r.x60 != null);
    P(`| ${name} | ${a.length} (${nsec(a)}) | ${pc(mean(a.map(r => r.f20)))} | ${pc(mean(a.map(r => r.f20 - r.x20)))} | ${pc(mean(a.map(r => r.x20)))}${ci(boot(a, s => mean(s.map(r => r.x20))), pc)} | ${pc(mean(b.map(r => r.x60)))}${ci(boot(b, s => mean(s.map(r => r.x60))), pc)} | ${a.length ? Math.round(a.filter(r => r.x20 > 0).length / a.length * 100) + '%' : '—'} |`); };
  fw('SIG лонг — первый день buy (вход реплея)', SIGT.filter(L)); fw('SIG лонг — любой день в buy («Кандидаты сейчас»)', DAYS.filter(L)); fw('в: SMA-тренд лонг', SMAT.filter(L)); fw('г: случайный лонг', RNDT.filter(L));
  fw('SIG шорт — первый день short', SIGT.filter(S)); fw('SIG шорт — любой день в short', DAYS.filter(S)); fw('в: SMA-тренд шорт', SMAT.filter(S));

  P('\n### 3. Индекс и удержание на том же окне (закрытые сделки)');
  P('| выборка | сделок с индексом | ср. % сделки | ср. % индекса той же стороны | альфа [90 %] | удержание той же стороны на окне сделки | сделка − удержание [90 %] |\n|---|---:|---:|---:|---:|---:|---:|');
  const ix = (name, rs) => { const C = rs.filter(r => !r.open), a = C.filter(r => r.idx != null);
    P(`| ${name} | ${a.length} | ${pc(mean(a.map(r => r.pct)))} | ${pc(mean(a.map(r => r.idx)))} | ${pc(mean(a.map(r => r.pct - r.idx)))}${ci(boot(a, s => mean(s.map(r => r.pct - r.idx))), pc)} | ${pc(mean(C.map(r => r.hold)))} | ${pc(mean(C.map(r => r.pct - r.hold)))}${ci(boot(C, s => mean(s.map(r => r.pct - r.hold))), pc)} |`); };
  ix('SIG лонг', SIGT.filter(L)); ix('в: SMA-тренд лонг', SMAT.filter(L)); ix('г: случайный лонг', RNDT.filter(L)); ix('SIG шорт', SIGT.filter(S)); ix('в: SMA-тренд шорт', SMAT.filter(S));
  P('Индекс — ^GSPC для USD, ^OMX для SEK (EUR/NOK без индекса); сделка — после комиссии, индекс — без. «Удержание» — та же сторона от закрытия бара входа до закрытия бара последнего выхода, с комиссией.');

  P('\n### 4. Разбиения SIG (после комиссии)');
  const split = (title, key, order, lab) => { P(`\n**${title}**\n`); P(HEAD);
    for (const side of ['long', 'short']) { const rs = SIGT.filter(r => r.side === side), ks = [...new Set(rs.map(key))].sort((a, b) => (order ? order.indexOf(a) - order.indexOf(b) : String(a).localeCompare(String(b))));
      for (const k of ks) P(row(`${side === 'long' ? 'лонг' : 'шорт'} · ${lab ? lab(k) : k}`, rs.filter(r => key(r) === k))); } };
  split('Фаза на входе', r => r.phase, ['up', 'undr', 'rev', 'corr', 'imp', 'flat', 'down', 'heat', 'knife']);
  split('Уровень риска 1–5 (deskRiskLevel: ATR % + wide; отчётов/таргетов/беты в истории нет)', r => r.risk, [1, 2, 3, 4, 5]);
  split('Цель', r => r.atrTg ? 'цель без уровня (atr-target)' : 'структурная цель');
  split('Рынок', r => r.mkt, ['US', 'SE', 'EU', 'NO']);
  split('Тренд (half = ранний вход при SMA50 < SMA200, ½ риска)', r => r.half ? 'half' : 'тренд подтверждён');
  const mid = new Date((Date.parse(X.firstD) + Date.parse(X.lastD)) / 2).toISOString().slice(0, 10);
  split(`Половины окна (вход до / после ${mid})`, r => r.d < mid ? '1-я половина' : '2-я половина');

  P('\n### 5. Чувствительность (SIG, закрытые сделки)');
  const nx = SIGT.filter(r => !r.open && r.nextOpen && r.nextOpen.pct != null), sk = SIGT.filter(r => r.nextOpen && r.nextOpen.skip).length;
  for (const side of ['long', 'short']) { const a = nx.filter(r => r.side === side);
    P(`- ${side === 'long' ? 'Лонг' : 'Шорт'}: вход по открытию следующего бара (стоп/цель те же) — ${a.length} сделок, ср. ${pc(mean(a.map(r => r.nextOpen.pct)))} после комиссии против ${pc(mean(a.map(r => r.pct)))} по закрытию; PF без комиссии ${f2(pf(a.map(r => r.nextOpen.R)))} против ${f2(pf(a.map(r => r.Rg)))}.`); }
  P(`- Гэп за стоп до входа (вход не состоялся): ${sk}.`);
  const C = SIGT.filter(r => !r.open);
  for (const m of ['US', 'SE', 'EU', 'NO']) { const a = C.filter(r => r.mkt === m); if (a.length) P(`- Комиссия на ${AMOUNT} kr, ${m}: в среднем ${pc(-mean(a.map(r => r.fee)))} на сделку (${f2(mean(a.map(r => r.Rg - r.Rn)))} R).`); }
  for (const [nm, rs] of [['SIG', SIGT], ['в: SMA-тренд', SMAT], ['г: случайный', RNDT]]) {
    const q = side => { const a = rs.filter(r => !r.open && r.side === side); return `${side === 'long' ? 'лонг' : 'шорт'} ${f2(pf(a.map(r => r.RnC)))}`; };
    P(`- Без валютной комиссии (валютный счёт; только courtage), PF после комиссии — ${nm}: ${q('long')} · ${q('short')}.`); }
  console.log(out.join('\n'));
}

main().catch(e => { console.error(e); process.exit(1); });

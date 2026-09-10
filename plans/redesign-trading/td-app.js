// ───────────────────────── Nordic Trade Desk — логика прототипа (v2) ─────────────────────────
(function () {
  const FX = { USD: 9.40, SEK: 1 };            // курс к SEK — пример (в приложении приходит из refreshFX)
  const STATE = { risk: 5000, side: {}, range: 252, layers: { sma: true, zones: true, markers: true }, route: 'today', tk: 'MU', sort: { k: 'verdict', d: -1 }, f: { v: 'all', phase: 'all', idx: 'all', near: false, rr: false, q: '' }, sel: null };
  const VERD = { buy: ['▲', 'Купить', 'v-buy'], short: ['▼', 'Шорт', 'v-short'], trim: ['◆', 'Сократить', 'v-trim'], hold: ['●', 'Держать', 'v-hold'], wait: ['○', 'Ждать', 'v-wait'] };
  const VGROUP = { buy: 4, short: 4, trim: 3, hold: 2, wait: 1 };
  const PH_ICON = { knife: '⤓', down: '↘', corr: '↓', flat: '→', rev: '↗', undr: '◇', up: '↑', imp: '⇈', heat: '△' };
  const FLAG = { wide: 'широкий стоп', half: '½ риска', squeeze: 'риск сквиза', 'stale-target': 'таргет устарел', knife: 'нож' };
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const fmt = (v, d) => v == null || !isFinite(v) ? '—' : v.toLocaleString('ru-RU', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d });
  const px = (v, ccy) => fmt(v, v >= 500 ? 0 : v >= 20 ? 1 : 2) + (ccy ? ' ' + (ccy === 'USD' ? '$' : 'kr') : '');
  const kr = v => fmt(Math.round(v), 0) + ' kr';
  const pct = (v, d) => (v >= 0 ? '+' : '') + fmt(v, d == null ? 1 : d) + '%';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ── Вселенная ──
  const U = {};
  Object.keys(OHLCV).forEach(tk => { const m = OHLCV[tk]; U[tk] = { tk, name: m.name, ccy: m.ccy, sector: m.sector, idx: m.idx, fund: m.fund, bars: m.bars.map(b => ({ d: b[0], o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] })), snap: null }; });
  function snap(tk) {
    const u = U[tk], f = u.fund, last = u.bars[u.bars.length - 1].c, up = f && f.recent > 0 ? (f.recent / last - 1) * 100 : null;
    const stale = !!(f && f.avg > 0 && f.recent > 0 && Math.abs(f.avg / f.recent - 1) > 0.3);
    return SIG.snapshot(u.bars, { riskKr: STATE.risk, fx: FX[u.ccy] || 1, upTg: up, staleTarget: stale });
  }
  function recompute() { Object.keys(U).forEach(tk => { U[tk].snap = snap(tk); }); }
  recompute();
  const list = () => Object.values(U);
  const pill = v => { const p = VERD[v] || VERD.wait; return `<span class="pill ${p[2]}">${p[0]} ${p[1]}</span>`; };
  const sidePill = s => `<span class="pill ${s === 'short' ? 'side-short' : 'side-long'}">${s === 'short' ? '▼ Шорт' : '▲ Лонг'}</span>`;
  const phaseTag = s => `<span class="tag" title="${s.trendUp ? 'SMA50 выше SMA200' : 'SMA50 ниже SMA200'}">${PH_ICON[s.phase.key] || ''} ${esc(s.phase.label)} <span class="muted">${s.trendUp ? '↑' : '↓'}</span></span>`;
  const dayHtml = d => `<span class="num">${pct(d, 2)}</span>`;
  const flagsHtml = s => (s.flags || []).filter(f => FLAG[f]).map(f => `<span class="flag">${FLAG[f]}</span>`).join(' ');
  const inBook = tk => BOOK.some(p => p.tk === tk);

  // ── Спарклайн: одна краска (ink2), заливка 10 %, точка на конце ──
  function spark(bars, n, w, h) {
    n = n || 60; w = w || 300; h = h || 44;
    const c = bars.slice(-n).map(b => b.c), mn = Math.min(...c), mx = Math.max(...c), rng = mx - mn || 1;
    const X = i => (i / (c.length - 1)) * (w - 6) + 3, Y = v => h - 4 - ((v - mn) / rng) * (h - 8);
    const pts = c.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="${X(0).toFixed(1)},${h} ${pts} ${X(c.length - 1).toFixed(1)},${h}" fill="var(--ink2)" opacity=".08"/><polyline points="${pts}" fill="none" stroke="var(--ink2)" stroke-width="1.5" stroke-linejoin="round"/><circle cx="${X(c.length - 1).toFixed(1)}" cy="${Y(c[c.length - 1]).toFixed(1)}" r="3" fill="var(--ink)" stroke="var(--panel)" stroke-width="2"/></svg>`;
  }
  function mktStatus() {
    const now = new Date(), f = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
    const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value])), hm = +p.hour * 60 + +p.minute, wd = !/lör|sön/.test(p.weekday);
    return { se: wd && hm >= 540 && hm < 1050, us: wd && hm >= 930 && hm < 1320, t: `${p.hour}:${p.minute}` };
  }
  const dateRu = () => new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // ── Демо-книга позиций (пример; не данные пользователя). stop0 — стоп на момент входа (для R), stop — текущий ──
  const BOOK = [
    { tk: 'MU', side: 'long', qty: 12, entry: 620, stop0: 560, stop: 900, target: 1200, opened: '2026-04-28' },
    { tk: 'NVDA', side: 'long', qty: 40, entry: 181, stop0: 168, stop: 197, target: 235, opened: '2026-06-16' },
    { tk: 'INVE-B.ST', side: 'long', qty: 200, entry: 372, stop0: 358, stop: 381, target: 427, opened: '2026-03-11' },
    { tk: 'EQT.ST', side: 'long', qty: 150, entry: 296, stop0: 284, stop: 305, target: 353, opened: '2026-06-25' },
    { tk: 'NKE', side: 'short', qty: 100, entry: 44.2, stop0: 47.5, stop: 47.5, target: 34, opened: '2026-08-12' },
    { tk: 'HM-B.ST', side: 'short', qty: 300, entry: 174, stop0: 181, stop: 181, target: 150, opened: '2026-08-27' },
  ];
  const CASH = 150000, RISK_CAP_PCT = 6, RISK_PCT = 1;
  // Риск на сделку по умолчанию = 1 % капитала (акции по текущим ценам + кэш), округлённо до 100 kr.
  const CAP0 = CASH + BOOK.reduce((s, p) => { const u = U[p.tk]; return s + p.qty * u.bars[u.bars.length - 1].c * (FX[u.ccy] || 1); }, 0);
  STATE.risk = Math.max(500, Math.round(CAP0 * RISK_PCT / 100 / 100) * 100);
  recompute();
  function posCalc(p) {
    const u = U[p.tk], s = u.snap, now = s.price, fx = FX[u.ccy] || 1, dir = p.side === 'short' ? -1 : 1, stop0 = p.stop0 || p.stop;
    const pl = (now - p.entry) * dir * p.qty, plPct = (now / p.entry - 1) * dir * 100, val = now * p.qty;
    const toStop = dir * (now - p.stop) / now * 100, toTgt = dir * (p.target - now) / now * 100, r1 = Math.abs(p.entry - stop0);
    const rNow = r1 > 0 ? (now - p.entry) * dir / r1 : 0, riskKr = Math.max(0, dir * (now - p.stop)) * p.qty * fx;
    const span = Math.abs(p.target - p.stop), pos = Math.max(0, Math.min(1, dir * (now - p.stop) / span)), posEntry = Math.max(0, Math.min(1, dir * (p.entry - p.stop) / span));
    let act = 'hold', note = 'держать по плану';
    if (toStop <= 0) { act = 'exit'; note = 'стоп пробит — закрыть'; }
    else if (toTgt <= 0) { act = 'take'; note = 'цель достигнута — фиксировать'; }
    else if (s.verdict === 'trim' && dir === 1) { act = 'trim'; note = 'перегрев — сократить часть'; }
    else if (rNow >= 1 && dir * (p.stop - p.entry) < 0) { act = 'be'; note = '+1R: перенести стоп в безубыток'; }
    else if (toStop <= 2) { act = 'watch'; note = `до стопа ${toStop.toFixed(1)}% — на контроле`; }
    return { ...p, stop0, u, s, now, fx, pl, plKr: pl * fx, plPct, val, valKr: val * fx, toStop, toTgt, rNow, riskKr, pos, posEntry, act, note };
  }

  // ── Бэктест ПЛАНА по ретро-входам (стоп/цель по High/Low, time-stop 15 баров) ──
  function backtestAll() {
    const T = [];
    list().forEach(u => SIG.backtestPlans(u.bars, u.snap.ind, STATE.risk, FX[u.ccy] || 1).forEach(t => T.push({ ...t, tk: u.tk, name: u.name })));
    T.sort((a, b) => b.out.localeCompare(a.out));
    const closed = T.filter(t => t.exitWhy !== 'открыта'), wins = closed.filter(t => t.R > 0), loss = closed.filter(t => t.R <= 0);
    const sumR = a => a.reduce((s, t) => s + t.R, 0);
    return { T, closed, n: closed.length, win: closed.length ? wins.length / closed.length * 100 : 0, avgR: closed.length ? sumR(closed) / closed.length : 0, pf: loss.length && sumR(loss) < 0 ? sumR(wins) / -sumR(loss) : null, byExit: closed.reduce((m, t) => { m[t.exitWhy] = (m[t.exitWhy] || 0) + 1; return m; }, {}) };
  }

  // ── Тема графика — из CSS-токенов ──
  function chartTheme() {
    const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
    const rgba = (hex, a) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
    const long = g('--long'), short = g('--short');
    return { font: g('--mono') || 'monospace', ink: g('--ink'), text2: g('--ink2'), muted: g('--muted'), grid: g('--grid'), up: long, down: short, volUp: rgba(long, .3), volDown: rgba(short, .3), sma50: g('--sma50'), sma100: g('--sma100'), sma200: g('--sma200'), zoneSup: rgba(long, .08), zoneSupLine: rgba(long, .5), zoneRes: rgba(short, .08), zoneResLine: rgba(short, .5), entry: g('--ink'), stop: short, target: long, long, short, exit: g('--warn'), rsi: g('--rsi'), rsiBand: g('--grid') };
  }

  // ── Маршрутизация ──
  function go(r, tk) { location.hash = tk ? `#${r}/${tk}` : `#${r}`; }
  let CH = null;
  function route() {
    const h = location.hash.replace('#', ''), [r, tk] = h.split('/');
    STATE.route = ['today', 'screen', 'stock', 'book', 'journal'].includes(r) ? r : 'today';
    if (tk && U[tk]) STATE.tk = tk;
    $$('.nav').forEach(b => b.classList.toggle('on', b.dataset.r === STATE.route));
    if (CH) { CH.destroy(); CH = null; }
    ({ today: rToday, screen: rScreen, stock: rStock, book: rBook, journal: rJournal })[STATE.route]();
    window.scrollTo(0, 0);
  }
  function top(title, sub) {
    const m = mktStatus();
    return `<div class="top"><div><h1>${title}</h1><div class="sub">${sub}</div></div>
      <div class="mkt"><span class="chip ${m.se ? 'open' : ''}"><i></i>Стокгольм ${m.se ? 'открыт' : 'закрыт'}</span><span class="chip ${m.us ? 'open' : ''}"><i></i>США ${m.us ? 'открыт' : 'закрыт'}</span><span class="chip num">${m.t} CET</span></div>
      <div style="position:relative"><label class="search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="q" placeholder="Тикер или компания" autocomplete="off"><span class="k">/</span></label><div class="sugg" id="sugg" hidden></div></div></div>`;
  }
  function wireSearch() {
    const q = $('#q'), sg = $('#sugg'); if (!q) return; let cur = 0;
    const paint = () => { const v = q.value.trim().toLowerCase(); if (!v) { sg.hidden = true; return; } const hits = list().filter(u => u.tk.toLowerCase().includes(v) || u.name.toLowerCase().includes(v)).slice(0, 8); sg.innerHTML = hits.map((u, i) => `<div class="${i === cur ? 'on' : ''}" data-tk="${u.tk}"><b>${u.tk}</b><span>${esc(u.name)}</span><span class="muted" style="margin-left:auto">${u.idx}</span></div>`).join(''); sg.hidden = !hits.length; };
    q.addEventListener('input', () => { cur = 0; paint(); });
    q.addEventListener('keydown', e => { const n = sg.children.length; if (e.key === 'ArrowDown') { cur = (cur + 1) % n; paint(); e.preventDefault(); } else if (e.key === 'ArrowUp') { cur = (cur - 1 + n) % n; paint(); e.preventDefault(); } else if (e.key === 'Enter') { const el = sg.children[cur]; if (el) go('stock', el.dataset.tk); } else if (e.key === 'Escape') { sg.hidden = true; q.blur(); } });
    sg.addEventListener('mousedown', e => { const el = e.target.closest('[data-tk]'); if (el) go('stock', el.dataset.tk); });
    q.addEventListener('blur', () => setTimeout(() => { sg.hidden = true; }, 150));
  }

  // ── План сделки: ячейки и панель ──
  function planCells(p) {
    return `<div class="plan"><div class="ent"><div class="lbl">${p.mode === 'limit' ? 'Лимит' : 'Вход'}</div><b class="num">${px(p.entry)}</b>${p.mode === 'limit' ? `<div class="muted num" style="font-size:10px">${pct(p.dEntry, 1)} от цены</div>` : ''}</div><div class="stp"><div class="lbl">Стоп</div><b class="num">${px(p.stop)}</b><div class="muted num" style="font-size:10px">${pct(-p.riskPct, 1)}</div></div><div class="tgt"><div class="lbl">Цель</div><b class="num">${px(p.target)}</b><div class="muted num" style="font-size:10px">${pct(p.rewardPct, 1)}</div></div><div><div class="lbl">R/R · размер</div><b class="num">${fmt(p.rr, 1)}</b> <span class="muted num" style="font-size:11px">· ${p.qty} шт</span></div></div>`;
  }
  function planBox(u, s, side, p) {
    return `<div class="plan-box">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${pill(s.verdict)}${phaseTag(s)}${flagsHtml(s)}<span class="muted" style="margin-left:auto;font-size:12px">${p.mode === 'limit' ? `лимит у ${esc(p.levelSrc || 'уровня')} · ${pct(p.dEntry, 1)}` : 'по рынку'}</span></div>
      <div class="plan-row"><div class="e"><div class="lbl">${p.mode === 'limit' ? 'Лимит' : 'Вход'}</div><b class="num">${px(p.entry)}</b></div><div class="s"><div class="lbl">Стоп · ${esc(p.stopSrc)}</div><b class="num">${px(p.stop)}</b><div class="muted num" style="font-size:11px">${pct(-p.riskPct, 1)}</div></div><div class="t"><div class="lbl">Цель · ${esc(p.targetSrc)}</div><b class="num">${px(p.target)}</b><div class="muted num" style="font-size:11px">${pct(p.rewardPct, 1)}</div></div></div>
      <div class="rr"><span class="big num">${fmt(p.rr, 2)}</span><span class="muted">R/R</span><span class="meter"><i class="risk" style="width:${100 / (1 + (p.rr || 0))}%"></i><i class="rew" style="width:${100 - 100 / (1 + (p.rr || 0))}%"></i></span></div>
      <div class="risk-in"><span>Риск на сделку</span><input class="risk" type="number" step="500" min="500" value="${STATE.risk}"><span>kr</span><span style="margin-left:auto">→ <b class="num" style="color:var(--ink)">${p.qty} шт</b> · <span class="num">${kr(p.notionalKr)}</span>${p.flags.includes('half') ? ' <span class="flag">½</span>' : ''}</span></div>
      <div class="note">размер = риск ÷ (вход − стоп) × курс${u.ccy === 'USD' ? ` · USD/SEK ${FX.USD.toFixed(2)} (пример)` : ''}. Стоп за структурным уровнем с буфером ${SIG.CFG.stopBufAtr}·ATR, дистанция ${SIG.CFG.minStopAtr}–${SIG.CFG.maxStopAtr}·ATR; цель — ближайший уровень ≥ ${SIG.CFG.minTargetAtr}·ATR в коридоре ${SIG.CFG.corridorAtr}·ATR; вход при R/R ≥ ${SIG.CFG.rrMin}, при ${SIG.CFG.rrWeak}–${SIG.CFG.rrMin} — лимит, дающий ${SIG.CFG.rrGood}.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri" data-arm="${u.tk}">${p.mode === 'limit' ? 'Взвести лимит' : 'Добавить в план'}</button><button class="btn" data-journal="${u.tk}">Записать сделку</button></div></div>`;
  }
  function card(u) {
    const s = u.snap, p = s.plan;
    return `<article class="card ${VERD[s.verdict][2]}" data-tk="${u.tk}" tabindex="0">
      <div class="hd"><span class="tk">${u.tk}</span><span class="nm">${esc(u.name)}</span><div class="px"><b class="num">${px(s.price, u.ccy)}</b><br>${dayHtml(s.day)}</div></div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${pill(s.verdict)}${phaseTag(s)}<span class="tag">${u.idx}</span>${flagsHtml(s)}</div>
      ${spark(u.bars)}
      <div class="why">${esc(s.why[0] || '')}${s.why[1] ? `<br><span class="muted">${esc(s.why[1])}</span>` : ''}</div>
      ${planCells(p)}
      <div class="ft"><span>RSI ${fmt(s.rsi, 0)}</span><span>·</span><span>ATR ${fmt(s.atrPct, 1)}%</span><span>·</span><span>объём ×${fmt(s.volX, 1)}</span><button class="btn sm" data-open="${u.tk}">Открыть →</button></div>
    </article>`;
  }

  // ═══════════════════ Сегодня ═══════════════════
  function rToday() {
    const L = list();
    const gsort = (a, b) => (VGROUP[b.snap.verdict] - VGROUP[a.snap.verdict]) || ((b.snap.plan.rr || 0) - (a.snap.plan.rr || 0)) || (b.snap.score - a.snap.score);
    const entries = L.filter(u => u.snap.verdict === 'buy' || u.snap.verdict === 'short').sort(gsort);
    const P = BOOK.map(posCalc), attn = P.filter(p => p.act !== 'hold'), trims = P.filter(p => p.act === 'trim' || p.act === 'take');
    const waiting = L.filter(u => (u.snap.verdict === 'wait' || u.snap.verdict === 'hold') && u.snap.plan.mode === 'limit' && Math.abs(u.snap.plan.dEntry) <= 8 && u.snap.plan.rr >= SIG.CFG.rrWeak && !u.snap.flags.includes('knife')).sort((a, b) => Math.abs(a.snap.plan.dEntry) - Math.abs(b.snap.plan.dEntry)).slice(0, 8);
    const rest = L.filter(u => !entries.includes(u) && !waiting.includes(u));
    const reasons = { knife: rest.filter(u => u.snap.phase.key === 'knife').length, heat: rest.filter(u => u.snap.verdict === 'trim').length, rr: rest.filter(u => u.snap.setup && u.snap.plan.rr < SIG.CFG.rrWeak).length, squeeze: rest.filter(u => u.snap.flags.includes('squeeze')).length };
    reasons.none = rest.length - reasons.knife - reasons.heat - reasons.rr - reasons.squeeze;
    $('#main').innerHTML = top('Сегодня', `${dateRu()} · вселенная ${L.length} бумаг · риск на сделку <b class="num">${kr(STATE.risk)}</b>`) + `
      <div class="grid g4" style="margin-bottom:20px">
        <div class="panel stat"><div class="lbl">Сетапов на вход</div><div class="v num">${entries.length}</div><div class="d">${entries.filter(u => u.snap.side === 'long').length} лонг · ${entries.filter(u => u.snap.side === 'short').length} шорт · R/R ≥ ${SIG.CFG.rrMin}</div></div>
        <div class="panel stat"><div class="lbl">Ждать уровня</div><div class="v num">${waiting.length}</div><div class="d">лимит в пределах 8 % от цены</div></div>
        <div class="panel stat"><div class="lbl">Позиции требуют действия</div><div class="v num">${attn.length}<span class="muted" style="font-size:14px">/${P.length}</span></div><div class="d">стоп · цель · безубыток · сократить</div></div>
        <div class="panel stat"><div class="lbl">Отсеяно</div><div class="v num">${rest.length}</div><div class="d">${[reasons.knife ? `${reasons.knife} нож` : '', reasons.heat ? `${reasons.heat} перегрев` : '', reasons.rr ? `${reasons.rr} R/R < ${SIG.CFG.rrWeak}` : '', reasons.squeeze ? `${reasons.squeeze} сквиз` : '', reasons.none ? `${reasons.none} без сетапа` : ''].filter(Boolean).join(' · ') || '—'}</div></div>
      </div>
      <div class="cols">
        <div>
          <section style="margin-bottom:22px"><div class="ph" style="border:0;padding:0 0 10px"><h2>Вход сегодня</h2><span class="cnt">${entries.length}</span><span class="note" style="margin-left:auto">откат к поддержке в тренде · отбой от сопротивления в даунтренде · R/R ≥ ${SIG.CFG.rrMin} по рынку</span></div>
            ${entries.length ? `<div class="deck">${entries.map(card).join('')}</div>` : '<div class="panel empty">Сетапов с R/R ≥ 1.5 по рынку нет — смотрите «Ждать уровня».</div>'}</section>
          <section class="panel" style="margin-bottom:22px"><div class="ph"><h2>Ждать уровня</h2><span class="cnt">${waiting.length}</span><span class="note" style="margin-left:auto">лимит у структурного уровня или цена, при которой R/R = ${SIG.CFG.rrGood}; «Взвести» → уведомление при касании</span></div>
            ${waiting.length ? `<div class="wrap"><table class="tbl"><thead><tr><th>Бумага</th><th>Сторона</th><th class="r">Цена</th><th class="r">Лимит</th><th class="r">Δ вход</th><th class="r">Стоп</th><th class="r">Цель</th><th class="r">R/R</th><th class="r">Размер</th><th></th></tr></thead><tbody>${waiting.map(u => { const s = u.snap, p = s.plan; return `<tr class="row" data-open="${u.tk}"><td><span class="tk">${u.tk}</span><span class="nm">${esc(u.name)}</span><div class="note">${esc(s.why[0] || '')}</div></td><td>${sidePill(s.side)}</td><td class="r num">${px(s.price)}</td><td class="r num" style="font-weight:600">${px(p.entry)}</td><td class="r num">${pct(p.dEntry, 1)}</td><td class="r num dn">${px(p.stop)}</td><td class="r num up">${px(p.target)}</td><td class="r num" style="font-weight:600">${fmt(p.rr, 1)}</td><td class="r num">${p.qty} шт</td><td><button class="btn sm" data-arm="${u.tk}">Взвести</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">Нет бумаг с лимитом в пределах 8 % от цены.</div>'}</section>
          <section class="panel"><div class="ph"><h2>Сократить в книге</h2><span class="cnt">${trims.length}</span><span class="note" style="margin-left:auto">перегрев или достигнутая цель по открытым позициям; перегрев вне книги — только флаг в скринере</span></div>
            ${trims.length ? `<div class="wrap"><table class="tbl">${trims.map(p => `<tr class="row" data-open="${p.tk}"><td><span class="tk">${p.tk}</span><span class="nm">${esc(p.u.name)}</span></td><td>${sidePill(p.side)}</td><td class="r num">${px(p.now)}</td><td class="r num" style="font-weight:600">${pct(p.plPct)}</td><td class="r num">${(p.rNow >= 0 ? '+' : '') + fmt(p.rNow, 1)}R</td><td>${pill('trim')}</td><td class="ink2">${esc(p.note)}</td></tr>`).join('')}</table></div>` : '<div class="empty">В книге нет перегретых позиций.</div>'}</section>
        </div>
        <aside class="panel"><div class="ph"><h2>Позиции — внимание</h2><span class="demo">демо</span></div>
          ${attn.length ? attn.map(p => `<div style="padding:10px 16px;border-bottom:1px solid var(--line);cursor:pointer" data-open="${p.tk}"><div style="display:flex;gap:8px;align-items:center"><span class="tk">${p.tk}</span>${sidePill(p.side)}<span class="num" style="margin-left:auto;font-weight:600">${pct(p.plPct)}</span></div><div class="note" style="margin-top:4px">${esc(p.note)} · до стопа <b class="num">${fmt(p.toStop, 1)}%</b> · до цели <b class="num">${fmt(p.toTgt, 1)}%</b> · <b class="num">${(p.rNow >= 0 ? '+' : '') + fmt(p.rNow, 1)}R</b></div></div>`).join('') : '<div class="empty">Все позиции в рамках плана.</div>'}
          <div style="padding:10px 16px"><button class="btn sm" data-r="book">Все позиции →</button></div>
        </aside>
      </div>`;
    wireSearch();
  }

  // ═══════════════════ Скринер ═══════════════════
  function screenRows() {
    const f = STATE.f, q = f.q.toLowerCase();
    let R = list().filter(u => { const s = u.snap;
      if (f.v === 'buy' && s.verdict !== 'buy') return false; if (f.v === 'short' && s.verdict !== 'short') return false; if (f.v === 'trim' && s.verdict !== 'trim') return false; if (f.v === 'wait' && !(s.verdict === 'wait' || s.verdict === 'hold')) return false;
      if (f.phase !== 'all' && s.phase.key !== f.phase) return false;
      if (f.idx !== 'all' && u.idx !== f.idx) return false;
      if (f.near && !s.near) return false;
      if (f.rr && !((s.plan.rr || 0) >= SIG.CFG.rrMin)) return false;
      if (q && !(u.tk.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))) return false;
      return true; });
    const k = STATE.sort.k, d = STATE.sort.d, val = u => { const s = u.snap; return { tk: u.tk, price: s.price, day: s.day, phase: s.phase.rank, near: s.near ? Math.abs(s.near.dist) : 99, rr: s.plan.rr || 0, score: s.score, verdict: VGROUP[s.verdict] * 1000 + (s.plan.rr || 0) * 10 + s.score / 100, dEntry: Math.abs(s.plan.dEntry) }[k]; };
    R.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * d; });
    return R;
  }
  function rScreen() {
    const f = STATE.f, opt = (arr, cur) => arr.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
    const phases = [['all', 'Все фазы'], ['up', '↑ Аптренд'], ['imp', '⇈ Импульс'], ['heat', '△ Перегрев'], ['corr', '↓ Коррекция'], ['rev', '↗ Разворот'], ['flat', '→ Боковик'], ['down', '↘ Даунтренд'], ['knife', '⤓ Нож']];
    $('#main').innerHTML = top('Скринер', 'вся вселенная · вердикт → R/R → балл · j / k / Enter — клавиатура') + `
      <div class="filters">
        <div class="seg" id="fv">${[['all', 'Все'], ['buy', '▲ Купить'], ['short', '▼ Шорт'], ['trim', '◆ Сократить'], ['wait', '○ Ждать']].map(([v, l]) => `<button class="${f.v === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
        <select id="fphase">${opt(phases, f.phase)}</select>
        <select id="fidx">${opt([['all', 'Все индексы'], ['OMXS30', 'OMXS30'], ['Nasdaq 100', 'Nasdaq 100']], f.idx)}</select>
        <span class="toggle ${f.near ? 'on' : ''}" id="fnear">у уровня ≤ 2 %</span><span class="toggle ${f.rr ? 'on' : ''}" id="frr">R/R ≥ ${SIG.CFG.rrMin}</span>
        <span class="note" style="margin-left:auto" id="fcnt"></span>
      </div>
      <div class="scr ${STATE.sel ? 'open' : ''}" id="scr"><div class="panel wrap" id="scrTbl"></div><aside class="drawer" id="drawer"></aside></div>`;
    paintTable(); wireSearch();
    $('#fv').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; f.v = b.dataset.v; rScreen(); });
    ['phase', 'idx'].forEach(k => $('#f' + k).addEventListener('change', e => { f[k] = e.target.value; paintTable(); }));
    $('#fnear').addEventListener('click', () => { f.near = !f.near; rScreen(); }); $('#frr').addEventListener('click', () => { f.rr = !f.rr; rScreen(); });
  }
  function paintTable() {
    const R = screenRows(), cols = [['tk', 'Бумага'], ['price', 'Цена', 'r'], ['day', '1д', 'r'], ['phase', 'Фаза · тренд'], ['near', 'Ближайший уровень'], ['dEntry', 'Вход · Стоп · Цель', 'r'], ['rr', 'R/R', 'r'], ['score', 'Балл', 'r'], ['verdict', 'Вердикт']];
    const th = cols.map(([k, l, a]) => `<th class="${a || ''} ${STATE.sort.k === k ? 's' : ''}" data-k="${k}">${l}${STATE.sort.k === k ? `<span class="ar">${STATE.sort.d > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('');
    $('#fcnt').textContent = `${R.length} из ${list().length}`;
    $('#scrTbl').innerHTML = `<table class="tbl"><thead><tr>${th}</tr></thead><tbody>${R.map(u => { const s = u.snap, p = s.plan;
      return `<tr class="row ${STATE.sel === u.tk ? 'on' : ''}" data-sel="${u.tk}"><td><span class="tk">${u.tk}</span><span class="nm">${esc(u.name)}</span>${inBook(u.tk) ? ' <span class="tag">в книге</span>' : ''}</td><td class="r num">${px(s.price)}<span class="muted" style="font-size:10px"> ${u.ccy === 'USD' ? '$' : 'kr'}</span></td><td class="r">${dayHtml(s.day)}</td><td>${phaseTag(s)}</td><td>${s.near ? `<span class="tag">${esc(s.near.src.replace(/\+/g, ' · '))}</span> <span class="num muted">${pct(s.near.dist, 1)}</span>` : '<span class="muted">—</span>'}</td><td class="r num" style="font-size:12px">${p.mode === 'limit' ? `<span class="tag">лимит ${pct(p.dEntry, 1)}</span> ` : ''}<span>${px(p.entry)}</span> · <span class="dn">${px(p.stop)}</span> · <span class="up">${px(p.target)}</span></td><td class="r num" style="font-weight:600">${fmt(p.rr, 1)}</td><td class="r"><span class="bar"><i style="width:${s.score}%"></i></span> <span class="num">${s.score}</span></td><td>${pill(s.verdict)} ${flagsHtml(s)}</td></tr>`; }).join('')}</tbody></table>${R.length ? '' : '<div class="empty">Ничего не подходит под фильтры.</div>'}`;
    $$('#scrTbl th').forEach(h => h.addEventListener('click', () => { const k = h.dataset.k; if (STATE.sort.k === k) STATE.sort.d *= -1; else { STATE.sort.k = k; STATE.sort.d = (k === 'tk' || k === 'dEntry' || k === 'near') ? 1 : -1; } paintTable(); }));
    if (STATE.sel && U[STATE.sel]) drawer(STATE.sel);
  }
  function drawer(tk) {
    const u = U[tk], s = u.snap, side = STATE.side[tk] || s.side, p = s.plans[side], scr = $('#scr'), dr = $('#drawer'); if (!dr) return;
    scr.classList.add('open');
    dr.innerHTML = `<div class="panel"><div class="ph"><h2><span class="tk">${u.tk}</span> <span class="nm">${esc(u.name)}</span></h2><div class="act"><div class="seg side" id="dside"><button class="${side === 'long' ? 'on long' : ''}" data-v="long">Лонг</button><button class="${side === 'short' ? 'on short' : ''}" data-v="short">Шорт</button></div><button class="btn sm" id="dclose" aria-label="Закрыть">✕</button></div></div>
      <div class="chart-panel"><div class="mini" id="dchart"></div></div>
      <div style="border-top:1px solid var(--line)">${planBox(u, s, side, p)}<div style="padding:0 16px 12px"><div class="why-list" style="padding:0 0 10px">${s.why.map(w => `<div>${esc(w)}</div>`).join('')}</div><button class="btn" data-open="${u.tk}">Открыть страницу акции →</button></div></div></div>`;
    if (CH) { CH.destroy(); CH = null; }
    CH = renderStockChart($('#dchart'), u.bars, s, { side, plan: p, theme: chartTheme(), bars: 120 });
    $('#dside').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; STATE.side[tk] = b.dataset.v; drawer(tk); });
    $('#dclose').addEventListener('click', () => { STATE.sel = null; scr.classList.remove('open'); if (CH) { CH.destroy(); CH = null; } $$('#scrTbl tr.on').forEach(r => r.classList.remove('on')); });
    wireRisk(() => drawer(tk));
  }
  function wireRisk(after) { $$('input.risk').forEach(inp => inp.addEventListener('change', e => { STATE.risk = Math.max(500, +e.target.value || 5000); recompute(); after(); })); }

  // ═══════════════════ Акция ═══════════════════
  function rStock() {
    const u = U[STATE.tk], s = u.snap, held = BOOK.find(p => p.tk === u.tk), pc = held ? posCalc(held) : null, side = STATE.side[u.tk] || (held ? held.side : s.side), p = s.plans[side], f = u.fund;
    const lv = s.levels, ladder = [...lv.res.filter(x => x.kind !== 'pivot').slice(0, 3).reverse().map(x => ({ ...x, k: 'res' })), { v: s.price, src: 'цена', k: 'now' }, ...lv.sup.filter(x => x.kind !== 'pivot').slice(0, 3).map(x => ({ ...x, k: 'sup' }))];
    const fundRow = f ? `<div class="kv"><span class="lbl">Таргет аналитиков</span><span class="v num">${f.recent ? `${px(f.recent)} <span class="muted">свежий (${f.recentCount})</span>` : '—'}</span>${f.avg ? `<span class="lbl">Средний за всё время</span><span class="v num muted">${px(f.avg)} ${s.flags.includes('stale-target') ? '<span class="flag">устар.</span>' : ''}</span>` : ''}<span class="lbl">P/E</span><span class="v num">${fmt(f.pe, 1)}</span><span class="lbl">ROE</span><span class="v num">${f.roe != null ? fmt(f.roe, 0) + '%' : '—'}</span><span class="lbl">Рост выручки</span><span class="v num">${f.revg != null ? pct(f.revg, 0) : '—'}</span><span class="lbl">Beta</span><span class="v num">${fmt(f.beta, 2)}</span><span class="lbl">D/E</span><span class="v num">${fmt(f.de, 2)}</span></div>` : `<div class="empty" style="padding:14px 16px;text-align:left">Фундаментал для этой бумаги в прототип не загружен.</div>`;
    const ACT = { exit: ['▼ закрыть', 'v-short'], take: ['◆ фиксировать', 'v-trim'], trim: ['◆ сократить', 'v-trim'], be: ['● стоп в б/у', 'v-hold'], watch: ['○ у стопа', 'v-wait'], hold: ['● по плану', 'v-hold'] };
    const posPanel = pc ? `<div class="panel"><div class="ph"><h2>Открытая позиция</h2>${sidePill(pc.side)}<span class="demo" style="margin-left:auto">демо</span></div>
      <div class="plan-box">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pill ${ACT[pc.act][1]}">${ACT[pc.act][0]}</span><span class="ink2" style="font-size:13px">${esc(pc.note)}</span></div>
        <div class="plan-row"><div class="e"><div class="lbl">Вход · ${pc.opened}</div><b class="num">${px(pc.entry)}</b><div class="muted num" style="font-size:11px">${pc.qty} шт</div></div><div class="s"><div class="lbl">Стоп · было ${px(pc.stop0)}</div><b class="num">${px(pc.stop)}</b><div class="muted num" style="font-size:11px">до стопа ${fmt(pc.toStop, 1)}%</div></div><div class="t"><div class="lbl">Цель</div><b class="num">${px(pc.target)}</b><div class="muted num" style="font-size:11px">до цели ${fmt(pc.toTgt, 1)}%</div></div></div>
        <div class="kv" style="padding:0"><span class="lbl">P&L</span><span class="v num ${pc.plKr >= 0 ? 'up' : 'dn'}">${pct(pc.plPct)} · ${(pc.plKr >= 0 ? '+' : '') + kr(pc.plKr)}</span><span class="lbl">R сейчас (от стопа входа)</span><span class="v num">${(pc.rNow >= 0 ? '+' : '') + fmt(pc.rNow, 2)}R</span><span class="lbl">Открытый риск до стопа</span><span class="v num">${kr(pc.riskKr)}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri" data-toast="Стоп ${u.tk} перенесён в безубыток ${px(pc.entry)} (демо)">Стоп в б/у</button><button class="btn" data-toast="Трейлинг 2·ATR: стоп ${px(pc.side === 'long' ? s.price - 2 * s.atr : s.price + 2 * s.atr)} (демо)">Трейл 2·ATR</button><button class="btn" data-toast="Заявка на закрытие ${Math.round(pc.qty / 2)} шт ${u.tk} (демо)">Закрыть 50 %</button></div>
      </div></div>` : '';
    $('#main').innerHTML = top('Акция', 'график · план сделки · уровни') + `
      <div class="stock-hd"><span class="tk">${u.tk}</span><div><div style="font-weight:600">${esc(u.name)}</div><div class="muted" style="font-size:12px">${esc(u.sector)} · ${u.idx} · ${u.ccy}</div></div><span class="px num">${px(s.price, u.ccy)}</span>${dayHtml(s.day)}${pill(s.verdict)}${phaseTag(s)}${flagsHtml(s)}
        <div class="ctl"><div class="seg side" id="sside"><button class="${side === 'long' ? 'on long' : ''}" data-v="long">▲ Лонг</button><button class="${side === 'short' ? 'on short' : ''}" data-v="short">▼ Шорт</button></div>
        <div class="seg" id="srange">${[[126, '6м'], [252, '1г'], [500, '2г']].map(([n, l]) => `<button class="${STATE.range === n ? 'on' : ''}" data-v="${n}">${l}</button>`).join('')}</div></div></div>
      <div class="cols">
        <div>
          <div class="panel chart-panel"><div id="chart"></div><div class="layers"><span class="lbl" style="align-self:center">Слои</span>${[['sma', 'SMA 50/100/200'], ['zones', 'Зоны S/R'], ['markers', 'Сигналы']].map(([k, l]) => `<span class="toggle ${STATE.layers[k] ? 'on' : ''}" data-layer="${k}">${l}</span>`).join('')}<span class="note" style="margin-left:auto">${pc ? 'линии — стоп и цель открытой позиции' : 'линии — план выбранной стороны'} · ATR по High/Low (Wilder 14)</span></div></div>
          <details class="panel" style="margin-top:14px" ${pc ? '' : 'open'}><summary class="ph" style="cursor:pointer"><h2>История сигналов</h2><span class="cnt">${s.markers.length}</span><span class="note" style="margin-left:auto">последние 8 · те же правила, что и маркеры на графике</span></summary>
            <div class="wrap"><table class="tbl hist"><thead><tr><th>Дата</th><th>Сигнал</th><th class="r">Цена</th><th>Причина</th></tr></thead><tbody>${s.markers.slice(-8).reverse().map(m => `<tr><td class="num">${m.d}</td><td>${m.kind === 'buy' ? '<span class="up">▲ вход</span>' : m.kind === 'sell' ? '<span style="color:var(--warn)">▼ выход</span>' : m.kind === 'short' ? '<span class="dn">▼ шорт</span>' : '<span class="muted">▲ закрытие шорта</span>'}</td><td class="r num">${px(m.price)}</td><td class="ink2">${esc(m.why)}</td></tr>`).join('')}</tbody></table></div></details>
        </div>
        <aside style="display:grid;gap:14px">
          ${posPanel}
          ${pc ? `<details class="panel"><summary class="ph" style="cursor:pointer"><h2>Новый вход</h2>${sidePill(side)}</summary>${planBox(u, s, side, p)}</details>` : `<div class="panel"><div class="ph"><h2>План сделки</h2>${sidePill(side)}</div>${planBox(u, s, side, p)}</div>`}
          <div class="panel"><div class="ph"><h2>Сигнал</h2><span class="cnt">балл ${s.score}</span></div><div class="why-list">${s.why.map(w => `<div>${esc(w)}</div>`).join('')}</div>
            <div class="kv" style="border-top:1px solid var(--line)"><span class="lbl">Тренд</span><span class="v ${s.trendUp ? 'up' : 'dn'}">${s.trendUp ? '↑ SMA50 > SMA200' : '↓ SMA50 < SMA200'}</span><span class="lbl">RSI 14</span><span class="v num">${fmt(s.rsi, 0)}</span><span class="lbl">ATR 14</span><span class="v num">${px(s.atr)} · ${fmt(s.atrPct, 1)}%</span><span class="lbl">Объём к среднему</span><span class="v num">×${fmt(s.volX, 2)}</span><span class="lbl">К SMA200</span><span class="v num">${pct((s.price / s.s200 - 1) * 100, 1)}</span></div></div>
          <div class="panel"><div class="ph"><h2>Лестница уровней</h2><span class="note" style="margin-left:auto">структурные, без дневных пивотов</span></div><div class="ladder">${ladder.map(x => `<div class="lvl ${x.k}"><span class="z"></span><span class="src">${esc(String(x.src).replace(/\+/g, ' · '))}</span><span class="num">${px(x.v)}</span><span class="dist">${x.k === 'now' ? '' : pct((x.v / s.price - 1) * 100, 1)}</span></div>`).join('')}</div></div>
          <div class="panel"><div class="ph"><h2>Фундаментал</h2><span class="note" style="margin-left:auto">FMP / Yahoo через воркер</span></div>${fundRow}</div>
        </aside>
      </div>`;
    wireSearch();
    const draw = () => { if (CH) { CH.destroy(); CH = null; } CH = renderStockChart($('#chart'), u.bars, s, { side, plan: pc ? { entry: pc.entry, stop: pc.stop, target: pc.target, mode: 'position' } : p, theme: chartTheme(), bars: STATE.range, layers: STATE.layers }); };
    draw();
    $('#sside').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; STATE.side[u.tk] = b.dataset.v; rStock(); });
    $('#srange').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; STATE.range = +b.dataset.v; rStock(); });
    $$('[data-layer]').forEach(t => t.addEventListener('click', () => { STATE.layers[t.dataset.layer] = !STATE.layers[t.dataset.layer]; rStock(); }));
    wireRisk(rStock);
  }

  // ═══════════════════ Позиции ═══════════════════
  function rBook() {
    const P = BOOK.map(posCalc), long = P.filter(p => p.side === 'long'), short = P.filter(p => p.side === 'short');
    const sum = (a, k) => a.reduce((s, p) => s + p[k], 0), gross = sum(long, 'valKr') + sum(short, 'valKr'), net = sum(long, 'valKr') - sum(short, 'valKr'), plKr = sum(P, 'plKr'), risk = sum(P, 'riskKr'), cap = gross + CASH, riskPct = risk / cap * 100;
    const ACT = { exit: ['▼ закрыть', 'v-short'], take: ['◆ фиксировать', 'v-trim'], trim: ['◆ сократить', 'v-trim'], be: ['● стоп в б/у', 'v-hold'], watch: ['○ у стопа', 'v-wait'], hold: ['● по плану', 'v-hold'] };
    $('#main').innerHTML = top('Позиции', 'книга лонг/шорт · риск и экспозиция · <span class="demo">демо-данные</span>') + `
      <div class="expo">
        <div class="panel stat"><div class="lbl">Нетто экспозиция</div><div class="v num">${kr(net)}</div><div class="d">лонг − шорт</div></div>
        <div class="panel stat"><div class="lbl">Брутто</div><div class="v num">${kr(gross)}</div><div class="d">${long.length} лонг · ${short.length} шорт</div></div>
        <div class="panel stat"><div class="lbl">P&L открытых</div><div class="v num ${plKr >= 0 ? 'up' : 'dn'}">${(plKr >= 0 ? '+' : '') + kr(plKr)}</div><div class="d">по текущим ценам</div></div>
        <div class="panel stat"><div class="lbl">Открытый риск</div><div class="v num ${riskPct > RISK_CAP_PCT ? 'dn' : ''}">${kr(risk)}</div><div class="d">${fmt(riskPct, 1)}% капитала · лимит ${RISK_CAP_PCT}%<span class="bar" style="margin-left:6px"><i style="width:${Math.min(100, riskPct / RISK_CAP_PCT * 100)}%;background:${riskPct > RISK_CAP_PCT ? 'var(--short)' : 'var(--ink2)'}"></i></span></div></div>
        <div class="panel stat"><div class="lbl">Кэш</div><div class="v num">${kr(CASH)}</div><div class="d">свободно</div></div>
      </div>
      <div class="panel wrap"><table class="tbl"><thead><tr><th>Бумага</th><th>Сторона</th><th class="r">Кол-во</th><th class="r">Вход</th><th class="r">Сейчас</th><th class="r">P&L</th><th class="r">Стоп</th><th class="r">Цель</th><th>Стоп ◆ цена → цель</th><th class="r">R сейчас</th><th class="r">Риск</th><th>Действие</th></tr></thead><tbody>
        ${P.map(p => `<tr class="row" data-open="${p.tk}"><td><span class="tk">${p.tk}</span><span class="nm">${esc(p.u.name)}</span></td><td>${sidePill(p.side)}</td><td class="r num">${p.qty}</td><td class="r num">${px(p.entry)}</td><td class="r num">${px(p.now)}</td><td class="r num ${p.plKr >= 0 ? 'up' : 'dn'}" style="font-weight:600">${pct(p.plPct)}<br><span class="muted" style="font-size:11px">${(p.plKr >= 0 ? '+' : '') + kr(p.plKr)}</span></td><td class="r num dn">${px(p.stop)}<br><span class="muted" style="font-size:11px">${fmt(p.toStop, 1)}%</span></td><td class="r num up">${px(p.target)}<br><span class="muted" style="font-size:11px">${fmt(p.toTgt, 1)}%</span></td><td><span class="track" title="стоп слева, цель справа, ◆ — текущая цена, | — вход"><b style="left:${Math.round(p.posEntry * 100)}%"></b><i class="${p.toStop <= 2 ? 'danger' : ''}" style="left:${Math.round(p.pos * 100)}%"></i></span></td><td class="r num">${(p.rNow >= 0 ? '+' : '') + fmt(p.rNow, 2)}R</td><td class="r num">${kr(p.riskKr)}</td><td><span class="pill ${ACT[p.act][1]}">${ACT[p.act][0]}</span><div class="note">${esc(p.note)}</div></td></tr>`).join('')}
      </tbody></table></div>
      <p class="note" style="margin-top:12px">Позиция = сторона + вход + стоп на входе (stop0) + текущий стоп + цель + размер. P&L шорта считается зеркально; «R сейчас» — ход цены в единицах начального риска (вход − stop0), поэтому перенос стопа в безубыток его не искажает. Открытый риск считается до текущих стопов и сравнивается с лимитом книги. Учёт налога по genomsnittsmetoden не меняется: шорт закрывается парной сделкой в журнале.</p>`;
    wireSearch();
  }

  // ═══════════════════ Журнал ═══════════════════
  function rJournal() {
    const B = backtestAll();
    const bins = [-3, -2, -1, 0, 1, 2, 3, 4, 5], counts = new Array(bins.length).fill(0);
    B.closed.forEach(t => { let k = Math.floor(t.R); k = Math.max(-3, Math.min(5, k)); counts[bins.indexOf(k)]++; });
    const mx = Math.max(1, ...counts), W = 720, H = 150, bw = W / bins.length;
    const hist = `<svg class="rhist" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Распределение результатов в R">${bins.map((bn, i) => { const h = counts[i] / mx * (H - 34), x = i * bw + 6, y = H - 22 - h; return `<rect x="${x}" y="${y}" width="${bw - 12}" height="${Math.max(h, counts[i] ? 2 : 0)}" rx="3" fill="${bn < 0 ? 'var(--short)' : 'var(--long)'}" opacity=".85"/><text x="${x + (bw - 12) / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--mono)">${bn < 0 ? bn : '+' + bn}${bn === 5 ? '+' : ''}R</text>${counts[i] ? `<text x="${x + (bw - 12) / 2}" y="${y - 4}" text-anchor="middle" font-size="11" fill="var(--ink2)" font-family="var(--mono)">${counts[i]}</text>` : ''}`; }).join('')}<line x1="0" x2="${W}" y1="${H - 22}" y2="${H - 22}" stroke="var(--line2)"/></svg>`;
    $('#main').innerHTML = top('Журнал', 'бэктест плана сделки на 2 годах · вход по ретро-сигналу, выход по стопу / цели по High–Low или через 15 баров') + `
      <div class="grid g4" style="margin-bottom:16px">
        <div class="panel stat"><div class="lbl">Сделок</div><div class="v num">${B.n}</div><div class="d">${list().length} бумаг · ${B.byExit['стоп'] || 0} стоп · ${B.byExit['цель'] || 0} цель · ${B.byExit['time-stop 15 баров'] || 0} time-stop</div></div>
        <div class="panel stat"><div class="lbl">Доля прибыльных</div><div class="v num">${fmt(B.win, 0)}%</div><div class="d">по R &gt; 0</div></div>
        <div class="panel stat"><div class="lbl">Средний R</div><div class="v num ${B.avgR >= 0 ? 'up' : 'dn'}">${(B.avgR >= 0 ? '+' : '') + fmt(B.avgR, 2)}R</div><div class="d">expectancy на сделку</div></div>
        <div class="panel stat"><div class="lbl">Profit factor</div><div class="v num">${B.pf == null ? '—' : fmt(B.pf, 2)}</div><div class="d">ΣR прибыльных ÷ ΣR убыточных</div></div>
      </div>
      <div class="panel" style="margin-bottom:16px"><div class="ph"><h2>Распределение результатов в R</h2><span class="note" style="margin-left:auto">1R = вход − стоп плана на дату входа</span></div><div class="rhist-wrap">${hist}</div></div>
      <div class="panel wrap"><table class="tbl"><thead><tr><th>Бумага</th><th>Сторона</th><th>Вход</th><th>Выход</th><th class="r">Дней</th><th class="r">Вход</th><th class="r">Стоп</th><th class="r">Цель</th><th class="r">Выход по</th><th class="r">R</th><th>Сигнал входа</th></tr></thead><tbody>
        ${B.T.map(t => `<tr class="row" data-open="${t.tk}"><td><span class="tk">${t.tk}</span><span class="nm">${esc(t.name)}</span></td><td>${sidePill(t.side)}</td><td class="num">${t.d}</td><td class="num">${t.out}</td><td class="r num">${t.days}</td><td class="r num">${px(t.entry)}</td><td class="r num dn">${px(t.stop)}</td><td class="r num up">${px(t.target)}</td><td class="r">${t.exitWhy}</td><td class="r num ${t.R >= 0 ? 'up' : 'dn'}" style="font-weight:600">${(t.R >= 0 ? '+' : '') + fmt(t.R, 2)}</td><td class="ink2">${esc(t.why)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="note" style="margin-top:12px">Это проверка правил, а не мои сделки: на каждом ретро-сигнале входа строится тот же план, что показан в карточках (стоп за уровнем, цель в коридоре), и симулируется выход. В приложении рядом появится раздел «Мои сделки» из журнала с той же статистикой (R, срок, причина выхода).</p>`;
    wireSearch();
  }

  // ── Тост и глобальные обработчики ──
  function toast(msg) { let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:var(--page);padding:10px 16px;border-radius:8px;font-size:13px;z-index:50;box-shadow:var(--shadow);max-width:90vw'; document.body.appendChild(t); } t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 3500); }
  document.addEventListener('click', e => {
    const nav = e.target.closest('.nav'); if (nav) { go(nav.dataset.r, nav.dataset.r === 'stock' ? STATE.tk : null); return; }
    const arm = e.target.closest('[data-arm]'); if (arm) { e.stopPropagation(); const u = U[arm.dataset.arm], p = u.snap.plan; toast(`${p.mode === 'limit' ? 'Лимит взведён' : 'План сохранён'}: ${u.tk} ${p.side === 'short' ? 'шорт' : 'лонг'} ${px(p.entry)} · стоп ${px(p.stop)} · цель ${px(p.target)} · ${p.qty} шт (демо — в приложении: PLAN_RULES + уведомление)`); return; }
    const jr = e.target.closest('[data-journal]'); if (jr) { e.stopPropagation(); toast('В прототипе журнал не пишется — в приложении это pfTradeAddRecord + POS_META'); return; }
    const ts = e.target.closest('[data-toast]'); if (ts) { e.stopPropagation(); toast(ts.dataset.toast); return; }
    const goBtn = e.target.closest('[data-r]'); if (goBtn) { go(goBtn.dataset.r); return; }
    const op = e.target.closest('[data-open]'); if (op) { e.stopPropagation(); go('stock', op.dataset.open); return; }
    const sel = e.target.closest('[data-sel]'); if (sel) { STATE.sel = sel.dataset.sel; $$('#scrTbl tr.on').forEach(r => r.classList.remove('on')); sel.classList.add('on'); drawer(STATE.sel); return; }
    const cd = e.target.closest('.card[data-tk]'); if (cd) go('stock', cd.dataset.tk);
  });
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase(); if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.key === '/') { e.preventDefault(); const q = $('#q'); if (q) q.focus(); return; }
    if (/^[1-5]$/.test(e.key)) { const r = ['today', 'screen', 'stock', 'book', 'journal'][+e.key - 1]; go(r, r === 'stock' ? STATE.tk : null); return; }
    if (STATE.route === 'screen' && (e.key === 'j' || e.key === 'k' || e.key === 'Enter')) {
      const rows = $$('#scrTbl tr.row'); if (!rows.length) return; let i = rows.findIndex(r => r.dataset.sel === STATE.sel);
      if (e.key === 'Enter') { if (STATE.sel) go('stock', STATE.sel); return; }
      i = e.key === 'j' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1); STATE.sel = rows[i].dataset.sel; rows.forEach(r => r.classList.remove('on')); rows[i].classList.add('on'); rows[i].scrollIntoView({ block: 'nearest' }); drawer(STATE.sel);
    }
  });
  window.addEventListener('hashchange', route);
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => route()); } catch (e) {}
  new MutationObserver(() => route()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  route();
})();

// 📈 График акции (S5 редизайна, plans/redesign-trading.md §6): lightweight-charts 5.0.8 (грузит loadLWC в app.js).
// Слои: зоны S/R (примитив) → линия цены закрытия → объём (панель) → SMA50/100/200 → линии Вход/Стоп/Цель (по стороне
// или плану позиции) → маркеры: сделки реплея вердикта v2 (SIG.replay, решение Q4), инсайдеры, мои сделки →
// RSI(14) (панель) → легенда/тултип по crosshair. chartModel — чистая (тесты), renderStockChart — DOM.
// Грузится после signals.js, до app.js (boot() в конце app-5.js уже может рисовать); RT и SIG берутся в момент
// вызова. Глобалы chartModel/chartTheme/renderStockChart. Размер — autoSize (ResizeObserver),
// без слушателей window: destroy() освобождает всё.
(function (root) {
  const tr = (ru, en) => (typeof RT === 'function' ? RT(ru, en) : ru);
  const struct = x => x.kind !== 'pivot';

  // Индекс первого бара view с датой ≥ date (ISO-строки сравниваются лексикографически); −1 — вне окна
  // (раньше первого бара больше чем на 5 дней или позже последнего).
  function barAt(view, date) {
    if (!view.length || !date) return -1;
    const d = String(date).slice(0, 10), first = view[0].d, last = view[view.length - 1].d;
    if (d > last) return -1;
    if (d < first) return (Date.parse(first) - Date.parse(d)) / 864e5 <= 5 ? 0 : -1;
    let lo = 0, hi = view.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (view[m].d < d) lo = m + 1; else hi = m; }
    return lo;
  }
  function planLines(p, price) {
    if (!p) return [];
    const L = [], atMarket = p.mode !== 'position' && p.entry > 0 && Math.abs(p.entry - price) / price < 0.0005;
    if (p.entry > 0) L.push({ kind: 'entry', price: p.entry, atMarket, title: atMarket ? '' : p.mode === 'position' ? tr('Средняя', 'Avg') : p.mode === 'limit' ? tr('Лимит', 'Limit') : tr('Вход', 'Entry') });
    if (p.stop > 0) L.push({ kind: 'stop', price: p.stop, title: tr('Стоп', 'Stop') });
    if (p.target > 0) L.push({ kind: 'target', price: p.target, title: ((p.flags || []).includes('atr-target') ? '≈ ' : '') + tr('Цель', 'Target') });
    return L;
  }
  const EXIT_TXT = { 'стоп': ['стоп', 'stop'], 'безубыток': ['б/у', 'b/e'], 'трейлинг 2·ATR': ['трейл', 'trail'] };
  // Маркеры в формате lightweight-charts (без цвета — его ставит тема по kind), отсортированы по времени.
  // Подписи — только у последней сделки реплея (у остальных значки, причины — в тултипе), иначе за год
  // десяток сделок слипается в кашу текста.
  function chartMarkers(view, off, rep, insider, trades) {
    const M = [], L = view.length, RM = (rep && rep.markers) || [];
    const lastEntry = RM.reduce((a, m) => (m.kind === 'buy' || m.kind === 'short' ? Math.max(a, m.i) : a), -1);
    RM.forEach(m => {
      if (m.i < off || m.i >= off + L) return;
      const long = m.kind === 'buy' || ((m.kind === 'exit' || m.kind === 'part') && m.side === 'short'), entry = m.kind === 'buy' || m.kind === 'short';
      const label = m.kind === 'buy' ? tr('вход', 'entry') : m.kind === 'short' ? tr('шорт', 'short') : m.kind === 'part' ? '½' : tr(...(EXIT_TXT[m.why] || [m.why, m.why]));
      M.push({ time: m.d, kind: m.kind, position: long ? 'belowBar' : 'aboveBar', shape: entry ? (long ? 'arrowUp' : 'arrowDown') : 'circle', text: m.i >= lastEntry ? label : '', label, why: m.why });
    });
    const agg = {};
    (insider || []).forEach(t => {
      if ((t.code !== 'P' && t.code !== 'S') || !t.date) return;
      const k = barAt(view, t.date); if (k < 0) return;
      const key = view[k].d + '|' + t.code, a = agg[key] || (agg[key] = { time: view[k].d, code: t.code, n: 0 }); a.n++;
    });
    Object.values(agg).forEach(a => M.push({ time: a.time, kind: a.code === 'P' ? 'ins-buy' : 'ins-sell', position: a.code === 'P' ? 'belowBar' : 'aboveBar', shape: a.code === 'P' ? 'arrowUp' : 'arrowDown', text: tr('инс', 'ins') + (a.n > 1 ? '×' + a.n : '') }));
    (trades || []).forEach(t => {
      const k = barAt(view, t.date); if (k < 0) return;
      const opens = t.short ? t.act === 'sell' : t.act === 'buy';
      const text = t.short ? (opens ? tr('я: шорт', 'me: short') : tr('я: откуп', 'me: cover')) : (opens ? tr('я: купил', 'me: buy') : tr('я: продал', 'me: sell'));
      M.push({ time: view[k].d, kind: 'me', position: t.act === 'buy' ? 'belowBar' : 'aboveBar', shape: 'square', text });
    });
    return M.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  }
  function fmtR(x) { return (x >= 0 ? '+' : '') + x.toFixed(2) + 'R'; }
  // Строка итогов реплея для окна графика.
  function statsText(st) {
    if (!st || (!st.n && !st.open)) return tr('Сигналы v2 на истории окна: входов не было', 'Signals v2 over the window: no entries');
    const pf = st.pf == null ? '—' : st.pf === Infinity ? '∞' : st.pf.toFixed(2);
    return tr('Сигналы v2 на истории окна: ', 'Signals v2 over the window: ') + (st.n ? `${st.n} ${tr('сделок', 'trades')} · ${Math.round(st.win / st.n * 100)} % ${tr('в плюсе', 'won')} · ${tr('средний', 'avg')} ${fmtR(st.avgR)} · PF ${pf}` : tr('закрытых нет', 'none closed')) + (st.open ? ` · ${tr('открыта', 'open')} ${st.open}` : '');
  }
  const EARN_SRC = { own: ['своя медиана', 'own median'], sector: ['медиана сектора', 'sector median'], cur: ['текущий', 'current'] };
  const earnSrc = s => tr(...(EARN_SRC[s] || ['—', '—']));
  // Строка под графиком о линии прибыли: отклонение цены от линии или почему линии нет (eo — opts.earn).
  function earnNote(M, eo) {
    const h = tr('Линия прибыли: ', 'Earnings line: '), n = M.notes || [];
    if (M.state === 'nofin') return h + (n.includes('error') ? tr('отчётность недоступна', 'reports unavailable') : tr('загрузка отчётности…', 'loading reports…'));
    if (M.state === 'noeps') return h + tr('EPS у провайдера нет — линии нет', 'no EPS at the provider — no line');
    if (M.state === 'loss') return h + tr('компания убыточна — линии нет', 'the company is loss-making — no line');
    if (M.state === 'ccy') return h + tr(`нет курса ${(eo && eo.fin && eo.fin.ccy) || '?'} → ${(eo && eo.ccy) || '?'} — линии нет`, `no ${(eo && eo.fin && eo.fin.ccy) || '?'} → ${(eo && eo.ccy) || '?'} rate — no line`);
    if (M.state === 'nope') return h + tr(`нет P/E в пределах ${eo && eo.peMin}–${eo && eo.peMax} (своя история, сектор, текущий) — линии нет`, `no P/E within ${eo && eo.peMin}–${eo && eo.peMax} (own history, sector, current) — no line`);
    if (M.state === 'nowin') return h + tr('годовые точки раньше окна — выберите 3Г', 'annual points precede the window — pick 3Y');
    const d = M.last && M.last.dev, parts = [];
    if (d != null) parts.push(Math.abs(d) < 0.5 ? tr('цена на линии прибыли', 'price on the earnings line') : tr(`цена на ${Math.abs(d).toFixed(0)} % ${d > 0 ? 'выше' : 'ниже'} линии прибыли`, `price ${Math.abs(d).toFixed(0)}% ${d > 0 ? 'above' : 'below'} the earnings line`));
    const own = eo && eo.peOwn, sk = (eo && eo.peSkip) || [];
    parts.push('P/E ' + fmtN(M.pe, 1) + ' — ' + earnSrc(M.peSrc) + (M.peSrc === 'own' && own ? tr(` за ${own.n} ${own.n < 5 ? 'года' : 'лет'}`, ` over ${own.n} yrs`) : ''));
    sk.forEach(k => parts.push(k.why === 'disp'
      ? tr(`своя история P/E ${fmtN(k.pe, 1)} нестабильна (разброс по годам ×${fmtN(k.disp, 1)}) — не взята`, `own P/E history ${fmtN(k.pe, 1)} is unstable (×${fmtN(k.disp, 1)} spread) — not used`)
      : tr(`${k.src === 'sector' ? 'медиана сектора' : 'своя история'} P/E ${fmtN(k.pe, 1)} далеко от текущего ${fmtN(eo.peCur, 1)} — не взята`, `${k.src === 'sector' ? 'sector median' : 'own history'} P/E ${fmtN(k.pe, 1)} is far from the current ${fmtN(eo.peCur, 1)} — not used`)));
    if (n.includes('pe-cur')) parts.push(tr('по текущему P/E линия показывает только динамику прибыли', 'at the current P/E the line shows only the earnings trend'));
    if (n.includes('no-fcst')) parts.push(tr('прогноза аналитиков нет', 'no analyst forecast'));
    else parts.push(tr('пунктир — прогноз аналитиков', 'dashed — analyst forecast'));
    if (n.includes('fcst-jump') && M.jump) { const J = M.jump, up = J.x > 1, k = fmtN(up ? J.x : 1 / J.x, 1); parts.push(tr(`прогноз FY${J.year} в ${k} раза ${up ? 'выше' : 'ниже'} отчёта FY${J.from} — отчёт считается с разовыми статьями, консенсус аналитиков обычно без них; скачок может быть не ростом бизнеса`, `FY${J.year} forecast is ${k}× ${up ? 'above' : 'below'} the FY${J.from} report — reports include one-offs, analyst consensus usually does not; the jump may not be business growth`)); }
    if (n.includes('off-scale')) parts.push(tr('линия далеко от цены — вне автомасштаба (потяните шкалу цены, чтобы увидеть; двойной клик по шкале — вернуть)', 'the line is far from the price — excluded from autoscale (drag the price scale to see it; double-click the scale to reset)'));
    return h + parts.join(' · ');
  }
  // Чистая модель графика. opts: side ('long'|'short'; по умолчанию сторона вердикта), bars (сколько
  // последних свечей показать), plan (план позиции {entry, stop, target, mode:'position'} — вместо плана
  // стороны), insider (tx [{code:'P'|'S', date}]), trades (мои сделки [{date, act, short}]).
  function chartModel(bars, snap, rep, opts) {
    const o = Object.assign({ side: null, bars: 252, plan: null, insider: null, trades: null }, opts || {});
    const show = Math.min(bars.length, o.bars), off = bars.length - show, view = bars.slice(off), ind = snap.ind;
    const side = o.side || snap.side, dec = snap.price >= 1000 ? 0 : snap.price >= 20 ? 1 : 2;
    const line = arr => view.map((b, k) => ({ time: b.d, value: arr[off + k] })).filter(p => p.value != null && isFinite(p.value));
    const band = 0.3 * snap.atr, lab = x => x.src.replace(/\+/g, ' · ');
    const zones = snap.levels.sup.filter(struct).slice(0, 2).map(x => ({ kind: 'sup', v: x.v, lo: x.v - band, hi: x.v + band, label: 'S · ' + lab(x) }))
      .concat(snap.levels.res.filter(struct).slice(0, 2).map(x => ({ kind: 'res', v: x.v, lo: x.v - band, hi: x.v + band, label: 'R · ' + lab(x) })));
    const plan = o.plan || (snap.plans && snap.plans[side]) || null;
    return {
      show, off, view, side, dec, zones, plan, lines: planLines(plan, snap.price),
      price: view.map(b => ({ time: b.d, value: b.c })),   // линейный график по закрытию (не свечи — решение пользователя 2026-09-11)
      volume: view.map(b => ({ time: b.d, value: b.v, up: b.c >= b.o })), hasVol: view.some(b => b.v > 0),
      sma: { s50: line(ind.s50), s100: line(ind.s100), s200: line(ind.s200) }, rsi: line(ind.rsi),
      markers: chartMarkers(view, off, rep, o.insider, o.trades),
      stats: (typeof SIG !== 'undefined' ? SIG : root.SIG).replayStats(rep ? rep.trades : [], off),
    };
  }

  // ── Линия прибыли (plans/earnings-line.md): «цена по прибыли» = EPS фин. года × «нормальный» P/E бумаги на шкале
  // цены; пунктир — консенсус аналитиков (Yahoo earningsTrend). Годовая точка стоит на дате конца фин. года
  // (снап на следующий торговый день). Логический индекс i: бар окна 0…L−1, дальше — пустые слоты рабочих дней
  // (future), иначе шкала времени lightweight-charts (по индексам) сжала бы год прогноза в пару баров.
  // Множитель валюты отчётности → валюта торгов (FX[x] = SEK за 1 x; GBp/GBX — пенсы); null — курса нет.
  function earnRate(rep, trade, fx) {
    const norm = c => { c = String(c || '').trim(); return c === 'GBp' || c.toUpperCase() === 'GBX' ? ['GBP', 0.01] : [c.toUpperCase(), 1]; };
    if (!rep || !trade) return 1;
    const [r, rm] = norm(rep), [t, tm] = norm(trade);
    if (r === t) return rm / tm;
    const a = fx && +fx[r], b = fx && +fx[t];
    return a > 0 && b > 0 ? a * rm / (b * tm) : null;
  }
  const dayMs = d => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
  // chartEarningsModel(view [{d,c,h,l}], fin (ответ ?financials=), o {pe, peSrc, ccy (валюта торгов), fx (карта FX),
  // futureBars, scaleX}) → {state, hist, fcst, future, line, pe, peSrc, fx, last, fit, notes}.
  // hist/fcst — [{i, time, value|null, eps, year, n?, interp?}] (value null — убыточный год, разрыв линии);
  // fcst[0] — последняя фактическая точка (линии стыкуются). line — все точки по возрастанию i (для легенды).
  // state: ok · nofin (нет ответа/ошибка) · noeps · loss (все годы ≤ 0) · ccy (нет курса) · nope (нет P/E) · nowin
  // (все точки раньше окна). fit — линия в пределах [min/scaleX, max×scaleX] цены окна (иначе не в автомасштабе).
  function chartEarningsModel(view, fin, o) {
    o = Object.assign({ pe: null, peSrc: null, ccy: null, fx: null, futureBars: 520, scaleX: 1.5, jumpX: 2 }, o || {});
    const M = { state: 'nofin', hist: [], fcst: [], future: [], line: [], pe: o.pe > 0 ? +o.pe : null, peSrc: o.peSrc || null, fx: null, last: null, fit: true, notes: [] };
    const V = view || [], L = V.length, num = v => v != null && v !== '' && isFinite(v);
    if (!L || !fin || typeof fin !== 'object') return M;
    if (fin.status === 'error') { M.notes.push('error'); return M; }
    const A = (Array.isArray(fin.annual) ? fin.annual : []).filter(x => x && num(x.eps) && +x.year > 1900).map(x => ({ year: +x.year, eps: +x.eps })).sort((a, b) => a.year - b.year);
    if (!A.length) return Object.assign(M, { state: 'noeps' });
    if (!A.some(x => x.eps > 0)) return Object.assign(M, { state: 'loss' });
    const fx = earnRate(fin.ccy, o.ccy, o.fx);
    if (!(fx > 0)) return Object.assign(M, { state: 'ccy' });
    M.fx = fx;
    if (!M.pe) return Object.assign(M, { state: 'nope' });
    const f0 = String(fin.fiscalYearEnd || ''), fye = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(f0) ? (f0 === '02-29' ? '02-28' : f0) : '12-31';
    const last = A[A.length - 1], val = eps => (eps > 0 ? eps * fx * M.pe : null);
    const E = (Array.isArray(fin.estimates) ? fin.estimates : []).filter(x => x && num(x.eps) && +x.year > last.year).map(x => ({ year: +x.year, eps: +x.eps, n: x.n || null })).sort((a, b) => a.year - b.year);
    const first = V[0].d, lastD = V[L - 1].d, endE = E.length ? `${E[E.length - 1].year}-${fye}` : null;
    if (endE && endE > lastD) {
      for (let d = lastD; M.future.length < o.futureBars;) {
        d = isoAdd(d, 1); const wd = new Date(dayMs(d)).getUTCDay();
        if (wd === 0 || wd === 6) continue;
        M.future.push({ time: d });
        if (d >= endE) break;
      }
    }
    const F = M.future, lb = (arr, d, get) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (get(arr[m]) < d) lo = m + 1; else hi = m; } return lo; };
    const timeAt = i => (i < L ? V[i].d : F[i - L].time);
    // Индекс даты: −1 — раньше окна; null — дальше последнего будущего слота.
    const idx = d => d < first ? -1 : d <= lastD ? lb(V, d, b => b.d) : (j => (j < F.length ? L + j : null))(lb(F, d, s => s.time));
    const lerp = (a, b, d) => a.v + (b.v - a.v) * (dayMs(d) - dayMs(a.date)) / ((dayMs(b.date) - dayMs(a.date)) || 1);
    // Точки последовательности → индексы окна: точка раньше окна не рисуется, но линия входит с левого края
    // интерполяцией; точка за последним слотом — интерполяция на последнем слоте.
    const place = S => {
      const out = []; let prev = null;
      S.forEach(p => {
        let i = idx(p.date);
        if (p.fact && i != null && i >= L) i = L - 1;   // факт позже последнего бара (свечи отстали) — на последний бар
        if (i === -1) { prev = p; return; }
        const pt = (j, v, extra) => Object.assign({ i: j, time: timeAt(j), value: v, eps: p.eps, year: p.year }, p.n ? { n: p.n } : {}, extra || {});
        if (i == null) {
          const a = out.length ? out[out.length - 1] : null, j = L + F.length - 1;
          if (a && a.value != null && p.v != null && F.length && a.i < j) out.push(pt(j, lerp({ v: a.value, date: a.date }, p, timeAt(j)), { interp: true, date: timeAt(j) }));
          prev = null; return;
        }
        if (!out.length && prev && i > 0 && prev.v != null && p.v != null) out.push(Object.assign(pt(0, lerp(prev, p, first), { interp: true, date: first }), { eps: null, year: null }));
        if (out.length && out[out.length - 1].i === i) out.pop();
        out.push(pt(i, p.v, { date: p.date }));
        prev = p;
      });
      return out;
    };
    const P = A.map(x => ({ date: `${x.year}-${fye}`, year: x.year, eps: x.eps, v: val(x.eps), fact: true }));
    M.hist = place(P);
    if (E.length) {
      const link = P[P.length - 1];
      M.fcst = place((link.v != null ? [link] : []).concat(E.map(x => ({ date: `${x.year}-${fye}`, year: x.year, eps: x.eps, n: x.n, v: val(x.eps) }))));
      // Скачок прогноза к последнему отчёту больше чем в jumpX раз — часто разные базы (отчёт с разовыми статьями,
      // консенсус — без них): прогноз не отбрасываем (бывает и настоящий рост, MU ×9,7), но подписываем.
      const j0 = last.eps > 0 && E.length && E[0].eps > 0 ? E[0].eps / last.eps : null;
      if (j0 && (j0 > o.jumpX || j0 < 1 / o.jumpX)) { M.notes.push('fcst-jump'); M.jump = { x: j0, year: E[0].year, from: last.year }; }
    } else M.notes.push('no-fcst');
    const hi = M.hist.length ? M.hist[M.hist.length - 1].i : -1;
    M.line = M.hist.concat(M.fcst.filter(p => p.i > hi)).map(p => { const q = Object.assign({}, p); delete q.date; return q; });
    [M.hist, M.fcst].forEach(S => S.forEach(p => { delete p.date; }));
    if (!M.line.some(p => p.value != null)) { M.state = 'nowin'; return M; }
    M.state = 'ok';
    if (M.peSrc === 'cur') M.notes.push('pe-cur');
    const lv = chartEarnAt(M, L - 1), px = V[L - 1].c;
    M.last = lv ? { value: lv.value, dev: px > 0 ? (px / lv.value - 1) * 100 : null } : null;
    const ev = M.line.filter(p => p.value != null).map(p => p.value);
    const pl = Math.min(...V.map(b => (b.l > 0 ? b.l : b.c))), ph = Math.max(...V.map(b => (b.h > 0 ? b.h : b.c)));
    M.fit = Math.min(...ev) >= pl / o.scaleX && Math.max(...ev) <= ph * o.scaleX;
    if (!M.fit) M.notes.push('off-scale');
    return M;
  }
  // Своя история P/E на тех же данных, что и линия (plans/earnings-line.md, аудит 2026-09-11): P/E года = закрытие на конец
  // FY ÷ (EPS × курс) по последним o.years годам с EPS > 0; берутся значения в [peMin, peMax]. Валюта отчётности, ADR и
  // пенсы сокращаются — база та же, что у линии. bars — свечи [{d,c}] (5 лет). → {pe (медиана), n, disp (max ÷ min),
  // pts:[{year,pe}], curFY (цена ÷ EPS последнего FY × курс; null при убытке)} или null (нет EPS/курса/свечей).
  function chartEarnPe(bars, fin, o) {
    o = Object.assign({ ccy: null, fx: null, peMin: 5, peMax: 60, years: 5, minYears: 2 }, o || {});
    const B = (bars || []).filter(b => b && b.d && b.c > 0);
    if (!B.length || !fin || !Array.isArray(fin.annual)) return null;
    const A = fin.annual.filter(x => x && x.eps != null && isFinite(x.eps) && +x.year > 1900).map(x => ({ year: +x.year, eps: +x.eps })).sort((a, b) => a.year - b.year);
    const k = earnRate(fin.ccy, o.ccy, o.fx);
    if (!A.length || !(k > 0)) return null;
    const f0 = String(fin.fiscalYearEnd || ''), fye = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(f0) ? f0 : '12-31';
    const pxAt = d => { let lo = 0, hi = B.length; while (lo < hi) { const m = (lo + hi) >> 1; if (B[m].d <= d) lo = m + 1; else hi = m; } return lo ? B[lo - 1] : null; };   // последнее закрытие ≤ даты
    const pts = [];
    A.filter(x => x.eps > 0).slice(-o.years).forEach(x => {
      const d = `${x.year}-${fye}`, b = pxAt(d);
      if (!b || (dayMs(d) - dayMs(b.d)) / 864e5 > 7) return;   // свечей на конец года нет (история короче)
      const pe = b.c / (x.eps * k);
      if (pe >= o.peMin && pe <= o.peMax) pts.push({ year: x.year, pe });
    });
    const last = A[A.length - 1], curFY = last.eps > 0 ? B[B.length - 1].c / (last.eps * k) : null;
    if (pts.length < o.minYears) return { pe: null, n: pts.length, disp: null, pts, curFY };
    const v = pts.map(p => p.pe).sort((a, b) => a - b), m = v.length >> 1;
    return { pe: v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2, n: v.length, disp: v[v.length - 1] / v[0], pts, curFY };
  }
  // Значение линии на логическом индексе i (интерполяция между соседними точками по индексу — как рисует линия)
  // + точка года, к которой идёт отрезок (at): {value, at, fcst}; null — вне линии или на разрыве.
  function chartEarnAt(M, i) {
    const P = (M && M.line) || [];
    if (!P.length || i < P[0].i || i > P[P.length - 1].i) return null;
    let k = 0; while (k < P.length - 1 && P[k + 1].i <= i) k++;
    const a = P[k], b = a.i === i ? a : P[k + 1];
    if (a.value == null || b.value == null) return null;
    const h = M.hist.length ? M.hist[M.hist.length - 1].i : -1;
    return { value: b === a ? a.value : a.value + (b.value - a.value) * (i - a.i) / (b.i - a.i), at: b.year != null ? b : a, fcst: i > h };
  }

  // ── DOM ниже ──
  function rgba(c, a) {
    const h = String(c).trim().replace('#', '');
    if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)) return c;
    const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }
  // Тема из CSS-токенов desk.css; SMA — палитра плана §7 (проверена на CVD и контраст).
  function chartTheme() {
    const de = document.documentElement, cs = getComputedStyle(de), g = (n, f) => cs.getPropertyValue(n).trim() || f, dark = de.dataset.theme === 'dark';
    const long = g('--green', '#16a34a'), short = g('--red', '#dc2626');
    return { dark, font: getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif', ink: g('--text', '#1a1f2e'), text2: g('--text2', '#5c6478'), muted: g('--text3', '#8b92a5'),
      grid: rgba(g('--text3', '#8b92a5'), dark ? 0.16 : 0.18), up: long, down: short, volUp: rgba(long, 0.35), volDown: rgba(short, 0.35),
      sma50: dark ? '#3987e5' : '#2a78d6', sma100: dark ? '#d95926' : '#eb6834', sma200: dark ? '#9085e9' : '#4a3aa7',
      zoneSup: rgba(long, 0.08), zoneSupLine: rgba(long, 0.5), zoneRes: rgba(short, 0.08), zoneResLine: rgba(short, 0.5),
      entry: g('--text', '#1a1f2e'), stop: short, target: long, long, short, exit: g('--yellow', '#d97706'), me: g('--accent', '#2563eb'), rsi: g('--accent', '#2563eb'), rsiBand: rgba(g('--text3', '#8b92a5'), 0.45),
      earn: g('--earn', dark ? '#e27ab9' : '#b4307d') };   // линия прибыли — маджента (desk.css --dk-earn): не SMA-палитра и не зелёный/красный
  }
  // Примитив «зоны уровней»: полупрозрачные полосы ±0.3·ATR вокруг структурных уровней с подписью.
  class ZonesPrimitive {
    constructor(zones, T) { this.zones = zones; this.T = T; this.series = null; }
    attached(p) { this.series = p.series; }
    detached() { this.series = null; }
    updateAllViews() {}
    paneViews() {
      const self = this;
      return [{ zOrder() { return 'bottom'; }, renderer() { return { draw(target) {
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          if (!self.series) return;
          const T = self.T;
          for (const z of self.zones) {
            const y1 = self.series.priceToCoordinate(z.hi), y2 = self.series.priceToCoordinate(z.lo);
            if (y1 == null || y2 == null) continue;
            const top = Math.min(y1, y2), h = Math.max(1, Math.abs(y2 - y1)), sup = z.kind === 'sup';
            ctx.fillStyle = sup ? T.zoneSup : T.zoneRes; ctx.fillRect(0, top, mediaSize.width, h);
            ctx.fillStyle = sup ? T.zoneSupLine : T.zoneResLine; ctx.fillRect(0, sup ? top : top + h - 1, mediaSize.width, 1);
            ctx.font = '600 10px ' + T.font; ctx.fillStyle = T.text2; ctx.textBaseline = sup ? 'top' : 'bottom';
            ctx.fillText(z.label, 8, sup ? top + 3 : top + h - 3);
          }
        });
      } }; } }];
    }
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  function fmtN(v, d) { return v == null || !isFinite(v) ? '—' : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmtVol(v) { return v >= 1e9 ? (v / 1e9).toFixed(2) + tr(' млрд', 'B') : v >= 1e6 ? (v / 1e6).toFixed(1) + tr(' млн', 'M') : v >= 1e3 ? (v / 1e3).toFixed(0) + tr(' тыс', 'K') : String(v); }

  // renderStockChart(el, bars, snap, opts) → {chart, setSide(side), destroy()}. opts — как у chartModel плюс
  // theme (по умолчанию chartTheme()), replay (готовый SIG.replay; иначе считается здесь), ccy (подпись),
  // earn (линия прибыли, только большой график desk «Акция» — см. chartEarningsModel).
  function renderStockChart(el, bars, snap, opts) {
    const L = root.LightweightCharts, T = (opts && opts.theme) || chartTheme(), o = Object.assign({}, opts);
    const rep = o.replay || SIG.replay(bars, { ind: snap.ind });
    let M = chartModel(bars, snap, rep, o);
    el.innerHTML = '';
    const wrap = document.createElement('div'); wrap.className = 'sc-wrap'; el.appendChild(wrap);
    const chart = L.createChart(wrap, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: T.muted, fontFamily: T.font, fontSize: 11,
        panes: { separatorColor: T.grid, separatorHoverColor: T.grid, enableResize: false } },
      grid: { vertLines: { color: T.grid }, horzLines: { color: T.grid } },
      rightPriceScale: { borderColor: T.grid, scaleMargins: { top: 0.08, bottom: 0.06 }, minimumWidth: 64 },
      timeScale: { borderColor: T.grid, rightOffset: 6 },
      crosshair: { mode: L.CrosshairMode.Normal, vertLine: { color: T.muted, width: 1, style: L.LineStyle.Solid, labelBackgroundColor: T.ink }, horzLine: { color: T.muted, width: 1, style: L.LineStyle.Solid, labelBackgroundColor: T.ink } },
      localization: { priceFormatter: p => fmtN(p, M.dec) },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const px = chart.addSeries(L.LineSeries, { color: T.ink, lineWidth: 2, crosshairMarkerVisible: true, crosshairMarkerRadius: 3, priceLineVisible: true, priceLineColor: T.ink, priceLineWidth: 1, priceLineStyle: L.LineStyle.Dotted });
    px.setData(M.price);
    let pane = 1;
    if (M.hasVol) {
      const vol = chart.addSeries(L.HistogramSeries, { priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false }, pane++);
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 }, minimumWidth: 64 });
      vol.setData(M.volume.map(v => ({ time: v.time, value: v.value, color: v.up ? T.volUp : T.volDown })));
    }
    const sma = (data, color) => { const s = chart.addSeries(L.LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }); s.setData(data); };
    sma(M.sma.s50, T.sma50); sma(M.sma.s100, T.sma100); sma(M.sma.s200, T.sma200);
    // Линия прибыли (opts.earn = {fin, pe, peSrc, ccy, fx, futureBars, viewFuture, scaleX, peMin, peMax}): факт — сплошная,
    // прогноз — пунктир; пустые слоты будущего — отдельная серия без значений. Далеко от цены — вне автомасштаба.
    const EO = o.earn || null, EM = EO ? chartEarningsModel(M.view, EO.fin, EO) : null, eOk = !!(EM && EM.state === 'ok');
    if (eOk) {
      const ws = p => (p.value == null ? { time: p.time } : { time: p.time, value: p.value }), sc = EM.fit ? {} : { autoscaleInfoProvider: () => null };
      const dots = (s, S, c) => L.createSeriesMarkers(s, S.filter(p => p.value != null && !p.interp).map(p => ({ time: p.time, position: 'inBar', shape: 'circle', color: c, size: 0.6 })));
      if (EM.future.length) chart.addSeries(L.LineSeries, { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }).setData(EM.future);
      if (EM.fcst.length) {
        const f = chart.addSeries(L.LineSeries, Object.assign({ color: rgba(T.earn, 0.75), lineWidth: 2, lineStyle: L.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, sc));
        f.setData(EM.fcst.map(ws)); dots(f, EM.fcst.filter(p => !EM.hist.some(q => q.i === p.i)), rgba(T.earn, 0.75));
      }
      if (EM.hist.length) {
        const h = chart.addSeries(L.LineSeries, Object.assign({ color: T.earn, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false }, sc));
        h.setData(EM.hist.map(ws)); dots(h, EM.hist, T.earn);
      }
    }
    px.attachPrimitive(new ZonesPrimitive(M.zones, T));
    let lines = [];
    const drawLines = () => {
      lines.forEach(l => px.removePriceLine(l)); lines = [];
      M.lines.forEach(l => lines.push(px.createPriceLine({ price: l.price, color: T[l.kind], lineWidth: l.kind === 'entry' && l.atMarket ? 1 : 2,
        lineStyle: l.kind === 'entry' ? (l.atMarket ? L.LineStyle.Dotted : L.LineStyle.Solid) : L.LineStyle.LargeDashed, axisLabelVisible: !l.atMarket, title: l.title })));
    };
    drawLines();
    const MC = { buy: T.long, short: T.short, part: T.target, exit: T.exit, 'ins-buy': T.long, 'ins-sell': T.short, me: T.me };
    L.createSeriesMarkers(px, M.markers.map(m => ({ time: m.time, position: m.position, shape: m.shape, color: MC[m.kind] || T.muted, text: m.text })));
    const rsi = chart.addSeries(L.LineSeries, { color: T.rsi, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: 'price', precision: 0, minMove: 1 } }, pane);
    rsi.setData(M.rsi);
    [70, 30].forEach(p => rsi.createPriceLine({ price: p, color: T.rsiBand, lineWidth: 1, lineStyle: L.LineStyle.Solid, axisLabelVisible: false, title: '' }));
    rsi.priceScale().applyOptions({ minimumWidth: 64 });
    const panes = chart.panes(), H = wrap.clientHeight || 420;
    if (M.hasVol && panes[1]) panes[1].setHeight(Math.max(44, Math.round(H * 0.13)));
    if (panes[pane]) panes[pane].setHeight(Math.max(56, Math.round(H * 0.17)));
    // Легенда (последний бар или бар под курсором), итоги реплея, тултип.
    const legend = document.createElement('div'); legend.className = 'sc-legend'; el.appendChild(legend);
    const stats = document.createElement('div'); stats.className = 'sc-stats'; el.appendChild(stats);
    stats.textContent = statsText(M.stats);
    stats.title = tr('Реплей вердикта v2 по свечам: вход — бар, где вердикт впервые стал «Купить»/«Шорт» (таргетов и отчётов в истории нет); выход — стоп, ½ на цели, после +1R стоп в безубыток, после +2R трейлинг 2·ATR. R — от стопа входа.',
      'Verdict v2 replayed over candles: entry — the bar where the verdict first turned Buy/Short (no targets/earnings in history); exit — stop, ½ at target, breakeven after +1R, 2·ATR trail after +2R. R from the entry stop.');
    if (EM) {
      const note = document.createElement('div'); note.className = 'sc-stats sc-earn'; el.appendChild(note);
      note.textContent = earnNote(EM, EO);
      note.title = tr('Линия прибыли = EPS фин. года × «нормальный» P/E бумаги; пунктир — консенсус аналитиков (Yahoo), не прогноз компании.', 'Earnings line = fiscal-year EPS × the stock’s “normal” P/E; dashed — analyst consensus (Yahoo), not company guidance.');
    }
    const ind = snap.ind, off = M.off, key = (c, l, v) => `<span class="sc-k"><i style="background:${c}"></i>${l}${v != null ? ` <b>${v}</b>` : ''}</span>`;
    const tip = document.createElement('div'); tip.className = 'sc-tip'; tip.hidden = true; wrap.appendChild(tip);
    const eLbl = eOk ? tr('Прибыль × P/E ', 'Earnings × P/E ') + fmtN(EM.pe, 1) + ` (${earnSrc(EM.peSrc)})` : '';
    // Легенда: бар i (глобальный индекс свечей) и логический индекс линии прибыли ei (по умолчанию — тот же бар).
    const paintLegend = (i, ei) => {
      const b = bars[i], d = i > 0 ? (b.c / bars[i - 1].c - 1) * 100 : 0, ex = eOk ? chartEarnAt(EM, ei == null ? i - off : ei) : null;
      legend.innerHTML = key(T.ink, b.d, `${fmtN(b.c, 2)}${o.ccy ? ' ' + esc(o.ccy) : ''} (${d >= 0 ? '+' : ''}${d.toFixed(2)}%)`) + key(T.sma50, 'SMA 50', fmtN(ind.s50[i], M.dec)) + key(T.sma100, 'SMA 100', fmtN(ind.s100[i], M.dec)) + key(T.sma200, 'SMA 200', fmtN(ind.s200[i], M.dec)) + (eOk ? key(T.earn, esc(eLbl), ex ? fmtN(ex.value, M.dec) : '—') : '') + key(T.rsi, 'RSI 14', fmtN(ind.rsi[i], 0)) + (M.hasVol ? key(T.volUp, tr('Объём', 'Volume'), fmtVol(b.v)) : '');
    };
    // Строки тултипа по линии прибыли: значение на баре и год, к которому идёт отрезок (EPS × P/E, аналитики).
    const earnTip = ei => {
      const x = eOk ? chartEarnAt(EM, ei) : null; if (!x) return '';
      const a = x.at, fxs = EM.fx !== 1 ? ` × ${fmtN(EM.fx, EM.fx < 10 ? 3 : 1)}` : '';
      const fy = a && a.eps != null ? `<div class="sc-tip-e">FY${a.year} ${x.fcst ? tr('прогноз', 'forecast') : tr('факт', 'actual')}: EPS ${fmtN(a.eps, 2)}${fxs} × P/E ${fmtN(EM.pe, 1)} = ${fmtN(a.value, M.dec)}${a.n ? ` · ${a.n} ${tr('аналит.', 'analysts')}` : ''}</div>` : '';
      return `<div class="sc-tip-r"><b style="color:${T.earn}">${fmtN(x.value, M.dec)}</b><span>${x.fcst ? tr('прибыль × P/E, прогноз', 'earnings × P/E, fcst') : tr('прибыль × P/E', 'earnings × P/E')}</span></div>${fy}`;
    };
    const place = (param, w) => { const x = param.point.x, tw = tip.offsetWidth || 180; tip.style.left = (x + 14 + tw > w ? Math.max(0, x - 14 - tw) : x + 14) + 'px'; tip.style.top = Math.max(6, param.point.y - 40) + 'px'; };
    paintLegend(bars.length - 1);
    const byTime = {}; M.markers.forEach(m => { (byTime[m.time] = byTime[m.time] || []).push(m); });
    chart.subscribeCrosshairMove(param => {
      if (!param || !param.time || !param.point) { tip.hidden = true; paintLegend(bars.length - 1); return; }
      const k = M.view.findIndex(b => b.d === param.time);
      if (k < 0) {   // пустой слот будущего — строка прогноза прибыли
        const j = eOk ? EM.future.findIndex(s => s.time === param.time) : -1, et = j >= 0 ? earnTip(M.view.length + j) : '';
        if (j >= 0) paintLegend(bars.length - 1, M.view.length + j);
        if (!et) { tip.hidden = true; return; }
        tip.innerHTML = `<div class="sc-tip-d">${esc(param.time)}</div>${et}`; tip.hidden = false; place(param, wrap.clientWidth); return;
      }
      const gi = off + k, b = bars[gi], ch = (b.c / b.o - 1) * 100; paintLegend(gi);
      const ev = (byTime[b.d] || []).map(m => { const l = m.label || m.text; return `<div class="sc-tip-e">${esc(l)}${m.why && m.why !== l ? ' — ' + esc(String(m.why).slice(0, 80)) : ''}</div>`; }).join('');
      tip.innerHTML = `<div class="sc-tip-d">${b.d}</div><div class="sc-tip-r"><b>${fmtN(b.c, 2)}</b><span>${tr('закр.', 'close')}</span></div><div class="sc-tip-r"><b>${fmtN(b.o, 2)}</b><span>${tr('откр.', 'open')}</span></div><div class="sc-tip-r"><b>${fmtN(b.h, 2)} / ${fmtN(b.l, 2)}</b><span>max / min</span></div><div class="sc-tip-r"><b class="${ch >= 0 ? 'up' : 'dn'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</b><span>${tr('день', 'day')}</span></div>${M.hasVol ? `<div class="sc-tip-r"><b>${fmtVol(b.v)}</b><span>${tr('объём', 'vol')}</span></div>` : ''}${ind.rsi[gi] != null ? `<div class="sc-tip-r"><b>${ind.rsi[gi].toFixed(0)}</b><span>RSI</span></div>` : ''}${earnTip(k)}${ev}`;
      tip.hidden = false; place(param, wrap.clientWidth);
    });
    // С прогнозом прибыли — окно истории + viewFuture баров будущего (остальное — прокруткой вправо).
    if (eOk && EM.future.length) chart.timeScale().setVisibleLogicalRange({ from: 0, to: M.view.length - 1 + Math.min(EO.viewFuture || 20, EM.future.length) });
    else chart.timeScale().fitContent();
    return { chart, setSide(sd) { o.side = sd; M = chartModel(bars, snap, rep, o); drawLines(); }, destroy() { try { chart.remove(); } catch (e) {} } };
  }
  // ── Веер цели на 12 мес (I3, §3.5): последний год цены + пунктиры от последнего закрытия к low/consensus/high
  // через год. Шкала времени lightweight-charts — по индексу точек, поэтому и история, и будущее — недельные
  // слоты (каждый 5-й бар от последнего; 52 пустых слота вперёд), иначе год вперёд занял бы один слот.
  // chartFanModel(bars [{d,c}], tg {low,consensus,high}) → null без свечей или без консенсуса.
  const isoAdd = (d, days) => new Date(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10);
  function chartFanModel(bars, tg) {
    const B = (bars || []).filter(b => b && b.d && b.c > 0);
    if (!B.length || !tg || !(tg.consensus > 0)) return null;
    const hist = [];
    for (let i = B.length - 1; i >= Math.max(0, B.length - 253); i -= 5) hist.unshift({ time: String(B[i].d).slice(0, 10), value: B[i].c });
    const last = hist[hist.length - 1], future = [];
    for (let k = 1; k <= 52; k++) future.push({ time: isoAdd(last.time, 7 * k) });
    const end = future[future.length - 1].time;
    const lines = [['high', tg.high], ['consensus', tg.consensus], ['low', tg.low]].filter(x => x[1] > 0)
      .map(([kind, v]) => ({ kind, value: v, pct: (v / last.value - 1) * 100, data: [{ time: last.time, value: last.value }, { time: end, value: v }] }));
    return { hist, future, last, end, lines };
  }
  // renderTargetFan(el, model, opts {theme, ccy}) → {destroy()}.
  function renderTargetFan(el, M, opts) {
    const L = root.LightweightCharts, T = (opts && opts.theme) || chartTheme();
    el.innerHTML = '';
    const wrap = document.createElement('div'); wrap.className = 'sc-wrap'; el.appendChild(wrap);
    const dec = M.last.value >= 1000 ? 0 : M.last.value >= 20 ? 1 : 2;
    const chart = L.createChart(wrap, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: T.muted, fontFamily: T.font, fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: T.grid } },
      rightPriceScale: { borderColor: T.grid, scaleMargins: { top: 0.1, bottom: 0.08 }, minimumWidth: 56 },
      timeScale: { borderColor: T.grid, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: L.CrosshairMode.Magnet, vertLine: { color: T.muted, labelBackgroundColor: T.ink }, horzLine: { color: T.muted, labelBackgroundColor: T.ink } },
      localization: { priceFormatter: p => fmtN(p, dec) },
      handleScale: false, handleScroll: false,
    });
    const px = chart.addSeries(L.LineSeries, { color: T.ink, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false });
    px.setData(M.hist.concat(M.future));
    const col = { high: T.long, consensus: T.me, low: T.short };
    M.lines.forEach(l => {
      const s = chart.addSeries(L.LineSeries, { color: col[l.kind], lineWidth: 2, lineStyle: l.kind === 'consensus' ? L.LineStyle.Dashed : L.LineStyle.SparseDotted, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, pointMarkersVisible: true });
      s.setData(l.data);
    });
    chart.timeScale().fitContent();
    // Прокрутка/масштаб выключены — при смене ширины заново вписываем год истории и год вперёд.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { try { chart.timeScale().fitContent(); } catch (e) {} }) : null;
    if (ro) ro.observe(wrap);
    return { chart, destroy() { if (ro) ro.disconnect(); try { chart.remove(); } catch (e) {} } };
  }
  root.chartModel = chartModel; root.chartTheme = chartTheme; root.renderStockChart = renderStockChart;
  root.chartStatsText = statsText; root.chartBarAt = barAt; root.chartFanModel = chartFanModel; root.renderTargetFan = renderTargetFan;
  root.chartEarningsModel = chartEarningsModel; root.chartEarnAt = chartEarnAt; root.chartEarnPe = chartEarnPe; root.chartEarnNote = earnNote;
})(typeof globalThis !== 'undefined' ? globalThis : window);

// 📈 График акции (S5 редизайна, plans/redesign-trading.md §6): lightweight-charts 5.0.8 (грузит loadLWC в app.js).
// Слои: зоны S/R (примитив) → свечи → объём (панель) → SMA50/100/200 → линии Вход/Стоп/Цель (по стороне
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
      candles: view.map(b => ({ time: b.d, open: b.o, high: b.h, low: b.l, close: b.c })),
      volume: view.map(b => ({ time: b.d, value: b.v, up: b.c >= b.o })), hasVol: view.some(b => b.v > 0),
      sma: { s50: line(ind.s50), s100: line(ind.s100), s200: line(ind.s200) }, rsi: line(ind.rsi),
      markers: chartMarkers(view, off, rep, o.insider, o.trades),
      stats: (typeof SIG !== 'undefined' ? SIG : root.SIG).replayStats(rep ? rep.trades : [], off),
    };
  }

  // ── DOM ниже ──
  function rgba(c, a) {
    const h = String(c).trim().replace('#', '');
    if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h)) return c;
    const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }
  // Тема из CSS-токенов styles.css; SMA — палитра плана §7 (проверена на CVD и контраст).
  function chartTheme() {
    const de = document.documentElement, cs = getComputedStyle(de), g = (n, f) => cs.getPropertyValue(n).trim() || f, dark = de.dataset.theme === 'dark';
    const long = g('--green', '#16a34a'), short = g('--red', '#dc2626');
    return { dark, font: getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif', ink: g('--text', '#1a1f2e'), text2: g('--text2', '#5c6478'), muted: g('--text3', '#8b92a5'),
      grid: rgba(g('--text3', '#8b92a5'), dark ? 0.16 : 0.18), up: long, down: short, volUp: rgba(long, 0.35), volDown: rgba(short, 0.35),
      sma50: dark ? '#3987e5' : '#2a78d6', sma100: dark ? '#d95926' : '#eb6834', sma200: dark ? '#9085e9' : '#4a3aa7',
      zoneSup: rgba(long, 0.08), zoneSupLine: rgba(long, 0.5), zoneRes: rgba(short, 0.08), zoneResLine: rgba(short, 0.5),
      entry: g('--text', '#1a1f2e'), stop: short, target: long, long, short, exit: g('--yellow', '#d97706'), me: g('--accent', '#2563eb'), rsi: g('--accent', '#2563eb'), rsiBand: rgba(g('--text3', '#8b92a5'), 0.45) };
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
  // theme (по умолчанию chartTheme()), replay (готовый SIG.replay; иначе считается здесь), ccy (подпись).
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
    const candles = chart.addSeries(L.CandlestickSeries, { upColor: T.up, downColor: T.down, borderVisible: false, wickUpColor: T.up, wickDownColor: T.down, priceLineVisible: true, priceLineColor: T.ink, priceLineWidth: 1, priceLineStyle: L.LineStyle.Dotted });
    candles.setData(M.candles);
    let pane = 1;
    if (M.hasVol) {
      const vol = chart.addSeries(L.HistogramSeries, { priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false }, pane++);
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 }, minimumWidth: 64 });
      vol.setData(M.volume.map(v => ({ time: v.time, value: v.value, color: v.up ? T.volUp : T.volDown })));
    }
    const sma = (data, color) => { const s = chart.addSeries(L.LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }); s.setData(data); };
    sma(M.sma.s50, T.sma50); sma(M.sma.s100, T.sma100); sma(M.sma.s200, T.sma200);
    candles.attachPrimitive(new ZonesPrimitive(M.zones, T));
    let lines = [];
    const drawLines = () => {
      lines.forEach(l => candles.removePriceLine(l)); lines = [];
      M.lines.forEach(l => lines.push(candles.createPriceLine({ price: l.price, color: T[l.kind], lineWidth: l.kind === 'entry' && l.atMarket ? 1 : 2,
        lineStyle: l.kind === 'entry' ? (l.atMarket ? L.LineStyle.Dotted : L.LineStyle.Solid) : L.LineStyle.LargeDashed, axisLabelVisible: !l.atMarket, title: l.title })));
    };
    drawLines();
    const MC = { buy: T.long, short: T.short, part: T.target, exit: T.exit, 'ins-buy': T.long, 'ins-sell': T.short, me: T.me };
    L.createSeriesMarkers(candles, M.markers.map(m => ({ time: m.time, position: m.position, shape: m.shape, color: MC[m.kind] || T.muted, text: m.text })));
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
    const ind = snap.ind, off = M.off, key = (c, l, v) => `<span class="sc-k"><i style="background:${c}"></i>${l}${v != null ? ` <b>${v}</b>` : ''}</span>`;
    const tip = document.createElement('div'); tip.className = 'sc-tip'; tip.hidden = true; wrap.appendChild(tip);
    const paintLegend = i => {
      const b = bars[i], d = i > 0 ? (b.c / bars[i - 1].c - 1) * 100 : 0;
      legend.innerHTML = key(T.ink, b.d, `${fmtN(b.c, 2)}${o.ccy ? ' ' + esc(o.ccy) : ''} (${d >= 0 ? '+' : ''}${d.toFixed(2)}%)`) + key(T.sma50, 'SMA 50', fmtN(ind.s50[i], M.dec)) + key(T.sma100, 'SMA 100', fmtN(ind.s100[i], M.dec)) + key(T.sma200, 'SMA 200', fmtN(ind.s200[i], M.dec)) + key(T.rsi, 'RSI 14', fmtN(ind.rsi[i], 0)) + (M.hasVol ? key(T.volUp, tr('Объём', 'Volume'), fmtVol(b.v)) : '');
    };
    paintLegend(bars.length - 1);
    const byTime = {}; M.markers.forEach(m => { (byTime[m.time] = byTime[m.time] || []).push(m); });
    chart.subscribeCrosshairMove(param => {
      if (!param || !param.time || !param.point) { tip.hidden = true; paintLegend(bars.length - 1); return; }
      const k = M.view.findIndex(b => b.d === param.time); if (k < 0) { tip.hidden = true; return; }
      const gi = off + k, b = bars[gi], ch = (b.c / b.o - 1) * 100; paintLegend(gi);
      const ev = (byTime[b.d] || []).map(m => { const l = m.label || m.text; return `<div class="sc-tip-e">${esc(l)}${m.why && m.why !== l ? ' — ' + esc(String(m.why).slice(0, 80)) : ''}</div>`; }).join('');
      tip.innerHTML = `<div class="sc-tip-d">${b.d}</div><div class="sc-tip-r"><b>${fmtN(b.c, 2)}</b><span>${tr('закр.', 'close')}</span></div><div class="sc-tip-r"><b>${fmtN(b.o, 2)}</b><span>${tr('откр.', 'open')}</span></div><div class="sc-tip-r"><b>${fmtN(b.h, 2)} / ${fmtN(b.l, 2)}</b><span>max / min</span></div><div class="sc-tip-r"><b class="${ch >= 0 ? 'up' : 'dn'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</b><span>${tr('день', 'day')}</span></div>${M.hasVol ? `<div class="sc-tip-r"><b>${fmtVol(b.v)}</b><span>${tr('объём', 'vol')}</span></div>` : ''}${ind.rsi[gi] != null ? `<div class="sc-tip-r"><b>${ind.rsi[gi].toFixed(0)}</b><span>RSI</span></div>` : ''}${ev}`;
      tip.hidden = false;
      const x = param.point.x, w = wrap.clientWidth, tw = tip.offsetWidth || 180;
      tip.style.left = (x + 14 + tw > w ? Math.max(0, x - 14 - tw) : x + 14) + 'px'; tip.style.top = Math.max(6, param.point.y - 40) + 'px';
    });
    chart.timeScale().fitContent();
    return { chart, setSide(sd) { o.side = sd; M = chartModel(bars, snap, rep, o); drawLines(); }, destroy() { try { chart.remove(); } catch (e) {} } };
  }
  root.chartModel = chartModel; root.chartTheme = chartTheme; root.renderStockChart = renderStockChart;
  root.chartStatsText = statsText; root.chartBarAt = barAt;
})(typeof globalThis !== 'undefined' ? globalThis : window);

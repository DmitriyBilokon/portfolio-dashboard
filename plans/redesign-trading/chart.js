// График акции для прототипа: lightweight-charts v5.
// renderStockChart(el, bars, snap, {side, theme, showPivots, years}) → {chart, destroy, setSide}
// Слои (снизу вверх): зоны S/R (примитив) → свечи → объём (оверлей внизу) → SMA50/100/200 →
// линии Вход/Стоп/Цель (по side) → маркеры исторических сигналов; отдельная панель RSI(14).
(function (root) {
  const LWC = () => root.LightweightCharts;

  // Примитив «зоны уровней»: полупрозрачные полосы ±band вокруг структурных уровней.
  class ZonesPrimitive {
    constructor(zones) { this.zones = zones; this.series = null; }
    attached(p) { this.series = p.series; this.req = p.requestUpdate; }
    detached() { this.series = null; }
    updateAllViews() {}
    setZones(z) { this.zones = z; if (this.req) this.req(); }
    paneViews() {
      const self = this;
      return [{
        zOrder() { return 'bottom'; },
        renderer() {
          return {
            draw(target) {
              target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
                if (!self.series) return;
                for (const z of self.zones) {
                  const y1 = self.series.priceToCoordinate(z.hi), y2 = self.series.priceToCoordinate(z.lo);
                  if (y1 == null || y2 == null) continue;
                  const top = Math.min(y1, y2), h = Math.max(1, Math.abs(y2 - y1));
                  ctx.fillStyle = z.fill; ctx.fillRect(0, top, mediaSize.width, h);
                  ctx.fillStyle = z.line; ctx.fillRect(0, z.kind === 'sup' ? top : top + h - 1, mediaSize.width, 1);
                  ctx.font = '600 10px ' + z.font; ctx.fillStyle = z.ink; ctx.textBaseline = z.kind === 'sup' ? 'top' : 'bottom';
                  ctx.fillText(z.label, 8, z.kind === 'sup' ? top + 3 : top + h - 3);
                }
              });
            },
          };
        },
      }];
    }
  }

  function fmtN(v, d) { return v == null || !isFinite(v) ? '—' : v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmtVol(v) { return v >= 1e9 ? (v / 1e9).toFixed(2) + ' млрд' : v >= 1e6 ? (v / 1e6).toFixed(1) + ' млн' : v >= 1e3 ? (v / 1e3).toFixed(0) + ' тыс' : String(v); }

  function renderStockChart(el, bars, snap, opts) {
    const L = LWC(), T = opts.theme, side = opts.side || 'long', show = Math.min(bars.length, opts.bars || 252);
    const view = bars.slice(bars.length - show), off = bars.length - show;
    el.innerHTML = '';
    const wrap = document.createElement('div'); wrap.className = 'sc-wrap'; el.appendChild(wrap);
    const dec = snap.price >= 500 ? 0 : snap.price >= 20 ? 1 : 2;
    const chart = L.createChart(wrap, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: T.muted, fontFamily: T.font, fontSize: 11, attributionLogo: false,
        panes: { separatorColor: T.grid, separatorHoverColor: T.grid, enableResize: false } },
      grid: { vertLines: { color: T.grid }, horzLines: { color: T.grid } },
      rightPriceScale: { borderColor: T.grid, scaleMargins: { top: 0.08, bottom: 0.06 }, minimumWidth: 64 },
      timeScale: { borderColor: T.grid, rightOffset: 6, barSpacing: Math.max(3, Math.min(9, wrap.clientWidth / show)) },
      crosshair: { mode: L.CrosshairMode.Normal, vertLine: { color: T.muted, width: 1, style: L.LineStyle.Solid, labelBackgroundColor: T.ink }, horzLine: { color: T.muted, width: 1, style: L.LineStyle.Solid, labelBackgroundColor: T.ink } },
      localization: { priceFormatter: p => fmtN(p, dec), locale: 'ru-RU' },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    // 1. Свечи
    const candles = chart.addSeries(L.CandlestickSeries, { upColor: T.up, downColor: T.down, borderVisible: false, wickUpColor: T.up, wickDownColor: T.down, priceLineVisible: true, priceLineColor: T.ink, priceLineWidth: 1, priceLineStyle: L.LineStyle.Dotted, lastValueVisible: true });
    candles.setData(view.map(b => ({ time: b.d, open: b.o, high: b.h, low: b.l, close: b.c })));
    // 2. Объём — своя панель (index 1), без ценовой оси
    const vol = chart.addSeries(L.HistogramSeries, { priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false }, 1);
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 }, minimumWidth: 64 });
    vol.setData(view.map(b => ({ time: b.d, value: b.v, color: b.c >= b.o ? T.volUp : T.volDown })));
    // 3. SMA
    const ind = snap.ind, mk = (arr, color, title) => { const s = chart.addSeries(L.LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: '' }); s.setData(view.map((b, i) => ({ time: b.d, value: arr[off + i] })).filter(p => p.value != null)); return s; };
    const s50 = mk(ind.s50, T.sma50), s100 = mk(ind.s100, T.sma100), s200 = mk(ind.s200, T.sma200);
    // 4. Зоны структурных уровней (±0.3·ATR), не более 2 сверху и 2 снизу; подписи без наложения
    const band = 0.3 * snap.atr, zones = [], lay = opts.layers || { sma: true, zones: true, markers: true };
    if (lay.zones !== false) {
      snap.levels.sup.filter(x => x.kind !== 'pivot').slice(0, 2).forEach(x => zones.push({ kind: 'sup', lo: x.v - band, hi: x.v + band, label: 'S · ' + x.src.replace(/\+/g, ' · '), fill: T.zoneSup, line: T.zoneSupLine, ink: T.text2, font: T.font }));
      snap.levels.res.filter(x => x.kind !== 'pivot').slice(0, 2).forEach(x => zones.push({ kind: 'res', lo: x.v - band, hi: x.v + band, label: 'R · ' + x.src.replace(/\+/g, ' · '), fill: T.zoneRes, line: T.zoneResLine, ink: T.text2, font: T.font }));
    }
    const zonesPrim = new ZonesPrimitive(zones); candles.attachPrimitive(zonesPrim);
    if (lay.sma === false) { [s50, s100, s200].forEach(s => s.applyOptions({ visible: false })); }
    // 5. План сделки: Вход / Стоп / Цель (opts.plan переопределяет план стороны — например, план открытой позиции)
    let lines = [];
    const drawPlan = (sd, planOverride) => {
      lines.forEach(l => candles.removePriceLine(l)); lines = [];
      const p = planOverride || opts.plan || (snap.plans ? snap.plans[sd] : snap[sd]);
      const atMarket = Math.abs(p.entry - snap.price) / snap.price < 0.0005;
      lines.push(candles.createPriceLine({ price: p.entry, color: T.entry, lineWidth: atMarket ? 1 : 2, lineStyle: atMarket ? L.LineStyle.Dotted : L.LineStyle.Solid, axisLabelVisible: !atMarket, title: atMarket ? '' : (p.mode === 'limit' ? 'Лимит' : 'Вход') }));
      lines.push(candles.createPriceLine({ price: p.stop, color: T.stop, lineWidth: 2, lineStyle: L.LineStyle.LargeDashed, axisLabelVisible: true, title: 'Стоп' }));
      lines.push(candles.createPriceLine({ price: p.target, color: T.target, lineWidth: 2, lineStyle: L.LineStyle.LargeDashed, axisLabelVisible: true, title: 'Цель' }));
    };
    drawPlan(side);
    // 6. Маркеры исторических сигналов
    const M = snap.markers.filter(m => m.i >= off).map(m => ({ time: m.d,
      position: (m.kind === 'buy' || m.kind === 'cover') ? 'belowBar' : 'aboveBar',
      color: m.kind === 'buy' ? T.long : m.kind === 'sell' ? T.exit : m.kind === 'short' ? T.short : T.muted,
      shape: (m.kind === 'buy' || m.kind === 'cover') ? 'arrowUp' : 'arrowDown',
      text: m.kind === 'buy' ? 'вход' : m.kind === 'sell' ? 'выход' : m.kind === 'short' ? 'шорт' : 'закр.' }));
    if (lay.markers !== false) L.createSeriesMarkers(candles, M);
    // 7. Панель RSI(14) — index 2
    const rsi = chart.addSeries(L.LineSeries, { color: T.rsi, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: 'price', precision: 0, minMove: 1 } }, 2);
    rsi.setData(view.map((b, i) => ({ time: b.d, value: ind.rsi[off + i] })).filter(p => p.value != null));
    rsi.createPriceLine({ price: 70, color: T.rsiBand, lineWidth: 1, lineStyle: L.LineStyle.Solid, axisLabelVisible: false, title: '' });
    rsi.createPriceLine({ price: 30, color: T.rsiBand, lineWidth: 1, lineStyle: L.LineStyle.Solid, axisLabelVisible: false, title: '' });
    rsi.priceScale().applyOptions({ minimumWidth: 64 });
    const panes = chart.panes(), H = wrap.clientHeight;
    if (panes[1]) panes[1].setHeight(Math.max(48, Math.round(H * 0.13)));
    if (panes[2]) panes[2].setHeight(Math.max(56, Math.round(H * 0.16)));
    // 8. Легенда + тултип (crosshair → все серии на этом X)
    const legend = document.createElement('div'); legend.className = 'sc-legend'; el.appendChild(legend);
    const key = (c, l, v, dashed) => `<span class="sc-k"><i style="background:${c}${dashed ? ';height:0;border-top:2px dashed ' + c + ';background:none' : ''}"></i>${l}${v != null ? ` <b>${v}</b>` : ''}</span>`;
    const tip = document.createElement('div'); tip.className = 'sc-tip'; tip.hidden = true; wrap.appendChild(tip);
    const paintLegend = (i) => {
      const b = bars[i], d = i > 0 ? (b.c / bars[i - 1].c - 1) * 100 : 0;
      legend.innerHTML = key(T.ink, b.d, `${fmtN(b.c, 2)} (${d >= 0 ? '+' : ''}${d.toFixed(2)}%)`) + key(T.sma50, 'SMA 50', fmtN(ind.s50[i], 1)) + key(T.sma100, 'SMA 100', fmtN(ind.s100[i], 1)) + key(T.sma200, 'SMA 200', fmtN(ind.s200[i], 1)) + key(T.rsi, 'RSI 14', fmtN(ind.rsi[i], 0)) + key(T.volUp, 'Объём', fmtVol(b.v));
    };
    paintLegend(bars.length - 1);
    chart.subscribeCrosshairMove(param => {
      if (!param || !param.time || !param.point) { tip.hidden = true; paintLegend(bars.length - 1); return; }
      const idx = view.findIndex(b => b.d === param.time); if (idx < 0) { tip.hidden = true; return; }
      const gi = off + idx, b = bars[gi]; paintLegend(gi);
      const ch = (b.c / b.o - 1) * 100;
      tip.innerHTML = `<div class="sc-tip-d">${b.d}</div><div class="sc-tip-r"><b>${fmtN(b.c, 2)}</b><span>закр.</span></div><div class="sc-tip-r"><b>${fmtN(b.o, 2)}</b><span>откр.</span></div><div class="sc-tip-r"><b>${fmtN(b.h, 2)} / ${fmtN(b.l, 2)}</b><span>max / min</span></div><div class="sc-tip-r"><b class="${ch >= 0 ? 'up' : 'dn'}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</b><span>день</span></div><div class="sc-tip-r"><b>${fmtVol(b.v)}</b><span>объём</span></div>${ind.rsi[gi] != null ? `<div class="sc-tip-r"><b>${ind.rsi[gi].toFixed(0)}</b><span>RSI</span></div>` : ''}`;
      tip.hidden = false;
      const x = param.point.x, w = wrap.clientWidth; tip.style.left = (x + 14 + 170 > w ? x - 14 - 170 : x + 14) + 'px'; tip.style.top = Math.max(6, param.point.y - 40) + 'px';
    });
    chart.timeScale().fitContent();
    return { chart, candles, setSide: drawPlan, destroy() { try { chart.remove(); } catch (e) {} } };
  }
  root.renderStockChart = renderStockChart;
})(typeof window !== 'undefined' ? window : globalThis);

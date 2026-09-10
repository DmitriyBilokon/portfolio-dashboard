// 📡 Слой сигналов v2 — единственное место порогов входа/выхода (plans/redesign-trading.md §4).
// Чистые функции: без DOM и глобалов приложения; вход — дневные свечи [{d,o,h,l,c,v}] по возрастанию даты.
// Порт порогов старых движков: pf3SignalInfo (≤2 % к уровню), pf3Criterion (фазы → phase, паритет в тестах),
// scenarioShort (коридор 2.5·ATR, фолбэк 1.5·ATR), indexLevels воркера (пивоты + свинги, схлопывание 0.3 %),
// SR_WINDOW=60. Новое: ATR по True Range (Wilder 14), стоп за структурным уровнем (мин. 1·ATR),
// вход у уровня (лимит) и лимит-цена под R/R = rrGood, размер от риска в kr («½ риска» при
// неподтверждённом тренде), зеркальный шорт, флаги wide/half/squeeze/knife/stale-target/earnings/no-short/atr-target.
// S4 — теневой режим: UI старых движков не меняется, вердикт v2 показывается рядом (колонка «Вердикт v2»).
// Калибровка 2026-09-10 (plans/signals-calibration.md §5, VER): цель-фолбэк 2·ATR, wide > 2·ATR, нож по
// вчерашнему S60, перегрев по таргету только над SMA50, недооценка над SMA200 → hold, пробой ≠ откат.
// Грузится до app.js; глобал SIG (в node — module.exports).
(function (root) {
  // atrMult — стоп-фолбэк без уровня; targetAtr — цель-фолбэк без уровня (флаг atr-target); wideAtr — порог
  // флага wide (подсказка «½ риска», не блокер). Потолка стопа нет: коридор + буфер дают максимум 3·ATR.
  const CFG = { corridorAtr: 2.5, atrMult: 1.5, targetAtr: 2.0, stopBufAtr: 0.5, minTargetAtr: 1.0, minStopAtr: 1.0, wideAtr: 2.0, limitOffAtr: 0.25, rrMin: 2.0, rrWeak: 1.2, rrGood: 2.0, nearPct: 2, clusterPct: 0.3, srWindow: 60, swingWindow: 20, rsiHot: 70, rsiCold: 30, squeezeDay: 4, squeezeVol: 2, staleTgPct: 50, earnDays: 3, minBars: 60 };
  const VER = '2026-09-10-c1';   // версия правил — пишется в журнал тени, чтобы отделять наблюдения до/после калибровки
  const struct = x => x.kind !== 'pivot';
  // R/R ≥ порога с допуском на плавающую точку: цель и стоп, кратные ATR, дают то 2.0, то 1.9999999.
  const EPS = 1e-9, rrOk = (rr, thr) => rr != null && rr >= thr - EPS;
  // Пробой, а не откат/отбой: уровень у цены собран только из экстремумов «чужой» стороны — максимумы
  // (R60/R20/H52w) под ценой = цена у свежего максимума; минимумы (S60/S20/L52w) над ценой = у свежего минимума.
  const HIGHS = ['R60', 'R20', 'H52w'], LOWS = ['S60', 'S20', 'L52w'], PIVOTS = ['P', 'R1', 'S1', 'R2', 'S2'];
  function isBreakout(x, price) {
    if (!x) return false;
    const parts = x.src.split('+').filter(p => !PIVOTS.includes(p)), foreign = x.v <= price ? HIGHS : LOWS;
    return parts.length > 0 && parts.every(p => foreign.includes(p));
  }

  function sma(cl, n) { const o = new Array(cl.length).fill(null); let s = 0; for (let i = 0; i < cl.length; i++) { s += cl[i]; if (i >= n) s -= cl[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
  function atrWilder(bars, n = 14) {
    const o = new Array(bars.length).fill(null); if (bars.length < n) return o;
    const tr = bars.map((b, i) => i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)));
    let a = 0; for (let i = 0; i < n; i++) a += tr[i]; a /= n; o[n - 1] = a;
    for (let i = n; i < bars.length; i++) { a = (a * (n - 1) + tr[i]) / n; o[i] = a; }
    return o;
  }
  function rsiWilder(cl, n = 14) {
    const o = new Array(cl.length).fill(null); if (cl.length <= n) return o;
    let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = cl[i] - cl[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); }
    let ag = g / n, al = l / n; o[n] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = n + 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; ag = (ag * (n - 1) + Math.max(d, 0)) / n; al = (al * (n - 1) + Math.max(-d, 0)) / n; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    return o;
  }
  // Ответ воркера ?history= → свечи. Новый формат {t,o,h,l,c,v}; старый {t,c} терпится (o=h=l=c, v=0 —
  // ATR тогда считается по гэпам закрытий). Невалидные закрытия пропускаются, h/l охватывают o/c.
  function barsFromHist(j) {
    const out = []; if (!j || !Array.isArray(j.c)) return out;
    const ok = x => typeof x === 'number' && isFinite(x) && x > 0, t = j.t || [];
    for (let i = 0; i < j.c.length; i++) {
      const c = j.c[i]; if (!ok(c)) continue;
      const o = j.o && ok(j.o[i]) ? j.o[i] : c, h = Math.max(j.h && ok(j.h[i]) ? j.h[i] : c, o, c), l = Math.min(j.l && ok(j.l[i]) ? j.l[i] : c, o, c);
      out.push({ d: t[i] ? new Date(t[i] * 1000).toISOString().slice(0, 10) : '', o, h, l, c, v: j.v && ok(j.v[i]) ? j.v[i] : 0 });
    }
    return out;
  }
  // Схлопывание уровней ближе clusterPct друг к другу (как collapseLevels в воркере).
  function collapse(levels, pct = CFG.clusterPct) {
    const s = levels.filter(x => x && isFinite(x.v) && x.v > 0).sort((a, b) => a.v - b.v), out = [];
    for (const x of s) { const last = out[out.length - 1]; if (last && Math.abs(x.v - last.v) / last.v * 100 <= pct) { last.src = last.src + '+' + x.src; last.w = (last.w || 1) + 1; if (last.kind === 'pivot' && x.kind !== 'pivot') last.kind = x.kind; } else out.push({ ...x, w: 1 }); }
    return out;
  }
  // Все уровни на баре i: SMA, 60-дн S/R по high/low, 20-дн свинги, 52-нед экстремумы, пивоты от предыдущего бара.
  function levelsAt(bars, i, ind) {
    const b = bars[i], p = bars[i - 1] || b, price = b.c, L = [];
    const push = (v, src, kind) => { if (v > 0 && isFinite(v)) L.push({ v, src, kind }); };
    push(ind.s50[i], 'SMA50', 'ma'); push(ind.s100[i], 'SMA100', 'ma'); push(ind.s200[i], 'SMA200', 'ma');
    const lo = k => Math.min(...bars.slice(Math.max(0, i - k + 1), i + 1).map(x => x.l)), hi = k => Math.max(...bars.slice(Math.max(0, i - k + 1), i + 1).map(x => x.h));
    if (i >= CFG.srWindow - 1) { push(lo(CFG.srWindow), 'S60', 'sr'); push(hi(CFG.srWindow), 'R60', 'sr'); }
    if (i >= CFG.swingWindow - 1) { push(lo(CFG.swingWindow), 'S20', 'swing'); push(hi(CFG.swingWindow), 'R20', 'swing'); }
    if (i >= 251) { push(lo(252), 'L52w', 'yr'); push(hi(252), 'H52w', 'yr'); }
    const P = (p.h + p.l + p.c) / 3; push(P, 'P', 'pivot'); push(2 * P - p.l, 'R1', 'pivot'); push(2 * P - p.h, 'S1', 'pivot'); push(P + (p.h - p.l), 'R2', 'pivot'); push(P - (p.h - p.l), 'S2', 'pivot');
    const all = collapse(L);
    const res = all.filter(x => x.v > price).sort((a, b) => a.v - b.v), sup = all.filter(x => x.v < price).sort((a, b) => b.v - a.v);
    return { price, res, sup, all };
  }
  function indicators(bars) { const cl = bars.map(b => b.c); return { s50: sma(cl, 50), s100: sma(cl, 100), s200: sma(cl, 200), atr: atrWilder(bars, 14), rsi: rsiWilder(cl, 14) }; }
  // Фаза рынка — порт pf3Criterion 1:1 (те же пороги и порядок; key = cls старого бейджа). upTg — апсайд
  // к эффективному таргету, % (null — без таргета). Паритет проверяется тестом «phase parity».
  function phase(price, day, a50, a100, a200, sup, upTg) {
    if (!(price > 0) || !(a50 > 0) || !(a200 > 0)) return { key: 'flat', label: 'Боковик', rank: 3 };
    const belowAll = price < a50 && (!(a100 > 0) || price < a100) && price < a200, aboveAll = price > a50 && (!(a100 > 0) || price > a100) && price > a200;
    if (belowAll && (day <= -3 || (sup > 0 && price < sup))) return { key: 'knife', label: 'Падающий нож', rank: 0 };
    if (upTg != null && upTg <= -5) return { key: 'heat', label: 'Перегрев', rank: 8 };
    if (aboveAll && price > a200 * 1.3) return { key: 'heat', label: 'Перегрев', rank: 8 };
    if ((day >= 2.5 && price > a50) || day >= 4) return { key: 'imp', label: 'Импульс', rank: 7 };
    if (upTg != null && upTg >= 25 && !belowAll) return { key: 'undr', label: 'Недооценка', rank: 5 };
    if (aboveAll) return { key: 'up', label: 'Аптренд', rank: 6 };
    if (belowAll) return { key: 'down', label: 'Даунтренд', rank: 1 };
    if (price < a50 && price >= a200) return { key: 'corr', label: 'Коррекция', rank: 2 };
    if (price >= a50 && price < a200) return { key: 'rev', label: 'Разворот', rank: 4 };
    return { key: 'flat', label: 'Боковик', rank: 3 };
  }
  // Лимит-цена, при которой (цель − вход)/(вход − стоп) = rr (для обеих сторон одна формула).
  function limitForRR(target, stop, rr) { return (target + rr * stop) / (1 + rr); }
  // План сделки. side: 'long' | 'short'. opts: riskKr — риск в kr, fx — курс валюты бумаги к SEK,
  // entry — лимит-цена (иначе по рынку), half — «½ риска». Стоп: ближайший структурный уровень за входом
  // в коридоре 2.5·ATR с буфером 0.5·ATR (иначе ∓1.5·ATR), дистанция не меньше 1·ATR (wide при > 2·ATR);
  // цель: ближайший структурный уровень ≥ 1·ATR в коридоре 2.5·ATR (иначе ±2·ATR, флаг atr-target).
  // Размер = floor(riskKr / (риск на акцию × fx)) — как qtyByRisk.
  function tradePlan(side, lv, atr, opts) {
    const o = Object.assign({ riskKr: 5000, fx: 1, entry: null, half: false }, opts || {}), corr = CFG.corridorAtr * atr;
    const entry = o.entry > 0 ? o.entry : lv.price, minT = CFG.minTargetAtr * atr, minS = CFG.minStopAtr * atr;
    const sgn = side === 'long' ? 1 : -1, flags = [];
    let target, stop, targetSrc, stopSrc;
    const tCands = (side === 'long' ? lv.res : lv.sup).filter(struct).filter(x => sgn * (x.v - entry) >= minT && sgn * (x.v - entry) <= corr);
    const t = tCands[0]; target = t ? t.v : entry + sgn * CFG.targetAtr * atr; targetSrc = t ? t.src : `${sgn > 0 ? '+' : '−'}${CFG.targetAtr}·ATR`;
    if (!t) flags.push('atr-target');
    const sCands = (side === 'long' ? lv.sup : lv.res).filter(struct).filter(x => sgn * (entry - x.v) > 0 && sgn * (entry - x.v) <= corr);
    const s = sCands[0]; stop = s ? s.v - sgn * CFG.stopBufAtr * atr : entry - sgn * CFG.atrMult * atr; stopSrc = s ? `${s.src} ${sgn > 0 ? '−' : '+'} ${CFG.stopBufAtr}·ATR` : `${sgn > 0 ? '−' : '+'}${CFG.atrMult}·ATR`;
    let dist = sgn * (entry - stop);
    if (dist < minS) { stop = entry - sgn * minS; stopSrc += ` → мин. ${CFG.minStopAtr}·ATR`; dist = minS; }
    if (dist > CFG.wideAtr * atr * (1 + EPS)) flags.push('wide');
    const reward = sgn * (target - entry), risk = dist, rr = risk > 0 ? reward / risk : null;
    const perShareKr = risk * o.fx; let qty = perShareKr > 0 ? Math.floor(o.riskKr / perShareKr) : 0;
    if (o.half) { qty = Math.floor(qty / 2); flags.push('half'); }
    return { side, entry, stop, target, rr, reward, risk, rewardPct: reward / entry * 100, riskPct: risk / entry * 100, qty, notionalKr: qty * entry * o.fx, riskKr: qty * risk * o.fx, targetSrc, stopSrc, flags, mode: o.entry > 0 ? 'limit' : 'market', dEntry: o.entry > 0 ? (o.entry / lv.price - 1) * 100 : 0 };
  }
  // Ближайший структурный уровень (порт pf3SignalInfo): ≤ nearPct — «у уровня».
  function nearLevel(lv) {
    let best = null; lv.all.filter(struct).forEach(x => { const dist = (lv.price - x.v) / x.v * 100; if (!best || Math.abs(dist) < Math.abs(best.dist)) best = { ...x, dist }; });
    return best && Math.abs(best.dist) <= CFG.nearPct ? best : null;
  }
  // План на сторону для snapshot. atLevel — цена у своего уровня (не пробой): по рынку, если R/R ≥ rrMin;
  // при rrWeak ≤ R/R < rrMin — лимит-цена под R/R rrGood на стопе и цели рыночного плана (noLimit, если она
  // не помещается между стопом и ценой). Иначе — условный лимит у ближайшего своего уровня, строго по ту
  // сторону цены (уровень у самой цены, напр. пробитый максимум, пропускается — лимит выше рынка бессмыслен).
  function sidePlan(side, lv, atr, atLevel, opts) {
    const base = Object.assign({ riskKr: 5000, fx: 1, half: false }, opts || {}), sgn = side === 'long' ? 1 : -1;
    const mkt = tradePlan(side, lv, atr, base);
    if (atLevel) {
      if (rrOk(mkt.rr, CFG.rrMin)) return mkt;
      if (rrOk(mkt.rr, CFG.rrWeak)) {
        // Лимит-цена под R/R = rrGood на СТОПЕ и ЦЕЛИ рыночного плана (R/R гарантирован по построению).
        const e = limitForRR(mkt.target, mkt.stop, CFG.rrGood), ok = sgn * (lv.price - e) > 0 && sgn * (e - mkt.stop) > 0;
        if (!ok) return Object.assign({}, mkt, { noLimit: true });
        const risk = sgn * (e - mkt.stop), reward = sgn * (mkt.target - e), per = risk * base.fx; let qty = per > 0 ? Math.floor(base.riskKr / per) : 0; if (base.half) qty = Math.floor(qty / 2);
        return { ...mkt, entry: e, mode: 'limit', dEntry: (e / lv.price - 1) * 100, risk, reward, rr: reward / risk, riskPct: risk / e * 100, rewardPct: reward / e * 100, qty, notionalKr: qty * e * base.fx, riskKr: qty * risk * base.fx, levelSrc: 'лимит под R/R ' + CFG.rrGood, flags: mkt.flags.filter(f => f !== 'wide').concat(risk > CFG.wideAtr * atr * (1 + EPS) ? ['wide'] : []) };
      }
      return mkt;
    }
    const off = CFG.limitOffAtr * atr, L = (side === 'long' ? lv.sup : lv.res).filter(struct).find(x => sgn * (lv.price - (x.v + sgn * off)) > 0);
    if (!L) return mkt;
    const p = tradePlan(side, lv, atr, { ...base, entry: L.v + sgn * off }); p.levelSrc = L.src; return p;
  }
  // Сделка по плану с бара входа i (вход по закрытию): лестница выхода плана §4 — стоп (при гэпе за стопом —
  // по открытию); ½ позиции на цели; после +1R стоп в безубыток, после +2R — chandelier 2·ATR от экстремума.
  // Внутри бара сначала стоп, потом цель (консервативно). Отчётов в истории нет — сокращения перед отчётом нет.
  function simTrade(bars, ind, i, side, plan) {
    const sgn = side === 'long' ? 1 : -1, entry = bars[i].c, stop0 = plan.stop, target = plan.target, risk = sgn * (entry - stop0);
    const exits = []; let stop = stop0, stage = 'стоп', left = 1, ext = entry, j = i + 1;
    if (!(risk > 0)) return null;
    for (; j < bars.length && left > 0; j++) {
      const b = bars[j];
      if (sgn > 0 ? b.l <= stop : b.h >= stop) { exits.push({ j, d: b.d, px: sgn > 0 ? Math.min(b.o, stop) : Math.max(b.o, stop), part: left, why: stage }); left = 0; break; }
      if (left === 1 && (sgn > 0 ? b.h >= target : b.l <= target)) { exits.push({ j, d: b.d, px: sgn > 0 ? Math.max(b.o, target) : Math.min(b.o, target), part: 0.5, why: 'цель ½' }); left = 0.5; }
      ext = sgn > 0 ? Math.max(ext, b.h) : Math.min(ext, b.l);
      const gainR = sgn * (ext - entry) / risk;
      if (gainR >= 1 && sgn * (entry - stop) > 0) { stop = entry; stage = 'безубыток'; }
      if (gainR >= 2 && ind.atr[j] > 0) { const ch = ext - sgn * 2 * ind.atr[j]; if (sgn * (ch - stop) > 0) { stop = ch; stage = 'трейлинг 2·ATR'; } }
    }
    const last = bars[bars.length - 1], open = left > 0;
    const R = exits.reduce((a, x) => a + x.part * sgn * (x.px - entry) / risk, 0) + (open ? left * sgn * (last.c - entry) / risk : 0);
    return { i, d: bars[i].d, side, entry, stop0, target, rr: plan.rr, exits, open, R, out: open ? null : exits[exits.length - 1].j, stop };
  }
  // Реплей вердикта по истории (решение Q4): вход — бар, где evalAt впервые дал buy/short (те же правила и CFG;
  // таргетов и отчётов в истории нет → upTg/earnings пусты), позиции не перекрываются; выход — simTrade.
  // → { trades, markers: [{i, d, kind: buy|short|part|exit, price, why}] }. Считать на бар ≥ 199 (нужна SMA200).
  function replay(bars, opts) {
    const o = Object.assign({ ind: null }, opts || {}), trades = [], M = [];
    if (!Array.isArray(bars) || bars.length < CFG.minBars) return { trades, markers: M };
    const ind = o.ind || indicators(bars);
    let prev = null, busy = -1;
    for (let i = Math.max(CFG.minBars - 1, 199); i < bars.length; i++) {
      const s = evalAt(bars, ind, i, { shortOk: true }), v = s.verdict, entryV = v === 'buy' || v === 'short';
      if (entryV && v !== prev && i > busy && i < bars.length - 1) {
        const t = simTrade(bars, ind, i, s.side, s.plan);
        if (t) {
          trades.push(Object.assign(t, { why: s.why[0] }));
          M.push({ i, d: t.d, kind: v, price: t.entry, why: s.why[0] });
          t.exits.forEach(x => M.push({ i: x.j, d: x.d, kind: x.part < 1 && x.why === 'цель ½' ? 'part' : 'exit', side: t.side, price: x.px, why: x.why }));
          busy = t.open ? bars.length : t.out;
        }
      }
      prev = v;
    }
    return { trades, markers: M };
  }
  // Итог сделок реплея с входом не раньше бара from: закрытые — n, в плюсе, средний R, PF; открытые — отдельно.
  function replayStats(trades, from) {
    const T = (trades || []).filter(t => t.i >= (from || 0)), C = T.filter(t => !t.open);
    const pos = C.filter(t => t.R > 0).reduce((a, t) => a + t.R, 0), neg = -C.filter(t => t.R < 0).reduce((a, t) => a + t.R, 0);
    return { n: C.length, win: C.filter(t => t.R > 0).length, avgR: C.length ? C.reduce((a, t) => a + t.R, 0) / C.length : null, pf: neg > 0 ? pos / neg : (pos > 0 ? Infinity : null), open: T.length - C.length };
  }
  // Вердикт на баре i по барам 0..i (всё причинно: индикаторы, уровни, пивоты от i−1, объём за 20 баров до i).
  // opts: riskKr, fx, upTg (апсайд к свежему таргету, %), staleTarget (bool), earningsDays (дней до отчёта;
  // null — неизвестно), shortOk (ручной флаг «шорт доступен»; пока не выставлен — предупреждение no-short, не
  // блокер, решение §10#7). Снимок «сейчас» = evalAt на последнем баре (snapshot), история — replay.
  function evalAt(bars, ind, i, opts) {
    const o = Object.assign({ riskKr: 5000, fx: 1, upTg: null, staleTarget: false, earningsDays: null, shortOk: false }, opts || {});
    const b = bars[i], pb = bars[i - 1];
    const lv = levelsAt(bars, i, ind), atr = ind.atr[i], day = (b.c / pb.c - 1) * 100;
    // Нож по пробою: S60 по барам до вчера включительно — сегодняшний low ≤ close, с ним пробоя не бывает (Q5).
    const s60prev = i >= CFG.srWindow ? Math.min(...bars.slice(i - CFG.srWindow, i).map(x => x.l)) : 0;
    let ph = phase(b.c, day, ind.s50[i], ind.s100[i], ind.s200[i], s60prev, o.upTg);
    // Перегрев по таргету — только над SMA50 (Q7); ниже — фаза по тренду, таргет — причина. Перегрев по
    // SMA200 требует цены над всеми SMA, поэтому здесь heat может быть только таргетным.
    const tgOver = ph.key === 'heat' && !(b.c > ind.s50[i]);
    if (tgOver) ph = phase(b.c, day, ind.s50[i], ind.s100[i], ind.s200[i], s60prev, null);
    const near = nearLevel(lv), nearSup = !!(near && near.v <= lv.price), nearRes = !!(near && near.v > lv.price), brk = isBreakout(near, lv.price);
    const trendUp = ind.s50[i] > ind.s200[i], rsiNow = ind.rsi[i], vol = b.v, avgVol = bars.slice(Math.max(0, i - 19), i + 1).reduce((s, x) => s + x.v, 0) / 20, volX = avgVol ? vol / avgVol : null;
    const rr = x => x != null ? x.toFixed(1) : '—', rrP = p => (p.flags.includes('atr-target') ? '≈' : '') + rr(p.rr);
    let side = 'long', verdict = 'wait', setup = null;
    const why = [], flags = [];
    // Держать без сетапа: аптренд, импульс и недооценка над SMA200 (Q8) — с условным лимитом на откат.
    const holdPh = ph.key === 'up' || ph.key === 'imp' || (ph.key === 'undr' && lv.price > ind.s200[i]);
    if (ph.key === 'knife') { verdict = 'wait'; why.push('падающий нож — ждать стабилизации у поддержки'); flags.push('knife'); }
    else if (ph.key === 'down' && !trendUp) {
      side = 'short';
      if (nearRes && !brk) { setup = 'отбой от сопротивления'; why.push(`даунтренд, цена под сопротивлением ${near.src} (${near.dist.toFixed(1)}%)`); }
      else if (nearRes) { why.push(`даунтренд, цена у свежего минимума ${near.src} — пробой вниз, не отбой; ждать ретеста`); }
      else if (nearSup) { why.push(`даунтренд, но цена у поддержки ${near.src} — шорт только после пробоя`); }
      else { why.push('даунтренд: SMA50 < SMA200 — шорт на подходе к сопротивлению'); }
    }
    else if (ph.key === 'heat') {
      // Перегрев двух видов (как в phase): цена выше таргета аналитиков ≥ 5 % и/или ≥ 30 % над SMA200.
      const over = (lv.price / ind.s200[i] - 1) * 100, parts = [];
      if (o.upTg != null && o.upTg <= -5) parts.push(`цена выше таргета аналитиков на ${(-o.upTg).toFixed(0)}%`);
      if (over >= 30 || !parts.length) parts.push(`+${over.toFixed(0)}% над SMA200`);
      verdict = 'trim'; why.push(`перегрев: ${parts.join(', ')} — фиксировать часть, новых покупок нет`);
    }
    else if ((ph.key === 'up' || ph.key === 'rev' || ph.key === 'corr' || ph.key === 'undr') && nearSup && !brk) { setup = 'откат к поддержке'; why.push(`откат к поддержке ${near.src} (${near.dist.toFixed(1)}%)`); }
    else if ((ph.key === 'up' || ph.key === 'imp') && nearRes) { verdict = 'hold'; why.push(`${ph.label.toLowerCase()}, цена под сопротивлением ${near.src} — не догонять`); }
    else if (nearSup && brk && ph.key !== 'down') { verdict = holdPh ? 'hold' : 'wait'; why.push(`${ph.label.toLowerCase()}, цена у свежего максимума ${near.src} — пробой, не откат; ждать ретеста`); }
    else if (holdPh) { verdict = 'hold'; why.push(`${ph.label.toLowerCase()} без сетапа — лимит на откат`); }
    else if (ph.key === 'corr' || ph.key === 'rev') { verdict = 'wait'; why.push(`${ph.label.toLowerCase()} — ждать касания поддержки`); }
    else if (ph.key === 'down' && trendUp) { verdict = 'wait'; why.push(`цена ниже всех SMA при SMA50 > SMA200 — глубокий откат, ждать возврата над SMA200 (${((ind.s200[i] / lv.price - 1) * 100).toFixed(1)}%)`); }
    else { verdict = 'wait'; why.push(`${ph.label.toLowerCase()} — нет сетапа`); }
    const half = side === 'long' && !!setup && !trendUp, base = { riskKr: o.riskKr, fx: o.fx };
    const plans = { long: sidePlan('long', lv, atr, nearSup && !brk, { ...base, half }), short: sidePlan('short', lv, atr, nearRes && !brk, base) };
    const plan = plans[side];
    if (setup) {
      if (plan.mode === 'market' && rrOk(plan.rr, CFG.rrMin)) { verdict = side === 'short' ? 'short' : 'buy'; why[why.length - 1] += ` · R/R ${rrP(plan)}`; }
      else if (plan.mode === 'limit') { verdict = 'wait'; why[why.length - 1] += ` · по рынку R/R ${rrP(tradePlan(side, lv, atr, base))} — лимит ${plan.entry.toFixed(plan.entry >= 500 ? 0 : 2)} даёт ${rrP(plan)}`; }
      else if (plan.noLimit) { verdict = 'wait'; why[why.length - 1] += ` · R/R ${rrP(plan)} < ${CFG.rrMin} — лимит под R/R ${CFG.rrGood} не помещается между стопом и ценой`; }
      else { verdict = 'wait'; why[why.length - 1] += ` · R/R ${rrP(plan)} < ${CFG.rrWeak} — цель слишком близко`; }
      if (half) { why.push('тренд не подтверждён (SMA50 < SMA200) — ранний вход, ½ риска'); }
    } else if (plan.mode === 'limit' && (verdict === 'hold' || verdict === 'wait') && ph.key !== 'knife') {
      why.push(`условный план: лимит у ${plan.levelSrc} (${plan.dEntry.toFixed(1)}%) · R/R ${rrP(plan)}`);
    }
    if (tgOver) why.push(`цена выше таргета аналитиков на ${(-o.upTg).toFixed(0)}% — под SMA50 это не перегрев, фаза по тренду`);
    if (plan.flags.includes('wide')) why.push(`широкий стоп: ${(plan.risk / atr).toFixed(1)}·ATR > ${CFG.wideAtr}·ATR — рассмотрите ½ риска`);
    if (side === 'short' && (day >= CFG.squeezeDay || (volX != null && volX >= CFG.squeezeVol && b.c > b.o))) { flags.push('squeeze'); why.push('риск сквиза: резкий рост/объём — шорт не открывать сегодня'); if (verdict === 'short') verdict = 'wait'; }
    if (o.earningsDays != null && o.earningsDays >= 0 && o.earningsDays <= CFG.earnDays) {
      flags.push('earnings'); why.push(`отчёт через ${o.earningsDays} дн — новых входов нет`);
      if (verdict === 'buy' || verdict === 'short') verdict = 'wait';
    }
    if (side === 'short' && !o.shortOk) { flags.push('no-short'); why.push('шорт: проверьте доступность и стоимость займа'); }
    if (o.staleTarget) flags.push('stale-target');
    flags.push(...plan.flags.filter(f => !flags.includes(f)));
    if (rsiNow != null && rsiNow > CFG.rsiHot) why.push(`RSI ${rsiNow.toFixed(0)} — перекуплен`);
    if (rsiNow != null && rsiNow < CFG.rsiCold) why.push(`RSI ${rsiNow.toFixed(0)} — перепродан`);
    if (volX != null && volX >= 1.5) why.push(`объём ×${volX.toFixed(1)} к среднему`);
    // Композитный балл 0..100 — только tie-breaker внутри группы вердикта.
    let score = 50;
    score += side === 'short' ? (trendUp ? -15 : 15) : (trendUp ? 15 : -15);
    score += (side === 'short' ? (8 - ph.rank) : ph.rank) * 2 - 8;
    if (near) score += side === 'short' ? (nearRes ? 12 : -6) : (nearSup ? 12 : -6);
    if (plan.rr != null) score += Math.max(-10, Math.min(15, (plan.rr - 1) * 15));
    if (rsiNow != null) score += side === 'short' ? (rsiNow > 60 ? 6 : rsiNow < 35 ? -8 : 0) : (rsiNow < 40 ? 6 : rsiNow > 70 ? -8 : 0);
    if (ph.key === 'knife') score -= 20; if (ph.key === 'heat') score -= 12;
    score = Math.round(Math.max(0, Math.min(100, score)));
    return { d: b.d, price: b.c, day, atr, atrPct: atr / b.c * 100, rsi: rsiNow, s50: ind.s50[i], s100: ind.s100[i], s200: ind.s200[i], trendUp, levels: lv, near, phase: ph, setup, plans, plan, long: plans.long, short: plans.short, side, verdict, why, flags, score, vol, avgVol, volX };
  }
  // Снимок «сейчас» для одной бумаги; null, если свечей < minBars. ind — индикаторы (для графика).
  function snapshot(bars, opts) {
    if (!Array.isArray(bars) || bars.length < CFG.minBars) return null;
    const ind = indicators(bars);
    return Object.assign(evalAt(bars, ind, bars.length - 1, opts), { ind });
  }
  // Сортировка везде одна: группа вердикта (buy/short → trim → hold/wait) → R/R ↓ → балл ↓.
  const GROUP = { buy: 0, short: 0, trim: 1, hold: 2, wait: 2 };
  function cmp(a, b) {
    const ga = GROUP[a.verdict] != null ? GROUP[a.verdict] : 3, gb = GROUP[b.verdict] != null ? GROUP[b.verdict] : 3;
    if (ga !== gb) return ga - gb;
    const ra = a.plan && a.plan.rr != null ? a.plan.rr : -Infinity, rb = b.plan && b.plan.rr != null ? b.plan.rr : -Infinity;
    if (ra !== rb) return rb - ra;
    return (b.score || 0) - (a.score || 0);
  }
  const API = { CFG, VER, rrOk, isBreakout, sidePlan, sma, atrWilder, rsiWilder, barsFromHist, collapse, levelsAt, indicators, phase, limitForRR, tradePlan, nearLevel, evalAt, snapshot, simTrade, replay, replayStats, cmp, GROUP };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.SIG = API;
})(typeof globalThis !== 'undefined' ? globalThis : window);

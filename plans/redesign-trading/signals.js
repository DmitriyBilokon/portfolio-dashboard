// Чистый слой сигналов (v2) для прототипа редизайна portfolio-dashboard.
// Порт порогов из существующего кода: pf3SignalInfo (≤2% к уровню), pf3Criterion (фазы),
// scenarioShort (коридор ±2.5·ATR, fallback ±1.5·ATR), indexLevels (пивоты + свинги, схлопывание 0.3%),
// SR_WINDOW=60 (воркер). Новое: ATR по True Range (Wilder 14), стоп за структурным уровнем с
// клэмпом [1, 3]·ATR, вход у уровня (лимит) и лимит-цена, при которой R/R = 1.5, размер
// позиции от риска в kr («½ риска» при неподтверждённом тренде), зеркальный режим шорт, флаги.
// Работает и в браузере (глобал SIG), и в node (module.exports).
(function (root) {
  const CFG = { corridorAtr: 2.5, atrMult: 1.5, stopBufAtr: 0.5, minTargetAtr: 1.0, minStopAtr: 1.0, maxStopAtr: 3.0, limitOffAtr: 0.25, rrMin: 2.0, rrWeak: 1.2, rrGood: 2.0, nearPct: 2, clusterPct: 0.3, srWindow: 60, swingWindow: 20, rsiHot: 70, rsiCold: 30, squeezeDay: 4, squeezeVol: 2 };
  const struct = x => x.kind !== 'pivot';

  // bars: [{d,o,h,l,c,v}] по возрастанию даты
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
  // Фаза рынка — порт pf3Criterion (без таргета аналитиков, если upTg==null).
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
  // с буфером 0.5·ATR, клэмп дистанции [1, 3]·ATR (wide при 3); цель: ближайший структурный уровень ≥ 1·ATR
  // в коридоре 2.5·ATR (иначе ±1.5·ATR).
  function tradePlan(side, lv, atr, opts) {
    const o = Object.assign({ riskKr: 5000, fx: 1, entry: null, half: false }, opts || {}), corr = CFG.corridorAtr * atr;
    const entry = o.entry > 0 ? o.entry : lv.price, minT = CFG.minTargetAtr * atr, minS = CFG.minStopAtr * atr, maxS = CFG.maxStopAtr * atr;
    const sgn = side === 'long' ? 1 : -1, flags = [];
    let target, stop, targetSrc, stopSrc;
    const tCands = (side === 'long' ? lv.res : lv.sup).filter(struct).filter(x => sgn * (x.v - entry) >= minT && sgn * (x.v - entry) <= corr);
    const t = tCands[0]; target = t ? t.v : entry + sgn * CFG.atrMult * atr; targetSrc = t ? t.src : `${sgn > 0 ? '+' : '−'}${CFG.atrMult}·ATR`;
    const sCands = (side === 'long' ? lv.sup : lv.res).filter(struct).filter(x => sgn * (entry - x.v) > 0 && sgn * (entry - x.v) <= corr);
    const s = sCands[0]; stop = s ? s.v - sgn * CFG.stopBufAtr * atr : entry - sgn * CFG.atrMult * atr; stopSrc = s ? `${s.src} ${sgn > 0 ? '−' : '+'} ${CFG.stopBufAtr}·ATR` : `${sgn > 0 ? '−' : '+'}${CFG.atrMult}·ATR`;
    let dist = sgn * (entry - stop);
    if (dist < minS) { stop = entry - sgn * minS; stopSrc += ` → мин. ${CFG.minStopAtr}·ATR`; dist = minS; }
    if (dist > maxS) { stop = entry - sgn * maxS; stopSrc += ` → макс. ${CFG.maxStopAtr}·ATR`; dist = maxS; flags.push('wide'); }
    const reward = sgn * (target - entry), risk = dist, rr = risk > 0 ? reward / risk : null;
    const perShareKr = risk * o.fx; let qty = perShareKr > 0 ? Math.floor(o.riskKr / perShareKr) : 0;
    if (o.half) { qty = Math.floor(qty / 2); flags.push('half'); }
    return { side, entry, stop, target, rr, reward, risk, rewardPct: reward / entry * 100, riskPct: risk / entry * 100, qty, notionalKr: qty * entry * o.fx, riskKr: qty * risk * o.fx, targetSrc, stopSrc, flags, mode: o.entry > 0 ? 'limit' : 'market', dEntry: o.entry > 0 ? (o.entry / lv.price - 1) * 100 : 0 };
  }
  // Ближайший структурный уровень (порт pf3SignalInfo): ≤2% — «у уровня».
  function nearLevel(lv) {
    let best = null; lv.all.filter(struct).forEach(x => { const dist = (lv.price - x.v) / x.v * 100; if (!best || Math.abs(dist) < Math.abs(best.dist)) best = { ...x, dist }; });
    return best && Math.abs(best.dist) <= CFG.nearPct ? best : null;
  }
  // Ретро-маркеры сигналов по истории (слой «маркеры» на графике и бэктест правил).
  function markers(bars, ind) {
    const M = []; let pos = 0, lastIdx = -99;
    for (let i = 201; i < bars.length; i++) {
      const b = bars[i], pb = bars[i - 1], s50 = ind.s50[i], ps50 = ind.s50[i - 1], s200 = ind.s200[i], rsi = ind.rsi[i];
      if (!(s50 > 0) || !(ps50 > 0) || !(s200 > 0)) continue;
      const lo60 = Math.min(...bars.slice(i - 59, i + 1).map(x => x.l)), hi60 = Math.max(...bars.slice(i - 59, i + 1).map(x => x.h));
      const upCross = pb.c <= ps50 && b.c > s50, dnCross = pb.c >= ps50 && b.c < s50, trendUp = s50 > s200;
      const bounce = b.l <= lo60 * 1.02 && b.c > b.o && rsi != null && rsi < 40;
      if (pos <= 0 && (upCross && trendUp || bounce) && i - lastIdx > 5) { M.push({ i, d: b.d, kind: pos < 0 ? 'cover' : 'buy', price: b.c, why: bounce ? 'отскок от S60, RSI<40' : 'пересёк SMA50 ↑ в аптренде' }); pos = 1; lastIdx = i; continue; }
      if (pos > 0 && (dnCross || (rsi > CFG.rsiHot && b.c >= hi60 * 0.98)) && i - lastIdx > 5) { M.push({ i, d: b.d, kind: 'sell', price: b.c, why: dnCross ? 'пересёк SMA50 ↓' : 'RSI>70 у R60' }); pos = 0; lastIdx = i; continue; }
      if (pos === 0 && dnCross && !trendUp && i - lastIdx > 5) { M.push({ i, d: b.d, kind: 'short', price: b.c, why: 'пересёк SMA50 ↓ в даунтренде' }); pos = -1; lastIdx = i; continue; }
      if (pos < 0 && upCross && i - lastIdx > 5) { M.push({ i, d: b.d, kind: 'cover', price: b.c, why: 'пересёк SMA50 ↑' }); pos = 0; lastIdx = i; }
    }
    return M;
  }
  // Симуляция плана на каждом ретро-входе: выход по касанию стопа/цели по High/Low, time-stop 15 баров.
  function backtestPlans(bars, ind, riskKr, fx) {
    const T = []; const M = markers(bars, ind);
    M.filter(m => m.kind === 'buy' || m.kind === 'short').forEach(m => {
      const side = m.kind === 'buy' ? 'long' : 'short', lv = levelsAt(bars, m.i, ind), atr = ind.atr[m.i]; if (!(atr > 0)) return;
      const p = tradePlan(side, lv, atr, { riskKr, fx }); const sgn = side === 'long' ? 1 : -1;
      let exit = null, exitWhy = '', j = m.i + 1;
      for (; j < Math.min(bars.length, m.i + 16); j++) {
        const b = bars[j];
        if (sgn > 0 ? b.l <= p.stop : b.h >= p.stop) { exit = p.stop; exitWhy = 'стоп'; break; }
        if (sgn > 0 ? b.h >= p.target : b.l <= p.target) { exit = p.target; exitWhy = 'цель'; break; }
      }
      if (exit == null) { j = Math.min(bars.length - 1, m.i + 15); exit = bars[j].c; exitWhy = j >= bars.length - 1 ? 'открыта' : 'time-stop 15 баров'; }
      const R = p.risk > 0 ? sgn * (exit - p.entry) / p.risk : 0;
      T.push({ i: m.i, d: m.d, out: bars[j].d, side, entry: p.entry, stop: p.stop, target: p.target, exit, exitWhy, R, ret: sgn * (exit / p.entry - 1) * 100, days: j - m.i, why: m.why, rr: p.rr });
    });
    return T;
  }
  // Снимок «сейчас» для одной бумаги. opts: riskKr, fx, upTg (апсайд к свежему таргету, %), staleTarget (bool).
  function snapshot(bars, opts) {
    const o = Object.assign({ riskKr: 5000, fx: 1, upTg: null, staleTarget: false }, opts || {});
    const ind = indicators(bars), i = bars.length - 1, b = bars[i], pb = bars[i - 1];
    const lv = levelsAt(bars, i, ind), atr = ind.atr[i], day = (b.c / pb.c - 1) * 100;
    const s60 = lv.sup.find(x => x.src.split('+').includes('S60'));
    const ph = phase(b.c, day, ind.s50[i], ind.s100[i], ind.s200[i], s60 ? s60.v : 0, o.upTg);
    const near = nearLevel(lv), nearSup = !!(near && near.v <= lv.price), nearRes = !!(near && near.v > lv.price);
    const trendUp = ind.s50[i] > ind.s200[i], rsiNow = ind.rsi[i], vol = b.v, avgVol = bars.slice(-20).reduce((s, x) => s + x.v, 0) / 20, volX = avgVol ? vol / avgVol : null;
    const rr = x => x != null ? x.toFixed(1) : '—', fst = arr => arr.filter(struct)[0];
    // План на сторону: по рынку у уровня, лимит-цена под R/R 1.5, иначе условный лимит у ближайшего уровня.
    function planFor(sideX, half) {
      const base = { riskKr: o.riskKr, fx: o.fx, half };
      const mkt = tradePlan(sideX, lv, atr, base), atLevel = sideX === 'long' ? nearSup : nearRes;
      if (atLevel) {
        if (mkt.rr != null && mkt.rr >= CFG.rrMin) return mkt;
        if (mkt.rr != null && mkt.rr >= CFG.rrWeak) {
          // Лимит-цена под R/R = rrGood на СТОПЕ и ЦЕЛИ рыночного плана (R/R гарантирован по построению).
          const e = limitForRR(mkt.target, mkt.stop, CFG.rrGood), sgn = sideX === 'long' ? 1 : -1, ok = sideX === 'long' ? (e < lv.price && e > mkt.stop) : (e > lv.price && e < mkt.stop);
          if (ok) {
            const risk = sgn * (e - mkt.stop), reward = sgn * (mkt.target - e), per = risk * base.fx; let qty = per > 0 ? Math.floor(base.riskKr / per) : 0; if (half) qty = Math.floor(qty / 2);
            return { ...mkt, entry: e, mode: 'limit', dEntry: (e / lv.price - 1) * 100, risk, reward, rr: reward / risk, riskPct: risk / e * 100, rewardPct: reward / e * 100, qty, notionalKr: qty * e * base.fx, riskKr: qty * risk * base.fx, levelSrc: 'лимит под R/R ' + CFG.rrGood, flags: mkt.flags.slice() };
          }
        }
        return mkt;
      }
      const L = fst(sideX === 'long' ? lv.sup : lv.res); if (!L) return mkt;
      const e = L.v + (sideX === 'long' ? 1 : -1) * CFG.limitOffAtr * atr;
      const p = tradePlan(sideX, lv, atr, { ...base, entry: e }); p.levelSrc = L.src; return p;
    }
    let side = 'long', verdict = 'wait', why = [], flags = [], setup = null;
    if (ph.key === 'knife') { verdict = 'wait'; why.push('падающий нож — ждать стабилизации у поддержки'); flags.push('knife'); }
    else if (ph.key === 'down' && !trendUp) {
      side = 'short';
      if (nearRes) { setup = 'отбой от сопротивления'; why.push(`даунтренд, цена под сопротивлением ${near.src} (${near.dist.toFixed(1)}%)`); }
      else if (nearSup) { why.push(`даунтренд, но цена у поддержки ${near.src} — шорт только после пробоя`); }
      else { why.push('даунтренд: SMA50 < SMA200 — шорт на подходе к сопротивлению'); }
    }
    else if (ph.key === 'heat') { verdict = 'trim'; why.push(`перегрев: +${((lv.price / ind.s200[i] - 1) * 100).toFixed(0)}% над SMA200 — фиксировать часть, новых покупок нет`); }
    else if ((ph.key === 'up' || ph.key === 'rev' || ph.key === 'corr' || ph.key === 'undr') && nearSup) { setup = 'откат к поддержке'; why.push(`откат к поддержке ${near.src} (${near.dist.toFixed(1)}%)`); }
    else if ((ph.key === 'up' || ph.key === 'imp') && nearRes) { verdict = 'hold'; why.push(`${ph.label.toLowerCase()}, цена под сопротивлением ${near.src} — не догонять`); }
    else if (ph.key === 'up' || ph.key === 'imp') { verdict = 'hold'; why.push(`${ph.label.toLowerCase()} без сетапа — лимит на откат`); }
    else if (ph.key === 'corr' || ph.key === 'rev') { verdict = 'wait'; why.push(`${ph.label.toLowerCase()} — ждать касания поддержки`); }
    else if (ph.key === 'down' && trendUp) { verdict = 'wait'; why.push(`цена ниже всех SMA при SMA50 > SMA200 — глубокий откат, ждать возврата над SMA200 (${((ind.s200[i] / lv.price - 1) * 100).toFixed(1)}%)`); }
    else { verdict = 'wait'; why.push(`${ph.label.toLowerCase()} — нет сетапа`); }
    const half = side === 'long' && setup && !trendUp;
    const plans = { long: planFor('long', half), short: planFor('short', false) };
    const plan = plans[side];
    if (setup) {
      if (plan.mode === 'market' && plan.rr >= CFG.rrMin) { verdict = side === 'short' ? 'short' : 'buy'; why[why.length - 1] += ` · R/R ${rr(plan.rr)}`; }
      else if (plan.mode === 'limit') { verdict = 'wait'; why[why.length - 1] += ` · по рынку R/R ${rr(tradePlan(side, lv, atr, { riskKr: o.riskKr, fx: o.fx }).rr)} — лимит ${plan.entry.toFixed(plan.entry >= 500 ? 0 : 2)} даёт ${rr(plan.rr)}`; }
      else { verdict = 'wait'; why[why.length - 1] += ` · R/R ${rr(plan.rr)} < ${CFG.rrWeak} — цель слишком близко`; }
      if (half) { why.push('тренд не подтверждён (SMA50 < SMA200) — ранний вход, ½ риска'); }
    } else if (plan.mode === 'limit' && (verdict === 'hold' || verdict === 'wait') && ph.key !== 'knife') {
      why.push(`условный план: лимит у ${plan.levelSrc} (${plan.dEntry.toFixed(1)}%) · R/R ${rr(plan.rr)}`);
    }
    if (side === 'short' && (day >= CFG.squeezeDay || (volX != null && volX >= CFG.squeezeVol && b.c > b.o))) { flags.push('squeeze'); why.push('риск сквиза: резкий рост/объём — шорт не открывать сегодня'); if (verdict === 'short') verdict = 'wait'; }
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
    return { price: b.c, day, atr, atrPct: atr / b.c * 100, rsi: rsiNow, s50: ind.s50[i], s100: ind.s100[i], s200: ind.s200[i], trendUp, levels: lv, near, phase: ph, setup, plans, plan, long: plans.long, short: plans.short, side, verdict, why, flags, score, vol, avgVol, volX, ind, markers: markers(bars, ind) };
  }
  const API = { CFG, sma, atrWilder, rsiWilder, collapse, levelsAt, indicators, phase, limitForRR, tradePlan, nearLevel, markers, backtestPlans, snapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.SIG = API;
})(typeof window !== 'undefined' ? window : globalThis);

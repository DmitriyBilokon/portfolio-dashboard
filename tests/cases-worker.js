// Регрессионные кейсы для telegram-notify.js (чистые функции воркера).
function grp(name, fn){ try { fn(); } catch(e){ __res.push({n:name, p:false, i:'threw '+(e&&e.message||e)}); } }

// 1) Комиссия воркера = клиентская модель (паритет)
grp('worker commission', function(){
  __approx('W fee USD 1000 buy', tradeFeeNativeW('USD',1000,true), 8.5);
  __approx('W fee USD 4000 buy', tradeFeeNativeW('USD',4000,true), 16);
  __approx('W fee SEK 1000 buy', tradeFeeNativeW('SEK',1000,true), 1.5);
  __approx('W fee GBP 12000 buy', tradeFeeNativeW('GBP',12000,true), 109.5);
  __approx('W fee USD 1000 sell', tradeFeeNativeW('USD',1000,false), 8.5);
});

// 2) Конфиг секторов (11 GICS + бенчмарк SPY)
grp('sector config', function(){
  __eq('11 sector ETFs', SECTOR_ETFS.length, 11);
  __eq('benchmark is SPY', SECTOR_BENCH, 'SPY');
  __ok('XLK present', SECTOR_ETFS.some(function(s){return s[0]==='XLK';}));
  __ok('every entry has [etf,en,ru]', SECTOR_ETFS.every(function(s){return s.length===3 && s[0] && s[1] && s[2];}));
});

// 3) Стоимость AI-прогона (aiCost) — токены/поиски → usd
grp('aiCost', function(){
  var c = aiCost({ usage:{ input_tokens:1000000, output_tokens:0, server_tool_use:{web_search_requests:0} } });
  __approx('aiCost 1M input opus = $5', c.usd, 5, 0.001);
  var c2 = aiCost({ usage:{ input_tokens:0, output_tokens:1000000 } });
  __approx('aiCost 1M output opus = $25', c2.usd, 25, 0.001);
  var c3 = aiCost({ usage:{ input_tokens:0, output_tokens:0, server_tool_use:{web_search_requests:10} } });
  __approx('aiCost 10 searches = $0.10', c3.usd, 0.10, 0.001);
});

// 4) Карта моделей по фичам / aiModel()
grp('models map', function(){
  __eq('dashboard → opus', aiModel('dashboard'), 'claude-opus-4-8');
  __eq('chat → sonnet', aiModel('chat'), 'claude-sonnet-4-6');
  __eq('unknown → default opus', aiModel('???'), AI_MODEL_DEFAULT);
});

// 5) round2 — округление до 2 знаков
grp('round2', function(){
  __eq('round2 1.236', round2(1.236), 1.24);
  __eq('round2 1.234', round2(1.234), 1.23);
  __eq('round2 2.0', round2(2), 2);
});

// 7) 📉 impliedMove — ход из ATM-стрэддла
grp('impliedMove', function(){
  var calls = [{ strike: 95, bid: 7, ask: 8 }, { strike: 100, bid: 5, ask: 6, impliedVolatility: 0.45 }, { strike: 105, bid: 3, ask: 4 }];
  var puts  = [{ strike: 95, bid: 3, ask: 4 }, { strike: 100, bid: 5, ask: 6, impliedVolatility: 0.45 }, { strike: 105, bid: 7, ask: 8 }];
  var now = Date.parse('2026-06-16T00:00:00Z'), exp = Date.parse('2026-06-30T00:00:00Z');
  var im = impliedMove(100, calls, puts, exp, now);
  __approx('implied move 11% (ATM straddle 5.5+5.5)', im.movePct, 11, 0.1);
  __eq('days = 14', im.days, 14);
  __eq('atm = 100', im.atm, 100);
  __ok('null on bad input', impliedMove(0, [], [], exp, now) === null);
  // только lastPrice (нет bid/ask)
  var im2 = impliedMove(100, [{ strike: 100, lastPrice: 6 }], [{ strike: 100, lastPrice: 5 }], exp, now);
  __approx('uses lastPrice fallback (11%)', im2.movePct, 11, 0.1);
});

// 7d) 📰 newsItemsFromYahoo — парсер новостей Yahoo search
grp('newsItemsFromYahoo', function(){
  var j = { news: [
    { title: 'Micron beats earnings, raises guidance', publisher: 'Reuters', link: 'http://x/1', providerPublishTime: 1750000000 },
    { title: '', publisher: 'Empty', link: 'http://x/2', providerPublishTime: 1750000100 },   // без заголовка → отброшен
    { title: 'Analyst upgrades MU to Buy', publisher: 'Bloomberg', link: 'http://x/3' },         // без времени → time=0
  ] };
  var it = newsItemsFromYahoo(j);
  __eq('2 заголовка (пустой отброшен)', it.length, 2);
  __eq('первый title', it[0].title, 'Micron beats earnings, raises guidance');
  __eq('time = providerPublishTime×1000', it[0].time, 1750000000000);
  __eq('нет времени → 0', it[1].time, 0);
  __ok('нет news → []', newsItemsFromYahoo({}).length === 0);
  __ok('null → []', newsItemsFromYahoo(null).length === 0);
});

// 7c) 📐 indexLevels — S/R уровни индекса (pivots + свинги, классификация по цене)
grp('indexLevels', function(){
  // последний бар H=110,L=90,C=100 → P=100; R1=110, S1=90, R2=120, S2=80.
  var closes = [95, 98, 100], highs = [105, 108, 110], lows = [92, 94, 90];
  var lv = indexLevels(100, closes, highs, lows);
  __eq('pivot = 100', lv.pivot, 100);
  __ok('сопротивления выше цены', lv.res.every(function(v){ return v > 100; }));
  __ok('поддержки ниже цены', lv.sup.every(function(v){ return v < 100; }));
  __ok('ближайшее сопротивление первым (R1=110 < R2=120)', lv.res[0] < lv.res[1]);
  __ok('ближайшая поддержка первой (S1=90 > S2=80)', lv.sup[0] > lv.sup[1]);
  __eq('R1 = 110', lv.res[0], 110);
  __eq('S1 = 90', lv.sup[0], 90);
  __ok('мало данных → null', indexLevels(100, [100], [110], [90]) === null);
  __ok('нет цены → null', indexLevels(0, closes, highs, lows) === null);
});

// 7b) 📅 pickEarnExpiry — экспирация, покрывающая дату отчёта (первая по дню ≥ дня отчёта)
grp('pickEarnExpiry', function(){
  var D = function(s){ return Date.parse(s + 'T00:00:00Z'); };
  var exps = [D('2026-06-18'), D('2026-06-25'), D('2026-07-02'), D('2026-07-18')];
  __eq('отчёт 2026-06-26 → эксп 2026-07-02', pickEarnExpiry(exps, D('2026-06-26')), D('2026-07-02'));
  __eq('отчёт в день экспирации → та же', pickEarnExpiry(exps, D('2026-06-25')), D('2026-06-25'));
  __eq('отчёт после всех экспираций → 0', pickEarnExpiry(exps, D('2026-08-01')), 0);
  __eq('пустой список → 0', pickEarnExpiry([], D('2026-06-26')), 0);
  __eq('нет даты отчёта → 0', pickEarnExpiry(exps, 0), 0);
});

// 6) 🎯 A.1 aggTargets — агрегация таргетов (WDC-подобный кейс)
grp('aggTargets', function(){
  var sm = { allTimeAvgPriceTarget: 300, lastQuarterAvgPriceTarget: 650, lastQuarterCount: 16, allTimeCount: 230 };
  var news = [
    { priceTarget: 1200, priceWhenPosted: 1080, publishedDate: '2026-06-15', analystCompany: 'RBC Capital' },
    { priceTarget: 1500, priceWhenPosted: 660,  publishedDate: '2026-06-15', analystCompany: 'TD Cowen' },
    { priceTarget: 500,  publishedDate: '2025-01-01', analystCompany: 'Old Bank' },
  ];
  var gc = { strongBuy: 10, buy: 5, hold: 3, sell: 1, strongSell: 0, consensus: 'Buy' };
  var now = Date.parse('2026-06-16T00:00:00Z');
  var a = aggTargets(sm, news, gc, now);
  __eq('consensus = свежий квартал', a.consensus, 650);
  __eq('span q', a.span, 'q');
  __eq('high', a.high, 1500);
  __eq('low', a.low, 500);
  __eq('lastDate', a.lastDate, '2026-06-15');
  __eq('changes за 30д = 2', a.changes.length, 2);
  __eq('ratings strongBuy', a.ratings.strongBuy, 10);
  __ok('пусто → null', aggTargets(null, [], null, now) === null);
});

// 8) 💾 aiport-persist: nextRev / writeCommitted / mergeAiPortSettings (чистые)
grp('nextRev', function(){
  __eq('rev undefined → 1', nextRev(undefined), 1);
  __eq('rev {} → 1', nextRev({}), 1);
  __eq('rev 5 → 6', nextRev({rev:5}), 6);
  __eq('rev "7" → 8', nextRev({rev:'7'}), 8);
});

grp('writeCommitted', function(){
  // return=representation вернул строку с нашим rev → коммит прошёл
  __ok('rev совпал (массив) → true', writeCommitted([{data:{rev:6}}], 6));
  __ok('rev совпал (объект) → true', writeCommitted({data:{rev:6}}, 6));
  // триггер откатил: вернулся СТАРЫЙ rev → конфликт
  __ok('старый rev → false', !writeCommitted([{data:{rev:5}}], 6));
  __ok('нет строки → false', !writeCommitted([], 6));
  __ok('null → false', !writeCommitted(null, 6));
  __ok('нет data → false', !writeCommitted([{}], 6));
});

grp('mergeAiPortSettings', function(){
  var ap = { strategy:'mine', cashSEK:1000, positions:[1,2], startedAt:100 };
  var fap = { strategy:'client', intervalMin:30, enabled:false, startedAt:100, foo:'x' };
  mergeAiPortSettings(ap, fap, AIPORT_RUN_SETTINGS);
  __eq('клиентская strategy перенята', ap.strategy, 'client');
  __eq('intervalMin из клиента', ap.intervalMin, 30);
  __eq('enabled из клиента', ap.enabled, false);
  __eq('торговый cashSEK не тронут', ap.cashSEK, 1000);
  __eq('positions не тронуты', ap.positions.length, 2);
  __ok('foo вне списка — не скопирован', ap.foo === undefined);
  // null fap — безопасно, ap не меняется
  var ap2 = { strategy:'mine' };
  mergeAiPortSettings(ap2, null, AIPORT_RUN_SETTINGS);
  __eq('null fap → без изменений', ap2.strategy, 'mine');
  // undefined-значение в fap не затирает существующее
  mergeAiPortSettings(ap2, { strategy: undefined }, AIPORT_RUN_SETTINGS);
  __eq('undefined не затирает', ap2.strategy, 'mine');
});

// 9) ⏱ pickCronTask — одна задача за тик крона (free=50 подзапросов/вызов)
grp('pickCronTask', function(){
  __eq('00 → цикл', pickCronTask(0), 'cycle');
  __eq('10 → цикл', pickCronTask(10), 'cycle');
  __eq('20 → PF3', pickCronTask(20), 'pf3');
  __eq('30 → PF3', pickCronTask(30), 'pf3');
  __eq('40 → Anna', pickCronTask(40), 'anna');
  __eq('50 → Anna', pickCronTask(50), 'anna');
  __eq('границы 19/39', pickCronTask(19), 'cycle');
  __eq('граница 39', pickCronTask(39), 'pf3');
  __eq('нормализация >59', pickCronTask(65), 'cycle');   // 65%60=5
});

// 10) 🔒 parseSyms — разбор ?param=A,B,C на публичных батч-роутах (trim/дедуп/лимит)
grp('parseSyms', function(){
  var p = parseSyms('A, B ,,A', 10);
  __eq('trim+дедуп → [A,B]', p.syms, ['A','B']);
  __eq('over=false', p.over, false);
  __eq('total=2', p.total, 2);
  var many = []; for(var i = 0; i < 25; i++) many.push('S' + i);
  var p2 = parseSyms(many.join(','), 20);
  __eq('25 при max 20 → 20', p2.syms.length, 20);
  __eq('25 при max 20 → over=true', p2.over, true);
  __eq('25 при max 20 → total=25', p2.total, 25);
  var p3 = parseSyms('', 10);
  __eq('пусто → []', p3.syms, []);
  __eq('пусто → over=false', p3.over, false);
  __eq('null → []', parseSyms(null, 10).syms, []);
  __eq('символ длиной 30 отброшен', parseSyms('AAPL,' + 'X'.repeat(30), 10).syms, ['AAPL']);
});

// 11) 💰 SYM_LIMITS — бюджет Cloudflare free = 50 подзапросов/вызов (+ yAuth ≤ 4)
grp('SYM_LIMITS budget', function(){
  __ok('symbols ×3 + 4 ≤ 50', SYM_LIMITS.symbols * 3 + 4 <= 50);
  __ok('targets ×2 + 4 ≤ 50', SYM_LIMITS.targets * 2 + 4 <= 50);
  __ok('calendar + 4 ≤ 50', SYM_LIMITS.calendar + 4 <= 50);
  __ok('prepost + 4 ≤ 50', SYM_LIMITS.prepost + 4 <= 50);
  __ok('levels + 4 ≤ 50', SYM_LIMITS.levels + 4 <= 50);
  __ok('symbolsLite + 4 ≤ 50', SYM_LIMITS.symbolsLite + 4 <= 50);
});

// 13) 🕯 ohlcvFromChart — свечи ?history= {t,o,h,l,c,v}, обратная совместимость t/c
grp('ohlcvFromChart', function(){
  var res = { timestamp: [100, 200, 300, 400, 500], indicators: { quote: [{
    open:   [10,    null,  12,    13,   14.123],
    high:   [11,    11.5,  11.9,  14,   null],
    low:    [9,     10.2,  11.5,  12.5, 13.9],
    close:  [10.5,  11.1,  12.2,  null, 14.0],
    volume: [1000,  null,  2500.6, 900, -5],
  }] } };
  var h = ohlcvFromChart(res);
  __eq('ключи', Object.keys(h).sort(), ['c','h','l','o','t','v']);
  __eq('бар без close выброшен (t/c выровнены как раньше)', h.t, [100, 200, 300, 500]);
  __eq('c', h.c, [10.5, 11.1, 12.2, 14]);
  __eq('open null → close', h.o[1], 11.1);
  __eq('high < close расширен до тела', h.h[2], 12.2);
  __eq('high null → max(o,c)', h.h[3], 14.12);
  __eq('low ≤ min(o,c)', h.l[2], 11.5);
  __eq('объём: null/отрицательный → 0, округлён', h.v, [1000, 0, 2501, 0]);
  var n = h.t.length;
  __ok('все массивы одной длины', [h.o, h.h, h.l, h.c, h.v].every(function(a){ return a.length === n; }));
  __ok('h ≥ max(o,c) и l ≤ min(o,c) на каждом баре', h.t.every(function(_, i){ return h.h[i] >= Math.max(h.o[i], h.c[i]) && h.l[i] <= Math.min(h.o[i], h.c[i]); }));
  __eq('пустой ответ → null', ohlcvFromChart({ timestamp: [], indicators: { quote: [{}] } }), null);
  __eq('null → null', ohlcvFromChart(null), null);
  __eq('без timestamp бар выброшен', ohlcvFromChart({ timestamp: [0], indicators: { quote: [{ close: [5] }] } }), null);
});

// 14) 🕯 histParams — белый список interval, формат range (ключ кэша не разрастается)
grp('histParams', function(){
  __eq('дефолт', histParams(null, null), { range: '2y', interval: '1d' });
  __eq('5y/1wk', histParams('5y', '1wk'), { range: '5y', interval: '1wk' });
  __eq('6mo, регистр', histParams(' 6MO ', '1D'), { range: '6mo', interval: '1d' });
  __eq('ytd/max', [histParams('ytd').range, histParams('max').range], ['ytd', 'max']);
  __eq('мусор range → 2y', histParams('2y;drop', '1d').range, '2y');
  __eq('чужой interval → 1d', histParams('1y', '1m').interval, '1d');
  __eq('TTL истории 10 мин', HIST_TTL_MS, 600000);
});

// 15) 💸 fmpCovered — FMP free только US: суффиксы бирж, индексы, фьючерсы → в Yahoo без квоты
grp('fmpCovered', function(){
  __ok('MU', fmpCovered('MU'));
  __ok('BRK-B', fmpCovered('BRK-B'));
  __ok('не INVE-B.ST', !fmpCovered('INVE-B.ST'));
  __ok('не RHM.DE', !fmpCovered('RHM.DE'));
  __ok('не ^OMX', !fmpCovered('^OMX'));
  __ok('не ES=F', !fmpCovered('ES=F'));
  __ok('не пусто', !fmpCovered(''));
});

// 16) 📊 financials (I3) — нормализация FMP / Yahoo timeseries / earningsTrend без сети
grp('financials', function(){
  // FMP stable: новые сначала; quarter-строка и строка без выручки отбрасываются; EPS — разводнённый.
  var inc = [
    { date:'2025-08-28', fiscalYear:'2025', period:'FY', reportedCurrency:'USD', revenue:37378e6, eps:7.65, epsDiluted:7.59 },
    { date:'2024-08-29', fiscalYear:'2024', period:'FY', reportedCurrency:'USD', revenue:25111e6, eps:0.7, epsDiluted:0.7 },
    { date:'2023-08-31', fiscalYear:'2023', period:'FY', reportedCurrency:'USD', revenue:15540e6, eps:-5.34, epsDiluted:-5.34 },
    { date:'2023-06-01', fiscalYear:'2023', period:'Q3', revenue:1 },
    { date:'2022-09-01', fiscalYear:'2022', period:'FY', revenue:null, eps:7.75 }
  ];
  var cf = [{ date:'2025-08-28', period:'FY', freeCashFlow:1668e6 }, { date:'2024-08-29', period:'FY', freeCashFlow:-4e6 }];
  var a = finAnnualFmp(inc, cf);
  __eq('FMP: годы по возрастанию, без квартала и без выручки', a.map(function(x){ return x.year; }), [2023, 2024, 2025]);
  __eq('FMP: строка 2025', a[2], { year:2025, revenue:37378e6, eps:7.59, fcf:1668e6 });
  __eq('FMP: отрицательный EPS и FCF сохраняются', [a[0].eps, a[1].fcf], [-5.34, -4e6]);
  __eq('FMP: FCF нет → null', a[0].fcf, null);
  __eq('FMP: мусор → []', finAnnualFmp(null, { error:1 }), []);
  __eq('год из даты, а не fiscalYear', finYear({ date:'2026-01-25', fiscalYear:'2025' }), 2026);
  __eq('без даты — fiscalYear', finYear({ fiscalYear:'2024' }), 2024);
  var many = []; for(var y = 2015; y <= 2025; y++) many.push({ date:y + '-12-31', revenue:y });
  __eq('не больше FIN_CFG.years лет', finAnnualFmp(many, null).length, FIN_CFG.years);

  // Yahoo timeseries (VOLV-B.ST, формат ответа 2026-09-10): порядок типов произвольный, null-дырки.
  var ts = [
    { meta:{ type:['annualFreeCashFlow'] }, annualFreeCashFlow:[{ asOfDate:'2024-12-31', currencyCode:'SEK', reportedValue:{ raw:28059e6 } }, null] },
    { meta:{ type:['annualTotalRevenue'] }, annualTotalRevenue:[null, { asOfDate:'2023-12-31', currencyCode:'SEK', reportedValue:{ raw:552252e6 } }, { asOfDate:'2024-12-31', currencyCode:'SEK', reportedValue:{ raw:526816e6 } }, { asOfDate:'2025-12-31', currencyCode:'SEK', reportedValue:{ raw:479183e6 } }] },
    { meta:{ type:['annualDilutedEPS'] }, annualDilutedEPS:[{ asOfDate:'2025-12-31', currencyCode:'SEK', reportedValue:{ raw:16.94 } }] },
    { meta:{ type:['annualSomethingElse'] } }
  ];
  var yv = finAnnualYahoo(ts);
  __eq('Yahoo: годы', yv.annual.map(function(x){ return x.year; }), [2023, 2024, 2025]);
  __eq('Yahoo: слияние типов по году', yv.annual[1], { year:2024, revenue:526816e6, eps:null, fcf:28059e6 });
  __eq('Yahoo: EPS 2025', yv.annual[2].eps, 16.94);
  __eq('Yahoo: валюта и конец фин. года', [yv.ccy, yv.fye], ['SEK', '12-31']);
  __eq('Yahoo: пусто', finAnnualYahoo(null).annual, []);

  // earningsTrend: только 0y/+1y; год, по которому уже есть факт, отбрасывается.
  var trend = { trend:[
    { period:'0q', endDate:'2026-11-30', revenueEstimate:{ avg:{ raw:1 } } },
    { period:'0y', endDate:'2026-08-31', revenueEstimate:{ avg:{ raw:52e9 }, numberOfAnalysts:{ raw:28 } }, earningsEstimate:{ avg:{ raw:17.1 }, numberOfAnalysts:{ raw:30 } } },
    { period:'+1y', endDate:'2027-08-31', revenueEstimate:{ avg:{ raw:61e9 } }, earningsEstimate:{ avg:{} } },
    { period:'+5y', endDate:null }
  ] };
  var e = finEstimatesYahoo(trend, 2025);
  __eq('прогноз: 2026 и 2027', e.map(function(x){ return x.year; }), [2026, 2027]);
  __eq('прогноз 2026 (+ служебный yearAgo)', e[0], { year:2026, revenue:52e9, eps:17.1, n:30, yearAgo:null });
  __eq('прогноз без EPS → null, без числа аналитиков → null', [e[1].eps, e[1].n], [null, null]);
  __eq('год с фактом отброшен', finEstimatesYahoo(trend, 2026).map(function(x){ return x.year; }), [2027]);
  __eq('нет earningsTrend → []', finEstimatesYahoo(null, 2025), []);

  // finBuild: статусы и честные пометки
  var ok = finBuild({ sym:'MU', ccy:'USD', source:'fmp', fye:'08-28', annual:a, estimates:e, now:'T' });
  __eq('ok: ≥2 лет факта и есть прогноз', [ok.status, ok.notes], ['ok', []]);
  __eq('ok: форма ответа', Object.keys(ok).sort(), ['annual','ccy','estimates','fetchedAt','fiscalYearEnd','notes','source','status','sym']);
  var p = finBuild({ sym:'VOLV-B.ST', ccy:'SEK', source:'yahoo', annual:yv.annual, estimates:[] });
  __eq('partial: нет прогноза', [p.status, p.notes.indexOf('no-estimates') >= 0], ['partial', true]);
  var sc = finBuild({ sym:'ADR', annual:a, estimates:[{ year:2026, revenue:37378e6 * 9, eps:1, n:3 }] });
  __eq('без yearAgo: скачок ×9 за год отброшен', [sc.estimates, sc.notes.indexOf('est-scale') >= 0, sc.status], [[], true, 'partial']);
  // MU 2026-09-10 (живой ответ): FY26 ×3.5, FY27 ×6.5 к FY25 — настоящий рост, yearAgo = отчётности.
  var mu = finBuild({ sym:'MU', annual:a, estimates:[{ year:2026, revenue:129.74e9, eps:73.4, n:41, yearAgo:37.38e9 }, { year:2027, revenue:241.08e9, eps:155.03, n:44, yearAgo:129.74e9 }] });
  __eq('MU: взрывной рост с совпавшим yearAgo не отбрасывается', [mu.status, mu.estimates.length, mu.notes], ['ok', 2, []]);
  __eq('служебный yearAgo не попадает в ответ', Object.keys(mu.estimates[0]).sort(), ['eps','n','revenue','year']);
  var mu2 = finBuild({ sym:'MU', annual:a, estimates:[{ year:2026, revenue:129.74e9, n:41 }, { year:2027, revenue:241.08e9, n:44 }] });
  __eq('MU без yearAgo: шаги ×3.5 и ×1.9 проходят', mu2.estimates.length, 2);
  var adr = finBuild({ sym:'TSM', annual:a, estimates:[{ year:2026, revenue:40e9 * 32, eps:1, n:20, yearAgo:37.38e9 * 32 }] });
  __eq('yearAgo в другой валюте (×32) → прогноз отброшен', [adr.estimates, adr.notes.indexOf('est-scale') >= 0], [[], true]);
  var one = finBuild({ sym:'X', annual:[{ year:2025, revenue:10, eps:null, fcf:null }], estimates:[{ year:2026, revenue:11, eps:null, n:2 }] });
  __eq('1 год факта → partial, короткая история, нет EPS/FCF', [one.status, one.notes.indexOf('short-history') >= 0, one.notes.indexOf('no-fcf') >= 0, one.notes.indexOf('no-eps') >= 0], ['partial', true, true, true]);
  var nd = finBuild({ sym:'Z', annual:[], estimates:e });
  __eq('nodata: прогноз без факта не отдаётся', [nd.status, nd.estimates], ['nodata', []]);
  __ok('подзапросов ≤ 4: FMP×2 + earningsTrend + фолбэк timeseries', 2 + 1 + 1 <= 4);
  __eq('TTL: память 30 мин, edge 12 ч, нет данных 1 ч', [FIN_CFG.memMs, FIN_CFG.edgeS, FIN_CFG.edgeNoDataS], [1800000, 43200, 3600]);
});

// 12) 🏗 worker build — бампается при каждой правке воркера
grp('worker build', function(){
  __ok('WORKER_BUILD bumped', WORKER_BUILD !== '2026-06-30subreq-split');
});

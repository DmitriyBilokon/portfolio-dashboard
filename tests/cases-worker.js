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

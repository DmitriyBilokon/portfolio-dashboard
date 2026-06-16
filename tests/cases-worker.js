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

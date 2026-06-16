// Регрессионные кейсы для app.js. Выполняются в ОДНОМ eval вместе с исходником,
// поэтому видят реальные функции/глобалы. Каждая группа изолирована в grp().
function grp(name, fn){ try { fn(); } catch(e){ __res.push({n:name, p:false, i:'threw '+(e&&e.message||e)}); } }

// 1) Комиссия (Avanza «Small») — клиентская модель
grp('commission', function(){
  __approx('fee USD 1000 buy total', tradeFeeNative('USD',1000,true).total, 8.5);
  __approx('fee USD 4000 buy total', tradeFeeNative('USD',4000,true).total, 16);
  __approx('fee USD 10000 buy total', tradeFeeNative('USD',10000,true).total, 40);
  __approx('fee SEK 1000 buy (no fx)', tradeFeeNative('SEK',1000,true).total, 1.5);
  __approx('fee GBP 12000 buy (stamp)', tradeFeeNative('GBP',12000,true).total, 109.5);
  __approx('fee USD 1000 sell (no tax)', tradeFeeNative('USD',1000,false).total, 8.5);
  __ok('fee min bites small trade', tradeFeeNative('USD',100,true).courtage === 6);
});

// 2) Раскладка-конструктор: eapply сохраняет порядок, добавляет новые в конец
grp('eapply layout', function(){
  LAYOUT = {sub:{},cards:[],home:[],dash:[]};
  var items=[{id:'a'},{id:'b'},{id:'c'},{id:'d'}];
  __eq('eapply natural', eapply('cards',items).map(function(x){return x.id;}).join(''), 'abcd');
  LAYOUT.cards=['c','a'];
  __eq('eapply partial saved', eapply('cards',items).map(function(x){return x.id;}).join(''), 'cabd');
  LAYOUT.cards=['z','d','b'];   // z stale (ignored), a/c new → в конец
  __eq('eapply stale+new', eapply('cards',items).map(function(x){return x.id;}).join(''), 'dbac');
});

// 3) Валюта: pf3BaseFx / pf3Cv / pf3Money
grp('currency helpers', function(){
  FX.USD=10; FX.EUR=11; FX.GBP=13; FX.CAD=7.5; FX.CHF=12;
  var dSek={baseCcy:'SEK'}, dUsd={baseCcy:'USD'};
  __eq('pf3BaseFx SEK', pf3BaseFx(dSek), 1);
  __eq('pf3BaseFx USD', pf3BaseFx(dUsd), 10);
  __eq('pf3Cv SEK identity', pf3Cv(dSek,1000), 1000);
  __approx('pf3Cv USD 1000sek->100usd', pf3Cv(dUsd,1000), 100);
  __ok('pf3Money SEK unit', /kr$/.test(pf3Money(dSek,1000)));
  __ok('pf3Money USD unit', /USD$/.test(pf3Money(dUsd,1000)));
});

// 4) Таргет/апсайд/прогноз 12м (по таргету)
grp('forecast 12m (target)', function(){
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%','Прибыль','Приб%','СтоимостьSEK','Аналит. таргет'];
  var r=[1,'Acme','ACME','🇺🇸','Tech','Рост',10,100,'USD',90,0,0,0,0, 120];
  var d={headers:h, rows:[r], baseCcy:'USD'};
  __eq('pf3EffTarget', pf3EffTarget(d,r).target, 120);
  __approx('pf3EffUpside +20%', pf3EffUpside(d,r), 20);
  var f=pf3Fcast12(d,r);
  __eq('pf3Fcast12 src=tgt', f.src, 'tgt');
  __approx('pf3Fcast12 e=20', f.e, 20);
});

// 5) Прогноз 12м без таргета — fund/flat, число e
grp('forecast 12m (fund)', function(){
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%','Прибыль','Приб%','СтоимостьSEK'];
  var r=[1,'NoTgt','NT','🇺🇸','Tech','Рост',5,50,'USD',50,0,0,0,0];
  var d={headers:h, rows:[r], baseCcy:'USD'};
  var f=pf3Fcast12(d,r);
  __ok('pf3Fcast12 returns number', typeof f.e==='number');
  __ok('pf3Fcast12 src is fund/flat', f.src==='fund'||f.src==='flat');
});

// 6) Сектора → подсветка портфеля (sectPortfolioSet)
grp('sectPortfolioSet', function(){
  DATA = { 'Portfolio (Anna)': { port:'1', v3:'1', headers:[], rows:[
    [1,'Nvidia','NVDA','🇺🇸','Технологии','Рост',10,170,'USD',150,0,0,0,17850],
    [2,'Exxon','XOM','🇺🇸','Энергетика','Дивидендная',5,110,'USD',100,0,0,0,5500]
  ] } };
  var set = sectPortfolioSet();
  __ok('XLK from Технологии', set.has('XLK'));
  __ok('XLE from Энергетика', set.has('XLE'));
  __ok('XLV not present', !set.has('XLV'));
});

// 7) Трек-рекорд разборов (направление цены)
grp('aiTrackRecord', function(){
  DATA = { 'Idx': { v3:'1', headers:[], rows:[
    [1,'Nvidia','NVDA','','','',0,170,'USD'],
    [1,'Micron','MU','','','',0,100,'USD']
  ] } };
  IDX_HIST = {};   // без истории индекса → alpha null
  STOCK_AI_LOG = [
    {ticker:'NVDA',ts:'2026-05-01',price:150,ccy:'USD',verdict:'buy'},  // +13.3% → hit
    {ticker:'MU',  ts:'2026-05-10',price:120,ccy:'USD',verdict:'buy'},  // -16.7% → miss
    {ticker:'MU',  ts:'2026-04-01',price:130,ccy:'USD',verdict:'sell'}  // -23% → sell hit
  ];
  var tr = aiTrackRecord();
  __eq('track samples', tr.samples, 3);
  __eq('track overall hit %', tr.overallHitRate, 67);
  __eq('track buy n', tr.byVerdict.buy.n, 2);
  __eq('track buy hit', tr.byVerdict.buy.hitRate, 50);
  __eq('track sell hit', tr.byVerdict.sell.hitRate, 100);
});

// 8) Журнал сделок: pfRecentTrades (фильтр по вкладке + plSEK)
grp('pfRecentTrades', function(){
  FX.USD=10.5;
  PF_TRADES = [
    {tab:'P3', tk:'nvda', ccy:'USD', act:'buy',  qty:5, price:100, plNative:null, date:'2026-06-01'},
    {tab:'P3', tk:'nvda', ccy:'USD', act:'sell', qty:5, price:120, plNative:100,  date:'2026-06-10'},
    {tab:'Anna', tk:'msft', ccy:'USD', act:'buy', qty:2, price:300, plNative:null, date:'2026-06-09'}
  ];
  var t = pfRecentTrades('P3');
  __eq('recentTrades count (P3 only)', t.length, 2);
  __eq('recentTrades newest first', t[0].act, 'sell');
  __eq('recentTrades plSEK (100usd*10.5)', t[0].plSEK, 1050);
  __eq('recentTrades buy plSEK null', t[1].plSEK, null);
});

// 9) Покрытие ключей синка: snapshotState ⊇ критичные пользовательские данные
grp('snapshotState keys', function(){
  var s = snapshotState();
  ['data','pfTrades','aiPort','aiPlaybook','aiPlaybookSeedV','layout','aiPrefs','sim','tabOrder','val','aiDash','aiReco','smaTf','hiddenCols','colOrders']
    .forEach(function(k){ __ok('snapshot has '+k, Object.prototype.hasOwnProperty.call(s,k)); });
});

// 10) Рекомендация «сейчас»: вердикт — валидная строка, не падает
grp('pf3RecoHorizons.now', function(){
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%','Прибыль','Приб%','СтоимостьSEK','Аналит. таргет','Поддержка','Сопротивление'];
  var r=[1,'Acme','ACME','🇺🇸','Tech','Рост',10,100,'USD',90,0.5,0,0,0,120,95,130];
  var d={headers:h, rows:[r], baseCcy:'USD'};
  var hz = pf3RecoHorizons(d,r);
  __ok('now verdict valid', ['buy','wait','sell','avoid'].indexOf(hz.now.v) >= 0);
  __ok('has mid & long', hz.mid && hz.long && true);
});

// 11) Общая таблица прогноза рендерится (smoke) и считает итоги
grp('pf3FcTable smoke', function(){
  var d={baseCcy:'SEK', cashFree:1000};
  var rows=[{name:'A',tk:'A',valSEK:1000,cells:[{v:1100,pct:10,has:true},{v:1200,pct:20,has:true}]}];
  var html = pf3FcTable(d, rows, ['3м','6м']);
  __ok('fcTable has rows', html.indexOf('fc-row')>=0);
  __ok('fcTable has net worth', html.indexOf('fc-net')>=0);
});

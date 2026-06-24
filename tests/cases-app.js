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
  ['data','pfTrades','planRules','aiPort','aiPlaybook','aiPlaybookSeedV','layout','aiPrefs','sim','tabOrder','val','aiDash','aiReco','smaTf','hiddenCols','colOrders']
    .forEach(function(k){ __ok('snapshot has '+k, Object.prototype.hasOwnProperty.call(s,k)); });
});

// 9b) 🎯 План действий: planStatus — направление триггера (buy ≤ / sell ≥) и дедлайн
// 9d) 📐 Valuation: EPS-тренд (fwd vs ttm) и позиция на шкале
grp('valuation eps & scale', function(){
  // MU-кейс: trailing 46, forward ~10 → forward сильно дешевле → EPS растёт
  __eq('fwd<<ttm → EPS up', valEpsTrend(46, 10), 'up');
  // forward дороже trailing → EPS падает (риск value-trap)
  __eq('fwd>>ttm → EPS down', valEpsTrend(10, 46), 'down');
  __eq('fwd≈ttm → flat', valEpsTrend(20, 21), 'flat');
  __ok('no data → null', valEpsTrend(0, 10) === null);
  // шкала: значение = медиане → центр 50%; дешевле → левее; дороже → правее (клампы)
  __eq('at median → 50%', valScalePos(20, 20), 50);
  __eq('10% cheap → 40%', valScalePos(18, 20), 40);
  __eq('2x rich → 100% (clamp)', valScalePos(40, 20), 100);
  __eq('0.1x → 0% (clamp)', valScalePos(2, 20), 0);
  __ok('no ref → null', valScalePos(20, 0) === null);
});

// 9e) 📐 Valuation: профильная группа пиров (индустрия → сектор)
grp('valuation peers', function(){
  var _VAL = VAL;
  VAL = {
    AAA: { pe: 10, ps: 2, evEbitda: 8, sector: 'Tech', industry: 'Semis' },
    BBB: { pe: 20, ps: 4, evEbitda: 12, sector: 'Tech', industry: 'Semis' },
    CCC: { pe: 15, ps: 3, evEbitda: 9, sector: 'Tech', industry: 'Software' },
    DDD: { pe: 0, ps: 0, sector: 'Tech', industry: 'Semis' }, // нет данных → исключается
  };
  __eq('peers by industry (Semis) = 2', valPeerGroup('AAA').length, 2);
  VAL.EEE = { pe: 11, ps: 2, sector: 'Health' };
  VAL.FFF = { pe: 13, ps: 2, sector: 'Health' };
  __eq('no industry → group by sector = 2', valPeerGroup('EEE').length, 2);
  VAL = _VAL;
});

// 9f) 🕵 Insider: классификация типов сделок (значимое vs шум)
grp('insider tx kind', function(){
  __ok('P = meaningful', insiderTxKind('P').routine === false && insiderTxKind('P').cls === 'p');
  __ok('S = meaningful', insiderTxKind('S').routine === false);
  __ok('M (option) = routine', insiderTxKind('M').routine === true);
  __ok('A (grant) = routine', insiderTxKind('A').routine === true);
  __ok('unknown = routine', insiderTxKind('Z').routine === true);
});

// 9g) 🧭 Составной сигнальный балл (инсайдеры × оценка)
grp('signal score', function(){
  var sec = { pe: 30, ps: 5, evEbitda: 15 };
  // кластер инсайдеров + недооценка по сектору и истории → высокий балл
  var s = signalScore(
    { cluster: { uniqueBuyers: 3 }, netUSD: 1e6 },
    { pe: 10, fwdPe: 8, ps: 2, evEbitda: 7, sector: 'X', hist: { pe5: 20, ps5: 4, ev5: 12 } },
    sec,
  );
  __ok('cluster + undervalued → n>=4', s.n >= 4);
  // нетто-продажа + дорого → отрицательный
  var s2 = signalScore({ netUSD: -5e5 }, { pe: 60, fwdPe: 70, ps: 30, sector: 'X' }, { pe: 30, ps: 10 });
  __ok('selling + rich → n<0', s2.n < 0);
  // value-trap: дёшево, но EPS падает → не плюсуем
  var s3 = signalScore(
    null,
    { pe: 10, fwdPe: 20, ps: 2, sector: 'X', hist: { pe5: 30, ps5: 5 } },
    { pe: 30, ps: 6 },
  );
  __ok('value trap not rewarded', s3.n <= 0);
});

// 9h) 💵 Cash-drag модель
grp('cash drag', function(){
  // кэш 50% капитала, бенчмарк +10%, цель 20%
  var m = cashDragModel(100, 200, 10, 20);
  __approx('cashPct 50', m.cashPct, 50);
  __approx('excessKr 60', m.excessKr, 60);        // (50-20)% × 200
  __approx('dragPct -5', m.dragPct, -5);           // -(0.5 × 10)
  __approx('counterKr 6', m.counterKr, 6);         // 60 × 10%
  __eq('status high', m.status, 'high');
  // в пределах цели → ok, без избытка
  var m2 = cashDragModel(20, 100, 10, 20);
  __eq('status ok', m2.status, 'ok');
  __approx('no excess', m2.excessKr, 0);
  // падающий рынок → кэш защищает (drag положительный)
  var m3 = cashDragModel(50, 100, -8, 20);
  __ok('falling market → drag positive', m3.dragPct > 0);
});

// 9i) 💱 Валютный сценарий: укрепление SEK
grp('fx scenario', function(){
  var rows = [{ ccy: 'USD', val: 80 }, { ccy: 'SEK', val: 20 }];
  var m = fxScenarioModel(rows, 100, 10);   // equity 100, SEK +10%
  __approx('foreign 80', m.foreign, 80);
  __approx('foreign % of stocks 80', m.foreignPctOfStocks, 80);
  __approx('impact -8', m.impact, -8);        // -80 × 10%
  __approx('newNet 92', m.newNet, 92);
  __eq('1 foreign ccy', m.ccyList.length, 1);
  // только SEK → нет валютного риска
  var m2 = fxScenarioModel([{ ccy: 'SEK', val: 50 }], 50, 10);
  __approx('no foreign', m2.foreign, 0);
  __approx('no impact', m2.impact, 0);
});

// 9j) 🔐 RBAC: резолвер прав (deny-by-default, приоритет override → роль)
grp('rbac resolve', function(){
  // роль editor: видит health, НЕ видит ai_proto (по пресету)
  __ok('editor sees health', rbacResolve('editor', {}, 'view.health') === true);
  __ok('editor no ai_proto', rbacResolve('editor', {}, 'view.ai_proto') === false);
  // override allow побеждает роль
  __ok('override allow wins', rbacResolve('editor', { 'view.ai_proto': 'allow' }, 'view.ai_proto') === true);
  // override deny побеждает роль
  __ok('override deny wins', rbacResolve('owner', { 'view.health': 'deny' }, 'view.health') === false);
  // viewer — узкий набор
  __ok('viewer no trades', rbacResolve('viewer', {}, 'view.trades') === false);
  __ok('viewer sees portfolio', rbacResolve('viewer', {}, 'view.portfolio') === true);
  // custom без overrides = всё закрыто (deny-by-default)
  __ok('custom denies by default', rbacResolve('custom', {}, 'view.portfolio') === false);
  __ok('custom allows via override', rbacResolve('custom', { 'view.portfolio': 'allow' }, 'view.portfolio') === true);
  // неизвестный перм у owner → закрыто
  __ok('unknown perm denied', rbacResolve('owner', {}, 'view.nope') === false);
  // AI-Portfolio (просмотр): analyst видит, editor — нет, грант через override
  __ok('analyst sees AI-Portfolio', rbacResolve('analyst', {}, 'view.ai_portfolio') === true);
  __ok('editor no AI-Portfolio by default', rbacResolve('editor', {}, 'view.ai_portfolio') === false);
  __ok('grant AI-Portfolio via override', rbacResolve('viewer', { 'view.ai_portfolio': 'allow' }, 'view.ai_portfolio') === true);
  // legacy (null/'default') = текущее поведение: торгует/правит план, без add-тикера/AI
  __ok('legacy (null) edits trades', rbacResolve(null, {}, 'action.edit_trades') === true);
  __ok("legacy ('default') edits plan", rbacResolve('default', {}, 'action.edit_plan') === true);
  __ok('legacy no add_position', rbacResolve(null, {}, 'action.add_position') === false);
  __ok('legacy no run_ai', rbacResolve(null, {}, 'action.run_ai') === false);
  __ok('legacy shows amounts', rbacResolve(null, {}, 'data.show_amounts') === true);
  __ok('viewer hides amounts', rbacResolve('viewer', {}, 'data.show_amounts') === false);
  // карточка: пользователи видят оценку/инсайдеров/AI-реко (результат), без запуска AI
  __ok('legacy sees valuation', rbacResolve(null, {}, 'view.valuation') === true);
  __ok('legacy sees insider', rbacResolve(null, {}, 'view.insider') === true);
  __ok('legacy sees ai_reco', rbacResolve(null, {}, 'view.ai_reco') === true);
  __ok('legacy cannot run AI', rbacResolve(null, {}, 'action.run_ai') === false);
  __ok('analyst sees valuation', rbacResolve('analyst', {}, 'view.valuation') === true);
});

// 9k) 📊 Сценарный движок (Bull/Base/Bear) + RR + симметрия
grp('scenario v1.4', function(){
  // B.3 краткосрок: цель = ближайший S/R в коридоре ±2.5·ATR (WDC)
  var sh = scenarioShort({ price: 700.81, atr: 29.44, resistance: 729.92, support: 667.53, sma50: 600, rsi: 71 });
  __approx('short bull = resistance level 729.92', sh.bull, 729.92, 0.01);
  __approx('short bear = support level 667.53', sh.bear, 667.53, 0.01);
  __ok('short overbought → bear high', sh.bearConf === 'high');
  // далёкий уровень вне коридора → fallback ±1.5·ATR (не 249)
  var sh2 = scenarioShort({ price: 700, atr: 30, resistance: 0, support: 249, sma50: 0, rsi: 50 });
  __approx('short bear fallback −1.5·ATR (655), не 249', sh2.bear, 655, 1);
  // B.3.1 проекция ±ATR×√10
  var pr = scenarioProjection(700.81, 29.44, 10);
  __approx('proj high ≈ 793.9', pr.high, 793.9, 0.5);
  __approx('proj low ≈ 607.7', pr.low, 607.7, 0.5);
  // A.1: нет свежих таргетов → lowdata, БЕЗ R/R (запрет тихого фоллбэка)
  var mdNo = scenarioMid({ price: 673, target: 0, fresh: false });
  __eq('mid lowdata when not fresh', mdNo.note, 'lowdata');
  __ok('mid no RR when lowdata', mdNo.valid === false && mdNo.rr === null);
  // B.8 sanity: цена выше верхнего таргета → noupside, R/R скрыт (а не −1.38)
  var mdNu = scenarioMid({ price: 700, target: 650, targetHigh: 650, fresh: true });
  __eq('mid noupside when price>highest target', mdNu.note, 'noupside');
  __ok('mid noupside hides RR', mdNu.rr === null);
  // WDC-кейс: консенсус 508, верх. таргет 685, цена 698 → noupside; Bear СОБЫТИЙНЫЙ (−20%), не консенсус
  var mdW = scenarioMid({ price: 698, target: 508, targetHigh: 685, fresh: true });
  __eq('WDC: noupside (не broken)', mdW.note, 'noupside');
  __ok('WDC: bull 685 > base 508', mdW.bull === 685 && mdW.base === 508);
  __approx('WDC: bear = событийный −20% (558.4), не консенсус', mdW.bear, 558.4, 0.5);
  // B.8: bull<base → broken
  var mdBr = scenarioMid({ price: 600, target: 650, targetHigh: 600, fresh: true });
  __eq('mid broken when bull<base', mdBr.note, 'broken');
  // валидный среднесрок: свежие таргеты выше цены → R/R>0
  var mdOk = scenarioMid({ price: 600, target: 650, targetHigh: 730, fresh: true });
  __ok('mid valid: bull 730 / base 650 / RR>0', mdOk.valid && mdOk.bull === 730 && mdOk.base === 650 && mdOk.rr > 0);
  // баг-кейс: свежий квартальный консенсус БЕЗ явного диапазона → Bull = consensus×1.1 (>Base), валидно
  var mdBand = scenarioMid({ price: 1041, target: 1182, fresh: true });
  __approx('mid bull from band ≈ 1300', mdBand.bull, 1300.2, 0.5);
  __approx('mid base = consensus 1182', mdBand.base, 1182);
  __ok('mid band valid & RR>0', mdBand.valid === true && mdBand.rr > 0);
  // 📉 implied move как событийный R: eventR=0.10 → Bear = price×0.9, R вернулся в объекте
  var mdImp = scenarioMid({ price: 600, target: 650, targetHigh: 730, fresh: true, eventR: 0.10 });
  __approx('mid Bear по implied move (−10%) = 540', mdImp.bear, 540);
  __approx('mid R = implied 0.10', mdImp.R, 0.10);
  // дефолт без eventR → событийный 20%
  __approx('mid Bear default −20% = 480', mdOk.bear, 480);
  // ATR/RSI helpers
  var up = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
  __approx('ATR of +1/day series = 1', atrFromCloses(up), 1);
  __eq('RSI of all-up series = 100', rsiFromCloses(up), 100);
});

// 9q) 🏆 homeCompositeScore — единый балл из всех сигналов (чистая функция)
grp('homeCompositeScore', function(){
  // сильный кандидат: апсайд 30, аптренд, ROE 20, рост 18, P/E 15, у входа, buy, недооценка
  var strong = homeCompositeScore({up:30,roe:20,revg:18,pe:15,entry:2,upTrend:true,phase:'undr',reco:'buy',sigN:3,insBuy:true,aiV:'buy',undervalued:true});
  // слабый: падающий нож, апсайд −20, ROE −5, avoid
  var weak = homeCompositeScore({up:-20,roe:-5,revg:-3,pe:60,entry:null,upTrend:false,phase:'knife',reco:'avoid',sigN:-2,insBuy:false,aiV:'avoid',undervalued:false});
  __ok('сильный балл > слабого', strong.score > weak.score);
  __ok('сильный близок к 100', strong.score >= 90);
  __ok('слабый близок к 0', weak.score <= 15);
  __ok('балл в [0..100]', strong.score <= 100 && weak.score >= 0);
  __ok('почему-чипы у сильного', strong.why.length > 0 && strong.why.length <= 3);
  // нейтрал/нет данных → ~50, без штрафов
  var empty = homeCompositeScore({up:null,roe:null,revg:null,pe:null,entry:null,upTrend:false,phase:'flat',reco:null,sigN:0,insBuy:false,aiV:null,undervalued:false});
  __eq('пустой вход → нейтральные 50', empty.score, 50);
  // отсутствие данных не штрафует сильнее, чем плохие данные
  __ok('пустой ≥ слабого', empty.score >= weak.score);
  // 📰 новостной фон двигает балл в нужную сторону
  var nPos = homeCompositeScore({up:null,roe:null,revg:null,pe:null,entry:null,upTrend:false,phase:'flat',reco:null,sigN:0,insBuy:false,aiV:null,undervalued:false,newsSent:3});
  var nNeg = homeCompositeScore({up:null,roe:null,revg:null,pe:null,entry:null,upTrend:false,phase:'flat',reco:null,sigN:0,insBuy:false,aiV:null,undervalued:false,newsSent:-3});
  __ok('позитивные новости > нейтрал', nPos.score > empty.score);
  __ok('негативные новости < нейтрал', nNeg.score < empty.score);
  // ⚠ ловушка устаревшего таргета: большой апсайд при даунтренде НЕ должен задирать балл как при аптренде
  var upTrendBig = homeCompositeScore({up:30,roe:null,revg:null,pe:null,entry:null,upTrend:true,phase:'up',reco:null,sigN:0,insBuy:false,aiV:null,undervalued:false});
  var downTrendBig = homeCompositeScore({up:30,roe:null,revg:null,pe:null,entry:null,upTrend:false,phase:'down',reco:null,sigN:0,insBuy:false,aiV:null,undervalued:false});
  var knifeBig = homeCompositeScore({up:30,roe:null,revg:null,pe:null,entry:null,upTrend:false,phase:'knife',reco:null,sigN:0,insBuy:false,aiV:null,undervalued:false});
  __ok('апсайд при даунтренде НЕ награждается как при аптренде', downTrendBig.score < upTrendBig.score);
  __ok('падающий нож с «апсайдом» — низкий балл', knifeBig.score < empty.score);
  __ok('даунтренд+апсайд помечается флагом устаревшего таргета', downTrendBig.why.some(function(w){return /устар|stale/i.test(w);}));
});

// 9s) 📚 aiPlaybookEnsure — миграция плейбука на v3 (автономия + новые практики)
grp('playbook v3 migration', function(){
  var savedRemote = (typeof applyingRemote!=='undefined')?applyingRemote:false;
  applyingRemote = true;   // не дёргать scheduleSave в тесте
  // существующий плейбук со старой целью и seedv=2 → цель заменяется, дописываются v3
  AI_PLAYBOOK = [PLAYBOOK_GOAL_OLD, 'Произвольный старый принцип']; AI_PLAYBOOK_SEEDV = 2;
  aiPlaybookEnsure();
  __ok('старая цель заменена на новую', AI_PLAYBOOK.indexOf(PLAYBOOK_GOAL_OLD) < 0 && AI_PLAYBOOK.includes(PLAYBOOK_GOAL));
  __ok('v3-принципы дописаны', PLAYBOOK_V3_ADD.every(function(p){ return AI_PLAYBOOK.includes(p); }));
  __eq('seedv = 3', AI_PLAYBOOK_SEEDV, 3);
  // пустой плейбук → дефолт уже с новой целью
  AI_PLAYBOOK = []; AI_PLAYBOOK_SEEDV = 0; aiPlaybookEnsure();
  __ok('дефолт содержит новую цель (максимизация)', AI_PLAYBOOK.includes(PLAYBOOK_GOAL));
  __ok('цель — про максимизацию', /максимизир/i.test(PLAYBOOK_GOAL));
  applyingRemote = savedRemote;
});

// 9r) 📰 newsSentiment / newsRecencyWeight — новостной фон с весом по свежести
grp('newsSentiment', function(){
  var now = 1750000000000;
  var day = 864e5;
  // свежий позитив весомее старого негатива
  var items = [
    { title: 'Company beats earnings and raises guidance', time: now - day },        // pol +? свежий
    { title: 'Stock plunge on lawsuit and probe', time: now - 15*day },               // pol − старый
  ];
  var s = newsSentiment(items, now);
  __ok('есть тональность', typeof s.sent === 'number');
  __ok('pos посчитан', s.pos >= 1);
  __ok('neg посчитан', s.neg >= 1);
  __eq('n = число заголовков', s.n, 2);
  // вес: свежее весомее
  __ok('свежее (0–2 дн) вес 1', newsRecencyWeight(1) === 1);
  __ok('старое (>21 дн) вес 0', newsRecencyWeight(30) === 0);
  __ok('вес убывает со временем', newsRecencyWeight(2) > newsRecencyWeight(10));
  // пусто → 0
  __eq('пусто → sent 0', newsSentiment([], now).sent, 0);
});

// 9l) 📊 Блок D — детектор сценарных алертов
grp('scenario alerts', function(){
  // первое наблюдение (нет prev) → без событий
  __eq('no prev → no events', scnAlertEvents(null, { rrShort: 1.3, rsi: 75, stretch: true, priceAboveBull: true, priceBelowBear: false }).length, 0);
  // касание bull-триггера
  var a = scnAlertEvents({ priceAboveBull: false, rrShort: 1.3, rsi: 60, stretch: false }, { priceAboveBull: true, priceBelowBear: false, rrShort: 1.3, rsi: 60, stretch: false });
  __ok('bull trigger touch', a.some(function(e){ return e.kind === 'bull'; }));
  // смена знака R/R через 1.0
  var b = scnAlertEvents({ rrShort: 1.3, rsi: 60, stretch: false, priceAboveBull: false, priceBelowBear: false }, { rrShort: 0.7, rsi: 60, stretch: false, priceAboveBull: false, priceBelowBear: false });
  __ok('R/R crossed 1.0', b.some(function(e){ return e.kind === 'rr'; }));
  // выход RSI из >70 на «растяжении»
  var c = scnAlertEvents({ rsi: 75, stretch: true, rrShort: 1.0, priceAboveBull: false, priceBelowBear: false }, { rsi: 68, stretch: true, rrShort: 1.0, priceAboveBull: false, priceBelowBear: false });
  __ok('RSI exits 70 on stretch', c.some(function(e){ return e.kind === 'rsi'; }));
  // без изменений → без событий
  var same = { rrShort: 1.2, rsi: 55, stretch: false, priceAboveBull: false, priceBelowBear: false };
  __eq('no change → no events', scnAlertEvents(same, same).length, 0);
  // RSI-выход без «растяжения» не алертит
  __eq('RSI exit without stretch ignored', scnAlertEvents({ rsi: 75, stretch: false, rrShort: 1, priceAboveBull: false, priceBelowBear: false }, { rsi: 68, stretch: false, rrShort: 1, priceAboveBull: false, priceBelowBear: false }).length, 0);
});

// 9m) 📰 Бесплатный новостной разбор (детерминированный)
grp('news analyze', function(){
  var stocks = [
    { tk: 'MU', name: 'Micron Technology', sector: 'Tech' },
    { tk: 'AVGO', name: 'Broadcom', sector: 'Tech' },
    { tk: 'RHM', name: 'Rheinmetall', sector: 'Industrials' },
  ];
  var text = 'Micron upgraded by analysts, strong demand and record profit. Rheinmetall faces a probe and lawsuit, shares drop. Weather is fine today.';
  var res = analyzeNews(text, stocks);
  __eq('MU bullish', res.byTicker.MU.impact, 'bull');
  __ok('MU score > 0', res.byTicker.MU.score > 0);
  __eq('RHM bearish', res.byTicker.RHM.impact, 'bear');
  __ok('RHM score < 0', res.byTicker.RHM.score < 0);
  __ok('AVGO not mentioned → absent', res.byTicker.AVGO === undefined);
  // пустой ввод → пусто
  __eq('empty text → 0', analyzeNews('', stocks).n, 0);
  // матч по тикеру с границей слова (не часть другого слова)
  var r2 = analyzeNews('AVGO contract win, revenue beat', stocks);
  __eq('AVGO bullish by ticker', r2.byTicker.AVGO.impact, 'bull');
});

grp('plan triggers', function(){
  // подсунуть цену через DATA, чтобы planCurPrice её нашёл
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%'];
  DATA.__PLANTEST__={v3:'1', headers:h, rows:[[1,'Acme','ACME','🇺🇸','Tech','Рост',10,100,'USD',90,0]]};
  __ok('buy ready when price<=level', planStatus({tk:'ACME',act:'buy',level:105}).ready === true);
  __ok('buy NOT ready when price>level', planStatus({tk:'ACME',act:'buy',level:95}).ready === false);
  __ok('sell ready when price>=level', planStatus({tk:'ACME',act:'sell',level:95}).ready === true);
  __ok('sell NOT ready when price<level', planStatus({tk:'ACME',act:'sell',level:110}).ready === false);
  // правило только с дедлайном: прошедшая дата → готово, далёкая → нет
  __ok('past deadline ready', planStatus({tk:'ACME',act:'buy',level:0,deadline:'2000-01-01'}).ready === true);
  __ok('far deadline not ready', planStatus({tk:'ACME',act:'buy',level:0,deadline:'2999-01-01'}).ready === false);
  delete DATA.__PLANTEST__;
});

// 9c) 🎯 Кол-во акций из суммы (поштучно) + парсинг уровня из совета AI
grp('plan shares & level parse', function(){
  var _fx=FX; FX={SEK:1,USD:8,EUR:11};   // фиксируем курсы для детерминизма
  // RHM-кейс: 8000 kr при цене 1100 EUR (=12100 kr/шт) → 0 целых акций
  __eq('8000kr @1100 EUR = 0 shares', planShares({amount:8000,ccy:'EUR'}, 1100), 0);
  // 8000 kr / 8 = 1000 USD; /50 = 20 целых акций
  __eq('8000kr @50 USD = 20 shares', planShares({amount:8000,ccy:'USD'}, 50), 20);
  __ok('no amount → null', planShares({amount:0,ccy:'USD'}, 50) === null);
  FX=_fx;
  // парсинг уровня: денежные суммы в kr отбрасываются, берётся ценовой уровень
  __eq('buy zone 358–366 → 366', planParseLevel('докупить ~10 000 kr лимитом в зоне 358–366','buy'), 366);
  __eq('support €1099 → 1099', planParseLevel('лимит ~8 000 kr у поддержки €1099','buy'), 1099);
  __eq('sell at 130 → 130', planParseLevel('сократить у сопротивления 130','sell'), 130);
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

// 11b) exSymbol: правильный Yahoo-символ по валюте (защита от «кривых цен OMXS30»)
grp('exSymbol', function(){
  __eq('SEK class-share → .ST', exSymbol('VOLV B','SEK'), 'VOLV-B.ST');
  __eq('SEK plain → .ST', exSymbol('SAND','SEK'), 'SAND.ST');
  __eq('USD → bare', exSymbol('AAPL','USD'), 'AAPL');
  __eq('NOK → .OL', exSymbol('EQNR','NOK'), 'EQNR.OL');
  __eq('dotted passthrough', exSymbol('AIR.PA','EUR'), 'AIR.PA');
});

// 12) Торговая математика pfTrade: позиция / средняя / кэш / журнал (кэш МЕНЯЕТСЯ)
grp('pfTrade math', function(){
  renderPF3 = function(){}; toast = function(){};   // изолируем побочки рендера/тостов
  var origGet = document.getElementById, inputs = {};
  document.getElementById = function(id){ return Object.prototype.hasOwnProperty.call(inputs,id) ? {value:inputs[id]} : origGet(id); };
  FX.USD = 10;
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%','Прибыль','Приб%','СтоимостьSEK'];
  var r=[1,'Acme','ACME','🇺🇸','Tech','Рост',10,100,'USD',100,0,0,0,10000];
  DATA = { 'TP': { headers:h, rows:[r], baseCcy:'SEK', cashFree:100000, v3:'1', port:'1' } };
  v3Key='TP'; pf3Sel='ACME'; PF_TRADES=[];

  // BUY 5 @ 120 → avg=(1000+600)/15=106.67, qty=15, fee USD600=7.5, cash-=(600+7.5)*10
  inputs.pfTrQty='5'; inputs.pfTrPrice='120';
  pfTrade('buy');
  __eq('buy qty 10->15', r[6], 15);
  __approx('buy avg recompute 106.67', r[9], 106.67, 0.02);
  __approx('buy cash -=(600+fee)*10', DATA.TP.cashFree, 100000-(600+7.5)*10, 0.5);
  __eq('journal 1 entry', PF_TRADES.length, 1);
  __approx('buy fee 7.5', PF_TRADES[0].feeNative, 7.5);

  // SELL 5 @ 130 → qty=10, fee USD650=7.625, P&L=(130-106.67)*5-7.625
  inputs.pfTrQty='5'; inputs.pfTrPrice='130';
  var cashBefore = DATA.TP.cashFree;
  pfTrade('sell');
  __eq('sell qty 15->10', r[6], 10);
  __approx('sell P&L net of fee', PF_TRADES[1].plNative, (130-106.67)*5-7.625, 0.15);
  __approx('sell cash +=(650-fee)*10', DATA.TP.cashFree, cashBefore+(650-7.625)*10, 0.5);
  __eq('journal 2 entries', PF_TRADES.length, 2);

  // SELL больше, чем есть → ограничивается позицией (не уходит в минус)
  inputs.pfTrQty='999'; inputs.pfTrPrice='130';
  pfTrade('sell');
  __eq('sell capped → qty 0', r[6], 0);

  document.getElementById = origGet;   // restore
});

// 13) pfTradeAddRecord (ручное восстановление): меняет позицию, НЕ трогает кэш
grp('pfTradeAddRecord no-cash', function(){
  renderPF3 = function(){}; toast = function(){};
  var origGet = document.getElementById, inputs = {};
  document.getElementById = function(id){ return Object.prototype.hasOwnProperty.call(inputs,id) ? {value:inputs[id]} : origGet(id); };
  FX.USD = 10;
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%','Прибыль','Приб%','СтоимостьSEK'];
  var r=[1,'Acme','ACME','🇺🇸','Tech','Рост',10,100,'USD',100,0,0,0,10000];
  DATA = { 'TP': { headers:h, rows:[r], baseCcy:'SEK', cashFree:50000, v3:'1', port:'1' } };
  v3Key='TP'; PF_TRADES=[];
  inputs.pfTrAct='buy'; inputs.pfTrTk='ACME'; inputs.pfTrRq='5'; inputs.pfTrRp='120'; inputs.pfTrCcy='USD'; inputs.pfTrRd='2026-06-01';
  pfTradeAddRecord();
  __eq('record updates qty 10->15', r[6], 15);
  __approx('record recompute avg', r[9], 106.67, 0.02);
  __eq('record cash UNCHANGED', DATA.TP.cashFree, 50000);
  __eq('record journal +1', PF_TRADES.length, 1);
  document.getElementById = origGet;
});

// 🧾 Налоговый движок: FIFO vs средняя цена + комиссии
grp('tax lots', function(){
  var tr=[
    {tk:'AAPL',ccy:'USD',act:'buy', qty:10,price:100,date:'2025-01-01',ord:0},
    {tk:'AAPL',ccy:'USD',act:'buy', qty:10,price:120,date:'2025-02-01',ord:1},
    {tk:'AAPL',ccy:'USD',act:'sell',qty:10,price:150,date:'2025-03-01',ord:2},
  ];
  __eq('avg gain 400',  pfTaxLots(tr,'avg')[0].gain,  400);   // cps 110 → cost 1100, proceeds 1500
  __eq('fifo gain 500', pfTaxLots(tr,'fifo')[0].gain, 500);   // первый лот @100 → cost 1000
  __eq('avg year', pfTaxLots(tr,'avg')[0].year, '2025');
  // комиссии: покупка +в себестоимость, продажа −из выручки
  var tr2=[
    {tk:'X',ccy:'USD',act:'buy', qty:10,price:100,fee:10,date:'2025-01-01',ord:0},
    {tk:'X',ccy:'USD',act:'sell',qty:10,price:120,fee:5, date:'2025-02-01',ord:1},
  ];
  __eq('avg gain with fees 185', pfTaxLots(tr2,'avg')[0].gain, 185);   // proceeds 1195, cost 1010
});

// 🏅 Фундаментальный betyg: сильная компания > слабой, 5 столпов, буква
grp('fund betyg', function(){
  if(typeof VAL==='undefined'){ globalThis.VAL={}; } else { VAL={}; }   // нет медиан → оценка по ориентиру
  var strong={revenue:1000,netIncome:250,freeCashFlow:200,operatingCashFlow:300,debtToEquity:0.2,currentRatio:3,revenueCagr:20,revenueYoY:18,fwdPe:15,ps:4,ccy:'USD',revenueYears:5};
  var weak={revenue:1000,netIncome:-50,freeCashFlow:-30,operatingCashFlow:-10,debtToEquity:2.5,currentRatio:0.7,revenueCagr:-8,revenueYoY:-15,pe:80,ps:20,ccy:'USD',revenueYears:5};
  var bs=pf3Betyg(strong,'ZZZ',''), bw=pf3Betyg(weak,'ZZZ','');
  __ok('betyg strong > weak', bs.total > bw.total);
  __ok('betyg strong high (>=7)', bs.total >= 7);
  __ok('betyg weak low (<=4)', bw.total <= 4);
  __eq('betyg 5 pillars', bs.pillars.length, 5);
  __ok('grade strong A/B', /A|B/.test(pf3Grade(bs.total).g));
  __ok('grade weak D/F', /D|F/.test(pf3Grade(bw.total).g));
});

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

// 9) Покрытие ключей синка: ПОЛНЫЙ список ключей snapshotState (tests-quality#5) —
// новый ключ обязан появиться здесь И в applyRemoteState (см. 'sync round-trip').
var SNAP_KEYS=['data','rankings','sma','fx','colOrders','theme','hiddenCols','smaTf','sim','pfTrades','aiChat','aiPrefs','tgAlerts','tabGroups','tabOrder','aiPort','aiPortBak','stockAiLog','insider','tgMeta','val','tgFull','aiReco','aiSpend','aiDash','layout','aiPlaybook','aiPlaybookSeedV','planRules','scnAlerts','news','newsImpact','aiInclChat','cycleOvr','posMeta','desk','schemaV'];
grp('snapshotState keys', function(){
  var s = snapshotState();
  __eq('snapshot keys = full list', Object.keys(s).sort(), SNAP_KEYS.slice().sort());
  __ok('snapshot has no apiKey (Finnhub removed)', !Object.prototype.hasOwnProperty.call(s,'apiKey'));
});

// 🔄 Синк: детект отклонённой триггером записи по вернувшемуся rev (data-model-sync#1)
grp('syncCommitted', function(){
  __ok('rev match → true', syncCommitted([{rev:6}],6)===true);
  __ok('string rev → true', syncCommitted([{rev:'6'}],6)===true);
  __ok('nested data.rev → true', syncCommitted([{data:{rev:6}}],6)===true);
  __ok('old rev → false (trigger returned OLD)', syncCommitted([{rev:5}],6)===false);
  __ok('empty rows → false', syncCommitted([],6)===false);
  __ok('null → false', syncCommitted(null,6)===false);
  __ok('undefined → false', syncCommitted(undefined,6)===false);
});

// 🔄 Живые котировки: чанкование под лимит подзапросов воркера (solo#1)
grp('chunkList', function(){
  __eq('7 by 3', chunkList([1,2,3,4,5,6,7],3), [[1,2,3],[4,5,6],[7]]);
  __eq('empty', chunkList([],5), []);
  __eq('smaller than n', chunkList([1,2],5), [[1,2]]);
  __ok('QUOTE_CHUNK*3+4 <= 50', QUOTE_CHUNK*3+4<=50);
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
  // Банк/финансы (Nordea-like): OCF/баланс не применимы, P/S и P/E битые →
  // НЕ выставляем ложную F, а помечаем «недостаточно данных».
  var bank={revenue:11700,operatingCashFlow:-21200,fwdPe:131.5,ps:52.8,revenueCagr:6.6,revenueYoY:-2.7,ccy:'EUR',revenueYears:3};
  var bb=pf3Betyg(bank,'NDA','Финансы и недвижимость');
  __ok('bank betyg insufficient (не F)', bb.insufficient===true && bb.score100==null);
  __ok('bank betyg fin-flag', bb.fin===true);
  __ok('bank P/S отброшен (val null)', pf3ValScore(bank,'NDA','Финансы и недвижимость',true)==null);
});

// 🛒 Покупка с карточки в портфель — чистая средняя (genomsnittsmetoden, без комиссии)
grp('pfApplyBuy', function(){
  // новая позиция с нуля: средняя = цена покупки
  var a=pfApplyBuy({qty:0,avg:0}, 10, 100);
  __eq('new pos qty', a.qty, 10);
  __eq('new pos avg', a.avg, 100);
  // докупка: средневзвешенная цена
  var b=pfApplyBuy({qty:10,avg:100}, 10, 200);
  __eq('add qty', b.qty, 20);
  __eq('add avg (150)', b.avg, 150);
  // докупка дробным: 5 @ 90 к 10 @ 120 → (1200+450)/15 = 110
  var c=pfApplyBuy({qty:10,avg:120}, 5, 90);
  __eq('add frac qty', c.qty, 15);
  __eq('add frac avg (110)', c.avg, 110);
  // строковые входы (из инпутов) не ломают
  var e=pfApplyBuy({qty:'2',avg:'50'}, 2, 150);
  __eq('string inputs avg (100)', e.avg, 100);
});


// ── S3: слой данных редизайна ────────────────────────────────────────────────
// 🔄 Round-trip синка: каждый ключ snapshotState восстанавливается applyRemoteState
// (ловит забытую ветку — тихая потеря данных на втором устройстве).
grp('sync round-trip', function(){
  var _init=init, _save=scheduleSave, saves=0;
  init=function(){}; scheduleSave=function(){ saves++; };
  var orig=snapshotState();
  var mk={};
  SNAP_KEYS.forEach(function(k){
    var v=orig[k];
    if(k==='aiPrefs') mk[k]=[];                          // по дизайну не восстанавливается (правила отменены)
    else if(k==='theme') mk[k]='dark';
    else if(k==='desk') mk[k]={riskPct:2,riskCapPct:8,shortOk:{'MU':true}};
    else if(Array.isArray(v)||k==='tabGroups') mk[k]=['__'+k];   // tabGroups по умолчанию null, но хранится массивом
    else if(typeof v==='number') mk[k]=7;
    else if(typeof v==='boolean') mk[k]=!v;
    else if(typeof v==='string') mk[k]='__'+k;
    else mk[k]={__m:k};
  });
  document.documentElement.dataset.theme='light';
  applyRemoteState(JSON.parse(JSON.stringify(mk)));
  var back=snapshotState();
  SNAP_KEYS.forEach(function(k){
    var m=mk[k], b=back[k], ok;
    if(m && typeof m==='object' && !Array.isArray(m) && m.__m) ok = b && b.__m===k;   // layout/aiSpend дополняются дефолтами
    else ok = JSON.stringify(b)===JSON.stringify(m);
    __ok('round-trip '+k, ok, 'got '+JSON.stringify(b));
  });
  // Снапшот старого клиента (до S3): нет posMeta/desk → локальные не затираются, push назад
  POS_META={'TP':{'MU':{side:'long',stop:90}}}; DESK=deskNorm({riskPct:2});
  saves=0;
  var old=JSON.parse(JSON.stringify(mk)); delete old.posMeta; delete old.desk; delete old.schemaV;
  applyRemoteState(old);
  __eq('old-client snapshot keeps local posMeta', POS_META.TP.MU.stop, 90);
  __eq('old-client snapshot keeps local desk', DESK.riskPct, 2);
  __eq('old-client snapshot → schemaV 0', STATE_V, 0);
  __ok('old-client snapshot schedules push-back', saves>0);
  applyRemoteState(orig);
  init=_init; scheduleSave=_save;
});

grp('posMeta', function(){
  var _pm=POS_META; POS_META={};
  var n=posMetaNorm({side:'x',stop:'95.5',target:0,opened:'2026-09-01T10:00'});
  __eq('norm side default long', n.side, 'long');
  __eq('norm stop0 = first stop', n.stop0, 95.5);
  __eq('norm target 0 → null', n.target, null);
  __eq('norm opened day', n.opened, '2026-09-01');
  posMetaSet('TP','mu',{side:'long',stop:90,target:130});
  __eq('set upper-case key', POS_META.TP.MU.stop, 90);
  posMetaSet('TP','MU',{stop:100});   // перенос стопа в безубыток
  __eq('stop moved', posMetaGet('TP','MU').stop, 100);
  __eq('stop0 fixed on move', posMetaGet('TP','MU').stop0, 90);
  __eq('target kept on patch', posMetaGet('TP','MU').target, 130);
  posMetaSet('TP','MU',{stop0:95});
  __eq('stop0 explicit change', posMetaGet('TP','MU').stop0, 95);
  __eq('count', posMetaCount(POS_META), 1);
  posMetaDel('TP','MU');
  __ok('del removes empty tab', !POS_META.TP);
  __eq('get missing → null', posMetaGet('TP','MU'), null);
  __ok('levels long ok', posLevelsCheck('long',100,90,130).ok);
  __eq('levels long bad stop', posLevelsCheck('long',100,110,130).errs, ['stop']);
  __ok('levels short ok', posLevelsCheck('short',100,110,80).ok);
  __eq('levels short bad both', posLevelsCheck('short',100,90,120).errs, ['stop','target']);
  POS_META=_pm;
});

grp('posCalc', function(){
  // лонг: вход 100, стоп входа 90, цель 130, цена 110, 10 шт, fx 10
  var L=posCalc({side:'long',qty:10,entry:100,stop0:90,stop:90,target:130},110,10);
  __approx('long P&L native', L.plNative, 100);
  __approx('long P&L SEK', L.plSEK, 1000);
  __approx('long plPct', L.plPct, 10);
  __approx('long rNow +1R', L.rNow, 1);
  __approx('long open risk SEK (110-90)*10*10', L.riskSEK, 2000);
  __approx('long to stop %', L.toStopPct, 18.18, 0.01);
  __approx('long progress', L.progress, 0.5);
  __ok('long no hit', !L.stopHit && !L.targetHit);
  // стоп в безубыток: R не меняется (считается от stop0)
  var BE=posCalc({side:'long',qty:10,entry:100,stop0:90,stop:100,target:130},110,10);
  __approx('BE keeps rNow 1R', BE.rNow, 1);
  __approx('BE open risk to current stop', BE.riskSEK, 1000);
  __ok('long stop hit at stop', posCalc({side:'long',qty:1,entry:100,stop:90},90,1).stopHit);
  __ok('long target hit', posCalc({side:'long',qty:1,entry:100,stop:90,target:130},131,1).targetHit);
  // шорт: вход 50, стоп 55, цель 40, цена 45 → +5·20=100, +1R
  var S=posCalc({side:'short',qty:20,entry:50,stop:55,target:40},45,8);
  __approx('short P&L native mirrored', S.plNative, 100);
  __approx('short plPct', S.plPct, 10);
  __approx('short rNow', S.rNow, 1);
  __approx('short open risk (55-45)*20*8', S.riskSEK, 1600);
  __approx('short to target %', S.toTargetPct, 11.11, 0.01);
  __ok('short stop hit above', posCalc({side:'short',qty:1,entry:50,stop:55},56,1).stopHit);
  __ok('short target hit below', posCalc({side:'short',qty:1,entry:50,stop:55,target:40},39,1).targetHit);
  __approx('short loss', posCalc({side:'short',qty:10,entry:50},60,1).plNative, -100);
  __eq('no stop → risk null', posCalc({qty:1,entry:10},11,1).riskSEK, null);
  __eq('no price → null', posCalc({qty:1,entry:10},0,1), null);
});

grp('qtyByRisk', function(){
  __eq('5000 kr, 100→90, fx 10 → 50 sh', qtyByRisk(5000,100,90,10), 50);
  __eq('short side (stop above) same distance', qtyByRisk(5000,100,110,10), 50);
  __eq('floor', qtyByRisk(1000,100,97,1), 333);
  __eq('no stop → 0', qtyByRisk(1000,100,0,1), 0);
  __eq('no risk → 0', qtyByRisk(0,100,90,1), 0);
});

grp('bookRiskState', function(){
  var _D=DATA,_pm=POS_META,_desk=DESK,_fx=FX;
  FX={SEK:1,USD:10};
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%'];
  DATA={'BK':{headers:h,v3:'1',port:'1',cashFree:50000,rows:[[1,'Acme','ACME','🇺🇸','Tech','Рост',10,110,'USD',100,0],[2,'Beta','BETA','🇺🇸','Tech','Рост',0,50,'USD',0,0]]}};
  POS_META={'BK':{'ACME':{side:'long',stop:90,target:130}}}; DESK=deskNorm({riskPct:1,riskCapPct:6});
  __approx('equity = 10*110*10 + 50000', pfEquitySEK('BK'), 61000);
  var b=bookPositions('BK');
  __eq('book: only held rows', b.length, 1);
  __eq('book entry = avg r[9]', b[0].entry, 100);
  __ok('book has meta', b[0].hasMeta && b[0].stop===90);
  var st=bookRiskState('BK');
  __eq('risk per trade 1%', st.riskKr, 610);
  __approx('open risk (110-90)*10*10', st.openRiskSEK, 2000);
  __approx('cap 6%', st.capSEK, 3660);
  __ok('under cap', !st.overCap);
  __eq('deskNorm clamps', deskNorm({riskPct:50,riskCapPct:0}).riskPct, 5);
  __eq('deskNorm default cap', deskNorm({riskCapPct:0}).riskCapPct, 6);
  DATA=_D;POS_META=_pm;DESK=_desk;FX=_fx;
});

grp('plan v2', function(){
  var _D=DATA,_pm=POS_META,_pr=PLAN_RULES;
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%'];
  DATA={'TP':{headers:h,v3:'1',port:'1',rows:[[1,'Acme','ACME','🇺🇸','Tech','Рост',10,100,'USD',90,0]]}};
  POS_META={};
  // v1-правило старого клиента → v2, поля v1 не тронуты
  var v1={id:'pl1757500000000_12',tab:'TP',tk:'ACME',act:'buy',level:95,qty:0,amount:0,deadline:'',note:'',hitAt:0,done:true};
  planRuleNorm(v1);
  __eq('norm: done → status done', v1.status, 'done');
  __eq('norm: side long', v1.side, 'long');
  __eq('norm: createdAt from id', v1.createdAt, 1757500000000);
  __eq('norm: v1 fields kept', [v1.act,v1.level,v1.done], ['buy',95,true]);
  v1.done=false; planRuleNorm(v1);
  __eq('old client reactivated → armed', v1.status, 'armed');
  // вход лонг со стопом: цена 100 ≤ уровня 105 → ready; уровень 95 не достигнут
  __ok('long entry ready', planStatus({tk:'ACME',act:'buy',level:105,stop:90,tab:'TP'}).ready);
  __eq('long entry hit=level', planStatus({tk:'ACME',act:'buy',level:105,stop:90,tab:'TP'}).hit, 'level');
  // цена уже за стопом (стоп 101 > цены 100) → сетап сломан, не «пора»
  var inv=planStatus({tk:'ACME',act:'buy',level:105,stop:101,tab:'TP'});
  __ok('entry beyond stop → invalid, not ready', inv.invalid && !inv.ready);
  // выход лонга со стопом-лоссом: продать ≥120 или при уходе под 100
  var ex=planStatus({tk:'ACME',act:'sell',level:120,stop:100,tab:'TP'});
  __ok('long exit stop-loss ready', ex.ready && ex.hit==='stop');
  // шорт: вход продажей, когда цена поднимется до 98 (сейчас 100 ≥ 98) → ready
  __ok('short entry ready ≥ level', planStatus({tk:'ACME',act:'sell',side:'short',level:98,stop:110,tab:'TP'}).ready);
  __ok('short entry NOT ready < level', !planStatus({tk:'ACME',act:'sell',side:'short',level:105,stop:110,tab:'TP'}).ready);
  __ok('short entry beyond stop → invalid', planStatus({tk:'ACME',act:'sell',side:'short',level:95,stop:99,tab:'TP'}).invalid);
  // R/R
  __approx('planRR long (130-100)/(100-90)', planRR({level:100,stop:90,target:130}), 3);
  __approx('planRR short', planRR({side:'short',level:50,stop:55,target:40}), 2);
  __eq('planRR no target', planRR({level:100,stop:90}), null);
  __eq('planRR wrong side → null', planRR({level:100,stop:110,target:130}), null);
  // исполнение: open → мета позиции, дальше стоп/цель из POS_META
  PLAN_RULES=[planRuleNorm({id:'pl1',tab:'TP',tk:'ACME',act:'buy',level:100,stop:90,target:130,done:false})];
  var m=planMarkOpen('pl1','2026-09-10');
  __eq('markOpen status', PLAN_RULES[0].status, 'open');
  __eq('markOpen meta', [m.side,m.stop0,m.stop,m.target,m.opened,m.planId], ['long',90,90,130,'2026-09-10','pl1']);
  __ok('open: not ready between stop/target', !planStatus(PLAN_RULES[0]).ready);
  posMetaSet('TP','ACME',{stop:101});   // трейлинг-стоп над ценой 100 → стоп пробит
  var so=planStatus(PLAN_RULES[0]);
  __ok('open: stop from POS_META hit', so.ready && so.hit==='stop' && so.stop===101);
  posMetaSet('TP','ACME',{stop:90,target:99});
  __eq('open: target hit', planStatus(PLAN_RULES[0]).hit, 'target');
  // ui-селект ↔ (act,side)
  __eq('ui short', planFromUiAct('short'), {act:'sell',side:'short'});
  __eq('ui cover', planFromUiAct('cover'), {act:'buy',side:'short'});
  __eq('ui roundtrip cover', planUiAct({act:'buy',side:'short'}), 'cover');
  DATA=_D;POS_META=_pm;PLAN_RULES=_pr;
});

// 🧾 Налог по шорту (blankning): результат в дату откупа, выручка — средняя по открытым шорт-продажам
grp('tax lots short pair', function(){
  var tr=[
    {tk:'NKE',ccy:'USD',act:'sell',short:true,qty:10,price:100,fee:5,date:'2025-11-01',ord:0},
    {tk:'NKE',ccy:'USD',act:'sell',short:true,qty:10,price:90, fee:5,date:'2025-11-10',ord:1},
    {tk:'NKE',ccy:'USD',act:'buy', short:true,qty:10,price:80, fee:5,date:'2026-01-15',ord:2},
    {tk:'NKE',ccy:'USD',act:'buy', short:true,qty:10,price:95, fee:5,date:'2026-02-01',ord:3},
  ];
  var r=pfTaxLots(tr,'avg');
  __eq('short: 2 records (at covers)', r.length, 2);
  // средняя выручка = (995+895)/20 = 94.5/шт → 945; себестоимость 805 → +140, год откупа
  __eq('short cover1 gain', r[0].gain, 140);
  __eq('short cover1 year = cover year', r[0].year, '2026');
  __ok('short record flagged', r[0].short===true);
  __eq('short cover2 gain (945-955)', r[1].gain, -10);
  __eq('fifo same for shorts', pfTaxLots(tr,'fifo')[0].gain, 140);
  // лонг по тому же тикеру не смешивается с шортом
  var mix=tr.concat([{tk:'NKE',ccy:'USD',act:'buy',qty:5,price:70,date:'2026-03-01',ord:4},{tk:'NKE',ccy:'USD',act:'sell',qty:5,price:75,date:'2026-03-05',ord:5}]);
  __eq('long pair after shorts', pfTaxLots(mix,'avg')[2].gain, 25);
});

grp('secFromRow & universe', function(){
  var _D=DATA,_px=PX_LIVE;
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%','SMA 50','SMA 100','SMA 200','Поддержка','Сопротивление'];
  DATA={};
  DATA[PF3_KEY]={headers:h,v3:'1',rows:[[1,'Micron','MU','🇺🇸','Semis','Рост',5,100,'USD',80,1.5,95,90,85,92,110]]};
  DATA['Nasdaq 100']={headers:h,v3:'1',rows:[[1,'Micron','mu','🇺🇸','Semis','Рост',0,99,'USD',0,1.2,'','','','',''],[2,'Volvo','VOLV-B','🇸🇪','Auto','Акция',0,250,'SEK',0,0,'','','','','']]};
  DATA['OMXS30']={headers:h,v3:'1',rows:[[1,'Volvo B','VOLV B','🇸🇪','Auto','Акция',0,251,'SEK',0,0,'','','','','']]};
  PX_LIVE={}; var _role=userRole, _allowed=allowedTabs; userRole='admin';
  var s=secFromRow(DATA[PF3_KEY],DATA[PF3_KEY].rows[0],PF3_KEY);
  __eq('sec sym/key', [s.sym,s.key], ['MU','MU|USD']);
  __eq('sec levels', [s.sma50,s.sma200,s.sup,s.res], [95,85,92,110]);
  __eq('sec held', s.held, [{tab:PF3_KEY,qty:5,avg:80}]);
  __ok('sec seed price NOT live', s.live===false && s.price===100);
  var U=deskUniverse();
  __eq('universe dedup (MU ×2, Volvo ×2 → 2)', U.list.length, 2);
  __eq('universe tabs counted', U.tabsN, 3);
  __eq('MU seen in 2 tabs', U.bySym['MU|USD'].tabs.length, 2);
  __eq('Volvo "VOLV B" = "VOLV-B" (.ST)', U.bySym['VOLV-B.ST|SEK'].tabs, ['Nasdaq 100','OMXS30']);
  __eq('index row not held', U.bySym['VOLV-B.ST|SEK'].held.length, 0);
  // гейт свежести: живая котировка этой сессии → live и её цена
  pxMarkLive('MU',104,1000);
  var sl=secFromRow(DATA[PF3_KEY],DATA[PF3_KEY].rows[0],PF3_KEY,1000+60e3);
  __ok('live after mark', sl.live && sl.price===104);
  __ok('stale after 30 min', !secFromRow(DATA[PF3_KEY],DATA[PF3_KEY].rows[0],PF3_KEY,1000+31*60e3).live);
  userRole='user'; allowedTabs=['Nasdaq 100'];
  __eq('RBAC: user sees only allowed tabs', deskUniverse().tabsN, 1);
  userRole=_role; allowedTabs=_allowed;
  DATA=_D;PX_LIVE=_px;
});

// Одноразовые сиды (schemaV): удалённые вкладки не воскресают (data-model-sync#5, stale-info#3)
grp('migrateSchema seeds', function(){
  var _D=DATA,_V=STATE_V,_save=scheduleSave; scheduleSave=function(){};
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%'];
  DATA={}; DATA[PF3_KEY]={headers:h,rows:[],v3:'1'}; DATA['OMXSPI']={headers:h,rows:[],v3:'1'};
  STATE_V=1;
  migrateFamilyPortfolios(); migrateGoldSilver(); migrateSmallCap(); migrateTabAdds(); migratePortfolio3();
  __ok('v1: Anna not recreated', !DATA['Portfolio (Anna)']);
  __ok('v1: Sergei not recreated', !DATA['Portfolio (Sergei)']);
  __ok('v1: Gold and Silver not recreated', !DATA['Gold and Silver']);
  __ok('v1: Small Cap not recreated', !DATA['Small Cap']);
  __eq('v1: HEM not re-added', DATA['OMXSPI'].rows.length, 0);
  __eq('v1: empty PF3 not seeded with MU', DATA[PF3_KEY].rows.length, 0);
  STATE_V=0;
  migrateFamilyPortfolios(); migrateTabAdds(); migratePortfolio3();
  __ok('v0: Anna seeded', !!DATA['Portfolio (Anna)']);
  __eq('v0: HEM added', DATA['OMXSPI'].rows.length, 1);
  __eq('v0: MU seed', DATA[PF3_KEY].rows.length, 1);
  PLAN_RULES=[{id:'plx',tk:'A',act:'buy',level:1,done:false}];
  migrateSchema();
  __eq('migrateSchema → SCHEMA_V', STATE_V, SCHEMA_V);
  __eq('migrateSchema normalizes plans', PLAN_RULES[0].status, 'armed');
  PLAN_RULES=[];
  DATA=_D;STATE_V=_V;scheduleSave=_save;
});

// ── 📡 S4: слой сигналов v2 (signals.js) — эталоны, паритет со старыми движками, теневой адаптер ──
grp('signals core', function(){
  __eq('sma n=2', SIG.sma([1,2,3,4],2), [null,1.5,2.5,3.5]);
  // ATR Wilder n=3: TR = 2,2,2,4,2 (последний — гэп от закрытия 14 до low 12)
  var A=SIG.atrWilder([{h:10,l:8,c:9},{h:11,l:9,c:10},{h:12,l:10,c:11},{h:15,l:11,c:14},{h:13,l:12,c:12.5}],3);
  __eq('atr warm-up nulls', [A[0],A[1]], [null,null]);
  __approx('atr seed = mean TR', A[2], 2, 1e-9);
  __approx('atr Wilder step', A[3], 8/3, 1e-9);
  __approx('atr gap uses |low − prev close|', A[4], 22/9, 1e-9);
  __eq('rsi Wilder n=2', SIG.rsiWilder([1,2,3,2,3],2), [null,null,100,50,75]);
  var C=SIG.collapse([{v:101,src:'B',kind:'sr'},{v:100.2,src:'P',kind:'pivot'},{v:100,src:'A',kind:'ma'},{v:0,src:'Z',kind:'ma'}]);
  __eq('collapse ≤0.3% merges, sorts, drops ≤0', C.map(function(x){return [x.v,x.src,x.kind,x.w];}), [[100,'A+P','ma',2],[101,'B','sr',1]]);
  __eq('collapse: pivot absorbed by structural level', SIG.collapse([{v:50,src:'P',kind:'pivot'},{v:50.1,src:'S60',kind:'sr'}])[0].kind, 'sr');
  __approx('limitForRR long (R/R = 2)', SIG.limitForRR(110,95,2), 100, 1e-9);
  __approx('limitForRR short (R/R = 2)', SIG.limitForRR(90,105,2), 100, 1e-9);
  var B=SIG.barsFromHist({t:[1757462400,1757548800,1757635200],o:[10,1,11],h:[10.5,1,11.2],l:[9.5,1,10.8],c:[10,null,11],v:[100,1,0]});
  __eq('barsFromHist skips bad close', B.length, 2);
  __eq('barsFromHist OHLCV + date', [B[0].d,B[0].o,B[0].h,B[0].l,B[0].c,B[0].v], ['2025-09-10',10,10.5,9.5,10,100]);
  var Bo=SIG.barsFromHist({t:[1,2],c:[5,6]});
  __eq('barsFromHist old {t,c}: o=h=l=c', [Bo[1].o,Bo[1].h,Bo[1].l,Bo[1].v], [6,6,6,0]);
  __eq('barsFromHist garbage → []', SIG.barsFromHist(null), []);
  __eq('snapshot < minBars → null', SIG.snapshot(sigFixBars('MU').slice(-SIG.CFG.minBars+1),{}), null);
  __eq('thresholds (plan §10#5 + калибровка §5)', [SIG.CFG.rrMin,SIG.CFG.rrWeak,SIG.CFG.rrGood,SIG.CFG.nearPct,SIG.CFG.minStopAtr,SIG.CFG.atrMult,SIG.CFG.targetAtr,SIG.CFG.wideAtr,SIG.CFG.corridorAtr,SIG.CFG.staleTgPct,'maxStopAtr' in SIG.CFG], [2,1.2,2,2,1,1.5,2,2,2.5,50,false]);
  __ok('rules version for shadow log', /^\d{4}-\d{2}-\d{2}-c\d+$/.test(SIG.VER));
  // Граница R/R: допуск 1e-9 — 2.0 − 1e-12 проходит порог, 1.99 нет.
  __eq('rrOk boundary', [SIG.rrOk(2-1e-12,2),SIG.rrOk(2,2),SIG.rrOk(2-1e-6,2),SIG.rrOk(null,2)], [true,true,false,false]);
  // Пробой ≠ откат: уровень у цены только из максимумов под ценой (минимумов над ценой) — пробой; с SMA/S* — нет.
  __eq('isBreakout', [SIG.isBreakout({v:99.9,src:'R2+R20'},100),SIG.isBreakout({v:99.9,src:'H52w+R60'},100),SIG.isBreakout({v:99.9,src:'SMA50+R20'},100),SIG.isBreakout({v:99.9,src:'S20'},100),SIG.isBreakout({v:100.1,src:'S1+S20'},100),SIG.isBreakout({v:100.1,src:'R20'},100),SIG.isBreakout({v:99.9,src:'S1'},100),SIG.isBreakout(null,100)], [true,true,false,false,true,false,false,false]);
});

// phase() — порт pf3Criterion 1:1: те же входы строки → тот же ключ и rank (20 строк по всем веткам).
grp('phase parity', function(){
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%','SMA 50','SMA 100','SMA 200','Поддержка','Сопротивление','Аналит. таргет','Таргет 3м'];
  var d={headers:h,rows:[]};
  // [цена, день %, SMA50, SMA100, SMA200, поддержка, аналит. таргет, таргет 3м]
  var C=[
    [80,-3.5,100,105,110,70,0,0],     // нож: ниже всех и день ≤ −3
    [80,-1,100,105,110,85,0,0],       // нож: пробита поддержка
    [80,-1,100,105,110,70,0,0],       // даунтренд
    [120,0.5,100,95,90,0,110,0],      // перегрев: цена выше таргета ≥5%
    [140,0.5,100,95,100,0,0,0],       // перегрев: +40% над SMA200
    [110,3,100,95,90,0,0,0],          // импульс: день ≥2.5 над SMA50
    [90,4.5,100,105,110,0,0,0],       // импульс: день ≥4 где угодно
    [110,0.5,100,95,90,0,150,0],      // недооценка: апсайд ≥25%
    [95,0.5,100,90,90,0,130,0],       // недооценка (не ниже всех)
    [80,0.5,100,105,110,0,130,0],     // ниже всех + апсайд → даунтренд (недооценка не для belowAll)
    [110,1,100,95,90,0,0,0],          // аптренд
    [95,0,100,90,90,0,0,0],           // коррекция (SMA50 > цена ≥ SMA200)
    [105,0,100,110,120,0,0,0],        // разворот
    [100,0,100,100,100,0,0,0],        // боковик (ровно на SMA)
    [0,0,100,100,100,0,0,0],          // нет цены → flat
    [100,0,0,100,100,0,0,0],          // нет SMA50 → flat
    [110,1,100,0,90,0,0,0],           // без SMA100 → аптренд
    [110,1,100,95,90,0,100,130],      // устаревший таргет → свежий «Таргет 3м» (+18%) — аптренд
    [110,1,100,95,90,0,100,150],      // свежий таргет +36% → недооценка
    [100,1,100,95,90,0,200,95]        // свежий таргет ниже цены на 5% → перегрев
  ];
  var bad=[];
  C.forEach(function(c,i){
    var r=[i+1,'X'+i,'X'+i,'','Tech','Рост',0,c[0],'USD',0,c[1],c[2],c[3],c[4],c[5],'',c[6]||'',c[7]||''];
    var o=pf3Criterion(d,r),n=sigRowPhase(d,r);
    if(o.cls!==n.key||o.rank!==n.rank)bad.push(i+': '+o.cls+'/'+o.rank+' vs '+n.key+'/'+n.rank);
  });
  __eq('pf3Criterion ≡ SIG.phase on 20 rows', bad, []);
  var keys={};C.forEach(function(c,i){keys[sigRowPhase(d,[0,'','','','','',0,c[0],'USD',0,c[1],c[2],c[3],c[4],c[5],'',c[6]||'',c[7]||'']).key]=1;});
  __eq('all 9 phases covered', Object.keys(keys).sort(), ['corr','down','flat','heat','imp','knife','rev','undr','up']);
});

grp('tradePlan', function(){
  var lv={price:100,res:[{v:101,src:'R1',kind:'pivot'},{v:103,src:'R60',kind:'sr'}],sup:[{v:99,src:'S1',kind:'pivot'},{v:98,src:'SMA50',kind:'ma'}]};
  var L=SIG.tradePlan('long',lv,2,{riskKr:3000,fx:10});
  __eq('long: target = structural res (pivot skipped)', [L.target,L.targetSrc], [103,'R60']);
  __eq('long: stop = support − 0.5·ATR', [L.stop,L.stopSrc], [97,'SMA50 − 0.5·ATR']);
  __eq('long: R/R, qty by risk kr, notional', [L.rr,L.qty,L.riskKr,L.notionalKr,L.mode], [1,100,3000,100000,'market']);
  __eq('long qty = qtyByRisk (S3)', L.qty, qtyByRisk(3000,L.entry,L.stop,10));
  var S=SIG.tradePlan('short',lv,2,{riskKr:3000,fx:10});
  __eq('short mirrored: target sup, stop res + buffer', [S.target,S.stop,S.rr,S.qty], [98,104,0.5,75]);
  var M=SIG.tradePlan('long',{price:100,res:[],sup:[{v:99.5,src:'S20',kind:'swing'}]},2,{riskKr:1000,fx:1});
  __eq('stop clamped to min 1·ATR + fallback target 2·ATR (atr-target)', [M.stop,M.target,M.rr,M.targetSrc,M.flags], [98,104,2,'+2·ATR',['atr-target']]);
  __ok('min clamp noted in stopSrc', /мин\. 1·ATR/.test(M.stopSrc));
  __eq('structural target → no atr-target', L.flags, []);
  __eq('short fallback target −2·ATR', (function(x){return [x.target,x.targetSrc,x.flags];})(SIG.tradePlan('short',{price:100,res:[{v:100.5,src:'R20',kind:'swing'}],sup:[]},2,{})), [96,'−2·ATR',['atr-target']]);
  var W=SIG.tradePlan('long',{price:100,res:[],sup:[{v:95,src:'S60',kind:'sr'}]},2,{riskKr:1000,fx:1});
  __eq('stop 3·ATR (no cap) → wide', [W.stop,W.flags], [94,['atr-target','wide']]);
  __eq('wide: exactly 2·ATR — no, 2.05·ATR — yes', [SIG.tradePlan('long',{price:100,res:[{v:104,src:'R60',kind:'sr'}],sup:[{v:97,src:'S60',kind:'sr'}]},2,{}).flags,SIG.tradePlan('long',{price:100,res:[{v:104,src:'R60',kind:'sr'}],sup:[{v:96.9,src:'S60',kind:'sr'}]},2,{}).flags], [[],['wide']]);
  var H=SIG.tradePlan('long',lv,2,{riskKr:3000,fx:10,half:true});
  __eq('half risk halves qty', [H.qty,H.flags], [50,['half']]);
  var E=SIG.tradePlan('long',lv,2,{riskKr:3000,fx:10,entry:99});
  __eq('limit entry: mode + Δentry', [E.mode,Math.round(E.dEntry*100)/100], ['limit',-1]);
  __eq('no support in corridor → fallback stop 1.5·ATR', SIG.tradePlan('long',{price:100,res:[],sup:[{v:90,src:'S60',kind:'sr'}]},2,{}).stop, 97);
});

// sidePlan: граница R/R на плавающей точке и условный лимит строго по ту сторону цены.
grp('sidePlan', function(){
  // стоп 1·ATR (клэмп), цель 2·ATR: 2.6/1.3 даёт 1.9999999999999996 — у уровня это рынок, а не «лимит под 2.0».
  var lvFP={price:10,res:[],sup:[{v:9.74,src:'S20',kind:'swing'}]},T=SIG.tradePlan('long',lvFP,1.3,{});
  __ok('FP: R/R 2·ATR/1·ATR just below 2', T.rr<2 && T.rr>2-1e-9);
  __eq('FP: at level → market, not limit', SIG.sidePlan('long',lvFP,1.3,true,{}).mode, 'market');
  // Не у уровня: ближайший уровень у самой цены (пробитый максимум) пропускается — лимит выше рынка бессмыслен.
  var lvB={price:100,res:[],sup:[{v:99.9,src:'R2+R20',kind:'swing'},{v:96,src:'SMA50',kind:'ma'}]};
  var C=SIG.sidePlan('long',lvB,2,false,{});
  __eq('conditional limit skips level at price', [C.mode,C.levelSrc,C.entry], ['limit','SMA50',96.5]);
  __eq('short: conditional limit above price', (function(x){return [x.mode,x.levelSrc,x.entry];})(SIG.sidePlan('short',{price:100,res:[{v:103,src:'SMA50',kind:'ma'}],sup:[]},2,false,{})), ['limit','SMA50',102.5]);
  __eq('no own level → market plan', SIG.sidePlan('long',{price:100,res:[],sup:[]},2,false,{}).mode, 'market');
  // Лимит под R/R 2 на широком рыночном стопе: wide пересчитывается по риску от лимит-цены.
  var lvW={price:100,res:[{v:105,src:'R60',kind:'sr'}],sup:[{v:96.9,src:'S60',kind:'sr'}]},mW=SIG.tradePlan('long',lvW,2,{}),pW=SIG.sidePlan('long',lvW,2,true,{});
  __eq('limit under rrGood: wide by limit risk', [mW.flags,pW.mode,Math.round(pW.risk*100)/100,pW.flags], [['wide'],'limit',3.03,[]]);
});

// Эталонные снимки на реальных свечах (фикстура 260 баров, Yahoo 2026-09-09).
grp('snapshot MU/AZN/AAPL', function(){
  var mu=SIG.snapshot(sigFixBars('MU'),{riskKr:5000,fx:1});
  __eq('MU: перегрев → trim (лонг)', [mu.phase.key,mu.verdict,mu.side,mu.score], ['heat','trim','long',72]);
  __approx('MU ATR Wilder', mu.atr, 54.0264, 1e-3);
  __approx('MU plan R/R (limit у SMA50)', mu.plan.rr, 1.7015, 1e-3);
  __eq('MU plan qty / mode', [mu.plan.qty,mu.plan.mode], [92,'limit']);
  __ok('MU why: +64% над SMA200', /перегрев: \+64% над SMA200/.test(mu.why[0]));
  var muT=SIG.snapshot(sigFixBars('MU'),{upTg:-12});
  __ok('heat by target + SMA200 both named', /выше таргета аналитиков на 12%, \+64% над SMA200/.test(muT.why[0]));
  var apT=SIG.snapshot(sigFixBars('AAPL'),{upTg:-8});
  __eq('heat by target only (below +30% SMA200)', [apT.phase.key,apT.verdict,/перегрев: цена выше таргета аналитиков на 8% —/.test(apT.why[0])], ['heat','trim',true]);
  var az=SIG.snapshot(sigFixBars('AZN.ST'),{riskKr:5000,fx:1});
  __eq('AZN: даунтренд → шорт-сторона, ждать', [az.phase.key,az.verdict,az.side,az.trendUp,az.score], ['down','wait','short',false,86]);
  __eq('AZN: short plan — условный лимит у R20+SMA50', [az.plan.mode,az.plan.levelSrc,az.plan.qty], ['limit','R20+SMA50',133]);
  __approx('AZN short R/R (цель-фолбэк 2·ATR на стопе 1·ATR)', az.plan.rr, 2, 1e-9);
  __ok('AZN: atr-target flag + «≈» in why', az.flags.indexOf('atr-target')>=0 && /R\/R ≈2\.0/.test(az.why.join('\n')));
  // Q7: цена выше таргета, но под SMA50 → не перегрев: фаза по тренду, таргет — причина.
  var azT=SIG.snapshot(sigFixBars('AZN.ST'),{upTg:-10});
  __eq('heat by target below SMA50 → trend phase', [azT.phase.key,azT.verdict], ['down','wait']);
  __ok('target overshoot kept as reason', azT.why.some(function(w){return /выше таргета аналитиков на 10% — под SMA50 это не перегрев/.test(w);}));
  __ok('AZN: no-short без ручного флага', az.flags.indexOf('no-short')>=0);
  __ok('AZN: shortOk снимает предупреждение', SIG.snapshot(sigFixBars('AZN.ST'),{shortOk:true}).flags.indexOf('no-short')<0);
  __ok('AZN: stale-target флаг', SIG.snapshot(sigFixBars('AZN.ST'),{staleTarget:true}).flags.indexOf('stale-target')>=0);
  var ap=SIG.snapshot(sigFixBars('AAPL'),{riskKr:5000,fx:1});
  __eq('AAPL: откат к поддержке, R/R по рынку < 2 → ждать лимита', [ap.phase.key,ap.setup,ap.verdict,ap.plan.mode,ap.score], ['up','откат к поддержке','wait','limit',96]);
  __approx('AAPL limit gives R/R = rrGood', ap.plan.rr, 2, 1e-9);
  __approx('AAPL limit = (target + 2·stop)/3', ap.plan.entry, SIG.limitForRR(ap.plan.target,ap.plan.stop,2), 1e-9);
  __ok('AAPL near = S1+SMA50', ap.near && ap.near.src==='S1+SMA50');
  // Порог rrMin — единственное место: при 1.8 тот же сетап (R/R 1.9 по рынку) становится «купить»…
  var _rr=SIG.CFG.rrMin; SIG.CFG.rrMin=1.8;
  var ap2=SIG.snapshot(sigFixBars('AAPL'),{});
  __eq('rrMin 1.8 → buy по рынку', [ap2.verdict,ap2.plan.mode], ['buy','market']);
  // Граница: rrMin чуть выше рыночного R/R (−1e-12) — «купить»; на 1e-6 выше — «ждать» с лимитом.
  var r0=SIG.tradePlan('long',ap.levels,ap.atr,{}).rr;
  SIG.CFG.rrMin=r0+1e-12;
  __eq('R/R = rrMin − 1e-12 → buy', [SIG.snapshot(sigFixBars('AAPL'),{}).verdict], ['buy']);
  SIG.CFG.rrMin=r0+1e-6;
  __eq('R/R = rrMin − 1e-6 → wait (limit)', (function(x){return [x.verdict,x.plan.mode];})(SIG.snapshot(sigFixBars('AAPL'),{})), ['wait','limit']);
  // Лимит под rrGood выше рынка (rrGood < R/R по рынку < rrMin) — честный текст, не «цель слишком близко».
  var _g=SIG.CFG.rrGood; SIG.CFG.rrMin=2; SIG.CFG.rrGood=1.5;
  var apN=SIG.snapshot(sigFixBars('AAPL'),{});
  __eq('limit does not fit → wait market + reason', [apN.verdict,apN.plan.mode,apN.plan.noLimit,/лимит под R\/R 1\.5 не помещается/.test(apN.why[0]),/цель слишком близко/.test(apN.why[0])], ['wait','market',true,true,false]);
  SIG.CFG.rrGood=_g; SIG.CFG.rrMin=1.8;
  // …а отчёт через 2 дня блокирует вход.
  var ap3=SIG.snapshot(sigFixBars('AAPL'),{earningsDays:2});
  __eq('earnings ≤3 дн → wait + флаг', [ap3.verdict,ap3.flags.indexOf('earnings')>=0], ['wait',true]);
  __eq('earnings через 10 дн не блокирует', SIG.snapshot(sigFixBars('AAPL'),{earningsDays:10}).verdict, 'buy');
  SIG.CFG.rrMin=_rr;
  __ok('snapshot: ind for chart, no markers (history → SIG.replay)', mu.ind && mu.ind.atr.length===260 && !('markers' in mu));
  // Q8: недооценка над SMA200 без сетапа → держать с условным лимитом (как аптренд), не «нет сетапа».
  var un=SIG.snapshot(sigFixBars('AAPL').slice(0,258),{upTg:30});
  __eq('undr above SMA200, no setup → hold + limit', [un.phase.key,un.price>un.s200,un.setup,un.verdict,un.plan.mode,un.why[0]], ['undr',true,null,'hold','limit','недооценка без сетапа — лимит на откат']);
  var arr=[{verdict:'wait',plan:{rr:3},score:90},{verdict:'trim',plan:{rr:1},score:10},{verdict:'buy',plan:{rr:2.1},score:40},{verdict:'short',plan:{rr:2.5},score:30},{verdict:'hold',plan:{rr:null},score:99}];
  __eq('SIG.cmp: group → R/R → score', arr.slice().sort(SIG.cmp).map(function(x){return x.verdict;}), ['short','buy','trim','wait','hold']);
});

// evalAt причинен: вердикт на баре k по полной истории = снимок по свечам 0..k (реплей не заглядывает вперёд).
grp('evalAt causal', function(){
  var B=sigFixBars('MU'),ind=SIG.indicators(B),bad=[];
  [205,222,240,259].forEach(function(k){
    var a=SIG.evalAt(B,ind,k,{}),b=SIG.snapshot(B.slice(0,k+1),{});
    if(a.verdict!==b.verdict||a.side!==b.side||a.phase.key!==b.phase.key||Math.abs(a.plan.entry-b.plan.entry)>1e-9||Math.abs(a.plan.stop-b.plan.stop)>1e-9||a.why.join('|')!==b.why.join('|'))bad.push(k);
  });
  __eq('evalAt(full, k) ≡ snapshot(0..k)', bad, []);
});

// simTrade: лестница выхода на ручных свечах (ATR = 2; вход по закрытию бара 0 = 100, стоп 98, цель 104).
grp('simTrade exit ladder', function(){
  var ind={atr:[2,2,2,2,2,2]},P={stop:98,target:104,rr:2},b=function(o,h,l,c){return {d:'',o:o,h:h,l:l,c:c,v:0};},B0=b(100,100.5,99.5,100);
  var t=SIG.simTrade([B0,b(99,99.5,97.5,98.2)],ind,0,'long',P);
  __eq('stop hit → −1R', [t.exits.length,t.exits[0].px,t.exits[0].why,t.R,t.open], [1,98,'стоп',-1,false]);
  t=SIG.simTrade([B0,b(96,96.5,95,96)],ind,0,'long',P);
  __eq('gap under stop → exit at open (−2R)', [t.exits[0].px,t.R], [96,-2]);
  t=SIG.simTrade([B0,b(100.5,102.5,99,102),b(100.5,101,99.5,100.2)],ind,0,'long',P);
  __eq('+1R → stop to breakeven → 0R', [t.exits[0].px,t.exits[0].why,t.R], [100,'безубыток',0]);
  t=SIG.simTrade([B0,b(101,104.5,100.8,104),b(102,102.5,100,100.4)],ind,0,'long',P);
  __eq('½ at target, then +2R → chandelier 2·ATR', t.exits.map(function(x){return [x.px,x.part,x.why];}), [[104,0.5,'цель ½'],[100.5,0.5,'трейлинг 2·ATR']]);
  __approx('R = ½·2R + ½·0.25R', t.R, 1.125, 1e-9);
  t=SIG.simTrade([B0,b(100.5,101.5,99.2,101)],ind,0,'long',P);
  __eq('no exit → open, marked to last close', [t.open,t.exits.length,t.R,t.out], [true,0,0.5,null]);
  t=SIG.simTrade([B0,b(99,99.5,95.5,96),b(97,99,96.5,98.5)],ind,0,'short',{stop:102,target:96,rr:2});
  __eq('short mirrored: ½ at target, breakeven… trail', [t.exits[0].why,t.exits[0].px,t.side], ['цель ½',96,'short']);
  __eq('same bar stop+target → stop first', SIG.simTrade([B0,b(100,104.5,97.5,101)],ind,0,'long',P).exits[0].why, 'стоп');
  __eq('zero risk → null', SIG.simTrade([B0,b(100,101,99,100)],ind,0,'long',{stop:100,target:104}), null);
});

// replay: вход — бар, где вердикт впервые стал buy/short; позиции не перекрываются; итоги окна.
grp('replay', function(){
  var B=sigFixBars('AZN.ST'),ind=SIG.indicators(B),r=SIG.replay(B,{ind:ind}),bad=[];
  __ok('AZN: trades + markers', r.trades.length>0 && r.markers.length>=r.trades.length);
  r.trades.forEach(function(t,k){
    var v=SIG.evalAt(B,ind,t.i,{shortOk:true}).verdict,pv=SIG.evalAt(B,ind,t.i-1,{shortOk:true}).verdict;
    if(!(v==='buy'||v==='short')||v===pv||(t.side==='short')!==(v==='short'))bad.push('entry '+t.d);
    var nx=r.trades[k+1];if(nx&&(t.open||nx.i<=t.out))bad.push('overlap '+t.d);
    if(Math.abs(t.entry-B[t.i].c)>1e-9)bad.push('entry≠close '+t.d);
  });
  __eq('entries = verdict turned buy/short, no overlap, entry at close', bad, []);
  __ok('markers: entry kinds + exits with reasons', r.markers.every(function(m){return ['buy','short','part','exit'].indexOf(m.kind)>=0&&m.d;}) && r.markers.some(function(m){return m.kind==='exit';}));
  __eq('< minBars → empty', SIG.replay(B.slice(0,50)).trades, []);
  var T=[{i:5,R:2,open:false},{i:9,R:-1,open:false},{i:12,R:0.5,open:true},{i:1,R:-1,open:false}];
  __eq('replayStats from bar 5', (function(x){return [x.n,x.win,x.avgR,x.pf,x.open];})(SIG.replayStats(T,5)), [2,1,0.5,2,1]);
  __eq('replayStats: no losses → PF ∞, none → nulls', [SIG.replayStats([{i:0,R:1,open:false}]).pf,SIG.replayStats([]).avgR,SIG.replayStats([]).pf], [Infinity,null,null]);
});

// chartModel (chart.js) — чистая модель графика: окно, зоны, линии плана по стороне/позиции, маркеры.
grp('chartModel', function(){
  var B=sigFixBars('MU'),snap=SIG.snapshot(B,{}),rep=SIG.replay(B,{ind:snap.ind});
  var m=chartModel(B,snap,rep,{bars:120});
  __eq('window: last 120 bars', [m.show,m.off,m.candles.length,m.candles[119].time,m.candles[0].close], [120,140,120,B[259].d,B[140].c]);
  __eq('SMA/RSI series: window minus warm-up (SMA200 from bar 199)', [m.sma.s50.length,m.sma.s200.length,m.rsi.length,m.sma.s200[0].time], [120,61,120,B[199].d]);
  __ok('zones: ≤ 2 sup + ≤ 2 res, structural, ±0.3·ATR', m.zones.length<=4 && m.zones.every(function(z){return !/^(S|R) · (P|R1|S1|R2|S2)$/.test(z.label)&&Math.abs((z.hi-z.lo)-0.6*snap.atr)<1e-9;}));
  __eq('lines = plan of verdict side', m.lines.map(function(l){return l.kind;}), ['entry','stop','target']);
  __eq('line prices = snapshot plan', [m.lines[1].price,m.lines[2].price], [snap.plans[snap.side].stop,snap.plans[snap.side].target]);
  var ms=chartModel(B,snap,rep,{bars:120,side:'short'});
  __eq('side short → short plan', [ms.side,ms.lines[1].price], ['short',snap.plans.short.stop]);
  var mp=chartModel(B,snap,rep,{side:'short',plan:{entry:300,stop:280,target:null,mode:'position'}});
  __eq('position plan overrides side (avg + stop only)', mp.lines.map(function(l){return [l.kind,l.price,l.title];}), [['entry',300,'Средняя'],['stop',280,'Стоп']]);
  __ok('atr-target → «≈ Цель»', chartModel(B,snap,rep,{plan:{entry:1,stop:0.9,target:1.2,flags:['atr-target']}}).lines[2].title==='≈ Цель');
  __ok('replay markers only inside window, sorted', m.markers.every(function(x){return x.time>=B[140].d;}) && m.markers.every(function(x,k,a){return !k||a[k-1].time<=x.time;}));
  var lastE=rep.markers.filter(function(x){return x.kind==='buy'||x.kind==='short';}).pop();
  __ok('labels only on the last replay trade, all keep label for tooltip', lastE && m.markers.every(function(x){return x.label && (x.time>=lastE.d ? x.text===x.label : x.text==='');}));
  __eq('stats = replayStats of window', m.stats, SIG.replayStats(rep.trades,140));
  var d0=B[200].d,ins=[{code:'P',date:d0},{code:'P',date:d0},{code:'S',date:B[210].d},{code:'A',date:d0},{code:'P',date:'2020-01-01'}];
  var mi=chartModel(B,snap,{trades:[],markers:[]},{bars:120,insider:ins,trades:[{date:B[230].d,act:'sell',short:true},{date:B[250].d,act:'buy',short:false}]});
  __eq('insider aggregated, out-of-window and non-P/S dropped; my trades labelled', mi.markers.map(function(x){return [x.kind,x.text];}), [['ins-buy','инс×2'],['ins-sell','инс'],['me','я: шорт'],['me','я: купил']]);
  var Bo=B.map(function(b){return {d:b.d,o:b.c,h:b.c,l:b.c,c:b.c,v:0};});
  __eq('old {t,c} bars → no volume pane', chartModel(Bo,SIG.snapshot(Bo,{}),{trades:[],markers:[]},{}).hasVol, false);
  var V=[{d:'2026-09-07'},{d:'2026-09-08'},{d:'2026-09-11'}];
  __eq('chartBarAt: exact / gap → next bar / ≤5 d before → 0 / older / after', [chartBarAt(V,'2026-09-08'),chartBarAt(V,'2026-09-09'),chartBarAt(V,'2026-09-03'),chartBarAt(V,'2026-08-20'),chartBarAt(V,'2026-09-12')], [1,2,0,-1,-1]);
  __ok('stats text', /3 сделок · 67 % в плюсе · средний \+0\.50R · PF 2\.00 · открыта 1/.test(chartStatsText({n:3,win:2,avgR:0.5,pf:2,open:1})) && /входов не было/.test(chartStatsText({n:0,open:0})));
});

// Q5: нож по пробою — закрытие ниже 60-дн минимума по вчера (сегодняшний low в S60 не входит), день > −3 %.
grp('knife by prior S60', function(){
  function bars(lastC){var B=[];for(var i=0;i<219;i++){var c=200-0.3*i;B.push({d:'',o:c+0.1,h:c+0.5,l:c-0.5,c:c,v:1000});}B.push({d:'',o:134.6,h:134.8,l:lastC-0.2,c:lastC,v:1000});return B;}
  var k=SIG.snapshot(bars(133.5),{});   // прошлый 60-дн минимум 134.1 → закрытие 133.5 ниже
  __eq('close under prior 60-day low → knife', [k.phase.key,k.verdict,k.flags.indexOf('knife')>=0,k.day>-3], ['knife','wait',true,true]);
  var n=SIG.snapshot(bars(134.5),{});   // проколол минимум внутри дня, закрылся выше
  __eq('intraday pierce, close above → down', n.phase.key, 'down');
});

grp('signals shadow adapter', function(){
  var _hc=_histCache,_S=SIGNALS,_L=SIG_SHADOW,_cal=pf3Cal,_desk=DESK;
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%','SMA 50','SMA 100','SMA 200','Поддержка','Сопротивление','Аналит. таргет','Таргет 3м'];
  var d={headers:h,rows:[]};
  var r=[1,'AstraZeneca','AZN','🇸🇪','Pharma','Стабильная',0,1527.5,'SEK',0,-0.8,1614,1650,1717,1500,1600,1900,2600];
  // stale-target (Q6): только если свежий таргет НИЖЕ основного > 50 % — 2600 выше 1900 → нет; shortOk по символу; отчёт через 3 дня
  pf3Cal={data:{'AZN.ST':{earnings:'2026-09-13'}},loaded:1,loading:false,failed:false};
  DESK={riskPct:1,riskCapPct:6,shortOk:{'AZN.ST':true}};
  var o=sigOpts(d,r,4000,Date.parse('2026-09-10T12:00:00Z'));
  __eq('sigOpts: risk, fx SEK, stale, earnings, shortOk', [o.riskKr,o.fx,o.staleTarget,o.earningsDays,o.shortOk], [4000,1,false,3,true]);
  var rs=function(rec){var x=r.slice();x[17]=rec;return sigOpts(d,x,4000,Date.parse('2026-09-10T12:00:00Z')).staleTarget;};
  __eq('stale-target: fresh below main > 50 % only', [rs(900),rs(1000),rs(1300),rs(3000)], [true,false,false,false]);
  __eq('sigEarnDays past → null', sigEarnDays('AZN.ST',Date.parse('2026-09-20T00:00:00Z')), null);
  __eq('no bars → null snapshot', (_histCache={},SIGNALS={},sigSnapRow(d,r,4000)), null);
  var F=SIG_FIX['AZN.ST'],j={t:F.map(function(b){return Date.parse(b[0]+'T00:00:00Z')/1000;}),o:F.map(function(b){return b[1];}),h:F.map(function(b){return b[2];}),l:F.map(function(b){return b[3];}),c:F.map(function(b){return b[4];}),v:F.map(function(b){return b[5];})};
  _histCache={'AZN.ST:2y':{j:j,t:1000}};
  SIG_SHADOW={v:1,days:{}};
  var now=Date.parse('2026-09-10T12:00:00Z');
  var s=sigSnapRow(d,r,4000,now);
  __eq('adapter snapshot = SIG.snapshot on same bars', [s.verdict,s.side,s.phase.key], ['wait','short','down']);
  __ok('adapter strips heavy arrays, marks ohlc', s.ind===null && !('markers' in s) && s.ohlc===true);
  __ok('flags from row: earnings, no stale-target, no no-short', s.flags.indexOf('earnings')>=0 && s.flags.indexOf('stale-target')<0 && s.flags.indexOf('no-short')<0);
  __ok('memo: same inputs → same object', sigSnapRow(d,r,4000,now)===s);
  _histCache['AZN.ST:2y'].t=2000;
  __ok('memo: fresh candles → recompute', sigSnapRow(d,r,4000,now)!==s);
  var e=SIG_SHADOW.days['2026-09-10']['AZN.ST'];
  __eq('shadow log entry', [e.tk,e.n,e.sd,e.pn,e.po,e.m,e.cv], ['AZN','wait','short','down',pf3Criterion(d,r).cls,'limit',SIG.VER]);
  __ok('shadow log keeps old verdicts', ['buy','wait','sell','avoid'].indexOf(e.o)>=0 && ['buy','wait','sell','avoid'].indexOf(e.oh)>=0);
  __eq('sigAgree coarse classes', [sigAgree('buy','buy'),sigAgree('sell','trim'),sigAgree('sell','short'),sigAgree('wait','hold'),sigAgree('avoid','wait'),sigAgree('avoid','buy'),sigAgree('buy','wait'),sigAgree(null,'wait')], [true,true,true,true,true,false,false,null]);
  __ok('sigSortVal orders like SIG.cmp', sigSortVal({verdict:'buy',plan:{rr:2.1},score:40})>sigSortVal({verdict:'trim',plan:{rr:5},score:99}) && sigSortVal({verdict:'trim',plan:{rr:1},score:0})>sigSortVal({verdict:'wait',plan:{rr:9},score:99}) && sigSortVal(null)<0);
  var pill=sigPillHTML({verdict:'buy',side:'long',why:['a "b"'],flags:[],plan:{rr:2.4,mode:'market',entry:10,stop:9,target:12.4,stopSrc:'S',targetSrc:'R',qty:5}},false,'sell');
  __ok('pill: glyph+word, ≠ on disagreement, escaped title', /▲/.test(pill) && /sig2-ne/.test(pill) && /&quot;b&quot;/.test(pill) && !/title="[^"]*"b"/.test(pill));
  __ok('pill: «≈» before R/R for atr-target', /R\/R ≈2\.0/.test(sigPillHTML({verdict:'buy',side:'long',why:[],flags:['atr-target'],plan:{rr:2,mode:'market',entry:10,stop:9,target:12,stopSrc:'S',targetSrc:'+2·ATR',qty:5,flags:['atr-target']}},false,null)) && !/≈/.test(pill));
  __ok('pill: trim outside book = «Перегрев»', /Перегрев/.test(sigPillHTML({verdict:'trim',side:'long',why:[],flags:[],plan:null},false,null)));
  // Отчёт: 3 бумаги, 2 дня; одна расходится
  var L={v:1,days:{'2026-09-09':{'A':{tk:'A',o:'buy',n:'wait',sd:'long',pn:'up',po:'up',rr:1.5,m:'limit',f:[],st:false,ohlc:true,w:''}},
    '2026-09-10':{'A':{tk:'A',o:'buy',n:'buy',sd:'long',pn:'up',po:'up',rr:2.2,m:'market',f:[],st:true,ohlc:true,w:''},
      'B':{tk:'B',o:'buy',oh:'wait',n:'short',sd:'short',pn:'down',po:'corr',rr:2.1,m:'market',f:['no-short'],st:true,ohlc:true,w:'даунтренд'},
      'C':{tk:'C',o:'wait',n:'hold',sd:'long',pn:'up',po:'up',rr:2,m:'limit',f:['wide','atr-target'],st:false,ohlc:false,w:''}}}};
  var md=sigShadowReport(L);
  __ok('report: header + counts', /2026-09-09 … 2026-09-10/.test(md) && /Бумаг: \*\*3\*\*, наблюдений: 4, дней: 2/.test(md));
  __ok('report: agreement 2/3 and phase 2/3', /\*\*67 %\*\* \(2\/3\)/.test(md) && /«Критерий»: \*\*67 %\*\*/.test(md));
  __ok('report: phase pair corr → down', /- corr → down: 1/.test(md));
  __ok('report: disagreement row for B', /\| B \| 2026-09-10 \| buy \| wait \| short \(шорт\) \| 2\.10 \|/.test(md));
  __ok('report: stability — A flipped in v2', /v2 1 · старый 0 из 3/.test(md));
  __ok('report: atr-target counted', /цель без уровня \(atr-target, R\/R ≈\): 1/.test(md));
  __ok('report: rules versions (no cv = до калибровки)', /Версии правил v2 \(последний снимок\): до калибровки 3/.test(md));
  // Смена вердикта из-за смены правил — не нестабильность.
  var Lc=JSON.parse(JSON.stringify(L));Lc.days['2026-09-10'].A.cv='2026-09-10-c1';
  __ok('report: flip across rule versions not counted', /v2 0 · старый 0 из 3/.test(sigShadowReport(Lc)));
  __ok('report: old-format bars counted', /Без OHLC \(старый формат воркера\): 1/.test(md));
  __ok('empty log → hint', /Журнал пуст/.test(sigShadowReport({v:1,days:{}})));
  var P={v:1,days:{'2026-08-01':{},'2026-09-01':{}}};
  __eq('prune keeps 14 days', Object.keys(sigShadowPrune(P,'2026-09-10').days), ['2026-09-01']);
  _histCache=_hc;SIGNALS=_S;SIG_SHADOW=_L;pf3Cal=_cal;DESK=_desk;
});

// pf3SignalInfo — «Сигнал» списка (tests-quality#2: ядро старых решений без тестов). Эталон для
// сравнения с nearLevel v2 в теневом режиме.
grp('pf3SignalInfo', function(){
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%','SMA 50','SMA 100','SMA 200','Поддержка','Сопротивление'];
  var d={headers:h,rows:[]},row=function(p,a,b,c,s,res){return [1,'X','X','','','',0,p,'USD',0,0,a,b,c,s,res];};
  __eq('buy at SMA50 (≤2%)', (function(x){return [x.type,x.n];})(pf3SignalInfo(d,row(101,100,90,80,85,120))), ['buy','SMA 50']);
  __eq('sell at resistance', (function(x){return [x.type,x.n];})(pf3SignalInfo(d,row(119,100,90,80,85,120))), ['sell','Сопр.']);
  var w=pf3SignalInfo(d,row(110,100,90,80,85,130));
  __eq('wait → nearest buy level below', [w.type,w.n,Math.round(w.dist*100)/100], ['wait','SMA 50',9.09]);
  __eq('below all levels', pf3SignalInfo(d,row(50,100,90,80,85,130)).type, 'below');
  __eq('no data → none', pf3SignalInfo(d,row(0,100,90,80,85,130)).type, 'none');
});

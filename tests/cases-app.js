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
var SNAP_KEYS=['data','rankings','sma','fx','colOrders','theme','hiddenCols','smaTf','sim','pfTrades','aiChat','tgAlerts','tabGroups','tabOrder','aiPort','aiPortBak','stockAiLog','insider','tgMeta','val','tgFull','aiReco','aiSpend','aiDash','aiPlaybook','aiPlaybookSeedV','planRules','scnAlerts','news','newsImpact','aiInclChat','cycleOvr','posMeta','desk','deskWatch','schemaV'];
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
  // 2026-09-10: таргет из совета AI больше не становится лимитом покупки
  var TTE='recoVerdict buy, +17% к 85.41, у поддержки 71.55, нефть растёт; добавляет EUR. Лимит 71.5–72';
  __eq('TTE: «к 85.41» — таргет, берётся зона входа 71.5–72', planParseLevel(TTE,'buy'), 72);
  __eq('старый разбор брал таргет (для миграции)', planParseLevelV1(TTE,'buy'), 85.41);
  __eq('CEVI: SMA50/SMA100 и «к 179» пропущены', planParseLevel('recoVerdict buy, +27% к 179, выше SMA50; шведское здравоохранение (SEK). Добор в зоне SMA100 155–160','buy'), 160);
  __eq('откат к 72 — вход, цель 90 — нет', planParseLevel('Докупить на откате к 72, цель 90','buy'), 72);
  __eq('стоп и таргет не вход', planParseLevel('Купить 120, стоп 110, таргет 150','buy'), 120);
  __eq('только таргет → 0 (уровень вручную)', planParseLevel('Купить: апсайд +25% до таргета 200','buy'), 0);
  __eq('одно число без подсказки → оно', planParseLevel('MU 120','buy'), 120);
  __eq('несколько чисел без подсказки → 0', planParseLevel('между 100 и 130','buy'), 0);
  __eq('P/E 25 и RSI 30 — не цена', planParseLevel('P/E 25, RSI 30, вход у 64','buy'), 64);
  __eq('sell: проценты пропущены', planParseLevel('Сократить на 30% при цене выше 150','sell'), 150);
  __eq('sell: у таргета, стоп пропущен', planParseLevel('фиксировать у таргета 95, стоп 80','sell'), 95);
  __eq('пусто → 0', [planParseLevel('','buy'), planParseLevel('держать','buy')], [0, 0]);
});
grp('plan ticker match & AI rule fix (v2)', function(){
  var _D=DATA; DATA={}; var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка'];
  DATA['Portfolio (Anna)']={headers:h,v3:'1',rows:[['','Investor B','INVE B','','','',5,300,'SEK',250],['','TotalEnergies','TTE','','','',3,78.31,'EUR',70]]};
  __eq('planTkKey: пробел = дефис', [planTkKey(' inve b '), planTkKey('INVE-B'), planTkKey('VOLV_B')], ['INVE-B','INVE-B','VOLV-B']);
  __eq('planRowFor находит «INVE B» по «INVE-B»', (planRowFor('INVE-B','Portfolio (Anna)')||[])[8], 'SEK');
  __eq('planRowFor ищет и в других вкладках', (planRowFor('inve-b','нет такой')||[])[2], 'INVE B');
  __eq('planCurPrice по «INVE-B»', planCurPrice('INVE-B'), 300);
  var TTE='recoVerdict buy, +17% к 85.41, у поддержки 71.55. Лимит 71.5–72';
  var r1={id:'pl1',tab:'Portfolio (Anna)',tk:'TTE',ccy:'EUR',act:'buy',level:85.41,note:TTE,fromAi:1,done:false,hitAt:5};
  __eq('нетронутое правило из AI → новый уровень, hitAt сброшен', [planFixAiRule(r1), r1.level, r1.hitAt], [true, 72, 0]);
  var r2={id:'pl2',tab:'Portfolio (Anna)',tk:'TTE',ccy:'EUR',act:'buy',level:73,note:TTE,fromAi:1,done:false};
  __eq('уровень правили руками — не трогаем', [planFixAiRule(r2), r2.level], [false, 73]);
  var r3={id:'pl3',tab:'Portfolio (Anna)',tk:'INVE-B',ccy:'USD',act:'buy',level:0,note:'держать ядро',fromAi:1,done:false};
  __eq('валюта из строки бумаги: USD → SEK', [planFixAiRule(r3), r3.ccy], [true, 'SEK']);
  var r4={id:'pl4',tk:'TTE',ccy:'EUR',act:'buy',level:85.41,note:TTE,done:false};
  __eq('правило не из AI — не трогаем', [planFixAiRule(r4), r4.level], [false, 85.41]);
  var r5={id:'pl5',tk:'TTE',ccy:'EUR',act:'buy',level:85.41,note:TTE,fromAi:1,done:true};
  __eq('исполненное — не трогаем', planFixAiRule(r5), false);
  __eq('второй проход ничего не меняет', planFixAiRule(r1), false);
  DATA=_D;
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
  __eq('ASML: USD — Nasdaq, EUR/без валюты — Амстердам', [exSymbol('ASML','USD'), exSymbol('asml','eur'), exSymbol('ASML','')], ['ASML','ASML.AS','ASML.AS']);
  __eq('простая подмена не зависит от валюты', [exSymbol('RHM','EUR'), exSymbol('FIGMA','USD'), exSymbol('NDB','SEK')], ['RHM.DE','FIG','NDA-SE.ST']);
  __eq('GBP → Лондон .L (паритет с воркером)', [exSymbol('ANTO','GBP'), exSymbol('ANTO.L','GBP')], ['ANTO.L','ANTO.L']);
  __ok('живые курсы включают GBP', FX_CCYS.indexOf('GBP')>=0);
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
  var _init=init, _mig=migrateState, _save=scheduleSave, saves=0;
  init=function(){}; migrateState=function(){}; scheduleSave=function(){ saves++; };
  var orig=snapshotState();
  var mk={};
  SNAP_KEYS.forEach(function(k){
    var v=orig[k];
    if(k==='theme') mk[k]='dark';
    else if(k==='desk') mk[k]=deskNorm({riskPct:2,riskCapPct:8,shortOk:{'MU':true},whatIf:{mode:'weight',amountSEK:25000,weightPct:3,port:'TP'}});
    else if(k==='deskWatch') mk[k]=deskWatchNorm({items:[{key:'MU|USD',tk:'MU',name:'Micron',buyLo:90,buyHi:100,thesis:{title:'HBM',text:'t'},createdAt:1,updatedAt:2}]});
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
    if(m && typeof m==='object' && !Array.isArray(m) && m.__m) ok = b && b.__m===k;   // aiSpend дополняется дефолтами
    else ok = JSON.stringify(b)===JSON.stringify(m);
    __ok('round-trip '+k, ok, 'got '+JSON.stringify(b));
  });
  // Снапшот старого клиента (до S3): нет posMeta/desk → локальные не затираются, push назад
  POS_META={'TP':{'MU':{side:'long',stop:90}}}; DESK=deskNorm({riskPct:2});
  DESK_WATCH=deskWatchNorm({items:[{key:'AAPL|USD',buyHi:180}]});
  saves=0;
  var old=JSON.parse(JSON.stringify(mk)); delete old.posMeta; delete old.desk; delete old.deskWatch; delete old.schemaV;
  applyRemoteState(old);
  __eq('old-client snapshot keeps local posMeta', POS_META.TP.MU.stop, 90);
  __eq('old-client snapshot keeps local deskWatch', DESK_WATCH.items.map(function(x){return x.key;}), ['AAPL|USD']);
  __eq('old-client snapshot keeps local desk', DESK.riskPct, 2);
  __eq('old-client snapshot → schemaV 0', STATE_V, 0);
  __ok('old-client snapshot schedules push-back', saves>0);
  // Клиент до I2: desk без whatIf → локальные настройки «Что если?» остаются, остальное — из снапшота
  DESK=deskNorm({whatIf:{mode:'weight',weightPct:4}});
  var pre=JSON.parse(JSON.stringify(mk)); pre.desk={riskPct:3,riskCapPct:6,shortOk:{}};
  applyRemoteState(pre);
  __eq('pre-I2 desk keeps local whatIf', [DESK.riskPct,DESK.whatIf.mode,DESK.whatIf.weightPct], [3,'weight',4]);
  applyRemoteState(orig);
  init=_init; migrateState=_mig; scheduleSave=_save;
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
  __eq('deskNorm whatIf defaults', deskNorm({}).whatIf, {mode:'amount',amountSEK:5000,weightPct:2,port:null});
  __eq('deskNorm whatIf clamps', deskNorm({whatIf:{mode:'x',amountSEK:50,weightPct:80,port:'TP'}}).whatIf, {mode:'amount',amountSEK:100,weightPct:50,port:'TP'});
  __eq('deskNorm whatIf clamps high/low', [deskNorm({whatIf:{amountSEK:2e7,weightPct:0.01,mode:'weight'}}).whatIf.amountSEK,deskNorm({whatIf:{weightPct:0.01}}).whatIf.weightPct,deskNorm({whatIf:{mode:'weight'}}).whatIf.mode], [1e7,0.1,'weight']);
  __eq('deskNorm tg (S8 bookcheck): по умолчанию вкл, выкл только явным false', [deskNorm({}).tg,deskNorm({tg:false}).tg,deskNorm({tg:0}).tg,deskNorm({tg:true}).tg], [true,false,true,true]);
  __eq('escHtml: & < > " \' и null', [escHtml('<a href="x">\'&'),escHtml(null)], ['&lt;a href=&quot;x&quot;&gt;&#39;&amp;','']);
  __ok('aiJobTimeoutMsg (блок A): «стартовала, но оборвалась» ≠ «не записалась»', aiJobTimeoutMsg(true)!==aiJobTimeoutMsg(false)&&aiJobTimeoutMsg(true).length>0&&aiJobTimeoutMsg(false).indexOf('ai_jobs')>=0);
  __eq('safeUrl: только http(s)', [safeUrl('https://a/b'),safeUrl('HTTP://a'),safeUrl('javascript:alert(1)'),safeUrl(' data:x'),safeUrl(null)], ['https://a/b','HTTP://a','','','']);
  __eq('deskNorm keeps risk fields with whatIf', [deskNorm({riskPct:2,whatIf:{amountSEK:10000}}).riskPct,deskNorm({riskPct:2,whatIf:{amountSEK:10000}}).whatIf.amountSEK], [2,10000]);
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

// Миграции (S7a): один проход migrateState() на загрузку; сиды только для PF3 и только при schemaV 0
// (data-model-sync#5, stale-info#3); личные сиды (Anna/Sergei/Gold/Small Cap/HEM/брокер) удалены.
grp('migrateState', function(){
  var _D=DATA,_V=STATE_V,_save=scheduleSave,_P=PLAN_RULES; scheduleSave=function(){};
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%'];
  DATA={}; DATA[PF3_KEY]={headers:h,rows:[],v3:'1'}; DATA['OMXSPI']={headers:h,rows:[],v3:'1'};
  STATE_V=1; PLAN_RULES=[];
  migrateState();
  __eq('v1: empty PF3 not seeded with MU', DATA[PF3_KEY].rows.length, 0);
  __eq('v1: no family/watchlist seeds', Object.keys(DATA).sort(), ['OMXSPI',PF3_KEY].sort());
  __eq('v1: HEM not added', DATA['OMXSPI'].rows.length, 0);
  DATA={}; STATE_V=0;
  PLAN_RULES=[{id:'plx',tk:'A',act:'buy',level:1,done:false}];
  migrateState();
  __eq('v0: PF3 created with MU seed', DATA[PF3_KEY].rows.map(function(r){return r[2];}), ['MU']);
  __ok('v0: no Anna/Sergei seed', !DATA['Portfolio (Anna)']&&!DATA['Portfolio (Sergei)']);
  __ok('v0: PF3 title not personal', !DATA[PF3_KEY].title);
  __eq('migrateSchema → SCHEMA_V', STATE_V, SCHEMA_V);
  __eq('migrateSchema normalizes plans', PLAN_RULES[0].status, 'armed');
  STATE_V=1; PLAN_RULES=[{id:'ply',tk:'MU',ccy:'USD',act:'buy',level:130,note:'+20% к 130, вход у 105',fromAi:1,done:false}];
  migrateState();
  __eq('v1→v2: уровень правила из AI пересчитан', [PLAN_RULES[0].level, STATE_V], [105, SCHEMA_V]);
  var n=DATA[PF3_KEY].rows.length; migrateState();
  __eq('migrateState idempotent', DATA[PF3_KEY].rows.length, n);
  // Классический индекс из бандла → v3 (схема колонок PF3)
  DATA={}; DATA[PF3_KEY]={headers:h.concat(['SMA 50']),rows:[],v3:'1'};
  DATA['OMXS30']={headers:['#','Компания','Тикер','Сектор','Цена 13 фев','1д %','SMA 50'],rows:[[1,'Volvo','VOLV B','Industri',250,1.5,240]],count:1};
  migrateState();
  __eq('bundle index → v3', [DATA['OMXS30'].v3, DATA['OMXS30'].rows[0][2], DATA['OMXS30'].rows[0][7], DATA['OMXS30'].rows[0][DATA['OMXS30'].headers.indexOf('SMA 50')]], ['1','VOLV B',250,240]);
  // init() больше не мигрирует: удалённый MU-сид не возвращается при перерисовке
  DATA={}; DATA[PF3_KEY]={headers:h,rows:[],v3:'1'}; STATE_V=0;
  __ok('init has no migrateState call', !/migrateState|migratePortfolio3/.test(String(init)));
  DATA=_D;STATE_V=_V;scheduleSave=_save;PLAN_RULES=_P;
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
  __eq('window: last 120 bars', [m.show,m.off,m.price.length,m.price[119].time,m.price[0].value], [120,140,120,B[259].d,B[140].c]);
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

// 🖥 Trade Desk (S6): чистое ядро desk.js — флаг, лимит книги, сделки лонг/шорт, действия по позиции,
// корзины «Сегодня», фильтры скринера, журнал сделок «туда-обратно».
grp('desk core', function(){
  __eq('flag ?desk=1 → on, remembered', deskFlagFrom('?desk=1',null), {on:true,set:'1'});
  __eq('flag ?desk=0 overrides stored', deskFlagFrom('?a=1&desk=0','1'), {on:false,set:'0'});
  __eq('flag from storage', deskFlagFrom('','1'), {on:true,set:null});
  __eq('flag ?desk=10 is not a flag', deskFlagFrom('?desk=10','0').on, false);
  var rs={openRiskSEK:2000,capSEK:3660};
  __ok('cap: +1000 fits', deskCapCheck(rs,1000).ok);
  __ok('cap: +2000 blocked', !deskCapCheck(rs,2000).ok);
  __eq('cap: left', deskCapCheck(rs,0).left, 1660);
  __ok('cap: no added risk never blocks (zero equity)', deskCapCheck({openRiskSEK:0,capSEK:0},0).ok);
});
grp('pfApplyTradeSide', function(){
  var b=pfApplyTradeSide({qty:10,avg:100},{side:'long',act:'buy',qty:10,price:120});
  __eq('long add: avg', [b.qty,b.avg,b.opens], [20,110,true]);
  var s=pfApplyTradeSide({qty:20,avg:110},{side:'long',act:'sell',qty:5,price:130});
  __eq('long sell: pl vs avg, avg kept', [s.qty,s.avg,s.tq,s.plNative], [15,110,5,100]);
  __eq('oversell capped', pfApplyTradeSide({qty:3,avg:10},{side:'long',act:'sell',qty:5,price:12}).tq, 3);
  var o=pfApplyTradeSide({qty:0,avg:0},{side:'short',act:'sell',qty:10,price:50});
  __eq('short open: avg proceeds', [o.qty,o.avg,o.opens,o.plNative], [10,50,true,null]);
  __eq('short add: average proceeds', pfApplyTradeSide({qty:10,avg:50},{side:'short',act:'sell',qty:10,price:40}).avg, 45);
  var c=pfApplyTradeSide({qty:20,avg:45},{side:'short',act:'buy',qty:5,price:30});
  __eq('short cover: pl mirrored', [c.qty,c.plNative,c.opens], [15,75,false]);
  __eq('cover without position', pfApplyTradeSide({qty:0,avg:0},{side:'short',act:'buy',qty:5,price:30}).err, 'nopos');
  __eq('bad input', pfApplyTradeSide({qty:1,avg:1},{side:'long',act:'buy',qty:0,price:10}).err, 'input');
});
grp('deskPosAct & trail', function(){
  __eq('trail long', deskTrailStop('long',90,120,5), 110);
  __eq('trail not better → null', deskTrailStop('long',115,120,5), null);
  __eq('trail short', deskTrailStop('short',60,40,3), 46);
  __eq('trail without ATR', deskTrailStop('long',90,120,0), null);
  var mk=function(px,stop,s,earn){var p={side:'long',entry:100,stop:stop,stop0:90,target:130,qty:10};p.calc=posCalc(p,px,1);return deskPosAct(p,s||null,earn==null?null:earn).act;};
  __eq('no stop', deskPosAct({side:'long',entry:100,stop:null,calc:posCalc({side:'long',entry:100,qty:1},100,1)},null,null).act, 'nostop');
  __eq('stop hit → exit', mk(89,90), 'exit');
  __eq('target → take', mk(131,90), 'take');
  __eq('overheated long → trim', mk(110,90,{verdict:'trim',atr:2}), 'trim');
  __eq('earnings at < 1R → earn', mk(105,90,null,2), 'earn');
  __eq('earnings at ≥ 1R → breakeven first', mk(112,90,null,2), 'be');
  __eq('+2R → trail', mk(125,90,{verdict:'hold',atr:5}), 'trail');
  __eq('stop already at b/e → hold', mk(111,100,{verdict:'hold',atr:0.1}), 'hold');
  __eq('near stop → watch', mk(101.5,100), 'watch');
  var sp={side:'short',entry:50,stop:55,stop0:55,target:40,qty:10};sp.calc=posCalc(sp,44,1);
  __eq('short +1.2R → be', deskPosAct(sp,null,null).act, 'be');
});
grp('desk today & screener', function(){
  var S=function(v,side,rr,mode,dEntry,ph,flags,setup,score,near){return {verdict:v,side:side,plan:{rr:rr,mode:mode,dEntry:dEntry||0,flags:[]},flags:flags||[],phase:{key:ph||'up',rank:6},setup:setup||null,score:score||50,price:100,day:0,near:near||null};};
  var it=function(tk,s,held){return {key:tk+'|USD',sec:{tk:tk,name:tk+' Inc',tabs:[held?'P':'IDX'],held:held?[{tab:'P',qty:1}]:[]},s:s};};
  var A=it('AAA',S('buy','long',2.5,'market',0,'up',[],'откат',60,{src:'S60',dist:1})),B=it('BBB',S('short','short',3,'market',0,'down',[],'отбой',55)),
      Cw=it('CCC',S('wait','long',2.0,'limit',-3,'corr')),D=it('DDD',S('hold','long',2.2,'limit',-12,'up')),E=it('EEE',S('wait','long',1,'market',0,'knife',['knife'])),
      F=it('FFF',S('trim','long',1,'market',0,'heat'),true),G=it('GGG',S('wait','long',1.0,'market',0,'up',[],'откат')),H=it('HHH',null);
  var items=[A,B,Cw,D,E,F,G,H],pos=[{act:'hold'},{act:'exit'},{act:'trim'},{act:'earn'}];
  var T=deskTodayBuckets(items,pos);
  __eq('entries: short rr3 before buy rr2.5', T.entries.map(function(x){return x.sec.tk;}), ['BBB','AAA']);
  __eq('waiting: limit ≤ 8 %, R/R ≥ 1.2', T.waiting.map(function(x){return x.sec.tk;}), ['CCC']);
  __eq('filtered reasons', [T.why.knife,T.why.heat,T.why.rr,T.why.none], [1,1,1,1]);
  __eq('pending = with snapshot', T.pending, 7);
  __eq('attention / trims', [T.attn.length,T.trims.length], [3,2]);
  var tks=function(R){return R.map(function(x){return x.sec.tk;});};
  __eq('screen: buy', tks(deskScreenRows(items,{v:'buy'})), ['AAA']);
  __eq('screen: wait = wait|hold', tks(deskScreenRows(items,{v:'wait'},{k:'tk',d:1})), ['CCC','DDD','EEE','GGG']);
  __eq('screen: short side', tks(deskScreenRows(items,{side:'short'})), ['BBB']);
  __eq('screen: near', tks(deskScreenRows(items,{near:true})), ['AAA']);
  __eq('screen: R/R ≥ 2 (limit 2.0 incl.)', tks(deskScreenRows(items,{rr:true},{k:'tk',d:1})), ['AAA','BBB','CCC','DDD']);
  __eq('screen: in book', tks(deskScreenRows(items,{held:true})), ['FFF']);
  __eq('screen: query by name', tks(deskScreenRows(items,{q:'ggg inc'})), ['GGG']);
  var all=tks(deskScreenRows(items,{},{k:'verdict',d:-1}));
  __eq('screen: default order = group → R/R, pending last', [all[0],all[1],all[all.length-1]], ['BBB','AAA','HHH']);
  __ok('screen: pending hidden by signal filters', tks(deskScreenRows(items,{phase:'up'})).indexOf('HHH')<0);
  __eq('screen: sort by R/R asc keeps pending last', tks(deskScreenRows(items,{},{k:'rr',d:1})).slice(-1), ['HHH']);
});
grp('desk journal', function(){
  var tr=[{tab:'P',tk:'acme',ccy:'USD',act:'buy',qty:10,price:100,date:'2026-01-01'},{tab:'P',tk:'ACME',ccy:'USD',act:'buy',qty:10,price:110,date:'2026-01-05'},
    {tab:'P',tk:'ACME',ccy:'USD',act:'sell',qty:20,price:120,plNative:300,date:'2026-02-01'},
    {tab:'P',tk:'NKE',ccy:'USD',act:'sell',qty:5,price:50,short:true,date:'2026-03-01'},{tab:'P',tk:'NKE',ccy:'USD',act:'buy',qty:5,price:40,short:true,date:'2026-03-10'},
    {tab:'P',tk:'OPEN',ccy:'USD',act:'buy',qty:3,price:10,date:'2026-04-01'},{tab:'P',tk:'ZZZ',ccy:'USD',act:'sell',qty:3,price:10,plNative:5,date:'2026-04-02'},
    {tab:'P',tk:'LOSS',ccy:'USD',act:'buy',qty:1,price:100,date:'2025-12-01'},{tab:'P',tk:'LOSS',ccy:'USD',act:'sell',qty:1,price:90,plNative:-10,date:'2025-12-05'}];
  var T=deskRoundTrips(tr);
  __eq('trips: open first, orphan sell skipped', T.map(function(t){return t.tk+(t.open?'*':'');}), ['OPEN*','NKE','ACME','LOSS']);
  var a=T[2];
  __eq('long trip: avg entry, exit, pl', [a.entryAvg,a.exitAvg,a.pl,a.maxQty,a.days], [105,120,300,20,31]);
  __approx('long trip: % of entry', a.plPct, 14.2857, 0.001);
  __eq('short trip: pl mirrored without plNative', [T[1].side,T[1].pl,T[1].plPct], ['short',50,20]);
  var st=deskJournalStats(T,{USD:10});
  __eq('stats: closed / open / wins', [st.n,st.open,st.win], [3,1,2]);
  __approx('stats: win rate', st.winRate, 66.667, 0.01);
  __approx('stats: profit factor (3500 / 100 kr)', st.pf, 35);
  __approx('stats: total kr', st.sumSEK, 3400);
  __eq('stats: empty', deskJournalStats([],{}).pf, null);
  __eq('R bins clamp tails', deskRBins([-5,-0.5,0.2,1.5,7,null]).n, [1,0,1,1,1,0,0,0,1]);
});
grp('desk exec & equity', function(){
  var _D=DATA,_pm=POS_META,_desk=DESK,_fx=FX,_tr=PF_TRADES,_pr=PLAN_RULES,_role=userRole;
  userRole='admin';FX={SEK:1,USD:10};POS_META={};PF_TRADES=[];DESK=deskNorm({});
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%','Прибыль','Прибыль %','Стоимость'];
  DATA={'BK':{headers:h,v3:'1',port:'1',cashFree:50000,rows:[]}};
  PLAN_RULES=[planRuleNorm({id:'pl1',tab:'BK',tk:'ACME',act:'buy',side:'long',level:100,stop:95,target:110})];
  var r=deskExecApply({tab:'BK',side:'long',mode:'open',qty:10,price:100,date:'2026-09-10',stop:95,target:110,planId:'pl1'},{tk:'acme',name:'Acme',ccy:'USD'},null);
  __ok('open long ok', r.ok, r.err);
  var row=DATA.BK.rows[0],fee=tradeFeeNative('USD',1000,true).total;
  __eq('row created: qty/avg/ccy', [row[2],row[6],row[9],row[8]], ['ACME',10,100,'USD']);
  __approx('cash −(amount+fee)·fx', DATA.BK.cashFree, 50000-(1000+fee)*10);
  __eq('meta: side/stop0/target/opened/plan', (function(m){return [m.side,m.stop,m.stop0,m.target,m.opened,m.planId];})(posMetaGet('BK','ACME')), ['long',95,95,110,'2026-09-10','pl1']);
  __eq('plan rule → open', PLAN_RULES[0].status, 'open');
  __eq('journal: buy recorded', [PF_TRADES[0].act,PF_TRADES[0].qty,!!PF_TRADES[0].short], ['buy',10,false]);
  __ok('cap blocks a huge risk', /Лимит|cap/.test(deskExecApply({tab:'BK',side:'long',mode:'open',qty:100,price:100,date:'2026-09-10',stop:50},{tk:'BIG',ccy:'USD'},null).err||''));
  __ok('opposite side blocked', /другой стороны|opposite/.test(deskExecApply({tab:'BK',side:'short',mode:'open',qty:1,price:100,date:'2026-09-10',stop:105},{tk:'ACME',ccy:'USD'},null).err||''));
  __ok('stop on wrong side blocked', /не с той|wrong side/.test(deskExecApply({tab:'BK',side:'long',mode:'open',qty:1,price:100,date:'2026-09-10',stop:105},{tk:'XYZ',ccy:'USD'},null).err||''));
  r=deskExecApply({tab:'BK',side:'long',mode:'close',qty:10,price:110,date:'2026-09-20'},{tk:'ACME',ccy:'USD'},null);
  var fs=tradeFeeNative('USD',1100,false).total;
  __ok('close long ok', r.ok, r.err);
  __approx('close: pl net of fee', PF_TRADES[1].plNative, Math.round((100-fs)*100)/100);
  __ok('close to zero: meta removed, plan done', !posMetaGet('BK','ACME') && PLAN_RULES[0].done===true);
  var c0=DATA.BK.cashFree;
  r=deskExecApply({tab:'BK',side:'short',mode:'open',qty:10,price:50,date:'2026-09-21',stop:55,target:40},{tk:'SHRT',name:'Short Co',ccy:'USD'},null);
  var f1=tradeFeeNative('USD',500,false).total;
  __ok('open short ok', r.ok, r.err);
  __approx('short open: only fee leaves cash', DATA.BK.cashFree, c0-f1*10);
  __eq('short journal: sell short:true', [PF_TRADES[2].act,PF_TRADES[2].short], ['sell',true]);
  var sr=DATA.BK.rows[1];sr[7]=45;
  __approx('equity counts short by P&L, not value', pfEquitySEK('BK'), DATA.BK.cashFree+(50-45)*10*10);
  recalcPF(1,'BK');
  __ok('recalcPF: short P&L positive when price fell', sr[11]>0 && sr[12]>0);
  var c1=DATA.BK.cashFree;
  r=deskExecApply({tab:'BK',side:'short',mode:'close',qty:10,price:40,date:'2026-09-25'},{tk:'SHRT',ccy:'USD'},null);
  var f2=tradeFeeNative('USD',400,true).total;
  __approx('cover: pl = (avg − price)·q − fee', PF_TRADES[3].plNative, Math.round((100-f2)*100)/100);
  __approx('cover: cash += pl·fx', DATA.BK.cashFree, c1+PF_TRADES[3].plNative*10, 0.02);
  __eq('cover journal: buy short:true, meta gone', [PF_TRADES[3].act,PF_TRADES[3].short,!!posMetaGet('BK','SHRT')], ['buy',true,false]);
  __eq('tax lots see the short pair', pfTaxLots(PF_TRADES.filter(function(t){return t.tk==='SHRT';}),'avg').length, 1);
  __eq('journal trips from real trades', deskRoundTrips(PF_TRADES).map(function(t){return t.tk+':'+t.side;}), ['SHRT:short','ACME:long']);
  // Новая позиция копирует колонки строки-источника по именам (таргет/уровни/SMA), цена — исполнения.
  var h0=h.concat(['SMA 50','Поддержка','Аналит. таргет']),d0={headers:h0,rows:[[1,'Copy','CPY','🇺🇸','Tech','Рост',0,77,'USD',0,1.5,'','','',70,68,95]]};
  deskExecApply({tab:'BK',side:'long',mode:'open',qty:1,price:80,date:'2026-09-26'},{tk:'CPY',name:'Copy',ccy:'USD'},d0.rows[0],d0);
  var nr=DATA.BK.rows.find(function(x){return x[2]==='CPY';}),hh=DATA.BK.headers;
  __eq('new row: exec price, day %, copied target/support', [nr[7],nr[10],nr[hh.indexOf('Аналит. таргет')],nr[hh.indexOf('Поддержка')]], [80,1.5,95,68]);
  DATA=_D;POS_META=_pm;DESK=_desk;FX=_fx;PF_TRADES=_tr;PLAN_RULES=_pr;userRole=_role;
});
grp('desk universe src', function(){
  var _D=DATA,_role=userRole;userRole='admin';
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%'];
  DATA={};DATA[PF3_KEY]={headers:h,v3:'1',rows:[[1,'Micron','MU','','Semis','',5,0,'USD',80,0]]};
  DATA['Nasdaq 100']={headers:h,v3:'1',rows:[[1,'Apple','AAPL','','Tech','',0,200,'USD',0,0],[2,'Micron','MU','','Semis','',0,99,'USD',0,0]]};
  var U=deskUniverse();
  __eq('src: first row with a price', U.bySym['MU|USD'].src, {tab:'Nasdaq 100',i:1});
  __eq('src: own row', U.bySym['AAPL|USD'].src, {tab:'Nasdaq 100',i:0});
  DATA=_D;userRole=_role;
});

// ── I1: список покупок, справедливая стоимость, уровень риска (plans/reference-features-implementation.md §2.1–2.3) ──
grp('deskWatch', function(){
  var _w=DESK_WATCH;
  var n=deskWatchNorm({lists:[{id:'x',name:'  Дип  '}],junk:1,items:[
    {key:'mu|usd',name:'  Micron  ',buyLo:'110',buyHi:100,tag:'SEMICONDUCTORS-AI',status:'final',order:5,riskOvr:9,fv:{base:'120',wBase:'x'},extra:1,createdAt:1,updatedAt:5},
    {key:'MU|USD',buyHi:1,updatedAt:3},
    {sym:'aapl',ccy:'usd',buyHi:180,order:2,createdAt:2},
    {sym:'',ccy:'USD'},null,'x',
    {key:'AZN.ST|SEK',tk:'azn',list:'nope',riskOvr:3,thesis:{title:'',text:''},whatBuy:{title:'Онкология'}}]});
  __eq('lists: main first, names trimmed', n.lists.map(function(l){return l.id+':'+l.name+':'+l.order;}), ['main::0','x:Дип:1']);
  __eq('dedup by key keeps the fresher edit', n.items.filter(function(x){return x.key==='MU|USD';}).length, 1);
  var mu=n.items.find(function(x){return x.key==='MU|USD';});
  __eq('numbers, swapped zone, trimmed strings', [mu.buyLo,mu.buyHi,mu.name,mu.tag,mu.status], [100,110,'Micron','SEMICONDUCTORS-A','final']);
  __eq('riskOvr out of range → null; fv weights default', [mu.riskOvr,mu.fv.base,mu.fv.wBase,mu.fv.wBear], [null,120,50,25]);
  __ok('unknown fields dropped', !('extra' in mu) && !('junk' in n));
  var aapl=n.items.find(function(x){return x.key==='AAPL|USD';});
  __eq('single price → lo = hi, sym/ccy upper', [aapl.buyLo,aapl.buyHi,aapl.sym,aapl.ccy,aapl.tk], [180,180,'AAPL','USD','AAPL']);
  var az=n.items.find(function(x){return x.key==='AZN.ST|SEK';});
  __eq('unknown list → main; empty thesis → null; card kept', [az.list,az.thesis,az.whatBuy&&az.whatBuy.title,az.tk,az.riskOvr], ['main',null,'Онкология','AZN',3]);
  __eq('invalid items dropped', n.items.length, 3);
  __eq('order renumbered 1…N', n.items.map(function(x){return x.tk+':'+x.order;}), ['AZN:1','AAPL:2','MU:3']);
  __eq('norm is idempotent', JSON.stringify(deskWatchNorm(JSON.parse(JSON.stringify(n)))), JSON.stringify(n));
  __eq('empty input → main list, no items', deskWatchNorm(null), {v:1,lists:[{id:'main',name:'',order:0}],items:[]});

  DESK_WATCH=deskWatchNorm({});
  var sec=function(tk,px){return {key:tk+'|USD',sym:tk,tk:tk,ccy:'USD',name:tk+' Inc',price:px};};
  var a=deskWatchAdd(sec('AAA',50),{buyLo:40,buyHi:45,buySrc:'signal'},Date.UTC(2026,8,10));
  __eq('add: ref price/date, zone, status', [a.refPx,a.refAt,a.buyLo,a.buySrc,a.status,a.order], [50,'2026-09-10',40,'signal','watch',1]);
  deskWatchAdd(sec('BBB',10));deskWatchAdd(sec('CCC',20));
  __eq('add existing returns it unchanged', deskWatchAdd(sec('AAA',99),{buyHi:1}).buyHi, 45);
  __eq('order after adds', deskWatchItems('watch').map(function(x){return x.tk;}), ['AAA','BBB','CCC']);
  __ok('move down', deskWatchMove('AAA|USD',1));
  __eq('after move down', deskWatchItems('watch').map(function(x){return x.tk;}), ['BBB','AAA','CCC']);
  __ok('move past the end refused', !deskWatchMove('CCC|USD',1));
  __ok('drag CCC before BBB', deskWatchMove('CCC|USD','BBB|USD'));
  __eq('after drag', deskWatchItems('watch').map(function(x){return x.tk;}), ['CCC','BBB','AAA']);
  __ok('drag to the end (null)', deskWatchMove('CCC|USD',null));
  __eq('after drag to end', deskWatchItems('watch').map(function(x){return x.tk;}), ['BBB','AAA','CCC']);
  deskWatchSetStatus('AAA|USD','final');
  __eq('final split from watch', [deskWatchItems('watch').map(function(x){return x.tk;}),deskWatchItems('final').map(function(x){return x.tk;})], [['BBB','CCC'],['AAA']]);
  __ok('move within final only (single → refused)', !deskWatchMove('AAA|USD',-1));
  var u=deskWatchUpdate('bbb|usd',{buyLo:12,buyHi:null,key:'ZZZ|USD',thesis:{title:'Тезис',text:'Почему'},fv:{bear:8,base:12,bull:20}},123);
  __eq('update: merge, null clears, key immutable', [u.key,u.buyLo,u.buyHi,u.thesis.title,u.fv.bull,u.updatedAt], ['BBB|USD',12,12,'Тезис',20,123]);
  __eq('update missing → null', deskWatchUpdate('NOPE|USD',{tag:'x'}), null);
  var rm=deskWatchRemove('BBB|USD');
  __eq('remove returns item, renumbers', [rm.tk,DESK_WATCH.items.map(function(x){return x.tk+':'+x.order;})], ['BBB',['AAA:1','CCC:2']]);
  __eq('remove missing → null', deskWatchRemove('BBB|USD'), null);
  DESK_WATCH=_w;
});
grp('deskWatchZone', function(){
  var z=deskWatchZone({buyLo:540,buyHi:540},611);
  __approx('single price: correction to zone', z.dHi, -11.62, 0.01);
  __eq('far above → not hot', [z.state,z.hot,z.range], ['far',false,false]);
  var r=deskWatchZone({buyLo:100,buyHi:110},141);
  __eq('range: −22…−29 %', [Math.round(r.dHi),Math.round(r.dLo),r.range], [-22,-29,true]);
  __eq('near: ≤ 3 % over the top', deskWatchZone({buyLo:100,buyHi:100},103).state, 'near');
  __eq('in zone', deskWatchZone({buyLo:100,buyHi:110},105).state, 'in');
  __eq('below zone is hot', [deskWatchZone({buyLo:100,buyHi:110},95).state,deskWatchZone({buyLo:100,buyHi:110},95).hot], ['below',true]);
  __eq('no zone / no price → null', [deskWatchZone({},100),deskWatchZone({buyLo:1,buyHi:1},0)], [null,null]);
});
grp('deskFairValue', function(){
  var s=deskFairValue({fv:{bear:80,base:100,bull:140,wBear:25,wBase:50,wBull:25}},{consensus:500},90);
  __eq('scenarios win over analysts', s.src, 'scenarios');
  __approx('scenarios 25/50/25', s.value, 105);
  __approx('upside from current price', s.upsidePct, 16.667, 0.01);
  var b=deskFairValue({fv:{base:100,bull:160,wBear:25,wBase:50,wBull:25}},null,100);
  __approx('missing bear → weights renormalised (50/25)', b.value, 120);
  __eq('without base → analysts fallback', deskFairValue({fv:{bear:80,bull:140}},{low:90,consensus:120,high:150,count:31,lastDate:'2026-09-01'},100).src, 'analysts');
  var a=deskFairValue(null,{low:90,consensus:120,high:150,count:31,lastDate:'2026-09-01T10:00'},100);
  __eq('analysts: 25/50/25, count, date', [a.value,a.n,a.at,a.parts.map(function(p){return p.k;})], [120,31,'2026-09-01',['low','consensus','high']]);
  __approx('analysts: only consensus', deskFairValue(null,{consensus:130},100).value, 130);
  __eq('nothing → null value and src', [deskFairValue(null,null,100).value,deskFairValue(null,{},100).src], [null,null]);
  __eq('no price → no upside', deskFairValue(null,{consensus:130},0).upsidePct, null);
});
grp('deskRiskLevel', function(){
  var mu=SIG.snapshot(sigFixBars('MU'),{riskKr:5000,fx:1}),az=SIG.snapshot(sigFixBars('AZN.ST'),{riskKr:5000,fx:1}),ap=SIG.snapshot(sigFixBars('AAPL'),{riskKr:5000,fx:1});
  __eq('MU: ATR 5.4 % → 5', [deskRiskLevel(mu).level,deskRiskLevel(mu).parts[0].add], [5,5]);
  __eq('AZN: ATR 2.4 % → 2', deskRiskLevel(az).level, 2);
  __eq('AAPL: ATR 2.4 % → 2', deskRiskLevel(ap).level, 2);
  var azs=SIG.snapshot(sigFixBars('AZN.ST'),{riskKr:5000,fx:1,staleTarget:true});
  __eq('stale-target +1', [deskRiskLevel(azs).level,deskRiskLevel(azs).parts.map(function(p){return p.k;})], [3,['atr','stale-target']]);
  __eq('beta > 1.5 +1', deskRiskLevel(ap,{beta:1.8}).level, 3);
  __eq('beta 1.5 is not high', deskRiskLevel(ap,{beta:1.5}).level, 2);
  __eq('capped at 5', deskRiskLevel(mu,{beta:2}).level, 5);
  var f={atrPct:1.5,flags:['earnings','knife'],plan:{flags:['wide']}};
  __eq('thresholds inclusive + flags', [deskRiskLevel({atrPct:1.5,flags:[]}).level,deskRiskLevel({atrPct:1.51,flags:[]}).level,deskRiskLevel(f).level], [1,2,4]);
  __eq('wide only from the chosen side plan', deskRiskLevel(f,{plan:{flags:[]}}).level, 3);
  var o=deskRiskLevel(ap,{riskOvr:4});
  __eq('manual override keeps auto', [o.level,o.auto,o.ovr], [4,2,4]);
  __eq('words', [deskRiskWord(1),deskRiskWord(5)], ['Низкий','Очень высокий']);
  __eq('no snapshot → null unless override', [deskRiskLevel(null).level,deskRiskLevel(null,{riskOvr:2}).level], [null,2]);
});
grp('deskBuyDefault', function(){
  var az=SIG.snapshot(sigFixBars('AZN.ST'),{riskKr:5000,fx:1}),ap=SIG.snapshot(sigFixBars('AAPL'),{riskKr:5000,fx:1});
  var z=deskBuyDefault(az);
  __eq('limit of the long plan', [z.lo,z.hi], [Math.round(az.plans.long.entry*100)/100,Math.round(az.plans.long.entry*100)/100]);
  __ok('note names the level', /S60/.test(z.note));
  var m={price:100,plans:{long:{mode:'market',entry:100}},levels:{sup:[{v:98,src:'S1',kind:'pivot'},{v:95,src:'S20+SMA50',kind:'sr'}]}};
  __eq('market → nearest structural support (no pivots)', [deskBuyDefault(m).lo,/S20 · SMA50/.test(deskBuyDefault(m).note)], [95,true]);
  __eq('no support → market entry', deskBuyDefault({price:100,plans:{long:{mode:'market',entry:100}},levels:{sup:[]}}).lo, 100);
  __eq('no snapshot → null', deskBuyDefault(null), null);
  __ok('AAPL limit', deskBuyDefault(ap).lo>0);
});

// ── I2: «Что если?» (plans/reference-features-implementation.md §2.4) ──
grp('deskWhatIf', function(){
  var _D=DATA,_pm=POS_META,_desk=DESK,_fx=FX,_tr=PF_TRADES,_pr=PLAN_RULES;
  FX={SEK:1,USD:10,EUR:11};DESK=deskNorm({riskPct:1,riskCapPct:6});PF_TRADES=[];PLAN_RULES=[];
  var h=['№','Компания','Тикер','Флаг','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','День%'];
  var mkD=function(cash){var d={headers:h,v3:'1',port:'1',rows:[[1,'Acme','ACME','🇺🇸','Tech','Рост',10,110,'USD',100,0],[2,'Volvo','VOLV','🇸🇪','Industri','Рост',100,250,'SEK',200,0]]};if(cash!==undefined)d.cashFree=cash;return d;};
  DATA={'BK':mkD(50000)};POS_META={'BK':{'ACME':{side:'long',stop:90}}};
  var NOW=Date.UTC(2026,8,10,12),sec=function(tk,ccy,sector,px){return {tk:tk,sym:tk,ccy:ccy,sector:sector,price:px,pxAt:NOW};};
  var wi=function(o){return deskWhatIf(Object.assign({tab:'BK',side:'long',mode:'amount',amountSEK:5000,now:NOW},o));};
  var codes=function(r){return r.warnings.map(function(w){return w.code+(w.blocking?'!':'');});};
  // equity = 11000 (ACME) + 25000 (VOLV) + 50000 кэш = 86000; открытый риск (110−90)·10·10 = 2000; лимит 6 % = 5160
  var L=wi({sec:sec('NEW','USD','Tech',100),plan:{mode:'market',entry:100,stop:95}});
  var f=tradeFeeNative('USD',500,true);
  __eq('long USD: 5000 kr → 5 sh at 100 USD × 10', [L.qty,L.notional,L.notionalSEK], [5,500,5000]);
  __approx('long: fee via tradeFeeNative (courtage min 6 + fx 0.25 %)', L.feeSEK, f.total*10);
  __approx('long: cash − (amount + fee)', L.cashAfter, 50000-5000-f.total*10);
  __approx('long: equity after = before − fee', L.equityAfter, 86000-f.total*10);
  __approx('long: new weight', L.weightAfter, 5000/(86000-72.5)*100, 0.001);
  __approx('long: sector Tech before/after', L.sectorAfter-L.sectorBefore, 16000/(86000-72.5)*100-11000/86000*100, 0.001);
  __approx('long: trade risk qty·|entry − stop|·fx', L.tradeRiskSEK, 250);
  __eq('long: book risk before/after, cap', [L.bookRiskBefore,L.bookRiskAfter,Math.round(L.capSEK)], [2000,2250,5160]);
  __eq('long: all clear → ok', [L.status,L.warnings.length], ['ok',0]);
  __eq('weight mode: 2 % of equity → 1 sh', wi({mode:'weight',weightPct:2,sec:sec('NEW','USD','Tech',100),plan:{stop:95}}).qty, 1);
  __eq('limit plan price used when no price', wi({sec:sec('NEW','USD','Tech',100),plan:{mode:'limit',entry:90,stop:85}}).price, 90);
  // Шорт: кэш — только комиссия, вес по модулю, риск — до стопа сверху
  var S=wi({side:'short',sec:sec('SHRT','USD','Energy',50),plan:{mode:'market',entry:50,stop:55}}),fs=tradeFeeNative('USD',500,false);
  __eq('short: 10 sh, sell fee', [S.qty,S.feeNative], [10,fs.total]);
  __approx('short: cash changes only by the fee', S.cashAfter, 50000-fs.total*10);
  __approx('short: weight by modulus', S.weightAfter, 5000/(86000-fs.total*10)*100, 0.001);
  __approx('short: risk to the stop above', S.tradeRiskSEK, 500);
  __eq('short: unconfirmed → attention', [S.status,codes(S)], ['attention',['noshort']]);
  DESK=deskNorm({riskPct:1,riskCapPct:6,shortOk:{SHRT:1}});
  __eq('short confirmed → ok', wi({side:'short',sec:sec('SHRT','USD','Energy',50),plan:{stop:55}}).status, 'ok');
  // SEK и EUR: курс и валютная надбавка
  var V=wi({sec:sec('VOLV','SEK','Industri',250),plan:{stop:240}});
  __eq('SEK: 20 sh, no fx fee, add to held (avg by genomsnittsmetoden)', [V.qty,V.fee.fx,V.qtyBefore,V.qtyAfter,Math.round(V.avgAfter*100)/100], [20,0,100,120,208.33]);
  __eq('SEK: weight 29 % → 35 % warns, SEK share never warns', codes(V), ['weight']);
  var E=wi({sec:sec('SAP','EUR','Tech',20),plan:{stop:19}}),fe=tradeFeeNative('EUR',440,true);
  __eq('EUR: floor(5000 / (20·11)) = 22 sh', [E.qty,E.fx], [22,11]);
  __approx('EUR: fee in kr', E.feeSEK, fe.total*11);
  // Предупреждения
  __eq('budget below one share → blocked', [wi({amountSEK:100,sec:sec('NEW','USD','Tech',100),plan:{stop:95}}).status,codes(wi({amountSEK:100,sec:sec('NEW','USD','Tech',100),plan:{stop:95}}))], ['blocked',['qty!']]);
  var cap=wi({amountSEK:40000,sec:sec('BIG','USD','Energy',100),plan:{stop:50}});
  __ok('cap blocks like deskCapCheck', cap.status==='blocked'&&codes(cap).indexOf('cap!')>=0&&!deskCapCheck(bookRiskState('BK'),cap.tradeRiskSEK).ok);
  var conc=wi({amountSEK:25000,sec:sec('NEW','USD','Tech',100),plan:{stop:99}});
  __eq('concentration: weight + sector (Tech 42 %), USD < 60 %', codes(conc), ['weight','sector']);
  __eq('currency > 60 % (not SEK)', codes(wi({amountSEK:45000,sec:sec('US2','USD','Energy',100),plan:{stop:99.9}})).indexOf('ccy')>=0, true);
  __eq('no stop → attention, risk 0', [codes(wi({sec:sec('NEW','USD','Tech',100),plan:null})),wi({sec:sec('NEW','USD','Tech',100)}).tradeRiskSEK], [['nostop'],0]);
  var st=sec('NEW','USD','Tech',100);st.pxAt=NOW-31*60e3;
  __eq('price older than 30 min → stale', codes(wi({sec:st,plan:{stop:95}})), ['stale']);
  POS_META.BK.ACME.side='short';
  __eq('opposite side held → blocked', codes(wi({sec:sec('ACME','USD','Tech',110),plan:{stop:100}})).indexOf('side!')>=0, true);
  POS_META.BK.ACME.side='long';
  DATA.BK.rows[1][7]='';
  __eq('held row without price → equity understated, said so', codes(wi({amountSEK:1000,sec:sec('NEW','USD','Energy',100),plan:{stop:95}})), ['nopx']);
  DATA={'BK':mkD(0)};
  // без кэша капитал 36000, лимит 2160 — сумма 1000 kr держит риск и доли в пределах
  __eq('zero cash: long blocked', codes(wi({amountSEK:1000,sec:sec('NEW','USD','Energy',100),plan:{stop:95}})), ['cash!']);
  __eq('zero cash: short only warns (fee)', codes(wi({amountSEK:1000,side:'short',sec:sec('SHRT','USD','Energy',50),plan:{stop:55}})), ['cash']);
  DATA={'BK':mkD()};
  var nc=wi({amountSEK:1000,sec:sec('NEW','USD','Energy',100),plan:{stop:95}});
  __eq('no cash field → cash not simulated, no warning', [nc.cashBefore,nc.cashAfter,nc.status], [null,null,'ok']);
  __eq('errors: no portfolio / no price', [deskWhatIf({tab:'NOPE'}).err,wi({sec:{tk:'X',ccy:'USD'}}).err], ['port','price']);
  DATA={'BK':mkD(50000)};DESK=deskNorm({riskPct:1,riskCapPct:6});
  var before=JSON.stringify([DATA,POS_META,PLAN_RULES,PF_TRADES,DESK]);
  wi({sec:sec('NEW','USD','Tech',100),plan:{stop:95}});wi({side:'short',sec:sec('SHRT','USD','Energy',50),plan:{stop:55}});wi({sec:sec('VOLV','SEK','Industri',250)});
  __eq('simulation writes nothing (DATA/POS_META/PLAN_RULES/PF_TRADES/DESK)', JSON.stringify([DATA,POS_META,PLAN_RULES,PF_TRADES,DESK]), before);
  DATA=_D;POS_META=_pm;DESK=_desk;FX=_fx;PF_TRADES=_tr;PLAN_RULES=_pr;
});
// ── I3: «Рост бизнеса» (deskFinModel/deskFinSvg), «Аналитики и оценка» (deskPeers/deskMultDev/deskRatings), веер цели (chartFanModel)
grp('deskFinModel', function(){
  var fin={sym:'MU',ccy:'USD',source:'fmp',status:'ok',fetchedAt:'2026-09-10T10:00:00Z',notes:[],
    annual:[{year:2021,revenue:100,eps:2,fcf:10},{year:2022,revenue:121,eps:-1,fcf:null},{year:2023,revenue:110,eps:1,fcf:12},{year:2024,revenue:133.1,eps:3,fcf:15}],
    estimates:[{year:2024,revenue:999,eps:9,n:3},{year:2025,revenue:146.41,eps:4,n:20},{year:2026,revenue:161.051,eps:null,n:18}]};
  var now=Date.parse('2026-09-11T10:00:00Z'),M=deskFinModel(fin,'revenue',now);
  __eq('факт + прогноз позже последнего факта (2024 из прогноза отброшен)', M.bars.map(function(b){return b.year+(b.est?'П':'');}), ['2021','2022','2023','2024','2025П','2026П']);
  __eq('state ok, 4 факта, 2 прогноза', [M.state,M.act,M.est], ['ok',4,2]);
  __approx('исторический CAGR 2021→2024 = 10 %', M.cagrHist.pct, 10, 1e-6);
  __eq('исторический CAGR: годы', [M.cagrHist.from.year,M.cagrHist.to.year,M.cagrHist.years], [2021,2024,3]);
  __approx('прогнозный CAGR 2024→2026 = 10 %', M.cagrFcst.pct, 10, 1e-6);
  __approx('г/г 2022', M.bars[1].yoy, 21, 1e-6);
  __eq('г/г первого года нет', M.bars[0].yoy, null);
  __eq('прогноз несёт число аналитиков', M.bars[4].n, 20);
  __eq('не устарел через сутки', M.stale, false);
  __eq('устарел через 8 дней', deskFinModel(fin,'revenue',Date.parse('2026-09-18T11:00:00Z')).stale, true);
  var E=deskFinModel(fin,'eps',now);
  __eq('EPS: прогноз только 2025 (у 2026 EPS нет)', E.bars.map(function(b){return b.year;}), [2021,2022,2023,2024,2025]);
  __eq('EPS: 1 точка прогноза → прогнозного CAGR нет (решение §6#4)', [E.est,E.cagrFcst], [1,null]);
  __eq('EPS: г/г от отрицательной базы не считается', E.bars[2].yoy, null);
  __approx('EPS: исторический CAGR 2→3 за 3 года', E.cagrHist.pct, (Math.pow(1.5,1/3)-1)*100, 1e-6);
  var F=deskFinModel(fin,'fcf',now);
  __eq('FCF: только факт, год без значения исключён', [F.bars.map(function(b){return b.year;}),F.est,F.excluded,F.state], [[2021,2023,2024],0,[2022],'partial']);
  __eq('FCF: г/г через пропущенный год не считается', F.bars[1].yoy, null);
  __eq('отрицательный последний EPS → CAGR нет', deskFinModel({status:'partial',annual:[{year:2023,eps:1},{year:2024,eps:-2}],estimates:[]},'eps',now).cagrHist, null);
  __eq('нет ответа → loading', deskFinModel(null,'revenue',now).state, 'loading');
  __eq('ошибка провайдера → error', deskFinModel({status:'error',annual:[],notes:['provider-error']},'revenue',now).state, 'error');
  __eq('nodata', deskFinModel({status:'nodata',annual:[],estimates:[]},'revenue',now).state, 'nodata');
  __eq('1 год факта + прогноз → partial', deskFinModel({status:'partial',annual:[{year:2025,revenue:10}],estimates:[{year:2026,revenue:11}]},'revenue',now).state, 'partial');
  __eq('чужой ряд → revenue', deskFinModel(fin,'zzz',now).metric, 'revenue');
  __eq('прогноз без факта не показывается', deskFinModel({status:'nodata',annual:[],estimates:[{year:2026,revenue:5}]},'revenue',now).bars, []);
  __eq('deskFinCagr: нулевой период → null', deskFinCagr({year:2024,v:1},{year:2024,v:2}), null);
});
grp('deskFinSvg', function(){
  var fin={status:'ok',source:'yahoo',annual:[{year:2023,revenue:5e9},{year:2024,revenue:-1e9}],estimates:[{year:2025,revenue:6e9,n:4}],fetchedAt:'2026-09-10T00:00:00Z'};
  var svg=deskFinSvg(deskFinModel(fin,'revenue',Date.parse('2026-09-10T01:00:00Z')),'SEK');
  __eq('три столбца, все фокусируемы', (svg.match(/<g class="dk-fb/g)||[]).length, 3);
  __ok('прогноз помечен классом est', /class="dk-fb est"/.test(svg));
  __ok('отрицательный факт помечен neg', /class="dk-fb neg"/.test(svg));
  __ok('подсказка: значение, валюта, «прогноз», аналитики, источник; г/г от отрицательной базы нет', /2025 · 6[,.]0 млрд SEK · прогноз · 4 аналит\. · Yahoo/.test(svg) && !/2025[^"]*г\/г/.test(svg));
  __ok('линия г/г рвётся на годе без базы', (svg.match(/<polyline/g)||[]).length===0 && (svg.match(/<circle/g)||[]).length===1);
  __eq('пустая модель → пустая строка', deskFinSvg({bars:[]},'USD'), '');
  __eq('единицы', [deskFinFmt(1.5e12,'revenue'),deskFinFmt(37378e6,'revenue'),deskFinFmt(-4e6,'fcf'),deskFinFmt(7.594,'eps'),deskFinFmt(null,'eps')], ['1,50 трлн','37,4 млрд','-4 млн','7,59','—']);
});
grp('deskPeers', function(){
  var V={ME:{sector:'Tech',pe:30},A:{sector:'Tech',pe:20},B:{sector:'Tech',pe:40},C:{sector:'Tech',pe:25},D:{sector:'Tech',pe:0},E:{sector:'Energy',pe:8},F:{sector:'Tech',pe:35}};
  var P=deskPeers('ME',V,{A:5e9,B:9e9,C:1e9});
  __eq('пиры: тот же сектор, P/E > 0, без себя; крупнейшие по кап-и, затем по тикеру', P.peers.map(function(p){return p.tk;}), ['B','A','C','F']);
  __eq('медиана пиров', P.median, 30);
  __eq('reason null', P.reason, null);
  var many={ME:{sector:'S',pe:10}};for(var i=0;i<12;i++)many['T'+(i<10?'0':'')+i]={sector:'S',pe:10+i};
  __eq('не больше peersMax', deskPeers('ME',many,{}).peers.length, DESK_IDEA_CFG.ana.peersMax);
  __eq('мало пиров → few', [deskPeers('E',V,{}).reason,deskPeers('E',V,{}).peers], ['few',[]]);
  __eq('нет сектора → nosector', deskPeers('ZZ',V,{}).reason, 'nosector');
});
grp('deskMultDev/deskRatings', function(){
  __eq('на 20 % дешевле медианы → cheap', deskMultDev(16,20).cls, 'cheap');
  __approx('отклонение %', deskMultDev(16,20).dev, -20, 1e-9);
  __eq('в пределах devPct → нейтрально', deskMultDev(21,20).cls, '');
  __eq('дороже → rich', deskMultDev(30,20).cls, 'rich');
  __eq('нет ориентира → null', deskMultDev(16,null), {dev:null,cls:''});
  var R=deskRatings({strongBuy:6,buy:10,hold:4,sell:0,strongSell:0,consensus:'Buy'});
  __eq('рейтинги: пустые сегменты отброшены', R.segs.map(function(x){return x.k;}), ['strongBuy','buy','hold']);
  __eq('итого и консенсус', [R.total,R.consensus], [20,'Buy']);
  __approx('доля Buy', R.segs[1].pct, 50, 1e-9);
  __eq('нет рейтингов → null', [deskRatings(null),deskRatings({buy:0})], [null,null]);
});
grp('chartFanModel', function(){
  var bars=[];for(var i=0;i<300;i++){var d=new Date(Date.UTC(2025,0,1)+i*864e5).toISOString().slice(0,10);bars.push({d:d,c:100+i*0.1});}
  var M=chartFanModel(bars,{low:90,consensus:150,high:200});
  __eq('история заканчивается последним баром', M.last, {time:bars[299].d,value:bars[299].c});
  __ok('история — недельные слоты за последний год', M.hist.length===51 && M.hist[0].time===bars[299-250].d);
  __eq('будущее — 52 пустых недельных слота до конца веера', [M.future.length,M.future[0].time,M.end], [52,'2025-11-03',M.future[51].time]);
  __eq('линии high/consensus/low, по 2 точки от последнего закрытия', M.lines.map(function(l){return [l.kind,l.data.length,l.data[0].value,l.data[1].time];}), [['high',2,bars[299].c,M.end],['consensus',2,bars[299].c,M.end],['low',2,bars[299].c,M.end]]);
  __approx('апсайд консенсуса', M.lines[1].pct, (150/bars[299].c-1)*100, 1e-9);
  __eq('только консенсус → одна линия', chartFanModel(bars,{consensus:150}).lines.length, 1);
  __eq('без консенсуса или свечей → null', [chartFanModel(bars,{low:1,high:2}),chartFanModel([],{consensus:1}),chartFanModel(bars,null)], [null,null,null]);
  __ok('время строго возрастает', M.hist.concat(M.future).every(function(p,i,a){return !i||a[i-1].time<p.time;}));
});
// ── Линия прибыли на графике (plans/earnings-line.md): chartEarningsModel / chartEarnAt / deskEarnPe ──
function __wdays(from,to){var o=[];for(var t=Date.parse(from+'T00:00:00Z');t<=Date.parse(to+'T00:00:00Z');t+=864e5){var wd=new Date(t).getUTCDay();if(wd&&wd<6)o.push({d:new Date(t).toISOString().slice(0,10),c:150,h:152,l:148});}return o;}
function __vi(view,d){for(var i=0;i<view.length;i++)if(view[i].d===d)return i;return -1;}
grp('earnings line', function(){
  var view=__wdays('2023-06-01','2025-06-30'),L=view.length,C=DESK_IDEA_CFG.earn;
  var fin={status:'ok',ccy:'SEK',fiscalYearEnd:'12-31',annual:[{year:2022,eps:5},{year:2023,eps:6},{year:2024,eps:8}],estimates:[{year:2024,eps:99,n:1},{year:2025,eps:10,n:30},{year:2026,eps:11,n:25}]};
  var o={pe:20,peSrc:'pe5',ccy:'SEK',fx:{SEK:1,USD:10},futureBars:C.futureBars,scaleX:C.scaleX};
  var M=chartEarningsModel(view,fin,o);
  __eq('state ok', M.state, 'ok');
  __eq('факт: точки на концах FY (31.12.2023 — воскресенье → бар 01.01.2024), значение = EPS × P/E', M.hist.filter(function(p){return !p.interp;}).map(function(p){return [p.time,p.value,p.eps,p.year];}), [['2024-01-01',120,6,2023],['2024-12-31',160,8,2024]]);
  __eq('точка до окна → интерполированная точка на первом баре окна', [M.hist[0].i,M.hist[0].time,!!M.hist[0].interp], [0,view[0].d,true]);
  __approx('…по календарным дням между FY2022 и FY2023', M.hist[0].value, 100+20*152/365, 1e-9);
  __eq('индексы факта — бары окна', [M.hist[1].i,M.hist[2].i], [__vi(view,'2024-01-01'),__vi(view,'2024-12-31')]);
  __eq('прогноз: первая точка = последняя фактическая, дальше estimates (прогноз ≤ последнего факта отброшен)', M.fcst.map(function(p){return [p.time,p.value,p.n||null];}), [['2024-12-31',160,null],['2025-12-31',200,30],['2026-12-31',220,25]]);
  __eq('прогноз после последнего бара — на будущих слотах', [M.fcst[1].i>=L,M.fcst[2].i,M.fcst[2].i-L], [true,L+M.future.length-1,M.future.length-1]);
  var F=M.future;
  __ok('будущие слоты — рабочие дни после последнего бара, строго возрастают', F[0].time==='2025-07-01' && F.every(function(s,i){var wd=new Date(s.time+'T00:00:00Z').getUTCDay();return wd>0&&wd<6&&(!i||F[i-1].time<s.time);}));
  __eq('слоты покрывают последний FY прогноза и не длиннее futureBars', [F[F.length-1].time,F.length<=C.futureBars], ['2026-12-31',true]);
  __ok('время серий строго возрастает', [M.hist,M.fcst,M.line].every(function(S){return S.every(function(p,i){return !i||S[i-1].i<p.i;});}));
  __eq('линия для легенды: факт + прогноз без повтора стыка', M.line.map(function(p){return p.value;}).slice(1), [120,160,200,220]);
  var a=__vi(view,'2024-12-31'),b=M.fcst[1].i,at=chartEarnAt(M,L-1);
  __approx('значение на последнем баре — интерполяция по индексу к прогнозу', at.value, 160+40*(L-1-a)/(b-a), 1e-9);
  __eq('…это отрезок прогноза к FY2025 (30 аналит.)', [at.fcst,at.at.year,at.at.n], [true,2025,30]);
  __eq('на факте — не прогноз, точное значение', [chartEarnAt(M,a).value,chartEarnAt(M,a).fcst], [160,false]);
  __eq('вне линии → null', [chartEarnAt(M,-1),chartEarnAt(M,L+F.length)], [null,null]);
  __approx('last: отклонение цены от линии, %', M.last.dev, (150/at.value-1)*100, 1e-9);
  __eq('fit: линия в пределах цены × scaleX; заметок нет', [M.fit,M.notes], [true,[]]);
  // FY-конец в выходной → ближайший следующий бар.
  var v2=__wdays('2024-01-02','2025-03-31'),M2=chartEarningsModel(v2,{status:'ok',ccy:'SEK',fiscalYearEnd:'06-30',annual:[{year:2024,eps:6}],estimates:[]},o);
  __eq('FY до 30.06.2024 (вс) → бар 01.07.2024; нет прогноза — нет будущего', [M2.hist.map(function(p){return p.time;}),M2.future.length,M2.notes], [['2024-07-01'],0,['no-fcst']]);
  __eq('без fiscalYearEnd — 31.12', chartEarningsModel(v2,{status:'ok',annual:[{year:2024,eps:4}]},o).hist[0].time, '2024-12-31');
  // Обе точки до окна.
  var v3=__wdays('2025-03-03','2025-06-30'),M3=chartEarningsModel(v3,{status:'ok',annual:[{year:2023,eps:5},{year:2024,eps:6}]},o);
  __eq('обе точки факта до окна (без прогноза) → нет точек, state nowin', [M3.hist,M3.state], [[],'nowin']);
  var M3f=chartEarningsModel(v3,{status:'ok',annual:[{year:2023,eps:5},{year:2024,eps:6}],estimates:[{year:2025,eps:9}]},o);
  __eq('факт до окна + прогноз → пунктир входит с левого края', [M3f.hist.length,M3f.fcst[0].i,!!M3f.fcst[0].interp,M3f.state], [0,0,true,'ok']);
  // Предел futureBars.
  var M4=chartEarningsModel(view,fin,Object.assign({},o,{futureBars:10}));
  __eq('futureBars 10 → 10 слотов, прогноз за пределом — интерполяция на последнем слоте', [M4.future.length,M4.fcst[M4.fcst.length-1].i,!!M4.fcst[M4.fcst.length-1].interp], [10,L+9,true]);
  // Убыток.
  var M5=chartEarningsModel(view,{status:'ok',annual:[{year:2023,eps:5},{year:2024,eps:-2}],estimates:[{year:2025,eps:3}]},o);
  __eq('eps ≤ 0 → разрыв (value null), прогноз без стыка с убыточным годом', [M5.hist.map(function(p){return p.value;}),M5.fcst.length,M5.fcst[0].year], [[100,null],1,2025]);
  __eq('на разрыве значения нет', chartEarnAt(M5,__vi(view,'2024-12-31')-1), null);
  __eq('все годы убыточные → loss', chartEarningsModel(view,{status:'ok',annual:[{year:2023,eps:-1},{year:2024,eps:0}],estimates:[{year:2025,eps:3}]},o).state, 'loss');
  __eq('fin null → nofin; ошибка → nofin + error; нет EPS → noeps', [chartEarningsModel(view,null,o).state,chartEarningsModel(view,{status:'error'},o).notes,chartEarningsModel(view,{status:'nodata',annual:[]},o).state,chartEarningsModel(view,{status:'ok',annual:[{year:2024,revenue:5,eps:null}]},o).state], ['nofin',['error'],'noeps','noeps']);
  // Валюта.
  var fu={status:'ok',ccy:'USD',annual:[{year:2024,eps:2}]};
  __eq('валюта отчётности ≠ торгов без курса → ccy', chartEarningsModel(view,fu,Object.assign({},o,{fx:{SEK:1}})).state, 'ccy');
  __eq('с курсом — пересчёт: 2 USD × 10 × P/E 20 = 400 kr', chartEarningsModel(view,fu,o).hist[0].value, 400);
  __approx('USD-отчётность, торги в GBP (ANTO.L): курс USD/GBP', chartEarningsModel(view,fu,Object.assign({},o,{ccy:'GBP',fx:{SEK:1,USD:10,GBP:12.5}})).hist[0].value, 2*0.8*20, 1e-9);
  __approx('отчётность в пенсах (GBp) → фунты', chartEarningsModel(view,{status:'ok',ccy:'GBp',annual:[{year:2024,eps:150}]},Object.assign({},o,{ccy:'GBP'})).hist[0].value, 1.5*20, 1e-9);
  __eq('нет P/E → nope (и без отчётности: desk её тогда не запрашивает)', [chartEarningsModel(view,fin,Object.assign({},o,{pe:null})).state,chartEarningsModel(view,null,Object.assign({},o,{pe:0})).state], ['nope','nope']);
  __eq('P/E текущий → заметка «только динамика»', chartEarningsModel(view,fin,Object.assign({},o,{peSrc:'cur'})).notes, ['pe-cur']);
  var M6=chartEarningsModel(view,fin,Object.assign({},o,{pe:60}));
  __eq('линия далеко от цены → вне автомасштаба', [M6.fit,M6.notes], [false,['off-scale']]);
  __ok('заметка под графиком: отклонение и источник P/E', chartEarnNote(M,Object.assign({fin:fin},o)).indexOf('ниже линии прибыли · P/E 20')>0);
  __ok('заметка: убыточна / нет P/E в пределах', chartEarnNote({state:'loss',notes:[]},o).indexOf('убыточна')>0 && chartEarnNote({state:'nope',notes:[]},{peMin:5,peMax:60}).indexOf('5–60')>0);
});
grp('deskEarnPe', function(){
  var V={AAA:{sector:'Tech',pe:30,hist:{pe5:22,pe3:25}},BBB:{sector:'Tech',pe:12,hist:{pe3:70}},CCC:{sector:'Tech',pe:8},DDD:{sector:'Solo',pe:2},'INVE B':{sector:'Fin',pe:15}};
  var S={Tech:{pe:18,n:3},Solo:{pe:2,n:1},Fin:{pe:14,n:1}};
  __eq('приоритет: медиана 5 лет', deskEarnPe('aaa',V,S), {pe:22,src:'pe5'});
  __eq('pe3 вне [peMin, peMax] → медиана сектора', deskEarnPe('BBB',V,S), {pe:18,src:'sector'});
  __eq('сектор из 1 бумаги не годится → текущий', deskEarnPe(' inve b ',V,S), {pe:15,src:'cur'});
  __eq('ничего подходящего → null; нет бумаги → null', [deskEarnPe('DDD',V,S),deskEarnPe('ZZZ',V,S)], [null,null]);
  var C=DESK_IDEA_CFG.earn,m0=C.peMax;
  try{ C.peMax=24; __eq('peMax 24 → pe5 22 проходит', deskEarnPe('AAA',V,S).src, 'pe5'); C.peMax=20; __eq('peMax 20 → pe5/pe3/текущий отпадают → сектор 18', deskEarnPe('AAA',V,S), {pe:18,src:'sector'}); }
  finally{ C.peMax=m0; }
  __eq('конфиг восстановлен', C.peMax, m0);
});
grp('desk glossary: линия прибыли', function(){
  var it=deskGlossItem('earn-line'),X=deskGlossEarnEx();
  __ok('запись earn-line в разделе «Акция»', it && it.sec==='stock');
  __eq('пример считается моделью: 144 → 180 → 216', X.pts.map(function(p){return p.value;}), [144,180,216]);
  __ok('числа в тексте = результат модели', __glNorm(deskGlossText(it.ex)).indexOf('линия 144 → 180 → 216')>=0);
  __ok('подсказка — первое предложение', deskGlossTip('earn-line').indexOf('Где была бы цена')===0);
  var C=DESK_IDEA_CFG.earn,m0=C.peMax;
  try{ C.peMax=45; __ok('пороги в тексте — из DESK_IDEA_CFG.earn', __glNorm(deskGlossText(it.use)).indexOf('5–45')>=0); } finally{ C.peMax=m0; }
});
// ── 📖 Словарь Trade Desk (G1, plans/desk-glossary.md) ──
function __glNorm(s){ return String(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' '); }   // nbsp тысяч → пробел
grp('desk glossary: записи', function(){
  var I=DESK_GLOSS.items,ids={},secs={},dup=[],bad=[];
  DESK_GLOSS.secs.forEach(function(s){secs[s.id]=1;});
  I.forEach(function(it){ if(ids[it.id])dup.push(it.id); ids[it.id]=1;
    if(!/^[a-z0-9-]+$/.test(it.id)||!secs[it.sec]||!deskGlossText(it.t)||!deskGlossText(it.d))bad.push(it.id); });
  __eq('id уникальны', dup, []);
  __eq('у каждой записи kebab-id, существующий раздел, термин и описание', bad, []);
  __ok('перенесены все термины артефакта (93, «Действие по позиции» разбито на act-*)', I.length>=93, 'n='+I.length);
  var broken=[];
  I.forEach(function(it){
    var f=[it.t,it.lbl,it.d,it.f,it.ex,it.use].concat((it.rows||[]).reduce(function(a,r){return a.concat(r);},[]));
    f.forEach(function(x){ if(x==null)return; var s=deskGlossText(x); if(!s||/undefined|NaN|\[object/.test(s))broken.push(it.id); });
  });
  __eq('каждое поле разворачивается в непустую строку без undefined/NaN', broken, []);
  var miss=[];
  Object.keys(DK_V).forEach(function(k){if(!deskGlossItem('v-'+k))miss.push('v-'+k);});
  Object.keys(DK_PH).forEach(function(k){if(!deskGlossItem('ph-'+k))miss.push('ph-'+k);});
  Object.keys(DK_FLAG).forEach(function(k){if(!deskGlossItem('fl-'+k))miss.push('fl-'+k);});
  Object.keys(DK_ACT).forEach(function(k){if(!deskGlossItem('act-'+k))miss.push('act-'+k);});
  __eq('покрытие меток DK_V/DK_PH/DK_FLAG/DK_ACT', miss, []);
});
grp('desk glossary: пороги из конфига', function(){
  var C=SIG.CFG,W=DESK_IDEA_CFG.whatIf,rr0=C.rrMin,w0=W.weightPct,e0=C.earnDays;
  __ok('rr: по умолчанию rrMin 2,0', deskGlossText(deskGlossItem('rr').use).indexOf('≥ 2,0 — можно входить')>=0);
  try{
    C.rrMin=2.5; W.weightPct=12; C.earnDays=5;
    __ok('rr: rrMin 2.5 → «≥ 2,5» в тексте', deskGlossText(deskGlossItem('rr').use).indexOf('≥ 2,5 — можно входить')>=0);
    __ok('v-buy: rrMin 2.5 в условиях', __glNorm(deskGlossText(deskGlossItem('v-buy').rows[0][1])).indexOf('≥ 2,5')>=0);
    var wi=deskGlossItem('what-if'); __ok('what-if: weightPct 12 → «больше 12 %»', __glNorm(deskGlossText(wi.rows[1][1])).indexOf('больше 12 % капитала')>=0);
    __ok('fl-earnings: earnDays 5', deskGlossText(deskGlossItem('fl-earnings').d).indexOf('5 дня')>=0);
    __ok('история: weightPct 12 в примере', __glNorm(deskGlossStoryHTML()).indexOf('порог 12 %')>=0);
  } finally { C.rrMin=rr0; W.weightPct=w0; C.earnDays=e0; }
  __eq('конфиг восстановлен', [C.rrMin,W.weightPct,C.earnDays], [rr0,w0,e0]);
  __ok('лимит книги — из deskNorm по умолчанию', __glNorm(deskGlossText(deskGlossItem('book-risk').f)).indexOf('капитал × '+deskNorm({}).riskCapPct+' %')>=0);
});
grp('desk glossary: сквозной пример считается кодом', function(){
  var S=deskGlossStory(),P=S.plan;
  __eq('стоп/цель/R/R', [P.stop,P.target,P.rr], [96,109,2.25]);
  __eq('источник стопа — S60 с буфером и минимумом 1·ATR', P.stopSrc, 'S60 − 0.5·ATR → мин. 1·ATR');
  __eq('риск 2 000 → 500 шт, лимит книги 12 000', [S.riskKr,P.qty,S.capKr], [2000,500,12000]);
  __eq('у уровня и вердикт buy', [!!S.near,S.verdict], [true,'buy']);
  __eq('«Что если?»: доля 25 % → 190 шт, 1R = 760', [S.w1,S.qty2,S.risk2], [25,190,760]);
  __eq('действия лестницы: б/у → фиксировать → трейлинг', [S.acts.be,S.acts.take,S.acts.trail], ['be','take','trail']);
  __eq('трейл 104, итог 1,625R = +1 235 kr', [S.trail,S.totalR,Math.round(S.totalKr)], [104,1.625,1235]);
  __approx('лимит под R/R 2 = 98,67', S.limit.entry, 98.6667, 1e-3);
  __approx('…и он равен SIG.limitForRR', S.limit.entry, SIG.limitForRR(107,94.5,SIG.CFG.rrGood), 1e-12);
  var H=__glNorm(deskGlossStoryHTML(S));
  ['стоп 96','= 2,25','500 шт','2 000 kr на сделку','12 000 kr','новый стоп 104','1,625R','+1 235 kr','760','190 шт'].forEach(function(x){ __ok('в тексте примера: '+x, H.indexOf(x)>=0, 'нет «'+x+'»'); });
  __ok('лимит 98,67 — в тексте записи limit-rr', __glNorm(deskGlossText(deskGlossItem('limit-rr').ex)).indexOf('= 98,67')>=0);
  __ok('пример запись rr: 9 ÷ 4 = 2,25', __glNorm(deskGlossText(deskGlossItem('rr').ex)).indexOf('9 ÷ 4 = 2,25')>=0);
  __ok('справедливая: 20 + 57,5 + 35 = 112,5', __glNorm(deskGlossText(deskGlossItem('fair-value').ex)).indexOf('20 + 57,5 + 35 = 112,5')>=0);
});
grp('desk glossary: поиск', function(){
  var n=DESK_GLOSS.items.length,ids=function(q){return deskGlossFind(q).map(function(x){return x.id;});};
  __eq('пусто → все', [deskGlossFind('').length,deskGlossFind('   ').length], [n,n]);
  __ok('«атр» → ATR (через aka)', ids('атр').indexOf('atr')>=0);
  __ok('регистр не важен: «ATR» = «atr»', ids('ATR').join()===ids('atr').join());
  __ok('«трейлинг» → ≥ 2 записей', deskGlossFind('трейлинг').length>=2, 'n='+deskGlossFind('трейлинг').length);
  __ok('ё = е: «отчет» находит «отчёт скоро»', ids('ОТЧЕТ СКОРО').indexOf('fl-earnings')>=0);
  __eq('несуществующее → 0', deskGlossFind('zzqxj').length, 0);
  __ok('поиск по формуле', ids('(цель + 2 × стоп)').indexOf('limit-rr')>=0);
  __ok('поиск по строке rows', ids('генерал').length===0 && ids('гистограмма').indexOf('backtest')>=0);
});
grp('desk glossary: рендер', function(){
  var H=deskGlossHTML(''),miss=[];
  DESK_GLOSS.items.forEach(function(it){ if(H.indexOf('id="dkg-'+it.id+'"')<0)miss.push(it.id); });
  __eq('все записи — якоря dkg-<id>', miss, []);
  __ok('разделы — якоря dkgs-<id> и пример', DESK_GLOSS.secs.every(function(s){return H.indexOf('id="dkgs-'+s.id+'"')>=0;}) && H.indexOf('id="dkgs-story"')>=0);
  __ok('нет <script', !/<script/i.test(H));
  var Q=deskGlossHTML('трейлинг');
  __ok('с поиском — без сквозного примера', Q.indexOf('dkgs-story')<0 && Q.indexOf('id="dkg-trail"')>=0);
  __ok('ничего не найдено → подсказка', deskGlossHTML('zzqxj').indexOf('Ничего не найдено')>=0);
  __eq('счётчик', [deskGlossCount(''),deskGlossCount('zzqxj')], [DESK_GLOSS.items.length+' терминов','найдено 0 из '+DESK_GLOSS.items.length]);
  __ok('метка вердикта — класс приложения', deskGlossItemHTML(deskGlossItem('v-buy')).indexOf('dk-pill v-buy')>=0);
});
// ── Подсказки на экранах (G2) ──
grp('desk glossary: подсказки на экранах (G2)', function(){
  // Литералы в исходнике desk.js: data-g="…", dkG('…'), dkGi('…') — каждый id должен быть записью словаря.
  var src=rd('desk.js'),re=/\bdkGi?\('([a-z0-9-]+)'\)|data-g="([a-z0-9-]+)"/g,m,lit=[],miss=[];
  while((m=re.exec(src)))lit.push(m[1]||m[2]);
  __ok('в desk.js размечены подсказки', lit.length>=60, 'n='+lit.length);
  lit.forEach(function(id){ if(!deskGlossItem(id)&&miss.indexOf(id)<0)miss.push(id); });
  __eq('каждый литерал data-g / dkG / dkGi — запись словаря', miss, []);
  // Метки, id которых строятся из ключей словарей desk.js.
  var ids=function(h){var r=/data-g="([^"]+)"/g,x,o=[];while((x=r.exec(h)))o.push(x[1]);return o;},dyn=[];
  Object.keys(DK_V).forEach(function(k){dyn=dyn.concat(ids(dkPill(k,true)),ids(dkPill(k,false)));});
  Object.keys(DK_PH).forEach(function(k){dyn=dyn.concat(ids(dkPhase({phase:{key:k,label:'x'},trendUp:true})));});
  dyn=dyn.concat(ids(dkFlags({flags:Object.keys(DK_FLAG)})));
  Object.keys(DK_ACT).forEach(function(k){dyn=dyn.concat(ids(dkActPill(k)));});
  dyn=dyn.concat(ids(dkSide('long')),ids(dkSide('short')),ids(dkRiskMeter({level:3,word:'x'})),ids(dkRiskMeter(null)));
  __ok('метки дают id для всех ключей', dyn.length>=Object.keys(DK_V).length*2+Object.keys(DK_PH).length+Object.keys(DK_ACT).length+4);
  __eq('id меток — записи словаря', dyn.filter(function(id){return !deskGlossItem(id);}), []);
  __ok('dkPill(buy) → data-g="v-buy"', dkPill('buy').indexOf('data-g="v-buy"')>=0);
  __ok('«Перегрев» и «Сократить» — одна запись v-trim', ids(dkPill('trim',false)).join()==='v-trim' && ids(dkPill('trim',true)).join()==='v-trim');
  __ok('неизвестный вердикт/действие → v-wait / act-hold', dkPill('zz').indexOf('data-g="v-wait"')>=0 && dkActPill('zz').indexOf('data-g="act-hold"')>=0);
  __ok('фаза, флаг, действие, сторона, риск', dkPhase({phase:{key:'up',label:'Аптренд'},trendUp:true}).indexOf('data-g="ph-up"')>=0 && dkFlags({flags:['wide']}).indexOf('data-g="fl-wide"')>=0
    && dkActPill('trail').indexOf('data-g="act-trail"')>=0 && dkSide('short').indexOf('data-g="side"')>=0 && dkRiskMeter({level:2,word:'x'}).indexOf('data-g="risk-level"')>=0);
  __ok('фаза без title (подсказка вместо системной)', dkPhase({phase:{key:'up',label:'x'},trendUp:true}).indexOf('title=')<0);
  var gi=dkGi('rr');
  __ok('ⓘ — кнопка gtip с data-g и подписью', /^<button type="button" class="dk-gi" data-a="gtip" data-g="rr"/.test(gi) && gi.indexOf('aria-label=')>0 && gi.indexOf('aria-controls="dkTip"')>0);
  // Текст подсказки.
  __eq('rr: первое предложение описания без разметки', deskGlossTip('rr'), 'Сколько можно заработать до цели на каждую единицу риска до стопа.');
  __eq('короткое первое предложение — вместе со вторым', deskGlossTip('fl-knife'), 'Фаза «Падающий нож». Уровень риска +1.');
  __eq('разметка и сущности сняты', deskGlossTip('fl-half'), 'Покупка при неподтверждённом тренде (SMA50 < SMA200): размер делится пополам.');
  __eq('пороги — из конфига', deskGlossTip('fl-wide'), 'Стоп дальше '+String(SIG.CFG.wideAtr).replace('.',',')+'·ATR от входа.');
  var badTip=[];
  DESK_GLOSS.items.forEach(function(it){ var t=deskGlossTip(it.id); if(!t||t.length>320||/[<>]\w|&[a-z#0-9]+;|undefined|NaN/.test(t))badTip.push(it.id+':'+t.length); });
  __eq('у каждой записи — подсказка: непустая, ≤ 320 знаков, без HTML', badTip, []);
  var H=deskGlossTipHTML('pl-open');
  __ok('HTML подсказки: термин экранирован, кнопка «Подробнее»', H.indexOf('>P&amp;L открытых<')>=0 && H.indexOf('data-ta="more"')>=0 && H.indexOf('id="dkTipT"')>=0);
  __ok('HTML подсказки: без <script и без неэкранированного <', !/<script/i.test(H) && deskGlossTipHTML('fl-half').indexOf('SMA50 &lt; SMA200')>=0);
  __eq('неизвестный id → пусто', [deskGlossTip('zz'),deskGlossTipHTML('zz')], ['','']);
  // Позиция всплывашки.
  __eq('под меткой, по центру', deskTipPos({left:100,right:140,top:200,bottom:220,width:40,height:20},200,80,1000,800), {left:20,top:226,below:true});
  __eq('снизу не помещается → над меткой', deskTipPos({left:100,right:140,top:700,bottom:720,width:40,height:20},200,80,1000,800), {left:20,top:614,below:false});
  __eq('не помещается ни снизу, ни сверху → снизу', deskTipPos({left:100,right:140,top:40,bottom:60,width:40,height:20},200,780,1000,800).below, true);
  __eq('у правого края — отступ 8 px', deskTipPos({left:980,right:1000,top:10,bottom:30,width:20,height:20},200,80,1000,800).left, 792);
  __eq('у левого края — отступ 8 px', deskTipPos({left:0,right:10,top:10,bottom:30,width:10,height:20},200,80,1000,800).left, 8);
  __eq('телефон 400 px: подсказка во всю ширину минус отступы', deskTipPos({left:300,right:360,top:100,bottom:120,width:60,height:20},384,90,400,800).left, 8);
});

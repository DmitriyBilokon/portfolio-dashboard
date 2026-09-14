// E2 (plans/ledger-model-e.md §4.E2 п.5): паритет контракта строки v3-вкладки клиент ↔ воркер.
// Подключается в ОБА сьюта перед кейсами (run-app.js и run-worker.js): каждый сверяет СВОИ RC / COLN / COLN_RE / colOf
// с этой таблицей — расхождение клиента и воркера (как было до E2: /sma.?50/ у клиента против /sma.?50$/ у воркера)
// ломает тест в том сьюте, где копия отстала. Таблицу же возьмёт блок D.
var PARITY_RC = {n:0,name:1,tk:2,country:3,sector:4,type:5,qty:6,price:7,ccy:8,buy:9,day:10,pl:11,plPct:12,value:13,xdag:14,pay:15};
var PARITY_COLN = {s50:'SMA 50',s100:'SMA 100',s200:'SMA 200',sup:'Поддержка',res:'Сопротивление',tg:'Аналит. таргет',tg3:'Таргет 3м',
  pe:'P/E',ps:'P/S',dy:'Дивид. %',beta:'Beta',roe:'ROE',de:'D/E',revg:'Рост выручки',payout:'Payout',rev:'Выручка TTM',cap:'Кап-я',reco:'Реком. скоринг'};
var PARITY_RE = ['s50:sma.?50$/i', 's100:sma.?100$/i', 's200:sma.?200$/i'];
// Префиксы: сид Портфеля 3.0 (бандл, новые аккаунты) и имена Портфеля 2.0 (облачные вкладки владельца).
var PARITY_PREFIX_SEED = ['#','Компания','Тикер','Страна','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','1д %','Прибыль','От покупки %','Стоимость','X-dag','Выплата'];
var PARITY_PREFIX_PF2 = ['#','Компания','Тикер','Страна','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','1д %','Прибыль kr','От покупки %','Стоимость kr','X-dag','Выплата дивид.'];
var PARITY_TAIL_HEAD = ['SMA 50','SMA 100','SMA 200','Целевая kr','Цель %','Действие','Аналит. таргет','Поддержка','Сопротивление','Период SMA'];
// Раскладки заголовков реальных вкладок (копия ledger владельца 2026-09-12: общий порядок хвоста, S&P 500 и Nasdaq 100 —
// «Реком. скоринг» в другом месте) и сид → ожидаемые индексы колонок хвоста. real — раскладка из данных (на ней старые
// матчеры клиента и воркера обязаны давать то же, что COLN_RE).
var PARITY_HEADS = [
  {name:'общий порядок (PF3, индексы, семейные)', real:true,
   headers:PARITY_PREFIX_PF2.concat(PARITY_TAIL_HEAD,['P/E','P/S','Дивид. %','Beta','ROE','D/E','Рост выручки','Payout','Выручка TTM','Кап-я','Реком. скоринг','Таргет 3м']),
   expect:{s50:16,s100:17,s200:18,sup:23,res:24,tg:22,tg3:37,pe:26,ps:27,dy:28,beta:29,roe:30,de:31,revg:32,payout:33,rev:34,cap:35,reco:36}},
  {name:'S&P 500', real:true,
   headers:PARITY_PREFIX_PF2.concat(PARITY_TAIL_HEAD,['P/E','P/S','Дивид. %','Реком. скоринг','Beta','ROE','D/E','Рост выручки','Payout','Выручка TTM','Кап-я','Таргет 3м']),
   expect:{s50:16,s100:17,s200:18,sup:23,res:24,tg:22,tg3:37,pe:26,ps:27,dy:28,reco:29,beta:30,roe:31,de:32,revg:33,payout:34,rev:35,cap:36}},
  {name:'Nasdaq 100', real:true,
   headers:PARITY_PREFIX_PF2.concat(PARITY_TAIL_HEAD,['Реком. скоринг','P/E','P/S','Дивид. %','Beta','ROE','D/E','Рост выручки','Payout','Выручка TTM','Кап-я','Таргет 3м']),
   expect:{s50:16,s100:17,s200:18,sup:23,res:24,tg:22,tg3:37,reco:26,pe:27,ps:28,dy:29,beta:30,roe:31,de:32,revg:33,payout:34,rev:35,cap:36}},
  {name:'сид Портфеля 3.0', real:true,
   headers:PARITY_PREFIX_SEED.concat(['SMA 50','SMA 100','SMA 200','Целевая','Цель %','Действие']),
   expect:{s50:16,s100:17,s200:18,sup:-1,res:-1,tg:-1,tg3:-1,pe:-1,reco:-1}},
  {name:'варианты SMA (матчер)', real:false,
   headers:['SMA 500','SMA50','sma_100','Период SMA','Sma-200','SMA 200'],
   expect:{s50:1,s100:2,s200:4}},
  {name:'нет headers', real:false, headers:null, expect:{s50:-1,sup:-1,tg:-1}},
];
// Проверка одного сьюта: его объявления контракта против таблицы.
function parityRun(suite, rc, coln, colnRe, colOfFn){
  __eq(suite+' parity: RC', rc, PARITY_RC);
  __eq(suite+' parity: COLN', coln, PARITY_COLN);
  __eq(suite+' parity: COLN_RE', Object.keys(colnRe).map(function(k){ return k+':'+colnRe[k].source+'/'+colnRe[k].flags; }), PARITY_RE);
  PARITY_HEADS.forEach(function(t){
    var d = t.headers ? {headers:t.headers} : {}, got = {};
    Object.keys(t.expect).forEach(function(id){ got[id] = colOfFn(d, id); });
    __eq(suite+' parity: colOf '+t.name, got, t.expect);
  });
  // Старые матчеры (клиент /sma.?N/i, воркер /sma.?50$/i и /аналит/i, /таргет 3м/i) на реальных раскладках дают то же.
  PARITY_HEADS.filter(function(t){ return t.real; }).forEach(function(t){
    var h = t.headers, fi = function(re){ return h.findIndex(function(x){ return re.test(x); }); };
    __eq(suite+' parity: old matchers = colOf ('+t.name+')',
      [fi(/sma.?50/i), fi(/sma.?100/i), fi(/sma.?200/i), fi(/sma.?50$/i), fi(/аналит/i), fi(/таргет 3м/i)],
      [colOfFn({headers:h},'s50'), colOfFn({headers:h},'s100'), colOfFn({headers:h},'s200'), colOfFn({headers:h},'s50'), colOfFn({headers:h},'tg'), colOfFn({headers:h},'tg3')]);
  });
}

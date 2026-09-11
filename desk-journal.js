// P5a: локальный слой журнала результатов выбора (plans/stock-selection-ux.md §7/§10); P5b — расчёт результата
// (условный вход, горизонты, индекс, комиссия) и сводка по группам. Чистые функции не читают localStorage/
// currentUser/Date.now/глобалы приложения — серии свечей, время, модель комиссии и конфигурация приходят
// аргументами. Тонкие обёртки внизу файла читают/пишут localStorage под ключом аккаунта; UI и загрузка свечей —
// в desk.js (кнопка «Отслеживать результат» в «Решении», «Журнал → Наблюдения»).
const DESK_JOURNAL_V=1;
// Лимит зафиксирован перед кодом P5a (§7): 500 записей ИЛИ 500 КБ JSON — обе границы дают большой запас
// (типичная запись ~0,3–0,5 КБ) при пространстве аккаунта на этом устройстве, без риска исчерпать квоту
// localStorage мобильного браузера. Формат экспорта — JSON-файл с тем же конвертом {v, exportedAt, items}.
// P5b: minGroup — минимум завершённых наблюдений группы для распределения (§7); settleMin — сколько минут после
// местного закрытия сессии должно пройти к моменту загрузки серии, чтобы дневной бар считался окончательным
// (аукцион закрытия + кэши воркера и браузера до ~20 мин); endStaleDays — серия без новых баров дольше этого числа
// календарных дней: история бумаги закончилась (делистинг); adjTol — допуск сверки цены входа со свежей серией
// (сплит/корректировка задним числом); jumpX — дневной скачок цены, после которого сопоставимость цен не подтверждена
// (необработанный сплит 2:1 выглядит как ×0,5).
const DESK_JOURNAL_CFG={maxRecords:500,maxBytes:500000,horizons:[20,60,120],retainDays:365,
  minGroup:30,settleMin:60,endStaleDays:30,adjTol:0.01,jumpX:1.8};

function deskJournalBytes(items){try{return JSON.stringify(items||[]).length;}catch(e){return Infinity;}}

// Дедуп по бумаге/версии отбора/UTC-дате записи (§7): повторная попытка отследить ту же
// идею в тот же день той же версией модели не создаёт вторую запись.
function deskJournalDedupKey(r){
  const t=r&&r.recordedAt,d=new Date(t);
  const day=Number.isFinite(t)&&!isNaN(d.getTime())?d.toISOString().slice(0,10):'invalid';
  return (r&&r.key||'')+'|'+(r&&r.selectionVersion||'')+'|'+day;
}

// Неизменяемая запись: время и id — аргументами (ctx), не Date.now()/Math.random() внутри.
function deskJournalRecord(input,ctx){
  const i=input||{},id=ctx&&ctx.id||null,now=ctx&&ctx.now;
  const b=i.benchmark||null;
  return {
    id,recordedAt:Number.isFinite(now)?now:null,
    key:i.key||null,sym:i.sym||null,ccy:i.ccy||null,source:'manual-selection',
    side:i.side==='short'?'short':'long',   // P5b: результат шорта зеркальный; группы лонг/шорт раздельны (§7)
    selectionVersion:i.selectionVersion||null,signalVersion:i.signalVersion||null,
    bucket:i.bucket||null,dimensions:deskSelCopy(i.dimensions!=null?i.dimensions:null),
    observedPrice:typeof i.observedPrice==='number'&&Number.isFinite(i.observedPrice)?i.observedPrice:null,
    observationAsOf:Number.isFinite(i.observationAsOf)?i.observationAsOf:null,
    benchmark:b?{symbol:b.symbol||null,currency:b.currency||null,basis:b.basis||null}:null,
    entry:null,   // условный вход — до появления первого полного бара после записи (P5b)
    horizons:Object.fromEntries(DESK_JOURNAL_CFG.horizons.map(h=>[h,{status:'pending',value:null,completedAt:null}])),
    costAssumptions:i.costAssumptions!=null?deskSelCopy(i.costAssumptions):null,
    status:'pending'};
}

// Добавление в список (чистая — items/cfg аргументами, ничего не пишет). Дубли и превышение
// лимита отклоняются без изменения входного списка; вызывающий (P5b) решает, что показать.
function deskJournalAdd(items,record,cfg){
  cfg=cfg||DESK_JOURNAL_CFG;
  const list=items||[];
  if(list.some(x=>deskJournalDedupKey(x)===deskJournalDedupKey(record)))return {ok:false,reason:'duplicate',items:list};
  if(list.length>=cfg.maxRecords||deskJournalBytes(list.concat([record]))>cfg.maxBytes)return {ok:false,reason:'limit',items:list};
  return {ok:true,items:list.concat([record])};
}

// Только эти поля можно менять после записи (результат/статус, P5b). Остальное — исходные факты, неизменяемы.
const DESK_JOURNAL_MUTABLE=['entry','horizons','status'];
function deskJournalPatch(items,id,patch){
  return (items||[]).map(r=>{
    if(!r||r.id!==id)return r;
    const next=Object.assign({},r);
    Object.keys(patch||{}).forEach(k=>{ if(DESK_JOURNAL_MUTABLE.includes(k))next[k]=patch[k]; });
    return next;
  });
}

function deskJournalQuotaState(items,cfg){
  cfg=cfg||DESK_JOURNAL_CFG;
  const list=items||[],bytes=deskJournalBytes(list);
  return {count:list.length,bytes,maxRecords:cfg.maxRecords,maxBytes:cfg.maxBytes,
    near:bytes>cfg.maxBytes*0.9||list.length>=cfg.maxRecords*0.9,
    atLimit:bytes>=cfg.maxBytes||list.length>=cfg.maxRecords};
}

// Момент завершения записи — позже из известных горизонтов (pending не в счёт).
function deskJournalCompletedAt(r){
  const done=DESK_JOURNAL_CFG.horizons.map(h=>r&&r.horizons&&r.horizons[h]).filter(h=>h&&h.status!=='pending'&&Number.isFinite(h.completedAt));
  return done.length?Math.max.apply(null,done.map(h=>h.completedAt)):null;
}

// Автоматическая ретенция (§7): завершённые — 365 дней после последнего горизонта; pending не удаляются по возрасту.
function deskJournalCleanup(items,now,days){
  days=Number.isFinite(days)?days:DESK_JOURNAL_CFG.retainDays;
  const cutoff=now-days*86400000;
  return (items||[]).filter(r=>{
    if(!r||r.status!=='complete')return true;
    const at=deskJournalCompletedAt(r);
    return at==null||at>cutoff;
  });
}

// Ручной эскейп-клапан при достижении лимита (§7): очистить завершённые СЕЙЧАС, не дожидаясь 365 дней.
// Pending эта функция не трогает ни при каких условиях — вызывающий (P5b) предлагает её только
// вместе с экспортом, никогда молча.
function deskJournalClearCompleted(items){
  return (items||[]).filter(r=>!r||r.status!=='complete');
}

// Строка экспорта — тот же конверт {v, items}, что и хранилище, плюс отметка времени экспорта.
function deskJournalExportJSON(items,now){
  return JSON.stringify({v:DESK_JOURNAL_V,exportedAt:Number.isFinite(now)?now:null,items:items||[]},null,2);
}

// ── P5b: расчёт результата (§7) ─────────────────────────────────────────────
// Сессии бирж по суффиксу символа Yahoo (у USD без суффикса — США): часовой пояс и местные минуты открытия/закрытия
// основной сессии. Дата бара — местная дата сессии, не UTC. Биржа не из таблицы — время сессии неизвестно, вход ждёт.
const DESK_JOURNAL_SESSIONS={
  US:{tz:'America/New_York',open:570,close:960},TO:{tz:'America/Toronto',open:570,close:960},
  ST:{tz:'Europe/Stockholm',open:540,close:1050},HE:{tz:'Europe/Helsinki',open:600,close:1110},
  CO:{tz:'Europe/Copenhagen',open:540,close:1020},OL:{tz:'Europe/Oslo',open:540,close:985},
  DE:{tz:'Europe/Berlin',open:540,close:1050},PA:{tz:'Europe/Paris',open:540,close:1050},AS:{tz:'Europe/Amsterdam',open:540,close:1050},
  BR:{tz:'Europe/Brussels',open:540,close:1050},MI:{tz:'Europe/Rome',open:540,close:1050},MC:{tz:'Europe/Madrid',open:540,close:1050},
  SW:{tz:'Europe/Zurich',open:540,close:1050},VI:{tz:'Europe/Vienna',open:540,close:1050},
  L:{tz:'Europe/London',open:480,close:990},IR:{tz:'Europe/Dublin',open:480,close:990},LS:{tz:'Europe/Lisbon',open:480,close:990}};
// Индекс фиксируется при записи (§7): USD — S&P 500, SEK — OMXS30; у остальных валют — только абсолютный результат.
const DESK_JOURNAL_BENCH={USD:'^GSPC',SEK:'^OMX'},DESK_JOURNAL_INDEX_SESSION={'^GSPC':'US','^OMX':'ST'};
function deskJournalSession(sym,ccy){
  const s=String(sym||'').trim().toUpperCase();if(!s)return null;
  if(DESK_JOURNAL_INDEX_SESSION[s])return DESK_JOURNAL_SESSIONS[DESK_JOURNAL_INDEX_SESSION[s]];
  const m=/\.([A-Z]{1,2})$/.exec(s);if(m)return DESK_JOURNAL_SESSIONS[m[1]]||null;
  return !/^\^|=/.test(s)&&String(ccy||'').trim().toUpperCase()==='USD'?DESK_JOURNAL_SESSIONS.US:null;
}
function deskJournalBenchmark(ccy){
  const c=String(ccy||'').trim().toUpperCase(),s=DESK_JOURNAL_BENCH[c]||null;
  return {symbol:s,currency:c||null,basis:s?'price':'absolute'};
}
const _djR=(v,d)=>typeof v==='number'&&Number.isFinite(v)?Math.round(v*Math.pow(10,d))/Math.pow(10,d):null;
// Местные дата и минуты момента ms в поясе tz. Форматтер кэшируется на пояс (создание дорогое, результат от кэша не зависит).
const _djFmt={};
function deskJournalLocal(ms,tz){
  if(!Number.isFinite(ms)||!tz)return null;
  try{
    const f=_djFmt[tz]||(_djFmt[tz]=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
    const p={};f.formatToParts(new Date(ms)).forEach(x=>{p[x.type]=x.value;});
    return {date:p.year+'-'+p.month+'-'+p.day,min:(+p.hour%24)*60+(+p.minute)};
  }catch(e){return null;}
}
const deskJournalDays=(a,b)=>(Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/864e5;
// Серия ?history= ({t — секунды начала бара, c — закрытия, at — когда загружена}) → дневные бары с местной датой.
// done — бар окончательный на момент загрузки: есть следующий бар, местная дата загрузки позже или прошло
// close+settleMin. Незакрытый сегодняшний бар (Yahoo отдаёт его во время сессии) — done:false. Пропущенные дни
// не заполняются: нет бара — нет цены (пропуск не превращается в нулевую доходность).
function deskJournalBars(ser,sess,cfg){
  cfg=cfg||DESK_JOURNAL_CFG;
  if(!ser||!sess||!Array.isArray(ser.t)||!Array.isArray(ser.c)||!Number.isFinite(ser.at))return null;
  const at=deskJournalLocal(ser.at,sess.tz);if(!at)return null;
  const bars=[];
  for(let i=0;i<ser.c.length;i++){
    const c=ser.c[i],t=ser.t[i];if(!(typeof c==='number'&&Number.isFinite(c)&&c>0)||!Number.isFinite(t))continue;
    const L=deskJournalLocal(t*1000,sess.tz),p=bars[bars.length-1];if(!L||p&&L.date<p.date)continue;
    if(p&&L.date===p.date){p.c=c;continue;}   // два бара одной сессии (живой + итоговый) — берём последний
    bars.push({date:L.date,c});
  }
  bars.forEach((b,i)=>{b.done=i<bars.length-1||at.date>b.date||(at.date===b.date&&at.min>=sess.close+cfg.settleMin);});
  return {bars,atDate:at.date};
}
// Бар условного входа (§7): первый, чья сессия началась после записи — до открытия в день записи это бар того же дня,
// во время и после сессии — следующий. Ранее закрытие или праздник причинность не нарушают: бар целиком после записи.
function deskJournalEntryIdx(bars,recordedAt,sess){
  const L=deskJournalLocal(recordedAt,sess.tz);if(!L)return -1;
  const same=L.min<sess.open;
  return (bars||[]).findIndex(b=>b.date>L.date||same&&b.date===L.date);
}
// Условный net после комиссии (§7): сумма зафиксирована при записи (costAssumptions.notional — в валюте бумаги по
// курсу дня записи), комиссия — существующая модель fee(ccy, сумма, isBuy) на вход и на выход. Версия допущений
// записи ≠ текущей — net не считается: пересчёт по новой модели исказил бы сравнение. Не фактическая доходность портфеля.
function deskJournalNet(rec,rawPct,o){
  const c=rec&&rec.costAssumptions,n=c&&c.notional;
  if(!(n>0))return {value:null,why:'no-costs'};
  if(!o||typeof o.fee!=='function')return {value:null,why:'no-fee-model'};
  if(typeof o.costV==='function'&&c.v!==o.costV(rec.ccy))return {value:null,why:'cost-version'};
  const dir=rec.side==='short'?-1:1,x=n*(1+rawPct/100),fee=(a,buy)=>+((o.fee(rec.ccy,a,buy)||{}).total)||0;
  return {value:_djR((dir*(x-n)-fee(n,dir>0)-fee(x,dir<0))/n*100,3),why:null};
}
// Результат одной записи по свечам бумаги и индекса → патч {entry, horizons, status} или null (ничего не изменилось /
// серии бумаги ещё нет). stock/bench — серия {t, c, at} или уже готовые бары deskJournalBars той же биржи (мемо
// вызывающего); bench null — индекс не загружен. o = {now, cfg, fee, costV}.
// Вход фиксируется один раз (закрытие бара входа); завершённый или пропущенный горизонт больше не пересчитывается —
// будущие данные не меняют записанный результат. Результат — ценовая доходность в валюте бумаги без дивидендов, %;
// шорт — зеркально; альфа — минус индекс за те же даты (нет одной из дат — альфы нет). Коды причин — в why.
function deskJournalEval(rec,stock,bench,o){
  o=o||{};const cfg=o.cfg||DESK_JOURNAL_CFG,now=o.now;
  if(!rec||rec.status==='complete'||!Number.isFinite(now))return null;
  const dir=rec.side==='short'?-1:1,H=Object.assign({},rec.horizons||{}),open=h=>!H[h]||H[h].status==='pending';
  const pend=(why,x)=>Object.assign({status:'pending',value:null,completedAt:null,why},x||{});
  const miss=(why,x)=>Object.assign({status:'missing',value:null,completedAt:now,why},x||{});
  const all=f=>cfg.horizons.forEach(h=>{if(open(h))H[h]=f(h);});
  let entry=rec.entry||null;
  const sess=deskJournalSession(rec.sym,rec.ccy);
  if(!sess){entry={status:'pending',why:'session-unknown'};all(()=>pend('entry'));}
  else{
    const S=stock&&Array.isArray(stock.bars)?stock:deskJournalBars(stock,sess,cfg);if(!S)return null;
    const B=S.bars,last=B[B.length-1],ended=!!last&&deskJournalDays(last.date,S.atDate)>cfg.endStaleDays;
    if(!entry||entry.status==='pending'){
      const L=deskJournalLocal(rec.recordedAt,sess.tz),i=L?deskJournalEntryIdx(B,rec.recordedAt,sess):-1;
      if(!L||!B.length||B[0].date>L.date)entry={status:'pending',why:'window'};   // серия не доходит до даты записи
      else if(i<0)entry=ended?{status:'missing',why:'history-ended'}:{status:'pending',why:'wait-session'};
      else if(!B[i].done)entry={status:'pending',why:'bar-open',date:B[i].date};
      else{
        entry={status:'fixed',date:B[i].date,price:B[i].c,fixedAt:now};
        // Цена записи и вход в разном масштабе (сплит между ними, пенсы) — несопоставимо. Сверяем только live-цену
        // не старше суток до записи: цена строки без времени может быть старой, её расхождение со входом — не сплит.
        const op=rec.observedPrice,oa=rec.observationAsOf;
        if(op>0&&Number.isFinite(oa)&&oa<=rec.recordedAt&&rec.recordedAt-oa<=864e5&&(entry.price/op>cfg.jumpX||op/entry.price>cfg.jumpX))entry.warn='observed-mismatch';
      }
      if(entry.status==='missing')all(()=>miss('history-ended'));
      else if(entry.status==='pending')all(()=>pend('entry'));
    }
    if(entry.status==='fixed'){
      const ei=B.findIndex(b=>b.date===entry.date),lastDone=B.reduce((a,b,k)=>b.done?k:a,-1);
      const BB=!(rec.benchmark&&rec.benchmark.symbol)?null:bench&&Array.isArray(bench.bars)?bench:
        deskJournalBars(bench,deskJournalSession(rec.benchmark.symbol,rec.benchmark.currency),cfg);
      cfg.horizons.forEach(h=>{
        if(!open(h))return;
        if(ei<0){H[h]=pend(B.length&&B[0].date>entry.date?'window':'entry-bar-gone');return;}
        if(entry.warn==='observed-mismatch'){H[h]=miss('price-basis');return;}
        const hi=ei+h,hb=B[hi];
        if(!hb||!hb.done){H[h]=ended?miss('history-ended'):pend('wait-bars',{left:Math.max(1,hi-Math.max(lastDone,ei))});return;}
        const raw=(hb.c/B[ei].c-1)*100,val=_djR(dir*raw,3);
        // Цена входа в свежей серии ≠ записанной — ряд пересчитан задним числом (сплит/корректировка): не подтверждено.
        if(Math.abs(B[ei].c/entry.price-1)>cfg.adjTol){H[h]=miss('price-basis',{raw:val,date:hb.date});return;}
        for(let k=ei+1;k<=hi;k++){const q=B[k].c/B[k-1].c;if(q>cfg.jumpX||q<1/cfg.jumpX){H[h]=miss('split-suspect',{raw:val,date:hb.date});return;}}
        let alpha=null,benchPct=null,alphaWhy=rec.benchmark&&rec.benchmark.symbol?null:'no-bench';
        if(!alphaWhy){
          if(!BB){H[h]=pend('bench-loading');return;}
          const I=BB.bars,b0=I.find(b=>b.date===entry.date),b1=I.find(b=>b.date===hb.date),il=I[I.length-1];
          if(b1&&!b1.done||!b1&&(!il||il.date<hb.date)){H[h]=pend('bench-loading');return;}   // серия индекса старше бумаги
          if(b0&&b1&&b0.done){benchPct=(b1.c/b0.c-1)*100;alpha=_djR(dir*(raw-benchPct),3);benchPct=_djR(benchPct,3);}
          else alphaWhy='bench-date';
        }
        const net=deskJournalNet(rec,raw,o);
        H[h]={status:'complete',value:val,alpha,bench:benchPct,alphaWhy,net:net.value,netWhy:net.why,date:hb.date,completedAt:now};
      });
    }
  }
  const status=cfg.horizons.every(h=>!open(h))?'complete':'pending',patch={entry,horizons:H,status};
  return JSON.stringify(patch)===JSON.stringify({entry:rec.entry||null,horizons:rec.horizons||{},status:rec.status})?null:patch;
}
// Сводка по группам (§7): версия отбора · версия SIG · сторона · горизонт — разные правила не смешиваются. Только
// завершённые горизонты; pending и пропуски считаются отдельно (пропуск — не ноль). Распределение (медиана, квартили,
// доля в плюсе, среднее) — только при n ≥ minGroup, иначе «мало данных»; альфа и net — со своим n и тем же порогом.
// stocks — сколько разных бумаг: повторы одной бумаги с перекрывающимися окнами — не независимые испытания.
function deskJournalGroups(items,cfg){
  cfg=cfg||DESK_JOURNAL_CFG;const G={},cmp=(a,b)=>a<b?-1:a>b?1:0;
  (items||[]).forEach(r=>{
    if(!r)return;const side=r.side==='short'?'short':'long';
    cfg.horizons.forEach(h=>{
      const k=[r.selectionVersion||'',r.signalVersion||'',side,h].join('|');
      const g=G[k]||(G[k]={selectionVersion:r.selectionVersion||null,signalVersion:r.signalVersion||null,side,horizon:h,
        vals:[],alphas:[],nets:[],pending:0,missing:{},stocks:{},from:null,to:null});
      const x=r.horizons&&r.horizons[h];
      if(!x||x.status==='pending'){g.pending++;return;}
      if(x.status!=='complete'||typeof x.value!=='number'||!Number.isFinite(x.value)){const w=x.why||'unknown';g.missing[w]=(g.missing[w]||0)+1;return;}
      g.vals.push(x.value);
      if(typeof x.alpha==='number'&&Number.isFinite(x.alpha))g.alphas.push(x.alpha);
      if(typeof x.net==='number'&&Number.isFinite(x.net))g.nets.push(x.net);
      g.stocks[r.key]=1;
      const d0=r.entry&&r.entry.date;if(d0&&(!g.from||d0<g.from))g.from=d0;if(x.date&&(!g.to||x.date>g.to))g.to=x.date;
    });
  });
  const q=(s,p)=>{const i=(s.length-1)*p,j=Math.floor(i);return s[j]+(j+1<s.length?(s[j+1]-s[j])*(i-j):0);};
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,srt=a=>a.slice().sort((x,y)=>x-y);
  return Object.values(G).map(g=>{
    const n=g.vals.length,S=srt(g.vals),A=srt(g.alphas),enough=n>=cfg.minGroup;
    return {selectionVersion:g.selectionVersion,signalVersion:g.signalVersion,side:g.side,horizon:g.horizon,n,pending:g.pending,
      missing:g.missing,missingN:Object.values(g.missing).reduce((a,v)=>a+v,0),stocks:Object.keys(g.stocks).length,from:g.from,to:g.to,enough,
      median:enough?_djR(q(S,0.5),3):null,p25:enough?_djR(q(S,0.25),3):null,p75:enough?_djR(q(S,0.75),3):null,
      mean:enough?_djR(mean(S),3):null,winPct:enough?_djR(S.filter(v=>v>0).length/n*100,1):null,
      alphaN:A.length,alphaMedian:A.length>=cfg.minGroup?_djR(q(A,0.5),3):null,alphaMean:A.length>=cfg.minGroup?_djR(mean(A),3):null,
      netN:g.nets.length,netMean:g.nets.length>=cfg.minGroup?_djR(mean(g.nets),3):null};
  }).sort((a,b)=>cmp(b.selectionVersion||'',a.selectionVersion||'')||cmp(b.signalVersion||'',a.signalVersion||'')||cmp(a.side,b.side)||a.horizon-b.horizon);
}

// ── Ниже — тонкие обёртки над localStorage, пространство аккаунта (как pfBackupKey в app.js). ──
function deskJournalKey(){ return typeof currentUser!=='undefined'&&currentUser?('dash_desk_journal_'+currentUser.id):null; }

// Чтение с причиной: нечитаемый (повреждённый) журнал или конверт другой версии (новый клиент) — error, и все
// обёртки записи отказываются: иначе пустой список при следующей записи молча затёр бы чужие наблюдения.
function deskJournalRead(){
  const k=deskJournalKey(); if(!k)return {items:[],error:'no-account'};
  let s=null; try{s=localStorage.getItem(k);}catch(e){return {items:[],error:(e&&e.name)||'storage-error'};}
  if(s==null)return {items:[],error:null};
  let raw=null; try{raw=JSON.parse(s);}catch(e){return {items:[],error:'corrupt'};}
  if(!raw||!Array.isArray(raw.items))return {items:[],error:'corrupt'};
  return raw.v===DESK_JOURNAL_V?{items:raw.items,error:null}:{items:[],error:'version'};
}
function deskJournalLoad(){ return deskJournalRead().items; }

// Ошибки хранилища (квота и т.п.) возвращаются вызывающему — не проглатываются (§7).
function deskJournalSave(items){
  const k=deskJournalKey(); if(!k)return {ok:false,error:'no-account'};
  try{localStorage.setItem(k,JSON.stringify({v:DESK_JOURNAL_V,items:items||[]}));return {ok:true};}
  catch(e){return {ok:false,error:(e&&e.name)||'storage-error'};}
}

// Анонимные наблюдения не пишутся: без аккаунта — явный отказ, а не молчаливый sink.
function deskJournalRecordAdd(input,ctx){
  const k=deskJournalKey(); if(!k)return {ok:false,reason:'no-account'};
  const R=deskJournalRead(); if(R.error)return {ok:false,reason:'unreadable',error:R.error,items:[]};
  const items=R.items,record=deskJournalRecord(input,ctx);
  const added=deskJournalAdd(items,record,DESK_JOURNAL_CFG);
  if(!added.ok)return added;
  const saved=deskJournalSave(added.items);
  return saved.ok?{ok:true,items:added.items,record}:{ok:false,reason:'storage',error:saved.error,items};
}

function deskJournalCleanupAndSave(now,days){
  const R=deskJournalRead(); if(R.error)return {ok:false,error:R.error,items:[]};
  const items=R.items,kept=deskJournalCleanup(items,now,days);
  if(kept.length===items.length)return {ok:true,removed:0,items};
  const saved=deskJournalSave(kept);
  return saved.ok?{ok:true,removed:items.length-kept.length,items:kept}:{ok:false,error:saved.error,items};
}

function deskJournalClearCompletedAndSave(){
  const R=deskJournalRead(); if(R.error)return {ok:false,error:R.error,items:[]};
  const items=R.items,kept=deskJournalClearCompleted(items);
  if(kept.length===items.length)return {ok:true,removed:0,items};
  const saved=deskJournalSave(kept);
  return saved.ok?{ok:true,removed:items.length-kept.length,items:kept}:{ok:false,error:saved.error,items};
}

// P5b: патчи результата (id → {entry, horizons, status}) на свежепрочитанный список и одна запись. Чтение, патч и
// запись — в одном синхронном проходе: наблюдение, добавленное в другой вкладке до этого вызова, не теряется.
function deskJournalPatchAndSave(patches){
  const ids=Object.keys(patches||{}); if(!ids.length)return {ok:true,changed:0};
  const R=deskJournalRead(); if(R.error)return {ok:false,error:R.error};
  let items=R.items,changed=0;
  ids.forEach(id=>{ if(items.some(r=>r&&r.id===id)){items=deskJournalPatch(items,id,patches[id]);changed++;} });
  if(!changed)return {ok:true,changed:0};
  const saved=deskJournalSave(items);
  return saved.ok?{ok:true,changed,items}:{ok:false,error:saved.error};
}

function deskJournalExportTrigger(items,now){
  const blob=new Blob([deskJournalExportJSON(items,now)],{type:'application/json;charset=utf-8'});
  const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;
  a.download='dash_desk_journal_'+new Date(Number.isFinite(now)?now:Date.now()).toISOString().slice(0,10)+'.json';
  a.click();setTimeout(()=>{try{URL.revokeObjectURL(url);}catch(e){}},1000);
}

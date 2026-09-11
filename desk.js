// 🖥 Trade Desk — единственный интерфейс (S6 редизайна, слой 5 plans/redesign-integration.md; с S7b-3 классики нет,
// флага dash_desk и ?desk=0 тоже — старые значения игнорируются). Экраны: Сегодня · Идеи · Акция · Позиции · Журнал
// (+ Сравнение, Сервис). Данные — глобалы приложения (DATA, POS_META, PLAN_RULES, PF_TRADES, DESK, FX), вселенная —
// deskUniverse, сигналы — SIG через адаптер sigSnapRow (свечи ?history= в общем кэше _histCache), график — stockChartDraw.
// Грузится после app-5.js и чистых desk-selection.js/desk-journal.js, перед desk-gloss.js; renderAll/renderPF3 зовут
// deskRender. Блоки прежней классики встроены в разделы (deskCtx, plans/s7b-map.md §9).
// Чистые функции (ядро ниже) покрыты тестами в tests/cases-app.js; DOM — после маркера «── DOM ──».

// ── Ядро (чистые функции) ──────────────────────────────────────────────────
// Лимит открытого риска книги: можно ли добавить риск addSEK к состоянию bookRiskState.
function deskCapCheck(rs,addSEK){
  const add=Math.max(0,+addSEK||0),open=(rs&&rs.openRiskSEK)||0,cap=(rs&&rs.capSEK)||0;
  return {ok:add<=0||(cap>0&&open+add<=cap*(1+1e-9)),left:Math.max(0,cap-open),after:open+add,cap};
}
// Сделка по позиции с учётом стороны (genomsnittsmetoden, как pfApplyBuy/pfTrade, без комиссии):
// лонг — buy открывает/докупает, sell закрывает; шорт — sell открывает (средняя = средняя выручка), buy откупает.
// → {qty, avg, tq (исполнено), plNative (результат закрытой части до комиссии, null у открытия), opens} | {err}.
function pfApplyTradeSide(cur,o){
  const q0=parseFloat(cur&&cur.qty)||0,a0=parseFloat(cur&&cur.avg)||0,q=parseFloat(o&&o.qty)||0,p=parseFloat(o&&o.price)||0,short=o&&o.side==='short';
  if(!(q>0)||!(p>0))return {err:'input'};
  const opens=short?o.act==='sell':o.act==='buy';
  if(opens){const nq=q0+q;return {qty:Math.round(nq*1e6)/1e6,avg:Math.round((a0*q0+p*q)/nq*100)/100,tq:q,plNative:null,opens:true};}
  const tq=Math.min(q,q0);if(!(tq>0))return {err:'nopos'};
  return {qty:Math.round((q0-tq)*1e6)/1e6,avg:a0,tq,plNative:Math.round((short?a0-p:p-a0)*tq*100)/100,opens:false};
}
// Трейлинг-стоп chandelier 2·ATR от текущей цены; null — если не лучше текущего стопа.
function deskTrailStop(side,stop,price,atr){
  if(!(price>0)||!(atr>0))return null;
  const dir=side==='short'?-1:1,ch=price-dir*2*atr;
  return (!(stop>0)||dir*(ch-stop)>0)&&dir*(price-ch)>0?Math.round(ch*100)/100:null;
}
// Действие по открытой позиции (лестница выхода §4 плана): p — из bookPositions (calc, side, stop, entry),
// s — снимок v2 бумаги (или null), earn — дней до отчёта (или null). Порядок важен: сначала выходы.
function deskPosAct(p,s,earn){
  const c=p&&p.calc;if(!c)return {act:'hold',note:RT('нет цены — обновите котировки','no price — refresh quotes')};
  const dir=p.side==='short'?-1:1,E=SIG.CFG.earnDays;
  if(!(p.stop>0))return {act:'nostop',note:RT('нет стопа — задайте стоп и цель','no stop — set stop & target')};
  if(c.stopHit)return {act:'exit',note:RT('стоп пробит — закрыть','stop hit — close')};
  if(c.targetHit)return {act:'take',note:RT('цель достигнута — фиксировать ½','target reached — take ½')};
  if(s&&s.verdict==='trim'&&dir>0)return {act:'trim',note:RT('перегрев — сократить часть','overheated — trim part')};
  if(earn!=null&&earn>=0&&earn<=E&&!(c.rNow>=1))return {act:'earn',note:RT(`отчёт через ${earn} дн при < 1R — сократить`,`earnings in ${earn}d at < 1R — reduce`)};
  if(c.rNow!=null&&c.rNow>=2&&s&&deskTrailStop(p.side,p.stop,c.now,s.atr)!=null)return {act:'trail',note:RT('+2R: подтянуть трейлинг 2·ATR','+2R: trail stop 2·ATR')};
  if(c.rNow!=null&&c.rNow>=1&&dir*(p.stop-p.entry)<0)return {act:'be',note:RT('+1R: стоп в безубыток','+1R: stop to breakeven')};
  if(c.toStopPct!=null&&c.toStopPct<=2)return {act:'watch',note:RT(`до стопа ${c.toStopPct.toFixed(1)}% — на контроле`,`${c.toStopPct.toFixed(1)}% to stop — watch`)};
  return {act:'hold',note:RT('по плану','on plan')};
}
// Корзины экрана «Сегодня». items: [{s (снимок v2 | null), …}], pos: [{act, …}].
function deskTodayBuckets(items,pos){
  const L=(items||[]).filter(x=>x&&x.s),C=SIG.CFG;
  const entries=L.filter(x=>x.s.verdict==='buy'||x.s.verdict==='short').sort((a,b)=>SIG.cmp(a.s,b.s));
  const waiting=L.filter(x=>{const s=x.s,p=s.plan;return (s.verdict==='wait'||s.verdict==='hold')&&p&&p.mode==='limit'&&Math.abs(p.dEntry)<=8&&SIG.rrOk(p.rr,C.rrWeak)&&!s.flags.includes('knife');})
    .sort((a,b)=>Math.abs(a.s.plan.dEntry)-Math.abs(b.s.plan.dEntry)).slice(0,12);
  const taken=new Set(entries.concat(waiting)),rest=L.filter(x=>!taken.has(x));
  const why={knife:0,heat:0,rr:0,squeeze:0,earnings:0,none:0};
  rest.forEach(x=>{const s=x.s,f=s.flags;
    if(s.phase.key==='knife')why.knife++;else if(s.verdict==='trim')why.heat++;else if(f.includes('squeeze'))why.squeeze++;
    else if(f.includes('earnings'))why.earnings++;else if(s.setup&&!SIG.rrOk(s.plan.rr,C.rrWeak))why.rr++;else why.none++;});
  const P=pos||[];
  return {entries,waiting,rest,why,attn:P.filter(p=>p.act&&p.act!=='hold'),trims:P.filter(p=>p.act==='trim'||p.act==='take'||p.act==='earn'),pending:L.length};
}
// Строки скринера: фильтры f = {v, side, phase, tab, sector, near, rr, held, q}, сортировка {k, d}. Бумаги без снимка
// (свечи ещё грузятся) видны только без сигнальных фильтров и идут в конце. Сектор — как в строке бумаги (S7b-2:
// замена Live Sector Tracker); бумаги без сектора — значение «—».
const deskSectorOf=sec=>{const s=String((sec&&sec.sector)||'').trim();return s&&s!=='—'?s:'—';};
function deskScreenRows(items,f,sort){
  f=f||{};const q=String(f.q||'').trim().toLowerCase(),sigF=(f.v&&f.v!=='all')||(f.side&&f.side!=='all')||(f.phase&&f.phase!=='all')||f.near||f.rr;
  const R=(items||[]).filter(x=>{
    const s=x.s,sec=x.sec||{};
    if(q&&!(String(sec.tk||'').toLowerCase().includes(q)||String(sec.name||'').toLowerCase().includes(q)))return false;
    if(f.tab&&f.tab!=='all'&&!(sec.tabs||[]).includes(f.tab))return false;
    if(f.sector&&f.sector!=='all'&&deskSectorOf(sec)!==f.sector)return false;
    if(f.held&&!((sec.held||[]).length))return false;
    if(!s)return !sigF;
    if(f.v==='buy'&&s.verdict!=='buy')return false;
    if(f.v==='short'&&s.verdict!=='short')return false;
    if(f.v==='trim'&&s.verdict!=='trim')return false;
    if(f.v==='wait'&&!(s.verdict==='wait'||s.verdict==='hold'))return false;
    if(f.side&&f.side!=='all'&&s.side!==f.side)return false;
    if(f.phase&&f.phase!=='all'&&s.phase.key!==f.phase)return false;
    if(f.near&&!s.near)return false;
    if(f.rr&&!SIG.rrOk(s.plan&&s.plan.rr,SIG.CFG.rrMin))return false;
    return true;
  });
  const k=(sort&&sort.k)||'verdict',d=(sort&&sort.d)||-1;
  const val=x=>{const s=x.s,sec=x.sec||{};if(k==='tk')return String(sec.tk||'');if(!s)return null;
    return {price:s.price,day:s.day,phase:s.phase.rank,near:s.near?Math.abs(s.near.dist):null,rr:s.plan&&s.plan.rr,score:s.score,dEntry:s.plan?Math.abs(s.plan.dEntry):null,verdict:sigSortVal(s)}[k];};
  return R.map(x=>({x,v:val(x)})).sort((a,b)=>{
    if(a.v==null||b.v==null)return (a.v==null)-(b.v==null);   // пустые — в конце при любом направлении
    return (typeof a.v==='string'?a.v.localeCompare(b.v):a.v-b.v)*d;
  }).map(o=>o.x);
}
// Реальные сделки PF_TRADES → сделки «туда-обратно» по (портфель, тикер, сторона): открылась с нуля — закрылась
// в ноль. Закрытие без открытия в журнале (позиция старше журнала) пропускается. plNative у продаж берётся из записи
// (там уже вычтена комиссия), доля частичного закрытия — пропорционально.
function deskRoundTrips(trades){
  const by={},out=[];
  const fin=(o,open)=>Object.assign(o,{open,exitAvg:o.exitQty>0?o.exitVal/o.exitQty:null,
    plPct:o.exitQty>0&&o.entryAvg>0?o.pl/(o.entryAvg*o.exitQty)*100:null,
    days:o.close&&o.opened?Math.round((Date.parse(o.close)-Date.parse(o.opened))/864e5):null});
  (trades||[]).map((t,i)=>({t,i})).filter(x=>x.t&&x.t.tk).sort((a,b)=>{const da=String(a.t.date||''),db=String(b.t.date||'');return da<db?-1:da>db?1:a.i-b.i;}).forEach(({t})=>{
    const side=t.short?'short':'long',tk=String(t.tk).trim().toUpperCase(),tab=t.tab||PF3_KEY,k=tab+'|'+tk+'|'+side;
    const q=parseFloat(t.qty)||0,px=parseFloat(t.price)||0;if(!(q>0&&px>0))return;
    const opens=side==='short'?t.act==='sell':t.act==='buy';
    let o=by[k];
    if(opens){
      if(!o)o=by[k]={tab,tk,name:t.name||tk,ccy:t.ccy||'USD',side,opened:t.date||'',close:'',qty:0,maxQty:0,entryAvg:0,exitQty:0,exitVal:0,pl:0,n:0};
      o.entryAvg=(o.entryAvg*o.qty+px*q)/(o.qty+q);o.qty+=q;o.maxQty=Math.max(o.maxQty,o.qty);o.n++;
    }else{
      if(!o)return;
      const tq=Math.min(q,o.qty),pl=t.plNative!=null&&isFinite(+t.plNative)?+t.plNative*(tq/q):(side==='short'?o.entryAvg-px:px-o.entryAvg)*tq;
      o.pl+=pl;o.exitQty+=tq;o.exitVal+=px*tq;o.qty-=tq;o.n++;o.close=t.date||'';
      if(o.qty<=1e-9){out.push(fin(o,false));delete by[k];}
    }
  });
  Object.values(by).forEach(o=>out.push(fin(o,true)));
  return out.sort((a,b)=>String(b.close||b.opened).localeCompare(String(a.close||a.opened)));
}
// Статистика закрытых сделок: доля в плюсе, средний %, profit factor и итог в kr (fx: валюта → kr).
function deskJournalStats(trips,fx){
  const C=(trips||[]).filter(t=>!t.open),kr=t=>t.pl*((fx&&fx[t.ccy])||1);
  const pos=C.filter(t=>t.pl>0).reduce((a,t)=>a+kr(t),0),neg=-C.filter(t=>t.pl<0).reduce((a,t)=>a+kr(t),0),P=C.filter(t=>t.plPct!=null);
  return {n:C.length,open:(trips||[]).length-C.length,win:C.filter(t=>t.pl>0).length,winRate:C.length?C.filter(t=>t.pl>0).length/C.length*100:null,
    avgPct:P.length?P.reduce((a,t)=>a+t.plPct,0)/P.length:null,pf:neg>0?pos/neg:(pos>0?Infinity:null),sumSEK:pos-neg};
}
// «Позиции → Структура» (S7b-2): группы позиций по полю g (сектор/тип). items: [{g, valueSEK, plSEK}] — стоимость
// по модулю (шорт тоже занимает капитал), доля — от суммы модулей. Пустая группа → «—». Порядок — по стоимости, затем имени.
function deskGroups(items){
  const by={};let tot=0;
  (items||[]).forEach(x=>{if(!x)return;const g=String(x.g||'').trim()||'—',v=Math.abs(+x.valueSEK||0),pl=+x.plSEK||0;
    const o=by[g]||(by[g]={g,n:0,valueSEK:0,plSEK:0});o.n++;o.valueSEK+=v;o.plSEK+=pl;tot+=v;});
  return Object.values(by).map(o=>Object.assign(o,{weightPct:tot>0?o.valueSEK/tot*100:null}))
    .sort((a,b)=>(b.valueSEK-a.valueSEK)||(a.g<b.g?-1:a.g>b.g?1:0));
}
// Гистограмма результатов в R: корзины −3…+5 (крайние собирают хвосты).
function deskRBins(Rs){
  const bins=[-3,-2,-1,0,1,2,3,4,5],n=bins.map(()=>0);
  (Rs||[]).forEach(r=>{if(r==null||!isFinite(r))return;const k=Math.max(-3,Math.min(5,Math.floor(r)));n[bins.indexOf(k)]++;});
  return {bins,n};
}
// Зона покупки идеи против цены: нужная коррекция до верха/низа зоны (%, отрицательная — цена выше зоны) и
// состояние in (в зоне) · below (ниже зоны) · near (≤ nearZonePct над верхом) · far. hot — зелёная точка.
function deskWatchZone(item,price){
  const lo=_pnum(item&&item.buyLo),hi=_pnum(item&&item.buyHi),px=_pnum(price);
  if(!lo||!hi||!px)return null;
  const dHi=(hi/px-1)*100,dLo=(lo/px-1)*100;
  const state=px<lo?'below':px<=hi?'in':(-dHi<=DESK_IDEA_CFG.nearZonePct*(1+1e-9)?'near':'far');
  return {lo,hi,range:hi>lo,dHi,dLo,state,hot:state!=='far'};
}
// Справедливая стоимость (§2.2, решение §6#2): свои сценарии, если задан хотя бы base (веса нормируются на
// сумму заданных), иначе таргеты аналитиков TG_FULL low/consensus/high с теми же весами 25/50/25, иначе null.
// Апсайд — от текущей цены price (не от refPx).
function deskFairValue(item,tg,price){
  const W=DESK_IDEA_CFG.fvW,fv=item&&item.fv,px=_pnum(price),none={value:null,src:null,parts:[],upsidePct:null,n:null,at:''};
  let raw=null,src=null;
  if(fv&&_pnum(fv.base)){src='scenarios';raw=[['bear',fv.bear,fv.wBear],['base',fv.base,fv.wBase],['bull',fv.bull,fv.wBull]];}
  else if(tg&&_pnum(tg.consensus)){src='analysts';raw=[['low',tg.low,W.bear],['consensus',tg.consensus,W.base],['high',tg.high,W.bull]];}
  if(!src)return none;
  const parts=raw.map(([k,v,w])=>({k,v:_pnum(v),w:+w||0})).filter(p=>p.v&&p.w>0),sw=parts.reduce((a,p)=>a+p.w,0);
  if(!(sw>0))return none;
  parts.forEach(p=>{p.share=p.w/sw;});
  const value=parts.reduce((a,p)=>a+p.v*p.share,0);
  return {value,src,parts,upsidePct:px?(value/px-1)*100:null,n:src==='analysts'?(+tg.count||null):null,at:src==='analysts'?String(tg.lastDate||tg.at||'').slice(0,10):''};
}
// Уровень риска 1–5 (§2.3, решение §6#1): база — дневной ATR % снимка v2 по порогам DESK_IDEA_CFG.risk.atrPct,
// +1 за каждый флаг risk.bump (wide — у плана выбранной стороны) и за бету > betaHi; максимум 5.
// extra = {plan, beta, riskOvr}: ручной уровень 1–5 перекрывает, авто-значение остаётся в auto.
const deskRiskWord=l=>[RT('нет данных','no data'),RT('Низкий','Low'),RT('Умеренный','Moderate'),RT('Средний','Medium'),RT('Высокий','High'),RT('Очень высокий','Very high')][l>=1&&l<=5?l:0];
function deskRiskLevel(snap,extra){
  const C=DESK_IDEA_CFG.risk,e=extra||{},ro=Math.round(+e.riskOvr),ovr=ro>=1&&ro<=5?ro:null;
  if(!snap||!(snap.atrPct>0))return {level:ovr,auto:null,ovr,word:deskRiskWord(ovr),parts:[],atrPct:null};
  const a=snap.atrPct,base=1+C.atrPct.filter(t=>a>t).length,plan=e.plan||snap.plan;
  const flags=new Set((snap.flags||[]).filter(f=>f!=='wide').concat(((plan&&plan.flags)||[]).filter(f=>f==='wide')));
  const parts=[{k:'atr',add:base,v:a}];
  C.bump.forEach(f=>{if(flags.has(f))parts.push({k:f,add:1});});
  if(e.beta>C.betaHi)parts.push({k:'beta',add:1,v:+e.beta});
  const auto=Math.min(5,parts.reduce((s,p)=>s+p.add,0)),level=ovr||auto;
  return {level,auto,ovr,word:deskRiskWord(level),parts,atrPct:a};
}
// Зона по умолчанию при добавлении в список (buySrc 'signal'): лимит-цена лонг-плана v2, иначе ближайшая
// структурная поддержка ниже цены, иначе вход плана по рынку. null — снимка нет (зону задаёт пользователь).
function deskBuyDefault(s){
  const p=s&&s.plans&&s.plans.long;if(!p)return null;
  const r2=v=>Math.round(v*100)/100;
  if(p.mode==='limit'&&p.entry>0)return {lo:r2(p.entry),hi:r2(p.entry),note:RT('лимит плана v2 · ','v2 plan limit · ')+(p.levelSrc||'')};
  const sup=((s.levels&&s.levels.sup)||[]).find(x=>x.kind!=='pivot'&&x.v>0&&x.v<s.price);
  if(sup)return {lo:r2(sup.v),hi:r2(sup.v),note:RT('поддержка · ','support · ')+String(sup.src||'').replace(/\+/g,' · ')};
  return p.entry>0?{lo:r2(p.entry),hi:r2(p.entry),note:RT('вход плана v2 по рынку','v2 plan market entry')}:null;
}
// «Что если?» (I2, §2.4): покупка (лонг) или открытие шорта в портфеле tab — ничего не пишет. Формулы — только
// существующие: комиссия tradeFeeNative, курс FX/pf3BaseFx, капитал и риск bookRiskState/deskCapCheck, позиции
// bookPositions, новая позиция pfApplyTradeSide; кэш — как deskExecApply (шорт: только комиссия).
// o = {tab, sec (бумага deskUniverse), side, plan (план v2 стороны | null), mode 'amount'|'weight', amountSEK, weightPct,
//      price (цена сделки; нет — лимит плана или цена бумаги), now}. Бюджет = сумма в kr или доля капитала на сделку;
// количество — целые акции, комиссия сверху. Доли — по модулю к капиталу после сделки (капитал − комиссия).
function deskWhatIf(o){
  o=o||{};const d=DATA[o.tab],sec=o.sec||{},C=DESK_IDEA_CFG.whatIf;
  if(!d||!Array.isArray(d.rows))return {err:'port'};
  const side=o.side==='short'?'short':'long',ccy=String(sec.ccy||'USD').toUpperCase(),fx=FX[ccy]||1,tk=posTk(sec.tk),plan=o.plan||null;
  const price=_pnum(o.price)||(plan&&plan.mode==='limit'?_pnum(plan.entry):null)||_pnum(sec.price);
  if(!price)return {err:'price'};
  const rs=bookRiskState(o.tab),eq=rs.equitySEK,mode=o.mode==='weight'?'weight':'amount';
  const budgetSEK=Math.max(0,mode==='weight'?eq*(parseFloat(o.weightPct)||0)/100:(parseFloat(o.amountSEK)||0));
  const qtyRaw=budgetSEK/(price*fx),qty=Math.floor(qtyRaw+1e-9),notional=qty*price,notionalSEK=notional*fx;
  const act=side==='short'?'sell':'buy',fee=tradeFeeNative(ccy,notional,act==='buy'),feeSEK=fee.total*fx;
  // Текущая позиция бумаги в портфеле (сторона — из POS_META) и то, что с ней станет.
  const P=bookPositions(o.tab),cur=P.find(p=>p.tk===tk)||null,opp=!!(cur&&cur.side!==side);
  const next=qty>0&&!opp?pfApplyTradeSide(cur?{qty:cur.qty,avg:cur.entry}:null,{side,act,qty,price}):null;
  const hasCash=d.cashFree!=null&&d.cashFree!=='',cashBefore=hasCash?(parseFloat(d.cashFree)||0)*pf3BaseFx(d):null;
  const cashAfter=hasCash?cashBefore-(side==='short'?feeSEK:notionalSEK+feeSEK):null,eqAfter=eq-feeSEK;
  // Концентрация: стоимость по модулю (шорт тоже) к капиталу; сектор — из строки портфеля (r[4]).
  const secOf={};d.rows.forEach(r=>{secOf[posTk(r[2])]=String(r[4]||'').trim();});
  const sector=String(sec.sector||secOf[tk]||'').trim(),val=p=>(p.calc&&p.calc.valueSEK)||0;
  const sum=f=>P.filter(f).reduce((a,p)=>a+val(p),0),pct=(v,e)=>e>0?v/e*100:null,add=opp?0:notionalSEK;
  const posB=cur?val(cur):0,secB=sector?sum(p=>secOf[p.tk]===sector):null,ccyB=sum(p=>p.ccy===ccy);
  const stop=plan&&_pnum(plan.stop),tradeRiskSEK=stop&&qty>0?qty*Math.abs(price-stop)*fx:0,cap=deskCapCheck(rs,tradeRiskSEK);
  const R={side,mode,tab:o.tab,tk,ccy,fx,price,budgetSEK,qtyRaw,qty,notional,notionalSEK,fee,feeNative:fee.total,feeSEK,
    cashBefore,cashAfter,hasCash,baseCcy:pf3Base(d),equityBefore:eq,equityAfter:eqAfter,sector,
    weightBefore:pct(posB,eq),weightAfter:pct(posB+add,eqAfter),sectorBefore:sector?pct(secB,eq):null,sectorAfter:sector?pct(secB+add,eqAfter):null,
    ccyBefore:pct(ccyB,eq),ccyAfter:pct(ccyB+add,eqAfter),qtyBefore:cur?cur.qty:0,qtyAfter:next&&!next.err?next.qty:(cur?cur.qty:0),avgAfter:next&&!next.err?next.avg:null,
    stop,tradeRiskSEK,bookRiskBefore:rs.openRiskSEK,bookRiskAfter:cap.after,capSEK:rs.capSEK,warnings:[]};
  const W=(code,blocking,text)=>R.warnings.push({code,blocking:!!blocking,text});
  if(opp)W('side',true,RT('В портфеле позиция другой стороны — сначала закройте её','The portfolio holds the opposite side — close it first'));
  if(!(qty>0))W('qty',true,RT(`Бюджета ${Math.round(budgetSEK)} kr не хватает на одну акцию (${Math.round(price*fx)} kr)`,`A ${Math.round(budgetSEK)} kr budget does not buy one share (${Math.round(price*fx)} kr)`));
  if(!cap.ok)W('cap',true,RT('Лимит открытого риска книги превышен — исполнение заблокировано','Book open-risk cap exceeded — execution blocked'));
  if(hasCash&&cashAfter<0)W('cash',side!=='short',side==='short'?RT('Кэша не хватает даже на комиссию','Cash does not cover the fee'):RT('Кэша не хватает — после покупки он станет отрицательным','Not enough cash — it would go negative'));
  if(!stop)W('nostop',false,RT('У плана нет стопа — риск сделки не ограничен и в лимите книги не учтён','The plan has no stop — trade risk is unbounded and not counted in the book cap'));
  if(side==='short'&&!((DESK.shortOk||{})[sec.sym]))W('noshort',false,RT('Шорт не подтверждён: проверьте займ и его стоимость у брокера','Short unconfirmed: check borrow and its cost at the broker'));
  if(!(sec.pxAt>0&&(o.now||Date.now())-sec.pxAt<=C.staleMin*60e3))W('stale',false,RT(`Цена не live дольше ${C.staleMin} мин — обновите котировки`,`Price not live for over ${C.staleMin} min — refresh quotes`));
  const noPx=P.filter(p=>!p.calc).length;
  if(noPx)W('nopx',false,RT(`${noPx} поз. в портфеле без цены — капитал и доли занижены, обновите котировки`,`${noPx} position(s) without a price — equity and weights are understated, refresh quotes`));
  if(R.weightAfter>C.weightPct*(1+1e-9))W('weight',false,RT(`Доля бумаги станет ${dkN(R.weightAfter,1)} % (> ${C.weightPct} %)`,`Position weight would be ${dkN(R.weightAfter,1)} % (> ${C.weightPct} %)`));
  if(R.sectorAfter>C.sectorPct*(1+1e-9))W('sector',false,RT(`Сектор «${sector}» станет ${dkN(R.sectorAfter,1)} % (> ${C.sectorPct} %)`,`Sector “${sector}” would be ${dkN(R.sectorAfter,1)} % (> ${C.sectorPct} %)`));
  if(ccy!=='SEK'&&R.ccyAfter>C.ccyPct*(1+1e-9))W('ccy',false,RT(`Доля ${ccy} станет ${dkN(R.ccyAfter,1)} % (> ${C.ccyPct} %)`,`${ccy} share would be ${dkN(R.ccyAfter,1)} % (> ${C.ccyPct} %)`));
  R.status=R.warnings.some(w=>w.blocking)?'blocked':R.warnings.length?'attention':'ok';
  return R;
}
// «Рост бизнеса» (I3, §3.4): модель столбцов по ответу ?financials= (§2.5). metric — revenue|eps|fcf (у FCF только факт).
// Факт — годы annual со значением; прогноз — estimates позже последнего факта. Рост г/г — к соседнему году с базой > 0.
// CAGR = (последний ÷ первый)^(1/лет) − 1: исторический — по факту (≥ 2 точки, обе > 0); прогнозный — от последнего
// факта до последнего прогноза и только при ≥ 2 точках прогноза (решение §6#4).
function deskFinCagr(a,b){
  if(!a||!b)return null;const n=b.year-a.year;
  return n>0&&a.v>0&&b.v>0?{pct:(Math.pow(b.v/a.v,1/n)-1)*100,from:a,to:b,years:n}:null;
}
function deskFinModel(fin,metric,now){
  const m=['revenue','eps','fcf'].includes(metric)?metric:'revenue',num=v=>v!=null&&isFinite(v);
  const M={metric:m,bars:[],act:0,est:0,cagrHist:null,cagrFcst:null,excluded:[],stale:false,notes:[],ccy:null,source:null,fetchedAt:null};
  if(!fin||typeof fin!=='object')return Object.assign(M,{state:'loading'});
  if(fin.status==='error')return Object.assign(M,{state:'error',notes:fin.notes||[]});
  const A=Array.isArray(fin.annual)?fin.annual:[];
  const act=A.filter(x=>x&&num(x[m])).map(x=>({year:+x.year,v:+x[m],est:false})),last=act[act.length-1];
  const est=m==='fcf'||!last?[]:(Array.isArray(fin.estimates)?fin.estimates:[]).filter(x=>x&&num(x[m])&&+x.year>last.year).map(x=>({year:+x.year,v:+x[m],est:true,n:x.n||null}));
  const bars=act.concat(est),at=Date.parse(fin.fetchedAt||'');
  bars.forEach((b,i)=>{const p=bars[i-1];b.yoy=p&&p.v>0&&b.year-p.year===1?(b.v/p.v-1)*100:null;});
  Object.assign(M,{bars,act:act.length,est:est.length,cagrHist:act.length>=2?deskFinCagr(act[0],last):null,
    cagrFcst:est.length>=2?deskFinCagr(last,est[est.length-1]):null,excluded:A.filter(x=>x&&!num(x[m])).map(x=>+x.year),
    stale:isFinite(at)&&(now||Date.now())-at>DESK_IDEA_CFG.fin.staleDays*864e5,
    notes:Array.isArray(fin.notes)?fin.notes:[],ccy:fin.ccy||null,source:fin.source||null,fetchedAt:fin.fetchedAt||null});
  M.state=!bars.length?'nodata':act.length>=2&&est.length?'ok':'partial';
  return M;
}
// Значение ряда: выручка/FCF — трлн/млрд/млн, EPS — 2 знака.
function deskFinFmt(v,metric){
  if(v==null||!isFinite(v))return '—';
  if(metric==='eps')return dkN(v,2);
  const a=Math.abs(v);
  return a>=1e12?dkN(v/1e12,2)+RT(' трлн',' T'):a>=1e9?dkN(v/1e9,a>=1e11?0:1)+RT(' млрд',' B'):a>=1e6?dkN(v/1e6,0)+RT(' млн',' M'):dkN(v,0);
}
// Inline-SVG «Роста бизнеса»: столбцы (факт — сплошные, прогноз — полупрозрачные с пунктиром) на левой оси,
// линия роста г/г на правой. Цвета — классы desk.css. Каждый столбец фокусируем, подсказка — data-tip.
// narrow — телефон: узкий viewBox (текст не мельчает при масштабировании) и годы в две цифры.
function deskFinSvg(M,ccy,narrow){
  const W=narrow?340:640,H=narrow?210:230,pl=narrow?50:58,pr=narrow?38:46,pt=14,pb=26,iw=W-pl-pr,ih=H-pt-pb,B=M.bars,n=B.length;
  if(!n)return '';
  const vs=B.map(b=>b.v),hi=Math.max(0,...vs),lo=Math.min(0,...vs),sp=(hi-lo)||1,y=v=>pt+(hi-v)/sp*ih;
  const Y=B.map(b=>b.yoy).filter(v=>v!=null),yh=Math.max(0,...Y)*1.1,yl=Math.min(0,...Y)*1.1,ys=(yh-yl)||1,yy=v=>pt+(yh-v)/ys*ih;
  const slot=iw/n,bw=Math.min(56,slot*.62),cx=i=>pl+slot*(i+.5),f=v=>Math.round(v*10)/10,src=M.source==='fmp'?'FMP':M.source==='yahoo'?'Yahoo':'';
  const kind=b=>b.est?RT('прогноз','forecast')+(b.n?RT(` · ${b.n} аналит.`,` · ${b.n} analysts`):''):RT('факт','actual');
  let s=`<svg class="dk-fin-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="${dkEsc(RT('Столбцы по годам, линия — рост г/г','Bars by year, line — YoY growth'))}">`;
  [0,1,2,3,4].forEach(i=>{const v=lo+sp*i/4,yv=f(y(v));s+=`<line class="dk-fin-grid" x1="${pl}" x2="${W-pr}" y1="${yv}" y2="${yv}"/><text class="dk-fin-ax" x="${pl-6}" y="${yv+3}" text-anchor="end">${dkEsc(deskFinFmt(v,M.metric))}</text>`;});
  if(Y.length)[yl,0,yh].forEach(v=>{s+=`<text class="dk-fin-ax yoy" x="${W-pr+6}" y="${f(yy(v))+3}">${dkEsc(dkPct(v,0))}</text>`;});
  s+=`<line class="dk-fin-zero" x1="${pl}" x2="${W-pr}" y1="${f(y(0))}" y2="${f(y(0))}"/>`;
  B.forEach((b,i)=>{
    const top=f(Math.min(y(b.v),y(0))),h=Math.max(1,f(Math.abs(y(b.v)-y(0)))),tip=`${b.year} · ${deskFinFmt(b.v,M.metric)} ${ccy||''} · ${kind(b)}${b.yoy!=null?' · '+RT('г/г ','YoY ')+dkPct(b.yoy,1):''}${src?' · '+src:''}`;
    s+=`<g class="dk-fb${b.est?' est':''}${b.v<0?' neg':''}" tabindex="0" role="img" aria-label="${dkEsc(tip)}" data-tip="${dkEsc(tip)}"><rect x="${f(cx(i)-bw/2)}" y="${top}" width="${f(bw)}" height="${h}" rx="3"/><text class="dk-fin-yr" x="${f(cx(i))}" y="${H-8}" text-anchor="middle">${narrow?'’'+String(b.year).slice(2):b.year}${b.est?`<tspan class="dk-fin-f">${narrow?RT('П','F'):RT(' П',' F')}</tspan>`:''}</text></g>`;
  });
  // Линия г/г рвётся на годах без роста (нет базы или пропуск года).
  let seg=[];const segs=[];B.forEach((b,i)=>{if(b.yoy==null){if(seg.length)segs.push(seg);seg=[];}else seg.push([f(cx(i)),f(yy(b.yoy)),b.est]);});if(seg.length)segs.push(seg);
  segs.forEach(g=>{if(g.length>1)s+=`<polyline class="dk-fin-yoy" points="${g.map(p=>p[0]+','+p[1]).join(' ')}"/>`;g.forEach(p=>{s+=`<circle class="dk-fin-dot${p[2]?' est':''}" cx="${p[0]}" cy="${p[1]}" r="3"/>`;});});
  return s+'</svg>';
}
// Пиры для P/E (§3.5): бумаги того же сектора VAL с P/E > 0, кроме самой; при избытке — крупнейшие по капитализации
// caps (тикер → кап-я), затем по тикеру. Меньше peersMin — сравнения нет (reason 'few').
function deskPeers(tk,val,caps){
  const C=DESK_IDEA_CFG.ana,V=val||{},me=V[tk],sector=me&&me.sector;
  if(!sector)return {sector:null,peers:[],median:null,reason:'nosector',n:0};
  const all=Object.keys(V).filter(t=>t!==tk&&V[t]&&V[t].sector===sector&&V[t].pe>0).map(t=>({tk:t,pe:+V[t].pe,cap:+((caps||{})[t])||0}));
  all.sort((a,b)=>(b.cap-a.cap)||(a.tk<b.tk?-1:a.tk>b.tk?1:0));
  const peers=all.slice(0,C.peersMax);
  if(peers.length<C.peersMin)return {sector,peers:[],median:null,reason:'few',n:peers.length};
  return {sector,peers,median:valMedian(peers.map(p=>p.pe)),reason:null,n:peers.length};
}
// Отклонение мультипликатора от ориентира (медиана сектора/своя история), % и класс: дешевле/дороже больше devPct — цвет.
function deskMultDev(v,ref){
  if(!(v>0)||!(ref>0))return {dev:null,cls:''};
  const dev=(v/ref-1)*100,t=DESK_IDEA_CFG.ana.devPct;
  return {dev,cls:dev<=-t?'cheap':dev>=t?'rich':''};
}
// Распределение рекомендаций TG_FULL.ratings → доли Strong Buy…Strong Sell (пустые отброшены).
function deskRatings(r){
  if(!r||typeof r!=='object')return null;
  const segs=[['strongBuy','Strong Buy'],['buy','Buy'],['hold','Hold'],['sell','Sell'],['strongSell','Strong Sell']].map(([k,l])=>({k,l,n:Math.max(0,Math.round(+r[k]||0))}));
  const total=segs.reduce((a,x)=>a+x.n,0);
  if(!total)return null;
  segs.forEach(x=>{x.pct=x.n/total*100;});
  return {segs:segs.filter(x=>x.n),total,consensus:r.consensus||null};
}
// «Нормальный» P/E для линии прибыли (plans/earnings-line.md, аудит 2026-09-11 по 379 бумагам). own — своя история P/E
// (chartEarnPe: на тех же EPS и ценах, что и линия). Порядок: своя медиана, если устойчива (разброс по годам ≤ earn.dispX)
// и не дальше earn.histX раз от текущего → медиана сектора (n ≥ 2), если текущий известен и она не дальше ×histX →
// текущий по последнему FY (линия показывает только динамику). Текущий для сверки — TTM из «Оценки» (VAL.pe), без неё — по FY.
// Все P/E — в [peMin, peMax]. val/secMed — для тестов. → {pe, src:'own'|'sector'|'cur', cur, skip:[{src,why,pe,disp?}], own} или null.
function deskEarnPe(tk,own,val,secMed){
  const C=DESK_IDEA_CFG.earn,Vm=val||VAL||{},t=String(tk||'').toUpperCase(),V=Vm[t]||Vm[posTk(t)]||null;
  const inR=v=>v>0&&v>=C.peMin&&v<=C.peMax,curFY=own&&inR(own.curFY)?own.curFY:null,cur=V&&V.pe>0?+V.pe:curFY,skip=[];
  const near=v=>!cur||(v/cur<=C.histX&&cur/v<=C.histX);
  if(own&&inR(own.pe)){
    if(own.disp>C.dispX)skip.push({src:'own',why:'disp',pe:own.pe,disp:own.disp});
    else if(!near(own.pe))skip.push({src:'own',why:'far',pe:own.pe});
    else return {pe:own.pe,src:'own',cur,skip,own};
  }
  const S=secMed||_valSecCache||valSectorMedians(),med=V&&V.sector?S[V.sector]:null;
  if(cur&&med&&med.n>=2&&inR(med.pe)){if(near(+med.pe))return {pe:+med.pe,src:'sector',cur,skip,own};skip.push({src:'sector',why:'far',pe:+med.pe});}
  return curFY?{pe:curFY,src:'cur',cur,skip,own}:null;
}

// P2 (plans/stock-selection-ux.md §4): «Акция» в трёх режимах. Маршрут — тот же hash, без второго роутера:
// #desk/<route>[/<ключ>[/<режим>]]; «Решение» — режим по умолчанию и в адрес не пишется. P4: #desk/compare —
// без ключей (выбор живёт в памяти вкладки; прямая ссылка без выбора предлагает выбрать бумаги).
const DK_VIEWS=['decision','company','tech'];
function deskHashOf(route,key,view){
  if(route!=='stock'||!key)return '#desk/'+route;
  return '#desk/stock/'+encodeURIComponent(key)+(view&&view!=='decision'&&DK_VIEWS.includes(view)?'/'+view:'');
}
function deskHashParse(h){
  h=String(h||'');if(!/^#desk\//.test(h))return null;
  const [r,k,v]=h.slice(6).split('/');
  const route=['today','screen','stock','book','journal','compare','service'].includes(r)?r:null;
  let key=null;if(k)try{key=decodeURIComponent(k);}catch(e){key=null;}
  return {route,key,view:route==='stock'&&DK_VIEWS.includes(v)?v:'decision'};
}
// Одна primary-кнопка «Решения» (§4): задача модели отбора (action.key/nextStep) + состояние идеи и права.
// o: {key, source, nextStep, inList, zoneHi, ruleArmed, canPlan, canTrade, hasSug, trail} → id кнопки | null.
// Уже взведённое уведомление повторно не создаётся; у позиции без срочного действия primary нет.
function deskDecisionBtn(o){
  o=o||{};
  if(o.source==='position'){
    if(o.nextStep==='refresh-data')return 'refresh';
    if(o.nextStep!=='position-action'||!o.canTrade)return null;
    return ({exit:'close',take:'trim',trim:'trim',earn:'trim',be:'be',trail:o.trail>0?'trail':'stops',nostop:o.hasSug?'accept':'stops'})[o.key]||null;
  }
  switch(o.nextStep){
    case 'refresh-data':return 'refresh';
    case 'check-company':return 'company';
    case 'view-technical':return 'tech';
    case 'check-trade':return 'trade';
    case 'view-level':
      if(!o.canPlan)return 'tech';
      if(!o.inList)return 'wadd';
      return o.zoneHi>0&&!o.ruleArmed?'wnotify':'tech';
  }
  return null;
}
// Главный риск (§4): своя формулировка из идеи → блокер входа → флаг → высокий уровень → «явных флагов нет».
// o: {user, blockers, flags, level, side} → {k, text?}; тексты — в UI.
function deskMainRisk(o){
  o=o||{};const B=o.blockers||[],F=o.flags||[];
  if(o.user)return {k:'user',text:o.user};
  for(const k of ['knife','earnings','squeeze','no-short'])if(B.includes(k)||(k==='knife'||k==='earnings')&&F.includes(k))return {k};
  for(const k of ['wide','stale-target','half'])if(F.includes(k))return {k};
  return o.level>=4?{k:'level'}:{k:'none'};
}

// ── DOM ────────────────────────────────────────────────────────────────────
let DESK_UI={route:'today',key:null,sel:null,side:{},years:1,port:null,jt:'mine',
  f:{v:'all',side:'all',phase:'all',tab:'all',sector:'all',near:false,rr:false,held:false,q:''},sort:{k:'verdict',d:-1},
  bt:'pos',bai:'proto',planTab:null,svcTab:null,fix:null,draft:{},   // S7b-2: раздел книги, раздел AI книги, портфель редактора плана, вкладка «Сервиса», правка позиции, черновики полей встроенных блоков
  riskOvr:{},exec:null,edit:null,menu:false,load:{busy:false,done:0,total:0,at:0},calAt:0,qAt:0,_t:0,_pending:false,_timer:null,
  iv:'all',wmenu:null,wedit:null,drag:null,   // I1: вид «Идей» (all|watch|final), меню карточки списка, форма идеи, перетаскивание
  wiRaw:null,   // I2: вводимое в «Что если?» значение до подтверждения (change) — пересчёт на месте
  finOpen:null,finM:'revenue',   // I3: у какой бумаги раскрыт «Рост бизнеса» (сессия, не localStorage — открытие desk не шлёт запросов), ряд
  gloss:{open:false,q:'',id:null},   // G1: панель «📖 Словарь» (desk-gloss.js) — только память сессии, не снапшот
  stockView:'decision',_compFor:null,r1:null,_restoreY:null,   // P2: режим «Акции» (память), для какой бумаги уже запущены загрузки «Компании», обновление одной бумаги, прокрутка из history.state
  compare:{keys:[],acct:null,dropped:0},_cmpFor:null,_cmpFrom:null,   // P4: выбор для сравнения (память вкладки, аккаунт выбора, сколько убрано из-за доступа), для какого набора запущены загрузки, откуда пришли
  _jClean:null,_jErr:null};   // P5b: для какого аккаунта уже прошла ретенция журнала наблюдений в этой сессии, последняя ошибка записи расчёта
let _deskFan=null;   // I3: веер цели {key, ch}
let _deskChart=null,_deskMini=null;   // состояния stockChartDraw: {key,tab,row,ccy,years,side,ch}
const dkEsc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const dkN=(v,d)=>v==null||!isFinite(v)?'—':(+v).toLocaleString(LANG==='en'?'en-US':'ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});
const dkPx=v=>v==null||!isFinite(v)?'—':dkN(v,v>=500?0:v>=20?1:2);
const dkPct=(v,d)=>v==null||!isFinite(v)?'—':(v>=0?'+':'')+dkN(v,d==null?1:d)+'%';
const dkKr=v=>can('data.show_amounts')?dkN(Math.round(v||0),0)+' kr':'••• kr';
const dkR=v=>v==null||!isFinite(v)?'—':(v>=0?'+':'')+dkN(v,2)+'R';
const dkCcy=c=>({USD:'$',EUR:'€',GBP:'£',SEK:'kr',NOK:'NOK',DKK:'DKK',CAD:'C$'})[c]||c||'';
const dkRR=p=>p&&p.rr!=null?((p.flags||[]).includes('atr-target')?'≈':'')+dkN(p.rr,1):'—';
const DK_V={buy:['▲',()=>RT('Купить','Buy')],short:['▼',()=>RT('Шорт','Short')],trim:['◆',()=>RT('Сократить','Trim')],hold:['●',()=>RT('Держать','Hold')],wait:['○',()=>RT('Ждать','Wait')]};
const DK_PH={knife:'⤓',down:'↘',corr:'↓',flat:'→',rev:'↗',undr:'◇',up:'↑',imp:'⇈',heat:'△'};
const DK_FLAG={wide:()=>RT('широкий стоп','wide stop'),half:()=>RT('½ риска','½ risk'),squeeze:()=>RT('риск сквиза','squeeze risk'),'stale-target':()=>RT('таргет устарел','stale target'),knife:()=>RT('нож','knife'),earnings:()=>RT('отчёт скоро','earnings soon'),'no-short':()=>RT('шорт не подтверждён','short unconfirmed'),'atr-target':()=>RT('цель ≈ 2·ATR','target ≈ 2·ATR')};
const DK_ACT={exit:['▼',()=>RT('закрыть','close'),'short'],take:['◆',()=>RT('фиксировать','take profit'),'trim'],trim:['◆',()=>RT('сократить','trim'),'trim'],earn:['◆',()=>RT('перед отчётом','pre-earnings'),'trim'],
  trail:['●',()=>RT('трейлинг','trail'),'hold'],be:['●',()=>RT('стоп в б/у','stop to b/e'),'hold'],watch:['○',()=>RT('у стопа','near stop'),'wait'],nostop:['○',()=>RT('задать стоп','set stop'),'wait'],hold:['●',()=>RT('по плану','on plan'),'hold']};
// Подсказки словаря (G2, desk-gloss.js): data-g="<id записи DESK_GLOSS>" на метке — наведение мышью / долгое
// нажатие; кнопка ⓘ у заголовков KPI и разделов — клик и клавиатура. Id — только литералом в dkG('…')/dkGi('…')
// или из ключей DK_V/DK_PH/DK_FLAG/DK_ACT: тест сверяет их со словарём.
const dkG=id=>` data-g="${id}"`;
const dkGi=id=>`<button type="button" class="dk-gi" data-a="gtip" data-g="${id}" aria-controls="dkTip" aria-expanded="false" aria-label="${RT('Что это?','What is this?')}">ⓘ</button>`;
const dkPill=(v,held)=>{const k=DK_V[v]?v:'wait',p=DK_V[k],lbl=v==='trim'&&!held?RT('Перегрев','Overheated'):p[1]();return `<span class="dk-pill v-${dkEsc(v)}"${dkG('v-'+k)}>${p[0]} ${lbl}</span>`;};
const dkSide=s=>`<span class="dk-pill side-${s==='short'?'short':'long'}"${dkG('side')}>${s==='short'?'▼ '+RT('Шорт','Short'):'▲ '+RT('Лонг','Long')}</span>`;
const dkPhase=s=>`<span class="dk-tag"${DK_PH[s.phase.key]?dkG('ph-'+s.phase.key):''}>${DK_PH[s.phase.key]||''} ${dkEsc(T(s.phase.label))} <span class="dk-mut">${s.trendUp?'↑':'↓'}</span></span>`;   // title со SMA снят: на метке теперь подсказка фазы (стрелка — в словаре)
const dkFlags=s=>(s.flags||[]).filter(f=>DK_FLAG[f]&&f!=='atr-target').map(f=>`<span class="dk-flag"${dkG('fl-'+f)}>${DK_FLAG[f]()}</span>`).join(' ');
const dkActPill=a=>{const k=DK_ACT[a]?a:'hold',x=DK_ACT[k];return `<span class="dk-pill v-${x[2]}"${dkG('act-'+k)}>${x[0]} ${x[1]()}</span>`;};
const dkDay=d=>d==null||!isFinite(d)?'':`<span class="dk-num ${d>=0?'dk-up':'dk-dn'}">${dkPct(d,2)}</span>`;
// «Как рассчитано» / «Подробности» (§0.2–0.3): закрыто по умолчанию; открытые запоминаются на этом устройстве
// (localStorage, не синк) по id блока — одинаково для всех бумаг.
const DESK_DET_LS='dash_desk_det';
let _deskDet=null;
function deskDetOpen(id){if(!_deskDet){try{_deskDet=JSON.parse(localStorage.getItem(DESK_DET_LS)||'{}')||{};}catch(e){_deskDet={};}}return !!_deskDet[id];}
function deskDetSave(id,open){deskDetOpen(id);if(open)_deskDet[id]=1;else delete _deskDet[id];try{localStorage.setItem(DESK_DET_LS,JSON.stringify(_deskDet));}catch(e){}}
const dkDetAttr=id=>` data-det="${id}"${deskDetOpen(id)?' open':''}`;
// Линия прибыли на графике «Акции»: переключатель на этом устройстве (localStorage, не снапшот), по умолчанию включён.
// Выключен — нет ни запроса ?financials=, ни линии.
const DESK_EARN_LS='dash_desk_earn';
function deskEarnOn(){try{return localStorage.getItem(DESK_EARN_LS)!=='0';}catch(e){return true;}}
function deskEarnSet(on){try{localStorage.setItem(DESK_EARN_LS,on?'1':'0');}catch(e){}}
// Параметры линии для stockChartDraw (state.earn) и ключ готовности: сменился ответ ?financials= или P/E — график
// перерисовывается (иначе канвас переносится как есть и линия не появилась бы до смены периода).
const _deskEarnBars={};   // 5 лет свечей для своей истории P/E: ключ → {at, fail} последней попытки (ошибка — повтор через 5 мин)
function deskEarnFor(it){
  if(!deskEarnOn())return {earn:null,key:'off'};
  const C=DESK_IDEA_CFG.earn,sym=it.sec.sym,hk=sym+':5y',hc=_histCache[hk],bars=hc&&hc.bars;deskFinLoad(sym);
  const L=_deskEarnBars[hk];
  if(!bars&&!(L&&(!L.fail||Date.now()-L.at<5*60e3))){const x=_deskEarnBars[hk]={at:Date.now(),fail:false};histBars(sym,'5y').catch(()=>{x.fail=true;}).then(()=>deskRender());}
  const c=_deskFin[sym],fin=(c&&c.data)||null,barsDone=!!bars||!!(_deskEarnBars[hk]&&_deskEarnBars[hk].fail);   // свечей нет — сектор/текущий без своей истории
  // P/E считается по отчётности и 5 годам цены; пока свечи грузятся — «загрузка» (fin не передаём).
  const ready=!!fin&&fin.status!=='error'&&barsDone;
  const own=ready&&bars?chartEarnPe(bars,fin,{ccy:it.sec.ccy,fx:FX,peMin:C.peMin,peMax:C.peMax,years:C.ownYears,minYears:C.ownMin}):null;
  const P=ready?deskEarnPe(it.sec.tk,own):null;
  const earn=Object.assign({},C,{fin:ready||(fin&&fin.status==='error')?fin:null,pe:P&&P.pe,peSrc:P&&P.src,peCur:P&&P.cur,peSkip:P?P.skip:[],peOwn:own,ccy:it.sec.ccy,fx:FX});
  return {earn,key:(fin?(fin.fetchedAt||'')+'|'+fin.status:'wait')+'|'+(ready?'r':'-')+'|'+(P?P.src+P.pe:'-')};
}
const dkHow=(id,body,title)=>`<details class="dk-how"${dkDetAttr(id)}><summary>${title||RT('Как рассчитано','How it’s calculated')}</summary><div class="dk-how-b">${body}</div></details>`;
// Уровень риска 1–5 (deskRiskLevel): пять делений + слово; «вручную» — если перекрыт в идее.
function dkRiskMeter(R){
  const lbl=`<span>${RT('Риск','Risk')}</span>`;
  if(!R||!R.level)return `<div class="dk-risk-scale"${dkG('risk-level')}>${lbl}<b class="dk-mut">—</b></div>`;
  return `<div class="dk-risk-scale l${R.level}"${dkG('risk-level')} role="img" aria-label="${RT('Риск','Risk')} ${R.level}/5 — ${dkEsc(R.word)}">${lbl}${[1,2,3,4,5].map(i=>`<i class="${i<=R.level?'on':''}"></i>`).join('')}<b>${dkEsc(R.word)}</b>${R.ovr?`<small>${RT('вручную','manual')}</small>`:''}</div>`;
}
function dkRiskHow(R,s){
  const C=DESK_IDEA_CFG.risk,t=C.atrPct;
  if(!R||R.auto==null)return `<p>${RT('Снимка v2 нет (свечи ещё грузятся) — авто-уровень не посчитан.','No v2 snapshot yet (candles loading) — the auto level is not computed.')}${R&&R.ovr?' '+RT(`Задан вручную: ${R.ovr}.`,`Set manually: ${R.ovr}.`):''}</p>`;
  const lbl={wide:RT(`широкий стоп плана (> ${SIG.CFG.wideAtr}·ATR)`,`wide plan stop (> ${SIG.CFG.wideAtr}·ATR)`),earnings:RT(`отчёт в ближайшие ${SIG.CFG.earnDays} дн`,`earnings within ${SIG.CFG.earnDays} d`),knife:RT('фаза «падающий нож»','“falling knife” phase'),'stale-target':RT('таргет аналитиков устарел','analyst target is stale'),beta:RT('бета','beta')};
  const L=R.parts.map(p=>p.k==='atr'?`<li>${RT(`Дневной ATR 14 = <b>${dkN(p.v,2)} %</b> цены → база <b>${p.add}</b> (≤ ${t[0]} % → 1 · ≤ ${t[1]} → 2 · ≤ ${t[2]} → 3 · ≤ ${t[3]} → 4 · больше → 5)`,`Daily ATR 14 = <b>${dkN(p.v,2)} %</b> of price → base <b>${p.add}</b> (≤ ${t[0]} % → 1 · ≤ ${t[1]} → 2 · ≤ ${t[2]} → 3 · ≤ ${t[3]} → 4 · above → 5)`)}</li>`
    :`<li>+1 · ${lbl[p.k]||dkEsc(p.k)}${p.k==='beta'?` ${dkN(p.v,2)} &gt; ${C.betaHi}`:''}</li>`).join('');
  return `<ul>${L}</ul><p>${RT(`Авто-уровень = min(5, сумма) = <b>${R.auto}</b> «${dkEsc(deskRiskWord(R.auto))}».`,`Auto level = min(5, sum) = <b>${R.auto}</b> “${dkEsc(deskRiskWord(R.auto))}”.`)}${R.ovr?' '+RT(`В идее задан вручную: <b>${R.ovr}</b> — он и показан.`,`Set manually in the idea: <b>${R.ovr}</b> — shown above.`):''}</p>
    <p class="dk-mut">${RT('Снимок v2 от','v2 snapshot of')} ${dkEsc(s&&s.d||'—')} · SIG ${dkEsc(SIG.VER)}</p>`;
}
// Бета из строки-источника бумаги (колонка «Beta», если есть).
function deskBeta(it){return deskRowNum(it,'Beta');}
// Открытый риск книги выбранного портфеля (или всех моих при «Все портфели»): сумма bookRiskState.
function deskOpenRisk(){
  const port=deskPort(),tabs=port==='all'?deskPorts():(port?[port]:[]),rs=tabs.map(t=>bookRiskState(t));
  const open=rs.reduce((a,r)=>a+r.openRiskSEK,0),cap=rs.reduce((a,r)=>a+r.capSEK,0),eq=rs.reduce((a,r)=>a+r.equitySEK,0);
  const noStop=tabs.reduce((a,t)=>a+bookPositions(t).filter(p=>!p.stop).length,0);
  return {tabs,open,cap,eq,noStop,pctCap:cap>0?open/cap*100:null,over:open>cap*(1+1e-9)&&open>0};
}

// Мои портфели (редактируемые, разрешённые RBAC) и выбранный для риска/книги.
function deskPorts(){return Object.keys(DATA||{}).filter(k=>pf3MyPort(k)&&tabAllowed(k));}
// AI-портфель (S7b-2, §3.2 карты) — только фильтр «Позиций» и только просмотр: в риск, «Что если?», исполнение не идёт.
const deskAipOk=()=>can('view.ai_portfolio')&&!!(DATA[PF3_KEY]);
function deskPort(){const P=deskPorts();if(DESK_UI.port&&(DESK_UI.port==='all'||P.includes(DESK_UI.port)||DESK_UI.port===AIP_KEY&&DESK_UI.route==='book'&&deskAipOk()))return DESK_UI.port;return P.includes(PF3_KEY)?PF3_KEY:(P[0]||null);}
function deskRiskTab(){const p=deskPort();return p&&p!=='all'&&p!==AIP_KEY?p:(deskPorts()[0]||null);}
// Разделы книги/журнала про один портфель: выбранный, а из «Все портфели» — портфель риска (подпись это говорит).
function deskOnePort(){const p=deskPort();return p&&p!=='all'?p:deskRiskTab();}
// Контекст встроенных блоков классики (S7b-2, карта §6): они читают v3Key/curIdx/pf3Tab, их асинхронные хвосты
// (календарь, риск, развитие портфелей, AI, пре/пост) сверяют isV3()/pf3Tab и зовут renderPF3 → deskRender.
function deskCtx(tab,sub,sel){if(!tab||!DATA[tab])return false;curIdx=tab;v3Key=tab;pf3Tab=sub||'list';pf3Sel=sel==null?null:sel;return true;}
// Разовая отрисовка блока классики в чужом контексте (история сделок бумаги из «Решения») — контекст возвращается.
function deskWithCtx(tab,fn){const o=[curIdx,v3Key,pf3Tab,pf3Sel];try{return deskCtx(tab,o[2],o[3])?fn():'';}finally{[curIdx,v3Key,pf3Tab,pf3Sel]=o;}}
// Открыть «Акцию» по тикеру из встроенного блока классики (пиры оценки, календарь, новости) — вместо классической карточки.
function deskOpenTk(tk){
  const U=posTk(tk),I=deskItems(),it=I.items.find(x=>x.sec.tk===U)||I.items.find(x=>posTk(x.sec.tk)===U);
  if(!it)return toast(RT('Бумага не найдена во вкладках','Stock not found in tabs'),true);
  deskGo('stock',it.key,'decision');
}
function deskRiskKr(){const t=deskRiskTab();let k=0;try{k=t?bookRiskState(t).riskKr:0;}catch(e){}return k>0?k:5000;}
// Вселенная + снимки v2 (мемо sigSnapRow). Кэшируется на один проход отрисовки.
let _deskItems=null;
function deskItems(){
  if(_deskItems)return _deskItems;
  const U=deskUniverse(),rk=deskRiskKr(),items=[],byKey={};
  U.list.forEach(sec=>{
    const src=sec.src,d=src&&DATA[src.tab],r=d&&d.rows&&d.rows[src.i];let s=null;
    if(r){try{s=sigSnapRow(d,r,rk);}catch(e){s=null;}}
    const it={sec,d,r,tab:src&&src.tab,s,key:sec.key};items.push(it);byKey[sec.key]=it;
  });
  return (_deskItems={items,byKey,tabsN:U.tabsN});
}
// Книга: позиции выбранного портфеля (или всех моих) + снимок и действие.
function deskBook(){
  const port=deskPort(),tabs=port==='all'?deskPorts():(port?[port]:[]),I=deskItems(),out=[];
  tabs.forEach(tab=>bookPositions(tab).forEach(p=>{
    const it=I.byKey[p.sym+'|'+p.ccy]||null,s=it&&it.s,earn=sigEarnDays(p.sym);
    out.push(Object.assign(p,{it,s,earn},deskPosAct(p,s,earn)));
  }));
  return out;
}
function deskSecOf(key){const I=deskItems();return I.byKey[key]||null;}

// P1: адаптер отбора — только чтение строк/кэшей, без fetch, теневого журнала и записи состояния.
// Каждый вызов заново проверяет доступ и контекст; кэша моделей между аккаунтами/портфелями нет.
function deskSelectionConfig(){
  return Object.assign({},DESK_IDEA_CFG.selection,{weights:PF3_BETYG_WEIGHTS,grade:pf3Grade,
    nearZonePct:DESK_IDEA_CFG.nearZonePct,staleMin:DESK_IDEA_CFG.whatIf.staleMin,rrOk:SIG.rrOk,rrWeak:SIG.CFG.rrWeak});
}
// Старый ticker-cache без валюты/листинга не доказывает сопоставимость даже при одной видимой строке.
function deskSelectionCache(cache,sec){
  const v=cache&&(cache[sec.tk]||cache[posTk(sec.tk)]);if(!v)return {data:null,reason:null,ccy:null};
  const ccy=String(v.ccy||v.currency||'').trim().toUpperCase(),sym=v.sym||v.symbol;
  const ok=ccy===sec.ccy&&(sym?sym===sec.sym:exSymbol(sec.tk,ccy)===sec.sym)&&(!v.scale||v.scale===1);
  return {data:ok?v:null,reason:ok?null:'cache-incomparable',ccy:ok?ccy:null};
}
// Риск на сделку — тот же, что у deskItems (deskRiskKr), иначе ключ мемо SIGNALS не совпадёт и каждый
// пересчёт подборок заново зовёт SIG.snapshot для всей вселенной (§15 #3).
function deskSelectionRiskKr(selectedPortfolio){
  return selectedPortfolio&&selectedPortfolio!=='all'?sigRiskKr(selectedPortfolio):deskRiskKr();
}
function deskSelectionInput(key,selectedPortfolio,now,universe,riskKr){
  now=now==null?Date.now():now;
  if(!can('view.portfolio'))return null;
  const U=universe||deskUniverse(now),sec=U.bySym[key];
  if(!sec)return null;
  const tabs=sec.tabs.filter(tabAllowed);if(!tabs.length)return null;
  if(selectedPortfolio&&selectedPortfolio!=='all'&&(!tabAllowed(selectedPortfolio)||!pf3MyPort(selectedPortfolio)))return null;
  const tab=sec.src&&tabs.includes(sec.src.tab)?sec.src.tab:tabs[0],d=DATA[tab],rowKey=row=>{const q=secFromRow(d,row,tab,now);return q&&q.key;};
  // Строка-источник deskUniverse (O(1)); поиск по вкладке — только если строки сдвинулись после сборки вселенной.
  const ri=d&&sec.src&&sec.src.tab===tab?d.rows[sec.src.i]:null;
  const r=ri&&rowKey(ri)===key?ri:d&&d.rows.find(row=>rowKey(row)===key);if(!r)return null;
  const health=can('view.health'),valuationAllowed=can('view.valuation'),planAllowed=can('view.plan');
  const metrics=pf3TypeMetrics(d,r),fc=health&&PF_FUND[sec.sym];
  // Числа из битого кэша не должны превращаться в нулевые/максимальные столпы pf3Scores.
  const raw=fc&&fc.data,F=raw?Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,typeof v==='number'&&!Number.isFinite(v)?null:v])):null;
  const B=F?pf3Betyg(F,sec.tk,sec.sector):null;
  const vc=valuationAllowed?deskSelectionCache(VAL,sec):{data:null,reason:'valuation-restricted'};
  const tc=valuationAllowed?deskSelectionCache(TG_FULL,sec):{data:null,reason:null},V=vc.data;
  const watch=planAllowed?deskWatchGet(key):null;
  const s=sigSnapRow(d,r,riskKr>0?riskKr:deskSelectionRiskKr(selectedPortfolio),now,true);
  const lv=PX_LIVE[sec.sym],live=lv&&deskSelNum(lv.price)>0;
  const price=live?lv.price:sec.price,observedAt=live?lv.at:null;
  const fv=valuationAllowed?deskFairValue(watch,tc.data,price):{value:null,src:null};
  const fvCurrency=fv.src==='scenarios'?watch.ccy:fv.src==='analysts'?tc.ccy:null;
  const pe=valuationAllowed?(V?deskSelNum(V.pe):F?deskSelNum(F.pe):null):null,eps=valuationAllowed&&F?deskSelNum(F.eps):null;
  const risk=deskRiskLevel(s,{plan:s&&s.plan,beta:metrics.beta,riskOvr:watch&&watch.riskOvr});
  const pos=selectedPortfolio&&selectedPortfolio!=='all'?bookPositions(selectedPortfolio).find(p=>p.sym===sec.sym&&p.ccy===sec.ccy):null;
  const businessReasons=health?[]:['business-restricted'];
  const fetched=fc?deskSelTime(fc.at):null;
  if(F&&(fetched==null||fetched>now))businessReasons.push('business-fetch-date-unknown');
  else if(F&&now-fetched>6*3600e3)businessReasons.push('business-cache-stale'); // существующий TTL PF_FUND
  const growth=F?deskSelNum(F.revenueYoY):health?metrics.revg:null;
  return {identity:{key:sec.key,sym:sec.sym,tk:sec.tk,ccy:sec.ccy,sector:sec.sector,tabs,
      held:(sec.held||[]).filter(p=>tabs.includes(p.tab)).map(p=>({tab:p.tab}))},
    price:{value:price,observedAt,freshness:live?'fresh':'unknown'},
    business:{pillars:B?B.pillars.filter(p=>p.key!=='val'):[],mode:F?'fundamental':health?'lite':'missing',
      notApplicable:pf3FinSec(sec.sector)?['balance','cash']:[],asOf:F&&F.asOf||null,fetchedAt:fc&&fc.at||null,
      reasonCodes:businessReasons,facts:{roe:health?metrics.roe:null,revenueGrowth:growth,growthBasis:growth!=null?'actual':null}},
    valuation:{value:fv.value,source:fv.src,currency:fvCurrency,comparable:!!fv.src&&fvCurrency===sec.ccy,
      // TG_FULL.at — время загрузки, не дата источника. updatedAt списка также не дата оценки.
      asOf:fv.src==='analysts'?tc.data.lastDate||null:null,fetchedAt:fv.src==='analysts'?tc.data.at||null:null,
      warnings:[vc.reason,tc.reason].filter(Boolean),stale:!!(s&&(s.flags||[]).includes('stale-target')),
      peContext:{value:pe,eps,source:V?'valuation':F?'fundamentals':null,asOf:V&&V.at||F&&F.asOf||null,
        historical:V?deskSelCopy(V.hist||null):null,comparable:pe>0&&(eps==null||eps>0),
        reasonCodes:eps!=null&&eps<=0?['pe-nonpositive-eps']:pe>0?[]:['pe-missing']}},
    signal:s?Object.assign({},s,{version:SIG.VER,usable:!!(_histCache[sigHistKey(sec.sym)]&&
      _histCache[sigHistKey(sec.sym)].t<=now&&now-_histCache[sigHistKey(sec.sym)].t<=SIG_TTL)}):null,
    risk:{auto:risk.auto,override:risk.ovr,level:risk.level,reasons:risk.parts.map(p=>p.k),parts:risk.parts},
    position:pos?{tab:pos.tab,side:pos.side,action:deskPosAct(pos,s,sigEarnDays(sec.sym,now))}:null,
    context:{selectedPortfolio:selectedPortfolio||null,now,config:deskSelectionConfig(),permissions:{view:true,
      trade:can('action.edit_trades'),refresh:can('action.refresh_data'),editPlan:can('action.edit_plan')}},
    watch:watch?{key:watch.key,zone:deskWatchZone(watch,price),source:watch.buySrc,planId:watch.planId}:null};
}
function deskSelectionModels(selectedPortfolio,now){
  now=now==null?Date.now():now;if(!can('view.portfolio'))return [];
  const U=deskUniverse(now),rk=deskSelectionRiskKr(selectedPortfolio);
  return U.list.map(sec=>deskSelectionModel(deskSelectionInput(sec.key,selectedPortfolio,now,U,rk))).filter(Boolean);
}
function deskSelectionBuckets(selectedPortfolio,now){
  return deskPickBuckets(deskSelectionModels(selectedPortfolio,now),SIG.cmp,DESK_IDEA_CFG.selection);
}

// P5b (plans/stock-selection-ux.md §7): журнал результатов выбора — запись только кнопкой «Отслеживать результат»
// в «Решении», расчёт — при открытии «Журнал → Наблюдения» (deskJournalEnsure). Хранение и чистый расчёт — desk-journal.js.
// Версия допущений комиссии: параметры tradeFeeNative для валюты. Сменились — net записей со старой версией не считается.
function deskJournalCostV(ccy){
  const c=String(ccy||'USD').toUpperCase();
  return 'fee1|'+COURTAGE_PCT+'|'+(COURTAGE_MIN[c]!=null?COURTAGE_MIN[c]:6)+'|'+(c==='SEK'?0:FX_FEE_PCT)+(c==='GBP'?'|uk0.5+1.5':'');
}
// Вход записи из модели «Решения» — без новых загрузок. Исходные признаки — компактный снимок измерений на момент
// записи (не пересчитываются сегодняшним фундаменталом). Сумма для net — бюджет «Что если?» (DESK.whatIf) в kr,
// переведённый в валюту бумаги курсом записи; у доли — от капитала портфеля «Акции».
function deskJournalInput(it,m,port,side){
  const sec=it.sec,q=m.quality||{},v=m.valuation||{},t=m.timing||{},rk=m.risk||{},B=(m.selection&&m.selection.buckets)||[];
  const W=deskNorm(DESK).whatIf,fx=FX[sec.ccy]>0?FX[sec.ccy]:null;
  let budget=W.mode==='weight'?null:W.amountSEK;
  if(W.mode==='weight'&&port){try{budget=bookRiskState(port).equitySEK*W.weightPct/100;}catch(e){budget=null;}}
  return {key:sec.key,sym:sec.sym,ccy:sec.ccy,side:side==='short'?'short':'long',
    selectionVersion:DESK_SELECTION_V,signalVersion:t.version||SIG.VER,
    bucket:DK_BUCKET_DEF.map(d=>d[0]).find(k=>B.includes(k))||null,
    dimensions:{quality:{mode:q.mode||null,value:_djR(q.value,2),grade:q.grade||null,coverage:_djR(q.coverage,2)},
      valuation:{status:v.status||null,source:v.source||null,upsidePct:_djR(v.upsidePct,1)},
      timing:{verdict:t.verdict||null,phase:(t.phase&&t.phase.key)||null,planMode:(t.plan&&t.plan.mode)||null,waitingLevel:t.waitingLevel!=null?t.waitingLevel:null,flags:(t.flags||[]).slice(0,8)},
      risk:{level:rk.level!=null?rk.level:null,auto:rk.auto!=null?rk.auto:null,override:rk.override!=null?rk.override:null},
      action:(m.action&&m.action.key)||null,buckets:B.slice(),port:port||null},
    observedPrice:m.price&&m.price.value,observationAsOf:deskSelTime(m.price&&m.price.observedAt),
    benchmark:deskJournalBenchmark(sec.ccy),
    costAssumptions:budget>0&&fx>0?{v:deskJournalCostV(sec.ccy),model:'tradeFeeNative',mode:W.mode,amountSEK:Math.round(budget),fx,notional:Math.round(budget/fx*100)/100}:null};
}
// Разобранный журнал аккаунта: повторный разбор — только если строка хранилища сменилась (другая вкладка, запись).
let _deskJ=null;
function deskJournalCur(){
  const k=deskJournalKey();if(!k)return {items:[],error:'no-account'};
  let raw=null;try{raw=localStorage.getItem(k);}catch(e){}
  if(_deskJ&&_deskJ.k===k&&_deskJ.raw===raw)return _deskJ.R;
  const R=deskJournalRead();_deskJ={k,raw,R};return R;
}
// «Отслеживать результат»: явная запись идеи. Без аккаунта, при дубле, лимите или ошибке хранилища — видимый отказ.
function deskJournalTrack(key){
  const it=deskSecOf(key);if(!it||!can('view.portfolio'))return;
  if(!deskJournalKey())return toast(RT('Наблюдения ведутся для аккаунта — войдите, чтобы отслеживать идеи','Tracking is kept per account — sign in to track ideas'),true);
  const held=deskHeld(it),port=deskStockPort(held),m=deskStockModel(it,held);
  if(!m)return toast(RT('Анализ бумаги недоступен — записывать нечего','Stock analysis unavailable — nothing to record'),true);
  const now=Date.now(),r=deskJournalRecordAdd(deskJournalInput(it,m,port,held?held.side:'long'),{id:'j'+now.toString(36)+Math.random().toString(36).slice(2,7),now});
  _deskJ=null;
  if(r.ok)toast('👁 '+RT(`${it.sec.tk}: наблюдение записано — вход по закрытию первой сессии после записи`,`${it.sec.tk}: tracked — entry at the close of the first session after now`));
  else if(r.reason==='duplicate')toast(RT('Эта идея уже отслеживается сегодня (та же версия отбора)','This idea is already tracked today (same selection version)'));
  else if(r.reason==='limit'){toast(RT('Журнал наблюдений заполнен — экспортируйте и очистите завершённые','The tracking journal is full — export and clear completed'),true);DESK_UI.jt='ideas';deskGo('journal');return;}
  else toast(RT('Наблюдение не сохранено: ','Tracking not saved: ')+(r.error||r.reason),true);
  deskRender(true);
}
function deskJournalTrackBtn(it){
  const R=deskJournalCur(),probe=deskJournalDedupKey({key:it.key,selectionVersion:DESK_SELECTION_V,recordedAt:Date.now()});
  if(!R.error&&R.items.some(r=>r&&deskJournalDedupKey(r)===probe))
    return `<button type="button" class="dk-btn" data-a="nav" data-r="journal" data-jt="ideas">✓ ${RT('Отслеживается','Tracked')} · ${RT('журнал','journal')} →</button>`;
  return `<button type="button" class="dk-btn" data-a="jtrack" data-k="${dkEsc(it.key)}"${dkG('track-idea')}>👁 ${RT('Отслеживать результат','Track the outcome')}</button>`;
}
// Догоняющий расчёт при открытии «Наблюдений» (§7): свечи бумаг с pending-записями и их индексов — через пул (2)
// общим кэшем истории; по готовности — патчи и одна запись. Пока сайт закрыт, наблюдение не ведётся — пропущенное
// досчитывается по истории. Бары разбираются один раз на загрузку серии (мемо по ключу и времени загрузки).
const _deskJFail={},_deskJBars={};
const deskJournalRange=(r,now)=>now-(r.recordedAt||now)>600*864e5?'5y':'2y';   // 2 года истории хватает на запись + 120 торговых дней
function deskJournalSeries(sym,rg,sess){
  const key=sym+':'+rg,hc=_histCache[key];if(!hc||!hc.j||!Array.isArray(hc.j.t)||!sess)return null;
  const m=_deskJBars[key];if(m&&m.at===hc.t&&m.tz===sess.tz)return m.S;
  const S=deskJournalBars({t:hc.j.t,c:hc.j.c,at:hc.t},sess,DESK_JOURNAL_CFG);_deskJBars[key]={at:hc.t,tz:sess.tz,S};return S;
}
function deskJournalEnsure(){
  if(DESK_UI.route!=='journal'||DESK_UI.jt!=='ideas'||!PRICE_PROXY||!can('view.portfolio'))return;
  const k=deskJournalKey();if(!k)return;
  const now=Date.now();
  if(DESK_UI._jClean!==k){DESK_UI._jClean=k;const c=deskJournalCleanupAndSave(now);_deskJ=null;
    if(c.ok&&c.removed)toast(RT(`Журнал наблюдений: удалено ${c.removed} завершённых старше ${DESK_JOURNAL_CFG.retainDays} дн`,`Tracking journal: removed ${c.removed} completed older than ${DESK_JOURNAL_CFG.retainDays} d`));}
  const R=deskJournalCur();if(R.error)return;
  const P=R.items.filter(r=>r&&r.status!=='complete'&&r.sym);if(!P.length)return;
  const need={};
  P.forEach(r=>{const rg=deskJournalRange(r,now),b=r.benchmark&&r.benchmark.symbol;need[r.sym+':'+rg]=[r.sym,rg];if(b)need[b+':'+rg]=[b,rg];});
  Object.keys(need).forEach(key=>{
    const [sym,rg]=need[key],hc=_histCache[key];
    if(hc&&now-hc.t<SIG_TTL||_deskJFail[key]&&now-_deskJFail[key]<SIG_TTL)return;
    deskPoolRun('jhist|'+key,()=>histBars(sym,rg).then(()=>{delete _deskJFail[key];},()=>{_deskJFail[key]=Date.now();}));
  });
  const patches={},o={now,cfg:DESK_JOURNAL_CFG,fee:tradeFeeNative,costV:deskJournalCostV};
  P.forEach(r=>{
    const rg=deskJournalRange(r,now),b=r.benchmark&&r.benchmark.symbol;
    const p=deskJournalEval(r,deskJournalSeries(r.sym,rg,deskJournalSession(r.sym,r.ccy)),b?deskJournalSeries(b,rg,deskJournalSession(b,r.benchmark.currency)):null,o);
    if(p)patches[r.id]=p;
  });
  if(!Object.keys(patches).length)return;
  const s=deskJournalPatchAndSave(patches);_deskJ=null;
  // Ошибку записи показываем один раз (перерисовка при каждой неудаче зациклила бы экран).
  if(s.ok||DESK_UI._jErr!==s.error){DESK_UI._jErr=s.ok?null:s.error;deskRender();}
}

// ── Монтирование, перерисовка ──
// Прокрутку при Back/Forward ставит deskPaint (экран рисуется асинхронно), не браузер.
function deskScrollMode(manual){try{if('scrollRestoration' in history)history.scrollRestoration=manual?'manual':'auto';}catch(e){}}
function deskEnable(){
  deskMount();deskScrollMode(true);
  deskFromHash();deskRender(true);
  deskLoad();deskQuotes();
  if(!DESK_UI._timer)DESK_UI._timer=setInterval(()=>{if(!document.hidden){deskQuotes();deskLoad();}},5*60e3);
}
function deskMount(){
  let el=document.getElementById('desk');
  if(el)return el;
  el=document.createElement('div');el.id='desk';el.className='dk-app';
  el.innerHTML=`<nav class="dk-rail" aria-label="${RT('Навигация','Navigation')}" id="dkRail"></nav><main class="dk-main" id="dkMain" tabindex="-1"></main><div id="dkModal"></div>`;
  // Skip-link (index.html) — первым в порядке табуляции, #desk сразу за ним.
  const sk=document.querySelector('body>.skip-link');
  document.body.insertBefore(el,sk?sk.nextSibling:document.body.firstChild);
  el.addEventListener('click',deskOnClick);
  el.addEventListener('change',deskOnChange);
  el.addEventListener('input',deskOnInput);
  el.addEventListener('keydown',deskOnInputKey);
  // S7b-2: черновики полей встроенных блоков классики (форма плана, записи сделки, чат AI…) — см. deskDraftRestore.
  // Сброс — только если обработчик блока (inline onclick/onsubmit) запросил перерисовку, т.е. действие прошло; отказ с
  // тостом («укажите тикер») перерисовку не зовёт — черновик остаётся. Счётчик DESK_UI._rq растит deskRender.
  el.addEventListener('input',deskDraftNote);el.addEventListener('change',deskDraftNote);
  const act='.dk-classic button,.dk-classic [type="submit"],.dk-classic a[onclick]';
  el.addEventListener('click',e=>{DESK_UI._rq0=DESK_UI._rq;},true);
  el.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest(act);if(b&&DESK_UI._rq!==DESK_UI._rq0)DESK_UI.draft={};});
  el.addEventListener('submit',e=>{DESK_UI._rq0=DESK_UI._rq;},true);
  el.addEventListener('submit',e=>{if(!(e.target.closest&&e.target.closest('.dk-classic')))return;
    if(DESK_UI._rq!==DESK_UI._rq0){DESK_UI.draft={};const a=document.activeElement;if(a&&e.target.contains(a))a.blur();}});   // Enter в поле (чат AI): снять фокус — отложенная перерисовка покажет «думаю…»
  el.addEventListener('toggle',e=>{const d=e.target;if(!d||!d.dataset)return;   // toggle не всплывает
    if(d.dataset.det)deskDetSave(d.dataset.det,d.open);
    if(d.dataset.det==='st-ana'&&d.open)deskFanAttach();
    // Ленивые блоки (S7b-2): тело рисуется только раскрытым — сценарии (запрос implied move), подробная оценка.
    if(d.dataset.lazy&&d.open&&!d.querySelector('.dk-lazy-b'))deskRender(true);
    // «Рост бизнеса»: запрос — только по раскрытию; перерисовка — лишь при смене состояния (иначе toggle от
    // перерисованного open-блока зациклил бы рендер).
    const fk=d.dataset.fin;if(fk==null)return;
    if(d.open&&DESK_UI.finOpen!==fk){DESK_UI.finOpen=fk;deskFinLoad(d.dataset.sym);deskRender(true);}
    else if(!d.open&&DESK_UI.finOpen===fk){DESK_UI.finOpen=null;deskRender(true);}
  },true);
  el.addEventListener('mouseover',e=>{const g=e.target.closest&&e.target.closest('.dk-fb');if(g)deskFinTip(g,true);});
  el.addEventListener('mouseout',e=>{const g=e.target.closest&&e.target.closest('.dk-fb');if(g&&!g.contains(e.relatedTarget)&&document.activeElement!==g)deskFinTip(g,false);});
  el.addEventListener('focusin',e=>{const g=e.target.closest&&e.target.closest('.dk-fb');if(g)deskFinTip(g,true);});
  // Порядок списка покупок перетаскиванием — только мышь (draggable ставится при pointer:fine); клавиатура — кнопки меню.
  el.addEventListener('dragstart',e=>{const c=e.target.closest&&e.target.closest('[data-wk]');if(!c)return;DESK_UI.drag=c.dataset.wk;try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',c.dataset.wk);}catch(x){}c.classList.add('drag');});
  el.addEventListener('dragover',e=>{if(!DESK_UI.drag)return;const c=e.target.closest&&e.target.closest('[data-wk]');if(!c)return;e.preventDefault();el.querySelectorAll('.dk-wcard.over').forEach(x=>{if(x!==c)x.classList.remove('over');});if(c.dataset.wk!==DESK_UI.drag)c.classList.add('over');});
  el.addEventListener('drop',e=>{const from=DESK_UI.drag;if(!from)return;e.preventDefault();DESK_UI.drag=null;const c=e.target.closest&&e.target.closest('[data-wk]');if(c&&c.dataset.wk!==from)deskWatchDrop(from,c.dataset.wk);else deskRender(true);});
  el.addEventListener('dragend',()=>{if(DESK_UI.drag){DESK_UI.drag=null;deskRender(true);}});
  el.addEventListener('focusout',e=>{const g=e.target.closest&&e.target.closest('.dk-fb');if(g)deskFinTip(g,false);if(e.target&&e.target.id==='dkQ')setTimeout(()=>{const sg=document.getElementById('dkSugg');if(sg&&document.activeElement!==e.target)sg.hidden=true;},200);if(DESK_UI._pending)setTimeout(()=>{if(DESK_UI._pending&&!deskTyping())deskRender();},120);});
  return el;
}
const deskTyping=()=>{const a=document.activeElement,el=document.getElementById('desk');return !!(a&&el&&el.contains(a)&&/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));};
// Перерисовка с дебаунсом (renderAll/renderPF3 зовут её часто). Фоновая перерисовка не ломает ввод: пока фокус
// в поле desk, она откладывается до ухода фокуса. force — действие пользователя, рисуем сразу.
function deskRender(force){
  DESK_UI._rq=(DESK_UI._rq||0)+1;   // S7b-2: признак «действие перерисовало экран» для черновиков (deskMount)
  if(!force&&deskTyping()){DESK_UI._pending=true;return;}
  clearTimeout(DESK_UI._t);
  DESK_UI._t=setTimeout(deskPaint,force?0:60);
}
function deskFromHash(){
  const H=deskHashParse(location.hash);if(!H)return;
  if(H.route)DESK_UI.route=H.route;
  if(H.key)DESK_UI.key=H.key;
  if(H.route==='stock')DESK_UI.stockView=H.view;   // адрес без режима — «Решение»
}
// Прокрутка уходящего экрана — в его запись истории: Back вернёт место (фильтры/режим живут в DESK_UI и адресе).
function deskHistSave(){try{history.replaceState(Object.assign({},history.state||{},{dkY:window.scrollY||0}),'',location.href);}catch(e){}}
// view: режим «Акции». Прямой вход в бумагу (карточка, поиск, адрес без режима) — «Решение»; возврат через рельсу
// к той же бумаге сохраняет последний режим.
function deskGo(r,key,view){
  const prev=DESK_UI.key;
  if(key)DESK_UI.key=key;
  if(r==='compare'&&DESK_UI.route!=='compare')DESK_UI._cmpFrom=DESK_UI.route;   // «← Назад» сравнения — history.back() к этому экрану
  if(r==='stock')DESK_UI.stockView=DK_VIEWS.includes(view)?view:(key&&key!==prev?'decision':DESK_UI.stockView||'decision');
  DESK_UI.route=r;DESK_UI.menu=false;DESK_UI.exec=null;DESK_UI.edit=null;DESK_UI.wiRaw=null;DESK_UI.fix=null;DESK_UI.draft={};
  if(typeof deskTipHide==='function')deskTipHide(false);
  const h=deskHashOf(r,DESK_UI.key,DESK_UI.stockView);
  if(location.hash!==h){deskHistSave();try{history.pushState({dk:1},'',h);}catch(e){location.hash=h;}}
  deskRender(true);
  try{window.scrollTo(0,0);}catch(e){}
}
// Смена режима «Акции» — replaceState: Back не ходит по вкладкам, но возвращает бумагу в её режиме.
function deskStockView(v){
  v=DK_VIEWS.includes(v)?v:'decision';
  if(DESK_UI.stockView===v&&DESK_UI.route==='stock')return;
  DESK_UI.stockView=v;DESK_UI.edit=null;DESK_UI.wiRaw=null;
  if(typeof deskTipHide==='function')deskTipHide(false);
  const h=deskHashOf('stock',DESK_UI.key,v);
  if(location.hash!==h){try{history.replaceState(history.state,'',h);}catch(e){}}
  deskRender(true);
}
// Графики: при перерисовке того же экрана канвас переносится в новый контейнер (без перерисовки и мигания).
// Брошенное состояние гасится: destroy (канвас + ResizeObserver) и сдвиг _tok — поздний ответ stockChartDraw
// этого состояния сверяет токен и ничего не рисует (иначе он лёг бы вторым канвасом в новый контейнер).
function deskChartKill(st){if(!st)return;st._tok=(st._tok||0)+1;st._loading=false;if(st.ch){try{st.ch.destroy();}catch(e){}st.ch=null;}}
function deskPaint(){
  DESK_UI._pending=false;_deskItems=null;
  const root=deskMount(),main=document.getElementById('dkMain'),rail=document.getElementById('dkRail');
  rail.innerHTML=deskRailHTML();
  const keep={};['dkChart','dkMini','dkFan','pfPerfBox'].forEach(id=>{const e=document.getElementById(id);if(e&&e.firstChild)keep[id]=e;});
  const scr=DESK_UI._restoreY!=null?DESK_UI._restoreY:(window.scrollY||0);DESK_UI._restoreY=null;   // Back/Forward — место из history.state
  {const cb=document.getElementById('aiChatBox');DESK_UI._chat=cb?{top:cb.scrollTop,bottom:cb.scrollHeight-cb.scrollTop-cb.clientHeight<24,n:cb.children.length}:null;}   // S7b-2: прокрутка чата AI
  // Фокус клавиатуры переживает перерисовку (фоновые догрузки свечей/котировок перерисовывают экран): тот же id
  // или тот же data-a/data-k/data-v в новом DOM.
  const ae=document.activeElement,q=v=>CSS.escape(String(v));
  const fk=ae&&ae!==main&&root.contains(ae)?(ae.id?'#'+q(ae.id):ae.dataset&&ae.dataset.a?`[data-a="${q(ae.dataset.a)}"]`+['k','v','r','g'].map(f=>ae.dataset[f]!=null?`[data-${f}="${q(ae.dataset[f])}"]`:'').join(''):null):null;
  const fi=fk?[...root.querySelectorAll(fk)].indexOf(ae):-1;   // одинаковых (две ⓘ с одним id) — та же по счёту
  deskCompareKeys();   // P4: выбор сравнения сверяется с аккаунтом и доступом до того, как чекбоксы экрана его прочитают
  let html='';
  try{html=({today:deskTodayHTML,screen:deskScreenHTML,stock:deskStockHTML,book:deskBookHTML,journal:deskJournalHTML,compare:deskCompareHTML,service:deskServiceHTML})[DESK_UI.route]();}
  catch(e){console.error(e);html=`<div class="dk-panel dk-empty">${RT('Ошибка экрана: ','Screen error: ')}${dkEsc(e.message||e)}</div>`;}
  main.innerHTML=deskTopHTML()+html+deskCmpTrayHTML();
  // Вселенная сменилась (вход/синк/RBAC/новые вкладки) — догрузить свечи новых бумаг (кэшированные пропускаются).
  const L=DESK_UI.load,I=deskItems();
  if(!L.busy&&L.at&&L.key!==I.items.length+'|'+I.tabsN)setTimeout(()=>deskLoad(true),0);
  document.getElementById('dkModal').innerHTML=deskModalHTML();
  deskChartsAttach(keep);deskPerfAttach(keep.pfPerfBox);deskDraftRestore();
  deskCompanyEnsure();deskCompareEnsure();deskJournalEnsure();deskClassicAfter();
  if(fk&&document.activeElement!==ae){const L=root.querySelectorAll(fk),n=L[fi]||L[0];if(n)try{n.focus({preventScroll:true});}catch(e){}}
  try{window.scrollTo(0,scr);}catch(e){}
  document.title=RT('Trade Desk','Trade Desk')+' · '+deskRouteLabel(DESK_UI.route);
  root.classList.toggle('dk-drawer-open',DESK_UI.route==='screen'&&!!DESK_UI.sel);
  if(typeof deskTipAfterPaint==='function')deskTipAfterPaint();
}
function deskChartsAttach(keep){
  // Акция → «Техника»: большой график; Скринер: мини-график инспектора. Контейнер тот же бумаги/периода → переносим
  // канвас. Нет контейнера (другой режим/экран) — график и наблюдатели освобождаются.
  const want=[];
  if(DESK_UI.route==='stock'&&DESK_UI.stockView==='tech'){const it=deskSecOf(DESK_UI.key);if(it&&it.r)want.push(['dkChart',it,DESK_UI.years,'_deskChart']);}
  if(DESK_UI.route==='screen'&&DESK_UI.sel){const it=deskSecOf(DESK_UI.sel);if(it&&it.r)want.push(['dkMini',it,1,'_deskMini']);}
  const used={_deskChart:false,_deskMini:false};
  want.forEach(([id,it,years,slot])=>{
    const box=document.getElementById(id);if(!box)return;used[slot]=true;
    const cur=slot==='_deskChart'?_deskChart:_deskMini,side=deskSideFor(it),E=slot==='_deskChart'?deskEarnFor(it):{earn:null,key:'off'};
    if(cur&&cur.key===it.key&&cur.years===years){
      if(cur._loading){cur.side=side;cur.earn=E.earn;cur.ek=E.key;return;}   // рисуется: stockChartDraw сам найдёт новый контейнер по id и возьмёт earn
      if(cur.ch&&keep[id]&&cur.ek===E.key){box.replaceWith(keep[id]);if(cur.side!==side){cur.side=side;cur.ch.setSide(side);}return;}
    }
    deskChartKill(cur);
    // Позиция в моём портфеле — график от её строки (план позиции: средняя/стоп/цель из POS_META).
    const h=deskHeld(it),hd=h&&DATA[h.tab],hr=hd&&hd.rows.find(r=>posTk(r[2])===h.tk);
    const st={key:it.key,tab:hr?h.tab:it.tab,row:hr||it.r,ccy:it.sec.ccy,years,side,ch:null,_loading:true,earn:E.earn,ek:E.key};
    if(slot==='_deskChart')_deskChart=st;else _deskMini=st;
    stockChartDraw(st,id).catch(()=>{}).then(()=>{st._loading=false;});
  });
  if(!used._deskChart&&_deskChart){deskChartKill(_deskChart);_deskChart=null;}
  if(!used._deskMini&&_deskMini){deskChartKill(_deskMini);_deskMini=null;}
  deskFanAttach(keep.dkFan);
}
function deskRetheme(){
  [_deskChart,_deskMini].forEach(st=>{if(st&&st.ch){const id=st===_deskChart?'dkChart':'dkMini';stockChartDraw(st,id).catch(()=>{});}});
  if(_deskFan){if(_deskFan.ch)_deskFan.ch.destroy();_deskFan=null;deskFanAttach();}
}
// Сторона плана бумаги: выбранная вручную → сторона открытой позиции → сторона вердикта.
function deskSideFor(it){
  if(!it)return 'long';
  if(DESK_UI.side[it.key])return DESK_UI.side[it.key];
  const h=deskHeld(it);if(h)return h.side;
  return (it.s&&it.s.side)||'long';
}
// Сторона экрана «Акция» (§4): в «Технике» — моделируемая (deskSideFor); в «Решении»/«Компании» — сторона открытой
// позиции или лонг: переключатель Лонг/Шорт «Техники» не меняет незаметно лонг-отбор других режимов.
function deskStockSide(it){if(DESK_UI.stockView==='tech')return deskSideFor(it);const h=deskHeld(it);return h?h.side:'long';}
// Открытая позиция бумаги в моих портфелях (сначала выбранный).
function deskHeld(it){
  if(!it)return null;const P=deskPorts(),pref=deskPort();
  const tabs=(pref&&pref!=='all'?[pref]:[]).concat(P.filter(t=>t!==pref));
  for(const tab of tabs){const p=bookPositions(tab).find(x=>x.sym+'|'+x.ccy===it.key);if(p)return p;}
  return null;
}

// ── Загрузка данных: свечи вселенной (приоритет: книга → план → мои портфели → остальное), календарь, котировки ──
async function deskLoad(force){
  const L=DESK_UI.load;if(L.busy||typeof SIG==='undefined')return;
  if(!force&&L.at&&Date.now()-L.at<SIG_TTL)return;
  L.busy=true;L.at=Date.now();
  try{
    const U=deskUniverse();L.key=U.list.length+'|'+U.tabsN;
    const mine=new Set(deskPorts()),planSyms=new Set((PLAN_RULES||[]).filter(r=>!r.done).map(r=>exSymbol(r.tk,r.ccy||'USD')));
    const rank=sec=>sec.held.length?0:planSyms.has(sec.sym)?1:sec.tabs.some(t=>mine.has(t))?2:3;
    const syms=U.list.slice().sort((a,b)=>rank(a)-rank(b)).map(s=>s.sym);
    L.total=syms.length;L.done=0;
    for(let i=0;i<syms.length;i+=16){
      await sigEnsure(syms.slice(i,i+16));
      L.done=Math.min(L.total,i+16);
      deskRender();
    }
  }catch(e){console.warn('desk load',e);}
  L.busy=false;L.done=L.total;
  deskCal();
  deskRender();
}
// Календарь отчётов — только для бумаг, где он меняет решение: книга, список покупок и сетапы на вход (≤ 40 → 1 запрос).
async function deskCal(){
  if(Date.now()-DESK_UI.calAt<6*3600e3||!PRICE_PROXY)return;
  _deskItems=null;
  const I=deskItems(),rank=x=>x.sec.held.length?0:deskWatchGet(x.key)?1:2;
  const syms=[...new Set(I.items.filter(x=>x.sec.held.length||deskWatchGet(x.key)||(x.s&&(x.s.verdict==='buy'||x.s.verdict==='short'))).sort((a,b)=>rank(a)-rank(b)).map(x=>x.sec.sym))].slice(0,40);
  if(!syms.length)return;
  DESK_UI.calAt=Date.now();
  try{
    const j=await fetch(PRICE_PROXY+'?calendar='+encodeURIComponent(syms.join(','))).then(r=>r.json());
    if(j&&typeof j==='object'&&!j.error){pf3Cal.data=Object.assign({},pf3Cal.data||{},j);if(!pf3Cal.key)pf3Cal.key='__desk';deskRender();}
  }catch(e){DESK_UI.calAt=0;}
}
// Живые котировки моих портфелей (цена позиций, P&L, стопы) + сверка плана. S7b-2 (карта §4): и аналитические
// таргеты/метрики/типы моих портфелей — раз в сутки на вкладку (гейт внутри pf3RefreshTargets), как автообновление классики.
async function deskQuotes(manual){
  if(!PRICE_PROXY)return;
  if(!manual&&Date.now()-DESK_UI.qAt<4*60e3)return;
  DESK_UI.qAt=Date.now();
  let n=0;
  for(const tab of deskPorts()){try{n+=await pf3FetchPrices(DATA[tab],tab);pf3LastRefresh[tab]=Date.now();}catch(e){}try{await pf3RefreshTargets(DATA[tab]);}catch(e){}}
  try{planCheck();}catch(e){}
  if(manual)toast('🔄 '+RT(`Котировки: ${n} обновлено`,`Quotes: ${n} updated`),!n);
  deskRender();
}

// ── Каркас: рельса, шапка, меню ──
function deskRouteLabel(r){return ({today:RT('Сегодня','Today'),screen:RT('Идеи','Ideas'),stock:RT('Акция','Stock'),book:RT('Позиции','Positions'),journal:RT('Журнал','Journal'),compare:RT('Сравнение','Comparison'),service:RT('Сервис','Service')})[r]||r;}
function deskRailHTML(){
  const I=[['today','<path d="M4 7h16M4 12h10M4 17h7"/>'],['screen','<path d="M4 5h16l-6 8v6l-4-2v-4z"/>'],['stock','<path d="M3 17l5-6 4 4 5-8 4 5"/>'],['book','<path d="M5 4h14v16H5zM9 4v16M5 9h4M5 14h4"/>'],['journal','<path d="M6 3h9l4 4v14H6zM9 12h6M9 16h6"/>']];
  const ready=(PLAN_RULES||[]).filter(r=>!r.done&&planStatus(r).ready).length;
  return `<div class="dk-brand"><div class="dk-brand-mark">TD</div><div><div class="dk-brand-t">Trade Desk</div><div class="dk-brand-s">Nordic · SEK</div></div></div>`+
    I.map(([r,svg],i)=>`<button class="dk-nav${DESK_UI.route===r||r==='screen'&&DESK_UI.route==='compare'?' on':''}" data-a="nav" data-r="${r}"><svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>${deskRouteLabel(r)}${r==='today'&&ready?`<span class="dk-badge" title="${RT('Сработали правила плана','Plan rules fired')}">${ready}</span>`:''}<span class="dk-k">${i+1}</span></button>`).join('')+
    `<div class="dk-rail-foot">${RT('Главное сначала, детали по запросу.','Essentials first, details on demand.')}</div>`;
}
function deskMkt(){
  try{
    const f=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit',weekday:'short',hour12:false});
    const p=Object.fromEntries(f.formatToParts(new Date()).map(x=>[x.type,x.value])),hm=+p.hour*60+ +p.minute,wd=!/lör|sön/.test(p.weekday);
    return {se:wd&&hm>=540&&hm<1050,us:wd&&hm>=930&&hm<1320,t:`${p.hour}:${p.minute}`};
  }catch(e){return {se:false,us:false,t:''};}
}
function deskTopHTML(){
  const m=deskMkt(),L=DESK_UI.load,I=deskItems(),snaps=I.items.filter(x=>x.s).length;
  const prog=L.busy?`<span class="dk-chip dk-num" title="${RT('Дневные свечи 2 года для сигналов v2','2-year daily candles for signals v2')}">⏳ ${RT('свечи','candles')} ${L.done}/${L.total}</span>`:'';
  return `<div class="dk-top"><div class="dk-top-t"><h1>${deskRouteLabel(DESK_UI.route)}</h1><div class="dk-sub">${deskSubHTML(I,snaps)}</div></div>
    <div class="dk-mkt">${prog}<span class="dk-chip ${m.se?'open':''}"${dkG('universe')}><i></i>${RT('Стокгольм','Stockholm')}</span><span class="dk-chip ${m.us?'open':''}"${dkG('universe')}><i></i>${RT('США','US')}</span>${m.t?`<span class="dk-chip dk-num">${m.t} CET</span>`:''}</div>
    <div class="dk-search-w"><label class="dk-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="dkQ" data-c="gq" placeholder="${RT('Тикер или компания','Ticker or company')}" autocomplete="off" aria-label="${RT('Поиск бумаги','Find a stock')}"><span class="dk-k">/</span></label><div class="dk-sugg" id="dkSugg" hidden></div></div>
    <button class="dk-btn dk-sm" data-a="refresh" title="${RT('Обновить котировки портфелей и свечи','Refresh portfolio quotes and candles')}">⟳</button>
    <div class="dk-menu-w"><button class="dk-btn dk-sm" data-a="menu" aria-haspopup="true" aria-expanded="${DESK_UI.menu}" title="${RT('Меню','Menu')}">⋯</button>${DESK_UI.menu?deskMenuHTML():''}</div></div>`;
}
function deskSubHTML(I,snaps){
  const port=deskPort(),rk=deskRiskKr();
  const ports=deskPorts(),aip=DESK_UI.route==='book'&&deskAipOk(),sel=ports.length?`<select data-c="port" class="dk-sel" aria-label="${RT('Портфель','Portfolio')}">${DESK_UI.route==='book'||DESK_UI.route==='journal'?`<option value="all"${port==='all'?' selected':''}>${RT('Все портфели','All portfolios')}</option>`:''}${ports.map(k=>`<option value="${dkEsc(k)}"${k===port?' selected':''}>${dkEsc(TAB_LABEL(k))}</option>`).join('')}${aip?`<option value="${dkEsc(AIP_KEY)}"${port===AIP_KEY?' selected':''}>🤖 ${RT('AI-портфель (просмотр)','AI portfolio (view)')}</option>`:''}</select>`:'';
  const d=new Date().toLocaleDateString(LANG==='en'?'en-GB':'ru-RU',{weekday:'long',day:'numeric',month:'long'});
  return `${dkEsc(d)} · ${RT('вселенная','universe')} <b class="dk-num">${I.items.length}</b> ${RT('бумаг из','stocks from')} ${I.tabsN} ${RT('вкладок','tabs')}${snaps<I.items.length?` · ${RT('сигналы','signals')} ${snaps}/${I.items.length}`:''} · ${sel} <span${dkG('risk-cfg')}>${RT('риск на сделку','risk per trade')}</span> <b class="dk-num">${dkKr(rk)}</b>`;
}
function deskMenuHTML(){
  const it=(a,l,extra)=>`<button class="dk-mi" data-a="${a}"${extra||''}>${l}</button>`;
  const dark=document.documentElement.dataset.theme==='dark';
  return `<div class="dk-menu" role="menu">
    ${it('theme',(dark?'☀️ ':'🌙 ')+RT('Тема: '+(dark?'светлая':'тёмная'),'Theme: '+(dark?'light':'dark')))}
    ${it('lang','🌐 '+(LANG==='ru'?'English':'Русский'))}
    ${it('risk','⚖️ '+RT('Риск: ','Risk: ')+deskNorm(DESK).riskPct+'% · '+RT('лимит книги ','book cap ')+deskNorm(DESK).riskCapPct+'%')}
    ${it('tg','📨 '+RT('Telegram-алерты: ','Telegram alerts: ')+(deskNorm(DESK).tg?RT('вкл','on'):RT('выкл','off')),` title="${RT('Воркер по крону шлёт в Telegram пробой стопа, достижение цели и срабатывание лимита плана — даже при закрытой странице','The worker cron sends stop hits, targets and plan limits to Telegram — even with the page closed')}"`)}
    ${it('service','🧰 '+RT('Сервис: вкладки и данные','Service: tabs & data'),` title="${RT('Вкладки и бумаги, сбор данных вселенной, оценки и инсайдеров','Tabs and stocks, universe data, valuation and insider refresh')}"`)}
    ${can('action.manage_users')?it('settings','⚙️ '+RT('Доступ','Access')):''}
    ${isAdmin()?it('prompts','📜 '+RT('AI-промпты','AI prompts')):''}
    ${it('gloss','📖 '+RT('Словарь','Glossary'),` title="${RT('Что значит каждый термин и число Trade Desk — клавиша ?','What every Trade Desk term and number means — key ?')}"`)}
    ${it('faq','❓ '+RT('Справка','Help'))}
    <a class="dk-mi" role="menuitem" href="${location.protocol==='file:'?'../hub/index.html':'../hub/'}" title="${RT('Назад в Hub','Back to Hub')}">🏠 Hub</a>
    ${currentUser?it('logout','⏻ '+RT('Выйти','Log out')):''}
  </div>`;
}

// ── План сделки (общий блок: инспектор скринера и «Акция») ──
function deskPlanFor(it,side){
  const s=it&&it.s;if(!s)return null;
  const p=s.plans&&s.plans[side];if(!p)return null;
  const ovr=DESK_UI.riskOvr[it.key];
  if(!(ovr>0))return p;
  let q=qtyByRisk(ovr,p.entry,p.stop,FX[it.sec.ccy]||1);if((p.flags||[]).includes('half'))q=Math.floor(q/2);
  return Object.assign({},p,{qty:q,notionalKr:q*p.entry*(FX[it.sec.ccy]||1),riskKr:q*p.risk*(FX[it.sec.ccy]||1)});
}
function deskPlanBox(it,side,compact){
  const s=it.s,p=deskPlanFor(it,side),C=SIG.CFG;
  if(!s||!p)return `<div class="dk-empty">${RT('Сигнал ещё считается — грузятся свечи.','Signal pending — candles loading.')}</div>`;
  const ccy=it.sec.ccy,rk=DESK_UI.riskOvr[it.key]>0?DESK_UI.riskOvr[it.key]:deskRiskKr(),shortOk=!!((DESK.shortOk||{})[it.sec.sym]);
  const lim=p.mode==='limit',rr=p.rr||0;
  return `<div class="dk-plan-box">
    <div class="dk-row">${dkPill(s.verdict,!!deskHeld(it))}${dkPhase(s)}${dkFlags(s)}<span class="dk-mut dk-ml">${lim?RT('лимит у ','limit at ')+dkEsc(p.levelSrc||RT('уровня','level'))+' · '+dkPct(p.dEntry,1):RT('по рынку','at market')}</span></div>
    <div class="dk-plan-row"><div class="e"><div class="dk-lbl"${dkG('market-limit')}>${lim?RT('Лимит','Limit'):RT('Вход','Entry')}</div><b class="dk-num">${dkPx(p.entry)}</b><div class="dk-mut dk-xs">${dkCcy(ccy)}</div></div>
      <div class="s"><div class="dk-lbl"><span${dkG('stop')}>${RT('Стоп','Stop')}</span> · <span title="${dkEsc(p.stopSrc)}">${dkEsc(p.stopSrc)}</span></div><b class="dk-num">${dkPx(p.stop)}</b><div class="dk-mut dk-xs dk-num">${dkPct(-p.riskPct,1)}</div></div>
      <div class="t"><div class="dk-lbl">${(p.flags||[]).includes('atr-target')?`<span${dkG('fl-atr-target')}>≈</span> `:''}<span${dkG('target')}>${RT('Цель','Target')}</span> · <span title="${dkEsc(p.targetSrc)}">${dkEsc(p.targetSrc)}</span></div><b class="dk-num">${dkPx(p.target)}</b><div class="dk-mut dk-xs dk-num">${dkPct(p.rewardPct,1)}</div></div></div>
    <div class="dk-rr"><span class="dk-big dk-num">${dkRR(p)}</span><span class="dk-mut"${dkG('rr')}>R/R</span><span class="dk-meter" aria-hidden="true"><i class="risk" style="width:${(100/(1+Math.max(0,rr))).toFixed(1)}%"></i><i class="rew" style="width:${(100-100/(1+Math.max(0,rr))).toFixed(1)}%"></i></span></div>
    <div class="dk-risk-in"><label><span${dkG('size')}>${RT('Риск, kr','Risk, kr')}</span> <input class="dk-inp dk-num" type="number" step="100" min="100" value="${Math.round(rk)}" data-c="risk" data-k="${dkEsc(it.key)}"></label><span class="dk-ml">→ <b class="dk-num">${p.qty} ${RT('шт','sh')}</b> · <span class="dk-num">${dkKr(p.notionalKr)}</span>${(p.flags||[]).includes('half')?` <span class="dk-flag"${dkG('fl-half')}>½</span>`:''}</span></div>
    ${side==='short'?`<label class="dk-check"><input type="checkbox" data-c="shortok" data-k="${dkEsc(it.sec.sym)}"${shortOk?' checked':''}> ${RT('Шорт доступен у брокера (проверил займ и стоимость)','Short available at the broker (borrow & cost checked)')}</label>${shortOk?'':`<div class="dk-warn">${RT('⚠ Проверьте доступность шорта и стоимость займа — исполнение с предупреждением.','⚠ Check short availability and borrow cost — execution will warn.')}</div>`}`:''}
    ${compact?'':`<div class="dk-note">${RT(`Размер = риск ÷ (вход − стоп) × курс${ccy!=='SEK'?` (${ccy}/SEK ${dkN(FX[ccy]||1,2)})`:''}. Стоп — за структурным уровнем с буфером ${C.stopBufAtr}·ATR (не ближе ${C.minStopAtr}·ATR); цель — уровень ≥ ${C.minTargetAtr}·ATR в коридоре ${C.corridorAtr}·ATR, иначе ≈ ${C.targetAtr}·ATR. Вход по рынку при R/R ≥ ${C.rrMin}, при ${C.rrWeak}–${C.rrMin} — лимит, дающий ${C.rrGood}.`,`Size = risk ÷ (entry − stop) × FX${ccy!=='SEK'?` (${ccy}/SEK ${dkN(FX[ccy]||1,2)})`:''}. Stop beyond a structural level with a ${C.stopBufAtr}·ATR buffer (≥ ${C.minStopAtr}·ATR); target — a level ≥ ${C.minTargetAtr}·ATR within ${C.corridorAtr}·ATR, else ≈ ${C.targetAtr}·ATR. Market entry at R/R ≥ ${C.rrMin}; at ${C.rrWeak}–${C.rrMin} a limit giving ${C.rrGood}.`)}</div>`}
    <div class="dk-row">${can('action.edit_plan')?`<button class="dk-btn pri" data-a="plan" data-k="${dkEsc(it.key)}" data-side="${side}">${lim?RT('Взвести лимит','Arm limit'):RT('В план','Add to plan')}</button>`:''}${can('action.edit_trades')&&deskPorts().length?`<button class="dk-btn" data-a="exec" data-k="${dkEsc(it.key)}" data-side="${side}">${RT('Исполнить…','Execute…')}</button>`:''}</div>
  </div>`;
}

// ── «Что если?» (I2, §3.3): симуляция покупки/шорта в выбранном портфеле — ничего не пишет до «Исполнить» ──
// Настройки — DESK.whatIf (синк); вводимое, но ещё не подтверждённое значение — DESK_UI.wiRaw (пересчёт на месте).
function deskWiCfg(){const w=deskNorm(DESK).whatIf,P=deskPorts();return Object.assign({},w,{port:P.includes(w.port)?w.port:deskRiskTab()});}
function deskWiSave(patch){DESK=deskNorm(Object.assign({},DESK,{whatIf:Object.assign({},deskWiCfg(),patch)}));DESK_UI.wiRaw=null;scheduleSave();}
function deskWhatIfArgs(it,side){
  const c=deskWiCfg(),s=it.s,plan=s?deskPlanFor(it,side):null,raw=DESK_UI.wiRaw!=null?parseFloat(String(DESK_UI.wiRaw).replace(',','.'))||0:null;
  return {tab:c.port,sec:it.sec,side,plan,mode:c.mode,amountSEK:c.mode==='amount'&&raw!=null?raw:c.amountSEK,weightPct:c.mode==='weight'&&raw!=null?raw:c.weightPct,
    price:plan&&plan.mode==='limit'?plan.entry:(s?s.price:it.sec.price),now:Date.now()};
}
// compact («Решение», §4): итог и критическое видны сразу, форма и таблица «Сейчас/После» — в явно раскрываемом блоке.
function deskWhatIfPanel(it,side,compact){
  const P=deskPorts();if(!P.length)return '';
  const c=deskWiCfg(),C=DESK_IDEA_CFG.whatIf,amt=c.mode==='amount',v=DESK_UI.wiRaw!=null?DESK_UI.wiRaw:(amt?c.amountSEK:c.weightPct);
  const quick=C.quick.map(q=>`<button type="button" class="dk-btn dk-sm${amt&&c.amountSEK===q&&DESK_UI.wiRaw==null?' on':''}" data-a="wiq" data-v="${q}">${q>=1000?dkN(q/1000,0)+'k':q} kr</button>`).join('');
  const head=`<div class="dk-ph"><h2>${RT('Что если?','What if?')}${dkGi('what-if')}</h2>${dkSide(side)}<span class="dk-note dk-ml">${side==='short'?RT('открыть шорт','open a short'):RT('купить','buy')} ${dkEsc(it.sec.tk)} · ${dkEsc(TAB_LABEL(c.port))}</span></div>`;
  const inputs=`<div class="dk-wi-in">
      <select class="dk-sel" data-c="wiport" aria-label="${RT('Портфель симуляции','Simulation portfolio')}">${P.map(k=>`<option value="${dkEsc(k)}"${k===c.port?' selected':''}>${dkEsc(TAB_LABEL(k))}</option>`).join('')}</select>
      <div class="dk-seg" role="group" aria-label="${RT('Сумма или доля','Amount or weight')}"><button type="button" class="${amt?'on':''}" data-a="wimode" data-v="amount" aria-pressed="${amt}">${RT('Сумма','Amount')}</button><button type="button" class="${amt?'':'on'}" data-a="wimode" data-v="weight" aria-pressed="${!amt}">${RT('Доля','Weight')}</button></div>
      <label class="dk-wi-v"><input id="dkWiV" class="dk-inp dk-num" type="number" inputmode="decimal" data-c="wiv" min="${amt?C.amount[0]:C.weight[0]}" max="${amt?C.amount[1]:C.weight[1]}" step="${amt?1000:0.5}" value="${dkEsc(v)}" aria-label="${amt?RT('Сумма, kr','Amount, kr'):RT('Доля капитала, %','Share of equity, %')}"><span>${amt?'kr':RT('% капитала','% of equity')}</span></label>
      ${amt?`<div class="dk-wi-quick">${quick}</div>`:''}
    </div>`;
  const R=deskWhatIf(deskWhatIfArgs(it,side));
  if(compact)return `<div class="dk-panel dk-wi" id="dkWi">${head}<div id="dkWiSum" class="dk-wi-o" aria-live="polite">${deskWhatIfOutHTML(it,side,R,'sum')}</div>
    <details class="dk-wi-more"${dkDetAttr('st-wi')}><summary>${RT('Сумма, портфель и последствия для книги','Amount, portfolio and book impact')}</summary>${inputs}<div id="dkWiOut" aria-live="polite">${deskWhatIfOutHTML(it,side,R,'body')}</div></details></div>`;
  return `<div class="dk-panel dk-wi" id="dkWi">${head}${inputs}<div id="dkWiOut" aria-live="polite">${deskWhatIfOutHTML(it,side,R)}</div></div>`;
}
// part: 'sum' — итог + предупреждения; 'body' — таблица, «Как рассчитано», кнопки; иначе — всё.
function deskWhatIfOutHTML(it,side,R,part){
  if(!R||R.err)return part==='body'?'':`<div class="dk-empty">${R&&R.err==='price'?RT('Нет цены бумаги — обновите котировки.','No stock price — refresh quotes.'):RT('Выберите портфель.','Select a portfolio.')}</div>`;
  const C=DESK_IDEA_CFG.whatIf,ccy=R.ccy,k=dkEsc(it.key),short=side==='short',s=it.s,plan=s?deskPlanFor(it,side):null;
  const ST={ok:['✓',RT('можно','clear'),'buy'],attention:['⚠',RT('внимание','attention'),'trim'],blocked:['⛔',RT('заблокировано','blocked'),'short']}[R.status];
  const sum=`<div class="dk-wi-sum"><b class="dk-num">${R.qty} ${RT('шт','sh')}</b>${short?` <span class="dk-mut">${RT('в шорт','short')}</span>`:''} · ${RT('новая доля','new weight')} <b class="dk-num">${R.weightAfter!=null?dkN(R.weightAfter,1)+' %':'—'}</b> · ${RT('риск','risk')} <b class="dk-num">${R.stop?dkKr(R.tradeRiskSEK):'—'}</b><span class="dk-pill v-${ST[2]} dk-ml"${dkG('what-if')}>${ST[0]} ${ST[1]}</span></div>`;
  // Критическое (блокировки, кэш, цена не live, шорт без подтверждения) — всегда на виду, рядом с результатом.
  const warn=R.warnings.map(w=>`<div class="dk-warn${w.blocking?' dk-wi-blk':''}">${w.blocking?'⛔':'⚠'} ${dkEsc(w.text)}</div>`).join('');
  const pc=v=>v==null?'—':dkN(v,1)+' %',rk=(v,cap)=>`${dkKr(v)}${cap>0?` <span class="dk-mut">· ${dkN(v/cap*100,0)} %</span>`:''}`;
  const row=(l,a,b,bad)=>`<span class="dk-lbl">${l}</span><span class="dk-num">${a}</span><span class="dk-num dk-b${bad?' dk-dn':''}">${b}</span>`;
  const has=c=>R.warnings.some(w=>w.code===c);
  const tbl=`<div class="dk-wi-tbl" role="table" aria-label="${RT('Сейчас и после сделки','Now and after the trade')}"><span></span><span class="dk-lbl">${RT('Сейчас','Now')}</span><span class="dk-lbl">${short?RT('После шорта','After short'):RT('После покупки','After buy')}</span>
    ${row(RT('Кэш','Cash'),R.hasCash?dkKr(R.cashBefore):'—',R.hasCash?dkKr(R.cashAfter):RT('не ведётся','not tracked'),has('cash'))}
    ${row(RT('Доля','Weight')+' '+dkEsc(R.tk),pc(R.weightBefore),pc(R.weightAfter),has('weight'))}
    ${R.sector?row(RT('Сектор','Sector')+' '+dkEsc(R.sector),pc(R.sectorBefore),pc(R.sectorAfter),has('sector')):''}
    ${row(RT('Валюта','Currency')+' '+dkEsc(ccy),pc(R.ccyBefore),pc(R.ccyAfter),has('ccy'))}
    ${row(`<span${dkG('book-risk')}>${RT('Открытый риск книги','Book open risk')}</span>`,rk(R.bookRiskBefore,R.capSEK),rk(R.bookRiskAfter,R.capSEK),has('cap'))}</div>`;
  const f=R.fee,min=COURTAGE_MIN[ccy]!=null?COURTAGE_MIN[ccy]:6,fxAge=_fxAt?Math.round((Date.now()-_fxAt)/60000):null;
  const pxSrc=plan&&plan.mode==='limit'?RT('лимит плана v2','v2 plan limit'):RT('текущая цена','current price')+' · '+(it.sec.live?'live':RT('не live (снапшот/свечи)','not live (snapshot/candles)'));
  const how=`<p>${RT('Бюджет','Budget')}: ${R.mode==='weight'?`${RT('капитал','equity')} ${dkKr(R.equityBefore)} × ${dkN(R.budgetSEK/R.equityBefore*100||0,1)} % = <b>${dkKr(R.budgetSEK)}</b>`:`<b>${dkKr(R.budgetSEK)}</b>`}${RT(' (комиссия — сверху).',' (fee on top).')}</p>
    <p>${RT('Цена сделки','Trade price')}: <b>${dkPx(R.price)} ${dkEsc(ccy)}</b> — ${dkEsc(pxSrc)}.${ccy!=='SEK'?` ${RT('Курс','FX')}: 1 ${dkEsc(ccy)} = ${dkN(R.fx,4)} kr (${fxAge!=null?RT(`обновлён ${fxAge} мин назад`,`updated ${fxAge} min ago`):RT('из снапшота, свежесть не подтверждена','from the snapshot, freshness unconfirmed')}).`:''}</p>
    <p>${RT('Количество','Quantity')} = ⌊${RT('бюджет','budget')} ÷ (${RT('цена','price')} × ${RT('курс','FX')})⌋ = ⌊${dkN(R.qtyRaw,2)}⌋ = <b>${R.qty}</b> ${RT('(только целые акции)','(whole shares only)')}. ${RT('Сумма','Amount')} = ${R.qty} × ${dkPx(R.price)} = ${dkN(R.notional,2)} ${dkEsc(ccy)} = <b>${dkKr(R.notionalSEK)}</b>.</p>
    <p>${RT('Комиссия (Avanza Small)','Fee (Avanza Small)')}: courtage ${COURTAGE_PCT} %, ${RT('не меньше','min')} ${min} ${dkEsc(ccy)} = ${dkN(f.courtage,2)}${f.fx?` + ${RT('валютная надбавка','FX surcharge')} ${FX_FEE_PCT} % = ${dkN(f.fx,2)}`:''}${f.tax?` + ${RT('налог','tax')} ${dkN(f.tax,2)}`:''} → <b>${dkN(f.total,2)} ${dkEsc(ccy)} = ${dkKr(R.feeSEK)}</b>.</p>
    <p>${short?RT('Кэш при шорте меняется только на комиссию — выручка остаётся залогом у брокера (как при исполнении).','On a short, cash changes only by the fee — proceeds stay as broker collateral (as on execution).'):RT('Кэш уменьшается на сумму и комиссию.','Cash drops by the amount and the fee.')}${R.hasCash&&R.baseCcy!=='SEK'?' '+RT(`Кэш портфеля ведётся в ${R.baseCcy}, здесь — в kr.`,`Portfolio cash is kept in ${R.baseCcy}, shown in kr.`):''}${R.qtyBefore&&R.qty>0?' '+RT(`В портфеле уже ${dkN(R.qtyBefore,0)} шт → станет ${dkN(R.qtyAfter,0)}, средняя ${dkPx(R.avgAfter)} (genomsnittsmetoden).`,`Already ${dkN(R.qtyBefore,0)} sh held → ${dkN(R.qtyAfter,0)}, average ${dkPx(R.avgAfter)} (genomsnittsmetoden).`):''}</p>
    <p>${RT('Доли = стоимость по модулю ÷ капитал после сделки','Weights = absolute value ÷ equity after the trade')} (${RT('акции + кэш, шорт — результатом, минус комиссия','stocks + cash, shorts by P&L, minus fee')}: ${dkKr(R.equityAfter)}). ${RT(`Предупреждение: бумага > ${C.weightPct} %, сектор > ${C.sectorPct} %, валюта кроме SEK > ${C.ccyPct} %.`,`Warning: position > ${C.weightPct} %, sector > ${C.sectorPct} %, currency other than SEK > ${C.ccyPct} %.`)}</p>
    <p>${R.stop?RT(`Риск сделки = ${R.qty} × |${dkPx(R.price)} − стоп ${dkPx(R.stop)}| × курс = <b>${dkKr(R.tradeRiskSEK)}</b>.`,`Trade risk = ${R.qty} × |${dkPx(R.price)} − stop ${dkPx(R.stop)}| × FX = <b>${dkKr(R.tradeRiskSEK)}</b>.`):RT('Стопа нет — риск сделки не считается.','No stop — trade risk is not computed.')} ${RT(`Открытый риск книги — до текущих стопов; лимит = капитал × ${deskNorm(DESK).riskCapPct} % = ${dkKr(R.capSEK)}.`,`Book open risk is measured to current stops; cap = equity × ${deskNorm(DESK).riskCapPct} % = ${dkKr(R.capSEK)}.`)}</p>
    <p class="dk-mut">${RT('Рассчитано','Computed')} ${new Date().toLocaleTimeString(LANG==='en'?'en-GB':'ru-RU',{hour:'2-digit',minute:'2-digit'})} · SIG ${dkEsc(SIG.VER)} · ${RT('портфель','portfolio')} ${dkEsc(TAB_LABEL(R.tab))} · ${RT('ничего не записано до «Исполнить»','nothing is recorded until “Execute”')}</p>`;
  const blocked=R.status==='blocked',q=R.qty>0?R.qty:0;
  const btns=s&&plan?`<div class="dk-row">${can('action.edit_plan')&&q?`<button class="dk-btn" data-a="wiplan" data-k="${k}" data-side="${side}" data-q="${q}">${RT('В план','Add to plan')} · ${q} ${RT('шт','sh')}</button>`:''}${can('action.edit_trades')&&q?`<button class="dk-btn pri" data-a="wiexec" data-k="${k}" data-side="${side}" data-q="${q}" data-tab="${dkEsc(R.tab)}"${blocked?` disabled title="${RT('Сначала снимите блокировку','Resolve the block first')}"`:''}>${RT('Исполнить…','Execute…')}</button>`:''}</div>`
    :`<div class="dk-note">${RT('«В план» и «Исполнить» — когда посчитан сигнал (грузятся свечи).','“Add to plan” and “Execute” appear once the signal is computed (candles loading).')}</div>`;
  if(part==='sum')return sum+warn;
  if(part==='body')return tbl+dkHow('whatif',how)+btns;
  return sum+warn+tbl+dkHow('whatif',how)+btns;
}
let _deskWiT=0;
function deskWhatIfRecalc(){
  const box=document.getElementById('dkWiOut');if(!box||DESK_UI.route!=='stock')return;
  const it=deskSecOf(DESK_UI.key);if(!it)return;
  const side=deskStockSide(it),R=deskWhatIf(deskWhatIfArgs(it,side)),sum=document.getElementById('dkWiSum');
  if(sum){sum.innerHTML=deskWhatIfOutHTML(it,side,R,'sum');box.innerHTML=deskWhatIfOutHTML(it,side,R,'body');}
  else box.innerHTML=deskWhatIfOutHTML(it,side,R);
}

// ═══════════════════ Сегодня ═══════════════════
function deskTodayHTML(){
  const I=deskItems(),P=deskBook(),B=deskTodayBuckets(I.items,P),C=SIG.CFG,w=B.why;
  const plansArmed=(PLAN_RULES||[]).filter(r=>!r.done&&r.status!=='open'),fired=plansArmed.filter(r=>planStatus(r).ready);
  const rest=[w.knife?`${w.knife} ${RT('нож','knife')}`:'',w.heat?`${w.heat} ${RT('перегрев','overheated')}`:'',w.rr?`${w.rr} R/R < ${C.rrWeak}`:'',w.squeeze?`${w.squeeze} ${RT('сквиз','squeeze')}`:'',w.earnings?`${w.earnings} ${RT('отчёт','earnings')}`:'',w.none?`${w.none} ${RT('без сетапа','no setup')}`:''].filter(Boolean).join(' · ')||'—';
  const kpi=(l,v,d)=>`<div class="dk-panel dk-stat"><div class="dk-lbl">${l}</div><div class="dk-v dk-num">${v}</div><div class="dk-d">${d}</div></div>`;
  const nL=B.entries.filter(x=>x.s.side==='long').length,nS=B.entries.length-nL;
  const pend=I.items.length-B.pending;
  const actionN=B.entries.length+B.attn.length+fired.length,OR=deskOpenRisk(),capPct=deskNorm(DESK).riskCapPct;
  const orHow=`<p>${RT('Открытый риск = сумма по позициям (цена сейчас − текущий стоп) × кол-во × курс; позиции без стопа не учитываются. Лимит книги = капитал × ','Open risk = sum over positions of (price now − current stop) × qty × FX; positions without a stop are not counted. Book cap = equity × ')}${capPct} %.</p>
    <p>${RT('Портфель','Portfolio')}: ${dkEsc(OR.tabs.map(TAB_LABEL).join(', ')||'—')} · ${RT('капитал','equity')} ${dkKr(OR.eq)} · ${RT('лимит','cap')} ${dkKr(OR.cap)} · ${RT('открыто','open')} ${dkKr(OR.open)}${OR.noStop?` · ${OR.noStop} ${RT('без стопа','without stop')}`:''}</p>`;
  return `<section class="dk-focus dk-mb"><div><div class="dk-eyebrow">${RT('Фокус дня','Today’s focus')}${dkGi('focus')}</div><h2>${actionN?RT(`${actionN} действий требуют внимания`,`${actionN} actions need attention`):RT('Всё идёт по плану','Everything is on plan')}</h2><p>${actionN?RT('Сначала решения, затем наблюдение. Остальные бумаги находятся в «Идеях».','Decisions first, monitoring second. Find the rest under Ideas.'):RT('Новых входов и срочных действий сейчас нет.','There are no new entries or urgent actions right now.')}</p></div>
      <div class="dk-focus-risk${OR.over?' over':''}"><span>${RT('Открытый риск книги','Book open risk')}${dkGi('book-risk')}</span><b class="dk-num">${OR.tabs.length?dkKr(OR.open):'—'}</b><small class="dk-num">${OR.pctCap!=null?`${dkN(OR.pctCap,0)} % ${RT('лимита','of cap')} ${dkKr(OR.cap)}`:RT('нет портфеля','no portfolio')}</small>${OR.over?`<small class="dk-crit">⛔ ${RT('выше лимита — новые входы заблокированы','over the cap — new entries blocked')}</small>`:''}${OR.noStop?`<small class="dk-crit">${OR.noStop} ${RT('без стопа — риск не учтён','without stop — risk not counted')}</small>`:''}</div>
      <div class="dk-focus-how">${dkHow('openrisk',orHow)}</div></section>
    <div class="dk-grid dk-g3 dk-mb">
      ${kpi(RT('Сетапов на вход','Entry setups')+dkGi('setups'),B.entries.length,`${nL} ${RT('лонг','long')} · ${nS} ${RT('шорт','short')} · R/R ≥ ${C.rrMin}`)}
      ${kpi(RT('Ждать уровня','Wait for level')+dkGi('wait-level'),B.waiting.length,RT('лимит в пределах 8 % от цены','limit within 8 % of price'))}
      ${kpi(RT('Позиции требуют действия','Positions need action')+dkGi('pos-attn'),`${B.attn.length}<span class="dk-mut dk-fs14">/${P.length}</span>`,RT('стоп · цель · б/у · отчёт · без стопа','stop · target · b/e · earnings · no stop'))}
    </div>
    <div class="dk-cols">
      <div>
        <section class="dk-mb"><div class="dk-ph dk-ph-bare"><h2>${RT('Вход сегодня','Enter today')}${dkGi('entry-today')}</h2><span class="dk-cnt">${B.entries.length}</span><span class="dk-note dk-ml">${RT(`откат к поддержке в тренде · отбой от сопротивления в даунтренде · R/R ≥ ${C.rrMin} по рынку`,`pullback to support in an uptrend · rejection at resistance in a downtrend · R/R ≥ ${C.rrMin} at market`)}</span></div>
          ${B.entries.length?`<div class="dk-decs">${B.entries.map(deskDecHTML).join('')}</div>`:`<div class="dk-panel dk-empty">${DESK_UI.load.busy?RT('Сигналы ещё считаются…','Signals are loading…'):RT(`Сетапов с R/R ≥ ${C.rrMin} по рынку нет — смотрите «Ждать уровня».`,`No setups with R/R ≥ ${C.rrMin} at market — see “Wait for level”.`)}</div>`}</section>
        <section class="dk-panel dk-mb"><div class="dk-ph"><h2>${RT('Ждать уровня','Wait for level')}${dkGi('wait-level')}</h2><span class="dk-cnt">${B.waiting.length}</span><span class="dk-note dk-ml">${RT(`лимит у уровня или цена, при которой R/R = ${C.rrGood}; «Взвести» → уведомление при касании`,`limit at a level or the price giving R/R = ${C.rrGood}; “Arm” → alert on touch`)}</span></div>
          ${B.waiting.length?`<div class="dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Бумага','Stock')}</th><th>${RT('Сторона','Side')}</th><th class="r">${RT('Цена','Price')}</th><th class="r"${dkG('market-limit')}>${RT('Лимит','Limit')}</th><th class="r"${dkG('wait-level')}>Δ</th><th class="r"${dkG('stop')}>${RT('Стоп','Stop')}</th><th class="r"${dkG('target')}>${RT('Цель','Target')}</th><th class="r"${dkG('rr')}>R/R</th><th class="r"${dkG('size')}>${RT('Размер','Size')}</th><th></th></tr></thead><tbody>${B.waiting.map(x=>{const s=x.s,p=deskPlanFor(x,s.side)||s.plan;return `<tr class="dk-tr" data-a="open" data-k="${dkEsc(x.key)}"><td><span class="dk-tk">${dkEsc(x.sec.tk)}</span><span class="dk-nm">${dkEsc(x.sec.name)}</span><div class="dk-note">${dkEsc(s.why[0]||'')}</div></td><td>${dkSide(s.side)}</td><td class="r dk-num">${dkPx(s.price)}</td><td class="r dk-num dk-b">${dkPx(p.entry)}</td><td class="r dk-num">${dkPct(p.dEntry,1)}</td><td class="r dk-num dk-dn">${dkPx(p.stop)}</td><td class="r dk-num dk-up">${dkPx(p.target)}</td><td class="r dk-num dk-b">${dkRR(p)}</td><td class="r dk-num">${p.qty} ${RT('шт','sh')}</td><td>${can('action.edit_plan')?`<button class="dk-btn dk-sm" data-a="plan" data-k="${dkEsc(x.key)}" data-side="${s.side}">${RT('Взвести','Arm')}</button>`:''}</td></tr>`;}).join('')}</tbody></table></div>`:`<div class="dk-empty">${RT('Нет бумаг с лимитом в пределах 8 % от цены.','No stocks with a limit within 8 % of price.')}</div>`}</section>
        <details class="dk-panel"><summary class="dk-ph"><h2>${RT('Остальные сигналы','Other signals')}${dkGi('rest')}</h2><span class="dk-cnt">${B.rest.length}</span><span class="dk-note dk-ml">${rest}${pend>0?` · ${pend} ${RT('ждут свечей','awaiting candles')}`:''}</span></summary><div class="dk-empty">${RT('Эти бумаги не требуют действия сейчас. Полный список находится в «Идеях».','These stocks need no action now. Find the full list under Ideas.')}</div></details>
        <section class="dk-panel dk-mt14"><div class="dk-ph"><h2>${RT('Сократить в книге','Reduce in the book')}${dkGi('trim-book')}</h2><span class="dk-cnt">${B.trims.length}</span></div>
          ${B.trims.length?`<div class="dk-wrap"><table class="dk-tbl"><tbody>${B.trims.map(p=>`<tr class="dk-tr" data-a="open" data-k="${dkEsc(p.sym+'|'+p.ccy)}"><td><span class="dk-tk">${dkEsc(p.tk)}</span><span class="dk-nm">${dkEsc(p.name)}</span></td><td>${dkSide(p.side)}</td><td class="r dk-num">${dkPx(p.calc.now)}</td><td class="r dk-num dk-b">${dkPct(p.calc.plPct)}</td><td class="r dk-num">${dkR(p.calc.rNow)}</td><td>${dkActPill(p.act)}</td><td class="dk-ink2">${dkEsc(p.note)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="dk-empty">${RT('В книге нечего сокращать.','Nothing to reduce in the book.')}</div>`}</section>
      </div>
      <aside class="dk-aside">
        <div class="dk-panel"><div class="dk-ph"><h2>${RT('Позиции — внимание','Positions — attention')}${dkGi('pos-attn')}</h2><span class="dk-cnt">${B.attn.length}</span></div>
          ${B.attn.length?B.attn.slice(0,12).map(p=>`<div class="dk-att" data-a="open" data-k="${dkEsc(p.sym+'|'+p.ccy)}"><div class="dk-row"><span class="dk-tk">${dkEsc(p.tk)}</span>${dkSide(p.side)}${dkActPill(p.act)}<span class="dk-num dk-ml dk-b ${p.calc.plPct>=0?'dk-up':'dk-dn'}">${dkPct(p.calc.plPct)}</span></div><div class="dk-note">${dkEsc(p.note)}${p.stop?` · ${RT('до стопа','to stop')} <b class="dk-num">${dkN(p.calc.toStopPct,1)}%</b>`:''}${p.calc.rNow!=null?` · <b class="dk-num">${dkR(p.calc.rNow)}</b>`:''}</div></div>`).join(''):`<div class="dk-empty">${P.length?RT('Все позиции в рамках плана.','All positions on plan.'):RT('В выбранном портфеле нет позиций.','No positions in the selected portfolio.')}</div>`}
          <div class="dk-pad"><button class="dk-btn dk-sm" data-a="nav" data-r="book">${RT('Все позиции →','All positions →')}</button></div></div>
        <div class="dk-panel"><div class="dk-ph"><h2>${RT('План','Plan')}${dkGi('plan')}</h2><span class="dk-cnt">${plansArmed.length}</span>${fired.length?`<span class="dk-flag dk-ml"${dkG('plan')}>🔔 ${fired.length}</span>`:''}</div>
          ${plansArmed.length?plansArmed.slice(0,8).map(r=>deskPlanRuleRow(r)).join(''):`<div class="dk-empty">${RT('Взведённых планов нет — «В план» на сетапе или «Взвести» у лимита.','No armed plans — “Add to plan” on a setup or “Arm” at a limit.')}</div>`}
          <div class="dk-pad"><button class="dk-btn dk-sm" data-a="nav" data-r="journal" data-jt="plans">${RT('Все планы →','All plans →')}</button></div></div>
        ${can('view.ai_proto')?`<div class="dk-panel dk-pad"><div class="dk-lbl dk-mb6">AI</div><button class="dk-btn" data-a="booksec" data-v="ai" data-sub="proto">🤖 ${RT('AI Proto: разбор портфеля','AI Proto: portfolio review')}</button><div class="dk-note dk-mt6">${RT('«Позиции → AI» выбранного портфеля; разбор бумаги — в «Акции».','“Positions → AI” of the selected portfolio; per-stock AI is on the Stock screen.')}</div></div>`:''}
      </aside>
    </div>`;
}
// Строка решения: глагол первым (десктоп — строка, телефон — карточка через CSS).
function deskDecHTML(x){
  const s=x.s,p=deskPlanFor(x,s.side)||s.plan,v=DK_V[s.verdict]||DK_V.wait,held=!!x.sec.held.length;
  return `<article class="dk-dec v-${s.verdict}" data-a="open" data-k="${dkEsc(x.key)}" tabindex="0">
    <div class="dk-dec-verb">${v[0]} ${v[1]().toUpperCase()}</div>
    <div class="dk-dec-main"><div class="dk-row"><span class="dk-tk">${dkEsc(x.sec.tk)}</span><span class="dk-nm">${dkEsc(x.sec.name)}</span><b class="dk-num">${dkPx(s.price)} ${dkCcy(x.sec.ccy)}</b>${dkDay(s.day)}${held?`<span class="dk-tag">${RT('в книге','in book')}</span>`:''}${dkFlags(s)}</div>
      <div class="dk-dec-why">${dkEsc(s.why[0]||'')}${s.why[1]?` <span class="dk-mut">· ${dkEsc(s.why[1])}</span>`:''}</div></div>
    <div class="dk-dec-plan dk-num"><span><i${dkG('market-limit')}>${RT('вход','entry')}</i> ${dkPx(p.entry)}</span><span class="dk-dn"><i${dkG('stop')}>${RT('стоп','stop')}</i> ${dkPx(p.stop)}</span><span class="dk-up"><i${dkG('target')}>${RT('цель','target')}</i> ${dkPx(p.target)}</span><span><i${dkG('rr')}>R/R</i> <b>${dkRR(p)}</b></span><span><i${dkG('size')}>${RT('размер','size')}</i> ${p.qty} ${RT('шт','sh')}</span></div>
    <div class="dk-dec-act">${can('action.edit_plan')?`<button class="dk-btn dk-sm" data-a="plan" data-k="${dkEsc(x.key)}" data-side="${s.side}">${RT('В план','To plan')}</button>`:''}${can('action.edit_trades')&&deskPorts().length?`<button class="dk-btn dk-sm pri" data-a="exec" data-k="${dkEsc(x.key)}" data-side="${s.side}">${RT('Исполнить','Execute')}</button>`:''}</div>
  </article>`;
}
function deskPlanRuleRow(r){
  const st=planStatus(r),lvl=st.lvl>0?dkPx(st.lvl):'—',key=exSymbol(r.tk,r.ccy||'USD')+'|'+String(r.ccy||'USD').toUpperCase();
  const state=st.invalid?`<span class="dk-flag"${dkG('plan')}>✖ ${RT('сетап сломан','setup broken')}</span>`:st.ready?`<span class="dk-flag"${dkG('plan')}>🔔 ${RT('пора','now')}</span>`:st.gapPct!=null?`<span class="dk-mut dk-num">${RT('до уровня','to level')} ${dkN(Math.abs(st.gapPct),1)}%</span>`:'';
  return `<div class="dk-att" data-a="open" data-k="${dkEsc(key)}"><div class="dk-row"><span class="dk-tk">${dkEsc(r.tk)}</span>${dkSide(r.side)}<span class="dk-num">${planActLabel(r.act,r.side)} ${lvl}</span><span class="dk-ml">${state}</span></div><div class="dk-note dk-num">${r.stop?RT('стоп ','stop ')+dkPx(r.stop):''}${r.target?' · '+RT('цель ','target ')+dkPx(r.target):''}${r.qty?' · '+r.qty+' '+RT('шт','sh'):''}${r.note?' · '+dkEsc(String(r.note).slice(0,80)):''}</div></div>`;
}

// ═══════════════════ Скринер ═══════════════════
function deskScreenHTML(){
  const iv=['watch','final'].includes(DESK_UI.iv)?DESK_UI.iv:'all',nW=deskWatchItems('watch','main').length,nF=deskWatchItems('final','main').length;
  const sw=`<div class="dk-seg dk-mb" role="tablist" aria-label="${RT('Вид','View')}"${dkG('ideas-views')}>${[['all',RT('Все идеи','All ideas')],['watch',RT('Список покупок','Shopping list'),nW],['final',RT('Финал','Final'),nF]].map(([v,l,n])=>`<button class="${iv===v?'on':''}" data-a="iv" data-v="${v}" role="tab" aria-selected="${iv===v}">${l}${n!=null?` <span class="dk-cnt">${n}</span>`:''}</button>`).join('')}</div>`;
  return sw+(iv==='all'?deskIdeasAllHTML():deskWatchHTML(iv));
}
// Кнопка «В список покупок» (карточка «Все идеи», инспектор, «Акция»); бумага уже в списке — метка.
function dkWatchBtn(key,big){
  if(deskWatchGet(key))return `<span class="dk-tag dk-inlist" title="${RT('Уже в списке покупок','Already in the shopping list')}">🛒 ${RT('в списке','listed')}</span>`;
  return can('action.edit_plan')?`<button class="dk-btn ${big?'':'dk-sm '}dk-wadd" data-a="wadd" data-k="${dkEsc(key)}" title="${RT('Добавить в список покупок: зона по сигналу, правка сразу','Add to the shopping list: zone from the signal, editable')}">＋ ${RT('В список','To list')}</button>`:'';
}
// ═══════════════════ Подборки (P3, §5): деривированы из модели P1, ничего не грузят и не пишут ═══════════════════
const DK_BUCKET_DEF=[
  ['candidates',()=>RT('Кандидаты сейчас','Candidates now'),
    ()=>RT('SIG.buy, лонг, пригодная цена, полный бизнес-срез, без блокеров нового входа. Оценка не обязательна.','SIG.buy, long, usable price, full business slice, no entry blockers. Valuation not required.'),
    ()=>RT('Нет технических кандидатов на вход сейчас.','No technical entry candidates right now.')],
  ['near-zone',()=>RT('У зоны покупки','Near the buy zone'),
    ()=>RT('Лонг с действительным лимитным планом у зоны входа; сломанный сетап не считается хорошим входом.','Long with a valid limit plan near the entry zone; a broken setup is not a good entry.'),
    ()=>RT('Нет бумаг с действительным лимитом у зоны входа.','No stocks with a valid limit near the entry zone.')],
  ['quality-growth',()=>RT('Качественный рост','Quality growth'),
    ()=>RT('Полный бизнес-срез A/A+ и положительный фактический рост выручки; прогноз не заменяет факт.','Full business slice A/A+ and positive actual revenue growth; a forecast does not replace a fact.'),
    ()=>RT('Нет бумаг A/A+ с подтверждённым фактическим ростом выручки.','No A/A+ stocks with confirmed actual revenue growth.')],
  ['discount',()=>RT('Дисконт к оценке','Discount to valuation'),
    ()=>RT('Сопоставимая внешняя оценка выше цены, известная дата, без «ножа»/устаревшего таргета.','Comparable external valuation above price, known date, no knife / stale target.'),
    ()=>RT('Нет сопоставимых внешних оценок выше цены.','No comparable external valuations above price.')],
  ['research',()=>RT('Нужно изучить','Needs research'),
    ()=>RT('Почти кандидаты: лонг SIG.buy или лимит у зоны, которым до «Кандидатов»/«У зоны» не хватает только данных.','Almost candidates: long SIG.buy or a limit near the zone, missing only data to reach “Candidates”/“Near zone”.'),
    ()=>RT('Нет почти-кандидатов, которым не хватает только данных.','No almost-candidates missing only data.')],
  ['high-risk',()=>RT('Высокий риск','High risk'),
    ()=>RT('Автоматический риск 4–5 или критический флаг; ручное снижение риска не исключает бумагу.','Automatic risk 4–5 or a critical flag; a manual risk override does not exclude the stock.'),
    ()=>RT('Нет бумаг с высоким автоматическим риском или критическими флагами.','No stocks with high automatic risk or critical flags.')]
];
function deskBucketReason(m,key){
  if(key==='research'){const rs=(m.selection.bucketReasons.research||[]).map(dkSelR);return dkEsc(rs.join(' · ')||dkSelR('business-missing'));}
  if(key==='discount'){const up=dkPct(m.valuation.upsidePct,0);return dkEsc(RT(`${up} к оценке аналитиков`,`${up} vs analyst valuation`)+(m.valuation.asOf?' · '+String(m.valuation.asOf).slice(0,10):''));}
  if(key==='quality-growth'){const g=(m.quality.facts||{}).revenueGrowth;return dkEsc(RT(`Рост выручки ${dkPct(g,1)}, качество ${m.quality.grade||'—'}`,`Revenue growth ${dkPct(g,1)}, quality ${m.quality.grade||'—'}`));}
  if(key==='high-risk'){const mr=deskMainRisk({blockers:m.timing.blockers,flags:m.timing.flags,level:m.risk.level});
    return dkEsc(mr.k==='earnings'?DK_MR.earnings(sigEarnDays(m.identity.sym)):(DK_MR[mr.k]||DK_MR.none)());}
  return dkEsc((m.timing.why&&m.timing.why[0])||'');
}
function deskBucketQualBadge(q){
  if(!q||!q.applicable)return '—';
  if(q.mode==='full')return `<b>${dkEsc(q.grade)}</b>`;
  if(q.mode==='partial')return `≈<b>${dkEsc(q.grade||'')}</b>`;
  return `<span class="dk-mut">${RT('пред.','prov.')}</span>`;
}
function deskBucketValBadge(v){
  if(v.value!=null&&v.status!=='incomparable')return `<span class="dk-num ${v.upsidePct>=0?'dk-up':'dk-dn'}">${dkPct(v.upsidePct,0)}</span>`;
  const pe=v.peContext||{};
  return pe.value>0&&pe.comparable!==false?`P/E <span class="dk-num">${dkN(pe.value,1)}</span>`:'<span class="dk-mut">—</span>';
}
// «Загрузить»/«Обновить» — только в «Нужно изучить», по типу пропуска (§5: причина и кнопка догрузки).
function deskBucketLoadBtn(m){
  const rs=m.selection.bucketReasons.research||[];
  if(rs.some(c=>c.indexOf('business-')===0)&&can('view.health'))return `<button type="button" class="dk-btn dk-sm" data-a="fund" data-k="${dkEsc(m.identity.sym)}">${RT('Загрузить','Load')}</button>`;
  if(rs.some(c=>c.indexOf('price-')===0||c==='signal-missing'||c==='signal-stale')&&can('action.refresh_data'))return `<button type="button" class="dk-btn dk-sm" data-a="refresh1" data-k="${dkEsc(m.identity.key)}">${RT('Обновить','Refresh')}</button>`;
  return '';
}
function deskBucketCardHTML(m,key){
  const sec=m.identity,s=m.signal,t=m.timing,px=m.price.value,level=t.waitingLevel!=null?t.waitingLevel:(t.plan&&t.plan.entry>0?t.plan.entry:null);
  return `<article class="dk-idea v-${dkEsc(t.verdict||'wait')}" data-a="sel" data-k="${dkEsc(sec.key)}" tabindex="0">
    <div class="dk-idea-head"><div><b class="dk-tk">${dkEsc(sec.tk)}</b><small>${dkEsc(sec.sector||'')}</small></div>${s?dkPill(t.verdict,!!(sec.held||[]).length):`<span class="dk-tag">${RT('считаем…','loading…')}</span>`}</div>
    <div class="dk-idea-dims dk-note"><span>${RT('Кач.','Qual.')} ${deskBucketQualBadge(m.quality)}</span><span>${deskBucketValBadge(m.valuation)}</span><span>${RT('Риск','Risk')} <b>${deskRiskWord(m.risk.level)}</b></span></div>
    <div class="dk-idea-route"><span><small>${RT('Сейчас','Now')}</small><b class="dk-num">${dkPx(px)}</b></span><i>→</i><span><small>${t.waitingLevel!=null?RT('Жду цену','Wait for'):RT('Вход','Entry')}</small><b class="dk-num ${t.side==='short'?'dk-dn':'dk-up'}">${level!=null?dkPx(level):'—'}</b></span></div>
    <p>${deskBucketReason(m,key)}</p>
    <div class="dk-idea-add">${dkCmpBox(sec.key)}${key==='research'?deskBucketLoadBtn(m):''}${dkWatchBtn(sec.key)}</div>
  </article>`;
}
function deskBucketSectionHTML(def,buckets){
  const[key,label,rule,emptyTx]=def,B=buckets[key]||{items:[],total:0};
  const cards=B.items.map(m=>deskBucketCardHTML(m,key)).join('');
  const note=key==='candidates'?`<p class="dk-note">${dkEsc(dkCandNote())}</p>`
    :key==='discount'?`<p class="dk-note">${RT('«Дисконт к оценке» не утверждает истинную недооценку.','“Discount to valuation” does not claim true undervaluation.')}</p>`:'';
  return `<section class="dk-panel dk-mb"><div class="dk-ph"><h2>${label()}</h2><span class="dk-cnt">${B.total}</span></div><p class="dk-d">${rule()}</p>${note}
    ${cards?`<div class="dk-ideas dk-mt6">${cards}</div>`:`<div class="dk-empty">${DESK_UI.load.busy?RT('Сигналы ещё считаются…','Signals are loading…'):emptyTx()}</div>`}</section>`;
}
// Подборки — только производные P1-модели: без fetch, без перезаписи ручного списка/сортировки таблицы (§3.4/§5).
// Порядок карточек внутри подборки перевычисляется вместе со всем экраном (deskRender/deskPaint уже откладывают
// перерисовку во время ввода и переживают фокус/прокрутку — новый общий механизм, не отдельный для подборок).
function deskIdeaBucketsHTML(){
  const buckets=deskSelectionBuckets(deskPort(),Date.now());
  return `<div class="dk-buckets dk-mb">${DK_BUCKET_DEF.map(def=>deskBucketSectionHTML(def,buckets)).join('')}</div>`;
}
function deskIdeasAllHTML(){
  const I=deskItems(),f=DESK_UI.f,C=SIG.CFG,R=deskScreenRows(I.items,f,DESK_UI.sort);
  const tabs=[...new Set(I.items.reduce((a,x)=>a.concat(x.sec.tabs),[]))];
  // Сектора (S7b-2, решение 4 карты — вместо Live Sector Tracker): по числу бумаг, «—» (без сектора) в конце.
  const secN={};I.items.forEach(x=>{const s=deskSectorOf(x.sec);secN[s]=(secN[s]||0)+1;});
  const secs=Object.keys(secN).sort((a,b)=>(a==='—')-(b==='—')||secN[b]-secN[a]||a.localeCompare(b));
  const ph=[['all',RT('Все фазы','All phases')],['up','↑ '+T('Аптренд')],['imp','⇈ '+T('Импульс')],['heat','△ '+T('Перегрев')],['undr','◇ '+T('Недооценка')],['corr','↓ '+T('Коррекция')],['rev','↗ '+T('Разворот')],['flat','→ '+T('Боковик')],['down','↘ '+T('Даунтренд')],['knife','⤓ '+T('Падающий нож')]];
  const opt=(arr,cur)=>arr.map(([v,l])=>`<option value="${dkEsc(v)}"${v===cur?' selected':''}>${dkEsc(l)}</option>`).join('');
  const cols=[['tk',RT('Бумага','Stock')],['price',RT('Цена','Price'),'r'],['day',RT('1д','1d'),'r c-opt'],['phase',RT('Фаза · тренд','Phase · trend')],['near',RT('Ближайший уровень','Nearest level'),'c-opt'],['dEntry',RT('Вход · Стоп · Цель','Entry · Stop · Target'),'r c-opt'],['rr','R/R','r'],['score',RT('Балл','Score'),'r c-opt'],['verdict',RT('Вердикт','Verdict')]];
  const thG={near:dkG('levels'),rr:dkG('rr'),score:dkG('score'),dEntry:dkG('market-limit')};
  const th=cols.map(([k,l,a])=>`<th class="${a||''}${DESK_UI.sort.k===k?' s':''}" data-a="sort" data-s="${k}"${thG[k]||''} aria-sort="${DESK_UI.sort.k===k?(DESK_UI.sort.d>0?'ascending':'descending'):'none'}">${l}${DESK_UI.sort.k===k?`<span class="ar">${DESK_UI.sort.d>0?'▲':'▼'}</span>`:''}</th>`).join('');
  const shown=R.slice(0,400);
  const ideaCards=shown.slice(0,24).map(x=>{const s=x.s,sec=x.sec;
    if(!s)return `<article class="dk-idea pending" data-a="sel" data-k="${dkEsc(x.key)}"><div class="dk-idea-head"><div><b class="dk-tk">${dkEsc(sec.tk)}</b><small>${dkEsc(sec.name)}</small></div><span class="dk-tag">${RT('считаем…','loading…')}</span></div><div class="dk-idea-price dk-num">${dkPx(sec.price)} ${dkCcy(sec.ccy)}</div></article>`;
    const p=deskPlanFor(x,s.side)||s.plan,delta=p&&p.dEntry!=null?p.dEntry:0;
    return `<article class="dk-idea v-${s.verdict}${DESK_UI.sel===x.key?' on':''}" data-a="sel" data-k="${dkEsc(x.key)}" tabindex="0"><div class="dk-idea-head"><div><b class="dk-tk">${dkEsc(sec.tk)}</b><small>${dkEsc(sec.name)}</small></div>${dkPill(s.verdict,!!sec.held.length)}</div><div class="dk-idea-route"><span><small>${RT('Сейчас','Now')}</small><b class="dk-num">${dkPx(s.price)}</b></span><i>→</i><span><small>${p.mode==='limit'?RT('Жду цену','Wait for'):RT('Вход','Entry')}</small><b class="dk-num ${s.side==='short'?'dk-dn':'dk-up'}">${dkPx(p.entry)}</b></span></div><div class="dk-idea-foot"><span${dkG('act-now')}>${p.mode==='limit'?RT('Нужно движение','Move needed'):RT('Можно действовать','Actionable')} <b class="dk-num">${dkPct(delta,1)}</b></span><span><span${dkG('rr')}>R/R</span> <b class="dk-num">${dkRR(p)}</b></span></div><p>${dkEsc(s.why[0]||'')}</p><div class="dk-idea-add">${dkCmpBox(x.key)}${dkWatchBtn(x.key)}</div></article>`;}).join('');
  const rows=shown.map(x=>{const s=x.s,sec=x.sec;
    if(!s)return `<tr class="dk-tr${DESK_UI.sel===x.key?' on':''}" data-a="sel" data-k="${dkEsc(x.key)}"><td><span class="dk-tk">${dkEsc(sec.tk)}</span><span class="dk-nm">${dkEsc(sec.name)}</span></td><td class="r dk-num">${dkPx(sec.price)}</td><td class="r c-opt">${dkDay(sec.day)}</td><td colspan="6" class="dk-mut">${RT('свечи грузятся…','candles loading…')}</td></tr>`;
    const p=deskPlanFor(x,s.side)||s.plan;
    return `<tr class="dk-tr${DESK_UI.sel===x.key?' on':''}" data-a="sel" data-k="${dkEsc(x.key)}"><td><span class="dk-tk">${dkEsc(sec.tk)}</span><span class="dk-nm">${dkEsc(sec.name)}</span>${sec.held.length?` <span class="dk-tag">${RT('в книге','in book')}</span>`:''}</td><td class="r dk-num">${dkPx(s.price)}<span class="dk-mut dk-xs"> ${dkCcy(sec.ccy)}</span></td><td class="r c-opt">${dkDay(s.day)}</td><td>${dkPhase(s)}</td><td class="c-opt">${s.near?`<span class="dk-tag">${dkEsc(s.near.src.replace(/\+/g,' · '))}</span> <span class="dk-num dk-mut">${dkPct(s.near.dist,1)}</span>`:'<span class="dk-mut">—</span>'}</td><td class="r dk-num dk-xs c-opt">${p.mode==='limit'?`<span class="dk-tag">${RT('лим.','lim.')} ${dkPct(p.dEntry,1)}</span> `:''}${dkPx(p.entry)} · <span class="dk-dn">${dkPx(p.stop)}</span> · <span class="dk-up">${dkPx(p.target)}</span></td><td class="r dk-num dk-b">${dkRR(p)}</td><td class="r c-opt"><span class="dk-bar"><i style="width:${s.score}%"></i></span> <span class="dk-num">${s.score}</span></td><td>${dkPill(s.verdict,!!sec.held.length)} ${dkFlags(s)}</td></tr>`;}).join('');
  return deskIdeaBucketsHTML()+`<div class="dk-filters">
      <div class="dk-seg" role="group" aria-label="${RT('Вердикт','Verdict')}">${[['all',RT('Все','All')],['buy','▲ '+RT('Купить','Buy')],['short','▼ '+RT('Шорт','Short')],['trim','◆ '+RT('Перегрев','Overheated')],['wait','○ '+RT('Ждать','Wait')]].map(([v,l])=>`<button class="${f.v===v?'on':''}" data-a="fv" data-v="${v}">${l}</button>`).join('')}</div>
      <select class="dk-sel" data-c="fside" aria-label="${RT('Сторона','Side')}">${opt([['all',RT('Обе стороны','Both sides')],['long','▲ '+RT('Лонг','Long')],['short','▼ '+RT('Шорт','Short')]],f.side)}</select>
      <select class="dk-sel" data-c="fphase" aria-label="${RT('Фаза','Phase')}">${opt(ph,f.phase)}</select>
      <select class="dk-sel" data-c="ftab" aria-label="${RT('Вкладка','Tab')}">${opt([['all',RT('Все вкладки','All tabs')]].concat(tabs.map(t=>[t,TAB_LABEL(t)])),f.tab)}</select>
      <select class="dk-sel" data-c="fsector" aria-label="${RT('Сектор','Sector')}">${opt([['all',RT('Все сектора','All sectors')]].concat(secs.map(s=>[s,(s==='—'?RT('без сектора','no sector'):T(s))+' · '+secN[s]])),f.sector||'all')}</select>
      <button class="dk-toggle${f.near?' on':''}" data-a="fnear" aria-pressed="${f.near}"${dkG('near')}>${RT(`у уровня ≤ ${C.nearPct} %`,`at level ≤ ${C.nearPct} %`)}</button>
      <button class="dk-toggle${f.rr?' on':''}" data-a="frr" aria-pressed="${f.rr}"${dkG('rr')}>R/R ≥ ${C.rrMin}</button>
      <button class="dk-toggle${f.held?' on':''}" data-a="fheld" aria-pressed="${f.held}">${RT('в книге','in book')}</button>
      <input class="dk-inp" data-c="fq" value="${dkEsc(f.q)}" placeholder="${RT('фильтр…','filter…')}" aria-label="${RT('Фильтр по тикеру/имени','Filter by ticker/name')}">
      <span class="dk-note dk-ml">${R.length} ${RT('из','of')} ${I.items.length} · ${I.tabsN} ${RT('вкладок','tabs')} · j / k / Enter</span>
    </div>
    <div class="dk-scr${DESK_UI.sel?' open':''}"><div><div class="dk-ideas">${ideaCards||`<div class="dk-panel dk-empty">${RT('Ничего не подходит под фильтры.','Nothing matches the filters.')}</div>`}</div><details class="dk-panel dk-mt14"><summary class="dk-ph"><h2>${RT('Подробная таблица','Detailed table')}</h2><span class="dk-cnt">${R.length}</span></summary><div class="dk-wrap"><table class="dk-tbl"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>${R.length>shown.length?`<div class="dk-empty">${RT(`Показаны первые ${shown.length} — сузьте фильтры.`,`First ${shown.length} shown — narrow the filters.`)}</div>`:''}</div></details></div>
      ${DESK_UI.sel?`<aside class="dk-drawer">${deskDrawerHTML()}</aside>`:''}</div>`;
}
function deskDrawerHTML(){
  const it=deskSecOf(DESK_UI.sel);if(!it)return '';
  const side=deskSideFor(it),s=it.s;
  return `<div class="dk-panel"><div class="dk-ph"><h2><span class="dk-tk">${dkEsc(it.sec.tk)}</span> <span class="dk-nm">${dkEsc(it.sec.name)}</span></h2><div class="dk-act"><div class="dk-seg side"><button class="${side==='long'?'on':''} long" data-a="side" data-v="long" data-k="${dkEsc(it.key)}">${RT('Лонг','Long')}</button><button class="${side==='short'?'on':''} short" data-a="side" data-v="short" data-k="${dkEsc(it.key)}">${RT('Шорт','Short')}</button></div><button class="dk-btn dk-sm" data-a="unsel" aria-label="${RT('Закрыть','Close')}">✕</button></div></div>
    <div class="dk-chart-panel"><div id="dkMini" class="dk-mini">${it.r?'':RT('Нет строки бумаги','No row')}</div></div>
    <div class="dk-bt">${deskPlanBox(it,side,true)}${s?`<div class="dk-why dk-padx">${s.why.map(w=>`<div>${dkEsc(w)}</div>`).join('')}</div>`:''}<div class="dk-pad dk-row"><button class="dk-btn" data-a="open" data-k="${dkEsc(it.key)}">${RT('Открыть страницу акции →','Open stock page →')}</button>${dkWatchBtn(it.key)}${dkCmpBox(it.key)}</div></div></div>`;
}

// ═══════════════════ Список покупок (I1, §3.1) ═══════════════════
function deskWatchPx(I,w){const it=I.byKey[w.key];return it?(it.s?it.s.price:it.sec.price):null;}
function dkZoneText(w){return w.buyHi?(w.buyLo<w.buyHi?`${dkPx(w.buyLo)}–${dkPx(w.buyHi)}`:dkPx(w.buyHi)):'—';}
// «нужна коррекция ≈ −12 %» / диапазон «≈ −22…−29 %» / в зоне / ниже зоны.
function dkZoneNeed(w,z){
  if(!z)return w.buyHi?RT('нет цены','no price'):RT('зона не задана','no zone set');
  if(z.state==='in')return RT('цена в зоне','price in the zone');
  if(z.state==='below')return RT(`ниже зоны на ${dkN((1-1/(1+z.dLo/100))*100,1)} %`,`${dkN((1-1/(1+z.dLo/100))*100,1)} % below the zone`);
  const d=v=>dkN(v,Math.abs(v)<10?1:0);
  return RT('нужна коррекция','correction needed')+` ≈ ${d(z.dHi)}${z.range?`…${d(z.dLo)}`:''} %`;
}
function deskWatchHTML(status){
  const I=deskItems(),W=deskWatchItems('watch','main'),F=deskWatchItems('final','main'),L=status==='final'?F:W;
  const lst=(DESK_WATCH.lists||[])[0]||{},name=lst.name||RT('Список покупок','Shopping list'),canE=can('action.edit_plan');
  let fine=false;try{fine=matchMedia('(pointer:fine)').matches;}catch(e){}
  const hotTitle=RT(`● зелёная — цена в зоне, ниже неё или не дальше ${DESK_IDEA_CFG.nearZonePct} % над верхом`,`● green — price in the zone, below it or within ${DESK_IDEA_CFG.nearZonePct} % above the top`);
  const nav=W.map((w,i)=>{const z=deskWatchZone(w,deskWatchPx(I,w));return `<button class="dk-wnav" data-a="wjump" data-k="${dkEsc(w.key)}"><span class="dk-dot${z&&z.hot?' hot':''}" title="${z&&z.hot?hotTitle:''}"></span><span class="dk-num dk-mut">${String(i+1).padStart(2,'0')}/${String(W.length).padStart(2,'0')}</span><b class="dk-tk">${dkEsc(w.tk)}</b><span class="dk-nm">${dkEsc(w.name)}</span></button>`;}).join('')
    +`<button class="dk-wnav fin${status==='final'?' on':''}" data-a="iv" data-v="${status==='final'?'watch':'final'}">${status==='final'?RT('← Список','← List'):RT('Финал','Final')} <span class="dk-cnt">${status==='final'?W.length:F.length}</span></button>`;
  const card=(w,i)=>{
    const it=I.byKey[w.key],s=it&&it.s,px=deskWatchPx(I,w),z=deskWatchZone(w,px),pl=s?(deskPlanFor(it,'long')||s.plans.long):null,open=DESK_UI.wmenu===w.key;
    const menu=open?`<div class="dk-wmenu" role="menu" data-a="noop">
        <button class="dk-mi" role="menuitem" data-a="wstat" data-k="${dkEsc(w.key)}" data-v="${w.status==='final'?'watch':'final'}">${w.status==='final'?'↩ '+RT('Вернуть в список','Back to the list'):'★ '+RT('В финал','To final')}</button>
        <button class="dk-mi" role="menuitem" data-a="wnotify" data-k="${dkEsc(w.key)}"${w.buyHi?'':' disabled'}>🔔 ${RT('Уведомить при','Alert at')} ${dkPx(w.buyHi)}</button>
        <button class="dk-mi" role="menuitem" data-a="wedit" data-k="${dkEsc(w.key)}" data-f="zone">✎ ${RT('Изменить зону и тезис…','Edit zone & thesis…')}</button>
        <button class="dk-mi" role="menuitem" data-a="wmove" data-k="${dkEsc(w.key)}" data-v="-1"${i?'':' disabled'}>↑ ${RT('Выше','Up')}</button>
        <button class="dk-mi" role="menuitem" data-a="wmove" data-k="${dkEsc(w.key)}" data-v="1"${i<L.length-1?'':' disabled'}>↓ ${RT('Ниже','Down')}</button>
        <button class="dk-mi dk-dn" role="menuitem" data-a="wdel" data-k="${dkEsc(w.key)}">🗑 ${RT('Удалить','Delete')}</button></div>`:'';
    return `<article class="dk-wcard v-${s?s.verdict:'wait'}${open?' menu-open':''}" id="dkw-${dkEsc(w.key.replace(/[^A-Z0-9]/gi,'_'))}" data-a="open" data-k="${dkEsc(w.key)}" data-wk="${dkEsc(w.key)}" tabindex="0"${fine&&canE?' draggable="true"':''} aria-label="${dkEsc(w.tk+' · '+w.name)}">
      <div class="dk-wcard-hd"><span class="dk-num dk-mut">${String(i+1).padStart(2,'0')}</span><b class="dk-tk">${dkEsc(w.tk)}</b>${w.tag?`<span class="dk-wtag">${dkEsc(w.tag)}</span>`:''}${canE?`<button class="dk-btn dk-sm dk-wmore" data-a="wmenu" data-k="${dkEsc(w.key)}" aria-haspopup="true" aria-expanded="${open}" aria-label="${RT('Действия','Actions')} ${dkEsc(w.tk)}">···</button>`:''}</div>
      <div class="dk-wname">${dkEsc(w.name)}</div>
      <div class="dk-idea-route"><span><small>${RT('Сейчас','Now')}</small><b class="dk-num">${dkPx(px)}</b></span><i>→</i><span><small${dkG('zone')}>${RT('Куплю','Buy at')}</small><b class="dk-num dk-up">${dkZoneText(w)}</b></span></div>
      <div class="dk-wneed${z&&z.hot?' hot':''}"${z&&z.hot?dkG('zone-dot'):dkG('zone-need')}><span class="dk-dot${z&&z.hot?' hot':''}"></span>${dkEsc(dkZoneNeed(w,z))} <span class="dk-mut">${dkEsc(dkCcy(w.ccy))}</span></div>
      <div class="dk-idea-foot">${s?`<span>v2 ${dkPill(s.verdict,!!(it.sec.held||[]).length)}</span><span>R/R <b class="dk-num">${dkRR(pl)}</b></span>`:`<span>${it?RT('сигнал считается…','signal loading…'):RT('бумаги нет во вкладках','not in any tab')}</span>`}</div>${it?`<div class="dk-idea-add">${dkCmpBox(w.key)}</div>`:''}${menu}</article>`;
  };
  const head=`<div class="dk-whead"><div><h2>${dkEsc(name)}${canE?` <button class="dk-btn dk-sm" data-a="wname" aria-label="${RT('Переименовать список','Rename the list')}">✎</button>`:''}</h2><div class="dk-note">${status==='final'?RT('Финал — отобранные к покупке','Final — picked to buy'):RT('текущая цена → моя зона покупки','current price → my buy zone')}</div></div><div class="dk-wcount"><span>${RT('Компаний','Companies')}</span><b class="dk-num">${L.length}</b></div></div>`;
  const empty=`<div class="dk-panel dk-empty">${status==='final'?RT('В финале пока пусто — «···» → «В финал» на карточке списка.','Nothing in the final yet — “···” → “To final” on a list card.'):RT('Список пуст. Добавьте бумагу кнопкой «＋ В список» во «Всех идеях», в инспекторе или на странице акции.','The list is empty. Add a stock with “＋ To list” in All ideas, the inspector or on the stock page.')}</div>`;
  return `${head}<div class="dk-wlayout"><nav class="dk-wside" aria-label="${dkEsc(name)}">${nav}</nav><div class="dk-wgrid">${L.length?L.map(card).join(''):empty}</div></div>
    <p class="dk-note dk-mt14">${RT(`Зона — ваша цена покупки (по умолчанию из сигнала: лимит плана v2 или ближайшая поддержка). «Уведомить» создаёт правило плана на верх зоны; удаление идеи правило не удаляет без вопроса. ${hotTitle}.`,`The zone is your buy price (default from the signal: v2 plan limit or nearest support). “Alert” creates a plan rule at the top of the zone; deleting an idea asks before deleting the rule. ${hotTitle}.`)}</p>`;
}

// ═══════════════════ Сравнение 2–4 бумаг (P4, plans/stock-selection-ux.md §6) ═══════════════════
// Выбор — DESK_UI.compare.keys: биржевые ключи в памяти вкладки, до selection.maxCompare; «Сравнить» не добавляет
// бумагу в список покупок. Смена аккаунта очищает выбор, бумага без доступа (или удалённая из вкладок) убирается
// с пояснением. Строки и сопоставимость — чистая deskCompareModel (desk-selection.js); здесь адаптер и вёрстка.
function deskCompareKeys(){
  const C=DESK_UI.compare,acct=(currentUser&&currentUser.id)||'';
  if(C.acct!==acct){C.keys=[];C.acct=acct;C.dropped=0;}
  if(!C.keys.length)return [];
  const I=can('view.portfolio')?deskItems():{byKey:{}},keep=C.keys.filter(k=>I.byKey[k]);
  if(keep.length<C.keys.length){C.dropped+=C.keys.length-keep.length;C.keys=keep;}
  return keep.slice();
}
function deskCmpToggleKey(k){
  const max=DESK_IDEA_CFG.selection.maxCompare,r=deskCompareToggle(deskCompareKeys(),k,max);
  if(r.full)toast(RT(`В сравнении уже ${max} бумаги — уберите одну`,`${max} stocks are already in the comparison — remove one`),true);
  DESK_UI.compare.keys=r.keys;DESK_UI.compare.dropped=0;deskRender(true);
}
// Чекбокс «Сравнить»: label — noop (клик по нему не открывает карточку), событие — у самого input.
const dkCmpBox=key=>{const on=DESK_UI.compare.keys.includes(key);
  return `<label class="dk-cmp-t${on?' on':''}" data-a="noop"><input type="checkbox" data-a="cmp" data-k="${dkEsc(key)}"${on?' checked':''}>${RT('Сравнить','Compare')}</label>`;};
// Лоток выбора внизу экрана (кроме самого сравнения): бумаги, «Сравнить →» (от двух) и «Очистить».
function deskCmpTrayHTML(){
  if(DESK_UI.route==='compare')return '';
  const K=deskCompareKeys();if(!K.length)return '';
  const I=deskItems(),max=DESK_IDEA_CFG.selection.maxCompare;
  const chips=K.map(k=>{const it=I.byKey[k],tk=dkEsc(it?it.sec.tk:k);return `<span class="dk-cmp-chip"><b class="dk-tk">${tk}</b><button type="button" class="dk-cmp-x" data-a="cmp" data-k="${dkEsc(k)}" aria-label="${RT('Убрать из сравнения','Remove from comparison')} ${tk}">✕</button></span>`;}).join('');
  return `<div class="dk-cmp-tray" role="region" aria-label="${RT('Выбор для сравнения','Comparison selection')}"><span class="dk-lbl">${RT('Сравнение','Compare')}${dkGi('compare')} <span class="dk-num">${K.length}/${max}</span></span>${chips}
    <span class="dk-cmp-tray-a">${K.length<2?`<span class="dk-note">${RT('выберите ещё хотя бы одну','pick at least one more')}</span>`:''}<button type="button" class="dk-btn dk-sm dk-cmp-go" data-a="nav" data-r="compare"${K.length<2?' disabled':''}>${RT('Сравнить','Compare')} →</button><button type="button" class="dk-btn dk-sm" data-a="cmpclr">${RT('Очистить','Clear')}</button></span></div>`;
}
// Портфель сравнения — один для всех бумаг: выбранный в шапке, из «Все портфели» — портфель риска (как «Акция»).
function deskCmpPort(){const p=deskPort();return p==='all'?deskRiskTab():p;}
// Дней до отчёта: ?earnings= (грузится при входе в сравнение), иначе календарь ?calendar=.
function deskEarnDaysOf(sym,now){
  const E=(_deskEarn[sym]||{}).data,next=E&&E.next&&E.next.date?String(E.next.date).slice(0,10):null;
  if(!next)return sigEarnDays(sym,now);
  const n=Math.round((Date.parse(next+'T00:00:00Z')-Date.parse(new Date(now||Date.now()).toISOString().slice(0,10)+'T00:00:00Z'))/864e5);
  return isFinite(n)&&n>=0?n:null;
}
// Колонка: модель P1 с одним портфелем для всех, факты FY из ?financials=, forward P/E своего листинга, дни до отчёта.
// Права — те же, что у «Решения»/«Компании»; нет доступа к бумаге — колонки нет.
function deskCompareCols(keys,port,now){
  now=now==null?Date.now():now;
  const U=deskUniverse(now),rk=deskSelectionRiskKr(port),I=deskItems(),health=can('view.health'),valA=can('view.valuation');
  return (keys||[]).map(k=>{
    const it=I.byKey[k];if(!it)return null;
    let model=null;try{model=deskSelectionModel(deskSelectionInput(k,port,now,U,rk));}catch(e){console.warn('compare model',e);}
    if(!model)return null;
    const sec=it.sec,fc=_deskFin[sec.sym],V=valA?deskSelectionCache(VAL,sec).data:null,F=health?pf3FundFor(sec.sym):null;
    const fwd=V&&V.fwdPe>0?+V.fwdPe:F&&F.fwdPe>0?+F.fwdPe:null;
    return {key:k,tk:sec.tk,name:sec.name,ccy:sec.ccy,sector:sec.sector,fin:pf3FinSec(sec.sector),model,it,
      facts:health?deskCompareFinFacts(fc&&fc.data):{fy:null,codes:['business-restricted']},finBusy:health&&!!(fc&&fc.loading),
      fwdPe:valA?fwd:null,earnDays:deskEarnDaysOf(sec.sym,now)};
  }).filter(Boolean);
}
// «Что если?» сравнения (§6): каждая бумага — отдельно против ТЕКУЩЕГО портфеля с одним бюджетом (DESK.whatIf);
// варианты не складываются в корзину на один кэш. Сторона — позиции в этом портфеле или лонг. Ничего не пишет.
function deskCompareWhatIf(it,port,now){
  if(!port)return {err:'port'};
  const c=deskWiCfg(),h=bookPositions(port).find(p=>p.sym+'|'+p.ccy===it.key),side=h?h.side:'long',s=it.s,plan=s?deskPlanFor(it,side):null;
  return deskWhatIf({tab:port,sec:it.sec,side,plan,mode:c.mode,amountSEK:c.amountSEK,weightPct:c.weightPct,
    price:plan&&plan.mode==='limit'?plan.entry:(s?s.price:it.sec.price),now:now||Date.now()});
}
// Загрузки при входе в сравнение (§8): отчётность, ?financials=, ?earnings= выбранных бумаг — через общий пул
// (лимит, дедуп, TTL загрузчиков). Перерисовка не повторяет; новая бумага в выборе догружается одна.
function deskCompareEnsure(){
  if(DESK_UI.route!=='compare'){DESK_UI._cmpFor=null;return;}
  const K=deskCompareKeys(),sig=K.join(',');if(DESK_UI._cmpFor===sig)return;
  const prev=new Set(String(DESK_UI._cmpFor||'').split(','));DESK_UI._cmpFor=sig;
  K.filter(k=>!prev.has(k)).forEach(k=>{const it=deskSecOf(k);if(it)deskCompareLoad(it);});
}
function deskCompareLoad(it){
  const sym=it.sec.sym;
  if(can('view.health')){deskPoolRun('fund|'+sym,()=>pf3FundFetch([sym]));deskFinLoad(sym);}
  deskPoolRun('earn|'+sym,()=>deskEarnLoad(sym));
}
// «Обновить цены»: живая котировка и свечи только тех выбранных бумаг, у которых цена не свежая.
function deskCompareRefresh(){
  if(!can('action.refresh_data'))return;
  const st=DESK_IDEA_CFG.whatIf.staleMin*60e3;
  deskCompareKeys().forEach(k=>{const it=deskSecOf(k);if(!it||!it.r)return;const sym=it.sec.sym,lv=PX_LIVE[sym];
    if(lv&&lv.price>0&&Date.now()-lv.at<=st)return;
    deskPoolRun('px|'+sym,()=>pf3RefreshCardPrice(it.d,it.r,it.tab));deskPoolRun('hist|'+sym,()=>sigEnsure([sym]));});
  deskRender(true);
}
// «★ В финал» — существующие мутаторы списка и права: нет в списке — добавить (зона по сигналу), затем статус final.
function deskCompareFinal(key){
  if(!can('action.edit_plan'))return;
  if(!deskWatchGet(key)&&!deskWatchAddFrom(key,true))return;
  deskWatchSetStatus(key,'final');scheduleSave();
  toast('★ '+RT('В финале','In the final')+': '+((deskWatchGet(key)||{}).tk||key));deskRender(true);
}
// «← Назад»: пришли из desk — history.back() (вернёт подборку, фильтры и прокрутку из записи истории), иначе — «Идеи».
function deskCompareBack(){
  let st=null;try{st=history.state;}catch(e){}
  if(DESK_UI._cmpFrom&&st&&st.dk){try{history.back();return;}catch(e){}}
  deskGo(DESK_UI._cmpFrom||'screen');
}
// Подписи строк: [название, запись словаря].
const DK_CMP_ROW={action:[()=>RT('Действие','Action'),'decision'],quality:[()=>RT('Компания','Company'),'selection-quality'],
  valuation:[()=>RT('Цена к оценке','Price vs valuation'),'selection-valuation'],timing:[()=>RT('Момент','Timing'),'dim-timing'],rr:[()=>'R/R','rr'],
  risk:[()=>RT('Риск','Risk'),'risk-level'],earnings:[()=>RT('Отчёт','Earnings'),'events'],
  profit:[()=>RT('Прибыльность','Profitability'),'biz'],growth:[()=>RT('Рост','Growth'),'biz'],balance:[()=>RT('Баланс','Balance sheet'),'biz'],cash:[()=>RT('Денежный поток','Cash flow'),'biz'],
  'rev-yoy':[()=>RT('Выручка г/г','Revenue YoY'),'fin'],'eps-yoy':[()=>RT('EPS г/г','EPS YoY'),'fin'],'fcf-margin':[()=>RT('FCF-маржа','FCF margin'),'fin'],
  pe:[()=>'P/E TTM','analysts'],'fwd-pe':[()=>'Forward P/E','analysts'],'entry-dist':[()=>RT('До входа','To entry'),'market-limit'],
  'stop-dist':[()=>RT('До стопа','To stop'),'stop'],sector:[()=>RT('Сектор','Sector'),'compare-comparable']};
const DK_CMP_WHY={none:()=>RT('значения нет ни у одной бумаги','no stock has a value'),missing:()=>RT('не у всех есть значение','not every stock has a value'),'not-applicable':()=>RT('к части бумаг неприменимо','not applicable to some stocks'),
  provisional:()=>RT('предварительные данные','provisional data'),status:()=>RT('не у всех оценка датирована и сопоставима','not every valuation is dated and comparable'),
  'applicability-differs':()=>RT('разный набор применимых столпов','different applicable pillars'),'source-differs':()=>RT('разные источники оценки','different valuation sources'),
  'side-differs':()=>RT('планы разных сторон','plans of different sides'),'period-differs':()=>RT('разный тип периода','different period types'),
  equal:()=>RT('значения равны','values are equal'),few:()=>''};
const DK_CMP_DIM={action:()=>RT('Действие','Action'),company:()=>RT('Компания','Company'),price:()=>RT('Цена','Price'),timing:()=>RT('Момент','Timing'),risk:()=>RT('Риск','Risk'),earnings:()=>RT('Отчёт','Earnings')};
const dkCmpSm=t=>t?`<small class="dk-cmp-sub">${t}</small>`:'';
function dkCmpVerdictText(verdict,waiting,dEntry,entry){
  if(!verdict)return RT('сигнал считается','signal loading');
  const V=(DK_V[verdict]||DK_V.wait)[1]();
  return V+(waiting!=null?' · '+RT('ждать','wait for')+' '+dkPx(waiting)+(dEntry!=null?` (${dkPct(dEntry,1)})`:''):entry>0?' · '+RT('по рынку','at market')+' ≈ '+dkPx(entry):'');
}
function dkCmpCell(row,c,col){
  const busy=t=>deskPoolBusy(t+'|'+col.it.sec.sym),dash='<span class="dk-mut">—</span>',ld=`<span class="dk-mut">${RT('загрузка…','loading…')}</span>`;
  switch(row.id){
    case 'action':{if(c.pos)return dkActPill(c.pos)+dkCmpSm(dkEsc((DK_DEC_POS[c.pos]||DK_DEC_POS.hold)()));
      const D=DK_DEC[c.k]||DK_DEC.study;return `<span class="dk-pill v-${D[1]}"${dkG('dec-'+(DK_DEC[c.k]?c.k:'study'))}>${dkEsc(D[0]())}</span>`;}
    case 'quality':{const Q=dkQualHTML(col.model.quality);return (Q.v==='—'&&busy('fund')?ld:Q.v)+dkCmpSm(Q.d);}
    case 'valuation':{const v=col.model.valuation;
      if(v.value!=null&&v.status!=='incomparable')return (c.v!=null?`<b class="dk-num ${c.v>=0?'dk-up':'dk-dn'}">${dkPct(c.v,1)}</b>`:`<b class="dk-num">${dkPx(v.value)}</b>`)
        +dkCmpSm(dkEsc([v.source==='scenarios'?RT('ваши сценарии','your scenarios'):RT('аналитики','analysts'),v.asOf?String(v.asOf).slice(0,10):null,
          v.status==='stale'?RT('таргет устарел','stale target'):v.status==='undated'?RT('дата источника неизвестна','source date unknown'):null].filter(Boolean).join(' · ')));
      return dash+dkCmpSm(dkEsc(v.reasonCodes.includes('valuation-restricted')?dkSelR('valuation-restricted'):v.status==='incomparable'?dkSelR('valuation-incomparable'):RT('оценки нет — это не значит «дорого»','no valuation — that does not mean “expensive”')));}
    case 'timing':{if(!c.verdict)return `<span class="dk-mut">${RT('сигнал считается…','signal loading…')}</span>`;
      const d=c.waiting!=null?`${RT('ждать','wait for')} ${dkPx(c.waiting)}${c.dEntry!=null?` (${dkPct(c.dEntry,1)})`:''}`:c.entry>0?`${RT('по рынку','at market')} ≈ ${dkPx(c.entry)}`:dkSelR('level-not-calculated');
      return dkPill(c.verdict,!!col.it.sec.held.length)+(c.side==='short'?' '+dkSide('short'):'')+dkCmpSm(dkEsc(d));}
    case 'rr':return c.v!=null?`<b class="dk-num">${c.approx?'≈':''}${dkN(c.v,1)}</b>${c.basis==='short'?dkCmpSm(RT('план шорта','short plan')):''}`:dash;
    case 'risk':return (c.level?`<b class="dk-num">${c.level}</b> · ${dkEsc(deskRiskWord(c.level))}`:dash)
      +dkCmpSm(dkEsc([c.override&&c.v&&c.override!==c.v?RT(`вручную; авто ${c.v}`,`manual; auto ${c.v}`):'',...c.blockers.map(dkSelR)].filter(Boolean).join(' · ')));
    case 'earnings':return c.v!=null?`<span class="${c.soon?'dk-flag':'dk-num'}"${c.soon?dkG('fl-earnings'):''}>${RT('через','in')} ${c.v} ${RT('дн','d')}</span>`+(c.soon?dkCmpSm(RT('новый вход заблокирован','new entry blocked')):'')
      :busy('earn')?ld:`<span class="dk-mut">${RT('дата неизвестна','date unknown')}</span>`;
    case 'profit':case 'growth':case 'balance':case 'cash':
      return c.na?`<span class="dk-mut"${dkG('selection-na')}>${RT('н/п','n/a')}</span>`:c.v!=null?`<b class="dk-num">${dkN(c.v,1)}</b><small>/10</small>`:busy('fund')?ld:dash;
    case 'rev-yoy':case 'eps-yoy':
      if(c.v!=null)return `<b class="dk-num ${c.v>=0?'dk-up':'dk-dn'}">${dkPct(c.v,1)}</b>`+dkCmpSm('FY'+c.fy);
      if(c.codes.some(x=>/-base-nonpositive$/.test(x)))return `<span class="dk-mut">${RT('н/з','n/m')}</span>`+dkCmpSm(RT('база ≤ 0 — не в процентах','base ≤ 0 — not a percentage'));
      return col.finBusy?ld:dash+dkCmpSm(c.codes.includes('business-restricted')?dkEsc(dkSelR('business-restricted')):'');
    case 'fcf-margin':
      if(c.na)return `<span class="dk-mut"${dkG('selection-na')}>${RT('н/п','n/a')}</span>`+dkCmpSm(RT('банк/финансы','bank/financials'));
      return c.v!=null?`<b class="dk-num">${dkN(c.v,1)} %</b>`+dkCmpSm('FY'+c.fy):col.finBusy?ld:dash;
    case 'pe':return c.na?dash+dkCmpSm(dkEsc(dkSelR('pe-nonpositive-eps'))):c.v!=null?`<b class="dk-num">${dkN(c.v,1)}</b>`:dash;
    case 'fwd-pe':return c.v!=null?`<b class="dk-num">${dkN(c.v,1)}</b>`:dash;
    case 'entry-dist':return c.v!=null?`<span class="dk-num">${dkPct(c.v,1)}</span>`+dkCmpSm(c.mode==='limit'?RT('лимит','limit'):RT('по рынку','at market')):dash;
    case 'stop-dist':return c.v!=null?`<span class="dk-num">${dkPct(-c.v,1)}</span>`:dash;
    case 'sector':return c.text?dkEsc(c.text):dash;
  }
  return dash;
}
// Отметка лучшего/худшего — цветом и текстом (не только цветом): «максимум»/«минимум» по направлению строки.
function dkCmpMark(row,i){
  const hiT='▲ '+RT('максимум','highest'),loT='▼ '+RT('минимум','lowest');
  if(row.best.includes(i))return `<small class="dk-cmp-mk">${row.dir==='hi'?hiT:loT}</small>`;
  if(row.worst.includes(i))return `<small class="dk-cmp-mk">${row.dir==='hi'?loT:hiT}</small>`;
  return '';
}
function dkCmpRowHTML(row,cols){
  const L=DK_CMP_ROW[row.id]||[()=>row.id,null],why=row.dir&&row.why&&row.why!=='few'?(row.why==='equal'?DK_CMP_WHY.equal():RT('без подсветки: ','no highlight: ')+DK_CMP_WHY[row.why]()):'';
  const note=row.id==='sector'&&new Set(row.cells.map(c=>c.text)).size===1&&row.cells[0].text?RT('один сектор — ещё не прямые конкуренты','one sector does not make direct peers'):'';
  return `<tr><th scope="row" class="dk-cmp-lbl"><span${L[1]?dkG(L[1]):''}>${L[0]()}</span>${why?`<small${dkG('compare-comparable')}>${dkEsc(why)}</small>`:''}${note?`<small>${dkEsc(note)}</small>`:''}</th>`
    +row.cells.map((c,i)=>`<td class="${row.best.includes(i)?'best':row.worst.includes(i)?'worst':''}">${dkCmpCell(row,c,cols[i])}${dkCmpMark(row,i)}</td>`).join('')+'</tr>';
}
function dkCmpHeadHTML(cols,withX){
  return `<thead><tr><th scope="col" class="dk-cmp-lbl"><span class="dk-mut">${RT('Бумага','Stock')}</span></th>${cols.map(c=>{const s=c.it.s,px=s?s.price:c.it.sec.price,fresh=c.model.price.freshness==='fresh';
    return `<th scope="col" class="dk-cmp-col"><div class="dk-cmp-hd"><button type="button" class="dk-link dk-tk" data-a="open" data-k="${dkEsc(c.key)}">${dkEsc(c.tk)}</button>${withX?`<button type="button" class="dk-cmp-x" data-a="cmp" data-k="${dkEsc(c.key)}" aria-label="${RT('Убрать из сравнения','Remove from comparison')} ${dkEsc(c.tk)}">✕</button>`:''}</div>
      <div class="dk-nm">${dkEsc(c.name)}</div><div class="dk-num">${dkPx(px)} ${dkCcy(c.ccy)} <span class="dk-tag${fresh?'':' dk-mut'}"${dkG('live')}>${fresh?'live':RT('не live','not live')}</span></div></th>`;}).join('')}</tr></thead>`;
}
function dkCmpFinalBtn(key){
  const w=deskWatchGet(key);if(w&&w.status==='final')return `<span class="dk-tag dk-inlist">★ ${RT('в финале','in the final')}</span>`;
  return can('action.edit_plan')?`<button type="button" class="dk-btn dk-sm" data-a="cfinal" data-k="${dkEsc(key)}">★ ${RT('В финал','To final')}</button>`:'';
}
function deskCompareDiffsHTML(M,cols){
  const tk=k=>{const c=cols.find(x=>x.key===k);return dkEsc(c?c.tk:k);};
  const one=(dim,x)=>{switch(dim){
    case 'action':return x.pos?(DK_DEC_POS[x.pos]||DK_DEC_POS.hold)():(DK_DEC[x.k]||DK_DEC.study)[0]();
    case 'company':return x.mode==='full'?`${x.grade} · ${dkN(x.value,1)}/10`:x.mode==='partial'?RT(`предварительно, ${x.known} из ${x.applicable} столпов`,`provisional, ${x.known} of ${x.applicable} pillars`):x.mode==='lite'?RT('без рейтинга — отчётность не загружена','no rating — reports not loaded'):RT('нет данных о бизнесе','no business data');
    case 'price':return ['available','undated','stale'].includes(x.status)?`${x.upsidePct!=null?dkPct(x.upsidePct,0):'—'} ${RT('к оценке','to valuation')} (${x.source==='scenarios'?RT('ваши сценарии','your scenarios'):RT('аналитики','analysts')}${x.status==='stale'?', '+RT('таргет устарел','stale target'):x.status==='undated'?', '+RT('без даты','undated'):''})`
      :x.status==='incomparable'?RT('оценка несопоставима с ценой','valuation not comparable with the price'):RT('оценки нет','no valuation');
    case 'timing':return dkCmpVerdictText(x.verdict,x.waiting,x.dEntry,x.entry)+(x.side==='short'?' · '+RT('шорт','short'):'');
    case 'risk':return `${x.level||'—'} ${deskRiskWord(x.level)}`+(x.blockers.length?' · '+x.blockers.map(dkSelR).join(', '):'');
    case 'earnings':return x.days!=null?RT(`отчёт через ${x.days} дн`,`earnings in ${x.days} d`)+(x.soon?' — '+RT('новый вход заблокирован','new entry blocked'):''):RT('дата отчёта неизвестна','earnings date unknown');
  }return '';};
  const L=M.diffs.map(d=>`<li><b>${DK_CMP_DIM[d.dim]()}</b><span>${d.items.map(x=>`<span class="dk-tk">${tk(x.key)}</span> — ${dkEsc(one(d.dim,x))}`).join('<i>·</i>')}</span></li>`).join('');
  return `<section class="dk-panel dk-mb"><div class="dk-ph"><h2>${RT('Чем отличаются условия','How the conditions differ')}${dkGi('compare-diffs')}</h2><span class="dk-note dk-ml">${RT('факты по измерениям, без итога «A лучше B»','facts by dimension, no “A beats B” verdict')}</span></div>
    ${L?`<ul class="dk-cmp-diff">${L}</ul>`:`<div class="dk-empty">${RT('По действию, компании, цене, моменту и риску условия одинаковые — различия в показателях ниже.','Action, company, price, timing and risk are the same — the differences are in the metrics below.')}</div>`}</section>`;
}
// «Что если?» сравнения: один бюджет и портфель, каждая бумага — отдельно (не корзина покупок).
function deskCompareWiHTML(cols,port){
  if(!port||!cols.length)return '';
  const c=deskWiCfg(),C=DESK_IDEA_CFG.whatIf,amt=c.mode==='amount',v=DESK_UI.wiRaw!=null?DESK_UI.wiRaw:(amt?c.amountSEK:c.weightPct),R=cols.map(x=>deskCompareWhatIf(x.it,port));
  const ST={ok:['✓',RT('можно','clear'),'buy'],attention:['⚠',RT('внимание','attention'),'trim'],blocked:['⛔',RT('заблокировано','blocked'),'short']};
  const cell=(r,f)=>r&&!r.err?f(r):`<span class="dk-mut">${r&&r.err==='price'?RT('нет цены','no price'):'—'}</span>`;
  const row=(l,f)=>`<tr><th scope="row" class="dk-cmp-lbl">${l}</th>${R.map(r=>`<td>${cell(r,f)}</td>`).join('')}</tr>`;
  const inputs=`<div class="dk-wi-in"><div class="dk-seg" role="group" aria-label="${RT('Сумма или доля','Amount or weight')}"><button type="button" class="${amt?'on':''}" data-a="wimode" data-v="amount" aria-pressed="${amt}">${RT('Сумма','Amount')}</button><button type="button" class="${amt?'':'on'}" data-a="wimode" data-v="weight" aria-pressed="${!amt}">${RT('Доля','Weight')}</button></div>
      <label class="dk-wi-v"><input id="dkWiV" class="dk-inp dk-num" type="number" inputmode="decimal" data-c="wiv" min="${amt?C.amount[0]:C.weight[0]}" max="${amt?C.amount[1]:C.weight[1]}" step="${amt?1000:0.5}" value="${dkEsc(v)}" aria-label="${amt?RT('Сумма, kr','Amount, kr'):RT('Доля капитала, %','Share of equity, %')}"><span>${amt?'kr':RT('% капитала','% of equity')}</span></label>
      <span class="dk-note">${RT('портфель','portfolio')} <b>${dkEsc(TAB_LABEL(port))}</b> — ${RT('выбирается в шапке','chosen in the header')}</span></div>`;
  const tbl=`<div class="dk-wrap"><table class="dk-tbl dk-cmp">${dkCmpHeadHTML(cols,false)}<tbody>
    ${row(RT('Итог','Result'),r=>{const S=ST[r.status];return `<span class="dk-pill v-${S[2]}"${dkG('what-if')}>${S[0]} ${S[1]}</span>`;})}
    ${row(RT('Количество','Quantity'),r=>`<b class="dk-num">${r.qty} ${RT('шт','sh')}</b>${dkCmpSm(dkKr(r.notionalSEK))}`)}
    ${row(RT('Доля бумаги после','Weight after'),r=>`<span class="dk-num">${r.weightAfter!=null?dkN(r.weightAfter,1)+' %':'—'}</span>`)}
    ${row(`<span${dkG('size')}>${RT('Риск сделки','Trade risk')}</span>`,r=>`<span class="dk-num">${r.stop?dkKr(r.tradeRiskSEK):'—'}</span>`)}
    ${row(RT('Кэш после','Cash after'),r=>`<span class="dk-num${r.hasCash&&r.cashAfter<0?' dk-dn':''}">${r.hasCash?dkKr(r.cashAfter):RT('не ведётся','not tracked')}</span>`)}
    ${row(RT('Предупреждения','Warnings'),r=>r.warnings.length?r.warnings.map(w=>`<div class="${w.blocking?'dk-crit':'dk-note'}">${w.blocking?'⛔':'⚠'} ${dkEsc(w.text)}</div>`).join(''):'<span class="dk-mut">—</span>')}
  </tbody></table></div>`;
  return `<section class="dk-panel dk-mb dk-cmp-wi"><div class="dk-ph"><h2>${RT('Что если? — каждая отдельно','What if? — each on its own')}${dkGi('what-if')}</h2></div>${inputs}
    <p class="dk-note dk-padx">${RT('Каждая бумага посчитана отдельно против текущего кэша и лимита риска книги — это не корзина: вместе варианты могут не пройти по кэшу или лимиту. Ничего не записано.','Each stock is computed on its own against the current cash and book risk cap — not a basket: together the options may not fit the cash or the cap. Nothing is recorded.')}</p>${tbl}</section>`;
}
function deskCompareHTML(){
  const K=deskCompareKeys(),port=deskCmpPort();
  return deskCompareView(K,K.length>=2?deskCompareCols(K,port):[],port);
}
// Экран сравнения по готовым колонкам (тесты зовут напрямую): ничего не пишет и не грузит.
function deskCompareView(K,cols,port){
  const C=DESK_UI.compare,max=DESK_IDEA_CFG.selection.maxCompare,I=deskItems();
  const drop=C.dropped?`<div class="dk-warn dk-mb">⚠ ${RT(`Убрано из сравнения: ${C.dropped} — нет доступа или бумаги больше нет во вкладках.`,`Removed from the comparison: ${C.dropped} — no access or the stock is no longer in any tab.`)}</div>`:'';
  if(K.length<2||cols.length<2){
    const title=!K.length?RT('Бумаги для сравнения не выбраны','No stocks selected for comparison'):K.length===1?RT('Выбрана одна бумага','One stock selected'):RT('Сравнение недоступно: нет доступа к анализу выбранных бумаг','Comparison unavailable: no access to the analysis of the selected stocks');
    const chips=K.map(k=>{const it=I.byKey[k];return `<span class="dk-cmp-chip"><b class="dk-tk">${dkEsc(it?it.sec.tk:k)}</b><button type="button" class="dk-cmp-x" data-a="cmp" data-k="${dkEsc(k)}" aria-label="${RT('Убрать из сравнения','Remove from comparison')}">✕</button></span>`;}).join('');
    return drop+`<div class="dk-panel dk-cmp-empty"><h2>${title}${dkGi('compare')}</h2>
      <p>${RT(`Отметьте «Сравнить» у 2–${max} бумаг: на карточках «Идей», в списке покупок, в инспекторе или на странице акции. Выбор живёт в этой вкладке браузера и не меняет список покупок.`,`Tick “Compare” on 2–${max} stocks: on Ideas cards, in the shopping list, the inspector or the stock page. The selection lives in this browser tab and does not change the shopping list.`)}</p>
      <div class="dk-row">${chips}<button type="button" class="dk-btn" data-a="nav" data-r="screen">${RT('К идеям','To ideas')} →</button></div></div>`;
  }
  const M=deskCompareModel(cols,{earnDays:SIG.CFG.earnDays}),prim=M.rows.filter(r=>r.primary),rest=M.rows.filter(r=>!r.primary);
  const loading=cols.some(c=>c.finBusy||deskPoolBusy('fund|'+c.it.sec.sym)||deskPoolBusy('earn|'+c.it.sec.sym));
  const stale=cols.filter(c=>c.model.price.freshness!=='fresh'),pxBusy=cols.some(c=>deskPoolBusy('px|'+c.it.sec.sym));
  const refresh=stale.length&&can('action.refresh_data')?`<button type="button" class="dk-btn dk-sm" data-a="cmpref"${pxBusy?' disabled':''}>${pxBusy?'⏳ '+RT('Обновляю…','Refreshing…'):'⟳ '+RT(`Обновить цены (${stale.length})`,`Refresh prices (${stale.length})`)}</button>`:'';
  const top=`<div class="dk-cmp-top"><button type="button" class="dk-btn dk-sm" data-a="cmpback">← ${RT('Назад','Back')}</button>
    <span class="dk-note">${RT(`${cols.length} бумаги · портфель ${dkEsc(port?TAB_LABEL(port):'—')} · одни правила для всех, общего балла нет`,`${cols.length} stocks · portfolio ${dkEsc(port?TAB_LABEL(port):'—')} · the same rules for all, no overall score`)}</span>
    ${loading?`<span class="dk-chip">⏳ ${RT('догружаю отчётность и отчёты','loading reports and earnings')}</span>`:''}${refresh}${dkGi('compare')}</div>`;
  const act=`<tr class="dk-cmp-act"><th scope="row" class="dk-cmp-lbl">${RT('Дальше','Next')}</th>${cols.map(c=>`<td><div class="dk-row">${dkCmpFinalBtn(c.key)}<button type="button" class="dk-btn dk-sm" data-a="open" data-k="${dkEsc(c.key)}">${RT('Открыть','Open')} →</button></div></td>`).join('')}</tr>`;
  const how=`<p>${RT('Подсветка максимума и минимума — только если значение есть у всех бумаг и посчитано одинаково: тот же тип периода (последний фин. год, TTM или прогноз), та же сторона плана, тот же источник оценки и одинаковый набор применимых столпов. Предварительные данные, неприменимые показатели и пропуски строку не подсвечивают.','Highest/lowest are marked only when every stock has the value and it is computed the same way: the same period type (last fiscal year, TTM or forecast), the same plan side, the same valuation source and the same set of applicable pillars. Provisional data, non-applicable metrics and gaps leave the row unmarked.')}</p>
    <p>${RT('Абсолютные суммы (выручка, капитализация) не сравниваются — только доли и мультипликаторы, поэтому валюта и масштаб бумаг на подсветку не влияют. Отрицательный EPS исключает P/E, рост от нулевой или отрицательной базы не показывается процентом. Один сектор не делает компании прямыми конкурентами.','Absolute amounts (revenue, market cap) are not compared — only ratios and multiples, so currency and scale do not affect the marks. Negative EPS excludes P/E; growth from a zero or negative base is not shown as a percentage. One sector does not make companies direct peers.')}</p>
    <p>${RT(`Рост и FCF-маржа — последний фин. год из «Роста бизнеса» (?financials=); отчётность, консенсус и дата отчёта грузятся при открытии сравнения, не больше ${DESK_IDEA_CFG.selection.loadPool} запросов одновременно. Качество — бизнес-столпы без оценки цены (как в «Решении»).`,`Growth and FCF margin — the last fiscal year from Business growth (?financials=); reports, consensus and the earnings date load when the comparison opens, at most ${DESK_IDEA_CFG.selection.loadPool} requests at a time. Quality — business pillars without valuation (as in Decision).`)}</p>`;
  return drop+top+deskCompareDiffsHTML(M,cols)
    +`<section class="dk-panel dk-mb"><div class="dk-wrap"><table class="dk-tbl dk-cmp">${dkCmpHeadHTML(cols,true)}<tbody>${prim.map(r=>dkCmpRowHTML(r,cols)).join('')}${act}</tbody></table></div></section>`
    +`<details class="dk-panel dk-mb"${dkDetAttr('cmp-all')}><summary class="dk-ph"><h2>${RT('Все показатели','All metrics')}</h2><span class="dk-cnt">${rest.length}</span><span class="dk-note dk-ml">${RT('столпы, рост, FCF, мультипликаторы, уровни','pillars, growth, FCF, multiples, levels')}</span></summary>
      <div class="dk-wrap"><table class="dk-tbl dk-cmp">${dkCmpHeadHTML(cols,false)}<tbody>${rest.map(r=>dkCmpRowHTML(r,cols)).join('')}</tbody></table></div><div class="dk-padx dk-pb">${dkHow('cmp',how,RT('Как сравнивается','How it compares'))}</div></details>`
    +deskCompareWiHTML(cols,port);
}

// ═══════════════════ Акция (P2, plans/stock-selection-ux.md §4): «Решение» · «Компания» · «Техника» ═══════════════════
// Общая шапка (бумага, цена и свежесть, позиция и её срочное действие) видна во всех режимах; режим — DESK_UI.stockView.
function deskStockHTML(){
  const I=deskItems();
  let it=deskSecOf(DESK_UI.key);
  if(!it){const B=deskTodayBuckets(I.items,[]);it=B.entries[0]||I.items.find(x=>x.sec.held.length)||I.items[0];if(it)DESK_UI.key=it.key;}
  if(!it)return `<div class="dk-panel dk-empty">${RT('Бумаг нет — добавьте тикеры во вкладки или откройте поиск «/».','No stocks — add tickers to tabs or use search “/”.')}</div>`;
  // AI-блоки и тезис-монитор классики читают бумагу из v3Key/pf3Sel; их ответы привязаны к тикеру запуска, не к текущему выбору.
  // S7b-2: и curIdx — поллер пре/пост (cardPPLoad) и обновление цены карточки сверяют isV3()&&pf3Sel.
  if(it.tab&&it.r)deskCtx(it.tab,'list',String(it.r[2]||''));
  const view=DK_VIEWS.includes(DESK_UI.stockView)?DESK_UI.stockView:'decision',held=deskHeld(it);
  // «Компания» той же бумаги открывается с раскрытым «Ростом бизнеса»; сами запросы — deskCompanyEnsure после отрисовки.
  if(view==='company'&&DESK_UI._compFor!==it.key&&can('view.health'))DESK_UI.finOpen=it.key;
  const m=view==='tech'?null:deskStockModel(it,held);
  let body='';
  try{body=view==='company'?deskCompanyHTML(it,m):view==='tech'?deskTechHTML(it,held):deskDecisionHTML(it,m,held);}
  catch(e){console.error(e);body=`<div class="dk-panel dk-empty">${RT('Ошибка режима: ','View error: ')}${dkEsc(e.message||e)}</div>`;}
  return deskStockHeadHTML(it,held,view)+deskStockTabsHTML(view)+`<div class="dk-view" id="dkView" role="tabpanel" aria-labelledby="dkTab-${view}">${body}</div>`;
}
// Портфель «Акции»: позиция бумаги → её портфель; иначе выбранный, а из «Все портфели» — портфель риска (как в шапке).
function deskStockPort(held){if(held)return held.tab;const p=deskPort();return p==='all'?deskRiskTab():p;}
function deskStockModel(it,held){
  try{return deskSelectionModel(deskSelectionInput(it.key,deskStockPort(held),Date.now()));}catch(e){console.warn('selection model',e);return null;}
}
function deskStockHeadHTML(it,held,view){
  const s=it.s,sec=it.sec,w=deskWatchGet(it.key),px=s?s.price:sec.price,day=s?s.day:sec.day;
  const age=sec.live&&sec.pxAt?Math.max(0,Math.round((Date.now()-sec.pxAt)/60000)):null;
  let pos='';
  if(held){
    const act=deskPosAct(held,s,sigEarnDays(held.sym)),urgent=['exit','take','trim','earn','nostop','watch'].includes(act.act);
    pos=`<span class="dk-pos-chip${urgent?' urgent':''}">${dkSide(held.side)}${dkActPill(act.act)}<span class="dk-mut dk-xs">${dkEsc(TAB_LABEL(held.tab))}</span>${view!=='decision'?`<button type="button" class="dk-link" data-a="view" data-v="decision">${RT('к позиции','to position')}</button>`:''}</span>`;
  }
  return `<div class="dk-stock-hd"><span class="dk-tk dk-tk-xl">${dkEsc(sec.tk)}</span><div class="dk-stock-id"><div class="dk-b">${dkEsc(sec.name)}${w&&w.tag?` <span class="dk-wtag">${dkEsc(w.tag)}</span>`:''}</div><div class="dk-mut dk-xs">${dkEsc([sec.sector,sec.type,sec.tabs.map(TAB_LABEL).join(', '),sec.ccy].filter(Boolean).join(' · '))}</div></div>
      <span class="dk-px dk-num">${dkPx(px)} ${dkCcy(sec.ccy)}</span>${dkDay(day)}${sec.live?`<span class="dk-tag"${dkG('live')}>live${age!=null?` · ${age} ${RT('мин','min')}`:''}</span>`:`<span class="dk-tag dk-mut"${dkG('live')}>${RT('не live','not live')}</span>`}
      ${s?dkPill(s.verdict,!!held)+dkPhase(s)+dkFlags(s):''}${pos}
      <div class="dk-ctl">${dkCmpBox(it.key)}</div>
      ${it.r?`<div class="dk-pp-row"><span id="pf3PrePost" class="pf3-pp">${cardPPInner(sec.sym)}</span><span id="pf3Vol" class="pf3-pp">${cardVolInner(String(it.r[2]||''))}</span></div>`:''}</div>`;
}
function deskStockTabsHTML(view){
  const L=[['decision',RT('Решение','Decision')],['company',RT('Компания','Company')],['tech',RT('Техника','Technicals')]];
  return `<div class="dk-views-w"><div class="dk-views" role="tablist" aria-label="${RT('Режим экрана акции','Stock screen mode')}">${L.map(([v,l])=>`<button type="button" role="tab" id="dkTab-${v}" aria-controls="dkView" aria-selected="${v===view}" tabindex="${v===view?0:-1}" class="${v===view?'on':''}" data-a="view" data-v="${v}">${l}</button>`).join('')}</div>${dkGi('stock-views')}</div>`;
}

// ── «Решение» (§3.3/§4): вывод, четыре измерения, цена ожидания с источником, главный риск, одна primary-кнопка ──
// Коды причин модели отбора (desk-selection.js) → текст UI; флаги SIG — из DK_FLAG.
const DK_SEL_R={
  'price-missing':()=>RT('нет цены','no price'),
  'price-unknown':()=>RT('цена не live — время котировки неизвестно','price not live — quote time unknown'),
  'price-stale':()=>RT(`котировка старше ${DESK_IDEA_CFG.whatIf.staleMin} мин`,`quote older than ${DESK_IDEA_CFG.whatIf.staleMin} min`),
  'price-invalid':()=>RT('время котировки в будущем','quote time is in the future'),
  'signal-missing':()=>RT('сигнал ещё не посчитан — грузятся свечи','no signal yet — candles loading'),
  'signal-stale':()=>RT('свечи сигнала устарели','signal candles are stale'),
  'business-lite':()=>RT('отчётность не загружена — есть только ROE и рост из строки','reports not loaded — only the row’s ROE and growth'),
  'business-partial':()=>RT('отчётность неполная','reports incomplete'),
  'business-missing':()=>RT('нет данных о бизнесе','no business data'),
  'business-restricted':()=>RT('нет доступа к данным компании','no access to company data'),
  'business-not-applicable':()=>RT('часть столпов неприменима (банк/финансы)','some pillars do not apply (bank/financials)'),
  'business-fetch-date-unknown':()=>RT('время загрузки отчётности неизвестно','report fetch time unknown'),
  'business-cache-stale':()=>RT('кэш отчётности старше 6 ч','report cache older than 6 h'),
  'valuation-missing':()=>RT('оценки нет','no valuation'),
  'valuation-incomparable':()=>RT('оценка несопоставима с ценой (валюта или листинг)','valuation not comparable with the price (currency or listing)'),
  'valuation-date-unknown':()=>RT('дата источника оценки неизвестна','valuation source date unknown'),
  'valuation-restricted':()=>RT('нет доступа к оценке','no access to valuation'),
  'cache-incomparable':()=>RT('старый кэш без валюты листинга — нужен перезапуск «📐 Оценка» (⋯ → «Сервис»)','old cache without listing currency — rerun “📐 Valuation” (⋯ → “Service”)'),
  'level-not-calculated':()=>RT('уровень входа не рассчитан','entry level not calculated'),
  'pe-missing':()=>RT('P/E нет','no P/E'),'pe-nonpositive-eps':()=>RT('EPS ≤ 0 — P/E не сравнивается','EPS ≤ 0 — P/E not comparable')
};
const dkSelR=c=>DK_SEL_R[c]?DK_SEL_R[c]():DK_FLAG[c]?DK_FLAG[c]():String(c);
// Выводы «Решения» по action.key модели → [заголовок, тон]; подсказка — запись словаря dec-<ключ> (тест покрытия).
const DK_DEC={candidate:[()=>RT('Кандидат на вход','Entry candidate'),'buy'],wait:[()=>RT('Ждать уровня','Wait for the level'),'wait'],
  study:[()=>RT('Изучить','Study'),'hold'],research:[()=>RT('Проверить компанию','Check the company'),'hold'],
  technical:[()=>RT('Технический сценарий','Technical scenario'),'short'],refresh:[()=>RT('Обновить данные','Refresh data'),'wait']};
// Вывод по открытой позиции — действие deskPosAct (подсказка — act-<ключ>).
const DK_DEC_POS={exit:()=>RT('Закрыть позицию','Close the position'),take:()=>RT('Зафиксировать прибыль','Take profit'),trim:()=>RT('Сократить позицию','Trim the position'),
  earn:()=>RT('Сократить перед отчётом','Reduce before earnings'),trail:()=>RT('Подтянуть стоп','Trail the stop'),be:()=>RT('Стоп в безубыток','Stop to breakeven'),
  watch:()=>RT('Позиция у стопа','Position near its stop'),nostop:()=>RT('Задать стоп','Set a stop'),hold:()=>RT('Держать по плану','Hold on plan')};
// Главный риск (deskMainRisk) → текст.
const DK_MR={knife:()=>RT('Падающий нож — новый вход заблокирован правилами SIG','Falling knife — new entries blocked by SIG rules'),
  earnings:d=>RT(`Отчёт ${d!=null?'через '+d+' дн':'скоро'} — новый вход заблокирован правилами SIG`,`Earnings ${d!=null?'in '+d+' d':'soon'} — new entries blocked by SIG rules`),
  squeeze:()=>RT('Риск шорт-сквиза','Short-squeeze risk'),'no-short':()=>RT('Шорт не подтверждён трендом','Short not confirmed by the trend'),
  wide:()=>RT(`Широкий стоп (> ${SIG.CFG.wideAtr}·ATR) — меньше размер`,`Wide stop (> ${SIG.CFG.wideAtr}·ATR) — smaller size`),
  'stale-target':()=>RT('Таргет аналитиков устарел — внешняя оценка ненадёжна','Analyst target is stale — the external valuation is unreliable'),
  half:()=>RT('Тренд не подтверждён — размер ½','Trend not confirmed — ½ size'),
  level:()=>RT('Высокая волатильность: уровень риска 4–5','High volatility: risk level 4–5'),
  none:()=>RT('Явных флагов нет — риск ограничивают стоп и размер','No explicit flags — the stop and size limit the risk')};
// Подпись кандидата (P0.5, signals-calibration §8; решение пользователя 2026-09-11 — текст как есть).
const dkCandNote=()=>RT('Технический сетап по правилам SIG. На истории 2022–2026 такой вход не опережал случайный день той же бумаги — это повод проверить компанию и цену, а не сигнал купить.','Technical setup by SIG rules. In 2022–2026 history this entry did not beat a random day in the same stock — a reason to check the company and price, not a buy signal.');
const DK_CRIT=['price-missing','price-unknown','price-stale','price-invalid','signal-stale','knife','earnings','squeeze','no-short','stale-target'];
function deskDecisionHTML(it,m,held){
  if(!m)return `<div class="dk-panel dk-empty">${RT('Анализ бумаги недоступен: нет доступа к портфелю или бумаги нет в разрешённых вкладках.','Stock analysis unavailable: no portfolio access or the stock is not in an allowed tab.')}</div>`;
  const s=it.s,sec=it.sec,A=m.action,w=deskWatchGet(it.key),port=deskStockPort(held),earn=sigEarnDays(sec.sym);
  const pa=A.source==='position'&&A.position?A.position.action:null;
  const rule=w&&w.planId&&(PLAN_RULES||[]).find(r=>r.id===w.planId&&!r.done&&r.status!=='open');
  const sug=held&&s&&s.plans&&s.plans[held.side],trail=held&&s&&held.calc?deskTrailStop(held.side,held.stop,held.calc.now,s.atr):null;
  const bid=deskDecisionBtn({key:A.key,source:A.source,nextStep:A.nextStep,inList:!!w,zoneHi:w&&w.buyHi,ruleArmed:!!rule,
    canPlan:can('action.edit_plan'),canTrade:can('action.edit_trades'),hasSug:!!sug,trail});
  let title,tone,gid;const why=[];
  if(pa){title=(DK_DEC_POS[pa.act]||DK_DEC_POS.hold)();tone=(DK_ACT[pa.act]||DK_ACT.hold)[2];gid='act-'+(DK_ACT[pa.act]?pa.act:'hold');why.push(dkEsc(pa.note));}
  else{
    const D=DK_DEC[A.key]||DK_DEC.study;title=D[0]();tone=D[1];gid='dec-'+(DK_DEC[A.key]?A.key:'study');
    if(A.key==='refresh')why.push(dkEsc(A.reasonCodes.map(dkSelR).join(' · ')));
    else if(A.key==='research')why.push(`${RT('Технический сетап','Technical setup')}: ${dkPill(m.timing.verdict,false)} · ${RT('не хватает','missing')}: ${dkEsc(A.reasonCodes.filter(c=>c!=='business-not-applicable').map(dkSelR).join(', ')||dkSelR('business-missing'))}`);
    else if(A.key==='wait'&&m.timing.waitingLevel!=null)why.push(`${RT('Ждать цену','Wait for')} <b class="dk-num">${dkPx(m.timing.waitingLevel)} ${dkCcy(sec.ccy)}</b> — ${RT('лимит плана SIG','SIG plan limit')}${m.timing.plan&&m.timing.plan.dEntry!=null?` (${dkPct(m.timing.plan.dEntry,1)})`:''}`);
    else if(A.key==='technical')why.push(RT('Шорт — только технический сценарий (экспериментальный): план, стоп и размер — в «Технике».','Short is only a technical scenario (experimental): plan, stop and size are in Technicals.'));
    if(A.key!=='refresh'&&s&&s.why&&s.why[0])why.push(dkEsc(s.why[0]));
  }
  const shown=A.key==='refresh'?A.reasonCodes:[];
  const crit=A.warnings.filter(c=>DK_CRIT.includes(c)&&!shown.includes(c)).map(c=>`<li${DK_FLAG[c]?dkG('fl-'+c):''}>⚠ ${dkEsc(c==='earnings'&&earn!=null?RT(`отчёт через ${earn} дн`,`earnings in ${earn} d`):dkSelR(c))}</li>`);
  const note=!bid&&A.nextStep==='select-portfolio'?RT('Выберите портфель в шапке — сделка проверяется для конкретного портфеля.','Pick a portfolio in the header — a trade is checked for a specific portfolio.')
    :!bid&&A.nextStep==='view-data-status'?RT('Обновление данных недоступно для вашей роли.','Refreshing data is not available for your role.')
    :bid==='tech'&&A.nextStep==='view-level'&&rule?RT(`Уведомление уже взведено: ≤ ${dkPx(rule.level)} ${dkCcy(sec.ccy)}.`,`Alert already armed: ≤ ${dkPx(rule.level)} ${dkCcy(sec.ccy)}.`):'';
  const concl=`<section class="dk-concl v-${tone}" aria-labelledby="dkConclT"><div class="dk-eyebrow">${RT('Решение','Decision')}${dkGi('decision')}${port?` · ${dkEsc(TAB_LABEL(port))}`:''}</div>
      <h2 id="dkConclT"${dkG(gid)}>${dkEsc(title)}</h2>${why.map(x=>`<p>${x}</p>`).join('')}
      ${A.key==='candidate'?`<p class="dk-note"${dkG('dec-candidate')}>${dkEsc(dkCandNote())}</p>`:''}
      ${crit.length?`<ul class="dk-crit-list">${crit.join('')}</ul>`:''}
      <div class="dk-row dk-mt14">${bid?dkDecBtn(bid,it,held,{trail,sug}):''}${!held&&bid!=='wadd'?dkWatchBtn(it.key):''}${!held?deskJournalTrackBtn(it):''}</div>${note?`<p class="dk-note">${dkEsc(note)}</p>`:''}</section>`;
  const own=w&&w.thesis&&(w.thesis.title||w.thesis.text);
  return concl+deskDimsHTML(it,m,w)+(own?`<p class="dk-own-thesis"><span class="dk-lbl"${dkG('thesis')}>${RT('Мой тезис','My thesis')}</span> ${dkEsc(own)} <button type="button" class="dk-link" data-a="view" data-v="company">${RT('Компания →','Company →')}</button></p>`:'')
    +`<div class="dk-dec-grid">${held?deskPosPanel(held,it,true):''}${deskWhatIfPanel(it,deskStockSide(it),true)}</div>`;
}
// Primary-кнопка «Решения» по id из deskDecisionBtn (права уже учтены там; обработчики — общие с панелями).
function dkDecBtn(id,it,p,x){
  const k=dkEsc(it.key),t=p?dkEsc(p.tk):'',tab=p?dkEsc(p.tab):'',half=p?Math.max(1,Math.floor(p.qty/2)):0;
  const b=(a,l,extra)=>`<button type="button" class="dk-btn pri" data-a="${a}"${extra||''}>${l}</button>`;
  switch(id){
    case 'refresh':{const busy=DESK_UI.r1===it.key;return `<button type="button" class="dk-btn pri" data-a="refresh1" data-k="${k}"${busy?' disabled':''}>${busy?'⏳ '+RT('Обновляю…','Refreshing…'):'⟳ '+RT('Обновить данные','Refresh data')}</button>`;}
    case 'company':return b('view',RT('Проверить компанию →','Check the company →'),' data-v="company"');
    case 'tech':return b('view',RT('Смотреть технику →','See the technicals →'),' data-v="tech"');
    case 'trade':return b('wiopen',RT('Проверить сделку','Check the trade'));
    case 'wadd':return b('wadd','＋ '+RT('Добавить в список','Add to the list'),` data-k="${k}"`);
    case 'wnotify':return b('wnotify','🔔 '+RT('Уведомить','Alert'),` data-k="${k}"`);
    case 'close':return b('close',p.side==='short'?RT('Откупить…','Cover…'):RT('Продать…','Sell…'),` data-tab="${tab}" data-k="${t}" data-key="${k}"`);
    case 'trim':return b('close',RT(`Сократить… · ${half} шт`,`Trim… · ${half} sh`),` data-tab="${tab}" data-k="${t}" data-key="${k}" data-q="${half}"`);
    case 'be':return b('pm-be',RT('Стоп в б/у','Stop to b/e')+' → '+dkPx(p.entry),` data-tab="${tab}" data-k="${t}"`);
    case 'trail':return b('pm-trail',RT('Трейл 2·ATR','Trail 2·ATR')+' → '+dkPx(x.trail),` data-tab="${tab}" data-k="${t}" data-stop="${x.trail}"`);
    case 'accept':return b('pm-accept',`${RT('Принять стоп','Accept stop')} ${dkPx(x.sug.stop)} · ${RT('цель','target')} ${dkPx(x.sug.target)}`,` data-tab="${tab}" data-k="${t}" data-stop="${x.sug.stop}" data-target="${x.sug.target}"`);
    case 'stops':return b('pm-edit',RT('Стоп/цель…','Stop/target…'),` data-tab="${tab}" data-k="${t}"`);
  }
  return '';
}
// Четыре измерения (§3.2): компания · цена · момент · риск — разные вопросы, общего балла нет.
function dkQualHTML(q){
  if(!q)return {v:'—',d:''};
  if(q.reasonCodes.includes('business-restricted'))return {v:'—',d:dkEsc(dkSelR('business-restricted'))};
  if(q.mode==='full')return {v:`<b>${dkEsc(q.grade)}</b> <span class="dk-num">${dkN(q.value,1)}</span><small>/10</small>`,
    d:RT(`по ${q.applicable} применимым столпам`,`over ${q.applicable} applicable pillars`)+(q.notApplicable.length?` · <span${dkG('selection-na')}>${RT('часть неприменима','some n/a')}</span>`:'')};
  if(q.mode==='partial')return {v:`≈ <span class="dk-num">${dkN(q.value,1)}</span><small>/10</small>`,
    d:`<span${dkG('selection-partial')}>${RT('предварительно','provisional')}</span> · ${RT(`${q.known} из ${q.applicable} столпов`,`${q.known} of ${q.applicable} pillars`)}`};
  if(q.mode==='lite'){const f=q.facts||{},L=[f.roe!=null?'ROE '+dkN(f.roe,1)+' %':null,f.revenueGrowth!=null?RT('рост выручки ','revenue growth ')+dkPct(f.revenueGrowth,1):null].filter(Boolean);
    return {v:`<span class="dk-mut"${dkG('selection-partial')}>${RT('предварительно','provisional')}</span>`,d:(L.length?dkEsc(L.join(' · '))+' · ':'')+RT('без рейтинга — отчётность не загружена','no rating — reports not loaded')};}
  return {v:'—',d:RT('нет данных о бизнесе','no business data')};
}
function deskDimsHTML(it,m,w){
  const s=it.s,sec=it.sec,ccy=dkCcy(sec.ccy),px=s?s.price:sec.price,q=dkQualHTML(m.quality),v=m.valuation,pe=v.peContext||{},t=m.timing;
  const tile=(l,val,d,extra)=>`<div class="dk-panel dk-stat dk-dim"><div class="dk-lbl">${l}</div><div class="dk-dim-v">${val}</div><div class="dk-d">${d}</div>${extra||''}</div>`;
  // Цена: сопоставимая оценка с источником/датой/статусом; без неё — P/E-контекст и «это не значит дорого».
  let vv,vd;
  if(v.value!=null&&v.status!=='incomparable'){
    vv=`${dkPx(v.value)} <small>${ccy}</small>${v.upsidePct!=null?` <span class="dk-num ${v.upsidePct>=0?'dk-up':'dk-dn'}">${dkPct(v.upsidePct,Math.abs(v.upsidePct)<10?1:0)}</span>`:''}`;
    vd=(v.source==='scenarios'?RT('ваши сценарии','your scenarios'):RT('аналитики','analysts'))+(v.asOf?' · '+dkEsc(String(v.asOf).slice(0,10)):'')
      +(v.status==='stale'?` <span class="dk-flag"${dkG('fl-stale-target')}>${RT('таргет устарел','stale target')}</span>`:v.status==='undated'?' · '+RT('дата источника неизвестна','source date unknown'):'');
  }else{
    vv=pe.value>0&&pe.comparable!==false?`P/E <span class="dk-num">${dkN(pe.value,1)}</span>`:'—';
    vd=dkEsc([v.reasonCodes.includes('valuation-restricted')?dkSelR('valuation-restricted'):v.status==='incomparable'?dkSelR('valuation-incomparable'):RT('оценки нет — это не значит «дорого»','no valuation — that does not mean “expensive”'),
      v.reasonCodes.includes('cache-incomparable')?dkSelR('cache-incomparable'):null,(pe.reasonCodes||[]).includes('pe-nonpositive-eps')?dkSelR('pe-nonpositive-eps'):null].filter(Boolean).join(' · '));
  }
  // Момент: вердикт/фаза SIG, цена ожидания с источником; ручная зона списка — отдельной подписью.
  let tv,td=[];
  if(!s)tv=`<span class="dk-mut">${RT('сигнал считается…','signal loading…')}</span>`;
  else{
    tv=dkPill(t.verdict,!!(sec.held||[]).length)+' '+dkPhase(s);const p=t.plan;
    if(t.waitingLevel!=null)td.push(`<span${dkG('wait-level')}>${RT('Ждать цену','Wait for')}</span> <b class="dk-num">${dkPx(t.waitingLevel)}</b> · ${RT('лимит плана SIG','SIG plan limit')}${p&&p.dEntry!=null?' '+dkPct(p.dEntry,1):''}`);
    else if(p&&p.entry>0)td.push(`<span${dkG('market-limit')}>${RT('Вход по рынку','Market entry')}</span> ≈ <b class="dk-num">${dkPx(p.entry)}</b> · R/R ${dkRR(p)}`);
    else td.push(dkEsc(dkSelR('level-not-calculated')));
  }
  if(w&&w.buyHi){const z=deskWatchZone(w,px);td.push(`<span${dkG('my-zone')}>${RT('Моя зона','My zone')}</span> <b class="dk-num">${dkZoneText(w)}</b> · ${w.buySrc==='signal'?RT('по сигналу','from the signal'):RT('вручную','manual')}${z?' · '+dkEsc(dkZoneNeed(w,z)):''}`);}
  // Риск: уровень (ручной рядом с авто) и главный риск; ручной уровень не снимает блокеры.
  const R={level:m.risk.level,auto:m.risk.auto,ovr:m.risk.override,word:deskRiskWord(m.risk.level),parts:m.risk.parts||[]};
  const mr=deskMainRisk({user:w&&w.mainRisk&&w.mainRisk.title,blockers:t.blockers,flags:t.flags,level:m.risk.level});
  const mrT=mr.k==='user'?dkEsc(mr.text):dkEsc(mr.k==='earnings'?DK_MR.earnings(sigEarnDays(sec.sym)):(DK_MR[mr.k]||DK_MR.none)());
  const link=(v,l)=>`<button type="button" class="dk-link" data-a="view" data-v="${v}">${l} →</button>`;
  return `<div class="dk-dims">
    ${tile(RT('Компания','Company')+dkGi('selection-quality'),q.v,q.d,link('company',RT('Бизнес','Business')))}
    ${tile(RT('Цена','Price')+dkGi('selection-valuation'),vv,vd,link('company',RT('Оценка','Valuation'))+(isAdmin()&&(v.reasonCodes||[]).includes('cache-incomparable')?` <button type="button" class="dk-link" data-a="nav" data-r="service">🧰 ${RT('Сервис → «📐 Оценка»','Service → “📐 Valuation”')} →</button>`:''))}
    ${tile(RT('Момент','Timing')+dkGi('dim-timing'),tv,td.join('<br>'),link('tech',RT('Техника','Technicals')))}
    ${tile(RT('Риск','Risk')+dkGi('risk-level'),dkRiskMeter(R),`<span${dkG('main-risk')}>${RT('Главный риск','Main risk')}</span>: ${mrT}${R.ovr&&R.auto&&R.ovr!==R.auto?' · '+RT(`авто ${R.auto}`,`auto ${R.auto}`):''}`,dkHow('risk',dkRiskHow(R,s)))}
  </div>`;
}

// ── «Компания» (§4): тезис, бизнес, рост, оценка, события, инсайдеры, новости; AI — отдельным вторичным блоком ──
function deskCompanyHTML(it,m){
  const s=it.s,sec=it.sec,px=s?s.price:sec.price,w=deskWatchGet(it.key),val=can('view.valuation'),hl=can('view.health');
  return deskThesisHTML(it,w,px,val)+`<div class="dk-cols"><div class="dk-col">${deskBizHTML(it,m)}${hl?deskFinHTML(it):''}${val?deskAnaHTML(it,px):''}</div>
    <aside class="dk-aside">${deskEventsHTML(it)}${can('view.insider')?deskInsHTML(it):''}${deskNewsHTML(it)}</aside></div>${deskAiSectionHTML(it)}`;
}
function deskBizHTML(it,m){
  const sec=it.sec,sym=sec.sym,q=m&&m.quality,h=`<h2>${RT('Бизнес','Business')}${dkGi('biz')}</h2>`;
  if(!can('view.health'))return `<div class="dk-panel"><div class="dk-ph">${h}</div><div class="dk-empty">${dkEsc(dkSelR('business-restricted'))}</div></div>`;
  const c=PF_FUND[sym],F=pf3FundFor(sym),busy=deskPoolBusy('fund|'+sym),Q=dkQualHTML(q),k=dkEsc(sym);
  const sum=`<span class="dk-note dk-ml"${dkG('selection-quality')}>${RT('качество','quality')} ${Q.v}</span>`;
  if(!F){
    const body=busy?RT('Загружаю отчётность…','Loading reports…'):c&&!c.data?`${RT('Провайдеры (FMP/Yahoo) не дали отчётности по этой бумаге.','Providers (FMP/Yahoo) returned no reports for this stock.')} <button class="dk-btn dk-sm" data-a="fund" data-k="${k}">${RT('Повторить','Retry')}</button>`
      :`${RT('Отчётность не загружена.','Reports not loaded.')} <button class="dk-btn dk-sm" data-a="fund" data-k="${k}">${RT('Загрузить','Load')}</button>`;
    return `<div class="dk-panel"><div class="dk-ph">${h}${sum}</div><div class="dk-pad"><div class="dk-d">${Q.d}</div><div class="dk-empty dk-p0 dk-mt6">${body}</div></div></div>`;
  }
  const B=pf3Betyg(F,String(sec.tk||'').toUpperCase(),sec.sector),bank=!!(B&&B.fin),ccy=F.ccy;
  const nm=typeof F.netIncome==='number'&&F.revenue>0?F.netIncome/F.revenue*100:null,fm=typeof F.freeCashFlow==='number'&&F.revenue>0?F.freeCashFlow/F.revenue*100:null;
  const has=v=>typeof v==='number'&&isFinite(v);
  const M={profit:[nm!=null?RT('чистая маржа ','net margin ')+dkN(nm,1)+' %':null,fm!=null?RT('FCF-маржа ','FCF margin ')+dkN(fm,1)+' %':null],
    growth:[has(F.revenueCagr)?`CAGR ${F.revenueYears||'—'} ${RT('л','y')} ${dkPct(F.revenueCagr,1)}`:null,has(F.revenueYoY)?RT('г/г ','YoY ')+dkPct(F.revenueYoY,1):null,has(F.revenue)?RT('выручка ','revenue ')+pf3Bn(F.revenue,ccy):null],
    balance:[has(F.debtToEquity)?'D/E '+dkN(F.debtToEquity,2):null,has(F.currentRatio)?RT('ликвидность ','current ratio ')+dkN(F.currentRatio,1):null,has(F.cash)?RT('кэш ','cash ')+pf3Bn(F.cash,ccy):null],
    cash:[has(F.freeCashFlow)?'FCF '+pf3Bn(F.freeCashFlow,ccy):null,has(F.operatingCashFlow)?'OCF '+pf3Bn(F.operatingCashFlow,ccy):null]};
  const rows=(B?B.pillars:[]).filter(p=>p.key!=='val').map(p=>{
    const lv=pf3Lv(p.score),L=lv==null?null:PF3_LV[lv];
    const txt=p.na?RT('неприменимо для банков и финансов','not applicable to banks and financials'):(M[p.key]||[]).filter(Boolean).join(' · ')||'—';
    return `<div class="dk-biz-row"><span class="dk-biz-n">${p.icon} ${dkEsc(RT(p.label[0],p.label[1]))}</span><span class="dk-biz-l${L?' lv-'+L.c:''}"${p.na?dkG('selection-na'):''}>${p.na?RT('н/п','n/a'):L?`${dkEsc(T(L.l))} · <span class="dk-num">${dkN(p.score,1)}</span>`:'—'}</span><span class="dk-biz-m">${dkEsc(txt)}</span></div>`;
  }).join('');
  const W=PF3_BETYG_WEIGHTS,full=B&&B.score100!=null?`<b>${dkEsc(pf3Grade(B.total).g)}</b> ${B.score100}/100`:RT('не выставлен — мало применимых столпов','not assigned — too few applicable pillars');
  const how=`<p>${RT('Качество компании — средневзвешенное известных применимых столпов без оценки цены','Company quality is the weighted mean of the known applicable pillars without valuation')}: ${(B?B.pillars:[]).filter(p=>p.key!=='val').map(p=>dkEsc(RT(p.label[0],p.label[1]))+' × '+W[p.key]).join(' + ')}. ${RT('Уровни столпов — шкала 0–10 классической карточки (формулы pf3Scores).','Pillar levels use the classic card 0–10 scale (pf3Scores formulas).')}</p>
    <p>${RT('Полный Betyg (пять столпов, вместе с оценкой, вес 15 %)','Full Betyg (five pillars, including valuation at 15 %)')}: ${full}. ${RT('Он не участвует в подборках: оценка цены — отдельное измерение.','It is not used for picks: valuation is a separate dimension.')}</p>
    <p>${RT('Источник','Source')}: ${F.source==='yahoo'?'Yahoo':'FMP'}${F.asOf?` · ${RT('отчёт от','report of')} ${dkEsc(F.asOf)}`:''}${c&&c.at?` · ${RT('загружено','fetched')} ${dkEsc(new Date(c.at).toLocaleString(LANG==='en'?'en-GB':'ru-RU',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}))}`:''}${ccy?` · ${RT('валюта отчётности','reporting currency')} ${dkEsc(ccy)}`:''}. ${RT('Кэш — 6 ч.','Cache — 6 h.')}</p>`;
  return `<div class="dk-panel dk-biz"><div class="dk-ph">${h}${sum}</div><div class="dk-padx dk-biz-b"><div class="dk-d">${Q.d}${bank?' · '+RT('банк/финансы: баланс и денежный поток этой модели неприменимы','bank/financials: balance and cash flow do not apply in this model'):''}</div>${rows}${dkHow('biz',how)}</div></div>`;
}
// «Отчёт и ожидания»: дата — ?earnings= или календарь ?calendar=; консенсус и прошлый отчёт — ?earnings= (при входе в «Компанию»).
const _deskEarn={};
function deskEarnLoad(sym){
  if(!sym||!PRICE_PROXY)return Promise.resolve();
  const c=_deskEarn[sym];if(c&&Date.now()-c.at<(c.data?6*3600e3:5*60e3))return Promise.resolve();
  return fetch(PRICE_PROXY+'?earnings='+encodeURIComponent(sym)).then(r=>r.json()).catch(()=>null).then(j=>{_deskEarn[sym]={data:j&&typeof j==='object'&&(j.next||j.last)?j:null,at:Date.now()};});
}
function deskEventsHTML(it){
  const sym=it.sec.sym,C=SIG.CFG,cal=pf3Cal&&pf3Cal.data&&pf3Cal.data[sym],e=_deskEarn[sym],E=e&&e.data,busy=deskPoolBusy('earn|'+sym);
  const next=E&&E.next&&E.next.date?String(E.next.date).slice(0,10):cal&&cal.earnings?String(cal.earnings).slice(0,10):null;
  const days=next?Math.round((Date.parse(next+'T00:00:00Z')-Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z'))/864e5):null;
  const eps=v=>v==null||!isFinite(v)?'—':dkN(v,2)+(E&&E.ccy?' '+dkEsc(E.ccy):''),sur=(a,x)=>a!=null&&x?` <span class="${a>=x?'dk-up':'dk-dn'}">${dkPct((a-x)/Math.abs(x)*100,1)}</span>`:'';
  const L=E&&E.last;
  const kv=[[RT('Отчёт','Earnings'),next?`${dkEsc(next)}${days!=null&&days>=0?` <span class="${days<=C.earnDays?'dk-flag':'dk-mut'}"${days<=C.earnDays?dkG('fl-earnings'):''}>${RT('через','in')} ${days} ${RT('дн','d')}</span>`:''}`:`<span class="dk-mut">${busy?RT('загрузка…','loading…'):RT('не объявлен','not announced')}</span>`]];
  if(E&&E.next){kv.push([RT('Ожидание EPS','EPS estimate'),eps(E.next.epsEst)]);if(E.next.revEst!=null)kv.push([RT('Ожидание выручки','Revenue estimate'),pf3Bn(E.next.revEst,E.ccy)]);}
  if(L)kv.push([RT('Прошлый отчёт','Last report'),`${dkEsc(String(L.date||'').slice(0,10))} · EPS ${eps(L.epsActual)}${sur(L.epsActual,L.epsEst)}`]);
  return `<div class="dk-panel"><div class="dk-ph"><h2>${RT('Отчёт и ожидания','Earnings & expectations')}${dkGi('events')}</h2></div><div class="dk-kv">${kv.map(([l,v])=>`<span class="dk-lbl">${l}</span><span class="v">${v}</span>`).join('')}</div>
    <div class="dk-note dk-padx dk-pb">${RT(`Ближе ${C.earnDays} дн до отчёта правила SIG не открывают новый вход.`,`Within ${C.earnDays} d of earnings SIG rules open no new entries.`)}${!E&&!busy&&e?' '+RT('Консенсуса у провайдеров нет.','Providers have no consensus.'):''}</div></div>`;
}
function deskInsHTML(it){
  const tk=String(it.sec.tk||'').toUpperCase(),v=INSIDER[tk]||INSIDER[posTk(tk)],h=`<h2>${RT('Инсайдеры','Insiders')}${dkGi('insiders')}</h2>`;
  const at=v&&v.at?`<span class="dk-note dk-ml">${RT('обновлено','updated')} ${dkEsc(String(v.at).slice(0,10))}${v.src==='fi'?' · FI':''}</span>`:'';
  if(!v||v.err)return `<div class="dk-panel"><div class="dk-ph">${h}${at}</div><div class="dk-note dk-pad">${v&&v.err==='no-key'?RT('Для US-бумаг в воркере нужен FINNHUB_KEY.','FINNHUB_KEY is needed in the worker for US stocks.'):RT('Сводки нет. Её обновляет админ: ⋯ → «Сервис» → «🕵 Инсайдеры» (US — Finnhub, SE — Finansinspektionen).','No summary. An admin refreshes it: ⋯ → “Service” → “🕵 Insiders” (US — Finnhub, SE — Finansinspektionen).')}</div></div>`;
  if(!v.txCount)return `<div class="dk-panel"><div class="dk-ph">${h}${at}</div><div class="dk-note dk-pad">${RT('Сделок инсайдеров за 30 дней нет.','No insider trades in the last 30 days.')}</div></div>`;
  const hl=insiderHeadline(v),cc=v.valCcy,tx=(v.tx||[]).filter(t=>t&&(t.code==='P'||t.code==='S')),routine=(v.tx||[]).length-tx.length;
  const cls=hl.cls==='pf3-up'?'dk-up':hl.cls==='pf3-down'?'dk-dn':'';
  return `<div class="dk-panel"><div class="dk-ph">${h}${at}</div><div class="dk-pad dk-ins">
    <div class="dk-b ${cls}">${dkEsc(hl.txt)}</div>${v.cluster?`<span class="dk-tag dk-up">CLUSTER BUY · ${v.cluster.uniqueBuyers} ${RT('инсайд.','insiders')}</span>`:''}
    <div class="dk-kv dk-p0 dk-mt6"><span class="dk-lbl">${RT('Покупки','Buys')}</span><span class="v dk-num dk-up">${dkEsc(insiderFmtUSD(v.buyUSD,cc))}</span><span class="dk-lbl">${RT('Продажи','Sales')}</span><span class="v dk-num dk-dn">${dkEsc(insiderFmtUSD(v.sellUSD,cc))}</span></div>
    ${tx.length?`<details class="dk-how"${dkDetAttr('ins')}><summary>${RT('Покупки и продажи','Buys and sales')} · ${tx.length}${routine>0?` · ${RT('рутинных (опционы, гранты)','routine (options, grants)')} ${routine}`:''}</summary><div class="dk-how-b">${tx.slice(0,12).map(t=>`<div>${t.code==='P'?'▲':'▼'} ${dkEsc(t.name||'—')} · <span class="dk-num">${dkEsc(pf3Fmt(t.shares))} × ${t.price!=null?dkEsc(pf3Fmt(t.price,2)):'—'}</span> · ${dkEsc(t.date||'')}</div>`).join('')}</div></details>`:''}
  </div></div>`;
}
function deskNewsHTML(it){
  const sec=it.sec,tk=sec.tk,n=NEWS_LIVE[tk],busy=deskPoolBusy('news|'+tk)||!!(n&&n.loading),ni=NEWS_IMPACT&&NEWS_IMPACT[tk];
  const items=n&&Array.isArray(n.items)?n.items:[];
  const row=x=>{const u=safeUrl(x.link),pol=x.pol||0;return `<li><span class="dk-dot${pol>0?' hot':pol<0?' neg':''}" aria-hidden="true"></span>${u?`<a href="${dkEsc(u)}" target="_blank" rel="noopener">${dkEsc(x.title||'')}</a>`:dkEsc(x.title||'')}<span class="dk-mut dk-xs">${x.publisher?dkEsc(x.publisher)+' · ':''}${dkEsc(newsAgoLbl(x.time))}</span></li>`;};
  const tone=items.length?`<span class="dk-note dk-ml">${items.length} · ${RT('тон','tone')} ${n.sent>0?'+':''}${dkN(n.sent,1)}</span>`:'';
  const body=items.length?`<ul class="dk-news">${items.slice(0,5).map(row).join('')}</ul>${items.length>5?`<details class="dk-how dk-padx"><summary>${RT('Ещё','More')} ${items.length-5}</summary><ul class="dk-news">${items.slice(5,15).map(row).join('')}</ul></details>`:''}`
    :`<div class="dk-note dk-pad">${busy?RT('Загрузка новостей…','Loading news…'):n?RT('Свежих новостей нет.','No recent news.'):RT('Новости загружаются при открытии «Компании».','News loads when Company opens.')}</div>`;
  return `<div class="dk-panel"><div class="dk-ph"><h2>${RT('Новости','News')}${dkGi('news')}</h2>${tone}<button type="button" class="dk-btn dk-sm" data-a="newsre" data-k="${dkEsc(tk)}" data-ccy="${dkEsc(sec.ccy)}" aria-label="${RT('Обновить новости','Refresh news')}"${busy?' disabled':''}>⟳</button></div>
    ${ni?`<div class="dk-note dk-padx dk-mt6">${ni.impact==='bull'?'📈':ni.impact==='bear'?'📉':'⚪'} ${dkEsc(((ni.hits||[])[0]||{}).sent||'').slice(0,120)}</div>`:''}${body}
    <div class="dk-note dk-padx dk-pb">${RT('Yahoo Finance, кэш 10 мин. Тон — по словарю слов, справочно.','Yahoo Finance, 10-min cache. Tone is lexicon-based, for reference.')}</div></div>`;
}
// AI — отдельное мнение с датой и горизонтом; расхождение с вердиктом SIG показано явно (§3.3). Права — текущие.
function deskAiSectionHTML(it){
  const sec=it.sec,tk=String(sec.tk||'').toUpperCase(),s=it.s,v=AI_RECO[tk],M=v&&AI_RECO_META[v.verdict];
  const diverge=!!(v&&v.verdict&&s&&((v.verdict==='buy')!==(s.verdict==='buy')));
  const sum=v&&v.at?`${M?dkEsc(M[1]):''} · ${dkEsc(String(v.at).slice(0,10))}${diverge?` <span class="dk-flag"${dkG('ai-opinion')}>${RT('расходится с SIG','differs from SIG')}: ${dkEsc((DK_V[s.verdict]||DK_V.wait)[1]())}</span>`:''}`:RT('нет разбора','no analysis');
  const reco=`<details class="dk-panel dk-mt14"${dkDetAttr('st-ai')}><summary class="dk-ph"><h2>🤖 ${RT('AI-разбор','AI analysis')}${dkGi('ai-opinion')}</h2><span class="dk-note dk-ml">${sum}</span></summary><div class="dk-ai">${it.r&&can('view.ai_reco')?aiRecoHTML(it.d,it.r):`<div class="dk-empty">${RT('Нет доступа к AI-разбору.','No access to AI analysis.')}</div>`}</div></details>`;
  const stk=isAdmin()&&it.r?`<details class="dk-panel dk-mt14"${dkDetAttr('st-stkai')}><summary class="dk-ph"><h2>🔬 ${RT('AI-анализ акции','AI stock analysis')}</h2><span class="dk-note dk-ml">${RT('админ · пишется в обучающую базу','admin · saved to the learning log')}</span></summary><div class="dk-ai">${stockAiHTML(it.d,it.r)}</div></details>`:'';
  const cm=it.r?cycleMonitorHTML(sec.tk):'';
  const cyc=cm?`<details class="dk-panel dk-mt14"${dkDetAttr('st-cyc')}><summary class="dk-ph"><h2>🧭 ${RT('Тезис-монитор','Thesis monitor')}</h2><span class="dk-note dk-ml">${RT('метрики тезиса и пороги','thesis metrics and thresholds')}</span></summary><div class="dk-ai">${cm}</div></details>`:'';
  return `<section class="dk-ai-sec"><div class="dk-sub-h dk-mt14">${RT('AI и заметки — отдельное мнение, правила SIG не меняет','AI and notes — a separate opinion, does not change SIG rules')}</div>${reco}${stk}${cyc}</section>`;
}

// ── «Техника» (§4): большой график, период/слои, план моделируемой стороны, уровни, фаза и история сигналов ──
function deskTechHTML(it,held){
  const s=it.s,sec=it.sec,side=deskSideFor(it),C=SIG.CFG;
  const lv=s&&s.levels,ladder=s?[...lv.res.filter(x=>x.kind!=='pivot').slice(0,3).reverse().map(x=>Object.assign({},x,{k:'res'})),{v:s.price,src:RT('цена','price'),k:'now'},...lv.sup.filter(x=>x.kind!=='pivot').slice(0,3).map(x=>Object.assign({},x,{k:'sup'}))]:[];
  const hc=_histCache[sigHistKey(sec.sym)];if(hc&&hc.bars&&!hc.rep&&hc.bars.length>=C.minBars){try{hc.rep=SIG.replay(hc.bars);}catch(e){}}
  const trades=hc&&hc.rep?hc.rep.trades.slice(-8).reverse():[],st=hc&&hc.rep?SIG.replayStats(hc.rep.trades,0):null;
  const lock=!!(held&&held.stop);
  const ctl=`<div class="dk-tech-ctl">${lock?`<span class="dk-note">${RT('Сторона — открытой позиции','Side — of the open position')} ${dkSide(held.side)}</span>`:`<div class="dk-seg side" role="group" aria-label="${RT('Моделируемая сторона','Modelled side')}"${dkG('side')}><button type="button" class="${side==='long'?'on':''} long" data-a="side" data-v="long" data-k="${dkEsc(it.key)}" aria-pressed="${side==='long'}">▲ ${RT('Лонг','Long')}</button><button type="button" class="${side==='short'?'on':''} short" data-a="side" data-v="short" data-k="${dkEsc(it.key)}" aria-pressed="${side==='short'}">▼ ${RT('Шорт','Short')}</button></div>`}
      <div class="dk-seg" role="group" aria-label="${RT('Период','Period')}"><button type="button" class="${DESK_UI.years===1?'on':''}" data-a="years" data-v="1" aria-pressed="${DESK_UI.years===1}">1${RT('Г','Y')}</button><button type="button" class="${DESK_UI.years===3?'on':''}" data-a="years" data-v="3" aria-pressed="${DESK_UI.years===3}">3${RT('Г','Y')}</button></div>
      <button type="button" class="dk-toggle dk-earn-t${deskEarnOn()?' on':''}" data-a="earn" aria-pressed="${deskEarnOn()}"${dkG('earn-line')}><i aria-hidden="true"></i>${RT('Прибыль','Earnings')}</button>
      ${lock?'':`<span class="dk-note">${RT('сторона здесь — только модель: позицию и «Решение» не меняет','the side here is a model only: it changes neither the position nor Decision')}</span>`}</div>`;
  return `${ctl}<div class="dk-cols">
      <div>
        <div class="dk-panel dk-chart-panel"><div id="dkChart" class="dk-chart">${it.r?'':RT('Нет строки бумаги','No row')}</div><div class="dk-note dk-padx">${lock?RT('линии — средняя, стоп и цель открытой позиции','lines — average, stop and target of the open position'):RT('линии — план выбранной стороны','lines — plan of the selected side')} · ATR ${RT('по High/Low (Wilder 14)','by High/Low (Wilder 14)')}${deskEarnOn()?` · <span${dkG('earn-line')}>${RT('маджента — прибыль × P/E, пунктир — прогноз аналитиков','magenta — earnings × P/E, dashed — analyst forecast')}</span>`:''}</div></div>
        <details class="dk-panel dk-mt14"${held?'':' open'}><summary class="dk-ph"><h2>${RT('История сигналов','Signal history')}${dkGi('sig-history')}</h2><span class="dk-cnt">${hc&&hc.rep?hc.rep.trades.length:0}</span><span class="dk-note dk-ml">${st?dkEsc(chartStatsText(st)):RT('реплей вердикта v2 по свечам','verdict v2 replayed over candles')}</span></summary>
          ${trades.length?`<div class="dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Вход','Entry')}</th><th>${RT('Сторона','Side')}</th><th class="r">${RT('Цена','Price')}</th><th class="r">${RT('Стоп','Stop')}</th><th class="r">${RT('Цель','Target')}</th><th>${RT('Выход','Exit')}</th><th class="r"${dkG('r-unit')}>R</th><th>${RT('Причина','Reason')}</th></tr></thead><tbody>${trades.map(t=>{const x=t.exits[t.exits.length-1];return `<tr><td class="dk-num">${t.d}</td><td>${dkSide(t.side)}</td><td class="r dk-num">${dkPx(t.entry)}</td><td class="r dk-num dk-dn">${dkPx(t.stop0)}</td><td class="r dk-num dk-up">${dkPx(t.target)}</td><td class="dk-num">${t.open?RT('открыта','open'):(x?x.d+' · '+dkEsc(x.why):'')}</td><td class="r dk-num dk-b ${t.R>=0?'dk-up':'dk-dn'}">${dkR(t.R)}</td><td class="dk-ink2">${dkEsc(t.why||'')}</td></tr>`;}).join('')}</tbody></table></div>`:`<div class="dk-empty">${RT('Входов по правилам v2 на истории не было (или свечи ещё грузятся).','No v2 entries over the history (or candles are loading).')}</div>`}</details>
        ${it.r?deskScenarioHTML(it):''}
      </div>
      <aside class="dk-aside">
        ${lock?`<details class="dk-panel"><summary class="dk-ph"><h2>${RT('Новый вход','New entry')}${dkGi('trade-plan')}</h2>${dkSide(side)}</summary>${deskPlanBox(it,side)}</details>`:`<div class="dk-panel"><div class="dk-ph"><h2>${RT('План сделки','Trade plan')}${dkGi('trade-plan')}</h2>${dkSide(side)}</div>${deskPlanBox(it,side)}</div>`}
        ${s?`<details class="dk-panel"${dkDetAttr('st-sig')}><summary class="dk-ph"><h2>${RT('Сигнал','Signal')}${dkGi('sig-detail')}</h2><span class="dk-cnt"${dkG('score')}>${RT('балл','score')} ${s.score}</span></summary><div class="dk-why">${s.why.map(w=>`<div>${dkEsc(w)}</div>`).join('')}</div>
          <div class="dk-kv dk-bt"><span class="dk-lbl"${dkG('sma')}>${RT('Тренд','Trend')}</span><span class="v ${s.trendUp?'dk-up':'dk-dn'}">${s.trendUp?'↑ SMA50 > SMA200':'↓ SMA50 < SMA200'}</span><span class="dk-lbl"${dkG('sig-detail')}>RSI 14</span><span class="v dk-num">${dkN(s.rsi,0)}</span><span class="dk-lbl"${dkG('atr')}>ATR 14</span><span class="v dk-num">${dkPx(s.atr)} · ${dkN(s.atrPct,1)}%</span><span class="dk-lbl">${RT('Объём к среднему','Volume vs avg')}</span><span class="v dk-num">×${dkN(s.volX,2)}</span><span class="dk-lbl">${RT('К SMA200','To SMA200')}</span><span class="v dk-num">${s.s200?dkPct((s.price/s.s200-1)*100,1):'—'}</span></div></details>
        <details class="dk-panel"${dkDetAttr('st-lvl')}><summary class="dk-ph"><h2>${RT('Лестница уровней','Level ladder')}${dkGi('ladder')}</h2><span class="dk-note dk-ml">${RT('структурные, без пивотов','structural, no pivots')}</span></summary><div class="dk-ladder">${ladder.map(x=>`<div class="dk-lvl ${x.k}"><span class="z"></span><span class="src">${dkEsc(String(x.src).replace(/\+/g,' · '))}</span><span class="dk-num">${dkPx(x.v)}</span><span class="dist dk-num">${x.k==='now'?'':dkPct((x.v/s.price-1)*100,1)}</span></div>`).join('')}</div></details>`:''}
      </aside>
    </div>`;
}
// «Техника → Сценарии» (карта §3.4, решение 1): bull/base/bear и implied move опционов — блок классики pf3ScenarioHTML.
// Тело рисуется только раскрытым: блок сам запрашивает implied move (pf3OptEnsure).
function deskScenarioHTML(it){
  const open=deskDetOpen('st-scn');
  let body='';
  if(open){try{body=pf3ScenarioHTML(it.d,it.r);}catch(e){console.warn('scenarios',e);}}
  return `<details class="dk-panel dk-mt14" data-lazy="scn"${dkDetAttr('st-scn')}><summary class="dk-ph"><h2>📊 ${RT('Сценарии bull/base/bear','Bull/base/bear scenarios')}</h2><span class="dk-note dk-ml">${RT('цели по уровням и таргетам, implied move опционов · загрузка по раскрытию','targets from levels and analysts, options implied move · loads on open')}</span></summary>
    ${open?`<div class="dk-lazy-b dk-padx dk-pb">${body?deskClassicBox(body):`<div class="dk-empty">${RT('Нет цены бумаги — сценарии не считаются.','No stock price — no scenarios.')}</div>`}<p class="dk-note">${RT('Сценарии — ориентир по уровням и таргетам, не правила входа: план, стоп и размер — у SIG выше.','Scenarios are a guide from levels and targets, not entry rules: plan, stop and size come from SIG above.')}</p></div>`:''}</details>`;
}
// Верх «Компании» (§3.2 I1 → P2): «Ключевой тезис» + «Моя зона покупки» (если бумага в списке), три плитки оценки
// (цена на дату тезиса · справедливая стоимость · апсайд; только с правом view.valuation) и «Что покупаю / Главный риск».
// Карточка «Что делать» ушла в «Решение».
function deskThesisHTML(it,w,px,val){
  const s=it.s,sec=it.sec,ccy=dkCcy(sec.ccy),canE=can('action.edit_plan'),k=dkEsc(it.key);
  const R=deskRiskLevel(s,{plan:s&&(deskPlanFor(it,'long')||s.plans.long),beta:deskBeta(it),riskOvr:w&&w.riskOvr});
  const riskBlock=dkRiskMeter(R)+dkHow('risk',dkRiskHow(R,s));
  const own=w&&w.thesis,thesis=`<div class="dk-thesis"><div class="dk-eyebrow">${RT('Ключевой тезис','Key thesis')}${dkGi('thesis')}${own?'':` · <span class="dk-accent-text">${RT('авто по сигналу','auto from the signal')}</span>`}</div>
      <h2>${dkEsc(own?(w.thesis.title||w.thesis.text):(s?s.why[0]||'':RT('Собираем историю цены и считаем сигнал.','Loading price history and computing the signal.')))}</h2>
      ${own?(w.thesis.title&&w.thesis.text?`<p>${dkEsc(w.thesis.text)}</p>`:''):(s&&s.why[1]?`<p>${dkEsc(s.why[1])}</p>`:'')}
      ${canE?`<div class="dk-row dk-mt14"><button class="dk-btn dk-sm" data-a="wedit" data-k="${k}" data-f="thesis">${own?'✎ '+RT('Изменить','Edit'):'✎ '+RT('Написать свой','Write my own')}</button></div>`:''}</div>`;
  let side2;
  if(w){
    const z=deskWatchZone(w,px),zHow=`<p>${RT('Коррекция = верх зоны ÷ текущая цена − 1','Correction = zone top ÷ current price − 1')}${w.buyLo<w.buyHi?RT(' (и низ зоны ÷ цена − 1)',' (and zone bottom ÷ price − 1)'):''}: ${dkPx(w.buyHi)} ÷ ${dkPx(px)} ${ccy}${z?` → ${dkPct(z.dHi,1)}`:''}.</p>
      <p>${RT('Зона','Zone')}: ${w.buySrc==='signal'?RT('предложена сигналом','suggested by the signal'):RT('задана вручную','set manually')}${w.buyNote?' · '+dkEsc(w.buyNote):''}. ${RT(`Цена ${sec.live?'live':'из снапшота/свечей, не live'}.`,`Price ${sec.live?'live':'from snapshot/candles, not live'}.`)}</p>`;
    side2=`<div class="dk-action-card dk-zone-card"><div class="dk-eyebrow">${RT('Моя зона покупки','My buy zone')}${dkGi('my-zone')}</div>
      <h2 class="dk-num">${dkZoneText(w)} <small>${ccy}</small></h2>
      <div class="dk-wneed${z&&z.hot?' hot':''}"${z&&z.hot?dkG('zone-dot'):dkG('zone-need')}><span class="dk-dot${z&&z.hot?' hot':''}"></span>${dkEsc(dkZoneNeed(w,z))}</div>
      ${w.buyNote?`<p class="dk-note">${dkEsc(w.buyNote)}</p>`:''}${dkHow('zone',zHow)}
      <div class="dk-action-price">${riskBlock}</div>
      ${canE?`<div class="dk-row dk-mt6"><button class="dk-btn dk-sm" data-a="wedit" data-k="${k}" data-f="zone">✎ ${RT('Зона','Zone')}</button>${w.buyHi?`<button class="dk-btn dk-sm" data-a="wnotify" data-k="${k}">🔔 ${RT('Уведомить','Alert')}</button>`:''}</div>`:''}</div>`;
  }else if(canE)side2=`<div class="dk-action-card dk-zone-card"><div class="dk-eyebrow">${RT('Моя зона покупки','My buy zone')}${dkGi('my-zone')}</div>
      <p class="dk-note">${RT('Бумаги нет в списке покупок. Добавьте её — зона предложится по сигналу, тезис и сценарии можно дописать.','The stock is not in the shopping list. Add it — the zone is suggested from the signal; thesis and scenarios can be added.')}</p>
      <div class="dk-action-price">${riskBlock}</div><div class="dk-row dk-mt6">${dkWatchBtn(it.key,true)}</div></div>`;
  // Справедливая стоимость и апсайд — от текущей цены; «цена на дату тезиса» — отдельно.
  const tg=TG_FULL[sec.tk]||TG_FULL[posTk(sec.tk)]||null,FV=deskFairValue(w,tg,px),stale=FV.src==='analysts'&&s&&s.flags.includes('stale-target');
  // Таргеты без валюты листинга (старый кэш) показываются с оговоркой; «Решение» и подборки их не используют (§3.2).
  const unconf=FV.src==='analysts'&&!deskSelectionCache(TG_FULL,sec).data;
  const fvMeta=[FV.n?RT(`${FV.n} аналитиков`,`${FV.n} analysts`):'',FV.at?RT('обновлено ','updated ')+FV.at:''].filter(Boolean).join(', ');
  const pn={bear:'bear',base:'base',bull:'bull',low:RT('минимум','low'),consensus:RT('консенсус','consensus'),high:RT('максимум','high')};
  const fvHow=FV.value==null?`<p>${RT('Нет сценариев (задайте bear/base/bull в идее) и таргетов аналитиков — справедливая стоимость не считается.','No scenarios (set bear/base/bull in the idea) and no analyst targets — fair value is not computed.')}</p>`
    :`<p>${FV.src==='scenarios'?RT('Взвешенное среднее ваших сценариев','Weighted average of your scenarios'):RT('Взвешенное среднее таргетов аналитиков','Weighted average of analyst targets')+(fvMeta?` (${dkEsc(fvMeta)})`:'')}:</p>
      <ul>${FV.parts.map(p=>`<li>${dkEsc(pn[p.k]||p.k)} ${dkPx(p.v)} ${ccy} × ${dkN(p.share*100,0)} %</li>`).join('')}</ul>
      <p>= <b>${dkPx(FV.value)} ${ccy}</b>${FV.parts.length<3?RT(' (веса нормированы на сумму заданных)',' (weights renormalised over the given ones)'):''}. ${RT('Апсайд = справедливая ÷ текущая цена − 1','Upside = fair value ÷ current price − 1')} = ${dkPx(FV.value)} ÷ ${dkPx(px)} − 1 = <b>${dkPct(FV.upsidePct,1)}</b>. ${RT(`Цена ${sec.live?'live':'не live (снапшот/свечи)'}.`,`Price ${sec.live?'live':'not live (snapshot/candles)'}.`)}</p>${stale?`<p class="dk-crit">${RT('Свежий «Таргет 3м» заметно ниже среднего — таргет аналитиков устарел.','The fresh 3m target is well below the average — the analyst target is stale.')}</p>`:''}`;
  const tile=(l,v,d,cls)=>`<div class="dk-panel dk-stat"><div class="dk-lbl">${l}</div><div class="dk-v dk-num ${cls||''}">${v}</div><div class="dk-d">${d}</div></div>`;
  const tiles=`<div class="dk-value-grid">
      ${w&&w.refPx?tile(RT('Цена на дату тезиса','Price at thesis date')+dkGi('ref-px'),`${dkPx(w.refPx)} <small>${ccy}</small>`,dkEsc(w.refAt||'')+(px?` · ${RT('с тех пор','since')} ${dkPct((px/w.refPx-1)*100,1)}`:'')):tile(RT('Текущая цена','Current price'),`${dkPx(px)} <small>${ccy}</small>`,w?RT('цена на дату тезиса не зафиксирована','thesis price not recorded'):RT('идеи в списке нет','not in the list'))}
      ${tile(RT('Справедливая стоимость','Fair value')+dkGi('fair-value'),FV.value!=null?`${dkPx(FV.value)} <small>${ccy}</small>`:'—',(FV.src==='scenarios'?RT('ваши сценарии 25/50/25','your scenarios 25/50/25'):FV.src==='analysts'?RT('по аналитикам','by analysts'):RT('нет сценариев и таргетов','no scenarios or targets'))+(stale?` <span class="dk-flag"${dkG('fl-stale-target')}>${RT('таргет устарел','stale target')}</span>`:'')+(unconf?` <span class="dk-flag"${dkG('selection-valuation')}>${RT('валюта листинга не подтверждена','listing currency unconfirmed')}</span>`:''),'dk-accent-text')}
      ${tile(RT('Апсайд до справедливой','Upside to fair value')+dkGi('upside'),FV.upsidePct!=null?dkPct(FV.upsidePct,Math.abs(FV.upsidePct)<10?1:0):'—',RT('от текущей цены','from the current price'),FV.upsidePct==null?'':FV.upsidePct>=0?'dk-up':'dk-dn')}
    </div>${dkHow('fv',fvHow)}`;
  const card2=(l,c)=>c?`<div class="dk-panel dk-stat dk-card2"><div class="dk-lbl">${l}${dkGi('what-buy')}</div><div class="dk-b">${dkEsc(c.title||'')}</div>${c.text?`<div class="dk-note">${dkEsc(c.text)}</div>`:''}</div>`:'';
  const two=w&&(w.whatBuy||w.mainRisk)?`<div class="dk-two dk-mt14">${card2(RT('Что покупаю','What I buy'),w.whatBuy)}${card2(RT('Главный риск','Main risk'),w.mainRisk)}</div>`:'';
  return `<section class="dk-stock-focus dk-mb${side2?'':' solo'}">${thesis}${side2||''}</section>${val||two?`<div class="dk-mb">${val?tiles:''}${two}</div>`:''}`;
}
// ── «Рост бизнеса» (I3, §3.4): ленивый ?financials= одной бумаги — только по раскрытию блока (критерий §5#7).
// Кэш клиента в памяти (в снапшот не пишется): ответ живёт fin.cacheMin, ошибка — fin.errMin.
const _deskFin={};
function deskFinLoad(sym){
  if(!sym||!PRICE_PROXY)return;
  const C=DESK_IDEA_CFG.fin,c=_deskFin[sym];
  if(c&&(c.loading||Date.now()-c.at<(c.data&&c.data.status!=='error'?C.cacheMin:C.errMin)*60e3))return;
  _deskFin[sym]={loading:true,at:Date.now(),data:(c&&c.data)||null};
  deskPoolRun('fin|'+sym,()=>fetch(PRICE_PROXY+'?financials='+encodeURIComponent(sym)).then(r=>r.json()).catch(()=>null).then(j=>{
    const ok=j&&typeof j==='object'&&Array.isArray(j.annual);
    _deskFin[sym]={loading:false,at:Date.now(),data:ok?j:{sym,status:'error',annual:[],estimates:[],notes:['network']}};
  }));
}
// ── P2 (§8): пул новых загрузок бумаги — не больше DESK_IDEA_CFG.selection.loadPool одновременно, дедуп по «тип|символ»
// (второй вызов того же ключа возвращает тот же промис). TTL и негативный кэш — у самих загрузчиков. По завершении —
// фоновая перерисовка: поздний ответ ложится в кэш своей бумаги и не переключает экран (ввод защищает deskRender).
const _deskPool={q:[],run:0,live:{}};
function deskPoolRun(key,fn){
  const P=_deskPool;if(P.live[key])return P.live[key].p;
  let done;const p=new Promise(r=>{done=r;});
  P.live[key]={p,fn,done};P.q.push(key);deskPoolPump();
  return p;
}
function deskPoolPump(){
  const P=_deskPool,max=Math.max(1,(DESK_IDEA_CFG.selection||{}).loadPool||2);
  while(P.run<max&&P.q.length){
    const key=P.q.shift(),x=P.live[key];if(!x)continue;
    P.run++;let pr;try{pr=Promise.resolve(x.fn());}catch(e){pr=Promise.resolve();}
    pr.catch(()=>{}).then(()=>{P.run--;delete P.live[key];x.done();deskPoolPump();deskRender();});
  }
}
const deskPoolBusy=key=>!!_deskPool.live[key];
// «Компания»: новые загрузки — только при входе в режим (не при каждой перерисовке и не на других экранах).
function deskCompanyEnsure(){
  if(DESK_UI.route!=='stock'||DESK_UI.stockView!=='company'){DESK_UI._compFor=null;return;}
  const it=deskSecOf(DESK_UI.key);if(!it||DESK_UI._compFor===it.key)return;
  DESK_UI._compFor=it.key;deskCompanyLoad(it);
}
function deskCompanyLoad(it){
  const sec=it.sec,sym=sec.sym;
  if(can('view.health')){deskPoolRun('fund|'+sym,()=>pf3FundFetch([sym]));deskFinLoad(sym);}
  deskPoolRun('news|'+sec.tk,()=>pf3NewsEnsure(sec.tk,sec.ccy));
  deskPoolRun('earn|'+sym,()=>deskEarnLoad(sym));
}
// «Обновить данные» одной бумаги: живая цена (?symbols=) и свечи сигнала — без массовых загрузок.
async function deskRefreshOne(key){
  const it=deskSecOf(key);if(!it||!it.r||!can('action.refresh_data')||DESK_UI.r1)return;
  const sym=it.sec.sym;DESK_UI.r1=key;deskRender(true);
  try{await Promise.all([deskPoolRun('px|'+sym,()=>pf3RefreshCardPrice(it.d,it.r,it.tab)),deskPoolRun('hist|'+sym,()=>sigEnsure([sym]))]);}catch(e){}
  if(DESK_UI.r1===key)DESK_UI.r1=null;
  const lv=PX_LIVE[sym];if(!(lv&&Date.now()-lv.at<PX_FRESH_MS))toast(RT('Цена не обновилась — воркер недоступен или бумаги нет у провайдера','The price did not refresh — worker unreachable or the provider lacks the stock'),true);
  _deskItems=null;deskRender(true);
}
const DK_FIN_NOTE={'no-estimates':()=>RT('провайдер не дал прогноза','the provider gave no forecast'),'est-scale':()=>RT('прогноз отброшен: его масштаб не совпадает с отчётностью (другая валюта?)','forecast dropped: its scale does not match the reports (another currency?)'),
  'short-history':()=>RT('меньше 3 лет истории','under 3 years of history'),'no-fcf':()=>RT('FCF у провайдера нет','no FCF at the provider'),'no-eps':()=>RT('EPS у провайдера нет','no EPS at the provider'),
  'provider-error':()=>RT('провайдеры не ответили','providers did not respond'),network:()=>RT('воркер недоступен','worker unreachable')};
const dkFinMetric=m=>({revenue:RT('Выручка','Revenue'),eps:'EPS',fcf:'FCF'})[m]||m;
function dkFinHead(M){
  const yrs=n=>RT(`${n} ${n===1?'год':n<5?'года':'лет'}`,`${n} yr${n===1?'':'s'}`);
  return [M.cagrHist?`${RT('Исторический CAGR','Historical CAGR')} <b class="dk-num">${dkPct(M.cagrHist.pct,1)}</b>`:(M.act>=2?RT('исторический CAGR не считается (база ≤ 0)','historical CAGR n/a (base ≤ 0)'):''),
    M.cagrFcst?`${RT('Прогнозный CAGR','Forecast CAGR')} <b class="dk-num">${dkPct(M.cagrFcst.pct,1)}</b>`:M.metric==='fcf'?RT('FCF — только факт','FCF — actuals only'):M.est?RT('прогноз на ','forecast for ')+yrs(M.est):RT('прогноз недоступен','forecast unavailable')].filter(Boolean).join(' · ');
}
function deskFinHTML(it){
  const sec=it.sec,sym=sec.sym,open=DESK_UI.finOpen===it.key,c=_deskFin[sym],fin=c&&c.data;
  const M=deskFinModel(fin,DESK_UI.finM,Date.now()),ccy=M.ccy||sec.ccy;
  const sum=!fin?RT('история и прогноз · загрузка по раскрытию','history and forecast · loads on open'):M.state==='error'?RT('ошибка провайдера','provider error'):M.state==='nodata'?RT('нет отчётности','no reports'):dkFinHead(M);
  let body='';
  if(open){
    const seg=`<div class="dk-seg" role="group" aria-label="${RT('Ряд','Series')}">${['revenue','eps','fcf'].map(m=>`<button class="${M.metric===m?'on':''}" data-a="finm" data-v="${m}" aria-pressed="${M.metric===m}">${dkFinMetric(m)}</button>`).join('')}</div>`;
    if(!fin)body=`<div class="dk-empty">${RT('Загрузка отчётности…','Loading reports…')}</div>`;
    else if(M.state==='error')body=`<div class="dk-warn">⚠ ${RT('Провайдеры отчётности не ответили','Report providers did not respond')}${M.notes.length?' ('+M.notes.map(n=>DK_FIN_NOTE[n]?DK_FIN_NOTE[n]():n).join(', ')+')':''}. <button class="dk-btn dk-sm" data-a="finre" data-k="${dkEsc(sym)}">${RT('Повторить','Retry')}</button></div>`;
    else if(M.state==='nodata')body=`<div class="dk-row">${seg}</div><div class="dk-empty">${!(fin.annual||[]).length?RT(`Годовой отчётности ${dkEsc(sec.tk)} у провайдеров нет (для Nordic/EU истории часто нет) — показывать нечего.`,`Providers have no annual reports for ${dkEsc(sec.tk)} (often none for Nordic/EU) — nothing to show.`):RT(`Ряда «${dkFinMetric(M.metric)}» у провайдера нет.`,`The provider has no “${dkFinMetric(M.metric)}” series.`)}</div>`;
    else{
      const rows=(fin.annual||[]).map(x=>({y:x.year,r:x.revenue,e:x.eps,f:x.fcf,k:RT('факт','actual')})).concat((fin.estimates||[]).map(x=>({y:x.year,r:x.revenue,e:x.eps,f:null,k:RT('прогноз','forecast')+(x.n?` · ${x.n}`:'')})));
      const cg=(C,l)=>C?`<p>${l}: (${deskFinFmt(C.to.v,M.metric)} ÷ ${deskFinFmt(C.from.v,M.metric)})^(1/${C.years}) − 1 = <b>${dkPct(C.pct,1)}</b> (${C.from.year}→${C.to.year}).</p>`:'';
      const how=`<div class="dk-wrap"><table class="dk-tbl dk-fin-tbl"><thead><tr><th>${RT('Год','Year')}</th><th class="r">${RT('Выручка','Revenue')}</th><th class="r">EPS</th><th class="r">FCF</th><th>${RT('Тип','Type')}</th></tr></thead><tbody>${rows.map(x=>`<tr><td class="dk-num">${x.y}</td><td class="r dk-num">${deskFinFmt(x.r,'revenue')}</td><td class="r dk-num">${deskFinFmt(x.e,'eps')}</td><td class="r dk-num">${deskFinFmt(x.f,'fcf')}</td><td>${x.k}</td></tr>`).join('')}</tbody></table></div>
        <p>${RT('CAGR = (последний ÷ первый)^(1/лет) − 1; не считается, если база или итог ≤ 0. Рост г/г — к предыдущему году. Прогнозный CAGR — от последнего факта до последнего прогноза, только при ≥ 2 годах прогноза.','CAGR = (last ÷ first)^(1/years) − 1; n/a when the base or the end is ≤ 0. YoY — vs the previous year. Forecast CAGR — from the last actual to the last forecast, only with ≥ 2 forecast years.')}</p>
        ${cg(M.cagrHist,RT('Исторический','Historical'))}${cg(M.cagrFcst,RT('Прогнозный','Forecast'))}
        <p>${RT('Источник','Source')}: ${M.source==='fmp'?RT('FMP (отчётность US)','FMP (US reports)'):'Yahoo'}${fin.estimates&&fin.estimates.length?RT(' · прогноз — консенсус Yahoo (earningsTrend)',' · forecast — Yahoo consensus (earningsTrend)'):''} · ${RT('получено','fetched')} ${dkEsc(String(M.fetchedAt||'').slice(0,16).replace('T',' '))} UTC · ${RT('валюта отчётности','reporting currency')} ${dkEsc(ccy||'—')}${fin.fiscalYearEnd?` · ${RT('конец фин. года','fiscal year end')} ${dkEsc(fin.fiscalYearEnd)}`:''}.</p>
        ${M.excluded.length?`<p>${RT(`Годы без значения «${dkFinMetric(M.metric)}» исключены`,`Years without “${dkFinMetric(M.metric)}” excluded`)}: ${M.excluded.join(', ')}.</p>`:''}
        ${M.notes.length?`<p>${M.notes.map(n=>DK_FIN_NOTE[n]?DK_FIN_NOTE[n]():n).join(' · ')}.</p>`:''}`;
      body=`<div class="dk-row">${seg}</div>
        ${M.stale?`<div class="dk-warn">${RT(`Данные от ${String(M.fetchedAt).slice(0,10)} — устарели (> ${DESK_IDEA_CFG.fin.staleDays} дн)`,`Data from ${String(M.fetchedAt).slice(0,10)} — stale (> ${DESK_IDEA_CFG.fin.staleDays} d)`)}</div>`:''}
        <figure class="dk-fin-fig">${deskFinSvg(M,ccy,(window.innerWidth||1440)<600)}<div class="dk-fin-tip" hidden></div></figure>
        <div class="dk-fin-lg"><span><i class="a"></i>${RT('факт','actual')}</span>${M.est?`<span><i class="e"></i>${RT('прогноз (П)','forecast (F)')}</span>`:''}<span><i class="l"></i>${RT('рост г/г, правая ось','YoY growth, right axis')}</span><span class="dk-mut">${dkEsc(ccy||'')}${M.metric==='eps'?RT(' на акцию',' per share'):''}</span></div>
        ${M.state==='partial'&&M.metric!=='fcf'&&!M.est?`<div class="dk-note">${RT('Частичные данные: прогноза нет — показан только факт.','Partial data: no forecast — actuals only.')}</div>`:''}
        ${dkHow('fin',how,RT('Данные и методика','Data & method'))}`;
    }
  }
  return `<details class="dk-panel dk-mt14 dk-fin" data-fin="${dkEsc(it.key)}" data-sym="${dkEsc(sym)}"${open?' open':''}><summary class="dk-ph" id="dkFinSum"><h2>${RT('Рост бизнеса','Business growth')}${dkGi('fin')}</h2><span class="dk-note dk-ml">${sum}</span></summary>${open?`<div class="dk-padx dk-fin-b">${body}</div>`:''}</details>`;
}
// ── «Аналитики и оценка» (I3, §3.5): данные уже в клиенте (VAL, TG_FULL, колонка «Кап-я»), воркер не нужен.
const dkCssPct=v=>Math.round(Math.max(0,Math.min(100,+v||0))*10)/10;   // % для style (без локали)
function deskRowNum(it,h){const H=it&&it.d&&it.d.headers,i=H?H.indexOf(h):-1,v=i>=0&&it.r?parseFloat(it.r[i]):NaN;return isFinite(v)?v:null;}
function deskAnaHTML(it,px){
  const sec=it.sec,tk=String(sec.tk||'').toUpperCase(),ptk=posTk(tk),vk=VAL[tk]?tk:ptk,V=VAL[vk]||null,tg=TG_FULL[tk]||TG_FULL[ptk]||null,F=pf3FundFor(sec.sym),ccy=dkCcy(sec.ccy);
  const et=it.r&&it.d?pf3EffTarget(it.d,it.r):null,tgt=et&&et.target>0?et.target:(tg&&tg.consensus>0?tg.consensus:null),up=tgt&&px?(tgt/px-1)*100:null;
  const cap=deskRowNum(it,'Кап-я'),pick=k=>V&&V[k]>0?+V[k]:(F&&F[k]>0?+F[k]:null),pe=pick('pe'),fpe=pick('fwdPe'),ps=pick('ps');
  const med=V&&V.sector?((_valSecCache||valSectorMedians())[V.sector]||null):null,medOk=!!(med&&med.n>=2);
  const fin=(_deskFin[sec.sym]||{}).data,fl=fin&&Array.isArray(fin.annual)?fin.annual.filter(x=>x.fcf!=null).slice(-1)[0]:null;
  const pfcf=cap>0&&fl&&fl.fcf>0&&fin.ccy===sec.ccy?cap/fl.fcf:null;
  const cell=(l,v,d,cls)=>`<div class="dk-mcell"><div class="dk-lbl">${l}</div><div class="dk-b dk-num ${cls||''}">${v}</div>${d?`<div class="dk-note">${d}</div>`:''}</div>`;
  const mult=(l,v,k)=>{const D=medOk?deskMultDev(v,med[k]):{dev:null,cls:''};return cell(l,v>0?dkN(v,1):'—',D.dev!=null?RT('сектор ','sector ')+dkN(med[k],1)+' · '+dkPct(D.dev,0):'',D.cls==='cheap'?'dk-up':D.cls==='rich'?'dk-dn':'');};
  const metrics=`<div class="dk-mrow">${cell(RT('Капитализация','Market cap'),cap>0?deskFinFmt(cap,'revenue')+' '+ccy:'—',cap>0?'':RT('обновите таргеты','refresh targets'))}
    ${cell(RT('Цель аналитиков','Analyst target'),tgt?dkPx(tgt)+' '+ccy:'—',up!=null?`<span class="${up>=0?'dk-up':'dk-dn'}">${dkPct(up,1)}</span>`:'')}
    ${mult('P/E',pe,'pe')}${mult('Forward P/E',fpe,'fwdPe')}${mult('P/S',ps,'ps')}${pfcf?cell('P/FCF',dkN(pfcf,1),fl.year+' FY'):''}</div>`;
  const R=deskRatings(tg&&tg.ratings);
  const ratings=R?`<div class="dk-sub-h">${RT('Рекомендации аналитиков','Analyst ratings')} <span class="dk-mut dk-num">${R.total}</span>${R.consensus?` · <b>${dkEsc(R.consensus)}</b>`:''}</div>
    <div class="dk-rbar" role="img" aria-label="${dkEsc(R.segs.map(x=>x.l+' '+x.n).join(', '))}">${R.segs.map(x=>`<span class="r-${x.k}" style="width:${dkCssPct(x.pct)}%" title="${x.l}: ${x.n}"></span>`).join('')}</div>
    <div class="dk-rbar-l">${R.segs.map(x=>`<span><i class="r-${x.k}"></i>${x.l} <b class="dk-num">${x.n}</b></span>`).join('')}</div>`:`<div class="dk-note">${RT('Распределения рекомендаций нет (FMP даёт его только для US).','No rating distribution (FMP has it for US only).')}</div>`;
  const fanL=tg&&tg.consensus>0?[['high',tg.high,RT('максимум','high'),'dk-up'],['consensus',tg.consensus,RT('консенсус','consensus'),'dk-accent-text'],['low',tg.low,RT('минимум','low'),'dk-dn']].filter(x=>x[1]>0):[];
  const fan=fanL.length?`<div class="dk-sub-h">${RT('Цель на 12 мес','12-month target')}</div><div id="dkFan" class="dk-fan"></div>
    <div class="dk-fin-lg">${fanL.map(x=>`<span class="${x[3]}">${x[2]} <b class="dk-num">${dkPx(x[1])}</b>${px?` <span class="dk-num">${dkPct((x[1]/px-1)*100,0)}</span>`:''}</span>`).join('')}</div>`:`<div class="dk-note">${RT('Таргетов аналитиков нет — веер не строится.','No analyst targets — no fan.')}</div>`;
  // P/E против пиров сектора и против своей медианы 3/5 лет.
  const caps={};deskItems().items.forEach(x=>{const c=deskRowNum(x,'Кап-я');if(c>0)caps[String(x.sec.tk||'').toUpperCase()]=c;});
  const P=deskPeers(vk,VAL,caps);
  let peers='';
  if(!(pe>0))peers=`<div class="dk-note">${RT('P/E нет (компания убыточна или мультипликаторы не загружены — ⋯ → «Сервис» → «📐 Оценка»).','No P/E (loss-making or multiples not loaded — ⋯ → “Service” → “📐 Valuation”).')}</div>`;
  else if(P.reason)peers=`<div class="dk-note">${P.reason==='nosector'?RT('Сектор бумаги неизвестен — пиров нет.','Sector unknown — no peers.'):RT(`В секторе «${dkEsc(P.sector)}» с P/E только ${P.n} бум. (нужно ≥ ${DESK_IDEA_CFG.ana.peersMin}).`,`Only ${P.n} peer(s) with P/E in “${dkEsc(P.sector)}” (need ≥ ${DESK_IDEA_CFG.ana.peersMin}).`)}</div>`;
  else{
    const all=P.peers.map(p=>p.pe).concat(pe),lo=Math.min(...all),hi=Math.max(...all),pos=v=>hi>lo?(v-lo)/(hi-lo)*100:50,D=deskMultDev(pe,P.median);
    peers=`<div class="dk-pe" role="img" aria-label="${dkEsc(RT(`P/E ${dkN(pe,1)} против медианы пиров ${dkN(P.median,1)}`,`P/E ${dkN(pe,1)} vs peer median ${dkN(P.median,1)}`))}">
      ${P.peers.map(p=>`<span class="dk-pe-dot" style="left:${dkCssPct(pos(p.pe))}%" title="${dkEsc(p.tk)} · P/E ${dkN(p.pe,1)}"></span>`).join('')}
      <span class="dk-pe-med" style="left:${dkCssPct(pos(P.median))}%" title="${RT('медиана пиров','peer median')} ${dkN(P.median,1)}"></span>
      <span class="dk-pe-me" style="left:${dkCssPct(pos(pe))}%"><b>${dkEsc(sec.tk)} ${dkN(pe,1)}</b></span></div>
      <div class="dk-pe-ax dk-num"><span>${dkN(lo,1)}</span><span>${dkN(hi,1)}</span></div>
      <div class="dk-note">${RT('Медиана пиров','Peer median')} <b class="dk-num">${dkN(P.median,1)}</b> · ${RT('бумага','stock')} <b class="dk-num ${D.cls==='cheap'?'dk-up':D.cls==='rich'?'dk-dn':''}">${dkPct(D.dev,0)}</b> · ${P.peers.map(p=>dkEsc(p.tk)).join(', ')}</div>`;
  }
  const own=pe>0&&V&&V.hist?[['pe3',RT('медиана 3 лет','3-yr median')],['pe5',RT('медиана 5 лет','5-yr median')]].filter(([k])=>V.hist[k]>0).map(([k,l])=>{const D=deskMultDev(pe,V.hist[k]);return `<span>${l} <b class="dk-num">${dkN(V.hist[k],1)}</b> → <b class="dk-num ${D.cls==='cheap'?'dk-up':D.cls==='rich'?'dk-dn':''}">${dkPct(D.dev,0)}</b></span>`;}):[];
  const how=`<p>${RT('Мультипликаторы','Multiples')}: ${V?RT('«📐 Оценка» (Yahoo)','“📐 Valuation” (Yahoo)')+(V.at?' · '+dkEsc(String(V.at).slice(0,10)):''):F?RT('фундаментал карточки (Yahoo summaryDetail)','card fundamentals (Yahoo summaryDetail)'):'—'}. ${RT('Цвет — только при отклонении от медианы сектора больше','Colour only when the gap to the sector median exceeds')} ${DESK_IDEA_CFG.ana.devPct} %${medOk?RT(` (медиана по ${med.n} бум. дашборда)`,` (median over ${med.n} dashboard stocks)`):RT(' — медианы сектора нет, цвет нейтральный',' — no sector median, neutral colour')}.</p>
    <p>${RT('Цель аналитиков — эффективный таргет строки (при устаревшем среднем — свежий «Таргет 3м»), апсайд — от текущей цены.','Analyst target — the row’s effective target (fresh 3m target when the average is stale), upside from the current price.')}${tg?` ${RT('Таргеты','Targets')}: ${tg.src==='yahoo'?'Yahoo':'FMP'}${tg.count?` · ${tg.count} ${RT('аналит.','analysts')}`:''}${tg.lastDate?` · ${RT('посл.','last')} ${dkEsc(tg.lastDate)}`:''}.`:''}</p>
    <p>${RT('Капитализация — колонка «Кап-я» (Yahoo, обновление таргетов). P/FCF = капитализация ÷ FCF последнего фин. года, только если валюта отчётности совпадает с валютой торгов и «Рост бизнеса» загружен.','Market cap — the “Кап-я” column (Yahoo, targets refresh). P/FCF = market cap ÷ last fiscal-year FCF, only when reporting and trading currencies match and “Business growth” is loaded.')}</p>
    <p>${RT(`Пиры — до ${DESK_IDEA_CFG.ana.peersMax} бумаг того же сектора с P/E > 0, крупнейшие по капитализации; веер — последний год цены и линии к минимуму/консенсусу/максимуму через 12 мес.`,`Peers — up to ${DESK_IDEA_CFG.ana.peersMax} same-sector stocks with P/E > 0, largest by market cap; fan — the last year of price and lines to low/consensus/high in 12 months.`)}</p>`;
  const sum=tgt?`${RT('цель','target')} ${dkPx(tgt)} ${ccy}${up!=null?` <span class="${up>=0?'dk-up':'dk-dn'}">${dkPct(up,0)}</span>`:''}${pe>0?' · P/E '+dkN(pe,1):''}`:pe>0?'P/E '+dkN(pe,1):RT('нет таргетов и мультипликаторов','no targets or multiples');
  return `<details class="dk-panel dk-mt14 dk-ana"${dkDetAttr('st-ana')}><summary class="dk-ph" id="dkAnaSum"><h2>${RT('Аналитики и оценка','Analysts & valuation')}${dkGi('analysts')}</h2><span class="dk-note dk-ml">${sum}</span></summary>
    <div class="dk-padx dk-ana-b">${metrics}${ratings}${fan}<div class="dk-sub-h">${RT('P/E против пиров','P/E vs peers')}${P.sector?` <span class="dk-mut">· ${dkEsc(P.sector)}</span>`:''}</div>${peers}${own.length?`<div class="dk-pe-own">${RT('Против своей истории','Vs own history')}: ${own.join(' · ')}</div>`:''}${it.r?deskValDetailHTML(it):''}${dkHow('ana',how)}</div></details>`;
}
// «Оценка подробно» (карта §3.4, решение 1): EV/EBITDA, PEG, «ловушка стоимости», Fwd/TTM, пиры (valHTML) и изменения
// таргетов за 30 дн (targetsBlockHTML) — блоки классики, тело только раскрытым; клик по пиру открывает его «Акцию».
function deskValDetailHTML(it){
  const open=deskDetOpen('st-val');
  return `<details class="dk-how" data-lazy="val"${dkDetAttr('st-val')}><summary>📐 ${RT('Оценка подробно: EV/EBITDA, PEG, ловушка стоимости, пиры, изменения таргетов','Detailed valuation: EV/EBITDA, PEG, value trap, peers, target changes')}</summary>${open?`<div class="dk-lazy-b dk-how-b">${deskClassicBox(valHTML(it.d,it.r)+targetsBlockHTML(it.d,it.r))}</div>`:''}</details>`;
}
function deskFanAttach(kept){
  const box=document.getElementById('dkFan'),det=box&&box.closest('details'),it=DESK_UI.route==='stock'?deskSecOf(DESK_UI.key):null;
  if(!box||!it){if(_deskFan){if(_deskFan.ch)_deskFan.ch.destroy();_deskFan=null;}return;}
  const tk=String(it.sec.tk||'').toUpperCase(),tg=TG_FULL[tk]||TG_FULL[posTk(tk)]||null,hc=_histCache[sigHistKey(it.sec.sym)];
  const M=hc&&hc.bars?chartFanModel(hc.bars,tg):null,key=it.key+'|'+(tg&&[tg.low,tg.consensus,tg.high].join('/'))+'|'+(M?M.last.time:'');
  if(_deskFan&&_deskFan.key===key&&_deskFan.ch){if(kept){box.replaceWith(kept);return;}if(_deskFan.box===box)return;}
  if(!det||!det.open)return;   // закрыт: autoSize в скрытом блоке дал бы нулевой размер — рисуем при раскрытии
  if(!M){box.textContent=hc?RT('Нет таргетов для веера.','No targets for the fan.'):RT('Свечи грузятся…','Loading candles…');return;}
  if(!(window.LightweightCharts&&window.LightweightCharts.createSeriesMarkers)){box.textContent=RT('Загрузка графика…','Loading chart…');loadLWC().then(()=>deskFanAttach()).catch(e=>{const b=document.getElementById('dkFan');if(b)b.textContent=RT('Ошибка загрузки: ','Load error: ')+(e.message||e);});return;}
  if(_deskFan&&_deskFan.ch)_deskFan.ch.destroy();
  _deskFan={key,ch:null,box};
  try{_deskFan.ch=renderTargetFan(box,M,{ccy:it.sec.ccy});}catch(e){box.textContent=RT('Ошибка графика: ','Chart error: ')+(e.message||e);}
}
// Подсказка столбца «Роста бизнеса» — по наведению и по фокусу клавиатуры.
function deskFinTip(g,show){
  const fig=g&&g.closest('.dk-fin-fig'),tip=fig&&fig.querySelector('.dk-fin-tip');if(!tip)return;
  if(!show){tip.hidden=true;return;}
  tip.textContent=g.dataset.tip||'';tip.hidden=false;
  const fr=fig.getBoundingClientRect(),gr=g.getBoundingClientRect();
  tip.style.left=Math.max(0,Math.min(fr.width-tip.offsetWidth,gr.left-fr.left+gr.width/2-tip.offsetWidth/2))+'px';
  tip.style.top=Math.max(0,gr.top-fr.top-tip.offsetHeight-6)+'px';
}
// noPri — в «Решении» primary-кнопка одна (у вывода), кнопки панели — вторичные.
function deskPosPanel(p,it,noPri){
  const c=p.calc,s=it.s;if(!c)return '';
  const act=deskPosAct(p,s,p.earn!=null?p.earn:sigEarnDays(p.sym)),trail=s?deskTrailStop(p.side,p.stop,c.now,s.atr):null,sug=s&&s.plans&&s.plans[p.side];
  const ed=DESK_UI.edit&&DESK_UI.edit.key===p.tab+'|'+p.tk;
  const canT=can('action.edit_trades'),k=dkEsc(p.tab),t=dkEsc(p.tk);
  return `<div class="dk-panel"><div class="dk-ph"><h2>${RT('Открытая позиция','Open position')}</h2>${dkSide(p.side)}<span class="dk-note dk-ml">${dkEsc(TAB_LABEL(p.tab))}</span></div>
    <div class="dk-plan-box"><div class="dk-row">${dkActPill(act.act)}<span class="dk-ink2">${dkEsc(act.note)}</span></div>
      <div class="dk-plan-row"><div class="e"><div class="dk-lbl"><span${dkG('avg')}>${RT('Средняя','Average')}</span>${p.opened?' · '+dkEsc(p.opened):''}</div><b class="dk-num">${dkPx(p.entry)}</b><div class="dk-mut dk-xs dk-num">${dkN(p.qty,0)} ${RT('шт','sh')}</div></div>
        <div class="s"><div class="dk-lbl"><span${dkG('stop')}>${RT('Стоп','Stop')}</span>${p.stop0&&p.stop0!==p.stop?` · <span${dkG('stop0')}>${RT('был ','was ')}${dkPx(p.stop0)}</span>`:''}</div><b class="dk-num">${p.stop?dkPx(p.stop):'—'}</b><div class="dk-mut dk-xs dk-num">${c.toStopPct!=null?RT('до стопа ','to stop ')+dkN(c.toStopPct,1)+'%':''}</div></div>
        <div class="t"><div class="dk-lbl"${dkG('target')}>${RT('Цель','Target')}</div><b class="dk-num">${p.target?dkPx(p.target):'—'}</b><div class="dk-mut dk-xs dk-num">${c.toTargetPct!=null?RT('до цели ','to target ')+dkN(c.toTargetPct,1)+'%':''}</div></div></div>
      <div class="dk-kv dk-p0"><span class="dk-lbl"${dkG('pl-open')}>P&amp;L</span><span class="v dk-num ${c.plSEK>=0?'dk-up':'dk-dn'}">${dkPct(c.plPct)} · ${c.plSEK>=0?'+':''}${dkKr(c.plSEK)}</span><span class="dk-lbl"${dkG('r-now')}>${RT('R сейчас (от стопа входа)','R now (from entry stop)')}</span><span class="v dk-num">${dkR(c.rNow)}</span><span class="dk-lbl"${dkG('pos-risk')}>${RT('Открытый риск до стопа','Open risk to stop')}</span><span class="v dk-num">${c.riskSEK!=null?dkKr(c.riskSEK):'—'}</span></div>
      ${ed?deskEditForm(p):''}${DESK_UI.fix&&DESK_UI.fix.key===p.tab+'|'+p.tk?deskFixForm(p):''}
      ${canT?`<div class="dk-row">${!p.stop&&sug?`<button class="dk-btn${noPri?'':' pri'} dk-sm" data-a="pm-accept" data-tab="${k}" data-k="${t}" data-stop="${sug.stop}" data-target="${sug.target}" title="${RT('Стоп и цель из плана v2 этой стороны','Stop & target from the v2 plan of this side')}">${RT('Принять стоп','Accept stop')} ${dkPx(sug.stop)} · ${RT('цель','target')} ${dkPx(sug.target)}</button>`:''}
        ${p.stop&&c.rNow!=null&&c.rNow>=1&&(p.side==='short'?p.stop>p.entry:p.stop<p.entry)?`<button class="dk-btn dk-sm" data-a="pm-be" data-tab="${k}" data-k="${t}">${RT('Стоп в б/у','Stop to b/e')}</button>`:''}
        ${p.stop&&trail!=null?`<button class="dk-btn dk-sm" data-a="pm-trail" data-tab="${k}" data-k="${t}" data-stop="${trail}">${RT('Трейл 2·ATR','Trail 2·ATR')} → ${dkPx(trail)}</button>`:''}
        <button class="dk-btn dk-sm" data-a="pm-edit" data-tab="${k}" data-k="${t}">${RT('Стоп/цель…','Stop/target…')}</button>
        <button class="dk-btn dk-sm" data-a="close" data-tab="${k}" data-k="${t}" data-key="${dkEsc(it.key)}">${p.side==='short'?RT('Откупить…','Cover…'):RT('Продать…','Sell…')}</button>
        <button class="dk-btn dk-sm" data-a="pos-fix" data-tab="${k}" data-k="${t}" title="${RT('Кол-во и средняя без записи сделки — сверка с брокером','Qty and average without a trade record — broker reconciliation')}">${RT('Исправить позицию…','Fix position…')}</button></div>`:''}
      ${can('view.trades')?deskPosTradesHTML(p):''}
    </div></div>`;
}
// История сделок бумаги в её портфеле (карта §3.4): блок классики pfTradesHTML(tk) — записи журнала с удалением.
function deskPosTradesHTML(p){
  const n=(PF_TRADES||[]).filter(t=>(t.tab||PF3_KEY)===p.tab&&String(t.tk||'').toUpperCase()===String(p.tk).toUpperCase()).length;
  return `<details class="dk-how"${dkDetAttr('st-trades')}><summary>${RT('История сделок','Trade history')} · ${n}</summary><div class="dk-how-b">${deskClassicBox(deskWithCtx(p.tab,()=>pfTradesHTML(p.tk)))}</div></details>`;
}
// «Исправить позицию…» (карта §3.4, решение 1 — ✏️ «Моя позиция» классики): кол-во и средняя в строке портфеля без
// записи сделки. Журнал, налоги и кэш не меняются; кол-во 0 закрывает позицию и снимает её мету (стоп/цель/сторона).
function deskPosFix(tab,tk,qty,avg){
  if(!can('action.edit_trades'))return {err:RT('Нет права вносить сделки','No permission to record trades')};
  const d=DATA[tab],t=posTk(tk);if(!d||!pf3MyPort(tab))return {err:RT('Выберите портфель','Select a portfolio')};
  const ri=d.rows.findIndex(r=>posTk(r[2])===t);if(ri<0)return {err:RT('Нет позиции','No position')};
  if(!(qty>=0)||(qty>0&&!(avg>0)))return {err:RT('Кол-во ≥ 0, средняя > 0','Qty ≥ 0, average > 0')};
  const r=d.rows[ri];r[6]=Math.round(qty*1e6)/1e6;if(qty>0)r[9]=avg;
  if(!(qty>0)){   // как закрытие в deskExecApply: правило плана позиции исполнено, мета снята (иначе bookcheck слал бы алерты по нему)
    const m=posMetaGet(tab,t),rule=m&&m.planId&&(PLAN_RULES||[]).find(x=>x.id===m.planId);
    if(rule){rule.done=true;rule.hitAt=0;planRuleNorm(rule);}
    posMetaDel(tab,t);
  }
  recalcPF(ri,tab);scheduleSave();
  return {ok:true};
}
function deskFixForm(p){
  const F=DESK_UI.fix||{},qv=F.qty!=null?F.qty:p.qty,av=F.avg!=null?F.avg:p.entry;
  return `<div class="dk-edit"><label>${RT('Кол-во','Qty')} <input class="dk-inp dk-num" id="dkFxQty" type="number" step="any" min="0" value="${dkEsc(qv)}"></label><label>${RT('Средняя','Average')} (${dkEsc(p.ccy)}) <input class="dk-inp dk-num" id="dkFxAvg" type="number" step="any" min="0" value="${dkEsc(av)}"></label>
    <button class="dk-btn pri dk-sm" data-a="pos-fix-save" data-tab="${dkEsc(p.tab)}" data-k="${dkEsc(p.tk)}">${RT('Сохранить','Save')}</button><button class="dk-btn dk-sm" data-a="pos-fix-x">${RT('Отмена','Cancel')}</button>
    <div class="dk-warn">⚠ ${RT('Без записи сделки: журнал, налоги (K4) и кэш не меняются — только сверка с брокером. Покупку или продажу вносите через «Исполнить…» / «Продать…».','No trade record: the journal, tax (K4) and cash stay unchanged — broker reconciliation only. Record a buy or sale via “Execute…” / “Sell…”.')}</div></div>`;
}
function deskEditForm(p){
  const E=DESK_UI.edit||{},sv=E.stop!=null?E.stop:(p.stop||''),tv=E.target!=null?E.target:(p.target||'');
  return `<div class="dk-edit"><label>${RT('Стоп','Stop')} <input class="dk-inp dk-num" id="dkEdStop" type="number" step="any" value="${dkEsc(sv)}"></label><label>${RT('Цель','Target')} <input class="dk-inp dk-num" id="dkEdTgt" type="number" step="any" value="${dkEsc(tv)}"></label>
    <button class="dk-btn pri dk-sm" data-a="pm-save" data-tab="${dkEsc(p.tab)}" data-k="${dkEsc(p.tk)}">${RT('Сохранить','Save')}</button><button class="dk-btn dk-sm" data-a="pm-cancel">${RT('Отмена','Cancel')}</button>
    <div class="dk-note">${RT('Стоп входа (stop0) не меняется — R считается от него. Пустое поле стирает значение.','The entry stop (stop0) stays — R is measured from it. An empty field clears the value.')}</div></div>`;
}

// ═══════════════════ Позиции ═══════════════════
// S7b-2 (plans/s7b-map.md §3.3): разделы книги вместо под-вкладок классики. Разделы про один портфель (всё, кроме
// «Позиций» и «Структуры») из «Все портфели» показывают портфель риска — подпись deskOneNote это говорит.
function deskBookSecs(port){
  const aip=port===AIP_KEY;
  return [['pos','📋 '+RT('Позиции','Positions'),true],
    ['struct','🏭 '+RT('Структура','Breakdown'),can('view.sectors')||can('view.type')||can('view.diversification')],
    ['cal','📅 '+RT('Дивиденды и отчёты','Dividends & earnings'),!aip&&can('view.dividends')],
    ['health','🩺 '+RT('Состояние','Health'),can('view.health')],
    ['stats','📊 '+RT('Статистика','Statistics'),!aip&&isAdmin()&&deskOnePort()===PF3_KEY],
    ['trades','📜 '+RT('Сделки AI','AI trades'),aip&&can('view.trades')],
    ['ai','🤖 AI',aip?can('view.ai_proto')||isAdmin():can('view.ai_proto')||can('view.suggestion')||isAdmin()]].filter(x=>x[2]);
}
const deskOneNote=()=>deskPort()==='all'?`<p class="dk-note dk-mb">${RT(`Раздел ведётся по одному портфелю — показан «${dkEsc(TAB_LABEL(deskOnePort()))}». Другой — в выборе портфеля в шапке.`,`This section covers one portfolio — showing “${dkEsc(TAB_LABEL(deskOnePort()))}”. Pick another in the header.`)}</p>`:'';
const deskClassicBox=(html,cls)=>`<div class="dk-classic${cls?' '+cls:''}">${html}</div>`;
function deskBookHTML(){
  const port=deskPort();
  if(port===AIP_KEY)try{aipSyncTab();}catch(e){}   // позиции AI-портфеля материализуются в DATA[AIP_KEY] (как на вкладке классики)
  const tabs=port==='all'?deskPorts():(port?[port]:[]);
  if(!tabs.length)return `<div class="dk-panel dk-empty">${RT('Нет доступных портфелей.','No portfolios available.')}</div>`;
  const S=deskBookSecs(port),bt=S.some(x=>x[0]===DESK_UI.bt)?DESK_UI.bt:'pos';
  const seg=`<div class="dk-seg dk-mb dk-seg-wrap" role="tablist" aria-label="${RT('Раздел книги','Book section')}">${S.map(([v,l])=>`<button class="${bt===v?'on':''}" data-a="bt" data-v="${v}" role="tab" aria-selected="${bt===v}">${l}</button>`).join('')}</div>`;
  const one=deskOnePort();
  let body='';
  try{
    if(bt==='pos')body=deskBookPosHTML(tabs,port);
    else if(bt==='struct')body=deskStructHTML(tabs,port);
    else if(bt==='cal'){deskCtx(one,'cal');body=deskOneNote()+deskClassicBox(pf3CalendarHTML());}
    else if(bt==='health'){deskCtx(one,'health');body=deskOneNote()+deskClassicBox(pf3HealthTab());}
    else if(bt==='stats'){deskCtx(PF3_KEY,'stats');body=deskClassicBox(pfPerfHTML()+pfCmpHTML()+pfDeepCmpHTML());}
    else if(bt==='trades'){deskCtx(AIP_KEY,'trades');body=deskClassicBox(pfTradesHTML());}
    else if(bt==='ai')body=deskBookAiHTML(port===AIP_KEY?AIP_KEY:one);
  }catch(e){console.error(e);body=`<div class="dk-panel dk-empty">${RT('Ошибка раздела: ','Section error: ')}${dkEsc(e.message||e)}</div>`;}
  return seg+body;
}
// «Позиции → AI» (карта §3.3): AI Proto, Предложение, Анализ воркера, AI-прогноз; у AI-портфеля — AI-прогноз и Управление AI.
function deskBookAiHTML(tab){
  const aip=tab===AIP_KEY;
  const L=(aip?[['fcast','✨ '+RT('AI-прогноз','AI forecast'),isAdmin()],['aim','🤖 '+RT('Управление AI','AI controls'),can('view.ai_proto')||isAdmin()]]
    :[['proto','🤖 AI Proto',can('view.ai_proto')],['prop','⚖️ '+RT('Предложение','Proposal'),can('view.suggestion')],['analysis','📈 '+RT('Анализ','Analysis'),can('view.ai_proto')],['fcast','✨ '+RT('AI-прогноз','AI forecast'),isAdmin()]]).filter(x=>x[2]);
  if(!L.length)return `<div class="dk-panel dk-empty">${RT('Нет доступа к AI-разделам.','No access to AI sections.')}</div>`;
  const v=L.some(x=>x[0]===DESK_UI.bai)?DESK_UI.bai:L[0][0];
  const seg=L.length>1?`<div class="dk-seg dk-mb" role="tablist" aria-label="AI">${L.map(([k,l])=>`<button class="${v===k?'on':''}" data-a="bai" data-v="${k}" role="tab" aria-selected="${v===k}">${l}</button>`).join('')}</div>`:'';
  deskCtx(tab,v==='proto'?'ai':v);
  const d=DATA[tab];
  const html=v==='proto'?pf3AiHTML():v==='prop'?pf3PropHTML():v==='analysis'?pf3AnalysisHTML():v==='fcast'?`<section class="pf3-panel">${pf3FcastAiHTML(d)}</section>`:aipManageHTML();
  return seg+(aip?'':deskOneNote())+`<p class="dk-note dk-mb">${RT('AI — отдельное мнение: правила SIG и вердикты «Решения» оно не меняет.','AI is a separate opinion: it changes neither SIG rules nor Decision verdicts.')}</p>`+deskClassicBox(html);
}
// «Позиции → Структура»: группы по сектору и типу — строки desk (не классический список с колонками старых движков),
// диверсификация по GICS — блок классики для одного портфеля.
function deskStructHTML(tabs,port){
  const P=deskBook(),row=p=>{const d=DATA[p.tab];return d&&d.rows.find(r=>posTk(r[2])===p.tk);};
  const X=P.map(p=>{const r=row(p);return {p,sec:r?String(r[4]||''):'',typ:r?String(r[5]||''):''};});
  const val=x=>x.p.calc?x.p.calc.valueSEK:0,pl=x=>x.p.calc?x.p.calc.plSEK:0;
  const block=(key,title,ico)=>{
    const G=deskGroups(X.map(x=>({g:key==='sec'?x.sec:x.typ,valueSEK:val(x),plSEK:pl(x)})));
    const rows=G.map(g=>{const mem=X.filter(x=>((key==='sec'?x.sec:x.typ).trim()||'—')===g.g).sort((a,b)=>Math.abs(val(b))-Math.abs(val(a)));
      return `<details class="dk-grp"><summary><span class="dk-grp-n">${ico(g.g)} ${dkEsc(T(g.g))}</span><span class="dk-num dk-mut">${g.n}</span><span class="dk-num">${dkKr(g.valueSEK)}</span><span class="dk-grp-w"><span class="dk-bar"><i style="width:${dkCssPct(g.weightPct)}%"></i></span><b class="dk-num">${g.weightPct!=null?dkN(g.weightPct,1)+' %':'—'}</b></span><span class="dk-num ${g.plSEK>=0?'dk-up':'dk-dn'}">${g.plSEK>=0?'+':''}${dkKr(g.plSEK)}</span></summary>
        <div class="dk-grp-b">${mem.map(x=>`<div class="dk-att" data-a="open" data-k="${dkEsc(x.p.sym+'|'+x.p.ccy)}"><div class="dk-row"><span class="dk-tk">${dkEsc(x.p.tk)}</span><span class="dk-nm">${dkEsc(x.p.name)}</span>${x.p.side==='short'?dkSide('short'):''}${port==='all'?`<span class="dk-note">${dkEsc(TAB_LABEL(x.p.tab))}</span>`:''}<span class="dk-num dk-ml">${dkKr(val(x))}</span><span class="dk-num ${x.p.calc&&x.p.calc.plPct>=0?'dk-up':'dk-dn'}">${x.p.calc?dkPct(x.p.calc.plPct):'—'}</span></div></div>`).join('')}</div></details>`;}).join('');
    return `<div class="dk-panel dk-mb"><div class="dk-ph"><h2>${title}</h2><span class="dk-cnt">${G.length}</span><span class="dk-note dk-ml">${RT('стоимость по модулю · доля от суммы позиций','absolute value · share of all positions')}</span></div>
      ${G.length?`<div class="dk-grp-h"><span>${RT('Группа','Group')}</span><span>${RT('Поз.','Pos.')}</span><span>${RT('Стоимость','Value')}</span><span>${RT('Доля','Share')}</span><span>P&amp;L</span></div>${rows}`:`<div class="dk-empty">${RT('Открытых позиций нет.','No open positions.')}</div>`}</div>`;
  };
  const one=deskOnePort(),dv=can('view.diversification')&&pf3IsPort(one);
  if(dv)deskCtx(one,'alloc');
  return (can('view.sectors')?block('sec','🏭 '+RT('По секторам','By sector'),g=>secIcon(g)):'')
    +(can('view.type')?block('typ','🏷 '+RT('По типам','By type'),g=>PF3_TYPE_META[g]?PF3_TYPE_META[g][0]:'🏷'):'')
    +(dv?deskOneNote()+deskClassicBox(pf3DiversHTML()):'');
}
// Сводка «Позиций» одного портфеля (карта §3.3 «Сводка»): кэш и плечо с правкой, P/L за всё время с реализованным,
// пре/пост баланса (поллер pfSumPP — deskClassicAfter), курсы. Для «Все портфели» — суммы без правки.
function deskBookPosHTML(tabs,port){
  const P=deskBook();
  const L=P.filter(p=>p.side!=='short'),S=P.filter(p=>p.side==='short'),sum=(a,f)=>a.reduce((x,p)=>x+(f(p)||0),0);
  const lv=sum(L,p=>p.calc&&p.calc.valueSEK),sv=sum(S,p=>p.calc&&p.calc.valueSEK),pl=sum(P,p=>p.calc&&p.calc.plSEK);
  const rs=tabs.map(t=>bookRiskState(t)),risk=sum(rs,r=>r.openRiskSEK),cap=sum(rs,r=>r.capSEK),eq=sum(rs,r=>r.equitySEK),riskPct=eq>0?risk/eq*100:0,capPct=deskNorm(DESK).riskCapPct;
  const cash=tabs.reduce((a,t)=>a+(parseFloat(DATA[t].cashFree)||0)*pf3BaseFx(DATA[t]),0),noStop=P.filter(p=>!p.stop).length;
  const kpi=(l,v,d,cls)=>`<div class="dk-panel dk-stat"><div class="dk-lbl">${l}</div><div class="dk-v dk-num ${cls||''}">${v}</div><div class="dk-d">${d}</div></div>`;
  const one=port!=='all'?port:null,d1=one&&DATA[one],edit=!!(d1&&pf3MyPort(one)&&can('action.edit_trades'));
  if(one)deskCtx(one,'list');   // pf3SetNum пишет в pf3D()
  // P/L за всё время — как сводка классики: открытые + реализованные по журналу, % — от всех вложений (себестоимость
  // текущих позиций + проданных лотов).
  const realized=tabs.reduce((a,t)=>a+pfTotalRealizedSEK(t),0),allTime=pl+realized;
  const allCost=sum(P,p=>(p.entry||0)*p.qty*(FX[p.ccy]||1))+tabs.reduce((a,t)=>a+pfTotalRealizedCostSEK(t),0);
  const unit=d1?pf3BaseUnit(d1):'kr',free=d1?(parseFloat(d1.cashFree)||0):0,lev=one===PF3_KEY?(parseFloat(d1.leverage)||0):0;
  const numIn=(key,v,lbl)=>`<input class="dk-inp dk-num dk-kpi-in" type="number" step="any" min="0" value="${dkEsc(v)}" onchange="pf3SetNum('${key}',this.value)" aria-label="${dkEsc(lbl)}">`;
  const cashV=edit?`${numIn('cashFree',free,RT('Свободный кэш','Free cash'))} <small>${dkEsc(unit)}</small>`:dkKr(cash);
  // Плечо — только «Портфель 3.0» (как сводка классики): строкой в KPI «Кэш», не отдельной плиткой.
  const levL=one===PF3_KEY&&can('data.show_leverage')?`<div class="dk-kpi-sub">${RT('плечо','leverage')} ${edit?numIn('leverage',lev,RT('Кредитное плечо','Leverage'))+' '+dkEsc(unit):dkKr(lev*pf3BaseFx(d1))} · ${RT('с плечом ','with leverage ')}${dkKr(eq+lev*pf3BaseFx(d1))}</div>`:'';
  const fxChip=c=>typeof FX[c]==='number'?`<span class="dk-chip dk-num">1 ${c} = ${dkN(FX[c],2)} kr</span>`:'';
  const strip=port===AIP_KEY?'':`<div class="dk-row dk-mb dk-strip">${one?`<div id="pfSumPP" class="pf3-pp pfsum-pp">${pfSumPPInner(d1)}</div>`:''}<span class="dk-lbl">💱 ${RT('Курсы','FX')}</span>${fxChip('USD')+fxChip('EUR')+fxChip('NOK')+fxChip('DKK')+fxChip('GBP')}<span class="dk-note">${RT('ECB · база SEK','ECB · SEK base')}${dkEsc(fxFreshLbl())}</span></div>`;
  return `<div class="dk-expo">
      ${kpi(RT('Нетто экспозиция','Net exposure')+dkGi('net'),dkKr(lv-sv),RT('лонг − шорт','long − short'))}
      ${kpi(RT('Брутто','Gross')+dkGi('gross'),dkKr(lv+sv),`${L.length} ${RT('лонг','long')} · ${S.length} ${RT('шорт','short')}`)}
      ${kpi(RT('P&L открытых','Open P&L')+dkGi('pl-open'),(pl>=0?'+':'')+dkKr(pl),RT('по текущим ценам','at current prices'),pl>=0?'dk-up':'dk-dn')}
      ${kpi(RT('P/L за всё время','All-time P/L')+dkGi('pl-all'),(allTime>=0?'+':'')+dkKr(allTime),(allCost>0?dkPct(allTime/allCost*100,1)+' '+RT('от всех вложений','on all invested')+' · ':'')+RT('реализовано ','realized ')+(realized>=0?'+':'')+dkKr(realized),allTime>=0?'dk-up':'dk-dn')}
      ${kpi(RT('Открытый риск','Open risk')+dkGi('open-risk'),dkKr(risk),`${dkN(riskPct,1)}% ${RT('капитала · лимит','of equity · cap')} ${capPct}% <span class="dk-bar"><i style="width:${cap>0?Math.min(100,risk/cap*100).toFixed(0):0}%;${risk>cap?'background:var(--dk-short)':''}"></i></span>${noStop?`<br><span class="dk-flag">${noStop} ${RT('без стопа — риск не учтён','without stop — risk not counted')}</span>`:''}`,risk>cap?'dk-dn':'')}
      ${kpi(RT('Кэш','Cash')+dkGi('equity'),cashV,RT('капитал ','equity ')+dkKr(eq)+(edit?' · '+RT('правка — без сделки','edit — no trade'):'')+levL)}
    </div>${strip}${port===AIP_KEY?`<p class="dk-note dk-mb">🤖 ${RT('AI-портфель ведёт воркер по своей стратегии — здесь только просмотр: без исполнения, правки и риска книги.','The worker runs the AI portfolio by its strategy — view only here: no execution, edits or book risk.')}</p>`:''}
    <div class="dk-panel dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Бумага','Stock')}</th><th>${RT('Сторона','Side')}</th><th class="r">${RT('Кол-во','Qty')}</th><th class="r"${dkG('avg')}>${RT('Средняя','Avg')}</th><th class="r">${RT('Сейчас','Now')}</th><th class="r"${dkG('pl-open')}>P&amp;L</th><th class="r"${dkG('stop')}>${RT('Стоп','Stop')}</th><th class="r"${dkG('target')}>${RT('Цель','Target')}</th><th${dkG('progress')}>${RT('Стоп ◆ цена → цель','Stop ◆ price → target')}</th><th class="r"${dkG('r-now')}>${RT('R сейчас','R now')}</th><th class="r"${dkG('pos-risk')}>${RT('Риск','Risk')}</th><th${dkG('pos-act')}>${RT('Действие','Action')}</th></tr></thead><tbody>
      ${P.length?P.map(p=>{const c=p.calc||{};const prog=c.progress,pe=p.stop&&p.target&&p.target!==p.stop?Math.max(0,Math.min(1,(p.side==='short'?-1:1)*(p.entry-p.stop)/Math.abs(p.target-p.stop))):null;
        return `<tr class="dk-tr" data-a="open" data-k="${dkEsc(p.sym+'|'+p.ccy)}"><td><span class="dk-tk">${dkEsc(p.tk)}</span><span class="dk-nm">${dkEsc(p.name)}</span>${port==='all'?`<div class="dk-note">${dkEsc(TAB_LABEL(p.tab))}</div>`:''}</td><td>${dkSide(p.side)}</td><td class="r dk-num">${dkN(p.qty,0)}</td><td class="r dk-num">${dkPx(p.entry)}</td><td class="r dk-num">${dkPx(c.now)}</td>
          <td class="r dk-num dk-b ${c.plSEK>=0?'dk-up':'dk-dn'}">${dkPct(c.plPct)}<br><span class="dk-mut dk-xs">${c.plSEK>=0?'+':''}${dkKr(c.plSEK)}</span></td>
          <td class="r dk-num dk-dn">${p.stop?dkPx(p.stop):'—'}<br><span class="dk-mut dk-xs">${c.toStopPct!=null?dkN(c.toStopPct,1)+'%':''}</span></td><td class="r dk-num dk-up">${p.target?dkPx(p.target):'—'}<br><span class="dk-mut dk-xs">${c.toTargetPct!=null?dkN(c.toTargetPct,1)+'%':''}</span></td>
          <td>${prog!=null?`<span class="dk-track"${dkG('progress')}>${pe!=null?`<b style="left:${Math.round(pe*100)}%"></b>`:''}<i class="${c.toStopPct!=null&&c.toStopPct<=2?'danger':''}" style="left:${Math.round(prog*100)}%"></i></span>`:'<span class="dk-mut">—</span>'}</td>
          <td class="r dk-num">${dkR(c.rNow)}</td><td class="r dk-num">${c.riskSEK!=null?dkKr(c.riskSEK):'—'}</td><td>${dkActPill(p.act)}<div class="dk-note">${dkEsc(p.note)}</div></td></tr>`;}).join(''):`<tr><td colspan="12" class="dk-empty">${RT('Открытых позиций нет.','No open positions.')}</td></tr>`}
    </tbody></table></div>
    <p class="dk-note dk-mt14">${RT('Позиция = строка портфеля (кол-во и средняя — как в налоге, genomsnittsmetoden) + сторона/стоп/цель. P&L шорта зеркальный; «R сейчас» — ход в единицах начального риска (средняя − стоп входа), перенос стопа его не меняет. Открытый риск считается до текущих стопов и сравнивается с лимитом книги; позиции без стопа в нём не учтены.','Position = portfolio row (qty and average as in tax, genomsnittsmetoden) + side/stop/target. Short P&L is mirrored; “R now” is the move in units of the initial risk (average − entry stop), moving the stop does not change it. Open risk is measured to current stops against the book cap; positions without a stop are not counted.')}</p>`;
}

// ═══════════════════ Журнал ═══════════════════
// S7b-2: «Записи» (журнал PF_TRADES с ручной записью, удалением и импортом CSV), «Налоги» (K4, genomsnittsmetoden),
// «AI-разборы» (админ) — блоки классики для одного портфеля; «Планы» — таблица desk + редактор классики.
function deskJournalHTML(){
  const T=[['mine',RT('Мои сделки','My trades'),dkG('trips'),true],['trades',RT('Записи','Records'),'',can('view.trades')],['plans',RT('Планы','Plans'),dkG('plans'),true],
    ['tax',RT('Налоги','Tax'),'',can('view.trades')],['rules',RT('Бэктест правил','Rules backtest'),dkG('backtest'),true],['ideas',RT('Наблюдения','Tracked ideas'),dkG('journal-ideas'),true],
    ['stkai',RT('AI-разборы','AI reviews'),'',isAdmin()]].filter(x=>x[3]);
  const jt=T.some(x=>x[0]===DESK_UI.jt)?DESK_UI.jt:'mine';
  const seg=`<div class="dk-seg dk-mb dk-seg-wrap" role="tablist">${T.map(([v,l,g])=>`<button class="${jt===v?'on':''}" data-a="jt" data-v="${v}" role="tab" aria-selected="${jt===v}"${g}>${l}</button>`).join('')}</div>`;
  let body='';
  try{
    const noPort=`<div class="dk-panel dk-empty">${RT('Нет доступных портфелей.','No portfolios available.')}</div>`;
    if(jt==='trades')body=deskCtx(deskOnePort(),'trades')?deskOneNote()+deskClassicBox(pfTradesHTML()):noPort;
    else if(jt==='tax')body=deskCtx(deskOnePort(),'tax')?deskOneNote()+deskClassicBox(pfTaxHTML()):noPort;
    else if(jt==='stkai')body=deskClassicBox(stkLogHTML());
    else body=jt==='rules'?deskRulesHTML():jt==='plans'?deskPlansHTML():jt==='ideas'?deskJournalIdeasHTML():deskMineHTML();
  }catch(e){console.error(e);body=`<div class="dk-panel dk-empty">${RT('Ошибка раздела: ','Section error: ')}${dkEsc(e.message||e)}</div>`;}
  return seg+body;
}
// ── P5b: «Наблюдения» — исходы явно отмеченных идей (§7): группы по версиям/стороне/горизонту и записи ──
const DK_J_WHY={
  'session-unknown':()=>RT('время сессии биржи неизвестно','exchange session time unknown'),
  window:()=>RT('история не доходит до даты записи','history does not reach the record date'),
  'wait-session':()=>RT('ждёт первой сессии после записи','waits for the first session after the record'),
  'bar-open':()=>RT('сессия ещё не закрыта','session not closed yet'),
  entry:()=>RT('ждёт входа','waits for the entry'),
  'bench-loading':()=>RT('ждёт свечей индекса','waits for index candles'),
  'entry-bar-gone':()=>RT('бара входа нет в свежей истории','the entry bar is missing from fresh history'),
  'history-ended':()=>RT('история бумаги закончилась (делистинг?)','the stock’s history ended (delisted?)'),
  'price-basis':()=>RT('цены пересчитаны задним числом (сплит?) — несопоставимо','prices restated retroactively (split?) — not comparable'),
  'split-suspect':()=>RT(`дневной скачок больше ×${dkN(DESK_JOURNAL_CFG.jumpX,1)} — возможен сплит, несопоставимо`,`a one-day move beyond ×${dkN(DESK_JOURNAL_CFG.jumpX,1)} — possible split, not comparable`),
  'no-bench':()=>RT('без индекса — только абсолютный результат','no index — absolute result only'),
  'bench-date':()=>RT('у индекса нет той же даты — альфы нет','the index lacks the same date — no alpha'),
  'no-costs':()=>RT('сумма не зафиксирована при записи — net нет','no amount fixed at record time — no net'),
  'cost-version':()=>RT('модель комиссии сменилась после записи — net нет','fee model changed since the record — no net'),
  'no-fee-model':()=>RT('модели комиссии нет — net нет','no fee model — no net'),
  corrupt:()=>RT('журнал на этом устройстве повреждён','the journal on this device is damaged'),
  version:()=>RT('журнал записан более новой версией приложения','the journal was written by a newer app version')};
const dkJWhy=c=>DK_J_WHY[c]?DK_J_WHY[c]():String(c||'—');
const dkJBucket=k=>{const d=DK_BUCKET_DEF.find(x=>x[0]===k);return d?d[1]():RT('вне подборок','no bucket');};
function dkJEntry(r){
  const e=r.entry;
  if(!e)return `<span class="dk-mut">${RT('ещё не считался','not computed yet')}</span>`;
  if(e.status==='fixed')return `<span class="dk-num">${dkPx(e.price)}</span><div class="dk-note dk-num">${dkEsc(e.date)}${e.warn?' · ⚠ '+RT('масштаб цены','price scale'):''}</div>`;
  return `<span class="dk-mut">${dkEsc(dkJWhy(e.why))}${e.date?' · '+dkEsc(e.date):''}</span>`;
}
function dkJCell(x){
  if(!x||x.status==='pending')return `<span class="dk-mut">${x&&x.why==='wait-bars'&&x.left?RT(`ещё ${x.left} торг. дн.`,`${x.left} trading d left`):dkEsc(dkJWhy(x&&x.why||'entry'))}</span>`;
  if(x.status!=='complete')return `<span class="dk-mut">${RT('нет результата','no result')}</span><div class="dk-note">${dkEsc(dkJWhy(x.why))}${x.raw!=null?' · '+RT('сырое ','raw ')+dkPct(x.raw,1):''}</div>`;
  const sub=[x.alpha!=null?'α '+dkPct(x.alpha,1):x.alphaWhy==='no-bench'?RT('без индекса','no index'):RT('α нет','no α'),x.net!=null?'net '+dkPct(x.net,1):null].filter(Boolean).join(' · ');
  return `<b class="dk-num ${x.value>=0?'dk-up':'dk-dn'}">${dkPct(x.value,1)}</b><div class="dk-note dk-num">${sub}</div>`;
}
function deskJournalIdeasHTML(){
  const C=DESK_JOURNAL_CFG,H=C.horizons;
  if(!can('view.portfolio'))return `<div class="dk-panel dk-empty">${RT('Нет доступа к портфелю.','No portfolio access.')}</div>`;
  if(!deskJournalKey())return `<div class="dk-panel dk-empty">${RT('Наблюдения хранятся на этом устройстве для вашего аккаунта — войдите, чтобы отслеживать идеи.','Tracked ideas are stored on this device for your account — sign in to track ideas.')}</div>`;
  const R=deskJournalCur();
  if(R.error)return `<div class="dk-warn">⚠ ${dkEsc(dkJWhy(R.error))}. ${RT('Запись и расчёт отключены, чтобы не затереть его. Экспорт недоступен: данные не читаются.','Recording and computing are off so it is not overwritten. Export is unavailable: the data cannot be read.')}</div>`;
  const items=R.items.filter(Boolean),Q=deskJournalQuotaState(items,C),done=items.filter(r=>r.status==='complete').length;
  const busy=Object.keys(_deskPool.live).filter(k=>k.indexOf('jhist|')===0).length;
  const kpi=(l,v,d)=>`<div class="dk-panel dk-stat"><div class="dk-lbl">${l}</div><div class="dk-v dk-num">${v}</div><div class="dk-d">${d}</div></div>`;
  const quota=Q.atLimit?`<div class="dk-warn">⚠ ${RT(`Журнал заполнен (${Q.count} из ${Q.maxRecords} записей · ${dkN(Q.bytes/1000,0)} из ${dkN(Q.maxBytes/1000,0)} КБ) — новые наблюдения не записываются. Экспортируйте журнал и очистите завершённые; ожидающие не удаляются.`,`The journal is full (${Q.count} of ${Q.maxRecords} records · ${dkN(Q.bytes/1000,0)} of ${dkN(Q.maxBytes/1000,0)} KB) — new ideas are not recorded. Export the journal and clear completed ones; pending ones are never removed.`)}</div>`
    :Q.near?`<div class="dk-warn">${RT(`Журнал почти заполнен: ${Q.count} из ${Q.maxRecords} записей · ${dkN(Q.bytes/1000,0)} из ${dkN(Q.maxBytes/1000,0)} КБ.`,`The journal is almost full: ${Q.count} of ${Q.maxRecords} records · ${dkN(Q.bytes/1000,0)} of ${dkN(Q.maxBytes/1000,0)} KB.`)}</div>`:'';
  const err=DESK_UI._jErr?`<div class="dk-warn">⚠ ${RT('Расчёт не сохранён: ','The computation was not saved: ')}${dkEsc(DESK_UI._jErr)} — ${RT('журнал на устройстве не изменён.','the journal on this device is unchanged.')}</div>`:'';
  const tools=`<div class="dk-row dk-mb">${items.length?`<button type="button" class="dk-btn dk-sm" data-a="jexport">⬇ ${RT('Экспорт JSON','Export JSON')}</button>`:''}${done?`<button type="button" class="dk-btn dk-sm" data-a="jclear">🗑 ${RT(`Очистить завершённые (${done})`,`Clear completed (${done})`)}</button>`:''}${busy?`<span class="dk-chip dk-num">⏳ ${RT('свечи','candles')} ${busy}</span>`:''}<span class="dk-note dk-ml">${RT(`${Q.count} из ${Q.maxRecords} записей · хранится на этом устройстве`,`${Q.count} of ${Q.maxRecords} records · stored on this device`)}</span></div>`;
  if(!items.length)return quota+err+`<div class="dk-panel dk-empty">${RT('Наблюдений пока нет. На экране «Акция» → «Решение» нажмите «👁 Отслеживать результат» — идея попадёт сюда, а результат досчитается по истории цен.','No tracked ideas yet. On Stock → Decision press “👁 Track the outcome” — the idea lands here and its outcome is computed from price history.')}</div>`+deskJournalMethodHTML();
  const G=deskJournalGroups(items,C),side=s=>s==='short'?RT('шорт','short'):RT('лонг','long');
  const gRows=G.map(g=>{
    const head=`<td class="dk-num">${dkEsc(g.selectionVersion||'—')}<div class="dk-note">SIG ${dkEsc(g.signalVersion||'—')}</div></td><td>${side(g.side)}</td><td class="r dk-num">${g.horizon}</td>
      <td class="r dk-num">${g.n}<div class="dk-note">${RT(`${g.stocks} бум.`,`${g.stocks} st.`)}${g.pending?' · '+RT(`ждут ${g.pending}`,`${g.pending} pending`):''}${g.missingN?' · '+RT(`без рез. ${g.missingN}`,`no result ${g.missingN}`):''}</div></td>`;
    if(!g.enough)return `<tr>${head}<td colspan="5" class="dk-mut dk-jc"${dkG('few-data')}>${RT(`мало данных: ${g.n} из ${C.minGroup} — распределение не показывается`,`too little data: ${g.n} of ${C.minGroup} — no distribution shown`)}</td></tr>`;
    return `<tr>${head}<td class="r dk-num dk-b ${g.median>=0?'dk-up':'dk-dn'}">${dkPct(g.median,1)}<div class="dk-note">${dkPct(g.p25,1)} … ${dkPct(g.p75,1)}</div></td><td class="r dk-num">${dkN(g.winPct,0)} %</td><td class="r dk-num">${dkPct(g.mean,1)}</td>
      <td class="r dk-num">${g.alphaMedian!=null?dkPct(g.alphaMedian,1):`<span class="dk-mut">${RT(`мало (${g.alphaN})`,`few (${g.alphaN})`)}</span>`}</td><td class="r dk-num">${g.netMean!=null?dkPct(g.netMean,1):`<span class="dk-mut">${RT(`мало (${g.netN})`,`few (${g.netN})`)}</span>`}<div class="dk-note">${dkEsc(g.from||'')}…${dkEsc(g.to||'')}</div></td></tr>`;
  }).join('');
  const fmtT=t=>{try{return new Date(t).toLocaleString(LANG==='en'?'en-GB':'ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){return '—';}};
  const now=Date.now(),rows=items.slice().sort((a,b)=>(b.recordedAt||0)-(a.recordedAt||0)).map(r=>{
    const has=!!deskSecOf(r.key),tk=String(r.key||'').split('|')[0]||r.sym;
    // Свечи бумаги не загрузились (нет у провайдера, делистинг, сеть) — причина на виду, а не «ещё не считался».
    const fail=r.status!=='complete'&&(!r.entry||r.entry.status!=='fixed')&&_deskJFail[r.sym+':'+deskJournalRange(r,now)];
    return `<tr${has?` class="dk-tr" data-a="open" data-k="${dkEsc(r.key)}"`:''}><td><span class="dk-tk">${dkEsc(tk)}</span>${r.side==='short'?' '+dkSide('short'):''}<div class="dk-note">${dkEsc(dkJBucket(r.bucket))}</div></td>
      <td class="dk-num">${dkEsc(fmtT(r.recordedAt))}<div class="dk-note">${r.observedPrice>0?dkPx(r.observedPrice)+' '+dkCcy(r.ccy):'—'}${r.observationAsOf?'':' · '+RT('не live','not live')}</div></td>
      <td class="dk-jc">${fail?`<span class="dk-mut">${RT('история цены не загрузилась — повтор через 10 мин','price history did not load — retrying in 10 min')}</span>`:dkJEntry(r)}</td>${H.map(h=>`<td class="r dk-jc">${dkJCell(r.horizons&&r.horizons[h])}</td>`).join('')}</tr>`;
  }).join('');
  return quota+err+`<div class="dk-grid dk-g4 dk-mb">${kpi(RT('Наблюдений','Tracked')+dkGi('journal-ideas'),items.length,RT(`${done} завершено · ${items.length-done} ждут`,`${done} complete · ${items.length-done} pending`))}
      ${kpi(RT('Горизонты','Horizons')+dkGi('horizon'),H.join(' / '),RT('торговых дней от условного входа','trading days from the conditional entry'))}</div>`+tools+
    `<div class="dk-panel dk-mb"><div class="dk-ph"><h2>${RT('Итоги по группам','Group results')}${dkGi('few-data')}</h2><span class="dk-note dk-ml">${RT('версия отбора · версия SIG · сторона · горизонт — не смешиваются','selection version · SIG version · side · horizon — never mixed')}</span></div>
      <div class="dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Правила','Rules')}</th><th>${RT('Сторона','Side')}</th><th class="r"${dkG('horizon')}>${RT('Дней','Days')}</th><th class="r">${RT('Завершено','Complete')}</th><th class="r">${RT('Медиана · P25…P75','Median · P25…P75')}</th><th class="r">${RT('В плюсе','Positive')}</th><th class="r">${RT('Среднее','Mean')}</th><th class="r"${dkG('alpha')}>${RT('Альфа, медиана','Alpha, median')}</th><th class="r"${dkG('net-cost')}>${RT('Net, среднее · период','Net, mean · period')}</th></tr></thead><tbody>${gRows}</tbody></table></div></div>
    <div class="dk-panel dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Бумага · подборка','Stock · bucket')}</th><th>${RT('Записано · цена','Recorded · price')}</th><th${dkG('cond-entry')}>${RT('Условный вход','Conditional entry')}</th>${H.map(h=>`<th class="r"${dkG('horizon')}>${h} ${RT('дн','d')}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`+deskJournalMethodHTML();
}
function deskJournalMethodHTML(){
  const C=DESK_JOURNAL_CFG;
  return `<p class="dk-note dk-mt14">${RT(`Наблюдения — идеи, которые вы явно отметили «Отслеживать результат»: это выборка ваших решений, а не проверка всей вселенной и не доходность портфеля (реальные сделки — «Мои сделки», правила SIG — «Бэктест правил»). Условный вход — закрытие первой сессии биржи, начавшейся после записи; это расчётная точка, не сделка. Горизонты — ${C.horizons.join('/')} торговых дней бумаги от входа. Результат — изменение цены в валюте бумаги без дивидендов, у шорта — зеркально; альфа — минус S&P 500 (USD) или OMXS30 (SEK) за те же даты, у остальных валют — только абсолютный результат; результат в kr не считается — для него нужен исторический курс. Net — после комиссии входа и выхода на сумму «Что если?» в момент записи. Расчёт идёт, когда открыта эта вкладка: пропущенное досчитывается по истории. Меньше ${C.minGroup} завершённых в группе — «мало данных»; повторы одной бумаги с перекрывающимися окнами не независимы. Завершённые хранятся ${C.retainDays} дней, ожидающие не удаляются.`,
    `Tracked ideas are the ones you explicitly marked “Track the outcome”: a sample of your decisions, not a test of the whole universe and not portfolio return (real trades — “My trades”, SIG rules — “Rules backtest”). The conditional entry is the close of the first exchange session that starts after the record — a computed point, not a trade. Horizons are ${C.horizons.join('/')} trading days of the stock from the entry. The result is the price change in the stock’s currency without dividends, mirrored for shorts; alpha subtracts the S&P 500 (USD) or OMXS30 (SEK) over the same dates, other currencies get the absolute result only; no SEK result — that needs historical FX. Net is after entry and exit fees on the “What if?” amount at record time. Computation runs while this tab is open: missed days are caught up from history. Fewer than ${C.minGroup} completed in a group — “too little data”; repeats of one stock with overlapping windows are not independent. Completed ones are kept ${C.retainDays} days, pending ones are never removed.`)}</p>`;
}
function deskMineHTML(){
  const port=deskPort(),tabs=port==='all'?deskPorts():(port?[port]:[]);
  if(!can('view.trades'))return `<div class="dk-panel dk-empty">${RT('Нет доступа к сделкам.','No access to trades.')}</div>`;
  const T=deskRoundTrips((PF_TRADES||[]).filter(t=>tabs.includes(t.tab||PF3_KEY))),S=deskJournalStats(T,FX),showPl=can('data.show_trades_pnl');
  const kpi=(l,v,d,cls)=>`<div class="dk-panel dk-stat"><div class="dk-lbl">${l}</div><div class="dk-v dk-num ${cls||''}">${v}</div><div class="dk-d">${d}</div></div>`;
  return `<div class="dk-grid dk-g4 dk-mb">${kpi(RT('Закрытых сделок','Closed trades')+dkGi('trips'),S.n,`${S.open} ${RT('открыто','open')} · ${RT('записей','records')} ${(PF_TRADES||[]).filter(t=>tabs.includes(t.tab||PF3_KEY)).length}`)}
      ${kpi(RT('Доля в плюсе','Win rate')+dkGi('win-rate'),S.winRate==null?'—':dkN(S.winRate,0)+'%',`${S.win}/${S.n}`)}
      ${kpi(RT('Средний результат','Average result')+dkGi('avg-res'),S.avgPct==null?'—':dkPct(S.avgPct),RT('на сделку, % от входа','per trade, % of entry'),S.avgPct>=0?'dk-up':'dk-dn')}
      ${kpi('Profit factor'+dkGi('pf'),S.pf==null?'—':S.pf===Infinity?'∞':dkN(S.pf,2),showPl?RT('итог ','total ')+(S.sumSEK>=0?'+':'')+dkKr(S.sumSEK):RT('прибыль ÷ убыток','profit ÷ loss'))}</div>
    <div class="dk-panel dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Бумага','Stock')}</th><th>${RT('Сторона','Side')}</th><th>${RT('Открыта','Opened')}</th><th>${RT('Закрыта','Closed')}</th><th class="r">${RT('Дней','Days')}</th><th class="r">${RT('Кол-во','Qty')}</th><th class="r">${RT('Вход','Entry')}</th><th class="r">${RT('Выход','Exit')}</th><th class="r">%</th>${showPl?'<th class="r">P&amp;L</th>':''}</tr></thead><tbody>
      ${T.length?T.slice(0,300).map(t=>`<tr class="dk-tr" data-a="open" data-k="${dkEsc(exSymbol(t.tk,t.ccy)+'|'+String(t.ccy).toUpperCase())}"><td><span class="dk-tk">${dkEsc(t.tk)}</span><span class="dk-nm">${dkEsc(t.name)}</span>${port==='all'?`<div class="dk-note">${dkEsc(TAB_LABEL(t.tab))}</div>`:''}</td><td>${dkSide(t.side)}</td><td class="dk-num">${dkEsc(t.opened)}</td><td class="dk-num">${t.open?`<span class="dk-tag">${RT('открыта','open')}</span>`:dkEsc(t.close)}</td><td class="r dk-num">${t.days==null?'—':t.days}</td><td class="r dk-num">${dkN(t.maxQty,0)}</td><td class="r dk-num">${dkPx(t.entryAvg)}</td><td class="r dk-num">${dkPx(t.exitAvg)}</td><td class="r dk-num dk-b ${t.pl>=0?'dk-up':'dk-dn'}">${t.plPct==null?'—':dkPct(t.plPct)}</td>${showPl?`<td class="r dk-num">${t.exitQty>0?(t.pl>=0?'+':'')+dkKr(t.pl*(FX[t.ccy]||1)):'—'}</td>`:''}</tr>`).join(''):`<tr><td colspan="10" class="dk-empty">${RT('Сделок в журнале нет — «Исполнить» на плане пишет их сюда.','No trades in the journal — “Execute” on a plan writes them here.')}</td></tr>`}
    </tbody></table></div>
    <p class="dk-note dk-mt14">${RT('Сделка = от открытия позиции с нуля до закрытия в ноль по журналу PF_TRADES (частичные закрытия суммируются). Продажи позиций, открытых до ведения журнала, в статистику не входят. R по реальным сделкам появится, когда у позиций будет стоп входа (планы desk пишут его).','A trade = from opening a position from zero to closing it to zero in the PF_TRADES journal (partial closes add up). Sales of positions opened before the journal are excluded. R for real trades appears once positions carry an entry stop (desk plans record it).')}</p>`;
}
function deskPlansHTML(){
  const R=(PLAN_RULES||[]).slice().sort((a,b)=>(a.done-b.done)||((b.createdAt||0)-(a.createdAt||0)));
  return `<div class="dk-panel dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Бумага','Stock')}</th><th>${RT('Действие','Action')}</th><th class="r">${RT('Уровень','Level')}</th><th class="r">${RT('Стоп','Stop')}</th><th class="r">${RT('Цель','Target')}</th><th class="r">R/R</th><th class="r">${RT('Кол-во','Qty')}</th><th${dkG('plans')}>${RT('Статус','Status')}</th><th>${RT('Портфель','Portfolio')}</th><th></th></tr></thead><tbody>
    ${R.length?R.map(r=>{const st=planStatus(r),rr=planRR(r,st.price),key=exSymbol(r.tk,r.ccy||'USD')+'|'+String(r.ccy||'USD').toUpperCase();
      const stat=r.done?RT('исполнено','done'):r.status==='open'?RT('позиция открыта','position open'):st.invalid?'✖ '+RT('сетап сломан','setup broken'):st.ready?'🔔 '+RT('пора','now'):st.gapPct!=null?RT('до уровня ','to level ')+dkN(Math.abs(st.gapPct),1)+'%':RT('взведено','armed');
      return `<tr class="dk-tr${r.done?' dk-done':''}" data-a="open" data-k="${dkEsc(key)}"><td><span class="dk-tk">${dkEsc(r.tk)}</span><span class="dk-nm">${dkEsc(r.name||'')}</span>${r.note?`<div class="dk-note">${dkEsc(String(r.note).slice(0,100))}</div>`:''}</td><td>${planActIcon(r.act,r.side)} ${planActLabel(r.act,r.side)}</td><td class="r dk-num">${st.lvl>0?dkPx(st.lvl):'—'}</td><td class="r dk-num dk-dn">${r.stop?dkPx(r.stop):'—'}</td><td class="r dk-num dk-up">${r.target?dkPx(r.target):'—'}</td><td class="r dk-num">${rr!=null?dkN(rr,1):'—'}</td><td class="r dk-num">${r.qty||'—'}</td><td>${stat}</td><td class="dk-note">${dkEsc(TAB_LABEL(r.tab||PF3_KEY))}</td>
        <td class="dk-nowrap">${can('action.edit_plan')?`<button class="dk-btn dk-sm" data-a="planed" data-id="${dkEsc(r.id)}" title="${RT('Редактировать','Edit')}" aria-label="${RT('Редактировать','Edit')}">✏</button>${r.done?'':`<button class="dk-btn dk-sm" data-a="plandone" data-id="${dkEsc(r.id)}" title="${RT('Отметить исполненным','Mark done')}">✓</button>`}<button class="dk-btn dk-sm" data-a="planx" data-id="${dkEsc(r.id)}" title="${RT('Удалить','Delete')}">🗑</button>`:''}</td></tr>`;}).join(''):`<tr><td colspan="10" class="dk-empty">${RT('Планов нет — новое правило или импорт из совета AI: «✏️ Редактор плана» ниже.','No plans — add a rule or import AI advice: “✏️ Plan editor” below.')}</td></tr>`}
  </tbody></table></div>
  ${deskPlanEditorHTML()}
  <p class="dk-note dk-mt14">${RT('Правила проверяются при каждом обновлении котировок (тост и push в браузере), а воркер по крону шлёт в Telegram стоп, цель и лимиты плана даже при закрытой странице (⋯ → «Telegram-алерты»).','Rules are checked on every quote refresh (toast and browser push); the worker cron also sends plan stops, targets and limits to Telegram with the page closed (⋯ → “Telegram alerts”).')}</p>`;
}
// Редактор плана (карта §3.3 «План»): создание, правка, «📍 Открыта», импорт из совета AI, уведомления — блок классики
// planRulesHTML для одного портфеля (правила привязаны к вкладке). ✏ в таблице открывает его на правиле и его портфеле.
function deskPlanEditorHTML(){
  if(!can('view.plan'))return '';
  const P=deskPorts(),tab=DESK_UI.planTab&&P.includes(DESK_UI.planTab)?DESK_UI.planTab:deskOnePort();
  if(!tab||!deskCtx(tab,'plan'))return '';
  const sel=P.length>1?`<select class="dk-sel dk-ml" data-c="plantab" aria-label="${RT('Портфель редактора','Editor portfolio')}">${P.map(k=>`<option value="${dkEsc(k)}"${k===tab?' selected':''}>${dkEsc(TAB_LABEL(k))}</option>`).join('')}</select>`:'';
  return `<details class="dk-panel dk-mt14" id="dkPlanEd"${dkDetAttr('j-plan-ed')}><summary class="dk-ph"><h2>✏️ ${RT('Редактор плана','Plan editor')}</h2><span class="dk-note dk-ml">${RT('новое правило, правка, «📍 Открыта», импорт из совета AI','new rule, edit, “📍 Opened”, import from AI advice')}</span></summary>
    <div class="dk-pad"><div class="dk-row dk-mb6"><span class="dk-lbl">${RT('Портфель','Portfolio')}</span>${sel||`<b>${dkEsc(TAB_LABEL(tab))}</b>`}</div>${deskClassicBox(planRulesHTML())}</div></details>`;
}
// Бэктест правил: реплей вердикта v2 по всем бумагам с загруженными свечами (мемо на записи кэша).
function deskRulesHTML(){
  const I=deskItems(),T=[];let n=0;
  I.items.forEach(x=>{const hc=_histCache[sigHistKey(x.sec.sym)];if(!hc||!hc.bars||hc.bars.length<SIG.CFG.minBars)return;n++;
    if(!hc.rep){try{hc.rep=SIG.replay(hc.bars);}catch(e){return;}}
    hc.rep.trades.forEach(t=>T.push(Object.assign({},t,{tk:x.sec.tk,name:x.sec.name,key:x.key})));});
  const st=SIG.replayStats(T,0),C=T.filter(t=>!t.open),B=deskRBins(C.map(t=>t.R)),mx=Math.max(1,...B.n),W=720,H=150,bw=W/B.bins.length;
  const bySide=sd=>SIG.replayStats(T.filter(t=>t.side===sd),0);
  const L=bySide('long'),S=bySide('short'),pf=x=>x.pf==null?'—':x.pf===Infinity?'∞':dkN(x.pf,2);
  const hist=`<svg class="dk-rhist" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${RT('Распределение результатов в R','Distribution of results in R')}">${B.bins.map((bn,i)=>{const h=B.n[i]/mx*(H-34),x=i*bw+6,y=H-22-h;return `<rect x="${x}" y="${y}" width="${bw-12}" height="${Math.max(h,B.n[i]?2:0)}" rx="3" fill="${bn<0?'var(--dk-short)':'var(--dk-long)'}" opacity=".85"/><text x="${x+(bw-12)/2}" y="${H-8}" text-anchor="middle" font-size="11" fill="var(--dk-muted)" font-family="var(--dk-mono)">${bn<0?bn:'+'+bn}${bn===5?'+':''}R</text>${B.n[i]?`<text x="${x+(bw-12)/2}" y="${y-4}" text-anchor="middle" font-size="11" fill="var(--dk-ink2)" font-family="var(--dk-mono)">${B.n[i]}</text>`:''}`;}).join('')}<line x1="0" x2="${W}" y1="${H-22}" y2="${H-22}" stroke="var(--dk-line2)"/></svg>`;
  const kpi=(l,v,d,cls)=>`<div class="dk-panel dk-stat"><div class="dk-lbl">${l}</div><div class="dk-v dk-num ${cls||''}">${v}</div><div class="dk-d">${d}</div></div>`;
  const rows=T.slice().sort((a,b)=>String(b.d).localeCompare(String(a.d))).slice(0,80);
  return `<div class="dk-grid dk-g4 dk-mb">${kpi(RT('Сделок','Trades')+dkGi('backtest'),st.n,`${n} ${RT('бумаг','stocks')} · ${st.open} ${RT('открыто','open')}`)}
      ${kpi(RT('Доля в плюсе','Win rate')+dkGi('win-rate'),st.n?dkN(st.win/st.n*100,0)+'%':'—',RT('по R > 0','by R > 0'))}
      ${kpi(RT('Средний R','Average R')+dkGi('backtest'),dkR(st.avgR),RT('ожидание на сделку','expectancy per trade'),st.avgR>=0?'dk-up':'dk-dn')}
      ${kpi('Profit factor'+dkGi('pf'),pf(st),`${RT('лонг','long')} ${pf(L)} · ${RT('шорт','short')} ${pf(S)}`)}</div>
    <div class="dk-panel dk-mb"><div class="dk-ph"><h2>${RT('Распределение результатов в R','Distribution of results in R')}${dkGi('backtest')}</h2><span class="dk-note dk-ml">${RT('1R = вход − стоп плана на дату входа','1R = entry − plan stop on the entry date')}</span></div><div class="dk-pad">${hist}</div></div>
    <div class="dk-panel dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Бумага','Stock')}</th><th>${RT('Сторона','Side')}</th><th>${RT('Вход','Entry')}</th><th>${RT('Выход','Exit')}</th><th class="r">${RT('Цена','Price')}</th><th class="r">${RT('Стоп','Stop')}</th><th class="r">${RT('Цель','Target')}</th><th class="r"${dkG('r-unit')}>R</th><th>${RT('Сигнал входа','Entry signal')}</th></tr></thead><tbody>
      ${rows.length?rows.map(t=>{const x=t.exits[t.exits.length-1];return `<tr class="dk-tr" data-a="open" data-k="${dkEsc(t.key)}"><td><span class="dk-tk">${dkEsc(t.tk)}</span><span class="dk-nm">${dkEsc(t.name)}</span></td><td>${dkSide(t.side)}</td><td class="dk-num">${t.d}</td><td class="dk-num">${t.open?RT('открыта','open'):(x?x.d+' · '+dkEsc(x.why):'')}</td><td class="r dk-num">${dkPx(t.entry)}</td><td class="r dk-num dk-dn">${dkPx(t.stop0)}</td><td class="r dk-num dk-up">${dkPx(t.target)}</td><td class="r dk-num dk-b ${t.R>=0?'dk-up':'dk-dn'}">${dkR(t.R)}</td><td class="dk-ink2">${dkEsc(t.why||'')}</td></tr>`;}).join(''):`<tr><td colspan="9" class="dk-empty">${DESK_UI.load.busy?RT('Свечи грузятся…','Candles loading…'):RT('Сделок по правилам нет.','No rule trades.')}</td></tr>`}
    </tbody></table></div>
    <p class="dk-note dk-mt14">${RT('Проверка правил, а не мои сделки: вход — бар, где вердикт v2 впервые стал «Купить»/«Шорт» (без таргетов и отчётов в истории); выход — стоп, ½ на цели, +1R → безубыток, +2R → трейлинг 2·ATR. Показаны последние 80.','A rules check, not my trades: entry — the bar where verdict v2 first turned Buy/Short (no targets/earnings in history); exit — stop, ½ at target, +1R → breakeven, +2R → 2·ATR trail. Last 80 shown.')}</p>`;
}

// ═══════════════════ Сервис (S7b-2, карта §3.3/§4): вкладки и бумаги, сбор данных ═══════════════════
// Мутаторы — функции классики (pf3Add/pf3Delete/pf3NewTab/pf3RenameTab/pf3TabDelete/pf3ForceTypes, homeUpdateAll/
// valUpdateAll/insiderUpdateAll) в контексте выбранной вкладки; их прогресс пишется в кнопки по id (homeUpdBtn…).
function deskSvcTab(){const T=v3Tabs().filter(tabAllowed);return DESK_UI.svcTab&&T.includes(DESK_UI.svcTab)?DESK_UI.svcTab:(T.includes(PF3_KEY)?PF3_KEY:T[0]||null);}
function deskServiceHTML(){
  const tabs=v3Tabs().filter(tabAllowed),adm=isAdmin(),cur=deskSvcTab(),refresh=can('action.refresh_data');
  const at=v=>v?new Date(v).toLocaleString(LANG==='en'?'en-GB':'ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
  const last=o=>Object.values(o||{}).reduce((m,v)=>{const t=v?(typeof v.at==='number'?v.at:Date.parse(v.at||'')):0;return t>m?t:m;},0);
  const btn=(id,fn,busy,l,title)=>`<button type="button" class="dk-btn${id==='homeUpdBtn'?' pri':''}" id="${id}" data-a="svcrun" data-v="${fn}"${busy?' disabled':''} title="${dkEsc(title)}">${busy?'⏳ '+RT('идёт…','running…'):l}</button>`;
  const data=`<div class="dk-panel dk-mb"><div class="dk-ph"><h2>🔄 ${RT('Сбор данных','Data collection')}</h2><span class="dk-note dk-ml">${RT('⟳ в шапке обновляет только мои портфели и свечи','⟳ in the header refreshes only my portfolios and candles')}</span></div>
    <div class="dk-svc">
      ${refresh?`<div class="dk-svc-it">${btn('homeUpdBtn','homeUpdateAll',typeof _homeUpd!=='undefined'&&_homeUpd,'🔄 '+RT('Обновить данные вселенной','Refresh universe data'),RT('Цены, SMA, уровни, таргеты и метрики всех вкладок + курсы валют','Prices, SMA, levels, targets and metrics of every tab + FX'))}<div class="dk-note">${RT(`Цены и уровни ${tabs.length} вкладок, аналитические таргеты и метрики (раз в сутки на вкладку), курсы. Долго: сотни бумаг.`,`Prices and levels of ${tabs.length} tabs, analyst targets and metrics (daily per tab), FX. Slow: hundreds of stocks.`)}</div></div>`:''}
      ${adm?`<div class="dk-svc-it">${btn('valBtn','valUpdateAll',typeof _valBusy!=='undefined'&&_valBusy,'📐 '+RT('Оценка','Valuation'),RT('Мультипликаторы vs медиана сектора и собственная история','Multiples vs sector median and own history'))}<div class="dk-note">${RT('Мультипликаторы и история P/E (VAL) и агрегированные таргеты (TG_FULL) — от них зависят измерение «Цена» и «Аналитики и оценка».','Multiples and P/E history (VAL) and aggregated targets (TG_FULL) — the Price dimension and “Analysts & valuation” use them.')} ${RT('Последнее','Last')}: ${at(last(VAL))}</div></div>
      <div class="dk-svc-it">${btn('insiderBtn','insiderUpdateAll',typeof _insiderBusy!=='undefined'&&_insiderBusy,'🕵 '+RT('Инсайдеры','Insiders'),RT('Инсайдерские сделки по всем вкладкам (US: Finnhub · SE: Finansinspektionen)','Insider transactions across all tabs (US: Finnhub · SE: Finansinspektionen)'))}<div class="dk-note">${RT('Сделки инсайдеров за 30 дней по всем вкладкам — блок «Инсайдеры» в «Компании».','Insider trades over 30 days across all tabs — the Insiders block in Company.')} ${RT('Последнее','Last')}: ${at(last(INSIDER))}</div></div>`:''}
      ${!refresh&&!adm?`<div class="dk-empty">${RT('Сбор данных недоступен для вашей роли.','Data collection is not available for your role.')}</div>`:''}
    </div></div>`;
  if(!cur)return data+`<div class="dk-panel dk-empty">${RT('Вкладок нет.','No tabs.')}</div>`;
  deskCtx(cur,'list');
  const kind=k=>k===PF3_KEY||pf3MyPort(k)?RT('портфель','portfolio'):DATA[k].custom==='1'?RT('своя','custom'):RT('индекс','index');
  const list=`<div class="dk-panel dk-mb"><div class="dk-ph"><h2>🗂 ${RT('Вкладки','Tabs')}</h2><span class="dk-cnt">${tabs.length}</span>${adm?`<button type="button" class="dk-btn dk-sm dk-ml" data-a="svcnew">➕ ${RT('Новая вкладка','New tab')}</button>`:''}</div>
    <div class="dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Вкладка','Tab')}</th><th>${RT('Тип','Kind')}</th><th class="r">${RT('Бумаг','Stocks')}</th><th>${RT('Таргеты','Targets')}</th><th></th></tr></thead><tbody>
    ${tabs.map(k=>{const d=DATA[k],ek=dkEsc(k);return `<tr class="dk-tr${k===cur?' on':''}" data-a="svctab" data-v="${ek}"><td><b>${dkEsc(TAB_LABEL(k))}</b></td><td class="dk-note">${kind(k)}</td><td class="r dk-num">${(d.rows||[]).length}</td><td class="dk-num dk-note">${at(d.targetsAt)}</td>
      <td class="dk-nowrap">${refresh?`<button type="button" class="dk-btn dk-sm" data-a="svctypes" data-v="${ek}" title="${RT('Обновить таргеты, метрики и типы сейчас','Refresh targets, metrics and types now')}">🔁</button>`:''}${adm?`<button type="button" class="dk-btn dk-sm" data-a="svcren" data-v="${ek}" title="${RT('Переименовать','Rename')}" aria-label="${RT('Переименовать','Rename')}">✏</button>`:''}${adm&&d.custom==='1'?`<button type="button" class="dk-btn dk-sm" data-a="svcdel" data-v="${ek}" title="${RT('Удалить вкладку','Delete tab')}" aria-label="${RT('Удалить вкладку','Delete tab')}">🗑</button>`:''}</td></tr>`;}).join('')}
    </tbody></table></div></div>`;
  const d=DATA[cur],port=pf3IsPort(cur),addOk=can('action.add_position')&&cur!==AIP_KEY,delOk=adm&&cur!==AIP_KEY,mine=pf3MyPort(cur);   // 🗑 строки — только админ, как в классике
  const rows=(d.rows||[]).map(r=>{const tk=String(r[2]||'');return `<tr><td><span class="dk-tk">${dkEsc(tk)}</span><span class="dk-nm">${dkEsc(String(r[1]||''))}</span></td><td class="dk-note">${dkEsc(String(r[4]||''))}</td>${port?`<td class="r dk-num">${dkN(parseFloat(r[6])||0,0)}</td><td class="r dk-num">${dkPx(parseFloat(r[9])||null)} ${dkCcy(r[8])}</td>`:`<td class="dk-note">${dkEsc(String(r[8]||''))}</td>`}<td>${delOk?`<button type="button" class="dk-btn dk-sm" data-a="svcrm" data-v="${dkEsc(tk)}" title="${RT('Удалить из вкладки','Remove from tab')}" aria-label="${RT('Удалить','Delete')} ${dkEsc(tk)}">🗑</button>`:''}</td></tr>`;}).join('');
  const add=addOk?`<div class="dk-classic"><form class="pf3-add dk-svc-add" onsubmit="pf3Add(event)">
      <input id="pf3AddTicker" class="dk-inp" placeholder="${T('Тикер')}" autocomplete="off" aria-label="${T('Тикер')}">
      ${mine?`<input id="pf3AddQty" class="dk-inp dk-num" type="number" step="any" min="0" placeholder="${T('Кол-во')}" aria-label="${T('Кол-во')}"><input id="pf3AddBuy" class="dk-inp dk-num" type="number" step="any" min="0" placeholder="${T('Цена покупки')}" aria-label="${T('Цена покупки')}">`:''}
      <select id="pf3AddCcy" class="dk-sel" aria-label="${RT('Валюта','Currency')}">${['USD','EUR','SEK','NOK','DKK','GBP'].map(c=>`<option${(mine?'SEK':'USD')===c?' selected':''}>${c}</option>`).join('')}</select>
      <button class="dk-btn pri" type="submit">➕ ${RT('Добавить акцию','Add stock')}</button></form>
      <div class="dk-note">${mine?RT('В портфель: кол-во и цена покупки списывают сумму со свободного кэша (как в классике). Сделку с журналом и комиссией вносите через «Исполнить…».','Into a portfolio: qty and buy price debit the free cash (as in classic). Record a trade with journal and fee via “Execute…”.'):RT('В список вкладки: только тикер — имя, сектор, цена и уровни подтянутся сами.','Into a watchlist tab: ticker only — name, sector, price and levels fill in automatically.')}</div></div>`:'';
  const stocks=`<div class="dk-panel"><div class="dk-ph"><h2>${dkEsc(TAB_LABEL(cur))}</h2><span class="dk-cnt">${(d.rows||[]).length}</span><span class="dk-note dk-ml">${kind(cur)}</span></div>
    <div class="dk-pad">${add}</div>
    <div class="dk-wrap dk-svc-list"><table class="dk-tbl"><thead><tr><th>${RT('Бумага','Stock')}</th><th>${RT('Сектор','Sector')}</th>${port?`<th class="r">${RT('Кол-во','Qty')}</th><th class="r">${RT('Средняя','Avg')}</th>`:`<th>${RT('Валюта','Ccy')}</th>`}<th></th></tr></thead><tbody>${rows||`<tr><td colspan="5" class="dk-empty">${RT('Бумаг нет.','No stocks.')}</td></tr>`}</tbody></table></div></div>`;
  return data+list+stocks;
}

// ── Модальное окно исполнения ──
function deskModalHTML(){
  if(DESK_UI.wedit)return deskWatchFormHTML();
  const x=DESK_UI.exec;if(!x)return '';
  const it=deskSecOf(x.key),ports=deskPorts(),tab=x.tab&&ports.includes(x.tab)?x.tab:(deskRiskTab()||ports[0]);
  const title=x.mode==='close'?(x.side==='short'?RT('Откупить шорт','Cover short'):RT('Продать','Sell')):(x.side==='short'?RT('Открыть шорт','Open short'):RT('Купить','Buy'));
  x.tab=tab;const cc=deskExecCap(x);
  return `<div class="dk-overlay" data-a="execx"><form class="dk-modal" role="dialog" aria-modal="true" aria-label="${dkEsc(title)}" onsubmit="event.preventDefault();deskExecSubmit()" data-a="noop">
    <div class="dk-ph"><h2>${dkEsc(title)} · <span class="dk-tk">${dkEsc(x.tk)}</span></h2>${dkSide(x.side)}<button type="button" class="dk-btn dk-sm dk-ml" data-a="execx" aria-label="${RT('Закрыть','Close')}">✕</button></div>
    <div class="dk-form">
      <label>${RT('Портфель','Portfolio')}<select id="dkExPort" class="dk-sel" data-c="expo"${x.mode==='close'?' disabled':''}>${ports.map(k=>`<option value="${dkEsc(k)}"${k===tab?' selected':''}>${dkEsc(TAB_LABEL(k))}</option>`).join('')}</select></label>
      <label>${RT('Кол-во','Qty')}<input id="dkExQty" class="dk-inp dk-num" type="number" step="any" min="0" value="${x.qty||''}" required></label>
      <label>${RT('Цена','Price')} (${dkEsc(x.ccy)})<input id="dkExPx" class="dk-inp dk-num" type="number" step="any" min="0" value="${x.price||''}" required></label>
      <label>${RT('Дата','Date')}<input id="dkExDate" class="dk-inp" type="date" value="${dkEsc(x.date||new Date().toISOString().slice(0,10))}"></label>
      ${x.mode==='open'?`<label>${RT('Стоп','Stop')}<input id="dkExStop" class="dk-inp dk-num" type="number" step="any" min="0" value="${x.stop||''}"></label><label>${RT('Цель','Target')}<input id="dkExTgt" class="dk-inp dk-num" type="number" step="any" min="0" value="${x.target||''}"></label>`:''}
    </div>
    <div id="dkExRisk">${deskExecRiskHTML(x)}</div>
    ${x.side==='short'&&x.mode==='open'&&!((DESK.shortOk||{})[x.sym])?`<div class="dk-warn">${RT('⚠ Шорт не подтверждён: проверьте доступность и стоимость займа у брокера.','⚠ Short unconfirmed: check availability and borrow cost at the broker.')}</div>`:''}
    <div class="dk-note">${x.mode==='open'?(x.side==='short'?RT('Шорт: продажа открывает позицию (средняя = средняя выручка), кэш уменьшается на комиссию; результат — при откупе.','Short: the sale opens the position (average = average proceeds), cash drops by the fee; the result is booked on cover.'):RT('Покупка: сумма + комиссия списываются с кэша портфеля, средняя пересчитывается.','Buy: amount + fee are debited from portfolio cash, the average is recalculated.')):RT('Результат по средней (genomsnittsmetoden) за вычетом комиссии пишется в журнал и в кэш.','The result vs the average (genomsnittsmetoden) net of fee goes to the journal and cash.')}</div>
    <div class="dk-row"><button type="submit" id="dkExGo" class="dk-btn pri"${x.mode==='open'&&!cc.ok?' disabled':''}>${dkEsc(title)}</button>${x.mode==='open'&&can('action.edit_plan')&&it?`<button type="button" class="dk-btn" data-a="plan" data-k="${dkEsc(x.key)}" data-side="${x.side}">${RT('В план','Add to plan')}</button>`:''}<button type="button" class="dk-btn" data-a="execx">${RT('Отмена','Cancel')}</button></div>
  </form></div>`;
}
function deskExecOpen(key,side,mode,tab,tk,qty){
  const it=deskSecOf(key);
  if(mode==='close'){   // qty — подсказка частичного закрытия («Сократить… ½» из «Решения»), не больше позиции
    const p=bookPositions(tab).find(x=>x.tk===posTk(tk));if(!p)return;
    DESK_UI.exec={key,side:p.side,mode,tab,tk:p.tk,sym:p.sym,ccy:p.ccy,qty:qty>0?Math.min(qty,p.qty):p.qty,price:p.calc?p.calc.now:p.entry};
  }else{
    if(!it||!it.s)return toast(RT('Сигнал ещё не посчитан','Signal not computed yet'),true);
    const p=deskPlanFor(it,side);
    DESK_UI.exec={key,side,mode:'open',tab:tab&&deskPorts().includes(tab)?tab:deskRiskTab(),tk:it.sec.tk,sym:it.sec.sym,ccy:it.sec.ccy,qty:qty>0?qty:p.qty,price:p.mode==='limit'?Math.round(p.entry*100)/100:it.s.price,stop:Math.round(p.stop*100)/100,target:Math.round(p.target*100)/100};
  }
  deskRender(true);
  setTimeout(()=>{const q=document.getElementById('dkExQty');if(q)q.focus();},30);
}
function deskExecSubmit(){
  const x=DESK_UI.exec;if(!x)return;
  const g=id=>{const e=document.getElementById(id);return e?e.value:'';};
  const o={tab:x.mode==='close'?x.tab:g('dkExPort'),side:x.side,mode:x.mode,qty:parseFloat(g('dkExQty')),price:parseFloat(g('dkExPx')),date:g('dkExDate')||new Date().toISOString().slice(0,10),
    stop:x.mode==='open'?parseFloat(g('dkExStop'))||0:0,target:x.mode==='open'?parseFloat(g('dkExTgt'))||0:0,planId:x.planId||''};
  const it=deskSecOf(x.key);
  const r=deskExecApply(o,it?it.sec:{tk:x.tk,name:x.tk,ccy:x.ccy,sym:x.sym},it&&it.r,it&&it.d);
  if(r.err)return toast(r.err,true);
  DESK_UI.exec=null;
  toast((o.mode==='open'?(o.side==='short'?'▼ ':'▲ '):'◆ ')+r.msg);
  deskRender(true);
}
// Исполнение сделки из desk: позиция (qty/средняя в строке портфеля), кэш, журнал PF_TRADES, мета позиции.
// o={tab, side, mode:'open'|'close', qty, price, date, stop, target, planId}; sec — бумага; row0/d0 — строка-источник
// и её вкладка (новая позиция копирует из неё SMA/уровни/таргеты по именам колонок — фаза и вердикт не меняются).
function deskExecApply(o,sec,row0,d0){
  if(!can('action.edit_trades'))return {err:RT('Нет права вносить сделки','No permission to record trades')};
  const d=DATA[o.tab];if(!d||!pf3MyPort(o.tab))return {err:RT('Выберите портфель','Select a portfolio')};
  const tk=posTk(sec.tk);if(!tk)return {err:'ticker'};
  if(!(o.qty>0)||!(o.price>0))return {err:RT('Укажите количество и цену','Enter quantity and price')};
  let ri=d.rows.findIndex(r=>posTk(r[2])===tk);
  const meta=posMetaGet(o.tab,tk),cur=ri>=0?(parseFloat(d.rows[ri][6])||0):0,curSide=cur>0?((meta&&meta.side)||'long'):null;
  if(o.mode==='open'){
    if(curSide&&curSide!==o.side)return {err:RT('В портфеле уже есть позиция другой стороны — сначала закройте её','The portfolio already holds the opposite side — close it first')};
    if(o.stop>0||o.target>0){const ck=posLevelsCheck(o.side,o.price,o.stop,o.target);if(!ck.ok)return {err:RT('Стоп/цель не с той стороны от цены','Stop/target on the wrong side of the price')};}
    if(o.stop>0){const add=o.qty*Math.abs(o.price-o.stop)*(FX[String(sec.ccy||'USD').toUpperCase()]||1);if(!deskCapCheck(bookRiskState(o.tab),add).ok)return {err:RT('Лимит открытого риска книги превышен','Book open-risk cap exceeded')};}
  }else if(!(cur>0))return {err:RT('Нет позиции','No position')};
  if(ri<0){   // новая позиция (паттерн pf3-строки; цена — исполнения, до обновления котировок)
    const src=row0||[],h0=(d0&&d0.headers)||[];
    ['Поддержка','Сопротивление','Аналит. таргет','Таргет 3м'].forEach(n=>{const j=h0.indexOf(n);if(j>=0&&src[j]!==''&&src[j]!=null)ensurePFCol(d,n);});
    const row=new Array(d.headers.length).fill('');
    row[0]=d.rows.length+1;row[1]=String(sec.name||src[1]||tk);row[2]=tk;row[3]=src[3]||'';row[4]=sec.sector||src[4]||'';row[5]=sec.type||src[5]||'';
    row[6]=0;row[7]=o.price;row[8]=String(sec.ccy||src[8]||'USD').toUpperCase();row[9]=0;row[10]=parseFloat(src[10])||0;row[11]=0;row[12]=0;row[13]=0;
    d.headers.forEach((n,i)=>{if(i<14)return;const j=h0.indexOf(n);if(j>=0&&src[j]!=null&&src[j]!=='')row[i]=src[j];});
    d.rows.push(row);d.count=d.rows.length;ri=d.rows.length-1;
  }
  const r=d.rows[ri],ccy=String(r[8]||'USD').toUpperCase(),fx=FX[ccy]||1,short=o.side==='short';
  const act=short?(o.mode==='open'?'sell':'buy'):(o.mode==='open'?'buy':'sell');
  const res=pfApplyTradeSide({qty:parseFloat(r[6])||0,avg:parseFloat(r[9])||0},{side:o.side,act,qty:o.qty,price:o.price});
  if(res.err)return {err:RT('Нет позиции для закрытия','No position to close')};
  const fee=tradeFeeNative(ccy,res.tq*o.price,act==='buy').total,pl=res.plNative!=null?Math.round((res.plNative-fee)*100)/100:null;
  r[6]=res.qty;r[9]=res.avg;if(!(parseFloat(r[7])>0))r[7]=o.price;
  // Кэш: лонг — сумма ± комиссия; шорт — только комиссия при открытии, результат при откупе (выручка — залог у брокера).
  const hasCash=d.cashFree!=null&&d.cashFree!=='',cashNative=short?(o.mode==='open'?-fee:pl):(o.mode==='open'?-(res.tq*o.price+fee):res.tq*o.price-fee);
  if(hasCash)d.cashFree=Math.round(((parseFloat(d.cashFree)||0)+pf3Cv(d,cashNative*fx))*100)/100;
  const tr={id:'tr'+Date.now()+'_'+Math.floor(Math.random()*1e4),tab:o.tab,tk,name:String(r[1]||tk),ccy,act,qty:res.tq,price:o.price,plNative:pl,feeNative:fee,date:o.date};
  if(short)tr.short=true;
  PF_TRADES.push(tr);
  if(o.mode==='open'){
    const patch={side:o.side,stop:o.stop>0?o.stop:null,target:o.target>0?o.target:null,riskKr:o.stop>0?Math.round(res.tq*Math.abs(o.price-o.stop)*fx):null,opened:meta&&meta.opened?meta.opened:o.date};
    if(o.planId)patch.planId=o.planId;
    posMetaSet(o.tab,tk,patch);
    const rule=o.planId&&(PLAN_RULES||[]).find(x=>x.id===o.planId);if(rule){planRuleNorm(rule);rule.status='open';rule.done=false;rule.hitAt=0;}
  }else if(!(res.qty>0)){
    const m=posMetaGet(o.tab,tk),rule=m&&m.planId&&(PLAN_RULES||[]).find(x=>x.id===m.planId);
    if(rule){rule.done=true;rule.hitAt=0;planRuleNorm(rule);}
    posMetaDel(o.tab,tk);
  }
  recalcPF(ri,o.tab);scheduleSave();
  return {ok:true,msg:`${tk} ${pf3Fmt(res.tq)} × ${pf3Fmt(o.price,2)} ${ccy}${fee?` · ${RT('комиссия','fee')} ${pf3Fmt(fee,2)}`:''}${pl!=null?` · P&L ${pl>=0?'+':''}${pf3Fmt(pl,2)} ${ccy}`:''} → ${TAB_LABEL(o.tab)}`};
}
// «В план» / «Взвести лимит»: правило плана v2 (PLAN_RULES) в выбранный портфель; проверка — planCheck при котировках.
function deskPlanAdd(key,side,qty){
  if(!can('action.edit_plan'))return;
  const it=deskSecOf(key);if(!it||!it.s)return toast(RT('Сигнал ещё не посчитан','Signal not computed yet'),true);
  const p=deskPlanFor(it,side),tab=(qty>0&&deskWiCfg().port)||deskRiskTab()||PF3_KEY,tk=posTk(it.sec.tk),act=side==='short'?'sell':'buy';
  const dup=(PLAN_RULES||[]).find(r=>!r.done&&r.status!=='open'&&posTk(r.tk)===tk&&r.side===side&&(r.tab||PF3_KEY)===tab&&planIsEntry(r));
  const lvl=Math.round(p.entry*100)/100,rule={tab,tk,name:it.sec.name,ccy:it.sec.ccy,act,side,level:lvl,stop:Math.round(p.stop*100)/100,target:Math.round(p.target*100)/100,qty:qty>0?qty:(p.qty>0?p.qty:0),amount:0,deadline:'',
    note:(p.mode==='limit'?RT('лимит · ','limit · '):'')+(side===it.s.side?String(it.s.why[0]||''):RT('против вердикта: ','against the verdict: ')+(p.levelSrc||p.stopSrc||'')).slice(0,140),riskKr:Math.round(qty>0?qty*p.risk*(FX[it.sec.ccy]||1):DESK_UI.riskOvr[key]>0?DESK_UI.riskOvr[key]:deskRiskKr())};   // qty из «Что если?» — риск по нему
  if(dup)Object.assign(dup,rule,{hitAt:0});
  else PLAN_RULES.push(planRuleNorm(Object.assign({id:'pl'+Date.now()+'_'+Math.floor(Math.random()*1e4),hitAt:0,done:false,createdAt:Date.now()},rule)));
  if(dup)planRuleNorm(dup);
  planAskNotify(true);scheduleSave();
  if(DESK_UI.exec)DESK_UI.exec=null;
  toast('🎯 '+(dup?RT('План обновлён','Plan updated'):p.mode==='limit'?RT('Лимит взведён','Limit armed'):RT('В плане','Planned'))+`: ${tk} ${side==='short'?RT('шорт','short'):RT('лонг','long')} ${pf3Fmt(lvl,2)} · ${RT('стоп','stop')} ${pf3Fmt(rule.stop,2)} · ${RT('цель','target')} ${pf3Fmt(rule.target,2)} · ${rule.qty} ${RT('шт','sh')}`);
  deskRender(true);
}

// ── Список покупок: форма идеи и действия (I1, §2.1/§3.1) ──
function deskWatchFormHTML(){
  const E=DESK_UI.wedit,w=deskWatchGet(E&&E.key);if(!w)return '';
  const I=deskItems(),px=deskWatchPx(I,w),fv=w.fv||{},L=DESK_IDEA_CFG.len,ccy=dkEsc(w.ccy),t=(o,f)=>dkEsc(o&&o[f]||'');
  const it=I.byKey[w.key],R=deskRiskLevel(it&&it.s,{plan:it&&it.s&&it.s.plans.long,beta:deskBeta(it)});
  const num=(id,v,l)=>`<label>${l}<input id="${id}" class="dk-inp dk-num" type="number" step="any" min="0" value="${v!=null?v:''}"></label>`;
  const txt=(id,v,l,n,area)=>`<label class="${area?'dk-span2':''}">${l}${area?`<textarea id="${id}" class="dk-inp" rows="3" maxlength="${n}">${v}</textarea>`:`<input id="${id}" class="dk-inp" maxlength="${n}" value="${v}">`}</label>`;
  return `<div class="dk-overlay" data-a="wx"><form class="dk-modal dk-wform" role="dialog" aria-modal="true" aria-label="${RT('Идея','Idea')} ${dkEsc(w.tk)}" onsubmit="event.preventDefault();deskWatchSubmit()" data-a="noop">
    <div class="dk-ph"><h2>${RT('Идея','Idea')} · <span class="dk-tk">${dkEsc(w.tk)}</span> <span class="dk-nm">${dkEsc(w.name)}</span></h2><button type="button" class="dk-btn dk-sm dk-ml" data-a="wx" aria-label="${RT('Закрыть','Close')}">✕</button></div>
    <div class="dk-form">
      <div class="dk-span2 dk-lbl">${RT('Зона покупки','Buy zone')} · ${RT('сейчас','now')} ${dkPx(px)} ${ccy}</div>
      ${num('dkWLo',w.buyLo,RT('Цена от','Price from')+' ('+ccy+')')}${num('dkWHi',w.buyHi,RT('до (одна цена — оставьте пустым)','to (single price — leave empty)'))}
      ${txt('dkWNote',t(w,'buyNote'),RT('Пояснение к зоне','Zone note'),L.note)}${txt('dkWTag',t(w,'tag'),RT('Категория (CORE, GROWTH…)','Category (CORE, GROWTH…)'),L.tag)}
      <div class="dk-span2 dk-lbl">${RT('Ключевой тезис','Key thesis')}</div>
      ${txt('dkWThT',t(w.thesis,'title'),RT('Заголовок','Headline'),L.title)}${txt('dkWThX',t(w.thesis,'text'),RT('1–2 предложения','1–2 sentences'),L.text,true)}
      ${txt('dkWWbT',t(w.whatBuy,'title'),RT('Что покупаю','What I buy'),L.cardTitle)}${txt('dkWWbX',t(w.whatBuy,'text'),RT('пояснение','note'),L.cardText)}
      ${txt('dkWMrT',t(w.mainRisk,'title'),RT('Главный риск','Main risk'),L.cardTitle)}${txt('dkWMrX',t(w.mainRisk,'text'),RT('пояснение','note'),L.cardText)}
      <div class="dk-span2 dk-lbl">${RT('Справедливая стоимость — сценарии','Fair value — scenarios')} (${ccy}) · ${RT('веса','weights')} ${DESK_IDEA_CFG.fvW.bear}/${DESK_IDEA_CFG.fvW.base}/${DESK_IDEA_CFG.fvW.bull}</div>
      ${num('dkWBear',fv.bear,'Bear')}${num('dkWBase',fv.base,'Base')}${num('dkWBull',fv.bull,'Bull')}
      <label>${RT('Уровень риска','Risk level')}<select id="dkWRisk" class="dk-sel"><option value="">${RT('Авто','Auto')}${R.auto?` — ${R.auto} ${dkEsc(deskRiskWord(R.auto))}`:''}</option>${[1,2,3,4,5].map(i=>`<option value="${i}"${w.riskOvr===i?' selected':''}>${i} — ${dkEsc(deskRiskWord(i))}</option>`).join('')}</select></label>
    </div>
    <div class="dk-note">${RT('Без base справедливая стоимость берётся по таргетам аналитиков. Правка зоны делает её «ручной».','Without base, fair value falls back to analyst targets. Editing the zone marks it “manual”.')}</div>
    <div class="dk-row"><button type="submit" class="dk-btn pri">${RT('Сохранить','Save')}</button><button type="button" class="dk-btn" data-a="wx">${RT('Отмена','Cancel')}</button></div>
  </form></div>`;
}
function deskWatchSubmit(){
  const E=DESK_UI.wedit,w=deskWatchGet(E&&E.key);if(!w||!can('action.edit_plan'))return;
  const g=id=>{const e=document.getElementById(id);return e?e.value:'';},n=id=>{const v=parseFloat(String(g(id)).replace(',','.'));return v>0?v:null;};
  let lo=n('dkWLo'),hi=n('dkWHi');if(hi==null)hi=lo;if(lo==null)lo=hi;
  const zoneChanged=lo!==w.buyLo||hi!==w.buyHi,bear=n('dkWBear'),base=n('dkWBase'),bull=n('dkWBull');
  if((bear||bull)&&!base)toast(RT('Без base сценарии не используются — справедливая стоимость по аналитикам','Without base, scenarios are not used — fair value by analysts'),true);
  deskWatchUpdate(w.key,{buyLo:lo,buyHi:hi,buySrc:zoneChanged?'manual':w.buySrc,buyNote:g('dkWNote'),tag:g('dkWTag'),
    thesis:{title:g('dkWThT'),text:g('dkWThX')},whatBuy:{title:g('dkWWbT'),text:g('dkWWbX')},mainRisk:{title:g('dkWMrT'),text:g('dkWMrX')},
    fv:bear||base||bull?Object.assign({},w.fv||{},{bear,base,bull}):null,riskOvr:+g('dkWRisk')||null});
  // Взведённое правило «Уведомить» следует за верхом зоны — иначе оно молча осталось бы на старом уровне.
  const rule=zoneChanged&&hi&&w.planId&&(PLAN_RULES||[]).find(r=>r.id===w.planId&&!r.done&&r.status!=='open');
  if(rule){rule.level=Math.round(hi*100)/100;rule.hitAt=0;planRuleNorm(rule);}
  DESK_UI.wedit=null;scheduleSave();toast('🛒 '+RT('Идея сохранена','Idea saved')+': '+w.tk+(rule?` · 🔔 ${RT('уведомление','alert')} ≤ ${pf3Fmt(rule.level,2)}`:''));deskRender(true);
}
function deskWatchEdit(key,f){
  if(!can('action.edit_plan'))return;
  if(!deskWatchGet(key)){const it=deskSecOf(key);if(!it)return;deskWatchAddFrom(key,true);}
  DESK_UI.wedit={key,f:f||'zone'};DESK_UI.wmenu=null;deskRender(true);
  setTimeout(()=>{const e=document.getElementById(f==='thesis'?'dkWThT':'dkWLo');if(e)e.focus();},30);
}
// «＋ В список»: зона по сигналу (лимит лонг-плана v2 или поддержка), цена на дату тезиса — текущая.
function deskWatchAddFrom(key,quiet){
  if(!can('action.edit_plan'))return null;
  const it=deskSecOf(key);if(!it)return null;
  const z=deskBuyDefault(it.s),w=deskWatchAdd(Object.assign({},it.sec,{price:it.s?it.s.price:it.sec.price}),z?{buyLo:z.lo,buyHi:z.hi,buySrc:'signal',buyNote:z.note}:{},Date.now());
  scheduleSave();
  if(!quiet){toast('🛒 '+RT('В списке покупок','In the shopping list')+`: ${it.sec.tk}`+(z?` · ${RT('зона','zone')} ${pf3Fmt(z.hi,2)} ${it.sec.ccy}`:` · ${RT('зону задайте в «Изменить»','set the zone via “Edit”')}`));deskRender(true);}
  return w;
}
// «Уведомить»: правило входа PLAN_RULES на верх зоны (сработает при касании); planId пишется в идею.
function deskWatchNotify(key){
  if(!can('action.edit_plan'))return;
  const w=deskWatchGet(key);if(!w||!w.buyHi)return toast(RT('Сначала задайте зону покупки','Set a buy zone first'),true);
  const note=String((w.thesis&&(w.thesis.title||w.thesis.text))||w.buyNote||RT('зона списка покупок','shopping-list zone')).slice(0,140);
  const patch={tab:deskRiskTab()||PF3_KEY,tk:posTk(w.tk),name:w.name,ccy:w.ccy,act:'buy',side:'long',level:Math.round(w.buyHi*100)/100,note};
  let rule=w.planId&&(PLAN_RULES||[]).find(r=>r.id===w.planId&&!r.done&&r.status!=='open');
  if(rule){Object.assign(rule,patch,{hitAt:0});planRuleNorm(rule);}
  else{rule=planRuleNorm(Object.assign({id:'pl'+Date.now()+'_'+Math.floor(Math.random()*1e4),hitAt:0,done:false,createdAt:Date.now(),stop:0,target:0,qty:0,amount:0,deadline:'',riskKr:0},patch));PLAN_RULES.push(rule);}
  deskWatchUpdate(key,{planId:rule.id});DESK_UI.wmenu=null;
  planAskNotify(true);scheduleSave();
  toast('🔔 '+RT('Уведомлю, когда','Will alert when')+` ${w.tk} ≤ ${pf3Fmt(rule.level,2)} ${w.ccy}`);deskRender(true);
}
function deskWatchDel(key){
  const w=deskWatchGet(key);if(!w||!can('action.edit_plan'))return;
  if(!confirm(RT(`Удалить ${w.tk} из списка покупок?`,`Remove ${w.tk} from the shopping list?`)))return;
  const rule=w.planId&&(PLAN_RULES||[]).find(r=>r.id===w.planId&&!r.done);
  if(rule&&confirm(RT(`Удалить и правило уведомления ${w.tk} ≤ ${pf3Fmt(rule.level,2)}?`,`Also delete the alert rule ${w.tk} ≤ ${pf3Fmt(rule.level,2)}?`)))PLAN_RULES=PLAN_RULES.filter(r=>r!==rule);
  deskWatchRemove(key);DESK_UI.wmenu=null;scheduleSave();toast('🗑 '+w.tk);deskRender(true);
}
// Перетаскивание: вниз — встаёт после цели, вверх — перед ней.
function deskWatchDrop(from,to){
  const a=deskWatchGet(from),b=deskWatchGet(to);if(!a||!b||a.status!==b.status||!can('action.edit_plan'))return deskRender(true);
  const seq=deskWatchItems(a.status,a.list),i=seq.indexOf(a),j=seq.indexOf(b);
  if(deskWatchMove(from,i<j?((seq[j+1]||{}).key||null):to))scheduleSave();
  deskRender(true);
}
function deskWatchFocus(key){
  const el=document.getElementById('dkw-'+String(key).replace(/[^A-Z0-9]/gi,'_'));
  if(el){el.focus();try{el.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});}catch(e){}}
}

// ── S7b-2: обвязка встроенных блоков классики ──
// Черновики: поля с id внутри .dk-classic (форма плана, записи сделки, чат AI, «Добавить акцию»…) переживают фоновые
// перерисовки (свечи, котировки, пул загрузок). Сбрасываются кнопкой/отправкой блока (его обработчик уже прочитал поля)
// и сменой экрана — иначе после «Добавить» форма заполнилась бы старым вводом.
function deskDraftNote(e){
  const el=e.target;if(!el||!el.id||!el.closest||!el.closest('.dk-classic'))return;
  if(el.type==='file'||el.type==='checkbox'||el.type==='radio')return;
  DESK_UI.draft[el.id]=el.value;
}
function deskDraftRestore(){
  // Другой экран/раздел/портфель (в т.ч. Back/Forward и адрес) — черновики не переносятся.
  const sk=[DESK_UI.route,DESK_UI.bt,DESK_UI.bai,DESK_UI.jt,DESK_UI.svcTab,DESK_UI.planTab,deskPort(),DESK_UI.key,planEditId].join('|');
  if(sk!==DESK_UI._draftKey){DESK_UI._draftKey=sk;DESK_UI.draft={};return;}
  const D=DESK_UI.draft;if(!D)return;
  Object.keys(D).forEach(id=>{const el=document.getElementById(id);if(el&&el.closest('#dkMain .dk-classic')&&el.value!==D[id])el.value=D[id];});
}
// «Позиции → Статистика»: график развития портфелей (pfPerfDraw) переживает фоновые перерисовки — канвас переносится,
// пока не сменились данные/настройки; иначе рисуется заново. Без графика (загрузка/ошибка) при том же ключе — ничего
// не делаем: в ключе нет failed/loading, поэтому неудачная загрузка повторяется только при новом входе в раздел.
let _deskPerfKey=null;
function deskPerfAttach(kept){
  const box=document.getElementById('pfPerfBox');if(!box){_deskPerfKey=null;return;}
  let col='';try{col=localStorage.getItem('dash_pfpcol')||'';}catch(e){}
  const key=[pfPerf.loaded,!!pfPerf.hist,pfPerf.range,JSON.stringify(pfPerf.on),col,document.documentElement.dataset.theme,LANG].join('|');
  if(key===_deskPerfKey){if(kept)box.replaceWith(kept);return;}
  // pfPerfDraw берёт контейнер до await loadLWC — пока библиотека грузится, фоновая перерисовка оставила бы его пустым.
  if(!(window.LightweightCharts&&window.LightweightCharts.createChart)){loadLWC().then(()=>deskRender(),()=>{});return;}
  _deskPerfKey=key;pfPerfDraw();
}
// После отрисовки: поллеры пре/пост (бумага «Акции», баланс «Позиций»), синк AI-портфеля, прокрутка чата AI и
// загрузки раздела — один раз на вход в раздел (у неудачной загрузки нет кэша: каждая перерисовка грузила бы заново).
function deskClassicAfter(){
  const r=DESK_UI.route,port=deskPort();
  try{const it=r==='stock'?deskSecOf(DESK_UI.key):null;if(it&&it.r&&document.getElementById('pf3PrePost'))cardPPStart(String(it.r[2]||''),it.sec.sym);else cardPPStop();}catch(e){}
  try{if(document.getElementById('pfSumPP')&&port&&port!=='all'&&port!==AIP_KEY)pfSumPPStart(port);else pfSumPPStop();}catch(e){}
  // aipStart тянет состояние воркера ДО проверки таймера, а ответ зовёт renderPF3 → deskRender: звать только без таймера.
  try{if(r==='book'&&port===AIP_KEY&&isAdmin()){if(!_aipTimer)aipStart();}else aipStop();}catch(e){}
  // Цены позиций AI-портфеля (его строки — производная вкладка): как автообновление классики — не чаще раза в 5 мин.
  if(r==='book'&&port===AIP_KEY&&DATA[AIP_KEY]&&PRICE_PROXY&&Date.now()-(pf3LastRefresh[AIP_KEY]||0)>5*60e3){
    pf3LastRefresh[AIP_KEY]=Date.now();pf3FetchPrices(DATA[AIP_KEY],AIP_KEY).then(()=>deskRender(),()=>{});}
  {const cb=document.getElementById('aiChatBox'),c=DESK_UI._chat;
    if(cb){if(c&&!c.bottom&&cb.children.length===c.n)cb.scrollTop=c.top;else try{aiChatScroll();}catch(e){}}}
  const sk=r==='book'?'book|'+DESK_UI.bt+'|'+deskOnePort():null;
  if(sk===DESK_UI._secFor)return;DESK_UI._secFor=sk;
  if(r==='book'&&DESK_UI.bt==='cal'&&document.querySelector('#dkMain .dk-classic'))pf3LoadCalendar();
  if(r==='book'&&DESK_UI.bt==='health'&&document.getElementById('pf3RiskBox'))pf3LoadRisk();
}

// ── События ──
function deskOnClick(e){
  const el=e.target.closest('[data-a]');if(!el||!document.getElementById('desk').contains(el))return;
  const a=el.dataset.a,k=el.dataset.k;
  if(a==='noop')return;
  if(a!=='menu')DESK_UI.menu=false;
  if(a!=='wmenu')DESK_UI.wmenu=null;
  if(a==='execx'){if(e.target===el||el.tagName==='BUTTON'){DESK_UI.exec=null;deskRender(true);}return;}
  if(a==='wx'){if(e.target===el||el.tagName==='BUTTON'){DESK_UI.wedit=null;deskRender(true);}return;}
  switch(a){
    case 'iv':DESK_UI.iv=el.dataset.v;DESK_UI.sel=null;deskRender(true);break;
    case 'wadd':deskWatchAddFrom(k);break;
    case 'wmenu':DESK_UI.wmenu=DESK_UI.wmenu===k?null:k;deskRender(true);setTimeout(()=>{const m=document.querySelector('#desk .dk-wmenu .dk-mi:not([disabled])');if(m)m.focus();},0);break;
    case 'wedit':deskWatchEdit(k,el.dataset.f);break;
    case 'wnotify':deskWatchNotify(k);break;
    case 'wstat':if(can('action.edit_plan')){deskWatchSetStatus(k,el.dataset.v);scheduleSave();toast((el.dataset.v==='final'?'★ ':'↩ ')+(deskWatchGet(k)||{}).tk);deskRender(true);}break;
    case 'wmove':if(can('action.edit_plan')&&deskWatchMove(k,+el.dataset.v)){scheduleSave();DESK_UI.wmenu=k;deskRender(true);setTimeout(()=>deskWatchFocus(k),0);}break;
    case 'wdel':deskWatchDel(k);break;
    case 'wname':{const l=DESK_WATCH.lists[0],v=prompt(RT('Название списка:','List name:'),l.name||RT('Список покупок','Shopping list'));if(v!=null&&can('action.edit_plan')){l.name=String(v).trim().slice(0,DESK_IDEA_CFG.len.list);DESK_WATCH=deskWatchNorm(DESK_WATCH);scheduleSave();deskRender(true);}break;}
    case 'wjump':if(DESK_UI.iv!=='watch'){DESK_UI.iv='watch';deskRender(true);setTimeout(()=>deskWatchFocus(k),80);}else deskWatchFocus(k);break;
    case 'nav':if(el.dataset.jt)DESK_UI.jt=el.dataset.jt;deskGo(el.dataset.r,el.dataset.r==='stock'?DESK_UI.key:null);break;
    case 'open':deskGo('stock',k,'decision');break;
    case 'view':deskStockView(el.dataset.v);break;
    case 'wiopen':deskDetSave('st-wi',true);deskRender(true);setTimeout(()=>{const i=document.getElementById('dkWiV');if(i){i.focus();try{i.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});}catch(x){}}},40);break;
    case 'refresh1':deskRefreshOne(k);break;
    case 'cmp':deskCmpToggleKey(k);break;   // P4: чекбокс «Сравнить» и ✕ в лотке/заголовке сравнения
    case 'cmpclr':DESK_UI.compare.keys=[];DESK_UI.compare.dropped=0;deskRender(true);break;
    case 'cfinal':deskCompareFinal(k);break;
    case 'cmpback':deskCompareBack();break;
    case 'cmpref':deskCompareRefresh();break;
    case 'newsre':if(NEWS_LIVE[k])NEWS_LIVE[k].at=0;deskPoolRun('news|'+k,()=>pf3NewsEnsure(k,el.dataset.ccy));deskRender(true);break;
    case 'sel':DESK_UI.sel=DESK_UI.sel===k?null:k;deskRender(true);break;
    case 'unsel':DESK_UI.sel=null;deskRender(true);break;
    case 'fv':DESK_UI.f.v=el.dataset.v;deskRender(true);break;
    case 'fnear':DESK_UI.f.near=!DESK_UI.f.near;deskRender(true);break;
    case 'frr':DESK_UI.f.rr=!DESK_UI.f.rr;deskRender(true);break;
    case 'fheld':DESK_UI.f.held=!DESK_UI.f.held;deskRender(true);break;
    case 'sort':{const s=el.dataset.s;if(DESK_UI.sort.k===s)DESK_UI.sort.d*=-1;else DESK_UI.sort={k:s,d:(s==='tk'||s==='dEntry'||s==='near')?1:-1};deskRender(true);break;}
    case 'side':DESK_UI.side[k]=el.dataset.v;{const st=_deskChart&&_deskChart.key===k?_deskChart:_deskMini&&_deskMini.key===k?_deskMini:null;if(st&&st.ch){st.side=el.dataset.v;st.ch.setSide(el.dataset.v);}}deskRender(true);break;
    case 'years':DESK_UI.years=+el.dataset.v===3?3:1;deskRender(true);break;
    case 'earn':deskEarnSet(!deskEarnOn());deskRender(true);break;
    case 'plan':deskPlanAdd(k,el.dataset.side);break;
    case 'wimode':deskWiSave({mode:el.dataset.v==='weight'?'weight':'amount'});deskRender(true);setTimeout(()=>{const i=document.getElementById('dkWiV');if(i)i.focus();},0);break;
    case 'wiq':deskWiSave({mode:'amount',amountSEK:+el.dataset.v});deskRender(true);break;
    case 'wiplan':deskPlanAdd(k,el.dataset.side,+el.dataset.q);break;
    case 'wiexec':deskExecOpen(k,el.dataset.side,'open',el.dataset.tab,null,+el.dataset.q);break;
    case 'exec':deskExecOpen(k,el.dataset.side,'open');break;
    case 'close':deskExecOpen(el.dataset.key,null,'close',el.dataset.tab,k,+el.dataset.q||0);break;
    case 'pm-accept':deskPosMeta(el.dataset.tab,k,{stop:+el.dataset.stop,stop0:+el.dataset.stop,target:+el.dataset.target},RT('Стоп и цель заданы','Stop & target set'));break;
    case 'pm-be':{const p=bookPositions(el.dataset.tab).find(x=>x.tk===posTk(k));if(p)deskPosMeta(el.dataset.tab,k,{stop:p.entry},RT('Стоп в безубыток','Stop to breakeven')+' '+pf3Fmt(p.entry,2));break;}
    case 'pm-trail':deskPosMeta(el.dataset.tab,k,{stop:+el.dataset.stop},RT('Трейлинг-стоп','Trailing stop')+' '+pf3Fmt(+el.dataset.stop,2));break;
    case 'pm-edit':DESK_UI.edit={key:el.dataset.tab+'|'+posTk(k)};deskRender(true);break;
    case 'pm-cancel':DESK_UI.edit=null;deskRender(true);break;
    case 'pm-save':{const st=parseFloat((document.getElementById('dkEdStop')||{}).value),tg=parseFloat((document.getElementById('dkEdTgt')||{}).value);
      const p=bookPositions(el.dataset.tab).find(x=>x.tk===posTk(k));if(!p)break;
      const ck=posLevelsCheck(p.side,p.calc?p.calc.now:p.entry,st>0?st:0,tg>0?tg:0);
      if(!ck.ok)return toast(RT('Стоп/цель не с той стороны от цены','Stop/target on the wrong side of the price'),true);
      DESK_UI.edit=null;deskPosMeta(el.dataset.tab,k,Object.assign({side:p.side,stop:st>0?st:null,target:tg>0?tg:null},p.hasMeta?{}:{stop0:st>0?st:null}),RT('Сохранено','Saved'));break;}
    case 'planx':if(confirm(RT('Удалить правило плана?','Delete this plan rule?'))){PLAN_RULES=(PLAN_RULES||[]).filter(r=>r.id!==el.dataset.id);scheduleSave();deskRender(true);}break;
    case 'plandone':{const r=(PLAN_RULES||[]).find(x=>x.id===el.dataset.id);if(r){r.done=true;r.hitAt=0;planRuleNorm(r);scheduleSave();deskRender(true);}break;}
    case 'jt':DESK_UI.jt=el.dataset.v;deskRender(true);break;
    case 'jtrack':deskJournalTrack(k);break;   // P5b: «Отслеживать результат»
    case 'jexport':{const R=deskJournalCur();if(!R.error&&R.items.length)deskJournalExportTrigger(R.items,Date.now());break;}
    case 'jclear':{const R=deskJournalCur(),n=R.error?0:R.items.filter(r=>r&&r.status==='complete').length;
      if(!n||!confirm(RT(`Удалить ${n} завершённых наблюдений? Ожидающие не трогаются. Удаление не отменить — сначала сделайте экспорт.`,`Delete ${n} completed tracked ideas? Pending ones stay. This cannot be undone — export first.`)))break;
      const c=deskJournalClearCompletedAndSave();_deskJ=null;toast(c.ok?RT(`Удалено завершённых: ${c.removed}`,`Completed removed: ${c.removed}`):RT('Не удалось очистить: ','Could not clear: ')+c.error,!c.ok);deskRender(true);break;}
    case 'finm':DESK_UI.finM=el.dataset.v;deskRender(true);break;
    case 'finre':if(_deskFin[k])_deskFin[k].at=0;deskFinLoad(k);deskRender(true);break;
    case 'fund':if(PF_FUND[k]&&!PF_FUND[k].data)delete PF_FUND[k];deskPoolRun('fund|'+k,()=>pf3FundFetch([k]));deskRender(true);break;   // «Повторить» снимает негативный кэш
    case 'refresh':DESK_UI.load.at=0;deskQuotes(true);deskLoad(true);break;
    case 'menu':DESK_UI.menu=!DESK_UI.menu;deskRender(true);break;
    case 'theme':DESK_UI.menu=false;toggleTheme();deskRender(true);break;
    case 'lang':DESK_UI.menu=false;toggleLang();break;
    case 'risk':DESK_UI.menu=false;deskRiskEdit();break;
    case 'tg':{if(!can('action.edit_plan'))return;DESK_UI.menu=false;DESK=deskNorm(Object.assign({},DESK,{tg:!deskNorm(DESK).tg}));scheduleSave();deskRender(true);
      toast('📨 '+(DESK.tg?RT('Telegram по стопам и лимитам включён','Telegram stop & limit alerts on'):RT('Telegram по стопам и лимитам выключен','Telegram stop & limit alerts off')));break;}
    // S7b-2: разделы книги, редактор плана, «Сервис», правка позиции
    case 'bt':DESK_UI.bt=el.dataset.v;DESK_UI.draft={};deskRender(true);break;
    case 'bai':DESK_UI.bai=el.dataset.v;DESK_UI.draft={};deskRender(true);break;
    case 'booksec':DESK_UI.bt=el.dataset.v;if(el.dataset.sub)DESK_UI.bai=el.dataset.sub;if(DESK_UI.port===AIP_KEY||DESK_UI.port==='all')DESK_UI.port=deskRiskTab();deskGo('book');break;
    case 'planed':{const r=(PLAN_RULES||[]).find(x=>x.id===el.dataset.id);if(!r||!can('action.edit_plan'))break;
      planEditId=r.id;DESK_UI.planTab=r.tab||PF3_KEY;DESK_UI.draft={};deskDetSave('j-plan-ed',true);deskRender(true);
      setTimeout(()=>{const e2=document.getElementById('planE_lvl')||document.getElementById('dkPlanEd');if(e2){try{e2.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});}catch(x){}if(e2.focus)e2.focus({preventScroll:true});}},40);break;}
    case 'service':DESK_UI.menu=false;deskGo('service');break;
    case 'svctab':DESK_UI.svcTab=el.dataset.v;DESK_UI.draft={};deskRender(true);break;
    case 'svcnew':{if(!isAdmin())break;const before=Object.keys(DATA).length;pf3NewTab();if(Object.keys(DATA).length>before&&DATA[v3Key])DESK_UI.svcTab=v3Key;deskRender(true);break;}
    case 'svcren':if(isAdmin()&&deskCtx(el.dataset.v,'list'))pf3RenameTab();break;
    case 'svcdel':if(isAdmin())pf3TabDelete(el.dataset.v);break;
    case 'svctypes':if(can('action.refresh_data')&&deskCtx(el.dataset.v,'list'))pf3ForceTypes();break;
    case 'svcrm':if(isAdmin()&&deskSvcTab()!==AIP_KEY&&deskCtx(deskSvcTab(),'list'))pf3Delete(el.dataset.v);break;
    case 'svcrun':{const v=el.dataset.v;   // прогресс функции пишут в кнопку по id; по завершении — renderAll → deskRender
      if(v==='homeUpdateAll'&&can('action.refresh_data'))homeUpdateAll();else if(v==='valUpdateAll'&&isAdmin())valUpdateAll();else if(v==='insiderUpdateAll'&&isAdmin())insiderUpdateAll();break;}
    case 'pos-fix':if(!can('action.edit_trades'))break;DESK_UI.fix={key:el.dataset.tab+'|'+posTk(k)};DESK_UI.edit=null;deskRender(true);setTimeout(()=>{const i=document.getElementById('dkFxQty');if(i)i.focus();},30);break;
    case 'pos-fix-x':DESK_UI.fix=null;deskRender(true);break;
    case 'pos-fix-save':{const q=parseFloat(String((document.getElementById('dkFxQty')||{}).value).replace(',','.')),av=parseFloat(String((document.getElementById('dkFxAvg')||{}).value).replace(',','.'));
      if(!confirm(RT(`Исправить позицию ${posTk(k)}: ${q} шт по средней ${av}? Сделка не записывается — журнал, налоги и кэш не меняются.`,`Fix position ${posTk(k)}: ${q} sh at average ${av}? No trade is recorded — journal, tax and cash stay unchanged.`)))break;
      const r=deskPosFix(el.dataset.tab,k,q,av);if(r.err){toast(r.err,true);break;}
      DESK_UI.fix=null;toast('✏️ '+posTk(k)+': '+RT('позиция исправлена','position fixed'));deskRender(true);break;}
    case 'settings':DESK_UI.menu=false;deskRender(true);toggleSettings();break;
    case 'prompts':DESK_UI.menu=false;deskRender(true);togglePrompts();break;
    case 'gloss':DESK_UI.menu=false;deskRender(true);deskGlossOpen();break;
    case 'gtip':e.preventDefault();if(typeof deskTipToggle==='function')deskTipToggle(el,e.detail===0);break;   // G2: ⓘ (preventDefault — не сворачивать <details>)
    case 'faq':DESK_UI.menu=false;deskRender(true);toggleFaq();break;
    case 'logout':DESK_UI.menu=false;handleLogout();break;
  }
}
function deskPosMeta(tab,tk,patch,msg){
  if(!can('action.edit_trades'))return;
  posMetaSet(tab,tk,patch);scheduleSave();toast('📍 '+posTk(tk)+': '+msg);deskRender(true);
}
function deskRiskEdit(){
  const D=deskNorm(DESK),v=prompt(RT('Риск на сделку, % капитала портфеля (0.1–5) и лимит открытого риска книги, % (1–30), через пробел:','Risk per trade, % of portfolio equity (0.1–5) and book open-risk cap, % (1–30), space-separated:'),D.riskPct+' '+D.riskCapPct);
  if(v==null)return;
  const [a,b]=String(v).replace(/,/g,'.').trim().split(/\s+/).map(parseFloat);
  DESK=deskNorm(Object.assign({},DESK,{riskPct:a,riskCapPct:isFinite(b)?b:D.riskCapPct}));scheduleSave();deskRender(true);   // остальные поля (whatIf, shortOk, tg) не теряются
  toast('⚖️ '+RT('Риск ','Risk ')+DESK.riskPct+'% · '+RT('лимит книги ','book cap ')+DESK.riskCapPct+'%');
}
function deskOnChange(e){
  const el=e.target,c=el.dataset&&el.dataset.c;if(!c)return;
  if(c==='port'){DESK_UI.port=el.value;DESK_UI.planTab=null;DESK_UI.draft={};_deskItems=null;deskRender(true);}
  else if(c==='plantab'){DESK_UI.planTab=el.value;planEditId=null;DESK_UI.draft={};deskRender(true);}
  else if(c==='fsector'){DESK_UI.f.sector=el.value;deskRender(true);}
  else if(c==='expo'&&DESK_UI.exec){DESK_UI.exec.tab=el.value;deskExecRisk();}
  else if(c==='wiport'){deskWiSave({port:el.value});deskWhatIfRecalc();}
  else if(c==='wiv'){   // подтверждение ввода: нормализованное значение сохраняется (синк), поле показывает его
    clearTimeout(_deskWiT);const w=deskWiCfg(),v=parseFloat(String(el.value).replace(',','.'));
    deskWiSave(w.mode==='weight'?{weightPct:v}:{amountSEK:v});const n=deskWiCfg();el.value=n.mode==='weight'?n.weightPct:n.amountSEK;
    if(DESK_UI.route==='compare')deskRender(true);else deskWhatIfRecalc();}   // P4: в сравнении бюджет общий для всех колонок
  else if(c==='fside'){DESK_UI.f.side=el.value;deskRender(true);}
  else if(c==='fphase'){DESK_UI.f.phase=el.value;deskRender(true);}
  else if(c==='ftab'){DESK_UI.f.tab=el.value;deskRender(true);}
  else if(c==='risk'){const v=parseFloat(el.value);if(v>0)DESK_UI.riskOvr[el.dataset.k]=Math.round(v);else delete DESK_UI.riskOvr[el.dataset.k];el.blur();deskRender(true);}
  else if(c==='shortok'){if(!can('action.edit_plan'))return;const so=Object.assign({},DESK.shortOk||{});if(el.checked)so[el.dataset.k]=1;else delete so[el.dataset.k];DESK=deskNorm(Object.assign({},DESK,{shortOk:so}));scheduleSave();deskRender(true);}
}
let _deskQT=0;
function deskOnInput(e){
  const el=e.target,c=el.dataset&&el.dataset.c;
  if(c==='fq'){clearTimeout(_deskQT);_deskQT=setTimeout(()=>{DESK_UI.f.q=el.value;const pos=el.selectionStart;deskPaint();const n=document.querySelector('#desk [data-c="fq"]');if(n){n.focus();try{n.setSelectionRange(pos,pos);}catch(x){}}},180);}
  else if(c==='gq')deskSuggest(el.value);
  else if(c==='wiv'){DESK_UI.wiRaw=el.value;clearTimeout(_deskWiT);_deskWiT=setTimeout(deskWhatIfRecalc,DESK_IDEA_CFG.whatIf.debounceMs);}
  else if(DESK_UI.exec&&/^dkEx/.test(el.id||'')){
    const f={dkExQty:'qty',dkExPx:'price',dkExStop:'stop',dkExTgt:'target',dkExPort:'tab',dkExDate:'date'}[el.id];
    if(f){DESK_UI.exec[f]=f==='tab'||f==='date'?el.value:(parseFloat(el.value)||0);deskExecRisk();}
  }
  else if(DESK_UI.edit&&(el.id==='dkEdStop'||el.id==='dkEdTgt'))DESK_UI.edit[el.id==='dkEdStop'?'stop':'target']=el.value;
  else if(DESK_UI.fix&&(el.id==='dkFxQty'||el.id==='dkFxAvg'))DESK_UI.fix[el.id==='dkFxQty'?'qty':'avg']=el.value;
}
// Строка риска и блокировка кнопки в окне исполнения — на месте, без перерисовки (фокус не прыгает).
function deskExecRisk(){
  const x=DESK_UI.exec,box=document.getElementById('dkExRisk');if(!x||!box)return;
  box.innerHTML=deskExecRiskHTML(x);
  const b=document.getElementById('dkExGo');if(b)b.disabled=x.mode==='open'&&!deskExecCap(x).ok;
}
function deskExecCap(x){
  const rs=x.tab&&DATA[x.tab]?bookRiskState(x.tab):null,add=x.mode==='open'&&x.stop>0?x.qty*Math.abs(x.price-x.stop)*(FX[x.ccy]||1):0;
  return Object.assign({rs,add},rs?deskCapCheck(rs,add):{ok:true,left:0});
}
function deskExecRiskHTML(x){
  if(x.mode!=='open')return '';
  const c=deskExecCap(x);if(!c.rs)return '';
  return `<div class="dk-note">${RT('Риск сделки ','Trade risk ')}<b class="dk-num">${dkKr(c.add)}</b> · ${RT('открытый риск книги ','book open risk ')}${dkKr(c.rs.openRiskSEK)} ${RT('из','of')} ${dkKr(c.rs.capSEK)} (${deskNorm(DESK).riskCapPct}%)</div>${c.ok?'':`<div class="dk-warn">⛔ ${RT('Лимит открытого риска книги превышен — исполнение заблокировано. Добавьте в план или уменьшите размер/стоп.','Book open-risk cap exceeded — execution blocked. Add to plan or reduce size/stop.')}</div>`}`;
}
let _deskSg={cur:0,hits:[]};
function deskSuggest(v){
  const sg=document.getElementById('dkSugg');if(!sg)return;
  const q=String(v||'').trim().toLowerCase();if(!q){sg.hidden=true;_deskSg.hits=[];return;}
  const I=deskItems();
  const hits=I.items.filter(x=>x.sec.tk.toLowerCase().startsWith(q)).concat(I.items.filter(x=>!x.sec.tk.toLowerCase().startsWith(q)&&(x.sec.tk.toLowerCase().includes(q)||x.sec.name.toLowerCase().includes(q)))).slice(0,10);
  _deskSg={cur:Math.min(_deskSg.cur,Math.max(0,hits.length-1)),hits};
  sg.innerHTML=hits.map((x,i)=>`<div class="${i===_deskSg.cur?'on':''}" data-a="open" data-k="${dkEsc(x.key)}"><b>${dkEsc(x.sec.tk)}</b><span>${dkEsc(x.sec.name)}</span><span class="dk-mut dk-ml">${x.s?dkPill(x.s.verdict,!!x.sec.held.length):''}</span></div>`).join('');
  sg.hidden=!hits.length;
}
function deskOnInputKey(e){
  const el=e.target;if(!el.dataset||el.dataset.c!=='gq')return;
  const n=_deskSg.hits.length;
  if(e.key==='ArrowDown'&&n){_deskSg.cur=(_deskSg.cur+1)%n;deskSuggest(el.value);e.preventDefault();}
  else if(e.key==='ArrowUp'&&n){_deskSg.cur=(_deskSg.cur-1+n)%n;deskSuggest(el.value);e.preventDefault();}
  else if(e.key==='Enter'&&n){const x=_deskSg.hits[_deskSg.cur];el.value='';el.blur();deskGo('stock',x.key,'decision');}
  else if(e.key==='Escape'){el.value='';deskSuggest('');el.blur();}
}
function deskOnKey(e){
  // Словарь открыт: только Esc (закрыть), остальные клавиши экрана под панелью не работают.
  if(typeof deskGlossIsOpen==='function'&&deskGlossIsOpen()){if(e.key==='Escape'){e.preventDefault();deskGlossClose();}return;}
  if(e.key==='Escape'&&typeof deskTipIsOpen==='function'&&deskTipIsOpen()){e.preventDefault();deskTipHide(true);return;}   // G2: подсказка — первой
  const t=(e.target&&e.target.tagName||'').toLowerCase(),modal=e.key==='Escape'&&(DESK_UI.wedit||DESK_UI.exec);
  if((t==='input'||t==='select'||t==='textarea'||e.metaKey||e.ctrlKey||e.altKey)&&!modal)return;
  if(document.querySelector('.faq-overlay:not(.hidden),.auth-overlay:not(.hidden)'))return;
  if(e.key==='Escape'){if(DESK_UI.wedit){DESK_UI.wedit=null;deskRender(true);}else if(DESK_UI.wmenu){const k=DESK_UI.wmenu;DESK_UI.wmenu=null;deskRender(true);setTimeout(()=>{const b=document.querySelector(`#desk .dk-wmore[data-k="${CSS.escape(k)}"]`);if(b)b.focus();},0);}else if(DESK_UI.exec){DESK_UI.exec=null;deskRender(true);}else if(DESK_UI.menu){DESK_UI.menu=false;deskRender(true);}else if(DESK_UI.sel){DESK_UI.sel=null;deskRender(true);}return;}
  // Вкладки режима «Акции» (роль tab): стрелки/Home/End — соседний режим с автоматической активацией.
  const tb=e.target.closest&&e.target.closest('#desk .dk-views [role="tab"]');
  if(tb&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
    e.preventDefault();const i=DK_VIEWS.indexOf(tb.dataset.v),n=DK_VIEWS.length;
    const v=DK_VIEWS[e.key==='Home'?0:e.key==='End'?n-1:(i+(e.key==='ArrowRight'?1:n-1))%n];
    const nb=document.getElementById('dkTab-'+v);if(nb)nb.focus();   // фокус переживёт перерисовку по id
    deskStockView(v);return;
  }
  const o=e.target.closest&&e.target.closest('#desk [data-a="open"]');
  if(e.key==='Enter'&&o&&o.tagName!=='BUTTON'&&e.target.closest('[data-a]')===o){deskGo('stock',o.dataset.k,'decision');return;}
  // P6: карточки подборок «Идей» (data-a="sel", tabindex=0) реагировали только на клик мышью —
  // Enter/Space на сфокусированной карточке ничего не делали. Активируем тем же путём, что клик (deskOnClick).
  const sc=e.target.closest&&e.target.closest('#desk [data-a="sel"][tabindex="0"]');
  if((e.key==='Enter'||e.key===' ')&&sc&&e.target.closest('[data-a]')===sc){e.preventDefault();deskOnClick({target:sc});return;}
  if(e.key==='/'){e.preventDefault();const q=document.getElementById('dkQ');if(q)q.focus();return;}
  if(e.key==='?'&&typeof deskGlossOpen==='function'){e.preventDefault();if(DESK_UI.menu){DESK_UI.menu=false;deskRender(true);}deskGlossOpen();return;}
  if(/^[1-5]$/.test(e.key)){deskGo(['today','screen','stock','book','journal'][+e.key-1]);return;}
  if(DESK_UI.route==='screen'&&(e.key==='j'||e.key==='k'||e.key==='Enter')){
    const rows=[...document.querySelectorAll('#desk .dk-scr tr[data-a="sel"]')];if(!rows.length)return;
    if(e.key==='Enter'){if(DESK_UI.sel)deskGo('stock',DESK_UI.sel);return;}
    let i=rows.findIndex(r=>r.dataset.k===DESK_UI.sel);i=e.key==='j'?Math.min(rows.length-1,i+1):Math.max(0,i-1);
    DESK_UI.sel=rows[i].dataset.k;deskPaint();
    const r2=document.querySelector(`#desk .dk-scr tr[data-k="${CSS.escape(DESK_UI.sel)}"]`);if(r2)r2.scrollIntoView({block:'nearest'});
  }
}
// Вход: desk — всегда (S7b-3); старые ?desk=0 и localStorage dash_desk игнорируются.
function deskBoot(){
  document.addEventListener('keydown',deskOnKey);
  // Back/Forward: экран, бумага и режим — из адреса, прокрутка — из history.state записи (deskHistSave).
  window.addEventListener('popstate',e=>{deskFromHash();const y=e.state&&e.state.dkY;DESK_UI._restoreY=typeof y==='number'?y:null;deskRender(true);});
  window.addEventListener('hashchange',()=>{deskFromHash();deskRender(true);});
  document.addEventListener('click',e=>{if((DESK_UI.menu||DESK_UI.wmenu)&&!e.target.closest('.dk-menu-w')&&!e.target.closest('#desk [data-a]')){DESK_UI.menu=false;DESK_UI.wmenu=null;deskRender(true);}});
  document.documentElement.classList.add('desk');document.documentElement.classList.remove('ui2');
  deskEnable();
}
deskBoot();

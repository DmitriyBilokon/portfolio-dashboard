// 🖥 Trade Desk — новая оболочка (S6 редизайна, слой 5 plans/redesign-integration.md) за флагом dash_desk
// (localStorage; ?desk=1 включает, ?desk=0 выключает). Пять экранов: Сегодня · Скринер · Акция · Позиции · Журнал.
// Данные — глобалы приложения (DATA, POS_META, PLAN_RULES, PF_TRADES, DESK, FX), вселенная — deskUniverse,
// сигналы — SIG через адаптер sigSnapRow (свечи ?history= в общем кэше _histCache), график — stockChartDraw.
// Грузится ПОСЛЕДНИМ (после app-5.js). Старые экраны живут до S7: при активном desk renderAll/renderPF3
// перерисовывают его (deskRender), классический вид открывается через deskClassic() и возвращается кнопкой.
// Чистые функции (ядро ниже) покрыты тестами в tests/cases-app.js; DOM — после маркера «── DOM ──».

// ── Ядро (чистые функции) ──────────────────────────────────────────────────
// Флаг из URL/локального хранилища: ?desk=1|0 перекрывает и запоминается (set), иначе — сохранённое значение.
function deskFlagFrom(search,ls){
  const m=/[?&]desk=([01])(?:&|$)/.exec(String(search||''));
  return m?{on:m[1]==='1',set:m[1]}:{on:ls==='1',set:null};
}
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
// Строки скринера: фильтры f = {v, side, phase, tab, near, rr, held, q}, сортировка {k, d}. Бумаги без снимка
// (свечи ещё грузятся) видны только без сигнальных фильтров и идут в конце.
function deskScreenRows(items,f,sort){
  f=f||{};const q=String(f.q||'').trim().toLowerCase(),sigF=(f.v&&f.v!=='all')||(f.side&&f.side!=='all')||(f.phase&&f.phase!=='all')||f.near||f.rr;
  const R=(items||[]).filter(x=>{
    const s=x.s,sec=x.sec||{};
    if(q&&!(String(sec.tk||'').toLowerCase().includes(q)||String(sec.name||'').toLowerCase().includes(q)))return false;
    if(f.tab&&f.tab!=='all'&&!(sec.tabs||[]).includes(f.tab))return false;
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
// Гистограмма результатов в R: корзины −3…+5 (крайние собирают хвосты).
function deskRBins(Rs){
  const bins=[-3,-2,-1,0,1,2,3,4,5],n=bins.map(()=>0);
  (Rs||[]).forEach(r=>{if(r==null||!isFinite(r))return;const k=Math.max(-3,Math.min(5,Math.floor(r)));n[bins.indexOf(k)]++;});
  return {bins,n};
}

// ── DOM ────────────────────────────────────────────────────────────────────
const DESK_LS='dash_desk';
let DESK_UI={on:false,classic:false,route:'today',key:null,sel:null,side:{},years:1,port:null,jt:'mine',
  f:{v:'all',side:'all',phase:'all',tab:'all',near:false,rr:false,held:false,q:''},sort:{k:'verdict',d:-1},
  riskOvr:{},exec:null,edit:null,menu:false,load:{busy:false,done:0,total:0,at:0},calAt:0,qAt:0,_t:0,_pending:false,_timer:null};
let _deskChart=null,_deskMini=null;   // состояния stockChartDraw: {key,tab,row,ccy,years,side,ch}
const deskActive=()=>!!(DESK_UI.on&&!DESK_UI.classic);
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
const dkPill=(v,held)=>{const p=DK_V[v]||DK_V.wait,lbl=v==='trim'&&!held?RT('Перегрев','Overheated'):p[1]();return `<span class="dk-pill v-${dkEsc(v)}">${p[0]} ${lbl}</span>`;};
const dkSide=s=>`<span class="dk-pill side-${s==='short'?'short':'long'}">${s==='short'?'▼ '+RT('Шорт','Short'):'▲ '+RT('Лонг','Long')}</span>`;
const dkPhase=s=>`<span class="dk-tag" title="${s.trendUp?'SMA50 > SMA200':'SMA50 < SMA200'}">${DK_PH[s.phase.key]||''} ${dkEsc(T(s.phase.label))} <span class="dk-mut">${s.trendUp?'↑':'↓'}</span></span>`;
const dkFlags=s=>(s.flags||[]).filter(f=>DK_FLAG[f]&&f!=='atr-target').map(f=>`<span class="dk-flag">${DK_FLAG[f]()}</span>`).join(' ');
const dkActPill=a=>{const x=DK_ACT[a]||DK_ACT.hold;return `<span class="dk-pill v-${x[2]}">${x[0]} ${x[1]()}</span>`;};
const dkDay=d=>d==null||!isFinite(d)?'':`<span class="dk-num ${d>=0?'dk-up':'dk-dn'}">${dkPct(d,2)}</span>`;

// Мои портфели (редактируемые, разрешённые RBAC) и выбранный для риска/книги.
function deskPorts(){return Object.keys(DATA||{}).filter(k=>pf3MyPort(k)&&tabAllowed(k));}
function deskPort(){const P=deskPorts();if(DESK_UI.port&&(DESK_UI.port==='all'||P.includes(DESK_UI.port)))return DESK_UI.port;return P.includes(PF3_KEY)?PF3_KEY:(P[0]||null);}
function deskRiskTab(){const p=deskPort();return p&&p!=='all'?p:(deskPorts()[0]||null);}
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

// ── Флаг, монтирование, перерисовка ──
function deskSetFlag(on){try{localStorage.setItem(DESK_LS,on?'1':'0');}catch(e){}}
function deskToggle(on){
  DESK_UI.on=!!on;DESK_UI.classic=false;deskSetFlag(on);
  const de=document.documentElement;de.classList.toggle('desk',!!on);
  let ui2=true;try{ui2=localStorage.getItem('dash_ui2')!=='0';}catch(e){}
  de.classList.toggle('ui2',!on&&ui2);
  if(on)deskEnable();else{deskStopTimers();deskBackBtn(false);init();}
}
function deskEnable(){
  deskMount();
  try{homeFutStop();sectStop();aipStop();pfSumPPStop();pf3StopAutoRefresh();}catch(e){}
  // Старые экраны не рисуются, пока desk активен; их устаревший DOM убираем, чтобы id не дублировались.
  ['pf3Area','rankingArea'].forEach(id=>{const e=document.getElementById(id);if(e)e.innerHTML='';});
  const tb=document.getElementById('tbody');if(tb)tb.innerHTML='';
  deskFromHash();deskBackBtn(false);deskRender(true);
  deskLoad();deskQuotes();
  if(!DESK_UI._timer)DESK_UI._timer=setInterval(()=>{if(deskActive()&&!document.hidden){deskQuotes();deskLoad();}},5*60e3);
}
function deskStopTimers(){if(DESK_UI._timer){clearInterval(DESK_UI._timer);DESK_UI._timer=null;}deskChartsDrop();}
function deskMount(){
  let el=document.getElementById('desk');
  if(el)return el;
  el=document.createElement('div');el.id='desk';el.className='dk-app';
  el.innerHTML=`<nav class="dk-rail" aria-label="${RT('Навигация','Navigation')}" id="dkRail"></nav><main class="dk-main" id="dkMain" tabindex="-1"></main><div id="dkModal"></div>`;
  document.body.insertBefore(el,document.body.firstChild);
  el.addEventListener('click',deskOnClick);
  el.addEventListener('change',deskOnChange);
  el.addEventListener('input',deskOnInput);
  el.addEventListener('keydown',deskOnInputKey);
  el.addEventListener('focusout',e=>{if(e.target&&e.target.id==='dkQ')setTimeout(()=>{const sg=document.getElementById('dkSugg');if(sg&&document.activeElement!==e.target)sg.hidden=true;},200);if(DESK_UI._pending)setTimeout(()=>{if(DESK_UI._pending&&!deskTyping())deskRender();},120);});
  return el;
}
const deskTyping=()=>{const a=document.activeElement,el=document.getElementById('desk');return !!(a&&el&&el.contains(a)&&/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));};
// Перерисовка с дебаунсом (renderAll/renderPF3 зовут её часто). Фоновая перерисовка не ломает ввод: пока фокус
// в поле desk, она откладывается до ухода фокуса. force — действие пользователя, рисуем сразу.
function deskRender(force){
  if(!deskActive())return;
  if(!force&&deskTyping()){DESK_UI._pending=true;return;}
  clearTimeout(DESK_UI._t);
  DESK_UI._t=setTimeout(deskPaint,force?0:60);
}
function deskFromHash(){
  const h=String(location.hash||'');if(!/^#desk\//.test(h))return;
  const [r,k]=h.slice(6).split('/');
  if(['today','screen','stock','book','journal'].includes(r))DESK_UI.route=r;
  if(k)DESK_UI.key=decodeURIComponent(k);
}
function deskGo(r,key){
  if(key)DESK_UI.key=key;
  DESK_UI.route=r;DESK_UI.menu=false;DESK_UI.exec=null;DESK_UI.edit=null;
  const h='#desk/'+r+(r==='stock'&&DESK_UI.key?'/'+encodeURIComponent(DESK_UI.key):'');
  if(location.hash!==h){try{history.pushState(null,'',h);}catch(e){location.hash=h;}}
  deskRender(true);
  const m=document.getElementById('dkMain');if(m)try{window.scrollTo(0,0);}catch(e){}
}
// Графики: при перерисовке того же экрана канвас переносится в новый контейнер (без перерисовки и мигания).
function deskChartsDrop(){[_deskChart,_deskMini].forEach(st=>{if(st&&st.ch){try{st.ch.destroy();}catch(e){}st.ch=null;}});_deskChart=null;_deskMini=null;}
function deskPaint(){
  if(!deskActive())return;
  DESK_UI._pending=false;_deskItems=null;
  const root=deskMount(),main=document.getElementById('dkMain'),rail=document.getElementById('dkRail');
  rail.innerHTML=deskRailHTML();
  const keep={};['dkChart','dkMini'].forEach(id=>{const e=document.getElementById(id);if(e&&e.firstChild)keep[id]=e;});
  const scr=window.scrollY||0;
  let html='';
  try{html=({today:deskTodayHTML,screen:deskScreenHTML,stock:deskStockHTML,book:deskBookHTML,journal:deskJournalHTML})[DESK_UI.route]();}
  catch(e){console.error(e);html=`<div class="dk-panel dk-empty">${RT('Ошибка экрана: ','Screen error: ')}${dkEsc(e.message||e)}</div>`;}
  main.innerHTML=deskTopHTML()+html;
  // Вселенная сменилась (вход/синк/RBAC/новые вкладки) — догрузить свечи новых бумаг (кэшированные пропускаются).
  const L=DESK_UI.load,I=deskItems();
  if(!L.busy&&L.at&&L.key!==I.items.length+'|'+I.tabsN)setTimeout(()=>deskLoad(true),0);
  document.getElementById('dkModal').innerHTML=deskModalHTML();
  deskChartsAttach(keep);
  try{window.scrollTo(0,scr);}catch(e){}
  document.title=RT('Trade Desk','Trade Desk')+' · '+deskRouteLabel(DESK_UI.route);
  root.classList.toggle('dk-drawer-open',DESK_UI.route==='screen'&&!!DESK_UI.sel);
}
function deskChartsAttach(keep){
  // Акция: большой график; Скринер: мини-график инспектора. Контейнер тот же бумаги/периода → переносим канвас.
  const want=[];
  if(DESK_UI.route==='stock'){const it=deskSecOf(DESK_UI.key);if(it&&it.r)want.push(['dkChart',it,DESK_UI.years,'_deskChart']);}
  if(DESK_UI.route==='screen'&&DESK_UI.sel){const it=deskSecOf(DESK_UI.sel);if(it&&it.r)want.push(['dkMini',it,1,'_deskMini']);}
  const used={_deskChart:false,_deskMini:false};
  want.forEach(([id,it,years,slot])=>{
    const box=document.getElementById(id);if(!box)return;used[slot]=true;
    const cur=slot==='_deskChart'?_deskChart:_deskMini,side=deskSideFor(it);
    if(cur&&cur.key===it.key&&cur.years===years){
      if(cur.ch&&keep[id]){box.replaceWith(keep[id]);if(cur.side!==side){cur.side=side;cur.ch.setSide(side);}return;}
      if(cur._loading){cur.side=side;return;}   // рисуется: stockChartDraw сам найдёт новый контейнер по id
    }
    if(cur&&cur.ch){try{cur.ch.destroy();}catch(e){}}
    // Позиция в моём портфеле — график от её строки (план позиции: средняя/стоп/цель из POS_META).
    const h=deskHeld(it),hd=h&&DATA[h.tab],hr=hd&&hd.rows.find(r=>posTk(r[2])===h.tk);
    const st={key:it.key,tab:hr?h.tab:it.tab,row:hr||it.r,ccy:it.sec.ccy,years,side,ch:null,_loading:true};
    if(slot==='_deskChart')_deskChart=st;else _deskMini=st;
    stockChartDraw(st,id).catch(()=>{}).then(()=>{st._loading=false;});
  });
  if(!used._deskChart&&_deskChart){if(_deskChart.ch)try{_deskChart.ch.destroy();}catch(e){}_deskChart=null;}
  if(!used._deskMini&&_deskMini){if(_deskMini.ch)try{_deskMini.ch.destroy();}catch(e){}_deskMini=null;}
}
function deskRetheme(){
  [_deskChart,_deskMini].forEach(st=>{if(st&&st.ch){const id=st===_deskChart?'dkChart':'dkMini';stockChartDraw(st,id).catch(()=>{});}});
}
// Сторона плана бумаги: выбранная вручную → сторона открытой позиции → сторона вердикта.
function deskSideFor(it){
  if(!it)return 'long';
  if(DESK_UI.side[it.key])return DESK_UI.side[it.key];
  const h=deskHeld(it);if(h)return h.side;
  return (it.s&&it.s.side)||'long';
}
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
      if(deskActive())deskRender();
    }
  }catch(e){console.warn('desk load',e);}
  L.busy=false;L.done=L.total;
  deskCal();
  if(deskActive())deskRender();
}
// Календарь отчётов — только для бумаг, где он меняет решение: книга и сетапы на вход (≤ 40 → 1 запрос).
async function deskCal(){
  if(Date.now()-DESK_UI.calAt<6*3600e3||!PRICE_PROXY)return;
  _deskItems=null;
  const I=deskItems(),syms=[...new Set(I.items.filter(x=>x.sec.held.length||(x.s&&(x.s.verdict==='buy'||x.s.verdict==='short'))).map(x=>x.sec.sym))].slice(0,40);
  if(!syms.length)return;
  DESK_UI.calAt=Date.now();
  try{
    const j=await fetch(PRICE_PROXY+'?calendar='+encodeURIComponent(syms.join(','))).then(r=>r.json());
    if(j&&typeof j==='object'&&!j.error){pf3Cal.data=Object.assign({},pf3Cal.data||{},j);if(!pf3Cal.key)pf3Cal.key='__desk';if(deskActive())deskRender();}
  }catch(e){DESK_UI.calAt=0;}
}
// Живые котировки моих портфелей (цена позиций, P&L, стопы) + сверка плана.
async function deskQuotes(manual){
  if(!PRICE_PROXY)return;
  if(!manual&&Date.now()-DESK_UI.qAt<4*60e3)return;
  DESK_UI.qAt=Date.now();
  let n=0;
  for(const tab of deskPorts()){try{n+=await pf3FetchPrices(DATA[tab],tab);pf3LastRefresh[tab]=Date.now();}catch(e){}}
  try{planCheck();}catch(e){}
  if(manual)toast('🔄 '+RT(`Котировки: ${n} обновлено`,`Quotes: ${n} updated`),!n);
  if(deskActive())deskRender();
}

// ── Каркас: рельса, шапка, меню ──
function deskRouteLabel(r){return ({today:RT('Сегодня','Today'),screen:RT('Скринер','Screener'),stock:RT('Акция','Stock'),book:RT('Позиции','Positions'),journal:RT('Журнал','Journal')})[r]||r;}
function deskRailHTML(){
  const I=[['today','<path d="M4 7h16M4 12h10M4 17h7"/>'],['screen','<path d="M4 5h16l-6 8v6l-4-2v-4z"/>'],['stock','<path d="M3 17l5-6 4 4 5-8 4 5"/>'],['book','<path d="M5 4h14v16H5zM9 4v16M5 9h4M5 14h4"/>'],['journal','<path d="M6 3h9l4 4v14H6zM9 12h6M9 16h6"/>']];
  const ready=(PLAN_RULES||[]).filter(r=>!r.done&&planStatus(r).ready).length;
  return `<div class="dk-brand"><div class="dk-brand-mark">TD</div><div><div class="dk-brand-t">Trade Desk</div><div class="dk-brand-s">Nordic · SEK</div></div></div>`+
    I.map(([r,svg],i)=>`<button class="dk-nav${DESK_UI.route===r?' on':''}" data-a="nav" data-r="${r}"><svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>${deskRouteLabel(r)}${r==='today'&&ready?`<span class="dk-badge" title="${RT('Сработали правила плана','Plan rules fired')}">${ready}</span>`:''}<span class="dk-k">${i+1}</span></button>`).join('')+
    `<div class="dk-rail-foot">${RT('Новый интерфейс (бета). Старые экраны — «⋯ → Классический вид».','New interface (beta). Old screens — “⋯ → Classic view”.')}</div>`;
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
    <div class="dk-mkt">${prog}<span class="dk-chip ${m.se?'open':''}"><i></i>${RT('Стокгольм','Stockholm')}</span><span class="dk-chip ${m.us?'open':''}"><i></i>${RT('США','US')}</span>${m.t?`<span class="dk-chip dk-num">${m.t} CET</span>`:''}</div>
    <div class="dk-search-w"><label class="dk-search"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="dkQ" data-c="gq" placeholder="${RT('Тикер или компания','Ticker or company')}" autocomplete="off" aria-label="${RT('Поиск бумаги','Find a stock')}"><span class="dk-k">/</span></label><div class="dk-sugg" id="dkSugg" hidden></div></div>
    <button class="dk-btn dk-sm" data-a="refresh" title="${RT('Обновить котировки портфелей и свечи','Refresh portfolio quotes and candles')}">⟳</button>
    <div class="dk-menu-w"><button class="dk-btn dk-sm" data-a="menu" aria-haspopup="true" aria-expanded="${DESK_UI.menu}" title="${RT('Меню','Menu')}">⋯</button>${DESK_UI.menu?deskMenuHTML():''}</div></div>`;
}
function deskSubHTML(I,snaps){
  const port=deskPort(),rk=deskRiskKr();
  const ports=deskPorts(),sel=ports.length?`<select data-c="port" class="dk-sel" aria-label="${RT('Портфель','Portfolio')}">${DESK_UI.route==='book'||DESK_UI.route==='journal'?`<option value="all"${port==='all'?' selected':''}>${RT('Все портфели','All portfolios')}</option>`:''}${ports.map(k=>`<option value="${dkEsc(k)}"${k===port?' selected':''}>${dkEsc(TAB_LABEL(k))}</option>`).join('')}</select>`:'';
  const d=new Date().toLocaleDateString(LANG==='en'?'en-GB':'ru-RU',{weekday:'long',day:'numeric',month:'long'});
  return `${dkEsc(d)} · ${RT('вселенная','universe')} <b class="dk-num">${I.items.length}</b> ${RT('бумаг из','stocks from')} ${I.tabsN} ${RT('вкладок','tabs')}${snaps<I.items.length?` · ${RT('сигналы','signals')} ${snaps}/${I.items.length}`:''} · ${sel} ${RT('риск на сделку','risk per trade')} <b class="dk-num">${dkKr(rk)}</b>`;
}
function deskMenuHTML(){
  const it=(a,l,extra)=>`<button class="dk-mi" data-a="${a}"${extra||''}>${l}</button>`;
  const dark=document.documentElement.dataset.theme==='dark';
  return `<div class="dk-menu" role="menu">
    ${it('theme',(dark?'☀️ ':'🌙 ')+RT('Тема: '+(dark?'светлая':'тёмная'),'Theme: '+(dark?'light':'dark')))}
    ${it('lang','🌐 '+(LANG==='ru'?'English':'Русский'))}
    ${it('risk','⚖️ '+RT('Риск: ','Risk: ')+deskNorm(DESK).riskPct+'% · '+RT('лимит книги ','book cap ')+deskNorm(DESK).riskCapPct+'%')}
    ${it('classic','🗂 '+RT('Классический вид','Classic view'))}
    ${it('classic-plan','🎯 '+RT('План (классика)','Plan (classic)'))}
    ${can('action.manage_users')?it('settings','⚙️ '+RT('Доступ','Access')):''}
    ${isAdmin()?it('prompts','📜 '+RT('AI-промпты','AI prompts')):''}
    ${it('faq','❓ '+RT('Справка','Help'))}
    ${it('off','↩ '+RT('Выключить Trade Desk','Turn off Trade Desk'))}
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
    <div class="dk-plan-row"><div class="e"><div class="dk-lbl">${lim?RT('Лимит','Limit'):RT('Вход','Entry')}</div><b class="dk-num">${dkPx(p.entry)}</b><div class="dk-mut dk-xs">${dkCcy(ccy)}</div></div>
      <div class="s"><div class="dk-lbl" title="${dkEsc(p.stopSrc)}">${RT('Стоп','Stop')} · ${dkEsc(p.stopSrc)}</div><b class="dk-num">${dkPx(p.stop)}</b><div class="dk-mut dk-xs dk-num">${dkPct(-p.riskPct,1)}</div></div>
      <div class="t"><div class="dk-lbl" title="${dkEsc(p.targetSrc)}">${(p.flags||[]).includes('atr-target')?'≈ ':''}${RT('Цель','Target')} · ${dkEsc(p.targetSrc)}</div><b class="dk-num">${dkPx(p.target)}</b><div class="dk-mut dk-xs dk-num">${dkPct(p.rewardPct,1)}</div></div></div>
    <div class="dk-rr"><span class="dk-big dk-num">${dkRR(p)}</span><span class="dk-mut">R/R</span><span class="dk-meter" aria-hidden="true"><i class="risk" style="width:${(100/(1+Math.max(0,rr))).toFixed(1)}%"></i><i class="rew" style="width:${(100-100/(1+Math.max(0,rr))).toFixed(1)}%"></i></span></div>
    <div class="dk-risk-in"><label>${RT('Риск, kr','Risk, kr')} <input class="dk-inp dk-num" type="number" step="100" min="100" value="${Math.round(rk)}" data-c="risk" data-k="${dkEsc(it.key)}"></label><span class="dk-ml">→ <b class="dk-num">${p.qty} ${RT('шт','sh')}</b> · <span class="dk-num">${dkKr(p.notionalKr)}</span>${(p.flags||[]).includes('half')?' <span class="dk-flag">½</span>':''}</span></div>
    ${side==='short'?`<label class="dk-check"><input type="checkbox" data-c="shortok" data-k="${dkEsc(it.sec.sym)}"${shortOk?' checked':''}> ${RT('Шорт доступен у брокера (проверил займ и стоимость)','Short available at the broker (borrow & cost checked)')}</label>${shortOk?'':`<div class="dk-warn">${RT('⚠ Проверьте доступность шорта и стоимость займа — исполнение с предупреждением.','⚠ Check short availability and borrow cost — execution will warn.')}</div>`}`:''}
    ${compact?'':`<div class="dk-note">${RT(`Размер = риск ÷ (вход − стоп) × курс${ccy!=='SEK'?` (${ccy}/SEK ${dkN(FX[ccy]||1,2)})`:''}. Стоп — за структурным уровнем с буфером ${C.stopBufAtr}·ATR (не ближе ${C.minStopAtr}·ATR); цель — уровень ≥ ${C.minTargetAtr}·ATR в коридоре ${C.corridorAtr}·ATR, иначе ≈ ${C.targetAtr}·ATR. Вход по рынку при R/R ≥ ${C.rrMin}, при ${C.rrWeak}–${C.rrMin} — лимит, дающий ${C.rrGood}.`,`Size = risk ÷ (entry − stop) × FX${ccy!=='SEK'?` (${ccy}/SEK ${dkN(FX[ccy]||1,2)})`:''}. Stop beyond a structural level with a ${C.stopBufAtr}·ATR buffer (≥ ${C.minStopAtr}·ATR); target — a level ≥ ${C.minTargetAtr}·ATR within ${C.corridorAtr}·ATR, else ≈ ${C.targetAtr}·ATR. Market entry at R/R ≥ ${C.rrMin}; at ${C.rrWeak}–${C.rrMin} a limit giving ${C.rrGood}.`)}</div>`}
    <div class="dk-row">${can('action.edit_plan')?`<button class="dk-btn pri" data-a="plan" data-k="${dkEsc(it.key)}" data-side="${side}">${lim?RT('Взвести лимит','Arm limit'):RT('В план','Add to plan')}</button>`:''}${can('action.edit_trades')&&deskPorts().length?`<button class="dk-btn" data-a="exec" data-k="${dkEsc(it.key)}" data-side="${side}">${RT('Исполнить…','Execute…')}</button>`:''}</div>
  </div>`;
}

// ═══════════════════ Сегодня ═══════════════════
function deskTodayHTML(){
  const I=deskItems(),P=deskBook(),B=deskTodayBuckets(I.items,P),C=SIG.CFG,w=B.why;
  const plansArmed=(PLAN_RULES||[]).filter(r=>!r.done&&r.status!=='open'),fired=plansArmed.filter(r=>planStatus(r).ready);
  const rest=[w.knife?`${w.knife} ${RT('нож','knife')}`:'',w.heat?`${w.heat} ${RT('перегрев','overheated')}`:'',w.rr?`${w.rr} R/R < ${C.rrWeak}`:'',w.squeeze?`${w.squeeze} ${RT('сквиз','squeeze')}`:'',w.earnings?`${w.earnings} ${RT('отчёт','earnings')}`:'',w.none?`${w.none} ${RT('без сетапа','no setup')}`:''].filter(Boolean).join(' · ')||'—';
  const kpi=(l,v,d)=>`<div class="dk-panel dk-stat"><div class="dk-lbl">${l}</div><div class="dk-v dk-num">${v}</div><div class="dk-d">${d}</div></div>`;
  const nL=B.entries.filter(x=>x.s.side==='long').length,nS=B.entries.length-nL;
  const pend=I.items.length-B.pending;
  return `<div class="dk-grid dk-g4 dk-mb">
      ${kpi(RT('Сетапов на вход','Entry setups'),B.entries.length,`${nL} ${RT('лонг','long')} · ${nS} ${RT('шорт','short')} · R/R ≥ ${C.rrMin}`)}
      ${kpi(RT('Ждать уровня','Wait for level'),B.waiting.length,RT('лимит в пределах 8 % от цены','limit within 8 % of price'))}
      ${kpi(RT('Позиции требуют действия','Positions need action'),`${B.attn.length}<span class="dk-mut dk-fs14">/${P.length}</span>`,RT('стоп · цель · б/у · отчёт · без стопа','stop · target · b/e · earnings · no stop'))}
      ${kpi(RT('Отсеяно','Filtered out'),B.rest.length,rest+(pend>0?` · ${pend} ${RT('ждут свечей','awaiting candles')}`:''))}
    </div>
    <div class="dk-cols">
      <div>
        <section class="dk-mb"><div class="dk-ph dk-ph-bare"><h2>${RT('Вход сегодня','Enter today')}</h2><span class="dk-cnt">${B.entries.length}</span><span class="dk-note dk-ml">${RT(`откат к поддержке в тренде · отбой от сопротивления в даунтренде · R/R ≥ ${C.rrMin} по рынку`,`pullback to support in an uptrend · rejection at resistance in a downtrend · R/R ≥ ${C.rrMin} at market`)}</span></div>
          ${B.entries.length?`<div class="dk-decs">${B.entries.map(deskDecHTML).join('')}</div>`:`<div class="dk-panel dk-empty">${DESK_UI.load.busy?RT('Сигналы ещё считаются…','Signals are loading…'):RT(`Сетапов с R/R ≥ ${C.rrMin} по рынку нет — смотрите «Ждать уровня».`,`No setups with R/R ≥ ${C.rrMin} at market — see “Wait for level”.`)}</div>`}</section>
        <section class="dk-panel dk-mb"><div class="dk-ph"><h2>${RT('Ждать уровня','Wait for level')}</h2><span class="dk-cnt">${B.waiting.length}</span><span class="dk-note dk-ml">${RT(`лимит у уровня или цена, при которой R/R = ${C.rrGood}; «Взвести» → уведомление при касании`,`limit at a level or the price giving R/R = ${C.rrGood}; “Arm” → alert on touch`)}</span></div>
          ${B.waiting.length?`<div class="dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Бумага','Stock')}</th><th>${RT('Сторона','Side')}</th><th class="r">${RT('Цена','Price')}</th><th class="r">${RT('Лимит','Limit')}</th><th class="r">Δ</th><th class="r">${RT('Стоп','Stop')}</th><th class="r">${RT('Цель','Target')}</th><th class="r">R/R</th><th class="r">${RT('Размер','Size')}</th><th></th></tr></thead><tbody>${B.waiting.map(x=>{const s=x.s,p=deskPlanFor(x,s.side)||s.plan;return `<tr class="dk-tr" data-a="open" data-k="${dkEsc(x.key)}"><td><span class="dk-tk">${dkEsc(x.sec.tk)}</span><span class="dk-nm">${dkEsc(x.sec.name)}</span><div class="dk-note">${dkEsc(s.why[0]||'')}</div></td><td>${dkSide(s.side)}</td><td class="r dk-num">${dkPx(s.price)}</td><td class="r dk-num dk-b">${dkPx(p.entry)}</td><td class="r dk-num">${dkPct(p.dEntry,1)}</td><td class="r dk-num dk-dn">${dkPx(p.stop)}</td><td class="r dk-num dk-up">${dkPx(p.target)}</td><td class="r dk-num dk-b">${dkRR(p)}</td><td class="r dk-num">${p.qty} ${RT('шт','sh')}</td><td>${can('action.edit_plan')?`<button class="dk-btn dk-sm" data-a="plan" data-k="${dkEsc(x.key)}" data-side="${s.side}">${RT('Взвести','Arm')}</button>`:''}</td></tr>`;}).join('')}</tbody></table></div>`:`<div class="dk-empty">${RT('Нет бумаг с лимитом в пределах 8 % от цены.','No stocks with a limit within 8 % of price.')}</div>`}</section>
        <section class="dk-panel"><div class="dk-ph"><h2>${RT('Сократить в книге','Reduce in the book')}</h2><span class="dk-cnt">${B.trims.length}</span><span class="dk-note dk-ml">${RT('перегрев, достигнутая цель или отчёт при < 1R; перегрев вне книги — только флаг в скринере','overheated, target reached or earnings at < 1R; overheated outside the book — only a screener flag')}</span></div>
          ${B.trims.length?`<div class="dk-wrap"><table class="dk-tbl"><tbody>${B.trims.map(p=>`<tr class="dk-tr" data-a="open" data-k="${dkEsc(p.sym+'|'+p.ccy)}"><td><span class="dk-tk">${dkEsc(p.tk)}</span><span class="dk-nm">${dkEsc(p.name)}</span></td><td>${dkSide(p.side)}</td><td class="r dk-num">${dkPx(p.calc.now)}</td><td class="r dk-num dk-b">${dkPct(p.calc.plPct)}</td><td class="r dk-num">${dkR(p.calc.rNow)}</td><td>${dkActPill(p.act)}</td><td class="dk-ink2">${dkEsc(p.note)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="dk-empty">${RT('В книге нечего сокращать.','Nothing to reduce in the book.')}</div>`}</section>
      </div>
      <aside class="dk-aside">
        <div class="dk-panel"><div class="dk-ph"><h2>${RT('Позиции — внимание','Positions — attention')}</h2><span class="dk-cnt">${B.attn.length}</span></div>
          ${B.attn.length?B.attn.slice(0,12).map(p=>`<div class="dk-att" data-a="open" data-k="${dkEsc(p.sym+'|'+p.ccy)}"><div class="dk-row"><span class="dk-tk">${dkEsc(p.tk)}</span>${dkSide(p.side)}${dkActPill(p.act)}<span class="dk-num dk-ml dk-b ${p.calc.plPct>=0?'dk-up':'dk-dn'}">${dkPct(p.calc.plPct)}</span></div><div class="dk-note">${dkEsc(p.note)}${p.stop?` · ${RT('до стопа','to stop')} <b class="dk-num">${dkN(p.calc.toStopPct,1)}%</b>`:''}${p.calc.rNow!=null?` · <b class="dk-num">${dkR(p.calc.rNow)}</b>`:''}</div></div>`).join(''):`<div class="dk-empty">${P.length?RT('Все позиции в рамках плана.','All positions on plan.'):RT('В выбранном портфеле нет позиций.','No positions in the selected portfolio.')}</div>`}
          <div class="dk-pad"><button class="dk-btn dk-sm" data-a="nav" data-r="book">${RT('Все позиции →','All positions →')}</button></div></div>
        <div class="dk-panel"><div class="dk-ph"><h2>${RT('План','Plan')}</h2><span class="dk-cnt">${plansArmed.length}</span>${fired.length?`<span class="dk-flag dk-ml">🔔 ${fired.length}</span>`:''}</div>
          ${plansArmed.length?plansArmed.slice(0,8).map(r=>deskPlanRuleRow(r)).join(''):`<div class="dk-empty">${RT('Взведённых планов нет — «В план» на сетапе или «Взвести» у лимита.','No armed plans — “Add to plan” on a setup or “Arm” at a limit.')}</div>`}
          <div class="dk-pad"><button class="dk-btn dk-sm" data-a="nav" data-r="journal" data-jt="plans">${RT('Все планы →','All plans →')}</button></div></div>
        ${can('view.ai_proto')?`<div class="dk-panel dk-pad"><div class="dk-lbl dk-mb6">AI</div><button class="dk-btn" data-a="classic" data-tab="${dkEsc(deskRiskTab()||PF3_KEY)}" data-sub="ai">🤖 ${RT('AI Proto: разбор портфеля','AI Proto: portfolio review')}</button><div class="dk-note dk-mt6">${RT('Откроется в классическом виде; разбор бумаги — в «Акции».','Opens in the classic view; per-stock AI is on the Stock screen.')}</div></div>`:''}
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
    <div class="dk-dec-plan dk-num"><span><i>${RT('вход','entry')}</i> ${dkPx(p.entry)}</span><span class="dk-dn"><i>${RT('стоп','stop')}</i> ${dkPx(p.stop)}</span><span class="dk-up"><i>${RT('цель','target')}</i> ${dkPx(p.target)}</span><span><i>R/R</i> <b>${dkRR(p)}</b></span><span><i>${RT('размер','size')}</i> ${p.qty} ${RT('шт','sh')}</span></div>
    <div class="dk-dec-act">${can('action.edit_plan')?`<button class="dk-btn dk-sm" data-a="plan" data-k="${dkEsc(x.key)}" data-side="${s.side}">${RT('В план','To plan')}</button>`:''}${can('action.edit_trades')&&deskPorts().length?`<button class="dk-btn dk-sm pri" data-a="exec" data-k="${dkEsc(x.key)}" data-side="${s.side}">${RT('Исполнить','Execute')}</button>`:''}</div>
  </article>`;
}
function deskPlanRuleRow(r){
  const st=planStatus(r),lvl=st.lvl>0?dkPx(st.lvl):'—',key=exSymbol(r.tk,r.ccy||'USD')+'|'+String(r.ccy||'USD').toUpperCase();
  const state=st.invalid?`<span class="dk-flag">✖ ${RT('сетап сломан','setup broken')}</span>`:st.ready?`<span class="dk-flag">🔔 ${RT('пора','now')}</span>`:st.gapPct!=null?`<span class="dk-mut dk-num">${RT('до уровня','to level')} ${dkN(Math.abs(st.gapPct),1)}%</span>`:'';
  return `<div class="dk-att" data-a="open" data-k="${dkEsc(key)}"><div class="dk-row"><span class="dk-tk">${dkEsc(r.tk)}</span>${dkSide(r.side)}<span class="dk-num">${planActLabel(r.act,r.side)} ${lvl}</span><span class="dk-ml">${state}</span></div><div class="dk-note dk-num">${r.stop?RT('стоп ','stop ')+dkPx(r.stop):''}${r.target?' · '+RT('цель ','target ')+dkPx(r.target):''}${r.qty?' · '+r.qty+' '+RT('шт','sh'):''}${r.note?' · '+dkEsc(String(r.note).slice(0,80)):''}</div></div>`;
}

// ═══════════════════ Скринер ═══════════════════
function deskScreenHTML(){
  const I=deskItems(),f=DESK_UI.f,C=SIG.CFG,R=deskScreenRows(I.items,f,DESK_UI.sort);
  const tabs=[...new Set(I.items.reduce((a,x)=>a.concat(x.sec.tabs),[]))];
  const ph=[['all',RT('Все фазы','All phases')],['up','↑ '+T('Аптренд')],['imp','⇈ '+T('Импульс')],['heat','△ '+T('Перегрев')],['undr','◇ '+T('Недооценка')],['corr','↓ '+T('Коррекция')],['rev','↗ '+T('Разворот')],['flat','→ '+T('Боковик')],['down','↘ '+T('Даунтренд')],['knife','⤓ '+T('Падающий нож')]];
  const opt=(arr,cur)=>arr.map(([v,l])=>`<option value="${dkEsc(v)}"${v===cur?' selected':''}>${dkEsc(l)}</option>`).join('');
  const cols=[['tk',RT('Бумага','Stock')],['price',RT('Цена','Price'),'r'],['day',RT('1д','1d'),'r c-opt'],['phase',RT('Фаза · тренд','Phase · trend')],['near',RT('Ближайший уровень','Nearest level'),'c-opt'],['dEntry',RT('Вход · Стоп · Цель','Entry · Stop · Target'),'r c-opt'],['rr','R/R','r'],['score',RT('Балл','Score'),'r c-opt'],['verdict',RT('Вердикт','Verdict')]];
  const th=cols.map(([k,l,a])=>`<th class="${a||''}${DESK_UI.sort.k===k?' s':''}" data-a="sort" data-s="${k}" aria-sort="${DESK_UI.sort.k===k?(DESK_UI.sort.d>0?'ascending':'descending'):'none'}">${l}${DESK_UI.sort.k===k?`<span class="ar">${DESK_UI.sort.d>0?'▲':'▼'}</span>`:''}</th>`).join('');
  const shown=R.slice(0,400);
  const rows=shown.map(x=>{const s=x.s,sec=x.sec;
    if(!s)return `<tr class="dk-tr${DESK_UI.sel===x.key?' on':''}" data-a="sel" data-k="${dkEsc(x.key)}"><td><span class="dk-tk">${dkEsc(sec.tk)}</span><span class="dk-nm">${dkEsc(sec.name)}</span></td><td class="r dk-num">${dkPx(sec.price)}</td><td class="r c-opt">${dkDay(sec.day)}</td><td colspan="6" class="dk-mut">${RT('свечи грузятся…','candles loading…')}</td></tr>`;
    const p=deskPlanFor(x,s.side)||s.plan;
    return `<tr class="dk-tr${DESK_UI.sel===x.key?' on':''}" data-a="sel" data-k="${dkEsc(x.key)}"><td><span class="dk-tk">${dkEsc(sec.tk)}</span><span class="dk-nm">${dkEsc(sec.name)}</span>${sec.held.length?` <span class="dk-tag">${RT('в книге','in book')}</span>`:''}</td><td class="r dk-num">${dkPx(s.price)}<span class="dk-mut dk-xs"> ${dkCcy(sec.ccy)}</span></td><td class="r c-opt">${dkDay(s.day)}</td><td>${dkPhase(s)}</td><td class="c-opt">${s.near?`<span class="dk-tag">${dkEsc(s.near.src.replace(/\+/g,' · '))}</span> <span class="dk-num dk-mut">${dkPct(s.near.dist,1)}</span>`:'<span class="dk-mut">—</span>'}</td><td class="r dk-num dk-xs c-opt">${p.mode==='limit'?`<span class="dk-tag">${RT('лим.','lim.')} ${dkPct(p.dEntry,1)}</span> `:''}${dkPx(p.entry)} · <span class="dk-dn">${dkPx(p.stop)}</span> · <span class="dk-up">${dkPx(p.target)}</span></td><td class="r dk-num dk-b">${dkRR(p)}</td><td class="r c-opt"><span class="dk-bar"><i style="width:${s.score}%"></i></span> <span class="dk-num">${s.score}</span></td><td>${dkPill(s.verdict,!!sec.held.length)} ${dkFlags(s)}</td></tr>`;}).join('');
  return `<div class="dk-filters">
      <div class="dk-seg" role="group" aria-label="${RT('Вердикт','Verdict')}">${[['all',RT('Все','All')],['buy','▲ '+RT('Купить','Buy')],['short','▼ '+RT('Шорт','Short')],['trim','◆ '+RT('Перегрев','Overheated')],['wait','○ '+RT('Ждать','Wait')]].map(([v,l])=>`<button class="${f.v===v?'on':''}" data-a="fv" data-v="${v}">${l}</button>`).join('')}</div>
      <select class="dk-sel" data-c="fside" aria-label="${RT('Сторона','Side')}">${opt([['all',RT('Обе стороны','Both sides')],['long','▲ '+RT('Лонг','Long')],['short','▼ '+RT('Шорт','Short')]],f.side)}</select>
      <select class="dk-sel" data-c="fphase" aria-label="${RT('Фаза','Phase')}">${opt(ph,f.phase)}</select>
      <select class="dk-sel" data-c="ftab" aria-label="${RT('Вкладка','Tab')}">${opt([['all',RT('Все вкладки','All tabs')]].concat(tabs.map(t=>[t,TAB_LABEL(t)])),f.tab)}</select>
      <button class="dk-toggle${f.near?' on':''}" data-a="fnear" aria-pressed="${f.near}">${RT(`у уровня ≤ ${C.nearPct} %`,`at level ≤ ${C.nearPct} %`)}</button>
      <button class="dk-toggle${f.rr?' on':''}" data-a="frr" aria-pressed="${f.rr}">R/R ≥ ${C.rrMin}</button>
      <button class="dk-toggle${f.held?' on':''}" data-a="fheld" aria-pressed="${f.held}">${RT('в книге','in book')}</button>
      <input class="dk-inp" data-c="fq" value="${dkEsc(f.q)}" placeholder="${RT('фильтр…','filter…')}" aria-label="${RT('Фильтр по тикеру/имени','Filter by ticker/name')}">
      <span class="dk-note dk-ml">${R.length} ${RT('из','of')} ${I.items.length} · ${I.tabsN} ${RT('вкладок','tabs')} · j / k / Enter</span>
    </div>
    <div class="dk-scr${DESK_UI.sel?' open':''}"><div class="dk-panel dk-wrap"><table class="dk-tbl"><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>${R.length?(R.length>shown.length?`<div class="dk-empty">${RT(`Показаны первые ${shown.length} — сузьте фильтры.`,`First ${shown.length} shown — narrow the filters.`)}</div>`:''):`<div class="dk-empty">${RT('Ничего не подходит под фильтры.','Nothing matches the filters.')}</div>`}</div>
      ${DESK_UI.sel?`<aside class="dk-drawer">${deskDrawerHTML()}</aside>`:''}</div>`;
}
function deskDrawerHTML(){
  const it=deskSecOf(DESK_UI.sel);if(!it)return '';
  const side=deskSideFor(it),s=it.s;
  return `<div class="dk-panel"><div class="dk-ph"><h2><span class="dk-tk">${dkEsc(it.sec.tk)}</span> <span class="dk-nm">${dkEsc(it.sec.name)}</span></h2><div class="dk-act"><div class="dk-seg side"><button class="${side==='long'?'on':''} long" data-a="side" data-v="long" data-k="${dkEsc(it.key)}">${RT('Лонг','Long')}</button><button class="${side==='short'?'on':''} short" data-a="side" data-v="short" data-k="${dkEsc(it.key)}">${RT('Шорт','Short')}</button></div><button class="dk-btn dk-sm" data-a="unsel" aria-label="${RT('Закрыть','Close')}">✕</button></div></div>
    <div class="dk-chart-panel"><div id="dkMini" class="dk-mini">${it.r?'':RT('Нет строки бумаги','No row')}</div></div>
    <div class="dk-bt">${deskPlanBox(it,side,true)}${s?`<div class="dk-why dk-padx">${s.why.map(w=>`<div>${dkEsc(w)}</div>`).join('')}</div>`:''}<div class="dk-pad"><button class="dk-btn" data-a="open" data-k="${dkEsc(it.key)}">${RT('Открыть страницу акции →','Open stock page →')}</button></div></div></div>`;
}

// ═══════════════════ Акция ═══════════════════
function deskStockHTML(){
  const I=deskItems();
  let it=deskSecOf(DESK_UI.key);
  if(!it){const B=deskTodayBuckets(I.items,[]);it=B.entries[0]||I.items.find(x=>x.sec.held.length)||I.items[0];if(it)DESK_UI.key=it.key;}
  if(!it)return `<div class="dk-panel dk-empty">${RT('Бумаг нет — добавьте тикеры во вкладки или откройте поиск «/».','No stocks — add tickers to tabs or use search “/”.')}</div>`;
  const s=it.s,sec=it.sec,held=deskHeld(it),side=deskSideFor(it),C=SIG.CFG;
  // AI-блок и фундаментал классики читают выбранную бумагу из v3Key/pf3Sel — в desk старые экраны не рисуются, так что безопасно.
  if(it.tab&&it.r){v3Key=it.tab;pf3Sel=String(it.r[2]||'');}
  const px=s?s.price:sec.price,day=s?s.day:sec.day;
  const lv=s&&s.levels,ladder=s?[...lv.res.filter(x=>x.kind!=='pivot').slice(0,3).reverse().map(x=>Object.assign({},x,{k:'res'})),{v:s.price,src:RT('цена','price'),k:'now'},...lv.sup.filter(x=>x.kind!=='pivot').slice(0,3).map(x=>Object.assign({},x,{k:'sup'}))]:[];
  const hc=_histCache[sigHistKey(sec.sym)];if(hc&&hc.bars&&!hc.rep&&hc.bars.length>=C.minBars){try{hc.rep=SIG.replay(hc.bars);}catch(e){}}
  const trades=hc&&hc.rep?hc.rep.trades.slice(-8).reverse():[],st=hc&&hc.rep?SIG.replayStats(hc.rep.trades,0):null;
  const et=it.r&&it.d?pf3EffTarget(it.d,it.r):null,up=it.r&&it.d?pf3EffUpside(it.d,it.r):null,bt=it.r?pf3BetygRow(it.r,sec.sector):null;
  const earn=sigEarnDays(sec.sym),cal=pf3Cal&&pf3Cal.data&&pf3Cal.data[sec.sym],ins=INSIDER[sec.tk]||INSIDER[posTk(sec.tk)];
  const insTx=ins&&Array.isArray(ins.tx)?ins.tx.filter(t=>t&&t.date&&Date.now()-Date.parse(t.date)<90*864e5):[],insP=insTx.filter(t=>t.code==='P').length,insS=insTx.filter(t=>t.code==='S').length;
  const ni=NEWS_IMPACT&&NEWS_IMPACT[sec.tk];
  const posPanel=held?deskPosPanel(held,it):'';
  return `<div class="dk-stock-hd"><span class="dk-tk dk-tk-xl">${dkEsc(sec.tk)}</span><div><div class="dk-b">${dkEsc(sec.name)}</div><div class="dk-mut dk-xs">${dkEsc([sec.sector,sec.type,sec.tabs.map(TAB_LABEL).join(', '),sec.ccy].filter(Boolean).join(' · '))}</div></div>
      <span class="dk-px dk-num">${dkPx(px)} ${dkCcy(sec.ccy)}</span>${dkDay(day)}${sec.live?`<span class="dk-tag" title="${RT('Живая котировка этой сессии','Live quote of this session')}">live</span>`:`<span class="dk-tag dk-mut" title="${RT('Цена из снапшота/свечей — не подтверждена живой котировкой','Price from snapshot/candles — not a live quote')}">${RT('не live','not live')}</span>`}
      ${s?dkPill(s.verdict,!!held)+dkPhase(s)+dkFlags(s):''}
      <div class="dk-ctl"><div class="dk-seg side">${held&&held.stop?'':`<button class="${side==='long'?'on':''} long" data-a="side" data-v="long" data-k="${dkEsc(it.key)}">▲ ${RT('Лонг','Long')}</button><button class="${side==='short'?'on':''} short" data-a="side" data-v="short" data-k="${dkEsc(it.key)}">▼ ${RT('Шорт','Short')}</button>`}</div>
        <div class="dk-seg"><button class="${DESK_UI.years===1?'on':''}" data-a="years" data-v="1">1${RT('Г','Y')}</button><button class="${DESK_UI.years===3?'on':''}" data-a="years" data-v="3">3${RT('Г','Y')}</button></div>
        <button class="dk-btn dk-sm" data-a="classic" data-tab="${dkEsc(it.tab||'')}" data-k="${dkEsc(String((it.r&&it.r[2])||''))}" title="${RT('Полная карточка в классическом виде: сделки, налоги, AI-анализ, тезис','Full card in the classic view: trades, tax, AI analysis, thesis')}">🗂 ${RT('Карточка','Card')}</button></div></div>
    <div class="dk-cols">
      <div>
        <div class="dk-panel dk-chart-panel"><div id="dkChart" class="dk-chart">${it.r?'':RT('Нет строки бумаги','No row')}</div><div class="dk-note dk-padx">${held&&held.stop?RT('линии — средняя, стоп и цель открытой позиции','lines — average, stop and target of the open position'):RT('линии — план выбранной стороны','lines — plan of the selected side')} · ATR ${RT('по High/Low (Wilder 14)','by High/Low (Wilder 14)')}</div></div>
        <details class="dk-panel dk-mt14"${held?'':' open'}><summary class="dk-ph"><h2>${RT('История сигналов','Signal history')}</h2><span class="dk-cnt">${hc&&hc.rep?hc.rep.trades.length:0}</span><span class="dk-note dk-ml">${st?dkEsc(chartStatsText(st)):RT('реплей вердикта v2 по свечам','verdict v2 replayed over candles')}</span></summary>
          ${trades.length?`<div class="dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Вход','Entry')}</th><th>${RT('Сторона','Side')}</th><th class="r">${RT('Цена','Price')}</th><th class="r">${RT('Стоп','Stop')}</th><th class="r">${RT('Цель','Target')}</th><th>${RT('Выход','Exit')}</th><th class="r">R</th><th>${RT('Причина','Reason')}</th></tr></thead><tbody>${trades.map(t=>{const x=t.exits[t.exits.length-1];return `<tr><td class="dk-num">${t.d}</td><td>${dkSide(t.side)}</td><td class="r dk-num">${dkPx(t.entry)}</td><td class="r dk-num dk-dn">${dkPx(t.stop0)}</td><td class="r dk-num dk-up">${dkPx(t.target)}</td><td class="dk-num">${t.open?RT('открыта','open'):(x?x.d+' · '+dkEsc(x.why):'')}</td><td class="r dk-num dk-b ${t.R>=0?'dk-up':'dk-dn'}">${dkR(t.R)}</td><td class="dk-ink2">${dkEsc(t.why||'')}</td></tr>`;}).join('')}</tbody></table></div>`:`<div class="dk-empty">${RT('Входов по правилам v2 на истории не было (или свечи ещё грузятся).','No v2 entries over the history (or candles are loading).')}</div>`}</details>
        <details class="dk-panel dk-mt14"><summary class="dk-ph"><h2>🤖 ${RT('AI-разбор','AI analysis')}</h2><span class="dk-note dk-ml">${AI_RECO[sec.tk]&&AI_RECO[sec.tk].at?RT('есть от ','from ')+dkEsc(String(AI_RECO[sec.tk].at).slice(0,10)):RT('свёрнут','collapsed')}</span></summary><div class="dk-ai">${it.r&&can('view.ai_reco')?aiRecoHTML(it.d,it.r):`<div class="dk-empty">${RT('Нет доступа к AI-разбору.','No access to AI analysis.')}</div>`}</div></details>
      </div>
      <aside class="dk-aside">
        ${posPanel}
        ${held&&held.stop?`<details class="dk-panel"><summary class="dk-ph"><h2>${RT('Новый вход','New entry')}</h2>${dkSide(side)}</summary>${deskPlanBox(it,side)}</details>`:`<div class="dk-panel"><div class="dk-ph"><h2>${RT('План сделки','Trade plan')}</h2>${dkSide(side)}</div>${deskPlanBox(it,side)}</div>`}
        ${s?`<div class="dk-panel"><div class="dk-ph"><h2>${RT('Сигнал','Signal')}</h2><span class="dk-cnt">${RT('балл','score')} ${s.score}</span></div><div class="dk-why">${s.why.map(w=>`<div>${dkEsc(w)}</div>`).join('')}</div>
          <div class="dk-kv dk-bt"><span class="dk-lbl">${RT('Тренд','Trend')}</span><span class="v ${s.trendUp?'dk-up':'dk-dn'}">${s.trendUp?'↑ SMA50 > SMA200':'↓ SMA50 < SMA200'}</span><span class="dk-lbl">RSI 14</span><span class="v dk-num">${dkN(s.rsi,0)}</span><span class="dk-lbl">ATR 14</span><span class="v dk-num">${dkPx(s.atr)} · ${dkN(s.atrPct,1)}%</span><span class="dk-lbl">${RT('Объём к среднему','Volume vs avg')}</span><span class="v dk-num">×${dkN(s.volX,2)}</span><span class="dk-lbl">${RT('К SMA200','To SMA200')}</span><span class="v dk-num">${s.s200?dkPct((s.price/s.s200-1)*100,1):'—'}</span></div></div>
        <div class="dk-panel"><div class="dk-ph"><h2>${RT('Лестница уровней','Level ladder')}</h2><span class="dk-note dk-ml">${RT('структурные, без пивотов','structural, no pivots')}</span></div><div class="dk-ladder">${ladder.map(x=>`<div class="dk-lvl ${x.k}"><span class="z"></span><span class="src">${dkEsc(String(x.src).replace(/\+/g,' · '))}</span><span class="dk-num">${dkPx(x.v)}</span><span class="dist dk-num">${x.k==='now'?'':dkPct((x.v/s.price-1)*100,1)}</span></div>`).join('')}</div></div>`:''}
        <div class="dk-panel"><div class="dk-ph"><h2>${RT('Фундаментал и события','Fundamentals & events')}</h2></div><div class="dk-kv">
          <span class="dk-lbl">${RT('Таргет (эфф.)','Target (eff.)')}</span><span class="v dk-num">${et&&et.target>0?dkPx(et.target)+(up!=null?` <span class="${up>=0?'dk-up':'dk-dn'}">${dkPct(up,0)}</span>`:''):'—'}</span>
          ${et&&et.recent>0&&et.main>0?`<span class="dk-lbl">${RT('Свежий · средний','Fresh · average')}</span><span class="v dk-num">${dkPx(et.recent)} · <span class="dk-mut">${dkPx(et.main)}</span>${s&&s.flags.includes('stale-target')?` <span class="dk-flag">${RT('устар.','stale')}</span>`:''}</span>`:''}
          <span class="dk-lbl">Betyg</span><span class="v">${bt?`<b>${dkEsc(bt.grade||'—')}</b> <span class="dk-mut dk-num">${bt.score100}/100</span>`:`<button class="dk-btn dk-sm" data-a="fund" data-k="${dkEsc(sec.sym)}">${RT('загрузить','load')}</button>`}</span>
          <span class="dk-lbl">${RT('Отчёт','Earnings')}</span><span class="v dk-num">${cal&&cal.earnings?dkEsc(String(cal.earnings).slice(0,10))+(earn!=null?` <span class="${earn<=C.earnDays?'dk-flag':'dk-mut'}">${RT('через','in')} ${earn} ${RT('дн','d')}</span>`:''):'<span class="dk-mut">—</span>'}</span>
          <span class="dk-lbl">${RT('Инсайдеры 90 дн','Insiders 90d')}</span><span class="v dk-num">${insTx.length?`<span class="dk-up">▲ ${insP}</span> · <span class="dk-dn">▼ ${insS}</span>`:'<span class="dk-mut">—</span>'}</span>
          ${ni?`<span class="dk-lbl">${RT('Новости','News')}</span><span class="v">${ni.impact==='bull'?'📈':ni.impact==='bear'?'📉':'⚪'} ${dkEsc(((ni.hits||[])[0]||{}).sent||'').slice(0,90)}</span>`:''}
        </div></div>
      </aside>
    </div>`;
}
function deskPosPanel(p,it){
  const c=p.calc,s=it.s;if(!c)return '';
  const act=deskPosAct(p,s,p.earn!=null?p.earn:sigEarnDays(p.sym)),trail=s?deskTrailStop(p.side,p.stop,c.now,s.atr):null,sug=s&&s.plans&&s.plans[p.side];
  const ed=DESK_UI.edit&&DESK_UI.edit.key===p.tab+'|'+p.tk;
  const canT=can('action.edit_trades'),k=dkEsc(p.tab),t=dkEsc(p.tk);
  return `<div class="dk-panel"><div class="dk-ph"><h2>${RT('Открытая позиция','Open position')}</h2>${dkSide(p.side)}<span class="dk-note dk-ml">${dkEsc(TAB_LABEL(p.tab))}</span></div>
    <div class="dk-plan-box"><div class="dk-row">${dkActPill(act.act)}<span class="dk-ink2">${dkEsc(act.note)}</span></div>
      <div class="dk-plan-row"><div class="e"><div class="dk-lbl">${RT('Средняя','Average')}${p.opened?' · '+dkEsc(p.opened):''}</div><b class="dk-num">${dkPx(p.entry)}</b><div class="dk-mut dk-xs dk-num">${dkN(p.qty,0)} ${RT('шт','sh')}</div></div>
        <div class="s"><div class="dk-lbl">${RT('Стоп','Stop')}${p.stop0&&p.stop0!==p.stop?' · '+RT('был ','was ')+dkPx(p.stop0):''}</div><b class="dk-num">${p.stop?dkPx(p.stop):'—'}</b><div class="dk-mut dk-xs dk-num">${c.toStopPct!=null?RT('до стопа ','to stop ')+dkN(c.toStopPct,1)+'%':''}</div></div>
        <div class="t"><div class="dk-lbl">${RT('Цель','Target')}</div><b class="dk-num">${p.target?dkPx(p.target):'—'}</b><div class="dk-mut dk-xs dk-num">${c.toTargetPct!=null?RT('до цели ','to target ')+dkN(c.toTargetPct,1)+'%':''}</div></div></div>
      <div class="dk-kv dk-p0"><span class="dk-lbl">P&amp;L</span><span class="v dk-num ${c.plSEK>=0?'dk-up':'dk-dn'}">${dkPct(c.plPct)} · ${c.plSEK>=0?'+':''}${dkKr(c.plSEK)}</span><span class="dk-lbl">${RT('R сейчас (от стопа входа)','R now (from entry stop)')}</span><span class="v dk-num">${dkR(c.rNow)}</span><span class="dk-lbl">${RT('Открытый риск до стопа','Open risk to stop')}</span><span class="v dk-num">${c.riskSEK!=null?dkKr(c.riskSEK):'—'}</span></div>
      ${ed?deskEditForm(p):''}
      ${canT?`<div class="dk-row">${!p.stop&&sug?`<button class="dk-btn pri dk-sm" data-a="pm-accept" data-tab="${k}" data-k="${t}" data-stop="${sug.stop}" data-target="${sug.target}" title="${RT('Стоп и цель из плана v2 этой стороны','Stop & target from the v2 plan of this side')}">${RT('Принять стоп','Accept stop')} ${dkPx(sug.stop)} · ${RT('цель','target')} ${dkPx(sug.target)}</button>`:''}
        ${p.stop&&c.rNow!=null&&c.rNow>=1&&(p.side==='short'?p.stop>p.entry:p.stop<p.entry)?`<button class="dk-btn dk-sm" data-a="pm-be" data-tab="${k}" data-k="${t}">${RT('Стоп в б/у','Stop to b/e')}</button>`:''}
        ${p.stop&&trail!=null?`<button class="dk-btn dk-sm" data-a="pm-trail" data-tab="${k}" data-k="${t}" data-stop="${trail}">${RT('Трейл 2·ATR','Trail 2·ATR')} → ${dkPx(trail)}</button>`:''}
        <button class="dk-btn dk-sm" data-a="pm-edit" data-tab="${k}" data-k="${t}">${RT('Стоп/цель…','Stop/target…')}</button>
        <button class="dk-btn dk-sm" data-a="close" data-tab="${k}" data-k="${t}" data-key="${dkEsc(it.key)}">${p.side==='short'?RT('Откупить…','Cover…'):RT('Продать…','Sell…')}</button></div>`:''}
    </div></div>`;
}
function deskEditForm(p){
  const E=DESK_UI.edit||{},sv=E.stop!=null?E.stop:(p.stop||''),tv=E.target!=null?E.target:(p.target||'');
  return `<div class="dk-edit"><label>${RT('Стоп','Stop')} <input class="dk-inp dk-num" id="dkEdStop" type="number" step="any" value="${dkEsc(sv)}"></label><label>${RT('Цель','Target')} <input class="dk-inp dk-num" id="dkEdTgt" type="number" step="any" value="${dkEsc(tv)}"></label>
    <button class="dk-btn pri dk-sm" data-a="pm-save" data-tab="${dkEsc(p.tab)}" data-k="${dkEsc(p.tk)}">${RT('Сохранить','Save')}</button><button class="dk-btn dk-sm" data-a="pm-cancel">${RT('Отмена','Cancel')}</button>
    <div class="dk-note">${RT('Стоп входа (stop0) не меняется — R считается от него. Пустое поле стирает значение.','The entry stop (stop0) stays — R is measured from it. An empty field clears the value.')}</div></div>`;
}

// ═══════════════════ Позиции ═══════════════════
function deskBookHTML(){
  const P=deskBook(),port=deskPort(),tabs=port==='all'?deskPorts():(port?[port]:[]);
  if(!tabs.length)return `<div class="dk-panel dk-empty">${RT('Нет доступных портфелей.','No portfolios available.')}</div>`;
  const L=P.filter(p=>p.side!=='short'),S=P.filter(p=>p.side==='short'),sum=(a,f)=>a.reduce((x,p)=>x+(f(p)||0),0);
  const lv=sum(L,p=>p.calc&&p.calc.valueSEK),sv=sum(S,p=>p.calc&&p.calc.valueSEK),pl=sum(P,p=>p.calc&&p.calc.plSEK);
  const rs=tabs.map(t=>bookRiskState(t)),risk=sum(rs,r=>r.openRiskSEK),cap=sum(rs,r=>r.capSEK),eq=sum(rs,r=>r.equitySEK),riskPct=eq>0?risk/eq*100:0,capPct=deskNorm(DESK).riskCapPct;
  const cash=tabs.reduce((a,t)=>a+(parseFloat(DATA[t].cashFree)||0)*pf3BaseFx(DATA[t]),0),noStop=P.filter(p=>!p.stop).length;
  const kpi=(l,v,d,cls)=>`<div class="dk-panel dk-stat"><div class="dk-lbl">${l}</div><div class="dk-v dk-num ${cls||''}">${v}</div><div class="dk-d">${d}</div></div>`;
  return `<div class="dk-expo">
      ${kpi(RT('Нетто экспозиция','Net exposure'),dkKr(lv-sv),RT('лонг − шорт','long − short'))}
      ${kpi(RT('Брутто','Gross'),dkKr(lv+sv),`${L.length} ${RT('лонг','long')} · ${S.length} ${RT('шорт','short')}`)}
      ${kpi(RT('P&L открытых','Open P&L'),(pl>=0?'+':'')+dkKr(pl),RT('по текущим ценам','at current prices'),pl>=0?'dk-up':'dk-dn')}
      ${kpi(RT('Открытый риск','Open risk'),dkKr(risk),`${dkN(riskPct,1)}% ${RT('капитала · лимит','of equity · cap')} ${capPct}% <span class="dk-bar"><i style="width:${cap>0?Math.min(100,risk/cap*100).toFixed(0):0}%;${risk>cap?'background:var(--dk-short)':''}"></i></span>${noStop?`<br><span class="dk-flag">${noStop} ${RT('без стопа — риск не учтён','without stop — risk not counted')}</span>`:''}`,risk>cap?'dk-dn':'')}
      ${kpi(RT('Кэш','Cash'),dkKr(cash),RT('капитал ','equity ')+dkKr(eq))}
    </div>
    <div class="dk-panel dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Бумага','Stock')}</th><th>${RT('Сторона','Side')}</th><th class="r">${RT('Кол-во','Qty')}</th><th class="r">${RT('Средняя','Avg')}</th><th class="r">${RT('Сейчас','Now')}</th><th class="r">P&amp;L</th><th class="r">${RT('Стоп','Stop')}</th><th class="r">${RT('Цель','Target')}</th><th>${RT('Стоп ◆ цена → цель','Stop ◆ price → target')}</th><th class="r">${RT('R сейчас','R now')}</th><th class="r">${RT('Риск','Risk')}</th><th>${RT('Действие','Action')}</th></tr></thead><tbody>
      ${P.length?P.map(p=>{const c=p.calc||{};const prog=c.progress,pe=p.stop&&p.target&&p.target!==p.stop?Math.max(0,Math.min(1,(p.side==='short'?-1:1)*(p.entry-p.stop)/Math.abs(p.target-p.stop))):null;
        return `<tr class="dk-tr" data-a="open" data-k="${dkEsc(p.sym+'|'+p.ccy)}"><td><span class="dk-tk">${dkEsc(p.tk)}</span><span class="dk-nm">${dkEsc(p.name)}</span>${port==='all'?`<div class="dk-note">${dkEsc(TAB_LABEL(p.tab))}</div>`:''}</td><td>${dkSide(p.side)}</td><td class="r dk-num">${dkN(p.qty,0)}</td><td class="r dk-num">${dkPx(p.entry)}</td><td class="r dk-num">${dkPx(c.now)}</td>
          <td class="r dk-num dk-b ${c.plSEK>=0?'dk-up':'dk-dn'}">${dkPct(c.plPct)}<br><span class="dk-mut dk-xs">${c.plSEK>=0?'+':''}${dkKr(c.plSEK)}</span></td>
          <td class="r dk-num dk-dn">${p.stop?dkPx(p.stop):'—'}<br><span class="dk-mut dk-xs">${c.toStopPct!=null?dkN(c.toStopPct,1)+'%':''}</span></td><td class="r dk-num dk-up">${p.target?dkPx(p.target):'—'}<br><span class="dk-mut dk-xs">${c.toTargetPct!=null?dkN(c.toTargetPct,1)+'%':''}</span></td>
          <td>${prog!=null?`<span class="dk-track" title="${RT('стоп слева, цель справа, ◆ — цена, | — вход','stop left, target right, ◆ — price, | — entry')}">${pe!=null?`<b style="left:${Math.round(pe*100)}%"></b>`:''}<i class="${c.toStopPct!=null&&c.toStopPct<=2?'danger':''}" style="left:${Math.round(prog*100)}%"></i></span>`:'<span class="dk-mut">—</span>'}</td>
          <td class="r dk-num">${dkR(c.rNow)}</td><td class="r dk-num">${c.riskSEK!=null?dkKr(c.riskSEK):'—'}</td><td>${dkActPill(p.act)}<div class="dk-note">${dkEsc(p.note)}</div></td></tr>`;}).join(''):`<tr><td colspan="12" class="dk-empty">${RT('Открытых позиций нет.','No open positions.')}</td></tr>`}
    </tbody></table></div>
    <div class="dk-row dk-mt14">${tabs.length===1?`<button class="dk-btn dk-sm" data-a="classic" data-tab="${dkEsc(tabs[0])}" data-sub="alloc">🏭 ${RT('Структура','Breakdown')}</button>${isAdmin()&&tabs[0]===PF3_KEY?`<button class="dk-btn dk-sm" data-a="classic" data-tab="${dkEsc(tabs[0])}" data-sub="stats">📊 ${RT('Статистика','Statistics')}</button>`:''}<button class="dk-btn dk-sm" data-a="classic" data-tab="${dkEsc(tabs[0])}" data-sub="tax">🧾 ${RT('Налоги','Tax')}</button><button class="dk-btn dk-sm" data-a="classic" data-tab="${dkEsc(tabs[0])}" data-sub="health">🩺 ${RT('Состояние','Health')}</button>`:''}</div>
    <p class="dk-note dk-mt14">${RT('Позиция = строка портфеля (кол-во и средняя — как в налоге, genomsnittsmetoden) + сторона/стоп/цель. P&L шорта зеркальный; «R сейчас» — ход в единицах начального риска (средняя − стоп входа), перенос стопа его не меняет. Открытый риск считается до текущих стопов и сравнивается с лимитом книги; позиции без стопа в нём не учтены.','Position = portfolio row (qty and average as in tax, genomsnittsmetoden) + side/stop/target. Short P&L is mirrored; “R now” is the move in units of the initial risk (average − entry stop), moving the stop does not change it. Open risk is measured to current stops against the book cap; positions without a stop are not counted.')}</p>`;
}

// ═══════════════════ Журнал ═══════════════════
function deskJournalHTML(){
  const jt=DESK_UI.jt;
  const seg=`<div class="dk-seg dk-mb" role="tablist">${[['mine',RT('Мои сделки','My trades')],['plans',RT('Планы','Plans')],['rules',RT('Бэктест правил','Rules backtest')]].map(([v,l])=>`<button class="${jt===v?'on':''}" data-a="jt" data-v="${v}" role="tab" aria-selected="${jt===v}">${l}</button>`).join('')}</div>`;
  return seg+(jt==='rules'?deskRulesHTML():jt==='plans'?deskPlansHTML():deskMineHTML());
}
function deskMineHTML(){
  const port=deskPort(),tabs=port==='all'?deskPorts():(port?[port]:[]);
  if(!can('view.trades'))return `<div class="dk-panel dk-empty">${RT('Нет доступа к сделкам.','No access to trades.')}</div>`;
  const T=deskRoundTrips((PF_TRADES||[]).filter(t=>tabs.includes(t.tab||PF3_KEY))),S=deskJournalStats(T,FX),showPl=can('data.show_trades_pnl');
  const kpi=(l,v,d,cls)=>`<div class="dk-panel dk-stat"><div class="dk-lbl">${l}</div><div class="dk-v dk-num ${cls||''}">${v}</div><div class="dk-d">${d}</div></div>`;
  return `<div class="dk-grid dk-g4 dk-mb">${kpi(RT('Закрытых сделок','Closed trades'),S.n,`${S.open} ${RT('открыто','open')} · ${RT('записей','records')} ${(PF_TRADES||[]).filter(t=>tabs.includes(t.tab||PF3_KEY)).length}`)}
      ${kpi(RT('Доля в плюсе','Win rate'),S.winRate==null?'—':dkN(S.winRate,0)+'%',`${S.win}/${S.n}`)}
      ${kpi(RT('Средний результат','Average result'),S.avgPct==null?'—':dkPct(S.avgPct),RT('на сделку, % от входа','per trade, % of entry'),S.avgPct>=0?'dk-up':'dk-dn')}
      ${kpi('Profit factor',S.pf==null?'—':S.pf===Infinity?'∞':dkN(S.pf,2),showPl?RT('итог ','total ')+(S.sumSEK>=0?'+':'')+dkKr(S.sumSEK):RT('прибыль ÷ убыток','profit ÷ loss'))}</div>
    <div class="dk-panel dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Бумага','Stock')}</th><th>${RT('Сторона','Side')}</th><th>${RT('Открыта','Opened')}</th><th>${RT('Закрыта','Closed')}</th><th class="r">${RT('Дней','Days')}</th><th class="r">${RT('Кол-во','Qty')}</th><th class="r">${RT('Вход','Entry')}</th><th class="r">${RT('Выход','Exit')}</th><th class="r">%</th>${showPl?'<th class="r">P&amp;L</th>':''}</tr></thead><tbody>
      ${T.length?T.slice(0,300).map(t=>`<tr class="dk-tr" data-a="open" data-k="${dkEsc(exSymbol(t.tk,t.ccy)+'|'+String(t.ccy).toUpperCase())}"><td><span class="dk-tk">${dkEsc(t.tk)}</span><span class="dk-nm">${dkEsc(t.name)}</span>${port==='all'?`<div class="dk-note">${dkEsc(TAB_LABEL(t.tab))}</div>`:''}</td><td>${dkSide(t.side)}</td><td class="dk-num">${dkEsc(t.opened)}</td><td class="dk-num">${t.open?`<span class="dk-tag">${RT('открыта','open')}</span>`:dkEsc(t.close)}</td><td class="r dk-num">${t.days==null?'—':t.days}</td><td class="r dk-num">${dkN(t.maxQty,0)}</td><td class="r dk-num">${dkPx(t.entryAvg)}</td><td class="r dk-num">${dkPx(t.exitAvg)}</td><td class="r dk-num dk-b ${t.pl>=0?'dk-up':'dk-dn'}">${t.plPct==null?'—':dkPct(t.plPct)}</td>${showPl?`<td class="r dk-num">${t.exitQty>0?(t.pl>=0?'+':'')+dkKr(t.pl*(FX[t.ccy]||1)):'—'}</td>`:''}</tr>`).join(''):`<tr><td colspan="10" class="dk-empty">${RT('Сделок в журнале нет — «Исполнить» на плане пишет их сюда.','No trades in the journal — “Execute” on a plan writes them here.')}</td></tr>`}
    </tbody></table></div>
    <p class="dk-note dk-mt14">${RT('Сделка = от открытия позиции с нуля до закрытия в ноль по журналу PF_TRADES (частичные закрытия суммируются). Продажи позиций, открытых до ведения журнала, в статистику не входят. R по реальным сделкам появится, когда у позиций будет стоп входа (планы desk пишут его).','A trade = from opening a position from zero to closing it to zero in the PF_TRADES journal (partial closes add up). Sales of positions opened before the journal are excluded. R for real trades appears once positions carry an entry stop (desk plans record it).')}</p>`;
}
function deskPlansHTML(){
  const R=(PLAN_RULES||[]).slice().sort((a,b)=>(a.done-b.done)||((b.createdAt||0)-(a.createdAt||0)));
  return `<div class="dk-panel dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Бумага','Stock')}</th><th>${RT('Действие','Action')}</th><th class="r">${RT('Уровень','Level')}</th><th class="r">${RT('Стоп','Stop')}</th><th class="r">${RT('Цель','Target')}</th><th class="r">R/R</th><th class="r">${RT('Кол-во','Qty')}</th><th>${RT('Статус','Status')}</th><th>${RT('Портфель','Portfolio')}</th><th></th></tr></thead><tbody>
    ${R.length?R.map(r=>{const st=planStatus(r),rr=planRR(r,st.price),key=exSymbol(r.tk,r.ccy||'USD')+'|'+String(r.ccy||'USD').toUpperCase();
      const stat=r.done?RT('исполнено','done'):r.status==='open'?RT('позиция открыта','position open'):st.invalid?'✖ '+RT('сетап сломан','setup broken'):st.ready?'🔔 '+RT('пора','now'):st.gapPct!=null?RT('до уровня ','to level ')+dkN(Math.abs(st.gapPct),1)+'%':RT('взведено','armed');
      return `<tr class="dk-tr${r.done?' dk-done':''}" data-a="open" data-k="${dkEsc(key)}"><td><span class="dk-tk">${dkEsc(r.tk)}</span><span class="dk-nm">${dkEsc(r.name||'')}</span>${r.note?`<div class="dk-note">${dkEsc(String(r.note).slice(0,100))}</div>`:''}</td><td>${planActIcon(r.act,r.side)} ${planActLabel(r.act,r.side)}</td><td class="r dk-num">${st.lvl>0?dkPx(st.lvl):'—'}</td><td class="r dk-num dk-dn">${r.stop?dkPx(r.stop):'—'}</td><td class="r dk-num dk-up">${r.target?dkPx(r.target):'—'}</td><td class="r dk-num">${rr!=null?dkN(rr,1):'—'}</td><td class="r dk-num">${r.qty||'—'}</td><td>${stat}</td><td class="dk-note">${dkEsc(TAB_LABEL(r.tab||PF3_KEY))}</td>
        <td>${can('action.edit_plan')?`${r.done?'':`<button class="dk-btn dk-sm" data-a="plandone" data-id="${dkEsc(r.id)}" title="${RT('Отметить исполненным','Mark done')}">✓</button>`}<button class="dk-btn dk-sm" data-a="planx" data-id="${dkEsc(r.id)}" title="${RT('Удалить','Delete')}">🗑</button>`:''}</td></tr>`;}).join(''):`<tr><td colspan="10" class="dk-empty">${RT('Планов нет.','No plans.')}</td></tr>`}
  </tbody></table></div>
  <p class="dk-note dk-mt14">${RT('Правила проверяются при каждом обновлении котировок (тост и push в браузере); Telegram без открытой страницы — в S8 (bookcheck).','Rules are checked on every quote refresh (toast and browser push); Telegram without an open page — in S8 (bookcheck).')}</p>`;
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
  return `<div class="dk-grid dk-g4 dk-mb">${kpi(RT('Сделок','Trades'),st.n,`${n} ${RT('бумаг','stocks')} · ${st.open} ${RT('открыто','open')}`)}
      ${kpi(RT('Доля в плюсе','Win rate'),st.n?dkN(st.win/st.n*100,0)+'%':'—',RT('по R > 0','by R > 0'))}
      ${kpi(RT('Средний R','Average R'),dkR(st.avgR),RT('ожидание на сделку','expectancy per trade'),st.avgR>=0?'dk-up':'dk-dn')}
      ${kpi('Profit factor',pf(st),`${RT('лонг','long')} ${pf(L)} · ${RT('шорт','short')} ${pf(S)}`)}</div>
    <div class="dk-panel dk-mb"><div class="dk-ph"><h2>${RT('Распределение результатов в R','Distribution of results in R')}</h2><span class="dk-note dk-ml">${RT('1R = вход − стоп плана на дату входа','1R = entry − plan stop on the entry date')}</span></div><div class="dk-pad">${hist}</div></div>
    <div class="dk-panel dk-wrap"><table class="dk-tbl"><thead><tr><th>${RT('Бумага','Stock')}</th><th>${RT('Сторона','Side')}</th><th>${RT('Вход','Entry')}</th><th>${RT('Выход','Exit')}</th><th class="r">${RT('Цена','Price')}</th><th class="r">${RT('Стоп','Stop')}</th><th class="r">${RT('Цель','Target')}</th><th class="r">R</th><th>${RT('Сигнал входа','Entry signal')}</th></tr></thead><tbody>
      ${rows.length?rows.map(t=>{const x=t.exits[t.exits.length-1];return `<tr class="dk-tr" data-a="open" data-k="${dkEsc(t.key)}"><td><span class="dk-tk">${dkEsc(t.tk)}</span><span class="dk-nm">${dkEsc(t.name)}</span></td><td>${dkSide(t.side)}</td><td class="dk-num">${t.d}</td><td class="dk-num">${t.open?RT('открыта','open'):(x?x.d+' · '+dkEsc(x.why):'')}</td><td class="r dk-num">${dkPx(t.entry)}</td><td class="r dk-num dk-dn">${dkPx(t.stop0)}</td><td class="r dk-num dk-up">${dkPx(t.target)}</td><td class="r dk-num dk-b ${t.R>=0?'dk-up':'dk-dn'}">${dkR(t.R)}</td><td class="dk-ink2">${dkEsc(t.why||'')}</td></tr>`;}).join(''):`<tr><td colspan="9" class="dk-empty">${DESK_UI.load.busy?RT('Свечи грузятся…','Candles loading…'):RT('Сделок по правилам нет.','No rule trades.')}</td></tr>`}
    </tbody></table></div>
    <p class="dk-note dk-mt14">${RT('Проверка правил, а не мои сделки: вход — бар, где вердикт v2 впервые стал «Купить»/«Шорт» (без таргетов и отчётов в истории); выход — стоп, ½ на цели, +1R → безубыток, +2R → трейлинг 2·ATR. Показаны последние 80.','A rules check, not my trades: entry — the bar where verdict v2 first turned Buy/Short (no targets/earnings in history); exit — stop, ½ at target, +1R → breakeven, +2R → 2·ATR trail. Last 80 shown.')}</p>`;
}

// ── Модальное окно исполнения ──
function deskModalHTML(){
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
function deskExecOpen(key,side,mode,tab,tk){
  const it=deskSecOf(key);
  if(mode==='close'){
    const p=bookPositions(tab).find(x=>x.tk===posTk(tk));if(!p)return;
    DESK_UI.exec={key,side:p.side,mode,tab,tk:p.tk,sym:p.sym,ccy:p.ccy,qty:p.qty,price:p.calc?p.calc.now:p.entry};
  }else{
    if(!it||!it.s)return toast(RT('Сигнал ещё не посчитан','Signal not computed yet'),true);
    const p=deskPlanFor(it,side);
    DESK_UI.exec={key,side,mode:'open',tab:deskRiskTab(),tk:it.sec.tk,sym:it.sec.sym,ccy:it.sec.ccy,qty:p.qty,price:p.mode==='limit'?Math.round(p.entry*100)/100:it.s.price,stop:Math.round(p.stop*100)/100,target:Math.round(p.target*100)/100};
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
function deskPlanAdd(key,side){
  if(!can('action.edit_plan'))return;
  const it=deskSecOf(key);if(!it||!it.s)return toast(RT('Сигнал ещё не посчитан','Signal not computed yet'),true);
  const p=deskPlanFor(it,side),tab=deskRiskTab()||PF3_KEY,tk=posTk(it.sec.tk),act=side==='short'?'sell':'buy';
  const dup=(PLAN_RULES||[]).find(r=>!r.done&&r.status!=='open'&&posTk(r.tk)===tk&&r.side===side&&(r.tab||PF3_KEY)===tab&&planIsEntry(r));
  const lvl=Math.round(p.entry*100)/100,rule={tab,tk,name:it.sec.name,ccy:it.sec.ccy,act,side,level:lvl,stop:Math.round(p.stop*100)/100,target:Math.round(p.target*100)/100,qty:p.qty>0?p.qty:0,amount:0,deadline:'',
    note:(p.mode==='limit'?RT('лимит · ','limit · '):'')+(side===it.s.side?String(it.s.why[0]||''):RT('против вердикта: ','against the verdict: ')+(p.levelSrc||p.stopSrc||'')).slice(0,140),riskKr:Math.round(DESK_UI.riskOvr[key]>0?DESK_UI.riskOvr[key]:deskRiskKr())};
  if(dup)Object.assign(dup,rule,{hitAt:0});
  else PLAN_RULES.push(planRuleNorm(Object.assign({id:'pl'+Date.now()+'_'+Math.floor(Math.random()*1e4),hitAt:0,done:false,createdAt:Date.now()},rule)));
  if(dup)planRuleNorm(dup);
  planAskNotify(true);scheduleSave();
  if(DESK_UI.exec)DESK_UI.exec=null;
  toast('🎯 '+(dup?RT('План обновлён','Plan updated'):p.mode==='limit'?RT('Лимит взведён','Limit armed'):RT('В плане','Planned'))+`: ${tk} ${side==='short'?RT('шорт','short'):RT('лонг','long')} ${pf3Fmt(lvl,2)} · ${RT('стоп','stop')} ${pf3Fmt(rule.stop,2)} · ${RT('цель','target')} ${pf3Fmt(rule.target,2)} · ${rule.qty} ${RT('шт','sh')}`);
  deskRender(true);
}

// ── Классика ──
// Полная карточка/подвкладка в классическом виде (флаг desk остаётся; назад — плавающая кнопка).
function deskClassic(tab,tk,sub){
  DESK_UI.classic=true;DESK_UI.menu=false;deskChartsDrop();
  const de=document.documentElement;de.classList.remove('desk');
  let ui2=true;try{ui2=localStorage.getItem('dash_ui2')!=='0';}catch(e){}de.classList.toggle('ui2',ui2);
  const t=tab&&DATA[tab]?tab:(deskRiskTab()||PF3_KEY);
  curIdx=t;v3Key=t;pf3Sel=tk||null;pf3Tab=sub||'list';
  deskBackBtn(true);init();
  try{window.scrollTo(0,0);}catch(e){}
}
function deskBack(){
  if(!DESK_UI.on)return;
  DESK_UI.classic=false;document.documentElement.classList.add('desk');document.documentElement.classList.remove('ui2');
  deskBackBtn(false);deskEnable();
}
function deskBackBtn(show){
  let b=document.getElementById('deskBack');
  if(!show){if(b)b.remove();return;}
  if(!b){b=document.createElement('button');b.id='deskBack';b.className='desk-back';b.onclick=deskBack;document.body.appendChild(b);}
  b.textContent='↩ Trade Desk';b.title=RT('Вернуться в Trade Desk','Back to Trade Desk');
}

// ── События ──
function deskOnClick(e){
  const el=e.target.closest('[data-a]');if(!el||!document.getElementById('desk').contains(el))return;
  const a=el.dataset.a,k=el.dataset.k;
  if(a==='noop')return;
  if(a!=='menu')DESK_UI.menu=false;
  if(a==='execx'){if(e.target===el||el.tagName==='BUTTON'){DESK_UI.exec=null;deskRender(true);}return;}
  switch(a){
    case 'nav':if(el.dataset.jt)DESK_UI.jt=el.dataset.jt;deskGo(el.dataset.r,el.dataset.r==='stock'?DESK_UI.key:null);break;
    case 'open':deskGo('stock',k);break;
    case 'sel':DESK_UI.sel=DESK_UI.sel===k?null:k;deskRender(true);break;
    case 'unsel':DESK_UI.sel=null;deskRender(true);break;
    case 'fv':DESK_UI.f.v=el.dataset.v;deskRender(true);break;
    case 'fnear':DESK_UI.f.near=!DESK_UI.f.near;deskRender(true);break;
    case 'frr':DESK_UI.f.rr=!DESK_UI.f.rr;deskRender(true);break;
    case 'fheld':DESK_UI.f.held=!DESK_UI.f.held;deskRender(true);break;
    case 'sort':{const s=el.dataset.s;if(DESK_UI.sort.k===s)DESK_UI.sort.d*=-1;else DESK_UI.sort={k:s,d:(s==='tk'||s==='dEntry'||s==='near')?1:-1};deskRender(true);break;}
    case 'side':DESK_UI.side[k]=el.dataset.v;{const st=_deskChart&&_deskChart.key===k?_deskChart:_deskMini&&_deskMini.key===k?_deskMini:null;if(st&&st.ch){st.side=el.dataset.v;st.ch.setSide(el.dataset.v);}}deskRender(true);break;
    case 'years':DESK_UI.years=+el.dataset.v===3?3:1;deskRender(true);break;
    case 'plan':deskPlanAdd(k,el.dataset.side);break;
    case 'exec':deskExecOpen(k,el.dataset.side,'open');break;
    case 'close':deskExecOpen(el.dataset.key,null,'close',el.dataset.tab,k);break;
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
    case 'fund':pf3FundFetch([k]).then(()=>deskRender(true));toast(RT('Загружаю фундаментал…','Loading fundamentals…'));break;
    case 'refresh':DESK_UI.load.at=0;deskQuotes(true);deskLoad(true);break;
    case 'menu':DESK_UI.menu=!DESK_UI.menu;deskRender(true);break;
    case 'theme':DESK_UI.menu=false;toggleTheme();deskRender(true);break;
    case 'lang':DESK_UI.menu=false;toggleLang();break;
    case 'risk':DESK_UI.menu=false;deskRiskEdit();break;
    case 'classic':deskClassic(el.dataset.tab,k,el.dataset.sub);break;
    case 'classic-plan':deskClassic(deskRiskTab()||PF3_KEY,null,'plan');break;
    case 'settings':DESK_UI.menu=false;deskRender(true);toggleSettings();break;
    case 'prompts':DESK_UI.menu=false;deskRender(true);togglePrompts();break;
    case 'faq':DESK_UI.menu=false;deskRender(true);toggleFaq();break;
    case 'off':deskToggle(false);break;
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
  DESK=deskNorm({riskPct:a,riskCapPct:isFinite(b)?b:D.riskCapPct,shortOk:D.shortOk});scheduleSave();deskRender(true);
  toast('⚖️ '+RT('Риск ','Risk ')+DESK.riskPct+'% · '+RT('лимит книги ','book cap ')+DESK.riskCapPct+'%');
}
function deskOnChange(e){
  const el=e.target,c=el.dataset&&el.dataset.c;if(!c)return;
  if(c==='port'){DESK_UI.port=el.value;_deskItems=null;deskRender(true);}
  else if(c==='expo'&&DESK_UI.exec){DESK_UI.exec.tab=el.value;deskExecRisk();}
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
  else if(DESK_UI.exec&&/^dkEx/.test(el.id||'')){
    const f={dkExQty:'qty',dkExPx:'price',dkExStop:'stop',dkExTgt:'target',dkExPort:'tab',dkExDate:'date'}[el.id];
    if(f){DESK_UI.exec[f]=f==='tab'||f==='date'?el.value:(parseFloat(el.value)||0);deskExecRisk();}
  }
  else if(DESK_UI.edit&&(el.id==='dkEdStop'||el.id==='dkEdTgt'))DESK_UI.edit[el.id==='dkEdStop'?'stop':'target']=el.value;
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
  else if(e.key==='Enter'&&n){const x=_deskSg.hits[_deskSg.cur];el.value='';el.blur();deskGo('stock',x.key);}
  else if(e.key==='Escape'){el.value='';deskSuggest('');el.blur();}
}
function deskOnKey(e){
  if(!deskActive())return;
  const t=(e.target&&e.target.tagName||'').toLowerCase();if(t==='input'||t==='select'||t==='textarea'||e.metaKey||e.ctrlKey||e.altKey)return;
  if(document.querySelector('.faq-overlay:not(.hidden),.auth-overlay:not(.hidden)'))return;
  if(e.key==='Escape'){if(DESK_UI.exec){DESK_UI.exec=null;deskRender(true);}else if(DESK_UI.menu){DESK_UI.menu=false;deskRender(true);}else if(DESK_UI.sel){DESK_UI.sel=null;deskRender(true);}return;}
  const o=e.target.closest&&e.target.closest('#desk [data-a="open"]');
  if(e.key==='Enter'&&o&&o.tagName!=='BUTTON'){deskGo('stock',o.dataset.k);return;}
  if(e.key==='/'){e.preventDefault();const q=document.getElementById('dkQ');if(q)q.focus();return;}
  if(/^[1-5]$/.test(e.key)){deskGo(['today','screen','stock','book','journal'][+e.key-1]);return;}
  if(DESK_UI.route==='screen'&&(e.key==='j'||e.key==='k'||e.key==='Enter')){
    const rows=[...document.querySelectorAll('#desk .dk-scr tr[data-a="sel"]')];if(!rows.length)return;
    if(e.key==='Enter'){if(DESK_UI.sel)deskGo('stock',DESK_UI.sel);return;}
    let i=rows.findIndex(r=>r.dataset.k===DESK_UI.sel);i=e.key==='j'?Math.min(rows.length-1,i+1):Math.max(0,i-1);
    DESK_UI.sel=rows[i].dataset.k;deskPaint();
    const r2=document.querySelector(`#desk .dk-scr tr[data-k="${CSS.escape(DESK_UI.sel)}"]`);if(r2)r2.scrollIntoView({block:'nearest'});
  }
}
// Вход: флаг из URL/хранилища. Без флага desk ничего не рисует (кнопка 🖥 в шапке включает).
function deskBoot(){
  let ls=null;try{ls=localStorage.getItem(DESK_LS);}catch(e){}
  const F=deskFlagFrom(location.search,ls);
  if(F.set!=null)deskSetFlag(F.on);
  document.addEventListener('keydown',deskOnKey);
  window.addEventListener('popstate',()=>{if(deskActive()){deskFromHash();deskRender(true);}});
  window.addEventListener('hashchange',()=>{if(deskActive()){deskFromHash();deskRender(true);}});
  document.addEventListener('click',e=>{if(DESK_UI.menu&&deskActive()&&!e.target.closest('.dk-menu-w')&&!e.target.closest('#desk [data-a]')){DESK_UI.menu=false;deskRender(true);}});
  if(F.on){DESK_UI.on=true;document.documentElement.classList.add('desk');document.documentElement.classList.remove('ui2');deskEnable();}
}
deskBoot();

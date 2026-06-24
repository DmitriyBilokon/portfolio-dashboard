// ── 🤖 AI Портфель: отображение виртуального счёта (торгует worker) ─────────
// Позиции материализуются в производную вкладку DATA[AIP_KEY] и идут через
// штатный v3-конвейер (список/сектора/тип/состояние) — вид 1:1 как у портфеля.
const AIP_FLAGS={USD:'🇺🇸',SEK:'🇸🇪',NOK:'🇳🇴',DKK:'🇩🇰',EUR:'🇪🇺'};
function aipFindSrcRow(tk){
  const U=String(tk).toUpperCase();
  for(const key of v3Tabs()){
    const d=DATA[key];if(!d)continue;
    const r=(d.rows||[]).find(r=>String(r[2]||'').trim().toUpperCase()===U);
    if(r)return{r,d};
  }
  return null;
}
function aipSyncTab(){
  if(!AI_PORT)migrateAiPort();
  const p3=DATA[PF3_KEY];if(!p3)return;
  const d=DATA[AIP_KEY]||(DATA[AIP_KEY]={headers:p3.headers.slice(),rows:[],count:0,subtitle:'AI Портфель'});
  d.v3='1';d.aip='1';
  d.cashFree=Math.round(AI_PORT.cashSEK||0);
  const pos=AI_PORT.positions||[];
  const liveTk=new Set(pos.map(p=>String(p.ticker).toUpperCase()));
  d.rows=d.rows.filter(r=>liveTk.has(String(r[2]||'').trim().toUpperCase()));
  pos.forEach(p=>{
    const U=String(p.ticker).toUpperCase();
    let r=d.rows.find(r=>String(r[2]||'').trim().toUpperCase()===U);
    if(!r){
      r=new Array(d.headers.length).fill('');
      const src=aipFindSrcRow(U);
      if(src)d.headers.forEach((h,i)=>{const j=src.d.headers.indexOf(h);if(j>=0&&src.r[j]!=='')r[i]=src.r[j]});
      r[2]=p.ticker;
      if(!r[3])r[3]=AIP_FLAGS[p.ccy]||'';
      d.rows.push(r);
    }
    while(r.length<d.headers.length)r.push('');
    r[1]=p.name||p.ticker;
    if(p.sector&&(!r[4]||r[4]==='—'))r[4]=p.sector;
    if(p.type&&(!r[5]||r[5]==='—'))r[5]=p.type;
    r[6]=p.qty;r[8]=p.ccy;r[9]=p.avgBuy;
    if(!(parseFloat(r[7])>0)&&p.lastPrice)r[7]=p.lastPrice;
  });
  d.rows.forEach((r,i)=>{r[0]=i+1;recalcPF(i,AIP_KEY)});
  d.count=d.rows.length;
}
// Живую цену позиции ищем в строках вкладок (обновляются сайтом), иначе —
// lastPrice из последнего цикла worker'а.
function aipLivePrice(p){
  for(const key of v3Tabs()){
    const d=DATA[key];if(!d)continue;
    const r=(d.rows||[]).find(r=>String(r[2]||'').trim().toUpperCase()===String(p.ticker).toUpperCase());
    if(r&&parseFloat(r[7])>0)return parseFloat(r[7]);
  }
  return p.lastPrice||p.avgBuy||0;
}
function aipEquity(){
  const ap=AI_PORT;if(!ap)return{equity:0,posVal:0};
  const posVal=(ap.positions||[]).reduce((a,p)=>a+p.qty*aipLivePrice(p)*(FX[p.ccy]||1),0);
  return{equity:Math.round((ap.cashSEK||0)+posVal),posVal:Math.round(posVal)};
}
function aipMaxDD(hist){
  let peak=-Infinity,dd=0;
  (hist||[]).forEach(p=>{peak=Math.max(peak,p.v);if(peak>0)dd=Math.min(dd,(p.v-peak)/peak*100)});
  return dd;
}
function aipSpark(hist,start){
  const h=(hist||[]).slice(-180);
  if(h.length<2)return`<div class="pf3-empty">${RT('График появится после первых циклов AI','Chart appears after the first AI cycles')}</div>`;
  const vs=h.map(p=>p.v),mn=Math.min(...vs,start),mx=Math.max(...vs,start);
  const W=600,H=120,pad=6,span=(mx-mn)||1;
  const X=i=>pad+i/(h.length-1)*(W-2*pad),Y=v=>H-pad-(v-mn)/span*(H-2*pad);
  const pts=h.map((p,i)=>`${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const up=vs[vs.length-1]>=start;
  return`<svg viewBox="0 0 ${W} ${H}" class="aip-spark" preserveAspectRatio="none">
    <line x1="${pad}" y1="${Y(start).toFixed(1)}" x2="${W-pad}" y2="${Y(start).toFixed(1)}" stroke="currentColor" opacity=".25" stroke-dasharray="5 4"/>
    <polyline points="${pts}" fill="none" stroke="${up?'#10b981':'#ef4444'}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}
async function aipRunNow(ev){
  const btn=ev&&ev.target;
  if(btn){btn.disabled=true;btn.textContent='⏳ '+RT('Цикл идёт (до минуты)…','Cycle running (up to a minute)…');}
  try{
    const r=await fetch(PRICE_PROXY+'?action=aiport',{headers:{'Authorization':'Bearer '+await sbToken()}});
    // Ответ стримится (heartbeat-пробелы/переводы строки) — читаем весь текст и парсим.
    const tx=await r.text(); let j={}; try{ j=JSON.parse(tx); }catch(_){ j={result:tx}; }
    // Показываем и статус цикла, и строку анализа портфелей (через · ).
    toast(j.error?j.error:String(j.result||'OK').split('\n').filter(Boolean).join(' · '),!!j.error);
  }catch(e){toast(RT('Worker недоступен (нужен редеплой с ?action=aiport)','Worker unreachable (redeploy with ?action=aiport)'),true);}
  await aipPullState();   // подтянуть актуальное состояние воркера и перерисовать
  // Цикл также пишет авто-анализ реальных портфелей (data[key].analysis) — тянем
  // свежий снапшот облака, чтобы вкладка «📈 Анализ» у Dima/Anna обновилась.
  try{ await pullState(); }catch(e){}
  if(isV3())renderPF3();
  if(btn){btn.disabled=false;btn.textContent='▶ '+RT('Запустить цикл сейчас','Run cycle now');}
}
// 🤝 Подтянуть авторитетное состояние AI-портфеля из воркера (примиряет ledger ↔ резерв).
// Лечит «застрявшее» расхождение и держит дисплей в синхроне с Telegram.
let _aipPulling=false,_aipTimer=null;
async function aipPullState(){
  if(_aipPulling)return;_aipPulling=true;
  try{
    const r=await fetch(PRICE_PROXY+'?action=aiportstate',{headers:{'Authorization':'Bearer '+await sbToken()}});
    const j=await r.json();
    if(j&&j.port&&typeof j.port==='object'&&j.port.startedAt){
      const mine=AI_PORT||{};
      AI_PORT={...j.port};
      // несохранённые локальные настройки сохраняем (сервер уже смержил сохранённые)
      ['intervalMin','commissionPct','minTradeSEK','enabled','strategy'].forEach(k=>{ if(mine[k]!==undefined&&(mine.startedAt||0)>=(AI_PORT.startedAt||0))AI_PORT[k]=mine[k]; });
      if(isV3())renderPF3();
    }
  }catch(e){}
  _aipPulling=false;
}
function aipStart(){aipPullState();if(_aipTimer)return;_aipTimer=setInterval(()=>{if(curIdx===AIP_KEY&&!document.hidden)aipPullState();},60000);}
function aipStop(){if(_aipTimer){clearInterval(_aipTimer);_aipTimer=null;}}
// ♻️ Обнуление через worker: он владеет состоянием и резервами (ai_state),
// поэтому чистит всё атомарно — клиентский сброс воскресал бы из бэкапа.
async function aipResetRemote(ev){
  if(!confirm(RT('Обнулить AI портфель? Позиции, журнал и история будут стёрты (вместе с резервами worker\'а), счёт вернётся к 300 000 kr. Настройки и стратегия сохранятся.','Reset the AI portfolio? Positions, journal and history will be wiped (including worker backups); the account returns to 300,000 kr. Settings and strategy are kept.')))return;
  const btn=ev&&ev.target;
  if(btn){btn.disabled=true;btn.textContent='⏳…';}
  try{
    const r=await fetch(PRICE_PROXY+'?action=aipreset',{headers:{'Authorization':'Bearer '+await sbToken()}});
    const j=await r.json();
    toast(j.error||j.result||'OK',!!j.error);
    if(!j.error){
      // подтянуть свежее состояние немедленно, не дожидаясь realtime
      await pullState();
      aipSyncTab();renderAll();
    }
  }catch(e){toast(RT('Worker недоступен (нужен редеплой с ?action=aipreset)','Worker unreachable (redeploy with ?action=aipreset)'),true);}
  if(btn){btn.disabled=false;btn.textContent='♻️ '+RT('Обнулить портфель','Reset portfolio');}
}
function aipSaveSettings(){
  if(!AI_PORT)return;
  const g=id=>document.getElementById(id);
  AI_PORT.intervalMin=parseInt(g('aipInterval')&&g('aipInterval').value)||60;
  AI_PORT.enabled=!!(g('aipEnabled')&&g('aipEnabled').checked);
  scheduleSave();
  toast(RT('Настройки AI портфеля сохранены ✓','AI portfolio settings saved ✓'));
}
// 🆚 Альфа AI-портфеля vs индексы во времени (из ap.perfHistory, пишет worker).
function aipAlphaHTML(ap){
  const hist=Array.isArray(ap&&ap.perfHistory)?ap.perfHistory:[];
  const last=hist.length?hist[hist.length-1]:null;
  if(!last||!last.alpha||!Object.keys(last.alpha).length)return'';
  const cls=v=>v>=0?'pf3-up':'pf3-down';
  const wkAgo=hist.length>1?hist[Math.max(0,hist.length-8)]:null;   // ~неделю назад (дневные точки)
  const cards=Object.keys(last.alpha).map(ix=>{
    const a=last.alpha[ix];
    const prev=wkAgo&&wkAgo.alpha&&wkAgo.alpha[ix]!=null?wkAgo.alpha[ix]:null;
    const delta=prev!=null?Math.round((a-prev)*10)/10:null;
    const arrow=delta==null?'':delta>0?'▲':delta<0?'▼':'▬';
    return`<div class="aip-vs-card"><span>${ix}</span><b class="${cls(a)}">α ${a>=0?'+':''}${a}%</b>${delta!=null?`<small class="${cls(delta)}">${arrow} ${delta>=0?'+':''}${delta} pp ${RT('за нед.','wk')}</small>`:''}</div>`;
  }).join('');
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>🆚 ${RT('Альфа vs индексы','Alpha vs indices')}</span><span class="pf3-asof">${RT('обгон с момента старта · тренд за неделю','beat-the-index since start · weekly trend')}</span></div>
    <div class="aip-vs">${cards}</div>
    <div class="pf3-ai-note">${RT('α = доходность AI-портфеля минус индекс с даты старта. Эту историю видит и сам бот — он подстраивает стратегию под тренд альфы.','α = AI portfolio return minus the index since start. The bot sees this history too and adapts its strategy to the alpha trend.')}</div>
  </section>`;
}
function aipManageHTML(){
  const ap=AI_PORT;
  if(!ap)return`<section class="pf3-panel"><div class="pf3-empty">${RT('AI портфель инициализируется…','Initialising AI portfolio…')}</div></section>`;
  const {equity}=aipEquity();
  const ret=ap.startCapital>0?(equity/ap.startCapital-1)*100:0;
  // «Я vs AI»: мой портфель с момента старта AI
  const d=DATA[PF3_KEY];let myEq=0;
  if(d){d.rows.forEach(r=>{myEq+=parseFloat(r[13])||0});myEq+=parseFloat(d.cashFree)||0;}
  const myRet=ap.myStartEquity>0?(myEq/ap.myStartEquity-1)*100:null;
  const dd=aipMaxDD(ap.equityHistory);
  const closed=(ap.trades||[]).filter(t=>t.action==='sell'&&typeof t.plSEK==='number');
  const best=closed.length?closed.reduce((a,b)=>a.plSEK>b.plSEK?a:b):null;
  const worst=closed.length?closed.reduce((a,b)=>a.plSEK<b.plSEK?a:b):null;
  const pct=(v,dig)=>`${v>0?'+':''}${v.toFixed(dig==null?1:dig)}%`;
  const cls=v=>v>=0?'pf3-up':'pf3-down';
  const trRows=(ap.trades||[]).slice(-30).reverse().map(t=>`
    <div class="aip-trade">
      <span class="pf3-sig ${t.action==='buy'?'xr-buy':'xr-sell'}">${t.action==='buy'?'🟢 '+RT('Покупка','Buy'):'🔴 '+RT('Продажа','Sell')}</span>
      <b>${t.name||t.ticker}</b> <small>${t.qty} × ${pf3Fmt(t.price,2)} ${t.ccy} ≈ ${pf3Fmt(t.amountSEK)} kr${typeof t.plSEK==='number'?` · <span class="${cls(t.plSEK)}">P&L ${t.plSEK>0?'+':''}${pf3Fmt(t.plSEK)} kr</span>`:''}</small>
      <div class="aip-trade-why">${t.trigger?`<span class="aip-trig">⚡ ${t.trigger}</span> `:''}${t.reason||''}</div>
      <small class="aip-trade-ts">${new Date(t.ts).toLocaleString(LANG==='en'?'en-GB':'ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</small>
    </div>`).join('');
  return`
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>⚔️ ${RT('Я vs AI','Me vs AI')}</span><span class="pf3-asof">${RT('с момента старта AI портфеля','since the AI portfolio started')}</span></div>
    <div class="aip-vs">
      <div class="aip-vs-card"><span>🧑 ${RT('Мой портфель','My portfolio')}</span><b class="${myRet!=null?cls(myRet):''}">${myRet!=null?pct(myRet,2):'—'}</b></div>
      <div class="aip-vs-card"><span>🤖 AI</span><b class="${cls(ret)}">${pct(ret,2)}</b></div>
      <div class="aip-vs-card"><span>📉 Max drawdown AI</span><b class="${dd<0?'pf3-down':''}">${dd.toFixed(1)}%</b></div>
      <div class="aip-vs-card"><span>🏆 ${RT('Лучшая сделка','Best trade')}</span><b class="pf3-up">${best?'+'+pf3Fmt(best.plSEK)+' kr':'—'}</b><small>${best?best.ticker:''}</small></div>
      <div class="aip-vs-card"><span>💥 ${RT('Худшая сделка','Worst trade')}</span><b class="pf3-down">${worst&&worst.plSEK<0?pf3Fmt(worst.plSEK)+' kr':'—'}</b><small>${worst&&worst.plSEK<0?worst.ticker:''}</small></div>
    </div>
    ${aipSpark(ap.equityHistory,ap.startCapital||300000)}
  </section>
  ${aipAlphaHTML(ap)}
  ${ap.lastNote?`<section class="pf3-panel"><div class="pf3-panel-hd"><span>💭 ${RT('Последний комментарий AI','Latest AI note')}</span></div><div class="aip-note">${ap.lastNote}</div></section>`:''}
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>📜 ${RT('Журнал сделок','Trade journal')}</span><span class="pf3-asof">${RT('последние 30 · каждое решение с обоснованием','last 30 · every decision with reasoning')}</span></div>
    ${trRows||`<div class="pf3-empty">${RT('Сделок ещё не было','No trades yet')}</div>`}
  </section>
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>⚙️ ${RT('Управление','Controls')}</span><span class="pf3-asof">${RT('управляет AI Proto автономно','managed by AI Proto autonomously')}</span></div>
    <div class="pf3-ai-note">${RT('Этим портфелем управляет AI Proto самостоятельно — по своей методичке (📚 Плейбук) и фактам рынка. Личные правила и пользовательский промпт-стратегия здесь НЕ применяются.','AI Proto manages this portfolio on its own — by its playbook (📚) and market facts. Personal rules and a custom strategy prompt are NOT applied here.')}</div>
    <div class="aip-controls">
      <label>${RT('Цикл решений','Decision cycle')}:
        <select id="aipInterval">${[30,60,120].map(v=>`<option value="${v}"${(ap.intervalMin||60)==v?' selected':''}>${v} ${RT('мин','min')}</option>`).join('')}</select>
      </label>
      <label><input type="checkbox" id="aipEnabled"${ap.enabled!==false?' checked':''}> ${RT('AI торгует','AI trading on')}</label>
      <button class="pf3-btn" onclick="aipSaveSettings()">💾 ${RT('Сохранить','Save')}</button>
      <button class="pf3-btn" onclick="aipRunNow(event)">▶ ${RT('Запустить цикл сейчас','Run cycle now')}</button>
      <button class="pf3-btn btn-del" onclick="aipResetRemote(event)">♻️ ${RT('Обнулить портфель','Reset portfolio')}</button>
    </div>
    <div class="pf3-reco-note">${RT('Старт: 300 000 kr · комиссия 0% · мин. сделка 5 000 kr · вселенная — все вкладки сайта · сделки только в часы торгов соответствующей биржи (США 9:30–16:00 ET, Стокгольм 9:00–17:25 и т.д.) · решения принимает Claude в worker-кроне, даже когда сайт закрыт.','Start: 300,000 kr · 0% commission · min trade 5,000 kr · universe — every tab on the site · trades only during each exchange\'s market hours (US 9:30–16:00 ET, Stockholm 9:00–17:25 etc.) · decisions are made by Claude in the worker cron, even with the site closed.')}</div>
  </section>`;
}

// 🔄 Обновить всё: курсы валют + цены/SMA/уровни всех v3-вкладок + метрики/типы
// (таргеты уважают суточный таймер — форсируются кнопкой 🔁 на вкладке).
let _homeUpd=false;
async function homeUpdateAll(){
  if(_homeUpd)return;
  _homeUpd=true;
  const btn=document.getElementById('homeUpdBtn');
  if(btn){btn.disabled=true;btn.textContent='⏳ 0%';}
  const keys=v3Tabs().filter(k=>DATA[k]&&DATA[k].rows&&DATA[k].rows.length);
  let updated=0,total=0,done=0;
  try{
    try{await refreshFX()}catch(e){}
    for(const key of keys){
      const d=DATA[key];
      try{updated+=await pf3FetchPrices(d,key)}catch(e){}
      total+=d.rows.length;
      try{await pf3RefreshTargets(d)}catch(e){}
      done++;
      const b=document.getElementById('homeUpdBtn');
      if(b)b.textContent=`⏳ ${Math.round(done/keys.length*100)}% · ${TAB_LABEL(key)}`;
    }
    keys.forEach(k=>{pf3LastRefresh[k]=Date.now();});   // обновили все вкладки разом
    toast(RT(`✓ Обновлено: ${updated}/${total} акций · ${keys.length} вкладок · курсы валют`,`✓ Updated: ${updated}/${total} stocks · ${keys.length} tabs · FX rates`),updated===0);
  }finally{
    _homeUpd=false;
    _homeBestCache=null;   // 🏆 пересобрать общий рейтинг по свежим данным
    renderAll();
  }
}
// ── 📐 Valuation Check: мультипликаторы vs медиана сектора и собственная история ──
function valFmt(v){return(v==null||!isFinite(v))?'—':(+v).toFixed(1)}
function valMedian(arr){const a=arr.filter(v=>typeof v==='number'&&isFinite(v)&&v>0).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
// Медианы мультипликаторов по секторам — из всех бумаг портфеля, у которых есть VAL.
function valSectorMedians(){
  const bySec={};
  Object.values(VAL).forEach(v=>{const s=v&&v.sector;if(!s)return;(bySec[s]=bySec[s]||[]).push(v)});
  const out={};
  Object.keys(bySec).forEach(s=>{const g=bySec[s];out[s]={
    pe:valMedian(g.map(v=>v.pe)),fwdPe:valMedian(g.map(v=>v.fwdPe)),ps:valMedian(g.map(v=>v.ps)),
    evEbitda:valMedian(g.map(v=>v.evEbitda)),peg:valMedian(g.map(v=>v.peg)),n:g.length};});
  return out;
}
// Тикеры портфеля с биржевыми символами (Yahoo/FMP).
// Все вкладки (портфели + индексные watchlist + AI-портфель): больше бумаг на
// сектор → точнее медианы и шире охват недооценки.
function valPortTickers(){return insiderAllTickers().map(x=>({...x,sym:exSymbol(x.tk,x.ccy)}))}
let _valSecCache=null;
async function valUpdateAll(){
  if(_valBusy)return;_valBusy=true;
  const btn=document.getElementById('valBtn');if(btn){btn.disabled=true;btn.textContent='⏳ 0%';}
  const list=valPortTickers();const bySym={};list.forEach(x=>bySym[x.sym]=x);
  let done=0,withData=0,cheap=0;
  try{
    const tok=await sbToken();
    for(let i=0;i<list.length;i+=6){   // 6 симв/вызов: yValuation+FMP ratios, лимит субзапросов Cloudflare
      const chunk=list.slice(i,i+6);
      try{
        const r=await fetch(PRICE_PROXY+'?action=valuation',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({symbols:chunk.map(x=>x.sym)})});
        const j=await r.json();
        if(j&&!j.error){
          for(const sym of Object.keys(j)){
            const v=j[sym];if(!v)continue;const x=bySym[sym];if(!x)continue;
            const prev=VAL[x.tk]||{};
            VAL[x.tk]={...v,name:x.name||x.tk,ccy:x.ccy,notified:prev.notified||null};
            if(v.pe||v.fwdPe||v.ps||v.evEbitda)withData++;
          }
        }
      }catch(e){}
      done+=chunk.length;const b=document.getElementById('valBtn');if(b)b.textContent=`⏳ ${Math.round(done/list.length*100)}%`;
    }
    _valSecCache=valSectorMedians();
    // 🎯 A.1: агрегированные аналит. таргеты тем же набором символов (отдельный проход).
    for(let i=0;i<list.length;i+=5){   // 5 симв/вызов: 3 FMP-запроса/символ (+редиректы), лимит субзапросов Cloudflare
      const chunk=list.slice(i,i+5);
      try{
        const r=await fetch(PRICE_PROXY+'?action=targetsagg',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({symbols:chunk.map(x=>x.sym)})});
        const j=await r.json();
        if(j&&!j.error)for(const sym of Object.keys(j)){const t=j[sym];const x=bySym[sym];if(t&&x)TG_FULL[x.tk]={...t,at:new Date().toISOString()};}
      }catch(e){ if(i===0)break; }   // упал ПЕРВЫЙ чанк → эндпоинт недоступен (старый воркер/CORS), не долбим; иначе пропускаем сбойный чанк и продолжаем
    }
    // Алерты «дёшево по обоим измерениям» (новые) → Telegram, дедуп по подписи.
    for(const tk of Object.keys(VAL)){
      const v=VAL[tk];const c=valCmp(v,_valSecCache[v.sector]);
      if(c&&c.bothCount>=2){
        const sig='cheap_'+c.bothCount;
        if(v.notified!==sig){
          cheap++;VAL[tk].notified=sig;
          try{await fetch(PRICE_PROXY+'?action=valnotify',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({ticker:tk,name:v.name||tk,detail:c.detail,cross:insiderContextLine(tk)})});}catch(e){}
        }
      }else if(v.notified){VAL[tk].notified=null;}
    }
    scheduleSave(); pushSharedAnalysis();   // общие данные → все пользователи
    toast('📐 '+RT(`Оценка обновлена: ${withData}/${list.length} с данными${cheap?` · ${cheap} нов. недооценк.`:''}`,`Valuation updated: ${withData}/${list.length} with data${cheap?` · ${cheap} new undervalued`:''}`));
  }catch(e){toast(RT('Worker недоступен (нужен ?action=valuation)','Worker unreachable (?action=valuation)'),true);}
  finally{_valBusy=false;renderAll();}
}
// Сравнение бумаги: дисконт/премия к медиане сектора и к собственной истории по
// каждому мультипликатору; «дёшево по обоим» — ниже сектора И ниже истории.
function valCmp(v,secMed,peMode){
  if(!v)return null;
  const BAND=10;   // ±% полоса «на уровне»
  const peCur=(peMode==='ttm')?(v.pe||v.fwdPe):(v.fwdPe||v.pe);
  const dims=[
    {k:'pe',label:'P/E',cur:peCur,sec:secMed&&(secMed.fwdPe||secMed.pe),hist:(v.hist&&(v.hist.pe5||v.hist.pe3))||null},
    {k:'ps',label:'P/S',cur:v.ps,sec:secMed&&secMed.ps,hist:(v.hist&&(v.hist.ps5||v.hist.ps3))||null},
    {k:'ev',label:'EV/EBITDA',cur:v.evEbitda,sec:secMed&&secMed.evEbitda,hist:(v.hist&&(v.hist.ev5||v.hist.ev3))||null},
  ];
  let bothCount=0;const parts=[];
  dims.forEach(d=>{
    if(!(d.cur>0))return;
    const dSec=(d.sec>0)?(d.cur/d.sec-1)*100:null;
    const dHist=(d.hist>0)?(d.cur/d.hist-1)*100:null;
    d.secPct=dSec;d.histPct=dHist;
    const belowSec=dSec!=null&&dSec<=-BAND, belowHist=dHist!=null&&dHist<=-BAND;
    d.belowSec=belowSec;d.belowHist=belowHist;
    if(belowSec&&belowHist){bothCount++;parts.push(d.label);}
  });
  return{dims,bothCount,detail:parts.length?`${parts.join(', ')}: ниже медианы сектора и собственной истории`:''};
}
function valChip(pct){if(pct==null)return'<span class="val-na">—</span>';const cheap=pct<=-10,rich=pct>=10;const cls=cheap?'pf3-up':(rich?'pf3-down':'val-mid');return`<span class="${cls}">${pct>=0?'+':''}${pct.toFixed(0)}%</span>`}
function valSetPeMode(m){valPeMode=m;renderPF3();}
// EPS-тренд из forward vs trailing P/E: fwdPe>pe ⇒ EPS ожидаемо ПАДАЕТ (forward
// дороже), fwdPe<pe ⇒ EPS РАСТЁТ. Чистая функция — покрыта тестом.
function valEpsTrend(pe,fwdPe){
  if(!(pe>0&&fwdPe>0))return null;
  return fwdPe>pe*1.1?'down':fwdPe<pe*0.9?'up':'flat';
}
// Позиция значения на шкале «дёшево ↔ дорого»: ref (медиана сектора) = центр 50%.
// [0.5×..1.5× от ref] линейно → [0..100%]. null, если нет данных.
function valScalePos(value,ref){
  if(!(value>0&&ref>0))return null;
  const r=Math.max(0.5,Math.min(1.5,value/ref));
  return (r-0.5)*100;
}
// Полоса-шкала: центр = медиана сектора, засечка — 5y история, точка — текущее.
function valScaleBar(cur,sec,hist){
  const pCur=valScalePos(cur,sec);
  if(pCur==null)return'<span class="val-na">—</span>';
  const pHist=valScalePos(hist,sec);
  const cls=cur<sec*0.9?'cheap':cur>sec*1.1?'rich':'mid';
  return`<span class="val-scale">
    <span class="val-scale-mid"></span>
    ${pHist!=null?`<span class="val-scale-hist" style="left:${pHist}%" title="${RT('5y история','5y history')}: ${valFmt(hist)}"></span>`:''}
    <span class="val-scale-dot ${cls}" style="left:${pCur}%"></span>
  </span>`;
}
// ===== 📊 Сценарный движок (Bull / Base / Bear) + Risk/Reward =====
// Конфиг (ТЗ 6: формулы и пороги — не в коде карточки).
// v1.1: два горизонта. atrMult — ширина; corridorAtr — отсечка дальних уровней;
// eventR — типичная просадка на провале отчёта (среднесрочный событийный Bear).
const SCENARIO_CFG={atrMult:1.5, corridorAtr:2.5, eventR:0.20, bullTargetBand:0.10, atrFallbackPct:0.02, rsiHot:70, rsiCold:30, freshDays:30, projDays:10};
// ATR-прокси по закрытиям (средний |Δ| за n дней) — без H/L, из кэша истории.
function atrFromCloses(c,n=14){
  if(!Array.isArray(c)||c.length<n+1)return 0;
  let s=0,k=0; for(let i=c.length-n;i<c.length;i++){if(c[i]>0&&c[i-1]>0){s+=Math.abs(c[i]-c[i-1]);k++;}}
  return k?s/k:0;
}
// RSI(14) по закрытиям.
function rsiFromCloses(c,n=14){
  if(!Array.isArray(c)||c.length<n+1)return null;
  let g=0,l=0; for(let i=c.length-n;i<c.length;i++){const dd=c[i]-c[i-1];if(dd>=0)g+=dd;else l-=dd;}
  const al=l/n; if(al===0)return 100; const rs=(g/n)/al; return Math.round((100-100/(1+rs))*10)/10;
}
// Недельные закрытия из дневных (каждое 5-е с конца) — для RSI 1W (B.1).
function weeklyFromCloses(c){ if(!Array.isArray(c))return[]; const w=[]; for(let i=c.length-1;i>=0;i-=5)w.unshift(c[i]); return w; }
// Достаём ATR(1D)/RSI(1D)/RSI(1W) из закэшированной истории графика (офлайн).
function scenarioTech(tk,ccy){
  try{ const pre=exSymbol(tk,ccy)+':';
    for(const k of Object.keys(_histCache||{})){ if(k.indexOf(pre)===0){ const j=_histCache[k].j; const c=((j&&j.c)||[]).filter(x=>typeof x==='number'&&isFinite(x)&&x>0); if(c.length>20)return {atr:atrFromCloses(c),rsi:rsiFromCloses(c),rsiW:rsiFromCloses(weeklyFromCloses(c))}; } }
  }catch(e){}
  return {atr:0,rsi:null,rsiW:null};
}
// B.3.1 Проекция по ATR: ±ATR×√N (≈ ±1σ за N дней). Не цель и не триггер. Чистая ф-я.
function scenarioProjection(price,atr,N){
  N=N||SCENARIO_CFG.projDays; price=+price; atr=+atr;
  if(!(price>0)||!(atr>0))return null;
  const w=atr*Math.sqrt(N);
  return {n:N,width:w,high:price+w,low:price-w,pct:w/price*100};
}
// ── Краткосрок (дни-недели): цель = ближайший S/R в коридоре ±2.5×ATR, иначе ±1.5×ATR (B.3). ──
function scenarioShort(inp){
  const price=+inp.price; if(!(price>0))return null;
  const cfg=SCENARIO_CFG, atr=(+inp.atr>0)?+inp.atr:price*cfg.atrFallbackPct, corr=cfg.corridorAtr*atr;
  const resistance=+inp.resistance||0, support=+inp.support||0, sma50=+inp.sma50||0, rsi=inp.rsi==null?null:+inp.rsi;
  const resIn=(resistance>price&&resistance<=price+corr)?resistance:0;            // ближайшее сопротивление в коридоре
  const supIn=(support>0&&support<price&&support>=price-corr)?support:0;
  const sma50In=(sma50>0&&sma50<price&&sma50>=price-corr)?sma50:0;
  const bull=resIn>0?resIn:(price+cfg.atrMult*atr);                              // цель = уровень; ATR лишь fallback
  const downLevel=Math.max(supIn,sma50In);                                       // ближайший уровень снизу
  const bear=downLevel>0?downLevel:(price-cfg.atrMult*atr);
  const upside=(bull-price)/price*100, downside=(price-bear)/price*100;
  const rr=downside>0?upside/downside:null;
  const overbought=(rsi!=null&&rsi>cfg.rsiHot);
  return {horizon:'short',valid:true,price,atr,bull,base:price,bear,upside,downside,rr,
    bullConf:'medium',baseConf:'medium',bearConf:overbought?'high':'medium',rsi,
    resIn,supIn,sma50In,overbought};
}
// ── Среднесрок (до отчёта): Bull/Base от СВЕЖИХ таргетов, Bear событийный. Sanity-check (B.8). ──
function scenarioMid(inp){
  const price=+inp.price; if(!(price>0))return null;
  const cfg=SCENARIO_CFG, consensus=+inp.target||0, high=+inp.targetHigh||0, fresh=!!inp.fresh;
  // A.1 КРИТИЧНО: без свежих таргетов НЕ подставляем устаревшее — «недостаточно данных», без R/R.
  if(!fresh||!(consensus>0)) return {horizon:'mid',valid:false,note:'lowdata',price,bull:null,base:null,bear:null,rr:null};
  const base=consensus, bull=high>0?high:consensus*(1+cfg.bullTargetBand), R=(+inp.eventR>0)?+inp.eventR:cfg.eventR;
  const bear=price*(1-R);   // событийный: реакция на провал отчёта (−R% от цены), не консенсус
  const rsi=inp.rsi==null?null:+inp.rsi;
  const overbought=(rsi!=null&&rsi>cfg.rsiHot)||(price>consensus);
  const stretch=price>consensus&&overbought;
  let bullConf=high>0?'medium':'low', bearConf='medium';
  if(stretch){bullConf='low';bearConf='high';}
  // B.8 sanity (порядок важен): bull<base — настоящая ошибка; bull≤цены — нет апсайда по таргетам.
  if(bull<base)   return {horizon:'mid',valid:false,note:'broken',price,bull,base,bear,bullConf,bearConf,rr:null,stretch,R};
  if(bull<=price) return {horizon:'mid',valid:false,note:'noupside',price,bull,base,bear,bullConf,bearConf,rr:null,stretch,R};
  const upside=(bull-price)/price*100, downside=(price-bear)/price*100;
  const rr=downside>0?upside/downside:null;
  return {horizon:'mid',valid:true,note:null,price,bull,base,bear,upside,downside,rr,bullConf,baseConf:'medium',bearConf,stretch,R};
}
// 📉 implied move из опционов (живой) по тикеру: {data:{movePct,expiry,days,iv,atm},at,loading}.
let OPT_IV={};
function pf3OptEnsure(tk,ccy){
  const cur=OPT_IV[tk];
  if(cur&&cur.loading)return;
  if(cur&&cur.at&&Date.now()-cur.at<30*60000)return;   // кэш 30 мин
  OPT_IV[tk]={data:cur?cur.data:null,at:cur?cur.at:0,loading:true};
  fetch(PRICE_PROXY+'?options='+encodeURIComponent(exSymbol(tk,ccy))).then(r=>r.json()).then(j=>{
    OPT_IV[tk]={data:(j&&!j.error&&j.movePct>0)?j:null,at:Date.now(),loading:false};
    if(isV3()&&pf3Sel===tk)renderPF3();
  }).catch(()=>{OPT_IV[tk]={data:null,at:Date.now(),loading:false};});
}
// ── 📰 Живые новости Yahoo по тикеру + sentiment для рекомендаций ──
let NEWS_LIVE={};   // {tk:{items:[{title,publisher,link,time,pol}], sent, pos, neg, at, loading}}
// Чистая функция: заголовки → sentiment с весом по свежести (новое весомее).
// Вес: ≤2 дн = 1.0; линейно до ~0.15 на 14 дн; >21 дн = 0. sent = Σ(полярность×вес).
function newsRecencyWeight(ageDays){ if(!(ageDays>=0))return 1; if(ageDays<=2)return 1; if(ageDays>=21)return 0; return Math.max(0.1,1-(ageDays-2)/19); }
function newsSentiment(items,nowMs){
  if(!Array.isArray(items)||!items.length)return {sent:0,pos:0,neg:0,n:0};
  let sent=0,pos=0,neg=0;
  items.forEach(it=>{
    const pol=(typeof it.pol==='number')?it.pol:newsPolarity(it.title||'');
    const age=it.time>0?(nowMs-it.time)/864e5:5;   // нет даты → считаем ~5 дней
    sent+=pol*newsRecencyWeight(age);
    if(pol>0)pos++;else if(pol<0)neg++;
  });
  return {sent:Math.round(sent*10)/10,pos,neg,n:items.length};
}
function pf3NewsEnsure(tk,ccy){
  const cur=NEWS_LIVE[tk];
  if(cur&&cur.loading)return;
  if(cur&&cur.at&&Date.now()-cur.at<10*60000)return;   // кэш 10 мин = «онлайн»
  NEWS_LIVE[tk]={...(cur||{}),loading:true};
  fetch(PRICE_PROXY+'?news='+encodeURIComponent(exSymbol(tk,ccy))).then(r=>r.json()).then(j=>{
    const items=(j&&Array.isArray(j.items))?j.items.map(it=>({...it,pol:newsPolarity(it.title||'')})):[];
    const s=newsSentiment(items,Date.now());
    NEWS_LIVE[tk]={items,sent:s.sent,pos:s.pos,neg:s.neg,at:Date.now(),loading:false};
    if(isV3()&&pf3Sel===tk)renderPF3();
  }).catch(()=>{NEWS_LIVE[tk]={...(NEWS_LIVE[tk]||{}),loading:false,at:Date.now()};});
}
function newsAgoLbl(ms){ if(!(ms>0))return ''; const d=Math.floor((Date.now()-ms)/864e5),h=Math.floor((Date.now()-ms)/36e5);
  if(d>=1)return RT(d+' дн назад',d+'d ago'); if(h>=1)return RT(h+' ч назад',h+'h ago'); return RT('недавно','just now'); }
function pf3NewsLiveHTML(tk,ccy){
  pf3NewsEnsure(tk,ccy);
  const n=NEWS_LIVE[tk];
  const sub=(n&&n.items&&n.items.length)?`${n.items.length} ${RT('заголовков','headlines')} · ${RT('настрой','tone')} ${n.sent>0?'🟢 +':n.sent<0?'🔴 ':'⚪ '}${n.sent}`:RT('Yahoo Finance','Yahoo Finance');
  let body;
  if(n&&n.items&&n.items.length){
    body=`<div class="nlv-list">${n.items.map(it=>{
      const pol=it.pol||0,ic=pol>0?'🟢':pol<0?'🔴':'⚪';
      const link=it.link?`href="${it.link}" target="_blank" rel="noopener"`:'';
      return`<a class="nlv-row" ${link}><span class="nlv-pol">${ic}</span><span class="nlv-main"><span class="nlv-title">${(it.title||'').replace(/</g,'&lt;')}</span><span class="nlv-meta">${it.publisher?it.publisher+' · ':''}${newsAgoLbl(it.time)}</span></span></a>`;
    }).join('')}</div>`;
  }else if(n&&n.loading){ body=`<div class="pf3-empty">⏳ ${RT('Загрузка новостей…','Loading news…')}</div>`; }
  else { body=`<div class="pf3-empty">${RT('Свежих новостей не найдено.','No recent news found.')}</div>`; }
  return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>📰 ${RT('Новости (Yahoo)','News (Yahoo)')} ${infoBtn('newslive')}</span><span class="pf3-asof">${sub}</span><button class="pf3-btn pf3-btn-sm" onclick="pf3NewsRefresh('${tk}','${ccy}')" title="${RT('Обновить новости','Refresh news')}">🔄</button></div>${body}<div class="pf3-reco-note">${RT('Заголовки тянутся с Yahoo Finance (обновление ~10 мин). Тональность — по словарю, учитывается в рекомендации. Справочно, не индивидуальная рекомендация.','Headlines from Yahoo Finance (refresh ~10 min). Tone is lexicon-based and factors into the recommendation. Reference only, not advice.')}</div></section>`;
}
function pf3NewsRefresh(tk,ccy){ if(NEWS_LIVE[tk])NEWS_LIVE[tk].at=0; pf3NewsEnsure(tk,ccy); }
// 📰 Подтянуть свежие новости по ПОЗИЦИЯМ вкладки (qty>0) — для анализа портфеля,
// чтобы AI видел события этой недели (даунгрейды, отчёты), а не только устаревшие таргеты.
async function pf3PullHoldingsNews(key){
  const d=DATA[key]; if(!d||!Array.isArray(d.rows))return;
  const seen=new Set(),jobs=[];
  d.rows.forEach(r=>{const tk=String(r[2]||'').trim().toUpperCase(),ccy=r[8]||'USD';if(!tk||seen.has(tk))return;if(!((parseFloat(r[6])||0)>0))return;seen.add(tk);jobs.push([tk,ccy]);});
  for(const it of jobs.slice(0,20)){
    const cur=NEWS_LIVE[it[0]];
    if(cur&&cur.at&&Date.now()-cur.at<10*60000)continue;   // свежее (≤10 мин) уже есть
    try{
      const j=await fetch(PRICE_PROXY+'?news='+encodeURIComponent(exSymbol(it[0],it[1]))).then(r=>r.json());
      const items=(j&&Array.isArray(j.items))?j.items.map(n=>({...n,pol:newsPolarity(n.title||'')})):[];
      const s=newsSentiment(items,Date.now());
      NEWS_LIVE[it[0]]={items,sent:s.sent,pos:s.pos,neg:s.neg,at:Date.now(),loading:false};
    }catch(e){}
  }
}
// Сводка живых новостей по позициям → в снапшот для AI (тональность + свежие заголовки).
function pf3LiveNewsForAi(key){
  const d=DATA[key]; if(!d||!Array.isArray(d.rows))return null;
  const out={},seen=new Set();
  d.rows.forEach(r=>{const tk=String(r[2]||'').trim().toUpperCase();if(!tk||seen.has(tk))return;if(!((parseFloat(r[6])||0)>0))return;seen.add(tk);
    const n=NEWS_LIVE[tk];if(!n||!n.items||!n.items.length)return;
    out[tk]={sent:n.sent,headlines:n.items.slice(0,4).map(it=>({t:it.title,pol:it.pol||0,ageDays:it.time>0?Math.floor((Date.now()-it.time)/864e5):null}))};
  });
  return Object.keys(out).length?out:null;
}
// 📰 Массовая подгрузка новостей по всем тикерам портфелей — чтобы рейтинг 🏆 учитывал фон.
let _homeNewsLoad=false;
async function homeNewsAll(){
  if(_homeNewsLoad)return;_homeNewsLoad=true;
  const btn=document.getElementById('homeNewsBtn');if(btn){btn.disabled=true;btn.textContent='⏳ 0%';}
  const seen=new Set(),list=[];
  v3Tabs().forEach(k=>{const d=DATA[k];if(!d||!Array.isArray(d.rows))return;d.rows.forEach(r=>{const tk=String(r[2]||'').trim().toUpperCase(),ccy=r[8]||'USD';if(!tk||seen.has(tk)||!((parseFloat(r[7])||0)>0))return;seen.add(tk);list.push([tk,ccy]);});});
  let done=0;
  for(const it of list){
    try{
      const j=await fetch(PRICE_PROXY+'?news='+encodeURIComponent(exSymbol(it[0],it[1]))).then(r=>r.json());
      const items=(j&&Array.isArray(j.items))?j.items.map(n=>({...n,pol:newsPolarity(n.title||'')})):[];
      const s=newsSentiment(items,Date.now());
      NEWS_LIVE[it[0]]={items,sent:s.sent,pos:s.pos,neg:s.neg,at:Date.now(),loading:false};
    }catch(e){}
    done++;const b=document.getElementById('homeNewsBtn');if(b)b.textContent=`⏳ ${Math.round(done/list.length*100)}%`;
  }
  _homeNewsLoad=false;_homeBestCache=null;
  toast(RT(`✓ Новости подтянуты: ${list.length} акций`,`✓ News pulled: ${list.length} stocks`));
  if(curIdx===HOME_KEY)renderAll();
}
// Свежий консенсус-таргет для среднесрочного сценария — тот же источник, что и
// карточка: TG_FULL (агрегация A.1) → квартальный срез pf3EffTarget → eff (если не
// stale). Устаревшим (не используется) считается ТОЛЬКО all-time (eff.main).
function scnFreshTarget(d,r){
  const tk=String(r[2]||'').toUpperCase(), tgf=TG_FULL[tk];
  // Yahoo-источник (src:'yahoo') — живой консенсус, свежий без даты; FMP — по lastDate ≤ N.
  if(tgf&&tgf.consensus>0&&(tgf.src==='yahoo'||(tgf.lastDate&&((Date.now()-Date.parse(tgf.lastDate))/864e5<=SCENARIO_CFG.freshDays))))
    return {consensus:tgf.consensus,high:tgf.high||0,fresh:true,staleConsensus:0};
  const eff=pf3EffTarget(d,r)||{};
  if(eff.recent>0)                 return {consensus:eff.recent,high:0,fresh:true,staleConsensus:0};   // «за квартал» = свежий
  if(eff.target>0&&!eff.stale)     return {consensus:eff.target,high:0,fresh:true,staleConsensus:0};
  return {consensus:0,high:0,fresh:false,staleConsensus:eff.main||eff.target||0};
}
// Панель «Сценарии» (двухгоризонтная) в карточке акции.
function pf3ScenarioHTML(d,r){
  const tk=String(r[2]||'').toUpperCase(), ccy=r[8]||'USD', price=parseFloat(r[7])||0;
  if(!(price>0))return '';
  const sm=smaIdx(d), sma50=sm.s50>=0?parseFloat(r[sm.s50]):0;
  const supC=ensurePFCol(d,'Поддержка'),resC=ensurePFCol(d,'Сопротивление');
  const support=supC>=0?parseFloat(r[supC]):0, resistance=resC>=0?parseFloat(r[resC]):0;
  // Свежий консенсус — тот же, что в карточке (TG_FULL → квартальный срез pf3EffTarget).
  const ft=scnFreshTarget(d,r), fresh=ft.fresh, consensus=ft.consensus, high=ft.high, staleConsensus=ft.staleConsensus;
  const tech=scenarioTech(tk,ccy);
  pf3OptEnsure(tk,ccy);   // 📉 живой implied move (опционы)
  const opt=OPT_IV[tk]&&OPT_IV[tk].data;
  // R событийного Bear (B.4): приоритет — ход на ОТЧЁТ (если есть), иначе ближайшая экспирация.
  const impR=(opt&&opt.earn&&opt.earn.movePct>0)?opt.earn.movePct/100:((opt&&opt.movePct>0)?opt.movePct/100:0);
  const sh=scenarioShort({price,atr:tech.atr,support,resistance,sma50,rsi:tech.rsi});       // RSI 1D
  const md=scenarioMid({price,target:consensus,targetHigh:high,support,rsi:tech.rsiW,fresh,eventR:impR}); // RSI 1W
  const proj=scenarioProjection(price,tech.atr);
  if(!sh&&!md)return '';
  const CONF={high:RT('высокая','high'),medium:RT('средняя','medium'),low:RT('низкая · растяжение','low · stretch'),lowdata:RT('мало данных','low data')};
  const TYP={price:RT('цена','price'),indicator:RT('индикатор','indicator'),event:RT('событие','event')};
  const pctOf=v=>`${v>=price?'+':''}${((v-price)/price*100).toFixed(1)}%`;
  const cls=v=>v>=price?'pf3-up':'pf3-down';
  const cell=(icon,name,lvl,scls,conf,trig,typ)=>`<div class="scn-col scn-${scls}">
    <div class="scn-h">${icon} ${name}</div>
    <div class="scn-px ${cls(lvl)}">${pf3Fmt(lvl,2)} <small>${ccy}</small></div>
    <div class="scn-pct ${cls(lvl)}">${pctOf(lvl)}</div>
    <div class="scn-trig">${trig}<span class="scn-typ">${TYP[typ]||typ}</span></div>
    <div class="scn-conf">${RT('увер.','conf')}: ${CONF[conf]||conf}</div>
  </div>`;
  const rrRow=s=>{const rr=s.rr,rc=rr==null?'':rr<1?'scn-rr-bad':rr>2?'scn-rr-good':'';
    const note=rr==null?'':rr<1?RT('риск > потенциала — зона фиксации','risk > reward — trim zone'):rr>2?RT('асимметрия в пользу роста','asymmetry to the upside'):RT('сбалансировано','balanced');
    return`<div class="scn-rr ${rc}">⚖️ R/R = <b>${rr==null?'—':rr.toFixed(2)}</b> · ${RT('апсайд','up')} ${s.upside>=0?'+':''}${s.upside.toFixed(1)}% / ${RT('даунсайд','down')} −${s.downside.toFixed(1)}% — ${note}</div>`;};
  const shBullTrig=sh.resIn>0?RT(`закрытие > сопротивления ${pf3Fmt(sh.resIn,2)} на объёме`,`close > resistance ${pf3Fmt(sh.resIn,2)} on volume`):RT(`+1.5·ATR (${pf3Fmt(sh.bull,2)})`,`+1.5·ATR (${pf3Fmt(sh.bull,2)})`);
  const shBearTrig=sh.overbought?RT('RSI разворот из >70 / пробой уровня','RSI turns down from >70 / level break'):(sh.supIn>0?RT(`потеря поддержки ${pf3Fmt(sh.supIn,2)}`,`loses support ${pf3Fmt(sh.supIn,2)}`):(sh.sma50In>0?RT(`пробой SMA50 ${pf3Fmt(sh.sma50In,2)}`,`breaks SMA50 ${pf3Fmt(sh.sma50In,2)}`):RT(`−1.5·ATR (${pf3Fmt(sh.bear,2)})`,`−1.5·ATR (${pf3Fmt(sh.bear,2)})`)));
  const tf=(v,frame)=>v!=null?`${v.toFixed(0)} <span class="scn-tf">${frame}</span>`:'—';
  const projRow=proj?`<div class="scn-proj">📐 ${RT('Проекция','Projection')} ±1σ ≈ <b>${pf3Fmt(proj.low,2)}–${pf3Fmt(proj.high,2)} ${ccy}</b> (±${proj.pct.toFixed(1)}% ${RT('за','over')} ~${proj.n} ${RT('дн','d')}) · <span class="scn-tf">${RT('статистика по ATR, не цель/триггер','ATR statistic, not a target/trigger')}</span></div>`:'';
  const shBlock=`<div class="scn-hz"><div class="scn-hz-h">⏱ ${RT('Краткосрок','Short-term')} <span class="scn-hz-s">${RT('дни-недели · ближайшие S/R в ±2.5·ATR','days-weeks · nearest S/R in ±2.5·ATR')} · RSI ${tf(tech.rsi,'1D')}</span></div>
    <div class="scn-grid">
      ${cell('🟢','Bull',sh.bull,'bull',sh.bullConf,shBullTrig,'price')}
      ${cell('⚪','Base',sh.base,'base',sh.baseConf,RT('текущая цена','current price'),'price')}
      ${cell('🔴','Bear',sh.bear,'bear',sh.bearConf,shBearTrig,sh.overbought?'indicator':'price')}
    </div>${rrRow(sh)}${projRow}</div>`;
  // Среднесрок: valid/noupside показывают реальные Bull/Base/Bear; lowdata/broken — только пояснение.
  let mdBody;
  if(md.valid||md.note==='noupside'){
    const mdRpct=Math.round((md.R||SCENARIO_CFG.eventR)*100);
    const mdImpSrc=(impR>0&&Math.abs(md.R-impR)<1e-9)?(opt&&opt.earn&&opt.earn.movePct>0?RT(' (опционы на отчёт)',' (earnings options)'):RT(' (по опционам)',' (from options)')):'';
    const mdBearTrig=RT(`слабый отчёт / снижение гайденса → −${mdRpct}%${mdImpSrc}`,`earnings miss / guidance cut → −${mdRpct}%${mdImpSrc}`);
    const mdCells=`<div class="scn-grid">
      ${cell('🟢','Bull',md.bull,'bull',md.bullConf||'low',RT('отчёт выше ожиданий / рост гайденса','earnings beat / guidance raise'),'event')}
      ${cell('⚪','Base',md.base,'base',md.baseConf||'medium',RT('консенсус-таргет','analyst consensus'),'event')}
      ${cell('🔴','Bear',md.bear,'bear',md.bearConf||'medium',mdBearTrig,'event')}
    </div>`;
    mdBody=mdCells+(md.valid?rrRow(md):`<div class="scn-rr scn-rr-bad">⚠️ ${RT(`цена выше верхнего таргета аналитиков (${pf3Fmt(md.bull,0)} ${ccy}) — апсайда по таргетам нет, R/R скрыт`,`price is above the highest analyst target (${pf3Fmt(md.bull,0)} ${ccy}) — no target upside, R/R hidden`)}</div>`);
  }else{
    const msg=md.note==='broken'?RT('Данные неконсистентны (Bull ниже Base) — R/R скрыт.','Inconsistent data (Bull below Base) — R/R hidden.')
      :RT('Недостаточно свежих таргетов аналитиков — Bull/Base не рассчитаны, R/R не показан.','No fresh analyst targets — Bull/Base not computed, R/R hidden.');
    const staleRef=(md.note==='lowdata'&&staleConsensus>0)?`<div class="scn-stale-ref">${RT('устар. таргет','stale target')} ~${pf3Fmt(staleConsensus,0)} ${ccy} — ${RT('не используется в сценариях','not used in scenarios')}</div>`:'';
    mdBody=`<div class="scn-nodata">⚠️ ${msg}</div>${staleRef}`;
  }
  const mdBlock=`<div class="scn-hz"><div class="scn-hz-h">📅 ${RT('Среднесрок','Mid-term')} <span class="scn-hz-s">${RT('до отчёта · таргеты + событие','to earnings · targets + event')} · RSI ${tf(tech.rsiW,'1W')}</span>${md.stretch?` <span class="scn-stretch">⚠ ${RT('растяжение','stretched')}</span>`:''}</div>${mdBody}</div>`;
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>📊 ${RT('Сценарии','Scenarios')} ${infoBtn('scenario')}</span><span class="pf3-asof">${RT('от','from')} ${pf3Fmt(price,2)} ${ccy}${tech.atr>0?` · ATR ${pf3Fmt(tech.atr,2)} 1D`:''}</span></div>
    ${opt&&opt.movePct>0?`<div class="pf3-opt-im" title="${RT('Закладываемый опционами ход — из ATM-стрэддла (call+put). Ближайшая экспирация + отдельно ход на отчёт (экспирация, покрывающая дату отчёта). Живое значение с Yahoo, без платных токенов.','Implied move from the ATM straddle (call+put). Nearest expiry plus the earnings move (expiration covering the report date). Live from Yahoo, no paid tokens.')}">📉 ${RT('Опционы закладывают ход','Options imply a move of')} <b>±${opt.movePct.toFixed(1)}%</b> ${RT('к','to')} ${opt.expiry}${opt.days>0?` · ${opt.days} ${RT('дн','d')}`:''}${opt.iv>0?` · IV ${opt.iv.toFixed(0)}%`:''}${opt.earn&&opt.earn.movePct>0?`<br>📅 ${RT('На отчёт','Earnings')} ${opt.earn.date}: <b>±${opt.earn.movePct.toFixed(1)}%</b> <span class="pf3-opt-sub">(${RT('эксп','exp')} ${opt.earn.expiry}${opt.earn.days>0?` · ${opt.earn.days} ${RT('дн','d')}`:''}${opt.earn.iv>0?` · IV ${opt.earn.iv.toFixed(0)}%`:''})</span>`:''}</div>`:''}
    ${shBlock}${mdBlock}
    <div class="pf3-ai-note">${RT('Два РАЗДЕЛЬНЫХ горизонта со своим R/R. Краткосрок — ближайшие S/R в коридоре ±2.5·ATR (RSI/ATR 1D), плюс полоса проекции ±ATR×√10 (≈±1σ за 2 нед, не цель). Среднесрок — Bull/Base только от СВЕЖИХ таргетов (иначе «недостаточно данных»), Bear событийный; RSI 1W. Sanity-check скрывает R/R при сломанных/устаревших входах. Справочно, не рекомендация.','Two SEPARATE horizons, each with its own R/R. Short-term — nearest S/R within ±2.5·ATR (RSI/ATR 1D) plus an ±ATR×√10 projection band (≈±1σ over 2 weeks, not a target). Mid-term — Bull/Base only from FRESH targets (else «not enough data»), event-based Bear; RSI 1W. A sanity check hides R/R on broken/stale inputs. Reference only.')}</div>
  </section>`;
}
// ── 📊 Блок D: сценарные алерты (касание триггера / смена знака R/R / выход RSI) ──
// Чистый детектор: сравнивает прошлое и текущее наблюдение → список новых событий.
function scnAlertEvents(prev,now){
  prev=prev||null; const ev=[];
  if(!prev)return ev;   // первое наблюдение — не алертим
  if(now.priceAboveBull&&!prev.priceAboveBull)ev.push({kind:'bull',text:RT('цена достигла bull-триггера','price reached the bull trigger')});
  if(now.priceBelowBear&&!prev.priceBelowBear)ev.push({kind:'bear',text:RT('цена достигла bear-триггера','price reached the bear trigger')});
  if(prev.rrShort!=null&&now.rrShort!=null&&((prev.rrShort<1)!==(now.rrShort<1)))
    ev.push({kind:'rr',text:RT(`R/R пересёк 1.0 → ${now.rrShort.toFixed(2)}`,`R/R crossed 1.0 → ${now.rrShort.toFixed(2)}`)});
  if(now.stretch&&prev.rsi!=null&&now.rsi!=null){
    if(prev.rsi>70&&now.rsi<=70)ev.push({kind:'rsi',text:RT('RSI вышел вниз из зоны >70 (растяжение)','RSI exited >70 (stretched)')});
    else if(prev.rsi<30&&now.rsi>=30)ev.push({kind:'rsi',text:RT('RSI вышел вверх из зоны <30','RSI exited <30')});
  }
  return ev;
}
function scnNotifyTelegram(tk,name,text){
  if(!isAdmin())return;   // Telegram-рассылка — только от админа
  sbToken().then(tok=>{fetch(PRICE_PROXY+'?action=scnnotify',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({ticker:tk,name,text})}).catch(()=>{});}).catch(()=>{});
}
// Проверка сценарных триггеров по позициям текущей вкладки (вызывается после обновления цен).
function scnAlertCheck(){
  if(!isV3())return; const d=pf3D(); if(!d||!Array.isArray(d.rows))return;
  const sm=smaIdx(d), supC=ensurePFCol(d,'Поддержка'), resC=ensurePFCol(d,'Сопротивление');
  let changed=false;
  d.rows.forEach(r=>{
    if(!((parseFloat(r[6])||0)>0))return;   // только позиции
    const tk=String(r[2]||'').toUpperCase(), ccy=r[8]||'USD', price=parseFloat(r[7])||0;
    if(!(price>0)||!tk)return;
    const sma50=sm.s50>=0?parseFloat(r[sm.s50]):0;
    const support=supC>=0?parseFloat(r[supC]):0, resistance=resC>=0?parseFloat(r[resC]):0;
    const ft=scnFreshTarget(d,r);
    const tech=scenarioTech(tk,ccy);
    const sh=scenarioShort({price,atr:tech.atr,support,resistance,sma50,rsi:tech.rsi});
    const md=scenarioMid({price,target:ft.consensus,targetHigh:ft.high,support,rsi:tech.rsiW,fresh:ft.fresh});
    if(!sh)return;
    const now={rrShort:sh.rr,rsi:tech.rsi,stretch:!!(md&&md.stretch),priceAboveBull:price>=sh.bull,priceBelowBear:price<=sh.bear};
    const prev=SCN_ALERT_STATE[tk];
    const ev=scnAlertEvents(prev,now);
    SCN_ALERT_STATE[tk]=now; changed=true;
    ev.forEach(e=>{
      const msg=`📊 ${tk}: ${e.text} · ${pf3Fmt(price,2)} ${ccy}`;
      toast(msg); if(typeof planNotify==='function')planNotify('📊 '+RT('Сценарный сигнал','Scenario signal'),msg);
      scnNotifyTelegram(tk,String(r[1]||tk),e.text+` · ${pf3Fmt(price,2)} ${ccy}`);
    });
  });
  if(changed)scheduleSave();
}
// Профильная группа пиров: бумаги портфеля той же ИНДУСТРИИ (точнее), иначе
// того же сектора. Возвращает записи VAL с хотя бы одним мультипликатором.
function valPeerGroup(tk){
  const v=VAL[tk]; if(!v)return [];
  const useInd=!!v.industry;
  if(!(useInd?v.industry:v.sector))return [];
  return Object.keys(VAL).map(t=>({tk:t,...VAL[t]}))
    .filter(e=>(e.pe||e.fwdPe||e.ps||e.evEbitda)&&(useInd?e.industry===v.industry:e.sector===v.sector));
}
// Сравнение «в ряд» с пирами: таблица P/E·P/S·EV/EBITDA, подсветка лучшей/худшей
// ячейки текущей бумаги. P/E уважает тумблер Fwd/TTM.
function valPeerTableHTML(tk){
  const group=valPeerGroup(tk);
  if(group.length<2)return '';
  const peVal=e=>valPeMode==='ttm'?(e.pe||e.fwdPe):(e.fwdPe||e.pe);
  let rows=group.slice().sort((a,b)=>(peVal(a)||1e9)-(peVal(b)||1e9));
  if(rows.length>6){ const self=rows.find(e=>e.tk===tk); rows=rows.slice(0,6); if(self&&!rows.some(e=>e.tk===tk))rows[5]=self; }
  const cols=[['P/E',peVal],['P/S',e=>e.ps],['EV/E',e=>e.evEbitda]];
  const ext=cols.map(([,f])=>{const vals=rows.map(f).filter(x=>x>0);return vals.length?{min:Math.min(...vals),max:Math.max(...vals)}:{min:null,max:null};});
  const useInd=!!VAL[tk].industry;
  const body=rows.map(e=>{
    const self=e.tk===tk;
    const cells=cols.map(([,f],i)=>{
      const x=f(e); if(!(x>0))return'<td class="val-na">—</td>';
      const cls=self&&ext[i].min!=null?(x===ext[i].min?'pf3-up':x===ext[i].max?'pf3-down':''):'';
      return`<td class="${cls}">${valFmt(x)}</td>`;
    }).join('');
    return`<tr class="${self?'val-peer-self':''}" onclick="insiderOpenCard('${e.tk}')">
      <td class="val-l">${self?'▸ ':''}${e.tk}</td>${cells}</tr>`;
  }).join('');
  return`<details class="val-peers"><summary class="ins-summary">👥 ${RT('Сравнение с пирами','Peer comparison')} · ${useInd?RT('по индустрии','by industry'):RT('по сектору','by sector')} (${group.length})<span class="ins-chevron">▾</span></summary>
    <table class="val-tbl val-peer-tbl"><thead><tr><th class="val-l">${RT('Пир','Peer')}</th>${cols.map(c=>`<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
    <div class="pf3-ai-note">${RT('Группа из бумаг портфеля. У текущей бумаги (▸) зелёным/красным помечена самая дешёвая/дорогая ячейка. P/E — по тумблеру Fwd/TTM.','Group from portfolio holdings. For the current stock (▸), green/red marks its cheapest/richest cell. P/E follows the Fwd/TTM toggle.')}</div>
  </details>`;
}
// Раскрываемое «почему такая оценка» — детерминированное объяснение из чисел.
function valWhyLines(v,c,eps){
  const out=[];
  (c.dims||[]).forEach(d=>{
    if(!(d.cur>0)||d.secPct==null)return;
    const w=Math.abs(d.secPct).toFixed(0);
    if(d.secPct<=-10)out.push(RT(`${d.label} на ${w}% ниже медианы сектора`,`${d.label} is ${w}% below sector median`));
    else if(d.secPct>=10)out.push(RT(`${d.label} на ${w}% выше сектора`,`${d.label} is ${w}% above sector`));
  });
  if(eps==='up')out.push(RT('forward EPS растёт → дешевизна выглядит обоснованной','forward EPS rising → the discount looks justified'));
  else if(eps==='down')out.push(RT('forward EPS снижается → риск «ловушки стоимости»','forward EPS falling → value-trap risk'));
  if(v.peg>0&&v.peg<1)out.push(RT(`PEG ${valFmt(v.peg)} < 1 → рост недооценён рынком`,`PEG ${valFmt(v.peg)} < 1 → growth underpriced`));
  return out;
}
// 🎯 A.1 Панель агрегированных аналитических таргетов в карточке.
function targetsBlockHTML(d,r){
  const tk=String(r[2]||'').toUpperCase(), ccy=r[8]||'USD', price=parseFloat(r[7])||0;
  const t=TG_FULL[tk];
  if(!t||(t.consensus==null&&!(t.changes&&t.changes.length)))return '';
  const stale=t.lastDate?((Date.now()-Date.parse(t.lastDate))/864e5>30):false;
  const upPct=(t.consensus>0&&price>0)?((t.consensus/price-1)*100):null;
  const rt=t.ratings, segs=[['strongBuy','#16a34a','Strong Buy'],['buy','#4ade80','Buy'],['hold','#9ca3af','Hold'],['sell','#f87171','Sell'],['strongSell','#dc2626','Strong Sell']];
  let ratingBar='';
  if(rt){const tot=segs.reduce((s,[k])=>s+(rt[k]||0),0);
    if(tot)ratingBar=`<div class="tgf-bar">${segs.map(([k,c])=>{const n=rt[k]||0;return n?`<span style="width:${n/tot*100}%;background:${c}" title="${k}: ${n}"></span>`:'';}).join('')}</div><div class="tgf-bar-l">${segs.filter(([k])=>rt[k]).map(([k,,l])=>`${l} ${rt[k]}`).join(' · ')}${rt.consensus?` · <b>${rt.consensus}</b>`:''}</div>`;}
  const changes=(t.changes&&t.changes.length)?`<details class="tgf-ch"><summary>📝 ${RT('Изменения таргетов (30д)','Target changes (30d)')} · ${t.changes.length}</summary>${t.changes.map(c=>`<div class="tgf-ch-row"><span class="tgf-firm">${String(c.firm||'—').replace(/</g,'&lt;')}</span><span class="tgf-chv">${c.from!=null?pf3Fmt(c.from,0)+' → ':''}<b>${pf3Fmt(c.to,0)}</b> ${ccy}</span><span class="tgf-date">${c.date||''}</span></div>`).join('')}</details>`:'';
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>🎯 ${RT('Аналитические таргеты','Analyst targets')} ${infoBtn('targets')}</span><span class="pf3-asof">${t.src?`<span class="tg-src">${t.src==='yahoo'?'Yahoo':'FMP'}</span> `:''}${t.count?`${t.count} ${RT('аналит.','an.')}`:''}${t.lastDate?` · ${RT('посл.','last')} ${t.lastDate}`:(t.src==='yahoo'?` · ${RT('живой','live')}`:'')}${stale?` <span class="tg-stale">⚠️ ${RT('устар.','stale')}</span>`:''}</span></div>
    <div class="tgf-top">
      <div><span class="label">${RT('Консенсус','Consensus')}</span> <b>${t.consensus!=null?pf3Fmt(t.consensus,0)+' '+ccy:'—'}</b>${upPct!=null?` <span class="${upPct>=0?'pf3-up':'pf3-down'}">${upPct>=0?'+':''}${upPct.toFixed(1)}%</span>`:''}</div>
      <div><span class="label">${RT('Диапазон','Range')}</span> <b>${t.low!=null&&t.high!=null?pf3Fmt(t.low,0)+'–'+pf3Fmt(t.high,0)+' '+ccy:'—'}</b></div>
    </div>
    ${ratingBar}
    ${changes}
    <div class="pf3-ai-note">${RT('Консенсус — свежий срез (квартал/месяц); диапазон и изменения — по последним таргетам аналитиков (FMP). Свежесть >30 дн помечается «устар.». Справочно.','Consensus is the fresh slice; range and changes from latest analyst targets (FMP). Older than 30d is flagged «stale». Reference only.')}</div>
  </section>`;
}
// Панель Valuation Check в карточке акции.
function valHTML(d,r){
  const tk=String(r[2]||'').trim().toUpperCase();
  const v=VAL[tk];
  const hd=`<div class="pf3-panel-hd"><span>📐 ${RT('Оценка — мультипликаторы','Valuation — multiples')} ${infoBtn('valuation')}</span><span class="pf3-asof">${v&&v.at?RT('обновлено','updated')+' '+pf3DtRu(v.at):''}</span></div>`;
  if(!v||!(v.pe||v.fwdPe||v.ps||v.evEbitda))
    return`<section class="pf3-panel">${hd}<div class="pf3-empty">${v?RT('Нет данных по мультипликаторам для этой бумаги.','No multiples data for this stock.'):RT('Нажмите «📐 Оценка» на 🏠 Home — соберём мультипликаторы по всему портфелю.','Press «📐 Valuation» on 🏠 Home to pull multiples across the portfolio.')}</div></section>`;
  const secMed=(_valSecCache||valSectorMedians())[v.sector]||null;
  const c=valCmp(v,secMed,valPeMode);
  const eps=valEpsTrend(v.pe,v.fwdPe);   // EPS-тренд по forward vs trailing
  const epsLbl={down:'EPS ↓',up:'EPS ↑',flat:'EPS ='};
  const peToggle=(v.pe>0&&v.fwdPe>0)?`<span class="val-toggle">${[['fwd','Fwd'],['ttm','TTM']].map(([m,l])=>`<button class="val-tg-b${valPeMode===m?' on':''}" onclick="valSetPeMode('${m}')">${l}</button>`).join('')}</span>`:'';
  const rowsHTML=c.dims.map(dm=>{
    if(!(dm.cur>0))return'';
    const isPe=dm.k==='pe';
    return`<tr>
      <td class="val-l">${dm.label}${isPe&&eps?` <span class="val-eps val-eps-${eps}" title="${RT('EPS-тренд: forward vs trailing P/E','EPS trend: forward vs trailing P/E')}">${epsLbl[eps]}</span>`:''}</td>
      <td class="val-cur">${valFmt(dm.cur)}${isPe&&peToggle?' '+peToggle:''}</td>
      <td class="val-scale-td">${valScaleBar(dm.cur,dm.sec,dm.hist)}</td>
      <td>${dm.sec>0?valChip(dm.secPct):'<span class="val-na">—</span>'}</td>
      <td>${dm.hist>0?valChip(dm.histPct):'<span class="val-na">—</span>'}</td>
    </tr>`;
  }).join('');
  const extra=[];
  if(v.peg)extra.push(`PEG <b>${valFmt(v.peg)}</b>${v.peg<1?' · <span class="pf3-up">'+RT('рост недооценён','growth underpriced')+'</span>':''}`);
  // value-trap: дёшево к сектору, но прогноз EPS снижается (forward дороже TTM).
  const cheapDim=c.dims.find(dm=>dm.belowSec);
  const trap=(cheapDim&&eps==='down')?`<div class="val-trap">⚠️ ${RT(`Возможная «ловушка стоимости»: ${cheapDim.label} ниже сектора, но прогноз EPS снижается (forward P/E ${valFmt(v.fwdPe)} > TTM ${valFmt(v.pe)}). Дешевизна может быть оправданной — типично для пика цикла.`,`Possible value trap: ${cheapDim.label} is below sector, but EPS estimates are falling (forward P/E ${valFmt(v.fwdPe)} > TTM ${valFmt(v.pe)}). The discount may be justified — typical at a cycle peak.`)}</div>`:'';
  const both=c.bothCount>=2?`<div class="val-both">🟢 ${RT('Дёшево по обоим измерениям','Cheap on both dimensions')} · ${c.bothCount}/3 ${RT('мультипл.','multiples')}${eps==='up'?` · <span class="pf3-up">${epsLbl.up}</span>`:''}</div>`:'';
  const caveat=both&&!trap?`<div class="val-caveat">⚠️ ${RT('Низкие мультипликаторы часто бывают на пике цикла (прибыль временно завышена). Это статистическое наблюдение, не сигнал к покупке.','Low multiples often occur at the cycle peak (temporarily inflated earnings). A statistical observation, not a buy signal.')}</div>`:'';
  return`<section class="pf3-panel">${hd}
    ${v.sector?`<div class="val-sec">${RT('Сектор','Sector')}: <b>${v.sector}</b>${secMed&&secMed.n?` · ${RT('медиана по','median of')} ${secMed.n} ${RT('бум.','co.')}`:''}</div>`:''}
    ${both}
    <table class="val-tbl val-tbl2"><thead><tr><th></th><th>${RT('тек.','now')}</th><th class="val-scale-h">${RT('дёшево','cheap')} ◂ ${RT('медиана','median')} ▸ ${RT('дорого','rich')}</th><th>${RT('сектор','sector')}</th><th>5y</th></tr></thead><tbody>${rowsHTML}</tbody></table>
    ${extra.length?`<div class="val-extra">${extra.map(e=>`<span>${e}</span>`).join('')}</div>`:''}
    ${trap}
    ${caveat}
    ${(()=>{const lines=valWhyLines(v,c,eps);return lines.length?`<details class="val-why"><summary class="ins-summary">💡 ${RT('Почему такая оценка','Why this valuation')}<span class="ins-chevron">▾</span></summary><ul class="val-why-list">${lines.map(l=>`<li>${l}</li>`).join('')}</ul></details>`:'';})()}
    ${valPeerTableHTML(tk)}
    <div class="pf3-ai-note">${RT('Шкала: центр = медиана сектора, засечка — 5y история бумаги, точка — текущее значение. Yahoo (живые) + FMP (история). n/a при EPS≤0 (P/E), EBITDA<0 (EV/EBITDA), росте≤0 (PEG).','Scale: center = sector median, tick = stock 5y history, dot = current. Yahoo (live) + FMP (history). n/a when EPS≤0 (P/E), EBITDA<0 (EV/EBITDA), growth≤0 (PEG).')}</div>
  </section>`;
}

// 📐 Сводка недооценки на Home — результат кнопки «Оценка».
// 🧭 Составной «сигнальный балл»: инсайдеры × оценка (раздел 3.1). Агрегатор для
// быстрого сканирования, НЕ рекомендация. Чистая функция — покрыта тестом.
function signalScore(ins, val, secMed){
  let n=0; const items=[];
  if(ins){
    if(ins.cluster){n+=2;items.push({d:1,t:RT('кластер покупок инсайдеров','insider cluster buy')});}
    else if(ins.netUSD>0){n+=1;items.push({d:1,t:RT('нетто-покупка инсайдеров','net insider buying')});}
    else if(ins.netUSD<0){n-=1;items.push({d:-1,t:RT('нетто-продажа инсайдеров','net insider selling')});}
  }
  if(val&&(val.pe||val.fwdPe||val.ps||val.evEbitda)){
    const c=valCmp(val,secMed,'fwd');
    const eps=valEpsTrend(val.pe,val.fwdPe);
    if(c&&c.bothCount>=2){
      if(eps==='down'){n-=1;items.push({d:-1,t:RT('дёшево, но EPS падает (ловушка?)','cheap but EPS falling (trap?)')});}
      else{n+=2;items.push({d:1,t:RT('недооценка по сектору и истории','undervalued vs sector & history')});}
    }else if(c){
      const cheapSec=c.dims.some(dm=>dm.belowSec);
      const richSec=c.dims.some(dm=>dm.secPct!=null&&dm.secPct>=10);
      if(cheapSec&&eps!=='down'){n+=1;items.push({d:1,t:RT('дешевле сектора','cheaper than sector')});}
      else if(richSec){n-=1;items.push({d:-1,t:RT('дороже сектора','richer than sector')});}
    }
  }
  return {n,items};
}
function signalLevel(n){return n>=3?{i:'🟢',c:'sig-strong'}:n>=1?{i:'🟢',c:'sig-pos'}:n<=-1?{i:'🔴',c:'sig-neg'}:{i:'⚪',c:'sig-neu'};}
function signalBadgeHTML(tk){
  const sm=(_valSecCache||valSectorMedians());
  const s=signalScore(INSIDER[tk], VAL[tk], sm[(VAL[tk]||{}).sector]);
  if(!s.items.length)return '';
  const lvl=signalLevel(s.n);
  const tip=s.items.map(it=>(it.d>0?'+ ':'− ')+it.t).join(' · ')+' · '+RT('справочный сигнал, не рекомендация','reference signal, not advice');
  return`<span class="sig-badge ${lvl.c}" title="${tip}">🧭 ${RT('Сигнал','Signal')} ${lvl.i} ${s.n>0?'+':''}${s.n}</span>`;
}
// Контекст-строки для скрещивания в Telegram-алертах (3.2): к инсайдерскому
// алерту добавляем оценку, к алерту оценки — инсайдеров. Клиент знает оба модуля.
function valContextLine(tk){
  const v=VAL[tk]; if(!v||!(v.pe||v.fwdPe||v.ps||v.evEbitda))return '';
  const c=valCmp(v,(_valSecCache||valSectorMedians())[v.sector],'fwd'); if(!c)return '';
  const cheap=c.dims.filter(d=>d.belowSec&&d.secPct!=null).map(d=>`${d.label} ${Math.round(d.secPct)}% к сектору`);
  if(!cheap.length)return '';
  const eps=valEpsTrend(v.pe,v.fwdPe);
  return `📐 ${cheap.join(', ')}${eps==='up'?' · EPS↑':eps==='down'?' · ⚠ EPS↓':''}`;
}
function insiderContextLine(tk){
  const v=INSIDER[tk]; if(!v)return '';
  if(v.cluster)return `🕵 кластер: ${v.cluster.uniqueBuyers} инсайд. купили${v.cluster.sumUSD?' ≈ '+insiderFmtUSD(v.cluster.sumUSD,v.valCcy):''}`;
  if(v.netUSD>0)return `🕵 нетто-покупка инсайдеров +${insiderFmtUSD(v.netUSD,v.valCcy)}`;
  return '';
}
// Home: «инсайдерская покупка × недооценка» (раздел 4) — ключевое отличие: связка
// двух модулей, разнесённых по вкладкам в готовых платформах.
function homeSignalHTML(){
  if(!Object.keys(INSIDER||{}).length&&!Object.keys(VAL||{}).length)return '';
  const sm=(_valSecCache||valSectorMedians());
  const tks=[...new Set([...Object.keys(INSIDER||{}),...Object.keys(VAL||{})])];
  const scored=tks.map(tk=>{
    const s=signalScore(INSIDER[tk],VAL[tk],sm[(VAL[tk]||{}).sector]);
    const insBuy=INSIDER[tk]&&(INSIDER[tk].cluster||INSIDER[tk].netUSD>0);
    const valCheap=s.items.some(it=>it.d>0&&/недооцен|дешевле|undervalued|cheaper/.test(it.t));
    return {tk,s,both:insBuy&&valCheap,name:(VAL[tk]||INSIDER[tk]||{}).name||tk,ccy:(VAL[tk]||INSIDER[tk]||{}).ccy};
  }).filter(x=>x.both).sort((a,b)=>b.s.n-a.s.n);
  const body=scored.length?scored.slice(0,12).map(x=>`<div class="home-row" onclick="insiderOpenCard('${x.tk}')">
    ${logoHTML(x.tk,x.ccy,'pf3-row-logo')}
    <div class="pf3-row-name"><b>${x.name}</b><span>${x.tk}</span></div>
    <div style="flex:1">${x.s.items.map(it=>`<span class="sig-tag ${it.d>0?'up':'down'}">${it.d>0?'+':'−'} ${it.t}</span>`).join(' ')}</div>
    <span class="sig-badge ${signalLevel(x.s.n).c}">${signalLevel(x.s.n).i} ${x.s.n>0?'+':''}${x.s.n}</span></div>`).join('')
    :`<div class="pf3-empty">${RT('Пока нет бумаг, где инсайдерская покупка совпадает с недооценкой. Соберите «🕵 AI Insider» и «📐 Оценку» на Home.','No stocks yet where insider buying meets undervaluation. Run «🕵 AI Insider» and «📐 Valuation» on Home.')}</div>`;
  return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>🧭 ${RT('Инсайдеры × Недооценка','Insiders × Undervaluation')} ${infoBtn('signal')}</span><span class="pf3-asof">${RT('связка сигналов — справочно','signal crossover — reference')}</span></div>${body}</section>`;
}
function homeValHTML(){
  const ents=Object.keys(VAL||{}).map(tk=>({tk,...VAL[tk]}));
  const withData=ents.filter(e=>e.pe||e.fwdPe||e.ps||e.evEbitda);
  const anyAt=ents.map(e=>e.at).filter(Boolean).sort().pop();
  if(!ents.length)return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>📐 ${RT('Оценка','Valuation')}</span></div>
    <div class="pf3-empty">${RT('Нажмите «📐 Оценка», чтобы собрать мультипликаторы по портфелю и сравнить с медианой сектора и историей.','Press «📐 Valuation» to pull multiples across the portfolio and compare with sector median and history.')}</div></section>`;
  const sec=_valSecCache||valSectorMedians();
  const scored=withData.map(e=>({e,c:valCmp(e,sec[e.sector])})).filter(x=>x.c).sort((a,b)=>b.c.bothCount-a.c.bothCount);
  const cheap=scored.filter(x=>x.c.bothCount>=2);
  const row=x=>{const e=x.e;return`<div class="home-row" onclick="insiderOpenCard('${e.tk}')">
    ${logoHTML(e.tk,e.ccy,'pf3-row-logo')}
    <div class="pf3-row-name"><b>${e.name||e.tk}</b><span>${e.tk}${e.sector?' · '+e.sector:''}</span></div>
    <div style="flex:1"><span class="val-both-tag">🟢 ${RT('дёшево','cheap')} · ${x.c.bothCount}/3</span> ${x.c.dims.filter(d=>d.belowSec&&d.belowHist).map(d=>`<span class="pf3-asof">${d.label}</span>`).join(' ')}</div></div>`};
  const sub=`${withData.length}/${ents.length} ${RT('с данными','with data')}${anyAt?' · '+RT('обновлено','updated')+' '+pf3DtRu(anyAt):''}`;
  const body=cheap.length
    ? `<div class="home-ins-sec"><div class="home-ins-h">🟢 ${RT('Дёшево по сектору и истории','Cheap vs sector & history')}</div>${cheap.slice(0,12).map(row).join('')}</div>`
    : `<div class="pf3-empty">${RT('Сильной недооценки не найдено. Откройте карточку акции — там полная разбивка по мультипликаторам.','No strong undervaluation found. Open a stock card for the full multiples breakdown.')}</div>`;
  return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>📐 ${RT('Недооценка по мультипликаторам','Undervaluation by multiples')} ${infoBtn('valuation')}</span><span class="pf3-asof">${sub}</span></div>${body}</section>`;
}

// 🕵 Сводка инсайдерской активности на Home — результат кнопки «AI Insider».
function homeInsiderHTML(){
  const ents=Object.keys(INSIDER||{}).map(tk=>({tk,...INSIDER[tk]}));
  const withData=ents.filter(e=>e.txCount>0);
  const anyAt=ents.map(e=>e.at).filter(Boolean).sort().pop();
  if(!ents.length)return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>🕵 ${RT('Инсайдеры','Insiders')}</span></div>
    <div class="pf3-empty">${RT('Нажмите «🕵 AI Insider», чтобы собрать инсайдерские сделки по портфелю. US — Finnhub, шведские (SEK) — Finansinspektionen.','Press «🕵 AI Insider» to pull insider trades across the portfolio. US via Finnhub, Swedish (SEK) via Finansinspektionen.')}</div></section>`;
  const clusters=withData.filter(e=>e.cluster).sort((a,b)=>b.cluster.uniqueBuyers-a.cluster.uniqueBuyers);
  const netBuy=withData.filter(e=>!e.cluster&&e.netUSD>0).sort((a,b)=>b.netUSD-a.netUSD);
  const row=(e,extra)=>`<div class="home-row" onclick="insiderOpenCard('${e.tk}')">
    ${logoHTML(e.tk,e.ccy,'pf3-row-logo')}
    <div class="pf3-row-name"><b>${e.name||e.tk}</b><span>${e.tk}</span></div>
    <div style="flex:1">${extra}</div></div>`;
  const clHtml=clusters.length?clusters.map(e=>row(e,`<span class="ins-cluster">🟢 CLUSTER BUY · ${e.cluster.uniqueBuyers} ${RT('инсайд.','insiders')}${e.cluster.sumUSD?' · '+insiderFmtUSD(e.cluster.sumUSD,e.valCcy):''}</span>`)).join(''):'';
  const nbHtml=netBuy.length?netBuy.slice(0,12).map(e=>row(e,`<span class="pf3-up" style="font-weight:700">+${insiderFmtUSD(e.netUSD,e.valCcy)}</span> <span class="pf3-asof">${RT('нетто-покупка','net buy')}</span>`)).join(''):'';
  const sub=`${withData.length}/${ents.length} ${RT('с данными','with data')}${anyAt?' · '+RT('обновлено','updated')+' '+pf3DtRu(anyAt):''}`;
  let body='';
  if(clHtml)body+=`<div class="home-ins-sec"><div class="home-ins-h">🟢 ${RT('Кластерные покупки','Cluster buys')}</div>${clHtml}</div>`;
  if(nbHtml)body+=`<div class="home-ins-sec"><div class="home-ins-h">📈 ${RT('Нетто-покупки инсайдеров','Net insider buying')}</div>${nbHtml}</div>`;
  if(!body)body=`<div class="pf3-empty">${RT('Инсайдерских покупок не найдено. Откройте карточку акции — там полная сводка по каждой бумаге.','No insider buying found. Open a stock card for the full per-stock breakdown.')}</div>`;
  return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>🕵 ${RT('Инсайдерская активность','Insider activity')} ${infoBtn('insider')}</span><span class="pf3-asof">${sub}</span></div>${body}</section>`;
}
function insiderHomeTab(tk){
  const U=String(tk).toUpperCase();
  for(const k of v3Tabs()){const dd=DATA[k];if(dd&&(dd.rows||[]).some(r=>String(r[2]||'').trim().toUpperCase()===U))return k}
  return null;
}
function insiderOpenCard(tk){
  const home=insiderHomeTab(tk);
  if(!home){toast(RT('Бумага не найдена во вкладках','Stock not found in tabs'),true);return}
  curIdx=home;v3Key=home;pf3Sel=tk;pf3Tab='list';renderAll();
}
// Портфели, для которых строится отдельный дашборд (мой + Anna + любые семейные).
function dashPortTabs(){return v3Tabs().filter(k=>pf3MyPort(k))}
// ── 📊 AI-Dashboard: AI Proto формирует ОТДЕЛЬНЫЙ дашборд по каждому портфелю ──
async function aiDashRun(onlyKey){
  if(_aiDashBusy)return;_aiDashBusy=true;_aiDashProg='';
  // onlyKey задан → генерим отчёт ТОЛЬКО для этого портфеля (кнопка на его саб-вкладке);
  // без него — по всем портфелям подряд (кнопка «📚 Все»).
  const all=dashPortTabs();
  const tabs=(onlyKey&&all.includes(onlyKey))?[onlyKey]:all;
  if(onlyKey)_aiDashSub=onlyKey;   // показать спиннер на нужной саб-вкладке
  renderAll();
  let ok=0;
  try{
    for(let i=0;i<tabs.length;i++){
      const k=tabs[i];
      _aiDashProg=`${i+1}/${tabs.length} · ${TAB_LABEL(k)}`;
      const btn=document.getElementById('aiDashBtn');if(btn){btn.disabled=true;btn.textContent='⏳ '+RT('Генерирую','Generating')+' '+_aiDashProg+'…';}
      await pf3LoadAllFundamentals(k).catch(()=>{});   // 🏅 фундаментал всех позиций → betyg как в карточке
      const snap=pf3AiSnapshot(k);   // портфель k + investorRules + marketContext
      snap.portfolioName=TAB_LABEL(k);
      snap.recoLegend='{ТИКЕР:[recoVerdict(buy|wait|sell|avoid), upside%toTarget, %отSMA50, %отSMA200, P/E, вЭтомПортфеле(1|0)]} — детерминированный скоринг сайта (та же логика, что вердикт «Рекомендация» в карточке)';
      snap.recoVerdicts=dashRecoMap(k);   // согласование picks с вердиктом сайта (вариант B)
      if(AI_BG_ENABLED&&await aiJobsReady()){ snap.jobId=aiJobId();snap.portfolioKey=k; }   // фон только при включённом флаге
      try{
        const r=await fetch(PRICE_PROXY+'?action=dashboard',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},body:JSON.stringify(snap)});
        const bodyText=await r.text();let j=null;try{j=JSON.parse(bodyText)}catch(_){}
        if(j&&j.queued){const res=await aiJobPoll(j.jobId);if(res.ok&&res.result)j=res.result;else{toast(TAB_LABEL(k)+': '+(res.error||'нет результата'),true);continue;}}
        if(j&&j.dash&&Array.isArray(j.dash.cards)){
          aiSpendAdd(j.cost);
          AI_DASH[k]={headline:j.dash.headline||'',cards:j.dash.cards,picks:Array.isArray(j.dash.picks)?j.dash.picks:[],asOf:j.dash.asOf||null,at:new Date().toISOString(),cost:j.cost||null};
          ok++;scheduleSave();if(!_aiDashSub)_aiDashSub=k;renderAll();
        }else{const msg=(j&&j.error)||(bodyText?bodyText.slice(0,220):('HTTP '+r.status));console.warn('Dashboard failed:',k,r.status,bodyText);toast(TAB_LABEL(k)+': '+msg,true);}
      }catch(e){toast(TAB_LABEL(k)+': '+(e&&e.message||RT('сеть/worker недоступен','network/worker unreachable')),true);}
    }
    if(ok)toast('📊 '+RT('Готово дашбордов','Dashboards ready')+': '+ok+'/'+tabs.length);
  }finally{_aiDashBusy=false;_aiDashProg='';renderAll();}
}
// Описание вкладки 📊 AI-Dashboard (по клику на «!») — переиспользуем faq-оверлей.
function aiDashInfoHTML(){
  const li=s=>`<li>${s}</li>`;
  return`<button class="faq-close" onclick="toggleFaq()">✕</button>
  <h2>📊 AI-Dashboard</h2>
  <div class="faq-body">
  <p>${RT('Кнопка <b>«✨ Сгенерировать»</b> запускает <b>AI Proto</b> — главную аналитическую модель. Имея самый свежий снапшот портфеля, ваши правила (<b>🧠 память</b>) и веб-поиск свежих новостей и макрокартины, она формирует набор карточек с самой полезной информацией для портфеля прямо сейчас.','The <b>«✨ Generate»</b> button runs <b>AI Proto</b> — the main analytical model. With the freshest portfolio snapshot, your saved rules (<b>🧠 memory</b>) and a web search of fresh news and macro, it builds a set of cards with the most useful information for the portfolio right now.')}</p>
  <p><b>${RT('Что попадает в дашборд','What the dashboard covers')}:</b></p>
  <ul class="dash-bul">
  ${li(RT('общее состояние портфеля и где он относительно эталонных индексов (OMXS30, Nasdaq 100, S&amp;P 500)','overall portfolio state and where it stands vs benchmark indices (OMXS30, Nasdaq 100, S&amp;P 500)'))}
  ${li(RT('что важно сегодня и на этой неделе — события, отчёты, свежие новости','what matters today and this week — events, earnings, fresh news'))}
  ${li(RT('возможности: что докупить и какие новые идеи (с уровнями входа и долями в kr)','opportunities: what to add and new ideas (with entry levels and sizing in kr)'))}
  ${li(RT('риски: что сократить или продать и почему','risks: what to trim or sell and why'))}
  ${li(RT('макро и рынок — как это влияет на портфель','macro and market — how it affects the portfolio'))}
  ${li(RT('диверсификация: перевес или недовес секторов и гео','diversification: sector / geo over- and under-weights'))}
  ${li(RT('конкретный план действий на ближайшие 1–2 недели с суммами в kr','a concrete action plan for the next 1–2 weeks with amounts in kr'))}
  </ul>
  <p class="pf3-asof">${RT('Прогон с веб-поиском занимает до 1–2 минут и тарифицируется по токенам (стоимость показывается рядом и идёт в общий AI-расход). Это справочная аналитика, а не индивидуальная инвестиционная рекомендация.','A run with web search takes up to 1–2 minutes and is billed by tokens (cost is shown next to it and added to total AI spend). This is reference analytics, not individual investment advice.')}</p>
  </div>`;
}
function aiDashInfo(){
  const o=document.getElementById('faqOverlay');if(!o)return;
  document.getElementById('faqCard').innerHTML=aiDashInfoHTML();
  o.classList.remove('hidden');
}
// Безопасный инлайн-markdown для вывода модели: коэрсит к строке, экранирует
// HTML, чистит префиксы списка, рендерит ссылки/код/**жирный**/*курсив*/переносы.
function dashMd(s){
  if(s==null)return'';
  if(typeof s==='object')s=s.text||s.title||s.label||s.name||s.value||JSON.stringify(s);
  s=String(s).replace(/^\s*(?:[-*•·▪–]\s+|\d+[.)]\s+)/,'');                 // убрать маркер списка
  s=s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');       // экранирование
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  s=s.replace(/`([^`]+)`/g,'<code>$1</code>');
  s=s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  s=s.replace(/(^|[\s(])\*([^*\n]+)\*/g,'$1<i>$2</i>');
  s=s.replace(/(^|[\s(])_([^_\n]+)_/g,'$1<i>$2</i>');
  s=s.replace(/\n+/g,'<br>');
  return s.trim();
}
const dashTk=t=>String(t||'').toUpperCase().replace(/[^A-Z0-9.\-]/g,'');
// 🏆 Рекомендации AI Proto по горизонтам (продвинутый уровень: новости+макро+
// фундаментал+техника) — три таблицы, как на Home, но отбор делает ассистент.
function aiDashPicksHTML(picks){
  if(!Array.isArray(picks)||!picks.length)return'';
  const num=v=>{const n=parseFloat(v);return isFinite(n)?n:null};
  const actC=a=>{a=String(a||'').toLowerCase();if(/куп|докуп|добав|buy|add/.test(a))return'dash-good';if(/сокр|прод|sell|trim|reduc|avoid|изб/.test(a))return'dash-bad';return'dash-info'};
  const tbl=(key,title,sub)=>{
    const arr=picks.filter(p=>String(p.horizon||'').toLowerCase()===key).slice(0,10);
    const body=arr.length?`<table class="bp-tbl"><thead><tr><th>#</th><th>${RT('Акция','Stock')}</th><th>${RT('Действие','Action')}</th><th>${RT('Вход','Entry')}</th><th>${RT('Таргет','Target')}</th><th>${RT('Потенц.','Upside')}</th><th>${RT('Почему','Why')}</th></tr></thead><tbody>${arr.map((p,i)=>{const up=num(p.upside),tk=dashTk(p.ticker);return`<tr${tk?` onclick="insiderOpenCard('${tk}')"`:''}><td class="bp-n">${i+1}</td><td class="bp-name"><b>${dashMd(p.name||p.ticker||'')}</b>${tk?` <span class="bp-tk">${tk}</span>`:''}</td><td><span class="dash-act ${actC(p.action)}">${dashMd(p.action||'—')}</span></td><td>${dashMd(p.entry||'—')}</td><td>${dashMd(p.target||'—')}</td><td>${up!=null?(up>=0?'+':'')+up.toFixed(0)+'%':'—'}</td><td class="bp-why">${dashMd(p.why||'')}</td></tr>`}).join('')}</tbody></table>`:`<div class="pf3-empty">${RT('Нет идей на этот горизонт','No ideas for this horizon')}</div>`;
    return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>${title}</span><span class="pf3-asof">${sub}</span></div>${body}</section>`;
  };
  return`<div class="dash-sect">🏆 ${RT('Лучшие рекомендации AI Proto','AI Proto top recommendations')}</div>`
    +tbl('short','🥇 '+RT('1–3 мес','1–3 months'),RT('импульс и краткосрочные катализаторы','momentum & near-term catalysts'))
    +tbl('mid','🥈 '+RT('3–6 мес','3–6 months'),RT('тренд, оценка, отчёты','trend, valuation, earnings'))
    +tbl('long','🥉 '+RT('6–12 мес','6–12 months'),RT('фундаментал и недооценка','fundamentals & value'));
}
function aiDashHTML(){
  const tabs=dashPortTabs();
  if(!_aiDashSub||!tabs.includes(_aiDashSub))_aiDashSub=tabs[0]||PF3_KEY;
  const sub=_aiDashSub,D=AI_DASH[sub];
  const toneC={good:'dash-good',warn:'dash-warn',bad:'dash-bad',info:'dash-info'};
  const cardBullets=c=>{const b=Array.isArray(c.bullets)?c.bullets:(c.bullets!=null?[c.bullets]:(c.text!=null?[c.text]:[]));return b.map(x=>dashMd(x)).filter(Boolean)};
  const subName=dashMd(TAB_LABEL(sub)),doneCur=!!(D&&D.cards);
  // Главная кнопка — генерация ТЕКУЩЕГО портфеля (отдельно для каждого);
  // вторая «📚 Все» — прогнать все портфели подряд.
  const btn=`<button class="pf3-btn" id="aiDashBtn" onclick="aiDashRun(_aiDashSub)"${_aiDashBusy?' disabled':''}>${_aiDashBusy?'⏳ '+RT('Генерирую','Generating')+(_aiDashProg?' '+_aiDashProg:'')+'…':(doneCur?'🔄 '+RT('Обновить','Refresh'):'✨ '+RT('Сгенерировать','Generate'))+' · '+subName}</button>`;
  const btnAll=(tabs.length>1&&!_aiDashBusy)?`<button class="pf3-btn pf3-btn-sm" id="aiDashBtnAll" onclick="aiDashRun()" title="${RT('Сгенерировать отчёты по всем портфелям подряд','Generate reports for all portfolios in sequence')}">📚 ${RT('Все','All')} (${tabs.length})</button>`:'';
  // Шапка + саб-вкладки по портфелям.
  const subTabs=tabs.map(k=>{const dd=AI_DASH[k];const dot=dd&&dd.cards?'●':'○';return`<button class="dash-tab${k===sub?' active':''}" onclick="_aiDashSub=${JSON.stringify(k).replace(/"/g,'&quot;')};renderAll()">${dot} ${dashMd(TAB_LABEL(k))}</button>`}).join('');
  let h=`<section class="pf3-panel"><div class="pf3-panel-hd"><span>📊 AI-Dashboard <span class="dash-info-btn" onclick="event.stopPropagation();aiDashInfo()" title="${RT('Что это?','What is this?')}">!</span></span><span class="pf3-asof">${D&&D.at?RT('обновлено','updated')+' '+pf3DtRu(D.at)+(D.cost?' · '+costLine(D.cost):''):RT('AI Proto · отдельный анализ по каждому портфелю','AI Proto · separate analysis per portfolio')}</span>${btn}${btnAll}</div>${tabs.length>1?`<div class="dash-subtabs">${subTabs}</div>`:''}${D&&D.headline?`<div class="dash-headline">${dashMd(D.headline)}</div>`:''}</section>`;
  if(_aiDashBusy&&(!D||!D.cards))h+=`<div class="pf3-empty" style="padding:24px">⏳ ${RT('AI Proto анализирует портфель','AI Proto is analysing the portfolio')} «${dashMd(TAB_LABEL(sub))}» ${RT('(web-поиск)… до 1–2 минут на портфель.','(web search)… up to 1–2 min per portfolio.')}</div>`;
  else if(D&&D.cards&&D.cards.length){
    const dcards=D.cards.map((c,ci)=>{const bl=cardBullets(c);const id=(String(c.title||'').toLowerCase().replace(/[^a-zа-я0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,40))||('c'+ci);return{id,html:`<section class="dash-card ${toneC[String(c.tone||'').toLowerCase()]||'dash-info'}" data-eid="${id}"><div class="dash-card-hd">${dashMd(c.icon||'•')} <b>${dashMd(c.title||'')}</b></div><ul class="dash-bul">${bl.map(b=>`<li>${b}</li>`).join('')||`<li class="pf3-asof">—</li>`}</ul></section>`}});
    h+=`<div class="dash-grid" data-edit-row="dash">${eapply('dash',dcards).map(c=>c.html).join('')}</div>`;
    h+=aiDashPicksHTML(D.picks);
  }
  else if(!_aiDashBusy)h+=`<div class="pf3-empty" style="padding:24px">${RT('Кнопка «✨ Сгенерировать · '+TAB_LABEL(sub)+'» строит дашборд ТОЛЬКО для выбранного портфеля (переключайте вкладками выше), а «📚 Все» — прогоняет все портфели подряд. AI Proto с веб-поиском свежих новостей/макро и вашими правилами (🧠 память) соберёт: состояние, что важно сегодня, возможности, риски, макро, диверсификация, план на неделю + лучшие рекомендации на 1–3 / 3–6 / 6–12 мес.','The «✨ Generate» button builds a dashboard for the SELECTED portfolio only (switch with the tabs above); «📚 All» runs every portfolio in sequence.')}</div>`;
  return h;
}

// Карта детерминированных вердиктов скоринга по всем тикерам дашборда —
// передаётся AI Proto, чтобы его picks были согласованы с вердиктом «Рекомендация»
// в карточке (вариант B). Компактно: ТИКЕР → [v, upside%, %отSMA50, %отSMA200, P/E, вПортфеле].
function dashRecoMap(portKey){
  const seen=new Set(),out={};
  const portTks=new Set(((DATA[portKey||PF3_KEY]&&DATA[portKey||PF3_KEY].rows)||[]).map(r=>String(r[2]||'').trim().toUpperCase()));
  v3Tabs().forEach(k=>{const d=DATA[k];if(!d||!Array.isArray(d.rows))return;
    const {s50,s200}=smaIdx(d),h=d.headers,peC=h.indexOf('P/E');
    d.rows.forEach((r,i)=>{const tk=String(r[2]||'').trim().toUpperCase();if(!tk||seen.has(tk))return;
      const price=parseFloat(r[7])||0;if(!(price>0))return;recalcPF(i,k);seen.add(tk);
      let v=null;try{v=pf3Reco(d,r).v}catch(e){}
      const num=c=>{const x=c>=0?parseFloat(r[c]):NaN;return isFinite(x)?x:null};
      const D=c=>{const x=num(c);return(x&&x>0)?Math.round((price/x-1)*1000)/10:null};
      const up=pf3EffUpside(d,r);
      out[tk]=[v,up!=null?Math.round(up):null,D(s50),D(s200),num(peC),portTks.has(tk)?1:0];
    });
  });
  return out;
}

// 🏆 Лучшие акции-кандидаты для портфеля по горизонтам — детерминированный отбор
// из ВСЕХ вкладок по обновлённым данным (цена, SMA, таргет, P/E, ROE, рост).
// 1–3 мес: импульс и точки входа · 3–6 мес: тренд+цена · 6–12 мес: фундаментал+недооценка.
function homeBestPicks(){
  const seen=new Set(),all=[];
  v3Tabs().forEach(k=>{const d=DATA[k];if(!d||!Array.isArray(d.rows))return;
    const h=d.headers,{s50,s100,s200}=smaIdx(d);
    const peC=h.indexOf('P/E'),roC=h.indexOf('ROE'),rgC=h.indexOf('Рост выручки'),psC=h.indexOf('P/S'),supC=h.indexOf('Поддержка'),resC=h.indexOf('Сопротивление');
    d.rows.forEach((r,i)=>{
      const tk=String(r[2]||'').trim().toUpperCase();if(!tk||seen.has(tk))return;
      const price=parseFloat(r[7])||0;if(!(price>0))return;
      recalcPF(i,k);seen.add(tk);
      const num=c=>{const v=c>=0?parseFloat(r[c]):NaN;return isFinite(v)?v:null};
      const D=c=>{const v=num(c);return(v&&v>0)?(price/v-1)*100:null};
      let knife=false;try{knife=pf3Criterion(d,r).rank===0}catch(e){}
      let reco=null;try{reco=pf3Reco(d,r).v}catch(e){}
      all.push({tk,name:r[1]||tk,ccy:r[8]||'',price,
        d50:D(s50),d100:D(s100),d200:D(s200),dSup:D(supC),dRes:D(resC),
        up:pf3EffUpside(d,r),pe:num(peC),roe:num(roC),revg:num(rgC),ps:num(psC),day:num(10),knife,reco});
    });
  });
  const near=x=>{const a=[x.d50,x.d100,x.dSup].filter(v=>v!=null).map(Math.abs);return a.length?Math.min(...a):null};
  const sShort=x=>{if(x.knife)return -99;let s=0;
    if(x.d50>0)s+=1.5;if(x.d200>0)s+=1.5;
    const n=near(x);if(n!=null){if(n<=3)s+=4;else if(n<=7)s+=2;}
    if(x.day!=null){if(x.day>0&&x.day<6)s+=1;else if(x.day>=6)s-=1;}
    if(x.d200!=null&&x.d200>=30)s-=2;
    if(x.up!=null&&x.up<=-5)s-=2;
    if(x.reco==='buy')s+=2;else if(x.reco==='sell'||x.reco==='avoid')s-=2;
    if(x.d200!=null&&x.d200<0)s-=1.5;return s;};
  const sMed=x=>{if(x.knife)return -99;let s=0;
    if(x.d200>0)s+=2;
    if(x.up!=null){if(x.up>=10&&x.up<=40)s+=3;else if(x.up>40)s+=1;else if(x.up<0)s-=2;}
    if(x.pe!=null&&x.pe>0){if(x.pe<=30)s+=1;else if(x.pe>=45)s-=1;}
    if(x.roe!=null&&x.roe>=12)s+=1;
    if(x.revg!=null&&x.revg>=8)s+=1;
    if(x.reco==='buy')s+=2;else if(x.reco==='avoid')s-=2;
    if(x.d200!=null&&x.d200>=30)s-=1;return s;};
  const sLong=x=>{let s=0;
    if(x.roe!=null){if(x.roe>=15)s+=2;else if(x.roe>=10)s+=1;else if(x.roe<0)s-=2;}
    if(x.revg!=null){if(x.revg>=15)s+=2;else if(x.revg>=8)s+=1;else if(x.revg<0)s-=1;}
    if(x.up!=null){if(x.up>=25)s+=3;else if(x.up>=10)s+=1;else if(x.up<=-10)s-=1;}
    if(x.pe!=null&&x.pe>0&&x.pe<=18)s+=1;
    if(x.ps!=null&&x.ps>0&&x.ps<=4)s+=0.5;
    if(x.reco==='avoid')s-=2;if(x.knife)s-=1.5;return s;};
  const top=fn=>all.map(x=>({...x,_s:fn(x)})).filter(x=>x._s>0).sort((a,b)=>b._s-a._s).slice(0,10);
  return{all,short:top(sShort),medium:top(sMed),long:top(sLong)};
}
function bpWhyShort(x){const a=[];const n=[x.d50,x.d100,x.dSup].filter(v=>v!=null).map(Math.abs);const nn=n.length?Math.min(...n):null;
  if(nn!=null&&nn<=7)a.push(RT('у уровня входа','near entry'));if(x.d50>0&&x.d200>0)a.push(RT('аптренд','uptrend'));
  if(x.day!=null&&x.day>0&&x.day<6)a.push(`+${x.day.toFixed(1)}%/${RT('день','d')}`);if(x.up!=null&&x.up>0)a.push(`+${x.up.toFixed(0)}% ${RT('к таргету','to target')}`);
  return a.slice(0,3).join(' · ')||RT('тех. сетап','technical setup');}
function bpWhyMed(x){const a=[];if(x.d200>0)a.push(RT('тренд вверх','trend up'));if(x.up!=null&&x.up>=10)a.push(`+${x.up.toFixed(0)}% ${RT('к таргету','to target')}`);
  if(x.roe!=null&&x.roe>=12)a.push(`ROE ${x.roe.toFixed(0)}%`);if(x.revg!=null&&x.revg>=8)a.push(`${RT('рост','growth')} ${x.revg.toFixed(0)}%`);
  return a.slice(0,3).join(' · ')||RT('баланс роста и цены','growth + value');}
function bpWhyLong(x){const a=[];if(x.roe!=null&&x.roe>=12)a.push(`ROE ${x.roe.toFixed(0)}%`);if(x.revg!=null&&x.revg>=8)a.push(`${RT('рост','growth')} ${x.revg.toFixed(0)}%`);
  if(x.up!=null&&x.up>=15)a.push(`+${x.up.toFixed(0)}% ${RT('к таргету','to target')}`);if(x.pe!=null&&x.pe>0&&x.pe<=18)a.push(`P/E ${x.pe.toFixed(0)}`);
  return a.slice(0,3).join(' · ')||RT('качество и оценка','quality + value');}
function homeBestHTML(){
  const P=homeBestPicks();
  const tbl=(title,sub,arr,why)=>`<section class="pf3-panel"><div class="pf3-panel-hd"><span>${title} ${infoBtn('horizons')}</span><span class="pf3-asof">${sub}</span></div>${arr.length?`<table class="bp-tbl"><thead><tr><th>#</th><th>${RT('Акция','Stock')}</th><th>${RT('Цена','Price')}</th><th>${RT('Почему','Why')}</th></tr></thead><tbody>${arr.map((x,i)=>`<tr onclick="insiderOpenCard('${x.tk}')"><td class="bp-n">${i+1}</td><td class="bp-name"><b>${x.name}</b> <span class="bp-tk">${x.tk}</span></td><td class="bp-px">${pf3Fmt(x.price,2)} <small>${x.ccy}</small></td><td class="bp-why">${why(x)}</td></tr>`).join('')}</tbody></table>`:`<div class="pf3-empty">${RT('Подходящих кандидатов нет — нажмите «🔄 Обновить всё».','No suitable candidates — press «🔄 Update all».')}</div>`}</section>`;
  return`
    ${tbl('🥇 '+RT('Лучшие на 1–3 мес','Best 1–3 months'),RT('импульс и точки входа','momentum & entry'),P.short,bpWhyShort)}
    ${tbl('🥈 '+RT('Лучшие на 3–6 мес','Best 3–6 months'),RT('тренд + разумная цена','trend + fair value'),P.medium,bpWhyMed)}
    ${tbl('🥉 '+RT('Лучшие на 6–12 мес','Best 6–12 months'),RT('фундаментал и недооценка','fundamentals & value'),P.long,bpWhyLong)}
    <div class="pf3-ai-note">${RT('Детерминированный отбор из всех вкладок по обновлённым данным. Справочно, не инвестиционная рекомендация.','Deterministic screen across all tabs from refreshed data. Reference only, not investment advice.')}</div>`;
}
// ── 🏆 Единый композитный рейтинг: ОДИН балл из ВСЕХ сигналов сразу ──
// Апсайд + тех-фаза + качество (ROE) + рост + оценка (P/E) + точка входа +
// рекомендация движка + инсайдеры + AI-вердикт. Детерминированно по живым данным.
const PHASE_PTS={knife:-3,down:-1,corr:0.3,flat:0,rev:1,undr:2,up:1.5,imp:0.5,heat:-1.5};
// Чистая функция балла: нормированные вклады всех сигналов → {score 0..100, raw, why}.
// Отсутствующие данные не штрафуют (вклад 0) — иначе EU/Nordic без VAL/AI проваливались бы.
function homeCompositeScore(x){
  let raw=0;const why=[];
  const {up,roe,revg,pe,entry,upTrend,phase,reco,sigN,insBuy,aiV,undervalued,newsSent}=x;
  // ⚠ Защита от ловушки устаревшего таргета: большой «апсайд» при даунтренде/падающем ноже
  // обычно означает, что таргет ещё не срезали под обвалившуюся цену — не считаем это недооценкой.
  const staleUp=(phase==='knife'||phase==='down');
  if(up!=null){
    if(up>=25){ if(staleUp){raw-=0.5;why.push(RT('⚠ таргет устарел?','⚠ stale target?'));} else {raw+=3;why.push(`+${up.toFixed(0)}% ${RT('к таргету','to target')}`);} }
    else if(up>=10){ if(!staleUp){raw+=2;why.push(`+${up.toFixed(0)}% ${RT('к таргету','to target')}`);} }
    else if(up>=0)raw+=1;else if(up>=-10)raw-=1;else raw-=2;
  }
  raw+=PHASE_PTS[phase]||0;
  if(roe!=null){if(roe>=15){raw+=2;why.push(`ROE ${roe.toFixed(0)}%`);}else if(roe>=10)raw+=1;else if(roe<0)raw-=1.5;}
  if(revg!=null){if(revg>=15){raw+=2;why.push(`${RT('рост','growth')} ${revg.toFixed(0)}%`);}else if(revg>=8){raw+=1;why.push(`${RT('рост','growth')} ${revg.toFixed(0)}%`);}else if(revg<0)raw-=1;}
  if(pe!=null&&pe>0){if(pe<=18){raw+=1;why.push(`P/E ${pe.toFixed(0)}`);}else if(pe>=45)raw-=1;}
  if(entry!=null&&upTrend){if(entry<=3){raw+=2;why.push(RT('у точки входа','near entry'));}else if(entry<=7){raw+=1;why.push(RT('близко к входу','near entry'));}}
  if(reco==='buy')raw+=2;else if(reco==='sell'||reco==='avoid')raw-=2;
  if(sigN)raw+=Math.max(-2,Math.min(3,sigN));
  if(insBuy)why.push(RT('инсайдеры↑','insiders↑'));
  if(undervalued)why.push(RT('недооценка','undervalued'));
  if(aiV==='buy')raw+=1;else if(aiV==='avoid'||aiV==='sell')raw-=1;
  if(newsSent!=null){if(newsSent>=2){raw+=1.5;why.push(RT('новости↑','news↑'));}else if(newsSent>0)raw+=0.5;else if(newsSent<=-2){raw-=1.5;why.push(RT('новости↓','news↓'));}else if(newsSent<0)raw-=0.5;}
  const score=Math.max(0,Math.min(100,Math.round(50+raw*4)));
  return {score,raw,why:[...new Set(why)].slice(0,3)};
}
function homeBestComposite(){
  const sm=(typeof _valSecCache!=='undefined'&&_valSecCache)||valSectorMedians();
  const seen=new Set(),out=[];
  v3Tabs().forEach(k=>{const d=DATA[k];if(!d||!Array.isArray(d.rows))return;
    const h=d.headers,{s50,s200}=smaIdx(d);
    const peC=h.indexOf('P/E'),roC=h.indexOf('ROE'),rgC=h.indexOf('Рост выручки'),supC=h.indexOf('Поддержка');
    d.rows.forEach((r,i)=>{
      const tk=String(r[2]||'').trim().toUpperCase();if(!tk||seen.has(tk))return;
      const price=parseFloat(r[7])||0;if(!(price>0))return;
      recalcPF(i,k);seen.add(tk);
      const num=c=>{const v=c>=0?parseFloat(r[c]):NaN;return isFinite(v)?v:null};
      const D=c=>{const v=num(c);return(v&&v>0)?(price/v-1)*100:null};
      const up=pf3EffUpside(d,r),pe=num(peC),roe=num(roC),revg=num(rgC);
      let phase='flat';try{phase=pf3Criterion(d,r).cls||'flat'}catch(e){}
      let reco=null;try{reco=pf3Reco(d,r).v}catch(e){}
      const sig=signalScore(INSIDER[tk],VAL[tk],sm[(VAL[tk]||{}).sector]);
      const insBuy=!!(INSIDER[tk]&&(INSIDER[tk].cluster||INSIDER[tk].netUSD>0));
      const aiV=(AI_RECO[tk]||{}).verdict||null;
      const d50=D(s50),dSup=D(supC),d200=D(s200);
      const entryRaw=[d50,dSup].filter(v=>v!=null).map(Math.abs).reduce((a,b)=>Math.min(a,b),Infinity);
      const entry=isFinite(entryRaw)?entryRaw:null;
      const undervalued=!!(sig&&sig.items.some(it=>it.d>0&&/недооцен|дешевле|undervalued|cheaper/.test(it.t)));
      const newsSent=(NEWS_LIVE[tk]&&NEWS_LIVE[tk].items&&NEWS_LIVE[tk].items.length)?NEWS_LIVE[tk].sent:null;
      const sc=homeCompositeScore({up,roe,revg,pe,entry,upTrend:d200!=null&&d200>0,phase,reco,sigN:sig?sig.n:0,insBuy,aiV,undervalued,newsSent});
      out.push({tk,name:String(r[1]||tk),ccy:r[8]||'',price,score:sc.score,up,roe,revg,pe,entry,phase,reco,sigN:sig?sig.n:0,aiV,why:sc.why});
    });
  });
  return out;
}
const HOME_BEST_SORTS=[['overall',['Общий','Overall']],['upside',['Апсайд','Upside']],['value',['Недооценка','Value']],['quality',['Качество','Quality']],['entry',['У входа','Entry']]];
let homeBestSort='overall',_homeBestCache=null;
function homeBestList(){
  if(!_homeBestCache)_homeBestCache=homeBestComposite();
  const a=_homeBestCache.slice(),BIG=1e9;
  const by={
    overall:(x,y)=>y.score-x.score,
    upside:(x,y)=>(y.up==null?-BIG:y.up)-(x.up==null?-BIG:x.up),
    quality:(x,y)=>(y.roe==null?-BIG:y.roe)-(x.roe==null?-BIG:x.roe),
    value:(x,y)=>(y.sigN-x.sigN)||((x.pe==null?BIG:x.pe)-(y.pe==null?BIG:y.pe)),
    entry:(x,y)=>(x.entry==null?BIG:x.entry)-(y.entry==null?BIG:y.entry),
  };
  return a.sort(by[homeBestSort]||by.overall);
}
function homeBestSetSort(s){homeBestSort=s;const el=document.getElementById('homeBestBoard');if(el)el.innerHTML=homeBestBoardInner();}
function homeBestBoardInner(){
  const seg=HOME_BEST_SORTS.map(s=>`<button class="pf3-hz-b${homeBestSort===s[0]?' on':''}" onclick="homeBestSetSort('${s[0]}')">${RT(s[1][0],s[1][1])}</button>`).join('');
  const arr=homeBestList().slice(0,12);
  if(!arr.length)return`<div class="pf3-hz-seg" style="margin:2px 0 8px">${seg}</div><div class="pf3-empty">${RT('Нет данных — нажмите «🔄 Обновить всё».','No data — press «🔄 Update all».')}</div>`;
  const max=Math.max(1,...arr.map(x=>x.score));
  const rows=arr.map((x,i)=>`<tr onclick="insiderOpenCard('${x.tk}')"><td class="bp-n">${i+1}</td><td class="bp-name"><b>${x.name}</b> <span class="bp-tk">${x.tk}</span></td><td class="bp-px">${pf3Fmt(x.price,2)} <small>${x.ccy}</small></td><td class="hb-score"><span class="hb-bar"><span class="hb-bar-f" style="width:${Math.round(x.score/max*100)}%"></span></span><b>${x.score}</b></td><td class="bp-why">${x.why.join(' · ')||'—'}</td></tr>`).join('');
  return`<div class="pf3-hz-seg" style="margin:2px 0 8px">${seg}</div><table class="bp-tbl"><thead><tr><th>#</th><th>${RT('Акция','Stock')}</th><th>${RT('Цена','Price')}</th><th>${RT('Балл','Score')}</th><th>${RT('Сигналы','Signals')}</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function homeBestBoardHTML(){
  return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>🏆 ${RT('Лучшие акции — общий рейтинг','Best stocks — overall rank')} ${infoBtn('bestrank')}</span><span class="pf3-asof">${RT('композит всех сигналов','composite of all signals')}</span></div><div id="homeBestBoard">${homeBestBoardInner()}</div><div class="pf3-ai-note">${RT('Один балл из апсайда, фазы, качества, роста, оценки, точки входа, рекомендации, инсайдеров и AI. Детерминированно по обновлённым данным. Справочно, не рекомендация.','One score from upside, phase, quality, growth, valuation, entry, recommendation, insiders and AI. Deterministic from refreshed data. Reference only.')}</div></section>`;
}

function pf3HealthTab(){
  const d=pf3D(),{s200}=smaIdx(d),fxB=pf3BaseFx(d);
  // cashFree/leverage хранятся в базовой валюте вкладки — приводим к SEK,
  // т.к. стоимость позиций (val) считается в SEK; иначе доли кэша/плеча врут.
  const free=(parseFloat(d.cashFree)||0)*fxB,lev=(v3Key===PF3_KEY?(parseFloat(d.leverage)||0):0)*fxB;
  const rows=d.rows.map((r,i)=>{
    recalcPF(i,v3Key);
    const price=parseFloat(r[7])||0,sma=s200>=0?parseFloat(r[s200]):NaN;
    return{
      name:String(r[1]||r[2]||''),
      val:parseFloat(r[13])||0,profit:parseFloat(r[11])||0,
      sec:(r[4]&&r[4]!=='—')?String(r[4]):'Прочее',
      ccy:r[8]||'USD',
      above:(isFinite(sma)&&sma>0&&price>0)?price>sma:null,
    };
  }).filter(x=>x.val>0);
  if(!rows.length)return`<section class="pf3-panel"><div class="pf3-empty">${T('Нет позиций для анализа — обновите цены на вкладке «Портфель»')}</div></section>`;
  const totalVal=rows.reduce((a,x)=>a+x.val,0);
  const equity=totalVal+free;
  // Concentration.
  const sorted=rows.slice().sort((a,b)=>b.val-a.val);
  const top1=sorted[0],top1Pct=top1.val/totalVal*100;
  const top3Pct=sorted.slice(0,3).reduce((a,x)=>a+x.val,0)/totalVal*100;
  // Allocations.
  const group=key=>{const m={};rows.forEach(x=>{m[x[key]]=(m[x[key]]||0)+x.val});return Object.entries(m).map(([k,v])=>({k,pct:v/totalVal*100})).sort((a,b)=>b.pct-a.pct)};
  const secs=group('sec'),ccys=group('ccy');
  // Trend & quality.
  const withSma=rows.filter(x=>x.above!=null);
  const abovePct=withSma.length?withSma.filter(x=>x.above).length/withSma.length*100:null;
  const profitPct=rows.filter(x=>x.profit>0).length/rows.length*100;
  const cashPct=equity>0?free/equity*100:0;
  const levPct=equity>0?lev/equity*100:0;
  // Scores 0–10 per dimension.
  const dn=(v,b)=>{for(const[lim,sc]of b)if(v<lim)return sc;return 0};        // lower is better
  const up=v=>v>=70?10:v>=55?8:v>=40?6:v>=25?4:2;                              // higher is better
  const nS=rows.length>=15?10:rows.length>=10?8:rows.length>=7?6:rows.length>=5?4:2;
  const divS=(nS+dn(top1Pct,[[10,10],[15,8],[20,6],[30,4],[40,2]]))/2;
  const secS=(dn(secs[0].pct,[[20,10],[30,8],[40,6],[50,4],[60,2]])+(secs.length>=6?10:secs.length>=4?7:secs.length>=3?5:3))/2;
  const ccyS=dn(ccys[0].pct,[[50,10],[65,8],[80,6],[90,4],[101,2]]);
  const cashS=(cashPct>=5&&cashPct<=25)?10:(cashPct>=2&&cashPct<40)?6:cashPct>=40?5:3;
  const levS=lev<=0?10:dn(levPct,[[10,8],[20,6],[35,4],[1e9,2]]);
  const liqS=(cashS+levS)/2;
  const trS=abovePct==null?null:(up(abovePct)+up(profitPct))/2;
  const parts=[
    [T('🧩 Диверсификация'),divS,RT(`${rows.length} позиций · топ-1 <b>${top1Pct.toFixed(1)}%</b> (${top1.name}) · топ-3 <b>${top3Pct.toFixed(0)}%</b>`,`${rows.length} positions · top-1 <b>${top1Pct.toFixed(1)}%</b> (${top1.name}) · top-3 <b>${top3Pct.toFixed(0)}%</b>`)],
    [T('🏭 Сектора'),secS,RT(`${secs.length} секторов · крупнейший <b>${secs[0].k}</b> — <b>${secs[0].pct.toFixed(0)}%</b>`,`${secs.length} sectors · largest <b>${secs[0].k}</b> — <b>${secs[0].pct.toFixed(0)}%</b>`)],
    [T('💱 Валюты'),ccyS,ccys.slice(0,4).map(c=>`${c.k} <b>${c.pct.toFixed(0)}%</b>`).join(' · ')],
    [v3Key===PF3_KEY?T('💵 Кэш и плечо'):RT('💵 Свободный кэш','💵 Free cash'),liqS,v3Key===PF3_KEY?RT(`кэш <b>${cashPct.toFixed(1)}%</b> капитала · плечо <b>${levPct.toFixed(1)}%</b>`,`cash <b>${cashPct.toFixed(1)}%</b> of equity · leverage <b>${levPct.toFixed(1)}%</b>`):RT(`кэш <b>${cashPct.toFixed(1)}%</b> капитала`,`cash <b>${cashPct.toFixed(1)}%</b> of equity`)],
    [T('📈 Тренд и качество'),trS,RT(`выше SMA 200: <b>${abovePct!=null?abovePct.toFixed(0)+'%':'—'}</b> акций · в прибыли: <b>${profitPct.toFixed(0)}%</b> позиций`,`above SMA 200: <b>${abovePct!=null?abovePct.toFixed(0)+'%':'—'}</b> of stocks · profitable: <b>${profitPct.toFixed(0)}%</b> of positions`)],
  ];
  const valid=parts.filter(p=>p[1]!=null);
  const total=valid.reduce((a,p)=>a+p[1],0)/(valid.length||1);
  const tl=pf3Lv(total);
  const OVERALL=['Критическое','Слабое','Среднее','Хорошее','Отличное'];
  // Plain-language recommendations from the weak spots.
  const rec=[];
  if(top1Pct>20)rec.push(RT(`⚠️ <b>${top1.name}</b> занимает ${top1Pct.toFixed(0)}% портфеля — рассмотрите сокращение до 15–20%, чтобы снизить риск одной бумаги`,`⚠️ <b>${top1.name}</b> is ${top1Pct.toFixed(0)}% of the portfolio — consider trimming to 15–20% to cut single-stock risk`));
  if(secs[0].pct>40)rec.push(RT(`⚠️ Сектор «<b>${secs[0].k}</b>» — ${secs[0].pct.toFixed(0)}% акций: высокая отраслевая концентрация`,`⚠️ Sector «<b>${secs[0].k}</b>» is ${secs[0].pct.toFixed(0)}% of stocks: high industry concentration`));
  if(ccys[0].pct>80)rec.push(RT(`⚠️ ${ccys[0].pct.toFixed(0)}% портфеля в <b>${ccys[0].k}</b> — заметный валютный риск для кроновых целей`,`⚠️ ${ccys[0].pct.toFixed(0)}% of the portfolio is in <b>${ccys[0].k}</b> — notable FX risk for SEK goals`));
  if(cashPct>30)rec.push(RT(`💡 Кэш ${cashPct.toFixed(0)}% капитала — большой резерв: размещайте его постепенно по сигналам докупки на вкладке «Портфель»`,`💡 Cash is ${cashPct.toFixed(0)}% of equity — a large reserve: deploy it gradually on buy signals from the Portfolio tab`));
  if(cashPct<3)rec.push(RT('⚠️ Свободного кэша почти нет — нечем докупать на просадках','⚠️ Almost no free cash — nothing to buy dips with'));
  if(levPct>20)rec.push(RT(`⚠️ Плечо ${levPct.toFixed(0)}% капитала — следите за стоимостью заёмных средств`,`⚠️ Leverage is ${levPct.toFixed(0)}% of equity — watch the cost of borrowing`));
  if(abovePct!=null&&abovePct<40)rec.push(RT('⚠️ Большинство акций ниже SMA 200 — портфель в нисходящем тренде, докупайте осторожно','⚠️ Most stocks are below SMA 200 — the portfolio is in a downtrend, add carefully'));
  if(rows.length<8)rec.push(RT('💡 Меньше 8 позиций — 3–5 бумаг из недостающих секторов снизят риск','💡 Fewer than 8 positions — 3–5 stocks from missing sectors would cut risk'));
  if(!rec.length)rec.push(RT('✅ Существенных перекосов не найдено — портфель сбалансирован','✅ No major imbalances found — the portfolio is well balanced'));
  const bars=arr=>arr.slice(0,8).map(x=>`<div class="pf3-bar-row"><span class="pf3-bar-l">${x.k}</span><div class="pf3-bar-track"><div class="pf3-bar-fill" style="width:${Math.min(100,x.pct)}%"></div></div><span class="pf3-bar-v">${x.pct.toFixed(1)}%</span></div>`).join('');
  const card=(t,score,metrics)=>{
    const lv=pf3Lv(score);
    const verdict=lv==null?'—':`${PF3_LV[lv].e} ${T(PF3_LV[lv].l)} · ${score.toFixed(1)}`;
    return`<div class="pf3-hcard ${lv==null?'':PF3_LV[lv].c}"><div class="pf3-hcard-top"><span class="pf3-hcard-t">${t}</span><span class="pf3-verdict ${lv==null?'':PF3_LV[lv].c}">${verdict}</span></div><div class="pf3-hmetrics">${metrics}</div></div>`;
  };
  return`
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${T('🩺 Состояние портфеля')}</span></div>
    <div class="pf3-health-grid">
      ${tl!=null?`<div class="pf3-overall">
        <div class="pf3-overall-l"><span class="pf3-overall-badge ${PF3_LV[tl].c}">${PF3_LV[tl].e} ${T('Здоровье портфеля:')} ${T(OVERALL[tl])}</span><span class="pf3-overall-score">${total.toFixed(1)} / 10</span></div>
        <div class="pf3-scale"><div class="pf3-scale-marker" style="left:${Math.min(100,Math.max(0,total*10))}%"></div></div>
        <div class="pf3-scale-labels"><span>${T('Критично')}</span><span>${T('Слабо')}</span><span>${T('Средне')}</span><span>${T('Хорошо')}</span><span>${T('Отлично')}</span></div>
      </div>`:''}
      ${parts.map(p=>card(p[0],p[1],p[2])).join('')}
    </div>
  </section>
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${RT('📐 Риск и доходность — 1 год','📐 Risk & return — 1Y')} ${infoBtn('riskret')}</span></div>
    <div id="pf3RiskBox">${pf3RiskHTML()}</div>
  </section>
  ${cashDragHTML(d,rows)}
  ${fxHedgeHTML(d,rows,equity)}
  <section class="pf3-grid">
    <div class="pf3-panel"><div class="pf3-panel-hd"><span>${T('🏭 Распределение по секторам')}</span></div>${bars(secs)}</div>
    <div class="pf3-panel"><div class="pf3-panel-hd"><span>${T('💱 Распределение по валютам')}</span></div>${bars(ccys)}</div>
  </section>
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${T('💡 Рекомендации')}</span></div>
    ${rec.map(r=>`<div class="pf3-reco">${r}</div>`).join('')}
  </section>`;
}

function pf3SetNum(key,v){const n=parseFloat(v);pf3D()[key]=(isNaN(n)||n<0)?0:n;scheduleSave();renderPF3()}

// Master-detail: the holdings list shows brief info; clicking a row opens the
// full card to the LEFT of the list, and the list scales down into a compact column.
let pf3Sel=null;   // ticker whose full card is open (null = list only)
let pf3Tab='list'; // sub-tab: 'list' (портфель) | 'cal' (дивиденды и отчёты)

// ===== «Дивиденды и отчёты» sub-tab =====
// Batch calendar (next earnings date + dividend info per holding) via ?calendar=.
let pf3Cal={data:null,loaded:0,loading:false,failed:false};
async function pf3LoadCalendar(){
  if(pf3Cal.loading||(pf3Cal.data&&pf3Cal.key===v3Key&&Date.now()-pf3Cal.loaded<6*3600*1000))return;
  pf3Cal.loading=true;pf3Cal.failed=false;
  const key=v3Key;   // портфель запуска: пока грузится, пользователь может переключить портфель (desk — в шапке)
  try{
    const d=DATA[key];
    const syms=[...new Set(d.rows.map(r=>exSymbol(r[2],r[8])).filter(Boolean))];
    // Чанки (лимит подзапросов Cloudflare) загружаются параллельно.
    const chunks=[];
    for(let i=0;i<syms.length;i+=40)chunks.push(syms.slice(i,i+40).join(','));
    const parts=await Promise.all(chunks.map(c=>fetch(PRICE_PROXY+'?calendar='+encodeURIComponent(c)).then(r=>r.json()).catch(()=>null)));
    const j=Object.assign({},...parts.filter(p=>p&&typeof p==='object'&&!p.error));
    // Слияние, а не замена: desk держит здесь же даты отчётов книги/списка/сетапов (deskCal) — их не терять.
    if(Object.keys(j).length){pf3Cal.data=Object.assign({},pf3Cal.data||{},j);pf3Cal.loaded=Date.now();pf3Cal.key=key;}
    else pf3Cal.failed=true;
  }catch(e){pf3Cal.failed=true;}
  pf3Cal.loading=false;
  if(isV3()&&pf3Tab==='cal'){if(key!==v3Key)pf3LoadCalendar();else renderPF3();}   // сменили портфель во время загрузки — догрузить его
}

function pf3CalendarHTML(){
  const d=pf3D(),C=pf3Cal.key===v3Key?pf3Cal.data:null;
  if(!C)return`<section class="pf3-panel"><div class="pf3-empty">${pf3Cal.loading?T('Загружаю календарь отчётов и дивидендов…'):pf3Cal.failed?'Нет данных — обновите Cloudflare worker (эндпоинт ?calendar)':'…'}</div></section>`;
  // События по датам: 📊 отчёт · 🪙 экс-дата · 💰 выплата. Клик — карточка акции.
  const ev={},add=(date,tk,ico,t)=>{if(date)(ev[date]=ev[date]||[]).push({tk,ico,t})};
  const dv=[];let annualDiv=0;
  d.rows.forEach(r=>{
    const tk=String(r[2]||''),c=C[exSymbol(r[2],r[8])]||{};
    const ccy=r[8]||'USD',qty=parseFloat(r[6])||0;
    add(c.earnings,tk,'📊',T('отчёт'));add(c.exDiv,tk,'🪙',T('экс-дата'));add(c.payDate,tk,'💰',T('выплата'));
    if(typeof c.divRate==='number'&&c.divRate>0){
      const annual=qty*c.divRate*(FX[ccy]||1);annualDiv+=annual;
      dv.push({tk,name:r[1]||tk,rate:c.divRate,ccy,yld:typeof c.divYield==='number'?c.divYield*100:null,exDiv:c.exDiv,pay:c.payDate,annual});
    }
  });
  dv.sort((a,b)=>(a.exDiv||'9999')<(b.exDiv||'9999')?-1:1);
  const now=new Date();
  const m0=new Date(now.getFullYear(),now.getMonth()+pf3CalOff,1);
  const Y=m0.getFullYear(),M=m0.getMonth();
  const lead=(m0.getDay()+6)%7;   // неделя с понедельника
  const dim=new Date(Y,M+1,0).getDate();
  const monthName=m0.toLocaleDateString(LANG==='en'?'en-GB':'ru-RU',{month:'long',year:'numeric'});
  const dows=LANG==='en'?['Mon','Tue','Wed','Thu','Fri','Sat','Sun']:['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const todayIso=new Date(now.getFullYear(),now.getMonth(),now.getDate()).toLocaleDateString('sv-SE');
  let cells='';
  for(let i=0;i<lead;i++)cells+='<div class="cal-cell off"></div>';
  for(let day=1;day<=dim;day++){
    const iso=`${Y}-${String(M+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const es=ev[iso]||[];
    cells+=`<div class="cal-cell${iso===todayIso?' today':''}${es.length?' has':''}"><span class="cal-d">${day}</span>${es.map(e=>`<span class="cal-ev" title="${e.t}" onclick="deskOpenTk('${e.tk}')">${e.ico} ${e.tk}</span>`).join('')}</div>`;
  }
  let h=`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>📅 ${T('Календарь — отчёты и дивиденды')}</span><span class="cal-nav"><button class="pf3-btn" onclick="pf3CalNav(-1)">‹</button><b class="cal-month">${monthName}</b><button class="pf3-btn" onclick="pf3CalNav(1)">›</button>${pf3CalOff?`<button class="pf3-btn" onclick="pf3CalNav(-pf3CalOff)">${T('Сегодня')}</button>`:''}</span></div>
    <div class="cal-grid">${dows.map(x=>`<div class="cal-dow">${x}</div>`).join('')}${cells}</div>
    <div class="cal-legend">📊 ${T('отчёт')} · 🪙 ${T('экс-дата')} · 💰 ${T('выплата')} · ${T('клик по событию открывает карточку')}</div>
  </section>`;
  h+=`<section class="pf3-panel"><div class="pf3-panel-hd"><span>${T('💰 Дивиденды')}</span><span class="pf3-asof">≈${pf3Money(d,annualDiv)} ${RT('в год по текущим позициям','/year on current positions')}</span></div>`;
  if(dv.length){
    h+=`<div class="pf3-divhead"><span>${T('Компания')}</span><span>${T('Дивид./год')}</span><span>${T('Доходность')}</span><span>${T('Экс-дата')}</span><span>${T('Выплата')}</span><span>${T('Мне в год')}</span></div>`;
    dv.forEach(x=>{
      h+=`<div class="pf3-div-row"><b>${x.name} <span class="pf3-cal-tk">${x.tk}</span></b><span>${x.rate.toFixed(2)} ${x.ccy}</span><span class="pf3-up">${x.yld!=null?x.yld.toFixed(1)+'%':'—'}</span><span>${x.exDiv?pf3DateRu(x.exDiv):'—'}</span><span>${x.pay?pf3DateRu(x.pay):'—'}</span><span><b>${pf3Money(d,x.annual)}</b></span></div>`;
    });
  }else h+=`<div class="pf3-empty">${T('Дивидендных бумаг в портфеле нет')}</div>`;
  h+='</section>';
  return h;
}
let pf3CalOff=0;   // смещение месяца календаря от текущего
function pf3CalNav(k){pf3CalOff+=k;renderPF3()}
const pf3SelIdx=()=>{const d=pf3D(),i=d.rows.findIndex(r=>String(r[2]||'')===pf3Sel);return i>=0?i:0};

// ── 🎯 Эффективный таргет и апсайд (фаза sigRowPhase, AI-снапшоты, скринер) ──
// % расхождения, при котором основной «Аналит. таргет» считаем устаревшим.
const TG_STALE_PCT=10;
// Эффективный таргет для «потенциала роста»: основной (аналит. таргет), но если
// он устарел — расходится со свежим срезом «Таргет 3м» на ≥ TG_STALE_PCT% —
// берём свежий квартальный/месячный.
function pf3EffTarget(d,r){
  const h=d.headers;
  const ti=h.findIndex(x=>/аналит/i.test(x)), ri=h.findIndex(x=>/таргет 3м/i.test(x));
  const main=ti>=0?(parseFloat(r[ti])||0):0;
  const recent=ri>=0?(parseFloat(r[ri])||0):0;
  const stale=main>0&&recent>0&&Math.abs(recent-main)/main*100>=TG_STALE_PCT;
  return { target: stale?recent:(main||recent), main, recent, stale };
}
function pf3EffUpside(d,r){
  const price=parseFloat(r[7])||0, t=pf3EffTarget(d,r).target;
  return (t>0&&price>0)?(t/price-1)*100:null;
}

// Общая таблица прогноза (детерминированный и AI используют её).
// rows: [{name,tk,valSEK,mark?,title?,cells:[{v,pct,has}]}] · hzLabels: подписи горизонтов.
function pf3FcTable(d,rows,hzLabels){
  let curStocks=0;const sumH=hzLabels.map(()=>0);
  rows.forEach(x=>{curStocks+=x.valSEK;x.cells.forEach((c,i)=>{sumH[i]+=c.v})});
  const cashSEK=(parseFloat(d.cashFree)||0)*pf3BaseFx(d),netNow=curStocks+cashSEK;
  const cls=p=>p>=0?'pf3-up':'pf3-down',pctTxt=p=>`<small class="${cls(p)}">${p>=0?'+':''}${p.toFixed(1)}%</small>`;
  const tpl=`grid-template-columns:minmax(120px,1.6fr) repeat(${hzLabels.length+1},minmax(74px,1fr))`;
  const head=`<div class="fc-row fc-head" style="${tpl}"><span>${RT('Акция','Stock')}</span><span class="fc-r">${RT('Сейчас','Now')}</span>${hzLabels.map(h=>`<span class="fc-r">${h}</span>`).join('')}</div>`;
  const rh=rows.map(x=>`<div class="fc-row" style="${tpl}"${x.title?` title="${String(x.title).replace(/"/g,'&quot;')}"`:''}><span class="fc-name"><b>${x.name}</b> <span class="bp-tk">${x.tk}</span>${x.mark||''}</span><span class="fc-r">${pf3Money(d,x.valSEK)}</span>${x.cells.map(c=>`<span class="fc-r">${pf3Money(d,c.v)}<br>${c.has?pctTxt(c.pct):'—'}</span>`).join('')}</div>`).join('');
  const totRow=(label,nowV,hVals,extra)=>`<div class="fc-row fc-tot${extra}" style="${tpl}"><span class="fc-name">${label}</span><span class="fc-r">${pf3Money(d,nowV)}</span>${hVals.map(v=>`<span class="fc-r">${pf3Money(d,v)}<br>${pctTxt(nowV>0?(v/nowV-1)*100:0)}</span>`).join('')}</div>`;
  return`<div class="fc-tbl">${head}${rh}${totRow('📦 '+RT('Акции','Stocks'),curStocks,sumH,' fc-stocks')}${totRow('💰 '+RT('Чистый капитал','Net worth'),netNow,sumH.map(s=>s+cashSEK),' fc-net')}</div>`;
}
// ✨ AI-прогноз (AI Proto + web_search): проекция стоимости на 3 горизонта.
let pf3Fcast={loading:false};
function pf3FcastAiHTML(d){
  if(!isAdmin())return'';   // AI — только админу (токены)
  const fa=d.fcastAI,busy=pf3Fcast.loading;
  const btn=`<button class="pf3-btn" onclick="pf3FcastAiRun()"${busy?' disabled':''}>${busy?'⏳ '+RT('Прогнозирую','Forecasting')+'…':(fa?'🔄 '+RT('Обновить AI-прогноз','Refresh AI forecast'):'✨ '+RT('AI-прогноз','AI forecast'))}</button>`;
  let body='';
  if(fa&&Array.isArray(fa.stocks)){
    const HK=['h3','h69','h12'],HL=['3 '+RT('мес','m'),RT('6–9 мес','6–9m'),RT('12+ мес','12m+')];
    const byTk={};fa.stocks.forEach(s=>{byTk[String(s.ticker||'').toUpperCase()]=s});
    const rows=[];
    d.rows.forEach((r,i)=>{const qty=parseFloat(r[6])||0;if(!(qty>0))return;recalcPF(i,v3Key);const valSEK=parseFloat(r[13])||0;const s=byTk[String(r[2]||'').toUpperCase()]||{};
      const cells=HK.map(k=>{const pct=parseFloat(s[k]),has=isFinite(pct);return{v:valSEK*(1+(has?pct:0)/100),pct:has?pct:0,has}});
      rows.push({name:String(r[1]||r[2]),tk:String(r[2]),valSEK,cells,title:String(s.note||'')});});
    rows.sort((a,b)=>b.valSEK-a.valSEK);
    body=`${fa.summary?`<div class="dash-headline">${pf3Md(fa.summary)}</div>`:''}${pf3FcTable(d,rows,HL)}`;
  }
  return`<div class="fc-ai"><div class="pf3-panel-hd fc-ai-hd"><span>✨ ${RT('AI-прогноз','AI forecast')}</span><span class="pf3-asof">${fa&&fa.at?RT('обновлено','updated')+' '+pf3DtRu(fa.at)+(fa.cost?' · '+costLine(fa.cost):''):RT('AI Proto с веб-поиском свежих таргетов и новостей','AI Proto with web search of fresh targets & news')}</span>${btn}</div>${body||(busy?`<div class="pf3-empty">⏳ ${RT('AI Proto собирает свежие данные…','AI Proto gathering fresh data…')}</div>`:`<div class="pf3-empty">${RT('Нажмите «AI-прогноз» — AI Proto со свежими новостями и таргетами спрогнозирует стоимость на 3 горизонта.','Press «AI forecast» — AI Proto forecasts value across 3 horizons with fresh news & targets.')}</div>`)}</div>`;
}
async function pf3FcastAiRun(){
  if(pf3Fcast.loading)return;
  const key=v3Key;pf3Fcast.loading=true;renderPF3();
  try{
    await pf3RefreshTab(key);
    await pf3LoadAllFundamentals(key).catch(()=>{});   // 🏅 фундаментал всех позиций → betyg как в карточке
    const d=DATA[key],num=v=>{const n=parseFloat(v);return isFinite(n)?n:null};
    const positions=d.rows.filter(r=>(parseFloat(r[6])||0)>0).map(r=>{const m=pf3TypeMetrics(d,r);const full=(typeof pf3BetygRow==='function')?pf3BetygRow(r,r[4]):null;const b=(!full&&typeof pf3RowBetyg==='function')?pf3RowBetyg({roe:m.roe,revg:m.revg,pe:m.pe,ps:m.ps,sec:r[4],r}):null;return{ticker:r[2],name:r[1],sector:r[4],ccy:r[8]||'USD',qty:num(r[6]),price:num(r[7]),analystTarget:pf3EffTarget(d,r).target||null,upsidePct:pf3EffUpside(d,r),pe:m.pe,roe:m.roe,revGrowth:m.revg,betyg:full?{score100:full.score100,grade:full.grade}:(b!=null?{score100:Math.round(b*10),grade:(pf3Grade(b)||{}).g||null}:null),phase:sigRowPhase(d,r).label}});
    const snap={portfolioName:TAB_LABEL(key),baseCurrency:pf3Base(d),horizons:['3 мес','6-9 мес','12+ мес'],positions,playbook:aiPlaybookEnsure()};
    const r=await fetch(PRICE_PROXY+'?action=forecast',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},body:JSON.stringify(snap)});
    const bodyText=await r.text();let j=null;try{j=JSON.parse(bodyText)}catch(_){}
    if(j&&j.forecast){aiSpendAdd(j.cost);DATA[key].fcastAI={summary:j.forecast.summary||'',stocks:Array.isArray(j.forecast.stocks)?j.forecast.stocks:[],horizons:j.forecast.horizons||null,at:new Date().toISOString(),cost:j.cost||null};scheduleSave();}
    else{const msg=(j&&j.error)||(bodyText?bodyText.slice(0,200):('HTTP '+r.status));console.warn('Forecast failed:',r.status,bodyText);toast('AI ('+TAB_LABEL(key)+'): '+msg,true);}
  }catch(e){toast('AI: '+(e&&e.message||RT('сеть/worker недоступен','network/worker unreachable')),true);}
  pf3Fcast.loading=false;if(isV3())renderPF3();
}

// Лёгкий фундаментальный рейтинг для СТРОКИ списка (по доступным колонкам:
// ROE / рост выручки / P/E·P/S). Полный 5-столповый betyg — в карточке (pf3Betyg).
// Возвращает 0–10 или null (нет данных). Используется как сортируемая колонка → скринер.
function pf3RowBetyg(o){
  const prof=o.roe>0?(o.roe>=20?10:o.roe>=15?9:o.roe>=10?7:o.roe>=5?5:4):(o.roe<0?1:null);
  const grow=(typeof o.revg==='number'&&o.revg!==0)?(o.revg>=20?10:o.revg>=10?8:o.revg>=4?6:o.revg>0?5:o.revg>-10?3:1):null;
  const val=(typeof pf3ValScore==='function')?pf3ValScore({pe:o.pe,ps:o.ps},String((o.r&&o.r[2])||'').toUpperCase(),o.sec,(typeof pf3FinSec==='function'&&pf3FinSec(o.sec))):null;
  const W={prof:0.4,grow:0.3,val:0.3};let sw=0,wsum=0;
  [['prof',prof],['grow',grow],['val',val]].forEach(([k,v])=>{if(v!=null){sw+=v*W[k];wsum+=W[k];}});
  return wsum?sw/wsum:null;
}
// Переименование вкладки: меняется только отображаемое имя (d.title) —
// ключ данных остаётся прежним, чтобы не ломать синк, worker и группы.
function pf3RenameTab(ev){
  if(ev)ev.stopPropagation();
  const d=DATA[v3Key];if(!d)return;
  const cur=d.title||TAB_LABEL(v3Key);
  const name=(prompt(RT('Новое название вкладки:','New tab name:'),cur)||'').trim();
  if(!name||name===cur)return;
  d.title=name;
  scheduleSave();init();
  toast(RT('Вкладка переименована ✓','Tab renamed ✓'));
}
// Принудительно обновить таргеты/метрики/типы текущей вкладки, не дожидаясь
// суточного таймера (сбрасывает targetsAt и сразу тянет батч ?targets).
async function pf3ForceTypes(ev){
  if(ev)ev.stopPropagation();
  const d=pf3D();
  d.targetsAt=0;_tgEndpointDown=false;
  toast(RT('Обновляю метрики и типы…','Refreshing metrics & types…'));
  await pf3RefreshTargets(d);
  renderPF3();
  toast(d.targetsAt?RT('Метрики и типы пересчитаны ✓','Metrics & types re-scored ✓'):RT('Не удалось получить метрики (worker?)','Could not fetch metrics (worker?)'),!d.targetsAt);
}


// Логотип компании: FMP image CDN → Parqet → буквы тикера (оба бесплатны,
// покрывают US/.ST/.DE; при двойном промахе <img> убирает себя и остаются буквы).
function logoHTML(tk,ccy,cls){
  const esym=encodeURIComponent(exSymbol(tk,ccy));
  return`<div class="${cls}">${String(tk).slice(0,2)}<img class="logo-i" loading="lazy" alt="" src="https://images.financialmodelingprep.com/symbol/${esym}.png" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='https://assets.parqet.com/logos/symbol/${esym}?format=png&size=64'}else this.remove()"></div>`;
}

// Nasdaq stores ~70 granular sectors (one stock each) — the «Сектора» view
// would be a wall of single-stock groups. Roll them up into 12 macro sectors
// by keyword; ORDER MATTERS (e.g. «AI Networking» must hit Полупроводники
// before «Networking» hits Железо). The portfolio keeps its own coarse labels.
const PF3_MACRO=[
  ['Полупроводники',/полупровод|semicond|\bsemis?\b|chip|silicon|memory|analog|ai networking/i],
  ['Кибербезопасность',/cyber|кибер/i],
  ['Интернет и реклама',/search|social|ad tech|mobile ads|соцсет|реклам/i],
  ['E-commerce и сервисы',/e-?comm|delivery|travel|hotel|restaurant|путешеств|туризм/i],
  ['Финансы и недвижимость',/fintech|payment|payroll|real estate|\breit\b|финанс|недвиж|bitcoin|банк|инвестиц|pe fund/i],
  ['Здравоохранение',/biotech|pharma|\bmed\b|health|vaccin|фарма|биотех|медицин|здравоохран/i],
  ['Потребительский сектор',/staples|beverage|retail|auto parts|потребительск|напитк/i],
  ['Медиа и телеком',/streaming|gaming|\bmedia\b|satellite|telecom|cable|телеком|медиа|казино/i],
  ['Промышленность и транспорт',/industrial|logistic|truck|uniform|security|defen[cs]e|оборон|auto auctions|\bev\b|aerospace|горнодоб|лесопром|строительств|подшипник|грузовик|конгломерат|теплонасос|теплообмен|замк|электрификац|промтех|сырь/i],
  ['Энергетика',/power|energy|oil|solar|utilit|nuclear|энерг|коммунал|нефт/i],
  ['Железо и сети',/server|networking|distribution|\btech\b/i],
  ['Софт и облако',/software|cloud|saas|analytics|databas|dev tools|облач|данн|\bai\b|\bии\b|цифр/i],
];
const pf3MacroSector=s=>{for(const[n,re]of PF3_MACRO)if(re.test(s))return n;return s||'Прочее'};

// ── 🧭 Диверсификация: маппинг ярлыков сектора (Yahoo/Finnhub/рус) → 11 GICS ──
// Источник сектора — поле «Сектор» строки (покрывает все бумаги, в т.ч. Nordic;
// Finnhub /profile2 — US-only, поэтому не используется). Сворачиваем по ключевым
// словам (lowercase), а не точным равенством — формулировки ярлыков меняются.
// Конфиг намеренно отдельным блоком — легко обновлять.
const GICS_ALL=['Информационные технологии','Здравоохранение','Финансы','Потребительский цикличный','Коммуникационные услуги','Промышленность','Потребительский защитный','Энергетика','Коммунальные услуги','Недвижимость','Материалы'];
const GICS_OTHER='Не классиф.';
const GICS_MAP=[
  ['Недвижимость',/real estate|\breit\b|недвиж/i],
  ['Энергетика',/\boil\b|oil.?(&|and|gas)|\bgas\b|petrol|\benergy\b|нефт|\bгаз|энергонос/i],
  ['Коммунальные услуги',/utilit|electric util|water util|коммунал|электроэнерг|водоснаб/i],
  ['Материалы',/chemical|metal|mining|\bmaterials\b|\bpaper\b|forest|containers|packaging|хими|металл|горнодоб|материал|\bсырь|целлюлоз|лесопром|удобрен/i],
  ['Здравоохранение',/health|pharma|biotech|medical|life science|\bdrug|фарма|биотех|медиц|здравоохран|лекарств/i],
  ['Финансы',/bank|financ|insurance|capital market|asset manage|consumer finance|exchange|банк|финанс|страхов|инвесткомп|биржа|платеж|fintech/i],
  ['Коммуникационные услуги',/communicat|telecom|\bmedia\b|interactive media|entertainment|wireless|streaming|gaming|publishing|медиа|телеком|\bсвязь|реклам|соцсет|развлеч|игров|стрим/i],
  ['Потребительский защитный',/consumer (defensive|staples)|staples|food|beverage|tobacco|household|personal product|grocery|продукт|напитк|табак|товары первой|защитн|бытов/i],
  ['Потребительский цикличный',/consumer (cyclical|discretionary)|retail|\bauto|apparel|luxury|hotel|restaurant|leisure|durables|e-?comm|travel|gambl|рознич|ритейл|автомоб|одежд|роскош|отел|ресторан|туризм|досуг|потребит.*цикл/i],
  ['Промышленность',/industr|aerospace|defen[cs]e|airline|machinery|logistic|construction|engineering|transport|railroad|building product|electrical equip|промышл|оборон|авиа|машиностро|логист|строит|транспорт|желез.*дорог|грузов|конгломерат|инфраструкт|электрооборуд|электрификац|подшипник/i],
  ['Информационные технологии',/technolog|semicond|software|hardware|\bchip|silicon|it services|electronic|comput|\bsaas\b|\bcloud\b|cyber|\btech\b|полупровод|софт|технолог|программн|облач|кибер|аппарат|вычислит|ai.?(infra|network|server|servers|analytics)|ии.?инфра/i],
];
function gicsOf(s){const t=String(s||'').trim();if(!t||/^n\/?a$/i.test(t))return GICS_OTHER;for(const[g,re]of GICS_MAP)if(re.test(t))return g;return GICS_OTHER;}
// Распределение портфеля по 11 GICS по рыночной стоимости (r[13]) + HHI, топ,
// флаги концентрации и список отсутствующих секторов.
function pf3Diversification(d){
  const by={};let total=0;
  (d.rows||[]).forEach((r,i)=>{recalcPF(i,v3Key);const val=parseFloat(r[13])||0;if(!(val>0))return;const g=gicsOf(r[4]);(by[g]=by[g]||{sum:0,n:0});by[g].sum+=val;by[g].n++;total+=val;});
  const sectors=Object.keys(by).map(g=>({gics:g,sum:Math.round(by[g].sum),n:by[g].n,pct:total>0?by[g].sum/total*100:0})).sort((a,b)=>b.pct-a.pct);
  const hhi=sectors.reduce((a,s)=>a+Math.pow(s.pct/100,2),0);
  const missing=GICS_ALL.filter(g=>!by[g]);
  return{sectors,total:Math.round(total),hhi,missing,top:sectors[0]||null,threshold:30};
}
function pf3DiversHTML(){
  const d=pf3D(),D=pf3Diversification(d);
  const hd=`<div class="pf3-panel-hd"><span>🧭 ${RT('Диверсификация по секторам (GICS)','Sector allocation (GICS)')}</span><span class="pf3-asof">${RT('по рыночной стоимости · текущие цены','by market value · live prices')}</span></div>`;
  if(!D.total)return`<section class="pf3-panel">${hd}<div class="pf3-empty">${RT('Нет позиций с рыночной стоимостью.','No positions with market value.')}</div></section>`;
  const hhiPct=(D.hhi*100).toFixed(0),eff=(1/D.hhi).toFixed(1);
  const vd=D.hhi<=0.18?['🟢',RT('Хорошо диверсифицирован','Well diversified')]:D.hhi<=0.30?['🟡',RT('Умеренная концентрация','Moderate concentration')]:['🔴',RT('Высокая концентрация','High concentration')];
  const bar=p=>`<div class="dv-bar"><span style="width:${Math.min(100,p).toFixed(1)}%"></span></div>`;
  const rows=D.sectors.map(s=>{const hot=s.pct>=D.threshold;return`<tr class="${hot?'dv-hot':''}"><td>${s.gics}${s.gics===GICS_OTHER?' ⚠️':''}</td><td class="dv-pct"><span>${s.pct.toFixed(1)}%</span>${bar(s.pct)}</td><td>${pf3Money(d,s.sum)}</td><td>${s.n}</td><td>${hot?'🔴 '+RT('концентр.','conc.'):''}</td></tr>`}).join('');
  const unc=D.sectors.find(s=>s.gics===GICS_OTHER);
  return`<section class="pf3-panel">${hd}
    <div class="dv-top">${vd[0]} <b>${vd[1]}</b> · ${RT('индекс концентрации (HHI)','concentration index (HHI)')} ${hhiPct}/100 · ≈${eff} ${RT('эфф. секторов','eff. sectors')}${D.top?` · ${RT('топ','top')}: ${D.top.pct.toFixed(0)}% ${D.top.gics}`:''}</div>
    <table class="dv-tbl"><thead><tr><th>${RT('Сектор','Sector')}</th><th>${RT('Доля','Weight')}</th><th>${RT('Сумма','Value')}</th><th>${RT('Поз.','Pos.')}</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    ${unc?`<div class="pf3-ai-note">⚠️ ${RT('«Не классиф.» — сектор не распознан по ярлыку; проверьте поле «Сектор» у этих бумаг.','«Unclassified» — sector label not recognised; check the Sector field.')}</div>`:''}
    ${D.missing.length?`<div class="dv-missing"><b>${RT('Нет экспозиции','No exposure')}:</b> ${D.missing.join(' · ')}</div>`:''}
    <div class="pf3-ai-note">${RT(`Порог концентрации ${D.threshold}%. Справочная информация для оценки диверсификации, не инвестиционная рекомендация.`,`Concentration threshold ${D.threshold}%. Reference information, not investment advice.`)}</div>
  </section>`;
}

// Иконки секторов (по ключевым словам; работают и для макро-, и для детальных имён).
const PF3_SEC_ICONS=[[/золот|gold|silver|серебр|добыч золота|драгоцен/i,'⛏️'],[/bitcoin|крипт/i,'₿'],[/кибер|cyber/i,'🛡️'],[/полупровод|чип|chip|semicond|memory/i,'💾'],[/интернет и реклама|соцсет|реклам|search|ad tech/i,'🌐'],[/e-?comm|путешеств|туризм|travel|hotel|restaurant|delivery/i,'🛒'],[/финанс|недвиж|fintech|payment|reit/i,'🏦'],[/здравоохран|фарма|pharma|био|biotech|med/i,'💊'],[/потребитель|staples|beverage|retail/i,'🛍️'],[/медиа|телеком|telecom|streaming|gaming|media|cable/i,'📡'],[/энерг|power|oil|solar|utilit|nuclear/i,'⚡'],[/железо|сети|networking|server|hardware|distribution/i,'🖥️'],[/софт|облако|software|cloud|данн|analytics|database|\bai\b|ии/i,'☁️'],[/промышл|транспорт|оборон|industrial|logistic|truck|defen/i,'🏭']];
const secIcon=s=>{for(const[re,i]of PF3_SEC_ICONS)if(re.test(s||''))return i;return '🏭'};

// Add a stock to Портфель 3.0 or to the Nasdaq 100 watchlist (form at the
// bottom of the list). Index mode needs only the ticker — qty/buy stay 0;
// name, sector, type, price and levels are auto-filled right after.
function pf3Add(e){
  if(e)e.preventDefault();
  const port=pf3IsPort(v3Key);
  const t=document.getElementById('pf3AddTicker').value.trim().toUpperCase();
  const sh=port?parseFloat(document.getElementById('pf3AddQty').value):0;
  const buy=port?parseFloat(document.getElementById('pf3AddBuy').value):0;
  const ccy=document.getElementById('pf3AddCcy').value;
  if(!t||(port&&(!(sh>0)||!(buy>0)))){toast(port?'Заполните тикер, кол-во и цену покупки':'Укажите тикер',true);return}
  const d=pf3D();
  if(d.rows.some(r=>String(r[2]||'').trim().toUpperCase()===t)){toast(t+' уже в списке',true);return}
  const flag={USD:'🇺🇸',EUR:'🇪🇺',SEK:'🇸🇪',NOK:'🇳🇴',DKK:'🇩🇰',GBP:'🇬🇧'}[ccy]||'';
  const row=[d.rows.length+1,PF3_NAMES[t]||t,t,flag,'—','Акция',sh||0,buy||0,ccy,buy||0,0,0,0,0,'—','—','','','',0,0,'⚪ Держать'];
  while(row.length<d.headers.length)row.push('');
  d.rows.push(row);
  d.count=d.rows.length;
  recalcPF(d.rows.length-1,v3Key);
  // Покупка списывает деньги со свободного кэша (кэш → акции, чистый капитал
  // не меняется). Только мои/семейные портфели; AI-портфель сюда не попадает
  // (форма скрыта). Кэш может уйти в минус — это плечо, оставляем как есть.
  const cost=port?Math.round((sh||0)*(buy||0)*(FX[ccy]||1)):0;   // SEK
  let cashMsg='';
  if(cost>0&&d.cashFree!=null&&d.cashFree!==''){
    const costBase=pf3Cv(d,cost);   // списываем со свободного кэша в БАЗОВОЙ валюте вкладки
    d.cashFree=Math.round(((parseFloat(d.cashFree)||0)-costBase)*100)/100;
    cashMsg=` · −${pf3Money(d,cost)} ${RT('из кэша','from cash')}`;
  }
  scheduleSave();
  init();   // rebuild tabs (count badge) + re-render
  toast(t+' '+RT('добавлен','added')+cashMsg);
  // Новый тикер: сбросить суточный гейт таргетов, чтобы метрики (P/S, ROE,
  // рост…) подтянулись СРАЗУ и тип определился по скорингу, а не по грубому
  // секторному fallback (иначе SpaceX → «Циклическая» по сектору Aerospace).
  d.targetsAt=0;_tgEndpointDown=false;
  pf3RefreshTab(v3Key);   // живая цена/уровни + таргеты/метрики + пересчёт типов
  pf3FillProfile(t);    // auto-fill the company name + sector from Yahoo
}

// Auto-fill name/sector for a freshly added ticker via the worker's ?profile= endpoint.
const PF3_SECTOR_RU={'Technology':'Технологии','Healthcare':'Здравоохранение','Financial Services':'Финансы','Consumer Cyclical':'Потребительский','Consumer Defensive':'Потребительские товары','Industrials':'Промышленность','Energy':'Энергетика','Utilities':'Коммунальные услуги','Real Estate':'Недвижимость','Communication Services':'Коммуникации','Basic Materials':'Материалы'};
async function pf3FillProfile(tk){
  try{
    const d=pf3D(),r=d.rows.find(x=>String(x[2]||'').trim().toUpperCase()===tk);
    if(!r)return;
    const p=await(await fetch(PRICE_PROXY+'?profile='+encodeURIComponent(exSymbol(r[2],r[8])))).json();
    if(!p||typeof p!=='object')return;
    let ch=false;
    if(p.name&&(!r[1]||String(r[1]).trim().toUpperCase()===tk)){r[1]=p.name;ch=true;}
    if(p.sector&&(!r[4]||r[4]==='—')){r[4]=PF3_SECTOR_RU[p.sector]||p.sector;ch=true;}
    // Instrument type: ETF/fund by Yahoo quoteType, REIT→Дивидендная by industry, else by sector.
    const typ=p.type==='ETF'?'ETF':p.type==='MUTUALFUND'?'Фонд'
      :/reit/i.test(p.industry||'')?'Дивидендная'
      :pf3DeriveType(tk,String(p.sector||r[4]||''),'');
    if(r[5]!==typ){r[5]=typ;ch=true;}
    if(ch){scheduleSave();if(isV3())renderPF3();}
  }catch(e){}
}

// Удалить бумагу из текущей v3-вкладки.
function pf3Delete(tk,ev){
  if(ev)ev.stopPropagation();
  const d=pf3D(),i=d.rows.findIndex(r=>String(r[2]||'')===tk);
  if(i<0)return;
  if(!confirm(T('Удалить')+' '+tk+' ('+TAB_LABEL(v3Key)+')?'))return;
  d.rows.splice(i,1);
  d.rows.forEach((r,j)=>r[0]=j+1);
  d.count=d.rows.length;
  if(pf3Sel===tk)pf3Sel=null;
  scheduleSave();
  init();
  toast(tk+' удалён');
}

// Перерисовка блоков портфеля (их зовут ≈70 мест встроенных блоков): с S7b-3 — только Trade Desk (deskRender).
function renderPF3(){if(typeof deskRender==='function')deskRender();}

// The full card for the selected holding (everything: hero, stats, health, earnings, chart, buy levels).

// ===== 📈 Развитие портфеля (как у брокера): композит портфеля vs бенчмарки =====
// Истории всех бумаг за 3 года → дневные доходности, взвешенные ТЕКУЩИМИ долями
// позиций (приближение: состав считается неизменным), кумулятив в %.
// Бенчмарки сравниваются от начала выбранного периода. Кеш 6 часов.
// Все семейные портфели + индексы OMXS30/Nasdaq 100, цвета линий настраиваются,
// старт по умолчанию — с PF_START_DATE (range:'start'). Кеш 6 часов.
let pfPerf={range:'start',hist:null,loaded:0,loading:false,failed:false,on:{},_init:false};
const PF_START_DATE='2026-06-12';   // дата создания портфелей — точка входа для «Развития»
const PFP_BENCH=[['^GSPC','S&P 500','#ef4444'],['^NDX','Nasdaq 100','#8b8cf8'],['^OMX','OMXS30','#f5c863']];
const PFP_ALL_DEF='#22d3ee';   // цвет сводной линии «Все портфели»
const pfpPorts=()=>{
  const out=[
    {key:PF3_KEY,name:'Dima',def:'#6366f1'},
    {key:'Portfolio (Anna)',name:'Anna',def:'#10b981'},
    {key:'Portfolio (Sergei)',name:'Sergei',def:'#f59e0b'},
  ].filter(p=>DATA[p.key]&&Array.isArray(DATA[p.key].rows)&&DATA[p.key].rows.length);
  // AI-портфель — особый: линия из реальной истории капитала (equityHistory), а
  // не из цен позиций (учитывает фактические сделки и кэш).
  if(isAdmin()&&AI_PORT&&AI_PORT.startedAt&&Array.isArray(AI_PORT.equityHistory)&&AI_PORT.equityHistory.length>=2)
    out.push({key:AIP_KEY,name:'AI-Portfolio',def:'#ec4899',ai:true});
  return out;
};
function pfpColors(){try{return JSON.parse(localStorage.getItem('dash_pfpcol')||'{}')}catch(e){return{}}}
const pfpCol=(key,def)=>pfpColors()[key]||def;
function pfPerfSetColor(key,c){const m=pfpColors();m[key]=c;try{localStorage.setItem('dash_pfpcol',JSON.stringify(m))}catch(e){}renderPF3()}
const pfpOn=key=>pfPerf.on[key]!==false;
function pfPerfToggle(key){pfPerf.on[key]=!pfpOn(key);renderPF3()}
// Прошлая пятница: понедельник текущей недели − 3 дня.
function pfpLastFriday(){const n=new Date();const sinceMon=(n.getDay()+6)%7;const mon=new Date(n.getFullYear(),n.getMonth(),n.getDate()-sinceMon);return new Date(mon.getFullYear(),mon.getMonth(),mon.getDate()-3);}
function pfPerfFrom(range){
  const n=new Date();
  if(range==='start')return new Date(PF_START_DATE+'T00:00:00');   // с создания портфелей 12.06.2026
  if(range==='fri')return pfpLastFriday();
  if(range==='1m')return new Date(n-30*864e5);
  if(range==='3m')return new Date(n-91*864e5);
  if(range==='ytd')return new Date(n.getFullYear(),0,1);
  if(range==='1y')return new Date(n-365*864e5);
  return new Date(n-3*365*864e5);
}
function pfPerfPct(series,from){
  const iso=from.toISOString().slice(0,10);
  const sl=series.filter(x=>x.d>=iso);
  return sl.length<2?null:(sl[sl.length-1].v/sl[0].v-1)*100;
}
// Кумулятивная серия одного портфеля: дневные доходности позиций, взвешенные
// текущими долями (валюта не важна — доходности безразмерны).
function pfpSeriesFromPos(pos,histBy){
  const tot=pos.reduce((a,x)=>a+x.w,0);if(!(tot>0))return null;
  const byDay={};
  pos.forEach(p=>{const h=histBy[p.sym];if(!h||!Array.isArray(h.c)||h.c.length<30)return;const w=p.w/tot;
    for(let k=1;k<h.c.length;k++){if(!(h.c[k-1]>0&&h.c[k]>0))continue;const day=new Date(h.t[k]*1000).toISOString().slice(0,10);const o=byDay[day]||(byDay[day]={s:0,w:0});o.s+=(h.c[k]/h.c[k-1]-1)*w;o.w+=w;}});
  let cum=1;const ser=Object.keys(byDay).sort().filter(k=>byDay[k].w>=0.5).map(k=>{cum*=1+byDay[k].s/byDay[k].w;return{d:k,v:cum}});
  return ser.length>=5?ser:null;
}
function pfpPortSeries(key,histBy){
  const d=DATA[key];if(!d)return null;
  const pos=d.rows.map((r,i)=>{recalcPF(i,key);return{sym:exSymbol(r[2],r[8]),w:parseFloat(r[13])||0}}).filter(x=>x.sym&&x.w>0);
  return pfpSeriesFromPos(pos,histBy);
}
// 📊 Сводная линия «Все портфели»: позиции ВСЕХ моих портфелей слиты в один набор,
// взвешены текущей стоимостью (в SEK через r[13]) — единая доходность всех портфелей.
function pfpCombinedPos(){
  const pos=[];
  pfpPorts().forEach(p=>{if(p.ai)return;const d=DATA[p.key];if(!d)return;d.rows.forEach((r,i)=>{recalcPF(i,p.key);const sym=exSymbol(r[2],r[8]),w=parseFloat(r[13])||0;if(sym&&w>0)pos.push({sym,w});});});
  return pos;
}
async function pfPerfLoad(force){
  if(pfPerf.loading||(!force&&pfPerf.hist&&Date.now()-pfPerf.loaded<20*60*1000))return;   // авто-кэш 20 мин (было 6 ч)
  pfPerf.loading=true;pfPerf.failed=false;
  try{
    const ports=pfpPorts();
    const symSet=new Set();
    ports.forEach(p=>{if(p.ai||!DATA[p.key])return;DATA[p.key].rows.forEach((r,i)=>{recalcPF(i,p.key);const s=exSymbol(r[2],r[8]);if(s&&(parseFloat(r[13])||0)>0)symSet.add(s)})});
    PFP_BENCH.forEach(b=>symSet.add(b[0]));
    const syms=[...symSet];
    const res=await Promise.all(syms.map(x=>fetch(PRICE_PROXY+'?history='+encodeURIComponent(x)+'&range=3y').then(r=>r.json()).catch(()=>null)));
    const histBy={};syms.forEach((s,i)=>{histBy[s]=res[i]});
    const portsSer={};ports.forEach(p=>{
      let ser;
      if(p.ai){ser=(AI_PORT.equityHistory||[]).filter(x=>x&&x.d&&x.v>0).map(x=>({d:x.d,v:x.v}));if(ser.length<2)ser=null;}   // реальная история капитала AI
      else ser=pfpPortSeries(p.key,histBy);
      if(ser)portsSer[p.key]=ser;
    });
    const allSer=pfpSeriesFromPos(pfpCombinedPos(),histBy);   // 📊 сводная «Все портфели»
    if(allSer)portsSer['__ALL__']=allSer;
    if(!Object.keys(portsSer).length)throw new Error('no port history');
    // По умолчанию: сводная «Все портфели» + AI-Portfolio + индексы; отдельные real-портфели — выкл (можно включить).
    if(!pfPerf._init){pfpPorts().forEach(p=>{if(!p.ai)pfPerf.on[p.key]=false;});pfPerf._init=true;}
    const bench={};PFP_BENCH.forEach(b=>{const h=histBy[b[0]];if(h&&Array.isArray(h.c))bench[b[0]]=h.c.map((c,i2)=>({d:new Date(h.t[i2]*1000).toISOString().slice(0,10),v:c})).filter(x=>x.v>0)});
    pfPerf.hist={ports:portsSer,bench};pfPerf.loaded=Date.now();
  }catch(e){pfPerf.failed=true;}
  pfPerf.loading=false;
  if(isV3()&&v3Key===PF3_KEY&&pf3Tab==='stats')renderPF3();
}
function pfPerfHTML(){
  const H=pfPerf.hist;
  const ranges=[['start',RT('с создания','since start')],['fri',RT('с пт','since Fri')],['1m',RT('1 мес','1M')],['3m',RT('3 мес','3M')],['ytd',RT('в этом году','YTD')],['1y',RT('1 год','1Y')],['3y',RT('3 года','3Y')]];
  const esc=s=>String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');
  const from=pfPerfFrom(pfPerf.range);
  const chip=(key,name,def,ser)=>{
    const c=pfpCol(key,def),on=pfpOn(key);
    const p=(on&&ser)?pfPerfPct(ser,from):null;
    return`<span class="pfp-chip${on?' on':''}" style="--c:${c}"><input type="color" class="pfp-color" value="${c}" title="${RT('цвет линии','line colour')}" onclick="event.stopPropagation()" onchange="pfPerfSetColor('${esc(key)}',this.value)"><button class="pfp-chip-b" onclick="pfPerfToggle('${esc(key)}')">${name}${p!=null?` <span class="${p>=0?'pf3-up':'pf3-down'}">${(p>0?'+':'')+p.toFixed(2)}%</span>`:''}</button></span>`;
  };
  const chips=chip('__ALL__',RT('Все портфели','All portfolios'),PFP_ALL_DEF,H&&H.ports['__ALL__'])
    +pfpPorts().map(p=>chip(p.key,p.name,p.def,H&&H.ports[p.key])).join('')
    +PFP_BENCH.map(([sym,n,def])=>chip(sym,n,def,H&&H.bench[sym])).join('');
  const btn=([k,l])=>`<button class="pfp-r${pfPerf.range===k?' on':''}" onclick="pfPerfRange('${k}')">${l}</button>`;
  const upd=pfPerf.loaded?new Date(pfPerf.loaded).toLocaleTimeString(LANG==='en'?'en-GB':'ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
  return`<section class="pf3-panel pfp">
    <div class="pf3-panel-hd"><span>${RT('📈 Развитие портфелей','📈 Portfolios performance')} <button class="pf3-btn pf3-btn-sm" id="pfPerfRefBtn" onclick="pfPerfRefresh()" title="${RT('Обновить статистику: свежие цены + истории','Refresh stats: fresh prices + histories')}"${pfPerf.loading?' disabled':''}>${pfPerf.loading?'⏳':'🔄'}</button>${upd?`<small class="pfp-upd">${RT('обновлено','updated')} ${upd}</small>`:''}</span><span class="pfp-chips">${chips}</span></div>
    <div id="pfPerfBox" class="pfp-chart">${H?'':`<div class="pf3-empty">${pfPerf.loading?RT('Загружаю истории цен всех позиций…','Loading price histories…'):pfPerf.failed?RT('Не удалось загрузить истории цен','Failed to load price histories'):'…'}</div>`}</div>
    <div class="pfp-ranges">${ranges.map(btn).join('')}</div>
    <div class="pf3-risk-note">${RT('Сводная «Все портфели» (жирная) + AI-Portfolio + S&P 500 / Nasdaq 100 / OMXS30. По умолчанию старт — с создания портфелей 12.06.2026. AI-Portfolio — по реальной истории капитала; остальные — по текущему составу. Клик по названию — вкл/выкл линию, по квадрату — цвет. Видно только администратору.','«All portfolios» (bold) + AI-Portfolio + S&P 500 / Nasdaq 100 / OMXS30. Default start — portfolio creation 12 Jun 2026. AI-Portfolio uses real capital history; others use current composition. Click a name to toggle, the swatch to recolour. Admin-only.')}</div>
  </section>`;
}
function pfPerfRange(k){pfPerf.range=k;renderPF3()}
// 🏁 Сравнение всех портфелей + AI + индексов за период (из уже загруженной pfPerf.hist).
function pfCmpData(){
  const H=pfPerf.hist;if(!H)return null;
  const from=pfPerfFrom(pfPerf.range);
  const ents=[];
  const pAll=H.ports['__ALL__'];const rAll=pAll?pfPerfPct(pAll,from):null;
  if(rAll!=null)ents.push({key:'__ALL__',name:RT('Все портфели','All portfolios'),ret:rAll,kind:'all'});
  pfpPorts().forEach(p=>{const s=H.ports[p.key];if(!s)return;const r=pfPerfPct(s,from);if(r!=null)ents.push({key:p.key,name:p.name,ret:r,kind:p.ai?'ai':'port'});});
  const idx=PFP_BENCH.map(([sym,n])=>{const s=H.bench[sym];const r=s?pfPerfPct(s,from):null;return r!=null?{sym,name:n,ret:r}:null}).filter(Boolean);
  return ents.length?{ents,idx,from}:null;
}
const PFCMP_SHORT={'S&P 500':'SPX','Nasdaq 100':'NDX','OMXS30':'OMX'};
function pfCmpHTML(){
  const D=pfCmpData();if(!D)return'';
  const cls=v=>v>=0?'pf3-up':'pf3-down';
  const fmt=v=>`${v>=0?'+':''}${v.toFixed(2)}%`;
  const ico=e=>e.kind==='all'?'📊':e.kind==='ai'?'🤖':'🧑';
  const rows=D.ents.slice().sort((a,b)=>b.ret-a.ret);
  const maxAbs=Math.max(1,...D.ents.map(e=>Math.abs(e.ret)),...D.idx.map(i=>Math.abs(i.ret)));
  const lb=rows.map((e,i)=>`<div class="pfcmp-row${e.kind==='all'?' pfcmp-all':''}">
    <span class="pfcmp-rank">${i+1}</span>
    <span class="pfcmp-name">${ico(e)} ${e.name}</span>
    <span class="pfcmp-bar"><span class="pfcmp-bar-f ${e.ret>=0?'pos':'neg'}" style="width:${Math.min(100,Math.abs(e.ret)/maxAbs*100)}%"></span></span>
    <span class="pfcmp-v ${cls(e.ret)}">${fmt(e.ret)}</span>
  </div>`).join('');
  const idxRow=D.idx.map(i=>`<span class="pfcmp-idx ${cls(i.ret)}">${i.name} <b>${fmt(i.ret)}</b></span>`).join('');
  const alpha=rows.filter(e=>e.kind!=='all'||rows.length<=2).map(p=>`<div class="pfcmp-arow"><span class="pfcmp-name">${ico(p)} ${p.name}</span><span class="pfcmp-acells">${D.idx.map(i=>{const a=p.ret-i.ret;return`<span class="pfcmp-acell ${cls(a)}" title="${p.name} − ${i.name}">${PFCMP_SHORT[i.name]||i.name} ${a>=0?'+':''}${a.toFixed(1)}</span>`}).join('')}</span></div>`).join('');
  // лидер/аутсайдер + сколько обгоняют каждый индекс
  const top=rows[0],bot=rows[rows.length-1];
  const beats=D.idx.map(i=>{const n=D.ents.filter(e=>e.kind!=='all'&&e.ret>i.ret).length;return`${PFCMP_SHORT[i.name]||i.name}: ${n}/${D.ents.filter(e=>e.kind!=='all').length}`}).join(' · ');
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>🏁 ${RT('Сравнение портфелей','Portfolio leaderboard')} ${infoBtn('pfcmp')}</span><span class="pf3-asof">${RT('доходность с','return since')} ${D.from.toISOString().slice(0,10)}</span></div>
    <div class="pfcmp">${lb}</div>
    <div class="pfcmp-idxrow"><span class="pfcmp-idxlbl">${RT('Индексы','Indices')}:</span> ${idxRow}</div>
    <div class="pf3-panel-hd pfcmp-hd2"><span>🆚 ${RT('Альфа vs индексы','Alpha vs indices')}</span><span class="pf3-asof">${RT('портфель − индекс (п.п.)','portfolio − index (pp)')}</span></div>
    <div class="pfcmp-alpha">${alpha}</div>
    <div class="pfcmp-extra">🏆 ${RT('лидер','leader')}: <b>${top.name}</b> ${fmt(top.ret)} · 🐌 ${RT('аутсайдер','laggard')}: <b>${bot.name}</b> ${fmt(bot.ret)} · ${RT('спред','spread')} ${(top.ret-bot.ret).toFixed(1)} п.п. · ${RT('обгоняют индекс','beat the index')}: ${beats}</div>
    <div class="pf3-risk-note">${RT('α = доходность портфеля минус индекс за период (процентные пункты, п.п.). Положительная α = обгон. Период — с создания 12.06.2026. Видно только администратору.','α = portfolio return minus the index over the period (percentage points). Positive α = outperformance. Period — since 12 Jun 2026. Admin-only.')}</div>
  </section>`;
}
// ── Глубокое сравнение: риск-метрики, окна, вклад, перекрытие, сектора, валюты ──
function pfStd(a){if(a.length<2)return 0;const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/(a.length-1));}
function pfSeriesSlice(series,from){const iso=from.toISOString().slice(0,10);return series.filter(x=>x.d>=iso);}
function pfDailyRets(sl){const r=[];for(let i=1;i<sl.length;i++){if(sl[i-1].v>0&&sl[i].v>0)r.push(sl[i].v/sl[i-1].v-1);}return r;}
function pfRiskStats(series,from){
  const sl=pfSeriesSlice(series,from);if(sl.length<2)return null;
  const rets=pfDailyRets(sl),n=rets.length,mean=n?rets.reduce((a,b)=>a+b,0)/n:0,sd=pfStd(rets);
  const dn=n?Math.sqrt(rets.reduce((a,r)=>a+(r<0?r*r:0),0)/n):0;   // downside deviation (MAR=0)
  let peak=sl[0].v,ddf=0;sl.forEach(x=>{if(x.v>peak)peak=x.v;const d=x.v/peak-1;if(d<ddf)ddf=d;});
  const tot=sl[sl.length-1].v/sl[0].v-1,ann=sl.length>1?Math.pow(1+tot,252/sl.length)-1:tot;
  return{ret:tot*100,vol:sd*Math.sqrt(252)*100,dd:ddf*100,
    sharpe:sd>0?(mean/sd)*Math.sqrt(252):null,
    sortino:dn>0?(mean/dn)*Math.sqrt(252):null,
    calmar:ddf<0?ann/Math.abs(ddf):null,
    best:n?Math.max(...rets)*100:null,worst:n?Math.min(...rets)*100:null};
}
// Бета и захват (up/down capture) портфеля к индексу из выровненных дневных доходностей.
function pfBetaCap(ps,is,from){
  const iso=from.toISOString().slice(0,10),pm={},im={};
  ps.filter(x=>x.d>=iso).forEach(x=>pm[x.d]=x.v);is.filter(x=>x.d>=iso).forEach(x=>im[x.d]=x.v);
  const days=Object.keys(pm).filter(d=>im[d]!=null).sort(),pr=[],ir=[];
  for(let i=1;i<days.length;i++){const a=pm[days[i]]/pm[days[i-1]]-1,b=im[days[i]]/im[days[i-1]]-1;if(isFinite(a)&&isFinite(b)){pr.push(a);ir.push(b);}}
  if(pr.length<3)return null;
  const mi=ir.reduce((x,y)=>x+y,0)/ir.length,mp=pr.reduce((x,y)=>x+y,0)/pr.length;
  let cov=0,vi=0,upP=0,upI=0,dnP=0,dnI=0;
  for(let i=0;i<pr.length;i++){cov+=(pr[i]-mp)*(ir[i]-mi);vi+=(ir[i]-mi)**2;if(ir[i]>0){upP+=pr[i];upI+=ir[i];}else if(ir[i]<0){dnP+=pr[i];dnI+=ir[i];}}
  return{beta:vi>0?cov/vi:null,up:upI!==0?upP/upI*100:null,dn:dnI!==0?dnP/dnI*100:null};
}
// Корреляция дневных доходностей двух серий за период.
function pfCorr(aS,bS,from){
  const iso=from.toISOString().slice(0,10),am={},bm={};
  aS.filter(x=>x.d>=iso).forEach(x=>am[x.d]=x.v);bS.filter(x=>x.d>=iso).forEach(x=>bm[x.d]=x.v);
  const days=Object.keys(am).filter(d=>bm[d]!=null).sort(),a=[],b=[];
  for(let i=1;i<days.length;i++){const ra=am[days[i]]/am[days[i-1]]-1,rb=bm[days[i]]/bm[days[i-1]]-1;if(isFinite(ra)&&isFinite(rb)){a.push(ra);b.push(rb);}}
  if(a.length<3)return null;
  const ma=a.reduce((x,y)=>x+y,0)/a.length,mb=b.reduce((x,y)=>x+y,0)/b.length;
  let cov=0,va=0,vb=0;for(let i=0;i<a.length;i++){cov+=(a[i]-ma)*(b[i]-mb);va+=(a[i]-ma)**2;vb+=(b[i]-mb)**2;}
  return(va>0&&vb>0)?cov/Math.sqrt(va*vb):null;
}
// Концентрация: топ-5 вес и «эффективное число бумаг» (1/HHI).
function pfConcentration(rows){
  const ws=rows.map(o=>parseFloat((o.r||o)[13])||0).filter(v=>v>0);
  const tot=ws.reduce((a,b)=>a+b,0);if(!(tot>0))return null;
  const sh=ws.map(w=>w/tot).sort((a,b)=>b-a);
  const hhi=sh.reduce((a,w)=>a+w*w,0);
  return{top5:sh.slice(0,5).reduce((a,b)=>a+b,0)*100,effN:hhi>0?1/hhi:0,n:ws.length};
}
function pfWinRate(rows){const pl=rows.map(o=>parseFloat((o.r||o)[11])).filter(v=>isFinite(v));return pl.length?pl.filter(v=>v>0).length/pl.length*100:null;}
function pfInfoRatio(ps,is,from){
  const iso=from.toISOString().slice(0,10),pm={},im={};
  ps.filter(x=>x.d>=iso).forEach(x=>pm[x.d]=x.v);is.filter(x=>x.d>=iso).forEach(x=>im[x.d]=x.v);
  const days=Object.keys(pm).filter(d=>im[d]!=null).sort(),diffs=[];
  for(let i=1;i<days.length;i++){const pr=pm[days[i]]/pm[days[i-1]]-1,ir=im[days[i]]/im[days[i-1]]-1;if(isFinite(pr)&&isFinite(ir))diffs.push(pr-ir);}
  if(diffs.length<2)return null;const m=diffs.reduce((a,b)=>a+b,0)/diffs.length,sd=pfStd(diffs);
  return sd>0?(m/sd)*Math.sqrt(252):null;
}
function pfRealRows(){const out=[];pfpPorts().forEach(p=>{if(p.ai)return;const d=DATA[p.key];if(!d)return;d.rows.forEach((r,i)=>{recalcPF(i,p.key);out.push({r,port:p.name});});});return out;}
function pfDayPctOf(rows){let v=0,s=0;rows.forEach(o=>{const r=o.r||o,val=parseFloat(r[13])||0,dp=parseFloat(r[10]);if(val>0&&isFinite(dp)){v+=val*dp;s+=val;}});return s>0?v/s:null;}
function pfDeepCmpHTML(){
  const D=pfCmpData();if(!D)return'';const H=pfPerf.hist;
  const cls=v=>v>=0?'pf3-up':'pf3-down';
  const pc=(v,d)=>v==null?'—':`<span class="${cls(v)}">${v>=0?'+':''}${v.toFixed(d==null?2:d)}%</span>`;
  const ents=D.ents,from=D.from,spx=H.bench['^GSPC'];
  const realRows=pfRealRows();
  const portRows=k=>k==='__ALL__'?realRows:(DATA[k]?DATA[k].rows.map(r=>({r})):[]);
  const dayOf=e=>e.kind==='ai'?((AI_PORT&&Array.isArray(AI_PORT.equityHistory)&&AI_PORT.equityHistory.length>=2)?(AI_PORT.equityHistory.slice(-1)[0].v/AI_PORT.equityHistory.slice(-2)[0].v-1)*100:null):pfDayPctOf(portRows(e.key));
  const num2=v=>v==null?'—':v.toFixed(2);
  // 1+2) Риск-метрики: Sharpe · Sortino · Calmar · IR vs S&P 500
  const riskRows=ents.map(e=>{const st=pfRiskStats(H.ports[e.key],from);if(!st)return'';const ir=spx?pfInfoRatio(H.ports[e.key],spx,from):null;
    return`<tr><td class="bp-name">${e.name}</td><td>${pc(st.ret)}</td><td>${st.vol.toFixed(1)}%</td><td class="${st.dd<0?'pf3-down':''}">${st.dd.toFixed(1)}%</td><td><b>${num2(st.sharpe)}</b></td><td>${num2(st.sortino)}</td><td>${num2(st.calmar)}</td><td>${ir==null?'—':(ir>=0?'+':'')+ir.toFixed(2)}</td></tr>`}).join('');
  // β и захват (up/down capture) vs S&P 500
  const betaRows=ents.map(e=>{const bc=spx?pfBetaCap(H.ports[e.key],spx,from):null;if(!bc)return'';
    return`<tr><td class="bp-name">${e.name}</td><td><b>${num2(bc.beta)}</b></td><td class="${bc.up!=null&&bc.up>=100?'pf3-up':''}">${bc.up==null?'—':bc.up.toFixed(0)+'%'}</td><td class="${bc.dn==null?'':bc.dn<100?'pf3-up':'pf3-down'}">${bc.dn==null?'—':bc.dn.toFixed(0)+'%'}</td></tr>`}).join('');
  // лучший/худший день
  const bwRows=ents.map(e=>{const st=pfRiskStats(H.ports[e.key],from);if(!st)return'';return`<tr><td class="bp-name">${e.name}</td><td>${pc(st.best,2)}</td><td>${pc(st.worst,2)}</td></tr>`}).join('');
  // корреляционная матрица (портфели + индексы)
  const cE=[...ents.map(e=>({lbl:e.name,ser:H.ports[e.key]})),...D.idx.map(i=>({lbl:PFCMP_SHORT[i.name]||i.name,ser:H.bench[i.sym]}))].filter(x=>x.ser);
  const corrTint=v=>v==null?'':`background:rgba(${v>=0?'16,185,129':'239,68,68'},${Math.min(.4,Math.abs(v)*.4).toFixed(2)})`;
  const corrHead=`<tr><th></th>${cE.map(x=>`<th>${x.lbl}</th>`).join('')}</tr>`;
  const corrBody=cE.map((a,i)=>`<tr><td class="bp-name">${a.lbl}</td>${cE.map((b,j)=>{const c=i===j?1:pfCorr(a.ser,b.ser,from);return`<td style="${corrTint(c)}">${c==null?'—':c.toFixed(2)}</td>`}).join('')}</tr>`).join('');
  // концентрация + win rate (real-портфели + сводная)
  const concRows=ents.filter(e=>e.kind!=='ai').map(e=>{const rs=portRows(e.key),co=pfConcentration(rs),wr=pfWinRate(rs);if(!co)return'';
    return`<tr><td class="bp-name">${e.name}</td><td>${co.n}</td><td>${co.top5.toFixed(0)}%</td><td><b>${co.effN.toFixed(1)}</b></td><td>${wr==null?'—':wr.toFixed(0)+'%'}</td></tr>`}).join('');
  // 6) Окна
  const winRows=ents.map(e=>`<tr><td class="bp-name">${e.name}</td><td>${pc(dayOf(e),2)}</td><td>${pc(pfPerfPct(H.ports[e.key],pfPerfFrom('fri')),2)}</td><td><b>${pc(e.ret,2)}</b></td></tr>`).join('');
  // 5) Вклад в доходность (по прибыли SEK с покупки ≈ с создания)
  const withPL=realRows.map(o=>({tk:String(o.r[2]||''),name:String(o.r[1]||o.r[2]||''),port:o.port,pl:parseFloat(o.r[11])||0,plp:parseFloat(o.r[12])})).filter(x=>x.tk);
  const win=withPL.slice().sort((a,b)=>b.pl-a.pl).slice(0,5),los=withPL.slice().sort((a,b)=>a.pl-b.pl).slice(0,5).filter(x=>x.pl<0);
  const contribRow=x=>`<div class="pfcmp-row"><span class="pfcmp-name">${x.name} <span class="bp-tk">${x.tk}</span> <small>${x.port}</small></span><span class="pfcmp-v ${cls(x.pl)}">${x.pl>=0?'+':''}${pf3Fmt(x.pl)} kr${isFinite(x.plp)?` · ${x.plp>=0?'+':''}${x.plp.toFixed(1)}%`:''}</span></div>`;
  // 3) Перекрытие портфелей
  const byTk={};realRows.forEach(o=>{const tk=String(o.r[2]||'').toUpperCase();if(!tk)return;const val=parseFloat(o.r[13])||0;(byTk[tk]=byTk[tk]||{tk,name:String(o.r[1]||tk),ports:new Set(),val:0});byTk[tk].ports.add(o.port);byTk[tk].val+=val;});
  const overlap=Object.values(byTk).filter(x=>x.ports.size>=2).sort((a,b)=>b.ports.size-a.ports.size||b.val-a.val).slice(0,12);
  const ovRow=x=>`<div class="pfcmp-row"><span class="pfcmp-name">${x.name} <span class="bp-tk">${x.tk}</span></span><span class="pfcmp-acells">${[...x.ports].map(p=>`<span class="pfcmp-acell">${p}</span>`).join('')}</span><span class="pfcmp-v">${pf3Fmt(x.val)} kr</span></div>`;
  // 4) Сектора: портфели (по стоимости) vs индексы (по числу бумаг — aiBenchmarks)
  const psec={};let pt=0;realRows.forEach(o=>{const s=String(o.r[4]||'').trim(),val=parseFloat(o.r[13])||0;if(s&&s!=='—'&&val>0){psec[s]=(psec[s]||0)+val;pt+=val;}});
  const pSecTop=Object.entries(psec).map(([s,v])=>({s,pct:pt?v/pt*100:0})).sort((a,b)=>b.pct-a.pct).slice(0,8);
  const bm=(typeof aiBenchmarks==='function')?aiBenchmarks():[];
  const secCol=(title,arr)=>`<div class="pfcmp-seccol"><div class="pfcmp-sech">${title}</div>${arr.map(x=>`<div class="pfcmp-secrow"><span>${x.s||x.sector}</span><b>${(x.pct).toFixed(1)}%</b></div>`).join('')||'<div class="pf3-empty">—</div>'}</div>`;
  const secCols=secCol(RT('Портфели (по стоимости)','Portfolios (by value)'),pSecTop)+bm.slice(0,2).map(b=>secCol(b.index+RT(' (по числу)',' (by count)'),b.sectors)).join('');
  // 7) Валютная структура
  const cur={};let ct=0;realRows.forEach(o=>{const c=String(o.r[8]||'').toUpperCase(),val=parseFloat(o.r[13])||0;if(c&&val>0){cur[c]=(cur[c]||0)+val;ct+=val;}});
  const curArr=Object.entries(cur).map(([c,v])=>({c,pct:ct?v/ct*100:0})).sort((a,b)=>b.pct-a.pct);
  const curRow=curArr.map(x=>`<span class="pfcmp-idx">${x.c} <b>${x.pct.toFixed(0)}%</b></span>`).join(' ');
  const det=(title,body,open)=>`<details class="pfcmp-det"${open?' open':''}><summary>${title}</summary><div class="pfcmp-detbody">${body}</div></details>`;
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>🔬 ${RT('Глубокое сравнение','Deep comparison')} ${infoBtn('pfdeep')}</span><span class="pf3-asof">${RT('всё за период · только админ','over the period · admin-only')}</span></div>
    ${det('📉 '+RT('Риск-метрики (Sharpe · Sortino · Calmar · IR)','Risk metrics (Sharpe · Sortino · Calmar · IR)'),`<table class="bp-tbl pfcmp-tbl"><thead><tr><th>${RT('Портфель','Portfolio')}</th><th>${RT('Доходн.','Return')}</th><th>${RT('Волат.','Vol')}</th><th>${RT('Просадка','DD')}</th><th>Sharpe</th><th>Sortino</th><th>Calmar</th><th>IR</th></tr></thead><tbody>${riskRows}</tbody></table><div class="pf3-risk-note">${RT('Годовые (×√252), rf=0. Sharpe — на единицу общего риска; Sortino — только просадочного; Calmar — годовая доходн./макс.просадку; IR — альфа к S&P 500 / tracking error. >1 (Sharpe/Sortino), >0 (IR) — хорошо. Окно короткое (с 12.06) → шумно, индикативно.','Annualized (×√252), rf=0. Sharpe — per total risk; Sortino — downside only; Calmar — annual return/max drawdown; IR — alpha vs S&P 500 / tracking error. >1 (Sharpe/Sortino), >0 (IR) is good. Short window (since 12 Jun) → noisy, indicative.')}</div>`,true)}
    ${det('📐 '+RT('Бета и захват (vs S&P 500)','Beta & capture (vs S&P 500)'),`<table class="bp-tbl pfcmp-tbl"><thead><tr><th>${RT('Портфель','Portfolio')}</th><th>β</th><th>${RT('Захват ↑','Up capture')}</th><th>${RT('Захват ↓','Down capture')}</th></tr></thead><tbody>${betaRows}</tbody></table><div class="pf3-risk-note">${RT('β — чувствительность к индексу (1 = как рынок, >1 резче). Захват ↑ >100% = на росте индекса портфель растёт сильнее; захват ↓ <100% = на падении падает слабее (идеал — высокий ↑, низкий ↓).','β — sensitivity to the index (1 = like the market, >1 sharper). Up capture >100% = rises more than the index on up days; down capture <100% = falls less on down days (ideal — high ↑, low ↓).')}</div>`)}
    ${det('🔗 '+RT('Корреляция (портфели + индексы)','Correlation (portfolios + indices)'),`<div class="pfcmp-corrwrap"><table class="bp-tbl pfcmp-corr"><thead>${corrHead}</thead><tbody>${corrBody}</tbody></table></div><div class="pf3-risk-note">${RT('Корреляция дневных доходностей. 1 — двигаются одинаково, 0 — независимо, <0 — противоположно. Низкая корреляция между портфелями = реальная диверсификация.','Correlation of daily returns. 1 — move together, 0 — independent, <0 — opposite. Low correlation between portfolios = real diversification.')}</div>`)}
    ${det('🎯 '+RT('Концентрация и win-rate','Concentration & win-rate'),`<table class="bp-tbl pfcmp-tbl"><thead><tr><th>${RT('Портфель','Portfolio')}</th><th>${RT('Бумаг','Names')}</th><th>${RT('Топ-5 вес','Top-5 wt')}</th><th>${RT('Эфф. число','Eff. N')}</th><th>Win-rate</th></tr></thead><tbody>${concRows}</tbody></table><div class="pf3-risk-note">${RT('Топ-5 вес — доля 5 крупнейших позиций. Эфф. число бумаг (1/HHI) — сколько «равных» позиций по факту (ниже фактического числа = концентрация). Win-rate — доля прибыльных позиций.','Top-5 weight — share of the 5 largest positions. Effective # of holdings (1/HHI) — how many «equal» positions in effect (below the raw count = concentration). Win-rate — share of profitable positions.')}</div>`)}
    ${det('⚡ '+RT('Лучший / худший день','Best / worst day'),`<table class="bp-tbl pfcmp-tbl"><thead><tr><th>${RT('Портфель','Portfolio')}</th><th>${RT('Лучший день','Best day')}</th><th>${RT('Худший день','Worst day')}</th></tr></thead><tbody>${bwRows}</tbody></table>`)}
    ${det('📅 '+RT('По окнам (день · неделя · с создания)','By window (day · week · since start)'),`<table class="bp-tbl pfcmp-tbl"><thead><tr><th>${RT('Портфель','Portfolio')}</th><th>${RT('День','Day')}</th><th>${RT('Неделя','Week')}</th><th>${RT('С создания','Since start')}</th></tr></thead><tbody>${winRows}</tbody></table>`)}
    ${det('🥇 '+RT('Вклад в доходность — лидеры и аутсайдеры','Contribution — winners & losers'),`<div class="pfcmp-two"><div><div class="pfcmp-sech pf3-up">▲ ${RT('Дали больше всего','Top winners')}</div>${win.map(contribRow).join('')||'—'}</div><div><div class="pfcmp-sech pf3-down">▼ ${RT('Съели больше всего','Top losers')}</div>${los.length?los.map(contribRow).join(''):`<div class="pf3-empty">${RT('убыточных нет','no losers')}</div>`}</div></div><div class="pf3-risk-note">${RT('По прибыли в kr с момента покупки (≈ с создания портфелей).','By profit in kr since purchase (≈ since portfolio creation).')}</div>`)}
    ${det('🧩 '+RT('Перекрытие портфелей (общие бумаги)','Portfolio overlap (shared holdings)'),overlap.length?overlap.map(ovRow).join(''):`<div class="pf3-empty">${RT('Общих бумаг между портфелями нет','No shared holdings')}</div>`)}
    ${det('🏭 '+RT('Сектора: портфели vs индексы','Sectors: portfolios vs indices'),`<div class="pfcmp-sec">${secCols}</div><div class="pf3-risk-note">${RT('Портфели — доля по стоимости; индексы — доля по ЧИСЛУ бумаг (разные базы, таксономия секторов может отличаться) — для грубого ориентира перевеса/недовеса.','Portfolios — share by value; indices — share by NUMBER of stocks (different bases; sector taxonomy may differ) — a rough over/under-weight guide.')}</div>`)}
    ${det('💱 '+RT('Валютная структура (все портфели)','Currency mix (all portfolios)'),`<div class="pfcmp-idxrow">${curRow||'—'}</div><div class="pf3-risk-note">${RT('Доля активов по валютам (по стоимости). Точное разложение «доходность от акций vs от FX» требует истории курсов (пока не хранится) — могу добавить отдельно.','Asset share by currency (by value). A precise «stock vs FX» return split needs FX-rate history (not stored yet) — can be added separately.')}</div>`)}
  </section>`;
}
let _pfPerfChart=null;
// 🔄 Ручное обновление статистики: свежие цены текущего портфеля + перетянуть истории.
let _pfPerfRefreshing=false;
async function pfPerfRefresh(){
  if(_pfPerfRefreshing)return;_pfPerfRefreshing=true;
  const btn=document.getElementById('pfPerfRefBtn');if(btn){btn.disabled=true;btn.textContent='⏳';}
  try{await pf3RefreshTab(v3Key)}catch(e){}   // свежие цены → веса/вклад/концентрация/валюты
  pfPerf.loaded=0;
  await pfPerfLoad(true);                  // принудительно перетянуть истории/индексы
  _pfPerfRefreshing=false;
  if(isV3()&&v3Key===PF3_KEY&&pf3Tab==='stats')renderPF3();
}
async function pfPerfDraw(){
  if(!(isV3()&&v3Key===PF3_KEY&&pf3Tab==='stats'))return;
  pfPerfLoad();   // авто-обновление при устаревании кэша (>20 мин); само перерисует
  if(!pfPerf.hist)return;
  const box=document.getElementById('pfPerfBox');
  if(!box)return;
  try{await loadLWC()}catch(e){return}
  const LWC=window.LightweightCharts;
  if(!LWC||!LWC.createChart||!LWC.LineSeries)return;
  if(_pfPerfChart){try{_pfPerfChart.remove()}catch(e){}_pfPerfChart=null}
  box.innerHTML='';
  const dark=(document.documentElement.dataset.theme||'light')==='dark';
  const chart=LWC.createChart(box,{width:box.clientWidth||800,height:250,
    layout:{background:{color:'transparent'},textColor:dark?'#8a8a96':'#64748b',fontSize:10},
    grid:{vertLines:{visible:false},horzLines:{color:dark?'#ffffff12':'#0000000d'}},
    rightPriceScale:{borderVisible:false},timeScale:{borderVisible:false},
    crosshair:{horzLine:{visible:false}}});
  const from=pfPerfFrom(pfPerf.range).toISOString().slice(0,10);
  const mk=ser=>{const sl=ser.filter(x=>x.d>=from);if(sl.length<2)return null;const b=sl[0].v;return sl.map(x=>({time:x.d,value:(x.v/b-1)*100}))};
  const fmt={type:'custom',formatter:v=>v.toFixed(1)+'%'};
  // Сводная «Все портфели» — жирной линией поверх остальных.
  if(pfpOn('__ALL__')){const ser=pfPerf.hist.ports['__ALL__'],dd=ser&&mk(ser);if(dd)chart.addSeries(LWC.LineSeries,{color:pfpCol('__ALL__',PFP_ALL_DEF),lineWidth:3.5,priceFormat:fmt}).setData(dd);}
  pfpPorts().forEach(p=>{if(!pfpOn(p.key))return;const ser=pfPerf.hist.ports[p.key],dd=ser&&mk(ser);if(dd)chart.addSeries(LWC.LineSeries,{color:pfpCol(p.key,p.def),lineWidth:2,priceFormat:fmt}).setData(dd);});
  PFP_BENCH.forEach(([sym,,def])=>{if(!pfpOn(sym))return;const ser=pfPerf.hist.bench[sym],dd=ser&&mk(ser);if(dd)chart.addSeries(LWC.LineSeries,{color:pfpCol(sym,def),lineWidth:1.5,priceFormat:fmt,priceLineVisible:false,lastValueVisible:false}).setData(dd);});
  chart.timeScale().fitContent();
  _pfPerfChart=chart;
}

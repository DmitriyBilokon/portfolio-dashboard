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

// Portfolio summary strip: total value (stocks + cash), profit, editable free
// cash (stored in pf3D().cash, synced) and live exchange rates.
function pf3Summary(){
  const d=pf3D();
  let totalVal=0,totalProfit=0;
  d.rows.forEach((r,i)=>{recalcPF(i,v3Key);totalVal+=parseFloat(r[13])||0;totalProfit+=parseFloat(r[11])||0});
  const cost=totalVal-totalProfit;
  const pct=cost>0?totalProfit/cost*100:0;
  const unit=pf3BaseUnit(d);
  const isDima=v3Key===PF3_KEY;                    // плечо — только в портфеле Dima
  const free=parseFloat(d.cashFree)||0;            // уже в базовой валюте вкладки
  const lev=isDima?(parseFloat(d.leverage)||0):0;
  const totalValB=pf3Cv(d,totalVal),totalProfitB=pf3Cv(d,totalProfit);
  const realizedSEK=pfTotalRealizedSEK(v3Key);                  // реализованный P/L по журналу продаж (SEK)
  const allTimeSEK=totalProfit+realizedSEK,allTimeB=pf3Cv(d,allTimeSEK),realizedB=pf3Cv(d,realizedSEK);
  const allTimeCost=cost+pfTotalRealizedCostSEK(v3Key);         // себестоимость текущих + проданных лотов
  const allTimePct=allTimeCost>0?allTimeSEK/allTimeCost*100:0;  // P/L за всё время в % от всех вложений
  const equity=totalValB+free;   // чистый капитал в базовой валюте: акции + свободный кэш
  const withLev=equity+lev;      // покупательная способность с кредитным плечом
  const num=(key,val,cls)=>`<input class="pf3-cash-input${cls?' '+cls:''}" type="number" step="any" min="0" value="${val}" onchange="pf3SetNum('${key}',this.value)" title="Нажмите, чтобы изменить">`;
  const fxChip=c=>typeof FX[c]==='number'?`<span class="pf3-chip">1 ${c} = <b>${(+FX[c]).toFixed(2)}</b> kr</span>`:'';
  const cards=[
    {id:'equity',html:`<div class="pf3-card pf3-sum-hero" data-eid="equity"><div class="pf3-card-l">${T('Чистый капитал')}</div><div class="pf3-card-v">${pf3Fmt(equity)} ${unit}</div><div class="pf3-card-s">${T('акции + свободный кэш')}</div></div>`},
    {id:'stocks',html:`<div class="pf3-card" data-eid="stocks"><div class="pf3-card-l">${T('Акции')}</div><div class="pf3-card-v">${pf3Fmt(totalValB)} ${unit}</div><div class="pf3-card-s">${d.rows.length} ${T('позиций')} · ${equity>0?(totalValB/equity*100).toFixed(1):'—'}%</div></div>`},
    {id:'profit',html:`<div class="pf3-card" data-eid="profit"><div class="pf3-card-l">${T('Прибыль')}</div><div class="pf3-card-v ${totalProfit>=0?'pf3-up':'pf3-down'}">${totalProfit>0?'+':''}${pf3Fmt(totalProfitB)} ${unit}</div><div class="pf3-card-s ${pct>=0?'pf3-up':'pf3-down'}">${pct>0?'+':''}${pct.toFixed(1)}% ${T('от вложений')}</div></div>`},
    {id:'alltime',html:`<div class="pf3-card" data-eid="alltime"><div class="pf3-card-l">${RT('P/L всё время','All-time P/L')}</div><div class="pf3-card-v ${allTimeSEK>=0?'pf3-up':'pf3-down'}">${allTimeSEK>0?'+':''}${pf3Fmt(allTimeB)} ${unit}</div><div class="pf3-card-s ${allTimePct>=0?'pf3-up':'pf3-down'}">${allTimePct>0?'+':''}${allTimePct.toFixed(1)}% ${RT('от всех вложений','on all invested')}${realizedSEK?` · ${realizedSEK>0?'+':''}${pf3Fmt(realizedB)} ${RT('реализ.','realized')}`:''}</div></div>`},
    {id:'cash',html:`<div class="pf3-card" data-eid="cash"><div class="pf3-card-l">${T('Свободный кэш')}</div><div class="pf3-card-v">${num('cashFree',free)} <small>${unit}</small></div><div class="pf3-card-s">${equity>0&&free>0?(free/equity*100).toFixed(1)+'% '+T('% капитала · доступно для покупок').replace('% of equity','of equity').replace('% капитала','капитала'):T('нажмите, чтобы изменить')}</div></div>`},
  ];
  if(isDima){
    cards.push({id:'lev',html:`<div class="pf3-card" data-eid="lev"><div class="pf3-card-l">${T('Кредитное плечо')}</div><div class="pf3-card-v">${lev>0?'+':''}${num('leverage',lev)} <small>${unit}</small></div><div class="pf3-card-s">${T('доступный кредит сверх капитала')}</div></div>`});
    cards.push({id:'levavail',html:`<div class="pf3-card" data-eid="levavail"><div class="pf3-card-l">${T('Доступно с плечом')}</div><div class="pf3-card-v">${pf3Fmt(withLev)} ${unit}</div><div class="pf3-card-s">${T('капитал + кредитное плечо')}</div></div>`});
  }
  return`<section class="pf3-summary" data-edit-row="cards">${eapply('cards',cards).map(c=>c.html).join('')}</section>
  <div id="pfSumPP" class="pf3-pp pfsum-pp">${pfSumPPInner(pf3D())}</div>
  <div class="pf3-fx"><span class="pf3-fx-l">${T('💱 Курсы')}</span>${fxChip('USD')+fxChip('EUR')+fxChip('NOK')+fxChip('DKK')}<span class="pf3-fx-note">${RT('курсы ECB · база SEK','ECB rates · SEK base')}${fxFreshLbl()}</span></div>`;
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
  try{
    const d=pf3D();
    const syms=[...new Set(d.rows.map(r=>exSymbol(r[2],r[8])).filter(Boolean))];
    // Чанки (лимит подзапросов Cloudflare) загружаются параллельно.
    const chunks=[];
    for(let i=0;i<syms.length;i+=40)chunks.push(syms.slice(i,i+40).join(','));
    const parts=await Promise.all(chunks.map(c=>fetch(PRICE_PROXY+'?calendar='+encodeURIComponent(c)).then(r=>r.json()).catch(()=>null)));
    const j=Object.assign({},...parts.filter(p=>p&&typeof p==='object'&&!p.error));
    if(Object.keys(j).length){pf3Cal.data=j;pf3Cal.loaded=Date.now();pf3Cal.key=v3Key;}
    else pf3Cal.failed=true;
  }catch(e){pf3Cal.failed=true;}
  pf3Cal.loading=false;
  if(isV3()&&pf3Tab==='cal')renderPF3();
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
    cells+=`<div class="cal-cell${iso===todayIso?' today':''}${es.length?' has':''}"><span class="cal-d">${day}</span>${es.map(e=>`<span class="cal-ev" title="${e.t}" onclick="simOpen('${e.tk}')">${e.ico} ${e.tk}</span>`).join('')}</div>`;
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
function pf3Select(tk){
  pf3Sel=(pf3Sel===tk?null:tk);
  // Clicking a stock inside «Структура» (Сектора/Тип) opens its card in the list view.
  if(pf3Sel&&pf3Tab==='alloc'){pf3Tab='list';renderAll();return}
  renderPF3();
}

// Compact buy/sell signal for the list: which technical level the price sits near.
// ±2% of SMA/support → buy (докупка), ±2% of resistance → sell; otherwise the
// nearest buy level below with its distance. Mirrors the card's «Уровни покупки».
// Data half: {type:'buy'|'sell'|'wait'|'below'|'none', n: level name, v: level
// value, dist: % from the level}. Used by the list badge and the Home widgets.
function pf3SignalInfo(d,r){
  const h=d.headers,{s50,s100,s200}=smaIdx(d);
  const supC=h.indexOf('Поддержка'),resC=h.indexOf('Сопротивление');
  const price=parseFloat(r[7])||0;
  const lv=[['SMA 50',s50,'buy'],['SMA 100',s100,'buy'],['SMA 200',s200,'buy'],['Поддержка',supC,'buy'],['Сопр.',resC,'sell']]
    .map(([n,i,t])=>({n,t,v:i>=0?parseFloat(r[i]):NaN}))
    .filter(x=>isFinite(x.v)&&x.v>0);
  if(!(price>0)||!lv.length)return{type:'none'};
  let best=null;
  lv.forEach(x=>{const dist=(price-x.v)/x.v*100;if(!best||Math.abs(dist)<Math.abs(best.dist))best={...x,dist}});
  if(Math.abs(best.dist)<=2)return{type:best.t,n:best.n,v:best.v,dist:best.dist};
  const below=lv.filter(x=>x.t==='buy'&&x.v<price).sort((a,b)=>b.v-a.v)[0];
  if(below)return{type:'wait',n:below.n,v:below.v,dist:(price-below.v)/price*100};
  return{type:'below'};
}
function pf3RowSignal(d,r){
  const s=pf3SignalInfo(d,r);
  const sgn=v=>`${v>=0?'+':'−'}${Math.abs(v).toFixed(1)}%`;
  if(s.type==='sell')return`<span class="pf3-sig pf3-sig-sell">🔴 ${T('Продажа')} · ${T(s.n)} ${sgn(s.dist)}</span>`;
  if(s.type==='buy')return`<span class="pf3-sig pf3-sig-buy">🟢 ${(parseFloat(r[6])||0)>0?T('Докупка'):T('Покупка')} · ${T(s.n)} ${sgn(s.dist)}</span>`;
  if(s.type==='wait')return`<span class="pf3-sig pf3-sig-wait">⏳ ${T(s.n)} −${s.dist.toFixed(1)}%</span>`;
  if(s.type==='below')return`<span class="pf3-sig pf3-sig-warn">🔻 ${T('ниже уровней')}</span>`;
  return'<span class="pf3-sig pf3-sig-none">—</span>';
}

// Market-phase criterion — one badge per stock, technical + fundamental:
// 🔪 падающий нож (below all SMAs on a sharp drop / broken support),
// 🌡 перегрев (price above the analyst consensus target or ≥30% over SMA 200),
// 🚀 импульс (strong day move with trend support), 💎 недооценка (≥25% upside
// to target), then trend phases: аптренд / коррекция / разворот / даунтренд.
// rank orders the phases bearish→bullish so the column sorts meaningfully.
function pf3Criterion(d,r){
  const h=d.headers,{s50,s100,s200}=smaIdx(d);
  const g=i=>i>=0?(parseFloat(r[i])||0):0;
  const p=parseFloat(r[7])||0,day=parseFloat(r[10])||0;
  const a50=g(s50),a100=g(s100),a200=g(s200),sup=g(h.indexOf('Поддержка'));
  const B=(rank,cls,ico,label)=>({rank,cls,ico,label,html:`<span class="pf3-crit ${cls}">${ico} ${T(label)}</span>`});
  if(!(p>0)||!(a50>0)||!(a200>0))return{rank:3,cls:'flat',ico:'',label:'—',html:'<span class="pf3-crit flat">—</span>'};
  // Перегрев по таргету считаем от ЭФФЕКТИВНОГО таргета (свежий «Таргет 3м» при
  // устаревшем «Аналит. таргет»), чтобы бейдж не противоречил отображаемому потенциалу.
  const upTg=pf3EffUpside(d,r);
  const belowAll=p<a50&&(!(a100>0)||p<a100)&&p<a200;
  const aboveAll=p>a50&&(!(a100>0)||p>a100)&&p>a200;
  if(belowAll&&(day<=-3||(sup>0&&p<sup)))return B(0,'knife','🔪','Падающий нож');
  if(upTg!==null&&upTg<=-5)return B(8,'heat','🌡','Перегрев');
  if(aboveAll&&p>a200*1.3)return B(8,'heat','🌡','Перегрев');
  if((day>=2.5&&p>a50)||day>=4)return B(7,'imp','🚀','Импульс');
  if(upTg!==null&&upTg>=25&&!belowAll)return B(5,'undr','💎','Недооценка');
  if(aboveAll)return B(6,'up','📈','Аптренд');
  if(belowAll)return B(1,'down','📉','Даунтренд');
  if(p<a50&&p>=a200)return B(2,'corr','⚠️','Коррекция');
  if(p>=a50&&p<a200)return B(4,'rev','🔄','Разворот');
  return B(3,'flat','⚖️','Боковик');
}

// ── 💡 Рекомендация по акции: Покупать / Продавать / Ждать / Не приближаться ──
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

// Детерминированный скоринг по трём группам факторов из уже загруженных данных:
// фундаментал (таргет, ROE, рост, D/E, P/E к сектору), техника (фаза рынка +
// сигнал у уровня), риск (спекулятивный профиль, beta, P/S, масштаб бизнеса).
function pf3Reco(d,r){
  const m=pf3TypeMetrics(d,r);
  const price=parseFloat(r[7])||0;
  const tgC=d.headers.findIndex(x=>/аналит/i.test(x));
  const target=tgC>=0?parseFloat(r[tgC]):NaN;
  const up=pf3EffUpside(d,r);   // потенциал: устаревший таргет → берём свежий «Таргет 3м»
  const crit=pf3Criterion(d,r),sig=pf3SignalInfo(d,r);
  const tf=pf3TypeFull(d,r);
  const spec=(tf&&(tf.primary==='Спекулятивная'||tf.secondary==='Спекулятивная'))||r[5]==='Спекулятивная';
  const avg=PF3_VAL_AVG[pf3MacroSector(String(r[4]||''))]||[22,3];
  const F=[],TT=[],R=[];let fs=0,ts=0,rs=0;
  const push=(arr,pts,ru,en)=>{arr.push({pts,txt:RT(ru,en)});return pts};
  // Фундаментал
  // ⚠ Ловушка устаревшего таргета: большой апсайд при даунтренде/падающем ноже = таргет, вероятно,
  // ещё не срезали под обвалившуюся цену. Не награждаем как недооценку — помечаем риск.
  const staleTrap=(crit.cls==='knife'||crit.cls==='down');
  if(up!=null){
    if(up>=25){ if(staleTrap)fs+=push(F,-0.5,`апсайд +${up.toFixed(0)}% к ВОЗМОЖНО устаревшему таргету (даунтренд)`,`+${up.toFixed(0)}% upside to a possibly STALE target (downtrend)`); else fs+=push(F,2,`потенциал к таргету +${up.toFixed(0)}%`,`+${up.toFixed(0)}% upside to target`); }
    else if(up>=10){ if(staleTrap)fs+=push(F,0,`апсайд +${up.toFixed(0)}%, но даунтренд — таргет под вопросом`,`+${up.toFixed(0)}% upside, but downtrend — target questionable`); else fs+=push(F,1,`потенциал к таргету +${up.toFixed(0)}%`,`+${up.toFixed(0)}% upside to target`); }
    else if(up<=-5)fs+=push(F,-1.5,`цена выше таргета на ${(-up).toFixed(0)}%`,`price ${(-up).toFixed(0)}% above target`);
    else fs+=push(F,0,`таргет ≈ цена (${up>=0?'+':''}${up.toFixed(0)}%)`,`target ≈ price (${up>=0?'+':''}${up.toFixed(0)}%)`);
  }
  if(m.roe!=null){
    if(m.roe>=15)fs+=push(F,1,`рентабельна: ROE ${m.roe.toFixed(0)}%`,`profitable: ROE ${m.roe.toFixed(0)}%`);
    else if(m.roe<0)fs+=push(F,-1.5,`убыточна: ROE ${m.roe.toFixed(0)}%`,`loss-making: ROE ${m.roe.toFixed(0)}%`);
  }
  if(m.revg!=null){
    if(m.revg>=10)fs+=push(F,1,`выручка растёт +${m.revg.toFixed(0)}% г/г`,`revenue +${m.revg.toFixed(0)}% YoY`);
    else if(m.revg<0)fs+=push(F,-0.5,`выручка падает ${m.revg.toFixed(0)}% г/г`,`revenue ${m.revg.toFixed(0)}% YoY`);
  }
  if(m.de!=null&&m.de>2)fs+=push(F,-0.5,`высокий долг: D/E ${m.de.toFixed(1)}`,`high debt: D/E ${m.de.toFixed(1)}`);
  if(m.pe!=null&&m.pe>0){
    if(m.pe<=avg[0])fs+=push(F,0.5,`P/E ${m.pe.toFixed(0)} ≤ сектора (~${avg[0]})`,`P/E ${m.pe.toFixed(0)} ≤ sector (~${avg[0]})`);
    else if(m.pe>=avg[0]*1.5)fs+=push(F,-1,`P/E ${m.pe.toFixed(0)} ≫ сектора (~${avg[0]})`,`P/E ${m.pe.toFixed(0)} ≫ sector (~${avg[0]})`);
  }
  // Техника
  const PH={'Падающий нож':-2.5,'Даунтренд':-1.5,'Коррекция':-0.5,'Боковик':0,'Разворот':0.5,'Аптренд':1.5,'Импульс':1,'Перегрев':-1.5,'Недооценка':0.5};
  if(crit.label in PH)ts+=push(TT,PH[crit.label],`фаза: ${crit.ico} ${crit.label}`,`phase: ${crit.ico} ${crit.label==='Падающий нож'?'Falling knife':crit.label==='Даунтренд'?'Downtrend':crit.label==='Коррекция'?'Correction':crit.label==='Боковик'?'Sideways':crit.label==='Разворот'?'Reversal':crit.label==='Аптренд'?'Uptrend':crit.label==='Импульс'?'Momentum':crit.label==='Перегрев'?'Overheated':'Undervalued'}`);
  if(sig.type==='buy')ts+=push(TT,1.5,`цена у уровня покупки ${sig.n}`,`price at buy level ${sig.n}`);
  else if(sig.type==='sell')ts+=push(TT,-1.5,'цена у сопротивления — зона фиксации','price at resistance — take-profit zone');
  else if(sig.type==='wait')ts+=push(TT,0,`до уровня ${sig.n} ещё −${sig.dist.toFixed(1)}%`,`${sig.dist.toFixed(1)}% above level ${sig.n}`);
  else if(sig.type==='below')ts+=push(TT,-1,'цена ниже всех уровней поддержки','price below all support levels');
  // 📰 Новостной фон (живые заголовки Yahoo, если подгружены в карточке)
  const _nv=NEWS_LIVE[String(r[2]||'').toUpperCase()];
  if(_nv&&_nv.items&&_nv.items.length){
    if(_nv.sent>=2)ts+=push(TT,1,`позитивный новостной фон (+${_nv.sent})`,`positive news flow (+${_nv.sent})`);
    else if(_nv.sent<=-2)ts+=push(TT,-1,`негативный новостной фон (${_nv.sent})`,`negative news flow (${_nv.sent})`);
  }
  // Риск
  if(spec)rs+=push(R,-1.5,'спекулятивный профиль','speculative profile');
  if(m.beta!=null&&m.beta>1.5)rs+=push(R,-0.5,`высокая волатильность: β ${m.beta.toFixed(1)}`,`high volatility: β ${m.beta.toFixed(1)}`);
  if(m.ps!=null&&m.ps>=20)rs+=push(R,-1,`экстремальная оценка: P/S ${m.ps.toFixed(0)}`,`extreme valuation: P/S ${m.ps.toFixed(0)}`);
  if(m.rev!=null&&m.cap!=null&&m.rev<1e8&&m.cap>1e9)rs+=push(R,-0.5,'крошечная выручка при большой кап-и','tiny revenue vs market cap');
  if(!R.length)push(R,0,'особых красных флагов нет','no specific red flags');
  // Вердикт
  const total=fs+ts+rs,knife=crit.label==='Падающий нож';
  const noData=up==null&&m.roe==null&&m.pe==null&&m.beta==null;
  let v,hint;
  if(noData){v='wait';hint=RT('недостаточно данных — нажмите 🔄 Обновить акции','not enough data — press 🔄 Refresh stocks');}
  else if((spec&&ts+rs<=-2)||(total<=-4.5&&rs<0)){v='avoid';hint=RT('высокий риск и слабые факторы — лучше пропустить','high risk and weak factors — better to skip');}
  else if(knife){v='wait';hint=RT('падающий нож — дождитесь стабилизации у поддержки','falling knife — wait for stabilisation at support');}
  else if(total<=-2){v='sell';hint=RT('перевес негативных факторов — фиксируйте или сокращайте','negative factors dominate — take profit or trim');}
  else if(total>=2.5&&fs>=0.5&&ts>=0){v='buy';hint=RT('фундаментал и техника за вход','fundamentals and technicals favour an entry');}
  else{v='wait';hint=RT('факторы смешанные — дождитесь уровня или подтверждения тренда','mixed factors — wait for a level or trend confirmation');}
  return{v,hint,total,fs,ts,rs,F,T:TT,R};
}
// Детерминированная рекомендация по ТРЁМ горизонтам из уже собранных метрик
// (без AI/токенов): ⏱ Момент (сейчас) · 📅 6–9 мес · 🚀 Лонг (12+ мес).
// Для КАЖДОГО горизонта — свой разбор Фундаментал / Техника / Риск (F/T/R) и вердикт.
function pf3RecoHorizons(d,r){
  const price=parseFloat(r[7])||0,m=pf3TypeMetrics(d,r);
  const crit=pf3Criterion(d,r),sig=pf3SignalInfo(d,r);
  const up=pf3EffUpside(d,r),eff=pf3EffTarget(d,r);
  const {s50,s100,s200}=smaIdx(d),h=d.headers;
  const num=c=>{const v=c>=0?parseFloat(r[c]):NaN;return isFinite(v)?v:null};
  const dist=v=>(v&&v>0&&price>0)?(price/v-1)*100:null;
  const sma50=num(s50),sma100=num(s100),sma200=num(s200),sup=num(h.indexOf('Поддержка'));
  const d200=dist(sma200);
  const avg=PF3_VAL_AVG[pf3MacroSector(String(r[4]||''))]||[22,3];
  const spec=r[5]==='Спекулятивная',knife=crit.label==='Падающий нож';
  const overheat=crit.label==='Перегрев'||(d200!=null&&d200>=30);
  const noData=up==null&&m.roe==null&&m.pe==null&&m.beta==null;
  const P=(arr,pts,ru,en)=>{arr.push({pts,txt:RT(ru,en)});return pts};
  const sum=a=>a.reduce((s,x)=>s+x.pts,0);
  const phEn=l=>({'Падающий нож':'Falling knife','Даунтренд':'Downtrend','Коррекция':'Correction','Боковик':'Sideways','Разворот':'Reversal','Аптренд':'Uptrend','Импульс':'Momentum','Перегрев':'Overheated','Недооценка':'Undervalued'}[l]||l);
  const PH={'Падающий нож':-2.5,'Даунтренд':-1.5,'Коррекция':-0.5,'Боковик':0,'Разворот':0.5,'Аптренд':1.5,'Импульс':1,'Перегрев':-1.5,'Недооценка':0.5};
  const lv=[['SMA 50',sma50,dist(sma50)],['SMA 100',sma100,dist(sma100)],[RT('поддержка','support'),sup,dist(sup)]]
    .filter(x=>x[1]>0).sort((a,b)=>Math.abs(a[2])-Math.abs(b[2]))[0];
  const entry=lv?lv[1]:null;
  const pack=(F,T,R,v,extra)=>Object.assign({v,F,T,R,fs:sum(F),ts:sum(T),rs:sum(R),total:sum(F)+sum(T)+sum(R)},extra||{});

  // ── ⏱ Момент (сейчас): техника и точка входа ──
  const nF=[],nT=[],nR=[];
  if(crit.label in PH)P(nT,PH[crit.label],`фаза: ${crit.ico} ${crit.label}`,`phase: ${crit.ico} ${phEn(crit.label)}`);
  if(sig.type==='buy')P(nT,1.5,`цена у уровня ${sig.n}`,`price at level ${sig.n}`);
  else if(sig.type==='sell')P(nT,-1.5,'цена у сопротивления — фиксация','at resistance — take-profit');
  else if(sig.type==='wait')P(nT,0,`до уровня ${sig.n} ещё ${sig.dist.toFixed(1)}%`,`${sig.dist.toFixed(1)}% to level ${sig.n}`);
  else if(sig.type==='below')P(nT,-1,'ниже всех уровней поддержки','below all support');
  if(up!=null){if(up>=10)P(nF,1,`потенциал к таргету +${up.toFixed(0)}%`,`+${up.toFixed(0)}% upside to target`);else if(up<=-5)P(nF,-1.5,`цена выше таргета на ${(-up).toFixed(0)}%`,`${(-up).toFixed(0)}% above target`);}
  if(knife)P(nR,-2.5,'падающий нож','falling knife');else if(overheat)P(nR,-1.5,'перегрев — далеко над средними','overheated — far above averages');
  if(spec)P(nR,-1,'спекулятивный профиль','speculative profile');
  if(m.beta!=null&&m.beta>1.5)P(nR,-0.5,`высокая волатильность β ${m.beta.toFixed(1)}`,`high volatility β ${m.beta.toFixed(1)}`);
  // C.3: Risk/Reward КРАТКОСРОЧНОГО сценария во входах скоринга «сейчас» (один масштаб).
  const _res=num(h.indexOf('Сопротивление'));
  const _tech=scenarioTech(String(r[2]||''),r[8]||'USD');
  const _scn=scenarioShort({price,sma50,support:sup,resistance:_res,atr:_tech.atr,rsi:_tech.rsi});
  if(_scn&&_scn.rr!=null){
    if(_scn.rr<1)P(nR,-1,`R/R ${_scn.rr.toFixed(1)} < 1 — риск > потенциала`,`R/R ${_scn.rr.toFixed(1)} < 1 — risk > reward`);
    else if(_scn.rr>2)P(nF,1,`R/R ${_scn.rr.toFixed(1)} — асимметрия в пользу роста`,`R/R ${_scn.rr.toFixed(1)} — upside asymmetry`);
  }
  // 📰 Свежий новостной фон (живые заголовки Yahoo, если подгружены в карточке) — краткосрочный фактор.
  const _nv=NEWS_LIVE[String(r[2]||'').toUpperCase()];
  const _newsNeg=!!(_nv&&_nv.items&&_nv.items.length&&_nv.sent<=-2);
  if(_nv&&_nv.items&&_nv.items.length){
    if(_nv.sent>=2)P(nT,1,`позитивный новостной фон (+${_nv.sent})`,`positive news flow (+${_nv.sent})`);
    else if(_nv.sent<=-2)P(nR,-1,`негативный новостной фон (${_nv.sent})`,`negative news flow (${_nv.sent})`);
  }
  if(!nR.length)P(nR,0,'красных флагов нет','no red flags');
  let nowV;
  if(noData)nowV='wait';else if(knife)nowV='avoid';
  else if(sig.type==='sell'||overheat||(up!=null&&up<=-5))nowV='sell';
  else if(sig.type==='buy'&&(d200==null||d200>=0)&&!_newsNeg)nowV='buy';else nowV='wait';   // сильный негатив новостей не даёт «покупать»
  const nNote=noData?RT('недостаточно данных — обновите акции','not enough data — refresh stocks')
    :nowV==='avoid'?RT('падающий нож — ждать стабилизации у поддержки','falling knife — wait for support to hold')
    :nowV==='sell'?RT('у сопротивления / перегрев — зона фиксации','at resistance / overheated — take-profit')
    :_newsNeg?RT('негативный новостной фон — дождитесь стабилизации','negative news flow — wait for it to settle')
    :nowV==='buy'?RT(`цена у уровня ${sig.n||'входа'} в восходящем тренде`,`price at level ${sig.n||'entry'} in uptrend`)
    // Ждать, хотя buy-сигнал сработал (цена у уровня входа) — значит тренд не подтверждён (цена ниже SMA 200).
    :(sig.type==='buy')?RT(`у входа (${sig.n||''}), но цена ниже SMA 200 — тренд не подтверждён`,`at entry (${sig.n||''}), but price below SMA 200 — trend unconfirmed`)
    :RT(`до уровня входа ${sig.dist!=null?'≈ '+sig.dist.toFixed(1)+'%':'далеко'}`,`${sig.dist!=null?sig.dist.toFixed(1)+'% to entry':'far from entry'}`);
  const now=pack(nF,nT,nR,nowV,{note:nNote,entry:(nowV==='buy'||nowV==='wait')?entry:null});

  // ── 📅 6–9 месяцев: тренд + оценка + апсайд ──
  const mF=[],mT=[],mR=[];
  if(d200!=null)P(mT,d200>0?1.5:-1,d200>0?`цена выше SMA 200 (+${d200.toFixed(0)}%)`:`цена ниже SMA 200 (${d200.toFixed(0)}%)`,d200>0?`above SMA 200 (+${d200.toFixed(0)}%)`:`below SMA 200 (${d200.toFixed(0)}%)`);
  if(crit.label==='Импульс'||crit.label==='Аптренд')P(mT,0.5,`моментум: ${crit.label}`,`momentum: ${phEn(crit.label)}`);
  if(up!=null){if(up>=15)P(mF,2,`высокий потенциал +${up.toFixed(0)}%`,`high upside +${up.toFixed(0)}%`);else if(up>=5)P(mF,1,`потенциал +${up.toFixed(0)}%`,`upside +${up.toFixed(0)}%`);else if(up<=-5)P(mF,-1.5,`выше таргета на ${(-up).toFixed(0)}%`,`${(-up).toFixed(0)}% above target`);}
  if(m.roe!=null&&m.roe>=12)P(mF,1,`ROE ${m.roe.toFixed(0)}%`,`ROE ${m.roe.toFixed(0)}%`);
  if(m.revg!=null&&m.revg>=8)P(mF,1,`выручка +${m.revg.toFixed(0)}% г/г`,`revenue +${m.revg.toFixed(0)}% YoY`);
  if(m.pe!=null&&m.pe>0){if(m.pe<=avg[0])P(mF,0.5,`P/E ${m.pe.toFixed(0)} ≤ сектора`,`P/E ${m.pe.toFixed(0)} ≤ sector`);else if(m.pe>=avg[0]*1.5)P(mF,-0.5,`P/E ${m.pe.toFixed(0)} ≫ сектора`,`P/E ${m.pe.toFixed(0)} ≫ sector`);}
  if(overheat)P(mR,-0.5,'перегрев','overheated');if(knife)P(mR,-1,'падающий нож','falling knife');if(spec)P(mR,-1,'спекулятивный профиль','speculative profile');
  if(!mR.length)P(mR,0,'красных флагов нет','no red flags');
  const mtot=sum(mF)+sum(mT)+sum(mR),midV=noData?'wait':mtot>=2.5?'buy':mtot<=-2?'sell':'wait';
  const mNote=noData?RT('нужны метрики','need metrics'):midV==='buy'?RT('тренд и потенциал к таргету за вход','trend + upside support an entry'):midV==='sell'?RT('слабый тренд / нет апсайда — сокращать','weak trend / no upside — trim'):RT('смешанно — ждать отчёт или вход у уровня','mixed — await earnings or a level');
  const mid=pack(mF,mT,mR,midV,{note:mNote,target:eff.target>0?eff.target:null,up});

  // ── 🚀 Лонг (12+ мес): фундаментал и недооценка ──
  const lF=[],lT=[],lR=[];
  if(m.roe!=null){if(m.roe>=15)P(lF,2,`высокая рентабельность: ROE ${m.roe.toFixed(0)}%`,`high ROE ${m.roe.toFixed(0)}%`);else if(m.roe>=10)P(lF,1,`ROE ${m.roe.toFixed(0)}%`,`ROE ${m.roe.toFixed(0)}%`);else if(m.roe<0)P(lF,-2,`убыточна: ROE ${m.roe.toFixed(0)}%`,`loss-making ROE ${m.roe.toFixed(0)}%`);}
  if(m.revg!=null){if(m.revg>=15)P(lF,2,`сильный рост +${m.revg.toFixed(0)}%`,`strong growth +${m.revg.toFixed(0)}%`);else if(m.revg>=8)P(lF,1,`рост +${m.revg.toFixed(0)}%`,`growth +${m.revg.toFixed(0)}%`);else if(m.revg<0)P(lF,-1,`выручка падает ${m.revg.toFixed(0)}%`,`revenue ${m.revg.toFixed(0)}%`);}
  if(up!=null){if(up>=25)P(lF,2,`недооценка: +${up.toFixed(0)}% к таргету`,`undervalued: +${up.toFixed(0)}% to target`);else if(up>=10)P(lF,1,`потенциал +${up.toFixed(0)}%`,`upside +${up.toFixed(0)}%`);else if(up<=-15)P(lF,-1,`дорого: ${(-up).toFixed(0)}% выше таргета`,`expensive: ${(-up).toFixed(0)}% above target`);}
  if(m.pe!=null&&m.pe>0){if(m.pe<=avg[0])P(lF,1,`P/E ${m.pe.toFixed(0)} ≤ сектора`,`P/E ${m.pe.toFixed(0)} ≤ sector`);else if(m.pe>=avg[0]*1.8)P(lF,-1,`дорогой P/E ${m.pe.toFixed(0)}`,`expensive P/E ${m.pe.toFixed(0)}`);}
  if(d200!=null)P(lT,d200>0?0.5:-0.5,d200>0?'долгосрочный тренд вверх':'долгосрочный тренд вниз',d200>0?'long-term uptrend':'long-term downtrend');
  if(m.de!=null&&m.de>2)P(lR,-0.5,`высокий долг D/E ${m.de.toFixed(1)}`,`high debt D/E ${m.de.toFixed(1)}`);
  if(spec)P(lR,-1,'спекулятивный профиль','speculative profile');
  if(m.ps!=null&&m.ps>=20)P(lR,-1,`экстремальная оценка P/S ${m.ps.toFixed(0)}`,`extreme P/S ${m.ps.toFixed(0)}`);
  if(!lR.length)P(lR,0,'красных флагов нет','no red flags');
  const ltot=sum(lF)+sum(lT)+sum(lR),longV=noData?'wait':ltot>=2.5?'buy':ltot<=-2?'avoid':'wait';
  const lNote=noData?RT('нужны метрики','need metrics'):longV==='buy'?RT('сильный фундаментал и недооценка','strong fundamentals and value'):longV==='avoid'?RT('слабый фундаментал / высокий риск','weak fundamentals / high risk'):RT('качество среднее — наблюдать','average quality — watch');
  const long=pack(lF,lT,lR,longV,{note:lNote,target:eff.target>0?eff.target:null,up});

  return{now,mid,long};
}
// Один столбец разбора (Фундаментал/Техника/Риск) — общий для горизонтов и скоринга.
function pf3RecoDim(title,score,items){
  const sgn=x=>`${x>0?'+':''}${x.toFixed(1)}`;
  return`<div class="pf3-reco-dim"><div class="pf3-reco-dim-hd">${title} <span class="${score>0?'pf3-up':score<0?'pf3-down':''}">${sgn(score)}</span></div>${(items||[]).map(i=>`<div class="pf3-reco-it ${i.pts>0?'pos':i.pts<0?'neg':'neu'}">${i.pts>0?'▲':i.pts<0?'▼':'•'} ${i.txt}</div>`).join('')||`<div class="pf3-reco-it neu">• ${RT('нет данных','no data')}</div>`}</div>`;
}
// Выбранный горизонт (общий для списка и карточек): 'now' | 'mid' | 'long'.
let pf3Hz='now';
const PF3_HZ_KEYS=['now','mid','long'];
function pf3SetHz(k){if(PF3_HZ_KEYS.includes(k)){pf3Hz=k;renderPF3();}}
const PF3_HZ_META={buy:['🟢',['Покупать','Buy'],'buy'],sell:['🔴',['Сокращать','Trim'],'sell'],wait:['🟡',['Ждать','Wait'],'wait'],avoid:['⛔',['Избегать','Avoid'],'avoid']};
// Общий рендер трёх горизонтов (💡 Рекомендация и 🔎 Анализ акции): кликабельные
// карточки-вердикты + разбор Фундаментал/Техника/Риск для ВЫБРАННОГО горизонта.
function pf3HorizonsHTML(d,r){
  const hz=pf3RecoHorizons(d,r),ccy=r[8]||'';
  if(!PF3_HZ_KEYS.includes(pf3Hz))pf3Hz='now';
  const E=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const mlbl=m=>RT(m[1][0],m[1][1]);
  const HZ=[['now','⏱ '+RT('Сейчас','Now'),hz.now],['mid','📅 6–9 '+RT('мес','mo'),hz.mid],['long','🚀 '+RT('Лонг','Long'),hz.long]];
  const cell=([k,lbl,o])=>{const mt=PF3_HZ_META[o.v]||PF3_HZ_META.wait;
    const x=(o.target!=null&&isFinite(o.target))?`${RT('таргет','tgt')} ${pf3Fmt(o.target,2)} ${ccy}${(o.up!=null&&isFinite(o.up))?` <span class="${o.up>=0?'pf3-up':'pf3-down'}">${o.up>=0?'+':''}${o.up.toFixed(0)}%</span>`:''}`:(o.entry!=null?`${RT('вход','entry')} ≈ ${pf3Fmt(o.entry,2)} ${ccy}`:'');
    return`<div class="airk-hz-it${k===pf3Hz?' sel':''}" onclick="pf3SetHz('${k}')"><div class="airk-hz-l">${lbl}</div><div class="airk-hz-v"><span class="pf3-sig xr-${mt[2]}">${mt[0]} ${mlbl(mt)}</span></div>${x?`<div class="airk-hz-x">${x}</div>`:''}<div class="airk-hz-n">${E(o.note||'')}</div></div>`;
  };
  const s=hz[pf3Hz]||hz.now;
  const brk=`<div class="pf3-reco-grid">${pf3RecoDim(RT('📊 Фундаментал','📊 Fundamentals'),s.fs,s.F)}${pf3RecoDim(RT('📈 Техника','📈 Technicals'),s.ts,s.T)}${pf3RecoDim(RT('⚡ Риск','⚡ Risk'),s.rs,s.R)}</div>`;
  return`<div class="airk-hz">${HZ.map(cell).join('')}</div>${brk}`;
}
// Описание инструментов рекомендаций карточки (по клику на «!») — faq-оверлей.
function recoInfoHTML(){
  const li=s=>`<li>${s}</li>`;
  return`<button class="faq-close" onclick="toggleFaq()">✕</button>
  <h2>💡 ${RT('Рекомендации в карточке','Card recommendations')}</h2>
  <div class="faq-body">
  <p>${RT('Все инструменты рекомендаций в карточке дают вывод по <b>трём горизонтам</b>:','All card recommendation tools give a verdict across <b>three horizons</b>:')}</p>
  <ul class="dash-bul">
  ${li('⏱ <b>'+RT('Момент (сейчас)','Now')+'</b> — '+RT('действие по живой цене и технике: зоны входа/выхода, ближайший триггер. Падающий нож → избегать; перегрев / у сопротивления → сокращать; у уровня (SMA/поддержка) в аптренде → покупать.','live price & technicals: entry/exit zones, nearest trigger. Falling knife → avoid; overheated / at resistance → trim; at a level (SMA/support) in an uptrend → buy.'))}
  ${li('📅 <b>'+RT('6–9 месяцев','6–9 months')+'</b> — '+RT('среднесрок: тренд, потенциал к аналит. таргету, ROE/рост, оценка. Показывает таргет и потенциал %.','mid-term: trend, upside to analyst target, ROE/growth, valuation. Shows target and upside %.'))}
  ${li('🚀 <b>'+RT('Лонг (12+ мес)','Long (12+ mo)')+'</b> — '+RT('фундаментал (ROE, рост) и недооценка (P/E к сектору, апсайд).','fundamentals (ROE, growth) and undervaluation (P/E vs sector, upside).'))}
  </ul>
  <p>${RT('Горизонты могут расходиться — например «сокращать сейчас» из-за перегрева, но «покупать на лонг». Это нормально.','Horizons may diverge — e.g. «trim now» on overheating but «buy for the long run». That is expected.')}</p>
  <p><b>${RT('Четыре инструмента','Four tools')}:</b></p>
  <ul class="dash-bul">
  ${li('💡 <b>'+RT('Рекомендация','Recommendation')+'</b> — '+RT('детерминированный скоринг сайта (техника + фундаментал + риск + свежий новостной фон Yahoo, если подгружен в карточке). Сильный негатив новостей минусует и снимает «покупать». Не входят: инсайдеры, опционы, AI Proto. Бесплатно, без токенов.','deterministic site scoring (technicals + fundamentals + risk + fresh Yahoo news flow if loaded in the card). Strong negative news subtracts and removes «buy». Not included: insiders, options, AI Proto. Free, no tokens.'))}
  ${li('🔎 <b>'+RT('Анализ акции','Stock analysis')+'</b> — '+RT('детерминированный текстовый разбор по метрикам дашборда. Бесплатно.','deterministic written analysis from dashboard metrics. Free.'))}
  ${li('🔄 <b>'+RT('AI-Рекомендация','AI recommendation')+'</b> — '+RT('Claude взвешивает технику, фундаментал и оценку + веб-поиск свежих новостей и макро. Платный AI-вызов на бумагу.','Claude weighs technicals, fundamentals and valuation + web search of fresh news and macro. A paid AI call per stock.'))}
  ${li('🔬 <b>'+RT('AI-анализ акции','AI stock analysis')+'</b> — '+RT('Claude собирает цены, уровни, фундаментал и свежие новости и даёт разбор по горизонтам; сохраняется в обучающую базу 🔬 AI-разборы.','Claude gathers prices, levels, fundamentals and fresh news and analyses by horizon; saved to the 🔬 AI analyses learning base.'))}
  </ul>
  <p class="pf3-asof">${RT('Это справочная аналитика, а не индивидуальная инвестиционная рекомендация.','Reference analytics, not individual investment advice.')}</p>
  </div>`;
}
function recoInfo(){const o=document.getElementById('faqOverlay');if(!o)return;document.getElementById('faqCard').innerHTML=recoInfoHTML();o.classList.remove('hidden');}
// Вердикт скоринга → колонка данных «Реком. скоринг» (buy/wait/sell/avoid).
// Worker передаёт её Claude в universe AI-портфеля как мягкий фактор.
function pf3WriteReco(d){
  const c=ensurePFCol(d,'Реком. скоринг');
  d.rows.forEach(r=>{try{r[c]=pf3Reco(d,r).v}catch(e){}});
}
// 🔮 Прогноз стоимости позиций и портфеля на 3 горизонта.
// Ожидаемая 12-мес доходность бумаги: от таргета аналитиков, иначе от фундаментала
// (рост выручки / ROE). Сценарий сдвигает её на ±band. Горизонты — доля пути.
let pf3FcastScn='base';   // 'pess' | 'base' | 'opt'
function pf3FcastSetScn(s){pf3FcastScn=s;renderPF3()}
function pf3Fcast12(d,r){
  const cur=parseFloat(r[7])||0,tgt=pf3EffTarget(d,r).target,cl=(x,a,b)=>Math.max(a,Math.min(b,x));
  if(tgt>0&&cur>0)return{e:(tgt/cur-1)*100,src:'tgt'};
  const m=pf3TypeMetrics(d,r);
  if(m.revg!=null)return{e:cl(m.revg,-20,30),src:'fund'};
  if(m.roe!=null&&m.roe>0)return{e:cl(m.roe*0.5,0,15),src:'fund'};
  return{e:0,src:'flat'};
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
function pf3ForecastHTML(){
  const d=pf3D();
  const HZ=[['3 '+RT('мес','m'),0.33],[RT('6–9 мес','6–9m'),0.66],[RT('12+ мес','12m+'),1.0]];
  const SCN=[['pess','📉 '+RT('Пессим.','Pess.'),-1],['base','📊 '+RT('База','Base'),0],['opt','📈 '+RT('Оптим.','Opt.'),1]];
  if(!SCN.some(s=>s[0]===pf3FcastScn))pf3FcastScn='base';
  const dir=(SCN.find(s=>s[0]===pf3FcastScn)||[])[2]||0;
  const rows=[];
  d.rows.forEach((r,i)=>{
    const qty=parseFloat(r[6])||0;if(!(qty>0))return;
    recalcPF(i,v3Key);
    const valSEK=parseFloat(r[13])||0;
    const f12=pf3Fcast12(d,r),band=Math.max(18,Math.abs(f12.e)*0.8),e=f12.e+dir*band;
    const cells=HZ.map(hz=>{const ratio=1+(e/100)*hz[1];return{v:valSEK*ratio,pct:(ratio-1)*100,has:true}});
    rows.push({name:String(r[1]||r[2]||''),tk:String(r[2]||''),valSEK,cells,src:f12.src});
  });
  rows.sort((a,b)=>b.valSEK-a.valSEK);
  if(!rows.length)return`<section class="pf3-panel"><div class="pf3-empty">${RT('Нет позиций для прогноза','No positions to forecast')}</div></section>`;
  const srcMark={tgt:'',fund:` <span class="fc-flat" title="${RT('прогноз по фундаменталу (рост выручки/ROE)','fundamental projection (revenue growth/ROE)')}">ƒ</span>`,flat:` <span class="fc-flat" title="${RT('нет данных — без изменения','no data — held flat')}">≈</span>`};
  rows.forEach(x=>{x.mark=srcMark[x.src]||''});
  const scnBtns=SCN.map(s=>`<button class="pf3-hz-b${pf3FcastScn===s[0]?' on':''}" onclick="pf3FcastSetScn('${s[0]}')">${s[1]}</button>`).join('');
  return`<section class="pf3-panel pf3-forecast">
    <div class="pf3-panel-hd"><span>🔮 ${RT('Прогноз стоимости','Value forecast')}</span><span class="pf3-asof">${RT('детерминированно · по таргетам и фундаменталу','deterministic · targets & fundamentals')}</span></div>
    <div class="pf3-hz-seg fc-scn">${scnBtns}</div>
    ${pf3FcTable(d,rows,HZ.map(h=>h[0]))}
    <div class="pf3-reco-note">${RT('Ожидаемая 12-мес доходность бумаги берётся от консенсус-таргета аналитиков, а без таргета — от фундаментала (ƒ: рост выручки / ROE). Горизонты — доля этого пути (~⅓ за 3 мес, ~⅔ за 6–9 мес, полностью за 12+ мес). Сценарии Пессим./Оптим. сдвигают доходность на волатильный диапазон. Кэш постоянен. Оценка, не гарантия и не индивидуальная рекомендация.','A stock\'s expected 12m return comes from the analyst consensus target, or from fundamentals when no target (ƒ: revenue growth / ROE). Horizons are a fraction of that path (~1/3 in 3m, ~2/3 in 6–9m, full at 12m+). Pess./Opt. scenarios shift the return by a volatility band. Cash is constant. An estimate, not a guarantee or advice.')}</div>
    ${pf3FcastAiHTML(d)}
  </section>`;
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
    await pf3Refresh(true);
    const d=DATA[key],num=v=>{const n=parseFloat(v);return isFinite(n)?n:null};
    const positions=d.rows.filter(r=>(parseFloat(r[6])||0)>0).map(r=>{const m=pf3TypeMetrics(d,r);return{ticker:r[2],name:r[1],sector:r[4],ccy:r[8]||'USD',qty:num(r[6]),price:num(r[7]),analystTarget:pf3EffTarget(d,r).target||null,upsidePct:pf3EffUpside(d,r),pe:m.pe,roe:m.roe,revGrowth:m.revg,phase:pf3Criterion(d,r).label}});
    const snap={portfolioName:TAB_LABEL(key),baseCurrency:pf3Base(d),horizons:['3 мес','6-9 мес','12+ мес'],positions,playbook:aiPlaybookEnsure()};
    const r=await fetch(PRICE_PROXY+'?action=forecast',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},body:JSON.stringify(snap)});
    const bodyText=await r.text();let j=null;try{j=JSON.parse(bodyText)}catch(_){}
    if(j&&j.forecast){aiSpendAdd(j.cost);DATA[key].fcastAI={summary:j.forecast.summary||'',stocks:Array.isArray(j.forecast.stocks)?j.forecast.stocks:[],horizons:j.forecast.horizons||null,at:new Date().toISOString(),cost:j.cost||null};scheduleSave();}
    else{const msg=(j&&j.error)||(bodyText?bodyText.slice(0,200):('HTTP '+r.status));console.warn('Forecast failed:',r.status,bodyText);toast('AI ('+TAB_LABEL(key)+'): '+msg,true);}
  }catch(e){toast('AI: '+(e&&e.message||RT('сеть/worker недоступен','network/worker unreachable')),true);}
  pf3Fcast.loading=false;if(isV3())renderPF3();
}
function pf3RecoHTML(d,r){
  // Верхний вердикт = горизонт «Сейчас» (now), чтобы «Рекомендация» не противоречила
  // карточке СЕЙЧАС и колонке «Рекомендация» в списке (она тоже берёт горизонты).
  const now=pf3RecoHorizons(d,r).now;
  const rc={v:now.v,hint:now.note,total:now.total};
  const META={buy:['🟢',RT('Покупать','Buy')],sell:['🔴',RT('Продавать / фиксировать','Sell / take profit')],wait:['🟡',RT('Ждать','Wait')],avoid:['⛔',RT('Не приближаться','Stay away')]};
  const [ico,label]=META[rc.v];
  const sgn=x=>`${x>0?'+':''}${x.toFixed(1)}`;
  return`<section class="pf3-panel pf3-reco">
    <div class="pf3-panel-hd"><span>${RT('💡 Рекомендация','💡 Recommendation')} <span class="dash-info-btn" onclick="event.stopPropagation();recoInfo()" title="${RT('Что это?','What is this?')}">!</span></span><span class="pf3-asof">${RT('балл','score')} ${sgn(rc.total)}</span></div>
    <div class="pf3-reco-verdict rv-${rc.v}">${ico} ${label}<small>${rc.hint}</small></div>
    <div class="pf3-reco-hz-l">${RT('По горизонтам — нажмите, чтобы увидеть разбор Фундаментал / Техника / Риск','By horizon — tap to see the Fundamentals / Technicals / Risk breakdown')}</div>
    ${pf3HorizonsHTML(d,r)}
    <div class="pf3-reco-note">${RT('Автоматический скоринг по данным карточки — не индивидуальная инвестиционная рекомендация.','Automatic scoring from the card data — not individual investment advice.')}</div>
  </section>`;
}

// Column sorting (display only — the underlying rows stay in place).
let pf3Sort={key:'val',dir:-1};   // default: по общей стоимости, по убыванию
function pf3SortBy(k){
  if(pf3Sort.key===k)pf3Sort.dir=-pf3Sort.dir;
  else pf3Sort={key:k,dir:(k==='name'||k==='sec')?1:-1};   // text asc, numbers desc by default
  renderPF3();
}
function pf3ListHead(){
  const ar=k=>pf3Sort.key===k?(pf3Sort.dir>0?' ▲':' ▼'):'';
  const hd=(label,key,cls,right)=>`<span class="pf3-sort${cls?' '+cls:''}"${right?' style="text-align:right"':''} onclick="pf3SortBy('${key}')">${label}${ar(key)}</span>`;
  const xc=pf3XActive(pf3D());
  const xh=xc.map(k=>hd(T((PF3_XDEF.find(x=>x[0]===k)||[])[1]||k),k,'pf3-c-x',1)).join('');
  const tpl=pf3GridTpl(pf3IsPort(v3Key),xc);
  if(!pf3IsPort(v3Key))   // index mode (Nasdaq 100): no position economics, but day % and analyst target
    return`<div class="pf3-lhead idx" style="${tpl}"><span></span>${hd(T('Компания'),'name')}${hd(T('Сектор'),'sec','pf3-c-sec')}${hd(T('Тип'),'typ','pf3-c-typ')}${hd(T('Цена'),'price','',1)}${hd(T('1д %'),'day','pf3-c-day',1)}${hd(T('Таргет'),'tg','pf3-c-tg',1)}${xh}${hd(T('Критерий'),'crit','pf3-c-crit')}<span class="pf3-c-sig">${T('Сигнал')}</span><span></span></div>`;
  return`<div class="pf3-lhead" style="${tpl}"><span></span>${hd(T('Компания'),'name')}${hd(T('Сектор'),'sec','pf3-c-sec')}${hd(T('Тип'),'typ','pf3-c-typ')}${hd(T('Кол-во'),'qty','pf3-c-qty')}${hd(T('Покупка'),'buy','pf3-c-buy')}${hd(T('Цена'),'price','',1)}${hd(T('Стоимость'),'val','',1)}${hd(T('Доля'),'share','pf3-c-share',1)}${xh}${hd(T('Критерий'),'crit','pf3-c-crit')}<span class="pf3-c-sig">${T('Сигнал')}</span><span></span></div>`;
}


// ── Доп. колонки списка: любой параметр карточки в таблицу, набор свой у
// каждой вкладки (d.xcols, синхронизируется). P/E·P/S·дивдоходность пишутся
// в строки суточным обновлением таргетов (?targets). На мобильных и при
// открытой карточке доп. колонки скрываются — там и так тесно.
const PF3_XDEF=[
  ['sma50','SMA 50'],['sma100','SMA 100'],['sma200','SMA 200'],
  ['sup','Поддержка'],['res','Сопротивление'],
  ['upside','Потенциал %'],['tgr','Таргет 3м'],['pe','P/E'],['ps','P/S'],['divy','Дивид. %'],['beta','Beta'],['roe','ROE'],
  ['betyg','Рейтинг'],['reco','Рекомендация'],
];
// Лёгкий фундаментальный рейтинг для СТРОКИ списка (по доступным колонкам:
// ROE / рост выручки / P/E·P/S). Полный 5-столповый betyg — в карточке (pf3Betyg).
// Возвращает 0–10 или null (нет данных). Используется как сортируемая колонка → скринер.
function pf3RowBetyg(o){
  const prof=o.roe>0?(o.roe>=20?10:o.roe>=15?9:o.roe>=10?7:o.roe>=5?5:4):(o.roe<0?1:null);
  const grow=(typeof o.revg==='number'&&o.revg!==0)?(o.revg>=20?10:o.revg>=10?8:o.revg>=4?6:o.revg>0?5:o.revg>-10?3:1):null;
  const val=(typeof pf3ValScore==='function')?pf3ValScore({pe:o.pe,ps:o.ps},String((o.r&&o.r[2])||'').toUpperCase(),o.sec):null;
  const W={prof:0.4,grow:0.3,val:0.3};let sw=0,wsum=0;
  [['prof',prof],['grow',grow],['val',val]].forEach(([k,v])=>{if(v!=null){sw+=v*W[k];wsum+=W[k];}});
  return wsum?sw/wsum:null;
}
let pf3XMenuOpen=false;
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
const pf3XC=d=>Array.isArray(d.xcols)?d.xcols.filter(k=>PF3_XDEF.some(x=>x[0]===k)):[];
const pf3XActive=d=>(pf3Sel||matchMedia('(max-width:900px)').matches)?[]:pf3XC(d);
function pf3XMenuToggle(ev){if(ev)ev.stopPropagation();pf3XMenuOpen=!pf3XMenuOpen;renderPF3()}
function pf3XToggle(k,ev){
  if(ev)ev.stopPropagation();
  const d=pf3D();d.xcols=pf3XC(d);
  const i=d.xcols.indexOf(k);
  if(i>=0)d.xcols.splice(i,1);else d.xcols.push(k);
  // Локальный резерв выбора: переживает затирание облачной копии (старые
  // кеши клиентов и т.п.) — restoreXcols() вернёт выбор при загрузке.
  try{const m=JSON.parse(localStorage.getItem('dash_xcols')||'{}');m[v3Key]=d.xcols.slice();localStorage.setItem('dash_xcols',JSON.stringify(m));}catch(e){}
  scheduleSave();renderPF3();
}
function pf3XMenuHTML(d){
  if(!pf3XMenuOpen)return'';
  const on=pf3XC(d);
  return`<div class="xcols-menu" onclick="event.stopPropagation()">
    ${isAdmin()?`<button class="pf3-btn" style="margin-bottom:6px" onclick="pf3RenameTab(event)">✏️ ${RT('Переименовать вкладку','Rename tab')}</button>`:''}
    <div class="xcols-t">${T('Доп. колонки списка')}</div>
    ${PF3_XDEF.map(([k,l])=>`<label class="set-tab"><input type="checkbox"${on.includes(k)?' checked':''} onchange="pf3XToggle('${k}',event)"><span>${T(l)}</span></label>`).join('')}
    <button class="pf3-btn" style="margin-top:4px" onclick="pf3ForceTypes(event)">🔁 ${RT('Обновить типы и метрики сейчас','Refresh types & metrics now')}</button>
    <div class="xcols-note">${T('значения приходят с обновлением акций')}</div>
  </div>`;
}
// Инлайн-шаблон сетки: базовые колонки + 82px на каждую дополнительную.
function pf3GridTpl(port,xc){
  const arr=Array.isArray(xc)?xc:[];
  if(!arr.length)return'';
  const x=arr.map(k=>k==='reco'?' 84px':' 78px').join('');
  return`grid-template-columns:${port
    ?`40px minmax(104px,1.4fr) minmax(64px,0.85fr) 104px 44px 60px 86px 82px 48px${x} 108px minmax(118px,1fr) 50px`
    :`40px minmax(110px,1.5fr) minmax(78px,1fr) 104px 88px 66px 88px${x} 112px minmax(118px,1fr) 50px`}`;
}
function pf3XCell(it,k){
  const p=it.price;
  if(k==='reco'){
    // Вердикт по ВЫБРАННОМУ горизонту (pf3Hz): «Сейчас» / 6–9м / Лонг.
    let vv=it.recoV,note=it.recoHint;
    try{const o=pf3RecoHorizons(pf3D(),it.r)[pf3Hz];if(o){vv=o.v;note=o.note;}}catch(e){}
    if(!vv)return'—';
    const M={buy:['🟢',RT('Купить','Buy'),'buy'],sell:['🔴',RT('Сократить','Trim'),'sell'],wait:['🟡',RT('Ждать','Wait'),'wait'],avoid:['⛔',RT('Опасно','Avoid'),'avoid']}[vv];
    return`<span class="pf3-sig xr-${M[2]}" title="${String(note||'').replace(/"/g,'&quot;')}">${M[0]} ${M[1]}</span>`;
  }
  if(k==='betyg'){const b=it.betyg;if(b==null)return'—';const g=pf3Grade(b);return`<span class="pf3-betyg-cell ${g.c}" title="${RT('Лёгкий фунд. рейтинг (ROE/рост/оценка). Полный 5-столповый — в карточке.','Light fundamental rating (ROE/growth/valuation). Full 5-pillar one is in the card.')}">${g.g}</span>`}
  if(k==='upside'){const v=pf3EffUpside(pf3D(),it.r);return v==null?'—':`<span class="${v>=0?'pf3-up':'pf3-down'}">${v>0?'+':''}${v.toFixed(1)}%</span>`}
  if(k==='tgr'){const v=it.tgr;if(!(v>0)||!(p>0))return'—';const u=(v/p-1)*100;return`<b>${pf3Fmt(v,0)}</b><small class="${u>=0?'pf3-up':'pf3-down'}">${u>=0?'+':''}${u.toFixed(1)}%</small>`}
  const v=it[k];
  if(k==='pe'||k==='ps')return v>0?(+v).toFixed(1):'—';
  if(k==='beta')return v?(+v).toFixed(2):'—';
  if(k==='roe')return v?(+v).toFixed(1)+'%':'—';
  if(k==='divy')return v>0?(+v).toFixed(1)+'%':'—';
  if(!(v>0)||!(p>0))return'—';
  const dd=(p-v)/v*100;   // уровни: значение + дистанция цены, как в карточке
  return`<b>${pf3Fmt(v,2)}</b><small class="${dd>=0?'pf3-up':'pf3-down'}">${dd>=0?'▲':'▼'}${Math.abs(dd).toFixed(1)}%</small>`;
}
// Rows with computed metrics + total stock value — shared by the flat list
// and the grouped «Сектора»/«Тип» views.
function pf3Items(){
  const d=pf3D(),h=d.headers;
  const tgC=h.findIndex(x=>/аналит/i.test(x));
  const {s50,s100,s200}=smaIdx(d);
  const supC=h.indexOf('Поддержка'),resC=h.indexOf('Сопротивление');
  const peC=h.indexOf('P/E'),psC=h.indexOf('P/S'),dyC=h.indexOf('Дивид. %'),revgC=h.indexOf('Рост выручки');
  const tgrC=h.findIndex(x=>/таргет 3м/i.test(x));
  const num=(r,i)=>i>=0?(parseFloat(r[i])||0):0;
  const items=d.rows.map((r,i)=>{
    recalcPF(i,v3Key);
    const c=pf3Criterion(d,r);
    const tg=tgC>=0?(parseFloat(r[tgC])||0):0,price=parseFloat(r[7])||0;
    const it={r,name:String(r[1]||r[2]||''),sec:String(r[4]||''),typ:String(r[5]||''),qty:parseFloat(r[6])||0,buy:parseFloat(r[9])||0,price,val:parseFloat(r[13])||0,tg,day:parseFloat(r[10])||0,crit:c.rank,critHtml:c.html,
      sma50:num(r,s50),sma100:num(r,s100),sma200:num(r,s200),sup:num(r,supC),res:num(r,resC),
      pe:num(r,peC),ps:num(r,psC),divy:num(r,dyC),beta:num(r,h.indexOf('Beta')),roe:num(r,h.indexOf('ROE')),revg:num(r,revgC),upside:pf3EffUpside(d,r)||0,tgr:num(r,tgrC),
      ...(()=>{const rc=pf3Reco(d,r);return{reco:({buy:3,wait:2,sell:1,avoid:0})[rc.v]*100+rc.total,recoV:rc.v,recoHint:rc.hint.replace(/"/g,'&quot;')}})()};
    it.betyg=pf3RowBetyg(it);   // лёгкий фунд. рейтинг строки (для колонки/сортировки)
    return it;
  });
  const totalVal=items.reduce((a,x)=>a+x.val,0);
  items.forEach(x=>x.share=totalVal>0?x.val/totalVal*100:0);
  return{items,totalVal};
}


// Логотип компании: FMP image CDN → Parqet → буквы тикера (оба бесплатны,
// покрывают US/.ST/.DE; при двойном промахе <img> убирает себя и остаются буквы).
function logoHTML(tk,ccy,cls){
  const esym=encodeURIComponent(exSymbol(tk,ccy));
  return`<div class="${cls}">${String(tk).slice(0,2)}<img class="logo-i" loading="lazy" alt="" src="https://images.financialmodelingprep.com/symbol/${esym}.png" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='https://assets.parqet.com/logos/symbol/${esym}?format=png&size=64'}else this.remove()"></div>`;
}
// One list row: logo, flag+name+ticker, sector, type, … , signal, delete.
// Index mode swaps the position columns for day % and the analyst target.
function pf3RowHTML(d,it,port,xc){
  const {r,name,qty,buy,price,val,share,tg}=it;
  const tk=String(r[2]||''),ccy=r[8]||'USD';
  const day=parseFloat(r[10]),ppct=parseFloat(r[12])||0;
  const flag=r[3]&&r[3]!=='—'?r[3]+' ':'';
  const cells=port
    ?`<div class="pf3-c pf3-c-qty">${pf3Fmt(qty)}</div>
    <div class="pf3-c pf3-c-buy">${buy>0?pf3Fmt(buy,2):'—'}</div>
    <div class="pf3-row-price"><b>${price>0?pf3Fmt(price,2):'—'} ${ccy}</b>${isFinite(day)?`<span class="${day>=0?'pf3-up':'pf3-down'}">${day>0?'+':''}${day.toFixed(2)}%</span>`:''}</div>
    <div class="pf3-row-val"><b>${pf3Money(d,val)}</b><span class="${ppct>=0?'pf3-up':'pf3-down'}">${ppct>0?'+':''}${ppct.toFixed(1)}%</span></div>
    <div class="pf3-c pf3-c-share">${share>0?share.toFixed(1)+'%':'—'}</div>`
    :`<div class="pf3-row-price"><b>${price>0?pf3Fmt(price,2):'—'} ${ccy}</b></div>
    <div class="pf3-c pf3-c-day"><span class="${day>=0?'pf3-up':'pf3-down'}">${isFinite(day)?(day>0?'+':'')+day.toFixed(2)+'%':'—'}</span></div>
    <div class="pf3-row-price pf3-c-tg"><b>${tg>0?pf3Fmt(tg,0):'—'}</b>${tg>0&&price>0?`<span class="${tg>=price?'pf3-up':'pf3-down'}">${tg>=price?'+':''}${((tg-price)/price*100).toFixed(0)}%</span>`:''}</div>`;
  return`<div class="pf3-row${port?'':' idx'}${pf3Sel===tk?' active':''}" style="${pf3GridTpl(port,xc||[])}" onclick="pf3Select('${tk}')">
    ${logoHTML(tk,ccy,'pf3-row-logo')}
    <div class="pf3-row-name"><b>${flag}${name||tk}</b><span>${tk}</span></div>
    <div class="pf3-c pf3-c-sec">${r[4]&&r[4]!=='—'?r[4]:'—'}</div>
    <div class="pf3-c pf3-c-typ"><span class="pf3-typ${PF3_TYPE_META[r[5]]?' '+PF3_TYPE_META[r[5]][1]:''}">${PF3_TYPE_META[r[5]]?PF3_TYPE_META[r[5]][0]+' ':''}${r[5]&&r[5]!=='—'?T(r[5]):'—'}</span></div>
    ${cells}
    ${(xc||[]).map(k=>`<div class="pf3-c pf3-c-x">${pf3XCell(it,k)}</div>`).join('')}
    <div class="pf3-c pf3-c-crit">${it.critHtml||''}</div>
    <div class="pf3-c pf3-c-sig">${pf3RowSignal(d,r)}</div>
    <div class="pf3-row-act">${isAdmin()?`<button class="pf3-del" onclick="pf3Delete('${tk}',event)" title="${T('Удалить акцию')}">🗑</button>`:''}<span class="pf3-row-arr">${pf3Sel===tk?'✕':'›'}</span></div>
  </div>`;
}

function pf3ListHTML(){
  const d=pf3D(),port=pf3IsPort(v3Key);
  const xc=pf3XActive(d);
  const {items}=pf3Items();
  const k=pf3Sort.key,dir=pf3Sort.dir;
  items.sort((a,b)=>{const x=a[k],y=b[k];return(typeof x==='string'?x.localeCompare(y,'ru'):x-y)*dir});
  return items.map(it=>pf3RowHTML(d,it,port,xc)).join('');
}

// «Сектора» / «Тип» блоки вкладки «Структура»: слева список категорий, клик
// показывает её бумаги справа (по умолчанию крупнейшая). Выбор хранится отдельно
// по ключу ('sec'/'typ'), чтобы оба блока на одной странице не конфликтовали;
// неизвестное имя после переключения вкладок откатывается к первой группе.
let pf3TypeSel={};
function pf3TypeSelect(key,g){pf3TypeSel[key]=g;renderPF3()}
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
function pf3Groups(key){
  const d=pf3D(),port=pf3IsPort(v3Key);
  const {items,totalVal}=pf3Items();
  const groups={};
  items.forEach(it=>{
    const g=(key==='sec'?(port?it.sec:pf3MacroSector(it.sec)):it.typ);
    const name=g&&g!=='—'?g:'Прочее';
    (groups[name]=groups[name]||[]).push(it);
  });
  const list=Object.entries(groups).map(([g,arr])=>({g,arr,val:arr.reduce((a,x)=>a+x.val,0)}));
  list.sort((a,b)=>port?b.val-a.val:b.arr.length-a.arr.length);
  list.forEach(x=>x.arr.sort((a,b)=>port?b.val-a.val:b.day-a.day));
  return {d,port,totalVal,list};
}
function pf3GroupSub(x,port,totalVal,d){
  const avgDay=x.arr.reduce((a,it)=>a+it.day,0)/x.arr.length;
  return port
    ?`${x.arr.length} ${T('акц.')} · ${pf3Money(d||pf3D(),x.val)} · ${totalVal>0?(x.val/totalVal*100).toFixed(1):'0'}% ${T('портфеля')}`
    :`${x.arr.length} ${T('акц.')} · ${T('ср. за день')} ${(avgDay>0?'+':'')+avgDay.toFixed(2)}%`;
}

// Иконки секторов (по ключевым словам; работают и для макро-, и для детальных имён).
const PF3_SEC_ICONS=[[/золот|gold|silver|серебр|добыч золота|драгоцен/i,'⛏️'],[/bitcoin|крипт/i,'₿'],[/кибер|cyber/i,'🛡️'],[/полупровод|чип|chip|semicond|memory/i,'💾'],[/интернет и реклама|соцсет|реклам|search|ad tech/i,'🌐'],[/e-?comm|путешеств|туризм|travel|hotel|restaurant|delivery/i,'🛒'],[/финанс|недвиж|fintech|payment|reit/i,'🏦'],[/здравоохран|фарма|pharma|био|biotech|med/i,'💊'],[/потребитель|staples|beverage|retail/i,'🛍️'],[/медиа|телеком|telecom|streaming|gaming|media|cable/i,'📡'],[/энерг|power|oil|solar|utilit|nuclear/i,'⚡'],[/железо|сети|networking|server|hardware|distribution/i,'🖥️'],[/софт|облако|software|cloud|данн|analytics|database|\bai\b|ии/i,'☁️'],[/промышл|транспорт|оборон|industrial|logistic|truck|defen/i,'🏭']];
const secIcon=s=>{for(const[re,i]of PF3_SEC_ICONS)if(re.test(s||''))return i;return '🏭'};
function pf3GroupedHTML(key){
  const {d,port,totalVal,list}=pf3Groups(key);
  if(!list.length)return '<section class="pf3-panel"><div class="pf3-empty">Нет данных</div></section>';
  const ico=g=>key==='sec'?secIcon(g):(PF3_TYPE_META[g]?PF3_TYPE_META[g][0]:'🏷');
  const sel=list.find(x=>x.g===pf3TypeSel[key])||list[0];
  const nav=list.map(x=>`<div class="pf3-typenav-it${x.g===sel.g?' active':''}" onclick="pf3TypeSelect('${key}','${x.g.replace(/'/g,"\\'")}')">
      <span class="pf3-typenav-ico">${ico(x.g)}</span>
      <span class="pf3-typenav-name">${T(x.g)}<small>${port?pf3Money(d,x.val)+' · '+(totalVal>0?(x.val/totalVal*100).toFixed(1):'0')+'%':x.arr.length+' '+T('акц.')}</small></span>
      <span class="pf3-typenav-cnt">${x.arr.length}</span>
    </div>`).join('');
  return`<div class="pf3-typelay ${key}">
    <aside class="pf3-panel pf3-typenav"><div class="pf3-panel-hd"><span>${key==='sec'?T('Сектора'):T('Типы')}</span></div>${nav}</aside>
    <section class="pf3-panel"><div class="pf3-panel-hd"><span>${ico(sel.g)} ${T(sel.g)}</span><span class="pf3-asof">${pf3GroupSub(sel,port,totalVal,d)}</span></div><div class="pf3-glist">${sel.arr.map(it=>pf3RowHTML(d,it,port)).join('')}</div></section>
  </div>`;
}

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
  const flag={USD:'🇺🇸',EUR:'🇪🇺',SEK:'🇸🇪',NOK:'🇳🇴',DKK:'🇩🇰'}[ccy]||'';
  const row=[d.rows.length+1,PF3_NAMES[t]||t,t,flag,'—','Акция',sh||0,buy||0,ccy,buy||0,0,0,0,0,'—','—','','','',0,0,'⚪ Держать'];
  while(row.length<d.headers.length)row.push('');
  d.rows.push(row);
  d.count=d.rows.length;
  if(d.removed)d.removed=d.removed.filter(x=>x!==t);   // re-adding cancels an earlier delete
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
  pf3Refresh(true);     // pull live price/levels + targets/metrics + re-score types
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

// Delete a stock from Портфель 3.0. Remembered in d.removed so the 2.0 sync
// migration doesn't immediately re-import it.
function pf3Delete(tk,ev){
  if(ev)ev.stopPropagation();
  const d=pf3D(),i=d.rows.findIndex(r=>String(r[2]||'')===tk);
  if(i<0)return;
  if(!confirm(T('Удалить')+' '+tk+' ('+TAB_LABEL(v3Key)+')?'))return;
  d.rows.splice(i,1);
  d.rows.forEach((r,j)=>r[0]=j+1);
  d.count=d.rows.length;
  (d.removed=d.removed||[]).push(String(tk).trim().toUpperCase());
  if(pf3Sel===tk)pf3Sel=null;
  scheduleSave();
  init();
  toast(tk+' удалён');
}

function renderPF3(){
  const el=document.getElementById('pf3Area'),d=pf3D();
  if(!el||!d)return;
  // Асинхронные хвосты (обновление цен/таргетов/риска) не должны подменять
  // контент, если пользователь уже ушёл на Home/другую вкладку.
  if(curIdx!==v3Key)return;
  if(pf3IsPort(v3Key))pfSumPPStart(v3Key);else pfSumPPStop();   // лайв изм. баланса по пре/пост-рынку
  editScheduleWire();   // перевесить drag на карточки сводки после перерисовки pf3
  if(pf3Tab==='alloc'){   // объединённая вкладка: Сектора + Тип + Диверсификация (каждый блок — по своему праву)
    const port=pf3IsPort(v3Key);
    const secB=can('view.sectors')?pf3GroupedHTML('sec'):'';
    const typB=can('view.type')?pf3GroupedHTML('typ'):'';
    const divB=(port&&can('view.diversification'))?pf3DiversHTML():'';
    el.innerHTML=`<div class="pf3-wrap">${port?pf3Summary():""}${secB}${typB}${divB}</div>`;
    return;
  }
  if(pf3Tab==='sim'){
    el.innerHTML=`<div class="pf3-wrap">${simTabHTML()}</div>`;
    return;
  }
  if(pf3Tab==='cal'){
    el.innerHTML=`<div class="pf3-wrap">${pf3IsPort(v3Key)?pf3Summary():""}${pf3CalendarHTML()}</div>`;
    pf3LoadCalendar();   // no-op when cached; re-renders this tab when done
    return;
  }
  if(pf3Tab==='tax'){
    el.innerHTML=`<div class="pf3-wrap">${pf3IsPort(v3Key)?pf3Summary():""}${pfTaxHTML()}</div>`;
    return;
  }
  if(pf3Tab==='trades'){
    el.innerHTML=`<div class="pf3-wrap">${pf3IsPort(v3Key)?pf3Summary():""}${pfTradesHTML()}</div>`;
    return;
  }
  if(pf3Tab==='plan'){
    el.innerHTML=`<div class="pf3-wrap">${pf3IsPort(v3Key)?pf3Summary():""}${planRulesHTML()}</div>`;
    planCheck();   // сверить уровни и уведомить о новых достигнутых
    return;
  }
  if(pf3Tab==='fcast'){
    el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${pf3ForecastHTML()}</div>`;
    return;
  }
  if(pf3Tab==='health'){
    el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${pf3HealthTab()}</div>`;
    pf3LoadRisk();   // Шарп/CAGR/волатильность — догружаются и подставляются в pf3RiskBox
    return;
  }
  if(pf3Tab==='ai'){
    el.innerHTML=`<div class="pf3-wrap">${pf3IsPort(v3Key)?pf3Summary():''}${pf3AiHTML()}</div>`;
    aiChatScroll();   // держим чат прокрученным к последнему сообщению
    return;
  }
  if(pf3Tab==='prop'){
    el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${pf3PropHTML()}</div>`;
    return;
  }
  if(pf3Tab==='analysis'){
    el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${pf3AnalysisHTML()}</div>`;
    return;
  }
  if(pf3Tab==='backtest'){
    el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${pf3BacktestHTML()}</div>`;
    return;
  }
  if(pf3Tab==='aim'){
    el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${aipManageHTML()}</div>`;
    return;
  }
  if(pf3Tab==='stats'){   // 📊 Статистика: сравнение всех портфелей + индексы (только админ, только Портфель)
    if(!isAdmin()||v3Key!==PF3_KEY){pf3Tab='list';}
    else{
      el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${pfPerfHTML()}${pfCmpHTML()}${pfDeepCmpHTML()}</div>`;
      pfPerfDraw();   // дорисовать график развития портфелей
      return;
    }
  }
  if(pf3Sel&&!d.rows.some(r=>String(r[2]||'')===pf3Sel))pf3Sel=null;
  const open=!!pf3Sel;
  el.innerHTML=`<div class="pf3-wrap">${pf3IsPort(v3Key)?pf3Summary():""}<div class="pf3-layout${open?' open':''}">
    ${open?`<div class="pf3-detail">${pf3DetailHTML()}</div>`:''}
    <aside class="pf3-list">
      <div class="pf3-list-hd"><span>${T('📋 Акции')} · ${TAB_LABEL(v3Key)}</span>${open?'':`<span class="pf3-hd-act">${pf3XC(d).includes('reco')?`<span class="pf3-hz-seg" title="${RT('Горизонт колонки «Рекомендация»','«Recommendation» column horizon')}">${[['now','⏱ '+RT('Сейчас','Now')],['mid','📅 6–9'+RT('м','m')],['long','🚀 '+RT('Лонг','Long')]].map(([k,l])=>`<button class="pf3-hz-b${k===pf3Hz?' on':''}" onclick="pf3SetHz('${k}')">${l}</button>`).join('')}</span>`:''}<button class="pf3-btn pf3-btn-sm" onclick="pf3XMenuToggle(event)">⚙ ${T('Колонки')}</button>${can('action.refresh_data')?`<button class="pf3-btn pf3-btn-sm" id="pf3RefreshBtn" onclick="pf3Refresh()">${T('🔄 Обновить акции')}</button>`:''}${pf3XMenuHTML(d)}</span>`}</div>
      ${pf3ListHead()}
      ${pf3ListHTML()}
      ${open||!can('action.add_position')||v3Key===AIP_KEY?'':`<form class="pf3-add" onsubmit="pf3Add(event)">
        <input id="pf3AddTicker" placeholder="${T('Тикер')}" autocomplete="off">
        ${pf3MyPort(v3Key)?`<input id="pf3AddQty" type="number" step="any" min="0" placeholder="${T('Кол-во')}">
        <input id="pf3AddBuy" type="number" step="any" min="0" placeholder="${T('Цена покупки')}">`:''}
        <select id="pf3AddCcy"><option${pf3MyPort(v3Key)?'':' selected'}>USD</option><option>EUR</option><option${pf3MyPort(v3Key)?' selected':''}>SEK</option><option>NOK</option><option>DKK</option></select>
        <button class="pf3-btn" type="submit">${T('➕ Добавить акцию')}</button>
      </form>
      <div class="pf3-empty" style="padding:4px 4px">${T('Нажмите на строку — карточка с полными данными откроется слева от списка')}</div>`}
    </aside>
  </div></div>`;
  if(open){
    const r=d.rows[pf3SelIdx()];
    pf3State.row=r;pf3State.ccy=r[8]||'USD';
    drawChart(pf3State,'pf3ChartBox','pf3Legend');
    pf3LoadFundamentals();   // no-op when cached; re-renders the health cards when done
    pf3LoadEarnings();       // same for the earnings calendar panel
    pf3RefreshCardPrice(d,r);   // живая цена → актуальный «потенциал роста»
    cardPPStart(String(r[2]||''),exSymbol(r[2],r[8]));   // лайв pre/post-маркет
  }
}

// The full card for the selected holding (everything: hero, stats, health, earnings, chart, buy levels).

// ===== 📈 Развитие портфеля (как у брокера): композит портфеля vs бенчмарки =====
// Истории всех бумаг за 3 года → дневные доходности, взвешенные ТЕКУЩИМИ долями
// позиций (приближение: состав считается неизменным), кумулятив в %.
// Бенчмарки сравниваются от начала выбранного периода. Кеш 6 часов.
// Все семейные портфели + индексы OMXS30/Nasdaq 100, цвета линий настраиваются,
// старт по умолчанию — с прошлой пятницы. Кеш 6 часов.
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
  try{await pf3Refresh(true)}catch(e){}   // свежие цены → веса/вклад/концентрация/валюты
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
  if(!LWC||!LWC.createChart)return;
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
  if(pfpOn('__ALL__')){const ser=pfPerf.hist.ports['__ALL__'],dd=ser&&mk(ser);if(dd)chart.addLineSeries({color:pfpCol('__ALL__',PFP_ALL_DEF),lineWidth:3.5,priceFormat:fmt}).setData(dd);}
  pfpPorts().forEach(p=>{if(!pfpOn(p.key))return;const ser=pfPerf.hist.ports[p.key],dd=ser&&mk(ser);if(dd)chart.addLineSeries({color:pfpCol(p.key,p.def),lineWidth:2,priceFormat:fmt}).setData(dd);});
  PFP_BENCH.forEach(([sym,,def])=>{if(!pfpOn(sym))return;const ser=pfPerf.hist.bench[sym],dd=ser&&mk(ser);if(dd)chart.addLineSeries({color:pfpCol(sym,def),lineWidth:1.5,priceFormat:fmt,priceLineVisible:false,lastValueVisible:false}).setData(dd);});
  chart.timeScale().fitContent();
  _pfPerfChart=chart;
}
// ===== Симуляция: тестовые покупки без реальных денег =====
// Живая цена тикера — из строк любой v3-вкладки (портфель, затем индекс).
function simQuote(tk){
  for(const k of v3Tabs()){
    const d=DATA[k];if(!d)continue;
    const r=d.rows.find(x=>String(x[2]||'').trim().toUpperCase()===tk);
    if(r)return{price:parseFloat(r[7])||0,ccy:r[8]||'USD',day:parseFloat(r[10]),name:String(r[1]||tk),flag:r[3]&&r[3]!=='—'?r[3]+' ':''};
  }
  return null;
}
const simHomeTab=tk=>v3Tabs().find(k=>DATA[k]&&DATA[k].rows.some(r=>String(r[2]||'').trim().toUpperCase()===tk));
// Старые записи без привязки к вкладке — раскладываем по родным вкладкам тикера.
function simMigrateTabs(){
  let ch=false;
  SIM.forEach(s=>{if(!s.tab){s.tab=simHomeTab(s.tk)||PF3_KEY;ch=true}});
  if(ch&&!applyingRemote)scheduleSave();
}
function simAdd(tk){
  const q=parseFloat(document.getElementById('simQty').value);
  const p=parseFloat(document.getElementById('simPrice').value);
  if(!(q>0)||!(p>0)){alert('Укажите количество и цену покупки');return;}
  const i=simQuote(tk)||{};
  SIM.push({tab:v3Key,tk,name:String(i.name||tk),ccy:i.ccy||'USD',qty:q,buy:p,date:new Date().toISOString().slice(0,10)});
  scheduleSave();renderPF3();
}
function simRemove(idx){
  const s=SIM[idx];if(!s)return;
  if(!confirm(`Закрыть тестовую позицию ${s.tk} (${pf3Fmt(s.qty)} акц.)?`))return;
  SIM.splice(idx,1);scheduleSave();renderPF3();
}
// Блок «Симуляция» в карточке акции: открытые тестовые позиции + форма покупки.
function simSection(tk,price,ccy){
  const mine=SIM.map((s,i)=>({s,i})).filter(x=>x.s.tk===tk&&(x.s.tab||PF3_KEY)===v3Key);
  const rows=mine.map(({s,i})=>{
    const inv=s.qty*s.buy,val=price>0?s.qty*price:null;
    const plp=val!=null&&inv>0?(val/inv-1)*100:null;
    return`<div class="sim-row">
      <span class="sim-d">${s.date}</span>
      <span>${pf3Fmt(s.qty)} × ${pf3Fmt(s.buy,2)} ${s.ccy}</span>
      <span>${pf3Fmt(inv)} → ${val!=null?pf3Fmt(val):'—'} ${s.ccy}</span>
      <span class="${plp==null||plp>=0?'pf3-up':'pf3-down'}">${plp==null?'—':(plp>0?'+':'')+plp.toFixed(1)+'%'+(val!=null?' ('+(val-inv>0?'+':'')+pf3Fmt(val-inv)+' '+s.ccy+')':'')}</span>
      <button class="pf3-del" onclick="simRemove(${i})" title="Закрыть тестовую позицию">🗑</button>
    </div>`;
  }).join('');
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${T('🧪 Симуляция')}</span><span class="pf3-asof">${T('тестовый режим — без реальных денег')}</span></div>
    ${rows||'<div class="pf3-empty">Тестовых позиций по этой акции нет — купите ниже и следите за результатом здесь и во вкладке «🧪 Симуляция» (группа Portfolio)</div>'}
    <form class="sim-form" onsubmit="event.preventDefault();simAdd('${tk}')">
      <label>${T('Кол-во')} <input id="simQty" type="number" step="any" min="0" placeholder="10"></label>
      <label>${T('Цена покупки')} (${ccy}) <input id="simPrice" type="number" step="any" min="0" value="${price>0?price:''}"></label>
      <button class="pf3-btn sim-buy" type="submit">${T('🧪 Купить (тест)')}</button>
    </form>
  </section>`;
}
// Саб-вкладка «Симуляция»: весь бумажный портфель с итогами в kr.
// all=true — агрегированная вкладка 🧪 Симуляция: позиции со ВСЕХ вкладок вместе
// (с ярлыком исходного портфеля у каждой строки).
function simTabHTML(all){
  let inv=0,val=0,known=true;
  const portNm=tab=>{const k=tab||PF3_KEY;return k===AIP_KEY?'AI-Portfolio':String(TAB_LABEL(k)||k).replace(/^Portfolio\s*\((.+)\)$/i,'$1')};
  const mine=SIM.map((s,i)=>({s,i})).filter(x=>all||(x.s.tab||PF3_KEY)===v3Key);
  const rows=mine.map(({s,i})=>{
    const q=simQuote(s.tk),price=q&&q.price>0?q.price:0,fx=FX[s.ccy]||1;
    const invS=s.qty*s.buy*fx,valS=price>0?s.qty*price*fx:null;
    inv+=invS; if(valS!=null)val+=valS; else known=false;
    const plp=valS!=null&&invS>0?(valS/invS-1)*100:null;
    return`<div class="sim-trow" onclick="simOpen('${s.tk}')">
      ${logoHTML(s.tk,s.ccy,'pf3-row-logo')}
      <div class="pf3-row-name"><b>${q?q.flag:''}${s.name||s.tk}</b><span>${s.tk} · ${T('куплено')} ${s.date}${all?` · <span class="sim-port">💼 ${portNm(s.tab)}</span>`:''}</span></div>
      <div class="pf3-c">${pf3Fmt(s.qty)}</div>
      <div class="pf3-c">${pf3Fmt(s.buy,2)} ${s.ccy}</div>
      <div class="pf3-c">${price>0?pf3Fmt(price,2)+' '+s.ccy:'—'}${q&&isFinite(q.day)?`<small class="${q.day>=0?'pf3-up':'pf3-down'}"> ${q.day>0?'+':''}${q.day.toFixed(2)}%</small>`:''}</div>
      <div class="pf3-c">${pf3Fmt(invS)} kr</div>
      <div class="pf3-c"><b>${valS!=null?pf3Fmt(valS)+' kr':'—'}</b></div>
      <div class="pf3-c ${plp==null||plp>=0?'pf3-up':'pf3-down'}">${plp==null?'—':(plp>0?'+':'')+plp.toFixed(1)+'%'}</div>
      <div class="pf3-row-act"><button class="pf3-del" onclick="simRemove(${i});event.stopPropagation()" title="Закрыть позицию">🗑</button></div>
    </div>`;
  }).join('');
  const pl=val-inv,plp=inv>0?pl/inv*100:0;
  const sum=mine.length?`<section class="pf3-cards">
    <div class="pf3-card"><div class="pf3-card-l">${T('Вложено (тест)')}</div><div class="pf3-card-v">${pf3Fmt(inv)} kr</div><div class="pf3-card-s">${mine.length} ${T('позиц.')}</div></div>
    <div class="pf3-card"><div class="pf3-card-l">${T('Стоимость сейчас')}</div><div class="pf3-card-v">${known?pf3Fmt(val)+' kr':'—'}</div><div class="pf3-card-s">${T('по живым ценам и курсу')}</div></div>
    <div class="pf3-card"><div class="pf3-card-l">${T('Результат')}</div><div class="pf3-card-v ${pl>=0?'pf3-up':'pf3-down'}">${known?(pl>0?'+':'')+pf3Fmt(pl)+' kr':'—'}</div><div class="pf3-card-s ${plp>=0?'pf3-up':'pf3-down'}">${known?(plp>0?'+':'')+plp.toFixed(1)+'%':''}</div></div>
  </section>`:'';
  return`${sum}<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${all?RT('🧪 Симуляция — все портфели','🧪 Simulation — all portfolios'):T('🧪 Тестовый портфель')+' — '+TAB_LABEL(v3Key)}</span><span class="pf3-asof">${T('покупка — в карточке акции, кнопка «Купить (тест)»')}</span></div>
    <div class="sim-thead"><span></span><span>${T('Акция')}</span><span>${T('Кол-во')}</span><span>${T('Покупка')}</span><span>${T('Цена')}</span><span>${T('Вложено')}</span><span>${T('Стоимость')}</span><span>${T('П/У')}</span><span></span></div>
    ${rows||'<div class="pf3-empty">Пока пусто. Откройте карточку любой акции и нажмите «🧪 Купить (тест)» — позиция появится здесь.</div>'}
  </section>`;
}
// Клик по строке теста — открыть карточку акции (на вкладке, где она есть).
function simOpen(tk){
  const home=simHomeTab(tk);
  if(!home||!tabAllowed(home))return;
  curIdx=home;v3Key=home;pf3Sel=tk;pf3Tab='list';renderAll();
}


// ===== 🔁 Дубли (админ): какие бумаги повторяются между индексными вкладками =====
// Считается на лету из текущих данных вкладок; кнопка «Обновить» пересчитывает.
function dupScan(){
  const seen={};
  v3Tabs().filter(k=>k!==PF3_KEY&&DATA[k]).forEach(k=>{
    DATA[k].rows.forEach(r=>{
      const sym=exSymbol(r[2],r[8]);
      if(!sym)return;
      (seen[sym]=seen[sym]||[]).push({tab:k,r});
    });
  });
  const exact=Object.entries(seen).filter(([,a])=>a.length>1)
    .map(([sym,a])=>({sym,a,name:String(a[0].r[1]||sym)}))
    .sort((x,y)=>x.name.localeCompare(y.name,'ru'));
  // Кросс-листинги: одно имя компании — разные биржевые символы.
  const byName={};
  Object.entries(seen).forEach(([sym,a])=>{
    const nm=String(a[0].r[1]||'').trim().toLowerCase();
    if(nm)(byName[nm]=byName[nm]||{name:String(a[0].r[1]),syms:{}}).syms[sym]=a;
  });
  const cross=Object.values(byName).filter(x=>Object.keys(x.syms).length>1);
  return{exact,cross};
}
function dupRow(name,tk,ccy,r,tabs){
  const price=parseFloat(r[7])||0,day=parseFloat(r[10]);
  return`<div class="home-row" onclick="simOpen('${String(tk).replace(/'/g,"\\'")}')">
    ${logoHTML(tk,ccy,'pf3-row-logo')}
    <div class="pf3-row-name"><b>${name}</b><span>${tk}</span></div>
    <div class="home-px"><b>${price>0?pf3Fmt(price,2):'—'} ${ccy||''}</b>${isFinite(day)?`<span class="${day>=0?'pf3-up':'pf3-down'}">${day>0?'+':''}${day.toFixed(2)}%</span>`:''}</div>
    <div class="dup-tabs">${tabs.map(t2=>`<span class="pf3-chip">${T(t2)}</span>`).join('')}</div>
  </div>`;
}
function dupHTML(){
  const {exact,cross}=dupScan();
  const ts=new Date().toLocaleTimeString(LANG==='en'?'en-GB':'ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  let h=`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${RT('🔁 Дубли между вкладками','🔁 Duplicates across tabs')} <b>${exact.length}</b></span>
    <span class="pfp-chips"><span class="pf3-asof">${RT('пересчитано в','computed at')} ${ts}</span><button class="pf3-btn pf3-btn-sm" onclick="renderAll()">🔄 ${RT('Обновить','Refresh')}</button></span></div>
    <div class="pf3-empty" style="padding:4px 4px 10px">${RT('Одна и та же бумага в составе нескольких индексов (портфель не учитывается). Это нормально — индексы пересекаются; вкладка нужна для контроля.','The same security in several indexes (portfolio excluded). This is expected — indexes overlap; this tab is for oversight.')}</div>
    ${exact.map(x=>dupRow(x.name,String(x.a[0].r[2]),x.a[0].r[8],x.a[0].r,[...new Set(x.a.map(e=>e.tab))])).join('')||`<div class="pf3-empty">${T('Нет данных')}</div>`}
  </section>`;
  if(cross.length){
    h+=`<section class="pf3-panel">
      <div class="pf3-panel-hd"><span>${RT('🌍 Кросс-листинги — одна компания, разные биржи','🌍 Cross-listings — one company, different exchanges')} <b>${cross.length}</b></span></div>
      ${cross.map(x=>Object.entries(x.syms).map(([sym,a])=>dupRow(x.name,String(a[0].r[2]),a[0].r[8],a[0].r,[...new Set(a.map(e=>e.tab))])).join('')).join('<div class="dup-sep"></div>')}
    </section>`;
  }
  return h;
}
// ===== 🏠 Home: виджеты сигналов и уровней по акциям обеих v3-вкладок =====
// Собирает все акции из доступных пользователю вкладок (портфель в приоритете
// при дубликатах тикера) с сигналом и рыночной фазой каждой.
function homeItems(){
  const out=[];
  v3Tabs().filter(k=>DATA[k]&&tabAllowed(k)).forEach(k=>{
    DATA[k].rows.forEach((r,i)=>{
      recalcPF(i,k);
      const tk=String(r[2]||'').trim().toUpperCase();
      if(!tk||out.some(x=>x.tk===tk))return;
      out.push({tk,name:String(r[1]||tk),flag:r[3]&&r[3]!=='—'?r[3]+' ':'',price:parseFloat(r[7])||0,ccy:r[8]||'USD',
        day:parseFloat(r[10]),sig:pf3SignalInfo(DATA[k],r),crit:pf3Criterion(DATA[k],r),port:k===PF3_KEY&&(parseFloat(r[6])||0)>0});
    });
  });
  return out;
}
function homeRowHTML(x,extra){
  return`<div class="home-row" onclick="simOpen('${x.tk}')">
    ${logoHTML(x.tk,x.ccy,'pf3-row-logo')}
    <div class="pf3-row-name"><b>${x.flag}${x.name}</b><span>${x.tk}${x.port?' · '+T('в портфеле'):''}</span></div>
    <div class="home-px"><b>${x.price>0?pf3Fmt(x.price,2):'—'} ${x.ccy}</b>${isFinite(x.day)?`<span class="${x.day>=0?'pf3-up':'pf3-down'}">${x.day>0?'+':''}${x.day.toFixed(2)}%</span>`:''}</div>
    ${extra}
  </div>`;
}

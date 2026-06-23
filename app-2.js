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
  ['reco','Рекомендация'],
];
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
  const peC=h.indexOf('P/E'),psC=h.indexOf('P/S'),dyC=h.indexOf('Дивид. %');
  const tgrC=h.findIndex(x=>/таргет 3м/i.test(x));
  const num=(r,i)=>i>=0?(parseFloat(r[i])||0):0;
  const items=d.rows.map((r,i)=>{
    recalcPF(i,v3Key);
    const c=pf3Criterion(d,r);
    const tg=tgC>=0?(parseFloat(r[tgC])||0):0,price=parseFloat(r[7])||0;
    return{r,name:String(r[1]||r[2]||''),sec:String(r[4]||''),typ:String(r[5]||''),qty:parseFloat(r[6])||0,buy:parseFloat(r[9])||0,price,val:parseFloat(r[13])||0,tg,day:parseFloat(r[10])||0,crit:c.rank,critHtml:c.html,
      sma50:num(r,s50),sma100:num(r,s100),sma200:num(r,s200),sup:num(r,supC),res:num(r,resC),
      pe:num(r,peC),ps:num(r,psC),divy:num(r,dyC),beta:num(r,h.indexOf('Beta')),roe:num(r,h.indexOf('ROE')),upside:pf3EffUpside(d,r)||0,tgr:num(r,tgrC),
      ...(()=>{const rc=pf3Reco(d,r);return{reco:({buy:3,wait:2,sell:1,avoid:0})[rc.v]*100+rc.total,recoV:rc.v,recoHint:rc.hint.replace(/"/g,'&quot;')}})()};
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
// ── 📈 Лайв-рынки на Home: фьючерсы + сырьё + мировые индексы ──
// Фьючерсы (=F) трейдятся ~23ч → живой барометр риска; спот-индексы (^…) —
// в часы своей биржи. Всё тянем одним ?symbols= (yahoo: цена + дневное изм. %).
const HOME_MKT_FUT=[['ES=F','S&P 500','S&P 500'],['NQ=F','Nasdaq 100','Nasdaq 100'],['YM=F','Dow Jones','Dow Jones'],['RTY=F','Russell 2000','Russell 2000'],['GC=F','Золото','Gold'],['CL=F','Нефть WTI','WTI Oil'],['^VIX','VIX','VIX']];
const HOME_MKT_IDX=[['^OMX','OMXS30','OMXS30'],['^GDAXI','DAX','DAX'],['^STOXX50E','Euro Stoxx 50','Euro Stoxx 50'],['^FCHI','CAC 40','CAC 40'],['^FTSE','FTSE 100','FTSE 100'],['^N225','Nikkei 225','Nikkei 225']];
let HOME_FUT={},_homeFutTimer=null,_homeFutLoading=false,_homeFutAt=0;
async function homeLoadFutures(){
  if(_homeFutLoading)return;_homeFutLoading=true;
  try{
    const syms=HOME_MKT_FUT.concat(HOME_MKT_IDX).map(x=>x[0]).join(',');
    const j=await fetch(PRICE_PROXY+'?symbols='+encodeURIComponent(syms)).then(r=>r.json()).catch(()=>null);
    if(j&&typeof j==='object'){HOME_FUT=j;_homeFutAt=Date.now();const el=document.getElementById('homeFutWrap');if(el&&curIdx===HOME_KEY)el.innerHTML=homeMktInner();const be=document.getElementById('homeBaroWrap');if(be&&curIdx===HOME_KEY)be.innerHTML=homeBaroInner();}
  }catch(e){}
  _homeFutLoading=false;
}
// 📐 S/R уровни индексов (медленные) — отдельный фон-поллинг раз в 5 мин.
let HOME_LVL={},_homeLvlLoading=false,_homeLvlTimer=null;
async function homeLoadLevels(){
  if(_homeLvlLoading)return;_homeLvlLoading=true;
  try{
    const syms=HOME_MKT_FUT.concat(HOME_MKT_IDX).map(x=>x[0]).join(',');
    const j=await fetch(PRICE_PROXY+'?levels='+encodeURIComponent(syms)).then(r=>r.json()).catch(()=>null);
    if(j&&typeof j==='object'){HOME_LVL=j;const el=document.getElementById('homeFutWrap');if(el&&curIdx===HOME_KEY)el.innerHTML=homeMktInner();const be=document.getElementById('homeBaroWrap');if(be&&curIdx===HOME_KEY)be.innerHTML=homeBaroInner();}
  }catch(e){}
  _homeLvlLoading=false;
}
function homeFutStart(){homeLoadFutures();homeLoadLevels();if(!_homeFutTimer)_homeFutTimer=setInterval(()=>{if(curIdx===HOME_KEY&&!document.hidden)homeLoadFutures();},20000);if(!_homeLvlTimer)_homeLvlTimer=setInterval(()=>{if(curIdx===HOME_KEY&&!document.hidden)homeLoadLevels();},300000);}
function homeFutStop(){if(_homeFutTimer){clearInterval(_homeFutTimer);_homeFutTimer=null;}if(_homeLvlTimer){clearInterval(_homeLvlTimer);_homeLvlTimer=null;}}

// ===== 🔄 Live Sector Tracker (вкладка «Сектора») =====
let SECT={data:null,prev:null,period:'dayPct',at:0,err:null};
let _sectTimer=null,_sectLoading=false;
const SECT_PERIODS=[['dayPct',['день','Day']],['w1',['неделя','1W']],['m1',['месяц','1M']],['m3',['3 мес','3M']],['ytd',['YTD','YTD']]];
// Ключевые слова сектора → GICS ETF, для подсветки секторов, где есть позиции.
const SECT_KW={
  XLK:['технолог','полупровод','софт','semiconduct','software','tech'],
  XLV:['здрав','фарм','биотех','медиц','health','pharma','biotech','medical'],
  XLF:['финанс','банк','страхов','financ','bank','insurance'],
  XLY:['цикличн','ритейл','авто','роскош','discretionary','retail','auto'],
  XLC:['коммуник','медиа','телеком','communication','media','telecom'],
  XLI:['промышл','индустр','машиностро','оборон','аэрокосм','industrial','aerospace','defense'],
  XLP:['защитн','продукт','напит','household','staples','food','beverage'],
  XLE:['энерг','нефт','газ','energy','oil','gas'],
  XLU:['коммунал','электроэнерг','utilit'],
  XLRE:['недвиж','real estate','reit'],
  XLB:['материал','химия','металл','горнодоб','добыч','materials','chemical','metal','mining'],
};
function sectPortfolioSet(){
  const set=new Set();
  Object.keys(DATA).forEach(k=>{if(!pf3MyPort(k))return;(DATA[k].rows||[]).forEach(r=>{if(!((parseFloat(r[6])||0)>0))return;const s=String(r[4]||'').toLowerCase();if(!s)return;for(const etf in SECT_KW){if(SECT_KW[etf].some(kw=>s.includes(kw))){set.add(etf);break;}}});});
  return set;
}
async function sectLoad(force){
  if(_sectLoading)return;
  if(!force&&SECT.data&&SECT.data.marketState!=='REGULAR'&&Date.now()-SECT.at<300000)return;   // вне сессии — реже
  _sectLoading=true;
  try{
    const j=await fetch(PRICE_PROXY+'?action=sectors').then(r=>r.json()).catch(()=>null);
    if(j&&Array.isArray(j.sectors)&&j.sectors.some(s=>s.ok)){SECT.prev=SECT.data?SECT.data.sectors:null;SECT.data=j;SECT.at=Date.now();SECT.err=null;}
    else SECT.err=(j&&j.error)||RT('нет данных','no data');
    const el=document.getElementById('sectWrap');if(el&&curIdx===SECT_KEY)el.innerHTML=sectInner();
    const mk=document.getElementById('sectMkt');if(mk&&curIdx===SECT_KEY)mk.innerHTML=sectMktLbl();
  }catch(e){SECT.err=String(e&&e.message||e);}
  _sectLoading=false;
}
function sectStart(){sectLoad();if(_sectTimer)return;_sectTimer=setInterval(()=>{if(curIdx===SECT_KEY&&!document.hidden)sectLoad();},60000);}
function sectStop(){if(_sectTimer){clearInterval(_sectTimer);_sectTimer=null;}}
function sectSetPeriod(p){SECT.period=p;const el=document.getElementById('sectWrap');if(el)el.innerHTML=sectInner();}
function sectMktLbl(){
  const ms=SECT.data&&SECT.data.marketState;
  const m={REGULAR:'🟢 '+RT('рынок открыт','market open'),PRE:'🌅 '+RT('пре-маркет','pre-market'),POST:'🌙 '+RT('пост-маркет','after-hours'),POSTPOST:'🌙 '+RT('пост-маркет','after-hours'),PREPRE:'🌅 '+RT('пре-маркет','pre-market'),CLOSED:'🔴 '+RT('рынок закрыт','market closed')};
  const lbl=ms?(m[ms]||ms):'';
  const t=SECT.at?new Date(SECT.at).toLocaleTimeString(LANG==='en'?'en-GB':'ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
  return `${lbl}${t?' · '+RT('обновлено','updated')+' '+t+' ET·local':''}`;
}
function sectHTML(){
  return `<section class="pf3-panel sect-panel">
    <div class="pf3-panel-hd"><span>🔄 ${RT('Сектора рынка — ротация','Market sectors — rotation')} <span class="dash-info-btn" onclick="event.stopPropagation();sectInfo()" title="${RT('Что это?','What is this?')}">!</span></span><span class="pf3-asof" id="sectMkt">${sectMktLbl()}</span></div>
    <div id="sectWrap">${sectInner()}</div>
    <div class="pf3-reco-note">${RT('Сектора отслеживаются через SPDR ETF (XLK/XLV/…), бенчмарк — SPY. «Лидер»/«аутсайдер» — статистика доходности за период, не сигнал к сделке. ● — сектор, где у вас есть позиции.','Sectors tracked via SPDR ETFs (XLK/XLV/…), benchmark SPY. «Leader»/«laggard» are period-return facts, not a trade signal. ● — a sector where you hold positions.')}</div>
  </section>`;
}
function sectInner(){
  if(SECT.err&&!SECT.data)return `<div class="pf3-empty">${RT('Не удалось загрузить сектора','Failed to load sectors')}: ${SECT.err}${RT(' (нужен воркер с ?action=sectors)',' (needs worker with ?action=sectors)')}</div>`;
  if(!SECT.data)return `<div class="pf3-empty">⏳ ${RT('Загрузка секторов…','Loading sectors…')}</div>`;
  const per=SECT.period,fld=per,vsKey=(per==='dayPct'?'day':per);
  const val=s=>s.ok?s[fld]:null;
  const rank=arr=>arr.slice().filter(s=>s.ok).sort((a,b)=>{const va=val(a),vb=val(b);return (vb==null?-1e9:vb)-(va==null?-1e9:va)});
  const rows=rank(SECT.data.sectors);
  const prevRank={};if(SECT.prev)rank(SECT.prev).forEach((s,i)=>{prevRank[s.etf]=i;});
  const pset=sectPortfolioSet();
  const maxAbs=Math.max(1,...rows.map(s=>Math.abs(val(s)||0)));
  const cls=v=>v==null?'':v>=0?'pf3-up':'pf3-down';
  const fmt=v=>v==null?'—':`${v>=0?'+':''}${v.toFixed(2)}%`;
  const trIco={up:'▲',down:'▼',side:'▬'};
  const periodBtns=SECT_PERIODS.map(p=>`<button class="pf3-hz-b${per===p[0]?' on':''}" onclick="sectSetPeriod('${p[0]}')">${RT(p[1][0],p[1][1])}</button>`).join('');
  const bench=SECT.data.bench,benchVal=bench?bench[fld]:null;
  const rowHtml=rows.map((s,i)=>{
    const v=val(s),rel=s.vsSpy?s.vsSpy[vsKey]:null,pr=prevRank[s.etf];
    const arrow=pr==null?'':(pr>i?`<span class="sect-arr up">▲${pr-i}</span>`:pr<i?`<span class="sect-arr dn">▼${i-pr}</span>`:'');
    const barW=Math.min(100,Math.abs(v||0)/maxAbs*100),mine=pset.has(s.etf);
    return `<div class="sect-row${mine?' sect-mine':''}">
      <span class="sect-rank">${i+1}${arrow}</span>
      <span class="sect-name">${mine?`<span class="sect-dot" title="${RT('есть позиции','you hold positions')}">●</span> `:''}<b>${RT(s.ru,s.en)}</b> <span class="bp-tk">${s.etf}</span></span>
      <span class="sect-bar"><span class="sect-bar-f ${v>=0?'pos':'neg'}" style="width:${barW}%"></span></span>
      <span class="sect-v ${cls(v)}">${fmt(v)}</span>
      <span class="sect-vs ${cls(rel)}" title="${RT('против SPY','vs SPY')}">${rel==null?'—':(rel>=0?'+':'')+rel.toFixed(2)}</span>
      <span class="sect-tr ${s.trend||'side'}" title="${RT('тренд','trend')}">${trIco[s.trend]||'▬'}</span>
    </div>`;
  }).join('');
  return `<div class="pf3-hz-seg sect-per">${periodBtns}</div>
    <div class="sect-bench">${RT('Бенчмарк','Benchmark')} SPY: <b class="${cls(benchVal)}">${fmt(benchVal)}</b> · vs SPY = ${RT('опережение/отставание сектора','sector over/underperformance')}</div>
    <div class="sect-row sect-head"><span class="sect-rank">#</span><span class="sect-name">${RT('Сектор','Sector')}</span><span class="sect-bar"></span><span class="sect-v">${RT('Доходн.','Return')}</span><span class="sect-vs">vs SPY</span><span class="sect-tr" title="${RT('тренд','trend')}">↕</span></div>
    ${rowHtml}`;
}
function sectInfo(){
  const o=document.getElementById('faqOverlay');if(!o)return;
  document.getElementById('faqCard').innerHTML=`<button class="faq-close" onclick="toggleFaq()">✕</button><h2>🔄 ${RT('Сектора рынка','Market sectors')}</h2><div class="faq-body"><p>${RT('Отслеживает доходность 11 секторов рынка (GICS) через секторные ETF SPDR близко к реальному времени — чтобы видеть ротацию между секторами и сравнивать со своим портфелем.','Tracks the 11 GICS market sectors via SPDR sector ETFs in near-real-time — to watch rotation and compare with your portfolio.')}</p><ul class="dash-bul"><li>${RT('Рейтинг по периодам: день / неделя / месяц / 3 мес / YTD.','Ranking by period: day / week / month / 3m / YTD.')}</li><li>${RT('Колонка vs SPY — опережает сектор рынок или отстаёт.','vs SPY column — is the sector beating or lagging the market.')}</li><li>${RT('Стрелки ▲/▼ — изменение места в рейтинге с прошлого обновления (прогресс ротации).','Arrows ▲/▼ — rank change since the last update (rotation progress).')}</li><li>${RT('● — сектор, где у вас есть позиции (по портфелям).','● — a sector where you hold positions.')}</li><li>${RT('Тренд ▲/▬/▼ — цена ETF относительно скользящих средних.','Trend ▲/▬/▼ — ETF price vs moving averages.')}</li></ul><p class="pf3-asof">${RT('Обновление каждую минуту в торговые часы (реже вне сессии). Справочные данные, не индивидуальная инвестиционная рекомендация.','Updates every minute during market hours (less often off-session). Reference data, not individual investment advice.')}</p></div>`;
  o.classList.remove('hidden');
}
function homeFutAtLbl(){return _homeFutAt?RT('обновлено','updated')+' '+new Date(_homeFutAt).toLocaleTimeString(LANG==='en'?'en-GB':'ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):RT('загрузка…','loading…');}
// Карточка индекса/фьючерса: живая цена (HOME_FUT, 20с) + лестница S/R (HOME_LVL, 5 мин).
function homeIdxCard(sym,label){
  const q=HOME_FUT[sym],lv=HOME_LVL[sym];
  const p=(q&&typeof q.price==='number')?q.price:(lv&&typeof lv.price==='number'?lv.price:null);
  const pct=(q&&typeof q.pct==='number')?q.pct:(lv&&typeof lv.pct==='number'?lv.pct:null);
  const cls=pct==null?'':pct>=0?'pf3-up':'pf3-down';
  const head=`<div class="idx-top"><span class="idx-name">${label}</span><span class="idx-sym">${sym}</span></div>
    <div class="idx-px-row"><span class="idx-px">${p!=null?pf3Fmt(p,2):'—'}</span><span class="idx-ch ${cls}">${pct!=null?(pct>=0?'▲ +':'▼ ')+pct.toFixed(2)+'%':'…'}</span></div>`;
  let ladder='';
  if(lv&&p!=null&&((lv.res&&lv.res.length)||(lv.sup&&lv.sup.length))){
    const row=(tag,v,kind)=>{const d=(v/p-1)*100;return`<div class="idx-lvl ${kind}"><span class="idx-lvl-tag">${tag}</span><span class="idx-lvl-v">${pf3Fmt(v,2)}</span><span class="idx-lvl-d">${d>=0?'+':''}${d.toFixed(1)}%</span></div>`;};
    const res=(lv.res||[]),sup=(lv.sup||[]);
    const resHtml=res.slice().reverse().map((v,i)=>row('R'+(res.length-i),v,'res')).join('');   // дальнее сверху
    const supHtml=sup.map((v,i)=>row('S'+(i+1),v,'sup')).join('');                                // ближнее сверху
    const nowHtml=`<div class="idx-lvl idx-now"><span class="idx-lvl-tag">▸</span><span class="idx-lvl-v">${pf3Fmt(p,2)}</span><span class="idx-lvl-d">${RT('цена','price')}</span></div>`;
    ladder=`<div class="idx-levels">${resHtml}${nowHtml}${supHtml}</div>`;
  }else if(!lv){
    ladder=`<div class="idx-lvl-load">⏳ ${RT('уровни…','levels…')}</div>`;
  }
  let trend='';
  if(lv&&p!=null&&lv.sma50>0&&lv.sma200>0){
    const a=p>lv.sma50,b=p>lv.sma200;
    trend=`<div class="idx-trend ${a&&b?'up':(!a&&!b?'down':'mid')}">${a&&b?'▲ '+RT('выше SMA50/200','above SMA50/200'):(!a&&!b?'▼ '+RT('ниже SMA50/200','below SMA50/200'):'↔ '+RT('между SMA','between SMAs'))}</div>`;
  }
  return`<div class="idx-card">${head}${ladder}${trend}</div>`;
}
function homeFutTiles(list){return list.map(([sym,ru,en])=>homeIdxCard(sym,RT(ru,en))).join('');}
function homeMktInner(){
  const sec=(title,list,sub)=>`<section class="pf3-panel"><div class="pf3-panel-hd"><span>${title} ${infoBtn('markets')}<span class="fut-live">● LIVE</span></span><span class="pf3-asof">${sub}</span></div><div class="idx-grid">${homeFutTiles(list)}</div></section>`;
  return sec('📈 '+RT('Фьючерсы и сырьё','Futures & commodities'),HOME_MKT_FUT,homeFutAtLbl())
    +sec('🌍 '+RT('Мировые индексы','World indices'),HOME_MKT_IDX,RT('спот · в часы торгов биржи · S/R: pivots + свинги','spot · market hours · S/R: pivots + swings'));
}
function homeFuturesHTML(){return`<div id="homeFutWrap">${homeMktInner()}</div>`;}
// 🌡 Барометр перегретости рынков. Композитный индекс 0–100 из УЖЕ загруженных
// живых данных (HOME_FUT — цена/VIX, HOME_LVL — SMA50/200): 0 = страх/перепроданность,
// 100 = эйфория/перегрев. Считается клиентски, без отдельных запросов.
const BARO_EQ=['ES=F','NQ=F','YM=F','RTY=F','^OMX','^GDAXI','^STOXX50E','^FCHI','^FTSE','^N225'];   // только индексы акций (без золота/нефти/VIX)
function homeBarometer(){
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const comps=[];   // {label,score,w,detail}
  // 1) VIX — самоуспокоенность vs страх: низкий VIX → перегрев. 12→100, 30→0.
  const vix=HOME_FUT['^VIX'];
  if(vix&&typeof vix.price==='number'&&vix.price>0)
    comps.push({label:'VIX',score:clamp((30-vix.price)/(30-12)*100,0,100),w:0.30,detail:vix.price.toFixed(1)});
  // Ширина рынка и растяжение по ведущим индексам (цена из HOME_FUT, SMA — из HOME_LVL).
  const px=s=>{const q=HOME_FUT[s],l=HOME_LVL[s];return (q&&q.price>0)?q.price:(l&&l.price>0?l.price:null);};
  const sma=(s,k)=>{const l=HOME_LVL[s],q=HOME_FUT[s];return (l&&l[k]>0)?l[k]:((q&&q[k]>0)?q[k]:null);};
  let n200=0,a200=0,n50=0,a50=0,extSum=0,extN=0;
  BARO_EQ.forEach(s=>{const p=px(s),s50=sma(s,'sma50'),s200=sma(s,'sma200');
    if(p&&s200>0){n200++;if(p>s200)a200++;}
    if(p&&s50>0){n50++;if(p>s50)a50++;extSum+=(p/s50-1)*100;extN++;}});
  // 2) Доля индексов выше SMA200 (широта тренда).
  if(n200>=3)comps.push({label:RT('Выше SMA200','Above SMA200'),score:a200/n200*100,w:0.25,detail:`${a200}/${n200}`});
  // 3) Доля выше SMA50.
  if(n50>=3)comps.push({label:RT('Выше SMA50','Above SMA50'),score:a50/n50*100,w:0.20,detail:`${a50}/${n50}`});
  // 4) Среднее растяжение над SMA50: +6% → 100, −6% → 0.
  if(extN>=3){const ext=extSum/extN;comps.push({label:RT('Растяжение SMA50','SMA50 stretch'),score:clamp(50+ext/6*50,0,100),w:0.25,detail:`${ext>=0?'+':''}${ext.toFixed(1)}%`});}
  if(!comps.length)return null;
  const wSum=comps.reduce((a,c)=>a+c.w,0);
  return {score:Math.round(comps.reduce((a,c)=>a+c.score*c.w,0)/wSum),comps};
}
function baroZone(s){
  if(s>=80)return['🌋',RT('Перегрев · эйфория','Overheated · euphoria'),'baro-z4'];
  if(s>=60)return['🔥',RT('Жарко · повышенный риск','Hot · elevated risk'),'baro-z3'];
  if(s>=40)return['😐',RT('Нейтрально','Neutral'),'baro-z2'];
  if(s>=20)return['❄️',RT('Прохладно','Cool'),'baro-z1'];
  return['🧊',RT('Страх · перепроданность','Fear · oversold'),'baro-z0'];
}
function homeBaroHTML(){return`<div id="homeBaroWrap">${homeBaroInner()}</div>`;}
function homeBaroInner(){
  const hd=`<div class="pf3-panel-hd"><span>🌡 ${RT('Барометр перегретости рынков','Market overheat barometer')} ${infoBtn('baro')}</span><span class="pf3-asof">${homeFutAtLbl()}</span></div>`;
  const b=homeBarometer();
  if(!b)return`<section class="pf3-panel">${hd}<div class="pf3-empty">⏳ ${RT('Ждём котировки индексов…','Waiting for index quotes…')}</div></section>`;
  const [ico,zlbl,zcls]=baroZone(b.score);
  const chips=b.comps.map(c=>`<span class="baro-chip"><b>${c.label}</b> ${c.detail} <i>${Math.round(c.score)}</i></span>`).join('');
  return`<section class="pf3-panel baro ${zcls}">${hd}
    <div class="baro-main"><div class="baro-score"><span class="baro-num">${b.score}</span><span class="baro-max">/100</span></div><div class="baro-zone">${ico} ${zlbl}</div></div>
    <div class="baro-gauge"><div class="baro-needle" style="left:${b.score}%"></div></div>
    <div class="baro-scale"><span>🧊 ${RT('страх','fear')}</span><span>${RT('норма','neutral')}</span><span>${RT('перегрев','overheat')} 🌋</span></div>
    <div class="baro-chips">${chips}</div>
    <div class="pf3-asof baro-note">${RT('Композит из VIX, ширины рынка (выше SMA50/200) и растяжения над SMA50 по ведущим индексам. Справочно, не рекомендация.','Composite of VIX, breadth (above SMA50/200) and stretch over SMA50 across leading indices. Reference only.')}</div>
  </section>`;
}
// 🔮 HOME-прогноз: топ-10 акций по ОЖИДАЕМОЙ доходности на 3 горизонта.
// Та же детерминированная модель, что во вкладке «Прогноз» (pf3Fcast12): путь к
// консенсус-таргету (или фундаменталу ƒ). Считается по живым данным → обновляется
// кнопкой «🔄 Обновить всё» (она освежает цены/таргеты и перерисовывает HOME).
function homeForecastPicks(){
  const seen=new Set(),all=[];
  v3Tabs().forEach(k=>{const d=DATA[k];if(!d||!Array.isArray(d.rows))return;
    d.rows.forEach((r,i)=>{
      const tk=String(r[2]||'').trim().toUpperCase();if(!tk||seen.has(tk))return;
      const price=parseFloat(r[7])||0;if(!(price>0))return;
      recalcPF(i,k);seen.add(tk);
      const f=pf3Fcast12(d,r);
      all.push({tk,name:String(r[1]||tk),ccy:r[8]||'',price,e:f.e,src:f.src});
    });
  });
  all.sort((a,b)=>b.e-a.e);
  return all.slice(0,10);
}
let homeFcast={loading:false,data:null,hz:'h12'};   // AI-прогноз топ-10 (по кнопке)
function homeFcastSetHz(hz){homeFcast.hz=hz;if(curIdx===HOME_KEY)renderAll();}
async function homeFcastAiRun(){
  if(homeFcast.loading||!isAdmin())return;
  homeFcast.loading=true;if(curIdx===HOME_KEY)renderAll();
  try{
    const picks=homeForecastPicks(),tks=new Set(picks.map(p=>p.tk)),num=v=>{const n=parseFloat(v);return isFinite(n)?n:null};
    const positions=[],added=new Set();
    v3Tabs().forEach(k=>{const d=DATA[k];if(!d||!Array.isArray(d.rows))return;d.rows.forEach(r=>{const tk=String(r[2]||'').trim().toUpperCase();if(!tks.has(tk)||added.has(tk))return;added.add(tk);const m=pf3TypeMetrics(d,r);positions.push({ticker:r[2],name:r[1],sector:r[4],ccy:r[8]||'USD',price:num(r[7]),analystTarget:pf3EffTarget(d,r).target||null,upsidePct:pf3EffUpside(d,r),pe:m.pe,roe:m.roe,revGrowth:m.revg,phase:pf3Criterion(d,r).label})})});
    const snap={portfolioName:'HOME · топ-10',baseCurrency:'SEK',horizons:['3 мес','6-9 мес','12+ мес'],positions,playbook:aiPlaybookEnsure()};
    const r=await fetch(PRICE_PROXY+'?action=forecast',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},body:JSON.stringify(snap)});
    const bodyText=await r.text();let j=null;try{j=JSON.parse(bodyText)}catch(_){}
    if(j&&j.forecast&&Array.isArray(j.forecast.stocks)){aiSpendAdd(j.cost);homeFcast.data={stocks:j.forecast.stocks,summary:j.forecast.summary||'',at:new Date().toISOString(),cost:j.cost||null};}
    else toast('AI: '+((j&&j.error)||(bodyText?bodyText.slice(0,200):('HTTP '+r.status))),true);
  }catch(e){toast('AI: '+(e&&e.message||RT('сеть/worker','network/worker')),true);}
  homeFcast.loading=false;if(curIdx===HOME_KEY)renderAll();
}
function homeForecastHTML(){
  const HZ=[['h3',RT('3 мес','3m'),0.33],['h69',RT('6–9 мес','6–9m'),0.66],['h12',RT('12+ мес','12m+'),1.0]];
  const cls=v=>v>=0?'pf3-up':'pf3-down';
  const pct=v=>v==null||isNaN(v)?'—':`<span class="${cls(v)}">${v>=0?'+':''}${v.toFixed(1)}%</span>`;
  const aiBtn=isAdmin()?`<button class="pf3-btn pf3-btn-sm" id="homeFcastBtn" onclick="homeFcastAiRun()"${homeFcast.loading?' disabled':''}>${homeFcast.loading?'⏳ '+RT('Прогноз','Forecasting')+'…':(homeFcast.data?'🔄 '+RT('Обновить AI','Refresh AI'):'✨ '+RT('AI-прогноз','AI forecast'))}</button>`:'';
  let body,sub,note;
  if(homeFcast.data&&Array.isArray(homeFcast.data.stocks)){
    if(!HZ.some(h=>h[0]===homeFcast.hz))homeFcast.hz='h12';
    const hz=homeFcast.hz;
    const rows=homeFcast.data.stocks.map(s=>({tk:String(s.ticker||'').trim().toUpperCase(),h3:parseFloat(s.h3),h69:parseFloat(s.h69),h12:parseFloat(s.h12),note:String(s.note||'')}))
      .filter(s=>s.tk).sort((a,b)=>((isNaN(b[hz])?-1e9:b[hz])-(isNaN(a[hz])?-1e9:a[hz]))).slice(0,10);
    const seg=HZ.map(h=>`<button class="pf3-hz-b${hz===h[0]?' on':''}" onclick="homeFcastSetHz('${h[0]}')">${h[1]}</button>`).join('');
    body=`<div class="pf3-hz-seg" style="margin:2px 0 8px">${seg}</div>${homeFcast.data.summary?`<div class="dash-headline">${pf3Md(homeFcast.data.summary)}</div>`:''}<table class="bp-tbl"><thead><tr><th>#</th><th>${RT('Акция','Stock')}</th>${HZ.map(h=>`<th style="text-align:right">${h[1]}</th>`).join('')}</tr></thead><tbody>${rows.map((s,i)=>`<tr onclick="insiderOpenCard('${s.tk}')"${s.note?` title="${s.note.replace(/"/g,'&quot;')}"`:''}><td class="bp-n">${i+1}</td><td class="bp-name"><b>${s.tk}</b></td>${HZ.map(h=>`<td style="text-align:right">${pct(s[h[0]])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    sub=RT('AI · ранжирование по выбранному горизонту','AI · ranked by the selected horizon')+(homeFcast.data.at?' · '+pf3DtRu(homeFcast.data.at):'')+(homeFcast.data.cost?' · '+costLine(homeFcast.data.cost):'');
    note=RT('AI-прогноз доходности на 3 горизонта (web-поиск свежих таргетов/новостей). Топ-10 переранжируются по выбранному горизонту. Оценка, не индивидуальная рекомендация.','AI forecast of returns across 3 horizons (web search of fresh targets/news). Top-10 re-ranked by the selected horizon. An estimate, not advice.');
  }else{
    const picks=homeForecastPicks();
    const mark={tgt:'',fund:` <span class="fc-flat" title="${RT('по фундаменталу (рост выручки/ROE)','fundamental (revenue growth/ROE)')}">ƒ</span>`,flat:` <span class="fc-flat" title="${RT('нет таргета/данных — без изменения','no target/data — held flat')}">≈</span>`};
    body=picks.length?`<table class="bp-tbl"><thead><tr><th>#</th><th>${RT('Акция','Stock')}</th>${HZ.map(h=>`<th style="text-align:right">${h[1]}</th>`).join('')}</tr></thead><tbody>${picks.map((p,i)=>`<tr onclick="insiderOpenCard('${p.tk}')"><td class="bp-n">${i+1}</td><td class="bp-name"><b>${p.name}</b> <span class="bp-tk">${p.tk}</span>${mark[p.src]||''}</td>${HZ.map(h=>`<td style="text-align:right">${pct(p.e*h[2])}</td>`).join('')}</tr>`).join('')}</tbody></table>`:`<div class="pf3-empty">${RT('Нет данных — нажмите «🔄 Обновить всё».','No data — press «🔄 Update all».')}</div>`;
    sub=RT('детерминированно · «Обновить всё»','deterministic · «Update all»');
    note=homeFcast.loading?RT('⏳ AI Proto собирает свежие данные…','⏳ AI Proto gathering fresh data…'):RT('Ожидаемая доходность от консенсус-таргета аналитиков (или фундаментала ƒ): ~⅓ за 3 мес, ~⅔ за 6–9 мес, полностью за 12+ мес. Топ-10 по 12-мес потенциалу. «✨ AI-прогноз» — версия со свежим веб-поиском. Оценка, не рекомендация.','Expected return from the analyst consensus target (or fundamentals ƒ): ~1/3 in 3m, ~2/3 in 6–9m, full at 12m+. Top-10 by 12m potential. «✨ AI forecast» is the fresh web-search version. An estimate, not advice.');
  }
  return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>🔮 ${RT('Прогноз — топ-10 акций по горизонтам','Forecast — top-10 stocks by horizon')} ${infoBtn('forecast')}</span><span class="pf3-asof">${sub}</span>${aiBtn}</div>${body}<div class="pf3-reco-note">${note}</div></section>`;
}
function homeHTML(){
  // Шапка: статус/время + ОДНА первичная кнопка «Обновить всё»; админ-инструменты — отдельной группой.
  const adminTools=isAdmin()?`<span class="home-admin-tools" title="${RT('Сбор данных (только админ)','Data collection (admin only)')}">
    <button class="pf3-btn pf3-btn-sm" id="insiderBtn" onclick="insiderUpdateAll()" title="${RT('Инсайдерские сделки по всем вкладкам (US: Finnhub · SE: Finansinspektionen)','Insider transactions across all tabs (US: Finnhub · SE: Finansinspektionen)')}">🕵 AI Insider</button>
    <button class="pf3-btn pf3-btn-sm" id="valBtn" onclick="valUpdateAll()" title="${RT('Мультипликаторы vs медиана сектора и собственная история','Multiples vs sector median and own history')}">📐 ${RT('Оценка','Valuation')}</button>
  </span>`:'';
  const head=`<section class="pf3-panel home-head">
    <div class="home-head-l"><span class="home-title">🏠 ${RT('Главная','Home')}</span><span class="pf3-asof">${RT('рынки, уровни и лучшие акции','markets, levels & best stocks')} · ${homeFutAtLbl()}</span></div>
    <div class="home-head-actions"><button class="pf3-btn pf3-btn-primary" id="homeUpdBtn" onclick="homeUpdateAll()">🔄 ${RT('Обновить всё','Update all')}</button><button class="pf3-btn pf3-btn-sm" id="homeNewsBtn" onclick="homeNewsAll()" title="${RT('Подтянуть свежие новости Yahoo по всем акциям — учитываются в рейтинге','Pull fresh Yahoo news for all stocks — factored into the rank')}">📰 ${RT('Новости','News')}</button>${adminTools}</div>
  </section>`;
  // Шапка ВНЕ перетаскиваемой раскладки — всегда сверху и видима (не зависит от сохранённого порядка секций).
  const items=[
    {id:'futures',html:homeFuturesHTML()},
    {id:'baro',html:homeBaroHTML()},
    {id:'best',html:homeBestBoardHTML()},
    {id:'horizons',html:`<details class="home-details"><summary>🏅 ${RT('Разбивка по горизонтам (1–3 · 3–6 · 6–12 мес)','By horizon (1–3 · 3–6 · 6–12 m)')}</summary><div class="home-details-body">${homeBestHTML()}</div></details>`},
    {id:'forecast',html:homeForecastHTML()},
  ];
  if(isAdmin()){ items.push({id:'signal',html:homeSignalHTML()}); items.push({id:'val',html:homeValHTML()}); items.push({id:'insider',html:homeInsiderHTML()}); }
  return head+erow('home',items,'edit-rows-v');
}

// 🧭 Сигналы разворота цикла памяти — модуль-мониторинг тезиса по бумаге.
// Данные качественные (TrendForce DXI, недели запасов, capex гиперскейлеров,
// контрактные DDR5/HBM) — их нет в price-API. Источники значений (приоритет ↓):
//   ✋ ручная правка → ✨ AI (web_search) → ƒ авто-derive (фундаментал) → • дефолт.
// Дефолты (CYCLE_MONITORS) — стартовый снимок; живые правки лежат в CYCLE_OVR (sync).
// Статусы строк: 'ok' (зелёный — тезис цел), 'warn' (жёлтый — ранний варн), 'alert' (красный).
const CYCLE_MONITORS={
  MU:{
    asOf:['~июнь 2026','~Jun 2026'],
    sources:'TrendForce · Micron Q1 FY26 · Luminix/24-7WallSt',
    phasePos:88,phaseLabels:[['дно','bottom'],['разгон','ramp-up'],['пиковая фаза ▲','peak phase ▲']],
    tiers:[
      {title:['Tier 1 · Exit-триггеры','Tier 1 · Exit triggers'],badge:['действовать за 1 квартал','act within 1 quarter'],badgeKind:'alert',rows:[
        {id:'t1_dxi',l:['Spot DRAM (DXI) флэт/вниз 2+ недели','Spot DRAM (DXI) flat/down 2+ weeks'],v:['растёт ↑','rising ↑'],k:'ok'},
        {id:'t1_inv',l:['Запасы в цепочке > 8 нед (порог тревоги)','Channel inventory > 8 wk (alarm threshold)'],v:['2–4 нед ↑','2–4 wk ↑'],k:'ok'},
        {id:'t1_capex',l:['Hyperscaler режет/ухудшает capex-гайденс','Hyperscaler cuts/worsens capex guidance'],v:['+60% г/г ↑','+60% YoY ↑'],k:'ok'},
      ]},
      {title:['Tier 2 · Trim-триггеры','Tier 2 · Trim triggers'],badge:['снизить 20–30%','trim 20–30%'],badgeKind:'warn',rows:[
        {id:'t2_hbm',l:['HBM-контракты падают кв/кв (торг по 2027)','HBM contracts falling QoQ (booked into 2027)'],v:['sold out ↑','sold out ↑'],k:'ok'},
        {id:'t2_margin',l:['Валовая маржа MU вниз 2 кв подряд','MU gross margin down 2 quarters in a row'],v:['~56% ↑','~56% ↑'],k:'ok'},
        {id:'t2_ddr5',l:['DDR5 contract вниз 2 мес подряд','DDR5 contract down 2 months in a row'],v:['растёт ↑','rising ↑'],k:'ok'},
      ]},
    ],
    risk:{title:['Структурный риск (не сигнал, но контекст)','Structural risk (not a signal, but context)'],rows:[
      {id:'risk_capex',l:['Capex MU FY26','MU capex FY26'],v:['$20B ↑ · риск 2027–28','$20B ↑ · risk 2027–28'],k:'warn'},
      {id:'risk_consumer',l:['Consumer (mobile/PC) shipments','Consumer (mobile/PC) shipments'],v:['−2…−9% ↓','−2…−9% ↓'],k:'warn'},
    ]},
    legend:['Зелёный = тезис цел / цикл ещё на подъёме. Жёлтый = ранний варн-сигнал. Память исторически отдаёт 40–60% за 6 мес после пика цен — конфигурация для частичного трима, не полного выхода. Первым мигнёт DXI.','Green = thesis intact / cycle still rising. Amber = early warning. Memory historically gives back 40–60% within 6 months after a price peak — a setup for a partial trim, not a full exit. DXI blinks first.'],
  },
};
// Живые данные по тикеру: { TK:{ ai:{at,cost,title,phasePos,phaseLabels,summary,sources,tiers:[…]}, manual:{phasePos,rows:{id:{v,k}}} } }
// ai.tiers — ПОЛНАЯ структура, сгенерированная AI под конкретную бумагу (свои метрики/пороги).
let CYCLE_OVR={};
let _cycEdit=null;   // тикер в режиме ручной правки (admin)
let _cycBusy=null;   // тикер, по которому идёт AI-прогон
const cycKey=tk=>String(tk||'').trim().toUpperCase();
const cycSlug=s=>String(s||'').toLowerCase().replace(/[^a-zа-яё0-9]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,40);
// ƒ Авто-derive из уже загруженного фундаментала: текущая маржа MU (тренд по 2 кв
// price-API не даёт — поэтому только справочный уровень, статус не перебиваем).
function cycleDerive(tk){
  const out={rows:{}};
  if(cycKey(tk)==='MU'){
    const F=pf3FundData();
    if(F&&typeof F.netIncome==='number'&&F.revenue>0){
      const nm=F.netIncome/F.revenue*100;
      out.rows.t2_margin={v:RT(`тек. чистая маржа ~${nm.toFixed(0)}%`,`cur. net margin ~${nm.toFixed(0)}%`),derived:true};
    }
  }
  return out;
}
const CYC_SRC_MARK={manual:'✋',ai:'✨',derived:'ƒ',def:''};
// Нормализованная модель монитора по приоритету источника: AI-структура → статичный
// сид (CYCLE_MONITORS) → null. Возвращает {src,title,phasePos,phaseLabels,tiers[{title,badge,badgeKind,rows[{id,label,value,status}]}],…}.
function cycMonModel(tk){
  const TK=cycKey(tk),ovr=CYCLE_OVR[TK]||{},ai=ovr.ai;
  if(ai&&Array.isArray(ai.tiers)&&ai.tiers.length){
    const pl=(Array.isArray(ai.phaseLabels)&&ai.phaseLabels.length>=2)?ai.phaseLabels:[['ранняя стадия','early'],['развитие','growth'],['зрелость/перегрев','maturity/overheat']];
    return {src:'ai',at:ai.at,cost:ai.cost,sources:ai.sources||'',summary:ai.summary||'',
      title:ai.title||RT('🧭 Сигналы по тезису','🧭 Thesis signals'),
      phasePos:(typeof ai.phasePos==='number')?ai.phasePos:50,phaseLabels:pl,tiers:ai.tiers};
  }
  const m=CYCLE_MONITORS[TK];
  if(m)return {src:'static',asOf:m.asOf,sources:m.sources,legend:m.legend,summary:'',
    title:m.title||RT('🧭 Сигналы разворота цикла памяти','🧭 Memory-cycle turn signals'),
    phasePos:m.phasePos,phaseLabels:m.phaseLabels,
    tiers:[...m.tiers,...(m.risk?[{title:m.risk.title,badge:null,badgeKind:null,rows:m.risk.rows}]:[])]
      .map(t=>({title:t.title,badge:t.badge,badgeKind:t.badgeKind,rows:t.rows.map(r=>({id:r.id,label:r.l,value:r.v,status:r.k}))}))};
  return null;
}
// Значение строки по приоритету: ручная правка → ƒ derive → база (AI/сид). {v,k,src}.
function cycResolve(model,ovr,der,row){
  const man=ovr.manual&&ovr.manual.rows&&ovr.manual.rows[row.id];
  if(man&&(man.v!=null||man.k))return{v:man.v!=null?man.v:row.value,k:man.k||row.status,src:'manual'};
  const d=der&&der.rows&&der.rows[row.id];
  if(d&&d.v!=null)return{v:d.v,k:row.status,src:'derived'};
  return{v:row.value,k:row.status,src:model.src==='ai'?'ai':'def'};
}
function cycleMonitorHTML(tk){
  const TK=cycKey(tk),ovr=CYCLE_OVR[TK]||{},model=cycMonModel(tk),der=cycleDerive(tk),edit=(_cycEdit===TK)&&isAdmin(),busy=_cycBusy===TK;
  const rt=p=>Array.isArray(p)?RT(p[0],p[1]):String(p==null?'':p);
  // Нет ни AI, ни сида: для админа — кнопка «сгенерировать тезис-монитор», иначе скрыто.
  if(!model){
    if(!isAdmin())return'';
    return`<section class="pf3-panel cyc"><div class="pf3-panel-hd"><span>🧭 ${RT('Тезис-монитор','Thesis monitor')} ${infoBtn('cycle')}</span></div>
      <p class="pf3-asof">${RT('AI соберёт специфичные для этой бумаги сигнальные метрики (Tier 1/2 + структурный риск) со свежими данными из web_search и порогами.','AI will assemble stock-specific signal metrics (Tier 1/2 + structural risk) with fresh web_search data and thresholds.')}</p>
      <button class="pf3-btn pf3-btn-sm" onclick="cycleMonAiRun('${TK}')"${busy?' disabled':''}>${busy?'⏳ '+RT('Собираю','Building')+'…':'✨ '+RT('Сгенерировать (AI)','Generate (AI)')}</button></section>`;
  }
  const KOPT=[['ok','🟢'],['warn','🟡'],['alert','🔴']];
  const rowHTML=row=>{
    const c=cycResolve(model,ovr,der,row);
    if(edit){
      const sel=KOPT.map(([k,e])=>`<option value="${k}"${k===c.k?' selected':''}>${e}</option>`).join('');
      return`<tr><td class="cyc-l">${rt(row.label)}</td><td class="cyc-v"><select class="cyc-edit-k" onchange="cycManualSet('${TK}','${row.id}','k',this.value)">${sel}</select> <input class="cyc-edit-v" value="${String(rt(c.v)).replace(/"/g,'&quot;')}" onchange="cycManualSet('${TK}','${row.id}','v',this.value)"></td></tr>`;
    }
    const mark=CYC_SRC_MARK[c.src]?`<span class="cyc-src" title="${RT('источник','source')}: ${c.src}">${CYC_SRC_MARK[c.src]}</span>`:'';
    return`<tr><td class="cyc-l">${rt(row.label)}</td><td class="cyc-v">${mark}<span class="cyc-s cyc-s-${c.k}">${rt(c.v)}</span></td></tr>`;
  };
  const card=t=>`<div class="cyc-card"><div class="cyc-card-hd"><span class="cyc-card-t">${rt(t.title)}</span>${t.badge?`<span class="cyc-badge cyc-b-${t.badgeKind||'warn'}">${rt(t.badge)}</span>`:''}</div><table class="cyc-tbl">${(t.rows||[]).map(rowHTML).join('')}</table></div>`;
  const pos=Math.max(0,Math.min(100,(ovr.manual&&typeof ovr.manual.phasePos==='number')?ovr.manual.phasePos:model.phasePos));
  const phase=`<div class="cyc-phase"><div class="cyc-phase-l">${RT('Где бумага в своём цикле','Where the stock is in its cycle')}${edit?` <input type="number" min="0" max="100" class="cyc-edit-pos" value="${pos}" onchange="cycManualSet('${TK}','','phasePos',this.value)">`:''}</div>
    <div class="cyc-gauge"><div class="cyc-needle" style="left:${pos}%"></div></div>
    <div class="cyc-scale">${model.phaseLabels.map((x,i)=>`<span${i===model.phaseLabels.length-1?' class="cyc-now"':''}>${rt(x)}</span>`).join('')}</div></div>`;
  const tiers=model.tiers.map(card).join('');
  const asof=model.src==='ai'?`✨ ${RT('обновлено','updated')} ${pf3DtRu(model.at)}${model.cost?' · '+costLine(model.cost):''}`:`${RT('данные на','data as of')} ${rt(model.asOf)}`;
  const actions=isAdmin()?`<span class="cyc-actions">
    <button class="pf3-btn pf3-btn-sm" onclick="cycleMonAiRun('${TK}')"${busy?' disabled':''}>${busy?'⏳ '+RT('Обновляю','Updating')+'…':(model.src==='ai'?'🔄 '+RT('Обновить (AI)','Refresh (AI)'):'✨ '+RT('Обновить (AI)','Update (AI)'))}</button>
    <button class="pf3-btn pf3-btn-sm" onclick="cycEditToggle('${TK}')">${edit?'✓ '+RT('Готово','Done'):'✏️ '+RT('Правка','Edit')}</button>
    ${(ovr.ai||ovr.manual)?`<button class="pf3-btn pf3-btn-sm" onclick="cycReset('${TK}')" title="${RT('Сбросить','Reset')}">↺</button>`:''}
  </span>`:'';
  const note=model.legend?rt(model.legend):RT('🟢 порог не достигнут / тезис цел · 🟡 близко к порогу или структурный риск · 🔴 порог достигнут — действовать.','🟢 threshold not hit / thesis intact · 🟡 near threshold or structural risk · 🔴 threshold hit — act.');
  return`<section class="pf3-panel cyc">
    <div class="pf3-panel-hd"><span>${rt(model.title)} ${infoBtn('cycle')}</span><span class="pf3-asof">${asof}</span></div>
    ${actions}
    ${phase}
    ${model.summary?`<div class="cyc-summary">${pf3Md(model.summary)}</div>`:''}
    <div class="cyc-cards">${tiers}</div>
    <p class="pf3-asof cyc-note">${note}<br>${model.sources?RT('Источники','Sources')+': '+model.sources+'. ':''}${RT(INFO_DISCLAIM[0],INFO_DISCLAIM[1])}${edit?'<br>✏️ '+RT('режим правки: меняйте цвет и текст; «Готово» — сохранить.','edit mode: change colour & text; «Done» to save.'):''}</p>
  </section>`;
}
// Ручная правка строки/фазы → CYCLE_OVR[tk].manual (sync). Не перерисовываем на каждый
// keystroke (select/blur), чтобы не сбивать фокус; только сохраняем.
function cycManualSet(tk,id,field,val){
  const TK=cycKey(tk);const o=CYCLE_OVR[TK]||(CYCLE_OVR[TK]={});const man=o.manual||(o.manual={rows:{}});
  if(field==='phasePos'){const n=parseFloat(val);man.phasePos=isFinite(n)?Math.max(0,Math.min(100,n)):undefined;}
  else{const row=man.rows[id]||(man.rows[id]={});row[field]=field==='v'?String(val):val;}
  scheduleSave();
}
function cycEditToggle(tk){const TK=cycKey(tk);_cycEdit=(_cycEdit===TK)?null:TK;renderPF3();}
function cycReset(tk){
  const TK=cycKey(tk);
  if(!confirm(RT('Сбросить тезис-монитор (удалить AI и ручные правки)?','Reset the thesis monitor (drop AI & manual edits)?')))return;
  delete CYCLE_OVR[TK];_cycEdit=null;scheduleSave();renderPF3();
}
// ✨ AI + web_search: построить/обновить тезис-монитор бумаги (worker ?action=cyclemon).
// Для бумаги без сида AI сам подбирает специфичные метрики и пороги по сектору/тезису.
async function cycleMonAiRun(tk){
  const TK=cycKey(tk);if(_cycBusy)return;
  _cycBusy=TK;renderPF3();
  try{
    const d=DATA[v3Key];let row=null;
    if(d&&Array.isArray(d.rows))row=d.rows.find(r=>cycKey(r[2])===TK);
    const F=pf3FundData();
    const fundamentals=F?{pe:F.pe,ps:F.ps,revenueYoY:F.revenueYoY,netMarginPct:(typeof F.netIncome==='number'&&F.revenue>0)?Math.round(F.netIncome/F.revenue*100):null,debtToEquity:F.debtToEquity}:null;
    const stat=CYCLE_MONITORS[TK];
    const metricsHint=stat?[...stat.tiers.flatMap(t=>t.rows),...(stat.risk?stat.risk.rows:[])].map(r=>r.l[0]):null;
    const body={mode:'thesis',ticker:TK,name:row?String(row[1]||TK):TK,sector:row?String(row[4]||''):'',type:row?String(row[5]||''):'',price:row?parseFloat(row[7])||null:null,ccy:row?String(row[8]||'USD'):'USD',fundamentals,metricsHint};
    const r=await fetch(PRICE_PROXY+'?action=cyclemon',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},body:JSON.stringify(body)});
    const bodyText=await r.text();let j=null;try{j=JSON.parse(bodyText)}catch(_){}
    if(j&&j.cyclemon){
      const cm=j.cyclemon;
      const tiers=(Array.isArray(cm.tiers)?cm.tiers:[]).map(t=>({title:String(t.title||''),badge:t.badge?String(t.badge):null,badgeKind:['alert','warn','info'].includes(t.badgeKind)?t.badgeKind:null,
        rows:(Array.isArray(t.rows)?t.rows:[]).map((x,i)=>({id:cycSlug(x.label)||('r'+i),label:String(x.label||''),value:x.value!=null?String(x.value):'',status:['ok','warn','alert'].includes(x.status)?x.status:'warn'})).filter(x=>x.label)})).filter(t=>t.rows.length);
      if(tiers.length){
        aiSpendAdd(j.cost);
        const o=CYCLE_OVR[TK]||(CYCLE_OVR[TK]={});
        o.ai={at:new Date().toISOString(),cost:j.cost||null,title:cm.title?String(cm.title):null,
          phasePos:(typeof cm.phasePos==='number')?cm.phasePos:50,
          phaseLabels:Array.isArray(cm.phaseLabels)?cm.phaseLabels.map(String).slice(0,3):null,
          summary:cm.summary?String(cm.summary):'',sources:cm.sources?String(cm.sources):'',tiers};
        scheduleSave();
      }else toast('AI (cycle): '+RT('пустой ответ','empty response'),true);
    }else{const msg=(j&&j.error)||(bodyText?bodyText.slice(0,200):('HTTP '+r.status));toast('AI (cycle): '+msg,true);}
  }catch(e){toast('AI: '+(e&&e.message||RT('сеть/worker недоступен','network/worker unreachable')),true);}
  _cycBusy=null;if(isV3())renderPF3();
}

function pf3DetailHTML(){
  const d=pf3D(),ri=pf3SelIdx();
  recalcPF(ri,v3Key);
  const r=d.rows[ri],h=d.headers,tk=String(r[2]||'');
  const qty=parseFloat(r[6])||0,price=parseFloat(r[7])||0,buy=parseFloat(r[9])||0,ccy=r[8]||'USD';
  const day=parseFloat(r[10]),valSEK=parseFloat(r[13])||0,profit=parseFloat(r[11])||0,ppct=parseFloat(r[12])||0;
  const {s50,s100,s200}=smaIdx(d);
  const supC=h.indexOf('Поддержка'),resC=h.indexOf('Сопротивление'),tgC=h.findIndex(x=>/аналит/i.test(x));
  const target=tgC>=0?parseFloat(r[tgC]):NaN;
  const hasTarget=isFinite(target)&&target>0&&price>0;
  const tgrC=h.findIndex(x=>/таргет 3м/i.test(x));
  const targetR=tgrC>=0?parseFloat(r[tgrC]):NaN;
  const hasTargetR=isFinite(targetR)&&targetR>0&&price>0;
  const tgM=TG_META[tk.toUpperCase()]||{};
  // Флаг «устарел»: основной (за всё время) сильно расходится со свежим срезом —
  // значит старые таргеты тянут среднее, ориентир — свежий.
  const tgDiv=(hasTarget&&hasTargetR&&target>0)?Math.abs(targetR-target)/target*100:0;
  const tgStale=tgDiv>=TG_STALE_PCT;   // TG_STALE_PCT — общий модульный порог
  // Когда «за всё время» устарел — крупно показываем СВЕЖИЙ срез (его же берёт
  // логика рекомендаций через pf3EffTarget), а старое среднее уводим в подпись.
  const effStale=tgStale&&hasTargetR;
  const effT=effStale?targetR:target, effHasT=effStale?hasTargetR:hasTarget, effNa=effStale?tgM.nr:tgM.n;
  const tgRecentLbl=tgM.span==='m'?RT('за месяц','last mo'):RT('за квартал','last qtr');
  const tf=pf3TypeFull(d,r);
  const typeChip=(()=>{const p=(tf&&tf.primary)||r[5];if(!p||p==='—')return '';const m1=PF3_TYPE_META[p];let txt=`${m1?m1[0]+' ':''}${T(p)}`;if(tf&&tf.secondary){const m2=PF3_TYPE_META[tf.secondary];txt+=` · ${m2?m2[0]+' ':''}${T(tf.secondary)}`}return txt})();
  const chips=[tk+(ccy==='USD'?' · NASDAQ':''),r[3],r[4],typeChip].filter(c=>c&&c!=='—').map(c=>`<span class="pf3-chip">${c}</span>`).join('');
  // One technical level row: value + coloured distance from the current price.
  const lvl=(name,v)=>{const n=parseFloat(v);if(!(n>0)||!(price>0))return'';const dist=(price-n)/n*100,up=dist>=0;
    return`<div class="pf3-lvl"><span class="pf3-lvl-name">${name}</span><span class="pf3-lvl-val">${pf3Fmt(n,2)}</span><span class="pf3-lvl-dist ${up?'pf3-up-bg':'pf3-down-bg'}">${up?'▲':'▼'} ${Math.abs(dist).toFixed(1)}%</span></div>`};
  return`
    <section class="pf3-hero">
      <button class="pf3-close" onclick="pf3Select('${tk}')" title="Закрыть карточку">✕</button>
      <div class="pf3-id">
        ${logoHTML(tk,ccy,'pf3-logo')}
        <div>
          <h2>${r[1]||tk}</h2>
          <div class="pf3-chips">${chips}</div>
          ${isAdmin()?signalBadgeHTML(tk):''}
        </div>
      </div>
      <div class="pf3-quote">
        <div class="pf3-price${isFinite(day)?(day>=0?' pf3-up':' pf3-down'):''}">${price>0?pf3Fmt(price,2):'—'} <small>${ccy}</small></div>
        ${isFinite(day)?`<div class="pf3-day ${day>=0?'pf3-up-bg':'pf3-down-bg'}">${day>0?'+':''}${day.toFixed(2)}% ${T('за день')}</div>`:''}
        <div id="pf3PrePost" class="pf3-pp">${cardPPInner(exSymbol(tk,ccy))}</div>
        ${can('action.refresh_data')?`<button class="pf3-btn" id="pf3RefreshBtn" onclick="pf3Refresh()">${T('🔄 Обновить цену')}</button>`:''}
      </div>
    </section>
    <section class="pf3-cards">
      ${pf3MyPort(v3Key)?`<div class="pf3-card"><div class="pf3-card-l">${T('Стоимость позиции')}</div><div class="pf3-card-v">${pf3Money(d,valSEK)}</div><div class="pf3-card-s">${pf3Fmt(qty)} акц. × ${pf3Fmt(price,2)} ${ccy}</div></div>
      <div class="pf3-card"><div class="pf3-card-l">${T('Прибыль')}</div><div class="pf3-card-v ${profit>=0?'pf3-up':'pf3-down'}">${profit>0?'+':''}${pf3Money(d,profit)}</div><div class="pf3-card-s ${ppct>=0?'pf3-up':'pf3-down'}">${ppct>0?'+':''}${ppct.toFixed(1)}% от покупки</div></div>
      <div class="pf3-card"><div class="pf3-card-l">${T('Цена покупки')}</div><div class="pf3-card-v">${pf3Fmt(buy,2)} <small>${ccy}</small></div><div class="pf3-card-s">вложено ${pf3Money(d,qty*buy*(FX[ccy]||1))}</div></div>`:''}
      <div class="pf3-card"><div class="pf3-card-l">${T('Аналит. таргет')}${tgM.src?`<span class="tg-src">${tgM.src==='fmp'?'FMP':'Yahoo/Refinitiv'}</span>`:''}${effStale?`<span class="tg-recent-l">· ${tgRecentLbl}</span>`:''}${tgStale?`<span class="tg-stale" title="${RT(`Среднее «за всё время» расходится со свежим срезом на ${tgDiv.toFixed(0)}% — старые таргеты тянут его вниз. Показываем СВЕЖИЙ; его же берёт логика рекомендаций.`,`All-time mean diverges from the recent slice by ${tgDiv.toFixed(0)}% — old targets drag it down. Showing the FRESH one; the recommendation logic uses it too.`)}">⚠️ ${RT('всё-время устар.','all-time stale')}</span>`:''}</div><div class="pf3-card-v">${effHasT?pf3Fmt(effT,0)+' <small>'+ccy+'</small>':'—'}</div><div class="pf3-card-s ${effHasT&&effT>=price?'pf3-up':'pf3-down'}">${effHasT?(effT>=price?'+':'')+((effT-price)/price*100).toFixed(1)+'% '+T('потенциал')+(effNa?` · ${effNa} `+RT('аналит.','an.'):''):T('появится при обновлении акций (🔄, раз в сутки)')}</div>${effStale?(hasTarget?`<div class="pf3-card-sub tg-old"><span class="tg-recent-l">${RT('за всё время','all-time')}</span> <b>${pf3Fmt(target,0)}</b> <small>${ccy}</small> <span class="pf3-down">${((target-price)/price*100).toFixed(1)}%</span>${tgM.n?` · ${tgM.n} `+RT('аналит.','an.'):''}</div>`:''):(hasTargetR?`<div class="pf3-card-sub"><span class="tg-recent-l">${tgRecentLbl}</span> <b>${pf3Fmt(targetR,0)}</b> <small>${ccy}</small> <span class="${targetR>=price?'pf3-up':'pf3-down'}">${targetR>=price?'+':''}${((targetR-price)/price*100).toFixed(1)}%</span>${tgM.nr?` · ${tgM.nr} `+RT('аналит.','an.'):''}</div>`:'')}</div>
      <div class="pf3-card" id="pf3PeCard">${pf3ValCard('pe')}</div>
      <div class="pf3-card" id="pf3PsCard">${pf3ValCard('ps')}</div>
    </section>
    ${pf3RecoHTML(d,r)}
    ${cycleMonitorHTML(tk)}
    ${stockReportHTML(d,r)}
    ${can('view.ai_reco')?aiRecoHTML(d,r):''}
    ${pf3ScenarioHTML(d,r)}
    ${pf3NewsLiveHTML(tk,ccy)}
    ${can('view.valuation')?targetsBlockHTML(d,r):''}
    ${isAdmin()?stockAiHTML(d,r):''}
    ${can('view.valuation')?valHTML(d,r):''}
    ${can('view.insider')?insiderHTML(d,r):''}
    <section class="pf3-panel">
      <div class="pf3-panel-hd"><span>${T('💪 Здоровье бизнеса')} ${infoBtn('health')}<span class="pf3-asof" id="pf3FundAsof">${(pf3FundData()||{}).asOf?T('отчёт от')+' '+pf3FundData().asOf:''}</span></span><span class="pf3-tf"><button id="pf3FundAnnualBtn" class="pf3-tfbtn${pf3Fund.period==='annual'?' on':''}" onclick="pf3SetFundPeriod('annual')">${T('Годовой отчёт')}</button><button id="pf3FundQuarterBtn" class="pf3-tfbtn${pf3Fund.period==='quarter'?' on':''}" onclick="pf3SetFundPeriod('quarter')">${T('Посл. квартал')}</button></span></div>
      <div class="pf3-health-grid" id="pf3HealthGrid">${pf3Health()}</div>
    </section>
    <section class="pf3-panel">
      <div class="pf3-panel-hd"><span>${T('📅 Ближайший отчёт и ожидания рынка')}</span></div>
      <div id="pf3EarnBody">${pf3Earnings()}</div>
    </section>
    <section class="pf3-grid">
      <div class="pf3-panel">
        <div class="pf3-panel-hd"><span>${T('📈 График · SMA 50/100/200 · уровни')}</span><span class="pf3-tf"><button class="pf3-tfbtn${pf3State.years===1?' on':''}" onclick="pf3SetYears(1)">1Г</button><button class="pf3-tfbtn${pf3State.years===3?' on':''}" onclick="pf3SetYears(3)">3Г</button></span></div>
        <div id="pf3ChartBox" class="pf3-chart"></div>
        <div id="pf3Legend" class="chart-legend"></div>
      </div>
      <div class="pf3-panel">
        <div class="pf3-panel-hd"><span>${T('🎯 Технические уровни')}</span></div>
        ${lvl('SMA 50',s50>=0?r[s50]:'')+lvl('SMA 100',s100>=0?r[s100]:'')+lvl('SMA 200',s200>=0?r[s200]:'')+lvl('Поддержка',supC>=0?r[supC]:'')+lvl('Сопротивление',resC>=0?r[resC]:'')||'<div class="pf3-empty">Нажмите «Обновить цену», чтобы загрузить уровни</div>'}
        ${(pf3MyPort(v3Key)&&can('action.edit_trades'))?`<div class="pf3-panel-hd" style="margin-top:18px"><span>${T('✏️ Моя позиция')}</span></div>
        <div class="pf3-edit">
          <label>${T('Кол-во акций')} <input type="number" step="any" min="0" value="${qty}" onchange="pf3Edit(6,this.value)"></label>
          <label>${T('Цена покупки')} (${ccy}) <input type="number" step="any" min="0" value="${buy}" onchange="pf3Edit(9,this.value)"></label>
        </div>
        <div class="pf3-panel-hd" style="margin-top:14px"><span>💸 ${RT('Сделка','Trade')}</span><span class="pf3-asof">${RT('купля/продажа · пишется в историю с P&L','buy/sell · logged to history with P&L')}</span></div>
        <form class="sim-form" onsubmit="event.preventDefault();return false">
          <label>${RT('Кол-во','Qty')} <input id="pfTrQty" type="number" step="any" min="0" placeholder="10" oninput="pfTrPreview('${ccy}')"></label>
          <label>${RT('Цена','Price')} (${ccy}) <input id="pfTrPrice" type="number" step="any" min="0" value="${price>0?price:''}" oninput="pfTrPreview('${ccy}')"></label>
          <button type="button" class="pf3-btn tr-buy" onclick="pfTrade('buy')">🟢 ${RT('Купить','Buy')}</button>
          <button type="button" class="pf3-btn tr-sell" onclick="pfTrade('sell')">🔴 ${RT('Продать','Sell')}</button>
        </form>
        <div id="pfTrFee" class="pf3-reco-note"></div>`:''}
      </div>
    </section>
    ${(pf3MyPort(v3Key)||v3Key===AIP_KEY)?pfTradesHTML(tk):''}
    <section class="pf3-panel">
      <div class="pf3-panel-hd"><span>${T('🛒 Уровни покупки / докупки')}</span><span class="pf3-asof">${T('по техданным · авто-обновление каждые 5 мин')}</span></div>
      ${pf3BuySection(r,h,price,ccy)}
    </section>
    ${simSection(tk,price,ccy)}`;
}
function pf3Edit(ci,v){const ri=pf3SelIdx(),n=parseFloat(v);pf3D().rows[ri][ci]=isNaN(n)?0:n;recalcPF(ri,v3Key);scheduleSave();renderPF3()}
// ── 📜 Сделки портфеля: купля/продажа с реализованным P&L по продаже ──
const pfPortShort=tab=>{const k=tab||PF3_KEY;return k===AIP_KEY?'AI':String(TAB_LABEL(k)||k).replace(/^Portfolio\s*\((.+)\)$/i,'$1')};
// Лайв-превью комиссии в блоке «💸 Сделка» карточки.
function pfTrPreview(ccy){
  const el=document.getElementById('pfTrFee');if(!el)return;
  const q=parseFloat((document.getElementById('pfTrQty')||{}).value),p=parseFloat((document.getElementById('pfTrPrice')||{}).value);
  if(!(q>0)||!(p>0)){el.textContent='';return;}
  const amt=q*p,fb=tradeFeeNative(ccy,amt,true),fs=tradeFeeNative(ccy,amt,false);
  el.innerHTML=`${RT('Сумма','Amount')}: <b>${pf3Fmt(amt,2)} ${ccy}</b> · ${RT('комиссия','fee')} ${RT('покупка','buy')} ~${pf3Fmt(fb.total,2)} ${ccy} → ${RT('итого','total')} ${pf3Fmt(amt+fb.total,2)} ${ccy} · ${RT('продажа','sell')} ~${pf3Fmt(fs.total,2)} ${ccy}`;
}
function pfTrade(act){
  const ri=pf3SelIdx(),d=pf3D();if(ri<0||!d)return;const r=d.rows[ri];if(!r)return;
  const qty=parseFloat((document.getElementById('pfTrQty')||{}).value),price=parseFloat((document.getElementById('pfTrPrice')||{}).value);
  if(!(qty>0)||!(price>0)){toast(RT('Укажите количество и цену сделки','Enter trade quantity and price'),true);return;}
  const tk=String(r[2]||'').trim().toUpperCase(),ccy=r[8]||'USD',fx=FX[ccy]||1;
  const curQty=parseFloat(r[6])||0,avg=parseFloat(r[9])||0;
  let plNative=null,tq=qty,feeNative=0;
  if(act==='sell'){
    tq=Math.min(qty,curQty);
    if(!(tq>0)){toast(RT('Нет позиции для продажи','No position to sell'),true);return;}
    feeNative=tradeFeeNative(ccy,tq*price,false).total;
    plNative=Math.round(((price-avg)*tq-feeNative)*100)/100;   // P&L нетто, за вычетом комиссии продажи
    r[6]=Math.round((curQty-tq)*1e6)/1e6;   // уменьшаем позицию, средняя не меняется
    if(d.cashFree!=null&&d.cashFree!=='')d.cashFree=Math.round(((parseFloat(d.cashFree)||0)+pf3Cv(d,(tq*price-feeNative)*fx))*100)/100;   // выручка − комиссия → кэш
  }else{
    feeNative=tradeFeeNative(ccy,qty*price,true).total;
    const nq=curQty+qty;
    r[9]=Math.round((avg*curQty+price*qty)/nq*100)/100;   // новая средняя (без комиссии)
    r[6]=nq;
    if(d.cashFree!=null&&d.cashFree!=='')d.cashFree=Math.round(((parseFloat(d.cashFree)||0)-pf3Cv(d,(qty*price+feeNative)*fx))*100)/100;   // сумма + комиссия с кэша
  }
  PF_TRADES.push({id:'tr'+Date.now()+'_'+Math.floor(Math.random()*1e4),tab:v3Key,tk,name:String(r[1]||tk),ccy,act,qty:tq,price,plNative,feeNative,date:new Date().toISOString().slice(0,10)});
  recalcPF(ri,v3Key);scheduleSave();renderPF3();
  toast((act==='sell'?'🔴 '+RT('Продано','Sold'):'🟢 '+RT('Куплено','Bought'))+` ${pf3Fmt(tq)} × ${pf3Fmt(price,2)} ${ccy}`+(feeNative?` · ${RT('комиссия','fee')} ${pf3Fmt(feeNative,2)} ${ccy}`:'')+(plNative!=null?` · P&L ${plNative>=0?'+':''}${pf3Money(d,plNative*fx)}`:''));
}
function pfTradeDel(id){
  const i=PF_TRADES.findIndex(t=>t.id===id);if(i<0)return;
  if(!confirm(RT('Удалить запись о сделке? (позиция и кэш НЕ изменятся)','Delete this trade record? (position & cash stay)')))return;
  PF_TRADES.splice(i,1);scheduleSave();renderPF3();
}
// filterTk — компактная история одной бумаги (карточка); без него — все сделки портфеля.
// Источник: PF_TRADES (семейные портфели) или AI_PORT.trades (AI-портфель, read-only).
function pfTradesHTML(filterTk){
  const d=pf3D();
  const fk=filterTk!==undefined?String(filterTk).toUpperCase():null;
  const isAi=v3Key===AIP_KEY;
  let src;
  if(isAi){
    src=((AI_PORT&&AI_PORT.trades)||[]).map((t,idx)=>({id:t.id||('ai'+(t.ts||idx)),tab:AIP_KEY,tk:String(t.ticker||'').toUpperCase(),name:t.name||t.ticker,ccy:t.ccy||'SEK',act:t.action,qty:t.qty,price:t.price,plSEK:typeof t.plSEK==='number'?t.plSEK:null,date:t.ts?new Date(t.ts).toISOString().slice(0,10):'',note:t.trigger||'',ord:t.ts||idx,ai:1}));
  }else{
    src=PF_TRADES.map((t,idx)=>({...t,plSEK:t.plNative!=null?t.plNative*(FX[t.ccy]||1):null,ord:idx}));
  }
  const mine=src.filter(t=>(t.tab||PF3_KEY)===v3Key&&(!fk||String(t.tk).toUpperCase()===fk))
    .sort((a,b)=>(a.date<b.date?1:a.date>b.date?-1:(b.ord>a.ord?1:-1)));
  let realizedSEK=0,hasSell=false;
  const rows=mine.map(t=>{
    const plSEK=t.plSEK;
    if(plSEK!=null){realizedSEK+=plSEK;hasSell=true;}
    const cls=plSEK==null?'':plSEK>=0?'pf3-up':'pf3-down';
    const feeTxt=t.feeNative?` · ${RT('комис.','fee')} ${pf3Fmt(t.feeNative,1)} ${t.ccy}`:(typeof t.feeSEK==='number'&&t.feeSEK?` · ${RT('комис.','fee')} ${pf3Fmt(t.feeSEK,0)} kr`:'');
    const sub=fk?(t.date+feeTxt+(t.note?' · '+t.note:'')):`${t.tk} · ${t.date}${feeTxt}${isAi?(t.note?' · '+t.note:''):` · <span class="sim-port">💼 ${pfPortShort(t.tab)}</span>`}`;
    return`<div class="sim-trow tr-row">
      <span class="tr-act ${t.act}">${t.act==='sell'?'🔴 '+RT('Продажа','Sell'):'🟢 '+RT('Покупка','Buy')}</span>
      <span class="pf3-row-name">${fk?'':`<b>${t.name||t.tk}</b>`}<span>${sub}</span></span>
      <span class="tr-qty">${pf3Fmt(t.qty)} × ${pf3Fmt(t.price,2)} ${t.ccy}</span>
      <span class="tr-pl ${cls}">${plSEK!=null?(plSEK>=0?'+':'')+pf3Money(d,plSEK):'—'}</span>
      ${isAi?'':`<button class="pf3-del" onclick="pfTradeDel('${t.id}')" title="${RT('Удалить запись','Delete record')}">🗑</button>`}
    </div>`;
  }).join('');
  const tot=hasSell?`<span class="pf3-asof">${RT('Реализованный P&L','Realized P&L')}: <b class="${realizedSEK>=0?'pf3-up':'pf3-down'}">${realizedSEK>=0?'+':''}${pf3Money(d,realizedSEK)}</b></span>`:'';
  // Форма «внести запись в журнал» (только полный журнал семейного портфеля):
  // пишет ТОЛЬКО историю, не меняя позиции/кэш — для ручного восстановления сделок.
  const addForm=(!fk&&!isAi&&pf3MyPort(v3Key)&&can('action.edit_trades'))?`
    <details class="tr-add">
      <summary>➕ ${RT('Внести сделку заново (позиция + журнал, кэш не трогаю)','Re-enter a trade (position + journal, cash untouched)')}</summary>
      <div class="tr-add-form">
        <select id="pfTrAct"><option value="buy">🟢 ${RT('Покупка','Buy')}</option><option value="sell">🔴 ${RT('Продажа','Sell')}</option></select>
        <input id="pfTrTk" placeholder="${RT('Тикер','Ticker')}" autocomplete="off">
        <input id="pfTrRq" type="number" step="any" min="0" placeholder="${RT('Кол-во','Qty')}">
        <input id="pfTrRp" type="number" step="any" min="0" placeholder="${RT('Цена','Price')}">
        <input id="pfTrCcy" placeholder="${RT('Валюта','Ccy')}" value="USD" style="width:64px;text-transform:uppercase">
        <input id="pfTrRd" type="date" value="${new Date().toISOString().slice(0,10)}">
        <button class="pf3-btn" onclick="pfTradeAddRecord()">${RT('Внести','Add')}</button>
      </div>
      <div class="pf3-reco-note">${RT('Обновляет количество и среднюю по тикеру (создаёт позицию, если её нет) и пишет в журнал. Свободный кэш НЕ меняется. Вводите сделки по порядку: сначала покупки, потом продажи. P&L по продаже считается от средней автоматически. Валюта берётся из существующей позиции, если она есть.','Updates qty and average by ticker (creates the position if missing) and writes the journal. Free cash is NOT changed. Enter trades in order: buys first, then sells. Sell P&L is computed from the average automatically. Currency comes from the existing position if present.')}</div>
    </details>`:'';
  const importBtn=(!fk&&!isAi&&pf3MyPort(v3Key)&&can('action.edit_trades'))?`<label class="pf3-btn pf3-btn-sm tr-import" title="${RT('Импорт сделок из CSV (date, action, ticker, qty, price, ccy, fee)','Import trades from CSV (date, action, ticker, qty, price, ccy, fee)')}">📥 ${RT('Импорт CSV','Import CSV')}<input type="file" accept=".csv,text/csv" style="display:none" onchange="pfImportTradesCSV(this)"></label>`:'';
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>📜 ${RT('История сделок','Trade history')}${fk?'':' — '+TAB_LABEL(v3Key)}</span><span class="tr-hd-r">${tot}${importBtn}</span></div>
    ${mine.length?`<div class="sim-list">${rows}</div>`:`<div class="pf3-empty">${isAi?RT('AI-портфель ещё не совершал сделок — он торгует автономно по стратегии.','The AI portfolio has not traded yet — it trades autonomously by its strategy.'):RT('Сделок пока нет. Купите или продайте в блоке «💸 Сделка» в карточке акции.','No trades yet. Buy or sell in the «💸 Trade» box on a stock card.')}</div>`}
    ${addForm}
  </section>`;
}
// Ручной повторный ввод сделки: пересобирает позицию (кол-во/средняя) + журнал,
// но НЕ трогает свободный кэш. Создаёт позицию по тикеру, если её нет.
function pfTradeAddRecord(){
  if(!pf3MyPort(v3Key))return;
  const g=id=>document.getElementById(id);
  const act=(g('pfTrAct')&&g('pfTrAct').value)||'buy';
  const tk=String((g('pfTrTk')&&g('pfTrTk').value)||'').trim().toUpperCase();
  const qty=parseFloat(g('pfTrRq')&&g('pfTrRq').value)||0;
  const price=parseFloat(g('pfTrRp')&&g('pfTrRp').value)||0;
  const date=(g('pfTrRd')&&g('pfTrRd').value)||new Date().toISOString().slice(0,10);
  let ccyIn=String((g('pfTrCcy')&&g('pfTrCcy').value)||'').trim().toUpperCase();
  if(!tk||!(qty>0)||!(price>0)){toast(RT('Укажите тикер, количество и цену','Enter ticker, qty and price'),true);return;}
  const d=pf3D();
  let ri=(d.rows||[]).findIndex(r=>String(r[2]||'').trim().toUpperCase()===tk);
  if(ri<0){
    if(act==='sell'){toast(RT('Нет позиции для продажи — сначала внесите покупку','No position to sell — add a buy first'),true);return;}
    // создать минимальную позицию (метрики/сектор дозаполнятся при обновлении цен)
    const row=new Array(d.headers.length).fill('');
    row[0]=d.rows.length+1;row[1]=tk;row[2]=tk;row[3]='';row[4]='';row[5]='';
    row[6]=0;row[7]=price;row[8]=ccyIn||'USD';row[9]=0;row[10]=0;row[11]=0;row[12]=0;row[13]=0;
    d.rows.push(row);d.count=d.rows.length;ri=d.rows.length-1;
  }
  const r=d.rows[ri],ccy=r[8]||ccyIn||'USD';
  const curQty=parseFloat(r[6])||0,avg=parseFloat(r[9])||0;
  let plNative=null,tq=qty;
  if(act==='sell'){
    tq=Math.min(qty,curQty);
    if(!(tq>0)){toast(RT('Нет позиции для продажи','No position to sell'),true);return;}
    plNative=Math.round((price-avg)*tq*100)/100;
    r[6]=Math.round((curQty-tq)*1e6)/1e6;   // средняя не меняется
  }else{
    const nq=curQty+qty;
    r[9]=Math.round((avg*curQty+price*qty)/nq*100)/100;   // новая средняя
    r[6]=nq;
    if(!(parseFloat(r[7])>0))r[7]=price;   // дать цену, пока не обновили живую
  }
  PF_TRADES.push({id:'tr'+Date.now()+'_'+Math.floor(Math.random()*1e4),tab:v3Key,tk,name:String(r[1]||tk),ccy,act,qty:tq,price,plNative,date});
  recalcPF(ri,v3Key);scheduleSave();renderPF3();
  toast((act==='sell'?'🔴 '+RT('Продажа внесена','Sell recorded'):'🟢 '+RT('Покупка внесена','Buy recorded'))+` · ${pf3Fmt(tq)} × ${pf3Fmt(price,2)} ${ccy}`+(plNative!=null?` · P&L ${plNative>=0?'+':''}${pf3Money(d,plNative*(FX[ccy]||1))}`:'')+' · '+RT('кэш не изменён','cash unchanged'));
}

// ── 🧾 Налоговый отчёт + 📥 CSV-импорт сделок ───────────────────────────────
// Чистый движок (покрыт тестом): сделки сортируются по тикеру хронологически,
// продажи сопоставляются с покупками. Методы: 'avg' — средняя цена
// (genomsnittsmetoden — корректно для шведского K4 и совпадает с журналом),
// 'fifo' — первый-пришёл-первый-ушёл (для сверки). Комиссия покупки входит в
// себестоимость, комиссия продажи уменьшает выручку. Возвращает записи-продажи.
let _taxMethod='avg';
function pfTaxLots(trades, method){
  const recs=[],byTk={};
  const list=(trades||[]).slice().sort((a,b)=>{const da=String(a.date||''),db=String(b.date||'');return da<db?-1:da>db?1:((a.ord||0)-(b.ord||0));});
  for(const t of list){
    const tk=String(t.tk||'').toUpperCase();if(!tk)continue;
    const q=Math.abs(parseFloat(t.qty)||0);if(!(q>0))continue;
    const price=parseFloat(t.price)||0,fee=Math.abs(parseFloat(t.fee)||0);
    const st=byTk[tk]||(byTk[tk]={qty:0,cost:0,lots:[]});
    if(t.act==='sell'){
      let cost=0;
      if(method==='fifo'){let need=q;while(need>1e-9&&st.lots.length){const lot=st.lots[0],take=Math.min(need,lot.q);cost+=take*lot.cps;lot.q-=take;need-=take;if(lot.q<=1e-9)st.lots.shift();}st.qty=Math.max(0,st.qty-q);}
      else{const cps=st.qty>0?st.cost/st.qty:0;cost=cps*q;st.cost=Math.max(0,st.cost-cost);st.qty=Math.max(0,st.qty-q);}
      const proceeds=q*price-fee,gain=proceeds-cost;
      recs.push({trade:t,tk,name:t.name||tk,ccy:t.ccy||'SEK',date:t.date||'',year:String(t.date||'').slice(0,4)||'—',qty:q,proceeds:Math.round(proceeds*100)/100,cost:Math.round(cost*100)/100,gain:Math.round(gain*100)/100});
    }else{const cpsIncl=price+(q>0?fee/q:0);st.qty+=q;st.cost+=q*price+fee;st.lots.push({q,cps:cpsIncl});}
  }
  return recs;
}
// Журнал семейного портфеля → формат движка.
function pfTaxTrades(tab){return (PF_TRADES||[]).filter(e=>(e.tab||PF3_KEY)===(tab||v3Key)).map((e,i)=>({tk:e.tk,name:e.name,ccy:e.ccy,act:e.act,qty:e.qty,price:e.price,fee:e.feeNative,date:e.date,ord:i,_e:e}));}
// Пересчёт реализованного P&L журнала по средней цене (после импорта) — чтобы
// сумма «Реализованный P&L» осталась консистентной (тот же метод, что у pfTrade).
function pfRecalcRealized(tab){
  const trades=pfTaxTrades(tab);
  trades.forEach(t=>{if(t._e&&t._e.act==='sell')t._e.plNative=null;});
  pfTaxLots(trades,'avg').forEach(r=>{if(r.trade&&r.trade._e)r.trade._e.plNative=Math.round(r.gain*100)/100;});
}
const _taxNormDate=s=>{s=String(s||'').trim();let m;if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);if(m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/))return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;return s.slice(0,10);};
// Парсер CSV сделок: автоопределение разделителя (,/;), гибкие заголовки (ru/en/sv).
function pfParseTradesCSV(text){
  const lines=String(text||'').split(/\r?\n/).filter(l=>l.trim());if(lines.length<2)return 0;
  const delim=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?';':',';
  const split=l=>{const out=[];let cur='',q=false;for(let i=0;i<l.length;i++){const c=l[i];if(c==='"'){if(q&&l[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===delim&&!q){out.push(cur);cur='';}else cur+=c;}out.push(cur);return out.map(s=>s.trim());};
  const head=split(lines[0]).map(h=>h.toLowerCase().replace(/^﻿/,''));
  const col=(...names)=>{for(const n of names){const i=head.indexOf(n);if(i>=0)return i;}return -1;};
  const ci={date:col('date','дата','datum'),act:col('action','действие','type','тип','side','transaktion'),tk:col('ticker','тикер','symbol','инструмент'),qty:col('qty','quantity','кол-во','количество','shares','antal','volym'),price:col('price','цена','kurs','pris'),ccy:col('ccy','currency','валюта','valuta'),fee:col('fee','комиссия','courtage','avgift','commission')};
  if(ci.tk<0||ci.qty<0||ci.price<0)return 0;
  const num=s=>{const n=parseFloat(String(s||'').replace(/\s/g,'').replace(',','.'));return isFinite(n)?n:0;};
  const today=new Date().toISOString().slice(0,10);let n=0;
  for(let i=1;i<lines.length;i++){
    const c=split(lines[i]);if(!c.length)continue;
    const tk=String(c[ci.tk]||'').trim().toUpperCase();if(!tk)continue;
    const rawQ=num(c[ci.qty]),qty=Math.abs(rawQ),price=num(c[ci.price]);if(!(qty>0)||!(price>0))continue;
    const av=String(ci.act>=0?c[ci.act]:'').trim().toLowerCase();
    const act=/sell|прода|s[äa]lj|sale|^s$/.test(av)?'sell':/buy|покуп|k[öo]p|^b$/.test(av)?'buy':(rawQ<0?'sell':'buy');
    const ccy=String(ci.ccy>=0?c[ci.ccy]:'').trim().toUpperCase()||'USD';
    const date=_taxNormDate(ci.date>=0?c[ci.date]:today)||today;
    const fee=ci.fee>=0?Math.abs(num(c[ci.fee])):0;
    PF_TRADES.push({id:'tr'+Date.now()+'_'+Math.floor(Math.random()*1e6)+'_'+i,tab:v3Key,tk,name:tk,ccy,act,qty,price,feeNative:fee||undefined,plNative:null,date,imp:1});n++;
  }
  return n;
}
function pfImportTradesCSV(input){
  if(!pf3MyPort(v3Key)){toast(RT('Импорт только для семейных портфелей','Import only for family portfolios'),true);return;}
  const file=input&&input.files&&input.files[0];if(!file){return;}
  const rd=new FileReader();
  rd.onload=()=>{try{const n=pfParseTradesCSV(String(rd.result||''));
    if(!n)toast(RT('Сделки не найдены. Нужны колонки: date, action, ticker, qty, price, ccy (fee — опц.)','No trades found. Need columns: date, action, ticker, qty, price, ccy (fee optional)'),true);
    else{pfRecalcRealized(v3Key);scheduleSave();renderPF3();toast(`📥 ${RT('Импортировано сделок','Imported trades')}: ${n}`);}
  }catch(e){toast('CSV: '+(e&&e.message||e),true);}if(input)input.value='';};
  rd.readAsText(file);
}
function pfTaxSetMethod(m){_taxMethod=m==='fifo'?'fifo':'avg';renderPF3();}
function pfTaxHTML(){
  const d=pf3D();
  const recs=pfTaxLots(pfTaxTrades(),_taxMethod);
  const hd=`<div class="pf3-panel-hd"><span>🧾 ${RT('Налоговый отчёт','Tax report')} ${infoBtn('tax')}</span><span class="pf3-tf"><button class="pf3-tfbtn${_taxMethod==='avg'?' on':''}" onclick="pfTaxSetMethod('avg')">${RT('Средняя','Average')}</button><button class="pf3-tfbtn${_taxMethod==='fifo'?' on':''}" onclick="pfTaxSetMethod('fifo')">FIFO</button></span></div>`;
  if(!recs.length)return`<section class="pf3-panel tax">${hd}<div class="pf3-empty">${RT('В журнале этого портфеля нет продаж. Импортируйте CSV во вкладке «Сделки» или внесите продажи в карточке акции.','No sells in the journal of this portfolio. Import a CSV in «Trades» or add sells from a stock card.')}</div></section>`;
  const years={};recs.forEach(r=>{(years[r.year]=years[r.year]||[]).push(r);});
  const yrKeys=Object.keys(years).sort((a,b)=>a<b?1:-1);
  const sek=(ccy,v)=>Math.round(v*(FX[ccy]||1));let totSEK=0;
  const blocks=yrKeys.map(y=>{
    const list=years[y],byCcy={};let ySEK=0;
    list.forEach(r=>{const a=byCcy[r.ccy]||(byCcy[r.ccy]={gain:0});a.gain+=r.gain;ySEK+=sek(r.ccy,r.gain);});totSEK+=ySEK;
    const ccyLines=Object.keys(byCcy).map(c=>`<span class="${byCcy[c].gain>=0?'pf3-up':'pf3-down'}">${byCcy[c].gain>=0?'+':''}${pf3Fmt(byCcy[c].gain,0)} ${c}</span>`).join(' · ');
    const rowsH=list.slice().sort((a,b)=>a.date<b.date?1:-1).map(r=>`<div class="tax-row"><span>${r.date}</span><span class="pf3-row-name"><b>${r.tk}</b></span><span class="tr-qty">${pf3Fmt(r.qty)} ${RT('шт','sh')}</span><span>${pf3Fmt(r.proceeds,0)} ${r.ccy}</span><span class="${r.gain>=0?'pf3-up':'pf3-down'}">${r.gain>=0?'+':''}${pf3Fmt(r.gain,0)} ${r.ccy}</span></div>`).join('');
    return`<div class="tax-year"><div class="tax-year-hd"><b>${y}</b> · ${ccyLines} · <span class="${ySEK>=0?'pf3-up':'pf3-down'}">≈${ySEK>=0?'+':''}${pf3Money(d,ySEK)}</span> <span class="pf3-asof">(${list.length} ${RT('прод.','sales')})</span></div><div class="tax-rows">${rowsH}</div></div>`;
  }).join('');
  return`<section class="pf3-panel tax">${hd}
    <div class="tax-tot"><span>${RT('Итого реализованный результат','Total realized result')}: </span><b class="${totSEK>=0?'pf3-up':'pf3-down'}">${totSEK>=0?'+':''}${pf3Money(d,totSEK)}</b> <button class="pf3-btn pf3-btn-sm" onclick="pfTaxExportCSV()">📥 CSV</button></div>
    ${blocks}
    <p class="pf3-asof tax-note">${RT('«Средняя» = genomsnittsmetoden (корректно для шведской декларации K4); FIFO — для сверки. Суммы в kr — по ТЕКУЩЕМУ курсу (не на дату сделки): это оценка, не готовая K4. Комиссия покупки входит в себестоимость, комиссия продажи уменьшает выручку.','«Average» = genomsnittsmetoden (correct for the Swedish K4); FIFO is for cross-check. kr amounts use the CURRENT FX (not the trade-date rate): an estimate, not a filing-ready K4. Buy fees add to cost basis, sell fees reduce proceeds.')} ${RT(INFO_DISCLAIM[0],INFO_DISCLAIM[1])}</p>
  </section>`;
}
function pfTaxExportCSV(){
  const recs=pfTaxLots(pfTaxTrades(),_taxMethod);
  const rows=[['year','date','ticker','qty','proceeds','cost','gain','ccy','gainSEK_est']];
  recs.forEach(r=>rows.push([r.year,r.date,r.tk,r.qty,r.proceeds,r.cost,r.gain,r.ccy,Math.round(r.gain*(FX[r.ccy]||1))]));
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='tax_'+_taxMethod+'_'+TAB_LABEL(v3Key).replace(/\s/g,'_')+'.csv';a.click();
}
// ── 🎯 План действий: триггеры по уровням/датам с уведомлением ───────────────
// Пользователь (или совет AI) заводит правила вида «купить TK у уровня X»,
// «сократить TK до даты Y». При каждом обновлении цен дашборд сверяет живую цену
// с уровнем и уведомляет (тост + браузерный push), когда условие достигнуто.
function planCurPrice(tk){
  tk=String(tk||'').trim().toUpperCase(); if(!tk)return null;
  const keys=Object.keys(DATA||{});
  for(const k of keys){
    const d=DATA[k]; if(!d||!d.rows||!(d.v3==='1'||k===PF3_KEY||k===AIP_KEY))continue;
    for(const r of d.rows){ if(String(r[2]||'').trim().toUpperCase()===tk){ const p=parseFloat(r[7]); if(isFinite(p)&&p>0)return p; } }
  }
  return null;
}
function planDaysLeft(deadline){ if(!deadline)return null; const dl=new Date(deadline+'T23:59:59').getTime(); return Math.ceil((dl-Date.now())/86400000); }
function planStatus(rule){
  const price=planCurPrice(rule.tk), lvl=parseFloat(rule.level);
  const hasLvl=isFinite(lvl)&&lvl>0; let priceReady=false, gapPct=null;
  if(hasLvl&&price>0){
    if(rule.act==='sell'){ priceReady=price>=lvl; gapPct=(lvl-price)/price*100; }   // ждём роста до уровня
    else { priceReady=price<=lvl; gapPct=(price-lvl)/lvl*100; }                        // ждём падения в зону покупки
  }
  const dleft=planDaysLeft(rule.deadline);
  const overdue=dleft!=null&&dleft<0, dueSoon=dleft!=null&&dleft>=0&&dleft<=3;
  // Готово к исполнению: если задан уровень — по цене; если уровня нет, а есть
  // дедлайн — по приближению/наступлению даты.
  const ready = hasLvl ? priceReady : (dueSoon||overdue);
  return {price,lvl,hasLvl,priceReady,gapPct,dleft,overdue,dueSoon,ready};
}
function planReadyCount(tab){ return (PLAN_RULES||[]).filter(r=>(!tab||(r.tab||PF3_KEY)===tab)&&!r.done&&planStatus(r).ready).length; }
function planBadge(tab){ const n=planReadyCount(tab); return n?` 🔔${n}`:''; }
function planActIcon(act){ return act==='sell'?'🔴':act==='watch'?'👁':'🟢'; }
function planActLabel(act){ return act==='sell'?RT('Сократить','Trim'):act==='watch'?RT('Наблюдать','Watch'):RT('Купить','Buy'); }
function planNotify(title,body){
  try{
    if(typeof Notification==='undefined')return;
    if(Notification.permission==='granted'){ new Notification(title,{body,tag:'plan'}); }
    else if(Notification.permission==='default'){ Notification.requestPermission(); }
  }catch(e){}
}
function planAskNotify(silent){
  try{
    if(typeof Notification==='undefined'){ if(!silent)toast(RT('Браузер не поддерживает уведомления','Browser has no notifications'),true); return; }
    if(Notification.permission==='default'){ Notification.requestPermission().then(()=>{ if(!silent&&isV3()&&pf3Tab==='plan')renderPF3(); }); }
    else if(Notification.permission==='denied'){ if(!silent)toast(RT('Уведомления заблокированы в браузере','Notifications blocked in browser'),true); }
    else if(!silent){ toast(RT('Уведомления уже включены','Alerts already on')); }
  }catch(e){}
}
// Сверяет все правила с живыми ценами; уведомляет о НОВО достигнутых уровнях.
// Вызывается после обновления цен и при открытии вкладки «План».
function planCheck(){
  let changed=false; const fired=[];
  (PLAN_RULES||[]).forEach(rule=>{
    if(rule.done)return;
    const st=planStatus(rule);
    if(st.ready&&!rule.hitAt){ rule.hitAt=Date.now(); changed=true; fired.push({rule,st}); }
    else if(!st.ready&&rule.hitAt&&st.price>0){ rule.hitAt=0; changed=true; }   // ушли из зоны → сброс, чтобы уведомить при повторном входе
  });
  fired.forEach(({rule,st})=>{
    const lvlTxt=st.hasLvl
      ?`${rule.act==='sell'?RT('цена выросла до','price rose to'):RT('цена опустилась к','price dropped to')} ${pf3Fmt(st.lvl,2)} ${rule.ccy||''}`
      :RT('подошёл срок','deadline reached');
    const msg=`${planActIcon(rule.act)} ${rule.tk}: ${lvlTxt}${rule.amount?` · ~${pf3Fmt(rule.amount,0)} kr`:''}`;
    toast('🎯 '+msg);
    planNotify(RT('🎯 План действий — пора исполнять','🎯 Action plan — act now'), msg+(rule.note?`\n${rule.note}`:''));
  });
  if(changed)scheduleSave();
  if(fired.length&&isV3()&&pf3Tab==='plan')renderPF3();
}
let planEditId=null;   // id правила, открытого на редактирование (инлайн)
// Сколько ЦЕЛЫХ акций влезает в сумму kr по цене (валюта бумаги). Акции
// покупаются поштучно — поэтому показываем штуки, а не «на N крон».
function planShares(r, price){
  if(!(price>0)||!(r.amount>0))return null;
  const ccyAmt=r.amount/(FX[r.ccy]||1);   // kr → валюта бумаги
  return Math.floor(ccyAmt/price);
}
// Строка про количество: либо заданные штуки, либо «сколько влезает» из суммы.
function planQtyBit(r, price){
  if(r.qty>0){
    let s=`${pf3Fmt(r.qty)} ${RT('шт','sh')}`;
    if(price>0)s+=` ≈ ${pf3Fmt(r.qty*price*(FX[r.ccy]||1),0)} kr`;
    return s;
  }
  if(r.amount>0){
    if(price>0){
      const sh=planShares(r,price);
      if(sh<1)return `~${pf3Fmt(r.amount,0)} kr · ⚠ ${RT('меньше цены 1 акции','below 1-share price')} (≈${pf3Fmt(price*(FX[r.ccy]||1),0)} kr/${RT('шт','sh')})`;
      return `~${pf3Fmt(r.amount,0)} kr · ≈ ${sh} ${RT('шт','sh')}`;
    }
    return `~${pf3Fmt(r.amount,0)} kr`;
  }
  return '';
}
// Достать ценовой уровень из текста совета («зоне 358–366», «у поддержки €1099»).
// Денежные суммы (kr/крон) отбрасываем, чтобы не спутать с ценой акции.
function planParseLevel(text, act){
  if(!text)return 0;
  const t=String(text).replace(/\d[\d  .,]*\s*(kr|крон|kr\.|sek)\b/gi,' ');
  const m=t.match(/\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g);
  if(!m)return 0;
  const nums=m.map(s=>parseFloat(s.replace(/[  ]/g,'').replace(',','.'))).filter(n=>isFinite(n)&&n>0);
  if(!nums.length)return 0;
  return act==='sell'?Math.min.apply(null,nums):Math.max.apply(null,nums);   // buy→верх зоны, sell→уровень
}
// Перенести структурированный совет AI-Proto («⚖️ Предложение») в правила плана.
function planImportFromAi(){
  const H=pf3AiHist(),last=H[0],P=last&&last.proposal;
  const acts=(P&&P.actions)||[];
  const wl=(P&&P.watchlist)||[];
  if(!acts.length&&!wl.length){toast(RT('Нет структурированного совета — запустите анализ на «🤖 AI Proto»','No structured advice — run analysis on «🤖 AI Proto»'),true);return;}
  // Версии плана: если уже есть перенесённый из AI план — заменить его новой версией или добавить как следующую версию.
  const existing=(PLAN_RULES||[]).filter(r=>r.fromAi&&!r.done&&(r.tab||PF3_KEY)===v3Key);
  let ver='1.0';
  if(existing.length){
    const maxV=existing.reduce((m,r)=>Math.max(m,parseFloat(r.ver)||1),1);
    const replace=confirm(RT(`Уже перенесён план v${maxV.toFixed(1)}.\n\nОК — заменить его новой версией (старые непросмотренные пункты удалятся).\nОтмена — добавить как новую версию v${(maxV+0.1).toFixed(1)} (старые останутся).`,`A plan v${maxV.toFixed(1)} is already imported.\n\nOK — replace it with a new version (old pending items removed).\nCancel — add as a new version v${(maxV+0.1).toFixed(1)} (old kept).`));
    if(replace){ PLAN_RULES=PLAN_RULES.filter(r=>!(r.fromAi&&!r.done&&(r.tab||PF3_KEY)===v3Key)); ver='1.0'; }
    else ver=(maxV+0.1).toFixed(1);
  }
  const d=pf3D(); let added=0;
  acts.forEach((a,i)=>{
    const isSell=/прода|сократ|уменьш|fix|sell|trim|reduce/i.test(a.action||'');
    const isBuy=/куп|докуп|добав|нарасти|buy|add|increase/i.test(a.action||'');
    if(!isBuy&&!isSell)return;   // «держать» — пропускаем (наблюдение идёт из watchlist)
    const act=isSell?'sell':'buy';
    const tk=String(a.ticker||'').trim().toUpperCase(); if(!tk)return;
    if((PLAN_RULES||[]).some(r=>!r.done&&(r.tab||PF3_KEY)===v3Key&&r.tk===tk&&r.act===act))return;   // дедуп
    const level=planParseLevel(a.details||'',act);
    const row=((d&&d.rows)||[]).find(r=>String(r[2]||'').trim().toUpperCase()===tk);
    let ccy='USD';
    if(row&&row[8])ccy=String(row[8]).toUpperCase();
    else if(/€|eur/i.test(a.details||''))ccy='EUR';
    else if(/£|gbp/i.test(a.details||''))ccy='GBP';
    const amount=typeof a.amountSEK==='number'&&a.amountSEK>0?a.amountSEK:0;
    PLAN_RULES.push({id:'pl'+Date.now()+'_'+i+'_'+Math.floor(Math.random()*1e4),tab:v3Key,tk,name:String(a.name||(row&&row[1])||tk),ccy,act,level:level||0,amount,qty:0,deadline:'',note:String(a.details||'').trim(),hitAt:0,done:false,fromAi:1,ver});
    added++;
  });
  // 👁 Лист ожидания (приоритет 4) — отдельным типом «watch».
  wl.forEach((w,i)=>{
    const tk=String(w&&w.ticker||'').trim().toUpperCase(); if(!tk)return;
    if((PLAN_RULES||[]).some(r=>!r.done&&(r.tab||PF3_KEY)===v3Key&&r.tk===tk&&r.act==='watch'))return;   // дедуп
    const row=((d&&d.rows)||[]).find(r=>String(r[2]||'').trim().toUpperCase()===tk);
    const ccy=row&&row[8]?String(row[8]).toUpperCase():'USD';
    const note=[w.condition?RT('Условие','When')+': '+w.condition:'',w.rationale||''].filter(Boolean).join(' · ');
    PLAN_RULES.push({id:'plw'+Date.now()+'_'+i+'_'+Math.floor(Math.random()*1e4),tab:v3Key,tk,name:String(w.name||(row&&row[1])||tk),ccy,act:'watch',level:0,amount:0,qty:0,deadline:'',note,hitAt:0,done:false,fromAi:1,ver});
    added++;
  });
  if(added){planAskNotify(true);scheduleSave();renderPF3();toast('📥 '+RT('Перенесено из совета AI','Imported from AI advice')+` (v${ver}): ${added}. `+RT('Проверьте уровни и кол-во ✏','Check levels & qty ✏'));}
  else toast(RT('Новых правил нет (уже добавлены или нет торговых действий)','No new rules (already added or no trade actions)'));
}
function planEdit(id){ planEditId=(planEditId===id?null:id); renderPF3(); }
function planCancelEdit(){ planEditId=null; renderPF3(); }
function planSave(id){
  const r=(PLAN_RULES||[]).find(x=>x.id===id); if(!r)return;
  const g=k=>document.getElementById(k);
  r.act=(g('planE_act')&&g('planE_act').value)||r.act;
  const tk=String((g('planE_tk')&&g('planE_tk').value)||'').trim().toUpperCase(); if(tk)r.tk=tk;
  r.level=parseFloat(g('planE_lvl')&&g('planE_lvl').value)||0;
  r.ccy=String((g('planE_ccy')&&g('planE_ccy').value)||r.ccy||'USD').trim().toUpperCase();
  r.qty=parseFloat(g('planE_qty')&&g('planE_qty').value)||0;
  r.amount=parseFloat(g('planE_amt')&&g('planE_amt').value)||0;
  r.deadline=(g('planE_dl')&&g('planE_dl').value)||'';
  r.note=String((g('planE_note')&&g('planE_note').value)||'').trim();
  if(!(r.level>0)&&!r.deadline){toast(RT('Задайте уровень цены или дедлайн','Set a price level or a deadline'),true);return;}
  r.hitAt=0;   // условие изменилось → пересверить заново
  planEditId=null; scheduleSave(); renderPF3();
  toast('🎯 '+RT('Правило обновлено','Rule updated'));
}
function planRulesHTML(){
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const d=pf3D();
  const tkOpts=((d&&d.rows)||[]).map(r=>`<option value="${r[2]}">${esc(r[1]||'')}</option>`).join('');
  const mine=(PLAN_RULES||[]).filter(r=>(r.tab||PF3_KEY)===v3Key).map(r=>({r,st:planStatus(r)}));
  mine.sort((a,b)=>{
    if(!!a.r.done!==!!b.r.done)return a.r.done?1:-1;
    if(a.st.ready!==b.st.ready)return a.st.ready?-1:1;
    const ga=a.st.gapPct==null?999:Math.abs(a.st.gapPct), gb=b.st.gapPct==null?999:Math.abs(b.st.gapPct);
    return ga-gb;
  });
  const readyN=mine.filter(x=>!x.r.done&&x.st.ready).length;
  const editRow=r=>`<div class="plan-row plan-edit">
      <div class="plan-add-form plan-edit-form">
        <select id="planE_act"><option value="buy"${r.act!=='sell'?' selected':''}>🟢 ${RT('Купить','Buy')}</option><option value="sell"${r.act==='sell'?' selected':''}>🔴 ${RT('Сократить','Trim')}</option></select>
        <input id="planE_tk" value="${esc(r.tk||'')}" list="planTkList" style="text-transform:uppercase;width:92px">
        <input id="planE_lvl" type="number" step="any" min="0" value="${r.level||''}" placeholder="${RT('Уровень','Level')}">
        <input id="planE_ccy" value="${esc(r.ccy||'USD')}" style="width:58px;text-transform:uppercase">
        <input id="planE_qty" type="number" step="any" min="0" value="${r.qty||''}" placeholder="${RT('Кол-во, шт','Qty, sh')}">
        <input id="planE_amt" type="number" step="any" min="0" value="${r.amount||''}" placeholder="${RT('Сумма, kr','Amount, kr')}">
        <input id="planE_dl" type="date" value="${r.deadline||''}" title="${RT('Дедлайн','Deadline')}">
        <input id="planE_note" value="${esc(r.note||'')}" placeholder="${RT('Заметка','Note')}" style="flex:1;min-width:140px">
        <button class="pf3-btn" onclick="planSave('${r.id}')">${RT('Сохранить','Save')}</button>
        <button class="pf3-btn pf3-btn-sm" onclick="planCancelEdit()">${RT('Отмена','Cancel')}</button>
      </div>
    </div>`;
  const rows=mine.map(({r,st})=>{
    if(planEditId===r.id)return editRow(r);
    let badge;
    if(r.done)badge=`<span class="plan-badge plan-done">✓ ${RT('Исполнено','Done')}</span>`;
    else if(r.act==='watch')badge=`<span class="plan-badge plan-watch">👁 ${RT('Наблюдение','Watch')}</span>`;
    else if(st.ready)badge=`<span class="plan-badge plan-ready">🔔 ${RT('Пора','Act now')}</span>`;
    else if(st.overdue)badge=`<span class="plan-badge plan-over">⌛ ${RT('Просрочено','Overdue')}</span>`;
    else badge=`<span class="plan-badge plan-wait">⏳ ${RT('Ждём','Waiting')}</span>`;
    const bits=[];
    if(st.hasLvl){
      bits.push(`${RT('уровень','level')} ${r.act==='sell'?'≥':'≤'} ${pf3Fmt(st.lvl,2)} ${r.ccy||''}`);
      if(st.price>0)bits.push(`${RT('сейчас','now')} ${pf3Fmt(st.price,2)} ${r.ccy||''}`);
      if(!st.ready&&st.gapPct!=null)bits.push(`${st.gapPct>=0?'+':''}${pf3Fmt(st.gapPct,1)}% ${RT('до уровня','to level')}`);
    }
    if(r.deadline){
      const dl=st.dleft;
      bits.push(`📅 ${r.deadline}${dl!=null?` (${dl<0?RT('просрочен','past'):dl===0?RT('сегодня','today'):dl+RT(' дн','d')})`:''}`);
    }
    const qb=planQtyBit(r, st.price>0?st.price:st.lvl);
    if(qb)bits.push(qb);
    return`<div class="plan-row${st.ready&&!r.done?' is-ready':''}${r.done?' is-done':''}">
      <span class="plan-act ${r.act}">${planActIcon(r.act)} ${planActLabel(r.act)}</span>
      <span class="plan-main"><b>${esc(r.name||r.tk)}</b> <span class="plan-tk">${esc(r.tk)}</span> ${badge}${r.fromAi?`<span class="plan-src" title="${RT('Перенесено из совета AI','From AI advice')}${r.ver?' · v'+r.ver:''}">🤖${r.ver?' v'+r.ver:''}</span>`:''}<span class="plan-sub">${bits.join(' · ')}</span>${r.note?`<span class="plan-note">${esc(r.note)}</span>`:''}</span>
      ${can('action.edit_plan')?`<span class="plan-btns">
        <button class="pf3-del" onclick="planEdit('${r.id}')" title="${RT('Редактировать','Edit')}">✏</button>
        ${r.done?`<button class="pf3-del" onclick="planDone('${r.id}',0)" title="${RT('Вернуть в активные','Reactivate')}">↩</button>`:`<button class="plan-ok" onclick="planDone('${r.id}',1)" title="${RT('Отметить исполненным','Mark done')}">✓</button>`}
        <button class="pf3-del" onclick="planDel('${r.id}')" title="${RT('Удалить','Delete')}">🗑</button>
      </span>`:''}
    </div>`;
  }).join('');
  const canNotify=typeof Notification!=='undefined';
  const notifBtn=(canNotify&&Notification.permission!=='granted')
    ?`<button class="pf3-btn pf3-btn-sm" onclick="planAskNotify()">🔔 ${RT('Вкл. уведомления','Enable alerts')}</button>`:'';
  const hasProp=(()=>{const H=pf3AiHist();return!!(H[0]&&H[0].proposal&&(H[0].proposal.actions||[]).length);})();
  const importBtn=(can('action.edit_plan')&&hasProp)?`<button class="pf3-btn pf3-btn-sm" onclick="planImportFromAi()">📥 ${RT('Из совета AI','From AI advice')}</button>`:'';
  const addForm=`
    <datalist id="planTkList">${tkOpts}</datalist>
    <details class="plan-add"${mine.length?'':' open'}>
      <summary>➕ ${RT('Добавить правило плана','Add plan rule')}</summary>
      <div class="plan-add-form">
        <select id="planAct"><option value="buy">🟢 ${RT('Купить/докупить','Buy/add')}</option><option value="sell">🔴 ${RT('Сократить/продать','Trim/sell')}</option></select>
        <input id="planTk" list="planTkList" placeholder="${RT('Тикер','Ticker')}" autocomplete="off" style="text-transform:uppercase">
        <input id="planLvl" type="number" step="any" min="0" placeholder="${RT('Уровень цены','Price level')}">
        <input id="planCcy" placeholder="${RT('Валюта','Ccy')}" value="USD" style="width:64px;text-transform:uppercase">
        <input id="planQty" type="number" step="any" min="0" placeholder="${RT('Кол-во, шт','Qty, sh')}">
        <input id="planAmt" type="number" step="any" min="0" placeholder="${RT('или сумма, kr','or amount, kr')}">
        <input id="planDl" type="date" title="${RT('Дедлайн (необязательно)','Deadline (optional)')}">
        <input id="planNote" placeholder="${RT('Заметка / условие','Note / condition')}" style="flex:1;min-width:160px">
        <button class="pf3-btn" onclick="planAdd()">${RT('Добавить','Add')}</button>
      </div>
      <div class="pf3-reco-note">${RT('Уровень: для покупки сработает, когда цена опустится ДО уровня (≤); для продажи — когда поднимется ДО уровня (≥). Кол-во указывайте в штуках (акции покупаются поштучно). Если указать сумму в kr — покажу, сколько целых акций на неё влезает по цене. Дедлайн без уровня сработает по дате.','Level: a buy triggers when price drops TO the level (≤); a sell when it rises TO the level (≥). Enter quantity in shares (stocks are bought per share). If you enter a kr amount, I show how many whole shares it covers at price. A deadline without a level triggers by date.')}</div>
    </details>`;
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>🎯 ${RT('План действий','Action plan')} — ${TAB_LABEL(v3Key)}</span>${readyN?`<span class="pf3-asof"><b class="plan-ready-t">🔔 ${readyN} ${RT('к исполнению','ready')}</b></span>`:''}${importBtn}${notifBtn}</div>
    ${mine.length?`<div class="plan-list">${rows}</div>`:`<div class="pf3-empty">${RT('Правил пока нет. Нажмите «📥 Из совета AI», чтобы перенести предложение AI-Proto, или добавьте уровни/даты вручную — дашборд уведомит, когда придёт время действовать.','No rules yet. Click «📥 From AI advice» to import the AI-Proto proposal, or add levels/dates manually — the dashboard will alert you when it is time to act.')}</div>`}
    ${can('action.edit_plan')?addForm:''}
  </section>`;
}
function planAdd(){
  const g=id=>document.getElementById(id);
  const tk=String((g('planTk')&&g('planTk').value)||'').trim().toUpperCase();
  if(!tk){toast(RT('Укажите тикер','Enter a ticker'),true);return;}
  const act=(g('planAct')&&g('planAct').value)||'buy';
  const level=parseFloat(g('planLvl')&&g('planLvl').value)||0;
  const qty=parseFloat(g('planQty')&&g('planQty').value)||0;
  const amount=parseFloat(g('planAmt')&&g('planAmt').value)||0;
  const deadline=(g('planDl')&&g('planDl').value)||'';
  const note=String((g('planNote')&&g('planNote').value)||'').trim();
  let ccy=String((g('planCcy')&&g('planCcy').value)||'').trim().toUpperCase()||'USD';
  if(!(level>0)&&!deadline){toast(RT('Задайте уровень цены или дедлайн','Set a price level or a deadline'),true);return;}
  const d=pf3D(); let name=tk;
  const row=((d&&d.rows)||[]).find(r=>String(r[2]||'').trim().toUpperCase()===tk);
  if(row){ name=String(row[1]||tk); if(row[8])ccy=String(row[8]).toUpperCase(); }
  PLAN_RULES.push({id:'pl'+Date.now()+'_'+Math.floor(Math.random()*1e4),tab:v3Key,tk,name,ccy,act,level:level>0?level:0,qty:qty>0?qty:0,amount:amount>0?amount:0,deadline,note,hitAt:0,done:false});
  planAskNotify(true);   // тихо запросить разрешение на push при первом правиле
  scheduleSave();renderPF3();
  toast('🎯 '+RT('Правило добавлено','Rule added')+': '+tk);
}
function planDel(id){ PLAN_RULES=(PLAN_RULES||[]).filter(r=>r.id!==id); if(planEditId===id)planEditId=null; scheduleSave();renderPF3(); }
function planDone(id,v){ const r=(PLAN_RULES||[]).find(x=>x.id===id); if(!r)return; r.done=!!(+v); if(r.done)r.hitAt=0; scheduleSave();renderPF3(); }
function pf3SetYears(y){pf3State.years=y;renderPF3()}
// Цены + дневное изменение + SMA (обе серии) + поддержка/сопротивление для
// ОДНОЙ вкладки. Batched in chunks of 20 — the worker makes 2 Yahoo calls per
// symbol and Cloudflare caps subrequests; все чанки параллельно.
async function pf3FetchPrices(d,key){
  const syms=[...new Set(d.rows.map(r=>exSymbol(r[2],r[8])).filter(Boolean))];
  const chunks=[];
  // По 15: воркер на тикер делает ~3 подзапроса (chart 1y + chart 1d + weekly), лимит Cloudflare ~50.
  for(let i=0;i<syms.length;i+=15)chunks.push(syms.slice(i,i+15).join(','));
  const parts=await Promise.all(chunks.map(c=>fetch(PRICE_PROXY+'?symbols='+encodeURIComponent(c)).then(r=>r.json()).catch(()=>null)));
  const prices=Object.assign({},...parts.filter(Boolean));
  const {s50,s100,s200}=smaIdx(d);
  const supI=ensurePFCol(d,'Поддержка'),resI=ensurePFCol(d,'Сопротивление');
  let updated=0;
  d.rows.forEach((r,i)=>{
    const q=prices[exSymbol(r[2],r[8])];
    if(!(q&&typeof q.price==='number'))return;
    r[7]=q.price;
    if(typeof q.pct==='number')r[10]=Math.round(q.pct*100)/100;
    // Обе серии SMA (дневные и недельные) — в SMA_TF; в видимые колонки
    // идёт набор выбранного периода (1Г/3Г), а не всегда дневной. От этих
    // колонок считаются «Критерий» и «Сигнал» при перерисовке.
    const tk=String(r[2]||'');
    const mode=(SMA_TF[tk]&&SMA_TF[tk].mode)||'1Y';
    SMA_TF[tk]={mode,
      d:[q.sma50??null,q.sma100??null,q.sma200??null],
      w:[q.sma50w??null,q.sma100w??null,q.sma200w??null]};
    const set=mode==='3Y'?SMA_TF[tk].w:SMA_TF[tk].d;
    if(s50>=0&&set[0]!=null)r[s50]=set[0];
    if(s100>=0&&set[1]!=null)r[s100]=set[1];
    if(s200>=0&&set[2]!=null)r[s200]=set[2];
    if(q.support!=null)r[supI]=q.support;
    if(q.resistance!=null)r[resI]=q.resistance;
    recalcPF(i,key);updated++;
  });
  if(updated){
    pf3WriteReco(d);
    // База «Я vs AI» — стоимость МОЕГО портфеля по живым ценам. Ставится один
    // раз (myStartLive); базы, посчитанные по устаревшему сид-блобу до этого
    // флага, перефиксируются здесь же.
    if(key===PF3_KEY&&AI_PORT&&AI_PORT.myStartLive!=='1'){
      let eq=0;d.rows.forEach(r=>{eq+=parseFloat(r[13])||0});eq+=parseFloat(d.cashFree)||0;
      if(eq>0){AI_PORT.myStartEquity=Math.round(eq);AI_PORT.myStartLive='1';}
    }
    scheduleSave();
  }
  return updated;
}
async function pf3Refresh(silent){
  const d=pf3D();
  const btn=document.getElementById('pf3RefreshBtn');
  if(btn&&!silent){btn.disabled=true;btn.textContent='⏳ Обновляю…';}
  try{
    const updated=await pf3FetchPrices(d,v3Key);
    if(updated)pf3LastRefresh[v3Key]=Date.now();
    try{await pf3RefreshTargets(d)}catch(e){}   // аналит. таргеты — раз в сутки, тем же батч-паттерном
    try{planCheck()}catch(e){}                  // 🎯 сверить уровни плана и уведомить о достигнутых
    try{scnAlertCheck()}catch(e){}              // 📊 Блок D: сценарные алерты (триггеры/R/R/RSI)
    if(!silent)toast(`🔄 ${updated}/${d.rows.length} обновлено`,!updated);
  }catch(e){if(!silent)toast('Прокси цен недоступен',true);}
  // Don't redraw under the user's cursor while they edit qty / buy price.
  const ae=document.activeElement,area=document.getElementById('pf3Area');
  if(!(silent&&ae&&ae.tagName==='INPUT'&&area&&area.contains(ae)))renderPF3();
}

// Живая цена ОДНОЙ бумаги при открытии карточки — чтобы «потенциал роста»
// (таргет/цена) считался по актуальной цене, а не по последнему обновлению
// вкладки. Дёшево: один тикер; не чаще раза в 2 мин на символ.
let _cardPxAt={};
async function pf3RefreshCardPrice(d,r){
  const sym=exSymbol(r[2],r[8]);if(!sym)return;
  if(_cardPxAt[sym]&&Date.now()-_cardPxAt[sym]<45000)return;   // ~45с: «% за день» обновляется живо на открытой карточке
  _cardPxAt[sym]=Date.now();
  try{
    const j=await fetch(PRICE_PROXY+'?symbols='+encodeURIComponent(sym)).then(x=>x.json()).catch(()=>null);
    const q=j&&j[sym];
    if(!(q&&typeof q.price==='number')){_cardPxAt[sym]=0;return;}
    const i=d.rows.indexOf(r);if(i<0)return;
    const {s50,s100,s200}=smaIdx(d);
    const supI=ensurePFCol(d,'Поддержка'),resI=ensurePFCol(d,'Сопротивление');
    r[7]=q.price;
    if(typeof q.pct==='number')r[10]=Math.round(q.pct*100)/100;
    const tk=String(r[2]||''),mode=(SMA_TF[tk]&&SMA_TF[tk].mode)||'1Y';
    SMA_TF[tk]={mode,d:[q.sma50??null,q.sma100??null,q.sma200??null],w:[q.sma50w??null,q.sma100w??null,q.sma200w??null]};
    const set=mode==='3Y'?SMA_TF[tk].w:SMA_TF[tk].d;
    if(s50>=0&&set[0]!=null)r[s50]=set[0];
    if(s100>=0&&set[1]!=null)r[s100]=set[1];
    if(s200>=0&&set[2]!=null)r[s200]=set[2];
    if(q.support!=null)r[supI]=q.support;
    if(q.resistance!=null)r[resI]=q.resistance;
    recalcPF(i,v3Key);scheduleSave();
    // Перерисовать только если карточка той же бумаги ещё открыта и пользователь не печатает.
    const ae=document.activeElement;
    if(isV3()&&pf3Sel===tk&&!(ae&&ae.tagName==='INPUT'))renderPF3();
  }catch(e){_cardPxAt[sym]=0;}
}

// ── 🌅/🌙 Pre/post-market в карточке акции (лайв) ──
// Опрос ?prepost= каждые 20с, пока карточка этой бумаги открыта; блок обновляется
// in-place. Сам останавливается, когда карточка закрыта/сменилась.
let CARD_PP={},_cardPPTimer=null,_cardPPTk=null,_cardPPSym=null,_cardPPLoading=false;
function cardPPStop(){if(_cardPPTimer){clearInterval(_cardPPTimer);_cardPPTimer=null;}_cardPPTk=null;_cardPPSym=null;}
function cardPPStart(tk,sym){
  if(!tk||!sym)return;
  if(_cardPPTk===tk&&_cardPPTimer)return;   // уже опрашиваем эту бумагу
  cardPPStop();_cardPPTk=tk;_cardPPSym=sym;
  cardPPLoad();
  _cardPPTimer=setInterval(cardPPLoad,20000);
}
async function cardPPLoad(){
  const tk=_cardPPTk,sym=_cardPPSym;
  if(!tk||!sym)return;
  if(!(isV3()&&pf3Sel===tk)){cardPPStop();return;}   // карточка закрыта/сменилась — стоп
  if(document.hidden||_cardPPLoading)return;
  _cardPPLoading=true;
  try{
    const j=await fetch(PRICE_PROXY+'?prepost='+encodeURIComponent(sym)).then(r=>r.json()).catch(()=>null);
    if(j&&typeof j==='object'){CARD_PP[sym]={...j,at:Date.now()};const el=document.getElementById('pf3PrePost');if(el&&pf3Sel===tk)el.innerHTML=cardPPInner(sym);}
    // Освежаем и обычную котировку (цена + «% за день») — иначе дневной % «замерзает».
    const d=pf3D(),r=d&&Array.isArray(d.rows)&&d.rows.find(x=>String(x[2]||'')===tk);
    if(r)pf3RefreshCardPrice(d,r);
  }catch(e){}
  _cardPPLoading=false;
}
function cardPPInner(sym){
  const d=CARD_PP[sym];if(!d)return'';
  const st=String(d.state||'').toUpperCase();
  const seg=(o,ru,en)=>{if(!o||!(o.price>0))return'';const c=o.pct==null?'':o.pct>=0?'pf3-up':'pf3-down';return`<span class="pf3-pp-l">${RT(ru,en)}</span> <span class="pf3-pp-v ${c}">${pf3Fmt(o.price,2)} <small>${d.ccy||''}</small>${o.pct!=null?` (${o.pct>=0?'+':''}${o.pct.toFixed(2)}%)`:''}</span>`};
  let body='';
  if(st.indexOf('PRE')>=0)body=seg(d.pre,'🌅 Пре-маркет','🌅 Pre-market');
  else if(st.indexOf('POST')>=0)body=seg(d.post,'🌙 Пост-маркет','🌙 After-hours');
  else if(st==='CLOSED')body=seg(d.post,'🌙 Пост-маркет','🌙 After-hours')||seg(d.pre,'🌅 Пре-маркет','🌅 Pre-market');
  return body?`<span class="pf3-pp-live">●</span> ${body}`:'';
}

// ── 🌅/🌙 Изменение баланса портфеля по пре/пост-рынку (лайв, в сводке) ──
// Батч ?prepost=sym1,sym2,... по позициям текущего портфеля раз в 30с; считает
// суммарную дельту стоимости акций во внебиржевую сессию. Сам останавливается,
// когда вкладка портфеля закрыта/сменилась.
let PF_PP={},_pfPPTimer=null,_pfPPKey=null,_pfPPLoading=false;
function pfSumPPStop(){if(_pfPPTimer){clearInterval(_pfPPTimer);_pfPPTimer=null;}_pfPPKey=null;}
function pfSumPPStart(key){
  if(!key)return;
  if(_pfPPKey===key&&_pfPPTimer)return;   // уже опрашиваем этот портфель
  pfSumPPStop();_pfPPKey=key;
  pfSumPPLoad();
  _pfPPTimer=setInterval(pfSumPPLoad,30000);
}
async function pfSumPPLoad(){
  const key=_pfPPKey;if(!key)return;
  if(!(isV3()&&curIdx===key&&pf3IsPort(key))){pfSumPPStop();return;}   // ушли с портфеля — стоп
  const d=DATA[key];if(!d||!Array.isArray(d.rows))return;
  if(document.hidden||_pfPPLoading)return;
  _pfPPLoading=true;
  try{
    const syms=[...new Set(d.rows.map(r=>(parseFloat(r[6])||0)>0?exSymbol(r[2],r[8]):null).filter(Boolean))];
    if(syms.length){
      const j=await fetch(PRICE_PROXY+'?prepost='+encodeURIComponent(syms.join(','))).then(r=>r.json()).catch(()=>null);
      if(j&&typeof j==='object'){
        if(syms.length===1)PF_PP[syms[0]]=j; else Object.assign(PF_PP,j);   // 1 символ → объект бумаги, не карта
        const el=document.getElementById('pfSumPP');
        if(el&&curIdx===key)el.innerHTML=pfSumPPInner(DATA[key]);
      }
    }
  }catch(e){}
  _pfPPLoading=false;
}
function pfSumPPInner(d){
  if(!d||!Array.isArray(d.rows))return'';
  let deltaSEK=0,totalSEK=0,pre=0,post=0;
  d.rows.forEach(r=>{
    const qty=parseFloat(r[6])||0;if(!(qty>0))return;
    totalSEK+=parseFloat(r[13])||0;
    const pp=PF_PP[exSymbol(r[2],r[8])];if(!pp)return;
    const reg=pp.regular;if(!(reg>0))return;
    const st=String(pp.state||'').toUpperCase();
    let o=null,usedPre=false;
    if(st.indexOf('PRE')>=0){o=pp.pre;usedPre=true;}
    else if(st.indexOf('POST')>=0){o=pp.post;}
    else if(st==='CLOSED'){o=pp.post||pp.pre;usedPre=!pp.post;}   // CLOSED мог взять пре-маркет
    if(!o||!(o.price>0))return;
    const fx=FX[r[8]||'USD']||1;
    deltaSEK+=qty*(o.price-reg)*fx;
    if(usedPre)pre++;else post++;   // метку считаем по реально использованной котировке
  });
  if(pre+post===0)return'';   // нет внебиржевых котировок — блок скрыт (:empty)
  const pct=totalSEK>0?deltaSEK/totalSEK*100:null;
  const cls=deltaSEK>=0?'pf3-up':'pf3-down';
  const lbl=pre>=post?RT('🌅 Пре-маркет','🌅 Pre-market'):RT('🌙 Пост-маркет','🌙 After-hours');
  return`<span class="pf3-pp-live">●</span> <span class="pf3-pp-l">${lbl} · ${RT('изм. баланса','balance Δ')}</span> <span class="pf3-pp-v ${cls}">${deltaSEK>=0?'+':''}${pf3Money(d,deltaSEK)}${pct!=null?` (${pct>=0?'+':''}${pct.toFixed(2)}%)`:''}</span>`;
}

// Аналит. таргеты (Yahoo/Refinitiv-консенсус) для текущей вкладки: worker-эндпоинт
// ?targets= батчем по 40, раз в сутки. Покрывает Nasdaq 100, где FMP-cron не
// работает (лимит подзапросов Cloudflare); портфель тоже освежается между cron-ами.
let _tgEndpointDown=false;   // worker без ?targets отвечает не-JSON — выключаемся до перезагрузки страницы
async function pf3RefreshTargets(d){
  if(_tgEndpointDown)return;
  if(d.targetsAt&&Date.now()-d.targetsAt<24*3600*1000)return;
  const tgC=ensurePFCol(d,'Аналит. таргет');
  const syms=[...new Set(d.rows.map(r=>exSymbol(r[2],r[8])).filter(Boolean))];
  const chunks=[];
  // По 20: воркер делает 2 подзапроса на тикер (Yahoo + FMP), лимит Cloudflare — 50/запрос.
  for(let i=0;i<syms.length;i+=20)chunks.push(syms.slice(i,i+20).join(','));
  const parts=await Promise.all(chunks.map(c=>fetch(PRICE_PROXY+'?targets='+encodeURIComponent(c)).then(r=>r.json()).catch(()=>null)));
  const good=parts.filter(p=>p&&typeof p==='object'&&!p.error);
  if(!good.length){_tgEndpointDown=true;return;}
  const tg=Object.assign({},...good);
  const tgrC=ensurePFCol(d,'Таргет 3м');
  const peC=ensurePFCol(d,'P/E'),psC=ensurePFCol(d,'P/S'),dyC=ensurePFCol(d,'Дивид. %');
  const beC=ensurePFCol(d,'Beta'),roC=ensurePFCol(d,'ROE'),deC=ensurePFCol(d,'D/E'),rgC=ensurePFCol(d,'Рост выручки'),poC=ensurePFCol(d,'Payout');
  const rvC=ensurePFCol(d,'Выручка TTM'),cpC=ensurePFCol(d,'Кап-я');
  let n=0;
  d.rows.forEach(r=>{
    const q=tg[exSymbol(r[2],r[8])];
    if(!q)return;
    if(typeof q.avg==='number'&&q.avg>0)r[tgC]=q.avg;
    if(typeof q.recent==='number'&&q.recent>0)r[tgrC]=q.recent;
    if(typeof q.avg==='number'&&q.avg>0)TG_META[String(r[2]||'').trim().toUpperCase()]={n:q.count||0,nr:q.recentCount||0,span:q.recentSpan||null,src:q.src||null,at:Date.now()};
    if(typeof q.pe==='number'&&q.pe>0)r[peC]=Math.round(q.pe*10)/10;
    if(typeof q.ps==='number'&&q.ps>0)r[psC]=Math.round(q.ps*10)/10;
    if(typeof q.divy==='number'&&q.divy>0)r[dyC]=Math.round(q.divy*1000)/10;   // доля → %
    if(typeof q.beta==='number')r[beC]=Math.round(q.beta*100)/100;
    if(typeof q.roe==='number')r[roC]=Math.round(q.roe*10)/10;
    if(typeof q.de==='number')r[deC]=Math.round(q.de*100)/100;
    if(typeof q.revg==='number')r[rgC]=Math.round(q.revg*10)/10;
    if(typeof q.payout==='number')r[poC]=Math.round(q.payout*10)/10;
    if(typeof q.rev==='number')r[rvC]=q.rev;
    if(typeof q.cap==='number')r[cpC]=q.cap;
    n++;
  });
  if(n){
    // Свежие метрики → пересчитать типы по скорингу (методологии MSCI/S&P).
    d.rows.forEach(r=>{const t=pf3DeriveType(String(r[2]||'').trim().toUpperCase(),r[4],r[5],d,r);if(t&&r[5]!==t)r[5]=t});
    pf3WriteReco(d);
    d.targetsAt=Date.now();scheduleSave();
  }
}

// Auto-refresh while the Портфель 3.0 tab is open: immediately when stale, then every 5 min.
let pf3Timer=null,pf3LastRefresh={};   // время последнего обновления ПО ВКЛАДКАМ (раньше было общим → индексные вкладки показывали устаревшие seed-цены)
const PF3_REFRESH_MS=5*60*1000;
function pf3EnsureAutoRefresh(){
  if(!pf3Timer)pf3Timer=setInterval(()=>{if(isV3())pf3Refresh(true)},PF3_REFRESH_MS);
  const last=pf3LastRefresh[v3Key]||0;
  if(Date.now()-last>PF3_REFRESH_MS)pf3Refresh(true);   // открыли вкладку, чьи цены устарели → обновить сразу
}
function pf3StopAutoRefresh(){if(pf3Timer){clearInterval(pf3Timer);pf3Timer=null}}

async function refreshLivePrices(){
  if(!isAnalysis()){ toast('Обновление цен доступно на вкладках 💼 Портфель и Nasdaq 100'); return; }
  const d = DATA[curIdx];
  const priceC = d.headers.findIndex(x=>/^цена/i.test(x));   // price column (position varies by tab schema)
  const dayC = d.headers.findIndex(x=>/1д|день/i.test(x));   // 1-day % column
  const supIdx = ensurePFCol(d, 'Поддержка');        // Support level (rolling 3-month low)
  const resIdx = ensurePFCol(d, 'Сопротивление');    // Resistance level (rolling 3-month high)
  const tfExisted = d.headers.includes(SMA_TF_COL);
  ensurePFCol(d, SMA_TF_COL);                        // per-stock 1Г/3Г SMA timeframe toggle
  if(!tfExisted) positionAfter(d, d.headers.indexOf(SMA_TF_COL), /sma.?200/i);   // place right after SMA 200
  const btn = document.getElementById('refreshPricesBtn');
  if(btn){ btn.disabled = true; btn.textContent = '⏳ …'; }
  let updated = 0, manual = 0;
  manualPriceRows.clear();

  if(PRICE_PROXY){
    // One batched request → covers US + Nordic/EU via Yahoo.
    const symbols = [...new Set(d.rows.map(r => exSymbol(r[2], rowCcy(r))).filter(Boolean))];
    let prices = {};
    try{
      const r = await fetch(PRICE_PROXY + '?symbols=' + encodeURIComponent(symbols.join(',')));
      if(!r.ok) throw new Error('proxy ' + r.status);
      prices = await r.json();
    }catch(e){
      if(btn){ btn.disabled = false; btn.textContent = '🔄 Цены'; }
      toast('Прокси цен недоступен — проверьте PRICE_PROXY', true); return;
    }
    d.rows.forEach((row, i) => {
      const p = prices[exSymbol(row[2], rowCcy(row))];
      const price = (p && typeof p === 'object') ? p.price : p;   // worker now returns {price,pct}; tolerate legacy number
      if(price != null){
        if(priceC>=0) row[priceC] = price;
        if(p && typeof p === 'object'){
          if(dayC>=0 && typeof p.pct === 'number') row[dayC] = Math.round(p.pct * 100) / 100;   // 1д %
          if(typeof p.support === 'number') row[supIdx] = p.support;                    // Поддержка
          if(typeof p.resistance === 'number') row[resIdx] = p.resistance;              // Сопротивление
          // Store both daily (1Y) and weekly (3Y) SMA sets; show the one matching this stock's toggle.
          const tk = String(row[2] || ''), mode = (SMA_TF[tk] && SMA_TF[tk].mode) || '1Y';
          SMA_TF[tk] = { mode,
            d: [p.sma50 ?? null, p.sma100 ?? null, p.sma200 ?? null],
            w: [p.sma50w ?? null, p.sma100w ?? null, p.sma200w ?? null] };
          applySmaTF(d, i);
        }
        updated++;
      } else { manual++; manualPriceRows.add(i); }
    });
  } else {
    // Fallback: Finnhub free tier (US only).
    if(!finnhubKey){
      const k = prompt('Вставьте Finnhub API ключ (бесплатно), или задайте PRICE_PROXY для полного покрытия:');
      if(!k){ if(btn){ btn.disabled = false; btn.textContent = '🔄 Цены'; } return; }
      finnhubKey = k.trim(); scheduleSave();
    }
    for(let i = 0; i < d.rows.length; i++){
      const row = d.rows[i];
      let q = null;
      try{ q = await fetchFinnhub(exSymbol(row[2], rowCcy(row))); }catch(e){ q = null; }
      if(q != null){ if(priceC>=0) row[priceC] = q.price; if(dayC>=0 && typeof q.pct === 'number') row[dayC] = Math.round(q.pct * 100) / 100; updated++; } else { manual++; manualPriceRows.add(i); }
    }
  }

  renderTable(); scheduleSave();
  if(btn){ btn.disabled = false; btn.textContent = '🔄 Цены'; }
  toast(`🔄 ${updated} обновлено · ${manual} вручную` + (manual ? ' (выделены жёлтым)' : ''));
}

/* ===== Column visibility (per-tab, synced) ===== */
function toggleColsMenu(){
  const ex = document.getElementById('colsMenu');
  if(ex){ ex.remove(); document.removeEventListener('click', closeColsOnOutside); return; }
  const m = document.createElement('div'); m.id = 'colsMenu'; m.className = 'cols-menu';
  const hdrs = DATA[curIdx].headers, hid = hiddenCols[curIdx] || [];
  let html = '<div class="cols-menu-hd"><span>Колонки</span><button onclick="showAllCols()">Все</button></div>';
  hdrs.forEach((h, ci) => {
    html += `<label><input type="checkbox" ${hid.includes(ci) ? '' : 'checked'} onchange="toggleCol(${ci})"> ${h || '—'}</label>`;
  });
  m.innerHTML = html;
  document.body.appendChild(m);
  const btn = document.getElementById('colsBtn'), r = btn.getBoundingClientRect();
  m.style.top = (r.bottom + 6) + 'px';
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
  setTimeout(() => document.addEventListener('click', closeColsOnOutside), 0);
}
function closeColsOnOutside(e){
  const m = document.getElementById('colsMenu');
  if(m && !m.contains(e.target) && e.target.id !== 'colsBtn'){
    m.remove(); document.removeEventListener('click', closeColsOnOutside);
  }
}
function toggleCol(ci){
  if(!hiddenCols[curIdx]) hiddenCols[curIdx] = [];
  const arr = hiddenCols[curIdx], i = arr.indexOf(ci);
  if(i >= 0) arr.splice(i, 1); else arr.push(ci);
  scheduleSave(); renderTable();
}
function showAllCols(){
  hiddenCols[curIdx] = []; scheduleSave(); renderTable();
  const m = document.getElementById('colsMenu'); if(m) m.remove();
}

boot();

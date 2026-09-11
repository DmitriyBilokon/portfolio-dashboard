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


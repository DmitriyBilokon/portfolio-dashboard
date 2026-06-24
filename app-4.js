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
    v3Tabs().forEach(k=>{const d=DATA[k];if(!d||!Array.isArray(d.rows))return;d.rows.forEach(r=>{const tk=String(r[2]||'').trim().toUpperCase();if(!tks.has(tk)||added.has(tk))return;added.add(tk);const m=pf3TypeMetrics(d,r);const b=(typeof pf3RowBetyg==='function')?pf3RowBetyg({roe:m.roe,revg:m.revg,pe:m.pe,ps:m.ps,sec:r[4],r}):null;positions.push({ticker:r[2],name:r[1],sector:r[4],ccy:r[8]||'USD',price:num(r[7]),analystTarget:pf3EffTarget(d,r).target||null,upsidePct:pf3EffUpside(d,r),pe:m.pe,roe:m.roe,revGrowth:m.revg,betyg:b!=null?{score100:Math.round(b*10),grade:(pf3Grade(b)||{}).g||null}:null,phase:pf3Criterion(d,r).label})})});
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
        <div id="pf3Vol" class="pf3-vol">${cardVolInner(tk)}</div>
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

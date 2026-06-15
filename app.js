// Данные по умолчанию (const ALL) вынесены в data.js — он подключается в
// index.html ПЕРЕД этим файлом и кешируется отдельно от логики.
let DATA=ALL.data,RANK=ALL.rankings,SMA_IDX=ALL.sma;

// ===== Supabase sync config =====
// Create a free project at https://supabase.com, run the SQL in SETUP.md, then
// paste your Project URL + anon/publishable key below. Both are safe to expose
// in frontend code — your data is protected by login + Row-Level Security.
const SUPABASE_URL = 'https://fvrebkwczqmeorytujbn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9CIG7HU54hfBcexS4qr3rQ_HQygVVJC';
const SYNC_ENABLED = SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20;
const sb = SYNC_ENABLED ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let currentUser=null, realtimeChannel=null, pushTimer=null, applyingRemote=false, finnhubKey='', lastPushTs=0;
let manualPriceRows=new Set();   // portfolio row indices the last refresh couldn't price live

// The entire editable state, stored as one JSONB row per user.
function snapshotState(){
  return { data:DATA, rankings:RANK, sma:SMA_IDX, fx:FX, colOrders:colOrders,
           theme:(document.documentElement.dataset.theme||'light'), apiKey:finnhubKey,
           hiddenCols:hiddenCols, smaTf:SMA_TF, sim:SIM, aiChat:AI_CHAT, aiPrefs:AI_PREFS, tgAlerts:TG_ALERTS, tabGroups:TAB_GROUPS, tabOrder:TAB_ORDER, aiPort:AI_PORT, aiPortBak:AI_PORT_BAK, stockAiLog:STOCK_AI_LOG, insider:INSIDER, tgMeta:TG_META, val:VAL, aiReco:AI_RECO, aiSpend:AI_SPEND, aiDash:AI_DASH };
}
// Call after any edit: debounce-push to the cloud.
function scheduleSave(){ if(currentUser && !applyingRemote) schedulePush(); }
function schedulePush(){ clearTimeout(pushTimer); pushTimer=setTimeout(pushState, 800); }

async function pushState(){
  if(!currentUser) return;
  // 🤖 aiPort: торговым состоянием (позиции/кэш/журнал) владеет worker. Перед
  // записью берём его СЕРВЕРНУЮ копию — наша могла отстать, если realtime-канал
  // спал (сон ноутбука, фоновая вкладка), и тогда push стирал сделки AI.
  // За клиентом остаются только настройки.
  try{
    const { data:rw } = await sb.from('ledger_state').select('aiPort:data->aiPort').eq('user_id',currentUser.id).maybeSingle();
    const srv = rw && rw.aiPort;
    if(srv && typeof srv==='object' && srv.startedAt){
      const mine = AI_PORT || {};
      AI_PORT = { ...srv };
      ['strategy','intervalMin','commissionPct','minTradeSEK','enabled','startCapital','startedAt','myStartEquity','myStartLive']
        .forEach(k=>{ if(mine[k]!==undefined) AI_PORT[k]=mine[k]; });
    }
  }catch(e){ /* сеть/колонка недоступна — пушим как есть */ }
  const ts=new Date().toISOString();
  lastPushTs=Date.parse(ts);   // remember so the realtime echo of this push can be ignored
  const { error } = await sb.from('ledger_state')
    .upsert({ user_id:currentUser.id, data:snapshotState(), updated_at:ts });
  if(error) console.warn('Sync push failed', error);
}
async function pullState(){
  if(!currentUser) return;
  const { data, error } = await sb.from('ledger_state').select('data').eq('user_id',currentUser.id).maybeSingle();
  if(error){ console.warn('Sync pull failed', error); return; }
  if(data && data.data && Object.keys(data.data).length) applyRemoteState(data.data);
  else pushState();   // first login: seed the cloud with the bundled data
}
function applyRemoteState(s){
  applyingRemote=true;
  if(s.data) DATA=s.data;
  if(s.rankings) RANK=s.rankings;
  if(s.sma) SMA_IDX=s.sma;
  if(s.fx) FX=s.fx;
  if(s.colOrders) colOrders=s.colOrders;
  if(s.hiddenCols) hiddenCols=s.hiddenCols;
  if(s.smaTf) SMA_TF=s.smaTf;
  if(Array.isArray(s.sim)) SIM=s.sim;
  if(Array.isArray(s.aiChat)) AI_CHAT=s.aiChat;
  if(Array.isArray(s.aiPrefs)) AI_PREFS=s.aiPrefs;
  if(s.tgAlerts&&typeof s.tgAlerts==='object') TG_ALERTS=s.tgAlerts;
  if(s.aiPort&&typeof s.aiPort==='object') AI_PORT=s.aiPort;
  if(s.aiPortBak&&typeof s.aiPortBak==='object') AI_PORT_BAK=s.aiPortBak;
  if(Array.isArray(s.stockAiLog)) STOCK_AI_LOG=s.stockAiLog;
  if(s.insider&&typeof s.insider==='object') INSIDER=s.insider;
  if(s.tgMeta&&typeof s.tgMeta==='object') TG_META=s.tgMeta;
  if(s.val&&typeof s.val==='object') VAL=s.val;
  if(s.aiReco&&typeof s.aiReco==='object') AI_RECO=s.aiReco;
  if(s.aiSpend&&typeof s.aiSpend==='object') AI_SPEND=Object.assign({usd:0,runs:0,in:0,out:0,searches:0},s.aiSpend);
  if(s.aiDash&&typeof s.aiDash==='object') AI_DASH=(s.aiDash.cards||s.aiDash.headline)?{[PF3_KEY]:s.aiDash}:s.aiDash;   // миграция старого одиночного дашборда в карту по портфелям
  if(Array.isArray(s.tabGroups)) TAB_GROUPS=s.tabGroups;
  if(Array.isArray(s.tabOrder)) TAB_ORDER=s.tabOrder;
  if(typeof s.apiKey==='string') finnhubKey=s.apiKey;
  if(s.theme) applyTheme(s.theme);
  applyingRemote=false;
  init();   // rebuild tabs (idempotent) + re-render with synced data
}
function subscribeRealtime(){
  if(realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel=sb.channel('dash_'+currentUser.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'ledger_state',filter:'user_id=eq.'+currentUser.id},
        p=>{ if(!(p.new && p.new.data)) return;
             // Эхо своих push-ей и любые записи СТАРЕЕ нашего последнего сохранения
             // пропускаем: иначе отставший снапшот затирает свежие метрики/типы.
             const ts=Date.parse(p.new.updated_at)||0;
             if(lastPushTs && ts<=lastPushTs) return;
             if(pushTimer) return;   // есть несохранённые локальные правки — их нельзя терять
             applyRemoteState(p.new.data); })
    .subscribe();
}

// ===== Roles & tab access (table user_access — see supabase-access.sql) =====
// Админ видит всё и раздаёт вкладки; новые аккаунты — роль user, только Nasdaq 100.
const ADMIN_EMAILS=['dmitriy.bilokon@gmail.com','dmitriy.bilokon@justforthewin.com'];
let userRole='user', allowedTabs=['Nasdaq 100'], hbTimer=null;
// До входа и для роли user видны только разрешённые вкладки (по умолчанию Nasdaq 100).
const tabAllowed=n=>!SYNC_ENABLED||userRole==='admin'||(allowedTabs||[]).includes(n);
const isAdmin=()=>!SYNC_ENABLED||userRole==='admin';
async function initAccess(){
  // Хардкод-фолбэк: владелец остаётся админом, даже если таблица ещё не создана.
  userRole=ADMIN_EMAILS.includes((currentUser.email||'').toLowerCase())?'admin':'user';
  try{
    const{data,error}=await sb.rpc('ensure_access');   // создаёт/обновляет свою строку, возвращает {role,tabs}
    if(!error&&data){
      if(data.role==='admin')userRole='admin';
      if(Array.isArray(data.tabs)&&userRole!=='admin')allowedTabs=data.tabs;
    }
  }catch(e){ console.warn('access init failed',e); }
  const st=document.getElementById('settingsBtn'); if(st)st.style.display=userRole==='admin'?'':'none';
  const pb=document.getElementById('promptBtn'); if(pb)pb.style.display=userRole==='admin'?'':'none';
  const hs=document.querySelector('.header-sub'); if(hs&&userRole!=='admin')hs.textContent='Аналитика и технические уровни';
  clearInterval(hbTimer);
  hbTimer=setInterval(()=>{ sb.rpc('heartbeat').then(()=>{},()=>{}) },60000);   // онлайн-статус для админа
  init();   // перерисовать вкладки уже с учётом роли (важно при первом входе нового аккаунта)
}

// ===== Auth =====
async function handleLogin(e){
  e.preventDefault();
  const email=document.getElementById('authEmail').value.trim();
  const password=document.getElementById('authPassword').value;
  const btn=document.getElementById('authBtn'), err=document.getElementById('authError');
  err.textContent=''; btn.disabled=true; btn.textContent='Вход…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled=false; btn.textContent='Войти';
  if(error){ err.textContent=error.message; return; }
  currentUser=data.user; document.getElementById('authPassword').value='';
  await startApp();
}
async function handleLogout(){
  if(realtimeChannel){ sb.removeChannel(realtimeChannel); realtimeChannel=null; }
  clearInterval(hbTimer); userRole='user'; allowedTabs=['Nasdaq 100'];
  const st=document.getElementById('settingsBtn'); if(st)st.style.display='none';
  await sb.auth.signOut(); currentUser=null;
  document.getElementById('logoutBtn')?.style.setProperty('display','none');
  document.getElementById('authOverlay').classList.remove('hidden');
  init();   // за оверлеем входа остаются только публичные вкладки
}
async function startApp(){
  document.getElementById('authOverlay').classList.add('hidden');
  const lo=document.getElementById('logoutBtn'); if(lo){ lo.style.display=''; lo.title='Выйти ('+currentUser.email+')'; }
  await initAccess();   // роль + вкладки до первой отрисовки синхронизированных данных
  await pullState();
  subscribeRealtime();
  refreshFX();   // override synced rates with live USD/EUR/NOK→SEK (non-blocking)
}
async function boot(){
  initTheme();
  init();                         // paint with bundled data first
  if(!SYNC_ENABLED){ refreshFX(); return; }
  const { data:{ session } } = await sb.auth.getSession();
  if(session){ currentUser=session.user; await startApp(); }
  else { document.getElementById('authOverlay').classList.remove('hidden'); }
}
const META={'OMXS30':'🇸🇪','Nasdaq 100':'🇺🇸','OMXSPI':'🇸🇪','S&P 500':'🇺🇸','DAX 40':'🇩🇪','CAC 40':'🇫🇷','FTSE MIB':'🇮🇹','OBX 25':'🇳🇴',};
let FX={SEK:1,EUR:10.59,USD:8.93,NOK:0.9375,DKK:1.52,CAD:7.0,GBP:12.6,AUD:6.2};
// Бумажный (тестовый) портфель: [{tab,tk,name,ccy,qty,buy,date}] — у каждой
// v3-вкладки свои тестовые покупки (tab), синхронизируется с остальным состоянием.
let SIM=[];
// Кулдауны Telegram-алертов: пишет worker, клиент только прокидывает через
// свои сохранения, чтобы push дашборда не стирал память бота.
let TG_ALERTS={};
// AI Proto: диалог с ассистентом и его «память» — правила инвестора,
// которые ассистент извлекает из чата (и которые можно добавить вручную).
// Правила передаются и в чат, и в полный анализ портфеля (investorRules).
let AI_CHAT=[],AI_PREFS=[],aiChatBusy=false;
let AI_PORT=null,AI_PORT_BAK=null;   // 🤖 AI Портфель: состояние + резерв worker'а (round-trip)
let STOCK_AI_LOG=[];   // обучающая база: разборы акций {ticker,ts,price,ccy,verdict,target,horizon,text,data}
let INSIDER={};   // 🕵 инсайдерские сводки по тикеру (sync): {at,buyShares,buyUSD,sellShares,sellUSD,netUSD,cluster,tx,notified}
let TG_META={};   // 🎯 мета аналит-таргета по тикеру (sync): {n,nr,span('q'|'m'),src('fmp'|'yahoo'),at}
let VAL={};   // 📐 Valuation Check по тикеру (sync): {pe,fwdPe,ps,evEbitda,peg,sector,hist:{pe3,pe5,ps3,ps5,ev3,ev5},name,ccy,at,notified}
let _valBusy=false;
let insiderFilter={type:'all',minUSD:0};   // фильтр отображения сделок в карточке
let pf3StockAi={sym:null,loading:false,text:null,data:null,at:null};   // текущий показанный разбор
let AI_SPEND={usd:0,runs:0,in:0,out:0,searches:0};   // 💸 накопленные AI-расходы (sync)
let AI_DASH={};   // 📊 AI-Dashboard: {tabKey:{headline,cards,picks,asOf,at,cost}} — отдельно по портфелям (sync)
let _aiDashBusy=false,_aiDashSub=null,_aiDashProg='';
let AI_RECO={};   // 🔄 AI-Рекомендация по тикеру (sync): {verdict,confidence,headline,entryLow,entryHigh,keyRisks,text,price,ccy,at}
let _aiRecoLoading=null;   // тикер, по которому сейчас идёт запрос
let _aiRecoOpen={};   // раскрыт ли полный разбор по тикеру
let _stkCardOpen={};   // sym → раскрыт ли полный текст разбора в карточке
function stockAiToggle(sym){_stkCardOpen[sym]=!_stkCardOpen[sym];renderPF3();}
// Per-stock SMA timeframe: SMA_TF[ticker] = { mode:'1Y'|'3Y', d:[s50,s100,s200] (daily), w:[…] (weekly) }.
// The visible SMA columns show d (1Y) or w (3Y) per the stock's chosen mode. Persisted in snapshotState.
let SMA_TF={};
const SMA_TF_COL='Период SMA';
// ===== Live exchange rates (official mid-market, ≈ what Google shows) =====
// Base currency is SEK; FX[ccy] = how many SEK per 1 unit of ccy.
// Sources return "1 SEK = rates[ccy] ccy", so SEK-per-ccy = 1/rates[ccy].
// Tried in order; on total failure we keep whatever rates are already loaded.
const FX_CCYS=['USD','EUR','NOK','DKK'];
async function fetchRatesSEK(){
  const sources=[
    async()=>(await(await fetch('https://api.frankfurter.app/latest?from=SEK&to='+FX_CCYS.join(','))).json()).rates,            // ECB official reference rates
    async()=>{const j=await(await fetch('https://open.er-api.com/v6/latest/SEK')).json();return j&&j.result==='success'?j.rates:null;} // fallback
  ];
  for(const src of sources){
    try{
      const r=await src();
      if(r&&FX_CCYS.every(c=>typeof r[c]==='number'&&r[c]>0)){
        const out={};FX_CCYS.forEach(c=>out[c]=parseFloat((1/r[c]).toFixed(4)));return out;
      }
    }catch(e){}
  }
  return null;
}
async function refreshFX(){
  const live=await fetchRatesSEK();
  if(!live)return;                                  // network/source down → keep existing rates
  FX={...FX,SEK:1,...live};                          // override USD/EUR/NOK, preserve any other keys
  if(DATA[PF3_KEY])recalcAllPF(PF3_KEY);
  if(isV3())renderPF3();
  scheduleSave();                                    // persist live rates so the cloud + Telegram worker see them
}
const SEC_COLORS={'tech':['#dbeafe','#1e40af'],'software':['#c7d2fe','#3730a3'],'ai':['#c7d2fe','#3730a3'],'gpu':['#c7d2fe','#3730a3'],'semis':['#e0e7ff','#4338ca'],'information':['#dbeafe','#1e40af'],'health':['#dcfce7','#166534'],'pharma':['#dcfce7','#166534'],'biotech':['#d1fae5','#065f46'],'med':['#dcfce7','#166534'],'financ':['#fef3c7','#92400e'],'bank':['#fef3c7','#92400e'],'insurance':['#fef9c3','#854d0e'],'pe fund':['#fef3c7','#92400e'],'energy':['#ffedd5','#9a3412'],'oil':['#ffedd5','#9a3412'],'utilit':['#ecfccb','#3f6212'],'consumer':['#fce7f3','#9d174d'],'food':['#fce7f3','#9d174d'],'luxury':['#fdf2f8','#831843'],'industrial':['#e0f2fe','#075985'],'construction':['#e0f2fe','#075985'],'defense':['#fee2e2','#991b1b'],'naval':['#fee2e2','#991b1b'],'security':['#fee2e2','#991b1b'],'telecom':['#f3e8ff','#6b21a8'],'media':['#f3e8ff','#6b21a8'],'material':['#ccfbf1','#134e4a'],'gaming':['#ede9fe','#5b21b6'],'salmon':['#cffafe','#155e75'],'auto':['#f1f5f9','#334155'],'ship':['#e0f2fe','#075985']};
function getSC(s){s=(s||'').toLowerCase();for(const[k,[b,f]] of Object.entries(SEC_COLORS)){if(s.includes(k))return[b,f]}return['#f1f5f9','#475569']}
let curIdx='OMXS30',curSub='table',sortCol=-1,sortDir=0,searchTerm='',selected=new Set(),colOrders={},hiddenCols={},dragSrc=-1;
const isPF=()=>curIdx.startsWith('💼');
// The "v3" master-detail UI (body.v3 in styles.css) serves two tabs:
// Портфель 3.0 (full portfolio features) and Nasdaq 100 (index watchlist mode).
const PF3_KEY='🚀 Портфель 3.0';
const ANALYSIS_IDX='Nasdaq 100';
let v3Key=PF3_KEY;                  // which tab the v3 UI is currently bound to
const pf3D=()=>DATA[v3Key];
const HOME_KEY='🏠 Home';           // virtual tab: signal/level widgets over the v3 tabs
const DUP_KEY='🔁 Дубли';           // virtual tab (admin): пересечения составов индексов
const AIP_KEY='🤖 AI Портфель';     // virtual tab (admin): виртуальный счёт под управлением Claude
const STK_KEY='🔬 AI-разборы';      // virtual tab (admin): история разборов акций (обучающая база)
const AIDASH_KEY='📊 AI-Dashboard'; // virtual tab (admin): AI Proto генерит карточки-дашборд по портфелю
const pf3IsPort=k=>k===PF3_KEY||k===AIP_KEY||!!(DATA[k]&&DATA[k].port==='1');   // вкладки с экономикой позиций
const pf3MyPort=k=>pf3IsPort(k)&&k!==AIP_KEY;   // редактируемые портфели (мои/семейные, не AI)
const OMX_IDX='OMXS30';
// Все v3-вкладки: портфель + любые вкладки с флагом v3 (индексы и созданные пользователем).
const v3Tabs=()=>[PF3_KEY,...Object.keys(DATA).filter(k=>k!==PF3_KEY&&k!==AIP_KEY&&DATA[k]&&DATA[k].v3==='1')];
// Группы вкладок: по умолчанию по странам; пользовательская раскладка хранится в TAB_GROUPS (sync).
let TAB_GROUPS=null;
let TAB_ORDER=[];   // порядок негруппированных вкладок (drag-and-drop), синхронизируется
const defaultGroups=()=>[
  {name:'🇺🇸 USA',tabs:['S&P 500','Nasdaq 100']},
  {name:'🇸🇪 Швеция',tabs:['OMXS30','OMXSPI']},
  {name:'🇩🇪 Германия',tabs:['DAX 40']},
  {name:'🇫🇷 Франция',tabs:['CAC 40']},
  {name:'🇮🇹 Италия',tabs:['FTSE MIB']},
  {name:'🇳🇴 Норвегия',tabs:['OBX 25']},
];
const ensureGroups=()=>{if(!Array.isArray(TAB_GROUPS))TAB_GROUPS=defaultGroups().map(g=>({name:g.name,tabs:g.tabs.slice()}));return TAB_GROUPS};
let _grpCollapsed={};try{_grpCollapsed=JSON.parse(localStorage.getItem('dash_grpcol')||'{}')}catch(e){}
function grpToggleCollapse(name){_grpCollapsed[name]=!_grpCollapsed[name];try{localStorage.setItem('dash_grpcol',JSON.stringify(_grpCollapsed))}catch(e){}init()}
// Негруппированные вкладки в их пользовательском порядке (TAB_ORDER); новые,
// которых ещё нет в порядке, идут в конец по порядку появления.
function ungroupedKeys(){
  const keys=Object.keys(DATA).filter(k=>k!==AIP_KEY&&tabAllowed(k));
  const grouped=new Set();
  ensureGroups().forEach(g=>g.tabs.forEach(tn=>{if(tn!==PF3_KEY&&keys.includes(tn))grouped.add(tn)}));
  const un=keys.filter(k=>k!==PF3_KEY&&!grouped.has(k));
  const ord=Array.isArray(TAB_ORDER)?TAB_ORDER:[];
  return un.slice().sort((a,b)=>{
    let ia=ord.indexOf(a),ib=ord.indexOf(b);
    if(ia<0)ia=1e6+un.indexOf(a);
    if(ib<0)ib=1e6+un.indexOf(b);
    return ia-ib;
  });
}
// ── Перетаскивание вкладок (админ): меняем порядок и группировку ──
let _dragTab=null;
function tabDragStart(ev,key){_dragTab=key;try{ev.dataTransfer.effectAllowed='move';ev.dataTransfer.setData('text/plain',key)}catch(e){}}
function tabDragOver(ev){if(_dragTab){ev.preventDefault();ev.currentTarget.classList.add('drag-over')}}
function tabDragLeave(ev){ev.currentTarget.classList.remove('drag-over')}
function tabDragClear(){document.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'))}
function tabDropOn(ev,dropKey){
  ev.preventDefault();tabDragClear();
  const drag=_dragTab;_dragTab=null;
  if(!drag||drag===dropKey)return;
  reorderTab(drag,dropKey);
}
function tabDropGroup(ev,gName){
  ev.preventDefault();tabDragClear();
  const drag=_dragTab;_dragTab=null;
  if(!drag)return;
  const groups=ensureGroups();
  groups.forEach(g=>{g.tabs=g.tabs.filter(x=>x!==drag)});
  TAB_ORDER=(Array.isArray(TAB_ORDER)?TAB_ORDER:[]).filter(x=>x!==drag);
  const g=groups.find(g=>g.name===gName);if(g)g.tabs.push(drag);
  scheduleSave();init();
}
// Вставить drag перед dropKey — в его группе или в негруппированной зоне.
function reorderTab(drag,dropKey){
  const groups=ensureGroups();
  groups.forEach(g=>{g.tabs=g.tabs.filter(x=>x!==drag)});
  const tgt=groups.find(g=>g.tabs.includes(dropKey));
  if(tgt){
    tgt.tabs.splice(tgt.tabs.indexOf(dropKey),0,drag);
    TAB_ORDER=(Array.isArray(TAB_ORDER)?TAB_ORDER:[]).filter(x=>x!==drag);
  }else{
    const ord=ungroupedKeys().filter(x=>x!==drag);
    const i=ord.indexOf(dropKey);
    if(i<0)ord.push(drag);else ord.splice(i,0,drag);
    TAB_ORDER=ord;
  }
  scheduleSave();init();
}
const isV3=()=>v3Tabs().includes(curIdx)||curIdx===HOME_KEY||curIdx===DUP_KEY||curIdx===AIP_KEY||curIdx===STK_KEY||curIdx===AIDASH_KEY;
// ===== i18n: RU (база) / EN. T() переводит по словарю; непереведённые строки
// остаются как есть. Переключатель — кнопка RU/EN в шапке, выбор на устройстве.
let LANG='ru';
const T=x=>(LANG==='en'&&I18N_EN[x])||x;
const TAB_LABEL=k=>{const d=typeof DATA!=='undefined'&&DATA[k];return(d&&d.title)?d.title:(k===PF3_KEY?T('Портфель'):T(k))};
const RT=(ru,en)=>LANG==='en'?en:ru;   // для строк с подстановками
function initLang(){try{LANG=localStorage.getItem('dash_lang')==='en'?'en':'ru'}catch(e){}const b=document.getElementById('langBtn');if(b)b.textContent=LANG==='ru'?'EN':'RU'}
function toggleLang(){LANG=LANG==='ru'?'en':'ru';try{localStorage.setItem('dash_lang',LANG)}catch(e){}initLang();init()}
const I18N_EN={
'Портфель':'Portfolio','Nasdaq 100':'Nasdaq 100',
'📊 Портфель':'📊 Portfolio','📊 Акции':'📊 Stocks','🏭 Сектора':'🏭 Sectors','🏷 Тип':'🏷 Type','🧪 Симуляция':'🧪 Simulation','📅 Дивиденды и отчёты':'📅 Dividends & Earnings','🩺 Состояние портфеля':'🩺 Portfolio Health','⚖️ Предложение':'⚖️ Proposal',
'Компания':'Company','Сектор':'Sector','Тип':'Type','Кол-во':'Qty','Покупка':'Buy','Цена':'Price','Стоимость':'Value','Доля':'Share','Критерий':'Criterion','Сигнал':'Signal','1д %':'1d %','Таргет':'Target',
'Защитная':'Defensive','Качественная':'Quality','Циклическая':'Cyclical','Дивидендная':'Dividend','Рост':'Growth','Спекулятивная':'Speculative','Акция':'Stock','Фонд':'Fund','Прочее':'Other','Сектора':'Sectors','Типы':'Types',
'Падающий нож':'Falling knife','Даунтренд':'Downtrend','Коррекция':'Correction','Боковик':'Sideways','Разворот':'Reversal','Недооценка':'Undervalued','Аптренд':'Uptrend','Импульс':'Momentum','Перегрев':'Overheated',
'Продажа':'Sell','Докупка':'Add','ниже уровней':'below levels','Поддержка':'Support','Сопр.':'Res.','Сопротивление':'Resistance',
'Чистый капитал':'Net worth','акции + свободный кэш':'stocks + free cash','Акции':'Stocks','Прибыль':'Profit','от вложений':'on cost','позиций':'positions','Свободный кэш':'Free cash','Кредитное плечо':'Leverage','доступный кредит сверх капитала':'broker credit on top of equity','Доступно с плечом':'Buying power','капитал + кредитное плечо':'equity + leverage','💱 Курсы':'💱 FX','живые курсы ECB · база SEK':'live ECB rates · SEK base','нажмите, чтобы изменить':'click to edit','% капитала · доступно для покупок':'% of equity · available to buy',
'📊 Рынок сейчас':'📊 Market now','рыночные фазы по технике и фундаменталу':'market phases by technicals & fundamentals','🟢 Покупать / докупать сейчас':'🟢 Buy / add now','цена в ±2% от SMA или поддержки':'price within ±2% of an SMA or support','🔴 Продавать — у сопротивления':'🔴 Sell — at resistance','цена в ±2% от сопротивления':'price within ±2% of resistance','🎯 Подходят к уровню покупки':'🎯 Approaching a buy level','до ближайшего уровня ≤ 5%':'≤ 5% to the nearest level','🔪 Падающие ножи':'🔪 Falling knives','не ловить — ждать стабилизации':'do not catch — wait for stabilization','⚡ Движения дня':'⚡ Top movers','самые сильные изменения за сессию':'biggest moves of the session','в портфеле':'in portfolio','акц.':'stk.','портфеля':'of portfolio','ср. за день':'avg day',
'Сейчас никто не стоит у уровня покупки':'No stock sits at a buy level right now','У сопротивления никого нет':'Nothing at resistance','Никто не приближается к уровням':'Nothing approaching a level','Свободных падений нет — хороший знак':'No free falls — a good sign','Рынок спит':'The market is quiet','Нет данных':'No data',
'🧪 Симуляция':'🧪 Simulation','тестовый режим — без реальных денег':'test mode — no real money','Цена покупки':'Buy price','🧪 Купить (тест)':'🧪 Buy (test)','🧪 Тестовый портфель':'🧪 Paper portfolio','покупка — в карточке акции, кнопка «Купить (тест)»':'buy from a stock card via “Buy (test)”','Вложено (тест)':'Invested (test)','Стоимость сейчас':'Value now','по живым ценам и курсу':'at live prices and FX','Результат':'Result','позиц.':'pos.','Вложено':'Invested','П/У':'P/L','куплено':'bought',
'💪 Здоровье бизнеса':'💪 Business health','🔬 AI-анализ акции':'🔬 AI stock analysis','🔄 AI-Рекомендация':'🔄 AI recommendation','📐 Оценка — мультипликаторы (Valuation Check)':'📐 Valuation Check — multiples','📅 Ближайший отчёт и ожидания рынка':'📅 Next earnings & market expectations','🎯 Технические уровни':'🎯 Technical levels','📈 График · SMA 50/100/200 · уровни':'📈 Chart · SMA 50/100/200 · levels','🛒 Уровни покупки / докупки':'🛒 Buy / add levels','по техданным · авто-обновление каждые 5 мин':'from technicals · auto-refreshed every 5 min','✏️ Моя позиция':'✏️ My position','Кол-во акций':'Shares','🔄 Обновить цену':'🔄 Refresh price','Годовой отчёт':'Annual report','Посл. квартал':'Last quarter','Стоимость позиции':'Position value','Аналит. таргет':'Analyst target','за день':'today','потенциал':'upside','Удалить':'Remove','Удалить акцию':'Remove stock','Закрыть позицию':'Close position','Закрыть тестовую позицию':'Close test position',
'Календарь — отчёты и дивиденды':'Calendar — earnings & dividends','Сегодня':'Today','отчёт':'earnings','экс-дата':'ex-div','выплата':'payout','клик по событию открывает карточку':'click an event to open the card','💰 Дивиденды':'💰 Dividends','kr/год по текущим позициям':'kr/yr at current positions','Дивид./год':'Div./yr','Доходность':'Yield','Экс-дата':'Ex-date','Выплата':'Pay date','Мне в год':'My yearly','Дивидендных бумаг в портфеле нет':'No dividend payers here','Дат отчётов пока нет':'No earnings dates yet','Загружаю календарь отчётов и дивидендов…':'Loading the earnings & dividends calendar…',
'➕ Добавить акцию':'➕ Add stock','Тикер':'Ticker','уже в списке':'is already listed','добавлен':'added',
'🤖 AI Proto — обучается, анализирует портфель и обгоняет индексы':'🤖 AI Proto — learns, analyzes the portfolio and beats the indices','🔮 Проанализировать портфель':'🔮 Analyze portfolio','⏳ Анализирую… (30–60 сек)':'⏳ Analyzing… (30–60 s)','💬 Чат с AI Proto':'💬 AI Proto chat','видит портфель, цены и ваши правила':'sees your portfolio, prices and rules','очистить':'clear','Отправить':'Send','Ваш вопрос или указание ассистенту…':'Your question or instruction…','🧠 Память AI Proto — правила инвестора':'🧠 AI Proto memory — investor rules','учитываются в чате и в полном анализе':'applied in chat and in the full analysis','Добавить правило вручную…':'Add a rule manually…','➕ Запомнить':'➕ Remember','📜 История запросов':'📜 History','⚖️ Предложение по балансировке портфеля':'⚖️ Portfolio rebalancing proposal',
'❓ Справка':'❓ Help','Нажмите на раздел, чтобы развернуть его':'Click a section to expand it','🗂 Вкладки и виды':'🗂 Tabs & views','🏷 Тип акции':'🏷 Stock type','📊 Критерий — рыночная фаза (техника + фундаментал)':'📊 Criterion — market phase (technicals + fundamentals)','🎯 Сигнал — цена у технического уровня (±2%)':'🎯 Signal — price at a technical level (±2%)','🧪 Симуляция — тестовые покупки':'🧪 Simulation — paper trades','📐 Технические уровни и колонки':'📐 Technical levels & columns','💼 Портфельные значения':'💼 Portfolio values','💪 Здоровье бизнеса (карточка акции)':'💪 Business health (stock card)',
'Нажмите на строку — карточка с полными данными откроется слева от списка':'Click a row — the full card opens to the left of the list','📋 Акции':'📋 Stocks','🔄 Обновить акции':'🔄 Refresh stocks','Рекомендация':'Recommendation','🤖 AI Портфель':'🤖 AI Portfolio','🔬 AI-разборы':'🔬 AI analyses',
'Критично':'Critical','Слабо':'Weak','Средне':'Fair','Хорошо':'Good','Отлично':'Excellent',
'Критическое':'Critical','Слабое':'Weak','Среднее':'Fair','Хорошее':'Good','Отличное':'Excellent',
'Устойчивый баланс':'Solid balance sheet','Положительный денежный поток':'Positive cash flow','Долгосрочный рост':'Long-term growth',
'Долг/капитал':'Debt/equity','Ликвидность':'Liquidity','Кэш':'Cash','на конец квартала':'at quarter end','Свободный CF':'Free CF','Операционный CF':'Operating CF','за 12 мес (TTM)':'TTM (12 mo)','за фин. год':'fiscal year','Выручка CAGR':'Revenue CAGR','лет':'yr','Квартал г/г':'Quarter YoY','Год к году':'Year over year','Выручка':'Revenue',
'отчёт от':'report of','заполняется worker-ом (cron / ?action=targets)':'filled by the worker (cron / ?action=targets)','появится при обновлении акций (🔄, раз в сутки)':'arrives with the stock refresh (🔄, once a day)','🔁 Дубли':'🔁 Duplicates','Потенциал %':'Upside %','Таргет 3м':'Target 3m','Дивид. %':'Div. %','Колонки':'Columns','Доп. колонки списка':'Extra list columns','значения приходят с обновлением акций':'values arrive with the stock refresh',
'Загружаю отчётность…':'Loading financials…','Загрузка…':'Loading…','Загружаю календарь отчётов…':'Loading the earnings calendar…',
'Дата отчёта':'Earnings date','Ожидание: EPS':'Estimate: EPS','Ожидание: выручка':'Estimate: revenue','консенсус аналитиков':'analyst consensus','сегодня':'today','завтра':'tomorrow','Прошлый отчёт':'Last report','к прогнозу':'vs estimate','Дата следующего отчёта ещё не объявлена':'Next earnings date not announced yet',
'Здоровье портфеля:':'Portfolio health:','Состояние компании:':'Company health:','🧩 Диверсификация':'🧩 Diversification','💱 Валюты':'💱 Currencies','💵 Кэш и плечо':'💵 Cash & leverage','📈 Тренд и качество':'📈 Trend & quality','🏭 Распределение по секторам':'🏭 Sector allocation','💱 Распределение по валютам':'💱 Currency allocation','💡 Рекомендации':'💡 Recommendations',
'Нет позиций для анализа — обновите цены на вкладке «Портфель»':'No positions to analyze — refresh prices on the Portfolio tab',
'Нажмите «Обновить цену» — уровни покупки рассчитаются по SMA и поддержке':'Press “Refresh price” — buy levels are computed from SMA and support',
};

const isAnalysis=()=>isPF()||curIdx===ANALYSIS_IDX;
// Currency for symbol resolution: the row's «Валюта» column if present, else USD (index tables like Nasdaq).
function rowCcy(row){const ci=DATA[curIdx].headers.findIndex(x=>/валют/i.test(x));return ci>=0?(row[ci]||''):'USD'}
function getOrd(){const n=DATA[curIdx].headers.length;if(!colOrders[curIdx])colOrders[curIdx]=DATA[curIdx].headers.map((_,i)=>i);else for(let i=0;i<n;i++)if(!colOrders[curIdx].includes(i))colOrders[curIdx].push(i);return colOrders[curIdx]}
function recalcPF(i,idx){const d=DATA[idx||curIdx],r=d.rows[i];const qty=parseFloat(r[6])||0,price=parseFloat(r[7])||0,buy=parseFloat(r[9])||0,ccy=String(r[8]||'SEK'),fxNow=FX[ccy]||1;r[13]=Math.round(qty*price*fxNow);r[11]=buy>0?r[13]-Math.round(qty*buy*fxNow):0;r[12]=buy>0?parseFloat(((price-buy)/buy*100).toFixed(2)):0}
function recalcAllPF(idx){const k=idx||curIdx;DATA[k].rows.forEach((_,i)=>recalcPF(i,k))}
// Базовая валюта вкладки: по умолчанию SEK (kr); у Sergei — USD (без перевода в кроны).
// Денежные суммы позиций считаются в SEK (r[13]); для показа конвертируем в базовую.
// d.cashFree и d.leverage хранятся уже в БАЗОВОЙ валюте вкладки.
const pf3Base=d=>String((d&&d.baseCcy)||'SEK').toUpperCase();
const pf3BaseFx=d=>{const b=pf3Base(d);return b==='SEK'?1:(FX[b]||1)};   // SEK за 1 единицу базовой
const pf3BaseUnit=d=>{const b=pf3Base(d);return b==='SEK'?'kr':b};        // подпись валюты
const pf3Cv=(d,sek)=>{const f=pf3BaseFx(d);return f===1?sek:sek/f};       // SEK → базовая (число)
const pf3Money=(d,sek,dec)=>`${pf3Fmt(pf3Cv(d,sek),dec)} ${pf3BaseUnit(d)}`;   // SEK → «X kr» / «X USD»

// Ensure the portfolio has the analyst-target column (added by a feature update).
function migratePortfolio(){
  const pf = DATA['💼 Портфель 2.0']; if(!pf) return;
  if(pf.headers.indexOf('Аналит. таргет') === -1){
    pf.headers.push('Аналит. таргет');
    pf.rows.forEach(r => { while(r.length < pf.headers.length) r.push(''); });
    if(!applyingRemote) scheduleSave();
  }
}
// Seed the Портфель 3.0 tab and keep its holdings list in sync with Портфель 2.0:
// every PF2 ticker missing here is imported (qty / buy price carry over). Rows become
// PF3's own copies — later edits in 3.0 don't touch 2.0.
function migratePortfolio3(){
  const pf2=DATA['💼 Портфель 2.0'];
  if(!DATA[PF3_KEY])
    DATA[PF3_KEY]={headers:pf2?pf2.headers.slice():['#','Компания','Тикер','Страна','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','1д %','Прибыль','От покупки %','Стоимость','X-dag','Выплата','SMA 50','SMA 100','SMA 200','Целевая','Цель %','Действие'],rows:[],count:0,subtitle:'Портфель 3.0'};
  const d=DATA[PF3_KEY];
  let added=0;
  if(pf2){
    const have=new Set(d.rows.map(r=>String(r[2]||'').trim().toUpperCase()));
    const removed=new Set((d.removed||[]).map(s=>String(s).trim().toUpperCase()));   // user deleted these in 3.0 — don't re-import
    pf2.rows.forEach(r=>{
      const tk=String(r[2]||'').trim().toUpperCase();
      if(!tk||have.has(tk)||removed.has(tk))return;
      const row=r.slice();
      while(row.length<d.headers.length)row.push('');
      d.rows.push(row);have.add(tk);added++;
    });
  }
  if(!d.rows.length){   // no Портфель 2.0 in this state — fall back to the single MU seed
    d.rows.push([1,'Micron Technology','MU','🇺🇸','Полупроводники','Акция',0,0,'USD',0,0,0,0,0,'—','—','','','',0,0,'⚪ Держать']);
    added++;
  }
  if(added){
    d.rows.forEach((r,i)=>{r[0]=i+1});
    d.count=d.rows.length;
    if(!applyingRemote)scheduleSave();
  }
}
// One-time sync with the broker statement (Avanza screenshot, 2026-06-10):
// share counts + buy prices for both portfolio tabs, cash/leverage for the summary.
// Marked done via brokerSnap/cashSnap flags in the synced state, so it runs once.
function migrateBrokerSnap20260610(){
  const SNAP={MU:[5,509.48],AVGO:[6,408.08],BKNG:[10,156.55],RHM:[1,1196.60],O:[20,66.11],MSFT:[3,373.04],META:[2,573.42],GOOG:[3,288.00],NVDA:[5,174.10],MCHP:[8,99.17],AZN:[4,1659.75],MSTR:[5,123.30]};   // ticker → [qty, buy price]
  let touched=false;
  ['💼 Портфель 2.0',PF3_KEY].forEach(k=>{
    const d=DATA[k];
    if(!d||d.brokerSnap==='2026-06-10')return;
    d.rows.forEach((r,i)=>{
      const s=SNAP[String(r[2]||'').trim().toUpperCase()];
      if(!s)return;
      r[6]=s[0];r[9]=s[1];
      recalcPF(i,k);
    });
    d.brokerSnap='2026-06-10';
    touched=true;
  });
  // Cash semantics ('b' revision): 283 179 = весь капитал (акции + свободные),
  // store only свободные (113 848) and плечо (50 000); totals are computed live.
  const p3=DATA[PF3_KEY],p2=DATA['💼 Портфель 2.0'];
  if(p3&&p3.cashSnap!=='2026-06-10b'){
    p3.cashFree=113848;p3.leverage=50000;p3.cashSnap='2026-06-10b';
    delete p3.cash;   // obsolete field from the first revision
    if(p2)p2.cash=113848;   // PF2's «Кэш» card = свободные средства
    touched=true;
  }
  if(touched&&!applyingRemote)scheduleSave();
}
// Proper company names — manual adds and some imports stored the ticker as the name.
const PF3_NAMES={MU:'Micron Technology',AVGO:'Broadcom',BKNG:'Booking Holdings',RHM:'Rheinmetall',O:'Realty Income',MSFT:'Microsoft',META:'Meta Platforms',GOOG:'Alphabet (Class C)',NVDA:'NVIDIA',MCHP:'Microchip Technology',AZN:'AstraZeneca',MSTR:'Strategy (MicroStrategy)'};
// Sectors for rows that have none ('—'); applied only when the cell is empty.
const PF3_SECTORS={MU:'Полупроводники',AVGO:'Полупроводники',MCHP:'Полупроводники',AZN:'Фармацевтика',BKNG:'Путешествия / E-commerce',MSFT:'Software / Cloud',META:'Соцсети / Реклама',GOOG:'Search / Cloud',NVDA:'ИИ / Чипы',O:'Недвижимость (REIT)',RHM:'Оборона',MSTR:'Bitcoin / Software'};
// Avanza-style instrument types (r[5]): Защитная · Качественная · Циклическая ·
// Дивидендная · Рост · Стоимость (+ ETF/Фонд from the Yahoo quoteType, never
// overwritten). Recomputed on every load so a stale synced value heals itself:
// per-ticker map first, sector-based fallback for stocks added later.
const PF3_TYPE_META={'Защитная':['🛡','def'],'Качественная':['💎','qual'],'Циклическая':['🔄','cyc'],'Дивидендная':['💰','div'],'Рост':['🚀','gro'],'Стоимость':['📊','val'],'Спекулятивная':['⚡','spec'],'ETF':['🧺','etf'],'Фонд':['🧺','etf']};
const PF3_TYPES={
  // Портфель 3.0
  MU:'Циклическая',AVGO:'Качественная',MCHP:'Циклическая',AZN:'Защитная',BKNG:'Качественная',
  MSFT:'Качественная',META:'Рост',GOOG:'Качественная',GOOGL:'Качественная',NVDA:'Рост',
  O:'Дивидендная',PLD:'Дивидендная',RHM:'Рост',MSTR:'Рост',
  // Nasdaq 100 — мегакэпы / качество
  AAPL:'Качественная',AMZN:'Рост',NFLX:'Рост',TSLA:'Рост',COST:'Качественная',
  ASML:'Качественная',TXN:'Качественная',ADI:'Качественная',LIN:'Качественная',HON:'Качественная',
  INTU:'Качественная',ADBE:'Качественная',CRM:'Качественная',SNPS:'Качественная',CDNS:'Качественная',
  ADP:'Качественная',VRSK:'Качественная',CTAS:'Качественная',CPRT:'Качественная',ORLY:'Качественная',
  ROST:'Качественная',ODFL:'Качественная',EA:'Качественная',SBUX:'Качественная',MAR:'Циклическая',
  MNST:'Качественная',VRTX:'Качественная',MELI:'Рост',
  // Рост: ИИ, облако, кибербезопасность, биотех-спекулятивные
  AMD:'Рост',ARM:'Рост',MRVL:'Рост',SMCI:'Рост',PLTR:'Рост',APP:'Рост',TTD:'Рост',
  SNOW:'Рост',DDOG:'Рост',MDB:'Рост',TEAM:'Рост',WDAY:'Рост',CSGP:'Рост',
  PANW:'Рост',CRWD:'Рост',FTNT:'Рост',ZS:'Рост',ANET:'Рост',AXON:'Рост',DASH:'Рост',
  ISRG:'Рост',DXCM:'Рост',MRNA:'Рост',CEG:'Рост',GEV:'Рост',LCID:'Рост',
  // Циклические: полупроводниковое оборудование, память, авто, энергосервис
  AMAT:'Циклическая',LRCX:'Циклическая',KLAC:'Циклическая',INTC:'Циклическая',QCOM:'Циклическая',
  ON:'Циклическая',PCAR:'Циклическая',CDW:'Циклическая',BKR:'Циклическая',ENPH:'Циклическая',
  // Защитные: фарма, потребтовары, коммунальные, телеком
  GILD:'Защитная',GEHC:'Защитная',PEP:'Защитная',MDLZ:'Защитная',TMUS:'Защитная',EXC:'Защитная',
  // Дивидендные и стоимостные
  KHC:'Дивидендная',CSCO:'Дивидендная',
  CHTR:'Стоимость',WBD:'Стоимость',SIRI:'Стоимость',PYPL:'Стоимость',DLTR:'Стоимость',DG:'Стоимость',
};
const PF3_REIT_RE=/\breit\b|недвиж/i;
const PF3_DEF_RE=/фарма|pharma|здравоохран|health|медицин|потребительск|staples|consumer defensive|beverages|напитк|utilit|коммунал|телеком|telecom/i;
const PF3_GRO_RE=/software|облач|cloud|\bии\b|\bai\b|интернет|e-?comm|соцсет|social|биотех|biotech|кибер|cyber|данн|data|стриминг|streaming|search/i;
const PF3_CYC_RE=/полупровод|semicond|чип|chip|memory|авто|auto|truck|промышл|industrial|энерг|energy|нефть|oil|gas|сырь|материал|metal|банк|financ|финанс|туризм|travel|отел|hotel|транспорт|logistic|логистик|retail|ритейл|ресторан|restaurant|оборон|defense|aerospace|добыч|золот|серебр|mining|gold|silver|горнодоб|грузовик|подшипник|строительств|лесопром|теплонасос|теплообмен|электрификац|промтех|конгломерат|инвестиц/i;
// ── Скоринг типов по правилам индекс-провайдеров (MSCI/S&P/Morningstar) ──
// Метрики приходят суточным батчем ?targets и лежат в строках: Beta, ROE, D/E,
// Рост выручки, Payout, P/E, P/S, Дивид. %. Каждый тип набирает очки; лучший —
// первичный тип, второй — вторичная метка (для пограничных, как Microsoft).
function pf3TypeMetrics(d,r){
  const h=d.headers,g=name=>{const i=h.indexOf(name);const v=i>=0?parseFloat(r[i]):NaN;return isFinite(v)?v:null};
  return{beta:g('Beta'),roe:g('ROE'),de:g('D/E'),revg:g('Рост выручки'),payout:g('Payout'),pe:g('P/E'),ps:g('P/S'),divy:g('Дивид. %'),rev:g('Выручка TTM'),cap:g('Кап-я')};
}
function pf3TypeScores(m,sec){
  const sc={'Защитная':0,'Качественная':0,'Циклическая':0,'Дивидендная':0,'Рост':0,'Стоимость':0,'Спекулятивная':0};
  const has=v=>typeof v==='number'&&isFinite(v);
  const s=String(sec||'');
  // Защитная/Циклическая: beta + сектор (MSCI Defensive/Cyclical Sectors).
  // У циклического сектора низкая бета защитных очков почти не даёт (Volvo,
  // неликвидные микрокапы — там низкая бета артефакт, а не защитность).
  const cycSec=PF3_CYC_RE.test(s);
  if(has(m.beta)){
    if(m.beta<0.8)sc['Защитная']+=cycSec?0.5:2;else if(m.beta<1)sc['Защитная']+=cycSec?0.25:1;
    if(m.beta>1.2)sc['Циклическая']+=1.5;else if(m.beta>1.05)sc['Циклическая']+=0.5;
  }
  if(PF3_DEF_RE.test(s))sc['Защитная']+=1.5;
  if(PF3_CYC_RE.test(s))sc['Циклическая']+=1.5;
  if(PF3_REIT_RE.test(s))sc['Дивидендная']+=2;
  // Качественная: ROE + D/E (MSCI Quality). Гейт прибыльности: убыточной
  // компании низкий долг очков не даёт — кэш у неё от допэмиссий, не от бизнеса.
  if(has(m.roe)){
    if(m.roe>=20)sc['Качественная']+=2;else if(m.roe>=15)sc['Качественная']+=1;
    if(m.roe<=-5){sc['Качественная']-=2;sc['Спекулятивная']+=2;}        // настоящие убытки
    else if(m.roe<0)sc['Спекулятивная']+=0.5;                            // грань безубыточности (CRWD-кейс)
  }
  if(has(m.de)&&(!has(m.roe)||m.roe>0)){if(m.de<0.5)sc['Качественная']+=has(m.roe)&&m.roe>=10?1:0.25;else if(m.de<1)sc['Качественная']+=0.5;else if(m.de>2)sc['Качественная']-=0.5;}
  // Спекулятивная: венчур на публичном рынке — убыток + экстремальный P/S,
  // отсутствие P/E (нет прибыли) при дорогой оценке.
  if(has(m.ps)){if(m.ps>=20)sc['Спекулятивная']+=1.5;else if(m.ps>=12)sc['Спекулятивная']+=0.75;}
  if(!has(m.pe)&&has(m.ps)&&m.ps>=8)sc['Спекулятивная']+=1;
  if(has(m.pe)&&m.pe>0)sc['Спекулятивная']-=1;   // прибыль есть → это не венчурная ставка
  // Масштаб бизнеса: выручка ≥ $1 млрд — не венчур; крошечная выручка при
  // миллиардной капитализации — чистая ставка на ожидания.
  if(has(m.rev)&&m.rev>=1e9)sc['Спекулятивная']-=1;
  if(has(m.rev)&&has(m.cap)&&m.rev<1e8&&m.cap>1e9)sc['Спекулятивная']+=1.5;
  // Дивидендная: yield + payout 30–75% (Aristocrats-стиль устойчивости)
  if(has(m.divy)){if(m.divy>=4)sc['Дивидендная']+=2.5;else if(m.divy>=3)sc['Дивидендная']+=1.5;else if(m.divy>=2)sc['Дивидендная']+=0.5;}
  if(has(m.payout)&&m.payout>=30&&m.payout<=75)sc['Дивидендная']+=0.5;
  // Рост: рост выручки (Russell/MSCI Growth)
  if(has(m.revg)){
    if(m.revg>=20)sc['Рост']+=2.5;else if(m.revg>=15)sc['Рост']+=1.5;else if(m.revg>=8)sc['Рост']+=0.5;
    if(m.revg<0)sc['Рост']-=1;
    if((!has(m.divy)||m.divy===0)&&m.revg>=8)sc['Рост']+=0.5;
  }
  if(has(m.ps)&&m.ps>=8&&has(m.revg)&&m.revg>=10)sc['Рост']+=0.5;
  // Стоимость: P/E против среднего по сектору + абсолютные пороги
  const avg=PF3_VAL_AVG[pf3MacroSector(s)]||[22,3];
  if(has(m.pe)&&m.pe>0){
    if(m.pe<=avg[0]*0.6)sc['Стоимость']+=2;else if(m.pe<=avg[0]*0.8)sc['Стоимость']+=1;
    if(m.pe<=10)sc['Стоимость']+=0.5;
  }
  if(has(m.ps)&&m.ps>0&&m.ps<=avg[1]*0.5)sc['Стоимость']+=0.5;
  if(has(m.divy)&&m.divy>=3)sc['Стоимость']+=0.5;
  return Object.entries(sc).sort((a,b)=>b[1]-a[1]);
}
// Первичный + вторичный тип. Вторичный — если набрал ≥2 и ≥60% от первичного.
function pf3TypeFull(d,r){
  const m=pf3TypeMetrics(d,r);
  if(!(m.beta!=null||m.roe!=null||m.revg!=null))return null;   // метрик ещё нет
  const sc=pf3TypeScores(m,r[4]);
  if(!(sc[0][1]>0))return null;
  const secd=(sc[1][1]>=2&&sc[1][1]>=sc[0][1]*0.6)?sc[1][0]:null;
  return{primary:sc[0][0],secondary:secd};
}
function pf3DeriveType(tk,sec,cur,d,r){
  if(/etf|фонд/i.test(cur||''))return cur;
  if(d&&r){const f=pf3TypeFull(d,r);if(f)return f.primary;}   // скоринг по live-метрикам
  if(PF3_TYPES[tk])return PF3_TYPES[tk];                       // фолбэк: карта тикеров
  const s=sec||'';                                              // фолбэк: сектор
  if(PF3_REIT_RE.test(s))return 'Дивидендная';
  if(PF3_DEF_RE.test(s))return 'Защитная';
  if(PF3_GRO_RE.test(s))return 'Рост';
  if(PF3_CYC_RE.test(s))return 'Циклическая';
  return 'Акция';   // нейтрально до прихода метрик — «Качественную» надо заслужить
}
function fixCompanyNames(){
  let touched=false;
  ['💼 Портфель 2.0',...v3Tabs()].forEach(k=>{
    const d=DATA[k];if(!d)return;
    d.rows.forEach(r=>{
      const tk=String(r[2]||'').trim().toUpperCase();
      const proper=PF3_NAMES[tk],sec=PF3_SECTORS[tk];
      if(proper&&(!r[1]||String(r[1]).trim().toUpperCase()===tk)){r[1]=proper;touched=true;}
      if(sec&&(!r[4]||r[4]==='—')){r[4]=sec;touched=true;}
      const typ=pf3DeriveType(tk,r[4],r[5],d,r);
      if(r[5]!==typ){r[5]=typ;touched=true;}
    });
  });
  if(touched&&!applyingRemote)scheduleSave();
}
// One-time: convert the Nasdaq 100 tab to the PF row schema so the v3
// master-detail UI (list + cards) can render it. Old columns are mapped by
// header name; qty/buy stay 0 (it's a watchlist, not a position list).
function migrateNasdaqV3(){
  migrateIndexV3(ANALYSIS_IDX,'🇺🇸','USD');
  migrateIndexV3('OMXS30','🇸🇪','SEK');
  migrateIndexV3('OMXSPI','🇸🇪','SEK');
  migrateIndexV3('S&P 500','🇺🇸','USD');
  migrateIndexV3('DAX 40','🇩🇪','EUR');
  migrateIndexV3('CAC 40','🇫🇷','EUR','.PA');   // Париж — суффикс прямо в тикере
  migrateIndexV3('FTSE MIB','🇮🇹','EUR','.MI'); // Милан
  migrateIndexV3('OBX 25','🇳🇴','NOK');
}
// One-time: convert a classic index tab to the PF row schema so the v3
// master-detail UI can render it. Columns are mapped by header name.
function migrateIndexV3(KEY,flag,ccy,sfx){
  const d=DATA[KEY],p3=DATA[PF3_KEY];
  if(!d||!p3||d.v3==='1')return;
  const oh=d.headers,find=re=>oh.findIndex(x=>re.test(String(x)));
  const o={sec:find(/сектор|отрасль/i),price:find(/^цена/i),day:find(/1д|день/i),tg:find(/аналит|^таргет/i),s50:find(/sma.?50/i),s100:find(/sma.?100/i),s200:find(/sma.?200/i),sup:oh.indexOf('Поддержка'),res:oh.indexOf('Сопротивление'),div:find(/^дивид/i)};
  const nh=p3.headers.slice();
  const n={s50:nh.findIndex(x=>/sma.?50/i.test(x)),s100:nh.findIndex(x=>/sma.?100/i.test(x)),s200:nh.findIndex(x=>/sma.?200/i.test(x)),sup:nh.indexOf('Поддержка'),res:nh.indexOf('Сопротивление'),tg:nh.findIndex(x=>/аналит/i.test(x))};
  const num=(r,i)=>i>=0?(parseFloat(r[i])||0):0;
  const rows=d.rows.filter(r=>String(r[2]||'').trim()).map((r,i)=>{
    const row=new Array(nh.length).fill('');
    const tk0=String(r[2]).trim();
    row[0]=i+1;row[1]=r[1]||tk0;row[2]=(sfx&&!tk0.includes('.'))?tk0.replace(/\s+/g,'-')+sfx:tk0;row[3]=flag;row[4]=o.sec>=0?(r[o.sec]||'—'):'—';row[5]='Акция';
    row[6]=0;row[7]=num(r,o.price);row[8]=ccy;row[9]=0;row[10]=num(r,o.day);
    row[11]=0;row[12]=0;row[13]=0;row[14]='—';row[15]=o.div>=0?(r[o.div]||'—'):'—';
    if(n.s50>=0)row[n.s50]=num(r,o.s50)||'';
    if(n.s100>=0)row[n.s100]=num(r,o.s100)||'';
    if(n.s200>=0)row[n.s200]=num(r,o.s200)||'';
    if(n.sup>=0&&o.sup>=0)row[n.sup]=num(r,o.sup)||'';
    if(n.res>=0&&o.res>=0)row[n.res]=num(r,o.res)||'';
    if(n.tg>=0)row[n.tg]=num(r,o.tg)||'';
    return row;
  });
  DATA[KEY]={headers:nh,rows,count:rows.length,subtitle:d.subtitle||KEY,v3:'1',xcols:d.xcols};
  if(!applyingRemote)scheduleSave();
}
// Портфель 2.0 is retired — Портфель 3.0 owns the holdings now. Runs after
// migratePortfolio3 so a fresh state still seeds 3.0 from the bundled 2.0 data.
function migrateRemovePF2(){
  if(DATA['💼 Портфель 2.0']){
    delete DATA['💼 Портфель 2.0'];
    if(!applyingRemote)scheduleSave();
  }
}

// Одноразово: AI-отчёты индексов, сохранённые до фикса во вкладку Портфель,
// переезжают в свои вкладки. Watchlist-отчёт узнаём по разделу «Картина по
// индексу», вкладку — по упоминанию имени индекса.
function migrateAiHistory(){
  const pf=DATA[PF3_KEY];
  if(!pf||pf.aiMig==='2')return;
  pf.aiMig='2';
  // Шведские тикеры OMXS30 — портфельный отчёт о них не рассуждает.
  const SWE=/SAAB|VOLV|ERIC|TELIA|TEL2|ATCO|EVO\b|HEXA|SAND|\bBOL\b|SKF|ESSITY|SEB A|SWED|SHB|INVE B|ASSA|ALFA|NIBE|EPI A|LIFCO|ADDT|SKA B|INDU C/g;
  const moved={};
  pf.aiHistory=(pf.aiHistory||[]).filter(e=>{
    const t=String(e&&e.text||'');
    const watch=/Картина по индексу/i.test(t);
    const sweHits=(t.match(SWE)||[]).length;
    let idx=null;
    if(watch)idx=/OMXS30/i.test(t)?OMX_IDX:/Nasdaq.?100/i.test(t)?ANALYSIS_IDX:null;
    else if(/OMXS30/i.test(t)&&sweHits>=3)idx=OMX_IDX;   // старый формат, но контент индексный
    if(!idx||!DATA[idx])return true;
    (moved[idx]=moved[idx]||[]).push(e);
    return false;
  });
  let n=0;
  Object.entries(moved).forEach(([k,arr])=>{
    DATA[k].aiHistory=[...arr,...(DATA[k].aiHistory||[])].slice(0,10);n+=arr.length;
  });
  if(n&&!applyingRemote)scheduleSave();
}
function init(){
  migratePortfolio();migratePortfolio3();migrateBrokerSnap20260610();fixCompanyNames();migrateNasdaqV3();migrateRemovePF2();simMigrateTabs();migrateAiHistory();migrateGoldSilver();migrateSmallCap();migrateTabAdds();migrateFamilyPortfolios();migrateAiPort();restoreXcols();
  const keys=Object.keys(DATA).filter(k=>k!==AIP_KEY&&tabAllowed(k));   // AIP — только как виртуальная (mkVirt), иначе дубль
  if((curIdx===DUP_KEY||curIdx===AIP_KEY||curIdx===STK_KEY||curIdx===AIDASH_KEY)&&!isAdmin())curIdx=keys[0]||Object.keys(DATA)[0];
  if(curIdx!==HOME_KEY&&curIdx!==DUP_KEY&&curIdx!==AIP_KEY&&curIdx!==STK_KEY&&curIdx!==AIDASH_KEY&&(!DATA[curIdx]||!tabAllowed(curIdx)))curIdx=keys[0]||Object.keys(DATA)[0];
  const t=document.getElementById('tabs');t.innerHTML='';
  const mkTab=n=>{
    const el=document.createElement('div');
    el.className='tab'+(n===curIdx?' active':'');el.dataset.tab=n;
    el.innerHTML=`${META[n]||''} ${TAB_LABEL(n)}<span class="cnt">${DATA[n].count}</span>`;
    el.onclick=()=>{curIdx=n;sortCol=-1;sortDir=0;curSub='table';selected.clear();renderAll()};
    if(isAdmin()&&n!==PF3_KEY){
      el.draggable=true;el.title=RT('Перетащите, чтобы переставить','Drag to reorder');
      el.addEventListener('dragstart',e=>tabDragStart(e,n));
      el.addEventListener('dragover',tabDragOver);
      el.addEventListener('dragleave',tabDragLeave);
      el.addEventListener('drop',e=>tabDropOn(e,n));
      el.addEventListener('dragend',tabDragClear);
    }
    return el;
  };
  const mkVirt=(key,label)=>{
    const el=document.createElement('div');
    el.className='tab'+(curIdx===key?' active':'');el.dataset.tab=key;el.textContent=label;
    el.onclick=()=>{curIdx=key;renderAll()};
    return el;
  };
  t.appendChild(mkVirt(HOME_KEY,HOME_KEY));
  if(isAdmin())t.appendChild(mkVirt(AIP_KEY,TAB_LABEL(AIP_KEY)));
  if(isAdmin())t.appendChild(mkVirt(DUP_KEY,TAB_LABEL(DUP_KEY)));
  if(isAdmin())t.appendChild(mkVirt(STK_KEY,TAB_LABEL(STK_KEY)));
  if(isAdmin())t.appendChild(mkVirt(AIDASH_KEY,TAB_LABEL(AIDASH_KEY)));
  if(keys.includes(PF3_KEY))t.appendChild(mkTab(PF3_KEY));
  // Группы (страны по умолчанию, пользовательская раскладка — из TAB_GROUPS).
  const groups=ensureGroups();
  const grouped=new Set();
  groups.forEach(g=>{
    const members=g.tabs.filter(n=>n!==PF3_KEY&&keys.includes(n));
    members.forEach(n=>grouped.add(n));
    if(!members.length)return;
    const col=!!_grpCollapsed[g.name];
    const hd=document.createElement('div');
    hd.className='tab-group-hd'+(col?' col':'');
    hd.textContent=(col?'▸ ':'▾ ')+g.name;
    hd.onclick=()=>grpToggleCollapse(g.name);
    if(isAdmin()){
      hd.addEventListener('dragover',tabDragOver);
      hd.addEventListener('dragleave',tabDragLeave);
      hd.addEventListener('drop',e=>tabDropGroup(e,g.name));
    }
    t.appendChild(hd);
    if(!col)members.forEach(n=>t.appendChild(mkTab(n)));
  });
  ungroupedKeys().forEach(n=>{if(!grouped.has(n))t.appendChild(mkTab(n))});
  if(isAdmin()){
    const add=document.createElement('div');add.className='tab tab-add';add.textContent=RT('➕ Вкладка','➕ Tab');add.title=RT('Создать свою вкладку-watchlist','Create a custom watchlist tab');add.onclick=pf3NewTab;t.appendChild(add);
    const grp=document.createElement('div');grp.className='tab tab-add';grp.textContent=RT('🗂 Группы','🗂 Groups');grp.title=RT('Настроить группировку вкладок','Edit tab grouping');grp.onclick=toggleGroupsEditor;t.appendChild(grp);
  }
  renderAll();
}


// Одноразово: наполняем пользовательскую вкладку «Gold and Silver» золото-
// серебряными добытчиками (тикеры проверены на Yahoo 2026-06-12). Если вкладки
// нет — создаём; уже добавленные пользователем бумаги не трогаем.
function migrateGoldSilver(){
  const KEY='Gold and Silver',p3=DATA[PF3_KEY];
  if(!p3)return;
  const d=DATA[KEY]||(DATA[KEY]={headers:p3.headers.slice(),rows:[],count:0,v3:'1',custom:'1',subtitle:KEY});
  if(d.gsSeed==='1')return;
  d.gsSeed='1';
  const SEC='Добыча золота и серебра';
  const SEED=[
    ['FF.TO','First Mining Gold Corp','CAD','🇨🇦'],['NGEX.TO','NGEx Minerals','CAD','🇨🇦'],
    ['PRU.TO','Perseus Mining Limited','CAD','🇨🇦'],['MSA.TO','Mineros S.A.','CAD','🇨🇦'],
    ['APM.TO','Andean Precious Metals Corp','CAD','🇨🇦'],['CG.TO','Centerra Gold','CAD','🇨🇦'],
    ['SVRS.V','Silver Storm Mining Ltd.','CAD','🇨🇦'],['AGX.V','Silver X Mining Corp','CAD','🇨🇦'],
    ['SVM.TO','Silvercorp Metals','CAD','🇨🇦'],['TXG.TO','Torex Gold Resources Inc','CAD','🇨🇦'],
    ['WGX.TO','Westgold Resources Limited','CAD','🇨🇦'],['TG.V','Trifecta Gold','CAD','🇨🇦'],
    ['EML.V','Electric Metals (USA) Ltd','CAD','🇨🇦'],
    ['FRES.L','Fresnillo PLC','GBP','🇬🇧'],
    ['LUG','Lundin Gold','SEK','🇸🇪'],['EPI A','Epiroc A','SEK','🇸🇪'],['GULD','Guldbrev Holding','SEK','🇸🇪'],
    ['MUX','McEwen Inc.','USD','🇺🇸'],['HMY','Harmony Gold Mining ADR','USD','🇺🇸'],
    ['EQX','Equinox Gold','USD','🇺🇸'],['CDE','Coeur Mining','USD','🇺🇸'],['SBSW','Sibanye-Stillwater ADR','USD','🇺🇸'],
  ];
  SEED.forEach(([tk,name,ccy,flag])=>{
    if(d.rows.some(r=>String(r[2]||'').trim().toUpperCase()===tk.toUpperCase()))return;
    const row=new Array(d.headers.length).fill('');
    row[0]=d.rows.length+1;row[1]=name;row[2]=tk;row[3]=flag;row[4]=SEC;row[5]='Циклическая';
    row[6]=0;row[7]=0;row[8]=ccy;row[9]=0;row[10]=0;row[11]=0;row[12]=0;row[13]=0;row[14]='—';row[15]='—';
    d.rows.push(row);
  });
  d.count=d.rows.length;
  if(!applyingRemote)scheduleSave();
}
// Вкладка «Small Cap»: шведские компании малой капитализации (скриншот пользователя,
// тикеры проверены живыми котировками Yahoo). Тип пересчитает скоринг при первом
// обновлении метрик; сектор задан для иконок/группировки.
function migrateSmallCap(){
  const KEY='Small Cap',p3=DATA[PF3_KEY];
  if(!p3)return;
  const d=DATA[KEY]||(DATA[KEY]={headers:p3.headers.slice(),rows:[],count:0,v3:'1',custom:'1',subtitle:KEY});
  if(d.scSeed==='1')return;
  d.scSeed='1';
  const SEED=[
    ['EPEN','Ependion','Промтех и автоматизация'],
    ['NEWA-B','New Wave Group','Потребительские товары: одежда'],
    ['BEIA-B','Beijer Alma','Промышленный конгломерат'],
    ['SHOT','Scandic Hotels','Отели и туризм'],
    ['FMM-B','FM Mattsson','Строительство: сантехника'],
    ['TROAX','Troax Group','Промышленная безопасность'],
    ['SYSR','Systemair','Промтех: вентиляция'],
    ['ARJO-B','Arjo','Медицинское оборудование'],
    ['PLAZ-B','Platzer Fastigheter','Недвижимость'],
    ['MILDEF','MilDef Group','Оборонная электроника'],
    ['ELAN-B','Elanders','Промышленность: логистика'],
    ['XANO-B','XANO Industri','Промтех: автоматизация'],
    ['ITAB','ITAB Shop Concept','Потребительский сектор: ритейл-оборудование'],
    ['ARPL','Arla Plast','Промышленность: пластики'],
    ['GARO','GARO','Электрификация и EV-зарядка'],
    ['BOUL','Boule Diagnostics','Медицинская диагностика'],
  ];
  SEED.forEach(([tk,name,sec])=>{
    if(d.rows.some(r=>String(r[2]||'').trim().toUpperCase()===tk.toUpperCase()))return;
    const row=new Array(d.headers.length).fill('');
    row[0]=d.rows.length+1;row[1]=name;row[2]=tk;row[3]='🇸🇪';row[4]=sec;row[5]='Акция';
    row[6]=0;row[7]=0;row[8]='SEK';row[9]=0;row[10]=0;row[11]=0;row[12]=0;row[13]=0;row[14]='—';row[15]='—';
    d.rows.push(row);
  });
  d.count=d.rows.length;
  if(!applyingRemote)scheduleSave();
}
// 🤖 AI Портфель: дефолтное состояние (worker торгует, клиент отображает).
// myStartEquity — стоимость МОЕГО портфеля в момент старта (для «Я vs AI»).
function migrateAiPort(){
  if(AI_PORT&&AI_PORT.startedAt)return;
  // Базу «Я vs AI» НЕ считаем здесь: при первой загрузке цены ещё из сид-блоба
  // data.js (устаревшие). myStartEquity поставит первый живой рефреш цен
  // (pf3FetchPrices, флаг myStartLive) — иначе сравнение стартует с фантомного
  // минуса/плюса.
  const myEq=0;
  AI_PORT={startedAt:Date.now(),startCapital:300000,cashSEK:300000,commissionPct:0,minTradeSEK:5000,
    intervalMin:60,enabled:true,
    strategy:'Цель — опережать эталонные индексы (OMXS30, Nasdaq 100, S&P 500). Сбалансированная: ~40% Качественные, ~25% Рост, ~15% Дивидендные, ~10% Защитные, ~10% Спекулятивные. Кэш-резерв минимум 5%, максимум 15% в одной позиции. Горизонт — недели-месяцы: свинг по уровням SMA 50/200 и поддержки, фиксация у сопротивления/таргета.',
    positions:[],trades:[],equityHistory:[],myStartEquity:null,lastRunAt:0,lastNote:''};
  if(!applyingRemote)scheduleSave();
}
// Точечные добавления акций в индексные вкладки (по запросам пользователя).
// Идемпотентно: проверка по тикеру, флагов не нужно.
function migrateTabAdds(){
  const ADDS=[
    // [вкладка, тикер, название, сектор, валюта, флаг]  · HEM.ST проверен на Yahoo 2026-06-14
    ['OMXSPI','HEM','Hemnet Group','Интернет-площадка недвижимости','SEK','🇸🇪'],
  ];
  let n=0;
  ADDS.forEach(([key,tk,name,sec,ccy,flag])=>{
    const d=DATA[key];
    if(!d||d.v3!=='1')return;
    if(d.rows.some(r=>String(r[2]||'').trim().toUpperCase()===tk.toUpperCase()))return;
    const row=new Array(d.headers.length).fill('');
    row[0]=d.rows.length+1;row[1]=name;row[2]=tk;row[3]=flag;row[4]=sec;row[5]='Акция';
    row[6]=0;row[7]=0;row[8]=ccy;row[9]=0;row[10]=0;row[11]=0;row[12]=0;row[13]=0;row[14]='—';row[15]='—';
    d.rows.push(row);d.count=d.rows.length;n++;
  });
  if(n&&!applyingRemote)scheduleSave();
}
// Семейные портфели: Портфель → «Portfolio (Dima)» (однократно, флаг ttlMig);
// «Portfolio (Anna)» — второй полноценный портфель (port:'1'), позиции со
// скрина Avanza 2026-06-14, тикеры проверены живыми котировками Yahoo.
function migrateFamilyPortfolios(){
  const p3=DATA[PF3_KEY];
  if(!p3)return;
  let changed=false;
  if(!p3.ttlMig){p3.title=p3.title||'Portfolio (Dima)';p3.ttlMig='1';changed=true;}
  const AK='Portfolio (Anna)';
  if(!DATA[AK]){
    const d=DATA[AK]={headers:p3.headers.slice(),rows:[],count:0,v3:'1',custom:'1',port:'1',subtitle:AK,cashFree:4251};
    const SEED=[
      // [тикер, название, сектор, валюта, флаг, кол-во, покупка, тип]
      ['MU','Micron Technology','Полупроводники','USD','🇺🇸',1,672.38,'Акция'],
      ['NVDA','NVIDIA','ИИ / Чипы','USD','🇺🇸',2,206.50,'Акция'],
      ['AVGO','Broadcom','Полупроводники','USD','🇺🇸',1,398.26,'Акция'],
      ['O','Realty Income REIT','Недвижимость / REIT','USD','🇺🇸',6,66.07,'Дивидендная'],
      ['MCHP','Microchip Technology','Полупроводники','USD','🇺🇸',2,98.92,'Акция'],
      ['AZN','AstraZeneca','Фармацевтика','SEK','🇸🇪',1,1650.00,'Акция'],
      ['0P00005U1J.ST','Avanza Zero','Индексный фонд (Швеция)','SEK','🇸🇪',1.956,511.25,'Фонд'],
    ];
    SEED.forEach(([tk,name,sec,ccy,flag,qty,buy,typ])=>{
      const row=new Array(d.headers.length).fill('');
      row[0]=d.rows.length+1;row[1]=name;row[2]=tk;row[3]=flag;row[4]=sec;row[5]=typ;
      row[6]=qty;row[7]=0;row[8]=ccy;row[9]=buy;row[10]=0;row[11]=0;row[12]=0;row[13]=0;row[14]='—';row[15]='—';
      d.rows.push(row);
    });
    d.count=d.rows.length;changed=true;
  }
  // «Portfolio (Sergei)» — третий полноценный портфель (port:'1'), позиции со
  // скрина US-брокера 2026-06-14, все суммы в USD. Кол-во выведено из Cost Basis
  // ÷ Avg Price; кэш ≈ 26.7K USD пересчитан в SEK (база дашборда).
  const SK='Portfolio (Sergei)';
  if(!DATA[SK]){
    const d=DATA[SK]={headers:p3.headers.slice(),rows:[],count:0,v3:'1',custom:'1',port:'1',subtitle:SK,baseCcy:'USD',cashFree:26747};
    const SEED=[
      // [тикер, название, сектор, валюта, флаг, кол-во, ср. цена покупки (avg), тип]
      ['NVO','Novo Nordisk','Фармацевтика','USD','🇺🇸',11,65.69,'Акция'],
      ['NVDA','NVIDIA','ИИ / Чипы','USD','🇺🇸',52,169.05,'Акция'],
      ['MSFT','Microsoft','Технологии / ПО','USD','🇺🇸',13,385.47,'Акция'],
      ['META','Meta Platforms','Технологии / Соцсети','USD','🇺🇸',7,589.44,'Акция'],
      ['MA','Mastercard','Финансы / Платежи','USD','🇺🇸',4,488.12,'Акция'],
      ['GOOGL','Alphabet','Технологии / Интернет','USD','🇺🇸',13,153.63,'Акция'],
      ['AVGO','Broadcom','Полупроводники','USD','🇺🇸',10,391.80,'Акция'],
      ['AMZN','Amazon','Технологии / E-commerce','USD','🇺🇸',9,214.88,'Акция'],
    ];
    SEED.forEach(([tk,name,sec,ccy,flag,qty,buy,typ])=>{
      const row=new Array(d.headers.length).fill('');
      row[0]=d.rows.length+1;row[1]=name;row[2]=tk;row[3]=flag;row[4]=sec;row[5]=typ;
      row[6]=qty;row[7]=0;row[8]=ccy;row[9]=buy;row[10]=0;row[11]=0;row[12]=0;row[13]=0;row[14]='—';row[15]='—';
      d.rows.push(row);
    });
    d.count=d.rows.length;changed=true;
  }
  // Миграция уже созданного Sergei: база USD + кэш в USD (а не пересчёт в кроны).
  const sk=DATA[SK];
  if(sk&&sk.baseCcy!=='USD'){sk.baseCcy='USD';sk.cashFree=26747;delete sk.leverage;changed=true;}
  // Плечо — только у Dima; у семейных портфелей убираем.
  [AK,SK].forEach(k=>{if(DATA[k]&&DATA[k].leverage!=null){delete DATA[k].leverage;changed=true;}});
  if(changed&&!applyingRemote)scheduleSave();
}
// Восстановление выбора доп. колонок из localStorage, если облачная копия
// вкладки пришла без него (затёрта старым клиентом и т.п.).
function restoreXcols(){
  let n=0;
  try{
    const m=JSON.parse(localStorage.getItem('dash_xcols')||'{}');
    Object.keys(m).forEach(k=>{
      const d=DATA[k];
      if(d&&(!Array.isArray(d.xcols)||!d.xcols.length)&&Array.isArray(m[k])&&m[k].length){d.xcols=m[k].slice();n++;}
    });
  }catch(e){}
  if(n&&!applyingRemote)scheduleSave();
}
// ===== Свои вкладки-watchlist'ы (админ) =====
function pf3NewTab(){
  const name=(prompt(RT('Название новой вкладки:','New tab name:'))||'').trim();
  if(!name)return;
  if(DATA[name]||name===HOME_KEY||name===DUP_KEY||name===AIP_KEY||name===STK_KEY||name===AIDASH_KEY){toast(RT('Такая вкладка уже есть','A tab with this name exists'),true);return}
  DATA[name]={headers:DATA[PF3_KEY].headers.slice(),rows:[],count:0,v3:'1',custom:'1',subtitle:name};
  scheduleSave();
  curIdx=name;v3Key=name;pf3Sel=null;pf3Tab='list';
  init();
  toast(RT('Вкладка создана — добавляйте акции формой внизу списка','Tab created — add stocks with the form below the list'));
}
function pf3TabDelete(name){
  if(!DATA[name]||DATA[name].custom!=='1')return;
  if(!confirm(RT(`Удалить вкладку «${name}» со всеми её акциями?`,`Delete tab “${name}” with all its stocks?`)))return;
  delete DATA[name];
  ensureGroups().forEach(g=>{g.tabs=g.tabs.filter(x=>x!==name)});
  if(curIdx===name)curIdx=PF3_KEY;
  if(v3Key===name)v3Key=PF3_KEY;
  scheduleSave();init();
  if(_grpEditorOpen)renderGroupsEditor();
}

// ===== Редактор групп вкладок (админ): группы + назначение вкладок =====
let _grpEditorOpen=false;
function toggleGroupsEditor(){
  const o=document.getElementById('grpOverlay');if(!o)return;
  _grpEditorOpen=o.classList.contains('hidden');
  o.classList.toggle('hidden',!_grpEditorOpen);
  if(_grpEditorOpen)renderGroupsEditor();
}
function renderGroupsEditor(){
  const card=document.getElementById('grpCard');if(!card)return;
  const groups=ensureGroups();
  const tabs=Object.keys(DATA).filter(k=>k!==PF3_KEY&&DATA[k]&&DATA[k].v3==='1');
  const groupOf=n=>{const i=groups.findIndex(g=>g.tabs.includes(n));return i};
  card.innerHTML=`<button class="faq-close" onclick="toggleGroupsEditor()">✕</button>
    <h2>🗂 ${RT('Группы вкладок','Tab groups')}</h2>
    <div class="faq-sub">${RT('Группы сворачиваются в навигации; вкладка может быть в одной группе или без группы','Groups collapse in the navigation; a tab belongs to one group or none')}</div>
    <div class="faq-sec" style="margin-top:14px"><h3>${RT('Группы','Groups')}</h3>
      ${groups.map((g,i)=>`<div class="ai-pref"><span>${g.name} <small style="color:var(--text3)">· ${g.tabs.length}</small></span>
        <button class="pf3-btn pf3-btn-sm" onclick="grpRename(${i})">✏️</button>
        <button class="pf3-del" onclick="grpDel(${i})" title="${RT('Удалить группу (вкладки останутся)','Delete group (tabs remain)')}">🗑</button></div>`).join('')}
      <button class="pf3-btn" style="margin-top:8px" onclick="grpAdd()">➕ ${RT('Новая группа','New group')}</button>
    </div>
    <div class="faq-sec"><h3>${RT('Вкладки','Tabs')}</h3>
      ${tabs.map(n=>`<div class="ai-pref"><span>${META[n]||''} ${n}${DATA[n].custom==='1'?' <small style="color:var(--text3)">· '+RT('своя','custom')+'</small>':''}</span>
        <select class="grp-sel" onchange="grpAssign('${n.replace(/'/g,"\\'")}',this.value)">
          <option value="-1">${RT('— без группы —','— no group —')}</option>
          ${groups.map((g,i)=>`<option value="${i}"${groupOf(n)===i?' selected':''}>${g.name}</option>`).join('')}
        </select>
        ${DATA[n].custom==='1'?`<button class="pf3-del" onclick="pf3TabDelete('${n.replace(/'/g,"\\'")}')" title="${RT('Удалить вкладку','Delete tab')}">🗑</button>`:''}
      </div>`).join('')}
    </div>`;
}
function grpAdd(){
  const name=(prompt(RT('Название группы (можно с флагом, например 🇺🇸 USA):','Group name (emoji ok, e.g. 🇺🇸 USA):'))||'').trim();
  if(!name)return;
  ensureGroups().push({name,tabs:[]});
  scheduleSave();renderGroupsEditor();init();
}
function grpRename(i){
  const g=ensureGroups()[i];if(!g)return;
  const name=(prompt(RT('Новое название группы:','New group name:'),g.name)||'').trim();
  if(!name)return;
  g.name=name;scheduleSave();renderGroupsEditor();init();
}
function grpDel(i){
  const g=ensureGroups()[i];if(!g)return;
  if(!confirm(RT(`Удалить группу «${g.name}»? Вкладки останутся без группы.`,`Delete group “${g.name}”? Tabs stay ungrouped.`)))return;
  ensureGroups().splice(i,1);scheduleSave();renderGroupsEditor();init();
}
function grpAssign(tab,gi){
  const groups=ensureGroups();
  groups.forEach(g=>{g.tabs=g.tabs.filter(x=>x!==tab)});
  gi=parseInt(gi,10);
  if(gi>=0&&groups[gi])groups[gi].tabs.push(tab);
  scheduleSave();renderGroupsEditor();init();
}

function renderAll(){
  document.querySelectorAll('.tab').forEach(t=>{t.className='tab'+(t.dataset.tab===curIdx?' active':'')});
  const st=document.getElementById('subTabs');st.innerHTML='';
  document.body.classList.toggle('v3',isV3());   // Портфель 3.0 restyles the whole site
  const pf3El=document.getElementById('pf3Area');
  if(isV3()){
    if(curIdx===DUP_KEY){   // 🔁 Дубли (админ): пересечения индексных вкладок, пересчёт по кнопке
      ['smaBanner','toolbarEl','statsBar','tableArea','rankingArea'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none'});
      document.getElementById('smaBanner').innerHTML='';
      pf3StopAutoRefresh();
      if(pf3El){pf3El.style.display='';pf3El.innerHTML=`<div class="pf3-wrap">${dupHTML()}</div>`;}
      return;
    }
    if(curIdx===STK_KEY){   // 🔬 AI-разборы (админ): история разборов акций из обучающей базы
      ['smaBanner','toolbarEl','statsBar','tableArea','rankingArea'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none'});
      document.getElementById('smaBanner').innerHTML='';
      pf3StopAutoRefresh();
      if(pf3El){pf3El.style.display='';pf3El.innerHTML=`<div class="pf3-wrap">${stkLogHTML()}</div>`;}
      return;
    }
    if(curIdx===HOME_KEY){   // virtual home dashboard — no sub-tabs, aggregates both v3 tabs
      ['smaBanner','toolbarEl','statsBar','tableArea','rankingArea'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none'});
      document.getElementById('smaBanner').innerHTML='';
      pf3StopAutoRefresh();
      if(pf3El){pf3El.style.display='';pf3El.innerHTML=`<div class="pf3-wrap">${homeHTML()}</div>`;}
      return;
    }
    if(curIdx===AIDASH_KEY){   // 📊 AI-Dashboard (админ): карточки от AI Proto
      ['smaBanner','toolbarEl','statsBar','tableArea','rankingArea'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none'});
      document.getElementById('smaBanner').innerHTML='';
      pf3StopAutoRefresh();
      if(pf3El){pf3El.style.display='';pf3El.innerHTML=`<div class="pf3-wrap">${aiDashHTML()}</div>`;}
      return;
    }
    if(curIdx===AIP_KEY)aipSyncTab();   // 🤖: материализовать позиции AI как вкладку
    if(v3Key!==curIdx){   // switched between Портфель 3.0 and Nasdaq 100 — rebind the v3 UI
      v3Key=curIdx;pf3Sel=null;pf3Tab='list';pf3TypeSel=null;pf3XMenuOpen=false;
      pf3Sort=pf3IsPort(curIdx)?{key:'val',dir:-1}:{key:'day',dir:-1};   // index default: top movers first
    }
    ['smaBanner','toolbarEl','statsBar','tableArea','rankingArea'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none'});
    document.getElementById('smaBanner').innerHTML='';
    const isPort=pf3MyPort(v3Key),isAip=v3Key===AIP_KEY;
    if(isAip&&!['list','sec','typ','div','health','aim'].includes(pf3Tab))pf3Tab='list';
    else if(!isPort&&!isAip&&!['list','cal','sec','typ','sim','ai'].includes(pf3Tab))pf3Tab='list';
    if(!isAdmin()&&(pf3Tab==='ai'||pf3Tab==='prop'))pf3Tab='list';   // AI-вкладки — только админу
    (isAip
      ?[[T('📊 Портфель'),'list'],[T('🏭 Сектора'),'sec'],[T('🏷 Тип'),'typ'],['🧭 '+RT('Диверсификация','Diversification'),'div'],[T('🩺 Состояние портфеля'),'health'],['🤖 '+RT('Управление AI','AI controls'),'aim']]
      :isPort
      ?[[T('📊 Портфель'),'list'],[T('🏭 Сектора'),'sec'],[T('🏷 Тип'),'typ'],['🧭 '+RT('Диверсификация','Diversification'),'div'],[T('🧪 Симуляция'),'sim'],[T('📅 Дивиденды и отчёты'),'cal'],[T('🩺 Состояние портфеля'),'health'],['🤖 AI Proto','ai'],[T('⚖️ Предложение'),'prop']]
      :[[T('📊 Акции'),'list'],[T('🏭 Сектора'),'sec'],[T('🏷 Тип'),'typ'],[T('🧪 Симуляция'),'sim'],['🤖 AI Proto','ai'],[T('📅 Дивиденды и отчёты'),'cal']]
    ).filter(([,k])=>isAdmin()||(k!=='ai'&&k!=='prop')).forEach(([l,k])=>{const b=document.createElement('div');b.className='sub-tab'+(pf3Tab===k?' active':'');b.textContent=l;b.onclick=()=>{pf3Tab=k;renderAll()};st.appendChild(b)});
    if(pf3El)pf3El.style.display='';
    renderPF3();
    pf3EnsureAutoRefresh();
    return;
  }
  pf3StopAutoRefresh();
  if(pf3El)pf3El.style.display='none';
  // Classic index tabs (OMXS30, S&P 500, …): table + ranking sub-tabs.
  const subs=[['📊 Таблица','table'],['🏆 Рейтинг','ranking']];
  subs.forEach(([l,k])=>{if(k==='ranking'&&!(RANK[curIdx]?.length))return;const b=document.createElement('div');b.className='sub-tab'+(curSub===k?' active':'');b.textContent=l;b.onclick=()=>{curSub=k;renderAll()};st.appendChild(b)});
  const smB=document.getElementById('smaBanner');smB.innerHTML='';smB.style.display='';renderSMA();
  document.getElementById('tableArea').style.display=curSub==='table'?'':'none';
  document.getElementById('rankingArea').style.display=curSub==='ranking'?'':'none';
  document.getElementById('toolbarEl').style.display=curSub==='table'?'':'none';
  document.getElementById('statsBar').style.display=curSub==='table'?'':'none';
  if(curSub==='table')renderTable();
  else if(curSub==='ranking')renderRanking();
}

function renderSMA(){const b=document.getElementById('smaBanner');const s=SMA_IDX[curIdx];if(!s)return;const mk=(l,v,ab)=>{const d=document.createElement('div');d.className='sma-card';d.innerHTML=`<div><div class="sma-label">${l}</div><div class="sma-val ${ab?'sma-above':'sma-below'}">${typeof v==='number'?v.toLocaleString():v}</div></div>`;return d};b.appendChild(mk('Индекс',s.price,true));b.appendChild(mk('SMA 50',s.sma50,s.price>s.sma50));b.appendChild(mk('SMA 100',s.sma100,s.price>s.sma100));b.appendChild(mk('SMA 200',s.sma200,s.price>s.sma200));const sig=document.createElement('div');sig.className='sma-signal '+(s.signal.includes('Strong')?'sig-sbuy':s.signal.includes('Sell')?'sig-sell':'sig-buy');sig.textContent=s.signal;b.appendChild(sig)}

function renderTable(){
  const d=DATA[curIdx],h=d.headers,ord=getOrd(),rows=getFiltered();
  document.getElementById('indexInfo').textContent=d.subtitle||curIdx;
  renderStats(rows,h);updateDelBtn();
  const priceC=h.findIndex(x=>/^цена/i.test(x)),s50=h.findIndex(x=>/sma.?50/i.test(x)),s100=h.findIndex(x=>/sma.?100/i.test(x)),s200=h.findIndex(x=>/sma.?200/i.test(x)),tfC=h.indexOf(SMA_TF_COL),supC=h.indexOf('Поддержка'),resC=h.indexOf('Сопротивление');
  const thead=document.getElementById('thead');thead.innerHTML='';const tr=document.createElement('tr');
  const thD=document.createElement('th');thD.style.width='28px';tr.appendChild(thD);
  ord.forEach((ci,vi)=>{if((hiddenCols[curIdx]||[]).includes(ci))return;const th=document.createElement('th');th.textContent=h[ci];th.draggable=true;th.dataset.vi=vi;if(ci===sortCol)th.className=sortDir===1?'sorted-asc':'sorted-desc';th.onclick=()=>toggleSort(ci);th.addEventListener('dragstart',()=>{dragSrc=vi;th.classList.add('dragging')});th.addEventListener('dragend',()=>{th.classList.remove('dragging');document.querySelectorAll('thead th').forEach(t=>t.classList.remove('drag-over'))});th.addEventListener('dragover',e=>{e.preventDefault();th.classList.add('drag-over')});th.addEventListener('dragleave',()=>th.classList.remove('drag-over'));th.addEventListener('drop',e=>{e.preventDefault();th.classList.remove('drag-over');const tgt=parseInt(th.dataset.vi);if(dragSrc!==tgt){const o=getOrd();const it=o.splice(dragSrc,1)[0];o.splice(tgt,0,it);renderAll();scheduleSave()}});tr.appendChild(th)});
  thead.appendChild(tr);
  const tbody=document.getElementById('tbody');tbody.innerHTML='';
  rows.forEach(row=>{const oi=row._idx,tr=document.createElement('tr');if(selected.has(oi))tr.className='selected';const tdD=document.createElement('td');tdD.style.cssText='padding:3px;text-align:center';const isPlanned=parseInt(row.data[6])===0;if(isPlanned){tr.style.background='rgba(234,179,8,0.06)';tr.style.borderLeft='3px solid var(--gold)'}const btn=document.createElement('button');btn.className='del-btn';btn.textContent='✕';btn.onclick=e=>{e.stopPropagation();if(selected.has(oi))selected.delete(oi);else selected.add(oi);updateDelBtn();tr.className=selected.has(oi)?'selected':''};tdD.appendChild(btn);tr.appendChild(tdD);const price=priceC>=0?parseFloat(row.data[priceC]):0;
  ord.forEach(ci=>{if((hiddenCols[curIdx]||[]).includes(ci))return;const val=row.data[ci],td=document.createElement('td');
  if(ci===tfC){td.style.textAlign='center';const tk=String(row.data[2]||'');const mode=(SMA_TF[tk]&&SMA_TF[tk].mode)||'1Y';const mk=(m,l)=>`<button class="tf-btn${mode===m?' tf-on':''}" onclick="setSmaTF(${oi},'${m}')">${l}</button>`;td.innerHTML=`<span class="tf-wrap">${mk('1Y','1Г')}${mk('3Y','3Г')}</span>`;tr.appendChild(td);return}
  if((ci===1||(h[ci]||'').toLowerCase().includes('компани'))&&isAnalysis()&&String(row.data[2]||'').trim()){td.className='c-company';td.style.cursor='pointer';td.title='Открыть график';td.innerHTML=`<span style="text-decoration:underline dotted">${val??''}</span> 📈`;td.onclick=()=>openStockChart(String(row.data[2]));tr.appendChild(td);return}
  td.contentEditable='true';td.spellcheck=false;const hdr=(h[ci]||'').toLowerCase();const isSec=hdr.includes('сектор')||hdr.includes('отрасль');const isSma=(ci===s50||ci===s100||ci===s200);const isLevel=isSma||ci===supC||ci===resC;
  if(isSec){const[bg,fg]=getSC(String(val));td.innerHTML=`<span class="sec-tag" style="background:${bg};color:${fg}">${val||''}</span>`}
  else if(isLevel&&price>0){const lv=parseFloat(val);if(!isNaN(lv)&&lv>0){const pct=(price-lv)/price*100;const ord=(ci===resC)?'X':(ci===supC)?'Y':(pct>=0?'X':'Y');const col=lvlPctColor(Math.abs(pct),ord);const vTxt=isSma?lv.toFixed(0):lv;td.innerHTML=`${vTxt} <span class="lvl-pct" style="color:${col}">(${pct>=0?'+':'−'}${Math.abs(pct).toFixed(1)}%)</span>`;if(isSma)td.className=price>lv?'c-sma-above':'c-sma-below'}else td.textContent=val??''}
  else{const isNum=typeof val==='number';if(hdr.includes('прибыль')||hdr.includes('стоимость')||hdr.includes('белайн')){td.textContent=isNum?Math.round(val).toLocaleString():(val??'');if(hdr.includes('прибыль')){const n=parseFloat(val);td.className=n>0?'c-pos':n<0?'c-neg':''}}else if(hdr.includes('курс')){td.textContent=isNum?val.toFixed(4):(val??'');td.style.fontFamily='"JetBrains Mono",monospace';td.style.fontSize='10px';td.style.color='var(--text2)'}else{td.textContent=val===null||val===undefined?'':val;if(ci<=1||hdr.includes('компани'))td.className='c-company';else if(ci===2||hdr.includes('тикер'))td.className='c-ticker';else if(hdr.includes('коммент'))td.className='c-comment';else if((hdr.includes('sma')||hdr.includes('позиц'))&&!isSma){const v=String(val);td.className=v.includes('🟢')?'c-sma-g':v.includes('🔴')?'c-sma-r':'c-sma-y'}else if(hdr.includes('потенц')||hdr.includes('от покупки')){const n=parseFloat(String(val));if(!isNaN(n))td.className=n>0?'c-pos':n<0?'c-neg':'c-neut'}else if(hdr.includes('1д')||hdr.includes('день')){const n=parseFloat(String(val));if(!isNaN(n))td.className=n>0?'c-pos':n<0?'c-neg':'c-neut'}else if(hdr.includes('див')){const n=parseFloat(String(val));if(!isNaN(n)&&n>=5)td.className='c-div-hi';else if(!isNaN(n)&&n>=3)td.className='c-div-mid'}else if(hdr.includes('валюта')){td.style.fontWeight='600';td.style.color='var(--accent)'}else if(hdr.includes('целевая')||hdr.includes('цель')){td.style.color='var(--gold)';td.style.fontWeight='600';if(hdr.includes('kr')){const n=parseFloat(String(val));if(!isNaN(n))td.textContent=Math.round(n).toLocaleString()}}}}
  td.addEventListener('blur',()=>{const nv=td.textContent.replace(/\s/g,'').replace(/,/g,'');const num=parseFloat(nv);const keep=hdr.includes('валют')||hdr.includes('стран')||hdr.includes('сектор')||hdr.includes('компани')||hdr.includes('тикер')||nv.includes('⭐')||nv.includes('🟢')||nv.includes('🔴');d.rows[oi][ci]=keep?nv:(!isNaN(num)?num:nv);renderStats(getFiltered(),h);scheduleSave()});tr.appendChild(td)});
  tbody.appendChild(tr)})}

function getFiltered(){const d=DATA[curIdx];let rows=d.rows.map((r,i)=>({data:r,_idx:i}));if(searchTerm){const s=searchTerm.toLowerCase();rows=rows.filter(r=>r.data.some(v=>String(v).toLowerCase().includes(s)))}if(sortCol>=0&&sortDir>0)rows.sort((a,b)=>{let va=a.data[sortCol],vb=b.data[sortCol];const na=parseFloat(va),nb=parseFloat(vb);if(!isNaN(na)&&!isNaN(nb))return sortDir===1?na-nb:nb-na;return sortDir===1?String(va||'').localeCompare(String(vb||'')):String(vb||'').localeCompare(String(va||''))});return rows}
function toggleSort(c){if(sortCol===c){sortDir=(sortDir+1)%3;if(!sortDir)sortCol=-1}else{sortCol=c;sortDir=1}renderAll()}
function resetSort(){sortCol=-1;sortDir=0;searchTerm='';document.getElementById('searchBox').value='';selected.clear();colOrders[curIdx]=null;hiddenCols[curIdx]=[];scheduleSave();renderAll()}
function updateDelBtn(){const b=document.getElementById('delBtn');b.style.display=selected.size?'':'none';b.textContent=`🗑 (${selected.size})`}
function deleteSelected(){if(!selected.size||!confirm(`Удалить ${selected.size}?`))return;const d=DATA[curIdx];[...selected].sort((a,b)=>b-a).forEach(i=>d.rows.splice(i,1));d.count=d.rows.length;selected.clear();colOrders[curIdx]=null;scheduleSave();document.querySelectorAll('.tab').forEach((t,i)=>{const n=Object.keys(DATA)[i];if(n===curIdx)t.innerHTML=`${META[n]||''} ${n}<span class="cnt">${d.count}</span>`});renderAll()}
function renderStats(rows,h){const bar=document.getElementById('statsBar');bar.innerHTML='';const fc=kw=>h.findIndex(x=>kw.some(k=>x.toLowerCase().includes(k)));const nv=col=>rows.map(r=>parseFloat(r.data[col])).filter(n=>!isNaN(n));const pC=fc(['потенц']),dC=fc(['див','дивид']),yC=fc(['1д','день']);const st=[{l:'Компаний',v:rows.length,c:'sv-blue'}];if(pC>=0){const v=nv(pC);if(v.length)st.push({l:'Ср. потенциал',v:'+'+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1)+'%',c:'sv-green'})}if(dC>=0){const v=nv(dC);if(v.length)st.push({l:'Ср. дивиденд',v:(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1)+'%',c:'sv-gold'})}if(pC>=0){const v=nv(pC);st.push({l:'Strong Buy',v:v.filter(x=>x>10).length,c:'sv-green'})}const s2=fc(['sma 200','sma200']),pc=fc(['цена','price']);if(s2>=0&&pc>=0){let ab=0,tot=0;rows.forEach(r=>{const p=parseFloat(r.data[pc]),sv=parseFloat(r.data[s2]);if(!isNaN(p)&&!isNaN(sv)&&sv>0){tot++;if(p>sv)ab++}});if(tot)st.push({l:'>SMA200',v:`${ab}/${tot}`,c:ab/tot>.6?'sv-green':'sv-red'})}st.forEach(s=>{const c=document.createElement('div');c.className='stat-card';c.innerHTML=`<div class="stat-label">${s.l}</div><div class="stat-value ${s.c}">${s.v}</div>`;bar.appendChild(c)})}
function renderRanking(){const a=document.getElementById('rankingArea');a.innerHTML='';const sec=RANK[curIdx]||[];if(!sec.length){a.innerHTML='<p style="padding:24px;color:var(--text2)">Нет данных</p>';return}sec.forEach(s=>{const d=document.createElement('div');d.className='ranking-section';const t=document.createElement('div');t.className='ranking-title';const tt=s.title;if(tt.includes('✅')||tt.includes('ПРИБЫЛ')||tt.includes('ПОТЕНЦИАЛ'))t.className+=' rt-green';else if(tt.includes('🔴')||tt.includes('УБЫТ'))t.className+=' rt-red';else if(tt.includes('💰'))t.className+=' rt-blue';else t.className+=' rt-purple';t.textContent=tt;d.appendChild(t);const tb=document.createElement('table');tb.className='ranking-table';if(s.headers?.length){const th=document.createElement('thead');const tr=document.createElement('tr');s.headers.forEach(h=>{const c=document.createElement('th');c.textContent=h;tr.appendChild(c)});th.appendChild(tr);tb.appendChild(th)}const bd=document.createElement('tbody');s.rows.forEach(r=>{const tr=document.createElement('tr');r.forEach((v,ci)=>{const td=document.createElement('td');td.textContent=v||'';td.contentEditable='true';td.spellcheck=false;if(ci===1)td.style.fontWeight='600';if(ci>=2){const vv=String(v);if(vv.includes('+'))td.style.color='var(--green-t)';else if(vv.includes('-'))td.style.color='var(--red-t)';if(ci<=3)td.style.fontWeight='600'}tr.appendChild(td)});bd.appendChild(tr)});tb.appendChild(bd);d.appendChild(tb);a.appendChild(d)})}
function exportCSV(){const d=DATA[curIdx],ord=getOrd();const hdr=ord.map(i=>d.headers[i]);const rows=[hdr,...d.rows.map(r=>ord.map(i=>r[i]))];const csv=rows.map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=curIdx.replace(/\s/g,'_')+'_data.csv';a.click()}
// Debounced: re-render only the table (with its stats), not the whole app, and not on every keystroke.
let searchTimer=null;
document.getElementById('searchBox').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{searchTerm=e.target.value;renderTable()},150)});

/* ===== Theme (light/dark) ===== */
function applyTheme(t){
  document.documentElement.dataset.theme = (t === 'dark' ? 'dark' : 'light');
  try{ localStorage.setItem('dash_theme', document.documentElement.dataset.theme); }catch(e){}
  const b = document.getElementById('themeToggle');
  if(b) b.textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
  scheduleSave();
}
// FAQ (❓ in the header): legend for every badge / value used on the site.
// Reuses the live badge classes (pf3-typ / pf3-crit / pf3-sig) so the modal
// always looks exactly like the lists.
function faqHTML(){
  const row=(k,v)=>`<div class="faq-row"><span class="faq-k">${k}</span><span class="faq-v">${v}</span></div>`;
  const typ=(t,v)=>row(`<span class="pf3-typ ${PF3_TYPE_META[t][1]}">${PF3_TYPE_META[t][0]} ${t}</span>`,v);
  const crit=(cls,ico,l,v)=>row(`<span class="pf3-crit ${cls}">${ico} ${l}</span>`,v);
  const sec=(title,body,open)=>`<details class="faq-sec"${open?' open':''}><summary>${title}</summary><div class="faq-body">${body}</div></details>`;
  return`<button class="faq-close" onclick="toggleFaq()">✕</button>
  <h2>${T('❓ Справка')}</h2>
  <div class="faq-sub">${T('Нажмите на раздел, чтобы развернуть его')}</div>

  ${sec(T('🗂 Вкладки и виды'),
    row('<b>✨ Новый интерфейс</b>','Кнопка ✨ в шапке переключает сайт на интерфейс 2026 года: навигация-сайдбар слева, «стеклянные» панели, плавные переходы. ↩ возвращает классический вид; выбор запоминается на устройстве.')
   +row('<b>🏠 Home</b>','Сводный дашборд по всем акциям: кого покупать/продавать прямо сейчас (цена в ±2% от уровня), кто подходит к уровню покупки (≤5%), падающие ножи, движения дня и статистика рыночных фаз. Клик по строке открывает карточку.')
   +row('<b>📊 Портфель / Акции</b>','Главный список: клик по строке открывает карточку акции слева (график, здоровье бизнеса, уровни, отчёты). Колонки сортируются кликом по заголовку.')
   +row('<b>🏭 Сектора · 🏷 Тип</b>','Те же акции, сгруппированные по категориям: слева список групп с итогами, справа акции выбранной группы. Сектора Nasdaq укрупнены до 12 макро-групп.')
   +row('<b>🧪 Симуляция</b>','Бумажный портфель из тестовых покупок — без реальных денег. Подробнее в разделе «Симуляция» ниже.')
   +row('<b>📅 Дивиденды и отчёты</b>','Календарь: ближайшие отчёты компаний, экс-дивидендные даты и выплаты.')
   +row('<b>🩺 Состояние · 🤖 AI · ⚖️ Предложение</b>','Только на Портфеле 3.0: здоровье портфеля, AI-аналитика с историей запусков и план ребалансировки. В AI Proto есть чат: задавайте вопросы по портфелю, а свои правила («никогда не предлагай плечо») ассистент запоминает в 🧠 память и учитывает во всех анализах.'),true)}

  ${sec(T('🏷 Тип акции'),
    typ('Защитная','Стабильный спрос вне зависимости от экономического цикла: фарма, потребительские товары, коммунальные услуги, телеком. Меньше падает в кризис, медленнее растёт на бычьем рынке.')
   +typ('Качественная','Сильный баланс, высокая рентабельность, устойчивое конкурентное преимущество (Apple, Microsoft, ASML). Костяк долгосрочного портфеля.')
   +typ('Циклическая','Результаты сильно зависят от фазы экономики и отраслевого цикла: полупроводниковое оборудование, память, авто, промышленность, энергетика.')
   +typ('Дивидендная','Главная ценность — стабильные выплаты: REIT (Realty Income), Cisco, Kraft Heinz. Покупается ради денежного потока.')
   +typ('Рост','Быстрорастущая выручка, прибыль реинвестируется: ИИ, облако, кибербезопасность. Выше потенциал — выше волатильность.')
   +typ('Стоимость','Торгуется дёшево относительно прибыли/активов, часто в ожидании разворота (PayPal, Warner Bros). Ставка на переоценку рынком.')
   +typ('Спекулятивная','Венчурная ставка на публичном рынке: компания убыточна (ROE < 0), оценка держится на ожиданиях (P/S > 12–20, P/E отсутствует), выживание зависит от привлечения капитала. Квантовые вычисления, ранний биотех. Не путать с настоящим ростом вроде CrowdStrike.')
   +typ('ETF','Биржевой фонд — корзина бумаг одним инструментом. Определяется автоматически при добавлении.')
   +row('<b>🧮</b>',RT('Тип считается скорингом по live-метрикам в духе методологий MSCI/S&P: beta и сектор (защитная/циклическая), ROE и D/E (качественная), дивдоходность и payout (дивидендная), рост выручки (рост), P/E к среднему сектора (стоимость). Пограничные получают вторичную метку в карточке — как Microsoft: «Качественная · Рост». Пока метрики не загрузились, действует классификация по сектору.','The type is scored from live metrics in the spirit of MSCI/S&P methodologies: beta & sector (defensive/cyclical), ROE & D/E (quality), yield & payout (dividend), revenue growth (growth), P/E vs sector average (value). Borderline names get a secondary label on the card — like Microsoft: “Quality · Growth”. Until metrics load, the sector-based fallback applies.')))}

  ${sec(T('📊 Критерий — рыночная фаза (техника + фундаментал)'),
    crit('knife','🔪','Падающий нож','Цена ниже всех SMA и дневное падение ≤ −3%, либо пробита поддержка. Ловить не стоит — ждать стабилизации.')
   +crit('down','📉','Даунтренд','Цена ниже SMA 50, 100 и 200 — нисходящий тренд на всех горизонтах.')
   +crit('corr','⚠️','Коррекция','Откат ниже SMA 50 при цене выше SMA 200 — долгосрочный тренд цел, краткосрочная слабость.')
   +crit('flat','⚖️','Боковик','Цена между уровнями без выраженного тренда, или недостаточно данных.')
   +crit('rev','🔄','Разворот','Цена вернулась выше SMA 50, но ещё ниже SMA 200 — возможное начало восстановления.')
   +crit('undr','💎','Недооценка','Потенциал до консенсус-таргета аналитиков ≥ +25% (и бумага не в свободном падении).')
   +crit('up','📈','Аптренд','Цена выше всех SMA 50/100/200 — восходящий тренд подтверждён.')
   +crit('imp','🚀','Импульс','Сильное дневное движение вверх: ≥ +2.5% при цене выше SMA 50 (или ≥ +4%).')
   +crit('heat','🌡','Перегрев','Цена выше таргета аналитиков (+5%) или ≥ +30% над SMA 200 — риск отката, фиксация части позиции разумна.'))}

  ${sec(T('🎯 Сигнал — цена у технического уровня (±2%)'),
    row('<span class="pf3-sig pf3-sig-buy">🟢 Докупка · SMA 50 +1.2%</span>','Цена в пределах ±2% от уровня покупки (SMA 50/100/200 или поддержка). «Покупка» — если позиции ещё нет.')
   +row('<span class="pf3-sig pf3-sig-sell">🔴 Продажа · Сопр. −0.8%</span>','Цена в пределах ±2% от сопротивления — зона фиксации прибыли.')
   +row('<span class="pf3-sig pf3-sig-wait">⏳ SMA 100 −5.4%</span>','Уровней рядом нет; показан ближайший уровень покупки снизу и сколько до него.')
   +row('<span class="pf3-sig pf3-sig-warn">🔻 ниже уровней</span>','Цена опустилась ниже всех уровней покупки.'))}

  ${sec(T('🧪 Симуляция — тестовые покупки'),
    row('<b>Как купить</b>','Откройте карточку акции → секция «🧪 Симуляция» внизу → укажите количество и цену (предзаполнена текущей) → «Купить (тест)». Реальный портфель не затрагивается.')
   +row('<b>Где следить</b>','В карточке акции — позиции по этой бумаге; в саб-вкладке «🧪 Симуляция» — весь тестовый портфель: вложено, стоимость сейчас и результат в kr по живым ценам и курсу.')
   +row('<b>Закрыть позицию</b>','Кнопка 🗑 в карточке или в таблице симуляции. Клик по строке таблицы открывает карточку акции.')
   +row('<b>Свой портфель у каждой вкладки</b>','Тестовые покупки хранятся на той вкладке, где сделаны: Портфель 3.0 → Симуляция и Nasdaq 100 → Симуляция независимы. Синхронизируются между устройствами.'))}

  ${sec(T('📐 Технические уровни и колонки'),
    row('<b>SMA 50/100/200</b>','Скользящие средние по дневным свечам (~2.5/5/10 месяцев). В режиме «3 года» — недельные (~1/2/4 года). Обновляются автоматически.')
   +row('<b>Поддержка / Сопротивление</b>','Минимум и максимум цены за последние ~3 месяца торгов.')
   +row('<b>Аналит. таргет</b>','Средняя целевая цена аналитиков в валюте торгов: основной — консенсус FMP за всё время (для EU/Nordic — фолбэк Yahoo/Refinitiv), под ним «Таргет 3м» — свежий срез за последний квартал/месяц, чтобы старые таргеты не искажали среднее. Рядом — потенциал в % к цене и число аналитиков.')
   +row('<b>1д %</b>','Изменение цены к закрытию предыдущей сессии.')
   +row('<b>Доля</b>','Вес позиции в общей стоимости акций портфеля.'))}

  ${sec(T('💼 Портфельные значения'),
    row('<b>Покупка</b>','Средняя цена входа в валюте бумаги (из брокерского отчёта).')
   +row('<b>Стоимость</b>','Текущая стоимость позиции в кронах по живому курсу (kr); под ней — прибыль/убыток в % к вложенному.')
   +row('<b>Чистый капитал</b>','Стоимость всех акций + свободный кэш.')
   +row('<b>Кредитное плечо</b>','Доступный кредит брокера сверх собственного капитала; «Доступно с плечом» = свободные + плечо.'))}

  ${sec(T('💪 Здоровье бизнеса (карточка акции)'),
    row('<b>Оценка 0–10</b>','Баланс (долг/капитал, ликвидность), денежный поток (FCF) и рост выручки (CAGR и год-к-году); итог — среднее. Переключатель: «Годовой отчёт» — последний фискальный год, «Послед. квартал» — свежий квартал + TTM.')
   +row('🔴 Критично · 🟠 Слабо · 🟡 Средне · 🟢 Хорошо · 🏆 Отлично','Градация итоговой оценки: &lt;2.5 · 2.5–4.5 · 4.5–6.5 · 6.5–8.5 · ≥8.5.'))}

  ${isAdmin()?sec(T('🔬 AI-анализ акции'),
    row('<b>🟢 Добавлять · 🟡 Наблюдать · 🔴 Не добавлять</b>','Итоговый вердикт Claude по бумаге с учётом вашего портфеля (перевес секторов, концентрация, свободный кэш): открывать/докупать позицию сейчас, держать на радаре или воздержаться. В отличие от «Рекомендации» в карточке (детерминированный скоринг сайта) — это качественный вывод модели по технике, фундаменталу и свежим новостям.')
   +row('<b>увер.</b> — уверенность: <b>low · medium · high</b>','Насколько сам Claude уверен в этом вердикте. <b>low</b> — данные противоречивы или их мало, высокая неопределённость; <b>medium</b> — аргументы за вердикт есть, но и риски заметны, картина неоднозначная; <b>high</b> — техника, фундаментал и новости сходятся, вывод твёрдый. Это самооценка модели, а не расчёт дашборда.')
   +row('<b>размер</b>','Рекомендуемый размер позиции: доля в % от капитала и примерная сумма в кронах от свободного кэша.')
   +row('<b>вход</b>','Ценовая зона для покупки (уровни входа) в валюте торгов бумаги.')
   +row('<b>цель</b>','Целевая цена Claude и потенциал роста к ней в %. Это собственная оценка модели — может отличаться от консенсус-таргета аналитиков.')
   +row('<b>горизонт</b>','Ожидаемый срок реализации идеи — недели или месяцы.')
   +row('<b>🤖 AI-анализ / обновить</b>','Запускает свежий разбор: Claude собирает цены, уровни, фундаментал и через веб-поиск — последние новости компании. Каждый разбор сохраняется в обучающую базу (вкладка 🔬 AI-разборы), и при следующем анализе модель сверяет прошлый прогноз с фактом.')):''}

  ${isAdmin()?sec(T('🔄 AI-Рекомендация'),
    row('<b>Что это</b>','Кнопка «🔄 AI-Рекомендация» в карточке: Claude взвешивает ВСЁ вместе — технику (SMA, уровни, фаза), фундаментал (ROE, рост, долг, FCF), оценку (P/E, мультипликаторы vs сектор и история), плюс через веб-поиск свежие новости компании и глобальную макрокартину (ставки, инфляция, геополитика, настроение по сектору) — и выдаёт единый вердикт.')
   +row('🟢 Купить · 🟡 Ждать · 🔴 Продать · ⛔ Избегать','Вердикт по тем же четырём значениям, что и скоринговая «Рекомендация», но с учётом новостей и мира. <b>buy</b> — техника и фундаментал за покупку, цена у входа; <b>wait</b> — смешанно или далеко от входа; <b>sell</b> — у сопротивления/выше таргета/перегрев/негатив; <b>avoid</b> — падающий нож или серьёзный риск.')
   +row('<b>увер. low/medium/high</b>','Самооценка уверенности модели в вердикте. Рядом — заголовок-суть, зона входа и ключевые риски; «Показать разбор» раскрывает полный текст с разделами Новости/Техника/Фундаментал.')
   +row('<b>Чем отличается от «Рекомендации»</b>','«Рекомендация» (выше в карточке) — мгновенный детерминированный скоринг сайта по технике+фундаменталу, считается всегда и бесплатно. «AI-Рекомендация» — отдельное поле: запускается вручную, учитывает живые новости и макро, стоит один AI-вызов на бумагу. Они не заменяют друг друга — смотрите оба.')):''}

  ${isAdmin()?sec(T('📐 Оценка — мультипликаторы (Valuation Check)'),
    row('<b>Кнопка «📐 Оценка»</b>','На 🏠 Home собирает мультипликаторы сразу по всему портфелю (Yahoo — живые значения, покрывает Nordic; FMP — историческая медиана). Результат — в карточке каждой акции и сводкой на Home. Finnhub /metric не используется (US-only).')
   +row('<b>P/E (TTM) · Forward P/E</b>','Цена / прибыль за 12 мес и по прогнозу на след. год. «n/a», если прибыль ≤ 0 — тогда смотрят на P/S.')
   +row('<b>P/S (TTM)</b>','Цена / выручка за 12 мес — работает и для убыточных компаний.')
   +row('<b>EV/EBITDA</b>','Стоимость бизнеса / EBITDA — нивелирует разницу в долге и амортизации. «n/a» при отрицательной EBITDA.')
   +row('<b>PEG</b>','Forward P/E ÷ ожидаемый рост EPS. PEG &lt; 1 — рост недооценён рынком. Неприменим при росте ≤ 0.')
   +row('<b>сектор</b>','Медиана мультипликатора по бумагам того же сектора в портфеле (медиана устойчивее к выбросам, чем среднее). Рядом — дисконт/премия в %: <span class="pf3-up">зелёное</span> = дешевле сектора, <span class="pf3-down">красное</span> = дороже.')
   +row('<b>история 5y</b>','Историческая медиана самой бумаги за 5 лет (FMP). Дисконт/премия показывает, дёшево или дорого относительно своей нормы. Для бумаг без покрытия FMP (часть Nordic) — «—».')
   +row('🟢 <b>Дёшево по обоим измерениям</b>','Бумага одновременно ниже медианы сектора <b>и</b> ниже собственной истории по ≥2 мультипликаторам. Сильнейший статистический сигнал недооценки — но это наблюдение, а не сигнал к покупке: низкие мультипликаторы часто бывают на пике цикла, когда прибыль временно завышена.')):''}`;
}
// ===== 📜 Промпты (админ): названия и тексты AI-промптов из worker'а =====
function togglePrompts(){
  const o=document.getElementById('prmOverlay');if(!o)return;
  const opening=o.classList.contains('hidden');
  o.classList.toggle('hidden',!opening);
  if(opening)renderPrompts();
}
async function renderPrompts(){
  const card=document.getElementById('prmCard');if(!card)return;
  card.innerHTML=`<button class="faq-close" onclick="togglePrompts()">✕</button><h2>📜 ${RT('AI-промпты','AI prompts')}</h2><div class="faq-sub">${RT('Загрузка…','Loading…')}</div>`;
  try{
    const r=await fetch(PRICE_PROXY+'?action=prompts',{headers:{'Authorization':'Bearer '+await sbToken()}});
    const list=await r.json();
    if(!Array.isArray(list))throw new Error(list&&list.error||'нет данных');
    card.innerHTML=`<button class="faq-close" onclick="togglePrompts()">✕</button>
      <h2>📜 ${RT('AI-промпты','AI prompts')}</h2>
      <div class="faq-sub">${RT('Системные промпты worker\'а — что именно получает и делает Claude в каждом режиме','The worker\'s system prompts — exactly what Claude receives and does in each mode')}</div>
      ${list.map(p=>`<details class="faq-sec"><summary>${p.name}</summary><div class="faq-body">
        <div class="prm-about">${p.about||''}</div>
        <pre class="prm-pre">${String(p.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>
      </div></details>`).join('')}`;
  }catch(e){
    card.innerHTML=`<button class="faq-close" onclick="togglePrompts()">✕</button><h2>📜 ${RT('AI-промпты','AI prompts')}</h2>
      <div class="set-err">${RT('Не удалось загрузить промпты','Failed to load prompts')}: ${e.message||e}<br>${RT('Нужен редеплой worker (эндпоинт ?action=prompts)','Worker redeploy needed (?action=prompts endpoint)')}</div>`;
  }
}

// ===== Settings (⚙️, admin only): users, online status, per-tab access =====
function toggleSettings(){
  const o=document.getElementById('setOverlay');
  if(!o)return;
  if(!o.classList.contains('hidden')){o.classList.add('hidden');return;}
  o.classList.remove('hidden');
  document.getElementById('setCard').innerHTML='<button class="faq-close" onclick="toggleSettings()">✕</button><h2>⚙️ Настройки доступа</h2><div class="faq-sub">Загрузка…</div>';
  renderSettings();
}
async function renderSettings(){
  const card=document.getElementById('setCard');
  let users=[];
  try{
    const{data,error}=await sb.from('user_access').select('*').order('email');
    if(error)throw error;
    users=data||[];
  }catch(e){
    card.innerHTML=`<button class="faq-close" onclick="toggleSettings()">✕</button><h2>⚙️ Настройки доступа</h2>
      <div class="set-err">Не удалось загрузить пользователей: ${e.message||e}<br><br>
      Скорее всего, таблица доступа ещё не создана — выполните содержимое файла
      <code>supabase-access.sql</code> в Supabase → SQL Editor (один раз).</div>`;
    return;
  }
  const tabs=Object.keys(DATA);
  const ago=ts=>{const m=Math.round((Date.now()-Date.parse(ts))/60000);
    return m<3?'только что':m<60?`${m} мин назад`:m<1440?`${Math.round(m/60)} ч назад`:new Date(ts).toLocaleDateString('ru-RU')};
  const rows=users.map(u=>{
    const on=u.last_seen&&(Date.now()-Date.parse(u.last_seen))<150000;   // heartbeat раз в минуту → онлайн = < 2.5 мин
    const seen=on?'<span class="set-on">🟢 онлайн</span>':`<span class="set-off">⚪ ${u.last_seen?ago(u.last_seen):'не заходил'}</span>`;
    const adm=u.role==='admin';
    const grants=adm?'<span class="set-all">полный доступ ко всем вкладкам</span>'
      :tabs.map(t=>`<label class="set-tab"><input type="checkbox"${(u.tabs||[]).includes(t)?' checked':''} onchange="setGrant('${u.user_id}','${t.replace(/'/g,"\\'")}',this.checked)"><span>${META[t]||''} ${t}</span></label>`).join('');
    return`<div class="set-user">
      <div class="set-user-hd"><b>${u.email||u.user_id}</b><span class="set-role${adm?' adm':''}">${adm?'Админ':'User'}</span>${seen}</div>
      <div class="set-tabs">${grants}</div>
    </div>`;
  }).join('');
  card.innerHTML=`<button class="faq-close" onclick="toggleSettings()">✕</button><h2>⚙️ Настройки доступа</h2>
    <div class="faq-sub">Доступ к вкладкам и активность · 🟢 = на сайте сейчас · <a href="#" onclick="renderSettings();return false">обновить</a></div>
    ${rows||'<div class="set-err">Других пользователей пока нет — они появятся здесь после первого входа.</div>'}
    <div class="set-note">Изменения доступа применяются у пользователя после обновления страницы. Каждый видит свою копию данных вкладки.</div>`;
}
// Toggle one tab for one user; reread → modify → write, чтобы не затереть параллельные правки.
async function setGrant(uid,tab,on){
  try{
    const{data,error}=await sb.from('user_access').select('tabs').eq('user_id',uid).single();
    if(error)throw error;
    let t=Array.isArray(data?.tabs)?data.tabs:[];
    t=on?[...new Set([...t,tab])]:t.filter(x=>x!==tab);
    const r=await sb.from('user_access').update({tabs:t}).eq('user_id',uid);
    if(r.error)throw r.error;
  }catch(e){ alert('Не удалось сохранить доступ: '+(e.message||e)); renderSettings(); }
}

function toggleFaq(){
  const o=document.getElementById('faqOverlay');
  if(!o)return;
  if(o.classList.contains('hidden')){document.getElementById('faqCard').innerHTML=faqHTML();o.classList.remove('hidden');}
  else o.classList.add('hidden');
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')['faqOverlay','setOverlay','grpOverlay','prmOverlay'].forEach(id=>document.getElementById(id)?.classList.add('hidden'))});

function toggleTheme(){
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}
function initTheme(){
  // Дефолт сайта: тёмная тема + новый интерфейс; сохранённый выбор важнее.
  applyTheme(localStorage.getItem('dash_theme') || document.documentElement.dataset.theme || 'dark');
  initUI2();
  initLang();
}

// ===== ✨ Новый интерфейс (2026): сайдбар-навигация, glass/bento-дизайн,
// плавные переходы (View Transitions API). Та же логика и данные — другая
// оболочка; переключается кнопкой в шапке, выбор хранится на устройстве.
let UI2=false;
function applyUI2(){
  document.documentElement.classList.toggle('ui2',UI2);   // на <html> — применяется до отрисовки body (без мигания)
  const b=document.getElementById('ui2Btn');
  if(b){b.textContent=UI2?'↩':'✨';b.title=UI2?'Вернуть классический интерфейс':'Новый интерфейс (2026)';}
}
function initUI2(){
  try{UI2=localStorage.getItem('dash_ui2')!=='0'}catch(e){UI2=true}   // дефолт: новый интерфейс включён
  applyUI2();
}
function toggleUI2(){
  const sw=()=>{
    UI2=!UI2;
    try{localStorage.setItem('dash_ui2',UI2?'1':'0')}catch(e){}
    applyUI2();
    renderAll();
  };
  // Smooth morph between the two shells where the browser supports it.
  if(document.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches)document.startViewTransition(sw);
  else sw();
}

/* ===== Live prices =====
   Preferred: a tiny price proxy (Cloudflare Worker — see price-proxy.js) that
   reads Yahoo Finance server-side, covering US + Nordic/EU (.ST/.OL/.DE/.CO).
   Paste your deployed Worker URL into PRICE_PROXY below.
   Fallback (PRICE_PROXY blank): Finnhub free tier — US tickers only. */
const PRICE_PROXY = 'https://telegram-notify-abc.dmitriy-bilokon.workers.dev';   // Worker serves live prices (US + Nordic/EU via Yahoo)

// Map a dashboard ticker + currency to a Yahoo/Finnhub exchange symbol.
// Overrides handle tickers whose dashboard form differs from the exchange symbol.
const SYMBOL_OVERRIDES = { 'NDB':'NDA-SE.ST', 'ASML':'ASML.AS', 'FCT':'FCT.MI', 'FIGMA':'FIG', 'RHM':'RHM.DE', 'RENK':'R3NK.DE', 'DELLIA':'DELIA.OL' };
function exSymbol(ticker, ccy){
  const t = String(ticker||'').trim().toUpperCase().replace(/\s+/g,'-');
  if(SYMBOL_OVERRIDES[t]) return SYMBOL_OVERRIDES[t];
  if(t.includes('.')) return t;   // уже полный символ биржи (CAC → .PA, MIB → .MI)
  switch(String(ccy||'').toUpperCase()){
    case 'USD': return t;
    case 'SEK': return t + '.ST';
    case 'NOK': return t + '.OL';
    case 'DKK': return t + '.CO';
    case 'EUR': return t + '.DE';
    default:    return t;
  }
}

// Lightweight toast (created on demand, themed via CSS vars).
function toast(msg, isErr){
  let t = document.getElementById('toast');
  if(!t){ t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._hide); t._hide = setTimeout(() => { t.className = 'toast'; }, 3400);
}

async function fetchFinnhub(symbol){
  const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(finnhubKey)}`);
  if(!r.ok) return null;
  const d = await r.json();
  return (d && typeof d.c === 'number' && d.c > 0) ? { price: d.c, pct: (typeof d.dp === 'number' ? d.dp : null) } : null;
}

// Ensure a column named `name` exists on tab `d`; append + pad rows if missing. Returns its index.
function ensurePFCol(d, name){
  let idx = d.headers.indexOf(name);
  if(idx === -1){
    d.headers.push(name); idx = d.headers.length - 1;
    d.rows.forEach(r => { while(r.length < d.headers.length) r.push(''); });
  }
  return idx;
}
// Data indices of the SMA 50/100/200 columns on tab `d` (regex on headers; -1 if absent).
function smaIdx(d){const h=d.headers;return{s50:h.findIndex(x=>/sma.?50/i.test(x)),s100:h.findIndex(x=>/sma.?100/i.test(x)),s200:h.findIndex(x=>/sma.?200/i.test(x))};}
// Copy the active timeframe's SMA triple into the visible SMA columns for one row.
function applySmaTF(d, oi){
  const row=d.rows[oi], rec=SMA_TF[String(row[2]||'')];
  if(!rec) return;
  const set = rec.mode==='3Y' ? rec.w : rec.d;
  const {s50,s100,s200}=smaIdx(d);
  if(s50>=0) row[s50]=(set&&set[0]!=null)?set[0]:'';
  if(s100>=0) row[s100]=(set&&set[1]!=null)?set[1]:'';
  if(s200>=0) row[s200]=(set&&set[2]!=null)?set[2]:'';
}
// Toggle handler (called from the per-row 1Г/3Г buttons). Switches one stock's SMA timeframe.
function setSmaTF(oi, mode){
  const d=DATA[curIdx], tk=String(d.rows[oi][2]||'');
  const rec=SMA_TF[tk]||(SMA_TF[tk]={mode:'1Y',d:null,w:null});
  rec.mode=mode;
  applySmaTF(d, oi);
  renderTable(); scheduleSave();
}
// Move column `colIdx` to just after the first header matching `afterRegex` in the display order.
function positionAfter(d, colIdx, afterRegex){
  const ord=getOrd(), afterData=d.headers.findIndex(x=>afterRegex.test(x));
  const from=ord.indexOf(colIdx); if(from<0||afterData<0) return;
  ord.splice(from,1);
  ord.splice(ord.indexOf(afterData)+1,0,colIdx);
}
// Colour the (±%) distance badge by magnitude bucket (0–10 / 11–25 / 26–50 / 51–75 / 76+).
// ord 'X' = red→yellow→gray→blue→green as distance grows; 'Y' is the reverse.
function lvlPctColor(absPct, ord){
  const X=['var(--red)','var(--yellow)','var(--text3)','#38bdf8','var(--green)'];
  const Y=['var(--green)','#38bdf8','var(--text3)','var(--yellow)','var(--red)'];
  const b=absPct<=10?0:absPct<=25?1:absPct<=50?2:absPct<=75?3:4;
  return (ord==='X'?X:Y)[b];
}
// ===== Stock chart popup (test mode) =====
// Rolling simple moving average series; out[i] is null until enough history.
function smaSeries(arr,n){const out=new Array(arr.length).fill(null);let sum=0;for(let i=0;i<arr.length;i++){sum+=arr[i];if(i>=n)sum-=arr[i-n];if(i>=n-1)out[i]=sum/n}return out}
let _chartState=null,_lwcPromise=null,_histCache={};   // history cached 5 min per symbol+range — re-renders redraw instantly
// Load TradingView Lightweight Charts from CDN once.
function loadLWC(){
  if(window.LightweightCharts) return Promise.resolve();
  if(_lwcPromise) return _lwcPromise;
  _lwcPromise=new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';s.onload=res;s.onerror=()=>rej(new Error('не удалось загрузить библиотеку графика'));document.head.appendChild(s)});
  return _lwcPromise;
}
function closeStockChart(){if(_chartState&&_chartState.chart){try{_chartState.chart.remove()}catch(e){}_chartState.chart=null}const ov=document.getElementById('chartOverlay');if(ov)ov.style.display='none'}
function setChartYears(y){if(!_chartState)return;_chartState.years=y;['1','3'].forEach(n=>{const b=document.getElementById('cy'+n);if(b)b.classList.toggle('tf-on',+n===y)});drawChart()}
async function openStockChart(ticker){
  const d=DATA[curIdx],row=d.rows.find(r=>String(r[2]||'').toUpperCase()===String(ticker).toUpperCase());
  if(!row){toast('Нет данных по '+ticker,true);return}
  const ccy=rowCcy(row),name=row[1]||ticker;
  _chartState={ticker,row,ccy,name,years:1,chart:null};
  let ov=document.getElementById('chartOverlay');
  if(!ov){ov=document.createElement('div');ov.id='chartOverlay';ov.className='chart-overlay';document.body.appendChild(ov);ov.addEventListener('click',e=>{if(e.target===ov)closeStockChart()})}
  ov.innerHTML=`<div class="chart-card"><div class="chart-hd"><span><b>${name}</b> · ${ticker} ${ccy}</span><span class="chart-tools"><button class="tf-btn tf-on" id="cy1" onclick="setChartYears(1)">1Г</button><button class="tf-btn" id="cy3" onclick="setChartYears(3)">3Г</button><button class="chart-x" onclick="closeStockChart()">✕</button></span></div><div id="chartBox" class="chart-box"></div><div class="chart-legend" id="chartLegend"></div></div>`;
  ov.style.display='flex';
  drawChart();
}
// (Re)draw a price + SMA + support/resistance chart using Lightweight Charts.
// Defaults render the popup (_chartState into #chartBox); Портфель 3.0 passes its own state/ids.
async function drawChart(state=_chartState, boxId='chartBox', legendId='chartLegend'){
  const box=document.getElementById(boxId),legend=document.getElementById(legendId);
  if(!box||!state)return;
  state._boxId=boxId;
  const {row,ccy,years}=state;
  if(!PRICE_PROXY){box.textContent='PRICE_PROXY не задан';return}
  const histKey=exSymbol(row[2],ccy)+':'+(years===3?'5y':'2y');
  const hc=_histCache[histKey];
  const fromCache=hc&&Date.now()-hc.t<5*60*1000;
  if(!fromCache)box.textContent='Загрузка графика…';
  let j;
  try{
    await loadLWC();
    if(fromCache)j=hc.j;
    else{
      const r=await fetch(PRICE_PROXY+'?history='+encodeURIComponent(exSymbol(row[2],ccy))+'&range='+(years===3?'5y':'2y'));
      j=await r.json();
      if(j&&Array.isArray(j.c)&&j.c.length)_histCache[histKey]={j,t:Date.now()};
    }
  }catch(e){box.textContent='Ошибка загрузки: '+(e.message||e);return}
  if(!j||!Array.isArray(j.c)||!j.c.length){box.textContent='Нет исторических данных';return}
  if(state.chart){try{state.chart.remove()}catch(e){}state.chart=null}
  box.innerHTML='';
  const LWC=window.LightweightCharts,closes=j.c,ts=j.t||[];
  const DISP=years===3?756:252,start=Math.max(0,closes.length-DISP);
  const series=arr=>{const o=[];for(let i=start;i<arr.length;i++){const v=arr[i];if(typeof v==='number'&&isFinite(v))o.push({time:ts[i],value:Math.round(v*100)/100})}return o};
  const P=series(closes),A=series(smaSeries(closes,50)),B=series(smaSeries(closes,100)),C=series(smaSeries(closes,200));
  const dark=document.documentElement.dataset.theme==='dark';
  const txt=dark?'#e8eaed':'#1a1f2e',grd=dark?'#2a2f3a':'#e8ebf0',priceCol=dark?'#e8eaed':'#111827';
  const chart=LWC.createChart(box,{width:box.clientWidth||820,height:box.clientHeight||380,
    layout:{background:{type:'solid',color:'transparent'},textColor:txt},
    grid:{vertLines:{color:grd},horzLines:{color:grd}},
    rightPriceScale:{borderColor:grd},timeScale:{borderColor:grd},
    crosshair:{mode:LWC.CrosshairMode.Normal},
    handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true},
    localization:{priceFormatter:p=>p.toFixed(2)}});
  state.chart=chart;
  const mk=(color,title,lw)=>chart.addLineSeries({color,lineWidth:lw,title,priceLineVisible:false,lastValueVisible:true});
  const ps=mk(priceCol,'Цена',2),s50=mk('#2563eb','SMA 50',1),s100=mk('#f59e0b','SMA 100',1),s200=mk('#7c3aed','SMA 200',1);
  ps.setData(P);s50.setData(A);s100.setData(B);s200.setData(C);
  const supC=DATA[curIdx].headers.indexOf('Поддержка'),resC=DATA[curIdx].headers.indexOf('Сопротивление');
  const support=supC>=0?parseFloat(row[supC]):NaN,resistance=resC>=0?parseFloat(row[resC]):NaN;
  if(isFinite(support))ps.createPriceLine({price:support,color:'#16a34a',lineWidth:1,lineStyle:LWC.LineStyle.Dashed,axisLabelVisible:true,title:'Поддержка'});
  if(isFinite(resistance))ps.createPriceLine({price:resistance,color:'#dc2626',lineWidth:1,lineStyle:LWC.LineStyle.Dashed,axisLabelVisible:true,title:'Сопротивление'});
  chart.timeScale().fitContent();
  // Legend: hovered values when the crosshair moves, last values otherwise.
  const defs=[['Цена',ps,priceCol],['SMA 50',s50,'#2563eb'],['SMA 100',s100,'#f59e0b'],['SMA 200',s200,'#7c3aed']];
  const last=[P,A,B,C].map(a=>a.length?a[a.length-1].value:null);
  const paint=vals=>{legend.innerHTML=defs.map(([l,,c],i)=>`<span class="cl-item"><i style="background:${c}"></i>${l}${vals[i]!=null?` <b>${vals[i].toFixed(2)} ${ccy}</b>`:''}</span>`).join('')};
  paint(last);
  chart.subscribeCrosshairMove(param=>{if(!param||!param.time||!param.seriesData){paint(last);return}paint(defs.map(([,s])=>{const dp=param.seriesData.get(s);return dp&&typeof dp.value==='number'?dp.value:null}))});
  if(!state._resize){state._resize=()=>{const b=document.getElementById(state._boxId);if(state.chart&&b&&b.clientWidth)state.chart.applyOptions({width:b.clientWidth})};window.addEventListener('resize',state._resize)}
}
/* ===== Портфель 3.0 — single-stock (MU) page with the v3 redesign ===== */
let pf3State={row:null,ccy:'USD',years:1,chart:null};
const pf3Fmt=(n,dec=0)=>{const v=parseFloat(n);return isFinite(v)?v.toLocaleString(undefined,{minimumFractionDigits:dec,maximumFractionDigits:dec}):'—'};
// $12.3B / 9.9B EUR — money formatting for fundamentals in the report currency.
const pf3Bn=(v,ccy)=>{if(!(typeof v==='number'&&isFinite(v)))return'—';const a=Math.abs(v);const s=a>=1e9?(v/1e9).toFixed(1)+'B':a>=1e6?(v/1e6).toFixed(0)+'M':Math.round(v).toLocaleString();return(!ccy||ccy==='USD')?'$'+s:s+' '+ccy};

// Fundamentals (balance / cash flow / growth) via the worker's ?fundamentals= endpoint.
// Two modes, toggled in the UI: 'annual' (последний фин. год) and 'quarter'
// (баланс на конец последнего квартала + TTM денежный поток/выручка).
// Each mode is cached in memory for the session; re-fetched at most every 6h.
let pf3Fund={period:'annual',cache:{},loading:false};
const pf3Sym=()=>{const r=pf3D().rows[pf3SelIdx()];return exSymbol(r[2],r[8])};
const pf3FundData=()=>{const c=pf3Fund.cache[pf3Fund.period];return c&&c.sym===pf3Sym()?c.data:null};
// Failures are cached too (5 min) — otherwise a ticker FMP doesn't cover would
// retry → re-render → retry in a tight loop and the card would flicker forever.

// ── P/E и P/S с дистанцией от среднего по сектору (эталоны на 2026 г.) ──
// Значения [P/E, P/S] — типичные медианы макро-секторов; точка отсчёта,
// а не биржевая истина. Мультипликаторы бумаги приходят из ?fundamentals
// (Yahoo summaryDetail: trailingPE / priceToSalesTrailing12Months).
const PF3_VAL_AVG={'Полупроводники':[28,7],'Софт и облако':[35,9],'Кибербезопасность':[45,10],'Интернет и реклама':[25,6],'E-commerce и сервисы':[30,3],'Финансы и недвижимость':[18,4],'Здравоохранение':[20,4.5],'Потребительский сектор':[22,1.5],'Медиа и телеком':[18,2.5],'Промышленность и транспорт':[22,2.5],'Энергетика':[17,3],'Железо и сети':[24,4]};
function pf3ValCard(kind){
  const F=pf3FundData()||(pf3Fund.cache.annual||{}).data||(pf3Fund.cache.quarter||{}).data;
  const r=pf3D().rows[pf3SelIdx()];
  const sec=pf3MacroSector(String(r[4]||''));
  const avg=(PF3_VAL_AVG[sec]||[22,3])[kind==='pe'?0:1];
  const v=F?(kind==='pe'?F.pe:F.ps):null;
  const label=kind==='pe'?'P/E':'P/S';
  if(v==null||!(v>0))return`<div class="pf3-card-l">${label}</div><div class="pf3-card-v">—</div><div class="pf3-card-s">${F?RT('нет данных / компания убыточна','no data / loss-making'):RT('загрузка…','loading…')}</div>`;
  const diff=(v/avg-1)*100,cheap=diff<=0;
  return`<div class="pf3-card-l">${label}</div><div class="pf3-card-v">${v.toFixed(1)}</div><div class="pf3-card-s ${cheap?'pf3-up':'pf3-down'}">${RT(`сектор ≈${avg} · на ${Math.abs(diff).toFixed(0)}% ${cheap?'дешевле сектора':'дороже сектора'}`,`sector ≈${avg} · ${Math.abs(diff).toFixed(0)}% ${cheap?'below sector avg':'above sector avg'}`)}</div>`;
}
async function pf3LoadFundamentals(){
  const sym=pf3Sym(),per=pf3Fund.period,c=pf3Fund.cache[per];
  if(pf3Fund.loading)return;
  if(c&&c.sym===sym&&Date.now()-c.loaded<(c.failed?5*60*1000:6*3600*1000))return;
  pf3Fund.loading=true;
  let data=null;
  try{
    const j=await(await fetch(PRICE_PROXY+'?fundamentals='+encodeURIComponent(sym)+(per==='quarter'?'&period=quarter':''))).json();
    if(j&&typeof j==='object'&&!j.error&&(j.asOf||j.revenue!=null||j.totalDebt!=null))data=j;
  }catch(e){}
  pf3Fund.cache[per]={data,loaded:Date.now(),sym,failed:!data};
  pf3Fund.loading=false;
  if(isV3())pf3UpdateHealth();   // update only the health section — no full re-render
}
// Repaint just the «Здоровье бизнеса» section (cards, toggle state, report date).
function pf3UpdateHealth(){
  const g=document.getElementById('pf3HealthGrid');if(g)g.innerHTML=pf3Health();
  const pe=document.getElementById('pf3PeCard');if(pe)pe.innerHTML=pf3ValCard('pe');
  const ps=document.getElementById('pf3PsCard');if(ps)ps.innerHTML=pf3ValCard('ps');
  const a=document.getElementById('pf3FundAnnualBtn'),q=document.getElementById('pf3FundQuarterBtn');
  if(a)a.classList.toggle('on',pf3Fund.period==='annual');
  if(q)q.classList.toggle('on',pf3Fund.period==='quarter');
  const asof=document.getElementById('pf3FundAsof'),F=pf3FundData();
  if(asof)asof.textContent=F&&F.asOf?T('отчёт от')+' '+F.asOf:'';
}
function pf3SetFundPeriod(p){pf3Fund.period=p;pf3UpdateHealth();pf3LoadFundamentals()}

// 5-level grading: score 0–10 per dimension → Критично/Слабо/Средне/Хорошо/Отлично.
const PF3_LV=[{l:'Критично',c:'crit',e:'🔴'},{l:'Слабо',c:'weak',e:'🟠'},{l:'Средне',c:'mid',e:'🟡'},{l:'Хорошо',c:'good',e:'🟢'},{l:'Отлично',c:'exc',e:'🏆'}];
const pf3Lv=s=>s==null?null:s>=8.5?4:s>=6.5?3:s>=4.5?2:s>=2.5?1:0;
// 0–10 scores for balance / cash flow / growth + total average; null when no data.
function pf3Scores(F){
  const avg=a=>{const v=a.filter(x=>x!=null);return v.length?v.reduce((x,y)=>x+y,0)/v.length:null};
  const de=F.debtToEquity,cr=F.currentRatio,fcf=F.freeCashFlow,ocf=F.operatingCashFlow,cagr=F.revenueCagr,yoy=F.revenueYoY,rev=F.revenue;
  const deS=de==null?null:de<0.3?10:de<0.6?8:de<1?6:de<1.5?4:de<2?2:0;
  const crS=cr==null?null:cr>2.5?10:cr>1.8?8:cr>1.3?6:cr>1?4:cr>0.8?2:0;
  let cfS=null;   // FCF margin drives the score; positive OCF with negative FCF is weak, both negative — critical
  if(ocf!=null||fcf!=null){
    if(typeof fcf==='number'&&fcf>0){const m=rev>0?fcf/rev:null;cfS=m==null?6:m>0.20?10:m>0.12?8:m>0.06?6:m>0.02?5:4}
    else cfS=(typeof ocf==='number'&&ocf>0)?3:0;
  }
  const cagrS=cagr==null?null:cagr>15?10:cagr>8?8:cagr>4?6:cagr>0?5:cagr>-5?3:0;
  const yoyS=yoy==null?null:yoy>20?10:yoy>8?8:yoy>0?6:yoy>-10?3:0;
  const balance=avg([deS,crS]),growth=avg([cagrS,cagrS,yoyS]);   // CAGR weighs double vs YoY
  return {balance,cash:cfS,growth,total:avg([balance,cfS,growth])};
}

// Earnings calendar (next report date + consensus) via the worker's ?earnings= endpoint.
// Cached in memory for the session; re-fetched at most every 6h.
let pf3Earn={data:null,loaded:0,loading:false,failed:false,sym:''};
async function pf3LoadEarnings(){
  const sym=pf3Sym();
  if(pf3Earn.loading)return;
  if(pf3Earn.sym===sym&&pf3Earn.loaded&&Date.now()-pf3Earn.loaded<(pf3Earn.failed?5*60*1000:6*3600*1000))return;
  pf3Earn.loading=true;
  let data=null;
  try{
    const j=await(await fetch(PRICE_PROXY+'?earnings='+encodeURIComponent(sym))).json();
    if(j&&(j.next||j.last))data=j;
  }catch(e){}
  pf3Earn.data=data;pf3Earn.failed=!data;pf3Earn.sym=sym;pf3Earn.loaded=Date.now();
  pf3Earn.loading=false;
  if(isV3())pf3UpdateEarn();   // update only the earnings panel — no full re-render
}
function pf3UpdateEarn(){const b=document.getElementById('pf3EarnBody');if(b)b.innerHTML=pf3Earnings()}
const PF3_MONTHS=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function pf3DateRu(s){const d=new Date(s+'T00:00:00');if(isNaN(d))return String(s);return LANG==='en'?d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):`${d.getDate()} ${PF3_MONTHS[d.getMonth()]} ${d.getFullYear()}`}

// «Ближайший отчёт»: date + countdown, consensus EPS / revenue, last report vs estimates.
function pf3Earnings(){
  const ok=pf3Earn.sym===pf3Sym(),E=ok?pf3Earn.data:null;
  if(!E)return`<div class="pf3-empty">${pf3Earn.loading?T('Загружаю календарь отчётов…'):(ok&&pf3Earn.failed)?'Нет календаря отчётов по этой бумаге (проверены FMP и Yahoo; убедитесь, что worker обновлён)':'Загрузка…'}</div>`;
  const mc=v=>v==null?'—':((!E.ccy||E.ccy==='USD')?'$':'')+(+v).toFixed(2)+(E.ccy&&E.ccy!=='USD'?' '+E.ccy:'');
  let h='';
  if(E.next){
    const days=Math.ceil((Date.parse(E.next.date)-Date.now())/86400000);
    const when=days<=0?T('сегодня'):days===1?T('завтра'):RT(`через ${days} дн.`,`in ${days} d`);
    h+=`<div class="pf3-cards" style="margin-bottom:10px">
      <div class="pf3-card"><div class="pf3-card-l">${T('Дата отчёта')}</div><div class="pf3-card-v" style="font-size:17px">${pf3DateRu(E.next.date)}</div><div class="pf3-card-s">📅 ${when}</div></div>
      <div class="pf3-card"><div class="pf3-card-l">${T('Ожидание: EPS')}</div><div class="pf3-card-v">${mc(E.next.epsEst)}</div><div class="pf3-card-s">${T('консенсус аналитиков')}</div></div>
      <div class="pf3-card"><div class="pf3-card-l">${T('Ожидание: выручка')}</div><div class="pf3-card-v">${pf3Bn(E.next.revEst,E.ccy)}</div><div class="pf3-card-s">${T('консенсус аналитиков')}</div></div>
    </div>`;
  }else h+=`<div class="pf3-empty">${T('Дата следующего отчёта ещё не объявлена')}</div>`;
  if(E.last){
    const L=E.last;
    const cmp=(a,e)=>{if(a==null||e==null||!e)return'';const p=(a-e)/Math.abs(e)*100;return` <span class="${p>=0?'pf3-up':'pf3-down'}">(${p>=0?'✅ +':'❌ '}${p.toFixed(1)}% ${T('к прогнозу')})</span>`};
    const rev=L.revActual!=null?` · Выручка <b>${pf3Bn(L.revActual,E.ccy)}</b>${cmp(L.revActual,L.revEst)}`:'';
    h+=`<div class="pf3-hmetrics" style="margin-top:4px">${T('Прошлый отчёт')} ${pf3DateRu(L.date)}: EPS <b>${mc(L.epsActual)}</b>${cmp(L.epsActual,L.epsEst)}${rev}</div>`;
  }
  return h;
}

// Buy / add-on levels computed from the live technicals (SMA 50/100/200 + support).
// Re-rendered on every refresh, so the ladder follows the market automatically.
function pf3BuySection(r,h,price,ccy){
  const d=pf3D();
  const {s50,s100,s200}=smaIdx(d);
  const supC=h.indexOf('Поддержка');
  const raw=[['SMA 50',s50>=0?parseFloat(r[s50]):NaN],['SMA 100',s100>=0?parseFloat(r[s100]):NaN],['SMA 200',s200>=0?parseFloat(r[s200]):NaN],['Поддержка',supC>=0?parseFloat(r[supC]):NaN]].filter(([,v])=>isFinite(v)&&v>0);
  if(!raw.length||!(price>0))return`<div class="pf3-empty">${T('Нажмите «Обновить цену» — уровни покупки рассчитаются по SMA и поддержке')}</div>`;
  // Merge levels that sit within 1.5% of each other into one zone (e.g. SMA 100 ≈ SMA 200).
  const zones=[];
  raw.slice().sort((a,b)=>b[1]-a[1]).forEach(([n,v])=>{
    const z=zones.find(z=>Math.abs(z.val-v)/z.val<0.015);
    if(z){z.names.push(n);z.val=(z.val+v)/2;}else zones.push({names:[n],val:v});
  });
  const below=zones.filter(z=>z.val<price);            // buy zones, nearest first
  const above=zones.filter(z=>z.val>=price);
  const near=zones.find(z=>Math.abs(price-z.val)/z.val*100<=2);
  // Current signal banner.
  let sig;
  if(near)sig={cls:'buy',txt:RT(`🟢 Цена прямо у уровня ${near.names.join(' + ')} (${pf3Fmt(near.val,2)} ${ccy}) — зона покупки сейчас`,`🟢 Price right at ${near.names.join(' + ')} (${pf3Fmt(near.val,2)} ${ccy}) — buy zone now`)};
  else if(!below.length)sig={cls:'warn',txt:RT('🔴 Цена ниже всех технических уровней — нисходящий тренд, не ловите «падающий нож»','🔴 Price below all technical levels — downtrend, do not catch the falling knife')};
  else sig={cls:'wait',txt:RT(`⏳ Цена выше уровней — выгоднее ждать отката к ${below[0].names.join(' + ')} (−${((price-below[0].val)/price*100).toFixed(1)}%)`,`⏳ Price above the levels — better wait for a pullback to ${below[0].names.join(' + ')} (−${((price-below[0].val)/price*100).toFixed(1)}%)`)};
  // Ladder of buy zones below the current price.
  const plans=[RT('Первая докупка · ~25% бюджета','First add · ~25% of budget'),RT('Основная докупка · ~35% бюджета','Main add · ~35% of budget'),RT('Крупная докупка · ~40% бюджета','Large add · ~40% of budget'),RT('Экстра-зона · только при панике рынка','Extra zone · only in a market panic')];
  let rows='';
  below.forEach((z,i)=>{
    rows+=`<div class="pf3-buy"><span class="pf3-buy-n">${i+1}</span><div class="pf3-buy-info"><b>${pf3Fmt(z.val,2)} ${ccy}</b><span>${z.names.join(' + ')}</span></div><span class="pf3-buy-dist">−${((price-z.val)/price*100).toFixed(1)}%</span><span class="pf3-buy-plan">${plans[Math.min(i,plans.length-1)]}</span></div>`;
  });
  // Price under everything: the nearest level above becomes the reversal confirmation.
  if(!below.length&&above.length){
    const nx=above[above.length-1];
    rows=`<div class="pf3-empty">${RT(`Возврат выше ${pf3Fmt(nx.val,2)} ${ccy} (${nx.names.join(' + ')}) подтвердит разворот — докупать безопаснее после этого`,`A move back above ${pf3Fmt(nx.val,2)} ${ccy} (${nx.names.join(' + ')}) confirms the reversal — adding is safer after that`)}</div>`;
  }
  return `<div class="pf3-signal ${sig.cls}">${sig.txt}</div>${rows}`;
}

// The three «здоровье бизнеса» cards + overall company verdict with a 0–10 scale.
function pf3Health(){
  const c=pf3Fund.cache[pf3Fund.period],F=c&&c.sym===pf3Sym()?c.data:null;
  if(!F)return`<div class="pf3-empty">${pf3Fund.loading?T('Загружаю отчётность…'):(c&&c.sym===pf3Sym()&&c.failed)?'Нет данных по этой бумаге (проверены FMP и Yahoo; убедитесь, что worker обновлён)':'Загрузка…'}</div>`;
  const q=F.period==='quarter';
  const S=pf3Scores(F);
  const card=(icon,title,score,metrics)=>{
    const lv=pf3Lv(score);
    const verdict=lv==null?'—':`${PF3_LV[lv].e} ${T(PF3_LV[lv].l)} · ${score.toFixed(1)}`;
    return`<div class="pf3-hcard ${lv==null?'':PF3_LV[lv].c}"><div class="pf3-hcard-top"><span class="pf3-hcard-t">${icon} ${title}</span><span class="pf3-verdict ${lv==null?'':PF3_LV[lv].c}">${verdict}</span></div><div class="pf3-hmetrics">${metrics}</div></div>`;
  };
  const de=F.debtToEquity,cr=F.currentRatio,fcf=F.freeCashFlow,ocf=F.operatingCashFlow,cagr=F.revenueCagr,yoy=F.revenueYoY;
  const tl=pf3Lv(S.total);
  const OVERALL=['Критическое','Слабое','Среднее','Хорошее','Отличное'];
  const overall=tl==null?'':`<div class="pf3-overall">
    <div class="pf3-overall-l"><span class="pf3-overall-badge ${PF3_LV[tl].c}">${PF3_LV[tl].e} ${T('Состояние компании:')} ${T(OVERALL[tl])}</span><span class="pf3-overall-score">${S.total.toFixed(1)} / 10</span></div>
    <div class="pf3-scale"><div class="pf3-scale-marker" style="left:${Math.min(100,Math.max(0,S.total*10))}%"></div></div>
    <div class="pf3-scale-labels"><span>${T('Критично')}</span><span>${T('Слабо')}</span><span>${T('Средне')}</span><span>${T('Хорошо')}</span><span>${T('Отлично')}</span></div>
  </div>`;
  const cfLbl=(q||F.source==='yahoo')?T('за 12 мес (TTM)'):T('за фин. год');   // Yahoo's cash-flow figures are always TTM
  return overall
    +card('🏦',T('Устойчивый баланс'),S.balance,
      `${T('Долг/капитал')} <b>${de!=null?de.toFixed(2):'—'}</b> · ${T('Ликвидность')} <b>${cr!=null?cr.toFixed(1):'—'}</b> · ${T('Кэш')} <b>${pf3Bn(F.cash,F.ccy)}</b>${q?' · '+T('на конец квартала'):''}`)
    +card('💵',T('Положительный денежный поток'),S.cash,
      `${T('Свободный CF')} <b>${pf3Bn(fcf,F.ccy)}</b> · ${T('Операционный CF')} <b>${pf3Bn(ocf,F.ccy)}</b> ${cfLbl}`)
    +card('📈',T('Долгосрочный рост'),S.growth,
      `${T('Выручка CAGR')} ${F.revenueYears||'—'} ${T('лет')} <b>${cagr!=null?(cagr>0?'+':'')+cagr.toFixed(1)+'%':'—'}</b> · ${q?T('Квартал г/г'):T('Год к году')} <b>${yoy!=null?(yoy>0?'+':'')+yoy.toFixed(1)+'%':'—'}</b> · ${T('Выручка')}${q?' TTM':''} <b>${pf3Bn(F.revenue,F.ccy)}</b>`);
}

// ===== «AI Proto» sub-tab: Claude-powered portfolio analysis =====
// The worker's ?action=ai endpoint sends the snapshot to the Claude API and
// returns a markdown report; the last report is stored in pf3D().aiReport
// (synced), so it survives reloads and is visible on every device.
let pf3Ai={loading:false};

// Everything the model needs: positions with live prices, levels, targets, shares + capital.
function pf3AiSnapshot(key){
  key=key||v3Key;
  const d=DATA[key],h=d.headers,{s50,s100,s200}=smaIdx(d);
  const supC=h.indexOf('Поддержка'),resC=h.indexOf('Сопротивление'),tgC=h.findIndex(x=>/аналит/i.test(x));
  // Индексные вкладки: watchlist-снапшот — все акции с уровнями, фазой и
  // сигналом; AI выделяет самые актуальные и рекомендует действия.
  // Любой портфель (мой, Anna, AIP) идёт в портфельную ветку ниже.
  if(!pf3IsPort(key)){
    const peC=h.indexOf('P/E'),psC=h.indexOf('P/S');
    const nm=v=>{const n=parseFloat(v);return isFinite(n)&&n!==0?n:null};
    return{
      mode:'watchlist',index:key,baseCurrency:'SEK',
      stocks:d.rows.map(r=>{
        const c=pf3Criterion(d,r),sig=pf3SignalInfo(d,r);
        return{name:r[1],ticker:r[2],sector:r[4],type:r[5],ccy:r[8]||'USD',
          price:nm(r[7]),dayPct:nm(r[10]),
          sma50:s50>=0?nm(r[s50]):null,sma100:s100>=0?nm(r[s100]):null,sma200:s200>=0?nm(r[s200]):null,
          support:supC>=0?nm(r[supC]):null,resistance:resC>=0?nm(r[resC]):null,
          analystTarget:tgC>=0?nm(r[tgC]):null,pe:peC>=0?nm(r[peC]):null,ps:psC>=0?nm(r[psC]):null,
          phase:c.label,signal:sig.type!=='none'?`${sig.type}${sig.n?' '+sig.n:''}${typeof sig.dist==='number'?' '+sig.dist.toFixed(1)+'%':''}`:null};
      }),
      investorRules:AI_PREFS,
    };
  }
  let totalVal=0;
  d.rows.forEach((r,i)=>{recalcPF(i,key);totalVal+=parseFloat(r[13])||0});
  const num=v=>{const n=parseFloat(v);return isFinite(n)?n:null};
  const positions=d.rows.map(r=>({
    name:r[1],ticker:r[2],sector:r[4],ccy:r[8]||'USD',
    qty:num(r[6]),buyPrice:num(r[9]),price:num(r[7]),
    plPct:num(r[12]),valueSEK:Math.round(num(r[13])||0),
    sharePct:totalVal>0?Math.round((num(r[13])||0)/totalVal*1000)/10:0,
    sma50:s50>=0?num(r[s50]):null,sma100:s100>=0?num(r[s100]):null,sma200:s200>=0?num(r[s200]):null,
    support:supC>=0?num(r[supC]):null,resistance:resC>=0?num(r[resC]):null,
    analystTarget:tgC>=0?num(r[tgC]):null,
  }));
  // Allocation summary — the same numbers the «Состояние портфеля» tab shows.
  const group=key=>{const m={};positions.forEach(p=>{const k=p[key]||'—';m[k]=(m[k]||0)+(p.valueSEK||0)});return Object.entries(m).map(([k,v])=>({name:k,pct:totalVal>0?Math.round(v/totalVal*1000)/10:0})).sort((a,b)=>b.pct-a.pct)};
  return{
    baseCurrency:'SEK',fxToSEK:FX,positions,
    allocation:{bySector:group('sector'),byCurrency:group('ccy')},
    totals:{stocksSEK:Math.round(totalVal),freeCashSEK:Math.round((num(d.cashFree)||0)*pf3BaseFx(d)),leverageSEK:Math.round((key===PF3_KEY?(num(d.leverage)||0):0)*pf3BaseFx(d))},
    investorRules:AI_PREFS,   // личные правила инвестора — AI обязан их учитывать
    // Живой рыночный контекст: статистика фаз по индексным вкладкам + сводки
    // их последних AI-обзоров — портфельный анализ опирается на состояние рынка.
    marketContext:v3Tabs().filter(k=>!pf3IsPort(k)&&DATA[k]).map(k=>{
      const di=DATA[k],phases={};
      di.rows.forEach(r=>{const c=pf3Criterion(di,r);phases[c.label]=(phases[c.label]||0)+1});
      const last=(di.aiHistory||[])[0];
      return{index:k,phases,
        lastAiReview:last?{at:last.at,summary:(last.proposal&&last.proposal.summary)||String(last.text||'').slice(0,1200)}:null};
    }),
  };
}

// History of analyses (newest first, capped) — each entry {text, proposal, at}.
// Older d.aiReport (single report) is folded in for backward compatibility.
function pf3AiHist(){
  const d=pf3D();
  if(d.aiHistory&&d.aiHistory.length)return d.aiHistory;
  return d.aiReport?[d.aiReport]:[];
}
const pf3DtRu=iso=>{const d=new Date(iso);return isNaN(d)?'':pf3DateRu(String(iso).slice(0,10))+', '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};

// Access-token текущей сессии — worker пускает к AI только админа по нему.
async function sbToken(){
  try{const{data}=await sb.auth.getSession();return (data&&data.session&&data.session.access_token)||''}catch(e){return''}
}
async function pf3AiRun(){
  if(pf3Ai.loading)return;
  const key=v3Key;   // отчёт сохраняется во вкладку, где НАЖАЛИ кнопку, даже если переключились
  pf3Ai.loading=true;
  renderPF3();
  try{
    // Fresh prices + SMA/levels first — so the AI snapshot, the signals column
    // and the «Состояние портфеля» tab all reflect the current market state.
    await pf3Refresh(true);
    const r=await fetch(PRICE_PROXY+'?action=ai',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},body:JSON.stringify(pf3AiSnapshot(key))});
    const j=await r.json();
    if(j&&j.text){
      const d=DATA[key];
      aiSpendAdd(j.cost);
      const entry={text:j.text,proposal:j.proposal||null,at:new Date().toISOString(),cost:j.cost||null};
      d.aiHistory=[entry,...(d.aiHistory||(d.aiReport?[d.aiReport]:[]))].slice(0,10);   // keep the last 10 runs
      delete d.aiReport;   // superseded by aiHistory
      scheduleSave();
      toast('🤖 '+RT('Анализ готов — отчёт сохранён в «'+TAB_LABEL(key)+'»','Analysis ready — saved to '+TAB_LABEL(key)));
    }else toast((j&&j.error)||'AI не ответил',true);
  }catch(e){toast('Worker недоступен или не обновлён (нужен эндпоинт ?action=ai)',true);}
  pf3Ai.loading=false;
  if(isV3())renderPF3();
}

// ── 🔬 AI-анализ одной акции (карточка): web-поиск новостей + рекомендация ──
// Снапшот бумаги + контекст портфеля (доли по секторам, кэш) + прошлые разборы
// этого тикера (сверка прогноз↔факт). Результат логируется в STOCK_AI_LOG.
function stockAiSnapshot(d,r){
  const h=d.headers,{s50,s100,s200}=smaIdx(d);
  const g=name=>{const i=h.indexOf(name);const v=i>=0?parseFloat(r[i]):NaN;return isFinite(v)?v:null};
  const num=i=>{const v=i>=0?parseFloat(r[i]):NaN;return isFinite(v)?v:null};
  const tk=String(r[2]||'').toUpperCase(),price=parseFloat(r[7])||null;
  // Контекст портфеля для диверсификации — из основного портфеля.
  const p3=DATA[PF3_KEY];let port=null;
  if(p3){
    let tot=0;p3.rows.forEach((x,i)=>{recalcPF(i,PF3_KEY);tot+=parseFloat(x[13])||0});
    const bySec={};p3.rows.forEach(x=>{const sc=x[4]||'—';bySec[sc]=(bySec[sc]||0)+(parseFloat(x[13])||0)});
    port={baseCurrency:'SEK',stocksSEK:Math.round(tot),freeCashSEK:parseFloat(p3.cashFree)||0,
      bySectorPct:Object.entries(bySec).map(([k,v])=>({sector:k,pct:tot>0?Math.round(v/tot*1000)/10:0})).sort((a,b)=>b.pct-a.pct),
      holdsThis:p3.rows.some(x=>String(x[2]||'').toUpperCase()===tk)};
  }
  const prior=(STOCK_AI_LOG||[]).filter(e=>String(e.ticker||'').toUpperCase()===tk).slice(0,4)
    .map(e=>({at:e.ts,priceThen:e.price,verdict:(e.data||{}).verdict||null,targetThen:(e.data||{}).targetPrice||null,priceNow:price}));
  const tf=pf3TypeFull(d,r),F=pf3FundData();
  return{
    ticker:tk,name:r[1],sector:r[4],type:(tf&&tf.primary)||r[5],ccy:r[8]||'USD',
    price,dayPct:num(10),
    sma50:s50>=0?num(s50):null,sma100:s100>=0?num(s100):null,sma200:s200>=0?num(s200):null,
    support:g('Поддержка'),resistance:g('Сопротивление'),analystTarget:g('Аналит. таргет'),
    pe:g('P/E'),ps:g('P/S'),roe:g('ROE'),de:g('D/E'),revGrowthPct:g('Рост выручки'),
    revenueTTM:g('Выручка TTM'),marketCap:g('Кап-я'),dividendPct:g('Дивид. %'),
    fundamentals:F?{revenue:F.revenue,revenueYoY:F.revenueYoY,revenueCagr:F.revenueCagr,fcf:F.freeCashFlow,debtToEquity:F.debtToEquity,netIncome:F.netIncome,pe:F.pe,fwdPe:F.fwdPe,ps:F.ps}:null,
    recoVerdict:(()=>{try{return pf3Reco(d,r).v}catch(e){return null}})(),
    portfolio:port,priorAnalyses:prior,
  };
}
async function stockAiRun(ev){
  if(ev)ev.stopPropagation();
  if(pf3StockAi.loading)return;
  const d=pf3D(),r=d.rows[pf3SelIdx()];if(!r)return;
  const sym=String(r[2]||'').toUpperCase();
  pf3StockAi={sym,loading:true,text:null,data:null,at:null};
  renderPF3();
  try{
    await pf3LoadFundamentals().catch(()=>{});   // подтянуть фундаментал в снапшот
    const snap=stockAiSnapshot(d,r);
    const resp=await fetch(PRICE_PROXY+'?action=stockai',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},body:JSON.stringify(snap)});
    const j=await resp.json();
    if(j&&j.text){
      aiSpendAdd(j.cost);
      pf3StockAi={sym,loading:false,text:j.text,data:j.data||null,at:new Date().toISOString(),cost:j.cost||null,recoAt:snap.recoVerdict||null};
      _stkCardOpen[sym]=true;
      // Обучающая база: привязка к тикеру, дате, цене.
      STOCK_AI_LOG=[{ticker:sym,name:r[1],ts:pf3StockAi.at,price:snap.price,ccy:snap.ccy,
        verdict:(j.data||{}).verdict||null,target:(j.data||{}).targetPrice||null,horizon:(j.data||{}).horizon||null,
        cost:j.cost||null,recoAt:snap.recoVerdict||null,data:j.data||null,text:j.text},...(STOCK_AI_LOG||[])].slice(0,300);
      scheduleSave();
      toast('🔬 '+RT('Анализ готов','Analysis ready'));
    }else{pf3StockAi={sym,loading:false,text:null,data:null,at:null};toast((j&&j.error)||'AI не ответил',true);}
  }catch(e){pf3StockAi={sym,loading:false,text:null,data:null,at:null};toast(RT('Worker недоступен (нужен эндпоинт ?action=stockai)','Worker unreachable (?action=stockai)'),true);}
  renderPF3();
}
// ── 🔄 AI-Рекомендация: единый вердикт по карточке (техника+фундаментал+оценка
// +новости+макро) с web_search. Отдельно от детерминированного скоринга.
const AI_RECO_META={buy:['🟢',RT('Купить','Buy'),'buy'],wait:['🟡',RT('Ждать','Wait'),'wait'],sell:['🔴',RT('Продать','Sell'),'sell'],avoid:['⛔',RT('Избегать','Avoid'),'avoid']};
// Текущий детерминированный вердикт «Рекомендация» по строке (для флага «устарел»).
function recoNowV(d,r){try{return pf3Reco(d,r).v}catch(e){return null}}
const recoLbl=v=>(AI_RECO_META[v]||['','—'])[1];
// Флаг «устарел»: «Рекомендация» изменилась после того, как сделали AI-анализ.
function aiStaleBadge(recoAt,recoNow){
  if(!recoAt||!recoNow||recoAt===recoNow)return'';
  return`<div class="ai-stale" title="${RT('Детерминированная «Рекомендация» изменилась после этого AI-анализа — выводы могли устареть, запустите заново.','The deterministic recommendation changed after this AI analysis — it may be outdated; rerun it.')}">⚠️ ${RT('устарел','outdated')} · ${RT('Рекомендация','Reco')}: ${recoLbl(recoAt)} → ${recoLbl(recoNow)}</div>`;
}
// 💸 Учёт стоимости AI-прогонов (приходит в поле cost ответа воркера).
function aiSpendAdd(c){if(!c)return;AI_SPEND.usd=(AI_SPEND.usd||0)+(c.usd||0);AI_SPEND.runs=(AI_SPEND.runs||0)+1;AI_SPEND.in=(AI_SPEND.in||0)+(c.inTok||0);AI_SPEND.out=(AI_SPEND.out||0)+(c.outTok||0);AI_SPEND.searches=(AI_SPEND.searches||0)+(c.searches||0);}
const costUsd=c=>(c&&typeof c.usd==='number')?'$'+c.usd.toFixed(c.usd<1?3:2):'';
function costLine(c){if(!c||typeof c.usd!=='number')return'';const k=n=>n>=1000?Math.round(n/1000)+'k':(n||0);return`${costUsd(c)} · ${k(c.inTok)}→${k(c.outTok)} ${RT('ток.','tok')}${c.searches?' · '+c.searches+' '+RT('поиск.','search'):''}`;}
function aiSpendLine(){if(!AI_SPEND||!AI_SPEND.runs)return'';return`💸 ${RT('AI-расходы','AI spend')}: $${(AI_SPEND.usd||0).toFixed(2)} · ${AI_SPEND.runs} ${RT('прогон.','runs')}`;}
async function aiRecoRun(ev){
  if(ev)ev.stopPropagation();
  if(_aiRecoLoading)return;
  const d=pf3D(),r=d.rows[pf3SelIdx()];if(!r)return;
  const tk=String(r[2]||'').toUpperCase();
  _aiRecoLoading=tk;renderPF3();
  try{
    await pf3LoadFundamentals().catch(()=>{});   // подтянуть фундаментал в снапшот
    const snap=stockAiSnapshot(d,r);
    const resp=await fetch(PRICE_PROXY+'?action=reco',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},body:JSON.stringify(snap)});
    const j=await resp.json();
    if(j&&j.text){
      aiSpendAdd(j.cost);
      const D=j.data||{};
      AI_RECO[tk]={verdict:j.verdict||null,confidence:D.confidence||null,headline:D.headline||null,
        entryLow:D.entryLow??null,entryHigh:D.entryHigh??null,keyRisks:Array.isArray(D.keyRisks)?D.keyRisks:[],
        horizons:(D.horizons&&typeof D.horizons==='object')?D.horizons:null,
        text:j.text,price:snap.price,ccy:snap.ccy,at:new Date().toISOString(),cost:j.cost||null,recoAt:snap.recoVerdict||null};
      _aiRecoOpen[tk]=true;
      scheduleSave();
      toast('🔄 '+RT('AI-Рекомендация готова','AI recommendation ready'));
    }else toast((j&&j.error)||'AI не ответил',true);
  }catch(e){toast(RT('Worker недоступен (нужен эндпоинт ?action=reco)','Worker unreachable (?action=reco)'),true);}
  _aiRecoLoading=null;renderPF3();
}
function aiRecoToggle(tk){_aiRecoOpen[tk]=!_aiRecoOpen[tk];renderPF3();}
function aiRecoHTML(d,r){
  const tk=String(r[2]||'').toUpperCase();
  const loading=_aiRecoLoading===tk;
  const v=AI_RECO[tk];
  const btn=`<button class="pf3-btn pf3-btn-sm" onclick="aiRecoRun(event)"${loading?' disabled':''}>${loading?'⏳…':'🔄 '+RT('AI-Рекомендация','AI recommendation')+(v?' · '+RT('обновить','refresh'):'')}</button>`;
  const hd=`<div class="pf3-panel-hd"><span>🔄 ${RT('AI-Рекомендация','AI recommendation')}</span><span class="pf3-asof">${v&&v.at?RT('обновлено','updated')+' '+pf3DtRu(v.at)+(v.cost?' · '+costUsd(v.cost):''):''}</span>${btn}</div>`;
  let body;
  if(loading)body=`<div class="stkai-load">⏳ ${RT('Анализирую: техника, фундаментал, новости и мировой контекст… (до минуты)','Analysing: technicals, fundamentals, news and global context… (up to a minute)')}</div>`;
  else if(v){
    const E=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const M=AI_RECO_META[v.verdict]||['❔',v.verdict||'—','wait'];
    const entry=(v.entryLow!=null||v.entryHigh!=null)?`<span class="airk-bit">${RT('вход','entry')} ${[v.entryLow,v.entryHigh].filter(x=>x!=null).map(x=>pf3Fmt(x,2)).join('–')} ${v.ccy||''}</span>`:'';
    const risks=(v.keyRisks&&v.keyRisks.length)?`<div class="airk-risks">⚠️ ${v.keyRisks.map(x=>E(String(x))).join(' · ')}</div>`:'';
    const open=!!_aiRecoOpen[tk];
    body=`${aiStaleBadge(v.recoAt,recoNowV(d,r))}<div class="airk-head">
        <span class="airk-verdict xr-${M[2]}">${M[0]} ${M[1]}</span>
        ${v.confidence?`<span class="airk-conf">${RT('увер.','conf.')} ${v.confidence}</span>`:''}
        ${entry}
      </div>
      ${v.headline?`<div class="airk-headline">${E(String(v.headline))}</div>`:''}
      ${(()=>{const H=v.horizons;if(!H)return'';const cc=v.ccy||'';
        const HZ=[['now','⏱ '+RT('Сейчас','Now')],['mid','📅 6–9 '+RT('мес','mo')],['long','🚀 '+RT('Лонг','Long')]];
        const cells=HZ.map(([k,lbl])=>{const o=H[k];if(!o||typeof o!=='object')return'';
          const m=AI_RECO_META[o.verdict]||['❔',o.verdict||'—','wait'];
          const tgt=(o.target!=null&&isFinite(o.target))?`${RT('таргет','tgt')} ${pf3Fmt(o.target,2)} ${cc}${(o.upside!=null&&isFinite(o.upside))?` <span class="${o.upside>=0?'pf3-up':'pf3-down'}">${o.upside>=0?'+':''}${(+o.upside).toFixed(0)}%</span>`:''}`:'';
          const ent=(o.entryLow!=null||o.entryHigh!=null)?`${RT('вход','entry')} ${[o.entryLow,o.entryHigh].filter(x=>x!=null).map(x=>pf3Fmt(x,2)).join('–')} ${cc}`:'';
          return`<div class="airk-hz-it"><div class="airk-hz-l">${lbl}</div><div class="airk-hz-v"><span class="pf3-sig xr-${m[2]}">${m[0]} ${m[1]}</span></div>${tgt||ent?`<div class="airk-hz-x">${[tgt,ent].filter(Boolean).join(' · ')}</div>`:''}${o.note?`<div class="airk-hz-n">${E(String(o.note))}</div>`:''}</div>`;
        }).filter(Boolean).join('');
        return cells?`<div class="airk-hz">${cells}</div>`:'';})()}
      ${risks}
      <button class="stkai-toggle" onclick="aiRecoToggle('${tk}')">${open?'▾ '+RT('Скрыть разбор','Hide analysis'):'▸ '+RT('Показать разбор','Show analysis')}</button>
      ${open?`<div class="pf3-ai-report">${pf3Md(v.text)}</div>`:''}`;
  }else body=`<div class="pf3-empty">${RT('Нажмите «🔄 AI-Рекомендация» — Claude взвесит технику, фундаментал, оценку, свежие новости и мировую ситуацию и даст единый вердикт. Детерминированный скоринг «Рекомендация» выше остаётся как есть.','Press «🔄 AI recommendation» — Claude weighs technicals, fundamentals, valuation, fresh news and the global picture into one verdict. The deterministic «Рекомендация» score above stays as is.')}</div>`;
  return`<section class="pf3-panel">${hd}${body}</section>`;
}

// ── 🕵 AI Insider: массовое обновление инсайдерских сделок по портфелю ──────
// Уникальные тикеры портфельных вкладок → worker (Finnhub) → сводки в INSIDER;
// для новых кластерных покупок шлём Telegram-алерт.
let _insiderBusy=false;
// Только портфельные вкладки (для Valuation Check — секторные медианы по портфелю).
function insiderPortTickers(){
  const seen=new Set(),out=[];
  v3Tabs().filter(k=>pf3IsPort(k)).forEach(k=>{
    (DATA[k].rows||[]).forEach(r=>{const tk=String(r[2]||'').trim().toUpperCase();
      if(tk&&!seen.has(tk)){seen.add(tk);out.push({tk,name:r[1],ccy:r[8]||'USD'})}});
  });
  return out;
}
// ВСЕ вкладки с бумагами (портфели + индексные watchlist + AI-портфель) —
// для кнопки «🕵 AI Insider»: проходим по US (Finnhub) и SE (Finansinspektionen).
function insiderAllTickers(){
  const seen=new Set(),out=[];
  const keys=[...v3Tabs()];
  if(DATA[AIP_KEY]&&Array.isArray(DATA[AIP_KEY].rows))keys.push(AIP_KEY);
  keys.forEach(k=>{const d=DATA[k];if(!d)return;
    (d.rows||[]).forEach(r=>{const tk=String(r[2]||'').trim().toUpperCase();
      if(tk&&!seen.has(tk)){seen.add(tk);out.push({tk,name:r[1],ccy:r[8]||'USD'})}});
  });
  return out;
}
async function insiderUpdateAll(){
  if(_insiderBusy)return;
  _insiderBusy=true;
  const btn=document.getElementById('insiderBtn');
  if(btn){btn.disabled=true;btn.textContent='⏳ 0%';}
  const list=insiderAllTickers();   // все вкладки: US (Finnhub) + SE (Finansinspektionen)
  const today=new Date().toISOString().slice(0,10);
  const from=new Date(Date.now()-30*86400e3).toISOString().slice(0,10);
  const names={};list.forEach(x=>names[x.tk]=x.name);
  let done=0,clusters=0,withData=0;
  try{
    const tok=await sbToken();
    for(let i=0;i<list.length;i+=12){
      const chunk=list.slice(i,i+12);
      try{
        const r=await fetch(PRICE_PROXY+'?action=insider',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({items:chunk.map(x=>({tk:x.tk,name:x.name,ccy:x.ccy})),from,to:today,windowDays:10})});
        const j=await r.json();
        if(j&&!j.error){
          for(const tk of Object.keys(j)){
            const v=j[tk];if(!v||v.err)continue;
            const prev=INSIDER[tk]||{};
            INSIDER[tk]={...v,name:names[tk]||tk,notified:prev.notified||null,at:new Date().toISOString()};
            if(v.txCount>0)withData++;
            // Новый кластер (другая сигнатура) → Telegram-алерт.
            if(v.cluster){
              const sig=v.cluster.fromDate+'_'+v.cluster.toDate+'_'+v.cluster.uniqueBuyers;
              if(prev.notified!==sig){
                clusters++;INSIDER[tk].notified=sig;
                try{await fetch(PRICE_PROXY+'?action=insidernotify',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({ticker:tk,name:names[tk]||tk,uniqueBuyers:v.cluster.uniqueBuyers,sumUSD:v.cluster.sumUSD,windowDays:v.cluster.windowDays,fromDate:v.cluster.fromDate,toDate:v.cluster.toDate})});}catch(e){}
              }
            }
          }
        }
      }catch(e){}
      done+=chunk.length;
      const b=document.getElementById('insiderBtn');
      if(b)b.textContent=`⏳ ${Math.round(done/list.length*100)}%`;
    }
    scheduleSave();
    toast('🕵 '+RT(`Инсайдеры обновлены: ${withData}/${list.length} с данными · ${clusters} нов. кластер.`,`Insiders updated: ${withData}/${list.length} with data · ${clusters} new cluster(s)`));
  }catch(e){toast(RT('Worker недоступен (нужен эндпоинт ?action=insider)','Worker unreachable (?action=insider)'),true);}
  finally{_insiderBusy=false;renderAll();}
}
function insiderFmtUSD(v,ccy){if(v==null)return'—';const n=Math.round(v);return ccy==='SEK'?n.toLocaleString('sv-SE')+' kr':'$'+n.toLocaleString('en-US')}
function insiderSetFilter(k,val){insiderFilter[k]=(k==='minUSD')?(parseFloat(val)||0):val;renderPF3();}
// Панель инсайдеров в карточке акции.
function insiderHTML(d,r){
  const tk=String(r[2]||'').trim().toUpperCase();
  const v=INSIDER[tk];
  const cc=v&&v.valCcy;
  const cluster=v&&v.cluster;
  const srcL=v&&v.src==='fi'?' <span class="ins-src">FI 🇸🇪</span>':'';
  const head=`<div class="pf3-panel-hd"><span>🕵 ${RT('Инсайдеры','Insiders')}${srcL} ${cluster?`<span class="ins-cluster">🟢 CLUSTER BUY · ${cluster.uniqueBuyers} ${RT('инсайд.','insiders')}${cluster.sumUSD?' · '+insiderFmtUSD(cluster.sumUSD,cc):''}</span>`:''}</span>
    <span class="pf3-asof">${v&&v.at?RT('обновлено','updated')+' '+pf3DtRu(v.at):''}</span></div>`;
  if(!v||v.err)return`<section class="pf3-panel">${head}<div class="pf3-empty">${v&&v.err==='auth'?RT('Неверный Finnhub-ключ (FINNHUB_KEY)','Invalid Finnhub key'):v&&v.err==='no-key'?RT('Для US-бумаг нужен FINNHUB_KEY в воркере.','FINNHUB_KEY needed in the worker for US tickers.'):RT('Нет данных. Нажмите «🕵 AI Insider» на 🏠 Home (US — Finnhub, SE — Finansinspektionen).','No data. Press «🕵 AI Insider» on 🏠 Home (US — Finnhub, SE — Finansinspektionen).')}</div></section>`;
  if(!v.txCount)return`<section class="pf3-panel">${head}<div class="pf3-empty">${RT('Инсайдерских сделок за 30 дней не найдено','No insider transactions in the last 30 days')}</div></section>`;
  // Сводка
  const cards=`<div class="ins-sum">
    <div class="ins-card ins-buy"><div class="ins-l">${RT('Покупки','Buys')}</div><div class="ins-v">${insiderFmtUSD(v.buyUSD,cc)}</div><div class="ins-s">${pf3Fmt(v.buyShares)} ${RT('акц.','sh.')}</div></div>
    <div class="ins-card ins-sell"><div class="ins-l">${RT('Продажи','Sells')}</div><div class="ins-v">${insiderFmtUSD(v.sellUSD,cc)}</div><div class="ins-s">${pf3Fmt(v.sellShares)} ${RT('акц.','sh.')}</div></div>
    <div class="ins-card"><div class="ins-l">${RT('Нетто','Net')}</div><div class="ins-v ${v.netUSD>=0?'pf3-up':'pf3-down'}">${v.netUSD>=0?'+':''}${insiderFmtUSD(v.netUSD,cc)}</div><div class="ins-s">${RT('покупки − продажи','buys − sells')}</div></div>
  </div>`;
  // Фильтры
  const fl=`<div class="ins-filters">
    <select onchange="insiderSetFilter('type',this.value)">
      <option value="all"${insiderFilter.type==='all'?' selected':''}>${RT('Все','All')}</option>
      <option value="P"${insiderFilter.type==='P'?' selected':''}>${RT('Покупки','Buys')}</option>
      <option value="S"${insiderFilter.type==='S'?' selected':''}>${RT('Продажи','Sells')}</option>
    </select>
    <select onchange="insiderSetFilter('minUSD',this.value)">
      ${[0,100000,500000,1000000].map(x=>`<option value="${x}"${insiderFilter.minUSD===x?' selected':''}>${x?'≥ '+insiderFmtUSD(x):RT('любая сумма','any size')}</option>`).join('')}
    </select>
  </div>`;
  const tx=(v.tx||[]).filter(t=>(insiderFilter.type==='all'||t.code===insiderFilter.type)&&(!insiderFilter.minUSD||(t.value||0)>=insiderFilter.minUSD));
  const rows=tx.length?tx.map(t=>`<div class="ins-row">
    <span class="ins-code ${t.code==='P'?'p':t.code==='S'?'s':''}">${t.code==='P'?'🟢 '+RT('Покупка','Buy'):t.code==='S'?'🔴 '+RT('Продажа','Sell'):t.code}</span>
    <span class="ins-name">${t.name||'—'}</span>
    <span class="ins-qty">${pf3Fmt(t.shares)} × ${t.price!=null?pf3Fmt(t.price,2):'—'}</span>
    <span class="ins-val">${t.value!=null?insiderFmtUSD(t.value,cc):'—'}</span>
    <span class="ins-date">${t.date||''}</span>
  </div>`).join(''):`<div class="pf3-empty" style="padding:6px">${RT('Под фильтр ничего не попадает','Nothing matches the filter')}</div>`;
  return`<section class="pf3-panel">${head}${cards}<details class="ins-details"><summary class="ins-summary">📋 ${RT('Сделки инсайдеров','Insider trades')} · ${v.txCount}<span class="ins-chevron">▾</span></summary>${fl}<div class="ins-list">${rows}</div></details></section>`;
}

// 🔬 AI-разборы: история разборов из обучающей базы STOCK_AI_LOG. Каждая запись
// сверяется с текущей ценой бумаги (где она есть в данных) — прогноз↔факт.
function stkLivePrice(tk){
  const U=String(tk).toUpperCase();
  for(const key of v3Tabs()){
    const dd=DATA[key];if(!dd)continue;
    const r=(dd.rows||[]).find(x=>String(x[2]||'').trim().toUpperCase()===U);
    if(r&&parseFloat(r[7])>0)return parseFloat(r[7]);
  }
  return null;
}
function stkDelete(ts){
  STOCK_AI_LOG=(STOCK_AI_LOG||[]).filter(e=>e.ts!==ts);
  scheduleSave();renderAll();   // вкладка STK_KEY рисуется в renderAll, не в renderPF3
}
let _stkOpen={};
function stkToggle(ts){_stkOpen[ts]=!_stkOpen[ts];renderAll();}
function stkLogHTML(){
  const log=STOCK_AI_LOG||[];
  if(!log.length)return `<section class="pf3-panel"><div class="pf3-panel-hd"><span>🔬 ${RT('AI-разборы акций','AI stock analyses')}</span></div>
    <div class="pf3-empty">${RT('Пока пусто. Откройте карточку любой акции и нажмите «🤖 AI-анализ» — разбор сохранится сюда.','Empty yet. Open any stock card and press «🤖 AI-анализ» — the analysis is saved here.')}</div></section>`;
  const VB={add:['🟢',RT('Добавлять','Add'),'add'],watch:['🟡',RT('Наблюдать','Watch'),'watch'],avoid:['🔴',RT('Не добавлять','Avoid'),'avoid']};
  const rows=log.map(e=>{
    const v=VB[e.verdict]||['⚪','—',''];
    const now=stkLivePrice(e.ticker);
    const dlt=(now!=null&&e.price>0)?(now/e.price-1)*100:null;
    // Сверка прогноза: для «add» рост подтверждает, падение — мимо; для «avoid» наоборот.
    let mark='';
    if(dlt!=null&&(e.verdict==='add'||e.verdict==='avoid')){
      const good=e.verdict==='add'?dlt>=0:dlt<0;
      mark=`<span class="stk-mark ${good?'ok':'miss'}" title="${RT('сверка прогноза с фактом','forecast vs actual')}">${good?'✓':'✕'} ${dlt>=0?'+':''}${dlt.toFixed(1)}%</span>`;
    }else if(dlt!=null){
      mark=`<span class="stk-mark">${dlt>=0?'+':''}${dlt.toFixed(1)}% ${RT('с разбора','since')}</span>`;
    }
    const bits=[];const D=e.data||{};
    if(D.sizePct!=null)bits.push(`${RT('размер','size')} ${D.sizePct}%`);
    if(D.targetPrice!=null)bits.push(`${RT('цель','target')} ${pf3Fmt(D.targetPrice,2)}${D.upsidePct!=null?` (+${D.upsidePct}%)`:''}`);
    if(e.horizon)bits.push(`${RT('горизонт','horizon')} ${e.horizon}`);
    const open=!!_stkOpen[e.ts];
    return `<div class="stk-row">
      <div class="stk-head" onclick="stkToggle('${e.ts}')">
        ${logoHTML(e.ticker,e.ccy,'pf3-row-logo')}
        <div class="stk-id"><b>${e.name||e.ticker}</b><span>${e.ticker} · ${pf3DtRu(e.ts)}</span></div>
        <span class="stkai-verdict v-${v[2]}" style="margin:0;font-size:12px;padding:3px 9px">${v[0]} ${v[1]}</span>
        <span class="stk-px">${e.price!=null?pf3Fmt(e.price,2)+' '+(e.ccy||''):''}${mark}</span>
        <span class="stk-exp">${open?'▾':'▸'}</span>
      </div>
      ${bits.length?`<div class="stkai-bits" style="padding:0 4px 6px">${bits.map(b=>`<span>${b}</span>`).join('')}</div>`:''}
      ${open?`<div class="pf3-ai-report stk-body">${pf3Md(e.text||'')}</div><div style="text-align:right"><button class="pf3-btn pf3-btn-sm btn-del" onclick="stkDelete('${e.ts}')">🗑 ${RT('Удалить','Delete')}</button></div>`:''}
    </div>`;
  }).join('');
  return `<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>🔬 ${RT('AI-разборы акций','AI stock analyses')}</span><span class="pf3-asof">${log.length} ${RT('записей · прогноз сверяется с текущей ценой','entries · forecast vs current price')}</span></div>
    ${rows}
  </section>`;
}
// 🔎 «Анализ акции» — детерминированный разбор по уже собранным метрикам
// (долг, маржа, рост, оценка, покрытие) + стратегический вердикт. БЕЗ Claude
// и без оплаты токенов — в отличие от 🔬 AI-анализа.
function stockReportHTML(d,r){
  const h=d.headers, tk=String(r[2]||'').trim().toUpperCase();
  const price=parseFloat(r[7])||0, sector=String(r[4]||'—');
  const g=name=>{const i=h.indexOf(name);const v=i>=0?parseFloat(r[i]):NaN;return isFinite(v)?v:null};
  const num=v=>(typeof v==='number'&&isFinite(v))?v:null;
  const F=pf3FundData()||{};
  const de   = g('D/E') ?? num(F.debtToEquity);
  const revG = g('Рост выручки') ?? num(F.revenueYoY);
  const netM = (num(F.netIncome)!=null && num(F.revenue)>0) ? F.netIncome/F.revenue*100 : null;
  const fcfM = (num(F.freeCashFlow)!=null && num(F.revenue)>0) ? F.freeCashFlow/F.revenue*100 : null;
  const margin = netM!=null?netM:fcfM;
  const marginLbl = netM!=null?'чистая маржа':'FCF-маржа';
  const div = g('Дивид. %');
  const upside=pf3EffUpside(d,r);   // устаревший таргет → берём свежий «Таргет 3м»
  const nAn=(TG_META[tk]||{}).n||0;
  const val=VAL[tk]||{};
  const {s200}=smaIdx(d); const sma200=s200>=0?(parseFloat(r[s200])||0):0;
  const vs200=(sma200>0&&price>0)?(price/sma200-1)*100:null;
  const reco=(()=>{try{return pf3Reco(d,r)}catch(e){return null}})();
  const have=(num(F.revenue)!=null)||(de!=null)||(margin!=null);
  const p=(v,dg=1)=>v==null?'н/д':`${v>0?'+':''}${v.toFixed(dg)}%`;
  const B=[];
  if(de!=null){
    const lvl=de>2?'очень высокий':de>1?'повышенный':de>0.5?'умеренный':'низкий';
    const ctx=(margin!=null&&margin<0)
      ?' В контексте отрицательной маржи такой долг заметно усиливает риски неплатёжеспособности и удорожания обслуживания, особенно при росте ставок.'
      :(de>1?' Повышенная долговая нагрузка чувствительна к ставкам и циклу.':' Долговая нагрузка под контролем.');
    B.push(`<b>Долг к капиталу (D/E): ${de.toFixed(2)}</b> — ${lvl} уровень.${ctx}`);
  }
  if(margin!=null||revG!=null){
    let s='';
    if(margin!=null){
      if(margin<0) s+=`Отрицательная ${marginLbl} (${p(margin)})${revG!=null&&revG>0?` при росте выручки (${p(revG)})`:''} указывает на серьёзные проблемы с эффективностью бизнес-модели — каждый доллар продаж приносит убыток, что ставит под сомнение долгосрочную устойчивость.`;
      else if(margin<5) s+=`Тонкая ${marginLbl} (${p(margin)}) — мало запаса прочности.`;
      else if(margin<15) s+=`Здоровая ${marginLbl} (${p(margin)}).`;
      else s+=`Сильная ${marginLbl} (${p(margin)}) — бизнес прибыльный и эффективный.`;
    }
    if(revG!=null && !(margin!=null&&margin<0)) s+=` ${revG>=15?`Выручка растёт уверенно (${p(revG)}).`:revG>=5?`Умеренный рост выручки (${p(revG)}).`:revG>=0?`Слабый рост выручки (${p(revG)}).`:`Выручка снижается (${p(revG)}).`}`;
    B.push(`<b>Финансовая устойчивость:</b> ${s.trim()}`);
  }
  {
    let s=`Сектор — ${sector}.`;
    const sm=val.sector?(_valSecCache||valSectorMedians())[val.sector]:null;
    const c=sm?valCmp(val,sm):null;
    const peDim=c&&c.dims?c.dims.find(x=>x.k==='pe'&&x.cur>0):null;
    if(peDim&&peDim.secPct!=null){
      s+= peDim.secPct<=-10?` По мультипликаторам компания дешевле медианы сектора (${p(peDim.secPct,0)}).`
        : peDim.secPct>=10?` По мультипликаторам дороже сектора (+${peDim.secPct.toFixed(0)}%).`
        : ` Оценка примерно на уровне сектора.`;
    } else s+=` Детальных данных по конкурентам нет; в зрелых секторах конкуренция обычно интенсивна, с доминированием крупных игроков, что осложняет положение убыточных компаний.`;
    B.push(`<b>Конкурентная среда:</b> ${s}`);
  }
  {
    let s='';
    if(nAn===0) s='Нет покрытия аналитиками — повышенный информационный риск и неопределённость, меньше внешних ориентиров.';
    else { s=`Покрытие ~${nAn} аналит.`; if(upside!=null) s+= upside>=10?` Потенциал к консенсус-таргету ${p(upside,0)}.`:upside<=-5?` Цена выше таргета на ${Math.abs(upside).toFixed(0)}%.`:` Цена близко к консенсус-таргету.`; }
    if(div!=null) s+= div>0?` Дивиденд ${div.toFixed(1)}%.`:' Дивиденды не выплачиваются.';
    B.push(`<b>Покрытие и оценка:</b> ${s}`);
  }
  const VM={buy:['BUY',RT('Покупать','Buy'),'buy'],wait:['HOLD',RT('Держать / наблюдать','Hold'),'wait'],sell:['SELL',RT('Сокращать / продавать','Sell'),'sell'],avoid:['AVOID',RT('Избегать','Avoid'),'avoid']};
  const vk=reco?reco.v:'wait', VV=VM[vk]||VM.wait;
  const lead={buy:'привлекательный профиль для входа: ',wait:'смешанная картина, явного перевеса нет: ',sell:'повышенные риски для долгосрочного инвестора: ',avoid:'высокорискованный актив, перевес негативных факторов: '}[vk];
  const dr=[];
  if(revG!=null&&revG>=10) dr.push(`сильный рост выручки (${p(revG)})`);
  if(margin!=null&&margin<0) dr.push(`отрицательная ${marginLbl} (${p(margin)}) — критическая неэффективность основной деятельности`);
  else if(margin!=null&&margin>=15) dr.push(`высокая маржа (${p(margin)})`);
  if(de!=null&&de>1) dr.push(`высокий долг (D/E ${de.toFixed(2)}) — риски ликвидности`);
  if(upside!=null&&upside>=15) dr.push(`потенциал к таргету ${p(upside,0)}`);
  else if(upside!=null&&upside<=-5) dr.push('цена выше консенсус-таргета');
  if(vs200!=null) dr.push(vs200>=0?`цена выше SMA200 (${p(vs200,0)})`:`цена ниже SMA200 (${p(vs200,0)})`);
  if(div!=null&&div<=0&&margin!=null&&margin<0) dr.push('отсутствие дивидендов оправдано убытками, но подчёркивает неспособность генерировать прибыль');
  const horizon='Для долгосрочного горизонта (3–5 лет) такой профиль '+(vk==='avoid'||vk==='sell'?'ассоциируется с повышенными рисками потери капитала.':vk==='buy'?'выглядит привлекательно при контроле риска.':'требует наблюдения и подтверждения тренда.');
  const verdict=`<b>${VV[0]}</b> — ${lead}${dr.join('; ')||'факторы сбалансированы'}. ${horizon}`;
  const hd=`<div class="pf3-panel-hd"><span>🔎 ${RT('Анализ акции','Stock analysis')}</span><span class="pf3-asof">${RT('по данным дашборда · без AI','from dashboard data · no AI')}</span></div>`;
  if(!have) return`<section class="pf3-panel">${hd}<div class="pf3-empty">${pf3Fund.loading?T('Загружаю отчётность…'):RT('Нужен фундаментал — открывается автоматически или обновите акции 🔄.','Fundamentals needed — loads automatically or refresh 🔄.')}</div></section>`;
  return`<section class="pf3-panel">${hd}
    <ul class="sr-list">${B.map(b=>`<li>${b}</li>`).join('')}</ul>
    <div class="sr-verdict sr-${VV[2]}">🎯 ${RT('Стратегический вердикт','Strategic verdict')}: ${verdict}</div>
    <div class="pf3-reco-hz-l">${RT('Рекомендация по горизонтам','Recommendation by horizon')}</div>
    ${pf3HorizonsHTML(d,r)}
    <div class="pf3-ai-note">${RT('Детерминированный разбор по метрикам дашборда — бесплатно. Для свежих новостей и веб-поиска используйте 🔬 AI-анализ.','Deterministic analysis from dashboard metrics — free. For fresh news use 🔬 AI analysis.')}</div>
  </section>`;
}

function stockAiHTML(d,r){
  const sym=String(r[2]||'').toUpperCase();
  const cur=pf3StockAi.sym===sym?pf3StockAi:null;
  // Последний сохранённый разбор по этому тикеру (если в памяти ничего нет).
  const saved=(!cur||(!cur.loading&&!cur.text))?(STOCK_AI_LOG||[]).find(e=>String(e.ticker||'').toUpperCase()===sym):null;
  const loading=cur&&cur.loading;
  const text=cur&&cur.text?cur.text:(saved?saved.text:null);
  const data=cur&&cur.data?cur.data:(saved?saved.data:null);
  const at=cur&&cur.at?cur.at:(saved?saved.ts:null);
  const cost=cur&&cur.cost?cur.cost:(saved?saved.cost:null);
  const recoAt=cur&&cur.recoAt?cur.recoAt:(saved?saved.recoAt:null);
  const VB={add:['🟢',RT('Добавлять','Add')],watch:['🟡',RT('Наблюдать','Watch')],avoid:['🔴',RT('Не добавлять','Avoid')]};
  let head='';
  if(data&&VB[data.verdict]){
    const v=VB[data.verdict];
    const bits=[];
    if(data.sizePct!=null)bits.push(`${RT('размер','size')} ${data.sizePct}%${data.sizeSEK!=null?' ≈'+pf3Fmt(data.sizeSEK)+' kr':''}`);
    if(data.entryLow!=null||data.entryHigh!=null)bits.push(`${RT('вход','entry')} ${[data.entryLow,data.entryHigh].filter(x=>x!=null).map(x=>pf3Fmt(x,2)).join('–')}`);
    if(data.targetPrice!=null)bits.push(`${RT('цель','target')} ${pf3Fmt(data.targetPrice,2)}${data.upsidePct!=null?` (+${data.upsidePct}%)`:''}`);
    if(data.horizon)bits.push(`${RT('горизонт','horizon')} ${data.horizon}`);
    head=`<div class="stkai-verdict v-${data.verdict}">${v[0]} ${v[1]}${data.confidence?` · ${RT('увер.','conf.')} ${data.confidence}`:''}</div>
      <div class="stkai-bits">${bits.map(b=>`<span>${b}</span>`).join('')}</div>`;
  }
  const open=!!_stkCardOpen[sym];
  const body=loading
    ? `<div class="stkai-load">⏳ ${RT('Анализирую: цены, фундаментал, веб-поиск новостей… (до минуты)','Analysing: prices, fundamentals, web news search… (up to a minute)')}</div>`
    : text
      ? aiStaleBadge(recoAt,recoNowV(d,r))+head+`<button class="stkai-toggle" onclick="stockAiToggle('${sym}')">${open?'▾ '+RT('Скрыть разбор','Hide analysis'):'▸ '+RT('Показать разбор','Show analysis')}</button>${open?`<div class="pf3-ai-report">${pf3Md(text)}</div>${at?`<div class="pf3-ai-note">${RT('анализ от','analysis from')} ${pf3DtRu(at)}${cost?' · '+costLine(cost):''} · ${RT('сохранён в обучающую базу','saved to the learning log')}</div>`:''}`:''}`
      : `<div class="pf3-empty">${RT('Нажмите «🤖 AI-анализ» — Claude соберёт цены, уровни, фундаментал и свежие новости по компании и даст рекомендацию.','Press «🤖 AI-анализ» — Claude gathers prices, levels, fundamentals and fresh company news, then gives a recommendation.')}</div>`;
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>🔬 ${RT('AI-анализ акции','AI stock analysis')}</span>
      <button class="pf3-btn pf3-btn-sm" onclick="stockAiRun(event)"${loading?' disabled':''}>${loading?'⏳…':'🤖 '+RT('AI-анализ','AI analysis')+(text?' · '+RT('обновить','refresh'):'')}</button></div>
    ${body}
  </section>`;
}

// Minimal markdown → HTML for the report (headings, bold, bullet/numbered lists).
function pf3Md(t){
  const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmt=s=>s.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
  let html='',inList=false;
  const closeList=()=>{if(inList){html+='</ul>';inList=false}};
  esc(String(t)).split('\n').forEach(line=>{
    const l=line.trim();
    if(/^#{1,4}\s/.test(l)){closeList();html+='<h4 class="pf3-ai-h">'+fmt(l.replace(/^#+\s*/,''))+'</h4>';return}
    if(/^([-•*]|\d+[.)])\s/.test(l)){if(!inList){html+='<ul class="pf3-ai-ul">';inList=true}html+='<li>'+fmt(l.replace(/^([-•*]|\d+[.)])\s*/,''))+'</li>';return}
    if(!l){closeList();return}
    closeList();html+='<p>'+fmt(l)+'</p>';
  });
  closeList();
  return html;
}

// ===== Чат с ассистентом + его память (правила инвестора) =====
async function aiChatSend(){
  const inp=document.getElementById('aiChatInp');
  const q=(inp&&inp.value||'').trim();
  if(!q||aiChatBusy)return;
  AI_CHAT.push({role:'user',content:q,at:new Date().toISOString()});
  aiChatBusy=true;scheduleSave();renderPF3();
  try{
    const r=await fetch(PRICE_PROXY+'?action=chat',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},
      body:JSON.stringify({messages:AI_CHAT.slice(-16).map(m=>({role:m.role,content:m.content})),prefs:AI_PREFS,snapshot:pf3AiSnapshot()})});
    const j=await r.json();
    if(j&&j.reply){
      aiSpendAdd(j.cost);
      AI_CHAT.push({role:'assistant',content:j.reply,at:new Date().toISOString()});
      AI_CHAT=AI_CHAT.slice(-40);   // держим последние 40 сообщений
      (j.memory||[]).forEach(m=>{const t=String(m).trim();if(t&&!AI_PREFS.includes(t)){AI_PREFS.push(t);toast('🧠 Запомнил: '+t)}});
      scheduleSave();
    }else toast((j&&j.error)||'AI не ответил',true);
  }catch(e){toast('Worker недоступен или не обновлён (нужен эндпоинт ?action=chat)',true);}
  aiChatBusy=false;
  if(isV3())renderPF3();
}
function aiChatClear(){if(confirm('Очистить диалог с ассистентом? Память (правила) сохранится.')){AI_CHAT=[];scheduleSave();renderPF3()}}
function aiPrefAdd(){
  const inp=document.getElementById('aiPrefInp');
  const t=(inp&&inp.value||'').trim();
  if(!t)return;
  if(!AI_PREFS.includes(t))AI_PREFS.push(t);
  inp.value='';scheduleSave();renderPF3();
}
function aiPrefDel(i){AI_PREFS.splice(i,1);scheduleSave();renderPF3()}
function aiChatScroll(){const b=document.getElementById('aiChatBox');if(b)b.scrollTop=b.scrollHeight}

function pf3AiHTML(){
  const H=pf3AiHist(),last=H[0];
  let h=`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${T('🤖 AI Proto — обучается, анализирует портфель и обгоняет индексы')}</span><span class="pf3-asof">${last&&last.at?'обновлено '+pf3DtRu(last.at)+(last.cost?' · '+costLine(last.cost):''):''}</span></div>
    <div class="pf3-ai-bar">
      <button class="pf3-btn" onclick="pf3AiRun()" ${pf3Ai.loading?'disabled':''}>${pf3Ai.loading?T('⏳ Анализирую… (30–60 сек)'):T('🔮 Проанализировать портфель')}</button>
      <span class="pf3-ai-note">${v3Key===PF3_KEY?RT('Claude получит состав портфеля, живые цены, уровни SMA/поддержки, таргеты аналитиков, кэш и ваши правила (🧠) — и вернёт отчёт с рекомендациями и план ребалансировки (вкладка «⚖️ Предложение»).','Claude gets your holdings, live prices, SMA/support levels, analyst targets, cash and your rules (🧠) — and returns a report with recommendations plus a rebalancing plan (the ⚖️ Proposal tab).'):RT(`Claude получит все ${pf3D().rows.length} акций вкладки с живыми ценами, уровнями, фазами и таргетами — и выделит самые актуальные с рекомендациями (правила 🧠 учитываются).`,`Claude gets all ${pf3D().rows.length} stocks of this tab with live prices, levels, phases and targets — and highlights the most relevant ones with recommendations (your 🧠 rules apply).`)}</span>
    </div>
    ${last&&last.text?`<div class="pf3-ai-report">${pf3Md(last.text)}</div>`:(pf3Ai.loading?'':'<div class="pf3-empty">Отчёта ещё нет — нажмите «Проанализировать портфель»</div>')}
    ${aiSpendLine()?`<div class="pf3-ai-note pf3-spend" title="${RT('Накоплено по всем AI-прогонам (анализ, рекомендации, чат). Оценка по тарифу Opus 4.8.','Accumulated across all AI runs. Estimated at Opus 4.8 pricing.')}">${aiSpendLine()}</div>`:''}
  </section>`;
  // Чат: вопросы по портфелю и рынку; ассистент сам выносит устойчивые
  // пожелания в память (список правил ниже).
  const msgs=AI_CHAT.slice(-30).map(m=>m.role==='user'
    ?`<div class="ai-msg user">${m.content.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>`
    :`<div class="ai-msg bot">${pf3Md(m.content)}</div>`).join('');
  h+=`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${T('💬 Чат с AI Proto')}</span><span class="pf3-asof">${AI_CHAT.length?`<a href="#" onclick="aiChatClear();return false">${T('очистить')}</a>`:T('видит портфель, цены и ваши правила')}</span></div>
    <div class="ai-chat-box" id="aiChatBox">${msgs||'<div class="pf3-empty">Спросите что угодно о портфеле и рынке: «Стоит ли докупать Micron?», «Куда вложить 20 000 kr?». Скажите ассистенту свои правила — он запомнит их и будет учитывать в анализах.</div>'}${aiChatBusy?'<div class="ai-msg bot ai-typing">⏳ AI Proto думает…</div>':''}</div>
    <form class="ai-chat-form" onsubmit="event.preventDefault();aiChatSend()">
      <input id="aiChatInp" placeholder="${T('Ваш вопрос или указание ассистенту…')}" autocomplete="off" ${aiChatBusy?'disabled':''}>
      <button class="pf3-btn sim-buy" type="submit" ${aiChatBusy?'disabled':''}>${T('Отправить')}</button>
    </form>
  </section>
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${T('🧠 Память AI Proto — правила инвестора')}</span><span class="pf3-asof">${T('учитываются в чате и в полном анализе')}</span></div>
    ${AI_PREFS.map((p,i)=>`<div class="ai-pref"><span>• ${p.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</span><button class="pf3-del" onclick="aiPrefDel(${i})" title="Забыть правило">🗑</button></div>`).join('')||'<div class="pf3-empty">Правил пока нет — напишите их в чате («никогда не предлагай плечо», «хочу долю защитных 20%») или добавьте вручную ниже</div>'}
    <form class="ai-chat-form" onsubmit="event.preventDefault();aiPrefAdd()">
      <input id="aiPrefInp" placeholder="${T('Добавить правило вручную…')}" autocomplete="off">
      <button class="pf3-btn" type="submit">${T('➕ Запомнить')}</button>
    </form>
  </section>`;
  if(H.length>1){
    h+=`<section class="pf3-panel"><div class="pf3-panel-hd"><span>${T('📜 История запросов')}</span><span class="pf3-asof">${H.length-1} пред.</span></div>`;
    H.slice(1).forEach(e=>{
      h+=`<details class="pf3-ai-hist"><summary>🗓 ${pf3DtRu(e.at)}${e.cost?' · '+costUsd(e.cost):''}</summary><div class="pf3-ai-report" style="margin-top:10px">${pf3Md(e.text)}</div></details>`;
    });
    h+='</section>';
  }
  return h;
}

// ===== «Предложение» sub-tab: rebalancing plan from the latest AI run =====
function pf3PropHTML(){
  const H=pf3AiHist(),last=H[0],P=last&&last.proposal;
  let h=`<section class="pf3-panel"><div class="pf3-panel-hd"><span>${T('⚖️ Предложение по балансировке портфеля')}</span><span class="pf3-asof">${last&&last.at?'обновлено '+pf3DtRu(last.at):''}</span></div>`;
  if(!P){
    h+=`<div class="pf3-empty">${last?'В последнем анализе нет структурированного плана — запустите анализ заново на вкладке «🤖 AI Proto» (worker должен быть обновлён)':'Предложения ещё нет — запустите анализ на вкладке «🤖 AI Proto», и план ребалансировки появится здесь'}</div></section>`;
    return h;
  }
  if(P.summary)h+=`<div class="pf3-prop-sum">${pf3Md(P.summary)}</div>`;
  (P.actions||[]).forEach((a,i)=>{
    const cls=/куп/i.test(a.action)?'buy':/прода|сократ/i.test(a.action)?'sell':'hold';
    h+=`<div class="pf3-prop-row">
      <span class="pf3-prop-n">${i+1}</span>
      <span class="pf3-prop-act ${cls}">${a.action||''}</span>
      <div class="pf3-prop-info"><b>${a.name||''} <span class="pf3-cal-tk">${a.ticker||''}</span></b><span>${a.details||''}</span></div>
      <span class="pf3-prop-amt">${typeof a.amountSEK==='number'&&a.amountSEK>0?'≈'+pf3Fmt(a.amountSEK)+' kr':''}</span>
    </div>`;
  });
  h+='</section>';
  return h;
}

// ===== «Состояние портфеля» sub-tab: client-side health analysis =====
// Five dimensions scored 0–10 (diversification, sectors, currencies, cash &
// leverage, trend & quality) + overall verdict, allocations and recommendations.

// ── Риск и доходность портфеля (1 год): Шарп, CAGR, годовая волатильность ──
// Дневные истории всех бумаг → доходность портфеля как взвешенная сумма
// дневных доходностей (веса — текущие доли позиций). Кеш 6 часов.
let pf3Risk={key:null,data:null,loaded:0,loading:false,failed:false};
async function pf3LoadRisk(){
  if(pf3Risk.loading||(pf3Risk.data&&pf3Risk.key===v3Key&&Date.now()-pf3Risk.loaded<6*3600*1000))return;
  pf3Risk.loading=true;pf3Risk.failed=false;
  try{
    const d=pf3D();
    const pos=d.rows.map((r,i)=>{recalcPF(i,v3Key);return{sym:exSymbol(r[2],r[8]),w:parseFloat(r[13])||0}}).filter(x=>x.sym&&x.w>0);
    const tot=pos.reduce((a,x)=>a+x.w,0);
    if(!(tot>0)||pos.length<2)throw new Error('no positions');
    const hists=await Promise.all(pos.map(p=>fetch(PRICE_PROXY+'?history='+encodeURIComponent(p.sym)+'&range=1y').then(r=>r.json()).catch(()=>null)));
    const byDay={};   // 'YYYY-MM-DD' → {s: взвешенная сумма доходностей, w: покрытый вес}
    hists.forEach((h,i)=>{
      if(!h||!Array.isArray(h.c)||h.c.length<30)return;
      const w=pos[i].w/tot;
      for(let k=1;k<h.c.length;k++){
        if(!(h.c[k-1]>0&&h.c[k]>0))continue;
        const day=new Date(h.t[k]*1000).toISOString().slice(0,10);
        const o=byDay[day]||(byDay[day]={s:0,w:0});
        o.s+=(h.c[k]/h.c[k-1]-1)*w;o.w+=w;
      }
    });
    // Дни, где есть данные хотя бы по 60% веса портфеля; ренормализация по покрытию.
    const rets=Object.keys(byDay).sort().map(k=>byDay[k]).filter(x=>x.w>=0.6).map(x=>x.s/x.w);
    const n=rets.length;
    if(n<60)throw new Error('not enough history');
    const mean=rets.reduce((a,b)=>a+b,0)/n;
    const vol=Math.sqrt(rets.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(n-1))*Math.sqrt(252);
    const cagr=Math.pow(rets.reduce((a,b)=>a*(1+b),1),252/n)-1;
    const rf=0.02;   // безрисковая ставка для Шарпа
    pf3Risk={key:v3Key,data:{cagr:cagr*100,vol:vol*100,sharpe:vol>0?(cagr-rf)/vol:null,days:n},loaded:Date.now(),loading:false,failed:false};
  }catch(e){pf3Risk.loading=false;pf3Risk.failed=true;}
  pf3Risk.loading=false;
  if(isV3()&&pf3Tab==='health'){const b=document.getElementById('pf3RiskBox');if(b)b.innerHTML=pf3RiskHTML();}
}
function pf3RiskCard(title,valTxt,lv,ref){
  return`<div class="pf3-hcard ${lv==null?'':PF3_LV[lv].c}"><div class="pf3-hcard-top"><span class="pf3-hcard-t">${title}</span><span class="pf3-verdict ${lv==null?'':PF3_LV[lv].c}">${lv==null?'—':PF3_LV[lv].e+' '+T(PF3_LV[lv].l)}</span></div><div class="pf3-hmetrics"><b class="pf3-risk-v">${valTxt}</b><br>${ref}</div></div>`;
}
function pf3RiskHTML(){
  const R=pf3Risk.key===v3Key?pf3Risk.data:null;
  if(!R)return`<div class="pf3-empty">${pf3Risk.loading?RT('Считаю риск-метрики по дневным историям бумаг…','Computing risk metrics from daily price histories…'):pf3Risk.failed?RT('Не удалось загрузить истории цен — попробуйте позже','Could not load price histories — try again later'):'…'}</div>`;
  const shLv=R.sharpe==null?null:R.sharpe>=2?4:R.sharpe>=1?3:R.sharpe>=0.5?2:R.sharpe>=0?1:0;
  const cgLv=R.cagr>=20?4:R.cagr>=10?3:R.cagr>=5?2:R.cagr>=0?1:0;
  const vlLv=R.vol<=12?4:R.vol<=18?3:R.vol<=25?2:R.vol<=35?1:0;
  return`<div class="pf3-health-grid">
    ${pf3RiskCard(RT('⚖️ Коэффициент Шарпа','⚖️ Sharpe ratio'),R.sharpe==null?'—':R.sharpe.toFixed(2),shLv,RT('доходность на единицу риска (безриск 2%) · <b>0.5–1</b> средне · <b>1–2</b> хорошо · <b>≥2</b> отлично','return per unit of risk (rf 2%) · <b>0.5–1</b> fair · <b>1–2</b> good · <b>≥2</b> excellent'))}
    ${pf3RiskCard('📈 CAGR',(R.cagr>0?'+':'')+R.cagr.toFixed(1)+'%',cgLv,RT('годовой темп роста · <b>5–10%</b> на уровне рынка · <b>10–20%</b> хорошо · <b>≥20%</b> отлично','annualized growth · <b>5–10%</b> market-like · <b>10–20%</b> good · <b>≥20%</b> excellent'))}
    ${pf3RiskCard(RT('📊 Станд. отклонение','📊 Standard deviation'),R.vol.toFixed(1)+'%',vlLv,RT('годовая волатильность · <b>≤12%</b> низкая · <b>12–18%</b> умеренная (хорошо) · <b>≥25%</b> высокий риск','annualized volatility · <b>≤12%</b> low · <b>12–18%</b> moderate (good) · <b>≥25%</b> high risk'))}
  </div>
  <div class="pf3-risk-note">${RT(`по дневным доходностям за последний год (${R.days} торг. дней), веса — текущие доли позиций`,`from daily returns over the past year (${R.days} trading days), weighted by current position shares`)}</div>`;
}
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
    <div class="pf3-panel-hd"><span>${RT('📐 Риск и доходность — 1 год','📐 Risk & return — 1Y')}</span></div>
    <div id="pf3RiskBox">${pf3RiskHTML()}</div>
  </section>
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
  const equity=totalValB+free;   // чистый капитал в базовой валюте: акции + свободный кэш
  const withLev=equity+lev;      // покупательная способность с кредитным плечом
  const num=(key,val,cls)=>`<input class="pf3-cash-input${cls?' '+cls:''}" type="number" step="any" min="0" value="${val}" onchange="pf3SetNum('${key}',this.value)" title="Нажмите, чтобы изменить">`;
  const fxChip=c=>typeof FX[c]==='number'?`<span class="pf3-chip">1 ${c} = <b>${(+FX[c]).toFixed(2)}</b> kr</span>`:'';
  return`<section class="pf3-summary">
    <div class="pf3-card pf3-sum-hero"><div class="pf3-card-l">${T('Чистый капитал')}</div><div class="pf3-card-v">${pf3Fmt(equity)} ${unit}</div><div class="pf3-card-s">${T('акции + свободный кэш')}</div></div>
    <div class="pf3-card"><div class="pf3-card-l">${T('Акции')}</div><div class="pf3-card-v">${pf3Fmt(totalValB)} ${unit}</div><div class="pf3-card-s">${d.rows.length} ${T('позиций')} · ${equity>0?(totalValB/equity*100).toFixed(1):'—'}%</div></div>
    <div class="pf3-card"><div class="pf3-card-l">${T('Прибыль')}</div><div class="pf3-card-v ${totalProfit>=0?'pf3-up':'pf3-down'}">${totalProfit>0?'+':''}${pf3Fmt(totalProfitB)} ${unit}</div><div class="pf3-card-s ${pct>=0?'pf3-up':'pf3-down'}">${pct>0?'+':''}${pct.toFixed(1)}% ${T('от вложений')}</div></div>
    <div class="pf3-card"><div class="pf3-card-l">${T('Свободный кэш')}</div><div class="pf3-card-v">${num('cashFree',free)} <small>${unit}</small></div><div class="pf3-card-s">${equity>0&&free>0?(free/equity*100).toFixed(1)+'% '+T('% капитала · доступно для покупок').replace('% of equity','of equity').replace('% капитала','капитала'):T('нажмите, чтобы изменить')}</div></div>
    ${isDima?`<div class="pf3-card"><div class="pf3-card-l">${T('Кредитное плечо')}</div><div class="pf3-card-v">${lev>0?'+':''}${num('leverage',lev)} <small>${unit}</small></div><div class="pf3-card-s">${T('доступный кредит сверх капитала')}</div></div>
    <div class="pf3-card"><div class="pf3-card-l">${T('Доступно с плечом')}</div><div class="pf3-card-v">${pf3Fmt(withLev)} ${unit}</div><div class="pf3-card-s">${T('капитал + кредитное плечо')}</div></div>`:''}
  </section>
  <div class="pf3-fx"><span class="pf3-fx-l">${T('💱 Курсы')}</span>${fxChip('USD')+fxChip('EUR')+fxChip('NOK')+fxChip('DKK')}<span class="pf3-fx-note">${T('живые курсы ECB · база SEK')}</span></div>`;
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
  // Clicking a stock inside «Сектора»/«Тип» opens its card in the list view.
  if(pf3Sel&&(pf3Tab==='sec'||pf3Tab==='typ')){pf3Tab='list';renderAll();return}
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
  const tg=g(h.findIndex(x=>/аналит/i.test(x)));
  const B=(rank,cls,ico,label)=>({rank,cls,ico,label,html:`<span class="pf3-crit ${cls}">${ico} ${T(label)}</span>`});
  if(!(p>0)||!(a50>0)||!(a200>0))return{rank:3,cls:'flat',ico:'',label:'—',html:'<span class="pf3-crit flat">—</span>'};
  const upTg=tg>0?(tg-p)/p*100:null;
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
  if(up!=null){
    if(up>=25)fs+=push(F,2,`потенциал к таргету +${up.toFixed(0)}%`,`+${up.toFixed(0)}% upside to target`);
    else if(up>=10)fs+=push(F,1,`потенциал к таргету +${up.toFixed(0)}%`,`+${up.toFixed(0)}% upside to target`);
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
function pf3RecoHorizons(d,r){
  const price=parseFloat(r[7])||0,m=pf3TypeMetrics(d,r);
  const crit=pf3Criterion(d,r),sig=pf3SignalInfo(d,r);
  const up=pf3EffUpside(d,r),eff=pf3EffTarget(d,r);
  const {s50,s100,s200}=smaIdx(d),h=d.headers;
  const num=c=>{const v=c>=0?parseFloat(r[c]):NaN;return isFinite(v)?v:null};
  const dist=v=>(v&&v>0&&price>0)?(price/v-1)*100:null;
  const sma50=num(s50),sma100=num(s100),sma200=num(s200),sup=num(h.indexOf('Поддержка'));
  const d200=dist(sma200),dSup=dist(sup);
  const avg=PF3_VAL_AVG[pf3MacroSector(String(r[4]||''))]||[22,3];
  const spec=r[5]==='Спекулятивная',knife=crit.label==='Падающий нож';
  const overheat=crit.label==='Перегрев'||(d200!=null&&d200>=30);
  const noData=up==null&&m.roe==null&&m.pe==null&&m.beta==null;
  // ближайший уровень входа (SMA 50/100/поддержка)
  const lv=[[ 'SMA 50',sma50,dist(sma50)],['SMA 100',sma100,dist(sma100)],[RT('поддержка','support'),sup,dSup]]
    .filter(x=>x[1]>0).sort((a,b)=>Math.abs(a[2])-Math.abs(b[2]))[0];
  const entry=lv?lv[1]:null;
  // ⏱ Момент (сейчас) — техника и точка входа
  let now;
  if(noData)now={v:'wait',note:RT('недостаточно данных — обновите акции','not enough data — refresh stocks')};
  else if(knife)now={v:'avoid',note:RT('падающий нож — ждать стабилизации у поддержки','falling knife — wait for support to hold')};
  else if(sig.type==='sell'||(up!=null&&up<=-5))now={v:'sell',note:RT('у сопротивления / выше таргета — зона фиксации','at resistance / above target — take-profit')};
  else if(overheat)now={v:'sell',note:RT('перегрев — далеко над средними, ждать остывания','overheated — far above averages')};
  else if(sig.type==='buy'&&(d200==null||d200>=0))now={v:'buy',entry,note:RT(`цена у уровня ${sig.n||'входа'} в восходящем тренде`,`price at level ${sig.n||'entry'} in uptrend`)};
  else if(sig.type==='buy')now={v:'wait',entry,note:RT(`у уровня ${sig.n}, тренд слабый — нужно подтверждение`,`at level ${sig.n}, weak trend — need confirmation`)};
  else now={v:'wait',entry,note:RT(`до уровня входа ${sig.dist!=null?'≈ '+sig.dist.toFixed(1)+'%':'далеко'}`,`${sig.dist!=null?sig.dist.toFixed(1)+'% to entry':'far from entry'}`)};
  // 📅 6–9 месяцев — тренд + оценка + апсайд
  let ms=0;
  if(d200!=null)ms+=d200>0?1.5:-1;
  if(up!=null){if(up>=15)ms+=2;else if(up>=5)ms+=1;else if(up<=-5)ms-=1.5;}
  if(m.roe!=null&&m.roe>=12)ms+=1;if(m.revg!=null&&m.revg>=8)ms+=1;
  if(m.pe!=null&&m.pe>0){if(m.pe<=avg[0])ms+=0.5;else if(m.pe>=avg[0]*1.5)ms-=0.5;}
  if(knife)ms-=1;if(overheat)ms-=0.5;
  const midV=noData?'wait':ms>=2.5?'buy':ms<=-2?'sell':'wait';
  const mid={v:midV,target:eff.target>0?eff.target:null,up,note:noData?RT('нужны метрики','need metrics'):midV==='buy'?RT('тренд и потенциал к таргету за вход','trend + upside support an entry'):midV==='sell'?RT('слабый тренд / нет апсайда — сокращать','weak trend / no upside — trim'):RT('смешанно — ждать отчёт или вход у уровня','mixed — await earnings or a level')};
  // 🚀 Лонг (12+ мес) — фундаментал и недооценка
  let ls=0;
  if(m.roe!=null){if(m.roe>=15)ls+=2;else if(m.roe>=10)ls+=1;else if(m.roe<0)ls-=2;}
  if(m.revg!=null){if(m.revg>=15)ls+=2;else if(m.revg>=8)ls+=1;else if(m.revg<0)ls-=1;}
  if(up!=null){if(up>=25)ls+=2;else if(up>=10)ls+=1;else if(up<=-15)ls-=1;}
  if(m.pe!=null&&m.pe>0){if(m.pe<=avg[0])ls+=1;else if(m.pe>=avg[0]*1.8)ls-=1;}
  if(m.de!=null&&m.de>2)ls-=0.5;if(spec)ls-=1;
  const longV=noData?'wait':ls>=2.5?'buy':ls<=-2?'avoid':'wait';
  const ln=[];if(m.roe!=null)ln.push(`ROE ${m.roe.toFixed(0)}%`);if(m.revg!=null)ln.push(RT('рост','growth')+` ${m.revg.toFixed(0)}%`);if(up!=null)ln.push(`${up>=0?'+':''}${up.toFixed(0)}% ${RT('к таргету','to tgt')}`);
  const long={v:longV,note:noData?RT('нужны метрики','need metrics'):(ln.slice(0,3).join(' · ')||RT('по фундаменталу','on fundamentals'))};
  return{now,mid,long};
}
// Общий рендер трёх горизонтов (используют и 💡 Рекомендация, и 🔎 Анализ акции).
function pf3HorizonsHTML(d,r){
  const hz=pf3RecoHorizons(d,r),ccy=r[8]||'';
  const E=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const META={buy:['🟢',RT('Покупать','Buy'),'buy'],sell:['🔴',RT('Сокращать','Trim'),'sell'],wait:['🟡',RT('Ждать','Wait'),'wait'],avoid:['⛔',RT('Избегать','Avoid'),'avoid']};
  const HZ=[['⏱ '+RT('Сейчас','Now'),hz.now],['📅 6–9 '+RT('мес','mo'),hz.mid],['🚀 '+RT('Лонг','Long'),hz.long]];
  const cell=([lbl,o])=>{const mt=META[o.v]||META.wait;
    const x=(o.target!=null&&isFinite(o.target))?`${RT('таргет','tgt')} ${pf3Fmt(o.target,2)} ${ccy}${(o.up!=null&&isFinite(o.up))?` <span class="${o.up>=0?'pf3-up':'pf3-down'}">${o.up>=0?'+':''}${o.up.toFixed(0)}%</span>`:''}`:(o.entry!=null?`${RT('вход','entry')} ≈ ${pf3Fmt(o.entry,2)} ${ccy}`:'');
    return`<div class="airk-hz-it"><div class="airk-hz-l">${lbl}</div><div class="airk-hz-v"><span class="pf3-sig xr-${mt[2]}">${mt[0]} ${mt[1]}</span></div>${x?`<div class="airk-hz-x">${x}</div>`:''}<div class="airk-hz-n">${E(o.note||'')}</div></div>`;
  };
  return`<div class="airk-hz">${HZ.map(cell).join('')}</div>`;
}
// Вердикт скоринга → колонка данных «Реком. скоринг» (buy/wait/sell/avoid).
// Worker передаёт её Claude в universe AI-портфеля как мягкий фактор.
function pf3WriteReco(d){
  const c=ensurePFCol(d,'Реком. скоринг');
  d.rows.forEach(r=>{try{r[c]=pf3Reco(d,r).v}catch(e){}});
}
function pf3RecoHTML(d,r){
  const rc=pf3Reco(d,r);
  const META={buy:['🟢',RT('Покупать','Buy')],sell:['🔴',RT('Продавать / фиксировать','Sell / take profit')],wait:['🟡',RT('Ждать','Wait')],avoid:['⛔',RT('Не приближаться','Stay away')]};
  const [ico,label]=META[rc.v];
  const sgn=x=>`${x>0?'+':''}${x.toFixed(1)}`;
  const dim=(title,score,items)=>`<div class="pf3-reco-dim"><div class="pf3-reco-dim-hd">${title} <span class="${score>0?'pf3-up':score<0?'pf3-down':''}">${sgn(score)}</span></div>${items.map(i=>`<div class="pf3-reco-it ${i.pts>0?'pos':i.pts<0?'neg':'neu'}">${i.pts>0?'▲':i.pts<0?'▼':'•'} ${i.txt}</div>`).join('')||`<div class="pf3-reco-it neu">• ${RT('нет данных','no data')}</div>`}</div>`;
  return`<section class="pf3-panel pf3-reco">
    <div class="pf3-panel-hd"><span>${RT('💡 Рекомендация','💡 Recommendation')}</span><span class="pf3-asof">${RT('балл','score')} ${sgn(rc.total)}</span></div>
    <div class="pf3-reco-verdict rv-${rc.v}">${ico} ${label}<small>${rc.hint}</small></div>
    <div class="pf3-reco-hz-l">${RT('По горизонтам','By horizon')}</div>
    ${pf3HorizonsHTML(d,r)}
    <div class="pf3-reco-grid">
      ${dim(RT('📊 Фундаментал','📊 Fundamentals'),rc.fs,rc.F)}
      ${dim(RT('📈 Техника','📈 Technicals'),rc.ts,rc.T)}
      ${dim(RT('⚡ Риск','⚡ Risk'),rc.rs,rc.R)}
    </div>
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
    if(!it.recoV)return'—';
    const M={buy:['🟢',RT('Купить','Buy'),'buy'],sell:['🔴',RT('Продать','Sell'),'sell'],wait:['🟡',RT('Ждать','Wait'),'wait'],avoid:['⛔',RT('Опасно','Avoid'),'avoid']}[it.recoV];
    return`<span class="pf3-sig xr-${M[2]}" title="${it.recoHint||''}">${M[0]} ${M[1]}</span>`;
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

// «Сектора» / «Тип» sub-tabs: a sidebar with the category list on the left;
// clicking a category shows its stocks on the right (the largest one is
// selected by default). pf3TypeSel is shared — an unknown name after switching
// sub-tabs simply falls back to the first group.
let pf3TypeSel=null;
function pf3TypeSelect(g){pf3TypeSel=g;renderPF3()}
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
  const sel=list.find(x=>x.g===pf3TypeSel)||list[0];
  const nav=list.map(x=>`<div class="pf3-typenav-it${x.g===sel.g?' active':''}" onclick="pf3TypeSelect('${x.g.replace(/'/g,"\\'")}')">
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
  if(pf3Tab==='sec'||pf3Tab==='typ'){
    el.innerHTML=`<div class="pf3-wrap">${pf3IsPort(v3Key)?pf3Summary():""}${pf3GroupedHTML(pf3Tab)}</div>`;
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
  if(pf3Tab==='health'){
    el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${pf3HealthTab()}</div>`;
    pf3LoadRisk();   // Шарп/CAGR/волатильность — догружаются и подставляются в pf3RiskBox
    return;
  }
  if(pf3Tab==='div'){
    el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${pf3DiversHTML()}</div>`;
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
  if(pf3Tab==='aim'){
    el.innerHTML=`<div class="pf3-wrap">${pf3Summary()}${aipManageHTML()}</div>`;
    return;
  }
  if(pf3Sel&&!d.rows.some(r=>String(r[2]||'')===pf3Sel))pf3Sel=null;
  const open=!!pf3Sel;
  el.innerHTML=`<div class="pf3-wrap">${pf3IsPort(v3Key)?pf3Summary():""}${v3Key===PF3_KEY&&!open?pfPerfHTML():''}<div class="pf3-layout${open?' open':''}">
    ${open?`<div class="pf3-detail">${pf3DetailHTML()}</div>`:''}
    <aside class="pf3-list">
      <div class="pf3-list-hd"><span>${T('📋 Акции')} · ${TAB_LABEL(v3Key)}</span>${open?'':`<span class="pf3-hd-act"><button class="pf3-btn pf3-btn-sm" onclick="pf3XMenuToggle(event)">⚙ ${T('Колонки')}</button><button class="pf3-btn pf3-btn-sm" id="pf3RefreshBtn" onclick="pf3Refresh()">${T('🔄 Обновить акции')}</button>${pf3XMenuHTML(d)}</span>`}</div>
      ${pf3ListHead()}
      ${pf3ListHTML()}
      ${open||!isAdmin()||v3Key===AIP_KEY?'':`<form class="pf3-add" onsubmit="pf3Add(event)">
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
  }else if(v3Key===PF3_KEY)pfPerfDraw();   // график развития портфеля под сводкой
}

// The full card for the selected holding (everything: hero, stats, health, earnings, chart, buy levels).

// ===== 📈 Развитие портфеля (как у брокера): композит портфеля vs бенчмарки =====
// Истории всех бумаг за 3 года → дневные доходности, взвешенные ТЕКУЩИМИ долями
// позиций (приближение: состав считается неизменным), кумулятив в %.
// Бенчмарки сравниваются от начала выбранного периода. Кеш 6 часов.
let pfPerf={range:'1m',hist:null,loaded:0,loading:false,failed:false,bench:{'^OMX':true,'^NDX':true}};
const PF_PERF_BENCH=[['^OMX','OMX Stockholm 30','#f5c863'],['^NDX','Nasdaq 100','#8b8cf8']];
function pfPerfFrom(range){
  const n=new Date();
  if(range==='1w')return new Date(n-7*864e5);
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
async function pfPerfLoad(){
  if(pfPerf.loading||(pfPerf.hist&&Date.now()-pfPerf.loaded<6*3600*1000))return;
  pfPerf.loading=true;pfPerf.failed=false;
  try{
    const d=DATA[PF3_KEY];
    const pos=d.rows.map((r,i)=>{recalcPF(i,PF3_KEY);return{sym:exSymbol(r[2],r[8]),w:parseFloat(r[13])||0}}).filter(x=>x.sym&&x.w>0);
    const tot=pos.reduce((a,x)=>a+x.w,0);
    if(!(tot>0))throw new Error('empty');
    const syms=[...pos.map(p=>p.sym),...PF_PERF_BENCH.map(b=>b[0])];
    const res=await Promise.all(syms.map(x=>fetch(PRICE_PROXY+'?history='+encodeURIComponent(x)+'&range=3y').then(r=>r.json()).catch(()=>null)));
    const byDay={};
    pos.forEach((p,i)=>{
      const h=res[i];if(!h||!Array.isArray(h.c)||h.c.length<30)return;
      const w=p.w/tot;
      for(let k=1;k<h.c.length;k++){
        if(!(h.c[k-1]>0&&h.c[k]>0))continue;
        const day=new Date(h.t[k]*1000).toISOString().slice(0,10);
        const o=byDay[day]||(byDay[day]={s:0,w:0});
        o.s+=(h.c[k]/h.c[k-1]-1)*w;o.w+=w;
      }
    });
    let cum=1;
    const port=Object.keys(byDay).sort().filter(k=>byDay[k].w>=0.5).map(k=>{cum*=1+byDay[k].s/byDay[k].w;return{d:k,v:cum}});
    if(port.length<10)throw new Error('no history');
    const bench={};
    PF_PERF_BENCH.forEach((b,bi)=>{
      const h=res[pos.length+bi];
      if(h&&Array.isArray(h.c))bench[b[0]]=h.c.map((c,i2)=>({d:new Date(h.t[i2]*1000).toISOString().slice(0,10),v:c})).filter(x=>x.v>0);
    });
    pfPerf.hist={port,bench};pfPerf.loaded=Date.now();
  }catch(e){pfPerf.failed=true;}
  pfPerf.loading=false;
  if(isV3()&&v3Key===PF3_KEY&&pf3Tab==='list'&&!pf3Sel)renderPF3();
}
function pfPerfHTML(){
  const H=pfPerf.hist;
  const ranges=[['1w',RT('1 нед','1W')],['1m',RT('1 мес','1M')],['3m',RT('3 мес','3M')],['ytd',RT('в этом году','YTD')],['1y',RT('1 год','1Y')],['3y',RT('3 года','3Y')]];
  const btn=([k,l])=>{
    const p=H?pfPerfPct(H.port,pfPerfFrom(k)):null;
    return`<button class="pfp-r${pfPerf.range===k?' on':''}" onclick="pfPerfRange('${k}')">${l}<small class="${p==null?'':p>=0?'pf3-up':'pf3-down'}">${p==null?'—':(p>0?'+':'')+p.toFixed(2)+'%'}</small></button>`;
  };
  const cur=H?pfPerfPct(H.port,pfPerfFrom(pfPerf.range)):null;
  const chips=PF_PERF_BENCH.map(([sym,n,c])=>{
    const p=H&&H.bench[sym]?pfPerfPct(H.bench[sym],pfPerfFrom(pfPerf.range)):null;
    return`<button class="pfp-chip${pfPerf.bench[sym]?' on':''}" style="--c:${c}" onclick="pfPerfBench('${sym}')"><i></i>${n}${p!=null?` <span class="${p>=0?'pf3-up':'pf3-down'}">${(p>0?'+':'')+p.toFixed(2)}%</span>`:''}</button>`;
  }).join('');
  return`<section class="pf3-panel pfp">
    <div class="pf3-panel-hd"><span>${RT('📈 Развитие портфеля','📈 Portfolio performance')} ${cur!=null?`<b class="${cur>=0?'pf3-up':'pf3-down'}">${(cur>0?'+':'')+cur.toFixed(2)}%</b>`:''}</span><span class="pfp-chips">${chips}</span></div>
    <div id="pfPerfBox" class="pfp-chart">${H?'':`<div class="pf3-empty">${pfPerf.loading?RT('Загружаю истории цен всех позиций…','Loading price histories…'):pfPerf.failed?RT('Не удалось загрузить истории цен','Failed to load price histories'):'…'}</div>`}</div>
    <div class="pfp-ranges">${ranges.map(btn).join('')}</div>
    <div class="pf3-risk-note">${RT('состав портфеля считается текущим на всём периоде · бенчмарки от начала периода','assumes the current portfolio composition over the whole period · benchmarks from period start')}</div>
  </section>`;
}
function pfPerfRange(k){pfPerf.range=k;renderPF3()}
function pfPerfBench(sym){pfPerf.bench[sym]=!pfPerf.bench[sym];renderPF3()}
let _pfPerfChart=null;
async function pfPerfDraw(){
  if(!(isV3()&&v3Key===PF3_KEY&&pf3Tab==='list'&&!pf3Sel))return;
  if(!pfPerf.hist){pfPerfLoad();return}
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
  const pd=mk(pfPerf.hist.port);
  if(pd)chart.addLineSeries({color:'#6366f1',lineWidth:3,priceFormat:fmt}).setData(pd);
  PF_PERF_BENCH.forEach(([sym,,c])=>{
    if(!pfPerf.bench[sym])return;
    const sr=pfPerf.hist.bench[sym],dd=sr&&mk(sr);
    if(dd)chart.addLineSeries({color:c,lineWidth:1.5,priceFormat:fmt,priceLineVisible:false,lastValueVisible:false}).setData(dd);
  });
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
    ${rows||'<div class="pf3-empty">Тестовых позиций по этой акции нет — купите ниже и следите за результатом здесь и в саб-вкладке «Симуляция»</div>'}
    <form class="sim-form" onsubmit="event.preventDefault();simAdd('${tk}')">
      <label>${T('Кол-во')} <input id="simQty" type="number" step="any" min="0" placeholder="10"></label>
      <label>${T('Цена покупки')} (${ccy}) <input id="simPrice" type="number" step="any" min="0" value="${price>0?price:''}"></label>
      <button class="pf3-btn sim-buy" type="submit">${T('🧪 Купить (тест)')}</button>
    </form>
  </section>`;
}
// Саб-вкладка «Симуляция»: весь бумажный портфель с итогами в kr.
function simTabHTML(){
  let inv=0,val=0,known=true;
  const mine=SIM.map((s,i)=>({s,i})).filter(x=>(x.s.tab||PF3_KEY)===v3Key);
  const rows=mine.map(({s,i})=>{
    const q=simQuote(s.tk),price=q&&q.price>0?q.price:0,fx=FX[s.ccy]||1;
    const invS=s.qty*s.buy*fx,valS=price>0?s.qty*price*fx:null;
    inv+=invS; if(valS!=null)val+=valS; else known=false;
    const plp=valS!=null&&invS>0?(valS/invS-1)*100:null;
    return`<div class="sim-trow" onclick="simOpen('${s.tk}')">
      ${logoHTML(s.tk,s.ccy,'pf3-row-logo')}
      <div class="pf3-row-name"><b>${q?q.flag:''}${s.name||s.tk}</b><span>${s.tk} · ${T('куплено')} ${s.date}</span></div>
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
    <div class="pf3-panel-hd"><span>${T('🧪 Тестовый портфель')} — ${TAB_LABEL(v3Key)}</span><span class="pf3-asof">${T('покупка — в карточке акции, кнопка «Купить (тест)»')}</span></div>
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
    const j=await r.json();
    toast(j.error?j.error:String(j.result||'OK').split('\n')[0],!!j.error);
  }catch(e){toast(RT('Worker недоступен (нужен редеплой с ?action=aiport)','Worker unreachable (redeploy with ?action=aiport)'),true);}
  if(btn){btn.disabled=false;btn.textContent='▶ '+RT('Запустить цикл сейчас','Run cycle now');}
}
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
  AI_PORT.strategy=(g('aipStrategy')&&g('aipStrategy').value||'').trim()||AI_PORT.strategy;
  AI_PORT.intervalMin=parseInt(g('aipInterval')&&g('aipInterval').value)||60;
  AI_PORT.enabled=!!(g('aipEnabled')&&g('aipEnabled').checked);
  scheduleSave();
  toast(RT('Настройки AI портфеля сохранены ✓','AI portfolio settings saved ✓'));
}
function aipManageHTML(){
  const ap=AI_PORT;
  if(!ap)return`<section class="pf3-panel"><div class="pf3-empty">${RT('AI портфель инициализируется…','Initialising AI portfolio…')}</div></section>`;
  const {equity,posVal}=aipEquity();
  const ret=ap.startCapital>0?(equity/ap.startCapital-1)*100:0;
  // «Я vs AI»: мой портфель с момента старта AI
  const d=DATA[PF3_KEY];let myEq=0;
  if(d){d.rows.forEach(r=>{myEq+=parseFloat(r[13])||0});myEq+=parseFloat(d.cashFree)||0;}
  const myRet=ap.myStartEquity>0?(myEq/ap.myStartEquity-1)*100:null;
  const dd=aipMaxDD(ap.equityHistory);
  const closed=(ap.trades||[]).filter(t=>t.action==='sell'&&typeof t.plSEK==='number');
  const best=closed.length?closed.reduce((a,b)=>a.plSEK>b.plSEK?a:b):null;
  const worst=closed.length?closed.reduce((a,b)=>a.plSEK<b.plSEK?a:b):null;
  const days=Math.max(1,Math.round((Date.now()-(ap.startedAt||Date.now()))/86400e3));
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
  ${ap.lastNote?`<section class="pf3-panel"><div class="pf3-panel-hd"><span>💭 ${RT('Последний комментарий AI','Latest AI note')}</span></div><div class="aip-note">${ap.lastNote}</div></section>`:''}
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>📜 ${RT('Журнал сделок','Trade journal')}</span><span class="pf3-asof">${RT('последние 30 · каждое решение с обоснованием','last 30 · every decision with reasoning')}</span></div>
    ${trRows||`<div class="pf3-empty">${RT('Сделок ещё не было','No trades yet')}</div>`}
  </section>
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>⚙️ ${RT('Стратегия и управление','Strategy & controls')}</span></div>
    <textarea id="aipStrategy" class="aip-strategy" rows="4">${(ap.strategy||'').replace(/</g,'&lt;')}</textarea>
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
    pf3LastRefresh=Date.now();
    toast(RT(`✓ Обновлено: ${updated}/${total} акций · ${keys.length} вкладок · курсы валют`,`✓ Updated: ${updated}/${total} stocks · ${keys.length} tabs · FX rates`),updated===0);
  }finally{
    _homeUpd=false;
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
    for(let i=0;i<list.length;i+=12){
      const chunk=list.slice(i,i+12);
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
    // Алерты «дёшево по обоим измерениям» (новые) → Telegram, дедуп по подписи.
    for(const tk of Object.keys(VAL)){
      const v=VAL[tk];const c=valCmp(v,_valSecCache[v.sector]);
      if(c&&c.bothCount>=2){
        const sig='cheap_'+c.bothCount;
        if(v.notified!==sig){
          cheap++;VAL[tk].notified=sig;
          try{await fetch(PRICE_PROXY+'?action=valnotify',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({ticker:tk,name:v.name||tk,detail:c.detail})});}catch(e){}
        }
      }else if(v.notified){VAL[tk].notified=null;}
    }
    scheduleSave();
    toast('📐 '+RT(`Оценка обновлена: ${withData}/${list.length} с данными${cheap?` · ${cheap} нов. недооценк.`:''}`,`Valuation updated: ${withData}/${list.length} with data${cheap?` · ${cheap} new undervalued`:''}`));
  }catch(e){toast(RT('Worker недоступен (нужен ?action=valuation)','Worker unreachable (?action=valuation)'),true);}
  finally{_valBusy=false;renderAll();}
}
// Сравнение бумаги: дисконт/премия к медиане сектора и к собственной истории по
// каждому мультипликатору; «дёшево по обоим» — ниже сектора И ниже истории.
function valCmp(v,secMed){
  if(!v)return null;
  const BAND=10;   // ±% полоса «на уровне»
  const dims=[
    {k:'pe',label:'P/E',cur:v.fwdPe||v.pe,sec:secMed&&(secMed.fwdPe||secMed.pe),hist:(v.hist&&(v.hist.pe5||v.hist.pe3))||null},
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
// Панель Valuation Check в карточке акции.
function valHTML(d,r){
  const tk=String(r[2]||'').trim().toUpperCase();
  const v=VAL[tk];
  const hd=`<div class="pf3-panel-hd"><span>📐 ${RT('Оценка — мультипликаторы','Valuation — multiples')}</span><span class="pf3-asof">${v&&v.at?RT('обновлено','updated')+' '+pf3DtRu(v.at):''}</span></div>`;
  if(!v||!(v.pe||v.fwdPe||v.ps||v.evEbitda))
    return`<section class="pf3-panel">${hd}<div class="pf3-empty">${v?RT('Нет данных по мультипликаторам для этой бумаги.','No multiples data for this stock.'):RT('Нажмите «📐 Оценка» на 🏠 Home — соберём мультипликаторы по всему портфелю.','Press «📐 Valuation» on 🏠 Home to pull multiples across the portfolio.')}</div></section>`;
  const secMed=(_valSecCache||valSectorMedians())[v.sector]||null;
  const c=valCmp(v,secMed);
  const rowsHTML=c.dims.map(dm=>{
    if(!(dm.cur>0))return'';
    return`<tr><td class="val-l">${dm.label}</td><td>${valFmt(dm.cur)}</td><td>${dm.sec>0?valFmt(dm.sec)+' '+valChip(dm.secPct):'<span class="val-na">—</span>'}</td><td>${dm.hist>0?valFmt(dm.hist)+' '+valChip(dm.histPct):'<span class="val-na">—</span>'}</td></tr>`;
  }).join('');
  // Доп. строки без сравнения по секции (Forward P/E уже учтён в P/E; PEG отдельно).
  const extra=[];
  if(v.pe&&v.fwdPe)extra.push(`Forward P/E <b>${valFmt(v.fwdPe)}</b> · TTM ${valFmt(v.pe)}`);
  if(v.peg)extra.push(`PEG <b>${valFmt(v.peg)}</b>${v.peg<1?' · <span class="pf3-up">'+RT('рост недооценён','growth underpriced')+'</span>':''}`);
  const both=c.bothCount>=2?`<div class="val-both">🟢 ${RT('Дёшево по обоим измерениям','Cheap on both dimensions')} · ${c.bothCount}/3 ${RT('мультипл.','multiples')}</div>`:'';
  const caveat=both?`<div class="val-caveat">⚠️ ${RT('Низкие мультипликаторы часто бывают на пике цикла (прибыль временно завышена). Это статистическое наблюдение, не сигнал к покупке.','Low multiples often occur at the cycle peak (temporarily inflated earnings). A statistical observation, not a buy signal.')}</div>`:'';
  return`<section class="pf3-panel">${hd}
    ${v.sector?`<div class="val-sec">${RT('Сектор','Sector')}: <b>${v.sector}</b>${secMed&&secMed.n?` · ${RT('медиана по','median of')} ${secMed.n} ${RT('бум.','co.')}`:''}</div>`:''}
    ${both}
    <table class="val-tbl"><thead><tr><th></th><th>${RT('тек.','now')}</th><th>${RT('сектор','sector')}</th><th>${RT('история 5y','5y hist')}</th></tr></thead><tbody>${rowsHTML}</tbody></table>
    ${extra.length?`<div class="val-extra">${extra.map(e=>`<span>${e}</span>`).join('')}</div>`:''}
    ${caveat}
    <div class="pf3-ai-note">${RT('Yahoo (живые мультипл.) + FMP (история). Finnhub /metric — US-only, не используется. n/a при EPS≤0 (P/E), EBITDA<0 (EV/EBITDA), росте≤0 (PEG).','Yahoo (live multiples) + FMP (history). Finnhub /metric is US-only, unused. n/a when EPS≤0 (P/E), EBITDA<0 (EV/EBITDA), growth≤0 (PEG).')}</div>
  </section>`;
}

// 📐 Сводка недооценки на Home — результат кнопки «Оценка».
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
  return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>📐 ${RT('Недооценка по мультипликаторам','Undervaluation by multiples')}</span><span class="pf3-asof">${sub}</span></div>${body}</section>`;
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
  return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>🕵 ${RT('Инсайдерская активность','Insider activity')}</span><span class="pf3-asof">${sub}</span></div>${body}</section>`;
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
async function aiDashRun(){
  if(_aiDashBusy)return;_aiDashBusy=true;_aiDashProg='';
  const tabs=dashPortTabs();
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
      try{
        const r=await fetch(PRICE_PROXY+'?action=dashboard',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},body:JSON.stringify(snap)});
        const j=await r.json();
        if(j&&j.dash&&Array.isArray(j.dash.cards)){
          aiSpendAdd(j.cost);
          AI_DASH[k]={headline:j.dash.headline||'',cards:j.dash.cards,picks:Array.isArray(j.dash.picks)?j.dash.picks:[],asOf:j.dash.asOf||null,at:new Date().toISOString(),cost:j.cost||null};
          ok++;scheduleSave();if(!_aiDashSub)_aiDashSub=k;renderAll();
        }else toast((j&&j.error||RT('AI не ответил','AI did not respond'))+' · '+TAB_LABEL(k),true);
      }catch(e){toast(RT('Worker недоступен (нужен ?action=dashboard)','Worker unreachable (?action=dashboard)')+' · '+TAB_LABEL(k),true);}
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
  const anyDone=tabs.some(k=>AI_DASH[k]&&AI_DASH[k].cards);
  const btn=`<button class="pf3-btn" id="aiDashBtn" onclick="aiDashRun()"${_aiDashBusy?' disabled':''}>${_aiDashBusy?'⏳ '+RT('Генерирую','Generating')+(_aiDashProg?' '+_aiDashProg:'')+'…':'✨ '+RT('Сгенерировать','Generate')+(anyDone?' · '+RT('обновить','refresh'):'')+(tabs.length>1?' ('+tabs.length+')':'')}</button>`;
  // Шапка + саб-вкладки по портфелям.
  const subTabs=tabs.map(k=>{const dd=AI_DASH[k];const dot=dd&&dd.cards?'●':'○';return`<button class="dash-tab${k===sub?' active':''}" onclick="_aiDashSub=${JSON.stringify(k).replace(/"/g,'&quot;')};renderAll()">${dot} ${dashMd(TAB_LABEL(k))}</button>`}).join('');
  let h=`<section class="pf3-panel"><div class="pf3-panel-hd"><span>📊 AI-Dashboard <span class="dash-info-btn" onclick="event.stopPropagation();aiDashInfo()" title="${RT('Что это?','What is this?')}">!</span></span><span class="pf3-asof">${D&&D.at?RT('обновлено','updated')+' '+pf3DtRu(D.at)+(D.cost?' · '+costLine(D.cost):''):RT('AI Proto · отдельный анализ по каждому портфелю','AI Proto · separate analysis per portfolio')}</span>${btn}</div>${tabs.length>1?`<div class="dash-subtabs">${subTabs}</div>`:''}${D&&D.headline?`<div class="dash-headline">${dashMd(D.headline)}</div>`:''}</section>`;
  if(_aiDashBusy&&(!D||!D.cards))h+=`<div class="pf3-empty" style="padding:24px">⏳ ${RT('AI Proto анализирует портфель','AI Proto is analysing the portfolio')} «${dashMd(TAB_LABEL(sub))}» ${RT('(web-поиск)… до 1–2 минут на портфель.','(web search)… up to 1–2 min per portfolio.')}</div>`;
  else if(D&&D.cards&&D.cards.length){
    h+=`<div class="dash-grid">${D.cards.map(c=>{const bl=cardBullets(c);return`<section class="dash-card ${toneC[String(c.tone||'').toLowerCase()]||'dash-info'}"><div class="dash-card-hd">${dashMd(c.icon||'•')} <b>${dashMd(c.title||'')}</b></div><ul class="dash-bul">${bl.map(b=>`<li>${b}</li>`).join('')||`<li class="pf3-asof">—</li>`}</ul></section>`}).join('')}</div>`;
    h+=aiDashPicksHTML(D.picks);
  }
  else if(!_aiDashBusy)h+=`<div class="pf3-empty" style="padding:24px">${RT('Нажмите «✨ Сгенерировать» — AI Proto с веб-поиском свежих новостей/макро и вашими правилами (🧠 память) соберёт ОТДЕЛЬНЫЙ дашборд по каждому портфелю (мой и Anna): состояние, что важно сегодня, возможности, риски, макро, диверсификация, план на неделю + лучшие рекомендации на 1–3 / 3–6 / 6–12 мес. Переключайтесь между портфелями вкладками выше.','Press «✨ Generate» — AI Proto builds a SEPARATE dashboard per portfolio. Switch portfolios with the tabs above.')}</div>`;
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
  const tbl=(title,sub,arr,why)=>`<section class="pf3-panel"><div class="pf3-panel-hd"><span>${title}</span><span class="pf3-asof">${sub}</span></div>${arr.length?`<table class="bp-tbl"><thead><tr><th>#</th><th>${RT('Акция','Stock')}</th><th>${RT('Цена','Price')}</th><th>${RT('Почему','Why')}</th></tr></thead><tbody>${arr.map((x,i)=>`<tr onclick="insiderOpenCard('${x.tk}')"><td class="bp-n">${i+1}</td><td class="bp-name"><b>${x.name}</b> <span class="bp-tk">${x.tk}</span></td><td class="bp-px">${pf3Fmt(x.price,2)} <small>${x.ccy}</small></td><td class="bp-why">${why(x)}</td></tr>`).join('')}</tbody></table>`:`<div class="pf3-empty">${RT('Подходящих кандидатов нет — нажмите «🔄 Обновить всё».','No suitable candidates — press «🔄 Update all».')}</div>`}</section>`;
  return`
    ${tbl('🥇 '+RT('Лучшие на 1–3 мес','Best 1–3 months'),RT('импульс и точки входа','momentum & entry'),P.short,bpWhyShort)}
    ${tbl('🥈 '+RT('Лучшие на 3–6 мес','Best 3–6 months'),RT('тренд + разумная цена','trend + fair value'),P.medium,bpWhyMed)}
    ${tbl('🥉 '+RT('Лучшие на 6–12 мес','Best 6–12 months'),RT('фундаментал и недооценка','fundamentals & value'),P.long,bpWhyLong)}
    <div class="pf3-ai-note">${RT('Детерминированный отбор из всех вкладок по обновлённым данным. Справочно, не инвестиционная рекомендация.','Deterministic screen across all tabs from refreshed data. Reference only, not investment advice.')}</div>`;
}
function homeHTML(){
  return`
  <section class="pf3-panel"><div class="pf3-panel-hd"><span>📊 ${RT('Рынок сейчас','Market now')}</span><span class="pf3-asof">${RT('лучшие кандидаты по горизонтам','best candidates by horizon')}</span><button class="pf3-btn pf3-btn-sm" id="homeUpdBtn" onclick="homeUpdateAll()">🔄 ${RT('Обновить всё','Update all')}</button>${isAdmin()?`<button class="pf3-btn pf3-btn-sm" id="insiderBtn" onclick="insiderUpdateAll()" title="${RT('Инсайдерские сделки по всем вкладкам (US: Finnhub · SE: Finansinspektionen)','Insider transactions across all tabs (US: Finnhub · SE: Finansinspektionen)')}">🕵 AI Insider</button>`:''}${isAdmin()?`<button class="pf3-btn pf3-btn-sm" id="valBtn" onclick="valUpdateAll()" title="${RT('Мультипликаторы vs медиана сектора и собственная история','Multiples vs sector median and own history')}">📐 ${RT('Оценка','Valuation')}</button>`:''}</div></section>
  ${homeBestHTML()}
  ${isAdmin()?homeValHTML():''}
  ${isAdmin()?homeInsiderHTML():''}`;
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
        </div>
      </div>
      <div class="pf3-quote">
        <div class="pf3-price${isFinite(day)?(day>=0?' pf3-up':' pf3-down'):''}">${price>0?pf3Fmt(price,2):'—'} <small>${ccy}</small></div>
        ${isFinite(day)?`<div class="pf3-day ${day>=0?'pf3-up-bg':'pf3-down-bg'}">${day>0?'+':''}${day.toFixed(2)}% ${T('за день')}</div>`:''}
        <button class="pf3-btn" id="pf3RefreshBtn" onclick="pf3Refresh()">${T('🔄 Обновить цену')}</button>
      </div>
    </section>
    <section class="pf3-cards">
      ${pf3MyPort(v3Key)?`<div class="pf3-card"><div class="pf3-card-l">${T('Стоимость позиции')}</div><div class="pf3-card-v">${pf3Money(d,valSEK)}</div><div class="pf3-card-s">${pf3Fmt(qty)} акц. × ${pf3Fmt(price,2)} ${ccy}</div></div>
      <div class="pf3-card"><div class="pf3-card-l">${T('Прибыль')}</div><div class="pf3-card-v ${profit>=0?'pf3-up':'pf3-down'}">${profit>0?'+':''}${pf3Money(d,profit)}</div><div class="pf3-card-s ${ppct>=0?'pf3-up':'pf3-down'}">${ppct>0?'+':''}${ppct.toFixed(1)}% от покупки</div></div>
      <div class="pf3-card"><div class="pf3-card-l">${T('Цена покупки')}</div><div class="pf3-card-v">${pf3Fmt(buy,2)} <small>${ccy}</small></div><div class="pf3-card-s">вложено ${pf3Money(d,qty*buy*(FX[ccy]||1))}</div></div>`:''}
      <div class="pf3-card"><div class="pf3-card-l">${T('Аналит. таргет')}${tgM.src?`<span class="tg-src">${tgM.src==='fmp'?'FMP':'Yahoo/Refinitiv'}</span>`:''}${tgStale?`<span class="tg-stale" title="${RT(`Среднее за всё время расходится со свежим срезом на ${tgDiv.toFixed(0)}% — старые таргеты тянут его. Ориентир — свежий.`,`All-time mean diverges from the recent slice by ${tgDiv.toFixed(0)}% — old targets drag it. Trust the recent one.`)}">⚠️ ${RT('устарел','stale')}</span>`:''}</div><div class="pf3-card-v">${hasTarget?pf3Fmt(target,0)+' <small>'+ccy+'</small>':'—'}</div><div class="pf3-card-s ${hasTarget&&target>=price?'pf3-up':'pf3-down'}">${hasTarget?(target>=price?'+':'')+((target-price)/price*100).toFixed(1)+'% '+T('потенциал')+(tgM.n?` · ${tgM.n} `+RT('аналит.','an.'):''):T('появится при обновлении акций (🔄, раз в сутки)')}</div>${hasTargetR?`<div class="pf3-card-sub${tgStale?' tg-hi':''}"><span class="tg-recent-l">${tgM.span==='m'?RT('за месяц','last mo'):RT('за квартал','last qtr')}</span> <b>${pf3Fmt(targetR,0)}</b> <small>${ccy}</small> <span class="${targetR>=price?'pf3-up':'pf3-down'}">${targetR>=price?'+':''}${((targetR-price)/price*100).toFixed(1)}%</span>${tgM.nr?` · ${tgM.nr} `+RT('аналит.','an.'):''}</div>`:''}</div>
      <div class="pf3-card" id="pf3PeCard">${pf3ValCard('pe')}</div>
      <div class="pf3-card" id="pf3PsCard">${pf3ValCard('ps')}</div>
    </section>
    ${pf3RecoHTML(d,r)}
    ${stockReportHTML(d,r)}
    ${isAdmin()?aiRecoHTML(d,r):''}
    ${isAdmin()?stockAiHTML(d,r):''}
    ${isAdmin()?valHTML(d,r):''}
    ${isAdmin()?insiderHTML(d,r):''}
    <section class="pf3-panel">
      <div class="pf3-panel-hd"><span>${T('💪 Здоровье бизнеса')} <span class="pf3-asof" id="pf3FundAsof">${(pf3FundData()||{}).asOf?T('отчёт от')+' '+pf3FundData().asOf:''}</span></span><span class="pf3-tf"><button id="pf3FundAnnualBtn" class="pf3-tfbtn${pf3Fund.period==='annual'?' on':''}" onclick="pf3SetFundPeriod('annual')">${T('Годовой отчёт')}</button><button id="pf3FundQuarterBtn" class="pf3-tfbtn${pf3Fund.period==='quarter'?' on':''}" onclick="pf3SetFundPeriod('quarter')">${T('Посл. квартал')}</button></span></div>
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
        ${pf3MyPort(v3Key)?`<div class="pf3-panel-hd" style="margin-top:18px"><span>${T('✏️ Моя позиция')}</span></div>
        <div class="pf3-edit">
          <label>${T('Кол-во акций')} <input type="number" step="any" min="0" value="${qty}" onchange="pf3Edit(6,this.value)"></label>
          <label>${T('Цена покупки')} (${ccy}) <input type="number" step="any" min="0" value="${buy}" onchange="pf3Edit(9,this.value)"></label>
        </div>`:''}
      </div>
    </section>
    <section class="pf3-panel">
      <div class="pf3-panel-hd"><span>${T('🛒 Уровни покупки / докупки')}</span><span class="pf3-asof">${T('по техданным · авто-обновление каждые 5 мин')}</span></div>
      ${pf3BuySection(r,h,price,ccy)}
    </section>
    ${simSection(tk,price,ccy)}`;
}
function pf3Edit(ci,v){const ri=pf3SelIdx(),n=parseFloat(v);pf3D().rows[ri][ci]=isNaN(n)?0:n;recalcPF(ri,v3Key);scheduleSave();renderPF3()}
function pf3SetYears(y){pf3State.years=y;renderPF3()}
// Цены + дневное изменение + SMA (обе серии) + поддержка/сопротивление для
// ОДНОЙ вкладки. Batched in chunks of 20 — the worker makes 2 Yahoo calls per
// symbol and Cloudflare caps subrequests; все чанки параллельно.
async function pf3FetchPrices(d,key){
  const syms=[...new Set(d.rows.map(r=>exSymbol(r[2],r[8])).filter(Boolean))];
  const chunks=[];
  for(let i=0;i<syms.length;i+=20)chunks.push(syms.slice(i,i+20).join(','));
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
    if(updated)pf3LastRefresh=Date.now();
    try{await pf3RefreshTargets(d)}catch(e){}   // аналит. таргеты — раз в сутки, тем же батч-паттерном
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
  if(_cardPxAt[sym]&&Date.now()-_cardPxAt[sym]<120000)return;
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
let pf3Timer=null,pf3LastRefresh=0;
const PF3_REFRESH_MS=5*60*1000;
function pf3EnsureAutoRefresh(){
  if(!pf3Timer)pf3Timer=setInterval(()=>{if(isV3())pf3Refresh(true)},PF3_REFRESH_MS);
  if(Date.now()-pf3LastRefresh>PF3_REFRESH_MS)pf3Refresh(true);
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

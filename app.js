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
           hiddenCols:hiddenCols, smaTf:SMA_TF, sim:SIM, pfTrades:PF_TRADES, aiChat:AI_CHAT, aiPrefs:AI_PREFS, tgAlerts:TG_ALERTS, tabGroups:TAB_GROUPS, tabOrder:TAB_ORDER, aiPort:AI_PORT, aiPortBak:AI_PORT_BAK, stockAiLog:STOCK_AI_LOG, insider:INSIDER, tgMeta:TG_META, val:VAL, tgFull:TG_FULL, aiReco:AI_RECO, aiSpend:AI_SPEND, aiDash:AI_DASH, layout:LAYOUT, aiPlaybook:AI_PLAYBOOK, aiPlaybookSeedV:AI_PLAYBOOK_SEEDV, planRules:PLAN_RULES, scnAlerts:SCN_ALERT_STATE, news:NEWS_TEXT, newsImpact:NEWS_IMPACT, aiInclChat:AI_INCL_CHAT, cycleOvr:CYCLE_OVR };
}
// Call after any edit: debounce-push to the cloud.
// syncReady: НЕ пушим, пока облако не прочитано первым pullState — иначе ранние
// миграции/рендеры на старте (init до pullState) могли затереть облако пустыми
// локальными данными (например, журналом сделок PF_TRADES).
let syncReady=false;
let stateRev=0;   // монотонная ревизия состояния: БД-триггер отклоняет запись с НЕ растущим rev (защита от затирания устаревшим клиентом)
function scheduleSave(){ if(currentUser && !applyingRemote && syncReady) schedulePush(); }
function schedulePush(){ clearTimeout(pushTimer); pushTimer=setTimeout(pushState, 800); }

async function pushState(){
  if(!currentUser) return;
  // 🤖 aiPort: торговым состоянием (позиции/кэш/журнал) владеет worker. Перед
  // записью берём его СЕРВЕРНУЮ копию — наша могла отстать, если realtime-канал
  // спал (сон ноутбука, фоновая вкладка), и тогда push стирал сделки AI.
  // За клиентом остаются только настройки.
  let aiPortReadOk=false;
  try{
    const { data:rw } = await sb.from('ledger_state').select('aiPort:data->aiPort').eq('user_id',currentUser.id).maybeSingle();
    aiPortReadOk=true;   // чтение прошло (даже если на сервере пусто)
    const srv = rw && rw.aiPort;
    if(srv && typeof srv==='object' && srv.startedAt){
      const mine = AI_PORT || {};
      AI_PORT = { ...srv };
      ['strategy','intervalMin','commissionPct','minTradeSEK','enabled','startCapital','startedAt','myStartEquity','myStartLive']
        .forEach(k=>{ if(mine[k]!==undefined) AI_PORT[k]=mine[k]; });
    }
  }catch(e){ aiPortReadOk=false; }
  // 🛡 fail-closed: не смогли перечитать серверный aiPort — НЕ перезаписываем торговое состояние
  // воркера устаревшей копией (это и затирало сделки). Отложим пуш и попробуем снова.
  if(!aiPortReadOk && AI_PORT && AI_PORT.startedAt){ schedulePush(); return; }
  // 🛡 Защита истории сделок: перед записью перечитываем облако. Если наша
  // PF_TRADES пуста, а в облаке журнал есть — НЕ затираем (адаптируем облачную),
  // чтобы устаревшая вкладка/гонка не стёрла сделки. Та же логика, что для aiPort.
  try{
    if(!Array.isArray(PF_TRADES)||!PF_TRADES.length){
      const { data:rt } = await sb.from('ledger_state').select('pfTrades:data->pfTrades').eq('user_id',currentUser.id).maybeSingle();
      if(rt && Array.isArray(rt.pfTrades) && rt.pfTrades.length){ PF_TRADES=rt.pfTrades; }
    }
  }catch(e){}
  const ts=new Date().toISOString();
  lastPushTs=Date.parse(ts);   // remember so the realtime echo of this push can be ignored
  const snap=snapshotState();
  snap.rev=(stateRev||0)+1;    // растущая ревизия — БД-триггер отклонит устаревшую запись
  const { error } = await sb.from('ledger_state')
    .upsert({ user_id:currentUser.id, data:snap, updated_at:ts });
  if(error) console.warn('Sync push failed', error);
  else { stateRev=snap.rev; pfBackupSave(); }   // приняли — запоминаем rev + локальный бэкап
}
// 🛡 Локальный бэкап (localStorage) журнала сделок и позиций семейных портфелей —
// переживает обнуление облака устаревшим клиентом. Сохраняем только непустое.
function pfBackupKey(){ return currentUser?('dash_bak_'+currentUser.id):null; }
function pfBackupSave(){
  const k=pfBackupKey(); if(!k)return;
  try{
    const hasTrades=Array.isArray(PF_TRADES)&&PF_TRADES.length;
    const ports={};let hasPos=false;
    Object.keys(DATA).forEach(key=>{ if(!pf3MyPort(key))return; const d=DATA[key]; const pos=(d.rows||[]).some(r=>(parseFloat(r[6])||0)>0); if(pos)hasPos=true; ports[key]={rows:d.rows,cashFree:d.cashFree}; });
    if(!hasTrades&&!hasPos)return;   // нечего бэкапить — не затираем хороший бэкап пустым
    localStorage.setItem(k, JSON.stringify({at:Date.now(),pfTrades:PF_TRADES,ports}));
  }catch(e){}
}
function pfBackupRestore(){
  const k=pfBackupKey(); if(!k)return false;
  let bak=null; try{ bak=JSON.parse(localStorage.getItem(k)||'null'); }catch(e){}
  if(!bak)return false;
  // Триггер «обнуления»: в облаке журнал пуст, а в бэкапе он есть → восстановить
  // журнал И позиции семейных портфелей из последнего хорошего бэкапа.
  const cloudEmptyTrades=!Array.isArray(PF_TRADES)||!PF_TRADES.length;
  const bakHasTrades=Array.isArray(bak.pfTrades)&&bak.pfTrades.length;
  if(!(cloudEmptyTrades&&bakHasTrades))return false;
  PF_TRADES=bak.pfTrades.slice();
  if(bak.ports)Object.keys(bak.ports).forEach(key=>{ const d=DATA[key],b=bak.ports[key]; if(d&&b&&Array.isArray(b.rows)){ d.rows=b.rows; d.count=b.rows.length; if(b.cashFree!=null)d.cashFree=b.cashFree; } });
  return true;
}
async function pullState(){
  if(!currentUser) return;
  const { data, error } = await sb.from('ledger_state').select('data').eq('user_id',currentUser.id).maybeSingle();
  if(error){ console.warn('Sync pull failed', error); return; }
  syncReady=true;   // облако прочитано — с этого момента локальные правки можно безопасно пушить
  if(data && data.data && Object.keys(data.data).length) applyRemoteState(data.data);
  else pushState();   // first login: seed the cloud with the bundled data
  await loadSharedAnalysis();   // общие данные оценки/инсайдеров/AI-реко (админ собрал → все видят)
  subSharedAnalysis();
}
// ── Общая аналитика (VAL/INSIDER/AI_RECO): админ собирает — все читают ──
// Данные по тикерам не персональны, поэтому живут в общей таблице shared_analysis
// (RLS: чтение всем, запись только админу). См. supabase-shared-analysis.sql.
async function loadSharedAnalysis(){
  if(!SYNC_ENABLED||!sb||!currentUser)return;
  try{
    const{data}=await sb.from('shared_analysis').select('val,insider,aireco,targets').eq('id','global').maybeSingle();
    if(!data)return;
    if(data.val&&typeof data.val==='object'&&Object.keys(data.val).length)VAL=data.val;
    if(data.insider&&typeof data.insider==='object'&&Object.keys(data.insider).length)INSIDER=data.insider;
    if(data.aireco&&typeof data.aireco==='object'&&Object.keys(data.aireco).length)AI_RECO=data.aireco;
    if(data.targets&&typeof data.targets==='object'&&Object.keys(data.targets).length)TG_FULL=data.targets;
    _valSecCache=null;   // пересчитать секторные медианы по общим данным
  }catch(e){}   // таблицы нет (до миграции) → молча
}
async function pushSharedAnalysis(){
  if(!SYNC_ENABLED||!sb||!isAdmin())return;
  try{ await sb.from('shared_analysis').upsert({id:'global',val:VAL,insider:INSIDER,aireco:AI_RECO,targets:TG_FULL,updated_at:new Date().toISOString()}); }catch(e){ console.warn('shared push failed',e); }
}
let _sharedSub=null;
function subSharedAnalysis(){
  if(!SYNC_ENABLED||!sb||_sharedSub)return;
  try{
    _sharedSub=sb.channel('shared_analysis').on('postgres_changes',{event:'*',schema:'public',table:'shared_analysis'},payload=>{
      const n=payload&&payload.new; if(!n)return;
      if(n.val&&typeof n.val==='object')VAL=n.val;
      if(n.insider&&typeof n.insider==='object')INSIDER=n.insider;
      if(n.aireco&&typeof n.aireco==='object')AI_RECO=n.aireco;
      if(n.targets&&typeof n.targets==='object')TG_FULL=n.targets;
      _valSecCache=null; if(typeof renderAll==='function')renderAll();
    }).subscribe();
  }catch(e){}
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
  if(Array.isArray(s.pfTrades)) PF_TRADES=s.pfTrades;
  if(Array.isArray(s.planRules)) PLAN_RULES=s.planRules;
  if(s.scnAlerts&&typeof s.scnAlerts==='object') SCN_ALERT_STATE=s.scnAlerts;
  if(Array.isArray(s.aiChat)) AI_CHAT=s.aiChat;
  AI_PREFS=[];   // 🤖 автономия: личные правила инвестора отменены — не восстанавливаем из снапшота
  if(typeof s.aiInclChat==='boolean') AI_INCL_CHAT=s.aiInclChat;
  if(typeof s.news==='string') NEWS_TEXT=s.news;
  if(s.newsImpact&&typeof s.newsImpact==='object') NEWS_IMPACT=s.newsImpact;
  if(Array.isArray(s.aiPlaybook)){ AI_PLAYBOOK=s.aiPlaybook; AI_PLAYBOOK_SEEDV=(typeof s.aiPlaybookSeedV==='number')?s.aiPlaybookSeedV:0; }   // нет флага = старый плейбук → миграция допишет v2
  if(s.tgAlerts&&typeof s.tgAlerts==='object') TG_ALERTS=s.tgAlerts;
  if(s.aiPort&&typeof s.aiPort==='object') AI_PORT=s.aiPort;
  if(s.aiPortBak&&typeof s.aiPortBak==='object') AI_PORT_BAK=s.aiPortBak;
  if(Array.isArray(s.stockAiLog)) STOCK_AI_LOG=s.stockAiLog;
  if(s.insider&&typeof s.insider==='object') INSIDER=s.insider;
  if(s.tgMeta&&typeof s.tgMeta==='object') TG_META=s.tgMeta;
  if(s.val&&typeof s.val==='object') VAL=s.val;
  if(s.tgFull&&typeof s.tgFull==='object') TG_FULL=s.tgFull;
  if(s.aiReco&&typeof s.aiReco==='object') AI_RECO=s.aiReco;
  if(s.cycleOvr&&typeof s.cycleOvr==='object') CYCLE_OVR=s.cycleOvr;
  if(s.aiSpend&&typeof s.aiSpend==='object') AI_SPEND=Object.assign({usd:0,runs:0,in:0,out:0,searches:0},s.aiSpend);
  if(s.aiDash&&typeof s.aiDash==='object') AI_DASH=(s.aiDash.cards||s.aiDash.headline)?{[PF3_KEY]:s.aiDash}:s.aiDash;   // миграция старого одиночного дашборда в карту по портфелям
  if(Array.isArray(s.tabGroups)) TAB_GROUPS=s.tabGroups;
  if(Array.isArray(s.tabOrder)) TAB_ORDER=s.tabOrder;
  if(s.layout&&typeof s.layout==='object') LAYOUT=Object.assign({sub:{},cards:[],home:[],dash:[]},s.layout);
  if(typeof s.apiKey==='string') finnhubKey=s.apiKey;
  if(typeof s.rev==='number') stateRev=s.rev;   // приняли облачную ревизию → наш след. push = rev+1
  if(s.theme) applyTheme(s.theme);
  applyingRemote=false;
  // 🛡 Если облако пришло с пустым журналом сделок, а локальный бэкап его помнит —
  // значит состояние затёрли (устаревшая вкладка/гонка). Восстанавливаем и пушим.
  if(pfBackupRestore()){
    toast(RT('Восстановлены сделки и позиции из локальной копии (облако было обнулено)','Restored trades & positions from local backup (cloud was wiped)'),true);
    scheduleSave();
  }
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
  // RBAC: функциональные права текущего пользователя (колонки role_id/overrides).
  // До миграции supabase-rbac.sql колонок нет → select упадёт, остаются дефолты (≈ editor).
  ACCESS={roleId:null,overrides:{}};
  try{
    const{data:acc}=await sb.from('user_access').select('role_id,overrides').eq('user_id',currentUser.id).maybeSingle();
    if(acc){ ACCESS.roleId=acc.role_id||null; if(acc.overrides&&typeof acc.overrides==='object')ACCESS.overrides=acc.overrides; }
  }catch(e){}
  const st=document.getElementById('settingsBtn'); if(st)st.style.display=can('action.manage_users')?'':'none';
  const eb=document.getElementById('editBtn'); if(eb)eb.style.display=userRole==='admin'?'':'none';
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
  await sb.auth.signOut(); currentUser=null; syncReady=false;
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
  maybeOnboard();   // приветствие при первом входе (один раз, флаг в localStorage)
}
// 👋 Онбординг новичка: одноразовое приветствие с картой возможностей. Флаг dash_onboarded.
function onbDone(){try{localStorage.setItem('dash_onboarded','1')}catch(e){}document.getElementById('onbOverlay')?.classList.add('hidden');}
function onbShow(){const ov=document.getElementById('onbOverlay');if(!ov)return;const c=document.getElementById('onbCard');if(c)c.innerHTML=onbHTML();ov.classList.remove('hidden');}
function maybeOnboard(){let seen;try{seen=localStorage.getItem('dash_onboarded')}catch(e){}if(!seen)onbShow();}
function onbHTML(){
  const row=(ic,ru,en)=>`<div class="onb-row"><span class="onb-ic">${ic}</span><span>${RT(ru,en)}</span></div>`;
  return `<button class="faq-close" onclick="onbDone()" aria-label="${RT('Закрыть','Close')}">✕</button>
    <h2>👋 ${RT('Добро пожаловать','Welcome')}</h2>
    <div class="faq-sub">${RT('Это аналитический дашборд портфеля: индексы, ваши портфели и AI-разбор бумаг.','An analytical portfolio dashboard: indices, your portfolios and AI stock analysis.')}</div>
    <div class="onb-list">
      ${row('🗂','Вкладки сверху — индексы (Nasdaq, OMXS30…) и ваши портфели. 🏠 Home — сводка рынка и барометр.','Tabs on top — indices (Nasdaq, OMXS30…) and your portfolios. 🏠 Home — market overview & barometer.')}
      ${row('📋','Клик по строке/бумаге открывает карточку: цена, уровни, фундаментал, тезис-монитор.','Click a row/stock to open its card: price, levels, fundamentals, thesis monitor.')}
      ${row('🤖','В карточке — AI-анализ и AI-рекомендация (Claude + веб-поиск свежих новостей).','In the card — AI analysis & AI recommendation (Claude + web search of fresh news).')}
      ${row('🔄','«Цены» подтягивают живые котировки и технические уровни (Yahoo).','“Prices” pulls live quotes and technical levels (Yahoo).')}
      ${row('❓','Кнопка «?» в шапке и значки «!» рядом с разделами объясняют все обозначения.','The “?” button in the header and “!” icons next to sections explain every label.')}
    </div>
    <div class="onb-note">${RT('Справочная аналитика, не индивидуальная инвестиционная рекомендация.','Reference analytics, not individual investment advice.')}</div>
    <button class="primary onb-ok" onclick="onbDone()">${RT('Понятно, начать','Got it, start')}</button>`;
}
async function boot(){
  initTheme();
  init();                         // paint with bundled data first
  if(!SYNC_ENABLED){ refreshFX(); maybeOnboard(); return; }
  const { data:{ session } } = await sb.auth.getSession();
  if(session){ currentUser=session.user; await startApp(); }
  else { document.getElementById('authOverlay').classList.remove('hidden'); }
}
const META={'OMXS30':'🇸🇪','Nasdaq 100':'🇺🇸','OMXSPI':'🇸🇪','S&P 500':'🇺🇸','DAX 40':'🇩🇪','CAC 40':'🇫🇷','FTSE MIB':'🇮🇹','OBX 25':'🇳🇴',};
let FX={SEK:1,EUR:10.59,USD:8.93,NOK:0.9375,DKK:1.52,CAD:7.0,GBP:12.6,AUD:6.2};
let _fxAt=0;   // когда курсы FX последний раз обновлены живьём в этой сессии (0 = дефолт/из снапшота, свежесть не подтверждена)
// Бумажный (тестовый) портфель: [{tab,tk,name,ccy,qty,buy,date}] — у каждой
// v3-вкладки свои тестовые покупки (tab), синхронизируется с остальным состоянием.
let SIM=[];
// 📜 Журнал реальных сделок по портфелям: [{id,tab,tk,name,ccy,act:'buy'|'sell',
// qty,price,plNative,date}] — plNative = реализованный P&L в валюте бумаги (для продаж).
let PF_TRADES=[];
let PLAN_RULES=[];   // 🎯 правила-триггеры плана действий (уровень/дедлайн → уведомление)
let SCN_ALERT_STATE={};   // 📊 Блок D: последнее наблюдаемое состояние сценариев по тикеру (дедуп алертов)
// Кулдауны Telegram-алертов: пишет worker, клиент только прокидывает через
// свои сохранения, чтобы push дашборда не стирал память бота.
let TG_ALERTS={};
// AI Proto: диалог с ассистентом и его «память» — правила инвестора,
// которые ассистент извлекает из чата (и которые можно добавить вручную).
// Правила передаются и в чат, и в полный анализ портфеля (investorRules).
let AI_CHAT=[],AI_PREFS=[],aiChatBusy=false;
let AI_INCL_CHAT=false;   // 💬 включать последние сообщения чата в следующий анализ портфеля
function aiToggleInclChat(){AI_INCL_CHAT=!AI_INCL_CHAT;scheduleSave();renderPF3();}
let NEWS_TEXT='';   // 📰 вставленная сводка новостей (sync)
let NEWS_IMPACT={};   // 📰 детерминированная оценка влияния по тикеру (sync): {impact,score,hits,name,sector}
// Двуязычный лексикон тональности для бесплатного новостного анализа.
const NEWS_POS=['рост','раст','выросл','рекорд','прибыл','превзош','повыш','контракт','одобр','сделк','партнёрств','выкуп','байбэк','байбек','дивиденд','сильн','ускор','запуск','расшир','beat','surge','soar','record','upgrade','raise','raised','approval','approved','contract','partnership','buyback','strong','rally','jump','gain','tops','profit','expansion','wins','outperform','boost','demand'];
const NEWS_NEG=['паден','падает','упал','сниж','убыток','штраф','расследован','санкц','иск','банкрот','сокращ','увольн','отзыв','дефолт','рецесс','слаб','предупрежд','просад','обвал','miss','plunge','drop','fall','downgrade','cut','probe','lawsuit','fine','recall','bankruptcy','warning','slump','sink','weak','loss','decline','layoff','default','halt','delay','tariff','sell-off','selloff'];
function newsForAi(){ return (NEWS_TEXT&&NEWS_TEXT.trim())?NEWS_TEXT.trim().slice(0,8000):null; }
function newsPolarity(s){ const t=String(s).toLowerCase(); let p=0; NEWS_POS.forEach(w=>{if(t.indexOf(w)>=0)p++;}); NEWS_NEG.forEach(w=>{if(t.indexOf(w)>=0)p--;}); return p; }
// Чистый движок: текст + список акций → влияние по тикеру. Покрыт тестом.
function analyzeNews(text, stocks){
  const at=new Date().toISOString();
  if(!text||!String(text).trim()||!Array.isArray(stocks))return {byTicker:{},at,n:0,sents:0};
  const sents=String(text).split(/[.!?\n;•]+/).map(s=>s.trim()).filter(s=>s.length>3);
  const byTicker={};
  stocks.forEach(st=>{
    const tk=String(st.tk||'').trim().toUpperCase(); if(!tk)return;
    const reTk=new RegExp('(^|[^A-Z0-9.])'+tk.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^A-Z0-9]|$)','i');
    const nameWords=String(st.name||'').toLowerCase().split(/[^a-zа-я0-9]+/i).filter(w=>w.length>=4&&!['inc','corp','class','ltd','plc','group','holding','company'].includes(w));
    const hits=[];
    sents.forEach(s=>{
      const low=s.toLowerCase();
      const byTkM=reTk.test(s), byName=nameWords.length>0&&nameWords.some(w=>low.indexOf(w)>=0);
      if(byTkM||byName)hits.push({sent:s.slice(0,220),pol:newsPolarity(s),kind:byTkM?'ticker':'name'});
    });
    if(hits.length){
      const score=hits.reduce((a,h)=>a+h.pol,0);
      byTicker[tk]={impact:score>0?'bull':score<0?'bear':'neutral',score,hits,name:st.name,sector:st.sector};
    }
  });
  return {byTicker,at,n:Object.keys(byTicker).length,sents:sents.length};
}
// Акции текущей вкладки (для сопоставления с новостями).
function newsStocks(){
  const d=pf3D(); if(!d||!Array.isArray(d.rows))return [];
  return d.rows.map(r=>({tk:String(r[2]||'').toUpperCase(),name:r[1],sector:r[4],ccy:r[8]||'USD'})).filter(x=>x.tk);
}
function newsSetText(v){ NEWS_TEXT=v; }
function newsClear(){ NEWS_TEXT=''; NEWS_IMPACT={}; scheduleSave(); renderPF3(); }
// Бесплатный (без токенов) разбор вставленной сводки → влияние по бумагам.
function newsAnalyzeFree(){
  const text=(NEWS_TEXT||'').trim();
  if(!text){ toast(RT('Вставьте текст новостей','Paste the news text'),true); return; }
  const res=analyzeNews(text, newsStocks());
  NEWS_IMPACT=res.byTicker; scheduleSave(); renderPF3();
  toast('📰 '+RT(`Затронуто бумаг: ${res.n} (из ${res.sents} предложений)`,`Stocks affected: ${res.n} (of ${res.sents} sentences)`));
}
// Платная кнопка: прогон AI Proto со вставленной сводкой как контекстом (userNews).
function newsAnalyzePaid(){ scheduleSave(); if(typeof pf3AiRun==='function')pf3AiRun(); }
function newsImpactHTML(){
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const ents=Object.keys(NEWS_IMPACT||{}).map(tk=>({tk,...NEWS_IMPACT[tk]}));
  if(!ents.length)return '';
  const bull=ents.filter(e=>e.impact==='bull').sort((a,b)=>b.score-a.score);
  const bear=ents.filter(e=>e.impact==='bear').sort((a,b)=>a.score-b.score);
  const neu=ents.filter(e=>e.impact==='neutral');
  const row=e=>{
    const ico=e.impact==='bull'?'📈':e.impact==='bear'?'📉':'⚪', cls=e.impact==='bull'?'pf3-up':e.impact==='bear'?'pf3-down':'val-mid';
    const snip=(e.hits&&e.hits[0])?esc(e.hits[0].sent):'';
    const reco=e.impact==='bull'?RT('позитив — держать/докупать у уровня','positive — hold/add at a level'):e.impact==='bear'?RT('негатив — проверить риск/сокращение','negative — check risk/trim'):RT('упоминается, тон нейтральный','mentioned, neutral tone');
    return`<div class="news-row" onclick="insiderOpenCard('${e.tk}')">
      <span class="news-imp ${cls}">${ico} ${e.score>0?'+':''}${e.score}</span>
      <div class="news-main"><b>${esc(e.name||e.tk)}</b> <span class="news-tk">${e.tk}</span> <span class="news-reco">${reco}</span>${snip?`<div class="news-snip">«${snip}»</div>`:''}</div>
    </div>`;
  };
  const grp=(h,arr)=>arr.length?`<div class="news-grp"><div class="news-grp-h">${h} (${arr.length})</div>${arr.map(row).join('')}</div>`:'';
  return`<div class="news-res">${grp('📈 '+RT('Позитив','Bullish'),bull)}${grp('📉 '+RT('Негатив','Bearish'),bear)}${grp('⚪ '+RT('Нейтрально','Neutral'),neu)}</div>`;
}
let AI_PORT=null,AI_PORT_BAK=null;   // 🤖 AI Портфель: состояние + резерв worker'а (round-trip)
let STOCK_AI_LOG=[];   // обучающая база: разборы акций {ticker,ts,price,ccy,verdict,target,horizon,text,data}

// 📚 Инвест-плейбук: курируемая методичка «как обгонять индекс». Редактируется
// инвестором, синхронизируется (aiPlaybook) и передаётся во все анализы AI Proto.
const PLAYBOOK_GOAL_OLD='Цель — риск-скорректированное опережение индекса (OMXS30/Nasdaq 100/S&P 500), а не максимальная доходность любой ценой.';
const PLAYBOOK_GOAL='Цель — опережать ВСЕ эталонные индексы (OMXS30/Nasdaq 100/S&P 500) и МАКСИМИЗИРОВАТЬ рост капитала во всех портфелях; риск-менеджмент — инструмент устойчивого роста, а не потолок амбиций.';
const DEFAULT_PLAYBOOK=[
  PLAYBOOK_GOAL,
  'Победителям давай расти; не режь сильные прибыльные позиции ради ребаланса — недовес закрывай кэшем и новыми идеями.',
  'Перевешивай качество: высокий и стабильный ROE/ROIC, низкий долг, растущие выручка и маржа, устойчивое конкурентное преимущество (moat).',
  'Комбинируй факторы: качество + моментум (цена выше SMA 200, здоровый тренд) исторически обгоняют «дёшево, но падает».',
  'Дисциплина входа: добавляй у поддержки/SMA, а не на вершине у сопротивления; усредняйся вверх по тренду, а не вниз по падающему ножу.',
  'Дисциплина оценки: цена сильно выше таргета/мультипликаторов + перегрев по технике — повод фиксировать часть, а не наращивать.',
  'Сайзинг по убеждённости и риску; одна идея не должна решать судьбу портфеля — контролируй концентрацию.',
  'Режь убытки быстро, давай прибыли течь: ломается тезис/тренд — сокращай; работает — держи.',
  'Кэш — это позиция: держи резерв для просадок и лучших точек входа; не торгуй ради торговли.',
  'Избегай типовых ошибок: погоня за хайпом, усреднение убытка без нового тезиса, переторговля, продажа победителей и удержание проигравших (disposition effect).',
  'Опережение чаще даёт перевес 1–2 сильных тем/секторов и избегание явных проигравших, а не попытка переиграть всё.',
  'Учитывай издержки и налоги: лишние сделки съедают альфу — меняй портфель, когда ожидаемая выгода превышает трение.',
  'Сверяйся с трек-рекордом: усиливай подходы, которые сбывались; пересматривай те, что нет.',
  'Диверсификация — для снижения риска, а не самоцель; обычно 15–25 качественных имён достаточно.',
  // v2 (из обсуждения «обучения AI» 2026-06): альфа, бенчмарк-веса, обучение на результатах.
  'Меряй успех АЛЬФОЙ к индексу (доходность минус бенчмарк за тот же период), а не абсолютной доходностью; следи за трендом альфы и усиливай то, что её повышает.',
  'Сравнивай веса портфеля с составом эталонного индекса по секторам: осознанный перевес в 1–2 сильных темах и отсутствие явных проигравших — главный источник опережения.',
  'Учись на собственном трек-рекорде по типам вердиктов: где сбывалось и давало альфу — закрепляй; где системно ошибался (рано фиксировал рост, держал проигравших) — меняй подход.',
  'Недовес сектора/гео закрывай в первую очередь свободным кэшем, новыми идеями и ротацией из слабых бумаг, а не продажей работающих позиций.',
];
// Принципы, добавленные в v2 — дописываются к уже синхронизированному плейбуку один раз.
const PLAYBOOK_V2_ADD=DEFAULT_PLAYBOOK.slice(-4);
// v3 (2026-06): автономный AI Proto, цель — обогнать ВСЕ индексы и максимизировать прибыль.
const PLAYBOOK_V3_ADD=[
  'Концентрируйся в лучших идеях: позициям высокой убеждённости давай вес; широкая диверсификация ради диверсификации размывает альфу — 12–20 сильных имён обычно достаточно.',
  'Лови структурные тренды (ИИ-инфраструктура, энергетика/электрификация, реиндустриализация, оборона): сильный попутный ветер сектора усиливает отдельные имена.',
  'Покупай силу: добавляй к лидерам, подтверждающим тренд новыми максимумами на растущем объёме; не жди идеальной цены входа в сильную историю.',
  'Ищи асимметрию: идеи с потенциалом ×2–×5 при ограниченном риске на позицию; несколько таких перекрывают много мелких ошибок.',
  'Свежие данные решают: перед каждым советом подтягивай последние новости, отчёты и пересмотры таргетов — действуй по актуальной картине, а не устаревшей.',
  'Ребалансируй из слабых в сильные, не наоборот; продавай тезисно (сломался драйвер), а не механически по весу — победителей не режь.',
  'Быстро признавай ошибку: ломается тезис — выходи без привязки к цене входа, освобождая капитал под лучшие идеи.',
  'Действуй проактивно и решительно: давай конкретные советы (что купить/добавить/сократить и почему), а не обтекаемые формулировки — цель измеряется ростом капитала и альфой.',
];
const PLAYBOOK_SEED_V=3;
let AI_PLAYBOOK=[],AI_PLAYBOOK_SEEDV=0;
function aiPlaybookEnsure(){
  if(!Array.isArray(AI_PLAYBOOK))AI_PLAYBOOK=[];
  if(!AI_PLAYBOOK.length){ AI_PLAYBOOK=DEFAULT_PLAYBOOK.slice(); }
  else if(AI_PLAYBOOK_SEEDV<PLAYBOOK_SEED_V){
    // Обновляем цель на новую (автономия + максимизация) и дописываем новые принципы один раз.
    const gi=AI_PLAYBOOK.indexOf(PLAYBOOK_GOAL_OLD); if(gi>=0)AI_PLAYBOOK[gi]=PLAYBOOK_GOAL;
    if(AI_PLAYBOOK_SEEDV<2)PLAYBOOK_V2_ADD.forEach(p=>{ if(!AI_PLAYBOOK.includes(p))AI_PLAYBOOK.push(p); });
    PLAYBOOK_V3_ADD.forEach(p=>{ if(!AI_PLAYBOOK.includes(p))AI_PLAYBOOK.push(p); });
  }
  if(AI_PLAYBOOK_SEEDV<PLAYBOOK_SEED_V){ AI_PLAYBOOK_SEEDV=PLAYBOOK_SEED_V; if(!applyingRemote)scheduleSave(); }
  return AI_PLAYBOOK;
}

// 📈 История индексов-бенчмарков (дневные закрытия) — для расчёта АЛЬФЫ трек-рекорда.
let IDX_HIST={},_idxHistLoading=false;
const AI_BENCH_SYM={USD:'^NDX',SEK:'^OMX'};   // бенчмарк по торговой валюте бумаги
async function aiLoadIdxHist(){
  await Promise.all(['^OMX','^NDX'].map(async sym=>{
    const cur=IDX_HIST[sym];if(cur&&cur._at&&Date.now()-cur._at<6*3600e3)return;   // кэш 6ч
    try{
      const j=await fetch(PRICE_PROXY+'?history='+encodeURIComponent(sym)+'&range=1y').then(r=>r.json());
      if(j&&Array.isArray(j.t)&&Array.isArray(j.c)){
        const m={_at:Date.now(),_last:null};
        for(let i=0;i<j.t.length;i++){const c=j.c[i];if(c==null)continue;m[new Date(j.t[i]*1000).toISOString().slice(0,10)]=c;m._last=c}
        IDX_HIST[sym]=m;
      }
    }catch(e){}
  }));
}
function aiEnsureIdxHist(){ if(_idxHistLoading||(IDX_HIST['^OMX']&&IDX_HIST['^NDX']))return; _idxHistLoading=true; aiLoadIdxHist().then(()=>{_idxHistLoading=false;if(isV3()&&pf3Tab==='ai')renderPF3()}); }
function idxCloseOn(sym,dateStr){
  const m=IDX_HIST[sym];if(!m||!dateStr)return null;let d=dateStr;
  for(let k=0;k<7;k++){if(m[d]!=null)return m[d];const dt=new Date(d+'T00:00:00Z');dt.setUTCDate(dt.getUTCDate()-1);d=dt.toISOString().slice(0,10)}
  return null;
}

// 🎯 Трек-рекорд прошлых разборов: сбывались ли вердикты (направление цены) И
// АЛЬФА к индексу (бумага минус бенчмарк за тот же период, если история загружена).
function aiTrackRecord(){
  const log=Array.isArray(STOCK_AI_LOG)?STOCK_AI_LOG:[];
  if(!log.length)return null;
  const px={};
  v3Tabs().forEach(k=>{const d=DATA[k];if(!d||!Array.isArray(d.rows))return;d.rows.forEach(r=>{const tk=String(r[2]||'').toUpperCase();const p=parseFloat(r[7]);if(tk&&isFinite(p)&&p>0&&px[tk]==null)px[tk]=p})});
  const mk=()=>({n:0,hit:0,sum:0,aN:0,aHit:0,aSum:0});
  const agg={buy:mk(),wait:mk(),sell:mk(),avoid:mk()},recent=[];
  log.slice(0,80).forEach(e=>{
    const tk=String(e.ticker||'').toUpperCase(),rec=parseFloat(e.price),cur=px[tk],v=String(e.verdict||'').toLowerCase(),date=String(e.ts||'').slice(0,10);
    if(!tk||!isFinite(rec)||rec<=0||!isFinite(cur)||!agg[v])return;
    const ret=(cur/rec-1)*100,good=(v==='buy'||v==='wait')?ret>0:ret<0,a=agg[v];
    a.n++;a.sum+=ret;if(good)a.hit++;
    let alpha=null;const bm=AI_BENCH_SYM[String(e.ccy||'').toUpperCase()];
    if(bm){const i0=idxCloseOn(bm,date),i1=IDX_HIST[bm]&&IDX_HIST[bm]._last;if(i0>0&&i1>0){alpha=Math.round((ret-(i1/i0-1)*100)*10)/10;const ag=(v==='buy'||v==='wait')?alpha>0:alpha<0;a.aN++;a.aSum+=alpha;if(ag)a.aHit++;}}
    if(recent.length<12)recent.push({ticker:tk,verdict:v,date,retPct:Math.round(ret*10)/10,alphaPct:alpha,good});
  });
  const byVerdict={};let total=0,hits=0,aTotal=0,aHits=0,aSum=0;
  Object.entries(agg).forEach(([v,a])=>{if(a.n){const o={n:a.n,hitRate:Math.round(a.hit/a.n*100),avgRetPct:Math.round(a.sum/a.n*10)/10};if(a.aN){o.alphaHitRate=Math.round(a.aHit/a.aN*100);o.avgAlphaPct=Math.round(a.aSum/a.aN*10)/10;aTotal+=a.aN;aHits+=a.aHit;aSum+=a.aSum}byVerdict[v]=o;total+=a.n;hits+=a.hit}});
  if(!total)return null;
  const out={note:'успех=направление цены совпало с вердиктом; alpha=доходность бумаги минус индекс (^NDX для USD, ^OMX для SEK) за тот же период',overallHitRate:Math.round(hits/total*100),samples:total,byVerdict,recent};
  if(aTotal){out.overallAlphaHitRate=Math.round(aHits/aTotal*100);out.avgAlphaPct=Math.round(aSum/aTotal*10)/10;out.alphaSamples=aTotal}
  return out;
}

// 🆚 Состав бенчмарков по секторам (доля по числу бумаг) — чтобы AI видел недовес.
function aiBenchmarks(){
  return ['OMXS30','Nasdaq 100','S&P 500'].filter(k=>DATA[k]&&Array.isArray(DATA[k].rows)&&DATA[k].rows.length).map(k=>{
    const sec={};let n=0;
    DATA[k].rows.forEach(r=>{const s=String(r[4]||'').trim();if(!s||s==='—')return;sec[s]=(sec[s]||0)+1;n++});
    const sectors=Object.entries(sec).map(([s,c])=>({sector:s,pct:n?Math.round(c/n*1000)/10:0})).sort((a,b)=>b.pct-a.pct).slice(0,8);
    return{index:k,basis:'доля по числу бумаг (не по капитализации)',sectors};
  });
}
let INSIDER={};   // 🕵 инсайдерские сводки по тикеру (sync): {at,buyShares,buyUSD,sellShares,sellUSD,netUSD,cluster,tx,notified}
let TG_META={};   // 🎯 мета аналит-таргета по тикеру (sync): {n,nr,span('q'|'m'),src('fmp'|'yahoo'),at}
let VAL={};   // 📐 Valuation Check по тикеру (sync): {pe,fwdPe,ps,evEbitda,peg,sector,hist:{pe3,pe5,ps3,ps5,ev3,ev5},name,ccy,at,notified}
let TG_FULL={};   // 🎯 A.1 агрегированные таргеты по тикеру (общие): {consensus,high,low,count,lastDate,ratings,changes,span,at}
let valPeMode='fwd';   // 📐 карточка оценки: forward | trailing(ttm) для P/E
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
  _fxAt=Date.now();                                  // отметка живого обновления — для честной подписи о свежести
  if(DATA[PF3_KEY])recalcAllPF(PF3_KEY);
  if(isV3())renderPF3();
  scheduleSave();                                    // persist live rates so the cloud + Telegram worker see them
}
// Свежесть FX для подписи к курсам. Пусто, если в этой сессии живого обновления ещё не было
// (курсы из снапшота/дефолта) — чтобы не утверждать «живые», когда это не подтверждено.
function fxFreshLbl(){
  if(!_fxAt)return '';
  const min=Math.round((Date.now()-_fxAt)/60000);
  return min<1?RT(' · обновлено только что',' · updated just now'):` · ${RT('обновлено','updated')} ${min} ${RT('мин назад','min ago')}`;
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
const SIM_KEY='🧪 Симуляция';      // virtual tab: все тестовые позиции (SIM) со всех вкладок вместе
const SECT_KEY='🔄 Сектора';        // virtual tab (admin): Live Sector Tracker (ротация GICS-секторов)
const pf3IsPort=k=>k===PF3_KEY||k===AIP_KEY||!!(DATA[k]&&DATA[k].port==='1');   // вкладки с экономикой позиций
const pf3MyPort=k=>pf3IsPort(k)&&k!==AIP_KEY;   // редактируемые портфели (мои/семейные, не AI)
const OMX_IDX='OMXS30';
// Все v3-вкладки: портфель + любые вкладки с флагом v3 (индексы и созданные пользователем).
const v3Tabs=()=>[PF3_KEY,...Object.keys(DATA).filter(k=>k!==PF3_KEY&&k!==AIP_KEY&&DATA[k]&&DATA[k].v3==='1')];
// Группы вкладок: по умолчанию по странам; пользовательская раскладка хранится в TAB_GROUPS (sync).
let TAB_GROUPS=null;
let TAB_ORDER=[];   // порядок негруппированных вкладок (drag-and-drop), синхронизируется

// ===== Конструктор раскладки («✏️ Редактор») =====
// Единый режим перетаскивания: саб-вкладки, карточки сводки, виджеты HOME и
// карточки AI-Dashboard. Порядок хранится в LAYOUT и синхронизируется через
// ledger_state (вкладки/группы уже двигаются через TAB_ORDER/TAB_GROUPS).
let editMode=false;
let LAYOUT={ sub:{}, cards:[], home:[], dash:[] };
function editLayout(){ if(!LAYOUT||typeof LAYOUT!=='object')LAYOUT={sub:{},cards:[],home:[],dash:[]}; if(!LAYOUT.sub)LAYOUT.sub={}; ['cards','home','dash'].forEach(k=>{if(!Array.isArray(LAYOUT[k]))LAYOUT[k]=[]}); return LAYOUT; }
// Сохранённый порядок для области (scope: 'cards' | 'home' | 'dash' | 'sub:<tab>').
function eord(scope){ const L=editLayout(); if(scope.startsWith('sub:'))return Array.isArray(L.sub[scope.slice(4)])?L.sub[scope.slice(4)]:[]; return Array.isArray(L[scope])?L[scope]:[]; }
function eset(scope,ids){ const L=editLayout(); if(scope.startsWith('sub:'))L.sub[scope.slice(4)]=ids; else L[scope]=ids; scheduleSave(); }
// Переставить массив элементов {id,...} по сохранённому порядку; новые id — в конец.
function eapply(scope,items){ const saved=eord(scope),by=new Map(items.map(it=>[String(it.id),it])),out=[]; saved.forEach(id=>{const it=by.get(String(id));if(it){out.push(it);by.delete(String(id))}}); items.forEach(it=>{if(by.has(String(it.id))){out.push(it);by.delete(String(it.id))}}); return out; }
// Обернуть массив {id,html} в перетаскиваемый контейнер (для строковых билдеров).
function erow(scope,items,cls){ return `<div class="edit-rows ${cls||''}" data-edit-row="${scope}">${eapply(scope,items).map(it=>`<div class="edit-cell" data-eid="${String(it.id).replace(/"/g,'&quot;')}">${it.html}</div>`).join('')}</div>`; }
function toggleEdit(){ editMode=!editMode; document.body.classList.toggle('edit-on',editMode); const b=document.getElementById('editBtn'); if(b)b.classList.toggle('active',editMode); const bar=document.getElementById('editBar'); if(bar){ bar.classList.toggle('hidden',!editMode); if(editMode)bar.innerHTML=`✏️ <b>${RT('Режим редактора','Edit mode')}</b> — ${RT('тяните вкладки, саб-вкладки, карточки и блоки','drag tabs, sub-tabs, cards and blocks')} <button class="edit-reset" onclick="editReset()">↺ ${RT('Сбросить раскладку','Reset layout')}</button>`; } renderAll(); }
function editReset(){ if(!confirm(RT('Сбросить раскладку блоков к стандартной?','Reset block layout to default?')))return; LAYOUT={sub:{},cards:[],home:[],dash:[]}; scheduleSave(); renderAll(); }
let _eWire=null,_eDrag=null;
function editScheduleWire(){ clearTimeout(_eWire); _eWire=setTimeout(editWireAll,0); }
function editWireAll(){
  document.querySelectorAll('[data-edit-row]').forEach(c=>{
    const scope=c.dataset.editRow, horiz=(scope==='cards'||scope==='dash'||scope.startsWith('sub:'));
    [...c.children].forEach(ch=>{
      if(!ch.dataset||ch.dataset.eid==null)return;
      ch.draggable=!!editMode;
      ch.classList.toggle('edit-item',!!editMode);
      if(!editMode){ ch.ondragstart=ch.ondragend=ch.ondragover=null; return; }
      ch.ondragstart=e=>{ _eDrag=c; ch.classList.add('edit-drag'); try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',ch.dataset.eid)}catch(_){ } e.stopPropagation(); };
      ch.ondragend=()=>{ ch.classList.remove('edit-drag'); editSaveRow(c); _eDrag=null; };
      ch.ondragover=e=>{ if(_eDrag!==c)return; e.preventDefault(); const drag=c.querySelector('.edit-drag'); if(!drag||drag===ch)return; const r=ch.getBoundingClientRect(); const before=horiz?(e.clientX<r.left+r.width/2):(e.clientY<r.top+r.height/2); c.insertBefore(drag, before?ch:ch.nextSibling); };
    });
  });
}
function editSaveRow(c){ const scope=c.dataset.editRow; const ids=[...c.children].filter(ch=>ch.dataset&&ch.dataset.eid!=null).map(ch=>ch.dataset.eid); eset(scope,ids); }
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
  // Присвоить вкладке значок группы (флаг страны) — ведущий эмодзи имени группы.
  if(DATA[drag]){const ico=(gName.match(/^\S+/)||[''])[0];if(ico&&/[^\x00-\x7F]/.test(ico))DATA[drag].icon=ico;}
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
const isV3=()=>v3Tabs().includes(curIdx)||curIdx===HOME_KEY||curIdx===DUP_KEY||curIdx===AIP_KEY||curIdx===STK_KEY||curIdx===AIDASH_KEY||curIdx===SIM_KEY||curIdx===SECT_KEY;
// ===== i18n: RU (база) / EN. T() переводит по словарю; непереведённые строки
// остаются как есть. Переключатель — кнопка RU/EN в шапке, выбор на устройстве.
let LANG='ru';
const T=x=>(LANG==='en'&&I18N_EN[x])||x;
const TAB_LABEL=k=>{const d=typeof DATA!=='undefined'&&DATA[k];return(d&&d.title)?d.title:(k===PF3_KEY?T('Портфель'):T(k))};
const RT=(ru,en)=>LANG==='en'?en:ru;   // для строк с подстановками
// ===== RBAC: функциональный слой прав (вкладки/действия/данные) =====
// Каталог управляемых пермишенов (раздел 3 ТЗ). Определён после RT (использует его).
const RBAC_PERMS=[
  {g:RT('Вкладки','Tabs'),items:[['view.portfolio',RT('Портфель','Portfolio')],['view.sectors',RT('Сектора','Sectors')],['view.type',RT('Тип','Type')],['view.diversification',RT('Диверсификация','Diversification')],['view.forecast',RT('Прогноз','Forecast')],['view.plan',RT('План','Plan')],['view.trades',RT('Сделки','Trades')],['view.dividends',RT('Дивиденды','Dividends')],['view.health',RT('Состояние портфеля','Health')],['view.ai_proto','AI Proto'],['view.suggestion',RT('Предложение','Suggestion')],['view.ai_portfolio',RT('AI-Портфель (просмотр)','AI Portfolio (view)')]]},
  {g:RT('Карточка акции','Stock card'),items:[['view.valuation',RT('Оценка (мультипликаторы)','Valuation (multiples)')],['view.insider',RT('Инсайдеры','Insiders')],['view.ai_reco',RT('AI-Рекомендация (просмотр)','AI recommendation (view)')]]},
  {g:RT('Действия','Actions'),items:[['action.add_position',RT('Добавлять/удалять позиции','Add/remove positions')],['action.edit_trades',RT('Вносить сделки','Edit trades')],['action.edit_plan',RT('Менять план','Edit plan')],['action.run_ai',RT('Запуск AI (тратит бюджет)','Run AI (spends budget)')],['action.chat_ai',RT('Чат с AI','AI chat')],['action.refresh_data',RT('Обновлять данные','Refresh data')],['action.manage_users',RT('Управление доступом','Manage access')]]},
  {g:RT('Данные','Data'),items:[['data.show_amounts',RT('Суммы в kr','Amounts (kr)')],['data.show_leverage',RT('Кредитное плечо','Leverage')],['data.show_ai_cost',RT('AI-расходы','AI cost')],['data.show_trades_pnl',RT('P&L по сделкам','Trades P&L')]]},
];
const RBAC_ALL=RBAC_PERMS.reduce((a,g)=>a.concat(g.items.map(i=>i[0])),[]);
// Пресет-роли (раздел 2). Значение '*' = всё.
const RBAC_ROLES={
  admin:'*',
  owner:new Set(RBAC_ALL.filter(p=>p!=='action.manage_users')),
  editor:new Set(['view.portfolio','view.sectors','view.type','view.diversification','view.forecast','view.plan','view.trades','view.dividends','view.health','view.valuation','view.insider','view.ai_reco','action.add_position','action.edit_trades','action.edit_plan','action.refresh_data','data.show_amounts','data.show_leverage','data.show_trades_pnl']),
  analyst:new Set(['view.portfolio','view.sectors','view.type','view.diversification','view.forecast','view.health','view.ai_proto','view.suggestion','view.ai_portfolio','view.valuation','view.insider','view.ai_reco','action.refresh_data','data.show_amounts']),
  viewer:new Set(['view.portfolio','view.sectors','view.type','view.diversification','view.dividends','action.refresh_data']),
  // legacy = неявный дефолт для ненастроенных не-админов: РОВНО текущее поведение
  // (видит обычные вкладки, торгует/правит план свой портфель, без add-тикера и AI).
  legacy:new Set(['view.portfolio','view.sectors','view.type','view.diversification','view.forecast','view.plan','view.trades','view.dividends','view.health','view.valuation','view.insider','view.ai_reco','action.edit_trades','action.edit_plan','action.refresh_data','data.show_amounts','data.show_leverage','data.show_trades_pnl']),
};
const RBAC_ROLE_LABELS={'default':RT('По умолч.','Default'),admin:'Admin',owner:'Owner',editor:'Editor',analyst:'Analyst',viewer:'Viewer',custom:'Custom'};
let ACCESS={roleId:null,overrides:{}};   // текущего пользователя (из user_access)
// Резолвер deny-by-default: явный override → роль → закрыто (раздел 6). Чистая ф-я.
function rbacResolve(roleId,overrides,perm){
  const ov=overrides||{};
  if(ov[perm]==='allow')return true;
  if(ov[perm]==='deny')return false;
  let rid=roleId; if(!rid||rid==='default')rid='legacy';   // ненастроенный = legacy (текущее поведение)
  const preset=RBAC_ROLES[rid];
  if(preset==='*')return true;
  return preset?preset.has(perm):false;
}
function can(perm){
  if(!SYNC_ENABLED||userRole==='admin')return true;   // админ — всё; без синка — локальный режим
  return rbacResolve(ACCESS.roleId,ACCESS.overrides,perm);
}
const PFTAB_PERM={list:'portfolio',sec:'sectors',typ:'type',div:'diversification',fcast:'forecast',plan:'plan',trades:'trades',tax:'trades',cal:'dividends',health:'health',ai:'ai_proto',prop:'suggestion',analysis:'ai_proto',backtest:'ai_proto',aim:'ai_proto'};
// «Структура» (alloc) объединяет Сектора+Тип+Диверсификацию — видна при любом из трёх прав.
const canTab=k=>k==='alloc'?(can('view.sectors')||can('view.type')||can('view.diversification')):can('view.'+(PFTAB_PERM[k]||k));
function initLang(){try{LANG=localStorage.getItem('dash_lang')==='en'?'en':'ru'}catch(e){}try{document.documentElement.lang=LANG}catch(e){}const b=document.getElementById('langBtn');if(b)b.textContent=LANG==='ru'?'EN':'RU'}
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
'🤖 AI Proto — обучается, анализирует портфель и обгоняет индексы':'🤖 AI Proto — learns, analyzes the portfolio and beats the indices','🔮 Проанализировать портфель':'🔮 Analyze portfolio','⏳ Анализирую… (30–60 сек)':'⏳ Analyzing… (30–60 s)','💬 Чат с AI Proto':'💬 AI Proto chat','видит портфель, цены и ваши правила':'sees your portfolio and prices (autonomous)','очистить':'clear','Отправить':'Send','Ваш вопрос или указание ассистенту…':'Your question or instruction…','🧠 Память AI Proto — правила инвестора':'🧠 AI Proto memory — investor rules','учитываются в чате и в полном анализе':'applied in chat and in the full analysis','Добавить правило вручную…':'Add a rule manually…','➕ Запомнить':'➕ Remember','📜 История запросов':'📜 History','⚖️ Предложение по балансировке портфеля':'⚖️ Portfolio rebalancing proposal',
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
// Весь реализованный P/L портфеля (SEK), включая полностью проданные бумаги.
// Семейные портфели: PF_TRADES plNative×FX; AI-портфель: AI_PORT.trades plSEK.
function pfTotalRealizedSEK(tabKey){
  if(tabKey===AIP_KEY)return Math.round(((AI_PORT&&AI_PORT.trades)||[]).reduce((a,t)=>a+(typeof t.plSEK==='number'?t.plSEK:0),0));
  return Math.round((PF_TRADES||[]).filter(t=>(t.tab||PF3_KEY)===tabKey).reduce((a,t)=>a+(t.plNative!=null?t.plNative*(FX[t.ccy]||1):0),0));
}
// Себестоимость реализованных (проданных) лотов в SEK — база для % за всё время.
// cost = выручка − P/L: PF продажи (price·qty − plNative − fee)×FX; AI продажи price·qty×FX − plSEK.
function pfTotalRealizedCostSEK(tabKey){
  if(tabKey===AIP_KEY)return Math.round(((AI_PORT&&AI_PORT.trades)||[]).filter(t=>t.action==='sell'&&typeof t.plSEK==='number').reduce((a,t)=>a+((+t.price||0)*(+t.qty||0)*(FX[t.ccy||'SEK']||1)-(t.plSEK||0)),0));
  return Math.round((PF_TRADES||[]).filter(t=>(t.tab||PF3_KEY)===tabKey&&t.act==='sell').reduce((a,t)=>a+(((+t.price||0)*(+t.qty||0)-(t.plNative||0)-(t.feeNative||0))*(FX[t.ccy]||1)),0));
}
function recalcPF(i,idx){const k=idx||curIdx,d=DATA[k],r=d.rows[i];const qty=parseFloat(r[6])||0,price=parseFloat(r[7])||0,buy=parseFloat(r[9])||0,ccy=String(r[8]||'SEK'),fxNow=FX[ccy]||1;r[13]=Math.round(qty*price*fxNow);r[11]=buy>0?r[13]-Math.round(qty*buy*fxNow):0;r[12]=buy>0?parseFloat(((price-buy)/buy*100).toFixed(2)):0;}
function recalcAllPF(idx){const k=idx||curIdx;DATA[k].rows.forEach((_,i)=>recalcPF(i,k))}
// Базовая валюта вкладки: по умолчанию SEK (kr); у Sergei — USD (без перевода в кроны).
// Денежные суммы позиций считаются в SEK (r[13]); для показа конвертируем в базовую.
// d.cashFree и d.leverage хранятся уже в БАЗОВОЙ валюте вкладки.
const pf3Base=d=>String((d&&d.baseCcy)||'SEK').toUpperCase();
const pf3BaseFx=d=>{const b=pf3Base(d);return b==='SEK'?1:(FX[b]||1)};   // SEK за 1 единицу базовой
const pf3BaseUnit=d=>{const b=pf3Base(d);return b==='SEK'?'kr':b};        // подпись валюты
const pf3Cv=(d,sek)=>{const f=pf3BaseFx(d);return f===1?sek:sek/f};       // SEK → базовая (число)
const pf3Money=(d,sek,dec)=>can('data.show_amounts')?`${pf3Fmt(pf3Cv(d,sek),dec)} ${pf3BaseUnit(d)}`:`••• ${pf3BaseUnit(d)}`;   // SEK → «X kr»; data.show_amounts=off → маскируем сумму

// 💸 Комиссия сделки (Avanza «Small»): courtage 0.15% от суммы, но не меньше
// lägsta courtage в местной валюте; + валютная надбавка 0.25% за конвертацию
// (для бумаг не в SEK); + налог на покупку (UK stamp 0.5% + £1.5 свыше £10k).
// Возвращает компоненты и total В ВАЛЮТЕ БУМАГИ. Примечание: страновые налоги
// внутри EUR (Франция 0.4%, Италия/Испания 0.2%) по валюте не определяются и не
// применяются автоматически.
const COURTAGE_MIN={USD:6,CAD:7,EUR:6,CHF:6,GBP:6,SEK:1};   // lägsta courtage, местная валюта
const COURTAGE_PCT=0.15, FX_FEE_PCT=0.25;
function tradeFeeNative(ccy,amount,isBuy){
  ccy=String(ccy||'USD').toUpperCase();
  if(!(amount>0))return{courtage:0,fx:0,tax:0,total:0};
  const min=COURTAGE_MIN[ccy]!=null?COURTAGE_MIN[ccy]:6;
  const courtage=Math.max(amount*COURTAGE_PCT/100,min);
  const fx=ccy==='SEK'?0:amount*FX_FEE_PCT/100;
  let tax=0;
  if(isBuy&&ccy==='GBP')tax=amount*0.5/100+(amount>10000?1.5:0);
  const r2=x=>Math.round(x*100)/100;
  return{courtage:r2(courtage),fx:r2(fx),tax:r2(tax),total:r2(courtage+fx+tax)};
}

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
  aiPlaybookEnsure();   // 📚 засеять плейбук стандартными принципами при первом запуске
  migratePortfolio();migratePortfolio3();migrateBrokerSnap20260610();fixCompanyNames();migrateNasdaqV3();migrateRemovePF2();simMigrateTabs();migrateAiHistory();migrateGoldSilver();migrateSmallCap();migrateTabAdds();migrateFamilyPortfolios();migrateAiPort();restoreXcols();
  const keys=Object.keys(DATA).filter(k=>k!==AIP_KEY&&tabAllowed(k));   // AIP — только как виртуальная (mkVirt), иначе дубль
  if((curIdx===DUP_KEY||curIdx===STK_KEY||curIdx===AIDASH_KEY||curIdx===SECT_KEY)&&!isAdmin())curIdx=keys[0]||Object.keys(DATA)[0];
  if(curIdx===AIP_KEY&&!can('view.ai_portfolio'))curIdx=keys[0]||Object.keys(DATA)[0];   // AIP — по праву просмотра (RBAC)
  if(curIdx!==HOME_KEY&&curIdx!==DUP_KEY&&curIdx!==AIP_KEY&&curIdx!==STK_KEY&&curIdx!==AIDASH_KEY&&curIdx!==SIM_KEY&&curIdx!==SECT_KEY&&(!DATA[curIdx]||!tabAllowed(curIdx)))curIdx=keys[0]||Object.keys(DATA)[0];
  const t=document.getElementById('tabs');t.innerHTML='';
  const mkTab=(n,lbl,noDrag)=>{
    const el=document.createElement('div');
    el.className='tab'+(n===curIdx?' active':'');el.dataset.tab=n;
    el.innerHTML=`${(DATA[n]&&DATA[n].icon)||META[n]||''} ${lbl||TAB_LABEL(n)}<span class="cnt">${DATA[n].count}</span>`;
    el.onclick=()=>{curIdx=n;sortCol=-1;sortDir=0;curSub='table';selected.clear();renderAll()};
    if(isAdmin()&&n!==PF3_KEY&&!noDrag){
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
  if(isAdmin())t.appendChild(mkVirt(DUP_KEY,TAB_LABEL(DUP_KEY)));
  if(isAdmin())t.appendChild(mkVirt(STK_KEY,TAB_LABEL(STK_KEY)));
  if(isAdmin())t.appendChild(mkVirt(AIDASH_KEY,TAB_LABEL(AIDASH_KEY)));
  if(isAdmin())t.appendChild(mkVirt(SECT_KEY,SECT_KEY));
  // 💼 Группа портфелей: Dima · AI-Portfolio · Anna · Sergei (в одном месте).
  const portShort=k=>k===AIP_KEY?'AI-Portfolio':k===SIM_KEY?'🧪 '+RT('Симуляция','Simulation'):TAB_LABEL(k).replace(/^Portfolio\s*\((.+)\)$/i,'$1');
  const portTabs=[];
  if(keys.includes(PF3_KEY))portTabs.push(PF3_KEY);            // Dima
  if(can('view.ai_portfolio'))portTabs.push(AIP_KEY);           // AI-Portfolio (виртуальная) — по праву просмотра (RBAC)
  keys.filter(k=>k!==PF3_KEY&&DATA[k]&&DATA[k].port==='1').forEach(k=>portTabs.push(k));   // Anna, Sergei, …
  portTabs.push(SIM_KEY);                                       // 🧪 Симуляция — все тестовые позиции вместе
  const portMembers=new Set(portTabs.filter(k=>k!==AIP_KEY&&k!==SIM_KEY));  // DATA-вкладки портфелей (исключить из стран/негруппированных)
  if(portTabs.length){
    const GN='💼 Portfolio',pcol=!!_grpCollapsed[GN];
    const hd=document.createElement('div');
    hd.className='tab-group-hd'+(pcol?' col':'');
    hd.textContent=(pcol?'▸ ':'▾ ')+GN;
    hd.onclick=()=>grpToggleCollapse(GN);
    t.appendChild(hd);
    if(!pcol)portTabs.forEach(k=>t.appendChild((k===AIP_KEY||k===SIM_KEY)?mkVirt(k,portShort(k)):mkTab(k,portShort(k),true)));
  }
  // Группы (страны по умолчанию, пользовательская раскладка — из TAB_GROUPS).
  const groups=ensureGroups();
  const grouped=new Set(portMembers);   // порт-вкладки уже показаны в 💼 Portfolio
  groups.forEach(g=>{
    const members=g.tabs.filter(n=>n!==PF3_KEY&&!portMembers.has(n)&&keys.includes(n));
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
  if(DATA[name]||name===HOME_KEY||name===DUP_KEY||name===AIP_KEY||name===STK_KEY||name===AIDASH_KEY||name===SIM_KEY){toast(RT('Такая вкладка уже есть','A tab with this name exists'),true);return}
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
  if(curIdx!==HOME_KEY)homeFutStop();   // лайв-фьючерсы крутятся только на Home
  if(curIdx!==SECT_KEY)sectStop();      // лайв-поллинг секторов — только на вкладке Сектора
  if(curIdx===AIP_KEY&&isAdmin())aipStart();else aipStop();   // синхрон AI-портфеля с воркером (эндпоинт admin-only) — только на вкладке AI-Портфель
  if(curIdx!==_pfPPKey)pfSumPPStop();   // лайв изм. баланса — только на открытом портфеле
  editScheduleWire();                   // навесить drag на блоки после перерисовки (режим ✏️)
  document.querySelectorAll('.tab').forEach(t=>{t.className='tab'+(t.dataset.tab===curIdx?' active':'')});
  const st=document.getElementById('subTabs');st.innerHTML='';st.removeAttribute('data-edit-row');
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
      homeFutStart();   // лайв-фьючерсы (поллинг каждые 20с, пока открыт Home)
      return;
    }
    if(curIdx===SIM_KEY){   // 🧪 Симуляция: все тестовые позиции со всех вкладок
      ['smaBanner','toolbarEl','statsBar','tableArea','rankingArea'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none'});
      document.getElementById('smaBanner').innerHTML='';
      pf3StopAutoRefresh();
      if(pf3El){pf3El.style.display='';pf3El.innerHTML=`<div class="pf3-wrap">${simTabHTML(true)}</div>`;}
      return;
    }
    if(curIdx===SECT_KEY){   // 🔄 Сектора: Live Sector Tracker (ротация GICS-секторов)
      ['smaBanner','toolbarEl','statsBar','tableArea','rankingArea'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none'});
      document.getElementById('smaBanner').innerHTML='';
      pf3StopAutoRefresh();
      if(pf3El){pf3El.style.display='';pf3El.innerHTML=`<div class="pf3-wrap">${sectHTML()}</div>`;}
      sectStart();
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
      v3Key=curIdx;pf3Sel=null;pf3Tab='list';pf3TypeSel={};pf3XMenuOpen=false;
      pf3Sort=pf3IsPort(curIdx)?{key:'val',dir:-1}:{key:'day',dir:-1};   // index default: top movers first
    }
    ['smaBanner','toolbarEl','statsBar','tableArea','rankingArea'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none'});
    document.getElementById('smaBanner').innerHTML='';
    const isPort=pf3MyPort(v3Key),isAip=v3Key===AIP_KEY;
    if(['sec','typ','div'].includes(pf3Tab))pf3Tab='alloc';   // объединённая вкладка «Структура» (бывш. Сектора/Тип/Диверсификация)
    if(isAip&&!['list','alloc','fcast','trades','health','backtest','aim'].includes(pf3Tab))pf3Tab='list';
    else if(isPort&&!['list','stats','alloc','fcast','trades','tax','plan','cal','health','ai','prop','analysis','backtest'].includes(pf3Tab))pf3Tab='list';
    else if(!isPort&&!isAip&&!['list','cal','alloc','ai'].includes(pf3Tab))pf3Tab='list';
    if(!canTab(pf3Tab))pf3Tab='list';   // RBAC: ушли с закрытой под-вкладки на «Портфель»
    const _subs=(isAip
      ?[[T('📊 Портфель'),'list'],['🏭 '+RT('Структура','Breakdown'),'alloc'],['🔮 '+RT('Прогноз','Forecast'),'fcast'],['📜 '+RT('Сделки','Trades'),'trades'],[T('🩺 Состояние портфеля'),'health'],['🧪 '+RT('Бэктест','Backtest'),'backtest'],['🤖 '+RT('Управление AI','AI controls'),'aim']]
      :isPort
      ?[[T('📊 Портфель'),'list'],...(v3Key===PF3_KEY&&isAdmin()?[['📊 '+RT('Статистика','Statistics'),'stats']]:[]),['🏭 '+RT('Структура','Breakdown'),'alloc'],['🔮 '+RT('Прогноз','Forecast'),'fcast'],['🎯 '+RT('План','Plan')+planBadge(v3Key),'plan'],['📜 '+RT('Сделки','Trades'),'trades'],['🧾 '+RT('Налоги','Tax'),'tax'],[T('📅 Дивиденды и отчёты'),'cal'],[T('🩺 Состояние портфеля'),'health'],['🤖 AI Proto','ai'],[T('⚖️ Предложение'),'prop'],['📈 '+RT('Анализ','Analysis'),'analysis'],['🧪 '+RT('Бэктест','Backtest'),'backtest']]
      :[[T('📊 Акции'),'list'],['🏭 '+RT('Структура','Breakdown'),'alloc'],['🤖 AI Proto','ai'],[T('📅 Дивиденды и отчёты'),'cal']]
    ).filter(([,k])=>canTab(k));   // RBAC: видимость под-вкладок по правам view.*
    st.dataset.editRow='sub:'+curIdx;
    eapply('sub:'+curIdx,_subs.map(([l,k])=>({id:k,l,k}))).forEach(({l,k})=>{const b=document.createElement('div');b.className='sub-tab'+(pf3Tab===k?' active':'');b.textContent=l;b.dataset.eid=k;b.onclick=()=>{pf3Tab=k;renderAll()};st.appendChild(b)});
    if(pf3El)pf3El.style.display='';
    renderPF3();
    pf3EnsureAutoRefresh();
    return;
  }
  pf3StopAutoRefresh();
  if(pf3El)pf3El.style.display='none';
  // Classic index tabs (OMXS30, S&P 500, …): table + ranking sub-tabs.
  const subs=[['📊 Таблица','table'],['🏆 Рейтинг','ranking']].filter(([,k])=>!(k==='ranking'&&!(RANK[curIdx]?.length)));
  st.dataset.editRow='sub:'+curIdx;
  eapply('sub:'+curIdx,subs.map(([l,k])=>({id:k,l,k}))).forEach(({l,k})=>{const b=document.createElement('div');b.className='sub-tab'+(curSub===k?' active':'');b.textContent=l;b.dataset.eid=k;b.onclick=()=>{curSub=k;renderAll()};st.appendChild(b)});
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
  if(!rows.length){   // понятное пустое состояние вместо немой пустой таблицы
    const vis=ord.filter(ci=>!(hiddenCols[curIdx]||[]).includes(ci)).length+1;
    const msg=searchTerm
      ? RT(`Ничего не найдено по запросу «${searchTerm}». Очистите поиск (↕ Сброс).`,`Nothing matches “${searchTerm}”. Clear the search (↕ Reset).`)
      : RT('На этой вкладке пока нет бумаг. Добавьте тикеры или нажмите «🔄 Цены», чтобы подтянуть данные.','No stocks on this tab yet. Add tickers or press “🔄 Prices” to load data.');
    tbody.innerHTML=`<tr><td colspan="${vis}" style="padding:28px 16px;text-align:center;color:var(--text2);font-size:12px">${msg}</td></tr>`;
    return;
  }
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
function renderStats(rows,h){const bar=document.getElementById('statsBar');bar.innerHTML='';const fc=kw=>h.findIndex(x=>kw.some(k=>x.toLowerCase().includes(k)));const nv=col=>rows.map(r=>parseFloat(r.data[col])).filter(n=>!isNaN(n));const pC=fc(['потенц']),dC=fc(['див','дивид']);const st=[{l:'Компаний',v:rows.length,c:'sv-blue'}];if(pC>=0){const v=nv(pC);if(v.length)st.push({l:'Ср. потенциал',v:'+'+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1)+'%',c:'sv-green'})}if(dC>=0){const v=nv(dC);if(v.length)st.push({l:'Ср. дивиденд',v:(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1)+'%',c:'sv-gold'})}if(pC>=0){const v=nv(pC);st.push({l:'Strong Buy',v:v.filter(x=>x>10).length,c:'sv-green'})}const s2=fc(['sma 200','sma200']),pc=fc(['цена','price']);if(s2>=0&&pc>=0){let ab=0,tot=0;rows.forEach(r=>{const p=parseFloat(r.data[pc]),sv=parseFloat(r.data[s2]);if(!isNaN(p)&&!isNaN(sv)&&sv>0){tot++;if(p>sv)ab++}});if(tot)st.push({l:'>SMA200',v:`${ab}/${tot}`,c:ab/tot>.6?'sv-green':'sv-red'})}st.forEach(s=>{const c=document.createElement('div');c.className='stat-card';c.innerHTML=`<div class="stat-label">${s.l}</div><div class="stat-value ${s.c}">${s.v}</div>`;bar.appendChild(c)})}
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
    const rid=adm?'admin':(u.role_id||'default');
    const ov=(u.overrides&&typeof u.overrides==='object')?u.overrides:{};
    // выбор роли (раздел 2)
    const roleSel=`<select class="set-rolesel" onchange="setUserRole('${u.user_id}',this.value)">${['default','admin','owner','editor','analyst','viewer','custom'].map(r=>`<option value="${r}"${rid===r?' selected':''}>${RBAC_ROLE_LABELS[r]}</option>`).join('')}</select>`;
    // матрица переопределений (раздел 5.2) — для не-админов
    const ovEditor=adm?'<span class="set-all">полный доступ (Admin)</span>':RBAC_PERMS.map(g=>`<div class="set-pg"><div class="set-pg-h">${g.g}</div>${g.items.map(([p,l])=>{const cur=ov[p]||'inherit';const def=rbacResolve(rid,{},p);return`<label class="set-perm"><span>${l}</span><select onchange="setOverride('${u.user_id}','${p}',this.value)"><option value="inherit"${cur==='inherit'?' selected':''}>${RT('по роли','by role')} (${def?'✓':'✕'})</option><option value="allow"${cur==='allow'?' selected':''}>${RT('Разрешить','Allow')}</option><option value="deny"${cur==='deny'?' selected':''}>${RT('Запретить','Deny')}</option></select></label>`}).join('')}</div>`).join('');
    // предпросмотр видимых под-вкладок
    const prevTabs=RBAC_PERMS[0].items.filter(([p])=>adm||rbacResolve(rid,ov,p)).map(([,l])=>l).join(' · ')||RT('нет','none');
    // портфельный доступ (раздел 4) — существующие галочки вкладок
    const grants=adm?'<span class="set-all">все портфели/вкладки</span>'
      :tabs.map(t=>`<label class="set-tab"><input type="checkbox"${(u.tabs||[]).includes(t)?' checked':''} onchange="setGrant('${u.user_id}','${t.replace(/'/g,"\\'")}',this.checked)"><span>${META[t]||''} ${t}</span></label>`).join('');
    return`<div class="set-user">
      <div class="set-user-hd"><b>${u.email||u.user_id}</b>${roleSel}${seen}</div>
      <div class="set-preview">👁 ${RT('Видит вкладки','Sees tabs')}: ${prevTabs}</div>
      <details class="set-perms"><summary>🔐 ${RT('Права (переопределения)','Permissions (overrides)')}</summary>${ovEditor}</details>
      <details class="set-tabs-d"><summary>💼 ${RT('Доступ к портфелям/вкладкам','Portfolio/tab access')}</summary><div class="set-tabs">${grants}</div></details>
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
// RBAC: сменить роль пользователя. Admin → role='admin'; иначе role='user' + role_id.
// Защита от самоблокировки (7.4): нельзя снять последнего админа.
async function setUserRole(uid,val){
  try{
    if(val!=='admin'){
      const{data:adm}=await sb.from('user_access').select('user_id').eq('role','admin');
      const list=adm||[];
      if(list.length<=1&&list.some(a=>a.user_id===uid)){ alert(RT('Нельзя снять роль с последнего администратора.','Cannot demote the last administrator.')); renderSettings(); return; }
    }
    const patch=val==='admin'?{role:'admin'}:{role:'user',role_id:val==='default'?null:val};
    const r=await sb.from('user_access').update(patch).eq('user_id',uid);
    if(r.error)throw r.error;
    renderSettings();
  }catch(e){ alert((RT('Не удалось сохранить роль','Could not save role'))+': '+(e.message||e)); renderSettings(); }
}
// RBAC: переопределение одного пермишена (allow/deny/inherit). reread→merge→write.
async function setOverride(uid,perm,val){
  try{
    const{data,error}=await sb.from('user_access').select('overrides').eq('user_id',uid).single();
    if(error)throw error;
    const ov=(data&&data.overrides&&typeof data.overrides==='object')?{...data.overrides}:{};
    if(val==='inherit')delete ov[perm]; else ov[perm]=val;
    const r=await sb.from('user_access').update({overrides:ov}).eq('user_id',uid);
    if(r.error)throw r.error;
    renderSettings();
  }catch(e){ alert((RT('Не удалось сохранить право','Could not save permission'))+': '+(e.message||e)); renderSettings(); }
}

function toggleFaq(){
  const o=document.getElementById('faqOverlay');
  if(!o)return;
  if(o.classList.contains('hidden')){document.getElementById('faqCard').innerHTML=faqHTML();o.classList.remove('hidden');}
  else o.classList.add('hidden');
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')['faqOverlay','setOverlay','grpOverlay','prmOverlay'].forEach(id=>document.getElementById(id)?.classList.add('hidden'))});

// ♿ A11y интерактив. Многие кликабельные элементы — это <div>/<span>/<th> с onclick,
// которые без role/tabindex не доступны с клавиатуры. Здесь, без правки сотен шаблонов:
//  1) MutationObserver проставляет role="button"+tabindex="0" свежесгенерированным
//     onclick-элементам (кроме нативных, contenteditable, подложек оверлеев и
//     контейнеров с собственными кнопками внутри);
//  2) глобальный keydown активирует их по Enter/Space;
//  3) модалки получают focus-trap, фокус на открытии и возврат фокуса на закрытии.
const A11Y_NATIVE='button,a,input,select,textarea';
function a11yEnhance(root){
  if(!root||!root.querySelectorAll)return;
  root.querySelectorAll('[onclick]:not(button):not(a):not(input):not(select):not(textarea)').forEach(el=>{
    if(el.hasAttribute('tabindex')||el.isContentEditable)return;
    const oc=el.getAttribute('onclick')||'';
    if(/===this/.test(oc))return;                       // подложка оверлея (закрытие по клику на себя) — не кнопка
    if(el.querySelector(A11Y_NATIVE))return;            // контейнер со своими контролами — не делаем его кнопкой целиком
    el.setAttribute('tabindex','0');
    if(!el.hasAttribute('role'))el.setAttribute('role','button');
  });
}
let _a11yT=0;
function a11yInit(){
  a11yEnhance(document.body);
  // childList+subtree: ловим перерисовки; атрибуты не наблюдаем → не зациклимся на своих tabindex.
  try{new MutationObserver(()=>{if(_a11yT)return;_a11yT=setTimeout(()=>{_a11yT=0;a11yEnhance(document.body)},60)}).observe(document.body,{childList:true,subtree:true});}catch(e){}
  // Активация Enter/Space для role="button"-элементов (нативные кнопки/ссылки работают сами).
  document.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    const el=e.target;if(!el||el.isContentEditable)return;
    if((el.tagName==='BUTTON'||el.tagName==='A'||el.tagName==='INPUT'||el.tagName==='SELECT'||el.tagName==='TEXTAREA'))return;
    if(el.getAttribute&&el.getAttribute('role')==='button'&&el.hasAttribute('onclick')){e.preventDefault();el.click();}
  });
  // Focus-trap по Tab внутри открытой модалки.
  const openCard=()=>{const ov=document.querySelector('.faq-overlay:not(.hidden),.auth-overlay:not(.hidden)');return ov?ov.querySelector('.faq-card,.auth-card'):null;};
  const focusables=card=>[...card.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>el.offsetParent!==null);
  document.addEventListener('keydown',e=>{
    if(e.key!=='Tab')return;const card=openCard();if(!card)return;
    const f=focusables(card);if(!f.length)return;
    const first=f[0],last=f[f.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });
  // Фокус на открытии модалки и возврат на элемент-открыватель при закрытии.
  let _retFocus=null;
  ['faqOverlay','setOverlay','grpOverlay','prmOverlay','authOverlay','onbOverlay'].forEach(id=>{
    const ov=document.getElementById(id);if(!ov)return;
    try{new MutationObserver(()=>{
      const open=!ov.classList.contains('hidden');
      if(open){_retFocus=document.activeElement;const card=ov.querySelector('.faq-card,.auth-card');const t=(card&&(focusables(card)[0]||card));if(t&&t.focus)setTimeout(()=>t.focus(),30);}
      else if(_retFocus&&_retFocus.focus){_retFocus.focus();_retFocus=null;}
    }).observe(ov,{attributes:true,attributeFilter:['class']});}catch(e){}
  });
}
if(document.readyState!=='loading')a11yInit();else document.addEventListener('DOMContentLoaded',a11yInit);

// ── ❗ Справка по секциям: «!» в заголовке → модалка с описанием всех значений/аббревиатур ──
// Один реестр SEC_INFO + общий рендер. infoBtn(key) вставляется в pf3-panel-hd.
function infoBtn(key){return `<span class="dash-info-btn" onclick="event.stopPropagation();secInfo('${key}')" title="${RT('Что это? Описание значений и аббревиатур','What is this? Field & abbreviation guide')}">!</span>`;}
function infoRows(rows){return `<dl class="info-gloss">${rows.map(x=>`<dt>${x[0]}</dt><dd>${RT(x[1],x[2])}</dd>`).join('')}</dl>`;}
function infoP(ru,en){return `<p>${RT(ru,en)}</p>`;}
function infoNote(ru,en){return `<p class="pf3-asof">${RT(ru,en)}</p>`;}
const INFO_DISCLAIM=['Справочные данные, не индивидуальная инвестиционная рекомендация.','Reference data, not individual investment advice.'];
const SEC_INFO={
  tax:{t:['🧾 Налоговый отчёт','🧾 Tax report'],b:()=>infoP('Реализованные прибыли/убытки из журнала сделок портфеля по годам. Считается из ваших покупок/продаж (вкладка «Сделки»): продажи сопоставляются с покупками выбранным методом.','Realized gains/losses from the portfolio trade journal, by year. Computed from your buys/sells (the «Trades» tab): sells are matched to buys by the chosen method.')+infoRows([
    [RT('Средняя','Average'),'genomsnittsmetoden — средняя себестоимость. КОРРЕКТНО для шведской декларации K4 и совпадает с «Реализованный P&L» журнала.','genomsnittsmetoden — average cost. CORRECT for the Swedish K4 return and matches the journal Realized P&L.'],
    ['FIFO','первый пришёл — первый ушёл. Для сверки / других юрисдикций (US и т.п.).','first in, first out. For cross-check / other jurisdictions (US etc.).'],
    [RT('Сумма в kr','kr amount'),'пересчёт по ТЕКУЩЕМУ курсу, не на дату сделки — это оценка, НЕ готовая K4 (для K4 нужен курс на день сделки).','converted at the CURRENT FX, not the trade-date rate — an estimate, NOT a filing-ready K4 (K4 needs the trade-date rate).'],
    [RT('Комиссии','Fees'),'комиссия покупки входит в себестоимость, комиссия продажи уменьшает выручку.','buy fees add to cost basis, sell fees reduce proceeds.'],
    ['📥 CSV','импорт сделок (вкладка «Сделки») и экспорт отчёта. Колонки: date, action, ticker, qty, price, ccy, fee.','import trades (the «Trades» tab) and export the report. Columns: date, action, ticker, qty, price, ccy, fee.'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
  cycle:{t:['🧭 Тезис-монитор бумаги','🧭 Stock thesis monitor'],b:()=>infoP('Модуль-мониторинг инвестиционного тезиса по бумаге: набор опережающих сигналов, специфичных для ЕЁ сектора и истории (а не один индикатор). Метрики и пороги подбирает AI под конкретную компанию через web_search; для Micron (MU) это цикл памяти (DXI/запасы/capex/HBM) как образец. Кнопка «✨ Обновить (AI)» тянет свежие значения; «✏️ Правка» — ручная корректировка; ƒ — авто-derive из фундаментала.','A module that monitors a stock\'s investment thesis: a set of leading signals specific to ITS sector and story (not a single indicator). The AI picks the metrics and thresholds per company via web_search; for Micron (MU) it is the memory cycle (DXI/inventory/capex/HBM) as the template. «✨ Refresh (AI)» pulls fresh values; «✏️ Edit» for manual tweaks; ƒ — auto-derived from fundamentals.')+infoRows([
    ['Tier 1 · Exit','жёсткие триггеры выхода — пора действовать. Свои для каждого сектора (память: разворот спот-цен/DXI; банк: маржа и кредитные потери; биотех: провал испытаний/иссяк runway; энергетика: обвал цены сырья).','hard exit triggers — time to act. Sector-specific (memory: spot price/DXI turn; bank: margin & credit losses; biotech: trial fail / runway out; energy: commodity-price crash).'],
    ['Tier 2 · Trim','смягчённые триггеры — снизить позицию на 20–30% (ранние предупреждения).','softer triggers — trim 20–30% (early warnings).'],
    [RT('Структурный риск','Structural risk'),'контекст, не сигнал: то, что готовит проблему на горизонте лет (напр. capex на пике → oversupply через 2–3 года).','context, not a signal: what sets up trouble years out (e.g. capex at a peak → oversupply in 2–3 years).'],
    [RT('Фаза','Phase'),'где бумага в своём цикле/истории: стрелка между ранней стадией, развитием и зрелостью/перегревом.','where the stock is in its cycle/story: a needle between early stage, growth and maturity/overheat.'],
    [RT('Источник','Source'),'значка у строки: ✋ ручная правка · ✨ AI (web_search) · ƒ авто-derive · • дефолт-сид.','per-row badge: ✋ manual · ✨ AI (web_search) · ƒ auto-derived · • default seed.'],
  ])+infoNote('Цвет строки: 🟢 порог не достигнут / тезис цел · 🟡 близко к порогу или структурный риск · 🔴 порог достигнут. AI-вызов платный (admin). '+INFO_DISCLAIM[0],'Row colour: 🟢 threshold not hit / thesis intact · 🟡 near threshold or structural risk · 🔴 threshold hit. The AI call is paid (admin). '+INFO_DISCLAIM[1])},
  baro:{t:['🌡 Барометр перегретости рынков','🌡 Market overheat barometer'],b:()=>infoP('Композитный индекс 0–100 из живых данных ведущих индексов. 0 — страх/перепроданность, 100 — эйфория/перегрев. Считается в браузере из уже загруженных котировок, обновляется вместе с рынками.','A 0–100 composite from live data of leading indices. 0 = fear/oversold, 100 = euphoria/overheated. Computed in the browser from already-loaded quotes, refreshed with the markets.')+infoRows([
    ['VIX','индекс страха: низкий VIX → самоуспокоенность (перегрев), высокий → страх. Вес 30%.','fear gauge: low VIX → complacency (overheat), high → fear. Weight 30%.'],
    [RT('Выше SMA200','Above SMA200'),'доля ведущих индексов выше своей SMA200 — широта бычьего тренда. Вес 25%.','share of leading indices above their SMA200 — bull-trend breadth. Weight 25%.'],
    [RT('Выше SMA50','Above SMA50'),'то же по SMA50 — краткосрочная широта. Вес 20%.','same over SMA50 — short-term breadth. Weight 20%.'],
    [RT('Растяжение SMA50','SMA50 stretch'),'среднее отклонение цены над SMA50: чем дальше вверх, тем перегретее. Вес 25%.','average price deviation above SMA50: the further up, the more overheated. Weight 25%.'],
    [RT('Зоны','Zones'),'🧊 0–20 страх · ❄️ 20–40 прохладно · 😐 40–60 нейтрально · 🔥 60–80 жарко · 🌋 80–100 перегрев.','🧊 0–20 fear · ❄️ 20–40 cool · 😐 40–60 neutral · 🔥 60–80 hot · 🌋 80–100 overheated.'],
  ])+infoNote('Веса нормируются по доступным компонентам (если уровни ещё грузятся — по тому, что есть). '+INFO_DISCLAIM[0],'Weights are renormalised over available components (if levels are still loading — over what is present). '+INFO_DISCLAIM[1])},
  markets:{t:['📈 Рынки и уровни индексов','📈 Markets & index levels'],b:()=>infoP('Живые цены индексов/фьючерсов и их ключевые уровни. Цена обновляется ~20 c, уровни — раз в 5 мин.','Live index/futures prices and their key levels. Price refreshes ~20 s, levels every 5 min.')+infoRows([
    ['● LIVE','фьючерсы торгуются ~23 ч → барометр риска; спот-индексы (^…) — в часы своей биржи.','futures trade ~23 h → a risk barometer; spot indices (^…) trade in their exchange hours.'],
    ['▲/▼ %','изменение за день (авторитетное regularMarketChangePercent от Yahoo).','daily change (authoritative regularMarketChangePercent from Yahoo).'],
    ['R / R1, R2','сопротивление — уровни ВЫШЕ цены (красным), ближайший первым.','resistance — levels ABOVE price (red), nearest first.'],
    ['S / S1, S2','поддержка — уровни НИЖЕ цены (зелёным), ближайший первым.','support — levels BELOW price (green), nearest first.'],
    ['▸ цена','маркер текущей цены между поддержками и сопротивлениями.','marker of the current price between support and resistance.'],
    ['Pivot','опорный уровень дня P = (High+Low+Close)/3 предыдущего бара; R1=2P−L, S1=2P−H, R2=P+(H−L), S2=P−(H−L).','daily pivot P = (High+Low+Close)/3 of the prior bar; R1=2P−L, S1=2P−H, R2=P+(H−L), S2=P−(H−L).'],
    ['свинг','максимум/минимум за окно ~60 торговых дней — как дополнительный уровень.','high/low over a ~60-trading-day window — an extra level.'],
    ['SMA 50/200','простая скользящая средняя за 50/200 дней; «выше/ниже SMA» = направление тренда.','simple moving average over 50/200 days; «above/below SMA» = trend direction.'],
    ['± % у уровня','расстояние от цены до уровня в процентах.','distance from price to the level, in percent.'],
  ])+infoNote('Уровни считаются из дневной истории (pivots + свинги). '+INFO_DISCLAIM[0],'Levels computed from daily history (pivots + swings). '+INFO_DISCLAIM[1])},
  bestrank:{t:['🏆 Лучшие акции — общий рейтинг','🏆 Best stocks — overall rank'],b:()=>infoP('Единый балл 0–100 из ВСЕХ сигналов сразу. Детерминированно по обновлённым данным (кнопка «Обновить всё»).','A single 0–100 score from ALL signals at once. Deterministic from refreshed data («Update all»).')+infoRows([
    ['Балл 0–100','свод всех вкладов; 50 — нейтрально, выше — сильнее. Бар показывает относительную силу.','sum of all contributions; 50 is neutral, higher is stronger. The bar shows relative strength.'],
    ['Сигналы','топ-3 причины балла (чипы): апсайд, ROE, рост, P/E, у входа, инсайдеры, недооценка.','top-3 reasons for the score (chips): upside, ROE, growth, P/E, near entry, insiders, undervalued.'],
    ['Апсайд','потенциал роста к таргету аналитиков, %.','upside to the analyst target, %.'],
    ['Фаза','тех-фаза цены: 🔪 нож, 📉 даунтренд, ⚠️ коррекция, ⚖️ боковик, 🔄 разворот, 💎 недооценка, 📈 аптренд, 🚀 импульс, 🌡 перегрев.','price phase: 🔪 falling knife, 📉 downtrend, ⚠️ correction, ⚖️ range, 🔄 reversal, 💎 undervalued, 📈 uptrend, 🚀 momentum, 🌡 overheated.'],
    ['У входа','цена близка к уровню входа (SMA50/поддержка) при аптренде.','price is near an entry level (SMA50/support) in an uptrend.'],
    ['Сорт','Общий / Апсайд / Недооценка / Качество (ROE) / У входа — переключают ранжирование.','Overall / Upside / Value / Quality (ROE) / Entry — switch the ranking.'],
    ['Нет данных','отсутствующий сигнал не штрафует (вклад 0) — бумаги без оценки/AI не проваливаются.','a missing signal does not penalize (0 contribution) — stocks without valuation/AI are not buried.'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
  horizons:{t:['🏅 Лучшие по горизонтам','🏅 Best by horizon'],b:()=>infoP('Те же кандидаты, но разнесены по сроку удержания — у каждого свой акцент.','Same candidates split by holding horizon — each with its own focus.')+infoRows([
    ['1–3 мес','импульс и точки входа: тренд выше SMA, близость к уровню, дневная динамика.','momentum & entries: trend above SMA, proximity to a level, daily move.'],
    ['3–6 мес','тренд + разумная цена: аптренд, умеренный апсайд, приемлемый P/E.','trend + fair value: uptrend, moderate upside, acceptable P/E.'],
    ['6–12 мес','фундаментал и недооценка: ROE, рост выручки, апсайд, низкий P/E.','fundamentals & value: ROE, revenue growth, upside, low P/E.'],
    ['Почему','3 коротких причины попадания в список.','3 short reasons for inclusion.'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
  forecast:{t:['🔮 Прогноз — топ-10 по горизонтам','🔮 Forecast — top-10 by horizon'],b:()=>infoP('Ожидаемая доходность по 3 горизонтам. По умолчанию — детерминированно от консенсус-таргета; «✨ AI-прогноз» — версия со свежим веб-поиском (платно, админ).','Expected return across 3 horizons. By default deterministic from the consensus target; «✨ AI forecast» is the fresh web-search version (paid, admin).')+infoRows([
    ['3 мес / 6–9 мес / 12+ мес','доля пути к таргету: ~⅓ / ~⅔ / полностью.','share of the path to target: ~1/3 / ~2/3 / full.'],
    ['ƒ','оценка по фундаменталу (рост выручки/ROE), когда нет таргета.','fundamental estimate (revenue growth/ROE) when no target.'],
    ['≈','нет таргета/данных — без изменения.','no target/data — held flat.'],
    ['Сегменты','переключают сортировку топ-10 по выбранному горизонту.','switch the top-10 sort by the chosen horizon.'],
  ])+infoNote('Оценка, не индивидуальная рекомендация.','An estimate, not advice.')},
  scenario:{t:['📊 Сценарии акции','📊 Stock scenarios'],b:()=>infoP('Два РАЗДЕЛЬНЫХ горизонта со своим R/R: краткосрок (дни-недели, тех-уровни) и среднесрок (до отчёта, таргеты + событие).','Two SEPARATE horizons, each with its own R/R: short-term (days-weeks, technical levels) and mid-term (to earnings, targets + event).')+infoRows([
    ['Bull / Base / Bear','оптимистичный / базовый / пессимистичный сценарий цены.','optimistic / base / pessimistic price scenario.'],
    ['R/R','risk/reward — отношение потенциала роста к риску снижения; >1 благоприятно.','risk/reward — upside vs downside; >1 is favourable.'],
    ['ATR','average true range — средний дневной диапазон (волатильность) для коридора.','average true range — typical daily range (volatility) for the corridor.'],
    ['RSI 1D / 1W','relative strength index (0–100) на дневном/недельном баре; >70 перекупленность, <30 перепроданность.','relative strength index (0–100) on the daily/weekly bar; >70 overbought, <30 oversold.'],
    ['Проекция ±ATR×√N','полоса ≈±1σ за N дней — диапазон неопределённости, НЕ цель.','a ≈±1σ band over N days — an uncertainty range, NOT a target.'],
    ['Событийный Bear','просадка на провале отчёта (−R%); R по умолчанию 20% либо по опционам (см. ниже).','drawdown on an earnings miss (−R%); R defaults to 20% or comes from options (below).'],
    ['📉 Опционы закладывают ход ±X%','implied move — ожидаемая амплитуда из ATM-стрэддла (call+put)/цена к ближайшей экспирации.','implied move — expected amplitude from the ATM straddle (call+put)/price to the nearest expiry.'],
    ['📅 На отчёт ±X%','implied move у экспирации, покрывающей дату отчёта — «чистый» скачок на событии.','implied move at the expiration covering the earnings date — the «clean» event jump.'],
    ['IV','implied volatility — годовая подразумеваемая волатильность ATM-опционов.','implied volatility — annualized IV of the ATM options.'],
  ])+infoNote('Sanity-check скрывает R/R при сломанных/устаревших входах. '+INFO_DISCLAIM[0],'A sanity check hides R/R on broken/stale inputs. '+INFO_DISCLAIM[1])},
  targets:{t:['🎯 Аналитические таргеты','🎯 Analyst targets'],b:()=>infoP('Агрегированные ценовые цели аналитиков. US — FMP, EU/Nordic — резерв Yahoo.','Aggregated analyst price targets. US via FMP, EU/Nordic via Yahoo fallback.')+infoRows([
    ['Консенсус','средний таргет; берём свежий квартальный срез, если «за всё время» устарел.','average target; we use the fresh quarterly slice if the all-time one is stale.'],
    ['High / Low','максимальный / минимальный таргет в выборке.','highest / lowest target in the set.'],
    ['Апсайд %','(таргет / цена − 1) × 100.','(target / price − 1) × 100.'],
    ['Изменения','свежие пересмотры таргета аналитиками за ~30 дней.','recent analyst target revisions over ~30 days.'],
    ['Рейтинги','распределение Strong Buy / Buy / Hold / Sell / Strong Sell.','distribution of Strong Buy / Buy / Hold / Sell / Strong Sell.'],
    ['span q / m','окно свежего среза: квартал / месяц.','fresh-slice window: quarter / month.'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
  valuation:{t:['📐 Оценка — мультипликаторы','📐 Valuation — multiples'],b:()=>infoP('Дёшево или дорого относительно сектора и собственной истории.','Cheap or expensive vs the sector and the stock’s own history.')+infoRows([
    ['P/E','price/earnings — цена на прибыль; ниже = дешевле.','price/earnings; lower = cheaper.'],
    ['fwd P/E','форвардный P/E на прогнозную прибыль; fwd<trailing ⇒ EPS растёт.','forward P/E on expected earnings; fwd<trailing ⇒ EPS rising.'],
    ['P/S','price/sales — цена на выручку (для убыточных/растущих).','price/sales — for unprofitable/growth names.'],
    ['EV/EBITDA','стоимость бизнеса к EBITDA — без искажений структуры капитала.','enterprise value to EBITDA — capital-structure neutral.'],
    ['PEG','P/E с поправкой на рост; ~1 — справедливо.','P/E adjusted for growth; ~1 is fair.'],
    ['vs сектор','% относительно медианы сектора (ниже медианы = дешевле).','% vs the sector median (below median = cheaper).'],
    ['vs история','против собственного исторического диапазона мультипликатора.','vs the stock’s own historical multiple range.'],
    ['⚠ ловушка','дёшево, но EPS падает — мнимая недооценка.','cheap but EPS falling — a value trap.'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
  insider:{t:['🕵 Инсайдеры','🕵 Insiders'],b:()=>infoP('Сделки инсайдеров компании. US — Finnhub, Швеция — Finansinspektionen.','Company insider transactions. US via Finnhub, Sweden via Finansinspektionen.')+infoRows([
    ['Кластер покупок','несколько РАЗНЫХ инсайдеров купили в близком окне — сильный сигнал.','several DIFFERENT insiders bought within a tight window — a strong signal.'],
    ['Нетто USD','покупки минус продажи в деньгах за окно; >0 — чистая покупка.','buys minus sells in money over the window; >0 = net buying.'],
    ['Покупка/продажа','тип сделки; покупки информативнее (продажи бывают плановыми).','transaction type; buys are more informative (sells are often planned).'],
    ['Окно','период, за который собраны сделки.','the period over which trades are collected.'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
  signal:{t:['🧭 Инсайдеры × Недооценка','🧭 Insiders × Undervaluation'],b:()=>infoP('Скрещивание двух модулей: где инсайдеры ПОКУПАЮТ и при этом бумага НЕДООЦЕНЕНА.','Crossing two modules: where insiders are BUYING and the stock is also UNDERVALUED.')+infoRows([
    ['🧭 Сигнал ±N','сумма баллов инсайдеров и оценки; 🟢 положительный, 🔴 отрицательный.','sum of insider and valuation points; 🟢 positive, 🔴 negative.'],
    ['Кластер +2 / нетто +1','вклад инсайдеров в балл.','insider contribution to the score.'],
    ['Недооценка +1/+2','вклад дешевизны по сектору/истории.','undervaluation contribution vs sector/history.'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
  cashdrag:{t:['💵 Cash-drag','💵 Cash drag'],b:()=>infoP('Сколько доходности теряет портфель из-за доли в кэше.','How much return the portfolio loses by holding cash.')+infoRows([
    ['Cash drag','недополученная доходность = доля кэша × доходность индекса за период.','foregone return = cash share × index return over the period.'],
    ['Доля кэша','деньги, не вложенные в активы, % от портфеля.','money not invested in assets, % of the portfolio.'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
  fxhedge:{t:['💱 Валютный риск и хедж','💱 Currency risk & hedge'],b:()=>infoP('Влияние курсов на портфель в базовой валюте (SEK) и сценарий хеджирования.','How FX moves affect the portfolio in the base currency (SEK), and a hedge scenario.')+infoRows([
    ['Валютная экспозиция','доля активов в каждой валюте.','share of assets in each currency.'],
    ['Хедж','компенсация валютного риска; hedge ratio — какая часть закрыта.','offsetting FX risk; hedge ratio — what fraction is covered.'],
    ['Сценарий ±%','эффект на портфель при движении курса.','effect on the portfolio if the rate moves.'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
  pfcmp:{t:['🏁 Сравнение портфелей','🏁 Portfolio leaderboard'],b:()=>infoP('Сравнение доходности всех портфелей, AI-Портфеля и индексов за период (по умолчанию — с создания 12.06.2026). Только для администратора.','Returns of all portfolios, the AI portfolio and indices over the period (default — since creation 12 Jun 2026). Admin-only.')+infoRows([
    ['📊 Все портфели','сводная доходность всех real-портфелей (взвешено стоимостью).','combined return of all real portfolios (value-weighted).'],
    ['🤖 AI / 🧑 портфели','AI-Портфель — по реальной истории капитала; Dima/Anna/Sergei — по текущему составу.','AI portfolio — real capital history; Dima/Anna/Sergei — current composition.'],
    ['Рейтинг','портфели ранжированы по доходности за период; бар — относительная величина.','portfolios ranked by period return; bar = relative size.'],
    ['α (альфа)','доходность портфеля минус индекс, в процентных пунктах (п.п.). >0 — обгон.','portfolio return minus the index, in percentage points. >0 = outperformance.'],
    ['Индексы','S&P 500 / Nasdaq 100 / OMXS30 за тот же период.','S&P 500 / Nasdaq 100 / OMXS30 over the same period.'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
  pfdeep:{t:['🔬 Глубокое сравнение портфелей','🔬 Deep portfolio comparison'],b:()=>infoP('Расширенные сравнения всех портфелей за период (с создания 12.06.2026). Только для администратора.','Advanced comparisons of all portfolios over the period (since 12 Jun 2026). Admin-only.')+infoRows([
    ['Волатильность','годовой разброс доходности (×√252) — мера риска; ниже спокойнее.','annualized dispersion of returns (×√252) — a risk measure; lower = calmer.'],
    ['Просадка','макс. падение от пика до дна за период.','max peak-to-trough decline over the period.'],
    ['Sharpe','доходность на единицу общего риска (rf=0); >1 — хорошо.','return per unit of total risk (rf=0); >1 is good.'],
    ['Sortino','как Sharpe, но риск = только просадочная волатильность (штрафует лишь падения).','like Sharpe but risk = downside volatility only (penalizes drops only).'],
    ['Calmar','годовая доходность ÷ макс. просадку — доходность на единицу «боли».','annual return ÷ max drawdown — return per unit of pain.'],
    ['IR','information ratio — альфа к S&P 500 на единицу tracking error; >0 — обгон с поправкой на риск.','information ratio — alpha vs S&P 500 per unit of tracking error; >0 = risk-adjusted outperformance.'],
    ['β и захват','β — чувствительность к индексу; захват ↑/↓ — какую долю роста/падения индекса портфель повторяет (идеал: ↑>100%, ↓<100%).','β — sensitivity to the index; up/down capture — share of the index up/down moves the portfolio repeats (ideal: ↑>100%, ↓<100%).'],
    ['Корреляция','матрица дневных доходностей: низкая корреляция между портфелями = реальная диверсификация.','daily-return matrix: low correlation between portfolios = real diversification.'],
    ['Концентрация','топ-5 вес и эфф. число бумаг (1/HHI); win-rate — доля прибыльных позиций.','top-5 weight and effective # of holdings (1/HHI); win-rate — share of profitable positions.'],
    ['По окнам','доходность за день / неделю / с создания.','return over day / week / since start.'],
    ['Вклад','бумаги, давшие/съевшие больше всего прибыли (kr) с покупки.','holdings that contributed/detracted the most profit (kr) since purchase.'],
    ['Перекрытие','бумаги, которые держат ≥2 портфеля (схожесть/диверсификация между ними).','holdings shared by ≥2 portfolios (similarity/diversification across them).'],
    ['Сектора','доли по секторам: портфели (по стоимости) vs индексы (по числу бумаг).','sector shares: portfolios (by value) vs indices (by stock count).'],
    ['Валюты','доля активов по валютам.','asset share by currency.'],
  ])+infoNote('На коротком окне риск-метрики шумные — для ориентира. '+INFO_DISCLAIM[0],'Over a short window risk metrics are noisy — indicative. '+INFO_DISCLAIM[1])},
  playbook:{t:['📚 Инвест-плейбук','📚 Investing playbook'],b:()=>infoP('Набор стратегических принципов «как обгонять индекс». Передаётся во ВСЕ анализы AI Proto и в AI-Портфель как рамка решений — это единственный способ направлять автономного AI Proto.','A set of strategic «how to beat the index» principles. Passed to EVERY AI Proto analysis and to the AI portfolio as the decision framework — the only way to steer the autonomous AI Proto.')+infoRows([
    ['Зачем','приоритетнее общих эвристик: AI применяет эти принципы в каждом совете и сделке.','takes priority over generic heuristics: the AI applies these in every call and trade.'],
    ['✨ Подтянуть практики (AI)','AI ищет в вебе свежие лучшие практики и дописывает новые принципы (платно, админ).','the AI web-searches fresh best practices and appends new principles (paid, admin).'],
    ['➕ / 🗑','добавить свой принцип / удалить.','add your own principle / remove one.'],
    ['Сбросить к стандарту','вернуть встроенный набор принципов.','restore the built-in principle set.'],
  ])+infoNote('Цель плейбука — обогнать все индексы и максимизировать прибыль. '+INFO_DISCLAIM[0],'The playbook’s goal is to beat all indices and maximize profit. '+INFO_DISCLAIM[1])},
  aiauto:{t:['🤖 Автономный режим AI Proto','🤖 AI Proto autonomous mode'],b:()=>infoP('AI Proto работает самостоятельно, без ваших ограничений.','AI Proto operates on its own, without your constraints.')+infoRows([
    ['Правила отменены','личные правила инвестора больше не передаются и не ограничивают советы.','personal investor rules are no longer sent and do not constrain advice.'],
    ['Анализ всех акций','сам анализирует бумаги и даёт конкретные советы по всем портфелям.','it analyzes every stock and gives concrete advice across all portfolios.'],
    ['AI-Портфель','ведёт независимый бумажный портфель без искусственных лимитов, по плейбуку и фактам.','runs an independent paper portfolio with no artificial limits, by the playbook and facts.'],
    ['Цель','обогнать ВСЕ индексы и максимизировать рост капитала.','beat ALL indices and maximize capital growth.'],
    ['Как направлять','через 📚 Плейбук — это единственный набор принципов, которым он следует.','via the 📚 Playbook — the only set of principles it follows.'],
  ])+infoNote('AI-Портфель — симуляция (бумажная), для сравнения с вашим реальным портфелем. '+INFO_DISCLAIM[0],'The AI portfolio is a paper simulation, to benchmark vs your real portfolio. '+INFO_DISCLAIM[1])},
  newslive:{t:['📰 Новости (Yahoo)','📰 News (Yahoo)'],b:()=>infoP('Живые заголовки по акции с Yahoo Finance. Тянутся автоматически при открытии карточки (обновление ~10 мин), без платных токенов.','Live per-stock headlines from Yahoo Finance. Fetched automatically when the card opens (refresh ~10 min), no paid tokens.')+infoRows([
    ['🟢 / 🔴 / ⚪','тональность заголовка по словарю: позитив / негатив / нейтрально.','headline tone by lexicon: positive / negative / neutral.'],
    ['настрой ±N','суммарный новостной фон с весом по свежести (новое весомее): >0 позитивный, <0 негативный.','overall news tone, recency-weighted (newer matters more): >0 positive, <0 negative.'],
    ['источник · время','издатель и как давно вышла новость.','publisher and how long ago it was published.'],
    ['🔄','обновить заголовки вручную (иначе раз в ~10 мин).','refresh headlines manually (otherwise every ~10 min).'],
    ['в рекомендации','новостной фон входит в 💡 Рекомендацию и общий рейтинг 🏆 (небольшой вес).','news tone feeds the 💡 Recommendation and the 🏆 overall rank (small weight).'],
  ])+infoNote('Заголовки — публичные данные Yahoo. '+INFO_DISCLAIM[0],'Headlines are public Yahoo data. '+INFO_DISCLAIM[1])},
  news:{t:['📰 Новости → влияние','📰 News → impact'],b:()=>infoP('Вставьте текст новостей — детерминированный разбор без платных токенов сопоставит их с вашими бумагами.','Paste news text — a deterministic, token-free pass maps it to your holdings.')+infoRows([
    ['🟢 Bull / 🔴 Bear / ⚪ Нейтрал','тональность по словарю: позитив / негатив / нейтрально.','lexicon polarity: positive / negative / neutral.'],
    ['Тикер · имя','совпадение по тикеру или словам названия компании.','match by ticker or company-name words.'],
    ['✨ Платный анализ','углублённый разбор через AI (только админ).','deeper AI analysis (admin only).'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
  riskret:{t:['📐 Риск и доходность','📐 Risk & return'],b:()=>infoP('Профиль риск/доходность портфеля за ~1 год.','The portfolio’s risk/return profile over ~1 year.')+infoRows([
    ['Доходность','рост стоимости за период, %.','value growth over the period, %.'],
    ['Волатильность','разброс доходности (стандартное отклонение) — мера риска.','dispersion of returns (standard deviation) — a risk measure.'],
    ['Beta','чувствительность к индексу: 1 — как рынок, >1 — резче.','sensitivity to the index: 1 = like the market, >1 = sharper.'],
    ['Alpha','доходность сверх индекса с поправкой на риск.','return above the index, risk-adjusted.'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
  betyg:{t:['🏅 Фундаментальный рейтинг','🏅 Fundamental rating'],b:()=>infoP('Единый «betyg» 0–100 (буква A+…F) из 5 столпов фундаментала. Считается из отчётности (FMP/Yahoo) и оценки — справочно, по данным последнего отчёта.','A single 0–100 «betyg» (letter A+…F) from 5 fundamental pillars. Computed from filings (FMP/Yahoo) and valuation — reference, as of the latest report.')+infoRows([
    [RT('💎 Прибыльность','💎 Profitability'),'чистая маржа (или FCF-маржа) — прибыль с каждого доллара выручки. Вес 25%.','net margin (or FCF margin) — profit per dollar of revenue. Weight 25%.'],
    [RT('📈 Рост','📈 Growth'),'CAGR выручки + год к году. Вес 20%.','revenue CAGR + YoY. Weight 20%.'],
    [RT('🏦 Баланс','🏦 Balance'),'долг/капитал и ликвидность (current ratio). Вес 20%.','debt/equity and current ratio. Weight 20%.'],
    [RT('💵 Денежный поток','💵 Cash flow'),'стабильность и маржа свободного денежного потока. Вес 20%.','free-cash-flow stability and margin. Weight 20%.'],
    [RT('🏷 Оценка','🏷 Valuation'),'P/E·P/S vs медиана сектора (из 📐 Оценки) или типового ориентира: дешевле → выше. Вес 15%.','P/E·P/S vs sector median (from 📐 Valuation) or a typical benchmark: cheaper → higher. Weight 15%.'],
    [RT('Буква','Grade'),'A+ ≥85 · A ≥75 · B ≥65 · C ≥50 · D ≥35 · F ниже.','A+ ≥85 · A ≥75 · B ≥65 · C ≥50 · D ≥35 · F below.'],
  ])+infoNote('Дешёвая оценка ≠ всегда хорошо (бывает на пике цикла); смотрите вместе с тезисом и техникой. '+INFO_DISCLAIM[0],'Cheap valuation ≠ always good (can be a cycle peak); read with the thesis and technicals. '+INFO_DISCLAIM[1])},
  health:{t:['💪 Здоровье бизнеса','💪 Business health'],b:()=>infoP('Качество фундамента компании в простых баллах.','Company fundamental quality in simple scores.')+infoRows([
    ['Баланс','долговая нагрузка (Debt/Equity) — ниже лучше.','leverage (Debt/Equity) — lower is better.'],
    ['Кэш','генерация денег (FCF-маржа).','cash generation (FCF margin).'],
    ['Рост','динамика выручки (CAGR / YoY).','revenue trajectory (CAGR / YoY).'],
    ['ROE','return on equity — отдача на капитал; >15% сильно.','return on equity; >15% is strong.'],
  ])+infoNote(INFO_DISCLAIM[0],INFO_DISCLAIM[1])},
};
function secInfo(key){const o=document.getElementById('faqOverlay');if(!o)return;const e=SEC_INFO[key];if(!e)return;document.getElementById('faqCard').innerHTML=`<button class="faq-close" onclick="toggleFaq()">✕</button><h2>${RT(e.t[0],e.t[1])}</h2><div class="faq-body">${e.b()}</div>`;o.classList.remove('hidden');}

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
  // 1.5 Метки инсайдерских сделок поверх цены (только значимые: P покупка / S продажа),
  // в контексте SMA и уровней. Каждую сделку привязываем к ближайшему бару графика.
  let insLegend='';
  try{
    const tkU=String(row[2]||'').trim().toUpperCase(), iv=INSIDER[tkU];
    if(iv&&Array.isArray(iv.tx)&&iv.tx.length&&P.length){
      const bars=P.map(p=>p.time),t0=bars[0],t1=bars[bars.length-1];
      const nearest=s=>{let best=bars[0],bd=Infinity;for(const b of bars){const dd=Math.abs(b-s);if(dd<bd){bd=dd;best=b}}return best;};
      const agg={};
      iv.tx.forEach(t=>{
        if(t.code!=='P'&&t.code!=='S'||!t.date)return;
        const ms=Date.parse(t.date+'T12:00:00Z');if(isNaN(ms))return;
        const sec=Math.floor(ms/1000);
        if(sec<t0-3*86400||sec>t1+3*86400)return;   // вне окна графика
        const bt=nearest(sec),key=bt+'|'+t.code,o=agg[key]||(agg[key]={time:bt,side:t.code,n:0,usd:0});
        o.n++;o.usd+=t.value||0;
      });
      const markers=Object.values(agg).map(m=>m.side==='P'
        ?{time:m.time,position:'belowBar',color:'#16a34a',shape:'arrowUp',text:'🟢'+(m.n>1?'×'+m.n:'')}
        :{time:m.time,position:'aboveBar',color:'#dc2626',shape:'arrowDown',text:'🔴'+(m.n>1?'×'+m.n:'')}
      ).sort((a,b)=>a.time-b.time);
      if(markers.length&&ps.setMarkers){ps.setMarkers(markers);insLegend=`<span class="cl-item cl-ins">🟢/🔴 ${RT('инсайдеры','insiders')} (${markers.length})</span>`;}
    }
  }catch(e){}
  chart.timeScale().fitContent();
  // Legend: hovered values when the crosshair moves, last values otherwise.
  const defs=[['Цена',ps,priceCol],['SMA 50',s50,'#2563eb'],['SMA 100',s100,'#f59e0b'],['SMA 200',s200,'#7c3aed']];
  const last=[P,A,B,C].map(a=>a.length?a[a.length-1].value:null);
  const paint=vals=>{legend.innerHTML=defs.map(([l,,c],i)=>`<span class="cl-item"><i style="background:${c}"></i>${l}${vals[i]!=null?` <b>${vals[i].toFixed(2)} ${ccy}</b>`:''}</span>`).join('')+insLegend;};
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
  const tk=String(r[2]||'').trim().toUpperCase(),vv=VAL[tk]||{};
  const label=kind==='pe'?'P/E':'P/S';
  // Число акции: предпочитаем VAL (тот же источник, что 📐 Оценка), иначе fundamentals.
  const vvN=kind==='pe'?vv.pe:vv.ps, fN=F?(kind==='pe'?F.pe:F.ps):null;
  const v=(vvN>0)?vvN:(fN>0?fN:null);
  if(v==null||!(v>0))return`<div class="pf3-card-l">${label}</div><div class="pf3-card-v">—</div><div class="pf3-card-s">${(F||VAL[tk])?RT('нет данных / компания убыточна','no data / loss-making'):RT('загрузка…','loading…')}</div>`;
  // Эталон сектора: живая медиана из 📐 Оценки (если загружена и в секторе ≥2 бумаг),
  // иначе — статичная константа PF3_VAL_AVG по макро-сектору.
  const med=vv.sector?(_valSecCache||valSectorMedians())[vv.sector]:null;
  const lm=med?(kind==='pe'?med.pe:med.ps):null;
  const live=lm!=null&&lm>0&&med.n>=2;
  const avg=live?lm:(PF3_VAL_AVG[pf3MacroSector(String(r[4]||''))]||[22,3])[kind==='pe'?0:1];
  const avgStr=avg>=10?Math.round(avg):Math.round(avg*10)/10;
  const diff=(v/avg-1)*100,cheap=diff<=0;
  const ttl=live?RT(`живая медиана сектора «${vv.sector}» по дашборду · ${med.n} бум.`,`live sector median «${vv.sector}» across the dashboard · ${med.n} stocks`):RT('типичная медиана сектора (ориентир) — запустите 📐 Оценку для живой','typical sector median (reference) — run 📐 Valuation for the live one');
  return`<div class="pf3-card-l">${label}</div><div class="pf3-card-v">${v.toFixed(1)}</div><div class="pf3-card-s ${cheap?'pf3-up':'pf3-down'}" title="${ttl}">${RT(`сектор ≈${avgStr} · на ${Math.abs(diff).toFixed(0)}% ${cheap?'дешевле сектора':'дороже сектора'}`,`sector ≈${avgStr} · ${Math.abs(diff).toFixed(0)}% ${cheap?'below sector avg':'above sector avg'}`)}</div>`;
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
// ── 🏅 Фундаментальный «betyg»: 5 столпов → балл 0–100 и буква A+…F ──
// Прибыльность (маржа) + Рост + Баланс + Кэш + Оценка (vs медиана сектора/ориентир).
// Прибыльность и оценка — новые; рост/баланс/кэш берём из pf3Scores. Веса 25/20/20/20/15.
function pf3Profit(F){
  if(!F||!(F.revenue>0))return null;
  const nm=(typeof F.netIncome==='number')?F.netIncome/F.revenue*100:null;   // чистая маржа (FMP)
  const fm=(typeof F.freeCashFlow==='number')?F.freeCashFlow/F.revenue*100:null;   // FCF-маржа (фолбэк, Yahoo)
  const m=nm!=null?nm:fm;
  if(m==null)return null;
  return m<0?0:m>=25?10:m>=15?9:m>=10?8:m>=6?6:m>=3?5:m>0?4:1;
}
function pf3ValScore(F,tk,sector){
  const vv=(typeof VAL!=='undefined'&&VAL[tk])||{};
  const one=kind=>{
    const vvN=kind==='pe'?vv.pe:vv.ps, fN=F?(kind==='pe'?(F.fwdPe||F.pe):F.ps):null;
    const v=(vvN>0)?vvN:(fN>0?fN:null);
    if(!(v>0))return null;
    let med=null; try{ med=vv.sector?(((typeof _valSecCache!=='undefined'&&_valSecCache)||valSectorMedians())[vv.sector]):null; }catch(e){}
    const lm=med?(kind==='pe'?med.pe:med.ps):null;
    const avg=(lm>0&&med.n>=2)?lm:((PF3_VAL_AVG[pf3MacroSector(String(vv.sector||sector||''))]||[22,3])[kind==='pe'?0:1]);
    const diff=(v/avg-1)*100;            // <0 = дешевле сектора
    return Math.max(0,Math.min(10,5-diff/10));   // −50% → 10, ±0 → 5, +50% → 0
  };
  const a=[one('pe'),one('ps')].filter(x=>x!=null);
  return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
}
function pf3Betyg(F,tk,sector){
  if(!F)return null;
  const S=pf3Scores(F);
  const pillars=[
    {key:'profit', icon:'💎', label:['Прибыльность','Profitability'], score:pf3Profit(F)},
    {key:'growth', icon:'📈', label:['Рост','Growth'],               score:S.growth},
    {key:'balance',icon:'🏦', label:['Баланс','Balance'],            score:S.balance},
    {key:'cash',   icon:'💵', label:['Денежный поток','Cash flow'],  score:S.cash},
    {key:'val',    icon:'🏷', label:['Оценка','Valuation'],          score:pf3ValScore(F,tk,sector)},
  ];
  const W={profit:0.25,growth:0.2,balance:0.2,cash:0.2,val:0.15};
  let sw=0,wsum=0;
  pillars.forEach(p=>{if(p.score!=null){sw+=p.score*W[p.key];wsum+=W[p.key];}});
  const total=wsum?sw/wsum:null;
  return {total,score100:total!=null?Math.round(total*10):null,pillars};
}
const PF3_GRADE=[[8.5,'A+','exc'],[7.5,'A','exc'],[6.5,'B','good'],[5,'C','mid'],[3.5,'D','weak']];
function pf3Grade(s){ if(s==null)return{g:'—',c:''}; for(const[t,g,c]of PF3_GRADE)if(s>=t)return{g,c}; return{g:'F',c:'crit'}; }

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
  const r=(pf3D().rows[pf3SelIdx()])||[];
  const tk=String(r[2]||'').trim().toUpperCase(),sector=String(r[4]||'');
  const B=pf3Betyg(F,tk,sector),g=pf3Grade(B&&B.total);
  const rt=p=>RT(p[0],p[1]);
  const de=F.debtToEquity,cr=F.currentRatio,fcf=F.freeCashFlow,ocf=F.operatingCashFlow,cagr=F.revenueCagr,yoy=F.revenueYoY;
  const cfLbl=(q||F.source==='yahoo')?T('за 12 мес (TTM)'):T('за фин. год');   // Yahoo's cash-flow figures are always TTM
  const nm=(typeof F.netIncome==='number'&&F.revenue>0)?F.netIncome/F.revenue*100:null;
  const fm=(typeof F.freeCashFlow==='number'&&F.revenue>0)?F.freeCashFlow/F.revenue*100:null;
  const margin=(nm!=null?`${T('Чистая маржа')} <b>${nm.toFixed(1)}%</b>`:'')+((nm!=null&&fm!=null)?' · ':'')+(fm!=null?`${T('FCF-маржа')} <b>${fm.toFixed(1)}%</b>`:'');
  const pe=F.fwdPe||F.pe;
  const detail={
    profit: margin||'—',
    growth: `${T('Выручка CAGR')} ${F.revenueYears||'—'} ${T('лет')} <b>${cagr!=null?(cagr>0?'+':'')+cagr.toFixed(1)+'%':'—'}</b> · ${q?T('Квартал г/г'):T('Год к году')} <b>${yoy!=null?(yoy>0?'+':'')+yoy.toFixed(1)+'%':'—'}</b> · ${T('Выручка')}${q?' TTM':''} <b>${pf3Bn(F.revenue,F.ccy)}</b>`,
    balance: `${T('Долг/капитал')} <b>${de!=null?de.toFixed(2):'—'}</b> · ${T('Ликвидность')} <b>${cr!=null?cr.toFixed(1):'—'}</b> · ${T('Кэш')} <b>${pf3Bn(F.cash,F.ccy)}</b>${q?' · '+T('на конец квартала'):''}`,
    cash: `${T('Свободный CF')} <b>${pf3Bn(fcf,F.ccy)}</b> · ${T('Операционный CF')} <b>${pf3Bn(ocf,F.ccy)}</b> ${cfLbl}`,
    val: `P/E${F.fwdPe?' (fwd)':''} <b>${pe>0?pe.toFixed(1):'—'}</b> · P/S <b>${F.ps>0?F.ps.toFixed(1):'—'}</b> · <span class="pf3-asof">${RT('vs медиана сектора','vs sector median')}</span>`,
  };
  const card=(icon,title,score,metrics)=>{
    const lv=pf3Lv(score);
    const verdict=lv==null?'—':`${PF3_LV[lv].e} ${T(PF3_LV[lv].l)} · ${score.toFixed(1)}`;
    return`<div class="pf3-hcard ${lv==null?'':PF3_LV[lv].c}"><div class="pf3-hcard-top"><span class="pf3-hcard-t">${icon} ${title}</span><span class="pf3-verdict ${lv==null?'':PF3_LV[lv].c}">${verdict}</span></div><div class="pf3-hmetrics">${metrics}</div></div>`;
  };
  const betyg=(B&&B.total!=null)?`<div class="pf3-betyg">
    <div class="pf3-betyg-grade ${g.c}">${g.g}</div>
    <div class="pf3-betyg-body">
      <div class="pf3-betyg-l"><span>${T('Фундаментальный рейтинг')} ${infoBtn('betyg')}</span><b>${B.score100}/100</b></div>
      <div class="pf3-scale"><div class="pf3-scale-marker" style="left:${Math.min(100,Math.max(0,B.total*10))}%"></div></div>
      <div class="pf3-scale-labels"><span>F</span><span>D</span><span>C</span><span>B</span><span>A</span></div>
    </div></div>`:'';
  const cards=(B?B.pillars:[]).map(p=>card(p.icon,rt(p.label),p.score,detail[p.key])).join('');
  return betyg+cards+`<div id="pf3FundHist" class="pf3-fundhist">${pf3FundHistHTML(F)}</div>`;
}
// История отчётности (мини-спарклайн выручки по периодам) — заполняется, когда
// воркер вернёт F.revSeries (см. ?fundamentals=). Без ряда — пусто.
function pf3FundHistHTML(F){
  const s=F&&Array.isArray(F.revSeries)?F.revSeries.filter(x=>x&&typeof x.v==='number'):[];
  if(s.length<2)return'';
  const vals=s.map(x=>x.v),mx=Math.max(...vals),mn=Math.min(0,...vals),rng=(mx-mn)||1;
  const bars=s.map(x=>{const h=Math.round(((x.v-mn)/rng)*100);const yo=x.yoy;return`<span class="fh-bar" title="${x.d||''}: ${pf3Bn(x.v,F.ccy)}${yo!=null?' · '+(yo>0?'+':'')+yo.toFixed(0)+'% г/г':''}" style="height:${Math.max(6,h)}%"></span>`;}).join('');
  const last=s[s.length-1],first=s[0];
  const tot=(first.v>0)?Math.round((last.v/first.v-1)*100):null;
  return `<div class="fh-l">${RT('Выручка по отчётам','Revenue by report')}${tot!=null?` · <b class="${tot>=0?'pf3-up':'pf3-down'}">${tot>0?'+':''}${tot}%</b> ${RT('за период','over span')}`:''}</div><div class="fh-bars">${bars}</div>`;
}

// ===== «AI Proto» sub-tab: Claude-powered portfolio analysis =====
// The worker's ?action=ai endpoint sends the snapshot to the Claude API and
// returns a markdown report; the last report is stored in pf3D().aiReport
// (synced), so it survives reloads and is visible on every device.
let pf3Ai={loading:false};

// Everything the model needs: positions with live prices, levels, targets, shares + capital.
// Последние реально исполненные сделки по портфелю (журнал) для AI-снапшота:
// семейные портфели — из PF_TRADES (фильтр по вкладке), AI-портфель — из AI_PORT.trades.
// Компактно и newest-first, до 40 записей; plSEK — реализованный P/L по продаже.
function pfRecentTrades(key){
  key=key||v3Key;
  const n=v=>{const x=parseFloat(v);return isFinite(x)?x:null};
  let src=[];
  if(key===AIP_KEY){
    src=((AI_PORT&&AI_PORT.trades)||[]).map((t,i)=>({date:t.ts?new Date(t.ts).toISOString().slice(0,10):'',act:t.action,ticker:String(t.ticker||'').toUpperCase(),qty:n(t.qty),price:n(t.price),ccy:t.ccy||'SEK',plSEK:typeof t.plSEK==='number'?Math.round(t.plSEK):null,trigger:t.trigger||null,_o:t.ts||i}));
  }else{
    src=(PF_TRADES||[]).map((t,i)=>({...t,_o:i})).filter(t=>(t.tab||PF3_KEY)===key)
      .map(t=>({date:t.date,act:t.act,ticker:String(t.tk||'').toUpperCase(),qty:n(t.qty),price:n(t.price),ccy:t.ccy||'SEK',plSEK:t.plNative!=null?Math.round(t.plNative*(FX[t.ccy]||1)):null,_o:t._o}));
  }
  src.sort((a,b)=>(a.date<b.date?1:a.date>b.date?-1:(b._o-a._o)));
  return src.slice(0,40).map(({_o,...t})=>t);
}
function pf3AiSnapshot(key){
  key=key||v3Key;
  const d=DATA[key],h=d.headers,{s50,s100,s200}=smaIdx(d);
  const supC=h.indexOf('Поддержка'),resC=h.indexOf('Сопротивление'),tgC=h.findIndex(x=>/аналит/i.test(x));
  // 🏅 Лёгкий фундамент-рейтинг «betyg» по строке (ROE/рост/оценка) → буква A–F.
  // Тот же скор, что в сортируемой колонке «Рейтинг»; даёт AI быстрый срез
  // качества по каждой бумаге без подгрузки полного фундаментала по всем позициям.
  const roeC=h.indexOf('ROE'),revgC=h.indexOf('Рост выручки'),peC=h.indexOf('P/E'),psC=h.indexOf('P/S');
  const numC=(r,i)=>{const v=i>=0?parseFloat(r[i]):NaN;return isFinite(v)?v:null};
  const rowBetyg=r=>{try{
    if(typeof pf3RowBetyg!=='function')return null;
    const b=pf3RowBetyg({roe:numC(r,roeC),revg:numC(r,revgC),pe:numC(r,peC),ps:numC(r,psC),sec:r[4],r});
    return b!=null?{score100:Math.round(b*10),grade:(pf3Grade(b)||{}).g||null}:null;
  }catch(e){return null}};
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
          betyg:rowBetyg(r),
          phase:c.label,signal:sig.type!=='none'?`${sig.type}${sig.n?' '+sig.n:''}${typeof sig.dist==='number'?' '+sig.dist.toFixed(1)+'%':''}`:null};
      }),
      investorRules:[],   // 🤖 автономия: личные правила отменены
      playbook:aiPlaybookEnsure(),
      trackRecord:aiTrackRecord(),
      userNews:newsForAi(),
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
    betyg:rowBetyg(r),   // 🏅 фундамент-рейтинг бумаги (буква A–F + 0–100)
  }));
  // Allocation summary — the same numbers the «Состояние портфеля» tab shows.
  const group=key=>{const m={};positions.forEach(p=>{const k=p[key]||'—';m[k]=(m[k]||0)+(p.valueSEK||0)});return Object.entries(m).map(([k,v])=>({name:k,pct:totalVal>0?Math.round(v/totalVal*1000)/10:0})).sort((a,b)=>b.pct-a.pct)};
  const trades=pfRecentTrades(key);
  const realizedPLSEK=Math.round(trades.reduce((a,t)=>a+(t.plSEK||0),0));
  return{
    baseCurrency:'SEK',fxToSEK:FX,positions,
    allocation:{bySector:group('sector'),byCurrency:group('ccy')},
    totals:{stocksSEK:Math.round(totalVal),freeCashSEK:Math.round((num(d.cashFree)||0)*pf3BaseFx(d)),leverageSEK:Math.round((key===PF3_KEY?(num(d.leverage)||0):0)*pf3BaseFx(d))},
    // Уже СОВЕРШЁННЫЕ сделки по этому портфелю (журнал) — AI обязан учитывать их
    // ПЕРЕД советами: не предлагать обратное недавнему действию без причины и т.д.
    recentTrades:trades,realizedPLSEK,
    investorRules:[],   // 🤖 автономия: личные правила отменены — AI оптимизирует свободно
    playbook:aiPlaybookEnsure(),   // 📚 методичка «как обгонять индекс» — применяй
    trackRecord:aiTrackRecord(),   // 🎯 сбывались ли прошлые вердикты — учись на результатах
    benchmarks:aiBenchmarks(),     // 🆚 состав индексов по секторам — для оценки недовеса
    // Живой рыночный контекст: статистика фаз по индексным вкладкам + сводки
    // их последних AI-обзоров — портфельный анализ опирается на состояние рынка.
    marketContext:v3Tabs().filter(k=>!pf3IsPort(k)&&DATA[k]).map(k=>{
      const di=DATA[k],phases={};
      di.rows.forEach(r=>{const c=pf3Criterion(di,r);phases[c.label]=(phases[c.label]||0)+1});
      const last=(di.aiHistory||[])[0];
      return{index:k,phases,
        lastAiReview:last?{at:last.at,summary:(last.proposal&&last.proposal.summary)||String(last.text||'').slice(0,1200)}:null};
    }),
    userNews:newsForAi(),   // 📰 вставленная пользователем сводка новостей (если есть)
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
// ── Фоновый AI: воркер считает в ctx.waitUntil и пишет результат в ai_jobs;
// клиент опрашивает таблицу до status='done'/'error'. Снимает лимит по времени. ──
function aiJobId(){try{return crypto.randomUUID()}catch(_){return 'job-'+Date.now()+'-'+Math.floor(Math.random()*1e9)}}
// Фоновый режим (ctx.waitUntil + ai_jobs) ВЫКЛЮЧЕН по умолчанию: он требует
// таблицу ai_jobs И корректную RLS-политику чтения; если политика не отдаёт
// строки, клиент не видит результат и ловит таймаут. Синхронный стриминг
// надёжнее (keepalive держит длинные прогоны без таблицы). Включить можно,
// когда таблица+RLS подтверждены: AI_BG_ENABLED=true.
const AI_BG_ENABLED=false;
// Доступна ли таблица ai_jobs? (используется только при AI_BG_ENABLED)
let _aiJobsReady=null;
async function aiJobsReady(){
  if(_aiJobsReady!=null)return _aiJobsReady;
  if(!sb){_aiJobsReady=false;return false;}
  try{ const{error}=await sb.from('ai_jobs').select('job_id').limit(1); _aiJobsReady=!error; }
  catch(_){ _aiJobsReady=false; }
  return _aiJobsReady;
}
async function aiJobPoll(jobId,opt){
  const timeoutMs=(opt&&opt.timeoutMs)||6*60*1000,intervalMs=(opt&&opt.intervalMs)||4000;
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    await new Promise(r=>setTimeout(r,intervalMs));
    if(!sb)break;
    try{
      const{data}=await sb.from('ai_jobs').select('status,result,error').eq('job_id',jobId).maybeSingle();
      if(data){
        if(data.status==='done')return{ok:true,result:data.result};
        if(data.status==='error')return{ok:false,error:data.error||'AI error'};
      }
    }catch(_){/* сеть/таблицы нет — продолжаем опрос до дедлайна */}
  }
  return{ok:false,error:RT('таймаут ожидания результата (фоновый прогон не записался — создана ли таблица ai_jobs?)','result wait timeout (was ai_jobs table created?)')};
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
    await aiLoadIdxHist().catch(()=>{});   // история индексов → альфа в трек-рекорде
    await pf3PullHoldingsNews(key).catch(()=>{});   // 📰 свежие новости по позициям → анализ актуален
    const snap=pf3AiSnapshot(key);
    const ln=pf3LiveNewsForAi(key); if(ln)snap.liveNews=ln;   // живые заголовки + тональность по позициям
    // Вариант B: детерминированные вердикты скоринга сайта по всем тикерам —
    // чтобы «Предложение» AI было согласовано с вердиктом «Рекомендация» в карточке
    // и таблицах. Расхождение допускается, но AI обязан развести его по горизонтам.
    snap.recoLegend='{ТИКЕР:[recoVerdict(buy|wait|sell|avoid), upside%toTarget, %отSMA50, %отSMA200, P/E, вЭтомПортфеле(1|0)]} — детерминированный скоринг сайта (та же логика, что вердикт «Рекомендация» в карточке/таблицах). Это КРАТКОСРОЧНО-технический вердикт.';
    snap.recoVerdicts=dashRecoMap(key);
    // 🧪 Раздел 6 ТЗ: проверенный на истории rule-based прото-сигнал + реализованная
    // точность правил из журнала — как «прото-уровень доверия» к технике.
    try{
      if(!(DATA[key]&&DATA[key].btSignals))await btCompute(key);   // history кэширована → дёшево
      const dK=DATA[key];
      if(dK&&dK.btSignals&&Object.keys(dK.btSignals).length){
        snap.protoSignals=dK.btSignals;
        snap.protoLegend='{ТИКЕР:{s:прото-сигнал[-1..+1], v:long|reduce|neutral, h:hit-rate% на отложенной выборке|null}} — ДЕТЕРМИНИРОВАННЫЙ rule-based сигнал (SMA/RSI/ATR/уровни), проверенный на 2-летней истории. Высокий h = сигнал исторически сбывался; используй как подтверждение/контраргумент к recoVerdict, не как приказ.';
        if(dK.btRuleAcc&&Object.keys(dK.btRuleAcc).length)snap.ruleAccuracy=dK.btRuleAcc;
      }
    }catch(e){}
    // 💬 Опционально передаём последние сообщения из чата с AI Proto — чтобы анализ учёл пожелания/идеи из переписки.
    if(AI_INCL_CHAT&&AI_CHAT.length)snap.chatNotes=AI_CHAT.slice(-20).map(m=>({role:m.role,content:String(m.content||'').slice(0,2000)}));
    if(AI_BG_ENABLED&&await aiJobsReady()){ snap.jobId=aiJobId();snap.portfolioKey=key; }   // фон только при включённом флаге; иначе синхронный стриминг
    const r=await fetch(PRICE_PROXY+'?action=ai',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},body:JSON.stringify(snap)});
    const bodyText=await r.text();
    let j=null;try{j=JSON.parse(bodyText)}catch(_){}
    if(j&&j.queued){   // фоновый прогон — ждём результат из ai_jobs
      const res=await aiJobPoll(j.jobId);
      if(res.ok&&res.result)j=res.result;else{toast('AI ('+TAB_LABEL(key)+'): '+(res.error||'нет результата'),true);pf3Ai.loading=false;if(isV3())renderPF3();return;}
    }
    if(j&&j.text){
      const d=DATA[key];
      aiSpendAdd(j.cost);
      const entry={text:j.text,proposal:j.proposal||null,at:new Date().toISOString(),cost:j.cost||null};
      d.aiHistory=[entry,...(d.aiHistory||(d.aiReport?[d.aiReport]:[]))].slice(0,10);   // keep the last 10 runs
      delete d.aiReport;   // superseded by aiHistory
      scheduleSave();
      toast('🤖 '+RT('Анализ готов — отчёт сохранён в «'+TAB_LABEL(key)+'»','Analysis ready — saved to '+TAB_LABEL(key)));
    }else{
      // Показать НАСТОЯЩУЮ причину от воркера (раньше пряталась за общим тостом).
      const msg=(j&&j.error)||(bodyText?bodyText.slice(0,220):('HTTP '+r.status));
      console.warn('AI run failed:',r.status,bodyText);
      toast('AI ('+TAB_LABEL(key)+'): '+msg,true);
    }
  }catch(e){toast('AI: '+(e&&e.message||RT('сеть/worker недоступен','network/worker unreachable')),true);}
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
  // 🏅 Фундаментальный рейтинг «betyg» (0–100 + буква A–F + 5 столпов) — тот же,
  // что инвестор видит в карточке «💪 Здоровье бизнеса». Даёт AI единую оценку
  // качества бизнеса (прибыльность/рост/баланс/денежный поток/оценка).
  let betyg=null;
  try{
    const B=(typeof pf3Betyg==='function'&&F)?pf3Betyg(F,tk,r[4]):null;
    if(B&&B.score100!=null)betyg={score100:B.score100,grade:(pf3Grade(B.total)||{}).g||null,
      pillars:(B.pillars||[]).map(p=>({key:p.key,label:p.label&&p.label[0],score:p.score!=null?Math.round(p.score*10)/10:null}))};
  }catch(e){}
  // 📊 Режим объёма торгов (лайв из карточки): ×N к среднему дневному за 3 мес +
  // подтверждает ли объём дневное движение цены (важно для горизонта «сейчас»).
  let volume=null;
  try{
    const cv=(typeof CARD_VOL!=='undefined')&&CARD_VOL[tk];
    if(cv&&cv.vol>0){
      volume={vol:cv.vol,avgVol:cv.avgVol||null};
      if(cv.avgVol>0){const m=cv.vol/cv.avgVol;volume.relToAvg=Math.round(m*10)/10;
        volume.regime=m>=2?'frenzy':m>=1.5?'elevated':m>=0.7?'normal':'low';
        if(typeof cv.day==='number'&&Math.abs(cv.day)>=1.5)volume.confirmsMove=m>=1.5?true:(m<0.7?false:null);}
    }
  }catch(e){}
  return{
    ticker:tk,name:r[1],sector:r[4],type:(tf&&tf.primary)||r[5],ccy:r[8]||'USD',
    price,dayPct:num(10),
    sma50:s50>=0?num(s50):null,sma100:s100>=0?num(s100):null,sma200:s200>=0?num(s200):null,
    support:g('Поддержка'),resistance:g('Сопротивление'),analystTarget:g('Аналит. таргет'),
    pe:g('P/E'),ps:g('P/S'),roe:g('ROE'),de:g('D/E'),revGrowthPct:g('Рост выручки'),
    revenueTTM:g('Выручка TTM'),marketCap:g('Кап-я'),dividendPct:g('Дивид. %'),
    // revSeries — история отчётности (выручка по годам/кварталам с ростом г/г),
    // тот же ряд, что рисует спарклайн в карточке; AI видит траекторию роста.
    fundamentals:F?{revenue:F.revenue,revenueYoY:F.revenueYoY,revenueCagr:F.revenueCagr,fcf:F.freeCashFlow,debtToEquity:F.debtToEquity,netIncome:F.netIncome,pe:F.pe,fwdPe:F.fwdPe,ps:F.ps,revSeries:Array.isArray(F.revSeries)?F.revSeries:null}:null,
    betyg,volume,
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
function aiSpendLine(){if(!AI_SPEND||!AI_SPEND.runs||!can('data.show_ai_cost'))return'';return`💸 ${RT('AI-расходы','AI spend')}: $${(AI_SPEND.usd||0).toFixed(2)} · ${AI_SPEND.runs} ${RT('прогон.','runs')}`;}
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
      scheduleSave(); pushSharedAnalysis();   // общие данные → все пользователи
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
  const canRun=can('action.run_ai');   // кнопку запуска видит только тот, кому можно тратить AI; результат — по view.ai_reco
  const btn=canRun?`<button class="pf3-btn pf3-btn-sm" onclick="aiRecoRun(event)"${loading?' disabled':''}>${loading?'⏳…':'🔄 '+RT('AI-Рекомендация','AI recommendation')+(v?' · '+RT('обновить','refresh'):'')}</button>`:'';
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
  }else body=`<div class="pf3-empty">${canRun?RT('Нажмите «🔄 AI-Рекомендация» — Claude взвесит технику, фундаментал, оценку, свежие новости и мировую ситуацию и даст единый вердикт. Детерминированный скоринг «Рекомендация» выше остаётся как есть.','Press «🔄 AI recommendation» — Claude weighs technicals, fundamentals, valuation, fresh news and the global picture into one verdict. The deterministic «Рекомендация» score above stays as is.'):RT('AI-Рекомендация по этой бумаге ещё не сформирована.','No AI recommendation for this stock yet.')}</div>`;
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
                try{await fetch(PRICE_PROXY+'?action=insidernotify',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({ticker:tk,name:names[tk]||tk,uniqueBuyers:v.cluster.uniqueBuyers,sumUSD:v.cluster.sumUSD,windowDays:v.cluster.windowDays,fromDate:v.cluster.fromDate,toDate:v.cluster.toDate,cross:valContextLine(tk)})});}catch(e){}
              }
            }
          }
        }
      }catch(e){}
      done+=chunk.length;
      const b=document.getElementById('insiderBtn');
      if(b)b.textContent=`⏳ ${Math.round(done/list.length*100)}%`;
    }
    scheduleSave(); pushSharedAnalysis();   // общие данные → все пользователи
    toast('🕵 '+RT(`Инсайдеры обновлены: ${withData}/${list.length} с данными · ${clusters} нов. кластер.`,`Insiders updated: ${withData}/${list.length} with data · ${clusters} new cluster(s)`));
  }catch(e){toast(RT('Worker недоступен (нужен эндпоинт ?action=insider)','Worker unreachable (?action=insider)'),true);}
  finally{_insiderBusy=false;renderAll();}
}
function insiderFmtUSD(v,ccy){if(v==null)return'—';const n=Math.round(v);return ccy==='SEK'?n.toLocaleString('sv-SE')+' kr':'$'+n.toLocaleString('en-US')}
function insiderSetFilter(k,val){insiderFilter[k]=(k==='minUSD')?(parseFloat(val)||0):val;renderPF3();}
// Классификация инсайдерской сделки по коду (Finnhub/FI): что значимо, что шум.
// P — покупка на свои (главный сигнал); S — продажа; M/A/F/G/C — рутина/плановое.
function insiderTxKind(code){
  const c=String(code||'').toUpperCase();
  if(c==='P')return{label:RT('Покупка с рынка','Open-market buy'),cls:'p',routine:false,icon:'🟢'};
  if(c==='S')return{label:RT('Продажа','Sale'),cls:'s',routine:false,icon:'🔴'};
  if(c==='M')return{label:RT('Опцион','Option exercise'),cls:'r',routine:true,icon:'⚙'};
  if(c==='A')return{label:RT('Грант','Grant/award'),cls:'r',routine:true,icon:'🎁'};
  if(c==='F')return{label:RT('Налог/удержание','Tax/withholding'),cls:'r',routine:true,icon:'📄'};
  if(c==='G')return{label:RT('Дарение','Gift'),cls:'r',routine:true,icon:'🎀'};
  if(c==='C')return{label:RT('Конвертация','Conversion'),cls:'r',routine:true,icon:'🔁'};
  return{label:c||'—',cls:'',routine:true,icon:'•'};
}
// Сводка одной строкой: чистая покупка/продажа за 30 дней + число инсайдеров.
function insiderHeadline(v){
  const cc=v.valCcy;
  const buyers=new Set((v.tx||[]).filter(t=>t.code==='P'&&t.name).map(t=>t.name)).size;
  const sellers=new Set((v.tx||[]).filter(t=>t.code==='S'&&t.name).map(t=>t.name)).size;
  if(v.netUSD>0)return{cls:'pf3-up',icon:'🟢',txt:RT(`Чистая покупка: +${insiderFmtUSD(v.netUSD,cc)} за 30 дней${buyers?` · ${buyers} ${buyers===1?'инсайдер':'инсайд.'}`:''}`,`Net buying: +${insiderFmtUSD(v.netUSD,cc)} over 30d${buyers?` · ${buyers} insider${buyers===1?'':'s'}`:''}`)};
  if(v.netUSD<0)return{cls:'pf3-down',icon:'🔴',txt:RT(`Чистая продажа: ${insiderFmtUSD(v.netUSD,cc)} за 30 дней${sellers?` · ${sellers} инсайд.`:''}`,`Net selling: ${insiderFmtUSD(v.netUSD,cc)} over 30d${sellers?` · ${sellers} insiders`:''}`)};
  return{cls:'val-mid',icon:'⚪',txt:RT('Нейтрально за 30 дней','Neutral over 30d')};
}
// Таймлайн покупок (1.4): точки сделок code=P на оси времени, цвет по инсайдеру.
// Синхронные покупки в узком окне = более сильный кластер — видно сразу.
function insiderTimeline(v){
  const buys=(v.tx||[]).filter(t=>t.code==='P'&&t.date);
  const times=buys.map(t=>({t,ms:Date.parse(t.date)})).filter(x=>!isNaN(x.ms));
  if(times.length<2)return '';
  const max=Math.max(...times.map(x=>x.ms)), min=Math.min(...times.map(x=>x.ms)), span=Math.max(1,max-min);
  const buyers=[...new Set(times.map(x=>x.t.name||'?'))];
  const COL=['#34d399','#60a5fa','#f59e0b','#f472b6','#22d3ee','#a78bfa','#fbbf24'];
  const dots=times.map(x=>{const left=((x.ms-min)/span)*100;const ci=buyers.indexOf(x.t.name||'?');return`<span class="ins-tl-dot" style="left:${left}%;background:${COL[ci%COL.length]}" title="${(x.t.name||'?')} · ${x.t.date} · ${insiderFmtUSD(x.t.value,v.valCcy)}"></span>`}).join('');
  const dt=ms=>new Date(ms).toISOString().slice(5,10);
  return`<div class="ins-tl"><div class="ins-tl-h">📈 ${RT('Таймлайн покупок','Buy timeline')} · ${times.length} ${RT('сделок','trades')} · ${buyers.length} ${RT('инсайд.','insiders')}</div><div class="ins-tl-bar">${dots}</div><div class="ins-tl-x"><span>${dt(min)}</span><span>${dt(max)}</span></div></div>`;
}
// Панель инсайдеров в карточке акции.
function insiderHTML(d,r){
  const tk=String(r[2]||'').trim().toUpperCase();
  const v=INSIDER[tk];
  const cc=v&&v.valCcy;
  const cluster=v&&v.cluster;
  const srcL=v&&v.src==='fi'?' <span class="ins-src">FI 🇸🇪</span>':'';
  const head=`<div class="pf3-panel-hd"><span>🕵 ${RT('Инсайдеры','Insiders')} ${infoBtn('insider')}${srcL} ${cluster?`<span class="ins-cluster">🟢 CLUSTER BUY · ${cluster.uniqueBuyers} ${RT('инсайд.','insiders')}${cluster.sumUSD?' · '+insiderFmtUSD(cluster.sumUSD,cc):''}</span>`:''}</span>
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
  const rows=tx.length?tx.map(t=>{const k=insiderTxKind(t.code);return`<div class="ins-row${k.routine?' ins-routine':''}">
    <span class="ins-code ${k.cls}" title="${k.routine?RT('рутинная / плановая — шум','routine / planned — noise'):RT('значимая сделка','meaningful trade')}">${k.icon} ${k.label}</span>
    <span class="ins-name">${t.name||'—'}</span>
    <span class="ins-qty">${pf3Fmt(t.shares)} × ${t.price!=null?pf3Fmt(t.price,2):'—'}</span>
    <span class="ins-val">${t.value!=null?insiderFmtUSD(t.value,cc):'—'}</span>
    <span class="ins-date">${t.date||''}</span>
  </div>`}).join(''):`<div class="pf3-empty" style="padding:6px">${RT('Под фильтр ничего не попадает','Nothing matches the filter')}</div>`;
  const hl=insiderHeadline(v);
  const headline=`<div class="ins-headline ${hl.cls}">${hl.icon} ${hl.txt}</div>`;
  const timeline=insiderTimeline(v);
  return`<section class="pf3-panel">${head}${headline}${cards}${timeline}<details class="ins-details"><summary class="ins-summary">📋 ${RT('Сделки инсайдеров','Insider trades')} · ${v.txCount} <span class="ins-legend">· ${RT('🟢 покупка значима · ⚙🎁 опцион/грант = шум','🟢 buy is signal · ⚙🎁 option/grant = noise')}</span><span class="ins-chevron">▾</span></summary>${fl}<div class="ins-list">${rows}</div></details></section>`;
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
      body:JSON.stringify({messages:AI_CHAT.slice(-16).map(m=>({role:m.role,content:m.content})),prefs:[],snapshot:pf3AiSnapshot()})});
    const j=await r.json();
    if(j&&j.reply){
      aiSpendAdd(j.cost);
      AI_CHAT.push({role:'assistant',content:j.reply,at:new Date().toISOString()});
      AI_CHAT=AI_CHAT.slice(-40);   // держим последние 40 сообщений
      // 🤖 автономия: новые «правила инвестора» больше не накапливаем — AI решает сам
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
function aiPlaybookAdd(){const inp=document.getElementById('aiPbInp');const t=(inp&&inp.value||'').trim();if(!t)return;aiPlaybookEnsure();if(!AI_PLAYBOOK.includes(t))AI_PLAYBOOK.push(t);inp.value='';scheduleSave();renderPF3()}
function aiPlaybookDel(i){aiPlaybookEnsure();AI_PLAYBOOK.splice(i,1);scheduleSave();renderPF3()}
function aiPlaybookReset(){if(confirm(RT('Вернуть плейбук к стандартному набору принципов?','Reset the playbook to the default principles?'))){AI_PLAYBOOK=DEFAULT_PLAYBOOK.slice();scheduleSave();renderPF3()}}
// ✨ AI подтягивает свежие лучшие практики (web_search) и дописывает их в плейбук.
let _aiPbBusy=false;
async function aiPlaybookAiRun(){
  if(_aiPbBusy||!isAdmin())return;
  _aiPbBusy=true;renderPF3();
  try{
    const r=await fetch(PRICE_PROXY+'?action=playbook',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},body:JSON.stringify({current:aiPlaybookEnsure()})});
    const j=await r.json();
    if(j&&j.playbook&&Array.isArray(j.playbook.items)){
      aiSpendAdd(j.cost);
      let added=0;
      j.playbook.items.forEach(p=>{const t=String(p).trim();if(t&&!AI_PLAYBOOK.includes(t)){AI_PLAYBOOK.push(t);added++;}});
      scheduleSave();
      toast(RT(`✓ Плейбук: добавлено ${added} принципов`,`✓ Playbook: added ${added} principles`),added===0);
    }else toast((j&&j.error)||RT('AI не ответил','AI did not respond'),true);
  }catch(e){toast('AI: '+(e&&e.message||RT('сеть/worker','network/worker')),true);}
  _aiPbBusy=false;renderPF3();
}
function aiChatScroll(){const b=document.getElementById('aiChatBox');if(b)b.scrollTop=b.scrollHeight}

function pf3PlaybookHTML(){
  aiPlaybookEnsure();
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${RT('📚 Инвест-плейбук — методичка «как обгонять индекс»','📚 Investing playbook — how to beat the index')} ${infoBtn('playbook')}</span><span class="pf3-asof"><a href="#" onclick="aiPlaybookReset();return false">${RT('сбросить к стандарту','reset to default')}</a></span>${isAdmin()?`<button class="pf3-btn pf3-btn-sm" id="aiPbBtn" onclick="aiPlaybookAiRun()"${_aiPbBusy?' disabled':''}>${_aiPbBusy?'⏳ '+RT('Ищу практики…','Searching…'):'✨ '+RT('Подтянуть практики (AI)','Pull practices (AI)')}</button>`:''}</div>
    <div class="pf3-ai-note">${RT('Передаётся во все анализы AI Proto как стратегические принципы. Редактируйте под себя.','Sent to every AI Proto analysis as strategic principles. Edit to your taste.')}</div>
    ${AI_PLAYBOOK.map((p,i)=>`<div class="ai-pref"><span>• ${esc(p)}</span><button class="pf3-del" onclick="aiPlaybookDel(${i})" title="${RT('Удалить принцип','Remove principle')}">🗑</button></div>`).join('')||`<div class="pf3-empty">${RT('Плейбук пуст','Playbook is empty')}</div>`}
    <form class="ai-chat-form" onsubmit="event.preventDefault();aiPlaybookAdd()">
      <input id="aiPbInp" placeholder="${RT('Добавить принцип…','Add a principle…')}" autocomplete="off">
      <button class="pf3-btn" type="submit">${RT('➕ Добавить','➕ Add')}</button>
    </form>
  </section>`;
}
function pf3TrackHTML(){
  aiEnsureIdxHist();   // подгрузить историю индексов для альфы (фоном, с ре-рендером)
  const tr=aiTrackRecord();
  const vlabel={buy:['Покупать','Buy'],wait:['Ждать','Wait'],sell:['Сократить','Trim'],avoid:['Избегать','Avoid']};
  const vl=v=>RT((vlabel[v]||[v,v])[0],(vlabel[v]||[v,v])[1]);
  if(!tr)return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>${RT('🎯 Трек-рекорд разборов','🎯 Analysis track record')}</span></div><div class="pf3-empty">${RT('Пока мало данных — появится после AI-разборов акций (🔬) с известной ценой входа.','Not enough data yet — appears after stock AI analyses (🔬) with a known entry price.')}</div></section>`;
  const al=v=>v==null?'':` · <span class="${v>=0?'pf3-up':'pf3-down'}">α ${v>=0?'+':''}${v}%</span>`;
  const rows=Object.entries(tr.byVerdict).map(([v,a])=>`<div class="tr-row"><span class="tr-act ${v==='sell'||v==='avoid'?'sell':'buy'}">${vl(v)}</span><span>${a.n}</span><span class="${a.hitRate>=50?'pf3-up':'pf3-down'}">${RT('точн.','hit')} ${a.hitRate}%</span><span class="${a.avgRetPct>=0?'pf3-up':'pf3-down'}">${RT('ср.','avg')} ${a.avgRetPct>=0?'+':''}${a.avgRetPct}%</span>${a.avgAlphaPct!=null?`<span class="${a.avgAlphaPct>=0?'pf3-up':'pf3-down'}">α ${a.avgAlphaPct>=0?'+':''}${a.avgAlphaPct}%</span>`:''}</div>`).join('');
  const recent=tr.recent.map(e=>`<div class="tr-row"><span class="tr-qty">${e.ticker}</span><span class="pf3-asof">${e.date}</span><span>${vl(e.verdict)}</span><span class="${e.good?'pf3-up':'pf3-down'}">${e.good?'✓':'✕'} ${e.retPct>=0?'+':''}${e.retPct}%${al(e.alphaPct)}</span></div>`).join('');
  const alphaHd=tr.overallAlphaHitRate!=null?` · α ${tr.avgAlphaPct>=0?'+':''}${tr.avgAlphaPct}% (${tr.overallAlphaHitRate}% ${RT('обгон','beat')})`:'';
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${RT('🎯 Трек-рекорд разборов','🎯 Analysis track record')}</span><span class="pf3-asof">${RT('точность','hit')} ${tr.overallHitRate}% · ${tr.samples} ${RT('разборов','calls')}${alphaHd}</span></div>
    <div class="pf3-ai-note">${RT('Сбывались ли вердикты по направлению цены + α — доходность бумаги минус индекс (^NDX для USD, ^OMX для SEK) за тот же период. Передаётся AI Proto — он учится на результатах.','Did verdicts match price direction + α — stock return minus its index (^NDX for USD, ^OMX for SEK) over the same period. Fed to AI Proto so it learns from outcomes.')}</div>
    ${rows}
    ${recent?`<div class="pf3-ai-note" style="margin-top:6px">${RT('Последние','Recent')}:</div>${recent}`:''}
  </section>`;
}
function pf3AiHTML(){
  const H=pf3AiHist(),last=H[0];
  const newsHas=Object.keys(NEWS_IMPACT||{}).length;
  let h=`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>📰 ${RT('Новости → влияние (без токенов)','News → impact (no tokens)')} ${infoBtn('news')}</span><span class="pf3-asof">${RT('вставьте сводку — оцените влияние на все акции','paste a summary — score the impact on all stocks')}</span></div>
    <textarea id="newsInp" class="news-inp" placeholder="${RT('Вставьте сводку последних мировых новостей…','Paste a summary of recent world news…')}" oninput="newsSetText(this.value)">${(NEWS_TEXT||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</textarea>
    <div class="pf3-ai-bar">
      <button class="pf3-btn" onclick="newsAnalyzeFree()">🔎 ${RT('Проанализировать (бесплатно)','Analyze (free)')}</button>
      <button class="pf3-btn sim-buy" onclick="newsAnalyzePaid()" ${pf3Ai.loading?'disabled':''}>✨ ${RT('Углубить AI-анализом (платно)','Deepen with AI (paid)')}</button>
      ${newsHas?`<a href="#" class="pf3-ai-note" onclick="newsClear();return false">${RT('очистить','clear')}</a>`:''}
    </div>
    ${newsImpactHTML()}
    <div class="pf3-ai-note">${RT('Бесплатно: сопоставляет текст с акциями по тикеру/названию и оценивает тональность по словарю — без AI-токенов. «Платно» отправляет сводку в AI Proto как контекст. Справочно, не рекомендация.','Free: matches text to stocks by ticker/name and scores sentiment by lexicon — no AI tokens. «Paid» sends the summary to AI Proto as context. Reference, not advice.')}</div>
  </section>
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${T('🤖 AI Proto — обучается, анализирует портфель и обгоняет индексы')}</span><span class="pf3-asof">${last&&last.at?'обновлено '+pf3DtRu(last.at)+(last.cost?' · '+costLine(last.cost):''):''}</span></div>
    <div class="pf3-ai-bar">
      <button class="pf3-btn" onclick="pf3AiRun()" ${pf3Ai.loading?'disabled':''}>${pf3Ai.loading?T('⏳ Анализирую… (30–60 сек)'):T('🔮 Проанализировать портфель')}</button>
      <label class="pf3-incl-chat" title="${RT('Передать последние сообщения из чата с AI Proto в следующий анализ портфеля — AI учтёт ваши пожелания и идеи из переписки.','Pass the latest AI Proto chat messages into the next portfolio analysis — the AI will factor in your wishes and ideas from the conversation.')}"><input type="checkbox" ${AI_INCL_CHAT?'checked':''} onchange="aiToggleInclChat()"> 💬 ${RT('Учесть чат','Include chat')}${AI_CHAT.length?` (${AI_CHAT.length})`:''}</label>
      <span class="pf3-ai-note">${v3Key===PF3_KEY?RT('Claude получит состав портфеля, живые цены, уровни SMA/поддержки, таргеты аналитиков и кэш — и вернёт отчёт с рекомендациями и план ребалансировки (вкладка «⚖️ Предложение»). Включите «💬 Учесть чат», чтобы добавить в анализ комментарии из переписки.','Claude gets your holdings, live prices, SMA/support levels, analyst targets and cash — and returns a report with recommendations plus a rebalancing plan (the ⚖️ Proposal tab). Toggle «💬 Include chat» to add your conversation comments to the analysis.'):RT(`Claude получит все ${pf3D().rows.length} акций вкладки с живыми ценами, уровнями, фазами и таргетами — и выделит самые актуальные с рекомендациями. Включите «💬 Учесть чат», чтобы добавить комментарии из переписки.`,`Claude gets all ${pf3D().rows.length} stocks of this tab with live prices, levels, phases and targets — and highlights the most relevant ones. Toggle «💬 Include chat» to add your conversation comments.`)}</span>
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
    <div class="pf3-panel-hd"><span>${T('💬 Чат с AI Proto')}</span><span class="pf3-asof">${AI_CHAT.length?`<a href="#" onclick="aiChatClear();return false">${T('очистить')}</a>`:RT('видит портфель и цены · автономный','sees your portfolio and prices · autonomous')}</span></div>
    <div class="ai-chat-box" id="aiChatBox">${msgs||'<div class="pf3-empty">Спросите что угодно о портфеле и рынке: «Стоит ли докупать Micron?», «Куда вложить 20 000 kr?». Скажите ассистенту свои правила — он запомнит их и будет учитывать в анализах.</div>'}${aiChatBusy?'<div class="ai-msg bot ai-typing">⏳ AI Proto думает…</div>':''}</div>
    <form class="ai-chat-form" onsubmit="event.preventDefault();aiChatSend()">
      <input id="aiChatInp" placeholder="${T('Ваш вопрос или указание ассистенту…')}" autocomplete="off" ${aiChatBusy?'disabled':''}>
      <button class="pf3-btn sim-buy" type="submit" ${aiChatBusy?'disabled':''}>${T('Отправить')}</button>
    </form>
  </section>
  <section class="pf3-panel">
    <div class="pf3-panel-hd"><span>🤖 ${RT('Автономный режим AI Proto','AI Proto autonomous mode')} ${infoBtn('aiauto')}</span><span class="pf3-asof">${RT('пользовательские правила отменены','user rules cancelled')}</span></div>
    <div class="pf3-reco-note">${RT('AI Proto работает автономно: личные правила инвестора отменены и НЕ ограничивают советы. Он сам анализирует все акции, ведёт AI-Портфель и оптимизирует все портфели по плейбуку и свежим фактам. Цель — обогнать все индексы и максимизировать прибыль. Ориентир задаётся через 📚 Плейбук ниже.','AI Proto runs autonomously: personal investor rules are cancelled and do NOT constrain advice. It analyzes all stocks, runs the AI portfolio and optimizes every portfolio by the playbook and fresh facts. The goal is to beat all indices and maximize profit. Steer it via the 📚 Playbook below.')}</div>
  </section>
  ${pf3PlaybookHTML()}
  ${pf3TrackHTML()}`;
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
  if(P.changedSince&&String(P.changedSince).trim())h+=`<div class="pf3-prop-changed">🔄 <b>${RT('Что изменилось с прошлого анализа','What changed since last time')}:</b> ${pf3Md(String(P.changedSince))}</div>`;
  (P.actions||[]).forEach((a,i)=>{
    const cls=/куп/i.test(a.action)?'buy':/прода|сократ/i.test(a.action)?'sell':'hold';
    h+=`<div class="pf3-prop-row">
      <span class="pf3-prop-n">${i+1}</span>
      <span class="pf3-prop-act ${cls}">${a.action||''}</span>
      <div class="pf3-prop-info"><b>${a.name||''} <span class="pf3-cal-tk">${a.ticker||''}</span></b><span>${a.details||''}</span></div>
      <span class="pf3-prop-amt">${typeof a.amountSEK==='number'&&a.amountSEK>0?'≈'+pf3Fmt(a.amountSEK)+' kr':''}</span>
    </div>`;
  });
  const wl=(P.watchlist||[]).filter(w=>w&&w.ticker);
  if(wl.length){
    h+=`<div class="pf3-prop-wl-h">👁 ${RT('Лист ожидания','Watchlist')} <span class="pf3-asof">${RT('приоритет 4 · на подтверждении','priority 4 · awaiting confirmation')}</span></div>`;
    wl.forEach(w=>{h+=`<div class="pf3-prop-row pf3-prop-wl">
      <span class="pf3-prop-act hold">👁</span>
      <div class="pf3-prop-info"><b>${w.name||''} <span class="pf3-cal-tk">${w.ticker||''}</span></b><span>${w.condition?`<b>${RT('Условие','When')}:</b> ${w.condition}. `:''}${w.rationale||''}</span></div>
    </div>`;});
  }
  h+='</section>';
  return h;
}

// ===== «📈 Анализ» sub-tab: авто-разбор портфеля из цикла AI-портфеля =====
// Заполняется воркером при нажатии «▶ Запустить цикл сейчас» (и на cron):
// data[key].analysis = {at, summary, report, actions:[{action,name,ticker,details,amountSEK}]}.
function pf3AnalysisHTML(){
  const d=DATA[v3Key],A=d&&d.analysis;
  let h=`<section class="pf3-panel"><div class="pf3-panel-hd"><span>${RT('📈 AI-анализ портфеля','📈 AI portfolio analysis')}</span><span class="pf3-asof">${A&&A.at?RT('обновлено ','updated ')+pf3DtRu(A.at):''}</span></div>`;
  if(!A){
    h+=`<div class="pf3-empty">${RT('Анализ ещё не запускался — нажмите «▶ Запустить цикл сейчас» на вкладке AI-Portfolio (worker должен быть обновлён). Анализ обновляется автоматически по циклу.','No analysis yet — press «▶ Run cycle now» on the AI-Portfolio tab (worker must be updated). It also refreshes automatically on the cycle.')}</div></section>`;
    return h;
  }
  if(A.summary)h+=`<div class="pf3-prop-sum">${pf3Md(A.summary)}</div>`;
  (A.actions||[]).forEach((a,i)=>{
    const cls=/куп/i.test(a.action)?'buy':/прода|сократ/i.test(a.action)?'sell':'hold';
    h+=`<div class="pf3-prop-row">
      <span class="pf3-prop-n">${i+1}</span>
      <span class="pf3-prop-act ${cls}">${a.action||''}</span>
      <div class="pf3-prop-info"><b>${a.name||''} <span class="pf3-cal-tk">${a.ticker||''}</span></b><span>${a.details||''}</span></div>
      <span class="pf3-prop-amt">${typeof a.amountSEK==='number'&&a.amountSEK>0?'≈'+pf3Fmt(a.amountSEK)+' kr':''}</span>
    </div>`;
  });
  if(A.report)h+=`<div class="pf3-ai-report">${pf3Md(A.report)}</div>`;
  h+=`<div class="pf3-asof" style="margin-top:8px">${RT('Это аналитическая сводка, не индивидуальная инвестиционная рекомендация.','Informational summary, not individual investment advice.')}</div>`;
  h+='</section>';
  return h;
}

// ===== 🧪 Бэктест: rule-based прото-сигнал + проверка на истории (ТЗ AI-Proto, фаза 1) =====
// Детерминированный слой: сигнал [-1..+1] из правил (SMA/RSI/ATR/уровни) + backtest на
// истории (hit-rate vs buy&hold, кривая эквити, train/validation). Объясним и проверяем —
// в отличие от LLM-вкладок. Всё на клиенте; история — ?history= (закрытия), индикаторы —
// smaSeries + инкрементальные RSI/ATR. Без look-ahead: сигнал в точке i не видит баров > i
// (бары > i используются ТОЛЬКО для метки исхода при оценке точности).
const BT_DEFAULTS={H:20,thrUp:0.4,thrDown:-0.4,srWin:60,
  rules:{breakUp:1,bounceSup:1,rejectRes:1,downtrend:1,uptrend:1,overheat:1}};
const BT_RULE_LBL={breakUp:['пробой SMA50↑','SMA50 breakout↑'],bounceSup:['отскок у поддержки','support bounce'],
  rejectRes:['откат у сопротивления','resistance reject'],downtrend:['даунтренд','downtrend'],
  uptrend:['аптренд','uptrend'],overheat:['перегрев RSI','RSI overheat']};
function btCfg(key){const d=DATA[key||v3Key]||{},c=d.btConfig||{};
  return {...BT_DEFAULTS,...c,rules:{...BT_DEFAULTS.rules,...(c.rules||{})}};}
// Инкрементальный RSI(Wilder)/ATR-серии, выровненные с closes; null пока не хватает баров.
function btRsiSeries(c,n=14){const o=new Array(c.length).fill(null);if(c.length<n+1)return o;
  let g=0,l=0;for(let i=1;i<=n;i++){const d=c[i]-c[i-1];if(d>=0)g+=d;else l-=d;}g/=n;l/=n;
  o[n]=l===0?100:Math.round((100-100/(1+g/l))*10)/10;
  for(let i=n+1;i<c.length;i++){const d=c[i]-c[i-1];g=(g*(n-1)+(d>0?d:0))/n;l=(l*(n-1)+(d<0?-d:0))/n;
    o[i]=l===0?100:Math.round((100-100/(1+g/l))*10)/10;}return o;}
function btAtrSeries(c,n=14){const o=new Array(c.length).fill(null);if(c.length<n+1)return o;
  let s=0;for(let i=1;i<=n;i++)s+=Math.abs(c[i]-c[i-1]);o[n]=s/n;
  for(let i=n+1;i<c.length;i++)o[i]=(o[i-1]*(n-1)+Math.abs(c[i]-c[i-1]))/n;return o;}
// Признаки по ряду закрытий: SMA 50/100/200, RSI14, ATR14, rolling S/R за srWin.
function btFeatures(c,cfg){
  const n=c.length,W=cfg.srWin,sup=new Array(n).fill(null),res=new Array(n).fill(null);
  for(let i=0;i<n;i++){if(i<W-1)continue;let mn=Infinity,mx=-Infinity;for(let k=i-W+1;k<=i;k++){if(c[k]<mn)mn=c[k];if(c[k]>mx)mx=c[k];}sup[i]=mn;res[i]=mx;}
  return {sma50:smaSeries(c,50),sma100:smaSeries(c,100),sma200:smaSeries(c,200),rsi:btRsiSeries(c),atr:btAtrSeries(c),sup,res};
}
// Какие правила сработали в точке i и с каким знаком (НЕ зависит от весов — это
// чистая структура, нужная и для сигнала, и для калибровки). {rule:±1} или null.
function btFiredAt(c,F,i){
  if(i<1)return null;
  const p=c[i],pp=c[i-1],s50=F.sma50[i],s50p=F.sma50[i-1],s100=F.sma100[i],s200=F.sma200[i],
    rsi=F.rsi[i],atr=F.atr[i],atrp=F.atr[i-1],sup=F.sup[i],rs=F.res[i];
  if(s50==null||s100==null||s200==null||rsi==null)return null;
  const f={};
  if(pp<=s50p&&p>s50&&rsi<70)f.breakUp=1;
  if(sup>0&&(p-sup)/sup*100<2&&p>=sup&&atr!=null&&atrp!=null&&atr>atrp)f.bounceSup=1;
  if(rs>0&&Math.abs(p-rs)/rs*100<2&&rsi>70)f.rejectRes=-1;
  if(p<s200&&s50<s100)f.downtrend=-1;
  if(p>s200&&s50>s100)f.uptrend=1;
  if(rsi>70&&p>s50*1.15)f.overheat=-1;
  return f;
}
// Прото-сигнал в точке i: взвешенная сумма сработавших правил. Масштаб 2: одно
// правило веса 1 → ±0.5 (пробивает порог 0.4), противоположные гасятся. Клампим [-1..1].
function btSignalAt(c,F,i,cfg){
  const f=btFiredAt(c,F,i);if(!f)return null;
  const R=cfg.rules,fired=[];let num=0;
  for(const k in f){const w=R[k]||0;if(w>0){num+=f[k]*w;fired.push(k);}}
  return {signal:Math.max(-1,Math.min(1,Math.round(num/2*100)/100)),fired};
}
// Backtest по одному ряду закрытий. Хронологический сплит 70/30, без look-ahead.
function btRun(c,cfg,t){
  if(!Array.isArray(c)||c.length<260)return null;
  const F=btFeatures(c,cfg),H=cfg.H,n=c.length,cut=Math.floor(n*0.7);
  const fmt=x=>x?new Date(x*1000).toISOString().slice(0,10):null;
  const stat=()=>({hit:0,dir:0});const tr=stat(),va=stat();
  for(let i=200;i+H<n;i++){
    const sig=btSignalAt(c,F,i,cfg);if(!sig)continue;
    const ret=c[i+H]/c[i]-1,thr=Math.max(0.05,(F.atr[i]||0)/c[i]);
    const outcome=ret>=thr?'up':ret<=-thr?'down':'range';
    const bucket=i<cut?tr:va;
    if(sig.signal>cfg.thrUp){bucket.dir++;if(outcome==='up')bucket.hit++;}
    else if(sig.signal<cfg.thrDown){bucket.dir++;if(outcome==='down')bucket.hit++;}
  }
  // Кривая эквити на validation: лонг при сигнале > thrUp, иначе кэш (без шортов/плеча).
  const eq=[],bh=[];let e=1,b=1;
  for(let i=cut;i+1<n;i++){
    const sig=btSignalAt(c,F,i,cfg);const r=c[i+1]/c[i]-1;
    if(sig&&sig.signal>cfg.thrUp)e*=(1+r);eq.push(e);
    b*=(1+r);bh.push(b);
  }
  const last=btSignalAt(c,F,n-1,cfg);
  const hr=s=>s.dir?Math.round(s.hit/s.dir*100):null;
  return {last,hitRate:hr(va),hitTrain:hr(tr),dir:va.dir,
    stratPct:Math.round((e-1)*1000)/10,bhPct:Math.round((b-1)*1000)/10,eq,bh,
    valFrom:t?fmt(t[cut]):null,valTo:t?fmt(t[n-1]):null,valDays:n-cut,
    lastAtrPct:Math.max(0.05,(F.atr[n-1]||0)/c[n-1]),
    overfit:hr(tr)!=null&&hr(va)!=null&&hr(tr)-hr(va)>=20};
}
// История по тикеру для backtest (свой кэш, TTL 10 мин).
let _btHist={},_btState={};
async function btHistory(sym){
  const h=_btHist[sym];if(h&&Date.now()-h.at<600000)return {c:h.c,t:h.ts};
  try{const r=await fetch(PRICE_PROXY+'?history='+encodeURIComponent(sym)+'&range=2y');const j=await r.json();
    const rc=(j&&Array.isArray(j.c))?j.c:[],rt=(j&&Array.isArray(j.t))?j.t:[];
    const c=[],ts=[];for(let i=0;i<rc.length;i++){const v=rc[i];if(typeof v==='number'&&isFinite(v)&&v>0){c.push(v);ts.push(rt[i]);}}
    _btHist[sym]={c,ts,at:Date.now()};return {c,t:ts};}catch(e){return {c:[],t:[]};}
}
// Источник тикеров для backtest: AIP — из живого AI-портфеля (AI_PORT.positions),
// остальные — позиции вкладки (qty>0; у watchlist — все строки).
function btTickers(key){
  if(key===AIP_KEY)return ((AI_PORT&&AI_PORT.positions)||[]).map(p=>({tk:String(p.ticker||'').trim(),name:p.name||p.ticker,ccy:p.ccy||'USD',type:p.type||''})).filter(x=>x.tk);
  const d=DATA[key]||{};
  return (d.rows||[]).filter(r=>(parseFloat(r[6])||0)>0||!d.port).map(r=>({tk:String(r[2]||'').trim(),name:String(r[1]||r[2]||''),ccy:r[8]||'USD',type:String(r[5]||'')})).filter(x=>x.tk);
}
// Лёгкий макро-режим из ^TNX (тренд доходностей) и ^VIX (аппетит к риску). Кэш 10 мин.
// СОВЕТНЫЙ контекст: не меняет сам прото-сигнал и backtest (консистентность).
let _btRegime=null;
async function btRegime(){
  if(_btRegime&&Date.now()-_btRegime.at<600000)return _btRegime;
  try{
    const j=await fetch(PRICE_PROXY+'?symbols='+encodeURIComponent('^TNX,^VIX')).then(r=>r.json());
    const tnx=j&&j['^TNX'],vix=j&&j['^VIX'];
    const rates=(tnx&&tnx.price>0&&tnx.sma50>0)?(tnx.price>tnx.sma50*1.005?'hawkish':tnx.price<tnx.sma50*0.995?'dovish':'neutral'):'neutral';
    const risk=(vix&&vix.price>0&&vix.price>20)?'off':'on';
    _btRegime={rates,risk,vix:(vix&&vix.price>0)?Math.round(vix.price*10)/10:null,at:Date.now()};
  }catch(e){_btRegime={rates:'neutral',risk:'on',vix:null,at:Date.now()};}
  return _btRegime;
}
// Советный тилт по типу бумаги в текущем режиме (разд. 13 ТЗ). dir<0 — встречный
// ветер, dir>0 — попутный. НЕ меняет сигнал/вердикт, только подсказка.
function btRegimeTilt(type,reg){
  const t=String(type||'').toLowerCase();
  const growth=/рост|growth|спекул|spec/.test(t),incomeRate=/дивид|divid|reit|недвиж|real est/.test(t),
    cyc=/циклич|cyclic|финанс|financ|энерг|energy|материал|material/.test(t),defq=/качеств|qualit|защит|defens/.test(t);
  let dir=0;const why=[];
  if(reg.rates==='hawkish'){if(growth){dir--;why.push(RT('рост чувствителен к ↑ставкам','growth hit by ↑rates'));}if(incomeRate){dir--;why.push(RT('REIT/дивиденды против ↑ставок','REIT/dividend vs ↑rates'));}if(cyc){dir++;why.push(RT('value/цикл при ↑ставках','value/cyclical with ↑rates'));}}
  else if(reg.rates==='dovish'){if(growth){dir++;why.push(RT('рост выигрывает при ↓ставках','growth wins on ↓rates'));}if(incomeRate){dir++;why.push(RT('REIT/дивиденды при ↓ставках','REIT/dividend on ↓rates'));}}
  if(reg.risk==='off'){if(growth){dir--;why.push(RT('risk-off против спекулятивного','risk-off vs speculative'));}if(defq){dir++;why.push(RT('качество в risk-off','quality in risk-off'));}}
  return {dir,why:why.join('; ')};
}
// Прогон по позициям текущего портфеля → сохранить в _btState[key], перерисовать.
async function btCompute(key){
  key=key||v3Key;
  _btState[key]={loading:true};if(isV3()&&pf3Tab==='backtest')renderPF3();
  const cfg=btCfg(key),items=btTickers(key);
  const out=[];
  const regime=await btRegime();   // лёгкий макро-режим (контекст)
  await Promise.all(items.map(async it=>{
    const h=await btHistory(exSymbol(it.tk,it.ccy));
    const res=btRun(h.c,cfg,h.t);if(!res)return;out.push({tk:it.tk,name:it.name,type:it.type,res});
    btJournalUpdate(key,it.tk,h,res,cfg);   // лог + авто-исход (разд. 7 ТЗ)
  }));
  // Компактные прото-сигналы для LLM (раздел 6 ТЗ): {ТИКЕР:{s,v,h}} + точность правил.
  const d=DATA[key];
  if(d){
    const sm={};out.forEach(o=>{const sg=o.res.last?o.res.last.signal:0;sm[o.tk.toUpperCase()]={s:sg,v:sg>cfg.thrUp?'long':sg<cfg.thrDown?'reduce':'neutral',h:o.res.hitRate};});
    d.btSignals=sm;
    const rs=btRuleStats(key),acc={};Object.keys(rs).forEach(r=>{acc[r]=Math.round(rs[r].hit/rs[r].tot*100);});
    d.btRuleAcc=acc;
    if(Array.isArray(d.btJournal))d.btJournal=d.btJournal.slice(-500);
    scheduleSave();
  }
  out.sort((a,b)=>(b.res.last?b.res.last.signal:0)-(a.res.last?a.res.last.signal:0));
  // Агрегат hit-rate (взвешенно по числу направленных сигналов).
  let h=0,n=0;out.forEach(o=>{if(o.res.hitRate!=null){h+=o.res.hitRate*o.res.dir;n+=o.res.dir;}});
  _btState[key]={loading:false,at:Date.now(),items:out,aggHit:n?Math.round(h/n):null,regime};
  if(isV3()&&pf3Tab==='backtest')renderPF3();
}
// 📓 Журнал гипотез (разд. 7 ТЗ): обучение со временем без демона. При заходе в
// новый день логируем направленный сигнал по бумаге; у прошлых записей, чей
// горизонт H уже прошёл, проставляем фактический исход по свежей истории.
function btJournalUpdate(key,tk,h,res,cfg){
  const d=DATA[key];if(!d)return;const J=d.btJournal=d.btJournal||[];
  const c=h.c,t=h.t||[],today=new Date().toISOString().slice(0,10);
  // Авто-исход для незакрытых записей этой бумаги.
  J.forEach(e=>{
    if(e.tk!==tk||e.out!=null)return;
    let idx=-1;for(let i=0;i<t.length;i++){if(t[i]&&new Date(t[i]*1000).toISOString().slice(0,10)===e.d){idx=i;break;}}
    if(idx<0||idx+e.H>=c.length)return;   // ещё не прошёл горизонт
    const ret=c[idx+e.H]/c[idx]-1,thr=Math.max(0.05,e.atr||0.05);
    e.ret=Math.round(ret*1000)/10;e.out=ret>=thr?'up':ret<=-thr?'down':'range';
  });
  // Логируем сегодняшний направленный сигнал (одна запись на бумагу в день).
  const sg=res.last?res.last.signal:0,dir=sg>cfg.thrUp?'long':sg<cfg.thrDown?'reduce':null;
  if(dir&&!J.some(e=>e.tk===tk&&e.d===today))
    J.push({d:today,tk,sig:sg,verdict:dir,fired:(res.last&&res.last.fired)||[],H:cfg.H,px:c[c.length-1],atr:res.lastAtrPct||0.05,out:null,ret:null});
}
// Реализованная точность каждого правила по закрытым записям журнала.
function btRuleStats(key){
  const J=(DATA[key]&&DATA[key].btJournal)||[],m={};
  J.forEach(e=>{if(e.out==null)return;const hit=(e.verdict==='long'&&e.out==='up')||(e.verdict==='reduce'&&e.out==='down');
    (e.fired||[]).forEach(r=>{m[r]=m[r]||{hit:0,tot:0};m[r].tot++;if(hit)m[r].hit++;});});
  return m;
}
// 🎯 Калибровка весов: grid-search по правилам. Сначала собираем «сработавшие
// правила + исход + train/val» (НЕ зависит от весов), потом дёшево перебираем
// веса {0,1,2}^6=729. Выбор по hit-rate на VALIDATION (train→val разрыв = оверфит).
// НЕ применяется автоматически — только по кнопке (инвариант ТЗ).
async function btCalibrate(key){
  key=key||v3Key;
  const stPrev=_btState[key]||{};_btState[key]={...stPrev,calibrating:true};if(isV3()&&pf3Tab==='backtest')renderPF3();
  const cfg=btCfg(key),H=cfg.H;
  const samples=[];
  for(const it of btTickers(key)){
    const c=(await btHistory(exSymbol(it.tk,it.ccy))).c;if(c.length<260)continue;
    const F=btFeatures(c,cfg),n=c.length,cut=Math.floor(n*0.7);
    for(let i=200;i+H<n;i++){const f=btFiredAt(c,F,i);if(!f||!Object.keys(f).length)continue;
      const ret=c[i+H]/c[i]-1,thr=Math.max(0.05,(F.atr[i]||0)/c[i]);
      samples.push({f,o:ret>=thr?1:ret<=-thr?-1:0,val:i>=cut});}
  }
  const keys=Object.keys(BT_DEFAULTS.rules),levels=[0,1,2];
  const evalW=w=>{let trH=0,trD=0,vaH=0,vaD=0;
    for(const s of samples){let num=0;for(const k in s.f)num+=s.f[k]*(w[k]||0);const sig=num/2;
      let dir=0;if(sig>cfg.thrUp)dir=1;else if(sig<cfg.thrDown)dir=-1;if(!dir)continue;
      const hit=(dir>0&&s.o>0)||(dir<0&&s.o<0);
      if(s.val){vaD++;if(hit)vaH++;}else{trD++;if(hit)trH++;}}
    return {trHit:trD?Math.round(trH/trD*100):null,trDir:trD,vaHit:vaD?Math.round(vaH/vaD*100):null,vaDir:vaD};};
  let best=null;const total=Math.pow(levels.length,keys.length);
  for(let t=0;t<total;t++){const w={};let x=t,nonzero=0;
    for(let j=0;j<keys.length;j++){const lv=levels[x%levels.length];w[keys[j]]=lv;if(lv>0)nonzero++;x=Math.floor(x/levels.length);}
    if(!nonzero)continue;const m=evalW(w);if(m.vaHit==null||m.vaDir<15)continue;
    if(!best||m.vaHit>best.m.vaHit||(m.vaHit===best.m.vaHit&&m.vaDir>best.m.vaDir))best={w,m};}
  const base=evalW(cfg.rules);
  _btState[key]={...(_btState[key]||{}),calibrating:false,calib:{best,base,at:Date.now(),samples:samples.length}};
  if(isV3()&&pf3Tab==='backtest')renderPF3();
}
function btApplyCalib(){
  const st=_btState[v3Key];if(!st||!st.calib||!st.calib.best)return;
  const c=btEnsureCfg();if(!c)return;c.rules={...(c.rules||{}),...st.calib.best.w};scheduleSave();
  btRecalc();
}
function btSig(v){const c=v>0.4?'buy':v<-0.4?'sell':'hold';
  return `<span class="pf3-prop-act ${c}" style="min-width:48px;text-align:center">${v>0?'+':''}${v.toFixed(2)}</span>`;}
function btSpark(eq,bh){
  if(!eq||eq.length<2)return '';const a=eq.slice(-180),c=bh.slice(-180);
  const all=a.concat(c),mn=Math.min(...all),mx=Math.max(...all),sp=(mx-mn)||1,W=600,H=90,pad=4;
  const X=i=>pad+i/(a.length-1)*(W-2*pad),Y=v=>H-pad-(v-mn)/sp*(H-2*pad);
  const line=(arr,col,w)=>`<polyline points="${arr.map((v,i)=>`${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="${w}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="aip-spark" preserveAspectRatio="none">${line(c,'#9ca3af',1.5)}${line(a,'#10b981',2.5)}</svg>`;
}
function pf3BacktestHTML(){
  const key=v3Key,st=_btState[key];
  let h=`<section class="pf3-panel"><div class="pf3-panel-hd"><span>${RT('🧪 Бэктест — прото-сигнал на истории','🧪 Backtest — proto-signal on history')}</span>`
    +`<span class="pf3-asof">${st&&st.at?RT('обновлено ','updated ')+pf3DtRu(new Date(st.at).toISOString()):''}</span></div>`;
  if(!st||st.loading){
    if(!st)setTimeout(()=>btCompute(key),0);
    h+=`<div class="pf3-empty">⏳ ${RT('Считаю сигналы и backtest по истории (2 года)…','Computing signals and backtest over 2y history…')}</div></section>`;
    return h;
  }
  const cfg=btCfg(key);
  if(st.items&&st.items.length){
    // Пояснение метрик и линий (задача 1+2).
    h+=`<div class="pf3-prop-sum">
      ${RT('Детерминированный сигнал из правил (SMA/RSI/ATR/уровни), без LLM — объясним и проверяем на истории. Сигнал в точке не использует будущие бары.','Deterministic rule-based signal (SMA/RSI/ATR/levels), no LLM — explainable and validated on history. The signal never uses future bars.')}<br>
      <b>${RT('Сигнал','Signal')}</b> −1..+1 (${RT('порог','threshold')} ±${cfg.thrUp}): &gt; +${cfg.thrUp} ${RT('= лонг-гипотеза','= long')}, &lt; −${cfg.thrUp} ${RT('= сократить','= reduce')}, ${RT('между — нейтрально','between — neutral')}.<br>
      <b>hit</b> ${RT('— доля верных направленных сигналов на отложенных','— share of correct directional signals on the held-out')} 30% ${RT('истории (validation)','of history (validation)')}.
      <b>${RT('страт','strat')} vs B&H</b> ${RT('— доходность следования сигналу против «купи и держи» на том же окне','— signal-following return vs buy&hold over the same window')}.
      <b>⚠️ ${RT('оверфит','overfit')}</b> ${RT('— точность на train намного выше validation (подгонка под прошлое).','— train accuracy ≫ validation (overfit to the past).')}<br>
      <span style="display:inline-block;width:16px;height:3px;background:#10b981;vertical-align:middle"></span> ${RT('зелёная — эквити стратегии','green — strategy equity')} ·
      <span style="display:inline-block;width:16px;height:3px;background:#9ca3af;vertical-align:middle"></span> ${RT('серая — buy&hold','grey — buy&hold')} ·
      ${RT('обе на окне validation (последние ~30% истории), старт = 1.0','both over the validation window (last ~30% of history), start = 1.0')}.
    </div>`;
    // 🌡 Лёгкий макро-режим (разд. 13): советный контекст, не меняет сигнал/backtest.
    const rg=st.regime;
    if(rg){
      const rl={hawkish:['🦅 '+RT('ястребиный','hawkish')+' (10Y ↑)',''],dovish:['🕊 '+RT('голубиный','dovish')+' (10Y ↓)',''],neutral:[RT('нейтральный по ставкам','neutral rates'),'']}[rg.rates][0];
      const fav=rg.rates==='hawkish'?RT('за value/финансы/энергетику, против роста/REIT/дивидендных','favors value/financials/energy, against growth/REIT/dividend')
        :rg.rates==='dovish'?RT('за рост/REIT, против защитных','favors growth/REIT, against defensives')
        :RT('без явного перекоса по секторам','no clear sector tilt');
      h+=`<div class="pf3-prop-row"><div class="pf3-prop-info"><b>🌡 ${RT('Макро-режим','Macro regime')}:</b> ${rl} · ${rg.risk==='off'?RT('risk-off (страх)','risk-off'):'risk-on'}${rg.vix!=null?' · VIX '+rg.vix:''}<br><span class="pf3-asof">${fav}. ${RT('Влияет только на подсказку по бумагам — сигнал и backtest без изменений.','Per-stock hint only — the signal and backtest are unchanged.')}</span></div></div>`;
    }
    if(st.aggHit!=null)h+=`<div class="pf3-prop-row"><b>${RT('Средний hit-rate портфеля','Portfolio avg hit-rate')}: <span style="color:${st.aggHit>=50?'#10b981':'#ef4444'}">${st.aggHit}%</span></b> <span class="pf3-asof">${RT('по направленным сигналам на validation','directional signals, validation')}</span></div>`;
    st.items.forEach(o=>{const r=o.res,sg=r.last?r.last.signal:0,
      fired=(r.last&&r.last.fired||[]).map(f=>(BT_RULE_LBL[f]||[f])[LANG==='en'?1:0]).join(', ')||RT('нет сработавших правил','no rules fired'),
      vd=sg>cfg.thrUp?RT('лонг-гипотеза','long'):sg<cfg.thrDown?RT('сократить','reduce'):RT('нейтрально','neutral'),
      cap=r.valFrom&&r.valTo?`<div class="pf3-asof" style="margin:-2px 0 10px">🟢 ${RT('стратегия','strategy')} · ⚪ buy&hold · validation ${r.valFrom} → ${r.valTo} (${r.valDays} ${RT('дн','d')})</div>`:'';
      const tl=st.regime?btRegimeTilt(o.type,st.regime):{dir:0};
      const hint=tl.dir?` <span style="color:${tl.dir>0?'#10b981':'#ef4444'}" title="${tl.why}">· ${RT('режим','regime')} ${tl.dir>0?'▲':'▼'}</span>`:'';
      h+=`<div class="pf3-prop-row">${btSig(sg)}
        <div class="pf3-prop-info"><b>${o.name} <span class="pf3-cal-tk">${o.tk}</span></b><span>${fired}${hint}</span></div>
        <div style="text-align:right;font-size:12px"><b>${vd}</b><br><span class="pf3-asof">hit ${r.hitRate!=null?r.hitRate+'%':'—'} · ${RT('страт','strat')} ${r.stratPct>=0?'+':''}${r.stratPct}% vs B&H ${r.bhPct>=0?'+':''}${r.bhPct}%${r.overfit?' · ⚠️'+RT('оверфит','overfit'):''}</span></div>
      </div>${btSpark(r.eq,r.bh)}${cap}`;
    });
  }else h+=`<div class="pf3-empty">${RT('Нет позиций с достаточной историей (нужно ≥1 года данных).','No positions with enough history (≥1y needed).')}</div>`;
  // 📓 Журнал гипотез + реализованная точность правил (обучение со временем, разд. 7).
  const J=(DATA[key]&&DATA[key].btJournal)||[];
  h+=`<div class="pf3-panel-hd" style="margin-top:14px"><span>📓 ${RT('Журнал гипотез','Hypothesis journal')}</span><span class="pf3-asof">${RT('обучение со временем','learning over time')}</span></div>`;
  if(!J.length){h+=`<div class="pf3-empty">${RT('Журнал пуст. Запись добавляется при заходе на вкладку в новый день для бумаг с направленным сигналом; исход проставляется автоматически через горизонт H.','Journal is empty. An entry is logged when you open the tab on a new day for stocks with a directional signal; the outcome auto-fills after horizon H.')}</div>`;}
  else{
    const resolved=J.filter(e=>e.out!=null),pend=J.length-resolved.length;
    const corr=resolved.filter(e=>(e.verdict==='long'&&e.out==='up')||(e.verdict==='reduce'&&e.out==='down')).length;
    h+=`<div class="pf3-prop-row"><div class="pf3-prop-info"><b>${J.length} ${RT('записей','entries')}</b> · ${RT('закрыто','resolved')} ${resolved.length}${resolved.length?` (${RT('верных','correct')} ${corr}/${resolved.length} = ${Math.round(corr/resolved.length*100)}%)`:''} · ⏳ ${pend}</div></div>`;
    // Реализованная точность правил (деградирующие < 40% подсвечены).
    const rs=btRuleStats(key),rk=Object.keys(rs);
    if(rk.length){h+=`<div class="pf3-prop-row"><div class="pf3-prop-info"><b>${RT('Точность правил (по закрытым)','Rule accuracy (resolved)')}:</b><br>`
      +rk.map(r=>{const s=rs[r],pc=Math.round(s.hit/s.tot*100);return `<span style="color:${pc>=50?'#10b981':pc<40?'#ef4444':'inherit'}">${(BT_RULE_LBL[r]||[r])[LANG==='en'?1:0]} ${pc}% (${s.hit}/${s.tot})</span>`;}).join(' · ')
      +`</div></div>`;}
    // Последние записи.
    J.slice(-15).reverse().forEach(e=>{const ic=e.out==null?'⏳':((e.verdict==='long'&&e.out==='up')||(e.verdict==='reduce'&&e.out==='down'))?'✅':e.out==='range'?'⚪':'❌';
      h+=`<div class="pf3-prop-row"><span class="pf3-prop-act ${e.verdict==='long'?'buy':'sell'}" style="min-width:64px;text-align:center">${e.verdict==='long'?RT('лонг','long'):RT('сократ','reduce')}</span>
        <div class="pf3-prop-info"><b>${e.tk}</b> <span class="pf3-asof">${e.d} · ${RT('сигнал','sig')} ${e.sig>0?'+':''}${e.sig}</span></div>
        <div style="text-align:right;font-size:12px">${ic} ${e.out==null?RT('ждёт','pending'):e.ret+'%'}</div></div>`;});
  }
  // Панель конфига.
  h+=`<div class="pf3-panel-hd" style="margin-top:14px"><span>⚙️ ${RT('Настройки сигнала','Signal settings')}</span></div>
    <div class="pf3-prop-row"><div class="pf3-prop-info"><label>${RT('Горизонт H (дней)','Horizon H (days)')}: <input type="number" min="5" max="120" value="${cfg.H}" style="width:64px" onchange="btSet('H',+this.value)"></label>
      <label style="margin-left:12px">${RT('Порог','Threshold')} ±<input type="number" min="0.1" max="0.9" step="0.05" value="${cfg.thrUp}" style="width:64px" onchange="btSet('thr',+this.value)"></label></div></div>`;
  Object.keys(BT_DEFAULTS.rules).forEach(rn=>{h+=`<div class="pf3-prop-row"><div class="pf3-prop-info">
    <label><input type="checkbox" ${cfg.rules[rn]>0?'checked':''} onchange="btSetRule('${rn}',this.checked?1:0)"> ${(BT_RULE_LBL[rn]||[rn])[LANG==='en'?1:0]}</label>
    <input type="range" min="0" max="3" step="0.5" value="${cfg.rules[rn]}" style="margin-left:10px;vertical-align:middle" oninput="btSetRule('${rn}',+this.value)"> <span class="pf3-asof">×${cfg.rules[rn]}</span></div></div>`;});
  // 🎯 Калибровка весов (grid-search на train, выбор по validation).
  h+=`<div class="pf3-panel-hd" style="margin-top:14px"><span>🎯 ${RT('Калибровка весов','Weight calibration')}</span></div>`;
  if(st.calibrating){h+=`<div class="pf3-empty">⏳ ${RT('Перебор весов по истории…','Searching weights over history…')}</div>`;}
  else{
    h+=`<div class="pf3-prop-row"><button class="pf3-btn" onclick="btCalibrate()">🎯 ${RT('Подобрать веса','Calibrate')}</button>
      <span class="pf3-asof" style="margin-left:8px">${RT('grid-search на train, выбор по validation','grid-search on train, selected on validation')}</span></div>`;
    const cb=st.calib;
    if(cb){
      if(!cb.best){h+=`<div class="pf3-empty">${RT('Недостаточно сигналов для калибровки (мало истории/направленных сигналов).','Not enough signals to calibrate (too little history/directional signals).')}</div>`;}
      else{
        const b=cb.best,of=b.m.trHit!=null&&b.m.vaHit!=null&&b.m.trHit-b.m.vaHit>=20;
        h+=`<div class="pf3-prop-row"><div class="pf3-prop-info">
          <b>${RT('Текущие','Current')}:</b> val ${cb.base.vaHit!=null?cb.base.vaHit+'%':'—'} (${cb.base.vaDir}) · train ${cb.base.trHit!=null?cb.base.trHit+'%':'—'}<br>
          <b>${RT('Найдено','Best')}:</b> <span style="color:${b.m.vaHit>=50?'#10b981':'#ef4444'}">val ${b.m.vaHit}%</span> (${b.m.vaDir}) · train ${b.m.trHit}%${of?' · ⚠️'+RT('оверфит','overfit'):''}<br>
          <span class="pf3-asof">${RT('веса','weights')}: ${Object.keys(BT_DEFAULTS.rules).map(k=>(BT_RULE_LBL[k]||[k])[LANG==='en'?1:0]+' ×'+(b.w[k]||0)).join(' · ')}</span></div></div>
          <div class="pf3-prop-row"><button class="pf3-btn" onclick="btApplyCalib()">✓ ${RT('Применить веса','Apply weights')}</button>
          <span class="pf3-asof" style="margin-left:8px">${RT('применяется только по этой кнопке','applied only on this button')}</span></div>`;
      }
    }
  }
  h+=`<div class="pf3-prop-row"><button class="pf3-btn" onclick="btRecalc()">↻ ${RT('Пересчитать','Recompute')}</button>
    <span class="pf3-asof" style="margin-left:8px">${RT('Это аналитика на истории, не прогноз и не инвестрекомендация.','Historical analytics, not a forecast or investment advice.')}</span></div>`;
  h+='</section>';
  return h;
}
function btEnsureCfg(){const d=DATA[v3Key];if(!d)return null;d.btConfig=d.btConfig||{};return d.btConfig;}
function btSet(k,v){const c=btEnsureCfg();if(!c)return;if(k==='thr'){c.thrUp=Math.abs(v);c.thrDown=-Math.abs(v);}else c[k]=v;scheduleSave();}
function btSetRule(rn,v){const c=btEnsureCfg();if(!c)return;c.rules=c.rules||{};c.rules[rn]=v;scheduleSave();renderPF3();}
function btRecalc(){_btState[v3Key]=null;btCompute(v3Key);}

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
// ── 💵 Cash-drag монитор: отставание доходности из-за доли свободного кэша ──
const CASH_TARGET=[15,20];   // правило инвестора: целевая доля кэша 15–20%
let cashDrag={period:'ytd',bench:null};   // bench null = авто по базовой валюте
let _cashIdxLoading=false;
function cashDragSet(k,v){cashDrag[k]=v;renderPF3();}
function cashDragEnsureIdx(){
  if((IDX_HIST['^OMX']&&IDX_HIST['^NDX'])||_cashIdxLoading)return;
  _cashIdxLoading=true;
  aiLoadIdxHist().then(()=>{_cashIdxLoading=false;if(isV3()&&pf3Tab==='health')renderPF3();});
}
// Доходность индекса-бенчмарка за период из IDX_HIST (карта 'YYYY-MM-DD'→close).
function idxReturnPct(sym,period){
  const m=IDX_HIST[sym]; if(!m)return null;
  const keys=Object.keys(m).filter(k=>/^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  if(keys.length<2)return null;
  const lastDate=keys[keys.length-1], last=m[lastDate];
  if(!(last>0))return null;
  let start;
  if(period==='day'){ start=m[keys[keys.length-2]]; }
  else{
    let startDate; const dd=new Date(lastDate+'T00:00:00Z');
    if(period==='month'){ dd.setUTCMonth(dd.getUTCMonth()-1); startDate=dd.toISOString().slice(0,10); }
    else if(period==='ytd'){ startDate=lastDate.slice(0,4)+'-01-01'; }
    else { startDate=keys[0]; }   // '1y' — самая ранняя точка ряда
    let res=null; for(const k of keys){ if(k<=startDate)res=m[k]; else break; }
    start=res!=null?res:m[keys[0]];
  }
  return start>0?(last/start-1)*100:null;
}
// Чистая модель cash-drag — покрыта тестом.
function cashDragModel(free,equity,benchRet,targetHi){
  const cashPct=equity>0?free/equity*100:0;
  const excessPct=Math.max(0,cashPct-targetHi);
  const excessKr=excessPct/100*equity;
  const dragPct=benchRet==null?null:-(cashPct/100)*benchRet;   // вклад полной кэш-позиции в доходность
  const counterKr=benchRet==null?null:excessKr*benchRet/100;   // недополучено на ИЗБЫТКЕ кэша
  const status=cashPct<=targetHi?'ok':cashPct<=30?'warn':'high';
  return {cashPct,excessPct,excessKr,dragPct,counterKr,status};
}
function cashDragHTML(d,rows){
  cashDragEnsureIdx();
  const fxB=pf3BaseFx(d), unit=pf3BaseUnit(d);
  const free=(parseFloat(d.cashFree)||0)*fxB;
  const totalVal=rows.reduce((a,x)=>a+x.val,0), equity=totalVal+free;
  const baseUSD=unit!=='kr';
  const bench=cashDrag.bench||(baseUSD?'^NDX':'^OMX');
  const benchName=bench==='^NDX'?'Nasdaq 100':'OMXS30';
  const period=cashDrag.period, benchRet=idxReturnPct(bench,period);
  const m=cashDragModel(free,equity,benchRet,CASH_TARGET[1]);
  // Перегрев рынка: доля позиций с критерием «Перегрев» → смягчаем подсказку.
  let ohN=0,oh=0;
  d.rows.forEach((r,i)=>{const q=parseFloat(r[6])||0;if(!(q>0))return;ohN++;try{const c=pf3Criterion(d,r);if(c&&/перегрев|overheat/i.test(c.label||''))oh++;}catch(e){}});
  const overheat=ohN>0&&oh/ohN>=0.5;
  const PERIODS=[['day',RT('день','day')],['month',RT('месяц','month')],['ytd','YTD'],['1y',RT('1 год','1Y')]];
  const segP=`<span class="pf3-hz-seg">${PERIODS.map(([k,l])=>`<button class="pf3-hz-b${period===k?' on':''}" onclick="cashDragSet('period','${k}')">${l}</button>`).join('')}</span>`;
  const segB=`<span class="pf3-hz-seg">${[['^OMX','OMX'],['^NDX','NDX']].map(([k,l])=>`<button class="pf3-hz-b${bench===k?' on':''}" onclick="cashDragSet('bench','${k}')">${l}</button>`).join('')}</span>`;
  const dragTxt=m.dragPct==null?'—':`${m.dragPct>=0?'+':''}${m.dragPct.toFixed(2)}%`;
  const dragCls=m.dragPct==null?'':m.dragPct>=0?'pf3-up':'pf3-down';
  const hint=m.status==='ok'
    ?RT('Доля кэша в пределах правила 15–20% — отставание из-за резерва незначительно.','Cash is within the 15–20% rule — drag from the reserve is minor.')
    :RT(`Размещайте избыточный кэш частями по сигналам докупки на вкладке «Портфель», уважая правило 15–20%${overheat?'. Рынок перегрет — часть резерва под откат оправдана':''}.`,`Deploy the excess cash gradually on buy signals from the Portfolio tab, respecting the 15–20% rule${overheat?'. The market is overheated — keeping part of the reserve for a pullback is reasonable':''}.`);
  const counter=(m.counterKr!=null&&m.excessPct>0.5&&Math.abs(m.counterKr)>=1)
    ? `<div class="cd-counter">${m.counterKr>=0?RT('Недополучено на избытке','Forgone on excess'):RT('Сэкономлено на избытке','Saved on excess')} ≈ <b>${pf3Fmt(Math.abs(m.counterKr),0)} ${unit}</b> ${RT('за','over')} ${({day:RT('день','day'),month:RT('месяц','month'),ytd:'YTD','1y':RT('1 год','1Y')})[period]}</div>`:'';
  // Вклад кэша в доходность по всем периодам (день/мес/YTD/год) — мини-ряд.
  const perRow=PERIODS.map(([k,l])=>{const br=idxReturnPct(bench,k);const dg=br==null?null:-(m.cashPct/100)*br;return`<div class="cd-pp"><span class="cd-pp-l">${l}</span><b class="${dg==null?'cd-dim':dg>=0?'pf3-up':'pf3-down'}">${dg==null?'…':(dg>=0?'+':'')+dg.toFixed(1)+'%'}</b></div>`;}).join('');
  const buyBtn=m.status!=='ok'?` <button class="pf3-btn pf3-btn-sm" onclick="pf3Tab='list';renderAll()">→ ${RT('к сигналам докупки','to buy signals')}</button>`:'';
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>💵 ${RT('Cash-drag — отставание из-за кэша','Cash drag — lag from holding cash')} ${infoBtn('cashdrag')}</span><span class="pf3-asof">${segP} ${segB}</span></div>
    <div class="cd-grid">
      <div class="cd-main cd-${m.status}">
        <div class="cd-big ${dragCls}">${dragTxt}</div>
        <div class="cd-cap">${RT('вклад кэша в доходность','cash contribution to return')} · ${benchName} ${benchRet==null?'…':(benchRet>=0?'+':'')+benchRet.toFixed(1)+'%'}</div>
      </div>
      <div class="cd-stats">
        <div><span class="label">${RT('Доля кэша','Cash share')}</span><b class="${m.status==='high'?'pf3-down':m.status==='warn'?'val-mid':''}">${m.cashPct.toFixed(1)}%</b> <span class="cd-dim">${RT('цель','target')} ${CASH_TARGET[0]}–${CASH_TARGET[1]}%</span></div>
        <div><span class="label">${RT('Избыток','Excess')}</span><b>${m.excessPct.toFixed(1)}%</b> ${m.excessKr>0?`≈ ${pf3Fmt(m.excessKr,0)} ${unit}`:''}</div>
        ${counter}
      </div>
    </div>
    <div class="cd-periods"><span class="cd-dim">${RT('Вклад кэша в доходность по периодам','Cash contribution to return by period')}:</span>${perRow}</div>
    <div class="cd-hint">💡 ${hint}${buyBtn}</div>
    <div class="pf3-ai-note">${RT('cash_drag = доля кэша × доходность бенчмарка (кэш под 0%); знак к альфе обратный показанному вкладу. Справочная аналитика, не рекомендация.','cash_drag = cash share × benchmark return (cash at 0%). Reference analytics, not advice.')}</div>
  </section>`;
}
// ── 💱 Валютный риск и хедж: сценарий «SEK крепнет на X%» по экспозиции ──
let fxScn=10;   // выбранное укрепление SEK, %
function fxScnSet(v){fxScn=v;renderPF3();}
// Чистая сценарная модель — покрыта тестом. rows: [{ccy,val(SEK)}]; equity — чистый
// капитал (SEK). Укрепление SEK на sekMovePct → инвалютные позиции дешевеют в kr.
function fxScenarioModel(rows,equity,sekMovePct){
  const byCcy={}; let foreign=0,stocks=0;
  rows.forEach(x=>{const v=x.val||0;stocks+=v;byCcy[x.ccy]=(byCcy[x.ccy]||0)+v;if(x.ccy!=='SEK')foreign+=v;});
  const impact=-foreign*sekMovePct/100;
  const ccyList=Object.keys(byCcy).filter(c=>c!=='SEK').map(c=>({c,v:byCcy[c],impact:-byCcy[c]*sekMovePct/100,pct:stocks>0?byCcy[c]/stocks*100:0})).sort((a,b)=>b.v-a.v);
  return {foreign,stocks,foreignPctOfStocks:stocks>0?foreign/stocks*100:0,foreignPctOfNet:equity>0?foreign/equity*100:0,impact,newNet:equity+impact,impactPct:equity>0?impact/equity*100:0,ccyList};
}
function fxHedgeHTML(d,rows,equity){
  const unit=pf3BaseUnit(d), m=fxScenarioModel(rows,equity,fxScn);
  if(!(m.foreign>0))return '';
  const verdict=m.foreignPctOfStocks>=80?{c:'cd-high',l:RT('высокий','high')}:m.foreignPctOfStocks>=60?{c:'cd-warn',l:RT('умеренный','moderate')}:{c:'cd-ok',l:RT('низкий','low')};
  const seg=`<span class="pf3-hz-seg">${[5,10,15].map(v=>`<button class="pf3-hz-b${fxScn===v?' on':''}" onclick="fxScnSet(${v})">+${v}%</button>`).join('')}</span>`;
  const ccyRows=m.ccyList.slice(0,5).map(x=>`<div class="fx-row"><span class="fx-c">${x.c}</span><span class="cd-dim">${x.pct.toFixed(0)}% ${RT('акций','of stocks')}</span><b class="pf3-down">${pf3Fmt(x.impact,0)} ${unit}</b></div>`).join('');
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>💱 ${RT('Валютный риск и хедж','Currency risk & hedge')} ${infoBtn('fxhedge')}</span><span class="pf3-asof">${RT('SEK крепнет','SEK strengthens')} ${seg}</span></div>
    <div class="cd-grid">
      <div class="cd-main ${verdict.c}">
        <div class="cd-big pf3-down">${pf3Fmt(m.impact,0)} <small>${unit}</small></div>
        <div class="cd-cap">${RT('влияние на чистый капитал','impact on net worth')} (${m.impactPct.toFixed(1)}%) ${RT('при','if')} SEK +${fxScn}%</div>
      </div>
      <div class="cd-stats">
        <div><span class="label">${RT('Инвалютная доля','Foreign exposure')}</span><b class="${verdict.c==='cd-high'?'pf3-down':''}">${m.foreignPctOfStocks.toFixed(0)}%</b> <span class="cd-dim">${RT('акций','of stocks')} · ${RT('риск','risk')} ${verdict.l}</span></div>
        ${ccyRows}
      </div>
    </div>
    <div class="cd-hint">💡 ${RT('Снизить валютный риск: нордические/EUR-бумаги (напр. INVE B, VOLV B), часть свободного кэша держать в SEK. Ослабление SEK даст обратный (положительный) эффект.','Cut FX risk: Nordic/EUR names (e.g. INVE B, VOLV B), keep part of free cash in SEK. A weaker SEK has the opposite (positive) effect.')}</div>
    <div class="pf3-ai-note">${RT('Сценарий: равномерное укрепление SEK против всех инвалют (упрощение; покурсовые корреляции — отдельный слой). Справочная аналитика, не рекомендация.','Scenario: uniform SEK strengthening vs all foreign currencies (a simplification; per-currency correlations are a separate layer). Reference analytics, not advice.')}</div>
  </section>`;
}

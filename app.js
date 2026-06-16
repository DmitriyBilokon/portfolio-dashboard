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
           hiddenCols:hiddenCols, smaTf:SMA_TF, sim:SIM, pfTrades:PF_TRADES, aiChat:AI_CHAT, aiPrefs:AI_PREFS, tgAlerts:TG_ALERTS, tabGroups:TAB_GROUPS, tabOrder:TAB_ORDER, aiPort:AI_PORT, aiPortBak:AI_PORT_BAK, stockAiLog:STOCK_AI_LOG, insider:INSIDER, tgMeta:TG_META, val:VAL, tgFull:TG_FULL, aiReco:AI_RECO, aiSpend:AI_SPEND, aiDash:AI_DASH, layout:LAYOUT, aiPlaybook:AI_PLAYBOOK, aiPlaybookSeedV:AI_PLAYBOOK_SEEDV, planRules:PLAN_RULES, scnAlerts:SCN_ALERT_STATE };
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
  if(Array.isArray(s.aiPrefs)) AI_PREFS=s.aiPrefs;
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
let AI_PORT=null,AI_PORT_BAK=null;   // 🤖 AI Портфель: состояние + резерв worker'а (round-trip)
let STOCK_AI_LOG=[];   // обучающая база: разборы акций {ticker,ts,price,ccy,verdict,target,horizon,text,data}

// 📚 Инвест-плейбук: курируемая методичка «как обгонять индекс». Редактируется
// инвестором, синхронизируется (aiPlaybook) и передаётся во все анализы AI Proto.
const DEFAULT_PLAYBOOK=[
  'Цель — риск-скорректированное опережение индекса (OMXS30/Nasdaq 100/S&P 500), а не максимальная доходность любой ценой.',
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
const PLAYBOOK_SEED_V=2;
let AI_PLAYBOOK=[],AI_PLAYBOOK_SEEDV=0;
function aiPlaybookEnsure(){
  if(!Array.isArray(AI_PLAYBOOK))AI_PLAYBOOK=[];
  if(!AI_PLAYBOOK.length){ AI_PLAYBOOK=DEFAULT_PLAYBOOK.slice(); }
  else if(AI_PLAYBOOK_SEEDV<PLAYBOOK_SEED_V){ PLAYBOOK_V2_ADD.forEach(p=>{ if(!AI_PLAYBOOK.includes(p))AI_PLAYBOOK.push(p); }); }
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
const PFTAB_PERM={list:'portfolio',sec:'sectors',typ:'type',div:'diversification',fcast:'forecast',plan:'plan',trades:'trades',cal:'dividends',health:'health',ai:'ai_proto',prop:'suggestion',aim:'ai_proto'};
const canTab=k=>can('view.'+(PFTAB_PERM[k]||k));
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
      v3Key=curIdx;pf3Sel=null;pf3Tab='list';pf3TypeSel=null;pf3XMenuOpen=false;
      pf3Sort=pf3IsPort(curIdx)?{key:'val',dir:-1}:{key:'day',dir:-1};   // index default: top movers first
    }
    ['smaBanner','toolbarEl','statsBar','tableArea','rankingArea'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none'});
    document.getElementById('smaBanner').innerHTML='';
    const isPort=pf3MyPort(v3Key),isAip=v3Key===AIP_KEY;
    if(isAip&&!['list','sec','typ','div','fcast','trades','health','aim'].includes(pf3Tab))pf3Tab='list';
    else if(isPort&&!['list','sec','typ','div','fcast','trades','plan','cal','health','ai','prop'].includes(pf3Tab))pf3Tab='list';
    else if(!isPort&&!isAip&&!['list','cal','sec','typ','ai'].includes(pf3Tab))pf3Tab='list';
    if(!canTab(pf3Tab))pf3Tab='list';   // RBAC: ушли с закрытой под-вкладки на «Портфель»
    const _subs=(isAip
      ?[[T('📊 Портфель'),'list'],[T('🏭 Сектора'),'sec'],[T('🏷 Тип'),'typ'],['🧭 '+RT('Диверсификация','Diversification'),'div'],['🔮 '+RT('Прогноз','Forecast'),'fcast'],['📜 '+RT('Сделки','Trades'),'trades'],[T('🩺 Состояние портфеля'),'health'],['🤖 '+RT('Управление AI','AI controls'),'aim']]
      :isPort
      ?[[T('📊 Портфель'),'list'],[T('🏭 Сектора'),'sec'],[T('🏷 Тип'),'typ'],['🧭 '+RT('Диверсификация','Diversification'),'div'],['🔮 '+RT('Прогноз','Forecast'),'fcast'],['🎯 '+RT('План','Plan')+planBadge(v3Key),'plan'],['📜 '+RT('Сделки','Trades'),'trades'],[T('📅 Дивиденды и отчёты'),'cal'],[T('🩺 Состояние портфеля'),'health'],['🤖 AI Proto','ai'],[T('⚖️ Предложение'),'prop']]
      :[[T('📊 Акции'),'list'],[T('🏭 Сектора'),'sec'],[T('🏷 Тип'),'typ'],['🤖 AI Proto','ai'],[T('📅 Дивиденды и отчёты'),'cal']]
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
      playbook:aiPlaybookEnsure(),
      trackRecord:aiTrackRecord(),
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
  const trades=pfRecentTrades(key);
  const realizedPLSEK=Math.round(trades.reduce((a,t)=>a+(t.plSEK||0),0));
  return{
    baseCurrency:'SEK',fxToSEK:FX,positions,
    allocation:{bySector:group('sector'),byCurrency:group('ccy')},
    totals:{stocksSEK:Math.round(totalVal),freeCashSEK:Math.round((num(d.cashFree)||0)*pf3BaseFx(d)),leverageSEK:Math.round((key===PF3_KEY?(num(d.leverage)||0):0)*pf3BaseFx(d))},
    // Уже СОВЕРШЁННЫЕ сделки по этому портфелю (журнал) — AI обязан учитывать их
    // ПЕРЕД советами: не предлагать обратное недавнему действию без причины и т.д.
    recentTrades:trades,realizedPLSEK,
    investorRules:AI_PREFS,   // личные правила инвестора — AI обязан их учитывать
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
    const snap=pf3AiSnapshot(key);
    // Вариант B: детерминированные вердикты скоринга сайта по всем тикерам —
    // чтобы «Предложение» AI было согласовано с вердиктом «Рекомендация» в карточке
    // и таблицах. Расхождение допускается, но AI обязан развести его по горизонтам.
    snap.recoLegend='{ТИКЕР:[recoVerdict(buy|wait|sell|avoid), upside%toTarget, %отSMA50, %отSMA200, P/E, вЭтомПортфеле(1|0)]} — детерминированный скоринг сайта (та же логика, что вердикт «Рекомендация» в карточке/таблицах). Это КРАТКОСРОЧНО-технический вердикт.';
    snap.recoVerdicts=dashRecoMap(key);
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
function aiPlaybookAdd(){const inp=document.getElementById('aiPbInp');const t=(inp&&inp.value||'').trim();if(!t)return;aiPlaybookEnsure();if(!AI_PLAYBOOK.includes(t))AI_PLAYBOOK.push(t);inp.value='';scheduleSave();renderPF3()}
function aiPlaybookDel(i){aiPlaybookEnsure();AI_PLAYBOOK.splice(i,1);scheduleSave();renderPF3()}
function aiPlaybookReset(){if(confirm(RT('Вернуть плейбук к стандартному набору принципов?','Reset the playbook to the default principles?'))){AI_PLAYBOOK=DEFAULT_PLAYBOOK.slice();scheduleSave();renderPF3()}}
function aiChatScroll(){const b=document.getElementById('aiChatBox');if(b)b.scrollTop=b.scrollHeight}

function pf3PlaybookHTML(){
  aiPlaybookEnsure();
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>${RT('📚 Инвест-плейбук — методичка «как обгонять индекс»','📚 Investing playbook — how to beat the index')}</span><span class="pf3-asof"><a href="#" onclick="aiPlaybookReset();return false">${RT('сбросить к стандарту','reset to default')}</a></span></div>
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
    <div class="pf3-panel-hd"><span>💵 ${RT('Cash-drag — отставание из-за кэша','Cash drag — lag from holding cash')}</span><span class="pf3-asof">${segP} ${segB}</span></div>
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
    <div class="pf3-panel-hd"><span>💱 ${RT('Валютный риск и хедж','Currency risk & hedge')}</span><span class="pf3-asof">${RT('SEK крепнет','SEK strengthens')} ${seg}</span></div>
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
  const equity=totalValB+free;   // чистый капитал в базовой валюте: акции + свободный кэш
  const withLev=equity+lev;      // покупательная способность с кредитным плечом
  const num=(key,val,cls)=>`<input class="pf3-cash-input${cls?' '+cls:''}" type="number" step="any" min="0" value="${val}" onchange="pf3SetNum('${key}',this.value)" title="Нажмите, чтобы изменить">`;
  const fxChip=c=>typeof FX[c]==='number'?`<span class="pf3-chip">1 ${c} = <b>${(+FX[c]).toFixed(2)}</b> kr</span>`:'';
  const cards=[
    {id:'equity',html:`<div class="pf3-card pf3-sum-hero" data-eid="equity"><div class="pf3-card-l">${T('Чистый капитал')}</div><div class="pf3-card-v">${pf3Fmt(equity)} ${unit}</div><div class="pf3-card-s">${T('акции + свободный кэш')}</div></div>`},
    {id:'stocks',html:`<div class="pf3-card" data-eid="stocks"><div class="pf3-card-l">${T('Акции')}</div><div class="pf3-card-v">${pf3Fmt(totalValB)} ${unit}</div><div class="pf3-card-s">${d.rows.length} ${T('позиций')} · ${equity>0?(totalValB/equity*100).toFixed(1):'—'}%</div></div>`},
    {id:'profit',html:`<div class="pf3-card" data-eid="profit"><div class="pf3-card-l">${T('Прибыль')}</div><div class="pf3-card-v ${totalProfit>=0?'pf3-up':'pf3-down'}">${totalProfit>0?'+':''}${pf3Fmt(totalProfitB)} ${unit}</div><div class="pf3-card-s ${pct>=0?'pf3-up':'pf3-down'}">${pct>0?'+':''}${pct.toFixed(1)}% ${T('от вложений')}</div></div>`},
    {id:'cash',html:`<div class="pf3-card" data-eid="cash"><div class="pf3-card-l">${T('Свободный кэш')}</div><div class="pf3-card-v">${num('cashFree',free)} <small>${unit}</small></div><div class="pf3-card-s">${equity>0&&free>0?(free/equity*100).toFixed(1)+'% '+T('% капитала · доступно для покупок').replace('% of equity','of equity').replace('% капитала','капитала'):T('нажмите, чтобы изменить')}</div></div>`},
  ];
  if(isDima){
    cards.push({id:'lev',html:`<div class="pf3-card" data-eid="lev"><div class="pf3-card-l">${T('Кредитное плечо')}</div><div class="pf3-card-v">${lev>0?'+':''}${num('leverage',lev)} <small>${unit}</small></div><div class="pf3-card-s">${T('доступный кредит сверх капитала')}</div></div>`});
    cards.push({id:'levavail',html:`<div class="pf3-card" data-eid="levavail"><div class="pf3-card-l">${T('Доступно с плечом')}</div><div class="pf3-card-v">${pf3Fmt(withLev)} ${unit}</div><div class="pf3-card-s">${T('капитал + кредитное плечо')}</div></div>`});
  }
  return`<section class="pf3-summary" data-edit-row="cards">${eapply('cards',cards).map(c=>c.html).join('')}</section>
  <div id="pfSumPP" class="pf3-pp pfsum-pp">${pfSumPPInner(pf3D())}</div>
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
  if(!nR.length)P(nR,0,'красных флагов нет','no red flags');
  let nowV;
  if(noData)nowV='wait';else if(knife)nowV='avoid';
  else if(sig.type==='sell'||overheat||(up!=null&&up<=-5))nowV='sell';
  else if(sig.type==='buy'&&(d200==null||d200>=0))nowV='buy';else nowV='wait';
  const nNote=noData?RT('недостаточно данных — обновите акции','not enough data — refresh stocks')
    :nowV==='avoid'?RT('падающий нож — ждать стабилизации у поддержки','falling knife — wait for support to hold')
    :nowV==='sell'?RT('у сопротивления / перегрев — зона фиксации','at resistance / overheated — take-profit')
    :nowV==='buy'?RT(`цена у уровня ${sig.n||'входа'} в восходящем тренде`,`price at level ${sig.n||'entry'} in uptrend`)
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
  ${li('💡 <b>'+RT('Рекомендация','Recommendation')+'</b> — '+RT('детерминированный скоринг сайта (техника + фундаментал + риск). Бесплатно, без токенов, считается всегда.','deterministic site scoring (technicals + fundamentals + risk). Free, no tokens, always computed.'))}
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
  if(pf3IsPort(v3Key))pfSumPPStart(v3Key);else pfSumPPStop();   // лайв изм. баланса по пре/пост-рынку
  editScheduleWire();   // перевесить drag на карточки сводки после перерисовки pf3
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
  }else if(v3Key===PF3_KEY)pfPerfDraw();   // график развития портфеля под сводкой
}

// The full card for the selected holding (everything: hero, stats, health, earnings, chart, buy levels).

// ===== 📈 Развитие портфеля (как у брокера): композит портфеля vs бенчмарки =====
// Истории всех бумаг за 3 года → дневные доходности, взвешенные ТЕКУЩИМИ долями
// позиций (приближение: состав считается неизменным), кумулятив в %.
// Бенчмарки сравниваются от начала выбранного периода. Кеш 6 часов.
// Все семейные портфели + индексы OMXS30/Nasdaq 100, цвета линий настраиваются,
// старт по умолчанию — с прошлой пятницы. Кеш 6 часов.
let pfPerf={range:'fri',hist:null,loaded:0,loading:false,failed:false,on:{}};
const PFP_BENCH=[['^OMX','OMXS30','#f5c863'],['^NDX','Nasdaq 100','#8b8cf8']];
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
function pfpPortSeries(key,histBy){
  const d=DATA[key];if(!d)return null;
  const pos=d.rows.map((r,i)=>{recalcPF(i,key);return{sym:exSymbol(r[2],r[8]),w:parseFloat(r[13])||0}}).filter(x=>x.sym&&x.w>0);
  const tot=pos.reduce((a,x)=>a+x.w,0);if(!(tot>0))return null;
  const byDay={};
  pos.forEach(p=>{const h=histBy[p.sym];if(!h||!Array.isArray(h.c)||h.c.length<30)return;const w=p.w/tot;
    for(let k=1;k<h.c.length;k++){if(!(h.c[k-1]>0&&h.c[k]>0))continue;const day=new Date(h.t[k]*1000).toISOString().slice(0,10);const o=byDay[day]||(byDay[day]={s:0,w:0});o.s+=(h.c[k]/h.c[k-1]-1)*w;o.w+=w;}});
  let cum=1;const ser=Object.keys(byDay).sort().filter(k=>byDay[k].w>=0.5).map(k=>{cum*=1+byDay[k].s/byDay[k].w;return{d:k,v:cum}});
  return ser.length>=5?ser:null;
}
async function pfPerfLoad(){
  if(pfPerf.loading||(pfPerf.hist&&Date.now()-pfPerf.loaded<6*3600*1000))return;
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
    if(!Object.keys(portsSer).length)throw new Error('no port history');
    const bench={};PFP_BENCH.forEach(b=>{const h=histBy[b[0]];if(h&&Array.isArray(h.c))bench[b[0]]=h.c.map((c,i2)=>({d:new Date(h.t[i2]*1000).toISOString().slice(0,10),v:c})).filter(x=>x.v>0)});
    pfPerf.hist={ports:portsSer,bench};pfPerf.loaded=Date.now();
  }catch(e){pfPerf.failed=true;}
  pfPerf.loading=false;
  if(isV3()&&v3Key===PF3_KEY&&pf3Tab==='list'&&!pf3Sel)renderPF3();
}
function pfPerfHTML(){
  const H=pfPerf.hist;
  const ranges=[['fri',RT('с пт','since Fri')],['1m',RT('1 мес','1M')],['3m',RT('3 мес','3M')],['ytd',RT('в этом году','YTD')],['1y',RT('1 год','1Y')],['3y',RT('3 года','3Y')]];
  const esc=s=>String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');
  const from=pfPerfFrom(pfPerf.range);
  const chip=(key,name,def,ser)=>{
    const c=pfpCol(key,def),on=pfpOn(key);
    const p=(on&&ser)?pfPerfPct(ser,from):null;
    return`<span class="pfp-chip${on?' on':''}" style="--c:${c}"><input type="color" class="pfp-color" value="${c}" title="${RT('цвет линии','line colour')}" onclick="event.stopPropagation()" onchange="pfPerfSetColor('${esc(key)}',this.value)"><button class="pfp-chip-b" onclick="pfPerfToggle('${esc(key)}')">${name}${p!=null?` <span class="${p>=0?'pf3-up':'pf3-down'}">${(p>0?'+':'')+p.toFixed(2)}%</span>`:''}</button></span>`;
  };
  const chips=pfpPorts().map(p=>chip(p.key,p.name,p.def,H&&H.ports[p.key])).join('')
    +PFP_BENCH.map(([sym,n,def])=>chip(sym,n,def,H&&H.bench[sym])).join('');
  const btn=([k,l])=>`<button class="pfp-r${pfPerf.range===k?' on':''}" onclick="pfPerfRange('${k}')">${l}</button>`;
  return`<section class="pf3-panel pfp">
    <div class="pf3-panel-hd"><span>${RT('📈 Развитие портфелей','📈 Portfolios performance')}</span><span class="pfp-chips">${chips}</span></div>
    <div id="pfPerfBox" class="pfp-chart">${H?'':`<div class="pf3-empty">${pfPerf.loading?RT('Загружаю истории цен всех позиций…','Loading price histories…'):pfPerf.failed?RT('Не удалось загрузить истории цен','Failed to load price histories'):'…'}</div>`}</div>
    <div class="pfp-ranges">${ranges.map(btn).join('')}</div>
    <div class="pf3-risk-note">${RT('3 портфеля + индексы · состав каждого считается текущим на периоде · старт с прошлой пятницы · клик по квадрату — цвет линии','3 portfolios + indices · current composition over the period · starts last Friday · click the swatch to recolour')}</div>
  </section>`;
}
function pfPerfRange(k){pfPerf.range=k;renderPF3()}
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
  pfpPorts().forEach(p=>{if(!pfpOn(p.key))return;const ser=pfPerf.hist.ports[p.key],dd=ser&&mk(ser);if(dd)chart.addLineSeries({color:pfpCol(p.key,p.def),lineWidth:2.5,priceFormat:fmt}).setData(dd);});
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
      }catch(e){ break; }   // эндпоинт недоступен (старый воркер/CORS) → не долбим и не висим
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
  let bear=price*(1-R);
  const support=+inp.support||0;
  if(support>0&&support<price&&support>bear&&support>=price*(1-R*1.5))bear=support;
  const rsi=inp.rsi==null?null:+inp.rsi;
  const overbought=(rsi!=null&&rsi>cfg.rsiHot)||(price>consensus);
  const stretch=price>consensus&&overbought;
  // B.8 sanity: bull≥base≥bear и upside≥0; иначе «неконсистентно», R/R скрыт.
  if(!(bull>=base&&base>=bear)) return {horizon:'mid',valid:false,note:'broken',price,bull,base,bear,rr:null,stretch};
  if(bull<=price)              return {horizon:'mid',valid:false,note:'noupside',price,bull,base,bear,rr:null,stretch};   // цена выше верхнего таргета
  const upside=(bull-price)/price*100, downside=(price-bear)/price*100;
  const rr=downside>0?upside/downside:null;
  let bullConf=high>0?'medium':'low', bearConf='medium';
  if(stretch){bullConf='low';bearConf='high';}
  return {horizon:'mid',valid:true,note:null,price,bull,base,bear,upside,downside,rr,bullConf,baseConf:'medium',bearConf,stretch,R};
}
// Свежий консенсус-таргет для среднесрочного сценария — тот же источник, что и
// карточка: TG_FULL (агрегация A.1) → квартальный срез pf3EffTarget → eff (если не
// stale). Устаревшим (не используется) считается ТОЛЬКО all-time (eff.main).
function scnFreshTarget(d,r){
  const tk=String(r[2]||'').toUpperCase(), tgf=TG_FULL[tk];
  if(tgf&&tgf.consensus>0&&tgf.lastDate&&((Date.now()-Date.parse(tgf.lastDate))/864e5<=SCENARIO_CFG.freshDays))
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
  const sh=scenarioShort({price,atr:tech.atr,support,resistance,sma50,rsi:tech.rsi});       // RSI 1D
  const md=scenarioMid({price,target:consensus,targetHigh:high,support,rsi:tech.rsiW,fresh}); // RSI 1W
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
  // Среднесрок: учитываем валидность (A.1 / B.8).
  let mdBody;
  if(md.valid){
    const mdBearTrig=RT(`слабый отчёт / снижение гайденса → −${Math.round(md.R*100)}%`,`earnings miss / guidance cut → −${Math.round(md.R*100)}%`);
    mdBody=`<div class="scn-grid">
      ${cell('🟢','Bull',md.bull,'bull',md.bullConf,RT('отчёт выше ожиданий / рост гайденса','earnings beat / guidance raise'),'event')}
      ${cell('⚪','Base',md.base,'base',md.baseConf,RT('консенсус-таргет','analyst consensus'),'event')}
      ${cell('🔴','Bear',md.bear,'bear',md.bearConf,mdBearTrig,'event')}
    </div>${rrRow(md)}`;
  }else{
    const msg=md.note==='lowdata'?RT('Недостаточно свежих таргетов аналитиков — Bull/Base не рассчитаны, R/R не показан.','No fresh analyst targets — Bull/Base not computed, R/R hidden.')
      :md.note==='noupside'?RT(`Цена выше верхнего таргета аналитиков (${pf3Fmt(md.bull,0)} ${ccy}) — потенциала вверх по таргетам нет, R/R не показан.`,`Price is above the highest analyst target (${pf3Fmt(md.bull,0)} ${ccy}) — no target upside, R/R hidden.`)
      :RT('Данные неконсистентны (Bull ниже Base) — R/R скрыт.','Inconsistent data (Bull below Base) — R/R hidden.');
    const staleRef=(md.note==='lowdata'&&staleConsensus>0)?`<div class="scn-stale-ref">${RT('устар. таргет','stale target')} ~${pf3Fmt(staleConsensus,0)} ${ccy} — ${RT('не используется в сценариях','not used in scenarios')}</div>`:'';
    mdBody=`<div class="scn-nodata">⚠️ ${msg}</div>${staleRef}`;
  }
  const mdBlock=`<div class="scn-hz"><div class="scn-hz-h">📅 ${RT('Среднесрок','Mid-term')} <span class="scn-hz-s">${RT('до отчёта · таргеты + событие','to earnings · targets + event')} · RSI ${tf(tech.rsiW,'1W')}</span>${md.stretch?` <span class="scn-stretch">⚠ ${RT('растяжение','stretched')}</span>`:''}</div>${mdBody}</div>`;
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>📊 ${RT('Сценарии','Scenarios')}</span><span class="pf3-asof">${RT('от','from')} ${pf3Fmt(price,2)} ${ccy}${tech.atr>0?` · ATR ${pf3Fmt(tech.atr,2)} 1D`:''}</span></div>
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
    <div class="pf3-panel-hd"><span>🎯 ${RT('Аналитические таргеты','Analyst targets')}</span><span class="pf3-asof">${t.count?`${t.count} ${RT('аналит.','an.')}`:''}${t.lastDate?` · ${RT('посл.','last')} ${t.lastDate}`:''}${stale?` <span class="tg-stale">⚠️ ${RT('устар.','stale')}</span>`:''}</span></div>
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
  const hd=`<div class="pf3-panel-hd"><span>📐 ${RT('Оценка — мультипликаторы','Valuation — multiples')}</span><span class="pf3-asof">${v&&v.at?RT('обновлено','updated')+' '+pf3DtRu(v.at):''}</span></div>`;
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
  return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>🧭 ${RT('Инсайдеры × Недооценка','Insiders × Undervaluation')}</span><span class="pf3-asof">${RT('связка сигналов — справочно','signal crossover — reference')}</span></div>${body}</section>`;
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
  const tbl=(title,sub,arr,why)=>`<section class="pf3-panel"><div class="pf3-panel-hd"><span>${title}</span><span class="pf3-asof">${sub}</span></div>${arr.length?`<table class="bp-tbl"><thead><tr><th>#</th><th>${RT('Акция','Stock')}</th><th>${RT('Цена','Price')}</th><th>${RT('Почему','Why')}</th></tr></thead><tbody>${arr.map((x,i)=>`<tr onclick="insiderOpenCard('${x.tk}')"><td class="bp-n">${i+1}</td><td class="bp-name"><b>${x.name}</b> <span class="bp-tk">${x.tk}</span></td><td class="bp-px">${pf3Fmt(x.price,2)} <small>${x.ccy}</small></td><td class="bp-why">${why(x)}</td></tr>`).join('')}</tbody></table>`:`<div class="pf3-empty">${RT('Подходящих кандидатов нет — нажмите «🔄 Обновить всё».','No suitable candidates — press «🔄 Update all».')}</div>`}</section>`;
  return`
    ${tbl('🥇 '+RT('Лучшие на 1–3 мес','Best 1–3 months'),RT('импульс и точки входа','momentum & entry'),P.short,bpWhyShort)}
    ${tbl('🥈 '+RT('Лучшие на 3–6 мес','Best 3–6 months'),RT('тренд + разумная цена','trend + fair value'),P.medium,bpWhyMed)}
    ${tbl('🥉 '+RT('Лучшие на 6–12 мес','Best 6–12 months'),RT('фундаментал и недооценка','fundamentals & value'),P.long,bpWhyLong)}
    <div class="pf3-ai-note">${RT('Детерминированный отбор из всех вкладок по обновлённым данным. Справочно, не инвестиционная рекомендация.','Deterministic screen across all tabs from refreshed data. Reference only, not investment advice.')}</div>`;
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
    if(j&&typeof j==='object'){HOME_FUT=j;_homeFutAt=Date.now();const el=document.getElementById('homeFutWrap');if(el&&curIdx===HOME_KEY)el.innerHTML=homeMktInner();}
  }catch(e){}
  _homeFutLoading=false;
}
function homeFutStart(){homeLoadFutures();if(_homeFutTimer)return;_homeFutTimer=setInterval(()=>{if(curIdx===HOME_KEY&&!document.hidden)homeLoadFutures();},20000);}
function homeFutStop(){if(_homeFutTimer){clearInterval(_homeFutTimer);_homeFutTimer=null;}}

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
function homeFutTiles(list){
  return list.map(([sym,ru,en])=>{
    const q=HOME_FUT[sym],p=q&&typeof q.price==='number'?q.price:null,pct=q&&typeof q.pct==='number'?q.pct:null;
    const cls=pct==null?'':pct>=0?'pf3-up':'pf3-down';
    return`<div class="fut-tile"><div class="fut-name">${RT(ru,en)}</div><div class="fut-px">${p!=null?pf3Fmt(p,2):'—'}</div><div class="fut-ch ${cls}">${pct!=null?(pct>=0?'▲ +':'▼ ')+pct.toFixed(2)+'%':'…'}</div></div>`;
  }).join('');
}
function homeMktInner(){
  const sec=(title,list,sub)=>`<section class="pf3-panel"><div class="pf3-panel-hd"><span>${title} <span class="fut-live">● LIVE</span></span><span class="pf3-asof">${sub}</span></div><div class="fut-grid">${homeFutTiles(list)}</div></section>`;
  return sec('📈 '+RT('Фьючерсы и сырьё','Futures & commodities'),HOME_MKT_FUT,homeFutAtLbl())
    +sec('🌍 '+RT('Мировые индексы','World indices'),HOME_MKT_IDX,RT('спот · в часы торгов биржи','spot · during market hours'));
}
function homeFuturesHTML(){return`<div id="homeFutWrap">${homeMktInner()}</div>`;}
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
  return`<section class="pf3-panel"><div class="pf3-panel-hd"><span>🔮 ${RT('Прогноз — топ-10 акций по горизонтам','Forecast — top-10 stocks by horizon')}</span><span class="pf3-asof">${sub}</span>${aiBtn}</div>${body}<div class="pf3-reco-note">${note}</div></section>`;
}
function homeHTML(){
  const items=[
    {id:'futures',html:homeFuturesHTML()},
    {id:'tools',html:`<section class="pf3-panel"><div class="pf3-panel-hd"><span>📊 ${RT('Рынок сейчас','Market now')}</span><span class="pf3-asof">${RT('лучшие кандидаты по горизонтам','best candidates by horizon')}</span><button class="pf3-btn pf3-btn-sm" id="homeUpdBtn" onclick="homeUpdateAll()">🔄 ${RT('Обновить всё','Update all')}</button>${isAdmin()?`<button class="pf3-btn pf3-btn-sm" id="insiderBtn" onclick="insiderUpdateAll()" title="${RT('Инсайдерские сделки по всем вкладкам (US: Finnhub · SE: Finansinspektionen)','Insider transactions across all tabs (US: Finnhub · SE: Finansinspektionen)')}">🕵 AI Insider</button>`:''}${isAdmin()?`<button class="pf3-btn pf3-btn-sm" id="valBtn" onclick="valUpdateAll()" title="${RT('Мультипликаторы vs медиана сектора и собственная история','Multiples vs sector median and own history')}">📐 ${RT('Оценка','Valuation')}</button>`:''}</div></section>`},
    {id:'best',html:homeBestHTML()},
    {id:'forecast',html:homeForecastHTML()},
  ];
  if(isAdmin()){ items.push({id:'signal',html:homeSignalHTML()}); items.push({id:'val',html:homeValHTML()}); items.push({id:'insider',html:homeInsiderHTML()}); }
  return erow('home',items,'edit-rows-v');
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
    ${stockReportHTML(d,r)}
    ${can('view.ai_reco')?aiRecoHTML(d,r):''}
    ${pf3ScenarioHTML(d,r)}
    ${can('view.valuation')?targetsBlockHTML(d,r):''}
    ${isAdmin()?stockAiHTML(d,r):''}
    ${can('view.valuation')?valHTML(d,r):''}
    ${can('view.insider')?insiderHTML(d,r):''}
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
  return`<section class="pf3-panel">
    <div class="pf3-panel-hd"><span>📜 ${RT('История сделок','Trade history')}${fk?'':' — '+TAB_LABEL(v3Key)}</span>${tot}</div>
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
function planActIcon(act){ return act==='sell'?'🔴':'🟢'; }
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
  if(!acts.length){toast(RT('Нет структурированного совета — запустите анализ на «🤖 AI Proto»','No structured advice — run analysis on «🤖 AI Proto»'),true);return;}
  const d=pf3D(); let added=0;
  acts.forEach((a,i)=>{
    const isSell=/прода|сократ|уменьш|fix|sell|trim|reduce/i.test(a.action||'');
    const isBuy=/куп|докуп|добав|нарасти|buy|add|increase/i.test(a.action||'');
    if(!isBuy&&!isSell)return;   // «держать/наблюдать» — пропускаем
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
    PLAN_RULES.push({id:'pl'+Date.now()+'_'+i+'_'+Math.floor(Math.random()*1e4),tab:v3Key,tk,name:String(a.name||(row&&row[1])||tk),ccy,act,level:level||0,amount,qty:0,deadline:'',note:String(a.details||'').trim(),hitAt:0,done:false,fromAi:1});
    added++;
  });
  if(added){planAskNotify(true);scheduleSave();renderPF3();toast('📥 '+RT('Перенесено из совета AI','Imported from AI advice')+': '+added+'. '+RT('Проверьте уровни и кол-во ✏','Check levels & qty ✏'));}
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
      <span class="plan-act ${r.act}">${planActIcon(r.act)} ${r.act==='sell'?RT('Сократить','Trim'):RT('Купить','Buy')}</span>
      <span class="plan-main"><b>${esc(r.name||r.tk)}</b> <span class="plan-tk">${esc(r.tk)}</span> ${badge}${r.fromAi?`<span class="plan-src" title="${RT('Перенесено из совета AI','From AI advice')}">🤖</span>`:''}<span class="plan-sub">${bits.join(' · ')}</span>${r.note?`<span class="plan-note">${esc(r.note)}</span>`:''}</span>
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

// Данные по умолчанию (const ALL) вынесены в data.js — он подключается в
// index.html ПЕРЕД этим файлом и кешируется отдельно от логики.
let DATA=ALL.data;

// ===== Supabase sync config =====
// Create a free project at https://supabase.com, run the SQL in SETUP.md, then
// paste your Project URL + anon/publishable key below. Both are safe to expose
// in frontend code — your data is protected by login + Row-Level Security.
const SUPABASE_URL = 'https://fvrebkwczqmeorytujbn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9CIG7HU54hfBcexS4qr3rQ_HQygVVJC';
// Библиотека supabase-js грузится с CDN (пин версии + SRI, см. index.html); если она не
// загрузилась — работаем в локальном режиме на встроенных данных (путь `!SYNC_ENABLED`).
const SYNC_ENABLED = SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20 && !!(window.supabase && window.supabase.createClient);
const sb = SYNC_ENABLED ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let currentUser=null, realtimeChannel=null, pushTimer=null, applyingRemote=false, lastPushTs=0;

// The entire editable state, stored as one JSONB row per user.
function snapshotState(){
  // S7b-3: rankings/sma/colOrders/hiddenCols/tabGroups/tabOrder (состояние классических таблиц и навигации) не пишутся —
  // старый клиент без них ничего не теряет. sim/aiDash/scnAlerts/tgAlerts — заморожены до блока E (plans/audit-followup.md).
  return { data:DATA, fx:FX,
           theme:(document.documentElement.dataset.theme||'light'),
           smaTf:SMA_TF, sim:SIM, pfTrades:PF_TRADES, aiChat:AI_CHAT, tgAlerts:TG_ALERTS, aiPort:AI_PORT, aiPortBak:AI_PORT_BAK, stockAiLog:STOCK_AI_LOG, insider:INSIDER, tgMeta:TG_META, val:VAL, tgFull:TG_FULL, aiReco:AI_RECO, aiSpend:AI_SPEND, aiDash:AI_DASH, aiPlaybook:AI_PLAYBOOK, aiPlaybookSeedV:AI_PLAYBOOK_SEEDV, planRules:PLAN_RULES, scnAlerts:SCN_ALERT_STATE, news:NEWS_TEXT, newsImpact:NEWS_IMPACT, aiInclChat:AI_INCL_CHAT, cycleOvr:CYCLE_OVR,
           posMeta:POS_META, desk:DESK, deskWatch:DESK_WATCH, schemaV:STATE_V };
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
  const { data:ret, error } = await sb.from('ledger_state')
    .upsert({ user_id:currentUser.id, data:snap, updated_at:ts }).select('data->rev');
  if(error){ console.warn('Sync push failed', error); return; }
  // Триггер молчит: при rev-конфликте (в облаке уже rev ≥ нашего — другая вкладка/воркер
  // успели записать) он делает `return OLD` без ошибки, строка остаётся со старым rev.
  // Проверяем по вернувшейся строке. Отклонили → перечитываем облако (pullState →
  // applyRemoteState берёт stateRev из облака, следующий push пройдёт). Теряются
  // локальные правки после последнего успешного push — об этом и говорит тост.
  if(!syncCommitted(ret, snap.rev)){
    console.warn('Sync push rejected (rev conflict)', ret);
    toast(RT('⚠ Конфликт синхронизации: в облаке новее — данные перечитаны, повторите последнюю правку','⚠ Sync conflict: cloud is newer — state reloaded, redo your last edit'), true);
    await pullState();
    return;
  }
  stateRev=snap.rev; pfBackupSave();   // приняли — запоминаем rev + локальный бэкап
}
// Детект коммита по вернувшейся строке (.select('data->rev')): БД-триггер при
// rev-конфликте делает `return OLD` без ошибки — строка остаётся со СТАРЫМ rev.
// Коммит прошёл ⇔ rev вернувшейся строки равен тому, что мы записали.
function syncCommitted(rows, expectedRev){
  const row = Array.isArray(rows) ? rows[0] : rows;
  const rev = row && (row.rev !== undefined ? row.rev : (row.data && row.data.rev));
  return Number(rev) === expectedRev;
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
    const hasMeta=posMetaCount(POS_META)>0,hasWatch=!!(DESK_WATCH&&DESK_WATCH.items&&DESK_WATCH.items.length);
    if(!hasTrades&&!hasPos&&!hasMeta&&!hasWatch)return;   // нечего бэкапить — не затираем хороший бэкап пустым
    localStorage.setItem(k, JSON.stringify({at:Date.now(),pfTrades:PF_TRADES,ports,posMeta:hasMeta?POS_META:undefined,deskWatch:hasWatch?DESK_WATCH:undefined}));
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
// Мета позиций (стоп/цель/сторона) из локального бэкапа — когда облачный снапшот пришёл без
// ключа posMeta (его записал клиент до S3). true — восстановили, нужен push.
function posMetaBackupRestore(){
  const k=pfBackupKey(); if(!k)return false;
  let bak=null; try{ bak=JSON.parse(localStorage.getItem(k)||'null'); }catch(e){}
  if(!bak||!bak.posMeta||!posMetaCount(bak.posMeta))return false;
  POS_META=bak.posMeta; return true;
}
// Список покупок из локального бэкапа — облачный снапшот без ключа deskWatch (записал клиент до I1).
function deskWatchBackupRestore(){
  const k=pfBackupKey(); if(!k)return false;
  let bak=null; try{ bak=JSON.parse(localStorage.getItem(k)||'null'); }catch(e){}
  const w=bak&&bak.deskWatch?deskWatchNorm(bak.deskWatch):null;
  if(!w||!w.items.length)return false;
  DESK_WATCH=w; return true;
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
  if(s.fx) FX=s.fx;
  if(s.smaTf) SMA_TF=s.smaTf;
  if(Array.isArray(s.sim)) SIM=s.sim;
  if(Array.isArray(s.pfTrades)) PF_TRADES=s.pfTrades;
  if(Array.isArray(s.planRules)) PLAN_RULES=s.planRules.map(planRuleNorm);   // v1 → v2 (аддитивные поля, идемпотентно)
  STATE_V=(typeof s.schemaV==='number')?s.schemaV:0;   // до migrateState(): migrateSchema знает, какие одноразовые шаги уже применены
  // posMeta/desk: ключа НЕТ ⇔ снапшот записал клиент до S3 (он их не знает и при записи выбросил).
  // Тогда не затираем локальные — берём их или локальный бэкап и пушим обратно после init.
  let restoreMeta=false;
  if(s.posMeta&&typeof s.posMeta==='object') POS_META=s.posMeta;
  else restoreMeta=posMetaCount(POS_META)>0||posMetaBackupRestore();
  // desk.whatIf (I2): клиент до I2 выбрасывает поле при deskNorm — локальные настройки «Что если?» не сбрасываем.
  if(s.desk&&typeof s.desk==='object') DESK=deskNorm(Object.assign({},s.desk,s.desk.whatIf?{}:{whatIf:DESK&&DESK.whatIf}));
  // deskWatch (I1): та же защита — снапшот без ключа записал клиент до I1, локальный список не затираем.
  let restoreWatch=false;
  if(s.deskWatch&&typeof s.deskWatch==='object') DESK_WATCH=deskWatchNorm(s.deskWatch);
  else restoreWatch=(DESK_WATCH&&DESK_WATCH.items&&DESK_WATCH.items.length>0)||deskWatchBackupRestore();
  if(s.scnAlerts&&typeof s.scnAlerts==='object') SCN_ALERT_STATE=s.scnAlerts;
  if(Array.isArray(s.aiChat)) AI_CHAT=s.aiChat;
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
  if(typeof s.rev==='number') stateRev=s.rev;   // приняли облачную ревизию → наш след. push = rev+1
  if(s.theme) applyTheme(s.theme);
  applyingRemote=false;
  // 🛡 Если облако пришло с пустым журналом сделок, а локальный бэкап его помнит —
  // значит состояние затёрли (устаревшая вкладка/гонка). Восстанавливаем и пушим.
  if(pfBackupRestore()){
    toast(RT('Восстановлены сделки и позиции из локальной копии (облако было обнулено)','Restored trades & positions from local backup (cloud was wiped)'),true);
    scheduleSave();
  }
  if(restoreMeta||restoreWatch) scheduleSave();   // мета позиций / список покупок пережили запись старым клиентом — вернуть в облако
  migrateState();   // один проход на загрузку облачного состояния (S7a)
  init();   // перерисовать с синхронизированными данными
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
  await sb.auth.signOut(); currentUser=null; syncReady=false;
  document.getElementById('authOverlay').classList.remove('hidden');
  init();   // за оверлеем входа остаются только публичные вкладки
}
async function startApp(){
  document.getElementById('authOverlay').classList.add('hidden');
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
      ${row('🗂','Вкладки в меню слева (на телефоне — сверху): индексы (Nasdaq, OMXS30…) и ваши портфели. 🏠 Home — сводка рынка и барометр.','Tabs in the left menu (on top on a phone): indices (Nasdaq, OMXS30…) and your portfolios. 🏠 Home — market overview & barometer.')}
      ${row('📋','Клик по строке/бумаге открывает карточку: цена, уровни, фундаментал, тезис-монитор.','Click a row/stock to open its card: price, levels, fundamentals, thesis monitor.')}
      ${row('🤖','В карточке — AI-анализ и AI-рекомендация (Claude + веб-поиск свежих новостей).','In the card — AI analysis & AI recommendation (Claude + web search of fresh news).')}
      ${row('🔄','«Обновить» подтягивает живые котировки и технические уровни (Yahoo).','“Refresh” pulls live quotes and technical levels (Yahoo).')}
      ${row('🖥','Trade Desk (кнопка 🖥 в шапке, бета) — решения дня: вход, стоп, цель и R/R, скринер по всем вкладкам, график с планом лонг/шорт.','Trade Desk (🖥 in the header, beta) — today’s decisions: entry, stop, target and R/R, a screener across all tabs, a chart with a long/short plan.')}
      ${row('❓','Кнопка «?» в шапке и значки «!» рядом с разделами объясняют все обозначения.','The “?” button in the header and “!” icons next to sections explain every label.')}
    </div>
    <div class="onb-note">${RT('Справочная аналитика, не индивидуальная инвестиционная рекомендация.','Reference analytics, not individual investment advice.')}</div>
    <button class="primary onb-ok" onclick="onbDone()">${RT('Понятно, начать','Got it, start')}</button>`;
}
async function boot(){
  initTheme();
  try{localStorage.removeItem('dash_sig_shadow');}catch(e){}   // S7b-3: теневой журнал сигналов удалён — освободить место
  migrateState();                 // бандл data.js → текущая схема (v3-вкладки, сид Портфеля 3.0)
  init();                         // paint with bundled data first
  if(!SYNC_ENABLED){
    // Синк сконфигурирован, но supabase-js с CDN не загрузился — предупреждаем и живём офлайн.
    if(SUPABASE_URL.startsWith('http')) toast(RT('Библиотека Supabase не загрузилась — офлайн-режим на встроенных данных','Supabase library failed to load — offline mode on bundled data'), true);
    refreshFX(); maybeOnboard(); return;
  }
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
// Экранирование внешних строк (Yahoo, e-mail чужих аккаунтов) для innerHTML и атрибутов; ссылки — только http(s) (аудит security-rbac#6).
const escHtml=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const safeUrl=u=>/^https?:\/\//i.test(String(u||''))?String(u):'';
let PLAN_RULES=[];   // 🎯 правила-триггеры плана действий (уровень/дедлайн → уведомление)
// 📍 Мета позиции (слой данных редизайна, S3): POS_META[tab][TK] = {side:'long'|'short', stop0, stop,
// target, riskKr, opened, planId}. qty и средняя цена остаются в строке r[6]/r[9] (налог pfTaxLots их
// считает как раньше); стоп входа stop0 хранится отдельно от текущего stop — R считается от него.
let POS_META={};
// ⚙ Настройки риска новой оболочки: riskPct — % капитала портфеля на сделку, riskCapPct — лимит
// суммарного открытого риска книги (решение §10#6); shortOk[SYM] — ручной флаг «шорт доступен» (§10#7).
let DESK={riskPct:1,riskCapPct:6,shortOk:{}};
// 🛒 Список покупок Trade Desk (I1, plans/reference-features-implementation.md §2.1): идеи «хочу купить и почему» —
// зона покупки, тезис, сценарии справедливой стоимости. Нормализация и мутаторы — deskWatch* в app-5.js.
let DESK_WATCH={v:1,lists:[{id:'main',name:'',order:0}],items:[]};
// Версия схемы снапшота (schemaV): одноразовые шаги migrateSchema не повторяются после применения.
const SCHEMA_V=3;
let STATE_V=0;
let SCN_ALERT_STATE={};   // 📊 Блок D: последнее наблюдаемое состояние сценариев по тикеру (дедуп алертов)
// Кулдауны Telegram-алертов: пишет worker, клиент только прокидывает через
// свои сохранения, чтобы push дашборда не стирал память бота.
let TG_ALERTS={};
// AI Proto: диалог с ассистентом (личные правила инвестора отменены — investorRules пуст).
let AI_CHAT=[],aiChatBusy=false;
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
    return`<div class="news-row" onclick="deskOpenTk('${e.tk}')">
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
// Попытка загрузки истории индексов — не чаще раза в 5 мин: при ошибке сети блоки (трек-рекорд AI, cash-drag) звали бы
// её на каждой перерисовке (в Trade Desk фоновые перерисовки частые).
let _idxTryAt=0;
const idxTryOk=()=>{if(Date.now()-_idxTryAt<5*60e3)return false;_idxTryAt=Date.now();return true;};
function aiEnsureIdxHist(){ if(_idxHistLoading||(IDX_HIST['^OMX']&&IDX_HIST['^NDX'])||!idxTryOk())return; _idxHistLoading=true; aiLoadIdxHist().then(()=>{_idxHistLoading=false;if(isV3()&&pf3Tab==='ai')renderPF3()}); }
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
let pf3StockAi={sym:null,loading:false,text:null,data:null,at:null};   // текущий показанный разбор
let AI_SPEND={usd:0,runs:0,in:0,out:0,searches:0};   // 💸 накопленные AI-расходы (sync)
let AI_DASH={};   // 📊 AI-Dashboard: {tabKey:{headline,cards,picks,asOf,at,cost}} — отдельно по портфелям (sync)
let AI_RECO={};   // 🔄 AI-Рекомендация по тикеру (sync): {verdict,confidence,headline,entryLow,entryHigh,keyRisks,text,price,ccy,at}
let _aiRecoLoading=null;   // тикер, по которому сейчас идёт запрос
let _aiRecoOpen={};   // раскрыт ли полный разбор по тикеру
let _stkCardOpen={};   // sym → раскрыт ли полный текст разбора в карточке
function stockAiToggle(sym){_stkCardOpen[sym]=!_stkCardOpen[sym];renderPF3();}
// Per-stock SMA timeframe: SMA_TF[ticker] = { mode:'1Y'|'3Y', d:[s50,s100,s200] (daily), w:[…] (weekly) }.
// The visible SMA columns show d (1Y) or w (3Y) per the stock's chosen mode. Persisted in snapshotState.
let SMA_TF={};
// ===== Live exchange rates (official mid-market, ≈ what Google shows) =====
// Base currency is SEK; FX[ccy] = how many SEK per 1 unit of ccy.
// Sources return "1 SEK = rates[ccy] ccy", so SEK-per-ccy = 1/rates[ccy].
// Tried in order; on total failure we keep whatever rates are already loaded.
const FX_CCYS=['USD','EUR','NOK','DKK','GBP'];
async function fetchRatesSEK(){
  const sources=[
    // ECB official reference rates. Старый адрес api.frankfurter.app отвечает 301 без CORS — браузер его блокировал
    // (ошибка в консоли, курсы шли только из резервного источника); новый — api.frankfurter.dev/v1 (base/symbols).
    async()=>(await(await fetch('https://api.frankfurter.dev/v1/latest?base=SEK&symbols='+FX_CCYS.join(','))).json()).rates,
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
let curIdx='OMXS30';   // вкладка контекста встроенных блоков (ставит deskCtx)
// v3-вкладки (строки бумаг с индексной схемой колонок): «Портфель 3.0», семейные портфели, индексы, свои watchlist'ы.
const PF3_KEY='🚀 Портфель 3.0';
const ANALYSIS_IDX='Nasdaq 100';
let v3Key=PF3_KEY;                  // вкладка контекста встроенных блоков (ставит deskCtx)
const pf3D=()=>DATA[v3Key];
const AIP_KEY='🤖 AI Портфель';     // AI-портфель (админ): виртуальный счёт под управлением Claude; DATA[AIP_KEY] — производная вкладка
const pf3IsPort=k=>k===PF3_KEY||k===AIP_KEY||!!(DATA[k]&&DATA[k].port==='1');   // вкладки с экономикой позиций
const pf3MyPort=k=>pf3IsPort(k)&&k!==AIP_KEY;   // редактируемые портфели (мои/семейные, не AI)
// Все v3-вкладки: портфель + любые вкладки с флагом v3 (индексы и созданные пользователем).
const v3Tabs=()=>[PF3_KEY,...Object.keys(DATA).filter(k=>k!==PF3_KEY&&k!==AIP_KEY&&DATA[k]&&DATA[k].v3==='1')];

// Контекст встроенного блока — v3-вкладка или AI-портфель (виртуальные вкладки классики удалены в S7b-3).
const isV3=()=>v3Tabs().includes(curIdx)||curIdx===AIP_KEY;
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
function initLang(){try{LANG=localStorage.getItem('dash_lang')==='en'?'en':'ru'}catch(e){}try{document.documentElement.lang=LANG}catch(e){}}
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
'💪 Здоровье бизнеса':'💪 Business health','🔬 AI-анализ акции':'🔬 AI stock analysis','🔄 AI-Рекомендация':'🔄 AI recommendation','📐 Оценка — мультипликаторы (Valuation Check)':'📐 Valuation Check — multiples','📅 Ближайший отчёт и ожидания рынка':'📅 Next earnings & market expectations','🎯 Технические уровни':'🎯 Technical levels','🛒 Уровни покупки / докупки':'🛒 Buy / add levels','по техданным · авто-обновление каждые 5 мин':'from technicals · auto-refreshed every 5 min','✏️ Моя позиция':'✏️ My position','Кол-во акций':'Shares','🔄 Обновить цену':'🔄 Refresh price','Годовой отчёт':'Annual report','Посл. квартал':'Last quarter','Стоимость позиции':'Position value','Аналит. таргет':'Analyst target','за день':'today','потенциал':'upside','Удалить':'Remove','Удалить акцию':'Remove stock','Закрыть позицию':'Close position','Закрыть тестовую позицию':'Close test position',
'Календарь — отчёты и дивиденды':'Calendar — earnings & dividends','Сегодня':'Today','отчёт':'earnings','экс-дата':'ex-div','выплата':'payout','клик по событию открывает карточку':'click an event to open the card','💰 Дивиденды':'💰 Dividends','kr/год по текущим позициям':'kr/yr at current positions','Дивид./год':'Div./yr','Доходность':'Yield','Экс-дата':'Ex-date','Выплата':'Pay date','Мне в год':'My yearly','Дивидендных бумаг в портфеле нет':'No dividend payers here','Дат отчётов пока нет':'No earnings dates yet','Загружаю календарь отчётов и дивидендов…':'Loading the earnings & dividends calendar…',
'➕ Добавить акцию':'➕ Add stock','Тикер':'Ticker','уже в списке':'is already listed','добавлен':'added',
'🤖 AI Proto — обучается, анализирует портфель и обгоняет индексы':'🤖 AI Proto — learns, analyzes the portfolio and beats the indices','🔮 Проанализировать портфель':'🔮 Analyze portfolio','⏳ Анализирую… (30–60 сек)':'⏳ Analyzing… (30–60 s)','💬 Чат с AI Proto':'💬 AI Proto chat','видит портфель, цены и ваши правила':'sees your portfolio and prices (autonomous)','очистить':'clear','Отправить':'Send','Ваш вопрос или указание ассистенту…':'Your question or instruction…','🧠 Память AI Proto — правила инвестора':'🧠 AI Proto memory — investor rules','учитываются в чате и в полном анализе':'applied in chat and in the full analysis','Добавить правило вручную…':'Add a rule manually…','➕ Запомнить':'➕ Remember','📜 История запросов':'📜 History','⚖️ Предложение по балансировке портфеля':'⚖️ Portfolio rebalancing proposal',
'❓ Справка':'❓ Help','Нажмите на раздел, чтобы развернуть его':'Click a section to expand it','🗂 Вкладки и виды':'🗂 Tabs & views','🏷 Тип акции':'🏷 Stock type','📊 Критерий — рыночная фаза (техника + фундаментал)':'📊 Criterion — market phase (technicals + fundamentals)','🎯 Сигнал — цена у технического уровня (±2%)':'🎯 Signal — price at a technical level (±2%)','🧪 Симуляция — тестовые покупки':'🧪 Simulation — paper trades','📐 Технические уровни и колонки':'📐 Technical levels & columns','💼 Портфельные значения':'💼 Portfolio values','💪 Здоровье бизнеса (карточка акции)':'💪 Business health (stock card)',
'Нажмите на строку — карточка с полными данными откроется слева от списка':'Click a row — the full card opens to the left of the list','📋 Акции':'📋 Stocks','🔄 Обновить акции':'🔄 Refresh stocks','Рекомендация':'Recommendation','Вердикт v2':'Verdict v2','🤖 AI Портфель':'🤖 AI Portfolio','🔬 AI-разборы':'🔬 AI analyses',
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
  // Лонг: себестоимость проданного = выручка − P&L − комиссия. Шорт: открытие продажей не реализует
  // ничего, база реализованного — стоимость откупа (цена×кол-во + комиссия).
  return Math.round((PF_TRADES||[]).filter(t=>(t.tab||PF3_KEY)===tabKey&&(t.short?t.act==='buy':t.act==='sell')).reduce((a,t)=>a+((t.short?(+t.price||0)*(+t.qty||0)+(t.feeNative||0):(+t.price||0)*(+t.qty||0)-(t.plNative||0)-(t.feeNative||0))*(FX[t.ccy]||1)),0));
}
function recalcPF(i,idx){const k=idx||curIdx,d=DATA[k],r=d.rows[i];const qty=parseFloat(r[6])||0,price=parseFloat(r[7])||0,buy=parseFloat(r[9])||0,ccy=String(r[8]||'SEK'),fxNow=FX[ccy]||1;
  const dir=(typeof posMetaGet==='function'&&qty>0&&(posMetaGet(k,r[2])||{}).side==='short')?-1:1;   // шорт (S6): P&L зеркальный
  r[13]=Math.round(qty*price*fxNow);r[11]=buy>0?dir*(r[13]-Math.round(qty*buy*fxNow)):0;r[12]=buy>0?parseFloat((dir*(price-buy)/buy*100).toFixed(2)):0;}
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

// Сид вкладки Портфель 3.0: при первом входе (бандл data.js, schemaV 0) — одна строка MU с нулём
// акций; опустевший портфель больше не засевается.
function migratePortfolio3(){
  if(!DATA[PF3_KEY])
    DATA[PF3_KEY]={headers:['#','Компания','Тикер','Страна','Сектор','Тип','Кол-во','Цена','Валюта','Покупка','1д %','Прибыль','От покупки %','Стоимость','X-dag','Выплата','SMA 50','SMA 100','SMA 200','Целевая','Цель %','Действие'],rows:[],count:0,subtitle:'Портфель 3.0'};
  const d=DATA[PF3_KEY];
  if(!d.rows.length&&STATE_V<1){
    d.rows.push([1,'Micron Technology','MU','🇺🇸','Полупроводники','Акция',0,0,'USD',0,0,0,0,0,'—','—','','','',0,0,'⚪ Держать']);
    d.count=d.rows.length;
    if(!applyingRemote)scheduleSave();
  }
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
  v3Tabs().forEach(k=>{
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
// ===== Миграции состояния (S7a) =====
// Один проход на загрузку состояния — в boot() (бандл data.js) и в applyRemoteState() (облако),
// а не при каждом init() (его зовут переименование вкладки, смена языка, вход и т.д.). Все шаги
// идемпотентны; одноразовые — только под STATE_V (migrateSchema). Старые шаги (Портфель 2.0,
// снимок брокера 2026-06-10, перенос AI-отчётов, сиды Anna/Sergei/Gold and Silver/Small Cap/HEM,
// заголовок «Portfolio (Dima)») удалены в S7a: в облаке они давно применены, а новому аккаунту
// чужие позиции не нужны. Их флаги в данных (brokerSnap, cashSnap, gsSeed, scSeed, aiMig, ttlMig)
// НЕ удалять, пока жив клиент до S7a: без флага он применит шаг заново (кэш, удалённые тикеры).
// S7b-3: шаги удалённой классики (simMigrateTabs — симуляция, restoreXcols — доп. колонки списка) убраны;
// migrateDropReco — на каждый проход (клиент до S7b-3 на другом устройстве снова пишет эти поля).
function migrateState(){
  migratePortfolio3();migrateNasdaqV3();migrateAiPort();migrateSchema();
  if(migrateDropReco(DATA)&&!applyingRemote)scheduleSave();
}
// Перерисовка после смены данных/роли/языка (≈16 мест: синк, вход, вкладки…). Миграции — не здесь, а в migrateState().
function init(){
  aiPlaybookEnsure();   // 📚 засеять плейбук стандартными принципами при первом запуске
  fixCompanyNames();   // имена/секторы/типы строк — производные поля, пересчитываются на каждом init()
  renderAll();
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
// Версионированные одноразовые шаги схемы снапшота (schemaV) — последний шаг migrateState().
// Сид Портфеля 3.0 смотрит на STATE_V<1, поэтому опустевший портфель не засевается снова.
// Новый шаг = блок `if(STATE_V<N)` + SCHEMA_V=N.
function migrateSchema(){
  if(STATE_V>=SCHEMA_V)return;
  if(STATE_V<1){   // v1 (S3 редизайна): сиды отработали; правила плана → v2
    PLAN_RULES=(PLAN_RULES||[]).map(planRuleNorm);
  }
  if(STATE_V<2){   // v2 (2026-09-10): правила из совета AI — уровень входа вместо таргета, валюта из строки бумаги
    (PLAN_RULES||[]).forEach(planFixAiRule);
  }
  if(STATE_V<3){   // v3 (S7b-3): SMA в колонках — только дневные (переключатель 1Г/3Г удалён)
    migrateSmaDaily(DATA,SMA_TF);
  }
  STATE_V=SCHEMA_V;
  if(!applyingRemote)scheduleSave();
}
// S7b-3 (plans/s7b-map.md §2 решение 3, §10.3): следы удалённых движков в данных вкладок. Колонка «Реком. скоринг»
// (писала удалённая «Рекомендация») очищается — воркер берёт непустую как вердикт вселенной AI-портфеля, пустую добивает
// aipVerdict той же логикой; прото-сигналы бэктеста btSignals/btRuleAcc (писал удалённый btCompute) удаляются — иначе
// воркер слал бы их AI-портфелю и анализу замороженными («проверено на истории»). Клиент до S7b-3, пока открыт на другом
// устройстве, снова пишет и то и другое (обновление цен, AI Proto) — поэтому это не одноразовый шаг схемы, а проход на
// каждую загрузку состояния (migrateState; идемпотентно, O(строк)). btJournal/btConfig — до блока E. Колонку из headers
// не убираем (схема строк индексная). → число изменений.
function migrateDropReco(data){
  let n=0;
  Object.keys(data||{}).forEach(k=>{
    const d=data[k];if(!d||!Array.isArray(d.rows)||!Array.isArray(d.headers))return;
    const rc=d.headers.indexOf('Реком. скоринг');
    if(rc>=0)d.rows.forEach(r=>{if(r[rc]!=null&&r[rc]!==''){r[rc]='';n++;}});
    ['btSignals','btRuleAcc'].forEach(f=>{if(f in d){delete d[f];n++;}});
  });
  return n;
}
// v3 (одноразово): строки бумаг в режиме 3Г получают дневной набор SMA из SMA_TF, режим → 1Г. Переключатель 1Г/3Г удалён
// (у клиента до S7b-3 он тоже недостижим) — режим заново не появится. → число изменений.
function migrateSmaDaily(data,smaTf){
  let n=0;
  Object.keys(data||{}).forEach(k=>{
    const d=data[k];if(!d||!Array.isArray(d.rows)||!Array.isArray(d.headers))return;
    const {s50,s100,s200}=smaIdx(d);
    d.rows.forEach(r=>{const t=smaTf&&smaTf[String(r[2]||'')];if(!t||t.mode!=='3Y'||!Array.isArray(t.d))return;
      [s50,s100,s200].forEach((c,j)=>{if(c>=0&&t.d[j]!=null&&r[c]!==t.d[j]){r[c]=t.d[j];n++;}});});
  });
  Object.keys(smaTf||{}).forEach(tk=>{const t=smaTf[tk];if(t&&t.mode==='3Y'){t.mode='1Y';n++;}});
  return n;
}
// ===== Свои вкладки-watchlist'ы (админ) =====
function pf3NewTab(){
  const name=(prompt(RT('Название новой вкладки:','New tab name:'))||'').trim();
  if(!name)return;
  if(DATA[name]||name===AIP_KEY){toast(RT('Такая вкладка уже есть','A tab with this name exists'),true);return}
  DATA[name]={headers:DATA[PF3_KEY].headers.slice(),rows:[],count:0,v3:'1',custom:'1',subtitle:name};
  scheduleSave();
  curIdx=name;v3Key=name;pf3Sel=null;pf3Tab='list';
  init();
  toast(RT('Вкладка создана — добавляйте акции формой внизу списка','Tab created — add stocks with the form below the list'));
}
function pf3TabDelete(name,ev){
  if(ev)ev.stopPropagation();
  if(!DATA[name]||DATA[name].custom!=='1')return;
  if(!confirm(RT(`Удалить вкладку «${name}» со всеми её акциями?`,`Delete tab “${name}” with all its stocks?`)))return;
  delete DATA[name];
  if(curIdx===name)curIdx=PF3_KEY;
  if(v3Key===name)v3Key=PF3_KEY;
  scheduleSave();init();
}

// Trade Desk — единственный UI (S7b-3): любая перерисовка идёт в deskRender (с дебаунсом). Первый init() из boot()
// выполняется до загрузки desk.js — рисовать ещё нечего, deskBoot() смонтирует и нарисует экран сам.
function renderAll(){if(typeof deskRender==='function')deskRender();}

/* ===== Theme (light/dark) ===== */
function applyTheme(t){
  document.documentElement.dataset.theme = (t === 'dark' ? 'dark' : 'light');
  try{ localStorage.setItem('dash_theme', document.documentElement.dataset.theme); }catch(e){}
  if(typeof stockChartsRetheme==='function') stockChartsRetheme();
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
    row('<b>🖥 Trade Desk</b>','Новый интерфейс (бета, кнопка 🖥 в шапке или ?desk=1): «Сегодня» — что купить, продать или сократить с входом, стопом, целью и R/R; «Скринер» — все бумаги всех вкладок с фильтрами; «Акция» — график со свечами, уровнями и планом лонг/шорт; «Позиции» — книга с риском; «Журнал» — сделки, планы и бэктест правил. «⋯ → Классический вид» возвращает эти вкладки.')
   +row('<b>📖 Словарь Trade Desk</b>','Что значит каждый термин и число Trade Desk (R, R/R, ATR, фазы, флаги, «Что если?», зона, риск 1–5…): формула, пример и как использовать, плюс сквозной пример одной сделки. Открывается из Trade Desk: ⋯ → «📖 Словарь» или клавиша ?. <button class="btn" onclick="deskGlossFromFaq()">📖 '+RT('Открыть словарь','Open glossary')+'</button>')
   +row('<b>🏠 Home</b>','Сводка рынка: живые фьючерсы и индексы, барометр фаз рынка, доска лучших акций (общий рейтинг со столбцом «v2» — вердикт нового слоя сигналов), разбивка по горизонтам и прогноз. Клик по строке открывает карточку.')
   +row('<b>📊 Портфель / Акции</b>','Главный список: клик по строке открывает карточку акции слева (график, здоровье бизнеса, уровни, отчёты). Колонки сортируются кликом по заголовку; «⚙ Колонки» включает дополнительные, в том числе «Вердикт v2».')
   +row('<b>🏭 Структура</b>','Те же акции, сгруппированные по сектору, типу и диверсификации: слева группы с итогами, справа акции выбранной группы.')
   +row('<b>🧪 Симуляция</b>','Бумажный портфель из тестовых покупок — без реальных денег, вкладка в группе «💼 Portfolio». Подробнее в разделе «Симуляция» ниже.')
   +row('<b>🎯 План · 📜 Сделки · 🧾 Налоги</b>','У портфелей: план сделок (уровень входа или выхода, стоп, цель, R/R), журнал сделок с реализованным P&L и налог K4 по средней цене (genomsnittsmetoden).')
   +row('<b>📨 Telegram: стопы и лимиты</b>','Открытая страница уведомляет о сработавшем плане сама. При закрытой — сервер по расписанию (в часы бирж, каждые 10–20 минут) проверяет стоп и цель позиций и лимиты плана и пишет в Telegram: пробит стоп, достигнута цель, сработал лимит, «сетап сломан» (цена ушла за стоп до входа). Одно условие приходит один раз; повторно — только если цена отошла от уровня на 0.3·ATR и вернулась. Выключить: Trade Desk → ⋯ → «📨 Telegram-алерты».')
   +row('<b>📅 Дивиденды и отчёты</b>','Календарь: ближайшие отчёты компаний, экс-дивидендные даты и выплаты.')
   +row('<b>🩺 Состояние · 🤖 AI · ⚖️ Предложение</b>','У каждого портфеля: здоровье портфеля, AI Proto (анализ с историей запусков и чат по портфелю) и план ребалансировки.'),true)}

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
   +row('<b>Где следить</b>','В карточке акции — позиции по этой бумаге; на вкладке «🧪 Симуляция» — весь тестовый портфель: вложено, стоимость сейчас и результат в kr по живым ценам и курсу.')
   +row('<b>Закрыть позицию</b>','Кнопка 🗑 в карточке или в таблице симуляции. Клик по строке таблицы открывает карточку акции.')
   +row('<b>Привязка к вкладке</b>','Тестовая покупка помнит вкладку, из карточки которой сделана; вкладка «🧪 Симуляция» показывает все вместе. Синхронизируются между устройствами.'))}

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
      <div class="set-user-hd"><b>${escHtml(u.email||u.user_id)}</b>${roleSel}${seen}</div>
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
document.addEventListener('keydown',e=>{if(e.key==='Escape')['faqOverlay','setOverlay','prmOverlay'].forEach(id=>document.getElementById(id)?.classList.add('hidden'))});

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
  ['faqOverlay','setOverlay','prmOverlay','authOverlay','onbOverlay'].forEach(id=>{
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
  initLang();
}

/* ===== Live prices =====
   Котировки отдаёт воркер telegram-notify.js (Cloudflare Worker): читает Yahoo
   Finance server-side, покрывает US + Nordic/EU (.ST/.OL/.DE/.CO/.PA/.MI).
   Единственный источник цен — другого пути нет. */
const PRICE_PROXY = 'https://telegram-notify-abc.dmitriy-bilokon.workers.dev';   // Worker serves live prices (US + Nordic/EU via Yahoo)
// Разбить список на чанки по n (чистая; тест в cases-app.js).
function chunkList(list, n){ const out=[]; for(let i=0;i<list.length;i+=n) out.push(list.slice(i,i+n)); return out; }
// Единая точка живых котировок (?symbols=). Воркер тратит 3 подзапроса на символ
// (chart 1y + quoteSummary + weekly) и до 4 на yAuth за вызов, лимит Cloudflare free —
// 50 подзапросов/вызов → чанк 15 (15×3+4 = 49). Все чанки параллельно; упавший чанк
// пропускается; если не ответил НИ ОДИН (а символы были) — throw (прокси недоступен).
const QUOTE_CHUNK = 15;
async function fetchQuotes(symbols){
  const syms=[...new Set((symbols||[]).filter(Boolean))];
  if(!syms.length) return {};
  const parts=await Promise.all(chunkList(syms,QUOTE_CHUNK).map(c=>
    fetch(PRICE_PROXY+'?symbols='+encodeURIComponent(c.join(','))).then(r=>r.ok?r.json():null).catch(()=>null)));
  const ok=parts.filter(p=>p&&typeof p==='object'&&!p.error);
  if(!ok.length) throw new Error('quotes proxy unavailable');
  return Object.assign({},...ok);
}

// Map a dashboard ticker + currency to a Yahoo exchange symbol.
// Overrides handle tickers whose dashboard form differs from the exchange symbol.
// Значение — символ Yahoo или {валюта: символ, _: по умолчанию}, если бумага торгуется на двух биржах:
// ASML в строке с USD — Nasdaq (цена в долларах), иначе Амстердам (EUR). Раньше USD-строка получала цену .AS
// в евро и пересчитывалась в kr по курсу доллара.
const SYMBOL_OVERRIDES = { 'NDB':'NDA-SE.ST', 'ASML':{USD:'ASML',_:'ASML.AS'}, 'FCT':'FCT.MI', 'FIGMA':'FIG', 'RHM':'RHM.DE', 'RENK':'R3NK.DE', 'DELLIA':'DELIA.OL' };
function exSymbol(ticker, ccy){
  const t = String(ticker||'').trim().toUpperCase().replace(/\s+/g,'-'), o = SYMBOL_OVERRIDES[t];
  if(o) return typeof o==='string' ? o : (o[String(ccy||'').toUpperCase()] || o._);
  if(t.includes('.')) return t;   // уже полный символ биржи (CAC → .PA, MIB → .MI)
  switch(String(ccy||'').toUpperCase()){
    case 'USD': return t;
    case 'SEK': return t + '.ST';
    case 'NOK': return t + '.OL';
    case 'DKK': return t + '.CO';
    case 'EUR': return t + '.DE';
    case 'GBP': return t + '.L';   // Лондон: воркер приводит пенсы Yahoo (GBp) к фунтам
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
// ===== График акции: загрузчик lightweight-charts, кэш истории, stockChartDraw =====
let _lwcPromise=null,_histCache={};   // history cached 10 min per symbol+range (как кэш ?history= воркера) — re-renders redraw instantly
// Lightweight Charts 5.0.8 (jsdelivr, SRI) — один раз; UMD-глобал LightweightCharts (chart.js, pfPerfDraw).
const LWC_URL='https://cdn.jsdelivr.net/npm/lightweight-charts@5.0.8/dist/lightweight-charts.standalone.production.js',
  LWC_SRI='sha384-8J8e9bGIwf7e9BLO5rwf4zJwNRKcypGnvuGzORD/t4TrFA1gWbl3Hsi/RvyWwBKl';
function loadLWC(){
  if(window.LightweightCharts&&window.LightweightCharts.createSeriesMarkers) return Promise.resolve();
  if(_lwcPromise) return _lwcPromise;
  _lwcPromise=new Promise((res,rej)=>{const s=document.createElement('script');s.src=LWC_URL;s.integrity=LWC_SRI;s.crossOrigin='anonymous';s.onload=res;s.onerror=()=>{_lwcPromise=null;rej(new Error(RT('не удалось загрузить библиотеку графика','chart library failed to load')))};document.head.appendChild(s)});
  return _lwcPromise;
}
// История ?history= (кэш _histCache 10 мин, общий с колонкой «Вердикт v2») → свечи; bars/replay мемоизируются
// на записи кэша (реплей вердикта ~20–50 мс на 2 года — перерисовки карточки его не пересчитывают).
async function histBars(sym,range){
  const key=sym+':'+range,hc=_histCache[key];
  if(!(hc&&Date.now()-hc.t<10*60e3)){
    const j=await fetch(PRICE_PROXY+'?history='+encodeURIComponent(sym)+'&range='+range).then(r=>r.json());
    if(!(j&&Array.isArray(j.c)&&j.c.length))throw new Error(RT('нет исторических данных','no history'));
    _histCache[key]={j,t:Date.now()};
  }
  const e=_histCache[key];if(!e.bars)e.bars=SIG.barsFromHist(e.j);
  return e;
}
// График акции (S5): свечи 2y (1Г) / 5y (3Г) → SIG.snapshot (входы строки как у колонки v2) + реплей →
// renderStockChart. state: {tab,row,ccy,years,side,ch}; side=null — сторона вердикта. Открытая позиция
// со стопом/целью в POS_META рисует свой план (средняя/стоп/цель) вместо плана стороны.
async function stockChartDraw(state,boxId){
  let box=document.getElementById(boxId);
  if(!box||!state)return;
  if(!PRICE_PROXY){box.textContent='PRICE_PROXY не задан';return}
  const {row,ccy,years}=state,tab=state.tab,sym=exSymbol(row[2],ccy),range=years===3?'5y':'2y',tok=state._tok=(state._tok||0)+1;
  const hc=_histCache[sym+':'+range];
  if(!(hc&&Date.now()-hc.t<10*60e3))box.textContent=RT('Загрузка графика…','Loading chart…');
  let e;
  try{[,e]=await Promise.all([loadLWC(),histBars(sym,range)]);}
  catch(err){box=document.getElementById(boxId);if(box&&tok===state._tok)box.textContent=RT('Ошибка загрузки: ','Load error: ')+(err.message||err);return}
  box=document.getElementById(boxId);
  if(!box||tok!==state._tok)return;   // карточку перерисовали/закрыли, пока грузилось
  const bars=e.bars,d=DATA[tab]||{headers:[],rows:[]};
  if(bars.length<SIG.CFG.minBars){box.textContent=RT('Мало истории для графика','Not enough history');return}
  const snap=SIG.snapshot(bars,sigOpts(d,row,sigRiskKr(tab)));
  if(!e.rep)e.rep=SIG.replay(bars,{ind:snap.ind});
  const tk=posTk(row[2]),m=pf3MyPort(tab)&&(parseFloat(row[6])||0)>0?posMetaGet(tab,tk):null;
  const plan=m&&(m.stop>0||m.target>0)?{entry:parseFloat(row[9])||0,stop:m.stop,target:m.target,mode:'position'}:null;
  if(!state.side)state.side=plan?m.side:snap.side;
  const iv=INSIDER[String(row[2]||'').trim().toUpperCase()];
  const trades=PF_TRADES.filter(t=>t&&posTk(t.tk)===tk).map(t=>({date:t.date,act:t.act,short:!!t.short}));
  if(state.ch){state.ch.destroy();state.ch=null}
  try{
    state.ch=renderStockChart(box,bars,snap,{side:state.side,plan,bars:years===3?756:252,replay:e.rep,ccy,insider:iv&&Array.isArray(iv.tx)?iv.tx:null,trades,earn:state.earn||null});
  }catch(err){box.textContent=RT('Ошибка графика: ','Chart error: ')+(err.message||err);return}
  state.planPos=!!plan;
}
// Смена темы → перерисовать открытые графики (цвета берутся из CSS-токенов при отрисовке).
function stockChartsRetheme(){
  if(typeof deskRetheme==='function')deskRetheme();
}
/* ===== v3-вкладки: форматирование, фундаментал выбранной бумаги (pf3Sel) ===== */
const pf3Fmt=(n,dec=0)=>{const v=parseFloat(n);return isFinite(v)?v.toLocaleString(undefined,{minimumFractionDigits:dec,maximumFractionDigits:dec}):'—'};
// $12.3B / 9.9B EUR — money formatting for fundamentals in the report currency.
const pf3Bn=(v,ccy)=>{if(!(typeof v==='number'&&isFinite(v)))return'—';const a=Math.abs(v);const s=a>=1e9?(v/1e9).toFixed(1)+'B':a>=1e6?(v/1e6).toFixed(0)+'M':Math.round(v).toLocaleString();return(!ccy||ccy==='USD')?'$'+s:s+' '+ccy};

// Fundamentals (balance / cash flow / growth) via the worker's ?fundamentals= endpoint — для AI-снапшота бумаги и
// тезис-монитора. Режим 'annual' (последний фин. год); 'quarter' переключался в классической карточке (удалена в S7b-3).
// Кэш в памяти сессии; перезапрос не чаще раза в 6 ч.
let pf3Fund={period:'annual',cache:{},loading:false};
const pf3Sym=()=>{const r=pf3D().rows[pf3SelIdx()];return exSymbol(r[2],r[8])};
const pf3FundData=()=>{const c=pf3Fund.cache[pf3Fund.period];return c&&c.sym===pf3Sym()?c.data:null};

// ── P/E и P/S с дистанцией от среднего по сектору (эталоны на 2026 г.) ──
// Значения [P/E, P/S] — типичные медианы макро-секторов; точка отсчёта,
// а не биржевая истина. Мультипликаторы бумаги приходят из ?fundamentals
// (Yahoo summaryDetail: trailingPE / priceToSalesTrailing12Months).
const PF3_VAL_AVG={'Полупроводники':[28,7],'Софт и облако':[35,9],'Кибербезопасность':[45,10],'Интернет и реклама':[25,6],'E-commerce и сервисы':[30,3],'Финансы и недвижимость':[18,4],'Здравоохранение':[20,4.5],'Потребительский сектор':[22,1.5],'Медиа и телеком':[18,2.5],'Промышленность и транспорт':[22,2.5],'Энергетика':[17,3],'Железо и сети':[24,4]};
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
}
// ── Фундаментал по ВСЕМ позициям портфеля → betyg, СОГЛАСОВАННЫЙ с карточкой ──
// pf3Fund.cache держит только открытую бумагу. Для рейтинга всех позиций (снапшот
// AI-Proto, колонка «Рейтинг», прогноз) грузим годовой фундаментал каждой бумаги в
// общий кэш PF_FUND и считаем по нему ПОЛНЫЙ 5-столповый pf3Betyg — иначе betyg
// расходился с карточкой (lite по ROE/росту давал, напр., F у EQT при карточном A).
let PF_FUND={};   // sym → {data, at}; TTL 6ч (в т.ч. кэш «нет данных» → не долбим)
const pf3FundFor=sym=>{const c=PF_FUND[sym];return (c&&Date.now()-c.at<6*3600*1000)?c.data:null};
async function pf3FundFetch(syms){   // догрузить фундаментал для списка бирж. символов в PF_FUND
  const todo=[],seen=new Set();
  (syms||[]).forEach(sym=>{if(!sym||seen.has(sym))return;seen.add(sym);
    const c=PF_FUND[sym];if(!(c&&Date.now()-c.at<6*3600*1000))todo.push(sym);});
  for(let i=0;i<todo.length;i+=4){   // чанк по 4 — щадим воркер/лимиты
    await Promise.all(todo.slice(i,i+4).map(async sym=>{
      let data=null;
      try{const j=await(await fetch(PRICE_PROXY+'?fundamentals='+encodeURIComponent(sym))).json();
        if(j&&typeof j==='object'&&!j.error&&(j.asOf||j.revenue!=null||j.totalDebt!=null))data=j;}catch(e){}
      PF_FUND[sym]={data,at:Date.now()};   // кэшируем и «нет данных» → не долбим
    }));
  }
}
async function pf3LoadAllFundamentals(key){
  const d=DATA[key||v3Key];if(!d||!Array.isArray(d.rows))return;
  await pf3FundFetch(d.rows.map(r=>{const tk=String(r[2]||'').trim();return tk?exSymbol(tk,r[8]||'USD'):null}).filter(Boolean));
}
// Полный betyg по строке через кэш PF_FUND (как в карточке); null — фундамента нет.
function pf3BetygRow(r,sector){
  const sym=exSymbol(String(r[2]||'').trim(),r[8]||'USD'),tk=String(r[2]||'').trim().toUpperCase();
  const F=pf3FundFor(sym);if(!F)return null;
  const B=pf3Betyg(F,tk,sector!=null?sector:r[4]);
  return (B&&B.score100!=null)?{score100:B.score100,grade:(pf3Grade(B.total)||{}).g||null,total:B.total}:null;
}

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
// Банк/финансы/страхование: у них OCF/FCF, D/E и current ratio НЕ информативны, а P/S
// не применяют — общая модель betyg даёт ложную F. Распознаём по сектору и считаем иначе.
const pf3FinSec=s=>/финанс|банк|страх|bank|financ|insur/i.test(String(s||''));
function pf3ValScore(F,tk,sector,fin){
  const vv=(typeof VAL!=='undefined'&&VAL[tk])||{};
  const one=kind=>{
    const vvN=kind==='pe'?vv.pe:vv.ps, fN=F?(kind==='pe'?(F.fwdPe||F.pe):F.ps):null;
    const v=(vvN>0)?vvN:(fN>0?fN:null);
    if(!(v>0))return null;
    // Sanity-guard на битые данные: P/S>25 почти всегда мусор; у финансов P/E>80 — тоже.
    if(kind==='ps'&&v>25)return null;
    if(kind==='pe'&&fin&&v>80)return null;
    let med=null; try{ med=vv.sector?(((typeof _valSecCache!=='undefined'&&_valSecCache)||valSectorMedians())[vv.sector]):null; }catch(e){}
    const lm=med?(kind==='pe'?med.pe:med.ps):null;
    const avg=(lm>0&&med.n>=2)?lm:((PF3_VAL_AVG[pf3MacroSector(String(vv.sector||sector||''))]||[22,3])[kind==='pe'?0:1]);
    const diff=(v/avg-1)*100;            // <0 = дешевле сектора
    return Math.max(0,Math.min(10,5-diff/10));   // −50% → 10, ±0 → 5, +50% → 0
  };
  const kinds=fin?['pe']:['pe','ps'];   // банки/финансы оценивают по P/E (и P/B), НЕ по P/S
  const a=kinds.map(one).filter(x=>x!=null);
  return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
}
const PF3_BETYG_WEIGHTS=Object.freeze({profit:0.25,growth:0.2,balance:0.2,cash:0.2,val:0.15});
function pf3Betyg(F,tk,sector){
  if(!F)return null;
  const fin=pf3FinSec(sector);
  const S=pf3Scores(F);
  const pillars=[
    {key:'profit', icon:'💎', label:['Прибыльность','Profitability'], score:pf3Profit(F)},
    {key:'growth', icon:'📈', label:['Рост','Growth'],               score:S.growth},
    // Банкам D/E и «ликвидность» не применимы; OCF/FCF у них не показатель → столпы н/д.
    {key:'balance',icon:'🏦', label:['Баланс','Balance'],            score:fin?null:S.balance, na:fin},
    {key:'cash',   icon:'💵', label:['Денежный поток','Cash flow'],  score:fin?null:S.cash,    na:fin},
    {key:'val',    icon:'🏷', label:['Оценка','Valuation'],          score:pf3ValScore(F,tk,sector,fin)},
  ];
  const W=PF3_BETYG_WEIGHTS;
  let sw=0,wsum=0,n=0;
  pillars.forEach(p=>{if(p.score!=null){sw+=p.score*W[p.key];wsum+=W[p.key];n++;}});
  // Недостаточно валидных столпов (типично у банков/финансов с неприменимыми метриками
  // или при битых данных) → НЕ выставляем вводящую в заблуждение букву.
  if(n<2||wsum<0.4)return {total:null,score100:null,pillars,fin,insufficient:true};
  const total=sw/wsum;
  return {total,score100:Math.round(total*10),pillars,fin};
}
const PF3_GRADE=[[8.5,'A+','exc'],[7.5,'A','exc'],[6.5,'B','good'],[5,'C','mid'],[3.5,'D','weak']];
function pf3Grade(s){ if(s==null)return{g:'—',c:''}; for(const[t,g,c]of PF3_GRADE)if(s>=t)return{g,c}; return{g:'F',c:'crit'}; }

const PF3_MONTHS=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function pf3DateRu(s){const d=new Date(s+'T00:00:00');if(isNaN(d))return String(s);return LANG==='en'?d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):`${d.getDate()} ${PF3_MONTHS[d.getMonth()]} ${d.getFullYear()}`}

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
    // Сначала ПОЛНЫЙ betyg из кэша PF_FUND (как в карточке) — согласованность.
    const full=pf3BetygRow(r,r[4]);if(full)return{score100:full.score100,grade:full.grade};
    // Фундаментал загружен, но единый рейтинг невозможен (банки/финансы, битые/неполные
    // данные → в карточке «недостаточно данных»): НЕ подменяем lite-оценкой, чтобы AI не
    // противоречил карточке и не выносил вердикт по ложному рейтингу.
    const sym=exSymbol(String(r[2]||'').trim(),r[8]||'USD');
    if(typeof pf3FundFor==='function'&&pf3FundFor(sym))return null;
    if(typeof pf3RowBetyg!=='function')return null;   // фундаментал не загружен → lite по ROE/росту/оценке
    const b=pf3RowBetyg({roe:numC(r,roeC),revg:numC(r,revgC),pe:numC(r,peC),ps:numC(r,psC),sec:r[4],r});
    return b!=null?{score100:Math.round(b*10),grade:(pf3Grade(b)||{}).g||null,lite:true}:null;
  }catch(e){return null}};
  // Индексные вкладки: watchlist-снапшот — все акции с уровнями, фазой и
  // «у уровня»; AI выделяет самые актуальные и рекомендует действия.
  // Любой портфель (мой, Anna, AIP) идёт в портфельную ветку ниже.
  // S7b-3: фаза — SIG.phase на данных строки (sigRowPhase), «у уровня» — ближайший структурный уровень снимка SIG.
  if(!pf3IsPort(key)){
    const peC=h.indexOf('P/E'),psC=h.indexOf('P/S');
    const nm=v=>{const n=parseFloat(v);return isFinite(n)&&n!==0?n:null};
    return{
      mode:'watchlist',index:key,baseCurrency:'SEK',
      stocks:d.rows.map(r=>{
        const s=sigRowSnap(d,r);
        return{name:r[1],ticker:r[2],sector:r[4],type:r[5],ccy:r[8]||'USD',
          price:nm(r[7]),dayPct:nm(r[10]),
          sma50:s50>=0?nm(r[s50]):null,sma100:s100>=0?nm(r[s100]):null,sma200:s200>=0?nm(r[s200]):null,
          support:supC>=0?nm(r[supC]):null,resistance:resC>=0?nm(r[resC]):null,
          analystTarget:tgC>=0?nm(r[tgC]):null,pe:peC>=0?nm(r[peC]):null,ps:psC>=0?nm(r[psC]):null,
          betyg:rowBetyg(r),
          phase:sigRowPhase(d,r).label,signal:sigNearText(s)};
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
      di.rows.forEach(r=>{const l=sigRowPhase(di,r).label;phases[l]=(phases[l]||0)+1});
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
  let started=false;   // воркер пишет 'running' при старте (блок A) — отличаем «не стартовала» от «оборвалась»
  while(Date.now()<deadline){
    await new Promise(r=>setTimeout(r,intervalMs));
    if(!sb)break;
    try{
      const{data}=await sb.from('ai_jobs').select('status,result,error').eq('job_id',jobId).maybeSingle();
      if(data){
        if(data.status==='done')return{ok:true,result:data.result};
        if(data.status==='error')return{ok:false,error:data.error||'AI error'};
        if(data.status==='running'&&!started){started=true;if(opt&&opt.onRunning)try{opt.onRunning()}catch(_){}}
      }
    }catch(_){/* сеть/таблицы нет — продолжаем опрос до дедлайна */}
  }
  return{ok:false,error:aiJobTimeoutMsg(started)};
}
function aiJobTimeoutMsg(started){
  return started
    ?RT('таймаут: фоновый прогон стартовал, но не завершился (воркер оборвал задачу — повторите)','timeout: background run started but never finished (worker stopped it — retry)')
    :RT('таймаут ожидания результата (фоновый прогон не записался — создана ли таблица ai_jobs?)','result wait timeout (was ai_jobs table created?)');
}
async function pf3AiRun(){
  if(pf3Ai.loading)return;
  const key=v3Key;   // отчёт сохраняется во вкладку, где НАЖАЛИ кнопку, даже если переключились
  pf3Ai.loading=true;
  renderPF3();
  try{
    // Свежие цены + SMA/уровни — снапшот AI и «Состояние» по текущему рынку.
    await pf3RefreshTab(key);
    await aiLoadIdxHist().catch(()=>{});   // история индексов → альфа в трек-рекорде
    await pf3PullHoldingsNews(key).catch(()=>{});   // 📰 свежие новости по позициям → анализ актуален
    await pf3LoadAllFundamentals(key).catch(()=>{});   // 🏅 фундаментал всех позиций → betyg как в карточке
    const snap=pf3AiSnapshot(key);
    const ln=pf3LiveNewsForAi(key); if(ln)snap.liveNews=ln;   // живые заголовки + тональность по позициям
    // Вердикты «Решения» (SIG v2) по всем тикерам вкладок — чтобы «Предложение» AI было согласовано с тем, что
    // инвестор видит в Trade Desk. Расхождение допускается, но AI обязан развести его по горизонтам.
    // S7b-3: вместо удалённой «Рекомендации»; прото-сигналы бэктеста (bt*) удалены — их заменяет SIG.
    snap.recoLegend='{ТИКЕР:[recoVerdict, upside%toTarget, %отSMA50, %отSMA200, P/E, вЭтомПортфеле(1|0)]} — '+SIG_AI_LEGEND;
    snap.recoVerdicts=sigRecoMap(key);
    // 💬 Опционально передаём последние сообщения из чата с AI Proto — чтобы анализ учёл пожелания/идеи из переписки.
    if(AI_INCL_CHAT&&AI_CHAT.length)snap.chatNotes=AI_CHAT.slice(-20).map(m=>({role:m.role,content:String(m.content||'').slice(0,2000)}));
    if(AI_BG_ENABLED&&await aiJobsReady()){ snap.jobId=aiJobId();snap.portfolioKey=key; }   // фон только при включённом флаге; иначе синхронный стриминг
    const r=await fetch(PRICE_PROXY+'?action=ai',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await sbToken()},body:JSON.stringify(snap)});
    const bodyText=await r.text();
    let j=null;try{j=JSON.parse(bodyText)}catch(_){}
    if(j&&j.queued){   // фоновый прогон — ждём результат из ai_jobs
      const res=await aiJobPoll(j.jobId,{onRunning:()=>toast('🤖 '+RT('Анализ «'+TAB_LABEL(key)+'» идёт…','Analysis of '+TAB_LABEL(key)+' running…'))});
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
  // Фундаментал СВОЕЙ бумаги: снапшот собирается после await, а pf3FundData() смотрит на текущий выбор (v3Key/pf3Sel) —
  // переход к другой бумаге во время запроса подставил бы её отчётность. Кэш карточки — только при совпадении символа.
  const fc=pf3Fund.cache[pf3Fund.period];   // ключ кэша карточки — как pf3Sym(), общего кэша — как pf3BetygRow
  const tf=pf3TypeFull(d,r),F=fc&&fc.sym===exSymbol(r[2],r[8])&&fc.data?fc.data:pf3FundFor(exSymbol(String(r[2]||'').trim(),r[8]||'USD'));
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
  const tgE=pf3EffTarget(d,r);
  return{
    ticker:tk,name:r[1],sector:r[4],type:(tf&&tf.primary)||r[5],ccy:r[8]||'USD',
    price,dayPct:num(10),
    sma50:s50>=0?num(s50):null,sma100:s100>=0?num(s100):null,sma200:s200>=0?num(s200):null,
    support:g('Поддержка'),resistance:g('Сопротивление'),
    // Таргет — эффективный (свежий срез, если среднее «за всё время» устарело на ≥ TG_STALE_PCT%),
    // как в карточке и скоринге; устаревшее среднее — справочно, чтобы AI не видел ложный «потенциал».
    analystTarget:tgE.target||null,analystTargetAllTimeStale:tgE.stale?(tgE.main||null):null,
    pe:g('P/E'),ps:g('P/S'),roe:g('ROE'),de:g('D/E'),revGrowthPct:g('Рост выручки'),
    revenueTTM:g('Выручка TTM'),marketCap:g('Кап-я'),dividendPct:g('Дивид. %'),
    // revSeries — история отчётности (выручка по годам/кварталам с ростом г/г),
    // тот же ряд, что рисует спарклайн в карточке; AI видит траекторию роста.
    fundamentals:F?{revenue:F.revenue,revenueYoY:F.revenueYoY,revenueCagr:F.revenueCagr,fcf:F.freeCashFlow,debtToEquity:F.debtToEquity,netIncome:F.netIncome,pe:F.pe,fwdPe:F.fwdPe,ps:F.ps,revSeries:Array.isArray(F.revSeries)?F.revSeries:null}:null,
    betyg,volume,
    recoVerdict:sigRowVerdict(d,r),recoLegend:SIG_AI_LEGEND,   // S7b-3: вердикт «Решения» (SIG v2) вместо удалённой «Рекомендации»
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
      pf3StockAi={sym,loading:false,text:j.text,data:j.data||null,at:new Date().toISOString(),cost:j.cost||null,sigAt:snap.recoVerdict||null};
      _stkCardOpen[sym]=true;
      // Обучающая база: привязка к тикеру, дате, цене.
      STOCK_AI_LOG=[{ticker:sym,name:r[1],ts:pf3StockAi.at,price:snap.price,ccy:snap.ccy,
        verdict:(j.data||{}).verdict||null,target:(j.data||{}).targetPrice||null,horizon:(j.data||{}).horizon||null,
        cost:j.cost||null,sigAt:snap.recoVerdict||null,data:j.data||null,text:j.text},...(STOCK_AI_LOG||[])].slice(0,300);
      scheduleSave();
      toast('🔬 '+RT('Анализ готов','Analysis ready'));
    }else{pf3StockAi={sym,loading:false,text:null,data:null,at:null};toast((j&&j.error)||'AI не ответил',true);}
  }catch(e){pf3StockAi={sym,loading:false,text:null,data:null,at:null};toast(RT('Worker недоступен (нужен эндпоинт ?action=stockai)','Worker unreachable (?action=stockai)'),true);}
  renderPF3();
}
// ── 🔄 AI-Рекомендация: единый вердикт по карточке (техника+фундаментал+оценка
// +новости+макро) с web_search. Отдельно от детерминированного скоринга.
const AI_RECO_META={buy:['🟢',RT('Купить','Buy'),'buy'],wait:['🟡',RT('Ждать','Wait'),'wait'],sell:['🔴',RT('Продать','Sell'),'sell'],avoid:['⛔',RT('Избегать','Avoid'),'avoid']};
// Флаг «устарел»: вердикт «Решения» (SIG) на момент AI-анализа (поле записи sigAt, S7b-3) ≠ текущему. У записей до
// S7b-3 было только recoAt — вердикт удалённой «Рекомендации»; с SIG его не сравниваем, бейджа нет.
function aiStaleBadge(sigAt,sigNow){
  if(!sigAt||!sigNow||sigAt===sigNow)return'';
  const L=v=>DK_V[v]?DK_V[v][1]():v;
  return`<div class="ai-stale" title="${RT('Вердикт «Решения» (сигналы v2) изменился после этого AI-анализа — выводы могли устареть, запустите заново.','The Decision verdict (signals v2) changed after this AI analysis — it may be outdated; rerun it.')}">⚠️ ${RT('устарел','outdated')} · ${RT('Решение','Decision')}: ${L(sigAt)} → ${L(sigNow)}</div>`;
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
        text:j.text,price:snap.price,ccy:snap.ccy,at:new Date().toISOString(),cost:j.cost||null,sigAt:snap.recoVerdict||null};
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
    body=`${aiStaleBadge(v.sigAt,sigRowVerdict(d,r))}<div class="airk-head">
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
                clusters++;INSIDER[tk].notified=sig;   // Telegram-алерт убран — кластеры смотрим на сайте
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
// Сводка одной строкой: чистая покупка/продажа за 30 дней + число инсайдеров.
function insiderHeadline(v){
  const cc=v.valCcy;
  const buyers=new Set((v.tx||[]).filter(t=>t.code==='P'&&t.name).map(t=>t.name)).size;
  const sellers=new Set((v.tx||[]).filter(t=>t.code==='S'&&t.name).map(t=>t.name)).size;
  if(v.netUSD>0)return{cls:'pf3-up',icon:'🟢',txt:RT(`Чистая покупка: +${insiderFmtUSD(v.netUSD,cc)} за 30 дней${buyers?` · ${buyers} ${buyers===1?'инсайдер':'инсайд.'}`:''}`,`Net buying: +${insiderFmtUSD(v.netUSD,cc)} over 30d${buyers?` · ${buyers} insider${buyers===1?'':'s'}`:''}`)};
  if(v.netUSD<0)return{cls:'pf3-down',icon:'🔴',txt:RT(`Чистая продажа: ${insiderFmtUSD(v.netUSD,cc)} за 30 дней${sellers?` · ${sellers} инсайд.`:''}`,`Net selling: ${insiderFmtUSD(v.netUSD,cc)} over 30d${sellers?` · ${sellers} insiders`:''}`)};
  return{cls:'val-mid',icon:'⚪',txt:RT('Нейтрально за 30 дней','Neutral over 30d')};
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
  scheduleSave();renderAll();
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
  const sigAt=cur&&cur.sigAt?cur.sigAt:(saved?saved.sigAt:null);
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
      ? aiStaleBadge(sigAt,sigRowVerdict(d,r))+head+`<button class="stkai-toggle" onclick="stockAiToggle('${sym}')">${open?'▾ '+RT('Скрыть разбор','Hide analysis'):'▸ '+RT('Показать разбор','Show analysis')}</button>${open?`<div class="pf3-ai-report">${pf3Md(text)}</div>${at?`<div class="pf3-ai-note">${RT('анализ от','analysis from')} ${pf3DtRu(at)}${cost?' · '+costLine(cost):''} · ${RT('сохранён в обучающую базу','saved to the learning log')}</div>`:''}`:''}`
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
  const key=v3Key;   // портфель запуска (см. pf3LoadCalendar)
  try{
    const d=DATA[key];
    const pos=d.rows.map((r,i)=>{recalcPF(i,key);return{sym:exSymbol(r[2],r[8]),w:parseFloat(r[13])||0}}).filter(x=>x.sym&&x.w>0);
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
    pf3Risk={key,data:{cagr:cagr*100,vol:vol*100,sharpe:vol>0?(cagr-rf)/vol:null,days:n},loaded:Date.now(),loading:false,failed:false};
  }catch(e){pf3Risk.loading=false;pf3Risk.failed=true;}
  pf3Risk.loading=false;
  if(isV3()&&pf3Tab==='health'){if(key!==v3Key){pf3LoadRisk();return;}const b=document.getElementById('pf3RiskBox');if(b)b.innerHTML=pf3RiskHTML();}
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
// «→ к сигналам докупки» cash-drag — «Позиции» Trade Desk (S7b-2).
function pf3GoList(){DESK_UI.bt='pos';deskGo('book');}
function cashDragEnsureIdx(){
  if((IDX_HIST['^OMX']&&IDX_HIST['^NDX'])||_cashIdxLoading||!idxTryOk())return;
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
  // Перегрев рынка: доля позиций в фазе «Перегрев» (SIG.phase на данных строки) → смягчаем подсказку.
  let ohN=0,oh=0;
  d.rows.forEach(r=>{const q=parseFloat(r[6])||0;if(!(q>0))return;ohN++;try{if(sigRowPhase(d,r).key==='heat')oh++;}catch(e){}});
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
  const buyBtn=m.status!=='ok'?` <button class="pf3-btn pf3-btn-sm" onclick="pf3GoList()">→ ${RT('к сигналам докупки','to buy signals')}</button>`:'';
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

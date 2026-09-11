// P5a: локальный слой журнала результатов выбора (plans/stock-selection-ux.md §7/§10).
// Чистые функции (запись/дедуп/квота/очистка/экспорт-строка) не читают localStorage/currentUser/Date.now —
// всё аргументами. Тонкие обёртки внизу файла читают/пишут localStorage под ключом аккаунта; они не тестируются
// юнит-тестами (как pfBackupSave/Restore в app.js) и вызываются будущим P5b (кнопка «Отслеживать результат», UI).
const DESK_JOURNAL_V=1;
// Лимит зафиксирован перед кодом P5a (§7): 500 записей ИЛИ 500 КБ JSON — обе границы дают большой запас
// (типичная запись ~0,3–0,5 КБ) при пространстве аккаунта на этом устройстве, без риска исчерпать квоту
// localStorage мобильного браузера. Формат экспорта — JSON-файл с тем же конвертом {v, exportedAt, items}.
const DESK_JOURNAL_CFG={maxRecords:500,maxBytes:500000,horizons:[20,60,120],retainDays:365};

function deskJournalBytes(items){try{return JSON.stringify(items||[]).length;}catch(e){return Infinity;}}

// Дедуп по бумаге/версии отбора/UTC-дате записи (§7): повторная попытка отследить ту же
// идею в тот же день той же версией модели не создаёт вторую запись.
function deskJournalDedupKey(r){
  const t=r&&r.recordedAt,d=new Date(t);
  const day=Number.isFinite(t)&&!isNaN(d.getTime())?d.toISOString().slice(0,10):'invalid';
  return (r&&r.key||'')+'|'+(r&&r.selectionVersion||'')+'|'+day;
}

// Неизменяемая запись: время и id — аргументами (ctx), не Date.now()/Math.random() внутри.
function deskJournalRecord(input,ctx){
  const i=input||{},id=ctx&&ctx.id||null,now=ctx&&ctx.now;
  const b=i.benchmark||null;
  return {
    id,recordedAt:Number.isFinite(now)?now:null,
    key:i.key||null,sym:i.sym||null,ccy:i.ccy||null,source:'manual-selection',
    selectionVersion:i.selectionVersion||null,signalVersion:i.signalVersion||null,
    bucket:i.bucket||null,dimensions:deskSelCopy(i.dimensions!=null?i.dimensions:null),
    observedPrice:typeof i.observedPrice==='number'&&Number.isFinite(i.observedPrice)?i.observedPrice:null,
    observationAsOf:Number.isFinite(i.observationAsOf)?i.observationAsOf:null,
    benchmark:b?{symbol:b.symbol||null,currency:b.currency||null,basis:b.basis||null}:null,
    entry:null,   // условный вход — до появления первого полного бара после записи (P5b)
    horizons:Object.fromEntries(DESK_JOURNAL_CFG.horizons.map(h=>[h,{status:'pending',value:null,completedAt:null}])),
    costAssumptions:i.costAssumptions!=null?deskSelCopy(i.costAssumptions):null,
    status:'pending'};
}

// Добавление в список (чистая — items/cfg аргументами, ничего не пишет). Дубли и превышение
// лимита отклоняются без изменения входного списка; вызывающий (P5b) решает, что показать.
function deskJournalAdd(items,record,cfg){
  cfg=cfg||DESK_JOURNAL_CFG;
  const list=items||[];
  if(list.some(x=>deskJournalDedupKey(x)===deskJournalDedupKey(record)))return {ok:false,reason:'duplicate',items:list};
  if(list.length>=cfg.maxRecords||deskJournalBytes(list.concat([record]))>cfg.maxBytes)return {ok:false,reason:'limit',items:list};
  return {ok:true,items:list.concat([record])};
}

// Только эти поля можно менять после записи (результат/статус, P5b). Остальное — исходные факты, неизменяемы.
const DESK_JOURNAL_MUTABLE=['entry','horizons','status'];
function deskJournalPatch(items,id,patch){
  return (items||[]).map(r=>{
    if(!r||r.id!==id)return r;
    const next=Object.assign({},r);
    Object.keys(patch||{}).forEach(k=>{ if(DESK_JOURNAL_MUTABLE.includes(k))next[k]=patch[k]; });
    return next;
  });
}

function deskJournalQuotaState(items,cfg){
  cfg=cfg||DESK_JOURNAL_CFG;
  const list=items||[],bytes=deskJournalBytes(list);
  return {count:list.length,bytes,maxRecords:cfg.maxRecords,maxBytes:cfg.maxBytes,
    near:bytes>cfg.maxBytes*0.9||list.length>=cfg.maxRecords*0.9,
    atLimit:bytes>=cfg.maxBytes||list.length>=cfg.maxRecords};
}

// Момент завершения записи — позже из известных горизонтов (pending не в счёт).
function deskJournalCompletedAt(r){
  const done=DESK_JOURNAL_CFG.horizons.map(h=>r&&r.horizons&&r.horizons[h]).filter(h=>h&&h.status!=='pending'&&Number.isFinite(h.completedAt));
  return done.length?Math.max.apply(null,done.map(h=>h.completedAt)):null;
}

// Автоматическая ретенция (§7): завершённые — 365 дней после последнего горизонта; pending не удаляются по возрасту.
function deskJournalCleanup(items,now,days){
  days=Number.isFinite(days)?days:DESK_JOURNAL_CFG.retainDays;
  const cutoff=now-days*86400000;
  return (items||[]).filter(r=>{
    if(!r||r.status!=='complete')return true;
    const at=deskJournalCompletedAt(r);
    return at==null||at>cutoff;
  });
}

// Ручной эскейп-клапан при достижении лимита (§7): очистить завершённые СЕЙЧАС, не дожидаясь 365 дней.
// Pending эта функция не трогает ни при каких условиях — вызывающий (P5b) предлагает её только
// вместе с экспортом, никогда молча.
function deskJournalClearCompleted(items){
  return (items||[]).filter(r=>!r||r.status!=='complete');
}

// Строка экспорта — тот же конверт {v, items}, что и хранилище, плюс отметка времени экспорта.
function deskJournalExportJSON(items,now){
  return JSON.stringify({v:DESK_JOURNAL_V,exportedAt:Number.isFinite(now)?now:null,items:items||[]},null,2);
}

// ── Ниже — тонкие обёртки над localStorage, пространство аккаунта (как pfBackupKey в app.js). ──
function deskJournalKey(){ return typeof currentUser!=='undefined'&&currentUser?('dash_desk_journal_'+currentUser.id):null; }

function deskJournalLoad(){
  const k=deskJournalKey(); if(!k)return [];
  let raw=null; try{raw=JSON.parse(localStorage.getItem(k)||'null');}catch(e){return [];}
  return raw&&raw.v===DESK_JOURNAL_V&&Array.isArray(raw.items)?raw.items:[];
}

// Ошибки хранилища (квота и т.п.) возвращаются вызывающему — не проглатываются (§7).
function deskJournalSave(items){
  const k=deskJournalKey(); if(!k)return {ok:false,error:'no-account'};
  try{localStorage.setItem(k,JSON.stringify({v:DESK_JOURNAL_V,items:items||[]}));return {ok:true};}
  catch(e){return {ok:false,error:(e&&e.name)||'storage-error'};}
}

// Анонимные наблюдения не пишутся: без аккаунта — явный отказ, а не молчаливый sink.
function deskJournalRecordAdd(input,ctx){
  const k=deskJournalKey(); if(!k)return {ok:false,reason:'no-account'};
  const items=deskJournalLoad(),record=deskJournalRecord(input,ctx);
  const added=deskJournalAdd(items,record,DESK_JOURNAL_CFG);
  if(!added.ok)return added;
  const saved=deskJournalSave(added.items);
  return saved.ok?{ok:true,items:added.items,record}:{ok:false,reason:'storage',error:saved.error,items};
}

function deskJournalCleanupAndSave(now,days){
  const items=deskJournalLoad(),kept=deskJournalCleanup(items,now,days);
  if(kept.length===items.length)return {ok:true,removed:0,items};
  const saved=deskJournalSave(kept);
  return saved.ok?{ok:true,removed:items.length-kept.length,items:kept}:{ok:false,error:saved.error,items};
}

function deskJournalClearCompletedAndSave(){
  const items=deskJournalLoad(),kept=deskJournalClearCompleted(items);
  if(kept.length===items.length)return {ok:true,removed:0,items};
  const saved=deskJournalSave(kept);
  return saved.ok?{ok:true,removed:items.length-kept.length,items:kept}:{ok:false,error:saved.error,items};
}

function deskJournalExportTrigger(items,now){
  const blob=new Blob([deskJournalExportJSON(items,now)],{type:'application/json;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='dash_desk_journal_'+new Date(Number.isFinite(now)?now:Date.now()).toISOString().slice(0,10)+'.json';
  a.click();
}

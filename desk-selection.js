// P1: чистая модель отбора (P4 — и сравнения). Только нормализованные входы, время и конфигурация аргументами.
// value качества — 0…10 (шкала Betyg), coverage — 0…1. Причины — коды; UI переводит их.
// Версия правил отбора (измерения, действие, подборки deskSelectionModel/deskPickBuckets). Журнал результатов
// (P5, desk-journal.js) дедуплицирует и группирует наблюдения по ней — бампать при смене этих правил.
const DESK_SELECTION_V='sel-2026-09-11';
const deskSelNum=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const deskSelTime=v=>typeof v==='number'?(v>0&&Number.isFinite(v)?v:null):
  (typeof v==='string'&&v.trim()&&Number.isFinite(Date.parse(v))?Date.parse(v):null);
const deskSelCopy=v=>Array.isArray(v)?v.map(deskSelCopy):v&&typeof v==='object'?
  Object.fromEntries(Object.entries(v).map(([k,x])=>[k,deskSelCopy(x)])):v;
const deskSelUnique=a=>[...new Set(a)];

function deskSelectionQuality(b,config){
  b=b||{};const weights=config.weights,keys=Object.keys(weights).filter(k=>k!=='val');
  const pillars=keys.map(key=>{
    const p=(b.pillars||[]).find(x=>x.key===key)||{},v=deskSelNum(p.score);
    return {key,score:v!=null&&v>=0&&v<=10?v:null,na:!!p.na||(b.notApplicable||[]).includes(key)};
  });
  const applicable=pillars.filter(p=>!p.na),known=applicable.filter(p=>p.score!=null);
  const missing=applicable.filter(p=>p.score==null).map(p=>p.key),notApplicable=pillars.filter(p=>p.na).map(p=>p.key);
  const allWeight=applicable.reduce((a,p)=>a+weights[p.key],0),knownWeight=known.reduce((a,p)=>a+weights[p.key],0);
  const lite=b.mode==='lite',value=!lite&&knownWeight?known.reduce((a,p)=>a+p.score*weights[p.key],0)/knownWeight:null;
  const complete=!lite&&known.length>=2&&!missing.length;
  const mode=complete?'full':lite?'lite':known.length?'partial':'missing';
  return {value,labelKey:'quality-'+mode,grade:value==null?null:config.grade(value).g,mode,
    coverage:allWeight?knownWeight/allWeight:0,known:known.length,applicable:applicable.length,
    missing,notApplicable,pillars,facts:deskSelCopy(b.facts||{}),asOf:b.asOf||null,fetchedAt:b.fetchedAt||null,
    reasonCodes:deskSelUnique((b.reasonCodes||[]).concat(complete?[]:['business-'+mode],notApplicable.length?['business-not-applicable']:[]))};
}

function deskSelectionModel(input){
  if(!input||!input.context||!input.context.permissions||!input.context.permissions.view)return null;
  const x=input,c=x.context,C=c.config,p=x.price||{},s=x.signal||null,v=x.valuation||{},r=x.risk||{};
  const quality=deskSelectionQuality(x.business,C),price=deskSelNum(p.value),at=deskSelTime(p.observedAt),now=deskSelTime(c.now);
  const freshness=!(price>0)?'missing':at==null||now==null?'unknown':at>now?'invalid':
    now-at>C.staleMin*60000?'stale':p.freshness==='fresh'?'fresh':'unknown';
  const usable=freshness==='fresh',priceReasons=usable?[]:['price-'+freshness];
  const flags=deskSelUnique((s&&s.flags||[]).concat(s&&s.plan&&s.plan.flags||[]));
  const blockers=deskSelUnique((s&&s.blockers||[]).concat(flags.filter(f=>['knife','earnings'].includes(f)||s.side==='short'&&['squeeze','no-short'].includes(f))));
  const val=deskSelNum(v.value),date=deskSelTime(v.asOf),dateKnown=date!=null&&now!=null&&date<=now;
  const comparable=v.comparable===true&&!!v.currency&&v.currency===x.identity.ccy;
  const stale=!!v.stale||flags.includes('stale-target');
  const valReasons=deskSelUnique((v.warnings||[]).concat(!(val>0)?['valuation-missing']:[],
    comparable?[]:['valuation-incomparable'],dateKnown?[]:['valuation-date-unknown'],stale?['stale-target']:[]));
  const status=!(val>0)?'missing':!comparable?'incomparable':stale?'stale':!dateKnown?'undated':'available';
  const pe=deskSelCopy(v.peContext||{});
  if(deskSelNum(pe.eps)!=null&&pe.eps<=0){pe.comparable=false;pe.reasonCodes=deskSelUnique((pe.reasonCodes||[]).concat('pe-nonpositive-eps'));}
  const valuation={value:val>0?val:null,source:v.source||null,currency:v.currency||null,asOf:v.asOf||null,
    fetchedAt:v.fetchedAt||null,status,comparable,reasonCodes:valReasons,peContext:pe,
    upsidePct:comparable&&val>0&&price>0?(val/price-1)*100:null};
  const timing={verdict:s&&s.verdict||null,side:s&&s.side||null,plan:deskSelCopy(s&&s.plan||null),
    phase:deskSelCopy(s&&s.phase||null),flags,blockers,version:s&&s.version||null,
    // Исходный текст SIG — отдельное поле, не выдуманные коды причин.
    why:deskSelCopy(s&&s.why||[]),reasonCodes:s?deskSelUnique(['signal-'+s.verdict].concat(flags)):['signal-missing']};
  timing.waitingLevel=s&&s.plan&&s.plan.mode==='limit'&&deskSelNum(s.plan.entry)>0?s.plan.entry:null;
  timing.manualZone=deskSelCopy(x.watch&&x.watch.zone||null);
  timing.zoneSource=x.watch&&x.watch.source||null;
  if(s&&s.usable===false)timing.reasonCodes.push('signal-stale');
  if(timing.waitingLevel==null)timing.reasonCodes.push('level-not-calculated');
  const risk={auto:deskSelNum(r.auto),override:deskSelNum(r.override),level:deskSelNum(r.level),
    reasonCodes:deskSelUnique((r.reasons||[]).concat(flags)),parts:deskSelCopy(r.parts||[])};
  const warnings=deskSelUnique(priceReasons.concat(quality.reasonCodes,valReasons,timing.reasonCodes.filter(k=>k!=='signal-'+timing.verdict),risk.reasonCodes));
  const pos=x.position&&x.position.action?x.position:null,full=quality.mode==='full';
  let key,source,nextStep,reasons=[];
  if(pos){key=pos.action.act;source='position';reasons=['position-'+key];
    nextStep=!usable?'refresh-data':c.permissions.trade?'position-action':'view-position';
  }else if(!usable||!s||s.usable===false){key='refresh';source='data';nextStep='refresh-data';reasons=priceReasons.concat(!s?['signal-missing']:s.usable===false?['signal-stale']:[]);
  }else if(!full){key='research';source='business';nextStep='check-company';reasons=quality.reasonCodes;
  }else if(s.side==='short'){key='technical';source='signal';nextStep='view-technical';reasons=timing.reasonCodes;
  }else if(s.verdict==='buy'&&!blockers.length){key='candidate';source='signal';nextStep='check-trade';reasons=['signal-buy'];
  }else{key=s.plan&&s.plan.mode==='limit'&&s.plan.entry>0?'wait':'study';source='signal';nextStep=key==='wait'?'view-level':'check-company';reasons=timing.reasonCodes;}
  if(nextStep==='check-trade'&&(!c.selectedPortfolio||c.selectedPortfolio==='all'))nextStep='select-portfolio';
  if(nextStep==='check-trade'&&!c.permissions.trade)nextStep='view-technical';
  if(nextStep==='refresh-data'&&!c.permissions.refresh)nextStep='view-data-status';
  const action={key,source,reasonCodes:deskSelUnique(reasons),warnings,nextStep,
    position:deskSelCopy(pos),requiresPreview:key==='candidate'};
  const buckets=[],bucketReasons={},add=(k,rs)=>{buckets.push(k);bucketReasons[k]=rs;};
  const long=s&&s.side==='long',plan=s&&s.plan,entry=deskSelNum(plan&&plan.entry),stop=deskSelNum(plan&&plan.stop),target=deskSelNum(plan&&plan.target);
  const validLimit=long&&plan&&plan.mode==='limit'&&!plan.noLimit&&entry>0&&stop>0&&target>entry&&stop<entry&&
    C.rrOk(plan.rr,C.rrWeak)&&price>stop&&price<target;
  // Технические условия подборок отдельно от пригодности данных: «Нужно изучить» = технически проходит,
  // но не хватает только данных (§5, §15 #2). Оценка для кандидата не обязательна (решение 2026-09-11).
  const buyTech=long&&s.verdict==='buy'&&!blockers.length;
  const nearTech=!!validLimit&&!blockers.length&&['wait','hold','buy'].includes(s.verdict)&&Math.abs((entry/price-1)*100)<=C.nearZonePct*(1+1e-9);
  const dataOk=usable&&s&&s.usable!==false;
  const dataGaps=deskSelUnique(priceReasons.concat(s&&s.usable===false?['signal-stale']:[]));
  if(buyTech&&dataOk&&full)add('candidates',['signal-buy','business-full']);
  if(nearTech&&dataOk)add('near-zone',['valid-long-limit']);
  const growth=x.business&&x.business.facts||{};
  if(s&&full&&['A','A+'].includes(quality.grade)&&deskSelNum(growth.revenueGrowth)>0&&growth.growthBasis==='actual')add('quality-growth',['business-high','revenue-growth-actual']);
  if(s&&usable&&status==='available'&&v.source==='analysts'&&val>price&&!flags.includes('knife'))add('discount',['external-discount']);
  if(buyTech&&!(dataOk&&full)||nearTech&&!dataOk)add('research',deskSelUnique(dataGaps.concat(buyTech&&!full?quality.reasonCodes:[])));
  if(s&&(risk.auto>=4||blockers.length||flags.includes('squeeze')))add('high-risk',risk.reasonCodes.concat(blockers));
  return {identity:deskSelCopy(x.identity),price:{value:price,observedAt:p.observedAt||null,freshness},quality,valuation,timing,risk,action,
    selection:{eligible:buckets.includes('candidates'),buckets,reasonCodes:deskSelUnique(Object.values(bucketReasons).flat()),bucketReasons},
    // Снимок сортировки сохраняет поля SIG.cmp; новый общий балл не рассчитывается.
    signal:deskSelCopy(s)};
}

// Только подборки: не применять к ручному watch/final и пользовательской сортировке таблицы.
function deskPickBuckets(models,compareSignals,config){
  const out={};['candidates','near-zone','quality-growth','discount','research','high-risk'].forEach(k=>{out[k]={items:[],total:0};});
  const seen=new Set();
  (models||[]).filter(Boolean).forEach(m=>{
    if(seen.has(m.identity.key))return;seen.add(m.identity.key);
    m.selection.buckets.forEach(k=>{if(out[k])out[k].items.push(m);});
  });
  const cmp=(a,b)=>{
    const as=a.signal,bs=b.signal;let d=as&&bs?compareSignals(as,bs):!as-!bs;
    return d|| (a.identity.key<b.identity.key?-1:a.identity.key>b.identity.key?1:0);
  };
  Object.values(out).forEach(b=>{b.items.sort(cmp);b.total=b.items.length;b.items=b.items.slice(0,config.maxCards);});
  return out;
}

// ── P4 (plans/stock-selection-ux.md §6): сравнение 2–4 бумаг ──
// Выбор для сравнения: биржевые ключи без повторов, до max; повторный выбор снимает. full — лимит не дал добавить.
function deskCompareToggle(keys,key,max){
  const K=(keys||[]).filter((k,i,a)=>k&&a.indexOf(k)===i);
  if(!key)return {keys:K,full:false};
  if(K.includes(key))return {keys:K.filter(k=>k!==key),full:false};
  if(K.length>=max)return {keys:K,full:true};
  return {keys:K.concat(key),full:false};
}
// Факты последнего фин. года из ответа ?financials= (у обоих провайдеров — годовые ряды, один тип периода):
// рост выручки и EPS к предыдущему году и FCF-маржа. Нет соседнего года — роста нет; база ≤ 0 — не процент.
function deskCompareFinFacts(fin){
  const out={fy:null,ccy:null,source:null,revYoY:null,epsYoY:null,fcfMargin:null,codes:[]};
  if(!fin||typeof fin!=='object'){out.codes.push('fin-missing');return out;}
  if(fin.status==='error'){out.codes.push('fin-error');return out;}
  const A=(Array.isArray(fin.annual)?fin.annual:[]).filter(x=>x&&+x.year>0).slice().sort((a,b)=>a.year-b.year);
  if(!A.length){out.codes.push('fin-nodata');return out;}
  const last=A[A.length-1],prev=A.find(x=>+x.year===+last.year-1)||null;
  Object.assign(out,{fy:+last.year,ccy:fin.ccy||null,source:fin.source||null});
  const yoy=k=>{const a=deskSelNum(last[k]),b=prev?deskSelNum(prev[k]):null;
    if(a==null||b==null){out.codes.push(k+'-yoy-missing');return null;}
    if(!(b>0)){out.codes.push(k+'-base-nonpositive');return null;}
    return (a/b-1)*100;};
  out.revYoY=yoy('revenue');out.epsYoY=yoy('eps');
  const r=deskSelNum(last.revenue),f=deskSelNum(last.fcf);
  if(r>0&&f!=null)out.fcfMargin=f/r*100;else out.codes.push('fcf-margin-missing');
  return out;
}
// Строки: id · измерение · направление лучшего (hi — больше, lo — меньше, null — только факт) · первый вид.
// Абсолютных сумм нет: только доли, мультипликаторы и баллы — валюта и масштаб бумаг на них не влияют.
const DESK_CMP_ROWS=[
  ['action','action',null,true],['quality','company','hi',true],['valuation','price','hi',true],
  ['timing','timing',null,true],['rr','timing','hi',true],['risk','risk',null,true],['earnings','risk',null,true],
  ['profit','company','hi',false],['growth','company','hi',false],['balance','company','hi',false],['cash','company','hi',false],
  ['rev-yoy','company','hi',false],['eps-yoy','company','hi',false],['fcf-margin','company','hi',false],
  ['pe','price','lo',false],['fwd-pe','price','lo',false],['entry-dist','timing',null,false],['stop-dist','timing',null,false],
  ['sector','company',null,false]];
// Причина несопоставимости, когда у всех значения есть, но посчитаны по-разному.
const DESK_CMP_BASIS_WHY={quality:'applicability-differs',valuation:'source-differs',rr:'side-differs'};
function deskCompareCell(id,c,cfg){
  const m=c.model,q=m.quality,v=m.valuation,t=m.timing,p=t.plan||null,F=c.facts||{codes:[]},FC=F.codes||[];
  const cell=o=>Object.assign({v:null,basis:null,na:false,prov:false,codes:[]},o);
  const pick=pre=>FC.filter(x=>x.indexOf(pre)===0||x.indexOf('fin-')===0||x==='business-restricted');
  switch(id){
    case 'action':{const pa=m.action.source==='position'&&m.action.position?m.action.position.action:null;
      return cell({k:m.action.key,pos:pa?pa.act:null,next:m.action.nextStep});}
    case 'quality':return cell({v:q.value,basis:q.pillars.filter(x=>!x.na).map(x=>x.key).join(','),prov:q.mode!=='full',
      mode:q.mode,grade:q.grade,known:q.known,applicable:q.applicable,codes:q.reasonCodes.slice()});
    case 'valuation':return cell({v:v.upsidePct,basis:v.source,prov:v.status!=='available',status:v.status,value:v.value,
      asOf:v.asOf,codes:v.reasonCodes.slice()});
    case 'timing':return cell({verdict:t.verdict,side:t.side,waiting:t.waitingLevel,mode:p&&p.mode||null,
      entry:p?deskSelNum(p.entry):null,dEntry:p?deskSelNum(p.dEntry):null,blockers:t.blockers.slice()});
    case 'rr':return cell({v:p?deskSelNum(p.rr):null,basis:p&&p.side||null,approx:!!(p&&(p.flags||[]).includes('atr-target'))});
    case 'risk':return cell({v:m.risk.auto,override:m.risk.override,level:m.risk.level,blockers:t.blockers.slice()});
    case 'earnings':{const d=deskSelNum(c.earnDays),ok=d!=null&&d>=0;return cell({v:ok?d:null,soon:ok&&d<=cfg.earnDays});}
    case 'profit':case 'growth':case 'balance':case 'cash':{const P=q.pillars.find(x=>x.key===id)||{};
      return cell({v:P.na?null:deskSelNum(P.score),na:!!P.na,basis:'betyg',codes:P.na?['business-not-applicable']:q.mode==='full'?[]:['business-'+q.mode]});}
    case 'rev-yoy':return cell({v:F.revYoY,basis:F.fy!=null?'FY':null,fy:F.fy,codes:pick('revenue-')});
    case 'eps-yoy':return cell({v:F.epsYoY,basis:F.fy!=null?'FY':null,fy:F.fy,codes:pick('eps-')});
    case 'fcf-margin':return c.fin?cell({na:true,codes:['business-not-applicable']}):
      cell({v:F.fcfMargin,basis:F.fy!=null?'FY':null,fy:F.fy,codes:pick('fcf-')});
    case 'pe':{const pe=v.peContext||{},neg=(pe.reasonCodes||[]).includes('pe-nonpositive-eps');
      return cell({v:!neg&&pe.value>0?pe.value:null,na:neg,basis:'TTM',codes:neg?['pe-nonpositive-eps']:pe.value>0?[]:['pe-missing']});}
    case 'fwd-pe':return cell({v:c.fwdPe>0?c.fwdPe:null,basis:'fwd'});
    case 'entry-dist':return cell({v:p?deskSelNum(p.dEntry):null,mode:p&&p.mode||null});
    case 'stop-dist':return cell({v:p?deskSelNum(p.riskPct):null});
    case 'sector':return cell({text:c.sector||null});
  }
  return cell({});
}
// Лучшее/худшее — только в сопоставимой строке: значение есть у всех, применимо ко всем, не предварительное и
// посчитано одинаково (тип периода, сторона плана, источник оценки, набор столпов). Сравнение — с точностью показа
// (0,1): значения, которые на экране выглядят равными, не подсвечиваются.
function deskCompareRow(def,cells){
  const [id,dim,dir,primary]=def,row={id,dim,dir,primary,cells,comparable:false,why:null,best:[],worst:[]};
  if(!dir)return row;
  row.why=cells.length<2?'few':cells.some(c=>c.na)?'not-applicable':cells.every(c=>c.v==null)?'none':cells.some(c=>c.v==null)?'missing':
    cells.some(c=>c.prov)?(id==='valuation'?'status':'provisional'):
    new Set(cells.map(c=>c.basis)).size>1?(DESK_CMP_BASIS_WHY[id]||'period-differs'):null;
  if(row.why)return row;
  row.comparable=true;
  const vs=cells.map(c=>Math.round(c.v*10)),hi=Math.max(...vs),lo=Math.min(...vs);
  if(hi===lo){row.why='equal';return row;}
  const top=dir==='hi'?hi:lo,bot=dir==='hi'?lo:hi;
  vs.forEach((v,i)=>{if(v===top)row.best.push(i);else if(v===bot)row.worst.push(i);});
  return row;
}
// «Чем отличаются условия»: по измерению — только если бумаги различаются; факты каждой бумаги, без итога «A лучше B».
function deskCompareDiffs(rows,keys){
  const R={},out=[];rows.forEach(r=>{R[r.id]=r;});
  const add=(dim,sig,items)=>{if(new Set(sig).size>1)out.push({dim,items:items.map((x,i)=>Object.assign({key:keys[i]},x))});};
  const A=R.action.cells,Q=R.quality.cells,V=R.valuation.cells,T=R.timing.cells,K=R.risk.cells,E=R.earnings.cells;
  add('action',A.map(c=>c.pos||c.k),A.map(c=>({k:c.k,pos:c.pos})));
  add('company',Q.map(c=>c.mode+'|'+(c.mode==='full'?c.grade:'')),Q.map(c=>({mode:c.mode,grade:c.grade,value:c.v,known:c.known,applicable:c.applicable})));
  add('price',V.map((c,i)=>c.status+'|'+(R.valuation.best.includes(i)?'best':R.valuation.worst.includes(i)?'worst':'')),
    V.map(c=>({status:c.status,upsidePct:c.v,source:c.basis,asOf:c.asOf})));
  add('timing',T.map(c=>[c.verdict,c.side,c.waiting!=null?'limit':c.mode].join('|')),T.map(c=>({verdict:c.verdict,side:c.side,waiting:c.waiting,mode:c.mode,entry:c.entry,dEntry:c.dEntry})));
  add('risk',K.map(c=>c.v+'|'+c.blockers.join(',')),K.map(c=>({level:c.v,override:c.override,blockers:c.blockers})));
  // Близкий отчёт — критический факт, даже если он у всех.
  if(E.some(c=>c.soon))out.push({dim:'earnings',items:E.map((c,i)=>({key:keys[i],days:c.v,soon:c.soon}))});
  return out;
}
// cols: [{key, tk, ccy, sector, fin (финансовый сектор), model (deskSelectionModel), facts (deskCompareFinFacts),
// fwdPe, earnDays}]; cfg: {earnDays}. Нового общего балла и победителя нет.
function deskCompareModel(cols,cfg){
  const C=(cols||[]).filter(c=>c&&c.model),keys=C.map(c=>c.key);
  const rows=DESK_CMP_ROWS.map(def=>deskCompareRow(def,C.map(c=>deskCompareCell(def[0],c,cfg))));
  return {keys,rows,diffs:C.length>=2?deskCompareDiffs(rows,keys):[]};
}

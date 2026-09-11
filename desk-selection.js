// P1: чистая модель отбора. Только нормализованные входы, время и конфигурация аргументами.
// value качества — 0…10 (шкала Betyg), coverage — 0…1. Причины — коды; UI переводит их.
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

// «Что-если» по порогам signals.js на реальных свечах (калибровка v2, plans/signals-calibration.md §3.1, §5).
// Запуск из корня репо:  node plans/redesign-trading/whatif-signals.js [--tg] [--ref=<git ref>] [--only=Q1,Q3a] ['{"nearPct":2.5}']
//   --tg        — брать апсайд к таргету из data.js (таргеты сида, устаревшие — только для направления Q7/Q8);
//   --ref=…     — база сравнения = signals.js из этого коммита (напр. --ref=0a64ef9 — правила до калибровки);
//                 без флага база = текущий signals.js;
//   --only=…    — прогнать только выбранные варианты; последний аргумент-JSON — свой вариант поверх SIG.CFG.
// Варианты меняют только SIG.CFG текущего signals.js; правила (нож, перегрев, недооценка, пробой) — родные.
// Свечи: воркер ?history=SYM&range=2y, кэш в ~/.cache/dash-whatif (удалить папку, чтобы обновить).
const fs=require('fs'),path=require('path'),os=require('os'),{execFileSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..','..'),CACHE=path.join(os.homedir(),'.cache','dash-whatif');
const PROXY='https://telegram-notify-abc.dmitriy-bilokon.workers.dev';
const args=process.argv.slice(2),useTg=args.includes('--tg'),only=(args.find(a=>a.startsWith('--only='))||'').slice(7).split(',').filter(Boolean);
const ref=(args.find(a=>a.startsWith('--ref='))||'').slice(6);
const custom=args.find(a=>a.startsWith('{'))?JSON.parse(args.find(a=>a.startsWith('{'))):null;

const load=src=>{const m={exports:{}};new Function('module','exports',src)(m,m.exports);return m.exports;};
const SIG=load(fs.readFileSync(path.join(ROOT,'signals.js'),'utf8'));
const REF=ref?load(execFileSync('git',['show',ref+':signals.js'],{cwd:ROOT,encoding:'utf8'})):null;

// Вселенная = OMXS30 + Nasdaq 100 из data.js (как на дне 0 наблюдения); символы как exSymbol в app.js.
const OV={NDB:'NDA-SE.ST',ASML:'ASML.AS',FIGMA:'FIG'};
globalThis.ALL=undefined; new Function(fs.readFileSync(path.join(ROOT,'data.js'),'utf8').replace(/^const ALL=/m,'globalThis.ALL='))();
const U=[];for(const [tab,ccy] of [['OMXS30','SEK'],['Nasdaq 100','USD']])for(const r of ALL.data[tab].rows){const t=String(r[2]).trim().toUpperCase().replace(/\s+/g,'-');U.push({tab,tk:r[2],sym:OV[t]||(t.includes('.')?t:ccy==='SEK'?t+'.ST':t),tg:+r[6]||0});}

async function bars(sym){fs.mkdirSync(CACHE,{recursive:true});const f=path.join(CACHE,sym+'.json');
  if(!fs.existsSync(f)){const r=await fetch(`${PROXY}/?history=${encodeURIComponent(sym)}&range=2y`);if(!r.ok)return null;fs.writeFileSync(f,await r.text());}
  try{return SIG.barsFromHist(JSON.parse(fs.readFileSync(f,'utf8')));}catch(e){return null;}}

const BASE=Object.assign({},SIG.CFG);
function run(S,B,cfg){if(S===SIG)Object.assign(SIG.CFG,BASE,cfg);const R={};
  for(const u of U){const b=B[u.sym];if(!b||b.length<S.CFG.minBars)continue;const last=b[b.length-1].c;
    const s=S.snapshot(b,{riskKr:5000,fx:1,upTg:useTg&&u.tg>0?(u.tg/last-1)*100:null});if(s)R[u.tk]=s;}
  return R;}
function stats(R){const v={},ph={},fl={},rr={lt12:0,mid:0,ge2:0,eq15:0,eq2:0},mode={market:0,limit:0};let near=0,n=0,tgFb=0;
  for(const s of Object.values(R)){n++;v[s.verdict]=(v[s.verdict]||0)+1;ph[s.phase.key]=(ph[s.phase.key]||0)+1;for(const f of s.flags)fl[f]=(fl[f]||0)+1;
    const x=s.plan.rr;if(x<1.2)rr.lt12++;else if(x<2-1e-9)rr.mid++;else rr.ge2++;if(Math.abs(x-1.5)<1e-9)rr.eq15++;if(Math.abs(x-2)<1e-9)rr.eq2++;mode[s.plan.mode]++;if(s.near)near++;if(/ATR/.test(s.plan.targetSrc))tgFb++;}
  return {n,v,ph,fl,rr,mode,near,tgFb};}
const fmt=o=>Object.entries(o).map(([k,v])=>k+' '+v).join(' · ');
function show(name,R,B){const st=stats(R);console.log(`\n### ${name} (n=${st.n})\nвердикты: ${fmt(st.v)}\nфазы: ${fmt(st.ph)}\nR/R: <1.2 ${st.rr.lt12} · 1.2–2 ${st.rr.mid} · ≥2 ${st.rr.ge2} · ровно 1.5: ${st.rr.eq15} · ровно 2.0: ${st.rr.eq2} · вход: ${fmt(st.mode)} · у уровня: ${st.near} · цель-фолбэк ATR: ${st.tgFb}\nфлаги: ${fmt(st.fl)||'—'}`);
  if(B){const ch=Object.keys(R).filter(k=>B[k]&&B[k].verdict!==R[k].verdict);console.log('изменили вердикт vs база: '+ch.length);ch.forEach(k=>console.log(`  ${k}: ${B[k].verdict}→${R[k].verdict} (R/R ${R[k].plan.rr.toFixed(2)}, ${R[k].why[0].slice(0,90)})`));}}

const VARIANTS=[
  ['Q1','цель-фолбэк как стоп-фолбэк (targetAtr 1.5, до калибровки)',{targetAtr:1.5}],
  ['Q1b','rrMin 1.8 (мягче решения §10#5)',{rrMin:1.8}],
  ['Q2a','nearPct 2.5',{nearPct:2.5}],
  ['Q3a','corridorAtr 3.5 (шире поиск цели и стопа)',{corridorAtr:3.5}],
  ['Q3b','wide при дистанции стопа > 2.5·ATR',{wideAtr:2.5}],
];
(async()=>{const B={};for(const u of U)B[u.sym]=await bars(u.sym);
  console.log(`Вселенная: ${U.length} бумаг (OMXS30 + Nasdaq 100 из data.js) · апсайд к таргету из data.js: ${useTg} · правила ${SIG.VER||'—'}`);
  const cur=run(SIG,B,{});
  if(REF){const base=run(REF,B,{});show(`БАЗА: signals.js @ ${ref}`,base);show(`ТЕКУЩИЙ signals.js (${SIG.VER||'—'})`,cur,base);}
  else show(`БАЗА: текущий signals.js (${SIG.VER||'—'})`,cur);
  for(const [id,name,cfg] of VARIANTS){if(only.length&&!only.includes(id))continue;show(`${id}: ${name}`,run(SIG,B,cfg),cur);}
  if(custom)show('СВОЙ: '+JSON.stringify(custom),run(SIG,B,custom),cur);
})();

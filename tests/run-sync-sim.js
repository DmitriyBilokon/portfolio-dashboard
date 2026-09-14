#!/usr/bin/env node
// Сквозная симуляция синка (E4, plans/ledger-model-e.md §4.E4): два клиента — node vm-контексты с настоящим кодом сайта
// (скрипты из index.html, заглушки tests/env-stubs.js) — и фейковый Supabase: одна строка ledger_state с триггером
// supabase-ledger-guard.sql (не выросший rev → строка остаётся, событие всё равно рассылается; пустой журнал/aiPort без
// startedAt не затирают старые), realtime-рассылка, задержки сети, офлайн (navigator.onLine=false), «сеть есть, запросы падают»
// (flaky), «запись не дошла» (failPut), «потерянный ответ» (запись прошла, ответ — ошибка),
// «воркер» (как writeRow: свежая строка + rev+1). Часы общие и управляемые: таймеры клиентов, задержки и realtime идут по ним,
// после каждого срабатывания — прогон микрозадач. JSC-сьюты промисы не крутят, поэтому — node.
//
//   node tests/run-sync-sim.js                       — на бандле data.js (входит в tests/run.sh; маркер «SYNC-SIM TESTS: N/N passed»)
//   node tests/run-sync-sim.js --copy=<ledger.json>  — те же сценарии на копии реального ledger (стенд, вне run.sh; то же —
//                                                      node tests/ledger-copy.js <copy> --merge-sim)
//   --only=<подстрока>  — только сценарии с этим названием;  --verbose — предупреждения клиентов (console.warn/error)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const UID = '00000000-0000-4000-8000-0000000000e4';
const T0 = Date.parse('2026-09-14T10:00:00Z');

function scriptList() {   // порядок — как в index.html; только локальные .js с ?v=
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const out = [], re = /<script[^>]+src="([A-Za-z0-9_./-]+\.js)\?v=[^"]*"/g;
  let m; while ((m = re.exec(html))) out.push(m[1]);
  return out;
}
const SITE = new vm.Script(scriptList().map(f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\n(boot|deskBoot)\(\);\s*$/, '\n')).join('\n;\n'), { filename: 'site.js' });
const STUBS = new vm.Script(fs.readFileSync(path.join(__dirname, 'env-stubs.js'), 'utf8'), { filename: 'env-stubs.js' });
const J = x => JSON.stringify(x);
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x);

// ── часы: общая очередь таймеров всех клиентов и сети ──
function mkClock() {
  const c = { now: T0, q: [], seq: 0, errors: [] };
  c.setTimeout = (fn, ms) => { const id = ++c.seq; c.q.push({ id, at: c.now + Math.max(0, +ms || 0), fn }); return id; };
  c.clearTimeout = id => { c.q = c.q.filter(x => x.id !== id); };
  c.drain = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
  c.run = async ms => {
    const end = c.now + ms;
    for (;;) {
      await c.drain();
      c.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = c.q[0]; if (!t || t.at > end) break;
      c.q.shift(); c.now = Math.max(c.now, t.at);
      try { t.fn(); } catch (e) { c.errors.push(e); }
    }
    c.now = end; await c.drain();
  };
  c.at = (ms, fn) => c.setTimeout(fn, ms);
  return c;
}
function mkDate(clock) {
  const RD = Date;
  return class D extends RD { constructor(...a) { if (a.length) super(...a); else super(clock.now); } static now() { return clock.now; } };
}

// ── фейковая строка ledger_state + realtime ──
function mkDB(clock) {
  const db = { row: null, subs: [], big: false, writes: 0, rejects: 0, beforeUpsert: null };
  db.data = () => db.row ? JSON.parse(db.row) : null;
  db.rev = () => { const d = db.data(); return d ? Number(d.rev) || 0 : 0; };
  // ledger_state_guard: new_rev <= old_rev → return OLD (UPDATE проходит со старыми значениями — событие есть);
  // пустой журнал поверх непустого и aiPort без startedAt поверх инициализированного — подставить старые.
  db.put = data => {
    const old = db.data(), nrev = Number(data && data.rev) || 0;
    let committed = false;
    if (!old || nrev > (Number(old.rev) || 0)) {
      const d = JSON.parse(J(data));
      if (old && Array.isArray(old.pfTrades) && old.pfTrades.length && !(Array.isArray(d.pfTrades) && d.pfTrades.length)) d.pfTrades = old.pfTrades;
      if (old && old.aiPort && old.aiPort.startedAt && !(d.aiPort && d.aiPort.startedAt)) d.aiPort = old.aiPort;
      db.row = J(d); committed = true; db.writes++;
    } else db.rejects++;
    if (process.env.SIM_TRACE) console.log(`   t+${clock.now - T0} put rev ${nrev} → ${committed ? 'коммит' : 'отказ (в облаке ' + db.rev() + ')'}`);
    db.emit();
    return { committed, rev: db.rev() };
  };
  db.emit = () => {
    const s = db.row;
    db.subs.forEach(sub => {
      const C = sub.client;
      if (C.offline || (C.rtDrop && C.rtDrop(JSON.parse(s)))) return;
      clock.setTimeout(() => {
        if (C.offline || !sub.live) return;
        if (process.env.SIM_TRACE) console.log(`   t+${clock.now - T0} realtime → ${C.name} rev ${JSON.parse(s).rev}`);
        sub.cb({ eventType: 'UPDATE', schema: 'public', table: 'ledger_state', old: {},
          new: db.big ? { user_id: UID, updated_at: 'x' } : { user_id: UID, data: JSON.parse(s), updated_at: 'x' } });
      }, C.rt);
    });
  };
  db.worker = fn => { const d = db.data(); fn(d); d.rev = (Number(d.rev) || 0) + 1; return db.put(d); };
  return db;
}
// Минимальный supabase-js: строитель запросов (thenable) поверх фейковой строки; остальные таблицы — пусто.
function mkSb(db, clock, C) {
  const wait = ms => new Promise(r => clock.setTimeout(r, ms));
  function exec(st) {
    return (async () => {
      await wait(C.lat / 2);
      C.reqs++;
      // offline — браузер без сети (navigator.onLine=false); flaky — сеть «есть», но запросы падают; failPut — запись не дошла до сервера
      if (C.offline || C.flaky) return { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 };
      let res;
      if (st.table === 'ledger_state') {
        if (st.op === 'upsert') {
          if (C.failPut > 0) { C.failPut--; await wait(C.lat / 2); return { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }; }
          if (db.beforeUpsert) db.beforeUpsert(C);
          db.put(st.body.data);
          res = { data: [pick(db.data(), st.ret || 'data->rev')], error: null };   // RETURNING — строка как она есть (OLD при отказе)
          if (C.loseAck > 0) { C.loseAck--; res = { data: null, error: { message: 'TypeError: Failed to fetch (ответ потерян)' }, status: 0 }; }
        } else {
          const d = db.data();
          res = !d ? { data: null, error: null } : { data: pick(d, st.cols), error: null };
        }
      } else res = st.single ? { data: null, error: null } : { data: [], error: null };
      await wait(C.lat / 2);
      return res;
    })();
  }
  // select PostgREST по JSON-колонке data: 'data' | 'data->k' | 'alias:data->k' | 'alias:data->>k', через запятую.
  function pick(d, cols) {
    const o = {};
    String(cols || '').split(',').forEach(c => {
      c = c.trim(); if (c === 'data') { o.data = d; return; }
      const m = /^(?:(\w+):)?data->>?(\w+)$/.exec(c); if (!m) throw new Error('sim: select ' + c);
      const v = d[m[2]]; o[m[1] || m[2]] = v === undefined ? null : (c.includes('->>') && v != null ? String(v) : v);
    });
    return o;
  }
  function from(table) {
    const st = { table, op: 'select', cols: null, ret: null, single: false, body: null }, b = {
      select(c) { if (st.op === 'select') st.cols = c; else st.ret = c; return b; },
      eq() { return b; }, in() { return b; }, order() { return b; }, range() { return b; }, limit() { return b; },
      maybeSingle() { st.single = true; return b; }, single() { st.single = true; return b; },
      // upsert: как supabase-js — тело сериализуется при вызове, а не по живым ссылкам через полсети
      upsert(body) { st.op = 'upsert'; st.body = JSON.parse(J(body)); return b; }, insert(body) { st.op = 'insert'; st.body = body; return b; },
      update(body) { st.op = 'update'; st.body = body; return b; }, delete() { st.op = 'delete'; return b; },
      then(ok, bad) { return exec(st).then(ok, bad); },
    };
    return b;
  }
  return {
    from, rpc: () => exec({ table: 'rpc', single: true }),
    channel() { const ch = { subs: [], on(ev, f, cb) { if (f && f.table === 'ledger_state') { const s = { client: C, cb, live: true }; db.subs.push(s); ch.subs.push(s); } return ch; }, subscribe() { return ch; } }; return ch; },
    removeChannel(ch) { if (ch && ch.subs) ch.subs.forEach(s => { s.live = false; db.subs = db.subs.filter(x => x !== s); }); },
    auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange() {}, signOut: () => Promise.resolve({}) },
  };
}

// ── клиент: сайт в своём vm-контексте ──
function mkClient(name, db, clock, lat, verbose) {
  const C = { name, lat, rt: 8, offline: false, flaky: false, failPut: 0, loseAck: 0, rtDrop: null, logs: [], reqs: 0 };
  const log = kind => (...a) => { const s = kind + ' ' + a.map(x => x && x.message ? x.message : typeof x === 'string' ? x : J(x)).join(' '); C.logs.push(s); if (verbose) console.log('   [' + name + '] ' + s); };
  const ctx = vm.createContext({ console: { log() {}, info() {}, debug() {}, warn: log('warn'), error: log('error') } });
  ctx.Date = mkDate(clock);
  STUBS.runInContext(ctx);
  Object.defineProperty(vm.runInContext('navigator', ctx), 'onLine', { get: () => !C.offline, configurable: true });
  Object.assign(ctx, { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setInterval: () => 0, clearInterval: () => {} });
  ctx.window.supabase = { createClient: () => mkSb(db, clock, C) };
  SITE.runInContext(ctx);
  let seed = name.charCodeAt(0) * 7919;
  ctx.__rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  vm.runInContext(`Math.random=__rnd; renderAll=function(){}; renderPF3=function(){}; if(typeof deskRender==='function')deskRender=function(){};
    planNotify=function(){}; globalThis.__toasts=[]; toast=function(m){ globalThis.__toasts.push(String(m)); };
    function __row(tk){ const d=DATA[PF3_KEY]; return d.rows.find(x=>String(x[RC.tk]).trim().toUpperCase()===tk); }
    function __qty(tk,q){ const d=DATA[PF3_KEY],r=__row(tk); r[RC.qty]=q; recalcPF(d.rows.indexOf(r),PF3_KEY); }`, ctx);
  C.run = code => vm.runInContext(code, ctx);
  C.json = code => { const s = vm.runInContext('JSON.stringify(' + code + ')', ctx); return s === undefined ? undefined : JSON.parse(s); };
  C.edit = code => vm.runInContext('(function(){' + code + '})(); scheduleSave();', ctx);
  C.toasts = () => { const t = C.json('globalThis.__toasts'); vm.runInContext('globalThis.__toasts=[]', ctx); return t; };
  return C;
}
async function start(C, clock) {
  C.run(`currentUser={id:${J(UID)},email:'dmitriy.bilokon@gmail.com'}; userRole='admin'; migrateState(); init(); pullState();`);
  await clock.run(1500);
  C.run('subscribeRealtime();');
  await clock.run(12000);
}
// Позиции для сценариев: три строки с qty>0 в Портфеле 3.0, кэш, две сделки, правило плана, мета, AI-портфель.
const PREP = `(function(){
  const d=DATA[PF3_KEY], add=(tk,name,qty,price,buy)=>{ let r=__row(tk);
    if(!r){ r=new Array(d.headers.length).fill(''); r[RC.n]=d.rows.length+1; r[RC.name]=name; r[RC.tk]=tk; r[RC.ccy]='USD'; r[RC.sector]='Tech'; d.rows.push(r); }
    r[RC.qty]=qty; r[RC.price]=price; r[RC.buy]=buy; recalcPF(d.rows.indexOf(r),PF3_KEY); };
  let pos=d.rows.filter(r=>(parseFloat(r[RC.qty])||0)>0);
  if(pos.length<3){ add('MU','Micron',10,100,90); add('AAPL','Apple',5,200,150); add('NVDA','NVIDIA',3,120,100); pos=d.rows.filter(r=>(parseFloat(r[RC.qty])||0)>0); }
  if(!(typeof d.cashFree==='number'))d.cashFree=10000;
  const T=pos.slice(0,3).map(r=>String(r[RC.tk]).trim().toUpperCase());
  if((PF_TRADES||[]).length<2)PF_TRADES.push({id:'tS1',tab:PF3_KEY,tk:T[0],name:T[0],ccy:'USD',act:'buy',qty:1,price:90,date:'2026-09-01'},{id:'tS2',tab:PF3_KEY,tk:T[1],name:T[1],ccy:'USD',act:'buy',qty:1,price:150,date:'2026-09-02'});
  let rule=(PLAN_RULES||[]).find(r=>!r.done);
  if(!rule){ rule=planRuleNorm({id:'pl1757844000000',tab:PF3_KEY,tk:T[2],name:T[2],act:'buy',level:110,qty:2,ccy:'USD',done:false,hitAt:0}); PLAN_RULES.push(rule); }
  if(!posMetaGet(PF3_KEY,T[0]))posMetaSet(PF3_KEY,T[0],{side:'long',stop:1,target:1e6});
  if(!AI_PORT||!AI_PORT.startedAt)migrateAiPort();
  scheduleSave();
  return {T, rule:rule.id, trades:PF_TRADES.slice(0,2).map(t=>t.id), cash:d.cashFree};
})()`;

const res = [];
const eq = (n, g, e) => { const p = J(g) === J(e); res.push({ n, p, i: p ? '' : 'got ' + J(g) + ' exp ' + J(e) }); };
const ok = (n, c, i) => res.push({ n, p: !!c, i: c ? '' : (i || 'falsy') });

function diffTop(a, b) { const o = []; Object.keys(Object.assign({}, a, b)).forEach(k => { if (canon(a[k]) !== canon(b[k])) o.push(k); }); return o.join(','); }
// Сошлись: оба клиента = облако (снапшот без rev), их rev и база слияния = облако; очередь синка пуста.
function converged(e, label) {
  const d = e.db.data(), dd = Object.assign({}, d); delete dd.rev; delete dd.wid;   // транспорт push, не состояние
  [e.A, e.B].forEach(C => {
    const s = C.json('snapshotState()'), st = C.json('{rev:stateRev,base:syncBaseGet(),busy:syncBusy(),pend:remotePending!=null,un:SYNC_UNACKED.length>0}');
    ok(`${label}: ${C.name} = облако`, canon(s) === canon(dd), 'ключи ' + diffTop(s, dd));
    ok(`${label}: ${C.name} rev и база слияния = облако, очередь пуста`, st.rev === d.rev && canon(st.base) === canon(d) && !st.busy && !st.pend && !st.un,
      `rev ${st.rev}/${d.rev} база ${canon(st.base) === canon(d) ? '=' : '≠ ' + diffTop(st.base || {}, d)} busy ${st.busy} pend ${st.pend} unacked ${st.un}`);
  });
}
const conflictToast = t => t.filter(x => /Одновременная правка|Concurrent edit/.test(x));
const oldToast = t => t.filter(x => /Конфликт синхронизации|Sync conflict/.test(x));
const rowOf = (d, e, tk) => d.data[e.PF3].rows.find(r => String(r[e.RC.tk]).trim().toUpperCase() === tk);

// ── сценарии ──
const SCEN = [
  ['S1 разные строки и план на двух устройствах', async e => {
    const [t1] = e.T;
    e.A.edit(`__qty(${J(t1)},12); DATA[PF3_KEY].cashFree-=200;`);
    e.B.edit(`PLAN_RULES.find(x=>x.id===${J(e.rule)}).level=105;`);
    await e.clock.run(15000);
    const d = e.db.data();
    eq('S1 облако: позиция и кэш с A, правило с B', [rowOf(d, e, t1)[e.RC.qty], d.data[e.PF3].cashFree, d.planRules.find(x => x.id === e.rule).level], [12, e.cash - 200, 105]);
    ok('S1 был отказ триггера (гонка) — и он слит', e.db.rejects > 0, 'rejects ' + e.db.rejects);
    eq('S1 тостов конфликта нет', [conflictToast(e.A.toasts()), oldToast(e.B.toasts())], [[], []]);
    converged(e, 'S1');
  }],
  ['S1b то же при строке больше лимита realtime (событие без data → сверка rev)', async e => {
    e.db.big = true;
    const [t1] = e.T;
    e.A.edit(`__qty(${J(t1)},12);`);
    e.B.edit(`PLAN_RULES.find(x=>x.id===${J(e.rule)}).level=105;`);
    await e.clock.run(15000);
    const d = e.db.data();
    eq('S1b облако: обе правки', [rowOf(d, e, t1)[e.RC.qty], d.planRules.find(x => x.id === e.rule).level], [12, 105]);
    eq('S1b тостов нет', [e.A.toasts().length, e.B.toasts().length], [0, 0]);
    converged(e, 'S1b');
  }],
  ['S2 одна и та же позиция', async e => {
    const [t1] = e.T;
    e.A.edit(`__qty(${J(t1)},12);`);
    e.B.edit(`__qty(${J(t1)},15);`);
    await e.clock.run(15000);
    const d = e.db.data(), tb = e.B.toasts();
    eq('S2 облако: версия первого (A)', rowOf(d, e, t1)[e.RC.qty], 12);
    ok('S2 у B тост «одновременная правка» с бумагой', conflictToast(tb).length === 1 && conflictToast(tb)[0].includes(t1), J(tb));
    eq('S2 у A тостов нет', e.A.toasts(), []);
    converged(e, 'S2');
  }],
  ['S3 воркер пишет aiPort, пока у A стоит таймер правки', async e => {
    const [t1] = e.T;
    e.A.edit(`posMetaSet(PF3_KEY,${J(t1)},{stop:2});`);
    e.clock.at(300, () => e.db.worker(d => { d.aiPort.cashSEK = (d.aiPort.cashSEK || 0) - 1000; d.aiPort.trades = (d.aiPort.trades || []).concat([{ id: 'wS3', ticker: 'MU', action: 'buy' }]); d.aiPort.lastRunAt = e.clock.now; }));
    await e.clock.run(15000);
    const d = e.db.data();
    eq('S3 облако: стоп A и сделка воркера', [d.posMeta[e.PF3][t1].stop, d.aiPort.trades.slice(-1)[0].id], [2, 'wS3']);
    eq('S3 AI_PORT у A — торговое состояние воркера', e.A.json('AI_PORT.cashSEK'), d.aiPort.cashSEK);
    eq('S3 тостов нет', [e.A.toasts().length, e.B.toasts().length], [0, 0]);
    converged(e, 'S3');
  }],
  ['S4 правка офлайн (сон ноутбука) + правка другого устройства → онлайн', async e => {
    const [t1, t2] = e.T;
    e.B.offline = true;
    e.B.edit(`__qty(${J(t2)},7);`);
    await e.clock.run(3000);
    ok('S4 push B офлайн не отправлен', e.B.logs.some(s => /Sync push skipped: offline/.test(s)) && e.B.json('SYNC_UNACKED.length') === 0, J(e.B.logs.slice(-3)));
    e.A.edit(`__qty(${J(t1)},12);`);
    await e.clock.run(3000);
    e.B.offline = false;
    e.B.run('syncResumeCheck();');   // online / вкладка снова видна
    await e.clock.run(15000);
    const d = e.db.data();
    eq('S4 облако: обе правки', [rowOf(d, e, t1)[e.RC.qty], rowOf(d, e, t2)[e.RC.qty]], [12, 7]);
    eq('S4 тостов нет', [e.A.toasts().length, e.B.toasts().length], [0, 0]);
    converged(e, 'S4');
  }],
  ['S5 ответ на push потерян, эхо дошло — кэш не удваивается', async e => {
    e.B.loseAck = 1;
    e.B.edit('DATA[PF3_KEY].cashFree-=300;');
    await e.clock.run(3000);
    e.A.edit('DATA[PF3_KEY].cashFree-=100;');
    await e.clock.run(15000);
    eq('S5 облако: кэш = −300 −100', e.db.data().data[e.PF3].cashFree, e.cash - 400);
    eq('S5 тостов нет', [e.A.toasts().length, e.B.toasts().length], [0, 0]);
    converged(e, 'S5');
  }],
  ['S5b ответ потерян, своё эхо пропало — облако ушло дальше', async e => {
    e.B.loseAck = 1;
    let mine = 0;
    e.B.rtDrop = d => d.cv && e.db.rev() === d.rev && mine++ === 0;   // первое событие после записи B (её эхо) — не доходит
    e.B.edit('DATA[PF3_KEY].cashFree-=300;');
    await e.clock.run(3000);
    e.B.rtDrop = null;
    e.A.edit('DATA[PF3_KEY].cashFree-=100;');
    await e.clock.run(15000);
    eq('S5b облако и клиенты: кэш = −300 −100 (без двойного счёта)', [e.db.data().data[e.PF3].cashFree, e.B.json('DATA[PF3_KEY].cashFree')], [e.cash - 400, e.cash - 400]);
    converged(e, 'S5b');
  }],
  ['S6 четыре отказа подряд → прежнее «облако побеждает»', async e => {
    const [, t2] = e.T;
    let n = 0;
    e.db.beforeUpsert = C => { if (C.name === 'B' && n++ < 4) e.db.worker(d => { d.aiPort.lastRunAt = e.clock.now + n; }); };
    e.B.edit(`__qty(${J(t2)},9);`);
    await e.clock.run(15000);
    e.db.beforeUpsert = null;
    await e.clock.run(5000);
    const d = e.db.data(), tb = e.B.toasts();
    eq('S6 правка B потеряна после SYNC_MERGE_TRIES слияний', rowOf(d, e, t2)[e.RC.qty], e.q2);
    ok('S6 у B прежний тост конфликта', oldToast(tb).length === 1, J(tb));
    converged(e, 'S6');
  }],
  ['S7 котировки на обоих + сделка на B', async e => {
    const [t1] = e.T;
    const bump = k => `DATA[PF3_KEY].rows.forEach((r,i)=>{ const p=parseFloat(r[RC.price]); if(p>0){ r[RC.price]=Math.round(p*${k}*100)/100; r[RC.day]=${k}; recalcPF(i,PF3_KEY); } }); DATA[PF3_KEY].targetsAt=Date.now()+${k};`;
    e.A.edit(bump(1.01));
    e.B.edit(bump(1.02) + `const r=__row(${J(t1)}); r[RC.buy]=Math.round((r[RC.buy]*r[RC.qty]+130*2)/(r[RC.qty]+2)*100)/100; __qty(${J(t1)},(parseFloat(r[RC.qty])||0)+2);
      DATA[PF3_KEY].cashFree-=260; PF_TRADES.push({id:'tS7',tab:PF3_KEY,tk:${J(t1)},name:${J(t1)},ccy:'USD',act:'buy',qty:2,price:130,date:'2026-09-14'});`);
    await e.clock.run(15000);
    const d = e.db.data();
    eq('S7 облако: сделка B целиком (кол-во, кэш, журнал)', [rowOf(d, e, t1)[e.RC.qty], d.data[e.PF3].cashFree, d.pfTrades.some(t => t.id === 'tS7')], [e.q1 + 2, e.cash - 260, true]);
    eq('S7 тостов конфликта нет (цены — мягкие)', [conflictToast(e.A.toasts()), conflictToast(e.B.toasts())], [[], []]);
    converged(e, 'S7');
  }],
  ['S8 удаление сделки на A, новая сделка на B', async e => {
    const [t1] = e.T;
    e.A.edit(`PF_TRADES.splice(PF_TRADES.findIndex(t=>t.id===${J(e.trades[0])}),1);`);
    e.B.edit(`PF_TRADES.push({id:'tS8',tab:PF3_KEY,tk:${J(t1)},name:${J(t1)},ccy:'USD',act:'sell',qty:1,price:111,date:'2026-09-14'});`);
    await e.clock.run(15000);
    const ids = e.db.data().pfTrades.map(t => t.id);
    eq('S8 облако: удалённой нет, новая в конце', [ids.includes(e.trades[0]), ids.slice(-1)[0]], [false, 'tS8']);
    eq('S8 тостов нет', [e.A.toasts().length, e.B.toasts().length], [0, 0]);
    converged(e, 'S8');
  }],
  ['S10 ответ потерян, своё эхо пропало, ещё правка кэша (ревью X1)', async e => {
    e.B.loseAck = 1;
    let own = 0;
    e.B.rtDrop = d => d.cv && e.db.rev() === d.rev && own++ === 0;
    e.B.edit('DATA[PF3_KEY].cashFree-=300;');
    await e.clock.run(3000);
    e.B.rtDrop = null;
    e.B.edit('DATA[PF3_KEY].cashFree-=50;');   // второй push уходит с тем же rev: первый прошёл, но B этого не знает
    await e.clock.run(15000);
    eq('S10 кэш = −300 −50 (без двойного счёта)', [e.db.data().data[e.PF3].cashFree, e.A.json('DATA[PF3_KEY].cashFree')], [e.cash - 350, e.cash - 350]);
    eq('S10 тостов нет', [e.A.toasts().length, e.B.toasts().length], [0, 0]);
    converged(e, 'S10');
  }],
  ['S11 ответ потерян, во время полёта — правка другой строки (ревью X3)', async e => {
    const [, t2] = e.T;
    e.B.lat = 300; e.B.loseAck = 1;
    e.B.edit('DATA[PF3_KEY].cashFree-=300;');
    e.clock.at(1000, () => e.B.edit(`__qty(${J(t2)},7);`));
    await e.clock.run(20000);
    const d = e.db.data();
    eq('S11 облако: кэш −300 один раз, кол-во с правки в полёте', [d.data[e.PF3].cashFree, rowOf(d, e, t2)[e.RC.qty]], [e.cash - 300, 7]);
    eq('S11 тостов нет', [e.A.toasts().length, e.B.toasts().length], [0, 0]);
    converged(e, 'S11');
  }],
  ['S12 правка офлайн, облако не менялось → онлайн → отправлена (ревью X5)', async e => {
    const [, t2] = e.T;
    e.B.offline = true;
    e.B.edit(`__qty(${J(t2)},7);`);
    await e.clock.run(3000);
    e.B.offline = false;
    e.B.run('syncResumeCheck();');
    await e.clock.run(15000);
    eq('S12 облако: офлайн-правка дошла', rowOf(e.db.data(), e, t2)[e.RC.qty], 7);
    converged(e, 'S12');
  }],
  ['S13 pullState (кнопка AI) читает облако до коммита push с потерянным ответом (ревью X8)', async e => {
    e.A.lat = 300; e.A.loseAck = 1;
    e.A.edit('DATA[PF3_KEY].cashFree-=300;');
    e.clock.at(1000, () => e.A.run('pullState();'));   // чтение уходит до записи push — старый снапшот
    await e.clock.run(8000);
    e.A.lat = 20;
    e.A.edit('DATA[PF3_KEY].cashFree-=100;');
    await e.clock.run(15000);
    eq('S13 кэш = −300 −100 (старое чтение не откатило базу/rev)', [e.db.data().data[e.PF3].cashFree, e.B.json('DATA[PF3_KEY].cashFree')], [e.cash - 400, e.cash - 400]);
    converged(e, 'S13');
  }],
  ['S14 сделка по одной бумаге на обоих устройствах (ревью п.5)', async e => {
    const [t1] = e.T;
    const trade = (n, q, px, id) => `const r=__row(${J(t1)}); r[RC.buy]=Math.round((r[RC.buy]*r[RC.qty]+${px}*${q})/(r[RC.qty]+${q})*100)/100; __qty(${J(t1)},(parseFloat(r[RC.qty])||0)+${q});
      DATA[PF3_KEY].cashFree-=${q * px}; PF_TRADES.push({id:'tr${n}_${id}',tab:PF3_KEY,tk:${J(t1)},name:${J(t1)},ccy:'USD',act:'buy',qty:${q},price:${px},date:'2026-09-14'});`;
    e.A.edit(trade(1757844000100, 2, 130, 'a'));
    e.B.edit(trade(1757844000200, 3, 131, 'b'));
    await e.clock.run(15000);
    const d = e.db.data(), tb = e.B.toasts();
    eq('S14 облако: позиция — версия A, обе сделки в журнале, кэш — обе', [rowOf(d, e, t1)[e.RC.qty], d.pfTrades.filter(t => t.id === 'tr1757844000100_a' || t.id === 'tr1757844000200_b').length, d.data[e.PF3].cashFree], [e.q1 + 2, 2, e.cash - 260 - 393]);
    ok('S14 у B тост с бумагой и «сверьте позицию»', conflictToast(tb).length === 1 && conflictToast(tb)[0].includes(t1) && /сверьте позицию/.test(conflictToast(tb)[0]), J(tb));
    converged(e, 'S14');
  }],
  ['S15 ответ потерян, воркер записал поверх (скопировав wid), своя правка ждёт push', async e => {
    e.B.loseAck = 1;
    let own = 0;
    e.B.rtDrop = d => d.cv && e.db.rev() === d.rev && own++ === 0;   // эхо своей записи не дошло
    e.B.edit('DATA[PF3_KEY].cashFree-=300;');
    await e.clock.run(900);
    e.B.rtDrop = null;
    e.clock.at(100, () => e.B.edit('DATA[PF3_KEY].cashFree-=50;'));   // таймер стоит — запись воркера у B отложится
    e.clock.at(500, () => e.db.worker(d => { d.aiPort.cashSEK = (d.aiPort.cashSEK || 0) - 1000; d.aiPort.lastRunAt = e.clock.now; }));
    await e.clock.run(15000);
    const d = e.db.data();
    eq('S15 кэш = −300 −50, запись воркера на месте', [d.data[e.PF3].cashFree, d.aiPort.lastRunAt > 0], [e.cash - 350, true]);
    eq('S15 тостов нет (своя правка не проиграла)', [e.A.toasts().length, e.B.toasts().length], [0, 0]);
    converged(e, 'S15');
  }],
  ['S16 офлайн-сделка, облако ушло на 2 rev (сделка A + воркер) → онлайн (ревью-2 п.1)', async e => {
    e.B.offline = true;
    const r0 = e.B.reqs;
    e.B.edit('DATA[PF3_KEY].cashFree-=300;');
    await e.clock.run(3000);
    ok('S16 офлайн — записей с неизвестным исходом нет', e.B.json('SYNC_UNACKED.length') === 0, 'unacked ' + e.B.json('SYNC_UNACKED.length'));
    e.A.edit('DATA[PF3_KEY].cashFree-=100;');
    await e.clock.run(3000);
    e.db.worker(d => { d.aiPort.lastRunAt = e.clock.now; });
    await e.clock.run(3000);
    eq('S16 офлайн push не пытается (ни одного запроса)', e.B.reqs - r0, 0);
    e.B.offline = false;
    e.B.run('syncResumeCheck();');
    await e.clock.run(15000);
    eq('S16 облако: кэш = −300 −100', e.db.data().data[e.PF3].cashFree, e.cash - 400);
    eq('S16 тостов нет', [e.A.toasts(), e.B.toasts()], [[], []]);
    converged(e, 'S16');
  }],
  ['S17 две покупки на одну сумму + AI-прогон на каждом устройстве (ревью-2 п.4)', async e => {
    const [t1, t2] = e.T, sp = e.db.data().aiSpend || {}, runs0 = sp.runs || 0, usd0 = sp.usd || 0;
    const buy = (tk, id) => `DATA[PF3_KEY].cashFree-=100; PF_TRADES.push({id:'tr${id}_x',tab:PF3_KEY,tk:${J(tk)},name:${J(tk)},ccy:'USD',act:'buy',qty:1,price:100,date:'2026-09-14'}); aiSpendAdd({usd:0.5,inTok:1,outTok:1});`;
    e.A.edit(buy(t1, 1757844000400));
    e.B.edit(buy(t2, 1757844000500));
    await e.clock.run(15000);
    const d = e.db.data();
    eq('S17 облако: кэш −200, прогонов +2, $ +1', [d.data[e.PF3].cashFree, d.aiSpend.runs, Math.round(d.aiSpend.usd * 100) / 100], [e.cash - 200, runs0 + 2, Math.round((usd0 + 1) * 100) / 100]);
    eq('S17 тостов нет', [e.A.toasts(), e.B.toasts()], [[], []]);
    converged(e, 'S17');
  }],
  ['S18 ответ потерян и запись не прошла, облако ушло на 2 rev → кэш облака, тост «сверьте позицию» (ревью-2 п.3)', async e => {
    const [t1, t2] = e.T, n1 = e.db.rev() + 1;
    e.B.loseAck = 1;
    e.B.rtDrop = d => d.rev === n1;   // ни запись A, ни отказ своей (OLD) до B не доходят
    const trade = (tk, id, q) => `const r=__row(${J(tk)}); __qty(${J(tk)},(parseFloat(r[RC.qty])||0)+${q}); DATA[PF3_KEY].cashFree-=${q * 100};
      PF_TRADES.push({id:'tr${id}_s18',tab:PF3_KEY,tk:${J(tk)},name:${J(tk)},ccy:'USD',act:'buy',qty:${q},price:100,date:'2026-09-14'});`;
    e.A.edit(trade(t1, 1757844000600, 1));
    e.B.edit(trade(t2, 1757844000700, 3));
    await e.clock.run(2500);
    e.B.rtDrop = null;
    e.db.worker(d => { d.aiPort.lastRunAt = e.clock.now; });
    await e.clock.run(15000);
    const d = e.db.data(), tb = e.B.toasts();
    eq('S18 облако: кэш A (списание B не сложено — исход неизвестен), кол-во и сделка B на месте', [d.data[e.PF3].cashFree, rowOf(d, e, t2)[e.RC.qty], d.pfTrades.some(t => t.id === 'tr1757844000700_s18')], [e.cash - 100, e.q2 + 3, true]);
    ok('S18 у B тост про кэш с «сверьте позицию» и бумагой', conflictToast(tb).length === 1 && /сверьте позицию/.test(conflictToast(tb)[0]) && conflictToast(tb)[0].includes(t2), J(tb));
    converged(e, 'S18');
  }],
  ['S19 три записи не дошли до сервера подряд — JSON только у последних двух, затем сохранено (ревью-2 п.5)', async e => {
    e.B.failPut = 3;
    for (let i = 0; i < 3; i++) { e.B.edit('DATA[PF3_KEY].cashFree-=10;'); await e.clock.run(2000); }
    eq('S19 очередь: 3 записи, JSON у 2', e.B.json('[SYNC_UNACKED.length,SYNC_UNACKED.filter(u=>u.json).length]'), [3, 2]);
    e.B.edit('DATA[PF3_KEY].cashFree-=10;');
    await e.clock.run(15000);
    eq('S19 облако: кэш −40', e.db.data().data[e.PF3].cashFree, e.cash - 40);
    converged(e, 'S19');
  }],
  ['S20 сеть «есть», но чтение aiPort падает → fail-closed: не пишем, повтор не чаще 5 с, потом сохранено (перепроверка п.2)', async e => {
    const [, t2] = e.T, w0 = e.db.writes;
    e.B.flaky = true;
    e.B.edit(`__qty(${J(t2)},7);`);
    const r0 = e.B.reqs;
    await e.clock.run(12000);
    ok('S20 пока чтение падает — записи нет, попыток ≤ 4', e.db.writes === w0 && e.B.reqs - r0 <= 4, `записей ${e.db.writes - w0}, запросов ${e.B.reqs - r0}`);
    e.B.flaky = false;
    await e.clock.run(15000);
    eq('S20 облако: правка дошла без внешнего толчка', rowOf(e.db.data(), e, t2)[e.RC.qty], 7);
    converged(e, 'S20');
  }],
  ['S9 правка во время push + чужая запись (отложенный снапшот, pushAgain)', async e => {
    const [t1, t2, t3] = e.T;
    e.B.lat = 300;
    e.B.edit(`__qty(${J(t2)},8);`);
    e.clock.at(900, () => e.A.edit(`__qty(${J(t1)},12);`));
    e.clock.at(1000, () => e.B.edit(`__qty(${J(t3)},6);`));
    await e.clock.run(20000);
    const d = e.db.data();
    eq('S9 облако: все три правки', [rowOf(d, e, t1)[e.RC.qty], rowOf(d, e, t2)[e.RC.qty], rowOf(d, e, t3)[e.RC.qty]], [12, 8, 6]);
    eq('S9 тостов нет', [e.A.toasts().length, e.B.toasts().length], [0, 0]);
    converged(e, 'S9');
  }],
];

async function main(opts) {
  opts = opts || {};
  const copy = opts.copy ? (() => { let c = JSON.parse(fs.readFileSync(opts.copy, 'utf8')); if (c && c.data && c.data.data && !c.pfTrades) c = c.data; return c; })() : null;
  for (const [name, fn] of SCEN) {
    if (opts.only && !name.includes(opts.only)) continue;
    const clock = mkClock(), db = mkDB(clock);
    if (copy) db.row = J(copy);
    const A = mkClient('A', db, clock, 20, opts.verbose), B = mkClient('B', db, clock, 30, opts.verbose);
    try {
      await start(A, clock);
      const p = A.json(PREP);
      await clock.run(12000);
      await start(B, clock);
      A.toasts(); B.toasts(); A.logs.length = 0; B.logs.length = 0;
      db.rejects = 0;
      const e = { clock, db, A, B, T: p.T, rule: p.rule, trades: p.trades, cash: db.data().data[A.json('PF3_KEY')].cashFree, PF3: A.json('PF3_KEY'), RC: A.json('RC') };
      e.q1 = rowOf(db.data(), e, e.T[0])[e.RC.qty]; e.q2 = rowOf(db.data(), e, e.T[1])[e.RC.qty];
      converged(e, name.split(' ')[0] + ' (исходное)');
      await fn(e);
      if (clock.errors.length) ok(name + ': без исключений в таймерах', false, clock.errors.map(x => x.message).join(' | '));
    } catch (err) { res.push({ n: name, p: false, i: 'threw ' + ((err && err.stack) || err) }); }
  }
  const fail = res.filter(r => !r.p);
  console.log('SYNC-SIM TESTS: ' + (res.length - fail.length) + '/' + res.length + ' passed' + (fail.length ? ' — ' + fail.length + ' FAILED' : '') + (copy ? '  (копия: ' + opts.copy + ')' : ''));
  res.forEach(r => console.log((r.p ? '  ok    ' : '  FAIL  ') + r.n + (r.p ? '' : '  — ' + r.i)));
  return fail.length ? 1 : 0;
}
module.exports = { main };
if (require.main === module) {
  const a = process.argv.slice(2), opt = k => { const x = a.find(s => s.startsWith('--' + k + '=')); return x ? x.slice(k.length + 3) : null; };
  main({ copy: opt('copy'), only: opt('only'), verbose: a.includes('--verbose') }).then(code => process.exit(code), e => { console.error(e); process.exit(2); });
}

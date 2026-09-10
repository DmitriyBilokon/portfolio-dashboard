// Асинхронные сквозные тесты воркера (блок A, worker#4): подменённый fetch
// (Anthropic SSE / Supabase / Yahoo / Telegram) и фиксированные «часы» (среда,
// биржи США и Швеции открыты). JSC-раннер (run-worker.js) не крутит промисы, поэтому
// этот сьют — под node: `node tests/run-worker-async.js`. Вызывается из tests/run.sh.
// Маркер сводки: «WORKER-ASYNC TESTS: N/N passed».
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'telegram-notify.js'), 'utf8').replace(/^export default/m, 'var __mod =');

// Часы воркера: 2026-09-09 (ср) 15:00 UTC = 11:00 Нью-Йорк / 17:00 Стокгольм.
const BASE = Date.parse('2026-09-09T15:00:00Z'), T0 = Date.now();
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a){ if(a.length) super(...a); else super(BASE + (RealDate.now() - T0)); }
  static now(){ return BASE + (RealDate.now() - T0); }
}

const logs = [];
const quiet = { log: (...a) => logs.push(['log', a.join(' ')]), warn: (...a) => logs.push(['warn', a.join(' ')]), error: (...a) => logs.push(['error', a.join(' ')]) };
const ctx = {
  fetch: (...a) => ctx.__fetch(...a), __fetch: null,
  Response, Request, Headers, ReadableStream, TextEncoder, TextDecoder, AbortController,
  setTimeout, clearTimeout, URL, crypto: globalThis.crypto, console: quiet, Date: FakeDate,
};
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.__W = { anthropicRun, aiPortfolioRun, analyzeOnePortfolio, marketOpen, AI_NET, mod: __mod, PF3_KEY };', ctx, { filename: 'telegram-notify.js' });
const W = ctx.__W;
W.AI_NET.baseMs = 1;   // бэкофф в тестах — миллисекунды

const res = [];
const eq = (n, g, e) => { const p = JSON.stringify(g) === JSON.stringify(e); res.push({ n, p, i: p ? '' : 'got ' + JSON.stringify(g) + ' exp ' + JSON.stringify(e) }); };
const ok = (n, c, i) => res.push({ n, p: !!c, i: c ? '' : (i || 'falsy') });
async function grp(name, fn){ try{ await fn(); }catch(e){ res.push({ n: name, p: false, i: 'threw ' + ((e && e.stack) || e) }); } }

// ── Anthropic SSE ──
function sseText(events){ return events.map(e => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''); }
function anth(text, stop_reason, opts){
  opts = opts || {};
  const ev = [{ type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 }];
  if(opts.midError) ev.push({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
  ev.push({ type: 'message_delta', delta: { stop_reason: stop_reason || 'end_turn' }, usage: { output_tokens: 50 } }, { type: 'message_stop' });
  return new Response(sseText(ev), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const httpErr = (status, body, headers) => new Response(body || '{"type":"error"}', { status, headers: headers || {} });
// Стрим, который молчит, пока его не оборвут сигналом (как настоящий fetch при abort).
function hang(signal){
  return new Response(new ReadableStream({ start(c){ if(signal) signal.addEventListener('abort', () => c.error(new Error('The operation was aborted'))); } }), { status: 200 });
}
// Очередь ответов Anthropic: элемент — Response или (req, signal) => Response.
let anthQ = [], anthReqs = [];
function anthNext(url, init){
  const body = JSON.parse(init.body);
  anthReqs.push(body);
  const x = anthQ.shift();
  if(!x) throw new Error('mock: очередь Anthropic пуста');
  return typeof x === 'function' ? x(body, init.signal) : x;
}
const JS = { output_config: { format: { type: 'json_schema', schema: { type: 'object' } } } };
const baseBody = extra => Object.assign({ model: 'm', max_tokens: 6000, system: 'S', messages: [{ role: 'user', content: 'hi' }] }, extra || {});
const runAnth = async (queue, body) => { anthQ = queue.slice(); anthReqs = []; logs.length = 0; ctx.__fetch = async (url, init) => anthNext(url, init); return W.anthropicRun({ ANTHROPIC_API_KEY: 'k' }, body); };
const textOf = j => j.content.filter(b => b.type === 'text').map(b => b.text).join('');
const caught = async p => { try{ await p; return null; }catch(e){ return e; } };

// ── Мир для сквозных прогонов: Supabase + Yahoo + Telegram + Anthropic ──
function chart(price){
  const n = 220, ts = [], c = [], h = [], l = [];
  for(let i = 0; i < n; i++){ ts.push(Math.floor((BASE - (n - i) * 86400e3) / 1000)); c.push(price * (0.8 + 0.2 * i / n)); h.push(price * 1.02); l.push(price * 0.7); }
  return { chart: { result: [{ meta: { regularMarketPrice: price }, timestamp: ts, indicators: { quote: [{ close: c, high: h, low: l, open: c, volume: c.map(() => 1e6) }] } }] } };
}
function mkWorld(snap){
  const w = { snap: JSON.parse(JSON.stringify(snap)), patches: 0, bak: null, bakPosts: 0, tg: [], jobs: [] };
  w.fetch = async (url, init) => {
    url = String(url); init = init || {};
    const method = init.method || 'GET';
    if(url.startsWith('https://api.anthropic.com/')) return anthNext(url, init);
    if(url.includes('finance.yahoo.com/v8/finance/chart/')) return new Response(JSON.stringify(chart(100)), { status: 200 });
    if(url.includes('finance.yahoo.com')) return httpErr(404);
    if(url.startsWith('https://api.telegram.org/')){ w.tg.push(JSON.parse(init.body || '{}').text || ''); return new Response('{"ok":true}', { status: 200 }); }
    if(url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1', email: 'admin@test' }), { status: 200 });
    if(url.includes('/rest/v1/user_access')) return new Response('[{"role":"admin"}]', { status: 200 });
    if(url.includes('/rest/v1/ai_jobs')){ w.jobs.push(JSON.parse(init.body).status); return new Response('', { status: 201 }); }
    if(url.includes('/rest/v1/ai_state')){
      if(method === 'POST'){
        const b = JSON.parse(init.body);
        if('alerts' in b){ if(w.noAlertsCol) return httpErr(400, '{"message":"column alerts does not exist"}'); w.alerts = b.alerts; return new Response('', { status: 201 }); }
        w.bakPosts++; w.bak = b.port; return new Response('', { status: 201 });
      }
      if(url.includes('select=alerts')) return w.noAlertsCol ? httpErr(400, '{"message":"column alerts does not exist"}') : new Response(JSON.stringify([{ alerts: w.alerts || null }]), { status: 200 });
      return new Response(JSON.stringify(w.bak ? [{ port: w.bak }] : []), { status: 200 });
    }
    if(url.includes('/rest/v1/ledger_state')){
      if(method === 'PATCH'){ w.patches++; w.snap = JSON.parse(init.body).data; return new Response(JSON.stringify([{ data: w.snap }]), { status: 200 }); }
      return new Response(JSON.stringify([{ user_id: 'u1', data: w.snap }]), { status: 200 });
    }
    return httpErr(404, 'mock: ' + url);
  };
  return w;
}
const ENV = { ANTHROPIC_API_KEY: 'k', SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 's', OWNER_USER_ID: 'u1', BOT_TOKEN: 'b', CHAT_ID: 'c' };
function mkSnap(){
  const headers = ['#', 'Компания', 'Тикер', '', 'Сектор', 'Тип', 'Кол-во', 'Цена', 'Валюта', 'Средняя', 'День %'];
  return { rev: 5, fx: { USD: 10 }, data: {
    [W.PF3_KEY]: { v3: '1', title: 'PF3', headers, cashFree: 1000, rows: [['1', 'Micron', 'MU', '', 'Tech', 'Рост', 5, 100, 'USD', 90, 1]] },
  }, aiPort: { startedAt: BASE - 10 * 86400e3, startCapital: 300000, cashSEK: 300000, positions: [], trades: [], lastRunAt: 0, intervalMin: 60, minTradeSEK: 5000, commissionPct: 0 } };
}
const decisions = d => JSON.stringify({ decisions: d, note: 'n' });

(async () => {
  await grp('часы теста: биржи открыты', async () => {
    ok('USD и SEK открыты в подменённое время', W.marketOpen('USD') && W.marketOpen('SEK'));
  });

  await grp('anthropicRun: повторы', async () => {
    let j = await runAnth([httpErr(529, '{"type":"overloaded_error"}'), anth('ok', 'end_turn')], baseBody());
    eq('529 → повтор → успех', [textOf(j), anthReqs.length, j.stop_reason], ['ok', 2, 'end_turn']);
    ok('повтор записан в лог', logs.some(l => l[0] === 'warn' && /попытка 1/.test(l[1])));
    j = await runAnth([httpErr(429, '', { 'retry-after': '0' }), httpErr(503), anth('ok2')], baseBody());
    eq('429 + 503 → третья попытка', [textOf(j), anthReqs.length], ['ok2', 3]);
    let e = await caught(runAnth([httpErr(400, '{"error":"stream timeout in text"}')], baseBody()));
    eq('400 — без повтора, ошибка наружу', [!!e, anthReqs.length, e && e.status], [true, 1, 400]);
    e = await caught(runAnth([httpErr(529), httpErr(529), httpErr(529), httpErr(529)], baseBody()));
    eq('4 × 529 → ошибка после AI_NET.tries попыток', [!!e, anthReqs.length, /529/.test(e && e.message)], [true, 4, true]);
    j = await runAnth([anth('x', 'end_turn', { midError: true }), anth('ok3')], baseBody());
    eq('error-событие посреди стрима → повтор', [textOf(j), anthReqs.length], ['ok3', 2]);
    ok('usage — только за успешные раунды (100 in)', j.usage.input_tokens === 100);
  });

  await grp('anthropicRun: зависший стрим', async () => {
    const idle0 = W.AI_NET.idleMs;
    W.AI_NET.idleMs = 40;
    try{
      const j = await runAnth([(b, sig) => hang(sig), anth('after-timeout')], baseBody());
      eq('тишина → timeout → повтор → успех', [textOf(j), anthReqs.length], ['after-timeout', 2]);
      ok('в логе — timeout', logs.some(l => l[0] === 'warn' && /timeout/.test(l[1])));
      const e = await caught(runAnth([(b, s) => hang(s), (b, s) => hang(s), (b, s) => hang(s), (b, s) => hang(s)], baseBody()));
      eq('зависает всегда → ошибка «timeout»', [!!e, e && e.code, anthReqs.length], [true, 'timeout', 4]);
    }finally{ W.AI_NET.idleMs = idle0; }
  });

  await grp('anthropicRun: max_tokens', async () => {
    let j = await runAnth([anth('{"a":', 'max_tokens'), anth('{"a":1}', 'end_turn')], baseBody(JS));
    eq('усечён → повтор с max_tokens ×1.5', [textOf(j), anthReqs.map(b => b.max_tokens)], ['{"a":1}', [6000, 9000]]);
    eq('usage суммирован по обоим прогонам', [j.usage.input_tokens, j.usage.output_tokens], [200, 100]);
    ok('усечённый текст первого прогона не попал в ответ', textOf(j) === '{"a":1}');
    const e = await caught(runAnth([anth('{"a":', 'max_tokens'), anth('{"a":[1,', 'max_tokens')], baseBody(JS)));
    eq('усечён дважды → ошибка truncated', [!!e, e && e.code, anthReqs.length, /усечён/.test(e && e.message)], [true, 'truncated', 2, true]);
    j = await runAnth([anth('long markdown', 'max_tokens')], baseBody({ tools: [{ type: 'web_search_20250305', name: 'web_search' }] }));
    eq('без json_schema — не повторяем, stop_reason наружу', [anthReqs.length, j.stop_reason], [1, 'max_tokens']);
    const e2 = await caught(runAnth([anth('{', 'max_tokens')], baseBody(Object.assign({}, JS, { max_tokens: 24000 }))));
    eq('на потолке — без повтора, сразу ошибка', [e2 && e2.code, anthReqs.length], ['truncated', 1]);
  });

  await grp('anthropicRun: pause_turn', async () => {
    const j = await runAnth([anth('part1 ', 'pause_turn'), anth('part2', 'end_turn')], baseBody());
    eq('продолжение после pause_turn', [textOf(j), anthReqs.length, j.stop_reason], ['part1 part2', 2, 'end_turn']);
    eq('второй раунд несёт ответ ассистента', anthReqs[1].messages.map(m => m.role), ['user', 'assistant']);
  });

  await grp('aiPortfolioRun: сквозной', async () => {
    // Усечён дважды → ошибка до исполнения: ни ledger, ни ai_state, ни Telegram; lastRunAt не тронут.
    let w = mkWorld(mkSnap()); ctx.__fetch = w.fetch; anthQ = [anth('{"decisions":[', 'max_tokens'), anth('{"decisions":[{', 'max_tokens')]; anthReqs = [];
    let e = await caught(W.aiPortfolioRun(ENV, true));
    eq('усечён → ошибка, записей нет', [!!e && /усечён/.test(e.message), w.patches, w.bakPosts, w.tg.length, w.snap.aiPort.lastRunAt], [true, 0, 0, 0, 0]);
    eq('повтор с большим лимитом', anthReqs.map(b => b.max_tokens), [6000, 9000]);
    // Нераспознанный ответ → тоже ошибка (раньше — «0 сделок» и lastRunAt).
    w = mkWorld(mkSnap()); ctx.__fetch = w.fetch; anthQ = [anth('не json', 'end_turn')];
    e = await caught(W.aiPortfolioRun(ENV, true));
    eq('не JSON → ошибка, гейт не записан', [!!e && /некорректный ответ/.test(e.message), w.patches, w.bakPosts, w.snap.aiPort.lastRunAt], [true, 0, 0, 0]);
    // 529 → повтор → покупка: ai_state → ledger → Telegram.
    w = mkWorld(mkSnap()); ctx.__fetch = w.fetch; anthQ = [httpErr(529), anth(decisions([{ action: 'buy', ticker: 'MU', qty: 100, reason: 'r', trigger: 't' }]), 'end_turn')]; anthReqs = [];
    const out = await W.aiPortfolioRun(ENV, true);
    ok('529 → повтор → сделка исполнена', /сделок 1/.test(out), out);
    eq('ledger и резерв записаны, Telegram после записи', [w.patches >= 1, w.bakPosts, w.tg.length, w.snap.aiPort.lastRunAt > 0, (w.snap.aiPort.positions || []).length], [true, 1, 1, true, 1]);
    eq('запрос через стрим с кэшируемым system', [anthReqs[1].stream, Array.isArray(anthReqs[1].system) && !!anthReqs[1].system[0].cache_control], [true, true]);
    // «0 сделок» валидным ответом — это нормальный цикл: гейт ставится.
    w = mkWorld(mkSnap()); ctx.__fetch = w.fetch; anthQ = [anth(decisions([]), 'end_turn')];
    const out0 = await W.aiPortfolioRun(ENV, true);
    eq('валидные 0 решений → цикл записан', [/сделок 0/.test(out0), w.snap.aiPort.lastRunAt > 0, w.tg.length], [true, true, 0]);
  });

  await grp('analyzeOnePortfolio: усечение', async () => {
    const w = mkWorld(mkSnap()); ctx.__fetch = w.fetch; anthQ = [anth('{"summary":"', 'max_tokens'), anth('{"summary":"x","rep', 'max_tokens')];
    const out = await W.analyzeOnePortfolio(ENV, W.PF3_KEY, true);
    eq('ошибка, pfAnalysisAt и анализ не записаны', [/усечён/.test(out), w.patches, w.snap.data[W.PF3_KEY].pfAnalysisAt, w.snap.data[W.PF3_KEY].analysis], [true, 0, undefined, undefined]);
    const w2 = mkWorld(mkSnap()); ctx.__fetch = w2.fetch; anthQ = [httpErr(529), anth(JSON.stringify({ summary: 's', report: 'r', actions: [{ action: 'Держать', name: 'Micron', ticker: 'MU', details: 'd', amountSEK: null }] }), 'end_turn')];
    const out2 = await W.analyzeOnePortfolio(ENV, W.PF3_KEY, true);
    eq('529 → повтор → анализ записан', [/1 реком/.test(out2), w2.snap.data[W.PF3_KEY].pfAnalysisAt > 0, w2.snap.data[W.PF3_KEY].analysis.summary], [true, true, 's']);
  });

  await grp('analyzeOnePortfolio: дедуп ошибок в Telegram', async () => {
    const bill = () => httpErr(400, '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."},"request_id":"req_' + Math.random().toString(36).slice(2) + '"}');
    const w = mkWorld(mkSnap()); ctx.__fetch = w.fetch;
    anthQ = [bill()];
    let out = await W.analyzeOnePortfolio(ENV, W.PF3_KEY, false);
    eq('1-я ошибка: Telegram с подсказкой про баланс', [w.tg.length, /credit balance/.test(w.tg[0] || ''), /Plans &amp; Billing/.test(w.tg[0] || ''), /Telegram отправлен/.test(out)], [1, true, true, true]);
    anthQ = [bill()];
    out = await W.analyzeOnePortfolio(ENV, W.PF3_KEY, false);
    eq('2-я та же (другой request_id): молчим', [w.tg.length, /повтор той же ошибки \(1\)/.test(out), w.alerts.errs[W.PF3_KEY].n], [1, true, 1]);
    eq('гейт анализа не записан — повтор через час сохраняется', [w.patches, w.snap.data[W.PF3_KEY].pfAnalysisAt], [0, undefined]);
    anthQ = [anth(JSON.stringify({ summary: 's', report: 'r', actions: [] }), 'end_turn')];
    await W.analyzeOnePortfolio(ENV, W.PF3_KEY, false);
    eq('успех: «снова работает», запись дедупа снята', [w.tg.length, /снова работает/.test(w.tg[1] || ''), W.PF3_KEY in w.alerts.errs], [2, true, false]);
    // Без колонки alerts (SQL не выполнен) — шлём каждый раз, как раньше.
    const w2 = mkWorld(mkSnap()); w2.noAlertsCol = true; ctx.__fetch = w2.fetch;
    anthQ = [bill()]; await W.analyzeOnePortfolio(ENV, W.PF3_KEY, false);
    anthQ = [bill()]; await W.analyzeOnePortfolio(ENV, W.PF3_KEY, false);
    eq('нет колонки → без дедупа (2 сообщения)', w2.tg.length, 2);
  });

  await grp('роуты aiport/pfanalyze: работа в waitUntil', async () => {
    const w = mkWorld(mkSnap()); ctx.__fetch = w.fetch; anthQ = [anth(decisions([]), 'end_turn')];
    const waits = [];
    const ec = { waitUntil: p => waits.push(p) };
    const r = await W.mod.fetch(new Request('https://w.test/?action=aiport', { headers: { Authorization: 'Bearer t' } }), ENV, ec);
    const body = JSON.parse((await r.text()).trim());
    eq('aiport: waitUntil получил промис, стрим отдал его результат', [waits.length, /сделок 0/.test(body.result)], [1, true]);
    eq('промис waitUntil = та же работа', /сделок 0/.test((await waits[0]).result), true);
    anthQ = [anth(JSON.stringify({ summary: 's', report: 'r', actions: [] }), 'end_turn')];
    const r2 = await W.mod.fetch(new Request('https://w.test/?action=pfanalyze', { headers: { Authorization: 'Bearer t' } }), ENV, ec);
    const b2 = JSON.parse((await r2.text()).trim());
    eq('pfanalyze: тоже через waitUntil', [waits.length, /0 реком/.test(b2.result)], [2, true]);
  });

  await grp('ai_jobs: running при старте', async () => {
    const w = mkWorld(mkSnap()); ctx.__fetch = w.fetch;
    anthQ = [anth(JSON.stringify({ report: 'R', proposal: { summary: 's', changedSince: '', actions: [], watchlist: [] } }), 'end_turn')];
    const waits = [];
    const r = await W.mod.fetch(new Request('https://w.test/?action=ai', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify({ mode: 'watchlist', jobId: 'j1' }) }), ENV, { waitUntil: p => waits.push(p) });
    eq('ответ queued', (await r.json()).queued, true);
    await Promise.all(waits);
    eq('статусы задачи: running → done', w.jobs, ['running', 'done']);
  });

  await grp('LSE: пенсы → фунты сквозь роуты', async () => {
    // Yahoo для .L: chart с currency GBp, quoteSummary financialData без модуля валюты (решает суффикс).
    const gbpChart = () => {
      const j = chart(3771); const r0 = j.chart.result[0];
      r0.meta.currency = 'GBp'; r0.meta.chartPreviousClose = 3998;
      return j;
    };
    const yf = [];
    ctx.__fetch = async (url) => {
      url = String(url); yf.push(url);
      if(url.includes('/v8/finance/chart/ANTO.L')) return new Response(JSON.stringify(gbpChart()), { status: 200 });
      if(url.includes('/v8/finance/chart/')) return new Response(JSON.stringify(chart(100)), { status: 200 });
      if(url.startsWith('https://fc.yahoo.com/')) return new Response('', { status: 200, headers: { 'set-cookie': 'A3=x; Path=/' } });
      if(url.includes('/v1/test/getcrumb')) return new Response('crumb1', { status: 200 });
      if(url.includes('/v10/finance/quoteSummary/ANTO.L')) return new Response(JSON.stringify({ quoteSummary: { result: [{
        financialData: { targetMeanPrice: { raw: 3819, fmt: '3,819.00' }, numberOfAnalystOpinions: { raw: 21 }, returnOnEquity: { raw: 0.1785 } },
        summaryDetail: { currency: 'GBp', trailingPE: { raw: 30.4 }, dividendYield: { raw: 0.0145 } },
        price: { currency: 'GBp', regularMarketPrice: { raw: 3771 }, marketCap: { raw: 37176655872 } } }] } }), { status: 200 });
      return httpErr(404);
    };
    const get = async q => JSON.parse(await (await W.mod.fetch(new Request('https://w.test/?' + q), ENV, { waitUntil: () => {} })).text());
    const lite = (await get('symbols=ANTO.L,MU&lite=1'));
    const a = lite['ANTO.L'];
    eq('lite: цена в фунтах', a.price, 37.71);
    ok('lite: SMA и уровни в фунтах (десятки, не тысячи)', [a.sma50, a.sma200, a.support, a.resistance].every(v => v > 20 && v < 50), JSON.stringify(a));
    ok('lite: ATR в фунтах', a.atr > 0 && a.atr < 30, String(a.atr));
    eq('lite: US-бумага как раньше', lite.MU.price, 100);
    const h = await get('history=ANTO.L&range=1mo');
    ok('history: закрытия в фунтах', h.c.length > 0 && h.c.every(v => v > 20 && v < 50), JSON.stringify(h.c.slice(-3)));
    ok('history: объём не делится', h.v.every(v => v === 1e6));
    const t = (await get('targets=ANTO.L'))['ANTO.L'];
    eq('targets: таргет Yahoo в фунтах, P/E и капа — как есть', [t.avg, t.src, t.pe, t.cap], [38.19, 'yahoo', 30.4, 37176655872]);
    ok('Yahoo дёрнут с символом .L', yf.some(u => u.includes('quoteSummary/ANTO.L')));
  });

  const fail = res.filter(r => !r.p);
  let out = 'WORKER-ASYNC TESTS: ' + (res.length - fail.length) + '/' + res.length + ' passed' + (fail.length ? ' — ' + fail.length + ' FAILED' : '') + '\n';
  res.forEach(r => { out += (r.p ? '  ok    ' : '  FAIL  ') + r.n + (r.p ? '' : '  — ' + r.i) + '\n'; });
  process.stdout.write(out);
  process.exit(fail.length ? 1 : 0);
})();
